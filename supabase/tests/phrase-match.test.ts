import { assertEquals } from "jsr:@std/assert@1";
import { matchPhrases, type Trace } from "../scripts/_phrase-match.ts";

const tr = (at: string, sha: string): Trace => ({ at: `2026-09-30T04:${at}Z`, fields: { text_sha8: sha } });
const summary = (m: ReturnType<typeof matchPhrases>) => m.map((x) => `${x.by ?? "-"}:${x.trace?.fields.text_sha8 ?? "none"}`);

Deno.test("sha match for every phrase", () => {
  assertEquals(summary(matchPhrases(["a", "b"], [tr("12:00", "b"), tr("11:00", "a")])), ["sha:a", "sha:b"]);
});

Deno.test("sha miss falls back to first unpaired trace between neighbours", () => {
  // b 는 Slack 변형으로 sha 가 x 가 됐다. 그 앞 무관 trace(z, a 이전)는 후보가 아니다
  const m = matchPhrases(["a", "b", "c"], [tr("10:00", "z"), tr("11:00", "a"), tr("12:00", "x"), tr("13:00", "c")]);
  assertEquals(summary(m), ["sha:a", "order:x", "sha:c"]);
});

Deno.test("no free trace in window → unmatched", () => {
  const m = matchPhrases(["a", "b", "c"], [tr("11:00", "a"), tr("13:00", "c"), tr("14:00", "y")]);
  assertEquals(summary(m), ["sha:a", "-:none", "sha:c"]);
});

Deno.test("consecutive misses take traces in send order; last phrase takes trailing trace", () => {
  const m = matchPhrases(["a", "b", "c", "d"], [tr("11:00", "a"), tr("12:00", "x"), tr("13:00", "y"), tr("14:00", "q")]);
  assertEquals(summary(m), ["sha:a", "order:x", "order:y", "order:q"]);
});

Deno.test("trace already paired by sha is never reused by order", () => {
  const m = matchPhrases(["a", "b"], [tr("11:00", "a"), tr("12:00", "b"), tr("13:00", "a")]);
  assertEquals(summary(m), ["sha:a", "sha:b"]);
  // a 는 sha 로 11:00 을 가졌으니 b(sha 불일치)는 그 뒤 빈 trace 만 본다
  const m2 = matchPhrases(["a", "b"], [tr("11:00", "a"), tr("12:00", "a")]);
  assertEquals(summary(m2), ["sha:a", "order:a"]);
});
