import { assertEquals } from "jsr:@std/assert";
import {
  backlog, bursts, busyAt, classify, connectSyncIds, judgeIds, type LaneRow, mailDelays, summarize, type SyncRow, t0Of, type Verdict,
} from "../scripts/_gmail-gate.ts";

// M1-③ 게이트 판정(순수). 시각은 기준 + s초
const T = (s: number) => new Date(Date.UTC(2026, 9, 1, 5, 0, 0) + s * 1000).toISOString();
const at = (s: number) => Date.parse(T(s));
const sync = (id: string, created: number, claimed: number | null, o: Partial<SyncRow> = {}): SyncRow => ({
  id, created_at: T(created), claimed_at: claimed === null ? null : T(claimed), status: claimed === null ? "queued" : "done",
  attempts: claimed === null ? 0 : 1, last_error: null, busy: 3, ...o,
});
const lane = (created: number, claimed: number | null, status: string, updated: number): LaneRow =>
  ({ created_at: T(created), claimed_at: claimed === null ? null : T(claimed), status, updated_at: T(updated) });

Deno.test("bursts: backfill fetch jobs enqueued within 30s form one connect burst", () => {
  assertEquals(bursts([T(0), T(1), T(2), T(600), T(601)]).map((b) => b.n), [3, 2]);
});

// Review Focus 3: watch 즉시 알림은 묶음 앞, 초기 sync 는 묶음 뒤 — 창 안이면 모두 연결 sync. 45초 뒤 합성 메일 sync 는 표본
Deno.test("connectSyncIds: every via:webhook sync within [burst start − 30s, burst end + 30s] is a connect sync (T0 and reconnect)", () => {
  const syncs = [sync("w0", -2, 1), sync("c1", 3, 10), sync("l1", 45, 50), sync("c2", 602, 610), sync("w2", 700, 705)];
  assertEquals([...connectSyncIds(syncs, [T(0), T(1), T(2), T(600), T(601)])].sort(), ["c1", "c2", "w0"]);
  assertEquals(connectSyncIds(syncs, []).size, 0);                                   // 백필이 없으면 뺄 것도 없다
});

// Review Focus 3: 미클레임 0 이어도 fetch 가 실행 중이면 백필 중. 중복뿐인 재적재(process 잡 없음)도 같다
Deno.test("busyAt: a single running backfill fetch counts though nothing is unclaimed; a dedup-only reload stays busy until its last fetch ends", () => {
  const one = [lane(0, 5, "done", 85)];
  assertEquals([busyAt(one, at(3)), busyAt(one, at(40)), busyAt(one, at(90))], [1, 1, 0]);
  const reload = [lane(0, 5, "done", 85), lane(1, 86, "running", 86)];
  assertEquals([busyAt(reload, at(-1)), busyAt(reload, at(40)), busyAt(reload, at(100))], [0, 2, 1]);
});

// Review Focus 3: 연결 sync 만 표본 밖. 재시도 sync(첫 클레임 시각 보존)는 평균에 들어간다
Deno.test("classify + summarize: only connect syncs are excluded; a retried slow sync stays in the average", () => {
  const rows = [
    sync("c", 3, 10),
    sync("a", 60, 70), sync("b", 120, 150), sync("d", 180, 200), sync("e", 240, 260),
    sync("f", 300, 400, { attempts: 2, last_error: "history 503" }),                 // 100초 기다린 뒤 실패·재시도 → 표본(플래그)
    sync("g", 360, 420),
    sync("h", 900, 905, { busy: 0 }),                                                // 백필이 끝난 뒤 → 평균 밖
    sync("q", 960, null),                                                            // 아직 클레임 전
  ];
  assertEquals(summarize(classify(rows, new Set(["c"]))), {
    webhook_syncs: 9, connect_excluded: 1, open: 1, retried: 1, during_backfill: 6, retried_during_backfill: 1,
    avg_latency_s_during_backfill: 40, max_latency_s_during_backfill: 100, gate: "pass",
  });
});

// Review Focus 2: 표본 부족은 통과가 아니다
Deno.test("summarize: fewer than 5 during-backfill samples is insufficient; a slow average fails", () => {
  const four = [sync("a", 0, 5), sync("b", 60, 65), sync("c", 120, 125), sync("d", 180, 185), sync("e", 240, 245, { busy: 0 })];
  assertEquals(summarize(classify(four, new Set())).gate, "insufficient");
  const slow = [0, 60, 120, 180, 240].map((t, i) => sync(`s${i}`, t, t + 90));
  assertEquals(summarize(classify(slow, new Set())).gate, "fail");
});

// Review Focus 4: 예산 미룸·백오프·dead·벽시계 종료(stalled)는 "진행 중"이 아니다
Deno.test("backlog: budget-deferred, backoff, stalled (lease expired while running) and dead are apart from active", () => {
  const b = backlog([
    { kind: "gmail-fetch", status: "running", not_before: null, last_error: null, leased_until: T(60) },
    { kind: "process", status: "queued", not_before: null, last_error: null, leased_until: null },
    { kind: "process", status: "queued", not_before: T(-60), last_error: "llm_busy", leased_until: null },     // 기한 지남 → 클레임 가능
    { kind: "process", status: "queued", not_before: T(86_400), last_error: "budget_exhausted", leased_until: null },
    { kind: "process", status: "queued", not_before: T(20), last_error: "llm_busy", leased_until: null },
    { kind: "embed", status: "queued", not_before: T(120), last_error: "embed 500", leased_until: null },
    { kind: "gmail-fetch", status: "running", not_before: null, last_error: null, leased_until: T(-30) },     // Edge 150초 벽시계 종료 뒤
    { kind: "gmail-fetch", status: "dead", not_before: null, last_error: "messages.get 500", leased_until: null },
  ], at(0));
  assertEquals(b, { active: 3, stalled: 1, backoff: 1, deferred_budget: 1, deferred_busy: 1, dead: 1,
    by_kind: { "gmail-fetch": 2, process: 4, embed: 1 } });
});

Deno.test("mailDelays: per synthetic mail, Gmail receive → stored seconds, in receive order", () => {
  assertEquals(mailDelays([
    { id: "m2", occurred_at: T(60), captured_at: T(75.5) },
    { id: "m1", occurred_at: T(0), captured_at: T(42) },
  ]), [{ id: "m1", delay_s: 42 }, { id: "m2", delay_s: 15.5 }]);
});

// Review Focus 1: refresh token 없는 연결은 T0 가 없다
Deno.test("t0Of: connection time = refresh-token expiry − 7 days; no expiry (no refresh token stored) → null", () => {
  assertEquals([t0Of("2026-10-08T05:00:00+00:00"), t0Of(null)], ["2026-10-01T05:00:00.000Z", null]);
});

// Review Focus 4: 404(목록 뒤 삭제)는 누락이 아니라 gone, 규칙 폐기는 사유별, 나머지만 누락. Gmail 호출마다 쉼
Deno.test("judgeIds: stored ids skipped, gone counted, rule discards by reason, the rest missing; pause per Gmail call", async () => {
  let pauses = 0;
  const v: Record<string, Verdict> = { o: { kind: "discard", reason: "otp" }, d: { kind: "discard", reason: "draft" }, x: "gone", m: { kind: "pass" } };
  const r = await judgeIds(["s1", "o", "d", "x", "m", "s1"], new Set(["s1"]), async (id) => v[id], async () => { pauses++; });
  assertEquals(r, { listed: 5, stored: 1, discarded_by_rule: { otp: 1, draft: 1 }, gone: 1, missing: ["m"] });
  assertEquals(pauses, 4);
});
