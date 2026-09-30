import { assert, assertEquals } from "jsr:@std/assert";
import { createClient } from "npm:@supabase/supabase-js@2";
import { encrypt, SERVER_AUTH, toBytea } from "../functions/_shared/crypto.ts";
import { RUN, service as sb, userClient } from "./_testenv.ts";

// 호스팅 DB. 전용 테스트 사용자·실행 태그만(AGENTS.md §7). 제안 리뷰(Ruling 8', 스펙 §10·§11): list_pending_proposals·dismiss_proposal
type Row = { proposal_id: string; action: string; title: string; start: string; end: string | null; location: string | null; version: number; created_at: string };
const HOUR = 3600_000;
const T0 = Date.now();
const at = (ms: number) => new Date(T0 + ms).toISOString();

async function seed(user: string, tag: string, payload: Record<string, unknown>, action = "create_event"): Promise<{ item: string; proposal: string }> {
  const { data: item, error } = await sb.rpc("insert_item", { p_user: user, p_source: "NOTIFICATION", p_idempotency_key: `${RUN}:prv:${tag}`,
    p_sender: null, p_title: null, p_content_enc: toBytea(await encrypt(user, "[합성] 합성 일정")), p_occurred_at: new Date().toISOString(), p_enqueue: false });
  if (error) throw new Error("insert_item " + error.code);
  const { data } = await sb.rpc("save_fact", { p_user: user, p_item: item, p_kind: action === "create_event" ? "event" : "task",
    p_payload: payload, p_evidence: "합성", p_action: action });
  return { item: item as string, proposal: (data as { out_proposal_id: string }[])[0].out_proposal_id };
}

async function cleanup(user: string, items: string[]) {
  await sb.from("facts").delete().eq("user_id", user).in("item_id", items);                         // proposals·executions cascade
  await sb.from("items").delete().eq("user_id", user).in("id", items);
}

const ids = (rows: Row[] | null) => (rows ?? []).map((r) => r.proposal_id);

Deno.test("list_pending_proposals: own proposed ADD_EVENT only, excludes past·old·uncertain·date-only·reminder·other statuses, start ascending", async () => {
  const { u, c } = await userClient(1);
  const { c: c2 } = await userClient(2);
  const s = [
    await seed(u.id, "late", { title: "합성 늦은 진료", start: at(48 * HOUR), end: at(49 * HOUR), location: "합성의원 3층", uncertain: [] }),
    await seed(u.id, "soon", { title: "합성 이른 진료", start: at(2 * HOUR), end: null, location: null, uncertain: [] }),
    await seed(u.id, "grace", { title: "합성 방금 시작", start: at(-30 * 60_000), uncertain: [] }),             // 1시간 유예 안
    await seed(u.id, "past", { title: "합성 지난 일정", start: at(-2 * HOUR), uncertain: [] }),
    await seed(u.id, "old", { title: "합성 오래된 제안", start: at(24 * HOUR), uncertain: [] }),                // created_at 31일 전
    await seed(u.id, "unc", { title: "합성 확인 필요", start: at(24 * HOUR), uncertain: ["ampm"] }),             // REVIEW
    await seed(u.id, "date", { title: "합성 날짜만", start: at(72 * HOUR).slice(0, 10), uncertain: [] }),      // REVIEW
    await seed(u.id, "rem", { title: "합성 할 일", due: at(24 * HOUR) }, "create_reminder"),
    await seed(u.id, "done", { title: "합성 이미 추가", start: at(24 * HOUR), uncertain: [] }),
    await seed(u.id, "stale", { title: "합성 바뀐 제안", start: at(24 * HOUR), uncertain: [] }),
  ];
  const [late, soon, grace, past, old, unc, date, rem, done, stale] = s;
  try {
    await sb.from("proposals").update({ created_at: new Date(Date.now() - 31 * 24 * HOUR).toISOString() }).eq("id", old.proposal);
    await sb.from("proposals").update({ status: "succeeded" }).eq("id", done.proposal);
    await sb.from("proposals").update({ status: "stale", version: 2 }).eq("id", stale.proposal);
    await sb.from("proposals").update({ version: 3 }).eq("id", late.proposal);

    const { data, error } = await c.rpc("list_pending_proposals");
    assertEquals(error, null);
    const mine = (data as Row[]).filter((r) => s.some((x) => x.proposal === r.proposal_id));
    assertEquals(ids(mine), [grace.proposal, soon.proposal, late.proposal]);
    for (const x of [past, old, unc, date, rem, done, stale]) assert(!ids(data).includes(x.proposal));
    const l = mine[2];
    assertEquals([l.action, l.title, l.location, l.version], ["ADD_EVENT", "합성 늦은 진료", "합성의원 3층", 3]);
    assertEquals([Date.parse(l.start) - Date.now() > 47 * HOUR, l.end !== null && Date.parse(l.end) - Date.parse(l.start)], [true, HOUR]);
    assertEquals([mine[1].end, mine[1].location], [null, null]);

    const { data: other } = await c2.rpc("list_pending_proposals");                                // 다른 사용자 격리
    for (const x of s) assert(!ids(other).includes(x.proposal));
  } finally {
    await cleanup(u.id, s.map((x) => x.item));
  }
});

