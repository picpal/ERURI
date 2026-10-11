import { assertEquals } from "jsr:@std/assert";
import { type EditCaseFile, extractVerdict, judgeEdit, summarizeEdit, validateEditCases } from "../scripts/_edit-eval.ts";

// EDIT-eval 판정(계획 E5) — 순수 함수. 사례 파일 자체도 검사한다(스펙 §15 구성 24 = edit_event 14 + 다른 의도 10, 추출 8 = 모호 4 + 명확 4)
const file = JSON.parse(await Deno.readTextFile(new URL("../eval/edit-cases.json", import.meta.url))) as EditCaseFile;
const c01 = file.cases.find((c) => c.id === "e01")!;

Deno.test("edit-cases.json: 14 edit_event + 10 others gating, 8 extraction (4 ambiguous + 4 clear), every registered key exists", () => {
  assertEquals(validateEditCases(file), []);
});
Deno.test("judgeEdit: intent and the revalidated patch must match; extra or missing fields and offset-less starts get codes", () => {
  const ok = judgeEdit(file, c01, { intent: "edit_event", edit: { start: "2026-10-09T11:00:00+09:00", end: "2026-10-09T15:00:00+09:00", title: null, location: null } });
  assertEquals([ok.intent_ok, ok.fields_ok, ok.codes], [true, true, []]);
  const shifted = judgeEdit(file, c01, { intent: "edit_event", edit: { start: "2026-10-09T11:00:00+09:00", end: null, title: null, location: null } });
  assertEquals([shifted.fields_ok, shifted.codes], [true, []]);                     // 서버가 길이를 유지해 끝을 옮긴다 — 같은 결과
  const noOffset = judgeEdit(file, c01, { intent: "edit_event", edit: { start: "2026-10-09T11:00:00", end: null, title: null, location: null } });
  assertEquals([noOffset.fields_ok, noOffset.codes], [false, ["start_no_offset", "missing:end", "missing:start"]]);
  const extra = judgeEdit(file, c01, { intent: "edit_event", edit: { start: "2026-10-09T11:00:00+09:00", end: null, title: "합성 다른 제목", location: null } });
  assertEquals(extra.codes, ["extra:title"]);
  const wrong = judgeEdit(file, file.cases.find((c) => c.id === "o01")!, { intent: "edit_event", edit: null });
  assertEquals([wrong.intent_ok, wrong.fields_ok, wrong.false_edit], [false, null, true]);
});
Deno.test("summarizeEdit: per run intent ≥ 22/24, fields ≥ 13/14, zero false edits; measure cases are reported but never gate", () => {
  const rows = file.cases.map((c) => ({ id: c.id, group: c.group, measure: c.measure === true, expected: c.intent, got: c.intent,
    intent_ok: true, fields_ok: c.intent === "edit_event" ? true : null, false_edit: false, codes: [] as string[] }));
  assertEquals(summarizeEdit([{ run: 1, rows }]).gate, "pass");
  const bad = rows.map((r) => (r.id === "o03" ? { ...r, got: "edit_event" as const, intent_ok: false, false_edit: true } : r));
  assertEquals(summarizeEdit([{ run: 1, rows: bad }]).gate, "fail");               // 다른 의도 → edit_event 1 = 실패(22/24 이어도)
  const m = rows.map((r) => (r.id === "m01" ? { ...r, intent_ok: false } : r));
  assertEquals(summarizeEdit([{ run: 1, rows: m }]).gate, "pass");
});
Deno.test("extractVerdict: ambiguous needs ampm on every event, clear needs none; no event is a failure", () => {
  assertEquals(extractVerdict({ id: "x01", text: "", ampm: true }, { kind: "event", uncertain: [["ampm"]] }), { id: "x01", ok: true, code: null });
  assertEquals(extractVerdict({ id: "x01", text: "", ampm: true }, { kind: "event", uncertain: [[]] }), { id: "x01", ok: false, code: "ampm_missing" });
  assertEquals(extractVerdict({ id: "x05", text: "", ampm: false }, { kind: "event", uncertain: [["ampm"]] }), { id: "x05", ok: false, code: "ampm_extra" });
  assertEquals(extractVerdict({ id: "x03", text: "", ampm: true }, { kind: "none", uncertain: [] }), { id: "x03", ok: false, code: "no_event" });
});
// 확인·정정 묶음(G1 EDIT-sim ⑨ c9m, Ruling G1-c9m): 값이 같아도 edit_event + 받은 start = 그 시각이어야 ampm 확인 코드가 풀린다(edit.ts confirmedCodes).
// 스펙 합격(24 = 14 + 10)과 따로 — 모든 실행에서 셋 다 맞아야 통과
Deno.test("confirm cases: three gate separately (every run), need edit_event and the returned start, never count toward 14 + 10", () => {
  const cs = file.cases.filter((c) => c.confirm === true);
  assertEquals(cs.map((c) => c.id), ["c01", "c02", "c03"]);
  const c1 = cs[0];
  const ok = judgeEdit(file, c1, { intent: "edit_event", edit: { start: "2026-10-14T18:00:00+09:00", end: null, title: null, location: null } });
  assertEquals([ok.intent_ok, ok.fields_ok, ok.codes, ok.confirm], [true, true, [], true]);
  const noStart = judgeEdit(file, c1, { intent: "edit_event", edit: { start: null, end: null, title: null, location: null } });
  assertEquals([noStart.fields_ok, noStart.codes], [false, ["confirm_start"]]);
  const q = judgeEdit(file, c1, { intent: "question", edit: null });
  assertEquals([q.intent_ok, q.fields_ok], [false, false]);
  const rows = file.cases.map((c) => ({ id: c.id, group: c.group, measure: c.measure === true, confirm: c.confirm === true, expected: c.intent, got: c.intent,
    intent_ok: true, fields_ok: c.intent === "edit_event" ? true : null, false_edit: false, codes: [] as string[] }));
  assertEquals(summarizeEdit([{ run: 1, rows }]).gate, "pass");
  const miss = rows.map((r) => (r.id === "c02" ? { ...r, got: "question" as const, intent_ok: false, fields_ok: false } : r));
  const s = summarizeEdit([{ run: 1, rows: miss }]);
  assertEquals([s.gate, s.per[0].intent, s.per[0].confirm], ["fail", 24, 2]);   // 24 판정은 그대로, 확인 묶음만 실패
});
