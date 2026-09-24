import Foundation
import FoundationModels
import Synchronization

public enum NoticeKind: String, Codable, CaseIterable, Sendable { case notice, personal, otp, promo, medical_result }
public struct FMVerdict: Equatable, Sendable { public let kind: NoticeKind; public let confidence: Double }

/// 분류 한 건의 결과. `classify`는 이것을 옵셔널로 접는다(nil = 불가·타임아웃·에러, 스펙 §6 폴백).
public enum FMOutcome: Equatable, Sendable {
  case verdict(FMVerdict)
  case unavailable(String)
  case timeout
  case error(String)   // GenerationError 종류 코드만. 내용은 담지 않는다
  public var verdict: FMVerdict? { if case .verdict(let v) = self { v } else { nil } }
}

@Generable
enum GenKind { case notice, personal, otp, promo, medical_result }   // enum 이라 스키마 밖 값이 나오지 않는다

@Generable
struct GenVerdict {
  @Guide(description: "notice=기업·기관·봇의 정형 안내(주문,배송,예약,결제,병원 안내). personal=사람이 쓴 대화. otp=인증번호. promo=광고. medical_result=검사 결과·진단 내용")
  var kind: GenKind
  @Guide(description: "0.0~1.0") var confidence: Double
}

public actor FMClassifier {
  public static func availability() -> String {
    switch SystemLanguageModel.default.availability {
    case .available: return "available"
    case .unavailable(.deviceNotEligible): return "deviceNotEligible"
    case .unavailable(.appleIntelligenceNotEnabled): return "appleIntelligenceNotEnabled"
    case .unavailable(.modelNotReady): return "modelNotReady"
    case .unavailable(_): return "unavailable"
    }
  }
  static let instructions = """
    너는 한국어 휴대폰 알림을 분류한다. 알림의 앱·제목·본문을 보고 kind를 정한다.
    사람 사이의 대화(약속 잡기, 안부, 질문)는 키워드가 무엇이든 personal이다.
    기업·기관·봇이 보낸 정형 안내는 notice다.
    """
  public init() {}

  public func classify(text: String, appName: String?, title: String? = nil, timeout: Duration = .seconds(3)) async -> FMVerdict? {
    await classifyDetailed(text: text, appName: appName, title: title, timeout: timeout).verdict
  }

  /// 호출마다 새 세션: 세션은 transcript 를 누적(4,096토큰 한도)하고 동시 요청을 거부하므로 재사용하지 않는다.
  /// 타임아웃은 respond 의 취소 협조 여부와 무관하게 그 시점에 반환한다(TaskGroup 은 자식 종료를 기다리므로 쓰지 않음).
  public func classifyDetailed(text: String, appName: String?, title: String? = nil, timeout: Duration = .seconds(3)) async -> FMOutcome {
    let avail = Self.availability()
    guard avail == "available" else { return .unavailable(avail) }
    let prompt = "앱: \(appName ?? "unknown")\n제목: \(title ?? "-")\n알림: \(text.prefix(1500))"
    let session = LanguageModelSession(instructions: Self.instructions)
    let once = Once()
    return await withCheckedContinuation { (c: CheckedContinuation<FMOutcome, Never>) in
      let work = Task {
        let outcome: FMOutcome
        do {
          let r = try await session.respond(to: prompt, generating: GenVerdict.self)
          outcome = .verdict(FMVerdict(kind: r.content.kind.noticeKind, confidence: r.content.confidence))
        } catch let e as LanguageModelSession.GenerationError {
          outcome = .error(Self.code(e))
        } catch {
          outcome = .error(error is CancellationError ? "cancelled" : "other")
        }
        if once.fire() {
          if case .error(let code) = outcome { PoCLog.append("FM error \(code)") }   // 내용은 로그에 남기지 않음
          c.resume(returning: outcome)
        }
      }
      Task {
        try? await Task.sleep(for: timeout)
        if once.fire() { work.cancel(); c.resume(returning: .timeout) }
      }
    }
  }

  static func code(_ e: LanguageModelSession.GenerationError) -> String {
    switch e {
    case .rateLimited: "rateLimited"
    case .guardrailViolation: "guardrail"
    case .exceededContextWindowSize: "context"
    case .concurrentRequests: "concurrent"
    case .assetsUnavailable: "assets"
    case .decodingFailure: "decoding"
    case .unsupportedLanguageOrLocale: "locale"
    case .unsupportedGuide: "guide"
    case .refusal: "refusal"
    @unknown default: "other"
    }
  }
}

/// 경합하는 두 경로(응답·타임아웃) 중 먼저 끝난 쪽만 continuation 을 재개하게 한다.
final class Once: Sendable {
  private let fired = Mutex(false)
  func fire() -> Bool { fired.withLock { was in defer { was = true }; return !was } }
}

extension GenKind {
  var noticeKind: NoticeKind {
    switch self {
    case .notice: .notice
    case .personal: .personal
    case .otp: .otp
    case .promo: .promo
    case .medical_result: .medical_result
    }
  }
}
