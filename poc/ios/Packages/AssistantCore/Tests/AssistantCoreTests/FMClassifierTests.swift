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
    let v = try await c.classify(text: "주문이 접수되었습니다", appName: "KakaoTalk", timeout: .seconds(3))
    XCTAssertNil(v)
    XCTAssertLessThan(Date().timeIntervalSince(t0), 1.0, "불가 상태에서는 타임아웃(3s)까지 기다리지 않고 즉시 nil을 반환해야 한다")
  }

  // "타임아웃" 경로: 모델 가용 여부와 무관하게, timeout을 0에 가깝게 주면 race에서 sleep 쪽이 이겨 nil을 반환해야 한다.
  func testClassifyReturnsNilOnImmediateTimeout() async throws {
    let c = FMClassifier()
    let v = try await c.classify(text: "주문이 접수되었습니다", appName: "KakaoTalk", timeout: .milliseconds(1))
    XCTAssertNil(v)
  }

  func testBenchmark() async throws {
    try XCTSkipUnless(FMClassifier.availability() == "available", "FM unavailable: \(FMClassifier.availability())")
    let url = Bundle(for: Self.self).url(forResource: "notifications", withExtension: "json")!
    let rows = try JSONDecoder().decode([Row].self, from: Data(contentsOf: url))
    let c = FMClassifier()
    // 이 Mac에서는 availability()가 "available"이어도 모델 에셋이 실제로 준비되지 않아
    // respond() 호출이 UnifiedAssetFramework 에러로 실패하는 경우를 관찰했다. 200건을 다 돌리기 전에
    // 한 번 찔러보고, 실제로 동작하지 않으면 하드 실패 대신 명확한 사유로 스킵한다.
    do {
      _ = try await c.classify(text: "사전 점검용 텍스트입니다", appName: nil)
    } catch {
      throw XCTSkip("availability()==available 이지만 실제 생성 실패(모델 에셋 미준비로 추정): \(error)")
    }
    var personalPassed = 0, noticeDropped = 0, personalTotal = 0, noticeTotal = 0
    var latencies: [Double] = []
    for r in rows {
      let t0 = Date()
      let v = try await c.classify(text: r.text, appName: r.app)
      latencies.append(Date().timeIntervalSince(t0))
      let kind = v?.kind ?? .personal   // nil이면 폐기 취급
      if r.expected == "personal" { personalTotal += 1; if kind == .notice { personalPassed += 1 } }
      if r.expected == "notice" { noticeTotal += 1; if kind != .notice { noticeDropped += 1 } }
    }
    let p95 = latencies.sorted()[Int(Double(latencies.count) * 0.95)]
    let report = "p95=\(p95)s personalPass=\(personalPassed)/\(personalTotal) noticeDrop=\(noticeDropped)/\(noticeTotal)"
    print("FM_BENCH", report)
    try report.write(to: AppGroup.containerURL().appendingPathComponent("fm_bench.txt"), atomically: true, encoding: .utf8)
    XCTAssertLessThan(p95, 3.0)
    XCTAssertLessThanOrEqual(Double(personalPassed) / Double(personalTotal), 0.02)
    XCTAssertLessThanOrEqual(Double(noticeDropped) / Double(noticeTotal), 0.15)
  }
}
