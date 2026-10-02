import XCTest
import UIKit
import Network
import WebKit
@testable import EruriCore

/// WKWebView 렌더러(스펙 §6 "링크·이미지 읽기"): 합성 HTML 을 네트워크 없이(loadHTMLString, 기준 주소 = 공유 주소) 창 안 다른 화면 밑에서 읽고,
/// HTTP 상태·리다이렉트·응답 없음·하위 리소스 차단은 테스트 안 루프백 서버로 본다(Fable F7). 창 안·화면 밑 렌더링(U2)·시뮬레이터 Vision 한국어(U4)·
/// 루프백 http(U5)를 여기서 판정한다. 글은 모두 합성. 시간 예산은 스왑 포화 기계를 감안해 5초 이상
final class LinkRendererTests: XCTestCase {
  struct Failed: Error { let outcome: String }
  let base = URL(string: "https://invite.example.com/m/abc?code=482913")!

  /// 테스트 호스트 앱의 장면에 새 창을 띄우고, 사용자 화면 역할의 불투명 뷰를 올린다 — 웹뷰는 그 밑에 붙는다
  @MainActor private func window() throws -> UIWindow {
    let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
    let w = UIWindow(windowScene: scene)
    w.frame = CGRect(origin: .zero, size: LinkRenderer.viewport)
    let cover = UIView(frame: w.bounds)
    cover.backgroundColor = .systemBackground
    w.addSubview(cover)
    w.isHidden = false
    return w
  }

  @MainActor private func read(_ html: String, budget: TimeInterval = 6, ocr: Bool = false) async throws -> (LinkRenderOutcome, LinkRenderer) {
    let w = try window()
    defer { w.isHidden = true }
    let r = LinkRenderer(host: w, allowLoopback: false, html: html)
    let o = await r.render(base, budget: budget, ocr: ocr)
    return (o, r)
  }

  private func page(_ o: LinkRenderOutcome) throws -> LinkPage {
    if case .page(let p, _) = o { return p }
    throw Failed(outcome: "\(o)")
  }

  /// 렌더링 중 host 맨 아래에 붙은 웹뷰를 약하게 잡는다(해제 판정용)
  @MainActor final class WeakView { weak var view: WKWebView?; var grabbed = false }

  /// render 가 돌아온 뒤 웹뷰가 within 초 안에 풀리는지 본다(L3 리뷰 P1) — 렌더링 중 host 맨 아래 웹뷰를 약하게 잡아 둔다
  @MainActor private func renderAndRelease(_ html: String, budget: TimeInterval, within: TimeInterval = 5) async throws -> (LinkRenderOutcome, Bool) {
    let w = try window()
    defer { w.isHidden = true }
    let box = WeakView()
    let grab = Task { @MainActor in
      for _ in 0..<500 {
        if let v = w.subviews.first as? WKWebView { box.view = v; box.grabbed = true; return }
        try? await Task.sleep(for: .milliseconds(10))
      }
    }
    let o = await LinkRenderer(host: w, allowLoopback: false, html: html).render(base, budget: budget, ocr: false)
    await grab.value
    let returned = Date()
    while box.view != nil, Date().timeIntervalSince(returned) < within { try await Task.sleep(for: .milliseconds(200)) }
    return (o, box.grabbed && box.view == nil)
  }

  /// 루프백 서버 주소를 DEBUG 게이트처럼(allowLoopback) 연다
  @MainActor private func load(_ path: String, port: UInt16, budget: TimeInterval = 5) async throws -> LinkRenderOutcome {
    let w = try window()
    defer { w.isHidden = true }
    return await LinkRenderer(host: w, allowLoopback: true).render(URL(string: "http://127.0.0.1:\(port)\(path)")!, budget: budget, ocr: false)
  }

  /// 서버를 띄우고 /ok 를 한 번 읽어 본다 — 루프백 http 가 ATS 로 막히면(U5) 이 클래스의 서버 테스트는 건너뛴다(LNK-sim 하네스 예외로 판정)
  @MainActor private func server() async throws -> LoopServer {
    let s = try await LoopServer.start()
    if case .failed(let code) = try await load("/ok", port: s.port), code == "load_failed" || code == "insecure" {
      s.stop()
      throw XCTSkip("U5: 루프백 http 로드 실패(\(code)) — ATS. L8 하네스 Info.plist 예외로 판정")
    }
    return s
  }

