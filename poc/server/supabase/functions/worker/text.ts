import { type Classifier, type ClassifyResult, gateDecision } from "../_shared/classify.ts";
import type { ExtractUsage } from "../_shared/extract.ts";
import type { TextExtraction, TextMeta } from "../_shared/extract-text.ts";
import { type FactInput, type SavedFact, textFact } from "../_shared/facts.ts";
import type { Job } from "../_shared/job.ts";
import { applyRules } from "../_shared/rules.ts";
import { receivedDay } from "../_shared/time.ts";

// process 잡(스펙 §7 "0단계 예외" 0b): 규칙 재적용 → 분류 게이트(Jev) → 텍스트 추출 → save_fact.
// 로그에는 id·코드·개수만(본문·추출값 금지)
export type TextItem = { contentEnc: string | null; source: string; appName: string | null; sender: string | null; title: string | null;
  occurredAt: string; capturedAt: string; status: string };
export type Metrics = { decrypt_ms: number; chars: number };
export type TextDeps = {
  getItem(userId: string, itemId: string): Promise<TextItem | null>;
  decrypt(userId: string, enc: string): Promise<string>;
  classifier: Classifier;
  threshold: number;
  extract(text: string, meta: TextMeta, today: string): Promise<{ result: TextExtraction; usage: ExtractUsage }>;
  addTokens(userId: string, tokens: number): Promise<void>;
  saveFact(f: FactInput): Promise<SavedFact>;
  enqueueNotify(userId: string, proposalId: string): Promise<void>;
  setStatus(userId: string, itemId: string, status: string, wipe: boolean): Promise<void>;
};

export async function processText(deps: TextDeps, job: Job, onMetrics?: (m: Metrics) => void): Promise<string> {
  if (!job.user_id) throw new Error("process job without user_id");
  const user = job.user_id, itemId = String(job.payload.item_id);
  const item = await deps.getItem(user, itemId);
  if (!item) throw new Error("worker_get_text_item not_found");
  if (item.status !== "queued") return log(job, item.status, { reason: "already_processed" });   // 재시도 멱등: 모델 재호출 없음
  if (item.contentEnc === null) return discard(deps, job, user, itemId, "empty", false);           // 원문 만료·미리보기 꺼짐

  const t0 = performance.now();
  let text: string;
  try {
    text = await deps.decrypt(user, item.contentEnc);
  } catch (e) {
    throw new Error(e instanceof Error && e.message.startsWith("no data key") ? "decrypt no_key" : "decrypt failed");
  }
  onMetrics?.({ decrypt_ms: Math.round((performance.now() - t0) * 10) / 10, chars: text.length });
  if (!text.trim()) return discard(deps, job, user, itemId, "empty", false);

  // 1) 서버 규칙 재적용: ingest 뒤 규칙이 바뀌었거나 다른 경로(Gmail·시드)로 들어온 항목도 같은 규칙을 받는다
  const v = applyRules(text, { sender: item.sender, title: item.title });
  if (v.kind === "discard") return discard(deps, job, user, itemId, v.reason, true);
  const meta: TextMeta = { source: item.source, appName: item.appName, title: item.title };

  // 2) 분류 게이트: 비행동 라벨 + confidence ≥ 임계만 폐기. 임계 미만·오류·타임아웃은 추출로(2026-09-29 사용자 결정, fail-open)
  let verdict: ClassifyResult | null = null;
  try {
    verdict = await deps.classifier.classify(v.masked, meta);
  } catch (e) {
    console.log(JSON.stringify({ job_id: job.id, classify_error: e instanceof Error ? e.message.slice(0, 60) : "error" }));
  }
  const gate = gateDecision(verdict, deps.threshold);
  if (gate.discard) return discard(deps, job, user, itemId, gate.reason, true);

  // 3) 추출. 상대 날짜 기준일 = 받은 날(occurred_at, 서울)
  const { result, usage } = await deps.extract(v.masked, meta, receivedDay(item.occurredAt));
  await deps.addTokens(user, usage.input_tokens + usage.output_tokens);
  const fact = textFact(user, itemId, result);
  if (fact === null) return discard(deps, job, user, itemId, "empty", false);   // 남길 것 없음: 원문 유지(1a 검색 대상)

  // 4) 저장(items.status = extracted 는 save_fact 가 한다)
  const saved = await deps.saveFact(fact);
  if (saved.proposalId) await deps.enqueueNotify(user, saved.proposalId);
  return log(job, saved.proposalId ? "proposed" : "extracted", { kind: fact.kind, created: saved.created,
    label: verdict?.label ?? null, confidence: verdict?.confidence ?? null, tokens: usage.input_tokens + usage.output_tokens });
}

async function discard(deps: TextDeps, job: Job, user: string, itemId: string, reason: string, wipe: boolean): Promise<string> {
  const status = `discarded:server:${reason}`;
  await deps.setStatus(user, itemId, status, wipe);
  return log(job, status, { wipe });
}

function log(job: Job, checkpoint: string, m: Record<string, unknown>): string {
  console.log(JSON.stringify({ job_id: job.id, item_id: job.payload.item_id, checkpoint, ...m }));
  return checkpoint;
}
