import SwiftUI
import UIKit
import UserNotifications
import EventKit
import EruriCore

struct ContentView: View {
  @State private var items: [CaptureItem] = []
  @State private var logLines: [String] = []
  @State private var bfuLines: [String] = []
  @State private var lastResult: String = ""
  @State private var ingestURL: String = ""
  @State private var ingestCurrent: String = ""
  @State private var gmailResult: String = ""
  @State private var gmailBusy = false
  @State private var traceStatus = ""
  @State private var accountEmail = ""
  @State private var accountPassword = ""
  @State private var accountStatus = ""
  @State private var diagCopied = false
  @State private var pushStatus = ""

  var body: some View {
    NavigationStack {
      List {
        Section("디버그") {
          Button("권한 요청 (알림·캘린더·연락처)") { requestPermissions() }
          Button("디버그: 파이프라인 직접 호출") { runDebugCapture() }
          Button("업로드 flush") { Uploader.shared.flush(); refresh() }
          Button("10초 뒤 ADD_EVENT 로컬 알림") { NotificationActions.scheduleLocal(proposalId: "p-local-1", after: 10) }
          if !lastResult.isEmpty { Text("결과: \(lastResult)").font(.caption).foregroundStyle(.secondary) }
        }
        // PoC-4: APNs 토큰(마스킹) → ingest/device. 등록은 토큰을 다시 받고 저장된 토큰을 강제로 재전송한다
        Section("푸시 (PoC-4)") {
          Text(pushStatus).font(.caption).foregroundStyle(.secondary).accessibilityIdentifier("pushStatus")
          Button("등록") { registerPush() }.accessibilityIdentifier("pushRegister")
        }
        // PoC-6: Google 로그인 → serverAuthCode → gmail-connect. 비밀번호는 `sim.sh gmail` 이 launch argument 로 넘긴다
        Section("Gmail (PoC-6)") {
          Button("Gmail 연결") { connectGmail(forceConsent: false) }.disabled(gmailBusy).accessibilityIdentifier("gmailConnect")
          Button("재동의 연결 (disconnect 후)") { connectGmail(forceConsent: true) }.disabled(gmailBusy)
            .accessibilityIdentifier("gmailReconsent")
          if !gmailResult.isEmpty {
            Text(gmailResult).font(.caption).foregroundStyle(gmailResult.hasPrefix("Gmail 연결 실패") ? .red : .secondary)
              .accessibilityIdentifier("gmailResult")
          }
        }
        // PoC 계정(Supabase 사용자). 큐 업로드·trace·기기 등록·Gmail 연결이 이 세션을 쓴다. 이메일·비밀번호는 Keychain(이 기기 전용)
        Section("PoC 계정") {
          Text(accountStatus).font(.caption).foregroundStyle(accountStatus.hasPrefix("로그인 실패") ? .red : .secondary).accessibilityIdentifier("accountStatus")
          Text(traceStatus).font(.caption).foregroundStyle(.secondary).accessibilityIdentifier("traceStatus")
          TextField("이메일", text: $accountEmail)
            .keyboardType(.emailAddress).textContentType(.username).textInputAutocapitalization(.never).autocorrectionDisabled()
            .accessibilityIdentifier("accountEmail")
          SecureField("비밀번호", text: $accountPassword).textContentType(.password).accessibilityIdentifier("tracePassword")
          Button("로그인") { accountLogin() }.disabled(accountEmail.isEmpty || accountPassword.isEmpty)
            .accessibilityIdentifier("traceLogin")
          Button("로그아웃 (저장된 계정 삭제)", role: .destructive) { accountLogout() }
        }
        // 업로드 서버 주소. App Group 에 저장돼 홈 화면에서 다시 열어도 유지된다. 비워 두면 빌드 기본값(Release: Supabase)
        Section("업로드 서버") {
          TextField("https://<host>/functions/v1 또는 http://<MAC_IP>:<PORT>", text: $ingestURL)
            .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
            .accessibilityIdentifier("ingestURLField")
          Button("저장") { saveIngestURL() }.accessibilityIdentifier("ingestURLSave")
          Button("기본값으로 (\(IngestSettings.fallback.host() ?? "-"))") { resetIngestURL() }.accessibilityIdentifier("ingestURLReset")
          Text("현재: \(ingestCurrent)").font(.caption).foregroundStyle(.secondary).accessibilityIdentifier("ingestURLCurrent")
        }
        Section("진단") {
          Button(diagCopied ? "복사됨" : "진단 정보 복사") { copyDiagnostics() }.accessibilityIdentifier("copyDiagnostics")
        }
        Section("큐 (\(items.count)건)") {
          if items.isEmpty {
            Text("비어 있음").foregroundStyle(.secondary)
          } else {
            ForEach(items, id: \.id) { item in
              VStack(alignment: .leading) {
                Text("[\(item.source)] \(item.appName ?? "-") filter=\(item.deviceFilter ?? "-") titleLen=\(item.title?.count ?? -1) attempts=\(item.attempts)")
                  .font(.caption).foregroundStyle(.secondary)
                Text(item.text)
              }
            }
          }
        }
        Section("poc.log") {
          if logLines.isEmpty {
            Text("비어 있음").foregroundStyle(.secondary)
          } else {
            ForEach(logLines, id: \.self) { line in
              Text(line).font(.system(.caption, design: .monospaced))
            }
          }
        }
        Section("bfu.log") {
          ForEach(bfuLines, id: \.self) { line in Text(line).font(.system(.caption, design: .monospaced)) }
        }
      }
      .navigationTitle("ERURI PoC")
      .toolbar {
        ToolbarItem(placement: .navigationBarTrailing) {
          Button("새로고침") { refresh() }
        }
      }
      .onAppear {
        refresh()
        // `sim.sh gmail --poc-gmail-connect[=consent]`: 버튼 탭 없이 같은 흐름을 시작한다(Google 시트의 로그인·동의는 사람이 한다)
        if let arg = CommandLine.arguments.first(where: { $0.hasPrefix("--poc-gmail-connect") }), !gmailBusy, gmailResult.isEmpty {
          connectGmail(forceConsent: arg.hasSuffix("=consent"))
        }
      }
    }
  }

