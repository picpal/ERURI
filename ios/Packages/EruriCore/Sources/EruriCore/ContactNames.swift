import Foundation

/// 연락처 이름 캐시(스펙 §6 연락처 규칙). 앱이 포그라운드에서 CNContactStore 로 읽어 저장하고, 인텐트는 이 캐시만 읽는다.
/// 이름만 담는다. 보호 등급은 컨테이너 기본(completeUntilFirstUserAuthentication).
public enum ContactNames {
  static var defaultURL: URL? { try? AppGroup.containerURL().appendingPathComponent("contacts.json") }

  /// 모든 공백을 지우고 끝의 호칭 "님"/"씨"를 뗀다. 호칭만 있는 문자열은 그대로 둔다.
  public static func normalize(_ name: String) -> String {
    var s = name.filter { !$0.isWhitespace }
    if s.count > 1, s.hasSuffix("님") || s.hasSuffix("씨") { s.removeLast() }
    return s
  }

  public static func save(_ names: some Sequence<String>, to url: URL? = nil) throws {
    guard let url = url ?? defaultURL else { throw AppGroup.Error.containerUnavailable }
    let data = try JSONEncoder().encode(Array(Set(names)).sorted())
    try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
  }

  /// 캐시가 없거나 읽을 수 없으면 빈 집합(연락처 규칙 없이 동작).
  public static func cached(from url: URL? = nil) -> Set<String> {
    guard let url = url ?? defaultURL, let data = try? Data(contentsOf: url),
          let names = try? JSONDecoder().decode([String].self, from: data) else { return [] }
    return Set(names)
  }
}
