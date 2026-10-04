import XCTest
@testable import EruriCore

/// 날짜만 있는 일정 제안 = 종일 일정(스펙 §10, 0.9.1 사용자 결정 A): 해석·EventKit 저장 구간·표시·버튼·겹침 제외·handleAdd 필드
final class ProposalTimingTests: XCTestCase {
  private func d(_ s: String) -> Date { ISO8601DateFormatter().date(from: s)! }
  private let seoul = TimeZone(identifier: "Asia/Seoul")!, la = TimeZone(identifier: "America/Los_Angeles")!

  /// 시각 있는 start(오프셋 필수, 소수 초 허용) → timed, 날짜만 → allDay(서울 날짜). end 는 종일에서만 — 날짜만이거나 시각 있는 값의 서울 날짜,
  /// 시작 다음 날 이후일 때만 마지막 날. 달력에 없는 날짜·오프셋 없는 시각·빈 값은 nil
  func testParse() {
    XCTAssertEqual(ProposalTiming.parse(start: "2026-10-08T15:00:00+09:00"), .timed(d("2026-10-08T06:00:00Z")))
    XCTAssertEqual(ProposalTiming.parse(start: "2026-10-08T06:00:00.5+00:00"), .timed(d("2026-10-08T06:00:00Z")))
    XCTAssertEqual(ProposalTiming.parse(start: "2026-10-08T15:00:00+09:00", end: "2026-10-10"), .timed(d("2026-10-08T06:00:00Z")))  // 시각 일정의 날짜만 end 는 끝이 아니다(1시간, 0.11.3 EventEndTests)
    let one = ProposalTiming.parse(start: "2026-10-08")
    XCTAssertEqual(one, .allDay(first: .init(2026, 10, 8), last: .init(2026, 10, 8)))
    XCTAssertEqual(ProposalTiming.parse(start: "2026-10-08", end: "2026-10-10"), .allDay(first: .init(2026, 10, 8), last: .init(2026, 10, 10)))
    XCTAssertEqual(ProposalTiming.parse(start: "2026-10-08", end: "2026-10-09T18:00:00+09:00"), .allDay(first: .init(2026, 10, 8), last: .init(2026, 10, 9)))
    XCTAssertEqual(ProposalTiming.parse(start: "2026-10-08", end: "2026-10-09T14:00:00Z"), .allDay(first: .init(2026, 10, 8), last: .init(2026, 10, 9)))   // 서울 23:00
    XCTAssertEqual(ProposalTiming.parse(start: "2026-10-08", end: "2026-10-08"), one)
    XCTAssertEqual(ProposalTiming.parse(start: "2026-10-08", end: "2026-10-01"), one)        // 거꾸로 → 그날 하루
    XCTAssertEqual(ProposalTiming.parse(start: "2026-10-08", end: "모름"), one)
    XCTAssertEqual(ProposalTiming.parse(start: "2026-12-31", end: "2027-01-02"), .allDay(first: .init(2026, 12, 31), last: .init(2027, 1, 2)))
    XCTAssertNil(ProposalTiming.parse(start: "2027-02-30"))
    XCTAssertNil(ProposalTiming.parse(start: "2026-13-01"))
    XCTAssertNil(ProposalTiming.parse(start: "2026-10-08T15:00"))
    XCTAssertNil(ProposalTiming.parse(start: "내일"))
    XCTAssertNil(ProposalTiming.parse(start: ""))
    XCTAssertTrue(one!.isAllDay); XCTAssertFalse(ProposalTiming.parse(start: "2026-10-08T15:00:00+09:00")!.isAllDay)
  }

