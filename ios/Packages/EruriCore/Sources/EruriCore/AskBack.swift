import Foundation

/// 확인 필요 일정 되묻기 버튼(스펙 §9 "채팅 일정 개선" C, 계획 P3·K8~K10): 채팅 등록·고치기 카드 제안의 uncertain 에서 한 번에 하나씩
/// (date → year → ampm → location) 질문과 버튼 값. 값은 서버 resolve_uncertain 이 "그 칸만" 바뀌는지 검사하는 형식(서울 ISO·YYYY-MM-DD·빈 문자열).
/// 판단·문구만 — 호출·다시 읽기는 앱
public enum AskBack {
  public enum Code: String, Sendable, CaseIterable { case date, year, ampm, location }
  public struct Choice: Equatable, Sendable { public let label: String; public let value: String
    public init(label: String, value: String) { self.label = label; self.value = value } }
  public enum Question: Equatable, Sendable {
    case date(initial: Date, range: ClosedRange<Date>)     // DatePicker 기본값(추출 날짜, 없으면 오늘 — 서울 0시)·범위(서버 −1년 ~ +2년)
    case year([Choice])                                      // [올해 M/D]·[내년 M/D](없는 날짜면 그 해는 빠진다)
    case ampm(am: Choice, pm: Choice)
    case location                                            // [장소 없이 추가]
    public var code: Code {
      switch self { case .date: .date; case .year: .year; case .ampm: .ampm; case .location: .location }
    }
  }

  /// 다음 질문. 못 만드는 코드는 건너뛴다(year 선택지가 없음·ampm 인데 시각이 아님 — K10). location 은 남은 코드가 그것뿐일 때만(K9). 없으면 nil(지금 문구)
  public static func question(payload: [String: JSONValue], now: Date = Date()) -> Question? {
    let codes: [String] = { if case .array(let u)? = payload["uncertain"] { return u.compactMap(\.string) }; return [] }()
    let t = payload["start"]?.string.flatMap { ProposalTiming.parse(start: $0) }
    if codes.contains("date") { return .date(initial: t.map { ScheduleCard.seoulDay($0.anchor).start } ?? ScheduleCard.seoulDay(now).start, range: dateRange(now: now)) }
    if codes.contains("year"), let t { let ys = yearChoices(start: t, now: now); if !ys.isEmpty { return .year(ys) } }
    if codes.contains("ampm"), case .timed(let at, _)? = t { let c = ampmChoices(start: at); return .ampm(am: c.am, pm: c.pm) }
    if codes == ["location"] { return .location }
    return nil
  }

  /// [오전 h:mm]·[오후 h:mm]: 추출 시각의 시(0~23)를 12시간제로 읽은 두 값(같은 서울 날짜). 12시는 [오전 12:00(자정)] = 00:00·[오후 12:00] = 12:00
  public static func ampmChoices(start: Date) -> (am: Choice, pm: Choice) {
    let c = seoul.dateComponents([.year, .month, .day, .hour, .minute, .second], from: start)
    let base = (c.hour ?? 0) % 12, mm = String(format: "%02d", c.minute ?? 0)
    let value = { (h: Int) in iso.string(from: seoul.date(from: DateComponents(year: c.year, month: c.month, day: c.day, hour: h, minute: c.minute, second: c.second))!) }
    let am = base == 0 ? "오전 12:\(mm)(자정)" : "오전 \(base):\(mm)", pm = base == 0 ? "오후 12:\(mm)" : "오후 \(base):\(mm)"
    return (Choice(label: am, value: value(base)), Choice(label: pm, value: value(base + 12)))
  }
  /// [올해 M/D]·[내년 M/D](서울 기준 올해·내년, 월·일·시각 그대로). 그 해에 없는 날짜(2/29)는 뺀다
  public static func yearChoices(start: ProposalTiming, now: Date) -> [Choice] {
    let y = seoul.component(.year, from: now), years = [(y, "올해"), (y + 1, "내년")]
    switch start {
    case .timed(let at, _):
      let c = seoul.dateComponents([.month, .day, .hour, .minute, .second], from: at)
      return years.compactMap { yy, word in
        guard let m = c.month, let dd = c.day, let d = seoul.date(from: DateComponents(year: yy, month: m, day: dd, hour: c.hour, minute: c.minute, second: c.second)),
              seoul.component(.month, from: d) == m, seoul.component(.day, from: d) == dd else { return nil }
        return Choice(label: "\(word) \(m)/\(dd)", value: iso.string(from: d))
      }
    case .allDay(let first, _):
      return years.compactMap { yy, word in
        let s = String(format: "%04d-%02d-%02d", yy, first.month, first.day)
        return ProposalTiming.Day.parse(s) == nil ? nil : Choice(label: "\(word) \(first.month)/\(first.day)", value: s)
      }
    }
  }
  /// 날짜 선택 범위 = 서버 값 검사와 같은 오늘(서울) −1년 ~ +2년
  public static func dateRange(now: Date) -> ClosedRange<Date> {
    let today = ScheduleCard.seoulDay(now).start
    return seoul.date(byAdding: .year, value: -1, to: today)!...seoul.date(byAdding: .year, value: 2, to: today)!
  }
  /// 날짜 선택 값(서울 YYYY-MM-DD) — 서버가 지금 시각을 붙인다(시작이 없으면 그 날 종일)
  public static func dateValue(_ d: Date) -> String { day.string(from: d) }

