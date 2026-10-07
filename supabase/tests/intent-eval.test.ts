import { assert, assertEquals } from "jsr:@std/assert";
import { type Case, type CaseFile, GATE, gateCases, judge, parseRuns, type Row, sameMail, sameRead, summarize, validateCases } from "../scripts/_intent-eval.ts";
import type { Intent, MailFields, MailReadFields } from "../functions/chat/filters.ts";

const file = JSON.parse(await Deno.readTextFile(new URL("../eval/intent-cases.json", import.meta.url))) as CaseFile;
const M = (o: Partial<MailFields> = {}): MailFields => ({ action: "trash", sender: "합성상점", subject_words: [], received_from: null, received_to: null,
  promotions: true, unread_only: false, ...o });

Deno.test("case file meets the 0.15.0 composition (question 50, add_event 18, mail_action 21, mail_summary 23 with summary groups; gate ids present)", () => {
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
  assertEquals(judge(m, { intent: "mail_action", mail: m.mail, mail_read: null }), { id: "m01", group: "mail", expected: "mail_action", got: "mail_action", mail_ok: true,
    read_ok: null, target_ok: null });
  assertEquals(judge(m, { intent: "question", mail: null, mail_read: null }).mail_ok, false);
  assertEquals(judge(q, { intent: "add_event", mail: null, mail_read: null }), { id: "q01", group: "confusable", expected: "question", got: "add_event", mail_ok: null,
    read_ok: null, target_ok: null });
});

Deno.test("summarize: any false positive or confusion fails; recall below 0.9 fails; mail match judged only with mailJudged", () => {
  const ok = (id: string, e: Row["expected"], g: Row["got"], mail_ok: boolean | null = null): Row => ({ id, group: "x", expected: e, got: g, mail_ok, read_ok: null, target_ok: null });
  const base = [ok("q", "question", "question"), ...Array.from({ length: 10 }, (_, i) => ok(`a${i}`, "add_event", "add_event")),
    ...Array.from({ length: 10 }, (_, i) => ok(`m${i}`, "mail_action", "mail_action", i < 5)),
    ...Array.from({ length: 10 }, (_, i) => ok(`s${i}`, "mail_summary", "mail_summary"))];   // 0.15.0: 세 행동 모두 재현율 ≥ 0.9
  const s = summarize(base, 1, false);
  assertEquals([s.gate, s.false_positive, s.recall_add, s.recall_mail, s.confusion, s.mail_match, s.mail_judged], ["pass", 0, 1, 1, 0, 0.5, false]);
  assertEquals(summarize(base, 1, true).gate, "fail");
  assertEquals(summarize([...base, ok("q2", "question", "add_event")], 1, false).gate, "fail");
  const confused = summarize([...base, ok("a9x", "add_event", "mail_action")], 1, false);
  assertEquals([confused.confusion, confused.gate], [1, "fail"]);
  assertEquals(summarize(base.map((r) => r.id === "a0" || r.id === "a1" ? { ...r, got: "question" as const } : r), 1, false).gate, "fail");   // 8/10
});

Deno.test("gateCases: every gate id in every run needs the expected intent and, for mail, matching fields; a missing id fails", () => {
  const row = (id: string, r: Partial<Row> = {}): Row => {
    const c = file.cases.find((x) => x.id === id)!;
    return { id, group: c.group, expected: c.intent, got: c.intent, mail_ok: c.intent === "mail_action" ? true : null,
      read_ok: c.intent === "mail_summary" ? true : null, target_ok: c.intent === "mail_summary" ? true : null, ...r };
  };
  const ids = [...GATE];   // 0.15.0: 13개 — 인덱스 3 = q04, 5 = m18 은 그대로
  const two = [...ids.map((id) => row(id)), ...ids.map((id) => row(id))];
  assert(gateCases(two));
  assert(!gateCases(two.map((r, i) => i === ids.length + 5 ? { ...r, mail_ok: false } : r)));   // 2회차 m18 칸 불일치
  assert(!gateCases(two.map((r, i) => i === 3 ? { ...r, got: "add_event" as const } : r)));       // q04 오탐
  assert(!gateCases(two.filter((r) => r.id !== "m20")));
});

const RD = (o: Partial<MailReadFields> = {}): MailReadFields => ({ sender: "합성상점", subject_words: [], received_from: null, received_to: null, latest: false,
  translate: false, target_in_message: true, ...o });
