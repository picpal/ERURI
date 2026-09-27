-- 호스팅 DB 테스트 격리(2026-09-27): 서버 테스트가 실측 중인 잡·연결을 건드리지 않게 전역 함수에 범위 인자를 둔다.
-- 기본값(null)은 기존 동작(워커·cron). 테스트는 자기 실행 태그(lease_key 접두 'test:<run>')나 전용 테스트 사용자로 범위를 좁힌다.
drop function if exists claim_jobs(int, int);
create or replace function claim_jobs(p_limit int, p_lease_seconds int default 180, p_lease_prefix text default null)
returns setof jobs language plpgsql as $$
begin
  perform pg_advisory_xact_lock(hashtext('claim_jobs'));
  return query
  with cand as (
    select j.id, j.lease_key, j.status, j.created_at from jobs j
    where (j.status = 'queued' or (j.status = 'running' and j.leased_until < now()))
      and (case when p_lease_prefix is null then coalesce(j.lease_key, '') not like 'test:%'   -- 워커는 테스트 잡을 가져가지 않는다
                else j.lease_key like p_lease_prefix || '%' end)
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

drop function if exists gmail_enqueue_all(text);
create or replace function gmail_enqueue_all(p_kind text, p_user uuid default null) returns int language plpgsql as $$
declare n int;
begin
  if p_kind not in ('gmail-sync', 'gmail-watch') then raise exception 'bad kind'; end if;
  insert into jobs (kind, user_id, lease_key, payload)
  select p_kind, c.user_id, 'gmail:' || c.id, jsonb_build_object('connection_id', c.id)
  from connections c
  where c.provider = 'gmail' and c.status = 'active' and (p_user is null or c.user_id = p_user)
    and not exists (select 1 from jobs j where j.lease_key = 'gmail:' || c.id and j.kind = p_kind and j.status = 'queued');
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function claim_jobs(int, int, text), gmail_enqueue_all(text, uuid) from public, anon, authenticated;
