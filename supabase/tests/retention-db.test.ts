import { assert, assertEquals } from "jsr:@std/assert";
import { encrypt, toBytea } from "../functions/_shared/crypto.ts";
import { RUN, service as sb, testUser, userClient } from "./_testenv.ts";

const bytes = async (u: string, t: string) => toBytea(await encrypt(u, t));

Deno.test("purge_expired (scoped): expired body and chunks go, row/facts stay; unexpired untouched", async () => {
  const me = (await testUser()).id;
  const mk = async (tag: string) => (await sb.rpc("insert_item", { p_user: me, p_source: "NOTIFICATION", p_idempotency_key: `${RUN}:exp:${tag}`,
    p_sender: null, p_title: "합성", p_content_enc: await bytes(me, "합성 본문"), p_occurred_at: new Date().toISOString(), p_enqueue: false })).data as string;
  const old = await mk("old"), fresh = await mk("fresh");
  try {
    await sb.from("item_chunks").insert({ item_id: old, user_id: me, chunk_index: 0, text: "합성 청크" });
    await sb.from("facts").insert({ user_id: me, item_id: old, kind: "task", payload: { title: "합성" }, evidence: "합성" });
    await sb.from("items").update({ expires_at: new Date(Date.now() - 60_000).toISOString() }).eq("id", old);
    assertEquals((await sb.rpc("purge_expired", { p_user: me })).data, 1);
    const { data: o } = await sb.from("items").select("id").eq("id", old).is("content_enc", null);
    const { data: f } = await sb.from("items").select("id").eq("id", fresh).not("content_enc", "is", null);
    const { count: chunks } = await sb.from("item_chunks").select("id", { count: "exact", head: true }).eq("item_id", old);
    const { count: facts } = await sb.from("facts").select("id", { count: "exact", head: true }).eq("item_id", old);
    assertEquals([o!.length, f!.length, chunks, facts], [1, 1, 0, 1]);
  } finally {
    await sb.from("facts").delete().eq("user_id", me).in("item_id", [old, fresh]);
    await sb.from("items").delete().eq("user_id", me).in("id", [old, fresh]);
  }
});

