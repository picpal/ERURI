// INTENT-eval(스펙 §15, 0.13.0·0.14.0·0.15.0 공유): 합성 문장으로 chat 필터의 의도(변환 전)와 메일 정리·메일 요약 칸을 잰다 — 판정·집계 순수 함수. 문장 글은 출력하지 않는다(id 만)
import type { Intent, MailFields, MailReadFields } from "../functions/chat/filters.ts";

export type Case = { id: string; group: string; text: string; context?: { question: string; answer: string }[]; intent: Intent; mail: MailFields | null;
  mail_read?: MailReadFields | null; judge?: "target" };
export type CaseFile = { today: string; cases: Case[] };
export type Got = { intent: Intent; mail: MailFields | null; mail_read: MailReadFields | null };
export type Row = { id: string; group: string; expected: Intent; got: Intent; mail_ok: boolean | null; read_ok: boolean | null; target_ok: boolean | null };

// 스펙 §15 구성(0.15.0: 112 = question 50 · add_event 18 · mail_action 21 · mail_summary 23). 사례를 더하면 이 수도 같이 고친다
const WANT = { question: 50, add_event: 18, mail_action: 21, mail_summary: 23 } as const;
const GROUP_MIN: Record<string, number> = { confusable_ctx: 6, quoted: 4, prev_command: 4, negation: 4, ability: 3, add_ctx: 3, add_polite: 3, mail_ctx: 2, mail_polite: 2,
  summary: 8, summary_translate: 3, summary_latest: 2, summary_ctx: 2, summary_follow: 2, summary_polite: 2, summary_both: 1, summary_gate: 3 };
// 3회 모두 기대값이어야 하는 문장: 0.13.0 ADD-sim(a01·a12·a13·q04), 0.14.0 메일 정리 게이트(m01·m18~m20), 0.15.0 요약 게이트(s20~s22)·직전 요약 뒤 후속(s15 target·translate 만·s16)
// — 재현율 0.9 합격선은 특정 문장의 실패를 허용하므로 게이트 문장을 고정한다(Fable F2, 메일 정리 계획 리뷰 N-M11)
export const GATE = ["a01", "a12", "a13", "q04", "m01", "m18", "m19", "m20", "s15", "s16", "s20", "s21", "s22"] as const;

// --runs N: 1 이상 정수만(없으면 1). NaN 이면 0행이 되어 gate_cases 가 빈 every 로 참이 된다(최종 리뷰 Minor 2)
export function parseRuns(args: string[]): number | null {
  const i = args.indexOf("--runs");
  if (i < 0) return 1;
  const v = args[i + 1];
  return v !== undefined && /^[1-9]\d*$/.test(v) ? Number(v) : null;
}

export function validateCases(f: CaseFile): string[] {
  const p: string[] = [];
  for (const [k, n] of Object.entries(WANT)) {
    const got = f.cases.filter((c) => c.intent === k).length;
    if (got !== n) p.push(`${k} ${got} != ${n}`);
  }
  const confusable = f.cases.filter((c) => c.group === "confusable" || c.group === "confusable_ctx").length;
  if (confusable < 19) p.push(`confusable ${confusable} < 19`);
  for (const [g, n] of Object.entries(GROUP_MIN)) {
    const got = f.cases.filter((c) => c.group === g).length;
    if (got < n) p.push(`${g} ${got} < ${n}`);
  }
  const ids = new Set<string>();
  for (const c of f.cases) {
    if (ids.has(c.id)) p.push(`${c.id} duplicate`);
    ids.add(c.id);
    if ((c.intent === "mail_action") !== (c.mail !== null)) p.push(`${c.id} mail must be set only for mail_action`);
    if ((c.intent === "mail_summary") !== ((c.mail_read ?? null) !== null)) p.push(`${c.id} mail_read must be set only for mail_summary`);
    if (c.judge !== undefined && (c.judge !== "target" || c.intent !== "mail_summary")) p.push(`${c.id} judge only 'target' on mail_summary`);
    if (c.group.endsWith("_ctx") || c.group === "prev_command" || c.group === "summary_follow") { if (!c.context?.length) p.push(`${c.id} needs context`); }
  }
  for (const id of GATE) if (!ids.has(id)) p.push(`gate ${id} missing`);
  return p;
}

