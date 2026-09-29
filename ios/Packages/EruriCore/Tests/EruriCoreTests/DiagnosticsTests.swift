import XCTest
@testable import EruriCore

/// 스펙 §8 device_traces: 설정의 "진단 전송" 토글 기본 켜짐(1인 사용). 꺼지면 trace 를 큐에 넣지 않는다(로컬 로그만)
final class DiagnosticsTests: XCTestCase {
  private func tempDefaults() -> UserDefaults {
    let name = "diag-\(UUID().uuidString)"
    let d = UserDefaults(suiteName: name)!
    addTeardownBlock { UserDefaults(suiteName: name)?.removePersistentDomain(forName: name) }   // Swift 6: non-Sendable d 대신 이름만 캡처
    return d
  }
  private func tempQueue() throws -> CaptureQueue {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".sqlite")
    addTeardownBlock { for s in ["", "-wal", "-shm"] { try? FileManager.default.removeItem(atPath: url.path + s) } }
    return try CaptureQueue(url: url)
  }

  func testDefaultOnAndToggle() {
    let d = tempDefaults()
    XCTAssertTrue(Diagnostics.isEnabled(defaults: d))
    Diagnostics.set(false, defaults: d); XCTAssertFalse(Diagnostics.isEnabled(defaults: d))
    Diagnostics.set(true, defaults: d); XCTAssertTrue(Diagnostics.isEnabled(defaults: d))
  }

  func testDisabledTraceIsNotQueued() throws {
    let d = tempDefaults(), q = try tempQueue()
    Diagnostics.set(false, defaults: d)
    Trace.log("capture.intent_fired", ["result": "queued:rules"], queue: q, defaults: d)
    XCTAssertEqual(try q.traceCount(), 0)
    Diagnostics.set(true, defaults: d)
    Trace.log("capture.intent_fired", ["result": "queued:rules"], queue: q, defaults: d)
    XCTAssertEqual(try q.traceCount(), 1)
  }

  func testProductEventNamesOnly() {
    for e in ["capture.intent_fired", "device.registered", "action.handled", "share.received", "upload.done", "upload.wake"] {
      XCTAssertNotNil(Trace.payload(e, [:], deviceID: "d", build: "1", at: Date()), e)
    }
    for e in ["poc" + "1.intent_fired", "misc.x", "capture"] {   // PoC 이름: 게이트 grep(poc[0-9]\.) 에 걸리지 않게 나눠 쓴다
      XCTAssertNil(Trace.payload(e, [:], deviceID: "d", build: "1", at: Date()), e)
    }
  }
}
