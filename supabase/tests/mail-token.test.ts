import { assertEquals, assertRejects } from "jsr:@std/assert";
import { importTokenKey, signToken, TOKEN_TTL_S, verifyToken } from "../functions/_shared/mail-token.ts";

const KEY = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => i + 1)));
const OTHER = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => 255 - i)));
const C = { u: "11111111-1111-4111-8111-111111111111", c: "22222222-2222-4222-8222-222222222222", m: "18c2f0a1b2c3d4e5", e: 1_791_299_400 };

Deno.test("signToken/verifyToken: round trip v1.<payload>.<hmac>; TTL constant is 10 minutes", async () => {
  const k = await importTokenKey(KEY);
  const t = await signToken(k, C);
  assertEquals(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(t), true);
  assertEquals(await verifyToken(k, t, C.e - 1), { ok: true, claims: C });
  assertEquals(TOKEN_TTL_S, 600);
});
Deno.test("verifyToken: tampered payload or a different key → not_found (404); expired → token_expired (410)", async () => {
  const k = await importTokenKey(KEY);
  const t = await signToken(k, C);
  const [v, , sig] = t.split(".");
  const forged = `${v}.${btoa(JSON.stringify({ ...C, m: "ffffffffffffffff" })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}.${sig}`;
  assertEquals(await verifyToken(k, forged, C.e - 1), { ok: false, code: "not_found" });
  assertEquals(await verifyToken(await importTokenKey(OTHER), t, C.e - 1), { ok: false, code: "not_found" });
  assertEquals(await verifyToken(k, t, C.e), { ok: false, code: "token_expired" });
});
Deno.test("verifyToken: malformed strings → bad_token (400): wrong version, missing parts, over 512 chars, non-string, bad signature length", async () => {
  const k = await importTokenKey(KEY);
  for (const t of ["", "v2.a.b", "v1.abc", "v1." + "a".repeat(600) + "." + "b".repeat(43), "v1.abc.short", 42, null]) {
    assertEquals(await verifyToken(k, t as string, 0), { ok: false, code: "bad_token" }, String(t).slice(0, 20));
  }
});
// 서명은 맞는데 내용이 claims 모양이 아니면(키를 가진 쪽만 만들 수 있음) bad_token
Deno.test("verifyToken: a correctly signed payload that is not claims-shaped → bad_token", async () => {
  const k = await importTokenKey(KEY);
  const bad = await signToken(k, { ...C, u: "not-a-uuid" });
  assertEquals(await verifyToken(k, bad, 0), { ok: false, code: "bad_token" });
});
Deno.test("importTokenKey: anything but base64 of exactly 32 bytes throws key_invalid", async () => {
  await assertRejects(() => importTokenKey(""), Error, "key_invalid");
  await assertRejects(() => importTokenKey(btoa("short")), Error, "key_invalid");
  await assertRejects(() => importTokenKey("%%%"), Error, "key_invalid");
});
