import { type BudgetDeps, costKrw, guarded } from "../_shared/budget.ts";
import { chunkText } from "../_shared/chunk.ts";
import { EMBED_MODEL, toPgVector } from "../_shared/embeddings.ts";
import type { Job } from "../_shared/job.ts";

// embed 잡(스펙 §7 청크 → item_chunks, 체크포인트 embedded). 청크 = 제목 + 본문(마스킹된 원문). 로그는 id·개수만
export type EmbedDeps = {
  source(userId: string, itemId: string): Promise<{ contentEnc: string; title: string | null; backfill: boolean } | null>;
  decrypt(userId: string, enc: string): Promise<string>;
  embed(texts: string[]): Promise<{ vectors: number[][]; tokens: number }>;
  save(userId: string, itemId: string, chunks: { i: number; text: string; embedding: string }[]): Promise<void>;
  budget: BudgetDeps;
};

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
  const texts = chunkText([src.title, body].filter((s) => s && s.trim()).join("\n"));
  if (texts.length === 0) return log(job, "skipped", { reason: "empty" });
  // 비용 예약(§13): 백필 항목은 백필 예산, 그 외는 월 예산. 예상 토큰 = 글자 수(정산이 실제 토큰으로 보정)
  const chars = texts.reduce((a, t) => a + t.length, 0);
  const kind = src.backfill || job.payload.backfill === true ? "backfill" : "embed";
  const { value } = await guarded(deps.budget, user, kind, costKrw(EMBED_MODEL, { input: chars, output: 0 }), job.id, async () => {
    const r = await deps.embed(texts);
    return { value: r, actualKrw: costKrw(EMBED_MODEL, { input: r.tokens, output: 0 }) };
  });
  if (value.vectors.length !== texts.length) throw new Error("embed count_mismatch");
  await deps.save(user, itemId, texts.map((text, i) => ({ i, text, embedding: toPgVector(value.vectors[i]) })));
  return log(job, "embedded", { chunks: texts.length, tokens: value.tokens });
}

function log(job: Job, checkpoint: string, m: Record<string, unknown>): string {
  console.log(JSON.stringify({ job_id: job.id, item_id: job.payload.item_id, checkpoint, ...m }));
  return checkpoint;
}
