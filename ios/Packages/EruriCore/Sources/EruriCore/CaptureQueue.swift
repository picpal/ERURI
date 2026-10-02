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
  /// 링크 대기 행 보관 상한(스펙 §6 이어받기 — 기기에 주소·메모가 무기한 남지 않게)
  public static let linkMaxAge: TimeInterval = 7 * 86_400
  /// 읽은 링크 기록(캡처 id 만) 보관 기간(스펙 §6 "같은 링크")
  public static let linkSeenFor: TimeInterval = 30 * 86_400
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
    // 진단 trace(`Trace`)도 같은 큐·재시도 규칙을 쓰되 kind 로 나눠 캡처 업로드와 섞이지 않게 한다
    try? exec("ALTER TABLE queue ADD COLUMN kind TEXT NOT NULL DEFAULT 'capture'")
    // 읽은 링크(스펙 §6 "같은 링크"): 캡처 id(주소의 해시)와 만료 시각만 — 주소는 두지 않는다
    try exec("CREATE TABLE IF NOT EXISTS link_seen(id TEXT PRIMARY KEY, until REAL NOT NULL)")
    // 잠금 중(인텐트·무음 푸시·BG refresh)에도 열 수 있어야 함: 첫 잠금 해제 후 보호 등급. -wal/-shm 도 명시한다
    for suffix in ["", "-wal", "-shm"] where FileManager.default.fileExists(atPath: url.path + suffix) {
      try? FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: url.path + suffix)
    }
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
    try select("SELECT payload, attempts FROM queue WHERE kind = 'capture' AND next_attempt_at <= ? ORDER BY created_at, rowid LIMIT ?") { s in
      sqlite3_bind_double(s, 1, now.timeIntervalSince1970); sqlite3_bind_int(s, 2, Int32(limit))
    }
  }
  /// 보낼 항목을 가져오면서 lease 를 건다(단일 UPDATE 라 연결·프로세스 간에도 원자적). 연속 flush 의 중복 업로드를 막는다.
  public func claim(limit: Int, now: Date = Date()) throws -> [CaptureItem] {
    let items = try select("""
      UPDATE queue SET next_attempt_at = ?1
      WHERE id IN (SELECT id FROM queue WHERE kind = 'capture' AND next_attempt_at <= ?2 ORDER BY created_at, rowid LIMIT ?3)
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

  // MARK: - 진단 trace (kind = 'trace', payload 는 `Trace.payload` 가 만든 JSON 객체)

  public func enqueueTrace(id: String, payload: Data, at: Date) throws {
    try run("INSERT OR IGNORE INTO queue(id,payload,attempts,created_at,kind) VALUES(?,?,0,?,'trace')") { s in
      sqlite3_bind_text(s, 1, id, -1, Self.transient)
      payload.withUnsafeBytes { sqlite3_bind_blob(s, 2, $0.baseAddress, Int32(payload.count), Self.transient) }
      sqlite3_bind_double(s, 3, at.timeIntervalSince1970)
    }
  }
  /// claim 과 같은 lease 규칙으로 trace 를 가져온다(ingest/trace 한 배치 최대 200건).
  public func claimTraces(limit: Int, now: Date = Date()) throws -> [(id: String, payload: Data)] {
    var s: OpaquePointer?
    let sql = """
      UPDATE queue SET next_attempt_at = ?1
      WHERE id IN (SELECT id FROM queue WHERE kind = 'trace' AND next_attempt_at <= ?2 ORDER BY created_at, rowid LIMIT ?3)
      RETURNING id, payload, created_at
      """
    guard sqlite3_prepare_v2(db, sql, -1, &s, nil) == SQLITE_OK, let st = s else { throw Error.sqlite(msg) }
    defer { sqlite3_finalize(st) }
    sqlite3_bind_double(st, 1, now.timeIntervalSince1970 + Self.lease)
    sqlite3_bind_double(st, 2, now.timeIntervalSince1970); sqlite3_bind_int(st, 3, Int32(limit))
    var out: [(id: String, payload: Data, at: Double)] = []
    var rc = sqlite3_step(st)
    while rc == SQLITE_ROW {
      let id = String(cString: sqlite3_column_text(st, 0))
      let len = Int(sqlite3_column_bytes(st, 1))
      let data = sqlite3_column_blob(st, 1).map { Data(bytes: $0, count: len) } ?? Data()
      out.append((id, data, sqlite3_column_double(st, 2)))
      rc = sqlite3_step(st)
    }
    guard rc == SQLITE_DONE else { throw Error.sqlite(msg) }
    return out.sorted { $0.at < $1.at }.map { ($0.id, $0.payload) }   // RETURNING 순서는 보장되지 않는다
  }
  // MARK: - 링크 대기 행 (kind = 'link', payload = PendingLink JSON, 스펙 §6 "확장과 앱의 이어받기")

  /// 렌더링 전에 남긴다. lease 동안은 앱이 가져가지 않는다(확장이 죽으면 lease 뒤 앱이 이어받는다). 캡처 claim·pending 은 kind = 'capture' 만 본다.
  /// 같은 주소 = 같은 id(D14) — 행이 이미 있으면(확장이 죽어 남은 행을 다시 공유) 사용자가 다시 시도한 것이라 새 행처럼 건다(payload·lease·created_at 갱신, attempts 0 — 7일 만료가 재공유를 지우지 않게, L2 리뷰 I1).
  /// 7일 지난 행은 이때도 지운다(앱이 열리지 않아도 주소·메모가 7일을 넘겨 남지 않게)
  public func enqueueLink(_ l: PendingLink, lease: TimeInterval, now: Date = Date()) throws {
    let data = try enc.encode(l)
    try deleteExpiredLinks(now: now)
    try run("""
      INSERT INTO queue(id,payload,attempts,created_at,next_attempt_at,kind) VALUES(?1,?2,0,?3,?4,'link')
      ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, next_attempt_at = excluded.next_attempt_at,
        created_at = excluded.created_at, attempts = 0
      """) { s in
      sqlite3_bind_text(s, 1, l.id, -1, Self.transient)
      data.withUnsafeBytes { sqlite3_bind_blob(s, 2, $0.baseAddress, Int32(data.count), Self.transient) }
      sqlite3_bind_double(s, 3, now.timeIntervalSince1970)
      sqlite3_bind_double(s, 4, now.timeIntervalSince1970 + lease)
    }
  }
  /// 앱에 넘긴다(확장) / 그대로 돌려놓는다(앱이 비활성 — 취소): lease 를 지금으로(다음 foreground 가 바로 가져간다)
  public func releaseLink(id: String, now: Date = Date()) throws {
    try run("UPDATE queue SET next_attempt_at = ? WHERE id = ? AND kind = 'link'") { s in
      sqlite3_bind_double(s, 1, now.timeIntervalSince1970); sqlite3_bind_text(s, 2, id, -1, Self.transient)
    }
  }
  /// 앱(foreground): 처리할 링크를 캡처와 같은 lease(600초)로 가져온다. 7일 지난 행·읽을 수 없는 행은 지운다(큐를 막지 않게). attempts 는 열에서 채운다
  public func claimLinks(limit: Int, now: Date = Date()) throws -> [PendingLink] {
    try deleteExpiredLinks(now: now)
    var s: OpaquePointer?
    let sql = """
      UPDATE queue SET next_attempt_at = ?1
      WHERE id IN (SELECT id FROM queue WHERE kind = 'link' AND next_attempt_at <= ?2 ORDER BY created_at, rowid LIMIT ?3)
      RETURNING id, payload, attempts
      """
    guard sqlite3_prepare_v2(db, sql, -1, &s, nil) == SQLITE_OK, let st = s else { throw Error.sqlite(msg) }
    sqlite3_bind_double(st, 1, now.timeIntervalSince1970 + Self.lease)
    sqlite3_bind_double(st, 2, now.timeIntervalSince1970); sqlite3_bind_int(st, 3, Int32(limit))
    var out: [PendingLink] = [], poison: [String] = []
    var rc = sqlite3_step(st)
    while rc == SQLITE_ROW {
      let id = String(cString: sqlite3_column_text(st, 0))
      let len = Int(sqlite3_column_bytes(st, 1))
      if let b = sqlite3_column_blob(st, 1), var l = try? dec.decode(PendingLink.self, from: Data(bytes: b, count: len)) {
        l.attempts = Int(sqlite3_column_int(st, 2)); out.append(l)
      } else { poison.append(id) }
      rc = sqlite3_step(st)
    }
    let err = rc == SQLITE_DONE ? nil : msg
    sqlite3_finalize(st)                                                          // 아래 삭제 전에 문장을 끝낸다
    if let err { throw Error.sqlite(err) }
    for id in poison { try markSent(id: id) }
    return out.sorted { $0.capturedAt < $1.capturedAt }                          // RETURNING 순서는 보장되지 않는다
  }
  private func deleteExpiredLinks(now: Date) throws {
    try run("DELETE FROM queue WHERE kind = 'link' AND created_at < ?") { sqlite3_bind_double($0, 1, now.timeIntervalSince1970 - Self.linkMaxAge) }
  }
  /// 남은 링크 행 중 가장 이른 다음 시도 시각(lease·백오프). 없으면 nil — 앱이 활성 상태에서 다시 볼 때를 정한다
  public func nextLinkAttempt() throws -> Date? {
    var s: OpaquePointer?
    guard sqlite3_prepare_v2(db, "SELECT min(next_attempt_at) FROM queue WHERE kind = 'link'", -1, &s, nil) == SQLITE_OK, let st = s else { throw Error.sqlite(msg) }
    defer { sqlite3_finalize(st) }
    guard sqlite3_step(st) == SQLITE_ROW else { throw Error.sqlite(msg) }
    return sqlite3_column_type(st, 0) == SQLITE_NULL ? nil : Date(timeIntervalSince1970: sqlite3_column_double(st, 0))
  }
  public func linkCount() throws -> Int { try count("link") }

  /// 읽은 링크 기록(스펙 §6 "같은 링크"): 큐 항목을 넣은 링크의 캡처 id 를 30일 둔다. 지난 기록은 이때 지운다
  public func markLinkSeen(captureID: String, now: Date = Date()) throws {
    try run("DELETE FROM link_seen WHERE until < ?") { sqlite3_bind_double($0, 1, now.timeIntervalSince1970) }
    try run("INSERT OR REPLACE INTO link_seen(id, until) VALUES(?, ?)") { s in
      sqlite3_bind_text(s, 1, captureID, -1, Self.transient); sqlite3_bind_double(s, 2, now.timeIntervalSince1970 + Self.linkSeenFor)
    }
  }
  public func isLinkSeen(captureID: String, now: Date = Date()) throws -> Bool {
    var s: OpaquePointer?
    guard sqlite3_prepare_v2(db, "SELECT 1 FROM link_seen WHERE id = ? AND until > ?", -1, &s, nil) == SQLITE_OK, let st = s else { throw Error.sqlite(msg) }
    defer { sqlite3_finalize(st) }
    sqlite3_bind_text(st, 1, captureID, -1, Self.transient); sqlite3_bind_double(st, 2, now.timeIntervalSince1970)
    return sqlite3_step(st) == SQLITE_ROW
  }

  /// 테스트 전용: 디코딩 불가 링크 행
  func insertRawLinkForTesting(id: String, payload: Data) throws {
    try run("INSERT INTO queue(id,payload,attempts,created_at,kind) VALUES(?,?,0,?,'link')") { s in
      sqlite3_bind_text(s, 1, id, -1, Self.transient)
      payload.withUnsafeBytes { sqlite3_bind_blob(s, 2, $0.baseAddress, Int32(payload.count), Self.transient) }
      sqlite3_bind_double(s, 3, Date().timeIntervalSince1970)
    }
  }

  /// 진단 전송을 끌 때 큐의 trace 를 모두 지운다(스펙 §8)
  public func purgeTraces() throws { try exec("DELETE FROM queue WHERE kind = 'trace'") }
  /// 캡처 행 수(lease 중인 것 포함). BG refresh 가 깨어났을 때 flush 할지 판단한다.
  public func captureCount() throws -> Int { try count("capture") }
  public func traceCount() throws -> Int { try count("trace") }
  private func count(_ kind: String) throws -> Int {
    var s: OpaquePointer?
    guard sqlite3_prepare_v2(db, "SELECT count(*) FROM queue WHERE kind = ?", -1, &s, nil) == SQLITE_OK, let st = s else { throw Error.sqlite(msg) }
    defer { sqlite3_finalize(st) }
    sqlite3_bind_text(st, 1, kind, -1, Self.transient)
    guard sqlite3_step(st) == SQLITE_ROW else { throw Error.sqlite(msg) }
    return Int(sqlite3_column_int(st, 0))
  }
  public func markSent(ids: [String]) throws { for id in ids { try markSent(id: id) } }
  public func markFailed(ids: [String], now: Date = Date()) throws { for id in ids { try markFailed(id: id, now: now) } }
  /// background 세션에 넘긴 배치의 lease 를 늘린다(완료 콜백 전 재claim 방지). 이미 더 늦으면 그대로 둔다
  public func extendLease(ids: [String], until: Date) throws {
    for id in ids {
      try run("UPDATE queue SET next_attempt_at = max(next_attempt_at, ?) WHERE id = ?") { s in
        sqlite3_bind_double(s, 1, until.timeIntervalSince1970); sqlite3_bind_text(s, 2, id, -1, Self.transient)
      }
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
