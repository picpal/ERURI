import Foundation
import AssistantCore

final class Uploader: NSObject, URLSessionDelegate, URLSessionTaskDelegate, @unchecked Sendable {
  static let shared = Uploader()
  static let base = URL(string: ProcessInfo.processInfo.environment["INGEST_URL"] ?? "http://localhost:8787")!

  lazy var session: URLSession = {
    let c = URLSessionConfiguration.background(withIdentifier: "com.picpal.assistant.poc.upload")
    c.sharedContainerIdentifier = AppGroup.id
    return URLSession(configuration: c, delegate: self, delegateQueue: nil)
  }()

  func flush() {
    guard let q = try? CaptureQueue.shared(), let items = try? q.pending(limit: 20) else { return }
    for it in items {
      if let rel = it.localFile, let container = try? AppGroup.containerURL() {
        var r = URLRequest(url: Self.base.appendingPathComponent("upload/\(it.id)")); r.httpMethod = "PUT"
        let t = session.uploadTask(with: r, fromFile: container.appendingPathComponent(rel)); t.taskDescription = it.id; t.resume()
      } else {
        var r = URLRequest(url: Self.base.appendingPathComponent("ingest")); r.httpMethod = "POST"
        r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        guard let body = try? JSONEncoder().encode(it) else { continue }
        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent(it.id + ".json")
        try? body.write(to: tmp)
        let t = session.uploadTask(with: r, fromFile: tmp); t.taskDescription = it.id; t.resume()
      }
    }
  }

  func urlSession(_ s: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    guard let id = task.taskDescription, let q = try? CaptureQueue.shared() else { return }
    if error == nil, (task.response as? HTTPURLResponse).map({ (200..<300).contains($0.statusCode) }) == true {
      try? q.markSent(id: id); PoCLog.append("upload ok \(id)")
    } else {
      try? q.markFailed(id: id); PoCLog.append("upload fail \(id) \(String(describing: error))")
    }
  }
}