  @MainActor func testConfigurationIsEphemeralAndSilent() {
    let c = LinkRenderer.makeConfiguration()
    XCTAssertFalse(c.websiteDataStore.isPersistent)
    XCTAssertEqual(c.mediaTypesRequiringUserActionForPlayback, .all)
    XCTAssertFalse(c.preferences.javaScriptCanOpenWindowsAutomatically)
    XCTAssertTrue(c.allowsInlineMediaPlayback)          // 재생이 어떻게든 시작돼도 전체 화면 플레이어가 사용자 화면을 덮지 않게(L3 리뷰 M9)
  }

  /// 하위 리소스 차단 규칙(Codex 6, D7): JSON 이 맞고, 릴리스는 루프백까지 막는다
  func testBlockRulesAreValidJSON() throws {
    for loop in [false, true] {
      let rules = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(LinkRenderer.blockRules(allowLoopback: loop).utf8)) as? [[String: Any]])
      XCTAssertEqual(rules.count, loop ? 14 : 16)
      let filters = rules.compactMap { ($0["trigger"] as? [String: Any])?["url-filter"] as? String }
      XCTAssertEqual(filters.contains { $0.contains("127") }, !loop)
      XCTAssertTrue(filters.contains(#"^[a-z]+://([^/]*@)?192\.168\."#))     // 사용자 정보(u@)가 붙은 주소도(L3 리뷰 M2)
      XCTAssertTrue(rules.allSatisfy { ($0["action"] as? [String: Any])?["type"] as? String == "block" })
    }
    // 컴파일된 목록은 디스크에 남아 다음 실행이 찾아 쓴다 — 식별자가 규칙 내용을 따라가야 바뀐 규칙이 옛 목록에 가리지 않는다(L3 리뷰 M7)
    XCTAssertNotEqual(LinkRenderer.ruleIdentifier(allowLoopback: false), LinkRenderer.ruleIdentifier(allowLoopback: true))
    XCTAssertEqual(LinkRenderer.ruleIdentifier(allowLoopback: false), LinkRenderer.ruleIdentifier(allowLoopback: false))
  }

  @MainActor func testRuleListCompiles() async {
    let a = await LinkRenderer.ruleList(allowLoopback: false)
    let b = await LinkRenderer.ruleList(allowLoopback: true)
    XCTAssertNotNil(a)
    XCTAssertNotNil(b)
  }

  @MainActor func testStaticPageReadsMetaAndText() async throws {
    let (o, _) = try await read("""
      <html><head><title>문서 제목</title><meta property="og:title" content="합성신랑 ♥ 합성신부 결혼합니다">
      <meta property="og:description" content="2026년 11월 14일 토요일 오후 1시 30분"></head>
      <body><h1>초대합니다</h1><p>일시 2026년 11월 14일 토요일 오후 1시 30분</p><p>장소 합성웨딩홀 3층</p></body></html>
      """)
    let p = try page(o)
    XCTAssertEqual(p.host, "invite.example.com")
    XCTAssertEqual(p.title, "합성신랑 ♥ 합성신부 결혼합니다")
    XCTAssertEqual(p.description, "2026년 11월 14일 토요일 오후 1시 30분")
    XCTAssertTrue(p.body.contains("장소 합성웨딩홀 3층"))
    XCTAssertFalse(p.timedOut)
    XCTAssertNil(p.ocrText)
  }

  /// SPA: 로드 1.2초 뒤 JS 가 글을 그린다(didFinish 는 그 전에 온다) — 길이가 멈출 때까지 기다린다
  @MainActor func testDelayedScriptTextIsWaitedFor() async throws {
    let (o, _) = try await read("""
      <html><body><div id="app">불러오는 중</div><script>
      setTimeout(() => { document.getElementById('app').innerHTML = '<p>2026년 10월 24일(토) 오후 6시</p><p>합성뷔페 2층 연회장</p>'; }, 1200);
      </script></body></html>
      """)
    XCTAssertTrue(try page(o).body.contains("10월 24일"))
  }