const sCase = (o: Partial<Case> = {}): Case => ({ id: "s99", group: "summary", text: "x", intent: "mail_summary", mail: null, mail_read: RD(), ...o });

Deno.test("validateCases: mail_read only on mail_summary cases; judge only on mail_summary; summary_follow needs context", () => {
  const bad: CaseFile = { today: "2026-10-07", cases: file.cases.map((c) => c.id === "q01" ? { ...c, mail_read: RD() } : c.id === "s16" ? { ...c, context: undefined } : c) };
  const p = validateCases(bad);
  assert(p.some((x) => x.startsWith("q01")) && p.some((x) => x.startsWith("s16")), JSON.stringify(p));
});
Deno.test("sameRead: sender case/space-insensitive, subject word set, dates and flags exact; targetOnly compares target_in_message only", () => {
  assertEquals(sameRead(RD(), RD({ sender: " 합성상점 " }), false), true);
  assertEquals(sameRead(RD({ subject_words: ["ERURI", "요약"] }), RD({ subject_words: ["요약", "ERURI", " "] }), false), true);
  assertEquals(sameRead(RD(), RD({ latest: true }), false), false);
  assertEquals(sameRead(RD(), RD({ target_in_message: false }), false), false);
  assertEquals(sameRead(RD({ sender: null, translate: true, target_in_message: false }), RD({ sender: "합성은행", target_in_message: false }), true), true);
  assertEquals(sameRead(RD(), null, false), false);
});
Deno.test("judge: read_ok/target_ok only for mail_summary; a judge:'target' case leaves read_ok null", () => {
  const q = judge(file.cases.find((c) => c.id === "q01")!, { intent: "question", mail: null, mail_read: null });
  assertEquals([q.read_ok, q.target_ok], [null, null]);
  assertEquals(judge(sCase(), { intent: "mail_summary", mail: null, mail_read: RD() }), { id: "s99", group: "summary", expected: "mail_summary", got: "mail_summary",
    mail_ok: null, read_ok: true, target_ok: true });
  const f = judge(sCase({ judge: "target", mail_read: RD({ sender: null, target_in_message: false }) }), { intent: "mail_summary", mail: null, mail_read: RD({ target_in_message: false }) });
  assertEquals([f.read_ok, f.target_ok], [null, true]);
  assertEquals(judge(sCase(), { intent: "mail_action", mail: null, mail_read: null }).read_ok, false);
});
Deno.test("summarize: recall per action, any action↔action confusion fails, read match ≥ 0.9 and target ≥ 0.95 when read-judged", () => {
  const row = (expected: Intent, got: Intent, o: Partial<Row> = {}): Row => ({ id: "x", group: "g", expected, got, mail_ok: null, read_ok: null, target_ok: null, ...o });
  const good = [...Array(10)].map(() => row("mail_summary", "mail_summary", { read_ok: true, target_ok: true }));
  assertEquals(summarize(good, 1, false, true).gate, "fail");                       // add_event·mail_action 재현율 0
  const all = [...good, ...[...Array(10)].map(() => row("add_event", "add_event")), ...[...Array(10)].map(() => row("mail_action", "mail_action", { mail_ok: true }))];
  assertEquals(summarize(all, 1, true, true).gate, "pass");
  assertEquals(summarize([...all, row("mail_summary", "mail_action", { read_ok: false, target_ok: false })], 1, true, true).confusion, 1);
  const weakTarget = all.map((r, i) => i < 1 ? { ...r, target_ok: false } : r);
  assertEquals(summarize(weakTarget, 1, true, true).gate, "fail");                  // target 0.9 < 0.95
  assertEquals(summarize(weakTarget, 1, true, false).gate, "pass");                 // read 판정 안 하면 0.14.0 기준
});
Deno.test("gateCases: 0.15.0 gate ids (s20~s22) and follow-ups (s15 target only, s16) must hold in every run", () => {
  assert(GATE.includes("s15") && GATE.includes("s22"));
  const rows = GATE.map((id) => ({ id, group: "g", expected: "mail_summary" as Intent, got: "mail_summary" as Intent, mail_ok: null, read_ok: id === "s15" ? null : true, target_ok: true }));
  assertEquals(gateCases(rows), true);
  assertEquals(gateCases(rows.map((r) => r.id === "s15" ? { ...r, target_ok: false } : r)), false);
});
