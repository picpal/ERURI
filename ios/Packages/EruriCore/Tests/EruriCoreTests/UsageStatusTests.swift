import XCTest
@testable import EruriCore

/// 스펙 §13 이번 달 사용 표시(M2-⑦). 0014 usage_status 의 PostgREST 응답 모양
final class UsageStatusTests: XCTestCase {
  private func label(_ json: String) -> String? { UsageStatus.label(Data(json.utf8)) }

  func testOkShowsUsedAndCap() {
    XCTAssertEqual(label(#"[{"month":"2026-09-01","used_krw":1234.56,"cap_krw":10000,"level":"ok"}]"#), "1234원 / 10000원")
  }

  func testDegradedAndStoppedSuffix() {
    XCTAssertEqual(label(#"[{"month":"2026-09-01","used_krw":8000,"cap_krw":10000,"level":"degraded"}]"#), "8000원 / 10000원 · 80% 넘음(채팅 경량 모델)")
    XCTAssertEqual(label(#"[{"month":"2026-09-01","used_krw":10000,"cap_krw":10000,"level":"stopped"}]"#), "10000원 / 10000원 · 추출·채팅 중단(수집은 계속)")
  }

  /// 이번 달 행이 없는 사용자: 서버가 used 0 을 준다(left join·coalesce)
  func testNoUsageYet() {
    XCTAssertEqual(label(#"[{"month":"2026-09-01","used_krw":0,"cap_krw":10000,"level":"ok"}]"#), "0원 / 10000원")
  }

  func testMalformedIsNil() {
    XCTAssertNil(label("[]"))
    XCTAssertNil(label(#"{"message":"JWT expired"}"#))
    XCTAssertNil(label(#"[{"used_krw":"12","cap_krw":10000}]"#))
  }
}
