import { assert, assertEquals } from "jsr:@std/assert";
import { type ACtx, agg, asUser, attempt, chunk, kw, listIds, one, type Row, seed, sorted } from "./_agg-sql.ts";

// 0036 SQL 사례(0.18.0 본문 건수 — 스펙 §8 item_metrics·0036, §9 RPC, §15 METRIC-db): PGlite(로컬, metric-sql.test.ts)와 호스팅 롤백 트랜잭션(metric-db.test.ts)이 같은 사례를 돈다.
// 사례마다 실행자가 롤백한다. 값은 합성 글·키만(멱등 키 = `<tag>:<source>-<k>`, 낱말 = kw(c) 사례 고유)
export const MIGRATION_0036 = new URL("../migrations-pending/0036_item_metrics.sql", import.meta.url);

// 배열은 JSON 글로 넘겨 SQL 에서 jsonb 로(PGlite·postgres.js 직렬화 차이를 피한다). 반환 = 넣은 행 수
export const saveMetrics = async (c: ACtx, item: string, metrics: unknown, user = c.user) =>
  (await one(c, "select worker_save_metrics($1::uuid, $2::uuid, $3::text::jsonb) as n", [user, item, JSON.stringify(metrics)])).n as number;
export const metricRows = (c: ACtx, item: string): Promise<Row[]> =>
  c.q("select user_id, ordinal, label, count, at, at_body from item_metrics where item_id = $1::uuid order by ordinal", [item]);
// metric 하나(워커가 넘기는 모양 — at 은 UTC ISO, K3)
export const m = (label: string, count: number, at = "2026-10-15T05:00:00.000Z", at_body = true) => ({ label, count, at, at_body });

// anon 역할로(키 없는 요청). 실패하면 트랜잭션이 오류 상태라 되돌리기도 실패한다 — attempt 의 savepoint 롤백이 역할을 되돌린다
const asAnon = async <T>(c: ACtx, fn: () => Promise<T>): Promise<T> => {
  await c.q("set local role anon");
  try { return await fn(); } finally { try { await c.q("reset role"); } catch { /* 실패한 트랜잭션 */ } }
};
type Runner = (fn: () => Promise<unknown>) => Promise<unknown>;
const roles = (c: ACtx): [string, Runner][] => [["authenticated", (fn) => asUser(c, c.user, fn)], ["anon", (fn) => asAnon(c, fn)]];
const DENIED_TABLE = "permission denied for table item_metrics";     // revoke 가 RLS 보다 먼저 막는다(둘 다 42501 이라 문구로 가른다, PF-F3)
const day = { from: "2026-10-15", to: "2026-10-15" }, AT = "2026-10-15T12:00:00+09:00";
const withChunk = async (c: ACtx, k: string, text: string) => {
  const id = await seed(c, k, { status: "extracted", at: AT });
  await chunk(c, id, c.user, text);
  return id;
};

