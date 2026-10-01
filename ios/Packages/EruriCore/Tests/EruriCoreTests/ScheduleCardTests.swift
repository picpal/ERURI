import XCTest
@testable import EruriCore

/// 스펙 §9 "일정 답 카드"(0.8.2): 카드 고르기·찾은 곳·그날 캘린더 줄·등록 상태 6종·버튼·"기기 캘린더" 절 동시 표시.
/// 기준 날짜 2026-10-04(일), 서울. 문구는 전부 합성
final class ScheduleCardTests: XCTestCase {
  private func d(_ s: String) -> Date { ISO8601DateFormatter().date(from: s)! }
  private func prop(_ id: String, start: JSONValue?, title: String = "합성의원 진료 예약", status: String = "proposed",
                    action: String = "create_event", uncertain: [String] = [], item: String = "item-1") -> ChatReply.Proposal {
    var payload: [String: JSONValue] = ["title": .string(title), "uncertain": .array(uncertain.map { .string($0) })]
    if let start { payload["start"] = start }
    return ChatReply.Proposal(id: id, item_id: item, action: action, status: status, payload: payload)
  }
  private func ev(_ id: String, _ start: String, _ end: String, title: String? = nil, allDay: Bool = false, canceled: Bool = false,
                  url: URL? = nil, listed: Bool = true) -> ProposalFlow.CalendarEvent {
    ProposalFlow.CalendarEvent(id: id, title: title ?? "합성 \(id)", start: d(start), end: d(end), allDay: allDay, canceled: canceled,
                               url: url, listed: listed)
  }
  private func cite(_ source: String, app: String? = nil, at occurred: String = "2026-10-01T00:10:00.123456+00:00") -> ChatReply.Citation {
    ChatReply.Citation(item_id: "item-1", source: source, app_name: app, title: "합성", occurred_at: occurred, expired: false)
  }
  private var now: Date { d("2026-10-01T03:00:00Z") }                                    // 서울 10/1(목) 12:00

  /// 시각 있음·미래 → addable, 날짜만 → dateOnly(서울 0시), uncertain → needsReview, 지남 → past.
  /// create_event 아님·start 없음·오프셋 없는 시각(handleAdd 가 못 읽음) → 카드 없음. 서버 상태는 kind 에 영향 없음
  func testCardKinds() throws {
    let a = try XCTUnwrap(ScheduleCard.card(prop("p", start: .string("2026-10-04T15:30:00+09:00")), now: now))
    XCTAssertEqual(a.kind, .addable); XCTAssertEqual(a.start, d("2026-10-04T06:30:00Z")); XCTAssertTrue(a.timed)
    let day = try XCTUnwrap(ScheduleCard.card(prop("p", start: .string("2026-10-04")), now: now))
    XCTAssertEqual(day.kind, .dateOnly); XCTAssertEqual(day.start, d("2026-10-03T15:00:00Z")); XCTAssertFalse(day.timed)
    XCTAssertEqual(ScheduleCard.card(prop("p", start: .string("2026-10-04T15:30:00+09:00"), uncertain: ["year"]), now: now)?.kind, .needsReview)
    XCTAssertEqual(ScheduleCard.card(prop("p", start: .string("2026-10-04"), uncertain: ["time"]), now: now)?.kind, .needsReview)
    XCTAssertEqual(ScheduleCard.card(prop("p", start: .string("2026-09-30T15:30:00+09:00")), now: now)?.kind, .past)
    XCTAssertEqual(ScheduleCard.card(prop("p", start: .string("2026-09-30")), now: now)?.kind, .past)
    XCTAssertEqual(ScheduleCard.card(prop("p", start: .string("2026-10-01")), now: now)?.kind, .dateOnly)        // 오늘(서울)은 아직 안 지남
    XCTAssertEqual(ScheduleCard.card(prop("p", start: .string("2026-10-01T12:00:00+09:00")), now: now)?.kind, .addable)  // start == now 는 안 지남(notify.ts)
    XCTAssertEqual(ScheduleCard.card(prop("p", start: .string("2026-10-04T15:30:00+09:00"), status: "succeeded"), now: now)?.kind, .addable)
    XCTAssertNil(ScheduleCard.card(prop("p", start: .string("2026-10-04T15:30:00+09:00"), action: "create_reminder"), now: now))
    XCTAssertNil(ScheduleCard.card(prop("p", start: nil), now: now))
    XCTAssertNil(ScheduleCard.card(prop("p", start: .null), now: now))
    XCTAssertNil(ScheduleCard.card(prop("p", start: .string("2026-10-04T15:30")), now: now))
    XCTAssertEqual(ScheduleCard.card(prop("p", start: .string("2026-10-04T15:30:00+09:00"), title: "  "), now: now)?.title, "일정")
  }

