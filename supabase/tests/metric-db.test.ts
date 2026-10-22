import postgres from "npm:postgres@3";
import { assert, assertEquals } from "jsr:@std/assert";
import { AGG_CASES } from "./_agg-sql.ts";
import { METRIC_CASES, MIGRATION_0036 } from "./_metric-sql.ts";
import { RUN, testUserId } from "./_testenv.ts";

// 0036 호스팅 테스트(0.18.0 본문 건수, 실행은 D1 — METRIC-db): 0035 사례(AGG_CASES, 배포 조합 회귀 K12) + 0036 사례(METRIC_CASES)를
// 테스트 사용자 22(주)·21(남)로 한 트랜잭션 안에서, 사례마다 savepoint, 끝에서 롤백. 0036 이 아직 없으면 이 트랜잭션 안에서 적용하고 롤백한다
// (배포본은 바뀌지 않는다 — agg-db.test.ts 와 같은 모양). 멱등 키 접두 = 실행 태그. METRIC_DB_TEST=1 일 때만.
// 롤백 밖은 U1′ 하나(METRIC_U1=1, 0036 적용 뒤에만 — K16): 커밋해야 analyze·실측이 된다. 실행 태그 항목과 이번 실행의 감사 id 만 지운다(K29)
const ON = Deno.env.get("METRIC_DB_TEST") === "1";
const U1 = Deno.env.get("METRIC_U1") === "1";
const url = ON ? (await Deno.readTextFile(new URL("../.temp/pooler-url", import.meta.url))).trim() : "";
const opts = { password: Deno.env.get("SUPABASE_DB_PASSWORD"), max: 1, prepare: false, onnotice: () => {} } as const;
const APPLIED_0035 = "select to_regprocedure('public.aggregate_items(uuid,text[],text,text[],date,date,text,text)') is not null as a";
const APPLIED_0036 = "select to_regclass('public.item_metrics') is not null as a";
type Rows = Record<string, unknown>[];

// 테스트 이름에 "U1" 을 넣지 않는다 — D1 의 --filter U1 은 이름 부분 일치(PF-F19)
Deno.test({ name: "hosted: 0035 + 0036 cases in one rolled-back transaction (test users 22·21)", ignore: !ON, sanitizeResources: false, sanitizeOps: false, fn: async () => {
  const sql = postgres(url, opts);
  const user = await testUserId(22), other = await testUserId(21);
  try {
    await sql.begin(async (tx) => {
      await tx.unsafe("set local lock_timeout = '3s'");
      const q = async (s: string, p: unknown[] = []) => await tx.unsafe(s, p as never[]) as unknown as Rows;
      if ((await q(APPLIED_0035))[0].a !== true) throw new Error("0035 not applied — 0036 builds on it");
      const applied = (await q(APPLIED_0036))[0].a === true;
      if (!applied) await tx.unsafe(await Deno.readTextFile(MIGRATION_0036));
      console.log("0036", applied ? "already applied" : "applied in the rolled-back transaction");
      // 사례는 두 사용자의 규칙이 0개라고 본다 — 남은 규칙을 테스트가 지우지 않는다(AGENTS.md §7). 있으면 멈추고 알린다
      const left = await q("select count(*)::int as n from save_rules where user_id in ($1::uuid, $2::uuid)", [user, other]);
      if (left[0].n !== 0) throw new Error(`test users 22·21 already have ${left[0].n} save_rules — remove them first (the test does not delete them)`);
      for (const [label, cases] of [["0035 on 0036", AGG_CASES], ["0036", METRIC_CASES]] as const) {
        for (const c of cases) {
          if (c.localOnly) continue;
          await tx.unsafe("savepoint each_case");
          try { await c.run({ q: q as never, user, other, tag: RUN }); console.log("ok", label, c.name); }
          finally { await tx.unsafe("rollback to savepoint each_case"); }
        }
      }
      throw new Error("rollback");                                          // 전부 되돌린다
    }).catch((e) => { if (!(e instanceof Error && e.message === "rollback")) throw e; });
  } finally { await sql.end(); }
} });

