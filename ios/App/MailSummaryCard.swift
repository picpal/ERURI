import SwiftUI
import UIKit
import EruriCore

/// 채팅 메일 요약 카드(스펙 §9 "채팅 메일 요약", 0.15.0): 찾는 중 → 후보 카드(조건 줄·최대 5줄·[가장 최근 것]·더 있음 줄, 10분 뒤 [다시 찾기]) → 읽는 중 → 요약 카드.
/// 요약·번역·후보 글은 Text(verbatim:) — 마크다운·링크 해석 없이(메일이 심은 주소가 눌리지 않게). 막대는 "복사"만. 후보 카드의 시간 창은 만료 전까지 1초마다 다시 본다(서버가 원본 — 410)
struct MailSummaryCard: View {
  let turn: MailSummaryTurn
  var onPick: (Int) -> Void
  var onResearch: () -> Void
  var onSettings: () -> Void
  @State private var copied = false

  var body: some View {
    let now = Date()
    VStack(alignment: .leading, spacing: 8) {
      switch turn.phase {
      case .finding:
        HStack { ProgressView(); Text(MailSummaryText.finding).font(.subheadline) }
      case .choosing:
        // 시간 창은 만료 전 후보 카드만 1초마다 — 만료 순간 [다시 찾기](A3 리뷰). 만료된 카드는 다시 그리지 않는다
        if turn.candidatesLive(now: now) {
          TimelineView(.periodic(from: now, by: 1)) { ctx in
            VStack(alignment: .leading, spacing: 8) { candidates(now: ctx.date) }
          }
        } else {
          VStack(alignment: .leading, spacing: 8) { candidates(now: now) }
        }
      case .reading:
        if let i = turn.picked, let c = turn.candidates?.indices.contains(i) == true ? turn.candidates?[i] : nil {
          Text(verbatim: MailSummary.candidateLine(c, now: now)).font(.caption).lineLimit(1)
        }
        HStack { ProgressView(); Text(MailSummaryText.reading).font(.subheadline) }
      case .ended:
        if let r = turn.read { result(r, now: now) }
      }
      if let n = turn.note { Text(verbatim: n).font(.footnote).foregroundStyle(.secondary).accessibilityIdentifier("summary-note") }
      if turn.settings {
        Button(MailSummaryText.openSettings, action: onSettings).buttonStyle(.bordered).accessibilityIdentifier("summary-open-settings")
      }
    }
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("summary-card")
  }

  @ViewBuilder private func candidates(now: Date) -> some View {
    let complete = turn.complete ?? true
    Text(MailSummaryText.header(translate: turn.translate)).font(.headline)
    if let c = turn.conditions { Text(verbatim: MailSummary.conditionLine(c, now: now)).font(.footnote).accessibilityIdentifier("summary-conditions") }
    if turn.candidatesExpired(now: now) {
      Text(MailSummaryText.candidatesExpired).font(.footnote).accessibilityIdentifier("summary-expired")
      Button(MailSummaryText.research, action: onResearch).buttonStyle(.bordered).accessibilityIdentifier("summary-research")
    } else {
      ForEach(Array((turn.candidates ?? []).enumerated()), id: \.offset) { pair in
        Button { onPick(pair.offset) } label: {
          Text(verbatim: MailSummary.candidateLine(pair.element, now: now)).font(.caption).lineLimit(1).frame(maxWidth: .infinity, alignment: .leading)
        }
        .buttonStyle(.plain).accessibilityIdentifier("summary-candidate-\(pair.offset)")
      }
      Button(MailSummaryText.pickLatest(complete: complete)) { onPick(0) }.buttonStyle(.borderedProminent).accessibilityIdentifier("summary-latest")
    }
    if let more = MailSummaryText.moreLine(complete: complete, more: turn.more ?? false) {
      Text(more).font(.caption).foregroundStyle(.secondary).accessibilityIdentifier("summary-more")
    }
  }

  @ViewBuilder private func result(_ r: MailSummary.Read, now: Date) -> some View {
    Text(verbatim: MailSummary.header(r)).font(.headline)
    if let d = MailSummary.receivedLine(r.date, now: now) { Text(d).font(.caption).foregroundStyle(.secondary) }
    switch MailSummary.body(r, translate: turn.translate) {
    case let .summary(s, translation, translationNote):
      ForEach(Array(s.lines.enumerated()), id: \.offset) { Text(verbatim: "• " + $0.element).font(.subheadline) }
      section(MailSummaryText.datesTitle, s.dates)
      section(MailSummaryText.amountsTitle, s.amounts)
      section(MailSummaryText.todosTitle, s.todos)
      if let t = translation {
        Text(MailSummaryText.translationTitle).font(.subheadline.bold())
        Text(verbatim: t).font(.subheadline).accessibilityIdentifier("summary-translation")
      }
      if let n = translationNote { Text(n).font(.footnote).foregroundStyle(.secondary) }
    case let .ask(q):
      Text(verbatim: q).font(.subheadline).accessibilityIdentifier("summary-ask")
    case let .note(n):
      Text(n).font(.subheadline).accessibilityIdentifier("summary-status-note")
    }
    ForEach(MailSummary.footer(r), id: \.self) { Text($0).font(.caption2).foregroundStyle(.secondary) }
    Button(copied ? "복사됨" : MailSummaryText.copy) {
      UIPasteboard.general.string = MailSummary.copyText(r, translate: turn.translate)
      copied = true
      Task { try? await Task.sleep(for: .seconds(1.5)); copied = false }
    }
    .font(.caption).buttonStyle(.borderless).accessibilityIdentifier("summary-copy")
  }

  @ViewBuilder private func section(_ title: String, _ xs: [String]) -> some View {
    if !xs.isEmpty {
      Text(title).font(.caption.bold())
      ForEach(Array(xs.enumerated()), id: \.offset) { Text(verbatim: $0.element).font(.caption) }
    }
  }
}
