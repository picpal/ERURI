import UIKit
import SwiftUI
import PhotosUI
import EruriCore

/// 앱의 링크·사진 읽기(스펙 §6 "확장과 앱의 이어받기"·§9 "채팅 링크 붙여넣기"·"채팅 사진 첨부"). 렌더 호스트는 키 창(다른 화면 밑).
/// 백그라운드에서는 WebKit 이 멈추므로(F13) foreground 에서만 읽고, 활성 상태를 벗어나면 읽던 것을 취소해 행을 돌려놓는다(Fable C4).
/// 같은 링크는 한 번에 한 곳만 읽는다(LinkReads — 채팅 붙여넣기와 이어받기가 겹치면 채팅은 결과만 받는다, L2 교차 확인 b).
/// 로그·trace 에 주소·제목·OCR 글 없음
@MainActor final class LinkCapture {
  static let shared = LinkCapture()
  #if DEBUG
  static let allowLoopback = true            // 시뮬레이터 게이트(스펙 §6 "주소 검사")
  #else
  static let allowLoopback = false
  #endif
  private let drain = RestartableTask()
  private let reads = LinkReads()

  struct ChatRead: Sendable { let text: String; let captureID: String? }

  /// 지금 화면에 붙은 키 창(웹뷰를 그 맨 아래에 붙인다)
  private func hostWindow() -> UIWindow? {
    UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
      .first { $0.activationState == .foregroundActive }?.keyWindow
  }

  private static func ms(since d: Date) -> Int { Int(Date().timeIntervalSince(d) * 1000) }

  /// foreground(EruriApp .active): 이어받기를 띄운다(돌고 있으면 그대로). 취소된 이어받기가 아직 풀리는 중이어도(flush 대기) 새로 띄운다 —
  /// 비활성 → 곧바로 활성(제어 센터·권한 알림창)에도 돌려놓은 행을 다시 읽는다(L5 리뷰 I1)
  func startDrain() {
    drain.start { await self.drainPending() }
  }

  /// 활성 상태를 벗어남(EruriApp): 이어받기·채팅 읽기를 취소한다 — LinkFlow.app 이 cancelled 로 행을 돌려놓는다(시도로 세지 않는다)
  func suspend() {
    drain.cancel()
    reads.cancelAll()
  }

  /// 확장이 넘긴(또는 확장이 죽어 lease 가 끝난) 대기 행을 5건씩 읽는다. 다 비면 끝, 2분 안에 시도할 행(확장 lease·재시도 백오프)이 남았으면
  /// 활성 상태에서 그때 다시 본다(Codex 4). 지운 행(확정 실패·3회 실패)만 로컬 알림 1건(주소·제목 없음, foreground 배너 — F25)
  func drainPending() async {
    var host = hostWindow()
    for _ in 0..<5 where host == nil {                                      // 콜드 스타트 .active 때 키 창이 아직 없을 수 있다
      try? await Task.sleep(for: .milliseconds(500))
      host = hostWindow()
    }
    guard let host, let q = try? CaptureQueue.shared() else { return }
    var queued = false
    while !Task.isCancelled {
      let claimedAt = Date(), links = (try? q.claimLinks(limit: 5)) ?? []
      if links.isEmpty {
        guard let next = try? q.nextLinkAttempt(), next.timeIntervalSinceNow < 120 else { break }
        try? await Task.sleep(for: .seconds(max(1, next.timeIntervalSinceNow)))
        continue
      }
      for link in links {
        if Task.isCancelled { try? q.releaseLink(id: link.id); continue }   // 잡아 둔 나머지는 돌려놓는다
        // 잡은 뒤 채팅이 같은 링크를 끝냈거나 읽는 중이면 건너뛴다 — 그쪽이 행을 지우거나 백오프로 다시 건다(취소였으면 이쪽이 읽는다, LinkReads)
        guard let o = await reads.drain(link, claimedAt: claimedAt, read: { await self.read($0, origin: "drain", host: host, queue: q) }) else { continue }
        if case .queued = o { queued = true }
        if case .failed(let code) = o, code != "queue" {
          await ExecutionReporter.notice(title: LinkCaptureText.drainFailedTitle, body: LinkCaptureText.drainFailedBody(code))
        }
      }
    }
    if queued { await Uploader.shared.flush(trigger: .foreground) }
  }

  /// 읽기 하나(LinkReads 가 취소 가능한 작업으로 돌린다 — suspend 가 취소). trace `share.link`·DiagLog `link <origin> <code>` 는 코드만
  private func read(_ link: PendingLink, origin: String, host: UIWindow, queue: CaptureQueue) async -> LinkFlow.Outcome {
    let started = Date(), r = LinkRenderer(host: host, allowLoopback: Self.allowLoopback)
    let o = await LinkFlow.app(link, renderer: r, queue: queue)
    Trace.log("share.link", LinkFlow.traceFields(o, origin: origin, elapsedMs: Self.ms(since: started), blockedNav: r.blockedNavigations))
    DiagLog.append("link \(origin) \(LinkFlow.code(o))")
    return o
  }

