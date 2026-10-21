import XCTest
@testable import EruriCore

/// 저장 규칙 카드·버튼 해석(스펙 §9 "저장 규칙 응답"·"카드 버튼"·"앱 — 저장 규칙 카드", 0.17.0 P1). 합성 값
final class SaveRulesTests: XCTestCase {
  private let r1 = SaveRules.Rule(id: "r1", kind: "keyword", value: "PINPAY", created_at: "2026-10-21T01:00:00+00:00")
  private let r2 = SaveRules.Rule(id: "r2", kind: "sender", value: "합성은행", created_at: "2026-10-21T02:00:00+00:00")
  private func resp(op: String, status: String, rules: [SaveRules.Rule] = [], matches: [SaveRules.Rule] = [], matched: Int = 0) -> SaveRules.Response {
    SaveRules.Response(op: op, status: status, candidate: nil, matches: matches, rules: rules, matched: matched, limit: 20)
  }

  func testSaveRuleTexts() {
    XCTAssertEqual(SaveRules.ruleLine(r1), "키워드 · PINPAY")
    XCTAssertEqual(SaveRules.ruleLine(r2), "발신자 · 합성은행")
    let k = SaveRules.addPrompt(.init(kind: "keyword", value: "PINPAY"))
    XCTAssertEqual(k.title, "저장 규칙을 추가할까요?")
    XCTAssertEqual(k.line, "키워드 'PINPAY' — 제목·본문에 들어 있으면 알림으로 분류돼도 저장해요")
    XCTAssertEqual(k.note, "이 키워드가 든 개인 대화도 저장돼요")
    let s = SaveRules.addPrompt(.init(kind: "sender", value: "합성은행"))
    XCTAssertEqual(s.title, "저장 규칙을 추가할까요?")
    XCTAssertEqual(s.line, "발신자 '합성은행' — 이 발신자의 메시지는 알림으로 분류돼도 저장해요")
    XCTAssertEqual(s.note, "이 발신자와의 개인 대화도 저장돼요")
    XCTAssertEqual(SaveRules.added(count: 3), "저장 규칙을 추가했어요 (3/20)")
    XCTAssertEqual(SaveRules.matchedLine(2), "최근 폐기된 메시지 2건이 이 규칙에 맞아요")
    XCTAssertEqual(SaveRules.headline(resp(op: "add", status: "ok")), "저장 규칙을 추가할까요?")
    XCTAssertEqual(SaveRules.headline(resp(op: "add", status: "duplicate")), "이미 있는 저장 규칙이에요")
    XCTAssertEqual(SaveRules.headline(resp(op: "add", status: "limit")), "저장 규칙은 20개까지예요 — 안 쓰는 규칙을 빼 주세요")
    XCTAssertEqual(SaveRules.headline(resp(op: "add", status: "bad_value")), "키워드는 2~30자로 말해 주세요")
    XCTAssertEqual(SaveRules.headline(resp(op: "remove", status: "bad_value")), "키워드는 2~30자로 말해 주세요")
    XCTAssertEqual(SaveRules.headline(resp(op: "remove", status: "ok", matches: [r1])), "이 저장 규칙을 뺄까요?")
    XCTAssertEqual(SaveRules.headline(resp(op: "remove", status: "not_found", rules: [r1])), "그 규칙을 찾지 못했어요")
    XCTAssertEqual(SaveRules.headline(resp(op: "list", status: "ok", rules: [r1, r2])), "저장 규칙 2/20")
    XCTAssertEqual(SaveRules.headline(resp(op: "list", status: "ok")), "저장 규칙이 없어요 — '앞으로 PINPAY 문자는 저장해'처럼 말하면 추가할 수 있어요")
    XCTAssertEqual(SaveRules.listHead(count: 20), "저장 규칙 20/20")
    XCTAssertEqual(SaveRules.Text.removed, "저장 규칙을 뺐어요 — 이미 저장된 메시지는 그대로 있어요")
    XCTAssertEqual(SaveRules.Text.removedRow, "뺐어요")
    XCTAssertEqual(SaveRules.Text.buttonFailed, "바꾸지 못했어요. 다시 눌러 주세요.")
    XCTAssertTrue(SaveRules.isSaveRule("save_rule_add"))
    XCTAssertTrue(SaveRules.isSaveRule("save_rule_list"))
    XCTAssertTrue(SaveRules.isSaveRule("save_rule_remove"))
    XCTAssertFalse(SaveRules.isSaveRule("save_rule_other"))
    XCTAssertFalse(SaveRules.isSaveRule("aggregate"))
    XCTAssertFalse(SaveRules.isSaveRule(nil))
  }

