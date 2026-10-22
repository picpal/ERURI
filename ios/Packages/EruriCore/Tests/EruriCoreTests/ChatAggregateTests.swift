import XCTest
@testable import EruriCore

/// 집계 질문 응답 해석(스펙 §9 "채팅 저장 규칙·집계 질문", 0.17.0 P1): 막대·눈금·스크롤, 목록 머리·줄(서울), 복사, 맥락 칸(PF-F6). 합성 값
final class ChatAggregateTests: XCTestCase {
  private func cond(bucket: String, from: String = "2026-10-15", to: String = "2026-10-21", sender: String? = nil) -> ChatAggregate.Conditions {
    ChatAggregate.Conditions(keywords: ["합성PAY", "타임아웃"], sender: sender, sources: [], from: from, to: to, bucket: bucket, defaulted: true, clamped: false)
  }
  private func response(_ c: ChatAggregate.Conditions, buckets: [ChatAggregate.Bucket], top: [ChatAggregate.Bucket] = [], notes: [String] = []) -> ChatAggregate.Response {
    ChatAggregate.Response(status: "ok", conditions: c, total: buckets.reduce(0) { $0 + $1.count }, buckets: buckets, top: top,
                           sentence: "합성 문장", notes: notes)
  }
  private func dayKeys(from: String, count: Int) -> [String] {
    var cal = Calendar(identifier: .gregorian); cal.timeZone = TimeZone(identifier: "UTC")!
    let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.timeZone = cal.timeZone; f.dateFormat = "yyyy-MM-dd"
    let start = f.date(from: from)!
    return (0..<count).map { f.string(from: cal.date(byAdding: .day, value: $0, to: start)!) }
  }

  func testHourBarsTicksAndLeader() {
    let counts = [14: 9, 15: 9, 9: 4]
    let buckets = (0..<24).map { h in ChatAggregate.Bucket(key: String(format: "%02d", h), label: "\(h)시", count: counts[h] ?? 0) }
    let top = [buckets[14], buckets[15], buckets[9]]
    let b = ChatAggregate.bars(response(cond(bucket: "hour"), buckets: buckets, top: top))
    XCTAssertEqual(b.bars.count, 24)
    XCTAssertEqual(b.tickIndices, [0, 6, 12, 18])
    XCTAssertEqual(b.tickLabels, ["0시", "6시", "12시", "18시"])
    XCTAssertEqual(b.bars[0].count, 0)                                         // 0건 칸도 칸으로 남는다
    XCTAssertEqual(b.max, 9)
    XCTAssertEqual(b.leaderKeys, ["14", "15"])                                 // 1위 동률은 모두
    XCTAssertFalse(b.scrolls)
    let one = ChatAggregate.bars(response(cond(bucket: "hour"), buckets: buckets.map { .init(key: $0.key, label: $0.label, count: $0.key == "09" ? 2 : 0) },
                                          top: [.init(key: "09", label: "9시", count: 2)]))
    XCTAssertEqual(one.leaderKeys, ["09"])
    let empty = ChatAggregate.bars(response(cond(bucket: "hour"), buckets: buckets.map { .init(key: $0.key, label: $0.label, count: 0) }))
    XCTAssertEqual(empty.max, 0)
    XCTAssertTrue(empty.leaderKeys.isEmpty)                                    // 0건이면 진한 칸 없음
  }

  func testWeekdayBarsTickEveryDay() {
    let names = ["월", "화", "수", "목", "금", "토", "일"]
    let buckets = names.enumerated().map { ChatAggregate.Bucket(key: String($0.offset + 1), label: $0.element, count: $0.offset == 2 ? 5 : 1) }
    let b = ChatAggregate.bars(response(cond(bucket: "weekday"), buckets: buckets, top: [buckets[2]]))
    XCTAssertEqual(b.tickIndices, Array(0..<7))
    XCTAssertEqual(b.tickLabels, names)
    XCTAssertEqual(b.leaderKeys, ["3"])
    XCTAssertFalse(b.scrolls)
  }

