import { assertEquals } from "jsr:@std/assert";
import { encrypt, toBytea } from "../functions/_shared/crypto.ts";
import { deleteRunJobs, RUN, service as sb, testUser } from "./_testenv.ts";

// 모든 잡의 lease_key는 이 실행의 접두(RUN)를 달고, claim_jobs도 p_lease_prefix로 그 범위만 가져간다(실측 잡 보호)
const key = (s: string) => `${RUN}:${s}`;
const claim = (limit: number, lease?: number) =>
  sb.rpc("claim_jobs", { p_limit: limit, ...(lease === undefined ? {} : { p_lease_seconds: lease }), p_lease_prefix: RUN });

Deno.test("same lease_key never runs twice concurrently", async () => {
  await sb.from("jobs").insert([{ kind: "t", lease_key: key("u1") }, { kind: "t", lease_key: key("u1") }]);
  const a = await claim(10, 60);
  assertEquals(a.error, null);
  assertEquals(a.data!.length, 1);
  const b = await claim(10, 60);
  assertEquals(b.data!.length, 0);
  await deleteRunJobs();
});

Deno.test("expired lease is reclaimable and dead after 5 attempts", async () => {
  const { data } = await sb.from("jobs").insert({ kind: "t", lease_key: key("u2") }).select().single();
  for (let i = 0; i < 5; i++) {
    const c = await claim(1, 0);
    assertEquals(c.data!.length, 1);
    await sb.rpc("fail_job", { p_id: data!.id, p_error: "boom" });
  }
  const { data: j } = await sb.from("jobs").select().eq("id", data!.id).single();
  assertEquals(j!.status, "dead");
  await deleteRunJobs();
});

Deno.test("default lease is 180s: a job still running at 65s is not reclaimed", async () => {
  await sb.from("jobs").insert({ kind: "t", lease_key: key("u3") });
  const a = await claim(1);
  assertEquals(a.error, null);
  const j = a.data![0];
  assertEquals((Date.parse(j.leased_until) - Date.parse(j.updated_at)) / 1000, 180);
  // 임대 180초라 90초 잡의 65초 시점은 만료 전이다. 두 번째 클레임은 0건
  const b = await claim(10);
  assertEquals(b.data!.length, 0);
  await deleteRunJobs();
});

Deno.test("heartbeat_job extends a running lease and is false for finished jobs", async () => {
  await sb.from("jobs").insert({ kind: "t", lease_key: key("u4") });
  const { data: [j] } = await claim(1, 1);
  await new Promise((r) => setTimeout(r, 1500));                       // 임대 만료
  const hb = await sb.rpc("heartbeat_job", { p_id: j.id });
  assertEquals(hb.data, true);
  const again = await claim(10);
  assertEquals(again.data!.length, 0);                                  // 연장돼 재클레임 안 됨
  await sb.rpc("complete_job", { p_id: j.id, p_checkpoint: "done" });
  assertEquals((await sb.rpc("heartbeat_job", { p_id: j.id })).data, false);
  await deleteRunJobs();
});

Deno.test("insert_item stores ciphertext, enqueues process job, dedups by idempotency_key", async () => {
  const user = (await testUser()).id;
  const args = { p_user: user, p_source: "SHARE", p_idempotency_key: key(crypto.randomUUID()), p_sender: null, p_title: "합성",
    p_content_enc: toBytea(await encrypt(user, "합성 문구: 10월 2일 오후 3시 치과 예약")), p_occurred_at: new Date().toISOString() };
  const first = await sb.rpc("insert_item", args);
  const again = await sb.rpc("insert_item", args);
  assertEquals(typeof first.data, "string");
  assertEquals(again.data, null);
  // ingest 가 중복일 때 200 과 함께 돌려줄 기존 id: (user_id, idempotency_key) 조회(ingest/index.ts findItem 과 같은 쿼리)
  const found = await sb.from("items").select("id").eq("user_id", user).eq("idempotency_key", args.p_idempotency_key).maybeSingle();
  assertEquals(found.data?.id, first.data);
  const { data: jobs } = await sb.from("jobs").select("kind, user_id, payload").eq("lease_key", "item:" + first.data);
  assertEquals(jobs!.length, 1);
  assertEquals([jobs![0].kind, jobs![0].user_id, jobs![0].payload.item_id], ["process", user, first.data]);
  await sb.from("jobs").delete().eq("lease_key", "item:" + first.data);   // 항목만 지우면 워커가 not_found로 재시도한다
  await sb.from("items").delete().eq("id", first.data);
});

Deno.test("worker_get_item returns nothing for a mismatched user and audits only real reads", async () => {
  const user = (await testUser()).id;
  const { data: id } = await sb.rpc("insert_item", { p_user: user, p_source: "SHARE", p_idempotency_key: key(crypto.randomUUID()),
    p_sender: null, p_title: null, p_content_enc: toBytea(await encrypt(user, "합성")), p_occurred_at: new Date().toISOString(), p_enqueue: false });
  const other = await sb.rpc("worker_get_item", { p_user: crypto.randomUUID(), p_item: id });
  assertEquals(other.data!.length, 0);
  const mine = await sb.rpc("worker_get_item", { p_user: user, p_item: id });
  assertEquals(mine.data!.length, 1);
  const { count } = await sb.from("audit_log").select("*", { count: "exact", head: true }).eq("target", id).eq("action", "decrypt");
  assertEquals(count, 1);
  await sb.from("items").delete().eq("id", id);
});
