// 스펙 §7·§12 통제 3·§16: PoC-7 통과(2026-09-27) 후 실제 데이터 임베딩은 worker embed 잡(M2-⑧a)이 부른다
import { openai } from "./openai.ts";

export const EMBED_MODEL = Deno.env.get("EMBED_MODEL") ?? "text-embedding-3-large";   // PoC-7 결정(2026-09-27): large 38/40 vs small 31~33/40
export const EMBED_DIMENSIONS = 512;                                                     // item_chunks.embedding vector(512)
export const embedStats = { calls: 0, tokens: 0 };                                       // 비용 기록용

// OpenAI 임베딩은 문서/질의 구분이 없다. inputType은 호출부 시그니처 유지용이다
export async function embed(texts: string[], inputType: "document" | "query"): Promise<number[][]> {
  return (await embedWithUsage(texts, inputType)).vectors;
}

// 호출 1건의 토큰(비용 정산용). 전역 embedStats 차이로 재면 같은 isolate 에서 겹친 호출의 토큰이 섞인다
export async function embedWithUsage(texts: string[], _inputType: "document" | "query"): Promise<{ vectors: number[][]; tokens: number }> {
  const r = await openai.embeddings.create({ model: EMBED_MODEL, input: texts, dimensions: EMBED_DIMENSIONS, encoding_format: "float" });
  const tokens = r.usage?.total_tokens ?? 0;
  embedStats.calls++;
  embedStats.tokens += tokens;
  return { vectors: [...r.data].sort((a, b) => a.index - b.index).map((d) => d.embedding), tokens };
}

// PostgREST에는 pgvector 텍스트 표기로 넘긴다
export function toPgVector(v: number[]): string {
  return "[" + v.join(",") + "]";
}
