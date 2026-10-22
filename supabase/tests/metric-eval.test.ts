import { assert, assertEquals } from "jsr:@std/assert";
import { metricCheckText, normalizeMetrics } from "../functions/_shared/metrics.ts";
import { judgeMetricCase, judgeRegression, type MetricCase, type MetricCaseFile, type MetricRow, summarizeMetric,
  validateMetricCases } from "../scripts/_metric-eval.ts";

const file = JSON.parse(await Deno.readTextFile(new URL("../eval/metric-cases.json", import.meta.url))) as MetricCaseFile;
// 기대값 그대로 낸 모델(정규화 뒤) — 모든 판정이 맞는 줄
const echo = (c: MetricCase, extra: Partial<{ status: "ok" | "incomplete" | "error"; output_tokens: number }> = {}) =>
  judgeMetricCase(c, { metrics: c.expect.map((m) => ({ ...m })), events: (c.events ?? []).map((e) => e.starts), status: "ok", output_tokens: 100, ...extra });
const passRun = (): MetricRow[] => file.cases.map((c) => echo(c));
const byGroup = (g: string) => file.cases.filter((c) => c.group === g);

Deno.test("validateMetricCases: committed file passes; dropping a case, a 5th use of one service name, or a wrong expect total fails", async () => {
  const f = JSON.parse(await Deno.readTextFile(new URL("../eval/metric-cases.json", import.meta.url)));
  assertEquals(validateMetricCases(f), []);
  assert(validateMetricCases({ ...f, cases: f.cases.slice(1) }).length > 0);
  const five = structuredClone(f); for (const c of five.cases.slice(0, 5)) c.service = "합성같은이름"; assert(validateMetricCases(five).length > 0);
  const extra = structuredClone(f); extra.cases.find((c: { group: string }) => c.group === "single").expect.push({ label: "x", count: 1, at: "2026-10-22T05:00:00.000Z", at_body: false });
  assert(validateMetricCases(extra).length > 0);
  // 구성 숫자(스펙 §15): 42 = 33 + 7 + 2, 기대 metric 50(반례 x2 의 {타임아웃, 0} 포함 — final-I2), 혼합은 일정 5 + metric 10씩. 보충 title 2개(t1·t2)는 42 밖
  assertEquals([file.cases.length, byGroup("title").length], [44, 2]);
  assertEquals(file.cases.filter((c) => c.time !== undefined && c.group !== "title").reduce((s, c) => s + c.expect.length, 0), 50);
  for (const m of byGroup("mixed_max")) assertEquals([m.events?.length, m.expect.length], [5, 10]);
  // 혼합 본문의 긴 label 을 15자 밑으로 줄이면 실패(기대 label 은 그 끝 두 낱말)
  const short = structuredClone(f);
  const mx = short.cases.find((c: { group: string }) => c.group === "mixed_max");
  mx.text = mx.text.replace(/\) (\S+ \S+~\S+) .+ (응답 타임아웃) (\d+건)/, ") $1 $2 $3");
  assert(validateMetricCases(short).some((p: string) => p.includes("mixed metric 0")), JSON.stringify(validateMetricCases(short)));
  // 스펙 문장이 바뀌면 실패(반례 하나의 글을 고친다)
  const reworded = structuredClone(f);
  const x = reworded.cases.find((c: { group: string }) => c.group === "counter"); x.text = x.text.replace("재시도 20건", "재시도 21건");
  assert(validateMetricCases(reworded).some((p: string) => p.startsWith("spec text")), JSON.stringify(validateMetricCases(reworded)));
});

Deno.test("title supplement (N8-title): t1 count only in title; validator rejects a body count, a missing title, a title outside its group, or a 3rd title case", () => {
  const t = byGroup("title")[0];
  assertEquals([t.id, t.title?.includes(`${t.expect[0].count}`), t.text.includes(`${t.expect[0].count}`)], ["t1", true, false]);
  const bad = (f: (x: MetricCaseFile) => void) => { const x = structuredClone(file); f(x); return validateMetricCases(x); };
  assert(bad((x) => { x.cases.find((c) => c.group === "title")!.text += " 6건"; }).some((p) => p.includes("count also in body")));
  assert(bad((x) => { delete x.cases.find((c) => c.group === "title")!.title; }).some((p) => p.includes("title missing")));
  assert(bad((x) => { x.cases[0].title = "[합성] 제목"; }).some((p) => p.includes("title outside title group")));
  assert(bad((x) => { x.cases.push({ ...structuredClone(t), id: "t3" }); }).some((p) => p.includes("title cases 3")));
  // 본문만 보면 버리고(이전 동작), 가린 제목 + 본문이면 받는다 — 러너·worker 와 같은 metricCheckText
  const raw = t.expect.map((m) => ({ label: m.label, count: m.count, start: "14:00", end: "14:10" }));
  assertEquals([normalizeMetrics(raw, t.occurred_at, t.text).length, normalizeMetrics(raw, t.occurred_at, metricCheckText(t.title, t.text))], [0, t.expect]);
  // ⑨: 놓치면 실패
  const miss = summarizeMetric(passRun().map((r) => r.id === "t1" ? judgeMetricCase(t, { metrics: [], events: [], status: "ok", output_tokens: 80 }) : r), 2048);
  assertEquals([miss.pass, miss.checks.c9_title], [false, "1/2"]);
});

