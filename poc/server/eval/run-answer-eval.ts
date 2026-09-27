// PoC-7 답변 단계 평가: 무근거 거절률·인용 정확도(합성 코퍼스만, 전용 테스트 사용자).
// 먼저 run-search-eval.ts로 코퍼스를 적재해 둔다(끝나면 --cleanup). 워커 cron 정지 상태에서 실행.
// deno run --allow-net --allow-env --allow-read --allow-write --env-file=.env eval/run-answer-eval.ts [--label large-sol]
import { createClient } from "npm:@supabase/supabase-js@2";
import { SERVER_AUTH } from "../supabase/functions/_shared/crypto.ts";
import { EMBED_MODEL, embedStats } from "../supabase/functions/_shared/embeddings.ts";
import { answerQuestion, type ChatDeps } from "../supabase/functions/chat/handler.ts";
import { CHAT_MODEL, hybridSearch, openaiAnswer } from "../supabase/functions/chat/deps.ts";
import { testUser } from "../supabase/tests/_testenv.ts";

type Question = { q: string; expect_ids: string[]; from: string | null; to: string | null };
const arg = (name: string, dflt: string) => { const i = Deno.args.indexOf(name); return i >= 0 ? Deno.args[i + 1] : dflt; };
const LABEL = arg("--label", `answer-${EMBED_MODEL.replace("text-embedding-3-", "")}-${CHAT_MODEL}`);

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, SERVER_AUTH);
const USER = (await testUser(1)).id;
const questions = (await Deno.readTextFile(new URL("./questions.jsonl", import.meta.url))).trim().split("\n").map((l) => JSON.parse(l) as Question);

// item_id → 코퍼스 id (idempotency_key 'eval:<id>')
const { data: items, error } = await sb.from("items").select("id, idempotency_key").eq("user_id", USER).like("idempotency_key", "eval:%");
if (error) throw new Error("items " + error.code);
if (!items || items.length !== 500) throw new Error(`corpus not loaded (${items?.length ?? 0} eval items) — run run-search-eval.ts first`);
const corpusId = new Map(items.map((i) => [i.id as string, (i.idempotency_key as string).slice(5)]));

const deps: ChatDeps = { authUser: async () => USER, search: hybridSearch(sb), answer: openaiAnswer, today: () => "2026-09-27" };
const usage = { input: 0, cached: 0, output: 0, reasoning: 0 };
const rows = [];
for (const q of questions) {
  const t = performance.now();
  const r = await answerQuestion(USER, { question: q.q, from: q.from, to: q.to }, deps);
  const ms = performance.now() - t;
  usage.input += r.usage?.input_tokens ?? 0; usage.cached += r.usage?.cached_tokens ?? 0;
  usage.output += r.usage?.output_tokens ?? 0; usage.reasoning += r.usage?.reasoning_tokens ?? 0;
  const cited = r.source_item_ids.map((id) => corpusId.get(id) ?? "?");
  const hits = r.hits.map((id) => corpusId.get(id) ?? "?");
  rows.push({ q: q.q, expect: q.expect_ids, refused: r.refused, forced: r.forced_refusal, dropped: r.dropped_ids, cited, hits,
    retrieved: q.expect_ids.some((e) => hits.includes(e)), answer: r.answer, ms: Math.round(ms) });
}

const none = rows.filter((r) => r.expect.length === 0), ev = rows.filter((r) => r.expect.length > 0);
const answered = ev.filter((r) => !r.refused);
const citeHit = answered.filter((r) => r.cited.some((c) => r.expect.includes(c)));
const citeExact = answered.filter((r) => r.cited.length > 0 && r.cited.every((c) => r.expect.includes(c)));
const citedTotal = answered.reduce((a, r) => a + r.cited.length, 0);
const citedCorrect = answered.reduce((a, r) => a + r.cited.filter((c) => r.expect.includes(c)).length, 0);
const retrievedEv = ev.filter((r) => r.retrieved);
const pct = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)]; };
// 단가(스펙 §13, 1M 토큰당): gpt-6-sol 입력 $2.00·캐시 $0.20·출력 $10.00, large 임베딩 $0.13
const cost = ((usage.input - usage.cached) * 2 + usage.cached * 0.2 + usage.output * 10) / 1e6 + embedStats.tokens * 0.13 / 1e6;
const summary = {
  label: LABEL, embed_model: EMBED_MODEL, chat_model: CHAT_MODEL, questions: rows.length,
  no_evidence_refused: `${none.filter((r) => r.refused).length}/${none.length}`,
  no_evidence_forced: none.filter((r) => r.forced).length,
  evidence_answered: `${answered.length}/${ev.length}`,
  evidence_refused_when_retrieved: `${retrievedEv.filter((r) => r.refused).length}/${retrievedEv.length}`,
  evidence_not_retrieved: ev.length - retrievedEv.length,
  citation_hit: `${citeHit.length}/${answered.length}`,            // 답한 질문 중 정답 문서를 하나 이상 인용
  citation_exact: `${citeExact.length}/${answered.length}`,        // 인용이 전부 정답 문서
  citation_precision: `${citedCorrect}/${citedTotal}`,
  dropped_ids_total: rows.reduce((a, r) => a + r.dropped, 0),      // 검색 결과에 없는 id(환각 인용)로 서버가 제거한 수
  latency_ms: { p50: pct(rows.map((r) => r.ms), 0.5), p95: pct(rows.map((r) => r.ms), 0.95) },
  tokens: { ...usage, embedding: embedStats.tokens }, cost_usd: Math.round(cost * 10000) / 10000,
};
await Deno.mkdir(new URL("./out/", import.meta.url), { recursive: true });
await Deno.writeTextFile(new URL(`./out/${LABEL}.json`, import.meta.url), JSON.stringify({ summary, perQuestion: rows }, null, 1));
console.log(JSON.stringify(summary, null, 1));
for (const r of rows) {
  const flag = r.expect.length === 0 ? (r.refused ? "ok-refuse" : "FALSE-ANSWER") : r.refused ? (r.retrieved ? "FALSE-REFUSE" : "refuse(no-hit)") : r.cited.some((c) => r.expect.includes(c)) ? (r.cited.every((c) => r.expect.includes(c)) ? "ok" : "ok+extra") : "WRONG-CITE";
  if (flag !== "ok" && flag !== "ok-refuse") console.log(flag, "|", r.q, "| expect", r.expect.join(","), "| cited", r.cited.join(","), "| hits", r.hits.join(","));
}
