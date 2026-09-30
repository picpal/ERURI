import SwiftUI
import EventKit
import EruriCore

/// 채팅(스펙 §9): 질문 → 답변 + 출처(탭하면 원문) + 인용마다 👍/👎(eval_judgments, §9 평가 절차 4) + 인용 항목의 제안 카드(Ruling 8)
struct ChatView: View {
  struct Turn: Identifiable { let id = UUID(); let question: String; var answer: ChatReply.Answer?; var error: String? }

  @State private var input = ""
  @FocusState private var inputFocused: Bool           // 키보드가 탭 막대를 가리므로 스크롤·빈 곳 탭·"완료"로 내린다
  @State private var turns: [Turn] = []
  @State private var busy = false
  @State private var judged: [String: Bool] = [:]      // "<answer_id>|<item_id>" → ok
  @State private var judging: Set<String> = []         // 기록 요청 중인 키 — 연타가 도착 순서 경합을 만들지 않게 막는다
  @State private var adds: [String: AddState] = [:]    // 제안 id → 캘린더 추가 진행·결과
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
            if let a = t.answer { answerRows(a, question: t.question) }
            else if t.error == nil { ProgressView() }
          }
        }
      }
      .scrollDismissesKeyboard(.interactively)
      .scrollBounceBehavior(.always)   // 대화가 비었거나 짧아 넘치지 않아도 끌려서 아래로 쓸면 키보드가 내려간다
      .simultaneousGesture(TapGesture().onEnded { inputFocused = false })   // 목록 탭은 행 버튼·링크를 막지 않고 포커스만 푼다
      .safeAreaInset(edge: .bottom) { inputPanel }
      .navigationTitle("채팅")
      .onAppear { dictation.onText = { input = $0 }; dictation.refresh() }
      .onDisappear { dictation.stopIfRecording() }
      // 백그라운드·전화로 비활성이 되면 녹음을 끊고, 돌아오면 권한을 다시 읽는다(설정에서 허용하고 온 경우)
      .onChange(of: scenePhase) { _, p in if p == .active { dictation.refresh() } else { dictation.stopIfRecording() } }
      .toolbar {
        ToolbarItemGroup(placement: .keyboard) { Spacer(); Button("완료") { inputFocused = false } }
      }
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

  @ViewBuilder private func answerRows(_ a: ChatReply.Answer, question: String) -> some View {
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
    // 스펙 §9 채팅 → 보관함 보기: 인용만이 아니라 이 질문의 검색 후보 전체. 거절 답변에도 후보가 있으면 보인다
    if !a.candidateIDs.isEmpty {
      let scope = Archive.Scope(question: question, ids: a.candidateIDs)
      Button("보관함에서 보기 (\(scope.ids.count)건)") { ArchiveRouter.shared.open(scope) }
        .font(.caption).buttonStyle(.borderless)
    }
    // 푸시 "추가" 액션과 같이 캘린더 전체 접근이 없으면 카드를 숨긴다(§10 권한 철회)
    if EKEventStore.authorizationStatus(for: .event) == .fullAccess {
      ForEach(a.proposals) { p in
        if let start = ChatReply.calendarStart(p) { proposalCard(p, title: p.payload["title"]?.string ?? "일정", start: start) }
      }
    }
  }

  @ViewBuilder private func proposalCard(_ p: ChatReply.Proposal, title: String, start: String) -> some View {
    let state = adds[p.id]
    VStack(alignment: .leading, spacing: 4) {
      Button(state.isRunning ? "추가하는 중… · \(title)" : "캘린더에 추가 · \(title) \(ChatReply.seoulLabel(start))") {
        adds[p.id] = .running
        Task {
          // 알림 액션과 같은 §10 경로(서버 상태 확인 → 표식 조회 → 저장 → 보고). 결과를 카드에 쓰고, 실패면 버튼을 다시 켠다
          let fb = ChatReply.addFeedback(await NotificationActions.handleAdd(fields: ["proposal_id": p.id, "title": title, "start": start]))
          adds[p.id] = fb.retry ? .failed(fb.text) : .finished(fb.text)
        }
      }
      .disabled(state.isRunning || state.isFinished)
      switch state {
      case .finished(let t)?: Text(t).font(.caption).foregroundStyle(.secondary)
      case .failed(let t)?: Text(t).font(.caption).foregroundStyle(.red)
      default: EmptyView()
      }
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
          if let a = ChatReply.decode(r.data) { turns[idx].answer = a } else { turns[idx].error = "응답을 읽지 못했습니다" }
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