export const METRIC_CASES: { name: string; hostedOnly?: boolean; localOnly?: boolean; run(c: ACtx): Promise<void> }[] = [
  { name: "item_metrics: authenticated and anon cannot select or insert (42501); service role can", run: async (c) => {
    const i = await seed(c, "a", { status: "kept" });
    const ins = () => c.q("insert into item_metrics (user_id, item_id, ordinal, label, count, at, at_body) values ($1::uuid, $2::uuid, 0, '타임아웃', 6, now(), true)", [c.user, i]);
    const sel = () => c.q("select id from item_metrics");
    for (const [who, run] of roles(c)) {
      for (const [what, fn] of [["select", sel], ["insert", ins]] as [string, () => Promise<unknown>][]) {
        const err = await attempt(c, () => run(fn));
        assert(err.includes(DENIED_TABLE), `${who} ${what}: ${err || "no error"}`);
      }
    }
    const p = await one(c, `select has_table_privilege('anon', 'public.item_metrics', 'select') as anon, has_table_privilege('authenticated', 'public.item_metrics', 'select') as auth,
      has_table_privilege('service_role', 'public.item_metrics', 'insert') as svc, (select relrowsecurity from pg_class where oid = 'public.item_metrics'::regclass) as rls,
      (select count(*)::int from pg_policies where tablename = 'item_metrics') as policies`);
    assertEquals([p.anon, p.auth, p.svc, p.rls, p.policies], [false, false, true, true, 0]);
    await ins();                                                                      // service role(역할 되돌린 뒤) 은 넣는다
    assertEquals((await metricRows(c, i)).map((r) => [r.ordinal, r.label, r.count]), [[0, "타임아웃", 6]]);
  } },
  { name: "item delete cascades item_metrics", run: async (c) => {
    const i = await seed(c, "a", { status: "kept" }), keep = await seed(c, "b", { status: "kept" });
    assertEquals(await saveMetrics(c, i, [m("타임아웃", 6)]), 1);
    assertEquals(await saveMetrics(c, keep, [m("오류", 2)]), 1);
    await c.q("delete from items where id = $1::uuid", [i]);
    assertEquals((await metricRows(c, i)).length, 0);
    assertEquals((await metricRows(c, keep)).map((r) => [r.label, r.count]), [["오류", 2]]);   // 다른 항목 행은 남는다
  } },
  { name: "worker_save_metrics overwrites (second call leaves only its rows), ordinal from 0, returns row count", run: async (c) => {
    const i = await seed(c, "a", { status: "queued" });
    assertEquals(await saveMetrics(c, i, [m("타임아웃", 6), m("오류", 2, "2026-10-15T06:30:00.000Z", false)]), 2);
    const first = await metricRows(c, i);
    assertEquals(first.map((r) => [r.user_id, r.ordinal, r.label, r.count, new Date(r.at).getTime(), r.at_body]),
      [[c.user, 0, "타임아웃", 6, Date.parse("2026-10-15T05:00:00Z"), true], [c.user, 1, "오류", 2, Date.parse("2026-10-15T06:30:00Z"), false]]);
    assertEquals(await saveMetrics(c, i, [m("재시도", 3)]), 1);
    assertEquals((await metricRows(c, i)).map((r) => [r.ordinal, r.label, r.count]), [[0, "재시도", 3]]);
    assertEquals(await saveMetrics(c, i, []), 0);                                     // 빈 배열 = 지우기
    assertEquals((await metricRows(c, i)).length, 0);
  } },
  { name: "worker_save_metrics: other user's item → not_found; 11 rows / count 0 / count 100001 / count 1.5 / label '' / label 31 chars / at null → bad_metrics", run: async (c) => {
    const mine = await seed(c, "a"), theirs = await seed(c, "b", { user: c.other });
    for (const [item, user] of [[theirs, c.user], [crypto.randomUUID(), c.user], [mine, c.other]]) {
      const err = await attempt(c, () => saveMetrics(c, item, [m("타임아웃", 1)], user));
      assert(err.includes("not_found"), `${item}/${user}: ${err || "no error"}`);
    }
    assertEquals((await metricRows(c, theirs)).length, 0);
    assertEquals(await saveMetrics(c, mine, [m("이전", 4)]), 1);
    for (const bad of [Array.from({ length: 11 }, () => m("타임아웃", 1)), [m("타임아웃", 0)], [m("타임아웃", 100001)], [{ ...m("타임아웃", 1), count: 1.5 }],
      [m("", 1)], [m("가".repeat(31), 1)], [{ ...m("타임아웃", 1), at: null }],
      [{ ...m("타임아웃", 1), count: "6" }], [{ ...m("타임아웃", 1), label: 6 }], [{ ...m("타임아웃", 1), at_body: null }], ["타임아웃"], {}, null]) {
      const err = await attempt(c, () => saveMetrics(c, mine, bad));
      assert(err.includes("bad_metrics"), `${JSON.stringify(bad).slice(0, 80)}: ${err || "no error"}`);
    }
    assertEquals((await metricRows(c, mine)).map((r) => [r.label, r.count]), [["이전", 4]]);   // 거절은 이전 행을 지우지 않는다
    assertEquals(await saveMetrics(c, mine, [m("가".repeat(30), 100000), m("가", 1)]), 2);   // 경계 통과
    assertEquals(await saveMetrics(c, mine, Array.from({ length: 10 }, (_, n) => m(`합성${n}`, n + 1))), 10);   // 10행 = 상한
    assertEquals((await metricRows(c, mine)).map((r) => r.ordinal), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  } },
  { name: "anon/authenticated cannot execute worker_save_metrics or aggregate_items after 0036", run: async (c) => {
    const i = await seed(c, "a");
    for (const f of ["worker_save_metrics(uuid, uuid, jsonb)", "aggregate_items(uuid, text[], text, text[], date, date, text, text)"]) {
      const r = await one(c, `select has_function_privilege('anon', 'public.${f}', 'execute') as anon,
        has_function_privilege('authenticated', 'public.${f}', 'execute') as auth,
        has_function_privilege('service_role', 'public.${f}', 'execute') as svc`);
      assertEquals([r.anon, r.auth, r.svc], [false, false, true], f);
    }
    const save = () => saveMetrics(c, i, [m("타임아웃", 1)]);
    const aggr = () => agg(c, { keywords: [kw(c)], ...day, bucket: "day" });
    for (const [who, run] of roles(c)) {
      for (const [name, fn] of [["worker_save_metrics", save], ["aggregate_items", aggr]] as [string, () => Promise<unknown>][]) {
        const err = await attempt(c, () => run(fn));
        assert(err.includes(`permission denied for function ${name}`), `${who} ${name}: ${err || "no error"}`);
      }
    }
    assertEquals((await metricRows(c, i)).length, 0);
  } },
  // ── 공백 사례(H2) — 하루 2026-10-15, 받은 시각 12:00 KST, 청크 글에 kw(c) 접두 ──
  { name: "keyword spaces ignored: 'abc pay' / 'ABC PAY' / 'abcpay' each match chunk '[ABCPAY] 결제 타임아웃'; 'abcpay' matches 'ABC PAY 타임아웃'", run: async (c) => {
    const a = await withChunk(c, "a", `[${kw(c)}ABCPAY] 결제 타임아웃`);
    const b = await withChunk(c, "b", `${kw(c, "b")}ABC PAY 타임아웃`);              // 낱말이 달라 a 와 섞이지 않는다
    for (const w of [`${kw(c)}abc pay`, `${kw(c)}ABC PAY`, `${kw(c)}abcpay`]) {
      assertEquals((await agg(c, { keywords: [w], ...day, bucket: "day" })).total, 1, w);
      assertEquals(await listIds(c, { keywords: [w], ...day }), [a], w);
    }
    assertEquals((await agg(c, { keywords: [`${kw(c, "b")}abcpay`], ...day, bucket: "day" })).total, 1);
    assertEquals(await listIds(c, { keywords: [`${kw(c, "b")}abcpay`], ...day }), [b]);
  } },
  { name: "keyword spaces ignored with AND: ['<kw>abc pay', '타임 아웃'] ↔ '[<kw>ABCPAY] 결제 타임아웃' → 1", run: async (c) => {
    const a = await withChunk(c, "a", `[${kw(c)}ABCPAY] 결제 타임아웃`);
    await withChunk(c, "done", `[${kw(c)}ABCPAY] 결제 완료`);                       // 두 번째 낱말 없음
    const r = await agg(c, { keywords: [`${kw(c)}abc pay`, "타임 아웃"], ...day, bucket: "day" });
    assertEquals(r.total, 1);
    assertEquals(await listIds(c, { keywords: [`${kw(c)}abc pay`, "타임 아웃"], ...day }), [a]);
    assertEquals((await agg(c, { keywords: [`${kw(c)}abc pay`], ...day, bucket: "day" })).total, 2);
  } },
  { name: "case regression: lower keyword ↔ upper chunk and upper keyword ↔ lower chunk each 1", run: async (c) => {
    const up = await withChunk(c, "up", `${kw(c)}TIMEOUT`);
    const low = await withChunk(c, "low", `${kw(c, "u")}timeout`);
    assertEquals((await agg(c, { keywords: [`${kw(c)}timeout`], ...day, bucket: "day" })).total, 1);
    assertEquals(await listIds(c, { keywords: [`${kw(c)}timeout`], ...day }), [up]);
    assertEquals((await agg(c, { keywords: [`${kw(c, "u")}TIMEOUT`], ...day, bucket: "day" })).total, 1);
    assertEquals(await listIds(c, { keywords: [`${kw(c, "u")}TIMEOUT`], ...day }), [low]);
  } },
  { name: "literal % _ \\ after strpos: '<kw>50%' does not match '<kw>500'", run: async (c) => {
    const pct = await withChunk(c, "pct", `${kw(c)}50%할인`), n500 = await withChunk(c, "n500", `${kw(c)}500할인`);
    const ab = await withChunk(c, "ab", `${kw(c)}a_b`), axb = await withChunk(c, "axb", `${kw(c)}axb`);
    const bs = await withChunk(c, "bs", `${kw(c)}c\\d`), cd = await withChunk(c, "cd", `${kw(c)}cd`);
    assertEquals(await listIds(c, { keywords: [`${kw(c)}50%`], ...day }), [pct]);
    assertEquals(await listIds(c, { keywords: [`${kw(c)}a_b`], ...day }), [ab]);
    assertEquals(await listIds(c, { keywords: [`${kw(c)}c\\d`], ...day }), [bs]);
    assertEquals(await listIds(c, { keywords: [kw(c)], ...day }), sorted([pct, n500, ab, axb, bs, cd]));
  } },
  { name: "keyword that is only whitespace after removal → bad_args", run: async (c) => {
    for (const ws of [["  "], [kw(c), " \t\n"]]) {
      const err = await attempt(c, () => c.q("select aggregate_items($1::uuid, array(select jsonb_array_elements_text($2::text::jsonb)), null, '{}', '2026-10-15', '2026-10-15', 'day')",
        [c.user, JSON.stringify(ws)]));
      assert(err.includes("bad_args"), `${JSON.stringify(ws)}: ${err || "no error"}`);
    }
    assertEquals((await c.q("select id from audit_log where user_id = $1::uuid and action = 'read' and at = now()", [c.user])).length, 0);  // 거절은 감사 없음
  } },
  { name: "hybrid_search keyword score is case-insensitive (embedding null): lower query kw_score = upper query kw_score > 0", hostedOnly: true, run: async (c) => {
    const i = await withChunk(c, "hs", `${kw(c)}TIMEOUT 합성`);                       // embedding null — 키워드 점수만
    const score = async (query: string) => {
      const rows = await c.q("select item_id, kw_score from hybrid_search($1::uuid, $2, null::extensions.vector, 20)", [c.user, query]);
      const hit = rows.filter((r) => r.item_id === i);
      assertEquals(hit.length, 1, query);
      return Number(hit[0].kw_score);
    };
    const lower = await score(`${kw(c)}timeout`), upper = await score(`${kw(c)}TIMEOUT`);
    assert(lower > 0, String(lower));
    assertEquals(lower, upper);
  } },
];
