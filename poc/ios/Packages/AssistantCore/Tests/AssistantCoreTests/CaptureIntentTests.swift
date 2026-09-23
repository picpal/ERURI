import XCTest
@testable import AssistantCore
final class CapturePipelineTests: XCTestCase {
  func testNoticeQueued() throws {
    let q = try CaptureQueue(url: FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString))
    let p = CapturePipeline(filter: RuleFilter(), queue: q)
    XCTAssertEqual(try p.handle(source: "NOTIFICATION", appName: "KakaoTalk", title: "쿠팡", sender: nil, text: "주문이 접수되었습니다"), "queued")
    XCTAssertEqual(try q.pending(limit: 1).first?.appName, "KakaoTalk")
  }
  func testOTPNotQueued() throws {
    let q = try CaptureQueue(url: FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString))
    let p = CapturePipeline(filter: RuleFilter(), queue: q)
    XCTAssertEqual(try p.handle(source: "MESSAGES", appName: nil, title: nil, sender: "15880000", text: "인증번호 123456"), "discarded:otp")
    XCTAssertTrue(try q.pending(limit: 1).isEmpty)
  }
}
