import { assert, assertEquals } from "jsr:@std/assert";
import { PGlite } from "npm:@electric-sql/pglite@0.3";
import { MIGRATION_0030 } from "./_mail-sql.ts";
import { PGLITE_STUBS } from "./_pglite-stubs.ts";

// 0031 제안 목록 출처 열(2026-10-07 사용자 요청, 스펙 §10 대기 목록 출처 열·§11): 로컬 PGlite 에 0030 → 0026 → 0031 을 얹어
// 반환 열·값·권한·security definer·search_path 를 본다. 호스팅 DB 는 건드리지 않는다(M10 에서 0030 과 함께 적용). 값은 합성만
const MIGRATION_0026 = new URL("../migrations/0026_proposal_list_all_day.sql", import.meta.url);
const MIGRATION_0031 = new URL("../migrations/0031_pending_proposals_source.sql", import.meta.url);   // M10 이 ../migrations/ 로 옮긴다

// 0031 이 닿는 것만 — 열은 원본(0001 items·facts·proposals, 0021 dismissed, 0025 ordinal)과 같게. auth.uid() 는 Supabase 처럼 JWT 클레임 sub
const STUBS = `
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claims', true)::jsonb->>'sub', '')::uuid $$;
create table items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  source text not null check (source in ('GMAIL','MESSAGES','NOTIFICATION','SHARE','CHAT')),
  app_name text, sender text, title text, content_enc bytea,
  occurred_at timestamptz not null default now(),
  idempotency_key text not null,
  unique (user_id, idempotency_key)
);
create table facts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  item_id uuid references items on delete cascade,
  kind text not null, payload jsonb not null,
  status text not null default 'active',
  ordinal smallint not null default 0,
  created_at timestamptz not null default now()
);
create table proposals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  fact_id uuid not null references facts on delete cascade,
  action text not null, payload jsonb not null,
  version int not null default 1,
  status text not null default 'proposed',
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table items enable row level security;
alter table facts enable row level security;
alter table proposals enable row level security;
`;

const db = new PGlite();
await db.exec(PGLITE_STUBS);
await db.exec(await Deno.readTextFile(MIGRATION_0030));
await db.exec(STUBS);
await db.exec(await Deno.readTextFile(MIGRATION_0026));
await db.exec(await Deno.readTextFile(MIGRATION_0031));
// deno-lint-ignore no-explicit-any
const q = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows as Record<string, any>[];

const HOUR = 3600_000;
const at = (ms: number) => new Date(Date.now() + ms).toISOString();

async function seed(user: string, tag: string, source: string, appName: string | null, payload: Record<string, unknown>) {
  const item = (await q(`insert into items (user_id, source, app_name, sender, title, content_enc, idempotency_key)
    values ($1::uuid, $2, $3, '합성 발신자', '합성 제목', '\\x00'::bytea, $4) returning id`, [user, source, appName, `test:${tag}`]))[0].id as string;
  const fact = (await q("insert into facts (user_id, item_id, kind, payload) values ($1::uuid, $2::uuid, 'event', $3::jsonb) returning id",
    [user, item, JSON.stringify(payload)]))[0].id as string;
  const proposal = (await q(`insert into proposals (user_id, fact_id, action, payload, idempotency_key)
    values ($1::uuid, $2::uuid, 'create_event', $3::jsonb, $4) returning id`, [user, fact, JSON.stringify(payload), `test:${tag}:p`]))[0].id as string;
  return { item, proposal };
}

