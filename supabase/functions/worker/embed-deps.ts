import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { budgetDeps } from "../_shared/budget-deps.ts";
import { decrypt } from "../_shared/crypto.ts";
import { embedWithUsage } from "../_shared/embeddings.ts";
import type { EmbedDeps } from "./embed.ts";

// embed 잡의 실제 의존성(service role). 모든 RPC에 user_id를 명시한다(스펙 §12 통제 4)
export function embedDeps(sb: SupabaseClient): EmbedDeps {
  return {
    async source(u, i) {
      const { data, error } = await sb.rpc("worker_get_embed_source", { p_user: u, p_item: i });
      if (error) throw new Error("worker_get_embed_source " + error.code);
      const r = (data as { content_enc: string; title: string | null }[])[0];
      return r ? { contentEnc: r.content_enc, title: r.title } : null;
    },
    decrypt: (u, enc) => decrypt(u, enc),
    embed: (texts) => embedWithUsage(texts, "document"),
    async save(u, i, chunks) {
      const { error } = await sb.rpc("worker_save_chunks", { p_user: u, p_item: i, p_chunks: chunks });
      if (error) throw new Error("worker_save_chunks " + error.code);
    },
    budget: budgetDeps(sb),
  };
}
