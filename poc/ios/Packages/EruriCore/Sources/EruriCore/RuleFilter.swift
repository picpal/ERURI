import Foundation

public enum RuleVerdict: Equatable, Sendable { case discard(reason: String), pass(masked: String) }
/// 제목+본문 판정 결과. 마스킹은 제목·본문 각각에 적용된다.
public enum CaptureVerdict: Equatable, Sendable { case discard(reason: String), pass(title: String?, text: String) }

public struct RuleFilter: Sendable {
  private let contactNames: Set<String>
  /// 이름은 `ContactNames.normalize`(공백·호칭 제거)로 정규화해 보관한다.
  public init(contactNames: Set<String> = []) {
    self.contactNames = Set(contactNames.map(ContactNames.normalize).filter { !$0.isEmpty })
  }

  // OTP 키워드. `OTP`·`code`는 영문자 경계로만 인정한다(`\b`는 ICU에서 한글도 단어 문자로 보아 `OTP번호`를 놓친다).
  private static let otpKeyword = try! NSRegularExpression(pattern:
    #"(인증|보안|승인|확인)\s*(번호|코드)|verification|verify|passcode|one[- ]?time|(?<![A-Za-z])(code|OTP)(?![A-Za-z])"#,
    options: [.caseInsensitive])
  // OTP 숫자: 4~8자리 또는 3-3 분리. 날짜·시각·금액(`2026년`, `15:00`, `9/25`, `32,000원`)은 제외.
  private static let otpDigits = try! NSRegularExpression(pattern:
    #"(?<![\d.,:/-])(?:\d{4,8}|\d{3}[ -]\d{3})(?![\d.:/-]|\s*(?:년|월|일|시|분|원))"#)
  // "승인번호"가 카드 결제 승인 문자에 쓰일 때의 결제 문맥
  private static let approvalKeyword = try! NSRegularExpression(pattern: #"^승인\s*(번호|코드)$"#)
  private static let paymentContext = try! NSRegularExpression(pattern: #"\d[\d,]*\s*원|금액|결제|승인\s*취소|일시불|할부|누적"#)
  private static let otpWindow = 30

  // 카드: 포맷 고정(4-4-4-x, 아멕스 4-6-5) 또는 연속 13~19자리. 앞의 날짜 숫자를 삼키지 않는다.
  private static let cardLike = try! NSRegularExpression(pattern:
    #"(?<!\d)(?:\d{4}([ .-])\d{4}\1\d{4}\1\d{1,7}|\d{4}([ .-])\d{6}\2\d{4,5}|\d{13,19})(?!\d)"#)
  // 계좌 후보: 2~6자리 그룹 3~4개(하이픈, 총 10~14자리) 또는 연속 10~16자리(가상계좌 포함). 자릿수와 키워드 ±20자는 코드에서 검사.
  private static let accountLike = try! NSRegularExpression(pattern:
    #"(?<![\d-])(?:\d{2,6}(?:-\d{2,6}){2,3}|\d{10,16})(?![\d-])"#)
  private static let accountKeyword = try! NSRegularExpression(pattern:
    #"은행|뱅크|계좌|예금주|입금|농협|신협|수협|우체국|새마을금고|신한|국민|기업|IBK|KB|NH|SC제일|씨티"#)
  private static let accountWindow = 20

  public func apply(text: String, sender: String?) -> RuleVerdict {
    switch apply(title: nil, text: text, sender: sender) {
    case .discard(let r): return .discard(reason: r)
    case .pass(_, let t): return .pass(masked: t)
    }
  }

  /// 연락처는 `sender`·`title` 양쪽을 비교한다(카톡은 발신자가 제목에 온다).
  /// 제목+본문을 합쳐 판정·마스킹한 뒤 다시 나눈다(키워드가 제목, 숫자가 본문이어도 폐기·마스킹).
  /// 마스킹은 숫자를 `*`로 1:1 치환해 길이가 보존되므로 제목 길이에서 그대로 자를 수 있다.
  public func apply(title: String?, text: String, sender: String?) -> CaptureVerdict {
    if isContact(sender) || isContact(title) { return .discard(reason: "contact") }
    guard let title else {
      guard case .pass(let m) = mask(text) else { return .discard(reason: "otp") }
      return .pass(title: nil, text: m)
    }
    let joined = title + "\n" + text
    guard case .pass(let m) = mask(joined) else { return .discard(reason: "otp") }
    let ns = m as NSString, titleLen = (title as NSString).length
    if ns.length == (joined as NSString).length {
      return .pass(title: ns.substring(to: titleLen), text: ns.substring(from: titleLen + 1))
    }
    // 보조 평면 숫자 등으로 길이가 바뀌면 각각 마스킹한다
    guard case .pass(let mt) = mask(title), case .pass(let mx) = mask(text) else { return .discard(reason: "otp") }
    return .pass(title: mt, text: mx)
  }

  private func isContact(_ name: String?) -> Bool {
    guard let name else { return false }
    let n = ContactNames.normalize(name)
    return !n.isEmpty && contactNames.contains(n)
  }

  /// OTP 폐기 + 승인번호·카드·계좌 마스킹
  private func mask(_ text: String) -> RuleVerdict {
    var out = text
    // OTP: 키워드 ±30자 안에 숫자가 있으면 폐기. 단 "승인번호"+결제 문맥이면 승인번호만 가리고 통과.
    let ns = text as NSString
    let isPayment = Self.paymentContext.firstMatch(in: text, range: NSRange(location: 0, length: ns.length)) != nil
    var approvalRanges: [NSRange] = []
    for k in Self.otpKeyword.matches(in: text, range: NSRange(location: 0, length: ns.length)) {
      let window = Self.window(around: k.range, by: Self.otpWindow, length: ns.length)
      let digits = Self.otpDigits.matches(in: text, range: window)
      guard !digits.isEmpty else { continue }
      let kw = ns.substring(with: k.range)
      if isPayment, Self.approvalKeyword.firstMatch(in: kw, range: NSRange(location: 0, length: (kw as NSString).length)) != nil {
        // 키워드 뒤쪽 첫 숫자만 승인번호로 본다
        if let d = digits.first(where: { $0.range.location >= k.range.location + k.range.length }) { approvalRanges.append(d.range) }
        continue
      }
      return .discard(reason: "otp")
    }
    for r in approvalRanges.sorted(by: { $0.location > $1.location }) {
      let raw = (out as NSString).substring(with: r)
      out = (out as NSString).replacingCharacters(in: r, with: String(raw.map { $0.isNumber ? "*" : $0 }))
    }
    // 카드번호: Luhn 통과하는 13~19자리만 마지막 4자리를 남기고 마스킹
    var outNS = out as NSString
    for m in Self.cardLike.matches(in: out, range: NSRange(location: 0, length: outNS.length)).reversed() {
      let raw = outNS.substring(with: m.range)
      let digits = raw.filter(\.isNumber)
      guard (13...19).contains(digits.count), Self.luhn(digits) else { continue }
      out = (out as NSString).replacingCharacters(in: m.range, with: Self.maskDigits(raw))
    }
    // 계좌번호: 앞뒤 20자 안에 은행·계좌 키워드
    outNS = out as NSString
    for m in Self.accountLike.matches(in: out, range: NSRange(location: 0, length: outNS.length)).reversed() {
      let raw = outNS.substring(with: m.range)
      let n = raw.filter(\.isNumber).count
      guard raw.contains("-") ? (10...14).contains(n) : (10...16).contains(n) else { continue }
      let window = Self.window(around: m.range, by: Self.accountWindow, length: outNS.length)
      guard Self.accountKeyword.firstMatch(in: out, range: window) != nil else { continue }
      out = (out as NSString).replacingCharacters(in: m.range, with: Self.maskDigits(raw))
    }
    return .pass(masked: out)
  }

  /// 숫자만 마지막 4자리를 남기고 `*`로 바꾼다. 구분자는 유지한다.
  static func maskDigits(_ raw: String) -> String {
    let total = raw.filter(\.isNumber).count
    var seen = 0
    return String(raw.map { ch -> Character in
      guard ch.isNumber else { return ch }
      seen += 1
      return seen > total - 4 ? ch : "*"
    })
  }

  static func window(around r: NSRange, by n: Int, length: Int) -> NSRange {
    let start = max(0, r.location - n), end = min(length, r.location + r.length + n)
    return NSRange(location: start, length: end - start)
  }

  static func luhn(_ digits: String) -> Bool {
    var sum = 0; var alt = false
    for ch in digits.reversed() {
      guard var d = ch.wholeNumberValue else { return false }
      if alt { d *= 2; if d > 9 { d -= 9 } }
      sum += d; alt.toggle()
    }
    return sum % 10 == 0
  }
}
