import { assert, assertEquals } from "jsr:@std/assert";
import { encrypt, toBytea } from "../functions/_shared/crypto.ts";
import { embed, toPgVector } from "../functions/_shared/embeddings.ts";
import { RUN, service as sb, testUser, userClient } from "./_testenv.ts";

// 전용 테스트 사용자·합성 문구만(AGENTS.md §7). 자기가 만든 행만 지운다
const USER = (await testUser()).id;
// insert_item(GMAIL) 은 Gmail 연결이 있어야 저장하므로(0013) SHARE 로 넣고 출처만 바꾼다
async function seed(source: string, tag: string, title: string, text: string) {
  const { data: id, error } = await sb.rpc("insert_item", { p_user: USER, p_source: "SHARE", p_idempotency_key: `${RUN}:chat:${tag}`, p_sender: null,
    p_title: title, p_content_enc: toBytea(await encrypt(USER, text)), p_occurred_at: "2026-09-10T03:00:00Z", p_enqueue: false });
  assertEquals(error, null);
  assert(id);
  assertEquals((await sb.from("items").update({ source, status: "extracted" }).eq("user_id", USER).eq("id", id)).error, null);
  return id as string;
}

Deno.test("search_facts (merchant/kind), hybrid_search p_sources, chat_item_meta, chat_proposals", async () => {
  const g = await seed("GMAIL", "g", "합성 견적", "합성건설 견적서 1,200만원"), n = await seed("NOTIFICATION", "n", "합성상점", "합성커피 결제 6,500원");
  try {
    await sb.rpc("save_fact", { p_user: USER, p_item: n, p_kind: "purchase", p_payload: { merchant: "합성커피", amount: 6500 }, p_evidence: "합성커피 결제", p_action: null });
    await sb.rpc("save_fact", { p_user: USER, p_item: g, p_kind: "event", p_payload: { title: "합성 현장 미팅", start: "2026-10-20T10:00:00+09:00" },
      p_evidence: "합성 현장 미팅", p_action: "create_event" });
    const { data: fx } = await sb.rpc("search_facts", { p_user: USER, p_from: null, p_to: null, p_kinds: ["purchase"], p_merchant: "합성커피" });
    assertEquals((fx as { item_id: string }[]).map((r) => r.item_id), [n]);
    const { data: none } = await sb.rpc("search_facts", { p_user: USER, p_from: null, p_to: null, p_kinds: [], p_merchant: null });
    assertEquals((none as unknown[]).length, 0);                                            // 구조화 조건 없으면 facts 경로 안 씀
    const { data: late } = await sb.rpc("search_facts", { p_user: USER, p_from: "2026-09-11T00:00:00+09:00", p_to: null, p_kinds: ["purchase"], p_merchant: null });
    assertEquals((late as unknown[]).length, 0);                                            // 기간 밖
    await sb.from("item_chunks").insert([{ item_id: g, user_id: USER, chunk_index: 0, text: "합성 견적\n합성건설 견적서 1,200만원" },
                                          { item_id: n, user_id: USER, chunk_index: 0, text: "합성상점\n합성커피 결제 6,500원" }]);
    const { data: onlyMail } = await sb.rpc("hybrid_search", { p_user: USER, p_query: "합성 견적 결제", p_embedding: null, p_limit: 5, p_sources: ["GMAIL"] });
    assertEquals([...new Set((onlyMail as { item_id: string }[]).map((r) => r.item_id))], [g]);
    const { data: both } = await sb.rpc("hybrid_search", { p_user: USER, p_query: "합성 견적 결제", p_embedding: null, p_limit: 5, p_sources: [] });
    assertEquals(new Set((both as { item_id: string }[]).map((r) => r.item_id)), new Set([g, n]));   // 빈 배열 = 출처 조건 없음
    const { data: meta } = await sb.rpc("chat_item_meta", { p_user: USER, p_ids: [g, n] });
    assertEquals((meta as { expired: boolean }[]).length, 2);
    assertEquals((meta as { expired: boolean }[]).every((m) => m.expired === false), true);
    const { data: other } = await sb.rpc("chat_item_meta", { p_user: crypto.randomUUID(), p_ids: [g] });
    assertEquals((other as unknown[]).length, 0);                                           // 남의 id 는 메타도 없음
    const { data: props } = await sb.rpc("chat_proposals", { p_user: USER, p_items: [g, n] });
    assertEquals((props as { item_id: string; action: string; status: string }[]).map((p) => [p.item_id, p.action, p.status]), [[g, "create_event", "proposed"]]);
  } finally {
    await sb.from("facts").delete().eq("user_id", USER).in("item_id", [g, n]);           // proposals cascade
    await sb.from("items").delete().eq("user_id", USER).in("id", [g, n]);
  }
});

