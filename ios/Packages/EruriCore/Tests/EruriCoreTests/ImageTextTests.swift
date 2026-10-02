import XCTest
@testable import EruriCore

/// 사진 → 일정(스펙 §6 "링크·이미지 읽기", LI1): 사진마다의 OCR 글을 한 항목 본문으로. 글은 모두 합성
final class ImageTextTests: XCTestCase {
  func testComposeFormat() {
    let c = ImageText.compose(ocr: ["합성동훈 그리고 합성미래\n2026년 12월 19일 토요일 오후 3시", "합성웨딩홀 5층\n2026년 12월 19일 토요일 오후 3시"],
                              images: 2, note: " 청첩장 \n 사진 ")
    XCTAssertEqual(c, .text("""
      [이미지] 사진 2장
      메모: 청첩장 사진
      이미지 속 글자:
      합성동훈 그리고 합성미래
      2026년 12월 19일 토요일 오후 3시
      합성웨딩홀 5층
      """, truncated: false))
  }

  /// 글자가 없는 사진(공백 제외 10자 미만)은 empty — 큐에 넣지 않는다
  func testEmpty() {
    XCTAssertEqual(ImageText.compose(ocr: [], images: 1, note: nil), .empty)
    XCTAssertEqual(ImageText.compose(ocr: ["", "  가 나 "], images: 2, note: "청첩장"), .empty)
  }

  /// 긴 OCR(캡처 여러 장): 일시·장소 줄을 앞에(게이트 2,000자, F23), 전체 4,000자
  func testKeyLinesFirstWhenLong() throws {
    let filler = (1...300).map { "합성 갤러리 사진 설명 \($0)번" }.joined(separator: "\n")
    guard case .text(let t, let truncated) = ImageText.compose(ocr: [filler, "예식 2027년 1월 9일 오후 5시"], images: 2, note: nil) else {
      return XCTFail("empty")
    }
    XCTAssertTrue(truncated)
    XCTAssertLessThanOrEqual(t.count, LinkText.maxChars)
    XCTAssertTrue(t.hasPrefix("[이미지] 사진 2장\n일시·장소 줄:\n예식 2027년 1월 9일 오후 5시\n이미지 속 글자:\n합성 갤러리 사진 설명 1번\n"))
  }
}
