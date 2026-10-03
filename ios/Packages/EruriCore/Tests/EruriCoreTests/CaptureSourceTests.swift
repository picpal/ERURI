import XCTest
@testable import EruriCore

final class CaptureSourceTests: XCTestCase {
  // ingest(handler.ts SOURCES)가 받는 값은 그대로
  func testAcceptedSourcesUnchanged() {
    for s in ["MESSAGES", "NOTIFICATION", "SHARE", "CHAT"] { XCTAssertEqual(CaptureSource.normalize(s), s) }
  }
  // 실기기 10-01~10-03: 메시지 자동화 출처를 "MESSAGE"(단수)로 넣어 ingest 가 400 → 큐에서 1시간마다 재시도만 반복
  func testSingularMessageBecomesMessages() {
    XCTAssertEqual(CaptureSource.normalize("MESSAGE"), "MESSAGES")
    XCTAssertEqual(CaptureSource.normalize(" message\n"), "MESSAGES")
    XCTAssertEqual(CaptureSource.normalize("Messages"), "MESSAGES")
    XCTAssertEqual(CaptureSource.normalize("notification"), "NOTIFICATION")
  }
  // 모르는 값·빈 값은 인텐트 기본값(NOTIFICATION)으로 — 400 으로 막혀 유실되지 않게
  func testUnknownFallsBackToNotification() {
    for s in ["", "  ", "SMS?", "카카오톡", "GMAIL"] { XCTAssertEqual(CaptureSource.normalize(s), "NOTIFICATION", s) }
  }
  // 이미 큐에 들어간 "MESSAGE" 항목도 올릴 때 고쳐 보낸다(재시도가 성공으로 바뀌게). id 는 그대로 → 멱등 키 MESSAGES:<id>
  func testOutboxBodySendsNormalizedSource() throws {
    var item = CaptureQueueTests.item("합성 본문")
    item.source = "MESSAGE"
    let o = try XCTUnwrap(JSONSerialization.jsonObject(with: Outbox.body(item)) as? [String: Any])
    XCTAssertEqual(o["source"] as? String, "MESSAGES")
    XCTAssertEqual(o["id"] as? String, item.id)
    item.source = "SHARE"
    XCTAssertEqual((try JSONSerialization.jsonObject(with: Outbox.body(item)) as? [String: Any])?["source"] as? String, "SHARE")
  }
}
