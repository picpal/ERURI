import { assertEquals } from "jsr:@std/assert";
import { normalizeMetrics } from "../functions/_shared/metrics.ts";

// 받은 시각 = 서울 2026-10-22 14:12
const R = "2026-10-22T05:12:00Z";
const at1 = (start: string | null, occurredAt = R) => normalizeMetrics([{ label: "타임아웃", count: 6, start, end: null }], occurredAt, "[합성결제] 타임아웃 6건")[0];
const mk = (label: string) => ({ label, count: 1, start: null, end: null });

Deno.test("label: trims and collapses spaces; '' and 31 code points dropped; 30 kept; non-string dropped", () => {
  const r = normalizeMetrics([mk("  타임  아웃 "), mk("   "), mk("가".repeat(31)), mk("가".repeat(30)), mk(7 as unknown as string)], R,
    `타임 아웃 1건, ${"가".repeat(31)} 1건, ${"가".repeat(30)} 1건`);
  assertEquals(r.map((x) => x.label), ["타임 아웃", "가".repeat(30)]);
});

Deno.test("count: 0, -1, 1.5, 100001, '6' dropped; 1 and 100000 kept", () => {
  assertEquals(normalizeMetrics([0, -1, 1.5, 100001, "6", 1, 100000].map((n) => ({ label: "오류", count: n, start: null, end: null })), R,
    "오류 0건, 오류 -1건, 오류 1.5건, 오류 100001건, 오류 6건, 오류 1건, 오류 100000건").map((x) => x.count), [1, 100000]);
});

