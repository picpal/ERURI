import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { embed, toPgVector } from "../_shared/embeddings.ts";
import { openai } from "../_shared/openai.ts";
import { ANSWER_SCHEMA, type ChatHit, formatDocuments, type RawAnswer, SYSTEM_PROMPT, type Usage } from "./handler.ts";

export const CHAT_MODEL = "gpt-6-sol";

// 하이브리드 검색 Top-5 → 청크 본문·수신 시각. service role 경로라 user_id를 명시한다(스펙 §12 통제 4)
export function hybridSearch(sb: SupabaseClient, limit = 5) {
  return async (userId: string, q: { question: string; from?: string | null; to?: string | null }): Promise<ChatHit[]> => {
    const [v] = await embed([q.question], "query");
    const { data, error } = await sb.rpc("hybrid_search", { p_user: userId, p_query: q.question, p_embedding: toPgVector(v),
      p_limit: limit, p_from: q.from ?? null, p_to: q.to ?? null });
    if (error) throw new Error("hybrid_search " + error.code);
    const order = (data as { chunk_id: string }[]).map((r) => r.chunk_id);
    if (order.length === 0) return [];
    const { data: rows, error: e2 } = await sb.from("item_chunks").select("id, item_id, text, items(occurred_at)")
      .eq("user_id", userId).in("id", order);
    if (e2) throw new Error("item_chunks " + e2.code);
    const byId = new Map((rows as unknown as { id: string; item_id: string; text: string; items: { occurred_at: string } }[]).map((r) => [r.id, r]));
    return order.map((id) => byId.get(id)).filter((r) => r !== undefined)
      .map((r) => ({ item_id: r!.item_id, text: r!.text, occurred_at: r!.items.occurred_at }));
  };
}

// gpt-6-sol, reasoning low, Structured Outputs strict, store: false(스펙 §9·§12 통제 3)
export async function openaiAnswer(input: { question: string; today: string; documents: ChatHit[] }): Promise<RawAnswer & { usage?: Usage }> {
  const r = await openai.responses.create({
    model: CHAT_MODEL,
    store: false,
    reasoning: { effort: "low" },
    input: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `오늘: ${input.today}\n질문: ${input.question}\n\n${formatDocuments(input.documents)}` },
    ],
    text: { format: { type: "json_schema", name: "chat_answer", schema: ANSWER_SCHEMA, strict: true } },
  });
  const parsed = JSON.parse(r.output_text) as RawAnswer;
  const u = r.usage;
  return { ...parsed, usage: u ? { input_tokens: u.input_tokens, output_tokens: u.output_tokens,
    cached_tokens: u.input_tokens_details?.cached_tokens, reasoning_tokens: u.output_tokens_details?.reasoning_tokens } : undefined };
}
