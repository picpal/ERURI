import Foundation

/// 채팅 응답 해석(스펙 §9, M2-⑧b 계약): POST /chat → {answer_id, answer, refused, source_item_ids, citations, proposals, hits, candidates}.
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
    /// "보관함에서 보기" 후보(스펙 §9, R-A1): 검색 융합 목록의 item id, 순위순. 0.6.x 서버 응답에는 없다
    public let candidates: [String]?
    public var candidateIDs: [String] { candidates ?? [] }
  }

  public static func decode(_ data: Data) -> Answer? { try? JSONDecoder().decode(Answer.self, from: data) }

  /// 캘린더 추가 버튼을 보일 제안이면 start(Ruling 8·§10): 푸시 ADD_EVENT 와 같은 조건 — create_event · proposed · 시각 있는 start · uncertain 없음 ·
  /// 지나지 않음(notify.ts skip past. 백필 제안은 푸시만 건너뛰고 proposed 로 남아 90일 메일 인용에 자주 붙는다).
  /// handleAdd 가 읽지 못할 start(오프셋 없음 등)도 버튼 없음. 날짜만이거나 확인 필요는 버튼 없음(제안 리뷰 화면은 2단계)
  public static func calendarStart(_ p: Proposal, now: Date = Date()) -> String? {
    guard p.action == "create_event", p.status == "proposed", let start = p.payload["start"]?.string,
          start.range(of: #"T\d{2}:\d{2}"#, options: .regularExpression) != nil,
          let at = iso.date(from: start), at >= now else { return nil }
    if case .array(let u)? = p.payload["uncertain"], !u.isEmpty { return nil }
    return start
  }

  /// 제안 카드 결과 문구(handleAdd 반환: ok·recovered·dup·skip_<status>·fail:<코드>·invalid_payload).
  /// retry 는 실패일 때만 — 버튼을 다시 켠다. dup·skip 은 다시 눌러도 같은 결과
  public static func addFeedback(_ outcome: String) -> (text: String, retry: Bool) {
    switch outcome {
    case "ok", "recovered": ("캘린더에 추가했습니다", false)
    case "dup", "skip_succeeded": ("이미 캘린더에 추가된 제안입니다", false)
    case "skip_stale": ("제안이 바뀌어 추가하지 않았습니다", false)
    case "fail:no_writable_calendar": ("쓸 수 있는 기본 캘린더가 없어 추가하지 못했습니다", true)
    default: ("추가하지 못했습니다. 다시 눌러 주세요", true)
    }
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
    guard let d = Self.iso.date(from: trimmed) else { return iso }
    return seoul.string(from: d)
  }

  // 인용 행마다 불리므로 한 번만 만든다. 설정 후 date(from:)·string(from:)만 쓴다(Foundation 포매터는 이 사용에서 스레드 안전).
  // ISO8601DateFormatter 는 SDK 가 Sendable 표시를 안 해서 unsafe 로 둔다. handleAdd 와 같은 파서여야 버튼과 실행 판정이 어긋나지 않는다
  nonisolated(unsafe) private static let iso = ISO8601DateFormatter()
  private static let seoul: DateFormatter = {
    let f = DateFormatter()
    f.locale = Locale(identifier: "en_US_POSIX"); f.timeZone = TimeZone(identifier: "Asia/Seoul"); f.dateFormat = "yyyy-MM-dd HH:mm"
    return f
  }()
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