  /// "터치해서 열기" 덮개: 본문이 display:none 이어도 숨은 글로 읽는다
  @MainActor func testHiddenCoverTextIsRead() async throws {
    let (o, _) = try await read("""
      <html><body><button>터치해서 열기</button><div style="display:none"><p>2026년 11월 14일 오후 1시</p><p>합성웨딩홀</p></div></body></html>
      """)
    let p = try page(o)
    XCTAssertFalse(p.visibleText.contains("11월 14일"))
    XCTAssertTrue(p.body.contains("11월 14일"))
  }

  /// 끝없이 늘어나는 글(카운트다운·방명록): 예산이 끝나면 그때까지 읽은 글로
  @MainActor func testNeverSettlingPageReturnsPartial() async throws {
    let (o, _) = try await read("""
      <html><body><p>2026년 11월 14일 합성 행사</p><div id="t"></div><script>
      setInterval(() => { document.getElementById('t').textContent += '가'; }, 200);
      </script></body></html>
      """, budget: 5)
    let p = try page(o)
    XCTAssertTrue(p.timedOut)
    XCTAssertTrue(p.body.contains("11월 14일"))
  }

  /// 멈춘 페이지(무한 루프 — JS 호출이 돌아오지 않는다, Codex 2): 독립 기한(예산 + 추출 몫)에 끝난다
  @MainActor func testStuckPageTimesOut() async throws {
    let started = Date()
    let (o, _) = try await read("""
      <html><body><p>2026년 11월 14일 합성 행사</p><script>setTimeout(() => { for (;;) {} }, 300);</script></body></html>
      """, budget: 5)
    XCTAssertTrue(o == .failed("timeout") || o == .failed("web_process"), "\(o)")
    XCTAssertLessThan(Date().timeIntervalSince(started), 5 + LinkRenderer.extractAllowance + 5)
  }

  /// 멈춘 페이지가 기한에 진 뒤 웹뷰가 풀린다(L3 리뷰 I1·P1b) — 내부 작업이 돌아오지 않는 JS 호출을 기다리며 웹뷰를 붙잡으면
  /// 무한 루프 WebContent 가 앱이 멈출 때까지 남는다(앱은 timeout 을 다시 시도한다). 대조: 정상 페이지는 0.5초 안에 풀린다(리뷰 P1a)
  @MainActor func testStuckPageReleasesWebView() async throws {
    let (o, released) = try await renderAndRelease("""
      <html><body><p>2026년 11월 14일 합성 행사</p><script>setTimeout(() => { for (;;) {} }, 300);</script></body></html>
      """, budget: 5)
    XCTAssertTrue(o == .failed("timeout") || o == .failed("web_process"), "\(o)")
    XCTAssertTrue(released, "render 반환 5초 뒤에도 멈춘 페이지의 웹뷰가 살아 있다")
  }

  /// 같은 문서 해시 이동(갤러리·슬라이드의 hashNavigation)은 리다이렉트로 세지 않는다(L3 리뷰 I2·P2, D7 "첫 로드 + 리다이렉트 5회")
  @MainActor func testHashChangesAreNotRedirects() async throws {
    let (o, _) = try await read("""
      <html><body><p>2026년 11월 14일 합성웨딩홀</p><script>
      let i = 0; const t = setInterval(() => { location.hash = 's' + (++i); if (i >= 8) clearInterval(t); }, 100);
      </script></body></html>
      """)
    XCTAssertTrue(try page(o).body.contains("11월 14일"))
  }

  /// 제목·설명도 자른다(2,000자 — 확장 메모리, L3 리뷰 M3). 본문은 200,000자
  @MainActor func testMetaFieldsAreCapped() async throws {
    let long = String(repeating: "가", count: 5000)
    let (o, _) = try await read("<html><head><title>\(long)</title><meta name=\"description\" content=\"\(long)\"></head><body><p>합성</p></body></html>")
    let p = try page(o)
    XCTAssertEqual(p.title.count, 2000)
    XCTAssertEqual(p.description.count, 2000)
  }