// 서버가 조립할 검색어 기준 동등(D12): 발신자 대소문자·앞뒤 공백 무시, 제목 단어 집합, 날짜·불리언 그대로, 읽음은 늘 안 읽은 메일(§7)
export function sameMail(want: MailFields, got: MailFields | null): boolean {
  if (!got) return false;
  const who = (s: string | null) => (s === null ? null : s.trim().toLowerCase());
  const words = (m: MailFields) => [...new Set(m.subject_words.map((w) => w.trim()).filter((w) => w.length > 0))].sort().join("|");
  const unread = (m: MailFields) => (m.action === "read" ? true : m.unread_only);
  return want.action === got.action && who(want.sender) === who(got.sender) && words(want) === words(got) &&
    want.received_from === got.received_from && want.received_to === got.received_to && want.promotions === got.promotions && unread(want) === unread(got);
}
// 메일 요약 칸(0.15.0): 같은 동등 + latest·translate·target_in_message. targetOnly(judge "target") = target_in_message·translate 만 — 대상 칸은 맥락으로
// 채워도 되지만(D14) translate 는 지금 글에서만 나오고, 놓치면 앱이 표시 없이 재요약만 한다(최종 리뷰 I4)
export function sameRead(want: MailReadFields, got: MailReadFields | null, targetOnly: boolean): boolean {
  if (!got) return false;
  if (targetOnly) return want.target_in_message === got.target_in_message && want.translate === got.translate;
  const who = (s: string | null) => (s === null ? null : s.trim().toLowerCase());
  const words = (m: MailReadFields) => [...new Set(m.subject_words.map((w) => w.trim().toLowerCase()).filter((w) => w.length > 0))].sort().join("|");
  return who(want.sender) === who(got.sender) && words(want) === words(got) && want.received_from === got.received_from &&
    want.received_to === got.received_to && want.latest === got.latest && want.translate === got.translate && want.target_in_message === got.target_in_message;
}

export function judge(c: Case, g: Got): Row {
  const mail_ok = c.intent !== "mail_action" ? null : g.intent === "mail_action" ? sameMail(c.mail!, g.mail) : false;
  let read_ok: boolean | null = null, target_ok: boolean | null = null;
  if (c.intent === "mail_summary") {
    const hit = g.intent === "mail_summary";
    // target 분모에 의도 실패(mail_summary → 다른 의도)도 넣는다 — 스펙 "target_in_message 일치 ≥ 95%"보다 엄격한 해석(S6 리뷰 Minor 3)
    target_ok = hit && !!g.mail_read && g.mail_read.target_in_message === c.mail_read!.target_in_message;
    read_ok = hit ? sameRead(c.mail_read!, g.mail_read, c.judge === "target") : false;
  }
  return { id: c.id, group: c.group, expected: c.intent, got: g.intent, mail_ok, read_ok, target_ok };
}

// 게이트 문장: 모든 회차에서 의도·칸(후속 s15 는 target·translate 만)이 맞아야 한다. 행이 없는 id 도 실패(빈 every 방지)
export function gateCases(rows: Row[]): boolean {
  return GATE.every((id) => {
    const xs = rows.filter((r) => r.id === id);
    return xs.length > 0 && xs.every((r) => r.got === r.expected && r.mail_ok !== false && r.read_ok !== false && r.target_ok !== false);
  });
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const ACTIONS: Intent[] = ["add_event", "mail_action", "mail_summary"];
// 합격: 오탐 0 · 행동 재현율 각 ≥ 0.9 · 행동 사이 혼동 0. mailJudged(0.14.0) 메일 정리 칸 ≥ 0.9. readJudged(0.15.0) 요약 칸 완전 일치 ≥ 0.9 · target ≥ 0.95
export function summarize(rows: Row[], runs: number, mailJudged: boolean, readJudged = false) {
  const fp = rows.filter((r) => r.expected === "question" && r.got !== "question").length;
  const recall = (k: Intent) => { const xs = rows.filter((r) => r.expected === k); return xs.length ? xs.filter((r) => r.got === k).length / xs.length : 0; };
  const confusion = rows.filter((r) => ACTIONS.includes(r.expected) && ACTIONS.includes(r.got) && r.expected !== r.got).length;
  const rate = (xs: (boolean | null)[]) => { const ys = xs.filter((x): x is boolean => x !== null); return ys.length ? ys.filter(Boolean).length / ys.length : 0; };
  const mail = rate(rows.map((r) => r.mail_ok)), read = rate(rows.map((r) => r.read_ok)), target = rate(rows.map((r) => r.target_ok));
  const pass = fp === 0 && ACTIONS.every((k) => recall(k) >= 0.9) && confusion === 0 && (!mailJudged || mail >= 0.9) && (!readJudged || (read >= 0.9 && target >= 0.95));
  return { gate: pass ? "pass" : "fail", runs, cases: runs ? rows.length / runs : 0, false_positive: fp, recall_add: r3(recall("add_event")),
    recall_mail: r3(recall("mail_action")), recall_summary: r3(recall("mail_summary")), confusion, mail_match: r3(mail), read_match: r3(read),
    target_match: r3(target), mail_judged: mailJudged, read_judged: readJudged };
}
