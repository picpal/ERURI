import AppIntents
import UIKit
import AssistantCore

struct CaptureIntent: AppIntent {
  static let title: LocalizedStringResource = "비서에 저장"
  static let description = IntentDescription("알림·메시지 텍스트를 비서 큐에 저장합니다")
  static let supportedModes: IntentModes = .background
  static let authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed

  @Parameter(title: "본문") var text: String
  @Parameter(title: "앱 이름") var appName: String?
  @Parameter(title: "제목") var title: String?
  @Parameter(title: "발신자") var sender: String?
  @Parameter(title: "출처", default: "NOTIFICATION") var source: String

  func perform() async throws -> some IntentResult & ProvidesDialog {
    let started = Date()
    let pipeline = CapturePipeline(filter: RuleFilter(), queue: try CaptureQueue.shared())
    let result = try pipeline.handle(source: source, appName: appName, title: title, sender: sender, text: text)
    let ms = Int(Date().timeIntervalSince(started) * 1000)
    let locked = await MainActor.run { UIApplication.shared.isProtectedDataAvailable == false }
    PoCLog.append("CaptureIntent \(result) \(ms)ms locked=\(locked)")
    return .result(dialog: "\(result)")
  }
}
