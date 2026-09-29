import Foundation

/// "최근 폐기"(스펙 §7): 서버 분류 게이트가 7일 격리 중인 항목의 메타(본문 없음)와 복구 결과 해석. 화면은 App/RecentDiscardsView
public enum RecentDiscards {
  public struct Row: Identifiable, Decodable, Sendable {
    public let id: String; public let source: String; public let app_name: String?; public let sender: String?; public let title: String?
    public let gate_label: String?; public let gate_confidence: Double?; public let occurred_at: String

    public var titleLine: String { title ?? "(제목 없음)" }
    public var originLine: String { [app_name ?? source, sender ?? ""].filter { !$0.isEmpty }.joined(separator: " · ") }
    public var gateLine: String {
      "\(RecentDiscards.labelKo(gate_label)) · \(Int(((gate_confidence ?? 0) * 100).rounded()))% · \(occurred_at.prefix(10))"
    }
  }

  /// RLS 로 자기 행만. 본문 열은 요청하지 않는다. 격리 기한(quarantine_until)이 지금보다 뒤 = 게이트 폐기 후 복구 가능 기간(0010).
  /// 기한이 지난 행은 purge(일 1회)가 null 로 만들기 전까지 남아 있으므로 not.is.null 로는 거르지 못한다(최종 리뷰 M1-④b)
  public static func query(now: Date = Date()) -> String {
    "rest/v1/items?select=id,source,app_name,sender,title,gate_label,gate_confidence,occurred_at"
      + "&quarantine_until=gt.\(ISO8601DateFormatter().string(from: now))&order=occurred_at.desc&limit=300"
  }

  public static func decode(_ data: Data) -> [Row]? { try? JSONDecoder().decode([Row].self, from: data) }

  public static func labelKo(_ l: String?) -> String {
    ["personal": "개인 대화", "promo": "광고", "otp": "인증번호", "notice": "안내", "medical_result": "의료 결과"][l ?? ""] ?? (l ?? "-")
  }

  public static func summary(count: Int) -> String {
    count == 0 ? "최근 7일 안에 폐기된 항목이 없습니다" : "\(count)건 · 7일이 지나면 본문이 지워집니다"
  }

  /// restore_discarded RPC 응답 → queued|not_found|expired|not_discarded, 그 외 http_<status>·network
  public static func restoreResult(status: Int?, data: Data?) -> String {
    guard let status, let data else { return "network" }
    guard status == 200, let s = (try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])) as? String else { return "http_\(status)" }
    return s
  }

  public static func restoreMessage(_ result: String) -> String {
    switch result {
    case "queued": return "복구했습니다. 잠시 뒤 다시 처리됩니다"
    case "expired": return "7일이 지나 복구할 수 없습니다"
    case "not_discarded": return "이미 복구됐거나 폐기 항목이 아닙니다"
    default: return "복구 실패: \(result)"
    }
  }
}
