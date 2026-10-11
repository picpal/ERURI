import Foundation

/// 기간 브리핑(스펙 §9 "채팅 일정 개선" 브리핑, 계획 P4·K22): 여러 날 일정 질문의 답 아래 — 날짜별·시간순 한 목록(제안 ∪ 기기 캘린더, 같은 일정 한 줄, 버튼 없음)
/// + "캘린더에 없는 일정 N건"(일정 답 카드 상태 4~6 문구·버튼) + "추가했지만 이 기간에서 찾지 못한 일정 K건". 판단·문구만 — 캘린더는 Lookup(앱, 기기 밖으로 보내지 않는다)
public enum Briefing {
  public typealias Event = ProposalFlow.CalendarEvent
  public static let maxLines = 30
  public static let allInText = "모두 캘린더에 있어요"
  public static let unappliedTail = " · 고친 값 미반영"

  /// 여러 날 질문: schedule 이 있고 from·to 가 서울 날짜로 다르다(하루 질문·schedule 없는 답은 지금 카드)
  public static func isPeriod(_ s: ChatReply.Schedule?) -> Bool {
    guard let i = s?.interval else { return false }
    return ScheduleCard.seoulDay(i.start) != ScheduleCard.seoulDay(i.end)
  }

  public struct Line: Equatable, Sendable, Identifiable {
    public let id: String; public let time: String; public let title: String; public let source: String
    public let itemID: String?                 // 제안 줄만(탭 → 항목 상세). 캘린더 줄은 nil
    public let tail: String?
    public let day: ProposalTiming.Day; let allDay: Bool; let start: Date
  }
  public struct DaySection: Equatable, Sendable { public let header: String; public let lines: [Line] }
  public struct Missing: Equatable, Sendable, Identifiable {
    public let model: ScheduleCard.Model; public let text: String; public let status: String?; public let action: ScheduleCard.Action?
    public var id: String { model.pid }
  }
  public struct Model: Equatable, Sendable {
    public let header: String; public let days: [DaySection]; public let more: Int
    public let missing: [Missing]; public let notFound: [Line]; public let access: Bool
    public var allInCalendar: Bool { access && missing.isEmpty && notFound.isEmpty }
    public var missingHeader: String? { missing.isEmpty ? nil : "캘린더에 없는 일정 \(missing.count)건" }
    public var notFoundHeader: String? { notFound.isEmpty ? nil : "추가했지만 이 기간에서 찾지 못한 일정 \(notFound.count)건 — 옮겼거나 지웠을 수 있어요" }
  }

