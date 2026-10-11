import { assert, assertEquals, assertThrows } from "jsr:@std/assert";
import { ampmMarked, confirmedCodes, type EditRaw, type EventValues, parseApplyRow, parseEditTarget, parseTargetRow, revalidate, when } from "../functions/chat/edit.ts";

// 방금 등록한 일정 고치기(스펙 §9 B 서버 1·4·6, H3 후속) — 순수 함수. 값은 합성 문구·합성 시각만
const R1: EventValues = { title: "합성 치과 예약", start: "2026-10-10T11:00:00+09:00", end: "2026-10-10T15:00:00+09:00", location: null };
const raw = (o: Partial<EditRaw>): EditRaw => ({ start: null, end: null, title: null, location: null, ...o });

Deno.test("parseEditTarget: a uuid string only; anything else is ignored (null)", () => {
  const id = "7c6f2a51-3d4e-4b6a-9c1d-2e3f4a5b6c7d";
  assertEquals([parseEditTarget(id), parseEditTarget("x"), parseEditTarget(3), parseEditTarget(null), parseEditTarget(undefined)], [id, null, null, null, null]);
});

Deno.test("when: offset forms normalize to Seoul +09:00; no offset dropped unless reading the stored value; calendar-invalid dates dropped", () => {
  assertEquals(when("2026-10-09T02:00:00Z")?.value, "2026-10-09T11:00:00+09:00");
  assertEquals(when("2026-10-09T11:00+0900")?.value, "2026-10-09T11:00:00+09:00");
  assertEquals(when("2026-10-09T11:00:00.250+09:00")?.value, "2026-10-09T11:00:00+09:00");
  assertEquals(when("2026-10-09T11:00:00"), null);                                   // Review Focus 2 — 모델 출력은 오프셋 필수
  assertEquals(when("2026-10-09T11:00:00", false)?.value, "2026-10-09T11:00:00+09:00");
  assertEquals(when("2026-10-09"), { kind: "day", value: "2026-10-09", ms: Date.parse("2026-10-09T00:00:00+09:00") });
  assertEquals([when("2026-02-30"), when("내일"), when(null)], [null, null, null]);
});

Deno.test("revalidate: date only ('내일이야') moves start and end; both accepted", () => {
  const r = revalidate(R1, raw({ start: "2026-10-09T11:00:00+09:00", end: "2026-10-09T15:00:00+09:00" }));
  assertEquals(r.patch, { start: "2026-10-09T11:00:00+09:00", end: "2026-10-09T15:00:00+09:00" });
  assertEquals([r.accepted.start, r.accepted.end], [true, true]);
});
Deno.test("revalidate: start only keeps the original length (11–15 → 14–18); the end did not come", () => {
  const r = revalidate(R1, raw({ start: "2026-10-10T14:00:00+09:00" }));
  assertEquals(r.patch, { start: "2026-10-10T14:00:00+09:00", end: "2026-10-10T18:00:00+09:00" });
  assertEquals(r.accepted.end, false);
});
Deno.test("revalidate: end only ('5시까지로') changes the end", () => {
  assertEquals(revalidate(R1, raw({ end: "2026-10-10T17:00:00+09:00" })).patch, { end: "2026-10-10T17:00:00+09:00" });
});
Deno.test("revalidate: an end at or before the start is dropped and the kept length is used", () => {
  const r = revalidate(R1, raw({ start: "2026-10-10T14:00:00+09:00", end: "2026-10-10T13:00:00+09:00" }));
  assertEquals([r.patch.end, r.accepted.end], ["2026-10-10T18:00:00+09:00", false]);
  assertEquals(revalidate(R1, raw({ end: "2026-10-10T11:00:00+09:00" })).patch, {});    // 시작과 같은 끝 — 버림
});
Deno.test("revalidate: all-day ↔ timed without an end → end null; with a same-kind end → that end", () => {
  const allDay: EventValues = { title: "합성 워크숍", start: "2026-10-12", end: "2026-10-13", location: null };
  assertEquals(revalidate(allDay, raw({ start: "2026-10-12T10:00:00+09:00" })).patch, { start: "2026-10-12T10:00:00+09:00", end: null });
  assertEquals(revalidate(R1, raw({ start: "2026-10-09" })).patch, { start: "2026-10-09", end: null });
  assertEquals(revalidate(R1, raw({ start: "2026-10-09", end: "2026-10-10" })).patch, { start: "2026-10-09", end: "2026-10-10" });
});
Deno.test("revalidate: a multi-day all-day event moved by start only keeps its day count", () => {
  const allDay: EventValues = { title: "합성 학회", start: "2026-10-10", end: "2026-10-12", location: null };
  assertEquals(revalidate(allDay, raw({ start: "2026-10-11" })).patch, { start: "2026-10-11", end: "2026-10-13" });
});
Deno.test("revalidate: unreadable values are dropped (calendar-invalid date, no offset, garbage) → nothing to change", () => {
  for (const s of ["2026-02-30", "2026-10-09T11:00:00", "내일"]) assertEquals(revalidate(R1, raw({ start: s })).patch, {}, s);
});
Deno.test("revalidate: title trimmed 1–100 chars, empty or 101 dropped; location '' → null, 201 dropped, same value not patched but accepted", () => {
  assertEquals(revalidate(R1, raw({ title: "  합성 회의  " })).patch, { title: "합성 회의" });
  assertEquals(revalidate(R1, raw({ title: "   " })).patch, {});
  assertEquals(revalidate(R1, raw({ title: "가".repeat(101) })).patch, {});
  assertEquals(revalidate(R1, raw({ title: "가".repeat(100) })).patch, { title: "가".repeat(100) });
  const withPlace = { ...R1, location: "합성카페" };
  assertEquals(revalidate(withPlace, raw({ location: "" })).patch, { location: null });
  assertEquals(revalidate(withPlace, raw({ location: "가".repeat(201) })).patch, {});
  const same = revalidate(withPlace, raw({ location: "합성카페" }));
  assertEquals([same.patch, same.accepted.location], [{}, true]);
});
Deno.test("revalidate: values equal to the current ones → empty patch (no_change); stored start without offset still compares", () => {
  assertEquals(revalidate(R1, raw({ start: "2026-10-10T02:00:00Z", end: "2026-10-10T15:00:00+09:00", title: "합성 치과 예약" })).patch, {});
  const legacy = { ...R1, start: "2026-10-10T11:00:00", end: null };
  assertEquals(revalidate(legacy, raw({ start: "2026-10-10T11:00:00+09:00" })).patch, {});
});
Deno.test("revalidate: a proposal without a readable start changes only title and place", () => {
  const undated: EventValues = { title: "합성 미정", start: null, end: null, location: null };
  assertEquals(revalidate(undated, raw({ start: "2026-10-09T10:00:00+09:00", title: "합성 정함" })).patch, { title: "합성 정함" });
});

