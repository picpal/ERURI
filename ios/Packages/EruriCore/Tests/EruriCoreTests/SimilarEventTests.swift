import XCTest
@testable import EruriCore

/// 스펙 §10 "비슷한 일정"(0.9.2): 제안 날짜(종일이면 그 기간과 겹치는 날, 시각이면 그 서울 하루)의 캘린더 일정 중 제목이 비슷한 것.
/// 시각 제안은 겹침이 우선이고 겹침이 없을 때만 비슷한 일정. 문구는 전부 합성. 기준 서울 10/8(목)
final class SimilarEventTests: XCTestCase {
  private func d(_ s: String) -> Date { ISO8601DateFormatter().date(from: s)! }
  private let seoul = TimeZone(identifier: "Asia/Seoul")!
  private func ev(_ id: String, _ start: String, _ end: String, title: String, allDay: Bool = false, canceled: Bool = false,
                  url: URL? = nil, listed: Bool = true) -> ProposalFlow.CalendarEvent {
    ProposalFlow.CalendarEvent(id: id, title: title, start: d(start), end: d(end), allDay: allDay, canceled: canceled, url: url, listed: listed)
  }
  private let day = ProposalTiming.allDay(first: .init(2026, 10, 8), last: .init(2026, 10, 8))
  // 서울 기기에서 EventKit 이 주는 10/8 종일 일정(0시 ~ 23:59:59)
  private func allDayEv(_ id: String, _ title: String, day: String = "2026-10-07T15:00:00Z", end: String = "2026-10-08T14:59:59Z",
                        url: URL? = nil, canceled: Bool = false, listed: Bool = true) -> ProposalFlow.CalendarEvent {
    ev(id, day, end, title: title, allDay: true, canceled: canceled, url: url, listed: listed)
  }

  func testAllDaySimilar() {
    func s(_ evs: [ProposalFlow.CalendarEvent], title: String = "합성 가을 운동회", timing: ProposalTiming? = nil) -> [String] {
      ProposalFlow.similar(pid: "p-1", title: title, timing: timing ?? day, events: evs, deviceZone: seoul).map(\.id)
    }
    XCTAssertEqual(s([allDayEv("same", "합성 가을운동회")]), ["same"])                                                   // 종일·띄어쓰기 차이
    XCTAssertEqual(s([ev("timed", "2026-10-08T00:00:00Z", "2026-10-08T03:00:00Z", title: "[합성] 가을 운동회")]), ["timed"])  // 같은 날 시각 일정도
    XCTAssertEqual(s([allDayEv("other", "합성 학부모 상담")]), [])                                                       // 다른 행사
    XCTAssertEqual(s([allDayEv("nextDay", "합성 가을 운동회", day: "2026-10-08T15:00:00Z", end: "2026-10-09T14:59:59Z")]), [])   // 다음 날
    XCTAssertEqual(s([ev("prevNight", "2026-10-07T13:00:00Z", "2026-10-07T15:00:00Z", title: "합성 가을 운동회")]), [])      // 전날 22–24시(맞닿음)
    XCTAssertEqual(s([allDayEv("c", "합성 가을 운동회", canceled: true)]), [])                                          // 취소
    XCTAssertEqual(s([allDayEv("bday", "합성 가을 운동회", listed: false)]), [])                                        // 생일·구독 캘린더(기존 제외)
    XCTAssertEqual(s([allDayEv("mine", "합성 가을 운동회", url: ProposalFlow.marker("p-1"))]), [])                      // 이 제안 표식 = 복구 경로
    XCTAssertEqual(s([allDayEv("twin", "합성 미용실 예약", url: ProposalFlow.marker("p-2"))], title: "합성 치과 예약"), ["twin"])   // 공통어 + 다른 제안 표식
    XCTAssertEqual(s([allDayEv("noMark", "합성 미용실 예약")], title: "합성 치과 예약"), [])
    // 시작 순
    XCTAssertEqual(s([ev("b", "2026-10-08T05:00:00Z", "2026-10-08T06:00:00Z", title: "합성 가을 운동회"), allDayEv("a", "합성 가을 운동회")]), ["a", "b"])
    // 여러 날 종일 제안(10/8–10/10): 그 기간과 겹치는 날이면
    let span = ProposalTiming.allDay(first: .init(2026, 10, 8), last: .init(2026, 10, 10))
    XCTAssertEqual(s([allDayEv("d10", "합성 가을 운동회", day: "2026-10-09T15:00:00Z", end: "2026-10-10T14:59:59Z")], timing: span), ["d10"])
    XCTAssertEqual(s([allDayEv("d11", "합성 가을 운동회", day: "2026-10-10T15:00:00Z", end: "2026-10-11T14:59:59Z")], timing: span), [])
    // LA 기기: 종일 일정은 기기 시간대 0시로 온다 — 서울 날짜로 옮겨 가른다
    let la = TimeZone(identifier: "America/Los_Angeles")!
    let laEv = ev("la", "2026-10-08T07:00:00Z", "2026-10-09T06:59:59Z", title: "합성 가을 운동회", allDay: true)
    XCTAssertEqual(ProposalFlow.similar(pid: "p-1", title: "합성 가을 운동회", timing: day, events: [laEv], deviceZone: la).map(\.id), ["la"])
  }

