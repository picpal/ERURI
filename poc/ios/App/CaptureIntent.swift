import AppIntents
import UIKit
import EruriCore

struct CaptureIntent: AppIntent {
  static let title: LocalizedStringResource = "비서에 저장"
  static let description = IntentDescription("알림·메시지 텍스트를 비서 큐에 저장합니다")
  static let supportedModes: IntentModes = .background
  static let authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed

  // 기본값 "": 미리보기 꺼짐 등으로 본문이 비어 와도 단축어가 값을 묻지 않고 실행돼 textLen=0 으로 기록되게 한다
  @Parameter(title: "본문", default: "") var text: String
  @Parameter(title: "앱 이름") var appName: String?
  @Parameter(title: "제목") var title: String?
  @Parameter(title: "발신자") var sender: String?
  @Parameter(title: "출처", default: "NOTIFICATION") var source: String

  func perform() async throws -> some IntentResult & ProvidesDialog {
    let started = Date()
    let (locked, bg) = await AppState.snapshot()
    // PoC-1/2 판정용 필드 메타. 값은 남기지 않고 존재·길이만 남긴다(AGENTS §7)
    let meta = "src=\(source) app=\(appName ?? "nil") titleLen=\(title?.count ?? -1) textLen=\(text.count) sender=\(sender == nil ? "nil" : "set") locked=\(locked)"
    BFULog.append("CaptureIntent start textLen=\(text.count) locked=\(locked)")
    do {
      let result = try await runPipeline()
      PoCLog.append("CaptureIntent \(result) \(Int(Date().timeIntervalSince(started) * 1000))ms \(meta)")
      trace(result: result, started: started, locked: locked, bg: bg)
      await upload(locked: locked)
      return .result(dialog: "\(result)")
    } catch {
      PoCLog.append("CaptureIntent error \(type(of: error)) \(meta)")
      BFULog.append("CaptureIntent error \(type(of: error)) textLen=\(text.count)")
      trace(result: "error:\(type(of: error))", started: started, locked: locked, bg: bg)
      await upload(locked: locked)
      throw error
    }
  }

  /// PoC-9(0.2.0): 인텐트가 깨어 있는 동안 바로 올린다(직접 요청 → 실패 시 background 세션). 폐기돼도 trace·남은 큐를 올린다.
  /// `locked` 는 인텐트 시작 시점 값. 그래도 남은 항목은 BG refresh 가 줍는다
  private func upload(locked: Bool) async {
    let r = await Uploader.shared.flush(trigger: .intent, locked: locked)
    if r.handedOff + r.failed > 0 { BackgroundRefresh.schedule() }
  }

  /// PoC-1(알림)/PoC-2(메시지) 판정 필드: 앱명·제목·본문·발신자가 도착했는지와 길이만. 원문은 보내지 않는다
  private func trace(result: String, started: Date, locked: Bool, bg: Bool) {
    Trace.log(source == "MESSAGES" ? "poc2.intent_fired" : "poc1.intent_fired", [
      "source": source, "app": appName ?? "", "app_set": appName != nil, "title_len": title?.count ?? -1,
      "text_len": text.count, "text_sha8": Trace.sha8(text), "sender_set": sender != nil, "sender_len": sender?.count ?? -1,
      "result": result, "elapsed_ms": Int(Date().timeIntervalSince(started) * 1000), "locked": locked, "bg": bg,
    ])
  }

  /// 반환: "queued:<fm|rules>" 또는 "discarded:<reason>"
  func runPipeline() async throws -> String {
    // 연락처는 앱이 App Group 에 캐시한 이름만 읽는다(백그라운드에서 연락처 DB 를 열지 않음)
    let pipeline = CapturePipeline(filter: RuleFilter(contactNames: ContactNames.cached()), queue: try CaptureQueue.shared())
    let masked: String, maskedTitle: String?
    switch pipeline.filterOnly(title: title, text: text, sender: sender) {
    case .discard(let reason): return "discarded:\(reason)"   // otp / contact
    case .pass(let t, let m): maskedTitle = t; masked = m
    }
    let outcome = await FMClassifier().classifyDetailed(text: masked, appName: appName, title: maskedTitle)
    switch CapturePipeline.route(outcome, appName: appName) {
    case .discard(let reason):
      if case .verdict(let v) = outcome { PoCLog.append("FM discard \(v.kind) \(v.confidence)") }
      return "discarded:\(reason)"
    case .queue(let deviceFilter):
      if deviceFilter == "rules" { PoCLog.append("FM fallback \(outcome) kind=unknown") }
      try pipeline.enqueue(source: source, appName: appName, title: maskedTitle, sender: sender, masked: masked, deviceFilter: deviceFilter)
      return "queued:\(deviceFilter)"
    }
  }
}
