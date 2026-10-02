import Foundation

/// 링크 대기 행(스펙 §6 "확장과 앱의 이어받기"). App Group 큐(`kind = 'link'`)에 JSON 으로 둔다
public struct PendingLink: Codable, Equatable, Sendable {
  /// 큐 행 id `link:<captureID>` — 캡처 행과 같은 표(id PK)를 쓰므로 접두로 나눈다
  public var id: String
  /// 큐 항목 id = 서버 멱등 키(`SHARE:<captureID>`). 주소에서 정해진다(`LinkText.captureID(for:)`) — 같은 링크면 같다(D14)
  public var captureID: String
  public var url: String
  /// 공유·채팅에 함께 적은 글. 관문(`LinkFlow.admit`)이 기기 규칙으로 마스킹한 뒤에만 행에 들어간다
  public var note: String?
  /// share | chat
  public var origin: String
  /// 공유·붙여넣은 시각 = 서버 occurred_at(상대 날짜 기준일)
  public var capturedAt: Date
  /// 앱이 읽다 실패한 횟수(`claimLinks` 가 큐 attempts 열에서 채운다)
  public var attempts: Int

  public init(url: URL, note: String?, origin: String, capturedAt: Date = Date()) {
    let c = LinkText.captureID(for: url)
    id = "link:" + c; captureID = c; self.url = url.absoluteString; self.note = note; self.origin = origin
    self.capturedAt = capturedAt; attempts = 0
  }
}

/// 렌더링 결과. 실패 코드는 진단·화면 문구에만 쓴다(주소·본문 없음):
/// blocked_scheme · blocked_host · http_<n> · unsupported · redirects · insecure · load_failed · web_process · timeout · empty · extract_failed · no_host · cancelled
public enum LinkRenderOutcome: Equatable, Sendable {
  case page(LinkPage, elapsedMs: Int)
  case failed(String)
}

/// 렌더러(실제는 `LinkRenderer`, 테스트는 가짜). WebKit 이라 메인 액터
@MainActor public protocol LinkRendering: AnyObject {
  func render(_ url: URL, budget: TimeInterval, ocr: Bool) async -> LinkRenderOutcome
}

/// 링크 → 큐 항목 흐름(스펙 §6 "링크·이미지 읽기"). 공유 확장·앱이 같이 쓴다
public enum LinkFlow {
  public static let shareLease: TimeInterval = 60
  public static let shareBudget: TimeInterval = 10
  public static let appBudget: TimeInterval = 15
  /// 공유 확장에서 렌더링할지. 시뮬레이터 G8(U1)·실기기 D1(U3)이 실패하면 false — 확장은 대기 행만 남기고 앱이 읽는다(스펙 §6 "실기기 미확인")
  public static let renderInShareExtension = true
  /// 확장이 앱에 넘길 실패(앱은 시간이 더 길고 OCR 을 한다). 나머지(blocked_*·http_<n>·unsupported·redirects·insecure)는 다시 해도 같다 — 행을 지운다
  public static let handOffCodes: Set<String> = ["timeout", "load_failed", "web_process", "extract_failed", "no_host", "cancelled", "empty"]
  /// 앱에서 다시 해 볼 실패(백오프 30초×2ⁿ, maxAppAttempts 회째에 지운다). cancelled 는 따로 — 행을 그대로 돌려놓고 시도로 세지 않는다
  public static let retryCodes: Set<String> = ["timeout", "load_failed", "web_process", "extract_failed", "no_host"]
  public static let maxAppAttempts = 3

  public enum Outcome: Equatable, Sendable {
    case queued(captureID: String, chars: Int, ocr: Bool, timedOut: Bool)
    /// 이미 읽은 링크(D14) — 렌더링·행 없음
    case duplicate
    /// 기기 규칙(otp 등) — 큐에 아무것도 남기지 않는다(메모 폐기면 대기 행도 만들지 않는다)
    case discarded(String)
    /// 확장 → 앱 이어받기(no_date · disabled · handOffCodes)
    case handedOff(String)
    /// 앱: 행을 남겨 다시 읽는다(retryCodes 는 백오프, cancelled 는 바로)
    case retry(String)
    /// 끝(사유 코드). 대기 행도 지웠다(queue = 큐 쓰기 실패)
    case failed(String)
  }

