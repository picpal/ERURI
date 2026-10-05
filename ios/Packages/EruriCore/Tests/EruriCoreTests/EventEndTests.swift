import XCTest
@testable import EruriCore

/// 시각 있는 일정의 끝(스펙 §10 "일정 종료", 0.11.3 — 2026-10-04 실기기: 10:00~16:00 공지가 10:00~11:00으로 저장됨).
/// 끝 = 제안 end 가 오프셋 있는 시각이고 시작보다 뒤면 그 시각, 아니면 시작 + 1시간. 값은 화면 값 → 없으면 handleAdd 순서 1 조회(end_at). 문구는 합성
final class EventEndTests: XCTestCase {
  private func d(_ s: String) -> Date { ISO8601DateFormatter().date(from: s)! }
  private let seoul = TimeZone(identifier: "Asia/Seoul")!

  /// 시각 end > start 만 끝으로 쓴다. 날짜만·시작 이하·못 읽음·없음은 끝 없음(1시간)
  func testParseTimedEnd() {
    let start = "2026-10-05T10:00:00+09:00"
    XCTAssertEqual(ProposalTiming.parse(start: start, end: "2026-10-05T16:00:00+09:00"), .timed(d("2026-10-05T01:00:00Z"), end: d("2026-10-05T07:00:00Z")))
    XCTAssertEqual(ProposalTiming.parse(start: start, end: "2026-10-05T07:00:00.5+00:00"), .timed(d("2026-10-05T01:00:00Z"), end: d("2026-10-05T07:00:00Z")))
    XCTAssertEqual(ProposalTiming.parse(start: start, end: "2026-10-06T12:00:00+09:00"), .timed(d("2026-10-05T01:00:00Z"), end: d("2026-10-06T03:00:00Z")))  // 날을 넘겨도 그대로
    XCTAssertEqual(ProposalTiming.parse(start: start, end: "2026-10-07"), .timed(d("2026-10-05T01:00:00Z")))         // 날짜만 → 1시간
    XCTAssertEqual(ProposalTiming.parse(start: start, end: start), .timed(d("2026-10-05T01:00:00Z")))                // 같음 → 1시간
    XCTAssertEqual(ProposalTiming.parse(start: start, end: "2026-10-05T09:00:00+09:00"), .timed(d("2026-10-05T01:00:00Z")))
    XCTAssertEqual(ProposalTiming.parse(start: start, end: "모름"), .timed(d("2026-10-05T01:00:00Z")))
    XCTAssertEqual(ProposalTiming.parse(start: start, end: nil), .timed(d("2026-10-05T01:00:00Z")))
  }

  /// EventKit 저장 구간: 끝이 있으면 [start, end), 없으면 [start, +1시간)
  func testEventSpan() {
    let t = ProposalTiming.parse(start: "2026-10-05T10:00:00+09:00", end: "2026-10-05T16:00:00+09:00")!
    XCTAssertEqual(t.eventSpan(deviceZone: seoul).start, d("2026-10-05T01:00:00Z"))
    XCTAssertEqual(t.eventSpan(deviceZone: seoul).end, d("2026-10-05T07:00:00Z"))
    XCTAssertEqual(t.anchor, d("2026-10-05T01:00:00Z"))
    XCTAssertEqual(t.searchWindow.0, d("2026-10-04T01:00:00Z"))                        // 표식 조회 창은 시작 ±1일 그대로
    XCTAssertEqual(t.seoulDays, ScheduleCard.seoulDay(d("2026-10-05T01:00:00Z")))        // 비슷한 일정은 시작의 서울 하루 그대로
    XCTAssertFalse(t.isAllDay)
    XCTAssertNil(t.allDayLabel)
    let one = ProposalTiming.parse(start: "2026-10-05T10:00:00+09:00")!
    XCTAssertEqual(one.eventSpan(deviceZone: seoul).end, d("2026-10-05T02:00:00Z"))
  }

