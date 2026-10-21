import Foundation

/// 집계 질문(스펙 §9 "채팅 저장 규칙·집계 질문", 0.17.0): /chat 응답 aggregate 해석·막대(눈금·가로 스크롤)·칸 목록 머리·줄(서울)·복사·맥락 칸.
/// 숫자·칸·라벨·문장은 서버가 만든다 — 앱은 그리기만. 화면은 App/AggregateCard(P3). 진단 로그에는 상태·건수만(키워드·발신자 없음)
public enum ChatAggregate {
  public static let intent = "aggregate"
  public static func isAggregate(_ intent: String?) -> Bool { intent == Self.intent }

  /// 서버가 재검증한 조건(8칸). 다음 요청의 aggregate_context·목록 요청 conditions 로 그대로 돌려보낸다
  public struct Conditions: Codable, Sendable, Equatable {
    public let keywords: [String]; public let sender: String?; public let sources: [String]
    public let from: String; public let to: String; public let bucket: String
    public let defaulted: Bool; public let clamped: Bool
    public init(keywords: [String], sender: String?, sources: [String], from: String, to: String, bucket: String, defaulted: Bool, clamped: Bool) {
      self.keywords = keywords; self.sender = sender; self.sources = sources
      self.from = from; self.to = to; self.bucket = bucket; self.defaulted = defaulted; self.clamped = clamped
    }
  }
  /// 칸: hour "00"~"23"·day "YYYY-MM-DD"·weekday "1"~"7"(1 = 월요일). label = "14시"·"10/15(목)"·"월"
  public struct Bucket: Codable, Sendable, Equatable {
    public let key: String; public let label: String; public let count: Int
    public init(key: String, label: String, count: Int) { self.key = key; self.label = label; self.count = count }
  }
  /// status = ok·bad_condition·failed. buckets 는 0건 칸까지 전체, top 은 많은 칸 최대 3(0건 제외). 관대한 디코드 — status 밖 칸은 없으면 기본값
  public struct Response: Codable, Sendable {
    public let status: String; public let conditions: Conditions?; public let total: Int
    public let buckets: [Bucket]; public let top: [Bucket]; public let sentence: String; public let notes: [String]
    public init(status: String, conditions: Conditions?, total: Int, buckets: [Bucket], top: [Bucket], sentence: String, notes: [String]) {
      self.status = status; self.conditions = conditions; self.total = total; self.buckets = buckets; self.top = top
      self.sentence = sentence; self.notes = notes
    }
    public init(from d: Decoder) throws {
      let c = try d.container(keyedBy: CodingKeys.self)
      status = try c.decode(String.self, forKey: .status)
      conditions = try? c.decodeIfPresent(Conditions.self, forKey: .conditions)
      total = (try? c.decodeIfPresent(Int.self, forKey: .total)) ?? 0
      buckets = (try? c.decodeIfPresent([Bucket].self, forKey: .buckets)) ?? []
      top = (try? c.decodeIfPresent([Bucket].self, forKey: .top)) ?? []
      sentence = (try? c.decodeIfPresent(String.self, forKey: .sentence)) ?? ""
      notes = (try? c.decodeIfPresent([String].self, forKey: .notes)) ?? []
    }
  }

  public enum Text {
    public static let failed = "집계하지 못했어요 — 잠시 뒤 다시 물어봐 주세요"
    public static let badCondition = "조건을 정확히 알아듣지 못했어요 — 키워드·기간을 다시 말해 주세요"
    public static let emptyBucket = "이 칸에는 없어요"
    public static let truncated = "최근 50건만 보여요"
  }

  // MARK: 막대

  /// 막대 높이 = count / max(0건 칸은 바닥선만), leaderKeys = 1위 칸(동률 모두, 0건이면 없음) — 진하게.
  /// 눈금: hour 0·6·12·18시, weekday 7개 모두, day 첫·마지막 날과 월요일(M/D). scrolls = day 31칸 초과(가로 스크롤)
  public struct Bars: Equatable, Sendable {
    public let bars: [Bucket]; public let max: Int; public let leaderKeys: Set<String>
    public let tickIndices: [Int]; public let tickLabels: [String]; public let scrolls: Bool
  }

  public static func bars(_ r: Response) -> Bars {
    let b = r.buckets
    let maxCount = b.map(\.count).max() ?? 0
    let leaders = maxCount > 0 ? Set(b.filter { $0.count == maxCount }.map(\.key)) : []
    let kind = r.conditions?.bucket ?? inferBucket(b)
    let ticks: [Int]; let labels: [String]
    switch kind {
    case "hour":
      ticks = b.indices.filter { [0, 6, 12, 18].contains(Int(b[$0].key) ?? -1) }
      labels = ticks.map { b[$0].label }
    case "weekday":
      ticks = Array(b.indices); labels = b.map(\.label)
    default:
      ticks = b.indices.filter { $0 == 0 || $0 == b.count - 1 || isMonday(b[$0].key) }
      labels = ticks.map { monthDay(b[$0].key) }
    }
    return Bars(bars: b, max: maxCount, leaderKeys: leaders, tickIndices: ticks, tickLabels: labels, scrolls: kind == "day" && b.count > 31)
  }

