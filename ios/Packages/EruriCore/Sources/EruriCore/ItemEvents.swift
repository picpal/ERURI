import Foundation

/// 항목 상세 "일정" 절(스펙 §10 "일정 다시 추가", 0.11.4): 그 항목의 일정 제안을 순번 순으로 보이고, 캘린더 대조로
/// 있음 · 다시 추가(넣은 적 있는데 캘린더에 없음) · 추가(대기)를 가른다. 대조는 채팅 일정 답 카드의 등록 판정(ScheduleCard.status) 그대로.
/// EventKit·네트워크 없이 판단·문구만 — 읽기는 앱(CalendarLookup), 추가는 handleAdd(readd)
public enum ItemEvents {
  /// 본인 facts(event, active) ⨝ proposals(RLS). 본문·근거 열 없음
  public static func query(itemID: String) -> String {
    "rest/v1/facts?item_id=eq.\(itemID)&kind=eq.event&status=eq.active&select=ordinal,proposals(id,action,status,version,payload)&order=ordinal.asc"
  }

  public struct Row: Identifiable, Equatable, Sendable {
    public let pid: String; public let action: String; public let status: String; public let version: Int; public let ordinal: Int
    /// 앞뒤 공백을 뗀 제목, 비면 "일정"(채팅 카드와 같다)
    public let title: String
    public let start: String; public let end: String?; public let location: String?; public let notes: String?
    public let uncertain: Bool
    public var id: String { pid }

    /// create_event 이고 start 를 읽을 때만(handleAdd 와 같은 파서)
    public var timing: ProposalTiming? { action == "create_event" ? ProposalTiming.parse(start: start, end: end) : nil }

    /// 시각 "10/8(목) 10:00–16:00"(끝 없으면 시작만, 날을 넘기면 끝에 날짜), 종일 "10/8(목) · 종일"·"10/8(목)–10/10(토) · 종일". 못 읽으면 원문
    /// 제안 탭·채팅 카드와 같은 라벨(ProposalTiming, §10 "시각 범위 표시" 0.12.0)
    public var whenLabel: String { timing.flatMap { $0.allDayLabel ?? $0.timeLabel } ?? start }

    /// handleAdd 입력(제안 탭 행 addFields 와 같은 키 — 위치·메모·끝). 못 읽으면 nil
    public var addFields: [String: String]? {
      guard let t = timing else { return nil }
      var f = t.fieldValues.merging(["proposal_id": pid, "title": title, "version": String(version)]) { a, _ in a }
      if let l = ProposalReview.place(location) { f["location"] = l }
      if let n = ProposalReview.memo(notes) { f["notes"] = n }
      return f
    }
  }

  /// facts 행(순번) → fact 마다 version 이 가장 큰 제안 하나, 순번 순. 제안 없는 fact 는 뺀다. 형식이 틀리면 nil
  public static func decode(_ data: Data) -> [Row]? {
    guard let facts = (try? JSONSerialization.jsonObject(with: data)) as? [[String: Any]] else { return nil }
    let rows: [Row] = facts.compactMap { f in
      let ordinal = f["ordinal"] as? Int ?? 0
      let ps = (f["proposals"] as? [[String: Any]] ?? []).filter { $0["id"] is String }
      guard let p = ps.max(by: { ($0["version"] as? Int ?? 0) < ($1["version"] as? Int ?? 0) }) else { return nil }
      let pl = p["payload"] as? [String: Any] ?? [:]
      let title = (pl["title"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
      return Row(pid: p["id"] as! String, action: p["action"] as? String ?? "", status: p["status"] as? String ?? "", version: p["version"] as? Int ?? 1,
                 ordinal: ordinal, title: title.isEmpty ? "일정" : title, start: pl["start"] as? String ?? "", end: pl["end"] as? String,
                 location: pl["location"] as? String, notes: pl["notes"] as? String, uncertain: !((pl["uncertain"] as? [Any])?.isEmpty ?? true))
    }
    return rows.sorted { ($0.ordinal, $0.pid) < ($1.ordinal, $1.pid) }
  }

  public enum State: Equatable, Sendable {
    /// 캘린더에 있음(표식 · 같은 일정을 다른 제안으로 넣음 · 같은 시작·제목) — 버튼 없음. 값은 상태 줄
    case inCalendar(String)
    /// 넣은 적 있음(서버 succeeded 또는 이 기기 기록) + 캘린더에서 찾지 못함 → "캘린더에 다시 추가"
    case readd
    /// 대기 → 제안 탭 행과 같은 추가·무시
    case pending
    /// 무시함 → 추가만(보고가 succeeded 로 올린다)
    case dismissed
    case needsReview, past, stale
    /// 캘린더 전체 접근 없음 — 대조하지 못한다. added = 넣은 적 있음
    case noAccess(added: Bool)
  }

  /// events = 그 제안의 조회 창(ProposalTiming.searchWindow — AddEventGate 와 같다) 일정, nil = 전체 접근 없음
  public static func state(_ r: Row, executed: Bool, events: [ProposalFlow.CalendarEvent]?, now: Date = Date(), deviceZone: TimeZone = .current) -> State {
    guard let t = r.timing, !r.uncertain else { return .needsReview }
    if r.status == "stale" { return .stale }
    let added = executed || r.status == "succeeded"
    let past = t.isAllDay ? t.seoulDays.end <= now : t.anchor < now
    guard let events else { return past ? .past : .noAccess(added: added) }
    let st = ScheduleCard.status(pid: r.pid, title: r.title, start: t.anchor, allDay: t.isAllDay, timing: t, serverStatus: r.status,
                                 executed: executed, events: events, deviceZone: deviceZone)
    switch st {
    case .added: return .inCalendar("✅ 캘린더에 있음")
    case .addedMoved, .addedMovedDay:
      return .inCalendar(ScheduleCard.statusText(st).replacingOccurrences(of: "캘린더에 등록됨", with: "캘린더에 있음"))
    case .sameEvent: return .inCalendar(ScheduleCard.statusText(st))
    default: break
    }
    if past { return .past }
    if added { return .readd }
    return r.status == "dismissed" ? .dismissed : .pending
  }

  /// 상태 줄. pending 은 제안 행이 미리 판정 줄을 직접 그린다(nil)
  public static func statusText(_ s: State) -> String? {
    switch s {
    case .inCalendar(let t): return t
    case .readd: return "캘린더에서 찾지 못함 · 지웠거나 옮겼을 수 있어요"
    case .pending: return nil
    case .dismissed: return "무시한 제안"
    case .needsReview: return "내용 확인이 필요해 바로 추가하지 않음"
    case .past: return "지난 일정"
    case .stale: return "바뀐 제안이라 추가하지 않음"
    case .noAccess(let added): return added ? "이전에 추가한 일정" : nil
    }
  }

  public static let readdButtonTitle = "캘린더에 다시 추가"

  /// 다시 추가 결과 문구. recovered = 표식 일정이 이미 있어 새로 만들지 않았다
  public static func readdFeedback(_ outcome: String) -> (text: String, retry: Bool) {
    switch outcome {
    case "ok": ("캘린더에 다시 추가했습니다", false)
    case "recovered": ("이미 캘린더에 있습니다", false)
    default: ChatReply.addFeedback(outcome)
    }
  }
}
