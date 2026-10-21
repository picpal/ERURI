import { PGlite } from "npm:@electric-sql/pglite@0.3";
import { AGG_CASES, MIGRATION_0035, type Q } from "./_agg-sql.ts";
import { PGLITE_STUBS } from "./_pglite-stubs.ts";

// 0035(0.17.0 저장 규칙·집계 질문)를 로컬 PGlite 에서: 스텁 + Supabase 기본 권한 흉내 + items(0001 열)·user_keys·item_chunks + 0010·0011·0015·0016 + 0035.
// 호스팅 DB 는 건드리지 않는다(호스팅은 agg-db.test.ts). hostedOnly 사례는 건너뛴다
const mig = (f: string) => new URL(`../migrations/${f}`, import.meta.url);
// pgvector 가 없다 — 임베딩 열·캐스트는 text 로(0016 과 0035 의 worker_save_chunks 둘 다, PF-F3). 호스팅은 원문
const noVector = (s: string) => s.replace(/extensions\.vector\(512\)|vector\(512\)/g, "text");

// Supabase 기본 권한 흉내(PF-F4): 표·함수는 anon·authenticated·service_role 에 기본 부여, auth 스키마 사용 가능.
// 이것이 없으면 RLS 거절 사례가 권한 오류로 거짓 통과한다(둘 다 42501). 0035 의 revoke 가 이 기본 부여를 걷어 내는지 사례가 본다
const GRANTS = `
grant usage on schema auth to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to anon, authenticated, service_role;
grant execute on all functions in schema public to anon, authenticated, service_role;
alter default privileges in schema public grant select, insert, update, delete on tables to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`;
const STUBS = `
-- Supabase auth.uid() 처럼 claim.sub, 없으면 claims.sub
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'sub')::uuid $$;
create table user_keys (user_id uuid primary key references auth.users on delete cascade, wrapped_key bytea not null);
create table items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  source text not null check (source in ('GMAIL','MESSAGES','NOTIFICATION','SHARE','CHAT')),
  app_name text, sender text, title text, content_enc bytea, ocr_text_enc bytea,
  occurred_at timestamptz not null, captured_at timestamptz not null default now(), device_filter text,
  idempotency_key text not null, status text not null default 'queued', storage_key text,
  expires_at timestamptz not null default now() + interval '90 days',
  unique (user_id, idempotency_key)
);
alter table items enable row level security;
create policy items_owner_read on items for select using ((select auth.uid()) = user_id);
create table item_chunks (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references items(id) on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  chunk_index int not null, text text not null, embedding text
);
`;
const db = new PGlite();
await db.exec(PGLITE_STUBS);
await db.exec(GRANTS);
await db.exec(STUBS);
// 0010(게이트 열·gate_feedback·purge_quarantine)·0011(restore_discarded)·0015·0016(embed 대상 함수) — 0035 가 고치거나 기대는 것
for (const f of ["0010_gate_quarantine.sql", "0011_restore_test_tag.sql", "0015_chunks_embed.sql", "0016_embed_budget.sql"]) {
  await db.exec(noVector(await Deno.readTextFile(mig(f))));
}
await db.exec(noVector(await Deno.readTextFile(MIGRATION_0035)));
const q: Q = async (sql, params = []) => (await db.query(sql, params)).rows as Record<string, unknown>[];

for (const c of AGG_CASES) {
  Deno.test({ name: "pglite: " + c.name, ignore: c.hostedOnly === true, sanitizeResources: false, sanitizeOps: false, fn: async () => {
    await db.exec("begin");
    try {
      const user = crypto.randomUUID(), other = crypto.randomUUID();
      await q("insert into auth.users (id) values ($1::uuid), ($2::uuid)", [user, other]);
      await c.run({ q, user, other, tag: "test:" + crypto.randomUUID().slice(0, 8) });
    } finally {
      await db.exec("rollback");
    }
  } });
}
