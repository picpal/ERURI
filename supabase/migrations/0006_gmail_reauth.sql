-- 재인증 푸시(스펙 §7): refresh token 만료 24시간 전(expiring) 또는 invalid_grant(reauth_required). 같은 연결·사유·만료 창에 한 번만.
-- 창 = connections.expires_at(재연결하면 새 7일 창). 쓰기는 service role(worker) RPC, 사용자는 자기 행 읽기만
create table reauth_pushes (
  connection_id uuid not null references connections on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  reason text not null check (reason in ('expiring', 'invalid_grant')),
  window_key text not null,
  sent_at timestamptz not null default now(),
  primary key (connection_id, reason, window_key)
);
alter table reauth_pushes enable row level security;
create policy reauth_pushes_owner_read on reauth_pushes for select to authenticated using ((select auth.uid()) = user_id);
revoke all on reauth_pushes from anon;

-- 대상 연결마다 gmail-reauth 잡 1개. 대기·실행 중이거나 그 창에 이미 보냈으면 넣지 않는다. p_user 로 범위를 좁힌다(테스트·invalid_grant 즉시 적재).
-- 테스트는 p_lease_prefix('test:<run>:')를 줘서 워커 cron 이 그 잡을 가져가지 않게 하고, cron(범위 없음)은 테스트 연결(account_ref 'test:%')을 건너뛴다
create or replace function gmail_enqueue_reauth(p_user uuid default null, p_lease_prefix text default '') returns int language plpgsql as $$
declare n int;
begin
  insert into jobs (kind, user_id, lease_key, payload)
  select 'gmail-reauth', d.user_id, p_lease_prefix || 'reauth:' || d.connection_id,
         jsonb_build_object('connection_id', d.connection_id, 'reason', d.reason, 'window_key', coalesce(c.expires_at::text, '-'))
  from gmail_reauth_due() d join connections c on c.id = d.connection_id
  where (p_user is null or d.user_id = p_user)
    and (p_user is not null or c.account_ref not like 'test:%')
    and not exists (select 1 from reauth_pushes r where r.connection_id = d.connection_id and r.reason = d.reason
                    and r.window_key = coalesce(c.expires_at::text, '-'))
    and not exists (select 1 from jobs j where j.lease_key = p_lease_prefix || 'reauth:' || d.connection_id and j.status in ('queued', 'running'));
  get diagnostics n = row_count;
  return n;
end $$;

-- 보내기 직전 1회 기록. 이미 있으면 false
create or replace function claim_reauth_push(p_user uuid, p_connection uuid, p_reason text, p_window_key text) returns boolean language plpgsql as $$
declare v int;
begin
  insert into reauth_pushes (connection_id, user_id, reason, window_key)
  select c.id, c.user_id, p_reason, p_window_key from connections c where c.id = p_connection and c.user_id = p_user
  on conflict do nothing;
  get diagnostics v = row_count;
  return v > 0;
end $$;

-- 한 기기도 못 받았으면(일시 오류) 기록을 풀어 재시도가 다시 보내게 한다
create or replace function release_reauth_push(p_user uuid, p_connection uuid, p_reason text, p_window_key text) returns void language sql as $$
  delete from reauth_pushes where connection_id = p_connection and user_id = p_user and reason = p_reason and window_key = p_window_key;
$$;

revoke execute on function gmail_enqueue_reauth(uuid, text), claim_reauth_push(uuid, uuid, text, text), release_reauth_push(uuid, uuid, text, text)
  from public, anon, authenticated;

select cron.schedule('gmail-reauth-hourly', '7 * * * *', $$ select gmail_enqueue_reauth(); $$);
