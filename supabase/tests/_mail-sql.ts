import { assert, assertEquals } from "jsr:@std/assert";

// 0030 SQL 사례(계획 M3): PGlite(로컬, mail-sql.test.ts)와 호스팅 트랜잭션(mail-actions-db.test.ts, M10)이 같은 사례를 돈다.
// 사례마다 한 트랜잭션 안에서 시작해 롤백으로 끝난다(실행자 쪽). 값은 합성 id·주소만
// deno-lint-ignore no-explicit-any
export type Row = Record<string, any>;
export type Q = (sql: string, params?: unknown[]) => Promise<Row[]>;
export type Ctx = { q: Q; user: string; conn: string; prefix: string; tag: string };
export const MIGRATION_0030 = new URL("../migrations-pending/0030_mail_cleanup.sql", import.meta.url);   // M10 Step 3 이 ../migrations/ 로 바꾼다

export const arr = (xs: string[]) => "{" + xs.map((x) => `"${x}"`).join(",") + "}";
const one = async (q: Q, sql: string, p: unknown[] = []) => (await q(sql, p))[0];
export async function setupCtx(q: Q, user: string, tag: string): Promise<Ctx> {
  const conn = (await one(q, "insert into connections (user_id, provider, account_ref, status, scopes) values ($1::uuid, 'gmail', $2, 'active', $3::text[]) returning id",
    [user, `${tag}-${crypto.randomUUID().slice(0, 8)}@example.com`, arr(["https://www.googleapis.com/auth/gmail.modify"])])).id as string;
  return { q, user, conn, prefix: `${tag}:`, tag };
}
const ids3 = (c: Ctx) => ["a", "b", "c"].map((x) => `${c.tag}-${x}`);
const preview = async (c: Ctx, ids = ids3(c), action = "trash") =>
  (await one(c.q, "select mail_action_preview($1::uuid, $2::uuid, $3, $4::text[]) as id", [c.user, c.conn, action, arr(ids)])).id as string;
const call = async (c: Ctx, fn: string, args: string, p: unknown[]) => (await one(c.q, `select ${fn}(${args}) as r`, p)).r;
const start = (c: Ctx, id: string) => call(c, "mail_action_start", "$1::uuid, $2::uuid, $3", [c.user, id, c.prefix]);
const undo = (c: Ctx, id: string) => call(c, "mail_action_undo", "$1::uuid, $2::uuid, $3", [c.user, id, c.prefix]);
const begin = (c: Ctx, id: string, phase: string) => call(c, "mail_action_begin", "$1::uuid, $2::uuid, $3", [c.user, id, phase]);
const progress = (c: Ctx, id: string, phase: string, from: number, to: number, ok: string[], failed: string[]) =>
  call(c, "mail_action_progress", "$1::uuid, $2::uuid, $3, $4::int, $5::int, $6::text[], $7::text[]", [c.user, id, phase, from, to, arr(ok), arr(failed)]);
const finish = (c: Ctx, id: string, phase: string, code: string | null = null) =>
  call(c, "mail_action_finish", "$1::uuid, $2::uuid, $3, $4", [c.user, id, phase, code]);
const row = (c: Ctx, id: string) => one(c.q, `select status, cursor, ok_ids, failed_ids, undo_cursor, undo_failed_ids, error_code, method,
  quota_since, executed_at, undone_at from mail_actions where id = $1::uuid`, [id]);
const jobs = (c: Ctx, id: string) => c.q("select id, kind, lease_key, priority, payload, status from jobs where user_id = $1::uuid and payload->>'id' = $2 order by created_at, payload->>'phase'", [c.user, id]);   // 한 트랜잭션 안은 created_at 이 같다 — execute < undo
const dead = async (c: Ctx, jobId: string) => {                            // 실제 dead 경로(fail_job, attempts ≥ 5)
  await c.q("update jobs set attempts = 5 where id = $1::uuid", [jobId]);
  await c.q("select fail_job($1::uuid, 'test')", [jobId]);
};
export const MAIL_FUNCTIONS = ["gmail_note_units", "gmail_take_units", "mail_connection", "gmail_set_scopes", "gmail_replace_token", "mail_same_set",
  "mail_action_counts", "mail_action_preview", "mail_action_start", "mail_action_undo", "mail_action_status", "mail_action_begin",
  "mail_action_set_method", "mail_action_progress", "mail_action_quota", "mail_action_finish", "mail_action_job_dead", "purge_mail_actions"];
