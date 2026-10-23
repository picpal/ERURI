import { assert, assertEquals } from "jsr:@std/assert";
import { AGG_TEXT, type AggConditions, aggregateNotes, aggregateSentence, type AggRaw, BAD_CONDITION, type Bucket, bucketLabel, failedAggregate, fillBuckets,
  okAggregate, parseAggregateContext, revalidateAggregate, revalidateListRequest, type Revalidated, topBuckets } from "../functions/chat/aggregate.ts";
import type { SaveRule } from "../functions/_shared/save-rules.ts";

// 집계 질문 서버 재검증·칸·문장(스펙 §9 "채팅 저장 규칙·집계 질문") — 순수 함수. 값은 합성 문구만. 오늘 = 2026-10-21(수)
const TODAY = "2026-10-21";
const raw = (o: AggRaw = {}): AggRaw => ({ keywords: ["합성PAY"], sender: null, sources: [], from: null, to: null, bucket: null, ...o });
const ok = (r: Revalidated) => {
  assertEquals(r.kind, "ok");
  return (r as { conditions: AggConditions }).conditions;
};
const cond = (o: Partial<AggConditions> = {}): AggConditions =>
  ({ keywords: ["합성PAY"], sender: null, sources: [], from: "2026-10-15", to: "2026-10-21", bucket: "day", defaulted: true, clamped: false, ...o });
const rule = (kind: "keyword" | "sender", value: string): SaveRule => ({ id: `r-${value}`, kind, value, created_at: "2026-10-20T00:00:00Z" });

Deno.test("revalidate ①: trims, drops empty, dedupes case-insensitively; none → question; none + previous → inherits", () => {
  assertEquals(ok(revalidateAggregate(raw({ keywords: [" 합성PAY ", "", "합성pay", "  ", "타임아웃", 3] }), TODAY, null)).keywords, ["합성PAY", "타임아웃"]);
  assertEquals(revalidateAggregate(raw({ keywords: [] }), TODAY, null), { kind: "question" });
  assertEquals(revalidateAggregate(raw({ keywords: ["  "] }), TODAY, null), { kind: "question" });
  assertEquals(revalidateAggregate(raw({ keywords: "합성PAY" }), TODAY, null), { kind: "question" });
  assertEquals(revalidateAggregate(null, TODAY, null), { kind: "question" });
  const prev = cond({ keywords: ["합성은행"], defaulted: false, from: "2026-10-19" });
  const r = revalidateAggregate(raw({ keywords: [] }), TODAY, prev);
  assertEquals(r, { kind: "ok", inherited: true, conditions: prev });
});

Deno.test("revalidate ①: any invalid keyword → bad_condition, never narrowed", () => {
  for (const k of [["합성PAY", "A"], ["가".repeat(31)], ["가나", "다라", "마바", "사아"], ["A"]]) {
    assertEquals(revalidateAggregate(raw({ keywords: k }), TODAY, null).kind, "bad_condition");
  }
  // 경계: 2자·30자(코드 포인트)·3개는 통과
  assertEquals(ok(revalidateAggregate(raw({ keywords: ["가나", "가".repeat(30), "AB"] }), TODAY, null)).keywords, ["가나", "가".repeat(30), "AB"]);
});

Deno.test("revalidate ②: sender null = none; 1 or 31 chars → bad_condition", () => {
  assertEquals(ok(revalidateAggregate(raw(), TODAY, null)).sender, null);
  assertEquals(ok(revalidateAggregate(raw({ sender: " 합성은행 " }), TODAY, null)).sender, "합성은행");
  assertEquals(ok(revalidateAggregate(raw({ sender: "  " }), TODAY, null)).sender, null);   // 빈 글은 null 과 같다(①의 빈 값 제거와 같은 처리)
  for (const s of ["은", "가".repeat(31), 3])assertEquals(revalidateAggregate(raw({ sender: s }), TODAY, null).kind, "bad_condition");
});

Deno.test("revalidate ③: unknown and duplicate sources dropped; empty = all", () => {
  assertEquals(ok(revalidateAggregate(raw({ sources: ["MESSAGES", "KAKAO", "MESSAGES", "GMAIL", 1] }), TODAY, null)).sources, ["MESSAGES", "GMAIL"]);
  assertEquals(ok(revalidateAggregate(raw({ sources: ["KAKAO"] }), TODAY, null)).sources, []);
  assertEquals(ok(revalidateAggregate(raw({ sources: "MESSAGES" }), TODAY, null)).sources, []);
});