// authenticated + JWT sub 로 목록을 읽는다(호스팅 테스트 proposals-allday-db 와 같은 방식)
async function listAs(user: string) {
  await q("set role authenticated");
  try {
    await q("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: user, role: "authenticated" })]);
    return await q("select * from public.list_pending_proposals()");
  } finally {
    await q("reset role");
  }
}

async function inTx(fn: () => Promise<void>) {
  await db.exec("begin");
  try { await fn(); } finally { await db.exec("rollback"); }
}
async function newUser() {
  const u = crypto.randomUUID();
  await q("insert into auth.users (id) values ($1::uuid)", [u]);
  return u;
}

Deno.test({ name: "0031 list_pending_proposals: result columns = 0026 columns + item_id·source·app_name (no body, title or sender of the item)", sanitizeResources: false, sanitizeOps: false, fn: async () => {
  const [r] = await q("select pg_get_function_result('public.list_pending_proposals()'::regprocedure) as res");
  assertEquals(r.res, 'TABLE(proposal_id uuid, action text, title text, start text, "end" text, all_day boolean, location text, version integer, created_at timestamp with time zone, item_id uuid, source text, app_name text)');
} });

Deno.test({ name: "0031 list_pending_proposals: grants (authenticated only), security definer, search_path '' kept from 0026", sanitizeResources: false, sanitizeOps: false, fn: async () => {
  const [g] = await q(`select has_function_privilege('anon', 'public.list_pending_proposals()', 'execute') as anon,
    has_function_privilege('authenticated', 'public.list_pending_proposals()', 'execute') as authenticated,
    p.prosecdef, p.proconfig, p.provolatile
    from pg_proc p where p.oid = 'public.list_pending_proposals()'::regprocedure`);
  assertEquals([g.anon, g.authenticated, g.prosecdef, g.proconfig, g.provolatile], [false, true, true, ['search_path=""'], "s"]);
  const [n] = await q("select count(*)::int as n from pg_proc where proname = 'list_pending_proposals'");
  assertEquals(n.n, 1);                                                    // 오버로드가 남지 않는다
} });

Deno.test({ name: "0031 list_pending_proposals: each row carries its item's id, source and app_name; other users' rows stay out; 0026 fields unchanged", sanitizeResources: false, sanitizeOps: false, fn: () => inTx(async () => {
  const u = await newUser(), other = await newUser();
  const sms = await seed(u, "sms", "MESSAGES", null, { title: "합성 치과 예약", start: at(48 * HOUR), end: at(49 * HOUR), location: "합성치과", uncertain: [] });
  const noti = await seed(u, "noti", "NOTIFICATION", "합성톡", { title: "합성 학부모 상담", start: at(50 * HOUR), uncertain: [] });
  const mail = await seed(u, "mail", "GMAIL", null, { title: "합성 세미나", start: at(52 * HOUR), uncertain: [] });
  const share = await seed(u, "share", "SHARE", "채팅", { title: "합성 공연", start: at(54 * HOUR), uncertain: [] });
  const past = await seed(u, "past", "MESSAGES", null, { title: "합성 지난 일정", start: at(-2 * HOUR), uncertain: [] });
  const theirs = await seed(other, "theirs", "MESSAGES", null, { title: "합성 남의 일정", start: at(48 * HOUR), uncertain: [] });

  const rows = await listAs(u);
  assertEquals(rows.map((r) => r.proposal_id), [sms.proposal, noti.proposal, mail.proposal, share.proposal]);   // 시작 순, 지난 일정·남의 제안 없음
  const pick = (r: Record<string, unknown>) => [r.item_id, r.source, r.app_name];
  assertEquals(rows.map(pick), [[sms.item, "MESSAGES", null], [noti.item, "NOTIFICATION", "합성톡"], [mail.item, "GMAIL", null], [share.item, "SHARE", "채팅"]]);
  for (const r of rows) for (const k of ["sender", "content_enc", "item_title"]) assert(!(k in r));
  assertEquals([rows[0].title, rows[0].location, rows[0].all_day, rows[0].action, rows[0].version], ["합성 치과 예약", "합성치과", false, "ADD_EVENT", 1]);
  assert(!rows.some((r) => r.proposal_id === past.proposal || r.proposal_id === theirs.proposal));
  assertEquals((await listAs(other)).map(pick), [[theirs.item, "MESSAGES", null]]);
}) });

Deno.test({ name: "0031 list_pending_proposals: a fact without an item (item_id null) still lists the proposal with null source columns", sanitizeResources: false, sanitizeOps: false, fn: () => inTx(async () => {
  const u = await newUser();
  const s = await seed(u, "orphan", "MESSAGES", null, { title: "합성 고아", start: at(48 * HOUR), uncertain: [] });
  await q("update facts set item_id = null where user_id = $1::uuid", [u]);
  const rows = await listAs(u);
  assertEquals(rows.map((r) => [r.proposal_id, r.item_id, r.source, r.app_name]), [[s.proposal, null, null, null]]);
}) });

Deno.test({ name: "0031 list_pending_proposals: an item owned by another user is never joined (defensive user match)", sanitizeResources: false, sanitizeOps: false, fn: () => inTx(async () => {
  const u = await newUser(), other = await newUser();
  const mine = await seed(u, "mine", "MESSAGES", null, { title: "합성 내 일정", start: at(48 * HOUR), uncertain: [] });
  const theirs = await seed(other, "theirs2", "GMAIL", null, { title: "합성 남의 메일", start: at(48 * HOUR), uncertain: [] });
  await q("update facts set item_id = $1::uuid where user_id = $2::uuid", [theirs.item, u]);   // 제품 경로에는 없는 어긋난 행
  const rows = await listAs(u);
  assertEquals(rows.map((r) => [r.proposal_id, r.item_id, r.source]), [[mine.proposal, null, null]]);
}) });
