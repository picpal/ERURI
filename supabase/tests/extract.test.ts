import { assert, assertEquals, assertRejects, assertThrows } from "jsr:@std/assert";
import { buildExtractRequest, EVENT_SCHEMA, normalizeEvent, parseExtractResponse, seoulToday } from "../functions/_shared/extract.ts";
import { extractMedia, type MediaDeps, mediaTypeOf, VISION_MONTHLY_LIMIT } from "../functions/worker/extract.ts";
import type { Job } from "../functions/_shared/job.ts";

// ── 스키마·요청 (스펙 §3 strict 규칙, §12 통제 3 store:false) ──
Deno.test("schema is strict: additionalProperties false, every property required", () => {
  assertEquals(EVENT_SCHEMA.additionalProperties, false);
  assertEquals([...EVENT_SCHEMA.required].sort(), Object.keys(EVENT_SCHEMA.properties).sort());
});

Deno.test("request: image → input_image data URL, pdf → input_file, OCR text alongside, store false, strict", () => {
  const r = buildExtractRequest({ imageBase64: "AAA", mediaType: "image/png", ocrText: "합성 OCR" }, "2026-09-27");
  assertEquals([r.model, r.store, r.text.format.type, r.text.format.strict], ["gpt-6-luna", false, "json_schema", true]);
  const c = r.input[0].content;
  assertEquals(c[0], { type: "input_image", detail: "high", image_url: "data:image/png;base64,AAA" });
  assertEquals(c[1].type, "input_text");
  assert((c[1] as { text: string }).text.includes("합성 OCR"));
  assert((c.at(-1) as { text: string }).text.includes("2026-09-27"));   // 오늘 날짜를 주입(하드코딩 금지)
  const p = buildExtractRequest({ pdfBase64: "PDF" }, "2026-09-27").input[0].content[0];
  assertEquals(p, { type: "input_file", filename: "notice.pdf", file_data: "data:application/pdf;base64,PDF" });
  assertThrows(() => buildExtractRequest({}, "2026-09-27"), Error, "extract empty_input");
});

Deno.test("seoulToday uses Asia/Seoul date, not UTC", () => {
  assertEquals(seoulToday(new Date("2026-09-26T16:30:00Z")), "2026-09-27");   // UTC 16:30 = 서울 01:30 다음 날
  assertEquals(seoulToday(new Date("2026-09-26T14:59:00Z")), "2026-09-26");
});

// ── 정규화: ISO 8601 + Asia/Seoul(+09:00) ──
Deno.test("normalize: local time without offset is Seoul, Z/other offsets converted to +09:00", () => {
  const e = normalizeEvent({ title: " 결혼식 ", start: "2026-10-17T13:00", end: "2026-10-17T06:00:00Z", location: "  더채플  ", uncertain: [] });
  assertEquals(e, { title: "결혼식", start: "2026-10-17T13:00:00+09:00", end: "2026-10-17T15:00:00+09:00", location: "더채플", uncertain: [] });
  assertEquals(normalizeEvent({ title: "x", start: "2026-12-05T18:00:00+09:00", end: null, location: null, uncertain: [] }).start,
    "2026-12-05T18:00:00+09:00");
  assertEquals(normalizeEvent({ title: "x", start: "2026-12-05 09:00:00-05:00", end: null, location: null, uncertain: [] }).start,
    "2026-12-05T23:00:00+09:00");
});

Deno.test("normalize: date-only stays a date (all-day); garbage start → null + date uncertain", () => {
  assertEquals(normalizeEvent({ title: "x", start: "2026-10-24", end: null, location: null, uncertain: [] }).start, "2026-10-24");
  const bad = normalizeEvent({ title: "x", start: "10월 17일 오후", end: "모름", location: "", uncertain: ["ampm"] });
  assertEquals(bad, { title: "x", start: null, end: null, location: null, uncertain: ["ampm", "date", "end"] });
  const none = normalizeEvent({ title: "", start: null, end: null, location: null, uncertain: [] });
  assertEquals([none.title, none.uncertain], [null, ["date"]]);
});

Deno.test("normalize: end before start is dropped as uncertain; unknown/duplicate uncertain codes removed", () => {
  const e = normalizeEvent({ title: "x", start: "2026-10-17T13:00:00+09:00", end: "2026-10-17T11:00:00+09:00", location: null,
    uncertain: ["year", "year", "bogus"] });
  assertEquals([e.end, e.uncertain], [null, ["year", "end"]]);
});

