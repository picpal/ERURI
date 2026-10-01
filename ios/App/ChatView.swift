import SwiftUI
import EruriCore

/// 채팅(스펙 §9): 질문 → 답변 + 출처(탭하면 원문) + 인용마다 👍/👎(eval_judgments, §9 평가 절차 4) + 인용 항목의 제안 카드(Ruling 8)
/// + 일정 질문이면 "기기 캘린더" 절(§9 일정 질문과 기기 캘린더 — 기기 안에서만 읽는다)
struct ChatView: View {
  struct Turn: Identifiable {
    let id = UUID(); let question: String; var answer: ChatReply.Answer?; var error: String?
    var calendar: [ProposalFlow.CalendarEvent]?                 // "기기 캘린더" 절(§9): 일정 기간의 기기 일정. nil = 일정 질문 아님·읽지 않음
    var cardStatus: [String: DeviceCalendar.CardStatus] = [:]   // 제안 id → 그 시각 캘린더 상태
  }

  @State private var input = ""
  @FocusState private var inputFocused: Bool           // 키보드가 탭 막대를 가리므로 스크롤·빈 곳 탭으로 내린다(키보드 툴바 "완료"는 가려져 0.7.1 에서 뺐다)
  @State private var turns: [Turn] = []
  @State private var busy = false
  @State private var judged: [String: Bool] = [:]      // "<answer_id>|<item_id>" → ok
  @State private var judging: Set<String> = []         // 기록 요청 중인 키 — 연타가 도착 순서 경합을 만들지 않게 막는다
  @State private var adds: [String: AddState] = [:]    // 제안 id → 캘린더 추가 진행·결과
  @State private var confirm: ConfirmAdd?              // 겹침 확인창(§10): 저장 직전에 겹침이 새로 나온 경우만(C2-5). 제안 id·handleAdd 필드·다시 읽은 겹치는 일정
  struct ConfirmAdd: Identifiable { let id: String; let fields: [String: String]; let conflicts: [ProposalFlow.CalendarEvent] }
  @State private var dictation = SpeechDictation()     // 기기 안 받아쓰기(§9·§12)
  @Environment(\.scenePhase) private var scenePhase
  @Environment(\.colorScheme) private var scheme
  enum AddState { case running, finished(String), failed(String) }

  var body: some View {
    NavigationStack {
      List {
        ForEach(turns) { t in
          Section {
            Text(t.question).font(.subheadline).foregroundStyle(.secondary)
            if let e = t.error { Text(e).foregroundStyle(.red) }
            if let a = t.answer { answerRows(t, a) }
            else if t.error == nil { ProgressView() }
          }
        }
      }
      .scrollDismissesKeyboard(.interactively)
      .scrollBounceBehavior(.always)   // 대화가 비었거나 짧아 넘치지 않아도 끌려서 아래로 쓸면 키보드가 내려간다
      .simultaneousGesture(TapGesture().onEnded { inputFocused = false })   // 목록 탭은 행 버튼·링크를 막지 않고 포커스만 푼다
      .safeAreaInset(edge: .bottom) { inputPanel }
      .confirmationDialog(ProposalFlow.confirmTitle(confirm?.conflicts ?? []),
                          isPresented: Binding(get: { confirm != nil }, set: { if !$0 { confirm = nil } }),
                          titleVisibility: .visible, presenting: confirm) { c in
        Button("추가") { runAdd(c, confirmed: true) }
        Button("취소", role: .cancel) {}
      }
      .navigationTitle("채팅")
      .onAppear { dictation.onText = { input = $0 }; dictation.refresh() }
      .onDisappear { dictation.stopIfRecording() }
      // 백그라운드·전화로 비활성이 되면 녹음을 끊고, 돌아오면 권한을 다시 읽는다(설정에서 허용하고 온 경우).
      // 캘린더 절·카드 상태도 다시 읽는다(설정에서 캘린더 권한·캘린더 앱에서 일정을 바꾸고 온 경우, Codex #6)
      .onChange(of: scenePhase) { _, p in if p == .active { dictation.refresh(); refreshCalendars() } else { dictation.stopIfRecording() } }
    }
  }

