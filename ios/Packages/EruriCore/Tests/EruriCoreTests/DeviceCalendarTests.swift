import XCTest
@testable import EruriCore

/// 스펙 §9 "일정 질문과 기기 캘린더": 절 머리·문구(서울, 최대 5 + 외 N건), 제안 카드 상태
final class DeviceCalendarTests: XCTestCase {
  private let t = ISO8601DateFormatter().date(from: "2026-10-03T05:00:00Z")!            // 서울 10/3(토) 14:00
  private func ev(_ id: String, _ offset: TimeInterval, title: String? = nil, allDay: Bool = false, canceled: Bool = false,
                  url: URL? = nil) -> ProposalFlow.CalendarEvent {
    ProposalFlow.CalendarEvent(id: id, title: title ?? "합성 \(id)", start: t.addingTimeInterval(offset), end: t.addingTimeInterval(offset + 3600),
                               allDay: allDay, canceled: canceled, url: url)
  }

  func testLabelSeoulWeekdayAndAllDay() {
    XCTAssertEqual(DeviceCalendar.label(ev("a", 0)), "10/3(토) 14:00 합성 a")
    XCTAssertEqual(DeviceCalendar.label(ev("b", 0, allDay: true)), "10/3(토) 종일 합성 b")
  }

  func testLinesSortedCappedCanceledDropped() {
    let evs = (0..<7).reversed().map { ev("e\($0)", TimeInterval($0) * 3600) } + [ev("x", -3600, canceled: true)]
    let l = DeviceCalendar.lines(evs)
    XCTAssertEqual(l.lines.count, 5); XCTAssertEqual(l.more, 2)
    XCTAssertEqual(l.lines.first, "10/3(토) 14:00 합성 e0")
    XCTAssertEqual(DeviceCalendar.lines([]).lines, []); XCTAssertEqual(DeviceCalendar.lines([]).more, 0)
  }

  /// 절 머리: 보일 일정 수(취소 제외)를 붙인다. 거절 답변이어도 답 문구는 바꾸지 않고 이 머리만 보인다(Codex #4 — 기간 일치 ≠ 대상 일치)
  func testHeader() {
    XCTAssertEqual(DeviceCalendar.header(DeviceCalendar.visible([ev("a", 0), ev("b", 3600), ev("c", 0, canceled: true)]).count),
                   "기기 캘린더 · 이 기간 일정 2건")
    XCTAssertEqual(DeviceCalendar.header(0), "기기 캘린더")
  }
}
