// METRIC-eval·추출 회귀 러너(스펙 §15, 0.18.0): 배포본과 같은 extractTextDetailed(규칙 항목 모드)·normalizeMetrics 를 직접 부른다. DB·사용자 없음, OpenAI 키만.
// 출력은 사례 id·그룹·불리언·개수·토큰·status·cap 만(label·본문·숫자 값 없음 — AGENTS.md §7)
// 사용: deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/eval-metric.ts --runs 2 [--cap n] [--ids s01,m1]
//       … --mixed-only --runs 2 [--cap n]   (혼합 2사례만 — K25 재측정·확정 확인)
//       … --regression --runs 2 [--cap n]   (multi-event 24 × 일반 모드, SHARE 뺀 23 × 규칙 모드)
// --cap 은 ExtractOpts.cap 으로만 넘긴다(규칙 모드 상한 — 상수를 고치지 않고 잰다)
import { extractTextDetailed, type ExtractOpts, RULE_MAX_OUTPUT_TOKENS, type TextMeta } from "../functions/_shared/extract-text.ts";
import { metricCheckText, normalizeMetrics } from "../functions/_shared/metrics.ts";
import { receivedDay } from "../functions/_shared/time.ts";
import { judge } from "../eval/run-multi-event-eval.ts";
import { judgeMetricCase, judgeRegression, type MetricCaseFile, type MetricRow, type MetricStatus, summarizeMetric,
  validateMetricCases } from "./_metric-eval.ts";
import { parseRuns } from "./_intent-eval.ts";

const META: TextMeta = { source: "MESSAGES", appName: null, title: null };
const arg = (k: string) => { const i = Deno.args.indexOf(k); return i >= 0 ? Deno.args[i + 1] : undefined; };
const runs = parseRuns(Deno.args);
if (runs === null) { console.log(JSON.stringify({ error: "runs", want: "--runs <positive integer>" })); Deno.exit(1); }
const capArg = arg("--cap");
if (capArg !== undefined && !/^[1-9]\d*$/.test(capArg)) { console.log(JSON.stringify({ error: "cap", want: "--cap <positive integer>" })); Deno.exit(1); }
const cap = capArg === undefined ? undefined : Number(capArg);
const ruleOpts: ExtractOpts = { metrics: true, ...(cap ? { cap } : {}) };
const effectiveCap = cap ?? RULE_MAX_OUTPUT_TOKENS;

type Call = { out: Awaited<ReturnType<typeof extractTextDetailed>> | null; status: MetricStatus; output_tokens: number; err?: string };
// 출력 토큰은 onUsage 값 — 파싱보다 먼저 불려 incomplete 로 던진 응답도 남는다(K25)
async function call(text: string, meta: TextMeta, today: string, opts?: ExtractOpts): Promise<Call> {
  let output = 0;
  try {
    const out = await extractTextDetailed(text, meta, today, (u) => { output = u?.output ?? 0; }, opts);
    return { out, status: "ok", output_tokens: output };
  } catch (e) {
    const msg = String((e as Error).message ?? "");
    const status = (e as { status?: number }).status;
    return { out: null, status: /incomplete/.test(msg) ? "incomplete" : "error", output_tokens: output,
      err: status ? `http_${status}` : /refusal|bad_json/.test(msg) ? msg.replace(/^openai /, "") : "throw" };
  }
}
const stats = (xs: number[]) => ({ max: xs.reduce((a, b) => Math.max(a, b), 0), mean: xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0 });

