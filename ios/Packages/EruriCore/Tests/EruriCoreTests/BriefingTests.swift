import XCTest
@testable import EruriCore

/// 스펙 §9 "채팅 일정 개선" 브리핑(BRIEF-sim 모양): 기간 10/12(월)–10/18(일), 지금 2026-10-08 12:00(서울). 일정·제목은 전부 합성
final class BriefingTests: XCTestCase {
  typealias E = ProposalFlow.CalendarEvent
  private func d(_ s: String) -> Date { ISO8601DateFormatter().date(from: s)! }
  private let now = ISO8601DateFormatter().date(from: "2026-10-08T03:00:00Z")!
  private let seoul = TimeZone(identifier: "Asia/Seoul")!
  private var period: DateInterval { DateInterval(start: d("2026-10-11T15:00:00Z"), end: d("2026-10-18T14:59:59Z")) }
  private func prop(_ id: String, _ start: String, end: String? = nil, title: String, item: String, status: String = "proposed", action: String = "create_event",
                    before: ChatEdit.Values? = nil, base: String? = nil) -> ChatReply.Proposal {
    var p: [String: JSONValue] = ["title": .string(title), "start": .string(start), "uncertain": .array([])]
    if let end { p["end"] = .string(end) }
    if let b = before { p["before"] = .object(["title": .string(b.title ?? ""), "start": .string(b.start ?? ""), "end": b.end.map { .string($0) } ?? .null, "location": .null]) }
    if let base { p["base_proposal_id"] = .string(base) }
    return ChatReply.Proposal(id: id, item_id: item, action: action, status: status, payload: p)
  }
  private func cite(_ item: String, _ source: String, _ app: String? = nil) -> ChatReply.Citation {
    ChatReply.Citation(item_id: item, source: source, app_name: app, title: "합성", occurred_at: "2026-10-01T00:00:00Z", expired: false)
  }
  private func ev(_ id: String, _ s: String, _ e: String, _ title: String, pid: String? = nil, allDay: Bool = false, listed: Bool = true) -> E {
    E(id: id, title: title, start: d(s), end: d(e), allDay: allDay, url: pid.map(ProposalFlow.marker), listed: listed)
  }
  private func lookup(_ all: [E], executed: [String: String] = [:], ids: [String: E] = [:]) -> EditFlow.Lookup {
    EditFlow.Lookup(events: { w in all.filter { $0.start <= w.end && $0.end >= w.start } }, byIdentifier: { ids[$0] }, executedEventID: { executed[$0] })
  }
  private var cites: [ChatReply.Citation] { [cite("mail", "GMAIL"), cite("sms", "MESSAGES"), cite("chat", "SHARE", "채팅")] }
  // A 추가됨(메일) · B 겹침(문자) · C 종일(채팅 등록) + 캘린더 D(요가)·E(회식 — B 와 겹침)
  private var A: ChatReply.Proposal { prop("pa", "2026-10-13T10:00:00+09:00", end: "2026-10-13T11:00:00+09:00", title: "합성 치과", item: "mail", status: "succeeded") }
  private var B: ChatReply.Proposal { prop("pb", "2026-10-14T15:00:00+09:00", end: "2026-10-14T16:00:00+09:00", title: "합성 상담", item: "sms") }
  private var C: ChatReply.Proposal { prop("pc", "2026-10-16", title: "합성 워크숍", item: "chat") }
  private var cal: [E] {
    [ev("ea", "2026-10-13T01:00:00Z", "2026-10-13T02:00:00Z", "합성 치과", pid: "pa"),
     ev("ed", "2026-10-15T00:00:00Z", "2026-10-15T01:00:00Z", "합성 요가"),
     ev("ee", "2026-10-14T06:30:00Z", "2026-10-14T07:30:00Z", "합성 회식"),
     ev("eb", "2026-10-14T00:00:00Z", "2026-10-14T00:00:00Z", "합성 생일", allDay: true, listed: false)]
  }

