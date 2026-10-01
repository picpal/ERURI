import { assert, assertEquals, assertThrows } from "jsr:@std/assert";
import { buildTextExtractRequest, EVIDENCE_MAX, MAX_EVENTS, MAX_TEXT_CHARS, normalizeTextExtraction, parseTextExtractResponse, TEXT_SCHEMA }
  from "../functions/_shared/extract-text.ts";
import { receivedDay, seoulToday } from "../functions/_shared/time.ts";
import { proposalAction, textFacts } from "../functions/_shared/facts.ts";
import { planProposalPush } from "../functions/_shared/notify.ts";
import { PUSH_TEMPLATE, renderPhrase } from "../eval/phrases.ts";
import { judge } from "../eval/run-multi-event-eval.ts";

// 문구는 전부 합성(AGENTS.md §7)
const META = { source: "NOTIFICATION", appName: "Slack", title: "합성채널" };
const raw = (o: Record<string, unknown> = {}) => ({ kind: "none", title: null, due: null, merchant: null,
  products: [], ordered_at: null, amount: null, currency: null, order_no: null, order_status: null, evidence: null, uncertain: [],
  year_in_text: true, lunar: false, events: [], ...o }) as never;
const ev = (o: Record<string, unknown> = {}) => ({ title: "합성 일정", start: null, end: null, location: null, uncertain: [],
  year_in_text: true, lunar: false, evidence: null, ...o });
const textOf = (r: ReturnType<typeof buildTextExtractRequest>, i: number) => (r.input[0].content[i] as { text: string }).text;

Deno.test("text schema is strict: additionalProperties false, every property required", () => {
  assertEquals(TEXT_SCHEMA.additionalProperties, false);
  assertEquals([...TEXT_SCHEMA.required].sort(), Object.keys(TEXT_SCHEMA.properties).sort());
});

Deno.test("text schema: events array of strict event objects; no top-level start/end/location", () => {
  const p = TEXT_SCHEMA.properties as Record<string, any>;
  assertEquals(["start", "end", "location"].filter((k) => k in p), []);
  assertEquals(p.events.type, "array");
  const item = p.events.items;
  assertEquals(item.additionalProperties, false);
  assertEquals([...item.required].sort(), Object.keys(item.properties).sort());
  assertEquals([...item.required].sort(), ["end", "evidence", "location", "lunar", "start", "title", "uncertain", "year_in_text"]);
});

Deno.test("text request: output cap 2,048; instruction carries the multi-event rules", () => {
  const r = buildTextExtractRequest("[합성센터] 1회차 10월 4일, 2회차 10월 11일", META, "2026-10-01");
  assertEquals(r.max_output_tokens, 2048);
  const ins = textOf(r, 1);
  for (const s of ["최대 5개", "이른 5개", "별개 일정", "start~end 하나", "부수 일시", "마감", "발표", "첫 회 하나", "80자 이내",
    "받은 해(2026년)", "내년으로 넘기지 않는다", "연도 단서", "작년", "내년", "상대 날짜", "해를 넘어가는", "광고·홍보성 행사 목록"]) assert(ins.includes(s), s);
  assert(!ins.includes("하나를 골라"));
  assert(!ins.includes("가장 가까운 해"));
  // U6: year_in_text 설명은 "연도를 원문으로 정할 수 있음"(단서 포함)
  const p = TEXT_SCHEMA.properties as Record<string, any>;
  assert(p.events.items.properties.year_in_text.description.includes("상대 날짜"));
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
  // U6: '내일'은 받은 날로 정해지는 상대 날짜 = 연도 단서 → 모델이 다음 해로 쓰고 year_in_text true, 서버는 그대로 둔다
  const x = normalizeTextExtraction(raw({ kind: "event", events: [ev({ title: "치과", start: "2027-01-01T15:00:00+09:00", year_in_text: true })] }), "2026-12-31");
  assertEquals(x.kind === "event" && x.events[0].event.start, "2027-01-01T15:00:00+09:00");
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
    const x = normalizeTextExtraction(raw({ kind: "event", events: [ev({ title: "진료 예약", start, uncertain: [], year_in_text: false })] }), today);
    assertEquals(x.kind === "event" && [x.events[0].event.start, x.events[0].event.uncertain], [want, []]);
    const f = textFacts("u", "i", x)!;
    const plan = planProposalPush({ id: "p1", action: proposalAction(f.kind)!, payload: f.entries[0].payload, status: "proposed", version: 1,
      occurred_at: "2026-09-29T01:00:00Z", captured_at: "2026-09-29T01:00:05Z" }, new Date("2026-09-29T01:01:00Z"));
    assertEquals(plan.skip === null && [plan.category, plan.payload.start], ["ADD_EVENT", want]);
  }
  // 음력(date)·ampm 같은 다른 불확실은 그대로 REVIEW
  const lunar = normalizeTextExtraction(raw({ kind: "event", events: [ev({ title: "제사", start: "2026-10-24", year_in_text: false, lunar: true,
    uncertain: ["ampm"] })] }), today);
  assertEquals(lunar.kind === "event" && lunar.events[0].event.uncertain.sort(), ["ampm", "date"]);
  const due = normalizeTextExtraction(raw({ kind: "task", title: "납부", due: "2026-10-04", year_in_text: false }), today);
  assertEquals(due.kind === "task" && due.task.uncertain, []);
});