const audits = (c: Ctx, id: string) => c.q("select action, target from audit_log where user_id = $1::uuid and target like $2 order by id", [c.user, `mail_action:${id}%`]);
const done = async (c: Ctx, ok: string[], failed: string[] = []) => {     // 실행을 끝낸 행(되돌리기 사례용)
  const id = await preview(c, [...ok, ...failed]);
  await start(c, id); await begin(c, id, "execute");
  assertEquals(await progress(c, id, "execute", 0, ok.length + failed.length, ok, failed), true);
  await finish(c, id, "execute");
  return id;
};

export const CASES: { name: string; run(c: Ctx): Promise<void> }[] = [
  { name: "start: previewed → pending + one mail-action job (priority 20, lease <prefix>mail:<user>, payload id/phase/connection_id); again → current, no second job", run: async (c) => {
    const id = await preview(c);
    const r1 = await start(c, id);
    assertEquals([r1.result, r1.status, r1.total, r1.done, r1.failed, r1.method], ["started", "pending", 3, 0, 0, null]);
    const r2 = await start(c, id);
    assertEquals([r2.result, r2.status], ["current", "pending"]);
    const js = await jobs(c, id);
    assertEquals(js.length, 1);
    assertEquals([js[0].kind, js[0].lease_key, js[0].priority, js[0].payload],
      ["mail-action", `${c.prefix}mail:${c.user}`, 20, { id, phase: "execute", connection_id: c.conn }]);
  } },
  { name: "start: token older than 10 minutes → expired (stays previewed, no job); unknown id or another user → not_found", run: async (c) => {
    const id = await preview(c);
    await c.q("update mail_actions set created_at = now() - interval '11 minutes' where id = $1::uuid", [id]);
    assertEquals((await start(c, id)).result, "expired");
    assertEquals((await row(c, id)).status, "previewed");
    assertEquals((await jobs(c, id)).length, 0);
    assertEquals((await call(c, "mail_action_start", "$1::uuid, $2::uuid, $3", [crypto.randomUUID(), id, c.prefix])).result, "not_found");
    assertEquals((await start(c, crypto.randomUUID())).result, "not_found");
  } },
  { name: "begin → running with ids and cursor; progress per batch (compare-and-set); finish → partial, rest failed, audit once; finish again changes nothing", run: async (c) => {
    const [a, b, d] = ids3(c), id = await preview(c);
    await start(c, id);
    const g = await begin(c, id, "execute");
    assertEquals([g.status, g.action, g.ids, g.cursor, g.connection_id], ["running", "trash", [a, b, d], 0, c.conn]);
    assertEquals(await progress(c, id, "execute", 0, 2, [a], [b]), true);
    assertEquals(await progress(c, id, "execute", 0, 2, [a], [b]), false);           // 늦게 깬 워커: 같은 묶음 두 번 못 적음
    const f = await finish(c, id, "execute");
    assertEquals([f.status, f.done, f.failed], ["partial", 1, 2]);
    const r = await row(c, id);
    assertEquals([r.ok_ids, r.failed_ids, r.cursor], [[a], [b, d], 3]);
    assert(r.executed_at);
    assertEquals((await finish(c, id, "execute", "x")).status, "partial");
    assertEquals((await row(c, id)).error_code, null);
    const au = await audits(c, id);
    assertEquals(au.map((x) => [x.action, x.target]), [["mail_trash", `mail_action:${id} ok=1 failed=2`]]);
    assertEquals((await begin(c, id, "execute")).status, "partial");                 // 끝난 행: 상태만
  } },
  { name: "progress guards: count mismatch, ids outside the slice, past the end, backwards → false and nothing changes", run: async (c) => {
    const [a, b, d] = ids3(c), id = await preview(c);
    await start(c, id); await begin(c, id, "execute");
    assertEquals(await progress(c, id, "execute", 0, 2, [a], []), false);
    assertEquals(await progress(c, id, "execute", 0, 2, [a, d], []), false);
    assertEquals(await progress(c, id, "execute", 0, 4, [a, b, d, "x"], []), false);
    assertEquals(await progress(c, id, "execute", 0, 0, [], []), false);
    assertEquals(await progress(c, id, "undo", 0, 1, [a], []), false);              // 실행 중 행에 되돌리기 기록 없음
    const r = await row(c, id);
    assertEquals([r.cursor, r.ok_ids, r.failed_ids], [0, [], []]);
    assertEquals(await progress(c, id, "execute", 0, 3, [d, a], [b]), true);         // 구간 안의 순서는 묻지 않는다
  } },
  { name: "finish with a code marks everything after the cursor failed; zero ok → failed; pending (never begun) also closes", run: async (c) => {
    const [a] = ids3(c), id = await preview(c);
    await start(c, id); await begin(c, id, "execute");
    await progress(c, id, "execute", 0, 1, [a], []);
    const f = await finish(c, id, "execute", "scope_missing");
    assertEquals([f.status, f.done, f.failed, f.code], ["partial", 1, 2, "scope_missing"]);
    const id2 = await preview(c);
    await start(c, id2);
    const f2 = await finish(c, id2, "execute", "reauth_required");
    assertEquals([f2.status, f2.done, f2.failed, f2.code], ["failed", 0, 3, "reauth_required"]);
  } },
  { name: "undo rules: previewed/failed → nothing_to_undo, pending → busy, done → started (undo job), again → current, 8 days → expired, unknown → not_found", run: async (c) => {
    const [a, b] = ids3(c);
    const p = await preview(c);
    assertEquals((await undo(c, p)).result, "nothing_to_undo");
    await start(c, p);
    assertEquals((await undo(c, p)).result, "busy");
    await finish(c, p, "execute", "no_connection");                                   // 성공 0 → failed
    assertEquals((await undo(c, p)).result, "nothing_to_undo");
    const d = await done(c, [a, b]);
    const u1 = await undo(c, d);
    assertEquals([u1.result, u1.status, u1.done], ["started", "undo_pending", 2]);
    assertEquals((await jobs(c, d)).map((j) => j.payload.phase), ["execute", "undo"]);
    assertEquals((await undo(c, d)).result, "current");
    const old = await done(c, [a]);
    await c.q("update mail_actions set created_at = now() - interval '8 days' where id = $1::uuid", [old]);
    assertEquals((await undo(c, old)).result, "expired");
    assertEquals((await undo(c, crypto.randomUUID())).result, "not_found");
  } },
  { name: "undo uses ok_ids only: begin gives ok ids; progress/finish → undo_partial with undone/undo_failed counts; audit mail_undo", run: async (c) => {
    const [a, b, d] = ids3(c);
    const id = await done(c, [a, b], [d]);
    await undo(c, id);
    const g = await begin(c, id, "undo");
    assertEquals([g.status, g.ids, g.cursor], ["undoing", [a, b], 0]);
    assertEquals(await progress(c, id, "undo", 0, 2, [a], [b]), true);
    const f = await finish(c, id, "undo");
    assertEquals([f.status, f.undone, f.undo_failed, f.done, f.failed], ["undo_partial", 1, 1, 2, 1]);
    assert((await row(c, id)).undone_at);
    assertEquals((await audits(c, id)).map((x) => x.action), ["mail_trash", "mail_undo"]);
    assertEquals((await undo(c, id)).result, "current");                             // 되돌리기는 한 번뿐
  } },
  { name: "dead trigger: a mail-action job that goes dead via fail_job closes the row (rest failed, job_dead); other kinds are untouched", run: async (c) => {
    const [a] = ids3(c), id = await preview(c);
    await start(c, id); await begin(c, id, "execute");
    await progress(c, id, "execute", 0, 1, [a], []);
    const j = (await jobs(c, id))[0];
    await dead(c, j.id);
    assertEquals((await one(c.q, "select status from jobs where id = $1::uuid", [j.id])).status, "dead");
    const r = await row(c, id);
    assertEquals([r.status, r.error_code, r.failed_ids.length, r.ok_ids], ["partial", "job_dead", 2, [a]]);
    const [, b, d] = ids3(c);
    assertEquals(await progress(c, id, "execute", 1, 3, [b, d], []), false);          // 마감 뒤 늦게 깬 워커: 기록 없음
    assertEquals((await row(c, id)).ok_ids, [a]);
    const other = (await one(c.q, "select enqueue_job($1::uuid, 'process', $2, $3::jsonb) as id", [c.user, c.prefix + "p", JSON.stringify({ id })])).id;
    await dead(c, other);
    assertEquals((await row(c, id)).status, "partial");
  } },
  { name: "nothing left to close: dead after the last progress → done without a code; finish with a code after the cursor reached the end writes no code", run: async (c) => {
    const [a, b, d] = ids3(c), id = await preview(c);
    await start(c, id); await begin(c, id, "execute");
    await progress(c, id, "execute", 0, 3, [a, b, d], []);
    await dead(c, (await jobs(c, id))[0].id);
    const r = await row(c, id);
    assertEquals([r.status, r.error_code, r.failed_ids], ["done", null, []]);
    const id2 = await preview(c);
    await start(c, id2); await begin(c, id2, "execute");
    await progress(c, id2, "execute", 0, 3, [a, b], [d]);
    assertEquals([(await finish(c, id2, "execute", "scope_missing")).status, (await row(c, id2)).error_code], ["partial", null]);
  } },
  { name: "undo bounce: a connection problem before any undo puts the row back to done/partial with undo_<code>, no audit, and undo can start again; after progress it closes normally", run: async (c) => {
    const [a, b, d] = ids3(c);
    const id = await done(c, [a, b], [d]);
    await undo(c, id); await begin(c, id, "undo");
    const f = await finish(c, id, "undo", "reauth_required");
    assertEquals([f.status, f.code, f.undone, f.undo_failed, f.done], ["partial", "undo_reauth_required", 0, 0, 2]);
    const r = await row(c, id);
    assertEquals([r.undo_cursor, r.undo_failed_ids, r.undone_at], [0, [], null]);
    assertEquals((await audits(c, id)).map((x) => x.action), ["mail_trash"]);                // 되돌리기 감사 없음
    const u2 = await undo(c, id);
    assertEquals([u2.result, u2.status, u2.code], ["started", "undo_pending", null]);        // 다시 연결한 뒤 되돌릴 수 있다(옛 undo_ 코드는 지운다)
    await begin(c, id, "undo");
    await progress(c, id, "undo", 0, 1, [a], []);
    const f2 = await finish(c, id, "undo", "no_connection");                                 // 진행 뒤 = 보통 마감
    assertEquals([f2.status, f2.undone, f2.undo_failed, f2.code], ["undo_partial", 1, 1, "no_connection"]);
    const n = await done(c, [a]);
    await undo(c, n);
    assertEquals((await finish(c, n, "undo", "no_connection")).code, "undo_no_connection");  // undo_pending(시작 전)도 같다
    await undo(c, n); await begin(c, n, "undo");                                             // 다시 시작해 남김없이 끝나면 코드 없음
    await progress(c, n, "undo", 0, 1, [a], []);
    const f3 = await finish(c, n, "undo");
    assertEquals([f3.status, f3.code], ["undone", null]);
  } },
  { name: "dead trigger in the undo phase: a dead undo job closes the undo (rest undo-failed, job_dead, audit mail_undo)", run: async (c) => {
    const [a, b] = ids3(c);
    const id = await done(c, [a, b]);
    await undo(c, id); await begin(c, id, "undo");
    await progress(c, id, "undo", 0, 1, [a], []);
    const uj = (await jobs(c, id)).find((j) => j.payload.phase === "undo")!;
    await dead(c, uj.id);
    const r = await row(c, id);
    assertEquals([r.status, r.error_code, r.undo_cursor, r.undo_failed_ids], ["undo_partial", "job_dead", 2, [b]]);
    assertEquals((await audits(c, id)).map((x) => x.action), ["mail_trash", "mail_undo"]);
  } },
  { name: "another user: preview on someone else's connection → null (no row); begin/progress/finish/set_method/quota by another user → null/false, nothing changes", run: async (c) => {
    const [a] = ids3(c), other = crypto.randomUUID();
    assertEquals((await one(c.q, "select mail_action_preview($1::uuid, $2::uuid, 'trash', $3::text[]) as id", [other, c.conn, arr([a])])).id, null);
    assertEquals((await c.q("select 1 from mail_actions where connection_id = $1::uuid", [c.conn])).length, 0);
    const id = await preview(c);
    await start(c, id);
    assertEquals(await call(c, "mail_action_begin", "$1::uuid, $2::uuid, 'execute'", [other, id]), null);
    assertEquals((await row(c, id)).status, "pending");
    await begin(c, id, "execute");
    assertEquals(await call(c, "mail_action_progress", "$1::uuid, $2::uuid, 'execute', 0, 1, $3::text[], '{}'::text[]", [other, id, arr([a])]), false);
    await c.q("select mail_action_set_method($1::uuid, $2::uuid, 'batch')", [other, id]);
    assertEquals(await call(c, "mail_action_quota", "$1::uuid, $2::uuid", [other, id]), null);
    assertEquals(await call(c, "mail_action_finish", "$1::uuid, $2::uuid, 'execute', 'x'", [other, id]), null);
    const r = await row(c, id);
    assertEquals([r.status, r.cursor, r.ok_ids, r.method, r.quota_since, r.error_code], ["running", 0, [], null, null, null]);
    assertEquals((await audits(c, id)).length, 0);
  } },
  { name: "privileges: every 0030 function is not executable by anon or authenticated; both tables have RLS on and no policy", run: async (c) => {
    const rows = await c.q(`select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon,
      has_function_privilege('authenticated', p.oid, 'execute') as auth from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = any($1::text[])`, [arr(MAIL_FUNCTIONS)]);
    assertEquals(rows.map((r) => r.proname).sort(), [...MAIL_FUNCTIONS].sort());
    assertEquals(rows.filter((r) => r.anon || r.auth).map((r) => r.proname), []);
    const rls = await c.q("select relname, relrowsecurity from pg_class where relname in ('mail_actions', 'gmail_units') and relnamespace = 'public'::regnamespace order by relname");
    assertEquals(rls.map((r) => [r.relname, r.relrowsecurity]), [["gmail_units", true], ["mail_actions", true]]);
    assertEquals((await c.q("select 1 from pg_policies where schemaname = 'public' and tablename in ('mail_actions', 'gmail_units')")).length, 0);
  } },
  { name: "units: collection notes count toward 5,400; mail share stops at 4,000", run: async (c) => {
    const take = (n: number) => call(c, "gmail_take_units", "$1::uuid, $2::int", [c.user, n]);
    await c.q("select gmail_note_units($1::uuid, 1300)", [c.user]);
    assertEquals(await take(4000), true);
    assertEquals(await take(1), false);                                               // 자기 몫 4,000
    await c.q("delete from gmail_units where user_id = $1::uuid", [c.user]);
    await c.q("select gmail_note_units($1::uuid, 5000)", [c.user]);
    assertEquals(await take(401), false);                                             // 합계 5,400
    assertEquals(await take(400), true);
    const u = await one(c.q, "select used, mail_used from gmail_units where user_id = $1::uuid", [c.user]);
    assertEquals([u.used, u.mail_used], [5400, 400]);
    assertEquals([await take(0), await take(-100)], [true, true]);                    // 가져갈 것 없음: 카운터를 줄이지 않는다
    const u2 = await one(c.q, "select used, mail_used from gmail_units where user_id = $1::uuid", [c.user]);
    assertEquals([u2.used, u2.mail_used], [5400, 400]);
  } },
  { name: "replace token: active connection only — vault, scopes, expires_at change, cursor untouched; another user or a reauth_required connection → false and nothing changes", run: async (c) => {
    const conn = (await one(c.q, "select gmail_save_connection($1::uuid, $2, 'rt-old', '700') as id", [c.user, `${c.tag}-rt@example.com`])).id as string;
    await c.q("update connections set expires_at = now() + interval '1 day' where id = $1::uuid", [conn]);
    assertEquals(await call(c, "gmail_replace_token", "$1::uuid, $2::uuid, 'rt-x', $3::text[]", [crypto.randomUUID(), conn, arr(["s"])]), false);
    assertEquals(await call(c, "gmail_replace_token", "$1::uuid, $2::uuid, 'rt-new', $3::text[]", [c.user, conn, arr(["a", "b"])]), true);
    assertEquals(await call(c, "gmail_get_refresh_token", "$1::uuid, $2::uuid", [c.user, conn]), "rt-new");
    const k = await one(c.q, "select status, scopes, expires_at > now() + interval '6 days' as week from connections where id = $1::uuid", [conn]);
    assertEquals([k.status, k.scopes, k.week], ["active", ["a", "b"], true]);
    assertEquals((await one(c.q, "select cursor from sync_states where connection_id = $1::uuid", [conn])).cursor, "700");
    await c.q("update connections set status = 'reauth_required' where id = $1::uuid", [conn]);
    assertEquals(await call(c, "gmail_replace_token", "$1::uuid, $2::uuid, 'rt-z', $3::text[]", [c.user, conn, arr(["z"])]), false);
    const z = await one(c.q, "select c.status, c.scopes, s.decrypted_secret as secret from connections c join vault.decrypted_secrets s on s.name = 'gmail_rt:' || c.id where c.id = $1::uuid", [conn]);
    assertEquals([z.status, z.scopes, z.secret], ["reauth_required", ["a", "b"], "rt-new"]);   // 끊긴 연결은 되살리지 않는다(D12)
  } },
  { name: "mail_connection returns the newest Gmail connection with account and scopes; gmail_set_scopes writes them", run: async (c) => {
    await c.q("select gmail_set_scopes($1::uuid, $2::uuid, $3::text[])", [c.user, c.conn, arr(["r", "m"])]);
    const rows = await c.q("select * from mail_connection($1::uuid)", [c.user]);
    assertEquals(rows.length, 1);
    assertEquals([rows[0].connection_id, rows[0].status, rows[0].scopes], [c.conn, "active", ["r", "m"]]);
    assert(String(rows[0].account_ref).startsWith(c.tag));
    assertEquals((await c.q("select * from mail_connection($1::uuid)", [crypto.randomUUID()])).length, 0);
  } },
  { name: "purge: 7-day rows except in-flight with a live job; in-flight 8+ days with no live job closes as job_lost then goes; 1-hour unit rows; cron at 53 4", run: async (c) => {
    const old = await preview(c), running = await preview(c), lost = await preview(c), fresh = await preview(c);
    await start(c, running); await start(c, lost);                                           // 둘 다 pending + 잡
    await c.q("delete from jobs where user_id = $1::uuid and payload->>'id' = $2", [c.user, lost]);   // 잡이 사라진 진행 중 행
    await c.q("update mail_actions set created_at = now() - interval '9 days' where id = any($1::uuid[])", [`{${old},${running},${lost}}`]);
    await c.q("insert into gmail_units (user_id, minute, used) values ($1::uuid, date_trunc('minute', now()) - interval '2 hours', 5), ($1::uuid, date_trunc('minute', now()) - interval '10 minutes', 5)", [c.user]);
    const p = await call(c, "purge_mail_actions", "$1::uuid", [c.user]);
    assertEquals(p, { mail_actions: 2, gmail_units: 1, lost: 1 });
    const left = (await c.q("select id from mail_actions where user_id = $1::uuid", [c.user])).map((r) => r.id).sort();
    assertEquals(left, [running, fresh].sort());
    assertEquals((await audits(c, lost)).map((x) => x.target), [`mail_action:${lost} ok=0 failed=3`]);   // 마감 감사는 남는다
    assertEquals((await one(c.q, "select schedule from cron.job where jobname = 'mail-actions-purge-daily'")).schedule, "53 4 * * *");
  } },
  { name: "cascade and columns: deleting the connection deletes its rows (connection_id index); mail_actions has no title/sender/body/query column", run: async (c) => {
    const id = await preview(c);
    await c.q("delete from connections where id = $1::uuid", [c.conn]);
    assertEquals((await c.q("select 1 from mail_actions where id = $1::uuid", [id])).length, 0);
    const cols = (await c.q("select column_name from information_schema.columns where table_schema = 'public' and table_name = 'mail_actions' order by ordinal_position")).map((r) => r.column_name);
    assertEquals(cols, ["id", "user_id", "connection_id", "action", "msg_ids", "count", "method", "status", "cursor", "ok_ids", "failed_ids",
      "undo_cursor", "undo_failed_ids", "error_code", "quota_since", "created_at", "executed_at", "undone_at"]);
    const ix = await c.q("select indexdef from pg_indexes where schemaname = 'public' and tablename = 'mail_actions' and indexname = 'mail_actions_connection'");
    assertEquals(ix.length, 1);                                                       // 연결 삭제 cascade 가 표를 훑지 않게
    assert(String(ix[0].indexdef).endsWith("(connection_id)"));
  } },
  { name: "priority: mail-action 20; backfill 40, gmail-fetch 20, process 30 unchanged", run: async (c) => {
    const pr = async (kind: string, payload: Record<string, unknown>) => {          // 넣기와 읽기를 나눈다 — WHERE 안의 volatile 호출은 행마다 돈다
      const id = (await one(c.q, "select enqueue_job($1::uuid, $2, $3, $4::jsonb) as id", [c.user, kind, c.prefix + kind, JSON.stringify(payload)])).id;
      return (await one(c.q, "select priority from jobs where id = $1::uuid", [id])).priority;
    };
    assertEquals([await pr("mail-action", {}), await pr("gmail-fetch", { backfill: true }), await pr("gmail-fetch", {}), await pr("process", {})], [20, 40, 20, 30]);
  } },
  { name: "set_method: null → batch → single only while running; status json carries method", run: async (c) => {
    const id = await preview(c);
    await c.q("select mail_action_set_method($1::uuid, $2::uuid, 'single')", [c.user, id]);   // previewed: 안 바뀜
    assertEquals((await row(c, id)).method, null);
    await start(c, id); await begin(c, id, "execute");
    await c.q("select mail_action_set_method($1::uuid, $2::uuid, 'batch')", [c.user, id]);
    await c.q("select mail_action_set_method($1::uuid, $2::uuid, 'single')", [c.user, id]);
    await c.q("select mail_action_set_method($1::uuid, $2::uuid, 'batch')", [c.user, id]);    // single → batch 없음
    assertEquals((await row(c, id)).method, "single");
    assertEquals((await call(c, "mail_action_status", "$1::uuid, $2::uuid", [c.user, id])).method, "single");
    assertEquals(await call(c, "mail_action_status", "$1::uuid, $2::uuid", [crypto.randomUUID(), id]), null);
  } },
  { name: "quota: only while running/undoing — first call sets quota_since, later calls keep it; a progressed batch clears it; other states → null", run: async (c) => {
    const [a] = ids3(c), id = await preview(c);
    const quota = () => call(c, "mail_action_quota", "$1::uuid, $2::uuid", [c.user, id]);
    assertEquals(await quota(), null);                                                // previewed
    await start(c, id);
    assertEquals(await quota(), null);                                                // pending
    assertEquals((await row(c, id)).quota_since, null);
    await begin(c, id, "execute");
    const q1 = await call(c, "mail_action_quota", "$1::uuid, $2::uuid", [c.user, id]);
    const q2 = await call(c, "mail_action_quota", "$1::uuid, $2::uuid", [c.user, id]);
    assertEquals(new Date(q1).getTime(), new Date(q2).getTime());
    await progress(c, id, "execute", 0, 1, [a], []);
    assertEquals((await row(c, id)).quota_since, null);
    await finish(c, id, "execute");
    assertEquals(await quota(), null);                                                // 끝난 행
    assertEquals((await row(c, id)).quota_since, null);
  } },
];
