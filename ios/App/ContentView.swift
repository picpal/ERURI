import SwiftUI
import UIKit
import UserNotifications
import EventKit
import EruriCore

struct ContentView: View {
  @State private var account = "확인 중"
  @State private var busy = false
  @State private var perms = ""
  @State private var gmail = ""
  @State private var diagnostics = Diagnostics.isEnabled()
  @State private var resultNotice = CaptureResultNotice.isEnabled()
  @State private var copied = false

  var body: some View {
    NavigationStack {
      List {
        Section("계정") {
          Text(account).font(.caption).foregroundStyle(account.hasPrefix("로그인 실패") ? .red : .secondary)
          Button("Apple로 로그인") { busy = true; Task { account = await AppleSignIn.shared.run(); busy = false; await refresh() } }.disabled(busy)
          Button("로그아웃", role: .destructive) { Task { await SupabaseSession.shared.logout(); APNsDevice.clearRegistration(); account = "로그인 필요"; await refresh() } }
        }
        Section("권한") {
          Button("권한 요청 (알림·캘린더·연락처)") { requestPermissions() }
          if !perms.isEmpty { Text(perms).font(.caption).foregroundStyle(.secondary) }
        }
        Section("Gmail") {
          if !gmail.isEmpty { Text(gmail).font(.caption).foregroundStyle(gmail.contains("다시 연결") ? .orange : .secondary) }
          Button("Gmail 연결") { connectGmail(false) }.disabled(busy || !GmailConnect.configured)
          Button("다시 연결 (동의 다시 받기)") { connectGmail(true) }.disabled(busy || !GmailConnect.configured)
        }
        Section("진단") {
          Toggle("진단 전송", isOn: $diagnostics).onChange(of: diagnostics) { _, v in
            Diagnostics.set(v)                                                   // 끄면 큐의 trace 도 지운다(스펙 §8)
            if !v { Task { await TraceUploader.shared.cancelHandedOff() } }
          }
          Toggle("저장 결과 알림", isOn: $resultNotice).onChange(of: resultNotice) { _, v in CaptureResultNotice.set(v) }
          Button(copied ? "복사됨" : "진단 정보 복사") { copyDiagnostics() }
        }
        Section("데이터") {
          Button("계정 전체 삭제", role: .destructive) {}.disabled(true)        // 자리: M2-⑥b 에서 연결(스펙 §12 통제 5)
          Text("삭제 기능은 다음 버전에서 제공됩니다").font(.caption).foregroundStyle(.secondary)
        }
        Section { Text("ERURI \(Self.version) (\(Trace.build))").font(.caption).foregroundStyle(.secondary) }
      }
      .navigationTitle("ERURI")
      .task { await refresh() }
    }
  }

  static var version: String { Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "-" }

  private func refresh() async {
    let signedIn = await SupabaseSession.shared.accessToken() != nil
    // 실패 문구는 세션이 없을 때만 남긴다(다른 경로로 세션이 생기면 "로그인됨")
    account = signedIn ? "로그인됨" : (account.hasPrefix("로그인 실패") ? account : "로그인 필요")
    gmail = signedIn ? await gmailStatus() : ""
  }
  /// 연결 상태(RLS: 자기 connections). 계정 주소는 사용자 본인 화면에만 보인다
  private func gmailStatus() async -> String {
    guard let r = await API.send("rest/v1/connections?select=account_ref,status,expires_at&provider=eq.gmail"), r.status == 200,
          let rows = try? JSONSerialization.jsonObject(with: r.data) as? [[String: Any]] else { return "" }
    guard let c = rows.first else { return "연결 안 됨" }
    let st = c["status"] as? String ?? "-"
    return st == "active" ? "연결됨 · \(c["account_ref"] as? String ?? "")" : "다시 연결 필요 (\(st))"
  }
  private func connectGmail(_ force: Bool) {
    busy = true
    Task { gmail = await GmailConnect.run(forceConsent: force); busy = false; await refresh() }
  }
  private func requestPermissions() {
    Task {
      let granted = (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])) ?? false
      if granted { PushRegistration.registerRemote() }
      let cal = (try? await EKEventStore().requestFullAccessToEvents()) ?? false
      ContactsLoader.requestAccess()
      NotificationActions.register()
      perms = "알림 \(granted ? "허용" : "거부") · 캘린더 \(cal ? "허용" : "거부")"
    }
  }
  private func copyDiagnostics() {
    let lines = DiagLog.tail(lines: 200).filter { $0.range(of: "fail|error|실패|skipped|missing|rejected", options: .regularExpression) != nil }.suffix(30)
    UIPasteboard.general.string = (["ERURI \(Self.version) (\(Trace.build)) · iOS \(UIDevice.current.systemVersion)"] + lines).joined(separator: "\n")
    copied = true
  }
}
