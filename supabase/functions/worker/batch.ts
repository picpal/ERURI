import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { LLM_BUSY_DEFER_MS } from "../_shared/budget.ts";

// 워커 호출 1회가 시간 예산 안에서 클레임을 반복한다(스펙 §7). 백필은 사용자당 1개라 한 번에 한 잡씩 이어서 돌아야 분당 1건으로 늘어지지 않는다.
// 예산 100초 < Edge 무료 벽시계 150초. 한 번에 1건만 클레임해 예산 끝에 여러 잡을 잡아 두지 않는다
export const BATCH_BUDGET_MS = 100_000;
// 클레임이 비었어도 곧(창 안) 풀릴 잡이 있으면 그 시각까지 자고 다시 클레임한다(0.8.1 수정 1회차): 다른 워커가 LLM 슬롯 없음으로
// 5초 미룬 잡을 cron(30~60초)까지 두지 않는다. 창 = 미루기 5초 + 1초. 실패 백오프(60초~)·예산 소진(다음 달)은 창 밖이라 기다리지 않는다.
// 여유 250ms 는 Edge 시계와 DB now() 차이, 대기 상한은 시계 차이로 계속 비는 경우의 헛돌기 방지
export const SOON_WINDOW_MS = LLM_BUSY_DEFER_MS + 1_000;
export const SOON_SLACK_MS = 250;
export const MAX_SOON_WAITS = 5;

export async function runBatches<J>(claim: () => Promise<J[]>, run: (job: J) => Promise<void>,
  o: { budgetMs?: number; now?: () => number; soon?: () => Promise<number | null>; sleep?: (ms: number) => Promise<void> } = {}): Promise<number> {
  const now = o.now ?? (() => performance.now());
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const t0 = now(), budget = o.budgetMs ?? BATCH_BUDGET_MS;
  let n = 0, waits = 0;
  while (now() - t0 < budget) {
    const jobs = await claim();
    if (jobs.length === 0) {
      const wait = o.soon && waits < MAX_SOON_WAITS ? await o.soon() : null;
      if (wait === null || now() - t0 + wait + SOON_SLACK_MS >= budget) break;
      waits++;
      await sleep(wait + SOON_SLACK_MS);
      continue;
    }
    for (const j of jobs) { await run(j); n++; }
  }
  return n;
}

// 곧 풀릴 queued 잡(not_before 가 지금 ~ 지금+windowMs)까지 남은 ms, 없으면 null. 범위는 claim_jobs 와 같다:
// prefix 없음 = 테스트 잡('test:%') 제외, prefix 있음 = 그 접두만. 오류는 null(기다리지 않고 끝 — cron 이 회수)
export async function nextDeferredWait(sb: SupabaseClient, prefix: string | null, windowMs: number): Promise<number | null> {
  const t = Date.now();
  let q = sb.from("jobs").select("not_before").eq("status", "queued")
    .gt("not_before", new Date(t).toISOString()).lte("not_before", new Date(t + windowMs).toISOString());
  q = prefix ? q.like("lease_key", `${prefix}%`) : q.or("lease_key.is.null,lease_key.not.like.test:*");
  const { data, error } = await q.order("not_before").limit(1);
  if (error || !data?.length) return null;
  return Math.max(0, Date.parse(data[0].not_before as string) - Date.now());
}
