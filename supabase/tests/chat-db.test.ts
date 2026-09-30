import { assert, assertEquals } from "jsr:@std/assert";
import { encrypt, toBytea } from "../functions/_shared/crypto.ts";
import { embed, toPgVector } from "../functions/_shared/embeddings.ts";
import type { BudgetDeps } from "../functions/_shared/budget.ts";
import { chatDeps } from "../functions/chat/deps.ts";
import { answerQuestion, type ChatDeps, type Filters } from "../functions/chat/handler.ts";
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

// Ruling D: 9/10 에 받은 10/20 일정. 필터 기간이 일정 날짜(10/20)로 채워져도 facts(start)와 하이브리드 폴백이 그 항목을 찾는다
Deno.test("search_facts filters event/task by start/due (else received time); merchant is a plain substring", async () => {
  const e = await seed("GMAIL", "fe", "합성 초대", "합성 현장 미팅 10월 20일"), t = await seed("GMAIL", "ft", "합성 고지", "합성 관리비 납부"),
    d = await seed("GMAIL", "fd", "합성 공지", "합성 워크숍"), p = await seed("NOTIFICATION", "fp", "합성상점", "합성커피 결제");
  try {
    for (const [item, kind, payload] of [[e, "event", { title: "합성 현장 미팅", start: "2026-10-20T10:00:00+09:00" }],
      [t, "task", { title: "합성 관리비", due: "2026-10-25" }], [d, "event", { title: "합성 워크숍", start: "2026-02-30" }],
      [p, "purchase", { merchant: "합성커피", amount: 6500 }]] as const) {
      assertEquals((await sb.rpc("save_fact", { p_user: USER, p_item: item, p_kind: kind, p_payload: payload, p_evidence: "합성", p_action: null })).error, null);
    }
    const ids = async (from: string | null, to: string | null, kinds: string[], merchant: string | null = null) => {
      const { data, error } = await sb.rpc("search_facts", { p_user: USER, p_from: from, p_to: to, p_kinds: kinds, p_merchant: merchant, p_limit: 20 });
      assertEquals(error, null);
      return new Set((data as { item_id: string }[]).map((r) => r.item_id));
    };
    assertEquals(await ids("2026-10-20T00:00:00+09:00", "2026-10-20T23:59:59+09:00", ["event"]), new Set([e]));       // 일정 날짜로 찾음
    assertEquals(await ids("2026-09-10T00:00:00+09:00", "2026-09-10T23:59:59+09:00", ["event"]), new Set([d]));       // 받은 날로는 안 잡힘(start 가 없는 날짜 2/30 이면 수신일)
    assertEquals(await ids("2026-10-25T00:00:00+09:00", "2026-10-25T23:59:59+09:00", ["task"]), new Set([t]));        // 날짜만 = 서울 0시
    assertEquals(await ids("2026-09-10T00:00:00+09:00", "2026-09-10T23:59:59+09:00", ["purchase"]), new Set([p]));    // 구매는 받은 시각
    assertEquals(await ids(null, null, [], "합성%"), new Set());                                                         // % 는 글자
    assertEquals(await ids(null, null, [], "커피"), new Set([p]));
  } finally {
    await sb.from("facts").delete().eq("user_id", USER).in("item_id", [e, t, d, p]);
    await sb.from("items").delete().eq("user_id", USER).in("id", [e, t, d, p]);
  }
});

Deno.test("chat pipeline (real facts/hybrid RPCs): mail received 9/10 about a 10/20 meeting is found via facts start and via the undated hybrid retry", async () => {
  const text = "합성 현장 미팅 안내: 10월 20일 오전 10시 합성빌딩 3층 회의실";
  const id = await seed("GMAIL", "cp", "합성 미팅 초대", text);
  try {
    assertEquals((await sb.rpc("save_fact", { p_user: USER, p_item: id, p_kind: "event", p_payload: { title: "합성 현장 미팅", start: "2026-10-20T10:00:00+09:00" },
      p_evidence: "10월 20일 오전 10시 합성빌딩", p_action: null })).error, null);
    assertEquals((await sb.from("item_chunks").insert({ item_id: id, user_id: USER, chunk_index: 0, text: `합성 미팅 초대\n${text}` })).error, null);
    const real = chatDeps(sb);
    const budget: BudgetDeps = { reserve: async () => "ok", settle: async () => {}, acquire: async () => 1, release: async () => {}, now: () => new Date() };
    const run = async (f: Partial<Filters>) => {
      const searches: { from: string | null }[] = [];
      const d: ChatDeps = { ...real, budget, audit: async () => {},
        filters: async () => ({ filters: { date_from: "2026-10-20T00:00:00+09:00", date_to: "2026-10-20T23:59:59+09:00", sources: [], kinds: [], merchant: null, ...f } }),
        search: async (u, q) => { searches.push({ from: q.from }); return await real.search(u, q); },
        answer: async (x) => ({ answer: "합성빌딩", source_item_ids: x.documents.map((doc) => doc.item_id), refused: false, model: "gpt-6-sol" }) };
      return { r: await answerQuestion(USER, "10월 20일 합성 현장 미팅 어디야", d), searches };
    };
    const viaFacts = await run({ kinds: ["event"] });
    assertEquals([viaFacts.r.hits, viaFacts.r.refused], [[id], false]);
    const viaRetry = await run({});                                                        // facts 경로 없음 → 하이브리드 폴백만
    assertEquals([viaRetry.r.hits, viaRetry.searches.map((s) => s.from)], [[id], ["2026-10-20T00:00:00+09:00", null]]);
  } finally {
    await sb.from("facts").delete().eq("user_id", USER).eq("item_id", id);
    await sb.from("items").delete().eq("user_id", USER).eq("id", id);
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

// R-A1: 후보 = 같은 검색의 융합 목록 전체. 키워드로 걸린 15건이 모두 후보이고 문서는 12개 이하·후보의 부분집합
Deno.test("chatDeps.search: documents ≤ 12, candidates = every item of the fused list in rank order", async () => {
  const ids: string[] = [];
  try {
    for (let i = 0; i < 15; i++) {
      const id = await seed("SHARE", `cand${i}`, `합성후보 ${i}`, `합성후보단어 항목 ${i}`);
      ids.push(id);
      assertEquals((await sb.from("item_chunks").insert({ item_id: id, user_id: USER, chunk_index: 0, text: `합성후보 ${i}\n합성후보단어 항목 ${i}` })).error, null);
    }
    const s = await chatDeps(sb).search(USER, { question: "합성후보단어", from: null, to: null, sources: [] });
    assert(s.docs.length <= 12);
    assert(ids.every((id) => s.candidates.includes(id)));
    assertEquals(new Set(s.candidates).size, s.candidates.length);
    assert(s.docs.every((d) => s.candidates.includes(d.item_id)));
  } finally {
    await sb.from("items").delete().eq("user_id", USER).in("id", ids);                // chunks cascade
  }
});
