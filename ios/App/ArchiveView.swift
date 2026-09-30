import SwiftUI
import EruriCore

/// 보관함(스펙 §11): 본인 항목의 메타 목록 → 상세(원문·추출). 게이트를 통과한 항목에 "잘못 통과" 표시(Jev 정확도 정답, §16)
struct ArchiveView: View {
  @State private var rows: [Archive.Row] = []
  @State private var filter = Archive.Filter.all
  @State private var more = false
  @State private var loading = false
  @State private var failed = false                 // 실패하면 자동 불러오기를 멈추고 하단 "다시 시도"
  @State private var message = ""

  var body: some View {
    NavigationStack {
      List {
        Picker("출처", selection: $filter) {
          ForEach(Archive.Filter.allCases, id: \.self) { Text($0.label).tag($0) }
        }.pickerStyle(.segmented)
        NavigationLink("최근 폐기 (7일)") { RecentDiscardsView(filter: filter) }         // 고른 출처 탭의 폐기만
        if !message.isEmpty { Text(message).font(.caption).foregroundStyle(.secondary) }
        ForEach(rows) { r in
          NavigationLink {
            ItemDetailView(itemID: r.id, footer: r.gatePassed ? AnyView(WrongPassSection(itemID: r.id)) : nil)
          } label: {
            VStack(alignment: .leading, spacing: 2) {
              Text(r.titleLine).lineLimit(1)
              Text(r.metaLine).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
            }
          }
          .onAppear { if more, !failed, !loading, rows.suffix(5).contains(where: { $0.id == r.id }) { Task { await load(reset: false) } } }   // 끝에서 5행 안에 닿으면 다음 50건
        }
        if loading && !rows.isEmpty { ProgressView().frame(maxWidth: .infinity) }
        else if failed { Button("다시 시도") { Task { await load(reset: rows.isEmpty) } }.frame(maxWidth: .infinity) }
      }
      .navigationTitle("보관함")
      .task { if rows.isEmpty { await load(reset: true) } }                // 상세에서 돌아올 때 목록·스크롤을 유지
      .onChange(of: filter) { _, _ in Task { await load(reset: true) } }
      .refreshable { await load(reset: true) }
    }
  }

  private func load(reset: Bool) async {
    if loading && !reset { return }
    let requested = filter
    loading = true; defer { loading = false }
    let r = await API.send(Archive.query(filter: requested, offset: reset ? 0 : rows.count))
    guard requested == filter else { return }                              // 필터를 바꾼 뒤 늦게 온 응답은 버린다
    guard let r, r.status == 200, let v = Archive.decode(r.data) else { message = "불러오지 못했습니다"; failed = true; return }
    failed = false
    rows = reset ? v : rows + v
    more = Archive.hasMore(pageCount: v.count)
    message = rows.isEmpty ? "항목이 없습니다" : ""
  }
}

/// "잘못 통과로 표시 (정확도 평가용)" → gate_feedback wrong_pass(본인 항목만, RLS). 다시 누르면 취소. 복구한 항목에는 보이지 않는다.
/// 교정 기능이 아니다: 항목을 지우거나 이후 분류·검색을 바꾸지 않고 Jev 정확도 채점 기록만 남긴다(스펙 §8 gate_feedback, 2026-09-30)
struct WrongPassSection: View {
  let itemID: String
  @State private var state = Archive.Feedback.unknown
  @State private var busy = false
  @State private var failed = false
  init(itemID: String) { self.itemID = itemID }

  var body: some View {
    if state != .restored {
      Section {
        Button(state == .wrongPass ? "표시 취소" : "잘못 통과로 표시 (정확도 평가용)") { toggle() }
          .disabled(busy || state == .unknown)
      } header: { Text("분류") } footer: {
        VStack(alignment: .leading, spacing: 4) {
          Text(failed ? "저장하지 못했습니다. 다시 눌러 주세요"
               : state == .wrongPass ? "잘못 통과한 항목으로 표시했습니다" : "개인 대화·광고처럼 저장할 필요가 없던 항목이면 눌러 주세요")
          Text("평가 기록만 남깁니다. 항목은 지워지지 않고 이후 분류에도 반영되지 않습니다.")
        }
      }
      .task { await refresh() }
    }
  }

  private func refresh() async {
    let r = await API.send(Archive.feedbackQuery(itemID: itemID))
    state = Archive.feedback(status: r?.status, data: r?.data)
  }
  private func toggle() {
    busy = true
    Task {
      let r = state == .wrongPass
        ? await API.send(Archive.unmarkPath(itemID: itemID), method: "DELETE")
        : await API.send("rest/v1/gate_feedback", method: "POST", json: ["item_id": itemID, "verdict": "wrong_pass"])
      failed = !Archive.succeeded(r?.status)
      await refresh()                                                      // 성공 여부와 상관없이 서버 상태를 다시 읽어 표시
      busy = false
    }
  }
}
