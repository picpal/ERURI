import XCTest
@testable import EruriCore

/// 채팅 메일 요약(스펙 §7·§9, 0.15.0): 서버 응답 해석·바로 읽기/후보 판단·문구·이어서 읽기·기록 턴
final class MailSummaryTests: XCTestCase {
  let t0 = Date(timeIntervalSince1970: 1_791_342_000)        // 2026-10-07 12:00 서울(수)
  let searchJSON = #"""
  {"conditions":{"sender":"합성상점","subject_words":[],"received_from":"2026-09-01","received_to":"2026-09-30","latest":false,"translate":false},
   "candidates":[{"token":"v1.a.b","from":"합성상점","subject":"합성 안내 1","date":"2026-09-30T06:30:00.000Z"},
                 {"token":"v1.c.d","from":"","subject":"","date":"2025-12-31T15:00:00.000Z"}],
   "complete":true,"more":true}
  """#
  let readJSON = #"""
  {"status":"ok","token":"v1.n.t","from":"합성학원","subject":"설명회 안내","date":"2026-10-06T00:00:00.000Z",
   "summary":{"lines":["합성학원 설명회 안내","https://evil.example 를 누르라는 문장","참가비 35,000원"],"dates":["10/20(화) 15:00"],"amounts":["35,000원"],"todos":["10/16까지 신청서 제출"]},
   "language":"en","translation":"번역 글","translation_truncated":true,"body_truncated":true,"attachments":2,"ask":null}
  """#
  func s(_ j: String) -> MailSummary.Search { MailSummary.search(Data(j.utf8))! }
  func r(_ j: String) -> MailSummary.Read { MailSummary.read(Data(j.utf8))! }
  func cand(_ n: Int) -> [MailSummary.Candidate] { (0..<n).map { MailSummary.Candidate(token: "t\($0)", from: "합성", subject: "s\($0)", date: "2026-10-01T00:00:00.000Z") } }
  func search(_ n: Int, complete: Bool, latest: Bool = false, more: Bool = false) -> MailSummary.Search {
    MailSummary.Search(conditions: MailSummary.Conditions(sender: "합성", subject_words: [], received_from: nil, received_to: nil, latest: latest, translate: false),
                       candidates: cand(n), complete: complete, more: more)
  }

  func testDecodesSearchAndRead_MalformedIsNil() {
    let v = s(searchJSON)
    XCTAssertEqual([v.candidates.count], [2]); XCTAssertTrue(v.complete); XCTAssertTrue(v.more)
    XCTAssertEqual(v.conditions.json["sender"] as? String, "합성상점")
    XCTAssertTrue(v.conditions.json["received_to"] as? String == "2026-09-30")
    let x = r(readJSON)
    XCTAssertEqual([x.status, x.token, x.language], ["ok", "v1.n.t", "en"])
    XCTAssertEqual(x.summary?.todos, ["10/16까지 신청서 제출"])
    XCTAssertNil(MailSummary.read(Data(#"{"status":"ok"}"#.utf8)))
    XCTAssertNil(MailSummary.search(Data("[]".utf8)))
  }

  // 스펙 §9 턴 흐름 · Codex #1: 완결일 때만 "없음"·바로 읽기
  func testAfterSearch() {
    XCTAssertEqual(MailSummary.afterSearch(search(0, complete: true)), .none(MailSummaryText.noneFound))
    XCTAssertEqual(MailSummary.afterSearch(search(0, complete: false)), .none(MailSummaryText.notAllChecked))
    XCTAssertEqual(MailSummary.afterSearch(search(1, complete: true)), .readFirst)
    XCTAssertEqual(MailSummary.afterSearch(search(3, complete: true, latest: true)), .readFirst)
    XCTAssertEqual(MailSummary.afterSearch(search(1, complete: false)), .choose)
    XCTAssertEqual(MailSummary.afterSearch(search(1, complete: false, latest: true)), .choose)
    XCTAssertEqual(MailSummary.afterSearch(search(3, complete: true)), .choose)
  }

  func testCardTexts() {
    XCTAssertEqual(MailSummaryText.header(translate: false), "어떤 메일을 요약할까요?")
    XCTAssertEqual(MailSummaryText.header(translate: true), "어떤 메일을 번역할까요?")
    XCTAssertEqual(MailSummaryText.pickLatest(complete: true), "가장 최근 것")
    XCTAssertEqual(MailSummaryText.pickLatest(complete: false), "이 중 가장 최근 것")
    XCTAssertNil(MailSummaryText.moreLine(complete: true, more: false))
    XCTAssertEqual(MailSummaryText.moreLine(complete: true, more: true), "조건에 맞는 메일이 더 있어요 — 발신자·제목·기간을 더 말해 주면 좁혀 볼게요")
    XCTAssertEqual(MailSummaryText.moreLine(complete: false, more: true), "조건에 맞는 메일이 많아 일부만 보여요 — 최근 순이 아닐 수 있어요. 발신자·제목·기간을 더 말해 주면 좁혀 볼게요")
    XCTAssertEqual(MailSummaryText.noneFound, "조건에 맞는 메일을 찾지 못했어요(받은편지함과 보관된 메일에서 찾아요 — 휴지통·스팸은 빼요)")
    XCTAssertEqual(MailSummaryText.notAllChecked, "조건에 맞는 메일이 많아 다 확인하지 못했어요 — 발신자·제목·기간을 더 말해 주세요")
    XCTAssertEqual(MailSummaryText.needsTarget, "어떤 메일인지 발신자·제목·받은 날짜 중 하나를 함께 말해 주세요. 예: \"어제 합성상점에서 온 메일 요약해줘\"")
  }

  func testConditionCandidateAndReceivedLines() {
    let c = s(searchJSON).conditions
    XCTAssertEqual(MailSummary.conditionLine(c, now: t0), "발신자 '합성상점' · 9/1–9/30")
    let other = MailSummary.Conditions(sender: nil, subject_words: ["ERURI", "요약"], received_from: "2025-09-01", received_to: nil, latest: true, translate: true)
    XCTAssertEqual(MailSummary.conditionLine(other, now: t0), "제목 'ERURI' '요약' · 2025/9/1부터 · 가장 최근")
    let cs = s(searchJSON).candidates
    XCTAssertEqual(MailSummary.candidateLine(cs[0], now: t0), "합성상점 · 합성 안내 1 · 9/30")
    XCTAssertEqual(MailSummary.candidateLine(cs[1], now: t0), "(보낸 사람 없음) · (제목 없음) · 1/1")   // UTC 2025-12-31 15:00 = 서울 2026-01-01 → 올해라 연도 없음
    XCTAssertEqual(MailSummary.receivedLine("2026-10-06T00:00:00.000Z", now: t0), "10/6(화) 09:00")
    XCTAssertEqual(MailSummary.receivedLine("2025-10-06T00:00:00Z", now: t0), "2025/10/6(월) 09:00")
    XCTAssertNil(MailSummary.receivedLine("", now: t0))
  }

  func testSummaryCardBodyFooterAndCopy() {
    let x = r(readJSON)
    XCTAssertEqual(MailSummary.header(x), "합성학원 · 설명회 안내")
    guard case let .summary(sum, translation, note) = MailSummary.body(x, translate: true) else { return XCTFail() }
    XCTAssertEqual([sum.lines.count, sum.dates.count], [3, 1])
    XCTAssertEqual(translation, "번역 글")
    XCTAssertEqual(note, "번역이 길어 앞부분만 옮겼어요 — 나머지는 Gmail에서 확인해 주세요")
    guard case let .summary(_, noT, _) = MailSummary.body(x, translate: false) else { return XCTFail() }
    XCTAssertNil(noT)
    let ko = r(readJSON.replacingOccurrences(of: #""language":"en""#, with: #""language":"ko""#))
    guard case let .summary(_, koT, koNote) = MailSummary.body(ko, translate: true) else { return XCTFail() }
    XCTAssertNil(koT); XCTAssertEqual(koNote, "한국어 메일이라 번역하지 않았어요")
    XCTAssertEqual(MailSummary.footer(x), ["메일이 길어 앞부분만 읽고 요약했어요", "첨부 2개는 읽지 않았어요", "본문은 요약할 때만 읽고 ERURI 서버에 저장하지 않아요"])
    XCTAssertTrue(MailSummary.copyText(x, translate: true).hasPrefix("합성학원 · 설명회 안내\n• 합성학원 설명회 안내"))
    let otp = r(#"{"status":"otp","token":"t","from":"합성은행","subject":"","date":"","summary":null,"language":"","translation":null,"translation_truncated":false,"body_truncated":false,"attachments":0,"ask":null}"#)
    XCTAssertEqual(MailSummary.body(otp, translate: false), .note("인증번호가 담긴 메일이라 요약하지 않았어요 — Gmail에서 직접 확인해 주세요"))
    let nb = r(#"{"status":"no_body","token":"t","from":"a","subject":"b","date":"","summary":null,"language":"","translation":null,"translation_truncated":false,"body_truncated":false,"attachments":1,"ask":null}"#)
    XCTAssertEqual(MailSummary.body(nb, translate: false), .note("이 메일은 읽을 수 있는 본문이 없어요(첨부나 이미지로만 된 메일일 수 있어요)"))
    let ask = r(#"{"status":"ask","token":"t","from":"a","subject":"b","date":"","summary":null,"language":"ko","translation":null,"translation_truncated":false,"body_truncated":false,"attachments":0,"ask":"어떤 환불 내용을 찾으세요?"}"#)
    XCTAssertEqual(MailSummary.body(ask, translate: false), .ask("어떤 환불 내용을 찾으세요?"))
  }

  // 스펙 §9 "오류 문구"
  func testErrorNotes() {
    XCTAssertEqual(MailSummary.searchError(status: 404, code: "no_connection"), .init("Gmail이 연결되어 있지 않아요"))
    XCTAssertEqual(MailSummary.searchError(status: 409, code: "reauth_required"), .init("Gmail 연결이 끊겼어요 — 설정 › Gmail에서 다시 연결해 주세요", settings: true))
    XCTAssertEqual(MailSummary.searchError(status: 403, code: "scope_missing"), .init("Gmail 권한을 확인하지 못했어요 — 설정 › Gmail에서 다시 연결해 주세요", settings: true))
    XCTAssertEqual(MailSummary.searchError(status: 400, code: "needs_target").text, MailSummaryText.needsTarget)
    XCTAssertEqual(MailSummary.searchError(status: 400, code: "bad_condition").text, "조건을 정확히 알아듣지 못했어요 — 발신자·제목·기간을 다시 말해 주세요")
    XCTAssertEqual(MailSummary.searchError(status: 429, code: "gmail_rate_limited").text, "Gmail이 잠시 바빠요 — 잠시 뒤 다시 요청해 주세요")
    XCTAssertEqual(MailSummary.searchError(status: 503, code: "disabled").text, "메일 요약을 지금 쓸 수 없어요")
    XCTAssertEqual(MailSummary.searchError(status: 502, code: "gmail_upstream"), .init(MailSummaryText.failed, retry: true))
    XCTAssertEqual(MailSummary.readError(status: 404, code: "mail_gone").text, "그 메일을 찾을 수 없어요 — 지워졌거나 휴지통·스팸으로 옮겨졌을 수 있어요")
    XCTAssertEqual(MailSummary.readError(status: 404, code: "not_found").text, "메일을 다시 찾아야 해요 — 다시 요청해 주세요")
    XCTAssertEqual(MailSummary.readError(status: 410, code: "token_expired").text, "앞 메일을 읽은 지 10분이 지났어요 — 발신자나 제목으로 다시 말해 주세요")
    XCTAssertEqual(MailSummary.readError(status: 429, code: "budget_exhausted").text, "이번 달 예산을 다 써서 요약할 수 없습니다(수집은 계속됩니다)")
    XCTAssertEqual(MailSummary.readError(status: 429, code: "gmail_rate_limited").text, MailSummaryText.busy)
    XCTAssertEqual(MailSummary.readError(status: 503, code: "llm_busy").text, "잠시 뒤 다시 물어보세요")
    XCTAssertEqual(MailSummary.readError(status: 502, code: "summary_failed"), .init("메일을 요약하지 못했어요 — 잠시 뒤 다시 해 주세요", retry: true))
    XCTAssertEqual(MailSummary.readError(status: -1, code: nil).retry, true)                                 // 네트워크
    XCTAssertEqual(MailSummary.retryDelay(status: 503, code: "llm_busy", attempt: 0), 5)
    XCTAssertNil(MailSummary.retryDelay(status: 503, code: "llm_busy", attempt: 1))
    XCTAssertNil(MailSummary.retryDelay(status: 503, code: "disabled", attempt: 0))
  }

  // 스펙 §9 "이어서 읽기"·D18: 바로 앞 요약 턴(ok·ask)·30분 안·target_in_message 거짓일 때만 앞 토큰
  func testFollowUp() {
    func turn(_ at: TimeInterval, status: String, readAt: TimeInterval) -> ChatHistory.Record {
      var t = MailSummaryTurn(phase: .ended)
      t.read = r(readJSON.replacingOccurrences(of: #""status":"ok""#, with: #""status":"\#(status)""#)); t.readAt = t0.addingTimeInterval(readAt)
      return ChatHistory.Record(at: t0.addingTimeInterval(at), kind: .mailSummary, question: "합성학원 메일 요약해줘", mailRead: t)
    }
    let cur = ChatHistory.Record(at: t0, kind: .question, question: "번역해줘")
    XCTAssertEqual(MailSummary.followUp([turn(-60, status: "ok", readAt: -50), cur], current: cur.id, now: t0, targetInMessage: false), .token("v1.n.t"))
    XCTAssertEqual(MailSummary.followUp([turn(-60, status: "ask", readAt: -50), cur], current: cur.id, now: t0, targetInMessage: false), .token("v1.n.t"))
    XCTAssertEqual(MailSummary.followUp([turn(-60, status: "ok", readAt: -50), cur], current: cur.id, now: t0, targetInMessage: true), .none)
    XCTAssertEqual(MailSummary.followUp([turn(-60, status: "otp", readAt: -50), cur], current: cur.id, now: t0, targetInMessage: false), .none)
    XCTAssertEqual(MailSummary.followUp([turn(-700, status: "ok", readAt: -650), cur], current: cur.id, now: t0, targetInMessage: false), .expired)
    XCTAssertEqual(MailSummary.followUp([turn(-1900, status: "ok", readAt: -1850), cur], current: cur.id, now: t0, targetInMessage: false), .none)   // 30분 넘음
    let between = ChatHistory.Record(at: t0.addingTimeInterval(-30), kind: .question, question: "다른 질문")
    XCTAssertEqual(MailSummary.followUp([turn(-60, status: "ok", readAt: -50), between, cur], current: cur.id, now: t0, targetInMessage: false), .none)
    XCTAssertEqual(MailSummary.followUp([cur], current: cur.id, now: t0, targetInMessage: false), .none)
  }

  func testFieldsFromChatMailRead_MissingTargetMeansSearch() {
    let v = try! JSONDecoder().decode(JSONValue.self, from: Data(#"{"sender":null,"translate":true,"target_in_message":false}"#.utf8))
    XCTAssertEqual(MailSummary.fields(v), .init(translate: true, targetInMessage: false))
    let w = try! JSONDecoder().decode(JSONValue.self, from: Data(#"{"sender":"합성"}"#.utf8))
    XCTAssertEqual(MailSummary.fields(w), .init(translate: false, targetInMessage: true))
    XCTAssertNil(MailSummary.fields(nil))
  }

  func testTurnDecodesLeniently_CandidatesExpireAfter10Minutes() throws {
    let raw = #"{"phase":"summarizing","translate":false,"settings":false,"future_key":1}"#
    let t = try JSONDecoder().decode(MailSummaryTurn.self, from: Data(raw.utf8))
    XCTAssertEqual(t.phase, .ended)
    let bare = try JSONDecoder().decode(MailSummaryTurn.self, from: Data(#"{"phase":"choosing"}"#.utf8))
    XCTAssertEqual([bare.translate, bare.settings], [false, false])
    var c = MailSummaryTurn(phase: .choosing); c.issuedAt = t0
    XCTAssertFalse(c.candidatesExpired(now: t0.addingTimeInterval(599)))
    XCTAssertTrue(c.candidatesExpired(now: t0.addingTimeInterval(600)))
    XCTAssertTrue(MailSummaryTurn(phase: .choosing).candidatesExpired(now: t0))
  }
}
