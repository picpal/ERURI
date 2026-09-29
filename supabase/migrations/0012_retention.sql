-- 스펙 §8 삭제·만료 정책(두 가지 분리)·§12 통제 5(1단계: 전체 삭제·출처 삭제 버튼). 쓰기는 service role RPC, 모든 쿼리에 user_id 명시
-- 계획 배정은 0008 이었으나 M1-③a·④a 수정이 0007~0011 을 써서 0012(M2-⑥a, 원장 Ruling M#)

-- 1) 원문 만료: expires_at 지난 항목의 본문·OCR·청크 행 전체. 행·facts·proposals 는 남긴다. Storage 객체는 purge-media 잡(워커)
create or replace function purge_expired(p_user uuid default null) returns int language plpgsql as $$
declare n int;
begin
  delete from item_chunks c using items i where c.item_id = i.id and i.expires_at < now() and (p_user is null or i.user_id = p_user);
  update items set content_enc = null, ocr_text_enc = null
  where expires_at < now() and (content_enc is not null or ocr_text_enc is not null) and (p_user is null or user_id = p_user);
  get diagnostics n = row_count;
  return n;
end $$;

-- 이미지·PDF 는 30일(§2·§8). 파일 경로 자체는 2단계지만 만료 규칙은 여기서 맞춘다
create or replace function insert_media_item(p_user uuid, p_source text, p_idempotency_key text, p_storage_key text,
                                             p_ocr_text_enc bytea, p_occurred_at timestamptz, p_lease_key text default null)
returns uuid language plpgsql as $$
declare v_id uuid;
begin
  insert into items (user_id, source, storage_key, ocr_text_enc, occurred_at, idempotency_key, expires_at)
  values (p_user, p_source, p_storage_key, p_ocr_text_enc, p_occurred_at, p_idempotency_key, now() + interval '30 days')
  on conflict (user_id, idempotency_key) do nothing
  returning id into v_id;
  if v_id is not null then
    insert into jobs (kind, user_id, lease_key, payload)
    values ('extract', p_user, coalesce(p_lease_key, 'item:' || v_id), jsonb_build_object('item_id', v_id));
  end if;
  return v_id;
end $$;

create or replace function worker_expired_media(p_limit int default 100)
returns table (user_id uuid, item_id uuid, storage_key text) language sql stable as $$
  select i.user_id, i.id, i.storage_key from items i where i.storage_key is not null and i.expires_at < now() order by i.expires_at limit p_limit;
$$;
create or replace function worker_clear_storage_key(p_user uuid, p_item uuid) returns void language sql as $$
  update items set storage_key = null where id = p_item and user_id = p_user;
$$;

-- 2) 출처 삭제(Gmail): 잡 먼저(대기 중인 fetch·백필·process·notify 가 항목을 되살리지 않게) → facts(proposals·pushes·executions cascade)
--    → items(chunks·gate_feedback cascade) → 연결(sync_states·reauth_pushes cascade, 트리거가 vault 토큰 삭제) → 감사 로그(개수만)
create or replace function delete_gmail_source(p_user uuid, p_connection uuid) returns jsonb language plpgsql as $$
declare v_items uuid[]; n_items int; n_facts int; n_jobs int;
begin
  if not exists (select 1 from connections where id = p_connection and user_id = p_user and provider = 'gmail') then
    raise exception 'connection not found' using errcode = 'P0002';
  end if;
  select coalesce(array_agg(id), '{}') into v_items from items where user_id = p_user and source = 'GMAIL';
  -- payload 값은 텍스트로 비교한다(다른 잡의 payload 에 uuid 가 아닌 값이 있어도 캐스트 오류가 나지 않게)
  -- 연결 잡은 kind 와 무관하게 payload.connection_id 로 잡는다(sync·fetch·watch·reauth, 테스트 태그가 붙은 lease_key 포함)
  delete from jobs j where j.user_id = p_user and (
       j.lease_key = 'gmail:' || p_connection
    or j.payload->>'connection_id' = p_connection::text
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
  delete from connections where id = p_connection and user_id = p_user;
  insert into audit_log (user_id, actor, action, target) values (p_user, 'user', 'source_delete', 'gmail items=' || n_items);
  return jsonb_build_object('items', n_items, 'facts', n_facts, 'jobs', n_jobs);
end $$;

-- 3) 전체 삭제(Edge account/delete)가 쓰는 조회·감사. 사용자 삭제 자체는 Auth admin API(cascade + user_keys 삭제 = crypto-shred)
create or replace function account_connections(p_user uuid) returns setof uuid language sql stable as $$
  select id from connections where user_id = p_user and provider = 'gmail';
$$;
create or replace function account_audit(p_user uuid, p_action text, p_target text) returns void language sql as $$
  insert into audit_log (user_id, actor, action, target) values (p_user, 'user', p_action, p_target);
$$;

revoke execute on function purge_expired(uuid), insert_media_item(uuid, text, text, text, bytea, timestamptz, text), worker_expired_media(int),
  worker_clear_storage_key(uuid, uuid), delete_gmail_source(uuid, uuid), account_connections(uuid), account_audit(uuid, text, text)
  from public, anon, authenticated;

select cron.schedule('purge-expired-daily', '33 4 * * *', $$
  select purge_expired();
  select enqueue_job(null, 'purge-media', 'purge-media', '{}'::jsonb)
  where exists (select 1 from items where storage_key is not null and expires_at < now());
$$);
