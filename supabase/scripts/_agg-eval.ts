// AGG-eval(스펙 §15, 0.17.0): 합성 문장으로 chat 필터(0.17.0 모드)의 의도·집계 칸·저장 규칙 칸을 잰다 — 판정·집계 순수 함수.
// 집계 칸은 서버 재검증 ①~⑥(revalidateAggregate, 이어받기 포함) 뒤 값으로 비교한다(배포 chat 과 같은 함수). 문장 글은 출력하지 않는다(id 만)
import { type AggBucket, type AggConditions, type AggRaw, type AggSource, parseAggregateContext, revalidateAggregate, type Revalidated }
  from "../functions/chat/aggregate.ts";
import type { Intent } from "../functions/chat/filters.ts";
import { normalizeRuleValue, type RuleKind } from "../functions/_shared/save-rules.ts";

export type AggExpected = { keywords: string[]; sender: string | null; sources: AggSource[]; from: string; to: string; bucket: AggBucket };
// agg = 재검증·이어받기 뒤 기대 6칸. 연속 턴은 context(앞 턴 {question, answer: sentence}) + previous(앞 턴의 재검증된 조건 = aggregate_context)
export type AggCase = { id: string; group: string; text: string; context?: { question: string; answer: string }[]; previous?: AggConditions; intent: Intent;
  agg?: AggExpected; rule?: { kind: RuleKind; value: string } };
export type AggCaseFile = { today: string; cases: AggCase[] };
export type AggGot = { intent: Intent; aggregate: AggRaw | null; save_rule: { kind: unknown; value: unknown } | null };
// got = 서버가 실제로 탈 의도(키워드 0개·직전 조건 없음이면 question 흐름), model = 모델이 고른 의도. 칸 판정은 기대 의도가 그 칸의 의도일 때만(아니면 null)
export type AggRow = { id: string; group: string; expected: Intent; got: Intent; model: Intent; status: "ok" | "bad_condition" | null; split: boolean;
  keywords_ok: boolean | null; sender_ok: boolean | null; sources_ok: boolean | null; from_ok: boolean | null; to_ok: boolean | null; bucket_ok: boolean | null;
  rule_ok: boolean | null };

export const AGG_TODAY = "2026-10-21";
// §9 "채팅 저장 규칙·집계 질문" 경계 예시 20개 — 사례 파일에 글 그대로 있어야 한다
export const BOUNDARY_TEXTS = [
  "이번 주 합성PAY 타임아웃 언제 많았어?", "지난달 합성은행 문자 날짜별로 몇 건이야?", "합성택배 알림 무슨 요일에 제일 많이 와?",
  "이번 주 합성택배 문자랑 알림 몇 건 왔어?", "최근 3일 합성PAY 오류 몇 건 왔어?", "광고 메일 몇 통 왔어?", "문자 몇 개 왔어?", "합성PAY 점검 문자 언제 왔어?",
  "합성PAY 타임아웃 왜 나는 거야?", "앞으로 합성PAY 문자는 저장해", "합성은행에서 온 문자는 앞으로 다 남겨 줘", "저장 규칙 보여줘", "합성PAY 규칙 빼줘",
  "합성PAY 규칙은 빼지 마", "팀장이 \"합성PAY 문자는 저장해\"래, 무슨 뜻이야?", "저장 규칙은 어떻게 만들어?", "합성PAY 점검 금요일 3시 등록해줘",
  "날짜별로는?", "그럼 지난달은?", "내일 합성상점 약속 몇 시였지?",
] as const;

const AGG_INTENTS: Intent[] = ["aggregate", "save_rule_add", "save_rule_list", "save_rule_remove"];
const DAY_MS = 86_400_000;
const plusDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

