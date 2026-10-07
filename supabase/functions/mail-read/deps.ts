import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { budgetDeps } from "../_shared/budget-deps.ts";
import { gmailReadApi, MAIL_CALL_TIMEOUT_MS, refreshAccessToken } from "../_shared/gmail.ts";
import { gmailAccessToken } from "../_shared/gmail-jobs.ts";
import { importTokenKey } from "../_shared/mail-token.ts";
import { seoulToday } from "../_shared/time.ts";
import { type MailReadConnection, type MailReadDeps, RpcError } from "./common.ts";

// service role. 모든 RPC 에 user_id 를 넘긴다(스펙 §12 통제 4). 연결은 그 user_id 로만 찾는다
export const UNITS_RPC_MS = 1_000;                                       // gmail_take_units 1초 예산(fail-closed — 넘으면 500)
export function mailReadDeps(sb: SupabaseClient): MailReadDeps {
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await sb.rpc(fn, args);
    if (error) throw new RpcError(fn, error.code ?? "error");
    return data;
  };
  let key: Promise<CryptoKey> | null = null;
  return {
    enabled: () => Deno.env.get("MAIL_READ") === "on",
    authUser: async (t) => { const { data, error } = await sb.auth.getUser(t); return error ? null : data.user?.id ?? null; },
    connection: async (u) => ((await rpc("mail_connection", { p_user: u })) as MailReadConnection[] | null)?.[0] ?? null,
    accessToken: (u, c) => gmailAccessToken(sb, (rt) => refreshAccessToken(rt, MAIL_CALL_TIMEOUT_MS), u, c),   // 갱신 15초
    api: gmailReadApi,
    takeUnits: async (u, n) => {
      let timer: number | undefined;
      try {
        const r = await Promise.race([rpc("gmail_take_units", { p_user: u, p_units: n }),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new RpcError("gmail_take_units", "timeout")), UNITS_RPC_MS); })]);
        return r === true;
      } finally { clearTimeout(timer); }
    },
    tokenKey: () => (key ??= importTokenKey(Deno.env.get("MAIL_READ_KEY") ?? "")),
    budget: budgetDeps(sb),
    summarize: () => Promise.reject(new Error("not_implemented")),   // S4 가 summary.ts summarize 로 바꾼다
    audit: async (u, target) => { await rpc("audit_mail_read", { p_user: u, p_target: target }); },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: () => Date.now(),
    today: () => seoulToday(),
  };
}
