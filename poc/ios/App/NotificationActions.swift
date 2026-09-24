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
      PoCLog.append("ADD invalid payload \(userInfo)")
      return
    }
    do {
      let ex = try Executions.shared()
      if let existing = try ex.existing(proposalId: pid) { PoCLog.append("ADD dup skip \(pid) \(existing)"); return }
      let store = EKEventStore()
      let ev = EKEvent(eventStore: store)
      ev.title = title; ev.startDate = start; ev.endDate = start.addingTimeInterval(3600)
      ev.calendar = store.defaultCalendarForNewEvents
      try store.save(ev, span: .thisEvent, commit: true)
      try ex.record(proposalId: pid, eventkitId: ev.eventIdentifier)
      let bg = await MainActor.run { UIApplication.shared.applicationState == .background }
      PoCLog.append("ADD ok \(pid) \(ev.eventIdentifier ?? "-") bg=\(bg)")
    } catch { PoCLog.append("ADD fail \(pid) \(error)") }
  }
}

final class NotificationDelegate: NSObject, UNUserNotificationCenterDelegate {
  func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
    guard response.actionIdentifier == "ADD" else { return }
    await NotificationActions.handleAdd(userInfo: response.notification.request.content.userInfo)
  }
}
