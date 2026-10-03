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
  // 보관함에서 고른 출처 탭만(실기기 보고 0.4.0): 전체면 source 조건 없음, 격리 기한·본문 미조회 조건은 그대로
  func testQueryFollowsArchiveFilter() {
    let now = Date(timeIntervalSince1970: 1_790_000_000)
    XCTAssertFalse(RecentDiscards.query(now: now, filter: .all).contains("source="))
    XCTAssertEqual(RecentDiscards.query(now: now, filter: .all), RecentDiscards.query(now: now))
    for (f, cond) in [(Archive.Filter.mail, "&source=eq.GMAIL"), (.notification, "&source=in.(NOTIFICATION,MESSAGES)"), (.share, "&source=eq.SHARE")] {
      let q = RecentDiscards.query(now: now, filter: f)
      XCTAssertTrue(q.hasSuffix(cond), f.rawValue)
      XCTAssertTrue(q.contains("&quarantine_until=gt.2026-09-21T14:13:20Z&"))
      XCTAssertFalse(q.contains("content_enc") || q.contains("ocr_text"))
      XCTAssertNotNil(URL(string: q))
      XCTAssertTrue(Archive.query(filter: f, offset: 0).hasSuffix(cond))      // 보관함 목록과 같은 조건
    }
    XCTAssertEqual(RecentDiscards.title(filter: .all), "최근 폐기")
    XCTAssertEqual(RecentDiscards.title(filter: .notification), "최근 폐기 · 알림·문자")
  }

  // 복구 뒤 진행 상태(진단 10-03 UX): 본인 items.status·process 잡 status·facts 종류만 읽는다(본문 열 없음)
  func testRestoreQueriesHaveNoBody() {
    let qs = [RecentDiscards.itemStatusQuery(itemID: "i1"), RecentDiscards.jobStatusQuery(itemID: "i1"), RecentDiscards.factKindsQuery(itemID: "i1")]
    XCTAssertEqual(qs[0], "rest/v1/items?select=status&id=eq.i1")
    XCTAssertEqual(qs[1], "rest/v1/jobs?select=status&kind=eq.process&payload-%3E%3Eitem_id=eq.i1&order=created_at.desc&limit=1")   // 복구 잡(가장 최근)
    XCTAssertEqual(qs[2], "rest/v1/facts?select=kind&status=eq.active&item_id=eq.i1")                                             // LinkCapture.result 와 같은 기준
    for q in qs {
      XCTAssertNotNil(URL(string: q))
      XCTAssertFalse(q.contains("content_enc") || q.contains("ocr_text") || q.contains("payload,") || q.contains("select=*"))
    }
  }
  func testRestoreState() {
    typealias S = RecentDiscards.RestoreState
    XCTAssertNil(RecentDiscards.restoreState(itemStatus: nil, jobStatus: nil, kinds: []))                       // 행을 못 읽음 → 아직
    XCTAssertNil(RecentDiscards.restoreState(itemStatus: "queued", jobStatus: nil, kinds: []))
    XCTAssertNil(RecentDiscards.restoreState(itemStatus: "queued", jobStatus: "running", kinds: []))
    XCTAssertEqual(RecentDiscards.restoreState(itemStatus: "queued", jobStatus: "dead", kinds: []), S.failed)       // 5회 실패 — items 는 queued 로 남는다
    XCTAssertEqual(RecentDiscards.restoreState(itemStatus: "extracted", jobStatus: nil, kinds: ["event", "place", "event"]), S.proposed(2))
    XCTAssertEqual(RecentDiscards.restoreState(itemStatus: "extracted", jobStatus: nil, kinds: ["task"]), S.task)
    XCTAssertEqual(RecentDiscards.restoreState(itemStatus: "extracted", jobStatus: nil, kinds: []), S.noSchedule)
    XCTAssertEqual(RecentDiscards.restoreState(itemStatus: "discarded:server:empty", jobStatus: "done", kinds: []), S.noSchedule)
    XCTAssertEqual(RecentDiscards.restoreState(itemStatus: "discarded:server:otp", jobStatus: "done", kinds: []), S.failed)  // 서버 규칙 폐기
  }
  func testRestoreLine() {
    XCTAssertEqual(RecentDiscards.restoreLine(.processing), "처리 중…")
    XCTAssertEqual(RecentDiscards.restoreLine(.proposed(2)), "일정 제안 2건 — '제안' 탭과 알림에서 추가할 수 있어요")
    XCTAssertEqual(RecentDiscards.restoreLine(.task), "할 일을 찾았어요 — 알림에서 확인하세요")
    XCTAssertEqual(RecentDiscards.restoreLine(.noSchedule), "일정을 찾지 못했어요 · 보관함에 보관됨")
    XCTAssertEqual(RecentDiscards.restoreLine(.failed), "처리하지 못했어요")
    XCTAssertEqual(RecentDiscards.restoreLine(.timedOut), "아직 처리 중이에요 — 보관함에서 확인하세요")
  }
  // 3초 × 30회 = 최대 90초(분당 cron 대기 + 처리, 진단 실측 최악 ~65초)
  func testPollLimit() {
    XCTAssertEqual(RecentDiscards.pollTries, 30)
    XCTAssertEqual(RecentDiscards.pollEvery, .seconds(3))
  }
  /// 가짜 서버: 경로 → 응답 차례(nil = 200 이 아님). 마지막 응답은 계속 반복
  final class FakeGet: @unchecked Sendable {
    var replies: [String: [Data?]]; var calls: [String] = []
    init(_ r: [String: [String?]]) { replies = r.mapValues { $0.map { $0.map { Data($0.utf8) } } } }
    func get(_ path: String) async -> Data? {
      calls.append(path)
      let key = String(path.prefix(while: { $0 != "?" }))
      guard var q = replies[key], !q.isEmpty else { return nil }
      let d = q.count > 1 ? q.removeFirst() : q[0]
      replies[key] = q
      return d
    }
  }
  func testPollRestoreProcessingThenProposal() async {
    let f = FakeGet(["rest/v1/items": [#"[{"status":"queued"}]"#, #"[{"status":"queued"}]"#, #"[{"status":"extracted"}]"#],
                     "rest/v1/jobs": [#"[{"status":"queued"}]"#, #"[{"status":"running"}]"#],
                     "rest/v1/facts": [#"[{"kind":"event"}]"#]])
    var waits = 0
    let s = await RecentDiscards.pollRestore(itemID: "i1", wait: { waits += 1 }, get: f.get)
    XCTAssertEqual(s, .proposed(1))
    XCTAssertEqual(waits, 3)
    XCTAssertEqual(f.calls.filter { $0.hasPrefix("rest/v1/jobs") }.count, 2)        // queued 일 때만 잡을 본다
    XCTAssertEqual(f.calls.filter { $0.hasPrefix("rest/v1/facts") }.count, 1)       // extracted 일 때만 facts 를 본다
  }
  func testPollRestoreEmptyAndDeadJob() async {
    let empty = FakeGet(["rest/v1/items": [#"[{"status":"discarded:server:empty"}]"#]])
    let s1 = await RecentDiscards.pollRestore(itemID: "i1", wait: {}, get: empty.get)
    XCTAssertEqual(s1, .noSchedule)
    XCTAssertFalse(empty.calls.contains { $0.hasPrefix("rest/v1/facts") || $0.hasPrefix("rest/v1/jobs") })
    let dead = FakeGet(["rest/v1/items": [#"[{"status":"queued"}]"#], "rest/v1/jobs": [#"[{"status":"dead"}]"#]])
    let s2 = await RecentDiscards.pollRestore(itemID: "i1", wait: {}, get: dead.get)
    XCTAssertEqual(s2, .failed)
  }
  // facts 조회가 실패하면 "일정 없음"으로 단정하지 않고 다음 회차에 다시 본다. 상한까지 끝나지 않으면 timedOut
  func testPollRestoreRetriesOnReadFailureAndTimesOut() async {
    let f = FakeGet(["rest/v1/items": [#"[{"status":"extracted"}]"#], "rest/v1/facts": [nil, #"[{"kind":"event"},{"kind":"event"}]"#]])
    let s = await RecentDiscards.pollRestore(itemID: "i1", wait: {}, get: f.get)
    XCTAssertEqual(s, .proposed(2))
    let stuck = FakeGet(["rest/v1/items": [#"[{"status":"queued"}]"#], "rest/v1/jobs": [#"[]"#]])
    var waits = 0
    let s2 = await RecentDiscards.pollRestore(itemID: "i1", tries: 4, wait: { waits += 1 }, get: stuck.get)
    XCTAssertEqual(s2, .timedOut)
    XCTAssertEqual(waits, 4)
    let broken = FakeGet([:])                                                         // 네트워크 없음 → 끝까지 nil
    let s3 = await RecentDiscards.pollRestore(itemID: "i1", tries: 2, wait: {}, get: broken.get)
    XCTAssertEqual(s3, .timedOut)
  }
}
