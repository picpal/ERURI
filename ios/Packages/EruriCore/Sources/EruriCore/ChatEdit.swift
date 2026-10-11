import Foundation

/// 방금 등록한 일정 고치기(스펙 §9 "채팅 일정 개선" B 앱 — 고치기 턴, 계획 P1): /chat 응답 edit 해석·문구·바뀐 칸 "전 → 후" 줄·맥락 줄·제안 버전.
/// 캘린더 대조·상태는 EditFlow(P2). 값·문구만 — 진단 로그에는 상태·코드만(값 없음)
public enum ChatEdit {
  public static let intent = "edit_event"
  public static func isEdit(_ i: String?) -> Bool { i == intent }

  /// 일정 네 칸(응답 before·after, update_event payload 의 before)
  public struct Values: Codable, Equatable, Sendable {
    public let title: String?; public let start: String?; public let end: String?; public let location: String?
    public init(title: String?, start: String?, end: String?, location: String?) {
      self.title = title; self.start = start; self.end = end; self.location = location
    }
    public init?(_ v: JSONValue?) {
      guard case .object(let o)? = v else { return nil }
      self.init(title: o["title"]?.string, start: o["start"]?.string, end: o["end"]?.string, location: o["location"]?.string)
    }
  }
  /// /chat 응답의 edit(스펙 B 서버 6). status = ok·no_change·expired·not_found·multi
  public struct Response: Decodable, Equatable, Sendable {
    public let status: String; public let before: Values?; public let after: Values?; public let proposal_id: String?; public let action: String?
  }

  /// 시각 표기(카드와 같은 ProposalTiming, §10 "시각 범위 표시"): "10/9(금) 11:00–15:00"·"10/9(금) 11:00"·"10/9(금) 종일"·"10/8(목)–10/10(토) 종일",
  /// 시작이 없으면 "날짜 미정", 못 읽으면 원문
  public static func whenText(start: String?, end: String?) -> String {
    guard let s = start else { return "날짜 미정" }
    guard let t = ProposalTiming.parse(start: s, end: end) else { return s }
    if let d = t.dayLabel { return "\(d) 종일" }
    return t.timeLabel ?? s
  }
  static func name(_ s: String?) -> String { let t = (s ?? "").trimmingCharacters(in: .whitespacesAndNewlines); return t.isEmpty ? "일정" : t }
  private static func placeText(_ s: String?) -> String { ProposalReview.place(s) ?? "없음" }

  /// 바뀐 칸만(스펙 B 앱 — 날짜·시간 한 줄, 제목, 장소. 없앤 장소는 "없음"). 같은 순간을 다른 표기로 쓴 것은 바뀐 것이 아니다
  public static func diffLines(_ r: Response) -> [String] {
    guard let b = r.before, let a = r.after else { return [] }
    var out: [String] = []
    let bw = whenText(start: b.start, end: b.end), aw = whenText(start: a.start, end: a.end)
    if bw != aw { out.append("날짜·시간 \(bw) → \(aw)") }
    if name(b.title) != name(a.title) { out.append("제목 \(name(b.title)) → \(name(a.title))") }
    if placeText(b.location) != placeText(a.location) { out.append("장소 \(placeText(b.location)) → \(placeText(a.location))") }
    return out
  }
  /// 카드 머리(스펙 B 앱): 바뀐 칸이 있으면 "일정을 고쳤어요", 값은 그대로이고 이번 글이 확인한 코드만 풀렸으면(B 서버 4 — "오후 6시 맞아") "확인했어요"
  public static func headerText(_ r: Response) -> String { diffLines(r).isEmpty ? ChatEditText.confirmedOnly : ChatEditText.header }

  /// 맥락 줄(스펙 A): 본문 "제목 · 시각", 앞말은 턴 종류("등록함: "·"고침: ")
  public static let registeredPrefix = "등록함: ", editedPrefix = "고침: "
  public static func lineBody(title: String?, start: String?, end: String?) -> String { "\(name(title)) · \(whenText(start: start, end: end))" }
  /// 고치기 턴: ok 일 때만 "고침: 제목 · 시각"(고친 뒤 값)
  public static func contextLine(_ r: Response?) -> String? {
    guard let r, r.status == "ok", let a = r.after else { return nil }
    return editedPrefix + lineBody(title: a.title, start: a.start, end: a.end)
  }
  /// 카드 없이 한 줄인 상태(스펙 B 앱 표). ok 면 nil
  public static func oneLine(_ status: String) -> String? {
    switch status {
    case "ok": return nil
    case "expired": return ChatEditText.expired
    case "multi": return ChatEditText.multi
    case "no_change": return ChatEditText.noChange
    default: return ChatEditText.notFound
    }
  }

  /// 고치기 카드가 다시 읽는 그 제안의 fact 버전 전부와 항목 id(본인 행, RLS — 본문·근거 열 없음)
  public static func query(proposalID: String) -> String {
    "rest/v1/proposals?id=eq.\(proposalID)&select=id,facts(item_id,ordinal,proposals(id,action,status,version,payload,eventkit_id))"
  }
  struct VersionRow: Decodable { let id: String; let action: String; let status: String; let version: Int?; let payload: [String: JSONValue]?; let eventkit_id: String? }
  static func version(_ r: VersionRow) -> ProposalVersion {
    ProposalVersion(id: r.id, action: r.action, status: r.status, version: r.version ?? 1, payload: r.payload ?? [:], eventkitID: r.eventkit_id)
  }
  public static func decodeFact(_ data: Data) -> FactVersions? {
    struct F: Decodable { let item_id: String?; let ordinal: Int?; let proposals: [VersionRow]? }
    struct P: Decodable { let id: String; let facts: F? }
    guard let p = (try? JSONDecoder().decode([P].self, from: data))?.first, let f = p.facts, let item = f.item_id else { return nil }
    return FactVersions(itemID: item, ordinal: f.ordinal ?? 0, versions: (f.proposals ?? []).map(version).sorted { $0.version < $1.version })
  }

