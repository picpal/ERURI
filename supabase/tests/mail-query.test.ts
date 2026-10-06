import { assertEquals, assertThrows } from "jsr:@std/assert";
import type { MailFields } from "../functions/chat/filters.ts";
import { buildQuery, checkConditions, type MailConditions, sanitize, seoulMidnight } from "../functions/_shared/mail-query.ts";

// 메일 정리 지목(스펙 §7): 칸 검사·정제·서버 조립. 잘못된 칸은 버리지 않고 거절한다(리뷰 #1)
const base = { action: "trash", sender: null, subject_words: [], received_from: null, received_to: null, promotions: false, unread_only: false };
const ok = (raw: Record<string, unknown>) => {
  const r = checkConditions({ ...base, ...raw });
  if (!r.ok) throw new Error("expected ok, got " + JSON.stringify(r));
  return r.c;
};
const S = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d) / 1000 - 9 * 3600;   // 서울 0시 epoch 초

Deno.test("buildQuery: always in:inbox -is:starred first; sender/subject quoted; dates in Seoul; promotions; read adds is:unread", () => {
  const c = ok({ sender: "합성상점", subject_words: ["주문", "안내"], received_from: "2026-09-01", received_to: "2026-09-30", promotions: true });
  assertEquals(buildQuery(c), `in:inbox -is:starred from:"합성상점" subject:"주문" subject:"안내" after:${S(2026, 9, 1)} before:${S(2026, 10, 1)} category:promotions`);
  assertEquals(buildQuery(ok({ action: "read" })), "in:inbox -is:starred is:unread");
  assertEquals(buildQuery(ok({ promotions: true, unread_only: true })), "in:inbox -is:starred category:promotions is:unread");
  assertEquals(buildQuery(ok({ promotions: true }), true), "in:inbox is:starred category:promotions");
});

Deno.test("seoulMidnight: calendar dates only; 2026-02-30 and bad shapes are null", () => {
  assertEquals(seoulMidnight("2026-09-01"), S(2026, 9, 1));
  assertEquals(seoulMidnight("2026-02-30"), null);
  assertEquals(seoulMidnight("2026-9-1"), null);
  assertEquals(seoulMidnight("2026-13-01"), null);
});

Deno.test("sanitize: keeps letters, digits, spaces and @._+- only; quotes, parens, braces, colons, backslashes and emoji go", () => {
  assertEquals(sanitize(`합성"상점"(광고)`), "합성상점광고");
  assertEquals(sanitize("news@shop.example.com"), "news@shop.example.com");
  assertEquals(sanitize("a OR b"), "a OR b");                       // 따옴표 안이라 연산자가 아니다
  assertEquals(sanitize("in:anywhere {x} \\y"), "inanywhere x y");
  assertEquals(sanitize("합성🙂상점  "), "합성상점");
  assertEquals(sanitize("cafe\u0301"), "café");                     // 결합 문자는 NFC 로 합친 뒤 남는다
  for (const x of ["e🙂\u0301", "합성\"상점\"", "a  {b}  c", "❤️x"]) assertEquals(sanitize(sanitize(x)), sanitize(x), x);   // 멱등(D15·D21): 지운 뒤 NFC
  assertEquals(sanitize("e🙂\u0301"), "é");
  assertEquals(sanitize("합성\u3164상점\u200B"), "합성상점");          // 비표시 문자는 지운다(리뷰 I1)
  for (const x of ["\u3164a\u0301", "a\u200B\u0301", "\uFFA0ㅤ합성"]) assertEquals(sanitize(sanitize(x)), sanitize(x), x);
});

