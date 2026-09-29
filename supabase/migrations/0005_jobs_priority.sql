-- 스펙 §7 jobs 우선순위(1단계): notify > gmail-sync > process > backfill. 백필은 사용자당 동시 1개(PoC-6: 백필 process 37건 뒤 sync 11분 대기).
-- 우선순위는 insert 트리거가 kind·payload.backfill 로 정한다(모든 적재 경로에 같은 규칙). 백필 잡은 lease_key 'backfill:<user_id>' 를 같이 써
-- 기존 lease 규칙(같은 키 running 1개)이 사용자당 1개를 보장한다. claimed_at = 첫 클레임 시각(M1-③ 게이트: 웹훅→sync 지연)
alter table jobs add column priority smallint not null default 30;
alter table jobs add column claimed_at timestamptz;
create index jobs_queued_priority on jobs (priority, created_at) where status = 'queued';

create or replace function jobs_set_priority() returns trigger language plpgsql as $$
begin
  new.priority := case
    when coalesce(new.payload->>'backfill', '') = 'true' then 40
    when new.kind = 'notify' then 10
    when new.kind in ('gmail-sync', 'gmail-fetch', 'gmail-watch', 'gmail-reauth') then 20
    else 30 end;
  return new;
end $$;
create trigger jobs_priority before insert on jobs for each row execute function jobs_set_priority();

drop function if exists claim_jobs(int, int, text);
create or replace function claim_jobs(p_limit int, p_lease_seconds int default 180, p_lease_prefix text default null)
returns setof jobs language plpgsql as $$
begin
  perform pg_advisory_xact_lock(hashtext('claim_jobs'));
  return query
  with cand as (
    select j.id, j.lease_key, j.status, j.priority, j.created_at from jobs j
    where (j.status = 'queued' or (j.status = 'running' and j.leased_until < now()))
      and (case when p_lease_prefix is null then coalesce(j.lease_key, '') not like 'test:%'   -- 워커는 테스트 잡을 가져가지 않는다
                else j.lease_key like p_lease_prefix || '%' end)
      and not exists (select 1 from jobs r where r.status = 'running' and r.leased_until >= now()
                      and r.lease_key = j.lease_key and r.id <> j.id)
    order by j.priority, j.created_at
    for update skip locked
  ), one_per_key as (
    select distinct on (coalesce(lease_key, id::text)) id, priority, created_at from cand
    order by coalesce(lease_key, id::text), (status = 'running') desc, priority, created_at
  ), upd as (
    update jobs set status = 'running', leased_until = now() + make_interval(secs => p_lease_seconds),
                    attempts = attempts + 1, updated_at = now(), claimed_at = coalesce(claimed_at, now())
    where id in (select id from one_per_key order by priority, created_at limit p_limit)
    returning *
  )
  select * from upd order by priority, created_at;   -- update … returning 은 순서를 보장하지 않는다
end $$;

-- 백필 항목의 process 잡은 백필 레인으로(0017 시그니처 + p_backfill). 오버로드를 피하려고 지우고 다시 만든다
drop function insert_item(uuid, text, text, text, text, bytea, timestamptz, boolean, text, bytea, text);
create function insert_item(p_user uuid, p_source text, p_idempotency_key text, p_sender text, p_title text,
                            p_content_enc bytea, p_occurred_at timestamptz, p_enqueue boolean default true,
                            p_app_name text default null, p_ocr_text_enc bytea default null, p_device_filter text default null,
                            p_backfill boolean default false)
returns uuid language plpgsql as $$
declare v_id uuid;
begin
  insert into items (user_id, source, app_name, sender, title, content_enc, ocr_text_enc, occurred_at, idempotency_key, device_filter)
  values (p_user, p_source, p_app_name, p_sender, p_title, p_content_enc, p_ocr_text_enc, p_occurred_at, p_idempotency_key, p_device_filter)
  on conflict (user_id, idempotency_key) do nothing
  returning id into v_id;
  if v_id is not null and p_enqueue then
    insert into jobs (kind, user_id, lease_key, payload)
    values ('process', p_user, case when p_backfill then 'backfill:' || p_user else 'item:' || v_id end,
            jsonb_build_object('item_id', v_id) || case when p_backfill then '{"backfill": true}'::jsonb else '{}'::jsonb end);
  end if;
  return v_id;                            -- 중복이면 null
end $$;

-- 웹훅이 넣은 sync 표식(via = webhook). 게이트가 cron 대조 sync 와 구분한다
create or replace function gmail_enqueue_for_account(p_account_ref text) returns uuid language sql as $$
  insert into jobs (kind, user_id, lease_key, payload)
  select 'gmail-sync', c.user_id, 'gmail:' || c.id, jsonb_build_object('connection_id', c.id, 'via', 'webhook')
  from connections c
  where c.provider = 'gmail' and c.account_ref = p_account_ref and c.status = 'active'
    and not exists (select 1 from jobs j where j.lease_key = 'gmail:' || c.id and j.kind = 'gmail-sync' and j.status = 'queued')
  returning id;
$$;

-- 백필 1회 예산(§13): 백필 항목의 추출 토큰은 월 extract_tokens 와 따로 센다
alter table usage_counters add column backfill_tokens bigint not null default 0;
drop function add_extract_tokens(uuid, bigint);
create function add_extract_tokens(p_user uuid, p_tokens bigint, p_backfill boolean default false) returns void language sql as $$
  insert into usage_counters (user_id, month, extract_tokens, backfill_tokens)
  values (p_user, seoul_month(), case when p_backfill then 0 else p_tokens end, case when p_backfill then p_tokens else 0 end)
  on conflict (user_id, month) do update set extract_tokens = usage_counters.extract_tokens + excluded.extract_tokens,
                                             backfill_tokens = usage_counters.backfill_tokens + excluded.backfill_tokens;
$$;

revoke execute on function jobs_set_priority(), claim_jobs(int, int, text),
  insert_item(uuid, text, text, text, text, bytea, timestamptz, boolean, text, bytea, text, boolean),
  gmail_enqueue_for_account(text), add_extract_tokens(uuid, bigint, boolean) from public, anon, authenticated;
