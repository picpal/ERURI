import Foundation

/// 채팅 대화 기록·짧은 맥락(스펙 §9 "대화 기록·짧은 맥락", 2026-10-04 사용자 결정 B): 대화 하나가 이어지고, 기록은 기기에만 30일.
/// 질문 턴의 서버 응답은 받은 그대로(JSON) 둔다 — 다시 열 때 같은 해석(ChatReply.decode)·카드 계산(기기 캘린더는 다시 읽음)을 거친다
public enum ChatHistory {
  public enum Kind: String, Codable, Sendable { case question, link, image, addEvent, mailAction, mailSummary, editEvent, aggregate, saveRule, mailDigest }   // addEvent = 채팅 일정 등록(0.13.0) · mailAction = 채팅 메일 정리(0.14.0) · mailSummary = 채팅 메일 요약(0.15.0) · editEvent = 방금 등록한 일정 고치기(0.16.0) · aggregate = 집계 질문 · saveRule = 저장 규칙(0.17.0) · mailDigest = 메일 목록 요약(0.19.0)

  public struct Record: Codable, Sendable, Equatable, Identifiable {
    public let id: UUID
    public let at: Date                    // 보낸 시각 — 30일·맥락 30분의 기준
    public var kind: Kind                  // 질문 턴으로 시작해 의도(add_event)를 받으면 addEvent 로 바뀐다(0.13.0)
    public let question: String            // 질문 글 · 링크 턴 입력 · 사진 턴 "사진 N장 · 메모"
    public var reply: Data?                // 질문 턴: /chat 200 응답 본문 그대로
    public var error: String?
    public var link: String?               // 링크·사진 턴: 마지막 상태 문구
    public var linkDone: Bool
    public var linkSaved: Bool             // 저장 범위 한 줄(링크 계획 MR1)
    public var seenItemID: String?         // 이미 읽은 링크의 항목(0.11.4 "일정 보기")
    public var itemID: String?               // 채팅 일정 등록: 일정을 찾은 항목(카드가 그 항목의 제안을 다시 읽는다, 0.13.0)
    public var mail: MailTurn?                 // 메일 정리 턴(0.14.0): 조건·미리보기 글·토큰·마지막 상태 — 이 기기에만
    public var mailRead: MailSummaryTurn?                 // 메일 요약 턴(0.15.0): 조건·후보·읽기 결과·토큰 — 이 기기에만
    public var proposalIDs: [String]?            // 일정 등록 턴(0.16.0): 카드가 처음 제안을 읽을 때 fact 마다 최고 버전 id(순번 순) — 첫 id 가 edit_target
    public var contextLine: String?              // 등록 턴 "등록함: …"(일정마다 한 줄, proposalIDs 순서)·ok 고치기 턴 "고침: …" — 맥락으로 보내는 줄(스펙 A)
    public var editPid: String?                  // 고치기 턴(0.16.0): 카드가 따라가는 제안 id — 응답의 edit.proposal_id, 같은 카드의 되묻기 성공 때 그 새 버전(Fable 플랜 리뷰 #1)
    public var saveRule: SaveRuleTurn?           // 저장 규칙 턴(0.17.0): 카드 버튼 결과(K23). 판정 응답은 reply 에(집계 턴도 reply 만)
    public var mailDigest: MailDigestTurn?       // 메일 목록 요약 턴(0.19.0): 조건·줄(후보·상태·요약 줄)·next_cursor·단계 — 이 기기에만
    public var judged: [String: Bool]      // 인용 item_id → 관련 있음(맞아요·틀렸어요 — 서버 eval_judgments 와 같은 값)

    public init(id: UUID = UUID(), at: Date, kind: Kind, question: String, reply: Data? = nil, error: String? = nil, link: String? = nil,
                linkDone: Bool = false, linkSaved: Bool = false, seenItemID: String? = nil, itemID: String? = nil, judged: [String: Bool] = [:],
                mail: MailTurn? = nil, mailRead: MailSummaryTurn? = nil, proposalIDs: [String]? = nil, contextLine: String? = nil, editPid: String? = nil,
                saveRule: SaveRuleTurn? = nil, mailDigest: MailDigestTurn? = nil) {
      self.id = id; self.at = at; self.kind = kind; self.question = question; self.reply = reply; self.error = error; self.link = link
      self.linkDone = linkDone; self.linkSaved = linkSaved; self.seenItemID = seenItemID; self.itemID = itemID; self.judged = judged
      self.mail = mail; self.mailRead = mailRead; self.proposalIDs = proposalIDs; self.contextLine = contextLine; self.editPid = editPid
      self.saveRule = saveRule; self.mailDigest = mailDigest
    }
  }

