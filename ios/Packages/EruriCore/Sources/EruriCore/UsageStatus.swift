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

extension UsageStatus {
  /// 설정 "이번 달 사용" 기능별 줄(스펙 §9, 0.15.0): rpc/usage_breakdown → [월 예산 줄?, "월 예산 밖: …"?, 각주?]. 한 기능 = 같은 kind 의 모델 행 합(모델 이름은 안 보인다).
  /// 모르는 kind 는 무시, calls 0 인 기능은 뺀다. 모양이 다르면 nil — 화면은 합계 줄만(옛 서버·0032 전). 합계 줄과 합이 맞지 않을 수 있다(반올림·조회 시점, Codex #4)
  public static let budgetKinds: [(kind: String, name: String)] = [("chat", "채팅"), ("mail_summary", "메일 요약"), ("extract", "수집(추출)"), ("embed", "검색 색인(임베딩)")]
  public static let outsideKinds: [(kind: String, name: String)] = [("backfill", "과거 메일 가져오기"), ("vision", "이미지 읽기")]
  public static let footnote = "토큰 수 × 공식 단가 × 환율로 계산한 금액이에요(실제 청구와 조금 다를 수 있어요)"

  public static func breakdown(_ data: Data) -> [String]? {
    guard let rows = (try? JSONSerialization.jsonObject(with: data)) as? [[String: Any]] else { return nil }
    var sums: [String: (calls: Int, tokens: Int, krw: Double)] = [:]
    for r in rows {
      guard let kind = r["kind"] as? String, let calls = (r["calls"] as? NSNumber)?.intValue, let input = (r["input_tokens"] as? NSNumber)?.intValue,
            let output = (r["output_tokens"] as? NSNumber)?.intValue, let krw = (r["krw"] as? NSNumber)?.doubleValue else { return nil }
      var s = sums[kind] ?? (0, 0, 0)
      s.calls += calls; s.tokens += input + output; s.krw += krw              // cached 는 input 에 들어 있어 더하지 않는다
      sums[kind] = s
    }
    func items(_ kinds: [(kind: String, name: String)]) -> [String] {
      kinds.compactMap { k in guard let s = sums[k.kind], s.calls > 0 else { return nil }; return "\(k.name) \(won(s.krw)) (\(tokens(s.tokens)))" }
    }
    var lines: [String] = []
    let inBudget = items(budgetKinds), outside = items(outsideKinds)
    if !inBudget.isEmpty { lines.append(inBudget.joined(separator: " · ")) }
    if !outside.isEmpty { lines.append("월 예산 밖: " + outside.joined(separator: " · ")) }
    if !lines.isEmpty { lines.append(footnote) }
    return lines
  }
  /// 원 단위 반올림·천 단위 쉼표, 0보다 크고 0.5원 미만이면 "1원 미만"
  public static func won(_ krw: Double) -> String {
    if krw > 0 && krw < 0.5 { return "1원 미만" }
    return MailCleanup.grouped(Int(krw.rounded())) + "원"
  }
  /// 10,000 미만은 쉼표 + "토큰", 이상은 만 단위 소수 첫째 자리 반올림(".0" 생략)
  public static func tokens(_ n: Int) -> String {
    if n < 10_000 { return MailCleanup.grouped(n) + "토큰" }
    let tenths = (n + 500) / 1_000
    return MailCleanup.grouped(tenths / 10) + (tenths % 10 == 0 ? "" : ".\(tenths % 10)") + "만 토큰"
  }
}
