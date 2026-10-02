import UIKit
import WebKit

/// 보이지 않는 웹뷰로 페이지를 읽는다(스펙 §6 "링크·이미지 읽기"). WebKit 이라 메인 액터에서만.
/// 웹뷰는 실제 화면 크기로 host(창 안에 있는 뷰)의 **맨 아래**에 붙는다 — WebKit 은 창 안·foreground 일 때만 보이는 뷰로 다뤄 렌더링·타이머를 돌린다(F16)
@MainActor public final class LinkRenderer: NSObject, LinkRendering, WKNavigationDelegate, WKUIDelegate {
  public static let viewport = CGSize(width: 390, height: 844)
  /// 페이지가 서기 전 메인 프레임 이동 상한(첫 로드 + 리다이렉트 5회)
  public static let maxNavigations = 6
  public static let ocrScreens = 3
  /// 예산 뒤 추출·마무리 몫(초). 독립 기한 = 예산 + 이것 + (OCR 이면) ocrAllowance — 확장 12초, 앱 25초(D15)
  public static let extractAllowance: TimeInterval = 2
  public static let ocrAllowance: TimeInterval = 8
  static let subframeSchemes: Set<String> = ["http", "https", "about", "data", "blob"]
  private static var ruleLists: [Bool: WKContentRuleList] = [:]

  private weak var host: UIView?
  private let allowLoopback: Bool
  private let html: String?
  /// 지금 렌더링 중인 웹뷰 — 위임 콜백은 이 웹뷰의 것만 반영한다(경주에서 진 이전 렌더링이 상태를 바꾸지 않게)
  private weak var current: WKWebView?
  private var finished = false, committed = false, failure: String?, navigations = 0, upgradedScheme = false
  /// 이번 렌더링에서 막은 이동 수(앱 스킴·새 창·사설 주소, 하위 프레임 포함) — 진단용
  public private(set) var blockedNavigations = 0

  /// host = 창 안에 있는 뷰(확장: 시트 루트 뷰, 앱: 키 창). html = 테스트 전용 — 네트워크 대신 그 문서를 url 기준으로 연다
  public init(host: UIView, allowLoopback: Bool, html: String? = nil) {
    self.host = host; self.allowLoopback = allowLoopback; self.html = html
  }

  public static func makeConfiguration() -> WKWebViewConfiguration {
    let c = WKWebViewConfiguration()
    c.websiteDataStore = .nonPersistent()                          // 쿠키·저장소를 디스크에 남기지 않는다(F17)
    c.mediaTypesRequiringUserActionForPlayback = .all              // 청첩장 배경 음악 자동 재생 금지
    c.allowsInlineMediaPlayback = true                             // 재생이 어떻게든 시작돼도 전체 화면 플레이어가 사용자 화면을 덮지 않게
    c.preferences.javaScriptCanOpenWindowsAutomatically = false
    c.defaultWebpagePreferences.allowsContentJavaScript = true     // SPA 청첩장은 JS 로 글을 그린다
    return c
  }

  /// 하위 리소스(이미지·fetch·XHR·iframe — 모든 종류)의 사설 IP 리터럴·localhost·.local 요청 차단 규칙(Codex 6, D7). 앞선 실행이 컴파일해 둔 목록을 먼저 찾고,
  /// 없으면 한 번 컴파일해 재사용한다. 실패하면 nil(위임 메서드의 프레임 검사만 남는다 — DiagLog 에 코드만)
  public static func ruleList(allowLoopback: Bool) async -> WKContentRuleList? {
    if let l = ruleLists[allowLoopback] { return l }
    guard let store = WKContentRuleListStore.default() else { return nil }
    let id = ruleIdentifier(allowLoopback: allowLoopback)
    var l: WKContentRuleList? = try? await store.contentRuleList(forIdentifier: id)
    if l == nil { l = try? await store.compileContentRuleList(forIdentifier: id, encodedContentRuleList: blockRules(allowLoopback: allowLoopback)) }
    if let l { ruleLists[allowLoopback] = l } else { DiagLog.append("link rules compile_failed") }
    return l
  }

  /// 규칙 저장소 식별자 — 규칙 JSON 의 FNV-1a 해시를 붙인다. 컴파일된 목록은 디스크에 남으므로, 규칙이 바뀌면 옛 목록을 찾지 않고 새로 컴파일하게
  nonisolated static func ruleIdentifier(allowLoopback: Bool) -> String {
    var h: UInt64 = 0xcbf2_9ce4_8422_2325
    for b in blockRules(allowLoopback: allowLoopback).utf8 { h = (h ^ UInt64(b)) &* 0x100_0000_01b3 }
    return "eruri-link-private-" + String(h, radix: 16)
  }

