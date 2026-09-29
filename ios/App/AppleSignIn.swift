import AuthenticationServices
import CryptoKit
import UIKit
import EruriCore

/// Sign in with Apple → Supabase 세션(스펙 §2, 1단계 본인 전용). 이름은 요청하지 않고 이메일만 받는다 —
/// 검색 평가 러너(M2-⑩a)가 Auth admin 매직링크로 실사용자 세션을 만들 때 이메일이 필요하다("스펙 확인 필요" #13)
@MainActor
final class AppleSignIn: NSObject, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
  static let shared = AppleSignIn()
  private var continuation: CheckedContinuation<String, Never>?
  private var rawNonce = ""

  /// 반환: 화면 문구("로그인됨" 또는 "로그인 실패: <코드>")
  func run() async -> String {
    rawNonce = Self.randomNonce()
    let req = ASAuthorizationAppleIDProvider().createRequest()
    req.requestedScopes = [.email]
    req.nonce = Self.sha256(rawNonce)
    let c = ASAuthorizationController(authorizationRequests: [req])
    c.delegate = self
    c.presentationContextProvider = self
    return await withCheckedContinuation { k in continuation = k; c.performRequests() }
  }

  func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
    guard let cred = authorization.credential as? ASAuthorizationAppleIDCredential, let t = cred.identityToken,
          let token = String(data: t, encoding: .utf8) else { finish("로그인 실패: identity_token_missing"); return }
    let nonce = rawNonce
    Task {
      let ok = await SupabaseSession.shared.signInWithApple(idToken: token, rawNonce: nonce)
      let why = await SupabaseSession.shared.lastError ?? "unknown"
      finish(ok ? "로그인됨" : "로그인 실패: \(why)")
      if ok { await DeviceRegistrar.shared.register(force: true); Uploader.shared.flush() }
    }
  }
  func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
    finish("로그인 실패: apple_\((error as NSError).code)")                  // 1001 = 사용자 취소
  }
  func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
    // 버튼을 누른 화면이 떠 있으므로 씬은 항상 있다(iOS 26: 빈 ASPresentationAnchor() 폐기)
    let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
    return scenes.compactMap { $0.keyWindow ?? $0.windows.first }.first ?? ASPresentationAnchor(windowScene: scenes[0])
  }
  private func finish(_ s: String) {
    DiagLog.append("apple signin \(s.hasPrefix("로그인됨") ? "ok" : s)")
    continuation?.resume(returning: s); continuation = nil
  }
  static func randomNonce() -> String {
    var b = [UInt8](repeating: 0, count: 32)
    _ = SecRandomCopyBytes(kSecRandomDefault, b.count, &b)
    return b.map { String(format: "%02x", $0) }.joined()
  }
  static func sha256(_ s: String) -> String { SHA256.hash(data: Data(s.utf8)).map { String(format: "%02x", $0) }.joined() }
}
