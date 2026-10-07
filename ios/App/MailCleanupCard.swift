import SwiftUI
import EruriCore

/// 채팅 메일 정리 카드(스펙 §9 "채팅 메일 정리", 0.14.0): 미리보기(서버가 확정한 조건 줄·건수·위 20건) → [실행]·[취소] → 진행 → 결과·[되돌리기]·[다음 1,000건 보기].
/// 실행 버튼이 곧 확인이다(확인창 없음). 시간 창(토큰 10분·되돌리기 7일)·연도 표기는 30초마다 다시 본다 — 서버가 원본(410)
struct MailCleanupCard: View {
  let turn: MailTurn
  var onExecute: () -> Void
  var onCancel: () -> Void
  var onUndo: () -> Void
  var onRepreview: () -> Void
  var onNext: () -> Void
  var onSettings: () -> Void

  var body: some View {
    TimelineView(.periodic(from: .now, by: 30)) { ctx in
      VStack(alignment: .leading, spacing: 8) {
        if turn.phase == .finding {
          HStack { ProgressView(); Text(MailCleanupText.finding).font(.subheadline) }
        } else {
          if let p = turn.preview { previewBlock(p, now: ctx.date) }
          if let s = turn.status { statusBlock(s, now: ctx.date) }
          else if turn.phase == .running { ProgressView().accessibilityIdentifier("mail-progress") }   // 실행 요청 중·결과 확인 중(상태 전)
        }
        if let n = turn.note { Text(n).font(.footnote).foregroundStyle(.secondary).accessibilityIdentifier("mail-note") }
        if turn.settings { Button(MailCleanupText.openSettings, action: onSettings).buttonStyle(.bordered).accessibilityIdentifier("mail-open-settings") }
      }
      .accessibilityElement(children: .contain)
      .accessibilityIdentifier("mail-card")
    }
  }

  @ViewBuilder private func previewBlock(_ p: MailCleanup.Preview, now: Date) -> some View {
    Text(MailCleanupText.header(p.action)).font(.headline)
    Text(MailCleanup.conditionLine(p.conditions, now: now)).font(.footnote).accessibilityIdentifier("mail-conditions")
    Text(MailCleanup.countLine(p)).font(.footnote).foregroundStyle(.secondary).accessibilityIdentifier("mail-count")
    ForEach(Array(p.sample.enumerated()), id: \.offset) { Text(MailCleanup.sampleLine($0.element, now: now)).font(.caption).lineLimit(1) }
    if let more = MailCleanup.moreLine(p) { Text(more).font(.caption).foregroundStyle(.secondary) }
    if turn.phase == .preview {
      if turn.repreview || (turn.previewAt.map { MailCleanup.isTokenExpired(previewAt: $0, now: now) } ?? true) {
        Text(MailCleanupText.expired).font(.footnote).accessibilityIdentifier("mail-expired")
        Button(MailCleanupText.repreview, action: onRepreview).buttonStyle(.bordered).accessibilityIdentifier("mail-repreview")
      } else {
        HStack {
          Button(MailCleanupText.button(p.action, p.count), action: onExecute).buttonStyle(.borderedProminent).accessibilityIdentifier("mail-execute")
          Button(MailCleanupText.cancel, action: onCancel).buttonStyle(.bordered).accessibilityIdentifier("mail-cancel")
        }
      }
    }
  }

  @ViewBuilder private func statusBlock(_ s: MailCleanup.Status, now: Date) -> some View {
    let action = turn.preview?.action ?? "trash"
    if !s.finished {
      HStack { ProgressView(); Text(MailCleanup.progress(s, action: action)).font(.subheadline) }.accessibilityIdentifier("mail-progress")
    } else {
      let r = MailCleanup.result(s, action: action)
      Text(r.text).font(.subheadline).accessibilityIdentifier("mail-result")
      if r.settings && !turn.settings { Button(MailCleanupText.openSettings, action: onSettings).buttonStyle(.bordered).accessibilityIdentifier("mail-open-settings") }
      if turn.phase == .running {
        ProgressView().accessibilityIdentifier("mail-progress")              // 되돌리기 요청 중(저장된 상태는 실행 결과)
      } else if turn.phase == .ended, let at = turn.previewAt {
        if MailCleanup.canUndo(s, previewAt: at, now: now) {
          Button(MailCleanupText.undo, action: onUndo).buttonStyle(.bordered).accessibilityIdentifier("mail-undo")
        } else if ["done", "partial"].contains(s.status), s.done > 0 {
          Text(MailCleanupText.undoExpired(action)).font(.footnote).foregroundStyle(.secondary).accessibilityIdentifier("mail-undo-expired")
        }
        if let p = turn.preview, MailCleanup.showNext(p, s) {
          Button(MailCleanupText.nextPage, action: onNext).buttonStyle(.bordered).accessibilityIdentifier("mail-next")
        }
      }
    }
  }
}
