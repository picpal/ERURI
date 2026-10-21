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
type Seed = { source?: string; app?: string | null; sender?: string | null; title?: string | null; body?: string | null; status?: string;
  gateLabel?: string | null; quarantine?: string | null; user?: string };
const seed = async (c: ACtx, k: string, o: Seed = {}) => {
  const source = o.source ?? "MESSAGES";
  return (await one(c, `insert into items (user_id, source, app_name, sender, title, content_enc, occurred_at, idempotency_key, status, gate_label, quarantine_until)
    values ($1::uuid, $2, $3, $4, $5, convert_to($6, 'UTF8'), '2026-10-20T03:00:00Z'::timestamptz, $7, $8, $9, $10::timestamptz) returning id`,
    [o.user ?? c.user, source, o.app ?? null, o.sender ?? null, o.title ?? null, o.body === undefined ? "합성 글" : o.body,
      `${c.tag}:${source}-${k}`, o.status ?? "queued", o.gateLabel ?? null, o.quarantine ?? null])).id as string;
};
const chunk = (c: ACtx, item: string, user = c.user) =>
  c.q("insert into item_chunks (item_id, user_id, chunk_index, text) values ($1::uuid, $2::uuid, 0, '합성 청크')", [item, user]);
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

// A1 이 만드는 함수(A2 가 save_rule_candidates·save_rule_restore·aggregate_items 를 더한다, PF-F9)
export const FUNCS_0035 = [
  "save_rules_of(uuid)", "save_rule_add(uuid, text, text)", "save_rule_remove(uuid, uuid)",
  "is_messenger(text, text)", "sender_matches(text, text, text, text, text)",
  "worker_get_embed_source(uuid, uuid)", "worker_save_chunks(uuid, uuid, jsonb)", "enqueue_embed_backlog(uuid, int)",
];

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
