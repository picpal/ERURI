import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { decrypt } from "../_shared/crypto.ts";
import { extractEventDetailed } from "../_shared/extract.ts";
import { enqueueNotify, eventFact, saveFact } from "../_shared/facts.ts";
import { type MediaDeps, VISION_MONTHLY_LIMIT } from "./extract.ts";

// 토큰 정산(§13). process·extract 두 잡이 같이 쓴다. 백필 항목은 1회 백필 카운터로
export async function addExtractTokens(sb: SupabaseClient, userId: string, tokens: number, backfill = false): Promise<void> {
  const { error } = await sb.rpc("add_extract_tokens", { p_user: userId, p_tokens: tokens, p_backfill: backfill });
  if (error) throw new Error("add_extract_tokens " + error.code);
}

// extract 잡의 실제 의존성(service role). 사용자 범위는 모든 RPC에 user_id를 명시해 좁힌다(스펙 §12 통제 4)
export function mediaDeps(sb: SupabaseClient, extract: MediaDeps["extract"] = (i) => extractEventDetailed(i), o: { leasePrefix?: string } = {}): MediaDeps {
  return {
    async getItem(userId, itemId) {
      const { data, error } = await sb.rpc("worker_get_media", { p_user: userId, p_item: itemId });
      if (error) throw new Error("worker_get_media " + error.code);
      const row = (data as { storage_key: string | null; ocr_text_enc: string | null }[])[0];
      if (!row) throw new Error("worker_get_media not_found");
      return row;
    },
    decrypt: (userId, enc) => decrypt(userId, enc),
    async reserveVision(userId) {
      const { data, error } = await sb.rpc("reserve_vision_call", { p_user: userId, p_limit: VISION_MONTHLY_LIMIT });
      if (error) throw new Error("reserve_vision_call " + error.code);
      return data === true;
    },
    async download(storageKey) {
      // storage_key = '<bucket>/<user_id>/<파일>'. 다른 사용자 경로는 getItem의 소유 조건이 이미 막는다
      const [bucket, ...rest] = storageKey.split("/");
      const { data, error } = await sb.storage.from(bucket).download(rest.join("/"));
      if (error || !data) throw new Error("storage download failed");
      return new Uint8Array(await data.arrayBuffer());
    },
    extract,
    addTokens: (userId, tokens) => addExtractTokens(sb, userId, tokens),
    saveEvent: (userId, itemId, event, via) => saveFact(sb, eventFact(userId, itemId, event, via)),
    enqueueNotify: (userId, proposalId) => enqueueNotify(sb, userId, proposalId, o.leasePrefix ?? ""),
  };
}
