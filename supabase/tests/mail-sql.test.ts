import { PGlite } from "npm:@electric-sql/pglite@0.3";
import { CASES, MIGRATION_0030, type Q, setupCtx } from "./_mail-sql.ts";
import { PGLITE_STUBS } from "./_pglite-stubs.ts";

// 0030 을 로컬 PGlite 에 적용하고 공유 사례를 돈다(계획 M3 — ③c2 전에도 돌릴 수 있다. 호스팅 DB 는 건드리지 않는다)
const db = new PGlite();
await db.exec(PGLITE_STUBS);
await db.exec(await Deno.readTextFile(MIGRATION_0030));
const q: Q = async (sql, params = []) => (await db.query(sql, params)).rows as Record<string, unknown>[];

for (const c of CASES) {
  Deno.test({ name: "pglite: " + c.name, sanitizeResources: false, sanitizeOps: false, fn: async () => {
    await db.exec("begin");
    try {
      const user = crypto.randomUUID();
      await q("insert into auth.users (id) values ($1::uuid)", [user]);
      await c.run(await setupCtx(q, user, "test:" + crypto.randomUUID().slice(0, 8)));
    } finally {
      await db.exec("rollback");
    }
  } });
}
