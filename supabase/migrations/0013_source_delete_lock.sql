-- M2-⑥a 리뷰 #1: Gmail 출처 삭제 직후 진행 중인 gmail-fetch 가 항목을 되살리는 창을 닫는다(스펙 §8 출처 삭제, §12 통제 5)
--  (a) delete_gmail_source 가 연결 행을 for update 로 잠그고, insert_item(GMAIL) 은 사용자 gmail 연결을 for key share 로 확인한다
--      → 두 트랜잭션이 직렬화된다. 삭제가 먼저 커밋되면 insert 는 연결을 못 찾아 null, insert 가 먼저면 삭제가 그 항목까지 지운다
--  (b) 연결이 이미 없어도(p_connection null) 사용자 Gmail 항목·잡 삭제를 수행한다 → 버튼 재시도로 항상 복구 가능

-- 시그니처는 0005 그대로(create or replace). GMAIL 이외 출처는 바뀌지 않는다
create or replace function insert_item(p_user uuid, p_source text, p_idempotency_key text, p_sender text, p_title text,
                                       p_content_enc bytea, p_occurred_at timestamptz, p_enqueue boolean default true,
                                       p_app_name text default null, p_ocr_text_enc bytea default null, p_device_filter text default null,
                                       p_backfill boolean default false)
returns uuid language plpgsql as $$
declare v_id uuid;
begin
  if p_source = 'GMAIL' then
    perform 1 from connections where user_id = p_user and provider = 'gmail' and status <> 'disconnected' for key share;
    if not found then return null; end if;   -- 출처 삭제됨(또는 연결 없음): 저장하지 않는다
  end if;
  insert into items (user_id, source, app_name, sender, title, content_enc, ocr_text_enc, occurred_at, idempotency_key, device_filter)
  values (p_user, p_source, p_app_name, p_sender, p_title, p_content_enc, p_ocr_text_enc, p_occurred_at, p_idempotency_key, p_device_filter)
  on conflict (user_id, idempotency_key) do nothing
  returning id into v_id;
  if v_id is not null and p_enqueue then
    insert into jobs (kind, user_id, lease_key, payload)
    values ('process', p_user, case when p_backfill then 'backfill:' || p_user else 'item:' || v_id end,
            jsonb_build_object('item_id', v_id) || case when p_backfill then '{"backfill": true}'::jsonb else '{}'::jsonb end);
  end if;
  return v_id;                            -- 중복·연결 없음이면 null
end $$;

-- 삭제 범위는 연결이 아니라 **사용자의 Gmail 항목 전부**(items 에 connection_id 가 없다. 1단계 1인·1연결, 다중 계정 전 items.connection_id 도입 — 계획서)
-- p_connection: 그 연결과 연결 잡을 함께 지운다. null: 남은 gmail 연결 전부와 gmail-* 잡(연결이 이미 없을 때의 재시도 경로)
drop function delete_gmail_source(uuid, uuid);
create function delete_gmail_source(p_user uuid, p_connection uuid default null) returns jsonb language plpgsql as $$
declare v_conns uuid[]; v_items uuid[]; n_items int; n_facts int; n_jobs int;
begin
  -- 연결 행을 먼저 잠근다: 진행 중인 insert_item(GMAIL)이 끝나길 기다리고, 이후 insert 는 이 트랜잭션 커밋 뒤 연결을 못 찾는다
  select coalesce(array_agg(id), '{}') into v_conns from (
    select id from connections where user_id = p_user and provider = 'gmail' and (p_connection is null or id = p_connection)
    for update) c;
  if p_connection is not null and cardinality(v_conns) = 0 then
    raise exception 'connection not found' using errcode = 'P0002';
  end if;
  select coalesce(array_agg(id), '{}') into v_items from items where user_id = p_user and source = 'GMAIL';
  -- payload 값은 텍스트로 비교한다(다른 잡의 payload 에 uuid 가 아닌 값이 있어도 캐스트 오류가 나지 않게)
  -- 연결 잡은 kind 와 무관하게 payload.connection_id 로 잡는다(sync·fetch·watch·reauth, 테스트 태그가 붙은 lease_key 포함)
  delete from jobs j where j.user_id = p_user and (
       j.lease_key = any (select 'gmail:' || c from unnest(v_conns) c)
    or j.payload->>'connection_id' = any (v_conns::text[])
    or (p_connection is null and j.kind like 'gmail-%')
    or (j.payload->>'item_id' = any (v_items::text[]))
    or (j.kind = 'notify' and j.payload->>'proposal_id' in
          (select p.id::text from proposals p join facts f on f.id = p.fact_id where f.user_id = p_user and f.item_id = any (v_items))));
  get diagnostics n_jobs = row_count;
  -- 남는 fact 가 지울 fact 를 supersedes_id 로 가리키면 FK(no action)에 막힌다. 정정 연결만 끊는다(정정은 2단계, Ruling 7)
  update facts set supersedes_id = null where user_id = p_user and supersedes_id in
    (select id from facts where user_id = p_user and item_id = any (v_items));
  delete from facts where user_id = p_user and item_id = any (v_items);
  get diagnostics n_facts = row_count;
  delete from items where user_id = p_user and id = any (v_items);
  get diagnostics n_items = row_count;
  delete from connections where user_id = p_user and id = any (v_conns);
  insert into audit_log (user_id, actor, action, target) values (p_user, 'user', 'source_delete', 'gmail items=' || n_items);
  return jsonb_build_object('items', n_items, 'facts', n_facts, 'jobs', n_jobs);
end $$;

revoke execute on function insert_item(uuid, text, text, text, text, bytea, timestamptz, boolean, text, bytea, text, boolean),
  delete_gmail_source(uuid, uuid) from public, anon, authenticated;