  /// handleAdd 필드: 끝이 있으면 end 도 ISO(소수 초 없이)로 싣는다
  func testFieldValues() {
    let t = ProposalTiming.parse(start: "2026-10-05T10:00:00+09:00", end: "2026-10-05T07:00:00.25+00:00")!
    XCTAssertEqual(t.fieldValues["start"], "2026-10-05T01:00:00Z")
    XCTAssertEqual(t.fieldValues["end"], "2026-10-05T07:00:00Z")
    XCTAssertEqual(ProposalTiming.parse(start: t.fieldValues["start"]!, end: t.fieldValues["end"]), t)   // 되읽으면 같다
    XCTAssertNil(ProposalTiming.parse(start: "2026-10-05T10:00:00+09:00")!.fieldValues["end"])
  }

  /// handleAdd 의 일시: 화면 값(fields end) → 없으면 순서 1 조회 end. 조회 end 는 시각 일정에만(종일은 화면·푸시 값 그대로). start 를 못 읽으면 nil
  func testTimingFromFieldsAndServer() {
    let s = "2026-10-05T10:00:00+09:00", at = d("2026-10-05T01:00:00Z")
    XCTAssertEqual(ProposalReview.timing(fields: ["start": s], serverEnd: "2026-10-05T16:00:00+09:00"), .timed(at, end: d("2026-10-05T07:00:00Z")))
    XCTAssertEqual(ProposalReview.timing(fields: ["start": s, "end": "2026-10-05T12:00:00+09:00"], serverEnd: "2026-10-05T16:00:00+09:00"),
                   .timed(at, end: d("2026-10-05T03:00:00Z")))                                     // 화면 값이 먼저
    XCTAssertEqual(ProposalReview.timing(fields: ["start": s], serverEnd: nil), .timed(at))         // 조회 못 함 → 1시간
    XCTAssertEqual(ProposalReview.timing(fields: ["start": s], serverEnd: "2026-10-07"), .timed(at))
    XCTAssertEqual(ProposalReview.timing(fields: ["start": s, "end": "2026-10-05T09:00:00+09:00"], serverEnd: "2026-10-05T16:00:00+09:00"),
                   .timed(at, end: d("2026-10-05T07:00:00Z")))                                     // 화면 값이 끝이 못 되면 조회 값
    XCTAssertEqual(ProposalReview.timing(fields: ["start": "2026-10-08"], serverEnd: "2026-10-10"),
                   .allDay(first: .init(2026, 10, 8), last: .init(2026, 10, 8)))                   // 종일은 조회 end 를 쓰지 않는다
    XCTAssertEqual(ProposalReview.timing(fields: ["start": "2026-10-08", "end": "2026-10-10"], serverEnd: nil),
                   .allDay(first: .init(2026, 10, 8), last: .init(2026, 10, 10)))
    XCTAssertNil(ProposalReview.timing(fields: ["start": "내일"], serverEnd: "2026-10-05T16:00:00+09:00"))
    XCTAssertNil(ProposalReview.timing(fields: [:], serverEnd: nil))
  }

  /// 순서 1 조회는 같은 요청에 end 를 더한다(end 는 예약어라 end_at 별칭)
  func testServerSelect() {
    XCTAssertEqual(ProposalReview.serverSelect, "status,version,notes:payload->>notes,end_at:payload->>end")
  }

  /// 겹침(§10 순서 3)은 저장 구간 [start, 끝)으로 — 13:00~14:00 일정은 10:00~16:00 제안과 겹치고 1시간 제안과는 겹치지 않는다. 맞닿음(16:00 시작)은 아니다
  func testConflictsUseEnd() {
    let events = [
      ProposalFlow.CalendarEvent(id: "lunch", title: "합성 점심", start: d("2026-10-05T04:00:00Z"), end: d("2026-10-05T05:00:00Z")),
      ProposalFlow.CalendarEvent(id: "touch", title: "합성 저녁", start: d("2026-10-05T07:00:00Z"), end: d("2026-10-05T08:00:00Z")),
    ]
    let long = ProposalTiming.parse(start: "2026-10-05T10:00:00+09:00", end: "2026-10-05T16:00:00+09:00")!
    XCTAssertEqual(ProposalFlow.conflicts(pid: "p-1", timing: long, events: events).map(\.id), ["lunch"])
    XCTAssertEqual(ProposalFlow.conflicts(pid: "p-1", timing: ProposalTiming.parse(start: "2026-10-05T10:00:00+09:00")!, events: events), [])
    XCTAssertEqual(ProposalFlow.preview(pid: "p-1", title: "합성 구민 행사", timing: long, events: events, deviceZone: seoul),
                   .conflict([events[0]]))
  }