Deno.test("dismiss_proposal: ok (idempotent) → dismissed and off the list; not_pending; not_found for others; anon rejected", async () => {
  const { u, c } = await userClient(1);
  const { c: c2 } = await userClient(2);
  const a = await seed(u.id, "d-a", { title: "합성 무시할 일정", start: at(24 * HOUR), uncertain: [] });
  const b = await seed(u.id, "d-b", { title: "합성 추가된 일정", start: at(24 * HOUR), uncertain: [] });
  try {
    assertEquals((await c2.rpc("dismiss_proposal", { p_proposal: a.proposal })).data, "not_found");   // 남의 제안
    const { data: pa0 } = await sb.from("proposals").select("status").eq("id", a.proposal).single();
    assertEquals(pa0!.status, "proposed");

    assertEquals((await c.rpc("dismiss_proposal", { p_proposal: a.proposal })).data, "ok");
    assertEquals((await c.rpc("dismiss_proposal", { p_proposal: a.proposal })).data, "ok");          // 재시도(알림 액션 재전송)
    const { data: pa } = await sb.from("proposals").select("status").eq("id", a.proposal).single();
    assertEquals(pa!.status, "dismissed");
    assert(!ids((await c.rpc("list_pending_proposals")).data).includes(a.proposal));

    await sb.from("proposals").update({ status: "succeeded" }).eq("id", b.proposal);
    assertEquals((await c.rpc("dismiss_proposal", { p_proposal: b.proposal })).data, "not_pending");
    const { data: pb } = await sb.from("proposals").select("status").eq("id", b.proposal).single();
    assertEquals(pb!.status, "succeeded");
    assertEquals((await c.rpc("dismiss_proposal", { p_proposal: crypto.randomUUID() })).data, "not_found");

    const anon = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, SERVER_AUTH);
    const r1 = await anon.rpc("dismiss_proposal", { p_proposal: b.proposal });
    const r2 = await anon.rpc("list_pending_proposals");
    assert(r1.error !== null && r1.data === null);
    assert(r2.error !== null && r2.data === null);
  } finally {
    await cleanup(u.id, [a.item, b.item]);
  }
});

Deno.test("report_execution after dismiss: the user's later add wins (dismissed → succeeded)", async () => {
  const { u, c } = await userClient(1);
  const a = await seed(u.id, "d-add", { title: "합성 무시 후 추가", start: at(24 * HOUR), uncertain: [] });
  try {
    assertEquals((await c.rpc("dismiss_proposal", { p_proposal: a.proposal })).data, "ok");
    const r = await c.rpc("report_execution", { p_proposal: a.proposal, p_device: `${RUN}:dev`, p_eventkit_id: "EK-D", p_version: 1,
      p_executed_at: new Date().toISOString() });
    assertEquals(r.data, "ok");
    const { data: pa } = await sb.from("proposals").select("status, eventkit_id").eq("id", a.proposal).single();
    assertEquals([pa!.status, pa!.eventkit_id], ["succeeded", "EK-D"]);
    assertEquals((await c.rpc("dismiss_proposal", { p_proposal: a.proposal })).data, "not_pending");
  } finally {
    await cleanup(u.id, [a.item]);
  }
});
