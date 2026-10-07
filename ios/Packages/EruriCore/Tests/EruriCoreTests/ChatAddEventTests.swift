import XCTest
@testable import EruriCore

/// 채팅 일정 등록(스펙 §9 "채팅 일정 등록", 0.13.0)
final class ChatAddEventTests: XCTestCase {
  func tempQueue() throws -> CaptureQueue {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".sqlite")
    addTeardownBlock { for s in ["", "-wal", "-shm"] { try? FileManager.default.removeItem(atPath: url.path + s) } }
    return try CaptureQueue(url: url)
  }
  func d(_ iso: String) -> Date { ISO8601DateFormatter().date(from: iso)! }

  // ── 같은 글 캡처 id(D5) ──
  func testCaptureIDIgnoresSpacingAndNewlines() {
    let at = d("2026-10-06T03:00:00Z")
    XCTAssertEqual(ChatAddEvent.captureID(text: "  합성  치과\n10/20  15:00 등록해줘 ", at: at), ChatAddEvent.captureID(text: "합성 치과 10/20 15:00 등록해줘", at: at))
    XCTAssertNotEqual(ChatAddEvent.captureID(text: "합성 치과 10/20 15:00 등록해줘", at: at), ChatAddEvent.captureID(text: "합성 치과 10/21 15:00 등록해줘", at: at))
    XCTAssertEqual(ChatAddEvent.normalized(" a \n\t b  "), "a b")
  }
  func testCaptureIDChangesAtSeoulMidnight() {
    let t = "내일 9시 합성 운동 등록해줘"
    let lateNight = d("2026-10-06T14:59:59Z"), morning = d("2026-10-06T00:00:00Z"), nextDay = d("2026-10-06T15:00:00Z")
    XCTAssertEqual(ChatAddEvent.seoulDay(lateNight), "2026-10-06")
    XCTAssertEqual(ChatAddEvent.seoulDay(nextDay), "2026-10-07")
    XCTAssertEqual(ChatAddEvent.captureID(text: t, at: lateNight), ChatAddEvent.captureID(text: t, at: morning))
    XCTAssertNotEqual(ChatAddEvent.captureID(text: t, at: lateNight), ChatAddEvent.captureID(text: t, at: nextDay))
  }
  func testCaptureIDIsUUIDv5AndNotALinkID() throws {
    let id = ChatAddEvent.captureID(text: "합성 등록해줘", at: d("2026-10-06T03:00:00Z"))
    XCTAssertNotNil(UUID(uuidString: id))
    XCTAssertEqual(Array(id)[14], "5")
    XCTAssertNotEqual(id, LinkText.captureID(for: try XCTUnwrap(URL(string: "https://a.example.com/"))))
  }

  // ── 접수(D6) ──
  func testAdmitQueuesShareChatItemAndMarksSeen() throws {
    let q = try tempQueue(), at = d("2026-10-06T03:00:00Z"), text = "합성 치과 예약 10/20 15:00–16:00 캘린더에 등록해줘"
    let o = ChatAddEvent.admit(text: text, at: at, queue: q, now: at)
    let id = ChatAddEvent.captureID(text: text, at: at)
    XCTAssertEqual(o, .queued(captureID: id))
    let item = try XCTUnwrap(q.pending(limit: 10, now: at).first)
    XCTAssertEqual([item.id, item.source, item.appName], [id, "SHARE", "채팅"])
    XCTAssertNil(item.title)
    XCTAssertEqual(item.text, text)                                   // 사용자가 쓴 그대로(정규화는 키에만)
    XCTAssertEqual(item.capturedAt, at)                               // occurred_at = 보낸 시각("내일 3시"의 기준일)
    XCTAssertTrue(try q.isLinkSeen(captureID: id, now: at))
    XCTAssertEqual(ChatAddEvent.code(o), "queued")
  }
  func testAdmitSameTextTwiceIsDuplicate() throws {
    let q = try tempQueue(), at = d("2026-10-06T03:00:00Z")
    _ = ChatAddEvent.admit(text: "합성 회의 10/20 등록해줘", at: at, queue: q, now: at)
    let o = ChatAddEvent.admit(text: "합성  회의 10/20 등록해줘", at: at.addingTimeInterval(60), queue: q, now: at.addingTimeInterval(60))
    XCTAssertEqual(o, .duplicate(captureID: ChatAddEvent.captureID(text: "합성 회의 10/20 등록해줘", at: at)))
    XCTAssertEqual(try q.captureCount(), 1)
    XCTAssertEqual(ChatAddEvent.code(o), "duplicate")
  }
  func testAdmitDiscardsOTPWithoutTrace() throws {
    let q = try tempQueue(), at = d("2026-10-06T03:00:00Z"), text = "[Web발신] 인증번호 483920 을 입력하세요 등록해줘"
    let o = ChatAddEvent.admit(text: text, at: at, queue: q, now: at)
    XCTAssertEqual(o, .discarded("otp"))
    XCTAssertEqual(try q.captureCount(), 0)
    XCTAssertFalse(try q.isLinkSeen(captureID: ChatAddEvent.captureID(text: text, at: at), now: at))
    XCTAssertEqual(ChatAddEvent.code(o), "discarded:otp")
  }
  func testAdmitMasksCardNumber() throws {
    let q = try tempQueue(), at = d("2026-10-06T03:00:00Z")
    _ = ChatAddEvent.admit(text: "카드 4111-1111-1111-1111 결제일 10/25 등록해줘", at: at, queue: q, now: at)
    let item = try XCTUnwrap(q.pending(limit: 1, now: at).first)
    XCTAssertEqual(item.text, "카드 ****-****-****-1111 결제일 10/25 등록해줘")
  }
  func testFailedOutcomeCodeAndCopy() throws {
    // 큐 쓰기 실패는 단위 테스트로 유도하지 않는다(CaptureQueue 는 프로토콜 없는 final class — 주입하려면 구조를 바꿔야 한다).
    // "기록 안 함"은 admit 의 코드 순서(markLinkSeen 이 queued 뒤에만)로 보장하고 A4 리뷰가 확인한다. 여기서는 코드·문구만 고정한다
    XCTAssertEqual(ChatAddEvent.code(.failed("queue")), "failed:queue")
    XCTAssertEqual(ChatAddEventText.failed, "등록하지 못했어요(기기에 저장하지 못했어요). 다시 보내 주세요.")
  }

  // ── 결과 판정(스펙 §9 "턴 표시") ──
  func testResultTexts() {
    XCTAssertNil(ChatAddEvent.result(status: nil, kinds: [], withContext: false))
    XCTAssertNil(ChatAddEvent.result(status: "queued", kinds: [], withContext: false))
    XCTAssertEqual(ChatAddEvent.result(status: "extracted", kinds: ["event", "event", "task"], withContext: false), .events(2))
    XCTAssertEqual(ChatAddEvent.result(status: "extracted", kinds: ["task"], withContext: true), .text("할 일을 찾았어요 — 알림에서 확인하세요"))
    XCTAssertEqual(ChatAddEvent.result(status: "extracted", kinds: [], withContext: false), .text("일정을 찾지 못했어요. 날짜와 시간을 함께 써 주세요."))
    XCTAssertEqual(ChatAddEvent.result(status: "extracted", kinds: ["purchase"], withContext: true),
                   .text("일정을 찾지 못했어요. 날짜와 시간을 함께 써 주세요.\n앞 답의 일정은 그 답 카드의 [캘린더에 추가]로 넣을 수 있어요"))
    XCTAssertEqual(ChatAddEvent.result(status: "discarded:server:empty", kinds: [], withContext: false), .text(ChatAddEventText.noEvent))
    XCTAssertEqual(ChatAddEvent.result(status: "discarded:server:otp", kinds: [], withContext: true), .text(ChatAddEventText.discarded))
    XCTAssertNil(ChatAddEvent.result(status: "processing", kinds: [], withContext: false))
  }
  func testCopy() {
    XCTAssertEqual(ChatAddEventText.registering, "일정을 등록하는 중…")
    XCTAssertEqual(ChatAddEventText.found(1), "일정 1건을 찾았어요")
    XCTAssertEqual(ChatAddEventText.offline, "연결되면 등록해요 — 일정을 찾으면 알림으로 알려 드려요")
    XCTAssertEqual(ChatAddEventText.duplicateFound, "이미 등록한 글이에요.")
    XCTAssertEqual(ChatAddEventText.duplicate, "이미 등록한 글이에요. 보관함에서 그 항목을 열면 일정을 다시 볼 수 있어요")
    XCTAssertEqual(ChatAddEventText.discarded, LinkCaptureText.discarded)
    XCTAssertEqual(ChatAddEventText.pending, LinkCaptureText.pending)
    XCTAssertEqual(ChatAddEvent.intents, ["add_event", "mail_action"])
    XCTAssertTrue(ChatAddEvent.isAddEvent("add_event"))
    XCTAssertFalse(ChatAddEvent.isAddEvent(nil))
    XCTAssertFalse(ChatAddEvent.isAddEvent("mail_action"))
  }

  // ── 카드(D8) ──
  func testProposalsLatestPerFactWithChatStatuses() throws {
    let json = #"""
    [{"ordinal":2,"proposals":[{"id":"p2a","action":"create_event","status":"proposed","version":1,"payload":{"title":"합성 B","start":"2026-10-21T10:00:00+09:00"}},
                               {"id":"p2b","action":"create_event","status":"succeeded","version":2,"payload":{"title":"합성 B","start":"2026-10-21T11:00:00+09:00"}}]},
     {"ordinal":1,"proposals":[{"id":"p1","action":"create_event","status":"dismissed","version":1,"payload":{"title":"합성 A","start":"2026-10-20T15:00:00+09:00"}}]},
     {"ordinal":3,"proposals":[{"id":"p3","action":"create_event","status":"proposed","version":1,"payload":{"title":"합성 C","start":"2026-10-22","end":"2026-10-22"}}]},
     {"ordinal":4,"proposals":[]}]
    """#
    let ps = try XCTUnwrap(ChatAddEvent.proposals(itemID: "item-9", data: Data(json.utf8)))
    XCTAssertEqual(ps.map(\.id), ["p2b", "p3"])
    XCTAssertEqual(Set(ps.map(\.item_id)), ["item-9"])
    XCTAssertEqual(ps.first?.payload["start"]?.string, "2026-10-21T11:00:00+09:00")
    XCTAssertNil(ChatAddEvent.proposals(itemID: "x", data: Data(#"{"error":"x"}"#.utf8)))
  }
  func testCitationMakesChatSourceLines() {
    let c = ChatAddEvent.citation(itemID: "item-9", at: d("2026-10-06T03:00:00Z"))
    XCTAssertEqual([c.item_id, c.source, c.app_name], ["item-9", "SHARE", "채팅"])
    XCTAssertEqual(ScheduleCard.sourceLine(c), "채팅에서 등록한 일정")
    XCTAssertEqual(ScheduleCard.receivedLine(c), "10/6 등록")
  }
}