  private var canSend: Bool { !busy && !input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

  /// 입력창(0.6.0): 둥근 리퀴드 글래스 패널 — 위 여러 줄 입력, 아래 "+"(2단계 첨부)·마이크·보내기
  private var inputPanel: some View {
    VStack(alignment: .leading, spacing: 10) {
      TextField("질문하기", text: $input, axis: .vertical).lineLimit(1...5).focused($inputFocused)
        .padding(.horizontal, 6).padding(.top, 4)
      if let n = dictation.state.notice { Text(n).font(.caption2).foregroundStyle(.secondary).padding(.horizontal, 6) }
      HStack(spacing: 10) {
        Menu {
          Button("이미지·파일 첨부 (2단계 예정)") {}.disabled(true)   // 첨부는 스펙 §15 2단계
        } label: { roundIcon("plus", fill: Color(.secondarySystemFill), tint: Color.primary) }
        .buttonStyle(.plain)
        Spacer()
        Button { Task { await dictation.toggle(currentText: input) } } label: {
          dictation.recording ? roundIcon("waveform", fill: .red, tint: .white) : roundIcon("mic", fill: Color(.secondarySystemFill), tint: Color.primary)
        }
        .buttonStyle(.plain)
        .disabled(!dictation.available).opacity(dictation.available ? 1 : 0.4)
        .accessibilityLabel(dictation.recording ? "받아쓰기 멈춤" : "음성으로 입력")
        // 라이트 검정 원·흰 화살표, 다크 흰 원·검정 화살표. plain 스타일로 강조색(tint)을 막고, 글래스 안에서 primary 채움이
        // 비브런시로 옅은 회색이 되므로(시뮬레이터 스크린샷 확인) 모드별 검정·흰색을 직접 쓴다
        Button(action: send) {
          roundIcon("arrow.up", fill: scheme == .dark ? Color.white : Color.black, tint: scheme == .dark ? Color.black : Color.white)
        }
          .buttonStyle(.plain).disabled(!canSend).opacity(canSend ? 1 : 0.3).accessibilityLabel("보내기")
      }
    }
    .padding(12)
    .glassEffect(.regular, in: .rect(cornerRadius: 28))
    .padding(.horizontal, 12).padding(.bottom, 8)
    // 입력창 영역에서 아래로 끌어도 내린다. 동시 제스처라 입력창 탭·커서 이동·버튼은 그대로
    .simultaneousGesture(DragGesture(minimumDistance: 10).onEnded { if $0.translation.height > 30 { inputFocused = false } })
  }

  private func roundIcon(_ name: String, fill: some ShapeStyle, tint: some ShapeStyle) -> some View {
    Image(systemName: name).font(.system(size: 16, weight: .semibold)).foregroundStyle(tint)
      .frame(width: 36, height: 36).background(fill, in: Circle())
  }

  @ViewBuilder private func answerRows(_ t: Turn, _ a: ChatReply.Answer) -> some View {
    // 거절이어도 답 문구는 그대로(Codex #4). 기기 캘린더 절이 아래에서 "이 기간 일정 N건"을 따로 알린다
    Text(a.answer)
    ForEach(a.citations) { c in
      HStack {
        NavigationLink {
          ItemDetailView(itemID: c.item_id)
        } label: {
          VStack(alignment: .leading) {
            Text(c.title ?? "(제목 없음)").font(.caption)
            Text("\(SourceLabel.label(source: c.source, appName: c.app_name)) · \(ChatReply.seoulLabel(c.occurred_at))\(c.expired ? " · 원문 만료됨" : "")")
              .font(.caption2).foregroundStyle(.secondary)
          }
        }
        judgeButton(a.answer_id, c.item_id, true, "👍")
        judgeButton(a.answer_id, c.item_id, false, "👎")
      }
    }
    // 스펙 §9 채팅 → 보관함 보기: 인용 ∪ 구별 facts ∪ 관련도 컷(서버 S1). 거절 답변·후보 없음이면 숨긴다(0.7.1)
    if let ids = a.archiveIDs {
      let scope = Archive.Scope(question: t.question, ids: ids)
      Button("보관함에서 보기 (\(scope.ids.count)건)") { ArchiveRouter.shared.open(scope) }
        .font(.caption).buttonStyle(.borderless)
    }
    if a.schedule != nil { calendarRows(t, a) }
    // 푸시 "추가" 액션과 같이 캘린더 전체 접근이 없으면 카드를 숨긴다(§10 권한 철회)
    if CalendarLookup.fullAccess {
      ForEach(a.proposals) { p in
        if let start = ChatReply.calendarStart(p) {
          proposalCard(p, title: p.payload["title"]?.string ?? "일정", start: start, status: t.cardStatus[p.id] ?? .clear)
        }
      }
    }
  }

  /// "기기 캘린더" 절(§9 일정 질문과 기기 캘린더). 전체 접근이 없으면(추가만 허용 포함) 절 대신 안내 한 줄 — 허용하면 이 턴을 다시 읽는다
  @ViewBuilder private func calendarRows(_ t: Turn, _ a: ChatReply.Answer) -> some View {
    if !CalendarLookup.fullAccess {
      CalendarAccessPrompt(message: DeviceCalendar.accessText) {
        // 거부했으면 다시 그려 "설정에서 허용하기"로 바뀌게 한다(권한 상태는 관찰되지 않는다)
        if let i = turns.firstIndex(where: { $0.id == t.id }) { if CalendarLookup.fullAccess { readCalendar(i, a) } else { turns[i].calendar = nil } }
      }
    } else if let events = t.calendar {
      let l = DeviceCalendar.lines(events)
      VStack(alignment: .leading, spacing: 2) {
        Text(DeviceCalendar.header(DeviceCalendar.visible(events).count)).font(.caption).bold()
        if l.lines.isEmpty { Text(DeviceCalendar.emptyText).font(.caption2).foregroundStyle(.secondary) }
        ForEach(Array(l.lines.enumerated()), id: \.offset) { Text($0.element).font(.caption2) }
        if l.more > 0 { Text("외 \(l.more)건").font(.caption2).foregroundStyle(.secondary) }
      }
    }
  }

  /// 기기 캘린더(§9·§12 통제 2): 이 답의 일정 기간 일정과 제안 카드 상태를 기기 안에서만 읽어 턴에 둔다. 서버로 보내지 않는다
  private func readCalendar(_ idx: Int, _ a: ChatReply.Answer) {
    guard CalendarLookup.fullAccess else { return }
    if let range = a.schedule?.interval { turns[idx].calendar = CalendarLookup.scheduleEvents(range) }
    let cards = a.proposals.compactMap { p -> (pid: String, title: String, start: Date)? in
      guard let s = ChatReply.calendarStart(p), let at = ISO8601DateFormatter().date(from: s) else { return nil }
      return (p.id, p.payload["title"]?.string ?? "일정", at)
    }
    turns[idx].cardStatus = CalendarLookup.cardStatuses(cards)
  }

  /// 앱 활성화(설정에서 권한을 바꾸고 돌아옴·캘린더 앱에서 일정을 바꿈)·카드 추가 성공 뒤(Codex #6): 마지막 5개 턴만 다시 읽는다.
  /// 전체 접근이 없으면 지운다(권한 철회). EventKit 변경 알림은 구독하지 않는다
  private func refreshCalendars() {
    for i in turns.indices.suffix(5) {
      guard let a = turns[i].answer else { continue }
      if CalendarLookup.fullAccess { readCalendar(i, a) } else { turns[i].calendar = nil; turns[i].cardStatus = [:] }
    }
  }

  @ViewBuilder private func proposalCard(_ p: ChatReply.Proposal, title: String, start: String, status: DeviceCalendar.CardStatus) -> some View {
    let state = adds[p.id], shown = status == .conflict     // "같은 시간에 일정 있음"을 보인 카드는 "겹쳐도 추가" — 확인창 없이 저장(0.8.1)
    VStack(alignment: .leading, spacing: 4) {
      Button(state.isRunning ? "추가하는 중… · \(title)" : "\(shown ? "겹쳐도 추가" : "캘린더에 추가") · \(title) \(ChatReply.seoulLabel(start))") {
        runAdd(ConfirmAdd(id: p.id, fields: ["proposal_id": p.id, "title": title, "start": start], conflicts: []),
               confirmed: ProposalFlow.tapConfirmed(conflictsShown: shown))
      }
      .disabled(state.isRunning || state.isFinished)
      if let s = DeviceCalendar.statusText(status) {
        Text(s).font(.caption).foregroundStyle(status == .conflict ? Color.orange : Color.secondary)
      }
      switch state {
      case .finished(let t)?: Text(t).font(.caption).foregroundStyle(.secondary)
      case .failed(let t)?: Text(t).font(.caption).foregroundStyle(.red)
      default: EmptyView()
      }
    }
  }

  /// 알림 액션과 같은 §10 경로(서버 상태 확인 → 표식 조회 → 겹침 → 저장 → 보고). 미리 겹침 없이 불렀는데 겹침이면 저장하지 않고
  /// 돌아오므로 겹치는 일정을 다시 읽어 확인창을 띄우고, "추가"면 confirmed 로 다시 부른다. 결과를 카드에 쓰고, 실패면 버튼을 다시 켠다
  private func runAdd(_ c: ConfirmAdd, confirmed: Bool) {
    adds[c.id] = .running
    Task {
      let outcome = await NotificationActions.handleAdd(fields: c.fields, confirmed: confirmed)
      if ProposalFlow.needsConfirm(confirmed: confirmed, outcome: outcome) {
        adds[c.id] = nil
        let start = c.fields["start"].flatMap { ISO8601DateFormatter().date(from: $0) }
        confirm = ConfirmAdd(id: c.id, fields: c.fields, conflicts: start.map { CalendarLookup.conflicts(pid: c.id, start: $0) } ?? [])
        return
      }
      let fb = ChatReply.addFeedback(outcome)
      adds[c.id] = fb.retry ? .failed(fb.text) : .finished(fb.text)
      if !fb.retry { refreshCalendars() }                       // 추가 뒤 카드 "이미 캘린더에 있음"·절이 바로 바뀐다(Codex #6)
    }
  }

  private func judgeButton(_ answer: String, _ item: String, _ ok: Bool, _ label: String) -> some View {
    let key = "\(answer)|\(item)"
    return Button(label) {
      let before = judged[key]
      judged[key] = ok
      judging.insert(key)
      Task {
        defer { judging.remove(key) }
        // 같은 인용을 다시 누르면 바꾼다(unique user_id·question_id·item_id, merge-duplicates). 실패하면 표시를 되돌린다
        let r = await API.send("rest/v1/eval_judgments?on_conflict=user_id,question_id,item_id", method: "POST",
                               json: ["question_id": answer, "item_id": item, "ok": ok],
                               headers: ["Prefer": "resolution=merge-duplicates,return=minimal"])
        if !(200..<300).contains(r?.status ?? -1) { judged[key] = before }
      }
    }
    .buttonStyle(.borderless).disabled(judging.contains(key)).opacity(judged[key] == nil || judged[key] == ok ? 1 : 0.3)
  }

  private func send() {
    let q = input.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !q.isEmpty, !busy else { return }
    dictation.stopIfRecording()
    // 서버 한도(⑧b bad_question). 넘으면 입력을 지우지 않고 고칠 수 있게 둔다
    guard q.utf16.count <= 500 else { turns.append(Turn(question: q, error: ChatReply.errorMessage(status: 400))); return }
    input = ""
    turns.append(Turn(question: q))
    let idx = turns.count - 1
    busy = true
    Task {
      defer { busy = false }
      var attempt = 0
      while true {
        guard let r = await API.send("functions/v1/chat", method: "POST", json: ["question": q], timeout: 60) else {
          turns[idx].error = "연결 실패"; return
        }
        // llm_busy(503): 한 번만 짧게 기다렸다 다시(M2-⑦ LLM 동시 2)
        if let wait = ChatReply.retryDelay(status: r.status, attempt: attempt) {
          attempt += 1
          try? await Task.sleep(for: .seconds(wait))
          continue
        }
        if r.status == 200 {
          if let a = ChatReply.decode(r.data) { turns[idx].answer = a; readCalendar(idx, a) } else { turns[idx].error = "응답을 읽지 못했습니다" }
        } else {
          turns[idx].error = ChatReply.errorMessage(status: r.status)
        }
        return
      }
    }
  }
}

private extension Optional where Wrapped == ChatView.AddState {
  var isRunning: Bool { if case .running? = self { return true }; return false }
  var isFinished: Bool { if case .finished? = self { return true }; return false }
}
