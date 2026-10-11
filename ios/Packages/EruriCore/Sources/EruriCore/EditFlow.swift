import Foundation

/// 고친 일정의 캘린더 판정(스펙 §9 B 앱 표·§10 "채팅 일정 고치기 실행", 계획 P2·K27). EventKit 없이 — 앱이 Lookup 으로 일정을 준다.
/// 고치기 카드·원래 등록 카드·항목 상세·채팅 답 카드가 같은 state 를, AddEventGate.change 가 같은 findBase·userModified·change 를 쓴다.
/// 캘린더 내용은 기기 밖으로 나가지 않는다(§12 통제 2)
public enum EditFlow {
  public typealias Event = ProposalFlow.CalendarEvent

  /// 캘린더 읽기(앱 CalendarLookup). 전체 접근이 없으면 호출부가 nil 을 넘긴다. 메인 액터에서만 쓴다(클로저가 EventKit store 를 잡는다)
  public struct Lookup {
    public let events: (DateInterval) -> [Event]
    public let byIdentifier: (String) -> Event?
    public let executedEventID: (String) -> String?        // 이 기기 실행 기록의 eventkit id
    public init(events: @escaping (DateInterval) -> [Event], byIdentifier: @escaping (String) -> Event?, executedEventID: @escaping (String) -> String?) {
      self.events = events; self.byIdentifier = byIdentifier; self.executedEventID = executedEventID
    }
    public func executed(_ pid: String) -> Bool { executedEventID(pid) != nil }
  }
  public enum IdentifierLookup: Equatable, Sendable { case noIdentifier, notFound, found(Event) }
  public enum BaseLookup: Equatable, Sendable { case found(Event), deleted, unknown }
  public enum Change: Equatable, Sendable { case done, ready(base: Event, conflicts: [Event]), userModified, deleted, unknown }
  public enum CardState: Equatable, Sendable {
    case add(ScheduleCard.Model)                          // create_event — 일정 답 카드 상태 1~6(확인 필요면 C 되묻기)
    case lineage(prior: ProposalVersion, change: Change)  // 고쳐서 생긴 create_event 인데 앞 버전이 캘린더에 있음
    case update(Change)                                   // update_event 최고 버전
    case movedAfterChange(ScheduleCard.Status)            // 바꾼 뒤 사용자가 그 일정을 옮김(K11) — .addedMoved·.addedMovedDay(캘린더 위치)
    case superseded, dismissed, past, noAccess, unreadable
  }
  public static let wideSpan: TimeInterval = 365 * 86_400

  /// §10 바꾸기 3: ① 기준 표식(before 시작 조회 창) → ② 식별자(찾은 일정이 기준·새 표식일 때만) → ③ 넓은 표식 조회(①②가 못 찾았을 때만 부른다).
  /// 취소된 일정은 없는 것. 셋 다 못 찾으면 ②에서 조회할 식별자가 있었을 때만 삭제 확인, 없었으면 확인 불가(Codex H2)
  public static func findBase(basePid: String, newPid: String, near: [Event], identifier: IdentifierLookup, wide: () -> [Event]) -> BaseLookup {
    let base = ProposalFlow.marker(basePid), new = ProposalFlow.marker(newPid)
    if let e = near.first(where: { !$0.canceled && $0.url == base }) { return .found(e) }
    if case .found(let e) = identifier, !e.canceled, e.url == base || e.url == new { return .found(e) }
    if let e = wide().first(where: { !$0.canceled && ($0.url == base || $0.url == new) }) { return .found(e) }
    if case .noIdentifier = identifier { return .unknown }
    return .deleted
  }

