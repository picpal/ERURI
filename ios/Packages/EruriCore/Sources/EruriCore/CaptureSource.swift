import Foundation

/// 업로드 출처(`items.source`). ingest(handler.ts SOURCES)는 이 네 값만 받고 그 밖은 400 이다(GMAIL 은 서버가 직접 수집).
/// 인텐트의 출처는 사용자가 단축어에 직접 적는 글이라 "MESSAGE"(단수) 같은 오타가 들어온다 — 실기기 10-01~10-03 에 문자 17건이
/// 400 으로 큐에 남아 1시간마다 재시도만 했다. 큐에 넣을 때와 올릴 때 이 값으로 맞춘다(올릴 때도 맞춰 이미 쌓인 항목이 다음 재시도에 올라간다)
public enum CaptureSource {
  public static let accepted: Set<String> = ["MESSAGES", "NOTIFICATION", "SHARE", "CHAT"]

  /// 대소문자·앞뒤 공백 무시, "MESSAGE" → "MESSAGES". 모르는 값은 인텐트 기본값 NOTIFICATION(서버 규칙·게이트는 출처와 무관하게 같다, 스펙 §7)
  public static func normalize(_ raw: String) -> String {
    let s = raw.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
    if accepted.contains(s) { return s }
    return s == "MESSAGE" ? "MESSAGES" : "NOTIFICATION"
  }
}
