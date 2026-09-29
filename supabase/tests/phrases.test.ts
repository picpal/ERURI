import { assert, assertEquals } from "jsr:@std/assert";
import type { TextExtraction } from "../functions/_shared/extract-text.ts";
import { applyRules } from "../functions/_shared/rules.ts";
import { DEVICE10, expectedStatus, type Phrase, PUSH_TEMPLATE, renderPhrase } from "../eval/phrases.ts";
import { runPhrase } from "../eval/phrase-harness.ts";

const TODAY = "2026-09-29";   // 화요일
const SAMPLE: Record<"event" | "task" | "purchase", TextExtraction> = {
  event: { kind: "event", evidence: null, event: { title: "합성", start: "2026-10-02T15:30:00+09:00", end: null, location: null, uncertain: [] } },
  task: { kind: "task", evidence: null, task: { title: "합성 납부", due: "2026-10-10", uncertain: [] } },
  purchase: { kind: "purchase", evidence: null, purchase: { merchant: "합성", products: [], ordered_at: null, amount: 1, currency: "KRW", order_no: null, status: null } },
};
const fakeExtract = (p: Phrase) => async () => ({ result: p.kinds.length === 0 ? { kind: "none" } as TextExtraction : SAMPLE[p.kinds[0]], usage: { input_tokens: 1, output_tokens: 1 } });

Deno.test("fixture: d01~d10 from phrases.json with server expectations", () => {
  assertEquals(DEVICE10.map((p) => p.id), ["d01", "d02", "d03", "d04", "d05", "d06", "d07", "d08", "d09", "d10"]);
  assertEquals(DEVICE10.filter((p) => p.label !== "actionable").map((p) => [p.id, p.label]), [["d06", "promo"], ["d07", "otp"], ["d09", "personal"], ["d10", "personal"]]);
  assertEquals(renderPhrase(PUSH_TEMPLATE, TODAY), "[합성의원] 10월 2일(금) 오후 3시 30분 진료 예약이 확정되었습니다.");
  assertEquals(renderPhrase("{D+0}/{D+1}", "2026-12-31"), "12월 31일/1월 1일");
});

Deno.test("fixture: server rules verdict matches p.rules", () => {
  for (const p of DEVICE10) {
    const v = applyRules(p.text);
    assertEquals(v.kind === "discard" ? v.reason : "pass", p.rules, p.id);
  }
});

Deno.test("pipeline routing matches expected status for provider none and a confident Jev", async () => {
  for (const p of DEVICE10) {
    const none = await runPhrase(p, { classifier: { provider: "none", classify: async () => null }, threshold: 0.8, extract: fakeExtract(p), today: TODAY });
    assertEquals(none.status, expectedStatus(p, "none"), `${p.id} none`);
    const jev = await runPhrase(p, { classifier: { provider: "jev", classify: async () => ({ label: p.label, confidence: 0.95 }) }, threshold: 0.8,
      extract: fakeExtract(p), today: TODAY });
    assertEquals(jev.status, expectedStatus(p, "jev"), `${p.id} jev`);
    if (jev.status === "extracted") assert(p.kinds.includes(jev.kind as never), p.id);
  }
});
