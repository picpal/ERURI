-- 제품 진단 trace(스펙 §8 device_traces): PoC poc_traces(0007·0015)의 제품판. 이벤트 이름·메타 필드만, 본문 없음, 30일 보관.
-- 쓰기: Edge ingest /trace 가 사용자 JWT 로 upsert(RLS). 앱의 "진단 전송" 토글(기본 켜짐)이 꺼지면 기기가 보내지 않는다.
-- 지인 확대(3단계) 때 앱 기본값만 끈다. 다른 테이블 의존은 없지만 ingest /trace 가 쓰므로 되돌리지 않는다(스펙 §11)
create table device_traces (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  device_id text not null,
  event text not null,
  fields jsonb not null default '{}',
  at timestamptz not null,
  received_at timestamptz not null default now()
);
-- 기기 재전송 멱등(스펙 §6 trace 멱등): 같은 (user_id, device_id, event, at)는 한 행
create unique index device_traces_idem on device_traces (user_id, device_id, event, at);
create index device_traces_user_at on device_traces (user_id, at);
alter table device_traces enable row level security;
create policy device_traces_owner_insert on device_traces for insert to authenticated with check ((select auth.uid()) = user_id);
create policy device_traces_owner_read on device_traces for select to authenticated using ((select auth.uid()) = user_id);
revoke all on device_traces from anon;

select cron.schedule('device-traces-30d', '41 3 * * *', $$ delete from device_traces where received_at < now() - interval '30 days' $$);
