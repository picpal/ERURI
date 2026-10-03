import Foundation

/// "최근 폐기"(스펙 §7): 서버 분류 게이트가 7일 격리 중인 항목의 메타(본문 없음)와 복구 결과 해석. 화면은 App/RecentDiscardsView
public enum RecentDiscards {
  public struct Row: Identifiable, Decodable, Sendable {
    public let id: String; public let source: String; public let app_name: String?; public let sender: String?; public let title: String?
    public let gate_label: String?; public let gate_confidence: Double?; public let occurred_at: String

    public var titleLine: String { title ?? "(제목 없음)" }
    public var originLine: String { [app_name ?? source, sender ?? ""].filter { !$0.isEmpty }.joined(separator: " · ") }
    public var gateLine: String {
      "\(RecentDiscards.labelKo(gate_label)) · \(Int(((gate_confidence ?? 0) * 100).rounded()))% · \(occurred_at.prefix(10))"
    }
  }

  /// RLS 로 자기 행만. 본문 열은 요청하지 않는다. 격리 기한(quarantine_until)이 지금보다 뒤 = 게이트 폐기 후 복구 가능 기간(0010).
  /// 기한이 지난 행은 purge(일 1회)가 null 로 만들기 전까지 남아 있으므로 not.is.null 로는 거르지 못한다(최종 리뷰 M1-④b)
  /// filter = 보관함에서 고른 출처 탭(전체면 조건 없음)
  public static func query(now: Date = Date(), filter: Archive.Filter = .all) -> String {
    "rest/v1/items?select=id,source,app_name,sender,title,gate_label,gate_confidence,occurred_at"
      + "&quarantine_until=gt.\(ISO8601DateFormatter().string(from: now))&order=occurred_at.desc&limit=300" + filter.sourceCondition
  }

  /// 화면 제목: 전체면 "최근 폐기", 출처 탭이면 "최근 폐기 · 메일"
  public static func title(filter: Archive.Filter) -> String { filter == .all ? "최근 폐기" : "최근 폐기 · \(filter.label)" }

  public static func decode(_ data: Data) -> [Row]? { try? JSONDecoder().decode([Row].self, from: data) }

  public static func labelKo(_ l: String?) -> String {
    ["personal": "개인 대화", "promo": "광고", "otp": "인증번호", "notice": "안내", "medical_result": "의료 결과"][l ?? ""] ?? (l ?? "-")
  }

  public static func summary(count: Int) -> String {
    count == 0 ? "최근 7일 안에 폐기된 항목이 없습니다" : "\(count)건 · 7일이 지나면 본문이 지워집니다"
  }

