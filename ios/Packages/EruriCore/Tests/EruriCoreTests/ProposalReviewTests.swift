import XCTest
@testable import EruriCore

/// 제안 리뷰(Ruling 8', 스펙 §10·§11): 목록 해석·handleAdd 입력·배너 탭 딥링크·시트 내용·무시 결과 문구
final class ProposalReviewTests: XCTestCase {
  private let pid = "0b7f3a52-3c1e-4d7a-9a51-6f1f7a9c2e10"

  private func listJSON(_ extra: String = "") -> Data {
    Data("""
    [{"proposal_id":"\(pid)","action":"ADD_EVENT","title":"합성 회의","start":"2026-10-02T06:30:00+00:00",
      "end":null,"location":"합성 회의실","version":2,"created_at":"2026-09-30T08:00:00.123456+00:00"}\(extra)]
    """.utf8)
  }

  func testDecodeList() throws {
    let rows = try XCTUnwrap(ProposalReview.decodeList(listJSON()))
    XCTAssertEqual(rows.count, 1)
    XCTAssertEqual(rows[0].id, pid)
    XCTAssertEqual(rows[0].location, "합성 회의실")
    XCTAssertNil(rows[0].end)
    XCTAssertEqual(rows[0].whenLabel, "2026-10-02 15:30")                 // 서울
    XCTAssertEqual(ProposalReview.decodeList(Data("[]".utf8))?.count, 0)
    XCTAssertNil(ProposalReview.decodeList(Data("{\"code\":\"42883\"}".utf8)))   // 오류 본문은 목록이 아니다
  }

  /// handleAdd 는 알림 페이로드 키(proposal_id·title·start·version)를 받는다. Postgres 소수 초가 붙어도 읽을 수 있는 start 로 바꾼다
  func testAddFields() throws {
    let row = try XCTUnwrap(ProposalReview.decodeList(listJSON())?.first)
    let f = try XCTUnwrap(row.addFields)
    XCTAssertEqual(f["proposal_id"], pid); XCTAssertEqual(f["title"], "합성 회의"); XCTAssertEqual(f["version"], "2")
    XCTAssertEqual(ISO8601DateFormatter().date(from: try XCTUnwrap(f["start"])), Date(timeIntervalSince1970: 1_790_922_600))
    let frac = try XCTUnwrap(ProposalReview.decodeList(Data("""
      [{"proposal_id":"\(pid)","action":"ADD_EVENT","title":"t","start":"2026-10-02T06:30:00.5+00:00","end":null,"location":null,"version":1,"created_at":"x"}]
      """.utf8))?.first)
    XCTAssertNotNil(frac.addFields?["start"].flatMap { ISO8601DateFormatter().date(from: $0) })
    let bad = try XCTUnwrap(ProposalReview.decodeList(Data("""
      [{"proposal_id":"\(pid)","action":"ADD_EVENT","title":"t","start":"내일","end":null,"location":null,"version":1,"created_at":"x"}]
      """.utf8))?.first)
    XCTAssertNil(bad.addFields)                                             // 읽지 못할 시각이면 추가 버튼 없음
  }

