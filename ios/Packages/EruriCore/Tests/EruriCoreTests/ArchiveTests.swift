import XCTest
@testable import EruriCore

final class ArchiveTests: XCTestCase {
  // PostgREST items 메타 행(본문 열 없음). 합성 값
  let json = """
  [{"id":"a1","source":"NOTIFICATION","app_name":"카카오톡","sender":"합성친구","title":"합성 제목","occurred_at":"2026-09-30T01:02:03+00:00","status":"extracted","gate_label":"actionable"},
   {"id":"b2","source":"GMAIL","app_name":null,"sender":null,"title":null,"occurred_at":"2026-09-29T10:00:00+00:00","status":"discarded:server:personal","gate_label":"personal"}]
  """.data(using: .utf8)!

  func testDecodeAndLines() throws {
    let rows = try XCTUnwrap(Archive.decode(json))
    XCTAssertEqual(rows.map(\.id), ["a1", "b2"])
    XCTAssertEqual(rows.map(\.titleLine), ["합성 제목", "(제목 없음)"])
    XCTAssertEqual(rows.map(\.metaLine), ["카카오톡 · 합성친구 · 2026-09-30 · 추출됨", "메일 · 2026-09-29 · 폐기"])  // 빈 발신자는 빼고
    XCTAssertNil(Archive.decode(Data(#"{"code":"PGRST"}"#.utf8)))
  }

  func testQueryBySourceAndPage() {
    let base = "rest/v1/items?select=id,source,app_name,sender,title,occurred_at,status,gate_label&order=occurred_at.desc,id.desc&limit=50"
    XCTAssertEqual(Archive.query(filter: .all, offset: 0), base + "&offset=0")
    XCTAssertEqual(Archive.query(filter: .mail, offset: 50), base + "&offset=50&source=eq.GMAIL")
    XCTAssertEqual(Archive.query(filter: .notification, offset: 0), base + "&offset=0&source=in.(NOTIFICATION,MESSAGES)")  // 문자도 알림·문자 묶음
    XCTAssertEqual(Archive.query(filter: .share, offset: 100), base + "&offset=100&source=eq.SHARE")
    XCTAssertFalse(Archive.query(filter: .all, offset: 0).contains("content"))                            // 본문 열은 요청하지 않는다
  }

  func testHasMore() {
    XCTAssertTrue(Archive.hasMore(pageCount: Archive.pageSize))
    XCTAssertFalse(Archive.hasMore(pageCount: Archive.pageSize - 1))
  }

  func testStatusKo() {
    XCTAssertEqual(["extracted", "queued", "discarded:server:empty", "discarded:server:promo", "discarded:device:rule"].map(Archive.statusKo),
                   ["추출됨", "처리 중", "보관", "폐기", "폐기"])
    XCTAssertEqual(Archive.statusKo("new_status"), "new_status")
  }

  // 게이트 통과 = 라벨이 있고 상태가 그 라벨의 게이트 폐기가 아닌 것(gate-report.ts 와 같은 기준). 추출됨·보관·처리 중 모두
  func testGatePassed() {
    XCTAssertTrue(Archive.gatePassed(status: "extracted", gateLabel: "actionable"))
    XCTAssertTrue(Archive.gatePassed(status: "discarded:server:empty", gateLabel: "actionable"))      // 추출 결과가 비어 보관된 것
    XCTAssertTrue(Archive.gatePassed(status: "queued", gateLabel: "personal"))                        // 낮은 confidence 로 통과해 처리 중
    XCTAssertFalse(Archive.gatePassed(status: "discarded:server:personal", gateLabel: "personal"))    // 게이트 폐기(격리)
    XCTAssertFalse(Archive.gatePassed(status: "extracted", gateLabel: nil))                           // 게이트를 거치지 않음
  }

  // gate_feedback select verdict 응답 → 표시 상태. 복구(wrong_discard) 항목은 오통과 표시 대상이 아니다
  func testFeedbackState() {
    XCTAssertEqual(Archive.feedback(status: 200, data: Data("[]".utf8)), .none)
    XCTAssertEqual(Archive.feedback(status: 200, data: Data(#"[{"verdict":"wrong_pass"}]"#.utf8)), .wrongPass)
    XCTAssertEqual(Archive.feedback(status: 200, data: Data(#"[{"verdict":"wrong_discard"}]"#.utf8)), .restored)
    XCTAssertEqual(Archive.feedback(status: 401, data: Data()), .unknown)
    XCTAssertEqual(Archive.feedback(status: nil, data: nil), .unknown)
  }

  func testMarkPaths() {
    XCTAssertEqual(Archive.feedbackQuery(itemID: "a1"), "rest/v1/gate_feedback?item_id=eq.a1&select=verdict")
    XCTAssertEqual(Archive.unmarkPath(itemID: "a1"), "rest/v1/gate_feedback?item_id=eq.a1&verdict=eq.wrong_pass")  // 복구 표시는 지우지 않는다
    XCTAssertTrue(Archive.succeeded(201)); XCTAssertTrue(Archive.succeeded(204))
    XCTAssertFalse(Archive.succeeded(409)); XCTAssertFalse(Archive.succeeded(nil))
  }
}
