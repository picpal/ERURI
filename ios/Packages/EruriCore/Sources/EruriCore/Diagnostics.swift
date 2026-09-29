import Foundation

/// 설정 "진단 전송"(스펙 §8 device_traces). 앱·확장·인텐트가 같이 읽도록 App Group UserDefaults 에 둔다. 값이 없으면 켜짐(1인 사용)
public enum Diagnostics {
  public static let key = "diagnosticsEnabled"
  public static func isEnabled(defaults: UserDefaults = IngestSettings.shared) -> Bool {
    defaults.object(forKey: key) == nil ? true : defaults.bool(forKey: key)
  }
  /// 끄면 이미 큐에 쌓인 trace 도 지운다 — 끈 뒤에는 한 건도 올라가지 않는다(M1-②a 리뷰 Minor ③). 캡처 행은 건드리지 않는다
  public static func set(_ on: Bool, defaults: UserDefaults = IngestSettings.shared, queue: CaptureQueue? = nil) {
    defaults.set(on, forKey: key)
    guard !on else { return }
    do { try (queue ?? CaptureQueue.shared()).purgeTraces() }
    catch { DiagLog.append("trace purge error \(type(of: error))") }
  }
}
