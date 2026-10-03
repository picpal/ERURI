import SwiftUI
import EruriCore

/// "최근 폐기"(스펙 §7): 서버 분류 게이트가 7일 격리 중인 항목의 메타(본문 없음). "복구"는 게이트를 무시하고 추출로 보낸다.
/// 복구한 행은 목록에서 지우지 않고 "복구한 항목"에 남겨 처리 결과(일정 제안 N건·일정 없음·실패)로 바꾼다(진단 10-03 — 사라지면 "반응 없음"으로 보였다)
struct RecentDiscardsView: View {
  let filter: Archive.Filter                              // 보관함에서 고른 출처 탭
  @State private var rows: [RecentDiscards.Row] = []
  @State private var restored: [Restored] = []             // 이 화면에서 복구한 행(서버 목록에서는 빠진다)
  @State private var message = ""
  @State private var restoring: String?

  struct Restored: Identifiable { let row: RecentDiscards.Row; var state: RecentDiscards.RestoreState; var id: String { row.id } }

  var body: some View {
    List {
      if !message.isEmpty { Text(message).font(.caption).foregroundStyle(.secondary) }
      // 오통과 표시(보관함)와 같은 톤: 복구는 실제로 다시 처리하고, 잘못 폐기 기록은 정확도 평가용으로만 남는다
      Text("복구하면 이 항목을 다시 처리합니다. 잘못 폐기 기록도 정확도 평가용으로 남지만 이후 분류에는 반영되지 않습니다.")
        .font(.caption).foregroundStyle(.secondary)
      if !restored.isEmpty {
        Section("복구한 항목") {
          ForEach($restored) { $r in RestoredRow(item: $r) }
        }
      }
      Section {
        ForEach(rows) { r in
          VStack(alignment: .leading, spacing: 4) {
            Text(r.titleLine)
            Text(r.originLine).font(.caption).foregroundStyle(.secondary)
            Text(r.gateLine).font(.caption2).foregroundStyle(.secondary)
            Button("복구") { restore(r) }.buttonStyle(.bordered).disabled(restoring != nil)
          }
        }
      }
    }
    .navigationTitle(RecentDiscards.title(filter: filter))
    .task { await load() }
    .refreshable { await load() }
  }

  private func load() async {
    guard let r = await API.send(RecentDiscards.query(filter: filter)), r.status == 200, let v = RecentDiscards.decode(r.data) else {
      message = "불러오지 못했습니다"; return
    }
    let done = Set(restored.map(\.id))
    rows = v.filter { !done.contains($0.id) }
    message = RecentDiscards.summary(count: rows.count)
  }
  private func restore(_ row: RecentDiscards.Row) {
    restoring = row.id
    Task {
      let r = await API.send("rest/v1/rpc/restore_discarded", method: "POST", json: ["p_item": row.id])
      let result = RecentDiscards.restoreResult(status: r?.status, data: r?.data)
      if result == "queued" {
        // 행을 "복구한 항목"으로 옮겨 처리 결과를 기다린다(RestoredRow 가 확인)
        rows.removeAll { $0.id == row.id }
        restored.insert(Restored(row: row, state: .processing), at: 0)
      } else {
        await load()
      }
      message = RecentDiscards.restoreMessage(result)         // 목록 요약보다 복구 결과를 보인다
      restoring = nil
    }
  }
}

/// 복구한 행: 처리 중이면 3초마다 최대 90초 본인 items.status·process 잡·facts 종류를 확인(RecentDiscards.pollRestore).
/// 화면을 떠나면 .task 가 취소되고, 돌아오면 아직 처리 중인 행만 다시 확인한다
private struct RestoredRow: View {
  @Binding var item: RecentDiscardsView.Restored

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      Text(item.row.titleLine)
      Text(item.row.originLine).font(.caption).foregroundStyle(.secondary)
      HStack(spacing: 6) {
        if item.state == .processing { ProgressView().controlSize(.small) }
        Text(RecentDiscards.restoreLine(item.state)).font(.callout)
          .foregroundStyle(item.state == .failed ? Color.red : item.state == .processing ? Color.secondary : Color.primary)
      }
    }
    .task(id: item.state == .processing) {
      guard item.state == .processing else { return }
      let s = await RecentDiscards.pollRestore(itemID: item.row.id, wait: { try? await Task.sleep(for: RecentDiscards.pollEvery) }) { path in
        guard let r = await API.send(path), r.status == 200 else { return nil }
        return r.data
      }
      if !Task.isCancelled { item.state = s }
    }
  }
}
