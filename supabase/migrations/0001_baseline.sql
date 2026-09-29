-- ERURI 제품 베이스라인(2026-09-30, 스펙 §11): PoC 마이그레이션 0001~0018을 적용 순서대로 합쳤다.
-- 제외: 0007_poc_traces·0015_trace_idempotency(→ 0002_diagnostics device_traces), 0010_test_scope(→ 0003_test_scope).
-- 변경: Storage 버킷 'poc' → 'media'(storage_key 의 첫 경로 조각). 그 외 문장은 PoC 원문 그대로다.

-- ── PoC 0001_jobs.sql ──
create extension if not exists pg_cron;
create extension if not exists pg_net;
create table jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  user_id uuid references auth.users on delete cascade,     -- 시스템 잡(cron 정리 등)은 null
  payload jsonb not null default '{}',
  lease_key text,
  leased_until timestamptz,
  attempts int not null default 0,
  status text not null default 'queued' check (status in ('queued','running','done','dead')),
  checkpoint text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on jobs (status, created_at) where status = 'queued';
create unique index jobs_one_running_per_key on jobs (lease_key) where status = 'running';
alter table jobs enable row level security;
create policy jobs_owner_read on jobs for select using ((select auth.uid()) = user_id);

-- 동시 호출은 advisory lock으로 직렬화하고, 한 번의 클레임에서도 lease_key당 1건만 고른다.
-- (lease_key가 같은 queued 2건을 한꺼번에 running으로 바꾸면 jobs_one_running_per_key 위반)
create or replace function claim_jobs(p_limit int, p_lease_seconds int)
returns setof jobs language plpgsql as $$
begin
  perform pg_advisory_xact_lock(hashtext('claim_jobs'));
  return query
  with cand as (
    select j.id, j.lease_key, j.status, j.created_at from jobs j
    where (j.status = 'queued' or (j.status = 'running' and j.leased_until < now()))
      and not exists (select 1 from jobs r where r.status = 'running' and r.leased_until >= now()
                      and r.lease_key = j.lease_key and r.id <> j.id)
    order by j.created_at
    for update skip locked
  ), one_per_key as (
    select distinct on (coalesce(lease_key, id::text)) id, created_at from cand
    order by coalesce(lease_key, id::text), (status = 'running') desc, created_at
  )
  update jobs set status = 'running', leased_until = now() + make_interval(secs => p_lease_seconds),
                  attempts = attempts + 1, updated_at = now()
  where id in (select id from one_per_key order by created_at limit p_limit)
  returning *;
end $$;

create or replace function complete_job(p_id uuid, p_checkpoint text) returns void language sql as $$
  update jobs set status = 'done', checkpoint = p_checkpoint, updated_at = now() where id = p_id;
$$;
create or replace function fail_job(p_id uuid, p_error text) returns void language sql as $$
  update jobs set status = case when attempts >= 5 then 'dead' else 'queued' end,
                  last_error = p_error, leased_until = null, updated_at = now() where id = p_id;
$$;
create or replace function enqueue_job(p_user uuid, p_kind text, p_lease_key text, p_payload jsonb) returns uuid
language sql as $$
  insert into jobs (kind, user_id, lease_key, payload) values (p_kind, p_user, p_lease_key, p_payload) returning id;
$$;
revoke execute on function claim_jobs(int, int), complete_job(uuid, text), fail_job(uuid, text),
  enqueue_job(uuid, text, text, jsonb) from public, anon, authenticated;

-- ── PoC 0002_cron.sql ──
-- 워커를 매분 호출한다. URL·키는 vault(worker_url, service_role_key)에서 읽는다(마이그레이션에 값 없음)
select cron.schedule('worker-every-minute', '* * * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='worker_url'),
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='service_role_key'), 'Content-Type','application/json'),
    body := '{}'::jsonb, timeout_milliseconds := 5000);
$$);

