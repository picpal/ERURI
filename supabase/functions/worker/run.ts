import { Deferred } from "../_shared/budget.ts";
import type { Job } from "../_shared/job.ts";
import { withHeartbeat } from "./heartbeat.ts";

// 잡 1건 실행: 완료 → complete, Deferred(예산 소진·LLM 슬롯 없음) → defer(실패 아님), 그 외 오류 → fail(5회 뒤 dead)
export type RunDeps = {
  heartbeat(id: string): Promise<void>;
  complete(id: string, checkpoint: string): Promise<void>;
  fail(id: string, error: string): Promise<void>;
  defer(id: string, until: string, code: string): Promise<void>;
};
export async function runJob(job: Job, handler: (j: Job) => Promise<string>, deps: RunDeps): Promise<"done" | "fail" | "deferred"> {
  try {
    const cp = await withHeartbeat(() => deps.heartbeat(job.id), () => handler(job));
    await deps.complete(job.id, cp);
    return "done";
  } catch (e) {
    if (e instanceof Deferred) { await deps.defer(job.id, e.until, e.message); return "deferred"; }
    await deps.fail(job.id, (e instanceof Error ? e.message : "error").slice(0, 200));   // 메시지는 코드·식별자만(각 모듈이 만든다)
    return "fail";
  }
}
