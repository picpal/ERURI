-- 스펙 §9 facts(2026-10-01 검색·캘린더 계획 리뷰, Codex #1·Fable N2): 받은 기간과 일정 기간을 SQL 에서 섞지 않는다.
-- 0019 는 p_from/p_to 를 fact_when(event=start·task=due)에 걸어 "9월에 받은 예약"이 9월 시작 일정으로 걸러졌고,
-- 두 기간을 함께 줄 수 없었으며, 혼합 kinds 에서 구매에도 일정 기간이 걸렸다.
-- p_from/p_to = 항상 받은 시각(items.occurred_at). p_event_from/p_event_to = event·task 행에만 fact_when. 그 밖의 종류는 일정 기간을 무시한다.
-- 일정 기간이 있으면 시작 순(가까운 일정이 늦게 받았다고 빠지지 않게), 없으면 받은 시각 역순(0019 그대로).
-- 오버로드를 남기지 않게 옛 6인자 함수를 지우고 만든다. fact_when(0019)은 그대로.
drop function search_facts(uuid, timestamptz, timestamptz, text[], text, int);
create function search_facts(p_user uuid, p_from timestamptz, p_to timestamptz, p_kinds text[], p_merchant text, p_limit int default 5,
                             p_event_from timestamptz default null, p_event_to timestamptz default null)
returns table (fact_id uuid, item_id uuid, kind text, payload jsonb, evidence text, occurred_at timestamptz) language sql stable as $$
  select f.id, f.item_id, f.kind, f.payload, f.evidence, i.occurred_at
  from facts f join items i on i.id = f.item_id and i.user_id = p_user
  where f.user_id = p_user and f.status = 'active'
    and (p_merchant is not null or (p_kinds is not null and cardinality(p_kinds) > 0))
    and (p_kinds is null or cardinality(p_kinds) = 0 or f.kind = any (p_kinds))
    and (p_from is null or i.occurred_at >= p_from) and (p_to is null or i.occurred_at <= p_to)
    and (f.kind not in ('event', 'task') or p_event_from is null or fact_when(f.kind, f.payload, i.occurred_at) >= p_event_from)
    and (f.kind not in ('event', 'task') or p_event_to is null or fact_when(f.kind, f.payload, i.occurred_at) <= p_event_to)
    and (p_merchant is null or strpos(lower(f.payload->>'merchant'), lower(p_merchant)) > 0)
  order by case when p_event_from is not null or p_event_to is not null then fact_when(f.kind, f.payload, i.occurred_at) end asc nulls last,
           i.occurred_at desc
  limit p_limit;
$$;

revoke execute on function search_facts(uuid, timestamptz, timestamptz, text[], text, int, timestamptz, timestamptz) from public, anon, authenticated;