  /// 대기 목록 행(0026 — 시각 일정도 형식이 맞으면 end): 추가 필드에 end 가 실린다
  func testPendingRowCarriesEnd() throws {
    let pid = UUID().uuidString.lowercased()
    let rows = try XCTUnwrap(ProposalReview.decodeList(Data("""
      [{"proposal_id":"\(pid)","action":"ADD_EVENT","title":"합성 구민 행사","start":"2026-10-05T10:00:00+09:00","end":"2026-10-05T16:00:00+09:00",
        "all_day":false,"location":null,"version":1,"created_at":"x"}]
      """.utf8)))
    XCTAssertEqual(rows[0].timing, .timed(d("2026-10-05T01:00:00Z"), end: d("2026-10-05T07:00:00Z")))
    XCTAssertEqual(rows[0].addFields?["end"], "2026-10-05T07:00:00Z")
    XCTAssertEqual(rows[0].whenLabel, "10/5(월) 10:00–16:00")                                     // 시각 범위 표시(0.12.0)
  }

  /// 채팅 일정 답 카드: payload end 를 추가 필드에 싣고, 겹침 상태도 [start, 끝)으로 판정한다
  func testChatCardUsesEnd() throws {
    let payload: [String: JSONValue] = ["title": .string("합성 구민 행사"), "uncertain": .array([]),
                                        "start": .string("2026-10-05T10:00:00+09:00"), "end": .string("2026-10-05T16:00:00+09:00")]
    let p = ChatReply.Proposal(id: "p-9", item_id: "item-1", action: "create_event", status: "proposed", payload: payload)
    let card = try XCTUnwrap(ScheduleCard.card(p, now: d("2026-10-01T03:00:00Z")))
    let lunch = ProposalFlow.CalendarEvent(id: "lunch", title: "합성 점심", start: d("2026-10-05T04:00:00Z"), end: d("2026-10-05T05:00:00Z"))
    let m = ScheduleCard.model(card, events: [lunch], executed: false, deviceZone: seoul)
    XCTAssertEqual(ScheduleCard.addFields(m)["end"], "2026-10-05T07:00:00Z")
    XCTAssertEqual(m.status, .conflict([lunch], maybeSame: false))
    XCTAssertEqual(ScheduleCard.whenLine(m), "10/5(월) 10:00–16:00 합성 구민 행사")                 // 시각 범위 표시(0.12.0)
  }

  /// 포스터 "10/24(토)-25(일) 10:00~21:00"(2026-10-05 실기기 보고): 날짜별 제안 카드마다 범위, 날을 넘기는 끝은 날짜까지
  func testChatCardTimeRange() throws {
    func line(_ start: String, _ end: String?) throws -> String {
      var payload: [String: JSONValue] = ["title": .string("합성 광장 장터"), "uncertain": .array([]), "start": .string(start)]
      if let end { payload["end"] = .string(end) }
      let p = ChatReply.Proposal(id: "p-\(start)", item_id: "item-1", action: "create_event", status: "proposed", payload: payload)
      return ScheduleCard.whenLine(ScheduleCard.model(try XCTUnwrap(ScheduleCard.card(p, now: d("2026-10-05T03:00:00Z"))), events: [], executed: false, deviceZone: seoul))
    }
    XCTAssertEqual(try line("2026-10-24T10:00:00+09:00", "2026-10-24T21:00:00+09:00"), "10/24(토) 10:00–21:00 합성 광장 장터")
    XCTAssertEqual(try line("2026-10-25T10:00:00+09:00", "2026-10-25T21:00:00+09:00"), "10/25(일) 10:00–21:00 합성 광장 장터")
    XCTAssertEqual(try line("2026-10-24T22:00:00+09:00", "2026-10-25T02:00:00+09:00"), "10/24(토) 22:00–10/25(일) 02:00 합성 광장 장터")
    XCTAssertEqual(try line("2026-10-24T10:00:00+09:00", nil), "10/24(토) 10:00 합성 광장 장터")
  }
}
