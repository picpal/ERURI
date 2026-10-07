import { applyRules } from "./rules.ts";

// Gmail API 얇은 래퍼. 오류 메시지에는 상태 코드만 담는다(토큰·본문 금지)
const G = "https://gmail.googleapis.com/gmail/v1/users/me";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
export class ReauthRequired extends Error {}
// Gmail API가 2xx가 아닌 상태를 돌려줌. 메시지는 "<호출> <상태>"만(토큰·본문 없음). reasons = 오류 본문의 reason 코드(메일 정리 쓰기 경로만 채운다)
export class GmailHttpError extends Error {
  constructor(readonly call: string, readonly status: number, readonly reasons: string[] = []) { super(`${call} ${status}`); this.name = "GmailHttpError"; }
}
export const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
export const GMAIL_MODIFY_SCOPE = "https://www.googleapis.com/auth/gmail.modify";   // 메일 정리(스펙 §7): 읽기·라벨·휴지통, 영구 삭제 불가

// OAuth 코드 교환·갱신은 Web 클라이언트(시크릿 보유)로 한다. iOS는 serverClientID = Web 클라이언트 ID로 serverAuthCode를 받는다
function webClient() {
  return { client_id: Deno.env.get("GOOGLE_WEB_CLIENT_ID") ?? "", client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "" };
}

export type TokenResponse = { access_token: string; refresh_token?: string; expires_in: number; scope?: string };
export async function exchangeCode(code: string): Promise<TokenResponse> {
  const r = await fetch(TOKEN_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, ...webClient(), grant_type: "authorization_code", redirect_uri: "" }) });
  if (!r.ok) {
    const j = await r.json().catch(() => ({})) as { error?: string };
    throw new Error("token exchange " + r.status + " " + (j.error ?? ""));
  }
  return await r.json() as TokenResponse;
}
// 토큰(보통 refresh token) 폐기. 같은 동의(grant)의 토큰이 모두 무효가 되고 다음 로그인에서 동의 화면이 다시 뜬다
export async function revokeToken(token: string): Promise<void> {
  const r = await fetch("https://oauth2.googleapis.com/revoke", { method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token }) });
  await r.body?.cancel();
  if (!r.ok) throw new Error("revoke " + r.status);
}
export async function refreshAccessToken(refreshToken: string, timeoutMs?: number): Promise<string> {
  const r = await fetch(TOKEN_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ refresh_token: refreshToken, ...webClient(), grant_type: "refresh_token" }),
    ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}) });
  if (!r.ok) {
    const j = await r.json().catch(() => ({})) as { error?: string };
    if (j.error === "invalid_grant") throw new ReauthRequired("invalid_grant");   // 테스트 모드 7일 만료·동의 철회
    throw new Error("token refresh " + r.status + " " + (j.error ?? ""));
  }
  return (await r.json() as { access_token: string }).access_token;
}
export async function watch(accessToken: string, topic: string) {
  const r = await fetch(`${G}/watch`, { method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ topicName: topic, labelFilterBehavior: "EXCLUDE", labelIds: ["CATEGORY_PROMOTIONS"] }) });
  if (!r.ok) { await r.body?.cancel(); throw new GmailHttpError("watch", r.status); }
  return await r.json() as { historyId: string; expiration: string };   // expiration: epoch ms 문자열, 약 7일 뒤
}
export async function profile(accessToken: string) {
  const r = await fetch(`${G}/profile`, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!r.ok) { await r.body?.cancel(); throw new GmailHttpError("profile", r.status); }
  return await r.json() as { emailAddress: string; historyId: string };
}
export async function listMessageIds(accessToken: string, q: string, pageToken?: string) {
  const u = new URL(`${G}/messages`); u.searchParams.set("q", q); u.searchParams.set("maxResults", "100");
  if (pageToken) u.searchParams.set("pageToken", pageToken);
  const r = await fetch(u, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!r.ok) { await r.body?.cancel(); throw new GmailHttpError("messages.list", r.status); }
  return await r.json() as { messages?: { id: string }[]; nextPageToken?: string };
}
type HistoryPage = { history?: { messagesAdded?: { message: { id: string } }[] }[]; nextPageToken?: string; historyId: string };
export async function history(accessToken: string, startHistoryId: string, pageToken?: string): Promise<{ notFound: true } | HistoryPage> {
  const u = new URL(`${G}/history`); u.searchParams.set("startHistoryId", startHistoryId); u.searchParams.set("historyTypes", "messageAdded");
  if (pageToken) u.searchParams.set("pageToken", pageToken);
  const r = await fetch(u, { headers: { authorization: `Bearer ${accessToken}` } });
  if (r.status === 404) { await r.body?.cancel(); return { notFound: true }; }
  if (!r.ok) { await r.body?.cancel(); throw new GmailHttpError("history", r.status); }
  return await r.json() as HistoryPage;
}
export type MessagePart = { mimeType?: string; filename?: string; headers?: { name: string; value: string }[]; body?: { data?: string; attachmentId?: string }; parts?: MessagePart[] };
type Part = MessagePart;
export type GmailMessage = { id: string; internalDate: string; labelIds?: string[]; payload?: Part };
export async function getMessage(accessToken: string, id: string) {
  const r = await fetch(`${G}/messages/${encodeURIComponent(id)}?format=full`, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!r.ok) { await r.body?.cancel(); throw new GmailHttpError("messages.get", r.status); }
  return await r.json() as GmailMessage;
}

