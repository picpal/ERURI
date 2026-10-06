import { assertEquals } from "jsr:@std/assert";
import postgres from "npm:postgres@3";
import { arr, CASES, MAIL_FUNCTIONS, MIGRATION_0030, type Q, setupCtx } from "./_mail-sql.ts";
import { RUN, testUser } from "./_testenv.ts";

// 호스팅 DB(계획 M3·M10). unsub-gap-db 와 같은 방식이지만 **트랜잭션 하나**: 0030 이 아직 없으면 그 안에서 한 번만 적용하고,
// 사례마다 savepoint 로 되감은 뒤 끝에서 전체를 **롤백**한다(Fable N-M8 — 사례마다 적용·롤백하면 운영 connections(ACCESS EXCLUSIVE)·jobs(SHARE ROW EXCLUSIVE)
// 잠금을 사례 수만큼 잡는다). lock_timeout 3초 — 운영 잠금 뒤에서 오래 기다리지 않는다. 그동안(수 초) 운영 수집·워커 클레임이 이 트랜잭션을 기다린다(M10 에 명시).
// 테스트 사용자 21 전용(D18). 행은 모두 같은 트랜잭션에서 만들어 롤백으로 사라진다(운영 워커는 커밋 전 행을 보지 못한다).
// ③c2 전에는 실행하지 않는다 — 0030 적용이 jobs·connections 에 잠금을 건다(D1). 그래서 MAIL_DB_TEST=1 일 때만 돈다
// (supabase/tests/ 를 통째로 돌려도 운영 DB 에 DDL 잠금이 걸리지 않게 — M3 리뷰 Minor 6)
const MIGRATION = await Deno.readTextFile(MIGRATION_0030);
function connect() {
  const base = Deno.readTextFileSync(new URL("../.temp/pooler-url", import.meta.url)).trim();
  const url = new URL(base);
  return postgres({ host: url.hostname, port: Number(url.port || 5432), database: url.pathname.slice(1) || "postgres",
    username: decodeURIComponent(url.username), password: Deno.env.get("SUPABASE_DB_PASSWORD")!, ssl: "require", prepare: false, onnotice: () => {} });
}
class Rollback extends Error {}

Deno.test({ name: "hosted: 0030 cases in one rolled-back transaction", ignore: Deno.env.get("MAIL_DB_TEST") !== "1", fn: async (t) => {
  const user = (await testUser(21)).id;
  const sql = connect();
  try {
    await sql.begin(async (tx) => {
      await tx.unsafe("set local lock_timeout = '3s'");
      const [{ deployed }] = await tx.unsafe("select to_regprocedure('public.mail_action_start(uuid, uuid, text)') is not null as deployed");
      if (!deployed) await tx.unsafe(MIGRATION);
      const q: Q = async (s, p = []) => await tx.unsafe(s, p as never[]) as unknown as Record<string, unknown>[];
      // 호스팅 전용(M3 리뷰 Minor 1): 메일 정리는 전부 service_role 이 부른다. PGlite 는 Supabase 기본 권한을 흉내 내지 않아 여기서만 본다.
      // dead 트리거 안의 mail_action_finish 권한 오류는 exception 이 삼켜 행이 8일간 진행 중으로 남으므로 미리 막는다
      await t.step("privileges: service_role can execute every 0030 function", async () => {
        const rows = await q(`select p.proname, has_function_privilege('service_role', p.oid, 'execute') as ok from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = any($1::text[])`, [arr(MAIL_FUNCTIONS)]);
        assertEquals(rows.map((r) => r.proname).sort(), [...MAIL_FUNCTIONS].sort());
        assertEquals(rows.filter((r) => !r.ok).map((r) => r.proname), []);
      });
      for (const c of CASES) {
        await tx.unsafe("savepoint mail_case");
        try {
          await t.step(c.name, async () => { await c.run(await setupCtx(q, user, `${RUN}:m${crypto.randomUUID().slice(0, 4)}`)); });
        } finally {
          await tx.unsafe("rollback to savepoint mail_case");            // 실패한 사례(트랜잭션 오류 상태 포함)도 다음 사례 전에 되감는다
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
