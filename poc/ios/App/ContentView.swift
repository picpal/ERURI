import SwiftUI
import UserNotifications
import EventKit
import AssistantCore

struct ContentView: View {
  @State private var items: [CaptureItem] = []
  @State private var logLines: [String] = []
  @State private var lastResult: String = ""

  var body: some View {
    NavigationStack {
      List {
        Section("디버그") {
          Button("권한 요청 (알림·캘린더)") { requestPermissions() }
          Button("디버그: 파이프라인 직접 호출") { runDebugCapture() }
          if !lastResult.isEmpty { Text("결과: \(lastResult)").font(.caption).foregroundStyle(.secondary) }
        }
        Section("큐 (\(items.count)건)") {
          if items.isEmpty {
            Text("비어 있음").foregroundStyle(.secondary)
          } else {
            ForEach(items, id: \.id) { item in
              VStack(alignment: .leading) {
                Text("[\(item.source)] \(item.appName ?? "-")").font(.caption).foregroundStyle(.secondary)
                Text(item.text)
              }
            }
          }
        }
        Section("poc.log") {
          if logLines.isEmpty {
            Text("비어 있음").foregroundStyle(.secondary)
          } else {
            ForEach(logLines, id: \.self) { line in
              Text(line).font(.system(.caption, design: .monospaced))
            }
          }
        }
      }
      .navigationTitle("Assistant PoC")
      .toolbar {
        ToolbarItem(placement: .navigationBarTrailing) {
          Button("새로고침") { refresh() }
        }
      }
      .onAppear { refresh() }
    }
  }

  private func requestPermissions() {
    UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { granted, error in
      PoCLog.append("notif permission granted=\(granted) error=\(String(describing: error))")
    }
    EKEventStore().requestFullAccessToEvents { granted, error in
      PoCLog.append("calendar permission granted=\(granted) error=\(String(describing: error))")
    }
  }

  private func refresh() {
    items = (try? CaptureQueue.shared().pending(limit: 50)) ?? []
    logLines = PoCLog.tail(lines: 20)
  }

  private func runDebugCapture() {
    do {
      let pipeline = CapturePipeline(filter: RuleFilter(), queue: try CaptureQueue.shared())
      lastResult = try pipeline.handle(source: "NOTIFICATION", appName: "DebugButton", title: "디버그", sender: nil,
                                        text: "디버그 버튼에서 큐에 넣은 테스트 알림입니다")
      PoCLog.append("DebugButton \(lastResult)")
    } catch {
      lastResult = "error:\(error)"
    }
    refresh()
  }
}