  /// 규칙 JSON. WebKit 콘텐츠 규칙의 url-filter 는 `|`·`{n}` 을 지원하지 않아 대역마다 규칙 하나. 사용자 정보(`u@`)가 붙은 주소도 같은 대역으로 본다.
  /// 공개 이름이 사설 주소로 풀리는 경우는 막지 않는다(스펙 §6)
  nonisolated static func blockRules(allowLoopback: Bool) -> String {
    var hosts = [#"10\\."#, #"192\\.168\\."#, #"169\\.254\\."#, #"172\\.1[6-9]\\."#, #"172\\.2[0-9]\\."#, #"172\\.3[01]\\."#,
                 #"100\\.6[4-9]\\."#, #"100\\.[7-9][0-9]\\."#, #"100\\.1[01][0-9]\\."#, #"100\\.12[0-7]\\."#, #"0\\."#,
                 #"\\[f"#, #"\\[::"#, #"[a-z0-9.-]*\\.local[:/]"#]
    if !allowLoopback { hosts += [#"127\\."#, #"localhost[:/]"#] }
    let rules = hosts.map { #"{"trigger":{"url-filter":"^[a-z]+://([^/]*@)?\#($0)"},"action":{"type":"block"}}"# }
    return "[" + rules.joined(separator: ",") + "]"
  }

  /// 이동 오류 → 실패 코드. 우리가 취소한 이동(-999, WebKitErrorDomain 102 정책 변경)은 nil(실패 아님).
  /// https 로 올린 주소(upgraded)의 TLS·연결 거부·ATS 오류는 insecure(그 사이트는 https 가 안 된다 — 다시 해도 같다)
  nonisolated static func loadFailure(_ e: NSError, upgraded: Bool) -> String? {
    if e.code == NSURLErrorCancelled || (e.domain == "WebKitErrorDomain" && e.code == 102) { return nil }
    guard e.domain == NSURLErrorDomain else { return "load_failed" }
    switch e.code {
    case NSURLErrorTimedOut: return "timeout"
    case NSURLErrorHTTPTooManyRedirects: return "redirects"
    case NSURLErrorSecureConnectionFailed, NSURLErrorServerCertificateHasBadDate, NSURLErrorServerCertificateUntrusted,
         NSURLErrorServerCertificateHasUnknownRoot, NSURLErrorServerCertificateNotYetValid, NSURLErrorClientCertificateRejected,
         NSURLErrorClientCertificateRequired, NSURLErrorCannotConnectToHost, NSURLErrorAppTransportSecurityRequiresSecureConnection:
      return upgraded ? "insecure" : "load_failed"
    default: return "load_failed"
    }
  }

  public func render(_ url: URL, budget: TimeInterval, ocr: Bool) async -> LinkRenderOutcome {
    let start = ContinuousClock.now                                 // 기한은 여기서부터 — 규칙 목록·웹뷰 생성도 상한 안
    if let b = LinkText.check(url, allowLoopback: allowLoopback) { return .failed("blocked_\(b.rawValue)") }
    // 보이는 창 안이어야 한다. 창 자체(앱 키 창 — UIWindow.window 는 nil)는 장면에 붙어 있고 숨지 않았을 때만(숨은 창에선 타이머가 조절된다)
    guard let host, (host as? UIWindow).map({ $0.windowScene != nil && !$0.isHidden }) ?? (host.window != nil) else { return .failed("no_host") }
    if Task.isCancelled { return .failed("cancelled") }
    let target = html == nil ? LinkText.upgraded(url, allowLoopback: allowLoopback) : url     // http → https(F24, D7)
    finished = false; committed = false; failure = nil; navigations = 0; blockedNavigations = 0
    upgradedScheme = target.scheme != url.scheme
    let config = Self.makeConfiguration()
    if let rules = await Self.ruleList(allowLoopback: allowLoopback) { config.userContentController.add(rules) }   // 웹뷰를 만들기 전에(설정은 복사된다)
    let wv = WKWebView(frame: CGRect(origin: .zero, size: Self.viewport), configuration: config)
    wv.isUserInteractionEnabled = false
    wv.navigationDelegate = self
    wv.uiDelegate = self                                           // 권한 요청(카메라·마이크)은 묻지 않고 거절
    current = wv
    host.insertSubview(wv, at: 0)                                  // 다른 화면 밑 — 사용자에게 보이지 않는다
    defer {
      wv.stopLoading(); wv.navigationDelegate = nil; wv.uiDelegate = nil; wv.removeFromSuperview()
      if current === wv { current = nil }
    }
    if let html { wv.loadHTMLString(html, baseURL: url) } else { wv.load(URLRequest(url: target, timeoutInterval: budget)) }

    // 독립 기한 경주(D15, Codex 2): JS 호출은 페이지 스크립트가 멈추면 돌아오지 않는다 — 내부 작업·기한·취소 중 먼저 온 것으로 돌아오고 웹뷰를 뗀다.
    // 진 내부 작업은 취소되고 결과는 버린다. 내부 작업은 웹뷰를 약하게만 잡는다(WebViewRef·Reply) — 돌아오지 않는 JS 호출이 웹뷰를 붙잡으면
    // render 가 돌아온 뒤에도 웹뷰와 무한 루프 WebContent 가 남는다(L3 리뷰 I1). 여기서 놓으면 웹뷰가 풀리고 페이지가 닫힌다
    let deadline = start + .seconds(budget + Self.extractAllowance + (ocr ? Self.ocrAllowance : 0))
    let race = RenderRace(), ref = WebViewRef(wv)
    let work = Task { @MainActor in race.finish(await self.read(ref, url: url, start: start, budget: budget, ocr: ocr)) }
    let timer = Task { @MainActor in
      guard (try? await Task.sleep(until: deadline, clock: .continuous)) != nil else { return }
      race.finish(.failed("timeout"))
    }
    let outcome = await withTaskCancellationHandler {
      await race.wait()
    } onCancel: {
      Task { @MainActor in race.finish(.failed("cancelled")) }
    }
    work.cancel(); timer.cancel()
    return outcome
  }

  /// 내부 작업: 대기(LinkSettle) → 추출 → (앱) 스냅샷 OCR. 시간은 render 진입부터 잰다
  private func read(_ ref: WebViewRef, url: URL, start: ContinuousClock.Instant, budget: TimeInterval, ocr: Bool) async -> LinkRenderOutcome {
    func elapsed() -> TimeInterval {
      let c = start.duration(to: ContinuousClock.now).components
      return Double(c.seconds) + Double(c.attoseconds) / 1e18
    }
    var settle = LinkSettle(budget: budget), timedOut = false
    wait: while true {
      if Task.isCancelled { return .failed("cancelled") }
      if let f = failure { return .failed(f) }
      let len = await Self.js(ref, LinkScript.length, as: Int.self) ?? 0
      switch settle.observe(length: len, finished: finished, elapsed: elapsed()) {
      case .done: break wait
      case .deadline:
        if !committed { return .failed(failure ?? "timeout") }     // 페이지가 서지도 못했다
        timedOut = true                                            // 0자여도 추출(OG 메타)·OCR 로 간다(Codex 1)
        break wait
      case .wait: try? await Task.sleep(for: LinkSettle.pollInterval)
      }
    }
    if Task.isCancelled { return .failed("cancelled") }
    guard let json = await Self.js(ref, LinkScript.extract, as: String.self),
          var page = LinkPage.decode(json: json, host: ref.view?.url?.host() ?? url.host() ?? "") else { return .failed("extract_failed") }
    page.timedOut = timedOut
    if ocr, await !Self.hasDate(page) { page.ocrText = await snapshotText(ref) }
    if Task.isCancelled { return .failed("cancelled") }
    if ocr, page.isEmpty { return .failed("empty") }                 // OCR 까지 했는데 빈 페이지 — 확정 실패(앱)
    return .page(page, elapsedMs: Int(elapsed() * 1000))             // OCR 없음(확장): 빈 페이지도 돌려 no_date 로 앱에 넘긴다
  }

  /// 날짜 후보 판정은 메인 액터 밖에서 — 200,000자 × 2 에서 수백 ms 라 그동안 기한 타이머·화면이 멈추지 않게
  nonisolated private static func hasDate(_ page: LinkPage) async -> Bool { LinkText.hasDateCandidate(page.searchable) }

  /// 이미지 전용 페이지(스펙 §6): 최대 3화면을 스냅샷(너비 390pt — 3배율 기기 1,170px)해 기기 OCR. 스냅샷은 메모리에서만 쓴다
  private func snapshotText(_ ref: WebViewRef) async -> String? {
    var parts: [String] = []
    for i in 0..<Self.ocrScreens {
      if Task.isCancelled { break }
      if i > 0 {
        let y = Double(i) * Double(Self.viewport.height)
        guard let h = ref.view?.scrollView.contentSize.height, Double(h) > y else { break }    // 페이지 끝(또는 웹뷰를 뗐다)
        _ = await Self.js(ref, "window.scrollTo(0, y); return window.scrollY;", arguments: ["y": y], as: Double.self)
        try? await Task.sleep(for: .milliseconds(600))                                          // 지연 로딩 그림
      }
      let cfg = WKSnapshotConfiguration()
      cfg.snapshotWidth = NSNumber(value: Double(Self.viewport.width))
      guard let img = await Self.snapshot(ref, cfg), let text = try? await OCR.recognize(image: img), !text.isEmpty else { continue }
      parts.append(text)
    }
    let joined = parts.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
    return joined.isEmpty ? nil : joined
  }

  /// JS 호출(격리 세계 .defaultClient). 완료 핸들러는 결과 상자만 잡고, 기다리는 동안 웹뷰를 강하게 잡지 않는다. 웹뷰를 뗐거나 오류·취소면 nil
  private static func js<T: Sendable>(_ ref: WebViewRef, _ body: String, arguments: [String: Any] = [:], as _: T.Type) async -> T? {
    await Reply<T>.wait { reply in
      guard let wv = ref.view else { return reply.finish(nil) }
      wv.callAsyncJavaScript(body, arguments: arguments, in: nil, in: .defaultClient) { reply.finish((try? $0.get()) as? T) }
    }
  }

  /// 화면 스냅샷 — js 와 같은 방식(웹뷰를 잡지 않는다)
  private static func snapshot(_ ref: WebViewRef, _ cfg: WKSnapshotConfiguration) async -> UIImage? {
    await Reply<UIImage>.wait { reply in
      guard let wv = ref.view else { return reply.finish(nil) }
      wv.takeSnapshot(with: cfg) { img, _ in reply.finish(img) }
    }
  }

  // MARK: WKNavigationDelegate (async 판만, 지금 웹뷰의 것만 반영)

  public func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction) async -> WKNavigationActionPolicy {
    guard webView === current else { return .cancel }
    if navigationAction.shouldPerformDownload { return .cancel }
    guard let u = navigationAction.request.url, let frame = navigationAction.targetFrame else { blockedNavigations += 1; return .cancel }   // 새 창
    let scheme = u.scheme?.lowercased() ?? ""
    if !frame.isMainFrame {
      guard Self.subframeSchemes.contains(scheme) else { blockedNavigations += 1; return .cancel }
      if scheme == "http" || scheme == "https", LinkText.check(u, allowLoopback: allowLoopback) != nil {   // 하위 프레임도 사설 주소 차단(Codex 6)
        blockedNavigations += 1; return .cancel
      }
      return .allow
    }
    if let b = LinkText.check(u, allowLoopback: allowLoopback) {   // 앱 스킴·사설 주소 — 선 페이지는 계속 읽는다
      blockedNavigations += 1
      if !committed, failure == nil { failure = "blocked_\(b.rawValue)" }   // 서기 전(서버 리다이렉트)이면 읽을 페이지가 없다 — 예산을 기다리지 않고 확정
      return .cancel
    }
    // 리다이렉트 상한은 페이지가 서기 전 이동만 센다 — 선 뒤의 JS 이동과 같은 문서 해시 이동(갤러리·슬라이드)은 읽기를 끊지 않는다(같은 문서 이동은 커밋 뒤에만 난다)
    if !committed {
      navigations += 1
      if navigations > Self.maxNavigations { failure = "redirects"; return .cancel }
    }
    return .allow
  }

  public func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse) async -> WKNavigationResponsePolicy {
    guard webView === current else { return .cancel }
    guard navigationResponse.isForMainFrame else { return .allow }
    let code: String
    if let h = navigationResponse.response as? HTTPURLResponse, h.statusCode >= 400 { code = "http_\(h.statusCode)" }
    else if !navigationResponse.canShowMIMEType { code = "unsupported" }
    else { return .allow }
    if !committed, failure == nil { failure = code }               // 선 뒤 이동(JS 이동)의 4xx·5xx·표시 불가는 그 이동만 막고 선 페이지를 계속 읽는다(loadError 와 같은 규칙)
    return .cancel
  }

  public func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) { if webView === current { finished = false } }
  public func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) { if webView === current { committed = true } }
  public func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { if webView === current { finished = true } }
  public func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    loadError(webView, error)
    if webView === current, committed { finished = true }          // 선 뒤 이동이 실패하면 선 페이지가 그대로 남는다 — didFinish 는 다시 오지 않는다
  }
  public func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    loadError(webView, error)
    if webView === current { finished = true }
  }
  public func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { if webView === current { failure = "web_process" } }

  /// 페이지가 이미 섰으면(committed) 뒤 이동의 실패로 읽기를 멈추지 않는다
  private func loadError(_ webView: WKWebView, _ error: Error) {
    guard webView === current, let code = Self.loadFailure(error as NSError, upgraded: upgradedScheme) else { return }
    if !committed, failure == nil { failure = code }
  }

  // MARK: WKUIDelegate — 숨은 웹뷰라 아무것도 묻지 않는다(alert·confirm 은 위임 메서드가 없으면 바로 끝난다)

  /// 카메라·마이크(getUserMedia)는 거절 — 기본값은 묻기라 앱(마이크 사용 문구가 있다)에서 권한 창이 뜰 수 있다
  public func webView(_ webView: WKWebView, decideMediaCapturePermissionsFor origin: WKSecurityOrigin, initiatedBy frame: WKFrameInfo,
                      type: WKMediaCaptureType) async -> WKPermissionDecision { .deny }
}