  /// 일정 기간이 있으면 그 안에서 시작하는 것만, 다가올 일정 시작 순 → 지난 일정 최근 것부터,
  /// 같은 시작(분)·제목은 한 장(succeeded 가 대표 — 초 차이·입력 순서 무관), 최대 3 + 넘친 수
  func testPick() {
    let ps = [
      prop("c", start: .string("2026-10-06T10:00:00+09:00"), title: "합성 셋"),
      prop("a2", start: .string("2026-10-04T15:30:00+09:00")),
      prop("a1", start: .string("2026-10-04T15:30:00+09:00"), title: " 합성의원 진료 예약", status: "succeeded"),
      prop("b", start: .string("2026-10-05T09:00:00+09:00"), title: "합성 둘"),
      prop("d", start: .string("2026-10-07T09:00:00+09:00"), title: "합성 넷"),
      prop("r", start: .string("2026-10-05T09:00:00+09:00"), action: "create_reminder"),
    ]
    let all = ScheduleCard.pick(ps, schedule: nil, now: now)
    XCTAssertEqual(all.cards.map(\.proposal.id), ["a1", "b", "c"]); XCTAssertEqual(all.more, 1)
    let oct5 = DateInterval(start: d("2026-10-04T15:00:00Z"), duration: 86_399)              // 서버 schedule 10/5 00:00:00~23:59:59
    let inDay = ScheduleCard.pick(ps, schedule: oct5, now: now)
    XCTAssertEqual(inDay.cards.map(\.proposal.id), ["b"]); XCTAssertEqual(inDay.more, 0)
    XCTAssertTrue(ScheduleCard.pick(ps, schedule: DateInterval(start: d("2026-10-19T15:00:00Z"), duration: 86_399), now: now).cards.isEmpty)
    XCTAssertTrue(ScheduleCard.pick([], schedule: nil, now: now).cards.isEmpty)
    // 같은 분·다른 초: succeeded 가 대표(입력 순서 무관, Codex #2)
    let secs = [prop("s1", start: .string("2026-10-04T15:30:00+09:00")), prop("s2", start: .string("2026-10-04T15:30:30+09:00"), status: "succeeded")]
    XCTAssertEqual(ScheduleCard.pick(secs, schedule: nil, now: now).cards.map(\.proposal.id), ["s2"])
    XCTAssertEqual(ScheduleCard.pick(secs.reversed(), schedule: nil, now: now).cards.map(\.proposal.id), ["s2"])
    // 지난 일정은 뒤로(최근 것부터) — 추가할 수 있는 카드가 잘리지 않는다(Fable F2)
    let mixed = [prop("old1", start: .string("2026-08-01T10:00:00+09:00"), title: "합성 옛1"), prop("old2", start: .string("2026-09-01T10:00:00+09:00"), title: "합성 옛2"),
                 prop("old3", start: .string("2026-09-20T10:00:00+09:00"), title: "합성 옛3"), prop("next", start: .string("2026-10-04T15:30:00+09:00"))]
    let m = ScheduleCard.pick(mixed, schedule: nil, now: now)
    XCTAssertEqual(m.cards.map(\.proposal.id), ["next", "old3", "old2"]); XCTAssertEqual(m.more, 1)
  }

