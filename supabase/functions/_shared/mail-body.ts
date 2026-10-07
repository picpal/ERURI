import { decodeEntities, type MessagePart } from "./gmail.ts";
import { clip16 } from "./mail-meta.ts";

// 메일 요약 본문 추출(스펙 §7 "본문 추출"): 첫 text/plain, 없으면 첫 text/html → 글. 파트 charset 으로 디코드. 첨부(filename·attachmentId)는 읽지 않고 센다.
// 수집 경로 gmail.ts plainText 는 바꾸지 않는다(워커 변경 없음). 결과는 Edge 메모리에만 — 로그 금지
export const BODY_SCAN_MAX = 1_000_000;        // 추출 글·HTML 상한(UTF-16) — 가림·변환 정규식 CPU 를 묶는다(모델에 가는 12,000자 훨씬 밖)
export const SUMMARY_BODY_MAX = 12_000;         // 가림을 마친 본문 → 모델
export const TRANSLATE_SOURCE_MAX = 4_000;      // 번역 원문

// 자르기는 mail-meta.ts clip16(짝 없는 서로게이트를 남기지 않음)을 그대로 쓰고, 잘렸는지만 더한다
export function clipText(s: string, n: number): { text: string; truncated: boolean } {
  if (s.length <= n) return { text: s, truncated: false };
  return { text: clip16(s, n), truncated: true };
}

const isAttachment = (p: MessagePart) => !!p.filename || !!p.body?.attachmentId;
function charsetOf(contentType: string | null): string | null {
  const m = contentType?.match(/charset\s*=\s*["']?([^"';\s]+)["']?/i);   // 작은따옴표(charset='euc-kr')도 — 한국 메일에 있다
  return m ? m[1].toLowerCase() : null;
}
// base64 는 디코드 전에 자른다: 4M 바이트(UTF-8 한 글자 최대 3바이트/UTF-16 단위 → 1M 글자 이상)의 base64 길이 — 큰 첨부성 본문을 통째로 풀지 않는다
const B64_MAX = 4 * Math.ceil((4 * BODY_SCAN_MAX) / 3);
function b64urlBytes(data: string): Uint8Array {
  let b = data.slice(0, B64_MAX).replace(/-/g, "+").replace(/_/g, "/").replace(/\s+/g, "");
  if (data.length > B64_MAX) b = b.slice(0, b.length - (b.length % 4));   // 자른 끝이 4자 묶음 중간이면 버린다(atob 거절 방지)
  return Uint8Array.from(atob(b + "=".repeat((4 - (b.length % 4)) % 4)), (c) => c.charCodeAt(0));
}
// base64url → 바이트 → 파트 charset(WHATWG 라벨, 대소문자·따옴표 무시)로. 라벨이 없거나 모르면 UTF-8(깨진 바이트는 U+FFFD)
export function decodePartData(data: string, contentType: string | null): string {
  const bytes = b64urlBytes(data);
  const label = charsetOf(contentType);
  if (label) {
    try { return new TextDecoder(label).decode(bytes); } catch { /* 모르는 라벨(RangeError) → UTF-8 */ }
  }
  return new TextDecoder("utf-8").decode(bytes);
}
const contentTypeOf = (p: MessagePart) => p.headers?.find((h) => h.name.toLowerCase() === "content-type")?.value ?? p.mimeType ?? null;
function partText(p: MessagePart): string | null {
  try { return decodePartData(p.body?.data ?? "", contentTypeOf(p)); } catch { return null; }   // 잘못된 base64 — 그 파트는 없는 것으로
}

// ASCII 만 소문자로(길이 보존 — String.toLowerCase 는 일부 글자에서 길이가 바뀌어 위치가 어긋난다)
const asciiLower = (s: string) => s.replace(/[A-Z]+/g, (m) => m.toLowerCase());
// <style>·<script>·<head> 블록을 지운다 — 정규식 대신 indexOf 로 선형(D8). 닫히지 않으면 끝까지 지운다. <header> 는 <head> 가 아니다
function dropBlocks(html: string): string {
  const lower = asciiLower(html);
  const next = new Map<string, number>();
  const find = (tag: string, from: number): number => {
    let k = next.get(tag) ?? -2;
    if (k !== -1 && k < from) {
      k = lower.indexOf("<" + tag, from);
      while (k >= 0 && /[a-z0-9-]/.test(lower[k + tag.length + 1] ?? "")) k = lower.indexOf("<" + tag, k + 1);
      next.set(tag, k);
    }
    return k;
  };
  let out = "", i = 0;
  for (;;) {
    let best = -1, tag = "";
    for (const t of ["style", "script", "head"]) { const k = find(t, i); if (k >= 0 && (best < 0 || k < best)) { best = k; tag = t; } }
    if (best < 0) { out += html.slice(i); break; }
    out += html.slice(i, best) + " ";
    const close = lower.indexOf("</" + tag, best);
    if (close < 0) break;
    const gt = lower.indexOf(">", close);
    i = gt < 0 ? html.length : gt + 1;
  }
  return out;
}
const BLOCK_END = /<br\b[^<>]*>|<\/(?:p|div|li|tr|h[1-6])\s*>/gi;
const TAG = /<[^<>]*>/g;                         // 겹친 '<' 에서 되짚기 폭발이 없다(D8)
// HTML → 글: 블록 제거 → 블록 끝 태그는 줄바꿈 → 나머지 태그 제거(href 넣지 않음) → 엔티티 → 줄마다 공백 정리, 빈 줄이 이어지면 하나로
export function htmlToText(html: string): string {
  const s = decodeEntities(dropBlocks(clipText(html, BODY_SCAN_MAX).text).replace(BLOCK_END, "\n").replace(TAG, ""));
  return s.split(/\r?\n/).map((l) => l.replace(/[ \t\f\v\u00a0]+/g, " ").trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// 첨부 파트는 세기만 하고 그 안으로 내려가지 않는다(전달된 메일 첨부의 본문을 본문으로 착각하지 않게)
export function extractBody(payload: MessagePart | undefined): { text: string | null; attachments: number } {
  let attachments = 0;
  const plains: MessagePart[] = [], htmls: MessagePart[] = [];
  const walk = (p: MessagePart | undefined) => {
    if (!p) return;
    if (isAttachment(p)) { attachments++; return; }
    const mime = (p.mimeType ?? "").toLowerCase();
    if (mime === "text/plain" && p.body?.data !== undefined) plains.push(p);
    else if (mime === "text/html" && p.body?.data !== undefined) htmls.push(p);
    for (const c of p.parts ?? []) walk(c);
  };
  walk(payload);
  for (const p of plains) {
    const t = partText(p);
    if (t !== null && t.trim() !== "") return { text: clipText(t.replace(/\r\n/g, "\n").trim(), BODY_SCAN_MAX).text, attachments };
  }
  for (const p of htmls) {
    const t = partText(p);
    if (t !== null) { const s = htmlToText(t); if (s !== "") return { text: s, attachments }; }
  }
  return { text: null, attachments };
}