-- ── PoC 0003_items_keys.sql ──
create table user_keys (
  user_id uuid primary key references auth.users on delete cascade,   -- 계정 삭제 = crypto-shredding
  wrapped_key bytea not null,             -- 사용자 데이터 키(32B)를 MASTER_KEY로 AES-256-GCM 감싼 값
  created_at timestamptz not null default now()
);
create table items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  source text not null check (source in ('GMAIL','MESSAGES','NOTIFICATION','SHARE','CHAT')),
  app_name text,
  sender text,
  title text,
  content_enc bytea,                      -- 원문. Edge에서 사용자 데이터 키로 암호화. 원문 만료 시 null
  ocr_text_enc bytea,                     -- 이미지 OCR 원문. 같은 방식
  occurred_at timestamptz not null,
  captured_at timestamptz not null default now(),
  device_filter text,
  idempotency_key text not null,
  status text not null default 'queued',
  storage_key text,
  expires_at timestamptz not null default now() + interval '90 days',
  unique (user_id, idempotency_key)
);
create table audit_log (
  id bigint generated always as identity primary key,
  user_id uuid not null,                  -- FK 없음: 계정 삭제 후에도 사유 코드 행은 남긴다(§8)
  actor text not null,
  action text not null,
  target text,
  at timestamptz not null default now()
);
alter table user_keys enable row level security;
alter table items enable row level security;
alter table audit_log enable row level security;
create policy user_keys_owner_read on user_keys for select using ((select auth.uid()) = user_id);
create policy items_owner_read on items for select using ((select auth.uid()) = user_id);
create policy audit_owner_read on audit_log for select using ((select auth.uid()) = user_id);

create or replace function get_wrapped_key(p_user uuid) returns bytea language sql stable as $$
  select wrapped_key from user_keys where user_id = p_user;
$$;
-- 동시에 두 함수가 키를 만들면 먼저 저장된 값을 돌려준다(둘 다 같은 키로 암호화하게 됨)
create or replace function put_wrapped_key(p_user uuid, p_wrapped bytea) returns bytea language plpgsql as $$
begin
  insert into user_keys (user_id, wrapped_key) values (p_user, p_wrapped) on conflict (user_id) do nothing;
  return (select wrapped_key from user_keys where user_id = p_user);
end $$;

create or replace function insert_item(p_user uuid, p_source text, p_idempotency_key text, p_sender text, p_title text,
                                       p_content_enc bytea, p_occurred_at timestamptz, p_enqueue boolean default true,
                                       p_app_name text default null, p_ocr_text_enc bytea default null)
returns uuid language plpgsql as $$
declare v_id uuid;
begin
  insert into items (user_id, source, app_name, sender, title, content_enc, ocr_text_enc, occurred_at, idempotency_key)
  values (p_user, p_source, p_app_name, p_sender, p_title, p_content_enc, p_ocr_text_enc, p_occurred_at, p_idempotency_key)
  on conflict (user_id, idempotency_key) do nothing
  returning id into v_id;
  if v_id is not null and p_enqueue then
    insert into jobs (kind, user_id, lease_key, payload)
    values ('process', p_user, 'item:' || v_id, jsonb_build_object('item_id', v_id));
  end if;
  return v_id;                            -- 중복이면 null
end $$;

-- §12 통제 4(b): items.user_id와 user_keys 소유자가 p_user로 같을 때만 암호문을 돌려주고 복호화 감사를 남긴다
create or replace function worker_get_item(p_user uuid, p_item uuid)
returns table (id uuid, content_enc bytea, ocr_text_enc bytea) language plpgsql as $$
#variable_conflict use_column
begin
  return query
    select i.id, i.content_enc, i.ocr_text_enc from items i join user_keys k on k.user_id = i.user_id
    where i.id = p_item and i.user_id = p_user and i.content_enc is not null;
  if found then
    insert into audit_log (user_id, actor, action, target) values (p_user, 'worker', 'decrypt', p_item::text);
  end if;
end $$;

revoke execute on function get_wrapped_key(uuid), put_wrapped_key(uuid, bytea),
  insert_item(uuid, text, text, text, text, bytea, timestamptz, boolean, text, bytea), worker_get_item(uuid, uuid)
  from public, anon, authenticated;

