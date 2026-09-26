import { assert, assertEquals, assertNotEquals } from "jsr:@std/assert";
import { __resetJWTCache, makeJWT, normalizeP8, sendAPNs } from "../functions/_shared/apns.ts";

const P8 = Deno.env.get("APNS_P8")!;
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
