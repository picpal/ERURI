import SwiftUI
import EruriCore
import PhotosUI

/// 채팅(스펙 §9): 질문 → 답변 + 인용 항목의 제안 카드(Ruling 8) + 답 맨 아래 텍스트 버튼 막대(맞아요·틀렸어요·복사 — eval_judgments, §9 평가 절차 4, 0.9.0)
/// + 일정 질문이면 "기기 캘린더" 절(§9 일정 질문과 기기 캘린더 — 기기 안에서만 읽는다)
struct ChatView: View {
  struct Turn: Identifiable {
    let id = UUID(); let question: String; var answer: ChatReply.Answer?; var error: String?
    var calendar: [ProposalFlow.CalendarEvent]?   // "기기 캘린더" 절(§9): 일정 기간의 기기 일정. nil = 일정 질문 아님·읽지 않음·카드가 그 하루를 대신함
    var cards: [ScheduleCard.Model] = []          // 일정 답 카드(§9, 0.8.2): 시작 순 최대 3
    var cardsMore = 0                             // 카드로 못 보인 제안 수
    var link: String?                             // 링크·사진 턴(§9, 0.11.0): 상태 문구. nil = 질문 턴
    var linkDone = false
    var linkSaved = false                         // 큐에 넣었다 — 저장 범위 한 줄(메인 판정 MR1)을 보인다
    var seenItemID: String?                       // 이미 읽은 링크의 항목(§9, 0.11.4) — "일정 보기" → 항목 상세
  }

  @State private var input = ""
  @FocusState private var inputFocused: Bool           // 키보드가 탭 막대를 가리므로 스크롤·빈 곳 탭으로 내린다(키보드 툴바 "완료"는 가려져 0.7.1 에서 뺐다)
  @State private var turns: [Turn] = []
  @State private var busy = false
  @State private var showPhotos = false                // "+" → 사진에서 일정 읽기(§9 채팅 사진 첨부, 0.11.0)
  @State private var photoItems: [PhotosPickerItem] = []
  @State private var judged: [String: Bool] = [:]      // "<answer_id>|<item_id>" → ok
  @State private var judging: Set<String> = []         // 기록 요청 중인 키 — 연타가 도착 순서 경합을 만들지 않게 막는다
  @State private var judgeSheet: JudgeSheet.Model?     // 틀렸어요 시트: 인용 항목별 관련 있음/없음. 닫기만 하면 기록하지 않는다
  @State private var copied: String?                   // 방금 복사한 answer_id — 잠깐 체크 아이콘으로 바꾼다
  @State private var adds: [String: AddState] = [:]    // 제안 id → 캘린더 추가 진행·결과
  struct ScrollRequest: Equatable { let id: UUID; let seq: Int }
  @State private var scrollRequest: ScrollRequest?     // 보낼 때·답이 올 때 그 질문이 보이게(턴이 화면보다 길면 맨 위, 0.8.2 — 카드가 입력 패널·키보드 뒤에 깔리지 않게)
  @State private var confirm: ConfirmAdd?              // 겹침·비슷한 일정 확인창(§10): 저장 직전에 새로 나온 경우만(C2-5). 제안 id·handleAdd 필드·다시 읽은 일정으로 만든 문구
  struct ConfirmAdd: Identifiable { let id: String; let fields: [String: String]; var prompt = "" }
  @State private var dictation = SpeechDictation()     // 기기 안 받아쓰기(§9·§12)
  @Environment(\.scenePhase) private var scenePhase
  @Environment(\.colorScheme) private var scheme
  enum AddState { case running, finished(String), failed(String) }

