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

  // ── 문구(후보 B) — 스펙 §9 "대화 기록·짧은 맥락" 문장 그대로 ──
  func testNoticeCopy() {
    XCTAssertEqual(ChatHistoryText.emptyLines, [
      "대화는 이 iPhone에만 저장되고, 30일이 지나면 자동으로 지워져요.",
      "바로 앞 질문 3개까지 이어서 이해해요 — \"그 일정 몇 시야?\"처럼 물어보세요. 30분 동안 묻지 않으면 새 대화로 시작해요.",
      "이어 묻기 위해 바로 앞 질문과 답의 일부를 질문과 함께 보내요. 답을 만드는 데만 쓰고 ERURI 서버에 남기지 않아요.",
    ])
    XCTAssertEqual(ChatHistoryText.topNote, "대화 기록은 이 iPhone에만 · 30일 뒤 자동 삭제 · 설정에서 지울 수 있어요")
    XCTAssertEqual(ChatHistoryText.newConversation, "30분이 지나 여기부터 새 대화예요")
    XCTAssertEqual(ChatHistoryText.settingsTitle, "대화 기록 지우기")
    XCTAssertEqual(ChatHistoryText.settingsNote, "대화 기록은 이 iPhone에만 있고 30일이 지나면 자동으로 지워져요. 지우면 되돌릴 수 없어요.")
    XCTAssertEqual(ChatHistoryText.clearConfirm, "이 iPhone의 대화 기록을 모두 지울까요?")
    XCTAssertEqual(ChatHistoryText.interruptedAnswer, "답을 받기 전에 앱이 닫혔어요. 다시 물어봐 주세요.")
    XCTAssertEqual(ChatHistoryText.interruptedLink, "앱이 닫혀 결과를 확인하지 못했어요 — '제안' 탭과 알림에서 확인하세요.")
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
    XCTAssertEqual(try s.load(), [r, link])
  }
  func testStoreLoadOfMissingOrBrokenFileIsEmpty() throws {
    let s = tempStore(); defer { s.wipe() }
    XCTAssertEqual(try s.load(), [])
    try FileManager.default.createDirectory(at: s.url.deletingLastPathComponent(), withIntermediateDirectories: true)
    try Data("{".utf8).write(to: s.url)
    XCTAssertEqual(try s.load(), [])
    try Data(#"{"version":2,"records":[]}"#.utf8).write(to: s.url)
    XCTAssertEqual(try s.load(), [])
  }
  // 잠금 중(completeUnlessOpen)·권한·IO 오류는 "빈 기록"이 아니다 — 빈 배열로 돌려주면 정리 저장이 원본을 덮는다(H3 리뷰 Important 1)
  func testStoreLoadThrowsWhenFileIsUnreadable() throws {
    let s = tempStore()
    try s.save([q("a", at: 0)])
    try FileManager.default.setAttributes([.posixPermissions: 0o000], ofItemAtPath: s.url.path)
    defer { try? FileManager.default.setAttributes([.posixPermissions: 0o644], ofItemAtPath: s.url.path); s.wipe() }
    XCTAssertThrowsError(try s.load())
  }
  func testSaveUsesCompleteUnlessOpenProtection() throws {
    let s = tempStore(); defer { s.wipe() }
    try s.save([q("a", at: 0)])
    let p = try FileManager.default.attributesOfItem(atPath: s.url.path)[.protectionKey] as? FileProtectionType
    guard let p else { throw XCTSkip("시뮬레이터가 파일 보호 속성(protectionKey)을 돌려주지 않는다 — 데이터 보호는 실기기에서만 강제된다") }
    XCTAssertEqual(p, .completeUnlessOpen)
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
  func testRemoveDistinguishesAbsentFromFailed() throws {
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent("chat-\(UUID().uuidString)", isDirectory: true)
    let u = dir.appendingPathComponent("chat-history.json")
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    try Data("{}".utf8).write(to: u)
    XCTAssertEqual(ChatHistoryStore.remove(at: u), .removed)
    XCTAssertEqual(ChatHistoryStore.remove(at: u), .absent)
    try Data("{}".utf8).write(to: u)
    try FileManager.default.setAttributes([.posixPermissions: 0o555], ofItemAtPath: dir.path)   // 디렉터리 쓰기 금지 → 지우기 실패
    defer { try? FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: dir.path); try? FileManager.default.removeItem(at: dir) }
    guard case .failed = ChatHistoryStore.remove(at: u) else { return XCTFail("권한 오류는 failed 여야 한다") }
    XCTAssertTrue(FileManager.default.fileExists(atPath: u.path))
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
    XCTAssertEqual(try s.load().map(\.question), ["c"])
  }

  // ── 채팅 일정 등록 턴(0.13.0, 스펙 §9 "대화 기록") ──
  func testAddEventRecordRoundTripsAndOldFilesStillDecode() throws {
    var r = R(at: t0, kind: .question, question: "합성 치과 10/20 등록해줘")
    r.kind = .addEvent; r.link = "일정 1건을 찾았어요"; r.linkDone = true; r.itemID = "item-9"
    let e = JSONEncoder(); e.dateEncodingStrategy = .secondsSince1970
    let d = JSONDecoder(); d.dateDecodingStrategy = .secondsSince1970
    XCTAssertEqual(try d.decode(R.self, from: e.encode(r)), r)
    // 0.12.0 기록(itemID 키 없음)도 읽힌다
    let old = #"{"id":"\#(UUID().uuidString)","at":1790000000,"kind":"question","question":"q","linkDone":false,"linkSaved":false,"judged":{}}"#
    XCTAssertNil(try d.decode(R.self, from: Data(old.utf8)).itemID)
  }
  // 모르는 kind(새 버전 → 앞 버전으로 내림 — 0.14.0 부터 mailAction 은 아는 kind 라 가상의 다음 kind 로 본다)는 그 레코드만 빠지고 나머지 기록은 남는다. 아는 kind 의 깨진 레코드는 전처럼 빈 기록(최종 리뷰 Minor 3)
  func testStoreLoadDropsOnlyRecordsOfUnknownKind() throws {
    let s = tempStore(); defer { s.wipe() }
    let r = q("a", at: 0), add = R(at: t0, kind: .addEvent, question: "합성 등록해줘", link: "끝", linkDone: true, itemID: "item-9")
    try s.save([r, add])
    let raw = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: s.url)) as? [String: Any])
    var recs = try XCTUnwrap(raw["records"] as? [[String: Any]])
    var future = recs[0]; future["id"] = UUID().uuidString; future["kind"] = "futureTurn"
    recs.insert(future, at: 1)
    try JSONSerialization.data(withJSONObject: ["version": 1, "records": recs]).write(to: s.url)
    XCTAssertEqual(try s.load(), [r, add])
    var broken = recs[0]; broken["at"] = "어제"
    try JSONSerialization.data(withJSONObject: ["version": 1, "records": [broken] + recs]).write(to: s.url)
    XCTAssertEqual(try s.load(), [])
    try JSONSerialization.data(withJSONObject: ["version": 1, "records": [["id": UUID().uuidString, "at": 1, "question": "q"]]]).write(to: s.url)
    XCTAssertEqual(try s.load(), [])                                   // kind 가 없으면 손상
  }
  func testRestoredEndsUnfinishedAddEvent() {
    let r = R(at: t0, kind: .addEvent, question: "합성 등록해줘", link: ChatAddEventText.registering)
    var done = R(at: t0, kind: .addEvent, question: "합성 등록해줘 2", link: "일정 1건을 찾았어요", linkDone: true)
    done.itemID = "item-9"
    let out = ChatHistory.restored([r, done])
    XCTAssertEqual([out[0].link, out[1].link], [ChatHistoryText.interruptedLink, "일정 1건을 찾았어요"])
    XCTAssertEqual([out[0].linkDone, out[1].linkDone], [true, true])
    XCTAssertEqual(out[1].itemID, "item-9")
  }
  func testAddEventTurnsKeepSegmentButAreNotContext() {
    let a = q("합성치과 예약 언제야?", at: -1500)
    let add = R(at: t0.addingTimeInterval(-900), kind: .addEvent, question: "그 약속 등록해줘", link: ChatAddEventText.noEvent, linkDone: true)
    let b = q("거기 주소는?", at: -60)
    // a(-25분)·add(-15분)·b(-1분): add 가 없으면 a↔b 는 24분이라 어차피 이어지지만, add 를 끼워도 맥락은 질문 턴 둘뿐
    XCTAssertEqual(ChatHistory.context([a, add, b], now: t0).map(\.question), ["합성치과 예약 언제야?", "거기 주소는?"])
    // add 가 다리 역할: a(-50분)·add(-25분)·지금 질문 → 구간 시작은 a(각 간격 ≤ 30분)
    let far = q("합성세미나 언제야?", at: -3000), mid = R(at: t0.addingTimeInterval(-1500), kind: .addEvent, question: "그거 등록해줘", linkDone: true)
    XCTAssertEqual(ChatHistory.segmentStart([far, mid], now: t0), 0)
    XCTAssertEqual(ChatHistory.context([far, mid], now: t0).map(\.question), ["합성세미나 언제야?"])
  }
  func testGmailDeleteNote() {
    XCTAssertEqual(ChatHistoryText.gmailDeleteNote, "채팅 기록은 설정 › 채팅에서 따로 지워요")
  }

  // ── 메일 정리 턴(0.14.0) ──
  func testRestoredEndsMailTurnsStillFinding_RunningStays() {
    let finding = R(at: t0, kind: .mailAction, question: "합성상점 광고 지워줘", mail: MailTurn(phase: .finding))
    let running = R(at: t0, kind: .mailAction, question: "합성 메일 읽음 처리해줘", mail: MailTurn(phase: .running))
    let none = R(at: t0, kind: .mailAction, question: "합성", mail: nil)
    let out = ChatHistory.restored([finding, running, none])
    XCTAssertEqual(out.map { $0.mail?.phase }, [MailTurn.Phase.ended, .running, .ended] as [MailTurn.Phase?])
    XCTAssertEqual([out[0].mail?.note, out[2].mail?.note], [MailCleanupText.interrupted, MailCleanupText.interrupted] as [String?])
  }

  func testMailTurnsKeepTheSegmentButAreNotContext() {
    let mailTurn = R(at: t0.addingTimeInterval(-300), kind: .mailAction, question: "합성상점 광고 지워줘", mail: MailTurn(phase: .ended))
    let r = [q("첫 질문", at: -600), mailTurn, q("둘째 질문", at: -60)]
    XCTAssertEqual(ChatHistory.context(r, now: t0).map(\.question), ["첫 질문", "둘째 질문"])
    XCTAssertEqual(ChatHistory.segmentStart(r, now: t0), 0)
    // 메일 턴이 다리 역할(리뷰 Minor 6): far(-50분)·mail(-25분)·지금 → 구간 시작은 far(각 간격 ≤ 30분), 맥락은 질문 턴만
    let far = q("합성세미나 언제야?", at: -3000)
    let mid = R(at: t0.addingTimeInterval(-1500), kind: .mailAction, question: "합성상점 광고 지워줘", mail: MailTurn(phase: .ended))
    XCTAssertNil(ChatHistory.segmentStart([far], now: t0))
    XCTAssertEqual(ChatHistory.segmentStart([far, mid], now: t0), 0)
    XCTAssertEqual(ChatHistory.context([far, mid], now: t0).map(\.question), ["합성세미나 언제야?"])
  }

  func testRestoredKeepsPreviewAndEndedMailTurns() {
    let pv = MailTurn(phase: .preview, previewAt: t0)
    let ended = MailTurn(phase: .ended, note: MailCleanupText.cancelled)
    let out = ChatHistory.restored([R(at: t0, kind: .mailAction, question: "a", mail: pv), R(at: t0, kind: .mailAction, question: "b", mail: ended)])
    XCTAssertEqual(out.map(\.mail), [pv, ended])
  }

  func testStoreLoadKeepsHistoryWhenAMailTurnHasAnUnknownPhase() throws {
    // 다음 버전의 Phase 값(리뷰 Minor 5): 그 턴은 끝난 턴으로, 나머지 기록은 그대로
    let s = tempStore(); defer { s.wipe() }
    let a = q("a", at: 0), m = R(at: t0, kind: .mailAction, question: "합성", mail: MailTurn(phase: .running))
    try s.save([a, m])
    let raw = try XCTUnwrap(String(data: Data(contentsOf: s.url), encoding: .utf8))
    XCTAssertTrue(raw.contains(#""phase":"running""#))
    try Data(raw.replacingOccurrences(of: #""phase":"running""#, with: #""phase":"verifying""#).utf8).write(to: s.url)
    let out = try s.load()
    XCTAssertEqual(out.map(\.question), ["a", "합성"])
    XCTAssertEqual(out.last?.mail?.phase, .ended)
  }

  func testStoreRoundTripsMailTurns_OldRecordsWithoutMailStillLoad() throws {
    let s = tempStore(); defer { s.wipe() }
    let pv = MailCleanup.preview(Data(#"{"token":"t","action":"trash","conditions":{"action":"trash","sender":"합성상점","subject_words":[],"received_from":null,"received_to":null,"promotions":true,"unread_only":false},"count":1,"exact":true,"total_estimate":1,"starred_estimate":0,"has_more":false,"sample":[{"from":"합성상점","subject":"합성","date":"2026-10-01T00:00:00Z"}]}"#.utf8))
    let m = R(at: t0, kind: .mailAction, question: "합성", mail: MailTurn(phase: .preview, preview: pv, previewAt: t0))
    let a = q("a", at: 0)
    try s.save([a, m])
    XCTAssertEqual(try s.load(), [a, m])
    // 0.13.0 파일(mail 키 없음)
    try Data(#"{"version":1,"records":[{"id":"6F1C2A3B-0000-4000-8000-000000000001","at":1790000000,"kind":"question","question":"q","linkDone":false,"linkSaved":false,"judged":{}}]}"#.utf8).write(to: s.url)
    XCTAssertNil(try s.load().first?.mail)
  }

  func testRestoredEndsMailSummarySearchOrRead_ChoosingStays() {
    let f = ChatHistory.Record(at: t0, kind: .mailSummary, question: "합성 메일 요약해줘", mailRead: MailSummaryTurn(phase: .finding))
    let rd = ChatHistory.Record(at: t0, kind: .mailSummary, question: "b", mailRead: MailSummaryTurn(phase: .reading))
    var ch = MailSummaryTurn(phase: .choosing); ch.issuedAt = t0
    let c = ChatHistory.Record(at: t0, kind: .mailSummary, question: "c", mailRead: ch)
    let none = ChatHistory.Record(at: t0, kind: .mailSummary, question: "d")
    let out = ChatHistory.restored([f, rd, c, none])
    XCTAssertEqual(out.map { $0.mailRead?.phase }, [.ended, .ended, .choosing, .ended] as [MailSummaryTurn.Phase?])
    XCTAssertEqual(out.map { $0.mailRead?.note }, [MailSummaryText.interrupted, MailSummaryText.interrupted, nil, MailSummaryText.interrupted])
    XCTAssertEqual(MailSummaryText.interrupted, "앱이 닫혀 메일을 읽지 못했어요 — 다시 요청해 주세요.")
  }

  // 스펙 §9 "대화 기록": 요약 턴은 맥락으로 보내지 않고 구간은 잇는다
  func testMailSummaryTurnsKeepTheSegmentButAreNotContext() {
    let s = ChatHistory.Record(at: t0.addingTimeInterval(-300), kind: .mailSummary, question: "합성학원 메일 요약해줘", mailRead: MailSummaryTurn(phase: .ended))
    let r = [q("합성은행에서 온 메일 뭐 있어?", at: -600), s, q("둘째 질문", at: -60)]
    XCTAssertEqual(ChatHistory.context(r, now: t0).map(\.question), ["합성은행에서 온 메일 뭐 있어?", "둘째 질문"])
    XCTAssertEqual(ChatHistory.segmentStart(r, now: t0), 0)
  }

  func testStoreRoundTripsMailSummaryTurns() throws {
    let st = tempStore(); defer { st.wipe() }
    var t = MailSummaryTurn(phase: .ended, translate: true); t.readAt = t0; t.note = nil
    let a = ChatHistory.Record(at: t0, kind: .mailSummary, question: "합성", mailRead: t)
    try st.save([q("x", at: 0), a])
    XCTAssertEqual(try st.load().map(\.mailRead), [nil, t])
  }

  // ── 0.16.0 채팅 일정 개선(스펙 §9 A·B 앱 → 서버) ──
  func addTurn(at: TimeInterval, ids: [String]? = ["p1"], line: String? = "등록함: 합성 미팅 · 10/10(토) 11:00–15:00") -> R {
    R(at: t0.addingTimeInterval(at), kind: .addEvent, question: "모레 11-15시 합성 미팅 등록해줘", link: "일정 1건을 찾았어요", linkDone: true,
      itemID: "i1", proposalIDs: ids, contextLine: line)
  }
  func editTurn(at: TimeInterval, status: String = "ok", pid: String = "p2", line: String? = "고침: 합성 미팅 · 10/9(금) 11:00–15:00",
                editPid: String? = nil) -> R {
    let json = #"{"answer_id":"e","answer":"","refused":false,"citations":[],"proposals":[],"intent":"edit_event","edit":{"status":"\#(status)","proposal_id":"\#(pid)","action":"create_event","before":null,"after":null}}"#
    return R(at: t0.addingTimeInterval(at), kind: .editEvent, question: "앗 내일이야", reply: Data(json.utf8), contextLine: line, editPid: editPid)
  }
  func testEditKindAndNewFieldsRoundTripAndOldFilesStillLoad() throws {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathComponent("chat-history.json")
    let s = ChatHistoryStore(url: url)
    try s.save([addTurn(at: 0), editTurn(at: 60, editPid: "p3")])
    let back = try s.load()
    XCTAssertEqual(back.map(\.kind), [.addEvent, .editEvent])
    XCTAssertEqual(back[0].proposalIDs, ["p1"]); XCTAssertEqual(back[1].contextLine, "고침: 합성 미팅 · 10/9(금) 11:00–15:00")
    XCTAssertEqual(back[1].editPid, "p3"); XCTAssertNil(back[0].editPid)
    // 0.15.x 가 쓴 레코드(새 칸 없음)도 그대로 읽는다
    let old = Data(#"{"version":1,"records":[{"id":"\#(UUID().uuidString)","at":1790000000,"kind":"addEvent","question":"q","linkDone":true,"linkSaved":false,"judged":{}}]}"#.utf8)
    try old.write(to: url)
    XCTAssertEqual(try s.load().first?.proposalIDs, nil)
  }
  func testContextIncludesRegistrationAndOkEditTurns() {
    let r = [q("앞 질문", at: 0), addTurn(at: 60), editTurn(at: 120), editTurn(at: 180, status: "expired", line: nil),
             addTurn(at: 240, ids: nil, line: nil)]
    let c = ChatHistory.context(r, now: t0.addingTimeInterval(300))
    XCTAssertEqual(c.map(\.answer), ["답", "등록함: 합성 미팅 · 10/10(토) 11:00–15:00", "고침: 합성 미팅 · 10/9(금) 11:00–15:00"])
    XCTAssertEqual(c[1].question, "모레 11-15시 합성 미팅 등록해줘")
  }
  func testContextKeepsTheLatestThree() {
    let r = [q("q1", at: 0), addTurn(at: 60), q("q2", at: 120), editTurn(at: 180)]
    XCTAssertEqual(ChatHistory.context(r, now: t0.addingTimeInterval(200)).map(\.question), ["모레 11-15시 합성 미팅 등록해줘", "q2", "앗 내일이야"])
  }
  func testEditTargetIsTheLatestRegistrationWithin30Minutes() {
    XCTAssertEqual(ChatHistory.editTarget([addTurn(at: 0)], now: t0.addingTimeInterval(1800)), "p1")          // 정확히 30분은 된다
    XCTAssertNil(ChatHistory.editTarget([addTurn(at: 0)], now: t0.addingTimeInterval(1801)))
    XCTAssertEqual(ChatHistory.editTarget([addTurn(at: 0), editTurn(at: 600), q("q", at: 900)], now: t0.addingTimeInterval(1000)), "p1")   // 고친 뒤에도 등록 턴의 첫 id
    XCTAssertNil(ChatHistory.editTarget([addTurn(at: 0), addTurn(at: 60, ids: nil, line: nil)], now: t0.addingTimeInterval(120)))           // 가장 최근 등록 턴만(앞 턴은 대상 아님)
    XCTAssertEqual(ChatHistory.editTarget([addTurn(at: 0, ids: ["m1", "m2"])], now: t0.addingTimeInterval(60)), "m1")                       // 다건도 보낸다(서버가 multi)
    XCTAssertNil(ChatHistory.editTarget([q("q", at: 0)], now: t0.addingTimeInterval(60)))
  }
  func testRewriteContextChangesTheLatestTurnOfThatFact() throws {
    let multi = addTurn(at: 0, ids: ["m1", "p1"], line: "등록함: 합성 저녁 · 10/10(토) 종일\n등록함: 합성 미팅 · 10/14(수) 06:00")
    let a = try XCTUnwrap(ChatHistory.rewriteContext([multi], factVersions: ["p1", "p3"], line: "합성 미팅 · 10/14(수) 18:00"))
    XCTAssertEqual(a[0].contextLine, "등록함: 합성 저녁 · 10/10(토) 종일\n등록함: 합성 미팅 · 10/14(수) 18:00")
    let b = try XCTUnwrap(ChatHistory.rewriteContext([addTurn(at: 0), editTurn(at: 60, pid: "p2")], factVersions: ["p1", "p2", "p3"], line: "합성 미팅 · 10/9(금) 18:00"))
    XCTAssertEqual(b.map(\.contextLine), ["등록함: 합성 미팅 · 10/10(토) 11:00–15:00", "고침: 합성 미팅 · 10/9(금) 18:00"])
    XCTAssertNil(ChatHistory.rewriteContext([addTurn(at: 0)], factVersions: ["zz"], line: "x"))
  }
  func testRestoredLeavesAnsweredEditTurns() {
    XCTAssertNil(ChatHistory.restored([editTurn(at: 0)])[0].error)
  }
  /// 고치기 카드가 따라가는 제안(Codex 플랜 리뷰 H2·Fable #1): 같은 카드의 되묻기 성공이 만든 새 버전(editPid)이 응답의 proposal_id 보다 먼저
  func testEditSubjectFollowsTheAskBackVersion() throws {
    XCTAssertEqual(ChatHistory.editSubject(editTurn(at: 0, pid: "p2")), "p2")                    // 옛 기록(editPid 없음) — 응답 그대로
    XCTAssertEqual(ChatHistory.editSubject(editTurn(at: 0, pid: "p2", editPid: "p3")), "p3")
    XCTAssertNil(ChatHistory.editSubject(addTurn(at: 0)))
    let b = try XCTUnwrap(ChatHistory.rewriteContext([addTurn(at: 0), editTurn(at: 60, pid: "p2", editPid: "p3")], factVersions: ["p1", "p3"],
                                                     line: "합성 미팅 · 10/9(금) 18:00"))
    XCTAssertEqual(b[1].contextLine, "고침: 합성 미팅 · 10/9(금) 18:00")
  }

  // ── 0.17.0 집계 질문·저장 규칙 턴(스펙 §9 "대화 기록", K10·K16·K23) ──
  let conds = #"{"keywords":["합성PAY"],"sender":null,"sources":["MESSAGES"],"from":"2026-10-15","to":"2026-10-21","bucket":"hour","defaulted":true,"clamped":false}"#
  func aggReply(status: String = "ok", sentence: String = "합성PAY 메시지는 7일 동안 3건이에요", conditions: Bool = true) -> Data {
    let agg = #"{"status":"\#(status)","conditions":\#(conditions ? conds : "null"),"total":3,"buckets":[],"top":[],"sentence":"\#(sentence)","notes":["저장된 메시지만 셌어요."]}"#
    return Data(#"{"answer_id":"g","answer":"","refused":false,"citations":[],"proposals":[],"intent":"aggregate","aggregate":\#(agg),"save_rule":null}"#.utf8)
  }
  func aggTurn(at: TimeInterval, status: String = "ok", sentence: String = "합성PAY 메시지는 7일 동안 3건이에요", conditions: Bool = true) -> R {
    R(at: t0.addingTimeInterval(at), kind: .aggregate, question: "이번 주 합성PAY 몇 건이야?", reply: aggReply(status: status, sentence: sentence, conditions: conditions))
  }
  func ruleReply(status: String = "ok", matched: Int = 0, matches: String = "[]") -> Data {
    let rule = #"{"op":"add","status":"\#(status)","candidate":{"kind":"keyword","value":"합성PAY"},"matches":\#(matches),"rules":[],"matched":\#(matched),"limit":20}"#
    return Data(#"{"answer_id":"r","answer":"","refused":false,"citations":[],"proposals":[],"intent":"save_rule_add","aggregate":null,"save_rule":\#(rule)}"#.utf8)
  }
  func ruleTurn(at: TimeInterval, reply: Data? = nil, saveRule: SaveRuleTurn? = SaveRuleTurn()) -> R {
    R(at: t0.addingTimeInterval(at), kind: .saveRule, question: "앞으로 합성PAY 문자는 저장해", reply: reply ?? ruleReply(), saveRule: saveRule)
  }
  func expectedConditions() throws -> ChatAggregate.Conditions {
    try JSONDecoder().decode(ChatAggregate.Conditions.self, from: Data(conds.utf8))
  }
  func roundTrip(_ r: [R]) throws -> [R] {
    let s = tempStore(); defer { s.wipe() }
    try s.save(r); return ChatHistory.restored(try s.load())
  }

  func testOldFileWithoutNewKindsStillLoads() throws {
    let s = tempStore(); defer { s.wipe() }
    // 0.16.x 가 쓴 파일: saveRule 키 없음 + 이 앱도 모르는 다음 kind 하나
    let id1 = UUID().uuidString, id2 = UUID().uuidString
    let old = #"{"version":1,"records":[{"id":"\#(id1)","at":1790000000,"kind":"question","question":"q","linkDone":false,"linkSaved":false,"judged":{}},{"id":"\#(UUID().uuidString)","at":1790000001,"kind":"futureTurn","question":"x","linkDone":false,"linkSaved":false,"judged":{}},{"id":"\#(id2)","at":1790000002,"kind":"editEvent","question":"e","linkDone":false,"linkSaved":false,"judged":{}}]}"#
    try s.save([]); try Data(old.utf8).write(to: s.url)
    let back = try s.load()
    XCTAssertEqual(back.map(\.id.uuidString), [id1, id2])
    XCTAssertEqual(back.map(\.kind), [.question, .editEvent])
    XCTAssertEqual(back.map(\.saveRule), [nil, nil])
    // 새 kind 두 개는 이 앱이 읽는다
    let rec = [aggTurn(at: 0), ruleTurn(at: 60)]
    try s.save(rec)
    XCTAssertEqual(try s.load(), rec)
    XCTAssertEqual(ChatHistory.Kind.aggregate.rawValue, "aggregate"); XCTAssertEqual(ChatHistory.Kind.saveRule.rawValue, "saveRule")
  }
  func testAggregateTurnContextUsesSentenceOnlyWhenOk() {
    let long = String(repeating: "가", count: 450)
    let r = [q("앞 질문", at: 0), aggTurn(at: 60), aggTurn(at: 120, status: "bad_condition", sentence: ChatAggregate.Text.badCondition, conditions: false),
             aggTurn(at: 180, status: "failed", sentence: ChatAggregate.Text.failed)]
    let c = ChatHistory.context(r, now: t0.addingTimeInterval(200))
    XCTAssertEqual(c.map(\.answer), ["답", "합성PAY 메시지는 7일 동안 3건이에요"])          // 오류 문구는 맥락이 아니다(K10)
    XCTAssertEqual(c[1].question, "이번 주 합성PAY 몇 건이야?")
    // bad_condition·failed 턴도 구간은 잇는다: q(-50분)·bad(-25분)·지금 → 구간 시작 0
    let bridged = [q("합성 질문", at: -3000), aggTurn(at: -1500, status: "bad_condition", sentence: "x", conditions: false)]
    XCTAssertEqual(ChatHistory.context(bridged, now: t0).map(\.question), ["합성 질문"])
    // 문장은 UTF-16 400자로
    XCTAssertEqual(ChatHistory.context([aggTurn(at: 0, sentence: long)], now: t0.addingTimeInterval(10)).first?.answer.utf16.count, ChatHistory.contextAnswerMax)
    // 읽을 수 없는 응답·응답 없음은 넣지 않는다
    let broken = R(at: t0, kind: .aggregate, question: "깨짐", reply: Data("{}".utf8)), none = R(at: t0, kind: .aggregate, question: "없음")
    XCTAssertEqual(ChatHistory.context([broken, none], now: t0.addingTimeInterval(10)), [])
  }
  func testSaveRuleTurnNotInContextButKeepsSegment() {
    let far = q("합성세미나 언제야?", at: -3000), rule = ruleTurn(at: -1500)
    XCTAssertEqual(ChatHistory.segmentStart([far, rule], now: t0), 0)
    XCTAssertEqual(ChatHistory.context([far, rule], now: t0).map(\.question), ["합성세미나 언제야?"])
    XCTAssertEqual(ChatHistory.context([aggTurn(at: -100), ruleTurn(at: -50)], now: t0).map(\.question), ["이번 주 합성PAY 몇 건이야?"])
  }
  func testAggregateContextOnlyWhenLastIsOkAggregateWithin30Min() throws {
    let c = try expectedConditions()
    XCTAssertEqual(ChatHistory.aggregateContext([q("q", at: -60), aggTurn(at: 0)], now: t0.addingTimeInterval(1800)), c)   // 정확히 30분은 된다
    XCTAssertNil(ChatHistory.aggregateContext([aggTurn(at: 0)], now: t0.addingTimeInterval(1801)))
    XCTAssertNil(ChatHistory.aggregateContext([aggTurn(at: 0), ruleTurn(at: 60)], now: t0.addingTimeInterval(120)))        // 바로 앞이 저장 규칙 턴
    XCTAssertNil(ChatHistory.aggregateContext([aggTurn(at: 0), q("q", at: 60)], now: t0.addingTimeInterval(120)))           // 바로 앞이 질문 턴
    XCTAssertNil(ChatHistory.aggregateContext([aggTurn(at: 0, status: "bad_condition", conditions: false)], now: t0.addingTimeInterval(60)))
    XCTAssertNil(ChatHistory.aggregateContext([aggTurn(at: 0, status: "failed")], now: t0.addingTimeInterval(60)))          // failed 는 조건이 있어도 아니다
    XCTAssertNil(ChatHistory.aggregateContext([aggTurn(at: 0, conditions: false)], now: t0.addingTimeInterval(60)))         // ok 인데 조건 없음
    XCTAssertNil(ChatHistory.aggregateContext([], now: t0))
  }
  func testRestoredWorkingRuleButtonBecomesRetry() {
    var working = SaveRuleTurn(); working.phase = .working
    var done = SaveRuleTurn(); done.phase = .done; done.addStatus = "added"; done.note = "저장 규칙을 추가했어요 (1/20)"
    let out = ChatHistory.restored([ruleTurn(at: 0, saveRule: working), ruleTurn(at: 60, saveRule: done),
                                    R(at: t0, kind: .aggregate, question: "답 전에 닫힘"), aggTurn(at: 120)])
    XCTAssertEqual(out[0].saveRule?.phase, .idle); XCTAssertEqual(out[0].saveRule?.note, SaveRules.Text.buttonFailed)
    XCTAssertEqual(out[1].saveRule, done)
    XCTAssertEqual(out[2].error, ChatHistoryText.interruptedAnswer)                                  // 집계 턴 = 고치기 턴과 같은 처리
    XCTAssertNil(out[3].error)
  }
  /// K23(Codex 계획 리뷰 #2): 추가 성공 뒤 앱을 다시 열어도 [함께 저장]은 같은 규칙으로, 이미 눌렀으면 다시 나오지 않는다
  func testAddResultSurvivesRelaunchThenRestore() throws {
    var t = SaveRuleTurn(); t.phase = .done; t.addStatus = "added"; t.ruleID = "r-1"; t.addedCount = 3; t.matched = 2
    let rec = ruleTurn(at: 0, saveRule: t)
    let back = try roundTrip([rec])
    XCTAssertEqual(back, [rec])
    let resp = try XCTUnwrap(back[0].reply.flatMap { ChatReply.decode($0)?.save_rule })
    XCTAssertEqual(resp.status, "ok"); XCTAssertNil(SaveRules.restoreRuleID(resp))                 // 첫 응답에는 새 규칙 id 가 없다
    XCTAssertEqual(back[0].saveRule?.restoreRuleID(resp), "r-1")
    var pressed = back
    pressed[0].saveRule?.restoreStatus = "queued"; pressed[0].saveRule?.restored = 2
    let again = try roundTrip(pressed)
    XCTAssertEqual(again[0].saveRule?.restored, 2)
    XCTAssertNil(again[0].saveRule?.restoreRuleID(resp))                                              // 이미 누름
    // duplicate 버튼 결과도 그 규칙으로, 폐기분 0 이면 버튼 없음, 그 밖(limit)은 채팅 판정으로
    var dup = t; dup.addStatus = "duplicate"; dup.ruleID = "r-0"
    XCTAssertEqual(dup.restoreRuleID(resp), "r-0")
    var zero = t; zero.matched = 0
    XCTAssertNil(zero.restoreRuleID(resp))
    var limit = t; limit.addStatus = "limit"
    XCTAssertNil(limit.restoreRuleID(resp))
    // 아직 누르지 않은 채팅 판정 duplicate(폐기분 있음) = 기존 규칙 id
    let judged = try XCTUnwrap(ChatReply.decode(ruleReply(status: "duplicate", matched: 3,
      matches: #"[{"id":"r-9","kind":"keyword","value":"합성PAY","created_at":"2026-10-20T00:00:00Z"}]"#))?.save_rule)
    XCTAssertEqual(SaveRuleTurn().restoreRuleID(judged), "r-9")
  }
  func testSaveRuleTurnLenientDecode() throws {
    let d = JSONDecoder()
    var only = SaveRuleTurn(); only.phase = .done
    XCTAssertEqual(try d.decode(SaveRuleTurn.self, from: Data(#"{"phase":"done"}"#.utf8)), only)
    XCTAssertEqual(try d.decode(SaveRuleTurn.self, from: Data(#"{"phase":"weird","matched":1,"later":true}"#.utf8)).phase, .idle)
    let empty = try d.decode(SaveRuleTurn.self, from: Data("{}".utf8))
    XCTAssertEqual(empty, SaveRuleTurn())
    XCTAssertEqual([empty.matched, empty.removedIDs.count], [0, 0])
    // 모르는 phase 의 저장 규칙 턴이 있어도 기록 파일 전체가 비지 않는다
    let s = tempStore(); defer { s.wipe() }
    let file = #"{"version":1,"records":[{"id":"\#(UUID().uuidString)","at":1790000000,"kind":"saveRule","question":"q","linkDone":false,"linkSaved":false,"judged":{},"saveRule":{"phase":"weird"}},{"id":"\#(UUID().uuidString)","at":1790000001,"kind":"saveRule","question":"q2","linkDone":false,"linkSaved":false,"judged":{}}]}"#
    try s.save([]); try Data(file.utf8).write(to: s.url)
    let back = try s.load()
    XCTAssertEqual(back.map(\.saveRule), [SaveRuleTurn(), nil])
  }
}
