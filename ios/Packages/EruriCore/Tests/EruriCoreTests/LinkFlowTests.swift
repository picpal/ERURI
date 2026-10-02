import XCTest
import SQLite3
@testable import EruriCore

/// 링크 대기 행·흐름(스펙 §6 "확장과 앱의 이어받기"·"같은 링크")과 사진 흐름(ImageFlow). 렌더러는 가짜 — WebKit 은 LinkRendererTests
final class LinkFlowTests: XCTestCase {
  @MainActor final class FakeRenderer: LinkRendering {
    let outcome: LinkRenderOutcome
    private(set) var calls: [(budget: TimeInterval, ocr: Bool)] = []
    init(_ o: LinkRenderOutcome) { outcome = o }
    func render(_ url: URL, budget: TimeInterval, ocr: Bool) async -> LinkRenderOutcome { calls.append((budget, ocr)); return outcome }
  }

  let url = URL(string: "https://invite.example.com/m/abc?code=482913")!
  let url2 = URL(string: "https://party.example.com/p/1")!
  let page = LinkPage(host: "invite.example.com", title: "합성신랑 ♥ 합성신부 결혼합니다",
                      visibleText: "일시\n2026년 11월 14일 토요일 오후 1시 30분\n장소\n합성웨딩홀 3층")

  private func makeQueue() throws -> CaptureQueue {
    try CaptureQueue(url: FileManager.default.temporaryDirectory.appendingPathComponent("link-\(UUID().uuidString).sqlite"))
  }

  /// 같은 주소 = 같은 id(D14). 대기 행 id 는 캡처 id 에 접두
  func testPendingLinkIDs() {
    let l = PendingLink(url: url, note: nil, origin: "share")
    XCTAssertEqual(l.id, "link:" + l.captureID)
    XCTAssertEqual(l.captureID, LinkText.captureID(for: url))
    XCTAssertEqual(PendingLink(url: url, note: "다른 메모", origin: "chat").id, l.id)
    XCTAssertNotEqual(PendingLink(url: url2, note: nil, origin: "share").id, l.id)
    XCTAssertEqual(l.url, url.absoluteString)
    XCTAssertEqual(l.attempts, 0)
  }

  @MainActor func testShareQueuesCaptureAndDropsPendingRow() async throws {
    let q = try makeQueue(), r = FakeRenderer(.page(page, elapsedMs: 900))
    let link = PendingLink(url: url, note: "청첩장", origin: "share")
    let o = await LinkFlow.share(link, renderer: r, queue: q)
    guard case .queued(let id, let chars, false, false) = o else { return XCTFail("\(o)") }
    XCTAssertEqual(id, link.captureID)
    XCTAssertGreaterThan(chars, 0)
    XCTAssertEqual(r.calls.first?.budget, LinkFlow.shareBudget)
    XCTAssertEqual(r.calls.first?.ocr, false)                                    // 확장은 OCR 하지 않는다
    XCTAssertEqual(try q.linkCount(), 0)
    XCTAssertTrue(try q.isLinkSeen(captureID: link.captureID))                   // 읽은 링크 기록(D14)
    let items = try q.claim(limit: 10)
    XCTAssertEqual(items.count, 1)
    XCTAssertEqual(items[0].id, link.captureID)
    XCTAssertEqual(items[0].source, "SHARE")
    XCTAssertEqual(items[0].appName, "웹 링크")
    XCTAssertEqual(items[0].title, "합성신랑 ♥ 합성신부 결혼합니다")
    XCTAssertTrue(items[0].text.hasPrefix("[웹 링크] invite.example.com\n"))
    XCTAssertTrue(items[0].text.contains("메모: 청첩장"))
    XCTAssertEqual(items[0].capturedAt.timeIntervalSince1970, link.capturedAt.timeIntervalSince1970, accuracy: 0.001)
  }

