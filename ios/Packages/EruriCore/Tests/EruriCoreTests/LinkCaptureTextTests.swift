import XCTest
@testable import EruriCore

/// 링크·사진 읽기 문구(스펙 §6·§9). 주소·제목을 받는 인자가 없다
final class LinkCaptureTextTests: XCTestCase {
  func testShareTexts() {
    XCTAssertEqual(LinkCaptureText.share(.queued(captureID: "c", chars: 812, ocr: false, timedOut: false)),
                   "페이지에서 글 812자를 읽었어요. 일정을 찾으면 알림으로 알려 드릴게요.")
    XCTAssertEqual(LinkCaptureText.share(.duplicate), "이미 읽은 링크예요. 제안 탭에서 확인해 주세요.")
    XCTAssertEqual(LinkCaptureText.share(.handedOff("no_date")), "그림으로 된 페이지 같아요. ERURI 앱을 열면 그림 속 글자까지 다시 읽어요.")
    XCTAssertEqual(LinkCaptureText.share(.handedOff("empty")), "그림으로 된 페이지 같아요. ERURI 앱을 열면 그림 속 글자까지 다시 읽어요.")
    XCTAssertEqual(LinkCaptureText.share(.handedOff("timeout")), "지금은 다 읽지 못했어요. ERURI 앱을 열면 다시 읽어요.")
    XCTAssertEqual(LinkCaptureText.share(.discarded("otp")), "보안 숫자로 보이는 내용이 있어 저장하지 않았어요.")
    XCTAssertEqual(LinkCaptureText.share(.failed("http_404")), "페이지를 읽지 못했어요(페이지 오류 404).")
    XCTAssertEqual(LinkCaptureText.share(.failed("blocked_host")), "페이지를 읽지 못했어요(내부 네트워크 주소는 열지 않아요).")
    XCTAssertEqual(LinkCaptureText.shareFallback("insecure"), "페이지를 읽지 못해 공유한 글만 저장했어요(보안 연결(https)이 안 되는 페이지예요).")
    XCTAssertEqual(LinkCaptureText.storageNote, "읽은 글은 공유한 내용처럼 암호화해 보관해요. 짧은 페이지는 보이는 글 전체가 저장돼요.")
  }

  /// 확장의 큐 쓰기 실패(L4 메인 판정): failed("queue") 는 텍스트 폴백을 하지 않고(LinkFlow.fallsBackToText) 대기 행을 앱이 이어받으므로
  /// "앱을 열면 다시 읽어요" 계열. 다른 확정 실패·채팅 문구는 그대로
  func testShareQueueFailureText() {
    XCTAssertEqual(LinkCaptureText.share(.failed("queue")), "기기에 잠시 저장하지 못했어요. ERURI 앱을 열면 다시 읽어요.")
    XCTAssertEqual(LinkCaptureText.share(.failed("timeout")), "페이지를 읽지 못했어요(시간이 너무 걸려요).")
    XCTAssertEqual(LinkCaptureText.chat(.failed("queue")), "페이지를 읽지 못했어요(기기에 저장하지 못했어요).")
  }

  func testChatTexts() {
    XCTAssertEqual(LinkCaptureText.chat(.queued(captureID: "c", chars: 640, ocr: true, timedOut: false)), "페이지에서 글 640자를 읽었어요. 일정을 찾는 중…")
    XCTAssertEqual(LinkCaptureText.chat(.failed("timeout")), "페이지를 읽지 못했어요(시간이 너무 걸려요).")
    XCTAssertEqual(LinkCaptureText.chat(.discarded("otp")), "보안 숫자로 보이는 내용이 있어 저장하지 않았어요.")
    XCTAssertEqual(LinkCaptureText.chat(.duplicate), "이미 읽은 링크예요. 제안 탭에서 확인해 주세요.")
    XCTAssertEqual(LinkCaptureText.chat(.retry("cancelled")), "앱으로 돌아오면 다시 읽어요.")
    XCTAssertEqual(LinkCaptureText.chat(.retry("timeout")), "지금은 다 읽지 못했어요(시간이 너무 걸려요). 잠시 뒤 다시 읽고, 일정을 찾으면 알림으로 알려 드려요.")
  }

