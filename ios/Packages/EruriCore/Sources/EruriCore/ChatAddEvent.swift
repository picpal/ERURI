import Foundation
import CryptoKit

/// 채팅 일정 등록(스펙 §9 "채팅 일정 등록", 0.13.0): /chat 이 intent = add_event 를 주면 사용자가 쓴 글 그대로를 공유와 같은 경로로 접수한다 —
/// 기기 규칙(OTP 폐기·카드·계좌 마스킹) → App Group 큐(source SHARE, app_name "채팅", 제목 없음, capturedAt = 보낸 시각) → 업로드 → 서버 SHARE 추출(워커 변경 없음).
/// EventKit·네트워크 없이 판단·문구만 — 업로드·결과 조회는 앱(ChatView·LinkCapture)
public enum ChatAddEvent {
  public static let appName = "채팅"
  /// 이 앱이 처리하는 행동 의도(스펙 §9 "하위 호환"): add_event(0.13.0)·mail_action(0.14.0 메일 정리)·mail_summary(0.15.0 메일 요약)
  public static let intents = ["add_event", "mail_action", "mail_summary"]   // 이 앱이 처리하는 행동(§9 하위 호환) — 0.15.0 메일 요약
  public static func isAddEvent(_ intent: String?) -> Bool { intent == "add_event" }

  /// 같은 글 판정용(키에만): 줄바꿈을 포함한 공백 연속을 공백 하나로, 앞뒤 제거
  public static func normalized(_ text: String) -> String { text.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ") }

  public static func seoulDay(_ d: Date) -> String { day.string(from: d) }

  /// 같은 글 = 같은 캡처 id(D5): SHA-256("chat:<서울 날짜>:<정규화 글>") 앞 16바이트, v5 비트 — 링크 캡처 id 와 같은 모양이라
  /// 큐(INSERT OR IGNORE)·서버 멱등 키(SHARE:<id>)·기기 기록(link_seen)·항목 조회(LinkFlow.itemQuery)를 그대로 쓴다. 날짜를 넣어 다음 날 같은 글은 새 일정이다
  public static func captureID(text: String, at: Date) -> String {
    var b = Array(SHA256.hash(data: Data("chat:\(seoulDay(at)):\(normalized(text))".utf8)).prefix(16))
    b[6] = (b[6] & 0x0F) | 0x50
    b[8] = (b[8] & 0x3F) | 0x80
    return UUID(uuid: (b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7], b[8], b[9], b[10], b[11], b[12], b[13], b[14], b[15])).uuidString
  }

  public enum Outcome: Equatable, Sendable {
    case queued(captureID: String)
    /// 같은 날 같은 글(기기 기록 30일) — 큐에 넣지 않는다. 앱이 그 항목을 찾아 "일정 보기"
    case duplicate(captureID: String)
    /// 기기 규칙(otp 등) — 큐·기록에 아무것도 남기지 않는다
    case discarded(String)
    /// 큐 쓰기 실패(queue) — 기록을 남기지 않아 다시 보내면 다시 시도한다(D6·D10)
    case failed(String)
  }

  /// 접수(D6): 같은 글이면 duplicate. 아니면 규칙 → 큐 항목(id = 캡처 id) → 넣었을 때만 기기 기록
  public static func admit(text: String, at: Date, queue: CaptureQueue, now: Date = Date()) -> Outcome {
    let id = captureID(text: text, at: at)
    if (try? queue.isLinkSeen(captureID: id, now: now)) == true { return .duplicate(captureID: id) }
    let r: String
    do { r = try CapturePipeline(filter: RuleFilter(), queue: queue).handleRead(id: id, appName: appName, title: nil, text: text, capturedAt: at) }
    catch { return .failed("queue") }
    guard r == "queued" else { return .discarded(String(r.dropFirst("discarded:".count))) }
    try? queue.markLinkSeen(captureID: id, now: now)
    return .queued(captureID: id)
  }

  /// 진단 로그 한 단어(글 없음): queued · duplicate · discarded:<r> · failed:<r>
  public static func code(_ o: Outcome) -> String {
    switch o {
    case .queued: return "queued"
    case .duplicate: return "duplicate"
    case .discarded(let r): return "discarded:\(r)"
    case .failed(let r): return "failed:\(r)"
    }
  }

  public enum Verdict: Equatable, Sendable { case events(Int), text(String) }   // Result 가 아님 — Swift.Result 를 가리지 않게

