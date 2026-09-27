import Foundation
import EruriCore

/// 가변 상태가 없어 컴파일러 검사로 Sendable 이다(`@unchecked` 불필요). 세션 delegate 는 별도 객체로 분리했다.
final class Uploader: Sendable {
  static let shared = Uploader()
  /// 앱 설정값(App Group UserDefaults). 스킴 환경변수 INGEST_URL 은 앱 시작 시 저장값이 없을 때만 초기값으로 들어간다.
  static var base: URL { IngestSettings.url() }

  let session: URLSession
  private init() {
    let c = URLSessionConfiguration.background(withIdentifier: "com.picpal.assistant.poc.upload")
    c.sharedContainerIdentifier = AppGroup.id
    session = URLSession(configuration: c, delegate: UploadDelegate(), delegateQueue: nil)
  }

  /// claim 이 lease 를 걸어 가져가므로 init·scenePhase 의 연속 flush 나 다른 프로세스가 같은 항목을 두 번 올리지 않는다.
  /// lease 만료 전 완료·실패 콜백이 markSent/markFailed 로 상태를 덮어쓴다.
  func flush() {
    Task { await TraceUploader.shared.flush() }
    guard let q = try? CaptureQueue.shared(), let items = try? q.claim(limit: 20) else { return }
    let base = Self.base
    if !items.isEmpty { PoCLog.append("flush claimed \(items.count) to=\(base.host() ?? "-"):\(base.port ?? 0)") }
    for it in items {
      if let rel = it.localFile, let container = try? AppGroup.containerURL() {
        var r = URLRequest(url: base.appendingPathComponent("upload/\(it.id)")); r.httpMethod = "PUT"
        let t = session.uploadTask(with: r, fromFile: container.appendingPathComponent(rel)); t.taskDescription = it.id; t.resume()
      } else {
        var r = URLRequest(url: base.appendingPathComponent("ingest")); r.httpMethod = "POST"
        r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        guard let body = try? JSONEncoder().encode(it) else { continue }
        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent(it.id + ".json")
        try? body.write(to: tmp)
        let t = session.uploadTask(with: r, fromFile: tmp); t.taskDescription = it.id; t.resume()
      }
    }
  }
}

/// PoC 추적 이벤트를 `POST /functions/v1/ingest/trace` 로 최대 200건씩 올린다(계약: poc-traces.md).
/// 캡처와 같은 background 세션·lease·지수 재시도를 쓴다. 세션(JWT)이 없으면 큐에 둔 채 건너뛴다.
actor TraceUploader {
  static let shared = TraceUploader()
  static let batch = 200
  private var warnedNoSession = false

  func flush() async {
    guard let q = try? CaptureQueue.shared(), ((try? q.traceCount()) ?? 0) > 0, let cfg = SupabaseSession.config else { return }
    guard let token = await SupabaseSession.shared.accessToken() else {
      if !warnedNoSession { warnedNoSession = true; PoCLog.append("trace flush skipped: no session") }
      return
    }
    guard let items = try? q.claimTraces(limit: Self.batch), !items.isEmpty else { return }
    var r = URLRequest(url: cfg.url.appendingPathComponent("functions/v1/ingest/trace")); r.httpMethod = "POST"
    r.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    r.setValue(cfg.anonKey, forHTTPHeaderField: "apikey")
    r.setValue("application/json", forHTTPHeaderField: "Content-Type")
    let tmp = FileManager.default.temporaryDirectory.appendingPathComponent("trace-\(UUID().uuidString).json")
    do { try Trace.batchBody(items.map(\.payload)).write(to: tmp) } catch { try? q.markFailed(ids: items.map(\.id)); return }
    let t = Uploader.shared.session.uploadTask(with: r, fromFile: tmp)
    t.taskDescription = UploadDelegate.tracePrefix + items.map(\.id).joined(separator: ",")
    t.resume()
    PoCLog.append("trace flush \(items.count)")
  }
}

final class UploadDelegate: NSObject, URLSessionTaskDelegate, Sendable {
  static let tracePrefix = "trace:"

  func urlSession(_ s: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    guard let desc = task.taskDescription, let q = try? CaptureQueue.shared() else { return }
    let status = (task.response as? HTTPURLResponse)?.statusCode ?? -1
    let ok = error == nil && (200..<300).contains(status)
    if desc.hasPrefix(Self.tracePrefix) {
      let ids = desc.dropFirst(Self.tracePrefix.count).split(separator: ",").map(String.init)
      if ok { try? q.markSent(ids: ids) } else { try? q.markFailed(ids: ids) }   // 400 이면 배치 전체가 저장되지 않는다(서버 계약)
      PoCLog.append("trace upload \(ok ? "ok" : "fail") n=\(ids.count) status=\(status)")
      return
    }
    let id = desc
    if ok {
      try? q.markSent(id: id); PoCLog.append("upload ok \(id)")
    } else {
      try? q.markFailed(id: id); PoCLog.append("upload fail \(id) \(String(describing: error))")
    }
    // PoC-9: 앱 종료 후에도 완료되는지(bg). 항목 id·전송 바이트만 남긴다
    let kind = task.originalRequest?.httpMethod == "PUT" ? "file" : "json", bytes = task.countOfBytesSent
    Task {
      let st = await AppState.snapshot()
      Trace.log("poc9.upload_done", ["ok": ok, "status": status, "kind": kind, "item_id": id, "bytes": bytes,
                                     "bg": st.bg, "locked": st.locked, "error_code": (error as NSError?)?.code ?? 0])
    }
  }
}