  public enum Admission: Equatable, Sendable { case go(PendingLink), stop(Outcome) }

  /// 읽기 전 관문(스펙 §6): 이미 읽은 링크면 duplicate, 메모가 기기 규칙에 걸리면 discarded — 둘 다 행을 만들지 않는다(App Group 에 인증번호를 남기지 않는다).
  /// 통과하면 마스킹한 메모로 대기 행을 남긴다(lease: 확장 60초, 채팅 600초)
  public static func admit(_ link: PendingLink, queue: CaptureQueue, lease: TimeInterval, now: Date = Date()) -> Admission {
    if (try? queue.isLinkSeen(captureID: link.captureID, now: now)) == true { return .stop(.duplicate) }
    var l = link
    if let n = link.note {
      switch RuleFilter().apply(text: n, sender: nil) {
      case .discard(let r): return .stop(.discarded(r))
      case .pass(let m): l.note = m
      }
    }
    do { try queue.enqueueLink(l, lease: lease, now: now) } catch { return .stop(.failed("queue")) }
    return .go(l)
  }

  /// 공유 확장: 관문 → 대기 행(확장이 죽어도 앱이 이어받게) → OCR 없이 읽는다. 날짜 후보가 없으면 앱(OCR)에 넘긴다
  @MainActor public static func share(_ link: PendingLink, renderer: LinkRendering?, queue: CaptureQueue,
                                      render: Bool = renderInShareExtension) async -> Outcome {
    let l: PendingLink
    switch admit(link, queue: queue, lease: shareLease) {
    case .stop(let o): return o
    case .go(let admitted): l = admitted
    }
    guard render, let renderer, let url = URL(string: l.url) else { try? queue.releaseLink(id: l.id); return .handedOff("disabled") }
    switch await renderer.render(url, budget: shareBudget, ocr: false) {
    case .failed(let code) where handOffCodes.contains(code):
      try? queue.releaseLink(id: l.id); return .handedOff(code)
    case .failed(let code):
      try? queue.markSent(id: l.id); return .failed(code)
    case .page(let page, _):
      guard LinkText.hasDateCandidate(page.searchable) else { try? queue.releaseLink(id: l.id); return .handedOff("no_date") }
      return finish(l, page: page, queue: queue)
    }
  }

  /// 앱(foreground): 15초 + 날짜 후보가 없거나 글이 없으면 OCR. 재시도 가능한 실패는 행을 남기고(3회째에 삭제), 취소는 행을 돌려놓고,
  /// 확정 실패는 행을 지운다(호출 쪽이 지워진 경우에만 알린다)
  @MainActor public static func app(_ link: PendingLink, renderer: LinkRendering, queue: CaptureQueue) async -> Outcome {
    guard let url = URL(string: link.url) else { try? queue.markSent(id: link.id); return .failed("bad_url") }
    switch await renderer.render(url, budget: appBudget, ocr: true) {
    case .failed("cancelled"):
      try? queue.releaseLink(id: link.id); return .retry("cancelled")                // 앱이 비활성 — 시도로 세지 않는다
    case .failed(let code) where retryCodes.contains(code) && link.attempts + 1 < maxAppAttempts:
      try? queue.markFailed(id: link.id); return .retry(code)
    case .failed(let code):
      try? queue.markSent(id: link.id); return .failed(code)
    case .page(let page, _):
      return finish(link, page: page, queue: queue)
    }
  }

  /// 본문 만들기 → 기기 규칙 → 큐 항목(id = captureID) → 대기 행 삭제 → (넣었으면) 읽은 링크 기록. 큐 쓰기가 실패하면 행을 남긴다(다음 foreground 에 다시)
  static func finish(_ link: PendingLink, page: LinkPage, queue: CaptureQueue) -> Outcome {
    let c = LinkText.compose(page, note: link.note)
    let result: String
    do {
      result = try CapturePipeline(filter: RuleFilter(), queue: queue)
        .handleRead(id: link.captureID, appName: LinkText.appName, title: c.title, text: c.text, capturedAt: link.capturedAt)
    } catch { return .failed("queue") }
    try? queue.markSent(id: link.id)
    guard result == "queued" else { return .discarded(String(result.dropFirst("discarded:".count))) }
    try? queue.markLinkSeen(captureID: link.captureID)
    return .queued(captureID: link.captureID, chars: c.text.count, ocr: page.ocrText != nil, timedOut: page.timedOut)
  }

