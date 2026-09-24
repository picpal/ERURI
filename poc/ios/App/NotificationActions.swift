import UserNotifications
import EventKit
import UIKit
import AssistantCore

enum NotificationActions {
  static let category = "ADD_EVENT"
  static func register() {
    let add = UNNotificationAction(identifier: "ADD", title: "캘린더에 추가", options: [.authenticationRequired])
    let ignore = UNNotificationAction(identifier: "IGNORE", title: "무시", options: [])
    let cat = UNNotificationCategory(identifier: category, actions: [add, ignore], intentIdentifiers: [])
    UNUserNotificationCenter.current().setNotificationCategories([cat])
  }

  static func handleAdd(userInfo: [AnyHashable: Any]) async {
    guard let pid = userInfo["proposal_id"] as? String, let title = userInfo["title"] as? String,
          let startISO = userInfo["start"] as? String, let start = ISO8601DateFormatter().date(from: startISO) else {
      PoCLog.append("ADD invalid payload keys=\(userInfo.keys.map { "\($0)" }.sorted())")
      return
    }
    let line = await AddEventGate.shared.add(AddEventRequest(pid: pid, title: title, start: start))
    let bg = await MainActor.run { UIApplication.shared.applicationState == .background }
    PoCLog.append("\(line) bg=\(bg) auth=\(EKEventStore.authorizationStatus(for: .event).rawValue)")
  }

  /// PoC-5 실측용 로컬 알림(APNs 없이 배너·액션 경로를 탄다)
  static func scheduleLocal(proposalId: String, after seconds: TimeInterval) {
    let c = UNMutableNotificationContent()
    c.title = "일정 제안"; c.body = "9월 25일 15:00 병원 예약"; c.categoryIdentifier = category
    c.userInfo = ["proposal_id": proposalId, "title": "병원 예약", "start": "2026-09-25T15:00:00+09:00"]
    let req = UNNotificationRequest(identifier: UUID().uuidString, content: c,
                                    trigger: UNTimeIntervalNotificationTrigger(timeInterval: seconds, repeats: false))
    UNUserNotificationCenter.current().add(req) { err in PoCLog.append("local notif scheduled \(proposalId) err=\(String(describing: err))") }
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
      try ex.record(proposalId: r.pid, eventkitId: ev.eventIdentifier)
      return "ADD ok \(r.pid) \(ev.eventIdentifier ?? "-")"
    } catch { return "ADD fail \(r.pid) \(error)" }
  }
}

final class NotificationDelegate: NSObject, UNUserNotificationCenterDelegate {
  func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
    PoCLog.append("notif response action=\(response.actionIdentifier)")
    guard response.actionIdentifier == "ADD" else { return }
    await NotificationActions.handleAdd(userInfo: response.notification.request.content.userInfo)
  }
  // 포그라운드에서도 배너를 띄워 시뮬레이터에서 액션을 볼 수 있게 한다
  func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
    [.banner, .list]
  }
}