-- ── PoC 0004_lease_heartbeat.sql ──
-- 임대 기본 180초(Edge 무료 wall-clock 150초보다 김): 살아 있는 워커의 잡을 다른 호출이 재클레임하지 않는다.
-- 잡 하나를 30초 넘게 붙드는 워커는 30초마다 heartbeat_job으로 임대를 연장한다(스펙 §7)
create or replace function claim_jobs(p_limit int, p_lease_seconds int default 180)
returns setof jobs language plpgsql as $$
begin
  perform pg_advisory_xact_lock(hashtext('claim_jobs'));
  return query
  with cand as (
    select j.id, j.lease_key, j.status, j.created_at from jobs j
    where (j.status = 'queued' or (j.status = 'running' and j.leased_until < now()))
      and not exists (select 1 from jobs r where r.status = 'running' and r.leased_until >= now()
                      and r.lease_key = j.lease_key and r.id <> j.id)
    order by j.created_at
    for update skip locked
  ), one_per_key as (
    select distinct on (coalesce(lease_key, id::text)) id, created_at from cand
    order by coalesce(lease_key, id::text), (status = 'running') desc, created_at
  )
  update jobs set status = 'running', leased_until = now() + make_interval(secs => p_lease_seconds),
                  attempts = attempts + 1, updated_at = now()
  where id in (select id from one_per_key order by created_at limit p_limit)
  returning *;
end $$;

-- running인 잡만 연장한다. 이미 끝났거나(done/dead) 재큐된 잡이면 false
create or replace function heartbeat_job(p_id uuid, p_lease_seconds int default 180) returns boolean language plpgsql as $$
begin
  update jobs set leased_until = now() + make_interval(secs => p_lease_seconds), updated_at = now()
  where id = p_id and status = 'running';
  return found;
end $$;

revoke execute on function claim_jobs(int, int), heartbeat_job(uuid, int) from public, anon, authenticated;

