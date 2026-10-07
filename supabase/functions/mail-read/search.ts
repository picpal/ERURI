import { type GmailMessage, GmailHttpError, type GmailReadApi, MAIL_CALL_TIMEOUT_MS } from "../_shared/gmail.ts";
import { candidateMeta } from "../_shared/mail-meta.ts";
import { buildReadQuery, checkReadConditions, type ReadConditions, seoulMidnight } from "../_shared/mail-query.ts";
import { signToken, TOKEN_TTL_S } from "../_shared/mail-token.ts";
import { accessFor, connectionFor, type Ctx, err, log, type MailReadDeps, RateLimited, SearchTimeout } from "./common.ts";

// 검색(스펙 §7 "검색"): 칸 검사(연결보다 먼저) → 연결 → 토큰 갱신 → id 모으기(최대 20, list 10회) → 메타(snippet 없음) → 라벨 거르기 → 받은 시각 순 5통 + 후보 토큰.
// complete = 조건에 맞는 id 를 모두 봤다(이때만 0통 = 없음, 첫 후보 = 가장 최근). LLM 없음
export const LIST_CALLS_MAX = 10, META_MAX = 20, CANDIDATES_MAX = 5, META_PARALLEL = 5, SEARCH_BUDGET_MS = 20_000;
export const LATEST_STEPS_S = [3_600, 86_400, 7 * 86_400, 30 * 86_400] as const;
export const SKIP_LABELS: readonly string[] = ["SENT", "DRAFT", "CHAT"];
// over(): 20초 예산이 남았는지 보고(없으면 SearchTimeout) 이번 Gmail 호출의 제한 시간 = min(15초, 남은 시간)을 돌려준다 — 서버 검색이 앱 30초 타임아웃 안에 끝난다
export type SearchCtx = { api: Pick<GmailReadApi, "list" | "headers">; take(units: number): Promise<void>; over(): number };
export type SearchOutcome = { candidates: GmailMessage[]; complete: boolean; more: boolean; lists: number; metas: number };
type State = { lists: number; metas: number; seen: Map<string, GmailMessage | null> };   // null = 그사이 404

async function listIds(ctx: SearchCtx, st: State, q: string): Promise<{ ids: string[]; complete: boolean }> {
  const ids: string[] = [];
  let pageToken: string | undefined, dropped = false;
  for (;;) {
    if (st.lists >= LIST_CALLS_MAX) return { ids, complete: false };
    ctx.over();
    await ctx.take(5);
    st.lists++;
    const p = await ctx.api.list(q, META_MAX - ids.length, pageToken, ctx.over());   // units 확보(최대 1초) 뒤 남은 시간으로
    for (const m of p.messages ?? []) {
      if (ids.includes(m.id)) continue;
      if (ids.length >= META_MAX) { dropped = true; continue; }
      ids.push(m.id);
    }
    pageToken = p.nextPageToken;
    if (!pageToken) return { ids, complete: !dropped };
    if (ids.length >= META_MAX) return { ids, complete: false };
  }
}
async function readMeta(ctx: SearchCtx, st: State, ids: string[]): Promise<void> {
  for (let i = 0; i < ids.length; i += META_PARALLEL) {
    const group = ids.slice(i, i + META_PARALLEL);
    ctx.over();
    await ctx.take(20 * group.length);
    st.metas += group.length;
    const t = ctx.over();
    await Promise.all(group.map(async (id) => {
      try { st.seen.set(id, await ctx.api.headers(id, t)); }
      catch (e) { if (e instanceof GmailHttpError && e.status === 404) st.seen.set(id, null); else throw e; }   // 그사이 지워진 메일만 뺀다
    }));
  }
}
const valid = (m: GmailMessage | null | undefined): m is GmailMessage => !!m && !(m.labelIds ?? []).some((l) => SKIP_LABELS.includes(l));
const receivedAt = (m: GmailMessage) => { const t = m.internalDate ? Number(m.internalDate) : NaN; return Number.isFinite(t) ? t : -1; };   // 없으면 맨 뒤
const unseen = (st: State, ids: string[]) => ids.filter((id) => !st.seen.has(id));
function outcome(st: State, ids: string[], complete: boolean): SearchOutcome {
  const ok = ids.map((id) => st.seen.get(id)).filter(valid).sort((a, b) => receivedAt(b) - receivedAt(a));
  return { candidates: ok.slice(0, CANDIDATES_MAX), complete, more: ok.length > CANDIDATES_MAX || !complete, lists: st.lists, metas: st.metas };
}

