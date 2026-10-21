// 단서 프로브 러너(0.17.0 최종 리뷰 I2, 스펙 §15 INTENT-0170): 집계·규칙 단서(또는 직전 집계 맥락)가 걸려 0.17.0 스키마를 타는 기존 의도 문장을
// 사례마다 0.16.x 요청(기준선) → 0.17.0 요청(handler 와 같은 단서 게이트 aggModeFor, 고치기 대상이면 9의도 스키마) 순으로 같은 세션에서 부른다.
// 합격 = 0.17 모드 모든 실행에서 모델 의도가 기대 의도와 같다(새 의도 넷 포함 다른 의도로 오발 0). DB·사용자 없음, OpenAI 키만. 출력은 id·의도만(AGENTS.md §7)
// 사용: deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/eval-agg-probe.ts --runs 2
import { ACTION_INTENTS, aggModeFor, extractFilters } from "../functions/chat/filters.ts";
import { type ProbeFile, probeRow, type ProbeRow, summarizeProbe, validateProbeCases } from "./_agg-probe.ts";
import { parseRuns } from "./_intent-eval.ts";

const file = JSON.parse(await Deno.readTextFile(new URL("../eval/agg-probe-cases.json", import.meta.url))) as ProbeFile;
const problems = validateProbeCases(file);
if (problems.length) { console.log(JSON.stringify({ error: "cases", problems })); Deno.exit(1); }
const runs = parseRuns(Deno.args);
if (runs === null) { console.log(JSON.stringify({ error: "runs", want: "--runs <positive integer>" })); Deno.exit(1); }
const APP_0170 = new Set<string>(ACTION_INTENTS);
const rows: ProbeRow[] = [];
for (let run = 1; run <= runs; run++) {
  for (const c of file.cases) {
    const edit = c.registered ? { registered: c.registered } : null;
    for (const mode of ["0.16", "0.17"] as const) {
      const agg = mode === "0.17" ? aggModeFor(c.text, APP_0170, c.previous ?? null) : null;
      const r = await extractFilters(c.text, file.today, c.context ?? [], true, undefined, edit, agg);
      const row = probeRow(c, mode, r.intent ?? "question", r.aggregate ?? null, file.today);
      rows.push(row);
      console.log(JSON.stringify({ run, ...row }));
    }
  }
}
console.log(JSON.stringify({ runs, ...summarizeProbe(rows) }));
