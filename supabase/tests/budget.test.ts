import { assertEquals, assertRejects } from "jsr:@std/assert";
import { type BudgetDeps, costKrw, Deferred, guarded, nextMonthSeoul } from "../functions/_shared/budget.ts";

function fake(level: "ok" | "degraded" | "refused", slot: number | null = 1) {
  const calls: string[] = [];
  const d: BudgetDeps = {
    reserve: async (_u, k, e) => { calls.push(`reserve:${k}:${e}`); return level; },
    settle: async (_u, _k, e, a) => { calls.push(`settle:${e}->${a}`); },
    acquire: async () => { calls.push("acquire"); return slot; },
    release: async () => { calls.push("release"); },
    now: () => new Date("2026-12-20T03:00:00Z"),
  };
  return { d, calls };
}

Deno.test("costKrw: gpt-6-luna 1.5k in / 0.3k out at 1400 KRW/USD", () => {
  assertEquals(costKrw("gpt-6-luna", { input: 1500, output: 300 }, 1400), 0.42);
});
Deno.test("nextMonthSeoul: Seoul calendar month, December rolls over", () => {
  assertEquals(nextMonthSeoul(new Date("2026-12-31T16:00:00Z")), "2027-02-01T00:00:00+09:00");   // 서울은 이미 1월 1일
  assertEquals(nextMonthSeoul(new Date("2026-12-20T03:00:00Z")), "2027-01-01T00:00:00+09:00");
});
Deno.test("guarded: ok → call with level, settle to actual, release slot", async () => {
  const { d, calls } = fake("ok");
  const r = await guarded(d, "u", "extract", 0.5, "j1", async (lv) => ({ value: lv, actualKrw: 0.3 }));
  assertEquals([r.value, r.level], ["ok", "ok"]);
  assertEquals(calls, ["reserve:extract:0.5", "acquire", "settle:0.5->0.3", "release"]);
});
// Review Focus 4: 소진은 실패가 아니라 다음 달로 미룬다
Deno.test("guarded: refused → Deferred to next month (no call, no slot)", async () => {
  const { d, calls } = fake("refused");
  const e = await assertRejects(() => guarded(d, "u", "extract", 0.5, "j1", async () => ({ value: 1, actualKrw: 0 })), Deferred);
  assertEquals([e.until, e.message, calls], ["2027-01-01T00:00:00+09:00", "budget_exhausted", ["reserve:extract:0.5"]]);
});
Deno.test("guarded: no LLM slot → reservation undone, Deferred 30s", async () => {
  const { d, calls } = fake("degraded", null);
  const e = await assertRejects(() => guarded(d, "u", "chat", 2, "c1", async () => ({ value: 1, actualKrw: 0 })), Deferred);
  assertEquals([e.message, calls], ["llm_busy", ["reserve:chat:2", "acquire", "settle:2->0"]]);
});
Deno.test("guarded: call throws → settle 0 and release, error propagates", async () => {
  const { d, calls } = fake("ok");
  await assertRejects(() => guarded(d, "u", "extract", 0.5, "j1", async () => { throw new Error("openai 500"); }), Error, "openai 500");
  assertEquals(calls.slice(-2), ["settle:0.5->0", "release"]);
});
