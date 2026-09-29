import Foundation

/// `.complete` 보호 파일을 읽어 본 결과. Complete 등급 키는 기기가 잠기면(약 10초 유예 뒤) 사라져 읽기가 권한 오류로 실패한다.
public enum LockProbeRead: Equatable, Sendable {
  case readable, denied, missing, error(Int)
  public var code: String {
    switch self {
    case .readable: return "readable"
    case .denied: return "denied"
    case .missing: return "missing"
    case .error(let c): return "error:\(c)"
    }
  }
}

/// trace 잠금 판정(0.2.1, 스펙 §6 업로더). UIKit `isProtectedDataAvailable` 대신 probe 결과를 쓴다(09-29 백그라운드 오판정).
public enum LockState: String, Sendable {
  case locked, unlocked, unknown

  public static func resolve(probe: LockProbeRead) -> LockState {
    switch probe {
    case .readable: return .unlocked
    case .denied: return .locked
    case .missing, .error: return .unknown
    }
  }

  public var boolValue: Bool? { self == .unknown ? nil : self == .locked }
  /// trace `locked` 필드: true/false, 판정 실패는 JSON null(`(fields->>'locked')::boolean` 집계가 깨지지 않게)
  public var traceValue: Any { boolValue.map { $0 as Any } ?? NSNull() }
}

public enum LockProbe {
  /// 앱 컨테이너 Library(확장·다른 프로세스와 공유하지 않는다)
  public static var url: URL {
    FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask)[0].appendingPathComponent("lock-probe")
  }

  /// 잠금 해제 상태에서만 만들 수 있다(잠금 중에는 `.complete` 파일을 쓸 수 없다). 이미 있으면 그대로 둔다
  public static func ensure(at url: URL) {
    guard !FileManager.default.fileExists(atPath: url.path) else { return }
    try? Data("1".utf8).write(to: url, options: [.completeFileProtection, .atomic])
  }

  public static func read(at url: URL) -> LockProbeRead {
    do { _ = try Data(contentsOf: url); return .readable } catch { return classify(error) }
  }

  public static func classify(_ error: Error) -> LockProbeRead {
    let e = error as NSError
    if e.domain == NSCocoaErrorDomain && (e.code == NSFileReadNoSuchFileError || e.code == NSFileNoSuchFileError) { return .missing }
    if e.domain == NSCocoaErrorDomain && e.code == NSFileReadNoPermissionError { return .denied }
    if isPermission(e) { return .denied }
    if let u = e.userInfo[NSUnderlyingErrorKey] as? NSError, isPermission(u) { return .denied }
    return .error(e.code)
  }

  private static func isPermission(_ e: NSError) -> Bool {
    e.domain == NSPOSIXErrorDomain && (e.code == Int(EPERM) || e.code == Int(EACCES))
  }
}
