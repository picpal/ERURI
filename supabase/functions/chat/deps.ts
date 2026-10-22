import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { responseUsage } from "../_shared/budget.ts";
import { budgetDeps } from "../_shared/budget-deps.ts";
import { decrypt } from "../_shared/crypto.ts";
import { embedWithUsage, toPgVector } from "../_shared/embeddings.ts";
import { openai } from "../_shared/openai.ts";
import type { SaveRule } from "../_shared/save-rules.ts";
import { type AggRpc, ANSWER_SCHEMA, answerUserMessage, type ChatDeps, type Meta, type ProposalCard, type RawAnswer, relevantItems, type ScoredRow,
  type SearchResult, systemPrompt } from "./handler.ts";
import { parseApplyRow, parseTargetRow } from "./edit.ts";
import { extractFilters, type Filters, FILTER_MODEL } from "./filters.ts";
import { queryEmbedder } from "./query-vector.ts";
import type { Candidate } from "./save-rule.ts";

// 모델 문서는 상위 12 청크. "보관함에서 보기" 후보는 같은 한 번의 검색의 융합 목록(의미 40 ∪ 키워드 40) 중 관련도 컷을 통과한 행(스펙 §9)
export const DOC_CHUNKS = 12;
export const CANDIDATE_CHUNKS = 80;
// facts 문서 수(스펙 §9): 기본 받은 시각 역순 5, 일정 기간이 있으면 시작 순 8(모델 문서 상한 12 안 — 가까운 일정이 늦게 받았다고 빠지지 않게, Fable N2)
export const FACTS_LIMIT = 5, FACTS_EVENT_LIMIT = 8;
// aggregate_items 의 5초 statement_timeout(함수 속성)이 실행 중 문장을 끊는지는 미실측(U1) — 사용자 대기는 여기서 묶는다(K5)
export const AGGREGATE_ABORT_MS = 6000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function sha256Hex(s: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))), (b) => b.toString(16).padStart(2, "0")).join("");
}
// facts → 문서 한 줄(종류·제목/가맹점·일시·금액 + 원문 인용). 원문이 만료돼도 evidence 가 출처 역할(§8)
function factText(r: { kind: string; payload: Record<string, unknown>; evidence: string | null }): string {
  const p = r.payload;
  const head = [p.title ?? p.merchant, p.start ?? p.due ?? p.ordered_at, p.amount != null ? `${p.amount}${p.currency ?? ""}` : null].filter(Boolean).join(" · ");
  return `[${r.kind}] ${head}${r.evidence ? ` — ${r.evidence}` : ""}`;
}

export type CandidateRow = { item_id: string; source: string; app_name: string | null; sender: string | null; title: string | null; content_enc: string };
// 폐기분 후보 복호화(Ruling A8-decrypt): 실패한 행은 후보에서 빼고(불일치로 셈) 수만 센다 — 손상 행 하나가 [함께 저장] 전체를 막지 않게.
// 전부 실패면 예외(Ruling A8-all)
export async function decryptCandidates(rows: CandidateRow[], decryptFn: (enc: string) => Promise<string>): Promise<{ cands: Candidate[]; failed: number }> {
  const texts = await Promise.all(rows.map((r) => decryptFn(r.content_enc).catch(() => null)));
  const cands: Candidate[] = [];
  rows.forEach((r, i) => {
    const text = texts[i];
    if (text !== null) cands.push({ item_id: r.item_id, source: r.source, app_name: r.app_name, sender: r.sender, title: r.title, text });
  });
  // 행이 있는데 전부 실패면 체계적 실패(키 로드 등 — Ruling A8-all): matched 0 으로 숨기지 않고 올린다(500)
  if (rows.length > 0 && cands.length === 0) throw new Error("save_rule_candidates decrypt_all_failed");
  return { cands, failed: rows.length - cands.length };
}