  /// 취소(앱이 비활성 — L5): 기다리지 않고 바로 cancelled
  @MainActor func testCancelReturnsCancelled() async throws {
    let w = try window()
    defer { w.isHidden = true }
    let base = self.base
    let r = LinkRenderer(host: w, allowLoopback: false, html: """
      <html><body><p>합성</p><div id="t"></div><script>setInterval(() => { document.getElementById('t').textContent += '가'; }, 200);</script></body></html>
      """)
    let t = Task { @MainActor in await r.render(base, budget: 10, ocr: false) }
    try await Task.sleep(for: .seconds(1))
    t.cancel()
    let cancelled = Date()
    let o = await t.value
    XCTAssertEqual(o, .failed("cancelled"))
    XCTAssertLessThan(Date().timeIntervalSince(cancelled), 2)
  }

  /// 앱 스킴 이동·새 창은 막고 읽기는 계속한다
  @MainActor func testAppSchemeNavigationIsBlockedAndPageStillRead() async throws {
    let (o, r) = try await read("""
      <html><body><p>2026년 11월 14일 합성웨딩홀</p><script>
      setTimeout(() => { location.href = 'kakaolink://send?x=1'; window.open('https://other.example.com/'); }, 200);
      </script></body></html>
      """)
    XCTAssertTrue(try page(o).body.contains("11월 14일"))
    XCTAssertGreaterThanOrEqual(r.blockedNavigations, 1)
  }

  /// 글 0자 + OCR 도 빈 화면 → 확정 실패 empty(앱)
  @MainActor func testEmptyPageFailsAfterOCR() async throws {
    let (o, _) = try await read("<html><body></body></html>", budget: 6, ocr: true)
    XCTAssertEqual(o, .failed("empty"))
  }

  /// 글 0자 + 글자 없는 그림만(OCR 0자) → .page 가 아니라 반드시 empty(L2 리뷰 교차 확인 a — .page 면 호스트만 든 빈 항목이 큐에 들어간다)
  @MainActor func testBlankImagePageFailsAfterOCR() async throws {
    let fmt = UIGraphicsImageRendererFormat()
    fmt.scale = 1
    let img = UIGraphicsImageRenderer(size: CGSize(width: 360, height: 240), format: fmt).image { _ in
      UIColor.white.setFill(); UIRectFill(CGRect(x: 0, y: 0, width: 360, height: 240))
    }
    let b64 = try XCTUnwrap(img.pngData()).base64EncodedString()
    let (o, _) = try await read("""
      <html><body style="margin:0"><img src="data:image/png;base64,\(b64)" width="360"><div style="display:none">   </div></body></html>
      """, budget: 6, ocr: true)
    XCTAssertEqual(o, .failed("empty"))
  }

  /// 글 0자, OCR 없음(확장, Codex 1): 실패가 아니라 빈 페이지를 돌려 확장이 no_date 로 앱에 넘긴다
  @MainActor func testEmptyPageWithoutOCRReturnsEmptyPage() async throws {
    let (o, _) = try await read("<html><body></body></html>", budget: 6, ocr: false)
    XCTAssertTrue(try page(o).isEmpty)
  }

  @MainActor func testBlockedAddressesAreNotLoaded() async throws {
    let w = try window()
    defer { w.isHidden = true }
    let r = LinkRenderer(host: w, allowLoopback: false)
    let a = await r.render(URL(string: "http://192.168.0.1/")!, budget: 5, ocr: false)
    let b = await r.render(URL(string: "kakaolink://send")!, budget: 5, ocr: false)
    XCTAssertEqual(a, .failed("blocked_host"))
    XCTAssertEqual(b, .failed("blocked_scheme"))
  }

