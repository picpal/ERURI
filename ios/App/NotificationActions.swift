import UserNotifications
import EventKit
import UIKit
import EruriCore

enum NotificationActions {
  static let category = "ADD_EVENT"
  static func register() {
    let add = UNNotificationAction(identifier: "ADD", title: "캘린더에 추가", options: [.authenticationRequired])
    let ignore = UNNotificationAction(identifier: "IGNORE", title: "무시", options: [])
    let cat = UNNotificationCategory(identifier: category, actions: [add, ignore], intentIdentifiers: [])
    UNUserNotificationCenter.current().setNotificationCategories([cat])
  }

  static func handleAdd(userInfo: [AnyHashable: Any]) async {
    let started = Date()
    guard let pid = userInfo["proposal_id"] as? String, let title = userInfo["title"] as? String,
          let startISO = userInfo["start"] as? String, let start = ISO8601DateFormatter().date(from: startISO) else {
      DiagLog.append("ADD invalid payload keys=\(userInfo.keys.map { "\($0)" }.sorted())")
      Trace.log("action.handled", ["result": "invalid_payload"])
      return
    }
    let line = await AddEventGate.shared.add(AddEventRequest(pid: pid, title: title, start: start))
    let st = await AppState.snapshot()
    let auth = EKEventStore.authorizationStatus(for: .event).rawValue
    DiagLog.append("\(line) bg=\(st.bg) auth=\(auth)")
    // 진단 필드: 백그라운드 실행·권한·중복 여부(제안 제목은 보내지 않는다)
    let result = line.hasPrefix("ADD ok") ? "ok" : line.hasPrefix("ADD dup") ? "dup" : "fail"
    let base: [String: Any] = ["result": result, "dup": result == "dup", "proposal_id": pid, "auth": auth,
                               "elapsed_ms": Int(Date().timeIntervalSince(started) * 1000)]
    Trace.log("action.handled", base.merging(st.traceFields) { _, new in new })
  }
}

struct AddEventRequest: Sendable { let pid: String; let title: String; let start: Date }

/// 확인 → 저장 → 기록을 await 없이 한 actor 안에서 처리해, 같은 proposal_id 로 동시에 두 번 탭해도 이벤트는 1건만 생긴다.
actor AddEventGate {
  static let shared = AddEventGate()
  func add(_ r: AddEventRequest) -> String {
    do {
      let ex = try Executions.shared()
      if let e = try ex.existing(proposalId: r.pid) {
        return "ADD dup skip \(r.pid) \(e) unreported=\((try? ex.unreported().count) ?? -1)"
      }
      let store = EKEventStore()
      let ev = EKEvent(eventStore: store)
      ev.title = r.title; ev.startDate = r.start; ev.endDate = r.start.addingTimeInterval(3600)
      ev.calendar = store.defaultCalendarForNewEvents
      ev.url = URL(string: "assistant://proposal/\(r.pid)")   // 저장 후 기록 전 종료 시 1단계에서 EventKit 조회로 복구할 표식
      try store.save(ev, span: .thisEvent, commit: true)
      // eventIdentifier 는 SDK 상 null_unspecified(String!) 라 그대로 넘기면 nil 일 때 암시적 언래핑으로 죽는다
      let eid: String = ev.eventIdentifier ?? ev.calendarItemIdentifier
      try ex.record(proposalId: r.pid, eventkitId: eid)
      return "ADD ok \(r.pid) \(eid)"
    } catch { return "ADD fail \(r.pid) \(error)" }
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
    guard action == "ADD" else { DispatchQueue.main.async { done.value() }; return }
    // userInfo 는 Sendable 이 아니므로 Task 밖에서 문자열 값만 뽑아 넘긴다(handleAdd 가 쓰는 키 그대로)
    let info = response.notification.request.content.userInfo
    let fields = ["proposal_id", "title", "start"].reduce(into: [String: String]()) { d, k in
      if let v = info[k] as? String { d[k] = v }
    }
    // 키가 빠진 payload 는 handleAdd 의 invalid_payload 경로로 간다. 원래 키 목록은 여기서 남긴다
    if fields.count < 3 { DiagLog.append("ADD payload keys=\(info.keys.map { "\($0)" }.sorted())") }
    Task {
      await NotificationActions.handleAdd(userInfo: fields)
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