Deno.test("title repeat supplement (final-I3): t2 has the same label·count in title and body; a model that emits it twice is cut to one by the server, so ⑨ passes; validator wants exactly one repeat case", () => {
  const t2 = file.cases.find((c) => c.id === "t2")!;
  const said = `${t2.expect[0].label} ${t2.expect[0].count}건`;
  assertEquals([t2.group, t2.title?.includes(said), t2.text.includes(said)], ["title", true, true]);
  const twice = [0, 1].map(() => ({ label: t2.expect[0].label, count: t2.expect[0].count, start: "14:00", end: "14:10" }));
  const got = normalizeMetrics(twice, t2.occurred_at, metricCheckText(t2.title, t2.text));
  assertEquals(got, t2.expect);
  const row = judgeMetricCase(t2, { metrics: got, events: [], status: "ok", output_tokens: 80 });
  assertEquals([row.matched, row.extra], [1, 0]);
  // 정규화 전 두 개를 그대로 세면 ⑨ 실패(여분 1)
  const doubled = summarizeMetric(passRun().map((r) => r.id === "t2" ? judgeMetricCase(t2, { metrics: [...t2.expect, ...t2.expect], events: [], status: "ok", output_tokens: 80 }) : r), 2048);
  assertEquals([doubled.pass, doubled.checks.c9_title], [false, "1/2"]);
  const noRepeat = structuredClone(file); noRepeat.cases.find((c) => c.id === "t2")!.text = "14:00~14:10 장애 6건 발생";
  assert(validateMetricCases(noRepeat).some((p) => p.includes("title repeat cases 0")), JSON.stringify(validateMetricCases(noRepeat)));
});

Deno.test("check text widening keeps every committed case (N8-title): each expected metric of the 42 is still accepted with a title line in front", () => {
  for (const c of file.cases.filter((c) => c.group !== "title")) {
    const raw = c.expect.map((m) => ({ label: m.label, count: m.count, start: null, end: null }));
    const pick = (ms: { label: string; count: number }[]) => ms.map((m) => [m.label, m.count]);
    const bodyOnly = pick(normalizeMetrics(raw, c.occurred_at, c.text));
    assertEquals(bodyOnly, pick(c.expect), c.id);
    assertEquals(pick(normalizeMetrics(raw, c.occurred_at, metricCheckText(`[${c.service}] 합성 알림 제목`, c.text))), bodyOnly, c.id);
  }
});

Deno.test("judgeMetricCase: label containment (spaces/case), count, at minute and at_body; one model metric used once (K19)", () => {
  const c = { id: "s1", group: "multi", time: "range", expect: [{ label: "타임아웃", count: 6, at: "2026-10-22T05:00:00.000Z", at_body: true }, { label: "타임아웃", count: 2, at: "2026-10-22T05:00:00.000Z", at_body: true }] };
  const r = judgeMetricCase(c as never, { metrics: [{ label: "결제 타임 아웃", count: 6, at: "2026-10-22T05:00:30.000Z", at_body: true }], events: [], status: "ok", output_tokens: 80 });
  assertEquals([r.matched, r.extra, r.time_ok, r.sum_ok], [1, 0, 1, false]);
  // 대소문자 무시, 여분 하나, at_body 가 다르면 시각 불일치
  const e = { id: "s2", group: "single", time: "range", expect: [{ label: "Timeout", count: 3, at: "2026-10-22T05:00:00.000Z", at_body: true }] };
  const r2 = judgeMetricCase(e as never, { metrics: [{ label: "API TIMEOUT", count: 3, at: "2026-10-22T05:00:00.000Z", at_body: false }, { label: "오류", count: 1, at: "2026-10-22T05:00:00.000Z", at_body: false }], events: [], status: "ok", output_tokens: 80 });
  assertEquals([r2.matched, r2.extra, r2.time_ok, r2.sum_ok, r2.got], [1, 1, 0, false, 2]);
});

