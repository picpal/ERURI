import Foundation

/// 광고 메일 구독 해지(스펙 §7 "광고 구독 해지"): rpc/unsub_list 행 해석·상태 문구·요청 결과. 화면은 App/UnsubscribeView.
/// 해지 URL 은 앱으로 오지 않는다(서버 unsub_list 가 내보내지 않음)
public enum Unsubscribe {
  public static let listPath = "rest/v1/rpc/unsub_list"
  public static let requestPath = "functions/v1/unsubscribe"

  public struct Row: Identifiable, Decodable, Sendable, Equatable {
    public let sender_id: String
    public let display_name: String?
    public let address: String
    public let method: String
    public let status: String
    public let status_at: String?
    public let requested_at: String?
    public let result_code: String?
    public let ads_30d: Int
    public let ads_after_request: Int
    public let last_ad_at: String?
    public let can_request: Bool                                       // attempts < 5 (서버 unsub_list)

    public var id: String { sender_id }
    public var name: String { (display_name?.isEmpty == false ? display_name : nil) ?? address }
    public var countLine: String { "최근 30일 광고 \(ads_30d)통 · \(address)" }
    public func state(now: Date = Date()) -> State { Unsubscribe.state(self, now: now) }
  }

  public enum State: Equatable, Sendable {
    case available, requesting, requested(String), stillComing(Int), failed(String), unsupported(String)

    public var label: String {
      switch self {
      case .available: return "원클릭 해지 지원"
      case .requesting: return "요청 중…"
      case .requested(let d): return "해지 요청함 · \(d)"
      case .stillComing(let n): return "해지 요청 뒤에도 광고 \(n)통"
      case .failed(let c): return "요청 실패 (\(c))"
      case .unsupported(let r): return r
      }
    }
    public var buttonTitle: String? {
      switch self {
      case .available: return "해지"
      case .stillComing: return "다시 요청"
      case .failed: return "다시 시도"
      default: return nil
      }
    }
    public var isWarning: Bool {
      switch self { case .stillComing, .failed: return true; default: return false }
    }
  }

  static func state(_ r: Row, now: Date) -> State {
    let oneClick = r.method == "one_click"
    if r.status == "requesting", let t = date(r.status_at), now.timeIntervalSince(t) < 60 { return .requesting }
    if r.status == "requested" {
      if r.ads_after_request == 0 { return .requested(shortDate(r.requested_at)) }
      if oneClick && r.can_request { return .stillComing(r.ads_after_request) }
    }
    if !oneClick { return .unsupported(reason(r.method)) }
    if !r.can_request { return .unsupported("요청 한도(5회)에 도달했어요") }   // 버튼이 붙는 상태(available·stillComing·failed) 앞에서 막는다
    if r.status == "failed" { return .failed(r.result_code ?? "error") }
    if r.status == "requesting" { return .failed("timeout") }           // 60초 넘게 결과 없음 = 요청 중 종료, 다시 시도 가능
    return .available
  }

  static func reason(_ method: String) -> String {
    switch method {
    case "mailto": return "메일 회신 방식 — 앱에서 해지할 수 없어요"
    case "link_only": return "웹 페이지 방식 — 앱에서 해지할 수 없어요"
    case "unverified": return "발신자 확인이 안 돼 해지 요청을 보내지 않아요"
    case "none": return "해지 링크가 없어요"
    default: return "해지 방법을 알 수 없어요"
    }
  }

  /// PostgREST timestamptz("2026-10-09T03:00:00.123456+00:00") — 소수 초를 떼고 읽는다
  static func date(_ s: String?) -> Date? {
    guard let s else { return nil }
    return ISO8601DateFormatter().date(from: s.replacingOccurrences(of: #"\.\d+"#, with: "", options: .regularExpression))
  }
  static func shortDate(_ s: String?) -> String {
    guard let d = date(s) else { return "-" }
    var cal = Calendar(identifier: .gregorian)
    cal.timeZone = TimeZone(identifier: "Asia/Seoul")!
    let c = cal.dateComponents([.month, .day], from: d)
    return "\(c.month ?? 0)/\(c.day ?? 0)"
  }

  public static func decode(_ data: Data) -> [Row]? { try? JSONDecoder().decode([Row].self, from: data) }

  public static func summary(count: Int) -> String {
    count == 0 ? "최근 30일 광고 메일이 없어요" : "광고 발신자 \(count)곳 · 많이 보낸 순"
  }

  /// Edge unsubscribe 응답 {result, code?} → 사용자 문구
  public static func message(status: Int?, data: Data?) -> String {
    guard let status, let data else { return "요청 실패: network" }
    guard status == 200, let o = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any], let r = o["result"] as? String else {
      return "요청 실패: http_\(status)"
    }
    switch r {
    case "requested": return "해지 요청을 보냈어요. 발신자가 처리하는 데 며칠 걸릴 수 있어요"
    case "failed": return "해지 요청 실패 (\(o["code"] as? String ?? "error"))"
    case "unsupported": return "이 발신자는 앱에서 해지할 수 없어요"
    case "already": return "이미 해지 요청을 보냈어요"
    case "busy": return "요청 중이에요. 잠시 뒤 새로고침해 주세요"
    case "limit": return "이 발신자에게는 더 요청할 수 없어요 (5회)"
    case "not_found": return "목록이 바뀌었어요. 새로고침해 주세요"
    default: return "요청 실패: \(r)"
    }
  }

  public static func confirmTitle(_ r: Row) -> String { "\(r.name)의 광고 수신 거부를 요청할까요?" }
  public static let confirmMessage = "발신자 서버로 수신 거부 요청을 보냅니다. 주문·배송 같은 거래 메일은 계속 올 수 있어요(발신자 정책). 되돌리려면 그 서비스에서 다시 수신 동의해야 합니다."
  public static let footer = "Gmail에서 광고로 분류됐거나 (광고) 표시가 있는 메일만 셉니다. 해지 요청은 고른 발신자에게만, 누를 때만 보냅니다. 구독 해지 기록에는 메일 제목·본문을 저장하지 않습니다."
}
