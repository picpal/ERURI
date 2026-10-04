import { assert, assertEquals } from "jsr:@std/assert@1";
import { type Case, expand, type Fact, judge } from "../scripts/_link-eval.ts";

// LNK-eval 판정(순수, 네트워크 없음): 상태·일정 수(null = 측정만)·시작(날짜만은 같음, 시각은 분까지 앞부분)·장소(부분 문자열)
const c: Case = { id: "t", title: null, text: "합성", expect: { status: ["extracted"], events: 2, starts: ["2026-11-03T14:00", "2026-11-28"], location: "합성 문화센터" } };
const ev = (ordinal: number, start: string, location: string | null = null): Fact => ({ kind: "event", ordinal, payload: { start, location } });

Deno.test("link-eval judge: all match", () => {
  assertEquals(judge(c, "extracted", [ev(1, "2026-11-28"), ev(0, "2026-11-03T14:00:00+09:00", "합성 문화센터 3층")]), []);
});

Deno.test("link-eval judge: status, count, start, location misses", () => {
  assertEquals(judge(c, "discarded:server:personal", []), ["status:discarded:server:personal", "events:0", "start0", "start1", "location"]);
  assertEquals(judge(c, "extracted", [ev(0, "2026-11-03T15:00:00+09:00", "합성 문화센터"), ev(1, "2026-11-28T10:00:00+09:00")]), ["start0", "start1"]);
  assertEquals(judge({ ...c, expect: { status: ["discarded:server:empty"], events: 0 } }, "discarded:server:empty",
    [{ kind: "purchase", ordinal: 0, payload: {} }]), []);                                   // 일정이 아닌 fact 는 세지 않는다
});

Deno.test("link-eval judge: events null is measured, not judged", () => {
  const m: Case = { ...c, expect: { status: ["extracted", "discarded:server:personal"], events: null } };
  assertEquals(judge(m, "discarded:server:personal", []), []);
  assertEquals(judge(m, "extracted", [ev(0, "2026-10-03T18:00:00+09:00")]), []);
  assertEquals(judge(m, "discarded:server:promo", []), ["status:discarded:server:promo"]);
});

Deno.test("link-eval judge: notes expectation matches any event's notes", () => {
  const n: Case = { ...c, expect: { status: ["extracted"], events: 2, notes: "contest.example.com" } };
  const withNotes = (notes: string | null): Fact => ({ kind: "event", ordinal: 0, payload: { start: "2026-11-05T23:59:00+09:00", notes } });
  assertEquals(judge(n, "extracted", [withNotes("contest.example.com 에서 온라인 접수"), ev(1, "2026-11-19")]), []);
  assertEquals(judge(n, "extracted", [withNotes(null), ev(1, "2026-11-19")]), ["notes"]);
  assertEquals(judge(n, "extracted", [ev(0, "2026-11-05"), ev(1, "2026-11-19")]), ["notes"]);
});

// 여러 날 행사(2026-10-04 결정 A): notes 배열은 한 일정의 notes 가 모두 포함해야 한다(두 일정에 나뉘면 실패)
Deno.test("link-eval judge: notes array must all be in one event's notes", () => {
  const n: Case = { ...c, expect: { status: ["extracted"], events: 1, notes: ["10:00~19:00", "11:00~21:00"] } };
  const withNotes = (ordinal: number, notes: string | null): Fact => ({ kind: "event", ordinal, payload: { start: "2026-10-23", notes } });
  assertEquals(judge(n, "extracted", [withNotes(0, "체험마당 10:00~19:00 / 장터 11:00~21:00")]), []);
  assertEquals(judge(n, "extracted", [withNotes(0, "체험마당 10:00~19:00")]), ["notes"]);
  assertEquals(judge({ ...n, expect: { ...n.expect, events: 2 } }, "extracted",
    [withNotes(0, "10:00~19:00"), withNotes(1, "11:00~21:00")]), ["notes"]);
});

Deno.test("link-eval judge: date wildcard accepts all-day or a time on that date", () => {
  const w: Case = { ...c, expect: { status: ["extracted"], events: 1, starts: ["2026-10-23*"] } };
  assertEquals(judge(w, "extracted", [ev(0, "2026-10-23")]), []);
  assertEquals(judge(w, "extracted", [ev(0, "2026-10-23T10:00:00+09:00")]), []);
  assertEquals(judge(w, "extracted", [ev(0, "2026-10-24")]), ["start0"]);
});

