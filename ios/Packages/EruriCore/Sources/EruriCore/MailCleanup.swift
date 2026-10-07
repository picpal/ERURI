import Foundation

/// 채팅 메일 정리(스펙 §7 "메일 정리"·§9 "채팅 메일 정리", 앱 0.14.0): 서버 응답 해석·문구·시간 판단만. 네트워크·화면은 앱이 한다.
/// 미리보기 글(발신자·제목·날짜)은 이 기기 대화 기록에만 둔다 — DiagLog·trace 에 쓰지 않는다
public enum MailCleanup {
  public static let intent = "mail_action"
  public static let modifyScope = "https://www.googleapis.com/auth/gmail.modify"
  public static let tokenTTL: TimeInterval = 600              // 확인 토큰 10분(서버가 원본 — 410 token_expired)
  public static let undoTTL: TimeInterval = 7 * 86_400        // 되돌리기 7일(서버가 원본 — 410 undo_expired)
  public static let pollInterval: Duration = .seconds(3)
  public static let pollLimit: TimeInterval = 20 * 60         // 한 번 읽기 시작해 이어 읽는 상한(넘으면 진행 중 그대로 "아직 처리 중이에요", D14·D22)

  public static func isMailAction(_ intent: String?) -> Bool { intent == Self.intent }

  public struct Conditions: Codable, Sendable, Equatable {
    public let action: String
    public let sender: String?
    public let subject_words: [String]
    public let received_from: String?
    public let received_to: String?
    public let promotions: Bool
    public let unread_only: Bool
    /// [다시 미리보기]·[다음 1,000건 보기]의 요청 본문 — 서버가 확정한 칸 그대로(D15)
    public var json: [String: Any] {
      ["action": action, "sender": sender.map { $0 as Any } ?? NSNull(), "subject_words": subject_words,
       "received_from": received_from.map { $0 as Any } ?? NSNull(), "received_to": received_to.map { $0 as Any } ?? NSNull(),
       "promotions": promotions, "unread_only": unread_only]
    }
  }
  public struct Sample: Codable, Sendable, Equatable {
    public let from: String; public let subject: String; public let date: String
  }
  public struct Preview: Codable, Sendable, Equatable {
    public let token: String?                     // nil = 0건(행 없음)
    public let action: String
    public let conditions: Conditions
    public let count: Int
    public let exact: Bool
    public let total_estimate: Int
    public let starred_estimate: Int
    public let has_more: Bool
    public let sample: [Sample]
  }
  public struct Status: Codable, Sendable, Equatable {
    public let id: String
    public let status: String
    public let total: Int
    public let done: Int
    public let failed: Int
    public let undone: Int
    public let undo_failed: Int
    public let code: String?
    public let method: String?
    static let terminal: Set<String> = ["done", "partial", "failed", "undone", "undo_partial", "undo_failed"]
    public var finished: Bool { Self.terminal.contains(status) }
    public var undoPhase: Bool { status.hasPrefix("undo") }
  }

  public static func preview(_ d: Data) -> Preview? { try? JSONDecoder().decode(Preview.self, from: d) }
  public static func status(_ d: Data) -> Status? { try? JSONDecoder().decode(Status.self, from: d) }
  public static func errorCode(_ d: Data) -> String? { (try? JSONSerialization.jsonObject(with: d) as? [String: Any])?["error"] as? String }

