import { assertEquals } from "jsr:@std/assert";
import postgres from "npm:postgres@3";
import type { Q } from "./_usage-sql.ts";
import { DIGEST_CASES, MIGRATION_0037 } from "./_digest-sql.ts";
import { testUser } from "./_testenv.ts";

// 호스팅 DB(G1): 트랜잭션 하나 — 0037 이 없으면 그 안에서 적용, 사례마다 savepoint, 끝에서 전체 롤백. 테스트 사용자 21·22 — 행은 롤백으로 사라진다. DIGEST_DB_TEST=1 일 때만
const MIGRATION = await Deno.readTextFile(MIGRATION_0037);
const HOLD_FUNCTIONS = ["reserve_usage_hold(uuid, text, text, numeric)", "settle_usage_hold(uuid, text, jsonb)"];
function connect() {
  const url = new URL(Deno.readTextFileSync(new URL("../.temp/pooler-url", import.meta.url)).trim());
  return postgres({ host: url.hostname, port: Number(url.port || 5432), database: url.pathname.slice(1) || "postgres",
    username: decodeURIComponent(url.username), password: Deno.env.get("SUPABASE_DB_PASSWORD")!, ssl: "require", prepare: false, onnotice: () => {} });
}
class Rollback extends Error {}
Deno.test({ name: "hosted: 0037 cases in one rolled-back transaction", ignore: Deno.env.get("DIGEST_DB_TEST") !== "1", fn: async (t) => {
  const [user, other] = [(await testUser(21)).id, (await testUser(22)).id];
  const sql = connect();
  try {
    await sql.begin(async (tx) => {
      await tx.unsafe("set local lock_timeout = '3s'");
      const [{ applied }] = await tx.unsafe("select usage_ledger_pair('chat', 'mail_digest') as applied");
      console.log(JSON.stringify({ step: applied ? "0037 already applied" : "0037 applied in the rolled-back transaction" }));
      if (!applied) await tx.unsafe(MIGRATION);
      const q: Q = async (s, p = []) => await tx.unsafe(s, p as never[]) as unknown as Record<string, unknown>[];
      // 새 함수는 security definer 가 아니다 — service role 이 함수 실행과 usage_holds 쓰기를 모두 할 수 있어야 digest 가 돈다(PF-5)
      await t.step("privileges: service_role can execute reserve_usage_hold·settle_usage_hold and write usage_holds", async () => {
        const fns = await q("select f, has_function_privilege('service_role', f, 'execute') as ok from unnest($1::text[]) as f", ["{" + HOLD_FUNCTIONS.map((f) => `"${f}"`).join(",") + "}"]);
        assertEquals(fns.map((r) => [r.f, r.ok]), HOLD_FUNCTIONS.map((f) => [f, true]));
        const [{ ok }] = await q("select has_table_privilege('service_role', 'public.usage_holds', 'select, insert, update, delete') as ok");
        assertEquals(ok, true);
      });
      for (const c of DIGEST_CASES) {
        await tx.unsafe("savepoint digest_case");
        try {
          // 테스트 사용자 21·22 의 행이 다른 게이트로 이미 있을 수 있다 — 사례가 절대값을 보므로 savepoint 안에서 지우고 시작한다(롤백으로 되살아난다, PF-5)
          await t.step(c.name, async () => {
            await q("delete from usage_counters where user_id = any($1::uuid[])", ["{" + user + "," + other + "}"]);
            await q("delete from usage_ledger where user_id = any($1::uuid[])", ["{" + user + "," + other + "}"]);
            await q("delete from audit_log where user_id = any($1::uuid[]) and actor = 'mail-read'", ["{" + user + "," + other + "}"]);
            await c.run({ q, user, other, clock: null });
          });
        } finally {
          await tx.unsafe("rollback to savepoint digest_case");
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
