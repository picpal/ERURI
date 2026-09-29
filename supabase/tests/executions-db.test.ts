import { assert, assertEquals } from "jsr:@std/assert";
import { createClient } from "npm:@supabase/supabase-js@2";
import { encrypt, SERVER_AUTH, toBytea } from "../functions/_shared/crypto.ts";
import { RUN, service as sb, userClient } from "./_testenv.ts";

// 호스팅 DB. 전용 테스트 사용자·실행 태그만(AGENTS.md §7). 스펙 §10 순서 4·5
async function seedProposal(user: string, tag: string): Promise<{ item: string; proposal: string }> {
  const { data: item } = await sb.rpc("insert_item", { p_user: user, p_source: "NOTIFICATION", p_idempotency_key: `${RUN}:exec:${tag}`,
    p_sender: null, p_title: null, p_content_enc: toBytea(await encrypt(user, "[합성의원] 합성 진료")), p_occurred_at: new Date().toISOString(), p_enqueue: false });
  const { data } = await sb.rpc("save_fact", { p_user: user, p_item: item, p_kind: "event",
    p_payload: { title: "합성 진료", start: "2026-12-01T15:00:00+09:00", uncertain: [] }, p_evidence: "합성", p_action: "create_event" });
  return { item: item as string, proposal: (data as { out_proposal_id: string }[])[0].out_proposal_id };
}

Deno.test("report_execution: ok once (idempotent), changed on version mismatch, stale, other user's proposal not_found", async () => {
  const { u, c } = await userClient(1);
  const { c: c2 } = await userClient(2);
  const a = await seedProposal(u.id, "a"), b = await seedProposal(u.id, "b"), s = await seedProposal(u.id, "s");
  const args = (p: string, version = 1) => ({ p_proposal: p, p_device: `${RUN}:dev`, p_eventkit_id: "EK-1", p_version: version, p_executed_at: new Date().toISOString() });
  try {
    assertEquals((await c.rpc("report_execution", args(a.proposal))).data, "ok");
    assertEquals((await c.rpc("report_execution", args(a.proposal))).data, "ok");                 // 보고 재전송
    const { data: ex } = await sb.from("executions").select("eventkit_id").eq("proposal_id", a.proposal);
    const { data: pa } = await sb.from("proposals").select("status, eventkit_id").eq("id", a.proposal).single();
    assertEquals([ex!.length, pa!.status, pa!.eventkit_id], [1, "succeeded", "EK-1"]);
    await sb.from("proposals").update({ version: 2 }).eq("id", b.proposal);
    assertEquals((await c.rpc("report_execution", args(b.proposal, 1))).data, "changed");
    await sb.from("proposals").update({ status: "stale" }).eq("id", s.proposal);
    assertEquals((await c.rpc("report_execution", args(s.proposal))).data, "stale");
    assertEquals((await c2.rpc("report_execution", args(a.proposal))).data, "not_found");          // RLS 밖: 남의 제안
    assertEquals((await c.rpc("report_execution", args(crypto.randomUUID()))).data, "not_found");
  } finally {
    const items = [a.item, b.item, s.item];
    await sb.from("facts").delete().eq("user_id", u.id).in("item_id", items);                      // proposals·executions cascade
    await sb.from("items").delete().eq("user_id", u.id).in("id", items);
  }
});

Deno.test("worker_get_proposal returns version; anon cannot call report_execution", async () => {
  const { u } = await userClient(1);
  const a = await seedProposal(u.id, "v");
  try {
    const { data } = await sb.rpc("worker_get_proposal", { p_user: u.id, p_proposal: a.proposal });
    assertEquals((data as { version: number }[])[0].version, 1);
    const anon = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, SERVER_AUTH);
    const r = await anon.rpc("report_execution", { p_proposal: a.proposal, p_device: `${RUN}:anon`, p_eventkit_id: "EK-X", p_version: 1, p_executed_at: new Date().toISOString() });
    assert(r.error !== null && r.data === null);
    const { data: ex } = await sb.from("executions").select("id").eq("proposal_id", a.proposal);
    assertEquals(ex ?? [], []);
  } finally {
    await sb.from("facts").delete().eq("user_id", u.id).eq("item_id", a.item);
    await sb.from("items").delete().eq("user_id", u.id).eq("id", a.item);
  }
});
