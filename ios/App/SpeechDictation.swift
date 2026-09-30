import AVFoundation
import Speech
import SwiftUI
import EruriCore

/// 채팅 음성 입력(스펙 §9·§12): ko-KR 기기 안 인식만(requiresOnDeviceRecognition). 음성·받아쓴 글을 서버로 보내지 않는다.
/// 상태 전이는 EruriCore.Dictation, 여기서는 권한·오디오·인식기만 맡는다
@MainActor @Observable final class SpeechDictation {
  private(set) var state = Dictation()
  private let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "ko-KR"))
  private var engine: AVAudioEngine?
  private var request: SFSpeechAudioBufferRecognitionRequest?
  private var task: SFSpeechRecognitionTask?
  private var lastHeard = Date()
  private var silenceWatch: Task<Void, Never>?
  private var generation = 0   // 앞 녹음의 늦은 콜백이 새 녹음을 끊지 않게
  private var toggling = false // 권한 대화상자를 기다리는 동안 두 번 눌려 시작·정지가 연달아 실행되지 않게
  /// 받아쓴 전체 글을 입력창에 넣는다
  var onText: (String) -> Void = { _ in }

  var recording: Bool { state.phase == .recording }
  var available: Bool { if case .unavailable = state.phase { return false }; return true }

  /// 묻지 않고 현재 권한·지원 여부만 반영한다(화면이 뜰 때)
  func refresh() { state.setAvailability(permission: Self.permission(), onDevice: recognizer?.supportsOnDeviceRecognition == true) }

  func toggle(currentText: String) async {
    guard !toggling else { return }
    toggling = true; defer { toggling = false }
    if !recording {
      if Self.permission() == .undetermined { await Self.requestPermissions() }
      refresh()
    }
    switch state.tap(currentText: currentText) {
    case .start: if !start() { state.startFailed(); stop() }   // 녹음 중 표시에 갇히지 않게
    case .stop: stop()
    case .none: break
    }
  }

  /// 보내기 전·화면을 떠날 때
  func stopIfRecording() { if recording { _ = state.tap(currentText: ""); stop() } }

  private func start() -> Bool {
    guard let recognizer, recognizer.supportsOnDeviceRecognition else { return false }
    let session = AVAudioSession.sharedInstance()
    do {
      try session.setCategory(.record, mode: .measurement, options: .duckOthers)
      try session.setActive(true, options: .notifyOthersOnDeactivation)
    } catch { return false }
    let req = SFSpeechAudioBufferRecognitionRequest()
    req.requiresOnDeviceRecognition = true   // 서버 인식 금지(§12)
    req.shouldReportPartialResults = true
    let eng = AVAudioEngine()
    guard Self.installTap(eng, req) else { return false }
    eng.prepare()
    do { try eng.start() } catch { eng.inputNode.removeTap(onBus: 0); return false }
    engine = eng; request = req
    lastHeard = Date()
    generation += 1
    let gen = generation
    task = Self.recognize(recognizer, req) { [weak self] text, done in
      guard let self, gen == self.generation else { return }
      if let text, let full = self.state.transcript(text) { self.lastHeard = Date(); self.onText(full) }
      if done { self.state.ended(); self.stop() }
    }
    silenceWatch = Task { [weak self] in
      while !Task.isCancelled {
        try? await Task.sleep(for: .milliseconds(300))
        guard let self, self.recording else { return }
        if Dictation.silent(lastHeard: self.lastHeard, now: Date()) { self.stopIfRecording(); return }
      }
    }
    return true
  }

  private func stop() {
    silenceWatch?.cancel(); silenceWatch = nil
    engine?.stop(); engine?.inputNode.removeTap(onBus: 0); engine = nil
    request?.endAudio(); request = nil
    task?.cancel(); task = nil
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
  }

  // 오디오 스레드·인식기 큐에서 불리는 클로저는 메인 액터 격리 밖에서 만든다(Swift 6 격리 검사로 앱이 죽지 않게)
  nonisolated private static func installTap(_ eng: AVAudioEngine, _ req: SFSpeechAudioBufferRecognitionRequest) -> Bool {
    let format = eng.inputNode.outputFormat(forBus: 0)
    guard format.sampleRate > 0 else { return false }   // 시뮬레이터 등 입력 장치 없음
    nonisolated(unsafe) let r = req
    eng.inputNode.installTap(onBus: 0, bufferSize: 1024, format: format) { buf, _ in r.append(buf) }
    return true
  }

  nonisolated private static func recognize(_ recognizer: SFSpeechRecognizer, _ req: SFSpeechAudioBufferRecognitionRequest,
                                            _ handle: @escaping @MainActor (String?, Bool) -> Void) -> SFSpeechRecognitionTask {
    recognizer.recognitionTask(with: req) { result, error in
      let text = result?.bestTranscription.formattedString
      let done = error != nil || result?.isFinal == true
      Task { @MainActor in handle(text, done) }
    }
  }

  private static func permission() -> Dictation.Permission {
    let mic = AVAudioApplication.shared.recordPermission
    let speech = SFSpeechRecognizer.authorizationStatus()
    if mic == .denied || speech == .denied || speech == .restricted { return .denied }
    if mic == .granted && speech == .authorized { return .granted }
    return .undetermined
  }

  nonisolated private static func requestPermissions() async {
    _ = await AVAudioApplication.requestRecordPermission()
    _ = await withCheckedContinuation { (c: CheckedContinuation<SFSpeechRecognizerAuthorizationStatus, Never>) in
      SFSpeechRecognizer.requestAuthorization { c.resume(returning: $0) }
    }
  }
}
