import Foundation

/// 출처 표시 이름(스펙 §7 1단계): NOTIFICATION + 메시지 앱은 MESSAGES 와 같이 "문자"로 표시만 한다
public enum SourceLabel {
  static let messageApps: Set<String> = ["메시지", "messages", "sms", "imessage"]
  public static func label(source: String, appName: String?) -> String {
    let app = (appName ?? "").replacingOccurrences(of: " ", with: "").lowercased()
    switch source {
    case "MESSAGES": return "문자"
    case "NOTIFICATION": return messageApps.contains(app) ? "문자" : (appName ?? "알림")
    case "GMAIL": return "메일"
    case "SHARE":                                                                    // 0.11.0 링크·사진, 0.13.0 채팅 일정 등록
      return appName == LinkText.appName ? "공유한 링크" : appName == ImageText.appName ? "공유한 이미지" : appName == ChatAddEvent.appName ? "채팅에서 등록" : "공유"
    case "CHAT": return "채팅"
    default: return source
    }
  }
}