  /// 같은 링크 재입력(메인 판정 MR2): 렌더링·행 없이 duplicate. 30일이 지나면 기록이 풀린다
  @MainActor func testSameLinkIsDuplicate() async throws {
    let q = try makeQueue(), r = FakeRenderer(.page(page, elapsedMs: 1))
    _ = await LinkFlow.share(PendingLink(url: url, note: nil, origin: "share"), renderer: r, queue: q)
    let again = await LinkFlow.share(PendingLink(url: URL(string: "http://invite.example.com/m/abc?code=482913#top")!, note: "또", origin: "chat"),
                                     renderer: r, queue: q)
    XCTAssertEqual(again, .duplicate)
    XCTAssertEqual(r.calls.count, 1)
    XCTAssertEqual(try q.linkCount(), 0)
    XCTAssertEqual(try q.claim(limit: 10).count, 1)
    let id = LinkText.captureID(for: url)
    XCTAssertFalse(try q.isLinkSeen(captureID: id, now: Date().addingTimeInterval(CaptureQueue.linkSeenFor + 60)))
  }

  /// 주소 쿼리의 code=482913 이 본문에 들어가면 OTP 규칙이 항목 전체를 폐기한다(F9) — 호스트만 들어가므로 통과한다
  @MainActor func testQueryDigitsDoNotDiscard() async throws {
    let q = try makeQueue()
    let o = await LinkFlow.share(PendingLink(url: url, note: nil, origin: "share"), renderer: FakeRenderer(.page(page, elapsedMs: 1)), queue: q)
    guard case .queued = o else { return XCTFail("\(o)") }
    XCTAssertFalse(try q.claim(limit: 1)[0].text.contains("482913"))
    // 대조: 전체 주소를 본문에 넣으면 폐기된다(호스트만 쓰는 이유). 이 단언이 깨지면 규칙이 F9 와 다르다 — 메인에게 알린다
    let full = try CapturePipeline(filter: RuleFilter(), queue: q).handleRead(id: UUID().uuidString, appName: LinkText.appName, title: nil,
                                                                             text: "링크: \(url.absoluteString)", capturedAt: Date())
    XCTAssertEqual(full, "discarded:otp")
  }

  /// 메모가 기기 규칙에 걸리면 행도 만들지 않는다(Codex 3 — App Group 에 인증번호를 남기지 않는다)
  @MainActor func testOTPNoteLeavesNoRow() async throws {
    let q = try makeQueue(), r = FakeRenderer(.page(page, elapsedMs: 1))
    let o = await LinkFlow.share(PendingLink(url: url, note: "인증번호 482913", origin: "share"), renderer: r, queue: q)
    XCTAssertEqual(o, .discarded("otp"))
    XCTAssertTrue(r.calls.isEmpty)
    XCTAssertEqual(try q.linkCount(), 0)
    XCTAssertEqual(try q.claim(limit: 10).count, 0)
  }

  /// 이미지 전용(날짜 후보 없음): 확장은 캡처를 넣지 않고 앱에 넘긴다 — 앱이 바로 가져간다
  @MainActor func testShareWithoutDateHandsOff() async throws {
    let q = try makeQueue(), link = PendingLink(url: url, note: nil, origin: "share")
    let bare = LinkPage(host: "card.example.com", title: "모바일 청첩장", visibleText: "터치하면 음악이 재생됩니다")
    let o = await LinkFlow.share(link, renderer: FakeRenderer(.page(bare, elapsedMs: 1)), queue: q)
    XCTAssertEqual(o, .handedOff("no_date"))
    XCTAssertEqual(try q.claim(limit: 10).count, 0)
    XCTAssertEqual(try q.claimLinks(limit: 10).map(\.id), [link.id])
  }

  /// 글 0자 페이지(Codex 1): 확장 렌더러는 빈 페이지를 .page 로 돌려 no_date 로, 혹시 empty 실패가 와도 앱(OCR)에 넘긴다
  @MainActor func testShareEmptyPageHandsOff() async throws {
    let q = try makeQueue()
    let a = await LinkFlow.share(PendingLink(url: url, note: nil, origin: "share"),
                                 renderer: FakeRenderer(.page(LinkPage(host: "card.example.com"), elapsedMs: 1)), queue: q)
    let b = await LinkFlow.share(PendingLink(url: url2, note: nil, origin: "share"), renderer: FakeRenderer(.failed("empty")), queue: q)
    XCTAssertEqual(a, .handedOff("no_date"))
    XCTAssertEqual(b, .handedOff("empty"))
    XCTAssertEqual(try q.linkCount(), 2)
  }

