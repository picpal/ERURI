-- 0b(2026-09-29): 텍스트 process 잡의 저장 경로. 이미지(extract)와 텍스트(process)가 같은 save_fact 를 쓴다(스펙 §7 저장).
-- 쓰기는 모두 service role(worker) RPC, 모든 쿼리에 user_id 를 명시한다(§12 통제 4). 사용자는 facts·proposals 자기 행 읽기만(0012).

-- fact 1건 + event→create_event, task→create_reminder 제안 + items.status='extracted'.
-- 같은 항목·같은 종류의 active fact 가 있으면(재시도) 새로 만들지 않고 기존 id 를 돌려주며 status 만 맞춘다
create or replace function save_fact(p_user uuid, p_item uuid, p_kind text, p_payload jsonb, p_evidence text, p_action text)
returns table (out_fact_id uuid, out_proposal_id uuid, out_created boolean) language plpgsql as $$
declare v_fact uuid; v_prop uuid; v_created boolean := true;
begin
  if p_action is not null and p_action not in ('create_event', 'create_reminder') then raise exception 'bad action'; end if;
  if not exists (select 1 from items i where i.id = p_item and i.user_id = p_user) then raise exception 'item not found'; end if;
  insert into facts (user_id, item_id, kind, payload, evidence) values (p_user, p_item, p_kind, p_payload, left(p_evidence, 300))
  on conflict (item_id, kind) where status = 'active' do nothing
  returning id into v_fact;
  if v_fact is null then
    v_created := false;
    select f.id into v_fact from facts f where f.item_id = p_item and f.kind = p_kind and f.status = 'active' and f.user_id = p_user;
    select p.id into v_prop from proposals p where p.fact_id = v_fact and p.user_id = p_user order by p.version desc limit 1;
  elsif p_action is not null then
    insert into proposals (user_id, fact_id, action, payload, idempotency_key)
    values (p_user, v_fact, p_action, p_payload - 'via', 'proposal:' || v_fact || ':v1')
    returning id into v_prop;
  end if;
  update items set status = 'extracted' where id = p_item and user_id = p_user and status = 'queued';
  return query select v_fact, v_prop, v_created;
end $$;

-- 처리 결과 상태. p_wipe 면 암호문을 지우고(폐기 판정, §12 통제 2) 감사 로그에 item_id·사유 코드만 남긴다
create or replace function worker_set_item_status(p_user uuid, p_item uuid, p_status text, p_wipe boolean default false)
returns void language plpgsql as $$
begin
  update items set status = p_status,
                   content_enc = case when p_wipe then null else content_enc end,
                   ocr_text_enc = case when p_wipe then null else ocr_text_enc end
  where id = p_item and user_id = p_user;
  if not found then raise exception 'item not found'; end if;
  if p_wipe then
    insert into audit_log (user_id, actor, action, target) values (p_user, 'worker', 'discard', p_item::text || ' ' || p_status);
  end if;
end $$;

-- 텍스트 항목 + 메타. worker_get_item 과 같은 소유 조건(§12 통제 4(b)). 이미 처리된 항목(status ≠ queued)은 암호문 없이 돌려준다
-- (재시도가 복호화·모델 호출 없이 끝나게). 암호문을 줄 때만 복호화 감사를 남긴다
create or replace function worker_get_text_item(p_user uuid, p_item uuid)
returns table (content_enc bytea, source text, app_name text, sender text, title text, occurred_at timestamptz, captured_at timestamptz, status text)
language plpgsql as $$
#variable_conflict use_column
declare r record;
begin
  select i.content_enc as enc, i.source as src, i.app_name as app, i.sender as snd, i.title as ttl, i.occurred_at as occ,
         i.captured_at as cap, i.status as st
  into r from items i join user_keys k on k.user_id = i.user_id where i.id = p_item and i.user_id = p_user;
  if not found then return; end if;
  if r.st <> 'queued' then
    return query select null::bytea, r.src, r.app, r.snd, r.ttl, r.occ, r.cap, r.st;
    return;
  end if;
  if r.enc is not null then
    insert into audit_log (user_id, actor, action, target) values (p_user, 'worker', 'decrypt', p_item::text);
  end if;
  return query select r.enc, r.src, r.app, r.snd, r.ttl, r.occ, r.cap, r.st;
end $$;

drop function if exists save_event_fact(uuid, uuid, jsonb);   -- save_fact 로 대체(이미지 경로도 공용 함수 사용)

revoke execute on function save_fact(uuid, uuid, text, jsonb, text, text), worker_set_item_status(uuid, uuid, text, boolean),
  worker_get_text_item(uuid, uuid) from public, anon, authenticated;
