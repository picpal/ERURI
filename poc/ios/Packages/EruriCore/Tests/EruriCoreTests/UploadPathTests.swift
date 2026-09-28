import XCTest
@testable import EruriCore

final class UploadPathTests: XCTestCase {
  func testPathResolution() {
    XCTAssertEqual(UploadPath.resolve(trigger: .intent, viaBackgroundSession: false), .intentDirect)
    XCTAssertEqual(UploadPath.resolve(trigger: .intent, viaBackgroundSession: true), .bgUpload)
    for (t, p) in [(UploadTrigger.silentPush, UploadPath.silentPush), (.bgRefresh, .bgRefresh), (.foreground, .foreground)] {
      XCTAssertEqual(UploadPath.resolve(trigger: t, viaBackgroundSession: false), p)
      XCTAssertEqual(UploadPath.resolve(trigger: t, viaBackgroundSession: true), p)
    }
    XCTAssertEqual(Set(UploadPath.allCases.map(\.rawValue)), ["intent_direct", "bg_upload", "silent_push", "bg_refresh", "foreground"])
  }

  func testTagRoundTrip() {
    let at = Date(timeIntervalSince1970: 1_790_000_000.123)
    for (trigger, locked) in [(UploadTrigger.intent, Optional(true)), (.silentPush, false), (.bgRefresh, nil)] {
      let tag = UploadTag(id: "A1B2-C3", trigger: trigger, capturedAt: at, locked: locked)
      let back = UploadTag.decode(tag.encoded)
      XCTAssertEqual(back?.id, "A1B2-C3"); XCTAssertEqual(back?.trigger, trigger); XCTAssertEqual(back?.locked, locked)
      XCTAssertEqual(back!.capturedAt.timeIntervalSince1970, at.timeIntervalSince1970, accuracy: 0.001)
    }
  }

  /// 0.1.x 태스크(설명 = 항목 id)·trace 배치·깨진 값은 태그가 아니다
  func testDecodeRejectsLegacyAndMalformed() {
    for s in ["A1B2-C3", "trace:a,b", "cap|", "cap|id|nope|1|1", "cap|id|intent|x|1", "cap||intent|1|1", "cap|id|intent|1"] {
      XCTAssertNil(UploadTag.decode(s), s)
    }
  }

  func testOutboxWritesDecodableBodyWithStableId() throws {
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
    addTeardownBlock { try? FileManager.default.removeItem(at: dir) }
    let item = CaptureQueueTests.item("합성 본문")
    let url = try Outbox.writeJSON(item, container: dir)
    XCTAssertEqual(url.lastPathComponent, item.id + ".json")
    XCTAssertEqual(try JSONDecoder().decode(CaptureItem.self, from: Data(contentsOf: url)), item)
    // 재시도는 같은 파일·같은 id 로 다시 쓴다 → 서버 idempotency_key(source:id)가 같다
    let again = try Outbox.writeJSON(item, container: dir)
    XCTAssertEqual(again, url)
    XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: url.deletingLastPathComponent().path).count, 1)
    Outbox.remove(id: item.id, container: dir)
    XCTAssertFalse(FileManager.default.fileExists(atPath: url.path))
  }

  /// 인텐트 flush 와 foreground flush 가 겹쳐도 한 항목은 한 번만 claim 되고, 완료(markSent) 뒤엔 다시 나오지 않는다
  func testClaimPreventsDoubleUploadAcrossFlushes() throws {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".sqlite")
    addTeardownBlock { for s in ["", "-wal", "-shm"] { try? FileManager.default.removeItem(atPath: url.path + s) } }
    let a = try CaptureQueue(url: url), b = try CaptureQueue(url: url)   // 인텐트·앱 쪽 연결
    let item = CaptureQueueTests.item("x"); try a.enqueue(item)
    XCTAssertEqual(try a.claim(limit: 20).map(\.id), [item.id])
    XCTAssertTrue(try b.claim(limit: 20).isEmpty)
    XCTAssertEqual(try b.captureCount(), 1)
    try b.markSent(id: item.id)
    XCTAssertEqual(try a.captureCount(), 0)
    XCTAssertTrue(try a.claim(limit: 20, now: Date() + 3600).isEmpty)
  }

  /// 직접 요청 실패(응답 있음) → 백오프 후 같은 id 로 다시 claim 된다
  func testFailedDirectRetriesWithSameId() throws {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".sqlite")
    addTeardownBlock { for s in ["", "-wal", "-shm"] { try? FileManager.default.removeItem(atPath: url.path + s) } }
    let q = try CaptureQueue(url: url)
    let item = CaptureQueueTests.item("y"); try q.enqueue(item)
    let t0 = Date()
    _ = try q.claim(limit: 20, now: t0); try q.markFailed(id: item.id, now: t0)
    XCTAssertTrue(try q.claim(limit: 20, now: t0 + 10).isEmpty)
    XCTAssertEqual(try q.claim(limit: 20, now: t0 + 31).map(\.id), [item.id])
  }
}
