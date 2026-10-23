import Foundation

/// 목록 요약(스펙 §9 "목록 카드", 앱 0.19.0): 쪽 크기·꼬리·머리·줄 문구·카드 오류 판단만. 네트워크·화면은 앱. 줄 글은 기록에만 — DiagLog·trace 금지
public enum MailDigest {
  public static let pageSize = 10
  /// 첫 검색 limit = min(10, count) — count 가 없으면 10
  public static func firstLimit(count: Int?) -> Int { min(pageSize, count ?? pageSize) }
  /// [다음] limit: count 가 없으면 10, 있으면 min(10, 남은 통수). 남은 통수가 없으면 nil(꼬리 없음)
  public static func nextLimit(count: Int?, rows: Int) -> Int? {
    guard let count else { return pageSize }
    let rem = count - rows
    return rem > 0 ? min(pageSize, rem) : nil
  }

  /// /mail-read/digest 줄 하나(§7 "응답"): status ok·failed·expired·rejected, failed 도 검사를 통과했으면 새 토큰(DP28)
  public struct Result: Codable, Sendable, Equatable {
    public let status: String; public let token: String?; public let lines: [String]; public let note: String?; public let code: String?
    public init(status: String, token: String?, lines: [String], note: String?, code: String?) {
      self.status = status; self.token = token; self.lines = lines; self.note = note; self.code = code
    }
  }
  private struct Body: Decodable { let results: [Result] }
  /// 응답 줄 수가 보낸 토큰 수와 다르면 nil — 줄과 메일이 어긋나 섞이지 않게(입력 순서 그대로가 계약)
  public static func results(_ d: Data, expected: Int) -> [Result]? {
    guard let b = try? JSONDecoder().decode(Body.self, from: d), b.results.count == expected else { return nil }
    return b.results
  }

  /// 머리(D-M14): 발신자 → 제목 단어 → 받은 기간(하루·범위·한쪽 끝 "까지"·"부터", 올해가 아니면 Y/M/D) → "최근". rows 0 = 줄 없는 카드(DP29) — 통수 없음
  public static func header(_ c: MailSummary.Conditions, rows: Int, now: Date) -> String {
    let year = MailCleanup.seoulYear(now)
    let show = { (x: (y: Int, md: String)) in x.y == year ? x.md : "\(x.y)/\(x.md)" }
    let head: String
    if let s = c.sender { head = s }
    else if !c.subject_words.isEmpty { head = c.subject_words.map { "'\($0)'" }.joined(separator: " ") }
    else {
      switch (c.received_from.flatMap(MailCleanup.ymd), c.received_to.flatMap(MailCleanup.ymd)) {
      case let (a?, b?): head = (a.y == b.y && a.md == b.md) ? show(a) : "\(show(a))–\(a.y == b.y ? b.md : show(b))"
      case let (a?, nil): head = "\(show(a))부터"
      case let (nil, b?): head = "\(show(b))까지"
      default: head = "최근"
      }
    }
    return rows == 0 ? "\(head) 메일" : "\(head) 메일 \(rows)통"
  }
  /// 줄 머리 `발신자 · M/D`(서울 날짜, 올해가 아니면 `Y/M/D`, 발신자가 비면 "(보낸 사람 없음)"). 서버 date 는 UTC ISO — 서울로 바꿔 센다
  public static func rowHead(_ c: MailSummary.Candidate, now: Date) -> String {
    let from = c.from.isEmpty ? "(보낸 사람 없음)" : c.from
    guard let day = MailCleanup.seoulDay(c.date, now: now) else { return from }
    return "\(from) · \(day)"
  }
  public static func rowTitle(_ c: MailSummary.Candidate) -> String { c.subject.isEmpty ? "(제목 없음)" : c.subject }
  /// 줄 본문 문구. nil = 요약 줄을 그린다
  public static func rowBody(_ r: MailDigestTurn.Row) -> String? {
    switch r.state {
    case .pending: return MailDigestText.loading
    case .ok: return r.note == "otp" ? MailDigestText.otp : r.note == "no_body" ? MailDigestText.noBody : nil
    case .failed: return r.code == "mail_gone" ? MailDigestText.gone : MailDigestText.failed
    case .expired: return MailDigestText.failed
    case .rejected: return MailDigestText.rejected
    }
  }
  /// llm_busy(503)만 첫 시도에서 5초 뒤 한 번 더(상세 요약과 같다)
  public static func retryDelay(status: Int, code: String?, attempt: Int) -> TimeInterval? { status == 503 && code == "llm_busy" && attempt == 0 ? 5 : nil }
}

