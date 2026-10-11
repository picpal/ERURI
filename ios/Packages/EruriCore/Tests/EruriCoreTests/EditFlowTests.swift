import XCTest
@testable import EruriCore

/// 스펙 §9 B 앱 표·§10 "채팅 일정 고치기 실행"(바꾸기 3~5·계보 확인) — 판정만(EventKit 없음). 기준 지금 2026-10-08 12:00(서울). 문구는 전부 합성
final class EditFlowTests: XCTestCase {
  typealias E = ProposalFlow.CalendarEvent
  private func d(_ s: String) -> Date { ISO8601DateFormatter().date(from: s)! }
  private let now = ISO8601DateFormatter().date(from: "2026-10-08T03:00:00Z")!
  private let seoul = TimeZone(identifier: "Asia/Seoul")!
  private func ev(_ id: String, _ s: String, _ e: String, title: String = "합성 미팅", pid: String? = nil, allDay: Bool = false,
                  canceled: Bool = false, recurring: Bool = false) -> E {
    E(id: id, title: title, start: d(s), end: d(e), allDay: allDay, canceled: canceled, url: pid.map(ProposalFlow.marker), recurring: recurring)
  }
  private func ver(_ id: String, _ v: Int, action: String = "create_event", status: String = "proposed", start: String, end: String? = nil,
                   title: String = "합성 미팅", before: ChatEdit.Values? = nil, base: String? = nil, ek: String? = nil, uncertain: [String] = []) -> ProposalVersion {
    var p: [String: JSONValue] = ["title": .string(title), "start": .string(start), "uncertain": .array(uncertain.map { .string($0) })]
    if let end { p["end"] = .string(end) }
    if let b = before {
      p["before"] = .object(["title": b.title.map { .string($0) } ?? .null, "start": b.start.map { .string($0) } ?? .null,
                             "end": b.end.map { .string($0) } ?? .null, "location": b.location.map { .string($0) } ?? .null])
    }
    if let base { p["base_proposal_id"] = .string(base) }
    return ProposalVersion(id: id, action: action, status: status, version: v, payload: p, eventkitID: ek)
  }
  private let B1 = ChatEdit.Values(title: "합성 미팅", start: "2026-10-10T11:00:00+09:00", end: "2026-10-10T15:00:00+09:00", location: nil)
  /// 가짜 캘린더: 창과 겹치는 일정만 돌려준다
  private func lookup(_ all: [E], ids: [String: E] = [:], executed: [String: String] = [:]) -> EditFlow.Lookup {
    EditFlow.Lookup(events: { w in all.filter { $0.start < w.end && $0.end >= w.start } }, byIdentifier: { ids[$0] }, executedEventID: { executed[$0] })
  }

  // ── 기준 일정 찾기(§10 바꾸기 3, Codex H2) ──
  func testFindBaseOrderMarkerThenIdentifierThenWide() {
    let near = ev("a", "2026-10-10T02:00:00Z", "2026-10-10T06:00:00Z", pid: "p1")
    XCTAssertEqual(EditFlow.findBase(basePid: "p1", newPid: "p2", near: [near], identifier: .noIdentifier, wide: { XCTFail("wide"); return [] }), .found(near))
    let moved = ev("a", "2026-10-17T02:00:00Z", "2026-10-17T06:00:00Z", pid: "p1")
    XCTAssertEqual(EditFlow.findBase(basePid: "p1", newPid: "p2", near: [], identifier: .found(moved), wide: { XCTFail("wide"); return [] }), .found(moved))
    let other = ev("a", "2026-10-17T02:00:00Z", "2026-10-17T06:00:00Z", pid: "zz")         // 식별자가 다른 일정을 가리키면 그 일정이 아니다
    XCTAssertEqual(EditFlow.findBase(basePid: "p1", newPid: "p2", near: [], identifier: .found(other), wide: { [] }), .deleted)
    let far = ev("b", "2026-10-24T02:00:00Z", "2026-10-24T06:00:00Z", pid: "p1")             // 다른 캘린더로 옮겨 식별자가 바뀜(U3)
    XCTAssertEqual(EditFlow.findBase(basePid: "p1", newPid: "p2", near: [], identifier: .notFound, wide: { [far] }), .found(far))
    XCTAssertEqual(EditFlow.findBase(basePid: "p1", newPid: "p2", near: [], identifier: .notFound, wide: { [] }), .deleted)
    XCTAssertEqual(EditFlow.findBase(basePid: "p1", newPid: "p2", near: [], identifier: .noIdentifier, wide: { [] }), .unknown)
    let canceled = ev("a", "2026-10-10T02:00:00Z", "2026-10-10T06:00:00Z", pid: "p1", canceled: true)
    XCTAssertEqual(EditFlow.findBase(basePid: "p1", newPid: "p2", near: [canceled], identifier: .noIdentifier, wide: { [canceled] }), .unknown)
  }

