import { assertEquals, assertRejects } from "jsr:@std/assert";
import { parseSenderArgs, runSender, sha8 } from "../../scripts/_phrase-sender.ts";

Deno.test("sha8 matches iOS Trace.sha8 (SHA-256 hex first 8)", async () => {
  assertEquals(await sha8("abc"), "ba7816bf");                       // TraceTests.testSha8 와 같은 값
});

Deno.test("args: defaults, --only, --gap, --dry-run", () => {
  assertEquals(parseSenderArgs([], 25), { only: null, gapSec: 25, dryRun: false });
  assertEquals(parseSenderArgs(["--only", "d02,d09", "--gap", "5", "--dry-run"], 25), { only: ["d02", "d09"], gapSec: 5, dryRun: true });
});

Deno.test("runSender: default = d01~d10 in order; --only keeps fixture order; push renders a future date; no text printed; dry-run; unknown id", async () => {
  const now = () => new Date("2026-09-29T02:00:00Z");
  const all: string[] = [];
  await runSender(async (t) => { all.push(t); return { ok: true, code: "200" }; }, { only: null, gapSec: 0, dryRun: false }, { now, print: () => {} });
  assertEquals(all.length, 10);
  const sent: string[] = [], slept: number[] = [], lines: string[] = [];
  const failures = await runSender(async (t) => { sent.push(t); return { ok: true, code: "200" }; }, { only: ["d09", "d02", "push"], gapSec: 3, dryRun: false },
    { sleep: async (ms) => { slept.push(ms); }, now, print: (s) => lines.push(s) });
  assertEquals([failures, lines.map((l) => l.split("\t")[0]), slept], [0, ["d02", "d09", "push"], [3000, 3000]]);
  assertEquals(sent[2], "[합성의원] 10월 2일(금) 오후 3시 30분 진료 예약이 확정되었습니다.");
  assertEquals(lines.some((l) => sent.some((t) => l.includes(t))), false);
  const dry: string[] = [];
  await runSender(async (t) => { dry.push(t); return { ok: true, code: "200" }; }, { only: null, gapSec: 0, dryRun: true }, { print: () => {} });
  assertEquals(dry.length, 0);
  await assertRejects(() => runSender(async () => ({ ok: true, code: "200" }), { only: ["x99"], gapSec: 0, dryRun: true }, { print: () => {} }),
    Error, "unknown phrase id x99");
});