  /// 화면 문구 + 버튼: [설정 열기]·[다시 미리보기]
  public struct Note: Equatable, Sendable {
    public let text: String; public let settings: Bool; public let repreview: Bool
    public init(_ text: String, settings: Bool = false, repreview: Bool = false) {
      self.text = text; self.settings = settings; self.repreview = repreview
    }
  }
  public static func previewError(status: Int, code: String?) -> Note {
    switch (status, code) {
    case (403, "scope_missing"?): return Note(MailCleanupText.scopeMissing, settings: true)
    case (404, "no_connection"?): return Note(MailCleanupText.noConnection)
    case (400, "needs_target"?): return Note(MailCleanupText.needsTarget)
    case (400, "bad_condition"?): return Note(MailCleanupText.badCondition)
    case (409, "reauth_required"?): return Note(MailCleanupText.reauth, settings: true)
    case (429, _): return Note(MailCleanupText.busy)
    case (503, "disabled"?): return Note(MailCleanupText.disabled)
    default: return Note(MailCleanupText.failed)
    }
  }
  /// 실행 요청 응답이 "행이 바뀌지 않았다"가 확실한 코드인가. 아니면(네트워크·5xx·401) 앱은 문구 전에 토큰 상태를 먼저 읽는다(D22 — 요청이 서버에 닿았으면 잡은 돈다)
  public static func executeIsDefinite(status: Int?) -> Bool { status.map { [400, 403, 404, 409, 410, 503].contains($0) } ?? false }
  /// 확정 코드의 문구(executeIsDefinite 가 참일 때만 부른다)
  public static func executeError(status: Int, code: String?) -> Note {
    switch (status, code) {
    case (410, _), (404, "not_found"?), (400, _): return Note(MailCleanupText.expired, repreview: true)   // 토큰이 지났거나 없다 — 다시 미리보기
    case (403, "scope_missing"?): return Note(MailCleanupText.scopeMissing, settings: true)
    case (404, _): return Note(MailCleanupText.noConnection)
    case (409, _): return Note(MailCleanupText.reauth, settings: true)
    case (503, _): return Note(MailCleanupText.disabled)
    default: return Note(MailCleanupText.failed)
    }
  }
  public static func undoError(status: Int, code: String?, action: String) -> Note {
    switch (status, code) {
    case (410, _): return Note(MailCleanupText.undoExpired(action))
    case (409, "nothing_to_undo"?): return Note(MailCleanupText.nothingToUndo)
    case (409, "reauth_required"?): return Note(MailCleanupText.undoReconnect, settings: true)   // 행은 그대로 — [되돌리기]가 남는다(D3)
    case (409, "busy"?): return Note(MailCleanupText.stillRunning)       // 앱은 본문의 counts 로 폴링을 잇는다 — 이 문구는 counts 를 못 읽었을 때만
    case (403, "scope_missing"?): return Note(MailCleanupText.scopeMissing, settings: true)
    case (404, _): return Note(MailCleanupText.noConnection)
    default: return Note(MailCleanupText.failed)
    }
  }

  /// 미리보기 카드 조건 줄 — 서버가 확정한 conditions 로만 만든다(앱이 보낸 칸을 다시 그리지 않는다, 스펙 §9).
  /// 서울 기준 올해가 아닌 날짜는 연도를 붙인다 — 모델이 다른 해를 채워도 카드에서 가려낼 수 있게(N-H3)
  public static func conditionLine(_ c: Conditions, now: Date = Date()) -> String {
    let year = seoulYear(now)
    let show = { (x: (y: Int, md: String)) in x.y == year ? x.md : "\(x.y)/\(x.md)" }
    var parts: [String] = []
    if let s = c.sender { parts.append("발신자 '\(s)'") }
    if !c.subject_words.isEmpty { parts.append("제목 " + c.subject_words.map { "'\($0)'" }.joined(separator: " ")) }
    if c.promotions { parts.append("광고") }
    switch (c.received_from.flatMap(ymd), c.received_to.flatMap(ymd)) {
    case let (a?, b?):
      if a.y == b.y && a.md == b.md { parts.append(show(a)) }
      else { parts.append("\(show(a))–\(a.y == b.y ? b.md : show(b))") }   // 끝 날짜는 시작과 해가 다를 때만 연도
    case let (a?, nil): parts.append("\(show(a))부터")
    case let (nil, b?): parts.append("\(show(b))까지")
    default: break
    }
    if c.unread_only { parts.append("안 읽은 메일") }
    parts.append("별표 제외")
    return parts.joined(separator: " · ")
  }
  /// "2026-09-01" → (2026, "9/1")(서울 날짜 문자열 그대로 — 시간대 계산 없음)
  static func ymd(_ day: String) -> (y: Int, md: String)? {
    let p = day.split(separator: "-")
    guard p.count == 3, let y = Int(p[0]), let m = Int(p[1]), let d = Int(p[2]) else { return nil }
    return (y, "\(m)/\(d)")
  }
  static func seoulCalendar() -> Calendar {
    var cal = Calendar(identifier: .gregorian)
    cal.timeZone = TimeZone(identifier: "Asia/Seoul")!
    return cal
  }
  static func seoulYear(_ d: Date) -> Int { seoulCalendar().component(.year, from: d) }
  public static func countLine(_ p: Preview) -> String {
    let star = p.starred_estimate > 0 ? " · 별표 약 \(grouped(p.starred_estimate))건 제외" : ""
    return (p.exact ? "\(grouped(p.count))건" : "총 약 \(grouped(p.total_estimate))건 중 \(grouped(p.count))건") + star
  }
  public static func sampleLine(_ s: Sample, now: Date = Date()) -> String {
    [s.from.isEmpty ? "(보낸 사람 없음)" : s.from, s.subject.isEmpty ? "(제목 없음)" : s.subject, seoulDay(s.date, now: now)].compactMap { $0 }.joined(separator: " · ")
  }
  public static func moreLine(_ p: Preview) -> String? { p.count > p.sample.count ? "외 \(grouped(p.count - p.sample.count))건" : nil }
  public static func grouped(_ n: Int) -> String {
    let s = String(n)
    var out = ""
    for (i, ch) in s.reversed().enumerated() { if i > 0 && i % 3 == 0 { out.append(",") }; out.append(ch) }
    return String(out.reversed())
  }
  nonisolated(unsafe) private static let isoFrac: ISO8601DateFormatter = {
    let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f
  }()
  nonisolated(unsafe) private static let isoPlain = ISO8601DateFormatter()
  /// 받은 시각 ISO → 서울 "M/D"(올해가 아니면 "Y/M/D")
  static func seoulDay(_ s: String, now: Date) -> String? {
    guard let d = isoFrac.date(from: s) ?? isoPlain.date(from: s) else { return nil }
    let c = seoulCalendar().dateComponents([.year, .month, .day], from: d)
    let md = "\(c.month ?? 0)/\(c.day ?? 0)"
    return c.year == seoulYear(now) ? md : "\(c.year ?? 0)/\(md)"
  }

