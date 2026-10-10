import Foundation

/// 채팅 메일 요약(스펙 §7 "메일 요약"·§9 "채팅 메일 요약", 앱 0.15.0): 서버 응답 해석·문구·바로 읽기/후보 판단·이어서 읽기 판단만. 네트워크·화면은 앱이 한다.
/// 후보 줄·요약·번역은 이 기기 대화 기록에만 둔다 — DiagLog·trace 에 쓰지 않는다
public enum MailSummary {
  public static let intent = "mail_summary"
  public static let tokenTTL: TimeInterval = 600                 // 후보·읽기 토큰 10분(서버가 원본 — 410 token_expired)
  public static func isMailSummary(_ intent: String?) -> Bool { intent == Self.intent }

  public struct Conditions: Codable, Sendable, Equatable {
    public let sender: String?
    public let subject_words: [String]
    public let received_from: String?
    public let received_to: String?
    public let latest: Bool
    public let translate: Bool
    public init(sender: String?, subject_words: [String], received_from: String?, received_to: String?, latest: Bool, translate: Bool) {
      self.sender = sender; self.subject_words = subject_words; self.received_from = received_from; self.received_to = received_to
      self.latest = latest; self.translate = translate
    }
    /// [다시 찾기] 요청 본문 — 서버가 확정한 칸 그대로
    public var json: [String: Any] {
      ["sender": sender.map { $0 as Any } ?? NSNull(), "subject_words": subject_words, "received_from": received_from.map { $0 as Any } ?? NSNull(),
       "received_to": received_to.map { $0 as Any } ?? NSNull(), "latest": latest, "translate": translate]
    }
  }
  public struct Candidate: Codable, Sendable, Equatable {
    public let token: String; public let from: String; public let subject: String; public let date: String
    public init(token: String, from: String, subject: String, date: String) { self.token = token; self.from = from; self.subject = subject; self.date = date }
  }
  public struct Search: Codable, Sendable, Equatable {
    public let conditions: Conditions; public let candidates: [Candidate]; public let complete: Bool; public let more: Bool
    public init(conditions: Conditions, candidates: [Candidate], complete: Bool, more: Bool) {
      self.conditions = conditions; self.candidates = candidates; self.complete = complete; self.more = more
    }
  }
  public struct Summary: Codable, Sendable, Equatable { public let lines: [String]; public let dates: [String]; public let amounts: [String]; public let todos: [String] }
  public struct Read: Codable, Sendable, Equatable {
    public let status: String                  // ok · ask · otp · no_body
    public let token: String                   // 같은 메일, 지금 + 10분(이어서 읽기)
    public let from: String; public let subject: String; public let date: String
    public let summary: Summary?
    public let language: String
    public let translation: String?
    public let translation_truncated: Bool
    public let body_truncated: Bool
    public let attachments: Int
    public let ask: String?
  }
  public static func search(_ d: Data) -> Search? { try? JSONDecoder().decode(Search.self, from: d) }
  public static func read(_ d: Data) -> Read? { try? JSONDecoder().decode(Read.self, from: d) }

  /// chat 응답 mail_read 칸에서 앱이 직접 쓰는 두 값(나머지는 해석하지 않고 그대로 서버에 보낸다). target_in_message 가 없으면 참 — 검색으로(앞 메일을 다시 읽지 않게).
  /// 칸이 null·없음이면 "대상 없음"(최종 리뷰 I1 — 모델은 말하지 않은 조건을 채우지 않는다): 직전 요약 뒤엔 이어서 읽기, 아니면 빈 칸 검색 → 서버 needs_target 되묻기
  public struct Fields: Equatable, Sendable {
    public let translate: Bool; public let targetInMessage: Bool
    public init(translate: Bool, targetInMessage: Bool) { self.translate = translate; self.targetInMessage = targetInMessage }
  }
  public static func fields(_ v: JSONValue?) -> Fields? {
    switch v {
    case nil, .null?: return Fields(translate: false, targetInMessage: false)
    case .object(let o)?:
      func flag(_ k: String, _ fallback: Bool) -> Bool { if case .bool(let b)? = o[k] { return b }; return fallback }
      return Fields(translate: flag("translate", false), targetInMessage: flag("target_in_message", true))
    default: return nil
    }
  }
  /// 검색 요청 본문 — mail_read 칸 그대로, null·없음이면 빈 칸(서버가 needs_target). 객체도 null 도 아니면 nil(요약 실패)
  public static func searchBody(_ v: JSONValue?) -> [String: Any]? {
    switch v {
    case nil, .null?: return [:]
    case .object?: return v?.foundation as? [String: Any]
    default: return nil
    }
  }

