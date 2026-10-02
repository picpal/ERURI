import Foundation

/// 사진 → 일정(스펙 §6 "링크·이미지 읽기", 2026-10-02 사용자 결정): 기기 OCR 글만 SHARE 항목(`app_name = "이미지"`)으로 보낸다.
/// 사진 파일·축소본은 어디에도 저장하지 않는다(OCR 은 `OCR.recognize(data:maxPixel:)`, 흐름은 `ImageFlow`)
public enum ImageText {
  /// 서버 `items.app_name` 표식(source 는 SHARE 그대로 — 새 source 없음)
  public static let appName = "이미지"
  /// 한 번에 읽는 최대 장 수(넘는 장은 버린다)
  public static let maxImages = 3
  /// OCR 글이 합쳐 이보다 적으면(공백 제외) 글자가 없는 사진으로 본다
  public static let minChars = 10
  static let ocrHeader = "이미지 속 글자:"

  public enum Composed: Equatable, Sendable { case text(String, truncated: Bool), empty }

  /// 사진마다의 OCR 글 → 큐 항목 본문(스펙 §6 "보내는 글(사진)"). images = 읽은 장 수(글자가 없던 장 포함).
  /// 줄은 공백 정리·같은 줄 제거, 넘치면 일시·장소 줄을 앞에(LinkText.fit — 게이트 2,000자), 전체 4,000자
  public static func compose(ocr: [String], images: Int, note: String?) -> Composed {
    let ls = LinkText.lines(ocr.joined(separator: "\n"))
    guard ls.joined().filter({ !$0.isWhitespace }).count >= minChars else { return .empty }
    var head = ["[이미지] 사진 \(images)장"]
    if let n = note.map({ LinkText.clip(LinkText.oneLine($0), LinkText.noteMaxChars) }), !n.isEmpty { head.append("메모: \(n)") }
    let headText = head.joined(separator: "\n")
    let bodyHeader = "\n" + ocrHeader + "\n"
    let f = LinkText.fit(ls, budget: LinkText.maxChars - headText.count - bodyHeader.count)
    let keys = f.keys.isEmpty ? "" : "\n" + LinkText.keyHeader + "\n" + f.keys
    return .text(LinkText.clip(headText + keys + bodyHeader + f.body, LinkText.maxChars), truncated: f.truncated)
  }
}
