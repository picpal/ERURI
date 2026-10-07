import Foundation

/// 제안 리뷰(Ruling 8', 스펙 §10·§11): 배너 탭 → 제안 시트, 앱 "제안" 탭(list_pending_proposals·dismiss_proposal).
/// 캘린더 추가는 새 경로 없이 NotificationActions.handleAdd(알림 액션·채팅 카드와 같은 §10 순서)에 넘긴다. 화면은 App/ProposalsView
public enum ProposalReview {
  /// list_pending_proposals 행. 서버가 푸시 ADD_EVENT 조건(시각 있는 start 또는 날짜만·uncertain 없음)으로 거르고, 제목은 푸시처럼 40자.
  /// 0026(0.9.1): start·end 는 text — 시각은 서울 ISO, 종일(all_day)은 YYYY-MM-DD(end = 마지막 날). 0022 의 timestamptz 문자열도 그대로 읽는다
  public struct Pending: Identifiable, Decodable, Sendable, Equatable {
    public let proposal_id: String; public let action: String; public let title: String; public let start: String
    public let end: String?; public let location: String?; public let version: Int; public let created_at: String
    /// 일정 메모(스펙 §10, 0.11.2). 지금 list_pending_proposals 는 이 열이 없다 — 없으면 nil, handleAdd 가 서버 조회 값으로 채운다
    public var notes: String? = nil
    /// 0026 부터. 없으면(0022 서버) start 형식으로 판단
    public let all_day: Bool?
    /// 0031 부터(2026-10-07 사용자 요청): 그 제안을 만든 항목의 id·출처. 없으면(옛 서버·항목 없는 fact) nil — 출처 버튼을 숨긴다
    public var item_id: String? = nil
    public var source: String? = nil
    public var app_name: String? = nil
    public var id: String { proposal_id }
    /// 종일 행은 마지막 날, 시각 행은 끝(§10 "일정 종료", 0.11.3)으로 end 를 쓴다. all_day 와 start 형식이 어긋나면 nil(추가 버튼 없음)
    public var timing: ProposalTiming? {
      guard let t = ProposalTiming.parse(start: start, end: end), all_day.map({ $0 == t.isAllDay }) ?? true else { return nil }
      return t
    }
    public var isAllDay: Bool { timing?.isAllDay ?? false }
    /// 카드 오른쪽 출처 버튼(스펙 §11, 0031): 항목 id 가 있을 때만. 라벨·아이콘은 보관함과 같은 SourceLabel, 출처 열이 없으면 "원문"
    public var sourceLink: SourceLink? {
      guard let id = item_id, !id.isEmpty else { return nil }
      guard let source else { return SourceLink(itemID: id, label: "원문", symbol: "doc.text") }
      return SourceLink(itemID: id, label: SourceLabel.label(source: source, appName: app_name),
                        symbol: SourceLabel.symbol(source: source, appName: app_name))
    }
    /// 종일 "10/8(목) · 종일", 시각 "10/8(목) 10:00–16:00"(끝 없으면 시작만, §10 "시각 범위 표시" 0.12.0). 못 읽으면 서울 원문 시각
    public var whenLabel: String { timing.flatMap { $0.allDayLabel ?? $0.timeLabel } ?? ChatReply.seoulLabel(start) }
    /// handleAdd 입력(알림 페이로드와 같은 키). 시각은 Postgres 소수 초를 떼고 handleAdd 의 파서가 읽는 형식으로, 종일은 날짜 그대로(여러 날이면 end).
    /// 못 읽으면 nil(버튼 없음)
    public var addFields: [String: String]? {
      guard let t = timing else { return nil }
      var f = t.fieldValues.merging(["proposal_id": proposal_id, "title": title, "version": String(version)]) { a, _ in a }
      if let l = ProposalReview.place(location) { f["location"] = l }          // 일정 위치(스펙 §10, 0.11.0)
      if let n = ProposalReview.memo(notes) { f["notes"] = n }                 // 일정 메모(스펙 §10, 0.11.2)
      return f
    }
  }

  /// 제안 카드 출처 버튼 값(2026-10-07): 누르면 항목 상세(itemID)
  public struct SourceLink: Equatable, Hashable, Sendable {
    public let itemID: String; public let label: String; public let symbol: String
    public init(itemID: String, label: String, symbol: String) { self.itemID = itemID; self.label = label; self.symbol = symbol }
  }

  /// 일정 위치(스펙 §10, 0.11.0): 제안의 장소·주소 그대로, 앞뒤 공백만 뗀다. 비면 nil(EventKit 에 넣지 않는다)
  public static func place(_ s: String?) -> String? {
    guard let t = s?.trimmingCharacters(in: .whitespacesAndNewlines), !t.isEmpty else { return nil }
    return t
  }

