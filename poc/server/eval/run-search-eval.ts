// PoC-7 한국어 하이브리드 검색 평가(합성 코퍼스만, 스펙 §16). 워커 cron을 멈춘 상태에서 실행한다.
// deno run --allow-net --allow-env --allow-read --allow-write --env-file=.env eval/run-search-eval.ts [--chunk 512] [--label base] [--cleanup]
//   기본 모델 text-embedding-3-large(2026-09-27 결정). EMBED_MODEL=text-embedding-3-small 로 비교 가능(dimensions 512 유지)
// 코퍼스 적재: encrypt → insert_item(p_enqueue false, 'eval:<id>') → item_chunks(청크 N자) + embedding(배치 64).
// 질문: (a) 키워드 전용 hybrid_search(p_embedding null), (b) 하이브리드 embed(q) → hybrid_search. Top-5.
import { createClient } from "npm:@supabase/supabase-js@2";
import { encrypt, SERVER_AUTH, toBytea } from "../supabase/functions/_shared/crypto.ts";
import { EMBED_MODEL, embed, embedStats, toPgVector } from "../supabase/functions/_shared/embeddings.ts";
import { testUser } from "../supabase/tests/_testenv.ts";

type Doc = { id: string; source: string; occurred_at: string; text: string };
type Question = { q: string; expect_ids: string[]; from: string | null; to: string | null };
type Hit = { item_id: string; chunk_id: string; score: number; sem_sim: number | null; kw_score: number | null };

const arg = (name: string, dflt: string) => { const i = Deno.args.indexOf(name); return i >= 0 ? Deno.args[i + 1] : dflt; };
const CHUNK = Number(arg("--chunk", "512"));
const KW_WEIGHT = Number(arg("--kw-weight", "1"));
const LABEL = arg("--label", `${EMBED_MODEL}-chunk${CHUNK}-kw${KW_WEIGHT}`);
const CLEANUP_ONLY = Deno.args.includes("--cleanup");
const TOP = 5;

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, SERVER_AUTH);
// 평가 데이터는 전용 테스트 사용자(poc-test-1)에 둔다. 실측 사용자(POC_USER_ID)의 데이터는 건드리지 않는다(AGENTS.md §7)
const USER = (await testUser(1)).id;
const readJsonl = async <T>(f: string) => (await Deno.readTextFile(new URL(f, import.meta.url))).trim().split("\n").map((l) => JSON.parse(l) as T);

async function cleanup() {
  const { error, count } = await sb.from("items").delete({ count: "exact" }).eq("user_id", USER).like("idempotency_key", "eval:%");
  if (error) throw new Error("cleanup " + error.code);
  return count ?? 0;                                                     // item_chunks는 cascade
}

if (CLEANUP_ONLY) { console.log(`cleanup: ${await cleanup()} eval items removed`); Deno.exit(0); }

const corpus = await readJsonl<Doc>("./corpus.jsonl");
const questions = await readJsonl<Question>("./questions.jsonl");

// ── 적재 ──
await cleanup();
const t0 = performance.now();
const itemOf = new Map<string, string>(), docOf = new Map<string, Doc>();
const chunks: { item_id: string; chunk_index: number; text: string }[] = [];
for (const d of corpus) {
  const { data, error } = await sb.rpc("insert_item", { p_user: USER, p_source: d.source, p_idempotency_key: "eval:" + d.id,
    p_sender: null, p_title: null, p_content_enc: toBytea(await encrypt(USER, d.text)), p_occurred_at: d.occurred_at, p_enqueue: false });
  if (error || !data) throw new Error("insert_item " + (error?.code ?? "duplicate"));
  itemOf.set(d.id, data as string);
  docOf.set(data as string, d);
  for (let i = 0, k = 0; i < d.text.length; i += CHUNK, k++) chunks.push({ item_id: data as string, chunk_index: k, text: d.text.slice(i, i + CHUNK) });
}
const docTokens0 = embedStats.tokens;
for (let i = 0; i < chunks.length; i += 64) {
  const batch = chunks.slice(i, i + 64);
  const vecs = await embed(batch.map((c) => c.text), "document");
  const { error } = await sb.from("item_chunks").insert(batch.map((c, j) => ({ ...c, user_id: USER, embedding: toPgVector(vecs[j]) })));
  if (error) throw new Error("item_chunks " + error.code);
}
const docTokens = embedStats.tokens - docTokens0;
const loadMs = performance.now() - t0;
console.log(`loaded ${corpus.length} docs, ${chunks.length} chunks, ${docTokens} embedding tokens, ${Math.round(loadMs / 1000)}s`);