  // ── 사용자 수정 판정(§10 바꾸기 4) ──
  func testUserModifiedComparesStartEndTitleAndRecurrence() {
    let same = ev("a", "2026-10-10T02:00:00Z", "2026-10-10T06:00:00Z", pid: "p1")
    XCTAssertFalse(EditFlow.userModified(same, before: B1))
    XCTAssertTrue(EditFlow.userModified(ev("a", "2026-10-10T02:00:00Z", "2026-10-10T06:00:00Z", title: "합성 다른"), before: B1))
    XCTAssertFalse(EditFlow.userModified(ev("a", "2026-10-10T02:00:00Z", "2026-10-10T06:00:00Z", title: " 합성 미팅 "), before: B1))
    XCTAssertTrue(EditFlow.userModified(ev("a", "2026-10-17T02:00:00Z", "2026-10-17T06:00:00Z"), before: B1))   // 다음 주로 옮김
    XCTAssertTrue(EditFlow.userModified(ev("a", "2026-10-10T02:00:00Z", "2026-10-10T07:00:00Z"), before: B1))   // 끝만 바꿈
    XCTAssertTrue(EditFlow.userModified(ev("a", "2026-10-10T02:00:00Z", "2026-10-10T06:00:00Z", recurring: true), before: B1))
    let noEnd = ChatEdit.Values(title: "합성 미팅", start: "2026-10-10T11:00:00+09:00", end: nil, location: nil)
    XCTAssertFalse(EditFlow.userModified(ev("a", "2026-10-10T02:00:00Z", "2026-10-10T03:00:00Z"), before: noEnd))  // 기본 1시간(§10 일정 종료)
  }
  func testAllDayUserModifiedUsesSeoulDays() {
    let b = ChatEdit.Values(title: "합성 워크숍", start: "2026-10-12", end: nil, location: nil)
    let la = TimeZone(identifier: "America/Los_Angeles")!
    // ERURI 가 저장한 모양: 기기 시간대 첫날 0시 = 끝(하루)
    let saved = E(id: "w", title: "합성 워크숍", start: ProposalTiming.Day(2026, 10, 12).start(in: la), end: ProposalTiming.Day(2026, 10, 12).start(in: la), allDay: true)
    XCTAssertFalse(EditFlow.userModified(saved, before: b, deviceZone: la))
    let lateEnd = E(id: "w", title: "합성 워크숍", start: ProposalTiming.Day(2026, 10, 12).start(in: la),
                    end: ProposalTiming.Day(2026, 10, 12).start(in: la).addingTimeInterval(86_399), allDay: true)   // 23:59:59 로 읽히는 경우(U2)
    XCTAssertFalse(EditFlow.userModified(lateEnd, before: b, deviceZone: la))
    let moved = E(id: "w", title: "합성 워크숍", start: ProposalTiming.Day(2026, 10, 13).start(in: la), end: ProposalTiming.Day(2026, 10, 13).start(in: la), allDay: true)
    XCTAssertTrue(EditFlow.userModified(moved, before: b, deviceZone: la))
    XCTAssertTrue(EditFlow.userModified(ev("t", "2026-10-12T01:00:00Z", "2026-10-12T02:00:00Z", title: "합성 워크숍"), before: b))   // 시각 일정으로 바뀜
  }

