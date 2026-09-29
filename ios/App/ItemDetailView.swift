import SwiftUI
import EruriCore

/// 항목 상세(본인 데이터): 메타·원문(chat/item, 원문 만료면 표시)·추출 사실. 원문 복호화는 서버 chat 함수만 한다(§12 통제 1).
/// 채팅 출처·보관함(M2-⑨b) 공용
struct ItemDetailView: View {
  let itemID: String
  let footer: AnyView?
  @State private var meta: [String: Any] = [:]
  @State private var facts: [[String: Any]] = []
  @State private var loadError: String?
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
    .navigationTitle("항목")
    .task { await load() }
  }

  private func load() async {
    let r = await API.send("functions/v1/chat/item", method: "POST", json: ["item_id": itemID], timeout: 20)
    if let r, r.status == 200, let o = try? JSONSerialization.jsonObject(with: r.data) as? [String: Any] { meta = o }
    else { loadError = r?.status == 404 ? "항목을 찾을 수 없습니다" : "원문을 불러오지 못했습니다" }
    if let r = await API.send("rest/v1/facts?item_id=eq.\(itemID)&select=kind,payload,status"), r.status == 200,
       let rows = try? JSONSerialization.jsonObject(with: r.data) as? [[String: Any]] { facts = rows }
  }
}
