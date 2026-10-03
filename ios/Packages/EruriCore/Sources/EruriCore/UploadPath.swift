import Foundation

/// 캡처 업로드가 어느 경로로 서버에 닿았는지(`upload.done.path`).
/// 트리거(무엇이 flush 를 깨웠나)와 전송 수단(프로세스 안 직접 요청 / background URLSession)으로 정해진다.
public enum UploadTrigger: String, Sendable, CaseIterable {
  case intent, silentPush = "silent_push", bgRefresh = "bg_refresh", foreground
}

public enum UploadPath: String, Sendable, CaseIterable {
  case intentDirect = "intent_direct", bgUpload = "bg_upload", silentPush = "silent_push", bgRefresh = "bg_refresh", foreground

  /// 인텐트: 실행 중 직접 요청이 끝나면 `intent_direct`, background 세션에 넘겨 iOS 가 끝냈으면 `bg_upload`.
  /// 그 외 트리거는 트리거 이름 그대로(전송 수단은 `via` 필드로 따로 남긴다).
  public static func resolve(trigger: UploadTrigger, viaBackgroundSession: Bool) -> UploadPath {
    switch trigger {
    case .intent: return viaBackgroundSession ? .bgUpload : .intentDirect
    case .silentPush: return .silentPush
    case .bgRefresh: return .bgRefresh
    case .foreground: return .foreground
    }
  }
}

/// background 세션 업로드 태스크의 `taskDescription`. 앱이 재실행돼 완료 콜백만 받아도 경로·지연을 판정할 수 있게
/// 항목 id·트리거·캡처 시각·인텐트 시작 시점 잠금 여부를 담는다. 형식: `cap|<id>|<trigger>|<capturedAt epoch ms>|<locked 0/1/->`
public struct UploadTag: Equatable, Sendable {
  public static let prefix = "cap|"
  public var id: String, trigger: UploadTrigger, capturedAt: Date, locked: Bool?
  public init(id: String, trigger: UploadTrigger, capturedAt: Date, locked: Bool?) {
    self.id = id; self.trigger = trigger; self.capturedAt = capturedAt; self.locked = locked
  }

  public var encoded: String {
    let l = locked.map { $0 ? "1" : "0" } ?? "-"
    return Self.prefix + [id, trigger.rawValue, String(Int64((capturedAt.timeIntervalSince1970 * 1000).rounded())), l].joined(separator: "|")
  }

  /// 0.1.x 가 남긴 태스크(설명 = 항목 id)는 nil. 호출 쪽이 id 만으로 처리한다.
  public static func decode(_ s: String) -> UploadTag? {
    guard s.hasPrefix(prefix) else { return nil }
    let p = s.dropFirst(prefix.count).split(separator: "|", omittingEmptySubsequences: false).map(String.init)
    guard p.count == 4, !p[0].isEmpty, let t = UploadTrigger(rawValue: p[1]), let ms = Int64(p[2]) else { return nil }
    let locked: Bool? = p[3] == "1" ? true : p[3] == "0" ? false : nil
    return UploadTag(id: p[0], trigger: t, capturedAt: Date(timeIntervalSince1970: Double(ms) / 1000), locked: locked)
  }
}

/// background 세션은 파일에서만 올린다. 요청 본문을 App Group `outbox/` 에 쓰고, 완료 콜백이 지운다.
/// 잠금 중(첫 잠금 해제 이후)에도 nsurlsessiond 가 읽을 수 있게 `completeUntilFirstUserAuthentication` 로 둔다.
public enum Outbox {
  public static let dir = "outbox"

  /// JSON 항목 본문(`POST ingest`). 같은 id 는 같은 파일을 덮어쓴다 — 서버는 `source:id` 로 중복을 거른다.
  public static func writeJSON(_ item: CaptureItem, container: URL) throws -> URL {
    let d = container.appendingPathComponent(dir, isDirectory: true)
    try FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
    let url = d.appendingPathComponent(item.id + ".json")
    try body(item).write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    return url
  }

  /// 출처는 ingest 가 받는 값으로 맞춰 보낸다(CaptureSource). id 는 그대로라 멱등 키는 `<맞춘 출처>:<id>`
  public static func body(_ item: CaptureItem) throws -> Data {
    var i = item
    i.source = CaptureSource.normalize(i.source)
    return try JSONEncoder().encode(i)
  }

  public static func remove(id: String, container: URL) {
    try? FileManager.default.removeItem(at: container.appendingPathComponent(dir, isDirectory: true).appendingPathComponent(id + ".json"))
  }
}
