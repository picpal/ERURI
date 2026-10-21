import Foundation

/// 저장 규칙(스펙 §9 "저장 규칙 응답"·"카드 버튼"·"앱 — 저장 규칙 카드", 0.17.0): /chat 응답 save_rule 해석·카드 문구·POST /chat/rule 본문과 결과.
/// chat 은 판정만 하고 바꾸지 않는다 — 카드 버튼을 눌러야 바뀐다. 화면은 App/SaveRuleCard(P4). 진단 로그에는 op·상태·건수만(규칙 값 없음)
public enum SaveRules {
  public static let intents: Set<String> = ["save_rule_add", "save_rule_list", "save_rule_remove"]
  public static func isSaveRule(_ intent: String?) -> Bool { intent.map(intents.contains) ?? false }
  public static let limit = 20

  /// kind = keyword·sender
  public struct Rule: Codable, Sendable, Equatable, Identifiable {
    public let id: String; public let kind: String; public let value: String; public let created_at: String
    public init(id: String, kind: String, value: String, created_at: String) { self.id = id; self.kind = kind; self.value = value; self.created_at = created_at }
  }
  public struct Candidate: Codable, Sendable, Equatable {
    public let kind: String; public let value: String
    public init(kind: String, value: String) { self.kind = kind; self.value = value }
  }
  /// op = add·list·remove, status = ok·duplicate·limit·bad_value·not_found. matched = duplicate 일 때 그 규칙에 맞는 격리 중 폐기 수. 관대한 디코드
  public struct Response: Codable, Sendable {
    public let op: String; public let status: String; public let candidate: Candidate?
    public let matches: [Rule]; public let rules: [Rule]; public let matched: Int; public let limit: Int
    public init(op: String, status: String, candidate: Candidate?, matches: [Rule], rules: [Rule], matched: Int, limit: Int) {
      self.op = op; self.status = status; self.candidate = candidate; self.matches = matches; self.rules = rules; self.matched = matched; self.limit = limit
    }
    public init(from d: Decoder) throws {
      let c = try d.container(keyedBy: CodingKeys.self)
      op = try c.decode(String.self, forKey: .op)
      status = try c.decode(String.self, forKey: .status)
      candidate = try? c.decodeIfPresent(Candidate.self, forKey: .candidate)
      matches = (try? c.decodeIfPresent([Rule].self, forKey: .matches)) ?? []
      rules = (try? c.decodeIfPresent([Rule].self, forKey: .rules)) ?? []
      matched = (try? c.decodeIfPresent(Int.self, forKey: .matched)) ?? 0
      limit = (try? c.decodeIfPresent(Int.self, forKey: .limit)) ?? SaveRules.limit
    }
  }

  public enum Text {
    public static let addTitle = "저장 규칙을 추가할까요?"
    public static let removeTitle = "이 저장 규칙을 뺄까요?"
    public static let duplicate = "이미 있는 저장 규칙이에요"
    public static let limit = "저장 규칙은 20개까지예요 — 안 쓰는 규칙을 빼 주세요"
    public static let badValue = "키워드는 2~30자로 말해 주세요"                      // 발신자도 같은 문구
    public static let notFound = "그 규칙을 찾지 못했어요"
    public static let empty = "저장 규칙이 없어요 — '앞으로 PINPAY 문자는 저장해'처럼 말하면 추가할 수 있어요"
    public static let none = "지금은 맞는 메시지가 없어요"
    public static let removed = "저장 규칙을 뺐어요 — 이미 저장된 메시지는 그대로 있어요"
    public static let removedRow = "뺐어요"
    public static let buttonFailed = "바꾸지 못했어요. 다시 눌러 주세요."
  }

  /// 목록 줄: "키워드 · PINPAY"·"발신자 · 합성은행"
  public static func ruleLine(_ r: Rule) -> String { "\(kindKo(r.kind)) · \(r.value)" }
  private static func kindKo(_ k: String) -> String { k == "sender" ? "발신자" : "키워드" }

  /// add ok 카드: 머리 + 줄 + 작은 글씨(개인 대화 저장 위험 — 사용자 결정 2026-10-21, §12)
  public static func addPrompt(_ c: Candidate) -> (title: String, line: String, note: String) {
    c.kind == "sender"
      ? (Text.addTitle, "발신자 '\(c.value)' — 이 발신자의 메시지는 알림으로 분류돼도 저장해요", "이 발신자와의 개인 대화도 저장돼요")
      : (Text.addTitle, "키워드 '\(c.value)' — 제목·본문에 들어 있으면 알림으로 분류돼도 저장해요", "이 키워드가 든 개인 대화도 저장돼요")
  }

  public static func listHead(count: Int) -> String { "저장 규칙 \(count)/\(limit)" }

