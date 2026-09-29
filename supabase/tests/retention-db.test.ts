import { assert, assertEquals } from "jsr:@std/assert";
import { encrypt, toBytea } from "../functions/_shared/crypto.ts";
import { delay } from "jsr:@std/async/delay";
import postgres from "npm:postgres@3";
import { deleteRunJobs, RUN, service as sb, testUser, userClient } from "./_testenv.ts";

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
    // 최종 리뷰 m-7: embed 잡(일반 embed:<id>·백필 레인)도 payload.item_id 로 지운다
    { kind: "embed", lease_key: `embed:${g1}`, payload: { item_id: g1 } },
    { kind: "embed", lease_key: `backfill:${me}`, payload: { item_id: g2, backfill: true } },
    // 브리프 이탈 (a) 회귀 보호: watch·태그 붙은 reauth 잡도 payload.connection_id 로 지운다
    { kind: "gmail-watch", lease_key: `${RUN}:watch:${conn}`, payload: { connection_id: conn } },
    { kind: "gmail-reauth", lease_key: `${RUN}:reauth:${conn}`, payload: { connection_id: conn } },
  ].map((j) => ({ ...j, user_id: me, status: "done" }));
  const { data: jrows } = await sb.from("jobs").insert(jobs).select("id, lease_key");
  try {
    const { data: r } = await sb.rpc("delete_gmail_source", { p_user: me, p_connection: conn });
    assertEquals(r, { items: 2, facts: 1, jobs: 8 });
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

// 경합 재현용 직접 트랜잭션. 연결 정보는 scripts/sql.ts 와 같다(pooler-url + DB 비밀번호)
async function pg() {
  const url = new URL((await Deno.readTextFile(new URL("../.temp/pooler-url", import.meta.url))).trim());
  return postgres({ host: url.hostname, port: Number(url.port || 5432), database: url.pathname.slice(1) || "postgres",
    username: decodeURIComponent(url.username), password: Deno.env.get("SUPABASE_DB_PASSWORD")!, ssl: "require", prepare: false,
    onnotice: () => {} });
}

// 최종 리뷰 I-1: 출처 삭제(T1)가 facts 를 지운 뒤 items 를 지우기 전에 진행 중이던 save_fact(T2)가 커밋되면,
// 그 fact·제안이 item_id null 로 살아남으면 안 된다(스펙 §8 출처 삭제 → facts·proposals, §12 통제 5). 삭제 뒤 save_fact 는 실패한다
Deno.test("delete_gmail_source vs in-flight save_fact: the racing fact and proposal go with the item; save_fact after delete fails", async () => {
  const me = (await testUser()).id;
  const { data: conn } = await sb.rpc("gmail_save_connection", { p_user: me, p_account_ref: `${RUN}-race-${crypto.randomUUID()}@example.com`,
    p_refresh_token: "synthetic-rt", p_history_id: "1" });
  const { data: g } = await sb.rpc("insert_item", { p_user: me, p_source: "GMAIL", p_idempotency_key: `gmail:${RUN}-race`, p_sender: null,
    p_title: null, p_content_enc: await bytes(me, "합성"), p_occurred_at: new Date().toISOString(), p_enqueue: false });
  const payload = JSON.stringify({ title: "합성", start: "2026-12-01T10:00:00+09:00", uncertain: [] });
  const sql = await pg();
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const saved: { fact?: string; proposal?: string; err?: unknown } = {};
  try {
    // T2 = 워커의 save_fact: fact insert(FK 가 item 행에 KEY SHARE)까지 하고 커밋 전에 멈춘다
    const t2 = sql.begin(async (tx) => {
      const [r] = await tx.unsafe(`select out_fact_id, out_proposal_id from save_fact($1::uuid, $2::uuid, 'event', $3::text::jsonb, '합성', 'create_event')`,
        [me, g as string, payload]);
      saved.fact = r.out_fact_id;
      saved.proposal = r.out_proposal_id;
      await gate;
    }).catch((e) => { saved.err = e; });
    while (!saved.fact && !saved.err) await delay(50);
    if (saved.err) throw saved.err;
    // T1 = 출처 삭제: facts 삭제(T2 의 fact 는 아직 안 보임) 뒤 items 삭제에서 T2 를 기다린다
    let settled = false;
    const t1 = sb.rpc("delete_gmail_source", { p_user: me, p_connection: conn }).then((x) => (settled = true, x));
    await delay(1500);
    assert(!settled, "delete should wait on the in-flight fact insert");
    release();
    await t2;
    const { data: r, error } = await t1;
    assert(error === null && (r as { items: number }).items >= 1);            // 범위는 사용자 Gmail 항목 전부(이전 실행 잔여 포함)
    const { count: facts } = await sb.from("facts").select("id", { count: "exact", head: true }).eq("id", saved.fact!);
    const { count: props } = await sb.from("proposals").select("id", { count: "exact", head: true }).eq("id", saved.proposal!);
    const { count: orphans } = await sb.from("facts").select("id", { count: "exact", head: true }).eq("user_id", me).is("item_id", null);
    // 워커가 이어서 적재한 notify 잡은 제안을 못 찾아 skipped 로 끝난다(worker/notify.ts not_found)
    const { data: wp } = await sb.rpc("worker_get_proposal", { p_user: me, p_proposal: saved.proposal! });
    assertEquals([facts, props, orphans, (wp as unknown[]).length], [0, 0, 0, 0]);
    const late = await sb.rpc("save_fact", { p_user: me, p_item: g, p_kind: "event", p_payload: JSON.parse(payload), p_evidence: "합성",
      p_action: "create_event" });
    assert(late.error !== null, "save_fact on a deleted item must fail");
  } finally {
    release();
    await sql.end();
    if (saved.fact) await sb.from("facts").delete().eq("user_id", me).eq("id", saved.fact);
    await sb.from("items").delete().eq("user_id", me).eq("id", g as string);
    await sb.from("connections").delete().eq("id", conn);
    await sb.from("audit_log").delete().eq("user_id", me).eq("action", "source_delete");
  }
});

// 리뷰 #1a: 출처 삭제가 커밋된 뒤의 insert_item(GMAIL)은 저장하지 않는다(진행 중 fetch 가 되살리지 못함). 다른 출처는 그대로
Deno.test("insert_item GMAIL: null without a live gmail connection (deleted or disconnected); stored while connected", async () => {
  const me = (await testUser()).id;
  const args = async (source: string, key: string) => ({ p_user: me, p_source: source, p_idempotency_key: key, p_sender: null, p_title: null,
    p_content_enc: await bytes(me, "합성"), p_occurred_at: new Date().toISOString(), p_enqueue: false });
  const { data: conn } = await sb.rpc("gmail_save_connection", { p_user: me, p_account_ref: `${RUN}-ins-${crypto.randomUUID()}@example.com`,
    p_refresh_token: "synthetic-rt", p_history_id: "1" });
  const keys = [`gmail:${RUN}-live`, `gmail:${RUN}-disc`, `gmail:${RUN}-gone`, `${RUN}:n-gone`];
  try {
    const live = await sb.rpc("insert_item", await args("GMAIL", keys[0]));
    assert(typeof live.data === "string");
    await sb.from("connections").update({ status: "disconnected" }).eq("id", conn);
    assertEquals((await sb.rpc("insert_item", await args("GMAIL", keys[1]))).data, null);
    await sb.rpc("delete_gmail_source", { p_user: me, p_connection: conn });
    const gone = await sb.rpc("insert_item", await args("GMAIL", keys[2]));
    assertEquals([gone.error, gone.data], [null, null]);
    assert(typeof (await sb.rpc("insert_item", await args("NOTIFICATION", keys[3]))).data === "string");
    const { count } = await sb.from("items").select("id", { count: "exact", head: true }).eq("user_id", me).eq("source", "GMAIL").in("idempotency_key", keys);
    assertEquals(count, 0);
  } finally {
    await sb.from("items").delete().eq("user_id", me).in("idempotency_key", keys);
    await sb.from("connections").delete().eq("id", conn);
    await sb.from("audit_log").delete().eq("user_id", me).eq("action", "source_delete");
  }
});

// 리뷰 #1b: 연결이 이미 없는데 남은 Gmail 항목(수정 전 경합으로 되살아난 것)은 p_connection null 로 지운다
Deno.test("delete_gmail_source(p_connection null): removes leftover Gmail items and gmail-* jobs with no connection; unknown connection id raises", async () => {
  const me = (await testUser()).id;
  const { data: row } = await sb.from("items").insert({ user_id: me, source: "GMAIL", idempotency_key: `gmail:${RUN}-left`,
    content_enc: await bytes(me, "합성"), occurred_at: new Date().toISOString() }).select("id").single();
  const { data: jrows } = await sb.from("jobs").insert([
    { kind: "process", lease_key: `item:${row!.id}`, payload: { item_id: row!.id } },
    { kind: "gmail-fetch", lease_key: `${RUN}:gmail:gone`, payload: { connection_id: crypto.randomUUID(), ids: ["x"] } },
  ].map((j) => ({ ...j, user_id: me, status: "done" }))).select("id");
  try {
    const bad = await sb.rpc("delete_gmail_source", { p_user: me, p_connection: crypto.randomUUID() });
    assertEquals(bad.error?.code, "P0002");
    const { data: r } = await sb.rpc("delete_gmail_source", { p_user: me, p_connection: null });
    assertEquals(r, { items: 1, facts: 0, jobs: 2 });
  } finally {
    await sb.from("jobs").delete().in("id", jrows!.map((j) => j.id));
    await sb.from("items").delete().eq("user_id", me).eq("id", row!.id);
    await sb.from("audit_log").delete().eq("user_id", me).eq("action", "source_delete");
  }
});

// 리뷰 Minor 7: 이미지·PDF 는 30일 만료, 만료되면 worker_expired_media 가 잡는다
Deno.test("insert_media_item: 30-day expiry and an extract job; expired media listed by worker_expired_media", async () => {
  const me = (await testUser()).id;
  const { data: id } = await sb.rpc("insert_media_item", { p_user: me, p_source: "SHARE", p_idempotency_key: `${RUN}:media`,
    p_storage_key: `media/${me}/${RUN}.jpg`, p_ocr_text_enc: await bytes(me, "합성 OCR"), p_occurred_at: new Date().toISOString(), p_lease_key: `${RUN}:media` });
  try {
    const { data: it } = await sb.from("items").select("expires_at").eq("id", id as string).single();
    const days = (Date.parse(it!.expires_at) - Date.now()) / 86_400_000;
    assert(days > 29.9 && days < 30.01, String(days));
    const { count: jobs } = await sb.from("jobs").select("id", { count: "exact", head: true }).eq("lease_key", `${RUN}:media`).eq("kind", "extract");
    assertEquals(jobs, 1);
    await sb.from("items").update({ expires_at: new Date(Date.now() - 60_000).toISOString() }).eq("id", id as string);
    const { data: ex } = await sb.rpc("worker_expired_media", { p_limit: 100 });
    assert((ex as { item_id: string }[]).some((r) => r.item_id === id));
  } finally {
    await deleteRunJobs();
    await sb.from("items").delete().eq("user_id", me).eq("id", id as string);
  }
});

// 배포된 account/source: 연결이 없는데 Gmail 항목이 남은 사용자 9(리뷰 #1b 경로를 배포본으로)
Deno.test({ name: "deployed account/source with no connection deletes leftover Gmail items", ignore: Deno.env.get("DEPLOYED") !== "1", fn: async () => {
  const { u, c } = await userClient(9);
  const { data: row } = await sb.from("items").insert({ user_id: u.id, source: "GMAIL", idempotency_key: `gmail:${RUN}-dep`,
    content_enc: await bytes(u.id, "합성"), occurred_at: new Date().toISOString() }).select("id").single();
  const token = (await c.auth.getSession()).data.session!.access_token;
  try {
    const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/account/source`, { method: "POST",
      headers: { authorization: `Bearer ${token}`, apikey: Deno.env.get("SUPABASE_ANON_KEY")!, "content-type": "application/json" },
      body: JSON.stringify({ provider: "gmail" }) });
    assertEquals(r.status, 200);
    const b = await r.json();
    assertEquals([b.connections, b.deleted[0].items], [0, 1]);
    const { count } = await sb.from("items").select("id", { count: "exact", head: true }).eq("id", row!.id);
    assertEquals(count, 0);
  } finally {
    await sb.from("items").delete().eq("user_id", u.id).eq("id", row!.id);
    await sb.from("audit_log").delete().eq("user_id", u.id).eq("action", "source_delete");
  }
} });

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