  /// §10 바꾸기 4: 시작·끝·제목 중 하나라도 before 와 다르면 사용자가 손댄 일정. 시각은 분 단위(before 끝이 없으면 ERURI 저장 기본 1시간),
  /// 종일은 isAllDay 와 서울 첫날·마지막 날, 제목은 앞뒤 공백 무시. 반복 규칙이 붙어 있으면 손댄 것. 장소·메모·알림·캘린더는 보지 않는다
  public static func userModified(_ e: Event, before b: ChatEdit.Values, deviceZone: TimeZone = .current) -> Bool {
    if e.recurring { return true }
    if trim(e.title) != trim(b.title ?? "") { return true }
    guard let s = b.start, let t = ProposalTiming.parse(start: s, end: b.end) else { return true }   // 기준 값을 못 읽으면 쓰지 않는다
    switch t {
    case .timed(let start, let end):
      guard !e.allDay else { return true }
      return minute(e.start) != minute(start) || minute(e.end) != minute(end ?? start.addingTimeInterval(ProposalFlow.eventDuration))
    case .allDay(let first, let last):
      guard e.allDay else { return true }
      let days = allDayDays(e, deviceZone: deviceZone)
      return days.first != first || days.last != last
    }
  }
  /// 종일 일정의 서울 첫날·마지막 날(U2): 기기 시간대 0시를 서울로 옮긴 날짜. ERURI 가 저장한 끝(마지막 날 0시)·23:59:59 모두 그날
  static func allDayDays(_ e: Event, deviceZone: TimeZone) -> (first: ProposalTiming.Day, last: ProposalTiming.Day) {
    let (s, t) = ScheduleCard.seoulSpan(e, deviceZone: deviceZone)
    return (ProposalTiming.Day.seoulDay(of: s), ProposalTiming.Day.seoulDay(of: max(s, t)))
  }

  /// §10 바꾸기 3~5 결과: 새 표식 일정이 있으면 끝남(done — 두 번 누름·쓰기 뒤 종료에도 일정 하나), 기준을 못 찾음, 손댐, 겹침
  public static func change(newPid: String, newTiming: ProposalTiming, before: ChatEdit.Values, base: BaseLookup, nearNew: [Event],
                            deviceZone: TimeZone = .current) -> Change {
    if nearNew.contains(where: { !$0.canceled && $0.url == ProposalFlow.marker(newPid) }) { return .done }
    switch base {
    case .deleted: return .deleted
    case .unknown: return .unknown
    case .found(let e):
      if userModified(e, before: before, deviceZone: deviceZone) { return .userModified }
      return .ready(base: e, conflicts: moveConflicts(newPid: newPid, timing: newTiming, events: nearNew, excluding: e))
    }
  }
  /// §10 바꾸기 5: 새 구간과 겹치는 일정(순서 3 규칙 — 종일·취소 제외) 중 그 일정 자신은 뺀다. 종일로 바뀌면 판정 없음
  public static func moveConflicts(newPid: String, timing: ProposalTiming, events: [Event], excluding: Event) -> [Event] {
    ProposalFlow.conflicts(pid: newPid, timing: timing, events: events.filter { $0 != excluding })
  }

  /// §10 계보 확인(Codex H1): version > 1 인 create_event 를 넣기 전에 같은 fact 의 앞 버전 중 캘린더에 들어간 것(이 기기 실행 기록 — 보고 여부와 무관 —
  /// 또는 그 버전 표식 일정이 그 버전 조회 창에 있음). 새 버전부터 거슬러 처음 걸리는 것
  public static func lineage(version: Int, priors: [ProposalVersion], executed: (String) -> Bool, markerFound: (ProposalVersion) -> Bool) -> ProposalVersion? {
    guard version > 1 else { return nil }
    return priors.filter { $0.version < version }.sorted { $0.version > $1.version }.first { executed($0.id) || markerFound($0) }
  }

