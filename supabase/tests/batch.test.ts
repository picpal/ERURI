import { assertEquals } from "jsr:@std/assert";
import { runBatches } from "../functions/worker/batch.ts";

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
