import { assert, assertEquals } from "jsr:@std/assert";
import { encrypt, toBytea } from "../functions/_shared/crypto.ts";
import { eventFact, saveFact, saveFacts, textFacts } from "../functions/_shared/facts.ts";
import { RUN, service as sb, testUser } from "./_testenv.ts";

// 호스팅 DB. 전용 테스트 사용자·실행 태그만 쓰고 자기 행만 지운다(AGENTS.md §7). 문구는 합성
const USER = (await testUser()).id;
async function seedText(text: string, tag: string): Promise<string> {
  const { data, error } = await sb.rpc("insert_item", { p_user: USER, p_source: "NOTIFICATION", p_idempotency_key: `${RUN}:facts:${tag}`,
    p_sender: null, p_title: null, p_content_enc: toBytea(await encrypt(USER, text)), p_occurred_at: new Date().toISOString(), p_enqueue: false });
  assertEquals(error, null);
  return data as string;
}
async function cleanup(ids: string[]) {
  await sb.from("facts").delete().eq("user_id", USER).in("item_id", ids);   // proposals cascade
  await sb.from("items").delete().eq("user_id", USER).in("id", ids);
}
const EV = { title: "합성 치과", start: "2026-10-02T15:30:00+09:00", end: null, location: null, uncertain: [] as string[] };

Deno.test("save_fact: event → fact + create_event proposal + status extracted; retry returns the same ids (no duplicates)", async () => {
  const id = await seedText("합성 문구 1", "ev");
  try {
    const a = await saveFact(sb, eventFact(USER, id, EV, "text", "합성 근거"));
    assert(a.created && a.proposalId !== null);
    await sb.from("items").update({ status: "queued" }).eq("id", id).eq("user_id", USER);   // 저장 후 잡 완료 전에 죽은 경우
    const b = await saveFact(sb, eventFact(USER, id, EV, "text", "합성 근거"));
    assertEquals([b.created, b.factId, b.proposalId], [false, a.factId, a.proposalId]);
    const { data: facts } = await sb.from("facts").select("id, evidence, proposals(action, status, payload)").eq("user_id", USER).eq("item_id", id);
    assertEquals(facts!.length, 1);
    const p = facts![0].proposals as { action: string; status: string; payload: Record<string, unknown> }[];
    assertEquals([facts![0].evidence, p.length, p[0].action, p[0].status, "via" in p[0].payload], ["합성 근거", 1, "create_event", "proposed", false]);
    const { data: item } = await sb.from("items").select("status").eq("id", id).single();
    assertEquals(item!.status, "extracted");
  } finally { await cleanup([id]); }
});

Deno.test("save_fact: task → create_reminder, purchase → no proposal; evidence cut at 300", async () => {
  const [t, p] = [await seedText("합성 2", "task"), await seedText("합성 3", "buy")];
  try {
    const task = (await saveFacts(sb, textFacts(USER, t, { kind: "task", task: { title: "합성 납부", due: "2026-10-04", uncertain: [] }, evidence: null })!))[0];
    const buy = (await saveFacts(sb, textFacts(USER, p, { kind: "purchase", evidence: "가".repeat(400), purchase: { merchant: "합성커피",
      products: [], ordered_at: null, amount: 32000, currency: "KRW", order_no: null, status: "paid" } })!))[0];
    assertEquals(buy.proposalId, null);
    const { data: prop } = await sb.from("proposals").select("action").eq("id", task.proposalId!).single();
    assertEquals(prop!.action, "create_reminder");
    const { data: f } = await sb.from("facts").select("kind, evidence").eq("id", buy.factId).single();
    assertEquals([f!.kind, f!.evidence.length], ["purchase", 300]);
  } finally { await cleanup([t, p]); }
});

const evAt = (start: string, title = "합성 회차") => ({ payload: { title, start, end: null, location: null, uncertain: [], via: "text" }, evidence: "합성 근거" });

Deno.test("save_facts: three events → ordinals 0..2, three proposals, extracted; retry returns the same ids", async () => {
  const id = await seedText("합성 다건", "multi");
  try {
    const f = { userId: USER, itemId: id, kind: "event" as const,
      entries: [evAt("2026-10-04T14:00:00+09:00"), evAt("2026-10-11T14:00:00+09:00"), evAt("2026-10-18")] };
    const a = await saveFacts(sb, f);
    assertEquals(a.map((s) => s.created), [true, true, true]);
    assert(a.every((s) => s.proposalId !== null));
    assertEquals(new Set(a.map((s) => s.factId)).size, 3);
    await sb.from("items").update({ status: "queued" }).eq("id", id).eq("user_id", USER);   // 저장 뒤 잡 완료 전에 죽은 경우
    const b = await saveFacts(sb, f);
    assertEquals(b.map((s) => [s.created, s.factId, s.proposalId]), a.map((s) => [false, s.factId, s.proposalId]));
    const { data: facts } = await sb.from("facts").select("ordinal, proposals(id)").eq("user_id", USER).eq("item_id", id).order("ordinal");
    assertEquals(facts!.map((x) => [x.ordinal, (x.proposals as unknown[]).length]), [[0, 1], [1, 1], [2, 1]]);
    const { data: item } = await sb.from("items").select("status").eq("id", id).single();
    assertEquals(item!.status, "extracted");
  } finally { await cleanup([id]); }
});

