-- 스펙 §6 device_filter("fm" | "rules"): ingest 가 기기 CaptureItem.deviceFilter 를 저장한다.
-- 인자를 추가하면 오버로드가 생겨 PostgREST 이름 인자 호출이 모호해지므로 옛 시그니처를 지우고 다시 만든다
alter table items add constraint items_device_filter_check check (device_filter in ('fm', 'rules'));

drop function insert_item(uuid, text, text, text, text, bytea, timestamptz, boolean, text, bytea);
create function insert_item(p_user uuid, p_source text, p_idempotency_key text, p_sender text, p_title text,
                            p_content_enc bytea, p_occurred_at timestamptz, p_enqueue boolean default true,
                            p_app_name text default null, p_ocr_text_enc bytea default null, p_device_filter text default null)
returns uuid language plpgsql as $$
declare v_id uuid;
begin
  insert into items (user_id, source, app_name, sender, title, content_enc, ocr_text_enc, occurred_at, idempotency_key, device_filter)
  values (p_user, p_source, p_app_name, p_sender, p_title, p_content_enc, p_ocr_text_enc, p_occurred_at, p_idempotency_key, p_device_filter)
  on conflict (user_id, idempotency_key) do nothing
  returning id into v_id;
  if v_id is not null and p_enqueue then
    insert into jobs (kind, user_id, lease_key, payload)
    values ('process', p_user, 'item:' || v_id, jsonb_build_object('item_id', v_id));
  end if;
  return v_id;                            -- 중복이면 null
end $$;

revoke execute on function insert_item(uuid, text, text, text, text, bytea, timestamptz, boolean, text, bytea, text)
  from public, anon, authenticated;
