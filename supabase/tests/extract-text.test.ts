import { assert, assertEquals, assertThrows } from "jsr:@std/assert";
import { buildTextExtractRequest, EVIDENCE_MAX, MAX_TEXT_CHARS, normalizeTextExtraction, parseTextExtractResponse, TEXT_SCHEMA }
  from "../functions/_shared/extract-text.ts";
import { receivedDay, seoulToday } from "../functions/_shared/time.ts";
import { proposalAction, textFact } from "../functions/_shared/facts.ts";
import { planProposalPush } from "../functions/_shared/notify.ts";
import { PUSH_TEMPLATE, renderPhrase } from "../eval/phrases.ts";

// 문구는 전부 합성(AGENTS.md §7)
const META = { source: "NOTIFICATION", appName: "Slack", title: "합성채널" };
const raw = (o: Record<string, unknown> = {}) => ({ kind: "none", title: null, start: null, end: null, location: null, due: null, merchant: null,
  products: [], ordered_at: null, amount: null, currency: null, order_no: null, order_status: null, evidence: null, uncertain: [],
  year_in_text: true, lunar: false, ...o }) as never;
const textOf = (r: ReturnType<typeof buildTextExtractRequest>, i: number) => (r.input[0].content[i] as { text: string }).text;

Deno.test("text schema is strict: additionalProperties false, every property required", () => {
  assertEquals(TEXT_SCHEMA.additionalProperties, false);
  assertEquals([...TEXT_SCHEMA.required].sort(), Object.keys(TEXT_SCHEMA.properties).sort());
});

Deno.test("text request: gpt-6-luna, store false, effort none, strict; source/app/title head; received day in instruction", () => {
  const r = buildTextExtractRequest("[합성의원] 내일 오후 3시 진료", META, "2026-09-29");
  assertEquals([r.model, r.store, r.reasoning.effort, r.text.format.strict, r.text.format.name], ["gpt-6-luna", false, "none", true, "text_fact"]);
  assert(textOf(r, 0).startsWith("출처: NOTIFICATION\n앱: Slack\n제목: 합성채널\n메시지:\n[합성의원]"));
  assert(textOf(r, 1).includes("2026-09-29"));
  const bare = buildTextExtractRequest("합성", { source: "MESSAGES", appName: null, title: null }, "2026-09-29");
  assertEquals(textOf(bare, 0), "출처: MESSAGES\n메시지:\n합성");
});

Deno.test("text request: body over 4,000 chars is cut; blank body throws", () => {
  const r = buildTextExtractRequest("가".repeat(MAX_TEXT_CHARS + 500), META, "2026-09-29");
  assertEquals(textOf(r, 0).split("메시지:\n")[1].length, MAX_TEXT_CHARS);
  assertThrows(() => buildTextExtractRequest("  \n", META, "2026-09-29"), Error, "extract empty_input");
});

// Review Focus 1: 상대 날짜·연도의 기준일 = 받은 날(서울), 처리 시각이 아니다
Deno.test("received day: occurred_at in Seoul; year chosen from the received day", () => {
  assertEquals(receivedDay("2026-09-28T15:30:00Z"), "2026-09-29");                 // UTC 15:30 = 서울 다음 날 00:30
  const now = new Date("2026-09-29T01:00:00Z");
  assertEquals(receivedDay("bad", now), seoulToday(now));
  const r = buildTextExtractRequest("내일 3시 치과", META, receivedDay("2026-12-31T05:00:00Z"));
  assert(textOf(r, 1).includes("2026-12-31"));
  const x = normalizeTextExtraction(raw({ kind: "event", title: "치과", start: "2026-01-01T15:00:00+09:00", year_in_text: false }), "2026-12-31");
  assertEquals(x.kind === "event" && x.event.start, "2027-01-01T15:00:00+09:00");
});

// 최종 리뷰 C1: 연도 없는 문자 약속은 받은 날 기준으로 연도가 정해지므로 uncertain year 가 붙지 않고 ADD_EVENT 로 간다.
// 리뷰어 실측 4건(PoC-5 PUSH_TEMPLATE +3일 15:30 ×2, "내일 오후 3시 30분 진료 예약" ×2)의 모델 출력 형태(uncertain=[], year_in_text=false)
Deno.test("C1: year missing in text → no uncertain year → planProposalPush ADD_EVENT with the +09:00 start", () => {
  const today = "2026-09-29";
  assertEquals(renderPhrase(PUSH_TEMPLATE, today), "[합성의원] 10월 2일(금) 오후 3시 30분 진료 예약이 확정되었습니다.");
  const cases: [string, string][] = [
    ["2026-10-02T15:30:00+09:00", "2026-10-02T15:30:00+09:00"],     // PUSH_TEMPLATE 1회차
    ["2026-10-02T15:30", "2026-10-02T15:30:00+09:00"],              // PUSH_TEMPLATE 2회차(오프셋 없음)
    ["2026-09-30T15:30:00+09:00", "2026-09-30T15:30:00+09:00"],     // "내일 오후 3시 30분 진료 예약" 1회차
    ["2027-09-30T15:30:00+09:00", "2026-09-30T15:30:00+09:00"],     // 2회차: 모델이 내년으로 채워도 받은 날 기준으로 되돌린다
  ];
  for (const [start, want] of cases) {
    const x = normalizeTextExtraction(raw({ kind: "event", title: "진료 예약", start, uncertain: [], year_in_text: false }), today);
    assertEquals(x.kind === "event" && [x.event.start, x.event.uncertain], [want, []]);
    const f = textFact("u", "i", x)!;
    const plan = planProposalPush({ id: "p1", action: proposalAction(f.kind)!, payload: f.payload, status: "proposed",
      occurred_at: "2026-09-29T01:00:00Z", captured_at: "2026-09-29T01:00:05Z" }, new Date("2026-09-29T01:01:00Z"));
    assertEquals(plan.skip === null && [plan.category, plan.payload.start], ["ADD_EVENT", want]);
  }
  // 음력(date)·ampm 같은 다른 불확실은 그대로 REVIEW
  const lunar = normalizeTextExtraction(raw({ kind: "event", title: "제사", start: "2026-10-24", year_in_text: false, lunar: true,
    uncertain: ["ampm"] }), today);
  assertEquals(lunar.kind === "event" && lunar.event.uncertain.sort(), ["ampm", "date"]);
  const due = normalizeTextExtraction(raw({ kind: "task", title: "납부", due: "2026-10-04", year_in_text: false }), today);
  assertEquals(due.kind === "task" && due.task.uncertain, []);
});

