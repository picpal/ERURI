import SwiftUI
import EruriCore

/// 채팅 저장 규칙 카드(스펙 §9 "앱 — 저장 규칙 카드", 0.17.0): chat 은 판정만 — 카드 버튼(/chat/rule)을 눌러야 바뀐다.
/// add ok: 확인 줄 + 작은 글씨(개인 대화도 저장됨, 사용자 결정 2026-10-21) + [저장 규칙 추가] → "저장 규칙을 추가했어요 (N/20)" → 폐기분이 맞으면 [함께 저장].
/// duplicate + 폐기분이면 기존 규칙으로 [함께 저장]. list·limit·remove not_found 는 목록 줄마다 [빼기], remove ok 는 맞은 규칙마다 [빼기].
/// 버튼 결과는 turn(K23 칸)에서 그린다 — 다시 열어도 같은 카드. 진행 중이면 버튼 비활성, 실패하면 버튼을 남기고 "바꾸지 못했어요"
struct SaveRuleCard: View {
  let response: SaveRules.Response
  let turn: SaveRuleTurn
  let onAdd: () -> Void
  let onRemove: (SaveRules.Rule) -> Void
  let onRestore: (String) -> Void

  private var working: Bool { turn.phase == .working }

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text(verbatim: SaveRules.headline(response)).font(.subheadline.weight(.semibold)).accessibilityIdentifier("rule-headline")
      if response.op == "add" { addBlock }
      if let rows = ruleRows { ruleList(rows.rules, head: rows.head, done: rows.done) }
      if working { ProgressView().accessibilityIdentifier("rule-progress") }
      if turn.note == SaveRules.Text.buttonFailed {
        Text(SaveRules.Text.buttonFailed).font(.footnote).foregroundStyle(.red).accessibilityIdentifier("rule-failed")
      }
    }
    .padding(.vertical, 4)
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("rule-card")
  }

  // MARK: 추가·함께 저장

  @ViewBuilder private var addBlock: some View {
    if response.status == "ok", let c = response.candidate {
      let p = SaveRules.addPrompt(c)
      Text(verbatim: p.line).font(.footnote).accessibilityIdentifier("rule-line")
      Text(p.note).font(.caption).foregroundStyle(.secondary).accessibilityIdentifier("rule-note")
      if turn.addStatus == nil {                                  // 실패(네트워크·500)는 addStatus 가 없어 버튼이 남는다
        Button("저장 규칙 추가", action: onAdd).buttonStyle(.borderedProminent).disabled(working).accessibilityIdentifier("rule-add")
      }
    }
    if let s = turn.addStatus { Text(addResult(s)).font(.subheadline).accessibilityIdentifier("rule-add-result") }
    if matched > 0 {
      Text(SaveRules.matchedLine(matched)).font(.footnote).accessibilityIdentifier("rule-matched")
      if let rid = turn.restoreRuleID(response) {                // 이미 눌렀으면 nil — 대상은 기록된 규칙(재실행 뒤에도 같은 규칙)
        Button("함께 저장") { onRestore(rid) }.buttonStyle(.bordered).disabled(working).accessibilityIdentifier("rule-restore")
      }
    }
    if let s = turn.restoreStatus {
      Text(SaveRules.restoreText(.init(status: s, restored: turn.restored ?? 0))).font(.footnote).accessibilityIdentifier("rule-restore-result")
    }
  }

  /// [저장 규칙 추가] 결과 문구 — 채팅 판정과 같은 문구(SaveRules.addText 와 같은 매핑, 기록 칸에서)
  private func addResult(_ s: String) -> String {
    switch s {
    case "added": return SaveRules.added(count: turn.addedCount ?? 0)
    case "duplicate": return SaveRules.Text.duplicate
    case "limit": return SaveRules.Text.limit
    case "bad_value": return SaveRules.Text.badValue
    default: return SaveRules.Text.buttonFailed
    }
  }

  /// 폐기분 수: 추가 버튼 결과(added·duplicate)면 그 결과, 아니면 채팅 판정 duplicate 의 수
  private var matched: Int {
    if let s = turn.addStatus { return s == "added" || s == "duplicate" ? turn.matched : 0 }
    return response.status == "duplicate" ? response.matched : 0
  }

  // MARK: 목록·빼기

  /// remove ok = 맞은 규칙(뺀 줄은 Text.removed), list = 전체(0개면 머리가 안내 문구), limit·remove not_found = 목록 카드(머리 "저장 규칙 N/20")
  private var ruleRows: (rules: [SaveRules.Rule], head: String?, done: String)? {
    switch (response.op, response.status) {
    case ("remove", "ok"): return (response.matches, nil, SaveRules.Text.removed)
    case ("list", "ok"): return response.rules.isEmpty ? nil : (response.rules, nil, SaveRules.Text.removedRow)
    case ("add", "limit"), ("remove", "not_found"):
      return response.rules.isEmpty ? nil : (response.rules, SaveRules.listHead(count: response.rules.count), SaveRules.Text.removedRow)
    default: return nil
    }
  }

  @ViewBuilder private func ruleList(_ rules: [SaveRules.Rule], head: String?, done: String) -> some View {
    if let head { Text(head).font(.footnote).foregroundStyle(.secondary).accessibilityIdentifier("rule-list-head") }
    ForEach(rules) { rule in
      VStack(alignment: .leading, spacing: 2) {
        HStack {
          Text(verbatim: SaveRules.ruleLine(rule)).font(.footnote).accessibilityIdentifier("rule-line")
          Spacer(minLength: 8)
          if !turn.removedIDs.contains(rule.id) {
            Button("빼기") { onRemove(rule) }.buttonStyle(.bordered).controlSize(.small).disabled(working)
              .accessibilityIdentifier("rule-remove-\(rule.id)")
          }
        }
        if turn.removedIDs.contains(rule.id) {
          Text(done).font(.caption).foregroundStyle(.secondary).accessibilityIdentifier("rule-removed-\(rule.id)")
        }
      }
    }
  }
}
