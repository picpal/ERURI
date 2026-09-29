import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { ExtractedEvent } from "./extract.ts";
import type { TextExtraction } from "./extract-text.ts";

// 추출 결과 저장(스펙 §7 저장, 0b): 이미지(extract 잡)·텍스트(process 잡) 공용. fact 1건 + event→create_event, task→create_reminder 제안,
// items.status = 'extracted'. 같은 항목·같은 종류의 active fact 가 있으면 새로 만들지 않고 그 id 를 돌려준다(재시도 멱등)
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

export function textFact(userId: string, itemId: string, x: TextExtraction): FactInput | null {
  switch (x.kind) {
    case "event": return eventFact(userId, itemId, x.event, "text", x.evidence);
    case "task": return { userId, itemId, kind: "task", payload: { ...x.task, via: "text" }, evidence: x.evidence };
    case "purchase": return { userId, itemId, kind: "purchase", payload: { ...x.purchase, via: "text" }, evidence: x.evidence };
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