  /// 일정 메모(스펙 §10, 0.11.2): SHARE 제안 payload 의 notes(신청·접수 방법). 앞뒤 공백만 떼고, 비면 nil, 서버 절단(NOTES_MAX)과 같은 300자
  public static let memoMax = 300
  public static func memo(_ s: String?) -> String? {
    guard let t = s?.trimmingCharacters(in: .whitespacesAndNewlines), !t.isEmpty else { return nil }
    return String(t.prefix(memoMax))
  }
  /// 메모 출처: 화면이 가진 값(addFields — 채팅 카드 payload·목록 행) → 없으면 handleAdd 순서 1 서버 조회 값(제안 탭·시트·잠금화면·알림 값 경로)
  public static func memo(fields f: [String: String], server: String?) -> String? { memo(f["notes"]) ?? memo(server) }
  /// handleAdd 순서 1 조회(proposals 본인 행)의 select — 같은 요청에 notes·end 를 더한다(PostgREST 별칭, 없으면 null. end 는 예약어라 end_at)
  public static let serverSelect = "status,version,notes:payload->>notes,end_at:payload->>end"

  /// handleAdd 의 일시(스펙 §10 "일정 종료", 0.11.3): 화면 값(fields start·end). 시각 일정의 끝이 없으면 순서 1 조회 end 로 다시 읽는다 —
  /// 푸시 페이로드는 시각 일정의 end 를 싣지 않는다. 종일은 조회 end 를 쓰지 않는다(마지막 날은 화면·푸시 값). start 를 못 읽으면 nil
  public static func timing(fields f: [String: String], serverEnd: String?) -> ProposalTiming? {
    guard let s = f["start"], let t = ProposalTiming.parse(start: s, end: f["end"]) else { return nil }
    if case .timed(_, nil) = t, let e = serverEnd { return ProposalTiming.parse(start: s, end: e) }
    return t
  }

  public static func decodeList(_ data: Data) -> [Pending]? { try? JSONDecoder().decode([Pending].self, from: data) }

  /// UNNotificationDefaultActionIdentifier 값(EruriCore 는 UserNotifications 를 들이지 않는다)
  public static let defaultAction = "com.apple.UNNotificationDefaultActionIdentifier"
  /// 잠금화면 "추가"가 겹침으로 멈췄을 때의 로컬 알림 카테고리(액션 없음). 탭하면 ADD_EVENT 배너처럼 제안 시트(스펙 §10)
  public static let conflictCategory = "ADD_EVENT_CONFLICT"
  /// 한 항목의 일정 여러 건을 묶은 푸시(스펙 §10, 2026-10-01). 잠금화면 액션 없음 — 탭하면 시트에 카드 N장
  public static let bundleCategory = "EVENT_BUNDLE"
  public static let categories: Set<String> = ["ADD_EVENT", "ADD_REMINDER", "REVIEW", conflictCategory, bundleCategory]

  /// 묶음 푸시 events 원소. category 는 그 일정을 단건으로 보냈을 때의 ADD_EVENT·REVIEW. end = 여러 날 종일의 마지막 날(0.9.1 서버)
  public struct BundleEvent: Identifiable, Equatable, Sendable {
    public let proposalId: String; public let category: String; public let title: String; public let start: String; public let version: Int?
    public let end: String?
    public var id: String { proposalId }
    public init(proposalId: String, category: String, title: String, start: String, version: Int?, end: String? = nil) {
      self.proposalId = proposalId; self.category = category; self.title = title; self.start = start; self.version = version; self.end = end
    }
    /// 카드 하나의 판정은 단건 알림과 같은 경로(sheet(for:list:))로 — 이 일정만의 링크
    public var link: Link { Link(proposalId: proposalId, category: category, title: title, start: start, end: end, due: nil, version: version) }
  }

  /// 델리게이트가 userInfo["events"] 를 문자열 사전으로 바꿔 넘긴다. UUID·start 없는 원소는 빼고, 같은 id 는 하나, 최대 5개
  public static func bundleEvents(_ raw: [[String: String]]) -> [BundleEvent] {
    var seen = Set<String>(), out: [BundleEvent] = []
    for e in raw {
      guard let pid = e["proposal_id"], UUID(uuidString: pid) != nil, let start = e["start"], !seen.contains(pid) else { continue }
      seen.insert(pid)
      out.append(BundleEvent(proposalId: pid, category: e["category"] == "ADD_EVENT" ? "ADD_EVENT" : "REVIEW",
                             title: e["title"] ?? "일정", start: start, version: e["version"].flatMap { Int($0) }, end: e["end"]))
      if out.count == 5 { break }
    }
    return out
  }

