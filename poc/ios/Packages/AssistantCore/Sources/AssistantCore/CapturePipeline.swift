import Foundation
public struct CapturePipeline {
  public let filter: RuleFilter
  public let queue: CaptureQueue
  public init(filter: RuleFilter, queue: CaptureQueue) { self.filter = filter; self.queue = queue }
  /// 반환: "queued" 또는 "discarded:<reason>". 제목도 규칙 필터를 거쳐 마스킹된 채 큐에 들어간다.
  public func handle(source: String, appName: String?, title: String?, sender: String?, text: String) throws -> String {
    switch filter.apply(title: title, text: text, sender: sender) {
    case .discard(let r): return "discarded:\(r)"
    case .pass(let maskedTitle, let masked):
      try enqueue(source: source, appName: appName, title: maskedTitle, sender: sender, masked: masked)
      return "queued"
    }
  }

  public func filterOnly(title: String?, text: String, sender: String?) -> CaptureVerdict {
    filter.apply(title: title, text: text, sender: sender)
  }

  /// Share Extension 텍스트·URL(스펙 §6: 1단계만). 반환: "queued" 또는 "discarded:<reason>"
  public func handleShare(text: String) throws -> String {
    switch filter.apply(text: text, sender: nil) {
    case .discard(let r): return "discarded:\(r)"
    case .pass(let masked):
      try enqueue(source: "SHARE", appName: nil, title: nil, sender: nil, masked: masked)
      return "queued"
    }
  }

  /// Share Extension 이미지·PDF. OCR 텍스트를 먼저 규칙에 통과시키고, 통과할 때만 `persist(id)` 로
  /// App Group 에 파일을 영속화한다(폐기면 파일도 남기지 않는다). `persist` 는 컨테이너 기준 상대 경로를 돌려준다.
  public func handleShareFile(ocrText: String, persist: (String) throws -> String) throws -> String {
    switch filter.apply(text: ocrText, sender: nil) {
    case .discard(let r): return "discarded:\(r)"
    case .pass(let masked):
      let id = UUID().uuidString
      let rel = try persist(id)
      try queue.enqueue(CaptureItem(id: id, source: "SHARE", appName: nil, sender: nil, title: nil,
                                    text: "", localFile: rel, ocrText: masked, capturedAt: Date(), attempts: 0))
      return "queued"
    }
  }

  public func enqueue(source: String, appName: String?, title: String?, sender: String?, masked: String, deviceFilter: String? = nil) throws {
    try queue.enqueue(CaptureItem(id: UUID().uuidString, source: source, appName: appName, sender: sender, title: title,
                                  text: masked, localFile: nil, ocrText: nil, capturedAt: Date(), attempts: 0, deviceFilter: deviceFilter))
  }

  /// 스펙 §6 2단계: FM 결과 → 적재/폐기. 불가·타임아웃·에러는 같은 폴백을 탄다:
  /// 카카오톡·Instagram 은 폐기(개인 대화 배제 우선), 그 외는 kind=unknown 으로 규칙만 통과(device_filter="rules", 서버 분류에 맡김).
  public static let chatApps: Set<String> = ["KakaoTalk", "카카오톡", "Instagram"]
  public enum Route: Equatable, Sendable { case queue(deviceFilter: String), discard(reason: String) }
  public static func route(_ outcome: FMOutcome, appName: String?) -> Route {
    let isChat = chatApps.contains(appName ?? "")
    switch outcome {
    case .verdict(let v): return v.kind == .notice ? .queue(deviceFilter: "fm") : .discard(reason: "fm:\(v.kind.rawValue)")
    case .unavailable: return isChat ? .discard(reason: "fm-unavailable") : .queue(deviceFilter: "rules")
    case .timeout: return isChat ? .discard(reason: "fm-timeout") : .queue(deviceFilter: "rules")
    case .error: return isChat ? .discard(reason: "fm-error") : .queue(deviceFilter: "rules")
    }
  }
}