  @MainActor func testShareTimeoutHandsOffAndHTTPErrorFails() async throws {
    let q = try makeQueue()
    let a = PendingLink(url: url, note: nil, origin: "share"), b = PendingLink(url: url2, note: nil, origin: "share")
    let oa = await LinkFlow.share(a, renderer: FakeRenderer(.failed("timeout")), queue: q)
    let ob = await LinkFlow.share(b, renderer: FakeRenderer(.failed("http_404")), queue: q)
    XCTAssertEqual(oa, .handedOff("timeout"))
    XCTAssertEqual(ob, .failed("http_404"))
    XCTAssertEqual(try q.claimLinks(limit: 10).map(\.id), [a.id])                // 404 는 다시 해도 같다 — 행 삭제(확장은 텍스트로 폴백, L4)
  }

  @MainActor func testShareRenderingDisabledHandsOff() async throws {
    let q = try makeQueue(), r = FakeRenderer(.page(page, elapsedMs: 1))
    let o = await LinkFlow.share(PendingLink(url: url, note: nil, origin: "share"), renderer: r, queue: q, render: false)
    XCTAssertEqual(o, .handedOff("disabled"))
    XCTAssertTrue(r.calls.isEmpty)
    XCTAssertEqual(try q.claimLinks(limit: 10).count, 1)
  }

  /// 확장이 행을 남기고 죽었다: lease(60초) 동안은 앱이 가져가지 않고, 그 뒤 한 번 가져간다. 캡처 업로드와 섞이지 않는다
  func testExtensionDeathHandsOffAfterLease() throws {
    let q = try makeQueue(), t0 = Date()
    let link = PendingLink(url: url, note: nil, origin: "share", capturedAt: t0)
    try q.enqueueLink(link, lease: LinkFlow.shareLease, now: t0)
    XCTAssertEqual(try q.claimLinks(limit: 10, now: t0.addingTimeInterval(30)).count, 0)
    XCTAssertEqual(try q.nextLinkAttempt()?.timeIntervalSince1970 ?? 0, t0.addingTimeInterval(60).timeIntervalSince1970, accuracy: 0.01)
    XCTAssertEqual(try q.claim(limit: 10, now: t0.addingTimeInterval(61)).count, 0)
    XCTAssertEqual(try q.pending(limit: 10, now: t0.addingTimeInterval(61)).count, 0)
    XCTAssertEqual(try q.claimLinks(limit: 10, now: t0.addingTimeInterval(61)).map(\.id), [link.id])
    XCTAssertEqual(try q.claimLinks(limit: 10, now: t0.addingTimeInterval(62)).count, 0)   // 앱이 잡은 동안(600초) 다시 안 나온다
    XCTAssertEqual(try q.captureCount(), 0)
    XCTAssertEqual(try q.linkCount(), 1)
  }

  /// 같은 주소를 다시 공유하면(확장이 죽어 행이 남은 상태) 행은 하나, lease 만 새로 건다
  func testReEnqueueSameLinkRefreshesLease() throws {
    let q = try makeQueue(), t0 = Date()
    try q.enqueueLink(PendingLink(url: url, note: nil, origin: "share", capturedAt: t0), lease: 0, now: t0)
    try q.enqueueLink(PendingLink(url: url, note: "다시", origin: "share", capturedAt: t0), lease: 60, now: t0.addingTimeInterval(5))
    XCTAssertEqual(try q.linkCount(), 1)
    XCTAssertEqual(try q.claimLinks(limit: 10, now: t0.addingTimeInterval(30)).count, 0)
    XCTAssertEqual(try q.claimLinks(limit: 10, now: t0.addingTimeInterval(66)).first?.note, "다시")
  }

