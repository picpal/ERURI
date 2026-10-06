import { assert, assertEquals } from "jsr:@std/assert";
import { type CaseFile, judge, parseRuns, type Row, sameMail, summarize, validateCases } from "../scripts/_intent-eval.ts";
import type { MailFields } from "../functions/chat/filters.ts";

const file = JSON.parse(await Deno.readTextFile(new URL("../eval/intent-cases.json", import.meta.url))) as CaseFile;
const M = (o: Partial<MailFields> = {}): MailFields => ({ action: "trash", sender: "합성상점", subject_words: [], received_from: null, received_to: null,
  promotions: true, unread_only: false, ...o });

Deno.test("case file meets the spec composition (question 41 with confusable ≥15 incl. context 5, quoted 3, previous 3, negation 3, ability 2; add 18 incl. context 3, polite 3; mail 17 incl. context 2, polite 2)", () => {
  assertEquals(validateCases(file), []);
  assertEquals(file.today, "2026-10-07");
});

Deno.test("validateCases reports a broken composition and a mail/intent mismatch", () => {
  const broken: CaseFile = { today: "2026-10-07", cases: file.cases.filter((c) => c.id !== "q01").map((c) => c.id === "a01" ? { ...c, mail: M() } : c) };
  const p = validateCases(broken);
  assert(p.some((x) => x.startsWith("question")) && p.some((x) => x.startsWith("a01")), JSON.stringify(p));
});

Deno.test("validateCases fails when a gate sentence id is missing (renamed case)", () => {
  const renamed: CaseFile = { today: "2026-10-07", cases: file.cases.map((c) => c.id === "a12" ? { ...c, id: "a12x" } : c) };
  assertEquals(validateCases(renamed), ["gate a12 missing"]);
});

Deno.test("parseRuns: positive integer only, default 1 without --runs", () => {
  assertEquals(parseRuns([]), 1);
  assertEquals(parseRuns(["--mail-judged"]), 1);
  assertEquals(parseRuns(["--runs", "3", "--mail-judged"]), 3);
  assertEquals(parseRuns(["--runs", "--mail-judged"]), null);
  assertEquals(parseRuns(["--runs"]), null);
  assertEquals(parseRuns(["--runs", "0"]), null);
  assertEquals(parseRuns(["--runs", "2.5"]), null);
  assertEquals(parseRuns(["--runs", "abc"]), null);
});

Deno.test("sameMail: sender trim/case-insensitive, subject words as a set, dates and booleans exact, read implies unread", () => {
  assert(sameMail(M(), M({ sender: " 합성상점 " })));
  assert(sameMail(M({ sender: "Promo@Synth.example" }), M({ sender: "promo@synth.example" })));
  assert(sameMail(M({ subject_words: ["쿠폰", "할인"] }), M({ subject_words: ["할인", "쿠폰", "쿠폰"] })));
  assert(!sameMail(M({ subject_words: ["쿠폰"] }), M({ subject_words: ["쿠폰", "할인"] })));
  assert(!sameMail(M({ received_from: "2026-09-01" }), M({ received_from: "2026-09-02" })));
  assert(!sameMail(M(), M({ promotions: false })));
  assert(sameMail(M({ action: "read", unread_only: false }), M({ action: "read", unread_only: true })));   // 읽음은 서버가 늘 is:unread(§7)
  assert(!sameMail(M({ action: "trash", unread_only: false }), M({ action: "trash", unread_only: true })));
  assert(!sameMail(M(), null));
});

Deno.test("judge: mail_ok only for expected mail_action (false when the intent was missed); null otherwise", () => {
  const m = file.cases.find((c) => c.id === "m01")!, q = file.cases.find((c) => c.id === "q01")!;
  assertEquals(judge(m, { intent: "mail_action", mail: m.mail }), { id: "m01", group: "mail", expected: "mail_action", got: "mail_action", mail_ok: true });
  assertEquals(judge(m, { intent: "question", mail: null }).mail_ok, false);
  assertEquals(judge(q, { intent: "add_event", mail: null }), { id: "q01", group: "confusable", expected: "question", got: "add_event", mail_ok: null });
});

Deno.test("summarize: any false positive or confusion fails; recall below 0.9 fails; mail match judged only with mailJudged", () => {
  const ok = (id: string, e: Row["expected"], g: Row["got"], mail_ok: boolean | null = null): Row => ({ id, group: "x", expected: e, got: g, mail_ok });
  const base = [ok("q", "question", "question"), ...Array.from({ length: 10 }, (_, i) => ok(`a${i}`, "add_event", "add_event")),
    ...Array.from({ length: 10 }, (_, i) => ok(`m${i}`, "mail_action", "mail_action", i < 5))];
  const s = summarize(base, 1, false);
  assertEquals([s.gate, s.false_positive, s.recall_add, s.recall_mail, s.confusion, s.mail_match, s.mail_judged], ["pass", 0, 1, 1, 0, 0.5, false]);
  assertEquals(summarize(base, 1, true).gate, "fail");
  assertEquals(summarize([...base, ok("q2", "question", "add_event")], 1, false).gate, "fail");
  const confused = summarize([...base, ok("a9x", "add_event", "mail_action")], 1, false);
  assertEquals([confused.confusion, confused.gate], [1, "fail"]);
  assertEquals(summarize(base.map((r) => r.id === "a0" || r.id === "a1" ? { ...r, got: "question" as const } : r), 1, false).gate, "fail");   // 8/10
});
