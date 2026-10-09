import { Deferred } from "../_shared/budget.ts";
import { classifyGmailError, GmailHttpError, type GmailMailApi } from "../_shared/gmail.ts";
import type { Job } from "../_shared/job.ts";

// 메일 정리 실행·되돌리기 잡(스펙 §7 "실행 — 지속 잡"). lease 'mail:<user>' 라 사용자당 한 번에 하나.
// 묶음마다 units 가져가기 → Gmail → mail_action_progress(커서 비교, 계획 D8). 결과 불명은 같은 묶음을 다시 보낸다(라벨·trash·untrash 는 멱등).
// 원칙(Review Focus 7): Gmail 이 바뀌었을 수 있는 id 를 시도·확인 없이 실패로 적지 않는다 — 예산·쿼터·진행 뒤 결과 불명은 처리한 만큼 적고 미룬다.
// 보관함(items·facts)은 건드리지 않는다(Gmail 만 바꾼다). 로그는 결과 코드·개수·방식·상태만(Gmail id·검색 칸 없음)
export type Phase = "execute" | "undo";
export type Action = "trash" | "read";
export type Method = "batch" | "single";
export type Loaded = { status: string; action?: Action; method?: Method | null; connection_id?: string; ids?: string[]; cursor?: number };
export type TokenResult = string | { code: "reauth_required" | "no_connection" };
export type MailJobDeps = {
  begin(user: string, id: string, phase: Phase): Promise<Loaded | null>;
  token(user: string, conn: string): Promise<TokenResult>;
  api(accessToken: string): GmailMailApi;
  take(user: string, units: number): Promise<boolean>;
  setMethod(user: string, id: string, method: Method): Promise<void>;
  progress(user: string, id: string, phase: Phase, from: number, to: number, ok: string[], failed: string[]): Promise<boolean>;
  quota(user: string, id: string): Promise<string | null>;
  finish(user: string, id: string, phase: Phase, code: string | null): Promise<void>;
  now(): number;
  log(o: Record<string, unknown>): void;
};

export const MAIL_JOB_BUDGET_MS = 25_000;          // 잡 1회(계획 D7): Gmail 호출 직전마다 본다. 배치 끝(100초)에 클레임돼도 100 + 25 + 호출 15 = 140 < Edge 150초
export const BATCH_MAX = 1000, SINGLE_CHUNK = 20, MAX_ATTEMPTS = 5;
export const QUOTA_DEFER_MS = 60_000, QUOTA_STUCK_MS = 30 * 60_000, RETRY_DEFER_MS = 60_000;
export const UNITS = { batch: 50, trash: 20, untrash: 5, modify: 5, labels: 20 } as const;   // 공식 쿼터 표(§3)

type Op = {
  batch(api: GmailMailApi, ids: string[]): Promise<void>;
  single(api: GmailMailApi, id: string): Promise<void>;
  singleUnits: number;
  reached(labels: string[]): boolean;              // 마지막 시도 재조회의 목표 상태
};
// batch 가 400(일괄 거절)·404(사라진 id 섞임)면 휴지통·읽음 모두 건별로 넘어간다(D9 — 2026-10-06 메인 판정)
export function opFor(action: Action, phase: Phase): Op {
  if (action === "trash" && phase === "execute") {
    return { batch: (a, ids) => a.batchModify(ids, ["TRASH"], []), single: (a, id) => a.trash(id),
             singleUnits: UNITS.trash, reached: (l) => l.includes("TRASH") };
  }
  if (action === "trash") {                        // Gmail 은 TRASH 를 붙일 때 INBOX 를 뗀다 — 대상은 늘 in:inbox 라 INBOX 를 다시 붙인다(MAIL-real U5). untrash 는 이전 라벨 복원
    return { batch: (a, ids) => a.batchModify(ids, ["INBOX"], ["TRASH"]), single: (a, id) => a.untrash(id),
             singleUnits: UNITS.untrash, reached: (l) => !l.includes("TRASH") && l.includes("INBOX") };
  }
  if (action !== "read") throw new Error("mail_bad_action");          // 모르는 동작을 읽음으로 떨어뜨리지 않는다(M4b 리뷰 Minor 7)
  if (phase === "execute") {
    return { batch: (a, ids) => a.batchModify(ids, [], ["UNREAD"]), single: (a, id) => a.modify(id, [], ["UNREAD"]),
             singleUnits: UNITS.modify, reached: (l) => !l.includes("UNREAD") };
  }
  return { batch: (a, ids) => a.batchModify(ids, ["UNREAD"], []), single: (a, id) => a.modify(id, ["UNREAD"], []),
           singleUnits: UNITS.modify, reached: (l) => l.includes("UNREAD") };
}

