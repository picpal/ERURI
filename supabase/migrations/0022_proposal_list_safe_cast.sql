-- 제안 목록 행 단위 안전 변환(제안 리뷰 서버 리뷰 Minor 1). 0021 정규식은 형식만 보므로 13월·30일·시 24 이상·±16시간 넘는 오프셋 같은
-- 달력상 불가능한 값이 통과해 ::timestamptz 가 22008 을 내고 목록 전체(다른 사용자 행이 먼저 평가되면 모든 사용자)가 실패했다.
-- pg_input_is_valid(PG 16+, 제품 PG 17)로 캐스트 가능한 값만 캐스트한다. 형식 정규식(시각·오프셋 필수)은 푸시 ADD_EVENT 조건이라 그대로 둔다.
-- start 가 변환되지 않는 행은 목록에서 빠지고(where p.s > …), end 만 나쁘면 end = null 로 남는다. 나머지는 0021 그대로
create or replace function list_pending_proposals()
returns table (proposal_id uuid, action text, title text, start timestamptz, "end" timestamptz, location text, version int, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  with p as (   -- case 는 평가 순서를 보장한다: 형식이 맞고 캐스트 가능한 값만 캐스트
    select p.id, p.version, p.created_at, btrim(coalesce(p.payload->>'title', '')) as t,
           case when p.payload->>'start' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$'
                 and pg_input_is_valid(p.payload->>'start', 'timestamptz')
                then (p.payload->>'start')::timestamptz end as s,
           case when p.payload->>'end' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$'
                 and pg_input_is_valid(p.payload->>'end', 'timestamptz')
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

revoke execute on function list_pending_proposals() from public, anon;
grant execute on function list_pending_proposals() to authenticated;