Deno.test("symbol-only values and pre-2004 dates are rejected (they could make Gmail ignore the term and widen the range)", () => {
  // 비표시 문자(한글 채움 U+3164·U+FFA0·U+115F·U+1160, ZWSP·ZWJ·BOM)는 \p{L} 이어도 지운다 — 그것만 있으면 기호뿐인 값과 같다(리뷰 I1)
  for (const s of ["-", ".", "@._+-", "❤️", "--", "_", "\u3164", "\uFFA0", "\u115F\u1160", "\u200B", "\u200D\uFEFF", "-\u3164"]) {
    assertEquals(checkConditions({ ...base, sender: s }), { ok: false, code: "bad_condition", fields: ["sender"] }, s);
    assertEquals(checkConditions({ ...base, promotions: true, subject_words: [s] }), { ok: false, code: "bad_condition", fields: ["subject_words"] }, s);
  }
  assertEquals(checkConditions({ ...base, received_from: "1999-12-31" }), { ok: false, code: "bad_condition", fields: ["received_from"] });
  assertEquals(checkConditions({ ...base, received_to: "1969-12-31" }), { ok: false, code: "bad_condition", fields: ["received_to"] });
  assertEquals(ok({ received_from: "2004-01-01" }).received_from, "2004-01-01");
  assertEquals(ok({ sender: "a-b" }).sender, "a-b");                                              // 글자가 있으면 기호는 남는다
});

Deno.test("query shape: one-day range, end only, start only", () => {
  assertEquals(buildQuery(ok({ received_from: "2026-09-01", received_to: "2026-09-01" })), `in:inbox -is:starred after:${S(2026, 9, 1)} before:${S(2026, 9, 2)}`);
  assertEquals(buildQuery(ok({ received_to: "2026-09-30" })), `in:inbox -is:starred before:${S(2026, 10, 1)}`);
  assertEquals(buildQuery(ok({ received_from: "2026-09-01" })), `in:inbox -is:starred after:${S(2026, 9, 1)}`);
});

Deno.test("operators inside values stay literal: from:\"a OR b\" and a leading minus is quoted", () => {
  assertEquals(buildQuery(ok({ sender: "a OR b" })), `in:inbox -is:starred from:"a OR b"`);
  assertEquals(buildQuery(ok({ subject_words: ["-광고"] })), `in:inbox -is:starred subject:"-광고"`);
});

Deno.test("rejects instead of dropping: reversed range, impossible date, empty after sanitize, too long, too many words, wrong types", () => {
  assertEquals(checkConditions({ ...base, sender: "합성상점", received_from: "2026-09-30", received_to: "2026-09-01" }),
    { ok: false, code: "bad_condition", fields: ["received_from", "received_to"] });
  assertEquals(checkConditions({ ...base, promotions: true, received_from: "2026-02-30" }), { ok: false, code: "bad_condition", fields: ["received_from"] });
  assertEquals(checkConditions({ ...base, sender: `"()"` }), { ok: false, code: "bad_condition", fields: ["sender"] });
  assertEquals(checkConditions({ ...base, sender: "x".repeat(101) }), { ok: false, code: "bad_condition", fields: ["sender"] });
  assertEquals(checkConditions({ ...base, subject_words: ["y".repeat(31)] }), { ok: false, code: "bad_condition", fields: ["subject_words"] });
  assertEquals(checkConditions({ ...base, subject_words: ["a", "b", "c", "d"] }), { ok: false, code: "bad_condition", fields: ["subject_words"] });
  assertEquals(checkConditions({ ...base, subject_words: ["a", "{}"] }), { ok: false, code: "bad_condition", fields: ["subject_words"] });
  assertEquals(checkConditions({ ...base, promotions: "yes" }), { ok: false, code: "bad_condition", fields: ["promotions"] });
  assertEquals(checkConditions({ ...base, sender: "a", received_to: 20260930 }), { ok: false, code: "bad_condition", fields: ["received_to"] });
  assertEquals(checkConditions({ ...base, action: "delete" }), { ok: false, code: "bad_condition", fields: ["action"] });
  assertEquals(checkConditions({ ...base, sender: 5 }), { ok: false, code: "bad_condition", fields: ["sender"] });
  assertEquals(checkConditions({ ...base, promotions: true, subject_words: "주문" }), { ok: false, code: "bad_condition", fields: ["subject_words"] });
  assertEquals(checkConditions({ ...base, promotions: true, subject_words: [1] }), { ok: false, code: "bad_condition", fields: ["subject_words"] });
  assertEquals(checkConditions(null), { ok: false, code: "bad_condition", fields: ["mail"] });
  assertEquals(checkConditions([base]), { ok: false, code: "bad_condition", fields: ["mail"] });
  assertEquals(checkConditions("in:inbox"), { ok: false, code: "bad_condition", fields: ["mail"] });
});

