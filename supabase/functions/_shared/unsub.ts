import { type GmailMessage, header } from "./gmail.ts";
import { AD_MARK } from "./rules.ts";

// 광고 구독 해지(스펙 §7 "광고 구독 해지"): 헤더만 해석한다. 어떤 입력에도 throw하지 않는다 — gmail-fetch 를 실패시키면 메일이 유실된다
export type UnsubMethod = "one_click" | "unverified" | "link_only" | "mailto" | "none";
export type UnsubMeta = { address: string; name: string | null; method: UnsubMethod; url: string | null };
type Msg = Pick<GmailMessage, "payload">;

const MAX_URL = 2048;
const MAX_FROM = 1000;

// From 은 발신자가 정한다 — 겹치는 수량자 없이 해석하고 길이를 묶는다(리뷰 I1: 세제곱 역추적이 gmail-fetch CPU 한도를 넘겼다)
export function parseFrom(v: string | null): { address: string; name: string | null } | null {
  if (!v) return null;
  const s = v.trim();
  if (s.length > MAX_FROM) return null;
  const m = s.match(/^([^<]*)<([^<>\s]+)>$/);
  const address = (m ? m[2] : s).toLowerCase();
  if (!/^[^@\s<>"]+@[^@\s<>"]+\.[^@\s<>"]+$/.test(address)) return null;
  const name = (m?.[1] ?? "").trim().replace(/^"+|"+$/g, "").trim();
  return { address, name: name ? name.slice(0, 60) : null };
}

// RFC 2369: 꺾쇠 안의 공백(접힌 줄)은 무시한다(리뷰 Minor 4)
export function listUnsubUris(v: string | null): string[] {
  if (!v) return [];
  return [...v.matchAll(/<([^<>]+)>/g)].map((m) => m[1].replace(/\s+/g, "")).filter((s) => s.length > 0);
}

function allHeaders(msg: Msg, name: string): string[] {
  return (msg.payload?.headers ?? []).filter((h) => h.name.toLowerCase() === name.toLowerCase()).map((h) => h.value ?? "");
}

type Sig = { d: string; s: string; b: string; h: string[] };
function sigTags(v: string): Sig {
  const t: Record<string, string> = {};
  for (const part of v.split(";")) {
    const i = part.indexOf("=");
    if (i > 0) t[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).replace(/\s+/g, "");   // 접힌 줄·공백 제거
  }
  // d·s·h 는 대소문자 무시, b= 는 base64 라 그대로
  return { d: (t.d ?? "").toLowerCase(), s: (t.s ?? "").toLowerCase(), b: t.b ?? "", h: (t.h ?? "").toLowerCase().split(":").filter(Boolean) };
}

// RFC 8601 주석 ( … )(중첩·이스케이프 포함)과 따옴표 문자열 "…" 을 공백으로 바꾼다. 닫히지 않으면 끝까지 버린다(실패 쪽)
function stripCommentsAndQuotes(v: string): string {
  let out = "", depth = 0, quoted = false;
  for (let i = 0; i < v.length; i++) {
    const c = v[i];
    if ((depth > 0 || quoted) && c === "\\") { i++; continue; }
    if (quoted) { if (c === '"') { quoted = false; out += " "; } continue; }
    if (c === "(") { depth++; continue; }
    if (depth > 0) { if (c === ")" && --depth === 0) out += " "; continue; }
    if (c === '"') { quoted = true; continue; }
    out += c;
  }
  return out;
}

// Authentication-Results 의 dkim=pass 결과마다 서명 도메인·selector·서명값 앞부분(Gmail 은 header.b 에 앞 8자).
// 주석·따옴표 안은 공격자가 정할 수 있다(SPF 주석의 봉투 발신자, smtp.mailfrom 의 따옴표 local-part) — 지운 뒤에 ; 로 자른다(리뷰 I2).
// exact = header.d 로 얻은 도메인(서명 d= 와 정확히 같아야 한다). header.i 의 도메인은 d= 와 같거나 그 하위(리뷰 Minor 3)
function arDkimPass(ar: string): { d: string; exact: boolean; s: string; b: string }[] {
  const out: { d: string; exact: boolean; s: string; b: string }[] = [];
  for (const part of stripCommentsAndQuotes(ar).split(";").slice(1)) {
    if (!/^\s*dkim=pass\b/i.test(part)) continue;
    const tag = (k: string) => part.match(new RegExp(`\\bheader\\.${k}=([^\\s;]+)`, "i"))?.[1] ?? "";
    const hd = tag("d").toLowerCase();
    const d = hd || tag("i").replace(/^[^@]*@/, "").toLowerCase();
    const s = tag("s").toLowerCase(), b = tag("b");
    if (d && s && /^[A-Za-z0-9+/=]+$/.test(b)) out.push({ d, exact: hd !== "", s, b });
  }
  return out;
}

// RFC 8058 §3: **유효한** DKIM 서명이 List-Unsubscribe·List-Unsubscribe-Post 를 덮어야 한다(리뷰 H1).
// 맨 위 Authentication-Results 가 Gmail(mx.google.com)의 것이어야 한다(수신 서버가 맨 위에 붙인다 — 원문에 끼워 넣은 AR 은 아래에 온다).
// 그 안의 dkim=pass 가 (d, selector, b= 앞부분)으로 특정하는 DKIM-Signature 가 정확히 1개이고, 그 서명의 h= 가 두 헤더를 모두 포함할 때만 true.
// 서명 도메인 D 가 From 도메인과 같거나 그 상위여야 한다 — RFC 가 아니라 제품 정책(외부 발송 대행 서명은 unverified). 역방향(D 가 From 의 하위)은 받지 않는다
export function dkimCovers(msg: Msg, fromDomain: string): boolean {
  const ar = allHeaders(msg, "Authentication-Results")[0];
  if (!ar || !/^\s*mx\.google\.com\s*;/i.test(ar)) return false;
  const sigs = allHeaders(msg, "DKIM-Signature").map(sigTags);
  return arDkimPass(ar).some((p) => {
    const hit = sigs.filter((s) => s.d !== "" && (s.d === p.d || (!p.exact && p.d.endsWith("." + s.d))) && s.s === p.s && s.b.startsWith(p.b));
    if (hit.length !== 1) return false;
    const d = hit[0].d;   // 정렬 판정은 서명의 d=
    return (fromDomain === d || fromDomain.endsWith("." + d)) && hit[0].h.includes("list-unsubscribe") && hit[0].h.includes("list-unsubscribe-post");
  });
}

export function unsubMeta(msg: Msg): UnsubMeta | null {
  try {
    const from = parseFrom(header(msg, "From"));
    if (!from) return null;
    const lu = allHeaders(msg, "List-Unsubscribe"), lup = allHeaders(msg, "List-Unsubscribe-Post");
    const uris = lu.flatMap(listUnsubUris);
    const https = uris.filter((u) => /^https:\/\//i.test(u) && u.length <= MAX_URL);
    const mailto = uris.some((u) => /^mailto:/i.test(u));
    const post = lup.some((v) => v.replace(/\s+/g, "").toLowerCase() === "list-unsubscribe=one-click");
    let method: UnsubMethod = "none";
    if (https.length > 0 && post) {
      // 헤더·URI 가 하나씩일 때만 서명이 덮은 값과 POST 대상이 같다고 볼 수 있다(리뷰 H1)
      const single = lu.length === 1 && lup.length === 1 && https.length === 1;
      method = single && dkimCovers(msg, from.address.split("@")[1]) ? "one_click" : "unverified";
    } else if (https.length > 0) method = "link_only";
    else if (mailto) method = "mailto";
    return { ...from, method, url: method === "one_click" ? https[0] : null };
  } catch {
    return null;
  }
}

export function hasListUnsub(msg: Msg): boolean {
  return header(msg, "List-Unsubscribe") !== null;
}

// 메타데이터(format=metadata)만으로 하는 광고 판정: 프로모션 라벨, 제목·발신자의 (광고) 표기(본문 표기는 볼 수 없다)
export function isAdMail(msg: Pick<GmailMessage, "payload" | "labelIds">): boolean {
  if (msg.labelIds?.includes("CATEGORY_PROMOTIONS")) return true;
  return [header(msg, "Subject") ?? "", header(msg, "From") ?? ""].some((s) => AD_MARK.test(s));
}
