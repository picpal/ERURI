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
  @State private var confirmSource = false
  @State private var confirmAccount = false
  @State private var deleteResult = ""
  @State private var usage = ""
  @State private var confirmChat = false
  @State private var needsUpgrade = false
  @State private var upgradeResult = ""

  var body: some View {
    NavigationStack {
      List {
        Section("계정") {
          Text(account).font(.caption).foregroundStyle(account.hasPrefix("로그인 실패") ? .red : .secondary)
          Button("Apple로 로그인") { busy = true; Task { account = await AppleSignIn.shared.run(); busy = false; await refresh() } }.disabled(busy)
          Button("로그아웃", role: .destructive) { Task { await SupabaseSession.shared.logout(); APNsDevice.clearRegistration(); ChatLog.shared.clear(); account = "로그인 필요"; await refresh() } }
        }
        Section("권한") {
          Button("권한 요청 (알림·캘린더·연락처)") { requestPermissions() }
          if !perms.isEmpty { Text(perms).font(.caption).foregroundStyle(.secondary) }
        }
        Section("Gmail") {
          if !gmail.isEmpty { Text(gmail).font(.caption).foregroundStyle(gmail.contains("다시 연결") ? .orange : .secondary) }
          Button("Gmail 연결") { connectGmail(false) }.disabled(busy || !GmailConnect.configured)
          Button("다시 연결 (동의 다시 받기)") { connectGmail(true) }.disabled(busy || !GmailConnect.configured)
          if needsUpgrade {                                      // 스펙 §7 권한 업데이트(0.14.0): 연결돼 있고 modify 가 없을 때만(D16)
            Button(MailCleanupText.upgradeButton) { upgradeGmail() }.disabled(busy || !GmailConnect.configured)
              .accessibilityIdentifier("settings-gmail-upgrade")
            Text(MailCleanupText.upgradeNote).font(.caption2).foregroundStyle(.secondary)
          }
          if !upgradeResult.isEmpty {
            Text(upgradeResult).font(.caption).foregroundStyle(.secondary).accessibilityIdentifier("settings-gmail-upgrade-result")
          }
          NavigationLink("광고 메일 구독 해지") { UnsubscribeView() }        // 스펙 §7 광고 구독 해지(0.10.0)
            .accessibilityIdentifier("settings-unsubscribe")
        }
        Section("채팅") {                                                       // 스펙 §9 "대화 기록·짧은 맥락"·§12 통제 5
          Button(ChatHistoryText.settingsTitle, role: .destructive) { confirmChat = true }
            .accessibilityIdentifier("settings-clear-chat")
          Text(ChatHistoryText.settingsNote).font(.caption2).foregroundStyle(.secondary)
        }
        Section("이번 달 사용") {                                              // 스펙 §13 월 상한(M2-⑦)
          Text(usage.isEmpty ? "-" : usage).font(.caption).foregroundStyle(usage.contains("중단") ? .red : .secondary)
        }
        Section("진단") {
          Toggle("진단 전송", isOn: $diagnostics).onChange(of: diagnostics) { _, v in
            Diagnostics.set(v)                                                   // 끄면 큐의 trace 도 지운다(스펙 §8)
            if !v { Task { await TraceUploader.shared.cancelHandedOff() } }
          }
          Toggle("저장 결과 알림", isOn: $resultNotice).onChange(of: resultNotice) { _, v in CaptureResultNotice.set(v) }
          Button(copied ? "복사됨" : "진단 정보 복사") { copyDiagnostics() }
        }
        Section("데이터") {                                                    // 스펙 §12 통제 5 1단계 버튼 2개(M2-⑥)
          Button("Gmail 데이터 삭제 (연결 해제)", role: .destructive) { confirmSource = true }
          Button("계정 전체 삭제", role: .destructive) { confirmAccount = true }
          if !deleteResult.isEmpty { Text(deleteResult).font(.caption).foregroundStyle(.secondary) }
          Text("서버 백업(최대 7일)에는 삭제 전 상태가 남습니다. 계정 삭제는 암호화 키를 파기해 백업의 원문도 복구할 수 없게 합니다.")
            .font(.caption2).foregroundStyle(.secondary)
        }
        Section { Text("ERURI \(Self.version) (\(Trace.build))").font(.caption).foregroundStyle(.secondary) }
      }
      .navigationTitle("설정")
      // 확인창은 List 에 단다. Section(List 행 컨테이너)에 달면 표시되지 않는다(최종 리뷰 M2-⑥b)
      .alert("Gmail에서 가져온 메일과 추출 결과를 모두 지우고 연결을 끊을까요?", isPresented: $confirmSource) {
        Button("삭제", role: .destructive) { Task { deleteResult = await deleteSource() } }
        Button("취소", role: .cancel) {}
      } message: {
        Text(ChatHistoryText.gmailDeleteNote)                          // 출처 삭제는 기기 채팅 기록을 지우지 않는다(§9 "경계" (b), 0.13.0)
      }
      .alert("모든 데이터와 계정을 지울까요? 되돌릴 수 없습니다.", isPresented: $confirmAccount) {
        Button("전체 삭제", role: .destructive) { Task { deleteResult = await deleteAccount() } }
        Button("취소", role: .cancel) {}
      }
      .alert(ChatHistoryText.clearConfirm, isPresented: $confirmChat) {
        Button("지우기", role: .destructive) { ChatLog.shared.clear() }
        Button("취소", role: .cancel) {}
      }
      .task { await refresh() }
    }
  }

  static var version: String { Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "-" }

  private func refresh() async {
    let signedIn = await SupabaseSession.shared.accessToken() != nil
    // 실패 문구는 세션이 없을 때만 남긴다(다른 경로로 세션이 생기면 "로그인됨")
    account = signedIn ? "로그인됨" : (account.hasPrefix("로그인 실패") ? account : "로그인 필요")
    gmail = signedIn ? await gmailStatus() : ""
    needsUpgrade = signedIn ? await gmailNeedsUpgrade() : false
    if !needsUpgrade { upgradeResult = "" }                     // 버튼이 사라졌으면(로그아웃·연결 상태 바뀜) 옛 결과 문구도 — 방금 업데이트한 결과는 upgradeGmail 이 refresh 뒤에 쓴다(M9a 리뷰 Minor 1)
    usage = signedIn ? await usageStatus() : ""
  }
  /// rpc/usage_status(0014, auth.uid() 기준): 이번 달 예약 금액 / 상한 · 강등·중단 표시
  private func usageStatus() async -> String {
    guard let r = await API.send("rest/v1/rpc/usage_status", method: "POST", json: [String: String]()), r.status == 200 else { return "" }
    return UsageStatus.label(r.data) ?? ""
  }
  /// 연결 상태(RLS: 자기 connections). 계정 주소는 사용자 본인 화면에만 보인다
  private func gmailStatus() async -> String {
    guard let r = await API.send("rest/v1/connections?select=account_ref,status,expires_at&provider=eq.gmail"), r.status == 200,
          let rows = try? JSONSerialization.jsonObject(with: r.data) as? [[String: Any]] else { return "" }
    guard let c = rows.first else { return "연결 안 됨" }
    let st = c["status"] as? String ?? "-"
    return st == "active" ? "연결됨 · \(c["account_ref"] as? String ?? "")" : "다시 연결 필요 (\(st))"
  }
  /// Edge account/source(M2-⑥a): 토큰 revoke → Gmail 항목·사실·잡·연결 삭제. 응답은 개수만
  private func deleteSource() async -> String {
    guard let r = await API.send("functions/v1/account/source", method: "POST", json: ["provider": "gmail"], timeout: 60), r.status == 200,
          let o = try? JSONSerialization.jsonObject(with: r.data) as? [String: Any] else { return "삭제 실패" }
    await refresh()
    return "Gmail 데이터 삭제됨 (연결 \(o["connections"] as? Int ?? 0)개)"
  }
  /// Edge account/delete(M2-⑥a): 서버 삭제가 끝난 뒤에만 기기를 정리한다(삭제 푸시가 늦거나 안 와도 이 기기는 정리)
  private func deleteAccount() async -> String {
    guard let r = await API.send("functions/v1/account/delete", method: "POST", timeout: 60), r.status == 200 else { return "삭제 실패" }
    LocalWipe.runShared()
    ChatLog.shared.clear()
    ChatLog.shared.forgetOwner()
    APNsDevice.clearRegistration()
    await SupabaseSession.shared.logout()
    await refresh()
    return "계정과 데이터가 삭제되었습니다"
  }
  private func connectGmail(_ force: Bool) {
    busy = true
    upgradeResult = ""
    Task { gmail = await GmailConnect.run(forceConsent: force); busy = false; await refresh() }
  }
  /// [권한 업데이트] 표시(D16): scopes 를 상태 줄과 따로 읽는다 — 열이 없는 서버(0030 전, 400)면 숨긴다. 판단은 EruriCore(needsUpgrade)
  private func gmailNeedsUpgrade() async -> Bool {
    guard let r = await API.send("rest/v1/connections?select=status,scopes&provider=eq.gmail"), r.status == 200,
          let rows = try? JSONSerialization.jsonObject(with: r.data) as? [[String: Any]] else { return false }
    return MailCleanup.needsUpgrade(rows: rows)
  }
  private func upgradeGmail() {
    busy = true
    Task { let r = await GmailConnect.upgrade(); busy = false; await refresh(); upgradeResult = r }
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

/// 채팅 → 설정 탭(메일 정리 [설정 열기], 0.14.0). 루트가 openCount 로 탭을 옮긴다(ArchiveRouter 와 같은 방식)
@MainActor @Observable final class SettingsRouter {
  static let shared = SettingsRouter()
  var openCount = 0
  func open() { openCount += 1 }
}
