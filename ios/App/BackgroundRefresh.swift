import BackgroundTasks
import EruriCore

/// BGAppRefreshTask. 큐가 비어 있지 않으면 flush 하고, 매 실행 후 다시 예약한다(최소 15분 뒤).
/// 등록은 `EruriApp` 의 `.backgroundTask(.appRefresh(id))`, 식별자는 Info.plist `BGTaskSchedulerPermittedIdentifiers`.
enum BackgroundRefresh {
  static let id = "com.picpal.eruri.refresh"
  static let interval: TimeInterval = 15 * 60

  static func run() async {
    schedule()
    let q = try? CaptureQueue.shared()
    let captures = (try? q?.captureCount()) ?? -1, traces = (try? q?.traceCount()) ?? -1
    let st = await AppState.snapshot()
    let base: [String: Any] = ["trigger": UploadTrigger.bgRefresh.rawValue, "pending": captures]
    Trace.log("upload.wake", base.merging(st.traceFields) { _, new in new })
    if captures > 0 || traces > 0 { await Uploader.shared.flush(trigger: .bgRefresh) }
  }

  /// 같은 식별자 요청이 이미 있으면 새 요청으로 바뀐다
  static func schedule() {
    let r = BGAppRefreshTaskRequest(identifier: id)
    r.earliestBeginDate = Date(timeIntervalSinceNow: interval)
    do { try BGTaskScheduler.shared.submit(r) } catch { DiagLog.append("bg refresh submit error \((error as NSError).code)") }
  }
}