Deno.test("not an array → []; 11 valid → first 10 (after drops)", () => {
  assertEquals(normalizeMetrics(null, R, ""), []);
  assertEquals(normalizeMetrics({}, R, ""), []);
  const eleven = Array.from({ length: 11 }, (_, i) => ({ label: `l${i}`, count: i + 1, start: null, end: null }));
  assertEquals(normalizeMetrics(eleven, R, eleven.map((m) => `${m.label} ${m.count}건`).join(", ")).map((x) => x.count), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

Deno.test("proximity (Ruling N8-prox): label must be in the same clause within the 20 chars before the count number; else dropped", () => {
  const one = (label: string, count: number, text: string) => normalizeMetrics([{ label, count, start: null, end: null }], R, text).map((m) => [m.label, m.count]);
  assertEquals(one("타임아웃", 20, "타임아웃 발생, 재시도 20건"), []);                    // 사용자 결정 A 반례 — 건수 없는 사건 낱말에 다른 건수
  assertEquals(one("재시도", 20, "타임아웃 발생, 재시도 20건"), [["재시도", 20]]);
  const two = normalizeMetrics([{ label: "타임아웃", count: 6, start: null, end: null }, { label: "오류", count: 2, start: null, end: null }], R, "[ABC] 타임아웃 6건, 오류 2건");
  assertEquals(two.map((m) => [m.label, m.count]), [["타임아웃", 6], ["오류", 2]]);
  assertEquals(one("타임아웃", 1234, "타임아웃 1,234건"), [["타임아웃", 1234]]);           // 천 단위 쉼표
  assertEquals(one("TIME OUT", 3, "API timeout 3건"), [["TIME OUT", 3]]);                  // 대소문자·공백 무시
  assertEquals(one("오류", 7, "오류 6건"), []);                                           // 숫자가 본문에 없음
  assertEquals(one("오류", 20, "오류 120건"), []);                                        // 더 긴 숫자의 일부는 아니다
  assertEquals(one("타임아웃", 6, "6건 타임아웃"), []);                                   // label 이 숫자 뒤
  assertEquals(one("타임아웃", 3, "재시도 3건 후 타임아웃 3건"), [["타임아웃", 3]]);      // 여러 번 나오면 하나라도 만족
  assertEquals(one("타임아웃", 6, "14:00~14:10 타임아웃 6건 (오늘 누적 14건)"), [["타임아웃", 6]]);
  assertEquals(one("타임아웃", 6, "타임아웃이 오늘 오후 결제 화면에서 계속 6건"), []);     // 20자 밖
  assertEquals(one("결제 승인 게이트웨이 응답 타임아웃", 6, "1) 결제 승인 게이트웨이 응답 타임아웃 6건"), [["결제 승인 게이트웨이 응답 타임아웃", 6]]); // 긴 label 은 그 길이까지
});

Deno.test("unit (Ruling N8-unit): right after the count number a count unit or no unit → kept; a measurement unit → dropped", () => {
  const one = (label: string, count: number, text: string) => normalizeMetrics([{ label, count, start: null, end: null }], R, text).map((m) => [m.label, m.count]);
  assertEquals(one("응답 지연", 3, "[합성배치] 응답 지연 3초 이상 발생"), []);
  assertEquals(one("타임아웃", 6, "타임아웃 6건"), [["타임아웃", 6]]);
  assertEquals(one("오류", 2, "오류 2 회"), [["오류", 2]]);
  assertEquals(one("실패", 5, "실패 5"), [["실패", 5]]);
  assertEquals(one("지연", 120, "지연 120ms"), []);
  assertEquals(one("타임아웃", 1234, "타임아웃 1,234건"), [["타임아웃", 1234]]);
  // 그 밖 건수 단위·단위 없음(문장부호)·측정 단위(공백 뒤도)·서수·기간
  for (const t of ["재시도 3번", "경고 3개", "접속 3차례", "실패 3명", "retry 3 times", "エラー 3件", "오류 3, 경고 1", "오류 3)", "오류 3 발생"]) {
    assertEquals(one(t.split(" ")[0], 3, t).length, 1, t);
  }
  for (const t of ["지연 3 초", "지연 3분", "지연 3시간", "점검 3일", "오류 3%", "환불 3원", "용량 3KB", "지연 3 ms", "지연 3s", "오류 3회차", "오류 3번째", "보관 3개월", "증가 3배"]) {
    assertEquals(one(t.split(" ")[0], 3, t), [], t);
  }
  // 한 출현이라도 근접·단위 둘 다 만족하면 받음
  assertEquals(one("지연", 3, "지연 3초, 지연 3건"), [["지연", 3]]);
});

Deno.test("HH:MM → received Seoul day; received 00:30 KST uses that Seoul date", () => {
  assertEquals(at1("14:00"), { label: "타임아웃", count: 6, at: "2026-10-22T05:00:00.000Z", at_body: true });
  assertEquals(at1("00:10", "2026-10-21T15:30:00Z").at, "2026-10-21T15:10:00.000Z"); // 받음 10/22 00:30 KST → 10/22 00:10 KST
});

Deno.test("HH:MM is the latest such time not after receipt + 10 min (Ruling N8-time): 00:05 recv 23:50 → previous day; 14:00 recv 13:50 / 14:05 → same day", () => {
  assertEquals(at1("23:50", "2026-10-21T15:05:00Z"), { label: "타임아웃", count: 6, at: "2026-10-21T14:50:00.000Z", at_body: true }); // 받음 10/22 00:05 → 10/21 23:50
  assertEquals(at1("23:50+09:00", "2026-10-21T15:05:00Z").at, "2026-10-21T14:50:00.000Z");                                     // +09:00 붙은 시각만도 같다
  assertEquals(at1("13:50", "2026-10-22T05:00:00Z").at, "2026-10-22T04:50:00.000Z");                                           // 받음 14:00 → 당일 13:50
  assertEquals(at1("14:05", "2026-10-22T05:00:00Z").at, "2026-10-22T05:05:00.000Z");                                           // 10분 안 → 당일
  assertEquals(at1("14:10", "2026-10-22T05:00:00Z").at, "2026-10-22T05:10:00.000Z");                                           // 정확히 10분 → 당일(경계 포함)
  assertEquals(at1("14:11", "2026-10-22T05:00:00Z").at, "2026-10-21T05:11:00.000Z");                                           // 10분 넘게 뒤 → 전날
  assertEquals(at1("2026-10-22 23:50", "2026-10-21T15:05:00Z").at, "2026-10-22T14:50:00.000Z");                                // 날짜가 있으면 앞당기지 않는다
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
