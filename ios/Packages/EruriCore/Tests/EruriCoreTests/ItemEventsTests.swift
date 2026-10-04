import XCTest
@testable import EruriCore

/// 일정 다시 추가(스펙 §10, 0.11.4 — 2026-10-04 사용자 지적: 캘린더에서 지운 일정을 다시 넣을 길이 없음).
/// 항목 상세 "일정" 절: 그 항목의 일정 제안(순번 순) → 캘린더 대조(채팅 카드 등록 판정) → 있음 / 다시 추가 / 추가. 문구는 합성
final class ItemEventsTests: XCTestCase {
  private func d(_ s: String) -> Date { ISO8601DateFormatter().date(from: s)! }
  private let seoul = TimeZone(identifier: "Asia/Seoul")!
  private let now = ISO8601DateFormatter().date(from: "2026-10-04T00:00:00Z")!

  private func json(_ o: Any) -> Data { try! JSONSerialization.data(withJSONObject: o) }
  private func prop(_ id: String, status: String = "proposed", version: Int = 1, action: String = "create_event", _ payload: [String: Any]) -> [String: Any] {
    ["id": id, "action": action, "status": status, "version": version, "payload": payload]
  }
  private func row(status: String = "succeeded", start: String = "2026-10-08T10:00:00+09:00", end: String? = "2026-10-08T16:00:00+09:00",
                   title: String = "합성 공모전 본선", uncertain: [String] = []) -> ItemEvents.Row {
    var p: [String: Any] = ["title": title, "start": start, "location": " 합성구청 대강당 ", "notes": "합성 접수 사이트에서 신청"]
    if let end { p["end"] = end }
    if !uncertain.isEmpty { p["uncertain"] = uncertain }
    return ItemEvents.decode(json([["ordinal": 0, "proposals": [prop("11111111-1111-1111-1111-111111111111", status: status, p)]]]))!.first!
  }
  private func ev(_ title: String, _ s: String, _ e: String, url: URL? = nil, allDay: Bool = false) -> ProposalFlow.CalendarEvent {
    ProposalFlow.CalendarEvent(id: UUID().uuidString, title: title, start: d(s), end: d(e), allDay: allDay, url: url)
  }

  /// 본인 facts(event, active) ⨝ proposals — 본문 열 없이 순번 순
  func testQuery() {
    let q = ItemEvents.query(itemID: "aaaaaaaa-0000-0000-0000-000000000001")
    XCTAssertEqual(q, "rest/v1/facts?item_id=eq.aaaaaaaa-0000-0000-0000-000000000001&kind=eq.event&status=eq.active"
                   + "&select=ordinal,proposals(id,action,status,version,payload)&order=ordinal.asc")
    XCTAssertFalse(q.contains("content") || q.contains("evidence"))
  }

  /// 순번 순, fact 마다 version 이 가장 큰 제안 하나. 제안 없는 fact(백필 등)는 뺀다. 형식이 틀리면 nil
  func testDecodeOrderAndLatestVersion() {
    let data = json([
      ["ordinal": 1, "proposals": [prop("p-b1", version: 1, ["title": "합성 2차", "start": "2026-10-09"]),
                                   prop("p-b2", status: "succeeded", version: 2, ["title": "합성 2차(변경)", "start": "2026-10-10"])]],
      ["ordinal": 0, "proposals": [prop("p-a", ["title": "  합성 1차 ", "start": "2026-10-08T10:00:00+09:00"])]],
      ["ordinal": 2, "proposals": []],
    ])
    let rows = ItemEvents.decode(data)!
    XCTAssertEqual(rows.map(\.pid), ["p-a", "p-b2"])
    XCTAssertEqual(rows.map(\.title), ["합성 1차", "합성 2차(변경)"])
    XCTAssertEqual(rows[1].status, "succeeded"); XCTAssertEqual(rows[1].version, 2)
    XCTAssertNil(ItemEvents.decode(Data("{}".utf8)))
    XCTAssertEqual(ItemEvents.decode(json([]))!, [])
  }

  /// 시각: "10/8(목) 10:00–16:00", 끝 없으면 시작만, 날을 넘기면 끝에 날짜. 종일: 기존 종일 표기. 제목이 비면 "일정"
  func testWhenLabelAndTitle() {
    XCTAssertEqual(row().whenLabel, "10/8(목) 10:00–16:00")
    XCTAssertEqual(row(end: nil).whenLabel, "10/8(목) 10:00")
    XCTAssertEqual(row(end: "2026-10-09T01:00:00+09:00").whenLabel, "10/8(목) 10:00–10/9(금) 01:00")
    XCTAssertEqual(row(start: "2026-10-08", end: "2026-10-10").whenLabel, "10/8(목)–10/10(토) · 종일")
    XCTAssertEqual(row(title: "  ").title, "일정")
  }

