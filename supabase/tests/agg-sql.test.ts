import { AGG_CASES, type Q } from "./_agg-sql.ts";
import { pglite0035 } from "./_agg-pglite.ts";

// 0035(0.17.0 저장 규칙·집계 질문)를 로컬 PGlite 에서 — 기반(스텁·권한 흉내·0010·0011·0015·0016·0035)은 _agg-pglite.ts(K13).
// 호스팅 DB 는 건드리지 않는다(호스팅은 agg-db.test.ts). hostedOnly 사례는 건너뛴다
const db = await pglite0035();
const q: Q = async (sql, params = []) => (await db.query(sql, params)).rows as Record<string, unknown>[];

for (const c of AGG_CASES) {
  Deno.test({ name: "pglite: " + c.name, ignore: c.hostedOnly === true, sanitizeResources: false, sanitizeOps: false, fn: async () => {
    await db.exec("begin");
    try {
      const user = crypto.randomUUID(), other = crypto.randomUUID();
      await q("insert into auth.users (id) values ($1::uuid), ($2::uuid)", [user, other]);
      await c.run({ q, user, other, tag: "test:" + crypto.randomUUID().slice(0, 8) });
    } finally {
      await db.exec("rollback");
    }
  } });
}
