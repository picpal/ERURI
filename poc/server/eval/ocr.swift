// 기기 OCR 대역(PoC-8 서버 부분): Share Extension(Task 7)과 같은 Vision 텍스트 인식(ko-KR, accurate)으로
// eval/images의 합성 파일에서 OCR 텍스트를 만든다. 텍스트 PDF는 PDFKit 문자열. 출력 images/ocr.json
// 사용: swift eval/ocr.swift
import Foundation
import PDFKit
import Vision

let dir = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "eval/images")
func ocr(_ name: String) throws -> String {
  let req = VNRecognizeTextRequest()
  req.recognitionLevel = .accurate
  req.recognitionLanguages = ["ko-KR", "en-US"]
  req.usesLanguageCorrection = true
  try VNImageRequestHandler(url: dir.appendingPathComponent(name)).perform([req])
  return (req.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
}
var out: [String: String] = [:]
for n in ["01-formal.png", "02-mobile-slash.png", "03-mobile-noon.png", "04-event-dot.png", "05-lunar.png"] { out[n] = try ocr(n) }
out["06-notice.pdf"] = PDFDocument(url: dir.appendingPathComponent("06-notice.pdf"))?.string ?? ""
out["07-scan.pdf"] = try ocr("07-scan-p1.png") + "\n" + ocr("07-scan-p2.png")
let data = try JSONSerialization.data(withJSONObject: out, options: [.prettyPrinted, .sortedKeys])
try data.write(to: dir.appendingPathComponent("ocr.json"))
for (k, v) in out.sorted(by: { $0.key < $1.key }) { print(k, v.count) }
