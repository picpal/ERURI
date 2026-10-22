// METRIC-eval·추출 회귀(스펙 §15, 0.18.0): 사례 구성 검사·사례 판정·합격선 집계 순수 함수.
// 출력에 label·숫자 글·본문을 넣지 않는다 — 사례 id·그룹·불리언·개수·토큰·status 만(AGENTS.md §7)
import type { Metric } from "../functions/_shared/metrics.ts";
import { judge } from "../eval/run-multi-event-eval.ts";

export type MetricGroup = "single" | "multi" | "sum_detail" | "repeat" | "cumulative_mixed" | "counter" | "tz" | "none_plain" | "none_money"
  | "none_ratio" | "none_cumulative" | "mixed_max";
export type MetricTime = "range" | "point" | "datetime" | "none" | "out_of_window" | "tz";
export type MetricCase = { id: string; group: MetricGroup; time?: MetricTime; service: string; text: string; occurred_at: string; expect: Metric[];
  events?: { starts: string }[] };
export type MetricCaseFile = { _note?: string; cases: MetricCase[] };
export type MetricStatus = "ok" | "incomplete" | "error";
export type MetricGot = { metrics: Metric[]; events: string[]; status: MetricStatus; output_tokens: number };
// expected = 기대 metric 수, got = 정규화 뒤 모델 metric 수, matched = label·count 둘 다(K19 일대일), extra = 짝 없는 모델 metric,
// time_ok = 짝(label)의 at 분·at_body 일치 수, sum_ok = count 합 일치, timeout = label 에 '타임아웃'이 든 모델 metric 수(⑤), events_ok = 혼합 일정(⑧)
export type MetricRow = { id: string; group: MetricGroup; time: MetricTime | null; expected: number; got: number; matched: number; extra: number;
  time_ok: number; sum_ok: boolean; timeout: number; events_ok: boolean | null; status: MetricStatus; output_tokens: number };

// 스펙 §15 구성
export const GROUP_COUNTS: Record<MetricGroup, number> = { single: 12, multi: 10, sum_detail: 2, repeat: 2, cumulative_mixed: 1, counter: 2, tz: 4,
  none_plain: 2, none_money: 2, none_ratio: 2, none_cumulative: 1, mixed_max: 2 };
export const TIME_COUNTS: Record<MetricTime, number> = { range: 12, point: 4, datetime: 4, none: 7, out_of_window: 2, tz: 4 };
const METRIC_GROUPS: MetricGroup[] = ["single", "multi", "sum_detail", "repeat", "cumulative_mixed", "counter", "tz"];
const NONE_GROUPS: MetricGroup[] = ["none_plain", "none_money", "none_ratio", "none_cumulative"];
const EXPECT_TOTAL = 49;
const MIXED_EVENTS = 5, MIXED_METRICS = 10, MIXED_LABEL_MIN = 15;
const SERVICES_MIN = 12, SERVICE_MAX_USES = 4;
// 그룹별 기대 metric 수 [최소, 최대]
const EXPECT_RANGE: Partial<Record<MetricGroup, [number, number]>> = { single: [1, 1], multi: [2, 3], sum_detail: [2, 3], repeat: [1, 1],
  cumulative_mixed: [1, 1], counter: [1, 1], tz: [1, 1] };
// 스펙 §15에 글이 적힌 사례 — 그 그룹 사례의 글에 그대로 들어 있어야 하고, 시간대 사례는 받은 시각(서울)도 스펙 그대로
export const SPEC_TEXTS: { group: MetricGroup; text: string; received?: string }[] = [
  { group: "counter", text: "타임아웃 발생, 재시도 20건" },
  { group: "counter", text: "타임아웃 0건, 오류 20건" },
  { group: "cumulative_mixed", text: "14:00~14:10 타임아웃 6건 (오늘 누적 14건)" },
  { group: "none_cumulative", text: "오늘 누적 타임아웃 14건" },
  { group: "tz", text: "2026-10-22 05:00 UTC 오류 6건", received: "2026-10-22T14:03" },
  { group: "tz", text: "05:00 GMT 오류 3건", received: "2026-10-22T14:02" },
  { group: "tz", text: "2026-10-21 15:30 UTC 타임아웃 3건", received: "2026-10-22T00:40" },
  { group: "tz", text: "10/21 23:50 타임아웃 6건", received: "2026-10-22T00:05" },
];
const ISO_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const seoulMinute = (iso: string) => new Date(Date.parse(iso) + 9 * 3600_000).toISOString().slice(0, 16);

