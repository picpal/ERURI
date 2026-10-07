import { assert, assertEquals } from "jsr:@std/assert";
import { applyRules, luhn, maskMail, maskSensitive } from "../functions/_shared/rules.ts";

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
// 0b: 문장 끝 마침표 앞 OTP(Jev 평가 o02)와 대괄호·괄호 OTP(09-29 d07)는 폐기. 점 날짜·버전은 키워드 옆이어도 통과
Deno.test("OTP: digits before a sentence-final period, bracketed or parenthesized digits are discarded", () => {
  for (const t of ["[Web발신] Your verification code is 603918. Do not share it with anyone.", "인증번호는 482913.",
    "[네이버] 인증번호 [482913]를 입력해 주세요. 타인에게 절대 알리지 마세요.", "인증번호 (482913)",
    "인증번호는 482913. 3분 내 입력해 주세요.", "Your code is 603918. 5 minutes left."]) {
    assertEquals(applyRules(t), { kind: "discard", reason: "otp" }, t);
  }
});
Deno.test("OTP: dotted dates and versions near a keyword still pass", () => {
  for (const t of ["예약 확인번호 안내: 2026. 10. 2. 방문", "인증 절차 안내 2026.10.02 공지", "보안코드 변경 v1.2345.6"]) {
    assertEquals(applyRules(t).kind, "pass", t);
  }
});
// 최종 리뷰 I2: 영문 날짜의 연도(`Oct 3, 2026.`)는 OTP 숫자가 아니다. 연도 형태가 아니거나 `숫자,` 뒤가 아니면 여전히 OTP
Deno.test("OTP: year of an English date after 'd, ' passes; other 4-digit or non-year digits still discarded", () => {
  for (const t of ["Booking code R7X2K, check-in Oct 3, 2026.", "Use code SAVE10 by Dec 31, 2026.", "Use code SAVE10 by Dec 31,2026."]) {
    assertEquals(applyRules(t).kind, "pass", t);
  }
  for (const t of ["Your code is 2026.", "Your code, 2026", "code 12, 482913", "code Oct 3, 202611", "code 3, 3026"]) {
    assertEquals(applyRules(t), { kind: "discard", reason: "otp" }, t);
  }
});

// ── 메일 요약 통합 가림(스펙 §7 "가림", Codex 리뷰 #3): 제목 + "\n" + 본문 전체를 한 번 판정·가림 → 다시 나눔. 자르기는 그 뒤 ──
Deno.test("maskMail: OTP keyword in the subject and digits in the body → otp (whole text, even past 12,000)", () => {
  assertEquals(maskMail("[합성은행] 인증번호 안내", "482913"), { otp: true });
  assertEquals(maskMail("합성 안내", "가".repeat(13_000) + " 인증번호 482913 입력"), { otp: true });
});
Deno.test("maskMail: an account split between subject keyword and body number is masked (masking the body alone would not)", () => {
  assertEquals(maskSensitive("123-456-789012"), "123-456-789012");
  assertEquals(maskMail("입금 계좌", "123-456-789012"), { otp: false, title: "입금 계좌", body: "***-***-**9012" });
});
Deno.test("maskMail: card (Luhn) in the subject is masked; lengths are preserved so the split is exact", () => {
  const r = maskMail("결제 카드 4111-1111-1111-1111", "합성 결제 안내 35,000원");
  assertEquals(r, { otp: false, title: "결제 카드 ****-****-****-1111", body: "합성 결제 안내 35,000원" });
});
// 병목은 정규식이 아니라 가릴 번호마다 글 전체를 다시 만드는 것 — 번호가 없는 글은 빠르다. 그래서 민감 숫자가 빽빽한 글로 잰다(Codex 계획 리뷰 4:
// 옛 scan 은 합성 카드번호를 반복한 999,994자에 2,624ms. 2026-10-07 로컬 재현 old 2,585ms → rebuild 25ms, 계좌 2,655 → 33ms, 결과 문자열 동일)
Deno.test("maskMail: 1,000,000-char synthetic texts — plain, dense cards, dense accounts — are judged and masked in under 1 s each (min of 3, local)", () => {
  const bodies: Record<string, string> = {
    plain: "합성 안내 10/20(화) 15:00 참가비 35,000원 신청서 제출. ".repeat(25_000).slice(0, 1_000_000),
    cards: "결제 카드 4111-1111-1111-1111 ".repeat(50_000).slice(0, 1_000_000),
    accounts: "신한 계좌 110-123-456789 입금 ".repeat(50_000).slice(0, 1_000_000),
  };
  const ms: Record<string, number> = {};
  for (const [k, body] of Object.entries(bodies)) {
    let best = Infinity, r: ReturnType<typeof maskMail> = { otp: true };
    for (let i = 0; i < 3; i++) { const t0 = performance.now(); r = maskMail("합성 안내", body); best = Math.min(best, performance.now() - t0); }
    ms[k] = Math.round(best);
    assert(!r.otp && r.body.length === body.length, k);                                  // 길이 보존 — 제목 경계로 다시 나눌 수 있다
    if (k === "cards") assertEquals(r.body.match(/4111-1111-1111-1111/g), null);         // 빽빽해도 하나도 빠짐없이
    if (k === "accounts") assertEquals(r.body.match(/110-123-456789/g), null);
  }
  console.log(JSON.stringify({ mask_ms: ms }));
  assert(Object.values(ms).every((x) => x < 1000), JSON.stringify(ms));
});
// rebuild 가 옛 replaceRange 반복과 같은 결과인지: 같은 승인번호를 두 키워드가 가리키는 겹침, 카드·계좌가 섞인 글
Deno.test("maskSensitive: one-pass rebuild matches the old per-range result (duplicate and overlapping approval ranges, card + account in one text)", () => {
  assertEquals(maskSensitive("승인번호 승인코드 123456 결제 1,000원"), "승인번호 승인코드 ****** 결제 1,000원");   // 두 키워드가 같은 숫자를 가리킨다
  assertEquals(maskSensitive("승인번호 123456 결제 30,000원 승인번호 654321"), "승인번호 ****** 결제 30,000원 승인번호 ******");
  assertEquals(maskSensitive("카드 4111 1111 1111 1111 계좌 국민 110-123-456789"), "카드 **** **** **** 1111 계좌 국민 ***-***-**6789");
  // 창 경계에서 잘린 부분 일치(첫 키워드 창 끝 → "1234")와 다른 키워드 창의 전체 일치("123456")가 같은 시작·다른 끝 — 둘 다 가린다(옛 구현과 같다, Fable 계획 리뷰 H1)
  assertEquals(maskSensitive("승인번호 결제 1,000원 ㄱㄴㄷㄹㅁ승인번호 코드 : 123456 끝"), "승인번호 결제 1,000원 ㄱㄴㄷㄹㅁ승인번호 코드 : ****** 끝");
});
