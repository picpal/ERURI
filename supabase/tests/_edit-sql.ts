import { assert, assertEquals } from "jsr:@std/assert";

// 0033 SQL 사례(계획 E1·E2): PGlite(edit-sql.test.ts)와 호스팅 트랜잭션(edit-db.test.ts, D1 단계)이 같은 사례를 돈다.
// 사례마다 한 트랜잭션 안에서 시작해 롤백으로 끝난다(실행자 쪽). 값은 합성 문구·합성 시각만 — 날짜는 서울 오늘 기준 상대값
// deno-lint-ignore no-explicit-any
export type Row = Record<string, any>;
export type Q = (sql: string, params?: unknown[]) => Promise<Row[]>;
export type ECtx = { q: Q; user: string; other: string; run: string };
// localOnly: 함수를 트랜잭션 안에서 바꿔 끼우는 사례 — PGlite 에서만(호스팅 edit-db 는 건너뛴다: 배포 함수에 DDL 잠금을 걸지 않는다)
export type EditCase = { name: string; privileges?: true; localOnly?: true; run(c: ECtx): Promise<void> };
export const MIGRATION_0033 = new URL("../migrations-pending/0033_chat_edit.sql", import.meta.url);   // D1 단계가 ../migrations/ 로 바꾼다
export const EDIT_FUNCTIONS = ["chat_edit_day", "chat_edit_ts", "chat_edit_iso", "chat_edit_values", "chat_edit_moved", "chat_edit_state",
  "chat_edit_apply", "chat_edit_target", "chat_edit_proposal"];

const one = async (c: ECtx, sql: string, p: unknown[] = []) => (await c.q(sql, p))[0];
// 서울 오늘 + n일의 날짜·시각 문자열(서버 now() 기준 — 호스팅·PGlite 시계 차이를 피한다)
export async function day(c: ECtx, n: number): Promise<string> {
  return (await one(c, "select to_char((now() at time zone 'Asia/Seoul')::date + $1::int, 'YYYY-MM-DD') as d", [n])).d;
}
export async function at(c: ECtx, n: number, hm: string): Promise<string> { return `${await day(c, n)}T${hm}:00+09:00`; }

export type Ev = { title: string; start: string | null; end?: string | null; location?: string | null; notes?: string; uncertain?: string[] };
export type Seeded = { item: string; facts: string[]; props: string[] };
// 채팅 등록 항목(SHARE·채팅) + 일정 fact(순번) + v1 create_event proposed. ago = captured_at 을 몇 초 전으로
export async function seed(c: ECtx, tag: string, events: Ev[], o: { user?: string; ago?: number; source?: string; app?: string | null } = {}): Promise<Seeded> {
  const user = o.user ?? c.user;
  const item = (await one(c, `insert into items (user_id, source, app_name, occurred_at, captured_at, idempotency_key)
    values ($1::uuid, $2, $3, now(), now() - make_interval(secs => $4::int), $5) returning id`,
    [user, o.source ?? "SHARE", o.app === undefined ? "채팅" : o.app, o.ago ?? 60, `${c.run}:edit:${tag}`])).id as string;
  const facts: string[] = [], props: string[] = [];
  for (const [i, e] of events.entries()) {
    const payload = { title: e.title, start: e.start, end: e.end ?? null, location: e.location ?? null, uncertain: e.uncertain ?? [],
      ...(e.notes ? { notes: e.notes } : {}) };
    const f = (await one(c, "insert into facts (user_id, item_id, kind, ordinal, payload) values ($1::uuid, $2::uuid, 'event', $3, $4::jsonb) returning id",
      [user, item, i, JSON.stringify(payload)])).id as string;
    const p = (await one(c, `insert into proposals (user_id, fact_id, action, payload, idempotency_key)
      values ($1::uuid, $2::uuid, 'create_event', $3::jsonb, $4) returning id`, [user, f, JSON.stringify(payload), `${c.run}:edit:${tag}:p${i}`])).id as string;
    facts.push(f); props.push(p);
  }
  return { item, facts, props };
}
export async function versions(c: ECtx, fact: string) {
  return (await c.q(`select id, version, action, status, payload, eventkit_id, idempotency_key from proposals where fact_id = $1::uuid order by version`, [fact]));
}
export const target = async (c: ECtx, pid: string, user = c.user) =>
  (await one(c, "select chat_edit_target($1::uuid, $2::uuid) as r", [user, pid])).r as Row;
