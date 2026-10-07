import Foundation
import EruriCore

/// 메일 정리 서버 호출(스펙 §7 "메일 정리", 0.14.0). 본문(조건)·응답(미리보기 글)은 로그에 남기지 않는다 — 호출부가 상태·개수·코드만 trace.
/// body 는 JSON 객체 [String: Any]. 호출부(previewMail)는 이를 Task 로 넘긴다 — Swift 6 region isolation 이 넘긴 뒤 호출부가 다시 쓰지 않음을 확인해 통과한다
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
