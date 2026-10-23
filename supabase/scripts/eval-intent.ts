// INTENT-eval 러너: chat 필터 함수(extractFilters, withIntent)를 직접 부른다 — 플래그·intents 변환 전의 원래 의도(스펙 §15). DB·사용자 없음, OpenAI 키만
// 출력은 사례 id·그룹·기대·결과·칸 일치만(문장 글·칸 값 없음 — AGENTS.md §7 형식)
// --mode 0.16(기본, 새 의도 없음 — 0.16.x 요청 바이트 동일) · 0.17(0.17.0 intents — aggregate·save_rule_* 결과는 앱 intents 에 있으므로 그대로 오답) ·
// both(0.17.0 회귀, K13: 사례마다 0.16 → 0.17 을 번갈아 같은 세션 기준선을 만들고 갈린 사례만 각 8회 더 돌려 오답률 차로 new_wrong 을 낸다 — 칸 판정(mail·read)은 늘 켠다. 게이트는 --runs 4.
// 두 모드 필터 요청이 바이트 동일한 사례(identical)는 회귀 비교에서 뺀다 — Ruling A10-identical. --dry 는 identical 만 내고 모델을 부르지 않는다)
// --base 0.18(0.19.0 회귀, DP15): 두 모드를 기준선 = stripCount(0.19.0 요청 — 0.18.x 바이트) ↔ 0.19.0 요청(mail_read.count 칸)으로 바꾼다. 둘 다 0.17.0+ 앱 intents·단서 게이트.
//   count 는 판정하지 않는다(사례에 count 기대가 없다 — count 정확도는 DIGEST-eval ②). 출력 mode 이름은 0.18/0.19
// 사용: deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/eval-intent.ts --runs 3 [--mail-judged] [--read-judged] [--mode both [--base 0.18] [--dry]]
import { ACTION_INTENTS, aggModeFor, extractFilters, filterRequest } from "../functions/chat/filters.ts";
import { parseBase, parseEvalMode } from "./_agg-eval.ts";
import { stripCount } from "./_intent-base.ts";
import { type Case, type CaseFile, errorRates, excludeIdentical, gateCases, judge, newlyWrongByRate, parseRuns, RATE_EXTRA_RUNS, type Row, summarize, unsettled, validateCases } from "./_intent-eval.ts";

const file = JSON.parse(await Deno.readTextFile(new URL("../eval/intent-cases.json", import.meta.url))) as CaseFile;
const problems = validateCases(file);
if (problems.length) { console.log(JSON.stringify({ error: "cases", problems })); Deno.exit(1); }
const runs = parseRuns(Deno.args);
if (runs === null) { console.log(JSON.stringify({ error: "runs", want: "--runs <positive integer>" })); Deno.exit(1); }
const mode = parseEvalMode(Deno.args);
if (mode === null) { console.log(JSON.stringify({ error: "mode", want: "--mode 0.16|0.17|both" })); Deno.exit(1); }
const evalBase = parseBase(Deno.args);
if (evalBase === "bad") { console.log(JSON.stringify({ error: "base", want: "--base 0.18" })); Deno.exit(1); }
const BASE_018 = evalBase === "0.18";
const [BASE_NAME, NEXT_NAME] = BASE_018 ? ["0.18", "0.19"] : ["0.16", "0.17"];
const mailJudged = mode === "both" || Deno.args.includes("--mail-judged");
const readJudged = mode === "both" || Deno.args.includes("--read-judged");

// 0.17 모드 = 0.17.0 앱 intents(새 의도 넷 포함) — 0.17.0 스키마는 handler 와 같은 단서 게이트(aggModeFor, 직전 집계 없음): 단서 없는 글은 0.16.x 요청
const APP_0170 = new Set<string>(ACTION_INTENTS);
async function one(c: Case, agg: boolean): Promise<Row> {
  if (BASE_018) {   // 0.19.0 회귀(DP15): 기준선 = stripCount(같은 요청) — 0.18.x 바이트, 새 = 0.19.0(count 칸). 둘 다 0.17.0+ 앱 intents
    const aggMode = aggModeFor(c.text, APP_0170, null);
    const r = await extractFilters(c.text, file.today, c.context ?? [], true, undefined, null, aggMode, agg ? undefined : stripCount);
    return judge(c, { intent: r.intent ?? "question", mail: r.mail ?? null, mail_read: r.mail_read ?? null });
  }
  const r = agg ? await extractFilters(c.text, file.today, c.context ?? [], true, undefined, null, aggModeFor(c.text, APP_0170, null))
    : await extractFilters(c.text, file.today, c.context ?? [], true);
  return judge(c, { intent: r.intent ?? "question", mail: r.mail ?? null, mail_read: r.mail_read ?? null });
}
// 두 모드 요청 JSON 이 같은 사례 id(로컬 — 모델 호출 없음)
const identical = mode !== "both" ? [] : BASE_018
  ? file.cases.filter((c) => { const req = filterRequest(c.text, file.today, c.context ?? [], true, null, aggModeFor(c.text, APP_0170, null)); return JSON.stringify(stripCount(req)) === JSON.stringify(req); }).map((c) => c.id).sort()
  : file.cases.filter((c) => JSON.stringify(filterRequest(c.text, file.today, c.context ?? [], true))
    === JSON.stringify(filterRequest(c.text, file.today, c.context ?? [], true, null, aggModeFor(c.text, APP_0170, null)))).map((c) => c.id).sort();
if (mode === "both" && Deno.args.includes("--dry")) { console.log(JSON.stringify({ mode, dry: true, cases: file.cases.length, identical_count: identical.length, identical })); Deno.exit(0); }
const base: Row[] = [], next: Row[] = [];
for (let run = 1; run <= runs; run++) {
  for (const c of file.cases) {
    if (mode !== "0.17") { const row = await one(c, false); base.push(row); console.log(JSON.stringify({ run, mode: BASE_NAME, ...row })); }
    if (mode !== "0.16") { const row = await one(c, true); next.push(row); console.log(JSON.stringify({ run, mode: NEXT_NAME, ...row })); }
  }
}
const report = (rows: Row[]) => ({ ...summarize(rows, runs, mailJudged, readJudged), gate_cases: gateCases(rows) });
if (mode !== "both") console.log(JSON.stringify(report(mode === "0.16" ? base : next)));
else {
  // 오답률 판정(스펙 §15, 2026-10-21 메인 판정): 첫 회차들에서 갈린 사례만 두 모드 각 8회 더(0.16 → 0.17 번갈아), 전 회차 오답률 차 ≥ 25%p 면 new_wrong.
  // 합격선 요약·게이트 문장은 첫 회차들(--runs)로만 본다
  const b = report(base), n = report(next), ids = excludeIdentical(unsettled(base, next), identical);
  const extraBase: Row[] = [], extraNext: Row[] = [];
  for (let k = 1; k <= RATE_EXTRA_RUNS; k++) {
    for (const c of file.cases.filter((x) => ids.includes(x.id))) {
      const r0 = await one(c, false); extraBase.push(r0); console.log(JSON.stringify({ run: runs + k, mode: BASE_NAME, extra: true, ...r0 }));
      const r1 = await one(c, true); extraNext.push(r1); console.log(JSON.stringify({ run: runs + k, mode: NEXT_NAME, extra: true, ...r1 }));
    }
  }
  const rates = errorRates([...base, ...extraBase], [...next, ...extraNext], ids), new_wrong = newlyWrongByRate(rates);
  console.log(JSON.stringify({ mode, pass: n.gate === "pass" && n.gate_cases && new_wrong.length === 0, new_wrong, identical, rates, base: b, agg: n }));
}
