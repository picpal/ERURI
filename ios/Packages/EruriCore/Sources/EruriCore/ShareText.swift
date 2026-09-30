import Foundation
import UniformTypeIdentifiers

/// Share Extension 입력 한 번(여러 NSExtensionItem·첨부)을 큐 항목 하나의 본문으로 만든다.
/// 호스트 앱은 같은 내용을 여러 표현으로 넘긴다(attributedContentText, 첨부 plain-text, URL). 첨부 하나만 읽으면
/// 제목·일부만 들어온다(실기기 0.3.0 메모 앱: 33자 문장이 10자로, 2026-09-30).
public enum ShareText {
  /// 표현 하나를 읽는 상한(UTF-8 바이트, 스펙 §6). plain-text 파일(.txt·.log)을 통째로 읽으면 확장 메모리 한도(약 120MB)에 걸린다
  public static let maxBytes = 64 * 1024
  /// 합친 본문 상한(글자, 스펙 §6)
  public static let maxChars = 64 * 1024
  /// 첨부별 utis 진단 필드 수(`utis_a0`…). 서버 trace fields 4096B 안에 들도록
  public static let maxUTIFields = 8

  public struct Loaded: Equatable, Sendable {
    public let text: String, truncated: Bool
    public init(text: String, truncated: Bool) { self.text = text; self.truncated = truncated }
  }
  public typealias Composed = Loaded

  /// 조각을 다듬고(앞뒤 공백 제거·빈 조각 제거) 다른 조각에 포함된 조각은 버린 뒤 처음 나온 순서대로 줄바꿈으로 잇는다.
  /// 결과는 `maxChars` 글자에서 자른다. 남는 게 없으면 nil.
  public static func compose(_ pieces: [String], maxChars: Int = maxChars) -> Composed? {
    var kept: [String] = [], truncated = false
    for raw in pieces {
      var p = raw.trimmingCharacters(in: .whitespacesAndNewlines)
      if p.isEmpty { continue }
      if p.count > maxChars { p = String(p.prefix(maxChars)); truncated = true }   // 포함 비교 비용도 상한 안으로
      if kept.contains(where: { $0.contains(p) }) { continue }   // 같은 조각·포함된 조각
      // 새 조각이 기존 조각을 품으면 첫 자리를 대신하고 나머지는 버린다
      if let i = kept.firstIndex(where: { p.contains($0) }) { kept[i] = p; kept = kept.enumerated().filter { $0.offset == i || !p.contains($0.element) }.map(\.element) }
      else { kept.append(p) }
    }
    if kept.isEmpty { return nil }
    var text = kept.joined(separator: "\n")
    if text.count > maxChars { text = String(text.prefix(maxChars)); truncated = true }
    return Composed(text: text, truncated: truncated)
  }

  /// `loadItem(forTypeIdentifier:)` 결과를 문자열로. 호스트에 따라 String 외에 Data(UTF-8)·NSAttributedString·파일 URL(.txt)로 온다.
  /// 파일이 아닌 URL 은 주소 문자열로 쓴다. 파일·Data 는 앞 `maxBytes` 만 읽고(글자 중간에서 자르지 않는다) truncated 로 표시한다.
  public static func load(_ v: Any?, maxBytes: Int = maxBytes) -> Loaded? {
    switch v {
    case let s as String: return capped(s, maxBytes)
    case let a as NSAttributedString: return capped(a.string, maxBytes)
    case let d as Data: return decode(d, maxBytes)
    case let u as URL:
      guard u.isFileURL else { return capped(u.absoluteString, maxBytes) }
      guard let h = try? FileHandle(forReadingFrom: u) else { return nil }
      defer { try? h.close() }
      guard let d = try? h.read(upToCount: maxBytes + 1) else { return nil }   // 한 바이트 더 읽어 초과 여부만 안다. 빈 파일은 nil(EOF)
      return decode(d, maxBytes)
    default: return nil
    }
  }

  private static func capped(_ s: String, _ maxBytes: Int) -> Loaded? {
    s.utf8.count <= maxBytes ? Loaded(text: s, truncated: false) : decode(Data(s.utf8.prefix(maxBytes + 1)), maxBytes)
  }

  /// UTF-8 로 읽는다. `maxBytes` 를 넘으면 앞부분에서 완전한 글자까지만(최대 3바이트 물러남).
  private static func decode(_ d: Data, _ maxBytes: Int) -> Loaded? {
    guard d.count > maxBytes else { return String(data: d, encoding: .utf8).map { Loaded(text: $0, truncated: false) } }
    let head = d.prefix(maxBytes)
    for back in 0...3 where back < head.count {
      if let s = String(data: head.dropLast(back), encoding: .utf8) { return Loaded(text: s, truncated: true) }
    }
    return nil
  }