  func testIsPeriodOnlyForMultiDaySchedules() {
    XCTAssertFalse(Briefing.isPeriod(ChatReply.Schedule(from: "2026-10-12T00:00:00+09:00", to: "2026-10-12T23:59:59+09:00")))
    XCTAssertTrue(Briefing.isPeriod(ChatReply.Schedule(from: "2026-10-12T00:00:00+09:00", to: "2026-10-18T23:59:59+09:00")))
    XCTAssertFalse(Briefing.isPeriod(nil))
  }
  func testListByDayMergesAddedProposalsAndKeepsCalendarOnlyLines() {
    let m = Briefing.build(proposals: [A, B, C], citations: cites, interval: period, lookup: lookup(cal), now: now, deviceZone: seoul)
    XCTAssertEqual(m.header, "10/12(월)–10/18(일) 일정 5건")
    XCTAssertEqual(m.days.map(\.header), ["10/13(화)", "10/14(수)", "10/15(목)", "10/16(금)"])
    XCTAssertEqual(m.days[0].lines.map { "\($0.time) · \($0.title) · \($0.source)" }, ["10:00–11:00 · 합성 치과 · 메일"])
    XCTAssertEqual(m.days[1].lines.map { "\($0.time) · \($0.title) · \($0.source)" }, ["15:00–16:00 · 합성 상담 · 문자", "15:30–16:30 · 합성 회식 · 캘린더"])
    XCTAssertEqual(m.days[3].lines.map { "\($0.time) · \($0.title) · \($0.source)" }, ["종일 · 합성 워크숍 · 채팅에서 등록"])
    XCTAssertEqual(m.days[0].lines[0].itemID, "mail"); XCTAssertNil(m.days[1].lines[1].itemID)           // 캘린더 줄은 탭 없음
    XCTAssertFalse(m.days.flatMap(\.lines).contains { $0.title == "합성 생일" })                            // 생일·구독 캘린더 제외
    XCTAssertEqual(m.missingHeader, "캘린더에 없는 일정 2건")
    XCTAssertEqual(m.missing.map(\.text), ["10/14(수) · 15:00–16:00 · 합성 상담 · 문자", "10/16(금) · 종일 · 합성 워크숍 · 채팅에서 등록"])
    XCTAssertEqual(m.missing.map(\.action), [.addAnyway, .add])
    XCTAssertEqual(m.missing[0].status, "겹치는 일정 15:30–16:30 합성 회식")
    XCTAssertEqual(Briefing.buttonTitle(.add, allDay: true), "종일 추가"); XCTAssertEqual(Briefing.buttonTitle(.add, allDay: false), "추가")
    XCTAssertEqual(Briefing.buttonTitle(.addAnyway, allDay: false), "겹쳐도 추가"); XCTAssertEqual(Briefing.buttonTitle(.addSimilar, allDay: false), "그래도 추가")
    XCTAssertNil(m.notFoundHeader); XCTAssertFalse(m.allInCalendar)
  }
  func testAllInCalendarWhenEveryProposalIsMerged() {
    let m = Briefing.build(proposals: [A], citations: cites, interval: period, lookup: lookup(cal), now: now, deviceZone: seoul)
    XCTAssertTrue(m.allInCalendar); XCTAssertEqual(Briefing.allInText, "모두 캘린더에 있어요")
  }
  func testNoAccessListsProposalsOnly() {
    let m = Briefing.build(proposals: [A, B, C], citations: cites, interval: period, lookup: nil, now: now, deviceZone: seoul)
    XCTAssertEqual(m.days.flatMap(\.lines).map(\.title), ["합성 치과", "합성 상담", "합성 워크숍"])
    XCTAssertEqual([m.missing.count, m.notFound.count], [0, 0]); XCTAssertFalse(m.access); XCTAssertFalse(m.allInCalendar)
  }
  func testFoundNowhereGoesToTheNotFoundLinesNotTheListNorN() {
    let moved = ev("ex", "2026-10-19T00:00:00Z", "2026-10-19T01:00:00Z", "합성 송별", pid: "px")                // 10/18 23:00 제안을 10/19 로 옮김(±1일 안)
    let X = prop("px", "2026-10-18T23:00:00+09:00", title: "합성 송별", item: "chat", status: "succeeded")
    let Y = prop("py", "2026-10-17T10:00:00+09:00", title: "합성 지운 일정", item: "chat", status: "succeeded")   // 표식 없음 = 상태 4
    let m = Briefing.build(proposals: [X, Y], citations: cites, interval: period, lookup: lookup([moved]), now: now, deviceZone: seoul)
    XCTAssertEqual(m.days.flatMap(\.lines).count, 0)
    XCTAssertEqual(m.notFound.map(\.title), ["합성 지운 일정", "합성 송별"])
    XCTAssertEqual(m.notFoundHeader, "추가했지만 이 기간에서 찾지 못한 일정 2건 — 옮겼거나 지웠을 수 있어요")
    XCTAssertNil(m.missingHeader)
  }
  func testUnappliedUpdateIsOneLineWithCalendarValuesAndATail() {
    let before = ChatEdit.Values(title: "합성 미팅", start: "2026-10-14T10:00:00+09:00", end: "2026-10-14T11:00:00+09:00", location: nil)
    let U = prop("p2", "2026-10-14T14:00:00+09:00", end: "2026-10-14T15:00:00+09:00", title: "합성 미팅", item: "chat", action: "update_event", before: before, base: "p1")
    let base = ev("e1", "2026-10-14T01:00:00Z", "2026-10-14T02:00:00Z", "합성 미팅", pid: "p1")
    let m = Briefing.build(proposals: [U], citations: cites, interval: period, lookup: lookup([base]), now: now, deviceZone: seoul)
    XCTAssertEqual(m.days.flatMap(\.lines).map { "\($0.time) · \($0.title) · \($0.source)\($0.tail ?? "")" }, ["10:00–11:00 · 합성 미팅 · 채팅에서 등록 · 고친 값 미반영"])
    XCTAssertEqual(m.days[0].lines[0].itemID, "chat")
    XCTAssertTrue(m.missing.isEmpty)                                                                      // 추가 버튼이 생기면 실패(M7)
    let gone = Briefing.build(proposals: [U], citations: cites, interval: period, lookup: lookup([]), now: now, deviceZone: seoul)
    XCTAssertEqual(gone.notFound.map(\.time), ["14:00–15:00"])                                             // 기준을 못 찾음 → 새 값 기준 찾지 못한 줄
  }
  func testSameAppointmentFromTwoSourcesIsOneLine() {
    let mail = prop("m1", "2026-10-13T10:00:00+09:00", title: "합성 치과", item: "mail", status: "succeeded")
    let sms = prop("s1", "2026-10-13T10:00:00+09:00", title: "합성 치과", item: "sms")
    let m = Briefing.build(proposals: [sms, mail], citations: cites, interval: period, lookup: nil, now: now, deviceZone: seoul)
    XCTAssertEqual(m.days.flatMap(\.lines).map { "\($0.title) · \($0.source)" }, ["합성 치과 · 메일"])
  }
  func testCapsAtThirtyLines() {
    let many = (0..<35).map { i in ev("c\(i)", "2026-10-13T0\(i % 9):00:00Z", "2026-10-13T0\(i % 9):30:00Z", "합성 \(i)") }
    let m = Briefing.build(proposals: [], citations: [], interval: period, lookup: lookup(many), now: now, deviceZone: seoul)
    XCTAssertEqual([m.days.flatMap(\.lines).count, m.more], [30, 5]); XCTAssertEqual(m.header, "10/12(월)–10/18(일) 일정 35건")
  }
  func testAllDayInAnotherZoneStaysOnItsSeoulDay() {
    let nz = TimeZone(identifier: "Pacific/Auckland")!                                                  // 서울보다 앞선 기기: 종일 0시가 서울 전날 저녁
    let start = ProposalTiming.Day(2026, 10, 15).start(in: nz)
    let m = Briefing.build(proposals: [], citations: [], interval: period, lookup: lookup([E(id: "nz", title: "합성 휴가", start: start, end: start, allDay: true)]),
                           now: now, deviceZone: nz)
    XCTAssertEqual(m.days.map(\.header), ["10/15(목)"])
  }
}