  /// Review Focus 5: 90일로 줄인 day 집계 — 90칸, 가로 스크롤, 눈금 = 첫날·마지막 날·월요일(M/D)
  func testDayBarsOver31ScrollWithMondayTicks() {
    let keys = dayKeys(from: "2026-07-24", count: 90)                          // 7/24(금) ~ 10/21(수)
    XCTAssertEqual(keys.last, "2026-10-21")
    let buckets = keys.map { ChatAggregate.Bucket(key: $0, label: $0, count: 0) }
    let b = ChatAggregate.bars(response(cond(bucket: "day", from: "2026-07-24", to: "2026-10-21"), buckets: buckets))
    XCTAssertEqual(b.bars.count, 90)
    XCTAssertTrue(b.scrolls)
    // 첫 월요일 = 7/27(색인 3), 이후 7일마다. 마지막 89
    let mondays = Array(stride(from: 3, to: 90, by: 7))
    XCTAssertEqual(b.tickIndices, [0] + mondays + [89])
    XCTAssertEqual(b.tickLabels.first, "7/24")
    XCTAssertEqual(b.tickLabels[1], "7/27")
    XCTAssertEqual(b.tickLabels.last, "10/21")
    XCTAssertEqual(b.tickLabels.count, b.tickIndices.count)
    // 31칸 이하는 한 화면
    let short = dayKeys(from: "2026-10-01", count: 31).map { ChatAggregate.Bucket(key: $0, label: $0, count: 1) }
    let s = ChatAggregate.bars(response(cond(bucket: "day", from: "2026-10-01", to: "2026-10-31"), buckets: short))
    XCTAssertFalse(s.scrolls)
    XCTAssertEqual(s.tickIndices.first, 0)
    XCTAssertEqual(s.tickIndices.last, 30)
    XCTAssertTrue(s.tickIndices.contains(4))                                  // 10/5(월)
    // 첫날이 월요일이면 눈금이 겹치지 않는다
    let m = dayKeys(from: "2026-10-19", count: 3).map { ChatAggregate.Bucket(key: $0, label: $0, count: 1) }
    XCTAssertEqual(ChatAggregate.bars(response(cond(bucket: "day", from: "2026-10-19", to: "2026-10-21"), buckets: m)).tickIndices, [0, 2])
  }

  func testListHeader() {
    XCTAssertEqual(ChatAggregate.listHeader(bucket: "hour", label: "14시", total: 9), "14시대 9건")
    XCTAssertEqual(ChatAggregate.listHeader(bucket: "day", label: "10/15(목)", total: 9), "10/15(목) 9건")
    XCTAssertEqual(ChatAggregate.listHeader(bucket: "weekday", label: "수", total: 9), "수요일 9건")
  }

