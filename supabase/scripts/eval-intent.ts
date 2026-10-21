// INTENT-eval 러너: chat 필터 함수(extractFilters, withIntent)를 직접 부른다 — 플래그·intents 변환 전의 원래 의도(스펙 §15). DB·사용자 없음, OpenAI 키만
// 출력은 사례 id·그룹·기대·결과·칸 일치만(문장 글·칸 값 없음 — AGENTS.md §7 형식)
// --mode 0.16(기본, 새 의도 없음 — 0.16.x 요청 바이트 동일) · 0.17(0.17.0 intents — aggregate·save_rule_* 결과는 앱 intents 에 있으므로 그대로 오답) ·
// both(0.17.0 회귀, K13: 사례마다 0.16 → 0.17 을 번갈아 같은 세션 기준선을 만들고 new_wrong·flaky 를 낸다 — 칸 판정(mail·read)은 늘 켠다. 게이트는 --runs 4)
// 사용: deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/eval-intent.ts --runs 3 [--mail-judged] [--read-judged] [--mode both]
import { extractFilters } from "../functions/chat/filters.ts";
import { parseEvalMode } from "./_agg-eval.ts";
import { type Case, type CaseFile, flakyCases, gateCases, judge, newlyWrong, parseRuns, type Row, summarize, validateCases } from "./_intent-eval.ts";

const file = JSON.parse(await Deno.readTextFile(new URL("../eval/intent-cases.json", import.meta.url))) as CaseFile;
const problems = validateCases(file);
if (problems.length) { console.log(JSON.stringify({ error: "cases", problems })); Deno.exit(1); }
const runs = parseRuns(Deno.args);
if (runs === null) { console.log(JSON.stringify({ error: "runs", want: "--runs <positive integer>" })); Deno.exit(1); }
const mode = parseEvalMode(Deno.args);
if (mode === null) { console.log(JSON.stringify({ error: "mode", want: "--mode 0.16|0.17|both" })); Deno.exit(1); }
const mailJudged = mode === "both" || Deno.args.includes("--mail-judged");
const readJudged = mode === "both" || Deno.args.includes("--read-judged");

async function one(c: Case, agg: boolean): Promise<Row> {
  const r = agg ? await extractFilters(c.text, file.today, c.context ?? [], true, undefined, null, { previous: null })
    : await extractFilters(c.text, file.today, c.context ?? [], true);
  return judge(c, { intent: r.intent ?? "question", mail: r.mail ?? null, mail_read: r.mail_read ?? null });
}
const base: Row[] = [], next: Row[] = [];
for (let run = 1; run <= runs; run++) {
  for (const c of file.cases) {
    if (mode !== "0.17") { const row = await one(c, false); base.push(row); console.log(JSON.stringify({ run, mode: "0.16", ...row })); }
    if (mode !== "0.16") { const row = await one(c, true); next.push(row); console.log(JSON.stringify({ run, mode: "0.17", ...row })); }
  }
}
const report = (rows: Row[]) => ({ ...summarize(rows, runs, mailJudged, readJudged), gate_cases: gateCases(rows) });
if (mode !== "both") console.log(JSON.stringify(report(mode === "0.16" ? base : next)));
else {
  // 흔들림(기준선 회차끼리 갈린 사례)은 new_wrong 에서 빠지고 비율로 따로(스펙 §15, 2026-10-21 메인 판정 — 0.16.x·0.17.0 각 4회)
  const b = report(base), n = report(next), new_wrong = newlyWrong(base, next), flaky = flakyCases(base, next);
  console.log(JSON.stringify({ mode, pass: n.gate === "pass" && n.gate_cases && new_wrong.length === 0, new_wrong, flaky, base: b, agg: n }));
}
