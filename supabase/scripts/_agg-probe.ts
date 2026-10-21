// 단서 프로브(0.17.0 최종 리뷰 I2, 스펙 §15 INTENT-0170): 집계·규칙 단서 또는 직전 집계 맥락이 걸려 0.17.0 스키마를 타는 기존 의도 문장의 판정·집계 순수 함수.
// filters.ts 값(게이트)을 쓰므로 _agg-eval.ts 와 나눴다(그 모듈은 OpenAI 키 없이 테스트된다). 문장 글은 출력하지 않는다(id 만)
import { type AggConditions, type AggRaw, parseAggregateContext, revalidateAggregate } from "../functions/chat/aggregate.ts";
import type { EventValues } from "../functions/chat/edit.ts";
import { ACTION_INTENTS, AGG_INTENT_VALUES, aggModeFor, type Intent } from "../functions/chat/filters.ts";

// registered = 고치기 대상(9의도 스키마), previous = aggregate_context
export type ProbeCase = { id: string; text: string; intent: Intent; context?: { question: string; answer: string }[]; previous?: AggConditions; registered?: EventValues };
export type ProbeFile = { today: string; cases: ProbeCase[] };
export type ProbeRow = { id: string; mode: "0.16" | "0.17"; expected: Intent; got: Intent; model: Intent };
const APP_0170 = new Set<string>(ACTION_INTENTS);
const NEW: readonly string[] = AGG_INTENT_VALUES;
// 사례마다 0.17.0 모드에서 실제로 0.17.0 스키마를 타야 한다(아니면 0.16.x 바이트 동일이라 재는 의미가 없다). 기대 의도는 새 의도 넷 밖
export function validateProbeCases(f: ProbeFile): string[] {
  const p: string[] = [], ids = new Set<string>();
  for (const c of f.cases) {
    if (ids.has(c.id)) p.push(`${c.id} duplicate`);
    ids.add(c.id);
    if (NEW.includes(c.intent)) p.push(`${c.id} expected intent must be an existing one`);
    if (aggModeFor(c.text, APP_0170, c.previous ?? null) === null) p.push(`${c.id} not gated to 0.17.0`);
    const prev = c.previous ? parseAggregateContext(c.previous, f.today) : null;
    if (c.previous && (prev === null || prev === "bad" || JSON.stringify(prev) !== JSON.stringify(c.previous))) p.push(`${c.id} previous not revalidated`);
  }
  return p;
}
// got = 서버가 탈 의도(aggregate 가 재검증 ①로 question 이 되면 question), model = 모델 의도. 합격 = 0.17 모드 모든 실행에서 model 기준 오발 0(엄격)
export function probeRow(c: ProbeCase, mode: ProbeRow["mode"], model: Intent, aggregate: AggRaw | null, today: string): ProbeRow {
  const got: Intent = model === "aggregate" && revalidateAggregate(aggregate, today, c.previous ?? null).kind === "question" ? "question" : model;
  return { id: c.id, mode, expected: c.intent, got, model };
}
export function summarizeProbe(rows: ProbeRow[]) {
  const by = (m: ProbeRow["mode"]) => {
    const rs = rows.filter((r) => r.mode === m);
    return { rows: rs.length, model_wrong: rs.filter((r) => r.model !== r.expected).map((r) => `${r.id}:${r.model}`),
      got_wrong: rs.filter((r) => r.got !== r.expected).map((r) => `${r.id}:${r.got}`),
      to_new_intents: rs.filter((r) => NEW.includes(r.model)).length };
  };
  const b = by("0.16"), n = by("0.17");
  return { baseline: b, next: n, pass: n.rows > 0 && n.model_wrong.length === 0 };
}
