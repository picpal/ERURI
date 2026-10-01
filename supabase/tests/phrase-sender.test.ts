import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert";
import { parseSenderArgs, runSender, sha8 } from "../scripts/_phrase-sender.ts";

Deno.test("sha8 matches iOS Trace.sha8 (SHA-256 hex first 8)", async () => {
  assertEquals(await sha8("abc"), "ba7816bf");                       // TraceTests.testSha8 와 같은 값
});

Deno.test("args: defaults, --only, --gap, --dry-run", () => {
  assertEquals(parseSenderArgs([], 25), { only: null, gapSec: 25, dryRun: false });
  assertEquals(parseSenderArgs(["--only", "d02,d09", "--gap", "5", "--dry-run"], 25), { only: ["d02", "d09"], gapSec: 5, dryRun: true });
  // 최종 리뷰 triage(Task 6 minor): 값 없는 --only 는 전체 발송이 아니라 오류
  for (const a of [["--only"], ["--only", ""], ["--only", " , "], ["--only", "--dry-run"]]) {
    assertThrows(() => parseSenderArgs(a, 25), Error, "--only needs phrase ids");
  }
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

Deno.test("runSender: multi (device gate) is left out of the default list; --only multi renders future dates", async () => {
  const now = () => new Date("2026-09-29T02:00:00Z");
  const sent: string[] = [], lines: string[] = [];
  await runSender(async (t) => { sent.push(t); return { ok: true, code: "200" }; }, { only: null, gapSec: 0, dryRun: false }, { now, print: (s) => lines.push(s) });
  assertEquals(lines.some((l) => l.startsWith("multi\t")), false);
  sent.length = 0;
  await runSender(async (t) => { sent.push(t); return { ok: true, code: "200" }; }, { only: ["multi"], gapSec: 0, dryRun: false }, { now, print: () => {} });
  assertEquals(sent, ["[합성문화센터] 도자기 클래스 1회차 10월 2일(금) 오후 2시, 2회차 10월 9일(금) 오후 2시입니다. 신청 마감은 10월 1일(목)까지입니다."]);
});
