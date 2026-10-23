import XCTest
@testable import EruriCore

final class MailDigestTests: XCTestCase {
  let now = ISO8601DateFormatter().date(from: "2026-10-23T03:00:00Z")!
  func cand(_ i: Int, from: String = "합성상점", subject: String = "합성 안내", date: String = "2026-10-23T09:00:00+09:00") -> MailSummary.Candidate {
    MailSummary.Candidate(token: "v1.t\(i)", from: from, subject: subject, date: date)
  }
  func search(_ n: Int, next: String? = nil, complete: Bool = true, count: Int? = nil, latest: Bool = false, capped: Bool? = false) -> MailSummary.Search {
    let c = MailSummary.Conditions(sender: "합성상점", subject_words: [], received_from: nil, received_to: nil, latest: latest, translate: false, count: count)
    return try! JSONDecoder().decode(MailSummary.Search.self, from: JSONSerialization.data(withJSONObject: [
      "conditions": try! JSONSerialization.jsonObject(with: JSONEncoder().encode(c)), "candidates": (0..<n).map { ["token": "v1.t\($0)", "from": "합성상점", "subject": "합성 안내", "date": "2026-10-23T09:00:00+09:00"] },
      "complete": complete, "more": next != nil, "next_cursor": next as Any? ?? NSNull(), "count_capped": capped as Any? ?? NSNull()]))
  }