  /// 카드 머리. list 는 "저장 규칙 N/20"(0개면 안내 문구), limit·remove not_found 는 화면이 목록 카드를 이어 붙인다
  public static func headline(_ r: Response) -> String {
    switch r.status {
    case "duplicate": return Text.duplicate
    case "limit": return Text.limit
    case "bad_value": return Text.badValue
    case "not_found": return Text.notFound
    default:
      switch r.op {
      case "list": return r.rules.isEmpty ? Text.empty : listHead(count: r.rules.count)
      case "remove": return Text.removeTitle
      default: return Text.addTitle
      }
    }
  }

  public static func added(count: Int) -> String { "저장 규칙을 추가했어요 (\(count)/\(limit))" }
  /// 이어서 [함께 저장] 버튼
  public static func matchedLine(_ n: Int) -> String { "최근 폐기된 메시지 \(n)건이 이 규칙에 맞아요" }

  /// 채팅 판정 duplicate + 폐기분 → 기존 규칙 id 로 [함께 저장]. 추가 성공 뒤 [함께 저장]은 기록된 ruleID 로(P2 SaveRuleTurn, K23)
  public static func restoreRuleID(_ r: Response) -> String? {
    r.status == "duplicate" && r.matched > 0 ? r.matches.first?.id : nil
  }

  // MARK: 카드 버튼 POST /chat/rule — 서버는 모든 status 에서 칸을 싣지만 앱 디코드는 관대하게(PF-F12). status 가 없으면 nil = 버튼 실패

  /// status = added·duplicate·limit·bad_value. rule = 추가한(duplicate 면 기존) 규칙, matched = 그 규칙의 폐기분 수
  public struct AddResult: Decodable, Sendable {
    public let status: String; public let rule: Rule?; public let rules: [Rule]; public let matched: Int
    public init(from d: Decoder) throws {
      let c = try d.container(keyedBy: CodingKeys.self)
      status = try c.decode(String.self, forKey: .status)
      rule = try? c.decodeIfPresent(Rule.self, forKey: .rule)
      rules = (try? c.decodeIfPresent([Rule].self, forKey: .rules)) ?? []
      matched = (try? c.decodeIfPresent(Int.self, forKey: .matched)) ?? 0
    }
    private enum CodingKeys: String, CodingKey { case status, rule, rules, matched }
  }
  /// status = removed·not_found
  public struct RemoveResult: Decodable, Sendable {
    public let status: String; public let rules: [Rule]
    public init(from d: Decoder) throws {
      let c = try d.container(keyedBy: CodingKeys.self)
      status = try c.decode(String.self, forKey: .status)
      rules = (try? c.decodeIfPresent([Rule].self, forKey: .rules)) ?? []
    }
    private enum CodingKeys: String, CodingKey { case status, rules }
  }
  /// status = queued·none(지금은 맞는 항목 없음)·not_found(규칙이 없어짐)
  public struct RestoreResult: Decodable, Sendable {
    public let status: String; public let restored: Int
    public init(status: String, restored: Int) { self.status = status; self.restored = restored }
    public init(from d: Decoder) throws {
      let c = try d.container(keyedBy: CodingKeys.self)
      status = try c.decode(String.self, forKey: .status)
      restored = (try? c.decodeIfPresent(Int.self, forKey: .restored)) ?? 0
    }
    private enum CodingKeys: String, CodingKey { case status, restored }
  }
  public static func decodeAdd(_ data: Data) -> AddResult? { try? JSONDecoder().decode(AddResult.self, from: data) }
  public static func decodeRemove(_ data: Data) -> RemoveResult? { try? JSONDecoder().decode(RemoveResult.self, from: data) }
  public static func decodeRestore(_ data: Data) -> RestoreResult? { try? JSONDecoder().decode(RestoreResult.self, from: data) }

  /// [저장 규칙 추가] 결과 문구 — 채팅 판정과 같은 문구(스펙 "버튼 결과도 같은 문구다"). added 는 지금 규칙 수
  public static func addText(_ r: AddResult) -> String {
    switch r.status {
    case "added": return added(count: r.rules.count)
    case "duplicate": return Text.duplicate
    case "limit": return Text.limit
    case "bad_value": return Text.badValue
    default: return Text.buttonFailed
    }
  }
  /// [함께 저장] 결과 문구
  public static func restoreText(_ r: RestoreResult) -> String {
    switch r.status {
    case "queued": return "\(r.restored)건을 다시 저장하는 중이에요 — 끝나면 보관함에 보여요"
    case "none": return Text.none
    case "not_found": return Text.notFound
    default: return Text.buttonFailed
    }
  }

  public static func addBody(kind: String, value: String) -> [String: Any] { ["op": "add", "kind": kind, "value": value] }
  public static func removeBody(ruleID: String) -> [String: Any] { ["op": "remove", "rule_id": ruleID] }
  public static func restoreBody(ruleID: String) -> [String: Any] { ["op": "restore", "rule_id": ruleID] }
}
