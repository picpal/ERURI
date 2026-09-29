import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { type APNsResult, type ApnsEnv, type ApnsPushType, sendAPNs, sendWithEnvFallback } from "../_shared/apns.ts";
import { revokeToken } from "../_shared/gmail.ts";
import type { AccountDeps, Device } from "./handler.ts";

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
    listDevices: async (u) => (await rpc("worker_list_devices", { p_user: u })) as Device[],
    // 사용자 삭제 뒤에 부른다: DB 없이 보관한 토큰으로만 보낸다
    async wipe(devices) {
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
    removeStorage: (u) => removeUserStorage(sb, u),
    audit: async (u, action, target) => { await rpc("account_audit", { p_user: u, p_action: action, p_target: target }); },
    async deleteUser(u) {
      const { error } = await sb.auth.admin.deleteUser(u);
      if (error) throw new Error("delete_user " + (error.code ?? error.status));
    },
  };
}

const PAGE = 1000;
// media/<user_id>/ 아래 전부(하위 폴더 포함, 1000개씩 페이지). list·remove 오류는 throw — 사용자 삭제 전에 멈춰야
// items.storage_key 가 남아 재시도할 수 있다(삭제 후엔 평문 원본이 고아가 된다, 리뷰 #3)
export async function removeUserStorage(sb: Pick<SupabaseClient, "storage">, user: string): Promise<number> {
  const bucket = sb.storage.from("media");
  const files: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (let offset = 0;; offset += PAGE) {
      const { data, error } = await bucket.list(dir, { limit: PAGE, offset });
      if (error) throw new Error("storage_list " + (error.name ?? "error"));
      for (const f of data ?? []) {
        if (f.id === null) await walk(`${dir}/${f.name}`);          // 폴더 항목은 id 가 null
        else files.push(`${dir}/${f.name}`);
      }
      if ((data ?? []).length < PAGE) return;
    }
  };
  await walk(user);
  for (let i = 0; i < files.length; i += PAGE) {
    const { error } = await bucket.remove(files.slice(i, i + PAGE));
    if (error) throw new Error("storage_remove " + (error.name ?? "error"));
  }
  return files.length;
}
