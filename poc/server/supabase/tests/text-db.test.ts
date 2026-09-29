import { assertEquals } from "jsr:@std/assert";
import type { ClassifyResult } from "../functions/_shared/classify.ts";
import { encrypt, toBytea } from "../functions/_shared/crypto.ts";
import type { TextExtraction } from "../functions/_shared/extract-text.ts";
import type { Job } from "../functions/_shared/job.ts";
import { processText } from "../functions/worker/text.ts";
import { textDeps } from "../functions/worker/text-deps.ts";
import { deleteRunJobs, RUN, service as sb, testUser } from "./_testenv.ts";

// 호스팅 DB. 전용 테스트 사용자·실행 태그만(AGENTS.md §7). 분류·추출은 가짜(합성), 저장·상태·복호화는 실제 RPC
const USER = (await testUser()).id;
const EVENT_X: TextExtraction = { kind: "event", evidence: "합성 근거",
  event: { title: "합성 진료", start: "2026-10-02T15:00:00+09:00", end: null, location: null, uncertain: [] } };
async function seed(text: string, tag: string): Promise<string> {
  const { data, error } = await sb.rpc("insert_item", { p_user: USER, p_source: "NOTIFICATION", p_idempotency_key: `${RUN}:text:${tag}`,
    p_sender: null, p_title: null, p_content_enc: toBytea(await encrypt(USER, text)), p_occurred_at: new Date().toISOString(), p_enqueue: false });
  assertEquals(error, null);
  return data as string;
}
const job = (itemId: string): Job => ({ id: `${RUN}:job`, kind: "process", user_id: USER, payload: { item_id: itemId }, attempts: 1, checkpoint: null });

Deno.test("process end-to-end on hosted DB: event saved once across retries; personal wipes; low-confidence empty keeps ciphertext", async () => {
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
    const { data: wiped } = await sb.from("items").select("id").eq("id", chat).is("content_enc", null);
    const { data: kept } = await sb.from("items").select("id").eq("id", empty).not("content_enc", "is", null);
    assertEquals([wiped!.length, kept!.length, extractCalls], [1, 1, 3]);               // 잡담은 추출 호출 없음
  } finally {
    const ids = [ev, chat, empty];
    await sb.from("facts").delete().eq("user_id", USER).in("item_id", ids);
    await sb.from("items").delete().eq("user_id", USER).in("id", ids);
    await sb.from("usage_counters").delete().eq("user_id", USER);
    await deleteRunJobs();
  }
});