  /// 0026 종일 행(0.9.1): start·end 는 YYYY-MM-DD, all_day = true. 표시 "10/8(목) · 종일", 추가 필드는 날짜 그대로(여러 날이면 end).
  /// 0026 의 시각 있는 행(+09:00 text)은 그대로 읽힌다. all_day 와 start 형식이 어긋나면 추가 버튼 없음
  func testAllDayRows() throws {
    let rows = try XCTUnwrap(ProposalReview.decodeList(Data("""
      [{"proposal_id":"\(pid)","action":"ADD_EVENT","title":"합성 공지 행사","start":"2026-10-08","end":null,"all_day":true,"location":null,"version":1,"created_at":"x"},
       {"proposal_id":"\(p2)","action":"ADD_EVENT","title":"합성 축제","start":"2026-10-08","end":"2026-10-10","all_day":true,"location":null,"version":4,"created_at":"x"},
       {"proposal_id":"\(p3)","action":"ADD_EVENT","title":"합성 회의","start":"2026-10-02T15:30:00+09:00","end":null,"all_day":false,"location":null,"version":1,"created_at":"x"},
       {"proposal_id":"\(p3)","action":"ADD_EVENT","title":"합성 어긋남","start":"2026-10-02T15:30:00+09:00","end":null,"all_day":true,"location":null,"version":1,"created_at":"x"}]
      """.utf8)))
    XCTAssertEqual(rows.map(\.whenLabel), ["10/8(목) · 종일", "10/8(목)–10/10(토) · 종일", "2026-10-02 15:30", "2026-10-02 15:30"])
    XCTAssertEqual(rows[0].addFields, ["proposal_id": pid, "title": "합성 공지 행사", "start": "2026-10-08", "version": "1"])
    XCTAssertEqual(rows[1].addFields, ["proposal_id": p2, "title": "합성 축제", "start": "2026-10-08", "end": "2026-10-10", "version": "4"])
    XCTAssertEqual(rows[2].addFields?["start"].flatMap { ISO8601DateFormatter().date(from: $0) }, ISO8601DateFormatter().date(from: "2026-10-02T06:30:00Z"))
    XCTAssertNil(rows[2].addFields?["end"])
    XCTAssertNil(rows[3].addFields)
    XCTAssertTrue(rows[0].isAllDay); XCTAssertFalse(rows[2].isAllDay)
  }

  /// 날짜만 ADD_EVENT 알림(0.9.1 서버): 배너 탭 링크는 end 를 들고, 목록을 못 읽으면 알림 값으로 종일 추가. 표시도 종일
  func testAllDayPushLink() throws {
    let l = try XCTUnwrap(ProposalReview.link(actionIdentifier: ProposalReview.defaultAction, category: "ADD_EVENT",
      fields: ["proposal_id": pid, "title": "합성 축제", "start": "2026-10-08", "end": "2026-10-10", "version": "2"]))
    XCTAssertEqual(l.end, "2026-10-10"); XCTAssertEqual(l.whenLabel, "10/8(목)–10/10(토) · 종일")
    guard case .offline(let f) = ProposalReview.sheet(for: l, list: nil) else { return XCTFail("offline") }
    XCTAssertEqual(f, ["proposal_id": pid, "title": "합성 축제", "start": "2026-10-08", "end": "2026-10-10", "version": "2"])
    XCTAssertEqual(ProposalReview.sheet(for: l, list: []), .processed)
    // 묶음 원소의 end 도 카드 링크·알림 값까지 간다
    let ev = ProposalReview.bundleEvents([["proposal_id": p2, "title": "합성 축제", "start": "2026-10-08", "end": "2026-10-10", "version": "1", "category": "ADD_EVENT"]])
    XCTAssertEqual(ev.first?.end, "2026-10-10"); XCTAssertEqual(ev.first?.link.end, "2026-10-10")
    let b = try XCTUnwrap(ProposalReview.link(actionIdentifier: ProposalReview.defaultAction, category: "EVENT_BUNDLE", fields: [:],
      events: [raw(pid, "2026-10-04T14:00:00+09:00"), ["proposal_id": p2, "title": "합성 축제", "start": "2026-10-08", "end": "2026-10-10", "version": "1", "category": "ADD_EVENT"]]))
    let c = ProposalReview.cards(for: b, list: [], statuses: [pid: "proposed", p2: "proposed"])
    guard case .unlisted(let u) = c[1].sheet else { return XCTFail("unlisted") }
    XCTAssertEqual([u["start"], u["end"]], ["2026-10-08", "2026-10-10"])
  }

