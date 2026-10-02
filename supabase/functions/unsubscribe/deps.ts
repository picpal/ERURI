import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { decrypt } from "../_shared/crypto.ts";
import { oneClickPost } from "../_shared/safe-post.ts";
import type { UnsubDeps } from "./handler.ts";

// service role. 모든 RPC 에 user_id 를 명시한다(스펙 §12 통제 4)
export function unsubDeps(sb: SupabaseClient): UnsubDeps {
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await sb.rpc(fn, args);
    if (error) throw new Error(fn + " " + error.code);
    return data;
  };
  return {
    authUser: async (t) => { const { data, error } = await sb.auth.getUser(t); return error ? null : data.user?.id ?? null; },
    begin: async (u, s) => (await rpc("unsub_begin", { p_user: u, p_sender: s })) as { result: string; url_enc?: string },
    decrypt: (u, enc) => decrypt(u, enc),
    post: (url) => oneClickPost(url),
    finish: async (u, s, c) => { await rpc("unsub_finish", { p_user: u, p_sender: s, p_code: c }); },
  };
}
