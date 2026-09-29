-- 재인증 푸시 창(스펙 §7, M1-③a 리뷰 Minor 2·3).
-- 창 키 = expires_at 의 epoch 초(세션 TimeZone·DateStyle 과 무관. cron 과 invalid_grant 즉시 적재가 같은 문자열), 없으면 '-'.
-- expires_at 이 없는 Production 모드에서는 창이 바뀌지 않으므로 재연결(→ active)이 그 연결의 기록을 지워 다음 끊김에 다시 보낸다
create or replace function gmail_enqueue_reauth(p_user uuid default null, p_lease_prefix text default '') returns int language plpgsql as $$
declare n int;
begin
  insert into jobs (kind, user_id, lease_key, payload)
  select 'gmail-reauth', d.user_id, p_lease_prefix || 'reauth:' || d.connection_id,
         jsonb_build_object('connection_id', d.connection_id, 'reason', d.reason, 'window_key', w.k)
  from gmail_reauth_due() d join connections c on c.id = d.connection_id
  cross join lateral (select coalesce(extract(epoch from c.expires_at)::bigint::text, '-') as k) w
  where (p_user is null or d.user_id = p_user)
    and (p_user is not null or c.account_ref not like 'test:%')
    and not exists (select 1 from reauth_pushes r where r.connection_id = d.connection_id and r.reason = d.reason and r.window_key = w.k)
    and not exists (select 1 from jobs j where j.lease_key = p_lease_prefix || 'reauth:' || d.connection_id and j.status in ('queued', 'running'));
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function reauth_pushes_clear_on_reconnect() returns trigger language plpgsql as $$
begin
  delete from reauth_pushes where connection_id = new.id;
  return new;
end $$;
create trigger connections_reauth_reconnect after update of status on connections
  for each row when (old.status is distinct from 'active' and new.status = 'active')
  execute function reauth_pushes_clear_on_reconnect();

revoke execute on function reauth_pushes_clear_on_reconnect() from public, anon, authenticated;