  /// 7일 가까이 남은 행을 다시 공유하면 새로 건 것으로 본다 — 만료가 재공유를 지우지 않는다(L2 리뷰 I1)
  func testReShareRestartsExpiry() throws {
    let q = try makeQueue(), t0 = Date(), day: TimeInterval = 86_400
    try q.enqueueLink(PendingLink(url: url, note: nil, origin: "share", capturedAt: t0), lease: 0, now: t0)
    let t1 = t0.addingTimeInterval(7 * day + 3600)
    try q.enqueueLink(PendingLink(url: url, note: nil, origin: "share", capturedAt: t1), lease: 0, now: t1)
    XCTAssertEqual(try q.claimLinks(limit: 10, now: t0.addingTimeInterval(7 * day + 7200)).count, 1)
  }

  /// 2회 실패한 행을 다시 공유하면 시도 수가 0부터(앱 기회 3회)
  func testReShareResetsAttempts() throws {
    let q = try makeQueue(), t = Date()
    try q.enqueueLink(PendingLink(url: url, note: nil, origin: "share"), lease: 0, now: t)
    try q.markFailed(id: PendingLink(url: url, note: nil, origin: "share").id)
    try q.markFailed(id: PendingLink(url: url, note: nil, origin: "share").id)
    XCTAssertEqual(try q.claimLinks(limit: 1, now: t.addingTimeInterval(3600)).first?.attempts, 2)
    let t1 = t.addingTimeInterval(4000)
    try q.enqueueLink(PendingLink(url: url, note: nil, origin: "share", capturedAt: t1), lease: 0, now: t1)
    XCTAssertEqual(try q.claimLinks(limit: 1, now: t1).first?.attempts, 0)
  }

  /// 7일 지난 행은 enqueue 때도 지운다(앱이 열리지 않아도)
  func testEnqueueDropsExpiredLinkRows() throws {
    let q = try makeQueue(), t0 = Date()
    try q.enqueueLink(PendingLink(url: url, note: "청첩장", origin: "share", capturedAt: t0), lease: 0, now: t0)
    let t1 = t0.addingTimeInterval(CaptureQueue.linkMaxAge + 60)
    try q.enqueueLink(PendingLink(url: url2, note: nil, origin: "share", capturedAt: t1), lease: 0, now: t1)
    XCTAssertEqual(try q.linkCount(), 1)
  }

  func testUnreadableLinkRowIsDropped() throws {
    let q = try makeQueue()
    try q.enqueueLink(PendingLink(url: url, note: nil, origin: "share"), lease: 0)
    try q.insertRawLinkForTesting(id: "link:poison", payload: Data("{".utf8))
    XCTAssertEqual(try q.claimLinks(limit: 10).count, 1)
    XCTAssertEqual(try q.linkCount(), 1)                                          // poison 행은 지워졌다
  }

  /// 대기 행은 7일 지나면 지운다(Codex 3 — 기기에 주소·메모가 무기한 남지 않게)
  func testExpiredLinkRowsAreDropped() throws {
    let q = try makeQueue(), t0 = Date()
    try q.enqueueLink(PendingLink(url: url, note: "청첩장", origin: "share", capturedAt: t0), lease: 0, now: t0)
    XCTAssertEqual(try q.claimLinks(limit: 10, now: t0.addingTimeInterval(CaptureQueue.linkMaxAge + 60)).count, 0)
    XCTAssertEqual(try q.linkCount(), 0)
  }

  @MainActor func testAppUsesOCRBudgetAndQueues() async throws {
    let q = try makeQueue()
    let p = LinkPage(host: "card.example.com", title: "모바일 청첩장", visibleText: "터치하면 음악이 재생됩니다",
                     ocrText: "2026. 12. 5. SAT PM 12:00\n합성 컨벤션 웨딩홀 5층")
    let r = FakeRenderer(.page(p, elapsedMs: 4000))
    try q.enqueueLink(PendingLink(url: url, note: nil, origin: "share"), lease: 0)
    let claimed = try q.claimLinks(limit: 1)
    let o = await LinkFlow.app(claimed[0], renderer: r, queue: q)
    guard case .queued(_, _, true, false) = o else { return XCTFail("\(o)") }
    XCTAssertEqual(r.calls.first?.budget, LinkFlow.appBudget)
    XCTAssertEqual(r.calls.first?.ocr, true)
    XCTAssertEqual(try q.linkCount(), 0)
    XCTAssertTrue(try q.claim(limit: 1)[0].text.contains("이미지 속 글자:\n2026. 12. 5. SAT PM 12:00"))
  }