  var body: some View {
    NavigationStack {
      ScrollViewReader { proxy in
        List {
          ForEach(turns) { t in
            Section {
              Text(t.question).font(.subheadline).foregroundStyle(.secondary).id(t.id)
              if let e = t.error { Text(e).foregroundStyle(.red) }
              if let l = t.link { linkRow(l, done: t.linkDone, saved: t.linkSaved, itemID: t.seenItemID) }
              else if let a = t.answer { answerRows(t, a) }
              else if t.error == nil { ProgressView() }
            }
          }
        }
        .scrollDismissesKeyboard(.interactively)
        .scrollBounceBehavior(.always)   // 대화가 비었거나 짧아 넘치지 않아도 끌려서 아래로 쓸면 키보드가 내려간다
        .simultaneousGesture(TapGesture().onEnded { inputFocused = false })   // 목록 탭은 행 버튼·링크를 막지 않고 포커스만 푼다
        .safeAreaInset(edge: .bottom) { inputPanel }
        .sheet(item: $judgeSheet) { m in JudgeSheet(model: m) { record(m.answerID, $0) } }
        .confirmationDialog(confirm?.prompt ?? "",
                            isPresented: Binding(get: { confirm != nil }, set: { if !$0 { confirm = nil } }),
                            titleVisibility: .visible, presenting: confirm) { c in
          Button("추가") { runAdd(c, confirmed: true) }
          Button("취소", role: .cancel) {}
        }
        .navigationTitle("채팅")
        .onAppear { dictation.onText = { input = $0 }; dictation.refresh() }
        .onDisappear { dictation.stopIfRecording() }
        // 백그라운드·전화로 비활성이 되면 녹음을 끊고, 돌아오면 권한을 다시 읽는다(설정에서 허용하고 온 경우).
        // 캘린더 절·카드도 다시 읽는다(설정에서 캘린더 권한·캘린더 앱에서 일정을 바꾸고 온 경우, Codex #6)
        .onChange(of: scenePhase) { _, p in if p == .active { dictation.refresh(); refreshCalendars() } else { dictation.stopIfRecording() } }
        // 새 행이 목록에 놓인 다음 턴에 스크롤한다 — 같은 갱신에서 부르면 옛 높이로 계산돼 카드가 패널 뒤에 남을 수 있다
        .onChange(of: scrollRequest) { _, r in
          guard let r else { return }
          Task { @MainActor in withAnimation { proxy.scrollTo(r.id, anchor: .top) } }
        }
      }
    }
  }

  private func scroll(to id: UUID) { scrollRequest = ScrollRequest(id: id, seq: (scrollRequest?.seq ?? 0) + 1) }

