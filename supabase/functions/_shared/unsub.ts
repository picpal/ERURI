import { type GmailMessage, header } from "./gmail.ts";
import { AD_MARK } from "./rules.ts";

// 광고 구독 해지(스펙 §7 "광고 구독 해지"): 헤더만 해석한다. 어떤 입력에도 throw하지 않는다 — gmail-fetch 를 실패시키면 메일이 유실된다
export type UnsubMethod = "one_click" | "unverified" | "link_only" | "mailto" | "none";
export type UnsubMeta = { address: string; name: string | null; method: UnsubMethod; url: string | null };
type Msg = Pick<GmailMessage, "payload">;

const MAX_URL = 2048;
const MAX_FROM = 1000;

// From 은 발신자가 정한다 — 정규식 역추적 없이 해석하고 길이를 묶는다(리뷰 I1: 세제곱 역추적이 gmail-fetch CPU 한도를 넘겼다).
// 표시 이름에 '<' 가 있을 수 있다("a<b" <x@…>) — 마지막 '<…>' 가 주소
export function parseFrom(v: string | null): { address: string; name: string | null } | null {
  if (!v) return null;
  const s = v.trim();
  if (s.length > MAX_FROM) return null;
  const lt = s.lastIndexOf("<");
  const angle = lt >= 0 && s.endsWith(">");
  const address = (angle ? s.slice(lt + 1, -1) : s).toLowerCase();
  if (!/^[^@\s<>"]+@[^@\s<>"]+\.[^@\s<>"]+$/.test(address)) return null;
  const name = (angle ? s.slice(0, lt) : "").trim().replace(/^"+|"+$/g, "").trim();
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

type Pass = { d: string; exact: boolean; s: string; b: string };

// 맨 위 Gmail AR 에서 authserv-id 바로 뒤에 이어지는 dkim= 결과만 읽고, 첫 비-dkim 메서드(arc=/spf=/dmarc=/기타)에서 멈춘다(재리뷰 I2).
// 그 뒤의 SPF 주석·smtp.mailfrom·header.from 은 발신자가 정하는 칸을 이스케이프 없이 찍으므로 문법으로 해석할 수 없다 — 아예 읽지 않는다.
// dkim 구간은 RFC 8601 렉서로 읽는다: 주석 ( … )(중첩, \ 이스케이프, 안의 " 는 일반 문자), 값의 quoted-string 해제("…", \ 이스케이프).
// 닫히지 않은 주석·따옴표나 문법 밖 문자는 전부 버린다(실패 쪽). Gmail 이 dkim 을 뒤에 찍는 메일은 unverified 가 된다(안전 쪽).
// 각 dkim=pass: 서명 도메인·selector·서명값 앞부분(Gmail 은 header.b 에 앞 8자).
// exact = header.d 로 얻은 도메인(서명 d= 와 정확히 같아야 한다). header.i 의 도메인은 d= 와 같거나 그 하위(리뷰 Minor 3)
function arDkimPass(ar: string): Pass[] {
  const n = ar.length, out: Pass[] = [];
  let i = 0;
  const cfws = (): boolean => {   // 공백·주석 건너뛰기. 닫히지 않은 주석이면 false
    while (i < n) {
      const c = ar[i];
      if (c === " " || c === "\t" || c === "\r" || c === "\n") { i++; continue; }
      if (c !== "(") return true;
      let depth = 0;
      for (; i < n; i++) {
        const x = ar[i];
        if (x === "\\") i++;
        else if (x === "(") depth++;
        else if (x === ")" && --depth === 0) break;
      }
      if (i >= n) return false;
      i++;
    }
    return true;
  };
  const DELIM = " \t\r\n()\";=";
  const word = (): string => {   // 메서드·결과·속성 이름(= 에서 멈춘다)
    const st = i;
    while (i < n && !DELIM.includes(ar[i])) i++;
    return ar.slice(st, i);
  };
  const value = (): string | null => {   // token(= 포함 허용) 또는 quoted-string, 뒤에 붙은 @domain 까지. 닫히지 않은 따옴표면 null
    let v = "";
    if (ar[i] === '"') {
      for (i++; i < n && ar[i] !== '"'; i++) v += ar[i] === "\\" ? ar[++i] ?? "" : ar[i];
      if (i >= n) return null;
      i++;
    }
    const st = i;
    while (i < n && !" \t\r\n()\";".includes(ar[i])) i++;
    return v + ar.slice(st, i);
  };
  if (!cfws() || word().toLowerCase() !== "mx.google.com" || !cfws() || ar[i] !== ";") return [];
  while (i < n && ar[i] === ";") {
    i++;
    if (!cfws() || word().toLowerCase() !== "dkim") break;   // 첫 비-dkim 메서드에서 멈춘다
    if (!cfws() || ar[i] !== "=") return [];
    i++;
    if (!cfws()) return [];
    const result = word().toLowerCase();
    const t = new Map<string, string>();
    for (;;) {
      if (!cfws()) return [];
      if (i >= n || ar[i] === ";") break;
      const k = word().toLowerCase();
      if (!k || !cfws() || ar[i] !== "=" || t.has(k)) return [];   // 같은 속성 두 번 → 모호, 버린다
      i++;
      if (!cfws()) return [];
      const v = value();
      if (v === null) return [];
      t.set(k, v);
    }
    if (result !== "pass") continue;
    const hd = (t.get("header.d") ?? "").toLowerCase(), hi = t.get("header.i") ?? "";
    const d = hd || hi.slice(hi.lastIndexOf("@") + 1).toLowerCase();
    const s = (t.get("header.s") ?? "").toLowerCase(), b = t.get("header.b") ?? "";
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
  if (!ar) return false;
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