  // ── 바꾸기 상태(§10 바꾸기 3~5) ──
  func testChangeDoneWhenNewMarkerExists() {
    let newT = ProposalTiming.parse(start: "2026-10-10T14:00:00+09:00")!
    let moved = ev("a", "2026-10-10T05:00:00Z", "2026-10-10T06:00:00Z", pid: "p2")
    XCTAssertEqual(EditFlow.change(newPid: "p2", newTiming: newT, before: B1, base: .unknown, nearNew: [moved]), .done)
  }
  func testChangeReadyWithConflictsExcludingItselfAndNoneForAllDay() {
    let base = ev("a", "2026-10-10T02:00:00Z", "2026-10-10T06:00:00Z", pid: "p1")
    let other = ev("o", "2026-10-10T06:00:00Z", "2026-10-10T07:00:00Z", title: "합성 다른", pid: nil)
    let t = ProposalTiming.parse(start: "2026-10-10T14:00:00+09:00", end: "2026-10-10T18:00:00+09:00")!
    XCTAssertEqual(EditFlow.change(newPid: "p2", newTiming: t, before: B1, base: .found(base), nearNew: [base, other]), .ready(base: base, conflicts: [other]))
    XCTAssertEqual(EditFlow.change(newPid: "p2", newTiming: .allDay(first: .init(2026, 10, 10), last: .init(2026, 10, 10)), before: B1, base: .found(base), nearNew: [base, other]),
                   .ready(base: base, conflicts: []))
    XCTAssertEqual(EditFlow.change(newPid: "p2", newTiming: t, before: B1, base: .found(ev("a", "2026-10-17T02:00:00Z", "2026-10-17T06:00:00Z", pid: "p1")), nearNew: []), .userModified)
    XCTAssertEqual(EditFlow.change(newPid: "p2", newTiming: t, before: B1, base: .deleted, nearNew: []), .deleted)
  }

  // ── 계보 확인(§10, Codex H1) ──
  func testLineageFindsTheNewestPriorInCalendar() {
    let v1 = ver("p1", 1, status: "stale", start: "2026-10-10T11:00:00+09:00"), v2 = ver("p2", 2, status: "stale", start: "2026-10-09T11:00:00+09:00")
    XCTAssertEqual(EditFlow.lineage(version: 3, priors: [v1, v2], executed: { $0 == "p1" }, markerFound: { _ in false }), v1)
    XCTAssertEqual(EditFlow.lineage(version: 3, priors: [v1, v2], executed: { _ in true }, markerFound: { _ in false }), v2)
    XCTAssertEqual(EditFlow.lineage(version: 3, priors: [v1, v2], executed: { _ in false }, markerFound: { $0.id == "p1" }), v1)
    XCTAssertNil(EditFlow.lineage(version: 1, priors: [v1], executed: { _ in true }, markerFound: { _ in true }))
    XCTAssertNil(EditFlow.lineage(version: 3, priors: [v1, v2], executed: { _ in false }, markerFound: { _ in false }))
  }

