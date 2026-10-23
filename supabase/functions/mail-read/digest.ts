import { type HoldReservation, type LedgerLine, ledgerLine } from "../_shared/budget.ts";
import { classifyGmailError, GmailHttpError, type GmailMessage, header } from "../_shared/gmail.ts";
import { llmUnavailable } from "../_shared/llm-errors.ts";
import { clipText, DIGEST_SCAN_MAX, extractBody, SUMMARY_BODY_MAX } from "../_shared/mail-body.ts";
import { clip16 } from "../_shared/mail-meta.ts";
import { signToken, TOKEN_MAX, TOKEN_TTL_S, type TokenClaims, verifyToken } from "../_shared/mail-token.ts";
import { maskMail } from "../_shared/rules.ts";
import { accessFor, connectionFor, type Ctx, err, log, type MailReadDeps, RpcError } from "./common.ts";
import { BUSY_RETRY_MS, seoulIso, sha256Hex } from "./read.ts";
import { digestEstKrw, SUMMARY_MODEL } from "./summary.ts";

// 목록 요약(스펙 §7 "여러 통 — 목록 요약", 0.19.0): 후보 토큰 ≤ 10 → 줄마다 토큰 검사(남의 토큰은 그 줄만 rejected) → 예약(hold, chat, 유효 수 × 단가) →
// 슬롯(150초 임대) → units 유효 × 20 → 토큰 갱신 → 메일마다(동시 5): full(15초) → 감사 → SPAM·TRASH → 추출(200,000자)·통합 가림·12,000자 → 짧은 모드(20초).
// 예약 RPC 직후부터 하나의 정리 범위: 어떤 끝이든 같은 hold 로 정산 한 번·슬롯 반납(DP25·DP26). deadline = 요청 받은 때 + 100초(사전 단계 포함, DP27).
// 첫 OpenAI 사용 불가 = 전체 중단(새 통 X → 취소 → 대기 → 정산 1회 → 반납 → 503). 입력 순서 유지. 본문·요약 줄은 로그에 없다(§12)
export const DIGEST_LIMITS = { deadlineMs: 100_000, rpcMs: 5_000, gmailMs: 15_000, modelMs: 20_000, parallel: 5, slotSeconds: 150 };
export type DigestLimits = typeof DIGEST_LIMITS;
export const DIGEST_TOKENS_MAX = 10;
export type DigestLine = { status: "ok" | "failed" | "expired" | "rejected"; token: string | null; lines: string[]; note: "otp" | "no_body" | null; code: string | null };
const GONE = ["SPAM", "TRASH"];
const line = (status: DigestLine["status"], o: Partial<DigestLine> = {}): DigestLine => ({ status, token: null, lines: [], note: null, code: null, ...o });

export async function withTimeout<T>(p: Promise<T>, ms: number, fn: string): Promise<T> {
  let t: number | undefined;
  try { return await Promise.race([p, new Promise<T>((_, rej) => { t = setTimeout(() => rej(new RpcError(fn, "timeout")), ms); })]); }
  finally { clearTimeout(t); }
}

