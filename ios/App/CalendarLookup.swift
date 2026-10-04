import EventKit
import EruriCore

/// 기기 캘린더 읽기(스펙 §9 "일정 질문과 기기 캘린더"·§10 겹침·§12 통제 2). 읽은 일정은 화면·판정에만 쓰고 서버·Trace 로 보내지 않는다
enum CalendarLookup {
  static var fullAccess: Bool { EKEventStore.authorizationStatus(for: .event) == .fullAccess }

  /// [from, to] 에 걸친 일정. startDate·endDate 가 없는 항목은 버린다(SDK 상 Date! — 암시적 언래핑으로 죽지 않게)
  static func events(_ store: EKEventStore, from: Date, to: Date) -> [ProposalFlow.CalendarEvent] {
    store.events(matching: store.predicateForEvents(withStart: from, end: to, calendars: nil)).compactMap(value)
  }

  static func value(_ e: EKEvent) -> ProposalFlow.CalendarEvent? {
    guard let s = e.startDate, let t = e.endDate else { return nil }
    // 생일·구독(공휴일) 캘린더는 채팅 카드 줄에서 뺀다(겹침 판정에는 쓴다, §9 일정 답 카드). calendar 는 SDK 상 EKCalendar! — 옵셔널로 읽는다
    let listed = e.calendar.map { $0.type != .birthday && $0.type != .subscription } ?? true
    return ProposalFlow.CalendarEvent(id: e.eventIdentifier ?? e.calendarItemIdentifier, title: e.title ?? "", start: s, end: t,
                                      allDay: e.isAllDay, canceled: e.status == .canceled, url: e.url, listed: listed)
  }

  /// 화면 조회(시트·제안 탭 행·채팅) 공유 store — 행마다·앱 활성화마다 새로 만들지 않는다(Fable N4). 읽기 전용.
  /// fullAccess 를 확인한 뒤에만 처음 만들어진다(lazy). AddEventGate 는 자체 store 로 저장한다(직렬 구간 유지)
  @MainActor static let store = EKEventStore()

  /// 제안 시각의 겹침(채팅 확인창 문구). 시각은 [start, 끝)(§10 "일정 종료"), 종일은 빈 배열. 전체 접근이 없으면 빈 배열 — 최종 판정은 AddEventGate 가 다시 한다.
  /// 메인 스레드 동기 조회(±1일). 느리면 그때 백그라운드로 옮긴다
  @MainActor static func conflicts(pid: String, timing: ProposalTiming) -> [ProposalFlow.CalendarEvent] {
    guard fullAccess else { return [] }
    let (from, to) = timing.searchWindow
    return ProposalFlow.conflicts(pid: pid, timing: timing, events: events(store, from: from, to: to))
  }

  /// 미리 판정(제안 시트·제안 탭 행, 0.9.2): 겹침(시각) → 같은 일정을 다른 제안으로 넣음(종일) → 비슷한 일정 → 없음.
  /// 전체 접근이 없으면 clear — 최종 판정은 AddEventGate 가 다시 한다. 조회 창은 AddEventGate 와 같다(ProposalTiming.searchWindow)
  @MainActor static func preview(pid: String, title: String, timing: ProposalTiming) -> ProposalFlow.Preview {
    guard fullAccess else { return .clear }
    let (from, to) = timing.searchWindow
    return ProposalFlow.preview(pid: pid, title: title, timing: timing, events: events(store, from: from, to: to))
  }

  /// 저장 직전에 새로 나온 비슷한 일정(확인창 문구, 채팅 카드). 전체 접근이 없으면 빈 배열
  @MainActor static func similar(pid: String, title: String, timing: ProposalTiming) -> [ProposalFlow.CalendarEvent] {
    guard fullAccess else { return [] }
    let (from, to) = timing.searchWindow
    return ProposalFlow.similar(pid: pid, title: title, timing: timing, events: events(store, from: from, to: to))
  }

  /// "기기 캘린더" 절(§9): 서버가 준 일정 기간(≤ 31일)의 일정. 생일·구독(공휴일) 캘린더는 뺀다. 진단 로그에는 개수만. 공유 store
  @MainActor static func scheduleEvents(_ interval: DateInterval) -> [ProposalFlow.CalendarEvent] {
    guard fullAccess else { return [] }
    let cals = store.calendars(for: .event).filter { $0.type != .birthday && $0.type != .subscription }
    guard !cals.isEmpty else { return [] }
    let found = store.events(matching: store.predicateForEvents(withStart: interval.start, end: interval.end, calendars: cals)).compactMap(value)
    DiagLog.append("CAL schedule n=\(found.count)")
    return found
  }

  /// 일정 답 카드(§9, 0.8.2): 카드 날짜(서울 하루) ±1일의 모든 캘린더 일정 — 한 번 읽어 그날 줄(생일·구독은 listed=false)·등록 판정(표식 ±1일)·
  /// 겹침에 같이 쓴다. 전체 접근이 없으면 nil(카드는 그 자리에 안내). 공유 store, 진단 로그 없음(호출부가 카드 수만 남긴다)
  @MainActor static func cardEvents(day: DateInterval) -> [ProposalFlow.CalendarEvent]? {
    guard fullAccess else { return nil }
    return events(store, from: day.start.addingTimeInterval(-86_400), to: day.end.addingTimeInterval(86_400))
  }
}