// ── 질문 ──
async function search(q: Question, embedding: number[] | null) {
  const t = performance.now();
  const { data, error } = await sb.rpc("hybrid_search", { p_user: USER, p_query: q.q, p_embedding: embedding ? toPgVector(embedding) : null,
    p_limit: TOP, p_from: q.from, p_to: q.to, p_kw_weight: KW_WEIGHT });
  if (error) throw new Error("hybrid_search " + error.code);
  return { hits: data as Hit[], ms: performance.now() - t };
}
type Row = { q: Question; kw: { hits: Hit[]; ms: number }; hy: { hits: Hit[]; ms: number; embedMs: number } };
const rows: Row[] = [];
const qTokens0 = embedStats.tokens;
for (const q of questions) {
  const kw = await search(q, null);
  const te = performance.now();
  const [v] = await embed([q.q], "query");
  const embedMs = performance.now() - te;
  const hy = await search(q, v);
  rows.push({ q, kw, hy: { ...hy, embedMs } });
}
const qTokens = embedStats.tokens - qTokens0;

// ── 지표 ──
const idsOf = (hits: Hit[]) => hits.map((h) => docOf.get(h.item_id)?.id ?? "?");
const pct = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)] : NaN; };
const r1 = (x: number) => Math.round(x * 10) / 10;
function metrics(pickHits: (r: Row) => Hit[], reject: (hits: Hit[]) => boolean) {
  const ev = rows.filter((r) => r.q.expect_ids.length), none = rows.filter((r) => !r.q.expect_ids.length);
  const hitOk = ev.filter((r) => idsOf(pickHits(r)).some((id) => r.q.expect_ids.includes(id)));
  const rejected = none.filter((r) => reject(pickHits(r)));
  const falseReject = ev.filter((r) => reject(pickHits(r)));
  let dateViolations = 0;
  for (const r of rows.filter((r) => r.q.from || r.q.to)) {
    for (const h of pickHits(r)) {
      const at = Date.parse(docOf.get(h.item_id)!.occurred_at);
      if ((r.q.from && at < Date.parse(r.q.from)) || (r.q.to && at > Date.parse(r.q.to))) dateViolations++;
    }
  }
  return { top5: hitOk.length / ev.length, top5n: `${hitOk.length}/${ev.length}`, reject: rejected.length / none.length,
    rejectn: `${rejected.length}/${none.length}`, falseReject: `${falseReject.length}/${ev.length}`, dateViolations,
    misses: ev.filter((r) => !hitOk.includes(r)).map((r) => r.q.q) };
}
// 거절 규칙(무근거 질문). RRF 점수는 순위 기반이라 절대 신뢰도가 아니다(0008 기준선에서 확인) → 키워드 IDF 합(kw_score)과 코사인 유사도(sem_sim)를 쓴다.
// θ(키워드)·τ(의미)는 이 50문항으로 고른 값이라 과적합 가능성이 있다. 스윕 전체를 함께 기록한다
const kwTop = (hits: Hit[]) => Math.max(0, ...hits.map((h) => h.kw_score ?? 0));
const semTop = (hits: Hit[]) => Math.max(0, ...hits.map((h) => h.sem_sim ?? 0));
const kwRejectAt = (theta: number) => (hits: Hit[]) => hits.length === 0 || kwTop(hits) < theta;
const hyRejectAt = (theta: number, tau: number) => (hits: Hit[]) => hits.length === 0 || (kwTop(hits) < theta && semTop(hits) < tau);
const falseN = (m: { falseReject: string }) => Number(m.falseReject.split("/")[0]);
const choose = <T extends { reject: number; falseReject: string }>(cands: T[]) =>
  // 정답 질문을 잘못 거절하지 않는 것 중 무근거 거절률 최대, 없으면 (거절률 - 오거절률) 최대
  cands.filter((c) => falseN(c) === 0).sort((a, b) => b.reject - a.reject)[0] ??
  [...cands].sort((a, b) => (b.reject - falseN(b) / 40) - (a.reject - falseN(a) / 40))[0];
