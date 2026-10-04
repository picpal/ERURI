import SwiftUI
import EruriCore

/// 항목 상세(본인 데이터): 메타·일정(제안 상태·다시 추가)·원문(chat/item, 원문 만료면 표시)·추출 사실. 원문 복호화는 서버 chat 함수만 한다(§12 통제 1).
/// 채팅 출처·보관함(M2-⑨b)·채팅 "일정 보기"(이미 읽은 링크, 0.11.4) 공용
struct ItemDetailView: View {
  let itemID: String
  let footer: AnyView?
  @Environment(\.scenePhase) private var scenePhase
  @State private var meta: [String: Any] = [:]
  @State private var facts: [[String: Any]] = []
  @State private var loadError: String?
  @State private var events: [ItemEvents.Row] = []                      // 일정 절(§10 "일정 다시 추가"): 순번 순 제안
  @State private var eventStates: [String: ItemEvents.State] = [:]
  @State private var actions: [String: ProposalReview.ActionState] = [:]
  @State private var calendarOK = CalendarLookup.fullAccess
  // private 저장 프로퍼티가 있으면 memberwise init 이 private 이 되므로 명시한다
  init(itemID: String, footer: AnyView? = nil) { self.itemID = itemID; self.footer = footer }

  var body: some View {
    List {
      Section {
        Text(meta["title"] as? String ?? "(제목 없음)").font(.headline)
        Text([SourceLabel.label(source: meta["source"] as? String ?? "", appName: meta["app_name"] as? String),
              meta["sender"] as? String ?? "", (meta["occurred_at"] as? String).map(ChatReply.seoulLabel) ?? ""]
          .filter { !$0.isEmpty }.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary)
      }
      if !events.isEmpty {
        Section("일정") {
          if !calendarOK { CalendarAccessPrompt(message: "캘린더 전체 접근을 허용해야 캘린더에 있는지 확인하고 추가할 수 있습니다") { judge() } }
          ForEach(events) { r in eventRow(r) }
        }
      }
      Section("원문") {
        if let loadError { Text(loadError).foregroundStyle(.secondary) }
        else if meta["expired"] as? Bool == true { Text("원문 만료됨").foregroundStyle(.secondary) }
        else { Text(meta["text"] as? String ?? "불러오는 중…").textSelection(.enabled) }
      }
      if !facts.isEmpty {
        Section("추출") {
          ForEach(facts.indices, id: \.self) { i in
            let f = facts[i], p = f["payload"] as? [String: Any] ?? [:]
            Text("\(f["kind"] as? String ?? "") · \(p["title"] as? String ?? p["merchant"] as? String ?? "") \(p["start"] as? String ?? p["due"] as? String ?? "")")
              .font(.caption)
          }
        }
      }
      if let footer { footer }
    }
    .navigationTitle("항목")
    .task { await load() }
    .task { await loadEvents() }                                         // 다시 보일 때마다 — 캘린더 앱에서 지우거나 넣고 돌아온 경우
    .onChange(of: scenePhase) { _, p in if p == .active { judge() } }
  }

  /// 일정 한 건: 대기·다시 추가·무시함은 제안 탭 행(미리 판정·확인창 그대로), 나머지는 상태 줄만
  @ViewBuilder private func eventRow(_ r: ItemEvents.Row) -> some View {
    let st = eventStates[r.pid] ?? .noAccess(added: false)
    switch st {
    case .pending, .readd, .dismissed, .noAccess(added: false):
      ProposalActionsView(title: r.title, when: r.whenLabel, location: ProposalReview.place(r.location), addFields: calendarOK ? r.addFields : nil,
                          proposalId: r.pid, state: binding(r.pid),
                          mode: st == .readd ? .readd : st == .dismissed ? .addOnly : .pending, note: ItemEvents.statusText(st))
    default:
      VStack(alignment: .leading, spacing: 6) {
        Text(r.title).font(.headline)
        Text(r.whenLabel).font(.subheadline).foregroundStyle(.secondary)
        if let l = ProposalReview.place(r.location) { Label(l, systemImage: "mappin.and.ellipse").font(.caption).foregroundStyle(.secondary) }
        if let t = ItemEvents.statusText(st) { Text(t).font(.caption).foregroundStyle(.secondary) }
        if case .finished(let t)? = actions[r.pid] { Text(t).font(.caption).foregroundStyle(.secondary) }   // 방금 추가한 결과
      }
      .padding(.vertical, 4)
    }
  }

  private func binding(_ id: String) -> Binding<ProposalReview.ActionState> {
    // 추가·무시가 끝나면 절을 다시 읽어 상태를 바꾸고 제안 탭도 새로 고친다. 다시 버튼이 있는 상태(무시 → 추가만 등)면 결과 문구를 지워 버튼을 켠다
    Binding(get: { actions[id] ?? .idle }, set: { s in
      actions[id] = s
      guard case .finished = s else { return }
      ProposalRouter.shared.revision += 1
      Task {
        await loadEvents()
        if let st = eventStates[id], [.pending, .readd, .dismissed].contains(st) { actions[id] = nil }
      }
    })
  }

  private func load() async {
    // .task 는 화면이 다시 보일 때마다 불린다. 이미 받았으면 다시 복호화·audit_read 를 만들지 않는다
    guard meta.isEmpty else { return }
    loadError = nil
    let r = await API.send("functions/v1/chat/item", method: "POST", json: ["item_id": itemID], timeout: 20)
    if let r, r.status == 200, let o = try? JSONSerialization.jsonObject(with: r.data) as? [String: Any] { meta = o }
    else { loadError = r?.status == 404 ? "항목을 찾을 수 없습니다" : "원문을 불러오지 못했습니다" }
    if let r = await API.send("rest/v1/facts?item_id=eq.\(itemID)&select=kind,payload,status"), r.status == 200,
       let rows = try? JSONSerialization.jsonObject(with: r.data) as? [[String: Any]] { facts = rows }
  }

  /// 일정 절: 제안 목록(본인 facts ⨝ proposals) → 캘린더 대조. 못 읽으면 앞 목록을 둔다
  private func loadEvents() async {
    if let r = await API.send(ItemEvents.query(itemID: itemID)), r.status == 200, let v = ItemEvents.decode(r.data) { events = v }
    judge()
  }

  /// 캘린더 대조(채팅 카드 등록 판정): 제안마다 AddEventGate 와 같은 조회 창, 이 기기 실행 기록. 읽은 일정은 화면에만(§12 통제 2)
  private func judge() {
    calendarOK = CalendarLookup.fullAccess
    let ex = try? Executions.shared()
    eventStates = events.reduce(into: [:]) { out, r in
      let evs: [ProposalFlow.CalendarEvent]? = calendarOK
        ? r.timing.map { let (a, b) = $0.searchWindow; return CalendarLookup.events(CalendarLookup.store, from: a, to: b) } ?? []
        : nil
      out[r.pid] = ItemEvents.state(r, executed: (try? ex?.existing(proposalId: r.pid)) != nil, events: evs)
    }
  }
}
