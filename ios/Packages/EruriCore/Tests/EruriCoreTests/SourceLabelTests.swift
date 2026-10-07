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
    XCTAssertEqual(SourceLabel.label(source: "SHARE", appName: "채팅"), "채팅에서 등록")       // 0.13.0 채팅 일정 등록
  }

  /// 제안 카드 출처 버튼 아이콘(2026-10-07, 스펙 §11): 라벨과 같은 분기 — 문자·메일·알림 앱·공유(링크·이미지·채팅)
  func testSymbols() {
    XCTAssertEqual(SourceLabel.symbol(source: "MESSAGES", appName: nil), "message")
    XCTAssertEqual(SourceLabel.symbol(source: "NOTIFICATION", appName: "메시지"), "message")
    XCTAssertEqual(SourceLabel.symbol(source: "NOTIFICATION", appName: "카카오톡"), "bell")
    XCTAssertEqual(SourceLabel.symbol(source: "GMAIL", appName: nil), "envelope")
    XCTAssertEqual(SourceLabel.symbol(source: "SHARE", appName: "웹 링크"), "link")
    XCTAssertEqual(SourceLabel.symbol(source: "SHARE", appName: "이미지"), "photo")
    XCTAssertEqual(SourceLabel.symbol(source: "SHARE", appName: "채팅"), "bubble.left")
    XCTAssertEqual(SourceLabel.symbol(source: "SHARE", appName: nil), "square.and.arrow.up")
    XCTAssertEqual(SourceLabel.symbol(source: "CHAT", appName: nil), "bubble.left")
    XCTAssertEqual(SourceLabel.symbol(source: "UNKNOWN", appName: nil), "doc.text")
  }
}
