import Vision
import Foundation
import UIKit
import ImageIO

public enum OCR {
  public static func recognize(imageURL: URL) async throws -> String {
    let req = VNRecognizeTextRequest()
    req.recognitionLanguages = ["ko-KR", "en-US"]
    req.recognitionLevel = .accurate
    try VNImageRequestHandler(url: imageURL).perform([req])
    return (req.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
  }

  /// 링크 화면 스냅샷(스펙 §6 "이미지 전용 페이지"). Vision 은 메인 밖에서 돈다. 한국어는 accurate 에서만(F17)
  public static func recognize(image: UIImage) async throws -> String {
    guard let cg = image.cgImage else { return "" }
    let box = Image(cg: cg)
    return try await Task.detached(priority: .userInitiated) { try recognize(cgImage: box.cg) }.value
  }

  /// 공유·채팅 사진(스펙 §6 "사진 OCR", LI2): ImageIO 축소본(긴 변 maxPixel, EXIF 방향 반영)만 풀어 읽는다 —
  /// 48MP 원본을 통째로 풀지 않는다(확장 메모리, U10). 이미지가 아니면 빈 글
  public static func recognize(data: Data, maxPixel: Int = 2048) async throws -> String {
    guard let cg = thumbnail(data, maxPixel: maxPixel) else { return "" }
    let box = Image(cg: cg)
    return try await Task.detached(priority: .userInitiated) { try recognize(cgImage: box.cg) }.value
  }

  /// 긴 변 maxPixel 이하 축소본(원본이 더 작으면 원본 크기). kCGImageSourceCreateThumbnailWithTransform 이 EXIF 방향을 픽셀에 반영한다
  static func thumbnail(_ data: Data, maxPixel: Int) -> CGImage? {
    guard let src = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
    let opts: [CFString: Any] = [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceCreateThumbnailWithTransform: true,
                                 kCGImageSourceThumbnailMaxPixelSize: maxPixel, kCGImageSourceShouldCacheImmediately: true]
    return CGImageSourceCreateThumbnailAtIndex(src, 0, opts as CFDictionary)
  }

  /// 불변 이미지를 메인 밖으로 넘긴다(U9 — CGImage 의 Sendable 표기를 기대지 않는다)
  struct Image: @unchecked Sendable { let cg: CGImage }

  static func recognize(cgImage: CGImage) throws -> String {
    let req = VNRecognizeTextRequest()
    req.recognitionLanguages = ["ko-KR", "en-US"]
    req.recognitionLevel = .accurate
    try VNImageRequestHandler(cgImage: cgImage).perform([req])
    return (req.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
  }
}