Deno.test("normalize: model flags make uncertain deterministic — no year in text → year, lunar-only date → date", () => {
  const e = normalizeEvent({ title: "x", start: "2026-10-31T11:30:00+09:00", end: null, location: null, uncertain: [], year_in_text: false, lunar: false });
  assertEquals(e.uncertain, ["year"]);
  const l = normalizeEvent({ title: "칠순", start: "2026-10-25T12:30:00+09:00", end: null, location: null, uncertain: [], year_in_text: true, lunar: true });
  assertEquals(l.uncertain, ["date"]);
  assertEquals(Object.keys(l).sort(), ["end", "location", "start", "title", "uncertain"]);     // 플래그는 결과에 남기지 않는다
});

Deno.test("normalize: no year in text → server picks the nearest future year (model sometimes says next year)", () => {
  const ev = (start: string, end: string | null = null) => ({ title: "x", start, end, location: null, uncertain: [], year_in_text: false, lunar: false });
  assertEquals(normalizeEvent(ev("2027-11-14T12:00:00+09:00"), "2026-09-27").start, "2026-11-14T12:00:00+09:00");
  assertEquals(normalizeEvent(ev("2026-03-02T10:00:00+09:00"), "2026-09-27").start, "2027-03-02T10:00:00+09:00");   // 지난 날짜 → 내년
  assertEquals(normalizeEvent(ev("2026-09-27T09:00:00+09:00"), "2026-09-27").start, "2026-09-27T09:00:00+09:00");   // 오늘은 올해
  const withEnd = normalizeEvent(ev("2027-12-05T18:00:00+09:00", "2027-12-05T21:00:00+09:00"), "2026-09-27");
  assertEquals([withEnd.start, withEnd.end], ["2026-12-05T18:00:00+09:00", "2026-12-05T21:00:00+09:00"]);
  assertEquals(normalizeEvent(ev("2026-10-24"), "2026-09-27").start, "2026-10-24");                                     // 날짜만도 같은 규칙
  assertEquals(normalizeEvent({ ...ev("2027-11-14T12:00:00+09:00"), year_in_text: true }, "2026-09-27").start, "2027-11-14T12:00:00+09:00");
});

// ── 응답 파싱: 잘림·거절은 실패, 본문은 오류 메시지에 넣지 않는다 ──
const ok = (json: unknown) => ({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(json) }] }],
  output_text: JSON.stringify(json), usage: { input_tokens: 1200, output_tokens: 60 } });
Deno.test("parse: completed → normalized event; incomplete/refusal → error without body", () => {
  const e = parseExtractResponse(ok({ title: "t", start: "2026-10-31T11:30:00", end: null, location: "라움", uncertain: ["year"] }));
  assertEquals(e.start, "2026-10-31T11:30:00+09:00");
  assertThrows(() => parseExtractResponse({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [], output_text: "{\"title\":\"비밀" }),
    Error, "openai incomplete max_output_tokens");
  const refused = { status: "completed", output: [{ type: "message", content: [{ type: "refusal", refusal: "no" }] }], output_text: "" };
  assertThrows(() => parseExtractResponse(refused), Error, "openai refusal");
});

// ── worker extract 잡: Storage → vision(월 100건) → 초과 시 OCR 폴백 → facts/proposals ──
const EVENT = { title: "결혼식", start: "2026-10-17T13:00:00+09:00", end: null, location: "더채플", uncertain: [] as string[] };
function deps(o: { storageKey?: string | null; ocr?: string | null; allowed?: boolean; bytes?: number; extractThrows?: boolean; recordFails?: boolean } = {}) {
  const calls = { reserve: 0, download: 0, extract: [] as Record<string, unknown>[], saved: [] as unknown[], tokens: 0, notify: [] as string[],
    recorded: [] as unknown[][] };
  const d: MediaDeps = {
    getItem: async () => ({ storage_key: o.storageKey === undefined ? "media/u1/a.png" : o.storageKey, ocr_text_enc: o.ocr === null ? null : "enc" }),
    decrypt: async () => o.ocr ?? "합성 OCR 텍스트",
    reserveVision: async () => { calls.reserve++; return o.allowed ?? true; },
    download: async () => { calls.download++; return new Uint8Array(o.bytes ?? 4); },
    extract: async (input, onUsage) => { calls.extract.push(input); onUsage?.({ input: 1000, cached: 0, output: 50 });
      if (o.extractThrows) throw new Error("openai refusal");
      return { event: EVENT, usage: { input_tokens: 1000, output_tokens: 50 } }; },
    record: async (_u, lines) => { if (o.recordFails) throw new Error("record_usage 42883"); calls.recorded.push(lines.map((l) => [l.kind, l.model, l.input, l.output])); },
    addTokens: async (_u, n) => { calls.tokens += n; },
    saveEvent: async (_u, item, ev, via) => { calls.saved.push([item, ev.title, via]); return { factId: "f1", proposalId: "p1", created: true }; },
    enqueueNotify: async (_u, p) => { calls.notify.push(p); },
  };
  return { d, calls };
}
const job = (payload: Record<string, unknown> = { item_id: "i1" }): Job => ({ id: "j1", kind: "extract", user_id: "u1", payload, attempts: 1, checkpoint: null });