  /// restore_discarded RPC 응답 → queued|not_found|expired|not_discarded, 그 외 http_<status>·network
  public static func restoreResult(status: Int?, data: Data?) -> String {
    guard let status, let data else { return "network" }
    guard status == 200, let s = (try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])) as? String else { return "http_\(status)" }
    return s
  }

  public static func restoreMessage(_ result: String) -> String {
    switch result {
    case "queued": return "복구했습니다. 잠시 뒤 다시 처리됩니다"
    case "expired": return "7일이 지나 복구할 수 없습니다"
    case "not_discarded": return "이미 복구됐거나 폐기 항목이 아닙니다"
    default: return "복구 실패: \(result)"
    }
  }

  // MARK: 복구 뒤 진행 상태(진단 10-03: 복구하면 행이 사라지고 결과가 보관함 라벨뿐이라 "반응 없음"으로 보였다)

  /// processing = 아직(행에 "처리 중…"), timedOut = 상한(pollTries)까지 끝나지 않음
  public enum RestoreState: Equatable, Sendable { case processing, proposed(Int), task, noSchedule, failed, timedOut }

  /// 3초 × 30회 = 최대 90초. 복구 RPC 는 워커를 깨우지 않아 분당 cron 을 기다린다(진단 실측 31초 대기 + 처리 3초, 최악 ~65초)
  public static let pollEvery: Duration = .seconds(3)
  public static let pollTries = 30

  /// 본인 행만(RLS). 상태·종류 열만 읽고 본문 열은 요청하지 않는다
  public static func itemStatusQuery(itemID: String) -> String { "rest/v1/items?select=status&id=eq.\(itemID)" }
  /// 가장 최근 process 잡 = 복구가 넣은 잡. dead(5회 실패)여도 items 는 queued 로 남으므로 이것이 유일한 실패 신호다
  public static func jobStatusQuery(itemID: String) -> String {
    "rest/v1/jobs?select=status&kind=eq.process&payload-%3E%3Eitem_id=eq.\(itemID)&order=created_at.desc&limit=1"
  }
  /// 채팅 링크·사진 결과(LinkCapture.result)와 같은 기준: 활성 facts 의 종류
  public static func factKindsQuery(itemID: String) -> String { "rest/v1/facts?select=kind&status=eq.active&item_id=eq.\(itemID)" }

  /// nil = 아직. queued 는 잡이 dead 일 때만 실패, extracted 는 일정 수·할 일, empty 는 일정 없음, 그 밖 폐기(서버 규칙)는 실패
  public static func restoreState(itemStatus: String?, jobStatus: String?, kinds: [String]) -> RestoreState? {
    guard let itemStatus else { return nil }
    switch itemStatus {
    case "queued": return jobStatus == "dead" ? .failed : nil
    case "extracted":
      let events = kinds.filter { $0 == "event" }.count
      return events > 0 ? .proposed(events) : kinds.contains("task") ? .task : .noSchedule
    case "discarded:server:empty": return .noSchedule
    default: return itemStatus.hasPrefix("discarded:") ? .failed : nil
    }
  }

  public static func restoreLine(_ s: RestoreState) -> String {
    switch s {
    case .processing: return "처리 중…"
    case .proposed(let n): return "일정 제안 \(n)건 — '제안' 탭과 알림에서 추가할 수 있어요"
    case .task: return "할 일을 찾았어요 — 알림에서 확인하세요"
    case .noSchedule: return "일정을 찾지 못했어요 · 보관함에 보관됨"
    case .failed: return "처리하지 못했어요"
    case .timedOut: return "아직 처리 중이에요 — 보관함에서 확인하세요"
    }
  }

  /// 복구한 항목의 결과를 기다린다. wait = 회차 사이 대기(화면은 pollEvery 잠, 취소되면 바로 돌아온다), get = 경로 → 200 응답 본문(아니면 nil).
  /// 읽기 실패는 단정하지 않고 다음 회차에 다시 본다. 취소되면 processing 을 돌려준다(화면을 떠남 — 결과는 보관함 라벨로 이어진다)
  /// 호출한 쪽 격리(화면은 MainActor)에서 돈다 — wait·get 은 Sendable 이 아니어도 된다
  public static func pollRestore(itemID: String, tries: Int = pollTries, isolation: isolated (any Actor)? = #isolation,
                                 wait: () async -> Void, get: (String) async -> Data?) async -> RestoreState {
    for _ in 0..<tries {
      await wait()
      if Task.isCancelled { return .processing }
      if let s = await check(itemID: itemID, isolation: isolation, get: get) { return s }
    }
    return .timedOut
  }

  static func check(itemID: String, isolation: isolated (any Actor)?, get: (String) async -> Data?) async -> RestoreState? {
    guard let status = strings(await get(itemStatusQuery(itemID: itemID)), "status")?.first else { return nil }
    switch status {
    case "queued":
      return restoreState(itemStatus: status, jobStatus: strings(await get(jobStatusQuery(itemID: itemID)), "status")?.first, kinds: [])
    case "extracted":
      guard let kinds = strings(await get(factKindsQuery(itemID: itemID)), "kind") else { return nil }
      return restoreState(itemStatus: status, jobStatus: nil, kinds: kinds)
    default:
      return restoreState(itemStatus: status, jobStatus: nil, kinds: [])
    }
  }

  /// PostgREST 배열 → 각 행의 문자열 열. 배열이 아니면 nil
  private static func strings(_ data: Data?, _ key: String) -> [String]? {
    guard let data, let rows = (try? JSONSerialization.jsonObject(with: data)) as? [[String: Any]] else { return nil }
    return rows.compactMap { $0[key] as? String }
  }
}
