import Foundation

/// 실패·멈춘 항목을 저장된 글로 다시 처리(스펙 §7 `retry_item`, §9 "이미 읽은 링크"·채팅 일정 등록 "같은 글", §10 항목 상세 [다시 처리], 0.16.1 추가 1).
/// 페이지를 다시 받지 않는다. 판단·문구만 — RPC 호출·결과 확인은 앱(LinkCapture·ItemDetailView)
public enum ItemRetry {
  public static let rpcPath = "rest/v1/rpc/retry_item"
  /// 3초 × 30 = 90초. RPC 는 워커를 깨우지 않아 분당 cron 을 기다린다(복구 행과 같다)
  public static let pollTries = RecentDiscards.pollTries

  public static let retryingLink = "이미 읽은 링크예요. 저장된 글로 다시 처리해요 — 일정을 찾는 중…"
  public static let retryingEvent = "이미 등록한 글이에요. 저장된 글로 다시 등록하는 중…"
  public static let retrying = "다시 처리하는 중…"
  public static let failedLine = "처리하지 못했어요"
  public static let buttonTitle = "다시 처리"
  public static let expired = "원문이 만료돼 다시 처리할 수 없어요"
  public static let chatFailed = "다시 처리하지 못했어요 — 잠시 뒤 다시 보내 주세요"
  public static let detailFailed = "다시 처리하지 못했어요 — 잠시 뒤 다시 눌러 주세요"

  /// 같은 링크·같은 글 경로에서 RPC 를 부를 항목 상태. queued 라도 잡이 살아 있으면 서버가 processing 으로 답한다
  public static func shouldTry(status: String) -> Bool { status == "failed" || status == "queued" }

  /// 항목 상세 버튼: failed, 또는 queued 인데 가장 최근 process 잡이 dead(0034 전에 dead 가 된 항목)
  public static func canRetry(itemStatus: String?, jobStatus: String?) -> Bool {
    itemStatus == "failed" || (itemStatus == "queued" && jobStatus == "dead")
  }

  /// RPC 응답 → queued|processing|not_failed|not_found|expired, 그 외 http_<status>·network(복구 RPC 와 같은 해석)
  public static func result(status: Int?, data: Data?) -> String { RecentDiscards.restoreResult(status: status, data: data) }

  /// 채팅 중복 경로의 다음 단계
  public enum ChatStep: Equatable, Sendable { case poll, found, text(String) }
  public static func chatStep(_ result: String) -> ChatStep {
    switch result {
    case "queued": return .poll
    case "not_failed": return .found
    case "processing": return .text(LinkCaptureText.pending)
    case "expired": return .text(expired)
    default: return .text(chatFailed)
    }
  }

  /// 항목 상세 버튼의 다음 단계. 오류만 버튼을 남긴다(다시 눌러 볼 수 있다)
  public enum DetailStep: Equatable, Sendable { case poll, hide, text(String, keepButton: Bool) }
  public static func detailStep(_ result: String) -> DetailStep {
    switch result {
    case "queued": return .poll
    case "not_failed": return .hide
    case "processing": return .text(LinkCaptureText.pending, keepButton: false)
    case "expired": return .text(expired, keepButton: false)
    default: return .text(detailFailed, keepButton: true)
    }
  }

  /// PostgREST 배열 첫 행의 문자열 열. 배열이 아니거나 비면 nil
  public static func firstString(_ data: Data?, _ key: String) -> String? {
    guard let data, let rows = (try? JSONSerialization.jsonObject(with: data)) as? [[String: Any]] else { return nil }
    return rows.first?[key] as? String
  }
}
