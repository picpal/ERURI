import { assert, assertEquals } from "jsr:@std/assert";

// 0035 SQL 사례(0.17.0 저장 규칙·집계 질문): PGlite(로컬, agg-sql.test.ts)와 호스팅 롤백 트랜잭션(agg-db.test.ts)이 같은 사례를 돈다.
// 사례마다 실행자가 롤백한다. 값은 합성 글·키만(멱등 키 = `<tag>:<source>-<k>`, tag = test:<run8> — 0011 restore_discarded 의 'test:%' 판정과 같다, K24)
// deno-lint-ignore no-explicit-any
export type Row = Record<string, any>;
export type Q = (sql: string, params?: unknown[]) => Promise<Row[]>;
export type ACtx = { q: Q; user: string; other: string; tag: string };
export const MIGRATION_0035 = new URL("../migrations-pending/0035_save_rules_aggregate.sql", import.meta.url);

const one = async (c: ACtx, sql: string, p: unknown[] = []) => (await c.q(sql, p))[0];
const add = async (c: ACtx, kind: string, value: string, user = c.user) =>
  (await one(c, "select save_rule_add($1::uuid, $2, $3) as r", [user, kind, value])).r as { status: string; rule_id: string | null };
const remove = async (c: ACtx, rule: string, user = c.user) =>
  (await one(c, "select save_rule_remove($1::uuid, $2::uuid) as r", [user, rule])).r as string;
const rulesOf = (c: ACtx, user = c.user) => c.q("select id, kind, value, created_at from save_rules_of($1::uuid)", [user]);

// 항목은 items 에 직접 넣는다(insert_item 은 잡을 만든다). content_enc = 합성 글 바이트(가짜 암호문 — 호스팅은 롤백돼 남지 않는다)
// at = 받은 시각(occurred_at), key = 멱등 키를 직접 줄 때(K24 ingest 형식 사례)
type Seed = { source?: string; app?: string | null; sender?: string | null; title?: string | null; body?: string | null; status?: string;
  gateLabel?: string | null; quarantine?: string | null; user?: string; at?: string; key?: string };
const seed = async (c: ACtx, k: string, o: Seed = {}) => {
  const source = o.source ?? "MESSAGES";
  return (await one(c, `insert into items (user_id, source, app_name, sender, title, content_enc, occurred_at, idempotency_key, status, gate_label, quarantine_until)
    values ($1::uuid, $2, $3, $4, $5, convert_to($6, 'UTF8'), $11::timestamptz, $7, $8, $9, $10::timestamptz) returning id`,
    [o.user ?? c.user, source, o.app ?? null, o.sender ?? null, o.title ?? null, o.body === undefined ? "합성 글" : o.body,
      o.key ?? `${c.tag}:${source}-${k}`, o.status ?? "queued", o.gateLabel ?? null, o.quarantine ?? null, o.at ?? "2026-10-20T03:00:00Z"])).id as string;
};
const chunk = (c: ACtx, item: string, user = c.user, text = "합성 청크", index = 0) =>
  c.q("insert into item_chunks (item_id, user_id, chunk_index, text) values ($1::uuid, $2::uuid, $4, $3)", [item, user, text, index]);
// worker_get_embed_source 는 user_keys 를 조인한다 — 호스팅 테스트 사용자는 이미 있을 수 있다(롤백되므로 남지 않는다)
const userKey = (c: ACtx) => c.q("insert into user_keys (user_id, wrapped_key) values ($1::uuid, '\\x00'::bytea) on conflict (user_id) do nothing", [c.user]);

// 실패를 기대하는 문장은 savepoint 안에서 — 실패한 문장이 바깥 트랜잭션을 오류 상태로 두지 않게. 오류 문구를 돌려준다(없으면 "")
const attempt = async (c: ACtx, fn: () => Promise<unknown>) => {
  await c.q("savepoint agg_expect");
  let err = "";
  try { await fn(); } catch (e) { err = e instanceof Error ? e.message : String(e); }
  await c.q("rollback to savepoint agg_expect");
  return err;
};
// 사용자 JWT 처럼(authenticated + claims sub). Supabase auth.uid() 는 claim.sub·claims.sub 둘 다 읽는다(PGlite 스텁도 둘 다). 끝나면 역할을 되돌린다.
// 문장이 실패하면 트랜잭션이 오류 상태라 되돌리기도 실패한다 — 그 오류는 삼키고 원래 오류를 올린다(attempt 의 savepoint 롤백이 역할·클레임을 되돌린다)
const asUser = async <T>(c: ACtx, user: string, fn: () => Promise<T>): Promise<T> => {
  await c.q("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true)", [user, JSON.stringify({ sub: user, role: "authenticated" })]);
  await c.q("set local role authenticated");
  try { return await fn(); } finally {
    try {
      await c.q("reset role");
      await c.q("select set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claims', '', true)");
    } catch { /* 실패한 트랜잭션 — attempt 가 savepoint 로 되돌린다 */ }
  }
};
const RLS = "row-level security";       // 권한 오류(permission denied)와 같은 42501 이라 문구로 가른다(PF-F4)

// 0035 함수 전부(A1 여덟 + A2 셋, PF-F9) — 권한 사례가 모두 본다
export const FUNCS_0035 = [
  "save_rules_of(uuid)", "save_rule_add(uuid, text, text)", "save_rule_remove(uuid, uuid)",
  "is_messenger(text, text)", "sender_matches(text, text, text, text, text)",
  "worker_get_embed_source(uuid, uuid)", "worker_save_chunks(uuid, uuid, jsonb)", "enqueue_embed_backlog(uuid, int)",
  "save_rule_candidates(uuid, int)", "save_rule_restore(uuid, uuid[])",
  "aggregate_items(uuid, text[], text, text[], date, date, text, text)",
];

