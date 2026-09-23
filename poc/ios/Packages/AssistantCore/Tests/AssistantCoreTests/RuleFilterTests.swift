import XCTest
@testable import AssistantCore
final class RuleFilterTests: XCTestCase {
  let f = RuleFilter(contactNames: ["김민수"])
  func testOTPDiscarded() {
    XCTAssertEqual(f.apply(text: "[Web발신] 인증번호 483920 을 입력하세요", sender: nil), .discard(reason: "otp"))
  }
  func testVerificationEnglishDiscarded() {
    XCTAssertEqual(f.apply(text: "Your verification code is 1234", sender: nil), .discard(reason: "otp"))
  }
  func testCardMasked() {
    // 4111111111111111 은 Luhn 통과하는 테스트용 Visa 번호(합성)
    XCTAssertEqual(f.apply(text: "카드 4111-1111-1111-1111 승인 32,000원", sender: nil),
                   .pass(masked: "카드 ****-****-****-1111 승인 32,000원"))
  }
  func testNonLuhnNumberKept() {
    XCTAssertEqual(f.apply(text: "송장번호 1234567890123", sender: nil), .pass(masked: "송장번호 1234567890123"))
  }
  func testAccountMasked() {
    XCTAssertEqual(f.apply(text: "국민은행 계좌 12345678901234 로 입금", sender: nil),
                   .pass(masked: "국민은행 계좌 **********1234 로 입금"))
  }
  func testContactSenderDiscarded() {
    XCTAssertEqual(f.apply(text: "토요일 2시에 보자", sender: "김민수"), .discard(reason: "contact"))
  }
  func testPlainNoticePasses() {
    XCTAssertEqual(f.apply(text: "내일 오후 3시 진료 예약입니다", sender: "서울병원"), .pass(masked: "내일 오후 3시 진료 예약입니다"))
  }
}
