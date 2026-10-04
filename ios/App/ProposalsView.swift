import SwiftUI
import EventKit
import UIKit
import EruriCore

/// 배너 탭 딥링크와 제안 목록 갱신 신호(Ruling 8'). 알림 델리게이트가 메인에서 넣고, 루트 뷰가 UI 준비 후 시트로 띄운다(콜드 스타트)
@MainActor @Observable final class ProposalRouter {
  static let shared = ProposalRouter()
  var link: ProposalReview.Link?
  var openCount = 0                  // 딥링크가 들어올 때마다 +1 — 루트가 "제안" 탭으로 옮긴다
  var revision = 0                   // 시트에서 추가·무시가 끝나면 +1 — 제안 탭이 목록을 다시 읽는다
  func open(_ l: ProposalReview.Link) { link = l; openCount += 1 }
}

/// "제안" 탭(스펙 §11 제안 리뷰, Ruling 8'): list_pending_proposals 목록, 행마다 캘린더 추가·무시. 추가는 handleAdd(§10 순서 그대로)
struct ProposalsView: View {
  @Environment(\.scenePhase) private var scenePhase
  @State private var rows: [ProposalReview.Pending] = []
  @State private var states: [String: ProposalReview.ActionState] = [:]
  @State private var loading = false
  @State private var message = ""
  @State private var calendarOK = CalendarLookup.fullAccess
  @State private var confirmAll = false
  @State private var dismissingAll = false
  @State private var allResult = ""

  var body: some View {
    NavigationStack {
      List {
        if !calendarOK { CalendarAccessSection { calendarOK = CalendarLookup.fullAccess } }
        if !allResult.isEmpty { Text(allResult).font(.caption).foregroundStyle(.secondary) }
        if !message.isEmpty { Text(message).font(.caption).foregroundStyle(.secondary) }
        ForEach(rows) { p in
          ProposalActionsView(title: p.title, when: p.whenLabel, location: p.location, addFields: calendarOK ? p.addFields : nil,
                              proposalId: p.proposal_id, state: binding(p.proposal_id))
        }
      }
      .navigationTitle("제안")
      .toolbar {
        if !rows.isEmpty {
          ToolbarItem(placement: .topBarTrailing) {
            Button(dismissingAll ? "무시하는 중…" : "전체 무시", role: .destructive) { confirmAll = true }.disabled(dismissingAll)
          }
        }
      }
      .confirmationDialog("대기 중인 제안 \(rows.count)건을 모두 무시할까요?", isPresented: $confirmAll, titleVisibility: .visible) {
        Button("삭제", role: .destructive) { Task { await dismissAll() } }
        Button("취소", role: .cancel) {}
      }
      .task { await load() }
      .refreshable { await load() }
      .onChange(of: scenePhase) { _, phase in if phase == .active { calendarOK = CalendarLookup.fullAccess; Task { await load() } } }
      .onChange(of: ProposalRouter.shared.revision) { _, _ in Task { await load() } }
    }
  }

  private func binding(_ id: String) -> Binding<ProposalReview.ActionState> {
    // 추가·무시가 끝나면 목록을 다시 읽어 처리된 행을 뺀다(실패면 행과 버튼을 남긴다)
    Binding(get: { states[id] ?? .idle }, set: { s in
      states[id] = s
      if case .finished = s { Task { await load() } }
    })
  }

  /// "전체 무시"(스펙 §10): 지금 목록의 id 마다 dismiss_proposal(동시 2, 각 8초). 실패한 행은 새로고침 뒤에도 남는다
  private func dismissAll() async {
    if dismissingAll { return }
    dismissingAll = true; allResult = ""
    let ids = rows.map(\.proposal_id)
    let r = await ProposalReview.dismissAll(ids, concurrency: 2, timeout: 8) { await NotificationActions.dismiss(proposalId: $0, timeout: 8) }
    allResult = r.text
    dismissingAll = false
    await load()
  }

  private func load() async {
    if loading { return }
    loading = true; defer { loading = false }
    guard let v = await NotificationActions.pendingProposals() else { message = "불러오지 못했습니다. 당겨서 다시 시도하세요"; return }
    rows = v
    // 사라진 행의 결과는 버리고, 남은 행의 진행·결과는 유지한다(추가 직후 보고가 늦어 아직 목록에 남아 있을 수 있다)
    states = states.filter { id, _ in v.contains { $0.proposal_id == id } }
    message = v.isEmpty ? "대기 중인 제안이 없습니다. 새 일정이 담긴 메일·알림이 오면 여기에 보입니다" : ""
  }
}

/// 시트의 제안 한 장(단건 시트와 묶음 카드 공용): 판정(Sheet)에 따라 추가·무시·안내. 권한 안내는 시트가 맨 위에 한 번
struct SheetCardView: View {
  let link: ProposalReview.Link
  let sheet: ProposalReview.Sheet
  let calendarOK: Bool
  @Binding var state: ProposalReview.ActionState

