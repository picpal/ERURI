import XCTest
@testable import AssistantCore
final class CaptureQueueTests: XCTestCase {
  func tempURL() -> URL {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".sqlite")
    addTeardownBlock {
      for suffix in ["", "-wal", "-shm"] { try? FileManager.default.removeItem(atPath: url.path + suffix) }
    }
    return url
  }
  func makeQueue() throws -> CaptureQueue { try CaptureQueue(url: tempURL()) }
  static func item(_ text: String, at date: Date = Date()) -> CaptureItem {
    CaptureItem(id: UUID().uuidString, source: "NOTIFICATION", appName: "KakaoTalk", sender: nil, title: nil,
                text: text, localFile: nil, ocrText: nil, capturedAt: date, attempts: 0)
  }
  func testEnqueueAndPending() throws {
    let q = try makeQueue()
    try q.enqueue(Self.item("a")); try q.enqueue(Self.item("b"))
    XCTAssertEqual(try q.pending(limit: 10).map(\.text), ["a", "b"])
  }
  func testSameTimestampKeepsInsertOrder() throws {
    let q = try makeQueue(); let t = Date()
    for s in ["a", "b", "c", "d"] { try q.enqueue(Self.item(s, at: t)) }
    XCTAssertEqual(try q.pending(limit: 10).map(\.text), ["a", "b", "c", "d"])
  }
  func testMarkSentRemoves() throws {
    let q = try makeQueue(); let i = Self.item("a")
    try q.enqueue(i); try q.markSent(id: i.id)
    XCTAssertTrue(try q.pending(limit: 10).isEmpty)
  }
  func testMarkFailedIncrementsAttempts() throws {
    let q = try makeQueue(); let i = Self.item("a"); let t0 = Date()
    try q.enqueue(i); try q.markFailed(id: i.id, now: t0)
    XCTAssertEqual(try q.pending(limit: 10, now: t0 + 3600).first?.attempts, 1)
  }
  func testSurvivesReopen() throws {
    let url = tempURL()
    try CaptureQueue(url: url).enqueue(Self.item("persist"))
    XCTAssertEqual(try CaptureQueue(url: url).pending(limit: 1).first?.text, "persist")
  }
  // Q-1: 앱·확장이 같은 파일을 동시에 쓰면 BUSY 없이 모두 남아야 한다
  func testConcurrentWritersFromTwoConnections() throws {
    let url = tempURL()
    // 의도적으로 연결을 스레드 간에 공유한다(SQLITE_OPEN_FULLMUTEX 가 연결 단위 직렬화를 보장)
    nonisolated(unsafe) let a = try CaptureQueue(url: url), b = try CaptureQueue(url: url)
    let failures = Failures()
    DispatchQueue.concurrentPerform(iterations: 200) { i in
      do { try (i % 2 == 0 ? a : b).enqueue(CaptureQueueTests.item("\(i)")) } catch { failures.add("\(error)") }
    }
    XCTAssertEqual(failures.all, [])
    XCTAssertEqual(try a.pending(limit: 500).count, 200)
  }
  // Q-3: 실패 후 지수 백오프(30초 × 2^n, 상한 1시간)
  func testMarkFailedBacksOff() throws {
    let q = try makeQueue(); let i = Self.item("a"); let t0 = Date()
    try q.enqueue(i); try q.markFailed(id: i.id, now: t0)
    XCTAssertTrue(try q.pending(limit: 10, now: t0).isEmpty)
    XCTAssertEqual(try q.pending(limit: 10, now: t0 + 31).map(\.id), [i.id])
    try q.markFailed(id: i.id, now: t0 + 31)
    XCTAssertTrue(try q.pending(limit: 10, now: t0 + 31 + 59).isEmpty)
    XCTAssertEqual(try q.pending(limit: 10, now: t0 + 31 + 61).count, 1)
    for _ in 0..<20 { try q.markFailed(id: i.id, now: t0) }
    XCTAssertEqual(try q.pending(limit: 10, now: t0 + 3601).count, 1, "상한 1시간")
  }
  // Task 7 관찰: 연속 flush 가 같은 항목을 두 번 올리지 않도록 claim 이 lease 를 잡는다
  func testClaimLeasesItemsSoSecondClaimIsEmpty() throws {
    let q = try makeQueue(); let t0 = Date()
    try q.enqueue(Self.item("a")); try q.enqueue(Self.item("b"))
    XCTAssertEqual(try q.claim(limit: 10, now: t0).map(\.text), ["a", "b"])
    XCTAssertTrue(try q.claim(limit: 10, now: t0 + 1).isEmpty)
    XCTAssertEqual(try q.claim(limit: 10, now: t0 + CaptureQueue.lease + 1).count, 2, "lease 만료 후 재시도 가능")
  }
  func testClaimFromTwoConnectionsNeverDuplicates() throws {
    let url = tempURL()
    // 의도적으로 연결을 스레드 간에 공유한다(SQLITE_OPEN_FULLMUTEX 가 연결 단위 직렬화를 보장)
    nonisolated(unsafe) let a = try CaptureQueue(url: url), b = try CaptureQueue(url: url)
    for n in 0..<100 { try a.enqueue(Self.item("\(n)")) }
    let ids = Failures()
    DispatchQueue.concurrentPerform(iterations: 20) { i in
      if let got = try? (i % 2 == 0 ? a : b).claim(limit: 7) { got.forEach { ids.add($0.id) } }
    }
    XCTAssertEqual(ids.all.count, 100)
    XCTAssertEqual(Set(ids.all).count, 100)
  }
  func testMarkFailedAfterClaimUsesBackoffNotLease() throws {
    let q = try makeQueue(); let i = Self.item("a"); let t0 = Date()
    try q.enqueue(i)
    _ = try q.claim(limit: 1, now: t0)
    try q.markFailed(id: i.id, now: t0)
    XCTAssertEqual(try q.claim(limit: 1, now: t0 + 31).map(\.id), [i.id])
  }
  // Q-2: 디코딩 불가 행 하나가 큐 전체를 막지 않는다
  func testPoisonRowSkipped() throws {
    let url = tempURL()
    let q = try CaptureQueue(url: url)
    try q.enqueue(Self.item("good"))
    try q.insertRawForTesting(id: "poison", payload: Data("not json".utf8), createdAt: 0)
    XCTAssertEqual(try q.pending(limit: 10).map(\.text), ["good"])
  }
}

final class Failures: @unchecked Sendable {   // 테스트 전용 수집기: NSLock 으로 보호
  private let lock = NSLock(); private var items: [String] = []
  func add(_ s: String) { lock.lock(); items.append(s); lock.unlock() }
  var all: [String] { lock.lock(); defer { lock.unlock() }; return items }
}