  /// ① 찾은 곳: SourceLabel 과 같은 문자 판정, 메일·앱 알림·공유, 인용 없으면 "저장된 정보". 받은 날짜는 서울(소수 초 허용)
  func testSourceAndReceivedLines() {
    XCTAssertEqual(ScheduleCard.sourceLine(cite("MESSAGES")), "문자에서 찾은 일정")
    XCTAssertEqual(ScheduleCard.sourceLine(cite("NOTIFICATION", app: "메시지")), "문자에서 찾은 일정")
    XCTAssertEqual(ScheduleCard.sourceLine(cite("NOTIFICATION", app: "카카오톡")), "카카오톡 알림에서 찾은 일정")
    XCTAssertEqual(ScheduleCard.sourceLine(cite("NOTIFICATION")), "앱 알림에서 찾은 일정")
    XCTAssertEqual(ScheduleCard.sourceLine(cite("NOTIFICATION", app: "")), "앱 알림에서 찾은 일정")
    XCTAssertEqual(ScheduleCard.sourceLine(cite("GMAIL")), "메일에서 찾은 일정")
    XCTAssertEqual(ScheduleCard.sourceLine(cite("SHARE")), "공유한 내용에서 찾은 일정")
    XCTAssertEqual(ScheduleCard.sourceLine(nil), "저장된 정보에서 찾은 일정")
    XCTAssertEqual(ScheduleCard.receivedLine(cite("MESSAGES")), "10/1 받은 문자")
    XCTAssertEqual(ScheduleCard.receivedLine(cite("GMAIL", at: "2026-09-30T15:30:00+00:00")), "10/1 받은 메일")     // UTC 9/30 → 서울 10/1
    XCTAssertEqual(ScheduleCard.receivedLine(cite("NOTIFICATION", app: "카카오톡")), "10/1 받은 알림")
    XCTAssertEqual(ScheduleCard.receivedLine(cite("SHARE")), "10/1 공유함")
    XCTAssertNil(ScheduleCard.receivedLine(cite("GMAIL", at: "어제")))
    XCTAssertNil(ScheduleCard.receivedLine(nil))
  }

  /// ② 그날(서울) 줄: 겹친 일정(어느 캘린더든) → 종일 → 시작 순. 표시 대상 캘린더(listed)만·취소·다른 날 제외. 최대 4 + 넘친 수.
  /// 겹침은 값 비교(반복 일정은 회차마다 id 가 같다), 다음 날 0시에 끝나면 그날 안
  func testDayLines() {
    let day = DateInterval(start: d("2026-10-03T15:00:00Z"), duration: 86_400)                     // 10/4(일)
    let sub = ev("sub", "2026-10-04T06:00:00Z", "2026-10-04T07:00:00Z", title: "합성 구독 경기", listed: false)   // 15:00–16:00, 구독 캘린더
    let evs = [
      ev("late", "2026-10-04T09:00:00Z", "2026-10-04T10:00:00Z", title: "합성 저녁"),               // 18:00–19:00
      sub,
      ev("bday", "2026-10-03T15:00:00Z", "2026-10-04T15:00:00Z", title: "합성 생일", allDay: true, listed: false),
      ev("trip", "2026-10-03T15:00:00Z", "2026-10-05T15:00:00Z", title: "합성 여행", allDay: true),
      ev("night", "2026-10-03T14:00:00Z", "2026-10-03T16:00:00Z", title: "합성 야간"),              // 10/3 23:00–10/4 01:00
      ev("x", "2026-10-04T01:00:00Z", "2026-10-04T02:00:00Z", canceled: true),
      ev("prev", "2026-10-02T01:00:00Z", "2026-10-02T02:00:00Z"),
      ev("edge", "2026-10-03T14:00:00Z", "2026-10-03T15:00:00Z"),                                   // 10/3 23:00–24:00 맞닿음 → 그날 아님
      ev("am", "2026-10-04T00:00:00Z", "2026-10-04T01:00:00Z", title: "합성 오전"),                  // 09:00–10:00
    ]
    let l = ScheduleCard.dayLines(day: day, events: evs, conflicts: [sub])
    XCTAssertEqual(l.lines.map(\.text), ["15:00–16:00 합성 구독 경기", "종일 합성 여행", "10/3 23:00–10/4 01:00 합성 야간", "09:00–10:00 합성 오전"])
    XCTAssertEqual(l.lines.map(\.conflict), [true, false, false, false])
    XCTAssertEqual(l.more, 1)                                                                       // 18:00 합성 저녁
    XCTAssertTrue(ScheduleCard.dayLines(day: day, events: [], conflicts: []).lines.isEmpty)
    XCTAssertEqual(ScheduleCard.dayLines(day: day, events: [ev("t", "2026-10-04T00:00:00Z", "2026-10-04T01:00:00Z", title: " ")], conflicts: []).lines.map(\.text),
                   ["09:00–10:00 (제목 없음)"])
    // 매일 반복 일정: 회차마다 id 가 같다 — 겹친 당일 회차만 한 줄(Fable F1)
    let daily = [ev("daily", "2026-10-03T06:00:00Z", "2026-10-03T07:00:00Z"), ev("daily", "2026-10-04T06:00:00Z", "2026-10-04T07:00:00Z"),
                 ev("daily", "2026-10-05T06:00:00Z", "2026-10-05T07:00:00Z")]
    let r = ScheduleCard.dayLines(day: day, events: daily, conflicts: [daily[1]])
    XCTAssertEqual(r.lines.map(\.text), ["15:00–16:00 합성 daily"]); XCTAssertEqual(r.lines.map(\.conflict), [true])
    // 다음 날 0시에 끝남 → 그날 안(§9, Codex #6)
    let mid = ev("mid", "2026-10-04T14:00:00Z", "2026-10-04T15:00:00Z", title: "합성 심야")                // 10/4 23:00–10/5 00:00
    XCTAssertEqual(ScheduleCard.dayLines(day: day, events: [mid], conflicts: []).lines.map(\.text), ["23:00–00:00 합성 심야"])
  }