  public struct ContextTurn: Equatable, Sendable {
    public let question: String; public let answer: String
    public init(question: String, answer: String) { self.question = question; self.answer = answer }
    public var json: [String: String] { ["question": question, "answer": answer] }
  }

  public static let retention: TimeInterval = 30 * 86_400
  public static let maxRecords = 500
  public static let contextWindow: TimeInterval = 30 * 60
  public static let contextTurns = 3
  public static let contextAnswerMax = 400            // UTF-16(서버 상한 600 안)

  /// 30일 지난 턴과 500개를 넘는 오래된 턴을 뺀다. 순서(보낸 순)는 그대로
  public static func prune(_ r: [Record], now: Date) -> [Record] {
    Array(r.filter { now.timeIntervalSince($0.at) < retention }.suffix(maxRecords))
  }

  /// 다시 열 때(D11): 답을 받기 전에 앱이 닫힌 질문 턴·끝나지 않은 링크·사진 턴·읽을 수 없는 응답을 끝난 문구로. 다시 보내지 않는다
  public static func restored(_ r: [Record]) -> [Record] {
    r.map { rec in
      var x = rec
      switch x.kind {
      case .question:
        if x.reply == nil && x.error == nil { x.error = ChatHistoryText.interruptedAnswer }
        // 응답이 있는데 읽을 수 없다(형식 변경·손상) — 진행 표시가 영원히 돌지 않게
        else if let d = x.reply, x.error == nil, ChatReply.decode(d) == nil { x.error = ChatHistoryText.unreadableReply }
      case .link, .image, .addEvent:
        if !x.linkDone { x.link = ChatHistoryText.interruptedLink; x.linkDone = true }
      case .mailAction:
        // 미리보기를 받기 전에 닫혔으면 끝난 문구로. 실행·되돌리기 중(running)은 그대로 — 화면에 나올 때 서버 상태를 다시 읽는다(§9)
        if x.mail == nil { x.mail = MailTurn(phase: .ended, note: MailCleanupText.interrupted) }
        else if x.mail?.phase == .finding { x.mail?.phase = .ended; x.mail?.note = MailCleanupText.interrupted }
      case .mailSummary:
        // 검색·읽기 결과를 받기 전에 닫혔으면 끝난 문구로(읽기는 비용이 들어 다시 보내지 않는다). 후보 카드(choosing)는 10분 안이면 그대로 누를 수 있다
        if x.mailRead == nil { x.mailRead = MailSummaryTurn(phase: .ended, note: MailSummaryText.interrupted) }
        else if x.mailRead?.phase == .finding || x.mailRead?.phase == .reading { x.mailRead?.phase = .ended; x.mailRead?.note = MailSummaryText.interrupted }
      case .editEvent, .aggregate:
        // 고치기·집계 턴은 응답을 받은 뒤에만 이 종류가 된다(K16). 응답이 없으면 질문 턴과 같은 문구
        if x.reply == nil && x.error == nil { x.error = ChatHistoryText.interruptedAnswer }
      case .saveRule:
        // 버튼 요청 중 닫힘(0.17.0 K16): 바뀌었는지 모른다 — 버튼을 다시 켠다(같은 버튼을 다시 눌러도 duplicate·not_found 라 두 번 바뀌지 않는다)
        if x.saveRule?.phase == .working { x.saveRule?.phase = .idle; x.saveRule?.note = SaveRules.Text.buttonFailed }
      case .mailDigest:
        // 검색 결과를 받기 전에 닫혔으면 끝난 문구로. "요약 중…" 줄은 실패 줄로 끝낸다(다시 보내지 않는다 — 비용, §9 "보존")
        if x.mailDigest == nil { var t = MailDigestTurn(question: x.question, phase: .ended); t.note = MailSummaryText.interrupted; x.mailDigest = t }
        else { x.mailDigest?.restoredForReopen() }
      }
      return x
    }
  }

