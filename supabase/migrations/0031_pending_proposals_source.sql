-- 제안 카드 출처 버튼(2026-10-07 사용자 요청, 앱 0.14.0, 스펙 §10 대기 목록 출처 열·§11). 적용은 M10 에서 0030 다음 — 측정 중 적용 금지.
-- 그때까지 supabase/migrations-pending/ 에 둔다(0030 과 같은 이유: 다른 계획의 db push 에 딸려 가지 않게).
--
-- 0026 의 행에 그 제안을 만든 항목의 item_id·source·app_name 을 더한다(제안 → fact → 본인 item). 앱은 카드 오른쪽 출처 버튼으로 항목 상세를 연다.
-- 본문·제목·발신자는 더하지 않는다 — 보관함 목록과 같은 메타데이터. fact 의 item_id 가 없거나 다른 사용자의 항목이면 세 열 모두 null(제안 행은 그대로).
-- 그 밖(필터·형식·정렬·50행·권한·security definer·search_path)은 0026 그대로. 옛 앱은 모르는 키를 버리고(JSONDecoder), 새 앱은 열이 없으면(옛 서버) 버튼을 숨긴다.
-- 반환 열이 바뀌어 create or replace 가 안 된다 — drop 후 다시 만들고 권한을 다시 건다
drop function if exists public.list_pending_proposals();

create function public.list_pending_proposals()
returns table (proposal_id uuid, action text, title text, start text, "end" text, all_day boolean, location text, version int, created_at timestamptz,
               item_id uuid, source text, app_name text)
language sql stable security definer set search_path = '' as $$
  with p as (
    select p.id, p.version, p.created_at, btrim(coalesce(p.payload->>'title', '')) as t,
           p.payload->>'start' as rs, p.payload->>'end' as re,
           nullif(btrim(coalesce(p.payload->>'location', '')), '') as loc,
           i.id as iid, i.source as isrc, i.app_name as iapp
    from public.proposals p
    left join public.facts f on f.id = p.fact_id and f.user_id = p.user_id
    left join public.items i on i.id = f.item_id and i.user_id = p.user_id
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
         w.loc, w.version, w.created_at,
         w.iid, w.isrc, w.iapp
  from w
  order by w.sort_at, w.id
  limit 50;
$$;

revoke execute on function public.list_pending_proposals() from public, anon;
grant execute on function public.list_pending_proposals() to authenticated;