/// 렌더링 결과 경주(D15): 내부 작업·독립 기한·취소 중 먼저 온 하나만 돌려준다. 늦게 온 결과는 버린다
@MainActor final class RenderRace {
  private var cont: CheckedContinuation<LinkRenderOutcome, Never>?
  private var result: LinkRenderOutcome?

  func finish(_ o: LinkRenderOutcome) {
    guard result == nil else { return }
    result = o
    cont?.resume(returning: o)
    cont = nil
  }

  func wait() async -> LinkRenderOutcome {
    if let r = result { return r }
    return await withCheckedContinuation { cont = $0 }
  }
}

/// 내부 작업이 쥐는 웹뷰 약참조 — render 가 웹뷰를 떼면 nil
@MainActor final class WebViewRef {
  weak var view: WKWebView?
  init(_ view: WKWebView) { self.view = view }
}

/// 완료 핸들러 한 번 기다리기: 핸들러는 이 상자만 잡아 웹뷰를 붙잡지 않고, 취소되면 핸들러를 기다리지 않고 nil 로 돌아간다(늦은 결과는 버린다)
@MainActor final class Reply<T: Sendable> {
  private var cont: CheckedContinuation<T?, Never>?

  func finish(_ v: T?) {
    cont?.resume(returning: v)
    cont = nil
  }

