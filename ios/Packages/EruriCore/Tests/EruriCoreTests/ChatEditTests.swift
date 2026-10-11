import XCTest
@testable import EruriCore

/// 스펙 §9 "채팅 일정 개선" B 앱(고치기 턴)·A(맥락 줄) — 응답 해석·문구·전 → 후 줄·버전 조회. 오늘 2026-10-08(목), 서울. 문구는 전부 합성
final class ChatEditTests: XCTestCase {
  private func resp(_ json: String) throws -> ChatEdit.Response { try JSONDecoder().decode(ChatEdit.Response.self, from: Data(json.utf8)) }
  private let okJSON = #"{"status":"ok","proposal_id":"p2","action":"create_event","before":{"title":"합성 미팅","start":"2026-10-10T11:00:00+09:00","end":"2026-10-10T15:00:00+09:00","location":"합성카페"},"after":{"title":"합성 회의","start":"2026-10-09T11:00:00+09:00","end":"2026-10-09T15:00:00+09:00","location":null}}"#

  func testDecodeAndDiffLinesOnlyChangedFields() throws {
    let r = try resp(okJSON)
    XCTAssertEqual([r.status, r.proposal_id, r.action], ["ok", "p2", "create_event"])
    XCTAssertEqual(ChatEdit.diffLines(r), ["날짜·시간 10/10(토) 11:00–15:00 → 10/9(금) 11:00–15:00", "제목 합성 미팅 → 합성 회의", "장소 합성카페 → 없음"])
    let same = try resp(#"{"status":"ok","proposal_id":"p2","action":"create_event","before":{"title":"합성 미팅","start":"2026-10-10T02:00:00Z","end":null,"location":null},"after":{"title":"합성 미팅","start":"2026-10-10T11:00:00+09:00","end":null,"location":null}}"#)
    XCTAssertEqual(ChatEdit.diffLines(same), [])                                            // 같은 순간이면 줄 없음
    XCTAssertEqual(ChatEdit.diffLines(try resp(#"{"status":"expired","before":null,"after":null,"proposal_id":null,"action":null}"#)), [])
  }
  func testWhenTextFollowsCardLabels() {
    XCTAssertEqual(ChatEdit.whenText(start: "2026-10-09T11:00:00+09:00", end: "2026-10-09T15:00:00+09:00"), "10/9(금) 11:00–15:00")
    XCTAssertEqual(ChatEdit.whenText(start: "2026-10-09T11:00:00+09:00", end: nil), "10/9(금) 11:00")
    XCTAssertEqual(ChatEdit.whenText(start: "2026-10-09", end: nil), "10/9(금) 종일")
    XCTAssertEqual(ChatEdit.whenText(start: "2026-10-08", end: "2026-10-10"), "10/8(목)–10/10(토) 종일")
    XCTAssertEqual(ChatEdit.whenText(start: nil, end: nil), "날짜 미정")
  }
  func testContextLineOnlyForOkAndOneLineStatuses() throws {
    XCTAssertEqual(ChatEdit.contextLine(try resp(okJSON)), "고침: 합성 회의 · 10/9(금) 11:00–15:00")
    XCTAssertNil(ChatEdit.contextLine(try resp(#"{"status":"no_change","proposal_id":"p1","action":"create_event","before":{"title":"a","start":null,"end":null,"location":null},"after":{"title":"a","start":null,"end":null,"location":null}}"#)))
    XCTAssertNil(ChatEdit.contextLine(nil))
    XCTAssertEqual(ChatEdit.oneLine("expired"), ChatEditText.expired)
    XCTAssertEqual(ChatEdit.oneLine("multi"), ChatEditText.multi)
    XCTAssertEqual(ChatEdit.oneLine("no_change"), "바뀐 내용이 없어요.")
    XCTAssertEqual(ChatEdit.oneLine("not_found"), "고칠 일정을 찾지 못했어요.")
    XCTAssertNil(ChatEdit.oneLine("ok"))
    XCTAssertEqual(ChatEditText.expired, "등록한 지 30분이 지나 채팅으로는 고칠 수 없어요. 캘린더에서 직접 고치거나 새로 등록해 주세요.")
  }
  /// 값은 그대로이고 확인 코드만 풀린 ok(스펙 B 서버 4 — "오후 6시 맞아", 계획 K6): 머리 "확인했어요", 전 → 후 줄 없음, 맥락 줄은 그대로 "고침:"
  func testHeaderSaysConfirmedWhenOnlyCodesWereCleared() throws {
    XCTAssertEqual(ChatEdit.headerText(try resp(okJSON)), "일정을 고쳤어요")
    let same = try resp(#"{"status":"ok","proposal_id":"p2","action":"create_event","before":{"title":"합성 저녁","start":"2026-10-14T18:00:00+09:00","end":null,"location":null},"after":{"title":"합성 저녁","start":"2026-10-14T18:00:00+09:00","end":null,"location":null}}"#)
    XCTAssertEqual([ChatEdit.headerText(same), ChatEditText.confirmedOnly], ["확인했어요", "확인했어요"])
    XCTAssertEqual(ChatEdit.diffLines(same), [])
    XCTAssertEqual(ChatEdit.contextLine(same), "고침: 합성 저녁 · 10/14(수) 18:00")
  }
  func testQueryAndDecodeFactKeepAllVersionsAscending() throws {
    XCTAssertEqual(ChatEdit.query(proposalID: "p2"), "rest/v1/proposals?id=eq.p2&select=id,facts(item_id,ordinal,proposals(id,action,status,version,payload,eventkit_id))")
    let data = Data(#"[{"id":"p2","facts":{"item_id":"i1","ordinal":0,"proposals":[{"id":"p2","action":"update_event","status":"proposed","version":2,"payload":{"title":"합성 회의","start":"2026-10-09T11:00:00+09:00","before":{"title":"합성 미팅","start":"2026-10-10T11:00:00+09:00","end":null,"location":null},"base_proposal_id":"p1","uncertain":["year"]},"eventkit_id":"EK-1"},{"id":"p1","action":"create_event","status":"succeeded","version":1,"payload":{"title":"합성 미팅","start":"2026-10-10T11:00:00+09:00"},"eventkit_id":"EK-1"}]}}]"#.utf8)
    let f = try XCTUnwrap(ChatEdit.decodeFact(data))
    XCTAssertEqual([f.itemID, f.versions.map(\.id).joined(separator: ",")], ["i1", "p1,p2"])
    let top = try XCTUnwrap(f.top)
    XCTAssertEqual([top.action, top.basePID, top.eventkitID, top.displayTitle], ["update_event", "p1", "EK-1", "합성 회의"])
    XCTAssertEqual(top.before, ChatEdit.Values(title: "합성 미팅", start: "2026-10-10T11:00:00+09:00", end: nil, location: nil))
    XCTAssertEqual(top.uncertain, ["year"])
    XCTAssertTrue(f.contains("p1")); XCTAssertFalse(f.contains("p9"))
    XCTAssertNil(ChatEdit.decodeFact(Data("[]".utf8)))
  }
  func testChangeFeedbackCodes() {
    XCTAssertEqual(ChatEdit.changeFeedback("changed").text, "✅ 캘린더도 바꿨어요")
    XCTAssertEqual(ChatEdit.changeFeedback("recovered").retry, false)
    XCTAssertEqual(ChatEdit.changeFeedback("user_modified").text, ChatEditText.userModified)
    XCTAssertEqual(ChatEdit.changeFeedback("base_deleted").text, "캘린더에서 지운 일정이에요")
    XCTAssertEqual(ChatEdit.changeFeedback("base_unknown").text, ChatEditText.unknown)
    XCTAssertEqual(ChatEdit.changeFeedback("conflict:2").retry, true)
    XCTAssertEqual(ChatEdit.changeFeedback("fail:EKError").text, "캘린더를 바꾸지 못했어요")
  }
  func testConflictLineNamesTheFirstAndCount() {
    let d = { (s: String) in ISO8601DateFormatter().date(from: s)! }
    let a = ProposalFlow.CalendarEvent(id: "e1", title: "합성 회의", start: d("2026-10-09T06:00:00Z"), end: d("2026-10-09T07:00:00Z"))
    let b = ProposalFlow.CalendarEvent(id: "e2", title: "합성 점심", start: d("2026-10-09T07:00:00Z"), end: d("2026-10-09T08:00:00Z"))
    XCTAssertEqual(ChatEditText.conflictLine([a, b]), "⚠️ 바꾸면 겹치는 일정 15:00–16:00 합성 회의 외 1건")
  }
  func testFactsAndRegisteredLines() throws {
    let data = Data(#"[{"ordinal":1,"proposals":[{"id":"q1","action":"create_event","status":"proposed","version":1,"payload":{"title":"합성 저녁","start":"2026-10-10"}}]},{"ordinal":0,"proposals":[{"id":"p1","action":"create_event","status":"stale","version":1,"payload":{"title":"합성 미팅","start":"2026-10-10T11:00:00+09:00"}},{"id":"p2","action":"create_event","status":"proposed","version":2,"payload":{"title":"합성 미팅","start":"2026-10-09T11:00:00+09:00","end":"2026-10-09T15:00:00+09:00"}}]},{"ordinal":2,"proposals":[{"id":"r1","action":"create_event","status":"dismissed","version":1,"payload":{"title":"합성 무시"}}]}]"#.utf8)
    let facts = try XCTUnwrap(ChatAddEvent.facts(itemID: "i1", data: data))
    XCTAssertEqual(facts.map(\.ordinal), [0, 1, 2])
    let r = try XCTUnwrap(ChatAddEvent.registeredLines(facts))
    XCTAssertEqual(r.ids, ["p2", "q1"])                                                   // 최고 버전이 proposed·succeeded 인 것만, 순번 순
    XCTAssertEqual(r.line, "등록함: 합성 미팅 · 10/9(금) 11:00–15:00\n등록함: 합성 저녁 · 10/10(토) 종일")
    XCTAssertNil(ChatAddEvent.registeredLines([]))
    XCTAssertTrue(ChatAddEvent.intents.contains("edit_event"))
  }
  func testAddFeedbackLineageCodes() {
    XCTAssertEqual(ChatReply.addFeedback("lineage:p1").text, "고치기 전 일정이 캘린더에 있어 추가하지 않았어요 — 채팅이나 항목 상세에서 바꿔 주세요")
    XCTAssertEqual(ChatReply.addFeedback("lineage:p1").retry, false)
    XCTAssertEqual(ChatReply.addFeedback("fail:lineage_unknown").text, "확인하지 못했어요. 다시 눌러 주세요.")
    XCTAssertEqual(ChatReply.addFeedback("fail:lineage_unknown").retry, true)
  }
  func testAnswerDecodesEditAndOldRepliesStillDecode() throws {
    let a = try XCTUnwrap(ChatReply.decode(Data(#"{"answer_id":"x","answer":"","refused":false,"citations":[],"proposals":[],"intent":"edit_event","edit":\#(okJSON)}"#.utf8)))
    XCTAssertEqual(a.edit?.after?.title, "합성 회의")
    XCTAssertNil(ChatReply.decode(Data(#"{"answer_id":"x","answer":"a","refused":false,"citations":[],"proposals":[]}"#.utf8))?.edit)
  }
}