  var body: some View {
    switch sheet {
    case .pending(let p):
      ProposalActionsView(title: p.title, when: p.whenLabel, location: p.location, addFields: calendarOK ? p.addFields : nil,
                          proposalId: p.proposal_id, state: $state)
    case .offline(let f):
      ProposalActionsView(title: link.title, when: link.whenLabel, location: nil, addFields: calendarOK ? f : nil,
                          proposalId: link.proposalId, state: $state)
      Text("서버에 연결하지 못해 알림 내용으로 보여 줍니다").font(.caption).foregroundStyle(.secondary)
    case .unlisted(let f):                                                     // proposed 인데 목록 50건 밖 — 알림 값, 안내 없음
      ProposalActionsView(title: link.title, when: link.whenLabel, location: nil, addFields: calendarOK ? f : nil,
                          proposalId: link.proposalId, state: $state)
    case .needsReview:
      ProposalActionsView(title: link.title, when: link.whenLabel, location: nil, addFields: nil, proposalId: link.proposalId, state: $state)
      Text(link.category == "ADD_REMINDER" ? "할 일 제안은 아직 앱에서 바로 추가하지 않습니다"
           : "날짜나 내용 확인이 필요한 제안이라 바로 추가하지 않습니다. 캘린더 앱에서 직접 추가해 주세요")
        .font(.caption).foregroundStyle(.secondary)
    case .processed:
      Text(link.title); Text(link.whenLabel).font(.caption).foregroundStyle(.secondary)
      Text("이미 추가·무시됐거나 지난 제안입니다").foregroundStyle(.secondary)
    }
  }
}

/// 배너 탭 시트: 목록에서 그 제안을 찾아 서버 값(장소 포함)으로 보이고, 못 읽으면 푸시 값으로(§10 순서 5).
/// 묶음 알림(EVENT_BUNDLE, 0.9.0)이면 events 순서대로 카드 N장 — 카드마다 따로 판정·추가·무시
struct ProposalSheet: View {
  let link: ProposalReview.Link
  @Environment(\.dismiss) private var close
  @Environment(\.scenePhase) private var scenePhase
  @State private var sheet: ProposalReview.Sheet?
  @State private var cards: [ProposalReview.BundleCard]?
  @State private var state = ProposalReview.ActionState.idle
  @State private var states: [String: ProposalReview.ActionState] = [:]
  @State private var calendarOK = CalendarLookup.fullAccess

  private var isBundle: Bool { link.events.count >= 2 }
  /// 추가할 수 있는 카드가 있을 때만 권한 안내(단건 시트의 기존 위치 = 맨 위)
  private var needsAccessPrompt: Bool {
    let sheets = isBundle ? (cards ?? []).map(\.sheet) : [sheet].compactMap { $0 }
    return !calendarOK && sheets.contains { switch $0 { case .pending, .offline, .unlisted: true; default: false } }
  }

  var body: some View {
    NavigationStack {
      List {
        if needsAccessPrompt { CalendarAccessSection { calendarOK = CalendarLookup.fullAccess } }
        if isBundle {
          if let cards {
            ForEach(cards) { c in Section { SheetCardView(link: c.event.link, sheet: c.sheet, calendarOK: calendarOK, state: binding(c.id)) } }
          } else { ProgressView() }
        } else if let sheet {
          SheetCardView(link: link, sheet: sheet, calendarOK: calendarOK, state: $state)
        } else { ProgressView() }
      }
      .navigationTitle(isBundle ? "제안 \(link.events.count)건" : "제안").navigationBarTitleDisplayMode(.inline)
      .toolbar { ToolbarItem(placement: .confirmationAction) { Button("닫기") { close() } } }
      .task {
        if isBundle {                                                         // 목록과 상태를 같은 5초 마감으로 병렬 조회(§10 묶음 판정)
          async let list = NotificationActions.pendingProposals(timeout: 5)
          async let st = NotificationActions.proposalStatuses(link.events.map(\.proposalId), timeout: 5)
          cards = ProposalReview.cards(for: link, list: await list, statuses: await st)
        } else { sheet = ProposalReview.sheet(for: link, list: await NotificationActions.pendingProposals(timeout: 5)) }
      }
      .onChange(of: state) { _, s in if case .finished = s { ProposalRouter.shared.revision += 1 } }
      .onChange(of: states) { old, new in
        if new.contains(where: { k, v in if case .finished = v, old[k] != v { true } else { false } }) { ProposalRouter.shared.revision += 1 }
      }
      .onChange(of: scenePhase) { _, phase in if phase == .active { calendarOK = CalendarLookup.fullAccess } }   // 설정에서 허용하고 돌아온 경우
    }
  }

