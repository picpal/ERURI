import Foundation

/// 알림 액션 핸들러의 판단(스펙 §10). EventKit·네트워크 없이 테스트한다
public enum ProposalFlow {
  public enum Check: Equatable, Sendable { case proceed, stop(reason: String) }
  public enum FollowUp: Equatable, Sendable { case done, doneNotifyChanged, retryLater }

  /// 순서 1: 서버 최신 상태가 stale·succeeded 면 중단. nil(오프라인·오류)이면 받은 버전으로 진행(순서 5).
  /// readd(항목 상세 "캘린더에 다시 추가", §10 0.11.4): 캘린더에서 지운 일정을 다시 넣는다 — succeeded 는 진행, stale 만 중단
  public static func check(serverStatus: String?, readd: Bool = false) -> Check {
    switch serverStatus {
    case "stale": return .stop(reason: "stale")
    case "succeeded" where !readd: return .stop(reason: "succeeded")
    default: return .proceed
    }
  }
  /// 저장 이벤트의 url 표식(§10 "저장 후 기록 전 종료" 복구). 스킴은 스펙 §10 문구 그대로(앱이 여는 URL 스킴이 아니다)
  public static func marker(_ pid: String) -> URL { URL(string: "assistant://proposal/\(pid)")! }
  public static func searchWindow(start: Date) -> (Date, Date) { (start.addingTimeInterval(-86_400), start.addingTimeInterval(86_400)) }
  /// 제안 시각 ±1일 이벤트 중 같은 표식을 가진 것의 식별자
  public static func matchMarker(pid: String, events: [(id: String, url: URL?)]) -> String? {
    let m = marker(pid)
    return events.first { $0.url == m }?.id
  }
  /// 순서 4·5: report_execution 결과. nil = 보고 실패(다음 앱 실행 때 재전송)
  public static func reportFollowUp(_ result: String?) -> FollowUp {
    switch result {
    case nil: return .retryLater
    case "changed", "stale": return .doneNotifyChanged
    default: return .done
    }
  }

  /// 기기 캘린더 일정 한 건(EventKit 을 모르는 판단용 값). 앱 CalendarLookup 이 EKEvent 에서 만든다
  public struct CalendarEvent: Equatable, Sendable {
    public let id: String; public let title: String; public let start: Date; public let end: Date
    public let allDay: Bool; public let canceled: Bool; public let url: URL?
    /// 채팅 일정 답 카드의 줄로 보일 캘린더인가(생일·구독 캘린더 = false). 겹침 판정에는 쓰지 않는다 — 겹친 일정은 어느 캘린더든 보인다(§9)
    public let listed: Bool
    public init(id: String, title: String, start: Date, end: Date, allDay: Bool = false, canceled: Bool = false, url: URL? = nil,
                listed: Bool = true) {
      self.id = id; self.title = title; self.start = start; self.end = end; self.allDay = allDay; self.canceled = canceled; self.url = url
      self.listed = listed
    }
  }
  /// 끝을 모르는 시각 일정의 저장 길이(§10 "일정 종료" — 제안 end 가 시작보다 뒤인 시각이면 그 끝, 0.11.3)
  public static let eventDuration: TimeInterval = 3600

  /// 겹침(스펙 §10 순서 3): 저장 구간 [start, end)(end 없으면 start+1시간)와 겹치는 기존 일정, 시작 순.
  /// 종일·취소·같은 제안 표식(복구 경로)은 제외, 맞닿기만 하면(끝 = 시작) 겹침 아님. 길이 0 일정은 한 시점이라 [start, end) 안이면 겹침
  public static func conflicts(pid: String, start: Date, end: Date? = nil, events: [CalendarEvent]) -> [CalendarEvent] {
    let end = end ?? start.addingTimeInterval(eventDuration), m = marker(pid)
    return events.filter {
      !$0.allDay && !$0.canceled && $0.url != m && $0.start < end && ($0.end > start || ($0.start == $0.end && $0.start >= start))
    }.sorted { $0.start < $1.start }
  }

  /// 제안 일시별 겹침(0.9.1): 종일 제안은 §10 겹침 판정 대상이 아니다(기존 일정 쪽 종일을 빼는 규칙과 같은 이유 — 하루를 차지하지 않는다)
  public static func conflicts(pid: String, timing: ProposalTiming, events: [CalendarEvent]) -> [CalendarEvent] {
    guard case .timed(let start, let end) = timing else { return [] }
    return conflicts(pid: pid, start: start, end: end, events: events)
  }

  /// 추가 버튼 문구(제안 시트·제안 탭 행): 미리 판정한 겹침을 보였으면 "겹쳐도 추가", 비슷한 일정을 보였으면 "그래도 추가"(0.9.2),
  /// 아니면 종일 "종일 일정으로 추가"·시각 "캘린더에 추가"
  public static func addButtonTitle(allDay: Bool, conflictsShown: Bool, similarShown: Bool = false) -> String {
    conflictsShown ? "겹쳐도 추가" : similarShown ? "그래도 추가" : allDay ? "종일 일정으로 추가" : "캘린더에 추가"
  }

