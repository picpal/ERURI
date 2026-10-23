import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { budgetDeps, holdDeps } from "../_shared/budget-deps.ts";
import { gmailReadApi, MAIL_CALL_TIMEOUT_MS, refreshAccessToken } from "../_shared/gmail.ts";
import { gmailAccessToken, type RpcClient } from "../_shared/gmail-jobs.ts";
import { importTokenKey } from "../_shared/mail-token.ts";
import { seoulToday } from "../_shared/time.ts";
import { type MailReadConnection, type MailReadDeps, RpcError } from "./common.ts";
import { summarize, summarizeDigest } from "./summary.ts";

// service role. 모든 RPC 에 user_id 를 넘긴다(스펙 §12 통제 4). 연결은 그 user_id 로만 찾는다
export const UNITS_RPC_MS = 1_000;                                       // gmail_take_units 1초 예산(fail-closed — 넘으면 500)
// 토큰 갱신 안 RPC 제한 시간(digest, DP27 — Codex 0.19.0 계획 리뷰 #3): 넘으면 { error: { code: "timeout" } } — gmail-jobs call 이 "fn timeout" 을 던지고
// accessToken 의 catch 가 RpcError(fn, "timeout") 로 바꾼다(500 internal, 로그 = 함수 이름·코드)
export function timedRpc(sb: SupabaseClient, ms: () => number): RpcClient {
  return {
    rpc: (fn, args) => {
      let t: number | undefined;
      const late = new Promise<{ data: null; error: { code: string } }>((res) => { t = setTimeout(() => res({ data: null, error: { code: "timeout" } }), ms()); });
      return Promise.race([Promise.resolve(sb.rpc(fn, args)), late]).finally(() => clearTimeout(t));
    },
  };
}
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
    // 갱신 15초. gmail-jobs call 은 RPC 실패를 평범한 Error("<함수> <SQLSTATE>")로 던진다 — refresh 가 던진 것만 그대로 두고 나머지는 RpcError(500).
    // lim(digest, DP27): 안의 RPC 는 min(rpcMs, 남은 시간), 토큰 엔드포인트는 min(15초, 남은 시간)
    accessToken: async (u, c, lim) => {
      let refreshErr: unknown = undefined;
      const left = () => (lim ? lim.deadline - Date.now() : Infinity);
      const refresh = async (rt: string) => {
        try { return await refreshAccessToken(rt, Math.max(1, Math.min(MAIL_CALL_TIMEOUT_MS, left()))); } catch (e) { refreshErr = e; throw e; }
      };
      const client: RpcClient = lim ? timedRpc(sb, () => Math.max(1, Math.min(lim.rpcMs, left()))) : sb;
      try { return await gmailAccessToken(client, refresh, u, c); }
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
    summarizeDigest: (i, onUsage, signal, t) => summarizeDigest(i, onUsage, signal, t),
    holds: holdDeps(sb),
    audit: async (u, target) => { await rpc("audit_mail_read", { p_user: u, p_target: target }); },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: () => Date.now(),
    today: () => seoulToday(),
  };
}
