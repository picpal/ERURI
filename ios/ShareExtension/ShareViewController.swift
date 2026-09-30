import UIKit
import EruriCore

final class ShareViewController: UIViewController {
  override func viewDidLoad() {
    super.viewDidLoad()
    Task { await handle(); extensionContext?.completeRequest(returningItems: nil) }
  }

  /// 스펙 §6: 규칙 단계만 적용해 큐에 넣는다. 폐기(OTP)면 큐에도, App Group 에도 남기지 않는다.
  /// 1단계는 텍스트·URL 만 받는다(스펙 §15 1a). 이미지·PDF 는 서버 파일 업로드가 생기는 2단계에서 다시 붙인다.
  /// 공유 한 번의 모든 텍스트 표현(attributedContentText·첨부 plain-text·URL)을 모아 `ShareText.compose` 로 큐 항목 하나로 만든다.
  /// 첨부 하나만 읽으면 호스트가 넘긴 제목·일부만 들어온다(실기기 0.3.0 메모 앱 10자, 2026-09-30). 표현마다 64KiB, 본문 64K자 상한.
  private func handle() async {
    guard let items = extensionContext?.inputItems as? [NSExtensionItem] else { return }
    let started = Date()
    // 진단 필드(share.received): 확장이 받은 형식·결과·본문 길이. 확장에서는 UIApplication 을 쓸 수 없어 locked·bg 는 넣지 않는다
    // parts 는 조각별 "출처:길이[:truncated]", utis_aN 은 N번째 첨부가 등록한 형식(ShareText.Collected). 본문은 넣지 않는다
    func trace(_ type: String, _ result: String, _ extra: [String: Any] = [:]) {
      Trace.log("share.received", ["source": "SHARE", "type": type, "result": result,
                                        "elapsed_ms": Int(Date().timeIntervalSince(started) * 1000)].merging(extra) { a, _ in a })
    }
    let collected = await ShareText.collect(items)
    guard let out = ShareText.compose(collected.pieces) else { trace("-", "empty", collected.fields(truncatedOutput: false)); return }
    let text = out.text, diag = collected.fields(truncatedOutput: out.truncated)
    let kind = ShareText.isWebURL(text) ? "url" : "text"
    do {
      let pipeline = CapturePipeline(filter: RuleFilter(), queue: try CaptureQueue.shared())
      let result = try pipeline.handleShare(text: text)
      DiagLog.append("ShareExtension \(kind) \(result)")
      trace(kind, result, diag.merging(["text_len": text.count, "text_sha8": Trace.sha8(text)]) { a, _ in a })
    } catch {
      DiagLog.append("ShareExtension error \(type(of: error))")
      trace(kind, "error:\(type(of: error))", diag)
    }
  }
}