  /// 검색 결과 다음 단계(스펙 §9 턴 흐름): 완결일 때만 0통 = 없음, 1통이거나 latest 면 바로 읽기. 미완결이면 1통이어도 카드
  public enum Step: Equatable, Sendable { case none(String), readFirst, choose }
  public static func afterSearch(_ s: Search) -> Step {
    if s.candidates.isEmpty { return .none(s.complete ? MailSummaryText.noneFound : MailSummaryText.notAllChecked) }
    if s.complete && (s.candidates.count == 1 || s.conditions.latest) { return .readFirst }
    return .choose
  }

  /// 문구 + [설정 열기] · retry = "그 밖" 실패(후보 카드에서 고른 읽기면 10분 안 후보를 되살린다 — 읽기는 Gmail 을 바꾸지 않는다)
  public struct Note: Equatable, Sendable {
    public let text: String; public let settings: Bool; public let retry: Bool
    public init(_ text: String, settings: Bool = false, retry: Bool = false) { self.text = text; self.settings = settings; self.retry = retry }
  }
  private static func common(_ status: Int, _ code: String?) -> Note? {
    switch (status, code) {
    case (404, "no_connection"?): return Note(MailSummaryText.noConnection)
    case (409, _): return Note(MailSummaryText.reauth, settings: true)
    case (403, _): return Note(MailSummaryText.scope, settings: true)
    case (429, "budget_exhausted"?): return Note(MailSummaryText.budget)
    case (429, _): return Note(MailSummaryText.busy)
    case (503, "disabled"?): return Note(MailSummaryText.disabled)
    case (503, _): return Note(MailSummaryText.llmBusy)
    default: return nil
    }
  }
  public static func searchError(status: Int, code: String?) -> Note {
    if let n = common(status, code) { return n }
    switch (status, code) {
    case (400, "needs_target"?): return Note(MailSummaryText.needsTarget)
    case (400, "bad_condition"?): return Note(MailSummaryText.badCondition)
    default: return Note(MailSummaryText.failed, retry: true)
    }
  }
  public static func readError(status: Int, code: String?) -> Note {
    if let n = common(status, code) { return n }
    switch (status, code) {
    case (404, "mail_gone"?): return Note(MailSummaryText.gone)
    case (404, _): return Note(MailSummaryText.refind)
    case (410, _): return Note(MailSummaryText.followExpired)
    case (400, "bad_token"?), (400, "bad_request"?): return Note(MailSummaryText.failed)   // 같은 토큰으로 다시 눌러도 같은 400 — 되살리지 않는다(A1 리뷰)
    default: return Note(MailSummaryText.failed, retry: true)
    }
  }
  /// llm_busy(503)만 첫 시도에서 5초 뒤 한 번 더(chat 과 같다). disabled(503)는 다시 보내지 않는다
  public static func retryDelay(status: Int, code: String?, attempt: Int) -> TimeInterval? { status == 503 && code == "llm_busy" && attempt == 0 ? 5 : nil }

  /// 이어서 읽기(스펙 §9, D18): 바로 앞 레코드가 요약 턴(읽기 status ok·ask)이고 30분 안이고 지금 글이 대상을 직접 말하지 않았으면 앞 토큰
  public enum FollowUp: Equatable, Sendable { case none, token(String), expired }
  public static func followUp(_ records: [ChatHistory.Record], current: UUID, now: Date, targetInMessage: Bool) -> FollowUp {
    guard !targetInMessage, let i = records.firstIndex(where: { $0.id == current }), i > 0 else { return .none }
    let prev = records[i - 1], cur = records[i]
    guard prev.kind == .mailSummary, !ChatHistory.isBreak(previous: prev.at, current: cur.at), let t = prev.mailRead, let r = t.read,
          ["ok", "ask"].contains(r.status), let readAt = t.readAt else { return .none }
    return now.timeIntervalSince(readAt) >= tokenTTL ? .expired : .token(r.token)
  }