// 배열 인자는 PG 배열 리터럴 문자열로 넘긴다(PGlite·postgres.js unsafe 모두 같은 직렬화)
export const pgArr = (xs: string[]) => `{${xs.join(",")}}`;
export const edit = async (c: ECtx, pid: string, patch: Row, clear: string[] = [], user = c.user) =>
  (await one(c, "select chat_edit_proposal($1::uuid, $2::uuid, $3::jsonb, $4::text[]) as r", [user, pid, JSON.stringify(patch), pgArr(clear)])).r as Row;
// 사용자 JWT 로(authenticated + claims sub) — report_execution·resolve_uncertain. 끝나면 역할을 되돌린다
export async function asUser<T>(c: ECtx, user: string, fn: () => Promise<T>): Promise<T> {
  await c.q("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: user, role: "authenticated" })]);
  await c.q("set local role authenticated");
  try { return await fn(); } finally { await c.q("reset role"); await c.q("select set_config('request.jwt.claims', '', true)"); }
}
export const report = (c: ECtx, pid: string, version: number, ek = "EK-합성-1", user = c.user) => asUser(c, user, async () =>
  (await one(c, "select report_execution($1::uuid, $2, $3, $4, now()) as r", [pid, `${c.run}:device`, ek, version])).r as string);
// 예외를 기대하는 문장은 savepoint 안에서 — 실패한 문장이 바깥 트랜잭션을 오류 상태로 두지 않게
export async function fails(c: ECtx, sql: string, p: unknown[], msg: string) {
  await c.q("savepoint edit_expect");
  let err = "";
  try { await c.q(sql, p); } catch (e) { err = e instanceof Error ? e.message : String(e); }
  await c.q("rollback to savepoint edit_expect");
  assert(err.includes(msg), `expected "${msg}", got "${err || "no error"}"`);
}
const vals = (p: Row) => ({ title: p.title ?? null, start: p.start ?? null, end: p.end ?? null, location: p.location ?? null });

export const EDIT_CASES: EditCase[] = [
  { name: "before add: v2 create_event proposed with the patch over v1 (notes and other keys kept), v1 stale, fact payload moved, key proposal:<fact>:v2", run: async (c) => {
    const s = await seed(c, "b1", [{ title: "합성 미팅", start: await at(c, 2, "11:00"), end: await at(c, 2, "15:00"), notes: "합성 메모" }]);
    const r = await edit(c, s.props[0], { start: await at(c, 1, "11:00"), end: await at(c, 1, "15:00") });
    assertEquals([r.status, r.action, r.version], ["ok", "create_event", 2]);
    assertEquals(r.before, { title: "합성 미팅", start: await at(c, 2, "11:00"), end: await at(c, 2, "15:00"), location: null });
    assertEquals(r.after.start, await at(c, 1, "11:00"));
    const v = await versions(c, s.facts[0]);
    assertEquals(v.map((x) => [x.version, x.action, x.status]), [[1, "create_event", "stale"], [2, "create_event", "proposed"]]);
    assertEquals([v[1].payload.notes, v[1].payload.title, v[1].idempotency_key], ["합성 메모", "합성 미팅", `proposal:${s.facts[0]}:v2`]);
    assertEquals((await one(c, "select payload->>'start' as s, payload->>'end' as e from facts where id = $1::uuid", [s.facts[0]])),
      { s: await at(c, 1, "11:00"), e: await at(c, 1, "15:00") });
  } },
  { name: "added (v1 succeeded): v2 update_event with before = v1 values, base_proposal_id = v1, eventkit_id = v1's; v1 stays succeeded", run: async (c) => {
    const s = await seed(c, "b2", [{ title: "합성 미팅", start: await at(c, 2, "11:00"), end: await at(c, 2, "15:00"), location: "합성카페" }]);
    assertEquals(await report(c, s.props[0], 1, "EK-합성-b2"), "ok");
    const r = await edit(c, s.props[0], { start: await at(c, 2, "14:00"), end: await at(c, 2, "18:00") });
    assertEquals([r.status, r.action, r.version], ["ok", "update_event", 2]);
    const v = await versions(c, s.facts[0]);
    assertEquals(v.map((x) => [x.version, x.action, x.status]), [[1, "create_event", "succeeded"], [2, "update_event", "proposed"]]);
    assertEquals(v[1].payload.before, { title: "합성 미팅", start: await at(c, 2, "11:00"), end: await at(c, 2, "15:00"), location: "합성카페" });
    assertEquals([v[1].payload.base_proposal_id, v[1].eventkit_id], [s.props[0], "EK-합성-b2"]);
  } },
  { name: "re-edit before the update is applied: v2 update_event goes stale, v3 update_event keeps before = v1 values (base v1)", run: async (c) => {
    const s = await seed(c, "b3", [{ title: "합성 미팅", start: await at(c, 2, "11:00") }]);
    await report(c, s.props[0], 1);
    const r2 = await edit(c, s.props[0], { start: await at(c, 2, "14:00") });
    const r3 = await edit(c, s.props[0], { start: await at(c, 2, "16:00") });
    assertEquals([r2.version, r3.version, r3.action], [2, 3, "update_event"]);
    const v = await versions(c, s.facts[0]);
    assertEquals(v.map((x) => x.status), ["succeeded", "stale", "proposed"]);
    assertEquals([v[2].payload.before.start, v[2].payload.base_proposal_id], [await at(c, 2, "11:00"), s.props[0]]);
    assertEquals(r3.before.start, await at(c, 2, "14:00"));                         // 응답 before = 고치기 직전 최고 버전(v2)
  } },
  { name: "re-edit after the update is applied: base = v2 (succeeded update_event), v1 and v2 both stay succeeded", run: async (c) => {
    const s = await seed(c, "b4", [{ title: "합성 미팅", start: await at(c, 2, "11:00") }]);
    await report(c, s.props[0], 1, "EK-합성-b4");
    const r2 = await edit(c, s.props[0], { start: await at(c, 2, "14:00") });
    assertEquals(await report(c, r2.proposal_id, 2, "EK-합성-b4"), "ok");
    const r3 = await edit(c, s.props[0], { title: "합성 회의" });
    const v = await versions(c, s.facts[0]);
    assertEquals(v.map((x) => [x.action, x.status]), [["create_event", "succeeded"], ["update_event", "succeeded"], ["update_event", "proposed"]]);
    assertEquals([v[2].payload.base_proposal_id, v[2].payload.before.start, v[2].payload.before.title, r3.after.title], [r2.proposal_id, await at(c, 2, "14:00"), "합성 미팅", "합성 회의"]);
  } },
  { name: "late report (H1): v1 report after the edit is stale but leaves executions; next edit is update_event based on v1 (eventkit_id from executions), unapplied v2 goes stale", run: async (c) => {
    const s = await seed(c, "b5", [{ title: "합성 미팅", start: await at(c, 2, "11:00") }]);
    const r2 = await edit(c, s.props[0], { start: await at(c, 1, "11:00") });
    assertEquals(r2.action, "create_event");
    assertEquals(await report(c, s.props[0], 1, "EK-합성-late"), "stale");
    const r3 = await edit(c, s.props[0], { start: await at(c, 1, "14:00") });
    assertEquals([r3.action, r3.version], ["update_event", 3]);
    const v = await versions(c, s.facts[0]);
    assertEquals(v.map((x) => x.status), ["stale", "stale", "proposed"]);
    assertEquals([v[2].payload.base_proposal_id, v[2].payload.before.start, v[2].eventkit_id], [s.props[0], await at(c, 2, "11:00"), "EK-합성-late"]);
  } },
  { name: "a stale version without an executions row is never the base (edit stays create_event)", run: async (c) => {
    const s = await seed(c, "b6", [{ title: "합성 미팅", start: await at(c, 2, "11:00") }]);
    await edit(c, s.props[0], { start: await at(c, 1, "11:00") });
    const r3 = await edit(c, s.props[0], { start: await at(c, 1, "13:00") });
    assertEquals([r3.action, r3.version], ["create_event", 3]);
    assertEquals((await versions(c, s.facts[0])).map((x) => x.status), ["stale", "stale", "proposed"]);
  } },
  { name: "30-minute window on captured_at: exactly 30 min → ok, 30 min 1 s → expired (target and proposal), no new row", run: async (c) => {
    const ok = await seed(c, "w1", [{ title: "합성 미팅", start: await at(c, 2, "11:00") }], { ago: 1800 });
    const late = await seed(c, "w2", [{ title: "합성 미팅", start: await at(c, 2, "11:00") }], { ago: 1801 });
    assertEquals((await target(c, ok.props[0])).status, "ok");
    assertEquals((await target(c, late.props[0])).status, "expired");
    assertEquals((await edit(c, late.props[0], { title: "합성 회의" })).status, "expired");
    assertEquals((await versions(c, late.facts[0])).length, 1);
  } },
  { name: "not_found: another user's id, a non-chat item (MESSAGES, SHARE 웹 링크), a dismissed top; nothing reveals the owner", run: async (c) => {
    const mine = await seed(c, "n1", [{ title: "합성 미팅", start: await at(c, 2, "11:00") }]);
    assertEquals((await target(c, mine.props[0], c.other)).status, "not_found");
    const sms = await seed(c, "n2", [{ title: "합성 치과", start: await at(c, 2, "11:00") }], { source: "MESSAGES", app: null });
    const link = await seed(c, "n3", [{ title: "합성 공연", start: await at(c, 2, "11:00") }], { app: "웹 링크" });
    assertEquals([(await target(c, sms.props[0])).status, (await target(c, link.props[0])).status], ["not_found", "not_found"]);
    const d = await seed(c, "n4", [{ title: "합성 미팅", start: await at(c, 2, "11:00") }]);
    await c.q("update proposals set status = 'dismissed' where id = $1::uuid", [d.props[0]]);
    assertEquals((await target(c, d.props[0])).status, "not_found");
    assertEquals((await edit(c, d.props[0], { title: "합성 회의" })).status, "not_found");
    assertEquals(Object.keys(await target(c, d.props[0])), ["status"]);
  } },
  { name: "multi: two active event facts in the item → multi for target and proposal", run: async (c) => {
    const s = await seed(c, "m1", [{ title: "합성 미팅", start: await at(c, 2, "11:00") }, { title: "합성 저녁", start: await at(c, 2, "19:00") }]);
    assertEquals([(await target(c, s.props[0])).status, (await edit(c, s.props[1], { title: "합성 회식" })).status], ["multi", "multi"]);
  } },
  { name: "chat_edit_target ok: the fact's top version values from any version id, one audit row with sha256(item id); not ok writes none", run: async (c) => {
    const s = await seed(c, "t1", [{ title: "합성 미팅", start: await at(c, 2, "11:00"), location: "합성카페" }]);
    await edit(c, s.props[0], { title: "합성 회의" });
    const before = Number((await one(c, "select count(*)::int as n from audit_log where user_id = $1::uuid", [c.user])).n);
    const t = await target(c, s.props[0]);
    assertEquals([t.status, t.action, t.title, t.location, t.end], ["ok", "create_event", "합성 회의", "합성카페", null]);
    assert(t.proposal_id !== s.props[0]);
    const a = await c.q("select actor, action, target from audit_log where user_id = $1::uuid order by id desc limit 1", [c.user]);
    const hex = (await one(c, "select encode(sha256(convert_to($1, 'UTF8')), 'hex') as h", [s.item])).h;
    assertEquals([a[0].actor, a[0].action, a[0].target], ["chat", "read", hex]);
    await target(c, s.props[0], c.other);
    assertEquals(Number((await one(c, "select count(*)::int as n from audit_log where user_id = $1::uuid", [c.user])).n), before + 1);
  } },
  { name: "no_change: same four values and same uncertain → no new row; the response carries the top version", run: async (c) => {
    const s = await seed(c, "nc", [{ title: "합성 미팅", start: await at(c, 2, "11:00"), uncertain: ["ampm"] }]);
    const r = await edit(c, s.props[0], { title: "합성 미팅" });
    assertEquals([r.status, r.proposal_id, r.version], ["no_change", s.props[0], 1]);
    assertEquals((await versions(c, s.facts[0])).length, 1);
  } },
  { name: "empty patch with confirmed codes (\"오후 6시 맞아\", K6): a new version that only drops the code; a code no longer in uncertain → no_change", run: async (c) => {
    const s = await seed(c, "ec", [{ title: "합성 저녁", start: await at(c, 2, "18:00"), uncertain: ["ampm", "tz"] }]);
    const r = await edit(c, s.props[0], {}, ["ampm"]);
    assertEquals([r.status, r.version, r.action, r.after.start], ["ok", 2, "create_event", await at(c, 2, "18:00")]);
    assertEquals(r.before, r.after);                                                                       // 값은 그대로
    const v = await versions(c, s.facts[0]);
    assertEquals([v[0].status, v[1].payload.uncertain], ["stale", ["tz"]]);
    const n = await edit(c, r.proposal_id, {}, ["ampm"]);                                                  // 이미 풀린 코드 — 새 행 없음
    assertEquals([n.status, n.version, (await versions(c, s.facts[0])).length], ["no_change", 2, 2]);
  } },
  { name: "p_clear removes only the listed codes (date gone; ampm, year, tz kept); an empty clear keeps all", run: async (c) => {
    const s = await seed(c, "cl", [{ title: "합성 미팅", start: await at(c, 2, "06:00"), uncertain: ["date", "ampm", "year", "tz"] }]);
    const r = await edit(c, s.props[0], { start: await at(c, 1, "06:00") }, ["date"]);
    assertEquals((await versions(c, s.facts[0]))[1].payload.uncertain, ["ampm", "year", "tz"]);
    const r2 = await edit(c, r.proposal_id, { title: "합성 회의" }, []);
    assertEquals((await versions(c, s.facts[0]))[2].payload.uncertain, ["ampm", "year", "tz"]);
    assertEquals(r2.version, 3);
  } },
  { name: "location null in the patch clears the place (payload null, after.location null)", run: async (c) => {
    const s = await seed(c, "loc", [{ title: "합성 미팅", start: await at(c, 2, "11:00"), location: "합성카페" }]);
    const r = await edit(c, s.props[0], { location: null }, ["location"]);
    assertEquals([r.after.location, (await versions(c, s.facts[0]))[1].payload.location], [null, null]);
  } },
  { name: "apply guard (Codex plan H1): a patch built from an older read whose end is not after the latest start keeps the latest length; kind mismatch drops the end", run: async (c) => {
    const s = await seed(c, "g1", [{ title: "합성 미팅", start: await at(c, 2, "11:00"), end: await at(c, 2, "12:00") }]);
    await edit(c, s.props[0], { start: await at(c, 2, "14:00"), end: await at(c, 2, "15:00") });            // 먼저 들어온 쓰기(v2 14–15시)
    const r = await edit(c, s.props[0], { title: "합성 회의", end: await at(c, 2, "13:00") });                // 11–12시를 읽고 만든 patch
    assertEquals([r.status, r.version, r.after.title, r.after.start, r.after.end], ["ok", 3, "합성 회의", await at(c, 2, "14:00"), await at(c, 2, "15:00")]);
    const n = await edit(c, s.props[0], { end: await at(c, 2, "13:00") });                                   // 끝만 — 버리면 바뀐 칸이 없다
    assertEquals([n.status, n.version, (await versions(c, s.facts[0])).length], ["no_change", 3, 3]);
    const d = await seed(c, "g2", [{ title: "합성 종일", start: await day(c, 3), end: await day(c, 4) }]);
    await edit(c, d.props[0], { start: await day(c, 6), end: await day(c, 7) });
    const r2 = await edit(c, d.props[0], { title: "합성 종일2", end: await day(c, 5) });                       // 종일: 마지막 날 < 첫날 → 2일 유지
    assertEquals([r2.after.start, r2.after.end], [await day(c, 6), await day(c, 7)]);
    const k = await seed(c, "g3", [{ title: "합성 시각", start: await at(c, 2, "11:00"), end: await at(c, 2, "12:00") }]);
    await edit(c, k.props[0], { start: await day(c, 5), end: null });                                         // 시각 → 종일(끝 없음)
    const r3 = await edit(c, k.props[0], { title: "합성 시각2", end: await at(c, 2, "13:00") });              // 시각 끝 — 종류가 다르다
    assertEquals([r3.after.start, r3.after.end], [await day(c, 5), null]);
  } },
  { name: "bad_patch and bad_clear raise and change nothing", run: async (c) => {
    const s = await seed(c, "bad", [{ title: "합성 미팅", start: await at(c, 2, "11:00") }]);
    const call = "select chat_edit_proposal($1::uuid, $2::uuid, $3::jsonb, $4::text[])";
    await fails(c, call, [c.user, s.props[0], JSON.stringify({ notes: "x" }), pgArr([])], "bad_patch");
    await fails(c, call, [c.user, s.props[0], JSON.stringify({}), pgArr([])], "bad_patch");
    await fails(c, call, [c.user, s.props[0], JSON.stringify({ title: null }), pgArr([])], "bad_patch");
    await fails(c, call, [c.user, s.props[0], JSON.stringify({ start: 3 }), pgArr([])], "bad_patch");
    // 최종 리뷰 E1 ②: 시각(오프셋 포함)·날짜로 읽히지 않는 start 는 저장하지 않는다(chat/edit.ts revalidate 의 방어선)
    for (const start of ["", "abc", "2026-13-45", "2026-10-10T11:00:00", "내일 11시"]) {
      await fails(c, call, [c.user, s.props[0], JSON.stringify({ start }), pgArr([])], "bad_patch");
    }
    await fails(c, call, [c.user, s.props[0], JSON.stringify({ title: "합성 회의" }), pgArr(["recurrence"])], "bad_clear");
    assertEquals((await versions(c, s.facts[0])).length, 1);
  } },
  { name: "chat_proposals returns only the top version per fact, and only when it is proposed or succeeded", run: async (c) => {
    const s = await seed(c, "cp", [{ title: "합성 미팅", start: await at(c, 2, "11:00") }]);
    const r = await edit(c, s.props[0], { title: "합성 회의" });
    const rows = await c.q("select id, action, status from chat_proposals($1::uuid, $2::uuid[])", [c.user, pgArr([s.item])]);
    assertEquals(rows.map((x) => [x.id, x.status]), [[r.proposal_id, "proposed"]]);
    await c.q("update proposals set status = 'dismissed' where id = $1::uuid", [r.proposal_id]);
    assertEquals((await c.q("select id from chat_proposals($1::uuid, $2::uuid[])", [c.user, pgArr([s.item])])).length, 0);   // 옛 v1 stale 도 나오지 않는다
  } },
  { name: "report_execution marks a proposed update_event succeeded (action is not checked)", run: async (c) => {
    const s = await seed(c, "rep", [{ title: "합성 미팅", start: await at(c, 2, "11:00") }]);
    await report(c, s.props[0], 1);
    const r = await edit(c, s.props[0], { title: "합성 회의" });
    assertEquals(await report(c, r.proposal_id, 2), "ok");
    assertEquals((await versions(c, s.facts[0]))[1].status, "succeeded");
  } },
  { name: "privileges: anon and authenticated cannot execute any 0033 internal or service function", privileges: true, run: async (c) => {
    for (const f of EDIT_FUNCTIONS) {
      const r = await c.q(`select bool_or(has_function_privilege('anon', p.oid, 'execute')) as anon, bool_or(has_function_privilege('authenticated', p.oid, 'execute')) as auth
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1`, [f]);
      assertEquals([f, r[0].anon, r[0].auth], [f, false, false]);
    }
    const cp = await c.q(`select has_function_privilege('authenticated', 'public.chat_proposals(uuid, uuid[])', 'execute') as a`);
    assertEquals(cp[0].a, false);
  } },
  { name: "chat_edit_state locks the fact's proposal rows (for update) before reading the top version", run: async (c) => {
    const src = (await one(c, "select prosrc from pg_proc where proname = 'chat_edit_state'")).prosrc as string;
    assert(/order by p\.version for update/i.test(src), "for update on the fact's proposals");
  } },
  { name: "resolve ampm: 06:00 → 18:00 moves the end by the same 12 h, removes only ampm, old version stale", run: async (c) => {
    const s = await seed(c, "r1", [{ title: "합성 미팅", start: await at(c, 3, "06:00"), end: await at(c, 3, "08:00"), uncertain: ["ampm", "tz"] }]);
    const r = await resolve(c, s.props[0], "ampm", await at(c, 3, "18:00"));
    assertEquals([r.status, r.version], ["ok", 2]);
    const v = await versions(c, s.facts[0]);
    assertEquals([v[0].status, v[1].action, v[1].payload.start, v[1].payload.end, v[1].payload.uncertain],
      ["stale", "create_event", await at(c, 3, "18:00"), await at(c, 3, "20:00"), ["tz"]]);
  } },
  { name: "resolve ampm boundary: 00:00 ↔ 12:00 ok; 'as is' ok and clears the code; +6 h or the next day's value → bad_value", run: async (c) => {
    const a = await seed(c, "r2", [{ title: "합성 자정", start: await at(c, 3, "00:00"), uncertain: ["ampm"] }]);
    assertEquals((await resolve(c, a.props[0], "ampm", await at(c, 3, "12:00"))).status, "ok");
    const b = await seed(c, "r3", [{ title: "합성 그대로", start: await at(c, 3, "07:00"), uncertain: ["ampm"] }]);
    assertEquals((await resolve(c, b.props[0], "ampm", await at(c, 3, "07:00"))).status, "ok");
    assertEquals((await versions(c, b.facts[0]))[1].payload.uncertain, []);
    const d = await seed(c, "r4", [{ title: "합성 저녁", start: await at(c, 3, "18:00"), uncertain: ["ampm"] }]);
    assertEquals((await resolve(c, d.props[0], "ampm", await at(c, 3, "12:00"))).status, "bad_value");
    assertEquals((await resolve(c, d.props[0], "ampm", await at(c, 4, "06:00"))).status, "bad_value");   // +12h 지만 날짜가 바뀐다
  } },
  { name: "resolve year: this or next Seoul year with the same month/day/time; other years or a changed day → bad_value", run: async (c) => {
    const y = Number((await day(c, 0)).slice(0, 4));
    const md = (await day(c, 5)).slice(4);
    const s = await seed(c, "r5", [{ title: "합성 행사", start: `${y}${md}T10:00:00+09:00`, uncertain: ["year"] }]);
    assertEquals((await resolve(c, s.props[0], "year", `${y + 2}${md}T10:00:00+09:00`)).status, "bad_value");
    assertEquals((await resolve(c, s.props[0], "year", `${y + 1}${md}T11:00:00+09:00`)).status, "bad_value");
    assertEquals((await resolve(c, s.props[0], "year", `${y + 1}${md}T10:00:00+09:00`)).status, "ok");
    const d = await seed(c, "r6", [{ title: "합성 종일", start: `${y}${md}`, uncertain: ["year"] }]);
    assertEquals((await resolve(c, d.props[0], "year", `${y}${md}`)).status, "ok");
  } },
  { name: "resolve date: keeps the time; start-less → all-day with end null; also clears year; outside −1y..+2y → bad_value", run: async (c) => {
    const s = await seed(c, "r7", [{ title: "합성 음력", start: await at(c, 3, "15:00"), end: await at(c, 3, "16:00"), uncertain: ["date", "year", "ampm"] }]);
    const r = await resolve(c, s.props[0], "date", await day(c, 10));
    assertEquals(r.status, "ok");
    const v = await versions(c, s.facts[0]);
    assertEquals([v[1].payload.start, v[1].payload.end, v[1].payload.uncertain], [await at(c, 10, "15:00"), await at(c, 10, "16:00"), ["ampm"]]);
    const n = await seed(c, "r8", [{ title: "합성 미정", start: null, end: await at(c, 3, "16:00"), uncertain: ["date"] }]);
    assertEquals((await resolve(c, n.props[0], "date", await day(c, 4))).status, "ok");
    const nv = await versions(c, n.facts[0]);
    assertEquals([nv[1].payload.start, nv[1].payload.end], [await day(c, 4), null]);
    const o = await seed(c, "r9", [{ title: "합성 범위", start: await at(c, 3, "15:00"), uncertain: ["date"] }]);
    const far = (await one(c, "select to_char((now() at time zone 'Asia/Seoul')::date + interval '2 years' + interval '1 day', 'YYYY-MM-DD') as d")).d;
    const old = (await one(c, "select to_char((now() at time zone 'Asia/Seoul')::date - interval '1 year' - interval '1 day', 'YYYY-MM-DD') as d")).d;
    assertEquals([(await resolve(c, o.props[0], "date", far)).status, (await resolve(c, o.props[0], "date", old)).status], ["bad_value", "bad_value"]);
    assertEquals((await resolve(c, o.props[0], "date", "2026-02-30")).status, "bad_value");
  } },
  { name: "resolve date leap day: 02-29 only in a leap year (2028 ok, 2027 bad_value)", run: async (c) => {
    const s = await seed(c, "rl", [{ title: "합성 윤일", start: await at(c, 3, "09:00"), uncertain: ["date"] }]);
    assertEquals((await resolve(c, s.props[0], "date", "2027-02-29")).status, "bad_value");
    assertEquals((await resolve(c, s.props[0], "date", "2028-02-29")).status, "ok");      // 2026-10 기준 +2년 안
  } },
  { name: "resolve keeps the length of an event that crosses the year (12/31 23:00–1/1 01:00) under ampm and date", run: async (c) => {
    const y = Number((await day(c, 0)).slice(0, 4));
    const s = await seed(c, "ry", [{ title: "합성 송년", start: `${y}-12-31T23:00:00+09:00`, end: `${y + 1}-01-01T01:00:00+09:00`, uncertain: ["ampm"] }]);
    await resolve(c, s.props[0], "ampm", `${y}-12-31T11:00:00+09:00`);
    assertEquals((await versions(c, s.facts[0]))[1].payload.end, `${y}-12-31T13:00:00+09:00`);
    const d = await seed(c, "rz", [{ title: "합성 송년2", start: `${y}-12-31T23:00:00+09:00`, end: `${y + 1}-01-01T01:00:00+09:00`, uncertain: ["date"] }]);
    await resolve(c, d.props[0], "date", `${y}-12-30`);
    assertEquals((await versions(c, d.facts[0]))[1].payload.end, `${y}-12-31T01:00:00+09:00`);
  } },
  { name: "resolve location: '' clears the place (null) even when it was already null; any other value → bad_value", run: async (c) => {
    const s = await seed(c, "rp", [{ title: "합성 미팅", start: await at(c, 3, "10:00"), location: null, uncertain: ["location"] }]);
    assertEquals((await resolve(c, s.props[0], "location", "합성카페")).status, "bad_value");
    assertEquals((await resolve(c, s.props[0], "location", "")).status, "ok");
    const v = await versions(c, s.facts[0]);
    assertEquals([v.length, v[1].payload.location, v[1].payload.uncertain], [2, null, []]);
  } },
  { name: "resolve: a code not in uncertain → not_uncertain; end, tz or an unknown code → bad_value", run: async (c) => {
    const s = await seed(c, "rc", [{ title: "합성 미팅", start: await at(c, 3, "10:00"), uncertain: ["end", "tz"] }]);
    assertEquals((await resolve(c, s.props[0], "ampm", await at(c, 3, "22:00"))).status, "not_uncertain");
    for (const code of ["end", "tz", "recurrence"]) assertEquals((await resolve(c, s.props[0], code, "")).status, "bad_value");
  } },
  { name: "resolve not_found: another user, a non-chat item, a succeeded top, an update_event top, an older version id; no multi or 30-minute check", run: async (c) => {
    const s = await seed(c, "rn", [{ title: "합성 미팅", start: await at(c, 3, "06:00"), uncertain: ["ampm"] }]);
    assertEquals((await resolve(c, s.props[0], "ampm", await at(c, 3, "18:00"), c.other)).status, "not_found");
    const sms = await seed(c, "rs", [{ title: "합성 문자", start: await at(c, 3, "06:00"), uncertain: ["ampm"] }], { source: "MESSAGES", app: null });
    assertEquals((await resolve(c, sms.props[0], "ampm", await at(c, 3, "18:00"))).status, "not_found");
    const won = await seed(c, "rw", [{ title: "합성 완료", start: await at(c, 3, "06:00"), uncertain: ["ampm"] }]);
    await report(c, won.props[0], 1);
    assertEquals((await resolve(c, won.props[0], "ampm", await at(c, 3, "18:00"))).status, "not_found");
    const up = await edit(c, won.props[0], { title: "합성 완료2" });
    assertEquals((await resolve(c, up.proposal_id, "ampm", await at(c, 3, "18:00"))).status, "not_found");
    const old = await seed(c, "ro", [{ title: "합성 옛", start: await at(c, 3, "06:00"), uncertain: ["ampm", "location"] }], { ago: 7200 });
    assertEquals((await resolve(c, old.props[0], "ampm", await at(c, 3, "18:00"))).status, "ok");            // 2시간 전 등록 — 30분 제한 없음
    assertEquals((await resolve(c, old.props[0], "location", "")).status, "not_found");                      // v1 은 이제 최고 버전이 아니다
    const multi = await seed(c, "rm", [{ title: "합성 둘1", start: await at(c, 3, "06:00"), uncertain: ["ampm"] }, { title: "합성 둘2", start: await at(c, 3, "09:00") }]);
    assertEquals((await resolve(c, multi.props[0], "ampm", await at(c, 3, "18:00"))).status, "ok");            // 다건 등록도 버튼은 된다
  } },
  { name: "resolve passes a non-ok apply result through instead of ok with the old id (final review E2 ③ — apply swapped in this transaction)", localOnly: true, run: async (c) => {
    const s = await seed(c, "rk", [{ title: "합성 미팅", start: await at(c, 3, "06:00"), uncertain: ["ampm"] }]);
    await c.q(`create or replace function chat_edit_apply(p_user uuid, p_fact uuid, p_patch jsonb, p_clear text[]) returns jsonb language sql set search_path = public as
      $$ select jsonb_build_object('status', 'no_change', 'proposal_id', (select id from proposals where fact_id = p_fact order by version desc limit 1), 'version', 1) $$`);
    const r = await resolve(c, s.props[0], "ampm", await at(c, 3, "18:00"));
    assertEquals([r.status, r.proposal_id, r.version], ["no_change", s.props[0], 1]);
  } },
  { name: "resolve privileges: anon cannot execute; authenticated can; without a JWT it raises not authenticated (28000)", privileges: true, run: async (c) => {
    const g = await c.q(`select has_function_privilege('anon', 'public.resolve_uncertain(uuid, text, text)', 'execute') as anon,
      has_function_privilege('authenticated', 'public.resolve_uncertain(uuid, text, text)', 'execute') as auth, p.prosecdef, p.proconfig
      from pg_proc p where p.oid = 'public.resolve_uncertain(uuid, text, text)'::regprocedure`);
    assertEquals([g[0].anon, g[0].auth, g[0].prosecdef, g[0].proconfig], [false, true, true, ['search_path=""']]);
    const s = await seed(c, "rj", [{ title: "합성 미팅", start: await at(c, 3, "06:00"), uncertain: ["ampm"] }]);
    await fails(c, "select resolve_uncertain($1::uuid, 'ampm', $2)", [s.props[0], await at(c, 3, "18:00")], "not authenticated");
  } },
];
// resolve_uncertain 은 사용자 JWT 로만(auth.uid())
export const resolve = (c: ECtx, pid: string, code: string, value: string, user = c.user) => asUser(c, user, async () =>
  (await one(c, "select resolve_uncertain($1::uuid, $2, $3) as r", [pid, code, value])).r as Row);
export { vals };