  /// proposals = 응답의 제안(chat_proposals — fact 별 최고 버전, 0033). lookup nil = 캘린더 전체 접근 없음(목록은 제안 줄만, 아래 절 없음)
  public static func build(proposals: [ChatReply.Proposal], citations: [ChatReply.Citation], interval: DateInterval, lookup: EditFlow.Lookup?,
                           now: Date = Date(), deviceZone: TimeZone = .current) -> Model {
    let cite = { (item: String) in citations.first { $0.item_id == item } }
    let inPeriod = { (d: Date) in interval.start <= d && d <= interval.end }
    let seoulStart = { (e: Event) in ScheduleCard.seoulSpan(e, deviceZone: deviceZone).0 }
    var lines: [Line] = [], missing: [Missing] = [], notFound: [Line] = [], consumed: [Event] = []
    // create_event: 같은 약속의 두 제안(메일·문자) = 같은 시작(분)·제목 한 줄, succeeded 우선(K22 — 카드 pick 과 같은 규칙)
    for c in dedupe(proposals.compactMap { ScheduleCard.card($0, now: now) }) where inPeriod(c.start) {
      let src = source(cite(c.proposal.item_id))
      guard let l = lookup else { lines.append(proposalLine(c, source: src)); continue }
      let events = l.events(EditFlow.cardWindow(c.day))
      let t = ProposalTiming.parse(start: c.proposal.payload["start"]?.string ?? "", end: c.proposal.payload["end"]?.string)
      let reg = ScheduleCard.registration(pid: c.proposal.id, title: c.title, start: c.start, allDay: !c.timed, timing: t, serverStatus: c.proposal.status,
                                          executed: l.executed(c.proposal.id), events: events, deviceZone: deviceZone)
      if let e = reg.matched {                                         // 상태 1~3: 캘린더 값으로 한 줄. 기간 밖으로 옮겼으면 찾지 못한 줄
        if inPeriod(seoulStart(e)) { lines.append(eventLine(e, source: src, itemID: c.proposal.item_id, tail: nil, deviceZone: deviceZone)); consumed.append(e) }
        else { notFound.append(proposalLine(c, source: src)) }
        continue
      }
      if case .addedMissing = reg.status { notFound.append(proposalLine(c, source: src)); continue }   // 상태 4 — 목록·N 밖
      let m = ScheduleCard.model(c, events: events, executed: l.executed(c.proposal.id), deviceZone: deviceZone)
      lines.append(proposalLine(c, source: src))
      missing.append(Missing(model: m, text: "\(ScheduleCard.dayLabel(c.start)) · \(timeText(c)) · \(c.title) · \(src)", status: missingStatus(m), action: ScheduleCard.action(m)))
    }
    // update_event(0.16.0 고치기): 반영됨 = 새 표식 일정과 한 줄, 반영 전 = 기준 일정(①② — 넓은 조회 없음)과 한 줄 + 꼬리, 못 찾으면 새 값 기준 찾지 못한 줄(Codex M7)
    for p in proposals where p.action == "update_event" {
      let v = ProposalVersion(id: p.id, action: p.action, status: p.status, version: 0, payload: p.payload)
      guard let st = v.start, let t = ProposalTiming.parse(start: st, end: v.end) else { continue }
      let src = source(cite(p.item_id))
      guard let l = lookup else { if inPeriod(t.anchor) { lines.append(versionLine(v, t, source: src, itemID: p.item_id)) }; continue }
      if let e = l.events(EditFlow.window(t)).first(where: { !$0.canceled && $0.url == ProposalFlow.marker(p.id) }) {
        if inPeriod(seoulStart(e)) { lines.append(eventLine(e, source: src, itemID: p.item_id, tail: nil, deviceZone: deviceZone)); consumed.append(e) }
        else if inPeriod(t.anchor) { notFound.append(versionLine(v, t, source: src, itemID: p.item_id)) }
        continue
      }
      if p.status == "succeeded" { if inPeriod(t.anchor) { notFound.append(versionLine(v, t, source: src, itemID: p.item_id)) }; continue }
      guard let before = v.before, let base = v.basePID, let bs = before.start, let bt = ProposalTiming.parse(start: bs, end: before.end) else { continue }
      let id: EditFlow.IdentifierLookup = { guard let eid = l.executedEventID(base) else { return .noIdentifier }; return l.byIdentifier(eid).map { .found($0) } ?? .notFound }()
      if case .found(let e) = EditFlow.findBase(basePid: base, newPid: p.id, near: l.events(EditFlow.window(bt)), identifier: id, wide: { [] }) {
        if inPeriod(seoulStart(e)) { lines.append(eventLine(e, source: src, itemID: p.item_id, tail: unappliedTail, deviceZone: deviceZone)); consumed.append(e) }
      } else if inPeriod(t.anchor) {
        notFound.append(versionLine(v, t, source: src, itemID: p.item_id))
      }
    }
    // 캘린더에만 있는 일정: 생일·구독 캘린더·취소 제외(지금 "기기 캘린더" 절과 같다), 위에서 합친 일정 제외
    if let l = lookup {
      for e in l.events(interval) where !e.canceled && e.listed && !consumed.contains(e) {
        lines.append(eventLine(e, source: "캘린더", itemID: nil, tail: nil, deviceZone: deviceZone, floor: ProposalTiming.Day.seoulDay(of: interval.start)))
      }
    }
    let sorted = lines.sorted { ($0.day, $0.allDay ? 0 : 1, $0.start, $0.title) < ($1.day, $1.allDay ? 0 : 1, $1.start, $1.title) }
    let shown = Array(sorted.prefix(maxLines))
    var days: [DaySection] = []
    for l in shown {
      let h = ProposalTiming.label(l.day)
      if days.last?.header == h { days[days.count - 1] = DaySection(header: h, lines: days[days.count - 1].lines + [l]) } else { days.append(DaySection(header: h, lines: [l])) }
    }
    let header = "\(ScheduleCard.dayLabel(interval.start))–\(ScheduleCard.dayLabel(interval.end)) 일정 \(sorted.count)건"
    return Model(header: header, days: days, more: max(0, sorted.count - maxLines), missing: missing,
                 notFound: notFound.sorted { ($0.day, $0.start) < ($1.day, $1.start) }, access: lookup != nil)
  }

  /// 버튼(스펙 브리핑): [추가] = 캘린더에 추가, [종일 추가] = 종일 일정으로 추가, [겹쳐도 추가], [그래도 추가]
  public static func buttonTitle(_ a: ScheduleCard.Action, allDay: Bool) -> String {
    switch a { case .add: allDay ? "종일 추가" : "추가"; case .addAnyway: "겹쳐도 추가"; case .addSimilar: "그래도 추가" }
  }
  /// 출처 짧은 라벨(일정 답 카드 ①의 찾은 곳): "문자"·"메일"·"<앱> 알림"·"채팅에서 등록"·"공유한 링크"·"공유한 이미지"·"공유한 내용"·"저장된 정보"
  public static func source(_ c: ChatReply.Citation?) -> String {
    if let c, c.source == "SHARE", c.app_name == ChatAddEvent.appName { return "채팅에서 등록" }
    return ScheduleCard.origin(c).found
  }