  /// handleAdd 입력: 제안 탭 행과 같은 키(위치·메모·끝 포함). start 를 못 읽으면 nil
  func testAddFields() {
    let f = row().addFields!
    XCTAssertEqual(f["proposal_id"], "11111111-1111-1111-1111-111111111111")
    XCTAssertEqual(f["title"], "합성 공모전 본선"); XCTAssertEqual(f["version"], "1")
    XCTAssertEqual(f["start"], "2026-10-08T01:00:00Z"); XCTAssertEqual(f["end"], "2026-10-08T07:00:00Z")
    XCTAssertEqual(f["location"], "합성구청 대강당"); XCTAssertEqual(f["notes"], "합성 접수 사이트에서 신청")
    XCTAssertNil(row(start: "다음 주").addFields)
  }

  /// 넣은 적 있음(서버 succeeded 또는 이 기기 기록) + 캘린더에 없음 → 다시 추가
  func testAddedButMissingIsReadd() {
    XCTAssertEqual(ItemEvents.state(row(), executed: false, events: [], now: now, deviceZone: seoul), .readd)
    XCTAssertEqual(ItemEvents.state(row(status: "proposed"), executed: true, events: [], now: now, deviceZone: seoul), .readd)
    // 다른 날·다른 제목 일정뿐이면 그대로 다시 추가
    let other = ev("합성 치과", "2026-10-08T03:00:00Z", "2026-10-08T04:00:00Z")
    XCTAssertEqual(ItemEvents.state(row(), executed: true, events: [other], now: now, deviceZone: seoul), .readd)
  }

  /// 표식 일정·같은 시작·같은 제목 → 캘린더에 있음(버튼 없음)
  func testPresentIsInCalendar() {
    let r = row()
    let mine = ev("바꾼 제목", "2026-10-08T01:00:00Z", "2026-10-08T07:00:00Z", url: ProposalFlow.marker(r.pid))
    XCTAssertEqual(ItemEvents.state(r, executed: true, events: [mine], now: now, deviceZone: seoul), .inCalendar("✅ 캘린더에 있음"))
    let moved = ev("합성 공모전 본선", "2026-10-08T02:00:00Z", "2026-10-08T03:00:00Z", url: ProposalFlow.marker(r.pid))
    XCTAssertEqual(ItemEvents.state(r, executed: true, events: [moved], now: now, deviceZone: seoul), .inCalendar("✅ 캘린더에 있음 · 캘린더에서는 10/8(목) 11:00"))
    let same = ev("합성 공모전 본선", "2026-10-08T01:00:00Z", "2026-10-08T02:00:00Z")
    XCTAssertEqual(ItemEvents.state(r, executed: false, events: [same], now: now, deviceZone: seoul), .inCalendar("✅ 같은 일정이 캘린더에 있음"))
    // 대기 제안도 이미 같은 일정이 있으면 버튼 없이 있음(채팅 카드와 같다)
    XCTAssertEqual(ItemEvents.state(row(status: "proposed"), executed: false, events: [same], now: now, deviceZone: seoul),
                   .inCalendar("✅ 같은 일정이 캘린더에 있음"))
  }

  /// 종일: 표식 종일 일정이 그날이면 있음, 없으면 다시 추가
  func testAllDay() {
    let r = row(start: "2026-10-08", end: nil)
    let mine = ev("합성 공모전 본선", "2026-10-07T15:00:00Z", "2026-10-08T15:00:00Z", url: ProposalFlow.marker(r.pid), allDay: true)
    XCTAssertEqual(ItemEvents.state(r, executed: true, events: [mine], now: now, deviceZone: seoul), .inCalendar("✅ 캘린더에 있음"))
    XCTAssertEqual(ItemEvents.state(r, executed: true, events: [], now: now, deviceZone: seoul), .readd)
  }

