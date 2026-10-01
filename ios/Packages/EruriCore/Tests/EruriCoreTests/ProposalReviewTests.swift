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
    XCTAssertEqual(ProposalReview.Link(proposalId: pid, category: "REVIEW", title: "t", start: "2026-10-24", due: nil, version: nil).whenLabel, "2026-10-24")
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
