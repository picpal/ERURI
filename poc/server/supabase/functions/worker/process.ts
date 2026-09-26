import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { decrypt } from "../_shared/crypto.ts";
import type { Job } from "../_shared/job.ts";

// 평문을 받는 다음 단계. 반환값이 체크포인트가 된다
export type Extract = (userId: string, itemId: string, text: string) => Promise<string>;

export type Metrics = { decrypt_ms: number; chars: number };

export async function processItem(sb: SupabaseClient, job: Job, extract: Extract, onMetrics?: (m: Metrics) => void): Promise<string> {
  if (!job.user_id) throw new Error("process job without user_id");
  const itemId = String(job.payload.item_id);
  const { data, error } = await sb.rpc("worker_get_item", { p_user: job.user_id, p_item: itemId });
  if (error) throw new Error("worker_get_item " + error.code);
  const row = (data as { content_enc: string }[])[0];
  if (!row) throw new Error("worker_get_item not_found");
  const t0 = performance.now();
  let text: string;
  try {
    text = await decrypt(job.user_id, row.content_enc);
  } catch (e) {
    // WebCrypto 오류 메시지를 그대로 남기지 않는다(오류 코드만)
    throw new Error(e instanceof Error && e.message.startsWith("no data key") ? "decrypt no_key" : "decrypt failed");
  }
  const m = { decrypt_ms: Math.round((performance.now() - t0) * 10) / 10, chars: text.length };
  const checkpoint = await extract(job.user_id, itemId, text);
  console.log(JSON.stringify({ item_id: itemId, ...m }));  // 본문 금지
  onMetrics?.(m);
  return checkpoint;
}
