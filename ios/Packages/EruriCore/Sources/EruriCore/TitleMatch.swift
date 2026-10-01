import Foundation

/// 일정 제목 비교(스펙 §10 "비슷한 일정", 0.9.2 사용자 결정): 느슨하게 잡고 사용자가 보고 "그래도 추가"를 고른다.
/// 비교는 기기 안에서만(캘린더 제목은 기기 밖으로 나가지 않는다, §12 통제 2). 서버 중복(_shared/notify.ts titleKey)과 같은 정규화
public enum TitleMatch {
  /// 소문자, 글자·숫자만(공백·기호·괄호 제거)
  public static func normalize(_ s: String) -> String {
    String(String.UnicodeScalarView(s.precomposedStringWithCanonicalMapping.lowercased().unicodeScalars.filter {
      CharacterSet.letters.contains($0) || CharacterSet.decimalDigits.contains($0)
    }))
  }

  /// 핵심어: 2글자 이상 이어진 한글(어절에서 기호·숫자·영문을 뗀 덩어리). 조사가 붙어도 포함 비교로 잡는다
  public static func keywords(_ s: String) -> [String] {
    var out: [String] = [], cur = ""
    for c in s.precomposedStringWithCanonicalMapping.unicodeScalars {
      if (0xAC00...0xD7A3).contains(c.value) { cur.unicodeScalars.append(c) }
      else { if cur.count >= 2 { out.append(cur) }; cur = "" }
    }
    if cur.count >= 2 { out.append(cur) }
    return out
  }

  /// 비슷함: 정규화 후 같음, 또는 한쪽이 다른 쪽을 포함(짧은 쪽 ≥ 2글자 — 1글자는 거의 모든 제목에 들어 있다),
  /// 또는 eruri(캘린더 일정이 ERURI 제안 표식을 가짐)이고 공통 핵심어(같거나 한쪽이 다른 쪽을 포함)가 하나 이상
  public static func similar(_ a: String, _ b: String, eruri: Bool) -> Bool {
    let x = normalize(a), y = normalize(b)
    guard !x.isEmpty, !y.isEmpty else { return false }
    if x == y { return true }
    let (short, long) = x.count <= y.count ? (x, y) : (y, x)
    if short.count >= 2, long.contains(short) { return true }
    guard eruri else { return false }
    let kb = keywords(b)
    return keywords(a).contains { k in kb.contains { $0.contains(k) || k.contains($0) } }
  }
}
