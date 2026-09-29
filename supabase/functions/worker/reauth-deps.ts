import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { sendAPNs } from "../_shared/apns.ts";
import type { ReauthDeps } from "./reauth.ts";

// gmail-reauth 잡의 실제 의존성(service role). 모든 RPC 에 user_id 를 명시한다(스펙 §12 통제 4)
export function reauthDeps(sb: SupabaseClient): ReauthDeps {
  const call = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await sb.rpc(fn, args);
    if (error) throw new Error(fn + " " + error.code);
    return data;
  };
  return {
    claim: async (u, c, r, k) => (await call("claim_reauth_push", { p_user: u, p_connection: c, p_reason: r, p_window_key: k })) === true,
    release: async (u, c, r, k) => { await call("release_reauth_push", { p_user: u, p_connection: c, p_reason: r, p_window_key: k }); },
    listDevices: async (u) => (await call("worker_list_devices", { p_user: u })) as { device_id: string; apns_token: string; apns_env: "sandbox" | "production" }[],
    send: sendAPNs,
    topic: () => Deno.env.get("APNS_TOPIC")!,
  };
}