-- ── PoC 0005_cron_vault_guard.sql ──
-- vault(worker_url, service_role_key)가 없으면 워커 호출을 건너뛴다.
-- 0002는 vault 등록 전부터 매분 net.http_post(url null) 오류를 냈다. 같은 이름으로 다시 등록하면 명령이 교체된다
select cron.schedule('worker-every-minute', '* * * * *', $$
  select net.http_post(
    url := s.url,
    headers := jsonb_build_object('Authorization', 'Bearer ' || s.key, 'Content-Type', 'application/json'),
    body := '{}'::jsonb, timeout_milliseconds := 5000)
  from (select (select decrypted_secret from vault.decrypted_secrets where name = 'worker_url') as url,
               (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key') as key) s
  where s.url is not null and s.key is not null;
$$);

-- ── PoC 0006_gmail.sql ──
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

-- ── PoC 0008_hybrid_search.sql ──
-- 하이브리드 검색(스펙 §9): tsvector(simple) + pg_trgm ∪ pgvector cosine, RRF(k=60) 융합.
-- 임베딩은 PoC-7 통과 전까지 실제 사용자 데이터에 만들지 않는다(스펙 §16). 그동안 p_embedding = null → 키워드·trigram만
create extension if not exists vector with schema extensions;
create extension if not exists pg_trgm with schema extensions;
create table item_chunks (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references items(id) on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  chunk_index int not null,
  text text not null,
  embedding extensions.vector(512),       -- text-embedding-3-small dimensions 512. PoC-7 통과 전 실제 데이터는 null
  tsv tsvector generated always as (to_tsvector('simple', text)) stored
);
create index on item_chunks using hnsw (embedding extensions.vector_cosine_ops);
create index on item_chunks using gin (tsv);
create index on item_chunks using gin (text extensions.gin_trgm_ops);
create index on item_chunks (user_id);
alter table item_chunks enable row level security;
create policy item_chunks_owner_read on item_chunks for select using ((select auth.uid()) = user_id);

-- 반환: RRF score + 진단용 sem_sim(코사인 유사도, 의미 후보가 아니면 null)·kw_score(ts_rank와 trigram 유사도 중 큰 값)
create or replace function hybrid_search(p_user uuid, p_query text, p_embedding extensions.vector(512), p_limit int,
                                         p_from timestamptz default null, p_to timestamptz default null)
returns table(item_id uuid, chunk_id uuid, score float, sem_sim float, kw_score float)
language sql stable set search_path = public, extensions as $$
with base as (
  select c.id, c.item_id, c.text, c.embedding, c.tsv from item_chunks c join items i on i.id = c.item_id
  where c.user_id = p_user and i.user_id = p_user
    and (p_from is null or i.occurred_at >= p_from) and (p_to is null or i.occurred_at <= p_to)
), sem as (
  -- p_embedding이 null이면(임베딩 보류) 이 CTE는 비고 kw만으로 순위가 정해진다
  select id, 1 - (embedding <=> p_embedding) sim, row_number() over (order by embedding <=> p_embedding) rk
  from base where p_embedding is not null and embedding is not null
  order by embedding <=> p_embedding limit 40
), kw as (
  select id, s, row_number() over (order by s desc) rk from (
    select id, greatest(ts_rank(tsv, plainto_tsquery('simple', p_query)), similarity(text, p_query)) s
    from base where tsv @@ plainto_tsquery('simple', p_query) or similarity(text, p_query) > 0.2
  ) x order by s desc limit 40
), fused as (
  select coalesce(s.id, k.id) id, coalesce(1.0/(60+s.rk),0) + coalesce(1.0/(60+k.rk),0) score, s.sim, k.s kw
  from sem s full outer join kw k on s.id = k.id
)
select b.item_id, f.id, f.score::float, f.sim::float, f.kw::float from fused f join base b on b.id = f.id order by f.score desc limit p_limit;
$$;
revoke execute on function hybrid_search(uuid, text, extensions.vector, int, timestamptz, timestamptz) from public, anon, authenticated;

-- ── PoC 0009_hybrid_search_kw.sql ──
-- PoC-7 평가(2026-09-27): 0008의 키워드 경로는 한국어 질문에서 Top-5 2/40.
--   plainto_tsquery('simple')는 질문의 모든 어절(조사·어미 포함)을 AND로 요구하고, 문서 전체와의 trigram similarity는 짧은 질의에서 0.2를 넘지 못한다.
-- 대체: 질문을 어절로 나누고(질문어 제외) 끝 1~2글자를 뗀 형태까지 부분 문자열로 맞춘 뒤, 어절별 IDF 합으로 점수를 낸다.
--   RRF 융합에 키워드 가중치 p_kw_weight(기본 1)를 둔다. p_embedding = null이면 키워드만(임베딩 보류 경로).
drop function if exists hybrid_search(uuid, text, extensions.vector, int, timestamptz, timestamptz);
create or replace function hybrid_search(p_user uuid, p_query text, p_embedding extensions.vector(512), p_limit int,
                                         p_from timestamptz default null, p_to timestamptz default null, p_kw_weight float default 1.0)
returns table(item_id uuid, chunk_id uuid, score float, sem_sim float, kw_score float)
language sql stable set search_path = public, extensions as $$
with base as (
  select c.id, c.item_id, lower(c.text) text, c.embedding from item_chunks c join items i on i.id = c.item_id
  where c.user_id = p_user and i.user_id = p_user
    and (p_from is null or i.occurred_at >= p_from) and (p_to is null or i.occurred_at <= p_to)
), nb as (
  select greatest(count(*), 1)::float n from base
), sem as (
  select id, 1 - (embedding <=> p_embedding) sim, row_number() over (order by embedding <=> p_embedding) rk
  from base where p_embedding is not null and embedding is not null
  order by embedding <=> p_embedding limit 40
), toks as (
  select distinct t from regexp_split_to_table(lower(p_query), '[[:space:][:punct:]]+') t
  where char_length(t) >= 2 and t not in (
    '언제','언제야','언제지','어디','어디서','어디야','어디였지','어디에','뭐','뭐야','뭐지','뭐였지','뭐였더라','몇','얼마','얼마나',
    '누가','누구','무슨','어느','어떤','했지','했어','했나','했더라','샀지','샀어','샀더라','거','것','건','좀','내가','이번','그거',
    '있어','있나','됐어','됐나','돼','해','야','지','가야','하러','가는')
), variants as (                                             -- 질문 쪽 조사·어미: 끝 1~2글자를 뗀 형태도 후보(최소 2글자)
  select t, v from toks cross join lateral (values (t),
    (case when char_length(t) >= 3 then left(t, char_length(t) - 1) end),
    (case when char_length(t) >= 4 then left(t, char_length(t) - 2) end)) x(v)
  where v is not null
), tokmatch as (                                             -- 문서별로 맞은 어절(변형 중 하나라도 부분 문자열)
  select distinct b.id, vt.t from base b join variants vt on strpos(b.text, vt.v) > 0
), df as (
  select t, count(*)::float n from tokmatch group by t
), kw as (
  select m.id, sum(ln((nb.n + 1) / (df.n + 0.5))) s, row_number() over (order by sum(ln((nb.n + 1) / (df.n + 0.5))) desc) rk
  from tokmatch m join df using (t) cross join nb group by m.id, nb.n order by s desc limit 40
), fused as (
  select coalesce(s.id, k.id) id, coalesce(1.0/(60+s.rk),0) + p_kw_weight * coalesce(1.0/(60+k.rk),0) score, s.sim, k.s kw
  from sem s full outer join kw k on s.id = k.id
)
select b.item_id, f.id, f.score::float, f.sim::float, f.kw::float from fused f join base b on b.id = f.id order by f.score desc limit p_limit;
$$;
revoke execute on function hybrid_search(uuid, text, extensions.vector, int, timestamptz, timestamptz, float) from public, anon, authenticated;

-- ── PoC 0011_devices.sql ──
-- 기기 APNs 토큰·환경(스펙 §8 devices). 개발 서명 = sandbox 토큰, TestFlight·App Store = production 토큰이라 기기별로 저장한다.
-- 쓰기: Edge ingest /device가 사용자 JWT로 upsert(아래 RLS). 발송: apns-send·notify가 service role로 user_id를 명시해 조회
create table devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  device_id text not null,
  apns_token text not null,
  apns_env text not null check (apns_env in ('sandbox', 'production')),
  build text,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (user_id, device_id)
);
alter table devices enable row level security;
create policy devices_owner_read on devices for select to authenticated using ((select auth.uid()) = user_id);
create policy devices_owner_insert on devices for insert to authenticated with check ((select auth.uid()) = user_id);
create policy devices_owner_update on devices for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
revoke all on devices from anon;

-- ── PoC 0012_extract.sql ──
-- Task 12(PoC-8 서버 부분): 이미지·PDF 추출. 스펙 §7(월 vision 100건, 초과 시 OCR 텍스트), §8(usage_counters·facts·proposals).
-- PoC 최소 컬럼만 둔다. 쓰기는 모두 service role(worker) RPC로, 사용자는 자기 행 읽기만.

-- 비공개 버킷. 경로는 '<user_id>/<파일>' , items.storage_key = 'media/<user_id>/<파일>'
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', false, 20971520, array['image/png', 'image/jpeg', 'application/pdf'])
on conflict (id) do nothing;

create table usage_counters (
  user_id uuid not null references auth.users on delete cascade,
  month date not null,                    -- Asia/Seoul 기준 월 1일
  vision_calls int not null default 0,
  extract_tokens bigint not null default 0,
  chat_tokens bigint not null default 0,
  reserved_krw numeric not null default 0,
  primary key (user_id, month)
);

create table facts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  item_id uuid references items on delete set null,       -- facts는 무기한(§8), 원문 행이 사라져도 남는다
  kind text not null check (kind in ('event', 'task', 'purchase', 'subscription')),
  payload jsonb not null,
  evidence text,                          -- 원문 인용 ≤300자. vision 추출은 인용이 없어 null
  status text not null default 'active' check (status in ('active', 'cancelled', 'superseded')),
  supersedes_id uuid references facts,
  created_at timestamptz not null default now()
);
-- 재시도 멱등: 같은 항목의 같은 종류 active fact는 하나(PoC 단순화)
create unique index facts_one_active_per_item on facts (item_id, kind) where status = 'active';

