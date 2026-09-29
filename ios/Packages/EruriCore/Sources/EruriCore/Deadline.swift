import Foundation

/// 마감이 있는 비동기 작업(스펙 §10 알림 액션 핸들러의 네트워크 구간). 마감이 지나면 nil 을 돌려주고 작업은 취소만 한다.
/// 취소를 무시하는 작업(예: 공유 Task 를 기다리는 토큰 갱신)도 기다리지 않는다 — withTaskGroup 은 늦은 자식이 끝날 때까지
/// 스코프를 닫지 않으므로 쓰지 않는다. 늦게 끝난 작업의 결과는 버린다
public enum Deadline {
  public static func run<T: Sendable>(seconds: TimeInterval, _ op: @escaping @Sendable () async -> T?) async -> T? {
    let race = Race<T>()
    return await withTaskCancellationHandler {
      await withCheckedContinuation { k in
        race.start(k, op: op, seconds: seconds)
      }
    } onCancel: {
      race.finish(nil)
    }
  }
}

/// 먼저 끝난 쪽(작업·타이머·호출자 취소)이 continuation 을 정확히 1번 재개하고 나머지를 취소한다
private final class Race<T: Sendable>: @unchecked Sendable {
  private let lock = NSLock()
  private var continuation: CheckedContinuation<T?, Never>?
  private var tasks: [Task<Void, Never>] = []
  private var done = false

  func start(_ k: CheckedContinuation<T?, Never>, op: @escaping @Sendable () async -> T?, seconds: TimeInterval) {
    lock.lock()
    defer { lock.unlock() }
    if done { k.resume(returning: nil); return }            // 시작 전에 호출자가 취소됨
    continuation = k
    // 두 Task 의 finish 는 이 lock 이 풀린 뒤에 들어오므로 tasks 가 채워진 상태를 본다
    tasks = [Task { self.finish(await op()) },
             Task { try? await Task.sleep(for: .seconds(seconds)); self.finish(nil) }]
  }

  func finish(_ value: T?) {
    lock.lock()
    if done { lock.unlock(); return }
    done = true
    let k = continuation, ts = tasks
    continuation = nil; tasks = []
    lock.unlock()
    ts.forEach { $0.cancel() }
    k?.resume(returning: value)
  }
}
