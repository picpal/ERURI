-- 스펙 §7 저장·notify, §8 facts (2026-10-01 사용자 결정, 앱 0.9.0): 한 항목에서 event 최대 5개, 알림은 항목당 1개.
-- 기존 행 값은 바꾸지 않는다(상수 기본값 열 추가는 행을 고쳐 쓰지 않는다, update 없음). 배포된 옛 워커는 save_fact(래퍼)·
-- worker_unpushed_proposals·worker_get_proposal 을 그대로 부른다(시그니처 불변).

alter table facts add column ordinal smallint not null default 0 check (ordinal between 0 and 4);
create unique index facts_one_active_per_item_ordinal on facts (item_id, kind, ordinal) where status = 'active';
drop index facts_one_active_per_item;   -- (item_id, kind) — 기존 행은 모두 ordinal 0 이라 새 색인이 같은 유일성을 이어받는다

-- 한 항목의 fact 전부를 한 트랜잭션으로(일부만 저장된 채 extracted 가 되면 재시도가 나머지를 다시 뽑지 않는다).
-- p_entries = [{payload, evidence}] — 배열 순서가 순번. event 1~5개, 그 밖의 종류는 1개. 잘못되면 아무것도 저장하지 않고 오류.
-- 같은 항목·종류·순번의 active fact 가 있으면(재시도) 새로 만들지 않고 기존 id 를 돌려준다
create function save_facts(p_user uuid, p_item uuid, p_kind text, p_entries jsonb, p_action text)
returns table (out_ordinal int, out_fact_id uuid, out_proposal_id uuid, out_created boolean) language plpgsql as $$
declare r record; v_fact uuid; v_prop uuid; v_created boolean; n int;
begin
  if p_action is not null and p_action not in ('create_event', 'create_reminder') then raise exception 'bad action'; end if;
  n := coalesce(jsonb_array_length(p_entries), 0);
  if n < 1 or n > 5 or (p_kind <> 'event' and n > 1) then raise exception 'bad entries'; end if;
  -- jsonb 'null'·스칼라 payload 는 not null 을 통과하므로 따로 막는다(purchase 는 제안 insert 가 없어 그대로 저장될 수 있다)
  if exists (select 1 from jsonb_array_elements(p_entries) e where jsonb_typeof(e->'payload') is distinct from 'object') then raise exception 'bad entries'; end if;
  if not exists (select 1 from items i where i.id = p_item and i.user_id = p_user) then raise exception 'item not found'; end if;
  for r in select x.value as entry, (x.ord - 1)::int as ord from jsonb_array_elements(p_entries) with ordinality as x(value, ord) loop
    v_fact := null; v_prop := null; v_created := true;
    insert into facts (user_id, item_id, kind, ordinal, payload, evidence)
    values (p_user, p_item, p_kind, r.ord, r.entry->'payload', left(r.entry->>'evidence', 300))
    on conflict (item_id, kind, ordinal) where status = 'active' do nothing
    returning id into v_fact;
    if v_fact is null then
      v_created := false;
      select f.id into v_fact from facts f
      where f.item_id = p_item and f.kind = p_kind and f.ordinal = r.ord and f.status = 'active' and f.user_id = p_user;
      select p.id into v_prop from proposals p where p.fact_id = v_fact and p.user_id = p_user order by p.version desc limit 1;
    elsif p_action is not null then
      insert into proposals (user_id, fact_id, action, payload, idempotency_key)
      values (p_user, v_fact, p_action, (r.entry->'payload') - 'via', 'proposal:' || v_fact || ':v1')
      returning id into v_prop;
    end if;
    out_ordinal := r.ord; out_fact_id := v_fact; out_proposal_id := v_prop; out_created := v_created;
    return next;
  end loop;
  update items set status = 'extracted' where id = p_item and user_id = p_user and status = 'queued';
end $$;

-- 이미지 경로·옛 워커용 1건 판(시그니처 그대로)
create or replace function save_fact(p_user uuid, p_item uuid, p_kind text, p_payload jsonb, p_evidence text, p_action text)
returns table (out_fact_id uuid, out_proposal_id uuid, out_created boolean) language sql as $$
  select s.out_fact_id, s.out_proposal_id, s.out_created
  from save_facts(p_user, p_item, p_kind, jsonb_build_array(jsonb_build_object('payload', p_payload, 'evidence', p_evidence)), p_action) s;
$$;

-- 재시도 복구(0016 → 묶음): 그 항목의 대표 제안(순번이 가장 작은 active fact 의 최신 제안)에 푸시 기록이 없으면 그 하나만
create or replace function worker_unpushed_proposals(p_user uuid, p_item uuid) returns setof uuid language sql stable as $$
  select lead.id from (
    select p.id from proposals p join facts f on f.id = p.fact_id and f.user_id = p_user
    where f.item_id = p_item and p.user_id = p_user and f.status = 'active'
    order by f.ordinal, p.version desc limit 1) lead
  where exists (select 1 from proposals p2 join facts f2 on f2.id = p2.fact_id and f2.user_id = p_user
                where f2.item_id = p_item and p2.user_id = p_user and p2.status = 'proposed')
    and not exists (select 1 from proposal_pushes pp where pp.proposal_id = lead.id);
$$;

-- 묶음 알림(§7 notify): 주어진 제안과 같은 항목·같은 종류의 active fact 마다 최신 제안, 순번 순. 남의 제안이면 빈 결과
create function worker_get_proposal_bundle(p_user uuid, p_proposal uuid)
returns table (id uuid, action text, payload jsonb, status text, version int, occurred_at timestamptz, captured_at timestamptz, ordinal smallint)
language sql stable as $$
  with lead as (
    select f.item_id, f.kind from proposals p join facts f on f.id = p.fact_id and f.user_id = p_user
    where p.id = p_proposal and p.user_id = p_user)
  select distinct on (f.ordinal) p.id, p.action, p.payload, p.status, p.version, i.occurred_at, i.captured_at, f.ordinal
  from lead join facts f on f.item_id = lead.item_id and f.kind = lead.kind and f.user_id = p_user and f.status = 'active'
  join proposals p on p.fact_id = f.id and p.user_id = p_user
  left join items i on i.id = f.item_id and i.user_id = p_user
  order by f.ordinal, p.version desc;
$$;

revoke execute on function save_facts(uuid, uuid, text, jsonb, text), save_fact(uuid, uuid, text, jsonb, text, text),
  worker_unpushed_proposals(uuid, uuid), worker_get_proposal_bundle(uuid, uuid) from public, anon, authenticated;