Deno.test("normalize: event without start / task without title / purchase without merchant and amount → none", () => {
  assertEquals(normalizeTextExtraction(raw({ kind: "event", events: [ev({ title: "약속", start: null })] }), "2026-09-29"), { kind: "none" });
  assertEquals(normalizeTextExtraction(raw({ kind: "task", title: "  " }), "2026-09-29"), { kind: "none" });
  assertEquals(normalizeTextExtraction(raw({ kind: "purchase", merchant: null, amount: null }), "2026-09-29"), { kind: "none" });
  assertEquals(normalizeTextExtraction(raw({ kind: "none", title: "무시" }), "2026-09-29"), { kind: "none" });
});

Deno.test("normalize: event → Seoul ISO + uncertain; evidence trimmed and cut at 300", () => {
  const x = normalizeTextExtraction(raw({ kind: "event", events: [ev({ title: " 치과 진료 ", start: "2026-10-02T15:30", location: "합성의원",
    evidence: "  " + "가".repeat(400) })] }), "2026-09-29");
  assertEquals(x.kind, "event");
  if (x.kind !== "event") return;
  const e = x.events[0].event;
  assertEquals([e.title, e.start, e.location, e.uncertain], ["치과 진료", "2026-10-02T15:30:00+09:00", "합성의원", []]);
  assertEquals(x.events[0].evidence!.length, EVIDENCE_MAX);
});

// Review Focus 4: 시작 없는 일정은 버리고, 같은 시작+제목은 하나, 시작 순, 앞 5개
Deno.test("normalize: duplicates collapsed, sorted by start, capped at 5; no-start entries dropped; per-event evidence", () => {
  const days = ["2026-10-31T18:00", "2026-10-03T09:00", "2026-10-08T19:00", "2026-10-03T09:00", "2026-10-12T20:00", "2026-10-17T13:00", "2026-10-24T10:00"];
  const x = normalizeTextExtraction(raw({ kind: "event", events: [
    ...days.map((s, i) => ev({ title: i === 3 ? "합성 산행" : `합성 ${i}`, start: s, evidence: `근거 ${i}` })),
    ev({ title: "합성 날짜 없음", start: null }),
  ] }), "2026-10-01");
  assertEquals(x.kind, "event");
  if (x.kind !== "event") return;
  // i=1 과 i=3 은 시작이 같지만 제목이 달라 둘 다 남는다 — 같은 시작+제목만 하나로
  assertEquals(x.events.map((e) => e.event.start), ["2026-10-03T09:00:00+09:00", "2026-10-03T09:00:00+09:00", "2026-10-08T19:00:00+09:00",
    "2026-10-12T20:00:00+09:00", "2026-10-17T13:00:00+09:00"]);
  assertEquals(x.events.length, MAX_EVENTS);
  assertEquals(x.events[0].evidence, "근거 1");
  const dup = normalizeTextExtraction(raw({ kind: "event", events: [ev({ title: "합성 공연", start: "2026-10-09T19:30" }),
    ev({ title: " 합성 공연 ", start: "2026-10-09T19:30:00+09:00" })] }), "2026-10-01");
  assertEquals(dup.kind === "event" && dup.events.length, 1);
  assertEquals(normalizeTextExtraction(raw({ kind: "event", events: [ev({ start: null })] }), "2026-10-01"), { kind: "none" });
  assertEquals(normalizeTextExtraction(raw({ kind: "event", events: [] }), "2026-10-01"), { kind: "none" });
});

Deno.test("normalize: date-only events sort as Seoul midnight; evidence per event cut at 300", () => {
  const x = normalizeTextExtraction(raw({ kind: "event", events: [ev({ title: "합성 체험학습", start: "2026-10-23" }),
    ev({ title: "합성 상담", start: "2026-10-16T15:00", evidence: "가".repeat(400) })] }), "2026-10-01");
  assertEquals(x.kind === "event" && x.events.map((e) => e.event.start), ["2026-10-16T15:00:00+09:00", "2026-10-23"]);
  assertEquals(x.kind === "event" && x.events[0].evidence!.length, EVIDENCE_MAX);
});