Deno.test("ampmMarked: 오전·오후·아침·저녁·밤·새벽 or 13–23 o'clock only", () => {
  const yes = ["오후 6시야", "18시야", "저녁 7시로", "새벽 5시로", "18:30으로", "오전 9시", "밤 10시", "아침 8시로", "13 시로", "23:59로"];
  const no = ["6시야", "내일이야", "12시", "16일 5시", "2시로 바꿔줘", "12:30", "113시", "24시"];
  for (const s of yes) assert(ampmMarked(s), s);
  for (const s of no) assert(!ampmMarked(s), s);
});

Deno.test("confirmedCodes (H3): date only when the Seoul day moved; ampm only with an accepted start and a marker in this message", () => {
  const six: EventValues = { title: "합성 미팅", start: "2026-10-14T06:00:00+09:00", end: null, location: null };
  const c = (msg: string, o: Partial<EditRaw>) => confirmedCodes(six, revalidate(six, raw(o)), msg);
  assertEquals(c("앗 내일이야", { start: "2026-10-15T06:00:00+09:00" }), ["date"]);
  assertEquals(c("오후 6시야", { start: "2026-10-14T18:00:00+09:00" }), ["ampm"]);
  assertEquals(c("6시야", { start: "2026-10-14T06:00:00+09:00" }), []);
  assertEquals(c("18시야", { start: "2026-10-14T18:00:00+09:00" }), ["ampm"]);
  assertEquals(c("저녁 7시로", { start: "2026-10-14T19:00:00+09:00" }), ["ampm"]);
  assertEquals(c("새벽 5시로", { start: "2026-10-14T05:00:00+09:00" }), ["ampm"]);
  assertEquals(c("오후에 장소 바꿔줘", { location: "합성카페" }), ["location"]);
  assertEquals(c("내일 오후 6시야", { start: "2026-10-15T18:00:00+09:00" }), ["date", "ampm"]);
});
Deno.test("confirmedCodes: end only when edit.end came and was used (not when the server moved it); location when the place came", () => {
  const c = (o: Partial<EditRaw>) => confirmedCodes(R1, revalidate(R1, raw(o)), "합성 메시지");
  assertEquals(c({ start: "2026-10-10T14:00:00+09:00" }), []);                         // 끝은 서버가 따라 옮겼다
  assertEquals(c({ end: "2026-10-10T17:00:00+09:00" }), ["end"]);
  assertEquals(c({ start: "2026-10-10T14:00:00+09:00", end: "2026-10-10T13:00:00+09:00" }), []);   // 버린 끝
  assertEquals(c({ location: "" }), ["location"]);
});

