-- 스펙 §8 executions·§10 순서 4: 기기가 EventKit 쓰기 성공 직후 보고한다. 앱(사용자 JWT)이 report_execution RPC 를 부른다
create table executions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  proposal_id uuid not null references proposals on delete cascade,
  device_id text not null,
  eventkit_id text not null,
  version int not null,
  executed_at timestamptz not null,
  reported_at timestamptz not null default now(),
  unique (proposal_id)
);
alter table executions enable row level security;
create policy executions_owner_read on executions for select to authenticated using ((select auth.uid()) = user_id);
revoke all on executions from anon;

-- 반환: ok(처음 기록·재전송) · changed(기기가 실행한 version ≠ 서버 최신, §10 순서 5) · stale · not_found(없음·남의 제안).
-- 사용자는 auth.uid() 로만 정한다(클라이언트가 보낸 user_id 를 믿지 않는다, §4)
create or replace function report_execution(p_proposal uuid, p_device text, p_eventkit_id text, p_version int, p_executed_at timestamptz)
returns text language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_status text; v_version int;
begin
  if v_user is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select p.status, p.version into v_status, v_version from public.proposals p where p.id = p_proposal and p.user_id = v_user for update;
  if not found then return 'not_found'; end if;
  insert into public.executions (user_id, proposal_id, device_id, eventkit_id, version, executed_at)
  values (v_user, p_proposal, left(p_device, 100), left(p_eventkit_id, 200), p_version, p_executed_at)
  on conflict (proposal_id) do nothing;
  if v_status = 'stale' then return 'stale'; end if;
  update public.proposals set status = 'succeeded', eventkit_id = left(p_eventkit_id, 200), updated_at = now()
  where id = p_proposal and user_id = v_user and status in ('proposed', 'confirmed');
  return case when p_version <> v_version then 'changed' else 'ok' end;
end $$;
revoke execute on function report_execution(uuid, text, text, int, timestamptz) from public, anon;
grant execute on function report_execution(uuid, text, text, int, timestamptz) to authenticated;

-- 푸시 페이로드에 version 을 싣는다. 반환 열이 바뀌므로 지우고 다시 만든다
drop function worker_get_proposal(uuid, uuid);
create function worker_get_proposal(p_user uuid, p_proposal uuid)
returns table (id uuid, action text, payload jsonb, status text, version int, occurred_at timestamptz, captured_at timestamptz)
language sql stable as $$
  select p.id, p.action, p.payload, p.status, p.version, i.occurred_at, i.captured_at
  from proposals p join facts f on f.id = p.fact_id and f.user_id = p_user
  left join items i on i.id = f.item_id and i.user_id = p_user
  where p.id = p_proposal and p.user_id = p_user;
$$;
revoke execute on function worker_get_proposal(uuid, uuid) from public, anon, authenticated;
