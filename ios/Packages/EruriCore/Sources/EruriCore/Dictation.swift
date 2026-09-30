import Foundation

/// 채팅 음성 입력 상태(스펙 §9): 기기 안 받아쓰기(Speech, 온디바이스 전용) — 음성은 서버로 보내지 않는다(§12).
/// 오디오·인식기는 앱이 맡고, 여기서는 상태 전이만 한다(단위 테스트 대상)
public struct Dictation: Equatable, Sendable {
  public enum Reason: Equatable, Sendable { case denied, noOnDevice }
  public enum Phase: Equatable, Sendable { case idle, recording, unavailable(Reason) }
  /// 마이크·음성 인식 권한을 합친 값. undetermined 면 첫 탭에서 묻는다
  public enum Permission: Sendable { case undetermined, granted, denied }
  public enum Effect: Equatable, Sendable { case none, start, stop }

  public static let silenceTimeout: TimeInterval = 2

  public private(set) var phase: Phase = .idle
  private var base = ""   // 녹음을 시작할 때 입력창에 있던 글 — 받아쓴 글을 그 뒤에 붙인다

  public init() {}

  public mutating func setAvailability(permission: Permission, onDevice: Bool) {
    if permission == .denied { phase = .unavailable(.denied) }
    else if !onDevice { phase = .unavailable(.noOnDevice) }
    else if case .unavailable = phase { phase = .idle }
  }

  /// 버튼 안내 문구. 쓸 수 있으면 nil
  public var notice: String? {
    switch phase {
    case .unavailable(.denied): "음성 입력을 쓰려면 설정에서 마이크·음성 인식을 허용하세요"
    case .unavailable(.noOnDevice): "이 기기는 기기 안 한국어 음성 인식을 지원하지 않습니다"
    default: nil
    }
  }

  public mutating func tap(currentText: String) -> Effect {
    switch phase {
    case .idle: base = currentText; phase = .recording; return .start
    case .recording: phase = .idle; return .stop
    case .unavailable: return .none
    }
  }

  /// 부분·최종 결과가 올 때마다 입력창에 넣을 전체 글. 녹음 중이 아니면 nil(늦게 온 결과 무시)
  public mutating func transcript(_ text: String) -> String? {
    guard phase == .recording else { return nil }
    if base.isEmpty || base.hasSuffix(" ") || base.hasSuffix("\n") { return base + text }
    return base + " " + text
  }

  /// 인식기가 스스로 끝났거나(최종·오류) 시작에 실패했을 때
  public mutating func ended() {
    if phase == .recording { phase = .idle }
  }

  public static func silent(lastHeard: Date, now: Date) -> Bool {
    now.timeIntervalSince(lastHeard) >= silenceTimeout
  }
}
