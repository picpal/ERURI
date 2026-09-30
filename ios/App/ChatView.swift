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
  enum AddState { case running, finished(String), failed(String) }

  var body: some View {
    NavigationStack {
      List {
        ForEach(turns) { t in
          Section {
            Text(t.question).font(.subheadline).foregroundStyle(.secondary)
            if let e = t.error { Text(e).foregroundStyle(.red) }
            if let a = t.answer { answerRows(a) }
            else if t.error == nil { ProgressView() }
          }
        }
      }
      .scrollDismissesKeyboard(.interactively)
      .scrollBounceBehavior(.always)   // 대화가 비었거나 짧아 넘치지 않아도 끌려서 아래로 쓸면 키보드가 내려간다
      .simultaneousGesture(TapGesture().onEnded { inputFocused = false })   // 목록 탭은 행 버튼·링크를 막지 않고 포커스만 푼다
      .safeAreaInset(edge: .bottom) {
        HStack {
          TextField("무엇이든 물어보세요", text: $input).textFieldStyle(.roundedBorder).submitLabel(.send).onSubmit(send)
            .focused($inputFocused)
          Button("보내기", action: send).disabled(busy || input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }.padding().background(.bar)
        // 입력창 영역에서 아래로 끌어도 내린다. 동시 제스처라 입력창 탭·커서 이동·보내기는 그대로
        .simultaneousGesture(DragGesture(minimumDistance: 10).onEnded { if $0.translation.height > 30 { inputFocused = false } })
      }
      .navigationTitle("채팅")
      .toolbar {
        ToolbarItemGroup(placement: .keyboard) { Spacer(); Button("완료") { inputFocused = false } }
      }
    }
  }

  @ViewBuilder private func answerRows(_ a: ChatReply.Answer) -> some View {
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