Deno.test("revalidate ④: default last 7 days (defaulted); from only → to today; to only → from = to-6; swapped; future to → today; future from → default; 2026-02-30 → bad_condition; 91 days → 90 clamped from = to-89", () => {
  assertEquals(ok(revalidateAggregate(raw(), TODAY, null)),
    { keywords: ["합성PAY"], sender: null, sources: [], from: "2026-10-15", to: "2026-10-21", bucket: "day", defaulted: true, clamped: false });
  const p = (from: unknown, to: unknown) => {
    const c = ok(revalidateAggregate(raw({ from, to }), TODAY, null));
    return [c.from, c.to, c.defaulted, c.clamped];
  };
  assertEquals(p("2026-10-01", null), ["2026-10-01", "2026-10-21", false, false]);
  assertEquals(p(null, "2026-10-10"), ["2026-10-04", "2026-10-10", false, false]);
  assertEquals(p("2026-10-10", "2026-10-01"), ["2026-10-01", "2026-10-10", false, false]);
  assertEquals(p("2026-10-19", "2026-10-25"), ["2026-10-19", "2026-10-21", false, false]);
  assertEquals(p("2026-10-25", "2026-10-30"), ["2026-10-15", "2026-10-21", true, false]);
  assertEquals(p("2026-10-20", "2026-10-20"), ["2026-10-20", "2026-10-20", false, false]);
  assertEquals(p("2026-01-01", "2026-10-21"), ["2026-07-24", "2026-10-21", false, true]);
  assertEquals(p("2026-07-24", "2026-10-21"), ["2026-07-24", "2026-10-21", false, false]);   // 정확히 90일은 줄이지 않는다
  for (const [f, t] of [["2026-02-30", null], [null, "2026-13-01"], ["2026/10/01", null], ["2026-10-1", "2026-10-21"], [20261001, null]]) {
    assertEquals(revalidateAggregate(raw({ from: f, to: t }), TODAY, null).kind, "bad_condition");
  }
});

