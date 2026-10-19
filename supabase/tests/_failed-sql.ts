import { assert, assertEquals } from "jsr:@std/assert";

// 0034 SQL 사례(0.16.1 처리 실패 항목): PGlite(로컬, failed-sql.test.ts)와 호스팅 롤백 트랜잭션(failed-db.test.ts)이 같은 사례를 돈다.
// 사례마다 실행자가 롤백한다. 값은 합성 글·키만(멱등 키 접두 = 실행 태그)
// deno-lint-ignore no-explicit-any
export type Row = Record<string, any>;
export type Q = (sql: string, params?: unknown[]) => Promise<Row[]>;
export type FCtx = { q: Q; user: string; tag: string };
export const MIGRATION_0034 = new URL("../migrations/0034_item_failed.sql", import.meta.url);

const one = async (q: Q, sql: string, p: unknown[] = []) => (await q(sql, p))[0];
const insert = async (c: FCtx, key: string, o: { source?: string; body?: string; title?: string | null } = {}) =>
  (await one(c.q, `select insert_item($1::uuid, $2, $3, null, $4, convert_to($5, 'UTF8'), '2026-10-19T03:00:00Z'::timestamptz, true, '채팅', null, null, false) as id`,
    [c.user, o.source ?? "SHARE", `${o.source ?? "SHARE"}:${c.tag}-${key}`, o.title ?? null, o.body ?? "합성 글"])).id as string | null;
const item = (c: FCtx, id: string) => one(c.q, "select status, title, convert_from(content_enc, 'UTF8') as body, occurred_at, gate_label, gate_confidence from items where id = $1::uuid", [id]);
const jobsOf = (c: FCtx, id: string) => c.q("select id, kind, status, lease_key, payload from jobs where user_id = $1::uuid and payload->>'item_id' = $2 order by created_at, status", [c.user, id]);
// 실제 dead 경로(fail_job, attempts ≥ 5) — 0030 사례와 같다
const dead = async (c: FCtx, jobId: string) => {
  await c.q("update jobs set attempts = 5 where id = $1::uuid", [jobId]);
  await c.q("select fail_job($1::uuid, 'test')", [jobId]);
};
const addJob = async (c: FCtx, kind: string, payload: Record<string, unknown>) =>
  (await one(c.q, "insert into jobs (kind, user_id, lease_key, payload) values ($1, $2::uuid, $3, $4::text::jsonb) returning id",
    [kind, c.user, `${c.tag}:${kind}`, JSON.stringify(payload)])).id as string;

// retry_item 은 auth.uid() 로만 사용자를 정한다 — Supabase auth.uid() 는 claim.sub·claims.sub 둘 다 읽는다(PGlite 스텁은 claim.sub). 트랜잭션 안에서만
const as = async (c: FCtx, user: string | null) => {
  await c.q("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true)", [user ?? "", user ? JSON.stringify({ sub: user }) : ""]);
};
const retry = async (c: FCtx, id: string, user: string | null = c.user) => { await as(c, user); return (await one(c.q, "select retry_item($1::uuid) as r", [id])).r as string; };
const job = (c: FCtx, id: string) => one(c.q, "select status, attempts, not_before, last_error, leased_until from jobs where id = $1::uuid", [id]);