  /// conditions 가 없는 응답(실패 등)의 칸 종류 — 키 모양으로
  private static func inferBucket(_ b: [Bucket]) -> String {
    guard let k = b.first?.key else { return "day" }
    return k.count == 10 ? "day" : k.count == 1 ? "weekday" : "hour"
  }
  private static func dayParts(_ key: String) -> (y: Int, m: Int, d: Int)? {
    let p = key.split(separator: "-").compactMap { Int($0) }
    return p.count == 3 ? (p[0], p[1], p[2]) : nil
  }
  private static func isMonday(_ key: String) -> Bool {
    guard let p = dayParts(key), let date = utcCalendar.date(from: DateComponents(year: p.y, month: p.m, day: p.d)) else { return false }
    return utcCalendar.component(.weekday, from: date) == 2
  }
  /// "2026-10-05" → "10/5". 날짜가 아니면 그대로
  private static func monthDay(_ key: String) -> String { dayParts(key).map { "\($0.m)/\($0.d)" } ?? key }
  private static let utcCalendar: Calendar = {
    var c = Calendar(identifier: .gregorian); c.timeZone = TimeZone(identifier: "UTC")!
    return c
  }()

  // MARK: 칸 목록(POST /chat/aggregate)

  public struct ListItem: Decodable, Sendable, Identifiable {
    public let item_id: String; public let title: String?; public let sender: String?; public let source: String
    public let app_name: String?; public let occurred_at: String
    public var id: String { item_id }
  }
  /// truncated = total > 50(최근 50건만 실린다)
  public struct ListResponse: Decodable, Sendable {
    public let status: String; public let bucket_key: String; public let label: String; public let total: Int
    public let items: [ListItem]; public let truncated: Bool
    public init(from d: Decoder) throws {
      let c = try d.container(keyedBy: CodingKeys.self)
      status = try c.decode(String.self, forKey: .status)
      bucket_key = (try? c.decodeIfPresent(String.self, forKey: .bucket_key)) ?? ""
      label = (try? c.decodeIfPresent(String.self, forKey: .label)) ?? ""
      total = (try? c.decodeIfPresent(Int.self, forKey: .total)) ?? 0
      items = (try? c.decodeIfPresent([ListItem].self, forKey: .items)) ?? []
      truncated = (try? c.decodeIfPresent(Bool.self, forKey: .truncated)) ?? false
    }
    private enum CodingKeys: String, CodingKey { case status, bucket_key, label, total, items, truncated }
  }
  public static func decodeList(_ data: Data) -> ListResponse? { try? JSONDecoder().decode(ListResponse.self, from: data) }

  /// 목록 머리: "14시대 9건"·"10/15(목) 9건"·"수요일 9건"(label 은 서버 칸 라벨)
  public static func listHeader(bucket: String, label: String, total: Int) -> String {
    switch bucket {
    case "hour": "\(label)대 \(total)건"
    case "weekday": "\(label)요일 \(total)건"
    default: "\(label) \(total)건"
    }
  }
  /// 끝 줄: 50건을 넘으면 "최근 50건만 보여요"
  public static func listFooter(_ r: ListResponse) -> String? { r.truncated ? Text.truncated : nil }

  /// 줄: 제목(없으면 발신자) · 출처 라벨(보관함과 같다) · 서울 M/D HH:mm — 칸·문장과 같은 서울 기준(기기 시간대와 무관)
  public static func line(_ i: ListItem) -> (title: String, meta: String) {
    let t = [i.title, i.sender].compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }.first { !$0.isEmpty } ?? "(제목 없음)"
    return (t, "\(SourceLabel.label(source: i.source, appName: i.app_name)) · \(seoulTime(i.occurred_at))")
  }
  private static func seoulTime(_ iso: String) -> String {
    let trimmed = iso.replacingOccurrences(of: #"\.\d+"#, with: "", options: .regularExpression)   // Postgres 소수 초
    guard let d = isoParser.date(from: trimmed) else { return iso }
    return seoulFormatter.string(from: d)
  }
  // 줄마다 불리므로 한 번만 만든다(ChatReply.seoulLabel 과 같은 이유로 ISO 파서는 unsafe)
  nonisolated(unsafe) private static let isoParser = ISO8601DateFormatter()
  private static let seoulFormatter: DateFormatter = {
    let f = DateFormatter()
    f.locale = Locale(identifier: "en_US_POSIX"); f.timeZone = TimeZone(identifier: "Asia/Seoul"); f.dateFormat = "M/d HH:mm"
    return f
  }()

  // MARK: 요청 본문

  /// aggregate_context·목록 conditions(8칸). sender 가 nil 이어도 키를 NSNull 로 싣는다 — 서버(K11)는 키 누락을 bad_context·bad_request 로 본다(PF-F6)
  public static func contextJSON(_ c: Conditions) -> [String: Any] {
    ["keywords": c.keywords, "sender": c.sender.map { $0 as Any } ?? NSNull(), "sources": c.sources, "from": c.from, "to": c.to,
     "bucket": c.bucket, "defaulted": c.defaulted, "clamped": c.clamped]
  }
  /// POST /chat/aggregate 본문: 응답 conditions 그대로 + 칸 키
  public static func listBody(_ c: Conditions, bucketKey: String) -> [String: Any] { ["conditions": contextJSON(c), "bucket_key": bucketKey] }

  /// [복사]: 문장과 꼬리 줄을 줄바꿈으로
  public static func copyText(_ r: Response) -> String { ([r.sentence] + r.notes).joined(separator: "\n") }
}