  /// 배너 탭으로 열 제안(푸시 최상위 키, §10). 콜드 스타트에서는 UI 가 준비될 때까지 앱 상태에 보관한다
  public struct Link: Identifiable, Equatable, Sendable {
    public let proposalId: String; public let category: String; public let title: String
    public let start: String?; public let due: String?; public let version: Int?
    /// 여러 날 종일 일정의 마지막 날(YYYY-MM-DD, 0.9.1 서버 페이로드). 그 밖은 nil
    public let end: String?
    /// 묶음 알림(EVENT_BUNDLE)의 일정들(시작 순, 2건 이상). 단건이면 비어 있다
    public let events: [BundleEvent]
    /// 묶음은 단건과 다른 id — 같은 첫 일정의 단건 시트(겹침 로컬 알림 등)가 떠 있을 때 묶음을 탭해도 루트 .sheet(item:)이 교체한다
    public var id: String { events.isEmpty ? proposalId : "bundle:" + events.map(\.proposalId).joined(separator: ",") }
    public init(proposalId: String, category: String, title: String, start: String?, end: String? = nil, due: String?, version: Int?,
                events: [BundleEvent] = []) {
      self.proposalId = proposalId; self.category = category; self.title = title; self.start = start; self.due = due; self.version = version
      self.end = end; self.events = events
    }
    /// 시각이 있으면 "10/8(목) 10:00"(end 가 실리면 범위 — 푸시 값은 시각 일정 end 가 없다, §10 "시각 범위 표시" 0.12.0), 날짜만이면 종일("10/8(목) · 종일", 확인 필요는 날짜만), 할 일은 "…까지"
    public var whenLabel: String {
      if let start {
        guard let t = ProposalTiming.parse(start: start, end: end) else { return ChatReply.seoulLabel(start) }
        return (t.isAllDay ? (category == "REVIEW" ? t.dayLabel : t.allDayLabel) : t.timeLabel) ?? start
      }
      if let due { return "\(ChatReply.seoulLabel(due))까지" }
      return ""
    }
  }

  /// 배너 탭(기본 액션)이고 제안 카테고리이며 proposal_id 가 UUID 일 때만. "변경된 제안" 같은 로컬 안내는 앱만 연다.
  /// 묶음(EVENT_BUNDLE)은 events 로 — 2건 이상이면 묶음 링크, 하나만 남으면 그 일정의 단건 링크, 없으면 nil
  public static func link(actionIdentifier: String, category: String, fields f: [String: String], events raw: [[String: String]] = []) -> Link? {
    guard actionIdentifier == defaultAction, categories.contains(category) else { return nil }
    if category == bundleCategory {
      let events = bundleEvents(raw)
      guard let first = events.first else { return nil }
      if events.count == 1 { return first.link }                          // 하나만 남으면 단건 시트
      return Link(proposalId: first.proposalId, category: bundleCategory, title: first.title, start: first.start, due: nil,
                  version: first.version, events: events)
    }
    guard let pid = f["proposal_id"], UUID(uuidString: pid) != nil else { return nil }
    return Link(proposalId: pid, category: category, title: f["title"] ?? "일정", start: f["start"], end: f["end"], due: f["due"],
                version: f["version"].flatMap { Int($0) })
  }

  public enum Sheet: Equatable, Sendable {
    case pending(Pending)                 // 대기 목록에 있음: 서버 값(장소 포함)으로 추가·무시
    case offline([String: String])        // 목록을 못 읽음: 받은 푸시 값으로 추가(§10 순서 5, 순서 1 은 handleAdd 가 다시 시도)
    case needsReview                      // 확인 필요(REVIEW)·할 일: 캘린더에 바로 넣지 않는다(수정 화면은 2단계). 무시만
    case processed                        // 목록에 없음: 이미 추가·무시됐거나 지난 제안
    case unlisted([String: String])       // proposed 인데 목록 밖(50건 제한): 알림 값으로 추가, 안내 없음(묶음 카드만)
  }

  /// list = nil 이면 목록 조회 실패(오프라인·마감)
  public static func sheet(for link: Link, list: [Pending]?) -> Sheet {
    if let p = list?.first(where: { $0.proposal_id == link.proposalId }) { return .pending(p) }
    guard link.category == "ADD_EVENT" || link.category == conflictCategory else { return .needsReview }
    guard list == nil, let f = pushFields(link) else { return .processed }
    return .offline(f)
  }

  /// 묶음 시트의 카드 한 장 = 일정 하나 + 그 판정
  public struct BundleCard: Identifiable, Equatable, Sendable {
    public let event: BundleEvent; public let sheet: Sheet
    public var id: String { event.proposalId }
  }

