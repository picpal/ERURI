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
  @State private var calendarOK = CalendarAccess.full

  var body: some View {
    NavigationStack {
      List {
        if !calendarOK { CalendarAccessSection { calendarOK = CalendarAccess.full } }
        if !message.isEmpty { Text(message).font(.caption).foregroundStyle(.secondary) }
        ForEach(rows) { p in
          ProposalActionsView(title: p.title, when: p.whenLabel, location: p.location, addFields: calendarOK ? p.addFields : nil,
                              proposalId: p.proposal_id, state: binding(p.proposal_id))
        }
      }
      .navigationTitle("제안")
      .task { await load() }
      .refreshable { await load() }
      .onChange(of: scenePhase) { _, phase in if phase == .active { calendarOK = CalendarAccess.full; Task { await load() } } }
      .onChange(of: ProposalRouter.shared.revision) { _, _ in Task { await load() } }
    }
  }

  private func binding(_ id: String) -> Binding<ProposalReview.ActionState> {
    Binding(get: { states[id] ?? .idle }, set: { states[id] = $0 })
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

/// 배너 탭 시트: 목록에서 그 제안을 찾아 서버 값(장소 포함)으로 보이고, 못 읽으면 푸시 값으로(§10 순서 5)
struct ProposalSheet: View {
  let link: ProposalReview.Link
  @Environment(\.dismiss) private var close
  @State private var sheet: ProposalReview.Sheet?
  @State private var state = ProposalReview.ActionState.idle
  @State private var calendarOK = CalendarAccess.full

  var body: some View {
    NavigationStack {
      List {
        switch sheet {
        case nil: ProgressView()
        case .pending(let p)?:
          if !calendarOK { CalendarAccessSection { calendarOK = CalendarAccess.full } }
          ProposalActionsView(title: p.title, when: p.whenLabel, location: p.location, addFields: calendarOK ? p.addFields : nil,
                              proposalId: p.proposal_id, state: $state)
        case .offline(let f)?:
          if !calendarOK { CalendarAccessSection { calendarOK = CalendarAccess.full } }
          ProposalActionsView(title: link.title, when: link.whenLabel, location: nil, addFields: calendarOK ? f : nil,
                              proposalId: link.proposalId, state: $state)
          Text("서버에 연결하지 못해 알림 내용으로 보여 줍니다").font(.caption).foregroundStyle(.secondary)
        case .needsReview?:
          ProposalActionsView(title: link.title, when: link.whenLabel, location: nil, addFields: nil, proposalId: link.proposalId, state: $state)
          Text(link.category == "ADD_REMINDER" ? "할 일 제안은 아직 앱에서 바로 추가하지 않습니다"
               : "날짜나 내용 확인이 필요한 제안이라 바로 추가하지 않습니다. 캘린더 앱에서 직접 추가해 주세요")
            .font(.caption).foregroundStyle(.secondary)
        case .processed?:
          Text(link.title); Text(link.whenLabel).font(.caption).foregroundStyle(.secondary)
          Text("이미 추가·무시됐거나 지난 제안입니다").foregroundStyle(.secondary)
        }
      }
      .navigationTitle("제안").navigationBarTitleDisplayMode(.inline)
      .toolbar { ToolbarItem(placement: .confirmationAction) { Button("닫기") { close() } } }
      .task {
        sheet = ProposalReview.sheet(for: link, list: await NotificationActions.pendingProposals(timeout: 5))
      }
      .onChange(of: state) { _, s in if case .finished = s { ProposalRouter.shared.revision += 1 } }
    }
  }
}

/// 제안 한 건: 제목·시각·장소, "캘린더에 추가"(addFields 가 있을 때만)·"무시". 결과를 아래에 쓰고, 실패면 버튼을 다시 켠다
struct ProposalActionsView: View {
  let title: String; let when: String; let location: String?; let addFields: [String: String]?; let proposalId: String
  @Binding var state: ProposalReview.ActionState

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(title).font(.headline)
      Text(when).font(.subheadline).foregroundStyle(.secondary)
      if let location { Label(location, systemImage: "mappin.and.ellipse").font(.caption).foregroundStyle(.secondary) }
      HStack {
        if let addFields {
          Button(state == .running ? "처리하는 중…" : "캘린더에 추가") {
            state = .running
            Task { state = .after(ChatReply.addFeedback(await NotificationActions.handleAdd(fields: addFields))) }
          }.buttonStyle(.borderedProminent)
        }
        Button("무시") {
          state = .running
          Task { state = .after(ProposalReview.dismissFeedback(await NotificationActions.dismiss(proposalId: proposalId))) }
        }.buttonStyle(.bordered)
      }
      .disabled(!state.buttonsEnabled)
      switch state {
      case .finished(let t): Text(t).font(.caption).foregroundStyle(.secondary)
      case .failed(let t): Text(t).font(.caption).foregroundStyle(.red)
      default: EmptyView()
      }
    }
    .padding(.vertical, 4)
  }
}

/// 캘린더 전체 접근이 없으면 추가 버튼 대신 안내(§10 권한 철회, M2-⑨a 리뷰). 아직 묻지 않았으면 여기서 묻고, 거부했으면 설정 앱으로
enum CalendarAccess {
  static var full: Bool { EKEventStore.authorizationStatus(for: .event) == .fullAccess }
}

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
