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

  /// 겹침(conflict:<n>)은 화면이 확인창으로 가로채지만, 문구로 떨어져도 뜻이 통하고 다시 누를 수 있게
  func testAddFeedbackConflict() {
    XCTAssertEqual(ChatReply.addFeedback("conflict:1").text, "같은 시간에 일정이 있습니다")
    XCTAssertTrue(ChatReply.addFeedback("conflict:1").retry)
    // 전체 접근 없이 눌린 낡은 카드·알림(C2 리뷰 Minor 1): gate 가 저장하지 않는다
    XCTAssertEqual(ChatReply.addFeedback("fail:no_full_access").text, "캘린더 전체 접근을 허용해야 추가할 수 있습니다")
  }

  /// S3 schedule: 서울 날짜 경계 구간. 키 없음(0.7.x 서버)·null·거꾸로 된 구간·32일 초과는 nil
  func testScheduleDecode() throws {
    let s = #""schedule":{"from":"2026-10-03T00:00:00+09:00","to":"2026-10-03T23:59:59+09:00"},"hits":"#
    let a = try XCTUnwrap(ChatReply.decode(Data(body.replacingOccurrences(of: #""hits":"#, with: s).utf8)))
    let i = try XCTUnwrap(a.schedule?.interval)
    XCTAssertEqual(i.start, ISO8601DateFormatter().date(from: "2026-10-02T15:00:00Z"))
    XCTAssertEqual(i.duration, 86_399)
    XCTAssertNil(try XCTUnwrap(ChatReply.decode(Data(body.utf8))).schedule)
    let null = body.replacingOccurrences(of: #""hits":"#, with: #""schedule":null,"hits":"#)
    XCTAssertNil(try XCTUnwrap(ChatReply.decode(Data(null.utf8))).schedule)
    let reversed = body.replacingOccurrences(of: #""hits":"#, with: #""schedule":{"from":"2026-10-04T00:00:00+09:00","to":"2026-10-03T23:59:59+09:00"},"hits":"#)
    XCTAssertNil(try XCTUnwrap(ChatReply.decode(Data(reversed.utf8))).schedule?.interval)
    let long = body.replacingOccurrences(of: #""hits":"#, with: #""schedule":{"from":"2026-10-01T00:00:00+09:00","to":"2026-11-29T23:59:59+09:00"},"hits":"#)
    XCTAssertNil(try XCTUnwrap(ChatReply.decode(Data(long.utf8))).schedule?.interval)          // 60일 → 읽지 않는다(Codex #8)
  }

  /// 의도 판별(스펙 §9, 0.13.0): 서버가 주면 intent, 0.12.x 서버(필드 없음)는 nil = 질문
  func testIntentDecodes() throws {
    let act = try XCTUnwrap(ChatReply.decode(Data(#"{"answer_id":"x","answer":"","refused":false,"source_item_ids":[],"citations":[],"proposals":[],"hits":[],"candidates":[],"schedule":null,"intent":"add_event","mail":null}"#.utf8)))
    XCTAssertEqual(act.intent, "add_event")
    XCTAssertTrue(ChatAddEvent.isAddEvent(act.intent))
    let old = try XCTUnwrap(ChatReply.decode(Data(#"{"answer_id":"x","answer":"합성","refused":false,"source_item_ids":[],"citations":[],"proposals":[],"hits":[]}"#.utf8)))
    XCTAssertNil(old.intent)
    XCTAssertFalse(ChatAddEvent.isAddEvent(old.intent))
  }
}