export function validateMetricCases(f: MetricCaseFile): string[] {
  const p: string[] = [];
  const cases = Array.isArray(f?.cases) ? f.cases : [];
  if (cases.length !== 42) p.push(`cases ${cases.length} != 42`);
  const ids = new Set(cases.map((c) => c.id));
  if (ids.size !== cases.length) p.push("duplicate id");
  for (const [g, n] of Object.entries(GROUP_COUNTS)) {
    const k = cases.filter((c) => c.group === g).length;
    if (k !== n) p.push(`group ${g} ${k} != ${n}`);
  }
  for (const c of cases) if (!(c.group in GROUP_COUNTS)) p.push(`${c.id} group ${c.group}`);
  const withMetrics = cases.filter((c) => METRIC_GROUPS.includes(c.group));
  for (const [t, n] of Object.entries(TIME_COUNTS)) {
    const k = withMetrics.filter((c) => c.time === t).length;
    if (k !== n) p.push(`time ${t} ${k} != ${n}`);
  }
  const total = withMetrics.reduce((s, c) => s + (Array.isArray(c.expect) ? c.expect.length : 0), 0);
  if (total !== EXPECT_TOTAL) p.push(`expect total ${total} != ${EXPECT_TOTAL}`);
  const uses = new Map<string, number>();
  for (const c of cases) uses.set(c.service, (uses.get(c.service) ?? 0) + 1);
  if (uses.size < SERVICES_MIN) p.push(`services ${uses.size} < ${SERVICES_MIN}`);
  for (const [s, n] of uses) if (n > SERVICE_MAX_USES) p.push(`service used ${n} > ${SERVICE_MAX_USES}: ${s}`);
  for (const c of cases) {
    if (typeof c.text !== "string" || typeof c.service !== "string" || !c.text.includes(c.service)) p.push(`${c.id} service not in text`);
    if (!ISO_Z.test(c.occurred_at ?? "") && !Number.isFinite(Date.parse(c.occurred_at))) p.push(`${c.id} occurred_at`);
    if (!Array.isArray(c.expect)) { p.push(`${c.id} expect not array`); continue; }
    for (const m of c.expect) {
      if (typeof m?.label !== "string" || m.label.trim() === "" || [...m.label].length > 30) p.push(`${c.id} expect label`);
      if (!Number.isInteger(m?.count) || m.count < 1 || m.count > 100000) p.push(`${c.id} expect count`);
      if (typeof m?.at !== "string" || !ISO_Z.test(m.at)) p.push(`${c.id} expect at`);
      if (typeof m?.at_body !== "boolean") p.push(`${c.id} expect at_body`);
      // 본문 시각을 쓰지 않으면 받은 시각 그대로
      else if (!m.at_body && Date.parse(m.at) !== Date.parse(c.occurred_at)) p.push(`${c.id} at_body false but at != occurred_at`);
    }
    const range = EXPECT_RANGE[c.group];
    if (range && (c.expect.length < range[0] || c.expect.length > range[1])) p.push(`${c.id} expect ${c.expect.length} not in ${range.join("..")}`);
    if (METRIC_GROUPS.includes(c.group)) {
      if (c.time === undefined) p.push(`${c.id} time missing`);
      const bodyTime = c.time === "range" || c.time === "point" || c.time === "datetime" || c.time === "tz";
      if (c.time !== undefined && c.expect.some((m) => m.at_body !== bodyTime)) p.push(`${c.id} at_body vs time ${c.time}`);
      if (c.group === "tz" && c.time !== "tz") p.push(`${c.id} tz group time ${c.time}`);
      if (c.events !== undefined) p.push(`${c.id} events outside mixed_max`);
    } else if (NONE_GROUPS.includes(c.group)) {
      if (c.expect.length !== 0) p.push(`${c.id} none group expects metrics`);
      if (c.time !== undefined || c.events !== undefined) p.push(`${c.id} none group time/events`);
    } else if (c.group === "mixed_max") {
      if (c.expect.length !== MIXED_METRICS) p.push(`${c.id} mixed metrics ${c.expect.length} != ${MIXED_METRICS}`);
      if (!Array.isArray(c.events) || c.events.length !== MIXED_EVENTS) p.push(`${c.id} mixed events != ${MIXED_EVENTS}`);
      // 본문 줄 "N) YYYY-MM-DD HH:MM~HH:MM <긴 label> <count>건" — 긴 label ≥ 15자, 기대 label 은 그 끝(사건 이름), count·시작 시각이 기대와 같다
      const lines = [...(c.text ?? "").matchAll(/^\d+\) (\d{4}-\d{2}-\d{2} \d{2}:\d{2})~\d{2}:\d{2} (.+) (\d+)건$/gm)];
      if (lines.length !== MIXED_METRICS) p.push(`${c.id} mixed metric lines ${lines.length} != ${MIXED_METRICS}`);
      c.expect.forEach((m, i) => {
        const l = lines[i];
        if (!l || [...l[2]].length < MIXED_LABEL_MIN || !l[2].endsWith(m.label) || Number(l[3]) !== m.count || seoulMinute(m.at) !== l[1].replace(" ", "T") || !m.at_body) {
          p.push(`${c.id} mixed metric ${i} (label < ${MIXED_LABEL_MIN}, label/count/time vs text)`);
        }
      });
      if (c.time !== undefined) p.push(`${c.id} mixed time`);
    }
  }
  for (const s of SPEC_TEXTS) {
    const hit = cases.find((c) => c.group === s.group && typeof c.text === "string" && c.text.includes(s.text));
    if (!hit) p.push(`spec text missing (${s.group}): ${s.text}`);
    else if (s.received && seoulMinute(hit.occurred_at) !== s.received) p.push(`spec received ${hit.id} != ${s.received}`);
  }
  return p;
}