  /// 대기·무시·확인 필요·지난 일정·stale·권한 없음
  func testOtherStates() {
    XCTAssertEqual(ItemEvents.state(row(status: "proposed"), executed: false, events: [], now: now, deviceZone: seoul), .pending)
    XCTAssertEqual(ItemEvents.state(row(status: "confirmed"), executed: false, events: [], now: now, deviceZone: seoul), .pending)
    XCTAssertEqual(ItemEvents.state(row(status: "dismissed"), executed: false, events: [], now: now, deviceZone: seoul), .dismissed)
    XCTAssertEqual(ItemEvents.state(row(uncertain: ["time"]), executed: true, events: [], now: now, deviceZone: seoul), .needsReview)
    XCTAssertEqual(ItemEvents.state(row(start: "다음 주"), executed: true, events: [], now: now, deviceZone: seoul), .needsReview)
    XCTAssertEqual(ItemEvents.state(row(status: "stale"), executed: false, events: [], now: now, deviceZone: seoul), .stale)
    XCTAssertEqual(ItemEvents.state(row(start: "2026-10-01T10:00:00+09:00", end: nil), executed: true, events: [], now: now, deviceZone: seoul), .past)
    XCTAssertEqual(ItemEvents.state(row(start: "2026-10-03", end: nil), executed: true, events: [], now: now, deviceZone: seoul), .past)
    XCTAssertEqual(ItemEvents.state(row(start: "2026-10-04", end: nil), executed: true, events: [], now: now, deviceZone: seoul), .readd)   // 오늘 종일은 아직
    XCTAssertEqual(ItemEvents.state(row(), executed: false, events: nil, now: now, deviceZone: seoul), .noAccess(added: true))
    XCTAssertEqual(ItemEvents.state(row(status: "proposed"), executed: false, events: nil, now: now, deviceZone: seoul), .noAccess(added: false))
    XCTAssertEqual(ItemEvents.state(row(start: "2026-10-01T10:00:00+09:00"), executed: false, events: nil, now: now, deviceZone: seoul), .past)
    let reminder = ItemEvents.decode(json([["ordinal": 0, "proposals": [prop("p-r", action: "create_reminder", ["title": "합성 할 일", "start": "2026-10-08"])]]]))!.first!
    XCTAssertEqual(ItemEvents.state(reminder, executed: false, events: [], now: now, deviceZone: seoul), .needsReview)
  }

  func testStatusText() {
    XCTAssertEqual(ItemEvents.statusText(.inCalendar("✅ 캘린더에 있음")), "✅ 캘린더에 있음")
    XCTAssertEqual(ItemEvents.statusText(.readd), "캘린더에서 찾지 못함 · 지웠거나 옮겼을 수 있어요")
    XCTAssertNil(ItemEvents.statusText(.pending))
    XCTAssertEqual(ItemEvents.statusText(.dismissed), "무시한 제안")
    XCTAssertEqual(ItemEvents.statusText(.needsReview), "내용 확인이 필요해 바로 추가하지 않음")
    XCTAssertEqual(ItemEvents.statusText(.past), "지난 일정")
    XCTAssertEqual(ItemEvents.statusText(.stale), "바뀐 제안이라 추가하지 않음")
    XCTAssertEqual(ItemEvents.statusText(.noAccess(added: true)), "이전에 추가한 일정")
    XCTAssertNil(ItemEvents.statusText(.noAccess(added: false)))
  }

  /// 다시 추가 결과 문구. 나머지는 추가와 같다
  func testReaddFeedback() {
    XCTAssertEqual(ItemEvents.readdFeedback("ok").text, "캘린더에 다시 추가했습니다")
    XCTAssertEqual(ItemEvents.readdFeedback("recovered").text, "이미 캘린더에 있습니다")
    XCTAssertEqual(ItemEvents.readdFeedback("skip_stale").text, ChatReply.addFeedback("skip_stale").text)
    XCTAssertTrue(ItemEvents.readdFeedback("conflict:1").retry)
  }

  /// 순서 1: 다시 추가는 succeeded 에서 멈추지 않는다. stale 은 그대로 멈춘다
  func testCheckReadd() {
    XCTAssertEqual(ProposalFlow.check(serverStatus: "succeeded"), .stop(reason: "succeeded"))
    XCTAssertEqual(ProposalFlow.check(serverStatus: "succeeded", readd: true), .proceed)
    XCTAssertEqual(ProposalFlow.check(serverStatus: "stale", readd: true), .stop(reason: "stale"))
    XCTAssertEqual(ProposalFlow.check(serverStatus: nil, readd: true), .proceed)
  }

  /// 다시 추가의 로컬 기록: 있으면 eventkit_id 만 바꾸고(보고 여부·version 유지), 없으면 보고 끝으로 새로(서버는 이미 succeeded)
  func testRerecord() throws {
    let e = try Executions(url: FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString))
    try e.record(proposalId: "p1", eventkitId: "ek-old", version: 3)
    try e.rerecord(proposalId: "p1", eventkitId: "ek-new", version: 1)
    XCTAssertEqual(try e.existing(proposalId: "p1"), "ek-new")
    XCTAssertEqual(try e.unreported().map(\.version), [3])                 // 아직 보고 전이면 다음 보고가 새 id 로
    XCTAssertEqual(try e.unreported().map(\.eventkitId), ["ek-new"])
    try e.rerecord(proposalId: "p2", eventkitId: "ek-2", version: 1)
    XCTAssertEqual(try e.existing(proposalId: "p2"), "ek-2")
    XCTAssertFalse(try e.unreported().contains { $0.proposalId == "p2" })   // 새로 넣은 기록은 보고하지 않는다
  }
}
