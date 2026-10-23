import SwiftUI
import EruriCore

/// 메일 목록 요약 카드(스펙 §9 "목록 카드", 0.19.0): 머리·조건 줄 → 줄마다 `발신자 · 날짜`·제목·요약 1~2줄(ok 줄을 누르면 상세 턴) → 미완결 안내 → 꼬리([다음 N통]·[다시 찾기]) → 문구.
/// 요약 줄·제목·발신자는 Text(verbatim:) — 마크다운·링크 해석 없이(메일이 심은 주소가 눌리지 않게). loading(검색·digest 진행 — 잠금)이면 버튼을 막는다
struct MailDigestCard: View {
  let turn: MailDigestTurn
  let now: Date
  var onOpen: (Int) -> Void
  var onRetry: (Int) -> Void
  var onMore: () -> Void
  var onResearch: () -> Void
  var onSettings: () -> Void

  var body: some View {
    let loading = turn.phase == .loading
    VStack(alignment: .leading, spacing: 8) {
      if let c = turn.conditions {
        Text(verbatim: MailDigest.header(c, rows: turn.rows.count, now: now)).font(.headline).accessibilityIdentifier("digest-header")
        Text(verbatim: MailSummary.conditionLine(c, now: now)).font(.footnote).accessibilityIdentifier("digest-conditions")
      }
      if turn.countCapped { Text(MailDigestText.capped).font(.caption).foregroundStyle(.secondary).accessibilityIdentifier("digest-capped") }
      ForEach(Array(turn.rows.enumerated()), id: \.offset) { pair in
        row(pair.offset, pair.element, loading: loading)
      }
      if !turn.complete, case .more = turn.tail {
        Text(MailDigestText.partial).font(.caption).foregroundStyle(.secondary).accessibilityIdentifier("digest-partial")
      }
      switch turn.tail {
      case .more(let n):
        HStack {
          Text(MailDigestText.more).font(.footnote)
          Button(MailDigestText.moreButton(n), action: onMore).buttonStyle(.bordered).disabled(loading).accessibilityIdentifier("digest-more")
        }
      case .expired:
        HStack {
          Text(MailDigestText.expiredTail).font(.footnote).accessibilityIdentifier("digest-expired")
          Button(MailDigestText.research, action: onResearch).buttonStyle(.bordered).disabled(loading).accessibilityIdentifier("digest-research")
        }
      case .none:
        EmptyView()
      }
      if let n = turn.note { Text(verbatim: n).font(.footnote).foregroundStyle(.secondary).accessibilityIdentifier("digest-note") }
      if turn.settings {
        Button(MailSummaryText.openSettings, action: onSettings).buttonStyle(.bordered).accessibilityIdentifier("digest-open-settings")
      }
      Text(MailSummaryText.notStored).font(.caption2).foregroundStyle(.secondary).accessibilityIdentifier("digest-not-stored")
    }
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("digest-card")
  }

  /// 줄 전체가 버튼(ok·note 없음일 때만 상세). [다시]는 줄 버튼 밖에 둔다 — 버튼 안 버튼은 목록 셀에서 탭이 바깥으로 간다
  @ViewBuilder private func row(_ i: Int, _ r: MailDigestTurn.Row, loading: Bool) -> some View {
    let msg = MailDigest.rowBody(r)
    VStack(alignment: .leading, spacing: 2) {
      Button { if r.state == .ok && r.note == nil { onOpen(i) } } label: {
        VStack(alignment: .leading, spacing: 2) {
          Text(verbatim: MailDigest.rowHead(r.candidate, now: now)).font(.caption).foregroundStyle(.secondary)
          Text(verbatim: MailDigest.rowTitle(r.candidate)).font(.subheadline.bold()).lineLimit(1)
          if let b = msg {
            Text(verbatim: b).font(.caption).foregroundStyle(.secondary)
          } else {
            ForEach(Array(r.lines.enumerated()), id: \.offset) { Text(verbatim: $0.element).font(.subheadline) }
          }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
      }
      .buttonStyle(.plain).disabled(loading).accessibilityIdentifier("digest-row-\(i)")
      if msg != nil, turn.canRetry(r) {
        Button(MailDigestText.retry) { onRetry(i) }.font(.caption).buttonStyle(.bordered).disabled(loading).accessibilityIdentifier("digest-retry-\(i)")
      }
    }
  }
}
