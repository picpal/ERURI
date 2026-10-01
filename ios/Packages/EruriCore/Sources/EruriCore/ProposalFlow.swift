import Foundation

/// 알림 액션 핸들러의 판단(스펙 §10). EventKit·네트워크 없이 테스트한다
public enum ProposalFlow {
  public enum Check: Equatable, Sendable { case proceed, stop(reason: String) }
  public enum FollowUp: Equatable, Sendable { case done, doneNotifyChanged, retryLater }

  /// 순서 1: 서버 최신 상태가 stale·succeeded 면 중단. nil(오프라인·오류)이면 받은 버전으로 진행(순서 5)
  public static func check(serverStatus: String?) -> Check {
    switch serverStatus {
    case "stale": return .stop(reason: "stale")
    case "succeeded": return .stop(reason: "succeeded")
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
    public init(id: String, title: String, start: Date, end: Date, allDay: Bool = false, canceled: Bool = false, url: URL? = nil) {
      self.id = id; self.title = title; self.start = start; self.end = end; self.allDay = allDay; self.canceled = canceled; self.url = url
    }
  }
  /// AddEventGate 가 저장하는 길이. 겹침은 이 구간으로 판정한다(제안 end 는 저장에 쓰지 않는다)
  public static let eventDuration: TimeInterval = 3600

  /// 겹침(스펙 §10 순서 3): 저장 구간 [start, start+1시간)과 겹치는 기존 일정, 시작 순.
  /// 종일·취소·같은 제안 표식(복구 경로)은 제외, 맞닿기만 하면(끝 = 시작) 겹침 아님. 길이 0 일정은 한 시점이라 [start, end) 안이면 겹침
  public static func conflicts(pid: String, start: Date, events: [CalendarEvent]) -> [CalendarEvent] {
    let end = start.addingTimeInterval(eventDuration), m = marker(pid)
    return events.filter {
      !$0.allDay && !$0.canceled && $0.url != m && $0.start < end && ($0.end > start || ($0.start == $0.end && $0.start >= start))
    }.sorted { $0.start < $1.start }
  }

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
  public static func needsConfirm(confirmed: Bool, outcome: String) -> Bool { !confirmed && conflictCount(outcome) != nil }

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
