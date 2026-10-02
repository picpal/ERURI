import SwiftUI
import EruriCore

/// 채팅 "보관함에서 보기" → 보관함 탭 범위 모드(스펙 §9, 0.7.0). 루트가 openCount 로 탭을 옮기고 보관함이 처음부터 다시 읽는다
@MainActor @Observable final class ArchiveRouter {
  static let shared = ArchiveRouter()
  var scope: Archive.Scope?
  var openCount = 0
  func open(_ s: Archive.Scope) { scope = s; openCount += 1 }
  func clear() { scope = nil; openCount += 1 }
}

/// 보관함(스펙 §11): 본인 항목의 메타 목록 → 상세(원문·추출). 채팅에서 넘어오면 그 질문의 검색 후보만 순위순(§9). 게이트를 통과한 항목에 "잘못 통과" 표시(Jev 정확도 정답, §16)
struct ArchiveView: View {
  @State private var rows: [Archive.Row] = []
  @State private var filter = Archive.Filter.all
  @State private var more = false
  @State private var loading = false
  @State private var failed = false                 // 실패하면 자동 불러오기를 멈추고 하단 "다시 시도"
  @State private var retryReset = false             // 실패한 요청이 처음부터(필터 변경·새로고침)였는지 — "다시 시도"가 같은 종류로 보낸다
  @State private var generation = 0                 // 처음부터 불러올 때마다 올린다. 앞 세대의 늦은 응답은 버린다
  @State private var message = ""
  @State private var page = 0                       // 범위 모드: 마지막으로 불러온 id 조각
  @State private var detailShown = false            // 목록 위에 상세(또는 최근 폐기)가 열려 있는지 — 탭 재진입 새로고침은 목록 루트일 때만
  private var router: ArchiveRouter { ArchiveRouter.shared }

  var body: some View {
    let scope = router.scope
    NavigationStack {
      List {
        if let scope {
          Section {
            Text(scope.label).font(.caption)
            Button("전체 보기") { router.clear() }
          }
        }
        Picker("출처", selection: $filter) {
          ForEach(Archive.Filter.allCases, id: \.self) { Text($0.label).tag($0) }
        }.pickerStyle(.segmented)
        if scope == nil { NavigationLink("최근 폐기 (7일)") { RecentDiscardsView(filter: filter).onAppear { detailShown = true } } }   // 고른 출처 탭의 폐기만. 격리 항목은 후보가 아니다
        if !message.isEmpty { Text(message).font(.caption).foregroundStyle(.secondary) }
        ForEach(rows) { r in
          NavigationLink {
            ItemDetailView(itemID: r.id, footer: r.gatePassed ? AnyView(WrongPassSection(itemID: r.id)) : nil)
              .onAppear { detailShown = true }
          } label: {
            VStack(alignment: .leading, spacing: 2) {
              Text(r.titleLine).lineLimit(1)
              Text(r.metaLine).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
            }
          }
          .onAppear { if more, !failed, !loading, rows.suffix(5).contains(where: { $0.id == r.id }) { Task { await load(reset: false) } } }   // 끝에서 5행 안에 닿으면 다음 50건
        }
        if loading && !rows.isEmpty { ProgressView().frame(maxWidth: .infinity) }
        else if failed { Button("다시 시도") { Task { await load(reset: retryReset) } }.frame(maxWidth: .infinity) }
      }
      .onAppear { detailShown = false }                                   // 상세에서 목록으로 돌아왔다
      .navigationTitle(scope == nil ? "보관함" : "검색 결과")
    }
    // 상세가 열린 채 채팅에서 새 범위를 열면 목록으로 돌아온다. 아래 수식어는 .id 바깥에 둬야 새 정체성에서도 onChange 가 첫 변화를 보고 .task 가 다시 돌지 않는다
    .id(router.openCount)
    // 탭을 다시 고를 때마다 돈다(TabView 가 뷰를 살려 둬도) — 목록 루트면 처음부터 다시 불러와 그 사이 들어온 항목(공유·링크 결과)을 보인다.
    // 상세가 열린 채 돌아오면 목록·스크롤을 유지한다. 상세에서 목록으로 돌아오는 것은 스택 안 이동이라 여기를 타지 않는다
    .task { if rows.isEmpty || !detailShown { await load(reset: true) } }
    .onChange(of: filter) { _, _ in Task { await load(reset: true) } }
    .onChange(of: router.openCount) { _, _ in Task { await load(reset: true, rescope: true) } }   // 새 범위·"전체 보기" → 앞 범위 행을 지우고 처음부터
    .refreshable { await load(reset: true) }
  }

  private func load(reset: Bool, rescope: Bool = false) async {
    if loading && !reset { return }
    if reset { generation += 1 }
    if rescope { rows = []; page = 0; more = false; failed = false; message = "" }   // 범위가 바뀌면 앞 범위의 행을 남기지 않는다
    let gen = generation, requested = filter, scope = router.scope, opened = router.openCount
    loading = true; defer { if gen == generation { loading = false } }  // 버린 응답이 새 요청의 loading 을 일찍 풀지 않게
    // 필터·범위를 바꿨거나 그 뒤 처음부터 다시 불러온 경우, 늦게 온 응답은 버린다(옛 목록 뒤에 붙거나 행이 겹치지 않게)
    func current() -> Bool { gen == generation && requested == filter && opened == router.openCount }
    if let scope {
      let r = await scope.load(from: reset ? 0 : page + 1) { ids in
        guard let r = await API.send(Archive.scopedQuery(ids: ids, filter: requested)), r.status == 200 else { return nil }
        return Archive.decode(r.data)
      }
      guard current() else { return }
      guard let r else { message = "불러오지 못했습니다"; failed = true; retryReset = reset || rows.isEmpty; return }
      failed = false
      rows = reset ? r.rows : rows + r.rows
      page = r.lastPage
      more = scope.hasMore(afterPage: r.lastPage)
      message = rows.isEmpty ? "이 출처에는 검색 후보가 없습니다" : ""
      return
    }
    let r = await API.send(Archive.query(filter: requested, offset: reset ? 0 : rows.count))
    guard current() else { return }
    guard let r, r.status == 200, let v = Archive.decode(r.data) else {
      message = "불러오지 못했습니다"; failed = true; retryReset = reset || rows.isEmpty; return
    }
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