  // MARK: 내부

  static func dedupe(_ cs: [ScheduleCard.Pick]) -> [ScheduleCard.Pick] {
    let minute = { (d: Date) in Int((d.timeIntervalSince1970 / 60).rounded(.down)) }
    var seen = Set<String>(), out: [ScheduleCard.Pick] = []
    for c in cs.sorted(by: { (minute($0.start), $0.proposal.status == "succeeded" ? 0 : 1, $0.proposal.id) < (minute($1.start), $1.proposal.status == "succeeded" ? 0 : 1, $1.proposal.id) })
    where seen.insert("\(minute(c.start))|\(c.title)").inserted { out.append(c) }
    return out
  }
  /// "15:30–17:00"·끝이 없으면 "15:30"·"종일", 날을 넘기면 "M/d HH:mm–M/d HH:mm"(일정 답 카드 ② 표기)
  static func timeText(_ c: ScheduleCard.Pick) -> String {
    timeText(ProposalTiming.parse(start: c.proposal.payload["start"]?.string ?? "", end: c.proposal.payload["end"]?.string))
  }
  static func timeText(_ t: ProposalTiming?) -> String {
    guard case .timed(let s, let e)? = t else { return "종일" }
    guard let e else { return hm.string(from: s) }
    let sameDay = e <= ScheduleCard.seoulDay(s).end
    return sameDay ? "\(hm.string(from: s))–\(hm.string(from: e))" : "\(mdhm.string(from: s))–\(mdhm.string(from: e))"
  }
  static func proposalLine(_ c: ScheduleCard.Pick, source: String) -> Line {
    Line(id: c.proposal.id, time: timeText(c), title: c.title, source: source, itemID: c.proposal.item_id, tail: nil,
         day: ProposalTiming.Day.seoulDay(of: c.start), allDay: !c.timed, start: c.start)
  }
  static func versionLine(_ v: ProposalVersion, _ t: ProposalTiming, source: String, itemID: String) -> Line {
    Line(id: v.id, time: timeText(t), title: v.displayTitle, source: source, itemID: itemID, tail: nil,
         day: ProposalTiming.Day.seoulDay(of: t.anchor), allDay: t.isAllDay, start: t.anchor)
  }
  /// 캘린더 일정 한 줄(지금 캘린더 값). 종일은 서울 날짜로 옮겨 가른다. floor = 기간 첫날(그 전에 시작한 여러 날 일정은 첫날 머리 아래)
  static func eventLine(_ e: Event, source: String, itemID: String?, tail: String?, deviceZone: TimeZone, floor: ProposalTiming.Day? = nil) -> Line {
    let s = ScheduleCard.seoulSpan(e, deviceZone: deviceZone).0
    let day = max(ProposalTiming.Day.seoulDay(of: s), floor ?? ProposalTiming.Day.seoulDay(of: s))
    return Line(id: "cal:\(e.id)|\(e.start.timeIntervalSince1970)", time: e.allDay ? "종일" : ScheduleCard.span(e, within: ScheduleCard.seoulDay(s)),
                title: e.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "(제목 없음)" : e.title.trimmingCharacters(in: .whitespacesAndNewlines),
                source: source, itemID: itemID, tail: tail, day: day, allDay: e.allDay, start: s)
  }
  /// 없는 일정 줄의 상태(스펙 브리핑): 겹침 = "겹치는 일정 15:00–16:00 제목"(외 N건), 비슷한 일정 = 그 줄, 아직 없음 = 없음(버튼만), 확인 필요·지난 일정 = 문구
  static func missingStatus(_ m: ScheduleCard.Model) -> String? {
    switch m.status {
    case .conflict(let cs, _)?:
      guard let f = cs.first else { return nil }
      return "겹치는 일정 \(ScheduleCard.span(f)) \(f.title.trimmingCharacters(in: .whitespacesAndNewlines))" + (cs.count > 1 ? " 외 \(cs.count - 1)건" : "")
    case .similar(let ss)?: return ProposalFlow.similarLine(ss)
    case .clear?: return nil
    default: return ScheduleCard.statusText(m)
    }
  }
  private static let hm = seoulFormatter("HH:mm"), mdhm = seoulFormatter("M/d HH:mm")
  private static func seoulFormatter(_ format: String) -> DateFormatter {
    let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.timeZone = TimeZone(identifier: "Asia/Seoul"); f.dateFormat = format
    return f
  }
}