  static func wait(_ start: (Reply<T>) -> Void) async -> T? {
    let r = Reply<T>()
    return await withTaskCancellationHandler {
      await withCheckedContinuation { cont in
        r.cont = cont
        if Task.isCancelled { r.finish(nil) } else { start(r) }
      }
    } onCancel: {
      Task { @MainActor in r.finish(nil) }
    }
  }
}

/// 추출 JS — callAsyncJavaScript 의 함수 본문. 격리 세계(.defaultClient)에서 돈다(DOM 공유, 페이지 스크립트가 바꿀 수 없다)
enum LinkScript {
  static let length = "return document.body ? document.body.innerText.length : 0;"
  /// 제목·OG(각 2,000자 — 확장 메모리)·보이는 글(innerText)·숨은 요소 포함 글(스크립트·스타일 제외 텍스트 노드, 각 200,000자)
  static let extract = #"""
    const meta = (k) => { const e = document.querySelector(`meta[property="${k}"],meta[name="${k}"]`); return e ? (e.getAttribute("content") || "") : ""; };
    const cap = (s, n) => (s || "").slice(0, n);
    let all = "";
    if (document.body) {
      const c = document.body.cloneNode(true);
      c.querySelectorAll("script,style,noscript,template,svg,iframe").forEach((e) => e.remove());
      const w = document.createTreeWalker(c, NodeFilter.SHOW_TEXT);
      const parts = []; let n;
      while ((n = w.nextNode())) { const t = n.nodeValue.trim(); if (t) parts.push(t); }
      all = parts.join("\n");
    }
    return JSON.stringify({ title: cap(document.title, 2000), ogTitle: cap(meta("og:title"), 2000),
      ogDescription: cap(meta("og:description") || meta("description"), 2000),
      text: cap(document.body ? document.body.innerText : "", 200000), all: cap(all, 200000) });
    """#
}
