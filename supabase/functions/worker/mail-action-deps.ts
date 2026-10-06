import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { gmailMailApi, MAIL_CALL_TIMEOUT_MS, refreshAccessToken } from "../_shared/gmail.ts";
import { gmailAccessToken } from "../_shared/gmail-jobs.ts";
import type { Loaded, MailJobDeps } from "./mail-action.ts";

// service role. 모든 RPC 에 user_id 를 넘긴다(스펙 §12 통제 4). 보관함 RPC 는 부르지 않는다(Gmail 만 바꾼다)
export function mailJobDeps(sb: SupabaseClient): MailJobDeps {
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await sb.rpc(fn, args);
    if (error) throw new Error(fn + " " + (error.code ?? "error"));
    return data;
  };
  return {
    begin: async (u, id, phase) => (await rpc("mail_action_begin", { p_user: u, p_id: id, p_phase: phase })) as Loaded | null,
    token: async (u, conn) => {
      const t = await gmailAccessToken(sb, (rt) => refreshAccessToken(rt, MAIL_CALL_TIMEOUT_MS), u, conn);   // 갱신도 15초(D7)
      if (t) return t;
      const rows = (await rpc("mail_connection", { p_user: u })) as { connection_id: string; status: string }[] | null;
      const c = rows?.find((r) => r.connection_id === conn);
      return { code: c && c.status !== "active" ? "reauth_required" : "no_connection" };   // D11
    },
    api: gmailMailApi,
    take: async (u, n) => (await rpc("gmail_take_units", { p_user: u, p_units: n })) === true,
    setMethod: async (u, id, m) => { await rpc("mail_action_set_method", { p_user: u, p_id: id, p_method: m }); },
    progress: async (u, id, phase, from, to, ok, failed) =>
      (await rpc("mail_action_progress", { p_user: u, p_id: id, p_phase: phase, p_from: from, p_cursor: to, p_ok: ok, p_failed: failed })) === true,
    quota: async (u, id) => (await rpc("mail_action_quota", { p_user: u, p_id: id })) as string | null,
    finish: async (u, id, phase, code) => { await rpc("mail_action_finish", { p_user: u, p_id: id, p_phase: phase, p_code: code }); },
    now: () => Date.now(),
    log: (o) => console.log(JSON.stringify(o)),
  };
}