const norm = (s: string) => s.replace(/\s/g, "").toLowerCase();
const minute = (iso: string) => Math.floor(Date.parse(iso) / 60_000);

export function judgeMetricCase(c: MetricCase, got: MetricGot): MetricRow {
  const ms = got.status === "ok" ? got.metrics : [];                   // 잘림·throw 는 metric 0개로 판정
  const used = new Set<number>();
  let matched = 0, timeOk = 0;
  // K19: 기대마다 아직 쓰지 않은 모델 metric 중 첫 번째로 label 을 담은 것 — 일대일
  for (const e of c.expect) {
    const i = ms.findIndex((m, k) => !used.has(k) && norm(m.label).includes(norm(e.label)));
    if (i < 0) continue;
    used.add(i);
    if (ms[i].count === e.count) matched++;
    if (minute(ms[i].at) === minute(e.at) && ms[i].at_body === e.at_body) timeOk++;
  }
  const sum = (xs: Metric[]) => xs.reduce((s, m) => s + m.count, 0);
  let eventsOk: boolean | null = null;
  if (c.group === "mixed_max") {
    const starts = (c.events ?? []).map((e) => e.starts);
    const evs = got.status === "ok" ? got.events : [];
    eventsOk = judge({ id: c.id, kind: "event", text: "", starts }, { kind: evs.length ? "event" : "none", starts: evs, ends: [] }) === "ok";
  }
  return { id: c.id, group: c.group, time: c.time ?? null, expected: c.expect.length, got: ms.length, matched, extra: ms.length - used.size,
    time_ok: timeOk, sum_ok: sum(ms) === sum(c.expect), timeout: ms.filter((m) => norm(m.label).includes("타임아웃")).length, events_ok: eventsOk,
    status: got.status, output_tokens: got.output_tokens };
}

type CheckKey = "c1" | "c2" | "c2_extra" | "c3" | "c4" | "c5" | "c6" | "c7" | "c7_out" | "c7_tz" | "c8_done" | "c8_events" | "c8_metrics";
const CHECK_KEYS: CheckKey[] = ["c1", "c2", "c2_extra", "c3", "c4", "c5", "c6", "c7", "c7_out", "c7_tz", "c8_done", "c8_events", "c8_metrics"];

