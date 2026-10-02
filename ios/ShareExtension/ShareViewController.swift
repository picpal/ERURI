import UIKit
import EruriCore

final class ShareViewController: UIViewController {
  /// DEBUG 빌드만 루프백 주소를 연다(시뮬레이터 게이트, 스펙 §6 "주소 검사")
  #if DEBUG
  static let allowLoopback = true
  #else
  static let allowLoopback = false
  #endif

  override func viewDidLoad() {
    super.viewDidLoad()
    Task { await handle(); extensionContext?.completeRequest(returningItems: nil) }
  }

  /// 스펙 §6: 규칙 단계만 적용해 큐에 넣는다. 폐기(OTP)면 큐에도, App Group 에도 남기지 않는다.
  /// 1단계는 텍스트·URL·이미지(기기 OCR 글만, 0.11.0)를 받는다(스펙 §15 1a). 이미지 파일·PDF 업로드는 서버 파일 경로가 생기는 2단계.
  /// 공유 한 번의 모든 텍스트 표현(attributedContentText·첨부 plain-text·URL)을 모아 `ShareText.compose` 로 큐 항목 하나로 만든다.
  /// 첨부 하나만 읽으면 호스트가 넘긴 제목·일부만 들어온다(실기기 0.3.0 메모 앱 10자, 2026-09-30). 표현마다 64KiB, 본문 64K자 상한.
  /// 웹 주소 하나 + 짧은 메모면 링크 읽기, 아니고 이미지가 있으면 사진 읽기(스펙 §6 "링크·이미지 읽기", 0.11.0) — 시트 안 상태 화면을 띄우고 끝나면 닫는다
  private func handle() async {
    guard let items = extensionContext?.inputItems as? [NSExtensionItem] else { return }
    let started = Date()
    let collected = await ShareText.collect(items)
    let out = ShareText.compose(collected.pieces)
    if let out, let link = LinkText.shareLink(out.text) { await readLink(link.url, note: link.note, original: out, collected, started); return }
    if ShareImages.count(items) > 0 { await readImages(items, text: out, collected, started); return }
    guard let out else { Self.trace("-", "empty", started, collected.fields(truncatedOutput: false)); return }
    handleText(out, collected, started)
  }

  /// 텍스트 공유(0.10.0 과 같다). 반환: 큐 결과("queued" · "discarded:<r>" · "error:<type>") — 링크 폴백이 문구를 고른다
  @discardableResult
  private func handleText(_ out: ShareText.Composed, _ collected: ShareText.Collected, _ started: Date) -> String {
    let text = out.text, diag = collected.fields(truncatedOutput: out.truncated)
    let kind = ShareText.isWebURL(text) ? "url" : "text"
    do {
      let pipeline = CapturePipeline(filter: RuleFilter(), queue: try CaptureQueue.shared())
      let result = try pipeline.handleShare(text: text)
      DiagLog.append("ShareExtension \(kind) \(result)")
      Self.trace(kind, result, started, diag.merging(["text_len": text.count, "text_sha8": Trace.sha8(text)]) { a, _ in a })
      return result
    } catch {
      DiagLog.append("ShareExtension error \(type(of: error))")
      Self.trace(kind, "error:\(type(of: error))", started, diag)
      return "error:\(type(of: error))"
    }
  }

  // 진단 필드(share.received): 확장이 받은 형식·결과·본문 길이. 확장에서는 UIApplication 을 쓸 수 없어 locked·bg 는 넣지 않는다
  // parts 는 조각별 "출처:길이[:truncated]", utis_aN 은 N번째 첨부가 등록한 형식(ShareText.Collected). 본문은 넣지 않는다
  private static func trace(_ type: String, _ result: String, _ started: Date, _ extra: [String: Any] = [:]) {
    Trace.log("share.received", ["source": "SHARE", "type": type, "result": result,
                                 "elapsed_ms": Int(Date().timeIntervalSince(started) * 1000)].merging(extra) { a, _ in a })
  }

  private static func ms(since d: Date) -> Int { Int(Date().timeIntervalSince(d) * 1000) }

  private func showStatus(_ text: String) -> LinkStatusView {
    let status = LinkStatusView(frame: view.bounds)
    status.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    view.addSubview(status)
    status.show(text)
    return status
  }

