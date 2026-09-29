import UIKit
import EruriCore

/// Trace 공통 필드 중 UIKit·파일 보호가 필요한 값(0.2.1). 잠금은 `.complete` probe 로 판정하고(LockState),
/// UIKit 값은 `locked_app` 으로 비교용만 남긴다(스펙 §6 업로더).
enum AppState {
  struct Snapshot: Sendable {
    let lock: LockState
    let probe: LockProbeRead
    let lockedApp: Bool
    let bg: Bool
    var traceFields: [String: Any] {
      ["locked": lock.traceValue, "lock_state": lock.rawValue, "lock_probe": probe.code, "locked_app": lockedApp, "bg": bg]
    }
  }

  static func snapshot() async -> Snapshot {
    let (available, bg) = await MainActor.run {
      (UIApplication.shared.isProtectedDataAvailable, UIApplication.shared.applicationState == .background)
    }
    let probe = LockProbe.read(at: LockProbe.url)
    return Snapshot(lock: LockState.resolve(probe: probe), probe: probe, lockedApp: !available, bg: bg)
  }

  /// 앱이 활성·잠금 해제 상태일 때 probe 파일을 만든다(없으면 판정이 unknown)
  @MainActor static func prepareProbe() {
    guard UIApplication.shared.isProtectedDataAvailable else { return }
    LockProbe.ensure(at: LockProbe.url)
  }
}
