// 메일 요약 후보 토큰(스펙 §7 "후보 토큰 — 저장 없는 서명 토큰"): v1.<base64url(JSON {u, c, m, e})>.<base64url(HMAC-SHA256("v1." + payload))>.
// 키 = Edge secret MAIL_READ_KEY(base64 32바이트, 다른 키와 공유하지 않는다). 서버가 검색으로 고른 메일만 읽게 한다 — 행·Gmail id 목록을 저장하지 않는다(§12)
import type { ReadConditions } from "./mail-query.ts";

export const TOKEN_TTL_S = 600;
export const TOKEN_MAX = 512;
export type TokenClaims = { u: string; c: string; m: string; e: number };
export type Verified = { ok: true; claims: TokenClaims } | { ok: false; code: "bad_token" | "not_found" | "token_expired" };

const SHAPE = /^v1\.([A-Za-z0-9_-]{1,400})\.([A-Za-z0-9_-]{43})$/;   // HMAC-SHA256 = 32바이트 = base64url 43자
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GMAIL_ID = /^[A-Za-z0-9]{1,64}$/;
const enc = new TextEncoder();
const b64u = (b: Uint8Array) => btoa(Array.from(b, (x) => String.fromCharCode(x)).join("")).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s: string) => {
  const b = s.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(b + "=".repeat((4 - (b.length % 4)) % 4)), (c) => c.charCodeAt(0));
};

export async function importTokenKey(secretB64: string): Promise<CryptoKey> {
  let raw: Uint8Array<ArrayBuffer>;
  try { raw = Uint8Array.from(atob(secretB64.trim()), (c) => c.charCodeAt(0)); } catch { throw new Error("key_invalid"); }
  if (raw.length !== 32) throw new Error("key_invalid");
  return await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function signToken(key: CryptoKey, c: TokenClaims): Promise<string> {
  const payload = b64u(enc.encode(JSON.stringify({ u: c.u, c: c.c, m: c.m, e: c.e })));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode("v1." + payload)));
  return `v1.${payload}.${b64u(sig)}`;
}

const isClaims = (x: unknown): x is TokenClaims => {
  const o = x as Record<string, unknown> | null;
  return !!o && typeof o.u === "string" && UUID.test(o.u) && typeof o.c === "string" && UUID.test(o.c) && typeof o.m === "string" && GMAIL_ID.test(o.m) &&
    typeof o.e === "number" && Number.isInteger(o.e);
};

// 순서: 형식(400) → 서명(404 — crypto.subtle.verify 는 일정 시간 비교) → 내용 모양(400) → 만료(410)
export async function verifyToken(key: CryptoKey, token: unknown, nowS: number): Promise<Verified> {
  if (typeof token !== "string" || token.length > TOKEN_MAX) return { ok: false, code: "bad_token" };
  const m = SHAPE.exec(token);
  if (!m) return { ok: false, code: "bad_token" };
  let sig: Uint8Array<ArrayBuffer>;
  try { sig = unb64u(m[2]); } catch { return { ok: false, code: "bad_token" }; }
  if (!(await crypto.subtle.verify("HMAC", key, sig, enc.encode("v1." + m[1])))) return { ok: false, code: "not_found" };
  let claims: unknown;
  try { claims = JSON.parse(new TextDecoder().decode(unb64u(m[1]))); } catch { return { ok: false, code: "bad_token" }; }
  if (!isClaims(claims)) return { ok: false, code: "bad_token" };
  if (claims.e <= nowS) return { ok: false, code: "token_expired" };
  return { ok: true, claims: { u: claims.u, c: claims.c, m: claims.m, e: claims.e } };
}

// ── 0.19.0 진행 위치 커서(스펙 §7 "진행 위치 검색과 커서"·"진행 보장 정책", D-M4·DP4·DP6): c1.<base64url(JSON {u,c,h,b,p,o,l,t,s,e})>.<HMAC("c1." + payload)>.
// 저장 없음·같은 키·10분. 위치 = 앵커가 있는 Gmail 쪽(pageToken, 첫 쪽 null)·그 쪽에서 앵커 다음 오프셋·앵커 id. 시간 상태 = 앵커 시각 t(ms)·같은 ms 로 본 id s(≤ 20)·시간 경계 b(초) ──
export const CURSOR_MAX = 1024, CURSOR_PAYLOAD_MAX = 960, SAME_MS_MAX = 20;
export type CursorClaims = { u: string; c: string; h: string; b: number | null; p: string | null; o: number; l: string | null; t: number | null; s: string[]; e: number };
export type CursorVerified = { ok: true; claims: CursorClaims } | { ok: false; code: "bad_token" | "not_found" | "token_expired" };
const CURSOR_SHAPE = new RegExp(`^c1\\.([A-Za-z0-9_-]{1,${CURSOR_PAYLOAD_MAX}})\\.([A-Za-z0-9_-]{43})$`);   // payload 상한 = signCursor 와 같은 상수
const PAGE = /^[A-Za-z0-9_.-]{1,512}$/;
const PRINT = /^[0-9a-f]{32}$/;