// 기간 종류(구성 검사용): 글의 기간 말로 고르고 기대 날짜가 그 말의 재검증 값인지 본다(아니면 other).
// 날짜만으로는 못 가른다 — 오늘이 수요일이면 "최근 3일"과 "이번 주"가 둘 다 10/19~10/21
type PeriodClass = "none" | "this_week" | "last_month" | "this_year" | "recent_n" | "other";
function periodClass(c: AggCase, today: string): PeriodClass {
  const a = c.agg!, dow = new Date(`${today}T00:00:00Z`).getUTCDay();
  const firstThis = `${today.slice(0, 7)}-01`, lastPrev = plusDays(firstThis, -1);
  const recent = /최근 (\d+)일/.exec(c.text);
  const [k, from, to]: [PeriodClass, string, string] = /이번 주/.test(c.text) ? ["this_week", plusDays(today, -((dow + 6) % 7)), today]
    : /지난달/.test(c.text) ? ["last_month", `${lastPrev.slice(0, 7)}-01`, lastPrev]
    : /올해/.test(c.text) ? ["this_year", plusDays(today, -89), today]                 // 1월 1일~오늘 → 90일로 줄임
    : recent ? ["recent_n", plusDays(today, -(Number(recent[1]) - 1)), today]
    : ["none", plusDays(today, -6), today];                                               // 기본 최근 7일
  return a.from === from && a.to === to ? k : "other";
}
type SourceClass = "sms" | "notification" | "both" | "mail" | "none" | "other";
function sourceClass(s: AggSource[]): SourceClass {
  const k = [...s].sort().join(",");
  return k === "" ? "none" : k === "MESSAGES" ? "sms" : k === "NOTIFICATION" ? "notification" : k === "MESSAGES,NOTIFICATION" ? "both" : k === "GMAIL" ? "mail" : "other";
}
// 출처 구별 사례(Codex 0.17.0 리뷰 #1): 단발 집계 중 문자만·알림만·둘 다
const isSplit = (c: AggCase) => !c.previous && c.intent === "aggregate" && !!c.agg && ["sms", "notification", "both"].includes(sourceClass(c.agg.sources));

// 스펙 §15 구성. 단발 aggregate 그룹: agg(bucket 을 말함) · agg_count(개수만 — 모델 bucket null, 기대는 서버 day)
const QUESTION_GROUPS: Record<string, number> = { no_keyword: 2, kind_only: 1, one_time: 2, why: 1, negation: 1, quoted: 1, ability: 1, stored_check: 1 };
const SEQ: Record<string, Intent> = { seq_a: "aggregate", seq_b: "aggregate", seq_c: "question" };
const SIX = ["keywords", "sender", "sources", "from", "to", "bucket"] as const;
// 보충 그룹(0.18.1, 2026-10-23 사용자 승인 — 44 구성 밖): 하루 말('오늘'·'어제') 단발 집계 2 — 서버 ④ 하루 말 고정 뒤 from = to = 그날
export const DAY_GROUP = "agg_day";
const DAY_CASES = 2;