  /// ③ 등록 판정(§9 상태 1~6): EventKit 표식이 1순위, 실행 기록·서버 succeeded 는 "넣은 적 있음" 보조 근거, 그다음 §10 겹침
  func testStatus() {
    let t = d("2026-10-04T06:30:00Z"), m = ProposalFlow.marker("p-1")
    func s(_ evs: [ProposalFlow.CalendarEvent], server: String = "proposed", executed: Bool = false) -> ScheduleCard.Status {
      ScheduleCard.status(pid: "p-1", title: "합성의원 진료 예약", start: t, serverStatus: server, executed: executed, events: evs)
    }
    let mine = ev("mine", "2026-10-04T06:30:00Z", "2026-10-04T07:30:00Z", title: "합성의원 진료 예약", url: m)
    XCTAssertEqual(s([mine]), .added)
    XCTAssertEqual(s([mine], server: "succeeded", executed: true), .added)
    let moved = ev("mine", "2026-10-05T01:00:00Z", "2026-10-05T02:00:00Z", title: "합성의원 진료 예약", url: m)     // 10/5(월) 10:00
    XCTAssertEqual(s([moved]), .addedMoved(d("2026-10-05T01:00:00Z")))
    XCTAssertEqual(s([ev("same", "2026-10-04T06:30:00Z", "2026-10-04T07:30:00Z", title: " 합성의원 진료 예약 ")]), .sameEvent)
    XCTAssertEqual(s([], server: "succeeded"), .addedMissing)
    XCTAssertEqual(s([], executed: true), .addedMissing)
    let other = ev("o", "2026-10-04T06:00:00Z", "2026-10-04T07:00:00Z", title: "합성 겹침")
    XCTAssertEqual(s([other]), .conflict([other], maybeSame: false))
    XCTAssertEqual(s([other], server: "succeeded"), .addedMissing)                                 // 넣은 적 있으면 겹침보다 앞
    let reNotice = ev("re", "2026-10-04T06:30:00Z", "2026-10-04T07:30:00Z", title: "합성의원 예약 재안내", url: ProposalFlow.marker("p-2"))
    XCTAssertEqual(s([reNotice]), .conflict([reNotice], maybeSame: true))
    let canceledMine = ev("c", "2026-10-04T06:30:00Z", "2026-10-04T07:30:00Z", title: "합성의원 진료 예약", canceled: true, url: m)
    XCTAssertEqual(s([canceledMine]), .clear)                                                      // 취소된 일정은 없는 것
    XCTAssertEqual(s([ev("touch", "2026-10-04T05:30:00Z", "2026-10-04T06:30:00Z")]), .clear)         // 맞닿음
    XCTAssertEqual(s([]), .clear)
  }