  @MainActor func testHostOutsideWindowFails() async throws {
    let detached = UIView(frame: CGRect(origin: .zero, size: LinkRenderer.viewport))
    let o = await LinkRenderer(host: detached, allowLoopback: false).render(base, budget: 5, ocr: false)
    XCTAssertEqual(o, .failed("no_host"))
    let hidden = try window()                    // 숨은 창은 보이는 뷰가 아니다 — 타이머가 조절돼 기한까지 끌지 않고 바로 no_host(L3 리뷰 M6)
    hidden.isHidden = true
    let h = await LinkRenderer(host: hidden, allowLoopback: false).render(base, budget: 5, ocr: false)
    XCTAssertEqual(h, .failed("no_host"))
  }

  /// 이미지 전용 청첩장(D4, Codex 1): 글이 **0자**인 문서도 화면 스냅샷 OCR. 그림은 테스트 안에서 그린다(저장소에 그림 파일 없음)
  @MainActor func testImageOnlyPageUsesOCR() async throws {
    let img = UIGraphicsImageRenderer(size: CGSize(width: 360, height: 240)).image { _ in
      UIColor.white.setFill(); UIRectFill(CGRect(x: 0, y: 0, width: 360, height: 240))
      let a: [NSAttributedString.Key: Any] = [.font: UIFont.boldSystemFont(ofSize: 26), .foregroundColor: UIColor.black]
      ("2026년 12월 5일 토요일" as NSString).draw(at: CGPoint(x: 16, y: 60), withAttributes: a)
      ("합성 컨벤션 웨딩홀" as NSString).draw(at: CGPoint(x: 16, y: 120), withAttributes: a)
    }
    let b64 = try XCTUnwrap(img.pngData()).base64EncodedString()
    let (o, _) = try await read("""
      <html><body style="margin:0"><img src="data:image/png;base64,\(b64)" width="360"></body></html>
      """, budget: 8, ocr: true)
    let p = try page(o)
    XCTAssertTrue(p.visibleText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
    let t = try XCTUnwrap(p.ocrText, "OCR 결과 없음 — U4(시뮬레이터 Vision 한국어)·U2(스냅샷)를 메인에게 알린다")
    XCTAssertTrue(LinkText.hasDateCandidate(t), "OCR 글자 수 \(t.count)")
  }

  /// 이미지 전용 긴 페이지: 날짜가 둘째 화면에만 있다 — 스크롤해 다음 화면도 스냅샷 OCR(스펙 §6 "최대 3화면", L3 리뷰 M8)
  @MainActor func testOCRScrollsToNextScreen() async throws {
    let screen = LinkRenderer.viewport.height
    let img = UIGraphicsImageRenderer(size: CGSize(width: 360, height: screen * 2)).image { _ in
      UIColor.white.setFill(); UIRectFill(CGRect(x: 0, y: 0, width: 360, height: screen * 2))
      let a: [NSAttributedString.Key: Any] = [.font: UIFont.boldSystemFont(ofSize: 26), .foregroundColor: UIColor.black]
      ("2026년 12월 5일 토요일" as NSString).draw(at: CGPoint(x: 16, y: screen + 200), withAttributes: a)
      ("합성 컨벤션 웨딩홀" as NSString).draw(at: CGPoint(x: 16, y: screen + 260), withAttributes: a)
    }
    let b64 = try XCTUnwrap(img.pngData()).base64EncodedString()
    let (o, _) = try await read("""
      <html><body style="margin:0"><img src="data:image/png;base64,\(b64)" width="360"></body></html>
      """, budget: 8, ocr: true)
    let t = try XCTUnwrap(try page(o).ocrText, "둘째 화면 OCR 없음")
    XCTAssertTrue(LinkText.hasDateCandidate(t), "OCR 글자 수 \(t.count)")
  }

  /// OCR 을 끄면(확장) 날짜가 없어도 스냅샷하지 않는다
  @MainActor func testNoOCRWhenDisabled() async throws {
    let (o, _) = try await read("<html><body><p>터치하면 음악이 재생됩니다</p></body></html>", budget: 5, ocr: false)
    XCTAssertNil(try page(o).ocrText)
  }

  /// 이동 오류 → 코드(F3·U8 대체): 우리가 취소한 이동은 무시, 시간 초과·리다이렉트 초과, https 로 올린 주소의 TLS·연결 실패는 insecure
  func testLoadFailureCodes() {
    func e(_ c: Int, _ d: String = NSURLErrorDomain) -> NSError { NSError(domain: d, code: c) }
    XCTAssertNil(LinkRenderer.loadFailure(e(NSURLErrorCancelled), upgraded: false))
    XCTAssertNil(LinkRenderer.loadFailure(e(102, "WebKitErrorDomain"), upgraded: false))
    XCTAssertEqual(LinkRenderer.loadFailure(e(NSURLErrorTimedOut), upgraded: false), "timeout")
    XCTAssertEqual(LinkRenderer.loadFailure(e(NSURLErrorHTTPTooManyRedirects), upgraded: false), "redirects")
    XCTAssertEqual(LinkRenderer.loadFailure(e(NSURLErrorSecureConnectionFailed), upgraded: true), "insecure")
    XCTAssertEqual(LinkRenderer.loadFailure(e(NSURLErrorCannotConnectToHost), upgraded: true), "insecure")
    XCTAssertEqual(LinkRenderer.loadFailure(e(NSURLErrorSecureConnectionFailed), upgraded: false), "load_failed")
    XCTAssertEqual(LinkRenderer.loadFailure(e(NSURLErrorCannotFindHost), upgraded: true), "load_failed")
  }

  // MARK: 루프백 서버(Fable F7) — loadHTMLString 이 타지 않는 응답 정책·리다이렉트·요청 시간 초과

  /// U5 대조: 루프백 http 200 페이지를 읽는다
  @MainActor func testLoopbackControlLoads() async throws {
    let s = try await LoopServer.start()
    defer { s.stop() }
    let o = try await load("/ok", port: s.port)
    if case .failed(let code) = o, code == "load_failed" { throw XCTSkip("U5: 루프백 http 가 ATS 로 막힌다 — L8 Step 2 하네스 예외") }
    XCTAssertTrue(try page(o).body.contains("11월 14일"))
  }

  @MainActor func testHTTPErrorFails() async throws {
    let s = try await server()
    defer { s.stop() }
    let o = try await load("/missing", port: s.port)
    XCTAssertEqual(o, .failed("http_404"))
  }

  /// 페이지가 선 뒤 JS 이동이 404 를 받아도 실패가 아니다 — 지금 페이지를 계속 읽고, 실패한 이동을 예산까지 기다리지 않는다(L3 리뷰 I2)
  @MainActor func testHTTPErrorAfterCommitKeepsPage() async throws {
    let s = try await server()
    defer { s.stop() }
    let o = try await load("/later404", port: s.port, budget: 6)
    guard case .page(let p, let ms) = o else { return XCTFail("\(o)") }
    XCTAssertTrue(p.body.contains("11월 14일"))
    XCTAssertEqual(s.hits("/missing"), 1)                // JS 이동이 실제로 났다
    XCTAssertLessThan(ms, 3500, "실패한 뒤 이동의 didFinish 를 기다렸다")
  }

  /// 서기 전 리다이렉트가 앱 스킴으로 간다: 읽을 페이지가 없다 — 예산을 기다리지 않고 blocked_scheme(L3 리뷰 M1·P3)
  @MainActor func testPreCommitAppSchemeRedirectFailsAtOnce() async throws {
    let s = try await server()
    defer { s.stop() }
    let started = Date()
    let o = try await load("/app", port: s.port, budget: 6)
    XCTAssertEqual(o, .failed("blocked_scheme"))
    XCTAssertLessThan(Date().timeIntervalSince(started), 3)
  }

  /// 렌더러 재사용(앱 drain 은 한 인스턴스로 차례로 읽는다): 기한에 진 멈춘 페이지 다음 렌더링도 정상으로 읽는다 —
  /// 진 렌더링의 내부 작업·위임 콜백이 다음 렌더링 상태를 바꾸지 않는다(webView === current, L3 리뷰 M8)
  @MainActor func testRendererReuseAfterLostRace() async throws {
    let s = try await server()
    defer { s.stop() }
    let w = try window()
    defer { w.isHidden = true }
    let r = LinkRenderer(host: w, allowLoopback: true)
    let a = await r.render(URL(string: "http://127.0.0.1:\(s.port)/stuck")!, budget: 5, ocr: false)
    XCTAssertTrue(a == .failed("timeout") || a == .failed("web_process"), "\(a)")
    let b = await r.render(URL(string: "http://127.0.0.1:\(s.port)/ok")!, budget: 5, ocr: false)
    XCTAssertTrue(try page(b).body.contains("11월 14일"))
  }

  /// 302 가 끝없이 이어진다: 메인 프레임 이동 6회 초과 또는 WebKit 의 리다이렉트 초과(-1007) — 어느 쪽이든 redirects
  @MainActor func testTooManyRedirectsFail() async throws {
    let s = try await server()
    defer { s.stop() }
    let o = try await load("/loop/0", port: s.port, budget: 8)
    XCTAssertEqual(o, .failed("redirects"))
  }

  /// 응답이 오지 않는다: 요청 시간 초과(-1001) 또는 예산 — 어느 쪽이든 timeout
  @MainActor func testNoResponseTimesOut() async throws {
    let s = try await server()
    defer { s.stop() }
    let o = try await load("/hang", port: s.port, budget: 5)
    XCTAssertEqual(o, .failed("timeout"))
  }

  /// 하위 리소스·하위 프레임의 사설 주소(Codex 6): 이미지는 콘텐츠 규칙, iframe 은 위임 메서드(·규칙)가 막는다 — 서버에 요청이 오지 않는다
  @MainActor func testPrivateSubresourcesAreBlocked() async throws {
    let s = try await server()
    defer { s.stop() }
    let doc = """
      <html><body><p>2026년 11월 14일 합성웨딩홀</p><img src="http://127.0.0.1:\(s.port)/pixel"><iframe src="http://127.0.0.1:\(s.port)/frame"></iframe>
      <img src="http://u@127.0.0.1:\(s.port)/cred"></body></html>
      """
    let plain = URL(string: "http://invite.example.com/m/abc")!            // 대조군에서 혼합 콘텐츠 차단을 피하려고 http 기준 주소(네트워크 로드는 없다)
    let w = try window()
    defer { w.isHidden = true }
    _ = await LinkRenderer(host: w, allowLoopback: true, html: doc).render(plain, budget: 5, ocr: false)       // 대조: 루프백 허용이면 요청이 간다
    try XCTSkipIf(s.hits("/pixel") == 0, "대조군 0 — 하위 리소스 루프백 요청이 다른 이유로 막힌다. 규칙 판정은 L8 G9 옆에서")
    XCTAssertGreaterThan(s.hits("/cred"), 0, "대조군: 사용자 정보가 붙은 주소도 요청이 간다")
    // 대조군 웹뷰를 뗀 뒤에도 /pixel 요청이 한 번 더 늦게 온다(시뮬레이터 실측 1 → 2) — 요청 수가 1.5초 멈출 때까지 기다려 실험군에 섞이지 않게
    var seen = -1, still = Date()
    for _ in 0..<12 {
      let n = s.hits("/pixel") + s.hits("/frame") + s.hits("/cred")
      if n != seen { seen = n; still = Date() } else if Date().timeIntervalSince(still) >= 1.5 { break }
      try await Task.sleep(for: .milliseconds(500))
    }
    let pixel = s.hits("/pixel"), frame = s.hits("/frame"), cred = s.hits("/cred")
    let r = LinkRenderer(host: w, allowLoopback: false, html: doc)
    let o = await r.render(plain, budget: 5, ocr: false)
    XCTAssertTrue(try page(o).body.contains("11월 14일"))
    XCTAssertEqual(s.hits("/pixel"), pixel)
    XCTAssertEqual(s.hits("/frame"), frame)
    XCTAssertEqual(s.hits("/cred"), cred, "u@127.0.0.1 이 규칙을 우회했다(L3 리뷰 M2)")
  }
}

/// 테스트 안 루프백 HTTP 서버(Network, 127.0.0.1 임의 포트, 연결마다 요청 하나).
/// /ok 200(날짜 있는 글) · /missing 404 · /loop/<n> 302 → /loop/<n+1> · /hang 답하지 않음 · /app 302 → 앱 스킴 ·
/// /later404 200(날짜, 0.3초 뒤 JS 로 /missing) · /stuck 200(날짜, 0.3초 뒤 무한 루프) · 그 밖 200 빈 본문
final class LoopServer: @unchecked Sendable {
  private let listener: NWListener
  private let queue = DispatchQueue(label: "link-loop-server")
  private var paths: [String] = []                 // queue 에서만 고친다
  private var held: [Conn] = []
  private(set) var port: UInt16 = 0