  /// anchor = 표식 조회 창·카드 날짜 기준(시각 또는 첫날 서울 0시). 저장 구간: 시각은 [start, +1시간), 종일은 기기 시간대 첫날 0시 ~ 마지막 날 0시
  /// (EventKit 종일은 날짜만 쓴다 — 서울 날짜를 기기 달력의 같은 날짜로 옮긴다, 기기가 다른 시간대여도 날짜가 밀리지 않게)
  func testAnchorAndEventSpan() {
    let t = ProposalTiming.parse(start: "2026-10-08T15:00:00+09:00")!
    XCTAssertEqual(t.anchor, d("2026-10-08T06:00:00Z"))
    XCTAssertEqual(t.eventSpan(deviceZone: seoul).start, d("2026-10-08T06:00:00Z"))
    XCTAssertEqual(t.eventSpan(deviceZone: seoul).end, d("2026-10-08T07:00:00Z"))
    let a = ProposalTiming.parse(start: "2026-10-08", end: "2026-10-10")!
    XCTAssertEqual(a.anchor, d("2026-10-07T15:00:00Z"))                     // 서울 10/8 0시
    XCTAssertEqual(a.eventSpan(deviceZone: seoul).start, d("2026-10-07T15:00:00Z"))
    XCTAssertEqual(a.eventSpan(deviceZone: seoul).end, d("2026-10-09T15:00:00Z"))      // 마지막 날 10/10 0시
    XCTAssertEqual(a.eventSpan(deviceZone: la).start, d("2026-10-08T07:00:00Z"))       // LA 10/8 0시(PDT)
    let one = ProposalTiming.parse(start: "2026-10-08")!
    XCTAssertEqual(one.eventSpan(deviceZone: seoul).start, one.eventSpan(deviceZone: seoul).end)   // 하루 = 시작·끝 같은 날
  }

  /// 종일 표시 "10/8(목) · 종일", 여러 날 "10/8(목)–10/10(토) · 종일". 시각 있으면 nil(기존 표기 유지)
  func testAllDayLabel() {
    XCTAssertEqual(ProposalTiming.parse(start: "2026-10-08")?.allDayLabel, "10/8(목) · 종일")
    XCTAssertEqual(ProposalTiming.parse(start: "2026-10-08", end: "2026-10-10")?.allDayLabel, "10/8(목)–10/10(토) · 종일")
    XCTAssertNil(ProposalTiming.parse(start: "2026-10-08T15:00:00+09:00")?.allDayLabel)
    XCTAssertEqual(ProposalTiming.parse(start: "2026-10-08", end: "2026-10-10")?.dayLabel, "10/8(목)–10/10(토)")      // 확인 필요(REVIEW) 표시용
    XCTAssertNil(ProposalTiming.parse(start: "2026-10-08T15:00:00+09:00")?.dayLabel)
  }

  /// handleAdd 필드의 start·end: 종일은 YYYY-MM-DD(여러 날이면 end), 시각은 ISO(소수 초 제거) — 알림 페이로드와 같은 키
  func testFieldValues() {
    let a = ProposalTiming.parse(start: "2026-10-08", end: "2026-10-10")!
    XCTAssertEqual(a.fieldValues["start"], "2026-10-08"); XCTAssertEqual(a.fieldValues["end"], "2026-10-10")
    let one = ProposalTiming.parse(start: "2026-10-08")!
    XCTAssertEqual(one.fieldValues, ["start": "2026-10-08"])
    let t = ProposalTiming.parse(start: "2026-10-08T06:00:00.5+00:00")!
    XCTAssertEqual(t.fieldValues.keys.sorted(), ["start"])
    XCTAssertEqual(ISO8601DateFormatter().date(from: t.fieldValues["start"]!), d("2026-10-08T06:00:00Z"))
  }

  /// 종일은 §10 겹침 판정 대상이 아니다(기존 규칙: 종일 일정은 겹침에서 제외) — 버튼은 "종일 일정으로 추가", 겹침 없음
  func testAllDayHasNoConflictsAndOwnButton() {
    let busy = ProposalFlow.CalendarEvent(id: "x", title: "합성 회의", start: d("2026-10-08T01:00:00Z"), end: d("2026-10-08T02:00:00Z"))
    XCTAssertEqual(ProposalFlow.conflicts(pid: "p", timing: ProposalTiming.parse(start: "2026-10-08")!, events: [busy]), [])
    XCTAssertEqual(ProposalFlow.conflicts(pid: "p", timing: ProposalTiming.parse(start: "2026-10-08T10:30:00+09:00")!, events: [busy]), [busy])
    XCTAssertEqual(ProposalFlow.addButtonTitle(allDay: true, conflictsShown: false), "종일 일정으로 추가")
    XCTAssertEqual(ProposalFlow.addButtonTitle(allDay: false, conflictsShown: false), "캘린더에 추가")
    XCTAssertEqual(ProposalFlow.addButtonTitle(allDay: false, conflictsShown: true), "겹쳐도 추가")
  }
}