  func testStatusText() {
    let o = ev("o", "2026-10-04T06:00:00Z", "2026-10-04T07:00:00Z", title: "합성 겹침")
    let o2 = ev("o2", "2026-10-04T06:45:00Z", "2026-10-04T07:15:00Z")
    let night = ev("n", "2026-10-03T14:00:00Z", "2026-10-04T07:00:00Z", title: "합성 야간")
    XCTAssertEqual(ScheduleCard.statusText(.added), "✅ 캘린더에 등록됨")
    XCTAssertEqual(ScheduleCard.statusText(.addedMoved(d("2026-10-05T01:00:00Z"))), "✅ 캘린더에 등록됨 · 캘린더에서는 10/5(월) 10:00")
    XCTAssertEqual(ScheduleCard.statusText(.sameEvent), "✅ 같은 일정이 캘린더에 있음")
    XCTAssertEqual(ScheduleCard.statusText(.addedMissing), "이전에 추가한 일정 · 이 날 캘린더에서는 찾지 못함(옮겼거나 지웠을 수 있음)")
    XCTAssertEqual(ScheduleCard.statusText(.conflict([o], maybeSame: false)), "⚠️ 아직 캘린더에 없음 · 겹치는 일정 15:00–16:00 합성 겹침")
    XCTAssertEqual(ScheduleCard.statusText(.conflict([o, o2], maybeSame: true)),
                   "⚠️ 아직 캘린더에 없음 · 겹치는 일정 15:00–16:00 합성 겹침 외 1건 (같은 일정일 수 있음)")
    XCTAssertEqual(ScheduleCard.statusText(.conflict([night], maybeSame: false)), "⚠️ 아직 캘린더에 없음 · 겹치는 일정 10/3 23:00–10/4 16:00 합성 야간")
    let mid = ev("mid", "2026-10-04T14:00:00Z", "2026-10-04T15:00:00Z", title: "합성 심야")                // 줄과 같은 표기(자정 끝 = 그날 안)
    XCTAssertEqual(ScheduleCard.statusText(.conflict([mid], maybeSame: false)), "⚠️ 아직 캘린더에 없음 · 겹치는 일정 23:00–00:00 합성 심야")
    XCTAssertEqual(ScheduleCard.statusText(.clear), "아직 캘린더에 없음")
  }