  /// NWConnection 을 Sendable 클로저로 넘기는 상자(queue 에서만 쓴다)
  final class Conn: @unchecked Sendable { let c: NWConnection; init(_ c: NWConnection) { self.c = c } }
  /// 한 번만 참(queue 에서만 부른다)
  final class Once: @unchecked Sendable { private var done = false; func take() -> Bool { defer { done = true }; return !done } }

  private init() throws {
    let params = NWParameters.tcp
    params.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: .any)
    listener = try NWListener(using: params)
  }

  static func start() async throws -> LoopServer {
    let s = try LoopServer()
    s.port = try await s.listen()
    return s
  }

  private func listen() async throws -> UInt16 {
    listener.newConnectionHandler = { [weak self] c in self?.serve(Conn(c)) }
    return try await withCheckedThrowingContinuation { (k: CheckedContinuation<UInt16, Error>) in
      let once = Once()
      listener.stateUpdateHandler = { [self] state in
        switch state {
        case .ready: if once.take() { k.resume(returning: self.listener.port?.rawValue ?? 0) }
        case .failed(let e): if once.take() { k.resume(throwing: e) }
        default: break
        }
      }
      listener.start(queue: queue)
    }
  }

  func stop() {
    listener.cancel()
    queue.sync { held.forEach { $0.c.cancel() }; held.removeAll() }
  }

