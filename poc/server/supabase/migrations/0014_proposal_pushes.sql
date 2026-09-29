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
