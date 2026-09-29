import Foundation

/// trace 배치 업로드 규칙(0.2.1, 09-29 중복 업로드 결함 대응). 앱의 TraceUploader 가 쓴다.
public enum TraceBatchOutcome: Equatable, Sendable {
  /// 2xx: 즉시 큐에서 지운다
  case sent
  /// HTTP 오류: 백오프(markFailed). 400 이면 배치 전체가 저장되지 않았다(서버 계약)
  case retry
  /// 응답 없음(오프라인·타임아웃·프로세스 정지 직전): background 세션으로 넘긴다
  case handOff

  public static func resolve(status: Int?) -> TraceBatchOutcome {
    guard let s = status else { return .handOff }
    return (200..<300).contains(s) ? .sent : .retry
  }
}

/// background 세션에 넘긴 trace 배치 표식(`taskDescription`)과, 아직 끝나지 않은 배치의 id 추출.
public enum TraceFlushGate {
  public static let prefix = "trace:"

  public static func taskDescription(ids: [String]) -> String { prefix + ids.joined(separator: ",") }

  public static func pendingIDs(taskDescriptions: [String?]) -> Set<String> {
    var out = Set<String>()
    for case let d? in taskDescriptions where d.hasPrefix(prefix) {
      d.dropFirst(prefix.count).split(separator: ",").forEach { out.insert(String($0)) }
    }
    return out
  }
}
