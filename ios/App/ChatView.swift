import SwiftUI
import EruriCore

/// 채팅(스펙 §9): 질문 → 답변 + 출처(탭하면 원문) + 인용마다 👍/👎(eval_judgments, §9 평가 절차 4) + 인용 항목의 제안 카드(Ruling 8)
struct ChatView: View {
  struct Turn: Identifiable { let id = UUID(); let question: String; var answer: ChatReply.Answer?; var error: String? }

  @State private var input = ""
  @State private var turns: [Turn] = []
  @State private var busy = false
  @State private var judged: [String: Bool] = [:]      // "<answer_id>|<item_id>" → ok
  @State private var added: Set<String> = []           // 이 화면에서 캘린더 추가를 누른 제안 id

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
      .safeAreaInset(edge: .bottom) {
        HStack {
          TextField("무엇이든 물어보세요", text: $input).textFieldStyle(.roundedBorder).submitLabel(.send).onSubmit(send)
          Button("보내기", action: send).disabled(busy || input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }.padding().background(.bar)
      }
      .navigationTitle("채팅")
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
    ForEach(a.proposals) { p in
      if let start = ChatReply.calendarStart(p) {
        let title = p.payload["title"]?.string ?? "일정"
        Button(added.contains(p.id) ? "추가 요청함 · \(title)" : "캘린더에 추가 · \(title) \(ChatReply.seoulLabel(start))") {
          added.insert(p.id)
          // 알림 액션과 같은 §10 경로(서버 상태 확인 → 표식 조회 → 저장 → 보고). 결과는 그 경로의 알림으로 안내된다
          Task { await NotificationActions.handleAdd(fields: ["proposal_id": p.id, "title": title, "start": start]) }
        }
        .disabled(added.contains(p.id))
      }
    }
  }

  private func judgeButton(_ answer: String, _ item: String, _ ok: Bool, _ label: String) -> some View {
    let key = "\(answer)|\(item)"
    return Button(label) {
      let before = judged[key]
      judged[key] = ok
      Task {
        // 같은 인용을 다시 누르면 바꾼다(unique user_id·question_id·item_id, merge-duplicates). 실패하면 표시를 되돌린다
        let r = await API.send("rest/v1/eval_judgments?on_conflict=user_id,question_id,item_id", method: "POST",
                               json: ["question_id": answer, "item_id": item, "ok": ok],
                               headers: ["Prefer": "resolution=merge-duplicates,return=minimal"])
        if !(200..<300).contains(r?.status ?? -1), judged[key] == ok { judged[key] = before }
      }
    }
    .buttonStyle(.borderless).opacity(judged[key] == nil || judged[key] == ok ? 1 : 0.3)
  }

  private func send() {
    let q = input.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !q.isEmpty, !busy else { return }
    input = ""
    turns.append(Turn(question: q))
    let idx = turns.count - 1
    guard q.utf16.count <= 500 else { turns[idx].error = ChatReply.errorMessage(status: 400); return }   // 서버 한도(⑧b bad_question)
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