  /// 앱의 재시도 가능한 실패(Fable C4): 행을 남기고 백오프(30초·60초), 3회째에 지운다
  @MainActor func testAppRetryableFailureKeepsRow() async throws {
    let q = try makeQueue(), t = Date(), r = FakeRenderer(.failed("timeout"))
    try q.enqueueLink(PendingLink(url: url, note: nil, origin: "share"), lease: 0, now: t)
    let first = try q.claimLinks(limit: 1, now: t)
    let o1 = await LinkFlow.app(first[0], renderer: r, queue: q)
    XCTAssertEqual(o1, .retry("timeout"))
    XCTAssertEqual(try q.linkCount(), 1)
    XCTAssertEqual(try q.claimLinks(limit: 1, now: t.addingTimeInterval(10)).count, 0)       // 백오프 30초
    let second = try q.claimLinks(limit: 1, now: t.addingTimeInterval(40))
    XCTAssertEqual(second.first?.attempts, 1)
    let o2 = await LinkFlow.app(second[0], renderer: r, queue: q)
    XCTAssertEqual(o2, .retry("timeout"))
    let third = try q.claimLinks(limit: 1, now: t.addingTimeInterval(130))
    XCTAssertEqual(third.first?.attempts, 2)
    let o3 = await LinkFlow.app(third[0], renderer: r, queue: q)
    XCTAssertEqual(o3, .failed("timeout"))
    XCTAssertEqual(try q.linkCount(), 0)
  }

  /// 확정 실패(막힌 주소·HTTP 오류·OCR 뒤 빈 페이지 …)는 바로 지운다(호출 쪽이 알린다)
  @MainActor func testAppDefinitiveFailureDropsRow() async throws {
    let q = try makeQueue()
    try q.enqueueLink(PendingLink(url: url, note: nil, origin: "share"), lease: 0)
    let claimed = try q.claimLinks(limit: 1)
    let o = await LinkFlow.app(claimed[0], renderer: FakeRenderer(.failed("http_404")), queue: q)
    XCTAssertEqual(o, .failed("http_404"))
    XCTAssertEqual(try q.linkCount(), 0)
  }

  /// 읽는 중 앱이 비활성(취소): 행을 그대로 돌려놓는다 — 시도로 세지 않고, 다음 foreground 가 바로 가져간다
  @MainActor func testAppCancelledReleasesRow() async throws {
    let q = try makeQueue()
    try q.enqueueLink(PendingLink(url: url, note: nil, origin: "share"), lease: 0)
    let claimed = try q.claimLinks(limit: 1)
    let o = await LinkFlow.app(claimed[0], renderer: FakeRenderer(.failed("cancelled")), queue: q)
    XCTAssertEqual(o, .retry("cancelled"))
    let again = try q.claimLinks(limit: 1)
    XCTAssertEqual(again.first?.attempts, 0)
  }

  @MainActor func testOTPPageIsDiscardedWithoutCapture() async throws {
    let q = try makeQueue()
    let otp = LinkPage(host: "x.example.com", title: "합성 예약", visibleText: "2026년 11월 14일 방문\n인증번호 482913 을 입력하세요")
    let o = await LinkFlow.share(PendingLink(url: url, note: nil, origin: "share"), renderer: FakeRenderer(.page(otp, elapsedMs: 1)), queue: q)
    XCTAssertEqual(o, .discarded("otp"))
    XCTAssertEqual(try q.claim(limit: 10).count, 0)
    XCTAssertEqual(try q.linkCount(), 0)
    XCTAssertFalse(try q.isLinkSeen(captureID: LinkText.captureID(for: url)))       // 폐기는 기록하지 않는다
  }

  /// 확장이 큐 항목을 넣고 행을 지우기 전에 죽음 → 앱이 같은 행으로 다시 읽음: 캡처 id 가 같아 큐에 한 건(서버도 SHARE:<id> 로 한 건)
  func testFinishTwiceKeepsOneCapture() throws {
    let q = try makeQueue(), link = PendingLink(url: url, note: nil, origin: "share")
    try q.enqueueLink(link, lease: 0)
    _ = LinkFlow.finish(link, page: page, queue: q)
    try q.enqueueLink(link, lease: 0)
    _ = LinkFlow.finish(link, page: page, queue: q)
    XCTAssertEqual(try q.claim(limit: 10).map(\.id), [link.captureID])
  }

