import { classifyGmailError, GMAIL_MODIFY_SCOPE, GmailHttpError, type GmailMailApi, type GmailMessage, header } from "../_shared/gmail.ts";
import { buildQuery, checkConditions } from "../_shared/mail-query.ts";
import { parseFrom } from "../_shared/unsub.ts";

// 메일 정리(스펙 §7 "메일 정리"): POST /mail-action/preview·/execute·/undo, GET /mail-action/status?id=. 사용자 JWT 로만 user_id 를 정한다(§12 통제 4).
// 미리보기 글(발신자·제목·날짜)과 conditions 는 응답으로만 앱에 간다 — 저장·로그 없음. 로그는 단계·결과 코드·개수·ms 만.
// 실행·되돌리기는 늘 워커 잡(mail_action_start·undo 가 한 트랜잭션으로 상태와 잡을 넣는다) — 이 함수는 Gmail 을 바꾸지 않는다
export type Counts = { id: string; status: string; total: number; done: number; failed: number; undone: number; undo_failed: number; code: string | null; method: string | null };
export type RowResult = { result: string } & Partial<Counts>;
export type MailConnection = { connection_id: string; account_ref: string; status: string; scopes: string[] | null };
export type MailActionDeps = {
  enabled(): boolean;                                                  // MAIL_ACTIONS=on (꺼지면 preview·execute 503, undo·status 는 동작)
  authUser(token: string): Promise<string | null>;
  connection(user: string): Promise<MailConnection | null>;
  accessToken(user: string, conn: string): Promise<string | null>;    // null = 토큰 없음·invalid_grant(연결은 reauth_required 로 표시됨)
  api(accessToken: string): Pick<GmailMailApi, "list" | "headers">;
  noteUnits(user: string, units: number): Promise<void>;               // 호출 전 기록(fail-open)
  createRow(user: string, conn: string, action: string, ids: string[]): Promise<string | null>;
  start(user: string, id: string): Promise<RowResult>;
  undo(user: string, id: string): Promise<RowResult>;
  status(user: string, id: string): Promise<Counts | null>;
  kick(): void;
  now(): number;                                                       // ms(미리보기 총 예산·로그 ms)
};
export const PREVIEW_MAX = 1000, PAGE_SIZE = 500, PAGE_CAP = 5, SAMPLE = 20, SAMPLE_PARALLEL = 5;
export const PREVIEW_BUDGET_MS = 25_000;                               // 미리보기 전체(목록 6 + 표본 4묶음 × 호출 15초가 겹쳐 Edge 벽시계에 걸리지 않게, D3)
class PreviewTimeout extends Error {}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COUNT_KEYS = ["id", "status", "total", "done", "failed", "undone", "undo_failed", "code", "method"] as const;
const err = (status: number, code: string, extra: Record<string, unknown> = {}) => Response.json({ error: code, ...extra }, { status });
const log = (o: Record<string, unknown>) => console.log(JSON.stringify({ mail_action: o.stage, ...o }));
const counts = (r: Partial<Counts>) => Object.fromEntries(COUNT_KEYS.map((k) => [k, r[k] ?? null]));

export function sampleOf(m: GmailMessage) {
  const f = parseFrom(header(m, "From"));
  return { from: (f?.name || f?.address || "").slice(0, 60), subject: (header(m, "Subject") ?? "").slice(0, 100),
           date: new Date(Number(m.internalDate)).toISOString() };
}
type Sample = ReturnType<typeof sampleOf>;

