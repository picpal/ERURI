import XCTest
@testable import AssistantCore
final class CaptureQueueTests: XCTestCase {
  func makeQueue() throws -> CaptureQueue {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".sqlite")
    return try CaptureQueue(url: url)
  }
  func item(_ text: String) -> CaptureItem {
    CaptureItem(id: UUID().uuidString, source: "NOTIFICATION", appName: "KakaoTalk", sender: nil, title: nil,
                text: text, localFile: nil, ocrText: nil, capturedAt: Date(), attempts: 0)
  }
  func testEnqueueAndPending() throws {
    let q = try makeQueue()
    try q.enqueue(item("a")); try q.enqueue(item("b"))
    XCTAssertEqual(try q.pending(limit: 10).map(\.text), ["a", "b"])
  }
  func testMarkSentRemoves() throws {
    let q = try makeQueue(); let i = item("a")
    try q.enqueue(i); try q.markSent(id: i.id)
    XCTAssertTrue(try q.pending(limit: 10).isEmpty)
  }
  func testMarkFailedIncrementsAttempts() throws {
    let q = try makeQueue(); let i = item("a")
    try q.enqueue(i); try q.markFailed(id: i.id)
    XCTAssertEqual(try q.pending(limit: 10).first?.attempts, 1)
  }
  func testSurvivesReopen() throws {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".sqlite")
    try CaptureQueue(url: url).enqueue(item("persist"))
    XCTAssertEqual(try CaptureQueue(url: url).pending(limit: 1).first?.text, "persist")
  }
}
