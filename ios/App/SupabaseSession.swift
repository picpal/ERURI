import Foundation
import Security
import UIKit
import EruriCore

/// 제품 사용자 Supabase 세션(Sign in with Apple, M1-②c). 업로드·trace·기기 등록·Gmail 연결·제안 조회가 이 JWT 를 같이 쓴다.
/// refresh token 은 Keychain(이 기기 전용)에 둔다. 토큰은 로그에 길이도 남기지 않는다.
actor SupabaseSession {
  static let shared = SupabaseSession()

  struct Config: Sendable { let url: URL; let anonKey: String }
  /// Info.plist 의 공개 값(Config/Secrets.xcconfig → sim.sh config)
  nonisolated static var config: Config? {
    func info(_ k: String) -> String? {
      guard let v = Bundle.main.object(forInfoDictionaryKey: k) as? String, !v.isEmpty, !v.hasPrefix("$(") else { return nil }
      return v
    }
    guard let host = info("EruriSupabaseHost"), let anon = info("EruriSupabaseAnonKey"), let url = URL(string: "https://\(host)") else { return nil }
    return Config(url: url, anonKey: anon)
  }

  private var access: (token: String, expires: Date)?

  var hasSession: Bool { access != nil || Keychain.refreshToken() != nil }
  /// 마지막 실패 코드(진단 복사용, 본문·토큰 없음)
  private(set) var lastError: String?

  /// 유효한 access token. 만료 1분 전이면 refresh token 으로 갱신한다.
  func accessToken() async -> String? {
    if let a = access, a.expires > Date().addingTimeInterval(60) { return a.token }
    if let t = inFlight { return await t.value }   // actor 재진입: 동시 flush 가 로그인을 두 번 하지 않게 한 번의 갱신을 공유한다
    let t = Task { await obtain() }
    inFlight = t
    defer { inFlight = nil }
    return await t.value
  }

  private var inFlight: Task<String?, Never>?

  private func obtain() async -> String? {
    if let rt = Keychain.refreshToken(), await grant("refresh_token", ["refresh_token": rt]) { return access?.token }
    return nil
  }

  /// 저장된 세션을 지운다.
  func logout() {
    access = nil
    Keychain.setRefreshToken(nil)
    DiagLog.append("session logout")
  }

  /// 서버가 401 을 준 access token 을 버려 다음 `accessToken()` 이 갱신하게 한다.
  func invalidate() { access = nil }

  private func grant(_ type: String, _ body: [String: String]) async -> Bool {
    guard let cfg = Self.config, var c = URLComponents(url: cfg.url.appendingPathComponent("auth/v1/token"), resolvingAgainstBaseURL: false)
    else { lastError = "session_config_missing"; DiagLog.append("session config_missing"); return false }
    c.queryItems = [URLQueryItem(name: "grant_type", value: type)]
    var r = URLRequest(url: c.url!)
    r.httpMethod = "POST"
    r.setValue(cfg.anonKey, forHTTPHeaderField: "apikey")
    r.setValue("application/json", forHTTPHeaderField: "Content-Type")
    r.httpBody = try? JSONSerialization.data(withJSONObject: body)
    do {
      let (data, resp) = try await URLSession.shared.data(for: r)
      let status = (resp as? HTTPURLResponse)?.statusCode ?? -1
      guard status == 200, let o = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let token = o["access_token"] as? String else {
        lastError = "session_\(type)_status_\(status)"
        DiagLog.append("session \(type) failed status=\(status)")
        if type == "refresh_token", status == 400 { Keychain.setRefreshToken(nil) }   // 회전·만료된 refresh token
        return false
      }
      access = (token, Date().addingTimeInterval(TimeInterval(o["expires_in"] as? Int ?? 3600)))
      if let rt = o["refresh_token"] as? String { Keychain.setRefreshToken(rt) }      // Supabase 는 refresh token 을 회전한다
      lastError = nil
      DiagLog.append("session \(type) ok")
      return true
    } catch {
      lastError = "session_\(type)_network_\((error as NSError).code)"
      DiagLog.append("session \(type) error \((error as NSError).code)")
      return false
    }
  }
}

/// refresh token Keychain 항목. 첫 잠금 해제 뒤 백그라운드 업로드에서도 읽을 수 있어야 한다.
enum Keychain {
  enum Item: String { case refreshToken = "refresh_token" }
  private static func base(_ item: Item) -> [String: Any] { [kSecClass as String: kSecClassGenericPassword,
                                                            kSecAttrService as String: "com.picpal.eruri.supabase",
                                                            kSecAttrAccount as String: item.rawValue] }
  static func refreshToken() -> String? { get(.refreshToken) }
  static func setRefreshToken(_ v: String?) { set(.refreshToken, v) }
  static func get(_ item: Item) -> String? {
    var q = base(item); q[kSecReturnData as String] = true; q[kSecMatchLimit as String] = kSecMatchLimitOne
    var out: CFTypeRef?
    guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let d = out as? Data else { return nil }
    return String(data: d, encoding: .utf8)
  }
  static func set(_ item: Item, _ v: String?) {
    SecItemDelete(base(item) as CFDictionary)
    guard let v else { return }
    var q = base(item)
    q[kSecValueData as String] = Data(v.utf8)
    q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    SecItemAdd(q as CFDictionary, nil)
  }
}
