import { PGlite } from "npm:@electric-sql/pglite@0.3";
import { PGLITE_STUBS, USAGE_STUBS } from "./_pglite-stubs.ts";
import { MIGRATION_0032, type Q, USAGE_CASES } from "./_usage-sql.ts";

// 0014 + 0032 를 로컬 PGlite 에 적용하고 공유 사례를 돈다(계획 L1 — 호스팅 DB 는 건드리지 않는다). 시계 사례(서울 자정 경계)는 여기서만
const db = new PGlite();
await db.exec(PGLITE_STUBS);
await db.exec(USAGE_STUBS);
await db.exec(await Deno.readTextFile(new URL("../migrations/0014_usage_budget.sql", import.meta.url)));
await db.exec(await Deno.readTextFile(MIGRATION_0032));
const q: Q = async (sql, params = []) => (await db.query(sql, params)).rows as Record<string, unknown>[];
const SKIP_PRIVILEGES = Deno.env.get("PGLITE_SKIP_PRIVILEGES") === "1";   // U6: PGlite 가 역할 권한을 재현하지 못하면 1 — 판정은 D1 호스팅 테스트

for (const c of USAGE_CASES) {
  Deno.test({ name: "pglite usage: " + c.name, ignore: c.privileges === true && SKIP_PRIVILEGES, sanitizeResources: false, sanitizeOps: false, fn: async () => {
    await db.exec("begin");
    try {
      const [user, other] = [crypto.randomUUID(), crypto.randomUUID()];
      await q("insert into auth.users (id) values ($1::uuid), ($2::uuid)", [user, other]);
      await c.run({ q, user, other, clock: async (iso) => {
        await q("delete from test_clock");
        if (iso) await q("insert into test_clock (at) values ($1::timestamptz)", [iso]);
      } });
    } finally {
      await db.exec("rollback");
    }
  } });
}