create table proposals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  fact_id uuid not null references facts on delete cascade,
  action text not null check (action in ('create_event', 'update_event', 'create_reminder', 'complete_reminder')),
  payload jsonb not null,
  version int not null default 1,
  status text not null default 'proposed' check (status in ('proposed', 'confirmed', 'succeeded', 'failed', 'stale')),
  eventkit_id text,
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table usage_counters enable row level security;
alter table facts enable row level security;
alter table proposals enable row level security;
create policy usage_owner_read on usage_counters for select to authenticated using ((select auth.uid()) = user_id);
create policy facts_owner_read on facts for select to authenticated using ((select auth.uid()) = user_id);
create policy proposals_owner_read on proposals for select to authenticated using ((select auth.uid()) = user_id);

create or replace function seoul_month() returns date language sql stable as $$
  select date_trunc('month', now() at time zone 'Asia/Seoul')::date;
$$;

-- 호출 전 예약(§13): 이번 달 vision_calls < p_limit 이면 1 올리고 true, 아니면 false. 한 문장이라 동시 호출에도 상한을 넘지 않는다
create or replace function reserve_vision_call(p_user uuid, p_limit int default 100) returns boolean language plpgsql as $$
declare v int;
begin
  if p_limit < 1 then return false; end if;
  insert into usage_counters (user_id, month, vision_calls) values (p_user, seoul_month(), 1)
  on conflict (user_id, month) do update set vision_calls = usage_counters.vision_calls + 1
    where usage_counters.vision_calls < p_limit
  returning vision_calls into v;
  return v is not null;
