import XCTest
@testable import EruriCore

final class TraceTests: XCTestCase {
  func tempQueue() throws -> CaptureQueue {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".sqlite")
    addTeardownBlock { for s in ["", "-wal", "-shm"] { try? FileManager.default.removeItem(atPath: url.path + s) } }
    return try CaptureQueue(url: url)
  }

  func testTraceRowsAreSeparateFromCaptures() throws {
    let q = try tempQueue()
    try q.enqueue(CaptureQueueTests.item("a"))
    try q.enqueueTrace(id: "t1", payload: Data(#"{"event":"poc1.x"}"#.utf8), at: Date())
    XCTAssertEqual(try q.pending(limit: 10).map(\.text), ["a"])        // 캡처 조회·업로드에 trace 가 섞이지 않는다
    XCTAssertEqual(try q.claim(limit: 10).map(\.text), ["a"])
    let t = try q.claimTraces(limit: 200)
    XCTAssertEqual(t.map(\.id), ["t1"])
    XCTAssertTrue(try q.claimTraces(limit: 200).isEmpty)                 // lease 중에는 다시 가져가지 않는다
    try q.markFailed(ids: ["t1"])
    XCTAssertEqual(try q.traceCount(), 1)
    try q.markSent(ids: ["t1"])
    XCTAssertEqual(try q.traceCount(), 0)
  }

  func testClaimTracesRespectsLimitAndOrder() throws {
    let q = try tempQueue(); let t0 = Date()
    for i in 0..<5 { try q.enqueueTrace(id: "t\(i)", payload: Data("{}".utf8), at: t0.addingTimeInterval(Double(i))) }
    XCTAssertEqual(try q.claimTraces(limit: 3).map(\.id), ["t0", "t1", "t2"])
  }

  func testPayloadHasContractShapeAndCommonFields() throws {
    let data = try XCTUnwrap(Trace.payload("poc1.intent_fired", ["text_len": 3, "locked": false], deviceID: "dev-1",
                                           build: "42", at: Date(timeIntervalSince1970: 0)))
    let o = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    XCTAssertEqual(o["device_id"] as? String, "dev-1")
    XCTAssertEqual(o["event"] as? String, "poc1.intent_fired")
    XCTAssertEqual(o["at"] as? String, "1970-01-01T00:00:00.000Z")
    let f = try XCTUnwrap(o["fields"] as? [String: Any])
    XCTAssertEqual(f["build"] as? String, "42")
    XCTAssertEqual(f["text_len"] as? Int, 3)
  }

  func testRejectsBodyKeysBadEventsAndNonJSON() {
    XCTAssertNil(Trace.payload("poc1.x", ["Text": "원문"], deviceID: "d", build: "1", at: Date()))
    XCTAssertNil(Trace.payload("poc1.x", ["nested": ["body": 1]], deviceID: "d", build: "1", at: Date()))
    XCTAssertNil(Trace.payload("Poc1.X", [:], deviceID: "d", build: "1", at: Date()))
    XCTAssertNil(Trace.payload("poc1.x", ["d": Date()], deviceID: "d", build: "1", at: Date()))
  }

  func testSha8() {
    XCTAssertEqual(Trace.sha8("abc"), "ba7816bf")   // SHA-256("abc") 앞 8자
  }

  func testBatchBodyIsJSONArray() throws {
    let body = Trace.batchBody([Data(#"{"a":1}"#.utf8), Data(#"{"b":2}"#.utf8)])
    let arr = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [[String: Int]])
    XCTAssertEqual(arr, [["a": 1], ["b": 2]])
  }
}
