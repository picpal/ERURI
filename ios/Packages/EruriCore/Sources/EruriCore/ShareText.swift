import Foundation

/// Share Extension 입력 한 번(여러 NSExtensionItem·첨부)을 큐 항목 하나의 본문으로 만든다.
/// 호스트 앱은 같은 내용을 여러 표현으로 넘긴다(attributedContentText, 첨부 plain-text, URL). 첨부 하나만 읽으면
/// 제목·일부만 들어온다(실기기 0.3.0 메모 앱: 33자 문장이 10자로, 2026-09-30).
public enum ShareText {
  /// 조각을 다듬고(앞뒤 공백 제거·빈 조각 제거) 다른 조각에 포함된 조각은 버린 뒤 처음 나온 순서대로 줄바꿈으로 잇는다.
  /// 남는 게 없으면 nil.
  public static func compose(_ pieces: [String]) -> String? {
    var kept: [String] = []
    for p in pieces.map({ $0.trimmingCharacters(in: .whitespacesAndNewlines) }) where !p.isEmpty {
      if kept.contains(where: { $0.contains(p) }) { continue }   // 같은 조각·포함된 조각
      // 새 조각이 기존 조각을 품으면 첫 자리를 대신하고 나머지는 버린다
      if let i = kept.firstIndex(where: { p.contains($0) }) { kept[i] = p; kept = kept.enumerated().filter { $0.offset == i || !p.contains($0.element) }.map(\.element) }
      else { kept.append(p) }
    }
    return kept.isEmpty ? nil : kept.joined(separator: "\n")
  }

  /// `loadItem(forTypeIdentifier: public.plain-text)` 결과를 문자열로. 호스트에 따라 String 외에
  /// Data(UTF-8)·NSAttributedString·파일 URL(.txt)로 온다. 파일이 아닌 URL 은 주소 문자열로 쓴다.
  public static func string(fromLoaded v: Any?) -> String? {
    switch v {
    case let s as String: return s
    case let a as NSAttributedString: return a.string
    case let d as Data: return String(data: d, encoding: .utf8)
    case let u as URL: return u.isFileURL ? (try? String(contentsOf: u, encoding: .utf8)) : u.absoluteString
    default: return nil
    }
  }
}