  private func binding(_ id: String) -> Binding<ProposalReview.ActionState> {
    Binding(get: { states[id] ?? .idle }, set: { states[id] = $0 })
  }
}

/// 제안 한 건: 제목·시각·장소, "캘린더에 추가"(addFields 가 있을 때만)·"무시". 결과를 아래에 쓰고, 실패면 버튼을 다시 켠다.
/// 겹침(스펙 §10): 뜰 때·앱 활성화 때 미리 판정해 "겹치는 일정" 줄과 "겹쳐도 추가"를 보이고, 누르면 확인창 없이 confirmed 로 부른다(0.8.1).
/// 비슷한 일정(0.9.2): 겹침이 없으면 같은 날 비슷한 제목 → "✅ 캘린더에 비슷한 일정이 있음 · 날짜 제목" + "그래도 추가"(확인창 없이 confirmed).
/// 종일 제안이 다른 제안 표식·같은 날짜·같은 정규화 제목 일정과 맞으면 "✅ 캘린더에 등록됨" — 추가 버튼 없이 무시만.
/// 최종 판정은 AddEventGate — 미리 판정에 없던 겹침·비슷한 일정이 저장 직전에 나오면 다시 읽고 확인창(C2-5).
/// mode(항목 상세 "일정" 절, §10 0.11.4): readd = "캘린더에 다시 추가"(무시 없음, handleAdd readd), addOnly = 무시한 제안(추가만)
struct ProposalActionsView: View {
  enum Mode { case pending, readd, addOnly }
  let title: String; let when: String; let location: String?; let addFields: [String: String]?; let proposalId: String
  @Binding var state: ProposalReview.ActionState
  var mode = Mode.pending
  /// 장소 아래 상태 한 줄(항목 상세 — "캘린더에서 찾지 못함 …"·"무시한 제안")
  var note: String? = nil
  @Environment(\.scenePhase) private var scenePhase
  @State private var preview = ProposalFlow.Preview.clear
  @State private var askConfirm = false
  @State private var heldSimilar = false                              // 확인창을 띄운 결과가 비슷한 일정(similar:<n>)인가 — 문구를 고른다

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(title).font(.headline)
      Text(when).font(.subheadline).foregroundStyle(.secondary)
      if let location { Label(location, systemImage: "mappin.and.ellipse").font(.caption).foregroundStyle(.secondary) }
      if let note, !finished { Text(note).font(.caption).foregroundStyle(.secondary) }
      // 추가·무시가 끝나면(.finished) 미리 판정 줄은 지난 정보라 숨긴다(C2 리뷰 Minor 4)
      if addFields != nil, !finished {
        if let line = ProposalFlow.conflictLine(conflicts) { Text(line).font(.caption).foregroundStyle(.orange) }
        else if let line = ProposalFlow.similarLine(similars) { Text(line).font(.caption).foregroundStyle(.secondary) }
        else if registered { Text(ScheduleCard.statusText(.added)).font(.caption).foregroundStyle(.secondary) }
      }
      HStack {
        if addFields != nil, !(registered && !finished) {
          Button(state == .running ? "처리하는 중…" : buttonTitle) {
            add(confirmed: ProposalFlow.tapConfirmed(conflictsShown: !conflicts.isEmpty || !similars.isEmpty))
          }.buttonStyle(.borderedProminent)
        }
        if mode == .pending {
          Button("무시") {
            state = .running
            Task { state = .after(ProposalReview.dismissFeedback(await NotificationActions.dismiss(proposalId: proposalId))) }
          }.buttonStyle(.bordered)
        }
      }
      .disabled(!state.buttonsEnabled)
      switch state {
      case .finished(let t): Text(t).font(.caption).foregroundStyle(.secondary)
      case .failed(let t): Text(t).font(.caption).foregroundStyle(.red)
      default: EmptyView()
      }
    }
    .padding(.vertical, 4)
    .task(id: addFields?["start"]) { refreshPreview() }
    .onChange(of: scenePhase) { _, phase in if phase == .active { refreshPreview() } }   // 캘린더 앱에서 바꾸고 돌아온 경우
    .confirmationDialog(confirmText, isPresented: $askConfirm, titleVisibility: .visible) {
      Button("추가") { add(confirmed: true) }
      Button("취소", role: .cancel) {}
    }
  }

  private var finished: Bool { if case .finished = state { return true }; return false }
  /// 겹침·비슷한 일정을 보였으면 그 문구("겹쳐도 추가"·"그래도 추가"), 아니면 다시 추가 행은 "캘린더에 다시 추가"
  private var buttonTitle: String {
    let c = !conflicts.isEmpty && !finished, s = !similars.isEmpty && !finished
    if mode == .readd, !c, !s { return ItemEvents.readdButtonTitle }
    return ProposalFlow.addButtonTitle(allDay: allDay, conflictsShown: c, similarShown: s)
  }
  private var timing: ProposalTiming? { addFields?["start"].flatMap { ProposalTiming.parse(start: $0, end: addFields?["end"]) } }
  /// 날짜만 = 종일(0.9.1): "종일 일정으로 추가", 겹침 미리 판정 없음(§10 종일 제외)
  private var allDay: Bool { timing?.isAllDay ?? false }
  private var conflicts: [ProposalFlow.CalendarEvent] { if case .conflict(let c) = preview { return c }; return [] }
  private var similars: [ProposalFlow.CalendarEvent] { if case .similar(let s) = preview { return s }; return [] }
  private var registered: Bool { if case .registered = preview { return true }; return false }

  /// 확인창 문구: 저장 직전 결과(겹침·비슷한 일정)에 맞춰 다시 읽은 일정의 제목
  private var confirmText: String {
    guard heldSimilar else { return ProposalFlow.confirmTitle(conflicts) }
    if case .registered(let e) = preview { return ProposalFlow.similarConfirmTitle([e]) }
    return ProposalFlow.similarConfirmTitle(similars)
  }

  /// 겹침(시각) → 같은 일정 등록됨(종일) → 비슷한 일정(0.9.2). 제목은 handleAdd 에 넘기는 값(addFields)으로 — AddEventGate 와 같은 입력
  private func refreshPreview() {
    guard let timing else { preview = .clear; return }
    preview = CalendarLookup.preview(pid: proposalId, title: addFields?["title"] ?? title, timing: timing)
  }

  /// §10 경로 그대로(handleAdd). 미리 판정에 없던 겹침·비슷한 일정이면 저장하지 않고 돌아오므로 다시 읽고 확인창
  private func add(confirmed: Bool) {
    guard let fields = addFields else { return }
    state = .running
    Task {
      let outcome = await NotificationActions.handleAdd(fields: fields, confirmed: confirmed, readd: mode == .readd)
      if ProposalFlow.needsConfirm(confirmed: confirmed, outcome: outcome) {
        heldSimilar = ProposalFlow.similarCount(outcome) != nil
        refreshPreview(); state = .idle; askConfirm = true
      }
      else { state = .after(mode == .readd ? ItemEvents.readdFeedback(outcome) : ChatReply.addFeedback(outcome)) }
    }
  }
}

