import UIKit
import UniformTypeIdentifiers
import EruriCore

final class ShareViewController: UIViewController {
  override func viewDidLoad() {
    super.viewDidLoad()
    Task { await handle(); extensionContext?.completeRequest(returningItems: nil) }
  }

  /// 스펙 §6: 규칙 단계만 적용해 큐에 넣는다. 폐기(OTP)면 큐에도, App Group 에도 남기지 않는다.
  /// 1단계는 텍스트·URL 만 받는다(스펙 §15 1a). 이미지·PDF 는 서버 파일 업로드가 생기는 2단계에서 다시 붙인다.
  private func handle() async {
    guard let items = extensionContext?.inputItems as? [NSExtensionItem] else { return }
    let pipeline: CapturePipeline
    do { pipeline = CapturePipeline(filter: RuleFilter(), queue: try CaptureQueue.shared()) } catch {
      DiagLog.append("ShareExtension error \(type(of: error))"); return
    }
    for item in items {
      for p in item.attachments ?? [] {
        let started = Date()
        // 진단 필드(share.received): 확장이 받은 형식·결과·본문 길이. 확장에서는 UIApplication 을 쓸 수 없어 locked·bg 는 넣지 않는다
        func trace(_ type: String, _ result: String, _ extra: [String: Any] = [:]) {
          Trace.log("share.received", ["source": "SHARE", "type": type, "result": result,
                                            "elapsed_ms": Int(Date().timeIntervalSince(started) * 1000)].merging(extra) { a, _ in a })
        }
        do {
          if p.hasItemConformingToTypeIdentifier(UTType.url.identifier),
             let url = try await p.loadItem(forTypeIdentifier: UTType.url.identifier) as? URL {
            let result = try pipeline.handleShare(text: url.absoluteString)
            DiagLog.append("ShareExtension url \(result)")
            trace("url", result, ["text_len": url.absoluteString.count])
          } else if p.hasItemConformingToTypeIdentifier(UTType.plainText.identifier),
                    let s = try await p.loadItem(forTypeIdentifier: UTType.plainText.identifier) as? String {
            let result = try pipeline.handleShare(text: s)
            DiagLog.append("ShareExtension text \(result)")
            trace("text", result, ["text_len": s.count, "text_sha8": Trace.sha8(s)])
          }
        } catch {
          DiagLog.append("ShareExtension error \(type(of: error))")
          trace("-", "error:\(type(of: error))")
        }
      }
    }
  }
}
