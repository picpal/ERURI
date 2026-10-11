import SwiftUI
import EruriCore

/// 일정 답 카드 행(§9, 0.8.2 → 0.16.0) — ChatView 에서 동작 그대로 옮겼다(계획 P7 Ruling P7-size: ChatView 한도 K18). 등록·고치기 턴·답 카드가 같이 쓴다
extension ChatView {
  /// 일정 답 카드(§9, 0.8.2) 한 장 = 같은 Section 의 행 셋. 행마다 탭 경로가 하나다 — ① 출처 행은 원문 링크, ② 캘린더 줄은 탭 없음,
  /// ③ 버튼은 스타일을 명시해 행 탭이 아니라 자기 제스처로 눌린다(0.8.1 실기기: 스타일 없는 카드 버튼이 텍스트처럼 보이고 눌리지 않았다)
  @ViewBuilder func cardRows(_ t: Turn, _ c: ScheduleCard.Model, first: Bool) -> some View {
    let cite = t.answer?.citations.first(where: { $0.item_id == c.itemID })
      ?? (t.record.kind == .addEvent || t.record.kind == .editEvent ? ChatAddEvent.citation(itemID: c.itemID, at: t.record.at) : nil)   // 일정 등록 턴: "채팅에서 등록한 일정" · "M/D 등록"
    // 권한은 그릴 때 다시 본다 — 턴에 남은 캘린더 줄·상태가 권한 철회 뒤에도 보이지 않게, 허용 뒤 낡은 안내가 남지 않게(권한 상태는 관찰되지 않는다)
    let access = CalendarLookup.fullAccess
    NavigationLink {
      ItemDetailView(itemID: c.itemID)
    } label: {
      VStack(alignment: .leading, spacing: 2) {
        Text(ScheduleCard.sourceLine(cite)).font(.caption).bold()
        Text(ScheduleCard.whenLine(c)).font(.subheadline)
        Text([ScheduleCard.receivedLine(cite), "원문 보기"].compactMap { $0 }.joined(separator: " · "))
          .font(.caption2).foregroundStyle(.secondary)
      }
    }
    if access, let lines = c.lines {
      VStack(alignment: .leading, spacing: 2) {
        Text(ScheduleCard.dayHeader(c.day)).font(.caption).bold()
        if lines.isEmpty { Text(ScheduleCard.emptyDayText).font(.caption2).foregroundStyle(.secondary) }
        ForEach(Array(lines.enumerated()), id: \.offset) {
          Text($0.element.text).font(.caption2).foregroundStyle($0.element.conflict ? Color.orange : Color.primary)
        }
        if c.moreLines > 0 { Text("외 \(c.moreLines)건").font(.caption2).foregroundStyle(.secondary) }
      }
    } else if !access, first {
      CalendarAccessPrompt(message: DeviceCalendar.accessText) { recheck(t.id) }
    }
    statusRow(c, access: access, turn: t.id, ask: t.asks[c.pid])
  }

  /// ③ 상태 줄 + 버튼(§9 상태 1~6·§10). 버튼은 "아직 캘린더에 없음"(캘린더에 추가, 강조 채움)·겹침(겹쳐도 추가, 주황 테두리 — 확인창 없이 저장)·
  /// 비슷한 일정(그래도 추가, 테두리 — 확인창 없이 저장, 0.9.2)일 때만.
  /// 결과 문구는 실패이거나 버튼이 남아 있을 때만 — 성공하면 재조회로 상태가 "✅ 캘린더에 등록됨"으로 바뀌어 같은 말을 두 번 하지 않는다
  /// 되묻기(0.16.0 C): 채팅 등록·고치기 카드의 확인 필요(needsReview)는 상태 줄 대신 AskBackRow — turn·ask 는 그 두 턴만 넘긴다(readCalendar 의 asks)
  @ViewBuilder func statusRow(_ c: ScheduleCard.Model, access: Bool, turn: UUID? = nil, ask: AskBack.Question? = nil) -> some View {
    if let ask, let turn, c.kind == .needsReview {                                     // 확인 필요 등록 카드는 막다른 문구 대신 되묻기(C)
      AskBackRow(question: ask, running: busy || edits[c.pid].isRunning, failure: edits[c.pid].failure) { code, value in   // 전송 중에는 끈다(N6)
        resolveAsk(turn, pid: c.pid, code: code, value: value)
      }
    } else {
      let state = adds[c.pid], action = access ? ScheduleCard.action(c) : nil
      let line = access || c.status == nil ? ScheduleCard.statusText(c) : nil      // 권한이 없으면 캘린더 대조 상태는 숨기고 종류 문구(확인 필요·지난 일정)만
      if line != nil || action != nil || state != nil {
        VStack(alignment: .leading, spacing: 6) {
          if let line { Text(line).font(.caption).foregroundStyle(ScheduleCard.isWarning(c) ? Color.orange : Color.secondary) }
          if let action {
            switch action {
            case .add: addButton(c, action, state).buttonStyle(.borderedProminent)
            case .addAnyway: addButton(c, action, state).buttonStyle(.bordered).tint(.orange)
            case .addSimilar: addButton(c, action, state).buttonStyle(.bordered)
            }
          }
          switch state {
          case .failed(let m)?: Text(m).font(.caption).foregroundStyle(.red)
          case .finished(let m)? where action != nil: Text(m).font(.caption).foregroundStyle(.secondary)
          default: EmptyView()
          }
        }
      }
    }
  }

  private func addButton(_ c: ScheduleCard.Model, _ action: ScheduleCard.Action, _ state: AddState?) -> some View {
    Button(state.isRunning ? "추가하는 중…" : ScheduleCard.buttonTitle(action, allDay: !c.timed)) {   // 날짜만 = "종일 일정으로 추가"(0.9.1)
      runAdd(ConfirmAdd(id: c.pid, fields: addFields(for: c)), confirmed: ScheduleCard.confirms(action), priors: priors(for: c.pid))
    }
    .font(.subheadline)
    .disabled(state.isRunning || state.isFinished)
    .accessibilityIdentifier("scheduleCard.add")
  }
}
