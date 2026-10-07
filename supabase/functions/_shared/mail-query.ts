// 메일 정리 지목(스펙 §7 "메일 정리"): 칸 검사·정제·검색어 조립을 한 곳에서 한다. chat 은 모델 출력 그대로 넘기고 앱이 보낸 칸도 믿지 않는다.
// 모델·앱이 쓴 검색어 문자열(q 등 모르는 키)은 읽지 않는다. 잘못된 칸은 버리지 않고 거절한다 — 버리면 범위가 넓어진다(리뷰 #1)
export type MailAction = "trash" | "read";
export type MailConditions = {
  action: MailAction; sender: string | null; subject_words: string[];
  received_from: string | null; received_to: string | null; promotions: boolean; unread_only: boolean;
};
export type CheckResult =
  | { ok: true; c: MailConditions }
  | { ok: false; code: "bad_condition"; fields: string[] }
  | { ok: false; code: "needs_target" };

export const SENDER_MAX = 100, WORD_MAX = 30, WORDS_MAX = 3;
export const YEAR_MIN = 2004;                                         // Gmail 출시 전 날짜는 거절(음수 epoch — Gmail 이 무시하면 범위가 넓어진다, D21)
// 비표시 문자(\p{Default_Ignorable_Code_Point} — 한글 채움 U+115F·U+1160·U+3164·U+FFA0 은 \p{Lo} 라 따로 적는다, ZWSP·ZWJ·BOM 포함)도 지운다.
// 그것만 남으면 Gmail 이 그 구를 무시할 수 있어(미확인) 기호뿐인 값처럼 거절돼야 한다(D21, 리뷰 I1)
const DROP = /[^\p{L}\p{M}\p{N}\s@._+-]|[\p{Default_Ignorable_Code_Point}\u115F\u1160\u3164\uFFA0]/gu;
const WORDY = /[\p{L}\p{N}]/u;                                         // 정제 뒤 글자·숫자가 하나는 있어야 한다(기호만 남은 구는 거절, D21)
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

// 글자·숫자·공백과 @._+- 만 남긴다(따옴표·괄호·중괄호·콜론·역슬래시 등은 지운다). 결과는 늘 따옴표로 감싸 쓴다.
// 지운 뒤 NFC — 지우기가 결합 문자를 앞 글자에 붙여 주므로 이 순서여야 멱등이다(다시 미리보기, D15)
export function sanitize(v: string): string {
  return v.replace(DROP, "").normalize("NFC").replace(/\s+/g, " ").trim();
}

// 서울 날짜(YYYY-MM-DD)의 0시 epoch 초. 달력에 없는 날(2026-02-30)·다른 모양은 null
export function seoulMidnight(day: string): number | null {
  const m = DAY.exec(day);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const t = Date.UTC(y, mo - 1, d), back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return t / 1000 - 9 * 3600;
}

export function checkConditions(raw: unknown): CheckResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, code: "bad_condition", fields: ["mail"] };
  const r = raw as Record<string, unknown>;
  const bad: string[] = [];
  const action = r.action === "trash" || r.action === "read" ? r.action : null;
  if (!action) bad.push("action");

  let sender: string | null = null;
  if (r.sender !== null && r.sender !== undefined) {
    if (typeof r.sender !== "string" || r.sender.length > SENDER_MAX) bad.push("sender");
    else if (r.sender.trim() !== "") {
      const s = sanitize(r.sender);
      if (!WORDY.test(s)) bad.push("sender"); else sender = s;
    }
  }

  const words: string[] = [];
  if (r.subject_words !== null && r.subject_words !== undefined) {
    const w = r.subject_words;
    if (!Array.isArray(w) || w.length > WORDS_MAX || w.some((x) => typeof x !== "string" || x.length > WORD_MAX)) bad.push("subject_words");
    else {
      for (const x of w as string[]) {
        if (x.trim() === "") continue;
        const s = sanitize(x);
        if (!WORDY.test(s)) { bad.push("subject_words"); break; }
        if (!words.includes(s)) words.push(s);
      }
    }
  }

  const day = (k: "received_from" | "received_to"): string | null => {
    const v = r[k];
    if (v === null || v === undefined) return null;
    if (typeof v !== "string" || seoulMidnight(v) === null || Number(v.slice(0, 4)) < YEAR_MIN) { bad.push(k); return null; }
    return v;
  };
  const from = day("received_from"), to = day("received_to");
  if (from && to && from > to) bad.push("received_from", "received_to");

  const flag = (k: "promotions" | "unread_only"): boolean => {
    const v = r[k];
    if (v === null || v === undefined) return false;
    if (typeof v !== "boolean") { bad.push(k); return false; }
    return v;
  };
  const promotions = flag("promotions"), unread = flag("unread_only");

  if (bad.length) return { ok: false, code: "bad_condition", fields: [...new Set(bad)] };
  // 휴지통 범위 하한: 받은편지함 전체를 휴지통으로 보내지 않게(안 읽음만으로는 부족). 읽음은 되돌릴 수 있고 메일이 없어지지 않는다
  if (action === "trash" && !sender && words.length === 0 && !from && !to && !promotions) return { ok: false, code: "needs_target" };
  return { ok: true, c: { action: action!, sender, subject_words: words, received_from: from, received_to: to, promotions,
                          unread_only: action === "read" ? true : unread } };
}