Deno.test("judgeMetricCase: label match = expected core word (last word) contained in model label (Ruling N8-label); order still one-to-one", () => {
  const at = "2026-10-19T00:00:00.000Z";
  const c = { id: "m9", group: "mixed_max", expect: [{ label: "거부 오류", count: 11, at, at_body: true }, { label: "지연 경고", count: 7, at, at_body: true },
    { label: "결제 실패", count: 5, at, at_body: true }, { label: "취소 실패", count: 1, at, at_body: true }], events: [] };
  // 모델이 머리 낱말만('오류') · 더 긴 구('푸시 전송 지연 경고') · 같은 머리 낱말 둘(실패 ×2, 본문 순서)
  const got = [{ label: "오류", count: 11, at, at_body: true }, { label: "푸시 전송 지연 경고", count: 7, at, at_body: true },
    { label: "결제 실패", count: 5, at, at_body: true }, { label: "취소실패", count: 1, at, at_body: true }];
  const r = judgeMetricCase(c as never, { metrics: got, events: [], status: "ok", output_tokens: 80 });
  assertEquals([r.matched, r.extra, r.time_ok], [4, 0, 4]);
  // 머리 낱말이 없으면 불일치('거부'만 — 오류 없음)
  const r2 = judgeMetricCase(c as never, { metrics: [{ label: "거부", count: 11, at, at_body: true }], events: [], status: "ok", output_tokens: 80 });
  assertEquals([r2.matched, r2.extra], [0, 1]);
});

