import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { Classifier } from "../_shared/classify.ts";
import { decrypt } from "../_shared/crypto.ts";
import { extractTextDetailed } from "../_shared/extract-text.ts";
import { saveFact } from "../_shared/facts.ts";
import { addExtractTokens } from "./media-deps.ts";
import type { TextDeps, TextItem } from "./text.ts";

type Row = { content_enc: string | null; source: string; app_name: string | null; sender: string | null; title: string | null;
  occurred_at: string; captured_at: string; status: string };

// process 잡의 실제 의존성(service role). 모든 RPC에 user_id를 명시한다(스펙 §12 통제 4)
export function textDeps(sb: SupabaseClient, o: { classifier: Classifier; threshold: number; extract?: TextDeps["extract"] }): TextDeps {
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
    addTokens: (userId, tokens) => addExtractTokens(sb, userId, tokens),
    saveFact: (f) => saveFact(sb, f),
    async setStatus(userId, itemId, status, wipe) {
      const { error } = await sb.rpc("worker_set_item_status", { p_user: userId, p_item: itemId, p_status: status, p_wipe: wipe });
      if (error) throw new Error("worker_set_item_status " + error.code);
    },
  };
}
