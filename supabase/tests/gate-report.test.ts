import { assertEquals } from "jsr:@std/assert";
import { gateReport, type GateRow } from "../scripts/_gate-report.ts";

// gate-report 집계(순수). 라벨·상태·사용자 표시만 — 본문 없음
const row = (id: string, gate_label: string, source: string, status: string, gate_confidence: number | null = 0.9): GateRow =>
  ({ id, gate_label, gate_confidence, source, status });
const base: GateRow[] = [
  row("a", "notice", "MESSAGES", "discarded:server:notice"),   // 게이트 폐기(격리 중)
  row("b", "notice", "MESSAGES", "extracted"),                 // 복구 = 오폐기
  row("c", "actionable", "GMAIL", "extracted"),                // 통과 + 오통과 표시
  row("d", "actionable", "NOTIFICATION", "extracted"),         // 통과
  row("e", "ad", "GMAIL", "discarded:server:ad"),              // 게이트 폐기
];
const baseVerdict = () => new Map([["b", "wrong_discard"], ["c", "wrong_pass"]]);
// 리팩터 전 gate-report.ts 계산으로 낸 값
const before = {
  labeled: 5, by_label: { notice: 2, actionable: 2, ad: 1 }, by_source: { MESSAGES: 2, GMAIL: 2, NOTIFICATION: 1 },
  gate_discarded: 3, gate_passed: 2, wrong_discard: 1, wrong_pass: 1, accuracy: 0.6, actionable_loss_rate: 0.5,
};

Deno.test("gateReport: same numbers as before for rows without rule involvement", () => {
  assertEquals(gateReport(base, baseVerdict()), { ...before, rule_skipped: 0, rule_saved: 0 });
  assertEquals(gateReport([], new Map()), {
    labeled: 0, by_label: {}, by_source: {}, gate_discarded: 0, gate_passed: 0, wrong_discard: 0, wrong_pass: 0,
    accuracy: null, actionable_loss_rate: null, rule_skipped: 0, rule_saved: 0,
  });
});

Deno.test("gateReport: gate_label 'rule' rows leave labeled/accuracy/loss and count as rule_skipped", () => {
  const rows = [...base, row("r1", "rule", "MESSAGES", "kept", null), row("r2", "rule", "NOTIFICATION", "extracted", null)];
  // 규칙 항목에 오통과 표시가 있어도(보관함이 숨기지만) Jev 판정이 아니므로 세지 않는다
  const v = baseVerdict(); v.set("r2", "wrong_pass");
  assertEquals(gateReport(rows, v), { ...before, rule_skipped: 2, rule_saved: 0 });
});

Deno.test("gateReport: rule_saved rows (notice → kept) are not counted as Jev passes; counted as rule_saved", () => {
  const r = gateReport([{ id: "a", gate_label: "notice", gate_confidence: 0.9, source: "MESSAGES", status: "kept" }], new Map([["a", "rule_saved"]]));
  assertEquals([r.labeled, r.gate_passed, r.rule_saved, r.accuracy], [0, 0, 1, null]);
  const mixed = gateReport([...base, row("s", "notice", "MESSAGES", "kept")], new Map([...baseVerdict(), ["s", "rule_saved"]]));
  assertEquals(mixed, { ...before, rule_skipped: 0, rule_saved: 1 });
});
