import Foundation

/// 계정 전체 삭제 뒤 기기 정리(스펙 §8 "기기에 삭제 푸시(로컬 큐·executions 정리)"). 서버 데이터는 이미 지워졌다.
/// `outbox` 는 background 업로드 대기 본문(Outbox)이라 큐와 함께 지운다
public enum LocalWipe {
  static let names = ["queue.sqlite", "queue.sqlite-wal", "queue.sqlite-shm", "executions.sqlite", "eruri.log", "bfu.log", "contacts.json",
                      "inbox", Outbox.dir]

  @discardableResult
  public static func run(container: URL, defaults: UserDefaults) -> Int {
    var n = 0
    for name in names where (try? FileManager.default.removeItem(at: container.appendingPathComponent(name))) != nil { n += 1 }
    for k in defaults.dictionaryRepresentation().keys { defaults.removeObject(forKey: k) }
    return n
  }
  @discardableResult
  public static func runShared() -> Int {
    guard let c = try? AppGroup.containerURL() else { return 0 }
    return run(container: c, defaults: IngestSettings.shared)
  }
}
