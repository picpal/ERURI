import XCTest
@testable import EruriCore

/// 0.16.1 추가 1 — 실패·멈춘 항목을 저장된 글로 다시 처리(스펙 §7 retry_item, §9 "이미 읽은 링크", §10 [다시 처리])
final class ItemRetryTests: XCTestCase {
  /// 같은 링크·같은 글 경로: failed·queued 만 RPC 를 부른다(처리 중인지는 서버가 processing 으로 답한다). 추출됨·폐기는 지금처럼 "일정 보기"
  func testSameLinkTriesOnlyFailedOrQueued() {
    XCTAssertTrue(ItemRetry.shouldTry(status: "failed"))
    XCTAssertTrue(ItemRetry.shouldTry(status: "queued"))
    for s in ["extracted", "discarded:server:empty", "discarded:server:promo", "proposed"] { XCTAssertFalse(ItemRetry.shouldTry(status: s), s) }
  }

  /// 채팅 중복 분기: queued → 결과 확인(90초), not_failed → "일정 보기", processing → 아직 처리 중, expired·오류 → 문구
  func testChatStep() {
    XCTAssertEqual(ItemRetry.chatStep("queued"), .poll)
    XCTAssertEqual(ItemRetry.chatStep("not_failed"), .found)
    XCTAssertEqual(ItemRetry.chatStep("processing"), .text("아직 처리 중이에요 — 끝나면 알림으로 알려 드려요."))
    XCTAssertEqual(ItemRetry.chatStep("expired"), .text("원문이 만료돼 다시 처리할 수 없어요"))
    for r in ["network", "http_500", "not_found"] { XCTAssertEqual(ItemRetry.chatStep(r), .text("다시 처리하지 못했어요 — 잠시 뒤 다시 보내 주세요"), r) }
    XCTAssertEqual(ItemRetry.retryingLink, "이미 읽은 링크예요. 저장된 글로 다시 처리해요 — 일정을 찾는 중…")
    XCTAssertEqual(ItemRetry.retryingEvent, "이미 등록한 글이에요. 저장된 글로 다시 등록하는 중…")
    XCTAssertEqual(ItemRetry.pollTries, 30)                                                 // 3초 × 30 = 90초(복구 행과 같다)
  }

  /// 항목 상세 [다시 처리]: failed, 또는 queued 인데 가장 최근 process 잡이 dead 일 때만 버튼
  func testDetailButtonVisibility() {
    XCTAssertTrue(ItemRetry.canRetry(itemStatus: "failed", jobStatus: nil))
    XCTAssertTrue(ItemRetry.canRetry(itemStatus: "queued", jobStatus: "dead"))
    XCTAssertFalse(ItemRetry.canRetry(itemStatus: "queued", jobStatus: "queued"))
    XCTAssertFalse(ItemRetry.canRetry(itemStatus: "queued", jobStatus: "running"))
    XCTAssertFalse(ItemRetry.canRetry(itemStatus: "extracted", jobStatus: "dead"))
    XCTAssertFalse(ItemRetry.canRetry(itemStatus: nil, jobStatus: nil))
    XCTAssertEqual([ItemRetry.failedLine, ItemRetry.buttonTitle, ItemRetry.retrying], ["처리하지 못했어요", "다시 처리", "다시 처리하는 중…"])
  }

  /// 상세 버튼 결과: queued → 결과 확인, not_failed → 버튼 거둠, processing·expired → 문구(버튼 없음), 오류 → 문구 + 버튼 유지
  func testDetailStep() {
    XCTAssertEqual(ItemRetry.detailStep("queued"), .poll)
    XCTAssertEqual(ItemRetry.detailStep("not_failed"), .hide)
    XCTAssertEqual(ItemRetry.detailStep("processing"), .text("아직 처리 중이에요 — 끝나면 알림으로 알려 드려요.", keepButton: false))
    XCTAssertEqual(ItemRetry.detailStep("expired"), .text("원문이 만료돼 다시 처리할 수 없어요", keepButton: false))
    XCTAssertEqual(ItemRetry.detailStep("network"), .text("다시 처리하지 못했어요 — 잠시 뒤 다시 눌러 주세요", keepButton: true))
  }

  /// RPC 응답(JSON 문자열) → 결과 코드. 200 이 아니면 http_<n>, 응답 없음 network
  func testResultAndRows() {
    XCTAssertEqual(ItemRetry.result(status: 200, data: Data(#""queued""#.utf8)), "queued")
    XCTAssertEqual(ItemRetry.result(status: 401, data: Data()), "http_401")
    XCTAssertEqual(ItemRetry.result(status: nil, data: nil), "network")
    XCTAssertEqual(ItemRetry.firstString(Data(#"[{"status":"failed"}]"#.utf8), "status"), "failed")
    XCTAssertNil(ItemRetry.firstString(Data("[]".utf8), "status"))
    XCTAssertNil(ItemRetry.firstString(nil, "status"))
    XCTAssertEqual(ItemRetry.rpcPath, "rest/v1/rpc/retry_item")
  }
}