export async function collect(ctx: SearchCtx, c: ReadConditions, nowS: number): Promise<SearchOutcome> {
  const st: State = { lists: 0, metas: 0, seen: new Map() };
  if (!c.latest) {
    const l = await listIds(ctx, st, buildReadQuery(c));
    await readMeta(ctx, st, l.ids);
    return outcome(st, l.ids, l.complete);
  }
  // latest: 끝 T(받은 기간 끝 다음 날 서울 0시, 없으면 지금)에서 1시간 → 1일 → 7일 → 30일 → 받은 기간 시작(없으면 제한 없음)으로 넓힌다.
  // 빠짐없이 나열한 창 [시작, T] 안의 가장 최근 유효 메일은 창 밖 어떤 메일보다 최근 — 목록 순서와 무관하게 확정된다(§7)
  const end = c.received_to ? seoulMidnight(c.received_to)! + 86_400 : nowS;
  const floor = c.received_from ? seoulMidnight(c.received_from)! : null;
  const starts: (number | undefined)[] = [...LATEST_STEPS_S.map((s) => end - s).filter((s) => floor === null || s > floor), undefined];
  for (const s of starts) {
    const l = await listIds(ctx, st, buildReadQuery(c, s));
    if (!l.complete) {                                                   // 창 안 id 가 20개를 넘음(또는 list 상한) — 그 창에서 미완결
      await readMeta(ctx, st, unseen(st, l.ids).slice(0, Math.max(0, META_MAX - st.metas)));
      return outcome(st, l.ids, false);
    }
    if (l.ids.length === 0) continue;                                    // 빈 창 → 다음 창
    const fresh = unseen(st, l.ids), room = META_MAX - st.metas;
    await readMeta(ctx, st, fresh.slice(0, Math.max(0, room)));          // 이미 메타를 본 id 는 다시 읽지 않는다
    if (fresh.length > room) return outcome(st, l.ids, false);           // 메타 상한 20(창들 합계)
    if (l.ids.some((id) => valid(st.seen.get(id)))) return outcome(st, l.ids, true);
  }
  return outcome(st, [], true);                                          // 마지막 창(받은 기간 시작 또는 제한 없음)까지 유효 0 — 완결 0통
}

export async function search(ctx: Ctx, body: Record<string, unknown>, d: MailReadDeps): Promise<Response> {
  const chk = checkReadConditions(body);                                 // 앱이 보낸 칸도 믿지 않는다 — 검사·정제는 여기 한 곳(연결보다 먼저, Codex #5)
  if (!chk.ok) {
    log({ stage: "search", request_id: ctx.request_id, result: chk.code, elapsed_ms: Math.round(d.now() - ctx.t0) });
    return chk.code === "needs_target" ? err(400, "needs_target") : err(400, "bad_condition", { fields: chk.fields });
  }
  const key = await d.tokenKey();                                        // 키 오류는 Gmail 을 부르기 전에(500 key_invalid)
  const conn = await connectionFor(ctx, d, "search");
  if (conn instanceof Response) return conn;
  const at = await accessFor(ctx, conn, d, "search");
  if (at instanceof Response) return at;
  const sctx: SearchCtx = {
    api: d.api(at),
    take: async (n) => { if (!(await d.takeUnits(ctx.user, n))) throw new RateLimited(); },
    over: () => {
      const left = SEARCH_BUDGET_MS - (d.now() - ctx.t0);
      if (left <= 0) throw new SearchTimeout();
      return Math.min(MAIL_CALL_TIMEOUT_MS, left);
    },
  };
  let o: SearchOutcome;
  try { o = await collect(sctx, chk.c, Math.floor(d.now() / 1000)); }
  catch (e) {                                                            // 예산으로 줄인 제한 시간에 끊긴 호출 = 예산 초과(502 search_budget) — 다른 오류는 그대로
    if (e instanceof DOMException && e.name === "TimeoutError" && d.now() - ctx.t0 >= SEARCH_BUDGET_MS - 50) throw new SearchTimeout();
    throw e;
  }
  const e = Math.floor(d.now() / 1000) + TOKEN_TTL_S;
  const candidates = await Promise.all(o.candidates.map(async (m) =>
    ({ token: await signToken(key, { u: ctx.user, c: conn.connection_id, m: m.id, e }), ...candidateMeta(m) })));
  log({ stage: "search", request_id: ctx.request_id, result: "ok", count: candidates.length, complete: o.complete, lists: o.lists, metas: o.metas,
    elapsed_ms: Math.round(d.now() - ctx.t0) });
  return Response.json({ conditions: chk.c, candidates, complete: o.complete, more: o.more });
}
