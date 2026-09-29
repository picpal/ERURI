import UIKit
import UserNotifications
import EruriCore

/// 알림 권한이 있으면 `registerForRemoteNotifications()` → 받은 토큰을 App Group 에 두고 `ingest/device` 로 등록한다.
/// 계약·환경 판정: docs/superpowers/poc/poc-4-apns.md "기기 등록 계약". 토큰은 eruri.log·Trace 에 sha8 만 남긴다.
final class PushDelegate: NSObject, UIApplicationDelegate {
  func application(_ application: UIApplication,
                   didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
    // 권한이 이미 있으면 실행마다 등록해 토큰 갱신을 받는다(Apple 권장).
    Task {
      let authorized = await PushRegistration.authorized()
      if authorized { PushRegistration.registerRemote() }
    }
    return true
  }

  func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
    let hex = APNsDevice.hex(deviceToken), env = PushRegistration.env
    APNsDevice.store(token: hex, env: env)
    DiagLog.append("apns token sha8=\(Trace.sha8(hex)) len=\(hex.count) env=\(env.rawValue) dist=\(PushRegistration.distribution)")
    Task { await DeviceRegistrar.shared.register() }
  }

  /// 무음 푸시(`content-available:1`, apns-send `silent:true`)로 깨어나면 큐를 flush 한다. 약 30초 안에 끝내야 한다
  func application(_ application: UIApplication, didReceiveRemoteNotification userInfo: [AnyHashable: Any]) async -> UIBackgroundFetchResult {
    guard ((userInfo["aps"] as? [String: Any])?["content-available"] as? Int) == 1 else { return .noData }
    let pending = (try? CaptureQueue.shared().captureCount()) ?? -1
    let st = await AppState.snapshot()
    let base: [String: Any] = ["trigger": UploadTrigger.silentPush.rawValue, "pending": pending]
    Trace.log("upload.wake", base.merging(st.traceFields) { _, new in new })
    let r = await Uploader.shared.flush(trigger: .silentPush)
    await DeviceRegistrar.shared.register()   // 24시간 지났으면 재등록(M1-⑤)
    return r.claimed > 0 ? (r.direct > 0 ? .newData : .failed) : .noData
  }

  /// background 세션 전송이 앱이 없는 동안 끝나면 iOS 가 앱을 깨워 여기로 온다. 세션을 다시 만들어 완료 콜백을 받는다
  func application(_ application: UIApplication, handleEventsForBackgroundURLSession identifier: String,
                   completionHandler: @escaping () -> Void) {
    guard identifier == Uploader.sessionID else { completionHandler(); return }
    BackgroundSessionEvents.store(completionHandler)
    _ = Uploader.shared
    DiagLog.append("bg session events")
  }

  func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
    let e = error as NSError
    APNsDevice.setStatus("토큰 발급 실패 \(e.domain) \(e.code)")
    DiagLog.append("apns register failed domain=\(e.domain) code=\(e.code)")
    Trace.log("device.register_failed", ["domain": e.domain, "code": e.code, "apns_env": PushRegistration.env.rawValue,
                                       "distribution": PushRegistration.distribution])
  }
}

enum PushRegistration {
  static func authorized() async -> Bool {
    let s = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
    return s == .authorized || s == .provisional
  }

  @MainActor static func registerRemote() {
    DiagLog.append("apns registerForRemoteNotifications")
    UIApplication.shared.registerForRemoteNotifications()
  }

  private static var profile: Data? {
    Bundle.main.url(forResource: "embedded", withExtension: "mobileprovision").flatMap { try? Data(contentsOf: $0) }
  }
  private static var isDebug: Bool {
    #if DEBUG
    true
    #else
    false
    #endif
  }
  private static var isSimulator: Bool {
    #if targetEnvironment(simulator)
    true
    #else
    false
    #endif
  }

  /// 이 설치의 APNs 환경. 서명 entitlement `aps-environment` 와 같아야 한다(Xcode 설치 = sandbox, TestFlight = production).
  static var env: APNsDevice.Env {
    let p = profile
    return APNsDevice.environment(isDebug: isDebug, hasProfile: p != nil, profileAPSEnvironment: p.flatMap(APNsDevice.profileAPSEnvironment))
  }
  static var distribution: String {
    APNsDevice.distribution(isSimulator: isSimulator, hasProfile: profile != nil,
                            receiptName: Bundle.main.appStoreReceiptURL?.lastPathComponent)
  }
  static var build: String {
    let v = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "-"
    return "\(v) (\(Trace.build))"
  }
}

/// 저장된 토큰을 `POST /functions/v1/ingest/device` 로 보낸다. 세션(JWT)이 없으면 대기로 두고
/// 로그인·앱 활성화 때(`register()` 재호출) 보낸다. 같은 (환경, build, 토큰)은 24시간에 한 번만 보낸다(`force` 는 로그인용).
actor DeviceRegistrar {
  static let shared = DeviceRegistrar()
  private var inFlight = false

  func register(force: Bool = false) async {
    guard let token = APNsDevice.token(), let env = APNsDevice.env() else { return }
    guard force || APNsDevice.needsRegistration(build: PushRegistration.build), !inFlight, let cfg = SupabaseSession.config else { return }
    inFlight = true
    defer { inFlight = false }
    guard let jwt = await SupabaseSession.shared.accessToken() else {
      APNsDevice.setStatus("등록 대기: 로그인 필요")
      DiagLog.append("device register queued: no session")
      return
    }
    var r = URLRequest(url: cfg.url.appendingPathComponent("functions/v1/ingest/device")); r.httpMethod = "POST"
    r.setValue("Bearer \(jwt)", forHTTPHeaderField: "Authorization")
    r.setValue(cfg.anonKey, forHTTPHeaderField: "apikey")
    r.setValue("application/json", forHTTPHeaderField: "Content-Type")
    let body: [String: String] = ["device_id": Trace.deviceID, "apns_token": token, "apns_env": env.rawValue, "build": PushRegistration.build]
    r.httpBody = try? JSONSerialization.data(withJSONObject: body)
    let started = Date(), sha8 = Trace.sha8(token)
    var status = -1, code = ""
    do {
      let (data, resp) = try await URLSession.shared.data(for: r)
      status = (resp as? HTTPURLResponse)?.statusCode ?? -1
      code = ((try? JSONSerialization.jsonObject(with: data)) as? [String: Any])?["error"] as? String ?? ""
    } catch { code = "network_\((error as NSError).code)" }
    let elapsed = Int(Date().timeIntervalSince(started) * 1000)
    if status == 200 {
      APNsDevice.markRegistered(token: token, env: env, build: PushRegistration.build)
      APNsDevice.setStatus("등록됨 \(env.rawValue) · \(sha8)")
      DiagLog.append("device registered env=\(env.rawValue) token_sha8=\(sha8)")
      Trace.log("device.registered", ["token_sha8": sha8, "apns_env": env.rawValue, "distribution": PushRegistration.distribution,
                                           "build": PushRegistration.build, "elapsed_ms": elapsed])
    } else {
      APNsDevice.setStatus("등록 실패 status=\(status) \(code)")
      DiagLog.append("device register failed status=\(status) \(code)")
      Trace.log("device.register_failed", ["status": status, "code": code, "apns_env": env.rawValue, "elapsed_ms": elapsed])
    }
  }
}