  /// 배너 탭(기본 액션)만, 세 제안 카테고리만, 제안 id 가 UUID 일 때만 딥링크
  func testLinkFromNotification() {
    let fields = ["proposal_id": pid, "title": "합성 회의", "start": "2026-10-02T15:30:00+09:00", "version": "2"]
    let l = ProposalReview.link(actionIdentifier: ProposalReview.defaultAction, category: "ADD_EVENT", fields: fields)
    XCTAssertEqual(l?.proposalId, pid); XCTAssertEqual(l?.category, "ADD_EVENT"); XCTAssertEqual(l?.title, "합성 회의")
    XCTAssertEqual(l?.version, 2)
    XCTAssertNotNil(ProposalReview.link(actionIdentifier: ProposalReview.defaultAction, category: "REVIEW", fields: fields))
    XCTAssertEqual(ProposalReview.link(actionIdentifier: ProposalReview.defaultAction, category: "ADD_REMINDER",
                                       fields: ["proposal_id": pid, "title": "할 일", "due": "2026-10-03"])?.due, "2026-10-03")
    XCTAssertNil(ProposalReview.link(actionIdentifier: "ADD", category: "ADD_EVENT", fields: fields))        // 버튼 액션은 각자 경로
    XCTAssertNil(ProposalReview.link(actionIdentifier: ProposalReview.defaultAction, category: "", fields: fields))  // "변경된 제안" 등 로컬 안내
    XCTAssertNil(ProposalReview.link(actionIdentifier: ProposalReview.defaultAction, category: "ADD_EVENT", fields: ["proposal_id": "x"]))
    XCTAssertEqual(ProposalReview.link(actionIdentifier: ProposalReview.defaultAction, category: "ADD_EVENT", fields: ["proposal_id": pid])?.title,
                   "일정")                                                  // 제목이 빠져도 시트는 뜬다
  }

  /// 시트 내용: 목록에 있으면 서버 값(장소 포함), 확인 필요·할 일은 무시만, 목록을 못 읽었으면 푸시 값으로(§10 순서 5), 목록에 없으면 처리됨
  func testSheetContent() throws {
    let rows = try XCTUnwrap(ProposalReview.decodeList(listJSON()))
    let add = ProposalReview.Link(proposalId: pid, category: "ADD_EVENT", title: "합성 회의", start: "2026-10-02T15:30:00+09:00", due: nil, version: 2)
    XCTAssertEqual(ProposalReview.sheet(for: add, list: rows), .pending(rows[0]))
    XCTAssertEqual(ProposalReview.sheet(for: add, list: []), .processed)
    guard case .offline(let f) = ProposalReview.sheet(for: add, list: nil) else { return XCTFail() }
    XCTAssertEqual(f, ["proposal_id": pid, "title": "합성 회의", "start": "2026-10-02T15:30:00+09:00", "version": "2"])
    let noStart = ProposalReview.Link(proposalId: pid, category: "ADD_EVENT", title: "t", start: nil, due: nil, version: nil)
    XCTAssertEqual(ProposalReview.sheet(for: noStart, list: nil), .processed)
    let review = ProposalReview.Link(proposalId: pid, category: "REVIEW", title: "t", start: "2026-10-24", due: nil, version: 1)
    XCTAssertEqual(ProposalReview.sheet(for: review, list: []), .needsReview)
    XCTAssertEqual(ProposalReview.sheet(for: review, list: nil), .needsReview)
    let reminder = ProposalReview.Link(proposalId: pid, category: "ADD_REMINDER", title: "t", start: nil, due: nil, version: 1)
    XCTAssertEqual(ProposalReview.sheet(for: reminder, list: []), .needsReview)
  }

  func testLinkWhenLabel() {
    XCTAssertEqual(ProposalReview.Link(proposalId: pid, category: "ADD_EVENT", title: "t", start: "2026-10-02T15:30:00+09:00", due: nil, version: nil).whenLabel,
                   "2026-10-02 15:30")
    XCTAssertEqual(ProposalReview.Link(proposalId: pid, category: "REVIEW", title: "t", start: "2026-10-24", due: nil, version: nil).whenLabel, "10/24(토)")   // 확인 필요는 종일이라 하지 않는다
    XCTAssertEqual(ProposalReview.Link(proposalId: pid, category: "ADD_EVENT", title: "t", start: "2026-10-24", due: nil, version: nil).whenLabel, "10/24(토) · 종일")
    XCTAssertEqual(ProposalReview.Link(proposalId: pid, category: "ADD_REMINDER", title: "t", start: nil, due: "2026-10-03", version: nil).whenLabel,
                   "2026-10-03까지")
    XCTAssertEqual(ProposalReview.Link(proposalId: pid, category: "ADD_REMINDER", title: "t", start: nil, due: nil, version: nil).whenLabel, "")
  }

