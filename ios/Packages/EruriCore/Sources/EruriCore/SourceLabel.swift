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
    case "SHARE": return appName == LinkText.appName ? "공유한 링크" : appName == ImageText.appName ? "공유한 이미지" : "공유"   // 0.11.0
    case "CHAT": return "채팅"
    default: return source
    }
  }
}
