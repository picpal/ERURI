-- 0.16.1 처리 실패 항목(스펙 §7 jobs 워커 "처리 실패 항목", §8 items, 2026-10-19 사용자 결정 A).
-- (1) process·extract 잡이 dead 가 되면 그 항목이 아직 queued 일 때만 items.status = 'failed'. 이미 처리(extracted·폐기)된 항목은 그대로.
--     지금까지는 잡이 dead 여도 항목이 영구 queued 라 보관함이 "처리 중"·채팅 턴이 "아직 처리 중이에요"로 남았다
-- (2) 같은 멱등 키로 다시 들어온 항목이 failed 면 insert_item 이 그 행을 새 본문으로 queued 로 되돌리고 process 잡을 다시 만든다(Gmail 제외).
--     같은 링크·같은 날 같은 글은 기기 기록(link_seen)·서버 멱등 키(SHARE:<캡처 id>) 때문에 새 항목이 되지 않아 "다시 보내 주세요"가 막히므로
-- items.status 에는 check 제약이 없다(0001) — 새 값만 쓴다. 읽기는 기존 RLS(items_owner_read) 그대로

-- 마감 실패가 fail_job(잡 상태 변경)을 막지 않게 경고만(0030 mail_action_job_dead 와 같은 모양). payload.item_id 가 uuid 가 아니어도 같다
create or replace function item_job_dead() returns trigger language plpgsql as $$
begin
  begin
    update items set status = 'failed'
    where id = (new.payload->>'item_id')::uuid and user_id = new.user_id and status = 'queued';
  exception when others then
    raise warning 'item_job_dead %', sqlstate;
  end;
  return new;
end $$;
create trigger jobs_item_dead after update of status on jobs for each row
  when (new.kind in ('process', 'extract') and new.status = 'dead' and old.status is distinct from 'dead')
  execute function item_job_dead();

-- 시그니처·본문은 0013 그대로(create or replace — 권한 유지). 중복이면 failed 행만 되살린다: 새 본문·제목·발신자·출처 앱·보낸 시각,
-- 분류 기록(gate_label·gate_confidence)은 비운다(게이트가 다시 판정). 동시에 두 번 오면 먼저 바꾼 쪽만 id 를 받는다(둘째는 queued 라 null = 중복)
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
  if v_id is null and p_source <> 'GMAIL' then
    update items set app_name = p_app_name, sender = p_sender, title = p_title, content_enc = p_content_enc, ocr_text_enc = p_ocr_text_enc,
                     occurred_at = p_occurred_at, device_filter = p_device_filter, status = 'queued', gate_label = null, gate_confidence = null
    where user_id = p_user and idempotency_key = p_idempotency_key and status = 'failed'
    returning id into v_id;
  end if;
  if v_id is not null and p_enqueue then
    insert into jobs (kind, user_id, lease_key, payload)
    values ('process', p_user, case when p_backfill then 'backfill:' || p_user else 'item:' || v_id end,
            jsonb_build_object('item_id', v_id) || case when p_backfill then '{"backfill": true}'::jsonb else '{}'::jsonb end);
  end if;
  return v_id;                            -- 중복(실패 아님)·연결 없음이면 null
end $$;

revoke execute on function item_job_dead() from public, anon, authenticated;
revoke execute on function insert_item(uuid, text, text, text, text, bytea, timestamptz, boolean, text, bytea, text, boolean) from public, anon, authenticated;
