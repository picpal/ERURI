import Foundation
import EruriCore

/// 채팅 집계·저장 규칙 버튼 서버 호출(스펙 §9 "채팅 저장 규칙·집계 질문", 0.17.0) — 모델을 부르지 않는 라우트.
/// 조건·칸 키·응답 본문은 로그에 남기지 않는다 — 호출부가 상태·건수만 trace
enum ChatRuleAPI {
  /// 집계 칸 목록(POST /chat/aggregate): 응답 conditions 그대로 + 칸 키. 연결 실패·비200·해석 실패 → nil(카드가 실패 문구)
  static func list(_ c: ChatAggregate.Conditions, bucketKey: String) async -> ChatAggregate.ListResponse? {
    guard let r = await API.send("functions/v1/chat/aggregate", method: "POST", json: ChatAggregate.listBody(c, bucketKey: bucketKey), timeout: 20),
          r.status == 200 else { return nil }
    return ChatAggregate.decodeList(r.data)
  }
}