  /// 바꾸기 결과 문구(계획 K25). retry = 버튼을 다시 켠다
  public static func changeFeedback(_ outcome: String) -> (text: String, retry: Bool) {
    switch outcome {
    case "changed", "recovered", "dup": (ChatEditText.changed, false)
    case "user_modified": (ChatEditText.userModified, false)
    case "base_deleted": (ChatEditText.deleted, false)
    case "base_unknown": (ChatEditText.unknown, false)
    case "skip_stale": (ChatEditText.superseded, false)
    case let o where ProposalFlow.conflictCount(o) != nil: ("같은 시간에 일정이 있습니다", true)
    default: (ChatEditText.changeFailed, true)
    }
  }
}

/// 고치기 카드·상태 문구(스펙 §9 B 앱 표·§10 결과). 후보를 바꾸면 이 파일과 그 테스트만 고친다
public enum ChatEditText {
  public static let header = "일정을 고쳤어요"
  public static let confirmedOnly = "확인했어요"                // 값은 그대로, 확인 코드만 풀림(계획 K6)
  public static let expired = "등록한 지 30분이 지나 채팅으로는 고칠 수 없어요. 캘린더에서 직접 고치거나 새로 등록해 주세요."
  public static let multi = "여러 일정을 함께 등록한 글은 채팅으로 고칠 수 없어요. 캘린더에서 직접 고쳐 주세요."
  public static let notFound = "고칠 일정을 찾지 못했어요."
  public static let noChange = "바뀐 내용이 없어요."
  public static let superseded = "다시 고친 내용이 있어요 — 아래 카드를 보세요"
  public static let dismissed = "무시한 일정이에요"
  public static let lineage = "캘린더에 고치기 전 일정이 있어요 — 그 일정을 바꿀까요?"
  public static let askChange = "캘린더에 있는 일정도 바꿀까요?"
  public static let userModified = "캘린더에서 이미 고친 일정이라 바꾸지 않았어요 — 캘린더 앱에서 확인해 주세요"
  public static let deleted = "캘린더에서 지운 일정이에요"
  public static let unknown = "캘린더에서 이 일정을 확인하지 못했어요 — 캘린더 앱에서 확인해 주세요"
  public static let changed = "✅ 캘린더도 바꿨어요"
  public static let changeButton = "캘린더도 바꾸기", changeAnywayButton = "겹쳐도 바꾸기", addButton = "캘린더에 추가"
  public static let changeFailed = "캘린더를 바꾸지 못했어요"
  /// "⚠️ 바꾸면 겹치는 일정 15:00–16:00 제목"(여러 건이면 " 외 N건")
  public static func conflictLine(_ c: [ProposalFlow.CalendarEvent]) -> String {
    guard let f = c.first else { return "⚠️ 바꾸면 겹치는 일정이 있어요" }
    let t = f.title.trimmingCharacters(in: .whitespacesAndNewlines)
    return "⚠️ 바꾸면 겹치는 일정 \(ScheduleCard.span(f)) \(t.isEmpty ? "(제목 없음)" : t)" + (c.count > 1 ? " 외 \(c.count - 1)건" : "")
  }
}

/// 제안 버전 하나. 항목 상세 조회(ItemEvents.query)·고치기 카드 조회(ChatEdit.query)가 같은 모양을 준다
public struct ProposalVersion: Equatable, Sendable, Identifiable {
  public let id: String; public let action: String; public let status: String; public let version: Int
  public let payload: [String: JSONValue]; public let eventkitID: String?
  public init(id: String, action: String, status: String, version: Int, payload: [String: JSONValue], eventkitID: String? = nil) {
    self.id = id; self.action = action; self.status = status; self.version = version; self.payload = payload; self.eventkitID = eventkitID
  }
  public var title: String? { payload["title"]?.string }
  public var start: String? { payload["start"]?.string }
  public var end: String? { payload["end"]?.string }
  public var location: String? { payload["location"]?.string }
  /// 앞뒤 공백을 뗀 제목, 비면 "일정"(카드와 같다)
  public var displayTitle: String { ChatEdit.name(title) }
  public var uncertain: [String] { if case .array(let a)? = payload["uncertain"] { return a.compactMap(\.string) }; return [] }
  /// update_event 의 기준 값(캘린더에 들어간 값 — §10 사용자 수정 판정)
  public var before: ChatEdit.Values? { ChatEdit.Values(payload["before"]) }
  public var basePID: String? { payload["base_proposal_id"]?.string }
  public var values: ChatEdit.Values { ChatEdit.Values(title: title, start: start, end: end, location: location) }
  public func proposal(itemID: String) -> ChatReply.Proposal { ChatReply.Proposal(id: id, item_id: itemID, action: action, status: status, payload: payload) }
}

/// fact 하나의 버전들(version 오름차순). top = version 이 가장 큰 것
public struct FactVersions: Equatable, Sendable {
  public let itemID: String; public let ordinal: Int; public let versions: [ProposalVersion]
  public init(itemID: String, ordinal: Int, versions: [ProposalVersion]) { self.itemID = itemID; self.ordinal = ordinal; self.versions = versions }
  public var top: ProposalVersion? { versions.last }
  public func contains(_ pid: String) -> Bool { versions.contains { $0.id == pid } }
}
