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

  /// 푸시 ADD_EVENT 와 같은 조건(notify.ts planProposalPush): create_event · proposed · 시각 있는 start · uncertain 없음
  func testCalendarStartOnlyForTimedCertainProposed() throws {
    func p(_ payload: String, action: String = "create_event", status: String = "proposed") throws -> ChatReply.Proposal {
      try JSONDecoder().decode(ChatReply.Proposal.self, from: Data(#"{"id":"p","item_id":"i","action":"\#(action)","status":"\#(status)","payload":\#(payload)}"#.utf8))
    }
    XCTAssertEqual(ChatReply.calendarStart(try p(#"{"start":"2026-10-02T15:30:00+09:00","uncertain":[]}"#)), "2026-10-02T15:30:00+09:00")
    XCTAssertEqual(ChatReply.calendarStart(try p(#"{"start":"2026-10-02T15:30:00+09:00"}"#)), "2026-10-02T15:30:00+09:00")
    XCTAssertNil(ChatReply.calendarStart(try p(#"{"start":"2026-10-02","uncertain":[]}"#)))                       // 날짜만
    XCTAssertNil(ChatReply.calendarStart(try p(#"{"start":"2026-10-02T15:30:00+09:00","uncertain":["year"]}"#)))   // 확인 필요
    XCTAssertNil(ChatReply.calendarStart(try p(#"{"start":"2026-10-02T15:30:00+09:00"}"#, status: "succeeded")))
    XCTAssertNil(ChatReply.calendarStart(try p(#"{"due":"2026-10-02T15:30:00+09:00"}"#, action: "create_reminder")))
    XCTAssertNil(ChatReply.calendarStart(try p(#"{"start":null}"#)))
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
}