  /// 채팅 붙여넣기 1단계(스펙 §9): 이어받기가 같은 링크를 읽는 중이면 그 결과만 받는다. 아니면 관문(읽은 링크면 중복, 메모 OTP면 폐기 — 행 없음)
  /// → 대기 행(앱이 죽어도 다음 foreground 가 이어받게, lease 600초) → 읽기(15초 + OCR) → 큐 → 업로드. 다시 해 볼 실패면 이어받기가 백오프 뒤 다시 읽는다
  func chatRead(url: URL, note: String?) async -> ChatRead {
    guard let host = hostWindow() else { return ChatRead(text: LinkCaptureText.chat(.failed("no_host")), captureID: nil) }
    guard let q = try? CaptureQueue.shared() else { return ChatRead(text: LinkCaptureText.chat(.failed("queue_admit")), captureID: nil) }   // 대기 행 없음
    let r = await reads.chat(PendingLink(url: url, note: note, origin: "chat"), queue: q) { await self.read($0, origin: "chat", host: host, queue: q) }
    let o = r.outcome
    switch r {
    case .stopped:
      Trace.log("share.link", LinkFlow.traceFields(o, origin: "chat", elapsedMs: 0))
      DiagLog.append("link chat \(LinkFlow.code(o))")
    case .joined: DiagLog.append("link chat joined \(LinkFlow.code(o))")   // trace 는 읽은 쪽(이어받기)이 남겼다
    case .read: break
    }
    if case .retry(let code) = o, code != "cancelled" { startDrain() }       // cancelled 는 다음 .active 가 이어받는다
    guard case .queued(let id, _, _, _) = o else { return ChatRead(text: LinkCaptureText.chat(o), captureID: nil) }
    await Uploader.shared.flush(trigger: .foreground)        // 직접 요청 우선(8초), 응답이 없으면 background 세션(스펙 §6 업로더)
    return ChatRead(text: LinkCaptureText.chat(o), captureID: id)
  }

  /// 채팅 사진(스펙 §9 "채팅 사진 첨부", LI5): 앞의 3장을 한 장씩 메모리로 받아 OCR(파일 저장 없음) → ImageFlow → 업로드
  func chatImages(_ items: [PhotosPickerItem], note: String?) async -> ChatRead {
    let started = Date()
    var texts: [String] = []
    for item in items.prefix(ImageText.maxImages) {
      guard let d = try? await item.loadTransferable(type: Data.self) else { texts.append(""); continue }
      texts.append((try? await OCR.recognize(data: d)) ?? "")                // d 는 이 반복이 끝나면 놓인다
    }
    let o: ImageFlow.Outcome
    if let q = try? CaptureQueue.shared() { o = ImageFlow.finish(ocr: texts, images: texts.count, note: note, queue: q) } else { o = .failed("queue") }
    Trace.log("share.image", ImageFlow.traceFields(o, origin: "chat", elapsedMs: Self.ms(since: started), images: texts.count))
    DiagLog.append("image chat \(ImageFlow.code(o))")
    guard case .queued(let id, _, _) = o else { return ChatRead(text: LinkCaptureText.image(o, chat: true), captureID: nil) }
    await Uploader.shared.flush(trigger: .foreground)
    return ChatRead(text: LinkCaptureText.image(o, chat: true), captureID: id)
  }

  /// 2단계: 서버 처리 결과를 3초마다 최대 60초 확인(본인 items.status·gate_label·facts 종류만 — RLS, F19)
  func chatResult(captureID: String, subject: LinkCaptureText.Subject) async -> String {
    let key = "SHARE:\(captureID)".addingPercentEncoding(withAllowedCharacters: .alphanumerics.union(CharacterSet(charactersIn: "-"))) ?? captureID
    for _ in 0..<20 {
      try? await Task.sleep(for: .seconds(3))
      if let text = await result(key: key, subject: subject) { return text }
    }
    return LinkCaptureText.pending
  }

  private func result(key: String, subject: LinkCaptureText.Subject) async -> String? {
    guard let r = await API.send("rest/v1/items?select=id,status,gate_label&idempotency_key=eq.\(key)"), r.status == 200,
          let rows = (try? JSONSerialization.jsonObject(with: r.data)) as? [[String: Any]], let row = rows.first,
          let itemID = row["id"] as? String, let status = row["status"] as? String else { return nil }
    var kinds: [String] = []
    if status == "extracted", let f = await API.send("rest/v1/facts?select=kind&status=eq.active&item_id=eq.\(itemID)"), f.status == 200,
       let fr = (try? JSONSerialization.jsonObject(with: f.data)) as? [[String: Any]] {
      kinds = fr.compactMap { $0["kind"] as? String }
    }
    return LinkCaptureText.chatResult(status: status, gateLabel: row["gate_label"] as? String, kinds: kinds, subject: subject)
  }
}
