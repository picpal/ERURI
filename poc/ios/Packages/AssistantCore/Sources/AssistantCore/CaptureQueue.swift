import Foundation
import SQLite3

public struct CaptureItem: Codable, Equatable {
  public var id: String; public var source: String; public var appName: String?; public var sender: String?
  public var title: String?; public var text: String; public var localFile: String?; public var ocrText: String?
  public var capturedAt: Date; public var attempts: Int
  public init(id: String, source: String, appName: String?, sender: String?, title: String?, text: String,
              localFile: String?, ocrText: String?, capturedAt: Date, attempts: Int) {
    self.id = id; self.source = source; self.appName = appName; self.sender = sender; self.title = title
    self.text = text; self.localFile = localFile; self.ocrText = ocrText; self.capturedAt = capturedAt; self.attempts = attempts
  }
}

public final class CaptureQueue {
  public enum Error: Swift.Error { case sqlite(String) }
  private var db: OpaquePointer?
  private let enc = JSONEncoder(), dec = JSONDecoder()

  public init(url: URL) throws {
    guard sqlite3_open_v2(url.path, &db, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX, nil) == SQLITE_OK else {
      throw Error.sqlite(String(cString: sqlite3_errmsg(db)))
    }
    try exec("CREATE TABLE IF NOT EXISTS queue(id TEXT PRIMARY KEY, payload BLOB NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, created_at REAL NOT NULL)")
    // 잠금 중에도 접근 가능해야 함: 첫 잠금 해제 후 보호 등급
    try? FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: url.path)
  }
  deinit { sqlite3_close(db) }

  public static func shared() throws -> CaptureQueue {
    try CaptureQueue(url: try AppGroup.containerURL().appendingPathComponent("queue.sqlite"))
  }

  public func enqueue(_ item: CaptureItem) throws {
    let data = try enc.encode(item)
    try run("INSERT OR IGNORE INTO queue(id,payload,attempts,created_at) VALUES(?,?,?,?)") { s in
      sqlite3_bind_text(s, 1, item.id, -1, Self.transient)
      data.withUnsafeBytes { sqlite3_bind_blob(s, 2, $0.baseAddress, Int32(data.count), Self.transient) }
      sqlite3_bind_int(s, 3, Int32(item.attempts))
      sqlite3_bind_double(s, 4, item.capturedAt.timeIntervalSince1970)
    }
  }
  public func pending(limit: Int) throws -> [CaptureItem] {
    var out: [CaptureItem] = []
    var s: OpaquePointer?
    guard sqlite3_prepare_v2(db, "SELECT payload, attempts FROM queue ORDER BY created_at LIMIT ?", -1, &s, nil) == SQLITE_OK else { throw Error.sqlite(msg) }
    defer { sqlite3_finalize(s) }
    sqlite3_bind_int(s, 1, Int32(limit))
    while sqlite3_step(s) == SQLITE_ROW {
      let bytes = sqlite3_column_blob(s, 0), len = sqlite3_column_bytes(s, 0)
      var item = try dec.decode(CaptureItem.self, from: Data(bytes: bytes!, count: Int(len)))
      item.attempts = Int(sqlite3_column_int(s, 1))
      out.append(item)
    }
    return out
  }
  public func markSent(id: String) throws {
    try run("DELETE FROM queue WHERE id=?") { sqlite3_bind_text($0, 1, id, -1, Self.transient) }
  }
  public func markFailed(id: String) throws {
    try run("UPDATE queue SET attempts=attempts+1 WHERE id=?") { sqlite3_bind_text($0, 1, id, -1, Self.transient) }
  }

  private static let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
  private var msg: String { String(cString: sqlite3_errmsg(db)) }
  private func exec(_ sql: String) throws { guard sqlite3_exec(db, sql, nil, nil, nil) == SQLITE_OK else { throw Error.sqlite(msg) } }
  private func run(_ sql: String, bind: (OpaquePointer) -> Void) throws {
    var s: OpaquePointer?
    guard sqlite3_prepare_v2(db, sql, -1, &s, nil) == SQLITE_OK, let st = s else { throw Error.sqlite(msg) }
    defer { sqlite3_finalize(st) }
    bind(st)
    guard sqlite3_step(st) == SQLITE_DONE else { throw Error.sqlite(msg) }
  }
}
