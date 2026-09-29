import { assertEquals } from "jsr:@std/assert";
import { type Question, scoreQuestion, summarize, tagCounts, validateQuestions } from "../eval/eval-lib.ts";

const ans = (i: number, o: Partial<Question> = {}): Question => ({ id: `q${i}`, question: "합성", kind: "answer", expected_item_ids: [`e${i}`],
  date_filter: i <= 10, title_only_answerable: i > 15, source: i % 3 === 0 ? "GMAIL" : i % 3 === 1 ? "NOTIFICATION" : "SHARE", ...o });
const none = (i: number): Question => ({ id: `n${i}`, question: "합성", kind: "no_answer", expected_item_ids: [] });

Deno.test("validateQuestions: 50 = 40 answer + 10 no_answer, ≥10 date filters, ≥15 not title-only, ≥3 per source (§9)", () => {
  const good = [...Array.from({ length: 40 }, (_, i) => ans(i + 1)), ...Array.from({ length: 10 }, (_, i) => none(i + 1))];
  assertEquals(validateQuestions(good), []);
  const bad = good.slice(0, 45).map((q) => ({ ...q, title_only_answerable: true }));
  const v = validateQuestions(bad);
  assertEquals(v.includes("total 45 ≠ 50"), true);
  assertEquals(v.some((x) => x.startsWith("not_title_only")), true);
});

Deno.test("scoreQuestion: top-5 hit, refusal correctness, cites expected", () => {
  assertEquals(scoreQuestion(ans(1), { hits: ["x", "e1"], refused: false, source_item_ids: ["e1"], ms: 900 }),
    { id: "q1", top5: true, refused: false, refusal_ok: true, cited_expected: true, date_filter_miss: false, ms: 900 });
  assertEquals(scoreQuestion(ans(2), { hits: ["a", "b", "c", "d", "e", "e2"], refused: true, source_item_ids: [], ms: 1 }).top5, false);
  assertEquals(scoreQuestion(ans(3), { hits: ["zz"], refused: false, source_item_ids: [], ms: 1 }).date_filter_miss, true);   // 날짜 질문인데 정답이 결과에 없음
  assertEquals(scoreQuestion(none(1), { hits: ["a"], refused: true, source_item_ids: [], ms: 1 }).refusal_ok, true);
});

Deno.test("summarize: thresholds Top-5 ≥ 90% (of 40), refusal ≥ 90% (of 10)", () => {
  const s = summarize([
    ...Array.from({ length: 36 }, (_, i) => ({ id: `q${i}`, top5: true, refused: false, refusal_ok: true, cited_expected: true, date_filter_miss: false, ms: 1, kind: "answer" as const })),
    ...Array.from({ length: 4 }, (_, i) => ({ id: `m${i}`, top5: false, refused: true, refusal_ok: false, cited_expected: false, date_filter_miss: false, ms: 1, kind: "answer" as const })),
    ...Array.from({ length: 10 }, (_, i) => ({ id: `n${i}`, top5: false, refused: true, refusal_ok: true, cited_expected: false, date_filter_miss: false, ms: 1, kind: "no_answer" as const })),
  ]);
  assertEquals([s.top5_rate, s.refusal_rate, s.pass], [0.9, 1, true]);
});

// ⑩b 에서 따로 볼 유형(원장 M2-⑧b): 긴 메일의 첫 청크 밖 답, 받은기간+종류 복합, 받은기간 무근거 거절(폴백 영향)
Deno.test("tags: known tags only, kind must match, counted and summarized per tag", () => {
  const good = [...Array.from({ length: 40 }, (_, i) => ans(i + 1, i < 3 ? { tags: ["deep_chunk"] } : i < 5 ? { tags: ["period_kind"] } : {})),
    ...Array.from({ length: 10 }, (_, i) => (i < 2 ? { ...none(i + 1), tags: ["period_no_answer" as const] } : none(i + 1)))];
  assertEquals(validateQuestions(good), []);
  assertEquals(tagCounts(good), { deep_chunk: 3, period_kind: 2, period_no_answer: 2 });
  const bad = good.map((q) => q.id === "q10" ? { ...q, tags: ["period_no_answer" as const] } : q.id === "n9" ? { ...q, tags: ["nope"] } : q);
  assertEquals(validateQuestions(bad as Question[]), ["q10: tag period_no_answer needs kind no_answer", "n9: unknown tag nope"]);
  const s = summarize([
    { id: "q1", top5: false, refused: false, refusal_ok: true, cited_expected: false, date_filter_miss: false, ms: 1, kind: "answer", tags: ["deep_chunk"] },
    { id: "q2", top5: true, refused: false, refusal_ok: true, cited_expected: true, date_filter_miss: false, ms: 1, kind: "answer", tags: ["deep_chunk"] },
    { id: "n1", top5: false, refused: false, refusal_ok: false, cited_expected: false, date_filter_miss: false, ms: 1, kind: "no_answer", tags: ["period_no_answer"] },
  ]);
  assertEquals(s.by_tag, { deep_chunk: { n: 2, top5: 1, refusal_ok: 2 }, period_no_answer: { n: 1, top5: 0, refusal_ok: 0 } });
});