  public enum Outcome: Equatable, Sendable {
    case ok, notUncertain, notFound, badValue, failed
    public var code: String { switch self { case .ok: "ok"; case .notUncertain: "not_uncertain"; case .notFound: "not_found"; case .badValue: "bad_value"; case .failed: "failed" } }
  }
  /// rest/v1/rpc/resolve_uncertain 응답. 200 이 아니거나 형식이 틀리면 failed(네트워크와 같은 문구)
  public static func outcome(status: Int?, data: Data?) -> Outcome {
    guard status == 200, let data, let o = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any], let s = o["status"] as? String else { return .failed }
    switch s { case "ok": return .ok; case "not_uncertain": return .notUncertain; case "not_found": return .notFound; case "bad_value": return .badValue; default: return .failed }
  }
  /// ok 응답의 새 버전 id(0033 resolve_uncertain {status: ok, proposal_id, version}) — 고치기 턴 카드가 그 버전으로 옮겨 간다(ChatHistory.Record.editPid). 아니면 nil
  public static func okProposalID(status: Int?, data: Data?) -> String? {
    guard outcome(status: status, data: data) == .ok, let data, let o = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return nil }
    return o["proposal_id"] as? String
  }
  public static func body(pid: String, code: Code, value: String) -> [String: String] { ["p_proposal": pid, "p_code": code.rawValue, "p_value": value] }
  /// 실패 문구(스펙 C): not_found·네트워크·bad_value(앱 버그 — 진단 코드로 가른다) 같은 문구. ok·not_uncertain 은 문구 없이 카드를 다시 읽는다
  public static func failureText(_ o: Outcome) -> String? { o == .ok || o == .notUncertain ? nil : AskBackText.failed }

  private static let seoul: Calendar = { var c = Calendar(identifier: .gregorian); c.timeZone = TimeZone(identifier: "Asia/Seoul")!; return c }()
  private static let iso: DateFormatter = {
    let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.timeZone = TimeZone(identifier: "Asia/Seoul"); f.dateFormat = "yyyy-MM-dd'T'HH:mm:ssxxxxx"
    return f
  }()
  private static let day: DateFormatter = {
    let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.timeZone = TimeZone(identifier: "Asia/Seoul"); f.dateFormat = "yyyy-MM-dd"
    return f
  }()
}

/// 되묻기 문구(스펙 §9 C 표·실패 문구)
public enum AskBackText {
  public static func question(_ c: AskBack.Code) -> String {
    switch c {
    case .ampm: "오전인지 오후인지 알려 주세요"
    case .year: "몇 년 일정인지 알려 주세요"
    case .date: "날짜를 확인해 주세요(음력이거나 날짜를 읽지 못했어요)"
    case .location: "장소를 확인하지 못했어요"
    }
  }
  public static let applyDate = "이 날로"
  public static let noLocation = "장소 없이 추가"
  public static let failed = "바꾸지 못했어요. 다시 눌러 주세요."
}
