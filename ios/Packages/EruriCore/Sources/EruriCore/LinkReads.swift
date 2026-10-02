import Foundation

/// 앱 안 링크 읽기 조율(스펙 §6 "확장과 앱의 이어받기", L2 교차 확인 b — 메인 판정): 같은 링크(captureID)는 한 번에 한 곳만 렌더링한다.
/// 채팅 붙여넣기는 관문(admit — 행을 lease 600초로 다시 걸고 attempts 를 0 으로) 전에 이어받기가 같은 링크를 읽고 있는지 보고, 읽는 중이면
/// 새로 읽지 않고 그 결과만 받는다. 이어받기는 채팅이 읽고 있는 링크를 건너뛴다(채팅 lease 가 claim 을 막지만, 행이 풀린 틈에도 겹치지 않게).
/// 메인 액터라 확인과 등록 사이에 끼어들 수 없다. 다른 프로세스(공유 확장)와는 대기 행 lease 로 나뉜다
@MainActor public final class LinkReads {
  public enum ChatOutcome: Equatable, Sendable {
    /// 관문이 멈췄다(duplicate · discarded · failed("queue")) — 렌더링 없음
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
  /// 테스트: 다른 쪽 읽기에 붙은 채팅 수
  private(set) var joins = 0

  public init() {}

  public func isReading(_ captureID: String) -> Bool { reading[captureID] != nil }

  /// 이어받기(claimLinks 로 잡은 행): 같은 링크를 다른 쪽이 읽고 있으면 nil — 그쪽이 행을 지우거나 돌려놓는다
  public func drain(_ link: PendingLink, read: @escaping Read) async -> LinkFlow.Outcome? {
    guard reading[link.captureID] == nil else { return nil }
    return await run(link, read)
  }

  /// 채팅 붙여넣기: 같은 링크를 읽는 중이면 그 결과(joined), 아니면 관문(lease 600초) → 읽기
  public func chat(_ link: PendingLink, queue: CaptureQueue, now: Date = Date(), read: @escaping Read) async -> ChatOutcome {
    if let t = reading[link.captureID] { joins += 1; return .joined(await t.value) }
    switch LinkFlow.admit(link, queue: queue, lease: CaptureQueue.lease, now: now) {
    case .stop(let o): return .stopped(o)
    case .go(let admitted): return .read(await run(admitted, read))
    }
  }

  /// 앱이 활성 상태를 벗어남: 읽던 것을 모두 취소한다(LinkFlow.app 이 cancelled 로 행을 돌려놓는다). 붙어 있던 채팅도 그 결과를 받는다
  public func cancelAll() { for t in reading.values { t.cancel() } }

  private func run(_ link: PendingLink, _ read: @escaping Read) async -> LinkFlow.Outcome {
    let t = Task { @MainActor in await read(link) }
    reading[link.captureID] = t
    let o = await t.value
    reading[link.captureID] = nil
    return o
  }
}