  /// 카드 상태(스펙 B 앱 표). subject = 카드가 가리키는 제안(고치기 카드 = edit.proposal_id 행, 등록·답 카드·항목 상세 = fact 최고 버전),
  /// versions = 그 fact 의 버전 전부(모르면 [subject]). lookup nil = 캘린더 전체 접근 없음. askBack = 채팅 등록·고치기 카드(날짜 미정 카드, K28)
  public static func state(subject s: ProposalVersion, versions: [ProposalVersion], itemID: String, lookup: Lookup?, now: Date = Date(),
                           askBack: Bool = false, deviceZone: TimeZone = .current) -> CardState {
    if s.status == "dismissed" { return .dismissed }
    if s.status == "stale" { return .superseded }
    if let top = versions.max(by: { $0.version < $1.version }), top.id != s.id, top.version > s.version { return .superseded }
    if s.action == "create_event" {
      guard let pick = ScheduleCard.card(s.proposal(itemID: itemID), now: now, askBack: askBack) else { return .unreadable }
      if pick.kind == .addable, s.status == "proposed", let l = lookup, let t = ProposalTiming.parse(start: s.start ?? "", end: s.end),
         let prior = lineage(version: s.version, priors: versions, executed: l.executed, markerFound: { markerIn(l, $0) }) {
        return .lineage(prior: prior, change: resolve(newPid: s.id, timing: t, before: prior.values, basePid: prior.id, baseEventID: prior.eventkitID,
                                                      lookup: l, deviceZone: deviceZone))
      }
      return .add(ScheduleCard.model(pick, events: lookup.map { $0.events(cardWindow(pick.day)) }, executed: lookup?.executed(s.id) ?? false, deviceZone: deviceZone))
    }
    guard s.action == "update_event", let t = ProposalTiming.parse(start: s.start ?? "", end: s.end), let before = s.before, let base = s.basePID else { return .unreadable }
    if t.isAllDay ? t.seoulDays.end <= now : t.anchor < now { return .past }
    guard let l = lookup else { return .noAccess }
    let near = l.events(window(t))
    if near.contains(where: { !$0.canceled && $0.url == ProposalFlow.marker(s.id) }) { return .update(.done) }
    if s.status == "succeeded" { return applied(s, timing: t, lookup: l, near: near, deviceZone: deviceZone) }
    return .update(resolve(newPid: s.id, timing: t, before: before, basePid: base, baseEventID: s.eventkitID, lookup: l, near: near, deviceZone: deviceZone))
  }
  /// 바꾼 뒤(succeeded update_event) 새 표식 일정이 그 창에 없음(K11, Codex 플랜 리뷰 M5): §10 바꾸기 3을 그 버전 자신으로 다시(기준·새 표식 = 그 pid,
  /// 식별자 = 이 기기 실행 기록 또는 제안 eventkit_id, 넓은 표식 조회). 찾으면 사용자가 옮긴 것 — 버튼 없이 캘린더 위치. 삭제 확인이면 [캘린더에 추가]
  /// (다시 추가 — 앱이 readd 로 부른다), 식별자가 없어 확인 불가면 그 문구. 새 상태 줄은 movedAfterChange 하나(나머지는 update 표 그대로)
  static func applied(_ s: ProposalVersion, timing t: ProposalTiming, lookup l: Lookup, near: [Event], deviceZone: TimeZone) -> CardState {
    let id: IdentifierLookup = {
      guard let eid = l.executedEventID(s.id) ?? s.eventkitID else { return .noIdentifier }
      return l.byIdentifier(eid).map { .found($0) } ?? .notFound
    }()
    switch findBase(basePid: s.id, newPid: s.id, near: near, identifier: id,
                    wide: { l.events(DateInterval(start: t.anchor.addingTimeInterval(-wideSpan), end: t.anchor.addingTimeInterval(wideSpan))) }) {
    case .found(let e):
      return .movedAfterChange(e.allDay ? .addedMovedDay(ScheduleCard.seoulDay(ScheduleCard.seoulSpan(e, deviceZone: deviceZone).0).start) : .addedMoved(e.start))
    case .deleted: return .update(.deleted)
    case .unknown: return .update(.unknown)
    }
  }
  static func resolve(newPid: String, timing t: ProposalTiming, before: ChatEdit.Values, basePid: String, baseEventID: String?, lookup l: Lookup,
                      near: [Event]? = nil, deviceZone: TimeZone) -> Change {
    let nearNew = near ?? l.events(window(t))
    guard let bs = before.start, let bt = ProposalTiming.parse(start: bs, end: before.end) else { return .unknown }
    let id: IdentifierLookup = {
      guard let eid = l.executedEventID(basePid) ?? baseEventID else { return .noIdentifier }
      return l.byIdentifier(eid).map { .found($0) } ?? .notFound
    }()
    let base = findBase(basePid: basePid, newPid: newPid, near: l.events(window(bt)), identifier: id,
                        wide: { l.events(DateInterval(start: bt.anchor.addingTimeInterval(-wideSpan), end: bt.anchor.addingTimeInterval(wideSpan))) })
    return change(newPid: newPid, newTiming: t, before: before, base: base, nearNew: nearNew, deviceZone: deviceZone)
  }
  /// AddEventGate·카드와 같은 조회 창(ProposalTiming.searchWindow)
  public static func window(_ t: ProposalTiming) -> DateInterval { let (a, b) = t.searchWindow; return DateInterval(start: a, end: max(a, b)) }
  /// 일정 답 카드의 캘린더 창(카드 날짜 ±1일 — CalendarLookup.cardEvents 와 같다)
  public static func cardWindow(_ day: DateInterval) -> DateInterval { DateInterval(start: day.start.addingTimeInterval(-86_400), end: day.end.addingTimeInterval(86_400)) }
  static func markerIn(_ l: Lookup, _ p: ProposalVersion) -> Bool {
    guard let s = p.start, let t = ProposalTiming.parse(start: s, end: p.end) else { return false }
    return l.events(window(t)).contains { !$0.canceled && $0.url == ProposalFlow.marker(p.id) }
  }