Deno.test("needs_target: trash needs sender/subject/date/promotions (unread alone is not enough); read needs nothing", () => {
  assertEquals(checkConditions({ ...base }), { ok: false, code: "needs_target" });
  assertEquals(checkConditions({ ...base, unread_only: true }), { ok: false, code: "needs_target" });
  assertEquals(checkConditions({ ...base, sender: "   " }), { ok: false, code: "needs_target" });   // 공백뿐 = 값 없음
  assertEquals(ok({ received_to: "2026-09-30" }).received_to, "2026-09-30");
  assertEquals(ok({ action: "read" }).unread_only, true);                                        // 읽음은 늘 안 읽은 메일만
});

Deno.test("model-written query strings and unknown keys are never read", () => {
  const c = ok({ promotions: true, q: "in:anywhere", query: "label:x", from: "boss@example.com" });
  assertEquals(buildQuery(c), "in:inbox -is:starred category:promotions");
});

Deno.test("absent booleans and dates are false/none; blank words are skipped; duplicate words after sanitize are one", () => {
  const r = checkConditions({ action: "trash", sender: "합성상점" });
  assertEquals(r, { ok: true, c: { ...base, sender: "합성상점" } as MailConditions });
  assertEquals(ok({ subject_words: ["주문", " ", "주문!"] }).subject_words, ["주문"]);
  assertEquals(ok({ promotions: true, subject_words: [" "] }).subject_words, []);               // 공백뿐 = 값 없음(거절 아님)
});

Deno.test("conditions round-trip: checking the returned conditions again gives the same conditions (re-preview sends them back)", () => {
  const c = ok({ sender: `합성"상점"`, subject_words: ["ERURI", "테스트"], received_from: "2026-09-01", promotions: true });
  assertEquals(checkConditions(c), { ok: true, c });
  const r = ok({ action: "read" });
  assertEquals(checkConditions(r), { ok: true, c: r });
});

Deno.test("chat MailFields (0.13.0) passes as-is", () => {
  const f: MailFields = { action: "read", sender: "뉴스레터", subject_words: [], received_from: "2026-09-28", received_to: "2026-10-04", promotions: false, unread_only: true };
  const _c: MailConditions = f;                                                                 // 컴파일 단계 타입 호환(리뷰 Minor 4)
  assertEquals(checkConditions(f).ok, true);
});

Deno.test("injection strings end to end: quotes of any kind, operators, newlines and tabs end up inside one quoted term", () => {
  assertEquals(buildQuery(ok({ sender: `x" OR in:anywhere "y` })), `in:inbox -is:starred from:"x OR inanywhere y"`);
  assertEquals(buildQuery(ok({ sender: "＂a＂ OR ＂b＂" })), `in:inbox -is:starred from:"a OR b"`);
  assertEquals(buildQuery(ok({ sender: "“a” in:anywhere ‘b’" })), `in:inbox -is:starred from:"a inanywhere b"`);
  assertEquals(buildQuery(ok({ sender: "a\nb\tc", subject_words: ["x\n-in:trash", "y\" OR \"z"] })),
    `in:inbox -is:starred from:"a b c" subject:"x -intrash" subject:"y OR z"`);
});

Deno.test("buildQuery refuses conditions that did not come from checkConditions (bad date, leftover quote)", () => {
  const c = ok({ promotions: true });
  assertThrows(() => buildQuery({ ...c, sender: 'a" OR "b' }));
  assertThrows(() => buildQuery({ ...c, subject_words: ['a"'] }));
  assertThrows(() => buildQuery({ ...c, received_from: "2026-02-30" }));
  assertThrows(() => buildQuery({ ...c, received_to: "2026-9-1" }));
});
