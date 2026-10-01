import { assertEquals, assertRejects } from "jsr:@std/assert";
import type { ClassifyResult } from "../functions/_shared/classify.ts";
import { encrypt, toBytea } from "../functions/_shared/crypto.ts";
import type { TextExtraction } from "../functions/_shared/extract-text.ts";
import type { Job } from "../functions/_shared/job.ts";
import { processText } from "../functions/worker/text.ts";
import { textDeps } from "../functions/worker/text-deps.ts";
import { deleteRunJobs, RUN, service as sb, testUser } from "./_testenv.ts";

// 호스팅 DB. 전용 테스트 사용자·실행 태그만(AGENTS.md §7). 분류·추출은 가짜(합성), 저장·상태·복호화는 실제 RPC
const USER = (await testUser()).id;
const EVENT_X: TextExtraction = { kind: "event", events: [{ evidence: "합성 근거",
  event: { title: "합성 진료", start: "2026-10-02T15:00:00+09:00", end: null, location: null, uncertain: [] } }] };
async function seed(text: string, tag: string): Promise<string> {
  const { data, error } = await sb.rpc("insert_item", { p_user: USER, p_source: "NOTIFICATION", p_idempotency_key: `${RUN}:text:${tag}`,
    p_sender: null, p_title: null, p_content_enc: toBytea(await encrypt(USER, text)), p_occurred_at: new Date().toISOString(), p_enqueue: false });
  assertEquals(error, null);
  return data as string;
}
const job = (itemId: string): Job => ({ id: `${RUN}:job`, kind: "process", user_id: USER, payload: { item_id: itemId }, attempts: 1, checkpoint: null });

Deno.test("process end-to-end on hosted DB: event saved once across retries; personal quarantined; low-confidence empty keeps ciphertext", async () => {
  const ev = await seed("[합성의원] 내일 오후 3시 진료 예약", "ev");
  const chat = await seed("ㅋㅋㅋ 합성 잡담", "chat");
  const empty = await seed("[합성앱] 합성 안내", "empty");
  let extractCalls = 0;
  const verdict = (t: string): ClassifyResult =>
    t.startsWith("ㅋㅋㅋ") ? { label: "personal", confidence: 0.97 } : t.startsWith("[합성앱]") ? { label: "notice", confidence: 0.5 } : { label: "actionable", confidence: 0.99 };
  const deps = textDeps(sb, {
    leasePrefix: `${RUN}:`,
    classifier: { provider: "jev", classify: async (t) => verdict(t) },
    threshold: 0.8,
    extract: async (t) => { extractCalls++; return { result: t.startsWith("[합성의원]") ? EVENT_X : { kind: "none" }, usage: { input_tokens: 10, output_tokens: 5 } }; },
  });
  try {
    assertEquals(await processText(deps, job(ev)), "proposed");
    assertEquals(await processText(deps, job(ev)), "extracted");                       // 재시도: 처리됨, 모델 재호출 없음
    await sb.from("items").update({ status: "queued" }).eq("id", ev).eq("user_id", USER); // 저장 뒤 잡 완료 전 종료 흉내
    assertEquals(await processText(deps, job(ev)), "proposed");
    assertEquals(extractCalls, 2);
    const { data: facts } = await sb.from("facts").select("id, proposals(id)").eq("user_id", USER).eq("item_id", ev);
    assertEquals([facts!.length, (facts![0].proposals as unknown[]).length], [1, 1]);
    const { data: evItem } = await sb.from("items").select("status").eq("id", ev).single();
    assertEquals(evItem!.status, "extracted");

    assertEquals(await processText(deps, job(chat)), "discarded:server:personal");
    assertEquals(await processText(deps, job(empty)), "discarded:server:empty");         // notice 0.5 → 게이트 통과 → 추출이 비어 empty
    const { data: wiped } = await sb.from("items").select("id").eq("id", chat).not("content_enc", "is", null).not("quarantine_until", "is", null);
    const { data: kept } = await sb.from("items").select("id").eq("id", empty).not("content_enc", "is", null);
    assertEquals([wiped!.length, kept!.length, extractCalls], [1, 1, 3]);               // 잡담은 추출 호출 없음
    // 검색 대상(저장·empty)만 embed 잡(실행 태그 lease), 격리 항목은 없다
    const { data: emb } = await sb.from("jobs").select("payload").eq("kind", "embed").like("lease_key", `${RUN}:embed:%`);
    assertEquals([...new Set(emb!.map((j) => (j.payload as { item_id: string }).item_id))].sort(), [ev, empty].sort());
  } finally {
    const ids = [ev, chat, empty];
    await sb.from("facts").delete().eq("user_id", USER).in("item_id", ids);
    await sb.from("items").delete().eq("user_id", USER).in("id", ids);
    await sb.from("usage_counters").delete().eq("user_id", USER);
    await sb.from("llm_slots").delete().eq("user_id", USER);                              // 추출이 LLM 슬롯 행을 만든다
    await deleteRunJobs();
  }
});

// Fix round 1: save_fact 가 items.status = extracted 를 커밋한 뒤 notify enqueue 가 실패 → 잡 재시도가 notify 를 다시 넣는다
Deno.test("process retry on hosted DB: enqueue failed after save_fact → retry (already extracted) enqueues notify; once pushed, no more", async () => {
  const ev = await seed("[합성의원] 모레 오후 3시 진료 예약", "renotify");
  const deps = textDeps(sb, {
    leasePrefix: `${RUN}:`,
    classifier: { provider: "jev", classify: async () => ({ label: "actionable", confidence: 0.99 }) },
    threshold: 0.8,
    extract: async () => ({ result: EVENT_X, usage: { input_tokens: 10, output_tokens: 5 } }),
  });
  const notifyJobs = async (proposal: string) =>
    (await sb.from("jobs").select("id").eq("kind", "notify").eq("lease_key", `${RUN}:notify:${proposal}`)).data!.length;
  try {
    await assertRejects(() => processText({ ...deps, enqueueNotify: async () => { throw new Error("enqueue_job XX000"); } }, job(ev)), Error, "enqueue_job");
    const { data: row } = await sb.from("items").select("status, facts(proposals(id))").eq("id", ev).single();
    const proposal = ((row!.facts as { proposals: { id: string }[] }[])[0].proposals[0]).id;
    assertEquals([row!.status, await notifyJobs(proposal)], ["extracted", 0]);          // 이 상태에서 예전 코드는 푸시를 잃었다
    assertEquals(await processText(deps, job(ev)), "extracted");                      // 실제 재시도
    assertEquals(await notifyJobs(proposal), 1);
    await sb.from("proposal_pushes").insert({ user_id: USER, proposal_id: proposal, device_id: `${RUN}:d1`, status: "sent" });
    assertEquals(await processText(deps, job(ev)), "extracted");                      // notify 가 이미 돌았다 → 다시 넣지 않는다
    assertEquals(await notifyJobs(proposal), 1);
  } finally {
    await sb.from("facts").delete().eq("user_id", USER).eq("item_id", ev);              // proposals → proposal_pushes cascade
    await sb.from("items").delete().eq("user_id", USER).eq("id", ev);
    await sb.from("usage_counters").delete().eq("user_id", USER);
    await sb.from("llm_slots").delete().eq("user_id", USER);                              // 추출이 LLM 슬롯 행을 만든다
    await deleteRunJobs();
  }
});
