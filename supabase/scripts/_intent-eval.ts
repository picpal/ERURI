// INTENT-eval(스펙 §15, 0.13.0·0.14.0 공유): 합성 문장으로 chat 필터의 의도(변환 전)와 메일 칸을 잰다 — 판정·집계 순수 함수. 문장 글은 출력하지 않는다(id 만)
import type { Intent, MailFields } from "../functions/chat/filters.ts";

export type Case = { id: string; group: string; text: string; context?: { question: string; answer: string }[]; intent: Intent; mail: MailFields | null };
export type CaseFile = { today: string; cases: Case[] };
export type Got = { intent: Intent; mail: MailFields | null };
export type Row = { id: string; group: string; expected: Intent; got: Intent; mail_ok: boolean | null };

// 스펙 §15 구성. 사례를 더하면 이 수도 같이 고친다
const WANT = { question: 41, add_event: 18, mail_action: 17 } as const;
const GROUP_MIN: Record<string, number> = { confusable_ctx: 5, quoted: 3, prev_command: 3, negation: 3, ability: 2, add_ctx: 3, add_polite: 3, mail_ctx: 2, mail_polite: 2 };
// ADD-sim 문장(G1 = a01, G3 = a12, G7 = a13, G4 = q04)은 3회 모두 기대값이어야 A6 를 돌린다 — 재현율 0.9 합격선은 특정 문장의 실패를 허용한다(Fable F2)
export const GATE = ["a01", "a12", "a13", "q04"] as const;

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
  if (confusable < 15) p.push(`confusable ${confusable} < 15`);
  for (const [g, n] of Object.entries(GROUP_MIN)) {
    const got = f.cases.filter((c) => c.group === g).length;
    if (got < n) p.push(`${g} ${got} < ${n}`);
  }
  const ids = new Set<string>();
  for (const c of f.cases) {
    if (ids.has(c.id)) p.push(`${c.id} duplicate`);
    ids.add(c.id);
    if ((c.intent === "mail_action") !== (c.mail !== null)) p.push(`${c.id} mail must be set only for mail_action`);
    if (c.group.endsWith("_ctx") || c.group === "prev_command") { if (!c.context?.length) p.push(`${c.id} needs context`); }
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

export function judge(c: Case, g: Got): Row {
  const mail_ok = c.intent !== "mail_action" ? null : g.intent === "mail_action" ? sameMail(c.mail!, g.mail) : false;
  return { id: c.id, group: c.group, expected: c.intent, got: g.intent, mail_ok };
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;
// 합격(0.13.0): 오탐 0 · 재현율 add_event·mail_action 각 ≥ 0.9 · 두 행동 혼동 0. mailJudged(0.14.0)면 칸 일치 ≥ 0.9 도
export function summarize(rows: Row[], runs: number, mailJudged: boolean) {
  const fp = rows.filter((r) => r.expected === "question" && r.got !== "question").length;
  const recall = (k: Intent) => { const xs = rows.filter((r) => r.expected === k); return xs.length ? xs.filter((r) => r.got === k).length / xs.length : 0; };
  const confusion = rows.filter((r) => (r.expected === "add_event" && r.got === "mail_action") || (r.expected === "mail_action" && r.got === "add_event")).length;
  const judged = rows.filter((r) => r.mail_ok !== null);
  const mail = judged.length ? judged.filter((r) => r.mail_ok).length / judged.length : 0;
  const pass = fp === 0 && recall("add_event") >= 0.9 && recall("mail_action") >= 0.9 && confusion === 0 && (!mailJudged || mail >= 0.9);
  return { gate: pass ? "pass" : "fail", runs, cases: runs ? rows.length / runs : 0, false_positive: fp, recall_add: r3(recall("add_event")),
    recall_mail: r3(recall("mail_action")), confusion, mail_match: r3(mail), mail_judged: mailJudged };
}
