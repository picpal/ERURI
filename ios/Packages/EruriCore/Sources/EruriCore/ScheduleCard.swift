import Foundation

/// 채팅 일정 답 카드(스펙 §9 "일정 답 카드", 앱 0.8.2): 제안 한 건을 ① 찾은 곳 ② 그날 내 캘린더 ③ 상태·버튼 한 묶음으로 보인다.
/// EventKit·SwiftUI 없이 판단·문구만 — 읽기는 앱 CalendarLookup. 캘린더 내용은 기기 밖으로 나가지 않는다(§12 통제 2)
public enum ScheduleCard {
  /// 제안 시각의 종류. addable 만 캘린더 대조 상태와 버튼이 있다. 날짜만은 종일 일정으로 addable(timed false, 0.9.1 — 전에는 버튼 없는 dateOnly)
  public enum Kind: Equatable, Sendable { case addable, needsReview, past }

  /// 카드로 고른 제안. start = 시각, 날짜만(종일)이면 그날 서울 0시
  public struct Pick: Sendable {
    public let proposal: ChatReply.Proposal; public let kind: Kind; public let start: Date; public let timed: Bool
    public var title: String { ScheduleCard.title(proposal) }
    public var day: DateInterval { ScheduleCard.seoulDay(start) }
  }

  public static let maxCards = 3, maxLines = 4

  /// 카드로 보일 제안이면 Pick: create_event 이고 start 가 오프셋 있는 시각(handleAdd 와 같은 파서)이거나 달력에 있는 날짜만(YYYY-MM-DD, ProposalTiming).
  /// 지남(시각 < now, 날짜만은 그날이 끝남) → past, uncertain → needsReview, 나머지 addable(날짜만 = 종일). 서버 상태는 보지 않는다(상태는 캘린더 대조가 정한다)
  public static func card(_ p: ChatReply.Proposal, now: Date = Date()) -> Pick? {
    guard p.action == "create_event", let s = p.payload["start"]?.string, let t = ProposalTiming.parse(start: s) else { return nil }
    let uncertain: Bool = { if case .array(let u)? = p.payload["uncertain"] { return !u.isEmpty }; return false }()
    let start = t.anchor, past = t.isAllDay ? seoulDay(start).end <= now : start < now
    return Pick(proposal: p, kind: past ? .past : uncertain ? .needsReview : .addable, start: start, timed: !t.isAllDay)
  }

  /// 한 답의 카드: 일정 기간이 있으면 그 안에서 시작하는 것만(인용 항목의 무관한 일정 제외), 다가올 일정을 시작 순으로 먼저,
  /// 지난 일정은 그 뒤에 최근 것부터(추가할 수 있는 카드가 "N건 더 있음"으로 밀리지 않게). 같은 시작(분)·제목은 한 장(succeeded 가 있으면 그것), 최대 3 + 넘친 수
  public static func pick(_ ps: [ChatReply.Proposal], schedule: DateInterval?, now: Date = Date()) -> (cards: [Pick], more: Int) {
    let rank = { (c: Pick) in c.proposal.status == "succeeded" ? 0 : 1 }
    // 다가올 일정 먼저(시작 순), 지난 일정은 그 뒤(최근 것부터). 1순위가 분이라 같은 분·제목 묶음에서 succeeded 가 대표가 된다(초 차이 무시)
    let key = { (c: Pick) -> (Int, Int, Int, String) in
      c.kind == .past ? (1, -minute(c.start), rank(c), c.proposal.id) : (0, minute(c.start), rank(c), c.proposal.id)
    }
    let sorted = ps.compactMap { card($0, now: now) }
      .filter { c in schedule.map { $0.start <= c.start && c.start <= $0.end } ?? true }
      .sorted { key($0) < key($1) }
    var seen = Set<String>(), out: [Pick] = []
    for c in sorted where seen.insert("\(minute(c.start))|\(c.title)").inserted { out.append(c) }
    return (Array(out.prefix(maxCards)), max(0, out.count - maxCards))
  }

  // MARK: ① 찾은 곳

