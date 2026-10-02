import XCTest
@testable import EruriCore

/// 링크 → 일정(스펙 §6 "링크·이미지 읽기"): 판정·주소 검사·같은 링크 id·날짜 후보·본문 만들기·대기 판정. 글은 모두 합성
final class LinkTextTests: XCTestCase {
  let invite = URL(string: "https://invite.example.com/m/abc?code=482913")!

  /// 채팅(스펙 §9): http(s):// 주소가 정확히 하나 + 짧은 메모면 링크 수집. 둘 이상은 안내, 스킴 없는 도메인은 질문
  func testChatIntent() {
    XCTAssertEqual(LinkText.chatIntent("https://invite.example.com/m/abc?code=482913"), .link(invite, note: nil))
    XCTAssertEqual(LinkText.chatIntent("청첩장 https://invite.example.com/m/abc?code=482913 이에요"), .link(invite, note: "청첩장 이에요"))
    XCTAssertEqual(LinkText.chatIntent("내일 치과 몇 시야?"), .none)
    XCTAssertEqual(LinkText.chatIntent("naver.com 에서 산 거 언제야"), .none)
    XCTAssertEqual(LinkText.chatIntent("ftp://files.example.com/x"), .none)
    XCTAssertEqual(LinkText.chatIntent("https://a.example.com/1 https://b.example.com/2"), .tooMany(2))
    XCTAssertEqual(LinkText.chatIntent("https://a.example.com/1 다시 https://a.example.com/1"),
                   .link(URL(string: "https://a.example.com/1")!, note: "다시"))               // 같은 주소 두 번은 하나
    // 주소에 한글이 붙어 있다 — 첫 비 ASCII 글자에서 주소가 끝난다(NSDataDetector 경계를 고정)
    XCTAssertEqual(LinkText.chatIntent("https://a.example.com/1이에요"), .link(URL(string: "https://a.example.com/1")!, note: "이에요"))
    // 끝 ?·: 는 주소가 아니다(리뷰 Minor 3), 영숫자·한글 없는 메모는 없음(Minor 4)
    let one = URL(string: "https://a.example.com/1")!
    XCTAssertEqual(LinkText.chatIntent("https://a.example.com/1?"), .link(one, note: nil))
    XCTAssertEqual(LinkText.chatIntent("https://a.example.com/1:"), .link(one, note: nil))
    XCTAssertEqual(LinkText.chatIntent("여기 https://a.example.com/1?"), .link(one, note: "여기 ?"))
    XCTAssertEqual(LinkText.chatIntent("(https://a.example.com/1)"), .link(one, note: nil))
    XCTAssertEqual(LinkText.chatIntent("\"https://a.example.com/1\"."), .link(one, note: nil))
  }

  /// 공유(스펙 §6): ShareText.compose 결과에 주소가 정확히 하나 + 짧은 메모일 때만 링크. 나머지는 지금처럼 텍스트 공유
  func testShareLink() {
    let one = LinkText.shareLink("합성 청첩장\nhttps://invite.example.com/m/abc?code=482913")
    XCTAssertEqual(one?.url, invite)
    XCTAssertEqual(one?.note, "합성 청첩장")
    XCTAssertNil(LinkText.shareLink("[합성] 10월 20일 오후 2시 회의"))
    XCTAssertNil(LinkText.shareLink("https://a.example.com/1\nhttps://b.example.com/2"))
  }

  /// 주소 하나가 든 긴 공지·날짜가 있는 글은 링크가 아니다(Fable F1 — 본문이 메모로 잘리고 페이지 실패 시 사라지는 회귀 방지)
  func testLongTextWithURLIsNotALink() {
    let notice = String(repeating: "합성 동호회 공지 내용입니다. ", count: 12) + "자료 https://docs.example.com/a"
    XCTAssertEqual(LinkText.linkCandidate(notice), .text)
    XCTAssertNil(LinkText.shareLink(notice))
    XCTAssertEqual(LinkText.chatIntent(notice), .none)
    let dated = "10월 20일 오후 2시 회의, 자료 https://docs.example.com/a"
    XCTAssertEqual(LinkText.linkCandidate(dated), .text)
    XCTAssertNil(LinkText.shareLink(dated))
    XCTAssertEqual(LinkText.chatIntent(dated), .none)
    XCTAssertEqual(LinkText.linkCandidate("합성 공지"), .none)
  }

