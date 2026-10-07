import { assert, assertEquals } from "jsr:@std/assert";

// 0032 SQL 사례(계획 L1): PGlite(usage-sql.test.ts — 시계 사례 포함)와 호스팅 트랜잭션(usage-ledger-db.test.ts, D1 단계 — 시계 사례 제외)이 같은 사례를 돈다.
// 사례마다 한 트랜잭션 안에서 시작해 롤백으로 끝난다(실행자 쪽). 값은 합성 숫자·모델 이름만
// deno-lint-ignore no-explicit-any
export type Row = Record<string, any>;
export type Q = (sql: string, params?: unknown[]) => Promise<Row[]>;
export type UCtx = { q: Q; user: string; other: string; clock: ((iso: string | null) => Promise<void>) | null };
export type UsageCase = { name: string; clock?: true; privileges?: true; run(c: UCtx): Promise<void> };
export const MIGRATION_0032 = new URL("../migrations-pending/0032_usage_ledger.sql", import.meta.url);   // D1 단계가 ../migrations/ 로 바꾼다
export const USAGE_FUNCTIONS = ["usage_ledger_pair", "usage_line_ok", "usage_ledger_add", "reserve_usage_month", "settle_usage_lines", "record_usage",
  "usage_breakdown", "audit_mail_read"];

const L = (kind: string, model: string, input: number, cached: number, output: number, krw: number) => ({ kind, model, input, cached, output, krw });
const one = async (c: UCtx, sql: string, p: unknown[] = []) => (await c.q(sql, p))[0];
async function reserve(c: UCtx, kind: string, est: number, user = c.user, fn = "reserve_usage_month") {
  if (fn === "reserve_usage") return { status: (await one(c, "select reserve_usage($1::uuid, $2, $3::numeric) as s", [user, kind, est])).s as string, month: "" };
  const r = await one(c, "select status, month::text as month from reserve_usage_month($1::uuid, $2, $3::numeric)", [user, kind, est]);
  return { status: r.status as string, month: r.month as string };
}
const settle = (c: UCtx, kind: string, est: number, month: string, lines: unknown, user = c.user) =>
  c.q("select settle_usage_lines($1::uuid, $2, $3::numeric, $4::date, $5::jsonb)", [user, kind, est, month, JSON.stringify(lines)]);
async function counters(c: UCtx, month: string, user = c.user): Promise<{ reserved: number; backfill: number } | null> {
  const r = await c.q("select reserved_krw::text as r, backfill_reserved_krw::text as b from usage_counters where user_id = $1::uuid and month = $2::date", [user, month]);
  return r.length ? { reserved: Number(r[0].r), backfill: Number(r[0].b) } : null;
}
async function ledger(c: UCtx, month: string, user = c.user) {
  return (await c.q(`select kind, model, calls, input_tokens::text as i, cached_tokens::text as ca, output_tokens::text as o, krw::text as k
    from usage_ledger where user_id = $1::uuid and month = $2::date order by kind, model`, [user, month]))
    .map((r) => ({ kind: r.kind, model: r.model, calls: Number(r.calls), input: Number(r.i), cached: Number(r.ca), output: Number(r.o), krw: Number(r.k) }));
}
const monthAt = async (c: UCtx, shift: string) => (await one(c, `select (seoul_month() + interval '${shift}')::date::text as m`)).m as string;
// 예외를 기대하는 문장은 savepoint 안에서 — 실패한 문장이 바깥 트랜잭션을 오류 상태로 두지 않게
async function fails(c: UCtx, sql: string, p: unknown[], msg: string) {
  await c.q("savepoint usage_expect");
  let err = "";
  try { await c.q(sql, p); } catch (e) { err = e instanceof Error ? e.message : String(e); }
  await c.q("rollback to savepoint usage_expect");
  assert(err.includes(msg), `expected "${msg}", got "${err || "no error"}"`);
}
const settleFails = (c: UCtx, kind: string, est: number, month: string, lines: unknown, msg: string) =>
  fails(c, "select settle_usage_lines($1::uuid, $2, $3::numeric, $4::date, $5::jsonb)", [c.user, kind, est, month, JSON.stringify(lines)], msg);