Deno.test("extract job: vision path sends image + OCR text, counts tokens, saves fact → proposed", async () => {
  const { d, calls } = deps();
  assertEquals(await extractMedia(d, job()), "proposed");
  assertEquals([calls.reserve, calls.download, calls.tokens], [1, 1, 1050]);
  assertEquals(Object.keys(calls.extract[0]).sort(), ["imageBase64", "mediaType", "ocrText"]);
  assertEquals(calls.extract[0].mediaType, "image/png");
  assertEquals(calls.saved, [["i1", "결혼식", "vision"]]);
  assertEquals(calls.notify, ["p1"]);
});

Deno.test("extract job: PDF goes as pdfBase64", async () => {
  const { d, calls } = deps({ storageKey: "media/u1/notice.PDF" });
  await extractMedia(d, job());
  assertEquals(Object.keys(calls.extract[0]).sort(), ["ocrText", "pdfBase64"]);
});

Deno.test("extract job: monthly vision cap reached → OCR text only, no Storage download", async () => {
  const { d, calls } = deps({ allowed: false });
  assertEquals(await extractMedia(d, job()), "proposed");
  assertEquals([calls.download, Object.keys(calls.extract[0])], [0, ["ocrText"]]);
  assertEquals(calls.saved, [["i1", "결혼식", "ocr"]]);
  assertEquals(VISION_MONTHLY_LIMIT, 100);
});

Deno.test("extract job: cap reached and no OCR → needs_review without any model call", async () => {
  const { d, calls } = deps({ allowed: false, ocr: null });
  assertEquals(await extractMedia(d, job()), "needs_review");
  assertEquals([calls.extract.length, calls.saved.length], [0, 0]);
});

Deno.test("extract job: PDF over 10MB → needs_review (spec §7), unknown media and missing storage key fail with codes", async () => {
  const big = deps({ storageKey: "media/u1/x.pdf", bytes: 10 * 1024 * 1024 + 1 });
  assertEquals(await extractMedia(big.d, job()), "needs_review");
  assertEquals(big.calls.extract.length, 0);
  await assertRejects(() => extractMedia(deps({ storageKey: "media/u1/x.heic" }).d, job()), Error, "extract unsupported_media");
  await assertRejects(() => extractMedia(deps({ storageKey: null }).d, job()), Error, "extract no_storage_key");
  await assertRejects(() => extractMedia(deps().d, { ...job(), user_id: null }), Error, "extract job without user_id");
});

// 스펙 §13 "vision은 기록만": 예약 없이 record_usage(kind vision) — vision 경로·OCR 글 경로 모두
Deno.test("extract billing: vision and OCR-text paths record one vision line (no budget reservation)", async () => {
  const v = deps();
  await extractMedia(v.d, job());
  assertEquals(v.calls.recorded, [[["vision", "gpt-6-luna", 1000, 50]]]);
  const ocr = deps({ allowed: false });
  await extractMedia(ocr.d, job());
  assertEquals(ocr.calls.recorded, [[["vision", "gpt-6-luna", 1000, 50]]]);
});
Deno.test("extract billing: a refused/unparsable response is still recorded before the job fails", async () => {
  const { d, calls } = deps({ extractThrows: true });
  let thrown = "";
  try { await extractMedia(d, job()); } catch (e) { thrown = (e as Error).message; }
  assertEquals([thrown, calls.recorded.length], ["openai refusal", 1]);
});
// 기록은 예산과 무관 — 실패해도 추출 결과를 버리지 않는다(로그 코드 record_usage_error)
Deno.test("extract billing: record_usage failing does not fail the job", async () => {
  const { d, calls } = deps({ recordFails: true });
  assertEquals(await extractMedia(d, job()), "proposed");
  assertEquals(calls.saved.length, 1);
});

Deno.test("mediaTypeOf maps extensions", () => {
  assertEquals([mediaTypeOf("a/b.jpg"), mediaTypeOf("a/b.JPEG"), mediaTypeOf("b.png"), mediaTypeOf("b.pdf"), mediaTypeOf("b.gif")],
    ["image/jpeg", "image/jpeg", "image/png", "application/pdf", null]);
});

Deno.test("normalize: no end in the text (end null) → model's uncertain end is dropped (spec §8 — '18:00 이후' must stay addable)", () => {
  const e = normalizeEvent({ title: "팀 회식", start: "2026-10-14T18:00:00+09:00", end: null, location: null, uncertain: ["end"] });
  assertEquals([e.end, e.uncertain], [null, []]);
  const kept = normalizeEvent({ title: "x", start: "2026-10-14T18:00:00+09:00", end: null, location: null, uncertain: ["end", "ampm"] });
  assertEquals(kept.uncertain, ["ampm"]);
});