  private func requestPermissions() {
    UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { granted, error in
      PoCLog.append("notif permission granted=\(granted) error=\(String(describing: error))")
      if granted { Task { @MainActor in PushRegistration.registerRemote() } }
    }
    EKEventStore().requestFullAccessToEvents { granted, error in
      PoCLog.append("calendar permission granted=\(granted) error=\(String(describing: error))")
    }
    ContactsLoader.requestAccess()
  }

  private func refresh() {
    items = (try? CaptureQueue.shared().pending(limit: 50, now: .distantFuture)) ?? []   // 백오프·lease 중인 항목도 표시
    bfuLines = BFULog.tail(lines: 10)
    logLines = PoCLog.tail(lines: 20)
    ingestCurrent = Uploader.base.absoluteString
    let pending = (try? CaptureQueue.shared().traceCount()) ?? -1
    let token = APNsDevice.token().map(APNsDevice.masked) ?? "없음"
    pushStatus = "토큰 \(token) · \(PushRegistration.env.rawValue)/\(PushRegistration.distribution) · \(APNsDevice.status() ?? "-")"
    Task {
      let session = await SupabaseSession.shared.hasSession
      traceStatus = "device \(Trace.deviceID.prefix(8)) · build \(Trace.build) · 대기 \(pending)건 · 세션 \(session ? "있음" : "없음")"
    }
    if ingestURL.isEmpty { ingestURL = ingestCurrent }
    let stored = Keychain.get(.email)
    accountStatus = stored.map { "저장된 계정: \(Self.maskEmail($0))" } ?? "저장된 계정 없음"
    if accountEmail.isEmpty { accountEmail = stored ?? "" }
  }

  private static func maskEmail(_ s: String) -> String {
    guard let at = s.firstIndex(of: "@") else { return "***" }
    return String(s[..<at].prefix(2)) + "***" + String(s[at...])
  }

  private func resetIngestURL() {
    IngestSettings.reset()
    PoCLog.append("ingest url reset \(Uploader.base.absoluteString)")
    ingestURL = Uploader.base.absoluteString
    refresh()
    Uploader.shared.flush()
  }

  /// 붙여넣기용 진단 정보. 비밀번호·토큰·본문·메일 주소 없음(오류 줄은 코드·상태만 남도록 로그가 이미 설계돼 있다).
  private func copyDiagnostics() {
    Task {
      let session = await SupabaseSession.shared.hasSession
      let sessionErr = await SupabaseSession.shared.lastError ?? "-"
      let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "-"
      let errors = PoCLog.tail(lines: 200).filter { $0.range(of: "fail|error|실패|skipped|missing|rejected", options: .regularExpression) != nil }
        .suffix(3)
      let lines = [
        "ERURI PoC \(version) (\(Trace.build)) · iOS \(UIDevice.current.systemVersion)",
        "upload=\(Uploader.base.host() ?? "-") · session=\(session ? "yes" : "no") · account=\(Keychain.get(.email) == nil ? "no" : "yes")",
        "gmail_last_error=\(GmailConnect.lastError ?? "-") · session_last_error=\(sessionErr)",
        "push=\(pushStatus)",
        "--- 최근 오류 ---",
      ] + errors
      UIPasteboard.general.string = lines.joined(separator: "\n")
      diagCopied = true
      try? await Task.sleep(for: .seconds(2))
      diagCopied = false
    }
  }

  private func saveIngestURL() {
    if IngestSettings.set(ingestURL) {
      PoCLog.append("ingest url saved \(Uploader.base.absoluteString)")
      ingestURL = Uploader.base.absoluteString
    } else {
      PoCLog.append("ingest url rejected")
    }
    refresh()
    Uploader.shared.flush()
  }

  private func accountLogin() {
    let email = accountEmail, pw = accountPassword
    accountPassword = ""
    Task {
      let ok = await SupabaseSession.shared.login(email: email, password: pw)
      PoCLog.append("account login \(ok ? "ok" : "failed \(await SupabaseSession.shared.lastError ?? "-")")")
      if ok { Uploader.shared.flush(); await DeviceRegistrar.shared.register() }
      refresh()
      if !ok { accountStatus = "로그인 실패: \(await SupabaseSession.shared.lastError ?? "-")" }
    }
  }

  private func accountLogout() {
    Task {
      await SupabaseSession.shared.logout()
      accountEmail = ""
      refresh()
    }
  }

  private func registerPush() {
    PushRegistration.registerRemote()
    Task {
      await DeviceRegistrar.shared.register(force: true)
      refresh()
    }
  }

  private func connectGmail(forceConsent: Bool) {
    gmailBusy = true
    gmailResult = "진행 중…"
    Task {
      gmailResult = await GmailConnect.run(forceConsent: forceConsent)
      gmailBusy = false
      refresh()
    }
  }

  private func runDebugCapture() {
    do {
      let pipeline = CapturePipeline(filter: RuleFilter(contactNames: ContactNames.cached()), queue: try CaptureQueue.shared())
      lastResult = try pipeline.handle(source: "NOTIFICATION", appName: "DebugButton", title: "디버그", sender: nil,
                                        text: "디버그 버튼에서 큐에 넣은 테스트 알림입니다")
      PoCLog.append("DebugButton \(lastResult)")
    } catch {
      lastResult = "error:\(error)"
    }
    refresh()
  }
}
