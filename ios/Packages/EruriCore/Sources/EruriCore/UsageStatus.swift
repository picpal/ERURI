import Foundation

/// 이번 달 사용 표시(스펙 §13, M2-⑦). rpc/usage_status 응답 [{month, used_krw, cap_krw, level}] 을 한 줄로 만든다.
/// numeric 은 PostgREST 가 JSON 숫자로 준다. 모양이 다르면 nil(화면은 "-")
public enum UsageStatus {
  public static func label(_ data: Data) -> String? {
    guard let row = (try? JSONSerialization.jsonObject(with: data) as? [[String: Any]])?.first,
          let used = (row["used_krw"] as? NSNumber)?.doubleValue, let cap = (row["cap_krw"] as? NSNumber)?.doubleValue else { return nil }
    let suffix = switch row["level"] as? String ?? "ok" {
    case "stopped": " · 추출·채팅 중단(수집은 계속)"
    case "degraded": " · 80% 넘음(채팅 경량 모델)"
    default: ""
    }
    return "\(Int(used))원 / \(Int(cap))원" + suffix
  }
}