  /// dismiss_proposal: ok · not_found · not_pending, nil = 네트워크 실패·마감(버튼 재활성)
  func testDismissFeedback() {
    XCTAssertEqual(ProposalReview.dismissFeedback("ok").retry, false)
    XCTAssertEqual(ProposalReview.dismissFeedback("ok").text, "무시했습니다")
    XCTAssertEqual(ProposalReview.dismissFeedback("not_pending").text, "이미 처리된 제안입니다")
    XCTAssertEqual(ProposalReview.dismissFeedback("not_found").retry, false)
    XCTAssertEqual(ProposalReview.dismissFeedback(nil).retry, true)
    XCTAssertEqual(ProposalReview.dismissFeedback("bogus").retry, true)
  }

  /// RPC 응답: 200 + JSON 문자열만 결과로 본다
  func testDismissResultParse() {
    XCTAssertEqual(ProposalReview.dismissResult(status: 200, data: Data("\"ok\"".utf8)), "ok")
    XCTAssertEqual(ProposalReview.dismissResult(status: 200, data: Data("\"not_pending\"".utf8)), "not_pending")
    XCTAssertNil(ProposalReview.dismissResult(status: 404, data: Data("{}".utf8)))
    XCTAssertNil(ProposalReview.dismissResult(status: nil, data: nil))
  }

  /// 행·시트 버튼 상태: 진행 중·완료면 버튼 끔, 실패면 다시 켬
  func testActionState() {
    XCTAssertTrue(ProposalReview.ActionState.idle.buttonsEnabled)
    XCTAssertFalse(ProposalReview.ActionState.running.buttonsEnabled)
    XCTAssertFalse(ProposalReview.ActionState.finished("x").buttonsEnabled)
    XCTAssertTrue(ProposalReview.ActionState.failed("x").buttonsEnabled)
    XCTAssertEqual(ProposalReview.ActionState.after(ChatReply.addFeedback("ok")), .finished("캘린더에 추가했습니다"))
    XCTAssertEqual(ProposalReview.ActionState.after(ChatReply.addFeedback("fail:x")), .failed("추가하지 못했습니다. 다시 눌러 주세요"))
    XCTAssertEqual(ProposalReview.ActionState.after(ProposalReview.dismissFeedback(nil)), .failed("처리하지 못했습니다. 다시 눌러 주세요"))
  }

  /// §10 겹침 로컬 알림: 탭하면 ADD_EVENT 배너처럼 제안 시트. 목록에 있으면 서버 값, 목록을 못 읽으면 알림 값으로 추가(offline), 목록에 없으면 처리됨
  func testConflictNoticeOpensSheet() throws {
    let f = ["proposal_id": pid, "title": "합성 회의", "start": "2026-10-02T15:30:00+09:00", "version": "2"]
    XCTAssertTrue(ProposalReview.categories.contains(ProposalReview.conflictCategory))
    let link = try XCTUnwrap(ProposalReview.link(actionIdentifier: ProposalReview.defaultAction, category: ProposalReview.conflictCategory, fields: f))
    XCTAssertEqual(ProposalReview.sheet(for: link, list: nil), .offline(f))
    let row = try XCTUnwrap(ProposalReview.decodeList(listJSON())?.first)
    XCTAssertEqual(ProposalReview.sheet(for: link, list: [row]), .pending(row))
    XCTAssertEqual(ProposalReview.sheet(for: link, list: []), .processed)
  }

  private let p2 = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f", p3 = "2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f60"
  private func raw(_ id: String, _ start: String, _ cat: String = "ADD_EVENT") -> [String: String] {
    ["proposal_id": id, "title": "합성 \(id.prefix(4))", "start": start, "version": "1", "category": cat]
  }