// Review Focus 9 (U6): 연도 없는 날짜는 받은 해 — 지난 날짜여도 내년으로 넘기지 않고 버리지도 않는다(단건·다건·할 일 기한). 연도 단서(year_in_text true)는 모델 값 그대로
Deno.test("normalize: received year — a past session without a year stays this year and is kept", () => {
  const x = normalizeTextExtraction(raw({ kind: "event", events: [
    ev({ title: "합성 1회차", start: "2026-10-04T14:00", year_in_text: false }),
    ev({ title: "합성 2회차", start: "2026-10-11T14:00", year_in_text: false })] }), "2026-10-05");
  assertEquals(x.kind === "event" && x.events.map((e) => e.event.start), ["2026-10-04T14:00:00+09:00", "2026-10-11T14:00:00+09:00"]);
  // 모델이 옛 규칙대로 다음 해로 채워 와도 단서가 없으면(false) 받은 해로 되돌린다 — 종료도 같은 햇수만큼, uncertain year 없음
  const y = normalizeTextExtraction(raw({ kind: "event", events: [
    ev({ title: "합성 1회차", start: "2027-10-04T14:00", end: "2027-10-04T16:00", year_in_text: false })] }), "2026-10-05");
  assertEquals(y.kind === "event" && [y.events[0].event.start, y.events[0].event.end, y.events[0].event.uncertain],
    ["2026-10-04T14:00:00+09:00", "2026-10-04T16:00:00+09:00", []]);
  // 단건 날짜만·할 일 기한도 같은 규칙
  const d = normalizeTextExtraction(raw({ kind: "event", events: [ev({ title: "합성 치과", start: "2026-09-28", year_in_text: false })] }), "2026-10-05");
  assertEquals(d.kind === "event" && d.events[0].event.start, "2026-09-28");
  const t = normalizeTextExtraction(raw({ kind: "task", title: "합성 납부", due: "2027-10-04", year_in_text: false }), "2026-10-05");
  assertEquals(t.kind === "task" && t.task.due, "2026-10-04");
  // 해를 걸치는 기간은 시작 기준으로 옮겨 기간이 유지된다
  const r = normalizeTextExtraction(raw({ kind: "event", events: [
    ev({ title: "합성 연말 캠프", start: "2026-12-30", end: "2027-01-02", year_in_text: false })] }), "2026-12-20");
  assertEquals(r.kind === "event" && [r.events[0].event.start, r.events[0].event.end], ["2026-12-30", "2027-01-02"]);
});

Deno.test("normalize: year cues from the text are kept — Dec→Jan list, relative date across the year, explicit next year", () => {
  const x = normalizeTextExtraction(raw({ kind: "event", events: [ev({ title: "합성 a", start: "2026-12-28T10:00", year_in_text: false }),
    ev({ title: "합성 b", start: "2027-01-04T10:00", year_in_text: true })] }), "2026-12-20");
  assertEquals(x.kind === "event" && x.events.map((e) => e.event.start), ["2026-12-28T10:00:00+09:00", "2027-01-04T10:00:00+09:00"]);
  // 모델이 단서를 놓치면(false) 1월은 받은 해 1월 — 지난 일정이 된다(모델 쪽은 평가 m19 가 게이트)
  const miss = normalizeTextExtraction(raw({ kind: "event", events: [ev({ title: "합성 b", start: "2027-01-04T10:00", year_in_text: false })] }), "2026-12-20");
  assertEquals(miss.kind === "event" && miss.events[0].event.start, "2026-01-04T10:00:00+09:00");
  const z = normalizeTextExtraction(raw({ kind: "event", events: [ev({ title: "합성 총회", start: "2027-03-14T10:00", year_in_text: true })] }), "2026-10-01");
  assertEquals(z.kind === "event" && z.events[0].event.start, "2027-03-14T10:00:00+09:00");
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

Deno.test("multi-event eval judge: split / missing / time / end / kind codes; date-only expectations match exactly", () => {
  const c = { id: "x", kind: "event", text: "", starts: ["2026-10-04T14:00", "2026-10-11"], ends: [] as string[] };
  assertEquals(judge(c, { kind: "event", starts: ["2026-10-04T14:00:00+09:00", "2026-10-11"], ends: [null, null] }), "ok");
  assertEquals(judge(c, { kind: "event", starts: ["2026-10-03", "2026-10-04T14:00:00+09:00", "2026-10-11"], ends: [] }), "split");
  assertEquals(judge(c, { kind: "event", starts: ["2026-10-04T14:00:00+09:00"], ends: [] }), "missing");
  assertEquals(judge(c, { kind: "event", starts: ["2026-10-04T15:00:00+09:00", "2026-10-11"], ends: [] }), "missing");
  // Codex 4: 날짜만 기대에 시각이 붙으면 통과가 아니다(서버가 ADD_EVENT 로 보낸다)
  assertEquals(judge(c, { kind: "event", starts: ["2026-10-04T14:00:00+09:00", "2026-10-11T09:00:00+09:00"], ends: [] }), "time");
  assertEquals(judge({ ...c, starts: ["2026-10-15"], ends: ["2026-10-18"] }, { kind: "event", starts: ["2026-10-15"], ends: [null] }), "end");
  assertEquals(judge(c, { kind: "task", starts: [], ends: [] }), "kind");
});
