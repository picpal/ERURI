import Foundation
import UIKit
import GoogleSignIn
import EruriCore

/// PoC-6: Google 로그인 → serverAuthCode → `POST /functions/v1/gmail-connect`.
/// 계약은 docs/superpowers/poc/poc-6-gmail.md. 앱에는 공개 가능 값(클라이언트 ID·Supabase 호스트·publishable 키)만 있고,
/// Supabase 사용자 세션은 `SupabaseSession`(설정 화면 PoC 계정 또는 시뮬레이터 launch argument)을 같이 쓴다.
/// 코드·토큰은 로그에 길이만 남긴다. 모든 실패는 화면 문구 + `poc6.signin_failed`(code 만) 로 남긴다.
@MainActor
enum GmailConnect {
  static let scope = "https://www.googleapis.com/auth/gmail.readonly"
  /// 마지막 실패 코드(진단 복사용)
  private(set) static var lastError: String?

  struct Config {
    let clientID: String, serverClientID: String, supabase: URL, anonKey: String
  }

  /// `forceConsent`: 이전 동의가 남아 refresh token 을 못 받았을 때(`refresh_token_stored: false`) disconnect 후 동의 화면을 다시 거친다.
  static func run(forceConsent: Bool = false) async -> String {
    guard let cfg = config() else { return fail("config_missing", "앱 설정값(GID·Supabase)이 빌드에 없음") }

    // Google 시트에서 사람이 시간을 쓰므로 Supabase 세션을 먼저 확보한다(serverAuthCode 는 몇 분 안에 만료된다)
    guard var access = await SupabaseSession.shared.accessToken() else {
      let why = await SupabaseSession.shared.lastError ?? "no_session"
      return fail("no_session", "PoC 계정으로 먼저 로그인하세요 (\(why))")
    }

    GIDSignIn.sharedInstance.configuration = GIDConfiguration(clientID: cfg.clientID, serverClientID: cfg.serverClientID)
    if forceConsent {
      do { try await GIDSignIn.sharedInstance.disconnect(); PoCLog.append("gmail disconnect ok") }
      catch { PoCLog.append("gmail disconnect error \((error as NSError).code)") }   // 이전 연결이 없으면 실패해도 된다
    }
    guard let presenter = topViewController() else { return fail("no_presenter", "로그인 화면을 띄울 창을 찾지 못함") }
    PoCLog.append("gmail signin start forceConsent=\(forceConsent)")
    let code: String
    do {
      let result = try await GIDSignIn.sharedInstance.signIn(withPresenting: presenter, hint: nil, additionalScopes: [scope])
      let granted = result.user.grantedScopes?.contains(scope) ?? false
      guard let c = result.serverAuthCode else { return fail("no_server_auth_code", "serverAuthCode 없음 granted=\(granted)") }
      PoCLog.append("gmail signin ok codeLen=\(c.count) gmailScope=\(granted)")
      // 세분화된 동의 화면에서 Gmail 체크박스를 빼면 교환은 되지만 서버의 profile/watch 가 403 으로 실패해 코드만 소비된다
      guard granted else { return fail("scope_not_granted", "'재동의 연결'에서 Gmail 읽기 권한을 체크") }
      code = c
    } catch {
      let e = error as NSError
      // -5 = 사용자가 취소
      return fail("signin_error", "\(e.domain) \(e.code)", code: e.code)
    }

    // 받자마자 보낸다. 401 은 게이트웨이에서 막혀 코드가 소비되지 않았으므로 재로그인 뒤 한 번만 다시 보낸다
    var (status, body) = await connect(cfg, access: access, code: code)
    if status == 401 {
      PoCLog.append("gmail connect 401 → supabase 재로그인 후 재시도")
      await SupabaseSession.shared.invalidate()
      guard let a = await SupabaseSession.shared.accessToken() else { return fail("relogin_failed", "Supabase 재로그인 실패") }
      access = a
      (status, body) = await connect(cfg, access: access, code: code)
    }
    let line = describe(status: status, body: body)
    if status != 200 { return fail("connect_\(status)", line, code: status) }
    lastError = nil
    return log(line)
  }

  // MARK: - HTTP