/// 스펙 §9 "목록 카드" 문구. 바꾸면 이 파일과 그 테스트만 고친다
public enum MailDigestText {
  public static let loading = "요약 중…", retry = "다시", research = "다시 찾기", more = "더 있어요"
  public static func moreButton(_ n: Int) -> String { "다음 \(n)통" }
  public static let capped = "한 번에 최대 30통까지 요약해요"
  public static let partial = "조건에 맞는 메일이 많아 이번엔 일부만 확인했어요 — [다음]으로 이어 볼 수 있어요"
  public static let otp = "인증번호 메일이라 요약하지 않았어요", noBody = "읽을 수 있는 본문이 없어요"
  public static let failed = "읽지 못했어요", rejected = "읽지 못했어요"
  public static let gone = "메일을 찾을 수 없어요 — 지워졌거나 옮겨졌을 수 있어요"
  public static let expiredTail = "목록이 오래됐어요"
  public static let rowExpiredRead = "목록이 오래됐어요 — 위 목록에서 [다시 찾기]를 눌러 주세요"
  public static let unavailable = "지금 요약할 수 없어요. 관리자에게 문의하세요"
}

/// 대화 기록의 목록 요약 턴(스펙 §9 "보존"): 입력 글·conditions·줄(후보·상태·요약 줄·note·code)·next_cursor·단계. 이 기기에만 30일, 맥락으로 보내지 않는다.
/// 관대한 디코드: 모르는 단계는 idle, 모르는 줄 상태는 failed, 없는 키는 기본값, 모르는 키는 무시
public struct MailDigestTurn: Codable, Sendable, Equatable {
  /// finding = 첫 검색 · loading = 검색·digest 진행(잠금) · idle · ended = 카드 전체가 끝남(DP18)
  public enum Phase: String, Codable, Sendable {
    case finding, loading, idle, ended
    public init(from decoder: Decoder) throws { self = Phase(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .idle }
  }
  public enum RowState: String, Codable, Sendable {
    case pending, ok, failed, expired, rejected
    public init(from decoder: Decoder) throws { self = RowState(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .failed }
  }
  public struct Row: Codable, Sendable, Equatable {
    public var candidate: MailSummary.Candidate; public var state: RowState; public var lines: [String]; public var note: String?; public var code: String?
    public var opening: Bool = false            // 줄 탭 상세를 여는 중 — 한 번만(Review Focus 3)
  }
  public enum Tail: Equatable, Sendable { case none, more(Int), expired }

  public var question: String
  public var phase: Phase
  public var conditions: MailSummary.Conditions?
  public var rows: [Row]
  public var nextCursor: String?
  public var complete: Bool
  public var countCapped: Bool
  public var expired: Bool
  public var blocked: Bool                    // llm_unavailable·disabled — [다시] 숨김(DP19)
  public var note: String?
  public var settings: Bool
  public var requestGen: Int                  // 요청 세대(DP30) — 잠금과 늦은 응답 무시