const BUDGET = "budget";                           // Interrupted 이유: 예산 끝(다음 호출 전에 멈춤)
class Interrupted extends Error {
  constructor(readonly ok: string[], readonly failed: string[], readonly reason: unknown) { super("interrupted"); }
}
// 건별: 호출 직전마다 예산을 본다(D7). 한 id 의 400·404 는 그 id 만 실패. 예산 끝·그 밖의 오류는 그때까지의 결과를 들고 멈춘다
async function singles(api: GmailMailApi, o: Op, ids: string[], over: () => boolean) {
  const ok: string[] = [], failed: string[] = [];
  for (const id of ids) {
    if (over()) throw new Interrupted(ok, failed, BUDGET);
    try { await o.single(api, id); ok.push(id); }
    catch (e) {
      const k = classifyGmailError(e);
      if (k === "gone" || k === "rejected") failed.push(id);
      else throw new Interrupted(ok, failed, e);
    }
  }
  return { ok, failed };
}
const iso = (ms: number) => new Date(ms).toISOString();
const nextMinute = (ms: number) => iso(Math.floor(ms / 60_000) * 60_000 + 60_000);
const codeOf = (e: unknown) => e instanceof GmailHttpError ? String(e.status) : e instanceof Error ? e.name : "error";
function stale(d: MailJobDeps, phase: Phase): string {
  d.log({ mail_action: "stale", phase });          // 다른 워커가 이미 그 구간을 적었다(lease 만료 뒤 늦게 깸, D8)
  return "stale";
}
// 쿼터(D7): 행 quota_since 로 30분 판정 — 넘으면 평범한 오류(fail_job, attempts 사용), 아니면 1분 뒤 같은 묶음(attempts 되돌림)
async function quotaDefer(d: MailJobDeps, user: string, id: string): Promise<never> {
  const since = Date.parse((await d.quota(user, id)) ?? iso(d.now()));
  if (d.now() - since > QUOTA_STUCK_MS) throw new Error("mail_quota_stuck");
  throw new Deferred(iso(d.now() + QUOTA_DEFER_MS), "mail_quota");
}

export async function mailActionJob(d: MailJobDeps, job: Job): Promise<string> {
  const t0 = d.now();                                                  // 예산은 잡 시작부터(토큰 갱신 포함, D7)
  const over = () => d.now() - t0 >= MAIL_JOB_BUDGET_MS;
  const user = job.user_id;
  if (!user) throw new Error("mail-action without user_id");
  const id = String(job.payload.id ?? ""), phase: Phase = job.payload.phase === "undo" ? "undo" : "execute";
  const row = await d.begin(user, id, phase);
  if (!row) { d.log({ mail_action: "gone", phase }); return "gone"; }                    // 정리·출처 삭제로 행이 없음
  if (row.status !== (phase === "execute" ? "running" : "undoing")) { d.log({ mail_action: "noop", phase, status: row.status }); return "noop"; }
  const o = opFor(row.action as Action, phase);                       // 모르는 action 이면 토큰·Gmail 전에 던진다
  const t = await d.token(user, row.connection_id!);                  // deps 가 갱신을 15초에서 끊는다
  if (typeof t !== "string") {
    await d.finish(user, id, phase, t.code);                           // 되돌리기에서 진행 0 이면 SQL 이 되돌리기를 되살린다(D11)
    d.log({ mail_action: "closed", phase, code: t.code });
    return t.code;
  }
  const api = d.api(t), ids = row.ids ?? [];
  let cursor = row.cursor ?? 0;
  const start = cursor, last = job.attempts >= MAX_ATTEMPTS;          // start: 이번 실행이 진행했는지(진행 뒤 결과 불명은 미룸, D7)
  // 되돌리기는 실행 방식을 따른다: 휴지통 single 이면 처음부터 untrash, 읽음은 늘 batch 먼저(D9)
  let method: Method = phase === "undo" && row.action === "read" ? "batch" : (row.method ?? "batch");
  if (phase === "execute" && !row.method) await d.setMethod(user, id, "batch");
  while (cursor < ids.length) {
    if (over()) throw new Deferred(iso(d.now()), "mail_budget");      // 커서는 남아 있다 — 곧 다시
    const chunk = ids.slice(cursor, cursor + (method === "batch" ? BATCH_MAX : SINGLE_CHUNK)), end = cursor + chunk.length;
    if (!await d.take(user, method === "batch" ? UNITS.batch : chunk.length * o.singleUnits)) throw new Deferred(nextMinute(d.now()), "mail_units");
    let ok: string[], failed: string[] = [];
    try {
      if (method === "batch") { await o.batch(api, chunk); ok = chunk; }   // 2xx = 그 호출의 id 전부 성공(Gmail 이 id별 결과를 주지 않는다)
      else ({ ok, failed } = await singles(api, o, chunk, over));
    } catch (e) {
      let err = e;
      if (e instanceof Interrupted) {
        err = e.reason;
        const n = e.ok.length + e.failed.length;
        if (n > 0) {
          if (!await d.progress(user, id, phase, cursor, cursor + n, e.ok, e.failed)) return stale(d, phase);
          cursor += n;
        }
        if (err === BUDGET) throw new Deferred(iso(d.now()), "mail_budget");   // 처리한 만큼 적었다 — 곧 다시(D7)
      }
      const kind = classifyGmailError(err);
      if (method === "batch" && (kind === "rejected" || kind === "gone")) {
        method = "single";                                            // 일괄 거절(400)·사라진 id 섞임(404) → 건별(D9)
        if (phase === "execute") await d.setMethod(user, id, "single");
        d.log({ mail_action: "fallback", phase, status: codeOf(err) });
        continue;
      }
      if (kind === "quota") return await quotaDefer(d, user, id);     // 폴백 없이 1분 뒤 같은 묶음
      if (kind === "scope") {
        await d.finish(user, id, phase, "scope_missing");
        d.log({ mail_action: "closed", phase, code: "scope_missing" });
        return "scope_missing";
      }
      // 결과 불명: 이번 실행에서 진행했으면 attempts 를 쓰지 않고 1분 뒤(흩어진 일시 오류가 마지막 시도로 몰지 않게, D7)
      if (cursor > start) throw new Deferred(iso(d.now() + RETRY_DEFER_MS), "mail_retry");
      if (!last) throw new Error("mail_unknown " + codeOf(err));       // 진행 없음: fail_job 백오프 뒤 같은 묶음(멱등)
      // 건별 마지막 시도: 결과 불명인 그 id 만 다시 읽어 적고 나머지는 이어 간다 — 보내지 않은 id 를 실패로 적지 않는다(M4b 리뷰 Minor 3).
      // 재조회가 그 id 를 적으면 실행마다 한 id 씩 나아간다. 예산에 걸려 못 적으면 RETRY_DEFER_MS 뒤 다시(lookup) — attempts 를 쓰지 않으므로
      // 갱신 지연·타임아웃이 끝없이 이어지면 끝나지 않지만, 1분 간격이라 Gmail·토큰이 회복되면 이어 간다(장애 중 처리량은 1분에 1건 수준)
      if (method === "single") {
        if (!await lookup(d, api, user, id, phase, o, ids.slice(cursor, cursor + 1), cursor, over)) return stale(d, phase);
        throw new Deferred(iso(d.now() + RETRY_DEFER_MS), "mail_retry");
      }
      // batch 마지막 시도(D10): 남은 묶음을 다시 읽어 목표 상태면 성공, 아니면 실패로 적고 마감(커서 뒤는 finish 가 실패로)
      if (!await lookup(d, api, user, id, phase, o, ids.slice(cursor, end), cursor, over)) return stale(d, phase);
      await d.finish(user, id, phase, null);
      d.log({ mail_action: "verified", phase, method, elapsed_ms: d.now() - t0 });
      return "verified";
    }
    if (!await d.progress(user, id, phase, cursor, end, ok, failed)) return stale(d, phase);
    cursor = end;
  }
  await d.finish(user, id, phase, null);
  d.log({ mail_action: "done", phase, method, n: ids.length, elapsed_ms: d.now() - t0 });   // 1,000건 batch 응답 시간을 MAIL-real 에서 본다
  return "done";
}

