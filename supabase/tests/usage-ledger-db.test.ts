import { assertEquals } from "jsr:@std/assert";
import postgres from "npm:postgres@3";
import { MIGRATION_0032, type Q, USAGE_CASES, USAGE_FUNCTIONS } from "./_usage-sql.ts";
import { testUser } from "./_testenv.ts";

// 호스팅 DB(계획 L1·D1 단계). mail-actions-db 와 같은 방식: 트랜잭션 하나 — 0032 가 아직 없으면 그 안에서 한 번만 적용하고 사례마다 savepoint 로 되감은 뒤
// 끝에서 전체를 롤백한다. 0032 는 usage_counters 열을 지워(ACCESS EXCLUSIVE) 그 수 초 동안 운영 예약·정산이 기다린다 — lock_timeout 3초.
// 테스트 사용자 21·22(D16) — 행은 같은 트랜잭션에서 만들어 롤백으로 사라진다. 시계 사례는 PGlite 에서만(운영 seoul_month 는 now()). USAGE_DB_TEST=1 일 때만
const MIGRATION = await Deno.readTextFile(MIGRATION_0032);
function connect() {
  const base = Deno.readTextFileSync(new URL("../.temp/pooler-url", import.meta.url)).trim();
  const url = new URL(base);
  return postgres({ host: url.hostname, port: Number(url.port || 5432), database: url.pathname.slice(1) || "postgres",
    username: decodeURIComponent(url.username), password: Deno.env.get("SUPABASE_DB_PASSWORD")!, ssl: "require", prepare: false, onnotice: () => {} });
}
class Rollback extends Error {}

Deno.test({ name: "hosted: 0032 cases in one rolled-back transaction", ignore: Deno.env.get("USAGE_DB_TEST") !== "1", fn: async (t) => {
  const [user, other] = [(await testUser(21)).id, (await testUser(22)).id];
  const sql = connect();
  try {
    await sql.begin(async (tx) => {
      await tx.unsafe("set local lock_timeout = '3s'");
      const [{ deployed }] = await tx.unsafe("select to_regprocedure('public.settle_usage_lines(uuid, text, numeric, date, jsonb)') is not null as deployed");
      if (!deployed) await tx.unsafe(MIGRATION);
      const q: Q = async (s, p = []) => await tx.unsafe(s, p as never[]) as unknown as Record<string, unknown>[];
      await t.step("privileges: service_role can execute every 0032 function", async () => {
        const rows = await q(`select p.proname, has_function_privilege('service_role', p.oid, 'execute') as ok from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = any($1::text[])`, ["{" + USAGE_FUNCTIONS.join(",") + "}"]);
        assertEquals(rows.map((r) => r.proname).sort(), [...USAGE_FUNCTIONS].sort());
        assertEquals(rows.filter((r) => !r.ok).map((r) => r.proname), []);
      });
      for (const c of USAGE_CASES) {
        if (c.clock) continue;
        await tx.unsafe("savepoint usage_case");
        try {
          // 테스트 사용자 21·22 의 이번 달 행이 다른 게이트로 이미 있을 수 있다 — 사례가 절대값을 보므로 savepoint 안에서 지우고 시작한다(롤백으로 되살아난다)
          await t.step(c.name, async () => {
            await q("delete from usage_counters where user_id = any($1::uuid[])", ["{" + user + "," + other + "}"]);
            await q("delete from usage_ledger where user_id = any($1::uuid[])", ["{" + user + "," + other + "}"]);
            await q("delete from audit_log where user_id = any($1::uuid[]) and actor = 'mail-read'", ["{" + user + "," + other + "}"]);
            await c.run({ q, user, other, clock: null });
          });
        } finally {
          await tx.unsafe("rollback to savepoint usage_case");
        }
      }
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  } finally {
    await sql.end();
  }
} });
