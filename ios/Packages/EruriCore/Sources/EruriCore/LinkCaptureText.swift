import Foundation

/// 링크·사진 읽기 문구(스펙 §6·§9, 계획 D8). 주소·호스트·제목을 넣지 않는다
public enum LinkCaptureText {
  public static let reading = "링크를 읽는 중…"
  public static let imageReading = "사진에서 글자를 읽는 중…"
  public static let tooMany = "링크는 한 번에 하나씩 보내 주세요"
  /// 기기·서버 규칙 폐기(OTP 등). 청첩장 글의 우편번호·QR 번호가 걸릴 수 있어 "인증번호"라고 단정하지 않는다(Fable F10)
  public static let discarded = "보안 숫자로 보이는 내용이 있어 저장하지 않았어요."
  public static let duplicate = "이미 읽은 링크예요. 제안 탭에서 확인해 주세요."
  public static let pending = "아직 처리 중이에요 — 끝나면 알림으로 알려 드려요."
  /// 저장 범위(메인 판정 MR1 — 스펙 §6·§12): 확장 상태 화면·채팅 링크·사진 턴에 한 줄로
  public static let storageNote = "읽은 글은 공유한 내용처럼 암호화해 보관해요. 짧은 페이지는 보이는 글 전체가 저장돼요."
  public static let drainFailedTitle = "공유한 링크를 읽지 못했어요"
  public static let imageEmpty = "사진에서 글자를 찾지 못했어요."
  public static let imageFailed = "사진을 읽지 못했어요."

  public enum Subject: Sendable { case page, image }

  /// 실패 코드 → 사유(주소 없음)
  public static func reason(_ code: String) -> String {
    switch code {
    case "blocked_scheme": return "웹 주소가 아니에요"
    case "blocked_host": return "내부 네트워크 주소는 열지 않아요"
    case "redirects": return "페이지가 계속 다른 곳으로 넘어가요"
    case "unsupported": return "웹 페이지가 아니에요"
    case "insecure": return "보안 연결(https)이 안 되는 페이지예요"
    case "timeout": return "시간이 너무 걸려요"
    case "empty": return "읽을 글이 없어요"
    case "web_process": return "페이지가 너무 무거워요"
    case "cancelled": return "취소했어요"
    case "queue": return "기기에 저장하지 못했어요"
    case let c where c.hasPrefix("http_"): return "페이지 오류 \(c.dropFirst(5))"
    default: return "연결할 수 없어요"
    }
  }

  /// 공유 시트 결과(확장)
  public static func share(_ o: LinkFlow.Outcome) -> String {
    switch o {
    case .queued(_, let chars, _, _): return "페이지에서 글 \(chars)자를 읽었어요. 일정을 찾으면 알림으로 알려 드릴게요."
    case .duplicate: return duplicate
    case .handedOff("no_date"), .handedOff("empty"): return "그림으로 된 페이지 같아요. ERURI 앱을 열면 그림 속 글자까지 다시 읽어요."
    case .handedOff, .retry: return "지금은 다 읽지 못했어요. ERURI 앱을 열면 다시 읽어요."
    case .discarded: return discarded
    case .failed(let code): return "페이지를 읽지 못했어요(\(reason(code)))."
    }
  }

  /// 확장의 링크가 확정 실패해 원래 공유 글을 텍스트 항목으로 넣었을 때(D8)
  public static func shareFallback(_ code: String) -> String { "페이지를 읽지 못해 공유한 글만 저장했어요(\(reason(code)))." }

  /// 채팅 링크 턴의 읽기 결과(스펙 §9). queued 면 서버 처리를 기다린다
  public static func chat(_ o: LinkFlow.Outcome) -> String {
    switch o {
    case .queued(_, let chars, _, _): return "페이지에서 글 \(chars)자를 읽었어요. 일정을 찾는 중…"
    case .duplicate: return duplicate
    case .discarded: return discarded
    case .retry("cancelled"): return "앱으로 돌아오면 다시 읽어요."
    case .retry(let code): return "지금은 다 읽지 못했어요(\(reason(code))). 잠시 뒤 다시 읽고, 일정을 찾으면 알림으로 알려 드려요."
    case .handedOff(let code), .failed(let code): return "페이지를 읽지 못했어요(\(reason(code)))."
    }
  }

  /// 사진 결과(확장 chat: false, 채팅 chat: true)
  public static func image(_ o: ImageFlow.Outcome, chat: Bool) -> String {
    switch o {
    case .queued(_, let chars, _): return chat ? "사진에서 글 \(chars)자를 읽었어요. 일정을 찾는 중…" : "사진에서 글 \(chars)자를 읽었어요. 일정을 찾으면 알림으로 알려 드릴게요."
    case .discarded: return discarded
    case .empty: return imageEmpty
    case .failed: return imageFailed
    }
  }

  /// 채팅 링크·사진 턴의 서버 처리 결과(스펙 §9): 본인 items.status·gate_label·facts 종류. nil = 아직(행 없음·queued)
  public static func chatResult(status: String?, gateLabel: String?, kinds: [String], subject: Subject = .page) -> String? {
    guard let status, status != "queued" else { return nil }
    let noSchedule = subject == .page ? "이 페이지에서 일정을 찾지 못했어요." : "이 사진에서 일정을 찾지 못했어요."
    if status == "extracted" {
      let events = kinds.filter { $0 == "event" }.count
      if events > 0 { return "일정 \(events)건을 찾았어요 — '제안' 탭과 알림에서 추가할 수 있어요." }
      if kinds.contains("task") { return "할 일을 찾았어요 — 알림에서 확인하세요." }
      return noSchedule
    }
    if status == "discarded:server:empty" { return noSchedule }
    if let g = gateLabel, status == "discarded:server:\(g)" { return "분류에서 걸러졌어요 — 보관함 › 최근 폐기에서 복구할 수 있어요." }   // 게이트 7일 격리
    if status.hasPrefix("discarded:") { return discarded }                                                                      // 서버 규칙(게이트 전)
    return nil
  }

  /// 앱 이어받기 실패 로컬 알림 본문(주소·제목 없음) — 행을 지운 경우(확정 실패·3회 실패)에만
  public static func drainFailedBody(_ code: String) -> String { "\(reason(code)). 날짜·장소 글을 복사해 ERURI로 공유해 주세요." }
}
