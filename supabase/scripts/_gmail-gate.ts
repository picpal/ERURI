// gmail-gate.ts 판정 로직(순수, M1-③ 게이트). 입력은 jobs·items 의 id·시각·상태·개수와 규칙 판정 결과뿐이다(본문·제목·주소 없음)
export type SyncRow = {
  id: string; created_at: string; claimed_at: string | null; status: string; attempts: number; last_error: string | null;
  busy: number;                                     // 이 sync 적재 시각에 백필 레인(우선순위 40)을 점유하던 잡 수(busyAt)
};
export type LaneRow = { created_at: string; claimed_at: string | null; status: string; updated_at: string };
export type SampleKind = "connect" | "open" | "ok";
export type Sample = SyncRow & { latency_s: number | null; kind: SampleKind; retried: boolean };
export type LatencySummary = {
  webhook_syncs: number; connect_excluded: number; open: number; retried: number; during_backfill: number; retried_during_backfill: number;
  avg_latency_s_during_backfill: number | null; max_latency_s_during_backfill: number | null; gate: "pass" | "fail" | "insufficient";
};
export type BacklogRow = { kind: string; status: string; not_before: string | null; last_error: string | null; leased_until: string | null };
export type Backlog = {
  active: number; stalled: number; backoff: number; deferred_budget: number; deferred_busy: number; dead: number; by_kind: Record<string, number>;
};
export type Verdict = { kind: "discard"; reason: string } | { kind: "pass" } | "gone";
export type GapResult = { listed: number; stored: number; discarded_by_rule: Record<string, number>; gone: number; missing: string[] };

export const BURST_GAP_MS = 30_000;
export const CONNECT_WINDOW_MS = 30_000;
export const GATE_MIN_SAMPLES = 5;                 // 스펙 §15 ③ "5회 평균"
export const GATE_AVG_S = 60;                      // "≤ 1분"

const ms = (iso: string) => Date.parse(iso);
const r1 = (x: number) => Math.round(x * 10) / 10;

// gmail-connect 한 번이 넣은 백필 gmail-fetch 잡 묶음: 적재 시각이 앞 잡과 gapMs 안이면 같은 묶음
export function bursts(created: string[], gapMs = BURST_GAP_MS): { start: number; end: number; n: number }[] {
  const out: { start: number; end: number; n: number }[] = [];
  for (const t of created.map(ms).sort((a, b) => a - b)) {
    const last = out[out.length - 1];
    if (last && t - last.end <= gapMs) { last.end = t; last.n++; } else out.push({ start: t, end: t, n: 1 });
  }
  return out;
}

// gmail-connect 는 저장 → watch → 목록·백필 잡 → 초기 sync(gmail_enqueue_for_account, via:webhook 표식) 순이다.
// watch 즉시 알림은 묶음 앞, 초기 sync 는 묶음 뒤에 적재되므로 묶음마다 [start − 창, end + 창] 안의 via:webhook sync 전부를 연결 sync 로 본다
export function connectSyncIds(syncs: { id: string; created_at: string }[], backfillFetchCreated: string[], windowMs = CONNECT_WINDOW_MS): Set<string> {
  const out = new Set<string>();
  for (const b of bursts(backfillFetchCreated)) {
    for (const s of syncs) { const t = ms(s.created_at); if (t >= b.start - windowMs && t <= b.end + windowMs) out.add(s.id); }
  }
  return out;
}

// t 에 백필 레인을 점유하던 잡 수 = 적재됐지만 아직 클레임 전 + 클레임돼 실행 중.
// claimed_at 은 첫 클레임 시각이고(0005·0007 coalesce), 끝난 잡(done·dead)은 updated_at 을 종료 시각으로 본다
// 한계: 현재 상태 기준이다. 예산 미룸(budget_exhausted) 잡이 다음 달에 done 되면 [첫 클레임, 다음 달] 전체가 busy 로 잡히므로
// T0 가 월말이면 latency 는 월이 바뀌기 전에 돌린다
export function busyAt(lane: LaneRow[], t: number): number {
  return lane.filter((r) => {
    if (ms(r.created_at) > t) return false;
    if (r.claimed_at === null || ms(r.claimed_at) > t) return true;
    return r.status === "running" || ((r.status === "done" || r.status === "dead") && ms(r.updated_at) > t);
  }).length;
}

