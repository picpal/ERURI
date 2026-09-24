import Foundation
public struct CapturePipeline {
  public let filter: RuleFilter
  public let queue: CaptureQueue
  public init(filter: RuleFilter, queue: CaptureQueue) { self.filter = filter; self.queue = queue }
  /// 반환: "queued" 또는 "discarded:<reason>"
  public func handle(source: String, appName: String?, title: String?, sender: String?, text: String) throws -> String {
    switch filter.apply(text: text, sender: sender) {
    case .discard(let r): return "discarded:\(r)"
    case .pass(let masked):
      try queue.enqueue(CaptureItem(id: UUID().uuidString, source: source, appName: appName, sender: sender, title: title,
                                    text: masked, localFile: nil, ocrText: nil, capturedAt: Date(), attempts: 0))
      return "queued"
    }
  }

  public func filterOnly(text: String, sender: String?) -> RuleVerdict { filter.apply(text: text, sender: sender) }
  public func enqueue(source: String, appName: String?, title: String?, sender: String?, masked: String) throws {
    try queue.enqueue(CaptureItem(id: UUID().uuidString, source: source, appName: appName, sender: sender, title: title,
                                  text: masked, localFile: nil, ocrText: nil, capturedAt: Date(), attempts: 0))
  }
}
