import XCTest
@testable import EruriCore

/// 채팅 메일 정리(스펙 §7·§9, 0.14.0): 서버 응답 해석·조건 줄·건수·문구·시간 창·상태 다시 읽기 판단
final class MailCleanupTests: XCTestCase {
  let previewJSON = #"""
  {"token":"11111111-1111-4111-8111-111111111111","action":"trash",
   "conditions":{"action":"trash","sender":"합성상점","subject_words":[],"received_from":"2026-09-01","received_to":"2026-09-30","promotions":true,"unread_only":false},
   "count":1000,"exact":false,"total_estimate":1234,"starred_estimate":3,"has_more":true,
   "sample":[{"from":"합성상점","subject":"합성 광고 1","date":"2026-09-30T15:30:00.000Z"}]}
  """#
  let t0 = Date(timeIntervalSince1970: 1_790_000_000)     // 2026-09 (서울 기준 올해 = 2026)
  func p(_ s: String) -> MailCleanup.Preview { MailCleanup.preview(Data(s.utf8))! }
  func st(_ status: String, total: Int = 3, done: Int = 0, failed: Int = 0, undone: Int = 0, undoFailed: Int = 0, code: String? = nil) -> MailCleanup.Status {
    MailCleanup.Status(id: "x", status: status, total: total, done: done, failed: failed, undone: undone, undo_failed: undoFailed, code: code, method: nil)
  }
  func cond(from: String?, to: String?) -> MailCleanup.Conditions {
    MailCleanup.Conditions(action: "trash", sender: nil, subject_words: [], received_from: from, received_to: to, promotions: false, unread_only: false)
  }

  func testDecodesPreviewStatusAndErrorCode() {
    let v = p(previewJSON)
    XCTAssertEqual([v.token, v.action], ["11111111-1111-4111-8111-111111111111", "trash"])
    XCTAssertEqual([v.count, v.total_estimate, v.starred_estimate], [1000, 1234, 3])
    let empty = p(#"{"token":null,"action":"read","conditions":{"action":"read","sender":null,"subject_words":[],"received_from":null,"received_to":null,"promotions":false,"unread_only":true},"count":0,"exact":true,"total_estimate":0,"starred_estimate":0,"has_more":false,"sample":[]}"#)
    XCTAssertNil(empty.token)
    let s = MailCleanup.status(Data(#"{"id":"x","status":"partial","total":3,"done":2,"failed":1,"undone":0,"undo_failed":0,"code":null,"method":"single"}"#.utf8))!
    XCTAssertEqual([s.status, s.method], ["partial", "single"])
    XCTAssertTrue(s.finished); XCTAssertFalse(s.undoPhase)
    XCTAssertTrue(st("undo_pending").undoPhase); XCTAssertFalse(st("running").finished); XCTAssertFalse(st("previewed").finished)
    let busy = MailCleanup.status(Data(#"{"error":"busy","id":"x","status":"running","total":3,"done":1,"failed":0,"undone":0,"undo_failed":0,"code":null,"method":"batch"}"#.utf8))
    XCTAssertEqual(busy?.status, "running")                                      // 409 busy 본문의 counts 도 읽힌다(M9b 가 폴링을 잇는다)
    XCTAssertEqual(MailCleanup.errorCode(Data(#"{"error":"bad_condition","fields":["received_from"]}"#.utf8)), "bad_condition")
    XCTAssertNil(MailCleanup.errorCode(Data("x".utf8)))
  }

  func testConditionLineUsesServerConfirmedFields() {
    XCTAssertEqual(MailCleanup.conditionLine(p(previewJSON).conditions, now: t0), "발신자 '합성상점' · 광고 · 9/1–9/30 · 별표 제외")
    let c = MailCleanup.Conditions(action: "read", sender: nil, subject_words: ["ERURI", "테스트"], received_from: nil, received_to: "2026-10-04", promotions: false, unread_only: true)
    XCTAssertEqual(MailCleanup.conditionLine(c, now: t0), "제목 'ERURI' '테스트' · 10/4까지 · 안 읽은 메일 · 별표 제외")
    XCTAssertEqual(MailCleanup.conditionLine(cond(from: "2026-09-01", to: "2026-09-01"), now: t0), "9/1 · 별표 제외")
    XCTAssertEqual(MailCleanup.conditionLine(cond(from: "2026-09-01", to: nil), now: t0), "9/1부터 · 별표 제외")
  }

  func testOtherYearDatesShowTheYear() {
    // 모델이 다른 해를 채워도 카드에서 가려낼 수 있게(N-H3): 서울 기준 올해가 아닌 날짜만 연도를 붙인다
    XCTAssertEqual(MailCleanup.conditionLine(cond(from: "2025-09-01", to: "2025-09-30"), now: t0), "2025/9/1–9/30 · 별표 제외")
    XCTAssertEqual(MailCleanup.conditionLine(cond(from: "2025-12-01", to: "2026-01-05"), now: t0), "2025/12/1–1/5 · 별표 제외")
    XCTAssertEqual(MailCleanup.conditionLine(cond(from: "2024-12-01", to: "2025-01-05"), now: t0), "2024/12/1–2025/1/5 · 별표 제외")
    XCTAssertEqual(MailCleanup.conditionLine(cond(from: nil, to: "2025-10-04"), now: t0), "2025/10/4까지 · 별표 제외")
    XCTAssertEqual(MailCleanup.sampleLine(MailCleanup.Sample(from: "합성상점", subject: "합성", date: "2025-09-03T01:00:00Z"), now: t0), "합성상점 · 합성 · 2025/9/3")
    // 서울 1월 1일 00:30 = UTC 전날 15:30 — 연도도 서울 기준
    XCTAssertEqual(MailCleanup.sampleLine(MailCleanup.Sample(from: "a", subject: "b", date: "2025-12-31T15:30:00Z"), now: t0), "a · b · 1/1")
  }

  func testCountLineExactAndEstimated() {
    XCTAssertEqual(MailCleanup.countLine(p(previewJSON)), "총 약 1,234건 중 1,000건 · 별표 약 3건 제외")
    let exact = p(previewJSON.replacingOccurrences(of: #""count":1000,"exact":false,"total_estimate":1234,"starred_estimate":3"#,
                                                   with: #""count":3,"exact":true,"total_estimate":3,"starred_estimate":0"#))
    XCTAssertEqual(MailCleanup.countLine(exact), "3건")
    let exactStar = p(previewJSON.replacingOccurrences(of: #""count":1000,"exact":false,"total_estimate":1234,"starred_estimate":3"#,
                                                       with: #""count":3,"exact":true,"total_estimate":3,"starred_estimate":2"#))
    XCTAssertEqual(MailCleanup.countLine(exactStar), "3건 · 별표 약 2건 제외")
  }

  func testSampleAndMoreLinesUseSeoulDates() {
    let v = p(previewJSON)
    XCTAssertEqual(MailCleanup.sampleLine(v.sample[0], now: t0), "합성상점 · 합성 광고 1 · 10/1")            // 15:30Z = 서울 다음 날 00:30
    XCTAssertEqual(MailCleanup.sampleLine(MailCleanup.Sample(from: "", subject: "", date: "2026-10-05T01:00:00Z"), now: t0), "(보낸 사람 없음) · (제목 없음) · 10/5")
    XCTAssertEqual(MailCleanup.moreLine(v), "외 999건")
  }

  func testGrouped() {
    XCTAssertEqual([0, 999, 1000, 1_234_567].map(MailCleanup.grouped), ["0", "999", "1,000", "1,234,567"])
  }

  func testErrorNotes() {
    XCTAssertEqual(MailCleanup.previewError(status: 403, code: "scope_missing"), MailCleanup.Note(MailCleanupText.scopeMissing, settings: true))
    XCTAssertEqual(MailCleanup.previewError(status: 404, code: "no_connection").text, MailCleanupText.noConnection)
    XCTAssertEqual(MailCleanup.previewError(status: 400, code: "needs_target").text, MailCleanupText.needsTarget)
    XCTAssertEqual(MailCleanup.previewError(status: 400, code: "bad_condition").text, MailCleanupText.badCondition)
    XCTAssertEqual(MailCleanup.previewError(status: 409, code: "reauth_required"), MailCleanup.Note(MailCleanupText.reauth, settings: true))
    XCTAssertEqual(MailCleanup.previewError(status: 429, code: "gmail_rate_limited").text, MailCleanupText.busy)
    XCTAssertEqual(MailCleanup.previewError(status: 503, code: "disabled").text, MailCleanupText.disabled)
    XCTAssertEqual(MailCleanup.previewError(status: 502, code: "gmail_upstream").text, MailCleanupText.failed)
    XCTAssertEqual(MailCleanup.previewError(status: 401, code: nil).text, MailCleanupText.failed)
    XCTAssertEqual(MailCleanup.previewError(status: -1, code: nil).text, MailCleanupText.failed)
    // 실행: 확정 코드만 문구로(행이 바뀌지 않았다), 나머지는 앱이 상태를 먼저 읽는다(D22)
    XCTAssertEqual(MailCleanup.executeError(status: 410, code: "token_expired"), MailCleanup.Note(MailCleanupText.expired, repreview: true))
    XCTAssertEqual(MailCleanup.executeError(status: 404, code: "not_found"), MailCleanup.Note(MailCleanupText.expired, repreview: true))
    XCTAssertEqual(MailCleanup.executeError(status: 400, code: "bad_token"), MailCleanup.Note(MailCleanupText.expired, repreview: true))
    XCTAssertEqual(MailCleanup.executeError(status: 404, code: "no_connection").text, MailCleanupText.noConnection)
    XCTAssertEqual(MailCleanup.executeError(status: 409, code: "reauth_required"), MailCleanup.Note(MailCleanupText.reauth, settings: true))
    XCTAssertEqual(MailCleanup.executeError(status: 403, code: "scope_missing"), MailCleanup.Note(MailCleanupText.scopeMissing, settings: true))
    XCTAssertEqual([400, 403, 404, 409, 410].map { MailCleanup.executeIsDefinite(status: $0, code: "x") }, Array(repeating: true, count: 5))
    XCTAssertEqual([nil, -1, 401, 500, 502, 504].map { MailCleanup.executeIsDefinite(status: $0, code: nil) }, Array(repeating: false, count: 6))
    XCTAssertEqual(MailCleanup.executeError(status: 503, code: "disabled"), MailCleanup.Note(MailCleanupText.disabled))
    // 되돌리기
    XCTAssertEqual(MailCleanup.undoError(status: 410, code: "undo_expired", action: "trash").text, "되돌리기 기간(7일)이 지났어요 — Gmail 휴지통에서 직접 복원할 수 있어요")
    XCTAssertEqual(MailCleanup.undoError(status: 410, code: "undo_expired", action: "read").text, "되돌리기 기간(7일)이 지났어요 — Gmail에서 직접 안 읽음으로 바꿀 수 있어요")
    XCTAssertEqual(MailCleanup.undoError(status: 409, code: "nothing_to_undo", action: "trash").text, MailCleanupText.nothingToUndo)
    XCTAssertEqual(MailCleanup.undoError(status: 409, code: "reauth_required", action: "trash"), MailCleanup.Note(MailCleanupText.undoReconnect, settings: true))
    XCTAssertEqual(MailCleanup.undoError(status: 404, code: "no_connection", action: "trash").text, MailCleanupText.noConnection)
    XCTAssertEqual(MailCleanup.undoError(status: 502, code: "gmail_upstream", action: "trash").text, MailCleanupText.failed)
  }

  func testProgressAndResultTexts() {
    XCTAssertEqual(MailCleanup.progress(st("running", total: 1000, done: 400, failed: 2), action: "trash"), "휴지통으로 옮기는 중 402/1,000")
    XCTAssertEqual(MailCleanup.progress(st("pending"), action: "read"), "읽음으로 바꾸는 중 0/3")
    XCTAssertEqual(MailCleanup.progress(st("undoing", done: 3, undone: 1), action: "trash"), "되돌리는 중 1/3")
    XCTAssertEqual(MailCleanup.result(st("done", done: 3), action: "trash"), MailCleanup.Note("휴지통으로 3건 옮겼어요"))
    XCTAssertEqual(MailCleanup.result(st("partial", done: 2, failed: 1), action: "read").text, "2건을 읽음으로 바꿨어요 · 1건 실패")
    XCTAssertEqual(MailCleanup.result(st("failed", failed: 3, code: "job_dead"), action: "trash"),
                   MailCleanup.Note("휴지통으로 옮기지 못했어요 (3건 실패)\n일부는 이미 바뀌었을 수 있어요 — Gmail 휴지통에서 직접 복원할 수 있어요"))
    XCTAssertEqual(MailCleanup.result(st("partial", done: 1, failed: 2, code: "job_lost"), action: "read").text,
                   "1건을 읽음으로 바꿨어요 · 2건 실패\n일부는 이미 바뀌었을 수 있어요 — Gmail에서 직접 안 읽음으로 바꿀 수 있어요")
    XCTAssertEqual(MailCleanup.result(st("partial", done: 1, failed: 2, code: "scope_missing"), action: "trash"),
                   MailCleanup.Note("휴지통으로 1건 옮겼어요 · 2건 실패\nGmail 권한(연결)이 바뀌어 2건을 처리하지 못했어요", settings: true))
    XCTAssertEqual(MailCleanup.result(st("failed", failed: 3, code: "no_connection"), action: "read").text,
                   "읽음으로 바꾸지 못했어요 (3건 실패)\nGmail 권한(연결)이 바뀌어 3건을 처리하지 못했어요")
    // 연결 끊김으로 되돌리기가 시작되지 않음(SQL 이 실행 종료 상태로 되돌림, D11) — [되돌리기]는 남는다
    XCTAssertEqual(MailCleanup.result(st("done", done: 3, code: "undo_reauth_required"), action: "trash"),
                   MailCleanup.Note("휴지통으로 3건 옮겼어요\n" + MailCleanupText.undoReconnect, settings: true))
    XCTAssertTrue(MailCleanup.canUndo(st("done", done: 3, code: "undo_reauth_required"), previewAt: t0, now: t0))
    XCTAssertEqual(MailCleanup.result(st("undone", done: 3, undone: 3), action: "trash").text, "되돌렸어요")
    XCTAssertEqual(MailCleanup.result(st("undo_partial", done: 3, undone: 2, undoFailed: 1), action: "trash").text, "2건 되돌렸어요 · 1건 실패 — Gmail 휴지통에서 직접 복원할 수 있어요")
    XCTAssertEqual(MailCleanup.result(st("undo_failed", done: 3, undoFailed: 3), action: "read").text, "되돌리지 못했어요 — Gmail에서 직접 안 읽음으로 바꿀 수 있어요")
  }

  func testUndoAndTokenWindows() {
    XCTAssertTrue(MailCleanup.canUndo(st("done", done: 3), previewAt: t0, now: t0.addingTimeInterval(7 * 86_400 - 1)))
    XCTAssertFalse(MailCleanup.canUndo(st("done", done: 3), previewAt: t0, now: t0.addingTimeInterval(7 * 86_400)))
    XCTAssertTrue(MailCleanup.canUndo(st("partial", done: 1, failed: 2), previewAt: t0, now: t0))
    XCTAssertFalse(MailCleanup.canUndo(st("failed", failed: 3), previewAt: t0, now: t0))
    XCTAssertFalse(MailCleanup.canUndo(st("undone", done: 3), previewAt: t0, now: t0))
    XCTAssertFalse(MailCleanup.isTokenExpired(previewAt: t0, now: t0.addingTimeInterval(599)))
    XCTAssertTrue(MailCleanup.isTokenExpired(previewAt: t0, now: t0.addingTimeInterval(600)))
  }

  func testShowNextOnlyAfterAFinishedExecutionWithSuccessAndMore() {
    let v = p(previewJSON)
    XCTAssertTrue(MailCleanup.showNext(v, st("done", done: 3)))
    XCTAssertFalse(MailCleanup.showNext(v, st("running")))
    XCTAssertFalse(MailCleanup.showNext(v, st("undone", done: 3)))
    XCTAssertFalse(MailCleanup.showNext(v, st("failed", failed: 3)))                 // 성공 0 이면 다음 1,000건을 권하지 않는다
    XCTAssertFalse(MailCleanup.showNext(v, nil))
  }

  func testConditionsJSONSendsNullsAndJSONValueFoundation() throws {
    let j = p(previewJSON).conditions.json
    XCTAssertTrue(JSONSerialization.isValidJSONObject(j))
    XCTAssertEqual(j["action"] as? String, "trash")
    let back = try JSONDecoder().decode(MailCleanup.Conditions.self, from: try JSONSerialization.data(withJSONObject: j))
    XCTAssertEqual(back, p(previewJSON).conditions)
    let v = try JSONDecoder().decode(JSONValue.self, from: Data(#"{"action":"trash","sender":null,"subject_words":["a"],"promotions":true}"#.utf8))
    let f = v.foundation
    XCTAssertTrue(JSONSerialization.isValidJSONObject(f))
    XCTAssertTrue((f as? [String: Any])?["sender"] is NSNull)
  }

  func testMailTurnApplyAndCopy() {
    var m = MailTurn()
    XCTAssertEqual(m.phase, .finding)
    m.apply(MailCleanup.Note(MailCleanupText.reauth, settings: true))
    XCTAssertEqual([m.note, m.settings ? "s" : "-"], [MailCleanupText.reauth, "s"])
    XCTAssertEqual(MailCleanupText.header("read"), "읽음으로 바꿀 메일")
    XCTAssertEqual(MailCleanupText.button("trash", 1000), "휴지통으로 이동 (1,000건)")
    XCTAssertEqual(MailCleanupText.upgradeResult(status: 200, body: ["upgraded": true]), MailCleanupText.upgradeDone)
    XCTAssertEqual(MailCleanupText.upgradeResult(status: 200, body: ["upgraded": false, "refresh_token_stored": false]), MailCleanupText.upgradeLater)
    XCTAssertEqual(MailCleanupText.upgradeResult(status: 409, body: [:]), MailCleanupText.upgradeMismatch)
    XCTAssertEqual(MailCleanupText.upgradeResult(status: 502, body: [:]), MailCleanupText.upgradeFailed)
    XCTAssertTrue(MailCleanup.isMailAction("mail_action")); XCTAssertFalse(MailCleanup.isMailAction(nil))
  }

  // ── 상태 다시 읽기 계약(D22 — Codex C3·C4, Fable N-H2·N-M15) ──
  func testNeedsStatusRead() {
    XCTAssertTrue(MailTurn(phase: .running, status: st("done", done: 3)).needsStatusRead)        // 되돌리기 요청 직후 닫힘: 저장된 상태는 옛 실행 결과
    XCTAssertTrue(MailTurn(phase: .running).needsStatusRead)                                     // 실행 응답 전에 닫힘(토큰으로 묻는다)
    XCTAssertTrue(MailTurn(phase: .ended, status: st("running")).needsStatusRead)                // 20분 상한·옛 기록 — 끝나지 않은 상태
    XCTAssertFalse(MailTurn(phase: .ended, status: st("done", done: 3)).needsStatusRead)
    XCTAssertFalse(MailTurn(phase: .preview).needsStatusRead)
    XCTAssertFalse(MailTurn(phase: .ended, note: MailCleanupText.cancelled).needsStatusRead)
  }

  func testExecute503IsDefiniteOnlyWhenDisabled() {
    // 함수의 503 은 disabled 뿐 — 게이트웨이 503(코드 없음·다른 코드)은 확정이 아니라 토큰 상태를 먼저 읽는다(0.14.0 최종 리뷰 Minor 1)
    XCTAssertTrue(MailCleanup.executeIsDefinite(status: 503, code: "disabled"))
    XCTAssertFalse(MailCleanup.executeIsDefinite(status: 503, code: nil))
    XCTAssertFalse(MailCleanup.executeIsDefinite(status: 503, code: "BOOT_ERROR"))
  }

  func testUndoResultWithPermissionCodeAddsTheExplanationLine() {
    // M8 리뷰 Minor 3: 되돌리기 중 권한·연결이 끊김 → 실행 결과와 같은 설명 줄(K = 되돌리기 실패 수) + [설정 열기]
    XCTAssertEqual(MailCleanup.result(st("undo_partial", done: 3, undone: 1, undoFailed: 2, code: "reauth_required"), action: "trash"),
                   MailCleanup.Note("1건 되돌렸어요 · 2건 실패 — Gmail 휴지통에서 직접 복원할 수 있어요\nGmail 권한(연결)이 바뀌어 2건을 처리하지 못했어요", settings: true))
    XCTAssertEqual(MailCleanup.result(st("undo_failed", done: 3, undoFailed: 3, code: "scope_missing"), action: "read"),
                   MailCleanup.Note("되돌리지 못했어요 — Gmail에서 직접 안 읽음으로 바꿀 수 있어요\nGmail 권한(연결)이 바뀌어 3건을 처리하지 못했어요", settings: true))
    XCTAssertEqual(MailCleanup.result(st("undo_partial", done: 3, undone: 2, undoFailed: 1, code: "job_dead"), action: "trash"),
                   MailCleanup.Note("2건 되돌렸어요 · 1건 실패 — Gmail 휴지통에서 직접 복원할 수 있어요"))
  }

  func testUndoBouncedBackWithoutCodeLeavesTheRetryNote() {
    // 되돌리기 단계였는데 실행 종료 상태로 돌아옴(잡이 진행 0 으로 dead, 코드 없음 — 스펙 §7·§9): "되돌리기를 마치지 못했어요" + [되돌리기] 남음
    var a = MailTurn(phase: .running, previewAt: t0, status: st("undoing", done: 3))
    a.afterStatusRead(st("done", done: 3))
    XCTAssertEqual([a.phase == .ended, a.note == MailCleanupText.undoIncomplete], [true, true])
    XCTAssertEqual(MailCleanupText.undoIncomplete, "되돌리기를 마치지 못했어요 — 다시 눌러 주세요")
    XCTAssertTrue(MailCleanup.canUndo(a.status!, previewAt: t0, now: t0))
    // [되돌리기]를 누른 뒤 응답 전에 닫힘(저장 상태 = 실행 결과 partial) → 다시 열어 읽어도 partial: 같은 안내(되돌리기 요청 표시는 기록에 남는다)
    var b0 = MailTurn(phase: .ended, previewAt: t0, status: st("partial", done: 2, failed: 1))
    b0.beginUndo()
    XCTAssertEqual([b0.phase == .running, b0.undoRequested == true, b0.needsStatusRead], [true, true, true])
    var b = try! JSONDecoder().decode(MailTurn.self, from: try! JSONEncoder().encode(b0))
    b.afterStatusRead(st("partial", done: 2, failed: 1))
    XCTAssertEqual([b.phase == .ended, b.note == MailCleanupText.undoIncomplete, b.undoRequested == nil], [true, true, true])
    XCTAssertTrue(MailCleanup.canUndo(b.status!, previewAt: t0, now: t0))
    // 연결 반송(undo_ 코드)은 result 가 연결 문구를 낸다 — 덧붙이지 않는다
    var c = MailTurn(phase: .running, status: st("undo_pending", done: 3))
    c.afterStatusRead(st("done", done: 3, code: "undo_reauth_required"))
    XCTAssertNil(c.note)
    // 실행 진행 → 실행 결과는 반송이 아니다
    var d = MailTurn(phase: .running, status: st("running", done: 1))
    d.afterStatusRead(st("done", done: 3))
    XCTAssertNil(d.note)
    // 되돌리기 진행 → 되돌리기 결과도 반송이 아니다
    var e = MailTurn(phase: .running, status: st("undoing", done: 3))
    e.afterStatusRead(st("undone", done: 3, undone: 3))
    XCTAssertNil(e.note)
  }

  func testExecuteFinishedAndResumeDoNotSayUndoIncomplete() {
    // 실행 200·202 가 끝난 결과(G7c — 이미 실행된 토큰)로 오면 executeMail 은 phase .running 인 채 status 만 두고 한 번 읽는다 — [되돌리기]를 누른 적이 없다
    for r in [st("done", done: 3), st("partial", done: 2, failed: 1)] {
      var a = MailTurn(phase: .running, previewAt: t0, status: r)
      a.afterStatusRead(r)
      XCTAssertEqual([a.phase == .ended, a.note == nil], [true, true], r.status)
      XCTAssertTrue(MailCleanup.canUndo(a.status!, previewAt: t0, now: t0))
    }
    // 그 직후 닫혔다 다시 엶(재개 → pollMail): 저장 기록 그대로 읽어도 안내 없음
    let saved = try! JSONEncoder().encode(MailTurn(phase: .running, previewAt: t0, status: st("done", done: 3)))
    var b = try! JSONDecoder().decode(MailTurn.self, from: saved)
    XCTAssertTrue(b.needsStatusRead)
    b.afterStatusRead(st("done", done: 3))
    XCTAssertNil(b.note)
    // 옛 기록(되돌리기 요청 키 없음) = 요청 아님 — 실행 진행 중 닫힌 기록이 끝난 결과를 읽어도 안내 없음
    var c = try! JSONDecoder().decode(MailTurn.self, from: Data(#"{"phase":"running","settings":false,"repreview":false,"status":{"id":"x","status":"done","total":3,"done":3,"failed":0,"undone":0,"undo_failed":0}}"#.utf8))
    XCTAssertNil(c.undoRequested)
    c.afterStatusRead(st("done", done: 3))
    XCTAssertEqual([c.phase == .ended, c.note == nil], [true, true])
    // 되돌리기가 끝나면 요청 표시는 내린다 — 다음 [되돌리기]·읽기는 새로 판단
    var d = MailTurn(phase: .ended, status: st("done", done: 3)); d.beginUndo()
    d.afterStatusRead(st("undoing", done: 3, undone: 1))
    XCTAssertEqual(d.undoRequested, true)
    d.afterStatusRead(st("undone", done: 3, undone: 3))
    XCTAssertEqual([d.undoRequested == nil, d.note == nil], [true, true])
  }

  func testAfterStatusRead() {
    var a = MailTurn(phase: .running, note: MailCleanupText.checking)
    a.afterStatusRead(st("previewed"))                                                          // 실행 요청이 서버에 닿지 않았다 — 버튼으로
    XCTAssertEqual([a.phase == .preview, a.status == nil, a.note == MailCleanupText.failed], [true, true, true])
    var b = MailTurn(phase: .running, status: st("done", done: 3), note: MailCleanupText.stillRunning)
    b.afterStatusRead(st("undoing", done: 3, undone: 1))
    XCTAssertEqual([b.phase == .running, b.status?.status == "undoing", b.note == nil], [true, true, true])
    b.afterStatusRead(st("undone", done: 3, undone: 3))
    XCTAssertEqual([b.phase == .ended, b.needsStatusRead], [true, false])
  }

  func testNeedsUpgrade() {
    let mod = MailCleanup.modifyScope, ro = "https://www.googleapis.com/auth/gmail.readonly"
    XCTAssertTrue(MailCleanup.needsUpgrade(rows: [["status": "active", "scopes": [ro]]]))
    XCTAssertTrue(MailCleanup.needsUpgrade(rows: [["status": "active", "scopes": NSNull()]]))     // 0.14.0 전 연결(null) = readonly
    XCTAssertFalse(MailCleanup.needsUpgrade(rows: [["status": "active", "scopes": [ro, mod]]]))
    XCTAssertFalse(MailCleanup.needsUpgrade(rows: [["status": "reauth_required", "scopes": [ro]]]))
    XCTAssertFalse(MailCleanup.needsUpgrade(rows: []))
  }

  func testMailTurnDecodesWithUnknownKeysAndWithoutOptionalOnes() throws {
    // 기록 파일 호환: 모르는 키는 무시, Optional 필드는 없어도 된다(이후 필드는 Optional 로만 더한다)
    let m = try JSONDecoder().decode(MailTurn.self, from: Data(#"{"phase":"ended","settings":false,"repreview":false,"later_field":1}"#.utf8))
    XCTAssertEqual([m.phase == .ended, m.preview == nil, m.status == nil, m.previewAt == nil, m.note == nil], [true, true, true, true, true])
  }

  func testMailTurnUnknownPhaseIsEnded_UnknownPreviewAndStatusFieldsIgnored() throws {
    // 다음 버전이 Phase 값을 더한 뒤 내려도 그 턴은 끝난 턴으로 읽힌다(리뷰 Minor 5) — 엄격하면 레코드 하나가 기록 전체를 비운다
    let m = try JSONDecoder().decode(MailTurn.self, from: Data(#"{"phase":"verifying","settings":false,"repreview":false}"#.utf8))
    XCTAssertEqual(m.phase, .ended)
    XCTAssertEqual(try JSONDecoder().decode(MailTurn.Phase.self, from: Data(#""running""#.utf8)), .running)
    XCTAssertEqual(String(data: try JSONEncoder().encode(MailTurn.Phase.preview), encoding: .utf8), #""preview""#)
    let pv = try XCTUnwrap(MailCleanup.preview(Data(previewJSON.replacingOccurrences(of: #""has_more":true,"#, with: #""has_more":true,"later":{"x":1},"#).utf8)))
    XCTAssertEqual(pv, p(previewJSON))
    let s = try XCTUnwrap(MailCleanup.status(Data(#"{"id":"x","status":"done","total":3,"done":3,"failed":0,"undone":0,"undo_failed":0,"code":null,"method":"batch","later":[1]}"#.utf8)))
    XCTAssertEqual(s.status, "done")
  }

  func testUnknownStatusShowsProgressAndNoDestructiveButtons() {
    // status 는 서버 check 로 닫힌 집합이지만, 모르는 값이 와도 진행 문구·버튼 없음(리뷰 Minor 6)
    let u = st("verifying", done: 1)
    XCTAssertFalse(u.finished); XCTAssertFalse(u.undoPhase)
    XCTAssertEqual(MailCleanup.result(u, action: "trash"), MailCleanup.Note("휴지통으로 옮기는 중 1/3"))
    XCTAssertFalse(MailCleanup.canUndo(u, previewAt: t0, now: t0))
    XCTAssertFalse(MailCleanup.showNext(p(previewJSON), u))
    XCTAssertTrue(MailTurn(phase: .ended, status: u).needsStatusRead)
  }

  func testUndoNoConnectionBounceKeepsUndo() {
    // D11: 연결이 없어 되돌리기가 시작되지 않음 → 실행 결과 + 다시 연결 줄 + [설정 열기], [되돌리기]는 남는다
    let s = st("partial", done: 2, failed: 1, code: "undo_no_connection")
    XCTAssertEqual(MailCleanup.result(s, action: "trash"),
                   MailCleanup.Note("휴지통으로 2건 옮겼어요 · 1건 실패\n" + MailCleanupText.undoReconnect, settings: true))
    XCTAssertTrue(MailCleanup.canUndo(s, previewAt: t0, now: t0))
  }
}