Deno.test("revalidate ④ day words (0.18.1): '오늘'·'어제'·'그제/그저께' alone in the message pin from = to = that Seoul day when the model left it empty or chose otherwise", () => {
  const p = (text: string, o: AggRaw = {}, previous: AggConditions | null = null) => {
    const c = ok(revalidateAggregate(raw(o), TODAY, previous, text));
    return [c.from, c.to, c.defaulted];
  };
  // 모델이 '오늘'을 최근 7일(빈 칸 또는 7일 범위)로 읽어도 그날 하루
  assertEquals(p("오늘 합성PAY 타임아웃 몇 건이야?"), ["2026-10-21", "2026-10-21", false]);
  assertEquals(p("오늘 합성PAY 타임아웃 몇 건이야?", { from: "2026-10-15", to: "2026-10-21" }), ["2026-10-21", "2026-10-21", false]);
  assertEquals(p("어제 합성PAY 오류 몇 건 왔어?"), ["2026-10-20", "2026-10-20", false]);
  assertEquals(p("어제 합성PAY 오류 몇 건 왔어?", { from: "2026-10-21", to: "2026-10-21" }), ["2026-10-20", "2026-10-20", false]);
  assertEquals(p("그제 합성PAY 문자 몇 건?"), ["2026-10-19", "2026-10-19", false]);
  assertEquals(p("그저께 합성PAY 문자 몇 건?"), ["2026-10-19", "2026-10-19", false]);
  assertEquals(p("합성PAY 오늘은 몇 건이야", { from: "2026-10-21", to: "2026-10-21" }), ["2026-10-21", "2026-10-21", false]);   // 이미 그날이면 그대로
  // 직전 집계를 이어받는 후속 말도 지금 글의 하루가 이긴다
  assertEquals(p("그럼 어제는?", { keywords: [] }, cond({ bucket: "hour" })), ["2026-10-20", "2026-10-20", false]);
  // 고정하지 않는 것: 하루 말 없음, 범위의 끝·시작·비교, 하루 말 둘, 다른 기간 말과 함께, 키워드·발신자 안의 낱말, 다른 낱말의 일부
  assertEquals(p("합성PAY 타임아웃 몇 건이야?"), ["2026-10-15", "2026-10-21", true]);
  assertEquals(p("지난주부터 오늘까지 합성PAY 몇 건?", { from: "2026-10-12", to: "2026-10-21" }), ["2026-10-12", "2026-10-21", false]);
  assertEquals(p("어제부터 합성PAY 몇 건?", { from: "2026-10-20" }), ["2026-10-20", "2026-10-21", false]);
  assertEquals(p("어제보다 합성PAY 많아?", { from: "2026-10-20", to: "2026-10-21" }), ["2026-10-20", "2026-10-21", false]);
  assertEquals(p("어제랑 오늘 합성PAY 몇 건?", { from: "2026-10-20", to: "2026-10-21" }), ["2026-10-20", "2026-10-21", false]);
  assertEquals(p("이번 주 합성PAY 중 오늘 몇 건?", { from: "2026-10-19", to: "2026-10-21" }), ["2026-10-19", "2026-10-21", false]);
  assertEquals(p("최근 3일 합성PAY 어제 많았어?", { from: "2026-10-19", to: "2026-10-21" }), ["2026-10-19", "2026-10-21", false]);
  assertEquals(p("합성오늘마켓 알림 몇 건?", { keywords: ["합성오늘마켓"] }), ["2026-10-15", "2026-10-21", true]);
  assertEquals(p("합성어제상점에서 온 문자 몇 건?", { keywords: ["문자"], sender: "합성어제상점" }), ["2026-10-15", "2026-10-21", true]);
  assertEquals(p("오늘날 합성PAY 몇 건?"), ["2026-10-15", "2026-10-21", true]);
  // 범위 말(부터·이후·이래·까지·지금·현재)이 글 어디에든 있으면 모델 값 — 하루 말과 사이에 시간대·시각이 끼어도(리뷰 I1)
  assertEquals(p("어제 저녁부터 합성PAY 몇 건?", { from: "2026-10-20", to: "2026-10-21" }), ["2026-10-20", "2026-10-21", false]);
  assertEquals(p("어제 오후 3시 이후 합성PAY 몇 건?", { from: "2026-10-20", to: "2026-10-21" }), ["2026-10-20", "2026-10-21", false]);
  assertEquals(p("어제 밤부터 지금까지 합성PAY 몇 건?", { from: "2026-10-20", to: "2026-10-21" }), ["2026-10-20", "2026-10-21", false]);
  // 키워드·발신자는 공백 무시로 지운다 — 글 "합성오늘 마켓", 모델 "합성오늘마켓"(리뷰 M3)
  assertEquals(p("합성오늘 마켓 알림 몇 건?", { keywords: ["합성오늘마켓"] }), ["2026-10-15", "2026-10-21", true]);
  // 글이 없으면(aggregate_context·목록 재검증) 바꾸지 않는다
  assertEquals(ok(revalidateAggregate(raw(), TODAY, null)).from, "2026-10-15");
  // 고정해도 다른 칸 재검증은 그대로 — 무효 키워드는 bad_condition
  assertEquals(revalidateAggregate(raw({ keywords: ["A"] }), TODAY, null, "오늘 A 몇 건").kind, "bad_condition");
});

Deno.test("revalidate ⑤: bucket outside the three → day", () => {
  for (const b of ["hour", "day", "weekday"]) assertEquals(ok(revalidateAggregate(raw({ bucket: b }), TODAY, null)).bucket, b);
  for (const b of [null, "month", 3]) assertEquals(ok(revalidateAggregate(raw({ bucket: b }), TODAY, null)).bucket, "day");
});

Deno.test("revalidate ⑥: previous fills only empty fields; the message's fields win; then ①..⑤", () => {
  const prev = { keywords: ["합성PAY", "타임아웃"], sender: null, sources: [], from: "2026-10-19", to: "2026-10-21", bucket: "hour", defaulted: false, clamped: false } as AggConditions;
  const r = revalidateAggregate({ keywords: [], sender: null, sources: [], from: null, to: null, bucket: "day" }, TODAY, prev);
  assertEquals(r, { kind: "ok", inherited: true, conditions: { ...prev, bucket: "day" } });
  // 지금 글이 말한 칸이 이긴다 — 키워드·출처·발신자
  const p2 = { ...prev, sender: "합성은행", sources: ["MESSAGES"] } as AggConditions;
  assertEquals(ok(revalidateAggregate({ keywords: ["합성택배"], sender: null, sources: ["GMAIL"], from: null, to: null, bucket: null }, TODAY, p2)),
    { ...p2, keywords: ["합성택배"], sources: ["GMAIL"] });
  // 이어받은 뒤에도 지금 글의 무효 칸은 bad_condition
  assertEquals(revalidateAggregate({ keywords: ["A"], sender: null, sources: [], from: null, to: null, bucket: null }, TODAY, prev).kind, "bad_condition");
  // 직전 조건이 없으면 inherited = false
  assertEquals((revalidateAggregate(raw(), TODAY, null) as { inherited: boolean }).inherited, false);
});

