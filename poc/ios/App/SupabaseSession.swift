import Foundation
import Security
import UIKit
import AssistantCore

/// PoC 사용자(`poc-user@example.com`) Supabase 세션. trace 업로드(`ingest/trace`)에 사용자 JWT 가 필요하다.
/// 첫 로그인: 시뮬레이터는 launch argument `--poc-user-password=`(sim.sh gmail), 실기기(TestFlight)는 디버그 화면의 비밀번호 칸.
/// 이후에는 Keychain 의 refresh token 으로 갱신한다(비밀번호는 저장하지 않는다). 토큰은 로그에 길이도 남기지 않는다.
actor SupabaseSession {
  static let shared = SupabaseSession()
  static let email = "poc-user@example.com"

  struct Config: Sendable { let url: URL; let anonKey: String }
  /// Info.plist 의 공개 값(Config/Secrets.xcconfig → sim.sh config)
  nonisolated static var config: Config? {
    func info(_ k: String) -> String? {
      guard let v = Bundle.main.object(forInfoDictionaryKey: k) as? String, !v.isEmpty, !v.hasPrefix("$(") else { return nil }
      return v
    }
    guard let host = info("PocSupabaseHost"), let anon = info("PocSupabaseAnonKey"), let url = URL(string: "https://\(host)") else { return nil }
    return Config(url: url, anonKey: anon)
  }

  private var access: (token: String, expires: Date)?

  var hasSession: Bool { access != nil || Keychain.refreshToken() != nil }

  /// 유효한 access token. 만료 1분 전이면 refresh token 으로, 그것도 없으면 launch argument 비밀번호로 로그인한다.
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
    let prefix = "--poc-user-password="
    if let pw = CommandLine.arguments.first(where: { $0.hasPrefix(prefix) }).map({ String($0.dropFirst(prefix.count)) }), !pw.isEmpty,
       await grant("password", ["email": Self.email, "password": pw]) { return access?.token }
    return nil
  }

  func login(password: String) async -> Bool { await grant("password", ["email": Self.email, "password": password]) }

  private func grant(_ type: String, _ body: [String: String]) async -> Bool {
    guard let cfg = Self.config, var c = URLComponents(url: cfg.url.appendingPathComponent("auth/v1/token"), resolvingAgainstBaseURL: false)
    else { PoCLog.append("session config_missing"); return false }
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
        PoCLog.append("session \(type) failed status=\(status)")
        if type == "refresh_token", status == 400 { Keychain.setRefreshToken(nil) }   // 회전·만료된 refresh token
        return false
      }
      access = (token, Date().addingTimeInterval(TimeInterval(o["expires_in"] as? Int ?? 3600)))
      if let rt = o["refresh_token"] as? String { Keychain.setRefreshToken(rt) }      // Supabase 는 refresh token 을 회전한다
      PoCLog.append("session \(type) ok")
      return true
    } catch {
      PoCLog.append("session \(type) error \((error as NSError).code)")
      return false
    }
  }
}

/// refresh token 한 개만 담는 Keychain 항목. 첫 잠금 해제 뒤 백그라운드 업로드에서도 읽을 수 있어야 한다.
enum Keychain {
  private static var base: [String: Any] { [kSecClass as String: kSecClassGenericPassword,
                                            kSecAttrService as String: "com.picpal.assistant.poc.supabase",
                                            kSecAttrAccount as String: "refresh_token"] }
  static func refreshToken() -> String? {
    var q = base; q[kSecReturnData as String] = true; q[kSecMatchLimit as String] = kSecMatchLimitOne
    var out: CFTypeRef?
    guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let d = out as? Data else { return nil }
    return String(data: d, encoding: .utf8)
  }
  static func setRefreshToken(_ v: String?) {
    SecItemDelete(base as CFDictionary)
    guard let v else { return }
    var q = base
    q[kSecValueData as String] = Data(v.utf8)
    q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    SecItemAdd(q as CFDictionary, nil)
  }
}

/// Trace 공통 필드 중 UIKit 이 필요한 값. UIApplication 은 메인 액터 전용이라 스냅샷으로 가져온다.
enum AppState {
  static func snapshot() async -> (locked: Bool, bg: Bool) {
    await MainActor.run { (!UIApplication.shared.isProtectedDataAvailable, UIApplication.shared.applicationState == .background) }
  }
}
