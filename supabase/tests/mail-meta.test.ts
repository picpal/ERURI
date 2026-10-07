import { assertEquals } from "jsr:@std/assert";
import type { GmailMessage } from "../functions/_shared/gmail.ts";
import { candidateMeta, clip16, sampleOf } from "../functions/_shared/mail-meta.ts";
import { sampleOf as fromHandler } from "../functions/mail-action/handler.ts";

const mk = (from: string | null, subject: string | null, internalDate = "1791212400000"): GmailMessage => ({ id: "x", internalDate,
  payload: { headers: [...(from === null ? [] : [{ name: "From", value: from }]), ...(subject === null ? [] : [{ name: "Subject", value: subject }])] } });

Deno.test("clip16: UTF-16 n without a lone high surrogate at the end", () => {
  assertEquals(clip16("가".repeat(5), 3), "가가가");
  assertEquals(clip16("a".repeat(99) + "🎉", 100), "a".repeat(99));
  assertEquals(clip16("abc", 10), "abc");
});
Deno.test("sampleOf moved to _shared — mail-action still exports the same function", () => {
  assertEquals(fromHandler, sampleOf);
  assertEquals(sampleOf(mk("합성상점 <shop@example.com>", "합성 안내")), { from: "합성상점", subject: "합성 안내", date: "2026-10-05T15:00:00.000Z" });
});
// 스펙 §7 "검색": 후보 제목은 maskSensitive(제목만) 뒤 100자 — 가린 뒤 자른다
Deno.test("candidateMeta: subject is masked (card → last 4) before it is clipped to 100; empty/odd dates like sampleOf", () => {
  const m = candidateMeta(mk("shop@example.com", "결제 카드 4111-1111-1111-1111 승인"));
  assertEquals([m.from, m.subject], ["shop@example.com", "결제 카드 ****-****-****-1111 승인"]);
  assertEquals(candidateMeta(mk(null, "x".repeat(95) + " 4111111111111111")).subject.includes("4111111111111111"), false);
  assertEquals(candidateMeta({ id: "x", internalDate: "abc" }), { from: "", subject: "", date: "" });
});
