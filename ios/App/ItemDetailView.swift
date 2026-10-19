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
  @State private var factVersions: [FactVersions] = []                    // 0.16.0: fact 별 버전(계보·update_event 상태)
  @State private var editStates: [String: EditFlow.CardState] = [:]        // add 가 아닌 상태 — 키 = 최고 버전 id
  @State private var editing: [String: ChatView.EditState] = [:]
  @State private var retryButton = false                                    // 처리 실패·멈춘 항목 [다시 처리](§10, 0.16.1 추가 1)
  @State private var retryNote: String?
  @State private var retrying = false
  @State private var editConfirm: EditConfirm?                              // 고친 일정 [캘린더에 추가]의 겹침·비슷한 일정 확인창(K34 — 채팅 runAdd 와 같은 문구)
  struct EditConfirm: Identifiable { let top: ProposalVersion; let state: EditFlow.CardState; let prompt: String; var id: String { top.id } }
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
      if retryButton || retryNote != nil {
        Section {
          HStack(spacing: 8) {
            if retrying { ProgressView() }
            Text(retryNote ?? ItemRetry.failedLine).accessibilityIdentifier("item-retry-status")
          }
          if retryButton { Button(ItemRetry.buttonTitle) { retry() }.disabled(retrying).accessibilityIdentifier("item-retry") }
        }
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
    .confirmationDialog(editConfirm?.prompt ?? "", isPresented: Binding(get: { editConfirm != nil }, set: { if !$0 { editConfirm = nil } }),
                        titleVisibility: .visible, presenting: editConfirm) { c in
      Button("추가") { press(c.top, c.state, .add, confirmed: true) }
      Button("취소", role: .cancel) {}
    }
    .navigationTitle("항목")
    .task { await load() }
    .task { await loadRetry() }
    .task { await loadEvents() }                                         // 다시 보일 때마다 — 캘린더 앱에서 지우거나 넣고 돌아온 경우
    .onChange(of: scenePhase) { _, p in if p == .active { judge() } }
  }

  /// 일정 한 건: 고친 일정(update_event·계보)은 고치기 카드와 같은 상태·버튼, 대기·다시 추가·무시함은 제안 탭 행(미리 판정·확인창 그대로), 나머지는 상태 줄만
  @ViewBuilder private func eventRow(_ r: ItemEvents.Row) -> some View {
    if let st = editStates[r.pid], let top = factVersions.compactMap(\.top).first(where: { $0.id == r.pid }) {
      VStack(alignment: .leading, spacing: 6) {
        Text(top.displayTitle).font(.headline)
        Text(ChatEdit.whenText(start: top.start, end: top.end)).font(.subheadline).foregroundStyle(.secondary)
      }
      .accessibilityIdentifier("item-edit-row")
      EditCardView(status: EditFlow.status(st), dayHeader: nil, dayLines: [], access: calendarOK, running: editing[top.id].isRunning,
                   failure: editing[top.id].failure, onButton: { b in press(top, st, b) }, onAllow: { judge() })
    } else {
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

  /// [다시 처리] 표시(§10): 본인 items.status 와 가장 최근 process 잡(복구 행과 같은 조회, RLS) — failed, 또는 queued 인데 잡이 dead. 처리 중이면 건드리지 않는다
  private func loadRetry() async {
    guard !retrying else { return }
    let item = ItemRetry.firstString(await API.send(RecentDiscards.itemStatusQuery(itemID: itemID)).flatMap { $0.status == 200 ? $0.data : nil }, "status")
    let job = item == "queued"
      ? ItemRetry.firstString(await API.send(RecentDiscards.jobStatusQuery(itemID: itemID)).flatMap { $0.status == 200 ? $0.data : nil }, "status") : nil
    retryButton = ItemRetry.canRetry(itemStatus: item, jobStatus: job)
  }

  /// 저장된 글로 다시 처리(retry_item) → 3초마다 최대 90초 결과(복구 행 문구) → 일정 절 다시 읽기
  private func retry() {
    retrying = true; retryNote = ItemRetry.retrying
    Task {
      defer { retrying = false }
      let r = await API.send(ItemRetry.rpcPath, method: "POST", json: ["p_item": itemID])
      let result = ItemRetry.result(status: r?.status, data: r?.data)
      DiagLog.append("item retry \(result)")
      switch ItemRetry.detailStep(result) {
      case .poll:
        retryButton = false
        let s = await RecentDiscards.pollRestore(itemID: itemID, wait: { try? await Task.sleep(for: RecentDiscards.pollEvery) }) { path in
          guard let r = await API.send(path), r.status == 200 else { return nil }
          return r.data
        }
        retryNote = RecentDiscards.restoreLine(s)
        retryButton = s == .failed
        await loadEvents()
      case .hide: retryButton = false; retryNote = nil; await loadEvents()   // not_failed — 그사이 처리됐으면 새 일정 절(0.16.1 리뷰 Minor 8)
      case .text(let t, let keep): retryNote = t; retryButton = keep
      }
    }
  }

  /// 일정 절: 제안 목록(본인 facts ⨝ proposals) → 캘린더 대조. 못 읽으면 앞 목록을 둔다
  private func loadEvents() async {
    if let r = await API.send(ItemEvents.query(itemID: itemID)), r.status == 200 {
      if let v = ItemEvents.decode(r.data) { events = v }
      if let f = ChatAddEvent.facts(itemID: itemID, data: r.data) { factVersions = f }
    }
    judge()
  }

  /// 고친 일정 버튼(§10): 바꾸기 = handleChange, 삭제 확인된 일정의 추가 = 새 값으로 새 일정(계보 확인 없음, 바꾼 뒤 지운 일정은 다시 추가 — K11).
  /// 추가가 겹침·비슷한 일정으로 멈추면 확인창 뒤 confirmed 로 다시(K34, Codex 플랜 리뷰 M4). 끝나면 절을 다시 읽고 제안 탭을 새로 고친다
  private func press(_ top: ProposalVersion, _ st: EditFlow.CardState, _ b: EditFlow.Button, confirmed: Bool = false) {
    editing[top.id] = .running
    Task {
      let outcome: String
      if b == .add, let f = EditFlow.addFields(top) {
        outcome = await NotificationActions.handleAdd(fields: f, confirmed: confirmed, readd: top.status == "succeeded", checkLineage: false)
        if ProposalFlow.needsConfirm(confirmed: confirmed, outcome: outcome) {
          editing[top.id] = nil
          editConfirm = EditConfirm(top: top, state: st, prompt: CalendarLookup.confirmPrompt(pid: top.id, fields: f, outcome: outcome))
          return
        }
      } else if let i = EditFlow.changeInput(subject: top, state: st), let t = ProposalTiming.parse(start: i.startText, end: i.endText) {
        outcome = await NotificationActions.handleChange(ChangeRequest(input: i, timing: t, confirmed: b == .changeAnyway))
      } else { outcome = "fail:input" }
      let fb = b == .add ? ChatReply.addFeedback(outcome) : ChatEdit.changeFeedback(outcome)
      editing[top.id] = fb.retry ? .failed(fb.text) : nil
      ProposalRouter.shared.revision += 1
      await loadEvents()
    }
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
    // 고친 일정(§9 B 앱 — 0.16.0): 최고 버전이 update_event, 또는 version > 1 create_event 의 계보 상태면 EditFlow 상태로 그린다(같은 판정 함수, K27)
    let lookup = CalendarLookup.lookup(ex)
    editStates = factVersions.reduce(into: [:]) { out, f in
      guard let top = f.top, top.action == "update_event" || (top.action == "create_event" && top.version > 1) else { return }
      let st = EditFlow.state(subject: top, versions: f.versions, itemID: itemID, lookup: lookup)
      // create_event 는 계보 상태만 — 계보 없음(add)·무시함·못 읽음은 지금 행(제안 탭 행 — 무시함이면 추가만)이 그린다
      if top.action == "create_event" { guard case .lineage = st else { return } }
      out[top.id] = st
    }
  }
}