  /// 로그 한 단어(DiagLog): queued · duplicate · discarded:<r> · handed_off:<r> · retry:<r> · failed:<r>
  public static func code(_ o: Outcome) -> String {
    switch o {
    case .queued: return "queued"
    case .duplicate: return "duplicate"
    case .discarded(let r): return "discarded:\(r)"
    case .handedOff(let r): return "handed_off:\(r)"
    case .retry(let r): return "retry:\(r)"
    case .failed(let r): return "failed:\(r)"
    }
  }

  /// trace `share.link` 필드(스펙 §6 "진단"): 결과 코드·수만. 주소·호스트·제목·본문 없음(이벤트 접두는 서버가 받는 share. — F8)
  public static func traceFields(_ o: Outcome, origin: String, elapsedMs: Int, blockedNav: Int = 0) -> [String: Any] {
    var f: [String: Any] = ["origin": origin, "elapsed_ms": elapsedMs, "blocked_nav": blockedNav]
    switch o {
    case .queued(_, let chars, let ocr, let timedOut): f["result"] = "queued"; f["chars"] = chars; f["ocr"] = ocr; f["timed_out"] = timedOut
    case .duplicate: f["result"] = "duplicate"
    case .discarded(let r): f["result"] = "discarded"; f["code"] = r
    case .handedOff(let r): f["result"] = "handed_off"; f["code"] = r
    case .retry(let r): f["result"] = "retry"; f["code"] = r
    case .failed(let r): f["result"] = "failed"; f["code"] = r
    }
    return f
  }
}

/// 사진 → 큐 항목(스펙 §6 "사진 OCR", LI3). 파일·대기 행 없이 OCR 글만 SHARE 항목(`app_name = "이미지"`)으로. 공유 확장·채팅이 같이 쓴다
public enum ImageFlow {
  public enum Outcome: Equatable, Sendable {
    case queued(captureID: String, chars: Int, images: Int)
    case discarded(String)
    /// 글자가 없는 사진(ImageText.minChars 미만) — 큐에 아무것도 넣지 않는다
    case empty
    case failed(String)
  }

  /// 사진마다의 OCR 글 → 본문(ImageText) → 기기 규칙 → 큐 항목(id 는 새 UUID — 사진은 같은 사진 판정을 하지 않는다)
  public static func finish(ocr: [String], images: Int, note: String?, queue: CaptureQueue, capturedAt: Date = Date()) -> Outcome {
    guard case .text(let text, _) = ImageText.compose(ocr: ocr, images: images, note: note) else { return .empty }
    let id = UUID().uuidString
    do {
      let r = try CapturePipeline(filter: RuleFilter(), queue: queue)
        .handleRead(id: id, appName: ImageText.appName, title: nil, text: text, capturedAt: capturedAt)
      guard r == "queued" else { return .discarded(String(r.dropFirst("discarded:".count))) }
      return .queued(captureID: id, chars: text.count, images: images)
    } catch { return .failed("queue") }
  }

  public static func code(_ o: Outcome) -> String {
    switch o {
    case .queued: return "queued"
    case .discarded(let r): return "discarded:\(r)"
    case .empty: return "empty"
    case .failed(let r): return "failed:\(r)"
    }
  }

  /// trace `share.image` 필드: 결과 코드·글자 수·장 수만(OCR 글 없음)
  public static func traceFields(_ o: Outcome, origin: String, elapsedMs: Int, images: Int) -> [String: Any] {
    var f: [String: Any] = ["origin": origin, "elapsed_ms": elapsedMs, "images": images]
    switch o {
    case .queued(_, let chars, _): f["result"] = "queued"; f["chars"] = chars
    case .discarded(let r): f["result"] = "discarded"; f["code"] = r
    case .empty: f["result"] = "empty"
    case .failed(let r): f["result"] = "failed"; f["code"] = r
    }
    return f
  }
}
