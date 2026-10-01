// 검색 후보·순위 재현(스펙 §9, §16 2026-10-01 검색·캘린더 결정). 합성 질문 6개를 사용자 코퍼스에 던져 개수·점수만 낸다.
// 출력에 본문·제목·item id 없음(AGENTS.md §7): hybrid_search 는 id·점수만 돌려주고 여기서도 id 는 세기만 한다. 질의 임베딩 6건(1원 미만)
// cand_old = R-A1 규칙(융합 80 의 항목 전부, ≤ 100), cand_cut = S1 상대 컷(인용·facts 를 더하기 전, ≤ 20), kw_pass·sem_pass = 경로별 컷 통과 항목 수(포화 원인 구분)
// 사용: deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/search-probe.ts [--user <uuid>] [--label <이름>]
import { createClient } from "npm:@supabase/supabase-js@2";
import { SERVER_AUTH } from "../functions/_shared/crypto.ts";
import { embed, toPgVector } from "../functions/_shared/embeddings.ts";
import { CANDIDATE_CHUNKS, DOC_CHUNKS } from "../functions/chat/deps.ts";
import { CANDIDATE_MAX, KW_CUT, relevantItems, type ScoredRow, SEM_CUT } from "../functions/chat/handler.ts";

const PROBE_QUESTIONS = ["내일 치과 예약 몇 시야", "10월 3일 일정 있어?", "이번 주 토요일 약속 뭐 있지", "다음 주 회의 언제야",
  "화성 탐사선 발사 일정", "쿠팡에서 산 거 얼마였지"];

const arg = (k: string) => { const i = Deno.args.indexOf(k); return i >= 0 ? Deno.args[i + 1] : undefined; };
const user = arg("--user") ?? Deno.env.get("ERURI_USER_ID");
if (!user) { console.error("ERURI_USER_ID 없음"); Deno.exit(2); }
const label = arg("--label") ?? "run";
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, SERVER_AUTH);
const vectors = await embed(PROBE_QUESTIONS, "query");
const r3 = (x: number | undefined) => (x === undefined ? null : Math.round(x * 1000) / 1000);

for (const [i, question] of PROBE_QUESTIONS.entries()) {
  const { data, error } = await sb.rpc("hybrid_search", { p_user: user, p_query: question, p_embedding: toPgVector(vectors[i]),
    p_limit: CANDIDATE_CHUNKS, p_from: null, p_to: null, p_sources: null });
  if (error) throw new Error("hybrid_search " + error.code);
  const rows = data as ScoredRow[];
  const sims = rows.flatMap((r) => (r.sem_sim === null ? [] : [r.sem_sim])).sort((a, b) => b - a);
  const top = rows.slice(0, DOC_CHUNKS);
  const items = new Set(rows.map((r) => r.item_id)).size;
  const top1 = (k: "sem_sim" | "kw_score") => Math.max(0, ...rows.map((r) => r[k] ?? 0));
  const passed = (k: "sem_sim" | "kw_score", cut: number) =>
    new Set(rows.filter((r) => top1(k) > 0 && (r[k] ?? 0) >= cut * top1(k)).map((r) => r.item_id)).size;
  console.log(JSON.stringify({ label, q: i + 1, question, items, kw_chunks: rows.filter((r) => r.kw_score !== null).length,
    sem_at_1_5_12: [r3(sims[0]), r3(sims[4]), r3(sims[11])],
    top12: { both: top.filter((r) => r.sem_sim !== null && r.kw_score !== null).length,
      sem_only: top.filter((r) => r.kw_score === null).length, kw_only: top.filter((r) => r.sem_sim === null).length },
    cand_old: Math.min(items, 100), cand_cut: Math.min(relevantItems(rows).length, CANDIDATE_MAX),
    kw_pass: passed("kw_score", KW_CUT), sem_pass: passed("sem_sim", SEM_CUT) }));
}
