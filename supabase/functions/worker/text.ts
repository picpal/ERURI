import { type BudgetDeps, costKrw, guarded } from "../_shared/budget.ts";
import { type Classifier, classifierMeta, type ClassifyResult, gateDecision } from "../_shared/classify.ts";
import type { ExtractUsage } from "../_shared/extract.ts";
import type { TextExtraction, TextMeta } from "../_shared/extract-text.ts";
import { type FactsInput, type SavedFact, textFacts } from "../_shared/facts.ts";
import type { Job } from "../_shared/job.ts";
import { applyRules } from "../_shared/rules.ts";
import { receivedDay } from "../_shared/time.ts";

// process 잡(스펙 §7 "0단계 예외" 0b): 규칙 재적용 → 분류 게이트(Jev) → 텍스트 추출 → save_facts → embed 잡(1b).
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
  addTokens(userId: string, tokens: number, backfill: boolean): Promise<void>;
  saveFacts(f: FactsInput): Promise<SavedFact[]>;
  enqueueNotify(userId: string, proposalId: string): Promise<void>;
  unpushedProposals(userId: string, itemId: string): Promise<string[]>;
  setStatus(userId: string, itemId: string, status: string, wipe: boolean): Promise<void>;
  recordGate(userId: string, itemId: string, label: string, confidence: number): Promise<void>;
  quarantine(userId: string, itemId: string, status: string): Promise<void>;
  enqueueEmbed(userId: string, itemId: string, backfill: boolean): Promise<void>;
  budget: BudgetDeps;
};

export async function processText(deps: TextDeps, job: Job, onMetrics?: (m: Metrics) => void): Promise<string> {
  if (!job.user_id) throw new Error("process job without user_id");
  const user = job.user_id, itemId = String(job.payload.item_id);
  const item = await deps.getItem(user, itemId);
  if (!item) throw new Error("worker_get_text_item not_found");
  if (item.status !== "queued") {                                  // 재시도 멱등: 모델 재호출 없음
    // save_facts 가 extracted 를 커밋한 뒤 notify enqueue 전에 끊겼을 수 있다. 대표 제안에 푸시 기록이 없으면 다시 넣는다(기기별 1회가 중복을 막는다)
    const again = item.status === "extracted" ? await deps.unpushedProposals(user, itemId) : [];
    for (const p of again) await deps.enqueueNotify(user, p);
    // embed 잡 적재 전에 끊겼을 수도 있다. 검색 대상이면 다시 넣는다(embed 잡은 청크가 이미 있으면 건너뛴다)
    const embed = item.contentEnc !== null && (item.status === "extracted" || item.status === "discarded:server:empty");
    if (embed) await deps.enqueueEmbed(user, itemId, job.payload.backfill === true);
    return log(job, item.status, { reason: "already_processed", renotify: again.length, reembed: embed });
  }
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

  // 2) 분류 게이트: 비행동 라벨 + confidence ≥ 임계만 폐기(7일 격리). 임계 미만·오류·타임아웃은 추출로(fail-open).
  //    사용자가 "최근 폐기"에서 복구한 항목(skip_gate)은 게이트를 건너뛴다(스펙 §7)
  let verdict: ClassifyResult | null = null;
  if (job.payload.skip_gate !== true) {
    try {
      verdict = await deps.classifier.classify(v.masked, classifierMeta(meta));   // 메신저 제목(발신자 이름)은 빼고 보낸다
    } catch (e) {
      console.log(JSON.stringify({ job_id: job.id, classify_error: e instanceof Error ? e.message.slice(0, 60) : "error" }));
    }
    if (verdict) await deps.recordGate(user, itemId, verdict.label, verdict.confidence);   // 실데이터 라벨 기록(본문 없음)
    const gate = gateDecision(verdict, deps.threshold);
    if (gate.discard) {
      const status = `discarded:server:${gate.reason}`;
      await deps.quarantine(user, itemId, status);
      return log(job, status, { quarantine: true, confidence: verdict?.confidence ?? null });
    }
  }

  // 3) 추출. 비용 예약(§13): 백필 항목은 1회 예산, 그 외는 월 예산. 소진이면 Deferred(다음 달) — 잡은 queued 로 남는다
  const kind = job.payload.backfill === true ? "backfill" : "extract";
  const est = costKrw("gpt-6-luna", { input: v.masked.length + 1200, output: 700 });
  const { value: { result, usage } } = await guarded(deps.budget, user, kind, est, job.id, async () => {
    const x = await deps.extract(v.masked, meta, receivedDay(item.occurredAt));   // 상대 날짜 기준일 = 받은 날(서울)
    return { value: x, actualKrw: costKrw("gpt-6-luna", { input: x.usage.input_tokens, output: x.usage.output_tokens }) };
  });
  await deps.addTokens(user, usage.input_tokens + usage.output_tokens, job.payload.backfill === true);
  const facts = textFacts(user, itemId, result);
  if (facts === null) {                                              // 남길 것 없음: 원문 유지(1b 검색 대상, §7)
    const st = await discard(deps, job, user, itemId, "empty", false);
    await deps.enqueueEmbed(user, itemId, job.payload.backfill === true);
    return st;
  }

  // 4) 저장(한 트랜잭션, items.status = extracted 는 save_facts 가 한다). 알림은 항목당 1개 — 대표 = 순번이 가장 작은 제안(§7 notify)
  const saved = await deps.saveFacts(facts);
  const lead = saved.find((s) => s.proposalId !== null)?.proposalId ?? null;
  if (lead) await deps.enqueueNotify(user, lead);
  await deps.enqueueEmbed(user, itemId, job.payload.backfill === true);   // 청크·임베딩(백필 항목은 백필 레인)
  return log(job, lead ? "proposed" : "extracted", { kind: facts.kind, facts: saved.length, created: saved.some((s) => s.created),
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
