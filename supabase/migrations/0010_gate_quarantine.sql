-- 스펙 §7 게이트 폐기 7일 격리(1인 사용 기간)·"최근 폐기" 복구·Jev 실데이터 200건 라벨 기록(M1-④ 게이트). 본문은 암호화된 채 둔다
-- 계획 배정은 0007 이었으나 M1-③a 수정이 0007~0009 를 써서 0010(M1-④a)
alter table items add column gate_label text;                  -- Jev 라벨(분류한 항목만, 폐기·통과 모두)
alter table items add column gate_confidence real;
alter table items add column quarantine_until timestamptz;     -- 게이트 폐기 본문 보존 기한(폐기 + 7일). 규칙 폐기는 null(즉시 삭제)
create index items_quarantine on items (quarantine_until) where quarantine_until is not null;

-- 사용자 표시: 오폐기(복구)·오통과(보관함, M2-⑨b). 정확도 집계(gate-report.ts)의 정답
create table gate_feedback (
  item_id uuid primary key references items on delete cascade,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  verdict text not null check (verdict in ('wrong_discard', 'wrong_pass')),
  at timestamptz not null default now()
);
alter table gate_feedback enable row level security;
create policy gate_feedback_owner_read on gate_feedback for select to authenticated using ((select auth.uid()) = user_id);
create policy gate_feedback_owner_insert on gate_feedback for insert to authenticated with check ((select auth.uid()) = user_id
  and exists (select 1 from items i where i.id = item_id and i.user_id = (select auth.uid())));
create policy gate_feedback_owner_delete on gate_feedback for delete to authenticated using ((select auth.uid()) = user_id);
revoke all on gate_feedback from anon;

create or replace function worker_record_gate(p_user uuid, p_item uuid, p_label text, p_confidence real) returns void language sql as $$
  update items set gate_label = p_label, gate_confidence = p_confidence where id = p_item and user_id = p_user;
$$;

-- 게이트 폐기 = 상태 + 7일 격리(본문 유지). 감사 로그에 item_id·사유 코드만
create or replace function worker_quarantine_item(p_user uuid, p_item uuid, p_status text) returns void language plpgsql as $$
begin
  update items set status = p_status, quarantine_until = now() + interval '7 days' where id = p_item and user_id = p_user;
  if not found then raise exception 'item not found'; end if;
  insert into audit_log (user_id, actor, action, target) values (p_user, 'worker', 'discard', p_item::text || ' ' || p_status);
end $$;

-- 사용자 "복구": 게이트 판정을 무시하고 추출로(skip_gate). 오폐기 표시를 남긴다. 사용자는 auth.uid() 로만 정한다
create or replace function restore_discarded(p_item uuid) returns text language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); r record;
begin
  if v_user is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select i.status, i.quarantine_until, i.content_enc is not null as has_body into r
  from public.items i where i.id = p_item and i.user_id = v_user for update;
  if not found then return 'not_found'; end if;
  if r.quarantine_until is null or r.status not like 'discarded:server:%' then return 'not_discarded'; end if;
  if r.quarantine_until < now() or not r.has_body then return 'expired'; end if;
  update public.items set status = 'queued', quarantine_until = null where id = p_item and user_id = v_user;
  insert into public.gate_feedback (item_id, user_id, verdict) values (p_item, v_user, 'wrong_discard')
  on conflict (item_id) do update set verdict = 'wrong_discard', at = now();
  insert into public.jobs (kind, user_id, lease_key, payload)
  values ('process', v_user, 'item:' || p_item, jsonb_build_object('item_id', p_item, 'skip_gate', true));
  insert into public.audit_log (user_id, actor, action, target) values (v_user, 'user', 'restore', p_item::text);
  return 'queued';
end $$;
revoke execute on function restore_discarded(uuid) from public, anon;
grant execute on function restore_discarded(uuid) to authenticated;

-- 격리 기한이 지난 항목의 본문·청크 삭제(행·사유 코드는 유지, 스펙 §8 "폐기 격리 만료"). p_user = 테스트 범위
create or replace function purge_quarantine(p_user uuid default null) returns int language plpgsql as $$
declare n int;
begin
  delete from item_chunks c using items i
  where c.item_id = i.id and i.quarantine_until < now() and (p_user is null or i.user_id = p_user);
  update items set content_enc = null, ocr_text_enc = null, quarantine_until = null
  where quarantine_until < now() and (p_user is null or user_id = p_user);
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function worker_record_gate(uuid, uuid, text, real), worker_quarantine_item(uuid, uuid, text), purge_quarantine(uuid)
  from public, anon, authenticated;
select cron.schedule('purge-quarantine-daily', '23 4 * * *', $$ select purge_quarantine(); $$);
