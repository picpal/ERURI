// 광고 구독 해지 POST(스펙 §7 "광고 구독 해지", RFC 8058). 외부 URL 로 가는 유일한 서버 요청이라 SSRF 를 막는다:
// https·443·userinfo 없음·로컬 이름 금지 → DNS(A·AAAA) 전부 공인 주소 → 고정 본문 POST 1회(쿠키·인증 없음, 전체 10초)
// → 2xx 만 접수. 3xx 는 따라가지 않고 redirect_<n>(RFC 8058 §3.1: 발신자 서버는 리다이렉트하지 않는다). 응답 본문은 읽지 않는다.
// 남은 위험: DNS 재바인딩(검사와 연결 사이 주소 변경) — 수용 위험(스펙 §12 통제 3, 메인 판정 2026-10-02). 리다이렉트가 없어 창은 첫 요청 하나
export type Resolver = (host: string) => Promise<string[]>;
export type PostCode =
  | "ok" | "blocked_scheme" | "blocked_host" | "blocked_private" | "dns_error" | "timeout" | "network"
  | `redirect_${number}` | `http_${number}`;

const BODY = "List-Unsubscribe=One-Click";

function v4(ip: string): number[] | null {
  const p = ip.split(".");
  if (p.length !== 4) return null;
  const n = p.map((x) => (/^\d{1,3}$/.test(x) ? Number(x) : NaN));
  return n.every((x) => x >= 0 && x <= 255) ? n : null;
}
function v4Blocked([a, b, c]: number[]): boolean {
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 192 && b === 0 && (c === 0 || c === 2)) || (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113);
}
function v6(ip: string): number[] | null {
  let s = ip.toLowerCase();
  const pct = s.indexOf("%");
  if (pct >= 0) s = s.slice(0, pct);
  let tail: number[] = [];
  const m = s.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (m) {
    const q = v4(m[2]);
    if (!q) return null;
    tail = [(q[0] << 8) | q[1], (q[2] << 8) | q[3]];
    s = m[1].endsWith("::") ? m[1] : m[1].slice(0, -1);
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const parse = (h: string) => (h === "" ? [] : h.split(":").map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN)));
  const head = parse(halves[0]), back = halves.length === 2 ? parse(halves[1]) : [];
  let groups: number[];
  if (halves.length === 2) {
    const fill = 8 - head.length - back.length - tail.length;
    if (fill < 1) return null;
    groups = [...head, ...new Array(fill).fill(0), ...back, ...tail];
  } else groups = [...head, ...tail];
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}
const embedded = (hi: number, lo: number) => v4Blocked([hi >> 8, hi & 255, lo >> 8]);
// 허용 목록식(리뷰 N11): v4 매핑·NAT64(/96)는 내장 v4 로 판정, 그 밖은 전역 유니캐스트 2000::/3 안이고 특수 대역이 아닐 때만 연다
function v6Blocked(g: number[]): boolean {
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0 || g[5] === 0xffff)) {
    if (g[5] === 0 && g[6] === 0 && g[7] <= 1) return true;            // :: · ::1
    return embedded(g[6], g[7]);                                          // ::a.b.c.d · ::ffff:a.b.c.d
  }
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return embedded(g[6], g[7]);   // NAT64 64:ff9b::/96
  if (g[0] < 0x2000 || g[0] > 0x3fff) return true;                      // 2000::/3 밖(64:ff9b:1::/48·fc00::/7·fe80::/10·ff00::/8 포함)
  if (g[0] === 0x2002) return embedded(g[1], g[2]);                     // 6to4
  if (g[0] === 0x2001 && (g[1] === 0x0db8 || g[1] < 0x0200)) return true;   // 문서용 2001:db8::/32, IETF 특수 2001::/23(Teredo 포함)
  if (g[0] === 0x3fff && g[1] < 0x1000) return true;                    // 문서용 3fff::/20
  return false;
}
export function ipBlocked(ip: string): boolean {
  const a = v4(ip);
  if (a) return v4Blocked(a);
  if (!ip.includes(":")) return true;
  const b = v6(ip);
  return b ? v6Blocked(b) : true;                                         // 파싱 불가는 막는다
}
const isIpLiteral = (h: string) => v4(h) !== null || h.includes(":");