/// 채팅 일정 질문의 캘린더 접근 안내 한 줄(§9): 목록 행 안에 들어가므로 Section 이 아니고 버튼은 borderless.
/// 아직 묻지 않았으면 여기서 묻고, 거부·추가만 허용이면 설정 앱으로
struct CalendarAccessPrompt: View {
  let message: String
  let onChange: () -> Void
  @Environment(\.openURL) private var openURL
  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      Text(message).font(.caption).foregroundStyle(.secondary)
      if EKEventStore.authorizationStatus(for: .event) == .notDetermined {
        Button("캘린더 접근 허용") {
          Task {
            _ = try? await EKEventStore().requestFullAccessToEvents()
            NotificationActions.register()
            onChange()
          }
        }.buttonStyle(.borderless).font(.caption)
      } else if let url = URL(string: UIApplication.openSettingsURLString) {
        // Link 는 List 행 안에서 행 탭 경로로 동작해 채팅 목록의 탭 제스처와 겹치면 1회 탭이 먹지 않았다(0.8.1 게이트 C1-4: 3회째에 열림).
        // 자기 제스처를 갖는 borderless 버튼으로 연다
        Button("설정에서 허용하기") { openURL(url) }.buttonStyle(.borderless).font(.caption)
      }
    }
  }
}

/// 캘린더 전체 접근이 없으면 추가 버튼 대신 안내(§10 권한 철회, M2-⑨a 리뷰). 아직 묻지 않았으면 여기서 묻고, 거부했으면 설정 앱으로.
/// 전체 접근 판정은 CalendarLookup.fullAccess 하나로 모은다(C2 리뷰 Minor 5)
struct CalendarAccessSection: View {
  let onChange: () -> Void
  var body: some View {
    Section {
      Text("캘린더 전체 접근을 허용해야 제안을 캘린더에 추가할 수 있습니다").font(.subheadline)
      if EKEventStore.authorizationStatus(for: .event) == .notDetermined {
        Button("캘린더 접근 허용") {
          Task {
            _ = try? await EKEventStore().requestFullAccessToEvents()
            NotificationActions.register()                                  // 알림 "캘린더에 추가" 버튼도 다시
            onChange()
          }
        }
      } else if let url = URL(string: UIApplication.openSettingsURLString) {
        Link("설정에서 허용하기", destination: url)
      }
    }
  }
}
