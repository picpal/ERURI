import Foundation
import EruriCore

/// 사용자 JWT 로 Supabase REST·Edge 를 부른다. 401 이면 세션을 버리고 한 번 다시 시도한다. 본문·토큰은 로그에 남기지 않는다
enum API {
  /// nil = 설정·세션 없음 또는 네트워크 오류
  static func send(_ path: String, method: String = "GET", json: Any? = nil, headers: [String: String] = [:],
                   timeout: TimeInterval = 8) async -> (status: Int, data: Data)? {
    guard let cfg = SupabaseSession.config else { return nil }
    for attempt in 0..<2 {
      guard let url = URL(string: path, relativeTo: cfg.url.appendingPathComponent("/")),
            let jwt = await SupabaseSession.shared.accessToken() else { return nil }
      var r = URLRequest(url: url, timeoutInterval: timeout)
      r.httpMethod = method
      r.setValue("Bearer \(jwt)", forHTTPHeaderField: "Authorization")
      r.setValue(cfg.anonKey, forHTTPHeaderField: "apikey")
      for (k, v) in headers { r.setValue(v, forHTTPHeaderField: k) }
      if let json { r.setValue("application/json", forHTTPHeaderField: "Content-Type"); r.httpBody = try? JSONSerialization.data(withJSONObject: json) }
      guard let (data, resp) = try? await URLSession.shared.data(for: r) else { return nil }
      let status = (resp as? HTTPURLResponse)?.statusCode ?? -1
      if status == 401, attempt == 0 { await SupabaseSession.shared.invalidate(); continue }
      return (status, data)
    }
    return nil
  }
}