Deno.test("revalidate ⑥: inherited period keeps previous defaulted/clamped; a message that names a date recomputes them", () => {
  const dflt = cond({ bucket: "hour" });
  assertEquals(ok(revalidateAggregate(raw({ keywords: [], bucket: "day" }), TODAY, dflt)), { ...dflt, bucket: "day" });
  const clamped = cond({ from: "2026-07-24", to: "2026-10-21", defaulted: false, clamped: true });
  assertEquals(ok(revalidateAggregate(raw({ keywords: [], bucket: "weekday" }), TODAY, clamped)), { ...clamped, bucket: "weekday" });
  // 지금 글이 기간을 말하면 ④가 새로 정한다
  const named = ok(revalidateAggregate(raw({ keywords: [], from: "2026-09-01", to: "2026-09-30" }), TODAY, dflt));
  assertEquals([named.from, named.to, named.defaulted, named.clamped, named.bucket], ["2026-09-01", "2026-09-30", false, false, "hour"]);
  const onlyFrom = ok(revalidateAggregate(raw({ keywords: [], from: "2026-10-20" }), TODAY, clamped));
  assertEquals([onlyFrom.from, onlyFrom.to, onlyFrom.defaulted, onlyFrom.clamped], ["2026-10-20", "2026-10-21", false, false]);
});

Deno.test("parseAggregateContext: absent → null; wrong shape (flags not boolean included) or 6 search fields not equal to their revalidation → 'bad'", () => {
  assertEquals(parseAggregateContext(undefined, TODAY), null);
  assertEquals(parseAggregateContext(null, TODAY), null);
  const good = cond({ keywords: ["합성PAY", "타임아웃"], from: "2026-10-19", defaulted: false });
  assertEquals(parseAggregateContext(JSON.parse(JSON.stringify(good)), TODAY), good);
  const { sender: _s, ...noSender } = good;
  const bad: unknown[] = [
    "x", [], 3, noSender,                                                  // 모양 — sender 키 없음도 bad(PF-F6, K11)
    { ...good, defaulted: "true" }, { ...good, clamped: 1 }, { ...good, defaulted: undefined },
    { ...good, keywords: "합성PAY" }, { ...good, keywords: [1] }, { ...good, sender: 3 }, { ...good, sources: "MESSAGES" },
    { ...good, from: null }, { ...good, bucket: null },
    { ...good, keywords: [] }, { ...good, keywords: [" 합성PAY"] }, { ...good, keywords: ["합성PAY", "합성pay"] }, { ...good, keywords: ["A"] },
    { ...good, sender: " 합성은행" }, { ...good, sender: "은" }, { ...good, sources: ["KAKAO"] }, { ...good, sources: ["GMAIL", "GMAIL"] },
    { ...good, from: "2026-02-30" }, { ...good, to: "2026-10-22" }, { ...good, from: "2026-10-21", to: "2026-10-19" },
    { ...good, from: "2026-01-01" }, { ...good, bucket: "month" },
  ];
  for (const v of bad) assertEquals(parseAggregateContext(v, TODAY), "bad", JSON.stringify(v));
});

Deno.test("parseAggregateContext round-trip: default-period (defaulted) and 90-day (clamped) ok responses sent back unchanged → same 8 fields, not 'bad'", () => {
  // 응답 conditions 를 그대로 되보낸다 — 플래그는 비교하지 않는다(K11, Codex 계획 리뷰 #1)
  for (const r of [raw(), raw({ from: "2026-01-01", to: "2026-10-21" })]) {
    const c = (revalidateAggregate(r, TODAY, null) as { conditions: AggConditions }).conditions;
    assertEquals(parseAggregateContext(JSON.parse(JSON.stringify(c)), TODAY), c);
  }
});

