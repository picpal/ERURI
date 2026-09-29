import { assert, assertEquals, assertNotEquals } from "jsr:@std/assert";
import { stub } from "jsr:@std/testing/mock";
import { __resetJWTCache, type ApnsEnv, apnsHost, apnsP8, defaultApnsEnv, makeJWT, normalizeP8, sendAPNs, sendWithEnvFallback } from "../functions/_shared/apns.ts";

const P8 = apnsP8();
const opts = { keyId: "ABC123DEFG", teamId: "6626BYCJG4", p8: P8 };
const b64urlDecode = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - s.length % 4) % 4)), (c) => c.charCodeAt(0));
const json = (s: string) => JSON.parse(new TextDecoder().decode(b64urlDecode(s)));

Deno.test("jwt header/claims", async () => {
  __resetJWTCache();
  const jwt = await makeJWT(opts);
  const [h, c] = jwt.split(".").slice(0, 2).map(json);
  assertEquals(h.alg, "ES256"); assertEquals(h.kid, "ABC123DEFG"); assertEquals(c.iss, "6626BYCJG4"); assert(typeof c.iat === "number");
});

Deno.test("jwt signature is a valid 64-byte ES256 (P1363) signature", async () => {
  __resetJWTCache();
  const jwt = await makeJWT(opts);
  const [h, c, s] = jwt.split(".");
  const sig = b64urlDecode(s);
  assertEquals(sig.length, 64);
  const pem = normalizeP8(P8).replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, "");
  const priv = await crypto.subtle.importKey("pkcs8", Uint8Array.from(atob(pem), (x) => x.charCodeAt(0)), { name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
  const { d: _d, key_ops: _k, ...pubJwk } = await crypto.subtle.exportKey("jwk", priv);
  const pub = await crypto.subtle.importKey("jwk", pubJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  assert(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, sig, new TextEncoder().encode(`${h}.${c}`)));
});

Deno.test("jwt cached within 20 minutes", async () => {
  __resetJWTCache();
  const a = await makeJWT(opts);
  const b = await makeJWT(opts);
  assertEquals(a, b);
});

Deno.test("jwt reused within a 30-min bucket, refreshed at the next (inside Apple's 20~60 min window)", async () => {
  __resetJWTCache();
  const t0 = 1_790_001_000;                                             // 30분 경계
  const a = await makeJWT(opts, t0);
  assertEquals(json(a.split(".")[1]).iat, t0);
  assertEquals(await makeJWT(opts, t0 + 20 * 60), a);
  assertEquals(await makeJWT(opts, t0 + 30 * 60 - 1), a);
  const b = await makeJWT(opts, t0 + 30 * 60);
  assertNotEquals(b, a);
  assertEquals(json(b.split(".")[1]).iat, t0 + 30 * 60);
});

Deno.test("iat is rounded down to the bucket, so separate isolates in the same bucket share iat", async () => {
  __resetJWTCache();
  const a = await makeJWT(opts, 1_790_001_000 + 125);
  __resetJWTCache();                                                    // 다른 isolate 흉내
  const b = await makeJWT(opts, 1_790_001_000 + 1_700);
  assertEquals(json(a.split(".")[1]).iat, 1_790_001_000);
  assertEquals(json(b.split(".")[1]).iat, 1_790_001_000);
});

Deno.test("concurrent callers share one in-flight JWT", async () => {
  __resetJWTCache();
  const all = await Promise.all(Array.from({ length: 10 }, () => makeJWT(opts)));
  assertEquals(new Set(all).size, 1);
});

Deno.test("p8 with literal \\n (one-line .env) is normalized", async () => {
  __resetJWTCache();
  const oneLine = normalizeP8(P8).trim().replace(/\n/g, "\\n");
  assert(oneLine.includes("\\n") && !oneLine.includes("\n"));
  assertEquals(normalizeP8(oneLine).trim(), normalizeP8(P8).trim());
  const jwt = await makeJWT({ ...opts, p8: oneLine });
  assertEquals(jwt.split(".").length, 3);
});

// PoC-4 서버 경로: 가짜 기기 토큰(64자 hex)이면 TLS·h2·JWT 인증을 모두 지난 뒤에만 400 BadDeviceToken이 온다.
// APNs는 HTTP/2만 받는다(HTTP/1.1이면 연결 단계에서 거부). 토큰 값은 출력하지 않는다.
Deno.test("live sandbox APNs: fake device token → 400 BadDeviceToken with apns-id", async () => {
  __resetJWTCache();
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");
  const t = performance.now();
  const r = await sendAPNs({ token, payload: { aps: { alert: "PoC-4 합성" } }, topic: Deno.env.get("APNS_TOPIC")! });
  const ms = Math.round(performance.now() - t);
  const t2 = performance.now();
  const r2 = await sendAPNs({ token, payload: { aps: { alert: "PoC-4 합성" } }, topic: Deno.env.get("APNS_TOPIC")! });
  const ms2 = Math.round(performance.now() - t2);
  console.log(JSON.stringify({ local_apns: { status: r.status, reason: r.reason, apns_id: !!r.apnsId, ms, warm_ms: ms2 } }));
  assertEquals(r.status, 400);
  assertEquals(r.reason, "BadDeviceToken");
  assert(r.apnsId);
  assertEquals(r2.status, 400);
});

// ── APNs 환경(sandbox/production) 선택과 불일치 재시도 ──────────────────

Deno.test("apnsHost and default env from APNS_ENV (invalid → sandbox)", () => {
  assertEquals(apnsHost("production"), "api.push.apple.com");
  assertEquals(apnsHost("sandbox"), "api.sandbox.push.apple.com");
  const prev = Deno.env.get("APNS_ENV");
  try {
    Deno.env.set("APNS_ENV", "production"); assertEquals(defaultApnsEnv(), "production");
    Deno.env.set("APNS_ENV", "bogus"); assertEquals(defaultApnsEnv(), "sandbox");
    Deno.env.delete("APNS_ENV"); assertEquals(defaultApnsEnv(), "sandbox");
  } finally {
    if (prev === undefined) Deno.env.delete("APNS_ENV"); else Deno.env.set("APNS_ENV", prev);
  }
});

Deno.test("env mismatch reasons retry once on the opposite environment, logged without the token", async () => {
  const token = "ab".repeat(32);
  for (const reason of ["BadDeviceToken", "BadEnvironmentToken"]) {
    const calls: string[] = [], lines: string[] = [];
    using _log = stub(console, "log", (...a: unknown[]) => { lines.push(a.map(String).join(" ")); });
    const send = async (o: { env: ApnsEnv }) => { calls.push(o.env); return o.env === "production" ? { status: 400, reason } : { status: 200, apnsId: "id-1" }; };
    const r = await sendWithEnvFallback(send, { token, payload: {}, topic: "t", env: "production" });
    assertEquals(calls, ["production", "sandbox"]);
    assertEquals([r.status, r.env, r.retried, r.firstReason], [200, "sandbox", true, reason]);
    assert(lines.some((l) => l.includes("env_retry")) && !lines.join("\n").includes(token));
  }
});

Deno.test("no retry on success or on other errors; the retry itself is not retried", async () => {
  // 403 BadEnvironmentKeyInToken = .p8 키 환경 문제(Sandbox 전용 키로 production 발송 등) → 재시도 없음
  for (const first of [{ status: 200 }, { status: 403, reason: "InvalidProviderToken" }, { status: 410, reason: "Unregistered" },
                       { status: 403, reason: "BadEnvironmentKeyInToken" }]) {
    const calls: string[] = [];
    const r = await sendWithEnvFallback(async (o) => { calls.push(o.env); return first; }, { token: "cd".repeat(32), payload: {}, topic: "t", env: "sandbox" });
    assertEquals([calls, r.retried, r.env], [["sandbox"], false, "sandbox"]);
  }
  const calls: string[] = [];
  const r = await sendWithEnvFallback(async (o) => { calls.push(o.env); return { status: 400, reason: "BadDeviceToken" }; }, { token: "ef".repeat(32), payload: {}, topic: "t", env: "sandbox" });
  assertEquals([calls, r.status, r.retried], [["sandbox", "production"], 400, true]);
});

Deno.test("sendAPNs: silent push sets apns-push-type background and priority 5; default stays alert/10", async () => {
  const seen: Headers[] = [];
  using _f = stub(globalThis, "fetch", async (_u: string | URL | Request, init?: RequestInit) => {
    seen.push(new Headers(init?.headers)); return new Response(null, { status: 200, headers: { "apns-id": "x" } });
  });
  __resetJWTCache();
  await sendAPNs({ token: "ab".repeat(32), payload: { aps: { "content-available": 1 } }, topic: "t", env: "sandbox", priority: 5, pushType: "background" });
  await sendAPNs({ token: "ab".repeat(32), payload: {}, topic: "t", env: "sandbox" });
  assertEquals(seen.map((h) => [h.get("apns-push-type"), h.get("apns-priority")]), [["background", "5"], ["alert", "10"]]);
});