Deno.test("summarizeMetric: one run under any threshold → pass false; thresholds 0 none-emit, ≥48/50, extra ≤1, sum ≥32/33, time ≥48/50, out 2/2, tz 4/4, mixed done 2/2 events 2/2 metrics ≥19/20, title 2/2", () => {
  const ok = summarizeMetric(passRun(), 2048);
  assertEquals(ok.pass, true);
  assertEquals([ok.checks.c1, ok.checks.c2, ok.checks.c2_extra, ok.checks.c3, ok.checks.c4, ok.checks.c5, ok.checks.c6, ok.checks.c7, ok.checks.c7_out,
    ok.checks.c7_tz, ok.checks.c8_done, ok.checks.c8_events, ok.checks.c8_metrics, ok.checks.c9_title],
    ["0 emitted", "50/50", "0", "0", "2/2", "0", "33/33", "50/50", "2/2", "4/4", "2/2", "2/2", "20/20", "2/2"]);
  assertEquals(ok.cap, 2048);
  // 사례 하나만 바꾼 줄
  const swap = (id: string, row: MetricRow) => passRun().map((r) => r.id === id ? row : r);
  const plain = byGroup("none_plain")[0];
  const emit = summarizeMetric(swap(plain.id, judgeMetricCase(plain, { metrics: [{ label: "장애", count: 1, at: plain.occurred_at, at_body: false }], events: [], status: "ok", output_tokens: 90 })), 2048);
  assertEquals([emit.pass, emit.checks.c1], [false, "1 emitted"]);
  // ② label·count: 2개 틀림(48/50) 통과, 3개(47/50) 실패. 복수 사례 하나에서 두 count 를 맞바꾸면 합은 그대로(⑥ 영향 없음)
  const singles = byGroup("single");
  const u = byGroup("multi").find((c) => c.expect.length === 3 && c.expect[0].count !== c.expect[1].count)!;
  const swapped = judgeMetricCase(u, { metrics: u.expect.map((m, i) => i < 2 ? { ...m, count: u.expect[1 - i].count } : m), events: [], status: "ok", output_tokens: 90 });
  const miss2 = passRun().map((r) => r.id === u.id ? swapped : r);
  assertEquals([summarizeMetric(miss2, 2048).pass, summarizeMetric(miss2, 2048).checks.c2, summarizeMetric(miss2, 2048).checks.c6], [true, "48/50", "33/33"]);
  const s0 = singles[0];
  const miss3 = miss2.map((r) => r.id === s0.id ? judgeMetricCase(s0, { metrics: s0.expect.map((m) => ({ ...m, count: m.count + 1 })), events: [], status: "ok", output_tokens: 90 }) : r);
  assertEquals([summarizeMetric(miss3, 2048).pass, summarizeMetric(miss3, 2048).checks.c2, summarizeMetric(miss3, 2048).checks.c6], [false, "47/50", "32/33"]);
  // ⑥ 합: 두 사례 count 틀림 → 31/33 실패
  const sum2 = passRun().map((r) => {
    const i = singles.findIndex((c) => c.id === r.id);
    return i >= 0 && i < 2 ? judgeMetricCase(singles[i], { metrics: singles[i].expect.map((m) => ({ ...m, count: m.count + 1 })), events: [], status: "ok", output_tokens: 90 }) : r;
  });
  assertEquals([summarizeMetric(sum2, 2048).pass, summarizeMetric(sum2, 2048).checks.c6], [false, "31/33"]);
  // 여분 2개 → 실패(≤1)
  const extra2 = passRun().map((r) => {
    const i = singles.findIndex((c) => c.id === r.id);
    return i >= 0 && i < 2 ? judgeMetricCase(singles[i], { metrics: [...singles[i].expect, { label: "재시도", count: 1, at: singles[i].occurred_at, at_body: false }], events: [], status: "ok", output_tokens: 90 }) : r;
  });
  assertEquals([summarizeMetric(extra2, 2048).pass, summarizeMetric(extra2, 2048).checks.c2_extra], [false, "2"]);
  // ③ 합계를 넣음(여분 1 — ② 여분 ≤1 은 통과해도 ③ 0 위반)
  const sd = byGroup("sum_detail")[0];
  const total = summarizeMetric(swap(sd.id, judgeMetricCase(sd, { metrics: [{ label: "총", count: 8, at: sd.occurred_at, at_body: false }, ...sd.expect], events: [], status: "ok", output_tokens: 90 })), 2048);
  assertEquals([total.pass, total.checks.c3, total.checks.c2_extra], [false, "1", "1"]);
  // ④ 반복 사례가 두 번 넣음
  const rp = byGroup("repeat")[0];
  const twice = summarizeMetric(swap(rp.id, judgeMetricCase(rp, { metrics: [...rp.expect, ...rp.expect], events: [], status: "ok", output_tokens: 90 })), 2048);
  assertEquals([twice.pass, twice.checks.c4], [false, "1/2"]);
  // ⑤ 반례에서 '타임아웃' label 이 count ≥ 1 로 나옴(대체). '타임아웃 0건'의 {타임아웃, 0}은 대체가 아니다(final-I2 — x2 기대에 있다)
  const cx = byGroup("counter")[0];
  const sub = summarizeMetric(swap(cx.id, judgeMetricCase(cx, { metrics: [{ label: "타임아웃", count: 20, at: cx.occurred_at, at_body: false }], events: [], status: "ok", output_tokens: 90 })), 2048);
  assertEquals([sub.pass, sub.checks.c5], [false, "1"]);
  const x2 = file.cases.find((c) => c.id === "x2")!;
  assertEquals(judgeMetricCase(x2, { metrics: x2.expect, events: [], status: "ok", output_tokens: 90 }).timeout, 0);
  assertEquals(judgeMetricCase(x2, { metrics: [{ ...x2.expect[0], count: 20 }], events: [], status: "ok", output_tokens: 90 }).timeout, 1);
  // ⑦ 검증 밖 사례가 본문 시각을 씀, 시간대 사례 하나가 9시간 어긋남
  const out = byGroup("single").concat(byGroup("multi")).find((c) => c.time === "out_of_window")!;
  const body = summarizeMetric(swap(out.id, judgeMetricCase(out, { metrics: out.expect.map((m) => ({ ...m, at: "2026-10-14T01:00:00.000Z", at_body: true })), events: [], status: "ok", output_tokens: 90 })), 2048);
  assertEquals([body.pass, body.checks.c7_out], [false, "1/2"]);
  const tz = byGroup("tz")[0];
  const shifted = summarizeMetric(swap(tz.id, judgeMetricCase(tz, { metrics: tz.expect.map((m) => ({ ...m, at: new Date(Date.parse(m.at) + 9 * 3600_000).toISOString() })), events: [], status: "ok", output_tokens: 90 })), 2048);
  assertEquals([shifted.pass, shifted.checks.c7_tz, shifted.checks.c7], [true, "3/4", "49/50"]);   // final-tz: 시간대 하나 어긋남은 허용
  const tz2 = byGroup("tz")[1];
  const off9 = (c: typeof tz) => judgeMetricCase(c, { metrics: c.expect.map((m) => ({ ...m, at: new Date(Date.parse(m.at) + 9 * 3600_000).toISOString() })), events: [], status: "ok", output_tokens: 90 });
  const shifted2 = summarizeMetric(passRun().map((r) => r.id === tz.id ? off9(tz) : r.id === tz2.id ? off9(tz2) : r), 2048);
  assertEquals([shifted2.pass, shifted2.checks.c7_tz], [false, "2/4"]);   // 둘은 실패
  // ⑧ 혼합: 일정 하나 빠짐 → 실패, metric 하나 틀림(19/20) → 통과, 둘(18/20) → 실패
  const mx = byGroup("mixed_max")[0];
  const fewer = summarizeMetric(swap(mx.id, judgeMetricCase(mx, { metrics: mx.expect, events: mx.events!.slice(1).map((e) => e.starts), status: "ok", output_tokens: 900 })), 2048);
  assertEquals([fewer.pass, fewer.checks.c8_events], [false, "1/2"]);
  const m19 = summarizeMetric(swap(mx.id, judgeMetricCase(mx, { metrics: mx.expect.map((m, i) => i === 0 ? { ...m, count: m.count + 1 } : m), events: mx.events!.map((e) => e.starts), status: "ok", output_tokens: 900 })), 2048);
  assertEquals([m19.pass, m19.checks.c8_metrics], [true, "19/20"]);
  const m18 = summarizeMetric(swap(mx.id, judgeMetricCase(mx, { metrics: mx.expect.map((m, i) => i < 2 ? { ...m, count: m.count + 1 } : m), events: mx.events!.map((e) => e.starts), status: "ok", output_tokens: 900 })), 2048);
  assertEquals([m18.pass, m18.checks.c8_metrics], [false, "18/20"]);
  // 두 번째 실행만 미달이어도 실패(2회 모두)
  const two = summarizeMetric([...passRun(), ...swap(plain.id, judgeMetricCase(plain, { metrics: [{ label: "장애", count: 1, at: plain.occurred_at, at_body: false }], events: [], status: "ok", output_tokens: 90 }))], 2048);
  assertEquals([two.pass, two.checks.c1], [false, "0 emitted | 1 emitted"]);
});

