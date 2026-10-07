import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { budgetDeps } from "../_shared/budget-deps.ts";
import { gmailReadApi, MAIL_CALL_TIMEOUT_MS, refreshAccessToken } from "../_shared/gmail.ts";
import { gmailAccessToken } from "../_shared/gmail-jobs.ts";
import { importTokenKey } from "../_shared/mail-token.ts";
import { seoulToday } from "../_shared/time.ts";
import { type MailReadConnection, type MailReadDeps, RpcError } from "./common.ts";
import { summarize } from "./summary.ts";

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
    // 갱신 15초. gmail-jobs call 은 RPC 실패를 평범한 Error("<함수> <SQLSTATE>")로 던진다 — refresh 가 던진 것만 그대로 두고 나머지는 RpcError(500)
    accessToken: async (u, c) => {
      let refreshErr: unknown = undefined;
      const refresh = async (rt: string) => { try { return await refreshAccessToken(rt, MAIL_CALL_TIMEOUT_MS); } catch (e) { refreshErr = e; throw e; } };
      try { return await gmailAccessToken(sb, refresh, u, c); }
      catch (e) {
        if (refreshErr !== undefined && e === refreshErr) throw e;
        const m = e instanceof Error ? /^([a-z_]+) ([A-Za-z0-9_]+)$/.exec(e.message) : null;
        throw m ? new RpcError(m[1], m[2]) : new RpcError("gmail_access_token", e instanceof Error ? e.name : "unknown");   // 메시지 원문은 남기지 않는다
      }
    },
    api: gmailReadApi,
    takeUnits: async (u, n) => {
      let timer: number | undefined;
      try {
        const r = await Promise.race([rpc("gmail_take_units", { p_user: u, p_units: n }),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new RpcError("gmail_take_units", "timeout")), UNITS_RPC_MS); })]);
        return r === true;
      } finally { clearTimeout(timer); }
    },
    // 거절된 Promise 는 캐시하지 않는다 — 키를 고치면 같은 isolate 에서 다음 요청부터 낫는다(S3 리뷰)
    tokenKey: () => (key ??= importTokenKey(Deno.env.get("MAIL_READ_KEY") ?? "").catch((e) => { key = null; throw e; })),
    budget: budgetDeps(sb),
    summarize: (i, onUsage) => summarize(i, onUsage),
    audit: async (u, target) => { await rpc("audit_mail_read", { p_user: u, p_target: target }); },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: () => Date.now(),
    today: () => seoulToday(),
  };
}
