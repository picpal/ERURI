import UIKit

/// 채팅 하드웨어 Return(§9, 0.8.3)용: 지금 포커스된 입력창(UITextInput)을 찾는다. SwiftUI TextField 는 한글 조합 상태(markedText)와 커서를 내주지 않아
/// 조합 확정·커서 자리 줄바꿈을 UIKit 입력창에 직접 맡긴다
@MainActor enum TextInputBridge {
  private static weak var found: UIResponder?

  static var current: (UIResponder & UITextInput)? {
    found = nil
    UIApplication.shared.sendAction(#selector(UIResponder.eruriCaptureFirstResponder), to: nil, from: nil, for: nil)
    return found as? (UIResponder & UITextInput)
  }

  static var isComposing: Bool { current?.markedTextRange != nil }
  static func commit() { current?.unmarkText() }
  static func insertNewline() { current?.insertText("\n") }
  fileprivate static func capture(_ r: UIResponder) { found = r }
}

extension UIResponder {
  @objc fileprivate func eruriCaptureFirstResponder() { TextInputBridge.capture(self) }
}
