import { PGlite } from "npm:@electric-sql/pglite@0.3";
import { EDIT_CASES, type ECtx, MIGRATION_0033 } from "./_edit-sql.ts";
import { PGLITE_STUBS } from "./_pglite-stubs.ts";

// 0033(채팅 일정 고치기, 계획 E1·E2)을 로컬 PGlite 에서: 스텁 + 0021(report_execution·dismissed) + 0033. 호스팅 DB 는 건드리지 않는다(D1 에서 적용)
const MIGRATION_0021 = new URL("../migrations/0021_proposal_review.sql", import.meta.url);
// 0033·0021 이 닿는 것만 — 열은 원본(0001 items·facts·proposals, 0004 executions, 0025 ordinal)과 같게. auth.uid() 는 Supabase 처럼 JWT 클레임 sub
const STUBS = `
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'sub', '')::uuid $$;
create table items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  source text not null check (source in ('GMAIL','MESSAGES','NOTIFICATION','SHARE','CHAT')),
  app_name text, sender text, title text, content_enc bytea,
  occurred_at timestamptz not null, captured_at timestamptz not null default now(),
  idempotency_key text not null, status text not null default 'queued',
  unique (user_id, idempotency_key)
);
create table facts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  item_id uuid references items on delete cascade,
  kind text not null check (kind in ('event', 'task', 'purchase', 'subscription')),
  ordinal smallint not null default 0, payload jsonb not null, evidence text,
  status text not null default 'active' check (status in ('active', 'cancelled', 'superseded')),
  created_at timestamptz not null default now()
);
create table proposals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  fact_id uuid not null references facts on delete cascade,
  action text not null check (action in ('create_event', 'update_event', 'create_reminder', 'complete_reminder')),
  payload jsonb not null, version int not null default 1,
  status text not null default 'proposed' check (status in ('proposed', 'confirmed', 'succeeded', 'failed', 'stale')),
  eventkit_id text, idempotency_key text not null unique,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table executions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  proposal_id uuid not null references proposals on delete cascade,
  device_id text not null, eventkit_id text not null, version int not null,
  executed_at timestamptz not null, reported_at timestamptz not null default now(),
  unique (proposal_id)
);
alter table items enable row level security; alter table facts enable row level security;
alter table proposals enable row level security; alter table executions enable row level security;
`;

const db = new PGlite();
await db.exec(PGLITE_STUBS);
await db.exec(STUBS);
await db.exec(await Deno.readTextFile(MIGRATION_0021));
await db.exec(await Deno.readTextFile(MIGRATION_0033));
// deno-lint-ignore no-explicit-any
const q = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows as Record<string, any>[];
async function newUser() { const u = crypto.randomUUID(); await q("insert into auth.users (id) values ($1::uuid)", [u]); return u; }

for (const c of EDIT_CASES) {
  Deno.test({ name: `0033 (PGlite) ${c.name}`, sanitizeResources: false, sanitizeOps: false, fn: async () => {
    await db.exec("begin");
    try {
      const ctx: ECtx = { q, user: await newUser(), other: await newUser(), run: "test:pglite" };
      await c.run(ctx);
    } finally { await db.exec("rollback"); }
  } });
}