Deno.test("summarizeMetric: incomplete mixed run → c8_done fails, its tokens go to max_mixed_output_incomplete and its id to incomplete, max_mixed_output counts completed runs only (K25)", () => {
  const [m1, m2] = byGroup("mixed_max");
  assertEquals([m1.id, m2.id], ["m1", "m2"]);
  const run1 = passRun().map((r) => r.id === "m1" ? judgeMetricCase(m1, { metrics: [], events: [], status: "incomplete", output_tokens: 2048 })
    : r.id === "m2" ? echo(m2, { output_tokens: 1400 }) : r);
  const run2 = passRun().map((r) => r.id === "m1" ? echo(m1, { output_tokens: 1500 }) : r.id === "m2" ? echo(m2, { output_tokens: 1300 }) : r);
  const s = summarizeMetric([...run1, ...run2], 4096);
  assertEquals(s.pass, false);
  assertEquals(s.incomplete, ["m1"]);
  assertEquals(s.max_mixed_output_incomplete, 2048);
  assertEquals(s.max_mixed_output, 1500);
  assertEquals(s.cap, 4096);
  assertEquals(s.checks.c8_done, "1/2 | 2/2");
  // 잘린 실행은 metric 0개로 판정(⑧ metrics 10/20)
  assertEquals(s.checks.c8_metrics, "10/20 | 20/20");
  // 잘림이 없으면 incomplete 빈 배열·incomplete 토큰 0
  const clean = summarizeMetric(run2, 2048);
  assertEquals([clean.pass, clean.incomplete, clean.max_mixed_output, clean.max_mixed_output_incomplete], [true, [], 1500, 0]);
});

Deno.test("judgeRegression: right in both general runs and wrong in any rule run → new_wrong; rule-mode metric emission ≤ 1/24", () => {
  assertEquals(judgeRegression([["ok", "ok"], ["ok", "kind"]], [["ok", "split"], ["ok", "ok"]], [0, 0]).new_wrong, ["0"]);
  assertEquals(judgeRegression([["ok", "ok"]], [["ok", "ok"]], [2]).pass, true);                    // 한 사례가 낸 것은 사례 1로 센다
  // 두 사례가 내면 실패, 규칙 모드 error 도 틀림
  assertEquals(judgeRegression([["ok", "ok"], ["ok", "ok"]], [["ok", "ok"], ["ok", "ok"]], [1, 1]), { new_wrong: [], emitted: 2, pass: false });
  assertEquals(judgeRegression([["ok", "ok"]], [["error", "ok"]], [0]), { new_wrong: ["0"], emitted: 0, pass: false });
});
