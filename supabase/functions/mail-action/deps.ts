import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { gmailMailApi, MAIL_CALL_TIMEOUT_MS, refreshAccessToken } from "../_shared/gmail.ts";
import { gmailAccessToken, noteGmailUnits } from "../_shared/gmail-jobs.ts";
import { kickInBackground } from "../_shared/kick-worker.ts";
import { type Counts, type MailActionDeps, type MailConnection, type RowResult, RpcError } from "./handler.ts";

// service role. 모든 RPC 에 user_id 를 넘긴다(스펙 §12 통제 4). 행·연결은 그 user_id 로만 찾는다
export function mailActionDeps(sb: SupabaseClient): MailActionDeps {
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await sb.rpc(fn, args);
    if (error) throw new RpcError(fn, error.code ?? "error");
    return data;
  };
  return {
    enabled: () => Deno.env.get("MAIL_ACTIONS") === "on",
    authUser: async (t) => { const { data, error } = await sb.auth.getUser(t); return error ? null : data.user?.id ?? null; },
    connection: async (u) => ((await rpc("mail_connection", { p_user: u })) as MailConnection[] | null)?.[0] ?? null,
    accessToken: (u, c) => gmailAccessToken(sb, (rt) => refreshAccessToken(rt, MAIL_CALL_TIMEOUT_MS), u, c),   // 갱신 15초(D7)
    api: gmailMailApi,
    noteUnits: (u, n) => noteGmailUnits(sb, u, n),
    createRow: async (u, c, a, ids) => (await rpc("mail_action_preview", { p_user: u, p_connection: c, p_action: a, p_ids: ids })) as string | null,
    start: async (u, id) => (await rpc("mail_action_start", { p_user: u, p_id: id })) as RowResult,
    undo: async (u, id) => (await rpc("mail_action_undo", { p_user: u, p_id: id })) as RowResult,
    status: async (u, id) => (await rpc("mail_action_status", { p_user: u, p_id: id })) as Counts | null,
    kick: () => { kickInBackground(); },
    now: () => performance.now(),
  };
}