  func testAfterSearchBranches() {
    XCTAssertEqual(MailSummary.afterSearch(search(0)), .none(MailSummaryText.noneFound))
    XCTAssertEqual(MailSummary.afterSearch(search(0, complete: false)), .none(MailSummaryText.notAllChecked))     // 커서 없음(구 계약·목록 끝)
    XCTAssertEqual(MailSummary.afterSearch(search(0, next: "c1.a", complete: false)), .digest)                 // 0통 + next_cursor → 줄 없는 카드(DP29)
    XCTAssertEqual(MailSummary.afterSearch(search(1)), .readFirst)
    XCTAssertEqual(MailSummary.afterSearch(search(3, latest: true)), .readFirst)
    XCTAssertEqual(MailSummary.afterSearch(search(2)), .digest)
    XCTAssertEqual(MailSummary.afterSearch(search(1, complete: false)), .digest)      // D-M3
  }
  func testSearchBodyAddsLimitAndKeepsCount() throws {
    let v = try JSONDecoder().decode(JSONValue.self, from: Data(#"{"sender":null,"count":3,"latest":false,"target_in_message":true}"#.utf8))
    let b = try XCTUnwrap(MailSummary.searchBody(v, limit: MailDigest.firstLimit(count: MailSummary.fields(v)?.count)))
    XCTAssertEqual(b["limit"] as? Int, 3); XCTAssertEqual((b["count"] as? NSNumber)?.intValue, 3)   // JSONValue.number 은 Double — NSNumber 로 본다
    XCTAssertEqual(MailSummary.searchBody(nil, limit: 10)?["limit"] as? Int, 10)
    XCTAssertEqual(MailDigest.firstLimit(count: nil), 10); XCTAssertEqual(MailDigest.firstLimit(count: 30), 10)
  }
  func testNextLimit() {
    XCTAssertEqual(MailDigest.nextLimit(count: nil, rows: 10), 10)
    XCTAssertEqual(MailDigest.nextLimit(count: 12, rows: 10), 2)
    XCTAssertNil(MailDigest.nextLimit(count: 3, rows: 3))
    XCTAssertEqual(MailDigest.nextLimit(count: 30, rows: 20), 10)
  }
  // 회귀 (가): 직전 상세 요약 뒤 "메일 세 통 각각 요약해줘" — target_in_message 참이면 이어서 읽기가 아니라 검색(limit 3)
  func testCountAfterDetailSearchesNotFollowUp() throws {
    var prev = ChatHistory.Record(at: now.addingTimeInterval(-60), kind: .mailSummary, question: "합성은행 메일 요약해줘")
    var t = MailSummaryTurn(phase: .ended); t.read = try JSONDecoder().decode(MailSummary.Read.self, from: Data(#"{"status":"ok","token":"v1.prev","from":"a","subject":"b","date":"","summary":{"lines":["x"],"dates":[],"amounts":[],"todos":[]},"language":"ko","translation":null,"translation_truncated":false,"body_truncated":false,"attachments":0,"ask":null}"#.utf8)); t.readAt = now.addingTimeInterval(-60)
    prev.mailRead = t
    let cur = ChatHistory.Record(at: now, kind: .question, question: "메일 세 통 각각 요약해줘")
    let v = try JSONDecoder().decode(JSONValue.self, from: Data(#"{"sender":null,"subject_words":[],"received_from":null,"received_to":null,"latest":false,"translate":false,"count":3,"target_in_message":true}"#.utf8))
    let f = try XCTUnwrap(MailSummary.fields(v))
    XCTAssertEqual(MailSummary.followUp([prev, cur], current: cur.id, now: now, targetInMessage: f.targetInMessage), .none)
    XCTAssertEqual(MailSummary.searchBody(v, limit: MailDigest.firstLimit(count: f.count))?["limit"] as? Int, 3)
  }
  // 회귀 (나): 가드가 대상 칸·count 를 모두 비운 출력 → 빈 칸 검색(limit 10) → 서버 needs_target → 되묻기 문구(최근 3통 검색 아님)
  func testGuardEmptiedFieldsAskForTarget() throws {
    let v = try JSONDecoder().decode(JSONValue.self, from: Data(#"{"sender":null,"subject_words":[],"received_from":null,"received_to":null,"latest":false,"translate":false,"count":null,"target_in_message":true}"#.utf8))
    let b = try XCTUnwrap(MailSummary.searchBody(v, limit: MailDigest.firstLimit(count: MailSummary.fields(v)?.count)))
    XCTAssertTrue(b["count"] is NSNull); XCTAssertEqual(b["limit"] as? Int, 10); XCTAssertTrue(b["sender"] is NSNull)
    XCTAssertEqual(MailSummary.searchError(status: 400, code: "needs_target").text, MailSummaryText.needsTarget)
  }
  func testHeaderOrder() {
    let c = { (s: String?, w: [String], f: String?, t: String?) in MailSummary.Conditions(sender: s, subject_words: w, received_from: f, received_to: t, latest: false, translate: false) }
    XCTAssertEqual(MailDigest.header(c("김OO", ["안내"], "2026-10-23", "2026-10-23"), rows: 4, now: now), "김OO 메일 4통")
    XCTAssertEqual(MailDigest.header(c(nil, ["안내", "공지"], nil, nil), rows: 2, now: now), "'안내' '공지' 메일 2통")
    XCTAssertEqual(MailDigest.header(c(nil, [], "2026-10-23", "2026-10-23"), rows: 3, now: now), "10/23 메일 3통")
    XCTAssertEqual(MailDigest.header(c(nil, [], "2026-10-20", "2026-10-23"), rows: 3, now: now), "10/20–10/23 메일 3통")
    XCTAssertEqual(MailDigest.header(c(nil, [], nil, nil), rows: 10, now: now), "최근 메일 10통")
    XCTAssertEqual(MailDigest.header(c("김OO", [], nil, nil), rows: 0, now: now), "김OO 메일")          // 줄 없는 카드(DP29) — 통수 없음
    XCTAssertEqual(MailDigest.header(c(nil, [], nil, nil), rows: 0, now: now), "최근 메일")
  }
  func testHeaderEndOnlyPeriod() {   // Review Focus 4
    let c = MailSummary.Conditions(sender: nil, subject_words: [], received_from: nil, received_to: "2026-10-23", latest: false, translate: false)
    XCTAssertEqual(MailDigest.header(c, rows: 5, now: now), "10/23까지 메일 5통")
    let s = MailSummary.Conditions(sender: nil, subject_words: [], received_from: "2025-12-30", received_to: nil, latest: false, translate: false)
    XCTAssertEqual(MailDigest.header(s, rows: 2, now: now), "2025/12/30부터 메일 2통")
  }
  func testRowHeadYearAndEmptyFields() {   // Review Focus 4
    XCTAssertEqual(MailDigest.rowHead(cand(0), now: now), "합성상점 · 10/23")
    XCTAssertEqual(MailDigest.rowHead(cand(1, from: "", date: "2025-12-30T23:00:00+09:00"), now: now), "(보낸 사람 없음) · 2025/12/30")
    XCTAssertEqual(MailDigest.rowTitle(cand(2, subject: "")), "(제목 없음)")
    XCTAssertEqual(MailDigest.rowHead(cand(3, date: "2026-10-22T15:30:00.000Z"), now: now), "합성상점 · 10/23")   // 서버 UTC 소수초 → 서울 날짜(A1 리뷰 M3)
  }
  func testResultsDecodeLengthMustMatch() {
    let d = Data(#"{"results":[{"status":"ok","token":"v1.a","lines":["x"],"note":null,"code":null},{"status":"weird","token":null,"lines":[],"note":null,"code":null}]}"#.utf8)
    let r = MailDigest.results(d, expected: 2)
    XCTAssertEqual(r?.map(\.status), ["ok", "weird"])
    XCTAssertNil(MailDigest.results(d, expected: 3))
  }
  func testTurnFlow_count12_tenThenNextTwo() {
    var t = MailDigestTurn(question: "메일 12통 요약해줘")
    t.applySearch(search(10, next: "c1.n", count: 12), append: false)
    XCTAssertEqual(t.rows.count, 10); XCTAssertEqual(t.rows.map(\.state), Array(repeating: .pending, count: 10))
    XCTAssertEqual(t.tail, .more(2)); XCTAssertEqual(MailDigestText.moreButton(2), "다음 2통")
    t.applyDigest((0..<10).map { MailDigest.Result(status: "ok", token: "v1.n\($0)", lines: ["줄"], note: nil, code: nil) }, rows: Array(0..<10))
    t.applySearch(search(2, next: "c1.m", count: 12), append: true)
    XCTAssertEqual(t.rows.count, 12); XCTAssertEqual(t.tail, .none)                 // count 채움 — next_cursor 가 있어도 꼬리 없음
    XCTAssertEqual(t.rows[0].candidate.token, "v1.n0")                              // 새 토큰으로 바뀜(줄 탭·[다시]가 만료되지 않게)
  }
  func testTurnTailRules() {
    var t = MailDigestTurn(question: "q")
    t.applySearch(search(3, next: nil, count: 3), append: false); XCTAssertEqual(t.tail, .none)
    var u = MailDigestTurn(question: "q")
    u.applySearch(search(10, next: "c1.a"), append: false); XCTAssertEqual(u.tail, .more(10))
    u.applySearch(search(0, next: "c1.b"), append: true); XCTAssertEqual(u.tail, .more(10))     // 0통 + next_cursor → 꼬리 유지
    u.applySearch(search(0, next: nil), append: true); XCTAssertEqual(u.tail, .none)
    var e = MailDigestTurn(question: "q")
    e.applySearch(search(2), append: false)
    e.applyDigest([MailDigest.Result(status: "expired", token: nil, lines: [], note: nil, code: nil), MailDigest.Result(status: "ok", token: "v1.z", lines: ["a"], note: nil, code: nil)], rows: [0, 1])
    XCTAssertEqual(e.tail, .expired)
  }
  func testCappedNotice() {
    var t = MailDigestTurn(question: "q")
    t.applySearch(search(10, next: "c1.a", count: 30, capped: true), append: false)
    XCTAssertTrue(t.countCapped); XCTAssertEqual(MailDigestText.capped, "한 번에 최대 30통까지 요약해요")
  }
  func testRowTextsAndRetry() {
    var t = MailDigestTurn(question: "q")
    t.applySearch(search(5), append: false)
    t.applyDigest([.init(status: "ok", token: "v1.a", lines: [], note: "otp", code: nil), .init(status: "ok", token: "v1.b", lines: [], note: "no_body", code: nil),
                   .init(status: "failed", token: "v1.c", lines: [], note: nil, code: "mail_gone"), .init(status: "failed", token: "v1.d", lines: [], note: nil, code: "summary_failed"),
                   .init(status: "rejected", token: nil, lines: [], note: nil, code: nil)], rows: Array(0..<5))
    XCTAssertEqual(t.rows.map { MailDigest.rowBody($0) }, [MailDigestText.otp, MailDigestText.noBody, MailDigestText.gone, MailDigestText.failed, MailDigestText.rejected])
    XCTAssertEqual(t.rows.map { t.canRetry($0) }, [false, false, false, true, false])     // mail_gone·rejected 는 [다시] 없음(D-M15)
  }
  // Codex 계획 리뷰 #5 — 첫 검색이 0통 + next_cursor: 진행 가능한 카드(줄 없음·미완결 안내·꼬리 [다음]), digest 없음
  func testEmptyFirstPageWithCursorIsAProgressableCard() {
    var t = MailDigestTurn(question: "q")
    XCTAssertEqual(t.applyFirst(search(0, next: "c1.a", complete: false)), [])
    XCTAssertEqual(t.rows.count, 0); XCTAssertEqual(t.phase, .idle); XCTAssertFalse(t.complete)
    XCTAssertEqual(t.tail, .more(10)); XCTAssertTrue(t.canAct)
    XCTAssertEqual(MailDigest.header(t.conditions!, rows: 0, now: now), "합성상점 메일")
    var u = MailDigestTurn(question: "q")
    XCTAssertEqual(u.applyFirst(search(3, next: "c1.b")), [0, 1, 2]); XCTAssertEqual(u.phase, .loading)
  }
  // [다시 찾기]도 같은 규칙: 0통 + 커서 → 꼬리 유지, 0통·커서 없음 → afterSearch 문구로 끝
  func testResearchEmptyWithCursorKeepsTailAndEmptyWithoutCursorEnds() {
    var t = MailDigestTurn(question: "q"); _ = t.applyFirst(search(2, next: "c1.a")); t.phase = .idle; t.markExpired()
    XCTAssertEqual(t.tail, .expired)
    let g = try! XCTUnwrap(t.beginRequest())
    XCTAssertTrue(t.isCurrent(g))
    XCTAssertEqual(t.applyFirst(search(0, next: "c1.b", complete: false)), [])
    XCTAssertEqual(t.rows.count, 0); XCTAssertEqual(t.tail, .more(10)); XCTAssertEqual(t.phase, .idle)
    _ = try! XCTUnwrap(t.beginRequest())
    XCTAssertEqual(t.applyFirst(search(0)), [])
    XCTAssertEqual(t.phase, .ended); XCTAssertEqual(t.note, MailSummaryText.noneFound); XCTAssertEqual(t.tail, .none)
  }
  // Codex 계획 리뷰 #6 — [다시 찾기]·[다음]·[다시]는 첫 네트워크 호출 전에 잠그고, 오류면 풀고, 늦게 온 이전 응답은 버린다(DP30)
  func testResearchLocksBeforeNetworkAndIgnoresStaleResponses() {
    var t = MailDigestTurn(question: "q"); _ = t.applyFirst(search(2, next: "c1.a")); t.phase = .idle; t.markExpired()
    let g = try! XCTUnwrap(t.beginRequest())
    XCTAssertEqual(t.phase, .loading); XCTAssertFalse(t.canAct)
    XCTAssertNil(t.beginRequest())                                                   // 연타 — 두 번째 검색 없음
    t.failRequest(g, note: MailSummaryText.busy)                                     // 오류 → 문구 + 잠금 풀림
    XCTAssertEqual(t.phase, .idle); XCTAssertEqual(t.note, MailSummaryText.busy)
    let g2 = try! XCTUnwrap(t.beginRequest())
    XCTAssertFalse(t.isCurrent(g)); XCTAssertTrue(t.isCurrent(g2))                   // 늦게 온 첫 응답은 반영하지 않는다
    t.failRequest(g, note: "지난 오류")                                                // 지난 세대의 오류도 무시 — 잠금 유지
    XCTAssertEqual(t.phase, .loading); XCTAssertEqual(t.note, MailSummaryText.busy)
    let back = try! JSONDecoder().decode(MailDigestTurn.self, from: JSONEncoder().encode(t))
    XCTAssertEqual(back.requestGen, g2)
  }
  func testLockWhileLoading() {
    var t = MailDigestTurn(question: "q")
    t.applySearch(search(2, next: "c1.a"), append: false)
    t.phase = .loading
    XCTAssertFalse(t.canAct)
    t.phase = .idle
    XCTAssertTrue(t.canAct)
  }
  func testCardBusyRetriesOnceThenRowsFailWithRetry() {   // Review Focus 2
    XCTAssertEqual(MailDigest.retryDelay(status: 503, code: "llm_busy", attempt: 0), 5)
    XCTAssertNil(MailDigest.retryDelay(status: 503, code: "llm_busy", attempt: 1))
    var t = MailDigestTurn(question: "q")
    t.applySearch(search(3), append: false)
    t.applyCardError(status: 503, code: "llm_busy", rows: [0, 1, 2])
    XCTAssertEqual(t.rows.map(\.state), [.failed, .failed, .failed])
    XCTAssertEqual(t.note, MailSummaryText.llmBusy)
    XCTAssertTrue(t.rows.allSatisfy { t.canRetry($0) })
    XCTAssertEqual(t.phase, .idle)
  }
  func testCardErrors() {
    for (status, code, text, retry) in [(503, "llm_unavailable", MailDigestText.unavailable, false), (429, "budget_exhausted", MailSummaryText.budget, true),
                                        (409, "reauth_required", MailSummaryText.reauth, true), (503, "disabled", MailSummaryText.disabled, false),
                                        (502, "gmail_upstream", nil as String?, true), (-1, "network", nil, true)] as [(Int, String, String?, Bool)] {
      var t = MailDigestTurn(question: "q")
      t.applySearch(search(2), append: false)
      t.applyCardError(status: status, code: code, rows: [0, 1])
      XCTAssertEqual(t.note, text, code); XCTAssertEqual(t.canRetry(t.rows[0]), retry, code)
      XCTAssertEqual(t.settings, code == "reauth_required", code)
    }
  }
  func testRowOpensOncePerTap() {   // Review Focus 3
    var t = MailDigestTurn(question: "q")
    t.applySearch(search(2), append: false)
    t.applyDigest([.init(status: "ok", token: "v1.a", lines: ["a"], note: nil, code: nil), .init(status: "ok", token: "v1.b", lines: ["b"], note: nil, code: nil)], rows: [0, 1])
    XCTAssertTrue(t.beginOpen(0)); XCTAssertFalse(t.beginOpen(0))
    t.endOpen(0); XCTAssertTrue(t.beginOpen(0))
  }
  func testExpiredReadMarksTail() {
    var t = MailDigestTurn(question: "q")
    t.applySearch(search(2), append: false)
    t.markExpired()
    XCTAssertEqual(t.tail, .expired); XCTAssertEqual(MailDigestText.expiredTail, "목록이 오래됐어요")
  }
  func testRestoreEndsPendingRows() throws {
    var t = MailDigestTurn(question: "q")
    t.applySearch(search(2), append: false); t.phase = .loading
    var rec = ChatHistory.Record(at: now, kind: .mailDigest, question: "q"); rec.mailDigest = t
    let back = ChatHistory.restored([rec])[0].mailDigest!
    XCTAssertEqual(back.rows.map(\.state), [.failed, .failed]); XCTAssertEqual(back.phase, .idle)
    let blank = ChatHistory.restored([ChatHistory.Record(at: now, kind: .mailDigest, question: "q")])[0].mailDigest
    XCTAssertEqual(blank?.note, MailSummaryText.interrupted)
    // 첫 검색 응답 전(.finding·줄 없음)에 닫힌 턴은 빈 카드가 아니라 끝난 문구로(A1 리뷰 I1, §9 대화 기록)
    var pending = ChatHistory.Record(at: now, kind: .mailDigest, question: "q"); pending.mailDigest = MailDigestTurn(question: "q")
    let ended = ChatHistory.restored([pending])[0].mailDigest!
    XCTAssertEqual(ended.phase, .ended); XCTAssertEqual(ended.note, MailSummaryText.interrupted)
  }
  func testNextKeepsBlocked() {   // A1 리뷰 M1: llm_unavailable·disabled 카드는 [다음] 뒤에도 [다시] 없음
    var t = MailDigestTurn(question: "q")
    t.applySearch(search(2, next: "c1.a", count: 5), append: false)
    t.applyCardError(status: 503, code: "llm_unavailable", rows: [0, 1])
    t.applySearch(search(2), append: true)
    XCTAssertTrue(t.blocked); XCTAssertFalse(t.canRetry(t.rows[0]))
    t.applySearch(search(2), append: false)
    XCTAssertFalse(t.blocked)
  }
  func testDigestTurnRoundTripAndLenientDecode() throws {
    var t = MailDigestTurn(question: "q"); t.applySearch(search(2, next: "c1.a", count: 5), append: false)
    let back = try JSONDecoder().decode(MailDigestTurn.self, from: JSONEncoder().encode(t))
    XCTAssertEqual(back, t)
    let odd = try JSONDecoder().decode(MailDigestTurn.self, from: Data(#"{"phase":"zzz","rows":[{"candidate":{"token":"v1.a","from":"a","subject":"b","date":""},"state":"zzz","lines":[]}]}"#.utf8))
    XCTAssertEqual(odd.phase, .idle); XCTAssertEqual(odd.rows[0].state, .failed)
  }
  func testDigestTurnNotInContext() {
    var rec = ChatHistory.Record(at: now, kind: .mailDigest, question: "오늘 온 메일들 메일별로 요약해줘"); rec.mailDigest = MailDigestTurn(question: rec.question)
    XCTAssertEqual(ChatHistory.context([rec], now: now.addingTimeInterval(10)), [])
  }
  func testUsageKindName() {
    XCTAssertEqual(UsageStatus.budgetKinds.map(\.kind), ["chat", "mail_summary", "mail_digest", "extract", "embed"])
    XCTAssertEqual(UsageStatus.budgetKinds[2].name, "메일 목록 요약")
  }
}
