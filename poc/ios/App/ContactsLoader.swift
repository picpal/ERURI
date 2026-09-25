import Contacts
import AssistantCore

/// 연락처 이름을 읽어 App Group 캐시(`ContactNames`)에 저장한다. 앱 실행·포그라운드 복귀 때 호출.
/// 권한이 없으면 빈 집합을 저장해 연락처 규칙 없이 동작하고, 상태만 로그에 남긴다(이름은 남기지 않음).
enum ContactsLoader {
  static func refresh() { Task { await refreshNow() } }

  static func refreshNow() async {
    let status = CNContactStore.authorizationStatus(for: .contacts)
    guard status == .authorized || status == .limited else {
      try? ContactNames.save([])
      PoCLog.append("contacts status=\(label(status)) names=0")
      return
    }
    // enumerateContacts 는 동기 호출이라 메인 스레드 밖에서 돈다
    await Task.detached(priority: .utility) {
      let keys = [CNContactFormatter.descriptorForRequiredKeys(for: .fullName), CNContactNicknameKey as CNKeyDescriptor]
      var names = Set<String>()
      do {
        try CNContactStore().enumerateContacts(with: CNContactFetchRequest(keysToFetch: keys)) { c, _ in
          if let full = CNContactFormatter.string(from: c, style: .fullName), !full.isEmpty { names.insert(full) }
          if !c.nickname.isEmpty { names.insert(c.nickname) }
        }
        try ContactNames.save(names)
        PoCLog.append("contacts status=\(label(status)) names=\(names.count)")
      } catch {
        PoCLog.append("contacts error \(type(of: error))")
      }
    }.value
  }

  /// 권한 요청은 포그라운드(디버그 버튼)에서만 한다.
  static func requestAccess() {
    CNContactStore().requestAccess(for: .contacts) { granted, _ in
      PoCLog.append("contacts permission granted=\(granted)")
      refresh()
    }
  }

  static func label(_ s: CNAuthorizationStatus) -> String {
    switch s {
    case .authorized: "authorized"
    case .limited: "limited"
    case .denied: "denied"
    case .restricted: "restricted"
    case .notDetermined: "notDetermined"
    @unknown default: "unknown"
    }
  }
}