  /// 주소 검사(스펙 §6): http(s)만, 사설·루프백·링크로컬·CGNAT IP 리터럴과 로컬 이름 거부. DEBUG 게이트만 루프백 허용
  func testCheck() {
    func c(_ s: String, loop: Bool = false) -> LinkText.Blocked? { LinkText.check(URL(string: s)!, allowLoopback: loop) }
    XCTAssertNil(c("https://invite.example.com/x"))
    XCTAssertNil(c("http://invite.example.com/x"))                                            // 검사 통과 — 실제 로드는 https 로 올린다(L3, upgraded)
    XCTAssertNil(c("http://93.184.216.34/"))
    XCTAssertNil(c("https://[2606:4700::1111]/"))
    XCTAssertEqual(c("kakaolink://send?x=1"), .scheme)
    XCTAssertEqual(c("file:///etc/hosts"), .scheme)
    for h in ["http://10.0.0.1/", "http://192.168.0.1/", "http://172.20.1.1/", "http://169.254.1.1/", "http://100.64.0.1/",
              "http://0.0.0.0/", "http://224.0.0.1/", "http://127.0.0.1:8765/", "http://localhost:8765/", "http://router.local/",
              "http://intranet/", "http://svc.internal/", "http://[::1]/", "http://[fe80::1]/", "http://[fd00::1]/", "http://[2001:db8::1]/"] {
      XCTAssertEqual(c(h), .host, h)
    }
    // WebKit(WHATWG)이 IPv4 로 정규화하는 변형(리뷰 Minor 2): 끝 점·축약·16진·8진(앞 0) — 엄격한 10진 4부가 아니면 막는다
    for h in ["http://127.0.0.1./", "http://192.168.0.1./", "http://127.1/", "http://0x7f.0.0.1/", "http://0177.0.0.1/",
              "http://012.0.0.1/", "http://2130706433/", "http://[2002:c0a8:1::1]/"] {
      XCTAssertEqual(c(h), .host, h)
    }
    XCTAssertNil(c("http://93.184.216.34./"))
    XCTAssertNil(c("https://a1.example.com/"))
    XCTAssertNil(c("http://127.0.0.1:8765/link-wedding.html", loop: true))
    XCTAssertNil(c("http://localhost:8765/link-wedding.html", loop: true))
    XCTAssertEqual(c("http://10.0.0.1/", loop: true), .host)                                   // 루프백만 풀린다
  }

  /// http 는 https 로 올려 연다(F24 — 앱·확장에 ATS 예외가 없다). DEBUG 루프백만 그대로
  func testUpgraded() {
    func u(_ s: String, loop: Bool = false) -> String { LinkText.upgraded(URL(string: s)!, allowLoopback: loop).absoluteString }
    XCTAssertEqual(u("http://invite.example.com/m/abc?code=1"), "https://invite.example.com/m/abc?code=1")
    XCTAssertEqual(u("http://invite.example.com:80/x"), "https://invite.example.com/x")
    XCTAssertEqual(u("https://invite.example.com/x"), "https://invite.example.com/x")
    XCTAssertEqual(u("http://127.0.0.1:8765/a.html", loop: true), "http://127.0.0.1:8765/a.html")
    XCTAssertEqual(u("http://127.0.0.1:8765/a.html"), "https://127.0.0.1:8765/a.html")        // 어차피 check 가 막는다
  }

  /// 같은 링크 = 같은 캡처 id(스펙 §6 "같은 링크"): 조각·스킴(http/https)·호스트 대소문자는 무시, 쿼리는 구분
  func testCaptureID() {
    let a = LinkText.captureID(for: URL(string: "https://invite.example.com/m/abc?code=1#gallery")!)
    let b = LinkText.captureID(for: URL(string: "http://INVITE.example.com/m/abc?code=1")!)
    let c = LinkText.captureID(for: URL(string: "https://invite.example.com/m/abc?code=2")!)
    XCTAssertEqual(a, b)
    XCTAssertNotEqual(a, c)
    XCTAssertNotNil(UUID(uuidString: a))
    XCTAssertEqual(a, LinkText.captureID(for: URL(string: "https://invite.example.com/m/abc?code=1")!))   // 실행마다 같다
    XCTAssertEqual(LinkText.captureID(for: URL(string: "https://a.example.com")!),
                   LinkText.captureID(for: URL(string: "https://a.example.com/")!))            // 빈 경로 = "/"(리뷰 Minor 3)
  }

