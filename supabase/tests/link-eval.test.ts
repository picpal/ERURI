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

Deno.test("link-eval expand: gallery filler", () => {
  assertEquals(expand("본문:\n{{GALLERY:3}}\n끝"), "본문:\n합성 갤러리 사진 설명 1번\n합성 갤러리 사진 설명 2번\n합성 갤러리 사진 설명 3번\n끝");
});

// 사례 파일: 13종, id 유일, app_name 은 둘 중 하나, 긴 사례는 펼친 뒤 3,000~4,000자이고 일시 줄이 앞 2,000자 안(F23 — 게이트가 보는 범위)
Deno.test("link-cases.json shape", async () => {
  const cases: Case[] = JSON.parse(await Deno.readTextFile(new URL("../eval/link-cases.json", import.meta.url)));
  assertEquals(cases.length, 13);
  assertEquals(new Set(cases.map((x) => x.id)).size, 13);
  assert(cases.every((x) => (x.app_name ?? "웹 링크") === "웹 링크" || x.app_name === "이미지"));
  const long = expand(cases.find((x) => x.id === "wedding-long")!.text);
  assert(long.length >= 3000 && long.length <= 4000, `len ${long.length}`);
  assert(long.indexOf("예식 일시") < 2000);
});
