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
  /// 채팅 대화 기록(스펙 §9, 앱 전용 Application Support — App Group 밖이라 따로 지운다)
  @discardableResult
  public static func removeChatHistory(at url: URL?) -> Int {
    guard let url, (try? FileManager.default.removeItem(at: url)) != nil else { return 0 }
    return 1
  }
  @discardableResult
  public static func runShared() -> Int {
    let chat = removeChatHistory(at: try? ChatHistoryStore.defaultURL())
    guard let c = try? AppGroup.containerURL() else { return chat }
    return chat + run(container: c, defaults: IngestSettings.shared)
  }
}
