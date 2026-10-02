import Foundation
import CryptoKit

/// 링크 → 일정(스펙 §6 "링크·이미지 읽기", 2026-10-02 사용자 결정 방식 A): 기기가 렌더링해 읽은 글을 SHARE 항목으로 보낸다.
/// 이 파일은 WebKit 없이 테스트하는 부분이다 — 링크 판정·주소 검사·같은 링크 id·날짜 후보·본문 만들기(LinkText), 렌더링 결과(LinkPage), 대기 판정(LinkSettle)
public enum LinkText {
  /// 큐 항목 본문 상한(글자). 서버 추출 입력 상한(`MAX_TEXT_CHARS` 4,000)과 같다 — 모델이 보지 않는 뒷부분은 보내지 않는다
  public static let maxChars = 4000
  /// 본문이 넘칠 때 앞에 따로 두는 일시·장소 줄 몫(글자)
  public static let tailKeyChars = 1000
  public static let ocrMaxChars = 1500
  public static let titleMaxChars = 120
  public static let descMaxChars = 300
  public static let noteMaxChars = 200
  /// 서버 `items.app_name` 표식. source 는 SHARE 그대로(새 source·마이그레이션 없음, 스펙 §8)
  public static let appName = "웹 링크"
  /// 넘칠 때 본문 앞에 두는 블록 머리 — 서버 Jev 게이트가 본문 앞 2,000자만 본다(F23)
  public static let keyHeader = "일시·장소 줄:"

  // MARK: 링크 판정