Deno.test("revalidateListRequest: bucket key outside its kind or outside from..to → null", () => {
  const c = cond({ from: "2026-10-19", defaulted: false, bucket: "hour" });
  assertEquals(revalidateListRequest(c, "14", TODAY), { conditions: c, bucketKey: "14" });
  assertEquals(revalidateListRequest(c, "00", TODAY)?.bucketKey, "00");
  for (const k of ["24", "7", "-1", "1a", 14, null, "2026-10-20"]) assertEquals(revalidateListRequest(c, k, TODAY), null, String(k));
  const w = { ...c, bucket: "weekday" as const };
  assertEquals(revalidateListRequest(w, "7", TODAY)?.bucketKey, "7");
  for (const k of ["0", "8", "01", "월"]) assertEquals(revalidateListRequest(w, k, TODAY), null, k);
  const d = { ...c, bucket: "day" as const };
  assertEquals(revalidateListRequest(d, "2026-10-19", TODAY)?.bucketKey, "2026-10-19");
  for (const k of ["2026-10-18", "2026-10-22", "2026-02-30", "14"]) assertEquals(revalidateListRequest(d, k, TODAY), null, k);
  // 조건 재검증 ①~⑤ — 키워드 0개·무효 칸·모양 틀림은 null, 이어받기 없음
  for (const v of [{ ...c, keywords: [] }, { ...c, keywords: ["A"] }, { ...c, from: "2026-02-30" }, (({ sender: _s, ...x }) => x)(c), "x", null]) {
    assertEquals(revalidateListRequest(v, "14", TODAY), null, JSON.stringify(v));
  }
});

Deno.test("bucketLabel: hour·day (Seoul calendar weekday)·weekday", () => {
  assertEquals([bucketLabel("hour", "14"), bucketLabel("hour", "00"), bucketLabel("hour", "09")], ["14시", "0시", "9시"]);
  assertEquals([bucketLabel("day", "2026-10-15"), bucketLabel("day", "2026-10-21"), bucketLabel("day", "2026-01-04")], ["10/15(목)", "10/21(수)", "1/4(일)"]);
  assertEquals(["1", "2", "3", "4", "5", "6", "7"].map((k) => bucketLabel("weekday", k)), ["월", "화", "수", "목", "금", "토", "일"]);
});

Deno.test("fillBuckets: hour 24, weekday 7 (Mon..Sun), day every date (90) with zeros and labels", () => {
  const h = fillBuckets(cond({ bucket: "hour" }), [{ key: "14", count: 9 }, { key: "03", count: 2 }]);
  assertEquals(h.length, 24);
  assertEquals(h[0], { key: "00", label: "0시", count: 0 });
  assertEquals(h[3], { key: "03", label: "3시", count: 2 });
  assertEquals(h[14], { key: "14", label: "14시", count: 9 });
  assertEquals(h[23].key, "23");
  const w = fillBuckets(cond({ bucket: "weekday" }), [{ key: "3", count: 4 }]);
  assertEquals(w.map((b) => b.label), ["월", "화", "수", "목", "금", "토", "일"]);
  assertEquals(w.map((b) => b.count), [0, 0, 4, 0, 0, 0, 0]);
  const d = fillBuckets(cond({ from: "2026-07-24", to: "2026-10-21", defaulted: false, clamped: true }), [{ key: "2026-10-15", count: 5 }, { key: "2026-06-01", count: 7 }]);
  assertEquals(d.length, 90);
  assertEquals(d[0], { key: "2026-07-24", label: "7/24(금)", count: 0 });
  assertEquals(d[89], { key: "2026-10-21", label: "10/21(수)", count: 0 });
  assertEquals(d.find((b) => b.key === "2026-10-15"), { key: "2026-10-15", label: "10/15(목)", count: 5 });
  assertEquals(d.reduce((s, b) => s + b.count, 0), 5);   // 기간 밖 칸은 버린다
  assertEquals(fillBuckets(cond(), []).map((b) => b.key), ["2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18", "2026-10-19", "2026-10-20", "2026-10-21"]);
});

Deno.test("topBuckets: zeros dropped, ties in bucket order, max 3", () => {
  const b = (key: string, count: number): Bucket => ({ key, label: key, count });
  assertEquals(topBuckets([b("a", 0), b("b", 2), b("c", 5), b("d", 2), b("e", 2)]), [b("c", 5), b("b", 2), b("d", 2)]);
  assertEquals(topBuckets([b("a", 0), b("b", 1)]), [b("b", 1)]);
  assertEquals(topBuckets([b("a", 0)]), []);
});