  /// Review Focus 4: 기기 시간대가 UTC 여도 목록 줄 시각은 서울. 제목이 없으면 발신자
  func testLineUsesSeoulForUTCDevice() throws {
    let json = #"""
    {"status":"ok","bucket_key":"00","label":"0시","total":2,"truncated":false,"items":[
     {"item_id":"i1","title":null,"sender":"합성은행","source":"MESSAGES","app_name":null,"occurred_at":"2026-10-15T15:30:00Z"},
     {"item_id":"i2","title":"합성 제목","sender":"합성친구","source":"NOTIFICATION","app_name":"카카오톡","occurred_at":"2026-10-15T15:31:05.123456+00:00"}]}
    """#
    let r = try XCTUnwrap(ChatAggregate.decodeList(Data(json.utf8)))
    let saved = NSTimeZone.default
    NSTimeZone.default = TimeZone(identifier: "UTC")!
    defer { NSTimeZone.default = saved }
    let a = ChatAggregate.line(r.items[0])
    XCTAssertEqual(a.title, "합성은행")
    XCTAssertEqual(a.meta, "문자 · 10/16 00:30")
    let b = ChatAggregate.line(r.items[1])
    XCTAssertEqual(b.title, "합성 제목")
    XCTAssertEqual(b.meta, "카카오톡 · 10/16 00:31")                              // Postgres 소수 초
    XCTAssertEqual(r.items.map(\.id), ["i1", "i2"])
  }

  func testCopyText() {
    let r = response(cond(bucket: "hour"), buckets: [], notes: ["저장된 메시지만 셌어요.", "꼬리 둘"])
    XCTAssertEqual(ChatAggregate.copyText(r), "합성 문장\n저장된 메시지만 셌어요.\n꼬리 둘")
    XCTAssertEqual(ChatAggregate.copyText(response(cond(bucket: "hour"), buckets: [])), "합성 문장")
  }

  func testListResponseTruncated() throws {
    let items = (0..<50).map { #"{"item_id":"i\#($0)","title":"합성 \#($0)","sender":null,"source":"GMAIL","app_name":null,"occurred_at":"2026-10-15T05:00:00+00:00"}"# }
    let json = #"{"status":"ok","bucket_key":"14","label":"14시","total":52,"truncated":true,"items":[\#(items.joined(separator: ","))]}"#
    let r = try XCTUnwrap(ChatAggregate.decodeList(Data(json.utf8)))
    XCTAssertEqual(r.items.count, 50)
    XCTAssertEqual(r.total, 52)
    XCTAssertTrue(r.truncated)
    XCTAssertEqual(ChatAggregate.listFooter(r), ChatAggregate.Text.truncated)
    XCTAssertEqual(ChatAggregate.Text.truncated, "최근 50건만 보여요")
    let small = try XCTUnwrap(ChatAggregate.decodeList(Data(#"{"status":"ok","bucket_key":"14","label":"14시","total":1,"truncated":false,"items":[]}"#.utf8)))
    XCTAssertNil(ChatAggregate.listFooter(small))
    XCTAssertNil(ChatAggregate.decodeList(Data(#"{"error":"bad_request"}"#.utf8)))
  }

  /// PF-F6: sender 가 nil 이어도 키를 NSNull 로 싣는다(서버 K11 은 키 누락을 bad_context 로 본다)
  func testContextJSONCarriesNullSender() throws {
    let c = cond(bucket: "hour")
    let j = ChatAggregate.contextJSON(c)
    XCTAssertEqual(Set(j.keys), ["keywords", "sender", "sources", "from", "to", "bucket", "defaulted", "clamped"])
    XCTAssertTrue(j["sender"] is NSNull)
    let data = try JSONSerialization.data(withJSONObject: j, options: [.sortedKeys])
    XCTAssertEqual(String(data: data, encoding: .utf8),
                   #"{"bucket":"hour","clamped":false,"defaulted":true,"from":"2026-10-15","keywords":["합성PAY","타임아웃"],"sender":null,"sources":[],"to":"2026-10-21"}"#)
    XCTAssertEqual(ChatAggregate.contextJSON(cond(bucket: "day", sender: "합성은행"))["sender"] as? String, "합성은행")
    let body = ChatAggregate.listBody(c, bucketKey: "14")
    XCTAssertEqual(body["bucket_key"] as? String, "14")
    let inner = try XCTUnwrap(body["conditions"] as? [String: Any])
    XCTAssertTrue(inner["sender"] is NSNull)
    XCTAssertEqual(inner.count, 8)
  }

  func testIsAggregateAndTexts() {
    XCTAssertTrue(ChatAggregate.isAggregate("aggregate"))
    XCTAssertFalse(ChatAggregate.isAggregate("question"))
    XCTAssertFalse(ChatAggregate.isAggregate(nil))
    XCTAssertEqual(ChatAggregate.Text.failed, "집계하지 못했어요 — 잠시 뒤 다시 물어봐 주세요")
    XCTAssertEqual(ChatAggregate.Text.emptyBucket, "이 칸에는 없어요")
  }

  // MARK: 0.18.0 본문 건수(P1)

  /// Review Focus 4 — 0.17.0 서버 응답·저장 턴은 새 칸 없이도 디코드된다
  func testDecodesWithoutNewFields() throws {
    let r = try JSONDecoder().decode(ChatAggregate.Response.self, from: Data(#"{"status":"ok","total":3,"buckets":[],"top":[],"sentence":"s","notes":[]}"#.utf8))
    XCTAssertNil(r.body_total)
    let l = try XCTUnwrap(ChatAggregate.decodeList(Data(#"{"status":"ok","bucket_key":"14","label":"14시","total":2,"items":[{"item_id":"a","title":"t","sender":null,"source":"MESSAGES","app_name":null,"occurred_at":"2026-10-22T05:12:00Z"}],"truncated":false}"#.utf8)))
    XCTAssertEqual(ChatAggregate.headerCount(l), 2); XCTAssertNil(l.items[0].count)
  }

  func testHistoryRoundTripKeepsBodyTotal() throws {
    let r = ChatAggregate.Response(status: "ok", conditions: nil, total: 12, buckets: [], top: [], sentence: "s", notes: [], body_total: 37)
    XCTAssertEqual(try JSONDecoder().decode(ChatAggregate.Response.self, from: JSONEncoder().encode(r)).body_total, 37)
  }

  func testListHeaderUsesValue() throws {
    let l = try XCTUnwrap(ChatAggregate.decodeList(Data(#"{"status":"ok","bucket_key":"14","label":"14시","total":2,"value":7,"items":[],"truncated":false}"#.utf8)))
    XCTAssertEqual(ChatAggregate.listHeader(bucket: "hour", label: l.label, total: ChatAggregate.headerCount(l)), "14시대 7건")
  }

  /// K21: 줄 끝 " · 6건"은 count 가 있을 때만
  func testLineAppendsCountOnlyWhenPresent() throws {
    let json = #"{"status":"ok","bucket_key":"14","label":"14시","total":2,"value":7,"truncated":false,"items":[{"item_id":"a","title":"합성 알림","sender":null,"source":"MESSAGES","app_name":null,"occurred_at":"2026-10-22T05:12:00Z","count":6},{"item_id":"b","title":"합성 알림2","sender":null,"source":"MESSAGES","app_name":null,"occurred_at":"2026-10-22T05:40:00Z","count":null}]}"#
    let r = try XCTUnwrap(ChatAggregate.decodeList(Data(json.utf8)))
    XCTAssertEqual(ChatAggregate.line(r.items[0]).meta, "문자 · 10/22 14:12 · 6건")
    XCTAssertEqual(ChatAggregate.line(r.items[1]).meta, "문자 · 10/22 14:40")
  }
}
