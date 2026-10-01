import XCTest
@testable import EruriCore

/// 스펙 §10 액션 핸들러: 순서 1(서버 상태로 중단), 순서 3(표식 조회 복구), 순서 4·5(보고 결과 후속)
final class ProposalFlowTests: XCTestCase {
  func testServerStatusGate() {
    XCTAssertEqual(ProposalFlow.check(serverStatus: nil), .proceed)            // 오프라인: 순서 1 건너뜀(순서 5)
    XCTAssertEqual(ProposalFlow.check(serverStatus: "proposed"), .proceed)
    XCTAssertEqual(ProposalFlow.check(serverStatus: "stale"), .stop(reason: "stale"))
    XCTAssertEqual(ProposalFlow.check(serverStatus: "succeeded"), .stop(reason: "succeeded"))
  }
  func testMarkerAndWindow() {
    XCTAssertEqual(ProposalFlow.marker("p-1").absoluteString, "assistant://proposal/p-1")
    let t = Date(timeIntervalSince1970: 1_800_000_000)
    let (a, b) = ProposalFlow.searchWindow(start: t)
    XCTAssertEqual(a, t.addingTimeInterval(-86_400)); XCTAssertEqual(b, t.addingTimeInterval(86_400))
    XCTAssertEqual(ProposalFlow.matchMarker(pid: "p-1", events: [("e1", URL(string: "https://x")), ("e2", ProposalFlow.marker("p-1"))]), "e2")
    XCTAssertNil(ProposalFlow.matchMarker(pid: "p-1", events: [("e1", nil), ("e3", ProposalFlow.marker("p-2"))]))
  }
  func testReportFollowUp() {
    XCTAssertEqual(ProposalFlow.reportFollowUp("ok"), .done)
    XCTAssertEqual(ProposalFlow.reportFollowUp("not_found"), .done)
    XCTAssertEqual(ProposalFlow.reportFollowUp("changed"), .doneNotifyChanged)
    XCTAssertEqual(ProposalFlow.reportFollowUp("stale"), .doneNotifyChanged)
    XCTAssertEqual(ProposalFlow.reportFollowUp(nil), .retryLater)                // 네트워크 실패: 다음 앱 실행 때
  }

  /// §10 겹침: 저장 구간 [start, start+1h)와 겹치는 일정, 시작 순. 맞닿음·종일·취소·같은 제안 표식은 제외, 다른 제안이 넣은 일정은 겹침
  func testConflicts() {
    let t = Date(timeIntervalSince1970: 1_800_000_000)
    func ev(_ id: String, _ a: TimeInterval, _ b: TimeInterval, allDay: Bool = false, canceled: Bool = false, url: URL? = nil) -> ProposalFlow.CalendarEvent {
      ProposalFlow.CalendarEvent(id: id, title: "합성 \(id)", start: t.addingTimeInterval(a), end: t.addingTimeInterval(b),
                                 allDay: allDay, canceled: canceled, url: url)
    }
    let events = [
      ev("inside", 1800, 5400), ev("around", -3600, 7200),
      ev("before", -3600, 0), ev("after", 3600, 7200),
      ev("allday", -36_000, 50_400, allDay: true), ev("canceled", 0, 3600, canceled: true),
      ev("mine", 0, 3600, url: ProposalFlow.marker("p-1")), ev("other", 0, 3600, url: ProposalFlow.marker("p-2")),
    ]
    XCTAssertEqual(ProposalFlow.conflicts(pid: "p-1", start: t, events: events).map(\.id), ["around", "other", "inside"])
    XCTAssertEqual(ProposalFlow.conflicts(pid: "p-1", start: t, events: []), [])
    XCTAssertEqual(ProposalFlow.eventDuration, 3600)
    // 길이 0 일정(C2 리뷰 Minor 2): 저장 구간 [start, end) 안의 한 시점이면 겹침 — 시작과 같은 시각 포함, 끝 시각은 제외
    let points = [ev("p0", 0, 0), ev("p30", 1800, 1800), ev("pEnd", 3600, 3600), ev("pBefore", -60, -60)]
    XCTAssertEqual(ProposalFlow.conflicts(pid: "p-1", start: t, events: points).map(\.id), ["p0", "p30"])
  }

