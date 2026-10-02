import XCTest
@testable import EruriCore

/// 앱 이어받기 drain 의 시작·취소(L5 리뷰 I1): 취소된 작업이 아직 풀리는 중(업로드 flush 등 await)이어도 다시 시작하면 새 작업이 뜬다
final class RestartableTaskTests: XCTestCase {
  /// 열어 줄 때까지 취소와 무관하게 붙잡는 작업(취소된 drain 이 flush 를 기다리는 동안 흉내)
  @MainActor final class Gate {
    var open = false
    private(set) var started = 0, finished = 0
    func work() async {
      started += 1
      while !open { try? await Task.sleep(for: .milliseconds(10)) }
      finished += 1
    }
  }

  @MainActor private func until(_ cond: @MainActor () -> Bool, file: StaticString = #filePath, line: UInt = #line) async {
    for _ in 0..<500 where !cond() { try? await Task.sleep(for: .milliseconds(10)) }
    XCTAssertTrue(cond(), file: file, line: line)
  }

  @MainActor func testSecondStartWhileRunningIsIgnored() async {
    let r = RestartableTask(), g = Gate()
    XCTAssertTrue(r.start { await g.work() })
    XCTAssertFalse(r.start { await g.work() })
    await until { g.started == 1 }
    g.open = true
    await until { !r.isRunning }
    XCTAssertEqual(g.started, 1)
    XCTAssertTrue(r.start { await g.work() })                                   // 끝나면 다시 시작한다
    await until { g.finished == 2 }
  }

  /// 비활성 → 곧바로 활성: 옛 작업이 풀리기 전에 다시 시작해도 새 작업이 뜨고, 늦게 끝난 옛 작업이 새 작업 자리를 비우지 않는다
  @MainActor func testRestartWhileCancelledWorkIsUnwinding() async {
    let r = RestartableTask(), old = Gate(), new = Gate()
    XCTAssertTrue(r.start { await old.work() })
    await until { old.started == 1 }
    r.cancel()
    XCTAssertFalse(r.isRunning)
    XCTAssertTrue(r.start { await new.work() })
    await until { new.started == 1 }
    old.open = true
    await until { old.finished == 1 }
    try? await Task.sleep(for: .milliseconds(50))
    XCTAssertTrue(r.isRunning)                                                  // 옛 작업이 끝났어도 새 작업은 그대로 돈다
    XCTAssertFalse(r.start { await new.work() })                                // 그래서 세 번째는 붙지 않는다
    new.open = true
    await until { !r.isRunning }
    XCTAssertEqual(new.started, 1)
  }
}
