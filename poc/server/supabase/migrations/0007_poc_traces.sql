-- PoC 전용: 실기기 세션 관찰값(이벤트 이름·메타 필드만, 본문 없음). 1단계 제품 스키마에서는 이 테이블을 drop 한다.
-- 쓰기 경로: Edge ingest /trace가 사용자 JWT로 insert(아래 RLS). 조회: 사용자 본인 또는 scripts/sql.ts(운영자)
create table poc_traces (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  device_id text not null,
  event text not null,
  fields jsonb not null default '{}',
  at timestamptz not null,
  received_at timestamptz not null default now()
);
create index poc_traces_user_at on poc_traces (user_id, at);
alter table poc_traces enable row level security;
create policy poc_traces_owner_insert on poc_traces for insert to authenticated with check ((select auth.uid()) = user_id);
create policy poc_traces_owner_read on poc_traces for select to authenticated using ((select auth.uid()) = user_id);
revoke all on poc_traces from anon;
