import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { Classifier } from "../_shared/classify.ts";
import { decrypt } from "../_shared/crypto.ts";
import { extractTextDetailed } from "../_shared/extract-text.ts";
import { enqueueNotify, saveFact } from "../_shared/facts.ts";
import { addExtractTokens } from "./media-deps.ts";
import type { TextDeps, TextItem } from "./text.ts";

type Row = { content_enc: string | null; source: string; app_name: string | null; sender: string | null; title: string | null;
  occurred_at: string; captured_at: string; status: string };

// process 잡의 실제 의존성(service role). 모든 RPC에 user_id를 명시한다(스펙 §12 통제 4)
export function textDeps(sb: SupabaseClient, o: { classifier: Classifier; threshold: number; extract?: TextDeps["extract"]; leasePrefix?: string }): TextDeps {
  return {
    async getItem(userId, itemId): Promise<TextItem | null> {
      const { data, error } = await sb.rpc("worker_get_text_item", { p_user: userId, p_item: itemId });
      if (error) throw new Error("worker_get_text_item " + error.code);
      const r = (data as Row[])[0];
      return r ? { contentEnc: r.content_enc, source: r.source, appName: r.app_name, sender: r.sender, title: r.title,
        occurredAt: r.occurred_at, capturedAt: r.captured_at, status: r.status } : null;
    },
    decrypt: (userId, enc) => decrypt(userId, enc),
    classifier: o.classifier,
    threshold: o.threshold,
    extract: o.extract ?? ((text, meta, today) => extractTextDetailed(text, meta, today)),
    addTokens: (userId, tokens, backfill) => addExtractTokens(sb, userId, tokens, backfill),
    saveFact: (f) => saveFact(sb, f),
    enqueueNotify: (userId, proposalId) => enqueueNotify(sb, userId, proposalId, o.leasePrefix ?? ""),
    async unpushedProposals(userId, itemId) {
      const { data, error } = await sb.rpc("worker_unpushed_proposals", { p_user: userId, p_item: itemId });
      if (error) throw new Error("worker_unpushed_proposals " + error.code);
      return data as string[];
    },
    async setStatus(userId, itemId, status, wipe) {
      const { error } = await sb.rpc("worker_set_item_status", { p_user: userId, p_item: itemId, p_status: status, p_wipe: wipe });
      if (error) throw new Error("worker_set_item_status " + error.code);
    },
    async recordGate(userId, itemId, label, confidence) {
      const { error } = await sb.rpc("worker_record_gate", { p_user: userId, p_item: itemId, p_label: label, p_confidence: confidence });
      if (error) throw new Error("worker_record_gate " + error.code);
    },
    async quarantine(userId, itemId, status) {
      const { error } = await sb.rpc("worker_quarantine_item", { p_user: userId, p_item: itemId, p_status: status });
      if (error) throw new Error("worker_quarantine_item " + error.code);
    },
  };
}
