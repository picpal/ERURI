import SwiftUI
import EruriCore
import PhotosUI

/// 채팅(스펙 §9): 질문 → 답변 + 인용 항목의 제안 카드(Ruling 8) + 답 맨 아래 텍스트 버튼 막대(맞아요·틀렸어요·복사 — eval_judgments, §9 평가 절차 4, 0.9.0)
/// + 일정 질문이면 "기기 캘린더" 절(§9 일정 질문과 기기 캘린더 — 기기 안에서만 읽는다)
struct ChatView: View {
  /// 화면 턴 = 저장 기록(ChatHistory.Record, 스펙 §9 "대화 기록·짧은 맥락") + 다시 계산하는 것(답 해석·카드·기기 캘린더 — 저장하지 않는다)
  struct Turn: Identifiable {
    var record: ChatHistory.Record
    var id: UUID { record.id }
    var answer: ChatReply.Answer?                 // record.reply 해석
    var calendar: [ProposalFlow.CalendarEvent]?   // "기기 캘린더" 절(§9): 일정 기간의 기기 일정. nil = 일정 질문 아님·읽지 않음·카드가 그 하루를 대신함
    var cards: [ScheduleCard.Model] = []          // 일정 답 카드(§9, 0.8.2): 시작 순 최대 3
    var cardsMore = 0                             // 카드로 못 보인 제안 수
    var cardsRead = false                         // 카드·절을 읽었다 — 복원한 턴은 화면에 나올 때 읽는다(F8)
    var addProposals: [ChatReply.Proposal]?     // 일정 등록 턴: 항목의 제안(서버에서 다시 읽음 — 저장하지 않는다, D8)
    var cardsLoading = false                    // 일정 등록 턴의 제안 읽는 중(같은 턴을 두 번 읽지 않게)
    var facts: [FactVersions]?                  // 0.16.0: 등록·고치기 턴 = 그 fact 버전, 질문 턴 = 답 카드 update_event 의 fact 버전(계보·update_event 상태 — 저장하지 않는다)
    var entries: [CardEntry] = []               // 등록·고치기 턴의 카드 순서(fact 순)·답 카드의 고친 일정: 일정 답 카드 행 또는 고친 일정 상태
    var asks: [String: AskBack.Question] = [:]  // 되묻기(채팅 등록·고치기 카드만, C — 그리기는 P6b) — 키 = 제안 id
    var briefing: Briefing.Model?   // 여러 날 일정 질문의 기간 브리핑(§9, 0.16.0) — 저장하지 않는다
    init(record: ChatHistory.Record) { self.record = record; answer = record.reply.flatMap(ChatReply.decode) }
  }
  /// 등록·고치기 턴·답 카드의 카드 하나(K27): add 상태는 기존 일정 답 카드 행, 나머지는 EditCardView. itemID = 출처 줄(답 카드는 그 항목의 인용)
  enum CardEntry {
    case card(ScheduleCard.Model, ProposalVersion)
    case edit(ProposalVersion, EditFlow.CardState, itemID: String, header: String?, lines: [ScheduleCard.DayLine])
  }
  enum EditState { case running, failed(String) }

  @State private var input = ""
  @FocusState private var inputFocused: Bool           // 키보드가 탭 막대를 가리므로 스크롤·빈 곳 탭으로 내린다(키보드 툴바 "완료"는 가려져 0.7.1 에서 뺐다)
  @State private var turns: [Turn] = []
  @State private var loaded = false                    // 대화 기록을 불러왔다(탭을 오가도 @State 가 남는다). 못 읽었으면 false 로 남아 저장·30일 정리·맥락 전송을 하지 않고 다음 표시·활성화 때 다시 읽는다
  @State private var seenClear: Int?                   // 화면이 마지막으로 반영한 log.clearCount. nil = 아직 표시 전(그때 화면 턴은 없다)
  private var log: ChatLog { ChatLog.shared }
  @State var busy = false
  @State private var showPhotos = false                // "+" → 사진에서 일정 읽기(§9 채팅 사진 첨부, 0.11.0)
  @State private var photoItems: [PhotosPickerItem] = []
  @State private var judged: [String: Bool] = [:]      // "<answer_id>|<item_id>" → ok
  @State private var judging: Set<String> = []         // 기록 요청 중인 키 — 연타가 도착 순서 경합을 만들지 않게 막는다
  @State private var judgeSheet: JudgeSheet.Model?     // 틀렸어요 시트: 인용 항목별 관련 있음/없음. 닫기만 하면 기록하지 않는다
  @State private var copied: String?                   // 방금 복사한 answer_id — 잠깐 체크 아이콘으로 바꾼다
  @State var adds: [String: AddState] = [:]    // 제안 id → 캘린더 추가 진행·결과
  struct ScrollRequest: Equatable { let id: UUID; let seq: Int }
  @State private var scrollRequest: ScrollRequest?     // 보낼 때·답이 올 때 그 질문이 보이게(턴이 화면보다 길면 맨 위, 0.8.2 — 카드가 입력 패널·키보드 뒤에 깔리지 않게)
  @State private var confirm: ConfirmAdd?              // 겹침·비슷한 일정 확인창(§10): 저장 직전에 새로 나온 경우만(C2-5). 제안 id·handleAdd 필드·다시 읽은 일정으로 만든 문구
  struct ConfirmAdd: Identifiable { let id: String; let fields: [String: String]; var prompt = ""
    var checkLineage = true                     // false = 삭제 확인된 update_event 의 [캘린더에 추가](§10 — 계보 확인 없음, 0.16.0)
    var readd = false }                         // 바꾼 뒤 지운 일정(succeeded update_event)의 [캘린더에 추가](K11 — 로컬 실행 기록이 있어도 새 일정)
  @State private var openItem: String?                  // "일정 보기"(이미 읽은 링크, 0.11.4) → 항목 상세
  @State private var mailPolling: Set<UUID> = []       // 상태를 읽는 중인 메일 정리 턴(같은 턴을 두 Task 가 읽지 않게, 0.14.0)
  @State private var mailRequesting: Set<UUID> = []    // 실행·되돌리기·다시 미리보기 요청 중인 턴 — 재개(onAppear·활성화)가 끼어들지 않게(D22)
  @State private var mailNexted: Set<UUID> = []        // [다음 1,000건 보기]를 이미 누른 턴 — 연타로 새 턴이 둘 생기지 않게(저장하지 않는다)
  @State var edits: [String: EditState] = [:]  // 제안 id → [캘린더도 바꾸기]·되묻기 진행·실패(0.16.0)
  @State private var dictation = SpeechDictation()     // 기기 안 받아쓰기(§9·§12)
  @Environment(\.scenePhase) private var scenePhase
  @Environment(\.colorScheme) private var scheme
  enum AddState { case running, finished(String), failed(String) }

