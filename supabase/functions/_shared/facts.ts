import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { ExtractedEvent } from "./extract.ts";
import type { TextExtraction } from "./extract-text.ts";

// 추출 결과 저장(스펙 §7 저장, 0b): 이미지(extract 잡, save_fact 1건)·텍스트(process 잡, save_facts 묶음). fact 마다 event→create_event,
// task→create_reminder 제안, items.status = 'extracted'. 같은 항목·종류·순번의 active fact 가 있으면 새로 만들지 않고 그 id 를 돌려준다(재시도 멱등)
export type FactKind = "event" | "task" | "purchase";
export type ProposalAction = "create_event" | "create_reminder";
export type FactInput = { userId: string; itemId: string; kind: FactKind; payload: Record<string, unknown>; evidence: string | null };
export type SavedFact = { factId: string; proposalId: string | null; created: boolean };

export function proposalAction(kind: FactKind): ProposalAction | null {
  return kind === "event" ? "create_event" : kind === "task" ? "create_reminder" : null;
}

export function eventFact(userId: string, itemId: string, event: ExtractedEvent, via: "vision" | "ocr" | "text", evidence: string | null = null): FactInput {
  return { userId, itemId, kind: "event", payload: { ...event, via }, evidence };
}

export type FactEntry = { payload: Record<string, unknown>; evidence: string | null };
export type FactsInput = { userId: string; itemId: string; kind: FactKind; entries: FactEntry[] };

// 텍스트 추출 → 한 항목의 fact 묶음(스펙 §7 저장, 2026-10-01): event 는 일정마다(시작 순 = 순번), task·purchase 는 1건
export function textFacts(userId: string, itemId: string, x: TextExtraction): FactsInput | null {
  switch (x.kind) {
    case "event": return { userId, itemId, kind: "event", entries: x.events.map((e) => ({ payload: { ...e.event, via: "text" }, evidence: e.evidence })) };
    case "task": return { userId, itemId, kind: "task", entries: [{ payload: { ...x.task, via: "text" }, evidence: x.evidence }] };
    case "purchase": return { userId, itemId, kind: "purchase", entries: [{ payload: { ...x.purchase, via: "text" }, evidence: x.evidence }] };
    default: return null;
  }
}

export async function saveFact(sb: SupabaseClient, f: FactInput): Promise<SavedFact> {
  const { data, error } = await sb.rpc("save_fact", { p_user: f.userId, p_item: f.itemId, p_kind: f.kind, p_payload: f.payload,
    p_evidence: f.evidence, p_action: proposalAction(f.kind) });
  if (error) throw new Error("save_fact " + error.code);
  const row = (data as { out_fact_id: string; out_proposal_id: string | null; out_created: boolean }[])[0];
  if (!row) throw new Error("save_fact empty");
  return { factId: row.out_fact_id, proposalId: row.out_proposal_id, created: row.out_created };
}

// 한 항목의 fact 묶음 저장(0025 save_facts, 한 트랜잭션). 반환은 순번 순
export async function saveFacts(sb: SupabaseClient, f: FactsInput): Promise<SavedFact[]> {
  const { data, error } = await sb.rpc("save_facts", { p_user: f.userId, p_item: f.itemId, p_kind: f.kind, p_entries: f.entries,
    p_action: proposalAction(f.kind) });
  if (error) throw new Error("save_facts " + error.code);
  const rows = (data as { out_ordinal: number; out_fact_id: string; out_proposal_id: string | null; out_created: boolean }[])
    .sort((a, b) => a.out_ordinal - b.out_ordinal);
  if (rows.length !== f.entries.length) throw new Error("save_facts count");
  return rows.map((r) => ({ factId: r.out_fact_id, proposalId: r.out_proposal_id, created: r.out_created }));
}

// 제안이 있을 때마다 notify 잡(스펙 §7). 재시도로 여러 번 들어와도 기기별 1회(proposal_pushes)가 막는다.
// 테스트는 leasePrefix 에 실행 태그('test:<run>:')를 줘서 워커 cron 이 가져가지 않게 한다
export async function enqueueNotify(sb: SupabaseClient, userId: string, proposalId: string, leasePrefix = ""): Promise<void> {
  const { error } = await sb.rpc("enqueue_job", { p_user: userId, p_kind: "notify", p_lease_key: `${leasePrefix}notify:${proposalId}`,
    p_payload: { proposal_id: proposalId } });
  if (error) throw new Error("enqueue_job " + error.code);
}
