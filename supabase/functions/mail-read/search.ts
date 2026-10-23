import { type GmailMessage, GmailHttpError, type GmailReadApi, type ListPage, MAIL_CALL_TIMEOUT_MS } from "../_shared/gmail.ts";
import { candidateMeta } from "../_shared/mail-meta.ts";
import { buildReadQuery, checkReadConditions, type ReadConditions, seoulMidnight } from "../_shared/mail-query.ts";
import { conditionPrint, SAME_MS_MAX, signCursor, signToken, TOKEN_TTL_S, verifyCursor } from "../_shared/mail-token.ts";
import { accessFor, connectionFor, type Ctx, CursorStale, err, log, type MailReadDeps, RateLimited, SearchTimeout } from "./common.ts";

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

// ── 0.19.0 진행 위치 검색(limit 있을 때만) ──
export const SCAN_PAGE = 20;
export type Position = { b: number | null; p: string | null; o: number; l: string | null; t: number | null; s: string[] };
export type ScanOutcome = { candidates: GmailMessage[]; complete: boolean; next: Position | null; lists: number; metas: number; ordered: boolean; fallback: boolean };

// 진행 위치 검색(스펙 §7 "진행 위치 검색과 커서"·"진행 보장 정책", D-M4·DP5·DP6): 목록 순서대로 id 를 소비한다 — SENT·DRAFT·CHAT·그사이 404 는 버리고 나머지가 후보.
// 후보 limit 통을 채우거나 목록 끝이면 complete, list 10회·메타 20개 상한이면 미완결 — 어느 쪽이든 소비한 만큼 위치가 나아간다(진행 보장).
// 커서 = 자리 앵커(앵커가 있는 쪽 p·그 다음 오프셋 o·앵커 id l) + 시간 상태(앵커 시각 t·같은 ms 로 본 id s ≤ 20) + 시간 경계 b.
// 이어 읽기: 쪽 p 에서 l 이 o − 1(또는 쪽 안)에 있으면 그 다음, 없으면 pageToken 을 버리고 before:⌊t/1000⌋+1 로 첫 쪽부터 — b 가 있는 동안 < t 또는 (= t ∧ ∉ s)만.
// 같은 요청 안에서 이미 소비한 id 는 건너뛴다(쪽 사이 밀림 — Review Focus 5). 순서는 다시 정렬하지 않는다(ordered 는 관측만, DP7)
export async function scan(ctx: SearchCtx, q0: string, limit: number, start: Position | null): Promise<ScanOutcome> {
  const st: State = { lists: 0, metas: 0, seen: new Map() };
  const out: GmailMessage[] = [], consumed = new Set<string>();
  let b = start?.b ?? null, page = start?.p ?? null, offset = start?.o ?? 0, resume = start?.l ?? null;
  let fromCursor = page !== null;                                                      // page 가 커서 출신일 때만 400 → 410(같은 요청의 nextPageToken 은 Gmail 오류)
  let pos = { p: start?.p ?? null, o: start?.o ?? 0, l: start?.l ?? null };            // 자리 앵커 — 시간 거르기로 버린 메일도 옮긴다(진행 보장)
  let time = { t: start?.t ?? null, s: [...(start?.s ?? [])] };                        // 시간 상태 — 받아들인 메일만 옮긴다
  let ordered = true, fallback = false;
  const query = () => (b === null ? q0 : `${q0} before:${b}`);
  const done = (complete: boolean, end = false): ScanOutcome =>
    ({ candidates: out, complete, next: end ? null : { b, ...pos, ...time }, lists: st.lists, metas: st.metas, ordered, fallback });
  for (;;) {
    if (st.lists >= LIST_CALLS_MAX) return done(false);
    ctx.over();
    await ctx.take(5);
    st.lists++;
    let r: ListPage;
    try { r = await ctx.api.list(query(), SCAN_PAGE, page ?? undefined, ctx.over()); }
    catch (e) { if (e instanceof GmailHttpError && e.status === 400 && fromCursor) throw new CursorStale(); throw e; }   // 커서의 오래된·모르는 pageToken → 410
    const pageIds = (r.messages ?? []).map((m) => m.id);
    let i = offset;
    if (resume !== null) {                                               // 앵커 확인(DP6): o − 1 자리 먼저, 아니면 쪽 안 어디든
      const k = offset > 0 && pageIds[offset - 1] === resume ? offset - 1 : pageIds.indexOf(resume);
      resume = null;
      if (k < 0) {                                                       // 확인 안 됨 — 삭제·이동·쪽 밖으로 밀림: 시간 기준으로 다시 찾는다
        b = Math.floor(time.t! / 1000) + 1;                              // l 이 있으면 t 도 있다(S3 isCursor, PF-12). 같은 초를 포함하게 ⌊⌋ + 1
        page = null; offset = 0; fromCursor = false; fallback = true; pos = { p: null, o: 0, l: null };
        continue;
      }
      pageIds.slice(0, k + 1).forEach((id) => consumed.add(id));         // 앵커와 그 앞(앞 요청들이 소비) — 다음 쪽이 밀려도 다시 소비하지 않는다(§7 보장 범위). 메타는 읽지 않음
      i = k + 1;
    }
    while (i < pageIds.length) {
      if (out.length >= limit) return done(true);
      if (st.metas >= META_MAX) return done(false);
      const n = Math.min(META_PARALLEL, limit - out.length, META_MAX - st.metas, pageIds.length - i);
      const slice = pageIds.slice(i, i + n);
      const group = slice.filter((id) => !consumed.has(id));
      group.forEach((id) => consumed.add(id));
      await readMeta(ctx, st, group);
      for (const [k, id] of slice.entries()) {
        const m = st.seen.get(id);
        if (!group.includes(id) || !m) continue;                         // 이 요청에서 이미 소비(쪽 밀림) · 그사이 404
        pos = { p: page, o: i + k + 1, l: id };
        const at = receivedAt(m);
        if (b !== null && time.t !== null && (at > time.t || (at === time.t && time.s.includes(id)))) continue;   // 시간 기준 거르기(이미 본 것·더 새것)
        time = at === time.t ? { t: at, s: [...time.s, id].slice(-SAME_MS_MAX) } : { t: at, s: [id] };
        if (!valid(m)) continue;
        if (out.length && at > receivedAt(out[out.length - 1])) ordered = false;
        out.push(m);
      }
      i += n;
    }
    const nextPage = r.nextPageToken ?? null;
    if (nextPage === null) return done(true, true);                      // 목록 끝 — next_cursor 없음
    if (out.length >= limit) return done(true);                          // 쪽 끝에서 채움 — 커서는 앵커가 있는 이 쪽(o = 쪽 길이)
    page = nextPage; offset = 0; fromCursor = false;                                   // 빈 쪽·거른 결과 0통 쪽도 같은 요청 안에서 계속
  }
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
  const nowS = Math.floor(d.now() / 1000);
  const scanMode = chk.limit !== null && !chk.c.latest;                  // limit = 0.19.0 앱. latest 는 limit 이 있어도 시간 창 경로(완결일 때만 바로 읽기)
  const print = scanMode ? await conditionPrint(chk.c) : "";
  let start: Position | null = null;
  if (chk.cursor !== null) {                                             // 칸 검사·연결 뒤, 토큰 갱신·Gmail 전(§7 "cursor 검사")
    const v = await verifyCursor(key, chk.cursor, nowS);
    if (!v.ok) {
      log({ stage: "search", request_id: ctx.request_id, result: v.code, elapsed_ms: Math.round(d.now() - ctx.t0) });
      return err(v.code === "bad_token" ? 400 : v.code === "not_found" ? 404 : 410, v.code);
    }
    if (v.claims.u !== ctx.user || v.claims.c !== conn.connection_id || v.claims.h !== print) {   // 다른 사용자·연결·조건의 커서
      log({ stage: "search", request_id: ctx.request_id, result: "not_found", elapsed_ms: Math.round(d.now() - ctx.t0) });
      return err(404, "not_found");
    }
    start = { b: v.claims.b, p: v.claims.p, o: v.claims.o, l: v.claims.l, t: v.claims.t, s: v.claims.s };
  }
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
  let candidates: GmailMessage[], complete: boolean, more: boolean, lists: number, metas: number;
  let next: Position | null = null, ordered: boolean | null = null, fallback = false;
  try {
    if (scanMode) {
      const o = await scan(sctx, buildReadQuery(chk.c), chk.limit!, start);
      ({ candidates, complete, lists, metas, ordered, fallback } = o);
      next = o.next; more = next !== null;
    } else {
      ({ candidates, complete, more, lists, metas } = await collect(sctx, chk.c, nowS));
    }
  } catch (e) {                                                          // 예산으로 줄인 제한 시간에 끊긴 호출 = 예산 초과(502 search_budget) — 다른 오류는 그대로
    if (e instanceof DOMException && e.name === "TimeoutError" && d.now() - ctx.t0 >= SEARCH_BUDGET_MS - 50) throw new SearchTimeout();
    throw e;
  }
  const e = Math.floor(d.now() / 1000) + TOKEN_TTL_S;                    // 후보 토큰·커서 모두 발급 + 10분
  const out = await Promise.all(candidates.map(async (m) =>
    ({ token: await signToken(key, { u: ctx.user, c: conn.connection_id, m: m.id, e }), ...candidateMeta(m) })));
  const next_cursor = next === null ? null : await signCursor(key, { u: ctx.user, c: conn.connection_id, h: print, ...next, e });
  log({ stage: "search", request_id: ctx.request_id, result: "ok", mode: scanMode ? "scan" : "legacy", count: out.length, complete, lists, metas,
    ...(ordered === null ? {} : { ordered, fallback }), elapsed_ms: Math.round(d.now() - ctx.t0) });
  return Response.json({ conditions: chk.c, candidates: out, complete, more, next_cursor, count_capped: chk.count_capped });
}