  /// 카드 모델·버튼: 버튼은 시각 있는 미래 제안이 "아직 없음"(추가)·겹침(겹쳐도 추가)일 때만.
  /// 캘린더를 못 읽으면(전체 접근 없음) 상태·줄·버튼 없음 — 시각 없음·확인 필요·지난 일정 문구는 남는다
  func testModel() throws {
    let c = try XCTUnwrap(ScheduleCard.card(prop("p-1", start: .string("2026-10-04T15:30:00+09:00")), now: now))
    let o = ev("o", "2026-10-04T06:00:00Z", "2026-10-04T07:00:00Z", title: "합성 겹침")
    let conflict = ScheduleCard.model(c, events: [o], executed: false)
    XCTAssertEqual(conflict.status, .conflict([o], maybeSame: false))
    XCTAssertEqual(ScheduleCard.action(conflict), .addAnyway)
    XCTAssertEqual(conflict.lines?.map(\.conflict), [true])
    XCTAssertTrue(ScheduleCard.isWarning(conflict))
    XCTAssertEqual(conflict.startText, "2026-10-04T15:30:00+09:00"); XCTAssertEqual(conflict.pid, "p-1"); XCTAssertEqual(conflict.itemID, "item-1")
    XCTAssertEqual(ScheduleCard.whenLine(conflict), "10/4(일) 15:30 합성의원 진료 예약")
    XCTAssertEqual(ScheduleCard.dayHeader(conflict.day), "내 캘린더 · 10/4(일)")
    XCTAssertEqual(conflict.day, DateInterval(start: d("2026-10-03T15:00:00Z"), duration: 86_400))
    let clear = ScheduleCard.model(c, events: [], executed: false)
    XCTAssertEqual(ScheduleCard.action(clear), .add); XCTAssertEqual(clear.lines, []); XCTAssertFalse(ScheduleCard.isWarning(clear))
    XCTAssertEqual(ScheduleCard.statusText(clear), "아직 캘린더에 없음")
    XCTAssertNil(ScheduleCard.action(ScheduleCard.model(c, events: [], executed: true)))                // 이전에 추가함
    let noAccess = ScheduleCard.model(c, events: nil, executed: false)
    XCTAssertNil(noAccess.status); XCTAssertNil(noAccess.lines); XCTAssertNil(ScheduleCard.action(noAccess)); XCTAssertNil(ScheduleCard.statusText(noAccess))
    let past = ScheduleCard.model(try XCTUnwrap(ScheduleCard.card(prop("p-2", start: .string("2026-09-30T15:30:00+09:00")), now: now)), events: [], executed: false)
    XCTAssertNil(past.status); XCTAssertNil(ScheduleCard.action(past)); XCTAssertEqual(ScheduleCard.statusText(past), "지난 일정")
    let dateOnly = ScheduleCard.model(try XCTUnwrap(ScheduleCard.card(prop("p-3", start: .string("2026-10-05")), now: now)), events: nil, executed: false)
    XCTAssertEqual(ScheduleCard.statusText(dateOnly), "날짜만 확인돼 바로 추가하지 않음")
    XCTAssertEqual(ScheduleCard.whenLine(dateOnly), "10/5(월) 시간 미정 합성의원 진료 예약")
    let review = ScheduleCard.model(try XCTUnwrap(ScheduleCard.card(prop("p-4", start: .string("2026-10-05T10:00:00+09:00"), uncertain: ["year"]), now: now)),
                                    events: [], executed: false)
    XCTAssertEqual(ScheduleCard.statusText(review), "내용 확인이 필요해 바로 추가하지 않음"); XCTAssertNil(ScheduleCard.action(review))
    XCTAssertEqual(ScheduleCard.buttonTitle(.add), "캘린더에 추가"); XCTAssertEqual(ScheduleCard.buttonTitle(.addAnyway), "겹쳐도 추가")
    XCTAssertEqual(ScheduleCard.moreText(2), "일정 제안 2건 더 있음")
    XCTAssertEqual(ScheduleCard.emptyDayText, "이 날 등록된 일정 없음")
  }

  /// "기기 캘린더" 절을 카드와 같이 그릴지: 일정 기간이 있고, 카드가 없거나 기간이 카드 날짜 하루보다 넓을 때(C1-1 회귀 방지)
  func testShowsRangeSection() {
    let d4 = DateInterval(start: d("2026-10-03T15:00:00Z"), duration: 86_400)
    let oneDay = DateInterval(start: d("2026-10-03T15:00:00Z"), duration: 86_399)
    let week = DateInterval(start: d("2026-10-04T15:00:00Z"), end: d("2026-10-11T14:59:59Z"))
    XCTAssertFalse(ScheduleCard.showsRangeSection(schedule: nil, cardDays: [d4]))
    XCTAssertFalse(ScheduleCard.showsRangeSection(schedule: nil, cardDays: []))
    XCTAssertFalse(ScheduleCard.showsRangeSection(schedule: oneDay, cardDays: [d4]))
    XCTAssertTrue(ScheduleCard.showsRangeSection(schedule: oneDay, cardDays: []))
    XCTAssertTrue(ScheduleCard.showsRangeSection(schedule: week, cardDays: [DateInterval(start: d("2026-10-05T15:00:00Z"), duration: 86_400)]))
    XCTAssertTrue(ScheduleCard.showsRangeSection(schedule: DateInterval(start: d("2026-10-04T15:00:00Z"), duration: 86_399), cardDays: [d4]))
    XCTAssertEqual(ScheduleCard.seoulDay(d("2026-10-04T14:59:59Z")), d4)                          // 서울 23:59:59 는 그날
  }
}
