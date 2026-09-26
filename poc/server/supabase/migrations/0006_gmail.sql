-- Gmail 연결·동기화 상태(스펙 §7·§8). 만료 두 가지를 분리한다:
--   connections.expires_at      = OAuth refresh token 만료(테스트 모드 발급 후 7일, 앱 게시 후 null)
--   sync_states.watch_expires_at = Gmail watch 만료(7일, 매일 갱신)
-- refresh token은 vault에 'gmail_rt:<connection_id>' 이름으로 둔다
create table connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  provider text not null check (provider in ('gmail')),
  account_ref text not null,
  status text not null default 'active' check (status in ('active','reauth_required','disconnected')),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  unique (provider, account_ref)
);
create table sync_states (
  connection_id uuid primary key references connections on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  cursor text not null,                   -- Gmail historyId
  last_success_at timestamptz not null default now(),
  watch_expires_at timestamptz            -- users.watch 응답 expiration (7일)
);
alter table connections enable row level security;
alter table sync_states enable row level security;
create policy connections_owner_read on connections for select using ((select auth.uid()) = user_id);
create policy sync_states_owner_read on sync_states for select using ((select auth.uid()) = user_id);

create or replace function gmail_save_connection(p_user uuid, p_account_ref text, p_refresh_token text, p_history_id text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_secret uuid;
begin
  insert into public.connections as c (user_id, provider, account_ref, status) values (p_user, 'gmail', p_account_ref, 'active')
  on conflict (provider, account_ref) do update set status = 'active' where c.user_id = excluded.user_id
  returning id into v_id;
  if v_id is null then raise exception 'account_ref linked to another user' using errcode = 'P0001'; end if;
  if p_refresh_token is not null then     -- 재동의가 아니면 Google이 refresh token을 다시 주지 않는다
    select id into v_secret from vault.secrets where name = 'gmail_rt:' || v_id;
    if v_secret is null then perform vault.create_secret(p_refresh_token, 'gmail_rt:' || v_id);
    else perform vault.update_secret(v_secret, p_refresh_token); end if;
    update public.connections set expires_at = now() + interval '7 days' where id = v_id;   -- OAuth 테스트 모드 수명
  end if;
  insert into public.sync_states (connection_id, user_id, cursor) values (v_id, p_user, p_history_id)
  on conflict (connection_id) do update set cursor = excluded.cursor, last_success_at = now();
  return v_id;
end $$;

create or replace function gmail_get_refresh_token(p_user uuid, p_connection uuid) returns text
language sql stable security definer set search_path = '' as $$
  select s.decrypted_secret from public.connections c join vault.decrypted_secrets s on s.name = 'gmail_rt:' || c.id
  where c.id = p_connection and c.user_id = p_user and c.status = 'active';
$$;

-- 연결(출처) 삭제 = 토큰 삭제(스펙 §8 "항목·출처 삭제"). 계정 삭제의 cascade에도 적용된다
create or replace function gmail_forget_refresh_token() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from vault.secrets where name = 'gmail_rt:' || old.id;
  return old;
end $$;
create trigger connections_forget_token after delete on connections for each row execute function gmail_forget_refresh_token();

create or replace function gmail_state(p_user uuid, p_connection uuid)
returns table (cursor text, last_success_at timestamptz) language sql stable as $$
  select s.cursor, s.last_success_at from sync_states s where s.connection_id = p_connection and s.user_id = p_user;
$$;

-- null 인자는 바꾸지 않는다. cursor를 넘기면 동기화 성공으로 보고 last_success_at도 갱신한다
create or replace function gmail_update(p_user uuid, p_connection uuid, p_cursor text default null,
                                        p_status text default null, p_watch_expires_at timestamptz default null)
returns void language plpgsql as $$
begin
  update sync_states set cursor = coalesce(p_cursor, cursor),
                         last_success_at = case when p_cursor is not null then now() else last_success_at end,
                         watch_expires_at = coalesce(p_watch_expires_at, watch_expires_at)
  where connection_id = p_connection and user_id = p_user;
  if p_status is not null then
    update connections set status = p_status where id = p_connection and user_id = p_user;
  end if;
end $$;

-- 웹훅용: emailAddress로 연결을 찾아 gmail-sync 잡을 넣는다. 이미 대기 중인 sync가 있으면 넣지 않는다
create or replace function gmail_enqueue_for_account(p_account_ref text) returns uuid language sql as $$
  insert into jobs (kind, user_id, lease_key, payload)
  select 'gmail-sync', c.user_id, 'gmail:' || c.id, jsonb_build_object('connection_id', c.id)
  from connections c
  where c.provider = 'gmail' and c.account_ref = p_account_ref and c.status = 'active'
    and not exists (select 1 from jobs j where j.lease_key = 'gmail:' || c.id and j.kind = 'gmail-sync' and j.status = 'queued')
  returning id;
$$;

-- cron용: 활성 연결마다 잡 1개 (gmail-sync 6시간 대조, gmail-watch 매일 갱신)
create or replace function gmail_enqueue_all(p_kind text) returns int language plpgsql as $$
declare n int;
begin
  if p_kind not in ('gmail-sync', 'gmail-watch') then raise exception 'bad kind'; end if;
  insert into jobs (kind, user_id, lease_key, payload)
  select p_kind, c.user_id, 'gmail:' || c.id, jsonb_build_object('connection_id', c.id)
  from connections c
  where c.provider = 'gmail' and c.status = 'active'
    and not exists (select 1 from jobs j where j.lease_key = 'gmail:' || c.id and j.kind = p_kind and j.status = 'queued');
  get diagnostics n = row_count;
  return n;
end $$;

-- 재인증 푸시 대상(스펙 §7): refresh token 만료 24시간 이내, 또는 invalid_grant로 reauth_required가 된 연결
create or replace function gmail_reauth_due()
returns table (connection_id uuid, user_id uuid, reason text) language sql stable as $$
  select c.id, c.user_id, case when c.status = 'reauth_required' then 'invalid_grant' else 'expiring' end
  from connections c
  where c.provider = 'gmail'
    and (c.status = 'reauth_required' or (c.status = 'active' and c.expires_at < now() + interval '24 hours'));
$$;

revoke execute on function gmail_save_connection(uuid, text, text, text), gmail_get_refresh_token(uuid, uuid),
  gmail_forget_refresh_token(), gmail_state(uuid, uuid), gmail_update(uuid, uuid, text, text, timestamptz),
  gmail_enqueue_for_account(text), gmail_enqueue_all(text), gmail_reauth_due() from public, anon, authenticated;

select cron.schedule('gmail-sync-every-6h', '0 */6 * * *', $$ select gmail_enqueue_all('gmail-sync'); $$);
select cron.schedule('gmail-watch-daily', '17 3 * * *', $$ select gmail_enqueue_all('gmail-watch'); $$);
