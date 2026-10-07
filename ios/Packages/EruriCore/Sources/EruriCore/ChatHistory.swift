import Foundation

/// 채팅 대화 기록·짧은 맥락(스펙 §9 "대화 기록·짧은 맥락", 2026-10-04 사용자 결정 B): 대화 하나가 이어지고, 기록은 기기에만 30일.
/// 질문 턴의 서버 응답은 받은 그대로(JSON) 둔다 — 다시 열 때 같은 해석(ChatReply.decode)·카드 계산(기기 캘린더는 다시 읽음)을 거친다
public enum ChatHistory {
  public enum Kind: String, Codable, Sendable { case question, link, image, addEvent, mailAction, mailSummary }   // addEvent = 채팅 일정 등록(0.13.0) · mailAction = 채팅 메일 정리(0.14.0) · mailSummary = 채팅 메일 요약(0.15.0)

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
    public var judged: [String: Bool]      // 인용 item_id → 관련 있음(맞아요·틀렸어요 — 서버 eval_judgments 와 같은 값)

    public init(id: UUID = UUID(), at: Date, kind: Kind, question: String, reply: Data? = nil, error: String? = nil, link: String? = nil,
                linkDone: Bool = false, linkSaved: Bool = false, seenItemID: String? = nil, itemID: String? = nil, judged: [String: Bool] = [:],
                mail: MailTurn? = nil, mailRead: MailSummaryTurn? = nil) {
      self.id = id; self.at = at; self.kind = kind; self.question = question; self.reply = reply; self.error = error; self.link = link
      self.linkDone = linkDone; self.linkSaved = linkSaved; self.seenItemID = seenItemID; self.itemID = itemID; self.judged = judged
      self.mail = mail; self.mailRead = mailRead
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

  /// 다음 질문과 보낼 직전 대화(최대 3, 오래된 것부터): 구간 안에서 답을 받은 질문 턴만. 링크·사진·오류 턴은 구간을 잇지만 넣지 않는다
  public static func context(_ r: [Record], now: Date) -> [ContextTurn] {
    guard let s = segmentStart(r, now: now) else { return [] }
    var out: [ContextTurn] = []                        // 뒤에서부터 3개를 모으면 멈춘다(긴 구간에서 응답을 전부 decode 하지 않게)
    for rec in r[s...].reversed() {
      guard rec.kind == .question, let d = rec.reply, let a = ChatReply.decode(d) else { continue }
      out.append(ContextTurn(question: rec.question, answer: summary(a)))
      if out.count == contextTurns { break }
    }
    return out.reversed()
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
