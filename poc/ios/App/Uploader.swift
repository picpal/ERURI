import Foundation
import os
import EruriCore

/// 가변 상태가 없어 컴파일러 검사로 Sendable 이다(`@unchecked` 불필요). 세션 delegate 는 별도 객체로 분리했다.
/// 0.2.0(PoC-9): flush 는 먼저 프로세스 안에서 직접 요청(짧은 타임아웃)을 보내고, 네트워크 오류·타임아웃이면
/// background 세션의 파일 업로드로 넘겨 프로세스가 잠들어도 iOS(nsurlsessiond)가 끝내게 한다.
/// 백그라운드에서 시작한 background 세션 전송은 iOS 가 discretionary 로 다뤄 늦어질 수 있어, 깨어 있는 동안은 직접 요청이 주 경로다.
final class Uploader: Sendable {
  static let shared = Uploader()
  /// 앱 설정값(App Group UserDefaults). 스킴 환경변수 INGEST_URL 은 앱 시작 시 저장값이 없을 때만 초기값으로 들어간다.
  static var base: URL { IngestSettings.url() }
  static let sessionID = "com.picpal.assistant.poc.upload"

  let session: URLSession
  /// 인텐트·무음 푸시·BG refresh 는 약 30초 안에 끝나야 해서 직접 요청은 짧게 끊고 background 세션에 넘긴다
  private let direct: URLSession
  private init() {
    let c = URLSessionConfiguration.background(withIdentifier: Self.sessionID)
    c.sharedContainerIdentifier = AppGroup.id
    c.sessionSendsLaunchEvents = true
    c.isDiscretionary = false
    session = URLSession(configuration: c, delegate: UploadDelegate(), delegateQueue: nil)
    let e = URLSessionConfiguration.ephemeral
    e.timeoutIntervalForRequest = 8; e.timeoutIntervalForResource = 10; e.waitsForConnectivity = false
    direct = URLSession(configuration: e)
  }

  /// 버튼·설정 변경 등 앱이 떠 있을 때의 호출
  func flush() { Task { await flush(trigger: .foreground) } }

  struct FlushResult: Sendable { var claimed = 0, direct = 0, handedOff = 0, failed = 0 }

  /// claim 이 lease 를 걸어 가져가므로 연속 flush 나 다른 프로세스가 같은 항목을 두 번 올리지 않는다.
  /// 완료·실패가 markSent/markFailed 로 lease 를 덮어쓴다. 서버는 `source:id` 로 중복을 걸러 200 + 기존 id 를 준다.
  /// 업로드 서버가 Supabase(Release 기본값)면 `ingest` 가 사용자 JWT·apikey 를 요구한다. 로컬 mock 은 헤더 없이 받는다.
  /// `locked`: 인텐트 시작 시점 값(PoC-9 판정용). 끝에 trace 도 올린다.
  @discardableResult
  func flush(trigger: UploadTrigger, locked: Bool? = nil) async -> FlushResult {
    let r = await flushCaptures(trigger: trigger, locked: locked)
    await TraceUploader.shared.flush()   // 이번 실행의 intent_fired·upload_done trace 도 같이 올린다
    return r
  }

  private func flushCaptures(trigger: UploadTrigger, locked: Bool?) async -> FlushResult {
    let base = Self.base
    var h: [String: String] = [:]
    if let cfg = SupabaseSession.config, base.host() == cfg.url.host() {
      guard let token = await SupabaseSession.shared.accessToken() else { Self.warnNoSession(); return FlushResult() }
      h = ["Authorization": "Bearer \(token)", "apikey": cfg.anonKey]
    }
    guard let q = try? CaptureQueue.shared(), let items = try? q.claim(limit: 20), !items.isEmpty,
          let container = try? AppGroup.containerURL() else { return FlushResult() }
    PoCLog.append("flush \(trigger.rawValue) claimed \(items.count) to=\(base.host() ?? "-"):\(base.port ?? 0)")
    var r = FlushResult(); r.claimed = items.count
    let headers = h
    await withTaskGroup(of: Outcome.self) { g in
      for it in items {
        g.addTask { await self.send(it, base: base, headers: headers, container: container, trigger: trigger, locked: locked) }
      }
      for await o in g {
        switch o { case .direct: r.direct += 1; case .handedOff: r.handedOff += 1; case .failed: r.failed += 1 }
      }
    }
    PoCLog.append("flush \(trigger.rawValue) direct=\(r.direct) handoff=\(r.handedOff) failed=\(r.failed)")
    return r
  }

  private enum Outcome: Sendable { case direct, handedOff, failed }

