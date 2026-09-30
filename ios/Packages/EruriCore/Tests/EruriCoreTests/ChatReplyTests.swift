import XCTest
@testable import EruriCore

/// 채팅 응답(M2-⑧b 계약) 해석·제안 카드 조건(Ruling 8)·오류 문구·llm_busy 재시도(M2-⑦)
final class ChatReplyTests: XCTestCase {
  // ⑧b handleChat 응답 모양 그대로(합성 값)
  private let body = #"""
  {"answer_id":"8a1f0c2e-0000-4000-8000-000000000001","answer":"합성 답변입니다.","refused":false,
   "source_item_ids":["11111111-1111-4111-8111-111111111111"],
   "citations":[{"item_id":"11111111-1111-4111-8111-111111111111","source":"GMAIL","app_name":null,"title":"합성 제목","sender":null,
                 "occurred_at":"2026-07-03T15:14:00.123456+00:00","expired":false}],
   "proposals":[{"id":"22222222-2222-4222-8222-222222222222","item_id":"11111111-1111-4111-8111-111111111111","action":"create_event",
                 "status":"proposed","payload":{"title":"합성 회의","start":"2026-10-02T15:30:00+09:00","uncertain":[],"n":1,"ok":true,"x":null}}],
   "hits":["11111111-1111-4111-8111-111111111111"]}
  """#

  func testDecodesContract() throws {
    let a = try XCTUnwrap(ChatReply.decode(Data(body.utf8)))
    XCTAssertEqual(a.answer_id, "8a1f0c2e-0000-4000-8000-000000000001")
    XCTAssertFalse(a.refused)
    XCTAssertEqual(a.citations.map(\.item_id), ["11111111-1111-4111-8111-111111111111"])
    XCTAssertNil(a.citations[0].app_name)
    XCTAssertEqual(a.proposals.first?.payload["title"]?.string, "합성 회의")
    XCTAssertEqual(a.proposals.first?.payload["n"], .number(1))
    XCTAssertEqual(a.proposals.first?.payload["ok"], .bool(true))
    XCTAssertEqual(a.proposals.first?.payload["x"], .null)
  }

  func testRefusalWithEmptyLists() throws {
    let a = try XCTUnwrap(ChatReply.decode(Data(#"{"answer_id":"x","answer":"찾지 못했습니다.","refused":true,"source_item_ids":[],"citations":[],"proposals":[],"hits":[]}"#.utf8)))
    XCTAssertTrue(a.refused)
    XCTAssertTrue(a.citations.isEmpty)
  }

  func testMalformedIsNil() {
    XCTAssertNil(ChatReply.decode(Data(#"{"error":"llm_busy"}"#.utf8)))
  }

  /// 푸시 ADD_EVENT 와 같은 조건(notify.ts planProposalPush): create_event · proposed · 시각 있는 start · uncertain 없음 · 지나지 않음
  func testCalendarStartOnlyForTimedCertainProposed() throws {
    func p(_ payload: String, action: String = "create_event", status: String = "proposed") throws -> ChatReply.Proposal {
      try JSONDecoder().decode(ChatReply.Proposal.self, from: Data(#"{"id":"p","item_id":"i","action":"\#(action)","status":"\#(status)","payload":\#(payload)}"#.utf8))
    }
    let now = try XCTUnwrap(ISO8601DateFormatter().date(from: "2026-10-01T09:00:00+09:00"))
    XCTAssertEqual(ChatReply.calendarStart(try p(#"{"start":"2026-10-02T15:30:00+09:00","uncertain":[]}"#), now: now), "2026-10-02T15:30:00+09:00")
    XCTAssertEqual(ChatReply.calendarStart(try p(#"{"start":"2026-10-02T15:30:00+09:00"}"#), now: now), "2026-10-02T15:30:00+09:00")
    XCTAssertNil(ChatReply.calendarStart(try p(#"{"start":"2026-10-02","uncertain":[]}"#), now: now))                       // 날짜만
    XCTAssertNil(ChatReply.calendarStart(try p(#"{"start":"2026-10-02T15:30:00+09:00","uncertain":["year"]}"#), now: now))   // 확인 필요
    XCTAssertNil(ChatReply.calendarStart(try p(#"{"start":"2026-10-02T15:30:00+09:00"}"#, status: "succeeded"), now: now))
    XCTAssertNil(ChatReply.calendarStart(try p(#"{"due":"2026-10-02T15:30:00+09:00"}"#, action: "create_reminder"), now: now))
    XCTAssertNil(ChatReply.calendarStart(try p(#"{"start":null}"#), now: now))
    XCTAssertNil(ChatReply.calendarStart(try p(#"{"start":"2026-10-02T15:30"}"#), now: now))                              // 오프셋 없음 → handleAdd 가 못 읽음
  }

  /// 지난 일정(백필 제안은 푸시만 skip past 하고 proposed 로 남는다)은 버튼 없음. 경계: start == now 는 지나지 않음(notify.ts start < now)
  func testCalendarStartSkipsPast() throws {
    let p = try JSONDecoder().decode(ChatReply.Proposal.self, from: Data(#"{"id":"p","item_id":"i","action":"create_event","status":"proposed","payload":{"start":"2026-10-01T09:00:00+09:00"}}"#.utf8))
    let at = try XCTUnwrap(ISO8601DateFormatter().date(from: "2026-10-01T00:00:00Z"))   // = 09:00 서울
    XCTAssertEqual(ChatReply.calendarStart(p, now: at), "2026-10-01T09:00:00+09:00")
    XCTAssertNil(ChatReply.calendarStart(p, now: at.addingTimeInterval(1)))
    XCTAssertNil(ChatReply.calendarStart(p, now: at.addingTimeInterval(86_400 * 90)))
  }

  /// handleAdd 결과 → 카드 문구·재시도 가능 여부. 실패만 버튼을 다시 켠다(dup·skip 은 다시 눌러도 같은 결과)
  func testAddFeedback() {
    XCTAssertEqual(ChatReply.addFeedback("ok").text, "캘린더에 추가했습니다")
    XCTAssertEqual(ChatReply.addFeedback("recovered").text, "캘린더에 추가했습니다")
    XCTAssertEqual(ChatReply.addFeedback("dup").text, "이미 캘린더에 추가된 제안입니다")
    XCTAssertEqual(ChatReply.addFeedback("skip_succeeded").text, "이미 캘린더에 추가된 제안입니다")
    XCTAssertEqual(ChatReply.addFeedback("skip_stale").text, "제안이 바뀌어 추가하지 않았습니다")
    XCTAssertEqual(ChatReply.addFeedback("fail:no_writable_calendar").text, "쓸 수 있는 기본 캘린더가 없어 추가하지 못했습니다")
    XCTAssertEqual(ChatReply.addFeedback("fail:EKError").text, "추가하지 못했습니다. 다시 눌러 주세요")
    XCTAssertEqual(ChatReply.addFeedback("invalid_payload").text, "추가하지 못했습니다. 다시 눌러 주세요")
    for o in ["ok", "recovered", "dup", "skip_succeeded", "skip_stale"] { XCTAssertFalse(ChatReply.addFeedback(o).retry, o) }
    for o in ["fail:no_writable_calendar", "fail:EKError", "invalid_payload"] { XCTAssertTrue(ChatReply.addFeedback(o).retry, o) }
  }

  func testErrorMessages() {
    XCTAssertEqual(ChatReply.errorMessage(status: 429), "이번 달 예산을 다 써서 답할 수 없습니다(수집은 계속됩니다)")
    XCTAssertEqual(ChatReply.errorMessage(status: 503), "잠시 뒤 다시 물어보세요")
    XCTAssertEqual(ChatReply.errorMessage(status: 400), "질문을 500자 이내로 적어 주세요")
    XCTAssertEqual(ChatReply.errorMessage(status: 500), "오류 500")
  }

  /// llm_busy(503)는 첫 시도에서만 짧게 기다렸다 한 번 더. 서버 retry-after(30초)는 대화에 너무 길어 상한을 둔다
  func testRetryOnlyOnceForBusy() {
    XCTAssertEqual(ChatReply.retryDelay(status: 503, attempt: 0), 5)
    XCTAssertNil(ChatReply.retryDelay(status: 503, attempt: 1))
    XCTAssertNil(ChatReply.retryDelay(status: 429, attempt: 0))
    XCTAssertNil(ChatReply.retryDelay(status: 200, attempt: 0))
  }

  /// timestamptz(UTC, 소수 초) → 서울 벽시계
  func testSeoulDateLabel() {
    XCTAssertEqual(ChatReply.seoulLabel("2026-07-03T15:14:00.123456+00:00"), "2026-07-04 00:14")
    XCTAssertEqual(ChatReply.seoulLabel("2026-07-03T12:14:00Z"), "2026-07-03 21:14")
    XCTAssertEqual(ChatReply.seoulLabel("2026-07-03T21:14:00+09:00"), "2026-07-03 21:14")
    XCTAssertEqual(ChatReply.seoulLabel("이상한 값"), "이상한 값")
  }

  // R-A1 후보(스펙 §9). 0.6.x 서버 응답에는 없다 → 빈 배열
  func testCandidatesDecodeAndDefault() throws {
    let withCands = body.replacingOccurrences(of: #""hits":"#,
      with: #""candidates":["11111111-1111-4111-8111-111111111111","33333333-3333-4333-8333-333333333333"],"hits":"#)
    XCTAssertEqual(try XCTUnwrap(ChatReply.decode(Data(withCands.utf8))).candidateIDs.count, 2)
    XCTAssertEqual(try XCTUnwrap(ChatReply.decode(Data(body.utf8))).candidateIDs, [])
  }

  // 0.7.1: 거절이거나 후보가 비면 "보관함에서 보기" 없음
  func testArchiveIDsHiddenWhenRefusedOrEmpty() throws {
    let cands = #""candidates":["11111111-1111-4111-8111-111111111111"],"hits":"#
    let ok = body.replacingOccurrences(of: #""hits":"#, with: cands)
    XCTAssertEqual(try XCTUnwrap(ChatReply.decode(Data(ok.utf8))).archiveIDs, ["11111111-1111-4111-8111-111111111111"])
    let refused = ok.replacingOccurrences(of: #""refused":false"#, with: #""refused":true"#)
    XCTAssertNil(try XCTUnwrap(ChatReply.decode(Data(refused.utf8))).archiveIDs)
    XCTAssertNil(try XCTUnwrap(ChatReply.decode(Data(body.utf8))).archiveIDs)
    let empty = body.replacingOccurrences(of: #""hits":"#, with: #""candidates":[],"hits":"#)
    XCTAssertNil(try XCTUnwrap(ChatReply.decode(Data(empty.utf8))).archiveIDs)
  }
}
