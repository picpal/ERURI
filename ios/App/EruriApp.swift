import SwiftUI
import UserNotifications
import EruriCore
import GoogleSignIn

@main
struct EruriApp: App {
  private static let notificationDelegate = NotificationDelegate()
  @UIApplicationDelegateAdaptor(PushDelegate.self) private var pushDelegate
  @Environment(\.scenePhase) private var scenePhase

  init() {
    NotificationActions.register()
    UNUserNotificationCenter.current().delegate = Self.notificationDelegate
    BFULog.prepare()
    DiagLog.append("ingest base=\(Uploader.base.absoluteString)")
    // 인텐트·무음 푸시·BG refresh 로 백그라운드 실행됐으면 각 경로가 자기 트리거로 flush 한다(경로 태깅이 섞이지 않게)
    Task { if await !AppState.snapshot().bg { await Uploader.shared.flush(trigger: .foreground) } }
  }

  var body: some Scene {
    WindowGroup {
      ContentView()
        .onOpenURL { url in _ = GIDSignIn.sharedInstance.handle(url) }   // Google 로그인 리디렉션
    }
    .onChange(of: scenePhase) { _, newPhase in
      if newPhase == .active {
        AppState.prepareProbe(); ContactsLoader.refresh(); Uploader.shared.flush(); NotificationActions.register()
        Task { await DeviceRegistrar.shared.register() }
      }
      if newPhase == .background { BackgroundRefresh.schedule() }
    }
    .backgroundTask(.appRefresh(BackgroundRefresh.id)) { await BackgroundRefresh.run() }
  }
}