Deno.test("chat_get_item: owner only, decrypt audited only when there is ciphertext; audit_read writes a read row", async () => {
  const a = await seed("SHARE", "ga", "합성 메모", "합성 원문 a"), b = await seed("SHARE", "gb", "합성 메모", "합성 원문 b");
  try {
    const { data: mine } = await sb.rpc("chat_get_item", { p_user: USER, p_item: a });
    assertEquals((mine as { content_enc: string | null; title: string }[]).map((r) => [r.content_enc !== null, r.title]), [[true, "합성 메모"]]);
    const { data: theirs } = await sb.rpc("chat_get_item", { p_user: crypto.randomUUID(), p_item: a });
    assertEquals((theirs as unknown[]).length, 0);
    await sb.from("items").update({ content_enc: null }).eq("user_id", USER).eq("id", b);   // 원문 만료 흉내
    const { data: expired } = await sb.rpc("chat_get_item", { p_user: USER, p_item: b });
    assertEquals((expired as { content_enc: string | null }[]).map((r) => r.content_enc), [null]);
    const { data: audit } = await sb.from("audit_log").select("target").eq("user_id", USER).eq("actor", "chat").eq("action", "decrypt").in("target", [a, b]);
    assertEquals((audit as { target: string }[]).map((r) => r.target), [a]);
    const target = `${RUN}:read`;
    assertEquals((await sb.rpc("audit_read", { p_user: USER, p_actor: "chat", p_target: target })).error, null);
    const { data: read } = await sb.from("audit_log").select("action").eq("user_id", USER).eq("target", target);
    assertEquals(read, [{ action: "read" }]);
  } finally {
    await sb.from("items").delete().eq("user_id", USER).in("id", [a, b]);
  }
});

Deno.test("chat RPCs are service-role only", async () => {
  const { c } = await userClient(1);
  const r = await c.rpc("chat_item_meta", { p_user: USER, p_ids: [] });
  assertEquals(r.error?.code, "42501");
});

// 배포된 chat 을 전용 테스트 사용자로 실제 호출(OpenAI 임베딩·답변 사용, 합성 문서만)
Deno.test({ name: "deployed chat answers from the user's own chunk and cites it; /chat/item returns the original", ignore: Deno.env.get("DEPLOYED") !== "1", fn: async () => {
  const text = "합성커피 역삼점에서 무선 이어폰 케이스를 12,900원에 샀다.";
  const id = await seed("SHARE", "dep", "합성 메모", text);
  try {
    const [v] = await embed([`합성 메모\n${text}`], "document");
    const saved = await sb.rpc("worker_save_chunks", { p_user: USER, p_item: id, p_chunks: [{ i: 0, text: `합성 메모\n${text}`, embedding: toPgVector(v) }] });
    assertEquals([saved.error, saved.data], [null, 1]);
    const { c } = await userClient(1);
    const token = (await c.auth.getSession()).data.session!.access_token;
    const h = { authorization: `Bearer ${token}`, apikey: Deno.env.get("SUPABASE_ANON_KEY")!, "content-type": "application/json" };
    const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/chat`, { method: "POST", headers: h, body: JSON.stringify({ question: "이어폰 케이스 어디서 얼마에 샀지?" }) });
    const j = await r.json();
    assertEquals([r.status, j.refused], [200, false]);
    assert(j.source_item_ids.includes(id));
    assert((j.citations as { item_id: string }[]).some((m) => m.item_id === id));
    const it = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/chat/item`, { method: "POST", headers: h, body: JSON.stringify({ item_id: id }) });
    assertEquals([it.status, (await it.json()).text], [200, text]);
    const nf = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/chat/item`, { method: "POST", headers: h, body: JSON.stringify({ item_id: "not-a-uuid" }) });
    assertEquals(nf.status, 404);
    await nf.body?.cancel();
  } finally {
    await sb.from("items").delete().eq("user_id", USER).eq("id", id);
    await sb.from("usage_counters").delete().eq("user_id", USER);
    await sb.from("llm_slots").delete().eq("user_id", USER);
  }
} });