  public static func progress(_ s: Status, action: String) -> String {
    if s.undoPhase { return "\(MailCleanupText.undoing) \(grouped(s.undone + s.undo_failed))/\(grouped(s.done))" }
    return "\(action == "read" ? MailCleanupText.reading : MailCleanupText.trashing) \(grouped(s.done + s.failed))/\(grouped(s.total))"
  }
  public static func result(_ s: Status, action: String) -> Note {
    let code = s.code ?? ""
    let perm = ["scope_missing", "reauth_required", "no_connection"].contains(code)
    switch s.status {
    case "done", "partial", "failed":
      var lines: [String] = []
      if s.done > 0 {
        lines.append((action == "read" ? "\(grouped(s.done))건을 읽음으로 바꿨어요" : "휴지통으로 \(grouped(s.done))건 옮겼어요")
                     + (s.failed > 0 ? " · \(grouped(s.failed))건 실패" : ""))
      } else {
        lines.append((action == "read" ? "읽음으로 바꾸지 못했어요" : "휴지통으로 옮기지 못했어요") + " (\(grouped(s.failed))건 실패)")
      }
      if perm && s.failed > 0 { lines.append("Gmail 권한(연결)이 바뀌어 \(grouped(s.failed))건을 처리하지 못했어요") }
      // 잡이 끝까지 못 감: 실패로 적힌 id 중 실제로 바뀐 메일이 있을 수 있다(스펙 §7 결과 불명·재개, N-M12)
      if ["job_dead", "job_lost"].contains(code) { lines.append("\(MailCleanupText.maybeChanged) — \(MailCleanupText.manual(action))") }
      // 연결 끊김으로 되돌리기가 시작되지 않음(D11) — [되돌리기]는 남는다(canUndo)
      let bounced = code.hasPrefix("undo_")
      if bounced { lines.append(MailCleanupText.undoReconnect) }
      return Note(lines.joined(separator: "\n"), settings: (perm && s.failed > 0) || bounced)
    case "undone": return Note(MailCleanupText.undone)
    case "undo_partial":
      return Note("\(grouped(s.undone))건 되돌렸어요 · \(grouped(s.undo_failed))건 실패 — \(MailCleanupText.manual(action))", settings: perm)
    case "undo_failed": return Note("되돌리지 못했어요 — \(MailCleanupText.manual(action))", settings: perm)
    default: return Note(progress(s, action: action))
    }
  }
  /// [되돌리기]: done·partial 이고 성공이 있고 7일 안(서버가 원본). 되돌리기는 한 번뿐 — 되돌리기 상태면 false
  public static func canUndo(_ s: Status, previewAt: Date, now: Date) -> Bool {
    ["done", "partial"].contains(s.status) && s.done > 0 && now.timeIntervalSince(previewAt) < undoTTL
  }
  public static func isTokenExpired(previewAt: Date, now: Date) -> Bool { now.timeIntervalSince(previewAt) >= tokenTTL }
  /// [다음 1,000건 보기]: 더 있고 실행이 끝났고 성공이 있을 때(되돌린 뒤·성공 0 이면 숨긴다)
  public static func showNext(_ p: Preview, _ s: Status?) -> Bool { p.has_more && (s.map { $0.finished && !$0.undoPhase && $0.done > 0 } ?? false) }
  /// 설정 [권한 업데이트] 표시(D16): `connections?select=status,scopes` 첫 행이 active 이고 scopes 에 modify 가 없을 때만(null = 0.14.0 전 = readonly)
  public static func needsUpgrade(rows: [[String: Any]]) -> Bool {
    guard let c = rows.first, c["status"] as? String == "active" else { return false }
    return !((c["scopes"] as? [String]) ?? []).contains(modifyScope)
  }
}

