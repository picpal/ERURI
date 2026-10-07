// SUMMARY-eval ② 러너(스펙 §15): 합성 메일 → extractBody → maskMail → 12,000/4,000 자르기 → summarize(실호출, gpt-6-luna) → finishSummary → 판정. 3회.
// DB·사용자·예산 RPC 없음(OpenAI 키만). stdout = 사례 id·판정·토큰 수만. 출력 글은 supabase/eval/mail-summary.local.json(gitignore)에만 — 수동 검토용
// 사용: deno run --allow-net --allow-env --allow-read --allow-write=supabase/eval --env-file=supabase/.env supabase/scripts/eval-mail-summary.ts --runs 3
import { costKrw } from "../functions/_shared/budget.ts";
import { header } from "../functions/_shared/gmail.ts";
import { clipText, extractBody, SUMMARY_BODY_MAX, TRANSLATE_SOURCE_MAX } from "../functions/_shared/mail-body.ts";
import { maskMail } from "../functions/_shared/rules.ts";
import { SummaryFailed } from "../functions/mail-read/common.ts";
import { finishSummary, summarize, SUMMARY_MODEL, summaryRequest, type SummaryInput } from "../functions/mail-read/summary.ts";
import { buildMessage, type EvalFile, type EvalRow, judgeRun, type RunOut, summarizeEval, validateEvalCases } from "./_summary-eval.ts";
import { parseRuns } from "./_intent-eval.ts";

const file = JSON.parse(await Deno.readTextFile(new URL("../eval/mail-summary-cases.json", import.meta.url))) as EvalFile;
const problems = validateEvalCases(file);
if (problems.length) { console.log(JSON.stringify({ error: "cases", problems })); Deno.exit(1); }
const runs = parseRuns(Deno.args);
if (runs === null) { console.log(JSON.stringify({ error: "runs" })); Deno.exit(1); }
const rows: EvalRow[] = [];
const review: Record<string, unknown>[] = [];
for (let run = 1; run <= runs; run++) {
  for (const c of file.cases) {
    const m = buildMessage(c);
    const b = extractBody(m.payload);
    const out: RunOut = { status: "", lines: [], dates: [], amounts: [], todos: [], translation: null, translation_truncated: false, language: "", ask: null,
      attachments: b.attachments, body_truncated: false, model_calls: 0, request_text: "", input_tokens: 0, output_tokens: 0 };
    if (b.text === null) out.status = "no_body";
    else {
      const mm = maskMail(header(m, "Subject") ?? "", b.text);
      if (mm.otp) out.status = "otp";
      else {
        const clipped = clipText(mm.body, SUMMARY_BODY_MAX);
        out.body_truncated = clipped.truncated;
        const input: SummaryInput = { today: file.today, request: c.request, from: c.message.from, date: c.message.date, subject: mm.title, body: clipped.text,
          translateSource: c.translate ? clipText(mm.body, TRANSLATE_SOURCE_MAX).text : null };
        out.request_text = JSON.stringify(summaryRequest(input));
        try {
          out.model_calls = 1;
          const fin = finishSummary(await summarize(input, (u) => { out.input_tokens = u?.input ?? 0; out.output_tokens = u?.output ?? 0; }),
            { translate: c.translate, bodyLen: mm.body.length });
          Object.assign(out, { status: fin.status, translation: fin.translation, translation_truncated: fin.translation_truncated, language: fin.language, ask: fin.ask,
            ...(fin.summary ?? {}) });
        } catch (e) { out.status = e instanceof SummaryFailed ? `failed:${e.why}` : "failed:error"; }
      }
    }
    const r = { ...judgeRun(c, out), run };
    rows.push(r);
    review.push({ id: c.id, run, kind: c.kind, request: c.request, status: out.status, lines: out.lines, dates: out.dates, amounts: out.amounts, todos: out.todos,
      translation: out.translation, translation_truncated: out.translation_truncated, language: out.language, ask: out.ask, body_truncated: out.body_truncated, judge: r });
    console.log(JSON.stringify({ run, id: c.id, ok: r.ok, status: out.status, facts: r.facts_ok, added: r.added.length, in: out.input_tokens, out: out.output_tokens }));
  }
}
await Deno.writeTextFile(new URL("../eval/mail-summary.local.json", import.meta.url), JSON.stringify(review, null, 1));
const s = summarizeEval(file, rows, runs);
console.log(JSON.stringify({ ...s, model: SUMMARY_MODEL, avg_krw: costKrw(SUMMARY_MODEL, { input: s.avg_input_tokens, output: s.avg_output_tokens }) }));
