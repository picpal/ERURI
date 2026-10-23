import { Deferred } from "../_shared/budget.ts";
import { classifyGmailError, GmailHttpError } from "../_shared/gmail.ts";
import { llmUnavailable } from "../_shared/llm-errors.ts";
import { type Ctx, CursorStale, err, log, type MailReadDeps, RateLimited, RpcError, SearchTimeout, SummaryFailed } from "./common.ts";
import { digest, DIGEST_LIMITS, type DigestLimits, withTimeout } from "./digest.ts";
import { read } from "./read.ts";
import { search } from "./search.ts";

// 메일 요약(스펙 §7 "메일 요약"): POST /mail-read/search·/mail-read/read·/mail-read/digest. 사용자 JWT 로만 user_id 를 정한다(§12 통제 4). Gmail 을 바꾸지 않는다.
// 검사 순서(계획 D5): 401 → 경로 404 → 405 → 플래그 503 → JSON 400 → 각 단계(search.ts·read.ts·digest.ts). lim 은 digest 한도(테스트만 작은 값, DP9)
export async function handleMailRead(req: Request, d: MailReadDeps, lim: DigestLimits = DIGEST_LIMITS): Promise<Response> {
  const ctx0 = { request_id: crypto.randomUUID(), t0: d.now() };
  const route = new URL(req.url).pathname.match(/\/mail-read\/(search|read|digest)\/?$/)?.[1];
  const token = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  let user: string | null;
  try { user = token ? await (route === "digest" ? withTimeout(d.authUser(token), lim.rpcMs, "auth_get_user") : d.authUser(token)) : null; }
  catch (e) { return failure(e, route ?? "auth", { user: "", ...ctx0 }, d.now() - ctx0.t0); }   // digest 인증 5초 초과 → 500 internal(DP10)
  if (!user) return new Response(null, { status: 401 });
  if (!route) return err(404, "not_found");
  if (req.method !== "POST") return new Response(null, { status: 405 });
  if (!d.enabled()) return err(503, "disabled");
  let body: unknown;
  try { body = await req.json(); } catch { return err(400, "bad_json"); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return err(400, "bad_json");
  const ctx: Ctx = { user, ...ctx0 };
  try {
    const b = body as Record<string, unknown>;
    return route === "search" ? await search(ctx, b, d) : route === "read" ? await read(ctx, b, d) : await digest(ctx, b, d, lim);
  } catch (e) {
    return failure(e, route, ctx, d.now() - ctx.t0);
  }
}

// 예외 → 상태·코드(스펙 §7 "오류 코드"). 429·503 은 뜻이 둘이라 앱은 error 로 가른다
export function failure(e: unknown, stage: string, ctx: Ctx, elapsed: number): Response {
  const done = (status: number, code: string, extra: Record<string, unknown> = {}) => {
    log({ stage, request_id: ctx.request_id, result: code, elapsed_ms: Math.round(elapsed), ...extra });
    return status === 503 && code !== "llm_unavailable" ? Response.json({ error: code }, { status, headers: { "retry-after": "30" } }) : err(status, code);
  };
  const unavailable = llmUnavailable(e);                                  // 키 무효·권한·쿼터(0.16.1): 다시 해도 같다 — retry-after 없음, 사유만 로그
  if (unavailable) return done(503, "llm_unavailable", { reason: unavailable });
  if (e instanceof RateLimited) return done(429, "gmail_rate_limited", { why: "units" });
  if (e instanceof SearchTimeout) return done(502, "gmail_upstream", { why: "search_budget" });
  if (e instanceof CursorStale) return done(410, "token_expired", { why: "page_token" });
  if (e instanceof SummaryFailed) return done(502, "summary_failed", { why: e.why });
  if (e instanceof Deferred) return e.message === "budget_exhausted" ? done(429, "budget_exhausted") : done(503, "llm_busy");
  // Gmail HTTP 오류·타임아웃·연결 오류(fetch TypeError) — 모델 쪽 오류는 read.ts 가 SummaryFailed 로 감싸 여기 오지 않는다
  if (e instanceof GmailHttpError || (e instanceof Error && (e.name === "TimeoutError" || e.name === "TypeError"))) {
    const k = classifyGmailError(e);
    const [status, code]: [number, string] = k === "quota" ? [429, "gmail_rate_limited"] : k === "scope" ? [403, "scope_missing"]
      : e instanceof GmailHttpError && e.status === 401 ? [409, "reauth_required"] : [502, "gmail_upstream"];
    return done(status, code, { google_status: e instanceof GmailHttpError ? e.status : e.name });
  }
  if (e instanceof Error && e.message === "key_invalid") return done(500, "internal", { why: "key_invalid" });
  return done(500, "internal", { error: e instanceof RpcError ? e.message : e instanceof Error ? e.name : "unknown" });   // RPC 외 메시지는 남기지 않는다
}