Deno.test("parseTargetRow / parseApplyRow: shapes from 0033; malformed target → not_found, malformed ok apply row throws", () => {
  assertEquals(parseTargetRow({ status: "expired" }), { status: "expired" });
  assertEquals(parseTargetRow({ status: "ok", proposal_id: "p2", action: "create_event", title: "합성", start: "2026-10-10", end: null, location: null }),
    { status: "ok", proposal_id: "p2", action: "create_event", values: { title: "합성", start: "2026-10-10", end: null, location: null } });
  assertEquals([parseTargetRow(null), parseTargetRow({ status: "ok" }), parseTargetRow({ status: "weird" })], [{ status: "not_found" }, { status: "not_found" }, { status: "not_found" }]);
  const v = { title: "합성", start: "2026-10-10", end: null, location: null };
  assertEquals(parseApplyRow({ status: "ok", proposal_id: "p3", version: 3, action: "update_event", before: v, after: v }),
    { status: "ok", proposal_id: "p3", action: "update_event", before: v, after: v });
  assertEquals(parseApplyRow({ status: "multi" }), { status: "multi" });
  assertThrows(() => parseApplyRow({ status: "ok", proposal_id: "p3" }));
});

// 메인 판정 (B)(계획 265cbd6 K6): 값은 같고 이번 글에 표지 — patch 는 비지만 ampm 은 확인 코드(E4 runEdit 가 빈 patch + 코드로 RPC)
Deno.test("confirmedCodes (ruling B): same value with a marker ('오후 6시 맞아') → empty patch, ampm confirmed; same value without a marker → nothing", () => {
  const eighteen: EventValues = { title: "합성 미팅", start: "2026-10-14T18:00:00+09:00", end: null, location: null };
  const r = revalidate(eighteen, raw({ start: "2026-10-14T09:00:00Z" }));
  assertEquals([r.patch, r.accepted.start], [{}, true]);
  assertEquals(confirmedCodes(eighteen, r, "오후 6시 맞아"), ["ampm"]);
  assertEquals(confirmedCodes(eighteen, r, "6시 맞아"), []);
  assertEquals(confirmedCodes(eighteen, revalidate(eighteen, raw({ title: "합성 미팅" })), "오후에 보자"), []);   // start 가 안 왔다
});

// E1 deferred ②(chat_edit_proposal 이 형식 불량 start 를 받는다)·④(no_change 를 문자열로 비교한다)의 전제: patch 의 시각·날짜는 언제나 정규형
Deno.test("revalidate: patch times are always the normalized Seoul form (Z, +0900, fractions, shifted end); unreadable stored end is not patched", () => {
  assertEquals(revalidate(R1, raw({ start: "2026-10-09T02:00:00Z" })).patch, { start: "2026-10-09T11:00:00+09:00", end: "2026-10-09T15:00:00+09:00" });
  assertEquals(revalidate(R1, raw({ start: "2026-10-09T11:00+0900", end: "2026-10-09T06:30:00.5Z" })).patch, { start: "2026-10-09T11:00:00+09:00", end: "2026-10-09T15:30:00+09:00" });
  const legacy: EventValues = { title: "합성 회의", start: "2026-10-10T11:00", end: "2026-10-10T15:00:00", location: null };
  assertEquals(revalidate(legacy, raw({ start: "2026-10-11T11:00:00+09:00" })).patch, { start: "2026-10-11T11:00:00+09:00", end: "2026-10-11T15:00:00+09:00" });
  assertEquals(revalidate(legacy, raw({ title: "합성 회의 2" })).patch, { title: "합성 회의 2" });          // 시각 칸은 정규형이 달라도 patch 에 안 들어간다
  const sameInstant = revalidate(legacy, raw({ start: "2026-10-10T02:00:00Z", end: "2026-10-10T06:00:00Z" }));
  assertEquals(sameInstant.patch, {});                                                                   // no_change — 문자열이 아니라 시각으로 비교
  const badEnd: EventValues = { ...R1, end: "합성 오류" };
  assertEquals(revalidate(badEnd, raw({ start: "2026-10-09T11:00:00+09:00" })).patch, { start: "2026-10-09T11:00:00+09:00" });
  for (const p of [revalidate(R1, raw({ start: "2026-10-09T02:00:00.999Z" })).patch, revalidate(R1, raw({ end: "2026-10-10T08:00:00Z" })).patch]) {
    for (const v of [p.start, p.end]) if (typeof v === "string") assert(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}\+09:00)?$/.test(v), v);
  }
});