  /// 시각 제안: 같은 서울 하루의 비슷한 제목(겹침과 별개 함수 — 우선순위는 preview·AddEventGate 가 정한다)
  func testTimedSimilarAndPreviewOrder() {
    let at = ProposalTiming.timed(d("2026-10-08T06:00:00Z"))                                 // 서울 15:00
    let morning = ev("am", "2026-10-08T00:00:00Z", "2026-10-08T01:00:00Z", title: "합성의원 진료")
    let overlap = ev("ov", "2026-10-08T06:30:00Z", "2026-10-08T07:30:00Z", title: "합성 회의")
    XCTAssertEqual(ProposalFlow.similar(pid: "p-1", title: "합성의원 진료 예약", timing: at, events: [morning], deviceZone: seoul).map(\.id), ["am"])
    XCTAssertEqual(ProposalFlow.preview(pid: "p-1", title: "합성의원 진료 예약", timing: at, events: [morning], deviceZone: seoul), .similar([morning]))
    // 겹침이 있으면 겹침만(비슷한 일정은 보이지 않는다)
    XCTAssertEqual(ProposalFlow.preview(pid: "p-1", title: "합성의원 진료 예약", timing: at, events: [morning, overlap], deviceZone: seoul), .conflict([overlap]))
    XCTAssertEqual(ProposalFlow.preview(pid: "p-1", title: "합성의원 진료 예약", timing: at, events: [], deviceZone: seoul), .clear)
    let nextDay = ev("nd", "2026-10-09T00:00:00Z", "2026-10-09T01:00:00Z", title: "합성의원 진료 예약")
    XCTAssertEqual(ProposalFlow.preview(pid: "p-1", title: "합성의원 진료 예약", timing: at, events: [nextDay], deviceZone: seoul), .clear)
  }

  /// 종일 제안: ERURI 표식(다른 제안) + 같은 날짜 + 같은 정규화 제목 → 등록됨(같은 일정을 다른 제안으로 이미 넣음), 그 밖의 비슷한 일정 → similar
  func testAllDayPreview() {
    func p(_ evs: [ProposalFlow.CalendarEvent]) -> ProposalFlow.Preview {
      ProposalFlow.preview(pid: "p-1", title: "합성 가을 운동회", timing: day, events: evs, deviceZone: seoul)
    }
    let twin = allDayEv("twin", "[합성] 가을운동회", url: ProposalFlow.marker("p-2"))
    XCTAssertEqual(p([twin]), .registered(twin))
    let twinTimed = ev("tt", "2026-10-08T00:00:00Z", "2026-10-08T03:00:00Z", title: "합성 가을 운동회", url: ProposalFlow.marker("p-2"))
    XCTAssertEqual(p([twinTimed]), .registered(twinTimed))                                    // 같은 날짜면 시각 일정으로 넣었어도
    let looser = allDayEv("loose", "합성 가을 운동회 준비물", url: ProposalFlow.marker("p-2"))  // 표식 있어도 제목이 같지 않으면 비슷한 일정
    XCTAssertEqual(p([looser]), .similar([looser]))
    let plain = allDayEv("plain", "합성 가을운동회")                                            // 표식 없음 = 비슷한 일정
    XCTAssertEqual(p([plain]), .similar([plain]))
    XCTAssertEqual(p([plain, twin]), .registered(twin))
    XCTAssertEqual(p([ev("busy", "2026-10-08T00:00:00Z", "2026-10-08T01:00:00Z", title: "합성 회의")]), .clear)   // 종일은 겹침 없음
  }