  func testDateCandidates() {
    for s in ["2026년 11월 14일 토요일", "11월 14일", "2026.11.14", "2026-11-14", "2026. 12. 5. SAT", "11/14", "11. 14.(토)",
              "Nov 14, 2026", "December 5"] {
      XCTAssertTrue(LinkText.hasDateCandidate(s), s)
    }
    for s in ["오후 1시 30분", "합성웨딩홀 3층", "010-1234-5678", "터치하면 음악이 재생됩니다", "축의금 50,000원",
              "market 5", "decent 3", "Junior 2", "Marathon 10"] {
      XCTAssertFalse(LinkText.hasDateCandidate(s), s)
    }
    for s in ["11 . 14 . ( 토", "11.14.\n(토)", "Sept 5", "March 3", "Dec. 24"] { XCTAssertTrue(LinkText.hasDateCandidate(s), s) }
  }

  /// 날짜 후보는 정리 전 원문(숨은 글 200,000자까지)에 돈다 — "1.1" + 공백 5만 자가 2차 백트래킹으로 수십 초 걸리지 않는다(리뷰 I1).
  /// 고치기 전 실측 4만 자 27초. 상한은 스왑 포화를 감안한 5초(계획 "기계")
  func testDateCandidateWhitespaceFloodIsFast() {
    let flood = "1.1" + String(repeating: " \n", count: 25_000)
    let t0 = Date()
    XCTAssertFalse(LinkText.hasDateCandidate(flood))
    let p = LinkPage(host: "x.example.com", visibleText: "합성", allText: flood)
    _ = p.body; _ = p.isEmpty
    XCTAssertLessThan(Date().timeIntervalSince(t0), 5)
  }

  /// "터치해서 열기" 덮개(스펙 §6): 보이는 글에 날짜가 없고 숨은 글에 있으면 숨은 글
  func testBodyPrefersHiddenTextWhenOnlyItHasDate() {
    let p = LinkPage(host: "invite.example.com", visibleText: "터치해서 열기", allText: "터치해서 열기\n2026년 11월 14일 오후 1시 합성웨딩홀")
    XCTAssertTrue(p.body.contains("11월 14일"))
    let q = LinkPage(host: "x.example.com", visibleText: "2026년 11월 14일 합성웨딩홀", allText: "메뉴\n2026년 11월 14일 합성웨딩홀\n숨은 글")
    XCTAssertEqual(q.body, "2026년 11월 14일 합성웨딩홀")
    XCTAssertEqual(LinkPage(host: "x.example.com", visibleText: "  ", allText: "합성 안내문").body, "합성 안내문")
    XCTAssertTrue(LinkPage(host: "x.example.com").isEmpty)
  }

  /// 빈 페이지 판정은 날짜 판정 없이 — 제목·설명·보이는 글·숨은 글·OCR 이 모두 공백이면 빈 페이지(searchable 판정과 같다).
  /// 본문(body)을 다시 계산하면 200,000자 페이지에서 날짜 판정이 두 번 더 돈다(L3 리뷰 M4)
  func testIsEmptyMatchesSearchable() {
    let pages = [LinkPage(host: "x"), LinkPage(host: "x", title: " \n"), LinkPage(host: "x", title: "합성"), LinkPage(host: "x", description: "설명"),
                 LinkPage(host: "x", visibleText: "  ", allText: "숨은 글"), LinkPage(host: "x", visibleText: "보이는 글"),
                 LinkPage(host: "x", visibleText: " ", allText: "\n\t"), LinkPage(host: "x", ocrText: "OCR"), LinkPage(host: "x", ocrText: "  ")]
    for p in pages { XCTAssertEqual(p.isEmpty, p.searchable.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, "\(p)") }
  }