// service role. 모든 RPC 에 user_id 명시(스펙 §12 통제 4). 모델: gpt-6-sol effort low, 예산 80% 이상이면 gpt-6-luna(§13)
export function chatDeps(sb: SupabaseClient): ChatDeps {
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await sb.rpc(fn, args);
    if (error) throw new Error(fn + " " + error.code);
    return data;
  };
  // 기간 폴백 재검색이 같은 질문을 두 번 임베딩하지 않게 마지막 질의 벡터만 기억한다 — 임베딩을 실제로 부른 요청만 원소 하나(D13)
  const queryVector = queryEmbedder((texts, onUsage) => embedWithUsage(texts, "query", onUsage));
  return {
    authUser: async (t) => { const { data, error } = await sb.auth.getUser(t); return error ? null : data.user?.id ?? null; },
    filters: (q, today, context, withIntent, bill, edit, agg) =>
      extractFilters(q, today, context, withIntent, (u) => bill?.("chat", FILTER_MODEL, u), edit ?? null, agg ?? null),
    async facts(u, f: Filters) {
      // 받은 기간은 늘 받은 시각, 일정 기간은 event·task 의 start·due 에만(0024, §9)
      const scheduled = f.event_from !== null || f.event_to !== null;
      const rows = (await rpc("search_facts", { p_user: u, p_from: f.date_from, p_to: f.date_to, p_kinds: f.kinds, p_merchant: f.merchant,
        p_limit: scheduled ? FACTS_EVENT_LIMIT : FACTS_LIMIT, p_event_from: f.event_from, p_event_to: f.event_to })) as
        { item_id: string; kind: string; payload: Record<string, unknown>; evidence: string | null; occurred_at: string }[];
      return rows.map((r) => ({ item_id: r.item_id, occurred_at: r.occurred_at, text: factText(r) }));
    },
    async search(u, q, bill): Promise<SearchResult> {
      const v = await queryVector(q.question, bill);
      const rows = (await rpc("hybrid_search", { p_user: u, p_query: q.question, p_embedding: toPgVector(v), p_limit: CANDIDATE_CHUNKS,
        p_from: q.from, p_to: q.to, p_sources: q.sources.length ? q.sources : null })) as (ScoredRow & { chunk_id: string })[];
      const candidates = relevantItems(rows);
      const order = rows.slice(0, DOC_CHUNKS).map((r) => r.chunk_id);    // 융합 순위는 p_limit 와 무관(0017) → 문서는 전과 같은 상위 12
      if (order.length === 0) return { docs: [], candidates };
      const { data, error } = await sb.from("item_chunks").select("id, item_id, text, items(occurred_at)").eq("user_id", u).in("id", order);
      if (error) throw new Error("item_chunks " + error.code);
      const byId = new Map((data as unknown as { id: string; item_id: string; text: string; items: { occurred_at: string } }[]).map((r) => [r.id, r]));
      const docs = order.map((id) => byId.get(id)).filter((r) => r !== undefined)
        .map((r) => ({ item_id: r!.item_id, text: r!.text, occurred_at: r!.items.occurred_at }));
      return { docs, candidates };
    },
    async answer(input, level, bill) {
      const model = level === "degraded" ? "gpt-6-luna" : "gpt-6-sol";
      const r = await openai.responses.create({
        model, store: false, reasoning: { effort: "low" },
        input: [{ role: "system", content: systemPrompt((input.context?.length ?? 0) > 0) },
                { role: "user", content: answerUserMessage(input) }],
        text: { format: { type: "json_schema", name: "chat_answer", schema: ANSWER_SCHEMA, strict: true } },
      });
      bill?.("chat", model, responseUsage(r));                       // 상태 검사·파싱보다 먼저(§13)
      if (r.status === "incomplete") throw new Error("answer incomplete");
      const u = r.usage;
      return { ...(JSON.parse(r.output_text) as RawAnswer), model, usage: u ? { input_tokens: u.input_tokens, output_tokens: u.output_tokens,
        cached_tokens: u.input_tokens_details?.cached_tokens, reasoning_tokens: u.output_tokens_details?.reasoning_tokens } : undefined };
    },
    meta: async (u, ids) => ((await rpc("chat_item_meta", { p_user: u, p_ids: ids })) as Meta[]),
    proposals: async (u, ids) => ((await rpc("chat_proposals", { p_user: u, p_items: ids })) as ProposalCard[]),
    audit: async (u, ids) => { await rpc("audit_read", { p_user: u, p_actor: "chat", p_target: await sha256Hex([...ids].sort().join(",")) }); },
    async itemDetail(u, id) {
      if (!UUID.test(id)) return null;                                     // 형식이 틀린 id 는 RPC 오류(500) 대신 404
      const rows = (await rpc("chat_get_item", { p_user: u, p_item: id })) as { content_enc: string | null; source: string; app_name: string | null;
        title: string | null; sender: string | null; occurred_at: string }[];
      const r = rows[0];
      if (!r) return null;
      const text = r.content_enc ? await decrypt(u, r.content_enc) : null;
      return { item_id: id, source: r.source, app_name: r.app_name, title: r.title, sender: r.sender, occurred_at: r.occurred_at, expired: !r.content_enc, text };
    },
    budget: budgetDeps(sb),
    today: () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10),
    mailActions: () => Deno.env.get("MAIL_ACTIONS") === "on",        // 스펙 §7 "켜기" — 0.14.0 전에는 설정하지 않는다
    mailRead: () => Deno.env.get("MAIL_READ") === "on",              // 스펙 §7 "메일 요약" 켜기 — 0.15.0 배포 뒤 SUMMARY-deploy 에서 켠다
    // 0.16.0 고치기(스펙 §9 B 서버 1·5, 0033 — 0033 적용 전에는 edit_target 을 보내는 0.16.0 앱만 이 경로에 온다)
    editTarget: async (u, pid) => parseTargetRow(await rpc("chat_edit_target", { p_user: u, p_proposal: pid })),
    editApply: async (u, pid, patch, clear) => parseApplyRow(await rpc("chat_edit_proposal", { p_user: u, p_proposal: pid, p_patch: patch, p_clear: clear })),
    // 0.17.0 저장 규칙·집계(0035 — 스펙 §9 "채팅 저장 규칙·집계 질문"). 규칙 값은 비교용 평문(§12 통제 1)
    saveRules: async (u) => ((await rpc("save_rules_of", { p_user: u })) as SaveRule[]),
    ruleAdd: async (u, kind, value) => ((await rpc("save_rule_add", { p_user: u, p_kind: kind, p_value: value })) as
      { status: "added" | "duplicate" | "limit" | "bad_value"; rule_id: string | null }),
    // 형식이 틀린 id 는 uuid 변환 오류(500) 대신 없는 규칙
    ruleRemove: async (u, id) => (UUID.test(id) ? ((await rpc("save_rule_remove", { p_user: u, p_rule: id })) as "removed" | "not_found") : "not_found"),
    async ruleCandidates(u): Promise<Candidate[]> {
      const rows = (await rpc("save_rule_candidates", { p_user: u, p_limit: 500 })) as CandidateRow[];
      const { cands: out, failed } = await decryptCandidates(rows, (enc) => decrypt(u, enc));
      if (failed) console.log(JSON.stringify({ save_rule_candidates: "decrypt_failed", n: failed }));     // 실패 수만 — id·값 없음
      // 복호화한 항목 id 목록 감사(§7 "폐기분 함께 저장" — 건수만 앱으로, 본문은 서버 안에서만 비교)
      if (out.length) await rpc("audit_read", { p_user: u, p_actor: "chat", p_target: await sha256Hex(out.map((c) => c.item_id).sort().join(",")) });
      return out;
    },
    ruleRestore: async (u, ids) => ((await rpc("save_rule_restore", { p_user: u, p_items: ids })) as number),
    async aggregate(u, c, bucketKey) {
      // AbortSignal.timeout 대신 직접 타이머 — 끝나면 지운다(safe-post 와 같은 이유)
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), AGGREGATE_ABORT_MS);
      try {
        const { data, error } = await sb.rpc("aggregate_items", { p_user: u, p_keywords: c.keywords, p_sender: c.sender, p_sources: c.sources,
          p_from: c.from, p_to: c.to, p_bucket: c.bucket, p_bucket_key: bucketKey }).abortSignal(ac.signal);
        if (error) throw new Error("aggregate_items " + (ac.signal.aborted ? "timeout" : error.code));
        return data as AggRpc;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