  private static let detector = try! NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue)

  /// 글 안에서 `http://`·`https://` 로 적힌 주소(호스트 있음)의 모든 자리. 스킴 없는 도메인("naver.com")은 링크가 아니다.
  /// 주소 바로 뒤에 붙은 비 ASCII 글자("…/1이에요")는 주소가 아니다 — 첫 비 ASCII·공백 글자에서 자른다(한글 경로 주소는 링크로 보지 않는 대가).
  /// 끝의 `?`·`:` 도 문장 부호로 본다("…/1?" 가 다른 캡처 id·다른 경로가 되지 않게)
  static func matches(_ text: String) -> [(url: URL, range: NSRange)] {
    let ns = text as NSString
    return detector.matches(in: text, range: NSRange(location: 0, length: ns.length)).compactMap { (m: NSTextCheckingResult) -> (url: URL, range: NSRange)? in
      var scalars = String.UnicodeScalarView()
      for u in ns.substring(with: m.range).unicodeScalars {
        guard u.isASCII, !u.properties.isWhitespace else { break }
        scalars.append(u)
      }
      while let l = scalars.last, l == "?" || l == ":" { scalars.removeLast() }
      let s = String(scalars)
      guard s.lowercased().hasPrefix("http"), let u = URL(string: s), let scheme = u.scheme?.lowercased(),
            scheme == "http" || scheme == "https", u.host() != nil else { return nil }
      return (u, NSRange(location: m.range.location, length: (s as NSString).length))
    }
  }

  /// 나온 순서대로, 같은 주소는 한 번
  public static func webURLs(in text: String) -> [URL] {
    var seen = Set<String>()
    return matches(text).map { $0.url }.filter { seen.insert($0.absoluteString).inserted }
  }

  /// 주소 자리를 모두 지운 나머지 글(한 줄로, 자르지 않음)
  static func rest(_ text: String, removing ranges: [NSRange]) -> String {
    let ns = NSMutableString(string: text)
    for r in ranges.sorted(by: { $0.location > $1.location }) { ns.replaceCharacters(in: r, with: " ") }
    return oneLine(ns as String)
  }

  public enum Candidate: Equatable, Sendable {
    /// 주소 없음
    case none
    /// 주소 1개 + 짧은 메모(200자 이하, 날짜 후보 없음) — 링크 읽기
    case link(URL, note: String?)
    /// 주소 둘 이상
    case tooMany(Int)
    /// 주소 1개지만 나머지 글이 길거나 날짜가 있다 — 지금처럼 글로 다룬다(공유 = 텍스트 항목, 채팅 = 질문)
    case text
  }

  /// 링크 판정(스펙 §6 "입력", D5). 주소가 든 긴 공지·일정 문자를 링크로 바꾸면 본문이 메모로 잘리고 페이지 실패 시 사라진다(Fable F1)
  public static func linkCandidate(_ text: String) -> Candidate {
    let urls = webURLs(in: text)
    switch urls.count {
    case 0: return .none
    case 1:
      let r = rest(text, removing: matches(text).map { $0.range })
      if r.count > noteMaxChars || hasDateCandidate(r) { return .text }
      // 주소를 둘렀던 괄호·따옴표·마침표만 남은 메모("( )")는 없음
      let hasWord = r.unicodeScalars.contains { CharacterSet.alphanumerics.contains($0) }
      return .link(urls[0], note: hasWord ? r : nil)
    default: return .tooMany(urls.count)
    }
  }

  public enum ChatIntent: Equatable, Sendable { case none, link(URL, note: String?), tooMany(Int) }

  /// 채팅 입력(스펙 §9): 링크면 수집(나머지 글은 메모), 둘 이상이면 tooMany, 나머지(주소 없음·긴 글·날짜 있는 글)는 질문(none)
  public static func chatIntent(_ input: String) -> ChatIntent {
    switch linkCandidate(input) {
    case .link(let u, let n): return .link(u, note: n)
    case .tooMany(let k): return .tooMany(k)
    case .none, .text: return .none
    }
  }

  /// 공유 본문(`ShareText.compose` 결과)의 링크(스펙 §6): 링크일 때만. 나머지는 지금처럼 텍스트 공유
  public static func shareLink(_ composed: String) -> (url: URL, note: String?)? {
    guard case .link(let u, let n) = linkCandidate(composed) else { return nil }
    return (u, n)
  }

  // MARK: 주소 검사·https 올리기·같은 링크 id

  public enum Blocked: String, Sendable { case scheme, host }

  /// 기기가 열 주소인가(스펙 §6 "주소 검사"): http(s)만, 사설·루프백·링크로컬·CGNAT IP 리터럴과 로컬 이름을 거부한다.
  /// 서버 SSRF 방어가 아니라 기기 위생(로컬 네트워크 권한 창·내부 기기 접근 회피). allowLoopback = DEBUG 빌드의 시뮬레이터 게이트
  public static func check(_ url: URL, allowLoopback: Bool) -> Blocked? {
    guard let s = url.scheme?.lowercased(), s == "http" || s == "https" else { return .scheme }
    guard var h = url.host(percentEncoded: false)?.lowercased(), !h.isEmpty else { return .host }
    if h.hasPrefix("["), h.hasSuffix("]") { h = String(h.dropFirst().dropLast()) }
    if h == "localhost" || h == "127.0.0.1" || h == "::1" { return allowLoopback ? nil : .host }
    if h.contains(":") { return publicV6(h) ? nil : .host }
    let bare = h.hasSuffix(".") ? String(h.dropLast()) : h
    if let v4 = ipv4(bare) { return publicV4(v4) ? nil : .host }
    // 마지막 라벨이 숫자·0x… 면 WebKit(WHATWG "ends in a number")이 IPv4 로 읽는다("127.1"·"0x7f.0.0.1"·"0177.0.0.1"·"2130706433").
    // 엄격한 10진 4부(위)가 아니면 어느 주소로 풀릴지 따지지 않고 막는다
    if let last = bare.split(separator: ".").last, last.hasPrefix("0x") || last.allSatisfy({ $0.isASCII && $0.isNumber }) { return .host }
    if !bare.contains(".") { return .host }                                       // 점 없는 이름(사내 호스트)
    for suffix in [".local", ".localhost", ".internal", ".home.arpa"] where bare.hasSuffix(suffix) { return .host }
    return nil
  }

  /// http → https(스펙 §6 "주소 검사", F24 — 앱·확장에 ATS 예외가 없어 평문 로드는 막힌다. 예외를 두지 않는다).
  /// DEBUG 시뮬레이터 게이트의 루프백(allowLoopback)만 http 그대로
  public static func upgraded(_ url: URL, allowLoopback: Bool) -> URL {
    guard url.scheme?.lowercased() == "http" else { return url }
    if allowLoopback, let h = url.host(percentEncoded: false)?.lowercased(), h == "localhost" || h == "127.0.0.1" { return url }
    var c = URLComponents(url: url, resolvingAgainstBaseURL: false)
    c?.scheme = "https"
    if c?.port == 80 { c?.port = nil }
    return c?.url ?? url
  }

  /// 같은 링크 = 같은 캡처 id(스펙 §6 "같은 링크", D14): 조각(#…)을 떼고 스킴을 https·호스트를 소문자로 맞춘 주소의 SHA-256 앞 16바이트를
  /// UUID 모양(이름 기반 v5 비트)으로. 큐(INSERT OR IGNORE)·서버 멱등 키(SHARE:<id>)·기기 읽은 링크 기록이 이 값을 쓴다 — 주소 자체는 남기지 않는다
  public static func captureID(for url: URL) -> String {
    var key = url.absoluteString
    if var c = URLComponents(url: url, resolvingAgainstBaseURL: false) {
      c.fragment = nil
      let scheme = c.scheme?.lowercased()
      c.scheme = scheme == "http" ? "https" : scheme
      if c.port == 80 || c.port == 443 { c.port = nil }
      let host = c.percentEncodedHost?.lowercased()
      c.percentEncodedHost = host                                                  // IPv6 괄호를 그대로 둔다
      if c.percentEncodedPath.isEmpty { c.percentEncodedPath = "/" }               // "https://a.example.com" = "…/"
      key = c.string ?? key
    }
    var b = Array(SHA256.hash(data: Data(("link:" + key).utf8)).prefix(16))
    b[6] = (b[6] & 0x0F) | 0x50
    b[8] = (b[8] & 0x3F) | 0x80
    return UUID(uuid: (b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7], b[8], b[9], b[10], b[11], b[12], b[13], b[14], b[15])).uuidString
  }

  /// 엄격한 10진 4부 IPv4. 앞 0("012")은 WebKit 이 8진으로 읽으므로 아니다(check 가 막는다)
  static func ipv4(_ h: String) -> [Int]? {
    let p = h.split(separator: ".", omittingEmptySubsequences: false)
    guard p.count == 4, p.allSatisfy({ part in
      !part.isEmpty && part.count <= 3 && !(part.count > 1 && part.first == "0") && part.allSatisfy { $0.isASCII && $0.isNumber }
    }) else { return nil }
    let n = p.compactMap { Int($0) }
    return n.allSatisfy { (0...255).contains($0) } ? n : nil
  }

  static func publicV4(_ a: [Int]) -> Bool {
    switch (a[0], a[1]) {
    case (0, _), (10, _), (127, _): return false
    case (100, 64...127): return false            // CGNAT
    case (169, 254): return false                 // 링크로컬
    case (172, 16...31): return false
    case (192, 168): return false
    case (192, 0) where a[2] == 0: return false
    case (198, 18...19): return false
    default: return a[0] < 224                    // 멀티캐스트·예약
    }
  }

  /// IPv6 리터럴: 전역 유니캐스트(2000::/3)이고 문서용(2001:db8::/32)·6to4(2002::/16 — 사설 IPv4 를 품을 수 있다)가 아닐 때만
  static func publicV6(_ h: String) -> Bool {
    guard let f = h.first, f == "2" || f == "3" else { return false }
    return !h.hasPrefix("2001:db8") && !h.hasPrefix("2002:")
  }

  // MARK: 날짜 후보·일시 장소 줄

  private static let datePatterns: [NSRegularExpression] = [
    #"\d{1,2}\s*월\s*\d{1,2}\s*일"#,
    #"(?:19|20)\d{2}\s*[.\-/년]\s*\d{1,2}\s*[.\-/월]\s*\d{1,2}"#,
    #"(?<![\d.])\d{1,2}\s{0,3}[./]\s{0,3}\d{1,2}\s{0,3}\.?\s{0,3}\(\s{0,3}[월화수목금토일]"#,   // \s* 는 "1.1" + 긴 공백에서 2차 백트래킹(리뷰 I1)
    #"(?<![\d/.,])\d{1,2}/\d{1,2}(?![\d/])"#,
    #"(?i)\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b\.?\s+\d{1,2}(?!\d)"#,
  ].map { try! NSRegularExpression(pattern: $0) }
  private static let timePattern = try! NSRegularExpression(pattern: #"(?:오전|오후|낮|저녁|밤)\s*\d{1,2}\s*시|(?<!\d)\d{1,2}:\d{2}(?!\d)|(?i)\b(?:am|pm)\s*\d{1,2}"#)
  private static let placeWords = try! NSRegularExpression(pattern: #"일시|장소|예식|식장|웨딩|홀|층|오시는\s*길|주소|위치|시작|입장|개최|행사|시간"#)

  private static func found(_ r: NSRegularExpression, _ s: String) -> Bool {
    r.firstMatch(in: s, range: NSRange(location: 0, length: (s as NSString).length)) != nil
  }

  /// 날짜 후보(스펙 §6 "이미지 전용 페이지"·"입력"): "11월 14일"·"2026.11.14"·"2026-11-14"·"11/14"·"11. 14.(토)"·영문 월 + 일. 시각만은 아니다.
  /// 정리 전 원문(숨은 글 200,000자까지)에도 돌므로 공백을 먼저 접는다 — 패턴의 \s 는 줄바꿈도 받으므로 판정은 같다(리뷰 I1)
  public static func hasDateCandidate(_ s: String) -> Bool {
    let t = oneLine(s)
    return datePatterns.contains { found($0, t) }
  }

  /// 본문에서 앞으로 끌어올릴 줄: 날짜·시각·장소 단어
  static func isKeyLine(_ l: String) -> Bool { hasDateCandidate(l) || found(timePattern, l) || found(placeWords, l) }

  // MARK: 보내는 글

  public struct Composed: Equatable, Sendable {
    /// 큐 항목 제목(서버 items.title). 없으면 nil
    public let title: String?
    public let text: String
    /// 본문 몫에 담은 글자 수(진단)
    public let bodyChars: Int
    public let truncated: Bool
  }

  /// 렌더링 결과 → 큐 항목 본문(스펙 §6 "보내는 글(링크)"). 주소는 호스트만, 넘치면 일시·장소 줄을 본문 앞에, 전체 4,000자
  public static func compose(_ p: LinkPage, note: String?) -> Composed {
    let title = clip(oneLine(p.title), titleMaxChars)
    var head = ["[웹 링크] \(p.host)"]
    if !title.isEmpty { head.append("제목: \(title)") }
    let desc = clip(oneLine(p.description), descMaxChars)
    if !desc.isEmpty, !title.contains(desc) { head.append("설명: \(desc)") }
    if let n = note.map({ clip(oneLine($0), noteMaxChars) }), !n.isEmpty { head.append("메모: \(n)") }
    let headText = head.joined(separator: "\n")
    let ocr = clip(lines(p.ocrText ?? "").joined(separator: "\n"), ocrMaxChars)
    let ocrBlock = ocr.isEmpty ? "" : "\n이미지 속 글자:\n" + ocr
    let bodyHeader = "\n본문:\n"
    let f = fit(lines(p.body), budget: maxChars - headText.count - ocrBlock.count - bodyHeader.count)
    let keyBlock = f.keys.isEmpty ? "" : "\n" + keyHeader + "\n" + f.keys
    let text = headText + keyBlock + (f.body.isEmpty ? "" : bodyHeader + f.body) + ocrBlock
    return Composed(title: title.isEmpty ? nil : title, text: clip(text, maxChars), bodyChars: f.body.count, truncated: f.truncated)
  }

  /// 줄을 budget 안에 담는다. 다 들어가면 keys 없이 그대로. 넘치면 전체 줄에서 일시·장소 줄을 tailKeyChars 안에서 뽑아 keys 로 두고
  /// (호출 쪽이 본문 **앞**에 `keyHeader` 블록으로 놓는다 — 게이트가 앞 2,000자만 본다, F23), keys 블록 몫(머리·줄바꿈 포함)을 뺀 나머지에 앞쪽 줄부터 담는다
  static func fit(_ ls: [String], budget: Int) -> (keys: String, body: String, truncated: Bool) {
    guard budget > 0 else { return ("", "", !ls.isEmpty) }
    let all = ls.joined(separator: "\n")
    if all.count <= budget { return ("", all, false) }
    var keys: [String] = [], keyUsed = 0
    for l in ls where isKeyLine(l) {
      let add = l.count + (keys.isEmpty ? 0 : 1)
      if keyUsed + add > tailKeyChars { continue }                                // 긴 줄은 건너뛰고 다음 줄을 본다
      keys.append(l); keyUsed += add
    }
    let keyText = keys.joined(separator: "\n")
    let bodyBudget = max(0, budget - (keys.isEmpty ? 0 : keyHeader.count + 2 + keyText.count))
    var head: [String] = [], used = 0
    for l in ls {
      let add = l.count + (head.isEmpty ? 0 : 1)
      if used + add > bodyBudget { break }
      head.append(l); used += add
    }
    if head.isEmpty, let first = ls.first, bodyBudget > 0 { head = [String(first.prefix(bodyBudget))] }   // 한 줄이 예산보다 길다
    return (keyText, head.joined(separator: "\n"), true)
  }

  /// 한 줄로: 줄바꿈·연속 공백을 공백 하나로, 앞뒤 공백 제거
  static func oneLine(_ s: String) -> String { s.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ") }
  static func clip(_ s: String, _ n: Int) -> String { s.count <= n ? s : String(s.prefix(n)) }

  /// 줄 단위로 나눠 공백 정리, 빈 줄·이미 나온 줄 제거(메뉴·버튼 글이 여러 번 나온다)
  static func lines(_ s: String) -> [String] {
    var seen = Set<String>(), out: [String] = []
    for raw in s.split(whereSeparator: \.isNewline) {
      let l = oneLine(String(raw))
      if !l.isEmpty, seen.insert(l).inserted { out.append(l) }
    }
    return out
  }
}

/// 렌더링 결과(기기 메모리에서만 — 저장·전송하지 않는다). `LinkRenderer` 가 채우고 `LinkText.compose` 가 큐 항목 본문으로 만든다
public struct LinkPage: Equatable, Sendable {
  public var host: String
  /// og:title, 없으면 document.title
  public var title: String
  /// og:description, 없으면 description
  public var description: String
  /// 보이는 글(innerText)
  public var visibleText: String
  /// 숨은 요소를 포함한 글(스크립트·스타일 제외 텍스트 노드) — "터치해서 열기" 덮개 뒤 본문
  public var allText: String
  /// 화면 스냅샷 OCR(앱에서만, 날짜 후보가 없거나 글이 없을 때)
  public var ocrText: String?
  /// 예산이 끝나 그때까지 읽은 글
  public var timedOut: Bool

  public init(host: String, title: String = "", description: String = "", visibleText: String = "", allText: String = "",
              ocrText: String? = nil, timedOut: Bool = false) {
    self.host = host; self.title = title; self.description = description; self.visibleText = visibleText
    self.allText = allText; self.ocrText = ocrText; self.timedOut = timedOut
  }

  /// 본문(스펙 §6 "읽는 것"): 보이는 글. 보이는 글에 날짜 후보가 없고 숨은 글에 있으면 숨은 글, 보이는 글이 비면 숨은 글
  public var body: String {
    if !LinkText.hasDateCandidate(visibleText), LinkText.hasDateCandidate(allText) { return allText }
    return visibleText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? allText : visibleText
  }

  /// 날짜 후보 판단 대상: 제목·설명·본문·OCR
  public var searchable: String { [title, description, body, ocrText ?? ""].joined(separator: "\n") }
  /// 빈 페이지 = searchable 이 공백. 본문은 보이는 글이나 숨은 글이라 다섯 필드가 모두 공백인지로 같게 판정한다 — 날짜 판정(본문 계산)을 다시 돌리지 않게
  public var isEmpty: Bool {
    [title, description, visibleText, allText, ocrText ?? ""].allSatisfy { $0.unicodeScalars.allSatisfy(CharacterSet.whitespacesAndNewlines.contains) }
  }

  /// 추출 JS 결과(JSON 문자열, `LinkScript.extract`) → LinkPage. 형식이 다르면 nil
  public static func decode(json: String, host: String) -> LinkPage? {
    guard let d = json.data(using: .utf8), let o = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] else { return nil }
    func s(_ k: String) -> String { o[k] as? String ?? "" }
    let og = s("ogTitle")
    return LinkPage(host: host, title: og.isEmpty ? s("title") : og, description: s("ogDescription"), visibleText: s("text"), allText: s("all"))
  }
}

/// 렌더링 대기 판정(스펙 §6 "대기"): WebKit 에는 network idle 판정이 없어 글 길이가 멈췄는지로 본다
public struct LinkSettle: Sendable {
  public static let pollInterval: Duration = .milliseconds(500)
  public static let stableSamples = 3
  /// didFinish 가 오지 않아도(긴 폴링·끝없는 하위 리소스) 로드 시작 뒤 이 시간이 지나면 길이만 보고 끝낸다. 글 0자는 **didFinish 뒤** 이 시간이 지나야 끝낸다
  public static let finishGrace: TimeInterval = 4
  public enum Decision: Equatable, Sendable { case wait, done, deadline }
  public let budget: TimeInterval
  private var last = -1, same = 0
  /// didFinish 를 처음 본 elapsed(스펙 §6 "대기"의 기준 시각 — 로드 시작이 아니다)
  private var finishedAt: TimeInterval?
  public init(budget: TimeInterval) { self.budget = budget }

  public mutating func observe(length: Int, finished: Bool, elapsed: TimeInterval) -> Decision {
    if elapsed >= budget { return .deadline }
    // didFinish 전 샘플은 "3번 같음"에 넣지 않는다 — HTML 의 고정 "로딩 중…" 글만 읽고 끝내지 않게(리뷰 I2)
    if finished, finishedAt == nil { finishedAt = elapsed; last = -1 }
    if length == last { same += 1 } else { last = length; same = 1 }
    guard same >= Self.stableSamples else { return .wait }
    // 글 0자(순수 이미지 페이지, Codex 1): didFinish 뒤 SPA 가 그릴 시간(4초)이 지났을 때만 완료 — 렌더러가 OCR 로 간다.
    // 느린 망에서 didFinish 가 늦게 와도 그 뒤 4초를 준다
    if length == 0 {
      guard let f = finishedAt else { return .wait }
      return elapsed - f >= Self.finishGrace ? .done : .wait
    }
    return finishedAt != nil || elapsed >= Self.finishGrace ? .done : .wait
  }
}