export async function digest(ctx: Ctx, body: Record<string, unknown>, d: MailReadDeps, lim: DigestLimits = DIGEST_LIMITS): Promise<Response> {
  const stage = "digest", rid = ctx.request_id, ms = () => Math.round(d.now() - ctx.t0);
  const deadline = ctx.t0 + lim.deadlineMs;                              // 요청을 받은 때부터(DP27 — 연결·예약·슬롯·토큰 갱신도 이 안)
  const left = () => deadline - d.now();
  const pre = <T>(p: Promise<T>, fn: string) => withTimeout(p, Math.max(1, Math.min(lim.rpcMs, left())), fn);   // 통 처리 전 RPC = min(5초, 남은 시간)
  const tidy = <T>(p: Promise<T>, fn: string) => withTimeout(p, lim.rpcMs, fn);                                   // 정리 = deadline 뒤에도 각 5초
  const tokens = body.tokens;
  if (!Array.isArray(tokens) || tokens.length < 1 || tokens.length > DIGEST_TOKENS_MAX || tokens.some((t) => typeof t !== "string" || t.length > TOKEN_MAX) ||
      new Set(tokens).size !== tokens.length) {
    log({ stage, request_id: rid, result: "bad_request", elapsed_ms: ms() });
    return err(400, "bad_request");
  }
  const key = await d.tokenKey();
  const conn = await connectionFor(ctx, { ...d, connection: (u) => pre(d.connection(u), "mail_connection") }, stage);
  if (conn instanceof Response) return conn;
  const nowS = Math.floor(d.now() / 1000);
  const results: DigestLine[] = [];
  const work: { i: number; claims: TokenClaims }[] = [];
  for (const [i, t] of (tokens as string[]).entries()) {
    const v = await verifyToken(key, t, nowS);
    if (!v.ok) results[i] = line(v.code === "token_expired" ? "expired" : "rejected");
    else if (v.claims.u !== ctx.user || v.claims.c !== conn.connection_id) results[i] = line("rejected");
    else work.push({ i, claims: v.claims });
  }
  if (work.length === 0) { log({ stage, request_id: rid, result: "ok", n: tokens.length, ok: 0, elapsed_ms: ms() }); return Response.json({ results }); }

  const est = digestEstKrw(work.length), hold = crypto.randomUUID();     // hold = 예약 식별자 = 슬롯 holder(DP25)
  const sign = (c: TokenClaims) => signToken(key, { ...c, e: Math.floor(d.now() / 1000) + TOKEN_TTL_S });
  const ledger: LedgerLine[] = [];
  const stop = new AbortController();                                    // 중단(사용 불가)·deadline 이 진행 중 호출을 모두 취소한다
  const timer = setTimeout(() => stop.abort(new DOMException("deadline", "TimeoutError")), Math.max(0, left()));
  let res: HoldReservation | null = null, slot: number | null = null, slotCall: Promise<number | null> | null = null;
  let unavailable: string | null = null;
  try {                                                                  // 예약 RPC 를 부른 직후부터 하나의 정리 범위(Codex 0.19.0 계획 리뷰 #2)
    res = await pre(d.holds.reserve(ctx.user, hold, "chat", est), "reserve_usage_hold");
    if (res.level === "refused") { log({ stage, request_id: rid, result: "budget_exhausted", elapsed_ms: ms() }); return err(429, "budget_exhausted"); }
    if (res.level === "cancelled") throw new RpcError("reserve_usage_hold", "cancelled");   // 새 UUID 라 생기지 않는다 — 생기면 500
    for (let attempt = 0; ; attempt++) {
      slotCall = d.budget.acquire(ctx.user, hold, lim.slotSeconds);
      slot = await pre(slotCall, "acquire_llm_slot");                   // 던지면 slot null·slotCall 이 남아 finally 가 "결과 모름"으로 정리(DP26)
      slotCall = null;
      if (slot !== null || attempt >= BUSY_RETRY_MS.length) break;
      await d.sleep(BUSY_RETRY_MS[attempt]);
    }
    if (slot === null) {
      log({ stage, request_id: rid, result: "llm_busy", elapsed_ms: ms() });
      return Response.json({ error: "llm_busy" }, { status: 503, headers: { "retry-after": "30" } });
    }
    if (!(await d.takeUnits(ctx.user, 20 * work.length))) { log({ stage, request_id: rid, result: "gmail_rate_limited", elapsed_ms: ms() }); return err(429, "gmail_rate_limited"); }
    const at = await accessFor(ctx, conn, d, stage, { rpcMs: lim.rpcMs, deadline });   // 토큰 갱신 안 RPC 도 제한(DP27)
    if (at instanceof Response) return at;
    const api = d.api(at);
    const one = async ({ claims }: { claims: TokenClaims }): Promise<DigestLine> => {
      if (stop.signal.aborted) return line("failed", { code: "gmail_upstream" });
      let m: GmailMessage;
      try { m = await api.full(claims.m, lim.gmailMs, stop.signal); }
      catch (e) {
        if (e instanceof GmailHttpError && e.status === 404) return line("failed", { code: "mail_gone" });
        return line("failed", { code: !stop.signal.aborted && classifyGmailError(e) === "quota" ? "gmail_rate_limited" : "gmail_upstream" });
      }
      try { await withTimeout(d.audit(ctx.user, await sha256Hex(claims.m)), lim.rpcMs, "audit_mail_read"); }   // 본문을 받았으면 상태·라벨과 무관하게 1회(Codex #6)
      catch { return line("failed", { code: "internal" }); }
      if ((m.labelIds ?? []).some((l) => GONE.includes(l))) return line("failed", { code: "mail_gone" });
      const b = extractBody(m.payload, DIGEST_SCAN_MAX);
      if (b.text === null) return line("ok", { token: await sign(claims), note: "no_body" });
      const mm = maskMail(header(m, "Subject") ?? "", b.text);
      if (mm.otp) return line("ok", { token: await sign(claims), note: "otp" });
      if (stop.signal.aborted) return line("failed", { code: "summary_failed" });
      try {
        const lines = await d.summarizeDigest({ today: d.today(), from: clip16(header(m, "From") ?? "", 200), date: seoulIso(m.internalDate), subject: mm.title,
          body: clipText(mm.body, SUMMARY_BODY_MAX).text }, (u) => ledger.push(ledgerLine("mail_digest", SUMMARY_MODEL, u)), stop.signal, lim.modelMs);
        return line("ok", { token: await sign(claims), lines });
      } catch (e) {
        const why = llmUnavailable(e);
        if (why && !unavailable) { unavailable = why; stop.abort(new DOMException("llm_unavailable", "AbortError")); }   // ① 새 통 중지 ② 진행 중 취소
        return line("failed", { code: "summary_failed" });
      }
    };
    let next = 0;
    const worker = async () => { while (next < work.length && !(unavailable)) { const w = work[next++]; results[w.i] = await one(w); } };
    await Promise.allSettled(Array.from({ length: Math.min(lim.parallel, work.length) }, worker));   // ③ 진행 중이던 작업이 모두 끝나기를 기다린다
    for (const w of work) results[w.i] ??= line("failed", { code: "gmail_upstream" });   // deadline·중단으로 시작하지 못한 통
    if (!unavailable) for (const w of work) if (results[w.i].token === null) results[w.i] = { ...results[w.i], token: await sign(w.claims) };   // failed 줄도 새 토큰(DP28)
  } finally {
    clearTimeout(timer);
    try {
      if (res?.level !== "refused") await tidy(d.holds.settle(ctx.user, hold, [...ledger]), "settle_usage_hold");   // ④ 한 번 — 예약 결과를 몰라도 같은 hold 로(보상)
    } finally {
      if (slot !== null) await tidy(d.budget.release(ctx.user, slot, hold), "release_llm_slot");                     // ⑤ 반납(정산 실패여도)
      else if (slotCall) {                                               // 슬롯 결과 모름: 늦게 잡힌 자리는 응답이 오면 반납 + 지금 holder 로 두 자리 반납(DP26)
        slotCall.then((s) => (s !== null ? d.budget.release(ctx.user, s, hold) : undefined)).catch(() => {});
        await Promise.allSettled([1, 2].map((s) => tidy(d.budget.release(ctx.user, s, hold), "release_llm_slot")));
      }
    }
  }
  const count = (s: string) => results.filter((x) => x.status === s).length;
  if (unavailable) { log({ stage, request_id: rid, result: "llm_unavailable", reason: unavailable, elapsed_ms: ms() }); return err(503, "llm_unavailable"); }   // ⑥
  log({ stage, request_id: rid, result: "ok", n: tokens.length, ok: count("ok"), failed: count("failed"), expired: count("expired"), rejected: count("rejected"),
    notes: results.filter((x) => x.note).length, model: SUMMARY_MODEL, elapsed_ms: ms() });
  return Response.json({ results });
}