end $$;

create or replace function add_extract_tokens(p_user uuid, p_tokens bigint) returns void language sql as $$
  insert into usage_counters (user_id, month, extract_tokens) values (p_user, seoul_month(), p_tokens)
  on conflict (user_id, month) do update set extract_tokens = usage_counters.extract_tokens + excluded.extract_tokens;
$$;

-- 이미지·PDF 항목 + extract 잡. 테스트는 p_lease_key에 실행 태그('test:<run>…')를 넘겨 워커 cron이 가져가지 않게 한다
create or replace function insert_media_item(p_user uuid, p_source text, p_idempotency_key text, p_storage_key text,
                                             p_ocr_text_enc bytea, p_occurred_at timestamptz, p_lease_key text default null)
returns uuid language plpgsql as $$
declare v_id uuid;
begin
  insert into items (user_id, source, storage_key, ocr_text_enc, occurred_at, idempotency_key)
  values (p_user, p_source, p_storage_key, p_ocr_text_enc, p_occurred_at, p_idempotency_key)
  on conflict (user_id, idempotency_key) do nothing
  returning id into v_id;
  if v_id is not null then
    insert into jobs (kind, user_id, lease_key, payload)
    values ('extract', p_user, coalesce(p_lease_key, 'item:' || v_id), jsonb_build_object('item_id', v_id));
  end if;
  return v_id;
end $$;

-- worker_get_item과 같은 소유 조건(§12 통제 4(b)). OCR 암호문을 줄 때만 복호화 감사를 남긴다
create or replace function worker_get_media(p_user uuid, p_item uuid)
returns table (storage_key text, ocr_text_enc bytea) language plpgsql as $$
#variable_conflict use_column
declare v_key text; v_ocr bytea;
begin
  select i.storage_key, i.ocr_text_enc into v_key, v_ocr from items i join user_keys k on k.user_id = i.user_id
  where i.id = p_item and i.user_id = p_user;
  if not found then return; end if;
  if v_ocr is not null then
    insert into audit_log (user_id, actor, action, target) values (p_user, 'worker', 'decrypt', p_item::text);
  end if;
  return query select v_key, v_ocr;
end $$;