  private func send(_ it: CaptureItem, base: URL, headers: [String: String], container: URL,
                    trigger: UploadTrigger, locked: Bool?) async -> Outcome {
    var req: URLRequest, file: URL, kind: String
    if let rel = it.localFile {
      req = URLRequest(url: base.appendingPathComponent("upload/\(it.id)")); req.httpMethod = "PUT"
      file = container.appendingPathComponent(rel); kind = "file"
    } else {
      req = URLRequest(url: base.appendingPathComponent("ingest")); req.httpMethod = "POST"
      req.setValue("application/json", forHTTPHeaderField: "Content-Type")
      guard let f = try? Outbox.writeJSON(it, container: container) else {
        try? CaptureQueue.shared().markFailed(id: it.id); return .failed
      }
      file = f; kind = "json"
    }
    headers.forEach { req.setValue($1, forHTTPHeaderField: $0) }
    let tag = UploadTag(id: it.id, trigger: trigger, capturedAt: it.capturedAt, locked: locked)
    do {
      let (_, resp) = try await direct.upload(for: req, fromFile: file)
      let status = (resp as? HTTPURLResponse)?.statusCode ?? -1
      let ok = (200..<300).contains(status)
      if status == 401 { await SupabaseSession.shared.invalidate() }
      await UploadDelegate.finish(tag: tag, ok: ok, status: status, kind: kind, bytes: Self.size(file), errorCode: 0, viaBackgroundSession: false)
      return ok ? .direct : .failed
    } catch {
      // 응답을 못 받았다(타임아웃·오프라인·프로세스 정지 직전). background 세션에 넘긴다. 서버가 이미 받았어도 중복은 200 으로 끝난다
      let e = error as NSError
      PoCLog.append("direct fail \(it.id) code=\(e.code) → bg session")
      let t = session.uploadTask(with: req, fromFile: file); t.taskDescription = tag.encoded; t.resume()
      return .handedOff
    }
  }

  private static func size(_ f: URL) -> Int64 {
    ((try? FileManager.default.attributesOfItem(atPath: f.path))?[.size] as? NSNumber)?.int64Value ?? -1
  }

  private static let warned = OSAllocatedUnfairLock(initialState: false)
  private static func warnNoSession() {
    guard !warned.withLock({ let w = $0; $0 = true; return w }) else { return }
    PoCLog.append("flush skipped: no session (설정 화면 PoC 계정 로그인 필요)")
  }
}

/// PoC 추적 이벤트를 `POST /functions/v1/ingest/trace` 로 최대 200건씩 올린다(계약: poc-traces.md).
/// 0.2.1: 캡처와 같이 직접 요청 우선 — 2xx 면 바로 지우고, 응답이 없을 때만 background 세션에 넘긴다.
/// 넘긴 배치가 아직 끝나지 않았으면 그 id 의 lease 를 늘려 다시 가져가지 않는다(09-29 중복 업로드 결함). 서버도 같은 행을 무시한다(0015)
actor TraceUploader {
  static let shared = TraceUploader()
  static let batch = 200
  private var warnedNoSession = false
  /// 같은 프로세스에서 인텐트·scenePhase·무음 푸시 flush 가 겹쳐도 한 번만 돈다
  private var inFlight = false
  private let direct: URLSession = {
    let e = URLSessionConfiguration.ephemeral
    e.timeoutIntervalForRequest = 8; e.timeoutIntervalForResource = 10; e.waitsForConnectivity = false
    return URLSession(configuration: e)
  }()

  func flush() async {
    guard !inFlight else { return }
    inFlight = true
    defer { inFlight = false }
    guard let q = try? CaptureQueue.shared(), ((try? q.traceCount()) ?? 0) > 0, let cfg = SupabaseSession.config else { return }
    guard let token = await SupabaseSession.shared.accessToken() else {
      if !warnedNoSession { warnedNoSession = true; PoCLog.append("trace flush skipped: no session") }
      return
    }
    let pending = TraceFlushGate.pendingIDs(taskDescriptions: await Uploader.shared.session.allTasks.map(\.taskDescription))
    if !pending.isEmpty { try? q.extendLease(ids: Array(pending), until: Date().addingTimeInterval(CaptureQueue.lease)) }
    guard let items = try? q.claimTraces(limit: Self.batch), !items.isEmpty else { return }
    let ids = items.map(\.id)
    var r = URLRequest(url: cfg.url.appendingPathComponent("functions/v1/ingest/trace")); r.httpMethod = "POST"
    r.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    r.setValue(cfg.anonKey, forHTTPHeaderField: "apikey")
    r.setValue("application/json", forHTTPHeaderField: "Content-Type")
    let body = Trace.batchBody(items.map(\.payload))
    var status: Int?
    do {
      let (_, resp) = try await direct.upload(for: r, from: body)
      status = (resp as? HTTPURLResponse)?.statusCode ?? -1
    } catch {
      status = nil
    }
    switch TraceBatchOutcome.resolve(status: status) {
    case .sent:
      try? q.markSent(ids: ids)
      PoCLog.append("trace upload ok n=\(ids.count) status=\(status ?? -1) via=direct")
    case .retry:
      if status == 401 { await SupabaseSession.shared.invalidate() }
      try? q.markFailed(ids: ids)
      PoCLog.append("trace upload fail n=\(ids.count) status=\(status ?? -1) via=direct")
    case .handOff:
      let tmp = FileManager.default.temporaryDirectory.appendingPathComponent("trace-\(UUID().uuidString).json")
      do { try body.write(to: tmp) } catch { try? q.markFailed(ids: ids); return }
      let t = Uploader.shared.session.uploadTask(with: r, fromFile: tmp)
      t.taskDescription = TraceFlushGate.taskDescription(ids: ids)
      t.resume()
      PoCLog.append("trace handoff n=\(ids.count)")
    }
  }
}