  /// "문자에서 찾은 일정" — 같은 응답의 인용(item_id 일치)에서. 인용이 없으면 "저장된 정보에서 찾은 일정"
  public static func sourceLine(_ c: ChatReply.Citation?) -> String {
    if let c, c.source == "SHARE", c.app_name == ChatAddEvent.appName { return "채팅에서 등록한 일정" }      // 0.13.0(§9 출처 표기)
    return "\(origin(c).found)에서 찾은 일정"
  }
  /// "10/1 받은 문자"(서울). 인용이 없거나 출처를 모르거나 시각을 못 읽으면 nil(스펙 §9 에 없는 문구를 만들지 않는다)
  public static func receivedLine(_ c: ChatReply.Citation?) -> String? {
    guard let c, let received = origin(c).received, let at = iso.date(from: c.occurred_at.replacingOccurrences(of: #"\.\d+"#, with: "", options: .regularExpression)) else { return nil }
    return "\(md.string(from: at)) \(received)"
  }
  private static func origin(_ c: ChatReply.Citation?) -> (found: String, received: String?) {
    guard let c else { return ("저장된 정보", nil) }
    switch c.source {
    case "MESSAGES": return ("문자", "받은 문자")
    case "NOTIFICATION":
      if SourceLabel.label(source: c.source, appName: c.app_name) == "문자" { return ("문자", "받은 문자") }
      return ("\(c.app_name.flatMap { $0.isEmpty ? nil : $0 } ?? "앱") 알림", "받은 알림")
    case "GMAIL": return ("메일", "받은 메일")
    case "SHARE":                                                         // 링크·사진 읽기(스펙 §6, 0.11.0)
      if c.app_name == ChatAddEvent.appName { return ("채팅", "등록") }               // "10/6 등록"(보낸 날, 0.13.0)
      if c.app_name == LinkText.appName { return ("공유한 링크", "공유한 링크") }
      if c.app_name == ImageText.appName { return ("공유한 이미지", "공유한 이미지") }
      return ("공유한 내용", "공유함")
    default: return ("저장된 정보", nil)
    }
  }

  // MARK: ② 그날 내 캘린더

  public struct DayLine: Equatable, Sendable { public let text: String; public let conflict: Bool }
  public static let emptyDayText = "이 날 등록된 일정 없음"
  public static func dayHeader(_ day: DateInterval) -> String { "내 캘린더 · \(dayLabel(day.start))" }

  /// 그날(서울 하루) 줄: 겹친 일정(어느 캘린더든, 그날 밖이어도) → 종일 → 시작 순. 나머지는 표시 대상 캘린더(listed)만, 취소 제외. 최대 4 + 넘친 수.
  /// conflicts 는 같은 events 에서 고른 값이어야 한다(값 비교 — 다른 조회 결과면 주황 줄이 조용히 사라진다, T1 리뷰 M1).
  /// deviceZone = EventKit 이 종일 일정을 준 기기 시간대(그 0시) — 종일 일정만 같은 벽시계의 서울 시각으로 옮겨 그날을 가른다(Review Focus 4)
  public static func dayLines(day: DateInterval, events: [ProposalFlow.CalendarEvent], conflicts: [ProposalFlow.CalendarEvent],
                              deviceZone: TimeZone = .current) -> (lines: [DayLine], more: Int) {
    // id 만 보면 안 된다 — 반복 일정은 회차마다 id(eventIdentifier)가 같고 카드는 ±1일을 읽는다
    let isHit = { (e: ProposalFlow.CalendarEvent) in conflicts.contains(e) }
    let shown = events.filter { e in
      let (s, t) = seoulSpan(e, deviceZone: deviceZone)
      return !e.canceled && (isHit(e) || (e.listed && s < day.end && (t > day.start || (s == t && s >= day.start))))
    }
    let rank = { (e: ProposalFlow.CalendarEvent) in isHit(e) ? 0 : e.allDay ? 1 : 2 }
    let lines = shown.sorted { (rank($0), $0.start, $0.id) < (rank($1), $1.start, $1.id) }
      .map { DayLine(text: "\(span($0, within: day)) \(name($0))", conflict: isHit($0)) }
    return (Array(lines.prefix(maxLines)), max(0, lines.count - maxLines))
  }

  /// 종일 일정의 [시작, 끝]을 기기 시간대 벽시계 그대로 서울 시각으로 옮긴다(기기가 서울이면 그대로). 시각 있는 일정은 그대로
  static func seoulSpan(_ e: ProposalFlow.CalendarEvent, deviceZone: TimeZone) -> (Date, Date) {
    guard e.allDay else { return (e.start, e.end) }
    var local = Calendar(identifier: .gregorian)
    local.timeZone = deviceZone
    let move = { (d: Date) in seoul.date(from: local.dateComponents([.year, .month, .day, .hour, .minute, .second], from: d)) ?? d }
    return (move(e.start), move(e.end))
  }

  // MARK: ③ 상태

  public enum Status: Equatable, Sendable {
    /// addedMovedDay = 종일 제안의 표식 종일 일정이 다른 날(그날 서울 0시)
    case added, addedMoved(Date), addedMovedDay(Date), sameEvent, addedMissing
    case conflict([ProposalFlow.CalendarEvent], maybeSame: Bool)
    /// 같은 날 제목이 비슷한 일정(0.9.2) — 종일은 그 날짜, 시각은 겹침이 없을 때만. 버튼 "그래도 추가"(확인창 없이 confirmed)
    case similar([ProposalFlow.CalendarEvent])
    case clear
  }

  /// 등록 판정(§9 상태 1~6). events = 카드 날짜 ±1일 일정(표식이 옮겨졌어도 찾는다). 캘린더 실제 상태가 1순위이고
  /// 실행 기록·서버 succeeded 는 "넣은 적 있음"의 보조 근거(succeeded 만으로 "등록됨"이라 하지 않는다). 최종 판정은 AddEventGate.
  /// 종일 제안(allDay, start = 그날 서울 0시, 0.9.1): "같은 시작(분)" 대신 같은 서울 날짜의 종일 일정 — 표식이면 등록됨, 표식 없이 같은 제목이면 같은 일정.
  /// 종일 일정은 기기 시간대 0시로 오므로 seoulSpan(deviceZone)으로 날짜를 가른다. 종일은 겹침 판정 대상이 아니다(§10).
  /// 비슷한 일정(0.9.2): 종일은 다른 제안 표식 + 같은 날짜 + 같은 정규화 제목이면 등록됨(같은 일정을 다른 제안으로 넣음), 그 밖의 비슷한 제목은
  /// "이전에 추가함" 뒤에 similar. 시각은 겹침이 우선이고 겹침이 없을 때만 같은 날 비슷한 제목(ProposalFlow.preview 와 같은 순서)
  /// timing = 제안 일시(여러 날 종일의 기간 — 비슷한 일정을 그 기간과 겹치는 날에서 찾는다). nil 이면 start·allDay 로 하루
  public static func status(pid: String, title: String, start: Date, allDay: Bool = false, timing: ProposalTiming? = nil, serverStatus: String,
                            executed: Bool, events: [ProposalFlow.CalendarEvent], deviceZone: TimeZone = .current) -> Status {
    let live = events.filter { !$0.canceled }, m = ProposalFlow.marker(pid), name = trimmed(title)
    let seoulStart = { (e: ProposalFlow.CalendarEvent) in seoulSpan(e, deviceZone: deviceZone).0 }
    let sameDay = { (e: ProposalFlow.CalendarEvent) in e.allDay && seoulDay(seoulStart(e)) == seoulDay(start) }
    if let mine = live.filter({ $0.url == m }).min(by: { abs(seoulStart($0).timeIntervalSince(start)) < abs(seoulStart($1).timeIntervalSince(start)) }) {
      guard allDay else { return minute(mine.start) == minute(start) ? .added : .addedMoved(mine.start) }
      if sameDay(mine) { return .added }
      return mine.allDay ? .addedMovedDay(seoulDay(seoulStart(mine)).start) : .addedMoved(mine.start)
    }
    let one = ProposalTiming.Day.seoulDay(of: start)
    let timing = timing ?? (allDay ? .allDay(first: one, last: one) : .timed(start))
    let similar = ProposalFlow.similar(pid: pid, title: title, timing: timing, events: events, deviceZone: deviceZone)
    if ProposalFlow.registeredTwin(title: title, timing: timing, among: similar, deviceZone: deviceZone) != nil { return .added }
    if live.contains(where: { allDay ? sameDay($0) && trimmed($0.title) == name : minute($0.start) == minute(start) && trimmed($0.title) == name }) {
      return .sameEvent
    }
    if executed || serverStatus == "succeeded" { return .addedMissing }
    let c = allDay ? [] : ProposalFlow.conflicts(pid: pid, timing: timing, events: events)   // 시각은 [start, 끝)(§10 "일정 종료")
    if c.isEmpty { return similar.isEmpty ? .clear : .similar(similar) }
    // 같은 예약의 재안내 → 다른 제안이 이미 넣은 일정(Fable #10). 자동 차단은 하지 않는다 — 오판이면 추가할 길이 없어진다
    let same = c.contains { $0.url?.absoluteString.hasPrefix(markerPrefix) == true && minute($0.start) == minute(start) }
    return .conflict(c, maybeSame: same)
  }

  public static func statusText(_ s: Status) -> String {
    switch s {
    case .added: return "✅ 캘린더에 등록됨"
    case .addedMoved(let d): return "✅ 캘린더에 등록됨 · 캘린더에서는 \(dayLabel(d)) \(hm.string(from: d))"
    case .addedMovedDay(let d): return "✅ 캘린더에 등록됨 · 캘린더에서는 \(dayLabel(d)) 종일"
    case .sameEvent: return "✅ 같은 일정이 캘린더에 있음"
    case .addedMissing: return "이전에 추가한 일정 · 이 날 캘린더에서는 찾지 못함(옮겼거나 지웠을 수 있음)"
    case .conflict(let cs, let same):
      guard let f = cs.first else { return "⚠️ 아직 캘린더에 없음" }
      return "⚠️ 아직 캘린더에 없음 · 겹치는 일정 \(span(f)) \(name(f))" + (cs.count > 1 ? " 외 \(cs.count - 1)건" : "") + (same ? " (같은 일정일 수 있음)" : "")
    case .similar(let ss): return ProposalFlow.similarLine(ss) ?? "아직 캘린더에 없음"
    case .clear: return "아직 캘린더에 없음"
    }
  }

  // MARK: 카드 모델·버튼

  public struct Model: Equatable, Sendable {
    public let pid: String; public let itemID: String; public let title: String
    /// 제안 payload 의 start 원문 — handleAdd 에 그대로 넘긴다(같은 파서)
    public let startText: String
    /// 제안 payload 의 end 원문 — 종일 여러 날의 마지막 날, 시각 일정의 끝(addFields, §10 "일정 종료")
    public let endText: String?
    public let kind: Kind; public let start: Date; public let timed: Bool
    /// addable 이고 캘린더를 읽었을 때만
    public let status: Status?
    /// nil = 캘린더를 읽지 못함(전체 접근 없음) — 그 자리에 허용 안내
    public let lines: [DayLine]?
    public let moreLines: Int
    /// 제안 payload 의 location(일정 위치, 스펙 §10 0.11.0) — addFields 로 EventKit 에
    public var location: String? = nil
    /// 제안 payload 의 notes(일정 메모, 스펙 §10 0.11.2) — addFields 로 EventKit 메모에
    public var notes: String? = nil
    public var day: DateInterval { ScheduleCard.seoulDay(start) }
  }

  /// 카드 한 장. events = 카드 날짜 ±1일의 모든 캘린더 일정(앱 CalendarLookup.cardEvents), nil = 전체 접근 없음. executed = 이 기기 실행 기록
  public static func model(_ c: Pick, events: [ProposalFlow.CalendarEvent]?, executed: Bool, deviceZone: TimeZone = .current) -> Model {
    let st: Status? = c.kind == .addable ? events.map {
      status(pid: c.proposal.id, title: c.title, start: c.start, allDay: !c.timed,
             timing: ProposalTiming.parse(start: c.proposal.payload["start"]?.string ?? "", end: c.proposal.payload["end"]?.string),
             serverStatus: c.proposal.status, executed: executed, events: $0, deviceZone: deviceZone)
    } : nil
    var conflicts: [ProposalFlow.CalendarEvent] = []
    if case .conflict(let cs, _)? = st { conflicts = cs }
    let l = events.map { dayLines(day: c.day, events: $0, conflicts: conflicts, deviceZone: deviceZone) }
    return Model(pid: c.proposal.id, itemID: c.proposal.item_id, title: c.title, startText: c.proposal.payload["start"]?.string ?? "",
                 endText: c.proposal.payload["end"]?.string, kind: c.kind, start: c.start, timed: c.timed, status: st, lines: l?.lines, moreLines: l?.more ?? 0,
                 location: ProposalReview.place(c.proposal.payload["location"]?.string), notes: ProposalReview.memo(c.proposal.payload["notes"]?.string))
  }

  public enum Action: Equatable, Sendable { case add, addAnyway, addSimilar }
  /// 버튼: 미래 제안이 "아직 없음"이면 캘린더에 추가(종일이면 "종일 일정으로 추가"), 겹침이면 겹쳐도 추가, 비슷한 일정이면 그래도 추가
  /// (둘 다 확인창 없음 — 사용자가 보고 누른다, §10). 그 밖은 없음
  public static func action(_ m: Model) -> Action? {
    guard m.kind == .addable else { return nil }
    switch m.status {
    case .clear?: return .add
    case .conflict?: return .addAnyway
    case .similar?: return .addSimilar
    default: return nil
    }
  }
  public static func buttonTitle(_ a: Action, allDay: Bool = false) -> String {
    ProposalFlow.addButtonTitle(allDay: allDay, conflictsShown: a == .addAnyway, similarShown: a == .addSimilar)
  }
  /// 화면에 보인 겹침·비슷한 일정을 사용자가 보고 누른 버튼이면 confirmed(ProposalFlow.tapConfirmed)
  public static func confirms(_ a: Action) -> Bool { a != .add }
  /// handleAdd 입력(알림 페이로드와 같은 키): 시각은 payload start 원문 그대로(같은 파서, 끝이 있으면 end), 종일은 날짜(여러 날이면 end = 마지막 날)
  public static func addFields(_ m: Model) -> [String: String] {
    var f = ["proposal_id": m.pid, "title": m.title, "start": m.startText]
    if let end = ProposalTiming.parse(start: m.startText, end: m.endText)?.fieldValues["end"] { f["end"] = end }
    if let l = m.location { f["location"] = l }
    if let n = m.notes { f["notes"] = n }
    return f
  }
  /// 상태 줄: 캘린더 대조 상태, 없으면 종류 문구(확인 필요·지난 일정). 미래 제안(시각·종일)인데 캘린더를 못 읽었으면 nil(안내가 대신한다)
  public static func statusText(_ m: Model) -> String? {
    if let s = m.status { return statusText(s) }
    switch m.kind {
    case .addable: return nil
    case .needsReview: return "내용 확인이 필요해 바로 추가하지 않음"
    case .past: return "지난 일정"
    }
  }
  public static func isWarning(_ m: Model) -> Bool { if case .conflict? = m.status { return true }; return false }
  /// "10/4(일) 15:30 제목"(끝이 있으면 "10/4(일) 15:30–17:00 제목", 0.12.0 ProposalTiming.timeLabel), 날짜만(종일)이면 "10/4(일) 종일 제목"·여러 날 "10/4(일)–10/6(화) 종일 제목"
  public static func whenLine(_ m: Model) -> String {
    let t = ProposalTiming.parse(start: m.startText, end: m.endText)
    if !m.timed, let days = t?.dayLabel { return "\(days) 종일 \(m.title)" }
    if m.timed, let when = t?.timeLabel { return "\(when) \(m.title)" }
    return "\(dayLabel(m.start)) \(m.timed ? hm.string(from: m.start) : "종일") \(m.title)"
  }
  public static func moreText(_ n: Int) -> String { "일정 제안 \(n)건 더 있음" }

  /// "기기 캘린더" 절을 카드와 같이 그릴지(§9): 일정 기간이 있고, 카드가 없거나 기간이 카드 날짜 하루(서울)보다 넓을 때
  public static func showsRangeSection(schedule: DateInterval?, cardDays: [DateInterval]) -> Bool {
    guard let s = schedule else { return false }
    guard !cardDays.isEmpty else { return true }
    let day = seoulDay(s.start)
    return !(s.start == day.start && s.end <= day.end && cardDays.allSatisfy { $0 == day })   // 끝 23:59:59·다음 날 0시 둘 다 하루(T1 리뷰 M3)
  }
  public static func seoulDay(_ d: Date) -> DateInterval { DateInterval(start: seoul.startOfDay(for: d), duration: 86_400) }

  // MARK: 내부

  static func title(_ p: ChatReply.Proposal) -> String {
    let t = trimmed(p.payload["title"]?.string ?? "")
    return t.isEmpty ? "일정" : t
  }
  /// 종일이면 "종일". day 안에 다 들면 "HH:mm–HH:mm", 아니면 "M/d HH:mm–M/d HH:mm". day 없이 부르면(상태 문구) 일정이 시작한 서울 하루로 판단 —
  /// 다음 날 0시에 끝나면 그날 안("23:00–00:00", §9). 줄과 상태 문구가 같은 일정을 같은 표기로 쓴다
  static func span(_ e: ProposalFlow.CalendarEvent, within day: DateInterval? = nil) -> String {
    if e.allDay { return "종일" }
    let d = day ?? seoulDay(e.start)
    let inside = e.start >= d.start && e.end <= d.end
    let f = inside ? hm : mdhm
    return "\(f.string(from: e.start))–\(f.string(from: e.end))"
  }
  private static func name(_ e: ProposalFlow.CalendarEvent) -> String { let t = trimmed(e.title); return t.isEmpty ? "(제목 없음)" : t }
  private static func trimmed(_ s: String) -> String { s.trimmingCharacters(in: .whitespacesAndNewlines) }
  private static func minute(_ d: Date) -> Int { Int((d.timeIntervalSince1970 / 60).rounded(.down)) }
  /// "10/4(일)"
  static func dayLabel(_ d: Date) -> String { "\(md.string(from: d))(\(weekdays[seoul.component(.weekday, from: d) - 1]))" }

  private static let markerPrefix = ProposalFlow.marker("").absoluteString     // ProposalFlow.marker 의 접두 — 표식 형식이 바뀌면 같이 바뀐다(T1 리뷰 M2)
  private static let weekdays = ["일", "월", "화", "수", "목", "금", "토"]      // Calendar.weekday 1 = 일요일
  private static let seoul: Calendar = {
    var c = Calendar(identifier: .gregorian)
    c.timeZone = TimeZone(identifier: "Asia/Seoul")!
    return c
  }()
  // handleAdd·ChatReply 와 같은 파서여야 카드 시각과 실행이 어긋나지 않는다. SDK 가 Sendable 표시를 안 해서 unsafe(설정 후 읽기만)
  nonisolated(unsafe) private static let iso = ISO8601DateFormatter()
  private static let hm = seoulFormatter("HH:mm"), md = seoulFormatter("M/d"), mdhm = seoulFormatter("M/d HH:mm")
  private static func seoulFormatter(_ format: String) -> DateFormatter {
    let f = DateFormatter()
    f.locale = Locale(identifier: "en_US_POSIX"); f.timeZone = TimeZone(identifier: "Asia/Seoul"); f.dateFormat = format
    return f
  }
}
