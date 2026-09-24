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

  // HIGH-1 / 스펙 §6 폴백: FM 불가·타임아웃·에러는 채팅 앱만 폐기, 그 외는 rules 로 적재
  func testRouteFallbacks() {
    let notice = FMOutcome.verdict(FMVerdict(kind: .notice, confidence: 0.9))
    let personal = FMOutcome.verdict(FMVerdict(kind: .personal, confidence: 0.9))
    XCTAssertEqual(CapturePipeline.route(notice, appName: "KakaoTalk"), .queue(deviceFilter: "fm"))
    XCTAssertEqual(CapturePipeline.route(personal, appName: "Coupang"), .discard(reason: "fm:personal"))
    XCTAssertEqual(CapturePipeline.route(.error("rateLimited"), appName: "Messages"), .queue(deviceFilter: "rules"))
    XCTAssertEqual(CapturePipeline.route(.error("guardrail"), appName: nil), .queue(deviceFilter: "rules"))
    XCTAssertEqual(CapturePipeline.route(.timeout, appName: "Coupang"), .queue(deviceFilter: "rules"))
    XCTAssertEqual(CapturePipeline.route(.unavailable("modelNotReady"), appName: "Instagram"), .discard(reason: "fm-unavailable"))
    XCTAssertEqual(CapturePipeline.route(.error("assets"), appName: "카카오톡"), .discard(reason: "fm-error"))
    XCTAssertEqual(CapturePipeline.route(.timeout, appName: "KakaoTalk"), .discard(reason: "fm-timeout"))
  }
  func testDeviceFilterPersisted() throws {
    let q = try CaptureQueue(url: FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString))
    let p = CapturePipeline(filter: RuleFilter(), queue: q)
    try p.enqueue(source: "MESSAGES", appName: nil, title: nil, sender: nil, masked: "배송 출발", deviceFilter: "rules")
    XCTAssertEqual(try q.pending(limit: 1).first?.deviceFilter, "rules")
  }
}