  /// 확장의 텍스트 폴백(스펙 §6, D8): 확정 실패만 원래 공유 글을 텍스트 항목으로. failed("queue")(finish 의 큐 쓰기 실패)는 폴백하지 않는다 —
  /// 대기 행이 남아 앱이 이어받으므로 폴백하면 항목이 두 개(메인 판정, L2 교차 확인 c). admit 의 실패 failed("queue_admit")는 행이 없어 폴백한다
  func testTextFallbackOnlyForFinalRenderFailures() {
    for code in ["http_404", "blocked_scheme", "blocked_host", "unsupported", "redirects", "insecure"] {
      XCTAssertTrue(LinkFlow.fallsBackToText(.failed(code)), code)
    }
    XCTAssertFalse(LinkFlow.fallsBackToText(.failed("queue")))
    XCTAssertTrue(LinkFlow.fallsBackToText(.failed("queue_admit")))            // 대기 행이 없다(L5 메인 판정 1)
    for o: LinkFlow.Outcome in [.queued(captureID: "c", chars: 1, ocr: false, timedOut: false), .duplicate, .discarded("otp"),
                                .handedOff("timeout"), .handedOff("no_date"), .retry("timeout")] {
      XCTAssertFalse(LinkFlow.fallsBackToText(o), "\(o)")
    }
  }

  /// 렌더링 중 다른 연결이 큐 파일을 잠근다(다른 프로세스의 긴 쓰기 흉내) — finish 의 큐 쓰기가 busy_timeout 뒤 실패
  @MainActor final class LockingRenderer: LinkRendering {
    let path: String, outcome: LinkRenderOutcome
    var db: OpaquePointer?
    init(path: String, _ o: LinkRenderOutcome) { self.path = path; outcome = o }
    func lock() { sqlite3_open(path, &db); sqlite3_exec(db, "BEGIN EXCLUSIVE", nil, nil, nil) }
    func unlock() { sqlite3_exec(db, "ROLLBACK", nil, nil, nil); sqlite3_close(db); db = nil }
    func render(_ url: URL, budget: TimeInterval, ocr: Bool) async -> LinkRenderOutcome { lock(); return outcome }
  }

  /// finish 의 큐 쓰기 실패 = failed("queue") + 대기 행이 남는다(lease 뒤 앱이 이어받는다) → 확장은 텍스트 폴백하지 않는다
  @MainActor func testShareQueueFailureAfterRenderKeepsRowAndNoFallback() async throws {
    let file = FileManager.default.temporaryDirectory.appendingPathComponent("link-\(UUID().uuidString).sqlite")
    let q = try CaptureQueue(url: file), r = LockingRenderer(path: file.path, .page(page, elapsedMs: 900))
    let link = PendingLink(url: url, note: nil, origin: "share")
    let o = await LinkFlow.share(link, renderer: r, queue: q)
    r.unlock()
    XCTAssertEqual(o, .failed("queue"))
    XCTAssertFalse(LinkFlow.fallsBackToText(o))
    XCTAssertEqual(try q.claimLinks(limit: 10, now: Date().addingTimeInterval(LinkFlow.shareLease + 1)).map(\.id), [link.id])
    XCTAssertEqual(try q.claim(limit: 10), [])
  }