  /// /chat/rule 응답(서버는 모든 status 에서 칸을 싣지만 앱 디코드는 관대하게 — PF-F12)
  func testSaveRuleButtonResults() throws {
    let add = try XCTUnwrap(SaveRules.decodeAdd(Data(#"""
    {"status":"added","rule":{"id":"r1","kind":"keyword","value":"PINPAY","created_at":"2026-10-21T01:00:00+00:00"},
     "rules":[{"id":"r1","kind":"keyword","value":"PINPAY","created_at":"2026-10-21T01:00:00+00:00"}],"matched":2}
    """#.utf8)))
    XCTAssertEqual(add.status, "added")
    XCTAssertEqual(add.rule, r1)
    XCTAssertEqual(add.rules, [r1])
    XCTAssertEqual(add.matched, 2)
    XCTAssertEqual(SaveRules.addText(add), "저장 규칙을 추가했어요 (1/20)")
    let limit = try XCTUnwrap(SaveRules.decodeAdd(Data(#"{"status":"limit"}"#.utf8)))      // 칸이 빠져도 디코드
    XCTAssertNil(limit.rule)
    XCTAssertEqual(limit.rules, [])
    XCTAssertEqual(limit.matched, 0)
    XCTAssertEqual(SaveRules.addText(limit), "저장 규칙은 20개까지예요 — 안 쓰는 규칙을 빼 주세요")
    XCTAssertEqual(SaveRules.addText(try XCTUnwrap(SaveRules.decodeAdd(Data(#"{"status":"duplicate","rule":null,"rules":[],"matched":0}"#.utf8)))),
                   "이미 있는 저장 규칙이에요")
    XCTAssertEqual(SaveRules.addText(try XCTUnwrap(SaveRules.decodeAdd(Data(#"{"status":"bad_value","rule":null,"rules":[],"matched":0}"#.utf8)))),
                   "키워드는 2~30자로 말해 주세요")
    let rm = try XCTUnwrap(SaveRules.decodeRemove(Data(#"{"status":"removed","rules":[]}"#.utf8)))
    XCTAssertEqual(rm.status, "removed")
    XCTAssertEqual(rm.rules, [])
    XCTAssertEqual(try XCTUnwrap(SaveRules.decodeRemove(Data(#"{"status":"not_found"}"#.utf8))).rules, [])
    let q = try XCTUnwrap(SaveRules.decodeRestore(Data(#"{"status":"queued","restored":3}"#.utf8)))
    XCTAssertEqual(SaveRules.restoreText(q), "3건을 다시 저장하는 중이에요 — 끝나면 보관함에 보여요")
    let none = try XCTUnwrap(SaveRules.decodeRestore(Data(#"{"status":"none"}"#.utf8)))
    XCTAssertEqual(none.restored, 0)
    XCTAssertEqual(SaveRules.restoreText(none), "지금은 맞는 메시지가 없어요")
    XCTAssertEqual(SaveRules.restoreText(.init(status: "not_found", restored: 0)), "그 규칙을 찾지 못했어요")
    XCTAssertNil(SaveRules.decodeAdd(Data(#"{"error":"internal"}"#.utf8)))                 // status 없음 = 실패(버튼 실패 문구)
    XCTAssertNil(SaveRules.decodeRestore(Data("oops".utf8)))
    // 버튼 요청 본문
    XCTAssertEqual(SaveRules.addBody(kind: "keyword", value: "PINPAY") as NSDictionary, ["op": "add", "kind": "keyword", "value": "PINPAY"])
    XCTAssertEqual(SaveRules.removeBody(ruleID: "r1") as NSDictionary, ["op": "remove", "rule_id": "r1"])
    XCTAssertEqual(SaveRules.restoreBody(ruleID: "r1") as NSDictionary, ["op": "restore", "rule_id": "r1"])
  }

  /// 채팅 판정 duplicate + 폐기분 → 기존 규칙 id 로 [함께 저장](Codex 0.17.0 리뷰 #3)
  func testDuplicateWithMatchesOffersRestore() {
    XCTAssertEqual(SaveRules.restoreRuleID(resp(op: "add", status: "duplicate", matches: [r1], matched: 2)), "r1")
    XCTAssertNil(SaveRules.restoreRuleID(resp(op: "add", status: "duplicate", matches: [r1], matched: 0)))
    XCTAssertNil(SaveRules.restoreRuleID(resp(op: "add", status: "duplicate", matches: [], matched: 2)))
    XCTAssertNil(SaveRules.restoreRuleID(resp(op: "add", status: "ok", matched: 0)))
  }

  /// 채팅 응답 save_rule 칸 — 관대한 디코드
  func testDecodesResponseLeniently() throws {
    let full = #"""
    {"op":"add","status":"ok","candidate":{"kind":"keyword","value":"PINPAY"},"matches":[],"rules":[],"matched":0,"limit":20}
    """#
    let r = try JSONDecoder().decode(SaveRules.Response.self, from: Data(full.utf8))
    XCTAssertEqual(r.candidate, .init(kind: "keyword", value: "PINPAY"))
    XCTAssertEqual(r.limit, 20)
    let thin = try JSONDecoder().decode(SaveRules.Response.self, from: Data(#"{"op":"list","status":"ok"}"#.utf8))
    XCTAssertEqual(thin.rules, [])
    XCTAssertEqual(thin.matched, 0)
    XCTAssertEqual(thin.limit, 20)
    XCTAssertNil(thin.candidate)
  }
}