  /// 앞 턴과 30분 넘게 떨어졌다 = 화면 구분선·맥락 끊김(정확히 30분은 이어짐)
  public static func isBreak(previous: Date?, current: Date) -> Bool {
    guard let previous else { return false }
    return current.timeIntervalSince(previous) > contextWindow
  }

  /// 맥락 구간의 첫 색인: 마지막 턴부터 거슬러 구분선이 없는 동안. 마지막 턴이 30분 넘게 전이면 nil(새 대화)
  public static func segmentStart(_ r: [Record], now: Date) -> Int? {
    guard let last = r.last, now.timeIntervalSince(last.at) <= contextWindow else { return nil }
    var i = r.count - 1
    while i > 0, !isBreak(previous: r[i - 1].at, current: r[i].at) { i -= 1 }
    return i
  }

  /// 다음 질문과 보낼 직전 대화(최대 3, 오래된 것부터, 스펙 A): 구간 안에서 답을 받은 질문 턴 + 일정을 찾은 등록 턴(proposalIDs·contextLine) + ok 고치기 턴(contextLine)
  /// + ok 집계 턴(서버 문장, 0.17.0 K10). 링크·사진·오류·메일·저장 규칙 턴과 bad_condition·failed 집계 턴은 구간을 잇지만 넣지 않는다
  public static func context(_ r: [Record], now: Date) -> [ContextTurn] {
    guard let s = segmentStart(r, now: now) else { return [] }
    var out: [ContextTurn] = []                        // 뒤에서부터 3개를 모으면 멈춘다(긴 구간에서 응답을 전부 decode 하지 않게)
    for rec in r[s...].reversed() {
      switch rec.kind {
      case .question:
        guard let d = rec.reply, let a = ChatReply.decode(d) else { continue }
        out.append(ContextTurn(question: rec.question, answer: summary(a)))
      case .addEvent where rec.proposalIDs?.isEmpty == false, .editEvent:
        guard let line = rec.contextLine, !line.isEmpty else { continue }
        out.append(ContextTurn(question: rec.question, answer: clip16(line, max: contextAnswerMax)))
      case .aggregate:
        guard let a = okAggregate(rec) else { continue }
        out.append(ContextTurn(question: rec.question, answer: clip16(a.sentence, max: contextAnswerMax)))
      default: continue
      }
      if out.count == contextTurns { break }
    }
    return out.reversed()
  }

  /// 고칠 대상(스펙 B 앱 → 서버): 맥락 구간 안 가장 최근 일정 등록 턴 하나가 보낸 지 30분 이하(기기 시계)이고 proposalIDs 가 있으면 그 첫 id.
  /// 그보다 앞 등록 턴은 대상이 아니다. 다건 등록 턴도 보낸다(서버가 multi). 고친 뒤 다시 고칠 때도 같은 등록 턴의 첫 id(서버가 fact 의 최신 버전을 찾는다)
  public static func editTarget(_ r: [Record], now: Date) -> String? {
    guard let s = segmentStart(r, now: now), let reg = r[s...].last(where: { $0.kind == .addEvent }) else { return nil }
    guard now.timeIntervalSince(reg.at) <= contextWindow else { return nil }
    return reg.proposalIDs?.first
  }

  /// 직전 집계 조건(스펙 §9 aggregate_context, K11): 맥락 구간이 살아 있고 마지막 턴(= 지금 질문 바로 앞, 턴을 더하기 전에 부른다 — PF-F23)이
  /// ok 집계 턴일 때 서버가 재검증한 조건 그대로. 사이에 다른 턴이 끼면 이어받지 않는다
  public static func aggregateContext(_ r: [Record], now: Date) -> ChatAggregate.Conditions? {
    guard segmentStart(r, now: now) != nil, let last = r.last, last.kind == .aggregate else { return nil }
    return okAggregate(last)?.conditions
  }

  private static func okAggregate(_ rec: Record) -> ChatAggregate.Response? {
    guard let d = rec.reply, let a = ChatReply.decode(d)?.aggregate, a.status == "ok" else { return nil }
    return a
  }

