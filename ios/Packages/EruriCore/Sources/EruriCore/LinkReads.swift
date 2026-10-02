import Foundation

/// 앱 안 링크 읽기 조율(스펙 §6 "확장과 앱의 이어받기", L2 교차 확인 b — 메인 판정): 같은 링크(captureID)는 한 번에 한 곳만 렌더링한다.
/// 채팅 붙여넣기는 관문(admit — 행을 lease 600초로 다시 걸고 attempts 를 0 으로) 전에 이어받기가 같은 링크를 읽고 있는지 보고, 읽는 중이면
/// 새로 읽지 않고 그 결과만 받는다. 이어받기는 채팅이 읽고 있는 링크를 건너뛴다(채팅 lease 가 claim 을 막지만, 행이 풀린 틈에도 겹치지 않게).
/// 메인 액터라 확인과 등록 사이에 끼어들 수 없다. 다른 프로세스(공유 확장)와는 대기 행 lease 로 나뉜다
@MainActor public final class LinkReads {
  public enum ChatOutcome: Equatable, Sendable {
    /// 관문이 멈췄다(duplicate · discarded · failed("queue_admit")) — 렌더링 없음
    case stopped(LinkFlow.Outcome)
    /// 이어받기가 같은 링크를 읽고 있었다 — 새로 읽지 않고 그 결과
    case joined(LinkFlow.Outcome)
    /// 채팅이 읽었다
    case read(LinkFlow.Outcome)

    public var outcome: LinkFlow.Outcome {
      switch self { case .stopped(let o), .joined(let o), .read(let o): return o }
    }
  }

  public typealias Read = @MainActor (PendingLink) async -> LinkFlow.Outcome

  private var reading: [String: Task<LinkFlow.Outcome, Never>] = [:]
  /// 취소가 아닌 결과로 끝난 읽기의 끝난 시각(captureID) — 이어받기가 잡아 둔 배치의 낡은 행을 거른다(L5 리뷰 Minor 1). lease 동안만 둔다
  private var finished: [String: Date] = [:]
  #if DEBUG
  /// 테스트: 다른 쪽 읽기에 붙은 채팅 수
  private(set) var joins = 0
  #endif

  public init() {}

  public func isReading(_ captureID: String) -> Bool { reading[captureID] != nil }

  /// 이어받기(claimedAt 에 claimLinks 로 잡은 행). nil = 읽지 않았다(행은 다른 쪽이 지웠거나 백오프로 다시 걸었다):
  /// - 잡은 뒤 다른 쪽(채팅)이 같은 링크를 끝냈으면 건너뛴다 — 배치에 든 낡은 행(큐에 넣음·백오프)을 다시 읽지 않는다
  /// - 다른 쪽이 읽는 중이면 끝나기를 기다린다. 행이 claim 될 수 있었다 = 그쪽이 취소돼 행을 돌려놓았다(채팅·claim lease 600초가 그 전에는 막는다).
  ///   그쪽 결과가 취소면 이 claim 이 행을 쥐고 있으니 직접 읽고(건너뛰면 lease 600초 동안 아무도 읽지 않는다 — 비활성 → 곧바로 활성, L5 리뷰 I1),
  ///   아니면 건너뛴다
  public func drain(_ link: PendingLink, claimedAt: Date? = nil, read: @escaping Read) async -> LinkFlow.Outcome? {
    if let t = reading[link.captureID] {
      guard await t.value == .retry("cancelled"), reading[link.captureID].map({ $0 == t }) ?? true else { return nil }   // 그 사이 또 다른 읽기가 시작됐으면 건너뛴다
    } else if let c = claimedAt, let f = finished[link.captureID], f >= c {
      return nil
    }
    return await run(link, read)
  }

  /// 채팅 붙여넣기: 같은 링크를 읽는 중이면 그 결과(joined), 아니면 관문(lease 600초) → 읽기
  public func chat(_ link: PendingLink, queue: CaptureQueue, now: Date = Date(), read: @escaping Read) async -> ChatOutcome {
    if let t = reading[link.captureID] {
      #if DEBUG
      joins += 1
      #endif
      return .joined(await t.value)                                             // 채팅 메모는 이어받기 쪽 행의 메모(확장이 넣은 것)로 저장된다 — 수용(L5 리뷰 Minor 2)
    }
    switch LinkFlow.admit(link, queue: queue, lease: CaptureQueue.lease, now: now) {
    case .stop(let o): return .stopped(o)
    case .go(let admitted): return .read(await run(admitted, read))
    }
  }

  /// 앱이 활성 상태를 벗어남: 읽던 것을 모두 취소한다(LinkFlow.app 이 cancelled 로 행을 돌려놓는다). 붙어 있던 채팅도 그 결과를 받는다
  public func cancelAll() { for t in reading.values { t.cancel() } }

  /// 부른 쪽이 이미 취소됐으면(취소된 이어받기) 읽기도 바로 취소한다 — LinkFlow.app 이 cancelled 로 행을 돌려놓는다(비활성 상태에서 렌더링하지 않는다)
  private func run(_ link: PendingLink, _ read: @escaping Read) async -> LinkFlow.Outcome {
    let t = Task { @MainActor in await read(link) }
    reading[link.captureID] = t
    if Task.isCancelled { t.cancel() }
    let o = await t.value
    if reading[link.captureID] == t { reading[link.captureID] = nil }          // 끝난 뒤 이어받기가 먼저 깨어나 같은 링크를 다시 읽기 시작했을 수 있다
    if o != .retry("cancelled") {
      let now = Date()
      finished = finished.filter { now.timeIntervalSince($0.value) < CaptureQueue.lease }
      finished[link.captureID] = now
    }
    return o
  }
}
