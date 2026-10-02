import Foundation

/// 취소한 뒤 곧바로 다시 띄울 수 있는 작업 하나(앱 이어받기 drain — L5 리뷰 I1). 취소된 작업이 await(업로드 flush·알림)에서 풀리는 동안
/// 다시 시작하면 기다리지 않고 새 작업을 띄우고, 늦게 끝난 옛 작업은 세대가 달라 새 작업 자리를 비우지 않는다.
/// 두 작업이 잠시 겹쳐도 같은 행은 claim lease 와 LinkReads 가 한 번만 읽게 한다
@MainActor public final class RestartableTask {
  private var task: Task<Void, Never>?
  private var gen = 0

  public init() {}

  /// 취소되지 않은 작업이 돌고 있다
  public var isRunning: Bool { task.map { !$0.isCancelled } ?? false }

  /// 돌고 있으면(취소되지 않았으면) 그대로 두고 false
  @discardableResult public func start(_ work: @escaping @MainActor () async -> Void) -> Bool {
    if isRunning { return false }
    gen += 1
    let g = gen
    task = Task { @MainActor [weak self] in
      await work()
      if let self, self.gen == g { self.task = nil }
    }
    return true
  }

  public func cancel() { task?.cancel() }
}
