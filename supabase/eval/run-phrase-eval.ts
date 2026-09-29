// d01~d10 서버 최종 상태 평가: 실제 gpt-6-luna 추출 + 분류기(--provider, 기본 CLASSIFY_PROVIDER). DB 없음, 문구는 합성.
// 사용: deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/eval/run-phrase-eval.ts [--provider none|jev] [--runs 3]
// 통과: 폐기 기대 문구는 어떤 discarded:* 든 폐기, 추출 기대 문구는 extracted + 허용 kind. 출력은 id·기대·결과·kind·토큰만
import { classifierFromEnv } from "../functions/_shared/classifier-env.ts";
import { classifyThreshold } from "../functions/_shared/classify.ts";
import { extractTextDetailed } from "../functions/_shared/extract-text.ts";
import { seoulToday } from "../functions/_shared/time.ts";
import { runPhrase } from "./phrase-harness.ts";
import { DEVICE10, expectedStatus } from "./phrases.ts";

const arg = (k: string) => { const i = Deno.args.indexOf(k); return i >= 0 ? Deno.args[i + 1] : undefined; };
const provider = arg("--provider");
const env = (k: string) => (k === "CLASSIFY_PROVIDER" && provider ? provider : Deno.env.get(k));
const classifier = classifierFromEnv(env);
const threshold = classifyThreshold(env);
const runs = Math.max(1, Number(arg("--runs") ?? 1));
const today = seoulToday();
let miss = 0, chatMiss = 0;
for (let r = 1; r <= runs; r++) {
  for (const p of DEVICE10) {
    const want = expectedStatus(p, classifier.provider);
    const got = await runPhrase(p, { classifier, threshold, today, extract: (t, m, d) => extractTextDetailed(t, m, d) });
    const ok = want.startsWith("discarded") ? got.status.startsWith("discarded") : got.status === "extracted" && p.kinds.includes(got.kind as never);
    if (!ok) { miss++; if (p.label === "personal") chatMiss++; }
    console.log([r, p.id, p.topic, want, got.status, got.kind ?? "-", got.tokens, ok ? "OK" : "MISS"].join("\t"));
  }
}
console.log(`provider=${classifier.provider} runs=${runs} miss=${miss}/${runs * DEVICE10.length} chat_miss=${chatMiss}`);
Deno.exit(miss === 0 ? 0 : 1);