  /// 순서는 events(시작 순). statuses = 알림의 제안 id → 서버 status(직접 조회, 목록 50건 제한·REVIEW 미포함과 무관). nil 이면 조회 실패 → 단건 판정 그대로.
  /// list = nil 이면 목록 조회 실패
  public static func cards(for link: Link, list: [Pending]?, statuses: [String: String]?) -> [BundleCard] {
    link.events.map { e in
      guard let statuses else { return BundleCard(event: e, sheet: sheet(for: e.link, list: list)) }
      guard statuses[e.proposalId] == "proposed" else { return BundleCard(event: e, sheet: .processed) }   // 처리됨·행 없음(REVIEW 포함)
      // 목록이 category 보다 먼저(단건 sheet 와 같다): 0.9.0 서버 묶음의 날짜만 원소는 REVIEW 지만 0026 목록에 있으면 종일 추가 가능. 진짜 REVIEW(uncertain)는 목록에 없다
      if let p = list?.first(where: { $0.proposal_id == e.proposalId }) { return BundleCard(event: e, sheet: .pending(p)) }
      if e.category != "ADD_EVENT" { return BundleCard(event: e, sheet: .needsReview) }
      guard let f = pushFields(e.link) else { return BundleCard(event: e, sheet: .processed) }
      return BundleCard(event: e, sheet: list == nil ? .offline(f) : .unlisted(f))
    }
  }

  /// 알림 값으로 추가할 때의 필드(sheet(for:list:)의 offline 분기와 묶음 카드 공용)
  static func pushFields(_ link: Link) -> [String: String]? {
    guard let start = link.start, let t = ProposalTiming.parse(start: start, end: link.end) else { return nil }
    var f = ["proposal_id": link.proposalId, "title": link.title, "start": start]
    if t.isAllDay, let end = t.fieldValues["end"] { f["end"] = end }           // 종일 여러 날(시각 있는 일정은 end 를 쓰지 않는다)
    if let v = link.version { f["version"] = String(v) }
    return f
  }

  /// dismiss_proposal RPC 응답: 200 의 JSON 문자열만. 그 밖은 nil(실패)
  public static func dismissResult(status: Int?, data: Data?) -> String? {
    guard status == 200, let data else { return nil }
    return (try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])) as? String
  }

  /// retry 는 실패일 때만 — 버튼을 다시 켠다
  public static func dismissFeedback(_ result: String?) -> (text: String, retry: Bool) {
    switch result {
    case "ok": ("무시했습니다", false)
    case "not_pending": ("이미 처리된 제안입니다", false)
    case "not_found": ("제안을 찾을 수 없습니다", false)
    default: ("처리하지 못했습니다. 다시 눌러 주세요", true)
    }
  }

  /// 행·시트의 추가/무시 버튼 상태. 결과는 화면에 쓰고, 실패면 버튼을 다시 켠다
  public enum ActionState: Equatable, Sendable {
    case idle, running, finished(String), failed(String)
    public var buttonsEnabled: Bool {
      switch self { case .idle, .failed: true; case .running, .finished: false }
    }
    public static func after(_ fb: (text: String, retry: Bool)) -> ActionState { fb.retry ? .failed(fb.text) : .finished(fb.text) }
  }

  /// "전체 무시" 집계. ok 만 무시로 세고, not_pending·not_found 는 이미 처리된 것(목록 새로고침에서 빠진다), nil·그 밖은 실패(행이 남는다)
  public struct DismissAllResult: Equatable, Sendable {
    public var dismissed = 0, alreadyDone = 0, failed = 0
    public init(dismissed: Int = 0, alreadyDone: Int = 0, failed: Int = 0) {
      self.dismissed = dismissed; self.alreadyDone = alreadyDone; self.failed = failed
    }
    public var text: String { "\(dismissed)건 무시, 실패 \(failed)건" + (alreadyDone > 0 ? " (이미 처리 \(alreadyDone)건)" : "") }
    mutating func add(_ result: String?) {
      switch result {
      case "ok": dismissed += 1
      case "not_pending", "not_found": alreadyDone += 1
      default: failed += 1
      }
    }
  }

  /// 제안 탭 "전체 무시": 서버 새 경로 없이 dismiss_proposal 을 id 마다 호출한다. 동시 최대 concurrency 건, 각 요청은 timeout 초 마감(넘으면 실패)
  public static func dismissAll(_ ids: [String], concurrency: Int = 2, timeout: TimeInterval = 8,
                                dismiss: @escaping @Sendable (String) async -> String?) async -> DismissAllResult {
    var result = DismissAllResult()
    var next = ids.makeIterator()
    await withTaskGroup(of: String?.self) { group in
      func launch() -> Bool {
        guard let id = next.next() else { return false }
        group.addTask { await Deadline.run(seconds: timeout) { await dismiss(id) } }
        return true
      }
      for _ in 0..<max(1, concurrency) { if !launch() { break } }
      while let r = await group.next() {
        result.add(r)
        _ = launch()
      }
    }
    return result
  }

}