// 광고 구독 해지 스캔(스펙 §7): 본문 없이 헤더만. messages.get format=metadata
export const META_HEADERS = ["From", "Subject", "List-Unsubscribe", "List-Unsubscribe-Post", "Authentication-Results", "DKIM-Signature"];
export async function getMessageMeta(accessToken: string, id: string) {
  const u = new URL(`${G}/messages/${encodeURIComponent(id)}`);
  u.searchParams.set("format", "metadata");
  for (const h of META_HEADERS) u.searchParams.append("metadataHeaders", h);
  const r = await fetch(u, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!r.ok) { await r.body?.cancel(); throw new GmailHttpError("messages.get", r.status); }
  return await r.json() as GmailMessage;
}

function b64urlDecode(s: string) {
  return new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)));
}
function findBody(p: Part | undefined, mime: string): string | null {
  if (!p) return null;
  if (p.mimeType === mime && p.body?.data && !p.filename) return b64urlDecode(p.body.data);
  for (const c of p.parts ?? []) { const r = findBody(c, mime); if (r !== null) return r; }
  return null;
}
const ENTITIES: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'" };
export function decodeEntities(s: string) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+|#39);/gi, (m, e: string) => {
    if (e[0] === "#" && e !== "#39") {
      const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}
// 첨부(filename·attachmentId)는 읽지 않는다(스펙 §12 통제 2)
export function plainText(msg: { payload?: Part }): string {
  const text = findBody(msg.payload, "text/plain");
  if (text !== null) return text.trim();
  const html = findBody(msg.payload, "text/html") ?? "";
  return decodeEntities(html.replace(/<(style|script)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ").trim();
}
export function header(msg: { payload?: Part }, name: string): string | null {
  return msg.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? null;
}

// 서버 규칙 필터(§7): /ingest와 같은 applyRules. 프로모션 라벨·(광고)·OTP는 폐기(판정은 제목+본문), 카드·계좌는 본문·제목 각각 마스킹
export type GmailItem =
  | { kind: "discard"; reason: "otp" | "promotion" | "draft" }
  | { kind: "pass"; sender: string | null; title: string | null; text: string; occurredAt: string };
export function gmailToItem(m: GmailMessage): GmailItem {
  if (m.labelIds?.includes("DRAFT")) return { kind: "discard", reason: "draft" };   // 초안은 저장마다·발송 시 id 가 바뀐다(§7)
  const sender = header(m, "From"), subject = header(m, "Subject");
  const v = applyRules(plainText(m), { sender, title: subject, labels: m.labelIds });
  if (v.kind === "discard") return v;
  return { kind: "pass", sender, title: v.maskedTitle ?? null, text: v.masked,
           occurredAt: new Date(Number(m.internalDate)).toISOString() };
}

export interface GmailApi {
  history(startHistoryId: string, pageToken?: string): Promise<{ notFound: true } | HistoryPage>;
  listMessageIds(q: string, pageToken?: string): Promise<{ messages?: { id: string }[]; nextPageToken?: string }>;
  profile(): Promise<{ emailAddress: string; historyId: string }>;
}
export interface GmailClient extends GmailApi {
  getMessage(id: string): Promise<GmailMessage>;
  getMessageMeta(id: string): Promise<GmailMessage>;
  watch(topic: string): Promise<{ historyId: string; expiration: string }>;
}
export function gmailApi(accessToken: string): GmailClient {
  return {
    history: (s, p) => history(accessToken, s, p),
    listMessageIds: (q, p) => listMessageIds(accessToken, q, p),
    profile: () => profile(accessToken),
    getMessage: (id) => getMessage(accessToken, id),
    getMessageMeta: (id) => getMessageMeta(accessToken, id),
    watch: (topic) => watch(accessToken, topic),
  };
}

// 스펙 §7: history.list 전 페이지 처리 후 커서 갱신. 404면 last_success_at - 1일부터 messages.list(after:)로 재동기화
export async function collectNewMessageIds(api: GmailApi, state: { cursor: string; lastSuccessAt: string }) {
  const ids = new Set<string>();
  let pageToken: string | undefined, cursor = state.cursor;
  do {
    const h = await api.history(state.cursor, pageToken);
    if ("notFound" in h) return await resync(api, state.lastSuccessAt);
    for (const rec of h.history ?? []) for (const m of rec.messagesAdded ?? []) ids.add(m.message.id);
    cursor = h.historyId;
    pageToken = h.nextPageToken;
  } while (pageToken);
  return { ids: [...ids], cursor, mode: "history" as const };
}
async function resync(api: GmailApi, lastSuccessAt: string) {
  const { historyId } = await api.profile();   // 목록 조회 전에 새 커서를 잡아 그 사이 도착분을 다음 history가 받게 한다
  const after = Math.floor(new Date(lastSuccessAt).getTime() / 1000) - 86400;
  const q = `after:${after} -category:promotions -in:drafts`;
  const ids = new Set<string>();
  let pageToken: string | undefined;
  do {
    const p = await api.listMessageIds(q, pageToken);
    for (const m of p.messages ?? []) ids.add(m.id);
    pageToken = p.nextPageToken;
  } while (pageToken);
  return { ids: [...ids], cursor: historyId, mode: "resync" as const };
}

// ── 메일 정리(스펙 §7 "메일 정리"): 목록·메타·라벨 변경·휴지통. 영구 삭제 API(delete·batch delete)는 두지 않는다 ──
export const MAIL_CALL_TIMEOUT_MS = 15_000;
// 403 은 쿼터일 수도 권한일 수도 있다(스펙 §7 오류 reason 분기). 새 오류 형식(error.details[].reason)도 함께 읽는다
export const QUOTA_REASONS = new Set(["rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded", "dailyLimitExceeded", "RATE_LIMIT_EXCEEDED"]);
export const SCOPE_REASONS = new Set(["insufficientPermissions", "ACCESS_TOKEN_SCOPE_INSUFFICIENT"]);
export type GmailFailure = "quota" | "scope" | "rejected" | "gone" | "unknown";
export function classifyGmailError(e: unknown): GmailFailure {
  if (!(e instanceof GmailHttpError)) return "unknown";                    // 타임아웃·연결 끊김 = 결과 불명
  if (e.status === 429) return "quota";
  if (e.status === 403) {
    if (e.reasons.some((r) => QUOTA_REASONS.has(r))) return "quota";
    if (e.reasons.some((r) => SCOPE_REASONS.has(r))) return "scope";
    return "unknown";
  }
  if (e.status === 400) return "rejected";
  if (e.status === 404) return "gone";
  return "unknown";
}
async function mailError(call: string, r: Response): Promise<GmailHttpError> {
  type Body = { error?: { errors?: { reason?: unknown }[]; details?: { reason?: unknown }[] } };
  const j = await r.json().catch(() => null) as Body | null;
  const reasons = [...(j?.error?.errors ?? []), ...(j?.error?.details ?? [])].map((x) => x?.reason)
    .filter((x): x is string => typeof x === "string" && /^[A-Za-z_]{1,64}$/.test(x)).slice(0, 5);
  return new GmailHttpError(call, r.status, reasons);
}
// timeoutMs: 기본 15초. 메일 요약 검색만 20초 예산의 남은 시간으로 줄여 넘긴다
function mailFetch(accessToken: string, url: string | URL, body?: unknown, timeoutMs = MAIL_CALL_TIMEOUT_MS): Promise<Response> {
  return fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers: { authorization: `Bearer ${accessToken}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
}
const msgUrl = (id: string, rest = "") => `${G}/messages/${encodeURIComponent(id)}${rest}`;

export type ListPage = { messages?: { id: string }[]; nextPageToken?: string; resultSizeEstimate?: number };
export async function listMessages(accessToken: string, q: string, maxResults: number, pageToken?: string, timeoutMs = MAIL_CALL_TIMEOUT_MS): Promise<ListPage> {
  const u = new URL(`${G}/messages`); u.searchParams.set("q", q); u.searchParams.set("maxResults", String(maxResults));
  if (pageToken) u.searchParams.set("pageToken", pageToken);
  const r = await mailFetch(accessToken, u, undefined, timeoutMs);
  if (!r.ok) throw await mailError("messages.list", r);
  return await r.json() as ListPage;
}
export const PREVIEW_HEADERS = ["From", "Subject"];   // 미리보기 표본: 본문 없이 헤더만
const PREVIEW_FIELDS = "id,internalDate,labelIds,payload/headers";   // format=metadata 도 snippet(본문 앞부분)을 주므로 응답 칸을 좁힌다(스펙 §12)
export async function getMessageHeaders(accessToken: string, id: string, timeoutMs = MAIL_CALL_TIMEOUT_MS): Promise<GmailMessage> {
  const u = new URL(msgUrl(id)); u.searchParams.set("format", "metadata");
  for (const h of PREVIEW_HEADERS) u.searchParams.append("metadataHeaders", h);
  u.searchParams.set("fields", PREVIEW_FIELDS);
  const r = await mailFetch(accessToken, u, undefined, timeoutMs);
  if (!r.ok) throw await mailError("messages.get", r);
  return await r.json() as GmailMessage;
}
export async function getMessageLabels(accessToken: string, id: string): Promise<{ id: string; labelIds?: string[] }> {
  const u = new URL(msgUrl(id)); u.searchParams.set("format", "minimal");
  const r = await mailFetch(accessToken, u);
  if (!r.ok) throw await mailError("messages.get", r);
  return await r.json() as { id: string; labelIds?: string[] };
}
async function post(accessToken: string, call: string, url: string, body: unknown): Promise<void> {
  const r = await mailFetch(accessToken, url, body);
  if (!r.ok) throw await mailError(call, r);
  await r.body?.cancel();
}
export const batchModify = (t: string, ids: string[], add: string[], remove: string[]) =>
  post(t, "messages.batchModify", `${G}/messages/batchModify`, { ids, addLabelIds: add, removeLabelIds: remove });
export const trashMessage = (t: string, id: string) => post(t, "messages.trash", msgUrl(id, "/trash"), {});
export const untrashMessage = (t: string, id: string) => post(t, "messages.untrash", msgUrl(id, "/untrash"), {});
export const modifyMessage = (t: string, id: string, add: string[], remove: string[]) =>
  post(t, "messages.modify", msgUrl(id, "/modify"), { addLabelIds: add, removeLabelIds: remove });

export interface GmailMailApi {
  list(q: string, maxResults: number, pageToken?: string): Promise<ListPage>;
  headers(id: string): Promise<GmailMessage>;
  labels(id: string): Promise<{ id: string; labelIds?: string[] }>;
  batchModify(ids: string[], add: string[], remove: string[]): Promise<void>;
  trash(id: string): Promise<void>;
  untrash(id: string): Promise<void>;
  modify(id: string, add: string[], remove: string[]): Promise<void>;
}
export function gmailMailApi(accessToken: string): GmailMailApi {
  return {
    list: (q, n, p) => listMessages(accessToken, q, n, p),
    headers: (id) => getMessageHeaders(accessToken, id),
    labels: (id) => getMessageLabels(accessToken, id),
    batchModify: (ids, a, r) => batchModify(accessToken, ids, a, r),
    trash: (id) => trashMessage(accessToken, id),
    untrash: (id) => untrashMessage(accessToken, id),
    modify: (id, a, r) => modifyMessage(accessToken, id, a, r),
  };
}

// ── 메일 요약(스펙 §7 "메일 요약"): 목록·메타는 메일 정리 것 그대로, 고른 한 통만 format=full. 읽기만 — 쓰기 호출 없음 ──
export async function getMessageFull(accessToken: string, id: string): Promise<GmailMessage> {
  const u = new URL(msgUrl(id)); u.searchParams.set("format", "full");
  const r = await mailFetch(accessToken, u);
  if (!r.ok) throw await mailError("messages.get", r);
  return await r.json() as GmailMessage;
}
export interface GmailReadApi {
  list(q: string, maxResults: number, pageToken?: string, timeoutMs?: number): Promise<ListPage>;   // timeoutMs = 검색 예산의 남은 시간(최대 15초)
  headers(id: string, timeoutMs?: number): Promise<GmailMessage>;
  full(id: string): Promise<GmailMessage>;
}
export function gmailReadApi(accessToken: string): GmailReadApi {
  return {
    list: (q, n, p, t) => listMessages(accessToken, q, n, p, t),
    headers: (id, t) => getMessageHeaders(accessToken, id, t),
    full: (id) => getMessageFull(accessToken, id),
  };
}