// Review Focus 2: 하나라도 잘못되면 아무것도 저장하지 않는다(부분 저장 뒤 extracted 금지)
// (루프 중간 예외도 RPC 한 번 = 한 트랜잭션이라 함수 전체가 되돌려진다 — 검사는 루프 전에 모아 둔다)
Deno.test("save_facts: atomic — 6 events, two tasks, empty, or a non-object payload save nothing and leave the item queued", async () => {
  const id = await seedText("합성 원자성", "atomic");
  try {
    const six = Array.from({ length: 6 }, (_, i) => evAt(`2026-10-${String(10 + i).padStart(2, "0")}`));
    const r1 = await sb.rpc("save_facts", { p_user: USER, p_item: id, p_kind: "event", p_entries: six, p_action: "create_event" });
    assert(r1.error !== null);
    const task = { payload: { title: "합성 납부", due: "2026-10-04", uncertain: [], via: "text" }, evidence: null };
    const r2 = await sb.rpc("save_facts", { p_user: USER, p_item: id, p_kind: "task", p_entries: [task, task], p_action: "create_reminder" });
    assert(r2.error !== null);
    const r3 = await sb.rpc("save_facts", { p_user: USER, p_item: id, p_kind: "event", p_entries: [], p_action: "create_event" });
    assert(r3.error !== null);
    // payload 가 객체가 아님(jsonb null 은 not null 을 통과한다) → 루프 전 bad entries, 아무것도 저장 안 됨
    const r4 = await sb.rpc("save_facts", { p_user: USER, p_item: id, p_kind: "event",
      p_entries: [evAt("2026-10-04T14:00:00+09:00"), { payload: null, evidence: null }], p_action: "create_event" });
    assert(r4.error !== null);
    // purchase(p_action null)에서도 같은 검사 — 제안 insert 의 우연한 오류에 기대지 않는다
    const r5 = await sb.rpc("save_facts", { p_user: USER, p_item: id, p_kind: "purchase", p_entries: [{ payload: null, evidence: null }], p_action: null });
    assert(r5.error !== null);
    const { count } = await sb.from("facts").select("id", { count: "exact", head: true }).eq("user_id", USER).eq("item_id", id);
    assertEquals(count, 0);
    const { data: item } = await sb.from("items").select("status").eq("id", id).single();
    assertEquals(item!.status, "queued");
  } finally { await cleanup([id]); }
});

Deno.test("save_fact (image path wrapper) shares ordinal 0 with save_facts; unpushed returns only the lead; bundle lists siblings by ordinal", async () => {
  const id = await seedText("합성 래퍼", "wrap");
  try {
    const one = await saveFact(sb, eventFact(USER, id, { title: "합성 회차", start: "2026-10-04T14:00:00+09:00", end: null, location: null, uncertain: [] }, "text", "합성 근거"));
    const many = await saveFacts(sb, { userId: USER, itemId: id, kind: "event",
      entries: [evAt("2026-10-04T14:00:00+09:00"), evAt("2026-10-11T14:00:00+09:00")] });
    assertEquals([many[0].created, many[0].factId, many[1].created], [false, one.factId, true]);
    const { data: lead } = await sb.rpc("worker_unpushed_proposals", { p_user: USER, p_item: id });
    assertEquals(lead, [one.proposalId]);
    const { data: bundle } = await sb.rpc("worker_get_proposal_bundle", { p_user: USER, p_proposal: many[1].proposalId });
    assertEquals((bundle as { id: string; ordinal: number }[]).map((r) => [r.id, r.ordinal]), [[one.proposalId, 0], [many[1].proposalId, 1]]);
    const { data: other } = await sb.rpc("worker_get_proposal_bundle", { p_user: (await testUser(2)).id, p_proposal: one.proposalId });
    assertEquals(other, []);
  } finally { await cleanup([id]); }
});

Deno.test("worker_set_item_status: wipe clears ciphertext and audits code only; no wipe keeps it", async () => {
  const [a, b] = [await seedText("합성 4", "wipe"), await seedText("합성 5", "keep")];
  try {
    assertEquals((await sb.rpc("worker_set_item_status", { p_user: USER, p_item: a, p_status: "discarded:server:personal", p_wipe: true })).error, null);
    assertEquals((await sb.rpc("worker_set_item_status", { p_user: USER, p_item: b, p_status: "discarded:server:empty", p_wipe: false })).error, null);
    const { data: wiped } = await sb.from("items").select("id").eq("id", a).is("content_enc", null).eq("status", "discarded:server:personal");
    const { data: kept } = await sb.from("items").select("id").eq("id", b).not("content_enc", "is", null).eq("status", "discarded:server:empty");
    assertEquals([wiped!.length, kept!.length], [1, 1]);
    const { count } = await sb.from("audit_log").select("id", { count: "exact", head: true }).eq("user_id", USER).eq("action", "discard").like("target", `${a}%`);
    assertEquals(count, 1);
  } finally { await cleanup([a, b]); }
});

Deno.test("worker_get_text_item: owner only; processed items come back without ciphertext", async () => {
  const other = (await testUser(2)).id;
  const id = await seedText("합성 6", "get");
  try {
    const mine = await sb.rpc("worker_get_text_item", { p_user: USER, p_item: id });
    assertEquals([mine.error, mine.data.length, mine.data[0].status, mine.data[0].content_enc !== null], [null, 1, "queued", true]);
    assertEquals((await sb.rpc("worker_get_text_item", { p_user: other, p_item: id })).data.length, 0);
    await sb.rpc("worker_set_item_status", { p_user: USER, p_item: id, p_status: "extracted", p_wipe: false });
    const done = await sb.rpc("worker_get_text_item", { p_user: USER, p_item: id });
    assertEquals([done.data[0].status, done.data[0].content_enc], ["extracted", null]);
  } finally { await cleanup([id]); }
});
