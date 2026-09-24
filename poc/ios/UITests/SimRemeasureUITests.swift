import XCTest

/// 시뮬레이터 재실측(PoC-5 배너 액션·콜드 스타트, 단축어 앱 경로, 사진 공유 시트).
/// 판정 근거는 앱이 남기는 poc.log 다(`scripts/sim.sh log`). 여기서는 UI 조작과 스크린샷만 남긴다.
/// 각 테스트는 `POC_UI <이름> pid=...` 를 출력하므로 poc.log 의 해당 pid 줄과 대조한다.
@MainActor
final class SimRemeasureUITests: XCTestCase {
  let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")

  override func setUp() async throws { continueAfterFailure = false }

  func shot(_ name: String) {
    let a = XCTAttachment(screenshot: XCUIScreen.main.screenshot()); a.name = name; a.lifetime = .keepAlways; add(a)
  }

  /// springboard 에 뜬 권한 대화상자에서 허용 계열 버튼을 누른다(한국어·영어).
  func allowSystemAlerts(timeout: TimeInterval = 5) {
    let labels = ["허용", "Allow", "전체 접근 허용", "Allow Full Access", "계속", "Continue"]
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
      let alert = springboard.alerts.firstMatch
      if alert.waitForExistence(timeout: 1) {
        shot("alert")
        if let b = labels.lazy.map({ alert.buttons[$0] }).first(where: { $0.exists }) { b.tap(); continue }
        alert.buttons.element(boundBy: alert.buttons.count - 1).tap()
      }
    }
  }

  func launchApp(_ args: [String]) -> XCUIApplication {
    let app = XCUIApplication()
    app.launchArguments = args
    app.launch()
    return app
  }

  func grantPermissions(_ app: XCUIApplication) {
    let b = app.buttons["권한 요청 (알림·캘린더)"]
    XCTAssertTrue(b.waitForExistence(timeout: 10))
    b.tap()
    allowSystemAlerts()
  }

  /// 배너를 찾아 길게 눌러 펼친 뒤 "캘린더에 추가"를 탭한다.
  func tapAddOnBanner(timeout: TimeInterval = 30) {
    let banner = springboard.descendants(matching: .any)
      .matching(NSPredicate(format: "label CONTAINS[c] '일정 제안'")).firstMatch
    XCTAssertTrue(banner.waitForExistence(timeout: timeout), "배너가 뜨지 않음")
    shot("banner")
    banner.press(forDuration: 1.5)
    let add = springboard.buttons["캘린더에 추가"]
    if !add.waitForExistence(timeout: 5) {
      shot("expanded-without-action")
      banner.swipeDown()
    }
    XCTAssertTrue(add.waitForExistence(timeout: 5), "액션 버튼이 보이지 않음")
    shot("expanded")
    add.tap()
    sleep(6)   // 앱이 백그라운드에서 EventKit 쓰기·로그를 끝낼 시간
    shot("after-tap")
  }

  // 재실측 2: 권한 허용 → 홈 → 로컬 알림 배너 → 액션 → 백그라운드 쓰기. 같은 pid 로 한 번 더 → dup skip
  func testBannerActionInBackgroundThenDuplicate() {
    let pid = "p-ui-bg-\(Int(Date().timeIntervalSince1970))"
    print("POC_UI banner pid=\(pid)")
    let app = launchApp([])
    grantPermissions(app)
    app.terminate()
    _ = launchApp(["--poc-debug-local-notification=6", "--proposal-id=\(pid)"])
    sleep(1)
    XCUIDevice.shared.press(.home)
    tapAddOnBanner()
    _ = launchApp(["--poc-debug-local-notification=6", "--proposal-id=\(pid)"])
    sleep(1)
    XCUIDevice.shared.press(.home)
    tapAddOnBanner()
  }

  // 재실측 3: 알림 예약 후 앱 종료 → 배너 액션으로 콜드 스타트
  func testColdStartFromBannerAction() {
    let pid = "p-ui-cold-\(Int(Date().timeIntervalSince1970))"
    print("POC_UI cold pid=\(pid)")
    let app = launchApp(["--poc-debug-local-notification=8", "--proposal-id=\(pid)"])
    sleep(2)
    app.terminate()
    XCTAssertEqual(app.state, .notRunning)
    shot("terminated")
    tapAddOnBanner()
  }

  // 재실측 1: 단축어 앱에서 App Shortcut "비서에 저장"을 실행해 CaptureIntent 가 시스템 경로로 도는지
  func testShortcutsAppRunsCaptureIntent() {
    print("POC_UI shortcuts")
    let shortcuts = XCUIApplication(bundleIdentifier: "com.apple.shortcuts")
    shortcuts.launch()
    sleep(3)
    shot("shortcuts-launch")
    for label in ["계속", "Continue", "시작하기", "Get Started", "나중에", "Not Now"] where shortcuts.buttons[label].exists {
      shortcuts.buttons[label].tap(); sleep(1)
    }
    let tile = shortcuts.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS '비서에 저장'")).firstMatch
    if !tile.waitForExistence(timeout: 5) {
      // 앱 단축어는 "단축어" 탭 하위의 앱 섹션에 있다. 검색으로 찾는다
      let search = shortcuts.searchFields.firstMatch
      if search.waitForExistence(timeout: 3) { search.tap(); search.typeText("비서에 저장") }
      sleep(2)
    }
    shot("shortcuts-find")
    XCTAssertTrue(tile.waitForExistence(timeout: 5), "단축어 앱에서 '비서에 저장'을 찾지 못함")
    tile.tap()
    sleep(8)
    shot("shortcuts-after-run")
  }

  // Task 7 재시도: 사진 앱 → 공유 시트 → 확장 실행 (사진은 simctl addmedia 로 미리 넣는다)
  func testPhotosShareSheetRunsExtension() {
    print("POC_UI share")
    let photos = XCUIApplication(bundleIdentifier: "com.apple.mobileslideshow")
    photos.launch()
    sleep(3)
    for label in ["계속", "Continue"] where photos.buttons[label].exists { photos.buttons[label].tap(); sleep(1) }
    allowSystemAlerts(timeout: 2)
    shot("photos-launch")
    // iOS 26 사진 앱 그리드는 셀이 아니라 identifier 'PXGGridLayout-Info' 인 Image 로 노출된다. 가장 최근(마지막) 사진 = addmedia 로 넣은 합성 이미지
    let grid = photos.images.matching(identifier: "PXGGridLayout-Info")
    XCTAssertTrue(grid.firstMatch.waitForExistence(timeout: 10), "사진 그리드 없음")
    grid.element(boundBy: grid.count - 1).tap()
    sleep(2)
    let share = photos.buttons.matching(NSPredicate(format: "label IN {'공유', 'Share'} OR identifier == 'Share'")).firstMatch
    XCTAssertTrue(share.waitForExistence(timeout: 5), "공유 버튼 없음")
    share.tap()
    sleep(2)
    shot("share-sheet")
    // 공유 시트 앱 행: identifier 'shareCell', 표시 이름 "Assistant PoC"
    let ext = photos.cells.matching(NSPredicate(format: "identifier == 'shareCell' AND label == 'Assistant PoC'")).firstMatch
    XCTAssertTrue(ext.waitForExistence(timeout: 5), "공유 시트에 Assistant PoC 확장이 없음")
    ext.tap()
    sleep(8)
    shot("after-share")
  }
}
