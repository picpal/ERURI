import XCTest
@testable import EruriCore

/// 스펙 §10 액션 핸들러의 네트워크 마감(M1-②c 리뷰 Important 1). 느린 네트워크에서도 마감 시각에 돌아와야
/// EventKit 쓰기와 완료 핸들러가 백그라운드 실행 시간 안에 끝난다
final class DeadlineTests: XCTestCase {
  func testFastOperationReturnsValue() async {
    let v = await Deadline.run(seconds: 2) { "ok" }
    XCTAssertEqual(v, "ok")
  }

  /// 응답이 10초 뒤에 오는 목 네트워크: 마감(0.3초)에 nil 로 돌아오고, 요청은 취소된다
  func testSlowNetworkHitsDeadline() async {
    let session = SlowNetwork.session(delay: 10)
    let t0 = Date()
    let v = await Deadline.run(seconds: 0.3) { () -> Int? in
      guard let (_, resp) = try? await session.data(from: URL(string: "https://slow.test/token")!) else { return nil }
      return (resp as? HTTPURLResponse)?.statusCode
    }
    XCTAssertNil(v)
    XCTAssertLessThan(Date().timeIntervalSince(t0), 1.5)
  }

  /// 취소를 무시하는 작업(토큰 갱신처럼 다른 Task 의 결과를 기다림)도 기다리지 않는다 — withTaskGroup 이면 여기서 10초를 기다린다
  func testDoesNotWaitForUncancellableWork() async {
    let shared = Task { () -> String? in
      try? await Task.sleep(for: .seconds(10))
      return "late"
    }
    let t0 = Date()
    let v = await Deadline.run(seconds: 0.3) { await shared.value }
    XCTAssertNil(v)
    XCTAssertLessThan(Date().timeIntervalSince(t0), 1.5)
    shared.cancel()
  }

  /// 핸들러 한 번의 네트워크 구간(순서 1 조회 + 순서 4 보고)이 둘 다 느려도 두 마감의 합 안에 끝난다
  func testSequentialDeadlinesBoundTotal() async {
    let session = SlowNetwork.session(delay: 10)
    let slow: @Sendable () async -> Int? = {
      guard let (_, resp) = try? await session.data(from: URL(string: "https://slow.test/rest")!) else { return nil }
      return (resp as? HTTPURLResponse)?.statusCode
    }
    let t0 = Date()
    let a = await Deadline.run(seconds: 0.3, slow)
    let b = await Deadline.run(seconds: 0.3, slow)
    XCTAssertNil(a); XCTAssertNil(b)
    XCTAssertLessThan(Date().timeIntervalSince(t0), 2)
  }

  /// 호출한 Task 가 취소되면 마감 전이라도 nil 로 돌아온다
  func testCallerCancellation() async {
    let t0 = Date()
    let outer = Task { await Deadline.run(seconds: 10) { () -> String? in try? await Task.sleep(for: .seconds(10)); return "late" } }
    try? await Task.sleep(for: .milliseconds(100))
    outer.cancel()
    let v = await outer.value
    XCTAssertNil(v)
    XCTAssertLessThan(Date().timeIntervalSince(t0), 1.5)
  }
}

/// 응답을 `delay` 초 늦게 주는 URLProtocol(느린 셀룰러 흉내). 취소되면 응답을 보내지 않는다
final class SlowNetwork: URLProtocol, @unchecked Sendable {
  nonisolated(unsafe) static var delay: TimeInterval = 10
  private var work: DispatchWorkItem?

  static func session(delay: TimeInterval) -> URLSession {
    Self.delay = delay
    let c = URLSessionConfiguration.ephemeral
    c.protocolClasses = [SlowNetwork.self]
    return URLSession(configuration: c)
  }
  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func startLoading() {
    let w = DispatchWorkItem { [self] in
      let r = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
      client?.urlProtocol(self, didReceive: r, cacheStoragePolicy: .notAllowed)
      client?.urlProtocolDidFinishLoading(self)
    }
    work = w
    DispatchQueue.global().asyncAfter(deadline: .now() + Self.delay, execute: w)
  }
  override func stopLoading() { work?.cancel() }
}
