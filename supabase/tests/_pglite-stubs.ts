// PGlite 로컬 SQL 테스트용 최소 스키마(계획 M3, U7). 0030 이 닿는 것만 — 열·함수 정의는 원본(0001·0005·0007)과 같게 둔다.
// Supabase 확장(vault·pg_cron·auth)은 같은 이름·인자 모양의 표·함수로 흉내 낸다. 호스팅 DB 테스트(mail-actions-db)가 진짜를 본다
export const PGLITE_STUBS = `
create role anon; create role authenticated; create role service_role;
create schema auth;
create table auth.users (id uuid primary key);
create schema vault;
-- 진짜 Vault 의 vault.secrets.secret 은 암호문이고 평문은 vault.decrypted_secrets.decrypted_secret 에만 있다.
-- 스텁도 secret 에 평문을 두지 않는다(base64) — 사례는 decrypted_secrets 만 읽는다(M3 리뷰 I1: 평문 스텁이 호스팅 실패를 가렸다)
create table vault.secrets (id uuid primary key default gen_random_uuid(), name text unique not null, secret text not null);
create view vault.decrypted_secrets as select id, name, convert_from(decode(secret, 'base64'), 'UTF8') as decrypted_secret from vault.secrets;
create function vault.create_secret(p_secret text, p_name text) returns uuid language sql as
  $$ insert into vault.secrets (name, secret) values (p_name, encode(convert_to(p_secret, 'UTF8'), 'base64')) returning id $$;
create function vault.update_secret(p_id uuid, p_secret text) returns void language sql as
  $$ update vault.secrets set secret = encode(convert_to(p_secret, 'UTF8'), 'base64') where id = p_id $$;
create schema cron;
create table cron.job (jobid bigserial primary key, jobname text unique, schedule text, command text);
create function cron.schedule(p_name text, p_schedule text, p_command text) returns bigint language sql as
  $$ insert into cron.job (jobname, schedule, command) values (p_name, p_schedule, p_command)
     on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning jobid $$;

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
  cursor text not null,
  last_success_at timestamptz not null default now(),
  watch_expires_at timestamptz
);
create table jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  user_id uuid references auth.users on delete cascade,
  payload jsonb not null default '{}',
  lease_key text,
  leased_until timestamptz,
  attempts int not null default 0,
  status text not null default 'queued' check (status in ('queued','running','done','dead')),
  checkpoint text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  priority smallint not null default 30,
  claimed_at timestamptz,
  not_before timestamptz
);
create table audit_log (
  id bigint generated always as identity primary key,
  user_id uuid not null, actor text not null, action text not null, target text, at timestamptz not null default now()
);
create function enqueue_job(p_user uuid, p_kind text, p_lease_key text, p_payload jsonb) returns uuid language sql as $$
  insert into jobs (kind, user_id, lease_key, payload) values (p_kind, p_user, p_lease_key, p_payload) returning id;
$$;
create function fail_job(p_id uuid, p_error text) returns void language sql as $$
  update jobs set status = case when attempts >= 5 then 'dead' else 'queued' end,
                  not_before = case when attempts >= 5 then not_before else now() + make_interval(secs => attempts * 60) end,
                  last_error = p_error, leased_until = null, updated_at = now() where id = p_id;
$$;
create function jobs_set_priority() returns trigger language plpgsql as $$
begin
  new.priority := case
    when coalesce(new.payload->>'backfill', '') = 'true' then 40
    when new.kind = 'notify' then 10
    when new.kind in ('gmail-sync', 'gmail-fetch', 'gmail-watch', 'gmail-reauth') then 20
    else 30 end;
  return new;
end $$;
create trigger jobs_priority before insert on jobs for each row execute function jobs_set_priority();
create function gmail_save_connection(p_user uuid, p_account_ref text, p_refresh_token text, p_history_id text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_secret uuid;
begin
  insert into public.connections as c (user_id, provider, account_ref, status) values (p_user, 'gmail', p_account_ref, 'active')
  on conflict (provider, account_ref) do update set status = 'active' where c.user_id = excluded.user_id
  returning id into v_id;
  if v_id is null then raise exception 'account_ref linked to another user' using errcode = 'P0001'; end if;
  if p_refresh_token is not null then
    select id into v_secret from vault.secrets where name = 'gmail_rt:' || v_id;
    if v_secret is null then perform vault.create_secret(p_refresh_token, 'gmail_rt:' || v_id);
    else perform vault.update_secret(v_secret, p_refresh_token); end if;
    update public.connections set expires_at = now() + interval '7 days' where id = v_id;
  end if;
  insert into public.sync_states (connection_id, user_id, cursor) values (v_id, p_user, p_history_id)
  on conflict (connection_id) do update set cursor = excluded.cursor, last_success_at = now();
  return v_id;
end $$;
create function gmail_get_refresh_token(p_user uuid, p_connection uuid) returns text
language sql stable security definer set search_path = '' as $$
  select s.decrypted_secret from public.connections c join vault.decrypted_secrets s on s.name = 'gmail_rt:' || c.id
  where c.id = p_connection and c.user_id = p_user and c.status = 'active';
$$;
`;

// 0032(기능별 비용 기록, 계획 L1)용 추가 스텁: 0001·0005 의 usage_counters, 시계를 바꿀 수 있는 seoul_month(), auth.uid().
// 원본 seoul_month() 는 now() 를 읽는다 — 테스트는 test_clock 에 시각을 넣어 서울 자정 경계를 만든다(비면 now())
export const USAGE_STUBS = `
create table test_clock (at timestamptz);
create function public.seoul_month() returns date language sql stable as $$
  select date_trunc('month', coalesce((select at from public.test_clock limit 1), now()) at time zone 'Asia/Seoul')::date
$$;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create table usage_counters (
  user_id uuid not null references auth.users on delete cascade,
  month date not null,
  vision_calls int not null default 0,
  extract_tokens bigint not null default 0,
  chat_tokens bigint not null default 0,
  reserved_krw numeric not null default 0,
  backfill_tokens bigint not null default 0,
  primary key (user_id, month)
);
alter table usage_counters enable row level security;
`;