  // ── 카드 상태(스펙 B 앱 표, K27) ──
  func testStateCreateBeforeAddIsTheNormalCard() {
    let v2 = ver("p2", 2, start: "2026-10-09T11:00:00+09:00", end: "2026-10-09T15:00:00+09:00")
    guard case .add(let m) = EditFlow.state(subject: v2, versions: [ver("p1", 1, status: "stale", start: "2026-10-10T11:00:00+09:00"), v2], itemID: "i1",
                                            lookup: lookup([]), now: now) else { return XCTFail("add") }
    XCTAssertEqual([m.pid, ScheduleCard.statusText(m)], ["p2", "아직 캘린더에 없음"])
  }
  func testStateLineageWhenAPriorVersionIsInCalendar() {
    let v1 = ver("p1", 1, status: "stale", start: "2026-10-10T11:00:00+09:00", end: "2026-10-10T15:00:00+09:00")
    let v2 = ver("p2", 2, start: "2026-10-09T11:00:00+09:00", end: "2026-10-09T15:00:00+09:00")
    let inCal = ev("a", "2026-10-10T02:00:00Z", "2026-10-10T06:00:00Z", pid: "p1")
    let s = EditFlow.state(subject: v2, versions: [v1, v2], itemID: "i1", lookup: lookup([inCal]), now: now)
    XCTAssertEqual(s, .lineage(prior: v1, change: .ready(base: inCal, conflicts: [])))
    XCTAssertEqual(EditFlow.status(s), EditFlow.Status(text: ChatEditText.lineage, warning: false, conflictLine: nil, button: .change))
    let ci = try? XCTUnwrap(EditFlow.changeInput(subject: v2, state: s))
    XCTAssertEqual(ci?.basePid, "p1"); XCTAssertEqual(ci?.before, v1.values); XCTAssertEqual(ci?.newPid, "p2")
  }
  func testStateUpdateRowsOfTheTable() {
    let v1 = ver("p1", 1, status: "succeeded", start: "2026-10-10T11:00:00+09:00", end: "2026-10-10T15:00:00+09:00", ek: "EK-1")
    let v2 = ver("p2", 2, action: "update_event", start: "2026-10-10T14:00:00+09:00", end: "2026-10-10T18:00:00+09:00", before: B1, base: "p1", ek: "EK-1")
    let base = ev("EK-1", "2026-10-10T02:00:00Z", "2026-10-10T06:00:00Z", pid: "p1")
    let st = { (l: EditFlow.Lookup?) in EditFlow.state(subject: v2, versions: [v1, v2], itemID: "i1", lookup: l, now: self.now) }
    XCTAssertEqual(st(lookup([base])), .update(.ready(base: base, conflicts: [])))
    XCTAssertEqual(EditFlow.status(st(lookup([base])))?.text, "캘린더에 있는 일정도 바꿀까요?")
    XCTAssertEqual(st(lookup([ev("EK-1", "2026-10-10T02:00:00Z", "2026-10-10T06:00:00Z", title: "합성 손댐", pid: "p1")])), .update(.userModified))
    XCTAssertEqual(st(lookup([], ids: [:], executed: [:])), .update(.deleted))                                   // 제안 eventkit_id 로 조회했는데 없음
    let noId = ver("p2", 2, action: "update_event", start: "2026-10-10T14:00:00+09:00", before: B1, base: "p1", ek: nil)
    XCTAssertEqual(EditFlow.state(subject: noId, versions: [v1, noId], itemID: "i1", lookup: lookup([]), now: now), .update(.unknown))
    XCTAssertEqual(EditFlow.status(.update(.unknown))?.button, nil)
    XCTAssertEqual(EditFlow.status(.update(.deleted)), EditFlow.Status(text: "캘린더에서 지운 일정이에요", warning: false, conflictLine: nil, button: .add))
    let changed = ev("EK-1", "2026-10-10T05:00:00Z", "2026-10-10T09:00:00Z", pid: "p2")
    XCTAssertEqual(st(lookup([changed])), .update(.done))
    XCTAssertEqual(EditFlow.status(.update(.done))?.text, "✅ 캘린더도 바꿨어요")
    XCTAssertEqual(st(nil), .noAccess)
    // K11(Codex 플랜 리뷰 M5): 바꾼 뒤(succeeded) 새 표식 일정이 그 창에 없으면 그 버전 자신으로 다시 찾는다 — 옮김·지움·확인 불가
    let applied = ver("p2", 2, action: "update_event", status: "succeeded", start: "2026-10-10T14:00:00+09:00", before: B1, base: "p1", ek: "EK-1")
    let stA = { (l: EditFlow.Lookup) in EditFlow.state(subject: applied, versions: [v1, applied], itemID: "i1", lookup: l, now: self.now) }
    let movedEv = ev("EK-1", "2026-10-17T05:00:00Z", "2026-10-17T06:00:00Z", pid: "p2")                       // 사용자가 다음 주로 옮김 — 넓은 표식 조회가 찾는다
    XCTAssertEqual(stA(lookup([movedEv])), .movedAfterChange(.addedMoved(movedEv.start)))
    XCTAssertEqual(EditFlow.status(stA(lookup([movedEv]))), EditFlow.Status(text: "✅ 캘린더도 바꿨어요 · 캘린더에서는 10/17(토) 14:00", warning: false, conflictLine: nil, button: nil))
    XCTAssertEqual(stA(lookup([])), .update(.deleted))                                                          // 식별자(제안 eventkit_id)로 조회했는데 없음 → [캘린더에 추가]
    let appliedNoId = ver("p2", 2, action: "update_event", status: "succeeded", start: "2026-10-10T14:00:00+09:00", before: B1, base: "p1", ek: nil)
    XCTAssertEqual(EditFlow.state(subject: appliedNoId, versions: [v1, appliedNoId], itemID: "i1", lookup: lookup([]), now: now), .update(.unknown))   // 식별자 없음 → 확인 불가
  }
  /// 최종 리뷰 I1 재현: v1 추가(보고됨) → v2 update_event 를 [캘린더도 바꾸기](일정 url = v2 표식, 이 기기 기록 v2) → v2 보고가 서버에 닿기 전 다시 고침 →
  /// 서버 기준 = v1 이라 v3 update_event(before = v1 값, base = v1), v2 stale. v3 카드는 "지운 일정"([캘린더에 추가] → 중복)이 아니라 v2 일정을 기준으로 바꾼다
  func testStateUpdateUsesAnIntermediateVersionInCalendarAsTheBase() {
    let v1 = ver("p1", 1, status: "succeeded", start: "2026-10-10T11:00:00+09:00", end: "2026-10-10T15:00:00+09:00", ek: "EK-1")
    let v2 = ver("p2", 2, action: "update_event", status: "stale", start: "2026-10-10T14:00:00+09:00", end: "2026-10-10T18:00:00+09:00", before: B1, base: "p1", ek: "EK-1")
    let v3 = ver("p3", 3, action: "update_event", start: "2026-10-10T15:00:00+09:00", end: "2026-10-10T19:00:00+09:00", before: B1, base: "p1", ek: "EK-1")
    let moved = ev("EK-1", "2026-10-10T05:00:00Z", "2026-10-10T09:00:00Z", pid: "p2")
    let st = { (l: EditFlow.Lookup) in EditFlow.state(subject: v3, versions: [v1, v2, v3], itemID: "i1", lookup: l, now: self.now) }
    let s = st(lookup([moved], ids: ["EK-1": moved], executed: ["p1": "EK-1", "p2": "EK-1"]))
    XCTAssertEqual(s, .lineage(prior: v2, change: .ready(base: moved, conflicts: [])))
    XCTAssertEqual(EditFlow.status(s)?.button, .change)
    let ci = try? XCTUnwrap(EditFlow.changeInput(subject: v3, state: s))
    XCTAssertEqual(ci?.basePid, "p2"); XCTAssertEqual(ci?.before, v2.values); XCTAssertEqual(ci?.baseEventID, "EK-1"); XCTAssertEqual(ci?.newPid, "p3")
    // 이 기기 기록이 없어도(재설치 등) v2 표식 일정이 v2 조회 창에 있으면 같은 판정
    XCTAssertEqual(st(lookup([moved], ids: ["EK-1": moved])), .lineage(prior: v2, change: .ready(base: moved, conflicts: [])))
    // 중간 버전이 캘린더에 들어간 적 없으면 지금처럼 서버 기준(v1)
    let atV1 = ev("EK-1", "2026-10-10T02:00:00Z", "2026-10-10T06:00:00Z", pid: "p1")
    XCTAssertEqual(st(lookup([atV1], ids: ["EK-1": atV1], executed: ["p1": "EK-1"])), .update(.ready(base: atV1, conflicts: [])))
    // 기준 버전을 모르면(버전 목록 = [subject]) 계보를 보지 않는다 — 지금 판정 그대로
    XCTAssertEqual(EditFlow.state(subject: v3, versions: [v3], itemID: "i1", lookup: lookup([moved], ids: ["EK-1": moved], executed: ["p2": "EK-1"]), now: now),
                   .update(.deleted))
  }
  /// P2 ①·P5 ③: 식별자·넓은 조회로 찾은 기준 일정이 이미 새 표식이면(저장 뒤 기록 전 종료 + 사용자가 옮김) 손댄 일정이 아니라 끝난 바꾸기
  func testChangeDoneWhenTheFoundBaseCarriesTheNewMarker() {
    let t = ProposalTiming.parse(start: "2026-10-10T14:00:00+09:00", end: "2026-10-10T18:00:00+09:00")!
    let movedAway = ev("EK-1", "2026-10-17T05:00:00Z", "2026-10-17T09:00:00Z", pid: "p2")
    XCTAssertEqual(EditFlow.findBase(basePid: "p1", newPid: "p2", near: [], identifier: .found(movedAway), wide: { [] }), .found(movedAway))
    XCTAssertEqual(EditFlow.change(newPid: "p2", newTiming: t, before: B1, base: .found(movedAway), nearNew: []), .done)
    let v2 = ver("p2", 2, action: "update_event", start: "2026-10-10T14:00:00+09:00", end: "2026-10-10T18:00:00+09:00", before: B1, base: "p1", ek: "EK-1")
    XCTAssertEqual(EditFlow.state(subject: v2, versions: [v2], itemID: "i1", lookup: lookup([movedAway], ids: ["EK-1": movedAway]), now: now), .update(.done))
  }
  func testStateSupersededDismissedAndPast() {
    let v1 = ver("p1", 1, status: "stale", start: "2026-10-10T11:00:00+09:00"), v2 = ver("p2", 2, start: "2026-10-09T11:00:00+09:00")
    XCTAssertEqual(EditFlow.state(subject: v1, versions: [v1, v2], itemID: "i1", lookup: lookup([]), now: now), .superseded)
    let applied = ver("p1", 1, status: "succeeded", start: "2026-10-10T11:00:00+09:00")
    XCTAssertEqual(EditFlow.state(subject: applied, versions: [applied, v2], itemID: "i1", lookup: lookup([]), now: now), .superseded)   // 최신이 아님
    XCTAssertEqual(EditFlow.state(subject: ver("p3", 3, status: "dismissed", start: "2026-10-09T11:00:00+09:00"), versions: [], itemID: "i1", lookup: nil, now: now), .dismissed)
    let past = ver("p2", 2, action: "update_event", start: "2026-10-07T14:00:00+09:00", before: B1, base: "p1")
    XCTAssertEqual(EditFlow.state(subject: past, versions: [past], itemID: "i1", lookup: lookup([]), now: now), .past)
  }
  func testConflictStatusAndChangeInputForUpdate() {
    let v2 = ver("p2", 2, action: "update_event", start: "2026-10-10T14:00:00+09:00", end: "2026-10-10T18:00:00+09:00", title: "합성 회의", before: B1, base: "p1", ek: "EK-1")
    let base = ev("EK-1", "2026-10-10T02:00:00Z", "2026-10-10T06:00:00Z", pid: "p1"), other = ev("o", "2026-10-10T06:00:00Z", "2026-10-10T07:00:00Z", title: "합성 회식")
    let s = EditFlow.state(subject: v2, versions: [v2], itemID: "i1", lookup: lookup([base, other]), now: now)
    XCTAssertEqual(EditFlow.status(s), EditFlow.Status(text: "캘린더에 있는 일정도 바꿀까요?", warning: true,
                                                     conflictLine: "⚠️ 바꾸면 겹치는 일정 15:00–16:00 합성 회식", button: .changeAnyway))
    XCTAssertEqual(EditFlow.changeInput(subject: v2, state: s),
                   EditFlow.ChangeInput(newPid: "p2", version: 2, title: "합성 회의", startText: "2026-10-10T14:00:00+09:00", endText: "2026-10-10T18:00:00+09:00",
                                        location: nil, basePid: "p1", before: B1, baseEventID: "EK-1"))
    XCTAssertEqual(EditFlow.addFields(v2), ["proposal_id": "p2", "title": "합성 회의", "version": "2", "start": "2026-10-10T05:00:00Z", "end": "2026-10-10T09:00:00Z"])
  }
  func testPriorsFromTheServerRow() throws {
    let row = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(#"{"status":"proposed","version":2,"facts":{"proposals":[{"id":"p2","version":2,"status":"proposed","start":"2026-10-09T11:00:00+09:00","end_at":null},{"id":"p1","version":1,"status":"stale","start":"2026-10-10T11:00:00+09:00","end_at":"2026-10-10T15:00:00+09:00"}]}}"#.utf8)) as? [String: Any])
    let ps = try XCTUnwrap(EditFlow.priors(row: row))
    XCTAssertEqual(ps.map(\.id), ["p1", "p2"]); XCTAssertEqual(ps[0].end, "2026-10-10T15:00:00+09:00"); XCTAssertNil(ps[1].end)
    XCTAssertNil(EditFlow.priors(row: ["status": "proposed"]))
    XCTAssertEqual(EditFlow.lineageSelect, "facts(proposals(id,version,status,start:payload->>start,end_at:payload->>end))")
  }
}
