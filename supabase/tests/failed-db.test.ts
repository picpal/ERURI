import postgres from "npm:postgres@3";
import { FAILED_CASES, MIGRATION_0034 } from "./_failed-sql.ts";
import { RUN, testUser } from "./_testenv.ts";

// 0034 호스팅 트랜잭션 테스트(0.16.1): 같은 사례를 테스트 사용자 23 으로 한 트랜잭션 안에서, 사례마다 savepoint, 끝에서 롤백.
// 적용 전이면 이 트랜잭션 안에서 0034 를 적용하고 롤백한다(배포본은 바뀌지 않는다). 멱등 키 접두 = 실행 태그. FAILED_DB_TEST=1 일 때만
const ON = Deno.env.get("FAILED_DB_TEST") === "1";
const url = ON ? (await Deno.readTextFile(new URL("../.temp/pooler-url", import.meta.url))).trim() : "";
const opts = { password: Deno.env.get("SUPABASE_DB_PASSWORD"), max: 1, prepare: false, onnotice: () => {} } as const;

Deno.test({ name: "hosted: 0034 cases in one rolled-back transaction (test user 23)", ignore: !ON, sanitizeResources: false, sanitizeOps: false, fn: async () => {
  const sql = postgres(url, opts);
  const user = (await testUser(23)).id;
  try {
    await sql.begin(async (tx) => {
      await tx.unsafe("set local lock_timeout = '3s'");
      const q = async (s: string, p: unknown[] = []) => await tx.unsafe(s, p as never[]) as unknown as Record<string, unknown>[];
      const applied = (await q("select to_regprocedure('public.retry_item(uuid)') is not null as a"))[0].a === true;
      if (!applied) await tx.unsafe(await Deno.readTextFile(MIGRATION_0034));
      console.log("0034", applied ? "already applied" : "applied in the rolled-back transaction");
      for (const c of FAILED_CASES) {
        await tx.unsafe("savepoint each_case");
        try { await c.run({ q: q as never, user, tag: RUN }); console.log("ok", c.name); }
        finally { await tx.unsafe("rollback to savepoint each_case"); }
      }
      throw new Error("rollback");                                          // 전부 되돌린다
    }).catch((e) => { if (!(e instanceof Error && e.message === "rollback")) throw e; });
  } finally { await sql.end(); }
} });
