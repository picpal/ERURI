import XCTest
@testable import AssistantCore
final class PoCLogTests: XCTestCase {
  // 재실측 중 발견: 동시 액션 두 건의 로그 한 줄이 사라졌다(seek→write 경쟁). O_APPEND 는 줄을 잃지 않아야 한다.
  func testConcurrentAppendsKeepEveryLine() throws {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".log")
    addTeardownBlock { try? FileManager.default.removeItem(at: url) }
    DispatchQueue.concurrentPerform(iterations: 200) { i in PoCLog.appendLine("line \(i)", to: url, create: true) }
    let lines = try String(contentsOf: url, encoding: .utf8).split(separator: "\n")
    XCTAssertEqual(lines.count, 200)
  }
}
