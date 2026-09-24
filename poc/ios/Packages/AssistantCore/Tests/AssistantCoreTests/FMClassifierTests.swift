import XCTest
@testable import AssistantCore
final class FMClassifierTests: XCTestCase {
  struct Row: Decodable { let app: String; let title: String?; let text: String; let expected: String }

  func testAvailabilityReturnsKnownValue() {
    let known: Set<String> = ["available", "deviceNotEligible", "appleIntelligenceNotEnabled", "modelNotReady", "unavailable"]
    XCTAssertTrue(known.contains(FMClassifier.availability()))
  }

  // "불가" 경로: 모델을 쓸 수 없으면 즉시 nil을 반환해야 한다(타임아웃까지 기다리지 않음).
  func testClassifyReturnsNilWhenUnavailable() async throws {
    try XCTSkipIf(FMClassifier.availability() == "available", "FM available: 이 테스트는 불가 상태 경로를 검증한다")
    let c = FMClassifier()
    let t0 = Date()
    let v = await c.classify(text: "주문이 접수되었습니다", appName: "KakaoTalk", timeout: .seconds(3))
    XCTAssertNil(v)
    XCTAssertLessThan(Date().timeIntervalSince(t0), 1.0, "불가 상태에서는 타임아웃(3s)까지 기다리지 않고 즉시 nil을 반환해야 한다")
  }

  // "타임아웃·에러" 경로: timeout 을 0에 가깝게 주면 타임아웃이든(모델 가용) 에셋 에러든(시뮬레이터) nil 이고,
  // respond 가 취소에 협조하지 않아도 타임아웃 시점에 반환해야 한다(MED-1).
  func testClassifyReturnsNilOnImmediateTimeout() async throws {
    let c = FMClassifier()
    let t0 = Date()
    let v = await c.classify(text: "주문이 접수되었습니다", appName: "KakaoTalk", timeout: .milliseconds(1))
    XCTAssertNil(v)
    XCTAssertLessThan(Date().timeIntervalSince(t0), 0.5)
  }

  // HIGH-2: 호출마다 새 세션이므로 연속·동시 호출이 context/concurrent 에러를 내지 않아야 한다.
  func testRepeatedAndConcurrentCallsDoNotShareSession() async throws {
    try XCTSkipUnless(FMClassifier.availability() == "available", "FM unavailable")
    let c = FMClassifier()
    async let a = c.classifyDetailed(text: "주문이 접수되었습니다", appName: "Coupang", timeout: .seconds(30))
    async let b = c.classifyDetailed(text: "내일 몇 시에 볼까?", appName: "iMessage", timeout: .seconds(30))
    for o in await [a, b] {
      if case .error(let code) = o { XCTAssertFalse(["context", "concurrent"].contains(code), code) }
    }
  }

  func testBenchmark() async throws {
    try XCTSkipUnless(FMClassifier.availability() == "available", "FM unavailable: \(FMClassifier.availability())")
    let url = Bundle(for: Self.self).url(forResource: "notifications", withExtension: "json")!
    let rows = try JSONDecoder().decode([Row].self, from: Data(contentsOf: url))
    let c = FMClassifier()
    // 시뮬레이터에서는 availability()가 "available"이어도 모델 에셋이 없어 respond()가 실패한다.
    // 200건을 돌리기 전에 한 번 찔러보고, 에러면 에러 종류를 사유로 스킵한다.
    let probe = await c.classifyDetailed(text: "사전 점검용 텍스트입니다", appName: nil, timeout: .seconds(30))
    if case .error(let code) = probe { throw XCTSkip("availability()==available 이지만 생성 실패: \(code)") }
    var personalPassed = 0, noticeDropped = 0, personalTotal = 0, noticeTotal = 0, errors = 0, timeouts = 0
    var personalByApp: [String: (pass: Int, total: Int)] = [:]
    var latencies: [Double] = []
    for r in rows {
      let t0 = Date()
      let outcome = await c.classifyDetailed(text: r.text, appName: r.app, title: r.title)   // 행마다 새 세션
      latencies.append(Date().timeIntervalSince(t0))
      if case .error = outcome { errors += 1 }
      if case .timeout = outcome { timeouts += 1 }
      let kind = outcome.verdict?.kind ?? .personal   // 에러·타임아웃은 폐기 취급
      if r.expected == "personal" {
        personalTotal += 1
        let passed = kind == .notice
        if passed { personalPassed += 1 }
        let cur = personalByApp[r.app] ?? (0, 0)
        personalByApp[r.app] = (cur.pass + (passed ? 1 : 0), cur.total + 1)
      }
      if r.expected == "notice" { noticeTotal += 1; if kind != .notice { noticeDropped += 1 } }
    }
    let p95 = latencies.sorted()[Int(Double(latencies.count) * 0.95)]
    let byApp = personalByApp.keys.sorted().map { "\($0)=\(personalByApp[$0]!.pass)/\(personalByApp[$0]!.total)" }.joined(separator: ",")
    let report = "p95=\(p95)s personalPass=\(personalPassed)/\(personalTotal) noticeDrop=\(noticeDropped)/\(noticeTotal) errors=\(errors) timeouts=\(timeouts) personalPassByApp=\(byApp)"
    print("FM_BENCH", report)
    try report.write(to: AppGroup.containerURL().appendingPathComponent("fm_bench.txt"), atomically: true, encoding: .utf8)
    XCTAssertLessThan(p95, 3.0)
    XCTAssertLessThanOrEqual(Double(personalPassed) / Double(personalTotal), 0.02)
    XCTAssertLessThanOrEqual(Double(noticeDropped) / Double(noticeTotal), 0.15)
  }
}
