import UserNotifications
import EventKit
import UIKit
import EruriCore

enum NotificationActions {
  static let addEvent = "ADD_EVENT", addReminder = "ADD_REMINDER", review = "REVIEW"
  /// 세 카테고리(스펙 §10). ADD_REMINDER·REVIEW 는 버튼 없음. 배너를 탭하면 앱이 열리고 제안 시트가 뜬다(Ruling 8').
  /// 캘린더 전체 접근이 없으면 "추가" 버튼만 숨기고 "무시"(dismiss_proposal)는 남긴다(§10 권한 철회). 앱 활성화마다 다시 등록한다
  static func register() {
    let calendarOK = CalendarLookup.fullAccess
    let add = UNNotificationAction(identifier: "ADD", title: "캘린더에 추가", options: [.authenticationRequired])
    let ignore = UNNotificationAction(identifier: "IGNORE", title: "무시", options: [])
    UNUserNotificationCenter.current().setNotificationCategories([
      UNNotificationCategory(identifier: addEvent, actions: calendarOK ? [add, ignore] : [ignore], intentIdentifiers: []),
      UNNotificationCategory(identifier: addReminder, actions: [], intentIdentifiers: []),
      UNNotificationCategory(identifier: review, actions: [], intentIdentifiers: []),
      // 겹침으로 멈춘 잠금화면 추가의 로컬 알림(§10, 0.8.0). 버튼 없음 — 탭하면 제안 시트
      UNNotificationCategory(identifier: ProposalReview.conflictCategory, actions: [], intentIdentifiers: []),
      // 한 항목의 일정 여러 건 묶음(§10, 0.9.0). 버튼 없음 — 탭하면 시트에 카드 N장(잠금화면 일괄 추가는 PoC-5 마감·겹침 규칙과 맞지 않아 두지 않는다)
      UNNotificationCategory(identifier: ProposalReview.bundleCategory, actions: [], intentIdentifiers: []),
    ])
  }