  // MARK: 상태 줄·버튼

  public enum Button: Equatable, Sendable { case change, changeAnyway, add }
  public struct Status: Equatable, Sendable {
    public let text: String?; public let warning: Bool; public let conflictLine: String?; public let button: Button?
    public init(text: String?, warning: Bool, conflictLine: String?, button: Button?) { self.text = text; self.warning = warning; self.conflictLine = conflictLine; self.button = button }
  }
  /// 상태 줄(스펙 B 앱 표). add 는 일정 답 카드 행이 그린다(nil). noAccess 는 줄 없이 허용 안내(호출부)
  public static func status(_ s: CardState) -> Status? {
    let line = { (t: String) in Status(text: t, warning: false, conflictLine: nil, button: nil) }
    switch s {
    case .add, .noAccess: return nil
    case .lineage(_, let c): return changeStatus(c, ask: ChatEditText.lineage)
    case .update(let c): return changeStatus(c, ask: ChatEditText.askChange)
    case .movedAfterChange(let m):                  // "✅ 캘린더도 바꿨어요 · 캘린더에서는 M/D HH:mm"(버튼 없음) — 위치 표기는 일정 답 카드 문구 그대로
      return line(ScheduleCard.statusText(m).replacingOccurrences(of: ScheduleCard.statusText(.added), with: ChatEditText.changed))
    case .superseded: return line(ChatEditText.superseded)
    case .dismissed: return line(ChatEditText.dismissed)
    case .past: return line("지난 일정")
    case .unreadable: return line("내용 확인이 필요해 바로 추가하지 않음")
    }
  }
  static func changeStatus(_ c: Change, ask: String) -> Status {
    switch c {
    case .done: return Status(text: ChatEditText.changed, warning: false, conflictLine: nil, button: nil)
    case .ready(_, let cs): return Status(text: ask, warning: !cs.isEmpty, conflictLine: cs.isEmpty ? nil : ChatEditText.conflictLine(cs), button: cs.isEmpty ? .change : .changeAnyway)
    case .userModified: return Status(text: ChatEditText.userModified, warning: false, conflictLine: nil, button: nil)
    case .deleted: return Status(text: ChatEditText.deleted, warning: false, conflictLine: nil, button: .add)
    case .unknown: return Status(text: ChatEditText.unknown, warning: false, conflictLine: nil, button: nil)
    }
  }

