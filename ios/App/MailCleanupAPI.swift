import Foundation
import EruriCore

/// 메일 정리 서버 호출(스펙 §7 "메일 정리", 0.14.0). 본문(조건)·응답(미리보기 글)은 로그에 남기지 않는다 — 호출부가 상태·개수·코드만 trace.
/// body 는 호출 직전에 JSON 객체로 만든 [String: Any](Swift 6: Task 경계를 넘기지 않는다 — 넘겨야 하면 Conditions/JSONValue 를 넘기고 여기서 변환)
enum MailCleanupAPI {
  static func preview(_ body: [String: Any]) async -> (status: Int, data: Data)? {
    await API.send("functions/v1/mail-action/preview", method: "POST", json: body, timeout: 60)
  }
  static func execute(token: String) async -> (status: Int, data: Data)? {
    await API.send("functions/v1/mail-action/execute", method: "POST", json: ["token": token], timeout: 20)
  }
  static func undo(id: String) async -> (status: Int, data: Data)? {
    await API.send("functions/v1/mail-action/undo", method: "POST", json: ["id": id], timeout: 30)
  }
  static func status(id: String) async -> (status: Int, data: Data)? {
    await API.send("functions/v1/mail-action/status?id=\(id)", timeout: 10)
  }
}