export async function handleMailAction(req: Request, d: MailActionDeps): Promise<Response> {
  const t0 = d.now();
  const url = new URL(req.url);
  const route = url.pathname.match(/\/mail-action\/(preview|execute|undo|status)\/?$/)?.[1];
  const token = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  const user = token ? await d.authUser(token) : null;
  if (!user) return new Response(null, { status: 401 });
  if (!route) return err(404, "not_found");
  try {
    if (route === "status") {
      if (req.method !== "GET") return new Response(null, { status: 405 });
      const id = url.searchParams.get("id") ?? "";
      if (!UUID.test(id)) return err(400, "bad_id");
      const s = await d.status(user, id);
      return s ? Response.json(counts(s)) : err(404, "not_found");
    }
    if (req.method !== "POST") return new Response(null, { status: 405 });
    if ((route === "preview" || route === "execute") && !d.enabled()) return err(503, "disabled");
    let body: unknown;
    try { body = await req.json(); } catch { return err(400, "bad_json"); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return err(400, "bad_json");
    const conn = await d.connection(user);                             // Gmail 연결은 사용자당 1개(최신, D3)
    if (!conn) return err(404, "no_connection");
    if (!(conn.scopes ?? []).includes(GMAIL_MODIFY_SCOPE)) { log({ stage: route, result: "scope_missing" }); return err(403, "scope_missing"); }
    // 끊긴 연결: 미리보기·실행·되돌리기 모두 행을 바꾸기 전에 409(되돌리기는 한 번뿐이라 소진되지 않게 — D3, Fable N-H1)
    if (conn.status !== "active") { log({ stage: route, result: "reauth_required" }); return err(409, "reauth_required"); }
    const b = body as Record<string, unknown>;
    if (route === "preview") return await preview(user, conn, b, d, t0);
    return await startRow(user, conn, route === "execute" ? b.token : b.id, d, route === "execute" ? "execute" : "undo");
  } catch (e) {
    if (e instanceof PreviewTimeout) { log({ stage: route, result: "preview_budget" }); return err(502, "gmail_upstream"); }
    // Gmail HTTP 오류·타임아웃·연결 오류(fetch TypeError)는 Gmail 쪽 문제로 본다
    if (e instanceof GmailHttpError || (e instanceof Error && (e.name === "TimeoutError" || e.name === "TypeError"))) {
      const k = classifyGmailError(e);
      const [status, code]: [number, string] = k === "quota" ? [429, "gmail_rate_limited"] : k === "scope" ? [403, "scope_missing"]
        : e instanceof GmailHttpError && e.status === 401 ? [409, "reauth_required"] : [502, "gmail_upstream"];
      log({ stage: route, result: code, google_status: e instanceof GmailHttpError ? e.status : e.name });
      return err(status, code);
    }
    log({ stage: route, result: "internal", error: e instanceof Error ? e.name : "unknown" });   // 메시지는 남기지 않는다
    return err(500, "internal");
  }
}

// 토큰: null = 토큰 없음·invalid_grant(연결은 reauth_required 로 표시됨) → 409, 던짐 = 갱신 일시 오류 → 502(D3)
async function accessFor(user: string, conn: MailConnection, d: MailActionDeps, stage: string): Promise<string | Response> {
  let at: string | null;
  try { at = await d.accessToken(user, conn.connection_id); }
  catch { log({ stage, result: "token_error" }); return err(502, "gmail_upstream"); }
  if (!at) { log({ stage, result: "reauth_required" }); return err(409, "reauth_required"); }
  return at;
}

async function preview(user: string, conn: MailConnection, body: Record<string, unknown>, d: MailActionDeps, t0: number): Promise<Response> {
  const chk = checkConditions(body);                                   // 앱이 보낸 칸도 믿지 않는다 — 검사·정제는 여기 한 곳
  if (!chk.ok) {
    log({ stage: "preview", result: chk.code });
    return chk.code === "needs_target" ? err(400, "needs_target") : err(400, "bad_condition", { fields: chk.fields });
  }
  const at = await accessFor(user, conn, d, "preview");
  if (at instanceof Response) return at;
  const over = () => { if (d.now() - t0 > PREVIEW_BUDGET_MS) throw new PreviewTimeout(); };   // Gmail 호출 직전마다
  const api = d.api(at), c = chk.c, q = buildQuery(c);
  const ids: string[] = [], seen = new Set<string>();
  let pageToken: string | undefined, pages = 0, estimate = 0, complete = false;
  do {
    over();
    await d.noteUnits(user, 5);
    const p = await api.list(q, PAGE_SIZE, pageToken);
    if (pages++ === 0) estimate = p.resultSizeEstimate ?? 0;
    let dropped = false;
    for (const m of p.messages ?? []) {
      if (seen.has(m.id)) continue;
      if (ids.length >= PREVIEW_MAX) { dropped = true; break; }
      seen.add(m.id); ids.push(m.id);
    }
    pageToken = p.nextPageToken;
    complete = !pageToken && !dropped;
  } while (pageToken && ids.length < PREVIEW_MAX && pages < PAGE_CAP);
  over();
  await d.noteUnits(user, 5);
  const starred = (await api.list(buildQuery(c, true), 1)).resultSizeEstimate ?? 0;   // 별표 수도 추정치("별표 약 M건")
  const head = ids.slice(0, SAMPLE);
  if (head.length) await d.noteUnits(user, 20 * head.length);
  const sample = await samples(api, head, over);
  const base = { action: c.action, conditions: c, count: ids.length, exact: complete,
    total_estimate: complete ? ids.length : Math.max(estimate, ids.length), starred_estimate: starred, has_more: !complete, sample };
  const ms = Math.round(d.now() - t0);
  if (ids.length === 0) { log({ stage: "preview", result: "empty", pages, ms }); return Response.json({ token: null, ...base }); }
  const id = await d.createRow(user, conn.connection_id, c.action, ids);
  if (!id) return err(404, "no_connection");                           // 연결이 그사이 지워졌다
  log({ stage: "preview", result: "ok", count: ids.length, exact: complete, pages, ms });
  return Response.json({ token: id, ...base });
}

async function samples(api: Pick<GmailMailApi, "headers">, ids: string[], over: () => void): Promise<Sample[]> {
  const out: (Sample | null)[] = ids.map(() => null);
  for (let i = 0; i < ids.length; i += SAMPLE_PARALLEL) {
    over();
    await Promise.all(ids.slice(i, i + SAMPLE_PARALLEL).map(async (id, k) => {
      try { out[i + k] = sampleOf(await api.headers(id)); }
      catch (e) { if (!(e instanceof GmailHttpError && e.status === 404)) throw e; }   // 그사이 지워진 표본만 뺀다
    }));
  }
  return out.filter((x): x is Sample => x !== null);
}

async function startRow(user: string, conn: MailConnection, raw: unknown, d: MailActionDeps, stage: "execute" | "undo"): Promise<Response> {
  const id = typeof raw === "string" && UUID.test(raw) ? raw : null;   // 저장된 id 만 실행한다 — 요청의 다른 칸(ids·검색어)은 읽지 않는다
  if (!id) return err(400, stage === "execute" ? "bad_token" : "bad_id");
  if (stage === "undo") {                                              // 되돌리기는 한 번뿐 — 토큰을 실제로 갱신할 수 있을 때만 시작한다(D3·N-H1)
    const at = await accessFor(user, conn, d, "undo");
    if (at instanceof Response) return at;
  }
  const r = stage === "execute" ? await d.start(user, id) : await d.undo(user, id);
  log({ stage, result: r.result, status: r.status ?? null, total: r.total ?? null });
  switch (r.result) {
    case "started": d.kick(); return Response.json(counts(r), { status: 202 });
    case "current": return Response.json(counts(r));
    case "busy": return err(409, "busy", counts(r));
    case "nothing_to_undo": return err(409, "nothing_to_undo");
    case "expired": return err(410, stage === "execute" ? "token_expired" : "undo_expired");
    case "not_found": return stage === "execute" ? err(404, "not_found") : err(410, "undo_expired");   // 정리된 행과 가를 수 없다(D3)
    default: return err(500, "internal");
  }
}
