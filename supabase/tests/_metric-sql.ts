import { assert, assertEquals } from "jsr:@std/assert";
import { type ACtx, agg, asUser, attempt, chunk, kw, legacy, listIds, one, pick, type Row, seed, sorted } from "./_agg-sql.ts";

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

// ②(N2) 사례 시드: 받은 시각 at(서울 표기) 의 kept 항목 + 청크 "<kw(c)> <text>". metric 은 saveMetrics, m() 의 at 은 UTC ISO
const msg = async (c: ACtx, k: string, o: { at: string; text: string; user?: string }) => {
  const id = await seed(c, k, { status: "kept", at: o.at, user: o.user });
  await chunk(c, id, o.user ?? c.user, `${kw(c)} ${o.text}`);
  return id;
};
const T = (c: ACtx) => [kw(c), "타임아웃"];
const NEW = (r: Record<string, unknown>) => pick(r, "total", "body_total", "metric_items", "metric_unmatched");
const sha256Hex = async (s: string) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))).map((b) => b.toString(16).padStart(2, "0")).join("");

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
  { name: "worker_save_metrics: other user's item → not_found; 11 rows / count -1 / count 100001 / count 1.5 / label '' / label 31 chars / at null → bad_metrics; count 0 kept (final-I2)", run: async (c) => {
    const mine = await seed(c, "a"), theirs = await seed(c, "b", { user: c.other });
    for (const [item, user] of [[theirs, c.user], [crypto.randomUUID(), c.user], [mine, c.other]]) {
      const err = await attempt(c, () => saveMetrics(c, item, [m("타임아웃", 1)], user));
      assert(err.includes("not_found"), `${item}/${user}: ${err || "no error"}`);
    }
    assertEquals((await metricRows(c, theirs)).length, 0);
    assertEquals(await saveMetrics(c, mine, [m("이전", 4)]), 1);
    for (const bad of [Array.from({ length: 11 }, () => m("타임아웃", 1)), [m("타임아웃", -1)], [m("타임아웃", 100001)], [{ ...m("타임아웃", 1), count: 1.5 }],
      [m("", 1)], [m("가".repeat(31), 1)], [{ ...m("타임아웃", 1), at: null }],
      [{ ...m("타임아웃", 1), count: "6" }], [{ ...m("타임아웃", 1), label: 6 }], [{ ...m("타임아웃", 1), at_body: null }], ["타임아웃"], {}, null]) {
      const err = await attempt(c, () => saveMetrics(c, mine, bad));
      assert(err.includes("bad_metrics"), `${JSON.stringify(bad).slice(0, 80)}: ${err || "no error"}`);
    }
    assertEquals((await metricRows(c, mine)).map((r) => [r.label, r.count]), [["이전", 4]]);   // 거절은 이전 행을 지우지 않는다
    assertEquals(await saveMetrics(c, mine, [m("가".repeat(30), 100000), m("가", 1)]), 2);   // 경계 통과
    assertEquals(await saveMetrics(c, mine, [m("오류", 0)]), 1);                               // 0 = 본문 "0건"(final-I2)
    assertEquals((await metricRows(c, mine)).map((r) => [r.label, r.count]), [["오류", 0]]);
    const direct = await attempt(c, () => c.q("insert into item_metrics (user_id, item_id, ordinal, label, count, at, at_body) values ($1::uuid, $2::uuid, 1, '오류', -1, now(), true)", [c.user, mine]));
    assert(direct.includes("check"), `CHECK count -1: ${direct || "no error"}`);              // 표 CHECK 0..100000
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
  // ── ②(N2) 본문 기준 값(사용자 결정 A)·발생 시각 기간·새 반환 칸(K26 — total·칸 count·목록 total 은 메시지 수 그대로) ──
  { name: "value: matched label sum; no metrics → 1; no matching label → 1 (counter-examples)", run: async (c) => {
    const a = await msg(c, "a", { at: "2026-10-15T14:12:00+09:00", text: "[ABC결제] 타임아웃 6건, 오류 2건" });
    await saveMetrics(c, a, [m("타임아웃", 6, "2026-10-15T05:00:00Z"), m("오류", 2, "2026-10-15T05:00:00Z")]);
    const e = await msg(c, "e", { at: "2026-10-15T11:40:00+09:00", text: "[ABC결제] 타임아웃 발생, 재시도 20건" });
    await saveMetrics(c, e, [m("재시도", 20, "2026-10-15T02:40:00Z", false)]);
    const z = await msg(c, "z", { at: "2026-10-15T09:10:00+09:00", text: "[ABC결제] 타임아웃 0건, 오류 20건" });
    await saveMetrics(c, z, [m("오류", 20, "2026-10-15T00:10:00Z", false)]);
    await msg(c, "d", { at: "2026-10-15T16:20:00+09:00", text: "[ABC결제] 결제 타임아웃 발생" });     // metrics 없음
    const day = { from: "2026-10-15", to: "2026-10-15", bucket: "hour" };
    const t = await agg(c, { keywords: [kw(c), "타임아웃"], ...day });
    assertEquals(NEW(t), { total: 4, body_total: 9, metric_items: 1, metric_unmatched: 2 });
    assertEquals(t.buckets, [{ key: "09", count: 1, body: 1 }, { key: "11", count: 1, body: 1 }, { key: "14", count: 1, body: 6 }, { key: "16", count: 1, body: 1 }]);
    assertEquals((await agg(c, { keywords: [kw(c), "재시도"], ...day })).buckets!.find((b) => b.key === "11"), { key: "11", count: 1, body: 20 });
    assertEquals(NEW(await agg(c, { keywords: [kw(c)], ...day })), { total: 4, body_total: 4, metric_items: 0, metric_unmatched: 3 });   // 서비스명만 → 메시지 수
    // 판정 ⑨: 세 낱말 AND 로 a·z 만 선택(e·d 본문에 '오류' 없음) — a = 타임아웃 6 + 오류 2(한 행 한 번), z = 오류 20
    assertEquals(pick(await agg(c, { keywords: [kw(c), "타임아웃", "오류"], ...day }), "total", "body_total"), { total: 2, body_total: 28 });
  } },
  { name: "count 0 (final-I2): '타임아웃 0건, 오류 20건' + {타임아웃, 0}·{오류, 20} → ['타임아웃'] value 0 (not 1), bucket count 1 body 0, list line count 0; tail ③ stays off (metric_items 1)", run: async (c) => {
    const z = await msg(c, "z", { at: "2026-10-15T09:10:00+09:00", text: "[ABC결제] 타임아웃 0건, 오류 20건" });
    await saveMetrics(c, z, [m("타임아웃", 0, "2026-10-15T00:10:00Z", false), m("오류", 20, "2026-10-15T00:10:00Z", false)]);
    const a = await msg(c, "a", { at: "2026-10-15T14:12:00+09:00", text: "[ABC결제] 타임아웃 6건, 오류 0건" });
    await saveMetrics(c, a, [m("타임아웃", 6, "2026-10-15T05:00:00Z"), m("오류", 0, "2026-10-15T05:00:00Z")]);
    const day = { from: "2026-10-15", to: "2026-10-15", bucket: "hour" };
    const t = await agg(c, { keywords: T(c), ...day });
    assertEquals(NEW(t), { total: 2, body_total: 6, metric_items: 2, metric_unmatched: 0 });
    assertEquals(t.buckets, [{ key: "09", count: 1, body: 0 }, { key: "14", count: 1, body: 6 }]);
    const e = await agg(c, { keywords: [kw(c), "오류"], ...day });
    assertEquals(NEW(e), { total: 2, body_total: 20, metric_items: 2, metric_unmatched: 0 });
    assertEquals(e.buckets, [{ key: "09", count: 1, body: 20 }, { key: "14", count: 1, body: 0 }]);
    const l = await agg(c, { keywords: [kw(c), "오류"], ...day, key: "14" });
    assertEquals([l.total, l.value, l.items!.map((x) => [x.item_id, x.count])], [1, 0, [[a, 0]]]);
    // 맞은 행이 0건뿐인 메시지만 고르면 body_total 0 — legacy(구 chat) 칸은 메시지 수 그대로
    const only = await agg(c, { keywords: [kw(c), "오류", "타임아웃"], from: "2026-10-15", to: "2026-10-15", bucket: "day" });
    assertEquals(NEW(only), { total: 2, body_total: 26, metric_items: 2, metric_unmatched: 0 });
    const zero = await agg(c, { keywords: [kw(c), "오류", "6건"], ...day });                       // '6건'은 a 본문에만 — a 의 맞은 행 = {오류, 0}
    assertEquals([NEW(zero), legacy(zero)], [{ total: 1, body_total: 0, metric_items: 1, metric_unmatched: 0 }, { total: 1, buckets: [{ key: "14", count: 1 }] }]);
  } },
  { name: "label match ignores spaces and case (타임 아웃 ↔ 타임아웃, timeout ↔ TIMEOUT)", run: async (c) => {
    const at = "2026-10-15T12:00:00+09:00", day = { from: "2026-10-15", to: "2026-10-15", bucket: "day" };
    const p = await msg(c, "p", { at, text: "[x] 타임아웃 TIMEOUT 6건" });
    await saveMetrics(c, p, [m("타임아웃", 6, "2026-10-15T03:00:00Z")]);
    const q = await msg(c, "q", { at, text: "[x] TIMEOUT 3" });
    await saveMetrics(c, q, [m("TIMEOUT", 3, "2026-10-15T03:00:00Z")]);
    // 본문 판정도 공백 무시라 p 만 선택, label 타임아웃 일치
    assertEquals(NEW(await agg(c, { keywords: [kw(c), "타임 아웃"], ...day })), { total: 1, body_total: 6, metric_items: 1, metric_unmatched: 0 });
    // K27 — p 는 본문의 TIMEOUT 으로 선택되지만 label '타임아웃'이 'timeout'에 맞지 않아 1(사용자 결정 A), q 는 label TIMEOUT 3
    for (const w of ["timeout", "Time Out"]) {
      assertEquals(NEW(await agg(c, { keywords: [kw(c), w], ...day })), { total: 2, body_total: 4, metric_items: 1, metric_unmatched: 1 }, w);
    }
  } },
  { name: "two metrics of one item split across hours 14 and 15", run: async (c) => {
    const a = await msg(c, "a", { at: "2026-10-15T15:20:00+09:00", text: "[x] 14:05 타임아웃 4건, 15:10 타임아웃 3건" });
    await saveMetrics(c, a, [m("타임아웃", 4, "2026-10-15T05:05:00Z"), m("타임아웃", 3, "2026-10-15T06:10:00Z")]);
    const r = await agg(c, { keywords: T(c), from: "2026-10-15", to: "2026-10-15", bucket: "hour" });
    assertEquals(NEW(r), { total: 1, body_total: 7, metric_items: 1, metric_unmatched: 0 });
    assertEquals(r.buckets, [{ key: "14", count: 1, body: 4 }, { key: "15", count: 1, body: 3 }]);   // 칸 count 합 2 > total 1(한 메시지가 두 칸, K26)
  } },
  { name: "two matched rows in one bucket → one list line with count 8, value 8, total 1", run: async (c) => {
    const a = await msg(c, "a", { at: "2026-10-15T14:40:00+09:00", text: "[x] 14:00 타임아웃 6건 … 14:30 타임아웃 2건" });
    await saveMetrics(c, a, [m("타임아웃", 6, "2026-10-15T05:00:00Z"), m("타임아웃", 2, "2026-10-15T05:30:00Z")]);
    const p = { keywords: T(c), from: "2026-10-15", to: "2026-10-15", bucket: "hour" };
    assertEquals((await agg(c, p)).buckets, [{ key: "14", count: 1, body: 8 }]);
    const l = await agg(c, { ...p, key: "14" });
    assertEquals(pick(l, "total", "value"), { total: 1, value: 8 });
    assertEquals(l.items!.map((x) => [x.item_id, x.count]), [[a, 8]]);
  } },
  { name: "list mode: value = bucket sum, line count from metrics only (null for value 1), newest first", run: async (c) => {
    const a = await msg(c, "a", { at: "2026-10-15T14:12:00+09:00", text: "[x] 타임아웃 6건" });
    await saveMetrics(c, a, [m("타임아웃", 6, "2026-10-15T05:00:00Z")]);
    const b = await msg(c, "b", { at: "2026-10-15T14:40:00+09:00", text: "[x] 결제 타임아웃" });
    const l = await agg(c, { keywords: T(c), from: "2026-10-15", to: "2026-10-15", bucket: "hour", key: "14" });
    assertEquals([l.total, l.value, l.buckets], [2, 7, undefined]);
    assertEquals(l.items!.map((x) => [x.item_id, x.count]), [[b, null], [a, 6]]);
    assertEquals([l.items![1].source, Date.parse(l.items![1].occurred_at)], ["MESSAGES", Date.parse("2026-10-15T14:12:00+09:00")]);   // 줄 시각 = 받은 시각(0035 칸)
  } },
  { name: "other user's metrics are never counted", run: async (c) => {
    const p = { keywords: T(c), from: "2026-10-15", to: "2026-10-15", bucket: "hour" };
    const a = await msg(c, "a", { at: "2026-10-15T14:12:00+09:00", text: "[x] 타임아웃 6건" });
    await saveMetrics(c, a, [m("타임아웃", 6, "2026-10-15T05:00:00Z")]);
    const before = await agg(c, p);
    assertEquals(NEW(before), { total: 1, body_total: 6, metric_items: 1, metric_unmatched: 0 });
    const o = await msg(c, "o", { at: "2026-10-15T14:20:00+09:00", text: "[x] 타임아웃 50건", user: c.other });
    await saveMetrics(c, o, [m("타임아웃", 50, "2026-10-15T05:10:00Z")], c.other);
    assertEquals(await agg(c, p), before);
    assertEquals(NEW(await agg(c, p, c.other)), { total: 1, body_total: 50, metric_items: 1, metric_unmatched: 0 });
  } },
  { name: "audit read: one row, sha256 of the sorted ids of messages with an in-period unit", run: async (c) => {
    const a = await msg(c, "a", { at: "2026-10-15T14:12:00+09:00", text: "[x] 타임아웃 6건" });
    await saveMetrics(c, a, [m("타임아웃", 6, "2026-10-15T05:00:00Z")]);
    const b = await msg(c, "b", { at: "2026-10-15T00:30:00+09:00", text: "[x] 10/14 23:50 타임아웃 3건" });   // 맞은 행 at 이 기간 밖만
    await saveMetrics(c, b, [m("타임아웃", 3, "2026-10-14T14:50:00Z")]);
    const reads = () => c.q("select actor, target from audit_log where user_id = $1::uuid and action = 'read' and at = now() order by id", [c.user]);
    const p = { keywords: T(c), from: "2026-10-15", to: "2026-10-15", bucket: "day" };
    assertEquals(NEW(await agg(c, p)), { total: 1, body_total: 6, metric_items: 1, metric_unmatched: 0 });
    assertEquals((await reads()).map((r) => [r.actor, r.target]), [["chat", await sha256Hex(a)]]);
    await agg(c, { ...p, from: "2026-10-14", bucket: "day", key: "2026-10-14" });                 // 목록 모드 = 그 칸 메시지(b)
    assertEquals((await reads()).map((r) => r.target), [await sha256Hex(a), await sha256Hex(b)]);
    await agg(c, { ...p, from: "2026-10-14" });                                                     // 두 날 = 둘, 정렬
    assertEquals((await reads())[2].target, await sha256Hex(sorted([a, b]).join(",")));
  } },
  // 발생 시각 기간(Codex #2) — 키워드 [kw, "타임아웃"]
  { name: "occurrence day: received 10/22 00:05, at 10/21 23:50 → 10/22 day 0; 10/21 day 6 in hour '23'; 10/21~10/22 hour '23' 6 and day '2026-10-21' 6", run: async (c) => {
    const K = T(c);
    const a = await msg(c, "a", { at: "2026-10-22T00:05:00+09:00", text: "[x] 10/21 23:50 타임아웃 6건" });
    await saveMetrics(c, a, [m("타임아웃", 6, "2026-10-21T14:50:00Z")]);
    assertEquals((await agg(c, { keywords: K, from: "2026-10-22", to: "2026-10-22", bucket: "day" })).total, 0);
    assertEquals((await agg(c, { keywords: K, from: "2026-10-21", to: "2026-10-21", bucket: "hour" })).buckets, [{ key: "23", count: 1, body: 6 }]);
    assertEquals((await agg(c, { keywords: K, from: "2026-10-21", to: "2026-10-22", bucket: "hour" })).buckets, [{ key: "23", count: 1, body: 6 }]);
    assertEquals((await agg(c, { keywords: K, from: "2026-10-21", to: "2026-10-22", bucket: "day" })).buckets, [{ key: "2026-10-21", count: 1, body: 6 }]);
  } },
  { name: "list follows occurrence day: 10/21 list has the item with count 6; 10/22 list does not", run: async (c) => {
    const a = await msg(c, "a", { at: "2026-10-22T00:05:00+09:00", text: "[x] 10/21 23:50 타임아웃 6건" });
    await saveMetrics(c, a, [m("타임아웃", 6, "2026-10-21T14:50:00Z")]);
    const p = { keywords: T(c), from: "2026-10-21", to: "2026-10-22", bucket: "day" };
    const l21 = await agg(c, { ...p, key: "2026-10-21" });
    assertEquals([l21.total, l21.value, l21.items!.map((x) => [x.item_id, x.count])], [1, 6, [[a, 6]]]);
    assertEquals(await agg(c, { ...p, key: "2026-10-22" }), { total: 0, value: 0, items: [] });
  } },
  { name: "candidate window +7 days: received 10/28 14:00, at 10/21 14:00 → in 10/21 day total 1", run: async (c) => {
    const a = await msg(c, "a", { at: "2026-10-28T14:00:00+09:00", text: "[x] 10/21 14:00 타임아웃 6건" });
    await saveMetrics(c, a, [m("타임아웃", 6, "2026-10-21T05:00:00Z")]);
    const late = await msg(c, "late", { at: "2026-10-29T00:00:00+09:00", text: "[x] 10/21 23:59 타임아웃 2건" });   // 창 끝(to + 8일 0시) = 밖
    await saveMetrics(c, late, [m("타임아웃", 2, "2026-10-21T14:59:00Z")]);
    const r = await agg(c, { keywords: T(c), from: "2026-10-21", to: "2026-10-21", bucket: "day" });
    assertEquals([NEW(r), r.buckets], [{ total: 1, body_total: 6, metric_items: 1, metric_unmatched: 0 }, [{ key: "2026-10-21", count: 1, body: 6 }]]);
  } },
  { name: "candidate window −1 day: received 10/20 23:30, at 10/21 00:10 → in 10/21 day total 1", run: async (c) => {
    const a = await msg(c, "a", { at: "2026-10-20T23:30:00+09:00", text: "[x] 00:10 타임아웃 6건" });
    await saveMetrics(c, a, [m("타임아웃", 6, "2026-10-20T15:10:00Z")]);
    const early = await msg(c, "early", { at: "2026-10-19T23:59:00+09:00", text: "[x] 타임아웃 2건" });   // 창 시작(from − 1일 0시) 전 = 밖
    await saveMetrics(c, early, [m("타임아웃", 2, "2026-10-20T15:20:00Z")]);
    const r = await agg(c, { keywords: T(c), from: "2026-10-21", to: "2026-10-21", bucket: "day" });
    assertEquals([NEW(r), r.buckets], [{ total: 1, body_total: 6, metric_items: 1, metric_unmatched: 0 }, [{ key: "2026-10-21", count: 1, body: 6 }]]);
    assertEquals((await agg(c, { keywords: T(c), from: "2026-10-20", to: "2026-10-20", bucket: "day" })).total, 0);   // 받은 날 10/20 에는 없다
  } },
  { name: "one item, two matched rows, only one in period → that row only, total 1", run: async (c) => {
    const a = await msg(c, "a", { at: "2026-10-22T01:05:00+09:00", text: "[x] 23:00 타임아웃 6건, 01:00 타임아웃 3건" });
    await saveMetrics(c, a, [m("타임아웃", 6, "2026-10-21T14:00:00Z"), m("타임아웃", 3, "2026-10-21T16:00:00Z")]);
    const p = { keywords: T(c), bucket: "day" };
    assertEquals(NEW(await agg(c, { ...p, from: "2026-10-22", to: "2026-10-22" })), { total: 1, body_total: 3, metric_items: 1, metric_unmatched: 0 });
    assertEquals(NEW(await agg(c, { ...p, from: "2026-10-21", to: "2026-10-21" })), { total: 1, body_total: 6, metric_items: 1, metric_unmatched: 0 });
  } },
  { name: "no-metrics items use received time for the period (0.17.0 behaviour)", run: async (c) => {
    await msg(c, "a", { at: "2026-10-20T23:59:00+09:00", text: "[x] 결제 타임아웃" });
    const p = { keywords: T(c), bucket: "day" };
    assertEquals((await agg(c, { ...p, from: "2026-10-21", to: "2026-10-21" })).total, 0);
    const r = await agg(c, { ...p, from: "2026-10-20", to: "2026-10-20" });
    assertEquals([NEW(r), r.buckets], [{ total: 1, body_total: 1, metric_items: 0, metric_unmatched: 0 }, [{ key: "2026-10-20", count: 1, body: 1 }]]);
  } },
  // 배포 조합(Codex #6)
  { name: "deploy combo: with no item_metrics rows, buckets sum = total = body_total, metric_items = metric_unmatched = 0", run: async (c) => {
    const ids = [await msg(c, "a", { at: "2026-10-15T09:10:00+09:00", text: "[x] 결제 타임아웃" }),
      await msg(c, "b", { at: "2026-10-15T14:10:00+09:00", text: "[x] 결제 타임아웃" }),
      await msg(c, "d", { at: "2026-10-15T14:50:00+09:00", text: "[x] 결제 타임아웃" })];
    const p = { keywords: T(c), from: "2026-10-15", to: "2026-10-15", bucket: "hour" };
    const r = await agg(c, p);
    assertEquals(NEW(r), { total: 3, body_total: 3, metric_items: 0, metric_unmatched: 0 });
    assertEquals(r.buckets, [{ key: "09", count: 1, body: 1 }, { key: "14", count: 2, body: 2 }]);
    assertEquals(legacy(r), { total: 3, buckets: [{ key: "09", count: 1 }, { key: "14", count: 2 }] });   // 같은 시드의 0035 반환
    const l = await agg(c, { ...p, key: "14" });
    assertEquals([l.total, l.value, l.items!.map((x) => [x.item_id, x.count])], [2, 2, [[ids[2], null], [ids[1], null]]]);
  } },
  // 롤백 조합(Codex 계획 리뷰 P-H2, K26) — 구 chat 은 total·buckets[].count·목록 total 만 읽는다
  { name: "rollback combo (old chat reads total/buckets[].count): with metrics vs same seed without metrics → legacy() equal, only body/body_total/value/line count differ", run: async (c) => {
    const a = await msg(c, "a", { at: "2026-10-15T14:12:00+09:00", text: "[x] 14:00~14:10 타임아웃 6건, 오류 2건" });
    const b = await msg(c, "b", { at: "2026-10-15T15:05:00+09:00", text: "[x] 타임아웃 3건" });
    await msg(c, "d", { at: "2026-10-15T16:20:00+09:00", text: "[x] 결제 타임아웃" });                   // metrics 없음
    const p = { keywords: T(c), from: "2026-10-15", to: "2026-10-15", bucket: "hour" };
    const r0 = await agg(c, p), l0 = await agg(c, { ...p, key: "14" });
    assertEquals([NEW(r0), r0.buckets!.map((x) => x.body)], [{ total: 3, body_total: 3, metric_items: 0, metric_unmatched: 0 }, [1, 1, 1]]);
    assertEquals([l0.value, l0.items!.map((x) => x.count)], [1, [null]]);
    await saveMetrics(c, a, [m("타임아웃", 6, "2026-10-15T05:00:00Z"), m("오류", 2, "2026-10-15T05:00:00Z")]);
    await saveMetrics(c, b, [m("타임아웃", 3, "2026-10-15T06:05:00Z", false)]);
    const r1 = await agg(c, p), l1 = await agg(c, { ...p, key: "14" });
    assertEquals(legacy(r1), legacy(r0));
    assertEquals(legacy(r0), { total: 3, buckets: [{ key: "14", count: 1 }, { key: "15", count: 1 }, { key: "16", count: 1 }] });
    assertEquals(legacy(l1), legacy(l0));
    assertEquals([l0.total, l0.items!.map((x) => x.item_id)], [1, [a]]);
    // 이 값을 N7 구 chat 테스트가 그대로 쓴다
    assertEquals(NEW(r1), { total: 3, body_total: 10, metric_items: 2, metric_unmatched: 0 });
    assertEquals(r1.buckets, [{ key: "14", count: 1, body: 6 }, { key: "15", count: 1, body: 3 }, { key: "16", count: 1, body: 1 }]);
    assertEquals([l1.total, l1.value, l1.items!.map((x) => [x.item_id, x.count])], [1, 6, [[a, 6]]]);
  } },
];
