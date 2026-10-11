import XCTest
@testable import EruriCore

/// 스펙 §9 "채팅 일정 개선" C — 확인 필요 일정 되묻기 버튼(한 번에 하나: date → year → ampm → location). 지금 2026-10-08 12:00(서울). 문구는 합성
final class AskBackTests: XCTestCase {
  private func d(_ s: String) -> Date { ISO8601DateFormatter().date(from: s)! }
  private let now = ISO8601DateFormatter().date(from: "2026-10-08T03:00:00Z")!
  private func payload(_ start: String?, _ codes: [String]) -> [String: JSONValue] {
    var p: [String: JSONValue] = ["title": .string("합성 미팅"), "uncertain": .array(codes.map { .string($0) })]
    if let start { p["start"] = .string(start) }
    return p
  }

  func testOneQuestionAtATimeInOrder() {
    XCTAssertEqual(AskBack.question(payload: payload("2026-10-14T06:00:00+09:00", ["location", "ampm", "date", "year"]), now: now)?.code, .date)
    XCTAssertEqual(AskBack.question(payload: payload("2026-10-14T06:00:00+09:00", ["location", "ampm", "year"]), now: now)?.code, .year)
    XCTAssertEqual(AskBack.question(payload: payload("2026-10-14T06:00:00+09:00", ["location", "ampm"]), now: now)?.code, .ampm)
    XCTAssertEqual(AskBack.question(payload: payload("2026-10-14T06:00:00+09:00", ["location"]), now: now), .location)
  }
  func testLocationOnlyWhenItIsTheOnlyCodeAndEndTzAreNotAsked() {
    XCTAssertNil(AskBack.question(payload: payload("2026-10-14T06:00:00+09:00", ["location", "end"]), now: now))   // K9 — 추가할 수 없는 상태에선 묻지 않는다
    XCTAssertNil(AskBack.question(payload: payload("2026-10-14T06:00:00+09:00", ["end", "tz"]), now: now))
    XCTAssertNil(AskBack.question(payload: payload("2026-10-14T06:00:00+09:00", []), now: now))
  }
  func testAmpmOnlyForTimedStarts() {
    XCTAssertNil(AskBack.question(payload: payload("2026-10-14", ["ampm"]), now: now))                            // K10
    XCTAssertEqual(AskBack.question(payload: payload("2026-10-14T06:00:00+09:00", ["ampm", "end"]), now: now)?.code, .ampm)
  }
  func testAmpmChoicesAreTheTwelveHourPair() {
    let six = AskBack.ampmChoices(start: d("2026-10-13T21:00:00Z"))                                                 // 서울 10/14 06:00
    XCTAssertEqual(six.am, AskBack.Choice(label: "오전 6:00", value: "2026-10-14T06:00:00+09:00"))
    XCTAssertEqual(six.pm, AskBack.Choice(label: "오후 6:00", value: "2026-10-14T18:00:00+09:00"))
    XCTAssertEqual(AskBack.ampmChoices(start: d("2026-10-14T09:30:00Z")).am.value, "2026-10-14T06:30:00+09:00")   // 18:30 → 같은 쌍
    let midnight = AskBack.ampmChoices(start: d("2026-10-13T15:00:00Z"))                                            // 00:00
    XCTAssertEqual([midnight.am.label, midnight.am.value, midnight.pm.label, midnight.pm.value],
                   ["오전 12:00(자정)", "2026-10-14T00:00:00+09:00", "오후 12:00", "2026-10-14T12:00:00+09:00"])
    XCTAssertEqual(AskBack.ampmChoices(start: d("2026-10-14T03:15:00Z")).am.label, "오전 12:15(자정)")             // 12:15 → 같은 쌍
  }
  func testAmpmChoicesUseSeoulForAUTCDevice() {
    // 서울 10/14 06:00 = UTC 10/13 21:00. 라벨·값은 기기 시간대와 무관하게 서울(Review Focus 5)
    let c = AskBack.ampmChoices(start: d("2026-10-13T21:00:00Z"))
    XCTAssertTrue(c.pm.value.hasPrefix("2026-10-14T18:00"))
  }
  func testYearChoicesThisAndNextSeoulYearSkippingMissingLeapDays() {
    XCTAssertEqual(AskBack.yearChoices(start: ProposalTiming.parse(start: "2026-10-15T10:00:00+09:00")!, now: now),
                   [AskBack.Choice(label: "올해 10/15", value: "2026-10-15T10:00:00+09:00"), AskBack.Choice(label: "내년 10/15", value: "2027-10-15T10:00:00+09:00")])
    XCTAssertEqual(AskBack.yearChoices(start: ProposalTiming.parse(start: "2026-10-15")!, now: now).map(\.value), ["2026-10-15", "2027-10-15"])
    XCTAssertEqual(AskBack.yearChoices(start: ProposalTiming.parse(start: "2028-02-29T10:00:00+09:00")!, now: now), [])   // 2026·2027 에 2/29 없음
    XCTAssertNil(AskBack.question(payload: payload("2028-02-29T10:00:00+09:00", ["year"]), now: now))
  }
  func testDateQuestionDefaultsToTheExtractedDayOrTodayWithServerRange() {
    guard case .date(let initial, let range)? = AskBack.question(payload: payload("2026-10-20T15:00:00+09:00", ["date"]), now: now) else { return XCTFail("date") }
    XCTAssertEqual(initial, d("2026-10-19T15:00:00Z"))                                                              // 10/20 서울 0시
    XCTAssertEqual(range.lowerBound, d("2025-10-07T15:00:00Z")); XCTAssertEqual(range.upperBound, d("2028-10-07T15:00:00Z"))
    guard case .date(let today, _)? = AskBack.question(payload: payload(nil, ["date"]), now: now) else { return XCTFail("undated") }
    XCTAssertEqual(today, d("2026-10-07T15:00:00Z"))
    XCTAssertEqual(AskBack.dateValue(d("2026-10-19T15:00:00Z")), "2026-10-20")
  }
  func testOutcomeAndFailureText() {
    let j = { (s: String) in Data(#"{"status":"\#(s)","proposal_id":"p2","version":2}"#.utf8) }
    XCTAssertEqual(AskBack.outcome(status: 200, data: j("ok")), .ok)
    XCTAssertEqual(AskBack.outcome(status: 200, data: j("not_uncertain")), .notUncertain)
    XCTAssertEqual(AskBack.outcome(status: 200, data: j("not_found")), .notFound)
    XCTAssertEqual(AskBack.outcome(status: 200, data: j("bad_value")), .badValue)
    XCTAssertEqual(AskBack.outcome(status: 500, data: nil), .failed)
    XCTAssertEqual(AskBack.outcome(status: nil, data: nil), .failed)
    XCTAssertEqual(AskBack.okProposalID(status: 200, data: j("ok")), "p2")                       // 고치기 카드가 새 버전을 따라간다(Fable 플랜 리뷰 #1)
    XCTAssertNil(AskBack.okProposalID(status: 200, data: j("not_found"))); XCTAssertNil(AskBack.okProposalID(status: 500, data: nil))
    XCTAssertNil(AskBack.failureText(.ok)); XCTAssertNil(AskBack.failureText(.notUncertain))
    XCTAssertEqual(AskBack.failureText(.badValue), "바꾸지 못했어요. 다시 눌러 주세요.")
    XCTAssertEqual(AskBack.body(pid: "p1", code: .ampm, value: "2026-10-14T18:00:00+09:00"),
                   ["p_proposal": "p1", "p_code": "ampm", "p_value": "2026-10-14T18:00:00+09:00"])
    XCTAssertEqual(AskBackText.question(.ampm), "오전인지 오후인지 알려 주세요")
    XCTAssertEqual(AskBackText.question(.date), "날짜를 확인해 주세요(음력이거나 날짜를 읽지 못했어요)")
  }
}