  /// 첨부 하나가 등록한 형식 목록을 진단 문자열로. 서버 trace 는 문자열을 200자에서 자르므로 판단에 필요한 `public.*` 를 먼저,
  /// 접두는 줄이고(`public.`→`p.`, `com.apple.`→`ca.`), 200자 안에 통째로 들어가는 id 만 넣은 뒤 빠진 수를 `+N` 으로 붙인다.
  public static func utiField(_ ids: [String], limit: Int = 200) -> String {
    let uniq = Array(Set(ids))
    let ordered = uniq.filter { $0.hasPrefix("public.") }.sorted() + uniq.filter { !$0.hasPrefix("public.") }.sorted()
    let short = ordered.map { id -> String in
      if id.hasPrefix("public.") { return "p." + id.dropFirst(7) }
      if id.hasPrefix("com.apple.") { return "ca." + id.dropFirst(10) }
      return id
    }
    var out: [String] = [], len = 0
    for (i, s) in short.enumerated() {
      let rest = short.count - i - 1
      let tail = rest > 0 ? ",+\(rest)".count : 0   // 이 id 를 넣고도 뒤에 붙일 "+N" 자리가 남아야 한다
      if len + (out.isEmpty ? 0 : 1) + s.count + tail > limit {
        out.append("+\(short.count - i)"); break
      }
      len += (out.isEmpty ? 0 : 1) + s.count; out.append(s)
    }
    return out.joined(separator: ",")
  }

  /// 합친 본문이 웹 주소 하나뿐인가. trace·로그의 type(text|url) 판정용
  public static func isWebURL(_ s: String) -> Bool {
    let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !t.isEmpty, t.rangeOfCharacter(from: .whitespacesAndNewlines) == nil,
          let u = URL(string: t), let scheme = u.scheme?.lowercased() else { return false }
    return (scheme == "http" || scheme == "https") && u.host != nil
  }

  /// 공유 1회에서 모은 텍스트 조각과 진단 값(본문 없음).
  public struct Collected: Sendable {
    public var pieces: [String] = []
    /// 조각별 "출처:길이[:truncated]"(act = attributedContentText, aN = N번째 첨부 plain-text, uN = N번째 첨부 URL), 실패는 ":nil"·":error:<타입>"
    public var parts: [String] = []
    /// 첨부별 `utiField` 값
    public var utis: [String] = []
    public init() {}

    mutating func add(_ l: Loaded?, _ tag: String) {
      guard let l else { parts.append("\(tag):nil"); return }
      pieces.append(l.text); parts.append("\(tag):\(l.text.count)" + (l.truncated ? ":truncated" : ""))
    }

    /// share.received trace 에 합칠 진단 필드. 합친 본문이 잘렸으면 parts 끝에 `out:truncated`
    public func fields(truncatedOutput: Bool) -> [String: Any] {
      var f: [String: Any] = ["parts": (parts + (truncatedOutput ? ["out:truncated"] : [])).joined(separator: ",")]
      for (i, u) in utis.prefix(ShareText.maxUTIFields).enumerated() { f["utis_a\(i)"] = u }
      if utis.count > ShareText.maxUTIFields { f["utis_more"] = utis.count - ShareText.maxUTIFields }
      return f
    }
  }

  /// 모든 아이템의 attributedContentText 와 모든 첨부의 plain-text·URL 을 모은다. 표현마다 따로 시도해 하나가 실패해도 나머지는 읽는다.
  @MainActor public static func collect(_ items: [NSExtensionItem], maxBytes: Int = maxBytes) async -> Collected {
    var c = Collected(), n = 0
    for item in items {
      if let a = item.attributedContentText, !a.string.isEmpty { c.add(load(a, maxBytes: maxBytes), "act") }
      for p in item.attachments ?? [] {
        defer { n += 1 }
        c.utis.append(utiField(p.registeredTypeIdentifiers))
        if p.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
          do { c.add(load(try await p.loadItem(forTypeIdentifier: UTType.plainText.identifier), maxBytes: maxBytes), "a\(n)") }
          catch { DiagLog.append("ShareExtension error \(type(of: error))"); c.parts.append("a\(n):error:\(type(of: error))") }
        }
        if p.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
          do {
            let url = try await p.loadItem(forTypeIdentifier: UTType.url.identifier) as? URL
            c.add(url.flatMap { capped($0.absoluteString, maxBytes) }, "u\(n)")
          } catch { DiagLog.append("ShareExtension error \(type(of: error))"); c.parts.append("u\(n):error:\(type(of: error))") }
        }
      }
    }
    return c
  }
}
