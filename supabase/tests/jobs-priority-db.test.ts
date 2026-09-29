import { assert, assertEquals } from "jsr:@std/assert";
import { encrypt, toBytea } from "../functions/_shared/crypto.ts";
import { deleteRunJobs, RUN, service as sb, testUser } from "./_testenv.ts";

// 호스팅 DB. 실행 태그 lease_key 만 claim 한다(p_lease_prefix = RUN) — 워커 cron 은 test: 잡을 가져가지 않는다(AGENTS.md §7)
const USER = (await testUser()).id;
async function enq(kind: string, key: string, payload: Record<string, unknown> = {}): Promise<string> {
  const { data, error } = await sb.rpc("enqueue_job", { p_user: USER, p_kind: kind, p_lease_key: key, p_payload: payload });
  assertEquals(error, null);
  return data as string;
}
const claim = async (limit = 10) =>
  ((await sb.rpc("claim_jobs", { p_limit: limit, p_lease_seconds: 180, p_lease_prefix: RUN })).data as { id: string; priority: number; claimed_at: string }[]);

// Review Focus 1: 백필이 새 메일 sync·제안 notify 를 굶기지 않는다
Deno.test("claim order: notify > gmail-sync > process > backfill; backfill one per user; sync not blocked by a running backfill", async () => {
  try {
    const bf1 = await enq("gmail-fetch", `${RUN}:backfill:${USER}`, { backfill: true });
    const bf2 = await enq("process", `${RUN}:backfill:${USER}`, { backfill: true });
    const proc = await enq("process", `${RUN}:item:1`);
    const sync = await enq("gmail-sync", `${RUN}:gmail:c1`);
    const notify = await enq("notify", `${RUN}:notify:p1`);
    const { data: pr } = await sb.from("jobs").select("id, priority").in("id", [bf1, bf2, proc, sync, notify]);
    const prio = new Map(pr!.map((r) => [r.id, r.priority]));
    assertEquals([prio.get(notify), prio.get(sync), prio.get(proc), prio.get(bf1), prio.get(bf2)], [10, 20, 30, 40, 40]);
    const first = await claim();
    assertEquals(first.map((j) => j.id), [notify, sync, proc, bf1]);          // 같은 백필 키는 한 번에 1개
    assert(first.every((j) => j.claimed_at !== null));
    const sync2 = await enq("gmail-sync", `${RUN}:gmail:c2`);                 // 백필(bf1)이 도는 중에 온 새 sync
    const second = await claim();
    assertEquals(second.map((j) => j.id), [sync2]);                           // bf2 는 bf1 이 끝날 때까지 대기
    await sb.rpc("complete_job", { p_id: bf1, p_checkpoint: "fetched" });
    assertEquals((await claim()).map((j) => j.id), [bf2]);
  } finally {
    await deleteRunJobs();
  }
});

Deno.test("insert_item p_backfill: process job goes to the backfill lane (lease backfill:<user>, priority 40)", async () => {
  const { data: item } = await sb.rpc("insert_item", { p_user: USER, p_source: "GMAIL", p_idempotency_key: `${RUN}:bf-item`,
    p_sender: null, p_title: null, p_content_enc: toBytea(await encrypt(USER, "합성 메일")), p_occurred_at: "2026-08-01T00:00:00Z",
    p_backfill: true });
  try {
    const { data: jobs } = await sb.from("jobs").select("lease_key, priority, payload").eq("user_id", USER).eq("payload->>item_id", item as string);
    assertEquals(jobs!.map((j) => [j.lease_key, j.priority, j.payload.backfill]), [[`backfill:${USER}`, 40, true]]);
  } finally {
    await sb.from("jobs").delete().eq("user_id", USER).eq("payload->>item_id", item as string);
    await sb.from("items").delete().eq("user_id", USER).eq("id", item as string);
  }
});

// Review Focus 2: 재인증 공백 — 재연결하면 active·만료 갱신, 이미 저장한 메일은 백필 재적재에서 새 잡을 만들지 않는다
Deno.test("reconnect after reauth_required: active again, expires_at renewed, duplicate backfill items create no jobs", async () => {
  const account = `${RUN}-re-${crypto.randomUUID()}@example.com`;
  const { data: id } = await sb.rpc("gmail_save_connection", { p_user: USER, p_account_ref: account, p_refresh_token: "synthetic-rt-1", p_history_id: "100" });
  const itemArgs = { p_user: USER, p_source: "GMAIL", p_idempotency_key: `${RUN}:gmail:m1`, p_sender: null, p_title: null,
    p_content_enc: toBytea(await encrypt(USER, "합성 메일")), p_occurred_at: new Date().toISOString() };
  const { data: item } = await sb.rpc("insert_item", { ...itemArgs, p_enqueue: false });
  try {
    await sb.rpc("gmail_update", { p_user: USER, p_connection: id, p_status: "reauth_required" });
    await sb.from("connections").update({ expires_at: new Date(Date.now() - 86_400_000).toISOString() }).eq("id", id);
    await sb.rpc("gmail_save_connection", { p_user: USER, p_account_ref: account, p_refresh_token: "synthetic-rt-2", p_history_id: "200" });
    const { data: c } = await sb.from("connections").select("status, expires_at").eq("id", id).single();
    assertEquals(c!.status, "active");
    assert(Date.parse(c!.expires_at) > Date.now() + 6.9 * 86_400_000);
    const again = await sb.rpc("insert_item", { ...itemArgs, p_backfill: true });
    assertEquals(again.data, null);                                            // 중복 → 잡 없음
    const { count } = await sb.from("jobs").select("id", { count: "exact", head: true }).eq("user_id", USER).eq("payload->>item_id", item as string);
    assertEquals(count, 0);
  } finally {
    await sb.from("items").delete().eq("user_id", USER).eq("id", item as string);
    await sb.from("jobs").delete().eq("user_id", USER).like("lease_key", `%${id}`);
    await sb.from("connections").delete().eq("id", id);
  }
});

Deno.test("add_extract_tokens: backfill tokens counted apart from the monthly extract tokens", async () => {
  try {
    await sb.rpc("add_extract_tokens", { p_user: USER, p_tokens: 100 });
    await sb.rpc("add_extract_tokens", { p_user: USER, p_tokens: 40, p_backfill: true });
    const { data } = await sb.from("usage_counters").select("extract_tokens, backfill_tokens").eq("user_id", USER);
    assertEquals(data, [{ extract_tokens: 100, backfill_tokens: 40 }]);
  } finally {
    await sb.from("usage_counters").delete().eq("user_id", USER);
  }
});
