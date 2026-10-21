import postgres from "npm:postgres@3";
import { AGG_CASES, MIGRATION_0035 } from "./_agg-sql.ts";
import { RUN, testUser } from "./_testenv.ts";

// 0035 호스팅 테스트(0.17.0, 실행은 D1): 같은 사례를 테스트 사용자 22(주)·21(남)로 한 트랜잭션 안에서, 사례마다 savepoint, 끝에서 롤백.
// 적용 전이면 이 트랜잭션 안에서 0035 를 적용하고 롤백한다(배포본은 바뀌지 않는다). 멱등 키 접두 = 실행 태그. AGG_DB_TEST=1 일 때만.
// 롤백 밖은 둘: 동시 추가(커밋해야 잴 수 있다 — 값 r<run8>-<n> 만 만들고 finally 에서 그 값만 지운다, K15)·U1 측정
const ON = Deno.env.get("AGG_DB_TEST") === "1";
const url = ON ? (await Deno.readTextFile(new URL("../.temp/pooler-url", import.meta.url))).trim() : "";
const opts = { password: Deno.env.get("SUPABASE_DB_PASSWORD"), max: 1, prepare: false, onnotice: () => {} } as const;
const APPLIED = "select to_regprocedure('public.aggregate_items(uuid,text[],text,text[],date,date,text,text)') is not null as a";
const RUN8 = RUN.slice("test:".length);
type Rows = Record<string, unknown>[];

Deno.test({ name: "hosted: 0035 cases in one rolled-back transaction (test users 22·21)", ignore: !ON, sanitizeResources: false, sanitizeOps: false, fn: async () => {
  const sql = postgres(url, opts);
  const user = (await testUser(22)).id, other = (await testUser(21)).id;
  try {
    await sql.begin(async (tx) => {
      await tx.unsafe("set local lock_timeout = '3s'");
      const q = async (s: string, p: unknown[] = []) => await tx.unsafe(s, p as never[]) as unknown as Rows;
      const applied = (await q(APPLIED))[0].a === true;
      if (!applied) await tx.unsafe(await Deno.readTextFile(MIGRATION_0035));
      console.log("0035", applied ? "already applied" : "applied in the rolled-back transaction");
      // 사례는 두 사용자의 규칙이 0개라고 본다 — 남은 규칙을 테스트가 지우지 않는다(AGENTS.md §7). 있으면 멈추고 알린다(PF-F17)
      const left = await q("select count(*)::int as n from save_rules where user_id in ($1::uuid, $2::uuid)", [user, other]);
      if (left[0].n !== 0) throw new Error(`test users 22·21 already have ${left[0].n} save_rules — remove them first (the test does not delete them)`);
      for (const c of AGG_CASES) {
        if (c.localOnly) continue;
        await tx.unsafe("savepoint each_case");
        try { await c.run({ q: q as never, user, other, tag: RUN }); console.log("ok", c.name); }
        finally { await tx.unsafe("rollback to savepoint each_case"); }
      }
      throw new Error("rollback");                                          // 전부 되돌린다
    }).catch((e) => { if (!(e instanceof Error && e.message === "rollback")) throw e; });
  } finally { await sql.end(); }
} });

// advisory 잠금(save_rule_add): 19개에서 두 연결이 동시에 추가하면 하나만 added. B 가 잠금을 쥔 채 잠시 기다리는 동안 C 가 잠금을 기다린다
Deno.test({ name: "hosted: concurrent save_rule_add at 19 rules → exactly one added", ignore: !ON, sanitizeResources: false, sanitizeOps: false, fn: async () => {
  const [a, b, c] = [postgres(url, opts), postgres(url, opts), postgres(url, opts)];
  const user = (await testUser(22)).id;
  const value = (n: number | string) => `r${RUN8}-${n}`;
  try {
    if ((await a.unsafe(APPLIED))[0].a !== true) { console.log("skip: 0035 not applied yet"); return; }
    const left = (await a.unsafe("select count(*)::int as n from save_rules where user_id = $1::uuid", [user]))[0].n as number;
    if (left !== 0) { console.log(`skip: test user 22 already has ${left} save_rules (not deleted by the test)`); return; }
    try {
      await a.begin(async (tx) => {
        for (let n = 1; n <= 19; n++) {
          const r = (await tx.unsafe("select save_rule_add($1::uuid, 'keyword', $2) as r", [user, value(n)]))[0].r as { status: string };
          if (r.status !== "added") throw new Error(`seed rule ${n}: ${r.status}`);
        }
      });
      const one = (sql: postgres.Sql, v: string) => sql.begin(async (tx) => {
        await tx.unsafe("set local lock_timeout = '10s'");
        const r = (await tx.unsafe("select save_rule_add($1::uuid, 'keyword', $2) as r", [user, v]))[0].r as { status: string };
        await tx.unsafe("select pg_sleep(0.5)");                            // 잠금을 쥔 채 — 다른 쪽이 기다리게
        return r.status;
      });
      const got = (await Promise.all([one(b, value("b")), one(c, value("c"))])).sort();
      console.log("concurrent", got);
      if (JSON.stringify(got) !== JSON.stringify(["added", "limit"])) throw new Error(`expected [added, limit], got ${JSON.stringify(got)}`);
    } finally {
      await a.unsafe("delete from save_rules where user_id = $1::uuid and value like $2", [user, `r${RUN8}-%`]);
    }
  } finally { await Promise.all([a.end(), b.end(), c.end()]); }
} });

// U1(K5): 함수 속성 statement_timeout 이 그 함수를 부른 문장을 끊는가. 측정, 단언 없음 — K5·U1, 판정은 D1 이 gates.md 에 적는다(PF-F19)
Deno.test({ name: "hosted: statement_timeout attribute cancels the calling statement (U1, measured only)", ignore: !ON, sanitizeResources: false, sanitizeOps: false, fn: async () => {
  const sql = postgres(url, opts);
  try {
    await sql.begin(async (tx) => {
      await tx.unsafe("create function pg_temp.agg_slow() returns void language sql set statement_timeout = '1s' as $$ select pg_sleep(2) $$");
      await tx.unsafe("savepoint u1");
      const t0 = Date.now();
      let result = "completed";
      try { await tx.unsafe("select pg_temp.agg_slow()"); } catch (e) { result = String((e as { code?: string }).code ?? e); await tx.unsafe("rollback to savepoint u1"); }
      console.log("U1", result, `${Date.now() - t0}ms`);
      throw new Error("rollback");
    }).catch((e) => { if (!(e instanceof Error && e.message === "rollback")) throw e; });
  } finally { await sql.end(); }
} });
