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
    return ProposalFlow.CalendarEvent(id: e.eventIdentifier ?? e.calendarItemIdentifier, title: e.title ?? "", start: s, end: t,
                                      allDay: e.isAllDay, canceled: e.status == .canceled, url: e.url)
  }

  /// 화면 조회(시트·제안 탭 행·채팅) 공유 store — 행마다·앱 활성화마다 새로 만들지 않는다(Fable N4). 읽기 전용.
  /// fullAccess 를 확인한 뒤에만 처음 만들어진다(lazy). AddEventGate 는 자체 store 로 저장한다(직렬 구간 유지)
  @MainActor static let store = EKEventStore()

  /// 제안 시각의 겹침(시트·제안 탭·채팅 확인창의 미리 판정). 전체 접근이 없으면 빈 배열 — 최종 판정은 AddEventGate 가 다시 한다.
  /// 메인 스레드 동기 조회(±1일). 느리면 그때 백그라운드로 옮긴다
  @MainActor static func conflicts(pid: String, start: Date) -> [ProposalFlow.CalendarEvent] {
    guard fullAccess else { return [] }
    let (from, to) = ProposalFlow.searchWindow(start: start)
    return ProposalFlow.conflicts(pid: pid, start: start, events: events(store, from: from, to: to))
  }
}
