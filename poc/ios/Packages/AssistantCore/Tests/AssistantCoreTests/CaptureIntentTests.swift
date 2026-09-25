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

// fix-2: 파이프라인이 title 도 필터링하고, Share Extension 경로도 규칙 필터를 거친다.
final class CapturePipelineShareTests: XCTestCase {
  func makeQueue() throws -> CaptureQueue {
    try CaptureQueue(url: FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString))
  }
  func testTitleOTPNotQueued() throws {
    let q = try makeQueue()
    let p = CapturePipeline(filter: RuleFilter(), queue: q)
    XCTAssertEqual(try p.handle(source: "MESSAGES", appName: nil, title: "인증번호 483920", sender: nil, text: "타인에게 알려주지 마세요"),
                   "discarded:otp")
    XCTAssertTrue(try q.pending(limit: 1).isEmpty)
  }
  func testTitleMaskedInQueue() throws {
    let q = try makeQueue()
    let p = CapturePipeline(filter: RuleFilter(), queue: q)
    XCTAssertEqual(try p.handle(source: "MESSAGES", appName: nil, title: "카드 4111-1111-1111-1111", sender: nil, text: "승인 32,000원"), "queued")
    XCTAssertEqual(try q.pending(limit: 1).first?.title, "카드 ****-****-****-1111")
  }
  func testFilterOnlyMasksTitle() throws {
    let p = CapturePipeline(filter: RuleFilter(contactNames: ["김민수"]), queue: try makeQueue())
    XCTAssertEqual(p.filterOnly(title: "김민수님", text: "안녕", sender: nil), .discard(reason: "contact"))
  }
  func testShareTextOTPDiscarded() throws {
    let q = try makeQueue()
    let p = CapturePipeline(filter: RuleFilter(), queue: q)
    XCTAssertEqual(try p.handleShare(text: "인증번호 483920 을 입력하세요"), "discarded:otp")
    XCTAssertTrue(try q.pending(limit: 1).isEmpty)
  }
  func testShareTextMaskedAndQueued() throws {
    let q = try makeQueue()
    let p = CapturePipeline(filter: RuleFilter(), queue: q)
    XCTAssertEqual(try p.handleShare(text: "국민은행 계좌 12345678901234 로 입금"), "queued")
    let it = try XCTUnwrap(q.pending(limit: 1).first)
    XCTAssertEqual(it.source, "SHARE"); XCTAssertEqual(it.text, "국민은행 계좌 **********1234 로 입금")
  }
  func testShareFileOTPNotPersisted() throws {
    let q = try makeQueue()
    let p = CapturePipeline(filter: RuleFilter(), queue: q)
    var persisted = false
    XCTAssertEqual(try p.handleShareFile(ocrText: "인증번호 483920", persist: { _ in persisted = true; return "inbox/x.jpg" }), "discarded:otp")
    XCTAssertFalse(persisted, "폐기면 파일을 App Group 에 저장하지 않는다")
    XCTAssertTrue(try q.pending(limit: 1).isEmpty)
  }
  func testShareFilePersistedWithMaskedOCR() throws {
    let q = try makeQueue()
    let p = CapturePipeline(filter: RuleFilter(), queue: q)
    var persistedId: String?
    XCTAssertEqual(try p.handleShareFile(ocrText: "카드 4111-1111-1111-1111", persist: { id in persistedId = id; return "inbox/\(id).jpg" }), "queued")
    let it = try XCTUnwrap(q.pending(limit: 1).first)
    XCTAssertEqual(it.id, persistedId); XCTAssertEqual(it.localFile, "inbox/\(it.id).jpg")
    XCTAssertEqual(it.ocrText, "카드 ****-****-****-1111"); XCTAssertEqual(it.source, "SHARE")
  }
}

// fix-2: 업로드 서버 주소는 App Group UserDefaults. 스킴 환경변수 INGEST_URL 은 저장값이 없을 때 초기값으로만 쓴다.
final class IngestSettingsTests: XCTestCase {
  func makeDefaults() -> UserDefaults { UserDefaults(suiteName: "test.ingest.\(UUID().uuidString)")! }
  func testFallbackWhenNothingStored() {
    let d = makeDefaults()
    IngestSettings.seed(from: [:], defaults: d)
    XCTAssertEqual(IngestSettings.url(defaults: d).absoluteString, "http://localhost:8787")
  }
  func testEnvSeedsOnlyWhenEmpty() {
    let d = makeDefaults()
    IngestSettings.seed(from: ["INGEST_URL": "http://10.0.0.2:8787"], defaults: d)
    XCTAssertEqual(IngestSettings.url(defaults: d).absoluteString, "http://10.0.0.2:8787")
    XCTAssertTrue(IngestSettings.set("http://192.168.0.5:9000", defaults: d))
    IngestSettings.seed(from: ["INGEST_URL": "http://10.0.0.2:8787"], defaults: d)   // 다시 실행해도 저장값 우선
    XCTAssertEqual(IngestSettings.url(defaults: d).absoluteString, "http://192.168.0.5:9000")
  }
  func testInvalidRejected() {
    let d = makeDefaults()
    XCTAssertFalse(IngestSettings.set("not a url", defaults: d))
    XCTAssertFalse(IngestSettings.set("ftp://1.2.3.4", defaults: d))
    XCTAssertTrue(IngestSettings.set("  http://192.168.0.5:9000  ", defaults: d))
    XCTAssertEqual(IngestSettings.url(defaults: d).absoluteString, "http://192.168.0.5:9000")
  }
}
