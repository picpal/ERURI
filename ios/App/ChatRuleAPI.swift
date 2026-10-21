import Foundation
import EruriCore

/// 채팅 집계·저장 규칙 버튼 서버 호출(스펙 §9 "채팅 저장 규칙·집계 질문", 0.17.0) — 모델을 부르지 않는 라우트.
/// 조건·칸 키·규칙 값·응답 본문은 로그에 남기지 않는다 — 호출부가 상태·건수만 trace
enum ChatRuleAPI {
  /// 집계 칸 목록(POST /chat/aggregate): 응답 conditions 그대로 + 칸 키. 연결 실패·비200·해석 실패 → nil(카드가 실패 문구)
  static func list(_ c: ChatAggregate.Conditions, bucketKey: String) async -> ChatAggregate.ListResponse? {
    guard let r = await API.send("functions/v1/chat/aggregate", method: "POST", json: ChatAggregate.listBody(c, bucketKey: bucketKey), timeout: 20),
          r.status == 200 else { return nil }
    return ChatAggregate.decodeList(r.data)
  }

  // 저장 규칙 카드 버튼(POST /chat/rule). status = HTTP 상태(연결 실패 -1). 비200·해석 실패면 result nil — 카드가 "바꾸지 못했어요"(버튼 유지)

  /// [저장 규칙 추가]: added·duplicate·limit·bad_value
  static func add(kind: String, value: String) async -> (status: Int, result: SaveRules.AddResult?) {
    let r = await rule(SaveRules.addBody(kind: kind, value: value))
    return (r.status, r.data.flatMap(SaveRules.decodeAdd))
  }
  /// [빼기]: removed·not_found
  static func remove(ruleID: String) async -> (status: Int, result: SaveRules.RemoveResult?) {
    let r = await rule(SaveRules.removeBody(ruleID: ruleID))
    return (r.status, r.data.flatMap(SaveRules.decodeRemove))
  }
  /// [함께 저장]: queued·none·not_found
  static func restore(ruleID: String) async -> (status: Int, result: SaveRules.RestoreResult?) {
    let r = await rule(SaveRules.restoreBody(ruleID: ruleID))
    return (r.status, r.data.flatMap(SaveRules.decodeRestore))
  }

  private static func rule(_ body: [String: Any]) async -> (status: Int, data: Data?) {
    guard let r = await API.send("functions/v1/chat/rule", method: "POST", json: body, timeout: 20) else { return (-1, nil) }
    return (r.status, r.status == 200 ? r.data : nil)
  }
}
