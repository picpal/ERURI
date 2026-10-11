// EDIT-eval 러너(스펙 §15, 계획 E5·K4): ① chat 필터 함수(extractFilters, edit 모드)를 사례의 <registered> 합성 값으로 직접 부른다 — 배포본과 같은 코드
// ② 합성 채팅 등록 글을 워커와 같은 텍스트 추출 함수로 직접 추출해 uncertain 의 ampm 을 본다. DB·사용자 없음, OpenAI 키만.
// 출력은 사례 id·그룹·기대·결과·코드·불리언만(문장 글·칸 값 없음 — AGENTS.md §7 형식)
// 사용: deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/eval-edit.ts --runs 3 [--extract-only]
// --extract-only: ② 추출 사례만(추출 지시문만 바뀐 재측정 — 최종 리뷰 I2). 그때 판정은 extract_gate 만
import { extractTextDetailed } from "../functions/_shared/extract-text.ts";
import { extractFilters } from "../functions/chat/filters.ts";
import { type EditCaseFile, type EditRow, extractVerdict, judgeEdit, summarizeEdit, validateEditCases } from "./_edit-eval.ts";
import { parseRuns } from "./_intent-eval.ts";

const file = JSON.parse(await Deno.readTextFile(new URL("../eval/edit-cases.json", import.meta.url))) as EditCaseFile;
const problems = validateEditCases(file);
if (problems.length) { console.log(JSON.stringify({ error: "cases", problems })); Deno.exit(1); }
const runs = parseRuns(Deno.args);
if (runs === null) { console.log(JSON.stringify({ error: "runs", want: "--runs <positive integer>" })); Deno.exit(1); }
const extractOnly = Deno.args.includes("--extract-only");
const all: { run: number; rows: EditRow[] }[] = [];
const extract: { run: number; id: string; ok: boolean; code: string | null }[] = [];
for (let run = 1; run <= runs; run++) {
  const rows: EditRow[] = [];
  for (const c of extractOnly ? [] : file.cases) {
    // mode none = edit_target 없는 요청(0.15.0 모양), 그 밖 = 편집 모드(registered null 이면 블록 없이 — 대상이 ok 가 아님)
    const edit = c.mode === "none" ? null : { registered: c.registered ? file.registered[c.registered] : null };
    const r = await extractFilters(c.text, file.today, [], true, undefined, edit);
    const row = judgeEdit(file, c, { intent: r.intent ?? "question", edit: r.edit ?? null });
    rows.push(row);
    console.log(JSON.stringify({ run, ...row }));
  }
  all.push({ run, rows });
  for (const x of file.extract) {
    const { result } = await extractTextDetailed(x.text, { source: "SHARE", appName: "채팅", title: null }, file.today);
    const v = extractVerdict(x, { kind: result.kind, uncertain: result.kind === "event" ? result.events.map((e) => e.event.uncertain) : [] });
    extract.push({ run, ...v });
    console.log(JSON.stringify({ run, extract: v.id, ok: v.ok, code: v.code }));
  }
}
const xPass = extract.every((x) => x.ok);
if (extractOnly) {
  console.log(JSON.stringify({ extract_only: true, runs, extract_gate: xPass ? "pass" : "fail", extract_fail: extract.filter((x) => !x.ok).map((x) => `${x.run}:${x.id}:${x.code}`) }));
  if (!xPass) Deno.exitCode = 1;
  Deno.exit();
}
const s = summarizeEdit(all);
console.log(JSON.stringify({ ...s, extract_gate: xPass ? "pass" : "fail", extract_fail: extract.filter((x) => !x.ok).map((x) => `${x.run}:${x.id}:${x.code}`) }));
if (s.gate !== "pass" || !xPass) Deno.exitCode = 1;
