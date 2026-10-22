import { AGG_CASES, type Q } from "./_agg-sql.ts";
import { noVector, pglite0035 } from "./_agg-pglite.ts";
import { METRIC_CASES, MIGRATION_0036 } from "./_metric-sql.ts";

// 0036(0.18.0 본문 건수)을 로컬 PGlite 에서: 0035 기반(_agg-pglite.ts, K13) + 0036(migrations-pending — 호스팅에는 적용하지 않는다).
// 0035 사례 전부(AGG_CASES)를 0036 위에서 다시 돈다(배포 조합 회귀, K12). 호스팅은 metric-db.test.ts. hostedOnly 사례는 건너뛴다
const db = await pglite0035();
await db.exec(noVector(await Deno.readTextFile(MIGRATION_0036)));
const q: Q = async (sql, params = []) => (await db.query(sql, params)).rows as Record<string, unknown>[];

for (const [label, cases] of [["0035 on 0036", AGG_CASES], ["0036", METRIC_CASES]] as const) {
  for (const c of cases) {
    Deno.test({ name: `pglite ${label}: ${c.name}`, ignore: c.hostedOnly === true, sanitizeResources: false, sanitizeOps: false, fn: async () => {
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
}
