import Foundation

/// 업로드 서버 주소. App Group UserDefaults 에 저장해 홈 화면에서 다시 열어도 유지된다.
/// Xcode 스킴 환경변수 `INGEST_URL` 은 저장값이 없을 때 초기값으로만 쓴다.
/// 저장값이 없을 때의 기본값은 빌드 구성별 Info.plist `PocIngestDefaultURL`(Debug: 로컬 mock, Release: Supabase functions/v1).
public enum IngestSettings {
  public static let key = "ingestURL"
  public static let localFallback = URL(string: "http://localhost:8787")!
  public static var fallback: URL {
    (Bundle.main.object(forInfoDictionaryKey: "PocIngestDefaultURL") as? String).flatMap(validated) ?? localFallback
  }
  public static var shared: UserDefaults { UserDefaults(suiteName: AppGroup.id) ?? .standard }

  public static func seed(from env: [String: String], defaults: UserDefaults = shared) {
    guard defaults.string(forKey: key) == nil, let v = env["INGEST_URL"], let url = validated(v) else { return }
    defaults.set(url.absoluteString, forKey: key)
  }

  public static func url(defaults: UserDefaults = shared, fallback: URL = fallback) -> URL {
    defaults.string(forKey: key).flatMap(validated) ?? fallback
  }

  /// 저장값을 지워 빌드 기본값으로 되돌린다(예전에 localhost 를 저장한 기기).
  public static func reset(defaults: UserDefaults = shared) { defaults.removeObject(forKey: key) }

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