// 끝(2026-10-04 실기기 — 10:00~16:00 공지가 캘린더에 1시간으로 들어감, 앱 0.11.3): ends 는 starts 와 같은 규칙으로 일정 k 의 end 를 본다
Deno.test("link-eval judge: ends expectation", () => {
  const e: Case = { ...c, expect: { status: ["extracted"], events: 1, starts: ["2026-10-17T10:00"], ends: ["2026-10-17T16:00"] } };
  const withEnd = (end: string | null): Fact => ({ kind: "event", ordinal: 0, payload: { start: "2026-10-17T10:00:00+09:00", end } });
  assertEquals(judge(e, "extracted", [withEnd("2026-10-17T16:00:00+09:00")]), []);
  assertEquals(judge(e, "extracted", [withEnd(null)]), ["end0"]);
  assertEquals(judge(e, "extracted", [withEnd("2026-10-17T11:00:00+09:00")]), ["end0"]);
});

Deno.test("link-eval expand: gallery filler", () => {
  assertEquals(expand("본문:\n{{GALLERY:3}}\n끝"), "본문:\n합성 갤러리 사진 설명 1번\n합성 갤러리 사진 설명 2번\n합성 갤러리 사진 설명 3번\n끝");
});

// 사례 파일: 22종(2026-10-03 SHARE 추출 지시 — contest 3·poster 2 추가, 10-04 notice-hours 끝 시각, 10-04 여러 날 행사 3종: 프로그램별 시간 박람회·7일 도서전·시각 없는 책 축제), id 유일, app_name 은 둘 중 하나, 긴 사례는 펼친 뒤 3,000~4,000자이고 일시 줄이 앞 2,000자 안(F23 — 게이트가 보는 범위)
Deno.test("link-cases.json shape", async () => {
  const cases: Case[] = JSON.parse(await Deno.readTextFile(new URL("../eval/link-cases.json", import.meta.url)));
  assertEquals(cases.length, 22);
  assertEquals(new Set(cases.map((x) => x.id)).size, 22);
  assert(cases.some((x) => x.id === "notice-hours" && x.expect.ends?.length === 1), "notice-hours");
  for (const id of ["contest-timeline", "contest-photo", "contest-hiring", "poster-festival", "poster-festival-ocr", "poster-multiday-programs", "poster-expo-week", "poster-multiday-nohours"]) {
    assert(cases.some((x) => x.id === id && x.expect.status.join() === "extracted" && (x.expect.events ?? 0) >= 1), id);
  }
  // 여러 날 공개 행사(10-04 결정 A, 같은 날 수정): 운영 시각 있고 5일 이하 → 날짜마다 시각 일정(시작·끝 시각),
  // 5일 초과·시각 없음 → 종일 1건(날짜만 시작·끝). 하루짜리 축제는 시각 + 끝 시각
  for (const id of ["poster-festival", "poster-multiday-programs"]) {
    const x = cases.find((y) => y.id === id)!.expect;
    assert(x.events === 3 && x.starts?.length === 3 && x.ends?.length === 3 && x.starts.every((s) => s.includes("T")), id);
  }
  for (const id of ["poster-expo-week", "poster-multiday-nohours"]) {
    const x = cases.find((y) => y.id === id)!.expect;
    assert(x.events === 1 && x.starts?.[0].length === 10 && x.ends?.[0].length === 10, id);
  }
  assert(cases.find((x) => x.id === "poster-festival-ocr")!.expect.ends?.[0].includes("T21:00"));
  // 장소 없는 라인업은 SHARE 예외(날짜+장소 공개 행사)에 들지 않는다 — 기대값 그대로 0건
  assertEquals(cases.find((x) => x.id === "promo-lineup")!.expect.events, 0);
  assert(cases.every((x) => (x.app_name ?? "웹 링크") === "웹 링크" || x.app_name === "이미지"));
  const long = expand(cases.find((x) => x.id === "wedding-long")!.text);
  assert(long.length >= 3000 && long.length <= 4000, `len ${long.length}`);
  assert(long.indexOf("예식 일시") < 2000);
});
