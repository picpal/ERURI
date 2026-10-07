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
  /// 제안 카드 출처 버튼 아이콘(2026-10-07, 스펙 §11). SF Symbols 이름 — label 과 같은 분기
  public static func symbol(source: String, appName: String?) -> String {
    let app = (appName ?? "").replacingOccurrences(of: " ", with: "").lowercased()
    switch source {
    case "MESSAGES": return "message"
    case "NOTIFICATION": return messageApps.contains(app) ? "message" : "bell"
    case "GMAIL": return "envelope"
    case "SHARE":
      return appName == LinkText.appName ? "link" : appName == ImageText.appName ? "photo" : appName == ChatAddEvent.appName ? "bubble.left" : "square.and.arrow.up"
    case "CHAT": return "bubble.left"
    default: return "doc.text"
    }
  }
}
