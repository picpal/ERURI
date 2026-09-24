import SwiftUI
import UserNotifications
import EventKit
import AssistantCore

@main
struct AssistantPoCApp: App {
  private static let notificationDelegate = NotificationDelegate()

  init() {
    NotificationActions.register()
    UNUserNotificationCenter.current().delegate = Self.notificationDelegate

    // 시뮬레이터에 탭 자동화 도구(idb 등)가 없어 단축어 앱을 직접 조작할 수 없을 때,
    // `simctl launch <udid> <bundle> --poc-debug-capture` 로 같은 파이프라인을 실제 앱 프로세스에서 검증하는 훅.
    if CommandLine.arguments.contains("--poc-debug-capture") {
      do {
        let pipeline = CapturePipeline(filter: RuleFilter(), queue: try CaptureQueue.shared())
        let result = try pipeline.handle(source: "NOTIFICATION", appName: "LaunchArgDebug", title: "런치아규먼트 디버그",
                                          sender: nil, text: "launch argument 로 큐에 넣은 테스트 알림입니다")
        PoCLog.append("LaunchArgDebug \(result)")
      } catch {
        PoCLog.append("LaunchArgDebug error:\(error)")
      }
    }

    // 알림 배너의 액션 버튼을 시뮬레이터에서 탭할 자동화 도구가 없어,
    // `simctl launch <udid> <bundle> --poc-debug-notification-action [--proposal-id=<id>]` 로
    // NotificationDelegate 가 받는 것과 동일한 핸들러(NotificationActions.handleAdd)를 직접 호출해 검증하는 훅.
    if CommandLine.arguments.contains("--poc-debug-notification-action") {
      let prefix = "--proposal-id="
      let pid = CommandLine.arguments.first(where: { $0.hasPrefix(prefix) }).map { String($0.dropFirst(prefix.count)) } ?? "p-001"
      let userInfo: [AnyHashable: Any] = ["proposal_id": pid, "title": "병원 예약", "start": "2026-09-25T15:00:00+09:00"]
      Task { await NotificationActions.handleAdd(userInfo: userInfo) }
    }

    // OS 레벨에서 실제로 몇 건이 생성됐는지 독립 검증하기 위한 훅: `--poc-debug-count-events`.
    if CommandLine.arguments.contains("--poc-debug-count-events") {
      let store = EKEventStore()
      let start = ISO8601DateFormatter().date(from: "2026-09-25T00:00:00+09:00")!
      let end = ISO8601DateFormatter().date(from: "2026-09-26T00:00:00+09:00")!
      let predicate = store.predicateForEvents(withStart: start, end: end, calendars: nil)
      let count = store.events(matching: predicate).filter { $0.title == "병원 예약" }.count
      PoCLog.append("EventCount 병원 예약 \(count)")
    }
  }

  var body: some Scene {
    WindowGroup {
      ContentView()
    }
  }
}
