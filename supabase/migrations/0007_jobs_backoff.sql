-- 스펙 §7 재시도 간격: fail_job 이 다음 시도 시각 not_before = now() + attempts × 60초 를 두고, claim_jobs 는 그 전에는 가져가지 않는다.
-- 워커 호출 1회가 클레임을 반복하므로(0005) 간격이 없으면 일시 오류(APNs·OpenAI 429·5xx) 잡이 같은 호출 안에서 수 초 만에 5회를 다 쓰고 dead 가 된다.
-- 1→5회 사이 대기 60·120·180·240초(합 10분). not_before 는 M2-⑦ defer_job(예산·슬롯 미루기)도 같이 쓴다
alter table jobs add column if not exists not_before timestamptz;

create or replace function fail_job(p_id uuid, p_error text) returns void language sql as $$
  update jobs set status = case when attempts >= 5 then 'dead' else 'queued' end,
                  not_before = case when attempts >= 5 then not_before else now() + make_interval(secs => attempts * 60) end,
                  last_error = p_error, leased_until = null, updated_at = now() where id = p_id;
$$;

-- 0005 와 같고 not_before 조건만 더했다(같은 시그니처라 권한은 유지된다)
create or replace function claim_jobs(p_limit int, p_lease_seconds int default 180, p_lease_prefix text default null)
returns setof jobs language plpgsql as $$
begin
  perform pg_advisory_xact_lock(hashtext('claim_jobs'));
  return query
  with cand as (
    select j.id, j.lease_key, j.status, j.priority, j.created_at from jobs j
    where (j.status = 'queued' or (j.status = 'running' and j.leased_until < now()))
      and (j.not_before is null or j.not_before <= now())
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
