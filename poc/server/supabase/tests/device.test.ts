import { assert, assertEquals } from "jsr:@std/assert";
import { createClient } from "npm:@supabase/supabase-js@2";
import { SERVER_AUTH } from "../functions/_shared/crypto.ts";
import { type DeviceDeps, type DeviceRow, handleDevice, isDevicePath } from "../functions/ingest/device.ts";
import { type ApnsSendDeps, handleApnsSend } from "../functions/apns-send/handler.ts";
import { RUN, service, testUser } from "./_testenv.ts";

// ── 기기 등록 POST /functions/v1/ingest/device ──────────────────────

const TOKEN = "0a".repeat(32);
function deps(o: { user?: string | null } = {}) {
  const saved: { token: string; row: DeviceRow }[] = [];
  const d: DeviceDeps = {
    authUser: async (t) => (t === "good" ? (o.user === undefined ? "user-1" : o.user) : null),
    upsertDevice: async (token, row) => { saved.push({ token, row }); },
  };
  return { d, saved };
}
const req = (body: unknown, token: string | null = "good") => new Request("http://x/ingest/device", { method: "POST",
  body: JSON.stringify(body), headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) } });
const dev = (o: Record<string, unknown> = {}) => ({ device_id: "dev-1", apns_token: TOKEN.toUpperCase(), apns_env: "production", build: "1.0 (7)", ...o });

Deno.test("device path routing", () => {
  assertEquals(isDevicePath(new URL("https://x.supabase.co/functions/v1/ingest/device")), true);
  assertEquals(isDevicePath(new URL("https://x.supabase.co/functions/v1/ingest/trace")), false);
});

Deno.test("device: 401 without JWT, 200 upsert with caller id, lowercased token, env and build", async () => {
  const { d, saved } = deps();
  assertEquals((await handleDevice(req(dev(), null), d)).status, 401);
  assertEquals((await handleDevice(req(dev(), "bad"), d)).status, 401);
  const r = await handleDevice(req(dev()), d);
  assertEquals([r.status, await r.json()], [200, { device_id: "dev-1", apns_env: "production" }]);
  assertEquals(saved[0].token, "good");
  const { last_seen_at, ...row } = saved[0].row;
  assert(Date.parse(last_seen_at) > 0);
  assertEquals(row, { user_id: "user-1", device_id: "dev-1", apns_token: TOKEN, apns_env: "production", build: "1.0 (7)" });
});

Deno.test("device: 400 on bad token, env, device_id, build", async () => {
  const { d, saved } = deps();
  for (const [b, code] of [[dev({ apns_token: "xyz" }), "bad_apns_token"], [dev({ apns_env: "prod" }), "bad_apns_env"],
    [dev({ device_id: "" }), "bad_device_id"], [dev({ build: "x".repeat(65) }), "bad_build"], [[dev()], "bad_body"]] as const) {
    const r = await handleDevice(req(b), d);
    assertEquals([r.status, (await r.json()).error], [400, code]);
  }
  assertEquals(saved.length, 0);
});

// ── apns-send: 기기별 환경 사용 ─────────────────────────────────────

function sendDeps(o: { device?: { apns_token: string; apns_env: "sandbox" | "production" } | null } = {}) {
  const sent: { env: string; token: string }[] = [];
  const d: ApnsSendDeps = {
    isService: (r) => r.headers.get("authorization") === "Bearer secret",
    lookupDevice: async () => (o.device === undefined ? { apns_token: TOKEN, apns_env: "production" } : o.device),
    send: async (x) => { sent.push({ env: x.env, token: x.token }); return x.env === "production" ? { status: 200, apnsId: "a" } : { status: 400, reason: "BadDeviceToken" }; },
    defaultEnv: () => "sandbox",
    topic: () => "com.example.topic",
  };
  return { d, sent };
}
const sendReq = (body: unknown, auth = "Bearer secret") => new Request("http://x/apns-send", { method: "POST", body: JSON.stringify(body), headers: { authorization: auth } });

Deno.test("apns-send: device_id → stored token and env; token → body env or APNS_ENV default with mismatch retry", async () => {
  const a = sendDeps();
  assertEquals((await handleApnsSend(sendReq({ device_id: "dev-1", user_id: "u" }, "Bearer x"), a.d)).status, 403);
  const r1 = await (await handleApnsSend(sendReq({ device_id: "dev-1", user_id: "u", count: 2 }), a.d)).json();
  assertEquals([r1.ok, r1.env, r1.envRetries], [2, "production", 0]);
  assertEquals(a.sent.map((s) => s.env), ["production", "production"]);
  const b = sendDeps();
  const r2 = await (await handleApnsSend(sendReq({ token: TOKEN }), b.d)).json();       // 기본 sandbox → BadDeviceToken → production 재시도
  assertEquals([r2.ok, r2.env, r2.envRetries, r2.byEnv], [1, "sandbox", 1, { production: 1 }]);
  assertEquals(b.sent.map((s) => s.env), ["sandbox", "production"]);
  const c = sendDeps({ device: null });
  const r3 = await handleApnsSend(sendReq({ device_id: "nope", user_id: "u" }), c.d);
  assertEquals([r3.status, (await r3.json()).error], [404, "device_not_found"]);
  assertEquals((await handleApnsSend(sendReq({ token: TOKEN, env: "bogus" }), c.d)).status, 400);
});

// ── DB: RLS (전용 테스트 사용자) ──────────────────────────────────

Deno.test("devices RLS: a user upserts and reads only own device rows", async () => {
  const [t1, t2] = [await testUser(1), await testUser(2)];
  const user = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, SERVER_AUTH);
  assertEquals((await user.auth.signInWithPassword({ email: t1.email, password: t1.password })).error, null);
  const deviceId = `${RUN}:${crypto.randomUUID()}`;
  const row = (env: string) => ({ user_id: t1.id, device_id: deviceId, apns_token: TOKEN, apns_env: env, build: "t", last_seen_at: new Date().toISOString() });
  assertEquals((await user.from("devices").upsert(row("sandbox"), { onConflict: "user_id,device_id" })).error, null);
  assertEquals((await user.from("devices").upsert(row("production"), { onConflict: "user_id,device_id" })).error, null);
  const { data } = await user.from("devices").select("apns_env").eq("device_id", deviceId);
  assertEquals(data, [{ apns_env: "production" }]);                  // 같은 기기는 1행, 환경 갱신
  const other = await user.from("devices").insert({ ...row("sandbox"), user_id: t2.id });
  assertEquals(other.error?.code, "42501");
  await service.from("devices").delete().eq("device_id", deviceId);
  await user.auth.signOut();
});
