import XCTest
@testable import EruriCore

final class UnsubscribeTests: XCTestCase {
  // rpc/unsub_list 행(0028). 합성 값. timestamptz 는 PostgREST 가 마이크로초·+00:00 로 준다
  let json = """
  [{"sender_id":"a1","display_name":"합성쇼핑","address":"s1@example.com","method":"one_click","status":"active","status_at":null,"requested_at":null,"result_code":null,"ads_30d":12,"ads_after_request":0,"last_ad_at":"2026-10-09T03:00:00.123456+00:00","can_request":true},
   {"sender_id":"b2","display_name":null,"address":"s3@example.net","method":"mailto","status":"active","status_at":null,"requested_at":null,"result_code":null,"ads_30d":3,"ads_after_request":0,"last_ad_at":null,"can_request":true}]
  """.data(using: .utf8)!
  let now = ISO8601DateFormatter().date(from: "2026-10-10T00:00:00Z")!

  func row(method: String = "one_click", status: String = "active", statusAt: String? = nil, requestedAt: String? = nil,
           code: String? = nil, after: Int = 0, canRequest: Bool = true) -> Unsubscribe.Row {
    Unsubscribe.Row(sender_id: "x", display_name: "합성", address: "x@example.com", method: method, status: status, status_at: statusAt,
                    requested_at: requestedAt, result_code: code, ads_30d: 4, ads_after_request: after, last_ad_at: nil, can_request: canRequest)
  }

