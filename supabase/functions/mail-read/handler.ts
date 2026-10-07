import { Deferred } from "../_shared/budget.ts";
import { classifyGmailError, GmailHttpError } from "../_shared/gmail.ts";
import { type Ctx, err, log, type MailReadDeps, RateLimited, RpcError, SearchTimeout, SummaryFailed } from "./common.ts";
import { read } from "./read.ts";
import { search } from "./search.ts";

// 메일 요약(스펙 §7 "메일 요약"): POST /mail-read/search·/mail-read/read. 사용자 JWT 로만 user_id 를 정한다(§12 통제 4). Gmail 을 바꾸지 않는다.
// 검사 순서(계획 D5): 401 → 경로 404 → 405 → 플래그 503 → JSON 400 → 각 단계(search.ts·read.ts)
export async function handleMailRead(req: Request, d: MailReadDeps): Promise<Response> {
  const ctx0 = { request_id: crypto.randomUUID(), t0: d.now() };
  const route = new URL(req.url).pathname.match(/\/mail-read\/(search|read)\/?$/)?.[1];
  const token = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  const user = token ? await d.authUser(token) : null;
  if (!user) return new Response(null, { status: 401 });
  if (!route) return err(404, "not_found");
  if (req.method !== "POST") return new Response(null, { status: 405 });
  if (!d.enabled()) return err(503, "disabled");
  let body: unknown;
  try { body = await req.json(); } catch { return err(400, "bad_json"); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return err(400, "bad_json");
  const ctx: Ctx = { user, ...ctx0 };
  try {
    return route === "search" ? await search(ctx, body as Record<string, unknown>, d) : await read(ctx, body as Record<string, unknown>, d);
  } catch (e) {
    return failure(e, route, ctx, d.now() - ctx.t0);
  }
}

// 예외 → 상태·코드(스펙 §7 "오류 코드"). 429·503 은 뜻이 둘이라 앱은 error 로 가른다
export function failure(e: unknown, stage: string, ctx: Ctx, elapsed: number): Response {
  const done = (status: number, code: string, extra: Record<string, unknown> = {}) => {
    log({ stage, request_id: ctx.request_id, result: code, elapsed_ms: Math.round(elapsed), ...extra });
    return status === 503 ? Response.json({ error: code }, { status, headers: { "retry-after": "30" } }) : err(status, code);
  };
  if (e instanceof RateLimited) return done(429, "gmail_rate_limited", { why: "units" });
  if (e instanceof SearchTimeout) return done(502, "gmail_upstream", { why: "search_budget" });
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