Deno.test("sentence: hour/day/weekday leaders; ties of 2 and of 4+; zero; period default/range/one day/other year; (최대 90일); source words 5; sender; 은/는", () => {
  const s = (c: AggConditions, counts: { key: string; count: number }[]) =>
    aggregateSentence(c, counts.reduce((n, x) => n + x.count, 0), fillBuckets(c, counts), TODAY);
  const kw2 = { keywords: ["PINPAY", "타임아웃"] };
  assertEquals(s(cond({ ...kw2, bucket: "hour" }), [{ key: "14", count: 9 }, { key: "15", count: 8 }, { key: "09", count: 7 }, { key: "21", count: 8 }, { key: "03", count: 5 }]),
    "최근 7일 'PINPAY·타임아웃' 메시지 37건 — 14시대가 9건으로 가장 많았어요");
  assertEquals(s(cond({ bucket: "hour" }), [{ key: "09", count: 2 }]), "최근 7일 '합성PAY' 메시지 2건 — 9시대가 2건으로 가장 많았어요");
  assertEquals(s(cond({ from: "2026-10-19", defaulted: false, sources: ["MESSAGES"] }), [{ key: "2026-10-20", count: 3 }, { key: "2026-10-21", count: 2 }]),
    "10/19–10/21 '합성PAY' 문자 5건 — 10/20(화)가 3건으로 가장 많았어요");
  assertEquals(s(cond({ from: "2026-07-24", defaulted: false, clamped: true, sources: ["GMAIL"], bucket: "weekday" }), [{ key: "3", count: 2 }, { key: "5", count: 1 }, { key: "1", count: 1 }]),
    "7/24–10/21(최대 90일) '합성PAY' 메일 4건 — 수요일이 2건으로 가장 많았어요");
  assertEquals(s(cond({ bucket: "hour" }), [{ key: "14", count: 3 }, { key: "15", count: 3 }]),
    "최근 7일 '합성PAY' 메시지 6건 — 14시대·15시대가 각각 3건으로 가장 많았어요");
  assertEquals(s(cond({ bucket: "weekday" }), [{ key: "1", count: 2 }, { key: "7", count: 2 }, { key: "4", count: 2 }]),
    "최근 7일 '합성PAY' 메시지 6건 — 월요일·목요일·일요일이 각각 2건으로 가장 많았어요");
  assertEquals(s(cond(), [{ key: "2026-10-15", count: 1 }, { key: "2026-10-16", count: 1 }]),
    "최근 7일 '합성PAY' 메시지 2건 — 10/15(목)·10/16(금)가 각각 1건으로 가장 많았어요");
  assertEquals(s(cond({ bucket: "hour" }), [{ key: "01", count: 1 }, { key: "02", count: 1 }, { key: "03", count: 1 }, { key: "04", count: 1 }]),
    "최근 7일 '합성PAY' 메시지 4건 — 4개 칸이 각각 1건으로 가장 많았어요");
  // 0건 — 출처 말 다섯과 은/는, 발신자
  assertEquals(s(cond(kw2), []), "최근 7일 'PINPAY·타임아웃' 메시지는 0건이에요");
  assertEquals(s(cond({ sources: ["MESSAGES"] }), []), "최근 7일 '합성PAY' 문자는 0건이에요");
  assertEquals(s(cond({ sources: ["GMAIL"] }), []), "최근 7일 '합성PAY' 메일은 0건이에요");
  assertEquals(s(cond({ sources: ["SHARE"] }), []), "최근 7일 '합성PAY' 공유한 글은 0건이에요");
  assertEquals(s(cond({ sources: ["MESSAGES", "NOTIFICATION"] }), []), "최근 7일 '합성PAY' 메시지는 0건이에요");
  assertEquals(s(cond({ sources: ["NOTIFICATION"], sender: "합성은행" }), []), "최근 7일 '합성PAY' 합성은행에서 온 알림은 0건이에요");
  // 기간 — 다른 해·하루
  assertEquals(s(cond({ from: "2025-12-01", to: "2025-12-31", defaulted: false }), []), "2025. 12/1–12/31 '합성PAY' 메시지는 0건이에요");
  assertEquals(s(cond({ from: "2026-10-20", to: "2026-10-20", defaulted: false }), []), "10/20 '합성PAY' 메시지는 0건이에요");
  assertEquals(s(cond({ from: "2025-12-20", to: "2026-01-05", defaulted: false }), []), "2025. 12/20–2026. 1/5 '합성PAY' 메시지는 0건이에요");
});

