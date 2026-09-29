import { assert, assertEquals } from "jsr:@std/assert";
import { createClient } from "npm:@supabase/supabase-js@2";
import { SERVER_AUTH } from "../functions/_shared/crypto.ts";
import { RUN, service, testUser } from "./_testenv.ts";
import { handleTrace, isTracePath, MAX_TRACES, touchDevices, type TraceDeps, type TraceRow, upsertTraces } from "../functions/ingest/trace.ts";

// ── 순수: 허용·거부 경로 ────────────────────────────────────────────

function deps(o: { user?: string | null; fresh?: number; touchFails?: boolean } = {}) {
  const inserted: { token: string; rows: TraceRow[] }[] = [], touched: { token: string; ids: string[] }[] = [];
  const d: TraceDeps = {
    authUser: async (t) => (t === "good" ? (o.user === undefined ? "user-1" : o.user) : null),
    insertTraces: async (token, rows) => { inserted.push({ token, rows }); return o.fresh ?? rows.length; },
    touchDevices: async (token, ids) => { if (o.touchFails) throw new Error("devices touch 500"); touched.push({ token, ids }); },
  };
  return { d, inserted, touched };
}
const req = (body: unknown, token: string | null = "good", raw?: string) => new Request("http://x/ingest/trace", {
  method: "POST", body: raw ?? JSON.stringify(body),
  headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
});
const ev = (o: Record<string, unknown> = {}) => ({ device_id: "dev-1", event: "capture.intent_fired",
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
  const r = await handleTrace(req([ev(), ev({ event: "action.handled", at: 780000000, fields: undefined })]), d);
  assertEquals(r.status, 202);
  assertEquals(await r.json(), { inserted: 2, duplicates: 0 });
  assertEquals(inserted[0].token, "good");                             // 사용자 JWT로 삽입(RLS)
  const [a, b] = inserted[0].rows;
  assertEquals(a, { user_id: "user-1", device_id: "dev-1", event: "capture.intent_fired",
    fields: { locked: true, bg: false, source: "NOTIFICATION", elapsed_ms: 12, text_len: 48, text_sha8: "a1b2c3d4" }, at: "2026-09-27T00:00:00.000Z" });
  assertEquals([b.event, b.fields, b.at], ["action.handled", {}, "2025-09-19T18:40:00.000Z"]);   // Swift 기준 초
});

Deno.test("202 refreshes devices.last_seen_at once per distinct device_id with the caller's token; touch failure does not fail the upload", async () => {
  const { d, touched } = deps();
  await handleTrace(req([ev(), ev({ event: "upload.wake" }), ev({ device_id: "dev-2" })]), d);
  assertEquals(touched, [{ token: "good", ids: ["dev-1", "dev-2"] }]);
  const bad = deps({ touchFails: true });
  assertEquals((await handleTrace(req([ev()]), bad.d)).status, 202);
  const none = deps();
  await handleTrace(req([ev({ event: "BAD" })]), none.d);
  assertEquals(none.touched, []);
});