  // MARK: 비슷한 일정(스펙 §10, 0.9.2 사용자 결정 — 종일은 겹침 판정 대상이 아니므로 "같은 일정이 이미 있는가"로 중복을 잡는다)

  /// 제안 날짜(종일이면 그 기간과 겹치는 날, 시각이면 그 시각의 서울 하루)의 캘린더 일정(종일·시각 모두) 중 제목이 비슷한 것, 시작 순.
  /// 제외: 취소, 생일·구독 캘린더(listed = false — 카드 줄과 같은 규칙), 이 제안 표식(복구 경로). 다른 제안 표식은 ERURI 일정으로 더 느슨하게 본다(TitleMatch).
  /// 종일 일정은 기기 시간대 0시로 오므로 서울 날짜로 옮겨 가른다(ScheduleCard.seoulSpan). 겹침과의 우선순위는 preview·AddEventGate 가 정한다
  public static func similar(pid: String, title: String, timing: ProposalTiming, events: [CalendarEvent],
                             deviceZone: TimeZone = .current) -> [CalendarEvent] {
    let days = timing.seoulDays, m = marker(pid)
    return events.filter { e in
      guard !e.canceled, e.listed, e.url != m else { return false }
      let (s, t) = ScheduleCard.seoulSpan(e, deviceZone: deviceZone)
      guard s < days.end, t > days.start || (s == t && s >= days.start) else { return false }
      return TitleMatch.similar(title, e.title, eruri: isEruri(e))
    }.sorted { ($0.start, $0.id) < ($1.start, $1.id) }
  }

  /// 미리 판정(제안 시트·제안 탭 행): 겹침(시각) → 같은 일정을 다른 제안으로 이미 넣음(종일, registered) → 비슷한 일정 → 없음.
  /// registered = 다른 ERURI 제안 표식 + 같은 서울 날짜(첫날) + 같은 정규화 제목 — "캘린더에 등록됨"으로 보이고 추가 버튼을 두지 않는다(채팅 카드 상태와 같다)
  public enum Preview: Equatable, Sendable { case clear, conflict([CalendarEvent]), registered(CalendarEvent), similar([CalendarEvent]) }
  public static func preview(pid: String, title: String, timing: ProposalTiming, events: [CalendarEvent], deviceZone: TimeZone = .current) -> Preview {
    let c = conflicts(pid: pid, timing: timing, events: events)
    if !c.isEmpty { return .conflict(c) }
    let s = similar(pid: pid, title: title, timing: timing, events: events, deviceZone: deviceZone)
    if let twin = registeredTwin(title: title, timing: timing, among: s, deviceZone: deviceZone) { return .registered(twin) }
    return s.isEmpty ? .clear : .similar(s)
  }
  /// 종일 제안만: 비슷한 일정 중 다른 제안 표식 + 첫날과 같은 서울 시작 날짜 + 같은 정규화 제목
  static func registeredTwin(title: String, timing: ProposalTiming, among s: [CalendarEvent], deviceZone: TimeZone) -> CalendarEvent? {
    guard timing.isAllDay else { return nil }
    let day = timing.seoulDays.start, name = TitleMatch.normalize(title)
    return s.first { e in
      isEruri(e) && ScheduleCard.seoulDay(ScheduleCard.seoulSpan(e, deviceZone: deviceZone).0).start == day && TitleMatch.normalize(e.title) == name
    }
  }
  static func isEruri(_ e: CalendarEvent) -> Bool { e.url?.absoluteString.hasPrefix(marker("").absoluteString) == true }

  /// AddEventGate 결과 "similar:<건수>" — 비슷한 일정이 있어 저장하지 않았고 서버 보고도 없다(conflict 와 같은 취급)
  public static func similarOutcome(_ n: Int) -> String { "similar:\(n)" }
  public static func similarCount(_ outcome: String) -> Int? {
    guard outcome.hasPrefix("similar:") else { return nil }
    return Int(outcome.dropFirst("similar:".count))
  }
  /// 저장하지 않고 멈춘 결과(겹침·비슷한 일정)의 건수
  public static func heldCount(_ outcome: String) -> Int? { conflictCount(outcome) ?? similarCount(outcome) }

