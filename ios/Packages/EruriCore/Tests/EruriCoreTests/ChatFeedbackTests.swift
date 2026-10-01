import XCTest
@testable import EruriCore

/// 답 아래 아이콘 막대(§9, 0.8.3): 👍👎 상태·시트 기본값, 하드웨어 Return 분기
final class ChatFeedbackTests: XCTestCase {
  private let a = "answer-1"
  private let items = ["i1", "i2"]

  func testKey() { XCTAssertEqual(ChatFeedback.key(answer: "a", item: "b"), "a|b") }

  /// 거절(인용 0)이면 👍👎 없이 복사만
  func testShowsJudgeOnlyWithCitations() {
    XCTAssertFalse(ChatFeedback.showsJudge(citationCount: 0))
    XCTAssertTrue(ChatFeedback.showsJudge(citationCount: 1))
  }

  func testVerdict() {
    let k1 = ChatFeedback.key(answer: a, item: "i1"), k2 = ChatFeedback.key(answer: a, item: "i2")
    XCTAssertNil(ChatFeedback.verdict(answer: a, items: items, judged: [:]))
    XCTAssertNil(ChatFeedback.verdict(answer: a, items: items, judged: [k1: true]))           // 하나만 골랐으면 아직 없음
    XCTAssertEqual(ChatFeedback.verdict(answer: a, items: items, judged: [k1: true, k2: true]), .up)
    XCTAssertEqual(ChatFeedback.verdict(answer: a, items: items, judged: [k1: true, k2: false]), .down)
    XCTAssertEqual(ChatFeedback.verdict(answer: a, items: items, judged: [k2: false]), .down)    // 하나라도 관련 없음이면 👎
    XCTAssertNil(ChatFeedback.verdict(answer: a, items: [], judged: [:]))
    XCTAssertNil(ChatFeedback.verdict(answer: "other", items: items, judged: [k1: true, k2: true]))   // 다른 답의 기록은 섞이지 않는다
  }

  func testUpMarksAllRelevant() {
    XCTAssertEqual(ChatFeedback.upMarks(items: items), ["i1": true, "i2": true])
    XCTAssertEqual(ChatFeedback.upMarks(items: ["i1", "i1"]), ["i1": true])
  }

  /// 👎 시트는 이미 고른 값을 보이고, 처음이면 관련 없음으로 시작한다
  func testSheetDefaults() {
    XCTAssertEqual(ChatFeedback.sheetDefaults(answer: a, items: items, judged: [:]), ["i1": false, "i2": false])
    XCTAssertEqual(ChatFeedback.sheetDefaults(answer: a, items: items, judged: [ChatFeedback.key(answer: a, item: "i1"): true]),
                   ["i1": true, "i2": false])
  }

  /// 하드웨어 Return: 조합 중이면 확정만, Shift 는 줄바꿈, 그 밖은 보낼 수 있을 때만 보내기
  func testReturnKey() {
    XCTAssertEqual(ChatInput.onReturn(shift: false, composing: true, canSend: true), .commit)
    XCTAssertEqual(ChatInput.onReturn(shift: true, composing: true, canSend: true), .commit)
    XCTAssertEqual(ChatInput.onReturn(shift: true, composing: false, canSend: true), .newline)
    XCTAssertEqual(ChatInput.onReturn(shift: true, composing: false, canSend: false), .newline)
    XCTAssertEqual(ChatInput.onReturn(shift: false, composing: false, canSend: true), .send)
    XCTAssertEqual(ChatInput.onReturn(shift: false, composing: false, canSend: false), .ignore)
  }
}