export const FAILED_CASES: { name: string; run(c: FCtx): Promise<void> }[] = [
  { name: "process job dead (fail_job attempts 5) on a queued item → item failed; earlier failures keep it queued", run: async (c) => {
    const id = (await insert(c, "a"))!;
    const [j] = await jobsOf(c, id);
    await c.q("update jobs set attempts = 2 where id = $1::uuid", [j.id]);
    await c.q("select fail_job($1::uuid, 'openai_500 -')", [j.id]);
    assertEquals((await item(c, id)).status, "queued");                          // 백오프 중 — 아직 실패 아님
    await dead(c, j.id);
    assertEquals([(await item(c, id)).status, (await jobsOf(c, id))[0].status], ["failed", "dead"]);
  } },
  { name: "extract job dead → item failed; embed or notify dead → item unchanged", run: async (c) => {
    const a = (await insert(c, "b"))!, b = (await insert(c, "c"))!;
    await dead(c, await addJob(c, "extract", { item_id: a }));
    await dead(c, await addJob(c, "embed", { item_id: b }));
    assertEquals([(await item(c, a)).status, (await item(c, b)).status], ["failed", "queued"]);
  } },
  { name: "dead job but the item is already extracted or discarded → status unchanged", run: async (c) => {
    const a = (await insert(c, "d"))!, b = (await insert(c, "e"))!;
    await c.q("update items set status = 'extracted' where id = $1::uuid", [a]);
    await c.q("update items set status = 'discarded:server:empty' where id = $1::uuid", [b]);
    for (const id of [a, b]) await dead(c, (await jobsOf(c, id))[0].id);
    assertEquals([(await item(c, a)).status, (await item(c, b)).status], ["extracted", "discarded:server:empty"]);
  } },
  { name: "a dead job whose payload item_id is not a uuid still goes dead (the trigger never blocks fail_job)", run: async (c) => {
    const j = await addJob(c, "process", { item_id: "not-a-uuid" });
    await dead(c, j);
    assertEquals((await one(c.q, "select status from jobs where id = $1::uuid", [j])).status, "dead");
  } },
  { name: "resend with the same key on a failed item → same id back, queued with the new body/title, gate cleared, a new process job", run: async (c) => {
    const id = (await insert(c, "f", { body: "합성 글 1", title: "옛 제목" }))!;
    await c.q("update items set gate_label = 'actionable', gate_confidence = 0.9 where id = $1::uuid", [id]);
    await dead(c, (await jobsOf(c, id))[0].id);
    assertEquals((await item(c, id)).status, "failed");
    assertEquals(await insert(c, "f", { body: "합성 글 2", title: "새 제목" }), id);
    const it = await item(c, id);
    assertEquals([it.status, it.title, it.gate_label, it.gate_confidence], ["queued", "새 제목", null, null]);
    assertEquals(it.body, "합성 글 2");
    const js = await jobsOf(c, id);
    assertEquals(js.map((j) => [j.kind, j.status]).sort(), [["process", "dead"], ["process", "queued"]]);
    assert(js.every((j) => j.lease_key === `item:${id}` && j.payload.item_id === id));
  } },
  { name: "resend with the same key on a queued or extracted item → null (duplicate), no new job; a second resend after revival is a duplicate too", run: async (c) => {
    const a = (await insert(c, "g"))!;
    assertEquals(await insert(c, "g"), null);
    await c.q("update items set status = 'extracted' where id = $1::uuid", [a]);
    assertEquals(await insert(c, "g"), null);
    assertEquals((await jobsOf(c, a)).length, 1);
    const b = (await insert(c, "h"))!;
    await dead(c, (await jobsOf(c, b))[0].id);
    assertEquals([await insert(c, "h"), await insert(c, "h")], [b, null]);
    assertEquals((await jobsOf(c, b)).length, 2);
  } },
  { name: "GMAIL failed item is not revived by a re-sync (insert_item → null, stays failed)", run: async (c) => {
    await c.q("insert into connections (user_id, provider, account_ref, status) values ($1::uuid, 'gmail', $2, 'active')", [c.user, `${c.tag}@example.com`]);
    const id = (await insert(c, "i", { source: "GMAIL" }))!;
    await dead(c, (await jobsOf(c, id))[0].id);
    assertEquals([await insert(c, "i", { source: "GMAIL" }), (await item(c, id)).status, (await jobsOf(c, id)).length], [null, "failed", 1]);
  } },

  // ── retry_item(0.16.1 추가 1): 저장된 글로 다시 처리 ──
  { name: "retry_item: failed item → queued; its dead job back to queued with attempts 0 and no not_before/last_error/lease (same job, no new one); audit retry", run: async (c) => {
    const id = (await insert(c, "r1"))!;
    const [j] = await jobsOf(c, id);
    await dead(c, j.id);
    assertEquals(await retry(c, id), "queued");
    assertEquals((await item(c, id)).status, "queued");
    const js = await jobsOf(c, id);
    assertEquals(js.length, 1);
    const r = await job(c, j.id);
    assertEquals([r.status, r.attempts, r.not_before, r.last_error, r.leased_until], ["queued", 0, null, null, null]);
    const a = await c.q("select actor, action, target from audit_log where user_id = $1::uuid and action = 'retry'", [c.user]);
    assertEquals(a.map((x) => [x.actor, x.action, x.target]), [["user", "retry", id]]);
  } },
  { name: "retry_item: queued item whose job is dead (before 0034) or missing → queued; a missing job gets a new process job", run: async (c) => {
    const a = (await insert(c, "r2"))!, b = (await insert(c, "r3"))!;
    await dead(c, (await jobsOf(c, a))[0].id);
    await c.q("update items set status = 'queued' where id = $1::uuid", [a]);              // 0034 전에 dead 가 된 항목
    await c.q("delete from jobs where user_id = $1::uuid and payload->>'item_id' = $2", [c.user, b]);
    assertEquals([await retry(c, a), await retry(c, b)], ["queued", "queued"]);
    assertEquals((await jobsOf(c, a)).map((j) => j.status), ["queued"]);
    const nb = await jobsOf(c, b);
    assertEquals(nb.map((j) => [j.kind, j.status, j.lease_key, j.payload.item_id]), [["process", "queued", `item:${b}`, b]]);
  } },
  { name: "retry_item: job queued or running (deferred included) → processing, nothing changes", run: async (c) => {
    const a = (await insert(c, "r4"))!;
    const [j] = await jobsOf(c, a);
    await c.q("update jobs set not_before = now() + interval '30 minutes', last_error = 'llm_unavailable' where id = $1::uuid", [j.id]);
    assertEquals(await retry(c, a), "processing");
    await c.q("update jobs set status = 'running' where id = $1::uuid", [j.id]);
    assertEquals(await retry(c, a), "processing");
    assertEquals([(await job(c, j.id)).last_error, (await item(c, a)).status], ["llm_unavailable", "queued"]);
  } },
  { name: "retry_item: extracted or discarded item → not_failed (no job change); another user's item or unknown id → not_found; no session → error", run: async (c) => {
    const a = (await insert(c, "r5"))!, b = (await insert(c, "r6"))!;
    await c.q("update items set status = 'extracted' where id = $1::uuid", [a]);
    await c.q("update items set status = 'discarded:server:empty' where id = $1::uuid", [b]);
    for (const id of [a, b]) await c.q("update jobs set status = 'done' where user_id = $1::uuid and payload->>'item_id' = $2", [c.user, id]);
    assertEquals([await retry(c, a), await retry(c, b)], ["not_failed", "not_failed"]);
    assertEquals((await jobsOf(c, a)).map((j) => j.status), ["done"]);
    const f = (await insert(c, "r7"))!;
    await dead(c, (await jobsOf(c, f))[0].id);
    assertEquals(await retry(c, f, crypto.randomUUID()), "not_found");                // 남의 항목 — 상태 그대로
    assertEquals(await retry(c, crypto.randomUUID()), "not_found");
    assertEquals((await item(c, f)).status, "failed");
    await c.q("savepoint no_session");
    let code = "";
    try { await retry(c, f, null); } catch (e) { code = String((e as { code?: string }).code ?? e); }
    await c.q("rollback to savepoint no_session");
    assertEquals(code, "28000");
  } },
  { name: "retry_item: failed item without body, OCR or stored object → expired", run: async (c) => {
    const id = (await insert(c, "r8"))!;
    await dead(c, (await jobsOf(c, id))[0].id);
    await c.q("update items set content_enc = null, ocr_text_enc = null, storage_key = null where id = $1::uuid", [id]);
    assertEquals([await retry(c, id), (await item(c, id)).status], ["expired", "failed"]);
  } },
  { name: "retry_item privileges: authenticated may execute, anon and public may not", run: async (c) => {
    const r = await one(c.q, `select has_function_privilege('authenticated', 'public.retry_item(uuid)', 'execute') as auth,
      has_function_privilege('anon', 'public.retry_item(uuid)', 'execute') as anon`);
    assertEquals([r.auth, r.anon], [true, false]);
  } },
];