  /// C 되묻기 성공(스펙 A 예외, Codex M6): 그 fact 를 가리키는 가장 최근 맥락 턴의 줄을 새 값으로. 등록 턴은 그 일정 줄만(proposalIDs 색인, K15),
  /// ok 고치기 턴은 "고침: " 줄 전체. factVersions = 그 fact 의 모든 버전 id. 바꿀 턴이 없으면 nil
  public static func rewriteContext(_ r: [Record], factVersions: Set<String>, line: String) -> [Record]? {
    for i in r.indices.reversed() {
      let rec = r[i]
      if rec.kind == .addEvent, let ids = rec.proposalIDs, let k = ids.firstIndex(where: { factVersions.contains($0) }) {
        var lines = (rec.contextLine ?? "").components(separatedBy: "\n")
        guard k < lines.count else { return nil }
        lines[k] = ChatEdit.registeredPrefix + line
        var out = r; out[i].contextLine = lines.joined(separator: "\n"); return out
      }
      if rec.kind == .editEvent, rec.contextLine != nil, let pid = editSubject(rec), factVersions.contains(pid) {
        var out = r; out[i].contextLine = ChatEdit.editedPrefix + line; return out
      }
    }
    return nil
  }

  /// 고치기 턴 카드가 따라가는 제안 id(계획 P6a readCalendar·P6b resolveAsk): editPid(응답 때 edit.proposal_id, 같은 카드의 되묻기 성공 때 새 버전),
  /// editPid 가 없는 기록이면 응답의 proposal_id. 스펙 표 "stale — 뒤 턴에서 다시 고침"은 다른 턴이 고친 경우다 — 같은 카드의 버튼이 만든 버전은 따라간다
  public static func editSubject(_ rec: Record) -> String? {
    guard rec.kind == .editEvent else { return nil }
    return rec.editPid ?? rec.reply.flatMap { ChatReply.decode($0)?.edit?.proposal_id }
  }

  /// 답 요약(D5): 답 문장 + 일정 제안(최대 3) "일정: 제목 · 시작 · 장소", UTF-16 400자
  public static func summary(_ a: ChatReply.Answer) -> String {
    var lines = [a.answer]
    for p in a.proposals.filter({ $0.action == "create_event" }).prefix(3) {
      let parts = ["title", "start", "location"].compactMap { p.payload[$0]?.string }.filter { !$0.isEmpty }
      if !parts.isEmpty { lines.append("일정: " + parts.joined(separator: " · ")) }
    }
    return clip16(lines.joined(separator: "\n"), max: contextAnswerMax)
  }

  /// UTF-16 길이로 자른다(서버는 JS length 로 잰다). 글자(서지 쌍·결합 문자)를 가르지 않는다
  public static func clip16(_ s: String, max: Int) -> String {
    var out = "", n = 0
    for ch in s {
      let w = ch.utf16.count
      if n + w > max { break }
      out.append(ch); n += w
    }
    return out
  }

  /// 화면 판정 상태(ChatView.judged, "<answer_id>|<item_id>")를 기록에서 다시 만든다
  public static func judgedMarks(_ r: [Record]) -> [String: Bool] {
    var out: [String: Bool] = [:]
    for rec in r where !rec.judged.isEmpty {
      guard let d = rec.reply, let a = ChatReply.decode(d) else { continue }
      for (item, ok) in rec.judged { out[ChatFeedback.key(answer: a.answer_id, item: item)] = ok }
    }
    return out
  }
}

