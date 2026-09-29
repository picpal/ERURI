import XCTest
@testable import EruriCore

/// 스펙 §7 1단계: NOTIFICATION + app_name=메시지 는 MESSAGES 와 같이 "문자"로 표시만 한다
final class SourceLabelTests: XCTestCase {
  func testLabels() {
    XCTAssertEqual(SourceLabel.label(source: "MESSAGES", appName: "SMS"), "문자")
    XCTAssertEqual(SourceLabel.label(source: "NOTIFICATION", appName: "메시지"), "문자")
    XCTAssertEqual(SourceLabel.label(source: "NOTIFICATION", appName: "Messages"), "문자")
    XCTAssertEqual(SourceLabel.label(source: "NOTIFICATION", appName: "카카오톡"), "카카오톡")
    XCTAssertEqual(SourceLabel.label(source: "GMAIL", appName: nil), "메일")
    XCTAssertEqual(SourceLabel.label(source: "SHARE", appName: nil), "공유")
  }
}