Deno.test("202 reports duplicates the store ignored", async () => {
  const { d } = deps({ fresh: 1 });
  const r = await handleTrace(req([ev(), ev({ at: "2026-09-27T09:00:01+09:00" })]), d);
  assertEquals([r.status, await r.json()], [202, { inserted: 1, duplicates: 1 }]);
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

Deno.test("event names: product namespaces only; PoC names and unknown namespaces → 400 bad_event", async () => {
  for (const event of ["capture.intent_fired", "device.registered", "action.handled", "share.received", "upload.done", "upload.wake"]) {
    const { d } = deps();
    assertEquals((await handleTrace(req([ev({ event })]), d)).status, 202, event);
  }
  for (const event of ["poc1.intent_fired", "poc9.upload_done", "misc.thing", "capture", "Capture.x"]) {
    const { d, inserted } = deps();
    const r = await handleTrace(req([ev({ event })]), d);
    assertEquals([r.status, (await r.json()).error, inserted.length], [400, "bad_event", 0], event);
  }
});

// ── DB: RLS (호스팅, db push 후) ──────────────────────────────────

const URL_ = Deno.env.get("SUPABASE_URL")!;

Deno.test("RLS: a user inserts and reads only own device_traces rows; anon can do neither", async () => {
  const user = createClient(URL_, Deno.env.get("SUPABASE_ANON_KEY")!, SERVER_AUTH);
  const [t1, t2] = [await testUser(1), await testUser(2)];            // 전용 테스트 사용자 두 명(실측 사용자 미사용)
  const { error: se } = await user.auth.signInWithPassword({ email: t1.email, password: t1.password });
  assertEquals(se, null);
  const me = t1.id;
  const dev = `${RUN}:${crypto.randomUUID()}`;
  const own = await user.from("device_traces").insert({ user_id: me, device_id: dev, event: "capture.test", fields: { n: 1 }, at: new Date().toISOString() });
  assertEquals(own.error, null);
  const other = await user.from("device_traces").insert({ user_id: t2.id, device_id: dev, event: "capture.test", fields: {}, at: new Date().toISOString() });
  assertEquals(other.error?.code, "42501");                            // RLS 위반
  // 다른 사용자 행(service로 삽입)은 보이지 않는다
  await service.from("device_traces").insert({ user_id: t2.id, device_id: dev, event: "capture.test", fields: {}, at: new Date().toISOString() });
  const { data: seen } = await user.from("device_traces").select("user_id, event").eq("device_id", dev);
  assertEquals(seen, [{ user_id: me, event: "capture.test" }]);
  const anon = createClient(URL_, Deno.env.get("SUPABASE_ANON_KEY")!, SERVER_AUTH);
  const anonIns = await anon.from("device_traces").insert({ user_id: me, device_id: dev, event: "capture.test", fields: {}, at: new Date().toISOString() });
  assert(anonIns.error !== null);
  const { data: anonSeen } = await anon.from("device_traces").select("id").eq("device_id", dev);
  assertEquals(anonSeen ?? [], []);
  await service.from("device_traces").delete().eq("device_id", dev);
  await user.auth.signOut();
});

Deno.test("DB: same (device_id, event, at) twice → stored once; second upload inserts 0", async () => {
  const user = createClient(URL_, Deno.env.get("SUPABASE_ANON_KEY")!, SERVER_AUTH);
  const t1 = await testUser(1);
  assertEquals((await user.auth.signInWithPassword({ email: t1.email, password: t1.password })).error, null);
  const dev = `${RUN}:${crypto.randomUUID()}`;
  const rows: TraceRow[] = [
    { user_id: t1.id, device_id: dev, event: "upload.done", fields: { ok: true }, at: "2026-09-29T02:26:41.123Z" },
    { user_id: t1.id, device_id: dev, event: "upload.wake", fields: {}, at: "2026-09-29T02:22:03.000Z" },
  ];
  try {
    assertEquals(await upsertTraces(user, rows), 2);
    assertEquals(await upsertTraces(user, rows), 0);
    const { count } = await service.from("device_traces").select("id", { count: "exact", head: true }).eq("device_id", dev);
    assertEquals(count, 2);
  } finally {
    await service.from("device_traces").delete().eq("device_id", dev);
    await user.auth.signOut();
  }
});

Deno.test("DB: touchDevices bumps last_seen_at of the caller's own device only (RLS)", async () => {
  const user = createClient(URL_, Deno.env.get("SUPABASE_ANON_KEY")!, SERVER_AUTH);
  const [t1, t2] = [await testUser(1), await testUser(2)];
  assertEquals((await user.auth.signInWithPassword({ email: t1.email, password: t1.password })).error, null);
  const dev = `${RUN}:${crypto.randomUUID()}`, old = "2026-01-01T00:00:00.000Z";
  await service.from("devices").insert([
    { user_id: t1.id, device_id: dev, apns_token: "a".repeat(64), apns_env: "production", last_seen_at: old },
    { user_id: t2.id, device_id: dev, apns_token: "b".repeat(64), apns_env: "production", last_seen_at: old },
  ]);
  try {
    await touchDevices(user, [dev]);
    const { data } = await service.from("devices").select("user_id, last_seen_at").eq("device_id", dev);
    const at = Object.fromEntries(data!.map((r) => [r.user_id, Date.parse(r.last_seen_at)]));
    assert(at[t1.id] > Date.now() - 60_000);
    assertEquals(at[t2.id], Date.parse(old));
  } finally {
    await service.from("devices").delete().in("user_id", [t1.id, t2.id]).eq("device_id", dev);
    await user.auth.signOut();
  }
});
