import Foundation
import UserNotifications
import EruriCore

/// 스펙 §10 순서 4: 로컬 executions 의 미보고 항목을 report_execution 으로 보낸다. 실패는 다음 앱 실행 때 다시(순서 4)
enum ExecutionReporter {
  static func flush() async {
    guard let ex = try? Executions.shared(), let rows = try? ex.unreported(), !rows.isEmpty else { return }
    for r in rows {
      let at = (try? ex.executedAt(proposalId: r.proposalId)) ?? Date()
      let res = await API.send("rest/v1/rpc/report_execution", method: "POST", json: [
        "p_proposal": r.proposalId, "p_device": Trace.deviceID, "p_eventkit_id": r.eventkitId,
        "p_version": r.version, "p_executed_at": ISO8601DateFormatter().string(from: at)])
      let result: String? = (res?.status == 200) ? (try? JSONSerialization.jsonObject(with: res!.data, options: [.fragmentsAllowed])) as? String : nil
      switch ProposalFlow.reportFollowUp(result) {
      case .retryLater: DiagLog.append("report retry \(r.proposalId) status=\(res?.status ?? -1)")
      case .done: try? ex.markReported(proposalId: r.proposalId)
      case .doneNotifyChanged:
        try? ex.markReported(proposalId: r.proposalId)
        await notice(title: "변경된 제안", body: "캘린더에 추가한 뒤 제안이 바뀌었습니다. 앱에서 확인하세요.")
      }
    }
  }
  static func notice(title: String, body: String) async {
    let c = UNMutableNotificationContent(); c.title = title; c.body = body
    try? await UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: UUID().uuidString, content: c, trigger: nil))
  }
}