  /// gate 결과 "conflict:<n>" 해석과 화면·잠금화면 문구. 잠금화면 본문에는 다른 일정의 제목이 없다
  func testConflictOutcomeAndCopy() throws {
    XCTAssertEqual(ProposalFlow.conflictOutcome(2), "conflict:2")
    XCTAssertEqual(ProposalFlow.conflictCount("conflict:2"), 2)
    XCTAssertNil(ProposalFlow.conflictCount("ok")); XCTAssertNil(ProposalFlow.conflictCount("fail:x")); XCTAssertNil(ProposalFlow.conflictCount("dup"))
    XCTAssertEqual(ProposalFlow.conflictNoticeID("p-1"), "conflict-p-1")
    XCTAssertEqual(ProposalFlow.conflictNoticeTitle, "겹치는 일정이 있습니다")
    XCTAssertEqual(ProposalFlow.conflictNoticeBody(2), "같은 시간에 일정 2건 · 탭해서 확인")          // "다른" 없음 — 같은 일정이 이미 있는 경우가 흔하다(Fable N5)
    let t = try XCTUnwrap(ISO8601DateFormatter().date(from: "2026-10-04T05:00:00Z"))         // 서울 14:00
    let a = ProposalFlow.CalendarEvent(id: "a", title: "합성 회의", start: t, end: t.addingTimeInterval(3600))
    let b = ProposalFlow.CalendarEvent(id: "b", title: "합성 모임", start: t.addingTimeInterval(1800), end: t.addingTimeInterval(5400))
    XCTAssertEqual(ProposalFlow.conflictLine([a]), "겹치는 일정: 14:00–15:00 합성 회의")
    XCTAssertEqual(ProposalFlow.conflictLine([a, b]), "겹치는 일정: 14:00–15:00 합성 회의 외 1건")
    XCTAssertNil(ProposalFlow.conflictLine([]))
    // 여러 날 걸친 일정은 날짜를 붙인다(C2 리뷰 Minor 3): 서울 10/3 09:00 ~ 10/5 18:00
    let multi = ProposalFlow.CalendarEvent(id: "m", title: "합성 학회", start: t.addingTimeInterval(-86_400 - 18_000), end: t.addingTimeInterval(86_400 + 14_400))
    XCTAssertEqual(ProposalFlow.conflictLine([multi]), "겹치는 일정: 10/3 09:00–10/5 18:00 합성 학회")
    XCTAssertEqual(ProposalFlow.confirmTitle([a]), "같은 시간에 '합성 회의' 일정이 있습니다. 그래도 추가할까요?")
    XCTAssertEqual(ProposalFlow.confirmTitle([]), "같은 시간에 다른 일정이 있습니다. 그래도 추가할까요?")
  }

  /// 확인창이 필요한가(0.8.1, 2026-10-01 실기기 C2 피드백): 겹침을 보고 "겹쳐도 추가"를 눌렀으면 확인 없이 confirmed 로 저장,
  /// 미리 판정이 겹침 없음("캘린더에 추가")인데 저장 직전 판정에서 겹침이면 그때만 확인창(게이트 C2-5)
  func testConfirmOnlyWhenConflictIsNew() {
    // 겹쳐도 추가 → confirmed:true 로 부르고, 결과가 무엇이든 확인창 없음
    XCTAssertTrue(ProposalFlow.tapConfirmed(conflictsShown: true))
    XCTAssertFalse(ProposalFlow.needsConfirm(confirmed: true, outcome: "ok"))
    XCTAssertFalse(ProposalFlow.needsConfirm(confirmed: true, outcome: "conflict:1"))
    // 미리 겹침 없음 → confirmed:false. 저장 시 겹침이면 확인창, 아니면 결과 표시
    XCTAssertFalse(ProposalFlow.tapConfirmed(conflictsShown: false))
    XCTAssertTrue(ProposalFlow.needsConfirm(confirmed: false, outcome: "conflict:2"))
    for o in ["ok", "dup", "recovered", "fail:save", "skip_stale"] { XCTAssertFalse(ProposalFlow.needsConfirm(confirmed: false, outcome: o), o) }
  }
}
