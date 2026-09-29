-- 스펙 §9 채팅 날짜 필터(M2-⑧b 리뷰 Important 1 → Ruling D): 필터 기간이 일정·기한 날짜로 채워져도 일정 fact 를 놓치지 않게
-- search_facts 는 event 의 payload start·task 의 due 로 기간을 거르고, 그 값이 없거나 해석할 수 없으면 받은 시각(occurred_at)으로 거른다.
-- 가맹점은 부분 문자열(strpos)로 비교해 필터 LLM 이 준 % _ 가 와일드카드가 되지 않게 한다(리뷰 Minor 5)

-- 추출 파이프라인은 start·due 를 'YYYY-MM-DD' 또는 ISO 8601(+09:00)로 저장한다. 날짜만이면 서울 0시, 오프셋 없는 시각이면 서울 시각
create function fact_when(p_kind text, p_payload jsonb, p_occurred timestamptz) returns timestamptz language plpgsql stable as $$
declare v text := case p_kind when 'event' then p_payload->>'start' when 'task' then p_payload->>'due' end;
begin
  if v ~ '^\d{4}-\d{2}-\d{2}$' then return (v || 'T00:00:00+09:00')::timestamptz; end if;
  if v ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$' then return (v || '+09:00')::timestamptz; end if;
  if v ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}(:?\d{2})?)$' then return v::timestamptz; end if;
  return p_occurred;
exception when others then                                             -- 2026-02-30 같은 값은 받은 시각으로
  return p_occurred;
end $$;

create or replace function search_facts(p_user uuid, p_from timestamptz, p_to timestamptz, p_kinds text[], p_merchant text, p_limit int default 5)
returns table (fact_id uuid, item_id uuid, kind text, payload jsonb, evidence text, occurred_at timestamptz) language sql stable as $$
  select f.id, f.item_id, f.kind, f.payload, f.evidence, i.occurred_at
  from facts f join items i on i.id = f.item_id and i.user_id = p_user
  where f.user_id = p_user and f.status = 'active'
    and (p_merchant is not null or (p_kinds is not null and cardinality(p_kinds) > 0))
    and (p_kinds is null or cardinality(p_kinds) = 0 or f.kind = any (p_kinds))
    and (p_from is null or fact_when(f.kind, f.payload, i.occurred_at) >= p_from)
    and (p_to is null or fact_when(f.kind, f.payload, i.occurred_at) <= p_to)
    and (p_merchant is null or strpos(lower(f.payload->>'merchant'), lower(p_merchant)) > 0)
  order by i.occurred_at desc limit p_limit;
$$;

-- eval_judgments update 도 insert 와 같이 자기 항목만(리뷰 Minor 4: PATCH 로 item_id 를 남의 항목으로 바꾸지 못하게)
drop policy eval_judgments_owner_update on eval_judgments;
create policy eval_judgments_owner_update on eval_judgments for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id and exists (select 1 from items i where i.id = item_id and i.user_id = (select auth.uid())));

revoke execute on function fact_when(text, jsonb, timestamptz), search_facts(uuid, timestamptz, timestamptz, text[], text, int)
  from public, anon, authenticated;
