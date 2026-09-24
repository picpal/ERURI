import Foundation
import AssistantCore

/// 가변 상태가 없어 컴파일러 검사로 Sendable 이다(`@unchecked` 불필요). 세션 delegate 는 별도 객체로 분리했다.
final class Uploader: Sendable {
  static let shared = Uploader()
  static let base = URL(string: ProcessInfo.processInfo.environment["INGEST_URL"] ?? "http://localhost:8787")!

  let session: URLSession
  private init() {
    let c = URLSessionConfiguration.background(withIdentifier: "com.picpal.assistant.poc.upload")
    c.sharedContainerIdentifier = AppGroup.id
    session = URLSession(configuration: c, delegate: UploadDelegate(), delegateQueue: nil)
  }

  /// claim 이 lease 를 걸어 가져가므로 init·scenePhase 의 연속 flush 나 다른 프로세스가 같은 항목을 두 번 올리지 않는다.
  /// lease 만료 전 완료·실패 콜백이 markSent/markFailed 로 상태를 덮어쓴다.
  func flush() {
    guard let q = try? CaptureQueue.shared(), let items = try? q.claim(limit: 20) else { return }
    if !items.isEmpty { PoCLog.append("flush claimed \(items.count)") }
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
}

final class UploadDelegate: NSObject, URLSessionTaskDelegate, Sendable {
  func urlSession(_ s: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    guard let id = task.taskDescription, let q = try? CaptureQueue.shared() else { return }
    if error == nil, (task.response as? HTTPURLResponse).map({ (200..<300).contains($0.statusCode) }) == true {
      try? q.markSent(id: id); PoCLog.append("upload ok \(id)")
    } else {
      try? q.markFailed(id: id); PoCLog.append("upload fail \(id) \(String(describing: error))")
    }
  }
}