  /// 링크 읽기(스펙 §6·D8): 상태 화면 → LinkFlow.share(관문 → 대기 행 → 10초, OCR 없음) → 결과 문구(+ 저장 범위 한 줄) → 1.5초 뒤 또는 [닫기].
  /// 읽는 중 [닫기]는 결과를 기다리지 않고 취소 → 대기 행을 앱에 넘김 → 바로 닫는다. 확정 실패면 원래 공유 글을 텍스트 항목으로(D8).
  /// 로그·trace 에 주소·제목 없음
  private func readLink(_ url: URL, note: String?, original: ShareText.Composed, _ collected: ShareText.Collected, _ started: Date) async {
    let status = showStatus(LinkCaptureText.reading)
    for _ in 0..<40 where view.window == nil { try? await Task.sleep(for: .milliseconds(50)) }   // viewDidLoad 때는 창이 없다 — 최대 2초(없으면 no_host → 앱)
    let begun = Date(), link = PendingLink(url: url, note: note, origin: "share")
    let renderer = LinkRenderer(host: view, allowLoopback: Self.allowLoopback)
    let work = Task { @MainActor () -> LinkFlow.Outcome in
      guard let q = try? CaptureQueue.shared() else { return .failed("queue_admit") }   // 대기 행 없음 — 앱이 이어받지 않는다(L5 메인 판정 1)
      return await LinkFlow.share(link, renderer: renderer, queue: q)
    }
    status.onClose = { work.cancel() }
    guard let o = await status.race(work) else {
      try? CaptureQueue.shared().releaseLink(id: link.id)                        // 행이 없으면(중복·폐기·이미 끝남) 아무 일도 없다
      Trace.log("share.link", LinkFlow.traceFields(.handedOff("cancelled"), origin: "share", elapsedMs: Self.ms(since: begun),
                                                   blockedNav: renderer.blockedNavigations))
      DiagLog.append("ShareExtension link handed_off:cancelled")
      return
    }
    Trace.log("share.link", LinkFlow.traceFields(o, origin: "share", elapsedMs: Self.ms(since: begun), blockedNav: renderer.blockedNavigations))
    DiagLog.append("ShareExtension link \(LinkFlow.code(o))")
    var text = LinkCaptureText.share(o), saved = false
    if case .queued = o { saved = true }
    // 확정 실패만 폴백(LinkFlow.fallsBackToText) — failed("queue") 는 대기 행이 남아 앱이 이어받으므로 폴백하면 항목이 두 개다(메인 판정).
    // failed("queue_admit")는 행이 없어 폴백한다(L5 메인 판정 1)
    if case .failed(let code) = o, LinkFlow.fallsBackToText(o), handleText(original, collected, started) == "queued" { text = LinkCaptureText.shareFallback(code) }
    status.show(text, note: saved ? LinkCaptureText.storageNote : nil, done: true)
    await status.waitClose(seconds: 1.5)
  }

  /// 사진 읽기(스펙 §6 "사진 OCR", D13): 상태 화면 → 앞의 3장을 한 장씩 메모리로 OCR(파일 저장 없음) → ImageFlow → 결과 문구.
  /// 함께 온 글은 메모(200자) — 더 길면 그 글은 따로 텍스트 항목으로 넣는다(잘리지 않게). 읽는 중 [닫기]면 아무것도 저장하지 않고 바로 닫는다
  private func readImages(_ items: [NSExtensionItem], text: ShareText.Composed?, _ collected: ShareText.Collected, _ started: Date) async {
    let status = showStatus(LinkCaptureText.imageReading)
    let note: String?
    if let t = text, t.text.count > LinkText.noteMaxChars { handleText(t, collected, started); note = nil } else { note = text?.text }
    let begun = Date()
    let work = Task { @MainActor () -> (outcome: ImageFlow.Outcome, images: Int) in
      let r = await ShareImages.ocr(items)
      if Task.isCancelled { return (.failed("cancelled"), r.images) }
      guard let q = try? CaptureQueue.shared() else { return (.failed("queue"), r.images) }
      return (ImageFlow.finish(ocr: r.texts, images: r.images, note: note, queue: q), r.images)
    }
    status.onClose = { work.cancel() }
    guard let r = await status.race(work) else {
      Trace.log("share.image", ImageFlow.traceFields(.failed("cancelled"), origin: "share", elapsedMs: Self.ms(since: begun), images: 0))
      DiagLog.append("ShareExtension image failed:cancelled")
      return
    }
    Trace.log("share.image", ImageFlow.traceFields(r.outcome, origin: "share", elapsedMs: Self.ms(since: begun), images: r.images))
    DiagLog.append("ShareExtension image \(ImageFlow.code(r.outcome))")
    var saved = false
    if case .queued = r.outcome { saved = true }
    status.show(LinkCaptureText.image(r.outcome, chat: false), note: saved ? LinkCaptureText.storageNote : nil, done: true)
    await status.waitClose(seconds: 1.5)
  }
}
