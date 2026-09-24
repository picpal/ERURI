import UIKit
import UniformTypeIdentifiers
import AssistantCore

final class ShareViewController: UIViewController {
  override func viewDidLoad() {
    super.viewDidLoad()
    Task { await handle(); extensionContext?.completeRequest(returningItems: nil) }
  }

  private func handle() async {
    guard let items = extensionContext?.inputItems as? [NSExtensionItem] else { return }
    for item in items {
      for p in item.attachments ?? [] {
        if p.hasItemConformingToTypeIdentifier(UTType.image.identifier) || p.hasItemConformingToTypeIdentifier(UTType.pdf.identifier) {
          let type = p.hasItemConformingToTypeIdentifier(UTType.pdf.identifier) ? UTType.pdf : UTType.image
          guard let src = try? await p.loadFileURL(type) else { continue }
          let id = UUID().uuidString
          guard let dir = try? AppGroup.containerURL().appendingPathComponent("inbox", isDirectory: true) else { continue }
          try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
          let dst = dir.appendingPathComponent(id + "." + (type == .pdf ? "pdf" : "jpg"))
          try? FileManager.default.copyItem(at: src, to: dst)            // 1. 먼저 영속화
          let ocr = type == .image ? (try? await OCR.recognize(imageURL: dst)) ?? "" : ""
          try? CaptureQueue.shared().enqueue(CaptureItem(id: id, source: "SHARE", appName: nil, sender: nil, title: nil,
            text: "", localFile: "inbox/" + dst.lastPathComponent, ocrText: ocr, capturedAt: Date(), attempts: 0))
          PoCLog.append("ShareExtension file id=\(id) type=\(type == .pdf ? "pdf" : "image") ocrLen=\(ocr.count)")
        } else if p.hasItemConformingToTypeIdentifier(UTType.url.identifier),
                  let url = try? await p.loadItem(forTypeIdentifier: UTType.url.identifier) as? URL {
          try? CaptureQueue.shared().enqueue(CaptureItem(id: UUID().uuidString, source: "SHARE", appName: nil, sender: nil, title: nil,
            text: url.absoluteString, localFile: nil, ocrText: nil, capturedAt: Date(), attempts: 0))
        } else if p.hasItemConformingToTypeIdentifier(UTType.plainText.identifier),
                  let s = try? await p.loadItem(forTypeIdentifier: UTType.plainText.identifier) as? String {
          try? CaptureQueue.shared().enqueue(CaptureItem(id: UUID().uuidString, source: "SHARE", appName: nil, sender: nil, title: nil,
            text: s, localFile: nil, ocrText: nil, capturedAt: Date(), attempts: 0))
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
