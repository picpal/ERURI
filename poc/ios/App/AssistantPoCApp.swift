import SwiftUI
import UserNotifications
import EventKit
import AssistantCore

@main
struct AssistantPoCApp: App {
  private static let notificationDelegate = NotificationDelegate()
  @Environment(\.scenePhase) private var scenePhase

  init() {
    NotificationActions.register()
    UNUserNotificationCenter.current().delegate = Self.notificationDelegate
    BFULog.prepare()
    IngestSettings.seed(from: ProcessInfo.processInfo.environment)   // 저장값이 없을 때만 스킴 INGEST_URL 을 초기값으로
    PoCLog.append("ingest base=\(Uploader.base.absoluteString)")
    Uploader.shared.flush()

    // 시뮬레이터에 탭 자동화 도구(idb 등)가 없어 단축어 앱을 직접 조작할 수 없을 때,
    // `simctl launch <udid> <bundle> --poc-debug-capture` 로 같은 파이프라인을 실제 앱 프로세스에서 검증하는 훅.
    if CommandLine.arguments.contains("--poc-debug-capture") {
      do {
        let pipeline = CapturePipeline(filter: RuleFilter(contactNames: ContactNames.cached()), queue: try CaptureQueue.shared())
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

    // MED-5 검증: 같은 proposal_id 로 handleAdd 를 동시에 두 번 부른다. `--poc-debug-notification-action-concurrent [--proposal-id=<id>]`
    if CommandLine.arguments.contains("--poc-debug-notification-action-concurrent") {
      let prefix = "--proposal-id="
      let pid = CommandLine.arguments.first(where: { $0.hasPrefix(prefix) }).map { String($0.dropFirst(prefix.count)) } ?? "p-conc"
      Task {
        // userInfo 는 Sendable 이 아니므로 각 자식 태스크 안에서 만든다
        async let a: Void = NotificationActions.handleAdd(userInfo: ["proposal_id": pid, "title": "병원 예약", "start": "2026-09-25T15:00:00+09:00"])
        async let b: Void = NotificationActions.handleAdd(userInfo: ["proposal_id": pid, "title": "병원 예약", "start": "2026-09-25T15:00:00+09:00"])
        _ = await (a, b)
      }
    }

    // PoC-5 로컬 알림: `--poc-debug-local-notification[=<seconds>] [--proposal-id=<id>]` (기본 10초). APNs 없이 배너·액션 경로를 탄다.
    let localPrefix = "--poc-debug-local-notification"
    if let arg = CommandLine.arguments.first(where: { $0.hasPrefix(localPrefix) }) {
      let seconds = TimeInterval(arg.split(separator: "=").last.map(String.init) ?? "") ?? 10
      let prefix = "--proposal-id="
      let pid = CommandLine.arguments.first(where: { $0.hasPrefix(prefix) }).map { String($0.dropFirst(prefix.count)) } ?? "p-local-1"
      NotificationActions.scheduleLocal(proposalId: pid, after: seconds)
    }

    // CaptureIntent.perform() 을 앱 프로세스에서 그대로 실행한다(단축어 호출 경로는 아님).
    // `--poc-debug-capture-intent=<app> [--poc-debug-title=<t>] [--poc-debug-sender=<s>]` : 합성 본문으로 규칙→FM→라우팅→큐 전체를 탄다.
    // 제목·발신자를 바꾸면 연락처 규칙(`discarded:contact`)을 앱 프로세스에서 실측할 수 있다.
    let intentPrefix = "--poc-debug-capture-intent="
    if let arg = CommandLine.arguments.first(where: { $0.hasPrefix(intentPrefix) }) {
      let app = String(arg.dropFirst(intentPrefix.count))
      func value(_ prefix: String) -> String? {
        CommandLine.arguments.first(where: { $0.hasPrefix(prefix) }).map { String($0.dropFirst(prefix.count)) }
      }
      let title = value("--poc-debug-title=") ?? "합성병원", sender = value("--poc-debug-sender=")
      Task {
        // 앱 실행 직후라 scenePhase 갱신보다 먼저 돌 수 있어 연락처 캐시를 동기로 한 번 채운다
        await ContactsLoader.refreshNow()
        let intent = CaptureIntent()
        intent.text = "[합성] 9월 25일 15:00 진료 예약이 확정되었습니다"
        intent.appName = app; intent.title = title; intent.sender = sender; intent.source = "NOTIFICATION"
        do { _ = try await intent.perform() } catch { PoCLog.append("DebugCaptureIntent error:\(type(of: error))") }
      }
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

    // 시뮬레이터에 공유 시트를 탭할 자동화 도구가 없어, ShareViewController 가 하는 것과
    // 동일한 AssistantCore 호출(OCR -> 규칙 필터 -> 통과 시 파일 영속화 -> CaptureQueue.enqueue)을 launch argument 로 직접
    // 재현하는 훅. `--poc-debug-share-image=<host absolute path>`.
    let shareImagePrefix = "--poc-debug-share-image="
    if let arg = CommandLine.arguments.first(where: { $0.hasPrefix(shareImagePrefix) }) {
      let src = URL(fileURLWithPath: String(arg.dropFirst(shareImagePrefix.count)))
      Task {
        do {
          let ocr = (try? await OCR.recognize(imageURL: src)) ?? ""
          let result = try CapturePipeline(filter: RuleFilter(), queue: try CaptureQueue.shared()).handleShareFile(ocrText: ocr) { id in
            try ShareInbox.persist(src, id: id, ext: "jpg")
          }
          PoCLog.append("DebugShareImage \(result) ocrLen=\(ocr.count)")
        } catch {
          PoCLog.append("DebugShareImage error:\(error)")
        }
      }
    }
  }

  var body: some Scene {
    WindowGroup {
      ContentView()
    }
    .onChange(of: scenePhase) { _, newPhase in
      if newPhase == .active { ContactsLoader.refresh(); Uploader.shared.flush() }
    }
  }
}
