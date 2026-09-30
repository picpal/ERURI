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
      RootView()
        .onOpenURL { url in _ = GIDSignIn.sharedInstance.handle(url) }     // Google 로그인 리디렉션
    }
    .onChange(of: scenePhase) { _, newPhase in
      if newPhase == .active {
        AppState.prepareProbe(); ContactsLoader.refresh(); Uploader.shared.flush(); NotificationActions.register()
        Task { await DeviceRegistrar.shared.register(); await ExecutionReporter.shared.flush() }
      }
      if newPhase == .background { BackgroundRefresh.schedule() }
    }
    .backgroundTask(.appRefresh(BackgroundRefresh.id)) { await BackgroundRefresh.run() }
  }
}

/// 채팅 | 제안(Ruling 8') | 보관함(M2-⑨b) | 설정. 배너 탭 딥링크는 첫 화면이 뜬 뒤 "제안" 탭으로 옮겨 시트로 띄운다(콜드 스타트)
struct RootView: View {
  enum Tab: Hashable { case chat, proposals, archive, settings }
  @State private var tab = Tab.chat
  @State private var ready = false
  private var router: ProposalRouter { ProposalRouter.shared }

  var body: some View {
    let link = ready ? router.link : nil                                     // body 에서 읽어 관찰 추적에 올린다(openCount 에 기대지 않게)
    TabView(selection: $tab) {
      ChatView().tabItem { Label("채팅", systemImage: "bubble.left.and.bubble.right") }.tag(Tab.chat)
      ProposalsView().tabItem { Label("제안", systemImage: "calendar.badge.plus") }.tag(Tab.proposals)
      ArchiveView().tabItem { Label("보관함", systemImage: "tray.full") }.tag(Tab.archive)
      ContentView().tabItem { Label("설정", systemImage: "gearshape") }.tag(Tab.settings)
    }
    .sheet(item: Binding(get: { link }, set: { router.link = $0 })) { ProposalSheet(link: $0) }
    .onChange(of: router.openCount) { _, _ in tab = .proposals }
    .task {
      // 콜드 스타트: 델리게이트가 첫 화면보다 먼저 링크를 넣는다. 창이 붙은 다음 런루프에 시트를 켠다
      if router.link != nil { tab = .proposals }
      await Task.yield()
      ready = true
    }
  }
}
