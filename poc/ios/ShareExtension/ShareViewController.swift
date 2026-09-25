import UIKit
import UniformTypeIdentifiers
import AssistantCore

final class ShareViewController: UIViewController {
  override func viewDidLoad() {
    super.viewDidLoad()
    Task { await handle(); extensionContext?.completeRequest(returningItems: nil) }
  }

  /// 스펙 §6: 규칙 필터(1단계)만 적용해 큐에 넣는다. 폐기(OTP)면 큐에도, App Group 에도 남기지 않는다.
  /// 이미지는 확장 임시 복사본에서 OCR 을 먼저 돌리고, 통과할 때만 App Group `inbox/` 로 영속화한다.
  private func handle() async {
    guard let items = extensionContext?.inputItems as? [NSExtensionItem] else { return }
    let pipeline: CapturePipeline
    do { pipeline = CapturePipeline(filter: RuleFilter(), queue: try CaptureQueue.shared()) } catch {
      PoCLog.append("ShareExtension error \(type(of: error))"); return
    }
    for item in items {
      for p in item.attachments ?? [] {
        do {
          if p.hasItemConformingToTypeIdentifier(UTType.image.identifier) || p.hasItemConformingToTypeIdentifier(UTType.pdf.identifier) {
            let isPDF = p.hasItemConformingToTypeIdentifier(UTType.pdf.identifier)
            let tmp = try await p.loadFileURL(isPDF ? .pdf : .image)
            defer { try? FileManager.default.removeItem(at: tmp) }
            let ocr = isPDF ? "" : (try? await OCR.recognize(imageURL: tmp)) ?? ""
            var savedId = "-"
            let result = try pipeline.handleShareFile(ocrText: ocr) { id in
              savedId = id
              return try ShareInbox.persist(tmp, id: id, ext: isPDF ? "pdf" : "jpg")
            }
            PoCLog.append("ShareExtension file \(result) id=\(savedId) type=\(isPDF ? "pdf" : "image") ocrLen=\(ocr.count)")
          } else if p.hasItemConformingToTypeIdentifier(UTType.url.identifier),
                    let url = try await p.loadItem(forTypeIdentifier: UTType.url.identifier) as? URL {
            PoCLog.append("ShareExtension url \(try pipeline.handleShare(text: url.absoluteString))")
          } else if p.hasItemConformingToTypeIdentifier(UTType.plainText.identifier),
                    let s = try await p.loadItem(forTypeIdentifier: UTType.plainText.identifier) as? String {
            PoCLog.append("ShareExtension text \(try pipeline.handleShare(text: s))")
          }
        } catch {
          PoCLog.append("ShareExtension error \(type(of: error))")
        }
      }
    }
  }
}

extension NSItemProvider {
  @MainActor
  func loadFileURL(_ type: UTType) async throws -> URL {
    try await withCheckedThrowingContinuation { c in
      loadFileRepresentation(forTypeIdentifier: type.identifier) { url, err in
        if let url {
          let tmp = FileManager.default.temporaryDirectory.appendingPathComponent(url.lastPathComponent)
          try? FileManager.default.removeItem(at: tmp)
          try? FileManager.default.copyItem(at: url, to: tmp)
          c.resume(returning: tmp)
        } else {
          c.resume(throwing: err ?? CocoaError(.fileNoSuchFile))
        }
      }
    }
  }
}