// Review Focus 5: 출처 삭제 뒤 남은 잡이 메일을 되살리지 않는다
Deno.test("delete_gmail_source: Gmail items, their facts/proposals, and all Gmail/backfill/item jobs go; other sources and vault token handled", async () => {
  const me = (await testUser()).id;
  const { data: conn } = await sb.rpc("gmail_save_connection", { p_user: me, p_account_ref: `${RUN}-src-${crypto.randomUUID()}@example.com`,
    p_refresh_token: "synthetic-rt", p_history_id: "1" });
  const ins = async (source: string, key: string) => (await sb.rpc("insert_item", { p_user: me, p_source: source, p_idempotency_key: key,
    p_sender: null, p_title: null, p_content_enc: await bytes(me, "합성"), p_occurred_at: new Date().toISOString(), p_enqueue: false })).data as string;
  const g1 = await ins("GMAIL", `gmail:${RUN}-g1`), g2 = await ins("GMAIL", `gmail:${RUN}-g2`), n1 = await ins("NOTIFICATION", `${RUN}:n1`);
  const { data: saved } = await sb.rpc("save_fact", { p_user: me, p_item: g1, p_kind: "event", p_payload: { title: "합성", start: "2026-12-01T10:00:00+09:00", uncertain: [] },
    p_evidence: "합성", p_action: "create_event" });
  const proposal = (saved as { out_proposal_id: string }[])[0].out_proposal_id;
  // 워커 cron 이 가져가지 않게 done 상태로 넣는다(삭제는 상태와 무관)
  const jobs = [
    { kind: "gmail-fetch", lease_key: `backfill:${me}`, payload: { connection_id: conn, ids: ["x"], backfill: true } },
    { kind: "gmail-sync", lease_key: `gmail:${conn}`, payload: { connection_id: conn } },
    { kind: "process", lease_key: `item:${g2}`, payload: { item_id: g2 } },
    { kind: "notify", lease_key: `notify:${proposal}`, payload: { proposal_id: proposal } },
    { kind: "process", lease_key: `item:${n1}`, payload: { item_id: n1 } },
  ].map((j) => ({ ...j, user_id: me, status: "done" }));
  const { data: jrows } = await sb.from("jobs").insert(jobs).select("id, lease_key");
  try {
    const { data: r } = await sb.rpc("delete_gmail_source", { p_user: me, p_connection: conn });
    assertEquals(r, { items: 2, facts: 1, jobs: 4 });
    const { count: gi } = await sb.from("items").select("id", { count: "exact", head: true }).eq("user_id", me).in("id", [g1, g2]);
    const { count: ni } = await sb.from("items").select("id", { count: "exact", head: true }).eq("id", n1);
    const { count: pr } = await sb.from("proposals").select("id", { count: "exact", head: true }).eq("id", proposal);
    const left = (await sb.from("jobs").select("lease_key").in("id", jrows!.map((j) => j.id))).data!.map((j) => j.lease_key);
    const { count: cn } = await sb.from("connections").select("id", { count: "exact", head: true }).eq("id", conn);
    assertEquals([gi, ni, pr, left, cn], [0, 1, 0, [`item:${n1}`], 0]);
    const { data: audit } = await sb.from("audit_log").select("action").eq("user_id", me).eq("action", "source_delete");
    assert(audit!.length >= 1);
  } finally {
    await sb.from("jobs").delete().in("id", jrows!.map((j) => j.id));
    await sb.from("items").delete().eq("user_id", me).in("id", [g1, g2, n1]);
    await sb.from("connections").delete().eq("id", conn);
    await sb.from("audit_log").delete().eq("user_id", me).eq("action", "source_delete");
  }
});

// 배포된 account/delete 를 전용 테스트 사용자 9로 실제 호출한다(revoke·APNs 는 합성 토큰이라 실패로 기록되고 삭제는 진행)
Deno.test({ name: "deployed account/delete removes the caller entirely; audit row stays", ignore: Deno.env.get("DEPLOYED") !== "1", fn: async () => {
  const { u, c } = await userClient(9);
  await sb.rpc("gmail_save_connection", { p_user: u.id, p_account_ref: `${RUN}-del-${crypto.randomUUID()}@example.com`, p_refresh_token: "synthetic-rt", p_history_id: "1" });
  await sb.rpc("insert_item", { p_user: u.id, p_source: "NOTIFICATION", p_idempotency_key: `${RUN}:del`, p_sender: null, p_title: null,
    p_content_enc: await bytes(u.id, "합성"), p_occurred_at: new Date().toISOString(), p_enqueue: false });
  await sb.from("devices").insert({ user_id: u.id, device_id: `${RUN}:dev9`, apns_token: "c".repeat(64), apns_env: "sandbox" });
  const token = (await c.auth.getSession()).data.session!.access_token;
  try {
    const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/account/delete`, { method: "POST",
      headers: { authorization: `Bearer ${token}`, apikey: Deno.env.get("SUPABASE_ANON_KEY")! } });
    assertEquals(r.status, 200);
    assertEquals((await r.json()).deleted, true);
    assert((await sb.auth.admin.getUserById(u.id)).error !== null);
    for (const t of ["items", "connections", "devices", "user_keys", "jobs"]) {
      const { count } = await sb.from(t).select("user_id", { count: "exact", head: true }).eq("user_id", u.id);
      assertEquals(count, 0, t);
    }
    const { data: audit } = await sb.from("audit_log").select("action").eq("user_id", u.id);
    assert(audit!.some((a) => a.action === "account_delete"));
  } finally {
    await sb.from("audit_log").delete().eq("user_id", u.id);                                    // 테스트 사용자 감사 행만
  }
} });
