import XCTest
@testable import EruriCore

/// 스펙 §8 전체 삭제: 기기에 삭제 푸시 → 로컬 큐·executions·공유 inbox·로그·연락처 캐시·App Group 설정 정리
final class LocalWipeTests: XCTestCase {
  func testRemovesLocalStoresAndDefaults() throws {
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
    try FileManager.default.createDirectory(at: dir.appendingPathComponent("inbox"), withIntermediateDirectories: true)
    for f in ["queue.sqlite", "queue.sqlite-wal", "executions.sqlite", "eruri.log", "contacts.json", "inbox/a.jpg"] {
      FileManager.default.createFile(atPath: dir.appendingPathComponent(f).path, contents: Data("x".utf8))
    }
    let name = "wipe-\(UUID().uuidString)", d = UserDefaults(suiteName: name)!
    addTeardownBlock { UserDefaults(suiteName: name)?.removePersistentDomain(forName: name); try? FileManager.default.removeItem(at: dir) }  // Swift 6: 이름만 캡처
    d.set("aa", forKey: "apnsToken"); d.set(true, forKey: "diagnosticsEnabled")
    XCTAssertEqual(LocalWipe.run(container: dir, defaults: d), 6)                 // 파일 5 + inbox 폴더 1
    for f in ["queue.sqlite", "executions.sqlite", "eruri.log", "contacts.json", "inbox"] {
      XCTAssertFalse(FileManager.default.fileExists(atPath: dir.appendingPathComponent(f).path), f)
    }
    XCTAssertNil(d.string(forKey: "apnsToken"))
  }
  func testRemoveChatHistoryDeletesTheAppOnlyFile() throws {
    let u = FileManager.default.temporaryDirectory.appendingPathComponent("chat-\(UUID().uuidString).json")
    try Data("{}".utf8).write(to: u)
    XCTAssertEqual(LocalWipe.removeChatHistory(at: u), 1)
    XCTAssertFalse(FileManager.default.fileExists(atPath: u.path))
    XCTAssertEqual(LocalWipe.removeChatHistory(at: u), 0)
    XCTAssertEqual(LocalWipe.removeChatHistory(at: nil), 0)
  }
}
