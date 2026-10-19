import { assertEquals } from "jsr:@std/assert";
import { Deferred } from "../functions/_shared/budget.ts";
import type { Job } from "../functions/_shared/job.ts";
import OpenAI from "npm:openai@7";
import { runJob } from "../functions/worker/run.ts";

const job: Job = { id: "j1", kind: "process", user_id: "u1", payload: {}, attempts: 1, checkpoint: null };
function deps() {
  const calls: string[] = [];
  return { calls, d: {
    heartbeat: async () => {},
    complete: async (_id: string, cp: string) => { calls.push("complete:" + cp); },
    fail: async (_id: string, e: string) => { calls.push("fail:" + e); },
    defer: async (_id: string, until: string, code: string) => { calls.push(`defer:${code}:${until}`); },
  } };
}
Deno.test("runJob: done → complete; error → fail; Deferred → defer (not fail)", async () => {
  const a = deps(); assertEquals(await runJob(job, async () => "extracted", a.d), "done"); assertEquals(a.calls, ["complete:extracted"]);
  const b = deps(); assertEquals(await runJob(job, async () => { throw new Error("x 500"); }, b.d), "fail"); assertEquals(b.calls, ["fail:x 500"]);
  const c = deps(); assertEquals(await runJob(job, async () => { throw new Deferred("2027-01-01T00:00:00+09:00", "budget_exhausted"); }, c.d), "deferred");
  assertEquals(c.calls, ["defer:budget_exhausted:2027-01-01T00:00:00+09:00"]);
});

// 0.16.1 LLM 사용 불가(스펙 §7 jobs 워커): 401·403·429 insufficient_quota → fail 이 아니라 30분 미루기(코드 llm_unavailable, attempts 소비 없음).
// 로그는 {job_id, llm_unavailable: 사유}만, last_error·로그에 OpenAI 메시지(키 조각)를 넣지 않는다
Deno.test("runJob: OpenAI 401/403/insufficient_quota → defer 30 min with code llm_unavailable (never fail); log has the reason, no message", async () => {
  const h = new Headers(), now = new Date("2026-10-19T03:00:00Z");
  const errs = [new OpenAI.AuthenticationError(401, { code: "invalid_api_key" }, "Incorrect API key provided: sk-inv*********test", h),
    new OpenAI.PermissionDeniedError(403, { code: null }, "denied sk-abc***", h),
    new OpenAI.RateLimitError(429, { code: "insufficient_quota" }, "quota sk-abc***", h)];
  for (const [i, e] of errs.entries()) {
    const a = deps();
    const logs: string[] = [], orig = console.log;
    console.log = (...x: unknown[]) => { logs.push(x.map(String).join(" ")); };
    try { assertEquals(await runJob(job, async () => { throw e; }, { ...a.d, now: () => now }), "deferred"); } finally { console.log = orig; }
    assertEquals(a.calls, ["defer:llm_unavailable:2026-10-19T03:30:00.000Z"]);
    assertEquals(logs.map((l) => JSON.parse(l)), [{ job_id: "j1", llm_unavailable: ["llm_auth", "llm_permission", "llm_quota"][i] }]);
  }
});

Deno.test("runJob: other OpenAI errors fail with openai_<status> <code> only; plain messages lose key-shaped strings", async () => {
  const h = new Headers();
  const a = deps();
  await runJob(job, async () => { throw new OpenAI.RateLimitError(429, { code: "rate_limit_exceeded" }, "Rate limit for sk-abc***", h); }, a.d);
  const b = deps();
  await runJob(job, async () => { throw new OpenAI.BadRequestError(400, { code: "invalid_value" }, "bad sk-proj-xyz", h); }, b.d);
  const c = deps();
  await runJob(job, async () => { throw new Error("extract boom sk-proj-123***abc"); }, c.d);
  assertEquals([a.calls, b.calls, c.calls], [["fail:openai_429 rate_limit_exceeded"], ["fail:openai_400 invalid_value"], ["fail:extract boom sk-***"]]);
});
