import XCTest
@testable import EruriCore

/// 앱 안 같은 링크 읽기 조율(L2 교차 확인 b — 메인 판정): 채팅 붙여넣기(admit lease 600)와 이어받기가 같은 행을 동시에 렌더링하지 않는다
final class LinkReadsTests: XCTestCase {
  /// 열어 줄 때까지 붙잡는 가짜 렌더러. 취소되면 cancelled(LinkRenderer 와 같다)
  @MainActor final class GatedRenderer: LinkRendering {
    let outcome: LinkRenderOutcome
    private(set) var calls = 0
    var open = false
    init(_ o: LinkRenderOutcome) { outcome = o }
    func render(_ url: URL, budget: TimeInterval, ocr: Bool) async -> LinkRenderOutcome {
      calls += 1
      while !open && !Task.isCancelled { try? await Task.sleep(for: .milliseconds(10)) }
      return Task.isCancelled ? .failed("cancelled") : outcome
    }
  }

  let url = URL(string: "https://invite.example.com/m/abc")!
  let page = LinkPage(host: "invite.example.com", title: "합성신랑 ♥ 합성신부 결혼합니다",
                      visibleText: "일시\n2026년 11월 14일 토요일 오후 1시 30분\n장소\n합성웨딩홀 3층")

  private func makeQueue() throws -> CaptureQueue {
    try CaptureQueue(url: FileManager.default.temporaryDirectory.appendingPathComponent("reads-\(UUID().uuidString).sqlite"))
  }

  @MainActor private func until(_ cond: @MainActor () -> Bool, file: StaticString = #filePath, line: UInt = #line) async {
    for _ in 0..<500 where !cond() { try? await Task.sleep(for: .milliseconds(10)) }
    XCTAssertTrue(cond(), file: file, line: line)
  }

  /// 확장이 넘긴 행을 이어받기가 읽는 중에 같은 링크를 채팅에 붙여넣으면 관문을 거치지 않고(행 lease·attempts 그대로) 그 결과만 받는다 — 렌더링 1번, 항목 1건
  @MainActor func testChatJoinsDrainReadingSameLink() async throws {
    let q = try makeQueue(), reads = LinkReads()
    let drainR = GatedRenderer(.page(page, elapsedMs: 1)), chatR = GatedRenderer(.page(page, elapsedMs: 1))
    try q.enqueueLink(PendingLink(url: url, note: nil, origin: "share"), lease: 0)
    let claimed = try q.claimLinks(limit: 5)
    XCTAssertEqual(claimed.count, 1)
    let drain = Task { await reads.drain(claimed[0]) { await LinkFlow.app($0, renderer: drainR, queue: q) } }
    await until { drainR.calls == 1 }
    XCTAssertTrue(reads.isReading(claimed[0].captureID))
    let chat = Task { await reads.chat(PendingLink(url: url, note: "청첩장", origin: "chat"), queue: q) { await LinkFlow.app($0, renderer: chatR, queue: q) } }
    await until { reads.joins == 1 }
    drainR.open = true; chatR.open = true                                       // (붙지 않았다면 채팅 렌더링도 끝나게 — 실패로 드러난다)
    let d = await drain.value, c = await chat.value
    guard case .queued(let id, _, _, _)? = d else { return XCTFail("\(String(describing: d))") }
    XCTAssertEqual(c, .joined(d!))
    XCTAssertEqual(chatR.calls, 0)                                              // 채팅은 렌더링하지 않았다
    XCTAssertEqual(try q.claim(limit: 10).map(\.id), [id])                      // 항목 1건
    XCTAssertEqual(try q.linkCount(), 0)
    XCTAssertFalse(reads.isReading(id))
  }

