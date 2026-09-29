import { assertEquals } from "jsr:@std/assert";
import { Deferred } from "../functions/_shared/budget.ts";
import type { Job } from "../functions/_shared/job.ts";
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
