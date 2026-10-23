import { assert, assertEquals, assertRejects } from "jsr:@std/assert";
import {
  conditionPrint, CURSOR_MAX, type CursorClaims, importTokenKey, signCursor, signToken, TOKEN_TTL_S, verifyCursor, verifyToken,
} from "../functions/_shared/mail-token.ts";
import type { ReadConditions } from "../functions/_shared/mail-query.ts";

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

// ── 0.19.0 진행 위치 커서 c1.(DP4) — 상수는 위 KEY·C 를 쓴다(PF-4) ──
const KEY_B64 = KEY, USER = C.u, CONN = C.c, NOW_S = C.e - 3_600;
const CUR: CursorClaims = { u: USER, c: CONN, h: "0123456789abcdef0123456789abcdef", b: null, p: "17283", o: 7, l: "18f0a1b2c3d4e5f6", t: 1792040400000, s: ["18f0a1b2c3d4e5f6"], e: NOW_S + 600 };
Deno.test("cursor: sign → verify round trip; c1. prefix; ≤ 1024 chars; start, time-fallback (b set, no anchor yet) and page-end (o 20) shapes", async () => {
  const k = await importTokenKey(KEY_B64), s = await signCursor(k, CUR);
  assert(s.startsWith("c1.") && s.length <= CURSOR_MAX);
  assertEquals(await verifyCursor(k, s, NOW_S), { ok: true, claims: CUR });
  for (const x of [{ ...CUR, p: null, l: null, o: 0, t: null, s: [] }, { ...CUR, b: 1792040401, p: null, o: 0, l: null }, { ...CUR, o: 20 }]) {
    assertEquals(await verifyCursor(k, await signCursor(k, x), NOW_S), { ok: true, claims: x });
  }
});
Deno.test("cursor too long: p dropped first (p null, o 0 → the next request looks for the anchor on the first page, else time fallback), then the oldest s ids; l/t kept (DP4)", async () => {
  const k = await importTokenKey(KEY_B64);
  const s20 = Array.from({ length: 20 }, (_, i) => String(i).padStart(2, "0") + "x".repeat(62));   // 64자 Gmail id 20개(모양 상한)
  const signed = await signCursor(k, { ...CUR, p: "P".repeat(512), s: s20 });
  assert(signed.length <= CURSOR_MAX, String(signed.length));
  const v = await verifyCursor(k, signed, NOW_S);
  if (!v.ok) throw new Error(v.code);
  assertEquals([v.claims.p, v.claims.o, v.claims.l, v.claims.t], [null, 0, CUR.l, CUR.t]);
  assert(v.claims.s.length > 0 && v.claims.s.length < 20, String(v.claims.s.length));
  assertEquals(v.claims.s, s20.slice(20 - v.claims.s.length));                  // 남는 것은 가장 최근에 본 id 들
  const fits = await verifyCursor(k, await signCursor(k, { ...CUR, p: "P".repeat(200) }), NOW_S);
  assert(fits.ok && fits.claims.p === "P".repeat(200) && fits.claims.o === 7);   // 들어가면 줄이지 않는다
});
Deno.test("cursor: tampered → not_found, expired → token_expired, wrong shape/claims → bad_token, a v1 token is not a cursor and a cursor is not a token", async () => {
  const k = await importTokenKey(KEY_B64), s = await signCursor(k, CUR);
  const [, p, sig] = s.split(".");
  // 서명 첫 글자를 바꾼다 — 끝 글자는 하위 2비트가 atob 에서 버려져 같은 바이트가 될 수 있다(PF-4)
  assertEquals(await verifyCursor(k, `c1.${p}.${sig[0] === "A" ? "B" : "A"}${sig.slice(1)}`, NOW_S), { ok: false, code: "not_found" });
  assertEquals(await verifyCursor(k, s, CUR.e), { ok: false, code: "token_expired" });
  for (const bad of [null, 3, "", "c1..x", "c1." + "A".repeat(1100) + "." + "A".repeat(43)]) assertEquals((await verifyCursor(k, bad, NOW_S)).ok, false);
  for (const claims of [{ ...CUR, o: 21 }, { ...CUR, o: -1 }, { ...CUR, h: "XYZ" }, { ...CUR, l: "bad id!" },
    { ...CUR, s: Array.from({ length: 21 }, (_, i) => `a${i}`) }, { ...CUR, s: ["bad id!"] }, { ...CUR, l: null, o: 0, t: null }, { ...CUR, t: -1 },
    { ...CUR, b: 0 }, { ...CUR, b: 1.5 }, { ...CUR, l: null, o: 0, b: 1792040401, t: null, s: [] }, { ...CUR, l: null, o: 3 },   // l null·o 0 = l⇒t 규칙에 가리지 않고 t null⇒s []·b⇒t 를 따로 본다
    { ...CUR, t: null, s: [] }]) {                                               // l 있는데 t 없음(PF-12)
    assertEquals(await verifyCursor(k, await signCursor(k, claims as CursorClaims), NOW_S), { ok: false, code: "bad_token" }, JSON.stringify(claims).slice(0, 80));
  }
  // PAGE 밖 pageToken 은 서명 때 p null·o 0 으로 — 다음 요청이 bad_token 이 아니라 첫 쪽 앵커 확인·시간 기준 대체로 간다(최종 리뷰 I1 b)
  for (const p of ["a b", "ab+/=", "x".repeat(513)]) {
    const v = await verifyCursor(k, await signCursor(k, { ...CUR, p }), NOW_S);
    assert(v.ok, p.slice(0, 20));
    assertEquals([v.claims.p, v.claims.o, v.claims.l, v.claims.t], [null, 0, CUR.l, CUR.t]);
  }
  const tok = await signToken(k, { u: USER, c: CONN, m: "18f0a1b2c3d4e5f6", e: NOW_S + 600 });
  assertEquals(await verifyCursor(k, tok, NOW_S), { ok: false, code: "bad_token" });
  assertEquals(await verifyToken(k, s, NOW_S), { ok: false, code: "bad_token" });
});
Deno.test("conditionPrint: same search conditions → same print; translate/latest ignored; any search field or count changes it", async () => {
  const base: ReadConditions = { sender: "합성상점", subject_words: ["안내"], received_from: "2026-10-01", received_to: null, latest: false, translate: false, count: 12 };
  const h = await conditionPrint(base);
  assert(/^[0-9a-f]{32}$/.test(h));
  assertEquals(await conditionPrint({ ...base, translate: true }), h);
  for (const o of [{ sender: "합성레터" }, { subject_words: ["공지"] }, { received_from: null }, { received_to: "2026-10-23" }, { count: 13 }]) {
    assert((await conditionPrint({ ...base, ...o })) !== h, JSON.stringify(o));
  }
});
