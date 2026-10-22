import { assertEquals } from "jsr:@std/assert";
import { normalizeMetrics } from "../functions/_shared/metrics.ts";

// 받은 시각 = 서울 2026-10-22 14:12
const R = "2026-10-22T05:12:00Z";
const at1 = (start: string | null, occurredAt = R) => normalizeMetrics([{ label: "타임아웃", count: 6, start, end: null }], occurredAt)[0];
const mk = (label: string) => ({ label, count: 1, start: null, end: null });

Deno.test("label: trims and collapses spaces; '' and 31 code points dropped; 30 kept; non-string dropped", () => {
  const r = normalizeMetrics([mk("  타임  아웃 "), mk("   "), mk("가".repeat(31)), mk("가".repeat(30)), mk(7 as unknown as string)], R);
  assertEquals(r.map((x) => x.label), ["타임 아웃", "가".repeat(30)]);
});

Deno.test("count: 0, -1, 1.5, 100001, '6' dropped; 1 and 100000 kept", () => {
  assertEquals(normalizeMetrics([0, -1, 1.5, 100001, "6", 1, 100000].map((n) => ({ label: "오류", count: n, start: null, end: null })), R).map((x) => x.count), [1, 100000]);
});

Deno.test("not an array → []; 11 valid → first 10 (after drops)", () => {
  assertEquals(normalizeMetrics(null, R), []);
  assertEquals(normalizeMetrics({}, R), []);
  assertEquals(normalizeMetrics(Array.from({ length: 11 }, (_, i) => ({ label: `l${i}`, count: i + 1, start: null, end: null })), R).map((x) => x.count), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

Deno.test("HH:MM → received Seoul day; received 00:30 KST uses that Seoul date", () => {
  assertEquals(at1("14:00"), { label: "타임아웃", count: 6, at: "2026-10-22T05:00:00.000Z", at_body: true });
  assertEquals(at1("00:10", "2026-10-21T15:30:00Z").at, "2026-10-21T15:10:00.000Z"); // 받음 10/22 00:30 KST → 10/22 00:10 KST
});

Deno.test("YYYY-MM-DD HH:MM and T separator are Seoul", () => {
  assertEquals(at1("2026-10-22 13:30").at, "2026-10-22T04:30:00.000Z");
  assertEquals(at1("2026-10-22T13:30").at, "2026-10-22T04:30:00.000Z");
});

Deno.test("bad forms → received time (at_body false): 24:00, 2026-02-30 10:00, 14시, 14:00:00, 9:30, null", () => {
  for (const s of ["24:00", "2026-02-30 10:00", "14시", "14:00:00", "9:30", null]) {
    assertEquals(at1(s), { label: "타임아웃", count: 6, at: "2026-10-22T05:12:00.000Z", at_body: false }, String(s));
  }
});

Deno.test("offsets: +09:00 kept; Z and +00:00 converted; time-only +09:00 ok, Z/+00:00 → received; +25:00 and +09:07 → received; UTC date rollover", () => {
  assertEquals(at1("2026-10-22 14:00+09:00").at, "2026-10-22T05:00:00.000Z");
  assertEquals(at1("2026-10-22 05:00Z").at, "2026-10-22T05:00:00.000Z");
  assertEquals(at1("2026-10-22 05:00+00:00").at, "2026-10-22T05:00:00.000Z");
  assertEquals(at1("14:00+09:00").at, "2026-10-22T05:00:00.000Z");
  for (const s of ["05:00Z", "05:00+00:00", "2026-10-22 14:00+25:00", "2026-10-22 14:00+09:07"]) assertEquals(at1(s).at_body, false, s);
  assertEquals(at1("2026-10-21 15:30Z", "2026-10-21T15:40:00Z").at, "2026-10-21T15:30:00.000Z"); // 서울 10/22 00:30 — 날짜 넘김
});

Deno.test("window: +24h exactly → body; +24h 1m → received; −168h exactly → body; −168h 1m → received", () => {
  assertEquals(at1("2026-10-23 14:12").at_body, true);
  assertEquals(at1("2026-10-23 14:13").at_body, false);
  assertEquals(at1("2026-10-15 14:12").at_body, true);
  assertEquals(at1("2026-10-15 14:11").at_body, false);
});

Deno.test("module imports only time.ts (no OpenAI client)", async () => {
  const src = await Deno.readTextFile(new URL("../functions/_shared/metrics.ts", import.meta.url));
  assertEquals([...src.matchAll(/from "([^"]+)"/g)].map((x) => x[1]), ["./time.ts"]);
});
