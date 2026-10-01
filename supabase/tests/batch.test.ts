import { assertEquals } from "jsr:@std/assert";
import { MAX_SOON_WAITS, nextDeferredWait, runBatches, SOON_SLACK_MS, SOON_WINDOW_MS } from "../functions/worker/batch.ts";
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

// 0.8.1 수정 1회차(리뷰 Important 1): 다른 워커가 LLM 슬롯 없음으로 5초 미룬 잡을, 앞 잡을 끝낸 워커가 비었다고 바로 끝내지 않고
// 기다렸다 다시 클레임한다(cron 까지 30~60초 기다리지 않게)
Deno.test("runBatches: empty claim with a job due soon → sleeps until due (+slack) and claims again", async () => {
  let t = 0;
  const q: string[][] = [["a"], [], ["c"], []];
  const ran: string[] = [], slept: number[] = [], soonAsked: number[] = [];
  const soons = [3_000, null];
  const n = await runBatches(async () => q.shift() ?? [], async (j: string) => { ran.push(j); t += 2_000; }, {
    now: () => t,
    soon: async () => { soonAsked.push(t); return soons.shift() ?? null; },
    sleep: async (ms) => { slept.push(ms); t += ms; },
  });
  assertEquals([n, ran, slept, soonAsked.length], [2, ["a", "c"], [3_000 + SOON_SLACK_MS], 2]);
});

Deno.test("runBatches: no soon job, a wait past the budget, or too many waits → stops", async () => {
  // soon 없음(기존 동작): 비면 바로 끝
  assertEquals(await runBatches(async () => [], async () => {}), 0);
  // 기다리면 예산을 넘는다 → 끝
  let slept = 0;
  assertEquals(await runBatches(async () => [], async () => {}, { budgetMs: 3_000, now: () => 0, soon: async () => 3_000,
    sleep: async () => { slept++; } }), 0);
  assertEquals(slept, 0);
  // 시계 차이로 계속 비어도 대기 횟수 상한에서 멈춘다
  let t = 0, waits = 0;
  await runBatches(async () => [], async () => {}, { now: () => t, soon: async () => 100, sleep: async (ms) => { waits++; t += ms; } });
  assertEquals(waits, MAX_SOON_WAITS);
});

// 호스팅 DB: nextDeferredWait 는 곧(창 안) 풀릴 queued 잡만 본다. 실행 태그 잡만(AGENTS.md §7)
Deno.test("nextDeferredWait + runBatches: a job deferred a few seconds is picked up in the same call", async () => {
  try {
    const soonAt = new Date(Date.now() + 2_000).toISOString(), lateAt = new Date(Date.now() + 60_000).toISOString();
    const { data: rows } = await sb.from("jobs").insert([
      { kind: "t", lease_key: `${RUN}:s1`, not_before: soonAt },
      { kind: "t", lease_key: `${RUN}:s2`, not_before: lateAt },        // 실패 백오프처럼 창 밖 → 기다리지 않는다
    ]).select("id, lease_key");
    const soonId = rows!.find((r) => r.lease_key === `${RUN}:s1`)!.id;
    const w = await nextDeferredWait(sb, RUN, SOON_WINDOW_MS);
    assertEquals(w !== null && w > 0 && w <= 2_500, true);
    assertEquals(await nextDeferredWait(sb, "test:nope-", SOON_WINDOW_MS), null);   // 다른 접두는 안 본다
    const ran: string[] = [];
    const claim = async () =>
      ((await sb.rpc("claim_jobs", { p_limit: 1, p_lease_seconds: 180, p_lease_prefix: RUN })).data ?? []) as { id: string }[];
    const n = await runBatches(claim, async (j) => { ran.push(j.id); await sb.rpc("complete_job", { p_id: j.id, p_checkpoint: "done" }); },
      { budgetMs: 20_000, soon: () => nextDeferredWait(sb, RUN, SOON_WINDOW_MS) });
    assertEquals([n, ran], [1, [soonId]]);
  } finally {
    await deleteRunJobs();
  }
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
