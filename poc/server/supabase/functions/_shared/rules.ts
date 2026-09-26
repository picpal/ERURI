// 서버 규칙 필터(스펙 §7). 기기 RuleFilter.swift(0d2a293 이후, 스펙 §6 "기기 규칙 필터")와 같은 정규식·순서를 쓴다.
// 연락처 발신자 규칙은 연락처가 기기에만 있어 서버에서는 적용하지 않는다. 대신 프로모션을 폐기 사유로 더한다.
// NSRegularExpression의 범위 매칭(비투명 경계)을 재현하려고 창(window) 검사는 부분 문자열에 정규식을 돌린다.
// JS 문자열 인덱스는 NSString과 같은 UTF-16 단위다.
export type RuleVerdict =
  | { kind: "discard"; reason: "otp" | "promotion" }
  | { kind: "pass"; masked: string; maskedTitle?: string };
export type RuleMeta = { sender?: string | null; title?: string | null; labels?: string[] };

// OTP 키워드. `OTP`·`code`는 영문자 경계로만 인정한다
const OTP_KEYWORD =
  /(인증|보안|승인|확인)\s*(번호|코드)|verification|verify|passcode|one[- ]?time|(?<![A-Za-z])(code|OTP)(?![A-Za-z])/gi;
// OTP 숫자: 4~8자리 또는 3-3 분리. 날짜·시각·금액은 제외
const OTP_DIGITS = /(?<![\d.,:/-])(?:\d{4,8}|\d{3}[ -]\d{3})(?![\d.:/-]|\s*(?:년|월|일|시|분|원))/g;
const APPROVAL_KEYWORD = /^승인\s*(번호|코드)$/;
const PAYMENT_CONTEXT = /\d[\d,]*\s*원|금액|결제|승인\s*취소|일시불|할부|누적/;
const OTP_WINDOW = 30;
// 카드: 포맷 고정(4-4-4-x, 아멕스 4-6-5) 또는 연속 13~19자리
const CARD_LIKE = /(?<!\d)(?:\d{4}([ .-])\d{4}\1\d{4}\1\d{1,7}|\d{4}([ .-])\d{6}\2\d{4,5}|\d{13,19})(?!\d)/g;
// 계좌 후보: 하이픈 그룹(총 10~14자리) 또는 연속 10~16자리. 자릿수·키워드 ±20자는 코드에서 검사
const ACCOUNT_LIKE = /(?<![\d-])(?:\d{2,6}(?:-\d{2,6}){2,3}|\d{10,16})(?![\d-])/g;
const ACCOUNT_KEYWORD = /은행|뱅크|계좌|예금주|입금|농협|신협|수협|우체국|새마을금고|신한|국민|기업|IBK|KB|NH|SC제일|씨티/;
const ACCOUNT_WINDOW = 20;
// 정보통신망법 광고 표기 "(광고)"
const AD_MARK = /^\s*(?:\[Web발신\]\s*)?[(\[]\s*광고\s*[)\]]/;

type Range = { start: number; end: number };

export function luhn(digits: string): boolean {
  let sum = 0, alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    if (alt) { d *= 2; if (d > 9) d -= 9; }
    sum += d; alt = !alt;
  }
  return sum % 10 === 0;
}

function windowAround(r: Range, n: number, length: number): Range {
  return { start: Math.max(0, r.start - n), end: Math.min(length, r.end + n) };
}

function matchesIn(re: RegExp, s: string, w: Range = { start: 0, end: s.length }): Range[] {
  return Array.from(s.slice(w.start, w.end).matchAll(re), (m) => ({ start: w.start + m.index!, end: w.start + m.index! + m[0].length }));
}

// 숫자만 마지막 4자리를 남기고 `*`로 바꾼다. 구분자는 유지한다
function maskDigits(raw: string): string {
  const total = raw.replace(/\D/g, "").length;
  let seen = 0;
  return raw.replace(/\d/g, (d) => (++seen > total - 4 ? d : "*"));
}

function replaceRange(s: string, r: Range, f: (raw: string) => string): string {
  return s.slice(0, r.start) + f(s.slice(r.start, r.end)) + s.slice(r.end);
}

// OTP 폐기 판정 + 승인번호·카드·계좌 마스킹 (RuleFilter.mask). otp면 null (maskOnly면 판정 없이 마스킹만)
function scan(text: string, maskOnly = false): string | null {
  const isPayment = PAYMENT_CONTEXT.test(text);
  const approval: Range[] = [];
  for (const k of matchesIn(OTP_KEYWORD, text)) {
    const digits = matchesIn(OTP_DIGITS, text, windowAround(k, OTP_WINDOW, text.length));
    if (digits.length === 0) continue;
    if (isPayment && APPROVAL_KEYWORD.test(text.slice(k.start, k.end))) {
      const d = digits.find((d) => d.start >= k.end);                     // 키워드 뒤쪽 첫 숫자만 승인번호
      if (d) approval.push(d);
      continue;
    }
    if (!maskOnly) return null;
  }
  let out = text;
  for (const r of approval.sort((a, b) => b.start - a.start)) out = replaceRange(out, r, (raw) => raw.replace(/\d/g, "*"));
  // 카드번호: Luhn 통과하는 13~19자리만
  for (const m of matchesIn(CARD_LIKE, out).reverse()) {
    const digits = out.slice(m.start, m.end).replace(/\D/g, "");
    if (digits.length < 13 || digits.length > 19 || !luhn(digits)) continue;
    out = replaceRange(out, m, maskDigits);
  }
  // 계좌번호: 앞뒤 20자 안에 은행·계좌 키워드
  for (const m of matchesIn(ACCOUNT_LIKE, out).reverse()) {
    const raw = out.slice(m.start, m.end);
    const n = raw.replace(/\D/g, "").length;
    if (raw.includes("-") ? n < 10 || n > 14 : n < 10 || n > 16) continue;
    const w = windowAround(m, ACCOUNT_WINDOW, out.length);
    if (!ACCOUNT_KEYWORD.test(out.slice(w.start, w.end))) continue;
    out = replaceRange(out, m, maskDigits);
  }
  return out;
}

export function isOtp(s: string): boolean {
  return scan(s) === null;
}

// OTP 판정 없이 승인번호·카드·계좌 마스킹만
export function maskSensitive(s: string): string {
  return scan(s, true)!;
}

// OTP 판정은 제목+본문을 합친 문자열로 한다(키워드가 제목, 숫자가 본문이어도 폐기). 마스킹은 길이가 보존되므로 합친 결과를 다시 나눈다
export function applyRules(text: string, meta: RuleMeta = {}): RuleVerdict {
  const title = meta.title ?? null;
  const joined = title === null ? text : title + "\n" + text;
  const masked = scan(joined);
  if (masked === null) return { kind: "discard", reason: "otp" };
  if (meta.labels?.includes("CATEGORY_PROMOTIONS")) return { kind: "discard", reason: "promotion" };
  if ([text, title ?? "", meta.sender ?? ""].some((s) => AD_MARK.test(s))) return { kind: "discard", reason: "promotion" };
  if (title === null) return { kind: "pass", masked };
  return { kind: "pass", masked: masked.slice(title.length + 1), maskedTitle: masked.slice(0, title.length) };
}
