// gate-report.ts 집계(순수, M1-④ 게이트·스펙 §7 "Jev 정확도 집계"). 입력은 라벨·confidence·출처·상태와 사용자 표시뿐이다(본문·제목 없음)
// 저장 규칙이 관여한 항목은 Jev 판정이 아니므로 먼저 걸러 건수만 센다: gate_label 'rule'(게이트 건너뜀) → rule_skipped,
// gate_feedback 'rule_saved'(폐기분 함께 저장으로 복구) → rule_saved. 빼지 않으면 notice → kept 가 Jev 통과로 세진다
export type GateRow = { id: string; gate_label: string; gate_confidence: number | null; source: string; status: string };
export type GateReport = {
  labeled: number; by_label: Record<string, number>; by_source: Record<string, number>;
  gate_discarded: number; gate_passed: number; wrong_discard: number; wrong_pass: number;
  accuracy: number | null; actionable_loss_rate: number | null; rule_skipped: number; rule_saved: number;
};

export function gateReport(all: GateRow[], verdict: Map<string, string>): GateReport {
  const ruleSkipped = all.filter((r) => r.gate_label === "rule").length;
  const ruleSaved = all.filter((r) => r.gate_label !== "rule" && verdict.get(r.id) === "rule_saved").length;
  const rows = all.filter((r) => r.gate_label !== "rule" && verdict.get(r.id) !== "rule_saved");
  // 실제 게이트 폐기 = 상태가 discarded:server:<gate_label>(격리 중·정리 뒤) 또는 복구된 항목(wrong_discard). 로컬 임계값으로 재계산하지 않는다
  const discarded = rows.filter((r) => r.status === `discarded:server:${r.gate_label}` || verdict.get(r.id) === "wrong_discard");
  const passed = rows.filter((r) => !discarded.includes(r));
  const wrongDiscard = discarded.filter((r) => verdict.get(r.id) === "wrong_discard").length;
  const wrongPass = passed.filter((r) => verdict.get(r.id) === "wrong_pass").length;
  const byLabel: Record<string, number> = {};
  for (const r of rows) byLabel[r.gate_label] = (byLabel[r.gate_label] ?? 0) + 1;
  const bySource: Record<string, number> = {};
  for (const r of rows) bySource[r.source] = (bySource[r.source] ?? 0) + 1;
  const actionableTrue = passed.length - wrongPass + wrongDiscard;
  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  return {
    labeled: rows.length, by_label: byLabel, by_source: bySource,
    gate_discarded: discarded.length, gate_passed: passed.length, wrong_discard: wrongDiscard, wrong_pass: wrongPass,
    accuracy: rows.length ? r3((rows.length - wrongDiscard - wrongPass) / rows.length) : null,
    actionable_loss_rate: actionableTrue ? r3(wrongDiscard / actionableTrue) : null,
    rule_skipped: ruleSkipped, rule_saved: ruleSaved,
  };
}
