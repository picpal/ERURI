import SwiftUI
import EruriCore

/// 광고 메일 구독 해지(스펙 §7): 발신자별 최근 30일 광고 수와 원클릭 해지. 요청은 확인창 뒤에만, 고른 발신자 하나에만
struct UnsubscribeView: View {
  @State private var rows: [Unsubscribe.Row] = []
  @State private var message = ""
  @State private var confirm: Unsubscribe.Row?
  @State private var sending: String?
  @State private var shown = 0                                   // 요청 결과가 나올 때마다 +1 → 결과 문구로 스크롤

  var body: some View {
    ScrollViewReader { proxy in
      List {
        if !message.isEmpty {
          Text(message).font(.caption).foregroundStyle(.secondary).accessibilityIdentifier("unsub-message").id("unsub-message")
        }
        ForEach(rows) { r in
          let st = r.state()
          VStack(alignment: .leading, spacing: 4) {
            Text(r.name)
            Text(r.countLine).font(.caption).foregroundStyle(.secondary)
            Text(st.label).font(.caption2).foregroundStyle(st.isWarning ? .orange : .secondary)
              .accessibilityIdentifier("unsub-state-\(r.address)")
            if let title = st.buttonTitle {
              Button(title) { confirm = r }
                .buttonStyle(.bordered).disabled(sending != nil)
                .accessibilityIdentifier("unsub-button-\(r.address)")
            }
          }
          .accessibilityElement(children: .contain)
          .accessibilityIdentifier("unsub-row-\(r.address)")
        }
        Section { Text(Unsubscribe.footer).font(.caption2).foregroundStyle(.secondary) }
      }
      .navigationTitle("광고 메일 구독 해지")
      // 확인창은 List 에 단다(Section 에 달면 표시되지 않는다 — 설정 화면 M2-⑥b 와 같은 이유)
      .alert(confirm.map(Unsubscribe.confirmTitle) ?? "", isPresented: Binding(get: { confirm != nil }, set: { if !$0 { confirm = nil } }),
             presenting: confirm) { r in
        Button("해지 요청", role: .destructive) { send(r) }
        Button("취소", role: .cancel) {}
      } message: { _ in
        Text(Unsubscribe.confirmMessage)
      }
      .task { await load() }
      .refreshable { await load() }
      // 목록을 내린 채 요청해도 결과 문구(목록 맨 위 행)를 보이게 한다(U9 관찰)
      .onChange(of: shown) { withAnimation { proxy.scrollTo("unsub-message", anchor: .top) } }
    }
  }

  private func load() async {
    guard let r = await API.send(Unsubscribe.listPath, method: "POST", json: [String: String]()), r.status == 200,
          let v = Unsubscribe.decode(r.data) else {
      message = "불러오지 못했어요"; return
    }
    rows = v
    message = Unsubscribe.summary(count: v.count)
  }

  private func send(_ r: Unsubscribe.Row) {
    sending = r.id
    Task {
      let res = await API.send(Unsubscribe.requestPath, method: "POST", json: ["sender_id": r.id], timeout: 30)
      let text = Unsubscribe.message(status: res?.status, data: res?.data)
      await load()
      message = text                                             // 목록 요약보다 요청 결과를 보인다
      sending = nil
      shown += 1
    }
  }
}
