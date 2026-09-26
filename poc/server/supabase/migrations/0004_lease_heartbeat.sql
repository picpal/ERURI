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