/// 대화 기록의 저장 규칙 턴(0.17.0 K23): 카드 버튼 결과 — add 의 status·rule.id·규칙 수·matched, restore 의 status·restored, remove 성공 id.
/// 기록 파일 호환: 모든 칸이 없어도 읽고(기본값), 모르는 phase 는 idle — 레코드 하나 때문에 기록 파일 전체가 손상(빈 기록)이 되지 않게
public struct SaveRuleTurn: Codable, Sendable, Equatable {
  public enum Phase: String, Codable, Sendable { case idle, working, done }
  public var phase: Phase
  public var addStatus: String?          // added·duplicate·limit·bad_value
  public var ruleID: String?             // add 결과 rule.id(duplicate 면 기존 규칙)
  public var addedCount: Int?            // N/20 의 N
  public var matched: Int                // add 결과 그 규칙의 폐기분 수
  public var restoreStatus: String?      // queued·none·not_found
  public var restored: Int?
  public var removedIDs: [String]
  public var note: String?               // 마지막 결과 문구
  public init(phase: Phase = .idle, addStatus: String? = nil, ruleID: String? = nil, addedCount: Int? = nil, matched: Int = 0,
              restoreStatus: String? = nil, restored: Int? = nil, removedIDs: [String] = [], note: String? = nil) {
    self.phase = phase; self.addStatus = addStatus; self.ruleID = ruleID; self.addedCount = addedCount; self.matched = matched
    self.restoreStatus = restoreStatus; self.restored = restored; self.removedIDs = removedIDs; self.note = note
  }
  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    phase = (try c.decodeIfPresent(String.self, forKey: .phase)).flatMap(Phase.init(rawValue:)) ?? .idle
    addStatus = try c.decodeIfPresent(String.self, forKey: .addStatus)
    ruleID = try c.decodeIfPresent(String.self, forKey: .ruleID)
    addedCount = try c.decodeIfPresent(Int.self, forKey: .addedCount)
    matched = try c.decodeIfPresent(Int.self, forKey: .matched) ?? 0
    restoreStatus = try c.decodeIfPresent(String.self, forKey: .restoreStatus)
    restored = try c.decodeIfPresent(Int.self, forKey: .restored)
    removedIDs = try c.decodeIfPresent([String].self, forKey: .removedIDs) ?? []
    note = try c.decodeIfPresent(String.self, forKey: .note)
  }

  /// [함께 저장] 대상(K23): 이미 눌렀으면 nil. 추가 버튼 결과(added·duplicate)에 규칙 id 와 폐기분이 있으면 그 id —
  /// 첫 판정 응답은 바꾸기 전이라 새 규칙 id 가 없다. 그 밖은 채팅 판정 duplicate 의 기존 규칙(SaveRules.restoreRuleID)
  public func restoreRuleID(_ r: SaveRules.Response) -> String? {
    if restoreStatus != nil { return nil }
    if let id = ruleID, addStatus == "added" || addStatus == "duplicate", matched > 0 { return id }
    return SaveRules.restoreRuleID(r)
  }
}

/// 채팅 안내 문구(스펙 §9·§12 통제 5, 계획 UQ1 후보 B). 후보를 바꾸면 이 파일과 그 테스트만 고친다
public enum ChatHistoryText {
  public static let gmailDeleteNote = "채팅 기록은 설정 › 채팅에서 따로 지워요"   // Gmail 데이터 삭제 확인창(§9 "경계" (b), 0.13.0)
  public static let emptyLines = [
    "대화는 이 iPhone에만 저장되고, 30일이 지나면 자동으로 지워져요.",
    "바로 앞 질문 3개까지 이어서 이해해요 — \"그 일정 몇 시야?\"처럼 물어보세요. 30분 동안 묻지 않으면 새 대화로 시작해요.",
    "이어 묻기 위해 바로 앞 질문과 답의 일부를 질문과 함께 보내요. 답을 만드는 데만 쓰고 ERURI 서버에 남기지 않아요.",
  ]
  public static let topNote = "대화 기록은 이 iPhone에만 · 30일 뒤 자동 삭제 · 설정에서 지울 수 있어요"
  public static let newConversation = "30분이 지나 여기부터 새 대화예요"
  public static let settingsTitle = "대화 기록 지우기"
  public static let settingsNote = "대화 기록은 이 iPhone에만 있고 30일이 지나면 자동으로 지워져요. 지우면 되돌릴 수 없어요."
  public static let clearConfirm = "이 iPhone의 대화 기록을 모두 지울까요?"
  public static let interruptedAnswer = "답을 받기 전에 앱이 닫혔어요. 다시 물어봐 주세요."
  public static let interruptedLink = "앱이 닫혀 결과를 확인하지 못했어요 — '제안' 탭과 알림에서 확인하세요."
  public static let unreadableReply = "응답을 읽지 못했습니다"   // ChatView 200 해석 실패와 같은 문구
}

/// 대화 기록 파일(D2): 앱 전용 Application Support/chat/(App Group 아님), 보호 completeUnlessOpen, 디렉터리 백업 제외(못 걸면 쓰지 않는다). 못 읽으면 빈 기록
public struct ChatHistoryStore: Sendable {
  public let url: URL
  public init(url: URL) { self.url = url }

  public static func defaultURL() throws -> URL {
    try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
      .appendingPathComponent("chat", isDirectory: true).appendingPathComponent("chat-history.json")
  }