// ── A2: 폐기분 후보·복구·집계 ──
// 배열 인자는 JSON 글로 넘겨 SQL 에서 푼다(PGlite·postgres.js 배열 직렬화 차이를 피한다)
const candidates = (c: ACtx, limit?: number, user = c.user) => limit === undefined
  ? c.q("select item_id, source, app_name, sender, title, convert_from(content_enc, 'UTF8') as body from save_rule_candidates($1::uuid)", [user])
  : c.q("select item_id, source, app_name, sender, title, convert_from(content_enc, 'UTF8') as body from save_rule_candidates($1::uuid, $2::int)", [user, limit]);
const restore = async (c: ACtx, ids: string[], user = c.user) =>
  (await one(c, "select save_rule_restore($1::uuid, array(select jsonb_array_elements_text($2::text::jsonb)::uuid)) as n", [user, JSON.stringify(ids)])).n as number;
type AggArgs = { keywords: string[]; sender?: string | null; sources?: string[]; from: string; to: string; bucket: string; key?: string | null };
type AggOut = { total: number; buckets?: { key: string; count: number }[];
  items?: { item_id: string; title: string | null; sender: string | null; source: string; app_name: string | null; occurred_at: string }[] };
const agg = async (c: ACtx, a: AggArgs, user = c.user) => (await one(c, `select aggregate_items($1::uuid,
    array(select jsonb_array_elements_text($2::text::jsonb)), $3, array(select jsonb_array_elements_text($4::text::jsonb)), $5::date, $6::date, $7, $8) as r`,
  [user, JSON.stringify(a.keywords), a.sender ?? null, JSON.stringify(a.sources ?? []), a.from, a.to, a.bucket, a.key ?? null])).r as AggOut;
// 사례마다 고유 낱말(호스팅 테스트 사용자의 다른 청크와 섞이지 않게) — 합성<run8>
const kw = (c: ACtx, s = "") => "합성" + c.tag.slice("test:".length) + s;
const sorted = (xs: string[]) => [...xs].sort();
const listIds = async (c: ACtx, a: Omit<AggArgs, "bucket" | "key">) => {
  const r = await agg(c, { ...a, bucket: "day", key: a.from });              // 사례는 하루짜리 기간 — 그날 칸 = 전부
  return sorted(r.items!.map((x) => x.item_id));
};
const sha256Hex = async (s: string) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))).map((b) => b.toString(16).padStart(2, "0")).join("");
// 격리 중(미래 기한)·받은 시각 2099 — 호스팅 테스트 사용자의 기존 격리 항목보다 최신이라 limit 사례가 이 사례 항목만 본다
const FUTURE = "2099-01-01T00:00:00Z";
const quarantined = (c: ACtx, k: string, o: Seed = {}) =>
  seed(c, k, { status: "discarded:server:notice", gateLabel: "notice", quarantine: FUTURE, at: "2099-01-01T00:00:00Z", ...o });