  private static func connect(_ cfg: Config, access: String, code: String) async -> (Int, [String: Any]) {
    var r = URLRequest(url: cfg.supabase.appendingPathComponent("functions/v1/gmail-connect"))
    r.httpMethod = "POST"
    r.setValue("Bearer \(access)", forHTTPHeaderField: "Authorization")
    r.setValue(cfg.anonKey, forHTTPHeaderField: "apikey")
    r.setValue("application/json", forHTTPHeaderField: "Content-Type")
    r.httpBody = try? JSONSerialization.data(withJSONObject: ["code": code])
    r.timeoutInterval = 120   // 백필 잡 적재까지 동기로 끝난다
    let started = Date()
    do {
      let (data, resp) = try await URLSession.shared.data(for: r)
      let status = (resp as? HTTPURLResponse)?.statusCode ?? -1
      PoCLog.append("gmail connect status=\(status) ms=\(Int(Date().timeIntervalSince(started) * 1000))")
      return (status, (try? JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:])
    } catch {
      return (-1, ["error": "network \((error as NSError).code)"])
    }
  }

  /// 계약 문서의 상태별 처리. 계정 주소는 앞 2글자만 남긴다.
  private static func describe(status: Int, body: [String: Any]) -> String {
    let err = body["error"] as? String ?? body["code"] as? String ?? "-"
    switch status {
    case 200:
      let stored = body["refresh_token_stored"] as? Bool ?? false
      let account = (body["account"] as? String).map(maskEmail) ?? "-"
      var s = "gmail connect 200 connection=\(body["connection_id"] ?? "-") account=\(account) refresh_token_stored=\(stored)"
        + " watch_expires_at=\(body["watch_expires_at"] ?? "-") backfill_pages=\(body["backfill_pages"] ?? "-")"
        + " backfill_messages=\(body["backfill_messages"] ?? "-")"
      if !stored { s += " → 이전 동의가 남아 refresh token 없음: '재동의 연결'로 다시 시도" }
      return s
    case 400: return "gmail connect 400 \(err) (요청 형식)"
    case 401: return "gmail connect 401 \(err) (Supabase 세션 만료 — 재로그인 후에도 실패)"
    case 409: return "gmail connect 409 \(err) (이 Gmail 은 다른 사용자에 연결됨)"
    case 502: return "gmail connect 502 \(err) (코드 만료·재사용 또는 serverClientID 불일치 — 다시 연결)"
    case 500: return "gmail connect 500 \(err) (서버 오류, 재시도 가능)"
    default: return "gmail connect \(status) \(err)"
    }
  }

  // MARK: - 설정·표시

  private static func config() -> Config? {
    func info(_ k: String) -> String? {
      guard let v = Bundle.main.object(forInfoDictionaryKey: k) as? String, !v.isEmpty, !v.hasPrefix("$(") else { return nil }
      return v
    }
    guard let clientID = info("GIDClientID"), let server = info("GIDServerClientID"), let s = SupabaseSession.config
    else { return nil }
    return Config(clientID: clientID, serverClientID: server, supabase: s.url, anonKey: s.anonKey)
  }

  /// 전경 활성 씬의 keyWindow 에서 최상위 VC(`UIApplication.windows` 는 iOS 15 부터 폐기, 멀티씬에서 nil 가능).
  private static func topViewController() -> UIViewController? {
    let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
    let scene = scenes.first { $0.activationState == .foregroundActive } ?? scenes.first
    var vc = (scene?.keyWindow ?? scene?.windows.first { $0.isKeyWindow } ?? scene?.windows.first)?.rootViewController
    while let presented = vc?.presentedViewController, !presented.isBeingDismissed { vc = presented }
    return vc
  }

  /// 실패 공통 경로: 화면 문구 + poc.log + trace(code 만, 본문 없음). 로그인 전이면 trace 는 큐에 남아 로그인 뒤 올라간다.
  private static func fail(_ reason: String, _ detail: String, code: Int = 0) -> String {
    lastError = "\(reason) \(code)"
    Trace.log("poc6.signin_failed", ["reason": reason, "code": code])
    return log("Gmail 연결 실패: \(reason) — \(detail)")
  }

  private static func maskEmail(_ s: String) -> String {
    guard let at = s.firstIndex(of: "@") else { return "***" }
    return String(s[..<at].prefix(2)) + "***" + String(s[at...])
  }

  @discardableResult
  private static func log(_ line: String) -> String { PoCLog.append(line); return line }
}
