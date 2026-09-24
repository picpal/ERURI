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
    let result = try await runPipeline(pipeline)
    let ms = Int(Date().timeIntervalSince(started) * 1000)
    let locked = await MainActor.run { UIApplication.shared.isProtectedDataAvailable == false }
    PoCLog.append("CaptureIntent \(result) \(ms)ms locked=\(locked)")
    return .result(dialog: "\(result)")
  }

  private func runPipeline(_ pipeline: CapturePipeline) async throws -> String {
    guard case .pass(let masked) = pipeline.filterOnly(text: text, sender: sender) else {
      PoCLog.append("rule discard"); return "discarded:rule"
    }
    let isChatApp = ["KakaoTalk", "카카오톡", "Instagram"].contains(appName ?? "")
    if FMClassifier.availability() == "available" {
      if let v = try await FMClassifier().classify(text: masked, appName: appName) {
        if v.kind != .notice { PoCLog.append("FM discard \(v.kind) \(v.confidence)"); return "discarded:fm:\(v.kind.rawValue)" }
      } else if isChatApp {
        return "discarded:fm-timeout"
      }
    } else if isChatApp {
      return "discarded:fm-unavailable"
    }
    try pipeline.enqueue(source: source, appName: appName, title: title, sender: sender, masked: masked)
    return "queued"
  }
}
