import { type BudgetDeps, costKrw, guarded, type TokenUsage } from "../_shared/budget.ts";
import { chunkText } from "../_shared/chunk.ts";
import { EMBED_MODEL, toPgVector } from "../_shared/embeddings.ts";
import type { Job } from "../_shared/job.ts";
import { applyRules } from "../_shared/rules.ts";

// embed 잡(스펙 §7 청크 → item_chunks, 체크포인트 embedded). 청크 = 제목 + 본문(지금 규칙으로 다시 마스킹). 로그는 id·개수만
export type EmbedDeps = {
  source(userId: string, itemId: string): Promise<{ contentEnc: string; title: string | null } | null>;
  decrypt(userId: string, enc: string): Promise<string>;
  embed(texts: string[], onUsage?: (u: TokenUsage | null) => void): Promise<{ vectors: number[][]; tokens: number }>;
  save(userId: string, itemId: string, chunks: { i: number; text: string; embedding: string }[]): Promise<void>;
  budget: BudgetDeps;
};

const BATCH = 256;

export async function embedItem(deps: EmbedDeps, job: Job): Promise<string> {
  if (!job.user_id) throw new Error("embed job without user_id");
  const user = job.user_id, itemId = String(job.payload.item_id);
  const src = await deps.source(user, itemId);
  if (!src) return log(job, "skipped", {});                        // 청크 있음·대상 아님(격리·폐기·만료)
  let body: string;
  try {
    body = await deps.decrypt(user, src.contentEnc);
  } catch (e) {
    throw new Error(e instanceof Error && e.message.startsWith("no data key") ? "decrypt no_key" : "decrypt failed");
  }
  // 규칙 재적용(§12 통제 2): ingest 뒤 규칙이 바뀌었을 수 있다. 모델과 평문 청크에는 지금 규칙의 마스킹 결과만, 폐기 판정이면 청크 없음
  const v = applyRules(body, { title: src.title });
  if (v.kind === "discard") return log(job, "skipped", { reason: "rules" });
  const texts = chunkText([v.maskedTitle ?? src.title, v.masked].filter((s) => s && s.trim()).join("\n"));
  if (texts.length === 0) return log(job, "skipped", { reason: "empty" });
  // 비용 예약(§13): 백필 항목(레인은 백필)도 임베딩은 월 예산(Ruling E). 예상 토큰 = 글자 수(정산이 실제 토큰으로 보정)
  const chars = texts.reduce((a, t) => a + t.length, 0);
  const { value } = await guarded(deps.budget, user, "embed", costKrw(EMBED_MODEL, { input: chars, output: 0 }), job.id, async (_lv, bill) => {
    // 요청당 입력 2,048개·30만 토큰 한도 → BATCH 청크씩(512자 × 256 ≈ 15만 토큰 이하). 묶음(API 응답)마다 원소 하나(§13)
    const r = { vectors: [] as number[][], tokens: 0 };
    for (let i = 0; i < texts.length; i += BATCH) {
      const b = await deps.embed(texts.slice(i, i + BATCH), (u) => bill("embed", EMBED_MODEL, u));   // 응답 직후(꺼내기 전) — 어댑터가 부른다
      r.vectors.push(...b.vectors);
      r.tokens += b.tokens;
    }
    return r;
  });
  if (value.vectors.length !== texts.length) throw new Error("embed count_mismatch");
  await deps.save(user, itemId, texts.map((text, i) => ({ i, text, embedding: toPgVector(value.vectors[i]) })));
  return log(job, "embedded", { chunks: texts.length, tokens: value.tokens });
}

function log(job: Job, checkpoint: string, m: Record<string, unknown>): string {
  console.log(JSON.stringify({ job_id: job.id, item_id: job.payload.item_id, checkpoint, ...m }));
  return checkpoint;
}