  /// 후보 카드 조건 줄 — 서버가 확정한 conditions 로만(메일 정리 조건 줄과 같은 날짜 표기, 서울 기준 올해가 아니면 연도)
  public static func conditionLine(_ c: Conditions, now: Date = Date()) -> String {
    let year = MailCleanup.seoulYear(now)
    let show = { (x: (y: Int, md: String)) in x.y == year ? x.md : "\(x.y)/\(x.md)" }
    var parts: [String] = []
    if let s = c.sender { parts.append("발신자 '\(s)'") }
    if !c.subject_words.isEmpty { parts.append("제목 " + c.subject_words.map { "'\($0)'" }.joined(separator: " ")) }
    switch (c.received_from.flatMap(MailCleanup.ymd), c.received_to.flatMap(MailCleanup.ymd)) {
    case let (a?, b?):
      if a.y == b.y && a.md == b.md { parts.append(show(a)) } else { parts.append("\(show(a))–\(a.y == b.y ? b.md : show(b))") }
    case let (a?, nil): parts.append("\(show(a))부터")
    case let (nil, b?): parts.append("\(show(b))까지")
    default: break
    }
    if c.latest { parts.append("가장 최근") }
    return parts.joined(separator: " · ")
  }
  /// 후보 줄 `발신자 · 제목 · M/D`(올해가 아니면 `Y/M/D`, 비면 "(보낸 사람 없음)"·"(제목 없음)") — 메일 정리 표본 줄과 같다
  public static func candidateLine(_ c: Candidate, now: Date = Date()) -> String {
    MailCleanup.sampleLine(MailCleanup.Sample(from: c.from, subject: c.subject, date: c.date), now: now)
  }
  nonisolated(unsafe) private static let isoFrac: ISO8601DateFormatter = {
    let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f
  }()
  nonisolated(unsafe) private static let isoPlain = ISO8601DateFormatter()
  private static let weekdays = ["일", "월", "화", "수", "목", "금", "토"]
  /// 받은 시각 → 서울 `M/D(요) HH:mm`(올해가 아니면 `Y/` 앞붙임)
  public static func receivedLine(_ iso: String, now: Date = Date()) -> String? {
    guard let d = isoFrac.date(from: iso) ?? isoPlain.date(from: iso) else { return nil }
    let c = MailCleanup.seoulCalendar().dateComponents([.year, .month, .day, .weekday, .hour, .minute], from: d)
    guard let y = c.year, let m = c.month, let day = c.day, let w = c.weekday, let h = c.hour, let mi = c.minute else { return nil }
    let md = "\(m)/\(day)(\(weekdays[w - 1])) " + String(format: "%02d:%02d", h, mi)
    return y == MailCleanup.seoulYear(now) ? md : "\(y)/\(md)"
  }
  public static func header(_ r: Read) -> String {
    [r.from.isEmpty ? "(보낸 사람 없음)" : r.from, r.subject.isEmpty ? "(제목 없음)" : r.subject].joined(separator: " · ")
  }
  /// 요약 카드 본문: 요약(+번역 절·번역 안내) · 질문 한 문장 · 상태 문구
  public enum Body: Equatable, Sendable { case summary(Summary, translation: String?, translationNote: String?), ask(String), note(String) }
  public static func body(_ r: Read, translate: Bool) -> Body {
    switch r.status {
    case "ok":
      guard let s = r.summary else { return .note(MailSummaryText.failed) }
      guard translate else { return .summary(s, translation: nil, translationNote: nil) }
      if r.language == "ko" { return .summary(s, translation: nil, translationNote: MailSummaryText.koreanNoTranslate) }
      // 번역이 빠진 응답은 조용히 넘기지 않는다 — 요약 아래 한 줄(스펙 §9 오류 문구, A1 리뷰)
      guard let t = r.translation else { return .summary(s, translation: nil, translationNote: MailSummaryText.translationMissing) }
      return .summary(s, translation: t, translationNote: r.translation_truncated ? MailSummaryText.translationTruncated : nil)
    case "ask":
      guard let q = r.ask, !q.isEmpty else { return .note(MailSummaryText.failed) }   // 빈 질문 대신 실패 문구(A1 리뷰)
      return .ask(q)
    case "otp": return .note(MailSummaryText.otp)
    case "no_body": return .note(MailSummaryText.noBody)
    default: return .note(MailSummaryText.failed)
    }
  }
  /// 꼬리 줄(작은 글씨): 잘림 · 첨부 미열람 · 늘 "서버에 저장하지 않아요"(§12 통제 5)
  public static func footer(_ r: Read) -> [String] {
    var out: [String] = []
    if r.body_truncated { out.append(MailSummaryText.bodyTruncated) }
    if r.attachments > 0 { out.append(MailSummaryText.attachments(r.attachments)) }
    out.append(MailSummaryText.notStored)
    return out
  }
  /// "복사" — 머리·요약 줄·절·번역을 일반 글로
  public static func copyText(_ r: Read, translate: Bool) -> String {
    var out = [header(r)]
    switch body(r, translate: translate) {
    case let .summary(s, t, n):
      out += s.lines.map { "• " + $0 }
      for (title, xs) in [(MailSummaryText.datesTitle, s.dates), (MailSummaryText.amountsTitle, s.amounts), (MailSummaryText.todosTitle, s.todos)] where !xs.isEmpty {
        out.append(title); out += xs
      }
      if let t { out.append(MailSummaryText.translationTitle); out.append(t) }
      if let n { out.append(n) }
    case let .ask(q): out.append(q)
    case let .note(n): out.append(n)
    }
    return out.joined(separator: "\n")
  }
}