  func testDecode() {
    let json = #"{"title":"문서 제목","ogTitle":"합성신랑 ♥ 합성신부","ogDescription":"11월 14일","text":"보이는 글","all":"전체 글"}"#
    let p = LinkPage.decode(json: json, host: "invite.example.com")
    XCTAssertEqual(p?.host, "invite.example.com")
    XCTAssertEqual(p?.title, "합성신랑 ♥ 합성신부")
    XCTAssertEqual(p?.description, "11월 14일")
    XCTAssertEqual(p?.visibleText, "보이는 글")
    XCTAssertEqual(p?.allText, "전체 글")
    XCTAssertEqual(LinkPage.decode(json: #"{"title":"문서 제목","ogTitle":""}"#, host: "h.example.com")?.title, "문서 제목")
    XCTAssertNil(LinkPage.decode(json: "not json", host: "h.example.com"))
  }

  /// 보내는 글 형식(스펙 §6): 머리 줄 → 본문(공백 정리·같은 줄 제거). 메모는 한 줄로. 넘치지 않으면 일시·장소 줄 블록이 없다
  func testComposeFormat() {
    let p = LinkPage(host: "invite.example.com", title: "합성신랑 ♥ 합성신부 결혼합니다", description: "2026년 11월 14일 토요일 오후 1시 30분",
                     visibleText: "일시\n2026년 11월 14일 토요일 오후 1시 30분\n\n장소\n합성웨딩홀   3층\n일시")
    let c = LinkText.compose(p, note: "  청첩장 \n 보내요 ")
    XCTAssertEqual(c.title, "합성신랑 ♥ 합성신부 결혼합니다")
    XCTAssertEqual(c.text, """
      [웹 링크] invite.example.com
      제목: 합성신랑 ♥ 합성신부 결혼합니다
      설명: 2026년 11월 14일 토요일 오후 1시 30분
      메모: 청첩장 보내요
      본문:
      일시
      2026년 11월 14일 토요일 오후 1시 30분
      장소
      합성웨딩홀 3층
      """)
    XCTAssertFalse(c.truncated)
  }

  /// 주소는 호스트만(스펙 §6): 쿼리 숫자가 OTP 규칙에 걸리지 않게
  func testComposeKeepsHostOnly() {
    let c = LinkText.compose(LinkPage(host: "invite.example.com", visibleText: "본문"), note: nil)
    XCTAssertTrue(c.text.hasPrefix("[웹 링크] invite.example.com\n"))
    XCTAssertFalse(c.text.contains("482913"))
    XCTAssertFalse(c.text.contains("code"))
    XCTAssertNil(c.title)
  }

  func testComposeDropsDescriptionInsideTitle() {
    let c = LinkText.compose(LinkPage(host: "h.example.com", title: "합성 북토크 10월 21일", description: "합성 북토크", visibleText: "본문"), note: nil)
    XCTAssertFalse(c.text.contains("설명:"))
  }

  /// 긴 페이지(Fable F2): 일시·장소 줄을 본문 **앞**에 둔다 — 서버 Jev 게이트는 본문 앞 2,000자만 본다(F23). 전체 4,000자
  func testComposeTruncatesAndKeepsKeyLinesFirst() throws {
    let filler = (1...400).map { "합성 갤러리 사진 설명 \($0)번" }
    let p = LinkPage(host: "h.example.com",
                     visibleText: (filler + ["예식 일시 2026년 11월 14일 오후 1시", "장소 합성웨딩홀 3층", "방명록 남기기"]).joined(separator: "\n"))
    let c = LinkText.compose(p, note: nil)
    XCTAssertTrue(c.truncated)
    XCTAssertLessThanOrEqual(c.text.count, LinkText.maxChars)
    XCTAssertTrue(c.text.contains("일시·장소 줄:\n예식 일시 2026년 11월 14일 오후 1시\n장소 합성웨딩홀 3층\n본문:\n합성 갤러리 사진 설명 1번\n"))
    let key = try XCTUnwrap(c.text.range(of: "예식 일시"))
    XCTAssertLessThan(c.text.distance(from: c.text.startIndex, to: key.lowerBound), 2000)
    XCTAssertFalse(c.text.contains("방명록 남기기"))
  }

  func testComposeOCRBlock() {
    let p = LinkPage(host: "card.example.com", title: "모바일 청첩장", visibleText: "터치하면 음악이 재생됩니다",
                     ocrText: "합성민수 그리고 합성지은\n2026. 12. 5. SAT PM 12:00\n\n합성 컨벤션 웨딩홀 5층")
    XCTAssertEqual(LinkText.compose(p, note: nil).text, """
      [웹 링크] card.example.com
      제목: 모바일 청첩장
      본문:
      터치하면 음악이 재생됩니다
      이미지 속 글자:
      합성민수 그리고 합성지은
      2026. 12. 5. SAT PM 12:00
      합성 컨벤션 웨딩홀 5층
      """)
  }

  /// 대기(스펙 §6): didFinish(또는 4초) 뒤 같은 길이 3번이면 완료
  func testSettle() {
    var s = LinkSettle(budget: 10)
    XCTAssertEqual(s.observe(length: 0, finished: false, elapsed: 0.5), .wait)
    XCTAssertEqual(s.observe(length: 120, finished: true, elapsed: 1.0), .wait)
    XCTAssertEqual(s.observe(length: 120, finished: true, elapsed: 1.5), .wait)
    XCTAssertEqual(s.observe(length: 120, finished: true, elapsed: 2.0), .done)
    var g = LinkSettle(budget: 10)
    for t in [0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5] { XCTAssertEqual(g.observe(length: 80, finished: false, elapsed: t), .wait) }
    XCTAssertEqual(g.observe(length: 80, finished: false, elapsed: 4.0), .done)
    // didFinish 전 샘플은 "3번 같음"에 들지 않는다(스펙 §6 "didFinish 뒤 … 3번") — HTML 의 고정 "로딩 중…" 글에서 바로 끝내지 않는다
    var h = LinkSettle(budget: 10)
    XCTAssertEqual(h.observe(length: 120, finished: false, elapsed: 0.5), .wait)
    XCTAssertEqual(h.observe(length: 120, finished: false, elapsed: 1.0), .wait)
    XCTAssertEqual(h.observe(length: 120, finished: true, elapsed: 1.5), .wait)
    XCTAssertEqual(h.observe(length: 120, finished: true, elapsed: 2.0), .wait)
    XCTAssertEqual(h.observe(length: 120, finished: true, elapsed: 2.5), .done)
  }

  /// 글 0자(Codex 1 — 순수 이미지 페이지): didFinish **뒤** 4초가 지나야 완료(스펙 §6 "대기" — SPA 가 그릴 시간). didFinish 전 0자는 계속 기다린다
  func testSettleEmptyPage() {
    var e = LinkSettle(budget: 10)
    for t in stride(from: 1.0, through: 4.5, by: 0.5) { XCTAssertEqual(e.observe(length: 0, finished: true, elapsed: t), .wait, "\(t)") }
    XCTAssertEqual(e.observe(length: 0, finished: true, elapsed: 5.0), .done)
    // 늦은 didFinish(느린 망, 5초): 로드 시작 기준이 아니라 didFinish 기준 4초 — 9초에 완료
    var l = LinkSettle(budget: 10)
    for t in stride(from: 0.5, through: 4.5, by: 0.5) { XCTAssertEqual(l.observe(length: 0, finished: false, elapsed: t), .wait, "\(t)") }
    for t in stride(from: 5.0, through: 8.5, by: 0.5) { XCTAssertEqual(l.observe(length: 0, finished: true, elapsed: t), .wait, "\(t)") }
    XCTAssertEqual(l.observe(length: 0, finished: true, elapsed: 9.0), .done)
    var n = LinkSettle(budget: 10)
    for t in stride(from: 0.5, through: 9.5, by: 0.5) { XCTAssertEqual(n.observe(length: 0, finished: false, elapsed: t), .wait) }
    XCTAssertEqual(n.observe(length: 0, finished: false, elapsed: 10), .deadline)
  }

  /// 끝없이 바뀌는 페이지: 예산이 끝나면 deadline
  func testSettleDeadline() {
    var s = LinkSettle(budget: 3)
    var n = 0, t = 0.0
    while t < 3 { n += 10; XCTAssertEqual(s.observe(length: n, finished: true, elapsed: t), .wait); t += 0.5 }
    XCTAssertEqual(s.observe(length: n + 10, finished: true, elapsed: 3.0), .deadline)
  }
}
