import Foundation

public enum RuleVerdict: Equatable { case discard(reason: String), pass(masked: String) }

public struct RuleFilter {
  private let contactNames: Set<String>
  public init(contactNames: Set<String> = []) { self.contactNames = contactNames }

  private static let otpKeyword = try! NSRegularExpression(pattern: #"(인증|승인|확인)\s*번호|verification|OTP"#, options: [.caseInsensitive])
  private static let otpDigits  = try! NSRegularExpression(pattern: #"(?<!\d)\d{4,8}(?!\d)"#)
  private static let cardLike   = try! NSRegularExpression(pattern: #"(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)"#)
  private static let account    = try! NSRegularExpression(pattern: #"(은행|계좌).{0,20}?(?<!\d)(\d{10,14})(?!\d)"#)

  public func apply(text: String, sender: String?) -> RuleVerdict {
    if let s = sender, contactNames.contains(s) { return .discard(reason: "contact") }
    let ns = text as NSString
    let all = NSRange(location: 0, length: ns.length)
    if Self.otpKeyword.firstMatch(in: text, range: all) != nil, Self.otpDigits.firstMatch(in: text, range: all) != nil {
      return .discard(reason: "otp")
    }
    var out = text
    // 카드번호: Luhn 통과하는 13~19자리만 마스킹
    for m in Self.cardLike.matches(in: text, range: all).reversed() {
      let raw = ns.substring(with: m.range)
      let digits = raw.filter(\.isNumber)
      guard (13...19).contains(digits.count), Self.luhn(digits) else { continue }
      let last4 = String(digits.suffix(4))
      var masked = ""; var seen = 0
      for ch in raw {
        if ch.isNumber { seen += 1; masked.append(seen > digits.count - 4 ? ch : "*") } else { masked.append(ch) }
      }
      _ = last4
      out = (out as NSString).replacingCharacters(in: m.range, with: masked)
    }
    // 계좌번호
    let outNS = out as NSString
    for m in Self.account.matches(in: out, range: NSRange(location: 0, length: outNS.length)).reversed() {
      let r = m.range(at: 2)
      let num = outNS.substring(with: r)
      let masked = String(repeating: "*", count: num.count - 4) + num.suffix(4)
      out = (out as NSString).replacingCharacters(in: r, with: masked)
    }
    return .pass(masked: out)
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