  /// 묶음 알림 events 해석: UUID·start 없는 원소는 빼고, 같은 id 는 하나, 최대 5개. category 는 ADD_EVENT 아니면 REVIEW
  func testBundleEvents() {
    let ev = ProposalReview.bundleEvents([raw(pid, "2026-10-04T14:00:00+09:00"), raw(pid, "2026-10-04T14:00:00+09:00"),
      ["proposal_id": "nope", "start": "2026-10-05"], ["proposal_id": p2, "title": "t"], raw(p3, "2026-10-23", "REVIEW")])
    XCTAssertEqual(ev.map(\.proposalId), [pid, p3])
    XCTAssertEqual(ev.map(\.category), ["ADD_EVENT", "REVIEW"])
    XCTAssertEqual(ev[0].version, 1)
    let many = (0..<7).map { _ in raw(UUID().uuidString.lowercased(), "2026-10-05") }
    XCTAssertEqual(ProposalReview.bundleEvents(many).count, 5)
  }

  /// EVENT_BUNDLE 배너 탭: 2건 이상이면 events 를 든 링크, 1건만 남으면 그 일정의 단건 링크, 0건이면 nil. 액션 버튼 탭은 nil
  func testBundleLink() throws {
    let two = [raw(pid, "2026-10-04T14:00:00+09:00"), raw(p3, "2026-10-23", "REVIEW")]
    let l = try XCTUnwrap(ProposalReview.link(actionIdentifier: ProposalReview.defaultAction, category: "EVENT_BUNDLE", fields: [:], events: two))
    XCTAssertEqual([l.proposalId, l.category], [pid, "EVENT_BUNDLE"])
    XCTAssertEqual(l.events.map(\.proposalId), [pid, p3])
    let one = try XCTUnwrap(ProposalReview.link(actionIdentifier: ProposalReview.defaultAction, category: "EVENT_BUNDLE", fields: [:], events: [two[1]]))
    XCTAssertEqual([one.proposalId, one.category], [p3, "REVIEW"]); XCTAssertTrue(one.events.isEmpty)
    XCTAssertNil(ProposalReview.link(actionIdentifier: ProposalReview.defaultAction, category: "EVENT_BUNDLE", fields: [:], events: []))
    XCTAssertNil(ProposalReview.link(actionIdentifier: "ADD", category: "EVENT_BUNDLE", fields: [:], events: two))
    // 단건 경로는 그대로(events 없이 부르는 기존 호출)
    XCTAssertEqual(ProposalReview.link(actionIdentifier: ProposalReview.defaultAction, category: "ADD_EVENT",
      fields: ["proposal_id": pid, "title": "t", "start": "2026-10-04T14:00:00+09:00"])?.events, [])
  }

  /// Review Focus 3·6: 상태 조회 실패(statuses nil)면 카드마다 기존 판정 — 목록에 있으면 서버 값, 목록에 없으면 처리됨, REVIEW 는 확인 필요, 목록 실패면 알림 값
  func testCardsMixedPartialAndOffline() throws {
    let l = try XCTUnwrap(ProposalReview.link(actionIdentifier: ProposalReview.defaultAction, category: "EVENT_BUNDLE", fields: [:],
      events: [raw(pid, "2026-10-02T15:30:00+09:00"), raw(p2, "2026-10-11T14:00:00+09:00"), raw(p3, "2026-10-23", "REVIEW")]))
    XCTAssertEqual(l.id, "bundle:\(pid),\(p2),\(p3)")                     // 같은 첫 일정의 단건 시트와 id 가 겹치지 않는다
    let list = try XCTUnwrap(ProposalReview.decodeList(listJSON()))          // pid 만 대기 중
    let cards = ProposalReview.cards(for: l, list: list, statuses: nil)
    XCTAssertEqual(cards.map(\.id), [pid, p2, p3])
    guard case .pending(let row) = cards[0].sheet else { return XCTFail("pending") }
    XCTAssertEqual(row.location, "합성 회의실")
    XCTAssertEqual(cards[1].sheet, .processed)
    XCTAssertEqual(cards[2].sheet, .needsReview)
    let offline = ProposalReview.cards(for: l, list: nil, statuses: nil)
    guard case .offline(let f) = offline[1].sheet else { return XCTFail("offline") }
    XCTAssertEqual([f["proposal_id"], f["start"], f["version"]], [p2, "2026-10-11T14:00:00+09:00", "1"])
    XCTAssertEqual(offline[2].sheet, .needsReview)
  }