  private var canSend: Bool { !busy && !input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

  /// 입력창(0.6.0): 둥근 리퀴드 글래스 패널 — 위 여러 줄 입력, 아래 "+"(2단계 첨부)·마이크·보내기
  private var inputPanel: some View {
    VStack(alignment: .leading, spacing: 10) {
      TextField("질문하기", text: $input, axis: .vertical).lineLimit(1...5).focused($inputFocused)
        // 하드웨어 키보드 Return(0.8.3): 보내기, Shift+Return 줄바꿈, 한글 조합 중이면 확정만. onKeyPress 는 하드웨어 키만 받아 화면 키보드는 그대로다.
        // 처리하지 않으면 세로 TextField 가 편집을 끝내 커서만 사라졌다(0.8.2 실기기)
        .onKeyPress(.return, phases: .down) { press in
          switch ChatInput.onReturn(shift: press.modifiers.contains(.shift), composing: TextInputBridge.isComposing, canSend: canSend) {
          case .commit: TextInputBridge.commit()
          case .newline: TextInputBridge.insertNewline()
          case .send: send(keepFocus: true)              // 하드웨어 키보드면 화면 키보드가 없어 포커스를 남겨 이어 묻게 한다
          case .ignore: break
          }
          return .handled
        }
        .padding(.horizontal, 6).padding(.top, 4)
      if let n = dictation.state.notice { Text(n).font(.caption2).foregroundStyle(.secondary).padding(.horizontal, 6) }
      HStack(spacing: 10) {
        Menu {
          Button { showPhotos = true } label: { Label("사진에서 일정 읽기", systemImage: "photo") }   // 기기 OCR 글만(§9, 0.11.0)
          Button("파일 첨부 (2단계 예정)") {}.disabled(true)                                          // 파일 업로드는 스펙 §15 2단계
        } label: { roundIcon("plus", fill: Color(.secondarySystemFill), tint: Color.primary) }
        .buttonStyle(.plain)
        .disabled(busy)
        .accessibilityLabel("첨부")
        .photosPicker(isPresented: $showPhotos, selection: $photoItems, maxSelectionCount: ImageText.maxImages, matching: .images)
        .onChange(of: photoItems) { _, items in
          guard !items.isEmpty else { return }
          sendImages(items)
          photoItems = []
        }
        Spacer()
        Button { Task { await dictation.toggle(currentText: input) } } label: {
          dictation.recording ? roundIcon("waveform", fill: .red, tint: .white) : roundIcon("mic", fill: Color(.secondarySystemFill), tint: Color.primary)
        }
        .buttonStyle(.plain)
        .disabled(!dictation.available).opacity(dictation.available ? 1 : 0.4)
        .accessibilityLabel(dictation.recording ? "받아쓰기 멈춤" : "음성으로 입력")
        // 라이트 검정 원·흰 화살표, 다크 흰 원·검정 화살표. plain 스타일로 강조색(tint)을 막고, 글래스 안에서 primary 채움이
        // 비브런시로 옅은 회색이 되므로(시뮬레이터 스크린샷 확인) 모드별 검정·흰색을 직접 쓴다
        Button { send() } label: {
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
    // 스펙 §9 채팅 → 보관함 보기: 인용 ∪ 구별 facts ∪ 관련도 컷(서버 S1). 거절 답변·후보 없음이면 숨긴다(0.7.1)
    if let ids = a.archiveIDs {
      let scope = Archive.Scope(question: t.question, ids: ids)
      Button("보관함에서 보기 (\(scope.ids.count)건)") { ArchiveRouter.shared.open(scope) }
        .font(.caption).buttonStyle(.borderless)
    }
    // 일정 답 카드(§9, 0.8.2): 찾은 곳 → 그날 내 캘린더 → 상태·버튼. 일정 기간이 카드 하루보다 넓을 때만 아래 "기기 캘린더" 절도 그린다.
    // 전체 접근이 없으면 카드가 안내를 대신 들고, 절의 안내는 카드가 없을 때만
    ForEach(Array(t.cards.enumerated()), id: \.element.pid) { pair in cardRows(t, pair.element, first: pair.offset == 0) }
    if t.cardsMore > 0 { Text(ScheduleCard.moreText(t.cardsMore)).font(.caption2).foregroundStyle(.secondary) }
    if a.schedule != nil, t.cards.isEmpty || t.calendar != nil { calendarRows(t, a) }
    feedbackBar(a)
  }

  /// 답 맨 아래 텍스트 버튼 막대(§9, 0.9.0 — 0.8.3 아이콘 막대를 대신한다): 맞아요 · 틀렸어요 · 복사. 거절(인용 없음)이면 복사만.
  /// 맞아요 = 인용 항목 전부 관련 있음, 틀렸어요 = 항목별 시트. 다시 누르면 바꾼다(merge-duplicates).
  /// 캡슐은 라벨로 그리고 스타일은 borderless 로 둔다 — List 행 탭이 아니라 버튼 자기 탭으로 한 번에 눌린다
  private func feedbackBar(_ a: ChatReply.Answer) -> some View {
    let items = a.citations.map(\.item_id)
    let verdict = ChatFeedback.verdict(answer: a.answer_id, items: items, judged: judged)
    let busy = items.contains { judging.contains(ChatFeedback.key(answer: a.answer_id, item: $0)) }
    return HStack(spacing: 6) {
      if ChatFeedback.showsJudge(citationCount: items.count) {
        barButton("맞아요", on: verdict == .up, label: "맞아요, 근거 전부 관련 있음") {
          record(a.answer_id, ChatFeedback.upMarks(items: items))
        }
        .disabled(busy)
        barButton("틀렸어요", on: verdict == .down, label: "틀렸어요, 근거 항목별 평가") {
          judgeSheet = JudgeSheet.Model(answerID: a.answer_id, citations: a.citations,
                                        marks: ChatFeedback.sheetDefaults(answer: a.answer_id, items: items, judged: judged))
        }
        .disabled(busy)
      }
      barButton(copied == a.answer_id ? "복사됨" : "복사", on: false, label: "답 복사") {
        UIPasteboard.general.string = a.answer
        copied = a.answer_id
        Task { try? await Task.sleep(for: .seconds(1.5)); if copied == a.answer_id { copied = nil } }
      }
      Spacer()
    }
  }

  /// 작은 테두리 캡슐. 고른 쪽은 강조색으로 채운다
  private func barButton(_ title: String, on: Bool, label: String, action: @escaping () -> Void) -> some View {
    Button(action: action) {
      Text(title).font(.caption)
        .foregroundStyle(on ? Color.white : Color.secondary)
        .padding(.horizontal, 10).padding(.vertical, 4)
        .background(Capsule().fill(on ? Color.accentColor : Color.clear))
        .overlay(Capsule().strokeBorder(on ? Color.accentColor : Color.secondary.opacity(0.5), lineWidth: 1))
        .contentShape(Capsule())
    }
    .buttonStyle(.borderless)
    .accessibilityLabel(label)
    .accessibilityAddTraits(on ? .isSelected : [])
  }

  /// "기기 캘린더" 절(§9 일정 질문과 기기 캘린더). 전체 접근이 없으면(추가만 허용 포함) 절 대신 안내 한 줄 — 허용하면 이 턴을 다시 읽는다
  @ViewBuilder private func calendarRows(_ t: Turn, _ a: ChatReply.Answer) -> some View {
    if !CalendarLookup.fullAccess {
      CalendarAccessPrompt(message: DeviceCalendar.accessText) { recheck(t.id) }
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

  /// 기기 캘린더(§9·§12 통제 2): 일정 답 카드(그날 일정·등록 판정)와 넓은 기간의 "기기 캘린더" 절을 기기 안에서만 읽어 턴에 둔다.
  /// 서버로 보내지 않는다. 전체 접근이 없으면 카드는 줄·상태 없이(안내 자리), 절은 지운다. 진단 로그에는 개수만
  private func readCalendar(_ idx: Int, _ a: ChatReply.Answer) {
    let range = a.schedule?.interval
    let picked = ScheduleCard.pick(a.proposals, schedule: range)
    let ex = try? Executions.shared()                     // 카드마다 SQLite 를 새로 열지 않는다(활성화마다 최대 5턴 × 3장)
    turns[idx].cards = picked.cards.map { ScheduleCard.model($0, events: CalendarLookup.cardEvents(day: $0.day), executed: executed(ex, $0.proposal.id)) }
    turns[idx].cardsMore = picked.more
    // 기간 종류는 진단 로그에도 남긴다(T3 G5 가 분기를 가른다) — 일정 내용은 아니다
    let sched = range == nil ? "none" : ScheduleCard.showsRangeSection(schedule: range, cardDays: picked.cards.map(\.day)) ? "wide" : "day"
    let wide = CalendarLookup.fullAccess && sched == "wide"
    turns[idx].calendar = wide ? range.map { CalendarLookup.scheduleEvents($0) } : nil
    if !picked.cards.isEmpty { DiagLog.append("CAL card n=\(picked.cards.count) more=\(picked.more) access=\(CalendarLookup.fullAccess ? 1 : 0) sched=\(sched)") }
  }

  /// 앱 활성화(설정에서 권한을 바꾸고 돌아옴·캘린더 앱에서 일정을 바꿈)·카드 추가 성공 뒤(Codex #6): 마지막 5개 턴만 다시 읽는다(EventKit 조회 비용).
  /// 전체 접근이 없으면 조회가 없으므로 모든 턴에서 캘린더 줄·상태·버튼을 걷는다. EventKit 변경 알림은 구독하지 않는다
  private func refreshCalendars() {
    let idx = CalendarLookup.fullAccess ? Array(turns.indices.suffix(5)) : Array(turns.indices)
    for i in idx { if let a = turns[i].answer { readCalendar(i, a) } }
  }

  /// 권한 안내에서 허용·거부한 뒤 다시 읽는다(권한 상태는 관찰되지 않는다 — 다시 그려 "설정에서 허용하기"로 바뀌게).
  /// 마지막 5개 턴과 같이 그 턴도 — 5개 밖이어도 안내를 누른 턴은 바로 바뀐다
  private func recheck(_ id: UUID) {
    refreshCalendars()
    if let i = turns.firstIndex(where: { $0.id == id }), i < turns.count - 5, let a = turns[i].answer { readCalendar(i, a) }
  }

  /// 이 기기에서 넣은 적 있는 제안(§10 실행 기록). 등록 판정의 보조 근거 — 캘린더에서 지웠으면 "이전에 추가한 일정"
  private func executed(_ ex: Executions?, _ pid: String) -> Bool {
    (try? ex?.existing(proposalId: pid)) != nil
  }

  /// 일정 답 카드(§9, 0.8.2) 한 장 = 같은 Section 의 행 셋. 행마다 탭 경로가 하나다 — ① 출처 행은 원문 링크, ② 캘린더 줄은 탭 없음,
  /// ③ 버튼은 스타일을 명시해 행 탭이 아니라 자기 제스처로 눌린다(0.8.1 실기기: 스타일 없는 카드 버튼이 텍스트처럼 보이고 눌리지 않았다)
  @ViewBuilder private func cardRows(_ t: Turn, _ c: ScheduleCard.Model, first: Bool) -> some View {
    let cite = t.answer?.citations.first(where: { $0.item_id == c.itemID })
    // 권한은 그릴 때 다시 본다 — 턴에 남은 캘린더 줄·상태가 권한 철회 뒤에도 보이지 않게, 허용 뒤 낡은 안내가 남지 않게(권한 상태는 관찰되지 않는다)
    let access = CalendarLookup.fullAccess
    NavigationLink {
      ItemDetailView(itemID: c.itemID)
    } label: {
      VStack(alignment: .leading, spacing: 2) {
        Text(ScheduleCard.sourceLine(cite)).font(.caption).bold()
        Text(ScheduleCard.whenLine(c)).font(.subheadline)
        Text([ScheduleCard.receivedLine(cite), "원문 보기"].compactMap { $0 }.joined(separator: " · "))
          .font(.caption2).foregroundStyle(.secondary)
      }
    }
    if access, let lines = c.lines {
      VStack(alignment: .leading, spacing: 2) {
        Text(ScheduleCard.dayHeader(c.day)).font(.caption).bold()
        if lines.isEmpty { Text(ScheduleCard.emptyDayText).font(.caption2).foregroundStyle(.secondary) }
        ForEach(Array(lines.enumerated()), id: \.offset) {
          Text($0.element.text).font(.caption2).foregroundStyle($0.element.conflict ? Color.orange : Color.primary)
        }
        if c.moreLines > 0 { Text("외 \(c.moreLines)건").font(.caption2).foregroundStyle(.secondary) }
      }
    } else if !access, first {
      CalendarAccessPrompt(message: DeviceCalendar.accessText) { recheck(t.id) }
    }
    statusRow(c, access: access)
  }

  /// ③ 상태 줄 + 버튼(§9 상태 1~6·§10). 버튼은 "아직 캘린더에 없음"(캘린더에 추가, 강조 채움)·겹침(겹쳐도 추가, 주황 테두리 — 확인창 없이 저장)·
  /// 비슷한 일정(그래도 추가, 테두리 — 확인창 없이 저장, 0.9.2)일 때만.
  /// 결과 문구는 실패이거나 버튼이 남아 있을 때만 — 성공하면 재조회로 상태가 "✅ 캘린더에 등록됨"으로 바뀌어 같은 말을 두 번 하지 않는다
  @ViewBuilder private func statusRow(_ c: ScheduleCard.Model, access: Bool) -> some View {
    let state = adds[c.pid], action = access ? ScheduleCard.action(c) : nil
    let line = access || c.status == nil ? ScheduleCard.statusText(c) : nil      // 권한이 없으면 캘린더 대조 상태는 숨기고 종류 문구(확인 필요·지난 일정)만
    if line != nil || action != nil || state != nil {
      VStack(alignment: .leading, spacing: 6) {
        if let line { Text(line).font(.caption).foregroundStyle(ScheduleCard.isWarning(c) ? Color.orange : Color.secondary) }
        if let action {
          switch action {
          case .add: addButton(c, action, state).buttonStyle(.borderedProminent)
          case .addAnyway: addButton(c, action, state).buttonStyle(.bordered).tint(.orange)
          case .addSimilar: addButton(c, action, state).buttonStyle(.bordered)
          }
        }
        switch state {
        case .failed(let m)?: Text(m).font(.caption).foregroundStyle(.red)
        case .finished(let m)? where action != nil: Text(m).font(.caption).foregroundStyle(.secondary)
        default: EmptyView()
        }
      }
    }
  }

  private func addButton(_ c: ScheduleCard.Model, _ action: ScheduleCard.Action, _ state: AddState?) -> some View {
    Button(state.isRunning ? "추가하는 중…" : ScheduleCard.buttonTitle(action, allDay: !c.timed)) {   // 날짜만 = "종일 일정으로 추가"(0.9.1)
      runAdd(ConfirmAdd(id: c.pid, fields: ScheduleCard.addFields(c)), confirmed: ScheduleCard.confirms(action))
    }
    .font(.subheadline)
    .disabled(state.isRunning || state.isFinished)
    .accessibilityIdentifier("scheduleCard.add")
  }

  /// 알림 액션과 같은 §10 경로(서버 상태 확인 → 표식 조회 → 겹침·비슷한 일정 → 저장 → 보고). 미리 판정 없이 불렀는데 겹침·비슷한 일정이면
  /// 저장하지 않고 돌아오므로 그 일정을 다시 읽어 확인창을 띄우고, "추가"면 confirmed 로 다시 부른다. 결과를 카드에 쓰고, 실패면 버튼을 다시 켠다
  private func runAdd(_ c: ConfirmAdd, confirmed: Bool) {
    adds[c.id] = .running
    Task {
      let outcome = await NotificationActions.handleAdd(fields: c.fields, confirmed: confirmed)
      if ProposalFlow.needsConfirm(confirmed: confirmed, outcome: outcome) {
        adds[c.id] = nil
        let timing = c.fields["start"].flatMap { ProposalTiming.parse(start: $0, end: c.fields["end"]) }
        var prompt = ProposalFlow.confirmTitle([])
        if let timing {
          prompt = ProposalFlow.similarCount(outcome) != nil
            ? ProposalFlow.similarConfirmTitle(CalendarLookup.similar(pid: c.id, title: c.fields["title"] ?? "", timing: timing))
            : ProposalFlow.confirmTitle(CalendarLookup.conflicts(pid: c.id, timing: timing))
        }
        confirm = ConfirmAdd(id: c.id, fields: c.fields, prompt: prompt)
        refreshCalendars()
        return
      }
      let fb = ChatReply.addFeedback(outcome)
      adds[c.id] = fb.retry ? .failed(fb.text) : .finished(fb.text)
      if !fb.retry { refreshCalendars() }                       // 추가 뒤 카드 상태가 "✅ 캘린더에 등록됨"으로·절이 바로 바뀐다(Codex #6)
    }
  }

  /// 인용 항목별 판정 기록(eval_judgments, 0018). 항목마다 요청하고, 실패한 항목만 표시를 되돌린다
  private func record(_ answer: String, _ marks: [String: Bool]) {
    for (item, ok) in marks {
      let key = ChatFeedback.key(answer: answer, item: item)
      guard !judging.contains(key) else { continue }
      let before = judged[key]
      judged[key] = ok
      judging.insert(key)
      Task {
        defer { judging.remove(key) }
        // 같은 인용을 다시 고르면 바꾼다(unique user_id·question_id·item_id, merge-duplicates). 실패하면 표시를 되돌린다
        let r = await API.send("rest/v1/eval_judgments?on_conflict=user_id,question_id,item_id", method: "POST",
                               json: ["question_id": answer, "item_id": item, "ok": ok],
                               headers: ["Prefer": "resolution=merge-duplicates,return=minimal"])
        if !(200..<300).contains(r?.status ?? -1) { judged[key] = before }
      }
    }
  }

  private func send(keepFocus: Bool = false) {
    let q = input.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !q.isEmpty, !busy else { return }
    dictation.stopIfRecording()
    // 링크 붙여넣기(§9, 0.11.0): http(s) 주소 하나 + 짧은 메모면 질문이 아니라 링크 수집 — /chat 을 부르지 않는다. 둘 이상이면 안내(입력은 남긴다).
    // 긴 글·날짜 있는 글 + 주소는 지금처럼 질문(LinkText.linkCandidate)
    switch LinkText.chatIntent(q) {
    case .link(let url, let note): sendLink(q, url: url, note: note, keepFocus: keepFocus); return
    case .tooMany: turns.append(Turn(question: q, error: LinkCaptureText.tooMany)); return
    case .none: break
    }
    // 서버 한도(⑧b bad_question). 넘으면 입력을 지우지 않고 고칠 수 있게 둔다
    guard q.utf16.count <= 500 else { turns.append(Turn(question: q, error: ChatReply.errorMessage(status: 400))); return }
    input = ""
    if !keepFocus { inputFocused = false }                 // 보내면 키보드를 내린다(답·카드가 키보드 뒤에 깔리지 않게, 0.8.2). 하드웨어 Return 은 남긴다
    turns.append(Turn(question: q))
    let idx = turns.count - 1
    scroll(to: turns[idx].id)
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
          if let a = ChatReply.decode(r.data) { turns[idx].answer = a; readCalendar(idx, a); scroll(to: turns[idx].id) } else { turns[idx].error = "응답을 읽지 못했습니다" }
        } else {
          turns[idx].error = ChatReply.errorMessage(status: r.status)
        }
        return
      }
    }
  }

  /// 링크 수집 턴(§9): 읽기(15초 + OCR) 동안만 보내기를 막고, 서버 결과(최대 60초)는 따로 기다린다
  private func sendLink(_ q: String, url: URL, note: String?, keepFocus: Bool) {
    input = ""
    if !keepFocus { inputFocused = false }
    var t = Turn(question: q)
    t.link = LinkCaptureText.reading
    turns.append(t)
    let idx = turns.count - 1
    scroll(to: turns[idx].id)
    busy = true
    Task {
      let read = await LinkCapture.shared.chatRead(url: url, note: note)
      turns[idx].link = read.text
      busy = false
      // 이미 읽은 링크: 그 항목을 찾으면 문구를 줄이고 "일정 보기"(다시 추가는 항목 상세, §10 0.11.4). 못 찾으면 보관함 안내 문구 그대로
      if let seen = read.seenCaptureID {
        if let item = await LinkCapture.shared.itemID(captureID: seen) { turns[idx].seenItemID = item; turns[idx].link = LinkCaptureText.duplicateFound }
        turns[idx].linkDone = true; return
      }
      guard let id = read.captureID else { turns[idx].linkDone = true; return }
      turns[idx].linkSaved = true
      turns[idx].link = await LinkCapture.shared.chatResult(captureID: id, subject: .page)
      turns[idx].linkDone = true
    }
  }

  /// 사진 턴(§9 채팅 사진 첨부): 입력창 글은 메모. OCR·업로드 동안 보내기를 막고, 서버 결과(최대 60초)는 따로 기다린다
  private func sendImages(_ items: [PhotosPickerItem]) {
    guard !busy else { return }                              // 피커를 연 사이 다른 턴이 시작됐으면 겹치지 않게(L5 리뷰 Minor 5)
    let note = input.trimmingCharacters(in: .whitespacesAndNewlines)
    input = ""
    inputFocused = false
    let n = min(items.count, ImageText.maxImages)
    var t = Turn(question: note.isEmpty ? "사진 \(n)장" : "사진 \(n)장 · \(note)")
    t.link = LinkCaptureText.imageReading
    turns.append(t)
    let idx = turns.count - 1
    scroll(to: turns[idx].id)
    busy = true
    Task {
      let read = await LinkCapture.shared.chatImages(Array(items.prefix(n)), note: note.isEmpty ? nil : note)
      turns[idx].link = read.text
      busy = false
      guard let id = read.captureID else { turns[idx].linkDone = true; return }
      turns[idx].linkSaved = true
      turns[idx].link = await LinkCapture.shared.chatResult(captureID: id, subject: .image)
      turns[idx].linkDone = true
    }
  }

  /// 링크·사진 턴(§9): 상태 문구 + (큐에 넣었으면) 저장 범위 한 줄 — 일정 카드·보관함 버튼·맞아요 막대 없음(제안은 "제안" 탭·알림).
  /// 이미 읽은 링크의 항목을 찾았으면 다음 행 "일정 보기" → 항목 상세(일정 절에서 다시 추가, 0.11.4). 행 하나에 탭 경로 하나(카드 출처 행과 같은 NavigationLink)
  @ViewBuilder private func linkRow(_ text: String, done: Bool, saved: Bool, itemID: String?) -> some View {
    VStack(alignment: .leading, spacing: 4) {
      HStack(alignment: .firstTextBaseline, spacing: 8) {
        if !done { ProgressView() }
        Text(text).accessibilityIdentifier("chat-link-status")
      }
      if saved {
        Text(LinkCaptureText.storageNote).font(.caption2).foregroundStyle(.secondary).accessibilityIdentifier("chat-link-note")
      }
    }
    if let itemID {
      NavigationLink { ItemDetailView(itemID: itemID) } label: { Text(LinkCaptureText.showEvents).font(.subheadline) }
        .accessibilityIdentifier("chat-link-show-events")
    }
  }
}

/// 틀렸어요 시트(§9, 0.8.3 · 0.9.0 이름): 인용 항목마다 제목·출처·시각·원문 보기와 "관련 있음" 토글. 저장할 때만 항목별로 기록하고, 닫기만 하면 아무것도 기록하지 않는다
struct JudgeSheet: View {
  struct Model: Identifiable { var id: String { answerID }; let answerID: String; let citations: [ChatReply.Citation]; var marks: [String: Bool] }
  @State var model: Model
  let onSave: ([String: Bool]) -> Void
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    NavigationStack {
      List {
        ForEach(model.citations) { c in
          Section {
            NavigationLink {
              ItemDetailView(itemID: c.item_id)
            } label: {
              VStack(alignment: .leading, spacing: 2) {
                Text(c.title ?? "(제목 없음)").font(.subheadline)
                Text("\(SourceLabel.label(source: c.source, appName: c.app_name)) · \(ChatReply.seoulLabel(c.occurred_at))\(c.expired ? " · 원문 만료됨" : "") · 원문 보기")
                  .font(.caption2).foregroundStyle(.secondary)
              }
            }
            Toggle("관련 있음", isOn: Binding(get: { model.marks[c.item_id] ?? false }, set: { model.marks[c.item_id] = $0 }))
          }
        }
      }
      .navigationTitle("근거 평가").navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("닫기") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) { Button("저장") { onSave(model.marks); dismiss() } }
      }
    }
  }
}

private extension Optional where Wrapped == ChatView.AddState {
  var isRunning: Bool { if case .running? = self { return true }; return false }
  var isFinished: Bool { if case .finished? = self { return true }; return false }
}