export const AGG_CASES: { name: string; hostedOnly?: boolean; localOnly?: boolean; run(c: ACtx): Promise<void> }[] = [
  { name: "save_rule_add normalizes and dedupes (case, inner spaces); 1 and 31 chars → bad_value; unknown kind → bad_value", run: async (c) => {
    assertEquals((await add(c, "keyword", "  합성PAY  ")).status, "added");
    assertEquals((await add(c, "keyword", "합성pay")).status, "duplicate");
    assertEquals((await add(c, "keyword", "PIN   PAY")).status, "added");
    assertEquals((await add(c, "keyword", "pin pay")).status, "duplicate");
    assertEquals((await add(c, "keyword", "가")).status, "bad_value");
    assertEquals((await add(c, "keyword", "가".repeat(31))).status, "bad_value");
    assertEquals((await add(c, "keyword", "가".repeat(30))).status, "added");      // 경계: 30자(코드 포인트, K8)
    assertEquals((await add(c, "keyword", "   ")).status, "bad_value");             // 공백만 → 빈 값
    assertEquals((await add(c, "regex", "합성PAY")).status, "bad_value");
    assertEquals((await add(c, "sender", "합성PAY")).status, "added");          // 종류가 다르면 다른 규칙
    assertEquals((await add(c, "regex", "합성PAY")).rule_id, null);
    // 순서 없이 비교(K26 — 한 트랜잭션 안 created_at 은 같다)
    assertEquals((await rulesOf(c)).map((r) => `${r.kind}:${r.value}`).sort(),
      ["keyword:PIN PAY", "keyword:합성PAY", `keyword:${"가".repeat(30)}`, "sender:합성PAY"].sort());
  } },
  { name: "save_rules_of orders by created_at then id (explicit distinct created_at, inserted out of order)", run: async (c) => {
    const ins = async (value: string, at: string) => (await one(c, "insert into save_rules (user_id, kind, value, created_at) values ($1::uuid, 'keyword', $2, $3::timestamptz) returning id",
      [c.user, value, at])).id as string;
    const b = await ins("합성B", "2026-10-21 10:00+09"), a = await ins("합성A", "2026-10-21 09:00+09"), cc = await ins("합성C", "2026-10-21 11:00+09");
    assertEquals((await rulesOf(c)).map((r) => r.id), [a, b, cc]);
    assertEquals((await rulesOf(c)).map((r) => r.value), ["합성A", "합성B", "합성C"]);
  } },
  { name: "20 rules then limit; duplicate still answers duplicate at the limit", run: async (c) => {
    const ids: string[] = [];
    for (let n = 1; n <= 20; n++) {
      const r = await add(c, "keyword", `합성규칙${n}`);
      assertEquals(r.status, "added", `rule ${n}`);
      ids.push(r.rule_id!);
    }
    assertEquals(await add(c, "keyword", "합성규칙21"), { status: "limit", rule_id: null });
    assertEquals(await add(c, "sender", "합성발신"), { status: "limit", rule_id: null });   // 종류와 상관없이 사용자당 20
    assertEquals(await add(c, "keyword", "합성규칙1"), { status: "duplicate", rule_id: ids[0] });
    assertEquals((await rulesOf(c)).length, 20);
    assertEquals((await add(c, "keyword", "합성규칙21", c.other)).status, "added");  // 한도는 사용자별
  } },
  { name: "save_rule_remove: own → removed; again → not_found; other user's id → not_found (row kept)", run: async (c) => {
    const mine = (await add(c, "keyword", "합성PAY")).rule_id!;
    const theirs = (await add(c, "keyword", "합성PAY", c.other)).rule_id!;
    assertEquals(await remove(c, mine), "removed");
    assertEquals(await remove(c, mine), "not_found");
    assertEquals(await remove(c, theirs), "not_found");
    assertEquals(await remove(c, crypto.randomUUID()), "not_found");
    assertEquals((await rulesOf(c)).length, 0);
    assertEquals((await rulesOf(c, c.other)).map((r) => r.id), [theirs]);
  } },
  { name: "audit: save_rule_add·save_rule_remove rows carry the rule id only", run: async (c) => {
    const id = (await add(c, "keyword", "합성감사값")).rule_id!;
    await add(c, "keyword", "합성감사값");                                      // duplicate 는 감사 없음
    await add(c, "keyword", "가");                                              // bad_value 도 없음
    assertEquals(await remove(c, id), "removed");
    await remove(c, id);                                                        // not_found 도 없음
    // 한 트랜잭션 안 now() 는 같다 — 이 사례(사례마다 롤백)의 행만 본다
    const a = await c.q("select actor, action, target from audit_log where user_id = $1::uuid and action like 'save_rule_%' and at = now() order by id", [c.user]);
    assertEquals(a.map((x) => [x.actor, x.action, x.target]), [["chat", "save_rule_add", id], ["chat", "save_rule_remove", id]]);
    assert(a.every((x) => !String(x.target).includes("합성감사값")));
  } },
  { name: "authenticated cannot insert/delete save_rules directly; reads only own rows", run: async (c) => {
    const mine = (await add(c, "keyword", "합성PAY")).rule_id!;
    const theirs = (await add(c, "keyword", "합성은행", c.other)).rule_id!;
    const seen = await asUser(c, c.user, () => c.q("select id from save_rules"));
    assertEquals(seen.map((r) => r.id), [mine]);                                     // 남의 행 0
    const err = await attempt(c, () => asUser(c, c.user, () =>
      c.q("insert into save_rules (user_id, kind, value) values ($1::uuid, 'keyword', '합성직접')", [c.user])));
    assert(err.includes(RLS), `expected RLS rejection, got "${err || "no error"}"`);
    const del = await asUser(c, c.user, () => c.q("delete from save_rules where id = $1::uuid returning id", [mine]));
    const upd = await asUser(c, c.user, () => c.q("update save_rules set value = '합성바꿈' where id = $1::uuid returning id", [mine]));
    assertEquals([del.length, upd.length], [0, 0]);                                  // 정책이 없어 0행(오류 없이)
    assertEquals((await rulesOf(c)).map((r) => [r.id, r.value]), [[mine, "합성PAY"]]);
    assertEquals((await rulesOf(c, c.other)).map((r) => r.id), [theirs]);
    const p = await one(c, "select has_table_privilege('anon', 'public.save_rules', 'select') as anon");
    assertEquals(p.anon, false);
  } },
  { name: "anon/authenticated cannot execute 0035 functions", run: async (c) => {
    for (const f of FUNCS_0035) {
      const r = await one(c, `select has_function_privilege('anon', 'public.${f}', 'execute') as anon,
        has_function_privilege('authenticated', 'public.${f}', 'execute') as auth,
        has_function_privilege('service_role', 'public.${f}', 'execute') as svc`);
      assertEquals([r.anon, r.auth, r.svc], [false, false, true], f);
    }
    const err = await attempt(c, () => asUser(c, c.user, () => c.q("select * from save_rules_of($1::uuid)", [c.user])));
    assert(err.includes("permission denied for function save_rules_of"), err || "no error");
  } },
  { name: "user delete cascades save_rules", localOnly: true, run: async (c) => {
    await add(c, "keyword", "합성PAY");
    await add(c, "keyword", "합성PAY", c.other);
    await c.q("delete from auth.users where id = $1::uuid", [c.user]);
    assertEquals((await one(c, "select count(*)::int as n from save_rules where user_id = $1::uuid", [c.user])).n, 0);
    assertEquals((await rulesOf(c, c.other)).length, 1);
  } },
  { name: "save_rules user FK is on delete cascade", hostedOnly: true, run: async (c) => {
    const r = await c.q(`select confdeltype from pg_constraint
      where conrelid = 'public.save_rules'::regclass and contype = 'f' and confrelid = 'auth.users'::regclass`);
    assertEquals(r.map((x) => x.confdeltype), ["c"]);
  } },
  { name: "gate_feedback accepts rule_saved, rejects 'other'; authenticated cannot insert or delete rule_saved but still inserts/deletes wrong_pass", run: async (c) => {
    const [a, b, d, e] = [await seed(c, "gf-a"), await seed(c, "gf-b"), await seed(c, "gf-d"), await seed(c, "gf-e")];
    await c.q("insert into gate_feedback (item_id, user_id, verdict) values ($1::uuid, $2::uuid, 'rule_saved')", [a, c.user]);   // save_rule_restore 경로(정의자 권한)
    const bad = await attempt(c, () => c.q("insert into gate_feedback (item_id, user_id, verdict) values ($1::uuid, $2::uuid, 'other')", [b, c.user]));
    assert(bad.includes("gate_feedback_verdict_check"), bad || "no error");
    const ins = await attempt(c, () => asUser(c, c.user, () =>
      c.q("insert into gate_feedback (item_id, user_id, verdict) values ($1::uuid, $2::uuid, 'rule_saved')", [b, c.user])));
    assert(ins.includes(RLS), `expected RLS rejection, got "${ins || "no error"}"`);
    const delSaved = await asUser(c, c.user, () => c.q("delete from gate_feedback where item_id = $1::uuid returning item_id", [a]));
    assertEquals(delSaved.length, 0);
    assertEquals((await one(c, "select verdict from gate_feedback where item_id = $1::uuid", [a])).verdict, "rule_saved");
    // 앱 경로(F4): wrong_pass POST·DELETE 는 그대로. wrong_discard 도 사용자 쓰기 대상이다(정책은 rule_saved 만 막는다)
    const insPass = await asUser(c, c.user, () =>
      c.q("insert into gate_feedback (item_id, user_id, verdict) values ($1::uuid, $2::uuid, 'wrong_pass') returning item_id", [d, c.user]));
    assertEquals(insPass.map((r) => r.item_id), [d]);
    const delPass = await asUser(c, c.user, () => c.q("delete from gate_feedback where item_id = $1::uuid and verdict = 'wrong_pass' returning item_id", [d]));
    assertEquals(delPass.map((r) => r.item_id), [d]);
    // 남의 항목에는 여전히 못 넣는다(기존 조건 유지)
    const other = await seed(c, "gf-o", { user: c.other });
    const ins2 = await attempt(c, () => asUser(c, c.user, () =>
      c.q("insert into gate_feedback (item_id, user_id, verdict) values ($1::uuid, $2::uuid, 'wrong_pass')", [other, c.user])));
    assert(ins2.includes(RLS), ins2 || "no error");
    await asUser(c, c.user, () => c.q("insert into gate_feedback (item_id, user_id, verdict) values ($1::uuid, $2::uuid, 'wrong_discard')", [e, c.user]));
    assertEquals((await one(c, "select verdict from gate_feedback where item_id = $1::uuid", [e])).verdict, "wrong_discard");
  } },
  { name: "sender_matches: spaces and case ignored; messenger title counts; non-messenger title does not", run: async (c) => {
    // 사례 표 SENDER_TABLE(아래)을 그대로 돈다 — A3 가 같은 표를 matchSaveRules 로 돈다(Review Focus 2)
    for (const [source, app, sender, title, value, expected] of SENDER_TABLE) {
      const r = await one(c, "select sender_matches($1, $2, $3, $4, $5) as m", [source, app, sender, title, value]);
      assertEquals(r.m, expected, JSON.stringify([source, app, sender, title, value]));
    }
    const m = await one(c, `select is_messenger('MESSAGES', null) as a, is_messenger('NOTIFICATION', 'Microsoft Teams') as b,
      is_messenger('NOTIFICATION', null) as n, is_messenger('NOTIFICATION', '합성앱') as d, is_messenger('GMAIL', 'Kakao Talk') as e`);
    assertEquals([m.a, m.b, m.n, m.d, m.e], [true, true, false, false, true]);
  } },
  { name: "embed targets include kept: worker_get_embed_source returns a kept body; enqueue_embed_backlog queues it; worker_save_chunks saves it", run: async (c) => {
    await userKey(c);
    const kept = await seed(c, "kept", { status: "kept", body: "합성 보관 글", title: "합성 제목" });
    const queued = await seed(c, "queued");                                       // 대조: 대상 밖 상태
    const src = await c.q("select convert_from(content_enc, 'UTF8') as body, title from worker_get_embed_source($1::uuid, $2::uuid)", [c.user, kept]);
    assertEquals(src.map((r) => [r.body, r.title]), [["합성 보관 글", "합성 제목"]]);
    assertEquals((await c.q("select * from worker_get_embed_source($1::uuid, $2::uuid)", [c.user, queued])).length, 0);
    await one(c, "select enqueue_embed_backlog($1::uuid) as n", [c.user]);
    const jobs = await c.q("select lease_key, payload from jobs where user_id = $1::uuid and kind = 'embed' and payload->>'item_id' in ($2, $3)", [c.user, kept, queued]);
    assertEquals(jobs.map((j) => [j.lease_key, j.payload.item_id, j.payload.backfill]), [[`${c.tag}:backfill:${c.user}`, kept, true]]);
    const emb = `[${[1, ...Array(511).fill(0)].join(",")}]`;
    const chunks = JSON.stringify([{ i: 0, text: "합성 청크", embedding: emb }]);
    assertEquals((await one(c, "select worker_save_chunks($1::uuid, $2::uuid, $3::text::jsonb) as n", [c.user, kept, chunks])).n, 1);
    assertEquals((await one(c, "select worker_save_chunks($1::uuid, $2::uuid, $3::text::jsonb) as n", [c.user, queued, chunks])).n, 0);
    assertEquals((await one(c, "select count(*)::int as n from item_chunks where item_id = $1::uuid", [kept])).n, 1);
  } },
  { name: "purge_quarantine leaves kept items (body and chunks) alone", run: async (c) => {
    const kept = await seed(c, "kept", { status: "kept" });
    const old = await seed(c, "old", { status: "discarded:server:notice", gateLabel: "notice", quarantine: "2026-10-01T00:00:00Z" });  // 대조: 기한 지난 격리
    await chunk(c, kept);
    await chunk(c, old);
    await one(c, "select purge_quarantine($1::uuid) as n", [c.user]);
    const st = (id: string) => one(c, `select i.status, i.content_enc is not null as body, i.quarantine_until,
      (select count(*)::int from item_chunks ch where ch.item_id = i.id) as chunks from items i where i.id = $1::uuid`, [id]);
    const k = await st(kept), o = await st(old);
    assertEquals([k.status, k.body, k.quarantine_until, k.chunks], ["kept", true, null, 1]);
    assertEquals([o.body, o.chunks], [false, 0]);
  } },
  { name: "retry_item on a kept item → not_failed", hostedOnly: true, run: async (c) => {
    const kept = await seed(c, "kept", { status: "kept" });
    await c.q("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true)", [c.user, JSON.stringify({ sub: c.user })]);
    assertEquals((await one(c, "select retry_item($1::uuid) as r", [kept])).r, "not_failed");
    assertEquals((await c.q("select id from jobs where user_id = $1::uuid and payload->>'item_id' = $2", [c.user, kept])).length, 0);
    assertEquals((await one(c, "select status from items where id = $1::uuid", [kept])).status, "kept");
  } },
  // ── 후보·복구 ──
  { name: "candidates: only quarantined gate discards with a body (rule discard, expired, purged, other user's, kept excluded), newest first, limit", run: async (c) => {
    const older = await quarantined(c, "q1", { app: null, sender: "합성 발신", title: "합성 제목1", body: "합성 본문1", at: "2099-01-02T00:00:00Z" });
    const newer = await quarantined(c, "q2", { source: "NOTIFICATION", app: "카카오톡", title: "합성 제목2", body: "합성 본문2",
      status: "discarded:server:promo", gateLabel: "promo", at: "2099-01-03T00:00:00Z" });
    const excluded = [
      await seed(c, "rule", { status: "discarded:server:otp", at: "2099-01-04T00:00:00Z" }),                         // 규칙 폐기(gate_label 없음)
      await quarantined(c, "mism", { status: "discarded:server:otp", gateLabel: "notice", at: "2099-01-04T00:00:00Z" }), // 상태 ≠ 게이트 라벨(0011 not_discarded)
      await quarantined(c, "exp", { quarantine: "2026-10-01T00:00:00Z", at: "2099-01-04T00:00:00Z" }),              // 기한 지남(본문 남음)
      await quarantined(c, "purged", { quarantine: null, body: null, at: "2099-01-04T00:00:00Z" }),                 // purge 뒤
      await quarantined(c, "nobody", { body: null, at: "2099-01-04T00:00:00Z" }),                                   // 본문 없음
      await seed(c, "kept", { status: "kept", gateLabel: "notice", at: "2099-01-04T00:00:00Z" }),
      await seed(c, "requeued", { status: "queued", gateLabel: "notice", at: "2099-01-04T00:00:00Z" }),              // 이미 복구됨
      await quarantined(c, "other", { user: c.other, at: "2099-01-04T00:00:00Z" }),
    ];
    const mine = new Set([older, newer, ...excluded]);
    const got = (await candidates(c)).filter((r) => mine.has(r.item_id));
    assertEquals(got.map((r) => r.item_id), [newer, older]);                          // 최신순
    assertEquals(got.map((r) => [r.source, r.app_name, r.sender, r.title, r.body]),
      [["NOTIFICATION", "카카오톡", null, "합성 제목2", "합성 본문2"], ["MESSAGES", null, "합성 발신", "합성 제목1", "합성 본문1"]]);
    assertEquals((await candidates(c, 1)).map((r) => r.item_id), [newer]);
    assertEquals((await candidates(c, 0)).length, 0);
    assertEquals((await candidates(c, -1)).length, 0);                                // 음수 → 0
    assertEquals((await candidates(c, undefined, c.other)).filter((r) => mine.has(r.item_id)).map((r) => r.item_id), [excluded[7]]);
    // 상한 500: 501건이면 기본값·1000 모두 500
    await c.q(`insert into items (user_id, source, content_enc, occurred_at, idempotency_key, status, gate_label, quarantine_until)
      select $1::uuid, 'MESSAGES', convert_to('합성 글', 'UTF8'), '2098-01-01T00:00:00Z'::timestamptz + make_interval(secs => n), $2 || ':MESSAGES-bulk' || n,
             'discarded:server:notice', 'notice', $3::timestamptz from generate_series(1, 501) n`, [c.user, c.tag, FUTURE]);
    assertEquals((await candidates(c)).length, 500);
    assertEquals((await candidates(c, 1000)).length, 500);
  } },
  { name: "restore: queued, quarantine null, process job skip_gate with lease '<c.tag>:item:<id>', audit restore '<id> rule', gate_feedback rule_saved (no wrong_discard)", run: async (c) => {
    const id = await quarantined(c, "r1");
    assertEquals(await restore(c, [id]), 1);
    const it = await one(c, "select status, quarantine_until, gate_label, content_enc is not null as body from items where id = $1::uuid", [id]);
    assertEquals([it.status, it.quarantine_until, it.gate_label, it.body], ["queued", null, "notice", true]);   // 라벨 유지(워커가 skip_gate 로 그대로 둔다)
    const jobs = await c.q("select kind, lease_key, payload from jobs where user_id = $1::uuid and payload->>'item_id' = $2", [c.user, id]);
    assertEquals(jobs.map((j) => [j.kind, j.lease_key, j.payload]), [["process", `${c.tag}:item:${id}`, { item_id: id, skip_gate: true }]]);
    const audit = await c.q("select actor, action, target from audit_log where user_id = $1::uuid and action = 'restore' and at = now()", [c.user]);
    assertEquals(audit.map((a) => [a.actor, a.action, a.target]), [["chat", "restore", `${id} rule`]]);
    const fb = await c.q("select user_id, verdict from gate_feedback where item_id = $1::uuid", [id]);
    assertEquals(fb.map((f) => [f.user_id, f.verdict]), [[c.user, "rule_saved"]]);
  } },
  { name: "restore lease follows 0011: ingest-form key 'MESSAGES:test:<run8>:x' (not supported as a test tag) → lease 'item:<id>'", run: async (c) => {
    const id = await quarantined(c, "ingest", { key: `MESSAGES:${c.tag}:x` });
    assertEquals(await restore(c, [id]), 1);
    const jobs = await c.q("select lease_key from jobs where user_id = $1::uuid and payload->>'item_id' = $2", [c.user, id]);
    assertEquals(jobs.map((j) => j.lease_key), [`item:${id}`]);
  } },
  { name: "restore: already restored / other user's / expired ids are not counted; returns the count", run: async (c) => {
    const [a, b] = [await quarantined(c, "a"), await quarantined(c, "b")];
    const theirs = await quarantined(c, "theirs", { user: c.other });
    const expired = await quarantined(c, "expired", { quarantine: "2026-10-01T00:00:00Z" });
    const ruled = await seed(c, "otp", { status: "discarded:server:otp" });
    assertEquals(await restore(c, [a]), 1);
    assertEquals(await restore(c, [a, b, b, theirs, expired, ruled, crypto.randomUUID()]), 1);   // b 만(중복 id 한 번)
    assertEquals(await restore(c, []), 0);
    const st = async (id: string) => (await one(c, "select status, quarantine_until is not null as q from items where id = $1::uuid", [id]));
    assertEquals([(await st(theirs)).status, (await st(theirs)).q], ["discarded:server:notice", true]);
    assertEquals((await st(expired)).status, "discarded:server:notice");
    assertEquals((await st(ruled)).status, "discarded:server:otp");
    const jobs = await c.q("select payload->>'item_id' as item from jobs where kind = 'process' and payload->>'item_id' in ($1, $2, $3, $4, $5)",
      [a, b, theirs, expired, ruled]);
    assertEquals(sorted(jobs.map((j) => j.item)), sorted([a, b]));                       // a 는 한 번만
    assertEquals((await c.q("select item_id from gate_feedback where item_id in ($1::uuid, $2::uuid, $3::uuid)", [theirs, expired, ruled])).length, 0);
  } },
  { name: "restore keeps an existing gate_feedback row (on conflict do nothing)", run: async (c) => {
    const id = await quarantined(c, "fb");
    await c.q("insert into gate_feedback (item_id, user_id, verdict, at) values ($1::uuid, $2::uuid, 'wrong_discard', '2026-10-01T00:00:00Z')", [id, c.user]);
    assertEquals(await restore(c, [id]), 1);
    const fb = await c.q("select verdict, at from gate_feedback where item_id = $1::uuid", [id]);
    assertEquals(fb.map((f) => [f.verdict, new Date(f.at).toISOString()]), [["wrong_discard", "2026-10-01T00:00:00.000Z"]]);
    assertEquals((await one(c, "select status from items where id = $1::uuid", [id])).status, "queued");
  } },
  // ── 집계 — 사례마다 고유 낱말 kw(c), 기간 2026-10-15 하루(서울) ──
  { name: "aggregate: counts items not chunks; keywords AND across different chunks of one item = 1", run: async (c) => {
    const day = { from: "2026-10-15", to: "2026-10-15" }, at = "2026-10-15T12:00:00+09:00";
    const t2 = kw(c, "타임");
    const a = await seed(c, "a", { status: "extracted", at });
    await chunk(c, a, c.user, `${kw(c)} ${t2} 첫째`, 0);
    await chunk(c, a, c.user, `${kw(c)} 둘째`, 1);                                     // 같은 항목 두 청크 = 1건
    const b = await seed(c, "b", { status: "extracted", at });
    await chunk(c, b, c.user, kw(c), 0);
    await chunk(c, b, c.user, `알림 ${t2}`, 1);                                        // 키워드가 서로 다른 청크
    const d = await seed(c, "d", { status: "extracted", at });
    await chunk(c, d, c.user, kw(c), 0);                                               // 두 번째 키워드 없음
    const one1 = await agg(c, { keywords: [kw(c)], ...day, bucket: "day" });
    assertEquals([one1.total, one1.buckets], [3, [{ key: "2026-10-15", count: 3 }]]);
    const both = await agg(c, { keywords: [kw(c), t2], ...day, bucket: "day" });
    assertEquals(both.total, 2);
    assertEquals(await listIds(c, { keywords: [kw(c), t2], ...day }), sorted([a, b]));
    const e = await seed(c, "e", { status: "extracted", at });
    await chunk(c, e, c.user, `${kw(c)}TIMEOUT`);
    assertEquals(await listIds(c, { keywords: [`${kw(c)}timeout`], ...day }), [e]);   // ILIKE — 대소문자 무시
  } },
  { name: "aggregate: % _ \\ are literal ('50%' does not match '500'; 'a_b' does not match 'axb')", run: async (c) => {
    const day = { from: "2026-10-15", to: "2026-10-15" }, at = "2026-10-15T12:00:00+09:00";
    const mk = async (k: string, text: string) => { const id = await seed(c, k, { status: "extracted", at }); await chunk(c, id, c.user, text); return id; };
    const pct = await mk("pct", `${kw(c)}50%할인`), n500 = await mk("n500", `${kw(c)}500할인`);
    const ab = await mk("ab", `${kw(c)}a_b`), axb = await mk("axb", `${kw(c)}axb`);
    const bs = await mk("bs", `${kw(c)}c\\d`), cd = await mk("cd", `${kw(c)}cd`);
    assertEquals(await listIds(c, { keywords: [`${kw(c)}50%`], ...day }), [pct]);
    assertEquals(await listIds(c, { keywords: [`${kw(c)}a_b`], ...day }), [ab]);
    assertEquals(await listIds(c, { keywords: [`${kw(c)}c\\d`], ...day }), [bs]);
    assertEquals(await listIds(c, { keywords: [kw(c)], ...day }), sorted([pct, n500, ab, axb, bs, cd]));
  } },
  { name: "aggregate: statuses kept/extracted/empty counted; quarantined, queued, rule-discarded not", run: async (c) => {
    const day = { from: "2026-10-15", to: "2026-10-15" }, at = "2026-10-15T12:00:00+09:00";
    const mk = async (k: string, o: Seed) => { const id = await seed(c, k, { at, ...o }); await chunk(c, id, c.user, `${kw(c)} 합성`); return id; };
    const counted = [await mk("kept", { status: "kept" }), await mk("ext", { status: "extracted" }), await mk("empty", { status: "discarded:server:empty" })];
    await mk("quar", { status: "discarded:server:notice", gateLabel: "notice", quarantine: FUTURE });
    await mk("queued", { status: "queued" });
    await mk("otp", { status: "discarded:server:otp" });
    await mk("failed", { status: "failed" });
    assertEquals((await agg(c, { keywords: [kw(c)], ...day, bucket: "day" })).total, 3);
    assertEquals(await listIds(c, { keywords: [kw(c)], ...day }), sorted(counted));
  } },
  { name: "aggregate: other user's chunks never counted", run: async (c) => {
    const day = { from: "2026-10-15", to: "2026-10-15" }, at = "2026-10-15T12:00:00+09:00";
    const mine = await seed(c, "mine", { status: "extracted", at });
    await chunk(c, mine, c.user, kw(c));
    const theirs = await seed(c, "theirs", { status: "extracted", at, user: c.other });
    await chunk(c, theirs, c.other, kw(c));
    assertEquals(await listIds(c, { keywords: [kw(c)], ...day }), [mine]);
    assertEquals((await agg(c, { keywords: [kw(c)], ...day, bucket: "hour" }, c.other)).total, 1);
    const ids = (await agg(c, { keywords: [kw(c)], ...day, bucket: "day", key: day.from }, c.other)).items!.map((x) => x.item_id);
    assertEquals(ids, [theirs]);
  } },
  { name: "aggregate sources: MESSAGES = MESSAGES + NOTIFICATION·메시지 (KakaoTalk notification not); NOTIFICATION = all notifications incl. 메시지; both = union without double count; empty = all", run: async (c) => {
    const day = { from: "2026-10-15", to: "2026-10-15" }, at = "2026-10-15T12:00:00+09:00";
    const mk = async (k: string, o: Seed) => { const id = await seed(c, k, { at, status: "extracted", ...o }); await chunk(c, id, c.user, kw(c)); return id; };
    const m = await mk("m", { source: "MESSAGES" });
    const nm = await mk("nm", { source: "NOTIFICATION", app: "메시지" });
    const nk = await mk("nk", { source: "NOTIFICATION", app: "카카오톡" });
    const g = await mk("g", { source: "GMAIL" });
    const base = { keywords: [kw(c)], ...day };
    assertEquals(await listIds(c, { ...base, sources: ["MESSAGES"] }), sorted([m, nm]));
    assertEquals(await listIds(c, { ...base, sources: ["NOTIFICATION"] }), sorted([nm, nk]));
    assertEquals(await listIds(c, { ...base, sources: ["MESSAGES", "NOTIFICATION"] }), sorted([m, nm, nk]));
    assertEquals((await agg(c, { ...base, sources: ["MESSAGES", "NOTIFICATION"], bucket: "day" })).total, 3);   // 겹쳐 세지 않음
    assertEquals(await listIds(c, { ...base, sources: [] }), sorted([m, nm, nk, g]));
    assertEquals(await listIds(c, { ...base, sources: ["GMAIL"] }), [g]);
  } },
  { name: "aggregate sender: sender_matches incl. messenger title", run: async (c) => {
    const day = { from: "2026-10-15", to: "2026-10-15" }, at = "2026-10-15T12:00:00+09:00";
    const mk = async (k: string, o: Seed) => { const id = await seed(c, k, { at, status: "extracted", ...o }); await chunk(c, id, c.user, kw(c)); return id; };
    const sms = await mk("sms", { source: "MESSAGES", sender: "합성 은행" });
    const kakao = await mk("kakao", { source: "NOTIFICATION", app: "카카오톡", title: "합성은행 고객센터" });
    await mk("app", { source: "NOTIFICATION", app: "합성앱", title: "합성은행" });              // 메신저 아님 — 제목 안 봄
    await mk("card", { source: "MESSAGES", sender: "합성카드" });
    assertEquals(await listIds(c, { keywords: [kw(c)], ...day, sender: "합성은행" }), sorted([sms, kakao]));
    assertEquals(await listIds(c, { keywords: [kw(c)], ...day, sender: "합성 은행" }), sorted([sms, kakao]));
    assertEquals((await agg(c, { keywords: [kw(c)], ...day, sender: null, bucket: "day" })).total, 4);
  } },
  { name: "aggregate Seoul buckets: 2026-10-15T23:59:59+09:00 → hour '23', day '2026-10-15', weekday '4'; 2026-10-16T00:00:00+09:00 → '00', '2026-10-16', '5'; p_to day is inclusive", run: async (c) => {
    const mk = async (k: string, at: string) => { const id = await seed(c, k, { at, status: "extracted" }); await chunk(c, id, c.user, kw(c)); return id; };
    await mk("late", "2026-10-15T23:59:59+09:00");
    await mk("midnight", "2026-10-16T00:00:00+09:00");
    await mk("before", "2026-10-14T23:59:59+09:00");                                  // from 밖
    await mk("after", "2026-10-17T00:00:00+09:00");                                   // to 다음 날 0시 = 밖
    const p = { keywords: [kw(c)], from: "2026-10-15", to: "2026-10-16" };
    assertEquals(await agg(c, { ...p, bucket: "hour" }), { total: 2, buckets: [{ key: "00", count: 1 }, { key: "23", count: 1 }] });
    assertEquals(await agg(c, { ...p, bucket: "day" }), { total: 2, buckets: [{ key: "2026-10-15", count: 1 }, { key: "2026-10-16", count: 1 }] });
    assertEquals(await agg(c, { ...p, bucket: "weekday" }), { total: 2, buckets: [{ key: "4", count: 1 }, { key: "5", count: 1 }] });
    assertEquals(await agg(c, { ...p, from: "2026-10-16", bucket: "day" }), { total: 1, buckets: [{ key: "2026-10-16", count: 1 }] });
    assertEquals(await agg(c, { ...p, to: "2026-10-15", bucket: "day" }), { total: 1, buckets: [{ key: "2026-10-15", count: 1 }] });
    assertEquals(await agg(c, { ...p, from: "2026-10-14", to: "2026-10-17", bucket: "day" }),
      { total: 4, buckets: [{ key: "2026-10-14", count: 1 }, { key: "2026-10-15", count: 1 }, { key: "2026-10-16", count: 1 }, { key: "2026-10-17", count: 1 }] });
  } },
  { name: "aggregate list mode: newest 50 of that bucket, total = bucket count", run: async (c) => {
    const ids: string[] = [];
    for (let n = 0; n < 52; n++) {                                                    // 같은 칸(10/15) 52건, 1분 간격
      const at = new Date(Date.parse("2026-10-15T10:00:00+09:00") + n * 60_000).toISOString();
      const id = await seed(c, `l${n}`, { at, status: "kept", source: "NOTIFICATION", app: "카카오톡", sender: null, title: `합성 제목${n}` });
      await chunk(c, id, c.user, kw(c));
      ids.push(id);
    }
    const next = await seed(c, "next", { at: "2026-10-16T10:00:00+09:00", status: "kept" });
    await chunk(c, next, c.user, kw(c));
    const r = await agg(c, { keywords: [kw(c)], from: "2026-10-15", to: "2026-10-16", bucket: "day", key: "2026-10-15" });
    assertEquals([r.total, r.items!.length, r.buckets], [52, 50, undefined]);
    assertEquals(r.items!.map((x) => x.item_id), ids.slice(2).reverse());                 // 최신순, 가장 오래된 둘 빠짐
    const top = r.items![0];
    assertEquals([top.title, top.sender, top.source, top.app_name, Date.parse(top.occurred_at)],
      ["합성 제목51", null, "NOTIFICATION", "카카오톡", Date.parse("2026-10-15T10:51:00+09:00")]);
    assertEquals(await agg(c, { keywords: [kw(c)], from: "2026-10-15", to: "2026-10-16", bucket: "day", key: "2026-10-17" }), { total: 0, items: [] });
    assertEquals((await agg(c, { keywords: [kw(c)], from: "2026-10-15", to: "2026-10-16", bucket: "hour", key: "10" })).total, 53);
  } },
  { name: "aggregate writes one audit_log read row whose target is sha256 of the sorted counted ids", run: async (c) => {
    const at = "2026-10-15T12:00:00+09:00";
    const ids: string[] = [];
    for (const [k, when] of [["x", at], ["y", at], ["z", "2026-10-16T12:00:00+09:00"]]) {
      const id = await seed(c, k, { at: when, status: "extracted" });
      await chunk(c, id, c.user, kw(c));
      ids.push(id);
    }
    const p = { keywords: [kw(c)], from: "2026-10-15", to: "2026-10-16" };
    const reads = () => c.q("select actor, target from audit_log where user_id = $1::uuid and action = 'read' and at = now() order by id", [c.user]);
    await agg(c, { ...p, bucket: "day" });
    assertEquals((await reads()).map((r) => [r.actor, r.target]), [["chat", await sha256Hex(sorted(ids).join(","))]]);
    await agg(c, { ...p, bucket: "day", key: "2026-10-15" });                           // 목록 모드 = 그 칸 항목
    await agg(c, { ...p, keywords: [kw(c, "없음")], bucket: "day" });                    // 0건도 한 행 = sha256('')
    const all = await reads();
    assertEquals(all.map((r) => r.target), [await sha256Hex(sorted(ids).join(",")), await sha256Hex(sorted(ids.slice(0, 2)).join(",")),
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"]);
    assert(all.every((r) => !String(r.target).includes(kw(c))));
    // 감사 insert 가 있으므로 volatile, 함수 속성 statement_timeout 5초(K5, PF-F10)
    const f = await one(c, "select provolatile, proconfig from pg_proc where oid = 'public.aggregate_items(uuid,text[],text,text[],date,date,text,text)'::regprocedure");
    assertEquals([f.provolatile, f.proconfig], ["v", ["statement_timeout=5s"]]);
  } },
  { name: "aggregate rejects unknown bucket / empty keywords (bad_args)", run: async (c) => {
    const p = { keywords: [kw(c)], from: "2026-10-15", to: "2026-10-15" };
    for (const a of [{ ...p, bucket: "month" }, { ...p, bucket: "" }, { ...p, keywords: [], bucket: "day" }, { ...p, keywords: [""], bucket: "day" },
      { ...p, keywords: [kw(c), ""], bucket: "hour" }]) {
      const err = await attempt(c, () => agg(c, a));
      assert(err.includes("bad_args"), `${JSON.stringify(a)}: ${err || "no error"}`);
    }
    const nullBucket = await attempt(c, () => c.q("select aggregate_items($1::uuid, array[$2]::text[], null, '{}', '2026-10-15', '2026-10-15', null)", [c.user, kw(c)]));
    assert(nullBucket.includes("bad_args"), nullBucket || "no error");
    const nullKw = await attempt(c, () => c.q("select aggregate_items($1::uuid, null, null, '{}', '2026-10-15', '2026-10-15', 'day')", [c.user]));
    assert(nullKw.includes("bad_args"), nullKw || "no error");
    assertEquals((await c.q("select id from audit_log where user_id = $1::uuid and action = 'read' and at = now()", [c.user])).length, 0);  // 거절은 감사 없음
  } },
];

// A3 와 공유하는 표: [source, app, sender, title, value, expected]. 값·발신자·(메신저)제목 모두 공백 제거·소문자로 비교(스펙 §7, PF-F5)
export const SENDER_TABLE: [string, string | null, string | null, string | null, string, boolean][] = [
  ["MESSAGES", null, "합성 은행", null, "합성은행", true],
  ["NOTIFICATION", "카카오톡", null, "합성은행 고객센터", "합성은행", true],
  ["NOTIFICATION", "Kakao Talk", null, "합성은행", "합성은행", true],
  ["NOTIFICATION", "합성앱", null, "합성은행", "합성은행", false],
  ["GMAIL", null, "News <합성은행@example.com>", "공지", "합성은행", true],
  ["MESSAGES", null, "합성카드", null, "합성은행", false],
  ["MESSAGES", null, "합성은행", null, "합성 은행", true],
  ["NOTIFICATION", "카카오톡", null, "합성은행", "합성 은행", true],
];