  /// 채팅이 읽는 중에 그 행이 풀려(cancel·release 틈) 이어받기가 잡아도 렌더링하지 않고 건너뛴다. 끝난 뒤 다시 붙여넣으면 중복
  @MainActor func testDrainSkipsLinkChatIsReading() async throws {
    let q = try makeQueue(), reads = LinkReads()
    let chatR = GatedRenderer(.page(page, elapsedMs: 1)), drainR = GatedRenderer(.page(page, elapsedMs: 1))
    let link = PendingLink(url: url, note: nil, origin: "chat")
    let chat = Task { await reads.chat(link, queue: q) { await LinkFlow.app($0, renderer: chatR, queue: q) } }
    await until { chatR.calls == 1 }
    XCTAssertTrue(try q.claimLinks(limit: 5).isEmpty)                           // 채팅 lease(600초)가 이어받기를 막는다
    try q.releaseLink(id: link.id)                                              // 그래도 행이 풀린 틈에
    let claimed = try q.claimLinks(limit: 5)
    XCTAssertEqual(claimed.map(\.id), [link.id])
    let drain = Task { await reads.drain(claimed[0]) { await LinkFlow.app($0, renderer: drainR, queue: q) } }
    try await Task.sleep(for: .milliseconds(100))
    chatR.open = true; drainR.open = true
    let skipped = await drain.value
    XCTAssertNil(skipped)
    XCTAssertEqual(drainR.calls, 0)
    guard case .read(.queued) = await chat.value else { return XCTFail() }
    XCTAssertEqual(try q.claim(limit: 10).count, 1)
    XCTAssertEqual(try q.linkCount(), 0)
    let again = await reads.chat(link, queue: q) { await LinkFlow.app($0, renderer: chatR, queue: q) }
    XCTAssertEqual(again, .stopped(.duplicate))
    XCTAssertEqual(chatR.calls, 1)
  }

  /// 앱이 비활성으로 가면(cancelAll) 이어받기는 행을 그대로 돌려놓고(시도 수 그대로), 붙어 있던 채팅도 cancelled 를 받는다
  @MainActor func testCancelAllReleasesRowAndJoinedChatSeesCancelled() async throws {
    let q = try makeQueue(), reads = LinkReads()
    let drainR = GatedRenderer(.page(page, elapsedMs: 1)), chatR = GatedRenderer(.page(page, elapsedMs: 1))
    try q.enqueueLink(PendingLink(url: url, note: nil, origin: "share"), lease: 0)
    let claimed = try q.claimLinks(limit: 5)
    let drain = Task { await reads.drain(claimed[0]) { await LinkFlow.app($0, renderer: drainR, queue: q) } }
    await until { drainR.calls == 1 }
    let chat = Task { await reads.chat(PendingLink(url: url, note: nil, origin: "chat"), queue: q) { await LinkFlow.app($0, renderer: chatR, queue: q) } }
    await until { reads.joins == 1 }
    reads.cancelAll()
    drainR.open = true; chatR.open = true                                       // 취소된 쪽은 열려도 cancelled 를 돌려준다
    let d = await drain.value, c = await chat.value
    XCTAssertEqual(d, .retry("cancelled"))
    XCTAssertEqual(c, .joined(.retry("cancelled")))
    XCTAssertEqual(chatR.calls, 0)
    let back = try q.claimLinks(limit: 5)                                       // 바로 다시 가져갈 수 있고 시도로 세지 않았다
    XCTAssertEqual(back.map(\.id), [claimed[0].id])
    XCTAssertEqual(back.first?.attempts, 0)
    XCTAssertFalse(reads.isReading(claimed[0].captureID))
  }

  /// 취소되면 열어 줄 때까지 cancelled 를 돌려주지 않는 렌더러(취소된 읽기가 풀리는 틈 흉내)
  @MainActor final class SlowCancelRenderer: LinkRendering {
    private(set) var calls = 0
    var release = false
    func render(_ url: URL, budget: TimeInterval, ocr: Bool) async -> LinkRenderOutcome {
      calls += 1
      while !Task.isCancelled { try? await Task.sleep(for: .milliseconds(10)) }
      while !release { try? await Task.sleep(for: .milliseconds(10)) }
      return .failed("cancelled")
    }
  }

  /// 비활성 → 곧바로 활성(L5 리뷰 I1): 취소된 읽기가 행을 돌려놓은 뒤 아직 끝나지 않은 틈에 새 이어받기가 그 행을 잡으면, 끝나기를 기다렸다가
  /// 직접 읽는다(건너뛰면 claim lease 600초 동안 아무도 읽지 않는다)
  @MainActor func testDrainReadsRowReleasedByCancelledRead() async throws {
    let q = try makeQueue(), reads = LinkReads()
    let oldR = SlowCancelRenderer(), newR = GatedRenderer(.page(page, elapsedMs: 1))
    try q.enqueueLink(PendingLink(url: url, note: nil, origin: "share"), lease: 0)
    let first = try q.claimLinks(limit: 5)
    let old = Task { await reads.drain(first[0]) { await LinkFlow.app($0, renderer: oldR, queue: q) } }
    await until { oldR.calls == 1 }
    reads.cancelAll()
    try q.releaseLink(id: first[0].id)                                          // LinkFlow.app 이 cancelled 로 돌려놓은 상태
    let claimedAt = Date(), second = try q.claimLinks(limit: 5)
    XCTAssertEqual(second.map(\.id), [first[0].id])
    newR.open = true
    let new = Task { await reads.drain(second[0], claimedAt: claimedAt) { await LinkFlow.app($0, renderer: newR, queue: q) } }
    try await Task.sleep(for: .milliseconds(100))
    XCTAssertEqual(newR.calls, 0)                                               // 옛 읽기가 끝나기를 기다린다
    oldR.release = true
    let o = await old.value, n = await new.value
    XCTAssertEqual(o, .retry("cancelled"))
    guard case .queued(let id, _, _, _)? = n else { return XCTFail("\(String(describing: n))") }
    XCTAssertEqual(newR.calls, 1)
    XCTAssertEqual(try q.claim(limit: 10).map(\.id), [id])
    XCTAssertEqual(try q.linkCount(), 0)
  }

