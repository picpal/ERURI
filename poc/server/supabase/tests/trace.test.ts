import { assert, assertEquals } from "jsr:@std/assert";
import { createClient } from "npm:@supabase/supabase-js@2";
import { SERVER_AUTH } from "../functions/_shared/crypto.ts";
import { handleTrace, isTracePath, MAX_TRACES, type TraceDeps, type TraceRow } from "../functions/ingest/trace.ts";

// ── 순수: 허용·거부 경로 ────────────────────────────────────────────

function deps(o: { user?: string | null } = {}) {
  const inserted: { token: string; rows: TraceRow[] }[] = [];
  const d: TraceDeps = {
    authUser: async (t) => (t === "good" ? (o.user === undefined ? "user-1" : o.user) : null),
    insertTraces: async (token, rows) => { inserted.push({ token, rows }); },
  };
  return { d, inserted };
}
const req = (body: unknown, token: string | null = "good", raw?: string) => new Request("http://x/ingest/trace", {
  method: "POST", body: raw ?? JSON.stringify(body),
  headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
});
const ev = (o: Record<string, unknown> = {}) => ({ device_id: "dev-1", event: "poc1.intent_fired",
  fields: { locked: true, bg: false, source: "NOTIFICATION", elapsed_ms: 12, text_len: 48, text_sha8: "a1b2c3d4" },
  at: "2026-09-27T09:00:00+09:00", ...o });

Deno.test("trace path routing: /ingest/trace only", () => {
  assertEquals(isTracePath(new URL("https://x.supabase.co/functions/v1/ingest/trace")), true);
  assertEquals(isTracePath(new URL("http://localhost/ingest/trace")), true);
  assertEquals(isTracePath(new URL("https://x.supabase.co/functions/v1/ingest")), false);
});

Deno.test("401 without or with invalid JWT, nothing stored", async () => {
  const { d, inserted } = deps();
  assertEquals((await handleTrace(req([ev()], null), d)).status, 401);
  assertEquals((await handleTrace(req([ev()], "bad"), d)).status, 401);
  assertEquals(inserted.length, 0);
});

Deno.test("202 stores a batch with the caller's user_id, the caller's token, and normalized time", async () => {
  const { d, inserted } = deps();
  const r = await handleTrace(req([ev(), ev({ event: "poc5.action_handled", at: 780000000, fields: undefined })]), d);
  assertEquals(r.status, 202);
  assertEquals(await r.json(), { inserted: 2 });
  assertEquals(inserted[0].token, "good");                             // 사용자 JWT로 삽입(RLS)
  const [a, b] = inserted[0].rows;
  assertEquals(a, { user_id: "user-1", device_id: "dev-1", event: "poc1.intent_fired",
    fields: { locked: true, bg: false, source: "NOTIFICATION", elapsed_ms: 12, text_len: 48, text_sha8: "a1b2c3d4" }, at: "2026-09-27T00:00:00.000Z" });
  assertEquals([b.event, b.fields, b.at], ["poc5.action_handled", {}, "2025-09-19T18:40:00.000Z"]);   // Swift 기준 초
});

Deno.test("string values longer than 200 chars are truncated (nested too); other types kept", async () => {
  const { d, inserted } = deps();
  const long = "가".repeat(250);
  const r = await handleTrace(req([ev({ fields: { note: long, nested: { reason: long, n: 3 }, list: [long, 1], ok: "짧음" } })]), d);
  assertEquals(r.status, 202);
  const f = inserted[0].rows[0].fields as Record<string, any>;
  assertEquals([f.note.length, f.nested.reason.length, f.list[0].length, f.nested.n, f.list[1], f.ok], [200, 200, 200, 3, 1, "짧음"]);
});