public enum MailCleanupText {
  public static let finding = "메일을 찾는 중…"
  public static func header(_ action: String) -> String { action == "read" ? "읽음으로 바꿀 메일" : "휴지통으로 옮길 메일" }
  public static func button(_ action: String, _ n: Int) -> String {
    action == "read" ? "읽음 처리 (\(MailCleanup.grouped(n))건)" : "휴지통으로 이동 (\(MailCleanup.grouped(n))건)"
  }
  public static let cancel = "취소", cancelled = "취소했어요"
  public static let expired = "미리보기가 만료됐어요", repreview = "다시 미리보기"
  public static let scopeMissing = "메일을 정리하려면 Gmail 권한 업데이트가 필요해요", openSettings = "설정 열기"
  public static let noConnection = "Gmail이 연결되어 있지 않아요"
  public static let noneFound = "받은편지함에서 조건에 맞는 메일을 찾지 못했어요(별표 메일은 제외해요)"
  public static let needsTarget = "어떤 메일인지 발신자·제목·기간·광고 중 하나를 함께 말해 주세요"
  public static let badCondition = "조건을 정확히 알아듣지 못했어요 — 발신자·제목·기간을 다시 말해 주세요"
  public static let reauth = "Gmail 연결이 끊겼어요 — 설정 › Gmail에서 다시 연결해 주세요"
  public static let busy = "Gmail이 잠시 바빠요 — 잠시 뒤 다시 요청해 주세요"
  public static let disabled = "메일 정리를 지금 쓸 수 없어요"
  public static let failed = "메일 정리를 하지 못했어요 — 잠시 뒤 다시 해 주세요"
  public static let interrupted = "앱이 닫혀 메일을 찾지 못했어요 — 다시 요청해 주세요"
  public static let stillRunning = "아직 처리 중이에요 — 다시 열면 상태를 다시 읽어요"
  public static let checking = "결과를 확인하는 중이에요"
  public static let unknownResult = "결과를 확인하지 못했어요 — Gmail에서 직접 확인해 주세요"
  public static let maybeChanged = "일부는 이미 바뀌었을 수 있어요"
  public static let undoReconnect = "Gmail 연결이 끊겨 되돌리지 못했어요 — 설정 › Gmail에서 다시 연결한 뒤 되돌려 주세요"
  public static let nothingToUndo = "되돌릴 메일이 없어요"
  public static let trashing = "휴지통으로 옮기는 중", reading = "읽음으로 바꾸는 중", undoing = "되돌리는 중"
  public static let undo = "되돌리기", undone = "되돌렸어요", nextPage = "다음 1,000건 보기"
  public static func manual(_ action: String) -> String {
    action == "read" ? "Gmail에서 직접 안 읽음으로 바꿀 수 있어요" : "Gmail 휴지통에서 직접 복원할 수 있어요"
  }
  public static func undoExpired(_ action: String) -> String { "되돌리기 기간(7일)이 지났어요 — " + manual(action) }
  // 설정 › Gmail [권한 업데이트](스펙 §7 권한 업데이트·§12 통제 5)
  public static let upgradeButton = "권한 업데이트"
  public static let upgradeNote = "채팅으로 요청한 메일만 휴지통으로 옮기거나 읽음으로 바꿀 수 있게 권한을 더해요. 메일을 영구 삭제하지 않고, 실행 전에 대상을 보여 드려요. 보관함은 바뀌지 않아요."
  public static let upgradeDone = "Gmail 권한을 업데이트했어요"
  public static let upgradeLater = "Google이 새 권한을 아직 주지 않았어요. 다음 Gmail 재연결 때 함께 더해져요(테스트 모드는 7일마다 재연결 알림)"
  public static let upgradeNotGranted = "메일 정리 권한이 체크되지 않았어요 — 다시 눌러 권한을 체크해 주세요"
  public static let upgradeMismatch = "연결된 Gmail과 다른 Google 계정이에요 — 연결된 계정으로 다시 해 주세요"
  public static let upgradeFailed = "권한 업데이트를 하지 못했어요 — 잠시 뒤 다시 해 주세요"
  public static func upgradeResult(status: Int, body: [String: Any]) -> String {
    switch status {
    case 200: return (body["upgraded"] as? Bool) == true ? upgradeDone : upgradeLater
    case 409 where body["error"] as? String == "reauth_required": return reauth   // 끊긴 연결은 다시 연결부터(D12)
    case 409: return upgradeMismatch
    case 403: return upgradeNotGranted
    default: return upgradeFailed
    }
  }
}

