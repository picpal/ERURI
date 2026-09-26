import { assertEquals } from "jsr:@std/assert";
import { applyRules, luhn, maskSensitive } from "../functions/_shared/rules.ts";

// Task 2 RuleFilterTests와 같은 케이스 (연락처 규칙 제외)
Deno.test("OTP (Korean) discarded", () => {
  assertEquals(applyRules("[Web발신] 인증번호 483920 을 입력하세요"), { kind: "discard", reason: "otp" });
});
Deno.test("verification code (English) discarded", () => {
  assertEquals(applyRules("Your verification code is 1234"), { kind: "discard", reason: "otp" });
});
Deno.test("Luhn-valid card masked except last 4", () => {
  assertEquals(applyRules("카드 4532-0151-1283-0366 승인 32,000원"), { kind: "pass", masked: "카드 ****-****-****-0366 승인 32,000원" });
});
Deno.test("non-Luhn number kept", () => {
  assertEquals(applyRules("송장번호 1234567890123"), { kind: "pass", masked: "송장번호 1234567890123" });
});
Deno.test("account number masked", () => {
  assertEquals(applyRules("국민은행 계좌 12345678901234 로 입금"), { kind: "pass", masked: "국민은행 계좌 **********1234 로 입금" });
});
Deno.test("plain notice passes unchanged", () => {
  assertEquals(applyRules("내일 오후 3시 진료 예약입니다", { sender: "서울병원" }), { kind: "pass", masked: "내일 오후 3시 진료 예약입니다" });
});

// RuleFilterReviewTests (Opus 재검증 A, 0d2a293) 회귀 케이스. 모든 번호는 합성값(4111… = 테스트용 Visa)
const pass = (input: string, expected: string) => assertEquals(applyRules(input), { kind: "pass", masked: expected });
const otp = (input: string) => assertEquals(applyRules(input), { kind: "discard", reason: "otp" });
Deno.test("card after date / ISO date / dot separated", () => {
  pass("09-24 4111-1111-1111-1111 승인 32,000원", "09-24 ****-****-****-1111 승인 32,000원");
  pass("승인 2026-09-24 4111-1111-1111-1111", "승인 2026-09-24 ****-****-****-1111");
  pass("카드 4111.1111.1111.1111 승인", "카드 ****.****.****.1111 승인");
});
Deno.test("account: hyphen, bank suffix, keyword after, multiple, virtual account", () => {
  pass("신한 110-123-456789 로 입금", "신한 ***-***-**6789 로 입금");
  pass("국민은행 123456-01-123456 입금", "국민은행 ******-**-**3456 입금");
  pass("카카오뱅크 3333011234567 입금", "카카오뱅크 *********4567 입금");
  pass("3333011234567 (신한은행) 입금", "*********4567 (신한은행) 입금");
  pass("입금 계좌 110123456789, 110987654321", "입금 계좌 ********6789, ********4321");
  pass("우리은행 가상계좌 56201234567890 으로 30,000원 입금해 주세요", "우리은행 가상계좌 **********7890 으로 30,000원 입금해 주세요");
});
Deno.test("account: over 14 hyphen digits and no-keyword tracking number kept", () => {
  pass("입금 문의 123456-123456-1234", "입금 문의 123456-123456-1234");
  pass("택배 운송장 123456789012 배송 출발", "택배 운송장 123456789012 배송 출발");
});
Deno.test("OTP variants discarded", () => {
  otp("[카카오] 인증코드 482913");
  otp("인증 코드 482913 을 입력하세요");
  otp("Your login code is 482913");
  otp("Use 482913 to verify your account");
  otp("Your one-time passcode: 5521");
  otp("인증번호 123-456 입력");
  otp("확인번호 5821 을 입력해 주세요");
});
Deno.test("OTP false positives pass (Hotpot, keyword far from digits)", () => {
  pass("Hotpot 예약 2026년 10월 3일 7시", "Hotpot 예약 2026년 10월 3일 7시");
  const s = "인증번호는 절대 타인에게 알려주지 마세요. 고객센터 운영시간 안내드립니다. 문의 1588";
  pass(s, s);
});
Deno.test("approval number: payment context masks, otherwise OTP", () => {
  pass("[신한카드] 승인번호 12345678 32,000원 일시불", "[신한카드] 승인번호 ******** 32,000원 일시불");
  otp("[OO은행] 승인번호 123456 을 입력하세요");
});

// RuleFilterTitleContactTests (연락처 제외): 판정은 제목+본문 합쳐서, 마스킹은 각각
Deno.test("title: OTP in title or keyword in title with digits in body discarded", () => {
  assertEquals(applyRules("타인에게 알려주지 마세요", { title: "[OO은행] 인증번호 483920" }), { kind: "discard", reason: "otp" });
  assertEquals(applyRules("483920 을 입력하세요", { title: "인증번호" }), { kind: "discard", reason: "otp" });
});
Deno.test("title: title and body masked separately, approval number across title/body", () => {
  assertEquals(applyRules("승인 32,000원", { title: "카드 4111-1111-1111-1111" }),
    { kind: "pass", masked: "승인 32,000원", maskedTitle: "카드 ****-****-****-1111" });
  assertEquals(applyRules("32,000원 일시불", { title: "[신한카드] 승인번호 12345678" }),
    { kind: "pass", masked: "32,000원 일시불", maskedTitle: "[신한카드] 승인번호 ********" });
});

// 서버 전용 케이스
Deno.test("contact-name sender is not filtered on server (device-only rule)", () => {
  assertEquals(applyRules("토요일 2시에 보자", { sender: "김민수" }), { kind: "pass", masked: "토요일 2시에 보자" });
});
Deno.test("OTP in title discarded", () => {
  assertEquals(applyRules("아래 번호를 입력하세요", { title: "인증번호 [771203]" }), { kind: "discard", reason: "otp" });
});
Deno.test("promotion: Gmail label, (광고) in text/title/sender", () => {
  const promo = { kind: "discard", reason: "promotion" } as const;
  assertEquals(applyRules("가을 세일", { labels: ["INBOX", "CATEGORY_PROMOTIONS"] }), promo);
  assertEquals(applyRules("[Web발신](광고) 가을 세일 최대 50%"), promo);
  assertEquals(applyRules("세일 안내", { title: "(광고) 가을 세일" }), promo);
  assertEquals(applyRules("세일 안내", { sender: "[광고] 합성쇼핑" }), promo);
  assertEquals(applyRules("광고 문의는 고객센터로", { title: "주문 확인" }).kind, "pass");
});
Deno.test("maskSensitive for titles and luhn helper", () => {
  assertEquals(maskSensitive("결제 완료 4532015112830366"), "결제 완료 ************0366");
  assertEquals(luhn("4532015112830366"), true);
  assertEquals(luhn("1234567890123"), false);
});
