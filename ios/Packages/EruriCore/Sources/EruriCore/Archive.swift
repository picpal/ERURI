import Foundation

/// 보관함(스펙 §11): 본인 항목의 메타 목록(본문 없음)·게이트 통과 판정·"잘못 통과" 표시 상태. 화면은 App/ArchiveView
public enum Archive {
  public struct Row: Identifiable, Decodable, Sendable {
    public let id: String; public let source: String; public let app_name: String?; public let sender: String?; public let title: String?
    public let occurred_at: String; public let status: String; public let gate_label: String?

    public var titleLine: String { title ?? "(제목 없음)" }
    public var metaLine: String {
      [SourceLabel.label(source: source, appName: app_name), sender ?? "", String(occurred_at.prefix(10)), Archive.statusKo(status)]
        .filter { !$0.isEmpty }.joined(separator: " · ")
    }
    public var gatePassed: Bool { Archive.gatePassed(status: status, gateLabel: gate_label) }
  }

  public enum Filter: String, CaseIterable, Sendable { case all, mail, notification, share }

  public static let pageSize = 50

  /// RLS 로 자기 행만. 본문 열은 요청하지 않는다. 같은 시각이 겹쳐도 페이지가 흔들리지 않게 id 로 한 번 더 정렬
  public static func query(filter: Filter, offset: Int) -> String {
    var q = "rest/v1/items?select=id,source,app_name,sender,title,occurred_at,status,gate_label"
      + "&order=occurred_at.desc,id.desc&limit=\(pageSize)&offset=\(offset)"
    switch filter {
    case .all: break
    case .mail: q += "&source=eq.GMAIL"
    case .notification: q += "&source=in.(NOTIFICATION,MESSAGES)"          // 문자는 알림으로 들어온 것과 같이 보인다(SourceLabel)
    case .share: q += "&source=eq.SHARE"
    }
    return q
  }

  public static func decode(_ data: Data) -> [Row]? { try? JSONDecoder().decode([Row].self, from: data) }
  public static func hasMore(pageCount: Int) -> Bool { pageCount == pageSize }

  public static func statusKo(_ s: String) -> String {
    switch s {
    case "extracted": return "추출됨"
    case "queued": return "처리 중"
    case "discarded:server:empty": return "보관"                            // 게이트는 통과, 추출할 것이 없어 원문만 보관
    default: return s.hasPrefix("discarded:") ? "폐기" : s
    }
  }

  /// 게이트 통과 = Jev 라벨이 있고 상태가 그 라벨의 게이트 폐기(discarded:server:<label>)가 아님 — gate-report.ts 집계와 같은 기준
  public static func gatePassed(status: String, gateLabel: String?) -> Bool {
    guard let gateLabel else { return false }
    return status != "discarded:server:\(gateLabel)"
  }

  /// gate_feedback 행 해석. restored = "최근 폐기"에서 복구(wrong_discard) — 이미 정답이 있어 오통과 표시 대상이 아니다
  public enum Feedback: Equatable, Sendable { case none, wrongPass, restored, unknown }

  public static func feedbackQuery(itemID: String) -> String { "rest/v1/gate_feedback?item_id=eq.\(itemID)&select=verdict" }
  /// 취소는 wrong_pass 행만 지운다(복구 표시 wrong_discard 를 건드리지 않게)
  public static func unmarkPath(itemID: String) -> String { "rest/v1/gate_feedback?item_id=eq.\(itemID)&verdict=eq.wrong_pass" }

  public static func feedback(status: Int?, data: Data?) -> Feedback {
    guard status == 200, let data, let rows = (try? JSONSerialization.jsonObject(with: data)) as? [[String: Any]] else { return .unknown }
    switch rows.first?["verdict"] as? String {
    case "wrong_pass": return .wrongPass
    case "wrong_discard": return .restored
    default: return .none
    }
  }

  public static func succeeded(_ status: Int?) -> Bool { status.map { (200..<300).contains($0) } ?? false }
}