  public init(question: String, phase: Phase = .finding) {
    self.question = question; self.phase = phase; conditions = nil; rows = []; nextCursor = nil; complete = true
    countCapped = false; expired = false; blocked = false; note = nil; settings = false; requestGen = 0
  }
  enum CodingKeys: String, CodingKey { case question, phase, conditions, rows, nextCursor, complete, countCapped, expired, blocked, note, settings, requestGen }
  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    question = (try? c.decodeIfPresent(String.self, forKey: .question)) ?? ""
    phase = (try? c.decodeIfPresent(Phase.self, forKey: .phase)) ?? .idle
    conditions = try? c.decodeIfPresent(MailSummary.Conditions.self, forKey: .conditions)
    rows = (try? c.decodeIfPresent([Row].self, forKey: .rows)) ?? []
    nextCursor = try? c.decodeIfPresent(String.self, forKey: .nextCursor)
    complete = (try? c.decodeIfPresent(Bool.self, forKey: .complete)) ?? true
    countCapped = (try? c.decodeIfPresent(Bool.self, forKey: .countCapped)) ?? false
    expired = (try? c.decodeIfPresent(Bool.self, forKey: .expired)) ?? false
    blocked = (try? c.decodeIfPresent(Bool.self, forKey: .blocked)) ?? false
    note = try? c.decodeIfPresent(String.self, forKey: .note)
    settings = (try? c.decodeIfPresent(Bool.self, forKey: .settings)) ?? false
    requestGen = (try? c.decodeIfPresent(Int.self, forKey: .requestGen)) ?? 0
  }