  /// admit 의 큐 쓰기 실패 = failed("queue_admit") + 행 없음(렌더링도 없음) → 앱이 이어받을 행이 없으니 텍스트 폴백을 해 본다(L5 메인 판정 1 —
  /// 잠금이 풀렸으면 원래 공유 글이 남고, 큐 파일을 못 쓰면 폴백도 실패해 일반 실패 문구)
  @MainActor func testShareQueueFailureAtAdmitHasNoRowAndFallsBack() async throws {
    let file = FileManager.default.temporaryDirectory.appendingPathComponent("link-\(UUID().uuidString).sqlite")
    let q = try CaptureQueue(url: file), r = LockingRenderer(path: file.path, .page(page, elapsedMs: 900))
    r.lock()
    let o = await LinkFlow.share(PendingLink(url: url, note: nil, origin: "share"), renderer: r, queue: q)
    r.unlock()
    XCTAssertEqual(o, .failed("queue_admit"))
    XCTAssertTrue(LinkFlow.fallsBackToText(o))
    XCTAssertEqual(try q.claimLinks(limit: 10, now: Date().addingTimeInterval(LinkFlow.shareLease + 1)), [])
  }

  func testTraceFieldsHaveNoURLOrText() {
    let f = LinkFlow.traceFields(.queued(captureID: "c", chars: 812, ocr: true, timedOut: false), origin: "share", elapsedMs: 3400, blockedNav: 1)
    XCTAssertEqual(Set(f.keys), ["origin", "elapsed_ms", "result", "chars", "ocr", "timed_out", "blocked_nav"])
    XCTAssertEqual(f["result"] as? String, "queued")
    XCTAssertTrue(Set(f.keys).isDisjoint(with: Trace.forbiddenKeys))
    let g = LinkFlow.traceFields(.failed("http_404"), origin: "drain", elapsedMs: 1)
    XCTAssertEqual(g["result"] as? String, "failed")
    XCTAssertEqual(g["code"] as? String, "http_404")
    XCTAssertEqual(LinkFlow.traceFields(.duplicate, origin: "chat", elapsedMs: 1)["result"] as? String, "duplicate")
    XCTAssertEqual(LinkFlow.traceFields(.retry("timeout"), origin: "drain", elapsedMs: 1)["code"] as? String, "timeout")
    XCTAssertEqual(LinkFlow.code(.handedOff("no_date")), "handed_off:no_date")
    XCTAssertEqual(LinkFlow.code(.retry("cancelled")), "retry:cancelled")
    let i = ImageFlow.traceFields(.queued(captureID: "c", chars: 300, images: 2), origin: "share", elapsedMs: 2100, images: 2)
    XCTAssertEqual(Set(i.keys), ["origin", "elapsed_ms", "images", "result", "chars"])
    XCTAssertTrue(Set(i.keys).isDisjoint(with: Trace.forbiddenKeys))
    XCTAssertEqual(ImageFlow.code(.empty), "empty")
  }

  // MARK: 사진(LI3, 스펙 §6 "사진 OCR") — 파일 없이 OCR 글만 SHARE 항목으로

  func testImageQueuesShareItem() throws {
    let q = try makeQueue()
    let o = ImageFlow.finish(ocr: ["합성웨딩홀 5층\n2026년 12월 19일 토요일 오후 3시"], images: 1, note: "청첩장", queue: q)
    guard case .queued(let id, let chars, 1) = o else { return XCTFail("\(o)") }
    XCTAssertGreaterThan(chars, 0)
    let items = try q.claim(limit: 10)
    XCTAssertEqual(items.map(\.id), [id])
    XCTAssertEqual(items[0].source, "SHARE")
    XCTAssertEqual(items[0].appName, "이미지")
    XCTAssertNil(items[0].title)
    XCTAssertNil(items[0].localFile)                                               // 파일 없음
    XCTAssertTrue(items[0].text.hasPrefix("[이미지] 사진 1장\n메모: 청첩장\n이미지 속 글자:\n"))
    XCTAssertEqual(try q.linkCount(), 0)                                            // 대기 행 없음
  }

  func testImageEmptyQueuesNothing() throws {
    let q = try makeQueue()
    XCTAssertEqual(ImageFlow.finish(ocr: ["", " 가 "], images: 2, note: nil, queue: q), .empty)
    XCTAssertEqual(try q.claim(limit: 10).count, 0)
  }

  func testImageOTPIsDiscarded() throws {
    let q = try makeQueue()
    XCTAssertEqual(ImageFlow.finish(ocr: ["인증번호 482913 을 입력하세요"], images: 1, note: nil, queue: q), .discarded("otp"))
    XCTAssertEqual(try q.claim(limit: 10).count, 0)
  }
}