if (Deno.args.includes("--regression")) {
  type Case = { id: string; kind: string; text: string; starts: string[]; ends?: string[]; today?: string; meta?: TextMeta };
  const spec = JSON.parse(await Deno.readTextFile(new URL("../eval/multi-event.json", import.meta.url))) as { today: string; cases: Case[] };
  const isShare = (c: Case) => (c.meta ?? META).source === "SHARE";
  const ruled = spec.cases.filter((c) => !isShare(c));                       // 규칙 항목은 SHARE 일 수 없다(Ruling PF-F1)
  const general: string[][] = spec.cases.map(() => []), rule: string[][] = ruled.map(() => []), emitted: number[] = ruled.map(() => 0);
  const gTok: number[] = [], rTok: number[] = [];
  const code = (c: Case, r: Call) => {
    if (!r.out) return r.status === "incomplete" ? "incomplete" : "error";
    const evs = r.out.result.kind === "event" ? r.out.result.events : [];
    return judge(c, { kind: r.out.result.kind, starts: evs.map((e) => e.event.start ?? ""), ends: evs.map((e) => e.event.end) });
  };
  for (let run = 1; run <= runs; run++) {
    for (const [i, c] of spec.cases.entries()) {
      const today = c.today ?? spec.today, meta = c.meta ?? META;
      const g = await call(c.text, meta, today);
      general[i].push(code(c, g)); gTok.push(g.output_tokens);
      const k = ruled.indexOf(c);
      if (k < 0) { console.log(JSON.stringify({ run, id: c.id, general: general[i].at(-1), general_tokens: g.output_tokens, rule: "n/a_share" })); continue; }
      const r = await call(c.text, meta, today, ruleOpts);
      const n = r.out ? normalizeMetrics(r.out.metrics, `${today}T12:00:00+09:00`, c.text).length : 0;
      rule[k].push(code(c, r)); rTok.push(r.output_tokens);
      if (n > 0) emitted[k]++;
      console.log(JSON.stringify({ run, id: c.id, general: general[i].at(-1), general_tokens: g.output_tokens, rule: rule[k].at(-1), rule_metrics: n,
        rule_tokens: r.output_tokens, rule_status: r.status, ...(r.err ? { err: r.err } : {}), cap: effectiveCap }));
    }
  }
  const generalRuled = ruled.map((c) => general[spec.cases.indexOf(c)]);
  const res = judgeRegression(generalRuled, rule, emitted);
  const allOk = (xs: string[][]) => xs.filter((v) => v.every((x) => x === "ok")).length;
  console.log(JSON.stringify({ runs, cases: spec.cases.length, rule_cases: ruled.length, share_excluded: spec.cases.filter(isShare).map((c) => c.id),
    general_all_ok: allOk(general), rule_all_ok: allOk(rule), general_tokens: stats(gTok), rule_tokens: stats(rTok), cap: effectiveCap }));
  console.log(JSON.stringify({ new_wrong: res.new_wrong.map((i) => ruled[Number(i)].id), emitted: res.emitted, pass: res.pass }));
  Deno.exit(res.pass ? 0 : 1);
}

const file = JSON.parse(await Deno.readTextFile(new URL("../eval/metric-cases.json", import.meta.url))) as MetricCaseFile;
const problems = validateMetricCases(file);
if (problems.length) { console.log(JSON.stringify({ error: "cases", problems })); Deno.exit(1); }
const ids = arg("--ids")?.split(",");
const cases = Deno.args.includes("--mixed-only") ? file.cases.filter((c) => c.group === "mixed_max")
  : ids ? file.cases.filter((c) => ids.includes(c.id)) : file.cases;
if (cases.length === 0) { console.log(JSON.stringify({ error: "ids", want: "--ids <case id,…>" })); Deno.exit(1); }
const rows: MetricRow[] = [];
for (let run = 1; run <= runs; run++) {
  for (const c of cases) {
    // 제목 사례(N8-title)는 알림 제목을 meta.title 로 보내고 worker 와 같은 검증 글(가린 제목 + 본문)로 정규화한다
    const meta: TextMeta = c.title === undefined ? META : { source: "NOTIFICATION", appName: null, title: c.title };
    const r = await call(c.text, meta, receivedDay(c.occurred_at), ruleOpts);
    const evs = r.out && r.out.result.kind === "event" ? r.out.result.events.map((e) => e.event.start ?? "") : [];
    const row = judgeMetricCase(c, { metrics: r.out ? normalizeMetrics(r.out.metrics, c.occurred_at, metricCheckText(c.title, c.text)) : [], events: evs, status: r.status,
      output_tokens: r.output_tokens });
    rows.push(row);
    console.log(JSON.stringify({ run, ...row, ...(r.err ? { err: r.err } : {}), cap: effectiveCap }));
  }
}
const s = summarizeMetric(rows, effectiveCap);
const ok = rows.filter((r) => r.status === "ok");
console.log(JSON.stringify({ runs, cases: cases.length, checks: s.checks, output_tokens: stats(ok.map((r) => r.output_tokens)),
  mixed_output_tokens: stats(ok.filter((r) => r.group === "mixed_max").map((r) => r.output_tokens)),
  errors: rows.filter((r) => r.status === "error").map((r) => r.id) }));
console.log(JSON.stringify({ pass: s.pass, cap: s.cap, incomplete: s.incomplete, max_mixed_output: s.max_mixed_output,
  max_mixed_output_incomplete: s.max_mixed_output_incomplete }));
Deno.exit(s.pass ? 0 : 1);
