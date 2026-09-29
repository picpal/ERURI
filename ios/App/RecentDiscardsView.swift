import SwiftUI
import EruriCore

/// "최근 폐기"(스펙 §7): 서버 분류 게이트가 7일 격리 중인 항목의 메타(본문 없음). "복구"는 게이트를 무시하고 추출로 보낸다
struct RecentDiscardsView: View {
  @State private var rows: [RecentDiscards.Row] = []
  @State private var message = ""
  @State private var restoring: String?

  var body: some View {
    List {
      if !message.isEmpty { Text(message).font(.caption).foregroundStyle(.secondary) }
      ForEach(rows) { r in
        VStack(alignment: .leading, spacing: 4) {
          Text(r.titleLine)
          Text(r.originLine).font(.caption).foregroundStyle(.secondary)
          Text(r.gateLine).font(.caption2).foregroundStyle(.secondary)
          Button("복구") { restore(r.id) }.buttonStyle(.bordered).disabled(restoring != nil)
        }
      }
    }
    .navigationTitle("최근 폐기")
    .task { await load() }
    .refreshable { await load() }
  }

  private func load() async {
    guard let r = await API.send(RecentDiscards.query), r.status == 200, let v = RecentDiscards.decode(r.data) else {
      message = "불러오지 못했습니다"; return
    }
    rows = v
    message = RecentDiscards.summary(count: v.count)
  }
  private func restore(_ id: String) {
    restoring = id
    Task {
      let r = await API.send("rest/v1/rpc/restore_discarded", method: "POST", json: ["p_item": id])
      let text = RecentDiscards.restoreMessage(RecentDiscards.restoreResult(status: r?.status, data: r?.data))
      await load()
      message = text                                          // 목록 요약보다 복구 결과를 보인다
      restoring = nil
    }
  }
}
