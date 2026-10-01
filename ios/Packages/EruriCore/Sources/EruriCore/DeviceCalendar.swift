import Foundation

/// 채팅 "기기 캘린더" 절(스펙 §9 "일정 질문과 기기 캘린더"). EventKit 없이 판단·문구만 — 읽기는 앱 CalendarLookup.
/// 캘린더 내용은 기기 밖으로 나가지 않는다(§12 통제 2)
public enum DeviceCalendar {
  public static let maxLines = 5
  /// 절 머리. 일정이 있으면 "기기 캘린더 · 이 기간 일정 N건" — 거절 답변이어도 답 문구는 그대로 두고 이 머리로만 알린다(Codex #4)
  public static func header(_ n: Int) -> String { n > 0 ? "기기 캘린더 · 이 기간 일정 \(n)건" : "기기 캘린더" }
  public static let emptyText = "이 기간에 등록된 일정 없음"
  public static let accessText = "캘린더 접근을 허용하면 등록된 일정도 함께 확인합니다"

  /// 보일 일정: 취소된 것을 빼고 시작 순
  public static func visible(_ events: [ProposalFlow.CalendarEvent]) -> [ProposalFlow.CalendarEvent] {
    events.filter { !$0.canceled }.sorted { $0.start < $1.start }
  }
  /// 절의 줄(최대 5)과 넘친 건수("외 N건")
  public static func lines(_ events: [ProposalFlow.CalendarEvent]) -> (lines: [String], more: Int) {
    let v = visible(events)
    return (v.prefix(maxLines).map(label), max(0, v.count - maxLines))
  }
  /// "10/3(토) 14:00 합성 회의", 종일이면 "10/3(토) 종일 합성 회의"(서울 벽시계)
  public static func label(_ e: ProposalFlow.CalendarEvent) -> String {
    let c = seoul.dateComponents([.month, .day, .weekday, .hour, .minute], from: e.start)
    let day = "\(c.month ?? 0)/\(c.day ?? 0)(\(weekdays[((c.weekday ?? 1) + 6) % 7]))"
    return "\(day) \(e.allDay ? "종일" : String(format: "%02ld:%02ld", c.hour ?? 0, c.minute ?? 0)) \(e.title)"
  }

  private static let weekdays = ["일", "월", "화", "수", "목", "금", "토"]      // Calendar.weekday 1 = 일요일
  private static let seoul: Calendar = {
    var c = Calendar(identifier: .gregorian)
    c.timeZone = TimeZone(identifier: "Asia/Seoul")!
    return c
  }()
}