// 늘 in:inbox -is:starred(별표 수는 starred = true 로 is:starred). 스팸·휴지통은 includeSpamTrash 기본값(false)으로 빠진다
// checkConditions 의 ok 결과만 받는다 — 따옴표가 남은 값·달력 밖 날짜는 호출 규약 위반이라 throw(조립이 연산자를 만들지 않게, 리뷰 Minor 1)
export function buildQuery(c: MailConditions, starred = false): string {
  const quoted = (v: string): string => { if (v.includes('"')) throw new Error("buildQuery: unchecked value"); return `"${v}"`; };
  const epoch = (d: string): number => { const t = seoulMidnight(d); if (t === null) throw new Error("buildQuery: unchecked date"); return t; };
  const q = ["in:inbox", starred ? "is:starred" : "-is:starred"];
  if (c.sender) q.push(`from:${quoted(c.sender)}`);
  for (const w of c.subject_words) q.push(`subject:${quoted(w)}`);
  if (c.received_from) q.push(`after:${epoch(c.received_from)}`);
  if (c.received_to) q.push(`before:${epoch(c.received_to) + 86_400}`);
  if (c.promotions) q.push("category:promotions");
  if (c.unread_only || c.action === "read") q.push("is:unread");
  return q.join(" ");
}

// ── 메일 요약 지목(스펙 §7 "메일 요약", 0.15.0): 같은 정제·날짜 규칙, 칸이 다르다(동작·광고·안 읽음 없음, latest·translate 있음).
// 메일 정리 checkConditions·buildQuery 는 바꾸지 않는다(0.14.0 회귀 없음) — 그래서 칸 읽기를 따로 둔다. target_in_message 는 앱만 쓴다(검색은 읽지 않음) ──
export type ReadConditions = { sender: string | null; subject_words: string[]; received_from: string | null; received_to: string | null;
  latest: boolean; translate: boolean };
export type ReadCheck =
  | { ok: true; c: ReadConditions }
  | { ok: false; code: "bad_condition"; fields: string[] }
  | { ok: false; code: "needs_target" };

function readSender(v: unknown, bad: string[]): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string" || v.length > SENDER_MAX) { bad.push("sender"); return null; }
  if (v.trim() === "") return null;
  const s = sanitize(v);
  if (!WORDY.test(s)) { bad.push("sender"); return null; }
  return s;
}
function readWords(v: unknown, bad: string[]): string[] {
  const words: string[] = [];
  if (v === null || v === undefined) return words;
  if (!Array.isArray(v) || v.length > WORDS_MAX || v.some((x) => typeof x !== "string" || x.length > WORD_MAX)) { bad.push("subject_words"); return words; }
  for (const x of v as string[]) {
    if (x.trim() === "") continue;
    const s = sanitize(x);
    if (!WORDY.test(s)) { bad.push("subject_words"); return []; }
    if (!words.includes(s)) words.push(s);
  }
  return words;
}
function readDay(r: Record<string, unknown>, k: "received_from" | "received_to", bad: string[]): string | null {
  const v = r[k];
  if (v === null || v === undefined) return null;
  if (typeof v !== "string" || seoulMidnight(v) === null || Number(v.slice(0, 4)) < YEAR_MIN) { bad.push(k); return null; }
  return v;
}
function readFlag(r: Record<string, unknown>, k: "latest" | "translate", bad: string[]): boolean {
  const v = r[k];
  if (v === null || v === undefined) return false;
  if (typeof v !== "boolean") { bad.push(k); return false; }
  return v;
}

export function checkReadConditions(raw: unknown): ReadCheck {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, code: "bad_condition", fields: ["mail_read"] };
  const r = raw as Record<string, unknown>;
  const bad: string[] = [];
  const sender = readSender(r.sender, bad);
  const words = readWords(r.subject_words, bad);
  const from = readDay(r, "received_from", bad), to = readDay(r, "received_to", bad);
  if (from && to && from > to) bad.push("received_from", "received_to");
  const latest = readFlag(r, "latest", bad), translate = readFlag(r, "translate", bad);
  if (bad.length) return { ok: false, code: "bad_condition", fields: [...new Set(bad)] };
  // 대상 하한: 발신자·제목 단어·받은 기간(한쪽 끝도 됨)·latest 중 하나. translate 만으로는 채우지 않는다(§7)
  if (!sender && words.length === 0 && !from && !to && !latest) return { ok: false, code: "needs_target" };
  return { ok: true, c: { sender, subject_words: words, received_from: from, received_to: to, latest, translate } };
}

// in:inbox 를 붙이지 않는다(보관된 메일 포함). 스팸·휴지통은 includeSpamTrash 기본값(false)으로 빠지고, 보낸 메일·초안·채팅은 검색어가 아니라
// 후보 메타 라벨로 거른다(부정 연산자의 API 단위가 미확정 — §3, SUMMARY-real ⓪). latest·translate 는 검색어에 들어가지 않는다.
// windowStart = latest 시간 창의 시작 epoch 초(받은 기간 시작 뒤에 더한다). checkReadConditions 의 ok 결과만 받는다
export function buildReadQuery(c: ReadConditions, windowStart?: number): string {
  const quoted = (v: string): string => { if (v.includes('"')) throw new Error("buildReadQuery: unchecked value"); return `"${v}"`; };
  const epoch = (d: string): number => { const t = seoulMidnight(d); if (t === null) throw new Error("buildReadQuery: unchecked date"); return t; };
  const q: string[] = [];
  if (c.sender) q.push(`from:${quoted(c.sender)}`);
  for (const w of c.subject_words) q.push(`subject:${quoted(w)}`);
  if (c.received_from) q.push(`after:${epoch(c.received_from)}`);
  if (windowStart !== undefined) {
    if (!Number.isInteger(windowStart) || windowStart < 0) throw new Error("buildReadQuery: bad window");
    q.push(`after:${windowStart}`);
  }
  if (c.received_to) q.push(`before:${epoch(c.received_to) + 86_400}`);
  return q.join(" ");
}