/// 스펙 §9 "채팅 메일 요약" 문구. 바꾸면 이 파일과 그 테스트만 고친다
public enum MailSummaryText {
  public static let finding = "메일을 찾는 중…", reading = "메일을 읽는 중…"
  public static func header(translate: Bool) -> String { translate ? "어떤 메일을 번역할까요?" : "어떤 메일을 요약할까요?" }
  public static func pickLatest(complete: Bool) -> String { complete ? "가장 최근 것" : "이 중 가장 최근 것" }
  public static func moreLine(complete: Bool, more: Bool) -> String? {
    guard more else { return nil }
    return complete ? "조건에 맞는 메일이 더 있어요 — 발신자·제목·기간을 더 말해 주면 좁혀 볼게요"
      : "조건에 맞는 메일이 많아 일부만 보여요 — 최근 순이 아닐 수 있어요. 발신자·제목·기간을 더 말해 주면 좁혀 볼게요"
  }
  public static let noneFound = "조건에 맞는 메일을 찾지 못했어요(받은편지함과 보관된 메일에서 찾아요 — 휴지통·스팸은 빼요)"
  public static let notAllChecked = "조건에 맞는 메일이 많아 다 확인하지 못했어요 — 발신자·제목·기간을 더 말해 주세요"
  public static let candidatesExpired = "후보를 고를 시간(10분)이 지났어요", research = "다시 찾기"
  public static let datesTitle = "날짜", amountsTitle = "금액", todosTitle = "할 일", translationTitle = "전문 번역", copy = "복사"
  public static let translationTruncated = "번역이 길어 앞부분만 옮겼어요 — 나머지는 Gmail에서 확인해 주세요"
  public static let koreanNoTranslate = "한국어 메일이라 번역하지 않았어요"
  public static let translationMissing = "번역은 하지 못했어요 — 다시 '번역해줘'라고 해 주세요"
  public static let bodyTruncated = "메일이 길어 앞부분만 읽고 요약했어요"
  public static func attachments(_ n: Int) -> String { "첨부 \(n)개는 읽지 않았어요" }
  public static let notStored = "본문은 요약할 때만 읽고 ERURI 서버에 저장하지 않아요"
  public static let otp = "인증번호가 담긴 메일이라 요약하지 않았어요 — Gmail에서 직접 확인해 주세요"
  public static let noBody = "이 메일은 읽을 수 있는 본문이 없어요(첨부나 이미지로만 된 메일일 수 있어요)"
  public static let needsTarget = "어떤 메일인지 발신자·제목·받은 날짜 중 하나를 함께 말해 주세요. 예: \"어제 합성상점에서 온 메일 요약해줘\""
  public static let noConnection = "Gmail이 연결되어 있지 않아요"
  public static let reauth = "Gmail 연결이 끊겼어요 — 설정 › Gmail에서 다시 연결해 주세요"
  public static let scope = "Gmail 권한을 확인하지 못했어요 — 설정 › Gmail에서 다시 연결해 주세요"
  public static let badCondition = "조건을 정확히 알아듣지 못했어요 — 발신자·제목·기간을 다시 말해 주세요"
  public static let gone = "그 메일을 찾을 수 없어요 — 지워졌거나 휴지통·스팸으로 옮겨졌을 수 있어요"
  public static let refind = "메일을 다시 찾아야 해요 — 다시 요청해 주세요"
  public static let followExpired = "앞 메일을 읽은 지 10분이 지났어요 — 발신자나 제목으로 다시 말해 주세요"
  public static let busy = "Gmail이 잠시 바빠요 — 잠시 뒤 다시 요청해 주세요"
  public static let budget = "이번 달 예산을 다 써서 요약할 수 없습니다(수집은 계속됩니다)"
  public static let llmBusy = "잠시 뒤 다시 물어보세요"
  public static let disabled = "메일 요약을 지금 쓸 수 없어요"
  public static let failed = "메일을 요약하지 못했어요 — 잠시 뒤 다시 해 주세요"
  public static let interrupted = "앱이 닫혀 메일을 읽지 못했어요 — 다시 요청해 주세요."
  public static let openSettings = "설정 열기"
}

