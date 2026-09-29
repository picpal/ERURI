-- M1-④a 리뷰 수정: restore_discarded 교체(0010).
-- (1) 복구 잡이 항목의 실행 태그를 물려받는다 — idempotency_key 'test:<run>:…' 인 항목의 잡 lease_key 는 'test:<run>:item:<id>'.
--     claim_jobs 의 기본 경로가 'test:%' 를 건너뛰므로 운영 워커가 테스트 복구 잡을 가져가지 않고, 테스트는 deleteRunJobs 로 지운다(AGENTS.md §7).
--     실사용자 항목은 기존과 같이 'item:<id>'.
-- (2) 게이트 폐기 항목은 기한 경과·정리(purge 가 quarantine_until 을 null 로 만든 뒤) 모두 'expired'. 규칙 폐기·empty·이미 복구된 항목은 'not_discarded'.
create or replace function restore_discarded(p_item uuid) returns text language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); r record;
begin
  if v_user is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select i.status, i.gate_label, i.quarantine_until, i.idempotency_key, i.content_enc is not null as has_body into r
  from public.items i where i.id = p_item and i.user_id = v_user for update;
  if not found then return 'not_found'; end if;
  if r.gate_label is null or r.status <> 'discarded:server:' || r.gate_label then return 'not_discarded'; end if;
  if r.quarantine_until is null or r.quarantine_until < now() or not r.has_body then return 'expired'; end if;
  update public.items set status = 'queued', quarantine_until = null where id = p_item and user_id = v_user;
  insert into public.gate_feedback (item_id, user_id, verdict) values (p_item, v_user, 'wrong_discard')
  on conflict (item_id) do update set verdict = 'wrong_discard', at = now();
  insert into public.jobs (kind, user_id, lease_key, payload)
  values ('process', v_user,
          case when r.idempotency_key like 'test:%'
               then split_part(r.idempotency_key, ':', 1) || ':' || split_part(r.idempotency_key, ':', 2) || ':' else '' end
          || 'item:' || p_item,
          jsonb_build_object('item_id', p_item, 'skip_gate', true));
  insert into public.audit_log (user_id, actor, action, target) values (v_user, 'user', 'restore', p_item::text);
  return 'queued';
end $$;

-- 없는 항목이면 조용히 넘어가지 않고 오류(worker_quarantine_item 과 같게, 리뷰 Minor 7). 같은 시그니처라 권한 회수는 유지된다
create or replace function worker_record_gate(p_user uuid, p_item uuid, p_label text, p_confidence real) returns void language plpgsql as $$
begin
  update items set gate_label = p_label, gate_confidence = p_confidence where id = p_item and user_id = p_user;
  if not found then raise exception 'item not found'; end if;
end $$;