// 한 실행의 합격선 ①~⑧. 그 그룹 사례가 이 실행에 없으면 n/a(합격에 영향 없음 — --mixed-only·--ids 부분 실행).
// 허용 틀림(②⑦ 2개, ⑥ 1개, ⑧ metric 1개)은 전체 실행에서 스펙 숫자(≥47/49·≥32/33·≥19/20)와 같다
function runChecks(rows: MetricRow[]): Record<CheckKey, { text: string; ok: boolean }> {
  const of = (gs: MetricGroup[]) => rows.filter((r) => gs.includes(r.group));
  const na = { text: "n/a", ok: true };
  const frac = (rs: MetricRow[], hit: (r: MetricRow) => number, den: (r: MetricRow) => number, slack: number) => {
    if (rs.length === 0) return na;
    const h = rs.reduce((s, r) => s + hit(r), 0), d = rs.reduce((s, r) => s + den(r), 0);
    return { text: `${h}/${d}`, ok: h >= d - slack };
  };
  const zero = (rs: MetricRow[], bad: (r: MetricRow) => number, unit = "") => {
    if (rs.length === 0) return na;
    const n = rs.reduce((s, r) => s + bad(r), 0);
    return { text: `${n}${unit}`, ok: n === 0 };
  };
  const m = of(METRIC_GROUPS), mixed = of(["mixed_max"]);
  const extra = m.reduce((s, r) => s + r.extra, 0);
  return {
    c1: zero(of(NONE_GROUPS), (r) => r.got > 0 ? 1 : 0, " emitted"),
    c2: frac(m, (r) => r.matched, (r) => r.expected, 2),
    c2_extra: m.length ? { text: String(extra), ok: extra <= 1 } : na,
    c3: zero(of(["sum_detail", "cumulative_mixed"]), (r) => r.extra > 0 ? 1 : 0),
    c4: frac(of(["repeat"]), (r) => r.got === 1 ? 1 : 0, () => 1, 0),
    c5: zero(of(["counter"]), (r) => r.timeout > 0 ? 1 : 0),
    c6: frac(m, (r) => r.sum_ok ? 1 : 0, () => 1, 1),
    c7: frac(m, (r) => r.time_ok, (r) => r.expected, 2),
    c7_out: frac(m.filter((r) => r.time === "out_of_window"), (r) => r.time_ok === r.expected ? 1 : 0, () => 1, 0),
    c7_tz: frac(of(["tz"]), (r) => r.time_ok === r.expected ? 1 : 0, () => 1, 0),
    c8_done: frac(mixed, (r) => r.status === "ok" ? 1 : 0, () => 1, 0),
    c8_events: frac(mixed, (r) => r.events_ok ? 1 : 0, () => 1, 0),
    c8_metrics: frac(mixed, (r) => r.matched, (r) => r.expected, 1),
  };
}

// rows = 실행 순서대로 이어 붙인 줄. 같은 사례 id 의 k번째 줄이 k번째 실행이다. 합격 = 모든 실행이 모든 합격선 통과(스펙 "2회 실행 모두")
export function summarizeMetric(rows: MetricRow[], cap: number): { pass: boolean; checks: Record<CheckKey, string>; cap: number; incomplete: string[];
  max_mixed_output: number; max_mixed_output_incomplete: number } {
  const runs: MetricRow[][] = [];
  const seen = new Map<string, number>();
  for (const r of rows) {
    const k = seen.get(r.id) ?? 0;
    seen.set(r.id, k + 1);
    (runs[k] ??= []).push(r);
  }
  const per = runs.map(runChecks);
  const checks = Object.fromEntries(CHECK_KEYS.map((k) => [k, per.map((c) => c[k].text).join(" | ")])) as Record<CheckKey, string>;
  const pass = per.length > 0 && per.every((c) => CHECK_KEYS.every((k) => c[k].ok)) && rows.every((r) => r.status === "ok");
  const mixed = rows.filter((r) => r.group === "mixed_max");
  const max = (rs: MetricRow[]) => rs.reduce((s, r) => Math.max(s, r.output_tokens), 0);
  return { pass, checks, cap, incomplete: [...new Set(rows.filter((r) => r.status === "incomplete").map((r) => r.id))],
    max_mixed_output: max(mixed.filter((r) => r.status === "ok")), max_mixed_output_incomplete: max(mixed.filter((r) => r.status === "incomplete")) };
}

// 추출 회귀(스펙 §15): general·rule = 사례 색인별 [run1, run2, …] 판정 코드(judge 의 ok·kind·split·… 또는 error), ruleEmitted = 사례별 규칙 모드에서
// metric 을 낸 실행 수. 일반 모드에서 모든 실행이 맞은 사례가 규칙 모드에서 한 번이라도 틀리면 new_wrong(색인 글자), 낸 사례 ≤ 1
export function judgeRegression(general: string[][], rule: string[][], ruleEmitted: number[]): { new_wrong: string[]; emitted: number; pass: boolean } {
  const newWrong = general.flatMap((g, i) => g.length > 0 && g.every((v) => v === "ok") && (rule[i] ?? []).some((v) => v !== "ok") ? [String(i)] : []);
  const emitted = ruleEmitted.filter((n) => n > 0).length;
  return { new_wrong: newWrong, emitted, pass: newWrong.length === 0 && emitted <= 1 };
}