  /// 스펙 §10 순서 1~5. fields: proposal_id·title·start(+09:00)·version. confirmed: 겹침을 사용자가 확인했음(앱 안 확인창 뒤에만 true).
  /// lockScreen: 잠금화면 알림 액션(델리게이트) — 겹침이면 저장 대신 로컬 알림 1건을 여기서 등록한다
  /// 백그라운드 실행 시간 안에 EventKit 쓰기와 완료 핸들러가 끝나도록 구간마다 마감을 둔다(M1-②c 리뷰):
  /// 순서 1 조회 5초 + 순서 4 보고 5초, 둘 다 토큰 갱신 포함. 겹침이면 보고를 건너뛰고 로컬 알림 등록 2초뿐(Codex #5)
  /// 반환: AddEventGate 결과(ok·recovered·dup·conflict:<n>·fail:<코드>) · "skip_<why>" · "invalid_payload".
  /// 채팅 카드·시트는 conflict 면 확인창을 띄운다
  @discardableResult
  static func handleAdd(fields f: [String: String], confirmed: Bool = false, lockScreen: Bool = false) async -> String {
    let started = Date()
    guard let pid = f["proposal_id"], UUID(uuidString: pid) != nil, let title = f["title"], let s = f["start"],
          let start = ISO8601DateFormatter().date(from: s) else {
      Trace.log("action.handled", ["result": "invalid_payload"]); return "invalid_payload"
    }
    // 1. 서버 최신 상태(토큰 갱신 포함 5초). 넘기거나 오프라인이면 건너뛰고 받은 버전으로 실행(순서 5)
    let server = await Deadline.run(seconds: 5) { await serverProposal(pid) }
    if case .stop(let why) = ProposalFlow.check(serverStatus: server?.status) {
      await ExecutionReporter.notice(title: "이미 처리된 제안", body: why == "stale" ? "제안이 바뀌어 추가하지 않았습니다." : "이미 캘린더에 추가된 제안입니다.")
      trace("skip_\(why)", pid: pid, started: started); return "skip_\(why)"
    }
    // 기록·보고 version 은 실제로 넣은 내용(푸시 페이로드)의 것. 서버가 더 새 version 이면 보고 결과 changed 로 알린다(순서 5)
    let version = Int(f["version"] ?? "") ?? server?.version ?? 1
    // 2~3. 확인 → 표식 조회 → 겹침 → 저장 → 기록(한 actor 구간, await 없음)
    let outcome = await AddEventGate.shared.add(AddEventRequest(pid: pid, title: title, start: start, version: version, confirmed: confirmed))
    let conflict = ProposalFlow.conflictCount(outcome)
    // 잠금화면이 겹침으로 멈추면 앱 확인을 유도하는 로컬 알림(§10). 결과를 action.handled 에 같이 남기려고 trace 앞에서
    var notice: String? = nil
    if lockScreen, let n = conflict { notice = await conflictNotice(fields: f, count: n) }
    trace(outcome, pid: pid, started: started, notice: notice)
    // 추가됐으면 알림 센터에 남은 겹침 알림을 지운다(탭해도 "처리됨" 시트만 뜨는 죽은 알림, Fable N5)
    if ["ok", "recovered", "dup"].contains(outcome) {
      UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: [ProposalFlow.conflictNoticeID(pid)])
    }
    // 4. 이 제안 1건만 보고(5초). 실패·겹침(저장 안 함)은 보고하지 않는다. 나머지 미보고분은 앱 활성화 flush 가 보낸다
    if !outcome.hasPrefix("fail"), conflict == nil { await ExecutionReporter.shared.report(proposalId: pid, within: 5) }
    return outcome
  }

  /// 잠금화면 "추가"가 겹침으로 멈췄을 때(스펙 §10): 저장 대신 로컬 알림 1건. 원래 제안 필드를 userInfo 에 그대로 실어
  /// 탭하면 배너 탭 경로(ProposalReview.link → 제안 시트)로 간다. 겹친 일정의 제목은 쓰지 않는다. 식별자 고정 — 두 번 탭해도 1건.
  /// 네트워크 없음, 2초 마감(Codex #5: 등록이 늦어도 완료 핸들러가 밀리지 않게). 반환 ok · fail · timeout(조용히 삼키지 않고 기록)
  static func conflictNotice(fields f: [String: String], count: Int) async -> String {
    guard let pid = f["proposal_id"] else { return "fail" }
    let title = f["title"], start = f["start"], version = f["version"].flatMap { Int($0) }
    let r = await Deadline.run(seconds: 2) { () async -> String? in
      let c = UNMutableNotificationContent()
      c.title = ProposalFlow.conflictNoticeTitle; c.body = ProposalFlow.conflictNoticeBody(count)
      c.categoryIdentifier = ProposalReview.conflictCategory
      var info: [String: Any] = ["proposal_id": pid]
      if let title { info["title"] = title }
      if let start { info["start"] = start }
      if let version { info["version"] = version }                        // 델리게이트가 version 을 Int 로 읽는다
      c.userInfo = info
      do {
        try await UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: ProposalFlow.conflictNoticeID(pid), content: c, trigger: nil))
        return "ok"
      } catch { return "fail" }
    }
    let result = r ?? "timeout"
    DiagLog.append("ADD conflict notice \(result) n=\(count) \(pid)")
    return result
  }

  /// "무시"(알림 액션·제안 시트·제안 탭): dismiss_proposal. 알림 액션은 백그라운드 실행 시간 안에 끝나도록 토큰 갱신 포함 5초 마감(M1-②c).
  /// 반환: ok · not_found · not_pending · nil(실패·마감 — 화면은 버튼을 다시 켠다. 알림 액션은 버린다)
  static func dismiss(proposalId pid: String, timeout: TimeInterval = 5) async -> String? {
    let result = await Deadline.run(seconds: timeout) {
      let r = await API.send("rest/v1/rpc/dismiss_proposal", method: "POST", json: ["p_proposal": pid], timeout: timeout)
      return ProposalReview.dismissResult(status: r?.status, data: r?.data)
    }
    DiagLog.append("DISMISS \(result ?? "fail") \(pid)")
    if result == "ok" { UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: [ProposalFlow.conflictNoticeID(pid)]) }
    return result
  }

  /// 대기 제안 목록(list_pending_proposals). nil = 조회 실패
  static func pendingProposals(timeout: TimeInterval = 8) async -> [ProposalReview.Pending]? {
    guard let r = await API.send("rest/v1/rpc/list_pending_proposals", method: "POST", json: [String: String](), timeout: timeout),
          r.status == 200 else { return nil }
    return ProposalReview.decodeList(r.data)
  }

  /// 묶음 시트(§10, 0.9.0): 알림의 제안 id(≤5) → status. 목록(list_pending_proposals)은 50건 제한·ADD_EVENT 조건이라 카드 판정에 쓰지 않는다. 실패면 nil
  static func proposalStatuses(_ ids: [String], timeout: TimeInterval = 5) async -> [String: String]? {
    let ok = ids.filter { UUID(uuidString: $0) != nil }
    guard !ok.isEmpty, let r = await API.send("rest/v1/proposals?id=in.(\(ok.joined(separator: ",")))&select=id,status", timeout: timeout),
          r.status == 200, let rows = try? JSONSerialization.jsonObject(with: r.data) as? [[String: Any]] else { return nil }
    return rows.reduce(into: [String: String]()) { d, row in if let id = row["id"] as? String, let st = row["status"] as? String { d[id.lowercased()] = st } }
  }

  private struct ServerProposal: Sendable { let status: String?; let version: Int? }
  private static func serverProposal(_ pid: String) async -> ServerProposal? {
    guard let r = await API.send("rest/v1/proposals?id=eq.\(pid)&select=status,version", timeout: 5), r.status == 200,
          let row = (try? JSONSerialization.jsonObject(with: r.data) as? [[String: Any]])?.first else { return nil }
    return ServerProposal(status: row["status"] as? String, version: row["version"] as? Int)
  }

  private static func trace(_ result: String, pid: String, started: Date, notice: String? = nil) {
    Task {
      let st = await AppState.snapshot()
      let auth = EKEventStore.authorizationStatus(for: .event).rawValue
      DiagLog.append("ADD \(result) \(pid) bg=\(st.bg) auth=\(auth)")
      var base: [String: Any] = ["result": result, "dup": result == "dup", "proposal_id": pid, "auth": auth,
                                 "elapsed_ms": Int(Date().timeIntervalSince(started) * 1000)]
      if let notice { base["notice"] = notice }
      Trace.log("action.handled", base.merging(st.traceFields) { _, new in new })
    }
  }
}

