import type { Bill, TokenUsage } from "../_shared/budget.ts";
import { EMBED_MODEL } from "../_shared/embeddings.ts";

// 채팅 질의 임베딩(스펙 §9·§13 "채팅 검색 질의 임베딩"): isolate 안에서 마지막 질의 벡터만 기억한다 — 기간 폴백 재검색이 같은 문장을 두 번 임베딩하지 않게
// (같은 문장이면 사용자와 무관하게 같은 벡터). 임베딩 API 응답을 실제로 받은 요청만 bill(예약 chat·집계 chat) — 재사용한 요청은 비용이 없다(D13)
// bill 은 어댑터가 응답을 받은 직후 onUsage 로 부른다 — 벡터 꺼내기가 실패해도 원소가 남는다(§13)
export function queryEmbedder(embed: (texts: string[], onUsage?: (u: TokenUsage | null) => void) => Promise<{ vectors: number[][]; tokens: number }>) {
  let last: { text: string; v: Promise<number[]> } | null = null;
  return (text: string, bill?: Bill): Promise<number[]> => {
    if (last?.text !== text) {
      const v = embed([text], (u) => bill?.("chat", EMBED_MODEL, u)).then((r) => r.vectors[0]);
      v.catch(() => { if (last?.v === v) last = null; });
      last = { text, v };
    }
    return last.v;
  };
}