final class UploadDelegate: NSObject, URLSessionTaskDelegate, Sendable {
  static let tracePrefix = TraceFlushGate.prefix

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
    // 0.1.x 가 남긴 태스크는 설명이 항목 id 뿐이다: 트리거를 모르므로 foreground 로 본다
    let tag = UploadTag.decode(desc) ?? UploadTag(id: desc, trigger: .foreground, capturedAt: Date(), locked: nil)
    let kind = task.originalRequest?.httpMethod == "PUT" ? "file" : "json"
    let bytes = task.countOfBytesSent, code = (error as NSError?)?.code ?? 0
    Task {
      await Self.finish(tag: tag, ok: ok, status: status, kind: kind, bytes: bytes, errorCode: code, viaBackgroundSession: true)
      await TraceUploader.shared.flush()
    }
  }

  /// 앱이 background 세션 이벤트로 깨어난 경우, 모든 완료 콜백이 끝났을 때 iOS 에 알린다
  func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
    Task { @MainActor in BackgroundSessionEvents.complete() }
  }

  /// 직접 요청·background 세션 공통 완료 처리: 큐 행 삭제(또는 재시도 예약), outbox 파일 삭제, PoC-9 trace.
  /// 원문은 남기지 않는다 — 항목 id·전송 바이트·지연만.
  static func finish(tag: UploadTag, ok: Bool, status: Int, kind: String, bytes: Int64, errorCode: Int, viaBackgroundSession: Bool) async {
    let q = try? CaptureQueue.shared()
    if ok { try? q?.markSent(id: tag.id) } else { try? q?.markFailed(id: tag.id) }
    if ok || !viaBackgroundSession, let c = try? AppGroup.containerURL() { Outbox.remove(id: tag.id, container: c) }
    let path = UploadPath.resolve(trigger: tag.trigger, viaBackgroundSession: viaBackgroundSession)
    let ageMs = Int(Date().timeIntervalSince(tag.capturedAt) * 1000)
    PoCLog.append("upload \(ok ? "ok" : "fail") \(tag.id) path=\(path.rawValue) status=\(status) age=\(ageMs)ms err=\(errorCode)")
    var f: [String: Any] = ["ok": ok, "status": status, "kind": kind, "item_id": tag.id, "bytes": bytes,
                            "path": path.rawValue, "trigger": tag.trigger.rawValue, "via": viaBackgroundSession ? "bg_session" : "direct",
                            "age_ms": ageMs, "error_code": errorCode]
    f["intent_locked"] = tag.locked.map { $0 as Any } ?? NSNull()   // nil = 인텐트 시작 시 판정 실패(unknown) 또는 0.1.x 태스크
    // PoC-9: 완료 시점의 잠금·백그라운드 상태
    let st = await AppState.snapshot()
    f.merge(st.traceFields) { _, new in new }
    Trace.log("poc9.upload_done", f)
  }
}

/// `application(_:handleEventsForBackgroundURLSession:)` 이 넘긴 완료 핸들러. 세션의 모든 이벤트가 전달된 뒤 호출한다.
@MainActor enum BackgroundSessionEvents {
  private static var handler: (() -> Void)?
  static func store(_ h: @escaping () -> Void) { handler = h }
  static func complete() { let h = handler; handler = nil; h?() }
}
