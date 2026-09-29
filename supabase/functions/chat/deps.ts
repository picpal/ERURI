import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { budgetDeps } from "../_shared/budget-deps.ts";
import { decrypt } from "../_shared/crypto.ts";
import { embed, toPgVector } from "../_shared/embeddings.ts";
import { openai } from "../_shared/openai.ts";
import { ANSWER_SCHEMA, type ChatDeps, type ChatHit, formatDocuments, type Meta, type ProposalCard, type RawAnswer, SYSTEM_PROMPT } from "./handler.ts";
import { extractFilters, type Filters } from "./filters.ts";

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

// service role. 모든 RPC 에 user_id 명시(스펙 §12 통제 4). 모델: gpt-6-sol effort low, 예산 80% 이상이면 gpt-6-luna(§13)
export function chatDeps(sb: SupabaseClient): ChatDeps {
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await sb.rpc(fn, args);
    if (error) throw new Error(fn + " " + error.code);
    return data;
  };
  return {
    authUser: async (t) => { const { data, error } = await sb.auth.getUser(t); return error ? null : data.user?.id ?? null; },
    filters: (q, today) => extractFilters(q, today),
    async facts(u, f: Filters) {
      const rows = (await rpc("search_facts", { p_user: u, p_from: f.date_from, p_to: f.date_to, p_kinds: f.kinds, p_merchant: f.merchant })) as
        { item_id: string; kind: string; payload: Record<string, unknown>; evidence: string | null; occurred_at: string }[];
      return rows.map((r) => ({ item_id: r.item_id, occurred_at: r.occurred_at, text: factText(r) }));
    },
    async search(u, q): Promise<ChatHit[]> {
      const [v] = await embed([q.question], "query");
      const hits = (await rpc("hybrid_search", { p_user: u, p_query: q.question, p_embedding: toPgVector(v), p_limit: 12,
        p_from: q.from, p_to: q.to, p_sources: q.sources.length ? q.sources : null })) as { chunk_id: string }[];
      const order = hits.map((r) => r.chunk_id);
      if (order.length === 0) return [];
      const { data: rows, error } = await sb.from("item_chunks").select("id, item_id, text, items(occurred_at)").eq("user_id", u).in("id", order);
      if (error) throw new Error("item_chunks " + error.code);
      const byId = new Map((rows as unknown as { id: string; item_id: string; text: string; items: { occurred_at: string } }[]).map((r) => [r.id, r]));
      return order.map((id) => byId.get(id)).filter((r) => r !== undefined).map((r) => ({ item_id: r!.item_id, text: r!.text, occurred_at: r!.items.occurred_at }));
    },
    async answer(input, level) {
      const model = level === "degraded" ? "gpt-6-luna" : "gpt-6-sol";
      const r = await openai.responses.create({
        model, store: false, reasoning: { effort: "low" },
        input: [{ role: "system", content: SYSTEM_PROMPT },
                { role: "user", content: `오늘: ${input.today}\n질문: ${input.question}\n\n${formatDocuments(input.documents)}` }],
        text: { format: { type: "json_schema", name: "chat_answer", schema: ANSWER_SCHEMA, strict: true } },
      });
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
  };
}
