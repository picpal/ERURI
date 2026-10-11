import SwiftUI
import EruriCore

/// 확인 필요 일정 되묻기(스펙 §9 C, 계획 P6b): 질문 한 줄 + [오전 h:mm]/[오후 h:mm]·[올해]/[내년]·날짜 선택 + [이 날로]·[장소 없이 추가].
/// 값과 클로저만 받는다. 날짜 선택은 서울 달력으로 보이고 값도 서울 날짜(AskBack.dateValue)
struct AskBackRow: View {
  let question: AskBack.Question
  let running: Bool
  let failure: String?
  let onPick: (AskBack.Code, String) -> Void
  @State private var picked: Date

  init(question: AskBack.Question, running: Bool, failure: String?, onPick: @escaping (AskBack.Code, String) -> Void) {
    self.question = question; self.running = running; self.failure = failure; self.onPick = onPick
    if case .date(let initial, _) = question { _picked = State(initialValue: initial) } else { _picked = State(initialValue: Date()) }
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(AskBackText.question(question.code)).font(.caption).foregroundStyle(.secondary).accessibilityIdentifier("ask-question")
      switch question {
      case .ampm(let am, let pm):
        HStack { choice(am, id: "ask-am"); choice(pm, id: "ask-pm") }
      case .year(let cs):
        HStack { ForEach(Array(cs.enumerated()), id: \.offset) { choice($0.element, id: $0.offset == 0 ? "ask-this-year" : "ask-next-year") } }
      case .date(_, let range):
        HStack {
          DatePicker("", selection: $picked, in: range, displayedComponents: .date).labelsHidden()
            .environment(\.timeZone, TimeZone(identifier: "Asia/Seoul")!).accessibilityIdentifier("ask-date-picker")
          Button(AskBackText.applyDate) { onPick(.date, AskBack.dateValue(picked)) }
            .buttonStyle(.borderedProminent).disabled(running).accessibilityIdentifier("ask-date-apply")
        }
      case .location:
        Button(AskBackText.noLocation) { onPick(.location, "") }
          .buttonStyle(.borderedProminent).disabled(running).accessibilityIdentifier("ask-no-location")
      }
      if let failure { Text(failure).font(.caption).foregroundStyle(.red) }
    }
  }

  private func choice(_ c: AskBack.Choice, id: String) -> some View {
    Button(c.label) { onPick(question.code, c.value) }.buttonStyle(.bordered).disabled(running).accessibilityIdentifier(id)
  }
}
