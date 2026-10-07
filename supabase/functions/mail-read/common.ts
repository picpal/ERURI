import type { BudgetDeps, TokenUsage } from "../_shared/budget.ts";
import { type GmailReadApi, ReauthRequired } from "../_shared/gmail.ts";
import type { SummaryInput, SummaryOutput } from "./summary.ts";

// 메일 요약 Edge(스펙 §7 "메일 요약"): 공용 타입·오류·응답 도우미. 로그는 request_id·단계·결과 코드·개수·status·잘림·첨부 수·모델·elapsed_ms 만 —
// Gmail id·검색 칸·발신자·제목·본문·요약·request 없음(§12 통제 4)
export type MailReadConnection = { connection_id: string; status: string };
export type MailReadDeps = {
  enabled(): boolean;                                                  // MAIL_READ=on — 꺼지면 검색·읽기 모두 503 disabled
  authUser(token: string): Promise<string | null>;
  connection(user: string): Promise<MailReadConnection | null>;        // 0030 mail_connection(최신 1개)
  accessToken(user: string, conn: string): Promise<string | null>;    // null = 토큰 없음·invalid_grant(연결은 reauth_required 로), RpcError = RPC/DB 실패, 그 밖의 던짐 = 갱신 일시 오류
  api(accessToken: string): GmailReadApi;
  takeUnits(user: string, units: number): Promise<boolean>;           // 0030 gmail_take_units — 거절 false, RPC 실패·1초 초과는 던짐(fail-closed)
  tokenKey(): Promise<CryptoKey>;                                      // MAIL_READ_KEY(형식 오류면 key_invalid 로 거절된 Promise)
  budget: BudgetDeps;
  summarize(i: SummaryInput, onUsage: (u: TokenUsage | null) => void): Promise<SummaryOutput>;
  audit(user: string, targetHex: string): Promise<void>;               // 0032 audit_mail_read
  sleep(ms: number): Promise<void>;
  now(): number;                                                       // 벽시계 ms(토큰 만료·검색 예산·elapsed)
  today(): string;                                                     // 서울 YYYY-MM-DD
};
export type Ctx = { user: string; request_id: string; t0: number };
// RPC 실패: 메시지는 함수 이름·SQLSTATE 뿐이라 로그에 남긴다
export class RpcError extends Error { constructor(fn: string, code: string) { super(fn + " " + code); this.name = "RpcError"; } }
export class RateLimited extends Error { constructor() { super("units"); this.name = "RateLimited"; } }
export class SearchTimeout extends Error { constructor() { super("search_budget"); this.name = "SearchTimeout"; } }
export class SummaryFailed extends Error { constructor(readonly why: string) { super("summary_failed " + why); this.name = "SummaryFailed"; } }

export const err = (status: number, code: string, extra: Record<string, unknown> = {}) => Response.json({ error: code, ...extra }, { status });
export const log = (o: Record<string, unknown>) => console.log(JSON.stringify({ mail_read: o.stage, ...o }));
const ms = (ctx: Ctx, d: MailReadDeps) => Math.round(d.now() - ctx.t0);

export async function connectionFor(ctx: Ctx, d: MailReadDeps, stage: string): Promise<MailReadConnection | Response> {
  const c = await d.connection(ctx.user);
  if (!c) { log({ stage, request_id: ctx.request_id, result: "no_connection", elapsed_ms: ms(ctx, d) }); return err(404, "no_connection"); }
  if (c.status !== "active") { log({ stage, request_id: ctx.request_id, result: "reauth_required", elapsed_ms: ms(ctx, d) }); return err(409, "reauth_required"); }
  return c;
}
export async function accessFor(ctx: Ctx, c: MailReadConnection, d: MailReadDeps, stage: string): Promise<string | Response> {
  let at: string | null;
  try { at = await d.accessToken(ctx.user, c.connection_id); }
  catch (e) {
    if (e instanceof RpcError) throw e;                                  // RPC/DB 실패 → failure 의 500 internal(로그 = 함수 이름·SQLSTATE, 스펙 §7)
    if (e instanceof ReauthRequired) { log({ stage, request_id: ctx.request_id, result: "reauth_required", elapsed_ms: ms(ctx, d) }); return err(409, "reauth_required"); }
    log({ stage, request_id: ctx.request_id, result: "token_error", elapsed_ms: ms(ctx, d) });
    return err(502, "gmail_upstream");                                   // Google 토큰 엔드포인트 일시 오류
  }
  if (!at) { log({ stage, request_id: ctx.request_id, result: "reauth_required", elapsed_ms: ms(ctx, d) }); return err(409, "reauth_required"); }
  return at;
}
