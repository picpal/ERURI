import Foundation

/// 제안 일시(스펙 §10, 0.9.1 사용자 결정 A): 시각 있는 start → 그 시각부터 1시간, 날짜만(YYYY-MM-DD) → 종일 일정(서울 날짜, 뒤 날짜의 end 가 있으면 그날까지).
/// 알림 액션(handleAdd)·제안 탭·묶음 시트·채팅 카드가 같은 해석을 쓴다. 입력은 푸시 페이로드·list_pending_proposals(0026)·채팅 payload 의 start·end 문자열
public enum ProposalTiming: Equatable, Sendable {
  case timed(Date)
  /// 첫날·마지막 날(서울 달력 날짜). 하루면 같다
  case allDay(first: Day, last: Day)

  /// 달력 날짜(시간대 없음). 서울 날짜를 그대로 담는다
  public struct Day: Equatable, Comparable, Sendable {
    public let year: Int, month: Int, day: Int
    public init(_ year: Int, _ month: Int, _ day: Int) { self.year = year; self.month = month; self.day = day }
    /// "2026-10-08"
    public var text: String { String(format: "%04d-%02d-%02d", year, month, day) }
    /// 이 날짜의 zone 기준 0시
    public func start(in zone: TimeZone) -> Date {
      var c = Calendar(identifier: .gregorian); c.timeZone = zone
      return c.date(from: DateComponents(year: year, month: month, day: day))!
    }
    public static func < (a: Day, b: Day) -> Bool { (a.year, a.month, a.day) < (b.year, b.month, b.day) }

    /// "YYYY-MM-DD" 이고 달력에 있는 날짜만(2월 30일·13월 제외)
    static func parse(_ s: String) -> Day? {
      guard s.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil else { return nil }
      let p = s.split(separator: "-").compactMap { Int($0) }
      guard p.count == 3, let at = seoul.date(from: DateComponents(year: p[0], month: p[1], day: p[2])) else { return nil }
      let back = seoul.dateComponents([.year, .month, .day], from: at)
      guard back.year == p[0], back.month == p[1], back.day == p[2] else { return nil }
      return Day(p[0], p[1], p[2])
    }
    /// 시각의 서울 날짜
    static func seoulDay(of d: Date) -> Day {
      let c = seoul.dateComponents([.year, .month, .day], from: d)
      return Day(c.year!, c.month!, c.day!)
    }
  }

  /// start: 오프셋 있는 ISO 시각(소수 초 허용 — handleAdd 와 같은 파서) 또는 날짜만. end 는 종일에서만 쓴다: 날짜만이거나 시각의 서울 날짜이고
  /// 첫날보다 뒤일 때만 마지막 날(그 밖은 하루). 시각 있는 일정의 end 는 쓰지 않는다(§10 — 1시간으로 저장). 못 읽으면 nil(추가 버튼 없음)
  public static func parse(start: String, end: String? = nil) -> ProposalTiming? {
    if let at = parseInstant(start) { return .timed(at) }
    guard let first = Day.parse(start) else { return nil }
    let last = end.flatMap { Day.parse($0) ?? parseInstant($0).map(Day.seoulDay(of:)) }.flatMap { $0 > first ? $0 : nil } ?? first
    return .allDay(first: first, last: last)
  }

  public var isAllDay: Bool { if case .allDay = self { return true }; return false }

  /// 표식 조회 창(±1일)·카드 날짜의 기준: 시각, 종일은 첫날 서울 0시
  public var anchor: Date {
    switch self {
    case .timed(let at): return at
    case .allDay(let first, _): return first.start(in: Self.seoul.timeZone)
    }
  }

  /// EventKit 저장 구간. 시각: [start, start+1시간)(§10). 종일: 기기 시간대의 첫날 0시 ~ 마지막 날 0시 — isAllDay 이벤트는 날짜만 쓰므로
  /// 서울 날짜를 기기 달력의 같은 날짜로 옮긴다(기기가 다른 시간대여도 날짜가 밀리지 않게). 하루면 시작 = 끝
  public func eventSpan(deviceZone: TimeZone = .current) -> (start: Date, end: Date) {
    switch self {
    case .timed(let at): return (at, at.addingTimeInterval(ProposalFlow.eventDuration))
    case .allDay(let first, let last): return (first.start(in: deviceZone), last.start(in: deviceZone))
    }
  }

  /// 종일 표시 "10/8(목) · 종일", 여러 날 "10/8(목)–10/10(토) · 종일". 시각 있으면 nil(기존 표기)
  public var allDayLabel: String? { dayLabel.map { "\($0) · 종일" } }
  /// 날짜 부분만 "10/8(목)" · "10/8(목)–10/10(토)"(확인 필요 일정 표시용). 시각 있으면 nil
  public var dayLabel: String? {
    guard case .allDay(let first, let last) = self else { return nil }
    let a = Self.label(first)
    return first == last ? a : "\(a)–\(Self.label(last))"
  }

  /// handleAdd 필드(알림 페이로드와 같은 키)의 start·end. 종일은 YYYY-MM-DD(여러 날이면 end), 시각은 ISO(소수 초 없이)
  public var fieldValues: [String: String] {
    switch self {
    case .timed(let at): return ["start": Self.iso.string(from: at)]
    case .allDay(let first, let last): return first == last ? ["start": first.text] : ["start": first.text, "end": last.text]
    }
  }

  static func label(_ d: Day) -> String { ScheduleCard.dayLabel(d.start(in: seoul.timeZone)) }
  static func parseInstant(_ s: String) -> Date? {
    iso.date(from: s.replacingOccurrences(of: #"\.\d+"#, with: "", options: .regularExpression))
  }
  // handleAdd·ChatReply 와 같은 파서. SDK 가 Sendable 표시를 안 해서 unsafe(설정 후 읽기·쓰기만)
  nonisolated(unsafe) private static let iso = ISO8601DateFormatter()
  private static let seoul: Calendar = {
    var c = Calendar(identifier: .gregorian)
    c.timeZone = TimeZone(identifier: "Asia/Seoul")!
    return c
  }()
}
