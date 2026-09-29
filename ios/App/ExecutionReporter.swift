import Foundation
import UserNotifications
import EruriCore

/// 스펙 §10 순서 4: 로컬 executions 의 미보고 항목을 report_execution 으로 보낸다. 실패는 다음 앱 실행 때 다시(순서 4).
/// actor 로 두어 앱 활성화 flush 와 알림 액션 보고가 겹쳐도 같은 행을 두 번 보내지 않는다("변경된 제안" 알림 2번 방지)
actor ExecutionReporter {
  static let shared = ExecutionReporter()
  private var sending: Set<String> = []

  /// 앱 활성화: 미보고 전부(마감 없음 — 포그라운드)
  func flush() async {
    guard let ex = try? Executions.shared(), let rows = try? ex.unreported() else { return }
    for r in rows { await send(proposalId: r.proposalId, eventkitId: r.eventkitId, version: r.version, ex: ex, within: nil) }
  }

  /// 알림 액션 핸들러: 방금 처리한 1건만, 토큰 갱신까지 포함해 `seconds` 안에. 넘기면 앱 활성화 flush 가 다시 보낸다
  func report(proposalId pid: String, within seconds: TimeInterval) async {
    guard let ex = try? Executions.shared(), let r = try? ex.unreported().first(where: { $0.proposalId == pid }) else { return }
    await send(proposalId: r.proposalId, eventkitId: r.eventkitId, version: r.version, ex: ex, within: seconds)
  }

  private struct Reply: Sendable { let status: Int; let result: String? }

  private func send(proposalId pid: String, eventkitId: String, version: Int, ex: Executions, within seconds: TimeInterval?) async {
    guard sending.insert(pid).inserted else { return }
    defer { sending.remove(pid) }
    let at = ISO8601DateFormatter().string(from: (try? ex.executedAt(proposalId: pid)) ?? Date())
    let device = Trace.deviceID
    let post: @Sendable () async -> Reply? = {
      guard let res = await API.send("rest/v1/rpc/report_execution", method: "POST", json: [
        "p_proposal": pid, "p_device": device, "p_eventkit_id": eventkitId, "p_version": version, "p_executed_at": at])
      else { return Reply(status: -1, result: nil) }
      let result = res.status == 200 ? (try? JSONSerialization.jsonObject(with: res.data, options: [.fragmentsAllowed])) as? String : nil
      return Reply(status: res.status, result: result)
    }
    let reply: Reply?
    if let seconds { reply = await Deadline.run(seconds: seconds, post) } else { reply = await post() }
    switch ProposalFlow.reportFollowUp(reply?.result) {
    case .retryLater: DiagLog.append("report retry \(pid) status=\(reply.map { "\($0.status)" } ?? "deadline")")
    case .done: try? ex.markReported(proposalId: pid)
    case .doneNotifyChanged:
      try? ex.markReported(proposalId: pid)
      await Self.notice(title: "변경된 제안", body: "캘린더에 추가한 뒤 제안이 바뀌었습니다. 앱에서 확인하세요.")
    }
  }

  static func notice(title: String, body: String) async {
    let c = UNMutableNotificationContent(); c.title = title; c.body = body
    try? await UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: UUID().uuidString, content: c, trigger: nil))
  }
}