// connect = 연결 창 sync(표본 밖). open = 아직 클레임 전. retried 는 분류가 아니라 플래그 — 첫 클레임 시각이 남으므로
// 재시도 sync 의 적재→첫 클레임 지연도 유효 표본이다(느리게 실패한 표본을 평균에서 빼지 않는다)
export function classify(rows: SyncRow[], connectIds: Set<string>): Sample[] {
  return rows.map((r) => {
    const latency_s = r.claimed_at ? r1((ms(r.claimed_at) - ms(r.created_at)) / 1000) : null;
    const kind: SampleKind = connectIds.has(r.id) ? "connect" : latency_s === null ? "open" : "ok";
    return { ...r, latency_s, kind, retried: r.attempts > 1 || r.last_error !== null };
  });
}

// 게이트(스펙 §15 ③): 백필 점유 중(busy > 0)에 적재된 ok 표본이 5개 이상이고 평균 ≤ 60초. 표본이 모자라면 통과가 아니라 insufficient
export function summarize(samples: Sample[]): LatencySummary {
  const n = (k: SampleKind) => samples.filter((s) => s.kind === k).length;
  const during = samples.filter((s) => s.kind === "ok" && s.busy > 0);
  const lat = during.map((s) => s.latency_s!);
  const avg = lat.length ? r1(lat.reduce((a, b) => a + b, 0) / lat.length) : null;
  return {
    webhook_syncs: samples.length, connect_excluded: n("connect"), open: n("open"),
    retried: samples.filter((s) => s.kind !== "connect" && s.retried).length,
    during_backfill: lat.length, retried_during_backfill: during.filter((s) => s.retried).length,
    avg_latency_s_during_backfill: avg, max_latency_s_during_backfill: lat.length ? Math.max(...lat) : null,
    gate: lat.length < GATE_MIN_SAMPLES ? "insufficient" : avg! <= GATE_AVG_S ? "pass" : "fail",
  };
}

// 백필 레인(우선순위 40) 잡 분류. stalled = running 인데 임대 만료(Edge 150초 벽시계 종료 뒤 재클레임 대기, 결함 아님),
// deferred_budget = 백필 예산 소진(Ruling C), deferred_busy = LLM 슬롯 대기(30초), backoff = 실패 뒤 재시도 대기(0007).
// "백필 끝" = active·stalled·backoff·deferred_busy 가 모두 0
export function backlog(rows: BacklogRow[], now: number): Backlog {
  const b: Backlog = { active: 0, stalled: 0, backoff: 0, deferred_budget: 0, deferred_busy: 0, dead: 0, by_kind: {} };
  for (const r of rows) {
    if (r.status === "dead") { b.dead++; continue; }
    b.by_kind[r.kind] = (b.by_kind[r.kind] ?? 0) + 1;
    if (r.status === "running" && r.leased_until !== null && ms(r.leased_until) < now) { b.stalled++; continue; }
    const waiting = r.status === "queued" && r.not_before !== null && ms(r.not_before) > now;
    if (!waiting) b.active++;
    else if (r.last_error === "budget_exhausted") b.deferred_budget++;
    else if (r.last_error === "llm_busy") b.deferred_busy++;
    else b.backoff++;
  }
  return b;
}

// 합성 메일별 Gmail 수신(occurred_at = internalDate) → 저장(captured_at) 초, 수신 순
export function mailDelays(rows: { id: string; occurred_at: string; captured_at: string }[]): { id: string; delay_s: number }[] {
  return [...rows].sort((a, b) => ms(a.occurred_at) - ms(b.occurred_at))
    .map((r) => ({ id: r.id, delay_s: r1((ms(r.captured_at) - ms(r.occurred_at)) / 1000) }));
}

// refresh token 을 저장한 연결 시각. gmail_save_connection 은 refresh token 이 있을 때만 expires_at = now + 7일 을 쓴다
export function t0Of(expiresAt: string | null): string | null {
  return expiresAt ? new Date(ms(expiresAt) - 7 * 86_400_000).toISOString() : null;
}

// gap 판정: 저장된 id 는 건너뛰고, 나머지만 get(Gmail 에서 받아 서버 규칙으로 메모리 판정)으로 본다.
// "gone"(404: 목록 뒤 삭제·초안 교체)은 누락이 아니다. Gmail 호출마다 pause(쿼터)
export async function judgeIds(ids: string[], stored: Set<string>, get: (id: string) => Promise<Verdict>, pause: () => Promise<void>): Promise<GapResult> {
  const uniq = [...new Set(ids)];
  const r: GapResult = { listed: uniq.length, stored: 0, discarded_by_rule: {}, gone: 0, missing: [] };
  for (const id of uniq) {
    if (stored.has(id)) { r.stored++; continue; }
    const v = await get(id);
    if (v === "gone") r.gone++;
    else if (v.kind === "discard") r.discarded_by_rule[v.reason] = (r.discarded_by_rule[v.reason] ?? 0) + 1;
    else r.missing.push(id);
    await pause();
  }
  return r;
}
