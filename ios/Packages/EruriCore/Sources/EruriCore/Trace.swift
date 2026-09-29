import Foundation
import CryptoKit

/// 진단 관찰값을 eruri.log 와 큐(kind = 'trace')에 남긴다. 큐의 trace 는 Uploader 가 POST /functions/v1/ingest/trace 로 올린다(서버 device_traces, 30일).
/// 본문·제목·발신자 원문은 넣지 않는다 — 길이(text_len)와 해시(text_sha8)만. 설정 "진단 전송"이 꺼지면 큐에 넣지 않는다.
public enum Trace {
  static let forbiddenKeys: Set<String> = ["content", "text", "body"]   // 서버도 400 으로 거부한다
  static var eventPattern: Regex<Substring> { /^(?:capture|device|action|share|upload)\.[a-z0-9_.]{1,60}$/ }   // 서버 ingest/trace.ts 와 같은 값(비캡처 그룹: Regex<Substring> 유지)

  /// 호출 쪽이 `locked`·`bg`·`source`·`elapsed_ms`·`text_len`·`text_sha8` 등을 넣는다(UIKit 이 필요한 값은 앱에서 채운다).
  /// `device_id`·`build` 는 여기서 붙인다. 규칙 위반(금지 키·이벤트 이름·JSON 불가 값)은 큐에 넣지 않고 로그만 남긴다.
  public static func log(_ event: String, _ fields: [String: Any], queue: CaptureQueue? = nil, defaults: UserDefaults = IngestSettings.shared) {
    let now = Date()
    DiagLog.append("trace \(event) " + fields.keys.sorted().map { "\($0)=\(fields[$0]!)" }.joined(separator: " "))
    guard Diagnostics.isEnabled(defaults: defaults) else { return }   // 진단 전송 꺼짐: 로컬 로그만
    guard let data = payload(event, fields, deviceID: deviceID, build: build, at: now) else {
      DiagLog.append("trace rejected \(event)"); return
    }
    do { try (queue ?? CaptureQueue.shared()).enqueueTrace(id: UUID().uuidString, payload: data, at: now) }
    catch { DiagLog.append("trace enqueue error \(event) \(type(of: error))") }   // BFU 에서는 큐가 열리지 않는다
  }

  static func payload(_ event: String, _ fields: [String: Any], deviceID: String, build: String, at: Date) -> Data? {
    guard event.wholeMatch(of: eventPattern) != nil, !hasForbiddenKey(fields) else { return nil }
    var f = fields; f["build"] = build
    let obj: [String: Any] = ["device_id": deviceID, "event": event, "at": iso(at), "fields": f]
    guard JSONSerialization.isValidJSONObject(obj) else { return nil }
    return try? JSONSerialization.data(withJSONObject: obj, options: [.sortedKeys])
  }

  /// 큐에 저장된 JSON 객체들을 계약의 배열 본문으로 잇는다.
  public static func batchBody(_ payloads: [Data]) -> Data {
    var d = Data("[".utf8)
    for (i, p) in payloads.enumerated() { if i > 0 { d.append(Data(",".utf8)) }; d.append(p) }
    d.append(Data("]".utf8))
    return d
  }

  /// SHA-256 hex 앞 8자. 같은 입력을 세션 간 대조할 때만 쓴다.
  public static func sha8(_ s: String) -> String {
    SHA256.hash(data: Data(s.utf8)).prefix(4).map { String(format: "%02x", $0) }.joined()
  }

  /// App Group 에 한 번 만들어 두는 기기 식별자(앱·확장 공용). identifierForVendor 는 확장·재설치에서 달라질 수 있다.
  public static var deviceID: String {
    let d = IngestSettings.shared, key = "deviceID"
    if let v = d.string(forKey: key) { return v }
    let v = UUID().uuidString; d.set(v, forKey: key); return v
  }
  public static var build: String { Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "-" }

  static func hasForbiddenKey(_ v: Any) -> Bool {
    if let o = v as? [String: Any] { return o.contains { forbiddenKeys.contains($0.key.lowercased()) || hasForbiddenKey($0.value) } }
    if let a = v as? [Any] { return a.contains(where: hasForbiddenKey) }
    return false
  }
  static func iso(_ d: Date) -> String {
    let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return f.string(from: d)
  }
}
