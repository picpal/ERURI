import { assert, assertEquals } from "jsr:@std/assert";
import type { UCtx, UsageCase } from "./_usage-sql.ts";

// 0037 사례(계획 S1): PGlite(digest-sql.test.ts)와 호스팅 롤백(digest-db.test.ts, G1)이 같은 사례를 돈다. 합성 숫자·모델 이름만
export const MIGRATION_0037 = new URL("../migrations/0037_mail_digest_kind.sql", import.meta.url);   // G1 에서 migrations-pending/ 에서 옮겼다(호스팅 적용)
const L = (kind: string, krw: number) => ({ kind, model: "gpt-6-luna", input: 9000, cached: 0, output: 600, krw });
const one = async (c: UCtx, sql: string, p: unknown[] = []) => (await c.q(sql, p))[0];
async function reserve(c: UCtx, kind: string, est: number) {
  const r = await one(c, "select status, month::text as month from reserve_usage_month($1::uuid, $2, $3::numeric)", [c.user, kind, est]);
  return { status: r.status as string, month: r.month as string };
}
const settle = (c: UCtx, kind: string, est: number, month: string, lines: unknown) =>
  c.q("select settle_usage_lines($1::uuid, $2, $3::numeric, $4::date, $5::text::jsonb)", [c.user, kind, est, month, JSON.stringify(lines)]);
async function raises(p: Promise<unknown>, msg: string) {
  try { await p; } catch (e) { assert(String(e).includes(msg), String(e)); return; }
  throw new Error("expected " + msg);
}
// 예약 식별자(0037 usage_holds, DP25): 같은 hold 로 예약·정산 — 정산 한 번, 보상이 먼저면 늦은 예약은 cancelled. 예외 사례는 사례의 마지막 문장(트랜잭션이 깨진다)
const holdReserve = (c: UCtx, h: string, est: number) => one(c, "select status, month::text as month from reserve_usage_hold($1::uuid, $2, 'chat', $3::numeric)", [c.user, h, est]);
const holdSettle = async (c: UCtx, h: string, lines: unknown) => (await one(c, "select settle_usage_hold($1::uuid, $2, $3::text::jsonb) as r", [c.user, h, JSON.stringify(lines)])).r as string;
const reservedNow = async (c: UCtx) => Number((await one(c, "select coalesce((select reserved_krw from usage_counters where user_id = $1::uuid and month = seoul_month()), 0)::text as r", [c.user])).r);

export const DIGEST_CASES: UsageCase[] = [
  { name: "0037: a chat reservation settles mail_digest lines into one mail_digest row and returns the reservation", run: async (c) => {
    const a = await reserve(c, "chat", 20);
    assertEquals(a.status, "ok");
    await settle(c, "chat", 20, a.month, [L("mail_digest", 1.5), L("mail_digest", 1.25)]);
    const rows = await c.q("select kind, calls, krw::text as krw from usage_ledger where user_id = $1::uuid and month = $2::date", [c.user, a.month]);
    assertEquals(rows.map((r) => [r.kind, r.calls, Number(r.krw)]), [["mail_digest", 2, 2.75]]);
    assertEquals(Number((await one(c, "select reserved_krw::text as r from usage_counters where user_id = $1::uuid and month = $2::date", [c.user, a.month])).r), 2.75);
  } },
  { name: "0037: mail_digest under an extract reservation is bad_pair", run: async (c) => {
    const a = await reserve(c, "extract", 5);
    await raises(settle(c, "extract", 5, a.month, [L("mail_digest", 1)]), "bad_pair");
  } },
  { name: "0037: mail_summary and chat lines still settle under chat; an unknown kind is still bad_line", run: async (c) => {
    const a = await reserve(c, "chat", 10);
    await settle(c, "chat", 10, a.month, [L("mail_summary", 1), L("chat", 1)]);
    const b = await reserve(c, "chat", 10);
    await raises(settle(c, "chat", 10, b.month, [L("mail_digestx", 1)]), "bad_line");
  } },
  { name: "0037: usage_ledger kind check accepts mail_digest and rejects mail_digestx", run: async (c) => {
    const m = (await one(c, "select seoul_month()::text as m")).m as string;
    await c.q("insert into usage_ledger (user_id, month, kind, model) values ($1::uuid, $2::date, 'mail_digest', 'gpt-6-luna')", [c.user, m]);
    await raises(c.q("insert into usage_ledger (user_id, month, kind, model) values ($1::uuid, $2::date, 'mail_digestx', 'gpt-6-luna')", [c.user, m]), "check");
  } },
  { name: "0037 hold: reserve → settle with lines leaves Σkrw reserved; a second settle is done and changes nothing", run: async (c) => {
    const r0 = await reservedNow(c), h = crypto.randomUUID();
    assertEquals((await holdReserve(c, h, 20)).status, "ok");
    assertEquals(await reservedNow(c), r0 + 20);
    assertEquals(await holdSettle(c, h, [L("mail_digest", 1.5)]), "settled");
    assertEquals(await reservedNow(c), r0 + 1.5);
    assertEquals(await holdSettle(c, h, []), "done");
    assertEquals(await reservedNow(c), r0 + 1.5);
  } },
  { name: "0037 hold: reserve → empty settle returns the whole reservation (start value)", run: async (c) => {
    const r0 = await reservedNow(c), h = crypto.randomUUID();
    await holdReserve(c, h, 20);
    assertEquals([await holdSettle(c, h, []), await reservedNow(c)], ["settled", r0]);
  } },
  { name: "0037 hold: compensation before the reservation (reserve RPC timed out) leaves a tombstone — the late reservation is cancelled and adds nothing", run: async (c) => {
    const r0 = await reservedNow(c), h = crypto.randomUUID();
    assertEquals(await holdSettle(c, h, []), "absent");
    assertEquals((await holdReserve(c, h, 20)).status, "cancelled");
    assertEquals([await reservedNow(c), await holdSettle(c, h, [])], [r0, "done"]);
  } },
  { name: "0037 hold: a refused reservation is cancelled and settling it is done", run: async (c) => {
    const r0 = await reservedNow(c), h = crypto.randomUUID();
    assertEquals((await holdReserve(c, h, 1e12)).status, "refused");
    assertEquals([await holdSettle(c, h, []), await reservedNow(c)], ["done", r0]);
  } },
  { name: "0037 hold: lines without a reservation → reservation_missing", run: async (c) => {
    await raises(holdSettle(c, crypto.randomUUID(), [L("mail_digest", 1)]), "reservation_missing");
  } },
  { name: "0037 hold: a hold id that is not a lowercase UUID → check violation", run: async (c) => {
    await raises(holdReserve(c, "not-a-uuid", 5), "check");
  } },
];
