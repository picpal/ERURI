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
    // 이 테스트의 두 항목만 본다 — 테스트 사용자에 다른 실행이 남긴 done embed 잡(항목 삭제 뒤)이 있어도 판정이 흔들리지 않게
    const { data: jobs } = await sb.from("jobs").select("lease_key, payload, priority").eq("user_id", USER).eq("kind", "embed")
      .in("payload->>item_id", [item, quarantined]);
    assertEquals(jobs, [{ lease_key: `${RUN}:backfill:${USER}`, payload: { item_id: item, backfill: true }, priority: 40 }]);
    assertEquals((await sb.rpc("enqueue_embed_backlog", { p_user: USER, p_limit: 10 })).data, 0);

    await sb.rpc("worker_save_chunks", { p_user: USER, p_item: item, p_chunks: [{ i: 0, text: "합성 주문\n합성상점 무선 이어폰 주문", embedding: vec(7) }] });
    const { data: again } = await sb.rpc("worker_get_embed_source", { p_user: USER, p_item: item });
    assertEquals((again as unknown[]).length, 0);                                           // 이미 청크 있음 → 재실행은 건너뜀
    const { data: byVec } = await sb.rpc("hybrid_search", { p_user: USER, p_query: "아무말", p_embedding: vec(7), p_limit: 5 });
    const { data: byKw } = await sb.rpc("hybrid_search", { p_user: USER, p_query: "이어폰 어디서 샀지", p_embedding: null, p_limit: 5 });
    assert((byVec as { item_id: string }[]).some((r) => r.item_id === item));
    assert((byKw as { item_id: string }[]).some((r) => r.item_id === item));

    // 같은 항목의 save 두 번이 겹쳐도(실시간 embed:<id> + 백로그) 청크는 한 벌(0016 for update)
    const two = [{ i: 0, text: "합성 주문", embedding: vec(3) }, { i: 1, text: "합성상점", embedding: vec(4) }];
    await Promise.all([1, 2, 3].map(() => sb.rpc("worker_save_chunks", { p_user: USER, p_item: item, p_chunks: two })));
    const { count: once } = await sb.from("item_chunks").select("id", { count: "exact", head: true }).eq("item_id", item);
    assertEquals(once, 2);

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
    await sb.from("usage_ledger").delete().eq("user_id", USER);
    await sb.from("llm_slots").delete().eq("user_id", USER);
  }
});

// Ruling E: 백필 예산이 다 쓰인 달에도 백필 레인의 embed 잡은 미뤄지지 않고 월 예산으로 청크를 만든다(검색 인덱스 공백 방지)
Deno.test("embed backfill-lane job with the backfill budget exhausted: embedded on the monthly budget", async () => {
  const item = await newItem("emb-bf", "extracted");
  const deps = embedDeps(sb);
  const job: Job = { id: `${RUN}:embed-bf-job`, kind: "embed", user_id: USER, payload: { item_id: item, backfill: true }, attempts: 1, checkpoint: null };
  try {
    assert((await sb.rpc("reserve_usage", { p_user: USER, p_kind: "backfill", p_est_krw: 1500 })).data !== "refused");   // 백필 예산 소진
    assertEquals((await sb.rpc("reserve_usage", { p_user: USER, p_kind: "backfill", p_est_krw: 0.01 })).data, "refused");
    assertEquals(await embedItem(deps, job), "embedded");
    const { count } = await sb.from("item_chunks").select("id", { count: "exact", head: true }).eq("item_id", item);
    assertEquals(count, 1);
    const { data: usage } = await sb.from("usage_counters").select("reserved_krw, backfill_reserved_krw").eq("user_id", USER).single();
    assert(Number(usage!.reserved_krw) > 0);
    assertEquals(Number(usage!.backfill_reserved_krw), 1500);
  } finally {
    await sb.from("items").delete().eq("user_id", USER).eq("id", item);
    await sb.from("audit_log").delete().eq("user_id", USER).eq("target", item);
    await sb.from("usage_counters").delete().eq("user_id", USER);
    await sb.from("usage_ledger").delete().eq("user_id", USER);
    await sb.from("llm_slots").delete().eq("user_id", USER);
  }
});

// 배포 워커(cron 매분): 새 알림 항목 → process(추출·저장) → embed 잡 → 청크. 실측 게이트 "새 항목 5분 안에 embedded"의 서버 쪽 대체(기기 수집 제외)
Deno.test({ name: "deployed worker: new item gets chunks with vectors within 5 minutes (process → embed)", ignore: Deno.env.get("DEPLOYED") !== "1", fn: async () => {
  const t0 = Date.now();
  const { data: item } = await sb.rpc("insert_item", { p_user: USER, p_source: "NOTIFICATION", p_idempotency_key: `${RUN}:emb-deployed`, p_sender: null,
    p_title: null, p_content_enc: toBytea(await encrypt(USER, "[합성의원] 모레 오후 3시 진료 예약이 확정되었습니다.")), p_occurred_at: new Date().toISOString() });
  try {
    let jobs: { kind: string; status: string; checkpoint: string | null }[] = [];
    for (let t = 0; t < 300 && !jobs.some((j) => j.kind === "embed" && j.status === "done"); t += 10) {
      await new Promise((r) => setTimeout(r, 10_000));
      jobs = (await sb.from("jobs").select("kind, status, checkpoint").eq("user_id", USER).eq("payload->>item_id", item as string)).data ?? [];
    }
    const secs = Math.round((Date.now() - t0) / 1000);
    console.log(JSON.stringify({ item, secs, jobs }));
    assert(jobs.some((j) => j.kind === "embed" && j.status === "done" && j.checkpoint === "embedded"));
    const { data: chunks } = await sb.from("item_chunks").select("id").eq("item_id", item as string).not("embedding", "is", null);
    assert(chunks!.length >= 1);
  } finally {
    const { data: props } = await sb.from("proposals").select("id, facts!inner(item_id)").eq("facts.item_id", item as string);
    const proposalIds = (props ?? []).map((p) => p.id as string);
    await sb.from("jobs").delete().eq("user_id", USER).eq("payload->>item_id", item as string);
    if (proposalIds.length) await sb.from("jobs").delete().eq("user_id", USER).eq("kind", "notify").in("payload->>proposal_id", proposalIds);
    await sb.from("facts").delete().eq("user_id", USER).eq("item_id", item as string);
    await sb.from("items").delete().eq("user_id", USER).eq("id", item as string);
    await sb.from("audit_log").delete().eq("user_id", USER).eq("action", "decrypt").eq("target", item as string);
    await sb.from("usage_counters").delete().eq("user_id", USER);
    await sb.from("usage_ledger").delete().eq("user_id", USER);
    await sb.from("llm_slots").delete().eq("user_id", USER);
  }
} });
