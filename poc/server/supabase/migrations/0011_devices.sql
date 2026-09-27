-- 기기 APNs 토큰·환경(스펙 §8 devices). 개발 서명 = sandbox 토큰, TestFlight·App Store = production 토큰이라 기기별로 저장한다.
-- 쓰기: Edge ingest /device가 사용자 JWT로 upsert(아래 RLS). 발송: apns-send·notify가 service role로 user_id를 명시해 조회
create table devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  device_id text not null,
  apns_token text not null,
  apns_env text not null check (apns_env in ('sandbox', 'production')),
  build text,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (user_id, device_id)
);
alter table devices enable row level security;
create policy devices_owner_read on devices for select to authenticated using ((select auth.uid()) = user_id);
create policy devices_owner_insert on devices for insert to authenticated with check ((select auth.uid()) = user_id);
create policy devices_owner_update on devices for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
revoke all on devices from anon;