// U1′(K16·K29): 테스트 사용자 23 에 실행 태그 kept 항목 3,000(받은 시각 오늘 서울 0시부터 98일 전까지 고르게, 청크 1개)·그중 1,500 에 metric 을 커밋하고
// analyze 뒤 90일 hour 집계 5회 → p95 < 2초. 분석 전 첫 1회는 pre_analyze_ms 로 출력만. 출력은 시간(ms)만(합성 글·id 를 찍지 않는다)
Deno.test({ name: "hosted: U1′ 0036 aggregate p95 over 3,000 items and 1,500 metrics (90-day hour)", ignore: !(ON && U1), sanitizeResources: false, sanitizeOps: false, fn: async () => {
  const sql = postgres(url, opts);
  const user = await testUserId(23);
  const audits: number[] = [];
  const key = `${RUN}:u1-`;
  try {
    if ((await sql.unsafe(APPLIED_0036))[0].a !== true) throw new Error("0036 not applied — U1′ runs after D1 applies it");
    const today = (await sql.unsafe("select (now() at time zone 'Asia/Seoul')::date::text as d"))[0].d as string;
    await sql.begin(async (tx) => {
      // 오늘 서울 0시에서 n × (98일 / 3000) 전 — n = 0 … 2999
      await tx.unsafe(`insert into items (user_id, source, content_enc, occurred_at, idempotency_key, status)
        select $1::uuid, 'MESSAGES', convert_to('합성 U1 글', 'UTF8'),
               ($2::date::timestamp at time zone 'Asia/Seoul') - make_interval(secs => n * 98 * 86400.0 / 3000), $3 || n, 'kept'
        from generate_series(0, 2999) n`, [user, today, key]);
      await tx.unsafe(`insert into item_chunks (item_id, user_id, chunk_index, text)
        select i.id, i.user_id, 0, '[합성U1] 결제 타임아웃 ' || split_part(i.idempotency_key, ':u1-', 2)
        from items i where i.user_id = $1::uuid and i.idempotency_key like $2`, [user, key + "%"]);
      await tx.unsafe(`insert into item_metrics (user_id, item_id, ordinal, label, count, at, at_body)
        select i.user_id, i.id, 0, '타임아웃', 1 + (split_part(i.idempotency_key, ':u1-', 2)::int % 9), i.occurred_at - interval '10 minutes', false
        from items i where i.user_id = $1::uuid and i.idempotency_key like $2 and split_part(i.idempotency_key, ':u1-', 2)::int % 2 = 0`, [user, key + "%"]);
    });
    const counts = (await sql.unsafe(`select count(*)::int as items, (select count(*)::int from item_metrics m join items i on i.id = m.item_id
      where i.user_id = $1::uuid and i.idempotency_key like $2) as metrics from items where user_id = $1::uuid and idempotency_key like $2`, [user, key + "%"]))[0];
    assertEquals([counts.items, counts.metrics], [3000, 1500]);
    const call = async () => {
      const before = (await sql.unsafe("select coalesce(max(id), 0)::bigint as m from audit_log"))[0].m as string;
      const t0 = performance.now();
      await sql.unsafe(`select aggregate_items($1::uuid, array['합성U1', '타임아웃'], null, '{}', $2::date - 89, $2::date, 'hour') as r`, [user, today]);
      const ms = Math.round(performance.now() - t0);
      const rows = await sql.unsafe("select id from audit_log where user_id = $1::uuid and id > $2::bigint", [user, before]);
      for (const r of rows) audits.push(Number(r.id));                     // 단언이 실패해도 지우게 먼저 모은다
      assertEquals(rows.length, 1, "one audit row per call");
      return ms;
    };
    const pre = await call();
    await sql.unsafe("analyze items, item_chunks, item_metrics");
    const runs: number[] = [];
    for (let n = 0; n < 5; n++) runs.push(await call());
    const p95 = [...runs].sort((a, b) => a - b)[Math.ceil(0.95 * runs.length) - 1];
    console.log(JSON.stringify({ pre_analyze_ms: pre, u1prime_ms: runs, p95, audit_ids: audits.length }));
    assert(p95 < 2000, `p95 ${p95}ms`);
  } finally {
    try {
      await sql.unsafe("delete from items where user_id = $1::uuid and idempotency_key like $2", [user, key + "%"]);   // cascade: 청크·metrics
      if (audits.length) await sql.unsafe("delete from audit_log where id = any(array(select jsonb_array_elements_text($1::text::jsonb)::bigint))", [JSON.stringify(audits)]);
      const left = (await sql.unsafe(`select (select count(*)::int from items where user_id = $1::uuid and idempotency_key like $2) as items,
        (select count(*)::int from audit_log where id = any(array(select jsonb_array_elements_text($3::text::jsonb)::bigint))) as audits`, [user, key + "%", JSON.stringify(audits)]))[0];
      console.log(JSON.stringify({ cleanup_left_items: left.items, cleanup_left_audits: left.audits }));   // K29: 둘 다 0
    } finally { await sql.end(); }
  }
} });
