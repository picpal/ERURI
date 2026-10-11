import SwiftUI
import EruriCore

/// 기간 브리핑(스펙 §9 "채팅 일정 개선" 브리핑, 계획 P7): 머리 → 날짜별 한 목록(버튼 없음 — 제안 줄 탭 → 항목 상세, 캘린더 줄은 탭 없음) →
/// "캘린더에 없는 일정 N건"(줄마다 상태·버튼) → "추가했지만 이 기간에서 찾지 못한 일정 K건" / "모두 캘린더에 있어요". 전체 접근이 없으면 아래 절 대신 허용 안내
struct BriefingView: View {
  let model: Briefing.Model
  let adds: [String: ChatView.AddState]
  let onAdd: (Briefing.Missing) -> Void
  let onOpen: (String) -> Void
  let onAllow: () -> Void

  var body: some View {
    Text(model.header).font(.caption).bold().accessibilityIdentifier("brief-header")
    ForEach(model.days, id: \.header) { day in
      VStack(alignment: .leading, spacing: 2) {
        Text(day.header).font(.caption).bold().accessibilityIdentifier("brief-day")
        ForEach(day.lines) { line($0) }
      }
    }
    if model.more > 0 { Text("외 \(model.more)건").font(.caption2).foregroundStyle(.secondary).accessibilityIdentifier("brief-more") }
    if !model.access {
      CalendarAccessPrompt(message: DeviceCalendar.accessText) { onAllow() }
    } else if model.allInCalendar {
      Text(Briefing.allInText).font(.caption).foregroundStyle(.secondary).accessibilityIdentifier("brief-all-in")
    } else {
      if let h = model.missingHeader { Text(h).font(.caption).bold().accessibilityIdentifier("brief-missing-header") }
      ForEach(model.missing) { missing($0) }
      if let h = model.notFoundHeader {
        VStack(alignment: .leading, spacing: 2) {
          Text(h).font(.caption).bold().accessibilityIdentifier("brief-notfound-header")
          ForEach(model.notFound) { line($0) }
        }
      }
    }
  }

  @ViewBuilder private func line(_ l: Briefing.Line) -> some View {
    let text = "\(l.time) · \(l.title) · \(l.source)\(l.tail ?? "")"
    if let item = l.itemID {
      Button { onOpen(item) } label: { Text(text).font(.caption2).foregroundStyle(Color.accentColor) }
        .buttonStyle(.borderless).accessibilityIdentifier("brief-open")
    } else {
      Text(text).font(.caption2).accessibilityIdentifier("brief-line")
    }
  }

  @ViewBuilder private func missing(_ m: Briefing.Missing) -> some View {
    let state = adds[m.model.pid]
    VStack(alignment: .leading, spacing: 4) {
      Button { onOpen(m.model.itemID) } label: { Text(m.text).font(.caption) }.buttonStyle(.borderless).accessibilityIdentifier("brief-missing")
      if let s = m.status { Text(s).font(.caption2).foregroundStyle(ScheduleCard.isWarning(m.model) ? Color.orange : Color.secondary) }
      if let a = m.action {
        Button(state.isRunning ? "추가하는 중…" : Briefing.buttonTitle(a, allDay: !m.model.timed)) { onAdd(m) }
          .font(.caption).buttonStyle(.bordered).tint(a == .addAnyway ? .orange : .accentColor)
          .disabled(state.isRunning || state.isFinished).accessibilityIdentifier("brief-add")
      }
      if case .failed(let t)? = state { Text(t).font(.caption2).foregroundStyle(.red) }
    }
  }
}
