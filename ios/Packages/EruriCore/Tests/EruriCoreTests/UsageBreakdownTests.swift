import XCTest
@testable import EruriCore

/// 스펙 §9 "이번 달 사용" 기능별 표시(0.15.0) — 표기·순서·0건 숨김·옛 서버
final class UsageBreakdownTests: XCTestCase {
  func rows(_ xs: [(String, String, Int, Int, Int, Double)]) -> Data {
    let a = xs.map { ["kind": $0.0, "model": $0.1, "calls": $0.2, "input_tokens": $0.3, "cached_tokens": 0, "output_tokens": $0.4, "krw": $0.5] as [String: Any] }
    return try! JSONSerialization.data(withJSONObject: a)
  }

  func testTokenFormat() {
    XCTAssertEqual(["850토큰", "9,999토큰", "1만 토큰", "1.2만 토큰", "10만 토큰", "10만 토큰", "52만 토큰", "1,234만 토큰"],
                   [850, 9_999, 10_000, 12_000, 99_950, 100_000, 520_000, 12_340_000].map(UsageStatus.tokens))
  }
  func testWonFormat() {
    XCTAssertEqual(UsageStatus.won(1020.4), "1,020원")
    XCTAssertEqual(UsageStatus.won(0.5), "1원")
    XCTAssertEqual(UsageStatus.won(0.49), "1원 미만")
    XCTAssertEqual(UsageStatus.won(0), "0원")
  }
  func testOrderMergeAndOutsideLine() {
    let d = rows([("embed", "text-embedding-3-large", 3, 270_000, 0, 49), ("chat", "gpt-6-sol", 4, 400_000, 20_000, 1000.2),
                  ("chat", "gpt-6-luna", 9, 90_000, 10_000, 20), ("mail_summary", "gpt-6-luna", 2, 30_000, 1_000, 45),
                  ("extract", "gpt-6-luna", 60, 700_000, 100_000, 120), ("vision", "gpt-6-luna", 2, 40_000, 2_000, 6), ("backfill", "gpt-6-luna", 900, 1_400_000, 100_000, 300)])
    XCTAssertEqual(UsageStatus.breakdown(d), [
      "채팅 1,020원 (52만 토큰) · 메일 요약 45원 (3.1만 토큰) · 수집(추출) 120원 (80만 토큰) · 검색 색인(임베딩) 49원 (27만 토큰)",
      "월 예산 밖: 과거 메일 가져오기 300원 (150만 토큰) · 이미지 읽기 6원 (4.2만 토큰)",
      UsageStatus.footnote])
    XCTAssertEqual(UsageStatus.footnote, "토큰 수 × 공식 단가 × 환율로 계산한 금액이에요(실제 청구와 조금 다를 수 있어요)")
  }
  func testZeroCallsHiddenUnknownKindIgnoredEmptyArrayNoLines() {
    XCTAssertEqual(UsageStatus.breakdown(rows([("chat", "gpt-6-luna", 0, 0, 0, 0), ("future_kind", "m", 5, 10, 1, 1)])), [])
    XCTAssertEqual(UsageStatus.breakdown(Data("[]".utf8)), [])
    XCTAssertEqual(UsageStatus.breakdown(rows([("vision", "gpt-6-luna", 1, 4_000, 100, 0.3)])), ["월 예산 밖: 이미지 읽기 1원 미만 (4,100토큰)", UsageStatus.footnote])
  }
  // 옛 서버(0032 전 404 본문)·모양 오류 → nil(합계만 — 0.14.x 화면)
  func testMalformedIsNil() {
    XCTAssertNil(UsageStatus.breakdown(Data(#"{"code":"PGRST202","message":"Could not find the function"}"#.utf8)))
    XCTAssertNil(UsageStatus.breakdown(Data(#"[{"kind":"chat","calls":"1"}]"#.utf8)))
    XCTAssertNil(UsageStatus.breakdown(Data("x".utf8)))
  }
}
