-- 날짜만 있는 일정 제안 = 종일 일정(0.9.1, 2026-10-01 실기기 · 사용자 결정 A, 스펙 §10). 푸시는 이미 갔는데(REVIEW) 목록은 시각 있는 start 만 보여
-- 제안 탭·묶음 시트·채팅 카드 어디에서도 처리할 수 없었다. 날짜만(YYYY-MM-DD)이고 uncertain 이 없으면 목록에 넣고 all_day = true 로 알린다.
--
-- 반환 형식(계약, §10 대기 목록):
--   start·end 는 text. 시각 있는 일정은 서울 ISO `YYYY-MM-DDTHH:MI:SS+09:00`(0.9.0 앱의 ISO8601DateFormatter 가 그대로 읽는다),
--   종일은 `YYYY-MM-DD`(서울 날짜). 종일 end 는 마지막 날 — 시작 다음 날 이후일 때만, 아니면 null(그날 하루).
--   시각 있는 end 의 서울 날짜도 종일 end 로 받는다. 시각 있는 일정의 end 는 0021·0022 그대로(형식·캐스트가 맞을 때만).
--   0.9.0 앱은 all_day 를 모르는 키로 버리고(JSONDecoder), 날짜만 start 는 파서가 못 읽어 추가 버튼 없이 날짜만 보인다(무시는 된다) — 잘못된 0시 일정이 생기지 않는다.
-- 필터: 시각 있는 일정은 start > 지금−1시간(그대로), 종일은 그 날짜(서울)가 아직 끝나지 않음(start 날짜 ≥ 오늘). 정렬: 종일은 그날 서울 0시로 본 시작 순, 같으면 id.
-- 반환 열이 바뀌어(start·end 형식, all_day 추가) create or replace 가 안 된다 — drop 후 다시 만들고 권한을 다시 건다
drop function if exists public.list_pending_proposals();

create function public.list_pending_proposals()
returns table (proposal_id uuid, action text, title text, start text, "end" text, all_day boolean, location text, version int, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  with p as (
    select p.id, p.version, p.created_at, btrim(coalesce(p.payload->>'title', '')) as t,
           p.payload->>'start' as rs, p.payload->>'end' as re,
           nullif(btrim(coalesce(p.payload->>'location', '')), '') as loc
    from public.proposals p
    where p.user_id = auth.uid() and p.status = 'proposed' and p.action = 'create_event'
      and p.created_at > now() - interval '30 days'
      and coalesce(p.payload->'uncertain', '[]'::jsonb) in ('[]'::jsonb, 'null'::jsonb)
  ), v as (   -- case 는 평가 순서를 보장한다: 형식이 맞고 캐스트 가능한 값만 캐스트(0022)
    select p.*,
           case when p.rs ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$'
                 and pg_input_is_valid(p.rs, 'timestamptz')
                then p.rs::timestamptz end as s,
           case when p.rs ~ '^\d{4}-\d{2}-\d{2}$' and pg_input_is_valid(p.rs, 'date') then p.rs::date end as sd,
           case when p.re ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$'
                 and pg_input_is_valid(p.re, 'timestamptz')
                then p.re::timestamptz end as e,
           case when p.re ~ '^\d{4}-\d{2}-\d{2}$' and pg_input_is_valid(p.re, 'date') then p.re::date end as ed
    from p
  ), w as (
    select v.*,
           coalesce(v.s, v.sd::timestamp at time zone 'Asia/Seoul') as sort_at,
           case when v.sd is not null then coalesce(v.ed, (v.e at time zone 'Asia/Seoul')::date) end as last_day
    from v
    where (v.s is not null and v.s > now() - interval '1 hour')
       or (v.sd is not null and v.sd >= (now() at time zone 'Asia/Seoul')::date)
  )
  select w.id, 'ADD_EVENT',
         case when w.t = '' then '일정' when char_length(w.t) > 40 then left(w.t, 39) || '…' else w.t end,
         case when w.s is not null then to_char(w.s at time zone 'Asia/Seoul', 'YYYY-MM-DD"T"HH24:MI:SS') || '+09:00'
              else to_char(w.sd, 'YYYY-MM-DD') end,
         case when w.s is not null then to_char(w.e at time zone 'Asia/Seoul', 'YYYY-MM-DD"T"HH24:MI:SS') || '+09:00'
              when w.last_day > w.sd then to_char(w.last_day, 'YYYY-MM-DD') end,
         w.s is null,
         w.loc, w.version, w.created_at
  from w
  order by w.sort_at, w.id
  limit 50;
$$;

revoke execute on function public.list_pending_proposals() from public, anon;
grant execute on function public.list_pending_proposals() to authenticated;
