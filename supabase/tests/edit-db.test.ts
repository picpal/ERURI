import { assert, assertEquals } from "jsr:@std/assert";
import postgres from "npm:postgres@3";
import { at, EDIT_CASES, type ECtx, MIGRATION_0033, seed } from "./_edit-sql.ts";
import { RUN, testUser } from "./_testenv.ts";

// 0033 호스팅 트랜잭션 테스트(계획 E1·D1 Step 3): 같은 사례를 테스트 사용자 21 로 한 트랜잭션 안에서, 사례마다 savepoint, 끝에서 롤백.
// 동시 고치기 사례만 실행 태그 행을 커밋하고 finally 에서 그 항목만 지운다(cascade facts → proposals → executions). EDIT_DB_TEST=1 일 때만
const ON = Deno.env.get("EDIT_DB_TEST") === "1";
const url = ON ? (await Deno.readTextFile(new URL("../.temp/pooler-url", import.meta.url))).trim() : "";
const opts = { password: Deno.env.get("SUPABASE_DB_PASSWORD"), max: 1, prepare: false, onnotice: () => {} } as const;

Deno.test({ name: "hosted: 0033 cases in one rolled-back transaction (test user 21)", ignore: !ON, sanitizeResources: false, sanitizeOps: false, fn: async () => {
  const sql = postgres(url, opts);
  const user = (await testUser(21)).id, other = (await testUser(22)).id;   // 다른 사용자도 0.16.0 테스트 사용자(22) — 1번 등 다른 사용자를 만들거나 바꾸지 않는다
  try {
    await sql.begin(async (tx) => {
      await tx.unsafe("set local lock_timeout = '3s'");
      const q = async (s: string, p: unknown[] = []) => await tx.unsafe(s, p as never[]) as unknown as Record<string, unknown>[];
      const ctx: ECtx = { q: q as ECtx["q"], user, other, run: RUN };
      // 적용 전(D1 Step 3 첫 실행)이면 이 트랜잭션 안에서 0033 을 적용하고 끝에 롤백한다. 적용 뒤(둘째 실행)는 배포본 그대로
      const applied = (await q("select to_regprocedure('public.chat_edit_state(uuid,uuid,boolean,boolean)') is not null as a"))[0].a === true;
      if (!applied) await tx.unsafe(await Deno.readTextFile(MIGRATION_0033));
      console.log("0033", applied ? "already applied" : "applied in the rolled-back transaction");
      for (const c of EDIT_CASES.filter((c) => !c.localOnly)) {
        await tx.unsafe("savepoint each_case");
        try { await c.run(ctx); console.log("ok", c.name); }
        finally { await tx.unsafe("rollback to savepoint each_case"); }
      }
      throw new Error("rollback");                                          // 전부 되돌린다
    }).catch((e) => { if (!(e instanceof Error && e.message === "rollback")) throw e; });
  } finally { await sql.end(); }
} });

// 동시 고치기(EDIT-server ②): 커밋한 합성 항목 하나에 연결 A 가 chat_edit_proposal 로 행을 잠근 채, 연결 B 의 고치기는 lock_timeout 으로 실패한다.
// A 커밋 뒤 version 은 1·2 뿐(중복 없음). 끝에 실행 태그 항목만 지운다
Deno.test({ name: "hosted: two concurrent edits — the second waits on the row lock; no duplicate version", ignore: !ON, sanitizeResources: false, sanitizeOps: false, fn: async () => {
  const user = (await testUser(21)).id;
  const a = postgres(url, opts), b = postgres(url, opts), s = postgres(url, opts);
  const q = async (s0: string, p: unknown[] = []) => await s.unsafe(s0, p as never[]) as unknown as Record<string, unknown>[];
  const ctx: ECtx = { q: q as ECtx["q"], user, other: user, run: `${RUN}:conc` };
  let item = "";
  try {
    // 동시 사례는 커밋된 함수가 있어야 한다 — 0033 적용 뒤(D1 Step 3 둘째 실행)에만
    if ((await q("select to_regprocedure('public.chat_edit_state(uuid,uuid,boolean,boolean)') is not null as a"))[0].a !== true) {
      console.log("skip: 0033 not applied yet"); return;
    }
    const seeded = await seed(ctx, "conc", [{ title: "합성 동시", start: await at(ctx, 2, "11:00") }]);   // 자동 커밋
    item = seeded.item;
    let bErr = "";
    await a.begin(async (ta) => {
      await ta.unsafe("select chat_edit_proposal($1::uuid, $2::uuid, $3::text::jsonb, $4::text[])", [user, seeded.props[0], JSON.stringify({ title: "합성 동시 A" }), "{}"] as never[]);
      await b.begin(async (tb) => {
        await tb.unsafe("set local lock_timeout = '1s'");
        try { await tb.unsafe("select chat_edit_proposal($1::uuid, $2::uuid, $3::text::jsonb, $4::text[])", [user, seeded.props[0], JSON.stringify({ title: "합성 동시 B" }), "{}"] as never[]); }
        catch (e) { bErr = e instanceof Error ? e.message : String(e); }
      }).catch(() => {});
    });
    assert(/lock timeout/i.test(bErr), `B must wait on the lock, got "${bErr}"`);
    const v = await q("select version from proposals where fact_id = $1::uuid order by version", [seeded.facts[0]]);
    assertEquals(v.map((r) => r.version), [1, 2]);
  } finally {
    if (item) await q("delete from items where id = $1::uuid and user_id = $2::uuid", [item, user]);   // 이 실행의 항목만(cascade)
    await Promise.all([a.end(), b.end(), s.end()]);
  }
} });