async function breakdownAs(c: UCtx, user: string) {
  await c.q("select set_config('request.jwt.claim.sub', $1, true)", [user]);
  const rows = await c.q("select kind, model, calls, krw::text as k from usage_breakdown()");
  await c.q("select set_config('request.jwt.claim.sub', '', true)");
  return rows.map((r) => ({ kind: r.kind, model: r.model, calls: Number(r.calls), krw: Number(r.k) }));
}
// 10/31 23:59:58 → 11/1 00:00:03 (서울)
const BEFORE_MIDNIGHT = "2026-10-31T14:59:58Z", AFTER_MIDNIGHT = "2026-10-31T15:00:03Z";

export const USAGE_CASES: UsageCase[] = [
  { name: "settle_usage_lines: two settles add into the same (kind, model) row; reserved_krw moves by −est + Σkrw", run: async (c) => {
    const a = await reserve(c, "chat", 2);
    assertEquals(a.status, "ok");
    await settle(c, "chat", 2, a.month, [L("chat", "gpt-6-luna", 800, 0, 100, 0.2), L("chat", "gpt-6-sol", 5000, 1000, 400, 20)]);
    assertEquals((await counters(c, a.month))!.reserved, 20.2);
    const b = await reserve(c, "chat", 2);
    await settle(c, "chat", 2, b.month, [L("chat", "gpt-6-luna", 800, 0, 100, 0.2)]);
    assertEquals((await counters(c, a.month))!.reserved, 20.4);
    assertEquals(await ledger(c, a.month), [
      { kind: "chat", model: "gpt-6-luna", calls: 2, input: 1600, cached: 0, output: 200, krw: 0.4 },
      { kind: "chat", model: "gpt-6-sol", calls: 1, input: 5000, cached: 1000, output: 400, krw: 20 }]);
  } },
  { name: "settle_usage_lines: zero lines cancels the reservation and writes no ledger row", run: async (c) => {
    const a = await reserve(c, "chat", 3);
    await settle(c, "chat", 3, a.month, []);
    assertEquals((await counters(c, a.month))!.reserved, 0);
    assertEquals(await ledger(c, a.month), []);
  } },
  { name: "kind split: a chat reservation settles a mail_summary line into the mail_summary row; backfill settles the backfill budget", run: async (c) => {
    const a = await reserve(c, "chat", 3);
    await settle(c, "chat", 3, a.month, [L("mail_summary", "gpt-6-luna", 9000, 0, 600, 1.68)]);
    const b = await reserve(c, "backfill", 1);
    await settle(c, "backfill", 1, b.month, [L("backfill", "gpt-6-luna", 1500, 0, 300, 0.42)]);
    assertEquals(await counters(c, a.month), { reserved: 1.68, backfill: 0.42 });
    assertEquals((await ledger(c, a.month)).map((r) => [r.kind, r.calls, r.krw]), [["backfill", 1, 0.42], ["mail_summary", 1, 1.68]]);
  } },
  { name: "a line whose kind is not allowed for the reservation (chat+extract, backfill+extract) raises bad_pair and changes nothing", run: async (c) => {
    const a = await reserve(c, "chat", 3);
    await settleFails(c, "chat", 3, a.month, [L("chat", "gpt-6-luna", 10, 0, 1, 0.01), L("extract", "gpt-6-luna", 10, 0, 1, 0.01)], "bad_pair");
    const b = await reserve(c, "backfill", 1);
    await settleFails(c, "backfill", 1, b.month, [L("extract", "gpt-6-luna", 10, 0, 1, 0.01)], "bad_pair");
    assertEquals(await counters(c, a.month), { reserved: 3, backfill: 1 });     // 예약은 남는다(정산 실패 = 기존 동작)
    assertEquals(await ledger(c, a.month), []);
  } },
  { name: "malformed lines raise and change nothing (negative, cached > input, fractional, 51 lines, empty or 61-char model, negative krw, string number, missing key)", run: async (c) => {
    const a = await reserve(c, "chat", 1);
    const ok = L("chat", "gpt-6-luna", 10, 0, 1, 0.01);
    const bad: [unknown, string][] = [
      [[{ ...ok, input: -1 }], "bad_line"], [[{ ...ok, cached: 11 }], "bad_line"], [[{ ...ok, output: 1.5 }], "bad_line"],
      [Array.from({ length: 51 }, () => ok), "bad_lines"], [[{ ...ok, model: "" }], "bad_line"], [[{ ...ok, model: "m".repeat(61) }], "bad_line"],
      [[{ ...ok, krw: -0.01 }], "bad_line"], [[{ ...ok, input: "10" }], "bad_line"], [[{ kind: "chat", model: "gpt-6-luna", input: 1, output: 1, krw: 0 }], "bad_line"],
      [{ kind: "chat" }, "bad_lines"], [[{ ...ok, kind: "jev" }], "bad_line"]];
    for (const [lines, msg] of bad) await settleFails(c, "chat", 1, a.month, lines, msg);
    assertEquals((await counters(c, a.month))!.reserved, 1);
    assertEquals(await ledger(c, a.month), []);
  } },
  { name: "record_usage takes vision lines only and never touches usage_counters", run: async (c) => {
    const m = await monthAt(c, "0 month");
    await c.q("select record_usage($1::uuid, $2::jsonb)", [c.user, JSON.stringify([L("vision", "gpt-6-luna", 4000, 0, 100, 0.63)])]);
    await fails(c, "select record_usage($1::uuid, $2::jsonb)", [c.user, JSON.stringify([L("chat", "gpt-6-luna", 1, 0, 1, 0)])], "bad_pair");
    assertEquals(await ledger(c, m), [{ kind: "vision", model: "gpt-6-luna", calls: 1, input: 4000, cached: 0, output: 100, krw: 0.63 }]);
    assertEquals(await counters(c, m), null);
  } },
  { name: "month boundary ⓐ: reserved 10/31 23:59:58, settled 11/1 00:00:03 with p_month = October, no November row → only October moves", clock: true, run: async (c) => {
    await c.clock!(BEFORE_MIDNIGHT);
    const a = await reserve(c, "chat", 2);
    assertEquals(a.month, "2026-10-01");
    await c.clock!(AFTER_MIDNIGHT);
    await settle(c, "chat", 2, a.month, [L("chat", "gpt-6-luna", 1000, 0, 100, 0.3)]);
    assertEquals((await counters(c, "2026-10-01"))!.reserved, 0.3);
    assertEquals(await counters(c, "2026-11-01"), null);
    assertEquals((await ledger(c, "2026-10-01")).map((r) => r.krw), [0.3]);
    assertEquals(await ledger(c, "2026-11-01"), []);
  } },
  { name: "month boundary ⓑ: a November reservation in flight keeps its est when an October call settles after midnight", clock: true, run: async (c) => {
    await c.clock!(BEFORE_MIDNIGHT);
    const a = await reserve(c, "chat", 2);
    await c.clock!(AFTER_MIDNIGHT);
    const b = await reserve(c, "chat", 5);
    assertEquals(b.month, "2026-11-01");
    await settle(c, "chat", 2, a.month, [L("chat", "gpt-6-luna", 1000, 0, 100, 0.3)]);
    assertEquals((await counters(c, "2026-11-01"))!.reserved, 5);
    assertEquals((await counters(c, "2026-10-01"))!.reserved, 0.3);
  } },
  { name: "month guard ⓒ: two months back or next month raises bad_month; last month without a reservation row raises reservation_missing", run: async (c) => {
    const cur = await reserve(c, "chat", 1);
    const line = [L("chat", "gpt-6-luna", 10, 0, 1, 0.01)];
    await settleFails(c, "chat", 1, await monthAt(c, "-2 month"), line, "bad_month");
    await settleFails(c, "chat", 1, await monthAt(c, "1 month"), line, "bad_month");
    await settleFails(c, "chat", 1, await monthAt(c, "-1 month"), line, "reservation_missing");
    assertEquals((await counters(c, cur.month))!.reserved, 1);
    assertEquals(await ledger(c, cur.month), []);
    assertEquals(await ledger(c, await monthAt(c, "-1 month")), []);
  } },
  { name: "month ⓓ: after midnight record_usage writes November and usage_breakdown shows this month only", clock: true, run: async (c) => {
    await c.clock!(BEFORE_MIDNIGHT);
    const a = await reserve(c, "chat", 2);
    await c.clock!(AFTER_MIDNIGHT);
    await settle(c, "chat", 2, a.month, [L("chat", "gpt-6-luna", 1000, 0, 100, 0.3)]);
    await c.q("select record_usage($1::uuid, $2::jsonb)", [c.user, JSON.stringify([L("vision", "gpt-6-luna", 4000, 0, 100, 0.63)])]);
    assertEquals(await breakdownAs(c, c.user), [{ kind: "vision", model: "gpt-6-luna", calls: 1, krw: 0.63 }]);
  } },
  { name: "reserve_usage_month ⓔ: same statuses and increments as 0014 reserve_usage (ok → degraded at 80% → refused; backfill own cap)", run: async (c) => {
    const seq: [string, number][] = [["extract", 7000], ["chat", 1500], ["chat", 2000], ["backfill", 1400], ["backfill", 200]];
    const viaNew: string[] = [], viaOld: string[] = [];
    for (const [k, e] of seq) viaNew.push((await reserve(c, k, e)).status);
    for (const [k, e] of seq) viaOld.push((await reserve(c, k, e, c.other, "reserve_usage")).status);
    assertEquals(viaNew, ["ok", "degraded", "refused", "degraded", "refused"]);
    assertEquals(viaOld, viaNew);
    const m = await monthAt(c, "0 month");
    assertEquals(await counters(c, m), { reserved: 8500, backfill: 1400 });
    assertEquals(await counters(c, m, c.other), { reserved: 8500, backfill: 1400 });
  } },
  { name: "usage_breakdown: the caller's own rows only (another user's claim sees nothing), kind·model order", run: async (c) => {
    const a = await reserve(c, "chat", 2);
    await settle(c, "chat", 2, a.month, [L("mail_summary", "gpt-6-luna", 100, 0, 10, 0.02), L("chat", "text-embedding-3-large", 30, 0, 0, 0.01)]);
    assertEquals(await breakdownAs(c, c.other), []);
    assertEquals((await breakdownAs(c, c.user)).map((r) => [r.kind, r.model]), [["chat", "text-embedding-3-large"], ["mail_summary", "gpt-6-luna"]]);
  } },
  { name: "privileges: anon cannot run usage_breakdown; authenticated cannot run settle_usage_lines·record_usage·reserve_usage_month·audit_mail_read", privileges: true, run: async (c) => {
    const as = async (role: string, sql: string, p: unknown[]) => {
      await c.q("savepoint usage_role");
      let err = "";
      try { await c.q(`set local role ${role}`); await c.q(sql, p); } catch (e) { err = e instanceof Error ? e.message : String(e); }
      await c.q("rollback to savepoint usage_role");
      return err;
    };
    assert((await as("anon", "select * from usage_breakdown()", [])).includes("permission denied"));
    assertEquals(await as("authenticated", "select * from usage_breakdown()", []), "");
    for (const s of ["select settle_usage_lines($1::uuid, 'chat', 0, seoul_month(), '[]'::jsonb)", "select record_usage($1::uuid, '[]'::jsonb)",
      "select * from reserve_usage_month($1::uuid, 'chat', 0)", "select audit_mail_read($1::uuid, repeat('a', 64))"]) {
      assert((await as("authenticated", s, [c.user])).includes("permission denied"), s);
    }
  } },
  { name: "chat_tokens column is gone; 4-arg settle_usage still settles the current month and writes no ledger row", run: async (c) => {
    assertEquals((await c.q("select 1 from information_schema.columns where table_name = 'usage_counters' and column_name = 'chat_tokens'")).length, 0);
    await reserve(c, "chat", 2, c.user, "reserve_usage");
    await c.q("select settle_usage($1::uuid, 'chat', 2, 0.5)", [c.user]);
    const m = await monthAt(c, "0 month");
    assertEquals((await counters(c, m))!.reserved, 0.5);
    assertEquals(await ledger(c, m), []);
  } },
  { name: "audit_mail_read writes actor mail-read · action read_mail with a 64-hex target only", run: async (c) => {
    const h = "ab".repeat(32);
    await c.q("select audit_mail_read($1::uuid, $2)", [c.user, h]);
    await fails(c, "select audit_mail_read($1::uuid, $2)", [c.user, "18c2f0a1b2c3d4e5"], "bad_target");
    assertEquals((await c.q("select actor, action, target from audit_log where user_id = $1::uuid and actor = 'mail-read'", [c.user])).map((r) => [r.actor, r.action, r.target]),
      [["mail-read", "read_mail", h]]);
  } },
];
