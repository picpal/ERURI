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
  /// 공유 한 번의 모든 텍스트 표현(attributedContentText·첨부 plain-text·URL)을 모아 `ShareText.compose` 로 큐 항목 하나로 만든다.
  /// 첨부 하나만 읽으면 호스트가 넘긴 제목·일부만 들어온다(실기기 0.3.0 메모 앱 10자, 2026-09-30).
  private func handle() async {
    guard let items = extensionContext?.inputItems as? [NSExtensionItem] else { return }
    let started = Date()
    // 진단 필드(share.received): 확장이 받은 형식·결과·본문 길이. 확장에서는 UIApplication 을 쓸 수 없어 locked·bg 는 넣지 않는다
    // parts 는 조각별 "출처:길이"(act = attributedContentText, aN = N번째 첨부, u = URL), utis 는 첨부가 등록한 형식. 본문은 넣지 않는다
    func trace(_ type: String, _ result: String, _ extra: [String: Any] = [:]) {
      Trace.log("share.received", ["source": "SHARE", "type": type, "result": result,
                                        "elapsed_ms": Int(Date().timeIntervalSince(started) * 1000)].merging(extra) { a, _ in a })
    }
    var pieces: [String] = [], parts: [String] = [], utis: Set<String> = [], hasText = false
    func add(_ s: String?, _ tag: String) {
      guard let s else { parts.append("\(tag):nil"); return }
      pieces.append(s); parts.append("\(tag):\(s.count)")
    }
    var n = 0
    for item in items {
      if let a = item.attributedContentText, !a.string.isEmpty { add(a.string, "act"); hasText = true }
      for p in item.attachments ?? [] {
        defer { n += 1 }
        utis.formUnion(p.registeredTypeIdentifiers)
        do {
          if p.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
            add(ShareText.string(fromLoaded: try await p.loadItem(forTypeIdentifier: UTType.plainText.identifier)), "a\(n)")
            hasText = true
          }
          if p.hasItemConformingToTypeIdentifier(UTType.url.identifier),
             let url = try await p.loadItem(forTypeIdentifier: UTType.url.identifier) as? URL {
            add(url.absoluteString, "u\(n)")
          }
        } catch {
          DiagLog.append("ShareExtension error \(type(of: error))")
          parts.append("a\(n):error:\(type(of: error))")
        }
      }
    }
    let diag: [String: Any] = ["parts": parts.joined(separator: ","), "utis": utis.sorted().joined(separator: ",")]
    guard let text = ShareText.compose(pieces) else { trace("-", "empty", diag); return }
    let kind = hasText ? "text" : "url"
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
