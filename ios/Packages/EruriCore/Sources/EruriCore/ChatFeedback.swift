import Foundation

/// 채팅 답 아래 아이콘 막대(스펙 §9, 0.8.3): 복사 · 👍 · 👎. 👍👎는 검색 평가 라벨(eval_judgments, 0018 — 항목 단위)을 서버 변경 없이 답 단위로 묶는다.
/// 👍 = 이 답의 인용 항목 전부 관련 있음, 👎 = 시트에서 항목별 관련 있음/없음을 골라 저장(닫기만 하면 기록 없음)
public enum ChatFeedback {
  public enum Verdict: Equatable, Sendable { case up, down }

  /// judged 사전 키. 같은 인용을 다시 누르면 서버가 merge-duplicates 로 바꾼다
  public static func key(answer: String, item: String) -> String { "\(answer)|\(item)" }

  /// 👍👎를 보일지 — 인용이 없는 답(거절)은 평가할 항목이 없어 복사만 남긴다
  public static func showsJudge(citationCount: Int) -> Bool { citationCount > 0 }

  /// 막대 표시 상태: 인용 중 하나라도 관련 없음이면 👎, 전부 관련 있음이면 👍, 아직 다 고르지 않았으면 nil
  public static func verdict(answer: String, items: [String], judged: [String: Bool]) -> Verdict? {
    let marks = items.map { judged[key(answer: answer, item: $0)] }
    if marks.contains(false) { return .down }
    if !marks.isEmpty, marks.allSatisfy({ $0 == true }) { return .up }
    return nil
  }

  /// 👍: 인용 항목 전부 관련 있음
  public static func upMarks(items: [String]) -> [String: Bool] {
    Dictionary(items.map { ($0, true) }, uniquingKeysWith: { a, _ in a })
  }

  /// 👎 시트의 첫 토글 값: 이미 고른 값, 없으면 관련 없음(👎를 누른 뜻)
  public static func sheetDefaults(answer: String, items: [String], judged: [String: Bool]) -> [String: Bool] {
    Dictionary(items.map { ($0, judged[key(answer: answer, item: $0)] ?? false) }, uniquingKeysWith: { a, _ in a })
  }
}

/// 채팅 입력창의 하드웨어 키보드 Return(스펙 §9, 0.8.3). 화면 키보드는 이 경로를 타지 않는다(onKeyPress 는 하드웨어 키만 받는다)
public enum ChatInput {
  public enum ReturnAction: Equatable, Sendable {
    case commit    // 한글 조합 중: 조합만 확정한다 — 조합 중 보내면 마지막 글자가 빠지거나 빈 칸에 다시 붙는다
    case newline   // Shift+Return: 커서 자리에 줄바꿈
    case send
    case ignore    // 비었거나 보내는 중: 아무것도 하지 않는다(포커스도 그대로)
  }

  public static func onReturn(shift: Bool, composing: Bool, canSend: Bool) -> ReturnAction {
    if composing { return .commit }
    if shift { return .newline }
    return canSend ? .send : .ignore
  }
}
