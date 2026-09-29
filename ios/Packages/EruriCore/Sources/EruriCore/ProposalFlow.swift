import Foundation

/// 알림 액션 핸들러의 판단(스펙 §10). EventKit·네트워크 없이 테스트한다
public enum ProposalFlow {
  public enum Check: Equatable, Sendable { case proceed, stop(reason: String) }
  public enum FollowUp: Equatable, Sendable { case done, doneNotifyChanged, retryLater }

  /// 순서 1: 서버 최신 상태가 stale·succeeded 면 중단. nil(오프라인·오류)이면 받은 버전으로 진행(순서 5)
  public static func check(serverStatus: String?) -> Check {
    switch serverStatus {
    case "stale": return .stop(reason: "stale")
    case "succeeded": return .stop(reason: "succeeded")
    default: return .proceed
    }
  }
  /// 저장 이벤트의 url 표식(§10 "저장 후 기록 전 종료" 복구). 스킴은 스펙 §10 문구 그대로(앱이 여는 URL 스킴이 아니다)
  public static func marker(_ pid: String) -> URL { URL(string: "assistant://proposal/\(pid)")! }
  public static func searchWindow(start: Date) -> (Date, Date) { (start.addingTimeInterval(-86_400), start.addingTimeInterval(86_400)) }
  /// 제안 시각 ±1일 이벤트 중 같은 표식을 가진 것의 식별자
  public static func matchMarker(pid: String, events: [(id: String, url: URL?)]) -> String? {
    let m = marker(pid)
    return events.first { $0.url == m }?.id
  }
  /// 순서 4·5: report_execution 결과. nil = 보고 실패(다음 앱 실행 때 재전송)
  public static func reportFollowUp(_ result: String?) -> FollowUp {
    switch result {
    case nil: return .retryLater
    case "changed", "stale": return .doneNotifyChanged
    default: return .done
    }
  }
}