  /// [캘린더도 바꾸기] 입력(앱이 AddEventGate.change 요청으로 옮긴다). lineage = 그 앞 버전이 기준, update = payload before·base_proposal_id
  public struct ChangeInput: Equatable, Sendable {
    public let newPid: String; public let version: Int; public let title: String; public let startText: String; public let endText: String?
    public let location: String?; public let basePid: String; public let before: ChatEdit.Values; public let baseEventID: String?
    public init(newPid: String, version: Int, title: String, startText: String, endText: String?, location: String?, basePid: String,
                before: ChatEdit.Values, baseEventID: String?) {
      self.newPid = newPid; self.version = version; self.title = title; self.startText = startText; self.endText = endText
      self.location = location; self.basePid = basePid; self.before = before; self.baseEventID = baseEventID
    }
  }
  public static func changeInput(subject s: ProposalVersion, state: CardState) -> ChangeInput? {
    let make = { (base: String, before: ChatEdit.Values, ek: String?) in
      ChangeInput(newPid: s.id, version: s.version, title: s.displayTitle, startText: s.start ?? "", endText: s.end,
                  location: ProposalReview.place(s.location), basePid: base, before: before, baseEventID: ek)
    }
    switch state {
    case .lineage(let p, .ready): return make(p.id, p.values, p.eventkitID)
    case .update(.ready):
      guard let b = s.before, let base = s.basePID else { return nil }
      return make(base, b, s.eventkitID)
    default: return nil
    }
  }
  /// 계보 확인의 서버 조회(§10, K13): handleAdd 순서 1 조회(proposals?id=eq.<pid>)에 같은 fact 의 버전을 더한다 — 같은 요청·같은 5초
  public static let lineageSelect = "facts(proposals(id,version,status,start:payload->>start,end_at:payload->>end))"
  /// 그 조회 행(JSON 객체) → 같은 fact 의 버전들(version 오름차순). facts 가 없거나 형식이 틀리면 nil(= 모른다 — version > 1 이면 저장하지 않는다)
  public static func priors(row: [String: Any]) -> [ProposalVersion]? {
    guard let f = row["facts"] as? [String: Any], let ps = f["proposals"] as? [[String: Any]] else { return nil }
    return ps.compactMap { p -> ProposalVersion? in
      guard let id = p["id"] as? String, let v = p["version"] as? Int else { return nil }
      var payload: [String: JSONValue] = [:]
      if let s = p["start"] as? String { payload["start"] = .string(s) }
      if let e = p["end_at"] as? String { payload["end"] = .string(e) }
      return ProposalVersion(id: id, action: "create_event", status: p["status"] as? String ?? "", version: v, payload: payload)
    }.sorted { $0.version < $1.version }
  }
  /// [캘린더에 추가](삭제 확인된 update_event·lineage — §10: payload 새 값으로 새 일정): handleAdd 필드. 못 읽으면 nil
  public static func addFields(_ s: ProposalVersion) -> [String: String]? {
    guard let st = s.start, let t = ProposalTiming.parse(start: st, end: s.end) else { return nil }
    var f = t.fieldValues.merging(["proposal_id": s.id, "title": s.displayTitle, "version": String(s.version)]) { a, _ in a }
    if let l = ProposalReview.place(s.location) { f["location"] = l }
    if let n = ProposalReview.memo(s.payload["notes"]?.string) { f["notes"] = n }
    return f
  }

  private static func trim(_ s: String) -> String { s.trimmingCharacters(in: .whitespacesAndNewlines) }
  private static func minute(_ d: Date) -> Int { Int((d.timeIntervalSince1970 / 60).rounded(.down)) }
}
