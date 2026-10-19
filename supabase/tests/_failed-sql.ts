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
];
