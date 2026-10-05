import { assert, assertEquals } from "jsr:@std/assert";
import { CASES, clip16, contextOf, ITEMS, judge, summarize } from "../scripts/_context-eval.ts";

Deno.test("fixtures are synthetic and every case's expected tags exist", () => {
  for (const i of ITEMS) assert(i.title.includes("합성") && i.text.includes("합성"));
  const tags = new Set(ITEMS.map((i) => i.tag));
  for (const c of CASES) {
    assert(tags.has(c.firstCites) && tags.has(c.secondCites));
    if (c.avoid) assert(tags.has(c.avoid));
  }
  assertEquals(CASES.filter((c) => c.judged).length, 4);
  const poison = CASES.find((c) => c.id === "poison")!;
  assert(poison.contextAnswer!.includes(poison.mustNotContain!) && !poison.contextAnswer!.includes(poison.mustContain!));
  assert(ITEMS.find((i) => i.tag === poison.secondCites)!.text.includes(poison.mustContain!));
});

Deno.test("clip16 cuts by UTF-16 length without splitting a surrogate pair", () => {
  assertEquals(clip16("가".repeat(500), 400).length, 400);
  const e = clip16("😀".repeat(300), 401);
  assertEquals(e.length, 400);                                  // 이모지 하나 = 2, 반쪽은 버린다
  assertEquals(contextOf("q", "a"), [{ question: "q", answer: "a" }]);
});

Deno.test("judge: first and second must cite their tags and not be refused; avoid tag on the second is a miss", () => {
  const c = CASES.find((x) => x.id === "switch")!;
  const ok = { status: 200, refused: false, cited: [c.firstCites], answer: "합성로 12" };
  assertEquals(judge(c, ok, { status: 200, refused: false, cited: [c.secondCites], answer: "합성" }), []);
  assertEquals(judge(c, ok, { status: 200, refused: false, cited: [c.secondCites, c.avoid!], answer: "합성" }), ["avoid"]);
  assertEquals(judge(c, { status: 200, refused: true, cited: [], answer: "" }, { status: 503, refused: false, cited: [], answer: "" }), ["first", "second"]);
});

Deno.test("judge: poison — the second answer must carry the document's fact and not the previous answer's false one", () => {
  const c = CASES.find((x) => x.id === "poison")!;
  const a = { status: 200, refused: false, cited: [c.firstCites], answer: "합성" };
  const cite = { status: 200, refused: false, cited: [c.secondCites] };
  assertEquals(judge(c, a, { ...cite, answer: "합성시 합성로 12 합성빌딩 2층이에요." }), []);
  assertEquals(judge(c, a, { ...cite, answer: "합성대로 99예요." }), ["fact", "poison"]);
  assertEquals(judge(c, a, { ...cite, answer: "합성로 12, 또는 합성대로 99" }), ["poison"]);
});

Deno.test("summarize: gate passes only when judged cases have no miss; control is measured", () => {
  const rows = [
    { case: "place", judged: true, miss: [] }, { case: "control", judged: false, miss: ["second"], secondRefused: true },
  ];
  assertEquals(summarize(rows, 1), { gate: "pass", runs: 1, cases: 1, failures: 0, control: { runs: 1, refused: 1 } });
  assertEquals(summarize([{ case: "time", judged: true, miss: ["second"] }], 1).gate, "fail");
});
