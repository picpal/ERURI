import XCTest
@testable import EruriCore

/// 채팅 음성 입력 상태 전이(오디오 없이): 권한·온디바이스 가용성, 탭 시작/정지, 받아쓴 글 합치기, 2초 무음 정지
final class DictationTests: XCTestCase {
  func testAvailability() {
    var d = Dictation()
    d.setAvailability(permission: .denied, onDevice: true)
    XCTAssertEqual(d.phase, .unavailable(.denied))
    XCTAssertNotNil(d.notice)
    d.setAvailability(permission: .granted, onDevice: false)
    XCTAssertEqual(d.phase, .unavailable(.noOnDevice))
    d.setAvailability(permission: .undetermined, onDevice: true)
    XCTAssertEqual(d.phase, .idle)
    XCTAssertNil(d.notice)
  }

  func testTapStartsAndStops() {
    var d = Dictation()
    XCTAssertEqual(d.tap(currentText: ""), .start)
    XCTAssertEqual(d.phase, .recording)
    XCTAssertEqual(d.tap(currentText: "x"), .stop)
    XCTAssertEqual(d.phase, .idle)
  }

  func testUnavailableTapDoesNothing() {
    var d = Dictation()
    d.setAvailability(permission: .denied, onDevice: true)
    XCTAssertEqual(d.tap(currentText: ""), .none)
    XCTAssertEqual(d.phase, .unavailable(.denied))
  }

  func testTranscriptAppendsToExistingText() {
    var d = Dictation()
    _ = d.tap(currentText: "내일 ")
    XCTAssertEqual(d.transcript("회의 몇 시야"), "내일 회의 몇 시야")
    XCTAssertEqual(d.transcript("회의 몇 시였지"), "내일 회의 몇 시였지")   // 부분 결과는 앞 부분 결과를 바꾼다
    var e = Dictation()
    _ = e.tap(currentText: "")
    XCTAssertEqual(e.transcript("안녕"), "안녕")
    var f = Dictation()
    _ = f.tap(currentText: "메모")
    XCTAssertEqual(f.transcript("추가"), "메모 추가")
  }

  func testTranscriptIgnoredWhenNotRecording() {
    var d = Dictation()
    XCTAssertNil(d.transcript("늦게 온 결과"))
  }

  func testEngineEndedReturnsToIdle() {
    var d = Dictation()
    _ = d.tap(currentText: "")
    d.ended()
    XCTAssertEqual(d.phase, .idle)
    // 가용성이 바뀐 뒤 끝나도 unavailable 을 덮지 않는다
    _ = d.tap(currentText: "")
    d.setAvailability(permission: .denied, onDevice: true)
    d.ended()
    XCTAssertEqual(d.phase, .unavailable(.denied))
  }

  func testSilence() {
    let t0 = Date(timeIntervalSince1970: 1000)
    XCTAssertFalse(Dictation.silent(lastHeard: t0, now: t0.addingTimeInterval(1.9)))
    XCTAssertTrue(Dictation.silent(lastHeard: t0, now: t0.addingTimeInterval(2)))
  }
}
