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

  public enum Filter: String, CaseIterable, Sendable {
    case all, mail, notification, share
    /// 보관함·최근 폐기 공통 source 조건. 전체면 조건 없음
    public var sourceCondition: String {
      switch self {
      case .all: ""
      case .mail: "&source=eq.GMAIL"
      case .notification: "&source=in.(NOTIFICATION,MESSAGES)"          // 문자는 알림으로 들어온 것과 같이 보인다(SourceLabel)
      case .share: "&source=eq.SHARE"
      }
    }
    /// 탭 이름(Picker 와 같은 문구)
    public var label: String {
      switch self { case .all: "전체"; case .mail: "메일"; case .notification: "알림·문자"; case .share: "공유" }
    }
  }

  public static let pageSize = 50

  /// 채팅 "보관함에서 보기"(스펙 §9, 2026-10-01): 그 질문의 검색 후보(순위순 item id)만 보이는 범위. 앱 메모리에만 둔다
  public struct Scope: Equatable, Sendable {
    public static let maxIDs = 100
    public let question: String
    public let ids: [String]
    public init(question: String, ids: [String]) {
      var seen = Set<String>()
      self.question = question
      self.ids = Array(ids.filter { seen.insert($0).inserted }.prefix(Self.maxIDs))
    }
    /// 머리 줄: "채팅 검색 결과 N건 · ‘질문 앞 20자…’"
    public var label: String {
      let q = question.trimmingCharacters(in: .whitespacesAndNewlines)
      return "채팅 검색 결과 \(ids.count)건 · ‘\(q.count > 20 ? String(q.prefix(20)) + "…" : q)’"
    }
    /// page 번째 id 조각(pageSize 개씩). 범위 밖이면 빈 배열
    public func slice(page: Int) -> [String] {
      let start = page * Archive.pageSize
      guard page >= 0, start < ids.count else { return [] }
      return Array(ids[start..<min(start + Archive.pageSize, ids.count)])
    }
    public func hasMore(afterPage page: Int) -> Bool { (page + 1) * Archive.pageSize < ids.count }
    /// 서버 행(순서 없음)을 검색 순위로. 범위에 없는 행은 버린다
    public func ordered(_ rows: [Row]) -> [Row] {
      let rank = Dictionary(uniqueKeysWithValues: ids.enumerated().map { ($1, $0) })
      return rows.filter { rank[$0.id] != nil }.sorted { rank[$0.id]! < rank[$1.id]! }
    }
    /// page 부터 조각을 불러 행이 나올 때까지(출처 조건으로 빈 조각은 건너뜀). lastPage = 마지막으로 부른 조각. nil = 실패
    public func load(from page: Int, fetch: @Sendable ([String]) async -> [Row]?) async -> (rows: [Row], lastPage: Int)? {
      var p = max(page, 0)
      while true {
        let part = slice(page: p)
        if part.isEmpty { return ([], max(p - 1, 0)) }
        guard let got = await fetch(part) else { return nil }
        let rows = ordered(got)
        if !rows.isEmpty || !hasMore(afterPage: p) { return (rows, p) }
        p += 1
      }
    }
  }

  /// 범위 모드 쿼리: 보관함과 같은 메타 열 + id 조각 + 출처 조건. 순서는 앱이 순위로 맞춘다. 본문 열은 요청하지 않는다
  public static func scopedQuery(ids: [String], filter: Filter) -> String {
    "rest/v1/items?select=id,source,app_name,sender,title,occurred_at,status,gate_label"
      + "&id=in.(\(ids.joined(separator: ",")))" + filter.sourceCondition
  }

  /// RLS 로 자기 행만. 본문 열은 요청하지 않는다. 같은 시각이 겹쳐도 페이지가 흔들리지 않게 id 로 한 번 더 정렬
  public static func query(filter: Filter, offset: Int) -> String {
    "rest/v1/items?select=id,source,app_name,sender,title,occurred_at,status,gate_label"
      + "&order=occurred_at.desc,id.desc&limit=\(pageSize)&offset=\(offset)" + filter.sourceCondition
  }

  public static func decode(_ data: Data) -> [Row]? { try? JSONDecoder().decode([Row].self, from: data) }
  public static func hasMore(pageCount: Int) -> Bool { pageCount == pageSize }

  public static func statusKo(_ s: String) -> String {
    switch s {
    case "extracted": return "추출됨"
    case "queued": return "처리 중"
    case "discarded:server:empty": return "일정 없음(보관)"                  // 게이트는 통과(또는 복구), 추출할 것이 없어 원문만 보관
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
