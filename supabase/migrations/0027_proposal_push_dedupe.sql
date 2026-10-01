-- 스펙 §7 notify 중복(2026-10-01 사용자 결정, 앱 0.9.2): 같은 일정이 다른 경로(문자·메일·공유)로 또 들어오면 제안은 만들되 푸시하지 않는다.
-- 제안을 안 만드는 안은 save_facts(한 트랜잭션·재시도 멱등)에 판정을 넣어야 하고 되돌릴 수 없다(먼저 온 제안을 무시하면 새 정보가 사라진다) — 기각.
-- 여기서는 읽기만 한다: notify 잡이 항목의 일정과 같은 서울 시작 날짜인, 같은 사용자의 다른 항목에서 먼저 생긴 대기(proposed) 일정 제안을 읽고
-- 정규화 제목 비교는 워커(_shared/notify.ts titleKey)가 한다(SQL 문자 클래스는 DB 로캘에 따라 한글 처리가 달라질 수 있다).
-- "먼저" = (proposal.created_at, item_id) 순 — 두 항목의 notify 가 동시에 돌아도 서로를 지우지 않는다(나중 것만 빠진다).
-- 시작의 앞 10자 = 서울 날짜(추출 값은 +09:00 ISO 또는 YYYY-MM-DD 로 정규화, §7). 기존 행·함수는 바꾸지 않는다.
-- 피어는 그 항목에 실제 발송(proposal_pushes status='sent')이 있을 때만 — 이미 알림이 간 일정만 다시 알리지 않는다. 백필·건너뜀으로 푸시가 안 간 제안이
-- 나중 제안의 푸시를 지우면 그 일정은 알림이 한 번도 안 간다. 묶음은 대표 id 로 기록되므로 제안이 아니라 항목 단위로 본다.
-- 피어의 notify 가 아직 안 돌았으면 둘 다 푸시된다(fail-open 방향).
create function worker_pending_event_peers(p_user uuid, p_proposal uuid)
returns table (id uuid, start text, title text) language sql stable as $$
  with lead as (
    select f.item_id, p.created_at from proposals p join facts f on f.id = p.fact_id and f.user_id = p_user
    where p.id = p_proposal and p.user_id = p_user),
  days as (
    select distinct left(p.payload->>'start', 10) as d
    from lead join facts f on f.item_id = lead.item_id and f.user_id = p_user and f.status = 'active'
    join proposals p on p.fact_id = f.id and p.user_id = p_user
    where p.action = 'create_event' and p.payload->>'start' is not null)
  select p.id, p.payload->>'start', p.payload->>'title'
  from lead
  join proposals p on p.user_id = p_user and p.status = 'proposed' and p.action = 'create_event'
  join facts f on f.id = p.fact_id and f.user_id = p_user and f.status = 'active'
  where f.item_id <> lead.item_id
    and (p.created_at, f.item_id) < (lead.created_at, lead.item_id)
    and left(p.payload->>'start', 10) in (select d from days)
    and exists (select 1 from proposal_pushes pp
      join proposals p2 on p2.id = pp.proposal_id and p2.user_id = p_user
      join facts f2 on f2.id = p2.fact_id and f2.user_id = p_user
      where f2.item_id = f.item_id and pp.user_id = p_user and pp.status = 'sent')
  order by p.created_at, p.id
  limit 200;
$$;

revoke execute on function worker_pending_event_peers(uuid, uuid) from public, anon, authenticated;
