import Foundation
import FoundationModels

public enum NoticeKind: String, Codable, CaseIterable, Sendable { case notice, personal, otp, promo, medical_result }
public struct FMVerdict: Equatable, Sendable { public let kind: NoticeKind; public let confidence: Double }

@Generable
struct GenVerdict {
  @Guide(description: "notice=기업·기관의 자동 알림(주문,배송,예약,결제,병원 안내). personal=사람이 사람에게 쓴 대화. otp=인증번호. promo=광고. medical_result=검사 결과·진단 내용")
  var kind: String
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
  private let session: LanguageModelSession
  public init() {
    session = LanguageModelSession(instructions: """
      너는 한국어 휴대폰 알림을 분류한다. 알림 텍스트만 보고 kind를 정한다.
      사람 사이의 대화(약속 잡기, 안부, 질문)는 키워드가 무엇이든 personal이다.
      기업·기관·봇이 보낸 정형 안내는 notice다.
      """)
  }
  public func classify(text: String, appName: String?, timeout: Duration = .seconds(3)) async throws -> FMVerdict? {
    // 인터페이스 계약(nil = 불가·타임아웃)을 지키기 위해, 모델을 아예 쓸 수 없으면
    // respond()가 던질 에러를 굳이 경합시키지 않고 바로 nil을 반환한다.
    guard Self.availability() == "available" else { return nil }
    let prompt = "앱: \(appName ?? "unknown")\n알림: \(text)"
    return try await withThrowingTaskGroup(of: FMVerdict?.self) { g in
      g.addTask { [session] in
        let r = try await session.respond(to: prompt, generating: GenVerdict.self)
        return FMVerdict(kind: NoticeKind(rawValue: r.content.kind) ?? .personal, confidence: r.content.confidence)
      }
      g.addTask { try await Task.sleep(for: timeout); return nil }
      let first = try await g.next() ?? nil
      g.cancelAll()
      return first
    }
  }
}