  func testImageTexts() {
    XCTAssertEqual(LinkCaptureText.image(.queued(captureID: "c", chars: 120, images: 2), chat: false),
                   "사진에서 글 120자를 읽었어요. 일정을 찾으면 알림으로 알려 드릴게요.")
    XCTAssertEqual(LinkCaptureText.image(.queued(captureID: "c", chars: 120, images: 2), chat: true), "사진에서 글 120자를 읽었어요. 일정을 찾는 중…")
    XCTAssertEqual(LinkCaptureText.image(.empty, chat: true), "사진에서 글자를 찾지 못했어요.")
    XCTAssertEqual(LinkCaptureText.image(.discarded("otp"), chat: false), "보안 숫자로 보이는 내용이 있어 저장하지 않았어요.")
    XCTAssertEqual(LinkCaptureText.image(.failed("queue"), chat: false), "사진을 읽지 못했어요.")
  }

  /// 서버 처리 결과(스펙 §9): 본인 items.status·gate_label·facts 종류만 본다
  func testChatResult() {
    XCTAssertNil(LinkCaptureText.chatResult(status: nil, gateLabel: nil, kinds: []))
    XCTAssertNil(LinkCaptureText.chatResult(status: "queued", gateLabel: nil, kinds: []))
    XCTAssertEqual(LinkCaptureText.chatResult(status: "extracted", gateLabel: "actionable", kinds: ["event", "event"]),
                   "일정 2건을 찾았어요 — '제안' 탭과 알림에서 추가할 수 있어요.")
    XCTAssertEqual(LinkCaptureText.chatResult(status: "extracted", gateLabel: "actionable", kinds: ["task"]), "할 일을 찾았어요 — 알림에서 확인하세요.")
    XCTAssertEqual(LinkCaptureText.chatResult(status: "extracted", gateLabel: nil, kinds: ["purchase"]), "이 페이지에서 일정을 찾지 못했어요.")
    XCTAssertEqual(LinkCaptureText.chatResult(status: "discarded:server:empty", gateLabel: "notice", kinds: []), "이 페이지에서 일정을 찾지 못했어요.")
    XCTAssertEqual(LinkCaptureText.chatResult(status: "discarded:server:empty", gateLabel: nil, kinds: [], subject: .image), "이 사진에서 일정을 찾지 못했어요.")
    XCTAssertEqual(LinkCaptureText.chatResult(status: "discarded:server:promo", gateLabel: "promo", kinds: []),
                   "분류에서 걸러졌어요 — 보관함 › 최근 폐기에서 복구할 수 있어요.")
    XCTAssertEqual(LinkCaptureText.chatResult(status: "discarded:server:otp", gateLabel: nil, kinds: []), "보안 숫자로 보이는 내용이 있어 저장하지 않았어요.")
  }

  func testReasonsCarryNoAddress() {
    for code in ["blocked_scheme", "blocked_host", "redirects", "unsupported", "timeout", "empty", "web_process", "cancelled", "http_500",
                 "load_failed", "insecure", "queue", "bad_url"] {
      XCTAssertFalse(LinkCaptureText.reason(code).isEmpty, code)
      XCTAssertFalse(LinkCaptureText.reason(code).contains("http:"), code)
    }
    XCTAssertEqual(LinkCaptureText.reason("insecure"), "보안 연결(https)이 안 되는 페이지예요")
    XCTAssertEqual(LinkCaptureText.drainFailedBody("timeout"), "시간이 너무 걸려요. 날짜·장소 글을 복사해 ERURI로 공유해 주세요.")
  }
}
