// 메일 요약 후보 토큰(스펙 §7 "후보 토큰 — 저장 없는 서명 토큰"): v1.<base64url(JSON {u, c, m, e})>.<base64url(HMAC-SHA256("v1." + payload))>.
// 키 = Edge secret MAIL_READ_KEY(base64 32바이트, 다른 키와 공유하지 않는다). 서버가 검색으로 고른 메일만 읽게 한다 — 행·Gmail id 목록을 저장하지 않는다(§12)
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
