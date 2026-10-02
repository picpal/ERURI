import { type GmailMessage, header } from "./gmail.ts";
import { AD_MARK } from "./rules.ts";

// 광고 구독 해지(스펙 §7 "광고 구독 해지"): 헤더만 해석한다. 어떤 입력에도 throw하지 않는다 — gmail-fetch 를 실패시키면 메일이 유실된다
export type UnsubMethod = "one_click" | "unverified" | "link_only" | "mailto" | "none";
export type UnsubMeta = { address: string; name: string | null; method: UnsubMethod; url: string | null };
type Msg = Pick<GmailMessage, "payload">;

const MAX_URL = 2048;

export function parseFrom(v: string | null): { address: string; name: string | null } | null {
  if (!v) return null;
  const m = v.match(/^\s*(.*?)\s*<([^<>\s]+)>\s*$/);
  const address = (m ? m[2] : v.trim()).toLowerCase();
  if (!/^[^@\s<>"]+@[^@\s<>"]+\.[^@\s<>"]+$/.test(address)) return null;
  const name = (m?.[1] ?? "").replace(/^"+|"+$/g, "").trim();
  return { address, name: name ? name.slice(0, 60) : null };
}

export function listUnsubUris(v: string | null): string[] {
  if (!v) return [];
  return [...v.matchAll(/<([^<>]+)>/g)].map((m) => m[1].trim()).filter((s) => s.length > 0);
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

// Authentication-Results 의 dkim=pass 결과마다 서명 도메인·selector·서명값 앞부분(Gmail 은 header.b 에 앞 8자)
function arDkimPass(ar: string): { d: string; s: string; b: string }[] {
  const out: { d: string; s: string; b: string }[] = [];
  for (const part of ar.split(";").slice(1)) {
    if (!/^\s*dkim=pass\b/i.test(part)) continue;
    const tag = (k: string) => part.match(new RegExp(`\\bheader\\.${k}=([^\\s;]+)`, "i"))?.[1] ?? "";
    const d = (tag("d") || tag("i").replace(/^[^@]*@/, "")).toLowerCase();
    const s = tag("s").toLowerCase(), b = tag("b");
    if (d && s && b) out.push({ d, s, b });
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
    if (!(fromDomain === p.d || fromDomain.endsWith("." + p.d))) return false;
    const hit = sigs.filter((s) => s.d === p.d && s.s === p.s && s.b.startsWith(p.b));
    return hit.length === 1 && hit[0].h.includes("list-unsubscribe") && hit[0].h.includes("list-unsubscribe-post");
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