/// 대화 기록의 메일 요약 턴(스펙 §9 "대화 기록"): 서버가 확정한 조건·후보 줄(토큰 포함)·고른 줄·읽기 결과·마지막 토큰·단계. 이 기기에만, 30일, 맥락으로 보내지 않는다.
/// 관대한 디코드: 모르는 단계는 끝난 것으로, 없는 키는 기본값, 모르는 키는 무시(0.14.0 메일 턴과 같은 규칙)
public struct MailSummaryTurn: Codable, Sendable, Equatable {
  public enum Phase: String, Codable, Sendable {
    case finding, choosing, reading, ended
    public init(from decoder: Decoder) throws {
      self = Phase(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .ended
    }
  }
  public var phase: Phase
  public var translate: Bool                     // 읽기 요청의 translate(검색이면 서버 conditions.translate)
  public var conditions: MailSummary.Conditions?
  public var candidates: [MailSummary.Candidate]?
  public var complete: Bool?
  public var more: Bool?
  public var issuedAt: Date?                     // 후보 토큰 발급 시각(10분)
  public var picked: Int?                        // 고른 후보(그 줄만 남긴다)
  public var read: MailSummary.Read?
  public var readAt: Date?                       // 읽기 응답(새 토큰) 받은 시각 — 이어서 읽기 10분
  public var note: String?
  public var settings: Bool
  public init(phase: Phase = .finding, translate: Bool = false, note: String? = nil, settings: Bool = false) {
    self.phase = phase; self.translate = translate; self.note = note; self.settings = settings
  }
  enum CodingKeys: String, CodingKey { case phase, translate, conditions, candidates, complete, more, issuedAt, picked, read, readAt, note, settings }
  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    phase = (try? c.decode(Phase.self, forKey: .phase)) ?? .ended
    translate = (try? c.decodeIfPresent(Bool.self, forKey: .translate)) ?? false
    conditions = try? c.decodeIfPresent(MailSummary.Conditions.self, forKey: .conditions)
    candidates = try? c.decodeIfPresent([MailSummary.Candidate].self, forKey: .candidates)
    complete = try? c.decodeIfPresent(Bool.self, forKey: .complete)
    more = try? c.decodeIfPresent(Bool.self, forKey: .more)
    issuedAt = try? c.decodeIfPresent(Date.self, forKey: .issuedAt)
    picked = try? c.decodeIfPresent(Int.self, forKey: .picked)
    read = try? c.decodeIfPresent(MailSummary.Read.self, forKey: .read)
    readAt = try? c.decodeIfPresent(Date.self, forKey: .readAt)
    note = try? c.decodeIfPresent(String.self, forKey: .note)
    settings = (try? c.decodeIfPresent(Bool.self, forKey: .settings)) ?? false
  }
  public mutating func apply(_ n: MailSummary.Note) { note = n.text; settings = n.settings }
  /// 후보 카드를 아직 누를 수 있는가(서버가 원본 — 410). 발급 시각이 없으면 지난 것으로
  public func candidatesExpired(now: Date) -> Bool { issuedAt.map { now.timeIntervalSince($0) >= MailSummary.tokenTTL } ?? true }
  /// 후보 카드를 1초마다 다시 그려야 하는가: 고르는 중이고 아직 만료 전 — 만료 순간 [다시 찾기]로 바뀌게(A3 리뷰). 만료 뒤·다른 단계는 다시 그리지 않는다.
  /// 유한 날짜 목록(.explicit) 일정은 채팅 List 셀에서 tick 이 오지 않아(G1 A4③ 재현) 끝없는 .periodic 을 쓴다
  public func candidatesLive(now: Date) -> Bool { phase == .choosing && !candidatesExpired(now: now) }
  /// 읽기 실패 뒤 턴(스펙 §9 오류): 카드에서 고른 읽기가 410 이면 만료 카드([다시 찾기] — 앱 발급 시각이 서버 서명보다 늦어 생기는 경합, A3 리뷰).
  /// 카드에서 고른 "그 밖" 실패는 10분 안이면 후보를 되살린다. 나머지는 끝
  public mutating func readFailed(_ n: MailSummary.Note, status: Int, fromCard: Bool, now: Date) {
    if fromCard && status == 410 {
      phase = .choosing; picked = nil; issuedAt = .distantPast; note = nil; settings = false
      return
    }
    let canRetry = fromCard && n.retry && !candidatesExpired(now: now)
    phase = canRetry ? .choosing : .ended
    if canRetry { picked = nil }
    apply(n)
  }
}
