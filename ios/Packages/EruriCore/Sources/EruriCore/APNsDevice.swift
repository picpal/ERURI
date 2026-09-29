import Foundation

/// APNs 기기 토큰: hex 변환·환경(sandbox/production) 판정·App Group 저장.
/// 서버 등록(`POST /functions/v1/ingest/device`, 계약: poc-4-apns.md)은 앱의 DeviceRegistrar 가 한다. 토큰은 로그에 sha8 만 남긴다.
public enum APNsDevice {
  public enum Env: String, Sendable { case sandbox, production }

  public static func hex(_ token: Data) -> String { token.map { String(format: "%02x", $0) }.joined() }

  /// 화면 표시용: 앞 4자·뒤 4자와 길이만.
  public static func masked(_ token: String) -> String {
    guard token.count > 8 else { return String(repeating: "•", count: token.count) }
    return "\(token.prefix(4))…\(token.suffix(4)) (\(token.count)자)"
  }

  /// embedded.mobileprovision(CMS 서명 안의 XML plist)의 `Entitlements.aps-environment`.
  public static func profileAPSEnvironment(_ profile: Data) -> String? {
    guard let start = profile.range(of: Data("<?xml".utf8)),
          let end = profile.range(of: Data("</plist>".utf8), in: start.lowerBound..<profile.endIndex),
          let o = try? PropertyListSerialization.propertyList(from: profile[start.lowerBound..<end.upperBound], format: nil) as? [String: Any],
          let ent = o["Entitlements"] as? [String: Any] else { return nil }
    return ent["aps-environment"] as? String
  }

  /// (1) 프로비저닝 프로필이 있으면(Xcode 설치·Ad Hoc) 그 aps-environment 를 따른다 — Release 를 Xcode 로 설치해도 development 면 sandbox.
  /// (2) Debug 빌드는 sandbox. (3) 프로필이 없는 Release 는 App Store 서명(TestFlight·App Store)이라 production.
  public static func environment(isDebug: Bool, hasProfile: Bool, profileAPSEnvironment: String?) -> Env {
    if hasProfile, let p = profileAPSEnvironment { return p == "production" ? .production : .sandbox }
    if isDebug || hasProfile { return .sandbox }
    return .production
  }

  /// 배포 경로 표식(Trace·화면용). 영수증 이름은 TestFlight 가 `sandboxReceipt`, App Store 가 `receipt` 다.
  public static func distribution(isSimulator: Bool, hasProfile: Bool, receiptName: String?) -> String {
    if isSimulator { return "simulator" }
    if hasProfile { return "xcode" }
    return receiptName == "sandboxReceipt" ? "testflight" : "appstore"
  }

  // MARK: App Group 저장 (앱 재실행·로그인 뒤 재전송에 쓴다)

  static let tokenKey = "apnsToken", envKey = "apnsEnv", registeredKey = "apnsRegistered", statusKey = "apnsStatus"
  static let registeredEnvKey = "apnsRegisteredEnv", registeredBuildKey = "apnsRegisteredBuild", registeredSha8Key = "apnsRegisteredTokenSha8",
    registeredAtKey = "apnsRegisteredAt"
  public static let refreshInterval: TimeInterval = 24 * 3600

  public static func store(token: String, env: Env, defaults: UserDefaults = IngestSettings.shared) {
    defaults.set(token, forKey: tokenKey); defaults.set(env.rawValue, forKey: envKey)
  }
  public static func token(defaults: UserDefaults = IngestSettings.shared) -> String? { defaults.string(forKey: tokenKey) }
  public static func env(defaults: UserDefaults = IngestSettings.shared) -> Env? { defaults.string(forKey: envKey).flatMap(Env.init) }

  /// 마지막 등록의 (환경, build, token_sha8) 중 하나가 다르거나 24시간이 지났으면 true. 업데이트 설치(build)·토큰 갱신·환경 전환 모두 다시 등록한다(0.2.1).
  /// 24시간 규칙: 진단 전송을 끄면 trace 가 last_seen_at 을 갱신하지 않아 7일 뒤 발송 대상에서 빠지므로 등록을 하루 1회 다시 보낸다(M1-⑤)
  public static func needsRegistration(build: String, now: Date = Date(), defaults: UserDefaults = IngestSettings.shared) -> Bool {
    guard let t = token(defaults: defaults), let e = env(defaults: defaults) else { return false }
    // 등록 시각이 미래(시계를 앞으로 돌렸다 원복)면 무효로 본다
    guard let at = defaults.object(forKey: registeredAtKey) as? Date, at <= now, now.timeIntervalSince(at) < refreshInterval else { return true }
    return defaults.string(forKey: registeredEnvKey) != e.rawValue || defaults.string(forKey: registeredBuildKey) != build
      || defaults.string(forKey: registeredSha8Key) != Trace.sha8(t)
  }
  public static func markRegistered(token: String, env: Env, build: String, now: Date = Date(), defaults: UserDefaults = IngestSettings.shared) {
    defaults.set(env.rawValue, forKey: registeredEnvKey)
    defaults.set(build, forKey: registeredBuildKey)
    defaults.set(Trace.sha8(token), forKey: registeredSha8Key)
    defaults.set(now, forKey: registeredAtKey)
    defaults.removeObject(forKey: registeredKey)   // 0.2.0 이하 형식("env:token") 정리
  }
  /// 로그아웃: 다음 로그인(다른 사용자일 수 있음)에서 반드시 다시 등록한다
  public static func clearRegistration(defaults: UserDefaults = IngestSettings.shared) {
    for k in [registeredEnvKey, registeredBuildKey, registeredSha8Key, registeredAtKey, registeredKey] { defaults.removeObject(forKey: k) }
  }

  /// 화면에 보일 마지막 상태 한 줄(토큰 원문 없음).
  public static func status(defaults: UserDefaults = IngestSettings.shared) -> String? { defaults.string(forKey: statusKey) }
  public static func setStatus(_ s: String, defaults: UserDefaults = IngestSettings.shared) { defaults.set(s, forKey: statusKey) }
}
