import Foundation
import EruriCore

/// 메일 요약 서버 호출(스펙 §7 "메일 요약", 0.15.0). 본문(칸·request)·응답(후보·요약)은 로그에 남기지 않는다 — 호출부가 단계·결과·개수·코드만 trace.
/// 앱 요청 타임아웃: 검색 30초, 읽기 90초(서버 읽기는 약 80초 안 — §7 "시간")
enum MailSummaryAPI {
  static func search(_ body: [String: Any]) async -> (status: Int, data: Data)? {
    await API.send("functions/v1/mail-read/search", method: "POST", json: body, timeout: 30)
  }
  static func read(token: String, translate: Bool, request: String) async -> (status: Int, data: Data)? {
    await API.send("functions/v1/mail-read/read", method: "POST", json: ["token": token, "translate": translate, "request": request] as [String: Any], timeout: 90)
  }
}
