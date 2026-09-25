import Foundation

/// 업로드 서버 주소. App Group UserDefaults 에 저장해 홈 화면에서 다시 열어도 유지된다.
/// Xcode 스킴 환경변수 `INGEST_URL` 은 저장값이 없을 때 초기값으로만 쓴다.
public enum IngestSettings {
  public static let key = "ingestURL"
  public static let fallback = URL(string: "http://localhost:8787")!
  public static var shared: UserDefaults { UserDefaults(suiteName: AppGroup.id) ?? .standard }

  public static func seed(from env: [String: String], defaults: UserDefaults = shared) {
    guard defaults.string(forKey: key) == nil, let v = env["INGEST_URL"], let url = validated(v) else { return }
    defaults.set(url.absoluteString, forKey: key)
  }

  public static func url(defaults: UserDefaults = shared) -> URL {
    defaults.string(forKey: key).flatMap(validated) ?? fallback
  }

  /// http(s) 이고 호스트가 있는 주소만 저장한다.
  @discardableResult
  public static func set(_ raw: String, defaults: UserDefaults = shared) -> Bool {
    guard let url = validated(raw) else { return false }
    defaults.set(url.absoluteString, forKey: key)
    return true
  }

  static func validated(_ raw: String) -> URL? {
    let s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let url = URL(string: s), let scheme = url.scheme?.lowercased(), ["http", "https"].contains(scheme),
          url.host?.isEmpty == false else { return nil }
    return url
  }
}
