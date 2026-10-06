// INTENT-eval 러너: chat 필터 함수(extractFilters, withIntent)를 직접 부른다 — 플래그·intents 변환 전의 원래 의도(스펙 §15). DB·사용자 없음, OpenAI 키만
// 출력은 사례 id·그룹·기대·결과·칸 일치만(문장 글·칸 값 없음 — AGENTS.md §7 형식)
// 사용: deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/eval-intent.ts --runs 3 [--mail-judged]
import { extractFilters } from "../functions/chat/filters.ts";
import { type CaseFile, judge, type Row, summarize, validateCases } from "./_intent-eval.ts";

const file = JSON.parse(await Deno.readTextFile(new URL("../eval/intent-cases.json", import.meta.url))) as CaseFile;
const problems = validateCases(file);
if (problems.length) { console.log(JSON.stringify({ error: "cases", problems })); Deno.exit(1); }
const runs = Number(Deno.args[Deno.args.indexOf("--runs") + 1] || 1);
const mailJudged = Deno.args.includes("--mail-judged");
const rows: Row[] = [];
for (let run = 1; run <= runs; run++) {
  for (const c of file.cases) {
    const r = await extractFilters(c.text, file.today, c.context ?? [], true);
    const row = judge(c, { intent: r.intent ?? "question", mail: r.mail ?? null });
    rows.push(row);
    console.log(JSON.stringify({ run, ...row }));
  }
}
// ADD-sim 문장(G1 = a01, G3 = a12, G7 = a13, G4 = q04)은 3회 모두 기대값이어야 A6 를 돌린다 — 재현율 0.9 합격선은 특정 문장의 실패를 허용한다(Fable F2)
const GATE = ["a01", "a12", "a13", "q04"];
console.log(JSON.stringify({ ...summarize(rows, runs, mailJudged), gate_cases: GATE.every((id) => rows.filter((r) => r.id === id).every((r) => r.got === r.expected)) }));
