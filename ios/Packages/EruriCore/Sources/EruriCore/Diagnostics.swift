import Foundation

/// 설정 "진단 전송"(스펙 §8 device_traces). 앱·확장·인텐트가 같이 읽도록 App Group UserDefaults 에 둔다. 값이 없으면 켜짐(1인 사용)
public enum Diagnostics {
  public static let key = "diagnosticsEnabled"
  public static func isEnabled(defaults: UserDefaults = IngestSettings.shared) -> Bool {
    defaults.object(forKey: key) == nil ? true : defaults.bool(forKey: key)
  }
  public static func set(_ on: Bool, defaults: UserDefaults = IngestSettings.shared) { defaults.set(on, forKey: key) }
}
