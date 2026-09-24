import Foundation
import SQLite3

public struct CaptureItem: Codable, Equatable, Sendable {
  public var id: String; public var source: String; public var appName: String?; public var sender: String?
  public var title: String?; public var text: String; public var localFile: String?; public var ocrText: String?
  public var capturedAt: Date; public var attempts: Int
  /// 스펙 §6 `device_filter`: "fm" = 기기 FM 분류 통과, "rules" = FM 불가·타임아웃·에러로 규칙만 통과(서버 분류에 맡김). nil = 해당 없음(공유 등)
  public var deviceFilter: String?
  public init(id: String, source: String, appName: String?, sender: String?, title: String?, text: String,
              localFile: String?, ocrText: String?, capturedAt: Date, attempts: Int, deviceFilter: String? = nil) {
    self.id = id; self.source = source; self.appName = appName; self.sender = sender; self.title = title
    self.text = text; self.localFile = localFile; self.ocrText = ocrText; self.capturedAt = capturedAt; self.attempts = attempts
    self.deviceFilter = deviceFilter
  }
}

/// 연결 하나를 감싼다. 앱·확장·같은 앱의 여러 연결이 한 파일을 동시에 쓰므로 WAL + busy_timeout 이 필수다.
public final class CaptureQueue {
  public enum Error: Swift.Error { case sqlite(String) }
  /// claim 한 항목을 다른 flush 가 다시 가져가지 못하게 막는 시간. 업로드 완료·실패 콜백이 이 값을 덮어쓴다.
  public static let lease: TimeInterval = 600
  private var db: OpaquePointer?
  private let enc = JSONEncoder(), dec = JSONDecoder()

  public init(url: URL) throws {
    guard sqlite3_open_v2(url.path, &db, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX, nil) == SQLITE_OK else {
      throw Error.sqlite(String(cString: sqlite3_errmsg(db)))
    }
    sqlite3_busy_timeout(db, 3000)            // 다른 프로세스·연결이 잠금 중이면 최대 3초 대기
    try exec("PRAGMA journal_mode=WAL")       // 읽기와 쓰기가 서로 막지 않음 (파일에 영속됨)
    try exec("PRAGMA synchronous=NORMAL")
    try exec("CREATE TABLE IF NOT EXISTS queue(id TEXT PRIMARY KEY, payload BLOB NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, created_at REAL NOT NULL, next_attempt_at REAL NOT NULL DEFAULT 0)")
    try? exec("ALTER TABLE queue ADD COLUMN next_attempt_at REAL NOT NULL DEFAULT 0")   // 이전 스키마 파일 이관
    // 잠금 중에도 접근 가능해야 함: 첫 잠금 해제 후 보호 등급 (-wal/-shm 은 컨테이너 기본 등급이 같다)
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
  /// 지금 보낼 수 있는 항목(백오프·lease 가 끝난 것). 조회만 하고 선점하지 않는다.
  public func pending(limit: Int, now: Date = Date()) throws -> [CaptureItem] {
    try select("SELECT payload, attempts FROM queue WHERE next_attempt_at <= ? ORDER BY created_at, rowid LIMIT ?") { s in
      sqlite3_bind_double(s, 1, now.timeIntervalSince1970); sqlite3_bind_int(s, 2, Int32(limit))
    }
  }
  /// 보낼 항목을 가져오면서 lease 를 건다(단일 UPDATE 라 연결·프로세스 간에도 원자적). 연속 flush 의 중복 업로드를 막는다.
  public func claim(limit: Int, now: Date = Date()) throws -> [CaptureItem] {
    let items = try select("""
      UPDATE queue SET next_attempt_at = ?1
      WHERE id IN (SELECT id FROM queue WHERE next_attempt_at <= ?2 ORDER BY created_at, rowid LIMIT ?3)
      RETURNING payload, attempts
      """) { s in
      sqlite3_bind_double(s, 1, now.timeIntervalSince1970 + Self.lease)
      sqlite3_bind_double(s, 2, now.timeIntervalSince1970); sqlite3_bind_int(s, 3, Int32(limit))
    }
    return items.sorted { $0.capturedAt < $1.capturedAt }   // RETURNING 순서는 보장되지 않는다
  }
  public func markSent(id: String) throws {
    try run("DELETE FROM queue WHERE id=?") { sqlite3_bind_text($0, 1, id, -1, Self.transient) }
  }
  /// 실패: attempts+1, 다음 시도는 30초 × 2^(이전 attempts), 상한 1시간 (스펙 §6-5 지수 재시도)
  public func markFailed(id: String, now: Date = Date()) throws {
    try run("UPDATE queue SET attempts=attempts+1, next_attempt_at = ? + min(3600, 30 * (1 << min(attempts, 7))) WHERE id=?") { s in
      sqlite3_bind_double(s, 1, now.timeIntervalSince1970); sqlite3_bind_text(s, 2, id, -1, Self.transient)
    }
  }

  /// 테스트 전용: 디코딩 불가 행(poison row) 재현
  func insertRawForTesting(id: String, payload: Data, createdAt: Double) throws {
    try run("INSERT INTO queue(id,payload,attempts,created_at) VALUES(?,?,0,?)") { s in
      sqlite3_bind_text(s, 1, id, -1, Self.transient)
      payload.withUnsafeBytes { sqlite3_bind_blob(s, 2, $0.baseAddress, Int32(payload.count), Self.transient) }
      sqlite3_bind_double(s, 3, createdAt)
    }
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
  /// (payload, attempts) 행을 읽는다. step 오류는 throw(빈 큐로 삼키지 않음), 디코딩 불가 행은 건너뛴다.
  private func select(_ sql: String, bind: (OpaquePointer) -> Void) throws -> [CaptureItem] {
    var s: OpaquePointer?
    guard sqlite3_prepare_v2(db, sql, -1, &s, nil) == SQLITE_OK, let st = s else { throw Error.sqlite(msg) }
    defer { sqlite3_finalize(st) }
    bind(st)
    var out: [CaptureItem] = []
    var rc = sqlite3_step(st)
    while rc == SQLITE_ROW {
      let len = Int(sqlite3_column_bytes(st, 0))
      if let bytes = sqlite3_column_blob(st, 0), var item = try? dec.decode(CaptureItem.self, from: Data(bytes: bytes, count: len)) {
        item.attempts = Int(sqlite3_column_int(st, 1)); out.append(item)
      }
      rc = sqlite3_step(st)
    }
    guard rc == SQLITE_DONE else { throw Error.sqlite(msg) }
    return out
  }
}