  func testOutcomesCopyAndButtons() {
    let a = allDayEv("a", "합성 가을 운동회"), b = ev("b", "2026-10-08T05:00:00Z", "2026-10-08T06:00:00Z", title: "합성 운동회 리허설")
    XCTAssertEqual(ProposalFlow.similarOutcome(2), "similar:2")
    XCTAssertEqual(ProposalFlow.similarCount("similar:2"), 2)
    XCTAssertNil(ProposalFlow.similarCount("conflict:2")); XCTAssertNil(ProposalFlow.conflictCount("similar:2"))
    XCTAssertEqual(ProposalFlow.heldCount("similar:3"), 3); XCTAssertEqual(ProposalFlow.heldCount("conflict:1"), 1); XCTAssertNil(ProposalFlow.heldCount("ok"))
    XCTAssertEqual(ProposalFlow.similarLine([a], deviceZone: seoul), "✅ 캘린더에 비슷한 일정이 있음 · 10/8(목) 합성 가을 운동회")
    XCTAssertEqual(ProposalFlow.similarLine([a, b], deviceZone: seoul), "✅ 캘린더에 비슷한 일정이 있음 · 10/8(목) 합성 가을 운동회 외 1건")
    XCTAssertNil(ProposalFlow.similarLine([], deviceZone: seoul))
    XCTAssertEqual(ProposalFlow.similarConfirmTitle([a]), "캘린더에 비슷한 일정이 있습니다 — '합성 가을 운동회'. 그래도 추가할까요?")
    XCTAssertEqual(ProposalFlow.similarNoticeTitle, "비슷한 일정이 있습니다")
    XCTAssertEqual(ProposalFlow.similarNoticeBody(1), "캘린더에 비슷한 일정 1건 · 탭해서 확인")
    // 버튼: 겹침 > 비슷한 일정 > 종일/시각
    XCTAssertEqual(ProposalFlow.addButtonTitle(allDay: true, conflictsShown: false, similarShown: true), "그래도 추가")
    XCTAssertEqual(ProposalFlow.addButtonTitle(allDay: false, conflictsShown: false, similarShown: true), "그래도 추가")
    XCTAssertEqual(ProposalFlow.addButtonTitle(allDay: false, conflictsShown: true, similarShown: true), "겹쳐도 추가")
    XCTAssertEqual(ProposalFlow.addButtonTitle(allDay: true, conflictsShown: false, similarShown: false), "종일 일정으로 추가")
    // 확인창: 비슷한 일정을 보이지 않은 채 눌렀는데 저장 직전에 나온 경우만
    XCTAssertTrue(ProposalFlow.needsConfirm(confirmed: false, outcome: "similar:1"))
    XCTAssertFalse(ProposalFlow.needsConfirm(confirmed: true, outcome: "similar:1"))
    XCTAssertEqual(ChatReply.addFeedback("similar:1").text, "캘린더에 비슷한 일정이 있습니다")
    XCTAssertTrue(ChatReply.addFeedback("similar:1").retry)
  }

  /// AddEventGate 조회 창: 시각 ±1일, 종일은 첫날 서울 0시 −1일 ~ 마지막 날 다음 날 0시 +1일(여러 날 기간 전체를 덮는다)
  func testSearchWindow() {
    let t = d("2026-10-08T06:00:00Z")
    XCTAssertEqual(ProposalTiming.timed(t).searchWindow.0, t.addingTimeInterval(-86_400))
    XCTAssertEqual(ProposalTiming.timed(t).searchWindow.1, t.addingTimeInterval(86_400))
    let span = ProposalTiming.allDay(first: .init(2026, 10, 8), last: .init(2026, 10, 10))
    XCTAssertEqual(span.searchWindow.0, d("2026-10-06T15:00:00Z"))                            // 10/7 0시(서울)
    XCTAssertEqual(span.searchWindow.1, d("2026-10-11T15:00:00Z"))                            // 10/12 0시(서울)
    XCTAssertEqual(day.searchWindow.0, d("2026-10-06T15:00:00Z")); XCTAssertEqual(day.searchWindow.1, d("2026-10-09T15:00:00Z"))
  }
}
