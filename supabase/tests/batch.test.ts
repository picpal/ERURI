import { assertEquals } from "jsr:@std/assert";
import { runBatches } from "../functions/worker/batch.ts";
import { deleteRunJobs, RUN, service as sb } from "./_testenv.ts";

Deno.test("runBatches: claims until empty, one job at a time", async () => {
  const q = [["a"], ["b"], ["c"]];
  const ran: string[] = [];
  const n = await runBatches(async () => q.shift() ?? [], async (j: string) => { ran.push(j); });
  assertEquals([n, ran], [3, ["a", "b", "c"]]);
});

Deno.test("runBatches: stops claiming when the time budget is spent", async () => {
  let t = 0, claims = 0;
  const n = await runBatches(async () => { claims++; return ["x"]; }, async () => { t += 40_000; }, { budgetMs: 100_000, now: () => t });
  assertEquals([n, claims], [3, 3]);                        // 0 → 40s → 80s → 120s(예산 초과) 에서 멈춘다
});

// 리뷰(M1-③a) Important 1: 워커 배치(claim_jobs p_limit 1 반복 + 실패 시 fail_job)가 같은 호출에서 실패 잡을 다시 돌리지 않는다.
// 호스팅 DB. 실행 태그 잡만 클레임한다(AGENTS.md §7)
Deno.test("worker batch: a failed job is not re-run in the same call; the next job still runs", async () => {
  try {
    const { data: rows } = await sb.from("jobs").insert([{ kind: "t", lease_key: `${RUN}:b1` }, { kind: "t", lease_key: `${RUN}:b2` }])
      .select("id, lease_key");
    const bad = rows!.find((r) => r.lease_key === `${RUN}:b1`)!.id;
    const ran: string[] = [];
    const claim = async () =>
      ((await sb.rpc("claim_jobs", { p_limit: 1, p_lease_seconds: 180, p_lease_prefix: RUN })).data ?? []) as { id: string }[];
    const run = async (j: { id: string }) => {                               // worker/index.ts run 과 같은 완료·실패 호출
      ran.push(j.id);
      if (j.id === bad) await sb.rpc("fail_job", { p_id: j.id, p_error: "boom" });
      else await sb.rpc("complete_job", { p_id: j.id, p_checkpoint: "done" });
    };
    const n = await runBatches(claim, run, { budgetMs: 20_000 });
    assertEquals([n, ran.filter((id) => id === bad).length], [2, 1]);
    const { data: j } = await sb.from("jobs").select("status, attempts").eq("id", bad).single();
    assertEquals([j!.status, j!.attempts], ["queued", 1]);
  } finally {
    await deleteRunJobs();
  }
});
