import { assertEquals } from "jsr:@std/assert";
import { createClient } from "npm:@supabase/supabase-js@2";
import { encrypt, SERVER_AUTH, toBytea } from "../functions/_shared/crypto.ts";
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, SERVER_AUTH);
const USER = Deno.env.get("POC_USER_ID")!;

Deno.test("same lease_key never runs twice concurrently", async () => {
  await sb.from("jobs").delete().neq("kind", "");
  await sb.from("jobs").insert([{ kind: "t", lease_key: "u1" }, { kind: "t", lease_key: "u1" }]);
  const a = await sb.rpc("claim_jobs", { p_limit: 10, p_lease_seconds: 60 });
  assertEquals(a.error, null);
  assertEquals(a.data!.length, 1);
  const b = await sb.rpc("claim_jobs", { p_limit: 10, p_lease_seconds: 60 });
  assertEquals(b.data!.length, 0);
});

Deno.test("expired lease is reclaimable and dead after 5 attempts", async () => {
  await sb.from("jobs").delete().neq("kind", "");
  const { data } = await sb.from("jobs").insert({ kind: "t", lease_key: "u2" }).select().single();
  for (let i = 0; i < 5; i++) {
    const c = await sb.rpc("claim_jobs", { p_limit: 1, p_lease_seconds: 0 });
    assertEquals(c.data!.length, 1);
    await sb.rpc("fail_job", { p_id: data!.id, p_error: "boom" });
  }
  const { data: j } = await sb.from("jobs").select().eq("id", data!.id).single();
  assertEquals(j!.status, "dead");
});

Deno.test("default lease is 180s: a job still running at 65s is not reclaimed", async () => {
  await sb.from("jobs").delete().neq("kind", "");
  await sb.from("jobs").insert({ kind: "t", lease_key: "u3" });
  const a = await sb.rpc("claim_jobs", { p_limit: 1 });
  assertEquals(a.error, null);
  const j = a.data![0];
  assertEquals((Date.parse(j.leased_until) - Date.parse(j.updated_at)) / 1000, 180);
  // 임대 180초라 90초 잡의 65초 시점은 만료 전이다. 두 번째 클레임은 0건
  const b = await sb.rpc("claim_jobs", { p_limit: 10 });
  assertEquals(b.data!.length, 0);
});

Deno.test("heartbeat_job extends a running lease and is false for finished jobs", async () => {
  await sb.from("jobs").delete().neq("kind", "");
  await sb.from("jobs").insert({ kind: "t", lease_key: "u4" });
  const { data: [j] } = await sb.rpc("claim_jobs", { p_limit: 1, p_lease_seconds: 1 });
  await new Promise((r) => setTimeout(r, 1500));                       // 임대 만료
  const hb = await sb.rpc("heartbeat_job", { p_id: j.id });
  assertEquals(hb.data, true);
  const again = await sb.rpc("claim_jobs", { p_limit: 10 });
  assertEquals(again.data!.length, 0);                                  // 연장돼 재클레임 안 됨
  await sb.rpc("complete_job", { p_id: j.id, p_checkpoint: "done" });
  assertEquals((await sb.rpc("heartbeat_job", { p_id: j.id })).data, false);
});

Deno.test("insert_item stores ciphertext, enqueues process job, dedups by idempotency_key", async () => {
  await sb.from("jobs").delete().neq("kind", "");
  const key = "test:" + crypto.randomUUID();
  const args = { p_user: USER, p_source: "SHARE", p_idempotency_key: key, p_sender: null, p_title: "합성",
    p_content_enc: toBytea(await encrypt(USER, "합성 문구: 10월 2일 오후 3시 치과 예약")), p_occurred_at: new Date().toISOString() };
  const first = await sb.rpc("insert_item", args);
  const again = await sb.rpc("insert_item", args);
  assertEquals(typeof first.data, "string");
  assertEquals(again.data, null);
  const { data: jobs } = await sb.from("jobs").select("kind, user_id, payload").eq("kind", "process");
  assertEquals(jobs!.length, 1);
  assertEquals(jobs![0].payload.item_id, first.data);
  await sb.from("jobs").delete().eq("payload->>item_id", first.data);   // 항목만 지우면 워커가 not_found로 재시도한다
  await sb.from("items").delete().eq("id", first.data);
});

Deno.test("worker_get_item returns nothing for a mismatched user and audits only real reads", async () => {
  const { data: id } = await sb.rpc("insert_item", { p_user: USER, p_source: "SHARE", p_idempotency_key: "test:" + crypto.randomUUID(),
    p_sender: null, p_title: null, p_content_enc: toBytea(await encrypt(USER, "합성")), p_occurred_at: new Date().toISOString(), p_enqueue: false });
  const other = await sb.rpc("worker_get_item", { p_user: crypto.randomUUID(), p_item: id });
  assertEquals(other.data!.length, 0);
  const mine = await sb.rpc("worker_get_item", { p_user: USER, p_item: id });
  assertEquals(mine.data!.length, 1);
  const { count } = await sb.from("audit_log").select("*", { count: "exact", head: true }).eq("target", id).eq("action", "decrypt");
  assertEquals(count, 1);
  await sb.from("items").delete().eq("id", id);
});
