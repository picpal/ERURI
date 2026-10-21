import SwiftUI
import UIKit
import EruriCore

/// 채팅 집계 카드(스펙 §9 "채팅 저장 규칙·집계 질문" 집계 카드, 0.17.0): 서버 문장 한 줄 → 막대(0건 칸까지, 1위 진하게, day 31칸 넘으면 가로 스크롤) → 꼬리 줄 → [복사].
/// 막대 탭 → 카드 아래 그 칸 목록(/chat/aggregate — 0건 칸은 부르지 않는다, K22). 줄 탭 → 항목 상세. 숫자·칸·라벨·문장은 서버가 만든다 — 여기서는 그리기만.
/// 서버 글(문장·제목·발신자)은 Text(verbatim:) — 마크다운 해석 없이. status ≠ ok 면 문장(오류 문구)만
struct AggregateCard: View {
  let response: ChatAggregate.Response
  let onOpenItem: (String) -> Void
  @State private var selected: String?            // 목록을 펼친 칸 키 — 다른 막대를 누르면 바뀐다
  @State private var list: ListState?
  @State private var copied = false

  enum ListState { case loading, loaded(ChatAggregate.ListResponse), empty, failed }

  private static let barHeight: CGFloat = 72
  private static let scrollBarWidth: CGFloat = 8   // day 31칸 초과(최대 90칸)만 고정 폭 + 가로 스크롤
  private static let spacing: CGFloat = 2

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      Text(verbatim: sentence).font(.body).accessibilityIdentifier("agg-sentence")
      if response.status == "ok" {
        let bars = ChatAggregate.bars(response)
        if !bars.bars.isEmpty {
          if bars.scrolls { ScrollView(.horizontal) { barRow(bars, fixed: true).padding(.bottom, 4) } }
          else { barRow(bars, fixed: false) }
        }
        ForEach(response.notes, id: \.self) { Text(verbatim: $0).font(.footnote).foregroundStyle(.secondary) }
        copyButton
        if selected != nil { listSection }
      }
    }
    .padding(.vertical, 4)
  }

  private var sentence: String {
    if !response.sentence.isEmpty { return response.sentence }
    return response.status == "bad_condition" ? ChatAggregate.Text.badCondition : ChatAggregate.Text.failed
  }

  // MARK: 막대

  /// 막대 한 줄 + 눈금 줄. 눈금 글은 칸 폭을 넘어도 겹쳐 그린다(overlay·fixedSize — 칸 폭을 늘리지 않게)
  private func barRow(_ b: ChatAggregate.Bars, fixed: Bool) -> some View {
    let ticks = Dictionary(zip(b.tickIndices, b.tickLabels), uniquingKeysWith: { a, _ in a })
    return HStack(alignment: .bottom, spacing: Self.spacing) {
      ForEach(Array(b.bars.enumerated()), id: \.element.key) { pair in
        let i = pair.offset, bucket = pair.element
        VStack(spacing: 3) {
          barButton(bucket, max: b.max, leader: b.leaderKeys.contains(bucket.key))
          Color.clear.frame(height: 14).overlay(alignment: i == 0 ? .topLeading : i == b.bars.count - 1 ? .topTrailing : .top) {
            if let t = ticks[i] { Text(verbatim: t).font(.caption2).foregroundStyle(.secondary).fixedSize() }
          }
        }
        .frame(width: fixed ? Self.scrollBarWidth : nil)
        .frame(maxWidth: fixed ? nil : .infinity)
      }
    }
  }

  private func barButton(_ bucket: ChatAggregate.Bucket, max: Int, leader: Bool) -> some View {
    let h = max > 0 && bucket.count > 0 ? Swift.max(2, Self.barHeight * CGFloat(bucket.count) / CGFloat(max)) : 0
    let on = selected == bucket.key
    return Button { tap(bucket) } label: {
      VStack(spacing: 0) {
        Spacer(minLength: 0)
        if h > 0 {
          RoundedRectangle(cornerRadius: 2).fill(Color.accentColor.opacity(leader ? 1 : 0.4)).frame(height: h)
        }
        Rectangle().fill(Color.secondary.opacity(0.5)).frame(height: 1)     // 바닥선 — 0건 칸은 이것만
      }
      .frame(height: Self.barHeight + 1)
      .frame(maxWidth: .infinity)
      .background(on ? Color.accentColor.opacity(0.12) : Color.clear)
      .contentShape(Rectangle())
    }
    .buttonStyle(.borderless)
    .disabled(response.conditions == nil)
    .accessibilityIdentifier("agg-bar-\(bucket.key)")
    .accessibilityLabel("\(bucket.label) \(bucket.count)건")
  }

  /// 같은 칸을 다시 누르면 실패했을 때만 다시 부른다. 0건 칸은 부르지 않는다(K22). 늦게 온 앞 칸의 결과는 버린다
  private func tap(_ bucket: ChatAggregate.Bucket) {
    guard let c = response.conditions else { return }
    if selected == bucket.key, !failed { return }
    selected = bucket.key
    guard bucket.count > 0 else { list = .empty; return }
    list = .loading
    Task { @MainActor in
      let r = await ChatRuleAPI.list(c, bucketKey: bucket.key)
      guard selected == bucket.key else { return }
      if let r, r.status == "ok" { list = .loaded(r) } else { list = .failed }
      DiagLog.append("CHAT agg list status=\(r?.status ?? "none") n=\(r?.items.count ?? 0)")
    }
  }

  private var failed: Bool { if case .failed? = list { true } else { false } }

  // MARK: 목록

  @ViewBuilder private var listSection: some View {
    Divider()
    switch list {
    case .loading?: ProgressView()
    case .empty?: Text(ChatAggregate.Text.emptyBucket).font(.subheadline).foregroundStyle(.secondary)
    case .failed?, nil: Text(ChatAggregate.Text.failed).font(.subheadline).foregroundStyle(.secondary)
    case .loaded(let r)?:
      Text(ChatAggregate.listHeader(bucket: response.conditions?.bucket ?? "", label: r.label, total: r.total)).font(.subheadline.weight(.semibold))
      ForEach(r.items) { item in
        let l = ChatAggregate.line(item)
        Button { onOpenItem(item.item_id) } label: {
          VStack(alignment: .leading, spacing: 2) {
            Text(verbatim: l.title).font(.subheadline).lineLimit(1)
            Text(verbatim: l.meta).font(.caption).foregroundStyle(.secondary)
          }
          .frame(maxWidth: .infinity, alignment: .leading)
          .contentShape(Rectangle())
        }
        .buttonStyle(.borderless)
        .foregroundStyle(.primary)
        .accessibilityIdentifier("agg-list-row")
      }
      if let f = ChatAggregate.listFooter(r) { Text(f).font(.footnote).foregroundStyle(.secondary) }
    }
  }

  // MARK: 복사

  private var copyButton: some View {
    Button {
      UIPasteboard.general.string = ChatAggregate.copyText(response)
      copied = true
      Task { try? await Task.sleep(for: .seconds(1.5)); copied = false }
    } label: {
      Text(copied ? "복사됨" : "복사").font(.caption)
        .foregroundStyle(Color.secondary)
        .padding(.horizontal, 10).padding(.vertical, 4)
        .overlay(Capsule().strokeBorder(Color.secondary.opacity(0.5), lineWidth: 1))
        .contentShape(Capsule())
    }
    .buttonStyle(.borderless)
    .accessibilityLabel("집계 복사")
    .accessibilityIdentifier("agg-copy")
  }
}
