import XCTest
@testable import EruriCore

final class APNsDeviceTests: XCTestCase {
  func tempDefaults() -> UserDefaults {
    let name = "APNsDeviceTests-\(UUID().uuidString)"
    addTeardownBlock { UserDefaults.standard.removePersistentDomain(forName: name) }
    return UserDefaults(suiteName: name)!
  }

  func testHexIsLowercaseTwoDigitsPerByte() {
    XCTAssertEqual(APNsDevice.hex(Data([0x00, 0x0f, 0xab, 0xff])), "000fabff")
    let token = Data((0..<32).map { UInt8($0 * 7 % 256) })
    let hex = APNsDevice.hex(token)
    XCTAssertEqual(hex.count, 64)
    XCTAssertNotNil(hex.wholeMatch(of: /[0-9a-f]{64}/))   // 서버 검증 ^[0-9a-f]{64,200}$
  }

  func testMaskedHidesMiddle() {
    let t = String(repeating: "a", count: 30) + "0123" + String(repeating: "b", count: 26) + "wxyz"
    XCTAssertEqual(APNsDevice.masked(t), "aaaa…wxyz (64자)")
    XCTAssertEqual(APNsDevice.masked("abc"), "•••")
  }

  func testEnvironmentFollowsProfileThenBuildConfig() {
    // Xcode 설치: 프로필의 aps-environment 가 우선(Release 라도 development 면 sandbox)
    XCTAssertEqual(APNsDevice.environment(isDebug: false, hasProfile: true, profileAPSEnvironment: "development"), .sandbox)
    XCTAssertEqual(APNsDevice.environment(isDebug: true, hasProfile: true, profileAPSEnvironment: "production"), .production)
    // Debug(시뮬레이터 포함, 프로필 없음) = sandbox
    XCTAssertEqual(APNsDevice.environment(isDebug: true, hasProfile: false, profileAPSEnvironment: nil), .sandbox)
    // 프로필 없는 Release = App Store 서명(TestFlight·App Store) = production
    XCTAssertEqual(APNsDevice.environment(isDebug: false, hasProfile: false, profileAPSEnvironment: nil), .production)
    // 프로필은 있는데 aps 항목이 없으면 개발 서명으로 본다
    XCTAssertEqual(APNsDevice.environment(isDebug: false, hasProfile: true, profileAPSEnvironment: nil), .sandbox)
  }

  func testDistribution() {
    XCTAssertEqual(APNsDevice.distribution(isSimulator: true, hasProfile: false, receiptName: "sandboxReceipt"), "simulator")
    XCTAssertEqual(APNsDevice.distribution(isSimulator: false, hasProfile: true, receiptName: "sandboxReceipt"), "xcode")
    XCTAssertEqual(APNsDevice.distribution(isSimulator: false, hasProfile: false, receiptName: "sandboxReceipt"), "testflight")
    XCTAssertEqual(APNsDevice.distribution(isSimulator: false, hasProfile: false, receiptName: "receipt"), "appstore")
  }

  func testProfileAPSEnvironmentParsesEmbeddedPlist() {
    let plist = """
    <?xml version="1.0" encoding="UTF-8"?>
    <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
    <plist version="1.0"><dict><key>Entitlements</key><dict>
    <key>aps-environment</key><string>development</string></dict></dict></plist>
    """
    var profile = Data([0x30, 0x82, 0x01, 0x00, 0xff])   // CMS 머리(바이너리) 흉내
    profile.append(Data(plist.utf8)); profile.append(Data([0x00, 0xa0, 0x82]))
    XCTAssertEqual(APNsDevice.profileAPSEnvironment(profile), "development")
    XCTAssertNil(APNsDevice.profileAPSEnvironment(Data("no plist".utf8)))
  }

  func testNeedsRegistrationUntilMarkedAndAgainWhenTokenChanges() {
    let d = tempDefaults()
    XCTAssertFalse(APNsDevice.needsRegistration(defaults: d))            // 토큰 없음
    APNsDevice.store(token: "aa", env: .sandbox, defaults: d)
    XCTAssertTrue(APNsDevice.needsRegistration(defaults: d))
    APNsDevice.markRegistered(token: "aa", env: .sandbox, defaults: d)
    XCTAssertFalse(APNsDevice.needsRegistration(defaults: d))
    APNsDevice.store(token: "aa", env: .production, defaults: d)          // 환경이 바뀌면 다시 등록
    XCTAssertTrue(APNsDevice.needsRegistration(defaults: d))
    APNsDevice.markRegistered(token: "aa", env: .production, defaults: d)
    APNsDevice.store(token: "bb", env: .production, defaults: d)          // 토큰 갱신
    XCTAssertTrue(APNsDevice.needsRegistration(defaults: d))
    XCTAssertEqual(APNsDevice.token(defaults: d), "bb")
    XCTAssertEqual(APNsDevice.env(defaults: d), .production)
  }
}
