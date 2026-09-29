-- 0b 수정(2026-09-29): 제안 푸시가 조용히 사라지지 않게 한다(스펙 §7 notify, §8 proposal_pushes)

-- 1) 텍스트 process 잡: save_fact 가 items.status = extracted 를 커밋한 뒤 notify enqueue 전에 끊기면 재시도는 already_processed 로 돌아간다.
--    그 항목의 proposed 제안 중 푸시 기록이 하나도 없는 것을 돌려줘 다시 넣게 한다. 중복 잡은 기기별 1회가 막는다
create or replace function worker_unpushed_proposals(p_user uuid, p_item uuid) returns setof uuid language sql stable as $$
  select p.id from proposals p join facts f on f.id = p.fact_id and f.user_id = p_user
  where f.item_id = p_item and p.user_id = p_user and p.status = 'proposed'
    and not exists (select 1 from proposal_pushes pp where pp.proposal_id = p.id);
$$;

-- 2) claim 결과를 셋으로 나눈다: claimed(보낼 차례) / closed(sent·rejected) / in_flight(잡 임대 180초 안의 sending).
--    in_flight 면 잡이 실패로 끝나 재시도한다. 임대가 지난 sending(발송 중 워커 종료)은 다음 시도가 다시 가져간다.
--    예전 기준(5분)은 죽은 잡의 재시도(임대 만료 후 ≤ 1분)보다 길어서 그 시도가 '이미 보냄'으로 끝나 행이 sending 에 남았다
drop function claim_proposal_push(uuid, uuid, text);
create function claim_proposal_push(p_user uuid, p_proposal uuid, p_device text) returns text language plpgsql as $$
declare v uuid; s text;
begin
  if not exists (select 1 from proposals where id = p_proposal and user_id = p_user) then raise exception 'proposal not found'; end if;
  insert into proposal_pushes (user_id, proposal_id, device_id, status) values (p_user, p_proposal, p_device, 'sending')
  on conflict (proposal_id, device_id) do update set status = 'sending', claimed_at = now(), updated_at = now()
    where proposal_pushes.user_id = p_user
      and (proposal_pushes.status = 'failed' or (proposal_pushes.status = 'sending' and proposal_pushes.claimed_at < now() - interval '180 seconds'))
  returning id into v;
  if v is not null then return 'claimed'; end if;
  select status into s from proposal_pushes where proposal_id = p_proposal and device_id = p_device and user_id = p_user;
  return case when s in ('sent', 'rejected') then 'closed' else 'in_flight' end;   -- 모르면 재시도 쪽으로
end $$;

revoke execute on function worker_unpushed_proposals(uuid, uuid), claim_proposal_push(uuid, uuid, text) from public, anon, authenticated;