  /// 상태 줄 "✅ 캘린더에 비슷한 일정이 있음 · 10/8(목) 제목"(여러 건이면 " 외 N건"). 날짜는 그 일정의 서울 시작 날짜. 제목은 기기 화면에만
  public static func similarLine(_ s: [CalendarEvent], deviceZone: TimeZone = .current) -> String? {
    guard let f = s.first else { return nil }
    let name = f.title.trimmingCharacters(in: .whitespacesAndNewlines)
    return "✅ 캘린더에 비슷한 일정이 있음 · \(ScheduleCard.dayLabel(ScheduleCard.seoulSpan(f, deviceZone: deviceZone).0)) \(name.isEmpty ? "(제목 없음)" : name)"
      + (s.count > 1 ? " 외 \(s.count - 1)건" : "")
  }
  /// 확인창(미리 판정에 없던 비슷한 일정이 저장 직전에 나온 경우만, 앱 안 — 제목을 보여도 된다)
  public static func similarConfirmTitle(_ s: [CalendarEvent]) -> String {
    guard let f = s.first else { return "캘린더에 비슷한 일정이 있습니다. 그래도 추가할까요?" }
    return "캘린더에 비슷한 일정이 있습니다 — '\(f.title)'. 그래도 추가할까요?"
  }
  /// 잠금화면 "추가"가 비슷한 일정으로 멈췄을 때의 로컬 알림(겹침과 같은 식별자·카테고리 — 탭하면 제안 시트). 제목은 잠금화면에 쓰지 않는다
  public static let similarNoticeTitle = "비슷한 일정이 있습니다"
  public static func similarNoticeBody(_ n: Int) -> String { "캘린더에 비슷한 일정 \(n)건 · 탭해서 확인" }

  /// AddEventGate 결과 "conflict:<건수>" — 저장하지 않았고 서버 보고도 없다(제안은 proposed 로 남는다)
  public static func conflictOutcome(_ n: Int) -> String { "conflict:\(n)" }
  public static func conflictCount(_ outcome: String) -> Int? {
    guard outcome.hasPrefix("conflict:") else { return nil }
    return Int(outcome.dropFirst("conflict:".count))
  }

  /// 추가 버튼(0.8.1, 2026-10-01 실기기 C2 피드백): 미리 판정한 겹침을 보여 준 상태("겹쳐도 추가")면 사용자가 이미 본 것이라
  /// 확인창 없이 confirmed 로 저장한다. 겹침을 보이지 않았으면("캘린더에 추가") confirmed:false — 최종 판정은 AddEventGate
  public static func tapConfirmed(conflictsShown: Bool) -> Bool { conflictsShown }
  /// handleAdd 결과 뒤 확인창이 필요한가: confirmed:false 로 불렀는데 저장 직전 판정에서 겹침(conflict)이 새로 나온 경우만
  /// (미리 판정 뒤 캘린더가 바뀜, 게이트 C2-5). "추가"면 confirmed 로 다시 부른다
  /// 비슷한 일정(similar, 0.9.2)도 같다 — 미리 판정에 없던 것이 저장 직전에 나온 경우만 확인창
  public static func needsConfirm(confirmed: Bool, outcome: String) -> Bool { !confirmed && heldCount(outcome) != nil }

  /// 제안 시트·제안 탭 줄: "겹치는 일정: 14:00–15:00 합성 회의"(서울), 여러 건이면 " 외 N건".
  /// 시작·끝 날짜가 다르면(여러 날 걸친 일정) "10/3 09:00–10/5 18:00"처럼 날짜를 붙인다
  public static func conflictLine(_ c: [CalendarEvent]) -> String? {
    guard let f = c.first else { return nil }
    let f2 = md.string(from: f.start) == md.string(from: f.end) ? hm : mdhm
    return "겹치는 일정: \(f2.string(from: f.start))–\(f2.string(from: f.end)) \(f.title)" + (c.count > 1 ? " 외 \(c.count - 1)건" : "")
  }
  /// 확인창 제목(앱 안에서만 — 제목을 보여도 된다)
  public static func confirmTitle(_ c: [CalendarEvent]) -> String {
    guard let f = c.first else { return "같은 시간에 다른 일정이 있습니다. 그래도 추가할까요?" }
    return "같은 시간에 '\(f.title)' 일정이 있습니다. 그래도 추가할까요?"
  }

  /// 잠금화면 "추가"가 겹침으로 멈췄을 때의 로컬 알림(§10). 겹친 일정의 제목은 잠금화면에 쓰지 않는다. 식별자를 고정해 두 번 탭해도 1건.
  /// "다른 일정"이라 하지 않는다 — 메일 초대·예약은 같은 일정이 이미 캘린더에 있는 경우가 흔하다
  public static let conflictNoticeTitle = "겹치는 일정이 있습니다"
  public static func conflictNoticeBody(_ n: Int) -> String { "같은 시간에 일정 \(n)건 · 탭해서 확인" }
  public static func conflictNoticeID(_ pid: String) -> String { "conflict-\(pid)" }

  private static let hm = seoulFormatter("HH:mm"), md = seoulFormatter("M/d"), mdhm = seoulFormatter("M/d HH:mm")
  private static func seoulFormatter(_ format: String) -> DateFormatter {
    let f = DateFormatter()
    f.locale = Locale(identifier: "en_US_POSIX"); f.timeZone = TimeZone(identifier: "Asia/Seoul"); f.dateFormat = format
    return f
  }
}