struct AddEventRequest: Sendable { let pid: String; let title: String; let start: Date; let version: Int; var confirmed = false }

/// 확인 → 표식 조회 → 겹침 판정 → 저장 → 기록을 await 없이 한 actor 안에서 처리한다(스펙 §10 순서 2~3, PoC-5 실측: 동시 두 번 탭 +1).
/// 반환: "ok" · "recovered"(저장 후 기록 전 종료 복구) · "dup" · "conflict:<n>"(겹침, 저장 안 함) · "fail:<코드>"
actor AddEventGate {
  static let shared = AddEventGate()
  func add(_ r: AddEventRequest) -> String {
    do {
      let ex = try Executions.shared()
      if try ex.existing(proposalId: r.pid) != nil { return "dup" }
      // 전체 접근이 없으면(추가만 허용·철회) 표식·겹침을 읽지 못한 채 저장하게 된다 — 저장하지 않는다(§10 권한 철회, C2 리뷰 Minor 1).
      // 화면은 전체 접근일 때만 추가 버튼을 보이므로 이 경로는 권한을 바꾼 직후의 낡은 화면·알림뿐이다
      guard CalendarLookup.fullAccess else { return "fail:no_full_access" }
      let store = EKEventStore()
      let (from, to) = ProposalFlow.searchWindow(start: r.start)
      let events = CalendarLookup.events(store, from: from, to: to)
      if let found = ProposalFlow.matchMarker(pid: r.pid, events: events.map { (id: $0.id, url: $0.url) }) {
        try ex.record(proposalId: r.pid, eventkitId: found, version: r.version)
        return "recovered"
      }
      // 겹침(§10 순서 3): 표식 조회에 쓴 같은 배열로 판정 — EventKit 조회·await 가 늘지 않는다. 확인받지 않았으면 저장하지 않는다
      if !r.confirmed {
        let c = ProposalFlow.conflicts(pid: r.pid, start: r.start, events: events)
        if !c.isEmpty { return ProposalFlow.conflictOutcome(c.count) }
      }
      guard let cal = store.defaultCalendarForNewEvents, cal.allowsContentModifications else { return "fail:no_writable_calendar" }  // §10 읽기 전용 제외
      let ev = EKEvent(eventStore: store)
      ev.title = r.title; ev.startDate = r.start; ev.endDate = r.start.addingTimeInterval(ProposalFlow.eventDuration)
      ev.calendar = cal
      ev.url = ProposalFlow.marker(r.pid)
      try store.save(ev, span: .thisEvent, commit: true)
      let eid: String = ev.eventIdentifier ?? ev.calendarItemIdentifier   // SDK 상 String! — nil 이면 암시적 언래핑으로 죽는다
      try ex.record(proposalId: r.pid, eventkitId: eid, version: r.version)
      return "ok"
    } catch { return "fail:\(type(of: error))" }
  }
}

