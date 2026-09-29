-- 스펙 §8 devices: 발송 대상은 last_seen_at 7일 안인 기기만(버려진 개발 설치·시뮬레이터 제외).
-- last_seen_at 은 /ingest/device 등록과 /ingest/trace 업로드가 갱신한다
create or replace function worker_list_devices(p_user uuid)
returns table (device_id text, apns_token text, apns_env text) language sql stable as $$
  select d.device_id, d.apns_token, d.apns_env from devices d
  where d.user_id = p_user and d.last_seen_at > now() - interval '7 days'
  order by d.last_seen_at desc;
$$;