  /// 서버 처리 결과(스펙 §9 "턴 표시"): 본인 items.status·facts 종류. nil = 아직(행 없음·queued·처리 중).
  /// 일정 → events(N), 할 일만 → 안내, 일정·할 일 없음(날짜 없음 포함) → "찾지 못했어요"(+ 맥락을 실었으면 앞 답 안내 줄, D11), 규칙 폐기 → 보안 숫자
  public static func result(status: String?, kinds: [String], withContext: Bool) -> Verdict? {
    guard let status, status != "queued" else { return nil }
    let none = withContext ? "\(ChatAddEventText.noEvent)\n\(ChatAddEventText.contextHint)" : ChatAddEventText.noEvent
    if status == "extracted" {
      let n = kinds.filter { $0 == "event" }.count
      if n > 0 { return .events(n) }
      return .text(kinds.contains("task") ? ChatAddEventText.taskOnly : none)
    }
    if status == "discarded:server:empty" { return .text(none) }
    if status.hasPrefix("discarded:") { return .text(ChatAddEventText.discarded) }      // SHARE 는 게이트를 건너뛰므로 격리는 없다(F6)
    return nil
  }

  /// 채팅 일정 카드(D8): 항목 상세 "일정" 절과 같은 조회(ItemEvents.query) 응답 → fact 마다 version 이 가장 큰 제안 중
  /// 채팅 답 카드와 같은 상태(proposed·succeeded — chat_proposals)만, 순번 순. 형식이 틀리면 nil
  public static func proposals(itemID: String, data: Data) -> [ChatReply.Proposal]? {
    struct P: Decodable { let id: String; let action: String; let status: String; let version: Int?; let payload: [String: JSONValue]? }
    struct F: Decodable { let ordinal: Int?; let proposals: [P]? }
    guard let facts = try? JSONDecoder().decode([F].self, from: data) else { return nil }
    return facts.sorted { ($0.ordinal ?? 0) < ($1.ordinal ?? 0) }.compactMap { f in
      guard let p = (f.proposals ?? []).max(by: { ($0.version ?? 0) < ($1.version ?? 0) }), ["proposed", "succeeded"].contains(p.status) else { return nil }
      return ChatReply.Proposal(id: p.id, item_id: itemID, action: p.action, status: p.status, payload: p.payload ?? [:])
    }
  }

  /// 카드 ① 출처(D8): /chat 응답이 없으므로 항목의 출처를 그대로 만든다 — "채팅에서 등록한 일정" · "M/D 등록"(보낸 시각, 서울)
  public static func citation(itemID: String, at: Date) -> ChatReply.Citation {
    ChatReply.Citation(item_id: itemID, source: "SHARE", app_name: appName, title: nil, occurred_at: iso.string(from: at), expired: false)
  }

  nonisolated(unsafe) private static let iso = ISO8601DateFormatter()
  private static let day: DateFormatter = {
    let f = DateFormatter()
    f.calendar = Calendar(identifier: .gregorian); f.locale = Locale(identifier: "en_US_POSIX")
    f.timeZone = TimeZone(identifier: "Asia/Seoul"); f.dateFormat = "yyyy-MM-dd"
    return f
  }()
}

/// 채팅 일정 등록 턴 문구(스펙 §9 "턴 표시"·"같은 글"·"오프라인", 계획 D10)
public enum ChatAddEventText {
  public static let registering = "일정을 등록하는 중…"
  public static func found(_ n: Int) -> String { "일정 \(n)건을 찾았어요" }
  public static let taskOnly = "할 일을 찾았어요 — 알림에서 확인하세요"
  public static let noEvent = "일정을 찾지 못했어요. 날짜와 시간을 함께 써 주세요."
  public static let contextHint = "앞 답의 일정은 그 답 카드의 [캘린더에 추가]로 넣을 수 있어요"
  public static let discarded = LinkCaptureText.discarded
  public static let pending = LinkCaptureText.pending
  public static let offline = "연결되면 등록해요 — 일정을 찾으면 알림으로 알려 드려요"
  public static let duplicateFound = "이미 등록한 글이에요."
  public static let duplicate = "이미 등록한 글이에요. 보관함에서 그 항목을 열면 일정을 다시 볼 수 있어요"
  public static let failed = "등록하지 못했어요(기기에 저장하지 못했어요). 다시 보내 주세요."
}
