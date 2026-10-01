import XCTest
@testable import EruriCore

/// 스펙 §10 "비슷한 일정"(0.9.2): 제목 비교는 느슨하게 — 사용자가 보고 "그래도 추가"를 고른다. 문구는 전부 합성
final class TitleMatchTests: XCTestCase {
  func testNormalize() {
    XCTAssertEqual(TitleMatch.normalize("[합성] 가을 운동회 (2학년)"), "합성가을운동회2학년")
    XCTAssertEqual(TitleMatch.normalize(" 합성  가을운동회! "), "합성가을운동회")
    XCTAssertEqual(TitleMatch.normalize("Synth MEETUP·Day"), "synthmeetupday")
    XCTAssertEqual(TitleMatch.normalize("「합성」 공연 — 2부"), "합성공연2부")
    XCTAssertEqual(TitleMatch.normalize("   "), "")
  }

  func testKeywords() {
    XCTAssertEqual(TitleMatch.keywords("[합성] 가을 운동회는 10시"), ["합성", "가을", "운동회는"])
    XCTAssertEqual(TitleMatch.keywords("합성 a 시"), ["합성"])                       // 한 글자 한글·영문은 핵심어가 아니다
  }

  /// 표: (제안 제목, 캘린더 제목, ERURI 표식 여부, 기대)
  func testSimilarTable() {
    let rows: [(String, String, Bool, Bool, String)] = [
      ("합성 가을 운동회", "합성 가을 운동회", false, true, "같음"),
      ("합성 가을 운동회", "합성가을운동회", false, true, "띄어쓰기 차이"),
      ("[합성] 가을 운동회!", "합성 가을운동회", false, true, "기호·괄호 차이"),
      ("합성 운동회", "합성 운동회 준비물 안내", false, true, "포함(제안이 짧음)"),
      ("합성초 가을 운동회 및 학부모 참관", "가을 운동회", false, true, "포함(캘린더가 짧음)"),
      ("Synth Meetup", "synth meetup", false, true, "대소문자"),
      ("합성 운동회", "합성 학부모 상담", false, false, "다른 행사(공통어 '합성'뿐, 표식 없음)"),
      ("합성 치과 예약", "합성 미용실 예약", false, false, "다른 행사(공통어 '예약', 표식 없음)"),
      ("합성 치과 예약", "합성 미용실 예약", true, true, "공통 핵심어 + ERURI 표식"),
      ("가을 운동회", "운동회는 우천 연기", true, true, "핵심어 포함(조사) + ERURI 표식"),
      ("합성 운동회", "학부모 상담", true, false, "표식이 있어도 공통어 없음"),
      ("산", "등산", false, false, "짧은 제목 오탐 방지(정규화 1글자는 포함으로 보지 않음)"),
      ("A", "A팀 회의", false, false, "짧은 제목 오탐 방지(영문 1글자)"),
      ("회의", "팀 회의", false, true, "2글자 포함은 느슨하게 잡는다"),
      ("", "합성 일정", false, false, "빈 제목"),
      ("!!", "!!", false, false, "기호만(정규화 빈 문자열)"),
    ]
    for (a, b, eruri, want, why) in rows {
      XCTAssertEqual(TitleMatch.similar(a, b, eruri: eruri), want, why)
      XCTAssertEqual(TitleMatch.similar(b, a, eruri: eruri), want, "\(why) (뒤집음)")
    }
  }
}