  var body: some View {
    NavigationStack {
      ScrollViewReader { proxy in
        List {
          // 안내 문구(스펙 §9·§12 통제 5, 후보 B): ② 기록 맨 위 한 줄 — 위로 다 쓸어 올리면 보인다
          if !turns.isEmpty {
            Text(ChatHistoryText.topNote).font(.caption2).foregroundStyle(.secondary)
              .frame(maxWidth: .infinity).listRowBackground(Color.clear)
              .accessibilityIdentifier("chat-top-note")
          }
          ForEach(Array(turns.enumerated()), id: \.element.id) { pair in
            let i = pair.offset, t = pair.element                  // 기존 카드 ForEach 와 같은 pair 형식
            Section {
              Text(t.record.question).font(.subheadline).foregroundStyle(.secondary).id(t.id).accessibilityIdentifier("chat-question")
                .onAppear {                                                  // 복원한 턴의 카드는 화면에 나올 때(F8). Section 이 아니라 행에 단다
                  if !t.cardsRead, t.record.kind == .editEvent { if t.facts != nil { readCalendar(t.id) } else { loadEditCard(t.id) } }
                  else if !t.cardsRead, t.answer != nil { readCalendar(t.id) }
                  else if !t.cardsRead, t.record.kind == .addEvent, t.record.itemID != nil {
                    if t.addProposals != nil { readCalendar(t.id) } else { loadAddEventCards(t.id) }
                  }
                }
              if let e = t.record.error { Text(e).foregroundStyle(.red) }
              if t.record.kind == .editEvent, let a = t.answer {           // 일정 고치기 턴(§9 B 앱, 0.16.0) — 답이 아니라 막대·보관함 버튼 없음
                editRows(t, a)
              } else if t.record.kind == .mailSummary {                   // 메일 요약 턴(§9, 0.15.0): 카드 하나. 다시 보내지 않는다(읽기는 비용) — 복원은 ChatHistory.restored
                MailSummaryCard(turn: t.record.mailRead ?? MailSummaryTurn(phase: .ended, note: MailSummaryText.failed),
                                onPick: { pickSummary(t.id, $0) }, onResearch: { researchSummary(t.id) }, onSettings: { SettingsRouter.shared.open() })
              } else if t.record.kind == .mailAction {             // 메일 정리 턴(§9, 0.14.0): 카드 하나. 상태를 다시 읽어야 하는 턴은 나올 때 서버를 먼저 읽는다
                MailCleanupCard(turn: t.record.mail ?? MailTurn(phase: .ended, note: MailCleanupText.failed),
                                onExecute: { executeMail(t.id) }, onCancel: { cancelMail(t.id) }, onUndo: { undoMail(t.id) },
                                onRepreview: { repreviewMail(t.id) }, onNext: { nextMail(t.id) }, onSettings: { SettingsRouter.shared.open() })
                  .onAppear { resumeMail(t.id) }
              } else if let l = t.record.link {
                linkRow(l, done: t.record.linkDone, saved: t.record.linkSaved, itemID: t.record.seenItemID)
                if t.record.kind == .addEvent { addEventRows(t) }           // 채팅 일정 카드(§9) — 답이 아니라 막대·보관함 버튼 없음
              }
              else if let a = t.answer { answerRows(t, a) }
              else if t.record.error == nil { ProgressView() }
            } header: {
              // ③ 맥락 끊김 구분선: 앞 턴과 30분 넘게 떨어졌다(이 턴부터 앞 대화를 맥락으로 보내지 않았다)
              if ChatHistory.isBreak(previous: i > 0 ? turns[i - 1].record.at : nil, current: t.record.at) {
                Text(ChatHistoryText.newConversation).font(.caption2).foregroundStyle(.secondary)
                  .frame(maxWidth: .infinity).accessibilityIdentifier("chat-new-conversation")
              }
            }
          }
        }
        .overlay {
          // ① 빈 화면 안내 — 목록 탭(키보드 내림)을 막지 않는다
          if loaded && turns.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
              ForEach(ChatHistoryText.emptyLines, id: \.self) { Text($0) }
            }
            .font(.footnote).foregroundStyle(.secondary).padding(.horizontal, 32)
            .allowsHitTesting(false)
            .accessibilityElement(children: .combine).accessibilityIdentifier("chat-empty-notice")
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
          Button("추가") { runAdd(c, confirmed: true, priors: priors(for: c.id)) }
          Button("취소", role: .cancel) {}
        }
        .navigationTitle("채팅")
        .navigationDestination(item: $openItem) { ItemDetailView(itemID: $0) }
        // 다시 나올 때(다른 탭·항목 상세에서 돌아옴 — scenePhase 는 그대로)는 카드·제안을 다시 읽는다(§10 "다음에 화면에 나올 때", 최종 리뷰 Minor 1).
        // 첫 표시는 행 onAppear 가 읽는다
        .onAppear { let back = loaded; dictation.onText = { input = $0 }; dictation.refresh(); syncClear(); loadHistory(); if back { refreshCalendars(); resumeMailTurns() } }
        .onDisappear { dictation.stopIfRecording() }
        // 설정·로그아웃·계정 삭제·삭제 푸시에서 지웠다(D7) — 화면도 바로 비운다. 지운 뒤에는 빈 기록을 불러온 것과 같다
        .onChange(of: log.clearCount) { _, _ in syncClear() }
        // 백그라운드·전화로 비활성이 되면 녹음을 끊고, 돌아오면 권한을 다시 읽는다(설정에서 허용하고 온 경우).
        // 캘린더 절·카드도 다시 읽는다(설정에서 캘린더 권한·캘린더 앱에서 일정을 바꾸고 온 경우, Codex #6).
        // 기록: 불러왔으면 30일 지난 턴을 빼고(D7), 못 불러왔으면(잠금 중 보호 파일) 다시 불러온다
        .onChange(of: scenePhase) { _, p in
          if p == .active { dictation.refresh(); syncClear(); if loaded { pruneExpired() } else { loadHistory() }; refreshCalendars(); resumeMailTurns() } else { dictation.stopIfRecording() }
        }
        // 새 행이 목록에 놓인 다음 턴에 스크롤한다 — 같은 갱신에서 부르면 옛 높이로 계산돼 카드가 패널 뒤에 남을 수 있다
        .onChange(of: scrollRequest) { _, r in
          guard let r else { return }
          Task { @MainActor in withAnimation { proxy.scrollTo(r.id, anchor: .top) } }
        }
      }
    }
  }

  private func scroll(to id: UUID) { scrollRequest = ScrollRequest(id: id, seq: (scrollRequest?.seq ?? 0) + 1) }

  /// 지우기(ChatLog.clearCount)를 화면에 반영한다: 바뀌었으면 화면 상태를 비운다(지운 뒤에는 빈 기록을 불러온 것과 같다).
  /// onChange 만이 아니라 불러오기·활성화·턴 더하기 앞에서도 부른다 — onChange 가 늦게 돌아도 지우기 전 턴을 병합·저장·맥락으로 쓰지 않게(H4 리뷰 Important 1)
  private func syncClear() {
    let now = log.clearCount
    guard let seen = seenClear else { seenClear = now; return }
    guard seen != now else { return }
    seenClear = now
    turns = []; judged = [:]; judging = []; adds = [:]; copied = nil; judgeSheet = nil; confirm = nil; openItem = nil; mailPolling = []; mailRequesting = []; mailNexted = []; loaded = true; edits = [:]
  }

  /// 새 턴을 맨 뒤에 두고 저장한다. 500개 상한은 더할 때도(D1)
  @discardableResult private func append(_ r: ChatHistory.Record) -> UUID {
    syncClear()
    turns.append(Turn(record: r))
    if turns.count > ChatHistory.maxRecords { turns.removeFirst(turns.count - ChatHistory.maxRecords) }
    scroll(to: r.id)
    persist()
    return r.id
  }
  /// id 로 턴을 고친다 — 그 사이 기록을 지웠으면(epoch = 보낼 때 잡은 log.clearCount 가 바뀜) 또는 정리로 빠졌으면 아무것도 하지 않는다.
  /// clear() 뒤 화면 비우기(.onChange)는 다음 렌더라 그 사이 도착한 답이 persist 로 기록을 되살리지 않게 epoch 로 막는다. await 뒤에 색인을 쓰지 않는다(F7)
  private func settle(_ id: UUID, _ epoch: Int, save: Bool = true, _ f: (inout Turn) -> Void) {
    guard log.clearCount == epoch, let i = turns.firstIndex(where: { $0.id == id }) else { return }
    f(&turns[i])
    if save { persist() }
  }
  /// 불러오지 않은 상태면 ChatLog.save 가 쓰지 않는다(파일의 기록을 이 화면의 일부 턴으로 덮지 않게)
  private func persist() { log.save(turns.map(\.record)) }

  /// 첫 표시: 기록을 불러와 마지막 턴으로(D1). 맞아요·틀렸어요 표시도 기록에서.
  /// 못 읽으면(잠금 중 보호 파일 등) 불러오지 않은 상태로 두고 다음 표시·활성화 때 다시 — 그 사이 화면에 더한 턴은 불러온 기록 뒤에 붙여 저장한다
  private func loadHistory() {
    syncClear()                                                       // 지우기 전 화면 턴은 fresh 로 병합하지 않는다
    guard !loaded, let records = log.load() else { return }
    loaded = true
    let fresh = turns, freshIDs = Set(fresh.map(\.id))
    turns = records.filter { !freshIDs.contains($0.id) }.map(Turn.init(record:)) + fresh
    if turns.count > ChatHistory.maxRecords { turns.removeFirst(turns.count - ChatHistory.maxRecords) }
    judged = ChatHistory.judgedMarks(records).merging(judged) { _, now in now }
    if !fresh.isEmpty { persist() }
    else if let last = turns.last { scroll(to: last.id) }              // 마지막 질문 행을 위에 — 그 답·카드가 보인다(D1)
  }
  /// 활성화 때 30일 지난 턴을 뺀다(D7). 불러온 뒤에만(호출부)
  private func pruneExpired() {
    let kept = Set(ChatHistory.prune(turns.map(\.record), now: Date()).map(\.id))
    guard kept.count != turns.count else { return }
    turns.removeAll { !kept.contains($0.id) }
    persist()
  }

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
    Text(a.answer).accessibilityIdentifier("chat-answer")
    // 스펙 §9 채팅 → 보관함 보기: 인용 ∪ 구별 facts ∪ 관련도 컷(서버 S1). 거절 답변·후보 없음이면 숨긴다(0.7.1)
    if let ids = a.archiveIDs {
      let scope = Archive.Scope(question: t.record.question, ids: ids)
      Button("보관함에서 보기 (\(scope.ids.count)건)") { ArchiveRouter.shared.open(scope) }
        .font(.caption).buttonStyle(.borderless)
    }
    // 일정 답 카드(§9, 0.8.2): 찾은 곳 → 그날 내 캘린더 → 상태·버튼. 일정 기간이 카드 하루보다 넓을 때만 아래 "기기 캘린더" 절도 그린다.
    // 전체 접근이 없으면 카드가 안내를 대신 들고, 절의 안내는 카드가 없을 때만
    if let b = t.briefing {                                                       // 여러 날 질문: 기간 브리핑(§9, 0.16.0) — 버튼은 답 카드와 같은 runAdd 경로
      BriefingView(model: b, adds: adds,
                   onAdd: { m in runAdd(ConfirmAdd(id: m.model.pid, fields: addFields(for: m.model)), confirmed: m.action.map(ScheduleCard.confirms) ?? false, priors: priors(for: m.model.pid)) },
                   onOpen: { openItem = $0 }, onAllow: { recheck(t.id) })
    } else {
      ForEach(Array(t.cards.enumerated()), id: \.element.pid) { pair in cardRows(t, pair.element, first: pair.offset == 0) }
      entryRows(t)                                                                // 답 카드의 update_event(0.16.0 — 그 턴의 entries 는 .edit 만)
      if t.cardsMore > 0 { Text(ScheduleCard.moreText(t.cardsMore)).font(.caption2).foregroundStyle(.secondary) }
      if a.schedule != nil, t.cards.isEmpty || t.calendar != nil { calendarRows(t, a) }
    }
    feedbackBar(a)
  }

  /// 채팅 일정 카드(스펙 §9 "채팅 일정 카드", 0.13.0 → 0.16.0): fact 순서대로 일정 답 카드 행 또는 고친 일정 상태(update_event·계보)
  @ViewBuilder private func addEventRows(_ t: Turn) -> some View {
    entryRows(t)
    if t.cardsMore > 0 { Text(ScheduleCard.moreText(t.cardsMore)).font(.caption2).foregroundStyle(.secondary) }
  }
  /// 고치기 턴(스펙 §9 B 앱 표): expired·multi·not_found·no_change 는 한 줄, ok 는 머리 + 전 → 후 + 카드
  @ViewBuilder private func editRows(_ t: Turn, _ a: ChatReply.Answer) -> some View {
    if let e = a.edit, let one = ChatEdit.oneLine(e.status) {
      Text(one).font(.subheadline).accessibilityIdentifier("edit-oneline")
    } else if let e = a.edit {
      EditHeaderView(header: ChatEdit.headerText(e), diff: ChatEdit.diffLines(e))
      entryRows(t)
    } else {
      Text(ChatHistoryText.unreadableReply).foregroundStyle(.red)
    }
  }
  @ViewBuilder private func entryRows(_ t: Turn) -> some View {
    ForEach(Array(t.entries.enumerated()), id: \.offset) { pair in
      switch pair.element {
      case .card(let m, _): cardRows(t, m, first: pair.offset == 0)
      case .edit(let s, let st, let item, let header, let lines):
        if t.record.kind != .editEvent {                                       // 등록·답 카드는 출처·일정 줄을 둔다(고치기 턴은 머리가 대신)
          // 출처: 답 카드 = 그 항목의 인용(메일·문자일 수 있다 — Fable 플랜 리뷰 N5), 등록 턴 = "채팅에서 등록한 일정"
          let cite = t.record.kind == .question ? t.answer?.citations.first(where: { $0.item_id == item }) : ChatAddEvent.citation(itemID: item, at: t.record.at)
          Text("\(ScheduleCard.sourceLine(cite)) · \(ChatEdit.whenText(start: s.start, end: s.end)) \(s.displayTitle)")
            .font(.subheadline)
        }
        // 전송 중(busy)에는 버튼을 끈다 — 고치기 RPC 와 버튼 쓰기가 같은 fact 에 겹치는 유일한 경로(Fable 플랜 리뷰 N6·#5)
        EditCardView(status: EditFlow.status(st), dayHeader: header, dayLines: lines, access: st != .noAccess,   // 전체 접근이 없으면 update 는 noAccess(허용 안내), 나머지 줄은 권한과 무관
                     running: busy || edits[s.id].isRunning || adds[s.id].isRunning, failure: edits[s.id].failure ?? adds[s.id].failure,
                     onButton: { b in pressEdit(t.id, subject: s, state: st, button: b) }, onAllow: { recheck(t.id) })
      }
    }
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
  private func readCalendar(_ id: UUID) { readCalendar(id, ex: try? Executions.shared()) }
  /// ex: 실행 기록 SQLite — 카드마다·턴마다 새로 열지 않는다(refreshCalendars 는 한 번 열어 넘긴다)
  private func readCalendar(_ id: UUID, ex: Executions?) {
    guard let idx = turns.firstIndex(where: { $0.id == id }) else { return }
    // 일정 등록·고치기 턴(0.16.0): fact 별 상태를 한 함수로(EditFlow.state — K27). add 상태만 일정 답 카드 행, 나머지는 EditCardView.
    // 등록 턴 = fact 최고 버전(proposed·succeeded), 고치기 턴 = 카드가 따라가는 제안(editSubject — stale·무시도 한 줄로). 되묻기는 이 두 턴만(askBack, K28)
    if let facts = turns[idx].facts, turns[idx].record.kind == .addEvent || turns[idx].record.kind == .editEvent {
      let lookup = CalendarLookup.lookup(ex)
      let editPid = turns[idx].record.kind == .editEvent ? ChatHistory.editSubject(turns[idx].record) : nil
      let subjects: [(FactVersions, ProposalVersion)] = facts.compactMap { f in
        if let editPid { return f.versions.first { $0.id == editPid }.map { (f, $0) } }
        return f.top.flatMap { ["proposed", "succeeded"].contains($0.status) ? (f, $0) : nil }
      }
      var entries: [CardEntry] = [], cards: [ScheduleCard.Model] = [], asks: [String: AskBack.Question] = [:]
      for (f, s) in subjects.prefix(ScheduleCard.maxCards) {
        let st = EditFlow.state(subject: s, versions: f.versions, itemID: f.itemID, lookup: lookup, askBack: true)
        if case .add(let m) = st {
          entries.append(.card(m, s)); cards.append(m)
          if m.kind == .needsReview, let q = AskBack.question(payload: s.payload) { asks[m.pid] = q }
        } else {
          var header: String? = nil, lines: [ScheduleCard.DayLine] = []
          if let l = lookup, let st0 = s.start, let t = ProposalTiming.parse(start: st0, end: s.end) {
            let day = ScheduleCard.seoulDay(t.anchor)
            var conflicts: [ProposalFlow.CalendarEvent] = []
            if case .update(.ready(_, let c)) = st { conflicts = c } else if case .lineage(_, .ready(_, let c)) = st { conflicts = c }
            header = ScheduleCard.dayHeader(day)
            lines = ScheduleCard.dayLines(day: day, events: l.events(EditFlow.cardWindow(day)), conflicts: conflicts).lines
          }
          entries.append(.edit(s, st, itemID: f.itemID, header: header, lines: lines))
        }
      }
      turns[idx].entries = entries; turns[idx].cards = cards; turns[idx].asks = asks
      turns[idx].cardsMore = max(0, subjects.count - ScheduleCard.maxCards); turns[idx].cardsRead = true
      DiagLog.append("CAL edit entries=\(entries.count) asks=\(asks.count) access=\(lookup != nil ? 1 : 0)")
      return
    }
    // 고치기 턴은 loadEditCard 가 fact 를 읽은 뒤에(답 경로로 내려가 빈 카드를 그리지 않게). ok 가 아닌 한 줄 턴은 읽을 것이 없다 — 다시 읽지 않게 표시
    if turns[idx].record.kind == .editEvent { turns[idx].cardsRead = turns[idx].answer?.edit?.status != "ok"; return }
    // 질문 턴 = 답의 제안·일정 기간, 일정 등록 턴 = 항목의 제안(기간 없음 — 카드 날짜 하루만)
    let ps: [ChatReply.Proposal], range: DateInterval?
    if let a = turns[idx].answer { ps = a.proposals; range = a.schedule?.interval }
    else if let p = turns[idx].addProposals { ps = p; range = nil }
    else { return }
    // 여러 날 질문(§9 브리핑): 카드·"기기 캘린더" 절 대신 기간 브리핑(앱만, 서버 그대로)
    if let a = turns[idx].answer, Briefing.isPeriod(a.schedule), let interval = a.schedule?.interval {
      let b = Briefing.build(proposals: a.proposals, citations: a.citations, interval: interval, lookup: CalendarLookup.lookup(ex))
      turns[idx].briefing = b; turns[idx].cards = []; turns[idx].cardsMore = 0; turns[idx].calendar = nil; turns[idx].entries = []; turns[idx].cardsRead = true
      DiagLog.append("BRIEF lines=\(b.days.reduce(0) { $0 + $1.lines.count }) missing=\(b.missing.count) notfound=\(b.notFound.count) access=\(b.access ? 1 : 0)")
      return
    }
    let picked = ScheduleCard.pick(ps, schedule: range)
    turns[idx].cards = picked.cards.map { ScheduleCard.model($0, events: CalendarLookup.cardEvents(day: $0.day), executed: executed(ex, $0.proposal.id)) }
    turns[idx].cardsMore = picked.more
    // 채팅 답 카드의 update_event(0033 — fact 최고 버전만 온다): loadAnswerEdits 가 읽은 그 fact 버전으로 같은 상태 규칙(스펙 B 앱 "원래 등록 카드" 문단).
    // 아직 안 읽었으면 읽기를 건다(읽은 뒤 이 함수가 다시 돈다). 못 읽은 제안은 줄이 없다
    if let a = turns[idx].answer {
      let ups = a.proposals.filter { $0.action == "update_event" }.prefix(ScheduleCard.maxCards)
      if !ups.isEmpty, turns[idx].facts == nil { loadAnswerEdits(turns[idx].id) }
      let lookup = ups.isEmpty ? nil : CalendarLookup.lookup(ex)
      turns[idx].entries = ups.compactMap { p -> CardEntry? in
        guard let f = turns[idx].facts?.first(where: { $0.contains(p.id) }), let top = f.top else { return nil }
        return .edit(top, EditFlow.state(subject: top, versions: f.versions, itemID: f.itemID, lookup: lookup), itemID: f.itemID, header: nil, lines: [])
      }
    }
    turns[idx].cardsRead = true
    // 기간 종류는 진단 로그에도 남긴다(T3 G5 가 분기를 가른다) — 일정 내용은 아니다
    let sched = range == nil ? "none" : ScheduleCard.showsRangeSection(schedule: range, cardDays: picked.cards.map(\.day)) ? "wide" : "day"
    let wide = CalendarLookup.fullAccess && sched == "wide"
    turns[idx].calendar = wide ? range.map { CalendarLookup.scheduleEvents($0) } : nil
    if !picked.cards.isEmpty { DiagLog.append("CAL card n=\(picked.cards.count) more=\(picked.more) access=\(CalendarLookup.fullAccess ? 1 : 0) sched=\(sched)") }
  }

  /// 일정 등록 턴의 카드(D8): 항목 id 로 그 항목의 제안(항목 상세 "일정" 절과 같은 조회)을 읽고 카드·캘린더를 계산한다.
  /// 제안은 저장하지 않는다 — 다시 열면·앱 활성화·카드 추가 뒤(refreshCalendars) 다시 읽는다. 못 읽으면 읽어 둔 제안을 그대로 두고, 처음이면 다음에 화면에 나올 때 다시.
  /// scroll: 등록 결과(registerEvent)에서만 — 카드가 붙은 뒤 그 턴을 다시 위로 올린다(기록이 길면 새 턴이 패널 바로 위에 멈춰 카드가 패널 아래에 깔린다, 최종 리뷰 Important 2).
  /// 복원 턴의 onAppear·활성화 재조회는 스크롤하지 않는다(읽던 자리를 옮기지 않게)
  private func loadAddEventCards(_ id: UUID, scroll scrollAfter: Bool = false) {
    guard let t = turns.first(where: { $0.id == id }), t.record.kind == .addEvent, let item = t.record.itemID, !t.cardsLoading else { return }
    let epoch = log.clearCount
    settle(id, epoch, save: false) { $0.cardsLoading = true }
    Task {
      let r = await API.send(ItemEvents.query(itemID: item))
      let facts = r.flatMap { $0.status == 200 ? ChatAddEvent.facts(itemID: item, data: $0.data) : nil }
      let ps = facts.map { fs in fs.compactMap { f in f.top.flatMap { ["proposed", "succeeded"].contains($0.status) ? $0.proposal(itemID: item) : nil } } }
      settle(id, epoch, save: false) { if let facts { $0.facts = facts }; if let ps { $0.addProposals = ps }; $0.cardsLoading = false }   // 재조회 실패가 읽어 둔 제안을 지우지 않게
      // 처음 읽을 때만 proposalIDs·맥락 줄을 기록에(스펙 A·B 앱 → 서버 — 그 뒤엔 바꾸지 않는다, C 성공만 줄을 다시 쓴다)
      if let facts, turns.first(where: { $0.id == id })?.record.proposalIDs == nil, let reg = ChatAddEvent.registeredLines(facts) {
        settle(id, epoch) { $0.record.proposalIDs = reg.ids; $0.record.contextLine = reg.line }
      }
      guard ps != nil, log.clearCount == epoch else { return }                                         // 지운 뒤 도착하면 카드도 계산하지 않는다
      readCalendar(id)
      if scrollAfter { scroll(to: id) }
    }
  }

  /// 고치기 턴(스펙 §9 B 앱, K16·K27): 카드가 따라가는 제안(ChatHistory.editSubject — 응답의 edit.proposal_id, 같은 카드의 되묻기 성공 뒤엔 그 새 버전)의
  /// fact 버전 전부를 다시 읽어 상태를 정한다(저장하지 않는다 — 화면에 나올 때·활성화·버튼 뒤). ok 가 아니면 읽지 않는다(한 줄). 못 읽으면 읽어 둔 것을 둔다
  private func loadEditCard(_ id: UUID) {
    guard let t = turns.first(where: { $0.id == id }), t.record.kind == .editEvent, !t.cardsLoading,
          t.answer?.edit?.status == "ok", let pid = ChatHistory.editSubject(t.record) else { return }
    let epoch = log.clearCount
    settle(id, epoch, save: false) { $0.cardsLoading = true }
    Task {
      let r = await API.send(ChatEdit.query(proposalID: pid))
      let fact = r.flatMap { $0.status == 200 ? ChatEdit.decodeFact($0.data) : nil }
      settle(id, epoch, save: false) { if let fact { $0.facts = [fact] }; $0.cardsLoading = false }
      guard fact != nil, log.clearCount == epoch else { return }
      readCalendar(id)
    }
  }
  /// 채팅 답 카드의 update_event(0033 chat_proposals — fact 최고 버전만, version·eventkit_id 는 오지 않는다): 그 제안의 fact 버전을 고치기 카드와 같은
  /// ChatEdit.query 로 읽어(최대 3) 실제 버전·식별자로 상태를 정한다(Codex 플랜 리뷰 M3 — 버전 0 으로 실행·보고하면 report_execution 이 changed →
  /// "변경된 제안" 알림, eventkit_id 가 없으면 "확인 불가"가 잦다). 못 읽은 제안은 줄을 두지 않는다(버전을 모르는 제안은 바꾸지 않는다)
  private func loadAnswerEdits(_ id: UUID) {
    guard let t = turns.first(where: { $0.id == id }), t.record.kind == .question, !t.cardsLoading, let a = t.answer else { return }
    let pids = a.proposals.filter { $0.action == "update_event" }.prefix(ScheduleCard.maxCards).map(\.id)
    guard !pids.isEmpty else { return }
    let epoch = log.clearCount
    settle(id, epoch, save: false) { $0.cardsLoading = true }
    Task {
      var facts: [FactVersions] = []
      for pid in pids {
        if let r = await API.send(ChatEdit.query(proposalID: pid)), r.status == 200, let f = ChatEdit.decodeFact(r.data) { facts.append(f) }
      }
      settle(id, epoch, save: false) { $0.facts = facts; $0.cardsLoading = false }
      guard log.clearCount == epoch else { return }
      readCalendar(id)
    }
  }

  /// 앱 활성화(설정에서 권한을 바꾸고 돌아옴·캘린더 앱에서 일정을 바꿈)·카드 추가 성공 뒤(Codex #6): 마지막 5개 턴만 다시 읽는다(EventKit 조회 비용).
  /// 그 밖의 턴(복원 턴 최대 500)은 절을 걷고 화면에 다시 나올 때 읽도록 표시만 지운다 — 권한이 없어도 같다(카드의 캘린더 줄·상태는 그릴 때 권한을 다시 본다).
  /// EventKit 변경 알림은 구독하지 않는다
  private func refreshCalendars() {
    let ids = Set(turns.suffix(5).filter { $0.answer != nil || $0.addProposals != nil || $0.facts != nil }.map(\.id))
    // 5개 밖은 화면에 다시 나올 때 onAppear 가 읽는다. 권한이 있으면 보이는 턴의 캘린더 절은 (낡아도) 남긴다
    let access = CalendarLookup.fullAccess
    for i in turns.indices where !ids.contains(turns[i].id) {
      turns[i].cardsRead = false
      if !access { turns[i].calendar = nil }
      if turns[i].record.kind == .addEvent { turns[i].addProposals = nil }   // 다음에 화면에 나올 때 제안도 다시(§9 대화 기록). 보이던 카드는 다시 읽을 때까지 그대로
      if turns[i].record.kind == .editEvent || turns[i].record.kind == .question { turns[i].facts = nil }   // 고치기 카드·답 카드의 고친 일정도 다시(0.16.0)
    }
    if !ids.isEmpty {
      let ex = try? Executions.shared()
      for t in turns.suffix(5) where ids.contains(t.id) { readCalendar(t.id, ex: ex) }
    }
    for t in turns.suffix(5) where t.record.kind == .addEvent && t.record.itemID != nil { loadAddEventCards(t.id) }   // 제안 재조회(무시·바뀐 제안·처음 조회 실패)
    for t in turns.suffix(5) where t.record.kind == .editEvent { loadEditCard(t.id) }                 // 고치기 카드: 그 fact 버전 재조회
    for t in turns.suffix(5) where t.record.kind == .question && t.facts != nil { loadAnswerEdits(t.id) }   // 답 카드의 고친 일정
  }

  /// 권한 안내에서 허용·거부한 뒤 다시 읽는다(권한 상태는 관찰되지 않는다 — 다시 그려 "설정에서 허용하기"로 바뀌게).
  /// 마지막 5개 턴과 같이 그 턴도 — 5개 밖이어도 안내를 누른 턴은 바로 바뀐다
  func recheck(_ id: UUID) {
    refreshCalendars()
    // 등록 턴은 5개 밖이면 refreshCalendars 가 제안을 비우므로 제안부터 다시 읽는다(A5 리뷰 Minor 1)
    if turns.first(where: { $0.id == id })?.record.kind == .addEvent { loadAddEventCards(id) } else { readCalendar(id) }
  }

  /// 이 기기에서 넣은 적 있는 제안(§10 실행 기록). 등록 판정의 보조 근거 — 캘린더에서 지웠으면 "이전에 추가한 일정"
  private func executed(_ ex: Executions?, _ pid: String) -> Bool {
    (try? ex?.existing(proposalId: pid)) != nil
  }

  /// 알림 액션과 같은 §10 경로(서버 상태 확인 → 표식 조회 → 겹침·비슷한 일정 → 저장 → 보고). 미리 판정 없이 불렀는데 겹침·비슷한 일정이면
  /// 저장하지 않고 돌아오므로 그 일정을 다시 읽어 확인창을 띄우고, "추가"면 confirmed 로 다시 부른다. 결과를 카드에 쓰고, 실패면 버튼을 다시 켠다.
  /// priors = 등록·고치기 턴 카드의 fact 버전(계보 확인, 0.16.0), c.checkLineage·readd = 고친 일정의 [캘린더에 추가](§10·K11)
  func runAdd(_ c: ConfirmAdd, confirmed: Bool, priors: [ProposalVersion]? = nil) {
    adds[c.id] = .running
    Task {
      let outcome = await NotificationActions.handleAdd(fields: c.fields, confirmed: confirmed, readd: c.readd, priors: priors, checkLineage: c.checkLineage)
      if ProposalFlow.needsConfirm(confirmed: confirmed, outcome: outcome) {
        adds[c.id] = nil
        var next = c; next.prompt = CalendarLookup.confirmPrompt(pid: c.id, fields: c.fields, outcome: outcome)
        confirm = next
        refreshCalendars()
        return
      }
      let fb = ChatReply.addFeedback(outcome)
      adds[c.id] = fb.retry ? .failed(fb.text) : .finished(fb.text)
      if !fb.retry { refreshCalendars() }                       // 추가 뒤 카드 상태가 "✅ 캘린더에 등록됨"으로·절이 바로 바뀐다(Codex #6)
    }
  }

  /// 등록·고치기 턴의 카드면 그 fact 버전(계보 확인 — 서버 조회 없이)과 version 필드를 더한다. 그 밖(답 카드)은 nil — handleAdd 가 순서 1 조회로
  func priors(for pid: String) -> [ProposalVersion]? { turns.lazy.compactMap { $0.facts?.first { $0.contains(pid) } }.first?.versions }
  func addFields(for c: ScheduleCard.Model) -> [String: String] {
    var f = ScheduleCard.addFields(c)
    if let v = priors(for: c.pid)?.first(where: { $0.id == c.pid })?.version { f["version"] = String(v) }
    return f
  }

  /// 고친 일정 카드 버튼(§10 "채팅 일정 고치기 실행"): [캘린더도 바꾸기]·[겹쳐도 바꾸기] = handleChange. [캘린더에 추가](삭제 확인) = payload 새 값으로 새 일정 —
  /// 계보 확인 없음, 일정 답 카드와 같은 runAdd 확인창 경로(겹침·비슷한 일정이면 확인 뒤 confirmed — Codex 플랜 리뷰 M4). 바꾼 뒤 지운 일정(succeeded)은 다시 추가(K11)
  private func pressEdit(_ turn: UUID, subject s: ProposalVersion, state: EditFlow.CardState, button: EditFlow.Button) {
    if button == .add {
      guard let f = EditFlow.addFields(s) else { edits[s.id] = .failed(ChatEditText.changeFailed); return }
      edits[s.id] = nil
      runAdd(ConfirmAdd(id: s.id, fields: f, checkLineage: false, readd: s.status == "succeeded"), confirmed: false)
      return
    }
    guard let i = EditFlow.changeInput(subject: s, state: state), let t = ProposalTiming.parse(start: i.startText, end: i.endText) else {
      edits[s.id] = .failed(ChatEditText.changeFailed); return
    }
    edits[s.id] = .running
    Task {
      let outcome = await NotificationActions.handleChange(ChangeRequest(input: i, timing: t, confirmed: button == .changeAnyway))
      DiagLog.append("EDIT change \(outcome)")
      let fb = ChatEdit.changeFeedback(outcome)
      edits[s.id] = fb.retry ? .failed(fb.text) : nil                  // 성공·안내는 다시 읽은 상태 줄이 말한다(같은 말을 두 번 하지 않는다)
      reloadCards(turn)
    }
  }
  /// 버튼·되묻기·고치기 응답 뒤 다시 읽는다: 마지막 5턴(같은 fact 를 보이는 등록·고치기·답 카드가 함께 바뀌게 — Fable 플랜 리뷰 N2) + 그 턴(5개 밖이어도).
  /// 같은 턴을 두 번 읽지 않는다(cardsLoading)
  private func reloadCards(_ id: UUID) {
    refreshCalendars()
    guard let t = turns.first(where: { $0.id == id }) else { return }
    switch t.record.kind {
    case .editEvent: loadEditCard(id)
    case .addEvent: loadAddEventCards(id)
    case .question: loadAnswerEdits(id)
    default: break
    }
  }

  /// 되묻기 버튼(스펙 §9 C): resolve_uncertain(사용자 JWT) → 다시 읽기(reloadCards — 위 등록 카드도 새 버전으로, Fable 플랜 리뷰 N2). ok 면 맥락 줄을 새 값으로(M6),
  /// 고치기 카드면 그 카드가 새 버전을 따라간다(editPid — Codex 플랜 리뷰 H2), [장소 없이 추가]면 같은 탭으로 새 버전 추가(겹침·비슷한 일정이면 그 상태로 멈춘다)
  func resolveAsk(_ turn: UUID, pid: String, code: AskBack.Code, value: String) {
    edits[pid] = .running
    let epoch = log.clearCount
    Task {
      let r = await API.send("rest/v1/rpc/resolve_uncertain", method: "POST", json: AskBack.body(pid: pid, code: code, value: value), timeout: 10)
      let o = AskBack.outcome(status: r?.status, data: r?.data)
      DiagLog.append("ASK \(code.rawValue) \(o.code)")
      edits[pid] = AskBack.failureText(o).map { .failed($0) }
      guard log.clearCount == epoch, let t = turns.first(where: { $0.id == turn }) else { return }
      // 같은 고치기 카드의 버튼이 만든 새 버전은 그 카드가 따라간다(스펙 표 "stale — 뒤 턴에서 다시 고침"은 다른 턴이 고친 경우). 기록에 남겨 다시 열어도 같다
      if t.record.kind == .editEvent, let next = AskBack.okProposalID(status: r?.status, data: r?.data) { settle(turn, epoch) { $0.record.editPid = next } }
      let item = t.record.itemID ?? t.facts?.first?.itemID
      guard o == .ok, let item, let data = await API.send(ItemEvents.query(itemID: item)), data.status == 200,
            let facts = ChatAddEvent.facts(itemID: item, data: data.data), let fact = facts.first(where: { $0.contains(pid) }), let top = fact.top else {
        reloadCards(turn); return
      }
      // 맥락 줄 갱신(스펙 A 예외): 그 fact 를 가리키는 가장 최근 맥락 턴의 그 줄만
      if let next = ChatHistory.rewriteContext(turns.map(\.record), factVersions: Set(fact.versions.map(\.id)), line: ChatEdit.lineBody(title: top.title, start: top.start, end: top.end)) {
        for rec in next { settle(rec.id, epoch, save: false) { $0.record.contextLine = rec.contextLine } }
        persist()
      }
      reloadCards(turn)
      // [장소 없이 추가]: 남은 코드가 없으면 같은 탭으로 새 버전 추가(§10 되묻기 예외) — 확인창 없이 handleAdd(confirmed false), 멈추면 카드가 그 상태
      if code == .location, top.uncertain.isEmpty, let f = EditFlow.addFields(top) {
        let outcome = await NotificationActions.handleAdd(fields: f, priors: fact.versions)
        DiagLog.append("ASK location add \(outcome)")
        reloadCards(turn)
      }
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
      let epoch = log.clearCount                              // 요청 중에 지우면 표시도 기록도 되살리지 않는다(settle)
      Task {
        defer { judging.remove(key) }
        // 같은 인용을 다시 고르면 바꾼다(unique user_id·question_id·item_id, merge-duplicates). 실패하면 표시를 되돌린다
        let r = await API.send("rest/v1/eval_judgments?on_conflict=user_id,question_id,item_id", method: "POST",
                               json: ["question_id": answer, "item_id": item, "ok": ok],
                               headers: ["Prefer": "resolution=merge-duplicates,return=minimal"])
        guard log.clearCount == epoch else { return }
        if !(200..<300).contains(r?.status ?? -1) { judged[key] = before }
        else if let tid = turns.first(where: { $0.answer?.answer_id == answer })?.id { settle(tid, epoch) { $0.record.judged[item] = ok } }   // 정리로 빠졌으면 턴이 없어 무시된다
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
    case .tooMany: append(ChatHistory.Record(at: Date(), kind: .question, question: q, error: LinkCaptureText.tooMany)); return
    case .none: break
    }
    // 서버 한도(⑧b bad_question). 넘으면 입력을 지우지 않고 고칠 수 있게 둔다
    guard q.utf16.count <= 500 else { append(ChatHistory.Record(at: Date(), kind: .question, question: q, error: ChatReply.errorMessage(status: 400))); return }
    input = ""
    if !keepFocus { inputFocused = false }                 // 보내면 키보드를 내린다(답·카드가 키보드 뒤에 깔리지 않게, 0.8.2). 하드웨어 Return 은 남긴다
    syncClear()                                             // 지운 뒤 아직 비우지 않은 턴을 맥락으로 보내지 않는다
    // 짧은 맥락(§9): 이 턴을 넣기 전의 기록에서 — 직전 3턴·30분 구간. 기록을 불러오지 못했으면 보내지 않는다(화면 턴이 기록의 일부뿐). 진단에는 개수만
    let ctx = loaded ? ChatHistory.context(turns.map(\.record), now: Date()) : []
    DiagLog.append("CHAT ctx n=\(ctx.count)")
    // 방금 등록한 일정 고치기(스펙 §9 B 앱 → 서버): 맥락 구간 안 가장 최근 등록 턴이 30분 안이면 그 첫 제안 id(기록을 못 불러왔으면 보내지 않는다)
    let editTarget = loaded ? ChatHistory.editTarget(turns.map(\.record), now: Date()) : nil
    let sentAt = Date()                                     // 일정 등록이면 이 시각이 occurred_at·같은 글 키의 날짜(§9)
    let id = append(ChatHistory.Record(at: sentAt, kind: .question, question: q))
    let epoch = log.clearCount                              // 답이 오기 전에 지우면 이 턴을 고치지 않는다(settle)
    busy = true
    Task {
      defer { busy = false }
      // 보내기 전 보고 재전송(K26, Codex H1): 카드에서 추가한 뒤 보고가 밀린 채 고치면 서버가 "추가 전"으로 본다 — 한 번 5초. 실패해도 보낸다(계보 확인이 막는다)
      var flushed = false
      if editTarget != nil, await ExecutionReporter.shared.hasUnreported() {
        flushed = true
        _ = await Deadline.run(seconds: 5) { await ExecutionReporter.shared.flush(); return true }
      }
      DiagLog.append("CHAT edit_target n=\(editTarget == nil ? 0 : 1) flush=\(flushed ? 1 : 0)")
      var attempt = 0
      var withContext = !ctx.isEmpty
      while true {
        var body: [String: Any] = ["question": q, "intents": ChatAddEvent.intents]   // 이 앱이 처리하는 행동(§9 하위 호환). 배포 전 서버는 무시하고 답한다
        if withContext { body["context"] = ctx.map(\.json) }     // 맥락이 없으면 키를 넣지 않는다(0.11.x 와 같은 요청)
        if let editTarget { body["edit_target"] = editTarget }   // 고칠 대상(0.16.0) — 없으면 키를 넣지 않는다(0.15.x 와 같은 요청)
        guard let r = await API.send("functions/v1/chat", method: "POST", json: body, timeout: 60) else {
          settle(id, epoch) { $0.record.error = "연결 실패" }; return
        }
        // llm_busy(503): 한 번만 짧게 기다렸다 다시(M2-⑦ LLM 동시 2)
        let code = ChatReply.errorCode(r.data)                     // 503 은 뜻이 둘 — llm_busy 만 다시, llm_unavailable 은 관리자 문의(0.16.1)
        if let wait = ChatReply.retryDelay(status: r.status, error: code, attempt: attempt) {
          attempt += 1
          try? await Task.sleep(for: .seconds(wait))
          continue
        }
        // 맥락 형식을 서버가 거절(400 bad_context)했을 때만 맥락 없이 한 번 더 — 다른 400(bad_question 등)은 다시 보내지 않는다
        if r.status == 400, withContext, code == "bad_context" {
          withContext = false; DiagLog.append("CHAT ctx rejected"); continue
        }
        if r.status == 200, let a = ChatReply.decode(r.data) {
          guard log.clearCount == epoch else { return }         // 지운 뒤 도착한 답 — 카드·스크롤도 하지 않는다
          if ChatEdit.isEdit(a.intent) {
            // 일정 고치기(§9 B 앱): 답이 아니다 — 응답 그대로 기록(K16), ok 면 "고침:" 맥락 줄과 카드가 따라갈 제안(editPid — 같은 카드의 되묻기가 새 버전으로 옮긴다, P6b).
            // reloadCards = 이 카드 + 마지막 5턴 — 위 등록 카드도 새 버전으로 다시 읽어 옛 버전 [캘린더에 추가]가 남지 않게(Fable 플랜 리뷰 N2)
            DiagLog.append("CHAT intent edit_event status=\(a.edit?.status ?? "none") action=\(a.edit?.action ?? "none")")
            settle(id, epoch) {
              $0.record.kind = .editEvent; $0.record.reply = r.data; $0.answer = a; $0.record.contextLine = ChatEdit.contextLine(a.edit)
              $0.record.editPid = a.edit?.status == "ok" ? a.edit?.proposal_id : nil
            }
            reloadCards(id)
            scroll(to: id)
            return
          }
          if ChatAddEvent.isAddEvent(a.intent) {
            // 채팅 일정 등록(§9): 답이 아니다 — reply 를 저장하지 않고 턴을 "일정 등록"으로 바꿔 사용자 글 그대로를 접수한다
            DiagLog.append("CHAT intent add_event ctx=\(withContext ? 1 : 0)")
            settle(id, epoch) { $0.record.kind = .addEvent; $0.record.link = ChatAddEventText.registering }
            registerEvent(id, text: q, at: sentAt, epoch: epoch, withContext: withContext)
            return
          }
          if MailCleanup.isMailAction(a.intent) {
            // 채팅 메일 정리(§9, 0.14.0): 답이 아니다 — reply 를 저장하지 않고 턴을 "메일 정리"로 바꿔 mail 칸 그대로 미리보기를 부른다(검사는 서버 한 곳)
            DiagLog.append("CHAT intent mail_action ctx=\(withContext ? 1 : 0)")
            guard let body = a.mail?.foundation as? [String: Any] else {
              settle(id, epoch) { $0.record.kind = .mailAction; $0.record.mail = MailTurn(phase: .ended, note: MailCleanupText.failed) }
              return
            }
            settle(id, epoch) { $0.record.kind = .mailAction; $0.record.mail = MailTurn(phase: .finding) }
            previewMail(id, body: body, epoch: epoch)
            return
          }
          if MailSummary.isMailSummary(a.intent) {
            // 채팅 메일 요약(§9, 0.15.0): 답이 아니다 — reply 를 저장하지 않는다. 바로 앞 요약 턴 + 지금 글이 대상을 말하지 않음이면 앞 토큰으로 읽기(검색 없음),
            // 아니면 mail_read 칸 그대로 검색(검사는 서버 한 곳 — null 이면 빈 칸으로 needs_target 되묻기). 칸 값·글은 로그에 없다
            DiagLog.append("CHAT intent mail_summary ctx=\(withContext ? 1 : 0)")
            let f = MailSummary.fields(a.mail_read)
            let translate = f?.translate ?? false
            switch MailSummary.followUp(turns.map(\.record), current: id, now: Date(), targetInMessage: f?.targetInMessage ?? true) {
            case .token(let token):
              settle(id, epoch) { $0.record.kind = .mailSummary; $0.record.mailRead = MailSummaryTurn(phase: .reading, translate: translate) }
              readSummary(id, token: token, translate: translate, request: q, epoch: epoch, fromCard: false)
            case .expired:
              settle(id, epoch) { $0.record.kind = .mailSummary; $0.record.mailRead = MailSummaryTurn(phase: .ended, translate: translate, note: MailSummaryText.followExpired) }
            case .none:
              guard let body = MailSummary.searchBody(a.mail_read) else {
                settle(id, epoch) { $0.record.kind = .mailSummary; $0.record.mailRead = MailSummaryTurn(phase: .ended, note: MailSummaryText.failed) }
                return
              }
              settle(id, epoch) { $0.record.kind = .mailSummary; $0.record.mailRead = MailSummaryTurn(phase: .finding, translate: translate) }
              searchSummary(id, body: body, request: q, epoch: epoch, direct: true)
            }
            return
          }
          settle(id, epoch) { $0.record.reply = r.data; $0.answer = a }
          readCalendar(id)
          scroll(to: id)
        } else {
          settle(id, epoch) { $0.record.error = r.status == 200 ? ChatHistoryText.unreadableReply : ChatReply.errorMessage(status: r.status, error: code) }
        }
        return
      }
    }
  }

  /// 채팅 일정 등록(스펙 §9, 0.13.0): 관문·큐는 바로(같은 글을 곧바로 다시 보내도 중복으로 막히게), 업로드·결과 기다림은 따로 — 보내기를 막지 않는다.
  /// 업로드 뒤 큐에 남으면 "연결되면 등록해요"(D7), 올라가면 3초마다 최대 60초 결과 → 일정이면 그 항목의 제안으로 카드. 모든 갱신은 epoch 로(지운 뒤 되살리지 않는다)
  private func registerEvent(_ id: UUID, text: String, at: Date, epoch: Int, withContext: Bool) {
    let o: ChatAddEvent.Outcome
    if let q = try? CaptureQueue.shared() { o = ChatAddEvent.admit(text: text, at: at, queue: q) } else { o = .failed("queue") }
    DiagLog.append("CHAT add \(ChatAddEvent.code(o))")
    switch o {
    case .discarded:
      settle(id, epoch) { $0.record.link = ChatAddEventText.discarded; $0.record.linkDone = true }
    case .failed:
      settle(id, epoch) { $0.record.link = ChatAddEventText.failed; $0.record.linkDone = true }
    case .duplicate(let cid):
      Task {
        let seen = await LinkCapture.shared.seenItem(captureID: cid)   // 서버 멱등 키로 본인 items(RLS) — 업로드 전·폐기면 nil, 처리 실패면 기록을 지운다
        settle(id, epoch) {
          switch seen {
          case .found(let item): $0.record.seenItemID = item; $0.record.link = ChatAddEventText.duplicateFound
          case .failed: $0.record.link = ChatAddEventText.processFailed
          case nil: $0.record.link = ChatAddEventText.duplicate
          }
          $0.record.linkDone = true
        }
      }
    case .queued(let cid):
      Task {
        await Uploader.shared.flush(trigger: .foreground)              // 직접 요청 우선, 응답이 없으면 background 세션(§6 업로더)
        if (try? CaptureQueue.shared().contains(id: cid)) == true {    // Task 안에서 다시 연다(Global Constraints — 큐를 Task 경계로 넘기지 않는다)
          DiagLog.append("CHAT add offline")
          settle(id, epoch) { $0.record.link = ChatAddEventText.offline; $0.record.linkDone = true }
          return
        }
        let r = await LinkCapture.shared.addEventResult(captureID: cid, withContext: withContext)
        DiagLog.append("CHAT add done events=\(r.itemID != nil ? 1 : 0)")
        settle(id, epoch) { $0.record.link = r.text; $0.record.itemID = r.itemID; $0.record.linkDone = true }
        if r.itemID != nil { loadAddEventCards(id, scroll: true) }
      }
    }
  }

  // ── 채팅 메일 정리(스펙 §9, 0.14.0). 모든 갱신은 id·epoch 로(settle) — await 뒤 색인으로 턴을 고치지 않는다. 미리보기 글은 기록에만, 로그·trace 는 개수·코드만.
  //    상태 계약(D22): 진행 중·끝나지 않은 턴은 서버를 먼저 읽는다, 결과를 모르면 토큰 상태를 읽기 전에 버튼·토큰을 버리지 않는다 ──

  /// 미리보기: 응답의 mail 칸(또는 서버가 확정한 conditions — 다시 미리보기·다음 1,000건)을 그대로 보낸다
  private func previewMail(_ id: UUID, body: [String: Any], epoch: Int) {
    Task {
      let started = Date()
      let r = await MailCleanupAPI.preview(body)
      let ms = Int(Date().timeIntervalSince(started) * 1000)
      if let r, r.status == 200, let p = MailCleanup.preview(r.data) {
        Trace.log("chat.mail", ["stage": "preview", "result": p.token == nil ? "empty" : "ok", "count": p.count, "elapsed_ms": ms])
        settle(id, epoch) {
          $0.record.mail = p.token == nil ? MailTurn(phase: .ended, note: MailCleanupText.noneFound) : MailTurn(phase: .preview, preview: p, previewAt: Date())
        }
        scroll(to: id)                                                            // 카드·버튼이 입력 패널 뒤에 깔리지 않게(0.8.2)
      } else {
        let code = r.flatMap { MailCleanup.errorCode($0.data) }
        Trace.log("chat.mail", ["stage": "preview", "result": "error", "code": code ?? "http_\(r?.status ?? -1)", "elapsed_ms": ms])
        var m = MailTurn(phase: .ended)
        m.apply(MailCleanup.previewError(status: r?.status ?? -1, code: code))
        settle(id, epoch) { $0.record.mail = m }
      }
    }
  }

  /// [휴지통으로 이동]·[읽음 처리] = 확인. 누르는 즉시 버튼을 없앤다(서버도 같은 토큰은 한 번만).
  /// 확정 코드가 아니면(네트워크·5xx·401) 요청이 서버에 닿았을 수 있다 — 문구 전에 토큰 상태를 읽는다(N-H2)
  private func executeMail(_ id: UUID) {
    let epoch = log.clearCount
    guard let m = turns.first(where: { $0.id == id })?.record.mail, m.phase == .preview, let token = m.preview?.token,
          !mailRequesting.contains(id) else { return }
    mailRequesting.insert(id)
    settle(id, epoch) { $0.record.mail?.phase = .running; $0.record.mail?.note = nil }
    Task {
      defer { mailRequesting.remove(id) }
      let r = await MailCleanupAPI.execute(token: token)
      if let r, r.status == 200 || r.status == 202, let s = MailCleanup.status(r.data) {
        Trace.log("chat.mail", ["stage": "execute", "result": s.status, "count": s.total, "method": s.method ?? "-"])
        settle(id, epoch) { $0.record.mail?.status = s }
        pollMail(id, epoch: epoch)
        return
      }
      let code = r.flatMap { MailCleanup.errorCode($0.data) }
      Trace.log("chat.mail", ["stage": "execute", "result": "error", "code": code ?? "http_\(r?.status ?? -1)"])
      if let r, MailCleanup.executeIsDefinite(status: r.status, code: code) {               // 행이 바뀌지 않았다
        let n = MailCleanup.executeError(status: r.status, code: code)
        settle(id, epoch) {
          if n.repreview { $0.record.mail?.phase = .preview; $0.record.mail?.repreview = true }   // 카드가 "미리보기가 만료됐어요" + [다시 미리보기]
          else { $0.record.mail?.phase = .ended; $0.record.mail?.apply(n) }
        }
        return
      }
      await readBack(id, token: token, epoch: epoch)
    }
  }

  /// 결과를 모를 때(실행 응답을 못 받음·재개 때 상태 없음): 토큰 상태를 최대 2번 읽는다. previewed 면 실행되지 않은 것 — 버튼으로 돌린다.
  /// 그 밖이면 그 상태로 진행·결과를 잇는다. 둘 다 못 읽으면 진행 중으로 두고 "결과를 확인하는 중이에요" — 다시 열거나 활성화되면 다시 읽는다(D22)
  private func readBack(_ id: UUID, token: String, epoch: Int) async {
    for attempt in 0..<2 {
      if attempt > 0 { try? await Task.sleep(for: .seconds(2)) }
      guard log.clearCount == epoch else { return }                               // 지운 뒤에는 요청을 보내지 않는다
      guard let r = await MailCleanupAPI.status(id: token) else { continue }
      if r.status == 200, let s = MailCleanup.status(r.data) {
        Trace.log("chat.mail", ["stage": "status", "result": s.status])
        settle(id, epoch) { $0.record.mail?.afterStatusRead(s) }
        if !s.finished && s.status != "previewed" { pollMail(id, epoch: epoch) }
        return
      }
      if r.status == 404 {                                                        // 행이 없다(정리·출처 삭제) — 결과를 확인할 수 없다
        settle(id, epoch) { $0.record.mail?.phase = .ended; $0.record.mail?.note = MailCleanupText.unknownResult }
        return
      }
    }
    settle(id, epoch) { $0.record.mail?.note = MailCleanupText.checking }
  }

  /// [되돌리기](7일, 한 번): 성공한 메일만 서버 잡이 되돌린다. 결과 불명이면 저장된 상태로 폴링을 이어 서버 상태를 읽는다(GET 먼저)
  private func undoMail(_ id: UUID) {
    let epoch = log.clearCount
    guard let m = turns.first(where: { $0.id == id })?.record.mail, m.phase == .ended, let s = m.status,
          !mailRequesting.contains(id) else { return }
    let action = m.preview?.action ?? "trash"
    mailRequesting.insert(id)
    settle(id, epoch) { $0.record.mail?.beginUndo() }
    Task {
      defer { mailRequesting.remove(id) }
      let r = await MailCleanupAPI.undo(id: s.id)
      let code = r.flatMap { MailCleanup.errorCode($0.data) }
      // 202·200 = 되돌리기 상태, 409 busy = 실행이 아직 진행 중 — 둘 다 본문 counts 로 폴링을 잇는다
      if let r, r.status == 200 || r.status == 202 || (r.status == 409 && code == "busy"), let n = MailCleanup.status(r.data) {
        Trace.log("chat.mail", ["stage": "undo", "result": n.status, "count": n.done, "method": n.method ?? "-"])
        settle(id, epoch) { $0.record.mail?.status = n }
        pollMail(id, epoch: epoch)
        return
      }
      Trace.log("chat.mail", ["stage": "undo", "result": "error", "code": code ?? "http_\(r?.status ?? -1)"])
      if let r, [400, 403, 404, 409, 410].contains(r.status) || (r.status == 502 && code == "gmail_upstream") {   // 확정: 행이 바뀌지 않았다([되돌리기]는 canUndo 대로 남는다). 502 gmail_upstream = 토큰 갱신 일시 오류(D3)
        let n = MailCleanup.undoError(status: r.status, code: code, action: action)
        settle(id, epoch) { $0.record.mail?.phase = .ended; $0.record.mail?.undoRequested = nil; $0.record.mail?.apply(n) }
        return
      }
      pollMail(id, epoch: epoch)                                                  // 결과 불명: 서버 상태를 읽어 잇는다(실패하면 진행 중으로 남아 재개 때 다시)
    }
  }

  /// 상태를 읽는다(§9): **먼저 한 번 읽고**(저장된 상태와 무관 — 되돌리기 요청 직후 닫혔으면 저장된 것은 옛 실행 결과다, Codex C3), 끝나지 않았으면 3초마다.
  /// 지우기(epoch)·턴 소멸·끝난 상태에서 멈춘다. 20분 상한은 GET 뒤에 보고, 넘으면 진행 중 그대로 문구만 남긴다 — 다시 열거나 활성화되면 resumeMail 이 다시 읽는다(C4)
  private func pollMail(_ id: UUID, epoch: Int) {
    guard !mailPolling.contains(id), let sid = turns.first(where: { $0.id == id })?.record.mail?.status?.id else { return }
    mailPolling.insert(id)
    Task {
      defer { mailPolling.remove(id) }
      let started = Date()
      while log.clearCount == epoch, turns.contains(where: { $0.id == id }) {
        if let r = await MailCleanupAPI.status(id: sid) {
          if r.status == 404 {                                                    // 7일 정리·출처 삭제 — 끝나지 않은 저장 상태는 비운다(영구 스피너·재읽기 방지). 끝난 상태는 둔다(되돌리기는 410)
            settle(id, epoch) {
              $0.record.mail?.phase = .ended; $0.record.mail?.note = MailCleanupText.unknownResult; $0.record.mail?.undoRequested = nil
              if $0.record.mail?.status?.finished != true { $0.record.mail?.status = nil }
            }
            return
          }
          if r.status == 200, let n = MailCleanup.status(r.data) {
            settle(id, epoch) { $0.record.mail?.afterStatusRead(n) }
            if n.finished || n.status == "previewed" {
              Trace.log("chat.mail", ["stage": n.undoPhase ? "undo" : "execute", "result": n.status, "count": n.undoPhase ? n.undone : n.done, "method": n.method ?? "-"])
              return
            }
          }
        }
        if Date().timeIntervalSince(started) > MailCleanup.pollLimit {
          settle(id, epoch) { $0.record.mail?.note = MailCleanupText.stillRunning }   // phase 는 running 그대로(needsStatusRead)
          return
        }
        try? await Task.sleep(for: MailCleanup.pollInterval)
      }
    }
  }

  /// 다시 열었을 때·활성화될 때(D22): 상태를 다시 읽어야 하는 턴(needsStatusRead)은 서버를 먼저 읽는다. 상태가 없으면(실행 응답 전에 닫힘) 토큰으로 묻는다.
  /// 이 프로세스가 요청 중인 턴은 건너뛴다(N-M14 — 재개가 요청 중인 턴의 버튼을 되살리지 않게)
  private func resumeMail(_ id: UUID) {
    let epoch = log.clearCount
    guard let m = turns.first(where: { $0.id == id })?.record.mail, m.needsStatusRead,
          !mailPolling.contains(id), !mailRequesting.contains(id) else { return }
    if m.status != nil { pollMail(id, epoch: epoch); return }
    guard let token = m.preview?.token else {
      settle(id, epoch) { $0.record.mail?.phase = .ended; $0.record.mail?.note = MailCleanupText.unknownResult }
      return
    }
    mailRequesting.insert(id)
    Task { defer { mailRequesting.remove(id) }; await readBack(id, token: token, epoch: epoch) }
  }
  private func resumeMailTurns() { for t in turns where t.record.mail?.needsStatusRead == true { resumeMail(t.id) } }

  /// [다시 미리보기](10분 지남·토큰이 없음): 옛 토큰이 그사이 실행됐는지 먼저 본다 — 실행된 턴을 새 미리보기로 덮어 [되돌리기]를 잃지 않게(N-H2).
  /// previewed·행 없음(404)이면 서버가 확정한 conditions 로 다시 받는다(D15). 상태를 못 읽으면 덮지 않는다
  private func repreviewMail(_ id: UUID) {
    let epoch = log.clearCount
    guard let m = turns.first(where: { $0.id == id })?.record.mail, let c = m.preview?.conditions, !mailRequesting.contains(id) else { return }
    mailRequesting.insert(id)
    settle(id, epoch) { $0.record.mail?.phase = .running; $0.record.mail?.note = nil }   // 확인 중(스피너)
    Task {
      defer { mailRequesting.remove(id) }
      if let token = m.preview?.token {
        guard let r = await MailCleanupAPI.status(id: token), r.status == 200 || r.status == 404 else {
          settle(id, epoch) { $0.record.mail?.phase = .preview; $0.record.mail?.note = MailCleanupText.failed }
          return
        }
        let s = r.status == 200 ? MailCleanup.status(r.data) : nil
        if r.status == 200 && s == nil {                                          // 200 인데 상태를 못 읽었다 — 덮지 않는다
          settle(id, epoch) { $0.record.mail?.phase = .preview; $0.record.mail?.note = MailCleanupText.failed }
          return
        }
        if let s, s.status != "previewed" {                                       // 그사이 실행됐다 — 그 결과로 잇는다
          settle(id, epoch) { $0.record.mail?.afterStatusRead(s) }
          if !s.finished { pollMail(id, epoch: epoch) }
          return
        }
      }
      guard log.clearCount == epoch else { return }                               // 지운 뒤에는 새 미리보기를 받지 않는다
      settle(id, epoch) { $0.record.mail = MailTurn(phase: .finding) }
      previewMail(id, body: c.json, epoch: epoch)                                // Conditions(Sendable)를 잡고 여기서 본문을 만든다
    }
  }

  /// [다음 1,000건 보기]: 새 메일 정리 턴 — 앞 턴의 결과·[되돌리기]를 지우지 않는다(D15). append 가 새 턴으로 스크롤한다(F28). 맥락으로 가지 않는다
  private func nextMail(_ id: UUID) {
    guard !mailNexted.contains(id), let c = turns.first(where: { $0.id == id })?.record.mail?.preview?.conditions else { return }
    mailNexted.insert(id)
    let nid = append(ChatHistory.Record(at: Date(), kind: .mailAction, question: MailCleanupText.nextPage, mail: MailTurn(phase: .finding)))
    previewMail(nid, body: c.json, epoch: log.clearCount)
  }

  /// [취소]: 서버를 부르지 않는다 — 행은 실행되지 않은 채 7일 뒤 정리된다
  private func cancelMail(_ id: UUID) {
    guard turns.first(where: { $0.id == id })?.record.mail?.phase == .preview, !mailRequesting.contains(id) else { return }
    settle(id, log.clearCount) { $0.record.mail?.phase = .ended; $0.record.mail?.note = MailCleanupText.cancelled }
  }

  // ── 채팅 메일 요약(스펙 §9, 0.15.0). 모든 갱신은 id·epoch 로(settle) — await 뒤 색인으로 턴을 고치지 않는다. 후보·요약 글은 기록에만, 로그·trace 는 단계·결과·개수·코드만 ──

  /// 검색: direct = 첫 검색(완결 1통·latest 면 바로 읽기). [다시 찾기]는 direct = false(후보 카드를 바꿀 뿐 — 사용자가 고른다)
  private func searchSummary(_ id: UUID, body: [String: Any], request: String, epoch: Int, direct: Bool) {
    let t0 = Date()
    Task {
      let r = await MailSummaryAPI.search(body)
      let ms = Int(Date().timeIntervalSince(t0) * 1000)
      guard let r, r.status == 200, let s = MailSummary.search(r.data) else {
        let code = r.flatMap { MailCleanup.errorCode($0.data) }
        Trace.log("chat.mail_read", ["stage": "search", "result": "error", "code": code ?? "http_\(r?.status ?? -1)", "elapsed_ms": ms])
        settle(id, epoch) { $0.record.mailRead?.phase = .ended; $0.record.mailRead?.apply(MailSummary.searchError(status: r?.status ?? -1, code: code)) }
        scroll(to: id)
        return
      }
      Trace.log("chat.mail_read", ["stage": "search", "result": s.complete ? "complete" : "partial", "count": s.candidates.count, "elapsed_ms": ms])
      let step = direct ? MailSummary.afterSearch(s) : (s.candidates.isEmpty ? MailSummary.afterSearch(s) : .choose)
      settle(id, epoch) {
        $0.record.mailRead?.conditions = s.conditions; $0.record.mailRead?.translate = s.conditions.translate
        $0.record.mailRead?.candidates = s.candidates; $0.record.mailRead?.complete = s.complete; $0.record.mailRead?.more = s.more
        $0.record.mailRead?.issuedAt = Date(); $0.record.mailRead?.note = nil; $0.record.mailRead?.settings = false; $0.record.mailRead?.picked = nil
        switch step {
        case .none(let text): $0.record.mailRead?.phase = .ended; $0.record.mailRead?.note = text
        case .readFirst: $0.record.mailRead?.phase = .reading; $0.record.mailRead?.picked = 0
        case .choose: $0.record.mailRead?.phase = .choosing
        }
      }
      // 지웠거나 정리로 빠진 턴이면 읽지 않는다(읽기는 비용 — settle 이 무시된 턴을 위해 요청하지 않게)
      if step == .readFirst, log.clearCount == epoch, turns.contains(where: { $0.id == id }) {
        readSummary(id, token: s.candidates[0].token, translate: s.conditions.translate, request: request, epoch: epoch, fromCard: false)
      }
      scroll(to: id)
    }
  }

  /// 읽기: 503 llm_busy 만 5초 뒤 한 번 더. 후보 카드에서 고른 읽기가 "그 밖" 실패면 10분 안 후보를 되살리고, 410 이면 만료 카드([다시 찾기])로(다시 누르면 비용은 다시 든다)
  private func readSummary(_ id: UUID, token: String, translate: Bool, request: String, epoch: Int, fromCard: Bool) {
    let t0 = Date()
    Task {
      var attempt = 0
      while true {
        let r = await MailSummaryAPI.read(token: token, translate: translate, request: request)
        let code = r.flatMap { MailCleanup.errorCode($0.data) }
        if let r, let wait = MailSummary.retryDelay(status: r.status, code: code, attempt: attempt) {
          attempt += 1
          try? await Task.sleep(for: .seconds(wait))
          guard log.clearCount == epoch else { return }                         // 지운 뒤에는 다시 보내지 않는다
          continue
        }
        let ms = Int(Date().timeIntervalSince(t0) * 1000)
        if let r, r.status == 200, let x = MailSummary.read(r.data) {
          Trace.log("chat.mail_read", ["stage": "read", "result": x.status, "elapsed_ms": ms])
          settle(id, epoch) {
            $0.record.mailRead?.read = x; $0.record.mailRead?.readAt = Date(); $0.record.mailRead?.phase = .ended
            $0.record.mailRead?.note = nil; $0.record.mailRead?.settings = false
          }
          scroll(to: id)
          return
        }
        Trace.log("chat.mail_read", ["stage": "read", "result": "error", "code": code ?? "http_\(r?.status ?? -1)", "elapsed_ms": ms])
        let n = MailSummary.readError(status: r?.status ?? -1, code: code)
        settle(id, epoch) { $0.record.mailRead?.readFailed(n, status: r?.status ?? -1, fromCard: fromCard, now: Date()) }
        scroll(to: id)
        return
      }
    }
  }

  /// 후보 줄·[가장 최근 것]: 고른 줄만 남기고 읽는다. 단계가 choosing 일 때만(연타·만료 뒤 탭 무시)
  private func pickSummary(_ id: UUID, _ i: Int) {
    let epoch = log.clearCount
    guard let t = turns.first(where: { $0.id == id }), let m = t.record.mailRead, m.phase == .choosing, let cs = m.candidates, cs.indices.contains(i),
          !m.candidatesExpired(now: Date()) else { return }
    settle(id, epoch) { $0.record.mailRead?.picked = i; $0.record.mailRead?.phase = .reading; $0.record.mailRead?.note = nil; $0.record.mailRead?.settings = false }
    readSummary(id, token: cs[i].token, translate: m.translate, request: t.record.question, epoch: epoch, fromCard: true)
  }

  /// [다시 찾기]: 서버가 확정한 조건 그대로 다시 검색해 같은 턴의 후보 카드를 바꾼다
  private func researchSummary(_ id: UUID) {
    let epoch = log.clearCount
    guard let t = turns.first(where: { $0.id == id }), let m = t.record.mailRead, m.phase == .choosing, let c = m.conditions else { return }
    settle(id, epoch) { $0.record.mailRead?.phase = .finding; $0.record.mailRead?.note = nil }
    searchSummary(id, body: c.json, request: t.record.question, epoch: epoch, direct: false)
  }

  /// 링크 수집 턴(§9): 읽기(15초 + OCR) 동안만 보내기를 막고, 서버 결과(최대 60초)는 따로 기다린다
  private func sendLink(_ q: String, url: URL, note: String?, keepFocus: Bool) {
    input = ""
    if !keepFocus { inputFocused = false }
    let id = append(ChatHistory.Record(at: Date(), kind: .link, question: q, link: LinkCaptureText.reading))
    let epoch = log.clearCount
    busy = true
    Task {
      let read = await LinkCapture.shared.chatRead(url: url, note: note)
      settle(id, epoch) { $0.record.link = read.text }
      busy = false
      // 이미 읽은 링크: 그 항목을 찾으면 문구를 줄이고 "일정 보기"(다시 추가는 항목 상세, §10 0.11.4). 못 찾으면 보관함 안내 문구 그대로
      if let seen = read.seenCaptureID {
        let item = await LinkCapture.shared.seenItem(captureID: seen)
        settle(id, epoch) {
          if case .found(let i) = item { $0.record.seenItemID = i; $0.record.link = LinkCaptureText.duplicateFound }
          if item == .failed { $0.record.link = LinkCaptureText.processFailed }   // 처리 실패 — 기록을 지웠다, 다시 붙여넣으면 다시 읽는다(0.16.1)
          $0.record.linkDone = true
        }
        return
      }
      guard let cid = read.captureID else { settle(id, epoch) { $0.record.linkDone = true }; return }
      settle(id, epoch) { $0.record.linkSaved = true }
      let result = await LinkCapture.shared.chatResult(captureID: cid, subject: .page)
      settle(id, epoch) { $0.record.link = result; $0.record.linkDone = true }
    }
  }

  /// 사진 턴(§9 채팅 사진 첨부): 입력창 글은 메모. OCR·업로드 동안 보내기를 막고, 서버 결과(최대 60초)는 따로 기다린다
  private func sendImages(_ items: [PhotosPickerItem]) {
    guard !busy else { return }                              // 피커를 연 사이 다른 턴이 시작됐으면 겹치지 않게(L5 리뷰 Minor 5)
    let note = input.trimmingCharacters(in: .whitespacesAndNewlines)
    input = ""
    inputFocused = false
    let n = min(items.count, ImageText.maxImages)
    let id = append(ChatHistory.Record(at: Date(), kind: .image, question: note.isEmpty ? "사진 \(n)장" : "사진 \(n)장 · \(note)",
                                       link: LinkCaptureText.imageReading))
    let epoch = log.clearCount
    busy = true
    Task {
      let read = await LinkCapture.shared.chatImages(Array(items.prefix(n)), note: note.isEmpty ? nil : note)
      settle(id, epoch) { $0.record.link = read.text }
      busy = false
      guard let cid = read.captureID else { settle(id, epoch) { $0.record.linkDone = true }; return }
      settle(id, epoch) { $0.record.linkSaved = true }
      let result = await LinkCapture.shared.chatResult(captureID: cid, subject: .image)
      settle(id, epoch) { $0.record.link = result; $0.record.linkDone = true }
    }
  }

  /// 링크·사진 턴(§9): 상태 문구 + (큐에 넣었으면) 저장 범위 한 줄 — 일정 카드·보관함 버튼·맞아요 막대 없음(제안은 "제안" 탭·알림).
  /// 이미 읽은 링크의 항목을 찾았으면 다음 행 "일정 보기" → 항목 상세(일정 절에서 다시 추가, 0.11.4). 자기 제스처를 갖는 borderless 버튼 +
  /// navigationDestination — 이 행의 NavigationLink 는 시뮬레이터에서 탭해도 열리지 않았다(목록의 키보드 내림 탭 제스처와 겹침으로 추정)
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
      Button { openItem = itemID } label: {
        HStack { Text(LinkCaptureText.showEvents).font(.subheadline); Spacer(); Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary) }
          .contentShape(Rectangle())
      }
      .buttonStyle(.borderless).accessibilityIdentifier("chat-link-show-events")
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

extension Optional where Wrapped == ChatView.AddState {
  var isRunning: Bool { if case .running? = self { return true }; return false }
  var isFinished: Bool { if case .finished? = self { return true }; return false }
  var failure: String? { if case .failed(let m)? = self { return m }; return nil }
}
extension Optional where Wrapped == ChatView.EditState {
  var isRunning: Bool { if case .running? = self { return true }; return false }
  var failure: String? { if case .failed(let m)? = self { return m }; return nil }
}