Deno.test("notes: always savedOnly; zero and no keyword rule (and no sender rule when a sender is set) → hint with first keyword and source word", () => {
  const hint = "알림으로 분류돼 저장되지 않았을 수 있어요 — '앞으로 PINPAY 문자는 저장해'라고 하면 다음부터 셀 수 있어요.";
  const c = cond({ keywords: ["PINPAY", "타임아웃"], sources: ["MESSAGES"] });
  assertEquals(aggregateNotes(c, 3, []), [AGG_TEXT.savedOnly]);
  assertEquals(aggregateNotes(c, 0, []), [AGG_TEXT.savedOnly, hint]);
  assertEquals(aggregateNotes(c, 0, [rule("keyword", "다른말"), rule("sender", "PINPAY")]), [AGG_TEXT.savedOnly, hint]);
  assertEquals(aggregateNotes(c, 0, [rule("keyword", "타임아웃")]), [AGG_TEXT.savedOnly]);
  assertEquals(aggregateNotes(c, 0, [rule("keyword", "pinpay")]), [AGG_TEXT.savedOnly]);   // 소문자 비교
  const withSender = { ...c, sender: "합성은행" };
  assertEquals(aggregateNotes(withSender, 0, []), [AGG_TEXT.savedOnly, hint]);
  assertEquals(aggregateNotes(withSender, 0, [rule("sender", "합성은행")]), [AGG_TEXT.savedOnly]);
  assertEquals(aggregateNotes(cond({ keywords: ["합성PAY"], sources: ["GMAIL"] }), 0, [])[1],
    "알림으로 분류돼 저장되지 않았을 수 있어요 — '앞으로 합성PAY 메일은 저장해'라고 하면 다음부터 셀 수 있어요.");
});

Deno.test("okAggregate / failedAggregate / BAD_CONDITION: response shape", () => {
  const c = cond({ bucket: "weekday" });
  const r = okAggregate(c, { total: 2, body_total: 2, metric_items: 0, metric_unmatched: 0, buckets: [{ key: "3", count: 2 }] }, [], TODAY);
  assertEquals(r.status, "ok");
  assertEquals(r.conditions, c);
  assertEquals([r.total, r.buckets.length, r.top], [2, 7, [{ key: "3", label: "수", count: 2 }]]);
  assertEquals(r.sentence, "최근 7일 '합성PAY' 메시지 2건 — 수요일이 2건으로 가장 많았어요");
  assertEquals(r.notes, [AGG_TEXT.savedOnly]);
  assertEquals(r.body_total, null);
  assertEquals(failedAggregate(c), { status: "failed", conditions: c, total: 0, body_total: null, buckets: [], top: [], sentence: AGG_TEXT.failed, notes: [] });
  assertEquals(BAD_CONDITION, { status: "bad_condition", conditions: null, total: 0, body_total: null, buckets: [], top: [], sentence: AGG_TEXT.bad, notes: [] });
  assert(Object.isFrozen(BAD_CONDITION));
});

// 0.18.0 본문 건수(스펙 §9 "본문 건수") — 문장 "· 본문 기준 M건"·꼬리 줄 ③·body_total·공백 무시 중복 제거(H2). 오늘 = 2026-10-22(목)
const C: AggConditions = { keywords: ["ABC결제", "타임아웃"], sender: null, sources: [], from: "2026-10-16", to: "2026-10-22", bucket: "hour", defaulted: true, clamped: false };