-- 일정 fact + create_event 제안을 한 트랜잭션으로. 같은 항목의 active event fact가 있으면 그대로 돌려준다(재시도 멱등)
create or replace function save_event_fact(p_user uuid, p_item uuid, p_payload jsonb) returns uuid language plpgsql as $$
declare v_fact uuid;
begin
  if not exists (select 1 from items where id = p_item and user_id = p_user) then raise exception 'item not found'; end if;
  insert into facts (user_id, item_id, kind, payload) values (p_user, p_item, 'event', p_payload)
  on conflict (item_id, kind) where status = 'active' do nothing
  returning id into v_fact;
  if v_fact is null then
    select id into v_fact from facts where item_id = p_item and kind = 'event' and status = 'active';
    return v_fact;
  end if;
  insert into proposals (user_id, fact_id, action, payload, idempotency_key)
  values (p_user, v_fact, 'create_event', p_payload - 'via', 'proposal:' || v_fact || ':v1');
  update items set status = 'proposed' where id = p_item;
  return v_fact;
end $$;

revoke execute on function seoul_month(), reserve_vision_call(uuid, int), add_extract_tokens(uuid, bigint),
  insert_media_item(uuid, text, text, text, bytea, timestamptz, text), worker_get_media(uuid, uuid), save_event_fact(uuid, uuid, jsonb)
  from public, anon, authenticated;

-- ── PoC 0013_text_facts.sql ──
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

-- ── PoC 0014_proposal_pushes.sql ──
-- 0b(2026-09-29): 제안 푸시 기기별 1회(스펙 §7 notify, §8 proposal_pushes). 쓰기는 service role(worker) RPC, 사용자는 자기 행 읽기만
create table proposal_pushes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  proposal_id uuid not null references proposals on delete cascade,
  device_id text not null,
  status text not null check (status in ('sending', 'sent', 'failed', 'rejected')),
  apns_status int,
  reason text,                            -- APNs 사유 코드 또는 'network'. 토큰·문구 없음
  apns_id text,
  env text,
  claimed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (proposal_id, device_id)
);
alter table proposal_pushes enable row level security;
create policy proposal_pushes_owner_read on proposal_pushes for select to authenticated using ((select auth.uid()) = user_id);
revoke all on proposal_pushes from anon;

-- 제안 + 원 항목의 수신·수집 시각(백필 판정). 항목이 지워졌으면 시각은 null
create or replace function worker_get_proposal(p_user uuid, p_proposal uuid)
returns table (id uuid, action text, payload jsonb, status text, occurred_at timestamptz, captured_at timestamptz)
language sql stable as $$
  select p.id, p.action, p.payload, p.status, i.occurred_at, i.captured_at
  from proposals p join facts f on f.id = p.fact_id and f.user_id = p_user
  left join items i on i.id = f.item_id and i.user_id = p_user
  where p.id = p_proposal and p.user_id = p_user;
$$;

create or replace function worker_list_devices(p_user uuid)
returns table (device_id text, apns_token text, apns_env text) language sql stable as $$
  select d.device_id, d.apns_token, d.apns_env from devices d where d.user_id = p_user order by d.last_seen_at desc;
$$;

-- 처음이면 sending 으로 넣고 true. failed 이거나 5분 넘게 sending 에 머문 행(발송 중 워커 종료)만 다시 가져간다. sent·rejected 는 false
create or replace function claim_proposal_push(p_user uuid, p_proposal uuid, p_device text) returns boolean language plpgsql as $$
declare v uuid;
begin
  if not exists (select 1 from proposals where id = p_proposal and user_id = p_user) then raise exception 'proposal not found'; end if;
  insert into proposal_pushes (user_id, proposal_id, device_id, status) values (p_user, p_proposal, p_device, 'sending')
  on conflict (proposal_id, device_id) do update set status = 'sending', claimed_at = now(), updated_at = now()
    where proposal_pushes.user_id = p_user
      and (proposal_pushes.status = 'failed' or (proposal_pushes.status = 'sending' and proposal_pushes.claimed_at < now() - interval '5 minutes'))
  returning id into v;
  return v is not null;
end $$;

create or replace function finish_proposal_push(p_user uuid, p_proposal uuid, p_device text, p_status text, p_apns_status int,
                                                p_reason text, p_apns_id text, p_env text) returns void language plpgsql as $$
