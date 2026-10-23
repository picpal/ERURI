import Foundation
import EruriCore

/// 메일 요약 서버 호출(스펙 §7 "메일 요약", 0.15.0). 본문(칸·request)·응답(후보·요약)은 로그에 남기지 않는다 — 호출부가 단계·결과·개수·코드만 trace.
/// 앱 요청 타임아웃: 검색 30초, 읽기 90초(서버 읽기는 약 80초 안 — §7 "시간"), 목록 요약 120초(0.19.0)
enum MailSummaryAPI {
  static func search(_ body: [String: Any]) async -> (status: Int, data: Data)? {
    await API.send("functions/v1/mail-read/search", method: "POST", json: body, timeout: 30)
  }
  static func read(token: String, translate: Bool, request: String) async -> (status: Int, data: Data)? {
    await API.send("functions/v1/mail-read/read", method: "POST", json: ["token": token, "translate": translate, "request": request] as [String: Any], timeout: 90)
  }
  /// 목록 요약(§7 "여러 통 — 목록 요약", 0.19.0): 토큰 ≤ 10. 서버 응답 ≤ 약 112초 — 앱 120초
  static func digest(tokens: [String]) async -> (status: Int, data: Data)? {
    await API.send("functions/v1/mail-read/digest", method: "POST", json: ["tokens": tokens] as [String: Any], timeout: 120)
  }
}
