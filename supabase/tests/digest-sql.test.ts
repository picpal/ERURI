import { assert } from "jsr:@std/assert";
import { PGlite } from "npm:@electric-sql/pglite@0.3";
import { PGLITE_STUBS, USAGE_STUBS } from "./_pglite-stubs.ts";
import { MIGRATION_0032, type Q } from "./_usage-sql.ts";
import { DIGEST_CASES, MIGRATION_0037 } from "./_digest-sql.ts";

// 0014 + 0032 (+ 0037) 를 PGlite 에 — 호스팅은 건드리지 않는다(DIGEST-unit ⑤)
async function fresh(with0037: boolean) {
  const db = new PGlite();
  await db.exec(PGLITE_STUBS);
  await db.exec(USAGE_STUBS);
  await db.exec(await Deno.readTextFile(new URL("../migrations/0014_usage_budget.sql", import.meta.url)));
  await db.exec(await Deno.readTextFile(MIGRATION_0032));
  if (with0037) await db.exec(await Deno.readTextFile(MIGRATION_0037));
  return db;
}
const db = await fresh(true);
const q: Q = async (sql, params = []) => (await db.query(sql, params)).rows as Record<string, unknown>[];
for (const c of DIGEST_CASES) {
  Deno.test({ name: "pglite digest: " + c.name, sanitizeResources: false, sanitizeOps: false, fn: async () => {
    await db.exec("begin");
    try {
      const [user, other] = [crypto.randomUUID(), crypto.randomUUID()];
      await q("insert into auth.users (id) values ($1::uuid), ($2::uuid)", [user, other]);
      await c.run({ q, user, other, clock: null });
    } finally { await db.exec("rollback"); }
  } });
}
Deno.test({ name: "pglite digest: without 0037 a mail_digest line is bad_line (deploy order: 0037 before mail-read)", sanitizeResources: false, sanitizeOps: false, fn: async () => {
  const old = await fresh(false);
  const user = crypto.randomUUID();
  await old.query("insert into auth.users (id) values ($1::uuid)", [user]);
  const r = (await old.query("select month::text as m from reserve_usage_month($1::uuid, 'chat', 5)", [user])).rows[0] as { m: string };
  let msg = "";
  try { await old.query("select settle_usage_lines($1::uuid, 'chat', 5, $2::date, $3::text::jsonb)",
    [user, r.m, JSON.stringify([{ kind: "mail_digest", model: "gpt-6-luna", input: 1, cached: 0, output: 1, krw: 0.1 }])]); } catch (e) { msg = String(e); }
  assert(msg.includes("bad_line"), msg);
} });
Deno.test({ name: "pglite digest: the kind check constraint is named usage_ledger_kind_check (U6)", sanitizeResources: false, sanitizeOps: false, fn: async () => {
  const r = (await db.query("select conname from pg_constraint where conrelid = 'usage_ledger'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%mail_digest%'")).rows;
  assert(r.length === 1 && (r[0] as { conname: string }).conname === "usage_ledger_kind_check", JSON.stringify(r));
} });
