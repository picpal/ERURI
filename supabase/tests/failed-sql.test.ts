import { PGlite } from "npm:@electric-sql/pglite@0.3";
import { FAILED_CASES, MIGRATION_0034, type Q } from "./_failed-sql.ts";
import { PGLITE_STUBS } from "./_pglite-stubs.ts";

// 0034(0.16.1 처리 실패 항목)를 로컬 PGlite 에서: 스텁 + items(0001·0010 열) + 0034. 호스팅 DB 는 건드리지 않는다(호스팅은 failed-db.test.ts)
const MIGRATION_0013 = new URL("../migrations/0013_source_delete_lock.sql", import.meta.url);
const STUBS = `
create table items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  source text not null check (source in ('GMAIL','MESSAGES','NOTIFICATION','SHARE','CHAT')),
  app_name text, sender text, title text, content_enc bytea, ocr_text_enc bytea,
  occurred_at timestamptz not null, captured_at timestamptz not null default now(), device_filter text,
  idempotency_key text not null, status text not null default 'queued', storage_key text,
  expires_at timestamptz not null default now() + interval '90 days',
  gate_label text, gate_confidence real, quarantine_until timestamptz,
  unique (user_id, idempotency_key)
);
create table facts (id uuid primary key default gen_random_uuid(), user_id uuid, item_id uuid, supersedes_id uuid);
`;
const db = new PGlite();
await db.exec(PGLITE_STUBS);
await db.exec(STUBS);
// 0034 전의 insert_item(0013 정의 그대로 — 그 파일의 나머지는 Gmail 출처 삭제라 잘라 낸다). 0034 가 create or replace 로 바꾼다
const m0013 = await Deno.readTextFile(MIGRATION_0013), from = m0013.indexOf("create or replace function insert_item(");
await db.exec(m0013.slice(from, m0013.indexOf("end $$;", from) + "end $$;".length));
await db.exec(await Deno.readTextFile(MIGRATION_0034));
const q: Q = async (sql, params = []) => (await db.query(sql, params)).rows as Record<string, unknown>[];

for (const c of FAILED_CASES) {
  Deno.test({ name: "pglite: " + c.name, sanitizeResources: false, sanitizeOps: false, fn: async () => {
    await db.exec("begin");
    try {
      const user = crypto.randomUUID();
      await q("insert into auth.users (id) values ($1::uuid)", [user]);
      await c.run({ q, user, tag: "test:" + crypto.randomUUID().slice(0, 8) });
    } finally {
      await db.exec("rollback");
    }
  } });
}