  public var canAct: Bool { phase == .idle }
  /// 꼬리(§9): 만료면 "목록이 오래됐어요 [다시 찾기]", next_cursor 가 있고 count 를 다 채우지 않았으면 [다음 N통]
  public var tail: Tail {
    if expired { return .expired }
    guard nextCursor != nil, let n = MailDigest.nextLimit(count: conditions?.count, rows: rows.count) else { return .none }
    return .more(n)
  }
  /// 검색 결과로 줄을 그린다(각 줄 "요약 중…"). append = [다음] — 같은 카드 아래 이어 붙이고 조건·count_capped·blocked 는 첫 검색 것 그대로(막힌 카드에 [다시]가 되살아나지 않게)
  public mutating func applySearch(_ s: MailSummary.Search, append: Bool) {
    let new = s.candidates.map { Row(candidate: $0, state: .pending, lines: [], note: nil, code: nil) }
    rows = append ? rows + new : new
    if !append { conditions = s.conditions; countCapped = s.count_capped ?? false; blocked = false }
    nextCursor = s.next_cursor; complete = s.complete; expired = false; note = nil; settings = false
  }
  /// digest 결과(입력 순서)를 그 줄들에 채운다. 새 토큰으로 바꿔 줄 탭·[다시]가 만료되지 않게
  public mutating func applyDigest(_ rs: [MailDigest.Result], rows idx: [Int]) {
    for (k, i) in idx.enumerated() where rows.indices.contains(i) && rs.indices.contains(k) {
      let r = rs[k]
      rows[i].state = RowState(rawValue: r.status) ?? .failed
      rows[i].lines = r.lines; rows[i].note = r.note; rows[i].code = r.code
      if let t = r.token { rows[i].candidate = MailSummary.Candidate(token: t, from: rows[i].candidate.from, subject: rows[i].candidate.subject, date: rows[i].candidate.date) }
      if rows[i].state == .expired { expired = true }
    }
    phase = .idle
  }
  /// 카드 전체 오류(DP19): 정형 문구가 있으면 문구, 남은 pending 줄은 failed
  public mutating func applyCardError(status: Int, code: String?, rows idx: [Int]) {
    for i in idx where rows.indices.contains(i) && rows[i].state == .pending { rows[i].state = .failed; rows[i].code = code }
    switch (status, code) {
    case (503, "llm_unavailable"?): note = MailDigestText.unavailable; blocked = true
    case (503, "disabled"?): note = MailSummaryText.disabled; blocked = true
    case (503, "llm_busy"?): note = MailSummaryText.llmBusy
    case (429, "budget_exhausted"?): note = MailSummaryText.budget
    case (429, _): note = MailSummaryText.busy
    case (409, _): note = MailSummaryText.reauth; settings = true
    case (404, "no_connection"?): note = MailSummaryText.noConnection
    case (410, _): expired = true
    default: break                                                   // gmail_upstream·internal·네트워크: 줄만(D-M17)
    }
    phase = .idle
  }
  /// 첫 검색·[다시 찾기] 결과(DP29): 줄을 바꾸고 digest 할 줄 색인을 돌려준다. 0통 + next_cursor 는 줄 없는 카드(꼬리 [다음]), 0통·커서 없음은 afterSearch 문구로 끝
  public mutating func applyFirst(_ s: MailSummary.Search) -> [Int] {
    applySearch(s, append: false)
    if !rows.isEmpty { phase = .loading; return Array(rows.indices) }
    if s.next_cursor == nil, case .none(let text) = MailSummary.afterSearch(s) { phase = .ended; note = text } else { phase = .idle }
    return []
  }
  /// [다음]·[다시 찾기]·줄 [다시]: 첫 네트워크 호출 전에 부른다(DP30). 잠겨 있으면 nil — 아무것도 보내지 않는다
  public mutating func beginRequest() -> Int? {
    guard canAct else { return nil }
    requestGen += 1; phase = .loading; return requestGen
  }
  public func isCurrent(_ gen: Int) -> Bool { gen == requestGen }
  /// 이 세대의 오류: 문구(있으면)와 함께 잠금을 푼다. 지난 세대면 아무것도 하지 않는다
  public mutating func failRequest(_ gen: Int, note text: String?) {
    guard isCurrent(gen) else { return }
    if let text { note = text }
    phase = .idle
  }
  /// [다시]: failed 줄이고 mail_gone 이 아니고(D-M15) 카드가 막히거나(DP19) 만료되지 않았을 때
  public func canRetry(_ r: Row) -> Bool { r.state == .failed && r.code != "mail_gone" && !blocked && !expired }
  public mutating func markExpired() { expired = true }
  /// 줄 탭: ok 줄을 한 번만 연다(연타로 상세 턴·비용이 두 번 생기지 않게)
  public mutating func beginOpen(_ i: Int) -> Bool {
    guard rows.indices.contains(i), rows[i].state == .ok, !rows[i].opening else { return false }
    rows[i].opening = true; return true
  }
  public mutating func endOpen(_ i: Int) { if rows.indices.contains(i) { rows[i].opening = false } }
  /// 다시 열 때(§9 "보존"): 첫 검색 응답 전(줄 없음)이면 "앱이 닫혀…"로 끝내고, "요약 중…" 줄은 실패 줄로 끝낸다(다시 보내지 않는다 — 비용)
  public mutating func restoredForReopen() {
    if phase == .finding && rows.isEmpty { phase = .ended; note = MailSummaryText.interrupted; return }
    for i in rows.indices where rows[i].state == .pending { rows[i].state = .failed }
    for i in rows.indices { rows[i].opening = false }
    if phase == .finding || phase == .loading { phase = .idle }
  }
}

// 관대한 디코드는 extension 에 둔다 — 구조체 본문에 두면 멤버별 init(Row(candidate:state:lines:note:code:))이 사라진다(PF-14)
extension MailDigestTurn.Row {
  enum CodingKeys: String, CodingKey { case candidate, state, lines, note, code, opening }
  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    candidate = try c.decode(MailSummary.Candidate.self, forKey: .candidate)
    state = (try? c.decodeIfPresent(MailDigestTurn.RowState.self, forKey: .state)) ?? .failed
    lines = (try? c.decodeIfPresent([String].self, forKey: .lines)) ?? []
    note = try? c.decodeIfPresent(String.self, forKey: .note)
    code = try? c.decodeIfPresent(String.self, forKey: .code)
    opening = (try? c.decodeIfPresent(Bool.self, forKey: .opening)) ?? false
  }
}
