import SwiftUI
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
  @State private var tracePassword = ""

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
        // PoC-6: Google 로그인 → serverAuthCode → gmail-connect. 비밀번호는 `sim.sh gmail` 이 launch argument 로 넘긴다
        Section("Gmail (PoC-6)") {
          Button("Gmail 연결") { connectGmail(forceConsent: false) }.disabled(gmailBusy).accessibilityIdentifier("gmailConnect")
          Button("재동의 연결 (disconnect 후)") { connectGmail(forceConsent: true) }.disabled(gmailBusy)
            .accessibilityIdentifier("gmailReconsent")
          if !gmailResult.isEmpty {
            Text(gmailResult).font(.caption).foregroundStyle(.secondary).accessibilityIdentifier("gmailResult")
          }
        }
        // PoC 추적 이벤트 → ingest/trace. 업로드 토글은 두지 않는다(PoC 빌드 전용). 실기기는 여기서 한 번 로그인한다
        Section("추적 (PoC)") {
          Text(traceStatus).font(.caption).foregroundStyle(.secondary).accessibilityIdentifier("traceStatus")
          SecureField("PoC 사용자 비밀번호", text: $tracePassword).textContentType(.password).accessibilityIdentifier("tracePassword")
          Button("로그인") { traceLogin() }.disabled(tracePassword.isEmpty).accessibilityIdentifier("traceLogin")
        }
                // 업로드 서버 주소. App Group 에 저장돼 홈 화면에서 다시 열어도 유지된다.
        Section("업로드 서버") {
          TextField("http://<MAC_IP>:<PORT>", text: $ingestURL)
            .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
            .accessibilityIdentifier("ingestURLField")
          Button("저장") { saveIngestURL() }.accessibilityIdentifier("ingestURLSave")
          Text("현재: \(ingestCurrent)").font(.caption).foregroundStyle(.secondary).accessibilityIdentifier("ingestURLCurrent")
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
    Task {
      let session = await SupabaseSession.shared.hasSession
      traceStatus = "device \(Trace.deviceID.prefix(8)) · build \(Trace.build) · 대기 \(pending)건 · 세션 \(session ? "있음" : "없음")"
    }
    if ingestURL.isEmpty { ingestURL = ingestCurrent }
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

  private func traceLogin() {
    let pw = tracePassword
    tracePassword = ""
    Task {
      let ok = await SupabaseSession.shared.login(password: pw)
      PoCLog.append("trace login \(ok ? "ok" : "failed")")
      if ok { Uploader.shared.flush() }
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