/// completion-handler 판을 쓴다(0.2.2). async 판은 컴파일러 thunk 가 완료 핸들러를 Swift 협력 스레드에서 불러
/// UIKit 의 스냅샷 갱신(`_performBlockAfterCATransactionCommitSynchronizes:`)이 메인 스레드 단언으로 SIGABRT 한다(poc5 크래시).
/// 완료 핸들러는 모든 경로에서 메인 스레드에서 정확히 1회 부른다.
final class NotificationDelegate: NSObject, UNUserNotificationCenterDelegate {
  func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                              withCompletionHandler completionHandler: @escaping () -> Void) {
    let done = UncheckedSendableBox(completionHandler)
    let action = response.actionIdentifier
    DiagLog.append("notif response action=\(action)")
    // userInfo 는 Sendable 이 아니므로 Task 밖에서 문자열 값만 뽑아 넘긴다(handleAdd·시트가 쓰는 키 그대로)
    let content = response.notification.request.content
    let info = content.userInfo
    var fields = ["proposal_id", "title", "start", "due"].reduce(into: [String: String]()) { d, k in
      if let v = info[k] as? String { d[k] = v }
    }
    if let v = info["version"] as? Int { fields["version"] = String(v) }
    // 묶음 알림 events(§10): 원소의 문자열·정수 값만 문자열 사전으로 옮긴다
    let events: [[String: String]] = (info["events"] as? [[String: Any]] ?? []).map { e in
      e.reduce(into: [String: String]()) { d, kv in
        if let s = kv.value as? String { d[kv.key] = s } else if let n = kv.value as? Int { d[kv.key] = String(n) }
      }
    }
    if !events.isEmpty { DiagLog.append("notif bundle n=\(events.count)") }   // 개수만(제목 금지)
    switch action {
    case "ADD": break
    case "IGNORE":
      // 백그라운드 실행: dismiss_proposal 5초 마감 후 완료. 실패는 버린다(제안 탭에서 다시 무시할 수 있다)
      guard let pid = fields["proposal_id"], UUID(uuidString: pid) != nil else { DispatchQueue.main.async { done.value() }; return }
      Task {
        _ = await NotificationActions.dismiss(proposalId: pid)
        DispatchQueue.main.async { done.value() }
      }
      return
    default:
      // 배너 탭: 제안이면 시트를 띄울 딥링크를 앱 상태에 둔다(콜드 스타트면 UI 준비 후 표시). 그 밖은 앱만 연다
      let link = ProposalReview.link(actionIdentifier: action, category: content.categoryIdentifier, fields: fields, events: events)
      DispatchQueue.main.async {
        if let link { MainActor.assumeIsolated { ProposalRouter.shared.open(link) } }
        done.value()
      }
      return
    }
    // 키가 빠진 payload 는 handleAdd 의 invalid_payload 경로로 간다. 원래 키 목록은 여기서 남긴다
    if fields["proposal_id"] == nil || fields["title"] == nil || fields["start"] == nil { DiagLog.append("ADD payload keys=\(info.keys.map { "\($0)" }.sorted())") }
    // 겹침이면 handleAdd 가 저장 대신 로컬 알림 1건을 등록하고 돌아온다(네트워크 없음, 2초 마감). 그 뒤 기존처럼 완료
    Task {
      await NotificationActions.handleAdd(fields: fields, lockScreen: true)
      DispatchQueue.main.async { done.value() }
    }
  }
  // 포그라운드에서도 배너를 띄워 시뮬레이터에서 액션을 볼 수 있게 한다
  func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                              withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
    completionHandler([.banner, .list])
  }
}

/// UIKit 이 넘긴 완료 핸들러(비 Sendable 블록)를 Task 너머로 옮기기 위한 상자. 호출은 항상 메인 큐에서 한다
private struct UncheckedSendableBox<T>: @unchecked Sendable {
  let value: T
  init(_ value: T) { self.value = value }
}
