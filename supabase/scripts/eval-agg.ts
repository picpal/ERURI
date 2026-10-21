// AGG-eval 러너(스펙 §15, 0.17.0): chat 필터 함수(extractFilters, 0.17.0 모드 — 배포본과 같은 코드)를 직접 부르고 재검증(이어받기 ⑥ 포함) 뒤 칸을 판정한다.
// 오늘은 사례 파일의 2026-10-21(수) 고정. DB·사용자 없음, OpenAI 키만. 출력은 사례 id·그룹·의도·칸 일치만(문장 글·칸 값 없음 — AGENTS.md §7)
// 사용: deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/eval-agg.ts --runs 2
import { extractFilters } from "../functions/chat/filters.ts";
import { type AggCaseFile, type AggRow, judgeAgg, summarizeAgg, validateAggCases } from "./_agg-eval.ts";
import { parseRuns } from "./_intent-eval.ts";

const file = JSON.parse(await Deno.readTextFile(new URL("../eval/agg-cases.json", import.meta.url))) as AggCaseFile;
const problems = validateAggCases(file);
if (problems.length) { console.log(JSON.stringify({ error: "cases", problems })); Deno.exit(1); }
const runs = parseRuns(Deno.args);
if (runs === null) { console.log(JSON.stringify({ error: "runs", want: "--runs <positive integer>" })); Deno.exit(1); }
const all: AggRow[][] = [];
for (let run = 1; run <= runs; run++) {
  const rows: AggRow[] = [];
  for (const c of file.cases) {
    // 앱 0.17.0 요청과 같다: intents 에 새 의도 넷(고치기 대상 없음 → edit null), 연속 턴이면 앞 턴 맥락 + aggregate_context(재검증된 직전 조건)
    const r = await extractFilters(c.text, file.today, c.context ?? [], true, undefined, null, { previous: c.previous ?? null });
    const row = judgeAgg(c, { intent: r.intent ?? "question", aggregate: r.aggregate ?? null, save_rule: r.save_rule ?? null }, file.today);
    rows.push(row);
    console.log(JSON.stringify({ run, ...row }));
  }
  all.push(rows);
}
console.log(JSON.stringify(summarizeAgg(all)));
