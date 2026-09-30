-- 제안 리뷰(Ruling 8', 스펙 §10·§11): 배너 탭 → 제안 시트, 앱 "제안" 탭(대기 제안 목록·추가·무시), 알림 "무시" 액션.
-- 알림을 놓치면 캘린더 등록 수단이 없던 공백(실기기 09-30)을 메운다. 캘린더 추가는 기존 멱등 경로(handleAdd → report_execution)를 그대로 쓴다.
-- 사용자는 auth.uid() 로만 정한다(§4). 쓰기 대상은 자기 proposed 제안의 status 하나뿐

-- 1) 사용자가 무시한 제안: dismissed(과거분사, 기존 succeeded·stale 체계). 푸시(notify: status ≠ proposed 면 건너뜀)·목록·채팅 카드 버튼에서 빠진다
alter table public.proposals drop constraint proposals_status_check,
  add constraint proposals_status_check check (status in ('proposed', 'confirmed', 'succeeded', 'failed', 'stale', 'dismissed'));

-- 2) 대기 제안 목록. 푸시 ADD_EVENT 카테고리와 같은 조건(_shared/notify.ts planProposalPush): create_event · 시각과 오프셋이 있는 start ·
--    uncertain 없음. 날짜만이거나 확인 필요(REVIEW)·할 일은 캘린더에 바로 넣을 수 없어 뺀다(수정 화면은 2단계).
--    title 은 푸시와 같게 40자(넘으면 39자 + …), 없으면 '일정'. end 는 형식이 맞을 때만. 캐스트 오류가 목록 전체를 깨지 않게 정규식으로 거른다
create or replace function list_pending_proposals()
returns table (proposal_id uuid, action text, title text, start timestamptz, "end" timestamptz, location text, version int, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  with p as (   -- case 는 평가 순서를 보장한다: 형식이 맞는 값만 캐스트
    select p.id, p.version, p.created_at, btrim(coalesce(p.payload->>'title', '')) as t,
           case when p.payload->>'start' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$'
                then (p.payload->>'start')::timestamptz end as s,
           case when p.payload->>'end' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$'
                then (p.payload->>'end')::timestamptz end as e,
           nullif(btrim(coalesce(p.payload->>'location', '')), '') as loc
    from public.proposals p
    where p.user_id = auth.uid() and p.status = 'proposed' and p.action = 'create_event'
      and p.created_at > now() - interval '30 days'
      and coalesce(p.payload->'uncertain', '[]'::jsonb) in ('[]'::jsonb, 'null'::jsonb)
  )
  select p.id, 'ADD_EVENT',
         case when p.t = '' then '일정' when char_length(p.t) > 40 then left(p.t, 39) || '…' else p.t end,
         p.s, p.e, p.loc, p.version, p.created_at
  from p
  where p.s > now() - interval '1 hour'
  order by p.s, p.id
  limit 50;
$$;

-- 3) 무시. ok(방금 또는 이미 dismissed — 알림 액션 재전송 멱등) · not_pending(succeeded·stale 등) · not_found(없음·남의 제안)
create or replace function dismiss_proposal(p_proposal uuid) returns text language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_status text;
begin
  if v_user is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select p.status into v_status from public.proposals p where p.id = p_proposal and p.user_id = v_user for update;
  if not found then return 'not_found'; end if;
  if v_status = 'dismissed' then return 'ok'; end if;
  if v_status <> 'proposed' then return 'not_pending'; end if;
  update public.proposals set status = 'dismissed', updated_at = now() where id = p_proposal and user_id = v_user;
  return 'ok';
end $$;

-- 4) 무시한 뒤 다른 경로(다른 기기의 알림·시트)로 실제 추가했으면 추가가 이긴다: dismissed 도 succeeded 로 올린다. 나머지는 0004 그대로
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
  where id = p_proposal and user_id = v_user and status in ('proposed', 'confirmed', 'dismissed');
  return case when p_version <> v_version then 'changed' else 'ok' end;
end $$;

revoke execute on function list_pending_proposals(), dismiss_proposal(uuid) from public, anon;
grant execute on function list_pending_proposals(), dismiss_proposal(uuid) to authenticated;