Deno.test("normalize: event without start / task without title / purchase without merchant and amount → none", () => {
  assertEquals(normalizeTextExtraction(raw({ kind: "event", title: "약속", start: null }), "2026-09-29"), { kind: "none" });
  assertEquals(normalizeTextExtraction(raw({ kind: "task", title: "  " }), "2026-09-29"), { kind: "none" });
  assertEquals(normalizeTextExtraction(raw({ kind: "purchase", merchant: null, amount: null }), "2026-09-29"), { kind: "none" });
  assertEquals(normalizeTextExtraction(raw({ kind: "none", title: "무시" }), "2026-09-29"), { kind: "none" });
});

Deno.test("normalize: event → Seoul ISO + uncertain; evidence trimmed and cut at 300", () => {
  const x = normalizeTextExtraction(raw({ kind: "event", title: " 치과 진료 ", start: "2026-10-02T15:30", location: "합성의원",
    evidence: "  " + "가".repeat(400) }), "2026-09-29");
  assertEquals(x.kind, "event");
  if (x.kind !== "event") return;
  assertEquals([x.event.title, x.event.start, x.event.location, x.event.uncertain], ["치과 진료", "2026-10-02T15:30:00+09:00", "합성의원", []]);
  assertEquals(x.evidence!.length, EVIDENCE_MAX);
});

Deno.test("normalize: task due uses the event date rules; no due → no uncertain; unreadable due → date", () => {
  const t = normalizeTextExtraction(raw({ kind: "task", title: "수도요금 납부", due: "2026-10-04" }), "2026-09-29");
  assertEquals(t, { kind: "task", task: { title: "수도요금 납부", due: "2026-10-04", uncertain: [] }, evidence: null });
  const n = normalizeTextExtraction(raw({ kind: "task", title: "서류 제출", due: null }), "2026-09-29");
  assertEquals(n.kind === "task" && n.task, { title: "서류 제출", due: null, uncertain: [] });
  const bad = normalizeTextExtraction(raw({ kind: "task", title: "회신", due: "다음 주쯤" }), "2026-09-29");
  assertEquals(bad.kind === "task" && bad.task.uncertain, ["date"]);
});

Deno.test("normalize: purchase keeps merchant/amount/products, normalizes ordered_at, trims fields", () => {
  const p = normalizeTextExtraction(raw({ kind: "purchase", merchant: " 합성커피 ", amount: 32000, currency: "KRW", products: [" 아메리카노 ", ""],
    ordered_at: "2026-09-29T12:41", order_status: "paid", evidence: "승인 32,000원" }), "2026-09-29");
  assertEquals(p, { kind: "purchase", evidence: "승인 32,000원", purchase: { merchant: "합성커피", products: ["아메리카노"],
    ordered_at: "2026-09-29T12:41:00+09:00", amount: 32000, currency: "KRW", order_no: null, status: "paid" } });
});

const resp = (json: unknown) => ({ status: "completed", output: [{ type: "message", content: [{ type: "output_text" }] }], output_text: JSON.stringify(json) });
Deno.test("parse: completed → normalized; incomplete/refusal/bad JSON → error codes without body", () => {
  assertEquals(parseTextExtractResponse(resp(raw({ kind: "task", title: "납부", due: "2026-10-04" })), "2026-09-29").kind, "task");
  assertThrows(() => parseTextExtractResponse({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [], output_text: "{" },
    "2026-09-29"), Error, "openai incomplete max_output_tokens");
  assertThrows(() => parseTextExtractResponse({ status: "completed", output: [{ type: "message", content: [{ type: "refusal" }] }], output_text: "" },
    "2026-09-29"), Error, "openai refusal");
  assertThrows(() => parseTextExtractResponse({ status: "completed", output: [], output_text: "비밀 본문" }, "2026-09-29"), Error, "openai bad_json");
});
