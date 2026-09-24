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

// Opus 재검증 A (R-1~R-4) 회귀 테스트. 모든 번호는 합성값(4111… = 테스트용 Visa).
final class RuleFilterReviewTests: XCTestCase {
  let f = RuleFilter()
  func pass(_ input: String, _ expected: String, file: StaticString = #filePath, line: UInt = #line) {
    XCTAssertEqual(f.apply(text: input, sender: nil), .pass(masked: expected), file: file, line: line)
  }
  func otp(_ input: String, file: StaticString = #filePath, line: UInt = #line) {
    XCTAssertEqual(f.apply(text: input, sender: nil), .discard(reason: "otp"), file: file, line: line)
  }
  // R-2 카드: 앞의 날짜 숫자를 삼키지 않는다, 점 구분자
  func testCardAfterDate() { pass("09-24 4111-1111-1111-1111 승인 32,000원", "09-24 ****-****-****-1111 승인 32,000원") }
  func testCardAfterIsoDate() { pass("승인 2026-09-24 4111-1111-1111-1111", "승인 2026-09-24 ****-****-****-1111") }
  func testCardDotSeparated() { pass("카드 4111.1111.1111.1111 승인", "카드 ****.****.****.1111 승인") }
  // R-1 계좌: 하이픈, 뱅크, 키워드가 뒤에, 여러 개, 가상계좌
  func testAccountHyphenShortBankName() { pass("신한 110-123-456789 로 입금", "신한 ***-***-**6789 로 입금") }
  func testAccountHyphenGroups() { pass("국민은행 123456-01-123456 입금", "국민은행 ******-**-**3456 입금") }
  func testAccountBankSuffix() { pass("카카오뱅크 3333011234567 입금", "카카오뱅크 *********4567 입금") }
  func testAccountKeywordAfter() { pass("3333011234567 (신한은행) 입금", "*********4567 (신한은행) 입금") }
  func testAccountMultiple() { pass("입금 계좌 110123456789, 110987654321", "입금 계좌 ********6789, ********4321") }
  func testVirtualAccountMaskedAndPassed() {
    pass("우리은행 가상계좌 56201234567890 으로 30,000원 입금해 주세요", "우리은행 가상계좌 **********7890 으로 30,000원 입금해 주세요")
  }
  func testHyphenGroupsOver14DigitsKept() { pass("입금 문의 123456-123456-1234", "입금 문의 123456-123456-1234") }
  func testTrackingNumberWithoutKeywordKept() { pass("택배 운송장 123456789012 배송 출발", "택배 운송장 123456789012 배송 출발") }
  // R-3 OTP 누락
  func testOTPKoreanCode() { otp("[카카오] 인증코드 482913") }
  func testOTPKoreanCodeSpaced() { otp("인증 코드 482913 을 입력하세요") }
  func testOTPLoginCode() { otp("Your login code is 482913") }
  func testOTPVerify() { otp("Use 482913 to verify your account") }
  func testOTPOneTime() { otp("Your one-time passcode: 5521") }
  func testOTPSplitDigits() { otp("인증번호 123-456 입력") }
  func testOTPConfirmNumber() { otp("확인번호 5821 을 입력해 주세요") }
  // R-4 OTP 오탐
  func testHotpotNotOTP() { pass("Hotpot 예약 2026년 10월 3일 7시", "Hotpot 예약 2026년 10월 3일 7시") }
  func testOTPKeywordFarFromDigitsPasses() {
    let s = "인증번호는 절대 타인에게 알려주지 마세요. 고객센터 운영시간 안내드립니다. 문의 1588"
    pass(s, s)
  }
  // 메인 결정: 승인번호 + 결제 문맥 → 폐기하지 않고 승인번호만 마스킹. 결제 문맥 없으면 OTP 로 폐기.
  func testApprovalNumberWithPaymentContextMasked() {
    pass("[신한카드] 승인번호 12345678 32,000원 일시불", "[신한카드] 승인번호 ******** 32,000원 일시불")
  }
  func testApprovalNumberWithoutPaymentContextDiscarded() { otp("[OO은행] 승인번호 123456 을 입력하세요") }
}
