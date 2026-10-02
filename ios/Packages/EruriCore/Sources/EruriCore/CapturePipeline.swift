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

  /// 링크·사진 → 일정(스펙 §6 "링크·이미지 읽기"): 기기가 읽은 제목·본문을 규칙에 통과시켜 SHARE 항목(`app_name` = "웹 링크" | "이미지")으로 넣는다.
  /// 링크의 id = 주소에서 정해진 캡처 id — 확장이 죽은 뒤 앱이 다시 읽어도 큐(INSERT OR IGNORE)·서버 멱등 키(SHARE:<id>)가 한 건.
  /// 연락처 규칙은 쓰지 않는다(호출 쪽이 RuleFilter() — 사용자가 고른 링크·사진). 반환: "queued" 또는 "discarded:<reason>"
  public func handleRead(id: String, appName: String, title: String?, text: String, capturedAt: Date) throws -> String {
    switch filter.apply(title: title, text: text, sender: nil) {
    case .discard(let r): return "discarded:\(r)"
    case .pass(let maskedTitle, let masked):
      try queue.enqueue(CaptureItem(id: id, source: "SHARE", appName: appName, sender: nil, title: maskedTitle,
                                    text: masked, localFile: nil, ocrText: nil, capturedAt: capturedAt, attempts: 0))
      return "queued"
    }
  }

  /// 반환: 큐 항목 id(= 서버 idempotency_key 의 external_id). 인텐트가 진단 trace 의 queue_id 로 남긴다
  @discardableResult
  public func enqueue(source: String, appName: String?, title: String?, sender: String?, masked: String, deviceFilter: String? = nil) throws -> String {
    let id = UUID().uuidString
    try queue.enqueue(CaptureItem(id: id, source: source, appName: appName, sender: sender, title: title,
                                  text: masked, localFile: nil, ocrText: nil, capturedAt: Date(), attempts: 0, deviceFilter: deviceFilter))
    return id
  }

  /// 스펙 §6 2단계: FM 결과 → 적재/폐기. 타임아웃·생성 에러는 출처와 무관하게 kind=unknown 으로 규칙만 통과(device_filter="rules").
  /// 인텐트 프로세스의 FM 콜드 로드가 3초를 넘는 게 상수이고(0.2.3 실측) rateLimited 등도 건별로 나서 폐기하면 채팅 앱 항목이 유실된다 — 개인 대화는 서버 게이트가 거른다.
  /// 불가만 폴백: 카카오톡·Instagram 은 폐기(기기 방어선이 없으니 개인 대화 배제 우선), 그 외는 "rules" 로 통과(서버 분류에 맡김).
  public static let chatApps: Set<String> = ["KakaoTalk", "카카오톡", "Instagram"]
  public enum Route: Equatable, Sendable { case queue(deviceFilter: String), discard(reason: String) }
  public static func route(_ outcome: FMOutcome, appName: String?) -> Route {
    let isChat = chatApps.contains(appName ?? "")
    switch outcome {
    case .verdict(let v): return v.kind == .notice ? .queue(deviceFilter: "fm") : .discard(reason: "fm:\(v.kind.rawValue)")
    case .unavailable: return isChat ? .discard(reason: "fm-unavailable") : .queue(deviceFilter: "rules")
    case .timeout: return .queue(deviceFilter: "rules")
    case .error: return .queue(deviceFilter: "rules")
    }
  }
}
