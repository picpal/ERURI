import SwiftUI
import EruriCore

/// 고친 일정 카드의 머리(스펙 §9 B 앱): "일정을 고쳤어요"(값이 같고 확인 코드만 풀렸으면 "확인했어요" — ChatEdit.headerText) + 바뀐 칸만 "전 → 후"
struct EditHeaderView: View {
  let header: String
  let diff: [String]
  var body: some View {
    VStack(alignment: .leading, spacing: 2) {
      Text(header).font(.subheadline).bold().accessibilityIdentifier("edit-header")
      ForEach(diff, id: \.self) { Text($0).font(.caption).accessibilityIdentifier("edit-diff") }
    }
  }
}

/// 고친 일정 카드의 상태 부분(스펙 §9 B 앱 표, 계획 P6a·K18): "내 캘린더 · 그날" 줄 + 상태 줄 + 겹침 줄 + 버튼 하나.
/// 값과 클로저만 받는다 — 상태·전송은 ChatView·ItemDetailView. 전체 접근이 없으면 줄·상태·버튼 대신 허용 안내
struct EditCardView: View {
  let status: EditFlow.Status?
  let dayHeader: String?
  let dayLines: [ScheduleCard.DayLine]
  let access: Bool
  let running: Bool
  let failure: String?
  let onButton: (EditFlow.Button) -> Void
  let onAllow: () -> Void

  var body: some View {
    if !access {
      CalendarAccessPrompt(message: DeviceCalendar.accessText) { onAllow() }
    } else {
      if let dayHeader {
        VStack(alignment: .leading, spacing: 2) {
          Text(dayHeader).font(.caption).bold()
          if dayLines.isEmpty { Text(ScheduleCard.emptyDayText).font(.caption2).foregroundStyle(.secondary) }
          ForEach(Array(dayLines.enumerated()), id: \.offset) {
            Text($0.element.text).font(.caption2).foregroundStyle($0.element.conflict ? Color.orange : Color.primary)
          }
        }
      }
      if let s = status {
        VStack(alignment: .leading, spacing: 6) {
          if let t = s.text { Text(t).font(.caption).foregroundStyle(.secondary).accessibilityIdentifier("edit-status") }
          if let c = s.conflictLine { Text(c).font(.caption).foregroundStyle(.orange).accessibilityIdentifier("edit-conflict") }
          if let b = s.button { button(b) }
          if let failure { Text(failure).font(.caption).foregroundStyle(.red) }
        }
      }
    }
  }

  @ViewBuilder private func button(_ b: EditFlow.Button) -> some View {
    switch b {
    case .change:
      Button(running ? "바꾸는 중…" : ChatEditText.changeButton) { onButton(b) }
        .buttonStyle(.borderedProminent).disabled(running).accessibilityIdentifier("edit-change")
    case .changeAnyway:
      Button(running ? "바꾸는 중…" : ChatEditText.changeAnywayButton) { onButton(b) }
        .buttonStyle(.bordered).tint(.orange).disabled(running).accessibilityIdentifier("edit-change-anyway")
    case .add:
      Button(running ? "추가하는 중…" : ChatEditText.addButton) { onButton(b) }
        .buttonStyle(.borderedProminent).disabled(running).accessibilityIdentifier("edit-add")
    }
  }
}
