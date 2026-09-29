import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { type APNsResult, type ApnsEnv, type ApnsPushType, sendAPNs, sendWithEnvFallback } from "../_shared/apns.ts";
import { revokeToken } from "../_shared/gmail.ts";
import type { AccountDeps } from "./handler.ts";

export const WIPE_PAYLOAD = { aps: { "content-available": 1 }, eruri_wipe: true } as const;
type Send = (o: { token: string; payload: unknown; topic: string; priority?: 5 | 10; env: ApnsEnv; pushType?: ApnsPushType }) => Promise<APNsResult>;

// service role. 모든 RPC 에 user_id 를 명시한다(스펙 §12 통제 4). 사용자 삭제만 Auth admin API
export function accountDeps(sb: SupabaseClient, o: { revoke?: (t: string) => Promise<void>; send?: Send } = {}): AccountDeps {
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await sb.rpc(fn, args);
    if (error) throw new Error(fn + " " + error.code);
    return data;
  };
  return {
    authUser: async (t) => { const { data, error } = await sb.auth.getUser(t); return error ? null : data.user?.id ?? null; },
    connections: async (u) => (await rpc("account_connections", { p_user: u })) as string[],
    refreshToken: async (u, c) => (await rpc("gmail_get_refresh_token", { p_user: u, p_connection: c })) as string | null,
    revoke: o.revoke ?? revokeToken,
    deleteGmailSource: async (u, c) => (await rpc("delete_gmail_source", { p_user: u, p_connection: c })) as Record<string, number>,
    async wipeDevices(u) {
      const devices = (await rpc("worker_list_devices", { p_user: u })) as { apns_token: string; apns_env: ApnsEnv }[];
      let n = 0;
      for (const d of devices) {
        try {
          const r = await sendWithEnvFallback(o.send ?? sendAPNs, { token: d.apns_token, payload: WIPE_PAYLOAD, topic: Deno.env.get("APNS_TOPIC")!,
            env: d.apns_env, priority: 5, pushType: "background" });
          if (r.status === 200) n++;
        } catch { /* 연결 오류: 기기 로컬 정리는 최선 노력 */ }
      }
      return n;
    },
    async removeStorage(u) {
      const { data } = await sb.storage.from("media").list(u, { limit: 1000 });
      const paths = (data ?? []).map((f) => `${u}/${f.name}`);
      if (paths.length) await sb.storage.from("media").remove(paths);
      return paths.length;
    },
    audit: async (u, action, target) => { await rpc("account_audit", { p_user: u, p_action: action, p_target: target }); },
    async deleteUser(u) {
      const { error } = await sb.auth.admin.deleteUser(u);
      if (error) throw new Error("delete_user " + (error.code ?? error.status));
    },
  };
}