  struct File: Codable {
    let version: Int; let records: [ChatHistory.Record]
    init(version: Int, records: [ChatHistory.Record]) { self.version = version; self.records = records }
    /// 모르는 kind(새 버전에서 더한 턴 — 0.13.0 앱이 읽는 0.14.0 메일 정리 턴 등)는 그 레코드만 뺀다 — 앱을 내려도 30일 기록 전체가 비지 않게(최종 리뷰 Minor 3, D9).
    /// 아는 kind 인데 다른 칸이 깨진 레코드는 전과 같이 파일 손상(빈 기록)이다
    init(from decoder: Decoder) throws {
      let c = try decoder.container(keyedBy: CodingKeys.self)
      version = try c.decode(Int.self, forKey: .version)
      records = try c.decode([Entry].self, forKey: .records).compactMap(\.record)
    }
    private struct Entry: Decodable {
      let record: ChatHistory.Record?
      private enum K: String, CodingKey { case kind }
      init(from decoder: Decoder) throws {
        let kind = try decoder.container(keyedBy: K.self).decode(String.self, forKey: .kind)
        if ChatHistory.Kind(rawValue: kind) == nil { record = nil } else { record = try ChatHistory.Record(from: decoder) }
      }
    }
  }
  static let version = 1

  /// 파일 없음·손상·다른 버전 = 빈 기록. 그 밖의 읽기 오류(잠금 중 completeUnlessOpen·권한·IO)는 던진다 —
  /// 빈 기록으로 돌려주면 불러오기 뒤 정리 저장이 원본을 덮어 기록 전체가 사라진다(H3 리뷰 Important 1). 호출부는 실패하면 불러오지 않은 상태로 두고 저장하지 않는다
  public func load() throws -> [ChatHistory.Record] {
    let data: Data
    do { data = try Data(contentsOf: url) }
    catch let e as CocoaError where e.code == .fileReadNoSuchFile || e.code == .fileNoSuchFile { return [] }
    let d = JSONDecoder(); d.dateDecodingStrategy = .secondsSince1970
    guard let f = try? d.decode(File.self, from: data), f.version == Self.version else { return [] }
    return f.records
  }

  /// 디렉터리를 만들고 백업 제외를 건다(안의 파일 전부·atomic 교체 뒤에도 적용, 멱등). 실패하면 던져 쓰지 않는다 — 제외되지 않은 파일을 남기지 않는다(D2)
  func prepareDirectory() throws {
    var dir = url.deletingLastPathComponent()
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    var v = URLResourceValues(); v.isExcludedFromBackup = true
    try dir.setResourceValues(v)            // 이 실패는 테스트로 유도하기 어렵다 — try 라 save 가 쓰기 전에 던지는 것(fail-closed)은 코드 순서로 보장한다
  }

  public func save(_ r: [ChatHistory.Record]) throws {
    try prepareDirectory()
    let e = JSONEncoder(); e.dateEncodingStrategy = .secondsSince1970
    try e.encode(File(version: Self.version, records: r)).write(to: url, options: [.atomic, .completeFileProtectionUnlessOpen])
  }

  public func wipe() { Self.remove(at: url) }

  public enum Removal: Equatable, Sendable { case removed, absent, failed(String) }
  /// 지우기: 파일이 없던 것과 지우지 못한 것(개인정보 잔존)을 가른다. 실패는 DiagLog 에 코드만(경로·본문 없음)
  @discardableResult
  public static func remove(at url: URL) -> Removal {
    do { try FileManager.default.removeItem(at: url); return .removed }
    catch let e as CocoaError where e.code == .fileNoSuchFile { return .absent }
    catch {
      let ns = error as NSError, code = "\(ns.domain):\(ns.code)"
      DiagLog.append("CHAT history wipe failed \(code)")
      return .failed(code)
    }
  }
}

/// 쓰기 순서 보장(D2): 세대 번호가 마지막으로 쓴 것보다 클 때만 쓴다 — 늦게 도착한 옛 스냅샷이 새 기록·지우기를 덮지 않는다. nil = 지우기
public actor ChatHistoryWriter {
  private var last = 0
  public init() {}
  public func apply(_ records: [ChatHistory.Record]?, gen: Int, store: ChatHistoryStore) {
    guard gen > last else { return }
    last = gen
    guard let records else { store.wipe(); return }
    do { try store.save(records) } catch { DiagLog.append("CHAT history save failed") }
  }
}
