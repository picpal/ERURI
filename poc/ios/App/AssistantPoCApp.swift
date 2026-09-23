import SwiftUI
import AssistantCore

@main
struct AssistantPoCApp: App {
  init() {
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
  }

  var body: some Scene {
    WindowGroup {
      ContentView()
    }
  }
}
