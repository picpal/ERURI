import XCTest
@testable import EruriCore

/// 공유 한 번에 들어온 텍스트 조각들(attributedContentText·첨부 plain-text·URL)을 큐 항목 하나의 본문으로 합친다.
/// 실기기 0.3.0: 메모 앱 공유에서 첨부 하나만 읽어 본문이 10자로 잘렸다(2026-09-30).
final class ShareTextTests: XCTestCase {
  let body = "[합성] 공유 테스트 — 10월 20일 오후 2시 합성 미팅"

  func testShortPieceContainedInLongerIsDropped() {
    XCTAssertEqual(ShareText.compose(["[합성] 공유", body]), body)
    XCTAssertEqual(ShareText.compose([body, "합성 미팅"]), body)
  }

  func testDistinctPiecesJoinedInOrder() {
    XCTAssertEqual(ShareText.compose(["합성 회의록", body]), "합성 회의록\n\(body)")
  }

  func testURLNotInTextIsAppended() {
    XCTAssertEqual(ShareText.compose([body, "https://example.com/a"]), "\(body)\nhttps://example.com/a")
    XCTAssertEqual(ShareText.compose(["보기 https://example.com/a", "https://example.com/a"]), "보기 https://example.com/a")
  }

  func testTrimsAndDropsEmptyAndDuplicates() {
    XCTAssertEqual(ShareText.compose(["  \(body)\n", "", "   ", body]), body)
    XCTAssertNil(ShareText.compose([]))
    XCTAssertNil(ShareText.compose(["", " \n"]))
  }

  func testIdenticalPiecesKeptOnce() {
    XCTAssertEqual(ShareText.compose(["합성 A", "합성 A", "합성 B"]), "합성 A\n합성 B")
  }

  func testLongerPieceTakesPlaceOfContainedOnes() {
    XCTAssertEqual(ShareText.compose(["합성 A", "합성 X", "합성 A 전체"]), "합성 A 전체\n합성 X")
    XCTAssertEqual(ShareText.compose(["A1", "A2", "A1 A2"]), "A1 A2")
  }

  func testLoadedValueKinds() throws {
    XCTAssertEqual(ShareText.string(fromLoaded: "합성"), "합성")
    XCTAssertEqual(ShareText.string(fromLoaded: NSAttributedString(string: body)), body)
    XCTAssertEqual(ShareText.string(fromLoaded: Data(body.utf8)), body)
    XCTAssertEqual(ShareText.string(fromLoaded: URL(string: "https://example.com/a")!), "https://example.com/a")
    let f = FileManager.default.temporaryDirectory.appendingPathComponent("share-\(UUID().uuidString).txt")
    try body.write(to: f, atomically: true, encoding: .utf8)
    defer { try? FileManager.default.removeItem(at: f) }
    XCTAssertEqual(ShareText.string(fromLoaded: f), body)
    XCTAssertNil(ShareText.string(fromLoaded: nil))
    XCTAssertNil(ShareText.string(fromLoaded: 3))
  }
}
