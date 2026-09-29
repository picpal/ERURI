import XCTest
@testable import EruriCore

final class LockStateTests: XCTestCase {
  func testResolveFollowsProbe() {
    XCTAssertEqual(LockState.resolve(probe: .readable), .unlocked)
    XCTAssertEqual(LockState.resolve(probe: .denied), .locked)
    XCTAssertEqual(LockState.resolve(probe: .missing), .unknown)
    XCTAssertEqual(LockState.resolve(probe: .error(4)), .unknown)
  }

  func testClassifyMapsPermissionAndMissingErrors() {
    XCTAssertEqual(LockProbe.classify(NSError(domain: NSCocoaErrorDomain, code: NSFileReadNoPermissionError)), .denied)
    let eperm = NSError(domain: NSPOSIXErrorDomain, code: Int(EPERM))
    XCTAssertEqual(LockProbe.classify(NSError(domain: NSCocoaErrorDomain, code: 256, userInfo: [NSUnderlyingErrorKey: eperm])), .denied)
    XCTAssertEqual(LockProbe.classify(NSError(domain: NSPOSIXErrorDomain, code: Int(EACCES))), .denied)
    XCTAssertEqual(LockProbe.classify(NSError(domain: NSCocoaErrorDomain, code: NSFileReadNoSuchFileError)), .missing)
    XCTAssertEqual(LockProbe.classify(NSError(domain: NSCocoaErrorDomain, code: 999)), .error(999))
    XCTAssertEqual(LockProbeRead.error(999).code, "error:999")
  }

  func testReadMissingThenEnsureThenReadable() {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("probe-\(UUID().uuidString)")
    addTeardownBlock { try? FileManager.default.removeItem(at: url) }
    XCTAssertEqual(LockProbe.read(at: url), .missing)
    LockProbe.ensure(at: url)
    XCTAssertEqual(LockProbe.read(at: url), .readable)   // 시뮬레이터는 파일 보호를 강제하지 않는다 — 잠금 판정은 실기기(Task 14)
  }

  func testTraceValueIsBoolOrNullAndSerializes() throws {
    XCTAssertEqual(LockState.locked.traceValue as? Bool, true)
    XCTAssertEqual(LockState.unlocked.traceValue as? Bool, false)
    XCTAssertTrue(LockState.unknown.traceValue is NSNull)
    XCTAssertNil(LockState.unknown.boolValue)
    let data = try XCTUnwrap(Trace.payload("upload.wake", ["locked": LockState.unknown.traceValue, "lock_state": "unknown"],
                                           deviceID: "d", build: "1", at: Date()))
    XCTAssertTrue(String(decoding: data, as: UTF8.self).contains("\"locked\":null"))
  }
}