Deno.test("keywords: ['abc pay', 'ABCPAY', ' abc  pay '] → ['abc pay'] (spaces and case ignored, first spelling kept)", () => {
  const r = revalidateAggregate({ keywords: ["abc pay", "ABCPAY", " abc  pay "] }, "2026-10-22", null);
  assertEquals(r.kind === "ok" && r.conditions.keywords, ["abc pay"]);
});
Deno.test("body sentence: '… 메시지 12건 · 본문 기준 37건 — 14시대가 15건으로 가장 많았어요'", () => {
  const b = fillBuckets(C, [{ key: "14", count: 15 }, { key: "09", count: 10 }, { key: "15", count: 12 }]);
  assertEquals(aggregateSentence(C, 12, b, "2026-10-22", 37), "최근 7일 'ABC결제·타임아웃' 메시지 12건 · 본문 기준 37건 — 14시대가 15건으로 가장 많았어요");
});
Deno.test("body sentence for day and weekday, ties of 2 and 4", () => {
  const D = { ...C, bucket: "day" as const }, W = { ...C, bucket: "weekday" as const };
  assertEquals(aggregateSentence(D, 3, fillBuckets(D, [{ key: "2026-10-21", count: 9 }]), "2026-10-22", 9), "최근 7일 'ABC결제·타임아웃' 메시지 3건 · 본문 기준 9건 — 10/21(수)가 9건으로 가장 많았어요");
  assertEquals(aggregateSentence(W, 2, fillBuckets(W, [{ key: "3", count: 6 }, { key: "5", count: 6 }]), "2026-10-22", 12), "최근 7일 'ABC결제·타임아웃' 메시지 2건 · 본문 기준 12건 — 수요일·금요일이 각각 6건으로 가장 많았어요");
  assertEquals(aggregateSentence(C, 4, fillBuckets(C, ["01", "02", "03", "04"].map((key) => ({ key, count: 5 }))), "2026-10-22", 20), "최근 7일 'ABC결제·타임아웃' 메시지 4건 · 본문 기준 20건 — 4개 칸이 각각 5건으로 가장 많았어요");
});
Deno.test("bodyTotal null → byte-identical 0.17.0 sentence", () => {
  const b = fillBuckets(C, [{ key: "14", count: 3 }]);
  assertEquals(aggregateSentence(C, 3, b, "2026-10-22", null), aggregateSentence(C, 3, b, "2026-10-22"));
  assertEquals(aggregateSentence(C, 3, b, "2026-10-22"), "최근 7일 'ABC결제·타임아웃' 메시지 3건 — 14시대가 3건으로 가장 많았어요");
});
Deno.test("okAggregate: body_total only when metric_items > 0; buckets/top are body values; note ③ only when body null and unmatched > 0", () => {
  const withBody = okAggregate(C, { total: 2, body_total: 8, metric_items: 1, metric_unmatched: 1, buckets: [{ key: "14", count: 7 }, { key: "16", count: 1 }] }, [], "2026-10-22");   // body 있음 → ③ 없음
  assertEquals([withBody.body_total, withBody.top.map((t) => t.count), withBody.notes], [8, [7, 1], [AGG_TEXT.savedOnly]]);
  const svc = okAggregate({ ...C, keywords: ["ABC결제"] }, { total: 5, body_total: 5, metric_items: 0, metric_unmatched: 4, buckets: [{ key: "10", count: 5 }] }, [], "2026-10-22");
  assertEquals([svc.body_total, svc.notes], [null, [AGG_TEXT.savedOnly, AGG_TEXT.countedMessages]]);
  assertEquals(svc.sentence, "최근 7일 'ABC결제' 메시지 5건 — 10시대가 5건으로 가장 많았어요");
  const none = okAggregate(C, { total: 3, body_total: 3, metric_items: 0, metric_unmatched: 0, buckets: [{ key: "10", count: 3 }] }, [], "2026-10-22");
  assertEquals([none.body_total, none.notes], [null, [AGG_TEXT.savedOnly]]);
  const zero = okAggregate(C, { total: 0, body_total: 0, metric_items: 0, metric_unmatched: 0, buckets: [] }, [], "2026-10-22");
  assertEquals(zero.notes.includes(AGG_TEXT.countedMessages), false);
});
Deno.test("body total 0 (final-I2): matched rows all 0건 → '… 알림 6건 · 본문 기준 0건이에요', no leader, top empty, no note ③ (bucket count 0 from RPC body)", () => {
  const E: AggConditions = { ...C, keywords: ["합성PAY", "오류"], sources: ["NOTIFICATION"], from: "2026-10-22", to: "2026-10-22", defaulted: false };
  const r = okAggregate(E, { total: 6, body_total: 0, metric_items: 6, metric_unmatched: 0, buckets: [{ key: "13", count: 0 }, { key: "14", count: 0 }] }, [], "2026-10-22");
  assertEquals(r.sentence, "10/22 '합성PAY·오류' 알림 6건 · 본문 기준 0건이에요");
  assertEquals([r.total, r.body_total, r.top, r.buckets.every((b) => b.count === 0), r.notes], [6, 0, [], true, [AGG_TEXT.savedOnly]]);
  // total 0 은 0.17.0 0건 문장 그대로
  assertEquals(aggregateSentence(E, 0, fillBuckets(E, []), "2026-10-22", null), "10/22 '합성PAY·오류' 알림은 0건이에요");
  // 일부만 0 이면 보통 본문 기준 문장
  const part = okAggregate(E, { total: 2, body_total: 3, metric_items: 2, metric_unmatched: 0, buckets: [{ key: "13", count: 0 }, { key: "14", count: 3 }] }, [], "2026-10-22");
  assertEquals(part.sentence, "10/22 '합성PAY·오류' 알림 2건 · 본문 기준 3건 — 14시대가 3건으로 가장 많았어요");
});
Deno.test("AGG_TEXT.countedMessages is the fixed spec text", () => {
  assertEquals(AGG_TEXT.countedMessages, "메시지 수로 셌어요 — 무슨 일인지(예: 타임아웃) 함께 물으면 본문에 적힌 건수로 세요.");
});
Deno.test("failedAggregate and BAD_CONDITION carry body_total null", () => {
  assertEquals([failedAggregate(C).body_total, BAD_CONDITION.body_total], [null, null]);
});
