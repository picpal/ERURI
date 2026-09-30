import XCTest
import UniformTypeIdentifiers
@testable import EruriCore

/// 공유 한 번에 들어온 텍스트 조각들(attributedContentText·첨부 plain-text·URL)을 큐 항목 하나의 본문으로 합친다.
/// 실기기 0.3.0: 메모 앱 공유에서 첨부 하나만 읽어 본문이 10자로 잘렸다(2026-09-30).
final class ShareTextTests: XCTestCase {
  let body = "[합성] 공유 테스트 — 10월 20일 오후 2시 합성 미팅"

  func testShortPieceContainedInLongerIsDropped() {
    XCTAssertEqual(ShareText.compose(["[합성] 공유", body])?.text, body)
    XCTAssertEqual(ShareText.compose([body, "합성 미팅"])?.text, body)
  }

  func testDistinctPiecesJoinedInOrder() {
    XCTAssertEqual(ShareText.compose(["합성 회의록", body])?.text, "합성 회의록\n\(body)")
  }

  func testURLNotInTextIsAppended() {
    XCTAssertEqual(ShareText.compose([body, "https://example.com/a"])?.text, "\(body)\nhttps://example.com/a")
    XCTAssertEqual(ShareText.compose(["보기 https://example.com/a", "https://example.com/a"])?.text, "보기 https://example.com/a")
  }

  func testTrimsAndDropsEmptyAndDuplicates() {
    XCTAssertEqual(ShareText.compose(["  \(body)\n", "", "   ", body]), .init(text: body, truncated: false))
    XCTAssertNil(ShareText.compose([]))
    XCTAssertNil(ShareText.compose(["", " \n"]))
  }

  func testIdenticalPiecesKeptOnce() {
    XCTAssertEqual(ShareText.compose(["합성 A", "합성 A", "합성 B"])?.text, "합성 A\n합성 B")
  }

  func testLongerPieceTakesPlaceOfContainedOnes() {
    XCTAssertEqual(ShareText.compose(["합성 A", "합성 X", "합성 A 전체"])?.text, "합성 A 전체\n합성 X")
    XCTAssertEqual(ShareText.compose(["A1", "A2", "A1 A2"])?.text, "A1 A2")
  }

  func testLoadedValueKinds() throws {
    XCTAssertEqual(ShareText.load("합성"), .init(text: "합성", truncated: false))
    XCTAssertEqual(ShareText.load(NSAttributedString(string: body))?.text, body)
    XCTAssertEqual(ShareText.load(Data(body.utf8))?.text, body)
    XCTAssertEqual(ShareText.load(URL(string: "https://example.com/a")!)?.text, "https://example.com/a")
    let f = try tempFile(body)
    defer { try? FileManager.default.removeItem(at: f) }
    XCTAssertEqual(ShareText.load(f), .init(text: body, truncated: false))
    XCTAssertNil(ShareText.load(nil))
    XCTAssertNil(ShareText.load(3))
  }

  // 리뷰 Important 1: plain-text 파일·Data 를 통째로 읽으면 확장 메모리 한도(약 120MB)에 걸린다 → 읽기 전에 상한
  func testLoadCapsFileAndDataBeforeReading() throws {
    let big = String(repeating: "합성가", count: 1000)   // 9,000 B
    let f = try tempFile(big)
    defer { try? FileManager.default.removeItem(at: f) }
    let fromFile = try XCTUnwrap(ShareText.load(f, maxBytes: 100))
    XCTAssertTrue(fromFile.truncated)
    XCTAssertEqual(fromFile.text, String(big.prefix(33)))   // 한글 3B: 100B → 33자(글자 중간에서 자르지 않는다)
    let fromData = try XCTUnwrap(ShareText.load(Data(big.utf8), maxBytes: 100))
    XCTAssertEqual(fromData, .init(text: String(big.prefix(33)), truncated: true))
    let fromString = try XCTUnwrap(ShareText.load(big, maxBytes: 100))
    XCTAssertEqual(fromString, .init(text: String(big.prefix(33)), truncated: true))
    XCTAssertEqual(ShareText.load(Data("합성".utf8), maxBytes: 6), .init(text: "합성", truncated: false))   // 경계 정확히: 자르지 않음
    XCTAssertEqual(ShareText.maxBytes, 65_536)
  }

  func testComposeCapsResultChars() throws {
    let a = String(repeating: "가", count: 80), b = String(repeating: "나", count: 80)
    let out = try XCTUnwrap(ShareText.compose([a, b], maxChars: 100))
    XCTAssertEqual(out.text.count, 100)
    XCTAssertTrue(out.truncated)
    XCTAssertEqual(ShareText.compose([a], maxChars: 100), .init(text: a, truncated: false))
    XCTAssertEqual(ShareText.maxChars, 65_536)
  }

