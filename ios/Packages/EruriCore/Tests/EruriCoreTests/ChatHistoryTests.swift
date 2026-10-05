import XCTest
@testable import EruriCore

final class ChatHistoryTests: XCTestCase {
  typealias R = ChatHistory.Record
  let t0 = Date(timeIntervalSince1970: 1_790_000_000)

  func reply(_ answer: String, refused: Bool = false, id: String = "a1", items: [String] = ["i1"], proposals: String = "[]") -> Data {
    let cites = items.map { #"{"item_id":"\#($0)","source":"SHARE","app_name":null,"title":"합성","occurred_at":"2026-10-01T00:00:00Z","expired":false}"# }
    return Data(#"{"answer_id":"\#(id)","answer":"\#(answer)","refused":\#(refused),"citations":[\#(cites.joined(separator: ","))],"proposals":\#(proposals),"candidates":["i1"],"schedule":null}"#.utf8)
  }
  func q(_ s: String, at: TimeInterval, answer: String? = "답", refused: Bool = false) -> R {
    R(at: t0.addingTimeInterval(at), kind: .question, question: s, reply: answer.map { reply($0, refused: refused) })
  }

  // ── 30일·상한·복원 ──
  func testPruneDropsOlderThan30Days() {
    let r = [q("old", at: -30 * 86_400 - 1), q("edge", at: -30 * 86_400 + 1), q("new", at: 0)]
    XCTAssertEqual(ChatHistory.prune(r, now: t0).map(\.question), ["edge", "new"])
  }
  func testPruneCapsRecords() {
    let r = (0..<510).map { q("q\($0)", at: Double($0)) }
    let kept = ChatHistory.prune(r, now: t0.addingTimeInterval(600))
    XCTAssertEqual(kept.count, ChatHistory.maxRecords)
    XCTAssertEqual(kept.first?.question, "q10")
  }
  func testRestoredEndsUnfinishedTurns() {
    let pending = R(at: t0, kind: .question, question: "답 전에 닫힘")
    let failed = R(at: t0, kind: .question, question: "실패", error: "연결 실패")
    let link = R(at: t0, kind: .link, question: "https://x.test", link: LinkCaptureText.reading)
    let photo = R(at: t0, kind: .image, question: "사진 1장", link: "사진에서 글 10자를 읽었어요. 일정을 찾는 중…", linkSaved: true)
    let doneLink = R(at: t0, kind: .link, question: "https://y.test", link: "끝", linkDone: true)
    let broken = R(at: t0, kind: .question, question: "손상", reply: Data("{".utf8))   // 형식 변경·손상 — 영원히 진행 표시가 되지 않게
    let out = ChatHistory.restored([pending, failed, link, photo, doneLink, q("답 받음", at: 0), broken])
    XCTAssertEqual(out[0].error, ChatHistoryText.interruptedAnswer)
    XCTAssertEqual(out[1].error, "연결 실패")
    XCTAssertEqual([out[2].link, out[3].link], [ChatHistoryText.interruptedLink, ChatHistoryText.interruptedLink])
    XCTAssertTrue(out[2].linkDone && out[3].linkDone && out[3].linkSaved)
    XCTAssertEqual(out[4], doneLink)
    XCTAssertNil(out[5].error)
    XCTAssertEqual(out[6].error, ChatHistoryText.unreadableReply)
  }

  // ── 맥락 구간·구분선 ──
  func testContextTakesLastThreeAnsweredQuestionsOldestFirst() {
    let r = (0..<5).map { q("q\($0)", at: Double($0) * 60) }
    XCTAssertEqual(ChatHistory.context(r, now: t0.addingTimeInterval(300)).map(\.question), ["q2", "q3", "q4"])
  }
  func testExactly30MinutesContinues_OneSecondMoreBreaks() {
    let r = [q("a", at: 0), q("b", at: 1_800)]
    XCTAssertEqual(ChatHistory.context(r, now: t0.addingTimeInterval(3_600)).map(\.question), ["a", "b"])
    XCTAssertEqual(ChatHistory.context(r, now: t0.addingTimeInterval(3_601)), [])
    let gap = [q("a", at: 0), q("b", at: 1_801)]
    XCTAssertEqual(ChatHistory.context(gap, now: t0.addingTimeInterval(1_802)).map(\.question), ["b"])
    XCTAssertFalse(ChatHistory.isBreak(previous: nil, current: t0))
    XCTAssertFalse(ChatHistory.isBreak(previous: t0, current: t0.addingTimeInterval(1_800)))
    XCTAssertTrue(ChatHistory.isBreak(previous: t0, current: t0.addingTimeInterval(1_801)))
  }
  func testLinkAndErrorTurnsKeepTheSegmentButAreNotContext() {
    let link = R(at: t0.addingTimeInterval(1_500), kind: .link, question: "https://x.test", link: "끝", linkDone: true)
    let err = R(at: t0.addingTimeInterval(2_900), kind: .question, question: "실패", error: "연결 실패")
    let r = [q("a", at: 0), link, err, q("b", at: 4_000)]       // a→link 25분, link→err 23분, err→b 18분: 한 구간
    XCTAssertEqual(ChatHistory.context(r, now: t0.addingTimeInterval(4_100)).map(\.question), ["a", "b"])
  }
  func testRefusedAnswersAreContextWithRefusalText() {
    let r = [q("없는 것", at: 0, answer: "저장된 정보에서 확인되지 않음", refused: true)]
    XCTAssertEqual(ChatHistory.context(r, now: t0.addingTimeInterval(10)).first?.answer, "저장된 정보에서 확인되지 않음")
  }
  func testFutureTimestampsDoNotCrashAndStayInContext() {
    let r = [q("a", at: 120)]
    XCTAssertEqual(ChatHistory.context(r, now: t0).map(\.question), ["a"])
  }
  func testEmptyHistoryHasNoContext() {
    XCTAssertEqual(ChatHistory.context([], now: t0), [])
    XCTAssertNil(ChatHistory.segmentStart([], now: t0))
  }

  // ── 답 요약 ──
  func testSummaryAddsEventLinesFromProposals() throws {
    let p = #"[{"id":"p1","item_id":"i1","action":"create_event","status":"proposed","payload":{"title":"합성치과","start":"2026-10-13T15:00:00+09:00","location":"합성빌딩 2층"}},{"id":"p2","item_id":"i1","action":"create_task","status":"proposed","payload":{"title":"합성할일"}}]"#
    let a = try XCTUnwrap(ChatReply.decode(reply("10월 13일 오후 3시예요.", proposals: p)))
    XCTAssertEqual(ChatHistory.summary(a), "10월 13일 오후 3시예요.\n일정: 합성치과 · 2026-10-13T15:00:00+09:00 · 합성빌딩 2층")
  }
  func testSummaryClipsByUTF16() throws {
    let a = try XCTUnwrap(ChatReply.decode(reply(String(repeating: "😀", count: 300))))
    let s = ChatHistory.summary(a)
    XCTAssertLessThanOrEqual(s.utf16.count, ChatHistory.contextAnswerMax)
    XCTAssertEqual(s.utf16.count, 400)
    XCTAssertEqual(ChatHistory.clip16("가나다", max: 2), "가나")
    XCTAssertEqual(ChatHistory.clip16("😀😀", max: 3), "😀")
  }
  func testContextJSON() {
    XCTAssertEqual(ChatHistory.ContextTurn(question: "q", answer: "a").json, ["question": "q", "answer": "a"])
  }

  // ── 맞아요·틀렸어요 복원 ──
  func testJudgedMarksRebuildFeedbackKeys() {
    var r = q("a", at: 0)
    r.judged = ["i1": true]
    XCTAssertEqual(ChatHistory.judgedMarks([r, q("b", at: 1)]), [ChatFeedback.key(answer: "a1", item: "i1"): true])
  }

  // ── 문구(후보 B) ──
  func testNoticeCopy() {
    XCTAssertEqual(ChatHistoryText.emptyLines.count, 3)
    XCTAssertTrue(ChatHistoryText.emptyLines[0].contains("이 iPhone에만") && ChatHistoryText.emptyLines[0].contains("30일"))
    XCTAssertTrue(ChatHistoryText.emptyLines[1].contains("3개") && ChatHistoryText.emptyLines[1].contains("30분"))
    XCTAssertTrue(ChatHistoryText.emptyLines[2].contains("ERURI 서버에 남기지 않아요"))
    XCTAssertTrue(ChatHistoryText.topNote.contains("30일"))
    XCTAssertTrue(ChatHistoryText.newConversation.contains("30분"))
  }

  // ── 파일 ──
  func tempStore() -> ChatHistoryStore {
    ChatHistoryStore(url: FileManager.default.temporaryDirectory.appendingPathComponent("chat-\(UUID().uuidString)", isDirectory: true)
      .appendingPathComponent("chat-history.json"))
  }
  func testStoreRoundTripsRecordsAndReplyBytes() throws {
    let s = tempStore(); defer { s.wipe() }
    var r = q("a", at: 0); r.judged = ["i1": false]
    let link = R(at: t0, kind: .link, question: "https://x.test", link: "끝", linkDone: true, linkSaved: true, seenItemID: "item-9")
    try s.save([r, link])
    XCTAssertEqual(s.load(), [r, link])
  }
  func testStoreLoadOfMissingOrBrokenFileIsEmpty() throws {
    let s = tempStore(); defer { s.wipe() }
    XCTAssertEqual(s.load(), [])
    try FileManager.default.createDirectory(at: s.url.deletingLastPathComponent(), withIntermediateDirectories: true)
    try Data("{".utf8).write(to: s.url)
    XCTAssertEqual(s.load(), [])
    try Data(#"{"version":2,"records":[]}"#.utf8).write(to: s.url)
    XCTAssertEqual(s.load(), [])
  }
  func testSaveExcludesFromBackup() throws {
    let s = tempStore(); defer { s.wipe() }
    try s.save([q("a", at: 0)])
    try s.save([q("b", at: 1)])                                  // atomic 교체 뒤에도
    let v = try s.url.deletingLastPathComponent().resourceValues(forKeys: [.isExcludedFromBackupKey])   // 디렉터리에 건다(D2)
    XCTAssertEqual(v.isExcludedFromBackup, true)
  }
  func testSaveFailsClosedWhenDirectoryCannotBeMade() throws {
    let s = tempStore()
    let dir = s.url.deletingLastPathComponent()
    try Data("x".utf8).write(to: dir)                            // 디렉터리 자리에 파일 → createDirectory 실패
    defer { try? FileManager.default.removeItem(at: dir) }
    XCTAssertThrowsError(try s.save([q("a", at: 0)]))
    XCTAssertFalse(FileManager.default.fileExists(atPath: s.url.path))   // 제외되지 않은 기록 파일을 남기지 않는다
  }
  func testWipeRemovesFile() throws {
    let s = tempStore()
    try s.save([q("a", at: 0)])
    s.wipe()
    XCTAssertFalse(FileManager.default.fileExists(atPath: s.url.path))
  }
  func testDefaultURLIsAppOnlyApplicationSupport() throws {
    let u = try ChatHistoryStore.defaultURL()
    XCTAssertEqual(u.lastPathComponent, "chat-history.json")
    XCTAssertEqual(u.deletingLastPathComponent().lastPathComponent, "chat")   // 백업 제외를 거는 전용 디렉터리
    XCTAssertTrue(u.path.contains("Application Support"))
    if let group = try? AppGroup.containerURL() { XCTAssertFalse(u.path.hasPrefix(group.path)) }
  }

  // ── 순서 보장 쓰기 ──
  func testWriterIgnoresStaleSnapshotAfterWipe() async throws {
    let s = tempStore(); defer { s.wipe() }
    let w = ChatHistoryWriter()
    await w.apply([q("a", at: 0)], gen: 1, store: s)
    await w.apply(nil, gen: 3, store: s)                         // 지우기(나중 세대)
    await w.apply([q("a", at: 0), q("b", at: 1)], gen: 2, store: s)   // 늦게 도착한 옛 스냅샷
    XCTAssertFalse(FileManager.default.fileExists(atPath: s.url.path))
    await w.apply([q("c", at: 2)], gen: 4, store: s)
    XCTAssertEqual(s.load().map(\.question), ["c"])
  }
}
