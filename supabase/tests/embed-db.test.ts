import { assert, assertEquals } from "jsr:@std/assert";
import { encrypt, toBytea } from "../functions/_shared/crypto.ts";
import { embed, toPgVector } from "../functions/_shared/embeddings.ts";
import type { Job } from "../functions/_shared/job.ts";
import { embedItem } from "../functions/worker/embed.ts";
import { embedDeps } from "../functions/worker/embed-deps.ts";
import { deleteRunJobs, RUN, service as sb, testUser } from "./_testenv.ts";

const USER = (await testUser()).id;
const vec = (k: number) => toPgVector(Array.from({ length: 512 }, (_, i) => (i === k ? 1 : 0)));
async function newItem(key: string, status: string): Promise<string> {
  const { data: item, error } = await sb.rpc("insert_item", { p_user: USER, p_source: "NOTIFICATION", p_idempotency_key: `${RUN}:${key}`,
    p_sender: null, p_title: "합성 주문", p_content_enc: toBytea(await encrypt(USER, "합성상점 무선 이어폰 주문")),
    p_occurred_at: new Date().toISOString(), p_enqueue: false });
  if (error) throw new Error("insert_item " + error.code);
  await sb.from("items").update({ status }).eq("id", item);
  return item as string;
}

Deno.test("embed source → save chunks → hybrid_search finds by vector and keyword; source empty once chunked; backlog scoped", async () => {
  const item = await newItem("emb", "extracted");
  const quarantined = await newItem("emb-q", "discarded:server:personal");
  try {
    const { data: src } = await sb.rpc("worker_get_embed_source", { p_user: USER, p_item: item });
    assertEquals((src as unknown[]).length, 1);
    assertEquals(((await sb.rpc("worker_get_embed_source", { p_user: USER, p_item: quarantined })).data as unknown[]).length, 0);
    // 백로그: 대상 1건(격리 항목 제외), 백필 레인, 항목의 실행 태그를 물려받아 운영 워커가 가져가지 않는다. 대기 중이면 다시 넣지 않는다
    assertEquals((await sb.rpc("enqueue_embed_backlog", { p_user: USER, p_limit: 10 })).data, 1);
    const { data: jobs } = await sb.from("jobs").select("lease_key, payload, priority").eq("user_id", USER).eq("kind", "embed");
    assertEquals(jobs, [{ lease_key: `${RUN}:backfill:${USER}`, payload: { item_id: item, backfill: true }, priority: 40 }]);
    assertEquals((await sb.rpc("enqueue_embed_backlog", { p_user: USER, p_limit: 10 })).data, 0);

    await sb.rpc("worker_save_chunks", { p_user: USER, p_item: item, p_chunks: [{ i: 0, text: "합성 주문\n합성상점 무선 이어폰 주문", embedding: vec(7) }] });
    const { data: again } = await sb.rpc("worker_get_embed_source", { p_user: USER, p_item: item });
    assertEquals((again as unknown[]).length, 0);                                           // 이미 청크 있음 → 재실행은 건너뜀
    const { data: byVec } = await sb.rpc("hybrid_search", { p_user: USER, p_query: "아무말", p_embedding: vec(7), p_limit: 5 });
    const { data: byKw } = await sb.rpc("hybrid_search", { p_user: USER, p_query: "이어폰 어디서 샀지", p_embedding: null, p_limit: 5 });
    assert((byVec as { item_id: string }[]).some((r) => r.item_id === item));
    assert((byKw as { item_id: string }[]).some((r) => r.item_id === item));

    // 저장 직전에 대상에서 빠진 항목(격리·만료)은 청크를 만들지 않는다
    const { data: n } = await sb.rpc("worker_save_chunks", { p_user: USER, p_item: quarantined, p_chunks: [{ i: 0, text: "합성", embedding: vec(1) }] });
    assertEquals(n, 0);
    const { count } = await sb.from("item_chunks").select("id", { count: "exact", head: true }).eq("item_id", quarantined);
    assertEquals(count, 0);
  } finally {
    await deleteRunJobs();
    await sb.from("jobs").delete().eq("user_id", USER).in("payload->>item_id", [item, quarantined]);
    await sb.from("items").delete().eq("user_id", USER).in("id", [item, quarantined]);      // chunks cascade
    await sb.from("audit_log").delete().eq("user_id", USER).eq("action", "decrypt").in("target", [item, quarantined]);
  }
});

// 실제 의존성(embedDeps: DB RPC + OpenAI 임베딩 + 예산 예약·정산·LLM 슬롯)으로 embed 잡 1건. 문구는 합성
Deno.test("embed job with real deps: chunks + 512-dim vectors saved, decrypt audited, embed budget settled, rerun skipped", async () => {
  const item = await newItem("emb-real", "extracted");
  const deps = embedDeps(sb);
  const job: Job = { id: `${RUN}:embed-job`, kind: "embed", user_id: USER, payload: { item_id: item }, attempts: 1, checkpoint: null };
  try {
    assertEquals(await embedItem(deps, job), "embedded");
    const { data: chunks } = await sb.from("item_chunks").select("chunk_index, embedding").eq("item_id", item);
    assertEquals(chunks!.length, 1);
    assertEquals(JSON.parse(chunks![0].embedding as string).length, 512);
    const { count: audits } = await sb.from("audit_log").select("id", { count: "exact", head: true })
      .eq("user_id", USER).eq("action", "decrypt").eq("target", item);
    assertEquals(audits, 1);
    const { data: usage } = await sb.from("usage_counters").select("reserved_krw, backfill_reserved_krw").eq("user_id", USER).single();
    assert(Number(usage!.reserved_krw) > 0 && Number(usage!.backfill_reserved_krw) === 0);  // 새 항목 = 월 예산
    assertEquals(await embedItem(deps, job), "skipped");                                    // 재실행: 청크 있음 → 복호화·호출 없음
    const { data: q } = await sb.rpc("hybrid_search", { p_user: USER, p_query: "무선 이어폰",
      p_embedding: toPgVector((await embed(["무선 이어폰 주문"], "query"))[0]), p_limit: 5 });
    assert((q as { item_id: string; sem_sim: number | null }[]).some((r) => r.item_id === item && r.sem_sim !== null));
  } finally {
    await sb.from("items").delete().eq("user_id", USER).eq("id", item);
    await sb.from("audit_log").delete().eq("user_id", USER).eq("target", item);
    await sb.from("usage_counters").delete().eq("user_id", USER);
    await sb.from("llm_slots").delete().eq("user_id", USER);
  }
});
