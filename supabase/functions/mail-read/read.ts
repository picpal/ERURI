import { Deferred, guarded } from "../_shared/budget.ts";
import { type GmailMessage, GmailHttpError, header } from "../_shared/gmail.ts";
import { clipText, extractBody, SUMMARY_BODY_MAX, TRANSLATE_SOURCE_MAX } from "../_shared/mail-body.ts";
import { candidateMeta, clip16 } from "../_shared/mail-meta.ts";
import { signToken, TOKEN_TTL_S, verifyToken } from "../_shared/mail-token.ts";
import { maskMail } from "../_shared/rules.ts";
import { accessFor, connectionFor, type Ctx, err, log, type MailReadDeps, RateLimited, SummaryFailed } from "./common.ts";
import { finishSummary, SUMMARY_MODEL, type SummaryInput, type SummaryOutput, summaryEstKrw } from "./summary.ts";

// 읽기(스펙 §7 "읽기"): 플래그 → 토큰(형식 400·서명 404·만료 410) → request·translate(400) → 연결(404·409) → 토큰 주인·연결(404) → 토큰 갱신
// → units 20 → messages.get(full, 404 → mail_gone) → 감사(D7) → SPAM·TRASH → 본문 추출 → 제목+본문 통합 가림 → 12,000자 → 모델 → 새 토큰.
// 원문은 이 요청 동안 Edge 메모리에만 — 저장·로그 없음(§12)
export const REQUEST_MAX = 500;
export const BUSY_RETRY_MS = [1000, 2000];                               // chat 과 같다 — 그래도 없으면 503 llm_busy
const GONE = ["SPAM", "TRASH"];

async function sha256Hex(s: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))), (b) => b.toString(16).padStart(2, "0")).join("");
}
function seoulIso(internalDate: string | undefined): string {
  const t = Number(internalDate || NaN);
  return Number.isFinite(t) ? new Date(t + 9 * 3600_000).toISOString().slice(0, 19) + "+09:00" : "";
}

// 예약 chat · 집계 mail_summary(스펙 §13 표). 모델 쪽 오류는 무엇이든 SummaryFailed(502) — Gmail 오류 분기로 새지 않게(D9)
async function summarizeGuarded(user: string, input: SummaryInput, translate: boolean, d: MailReadDeps): Promise<SummaryOutput> {
  for (let attempt = 0; ; attempt++) {
    try {
      const { value } = await guarded(d.budget, user, "chat", summaryEstKrw(translate), crypto.randomUUID(), async (_lv, bill) => {
        try { return await d.summarize(input, (u) => bill("mail_summary", SUMMARY_MODEL, u)); }
        catch (e) { throw e instanceof SummaryFailed ? e : new SummaryFailed(e instanceof Error ? e.name : "unknown"); }
      });
      return value;
    } catch (e) {
      if (!(e instanceof Deferred && e.message === "llm_busy" && attempt < BUSY_RETRY_MS.length)) throw e;
      await d.sleep(BUSY_RETRY_MS[attempt]);
    }
  }
}

export async function read(ctx: Ctx, body: Record<string, unknown>, d: MailReadDeps): Promise<Response> {
  const stage = "read", rid = ctx.request_id, ms = () => Math.round(d.now() - ctx.t0);
  const key = await d.tokenKey();
  const v = await verifyToken(key, body.token, Math.floor(d.now() / 1000));
  if (!v.ok) { log({ stage, request_id: rid, result: v.code, elapsed_ms: ms() }); return err(v.code === "bad_token" ? 400 : v.code === "not_found" ? 404 : 410, v.code); }
  const translate = body.translate ?? false, request = body.request;
  if (typeof translate !== "boolean" || typeof request !== "string" || request.trim() === "" || request.trim().length > REQUEST_MAX) {
    log({ stage, request_id: rid, result: "bad_request", elapsed_ms: ms() });
    return err(400, "bad_request");
  }
  const conn = await connectionFor(ctx, d, stage);
  if (conn instanceof Response) return conn;
  if (v.claims.u !== ctx.user || v.claims.c !== conn.connection_id) { log({ stage, request_id: rid, result: "not_found", elapsed_ms: ms() }); return err(404, "not_found"); }
  const at = await accessFor(ctx, conn, d, stage);
  if (at instanceof Response) return at;
  if (!(await d.takeUnits(ctx.user, 20))) throw new RateLimited();
  let m: GmailMessage;
  try { m = await d.api(at).full(v.claims.m); }
  catch (e) {
    if (e instanceof GmailHttpError && e.status === 404) { log({ stage, request_id: rid, result: "mail_gone", elapsed_ms: ms() }); return err(404, "mail_gone"); }
    throw e;
  }
  await d.audit(ctx.user, await sha256Hex(v.claims.m));                 // 본문을 받은 읽기마다 한 번(D7) — 실패면 500, 모델 없음
  if ((m.labelIds ?? []).some((l) => GONE.includes(l))) { log({ stage, request_id: rid, result: "mail_gone", elapsed_ms: ms() }); return err(404, "mail_gone"); }
  // 같은 메일, 응답 시점 + 10분 — 이어서 번역(§9). ok·ask 는 모델 응답 뒤에 서명(느린 모델이 만료를 깎지 않게, S4 리뷰)
  const sign = () => signToken(key, { ...v.claims, e: Math.floor(d.now() / 1000) + TOKEN_TTL_S });
  const meta = candidateMeta(m);
  const base = { from: meta.from, subject: meta.subject, date: meta.date, summary: null, language: "", translation: null,
    translation_truncated: false, body_truncated: false, ask: null };
  const b = extractBody(m.payload);
  if (b.text === null) {
    log({ stage, request_id: rid, result: "ok", status: "no_body", attachments: b.attachments, elapsed_ms: ms() });
    return Response.json({ status: "no_body", token: await sign(), ...base, attachments: b.attachments });
  }
  const mm = maskMail(header(m, "Subject") ?? "", b.text);              // 제목+본문 통합 판정·가림 — 자르기 전(§7, Codex #3)
  if (mm.otp) {
    log({ stage, request_id: rid, result: "ok", status: "otp", attachments: b.attachments, elapsed_ms: ms() });
    return Response.json({ status: "otp", token: await sign(), ...base, attachments: b.attachments });
  }
  const clipped = clipText(mm.body, SUMMARY_BODY_MAX);                  // 가림 뒤 자르기(12,000·4,000) — 경계에 걸친 번호도 이미 가려져 있다
  const input: SummaryInput = { today: d.today(), request: request.trim(), from: clip16(header(m, "From") ?? "", 200), date: seoulIso(m.internalDate),
    subject: mm.title, body: clipped.text, translateSource: translate ? clipText(mm.body, TRANSLATE_SOURCE_MAX).text : null };
  const fin = finishSummary(await summarizeGuarded(ctx.user, input, translate, d), { translate, bodyLen: mm.body.length });
  log({ stage, request_id: rid, result: "ok", status: fin.status, body_truncated: clipped.truncated, attachments: b.attachments, model: SUMMARY_MODEL, elapsed_ms: ms() });
  return Response.json({ token: await sign(), ...base, ...fin, subject: clip16(mm.title, 100), body_truncated: clipped.truncated, attachments: b.attachments });
}
