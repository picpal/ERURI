import XCTest
@testable import EruriCore

final class RecentDiscardsTests: XCTestCase {
  // PostgREST 행(0010: gate_confidence real → JSON 숫자, 제목·발신자·앱은 null 가능). 합성 값
  let json = """
  [{"id":"a1","source":"NOTIFICATION","app_name":"카카오톡","sender":null,"title":"합성 제목","gate_label":"personal","gate_confidence":0.934,"occurred_at":"2026-09-30T01:02:03+00:00"},
   {"id":"b2","source":"GMAIL","app_name":null,"sender":"합성상점","title":null,"gate_label":null,"gate_confidence":null,"occurred_at":"2026-09-29T10:00:00+00:00"}]
  """.data(using: .utf8)!

  func testDecodeRowsAndLines() throws {
    let rows = try XCTUnwrap(RecentDiscards.decode(json))
    XCTAssertEqual(rows.map(\.id), ["a1", "b2"])
    XCTAssertEqual(rows.map(\.titleLine), ["합성 제목", "(제목 없음)"])
    XCTAssertEqual(rows.map(\.originLine), ["카카오톡", "GMAIL · 합성상점"])        // 앱 이름 없으면 source
    XCTAssertEqual(rows.map(\.gateLine), ["개인 대화 · 93% · 2026-09-30", "- · 0% · 2026-09-29"])
  }
  func testDecodeRejectsNonArray() {
    XCTAssertNil(RecentDiscards.decode(Data(#"{"code":"PGRST"}"#.utf8)))
  }
  func testLabelKo() {
    XCTAssertEqual(["personal", "promo", "otp", "notice", "medical_result"].map(RecentDiscards.labelKo),
                   ["개인 대화", "광고", "인증번호", "안내", "의료 결과"])
    XCTAssertEqual(RecentDiscards.labelKo("new_label"), "new_label")               // 서버가 라벨을 늘려도 원문 코드로 보인다
    XCTAssertEqual(RecentDiscards.labelKo(nil), "-")
  }
  // restore_discarded(0010) 반환: JSON 문자열 "queued"|"not_found"|"expired"|"not_discarded"
  func testRestoreResult() {
    XCTAssertEqual(RecentDiscards.restoreResult(status: 200, data: Data(#""queued""#.utf8)), "queued")
    XCTAssertEqual(RecentDiscards.restoreResult(status: 200, data: Data(#""expired""#.utf8)), "expired")
    XCTAssertEqual(RecentDiscards.restoreResult(status: 404, data: Data(#"{"code":"PGRST202"}"#.utf8)), "http_404")
    XCTAssertEqual(RecentDiscards.restoreResult(status: nil, data: nil), "network")
  }
  func testRestoreMessage() {
    XCTAssertEqual(RecentDiscards.restoreMessage("queued"), "복구했습니다. 잠시 뒤 다시 처리됩니다")
    XCTAssertEqual(RecentDiscards.restoreMessage("expired"), "7일이 지나 복구할 수 없습니다")
    XCTAssertEqual(RecentDiscards.restoreMessage("not_discarded"), "이미 복구됐거나 폐기 항목이 아닙니다")
    XCTAssertEqual(RecentDiscards.restoreMessage("not_found"), "복구 실패: not_found")
    XCTAssertEqual(RecentDiscards.restoreMessage("network"), "복구 실패: network")
  }
  func testSummary() {
    XCTAssertEqual(RecentDiscards.summary(count: 0), "최근 7일 안에 폐기된 항목이 없습니다")
    XCTAssertEqual(RecentDiscards.summary(count: 3), "3건 · 7일이 지나면 본문이 지워집니다")
  }
  // 본문 열(content_enc·ocr_text_enc)을 요청하지 않는다(스펙 §7 "본문 없음")
  func testQueryHasNoBody() {
    let q = RecentDiscards.query()
    XCTAssertTrue(q.hasPrefix("rest/v1/items?select=id,source,app_name,sender,title,gate_label,gate_confidence,occurred_at&"))
    XCTAssertFalse(q.contains("content_enc") || q.contains("ocr_text"))
  }
  // 기한이 지난 격리 항목(purge 전)은 목록에 없어야 한다 → quarantine_until > now. UTC Z 표기라 '+' 인코딩 문제가 없다
  func testQueryExcludesExpiredQuarantine() {
    let q = RecentDiscards.query(now: Date(timeIntervalSince1970: 1_790_000_000))
    XCTAssertTrue(q.contains("&quarantine_until=gt.2026-09-21T14:13:20Z&"))
    XCTAssertFalse(q.contains("not.is.null"))
    XCTAssertNotNil(URL(string: q))
  }
}