  // 리뷰 Important 2: 서버 trace 는 문자열을 200자에서 자른다 → public.* 를 먼저, 접두는 줄이고, 통째로 들어가는 id 만
  func testUTIFieldPutsPublicFirstAbbreviatedWithin200() {
    XCTAssertEqual(ShareText.utiField(["com.apple.notes.richtext", "public.plain-text", "public.rtf", "public.plain-text"]),
                   "p.plain-text,p.rtf,ca.notes.richtext")
    let many = (0..<40).map { "com.apple.synthetic-type-\($0)" } + ["public.html", "public.utf8-plain-text"]
    let v = ShareText.utiField(many)
    XCTAssertLessThanOrEqual(v.count, 200)
    XCTAssertTrue(v.hasPrefix("p.html,p.utf8-plain-text,ca."))
    XCTAssertTrue(v.hasSuffix(",+\(40 - v.split(separator: ",").count + 3)"))   // 앞 2개 public + 들어간 ca.* + "+N"
  }

  @MainActor func testCollectMergesAttributedTextAndAttachmentPieces() async throws {
    let item = NSExtensionItem()
    item.attributedContentText = NSAttributedString(string: body)
    let p = NSItemProvider(item: "[합성] 공유" as NSString, typeIdentifier: UTType.plainText.identifier)
    item.attachments = [p]
    let c = await ShareText.collect([item])
    XCTAssertEqual(c.parts, ["act:\(body.count)", "a0:7"])
    XCTAssertEqual(ShareText.compose(c.pieces)?.text, body)
    XCTAssertEqual(c.fields(truncatedOutput: false)["utis_a0"] as? String, "p.plain-text")
    XCTAssertEqual(c.fields(truncatedOutput: false)["parts"] as? String, "act:\(body.count),a0:7")
  }

  // 리뷰 Minor 1: plain-text 로드가 실패해도 같은 첨부의 URL 은 읽는다
  @MainActor func testCollectKeepsURLWhenPlainTextLoadFails() async throws {
    struct Boom: Error {}
    let p = NSItemProvider()
    p.registerItem(forTypeIdentifier: UTType.plainText.identifier) { done, _, _ in done?(nil, Boom()) }
    p.registerItem(forTypeIdentifier: UTType.url.identifier) { done, _, _ in done?(URL(string: "https://example.com/a")! as NSURL, nil) }
    let item = NSExtensionItem(); item.attachments = [p]
    let c = await ShareText.collect([item])
    XCTAssertEqual(c.pieces, ["https://example.com/a"])
    XCTAssertTrue(c.parts.first?.hasPrefix("a0:error:") == true, "\(c.parts)")
    XCTAssertEqual(c.parts.last, "u0:21")
  }

  @MainActor func testCollectMarksTruncatedPartsAndOutput() async throws {
    let f = try tempFile(String(repeating: "a", count: 500))
    defer { try? FileManager.default.removeItem(at: f) }
    let p = NSItemProvider(item: f as NSURL, typeIdentifier: UTType.plainText.identifier)
    let item = NSExtensionItem(); item.attachments = [p]
    let c = await ShareText.collect([item], maxBytes: 100)
    XCTAssertEqual(c.parts, ["a0:100:truncated"])
    XCTAssertEqual(c.fields(truncatedOutput: true)["parts"] as? String, "a0:100:truncated,out:truncated")
  }

  func testUTIFieldsBeyondLimitAreCounted() {
    var c = ShareText.Collected()
    c.utis = (0..<10).map { "p.t\($0)" }
    let f = c.fields(truncatedOutput: false)
    XCTAssertEqual(f["utis_a7"] as? String, "p.t7")
    XCTAssertNil(f["utis_a8"])
    XCTAssertEqual(f["utis_more"] as? Int, 2)
  }

  // 리뷰 Minor 2: kind 는 합친 본문이 웹 주소 하나뿐일 때만 url
  func testWebURLKind() {
    XCTAssertTrue(ShareText.isWebURL("https://example.com/a?b=1"))
    XCTAssertFalse(ShareText.isWebURL("보기 https://example.com/a"))
    XCTAssertFalse(ShareText.isWebURL(body))
    XCTAssertFalse(ShareText.isWebURL("file:///tmp/a.txt"))
  }

  private func tempFile(_ s: String) throws -> URL {
    let f = FileManager.default.temporaryDirectory.appendingPathComponent("share-\(UUID().uuidString).txt")
    try s.write(to: f, atomically: true, encoding: .utf8)
    return f
  }
}