/// 대화 기록의 메일 정리 턴(스펙 §9 "대화 기록"): 서버가 확정한 조건·미리보기 글(위 20건·건수)·토큰(= mail_actions id)·마지막 상태. 이 기기에만, 30일.
/// 기록 파일 호환(F19): 이후에 더하는 필드는 Optional 로만(없는 키를 읽어도 실패하지 않게). 모르는 키는 무시된다
public struct MailTurn: Codable, Sendable, Equatable {
  public enum Phase: String, Codable, Sendable {
    case finding, preview, running, ended
    /// 모르는 값(다음 버전이 더한 단계를 내린 앱이 읽음)은 끝난 턴으로 — 엄격하면 레코드 하나 때문에 기록 파일 전체가 손상(빈 기록)이 된다
    public init(from decoder: Decoder) throws {
      self = Phase(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .ended
    }
  }
  public var phase: Phase
  public var preview: MailCleanup.Preview?
  public var previewAt: Date?
  public var status: MailCleanup.Status?
  public var note: String?
  public var settings: Bool
  public var repreview: Bool
  public init(phase: Phase = .finding, preview: MailCleanup.Preview? = nil, previewAt: Date? = nil, status: MailCleanup.Status? = nil,
              note: String? = nil, settings: Bool = false, repreview: Bool = false) {
    self.phase = phase; self.preview = preview; self.previewAt = previewAt; self.status = status
    self.note = note; self.settings = settings; self.repreview = repreview
  }
  public mutating func apply(_ n: MailCleanup.Note) { note = n.text; settings = n.settings; repreview = n.repreview }
  /// 서버 상태를 먼저 읽어야 하는 턴(D22): 진행 중(실행·되돌리기 요청 중 닫힘 포함)이거나 저장된 상태가 아직 끝나지 않음(20분 상한·옛 기록)
  public var needsStatusRead: Bool { phase == .running || (status.map { !$0.finished } ?? false) }
  /// 서버 상태를 읽은 뒤: previewed = 실행 요청이 닿지 않음 → 미리보기(버튼)로. 그 밖은 그 상태로(끝났으면 ended)
  public mutating func afterStatusRead(_ s: MailCleanup.Status) {
    if s.status == "previewed" { phase = .preview; status = nil; note = MailCleanupText.failed; settings = false; return }
    status = s; phase = s.finished ? .ended : .running; note = nil; settings = false
  }
}

extension JSONValue {
  /// JSONSerialization 용 값(null → NSNull). chat 응답의 mail 칸을 그대로 mail-action/preview 에 보낼 때(스펙 §9 "응답의 mail 칸을 그대로")
  public var foundation: Any {
    switch self {
    case .string(let s): return s
    case .number(let n): return n
    case .bool(let b): return b
    case .array(let a): return a.map(\.foundation)
    case .object(let o): return o.mapValues(\.foundation)
    case .null: return NSNull()
    }
  }
}