begin
  if p_status not in ('sent', 'failed', 'rejected') then raise exception 'bad status'; end if;
  update proposal_pushes set status = p_status, apns_status = p_apns_status, reason = p_reason, apns_id = p_apns_id, env = p_env, updated_at = now()
  where proposal_id = p_proposal and device_id = p_device and user_id = p_user;
end $$;

revoke execute on function worker_get_proposal(uuid, uuid), worker_list_devices(uuid), claim_proposal_push(uuid, uuid, text),
  finish_proposal_push(uuid, uuid, text, text, int, text, text, text) from public, anon, authenticated;

-- ── PoC 0016_push_recovery.sql ──
-- 0b 수정(2026-09-29): 제안 푸시가 조용히 사라지지 않게 한다(스펙 §7 notify, §8 proposal_pushes)

-- 1) 텍스트 process 잡: save_fact 가 items.status = extracted 를 커밋한 뒤 notify enqueue 전에 끊기면 재시도는 already_processed 로 돌아간다.
--    그 항목의 proposed 제안 중 푸시 기록이 하나도 없는 것을 돌려줘 다시 넣게 한다. 중복 잡은 기기별 1회가 막는다
create or replace function worker_unpushed_proposals(p_user uuid, p_item uuid) returns setof uuid language sql stable as $$
  select p.id from proposals p join facts f on f.id = p.fact_id and f.user_id = p_user
  where f.item_id = p_item and p.user_id = p_user and p.status = 'proposed'
    and not exists (select 1 from proposal_pushes pp where pp.proposal_id = p.id);
$$;

-- 2) claim 결과를 셋으로 나눈다: claimed(보낼 차례) / closed(sent·rejected) / in_flight(잡 임대 180초 안의 sending).
--    in_flight 면 잡이 실패로 끝나 재시도한다. 임대가 지난 sending(발송 중 워커 종료)은 다음 시도가 다시 가져간다.
--    예전 기준(5분)은 죽은 잡의 재시도(임대 만료 후 ≤ 1분)보다 길어서 그 시도가 '이미 보냄'으로 끝나 행이 sending 에 남았다
drop function claim_proposal_push(uuid, uuid, text);
create function claim_proposal_push(p_user uuid, p_proposal uuid, p_device text) returns text language plpgsql as $$
declare v uuid; s text;
begin
  if not exists (select 1 from proposals where id = p_proposal and user_id = p_user) then raise exception 'proposal not found'; end if;
  insert into proposal_pushes (user_id, proposal_id, device_id, status) values (p_user, p_proposal, p_device, 'sending')
  on conflict (proposal_id, device_id) do update set status = 'sending', claimed_at = now(), updated_at = now()
    where proposal_pushes.user_id = p_user
      and (proposal_pushes.status = 'failed' or (proposal_pushes.status = 'sending' and proposal_pushes.claimed_at < now() - interval '180 seconds'))
  returning id into v;
  if v is not null then return 'claimed'; end if;
  select status into s from proposal_pushes where proposal_id = p_proposal and device_id = p_device and user_id = p_user;
  return case when s in ('sent', 'rejected') then 'closed' else 'in_flight' end;   -- 모르면 재시도 쪽으로
end $$;

revoke execute on function worker_unpushed_proposals(uuid, uuid), claim_proposal_push(uuid, uuid, text) from public, anon, authenticated;

-- ── PoC 0017_items_device_filter.sql ──
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

-- ── PoC 0018_devices_stale.sql ──
-- 스펙 §8 devices: 발송 대상은 last_seen_at 7일 안인 기기만(버려진 개발 설치·시뮬레이터 제외).
-- last_seen_at 은 /ingest/device 등록과 /ingest/trace 업로드가 갱신한다
create or replace function worker_list_devices(p_user uuid)
returns table (device_id text, apns_token text, apns_env text) language sql stable as $$
  select d.device_id, d.apns_token, d.apns_env from devices d
  where d.user_id = p_user and d.last_seen_at > now() - interval '7 days'
  order by d.last_seen_at desc;
$$;