  func testDecodeAndLines() throws {
    let rows = try XCTUnwrap(Unsubscribe.decode(json))
    XCTAssertEqual(rows.map(\.id), ["a1", "b2"])
    XCTAssertEqual(rows.map(\.name), ["합성쇼핑", "s3@example.net"])                     // 이름 없으면 주소
    XCTAssertEqual(rows[0].countLine, "최근 30일 광고 12통 · s1@example.com")
    XCTAssertNil(Unsubscribe.decode(Data(#"{"code":"PGRST202"}"#.utf8)))
  }

  func testStates() {
    XCTAssertEqual(row().state(now: now), .available)
    XCTAssertEqual(row(status: "requesting", statusAt: "2026-10-09T23:59:30+00:00").state(now: now), .requesting)
    XCTAssertEqual(row(status: "requested", requestedAt: "2026-10-08T15:30:00.5+00:00").state(now: now), .requested("10/9"))   // 서울 날짜
    XCTAssertEqual(row(status: "requested", requestedAt: "2026-10-01T00:00:00+00:00", after: 2).state(now: now), .stillComing(2))
    XCTAssertEqual(row(status: "failed", code: "blocked_private").state(now: now), .failed("blocked_private"))
    for (m, text) in [("mailto", "메일 회신 방식 — 앱에서 해지할 수 없어요"), ("link_only", "웹 페이지 방식 — 앱에서 해지할 수 없어요"),
                      ("unverified", "발신자 확인이 안 돼 해지 요청을 보내지 않아요"), ("none", "해지 링크가 없어요")] {
      XCTAssertEqual(row(method: m).state(now: now), .unsupported(text))
    }
    XCTAssertEqual(row(method: "mailto", status: "requested", requestedAt: "2026-10-01T00:00:00+00:00").state(now: now), .requested("10/1"))
  }

  // 리뷰 N5: 5회 한도에 닿은 발신자에는 누를 수 없는 버튼을 보이지 않는다
  func testLimitHidesButton() {
    let limit = Unsubscribe.State.unsupported("요청 한도(5회)에 도달했어요")
    XCTAssertEqual(row(status: "failed", code: "http_500", canRequest: false).state(now: now), limit)
    XCTAssertEqual(row(canRequest: false).state(now: now), limit)
    XCTAssertEqual(row(status: "requested", requestedAt: "2026-10-01T00:00:00+00:00", after: 2, canRequest: false).state(now: now), limit)
    XCTAssertEqual(row(status: "requested", requestedAt: "2026-10-08T15:30:00+00:00", canRequest: false).state(now: now), .requested("10/9"))   // 버튼 없는 상태는 그대로
    XCTAssertNil(limit.buttonTitle)
  }

  func testStaleRequestingIsRetryable() {
    let s = row(status: "requesting", statusAt: "2026-10-09T23:58:00+00:00").state(now: now)   // 2분 전
    XCTAssertEqual(s, .failed("timeout"))
    XCTAssertEqual(s.buttonTitle, "다시 시도")
  }

  func testLabelsAndButtons() {
    XCTAssertEqual([Unsubscribe.State.available, .requesting, .requested("10/9"), .stillComing(2), .failed("http_500"), .unsupported("해지 링크가 없어요")].map(\.label),
                   ["원클릭 해지 지원", "요청 중…", "해지 요청함 · 10/9", "해지 요청 뒤에도 광고 2통", "응답이 없어요. 잠시 뒤 다시 시도해 주세요", "해지 링크가 없어요"])
    XCTAssertEqual([Unsubscribe.State.available, .requesting, .requested("10/9"), .stillComing(2), .failed("x"), .unsupported("y")].map(\.buttonTitle),
                   ["해지", nil, nil, "다시 요청", "다시 시도", nil])
    XCTAssertEqual([Unsubscribe.State.stillComing(1), .failed("x"), .available].map(\.isWarning), [true, true, false])
  }

  func testMessages() {
    func m(_ s: Int?, _ body: String?) -> String { Unsubscribe.message(status: s, data: body.map { Data($0.utf8) }) }
    XCTAssertEqual(m(200, #"{"result":"requested","code":"ok"}"#), "해지 요청을 보냈어요. 발신자가 처리하는 데 며칠 걸릴 수 있어요")
    XCTAssertEqual(m(200, #"{"result":"failed","code":"timeout"}"#), "응답이 없어요. 잠시 뒤 다시 시도해 주세요")
    XCTAssertEqual(m(200, #"{"result":"failed","code":"redirect_302"}"#), "발신자가 다른 주소로 넘겨 요청하지 못했어요")
    XCTAssertEqual(m(200, #"{"result":"failed","code":"blocked_private"}"#), "해지 페이지가 안전하지 않아 요청하지 않았어요")
    XCTAssertEqual(m(200, #"{"result":"failed","code":"no_url"}"#), "해지 정보를 찾지 못했어요")
    XCTAssertEqual(m(200, #"{"result":"failed"}"#), "응답이 없어요. 잠시 뒤 다시 시도해 주세요")          // code 없음 = error
    XCTAssertEqual(m(200, #"{"result":"unsupported"}"#), "이 발신자는 앱에서 해지할 수 없어요")
    XCTAssertEqual(m(200, #"{"result":"already"}"#), "이미 해지 요청을 보냈어요")
    XCTAssertEqual(m(200, #"{"result":"busy"}"#), "요청 중이에요. 잠시 뒤 새로고침해 주세요")
    XCTAssertEqual(m(200, #"{"result":"limit"}"#), "이 발신자에게는 더 요청할 수 없어요 (5회)")
    XCTAssertEqual(m(200, #"{"result":"not_found"}"#), "목록이 바뀌었어요. 새로고침해 주세요")
    XCTAssertEqual(m(401, ""), "응답이 없어요. 잠시 뒤 다시 시도해 주세요")
    XCTAssertEqual(m(nil, nil), "응답이 없어요. 잠시 뒤 다시 시도해 주세요")
    XCTAssertEqual(m(200, #"{"result":"weird"}"#), "응답이 없어요. 잠시 뒤 다시 시도해 주세요")
  }

  // U7 리뷰 Minor 2: 실패 코드 원문(blocked_private·redirect_302·http_500 …)은 화면에 보이지 않는다
  func testFailureText() {
    let unsafe = "해지 페이지가 안전하지 않아 요청하지 않았어요", moved = "발신자가 다른 주소로 넘겨 요청하지 못했어요"
    let noInfo = "해지 정보를 찾지 못했어요", noAnswer = "응답이 없어요. 잠시 뒤 다시 시도해 주세요"
    let cases: [(String, String)] = [
      ("blocked_private", unsafe), ("blocked_scheme", unsafe), ("blocked_host", unsafe),
      ("redirect_302", moved), ("redirect_307", moved),
      ("no_url", noInfo), ("unsupported", noInfo),
      ("timeout", noAnswer), ("network", noAnswer), ("error", noAnswer), ("dns_error", noAnswer),
      ("http_500", noAnswer), ("http_404", noAnswer), ("something_new", noAnswer),
    ]
    for (code, text) in cases {
      XCTAssertEqual(Unsubscribe.failureText(code), text, code)
      XCTAssertEqual(Unsubscribe.State.failed(code).label, text, code)
    }
    XCTAssertEqual(row(status: "failed", code: "blocked_private").state(now: now).label, unsafe)
    XCTAssertEqual(row(status: "failed").state(now: now).label, noAnswer)                          // result_code null
    XCTAssertEqual(row(status: "requesting", statusAt: "2026-10-09T23:58:00+00:00").state(now: now).label, noAnswer)   // 60초 넘은 요청 중
  }

  func testConfirmCopy() {
    XCTAssertEqual(Unsubscribe.confirmTitle(row()), "합성의 광고 수신 거부를 요청할까요?")
    XCTAssertTrue(Unsubscribe.confirmMessage.contains("거래 메일은 계속 올 수 있어요"))
    XCTAssertTrue(Unsubscribe.confirmMessage.contains("다시 수신 동의"))
    XCTAssertEqual(Unsubscribe.summary(count: 0), "최근 30일 광고 메일이 없어요")
    XCTAssertEqual(Unsubscribe.summary(count: 7), "광고 발신자 7곳 · 많이 보낸 순")
    XCTAssertTrue(Unsubscribe.footer.contains("구독 해지 기록에는 메일 제목·본문을 저장하지 않습니다"))   // 리뷰 L1: 범위를 이 기능 기록으로 한정
  }
}
