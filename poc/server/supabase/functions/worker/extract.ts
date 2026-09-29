import { encodeBase64 } from "jsr:@std/encoding@1/base64";
import type { ExtractedEvent, ExtractInput, ExtractUsage } from "../_shared/extract.ts";
import type { SavedFact } from "../_shared/facts.ts";
import type { Job } from "../_shared/job.ts";

// extract 잡(스펙 §7 이미지/PDF): items.storage_key → Storage → gpt-6-luna vision.
// 월 상한 100건(usage_counters.vision_calls, 호출 전 예약). 초과 시 기기에서 같이 올라온 OCR 텍스트만 보낸다
export const VISION_MONTHLY_LIMIT = 100;
export const PDF_MAX_BYTES = 10 * 1024 * 1024;       // 스펙 §7 PDF 10MB. 50페이지 검사는 PoC 범위 밖(모델 입력 한도에 맡김)
export const IMAGE_MAX_BYTES = 20 * 1024 * 1024;

export type MediaDeps = {
  getItem(userId: string, itemId: string): Promise<{ storage_key: string | null; ocr_text_enc: string | null }>;
  decrypt(userId: string, enc: string): Promise<string>;
  reserveVision(userId: string): Promise<boolean>;
  download(storageKey: string): Promise<Uint8Array>;
  extract(input: ExtractInput): Promise<{ event: ExtractedEvent; usage: ExtractUsage }>;
  addTokens(userId: string, tokens: number): Promise<void>;
  saveEvent(userId: string, itemId: string, event: ExtractedEvent, via: "vision" | "ocr"): Promise<SavedFact>;
  enqueueNotify(userId: string, proposalId: string): Promise<void>;
};

export function mediaTypeOf(key: string): "image/jpeg" | "image/png" | "application/pdf" | null {
  const ext = key.toLowerCase().split(".").pop();
  return ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "png" ? "image/png" : ext === "pdf" ? "application/pdf" : null;
}

export async function extractMedia(deps: MediaDeps, job: Job): Promise<string> {
  if (!job.user_id) throw new Error("extract job without user_id");
  const user = job.user_id;
  const itemId = String(job.payload.item_id);
  const item = await deps.getItem(user, itemId);
  if (!item.storage_key) throw new Error("extract no_storage_key");
  const type = mediaTypeOf(item.storage_key);
  if (!type) throw new Error("extract unsupported_media");
  let ocrText: string | undefined;
  if (item.ocr_text_enc) {
    try { ocrText = await deps.decrypt(user, item.ocr_text_enc) || undefined; } catch { throw new Error("decrypt failed"); }
  }

  let input: ExtractInput;
  let via: "vision" | "ocr";
  if (await deps.reserveVision(user)) {
    const bytes = await deps.download(item.storage_key);
    if (bytes.length > (type === "application/pdf" ? PDF_MAX_BYTES : IMAGE_MAX_BYTES)) return log(job, "needs_review", { reason: "too_large" });
    const b64 = encodeBase64(bytes);
    input = type === "application/pdf" ? { pdfBase64: b64, ocrText } : { imageBase64: b64, mediaType: type, ocrText };
    via = "vision";
  } else if (ocrText) {
    input = { ocrText };
    via = "ocr";
  } else {
    return log(job, "needs_review", { reason: "vision_cap_no_ocr" });   // "앱에서 확인"(스펙 §7)
  }
  const { event, usage } = await deps.extract(input);
  await deps.addTokens(user, usage.input_tokens + usage.output_tokens);
  const saved = await deps.saveEvent(user, itemId, event, via);
  if (saved.proposalId) await deps.enqueueNotify(user, saved.proposalId);
  return log(job, "proposed", { via, has_start: event.start !== null, uncertain: event.uncertain.length,
    tokens: usage.input_tokens + usage.output_tokens });
}

// 식별자·코드·개수만 남긴다(추출값·본문 금지)
function log(job: Job, checkpoint: string, m: Record<string, unknown>) {
  console.log(JSON.stringify({ job_id: job.id, item_id: job.payload.item_id, checkpoint, ...m }));
  return checkpoint;
}
