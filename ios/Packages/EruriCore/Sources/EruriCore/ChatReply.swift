import Foundation

/// 채팅 응답 해석(스펙 §9, M2-⑧b 계약): POST /chat → {answer_id, answer, refused, source_item_ids, citations, proposals, hits}.
/// 오류 401·400 bad_question·429 budget_exhausted·503 llm_busy(retry-after 30)
public enum ChatReply {
  public struct Citation: Decodable, Identifiable, Sendable {
    public let item_id: String; public let source: String; public let app_name: String?; public let title: String?
    public let occurred_at: String; public let expired: Bool
    public var id: String { item_id }
  }
  public struct Proposal: Decodable, Identifiable, Sendable {
    public let id: String; public let item_id: String; public let action: String; public let status: String; public let payload: [String: JSONValue]
  }
  public struct Answer: Decodable, Sendable {
    public let answer_id: String; public let answer: String; public let refused: Bool; public let citations: [Citation]; public let proposals: [Proposal]
  }

  public static func decode(_ data: Data) -> Answer? { try? JSONDecoder().decode(Answer.self, from: data) }

  /// 캘린더 추가 버튼을 보일 제안이면 start(Ruling 8·§10): 푸시 ADD_EVENT 와 같은 조건 — create_event · proposed · 시각 있는 start · uncertain 없음.
  /// 날짜만이거나 확인 필요는 버튼 없음(제안 리뷰 화면은 2단계)
  public static func calendarStart(_ p: Proposal) -> String? {
    guard p.action == "create_event", p.status == "proposed", let start = p.payload["start"]?.string,
          start.range(of: #"T\d{2}:\d{2}"#, options: .regularExpression) != nil else { return nil }
    if case .array(let u)? = p.payload["uncertain"], !u.isEmpty { return nil }
    return start
  }

  public static func errorMessage(status: Int) -> String {
    switch status {
    case 429: "이번 달 예산을 다 써서 답할 수 없습니다(수집은 계속됩니다)"
    case 503: "잠시 뒤 다시 물어보세요"
    case 400: "질문을 500자 이내로 적어 주세요"
    default: "오류 \(status)"
    }
  }

  /// llm_busy(503): 첫 시도에서만 5초 뒤 한 번 더(M2-⑦ LLM 동시 2). 서버 retry-after 30초는 대화 대기로 너무 길다
  public static func retryDelay(status: Int, attempt: Int) -> TimeInterval? { status == 503 && attempt == 0 ? 5 : nil }

  /// timestamptz 문자열 → 서울 "yyyy-MM-dd HH:mm". 해석 못 하면 그대로
  public static func seoulLabel(_ iso: String) -> String {
    let trimmed = iso.replacingOccurrences(of: #"\.\d+"#, with: "", options: .regularExpression)   // Postgres 소수 초
    guard let d = ISO8601DateFormatter().date(from: trimmed) else { return iso }
    let f = DateFormatter()
    f.locale = Locale(identifier: "en_US_POSIX"); f.timeZone = TimeZone(identifier: "Asia/Seoul"); f.dateFormat = "yyyy-MM-dd HH:mm"
    return f.string(from: d)
  }
}

/// 제안 payload 의 느슨한 JSON 값
public enum JSONValue: Decodable, Sendable, Equatable {
  case string(String), number(Double), bool(Bool), array([JSONValue]), object([String: JSONValue]), null
  public init(from d: Decoder) throws {
    let c = try d.singleValueContainer()
    if c.decodeNil() { self = .null } else if let v = try? c.decode(Bool.self) { self = .bool(v) }
    else if let v = try? c.decode(String.self) { self = .string(v) } else if let v = try? c.decode(Double.self) { self = .number(v) }
    else if let v = try? c.decode([JSONValue].self) { self = .array(v) } else { self = .object(try c.decode([String: JSONValue].self)) }
  }
  public var string: String? { if case .string(let s) = self { return s }; return nil }
}