export function checkUrl(raw: string): URL | "blocked_scheme" | "blocked_host" {
  let u: URL;
  try { u = new URL(raw); } catch { return "blocked_scheme"; }
  if (u.protocol !== "https:") return "blocked_scheme";
  if (u.username || u.password || (u.port && u.port !== "443")) return "blocked_host";
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.+$/, "");   // 끝의 점(FQDN 표기)은 떼고 본다
  if (!h.includes(".") && !h.includes(":")) return "blocked_host";
  if (/(^|\.)(localhost|local|internal|localdomain|home\.arpa)$/.test(h)) return "blocked_host";
  return u;
}

async function doh(host: string): Promise<string[]> {
  const out: string[] = [];
  for (const [type, code] of [["A", 1], ["AAAA", 28]] as const) {
    const r = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(host)}&type=${type}`, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) { await r.body?.cancel(); throw new Error("doh " + r.status); }
    const j = await r.json() as { Answer?: { type: number; data: string }[] };
    for (const a of j.Answer ?? []) if (a.type === code) out.push(a.data);
  }
  return out;
}
export type DenoResolveDns = (q: string, t: "A" | "AAAA") => Promise<string[]>;
type DenoDns = { resolveDns?: DenoResolveDns };
// A·AAAA 중 하나라도 답하면 그 답(둘 다 모은다). 둘 다 던지면(Edge 권한·미지원) 또는 함수가 없으면 fallback(DoH) — 리뷰 N8
export async function resolveWith(rd: DenoResolveDns | undefined, fallback: Resolver, host: string): Promise<string[]> {
  if (typeof rd !== "function") return await fallback(host);
  const [a, aaaa] = await Promise.allSettled([rd(host, "A"), rd(host, "AAAA")]);
  if (a.status === "rejected" && aaaa.status === "rejected") return await fallback(host);
  return [...(a.status === "fulfilled" ? a.value : []), ...(aaaa.status === "fulfilled" ? aaaa.value : [])];
}
export const defaultResolver: Resolver = (host) => resolveWith((Deno as unknown as DenoDns).resolveDns, doh, host);
export const resolverKind = () => (typeof (Deno as unknown as DenoDns).resolveDns === "function" ? "deno" : "doh");

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error("dns_timeout")), ms);
    p.then((v) => { clearTimeout(t); res(v); }, (e) => { clearTimeout(t); rej(e); });
  });
}

export async function oneClickPost(url: string, o: { fetch?: typeof fetch; resolve?: Resolver; timeoutMs?: number } = {}):
  Promise<{ ok: boolean; code: PostCode }> {
  // 전체 예산(DNS + 요청). AbortSignal.timeout 대신 직접 타이머 — 일찍 끝나면 지워서 deno test 의 타이머 누수 검사에 걸리지 않게
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(new DOMException("timeout", "TimeoutError")), o.timeoutMs ?? 10_000);
  try { return await post(url, o, ctl.signal); } finally { clearTimeout(timer); }
}

async function post(url: string, o: { fetch?: typeof fetch; resolve?: Resolver }, signal: AbortSignal): Promise<{ ok: boolean; code: PostCode }> {
  const f = o.fetch ?? fetch, resolve = o.resolve ?? defaultResolver;
  const done = (code: PostCode) => ({ ok: code === "ok", code });
  const u = checkUrl(url);
  if (typeof u === "string") return done(u);
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  let ips: string[];
  if (isIpLiteral(host)) ips = [host];
  else {
    try { ips = await withTimeout(resolve(host), 3000); } catch { return done("dns_error"); }
  }
  if (ips.length === 0) return done("dns_error");
  if (ips.some(ipBlocked)) return done("blocked_private");
  let r: Response;
  try {
    r = await f(u.toString(), { method: "POST", redirect: "manual", body: BODY, signal,
      headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "ERURI-Unsubscribe/1" } });
  } catch (e) {
    return done(signal.aborted || (e as Error)?.name === "TimeoutError" ? "timeout" : "network");
  }
  await r.body?.cancel().catch(() => {});
  if (r.status >= 200 && r.status < 300) return done("ok");
  if (r.status >= 300 && r.status < 400) return done(`redirect_${r.status}`);   // 따라가지 않는다(리뷰 M1·H3)
  return done(`http_${r.status}`);
}
