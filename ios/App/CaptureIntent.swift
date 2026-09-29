import AppIntents
import UIKit
import UserNotifications
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

  /// 대화상자를 돌려주지 않는다: 자동화 실행마다 단축어가 결과 배너를 띄웠다. 결과 표시는 설정 "저장 결과 알림"(기본 off)일 때만 로컬 알림으로
  func perform() async throws -> some IntentResult {
    let started = Date()
    let st = await AppState.snapshot()
    // 진단용 필드 메타. 값은 남기지 않고 존재·길이만 남긴다(AGENTS §7)
    let meta = "src=\(source) app=\(appName ?? "nil") titleLen=\(title?.count ?? -1) textLen=\(text.count) sender=\(sender == nil ? "nil" : "set") lock=\(st.lock.rawValue)"
    BFULog.append("CaptureIntent start textLen=\(text.count) lock=\(st.lock.rawValue)")
    do {
      let (result, qid) = try await runPipeline()
      DiagLog.append("CaptureIntent \(result) \(Int(Date().timeIntervalSince(started) * 1000))ms \(meta)")
      trace(result: result, queueID: qid, started: started, state: st)
      await upload(locked: st.lock.boolValue)
      await notifyResult(result)
      await DeviceRegistrar.shared.register()   // 24시간 지났으면 재등록(M1-⑤). 결과 알림 뒤라 등록 왕복이 알림을 늦추지 않는다
      return .result()
    } catch {
      DiagLog.append("CaptureIntent error \(type(of: error)) \(meta)")
      BFULog.append("CaptureIntent error \(type(of: error)) textLen=\(text.count)")
      trace(result: "error:\(type(of: error))", queueID: nil, started: started, state: st)
      await upload(locked: st.lock.boolValue)
      await DeviceRegistrar.shared.register()
      throw error
    }
  }

  private func notifyResult(_ result: String) async {
    guard CaptureResultNotice.isEnabled() else { return }
    let c = UNMutableNotificationContent()
    c.title = "비서에 저장"; c.body = result   // 결과 코드만(본문 원문 없음)
    try? await UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: UUID().uuidString, content: c, trigger: nil))
  }

  /// 인텐트가 깨어 있는 동안 바로 올린다(직접 요청 → 실패 시 background 세션). 폐기돼도 trace·남은 큐를 올린다.
  /// `locked` 는 인텐트 시작 시점 판정(nil = unknown). 그래도 남은 항목은 BG refresh 가 줍는다
  private func upload(locked: Bool?) async {
    let r = await Uploader.shared.flush(trigger: .intent, locked: locked)
    if r.handedOff + r.failed > 0 { BackgroundRefresh.schedule() }
  }

  /// 진단 필드: 앱명·제목·본문·발신자가 도착했는지와 길이만. 원문은 보내지 않는다.
  /// `queue_id` 는 서버 대조용(`items.idempotency_key = source:queue_id`). 폐기·오류면 빈 값
  private func trace(result: String, queueID: String?, started: Date, state: AppState.Snapshot) {
    let base: [String: Any] = [
      "source": source, "app": appName ?? "", "app_set": appName != nil, "title_len": title?.count ?? -1,
      "text_len": text.count, "text_sha8": Trace.sha8(text), "sender_set": sender != nil, "sender_len": sender?.count ?? -1,
      "result": result, "queue_id": queueID ?? "", "elapsed_ms": Int(Date().timeIntervalSince(started) * 1000),
    ]
    Trace.log("capture.intent_fired", base.merging(state.traceFields) { _, new in new })
  }

  /// 반환: ("queued:<fm|rules>", 큐 항목 id) 또는 ("discarded:<reason>", nil)
  func runPipeline() async throws -> (result: String, queueID: String?) {
    // 연락처는 앱이 App Group 에 캐시한 이름만 읽는다(백그라운드에서 연락처 DB 를 열지 않음)
    let pipeline = CapturePipeline(filter: RuleFilter(contactNames: ContactNames.cached()), queue: try CaptureQueue.shared())
    let masked: String, maskedTitle: String?
    switch pipeline.filterOnly(title: title, text: text, sender: sender) {
    case .discard(let reason): return ("discarded:\(reason)", nil)   // otp / contact
    case .pass(let t, let m): maskedTitle = t; masked = m
    }
    let outcome = await FMClassifier().classifyDetailed(text: masked, appName: appName, title: maskedTitle)
    switch CapturePipeline.route(outcome, appName: appName) {
    case .discard(let reason):
      if case .verdict(let v) = outcome { DiagLog.append("FM discard \(v.kind) \(v.confidence)") }
      return ("discarded:\(reason)", nil)
    case .queue(let deviceFilter):
      if deviceFilter == "rules" { DiagLog.append("FM fallback \(outcome) kind=unknown") }
      let qid = try pipeline.enqueue(source: source, appName: appName, title: maskedTitle, sender: sender, masked: masked, deviceFilter: deviceFilter)
      return ("queued:\(deviceFilter)", qid)
    }
  }
}
