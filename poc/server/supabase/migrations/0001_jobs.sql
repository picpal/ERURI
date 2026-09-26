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