// 지문 = 검색에 쓰이는 칸만(DP3) — 고정 순서 JSON 의 SHA-256 앞 16바이트
export async function conditionPrint(c: ReadConditions): Promise<string> {
  const s = JSON.stringify([c.sender, c.subject_words, c.received_from, c.received_to, c.count]);
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s)));
  return Array.from(d.slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
}
const cursorPayload = (c: CursorClaims) => b64u(enc.encode(JSON.stringify({ u: c.u, c: c.c, h: c.h, b: c.b, p: c.p, o: c.o, l: c.l, t: c.t, s: c.s, e: c.e })));
// 1,024자를 넘으면 p 를 먼저 버린다(p null·o 0 = 다음 요청은 첫 쪽에서 앵커를 찾고 없으면 시간 기준 대체 — 안전), 그래도 넘으면 같은 ms id 를 오래된 것부터(DP4).
// p 가 PAGE 모양이 아니어도 같은 경로 — Gmail pageToken 모양은 문서에 없다. 그대로 서명하면 다음 요청 isCursor 가 400 bad_token 을 되풀이한다(최종 리뷰 I1)
export async function signCursor(key: CryptoKey, c: CursorClaims): Promise<string> {
  let x = c.p !== null && !PAGE.test(c.p) ? { ...c, p: null, o: 0 } : c, payload = cursorPayload(x);
  if (payload.length > CURSOR_PAYLOAD_MAX && x.p !== null) { x = { ...x, p: null, o: 0 }; payload = cursorPayload(x); }
  while (payload.length > CURSOR_PAYLOAD_MAX && x.s.length > 0) { x = { ...x, s: x.s.slice(1) }; payload = cursorPayload(x); }
  if (payload.length > CURSOR_PAYLOAD_MAX) throw new Error("cursor_too_long");   // 도달하지 않는다 — p null·s [] 이면 400자 안
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode("c1." + payload)));
  return `c1.${payload}.${b64u(sig)}`;
}
const int = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
// l 있으면 t 있음(PF-12) — 앵커를 소비했다면 그 시각도 안다
const isCursor = (x: unknown): x is CursorClaims => {
  const o = x as Record<string, unknown> | null;
  return !!o && typeof o.u === "string" && UUID.test(o.u) && typeof o.c === "string" && UUID.test(o.c) && typeof o.h === "string" && PRINT.test(o.h) &&
    (o.b === null || (int(o.b) && o.b > 0)) &&
    (o.p === null || (typeof o.p === "string" && PAGE.test(o.p))) && int(o.o) && o.o >= 0 && o.o <= 20 &&
    (o.l === null || (typeof o.l === "string" && GMAIL_ID.test(o.l))) && (o.l !== null || o.o === 0) &&
    (o.t === null || (int(o.t) && o.t >= 0)) && (o.b === null || o.t !== null) && (o.l === null || o.t !== null) &&
    Array.isArray(o.s) && o.s.length <= SAME_MS_MAX && o.s.every((id) => typeof id === "string" && GMAIL_ID.test(id)) && (o.t !== null || o.s.length === 0) &&
    int(o.e);
};
// verifyToken 과 같은 순서: 형식(400) → 서명(404) → 내용 모양(400) → 만료(410)
export async function verifyCursor(key: CryptoKey, cursor: unknown, nowS: number): Promise<CursorVerified> {
  if (typeof cursor !== "string" || cursor.length > CURSOR_MAX) return { ok: false, code: "bad_token" };
  const m = CURSOR_SHAPE.exec(cursor);
  if (!m) return { ok: false, code: "bad_token" };
  let sig: Uint8Array<ArrayBuffer>;
  try { sig = unb64u(m[2]); } catch { return { ok: false, code: "bad_token" }; }
  if (!(await crypto.subtle.verify("HMAC", key, sig, enc.encode("c1." + m[1])))) return { ok: false, code: "not_found" };
  let claims: unknown;
  try { claims = JSON.parse(new TextDecoder().decode(unb64u(m[1]))); } catch { return { ok: false, code: "bad_token" }; }
  if (!isCursor(claims)) return { ok: false, code: "bad_token" };
  if (claims.e <= nowS) return { ok: false, code: "token_expired" };
  const c = claims;
  return { ok: true, claims: { u: c.u, c: c.c, h: c.h, b: c.b, p: c.p, o: c.o, l: c.l, t: c.t, s: [...c.s], e: c.e } };
}
