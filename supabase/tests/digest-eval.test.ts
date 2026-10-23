// DIGEST-eval 순수 함수(스펙 §15 DIGEST-eval ①②). 모델 호출 없음
import { assertEquals } from "jsr:@std/assert";
import { countMatches, formatOk, gradeRun, validateDigestCases } from "../scripts/_digest-eval.ts";

Deno.test("validateDigestCases: 10 cases, kinds cover the spec list, every case has 1–3 must facts and a unique marker", () => {
  const f = JSON.parse(Deno.readTextFileSync(new URL("../eval/digest-cases.json", import.meta.url)));
  assertEquals(validateDigestCases(f), []);
  assertEquals(validateDigestCases({ ...f, cases: f.cases.slice(1) }).length > 0, true);
});
Deno.test("formatOk: 1–2 lines, ≤ 80 UTF-16 each, Hangul present", () => {
  assertEquals(formatOk(["합성 주문 10/25 도착"]), { lines_ok: true, chars_ok: true, korean_ok: true });
  assertEquals(formatOk(["a", "b", "c"]).lines_ok, false);
  assertEquals(formatOk(["가".repeat(81)]).chars_ok, false);
  assertEquals(formatOk(["Order arrives"]).korean_ok, false);
});
Deno.test("gradeRun: kept all must facts → preserved; any contradicted / forbidden present / unsupported → not clean; mixing = another case's marker", () => {
  const j = { facts: [{ fact: "a", verdict: "kept" }], forbidden: [{ fact: "x", verdict: "absent" }], unsupported: [] };
  assertEquals(gradeRun(j, ["줄"], "m1", ["m2"]), { preserved: true, contradicted: 0, forbidden: 0, unsupported: 0, mixed: false });
  assertEquals(gradeRun({ ...j, facts: [{ fact: "a", verdict: "contradicted" }] }, ["줄"], "m1", ["m2"]).contradicted, 1);
  assertEquals(gradeRun(j, ["m2 이야기"], "m1", ["m2"]).mixed, true);
});
Deno.test("countMatches: exact count/latest/sender/target_in_message; empty_targets means every target field empty", () => {
  const out = { sender: null, subject_words: [], received_from: null, received_to: null, latest: false, translate: false, count: null, target_in_message: true };
  assertEquals(countMatches({ id: "x", text: "", context: [], expect: { count: null, latest: false, sender: null, target_in_message: true, empty_targets: true } }, out), true);
  assertEquals(countMatches({ id: "x", text: "", context: [], expect: { count: 3, latest: false, sender: null, target_in_message: true } }, { ...out, count: 3 }), true);
  assertEquals(countMatches({ id: "x", text: "", context: [], expect: { count: 3, latest: false, sender: null, target_in_message: true } }, { ...out, count: 2 }), false);
});
