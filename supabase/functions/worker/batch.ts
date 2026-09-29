// 워커 호출 1회가 시간 예산 안에서 클레임을 반복한다(스펙 §7). 백필은 사용자당 1개라 한 번에 한 잡씩 이어서 돌아야 분당 1건으로 늘어지지 않는다.
// 예산 100초 < Edge 무료 벽시계 150초. 한 번에 1건만 클레임해 예산 끝에 여러 잡을 잡아 두지 않는다
export const BATCH_BUDGET_MS = 100_000;

export async function runBatches<J>(claim: () => Promise<J[]>, run: (job: J) => Promise<void>,
  o: { budgetMs?: number; now?: () => number } = {}): Promise<number> {
  const now = o.now ?? (() => performance.now());
  const t0 = now(), budget = o.budgetMs ?? BATCH_BUDGET_MS;
  let n = 0;
  while (now() - t0 < budget) {
    const jobs = await claim();
    if (jobs.length === 0) break;
    for (const j of jobs) { await run(j); n++; }
  }
  return n;
}
