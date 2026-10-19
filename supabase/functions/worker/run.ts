import { Deferred } from "../_shared/budget.ts";
import type { Job } from "../_shared/job.ts";
import { errorCode, LLM_UNAVAILABLE_DEFER_MS, llmUnavailable } from "../_shared/llm-errors.ts";
import { withHeartbeat } from "./heartbeat.ts";

// 잡 1건 실행: 완료 → complete, Deferred(예산 소진·LLM 슬롯 없음) → defer(실패 아님), LLM 사용 불가(키 무효·권한·쿼터, 0.16.1) → 30분 defer,
// 그 외 오류 → fail(5회 뒤 dead)
export type RunDeps = {
  heartbeat(id: string): Promise<void>;
  complete(id: string, checkpoint: string): Promise<void>;
  fail(id: string, error: string): Promise<void>;
  defer(id: string, until: string, code: string): Promise<void>;
  now?(): Date;
};
export async function runJob(job: Job, handler: (j: Job) => Promise<string>, deps: RunDeps): Promise<"done" | "fail" | "deferred"> {
  try {
    const cp = await withHeartbeat(() => deps.heartbeat(job.id), () => handler(job));
    await deps.complete(job.id, cp);
    return "done";
  } catch (e) {
    if (e instanceof Deferred) { await deps.defer(job.id, e.until, e.message); return "deferred"; }
    // 다시 해도 같은 결과 — attempts 를 쓰지 않고 미룬다(키를 고치면 다음 클레임에서 처리). 사유만 로그(메시지에 키 조각이 있다)
    const unavailable = llmUnavailable(e);
    if (unavailable) {
      console.log(JSON.stringify({ job_id: job.id, llm_unavailable: unavailable }));
      const until = new Date((deps.now?.() ?? new Date()).getTime() + LLM_UNAVAILABLE_DEFER_MS).toISOString();
      await deps.defer(job.id, until, "llm_unavailable");
      return "deferred";
    }
    await deps.fail(job.id, errorCode(e));   // 코드·식별자만(각 모듈이 만든다). OpenAI 오류는 상태·코드만, 키 모양은 가린다
    return "fail";
  }
}