  /// Codex 1: 상태 직접 조회 — 무시한 REVIEW 는 처리됨, proposed 인데 목록(50건 제한) 밖이면 알림 값(안내 없음), 행 없음은 처리됨
  func testCardsWithStatuses() throws {
    let l = try XCTUnwrap(ProposalReview.link(actionIdentifier: ProposalReview.defaultAction, category: "EVENT_BUNDLE", fields: [:],
      events: [raw(pid, "2026-10-02T15:30:00+09:00"), raw(p2, "2026-10-11T14:00:00+09:00"), raw(p3, "2026-10-23", "REVIEW")]))
    let list = try XCTUnwrap(ProposalReview.decodeList(listJSON()))          // pid 만 대기 중(= 목록 50건 안)
    let c = ProposalReview.cards(for: l, list: list, statuses: [pid: "proposed", p2: "proposed", p3: "dismissed"])
    guard case .pending = c[0].sheet else { return XCTFail("pending") }
    guard case .unlisted(let f) = c[1].sheet else { return XCTFail("unlisted") }   // 대기 51건째 같은 경우
    XCTAssertEqual([f["proposal_id"], f["start"]], [p2, "2026-10-11T14:00:00+09:00"])
    XCTAssertEqual(c[2].sheet, .processed)                                   // 무시한 REVIEW 를 다시 열어도 처리됨
    let r = ProposalReview.cards(for: l, list: list, statuses: [pid: "succeeded", p3: "proposed"])
    XCTAssertEqual([r[0].sheet, r[1].sheet, r[2].sheet], [.processed, .processed, .needsReview])   // p2 행 없음 → 처리됨
    let o = ProposalReview.cards(for: l, list: nil, statuses: [pid: "proposed", p2: "proposed", p3: "proposed"])
    guard case .offline = o[1].sheet else { return XCTFail("offline when the list failed") }
  }
}

/// 제안 탭 "전체 무시": 목 네트워크(dismiss 클로저)로 동시 수·마감·집계를 본다
final class ProposalDismissAllTests: XCTestCase {
  private actor Probe {
    var inFlight = 0, peak = 0, calls: [String] = []
    func enter(_ id: String) { calls.append(id); inFlight += 1; peak = max(peak, inFlight) }
    func leave() { inFlight -= 1 }
  }

  func testCountsAndConcurrencyLimit() async {
    let probe = Probe()
    let answers: [String: String?] = ["a": "ok", "b": "ok", "c": "not_pending", "d": nil, "e": "bogus", "f": "not_found", "g": "ok"]
    let r = await ProposalReview.dismissAll(Array(answers.keys).sorted()) { id in
      await probe.enter(id)
      try? await Task.sleep(for: .milliseconds(30))
      await probe.leave()
      return answers[id] ?? nil
    }
    XCTAssertEqual(r, .init(dismissed: 3, alreadyDone: 2, failed: 2))
    XCTAssertEqual(r.text, "3건 무시, 실패 2건 (이미 처리 2건)")
    let peak = await probe.peak, calls = await probe.calls
    XCTAssertLessThanOrEqual(peak, 2)
    XCTAssertEqual(peak, 2)                                                   // 동시 2건까지는 쓴다
    XCTAssertEqual(calls.sorted(), ["a", "b", "c", "d", "e", "f", "g"])       // 모두 한 번씩
  }

  /// 마감을 넘긴 요청은 실패로 세고, 나머지는 기다리지 않고 계속한다
  func testTimeoutCountsAsFailure() async {
    let started = Date()
    let r = await ProposalReview.dismissAll(["slow", "fast1", "fast2"], timeout: 0.2) { id in
      if id == "slow" { try? await Task.sleep(for: .seconds(5)) }
      return "ok"
    }
    XCTAssertEqual(r, .init(dismissed: 2, alreadyDone: 0, failed: 1))
    XCTAssertEqual(r.text, "2건 무시, 실패 1건")
    XCTAssertLessThan(Date().timeIntervalSince(started), 2)
  }

  func testEmpty() async {
    let r = await ProposalReview.dismissAll([]) { _ in XCTFail(); return "ok" }
    XCTAssertEqual(r, .init())
  }
}
