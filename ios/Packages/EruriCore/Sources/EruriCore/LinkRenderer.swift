import UIKit
import WebKit

/// 보이지 않는 웹뷰로 페이지를 읽는다(스펙 §6 "링크·이미지 읽기"). WebKit 이라 메인 액터에서만.
/// 웹뷰는 실제 화면 크기로 host(창 안에 있는 뷰)의 **맨 아래**에 붙는다 — WebKit 은 창 안·foreground 일 때만 보이는 뷰로 다뤄 렌더링·타이머를 돌린다(F16)
@MainActor public final class LinkRenderer: NSObject, LinkRendering, WKNavigationDelegate {
  public static let viewport = CGSize(width: 390, height: 844)
  /// 메인 프레임 이동 상한(첫 로드 + 리다이렉트 5회)
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
    c.allowsInlineMediaPlayback = false
    c.preferences.javaScriptCanOpenWindowsAutomatically = false
    c.defaultWebpagePreferences.allowsContentJavaScript = true     // SPA 청첩장은 JS 로 글을 그린다
    return c
  }

  /// 하위 리소스(이미지·fetch·XHR·iframe — 모든 종류)의 사설 IP 리터럴·localhost·.local 요청 차단 규칙(Codex 6, D7). 한 번 컴파일해 재사용한다.
  /// 컴파일에 실패하면 nil(위임 메서드의 프레임 검사만 남는다 — DiagLog 에 코드만)
  public static func ruleList(allowLoopback: Bool) async -> WKContentRuleList? {
    if let l = ruleLists[allowLoopback] { return l }
    guard let store = WKContentRuleListStore.default() else { return nil }
    let l = (try? await store.compileContentRuleList(forIdentifier: "eruri-link-private-\(allowLoopback ? "debug" : "release")",
                                                      encodedContentRuleList: blockRules(allowLoopback: allowLoopback))) ?? nil
    if let l { ruleLists[allowLoopback] = l } else { DiagLog.append("link rules compile_failed") }
    return l
  }

  /// 규칙 JSON. WebKit 콘텐츠 규칙의 url-filter 는 `|`·`{n}` 을 지원하지 않아 대역마다 규칙 하나. 공개 이름이 사설 주소로 풀리는 경우는 막지 않는다(스펙 §6)
  nonisolated static func blockRules(allowLoopback: Bool) -> String {
    var hosts = [#"10\\."#, #"192\\.168\\."#, #"169\\.254\\."#, #"172\\.1[6-9]\\."#, #"172\\.2[0-9]\\."#, #"172\\.3[01]\\."#,
                 #"100\\.6[4-9]\\."#, #"100\\.[7-9][0-9]\\."#, #"100\\.1[01][0-9]\\."#, #"100\\.12[0-7]\\."#, #"0\\."#,
                 #"\\[f"#, #"\\[::"#, #"[a-z0-9.-]*\\.local[:/]"#]
    if !allowLoopback { hosts += [#"127\\."#, #"localhost[:/]"#] }
    let rules = hosts.map { #"{"trigger":{"url-filter":"^[a-z]+://\#($0)"},"action":{"type":"block"}}"# }
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
    if let b = LinkText.check(url, allowLoopback: allowLoopback) { return .failed("blocked_\(b.rawValue)") }
    guard let host, host is UIWindow || host.window != nil else { return .failed("no_host") }   // UIWindow.window 는 nil — 창 자체(앱 키 창)도 창 안이다
    if Task.isCancelled { return .failed("cancelled") }
    let target = html == nil ? LinkText.upgraded(url, allowLoopback: allowLoopback) : url     // http → https(F24, D7)
    finished = false; committed = false; failure = nil; navigations = 0; blockedNavigations = 0
    upgradedScheme = target.scheme != url.scheme
    let config = Self.makeConfiguration()
    if let rules = await Self.ruleList(allowLoopback: allowLoopback) { config.userContentController.add(rules) }   // 웹뷰를 만들기 전에(설정은 복사된다)
    let wv = WKWebView(frame: CGRect(origin: .zero, size: Self.viewport), configuration: config)
    wv.isUserInteractionEnabled = false
    wv.navigationDelegate = self
    current = wv
    host.insertSubview(wv, at: 0)                                  // 다른 화면 밑 — 사용자에게 보이지 않는다
    defer {
      wv.stopLoading(); wv.navigationDelegate = nil; wv.removeFromSuperview()
      if current === wv { current = nil }
    }
    if let html { wv.loadHTMLString(html, baseURL: url) } else { wv.load(URLRequest(url: target, timeoutInterval: budget)) }

    // 독립 기한 경주(D15, Codex 2): JS 호출은 페이지 스크립트가 멈추면 돌아오지 않는다 — 내부 작업·기한·취소 중 먼저 온 것으로 돌아오고 웹뷰를 뗀다.
    // 진 내부 작업은 취소되고 결과는 버린다(멈춘 WebContent 를 기다리는 호출은 웹뷰가 풀릴 때 끝난다)
    let limit = budget + Self.extractAllowance + (ocr ? Self.ocrAllowance : 0)
    let race = RenderRace()
    let work = Task { @MainActor in race.finish(await self.read(wv, url: url, budget: budget, ocr: ocr)) }
    let timer = Task { @MainActor in
      guard (try? await Task.sleep(for: .seconds(limit))) != nil else { return }
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

  /// 내부 작업: 대기(LinkSettle) → 추출 → (앱) 스냅샷 OCR
  private func read(_ wv: WKWebView, url: URL, budget: TimeInterval, ocr: Bool) async -> LinkRenderOutcome {
    let clock = ContinuousClock(), start = clock.now
    func elapsed() -> TimeInterval {
      let c = start.duration(to: clock.now).components
      return Double(c.seconds) + Double(c.attoseconds) / 1e18
    }
    var settle = LinkSettle(budget: budget), timedOut = false
    wait: while true {
      if Task.isCancelled { return .failed("cancelled") }
      if let f = failure { return .failed(f) }
      let len = (try? await wv.callAsyncJavaScript(LinkScript.length, contentWorld: .defaultClient)) as? Int ?? 0
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
    guard let json = (try? await wv.callAsyncJavaScript(LinkScript.extract, contentWorld: .defaultClient)) as? String,
          var page = LinkPage.decode(json: json, host: wv.url?.host() ?? url.host() ?? "") else { return .failed("extract_failed") }
    page.timedOut = timedOut
    if ocr, !LinkText.hasDateCandidate(page.searchable) { page.ocrText = await snapshotText(wv) }
    if Task.isCancelled { return .failed("cancelled") }
    if ocr, page.isEmpty { return .failed("empty") }                 // OCR 까지 했는데 빈 페이지 — 확정 실패(앱)
    return .page(page, elapsedMs: Int(elapsed() * 1000))             // OCR 없음(확장): 빈 페이지도 돌려 no_date 로 앱에 넘긴다
  }

  /// 이미지 전용 페이지(스펙 §6): 최대 3화면을 스냅샷(너비 390pt — 3배율 기기 1,170px)해 기기 OCR. 스냅샷은 메모리에서만 쓴다
  private func snapshotText(_ wv: WKWebView) async -> String? {
    var parts: [String] = []
    for i in 0..<Self.ocrScreens {
      if Task.isCancelled { break }
      if i > 0 {
        let y = Double(i) * Double(Self.viewport.height)
        guard Double(wv.scrollView.contentSize.height) > y else { break }          // 페이지 끝
        _ = try? await wv.callAsyncJavaScript("window.scrollTo(0, y); return window.scrollY;", arguments: ["y": y], contentWorld: .defaultClient)
        try? await Task.sleep(for: .milliseconds(600))                               // 지연 로딩 그림
      }
      let cfg = WKSnapshotConfiguration()
      cfg.snapshotWidth = NSNumber(value: Double(Self.viewport.width))
      guard let img = try? await wv.takeSnapshot(configuration: cfg), let text = try? await OCR.recognize(image: img), !text.isEmpty else { continue }
      parts.append(text)
    }
    let joined = parts.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
    return joined.isEmpty ? nil : joined
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
    if LinkText.check(u, allowLoopback: allowLoopback) != nil { blockedNavigations += 1; return .cancel }   // 앱 스킴·사설 주소 — 읽기는 계속
    navigations += 1
    if navigations > Self.maxNavigations { failure = "redirects"; return .cancel }
    return .allow
  }

  public func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse) async -> WKNavigationResponsePolicy {
    guard webView === current else { return .cancel }
    guard navigationResponse.isForMainFrame else { return .allow }
    if let h = navigationResponse.response as? HTTPURLResponse, h.statusCode >= 400 { failure = "http_\(h.statusCode)"; return .cancel }
    if !navigationResponse.canShowMIMEType { failure = "unsupported"; return .cancel }
    return .allow
  }

  public func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) { if webView === current { finished = false } }
  public func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) { if webView === current { committed = true } }
  public func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { if webView === current { finished = true } }
  public func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { loadError(webView, error) }
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

/// 추출 JS — callAsyncJavaScript 의 함수 본문. 격리 세계(.defaultClient)에서 돈다(DOM 공유, 페이지 스크립트가 바꿀 수 없다)
enum LinkScript {
  static let length = "return document.body ? document.body.innerText.length : 0;"
  /// 제목·OG·보이는 글(innerText)·숨은 요소 포함 글(스크립트·스타일 제외 텍스트 노드). 각 200,000자
  static let extract = #"""
    const meta = (k) => { const e = document.querySelector(`meta[property="${k}"],meta[name="${k}"]`); return e ? (e.getAttribute("content") || "") : ""; };
    const cap = (s) => (s || "").slice(0, 200000);
    let all = "";
    if (document.body) {
      const c = document.body.cloneNode(true);
      c.querySelectorAll("script,style,noscript,template,svg,iframe").forEach((e) => e.remove());
      const w = document.createTreeWalker(c, NodeFilter.SHOW_TEXT);
      const parts = []; let n;
      while ((n = w.nextNode())) { const t = n.nodeValue.trim(); if (t) parts.push(t); }
      all = parts.join("\n");
    }
    return JSON.stringify({ title: document.title || "", ogTitle: meta("og:title"),
      ogDescription: meta("og:description") || meta("description"),
      text: cap(document.body ? document.body.innerText : ""), all: cap(all) });
    """#
}