  func hits(_ path: String) -> Int { queue.sync { paths.filter { $0 == path }.count } }

  private func serve(_ conn: Conn) {
    conn.c.start(queue: queue)
    conn.c.receive(minimumIncompleteLength: 1, maximumLength: 16_384) { [weak self] data, _, _, _ in
      guard let self, let data, let line = String(decoding: data, as: UTF8.self).split(separator: "\r\n").first,
            let path = line.split(separator: " ").dropFirst().first.map(String.init) else { conn.c.cancel(); return }
      self.paths.append(path)
      guard let resp = Self.response(path) else { self.held.append(conn); return }       // /hang: 답하지 않고 연결만 쥔다
      conn.c.send(content: Data(resp.utf8), completion: .contentProcessed { _ in conn.c.cancel() })
    }
  }

  static func response(_ path: String) -> String? {
    func r(_ status: String, _ extra: String = "", _ body: String = "") -> String {
      "HTTP/1.1 \(status)\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: \(body.utf8.count)\r\nConnection: close\r\n\(extra)\r\n\(body)"
    }
    switch path {
    case "/ok": return r("200 OK", "", "<html><body><p>2026년 11월 14일 합성웨딩홀</p></body></html>")
    case "/missing": return r("404 Not Found", "", "<html><body>없음</body></html>")
    case "/hang": return nil
    case "/app": return r("302 Found", "Location: kakaolink://send?x=1\r\n")
    case "/later404": return r("200 OK", "", "<html><body><p>2026년 11월 14일 합성웨딩홀</p><script>setTimeout(() => { location.href = '/missing'; }, 300);</script></body></html>")
    case "/stuck": return r("200 OK", "", "<html><body><p>2026년 11월 14일 합성웨딩홀</p><script>setTimeout(() => { for (;;) {} }, 300);</script></body></html>")
    case let p where p.hasPrefix("/loop/"): return r("302 Found", "Location: /loop/\((Int(p.dropFirst(6)) ?? 0) + 1)\r\n")
    default: return r("200 OK")
    }
  }
}
