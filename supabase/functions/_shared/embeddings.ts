// 스펙 §12 통제 3·§16: 실제 사용자 데이터 임베딩은 PoC-7 통과 후. 그 전에는 합성 코퍼스(eval)에만 호출한다
import { openai } from "./openai.ts";

export const EMBED_MODEL = Deno.env.get("EMBED_MODEL") ?? "text-embedding-3-large";   // PoC-7 결정(2026-09-27): large 38/40 vs small 31~33/40
export const EMBED_DIMENSIONS = 512;                                                     // item_chunks.embedding vector(512)
export const embedStats = { calls: 0, tokens: 0 };                                       // 비용 기록용

// OpenAI 임베딩은 문서/질의 구분이 없다. inputType은 호출부 시그니처 유지용이다
export async function embed(texts: string[], _inputType: "document" | "query"): Promise<number[][]> {
  const r = await openai.embeddings.create({ model: EMBED_MODEL, input: texts, dimensions: EMBED_DIMENSIONS, encoding_format: "float" });
  embedStats.calls++;
  embedStats.tokens += r.usage?.total_tokens ?? 0;
  return [...r.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

// PostgREST에는 pgvector 텍스트 표기로 넘긴다
export function toPgVector(v: number[]): string {
  return "[" + v.join(",") + "]";
}