export function validateAggCases(file: AggCaseFile): string[] {
  const p: string[] = [];
  const days = file.cases.filter((c) => c.group === DAY_GROUP);
  if (days.length !== DAY_CASES) p.push(`${DAY_GROUP} ${days.length} != ${DAY_CASES}`);
  for (const c of days) {
    // 모델이 기간을 비우거나 최근 7일로 읽어도 서버가 기대 하루로 고정해야 한다(글 없이는 기본값 — 고정이 글에서 온다)
    const pinned = (from: string | null, to: string | null) => revalidateAggregate({ ...c.agg!, from, to }, file.today, null, c.text);
    const want = (v: Revalidated) => v.kind === "ok" && v.conditions.from === c.agg!.from && v.conditions.to === c.agg!.to;
    if (c.intent !== "aggregate" || !c.agg || c.previous || c.agg.from !== c.agg.to || !want(pinned(null, null))
      || !want(pinned(plusDays(file.today, -6), file.today))) p.push(`${c.id} ${DAY_GROUP} not pinned to one day`);
  }
  const f: AggCaseFile = { ...file, cases: file.cases.filter((c) => c.group !== DAY_GROUP) };
  if (new Set(file.cases.map((c) => c.id)).size !== file.cases.length) p.push("duplicate id");
  const count = (label: string, got: number, want: number) => { if (got !== want) p.push(`${label} ${got} != ${want}`); };
  if (f.cases.length !== 44) p.push(`cases ${f.cases.length} != 44`);
  const ids = new Set<string>();
  for (const c of f.cases) {
    if (ids.has(c.id)) p.push(`${c.id} duplicate`);
    ids.add(c.id);
    if ((c.intent === "aggregate") !== (c.agg !== undefined)) p.push(`${c.id} agg must be set only for aggregate`);
    if ((c.intent === "save_rule_add" || c.intent === "save_rule_remove") !== (c.rule !== undefined)) p.push(`${c.id} rule must be set only for save_rule_add/remove`);
    if (c.rule && normalizeRuleValue(c.rule.value) !== c.rule.value) p.push(`${c.id} rule value not normalized`);
    if (c.agg) {
      // 기대값은 재검증의 고정점이어야 한다(서버가 바꿀 값이면 어떤 출력도 맞지 않는다)
      const v = revalidateAggregate(c.agg, f.today, null);
      if (v.kind !== "ok" || SIX.some((k) => JSON.stringify(v.conditions[k]) !== JSON.stringify(c.agg![k]))) p.push(`${c.id} agg not revalidated`);
    }
    const seq = c.group in SEQ;
    if (seq !== (c.previous !== undefined)) p.push(`${c.id} previous only (and always) on seq groups`);
    if (seq) {
      if (!c.context?.length) p.push(`${c.id} seq needs context`);
      if (c.intent !== SEQ[c.group]) p.push(`${c.id} ${c.group} intent ${c.intent} != ${SEQ[c.group]}`);
      const prev = c.previous ? parseAggregateContext(c.previous, f.today) : null;
      if (c.previous && (prev === null || prev === "bad" || JSON.stringify(prev) !== JSON.stringify(c.previous))) p.push(`${c.id} previous not revalidated`);
    }
  }
  for (const g of Object.keys(SEQ)) count(g, f.cases.filter((c) => c.group === g).length, 1);

  const singles = f.cases.filter((c) => c.intent === "aggregate" && !c.previous);
  count("aggregate single", singles.length, 14);
  for (const c of singles) if (c.group !== "agg" && c.group !== "agg_count") p.push(`${c.id} aggregate group ${c.group}`);
  const counted = singles.filter((c) => c.group === "agg_count");
  count("bucket none", counted.length, 2);
  for (const c of counted) if (c.agg?.bucket !== "day") p.push(`${c.id} agg_count expects server bucket day`);
  const said = singles.filter((c) => c.group === "agg");
  for (const [b, n] of [["hour", 5], ["day", 4], ["weekday", 3]] as const) count(`bucket ${b}`, said.filter((c) => c.agg?.bucket === b).length, n);
  for (const [k, n] of [[1, 6], [2, 6], [3, 2]] as const) count(`keywords ${k}`, singles.filter((c) => c.agg?.keywords.length === k).length, n);
  count("sender", singles.filter((c) => c.agg?.sender !== null).length, 2);
  for (const [s, n] of [["sms", 4], ["notification", 2], ["both", 1], ["mail", 1], ["none", 6]] as const) {
    count(`sources ${s}`, singles.filter((c) => sourceClass(c.agg!.sources) === s).length, n);
  }
  for (const [k, n] of [["none", 3], ["this_week", 3], ["last_month", 2], ["recent_n", 4], ["this_year", 2]] as const) {
    count(`period ${k}`, singles.filter((c) => periodClass(c, f.today) === k).length, n);
  }

  const rules = (i: Intent, k: RuleKind) => f.cases.filter((c) => c.intent === i && c.rule?.kind === k).length;
  count("save_rule_add keyword", rules("save_rule_add", "keyword"), 4);
  count("save_rule_add sender", rules("save_rule_add", "sender"), 2);
  count("save_rule_list", f.cases.filter((c) => c.intent === "save_rule_list").length, 3);
  count("save_rule_remove keyword", rules("save_rule_remove", "keyword"), 3);
  count("save_rule_remove sender", rules("save_rule_remove", "sender"), 1);

  const others = f.cases.filter((c) => !AGG_INTENTS.includes(c.intent) && !(c.group in SEQ));
  count("question", others.filter((c) => c.intent === "question").length, 10);
  for (const [g, n] of Object.entries(QUESTION_GROUPS)) count(`question ${g}`, others.filter((c) => c.intent === "question" && c.group === g).length, n);
  for (const [i, n] of [["add_event", 2], ["mail_action", 1], ["mail_summary", 1]] as const) count(i, others.filter((c) => c.intent === i).length, n);

  const texts = new Set(f.cases.map((c) => c.text));
  for (const t of BOUNDARY_TEXTS) if (!texts.has(t)) p.push(`boundary missing: ${t}`);
  return p;
}

const lowSet = (xs: string[]) => [...new Set(xs.map((x) => x.toLowerCase()))].sort().join("\n");
const squash = (s: string | null) => (s === null ? null : s.toLowerCase().replace(/\s/g, ""));   // sender_matches 와 같은 판정(공백·대소문자 무시)

