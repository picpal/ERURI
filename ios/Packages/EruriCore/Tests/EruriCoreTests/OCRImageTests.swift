import XCTest
import UIKit
import ImageIO
import UniformTypeIdentifiers
@testable import EruriCore

/// 사진 OCR(스펙 §6 "사진 OCR", LI2·LI4): ImageIO 축소·EXIF 방향, 공유 첨부 한 장씩 OCR. 그림은 테스트 안에서 그린다(합성)
final class OCRImageTests: XCTestCase {
  @MainActor private func card(_ lines: [String], size: CGSize = CGSize(width: 480, height: 200)) -> UIImage {
    let fmt = UIGraphicsImageRendererFormat()
    fmt.scale = 1
    return UIGraphicsImageRenderer(size: size, format: fmt).image { _ in
      UIColor.white.setFill(); UIRectFill(CGRect(origin: .zero, size: size))
      for (i, l) in lines.enumerated() {
        (l as NSString).draw(at: CGPoint(x: 20, y: CGFloat(40 + i * 60)),
                             withAttributes: [.font: UIFont.boldSystemFont(ofSize: 34), .foregroundColor: UIColor.black])
      }
    }
  }

  /// 저장 픽셀은 반시계 90°(200×480) + EXIF 방향 6(오른쪽) — 시계 90° 돌려 보여야 바로 서는 사진(세로로 찍은 폰 사진과 같은 모양)
  @MainActor private func rotatedJPEG(_ lines: [String]) throws -> Data {
    let upright = card(lines)
    let fmt = UIGraphicsImageRendererFormat()
    fmt.scale = 1
    let rotated = UIGraphicsImageRenderer(size: CGSize(width: 200, height: 480), format: fmt).image { ctx in
      ctx.cgContext.translateBy(x: 0, y: 480)
      ctx.cgContext.rotate(by: -.pi / 2)
      upright.draw(in: CGRect(x: 0, y: 0, width: 480, height: 200))
    }
    let data = NSMutableData()
    let dest = try XCTUnwrap(CGImageDestinationCreateWithData(data, UTType.jpeg.identifier as CFString, 1, nil))
    CGImageDestinationAddImage(dest, try XCTUnwrap(rotated.cgImage), [kCGImagePropertyOrientation: 6] as CFDictionary)
    XCTAssertTrue(CGImageDestinationFinalize(dest))
    return data as Data
  }

  /// 축소본은 EXIF 방향을 반영해 가로(480×200)로 서고, maxPixel 을 넘지 않는다(Vision 없이 판정)
  @MainActor func testThumbnailAppliesOrientationAndLimit() throws {
    let d = try rotatedJPEG(["2026년 12월 5일 토요일"])
    let full = try XCTUnwrap(OCR.thumbnail(d, maxPixel: 2048))
    XCTAssertGreaterThan(full.width, full.height)
    let small = try XCTUnwrap(OCR.thumbnail(d, maxPixel: 240))
    XCTAssertLessThanOrEqual(max(small.width, small.height), 240)
    XCTAssertNil(OCR.thumbnail(Data("not an image".utf8), maxPixel: 2048))
  }

  /// 돌아간 사진도 읽는다(기존 VNImageRequestHandler(cgImage:) 는 방향을 모른다)
  @MainActor func testRecognizeDataReadsRotatedPhoto() async throws {
    let t = try await OCR.recognize(data: try rotatedJPEG(["2026년 12월 5일 토요일", "합성 컨벤션 웨딩홀"]))
    if t.isEmpty { throw XCTSkip("U4: 시뮬레이터 Vision 한국어 결과 없음 — LNK-device D6 에서 판정") }
    XCTAssertTrue(LinkText.hasDateCandidate(t), "OCR 글자 수 \(t.count)")
  }

  /// 공유 첨부(사진 앱처럼 NSItemProvider)에서 앞의 3장만, 한 장씩 메모리로 읽는다 — 파일을 만들지 않는다
  @MainActor func testShareImagesReadsUpToThree() async throws {
    let item = NSExtensionItem()
    item.attachments = try (1...4).map { n in
      let png = try XCTUnwrap(card(["2026년 12월 \(n)일 토요일"]).pngData())
      return NSItemProvider(item: png as NSData, typeIdentifier: UTType.png.identifier)
    }
    XCTAssertEqual(ShareImages.count([item]), 4)
    let r = await ShareImages.ocr([item])
    XCTAssertEqual(r.images, 3)
    XCTAssertEqual(r.texts.count, 3)
    if r.texts.allSatisfy(\.isEmpty) { throw XCTSkip("U4: 시뮬레이터 Vision 한국어 결과 없음 — 장 수만 판정") }
    XCTAssertTrue(r.texts.contains { LinkText.hasDateCandidate($0) })
  }
}
