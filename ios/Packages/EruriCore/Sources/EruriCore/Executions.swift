import Foundation
import SQLite3

public final class Executions {
  public enum Error: Swift.Error { case sqlite(String) }
  private var db: OpaquePointer?
  private static let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
  private var msg: String { String(cString: sqlite3_errmsg(db)) }

  public init(url: URL) throws {
    guard sqlite3_open_v2(url.path, &db, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX, nil) == SQLITE_OK else { throw Error.sqlite(String(cString: sqlite3_errmsg(db))) }
    guard sqlite3_exec(db, "CREATE TABLE IF NOT EXISTS executions(proposal_id TEXT PRIMARY KEY, eventkit_id TEXT NOT NULL, executed_at REAL NOT NULL, reported INTEGER NOT NULL DEFAULT 0)", nil, nil, nil) == SQLITE_OK else { throw Error.sqlite(msg) }
  }
  deinit { sqlite3_close(db) }
  public static func shared() throws -> Executions { try Executions(url: try AppGroup.containerURL().appendingPathComponent("executions.sqlite")) }

  public func existing(proposalId: String) throws -> String? {
    var s: OpaquePointer?; defer { sqlite3_finalize(s) }
    guard sqlite3_prepare_v2(db, "SELECT eventkit_id FROM executions WHERE proposal_id=?", -1, &s, nil) == SQLITE_OK else { throw Error.sqlite(msg) }
    sqlite3_bind_text(s, 1, proposalId, -1, Self.transient)
    return sqlite3_step(s) == SQLITE_ROW ? String(cString: sqlite3_column_text(s, 0)) : nil
  }
  public func record(proposalId: String, eventkitId: String) throws {
    try run("INSERT OR IGNORE INTO executions(proposal_id,eventkit_id,executed_at) VALUES(?,?,?)") { s in
      sqlite3_bind_text(s, 1, proposalId, -1, Self.transient); sqlite3_bind_text(s, 2, eventkitId, -1, Self.transient); sqlite3_bind_double(s, 3, Date().timeIntervalSince1970)
    }
  }
  public func unreported() throws -> [(proposalId: String, eventkitId: String)] {
    var s: OpaquePointer?; defer { sqlite3_finalize(s) }
    guard sqlite3_prepare_v2(db, "SELECT proposal_id, eventkit_id FROM executions WHERE reported=0", -1, &s, nil) == SQLITE_OK else { throw Error.sqlite(msg) }
    var out: [(String, String)] = []
    while sqlite3_step(s) == SQLITE_ROW { out.append((String(cString: sqlite3_column_text(s, 0)), String(cString: sqlite3_column_text(s, 1)))) }
    return out.map { (proposalId: $0.0, eventkitId: $0.1) }
  }
  public func markReported(proposalId: String) throws {
    try run("UPDATE executions SET reported=1 WHERE proposal_id=?") { sqlite3_bind_text($0, 1, proposalId, -1, Self.transient) }
  }
  private func run(_ sql: String, bind: (OpaquePointer) -> Void) throws {
    var s: OpaquePointer?
    guard sqlite3_prepare_v2(db, sql, -1, &s, nil) == SQLITE_OK, let st = s else { throw Error.sqlite(msg) }
    defer { sqlite3_finalize(st) }
    bind(st)
    guard sqlite3_step(st) == SQLITE_DONE else { throw Error.sqlite(msg) }
  }
}