Deno.test("fields with content/text/body keys (any depth, any case) → 400, nothing stored", async () => {
  const { d, inserted } = deps();
  for (const fields of [{ text: "본문" }, { Content: "x" }, { meta: { body: "x" } }, { list: [{ TEXT: "x" }] }]) {
    const r = await handleTrace(req([ev(), ev({ fields })]), d);
    assertEquals(r.status, 400);
    const j = await r.json();
    assertEquals([j.error, j.index], ["forbidden_field", 1]);
  }
  assertEquals(inserted.length, 0);
  // text_len·text_sha8처럼 이름이 다른 키는 허용
  assertEquals((await handleTrace(req([ev({ fields: { text_len: 3, text_sha8: "00ff00ff", body_len: 0 } })]), d)).status, 202);
});

Deno.test("bad batches → 400: not an array, empty, over the limit, bad event name, bad device_id, bad at, fields not an object", async () => {
  const { d, inserted } = deps();
  const cases: [unknown, string][] = [
    [ev(), "not_array"],
    [[], "empty"],
    [Array.from({ length: MAX_TRACES + 1 }, () => ev()), "too_many"],
    [[ev({ event: "intent_fired" })], "bad_event"],
    [[ev({ event: "POC1.Intent" })], "bad_event"],
    [[ev({ device_id: "" })], "bad_device_id"],
    [[ev({ at: "nope" })], "bad_at"],
    [[ev({ fields: [1, 2] })], "bad_fields"],
    [[ev({ fields: "x" })], "bad_fields"],
  ];
  for (const [body, code] of cases) {
    const r = await handleTrace(req(body), d);
    assertEquals([r.status, (await r.json()).error], [400, code], code);
  }
  assertEquals((await handleTrace(req(null, "good", "{not json"), d)).status, 400);
  assertEquals(inserted.length, 0);
  assertEquals((await handleTrace(req(Array.from({ length: MAX_TRACES }, () => ev())), d)).status, 202);   // 200건은 허용
});

// ── DB: RLS (호스팅, db push 후) ──────────────────────────────────

const URL_ = Deno.env.get("SUPABASE_URL")!;
const service = createClient(URL_, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, SERVER_AUTH);

Deno.test("RLS: a user inserts and reads only own poc_traces rows; anon can do neither", async () => {
  const user = createClient(URL_, Deno.env.get("SUPABASE_ANON_KEY")!, SERVER_AUTH);
  const { error: se } = await user.auth.signInWithPassword({ email: "poc-user@example.com", password: Deno.env.get("POC_USER_PASSWORD")! });
  assertEquals(se, null);
  const me = Deno.env.get("POC_USER_ID")!;
  const dev = "test-" + crypto.randomUUID();
  const own = await user.from("poc_traces").insert({ user_id: me, device_id: dev, event: "poc0.test", fields: { n: 1 }, at: new Date().toISOString() });
  assertEquals(own.error, null);
  const other = await user.from("poc_traces").insert({ user_id: crypto.randomUUID(), device_id: dev, event: "poc0.test", fields: {}, at: new Date().toISOString() });
  assertEquals(other.error?.code, "42501");                            // RLS 위반
  const { data: seen } = await user.from("poc_traces").select("user_id, event").eq("device_id", dev);
  assertEquals(seen, [{ user_id: me, event: "poc0.test" }]);
  // 다른 사용자 행(service로 삽입)은 보이지 않는다
  const { data: authUsers } = await service.auth.admin.listUsers();
  const someoneElse = authUsers.users.find((u) => u.id !== me);
  if (someoneElse) {
    await service.from("poc_traces").insert({ user_id: someoneElse.id, device_id: dev, event: "poc0.test", fields: {}, at: new Date().toISOString() });
    const { data: again } = await user.from("poc_traces").select("user_id").eq("device_id", dev);
    assert(again!.every((r) => r.user_id === me));
  }
  const anon = createClient(URL_, Deno.env.get("SUPABASE_ANON_KEY")!, SERVER_AUTH);
  const anonIns = await anon.from("poc_traces").insert({ user_id: me, device_id: dev, event: "poc0.test", fields: {}, at: new Date().toISOString() });
  assert(anonIns.error !== null);
  const { data: anonSeen } = await anon.from("poc_traces").select("id").eq("device_id", dev);
  assertEquals(anonSeen ?? [], []);
  await service.from("poc_traces").delete().eq("device_id", dev);
  await user.auth.signOut();
});
