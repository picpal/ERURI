import Foundation
import Observation
import EruriCore

/// 채팅 대화 기록(스펙 §9 "대화 기록·짧은 맥락"): 앱 전용 파일에 기기에만. 쓰기는 ChatHistoryWriter 가 세대 순으로.
/// 지우기(설정·로그아웃·계정 삭제·삭제 푸시·로그인 사용자 바뀜)는 clearCount 를 올려 채팅 화면이 바로 비운다 — clearCount 는 늦은 답을 거르는 epoch 이기도 하다
@MainActor @Observable final class ChatLog {
  static let shared = ChatLog()
  private(set) var clearCount = 0
  /// 파일을 읽었다(또는 지웠다). false 면 저장하지 않는다 — 잠금 중 보호 파일을 못 읽은 상태에서 쓰면 30일 기록 전체를 덮는다(H3 리뷰 Important 1).
  /// 화면은 이 상태에서 30일 정리·맥락 전송도 하지 않고 다음 활성화 때 다시 불러온다
  @ObservationIgnored private(set) var loaded = false
  @ObservationIgnored private let store: ChatHistoryStore?
  @ObservationIgnored private let writer = ChatHistoryWriter()
  @ObservationIgnored private var gen = 0

  private init() { store = (try? ChatHistoryStore.defaultURL()).map(ChatHistoryStore.init(url:)) }

  /// 30일·500개를 넘는 턴을 빼고 끝나지 않은 턴을 끝난 문구로(D7·D11). 바뀌었으면 파일도 고친다. 진단에는 개수만.
  /// nil = 읽지 못했다(불러오지 않음 — 파일 없음·손상·다른 버전은 빈 기록으로 읽은 것). 파일 위치를 못 정하면 쓸 곳도 없으므로 빈 기록
  func load() -> [ChatHistory.Record]? {
    guard let store else { loaded = true; return [] }
    let all: [ChatHistory.Record]
    do { all = try store.load() } catch {
      loaded = false
      let ns = error as NSError
      DiagLog.append("CHAT history load failed \(ns.domain):\(ns.code)")
      return nil
    }
    loaded = true
    let kept = ChatHistory.restored(ChatHistory.prune(all, now: Date()))
    DiagLog.append("CHAT history loaded=\(kept.count) pruned=\(all.count - kept.count)")
    if kept != all { save(kept) }
    return kept
  }

  func save(_ records: [ChatHistory.Record]) {
    guard let store, loaded else { return }
    gen += 1
    let g = gen
    Task { await writer.apply(records, gen: g, store: store) }
  }

  /// 불러오지 않은 상태에서도 파일을 지운다. 지운 뒤에는 빈 기록을 읽은 것과 같다(이후 저장이 덮을 기록이 없다)
  func clear() {
    clearCount += 1
    guard let store else { return }
    loaded = true
    gen += 1
    let g = gen
    Task { await writer.apply(nil, gen: g, store: store) }
    DiagLog.append("CHAT history cleared")
  }

  /// 로그인한 사용자가 바뀌면(D7 — 자동 로그아웃 뒤 다른 Apple ID) 앞 사용자의 대화를 지운다. 소유자는 id 만 UserDefaults.standard 에.
  /// 소유자가 없으면(0.12.0 첫 로그인·업그레이드 뒤 첫 재로그인) 누구 기록인지 모르므로 지운다
  func bind(owner: String) {
    if UserDefaults.standard.string(forKey: Self.ownerKey) != owner { clear(); DiagLog.append("CHAT owner changed") }
    UserDefaults.standard.set(owner, forKey: Self.ownerKey)
  }

  /// 계정 삭제·삭제 푸시: 지운 계정의 id 를 기기에 남기지 않는다(로그아웃은 같은 사용자 재로그인 때 기록을 지키려고 남긴다)
  func forgetOwner() { UserDefaults.standard.removeObject(forKey: Self.ownerKey) }

  private static let ownerKey = "chat.owner"
}