export function judgeAgg(c: AggCase, got: AggGot, today: string = AGG_TODAY): AggRow {
  let eff: Intent = got.intent, status: AggRow["status"] = null, cond: AggConditions | null = null;
  if (got.intent === "aggregate") {
    const v = revalidateAggregate(got.aggregate, today, c.previous ?? null, c.text);   // 지금 글 — ④ 하루 말 고정(0.18.1, 배포 chat 과 같다)
    if (v.kind === "question") eff = "question";                    // 서버가 질문 흐름으로 돌린다(재검증 ①)
    else { status = v.kind; cond = v.kind === "ok" ? v.conditions : null; }
  }
  const row: AggRow = { id: c.id, group: c.group, expected: c.intent, got: eff, model: got.intent, status, split: isSplit(c), keywords_ok: null, sender_ok: null,
    sources_ok: null, from_ok: null, to_ok: null, bucket_ok: null, rule_ok: null };
  if (c.agg) {
    const w = c.agg, h = eff === "aggregate" ? cond : null;
    row.keywords_ok = !!h && lowSet(h.keywords) === lowSet(w.keywords);
    row.sender_ok = !!h && squash(h.sender) === squash(w.sender);
    row.sources_ok = !!h && [...h.sources].sort().join(",") === [...w.sources].sort().join(",");
    row.from_ok = !!h && h.from === w.from;
    row.to_ok = !!h && h.to === w.to;
    row.bucket_ok = !!h && h.bucket === w.bucket;
  }
  if (c.rule) {
    const g = got.save_rule, value = normalizeRuleValue(g?.value);
    const kind: RuleKind = g?.kind === "sender" ? "sender" : "keyword";   // judgeSaveRule 과 같다(두 값 밖은 keyword)
    row.rule_ok = eff === c.intent && !!g && kind === c.rule.kind && value !== null && value.toLowerCase() === c.rule.value.toLowerCase();
  }
  return row;
}

// 합격선(스펙 §15, 각 실행): 의도 ≥ 42/44 · 다른 의도 15(단발 14 + seq_c) 중 aggregate·save_rule_* 0 · add↔remove 혼동 0 ·
// aggregate 16 의 bucket ≥ 15 · 키워드 ≥ 14 · sender·sources·from·to 각 ≥ 14 · 출처 구별 7/7(aggregate 로 간 것 기준) · 저장 규칙 10 의 종류·값 ≥ 9. pass = 모든 실행.
// 보충 agg_day(0.18.1)는 44 합격선 밖에서 따로: 의도 aggregate·from·to 일치 2/2
export function summarizeAgg(runs: AggRow[][]) {
  const per_run = runs.map((all, i) => {
    const rows = all.filter((r) => r.group !== DAY_GROUP), dayRows = all.filter((r) => r.group === DAY_GROUP);
    const n = (f: (r: AggRow) => boolean) => rows.filter(f).length;
    // 출처 구별 분모 = aggregate 로 간 출처 사례만(의도 놓침은 의도 일치에서 센다 — 스펙 §15, 2026-10-21 메인 판정)
    const aggRows = rows.filter((r) => r.expected === "aggregate"), ruleRows = rows.filter((r) => r.rule_ok !== null);
    const splitRows = rows.filter((r) => r.split && r.got === "aggregate");
    const ok = (k: "keywords_ok" | "sender_ok" | "sources_ok" | "from_ok" | "to_ok" | "bucket_ok") => aggRows.filter((r) => r[k] === true).length;
    const s = { run: i + 1, cases: rows.length, intent: n((r) => r.got === r.expected),
      other_misfire: n((r) => !AGG_INTENTS.includes(r.expected) && AGG_INTENTS.includes(r.got)),
      add_remove_confusion: n((r) => (r.expected === "save_rule_add" && r.got === "save_rule_remove") || (r.expected === "save_rule_remove" && r.got === "save_rule_add")),
      aggregate_cases: aggRows.length, bucket: ok("bucket_ok"), keywords: ok("keywords_ok"), sender: ok("sender_ok"), sources: ok("sources_ok"), from: ok("from_ok"),
      to: ok("to_ok"), split_cases: splitRows.length, split: splitRows.filter((r) => r.sources_ok === true).length, rule_cases: ruleRows.length,
      rule: n((r) => r.rule_ok === true), bad_condition: n((r) => r.status === "bad_condition"),
      model_misfire: n((r) => !AGG_INTENTS.includes(r.expected) && AGG_INTENTS.includes(r.model)),
      day_cases: dayRows.length, day: dayRows.filter((r) => r.got === "aggregate" && r.from_ok === true && r.to_ok === true).length,
      wrong: all.filter((r) => r.got !== r.expected).map((r) => r.id) };
    const pass = s.intent >= 42 && s.other_misfire === 0 && s.add_remove_confusion === 0 && s.bucket >= 15 && s.keywords >= 14 &&
      [s.sender, s.sources, s.from, s.to].every((x) => x >= 14) && s.split === s.split_cases && s.rule >= 9 && s.day === s.day_cases;
    return { ...s, pass };
  });
  return { pass: per_run.length > 0 && per_run.every((r) => r.pass), runs: per_run.length, per_run };
}

// eval-intent --mode: 없으면 0.16(기존 동작), both = 같은 세션 0.16.x 기준선 + 0.17.0(K13)
export type EvalMode = "0.16" | "0.17" | "both";
export function parseEvalMode(args: string[]): EvalMode | null {
  const i = args.indexOf("--mode");
  if (i < 0) return "0.16";
  const v = args[i + 1];
  return v === "0.16" || v === "0.17" || v === "both" ? v : null;
}
