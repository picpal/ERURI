import Vision
import Foundation

public enum OCR {
  public static func recognize(imageURL: URL) async throws -> String {
    let req = VNRecognizeTextRequest()
    req.recognitionLanguages = ["ko-KR", "en-US"]
    req.recognitionLevel = .accurate
    try VNImageRequestHandler(url: imageURL).perform([req])
    return (req.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
  }
}
