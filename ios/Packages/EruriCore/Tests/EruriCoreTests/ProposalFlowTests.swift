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
}