// 마지막 시도 재조회(D10): 20개씩 units 를 가져가 라벨을 읽고 적는다. 호출 직전마다 예산을 보고(넘으면 읽은 앞부분을 적고 미룸),
// 쿼터면 읽은 앞부분만 적고 쿼터 미루기 — 휴지통에 간 메일을 쿼터 때문에 실패로 적지 않는다(Fable N-M2). 404·그 밖의 오류는 실패(스펙 수용 범위)
async function lookup(d: MailJobDeps, api: GmailMailApi, user: string, id: string, phase: Phase, o: Op, rest: string[], from: number,
                      over: () => boolean): Promise<boolean> {
  let cur = from;
  for (let i = 0; i < rest.length; i += SINGLE_CHUNK) {
    const sub = rest.slice(i, i + SINGLE_CHUNK);
    if (!await d.take(user, sub.length * UNITS.labels)) throw new Deferred(nextMinute(d.now()), "mail_units");   // 진행은 남아 있다
    const ok: string[] = [], failed: string[] = [];
    let stop: "budget" | "quota" | null = null;
    for (const m of sub) {
      if (over()) { stop = "budget"; break; }
      try { (o.reached((await api.labels(m)).labelIds ?? []) ? ok : failed).push(m); }
      catch (e) {
        if (classifyGmailError(e) === "quota") { stop = "quota"; break; }
        failed.push(m);                                               // 읽지 못하면 실패(되돌리기 대상에서 빠진다)
      }
    }
    const n = ok.length + failed.length;
    if (n > 0) {
      if (!await d.progress(user, id, phase, cur, cur + n, ok, failed)) return false;
      cur += n;
    }
    // 예산 끝: 읽은 게 있으면 곧 다시. 이번 실행이 하나도 못 적었으면(lookup 은 이번 실행 진행 0 일 때만 불린다 — cur = from)
    // RETRY_DEFER_MS 뒤로 — 느린 갱신·타임아웃이 이어지는 동안 attempts 도 진행도 없이 곧바로 다시 도는 루프를 막는다(M4b 재리뷰 Minor 1)
    if (stop === "budget") throw new Deferred(iso(d.now() + (cur === from ? RETRY_DEFER_MS : 0)), "mail_budget");
    if (stop === "quota") return await quotaDefer(d, user, id);
  }
  return true;
}
