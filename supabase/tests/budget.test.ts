import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert";
import { type BudgetDeps, costKrw, Deferred, guarded, type LedgerLine, ledgerLine, LLM_BUSY_DEFER_MS, nextMonthSeoul, responseUsage } from "../functions/_shared/budget.ts";

function fake(level: "ok" | "degraded" | "refused", slot: number | null = 1, month = "2026-12-01") {
  const calls: string[] = [];
  const settled: { month: string; lines: LedgerLine[] }[] = [];
  const d: BudgetDeps = {
    reserve: async (_u, k, e) => { calls.push(`reserve:${k}:${e}`); return { level, month }; },
    settle: async (_u, _k, e, m, lines) => { calls.push(`settle:${e}:${m}:${lines.length}`); settled.push({ month: m, lines: [...lines] }); },
    acquire: async () => { calls.push("acquire"); return slot; },
    release: async () => { calls.push("release"); },
    now: () => new Date("2026-12-20T03:00:00Z"),
  };
  return { d, calls, settled };
}
const U = (input: number, output: number, cached = 0) => ({ input, cached, output });

Deno.test("costKrw: gpt-6-luna 1.5k in / 0.3k out at 1400 KRW/USD", () => {
  assertEquals(costKrw("gpt-6-luna", { input: 1500, output: 300 }, 1400), 0.42);
});
Deno.test("nextMonthSeoul: Seoul calendar month, December rolls over", () => {
  assertEquals(nextMonthSeoul(new Date("2026-12-31T16:00:00Z")), "2027-02-01T00:00:00+09:00");   // 서울은 이미 1월 1일
  assertEquals(nextMonthSeoul(new Date("2026-12-20T03:00:00Z")), "2027-01-01T00:00:00+09:00");
});
Deno.test("costKrw: cached input is billed at the cache price", () => {
  // (600 × 0.10 + 400 × 0.01 + 0) / 1M × 1400 = 0.0896
  assertEquals(costKrw("gpt-6-luna", { input: 1000, cached: 400, output: 0 }, 1400), 0.0896);
});
Deno.test("responseUsage: input·cached·output from a Responses usage; cached is clamped to input; no usage → null", () => {
  assertEquals(responseUsage({ usage: { input_tokens: 1200, output_tokens: 80, input_tokens_details: { cached_tokens: 300 } } }), { input: 1200, cached: 300, output: 80 });
  assertEquals(responseUsage({ usage: { input_tokens: 10, output_tokens: 1, input_tokens_details: { cached_tokens: 99 } } }), { input: 10, cached: 10, output: 1 });
  assertEquals(responseUsage({ usage: { input_tokens: 10, output_tokens: 1 } }), { input: 10, cached: 0, output: 1 });
  assertEquals(responseUsage({}), null);
  assertEquals(responseUsage({ usage: null }), null);
});
Deno.test("ledgerLine: krw = costKrw of the tokens; missing usage counts the call with zero tokens", () => {
  assertEquals(ledgerLine("chat", "gpt-6-luna", U(1500, 300), 1400), { kind: "chat", model: "gpt-6-luna", input: 1500, cached: 0, output: 300, krw: 0.42 });
  assertEquals(ledgerLine("embed", "text-embedding-3-large", null, 1400), { kind: "embed", model: "text-embedding-3-large", input: 0, cached: 0, output: 0, krw: 0 });
});
Deno.test("guarded: ok → call(level, bill), settle on the reserved month with every billed line, release", async () => {
  const { d, calls, settled } = fake("ok");
  const r = await guarded(d, "u", "chat", 2, "c1", async (lv, bill) => {
    bill("chat", "gpt-6-luna", U(800, 100));
    bill("chat", "gpt-6-sol", U(5000, 400, 1000));
    return lv;
  });
  assertEquals([r.value, r.level], ["ok", "ok"]);
  assertEquals(calls, ["reserve:chat:2", "acquire", "settle:2:2026-12-01:2", "release"]);
  assertEquals(settled[0].lines.map((l) => [l.kind, l.model, l.input, l.cached, l.output]), [["chat", "gpt-6-luna", 800, 0, 100], ["chat", "gpt-6-sol", 5000, 1000, 400]]);
});
// 스펙 §13 "월 경계": 예약 응답의 month 를 정산에 그대로 넘긴다 — now() 가 다음 달이어도
Deno.test("guarded: settles on the month the reservation returned, not the month of now()", async () => {
  const { d, settled } = fake("ok", 1, "2026-10-01");
  d.now = () => new Date("2026-11-01T00:00:03+09:00");
  await guarded(d, "u", "extract", 0.5, "j1", async (_lv, bill) => { bill("extract", "gpt-6-luna", U(10, 1)); return 1; });
  assertEquals(settled.map((s) => s.month), ["2026-10-01"]);
});
// Review Focus 3: 응답은 왔지만 파싱이 실패 — 청구된 토큰은 정산한다(지금까지는 actual 0)
Deno.test("guarded: the call throws after a response was billed → that line is settled, error propagates", async () => {
  const { d, calls, settled } = fake("ok");
  await assertRejects(() => guarded(d, "u", "chat", 2, "c1", async (_lv, bill) => {
    bill("chat", "gpt-6-luna", U(800, 100));
    throw new Error("filters incomplete");
  }), Error, "filters incomplete");
  assertEquals(calls.slice(-2), ["settle:2:2026-12-01:1", "release"]);
  assertEquals(settled[0].lines[0].krw > 0, true);
});
Deno.test("guarded: the call throws before any response (network) → settles with no lines (reservation cancelled)", async () => {
  const { d, calls } = fake("ok");
  await assertRejects(() => guarded(d, "u", "extract", 0.5, "j1", async () => { throw new TypeError("fetch failed"); }), TypeError);
  assertEquals(calls.slice(-2), ["settle:0.5:2026-12-01:0", "release"]);
});
Deno.test("guarded: refused → Deferred to next month (no call, no slot, no settle)", async () => {
  const { d, calls } = fake("refused");
  const e = await assertRejects(() => guarded(d, "u", "extract", 0.5, "j1", async () => 1), Deferred);
  assertEquals([e.until, e.message, calls], ["2027-01-01T00:00:00+09:00", "budget_exhausted", ["reserve:extract:0.5"]]);
});
Deno.test("guarded: no LLM slot → reservation cancelled on the same month with no lines, Deferred 5s", async () => {
  const { d, calls } = fake("degraded", null, "2026-12-01");
  const e = await assertRejects(() => guarded(d, "u", "chat", 2, "c1", async () => 1), Deferred);
  assertEquals([e.message, calls], ["llm_busy", ["reserve:chat:2", "acquire", "settle:2:2026-12-01:0"]]);
  assertEquals([LLM_BUSY_DEFER_MS, e.until], [5_000, "2026-12-20T03:00:05.000Z"]);
});
// D10: 호출부 연결 실수를 바로 드러낸다 — 예약 kind 의 허용 짝이 아닌 집계 kind
Deno.test("guarded: a line kind outside the reservation's pairs throws ledger_pair (and still settles what was billed)", async () => {
  const { d, settled } = fake("ok");
  await assertRejects(() => guarded(d, "u", "chat", 2, "c1", async (_lv, bill) => { bill("extract", "gpt-6-luna", U(1, 1)); return 1; }), Error, "ledger_pair chat>extract");
  assertEquals(settled[0].lines, []);
  const ok = fake("ok");
  await guarded(ok.d, "u", "chat", 2, "c1", async (_lv, bill) => { bill("mail_summary", "gpt-6-luna", U(1, 1)); return 1; });
  assertEquals(ok.settled[0].lines.map((l) => l.kind), ["mail_summary"]);
});
Deno.test("costKrw: unknown model still throws price_unknown (bill cannot invent a price)", () => {
  assertThrows(() => ledgerLine("chat", "gpt-9", U(1, 1)), Error, "price_unknown");
});