  /// drain 배치의 낡은 행(L5 리뷰 Minor 1): 이어받기가 잡은 뒤 채팅이 같은 링크를 먼저 끝냈으면(큐에 넣음·백오프) 그 행에 도착해도 다시 읽지 않는다
  @MainActor func testDrainSkipsRowChatFinishedAfterClaim() async throws {
    let q = try makeQueue(), reads = LinkReads()
    let other = URL(string: "https://invite.example.com/m/def")!
    let chatR = GatedRenderer(.page(page, elapsedMs: 1)), failR = GatedRenderer(.failed("timeout")), drainR = GatedRenderer(.page(page, elapsedMs: 1))
    chatR.open = true; failR.open = true; drainR.open = true
    try q.enqueueLink(PendingLink(url: url, note: nil, origin: "share"), lease: 0)
    try q.enqueueLink(PendingLink(url: other, note: nil, origin: "share"), lease: 0)
    let claimedAt = Date(), batch = try q.claimLinks(limit: 5)
    XCTAssertEqual(batch.count, 2)
    guard case .read(.queued) = await reads.chat(PendingLink(url: url, note: nil, origin: "chat"), queue: q, read: { await LinkFlow.app($0, renderer: chatR, queue: q) })
    else { return XCTFail() }
    let failed = await reads.chat(PendingLink(url: other, note: nil, origin: "chat"), queue: q) { await LinkFlow.app($0, renderer: failR, queue: q) }
    XCTAssertEqual(failed, .read(.retry("timeout")))
    for link in batch {
      let o = await reads.drain(link, claimedAt: claimedAt) { await LinkFlow.app($0, renderer: drainR, queue: q) }
      XCTAssertNil(o)
    }
    XCTAssertEqual(drainR.calls, 0)
    XCTAssertEqual(try q.claim(limit: 10).count, 1)
    XCTAssertTrue(try q.claimLinks(limit: 5).isEmpty)                           // 실패한 링크는 채팅이 건 백오프를 지킨다
    XCTAssertEqual(try q.linkCount(), 1)
    // 나중 claim 은 그 기록에 막히지 않는다
    let later = try q.claimLinks(limit: 5, now: Date().addingTimeInterval(120))
    guard later.count == 1 else { return XCTFail("\(later.count)") }
    let o = await reads.drain(later[0], claimedAt: Date()) { await LinkFlow.app($0, renderer: drainR, queue: q) }
    guard case .queued? = o else { return XCTFail("\(String(describing: o))") }
  }

  /// 취소된 이어받기가 읽기를 시작하면 그 읽기도 바로 취소된다 — 행을 돌려놓고 시도로 세지 않는다(비활성 상태에서 렌더링하지 않는다)
  @MainActor func testCancelledDrainCancelsItsRead() async throws {
    let q = try makeQueue(), reads = LinkReads(), r = GatedRenderer(.page(page, elapsedMs: 1))
    try q.enqueueLink(PendingLink(url: url, note: nil, origin: "share"), lease: 0)
    let claimed = try q.claimLinks(limit: 5)
    let t = Task { await reads.drain(claimed[0]) { await LinkFlow.app($0, renderer: r, queue: q) } }
    t.cancel()
    await until { r.calls == 1 }
    try await Task.sleep(for: .milliseconds(100))
    r.open = true
    let o = await t.value
    XCTAssertEqual(o, .retry("cancelled"))
    XCTAssertEqual(try q.claimLinks(limit: 5).first?.attempts, 0)
  }
}