const THETAS = [0, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const TAUS = [0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 1.01];
const kwSweep = THETAS.map((theta) => ({ theta, ...metrics((r) => r.kw.hits, kwRejectAt(theta)) }));
const hySweep = THETAS.flatMap((theta) => TAUS.map((tau) => ({ theta, tau, ...metrics((r) => r.hy.hits, hyRejectAt(theta, tau)) })));
const kwM = choose(kwSweep), hyM = choose(hySweep);
const semEv = rows.filter((r) => r.q.expect_ids.length).map((r) => semTop(r.hy.hits));
const kwEv = rows.filter((r) => r.q.expect_ids.length).map((r) => kwTop(r.hy.hits));
const kwNone = rows.filter((r) => !r.q.expect_ids.length).map((r) => kwTop(r.hy.hits));
const semNone = rows.filter((r) => !r.q.expect_ids.length).map((r) => semTop(r.hy.hits));
const lat = {
  kw_p50: r1(pct(rows.map((r) => r.kw.ms), 0.5)), kw_p95: r1(pct(rows.map((r) => r.kw.ms), 0.95)),
  hy_search_p50: r1(pct(rows.map((r) => r.hy.ms), 0.5)), hy_search_p95: r1(pct(rows.map((r) => r.hy.ms), 0.95)),
  hy_total_p50: r1(pct(rows.map((r) => r.hy.ms + r.hy.embedMs), 0.5)), hy_total_p95: r1(pct(rows.map((r) => r.hy.ms + r.hy.embedMs), 0.95)),
  embed_p50: r1(pct(rows.map((r) => r.hy.embedMs), 0.5)), embed_p95: r1(pct(rows.map((r) => r.hy.embedMs), 0.95)),
};
const summary = {
  label: LABEL, model: EMBED_MODEL, chunk: CHUNK, corpus: corpus.length, chunks: chunks.length, questions: rows.length,
  tokens: { documents: docTokens, queries: qTokens, total: docTokens + qTokens },
  kw_weight: KW_WEIGHT,
  keyword: kwM, hybrid: hyM,
  sem_top_evidence: { min: r1(Math.min(...semEv) * 1000) / 1000, p10: r1(pct(semEv, 0.1) * 1000) / 1000, p50: r1(pct(semEv, 0.5) * 1000) / 1000 },
  sem_top_no_evidence: { p50: r1(pct(semNone, 0.5) * 1000) / 1000, max: r1(Math.max(...semNone) * 1000) / 1000 },
  kw_top_evidence: { p10: r1(pct(kwEv, 0.1)), p50: r1(pct(kwEv, 0.5)) },
  kw_top_no_evidence: { values: kwNone.map(r1).sort((x, y) => x - y) },
  latency_ms: lat,
  kw_sweep: kwSweep.map((s) => ({ theta: s.theta, reject: s.rejectn, falseReject: s.falseReject })),
};
await Deno.mkdir(new URL("./out/", import.meta.url), { recursive: true });
await Deno.writeTextFile(new URL(`./out/${LABEL}.json`, import.meta.url), JSON.stringify({ summary,
  perQuestion: rows.map((r) => ({ q: r.q.q, expect: r.q.expect_ids, kw: idsOf(r.kw.hits), hy: idsOf(r.hy.hits),
    hySemTop: r1(semTop(r.hy.hits) * 1000) / 1000, hyKwTop: r1(kwTop(r.hy.hits)) })), hySweep: hySweep.map((s) => ({ theta: s.theta, tau: s.tau,
    top5: s.top5n, reject: s.rejectn, falseReject: s.falseReject })) }, null, 1));
console.log(JSON.stringify(summary, null, 1));
