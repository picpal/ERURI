import { applyRules } from "./rules.ts";

// Gmail API 얇은 래퍼. 오류 메시지에는 상태 코드만 담는다(토큰·본문 금지)
const G = "https://gmail.googleapis.com/gmail/v1/users/me";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
export class ReauthRequired extends Error {}

// OAuth 코드 교환·갱신은 Web 클라이언트(시크릿 보유)로 한다. iOS는 serverClientID = Web 클라이언트 ID로 serverAuthCode를 받는다
function webClient() {
  return { client_id: Deno.env.get("GOOGLE_WEB_CLIENT_ID") ?? "", client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "" };
}

export type TokenResponse = { access_token: string; refresh_token?: string; expires_in: number };
export async function exchangeCode(code: string): Promise<TokenResponse> {
  const r = await fetch(TOKEN_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, ...webClient(), grant_type: "authorization_code", redirect_uri: "" }) });
  if (!r.ok) {
    const j = await r.json().catch(() => ({})) as { error?: string };
    throw new Error("token exchange " + r.status + " " + (j.error ?? ""));
  }
  return await r.json() as TokenResponse;
}
export async function refreshAccessToken(refreshToken: string): Promise<string> {
  const r = await fetch(TOKEN_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ refresh_token: refreshToken, ...webClient(), grant_type: "refresh_token" }) });
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
  if (!r.ok) throw new Error("watch " + r.status);
  return await r.json() as { historyId: string; expiration: string };   // expiration: epoch ms 문자열, 약 7일 뒤
}
export async function profile(accessToken: string) {
  const r = await fetch(`${G}/profile`, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!r.ok) throw new Error("profile " + r.status);
  return await r.json() as { emailAddress: string; historyId: string };
}
export async function listMessageIds(accessToken: string, q: string, pageToken?: string) {
  const u = new URL(`${G}/messages`); u.searchParams.set("q", q); u.searchParams.set("maxResults", "100");
  if (pageToken) u.searchParams.set("pageToken", pageToken);
  const r = await fetch(u, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!r.ok) throw new Error("messages.list " + r.status);
  return await r.json() as { messages?: { id: string }[]; nextPageToken?: string };
}
type HistoryPage = { history?: { messagesAdded?: { message: { id: string } }[] }[]; nextPageToken?: string; historyId: string };
export async function history(accessToken: string, startHistoryId: string, pageToken?: string): Promise<{ notFound: true } | HistoryPage> {
  const u = new URL(`${G}/history`); u.searchParams.set("startHistoryId", startHistoryId); u.searchParams.set("historyTypes", "messageAdded");
  if (pageToken) u.searchParams.set("pageToken", pageToken);
  const r = await fetch(u, { headers: { authorization: `Bearer ${accessToken}` } });
  if (r.status === 404) { await r.body?.cancel(); return { notFound: true }; }
  if (!r.ok) throw new Error("history " + r.status);
  return await r.json() as HistoryPage;
}
type Part = { mimeType?: string; filename?: string; headers?: { name: string; value: string }[]; body?: { data?: string; attachmentId?: string }; parts?: Part[] };
export type GmailMessage = { id: string; internalDate: string; labelIds?: string[]; payload?: Part };
export async function getMessage(accessToken: string, id: string) {
  const r = await fetch(`${G}/messages/${encodeURIComponent(id)}?format=full`, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!r.ok) throw new Error("messages.get " + r.status);
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
function decodeEntities(s: string) {
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
  | { kind: "discard"; reason: "otp" | "promotion" }
  | { kind: "pass"; sender: string | null; title: string | null; text: string; occurredAt: string };
export function gmailToItem(m: GmailMessage): GmailItem {
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
  watch(topic: string): Promise<{ historyId: string; expiration: string }>;
}
export function gmailApi(accessToken: string): GmailClient {
  return {
    history: (s, p) => history(accessToken, s, p),
    listMessageIds: (q, p) => listMessageIds(accessToken, q, p),
    profile: () => profile(accessToken),
    getMessage: (id) => getMessage(accessToken, id),
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
  const q = `after:${after} -category:promotions`;
  const ids = new Set<string>();
  let pageToken: string | undefined;
  do {
    const p = await api.listMessageIds(q, pageToken);
    for (const m of p.messages ?? []) ids.add(m.id);
    pageToken = p.nextPageToken;
  } while (pageToken);
  return { ids: [...ids], cursor: historyId, mode: "resync" as const };
}
