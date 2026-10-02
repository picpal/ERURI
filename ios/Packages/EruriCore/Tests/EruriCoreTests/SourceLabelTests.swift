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

  /// 보관함 출처(0.11.0, Fable F12): 링크·사진 항목은 "공유한 링크"·"공유한 이미지", 그 밖의 공유는 "공유"
  func testShareLinkAndImageLabels() {
    XCTAssertEqual(SourceLabel.label(source: "SHARE", appName: "웹 링크"), "공유한 링크")
    XCTAssertEqual(SourceLabel.label(source: "SHARE", appName: "이미지"), "공유한 이미지")
    XCTAssertEqual(SourceLabel.label(source: "SHARE", appName: nil), "공유")
  }
}
