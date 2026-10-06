-- 메일 정리(스펙 §7 "메일 정리", §8 mail_actions·gmail_units·connections.scopes, §12 통제 2·4). 2026-10-06 사용자 결정, 앱 0.14.0.
-- 적용은 ③c2 뒤 U6b 의 0029 다음(계획 2026-10-06-mail-cleanup.md D1·M10). 그때까지 supabase/migrations-pending/ 에 둔다 — 다른 계획의 db push 에 딸려 가지 않게.
-- 기존 것에 닿는 것: connections.scopes 열(null 허용), jobs_set_priority 에 kind 하나(20), jobs dead 트리거(kind mail-action 만). 다른 kind 의 동작은 같다.
-- 함수는 모두 service role 전용(mail-action·gmail-connect 함수, 워커). 앱은 mail-action 함수로만 접근한다(표는 RLS 켜고 정책 없음)

alter table connections add column if not exists scopes text[];   -- 마지막 토큰 교환의 승인 scope. null = 0.14.0 전 연결(readonly 로 본다)

create table mail_actions (
  id uuid primary key default gen_random_uuid(),                     -- = 확인 토큰(생성 10분 안에만 실행 시작)
  user_id uuid not null references auth.users(id) on delete cascade,
  connection_id uuid not null references connections(id) on delete cascade,   -- 출처 삭제(delete_gmail_source) → cascade
  action text not null check (action in ('trash', 'read')),
  msg_ids text[] not null check (cardinality(msg_ids) between 1 and 1000),   -- 대상 Gmail id, 순서 고정
  count int not null,
  method text check (method in ('batch', 'single')),
  status text not null default 'previewed' check (status in ('previewed', 'pending', 'running', 'done', 'partial', 'failed',
                                                             'undo_pending', 'undoing', 'undone', 'undo_partial', 'undo_failed')),
  cursor int not null default 0,                                     -- 다음에 처리할 msg_ids 위치(0부터)
  ok_ids text[] not null default '{}',
  failed_ids text[] not null default '{}',
  undo_cursor int not null default 0,                                -- 다음에 되돌릴 ok_ids 위치
  undo_failed_ids text[] not null default '{}',
  error_code text,
  quota_since timestamptz,                                           -- 쿼터 미루기 시작(30분 넘으면 fail_job). 성공 묶음이 지운다
  created_at timestamptz not null default now(),
  executed_at timestamptz,
  undone_at timestamptz
  -- 제목·발신자·본문·검색 칸은 두지 않는다(§12 통제 2)
);
create index mail_actions_user_time on mail_actions (user_id, created_at);   -- 계정 삭제(auth.users) cascade·purge 의 p_user 범위
create index mail_actions_created on mail_actions (created_at);              -- purge 7·8일 범위
create index mail_actions_connection on mail_actions (connection_id);        -- 출처 삭제(connections) cascade
alter table mail_actions enable row level security;

-- 사용자 Gmail units 분 카운터(§7 "속도"): 수집·미리보기는 기록만, 메일 정리 잡은 합계 5,400·자기 몫 4,000 안에서만 가져간다
create table gmail_units (
  user_id uuid not null references auth.users(id) on delete cascade,
  minute timestamptz not null,
  used int not null default 0,
  mail_used int not null default 0,
  primary key (user_id, minute)
);
alter table gmail_units enable row level security;

-- 우선순위(0005): mail-action 은 실시간 Gmail 잡과 같은 20. 나머지 분기는 0005 그대로
create or replace function jobs_set_priority() returns trigger language plpgsql as $$
begin
  new.priority := case
    when coalesce(new.payload->>'backfill', '') = 'true' then 40
    when new.kind = 'notify' then 10
    when new.kind in ('gmail-sync', 'gmail-fetch', 'gmail-watch', 'gmail-reauth', 'mail-action') then 20
    else 30 end;
  return new;
end $$;

create or replace function gmail_note_units(p_user uuid, p_units int) returns void language sql as $$
  insert into gmail_units (user_id, minute, used) values (p_user, date_trunc('minute', now()), greatest(p_units, 0))
  on conflict (user_id, minute) do update set used = gmail_units.used + excluded.used;
$$;
create or replace function gmail_take_units(p_user uuid, p_units int) returns boolean language plpgsql as $$
declare m timestamptz := date_trunc('minute', now()); v_used int; v_mail int;
begin
  if p_units <= 0 then return true; end if;                          -- 가져갈 것 없음: 카운터를 줄이지 않는다
  insert into gmail_units (user_id, minute) values (p_user, m) on conflict (user_id, minute) do nothing;
  select used, mail_used into v_used, v_mail from gmail_units where user_id = p_user and minute = m for update;
  if v_used + p_units > 5400 or v_mail + p_units > 4000 then return false; end if;
  update gmail_units set used = used + p_units, mail_used = mail_used + p_units where user_id = p_user and minute = m;
  return true;
end $$;

-- 사용자 Gmail 연결 하나(최신). 권한 확인(scopes)·upgrade 계정 비교·잡 토큰 실패 사유에 쓴다
create or replace function mail_connection(p_user uuid)
returns table (connection_id uuid, account_ref text, status text, scopes text[]) language sql stable as $$
  select c.id, c.account_ref, c.status, c.scopes from connections c
  where c.user_id = p_user and c.provider = 'gmail' order by c.created_at desc limit 1;
$$;
create or replace function gmail_set_scopes(p_user uuid, p_connection uuid, p_scopes text[]) returns void language sql as $$
  update connections set scopes = p_scopes where id = p_connection and user_id = p_user;
$$;
-- 권한 업데이트(§7): 토큰만 바꾼다 — 연결 행·sync_states(커서·watch)·잡은 그대로. 옛 토큰은 vault 에서 덮어쓸 뿐 revoke 하지 않는다.
-- active 연결만(계획 D12): 끊긴 연결을 되살리면 커서·watch 는 옛 값인데 sync 적재가 없어 동기화가 쉰다 — 끊긴 연결은 기존 재연결 경로로
create or replace function gmail_replace_token(p_user uuid, p_connection uuid, p_refresh_token text, p_scopes text[]) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_secret uuid;
begin
  perform 1 from public.connections where id = p_connection and user_id = p_user and provider = 'gmail' and status = 'active' for update;
  if not found then return false; end if;
  select id into v_secret from vault.secrets where name = 'gmail_rt:' || p_connection;
  if v_secret is null then perform vault.create_secret(p_refresh_token, 'gmail_rt:' || p_connection);
  else perform vault.update_secret(v_secret, p_refresh_token); end if;
  update public.connections set scopes = p_scopes, expires_at = now() + interval '7 days' where id = p_connection;
  return true;
end $$;

create or replace function mail_same_set(a text[], b text[]) returns boolean language sql immutable as $$
  select coalesce((select array_agg(x order by x) from unnest(a) x), '{}') = coalesce((select array_agg(x order by x) from unnest(b) x), '{}');
$$;
-- 상태 응답 모양(§7 진행·결과, 계획 D4). 개수·상태·방식·코드만
create or replace function mail_action_counts(r mail_actions) returns jsonb language sql stable as $$
  select jsonb_build_object('id', r.id, 'status', r.status, 'total', r.count, 'done', cardinality(r.ok_ids),
    'failed', cardinality(r.failed_ids), 'undone', greatest(r.undo_cursor - cardinality(r.undo_failed_ids), 0),
    'undo_failed', cardinality(r.undo_failed_ids), 'code', r.error_code, 'method', r.method);
$$;

create or replace function mail_action_preview(p_user uuid, p_connection uuid, p_action text, p_ids text[]) returns uuid language sql as $$
  insert into mail_actions (user_id, connection_id, action, msg_ids, count)
  select p_user, c.id, p_action, p_ids, cardinality(p_ids) from connections c where c.id = p_connection and c.user_id = p_user
  returning id;
$$;

-- 실행 시작(§7 실행 — 지속 잡): 행 잠금 → 본인 행 → previewed 이고 10분 안이면 pending + 잡. 같은 토큰을 다시 부르면 새 잡 없이 지금 상태.
-- p_lease_prefix 는 테스트 전용('test:<run>:' — 운영 워커가 가져가지 않는다, 0003)
create or replace function mail_action_start(p_user uuid, p_id uuid, p_lease_prefix text default '') returns jsonb language plpgsql as $$
declare r mail_actions;
begin
  if p_lease_prefix <> '' and p_lease_prefix not like 'test:%' then raise exception 'bad prefix'; end if;
  select * into r from mail_actions where id = p_id and user_id = p_user for update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  if r.status <> 'previewed' then return jsonb_build_object('result', 'current') || mail_action_counts(r); end if;
  if r.created_at < now() - interval '10 minutes' then return jsonb_build_object('result', 'expired'); end if;
  update mail_actions set status = 'pending' where id = p_id returning * into r;
  perform enqueue_job(p_user, 'mail-action', p_lease_prefix || 'mail:' || p_user,
    jsonb_build_object('id', p_id, 'phase', 'execute', 'connection_id', r.connection_id));   -- connection_id: 출처 삭제가 잡도 지운다(0013)
  return jsonb_build_object('result', 'started') || mail_action_counts(r);
end $$;

-- 되돌리기 시작(§7): done·partial 이고 성공 id 가 있고 7일 안일 때만. 진행 중 busy, 되돌리기 상태면 지금 상태(한 번뿐)
create or replace function mail_action_undo(p_user uuid, p_id uuid, p_lease_prefix text default '') returns jsonb language plpgsql as $$
declare r mail_actions;
begin
  if p_lease_prefix <> '' and p_lease_prefix not like 'test:%' then raise exception 'bad prefix'; end if;
  select * into r from mail_actions where id = p_id and user_id = p_user for update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  if r.status in ('pending', 'running') then return jsonb_build_object('result', 'busy') || mail_action_counts(r); end if;
  if r.status in ('undo_pending', 'undoing', 'undone', 'undo_partial', 'undo_failed') then
    return jsonb_build_object('result', 'current') || mail_action_counts(r);
  end if;
  if r.status not in ('done', 'partial') or cardinality(r.ok_ids) = 0 then
    return jsonb_build_object('result', 'nothing_to_undo') || mail_action_counts(r);
  end if;
  if r.created_at < now() - interval '7 days' then return jsonb_build_object('result', 'expired'); end if;
  -- 연결 문제로 돌려받은 되돌리기(undo_<코드>)를 다시 시작하면 그 코드는 지운다 — 새 되돌리기 결과에 낡은 코드가 실리지 않게
  update mail_actions set status = 'undo_pending', error_code = case when error_code like 'undo_%' then null else error_code end
  where id = p_id returning * into r;
  perform enqueue_job(p_user, 'mail-action', p_lease_prefix || 'mail:' || p_user,
    jsonb_build_object('id', p_id, 'phase', 'undo', 'connection_id', r.connection_id));
  return jsonb_build_object('result', 'started') || mail_action_counts(r);
end $$;

create or replace function mail_action_status(p_user uuid, p_id uuid) returns jsonb language sql stable as $$
  select mail_action_counts(m) from mail_actions m where m.id = p_id and m.user_id = p_user;
$$;

-- 워커: pending→running(실행) / undo_pending→undoing(되돌리기). 끝난 행이면 상태만, 없으면 null
create or replace function mail_action_begin(p_user uuid, p_id uuid, p_phase text) returns jsonb language plpgsql as $$
declare r mail_actions;
begin
  if p_phase not in ('execute', 'undo') then raise exception 'bad phase'; end if;
  select * into r from mail_actions where id = p_id and user_id = p_user for update;
  if not found then return null; end if;
  if p_phase = 'execute' and r.status = 'pending' then update mail_actions set status = 'running' where id = p_id returning * into r;
  elsif p_phase = 'undo' and r.status = 'undo_pending' then update mail_actions set status = 'undoing' where id = p_id returning * into r;
  end if;
  if (p_phase = 'execute' and r.status <> 'running') or (p_phase = 'undo' and r.status <> 'undoing') then
    return jsonb_build_object('status', r.status);
  end if;
  return jsonb_build_object('status', r.status, 'action', r.action, 'method', r.method, 'connection_id', r.connection_id,
    'ids', to_jsonb(case when p_phase = 'execute' then r.msg_ids else r.ok_ids end),
    'cursor', case when p_phase = 'execute' then r.cursor else r.undo_cursor end);
end $$;

-- 실행 단계 방식 기록: null → batch|single, batch → single 만(되돌리기는 이 값을 따른다, 계획 D9)
create or replace function mail_action_set_method(p_user uuid, p_id uuid, p_method text) returns void language sql as $$
  update mail_actions set method = p_method
  where id = p_id and user_id = p_user and status = 'running' and p_method in ('batch', 'single')
    and (method is null or (method = 'batch' and p_method = 'single'));
$$;

-- 묶음 결과(§7 id별 결과, 계획 D8): 지금 커서가 p_from 이고, 붙일 id 가 정확히 그 구간이면 붙이고 커서를 민다. 아니면 false(늦게 깬 워커)
create or replace function mail_action_progress(p_user uuid, p_id uuid, p_phase text, p_from int, p_cursor int, p_ok text[], p_failed text[])
returns boolean language plpgsql as $$
declare v_ok text[] := coalesce(p_ok, '{}'); v_failed text[] := coalesce(p_failed, '{}');
begin
  if p_cursor <= p_from or cardinality(v_ok) + cardinality(v_failed) <> p_cursor - p_from then return false; end if;
  if p_phase = 'execute' then
    update mail_actions set ok_ids = ok_ids || v_ok, failed_ids = failed_ids || v_failed, cursor = p_cursor, quota_since = null
    where id = p_id and user_id = p_user and status = 'running' and cursor = p_from and p_cursor <= cardinality(msg_ids)
      and mail_same_set(v_ok || v_failed, msg_ids[p_from + 1:p_cursor]);
  elsif p_phase = 'undo' then
    update mail_actions set undo_failed_ids = undo_failed_ids || v_failed, undo_cursor = p_cursor, quota_since = null
    where id = p_id and user_id = p_user and status = 'undoing' and undo_cursor = p_from and p_cursor <= cardinality(ok_ids)
      and mail_same_set(v_ok || v_failed, ok_ids[p_from + 1:p_cursor]);
  else
    return false;
  end if;
  return found;
end $$;

-- 쿼터 미루기 시작 시각(30분 판정, 계획 D7). 처음이면 지금으로 두고 그 값을 돌려준다. 진행 중(running·undoing)이 아니면 null
create or replace function mail_action_quota(p_user uuid, p_id uuid) returns timestamptz language sql as $$
  update mail_actions set quota_since = coalesce(quota_since, now())
  where id = p_id and user_id = p_user and status in ('running', 'undoing') returning quota_since;
$$;

-- 마감(§7): 커서 뒤 남은 id 를 실패로 적고 종료 상태·감사(개수만). 이미 끝났으면 바꾸지 않는다(멱등).
-- 남은 id 가 없으면 p_code 를 적지 않는다(마지막 기록 뒤 잡이 죽어도 done 에 job_dead 가 붙지 않게, 계획 D11)
create or replace function mail_action_finish(p_user uuid, p_id uuid, p_phase text, p_code text default null) returns jsonb language plpgsql as $$
declare r mail_actions; v_status text; v_rest text[];
begin
  select * into r from mail_actions where id = p_id and user_id = p_user for update;
  if not found then return null; end if;
  if p_phase = 'execute' then
    if r.status not in ('pending', 'running') then return mail_action_counts(r); end if;
    v_rest := coalesce(r.msg_ids[(r.cursor + 1):], '{}');
    r.failed_ids := r.failed_ids || v_rest;
    v_status := case when cardinality(r.ok_ids) = 0 then 'failed' when cardinality(r.failed_ids) = 0 then 'done' else 'partial' end;
    update mail_actions set failed_ids = r.failed_ids, cursor = cardinality(r.msg_ids), status = v_status,
      error_code = case when cardinality(v_rest) > 0 then coalesce(p_code, error_code) else error_code end,
      executed_at = now(), quota_since = null where id = p_id returning * into r;
    insert into audit_log (user_id, actor, action, target) values (p_user, 'mail-action',
      case when r.action = 'trash' then 'mail_trash' else 'mail_read' end,
      'mail_action:' || p_id || ' ok=' || cardinality(r.ok_ids) || ' failed=' || cardinality(r.failed_ids));
  elsif p_phase = 'undo' then
    if r.status not in ('undo_pending', 'undoing') then return mail_action_counts(r); end if;
    -- 연결 문제로 하나도 되돌리지 못했으면 되돌리기를 쓰지 않은 것으로 돌린다 — 다시 연결한 뒤 되돌릴 수 있게(계획 D11, Fable N-H1).
    -- 상태는 실행 종료 상태로, 코드는 undo_<코드>(앱 문구), 감사 없음(Gmail 이 바뀌지 않았다)
    if p_code in ('reauth_required', 'no_connection') and r.undo_cursor = 0 then
      update mail_actions set status = case when cardinality(r.failed_ids) = 0 then 'done' else 'partial' end,
        error_code = 'undo_' || p_code, quota_since = null where id = p_id returning * into r;
      return mail_action_counts(r);
    end if;
    v_rest := coalesce(r.ok_ids[(r.undo_cursor + 1):], '{}');
    r.undo_failed_ids := r.undo_failed_ids || v_rest;
    v_status := case when cardinality(r.undo_failed_ids) = 0 then 'undone'
                     when cardinality(r.undo_failed_ids) >= cardinality(r.ok_ids) then 'undo_failed' else 'undo_partial' end;
    update mail_actions set undo_failed_ids = r.undo_failed_ids, undo_cursor = cardinality(r.ok_ids), status = v_status,
      error_code = case when cardinality(v_rest) > 0 then coalesce(p_code, error_code) else error_code end,
      undone_at = now(), quota_since = null where id = p_id returning * into r;
    insert into audit_log (user_id, actor, action, target) values (p_user, 'mail-action', 'mail_undo',
      'mail_action:' || p_id || ' undone=' || (cardinality(r.ok_ids) - cardinality(r.undo_failed_ids)) || ' failed=' || cardinality(r.undo_failed_ids));
  else
    raise exception 'bad phase';
  end if;
  return mail_action_counts(r);
end $$;

-- 잡이 dead 만 되면(워커가 마감 전에 죽음) 남은 id 를 재조회 없이 실패로 마감한다(§7 결과 불명·재개)
create or replace function mail_action_job_dead() returns trigger language plpgsql as $$
begin
  begin
    perform mail_action_finish(new.user_id, (new.payload->>'id')::uuid, coalesce(new.payload->>'phase', 'execute'), 'job_dead');
  exception when others then
    raise warning 'mail_action_job_dead %', sqlstate;       -- 마감 실패가 fail_job(잡 상태 변경)을 막지 않게
  end;
  return new;
end $$;
create trigger jobs_mail_action_dead after update of status on jobs for each row
  when (new.kind = 'mail-action' and new.status = 'dead' and old.status is distinct from 'dead')
  execute function mail_action_job_dead();

-- 보관(§7·§8): 생성 7일 지난 행(진행 중은 끝난 뒤), 1시간 지난 units 행. p_user = 테스트 범위.
-- 안전망: 생성 8일 지났는데 살아 있는 잡이 없는 진행 중 행은 먼저 job_lost 로 마감한다(잡이 지워져 영원히 남는 행이 없게)
create or replace function purge_mail_actions(p_user uuid default null) returns jsonb language plpgsql as $$
declare a int; u int; l int;
begin
  perform mail_action_finish(m.user_id, m.id, case when m.status in ('pending', 'running') then 'execute' else 'undo' end, 'job_lost')
  from mail_actions m
  where m.created_at < now() - interval '8 days' and m.status in ('pending', 'running', 'undo_pending', 'undoing')
    and (p_user is null or m.user_id = p_user)
    and not exists (select 1 from jobs j where j.kind = 'mail-action' and j.payload->>'id' = m.id::text and j.status in ('queued', 'running'));
  get diagnostics l = row_count;
  delete from mail_actions where created_at < now() - interval '7 days'
    and status not in ('pending', 'running', 'undo_pending', 'undoing') and (p_user is null or user_id = p_user);
  get diagnostics a = row_count;
  delete from gmail_units where minute < now() - interval '1 hour' and (p_user is null or user_id = p_user);
  get diagnostics u = row_count;
  return jsonb_build_object('mail_actions', a, 'gmail_units', u, 'lost', l);
end $$;

revoke execute on function gmail_note_units(uuid, int), gmail_take_units(uuid, int), mail_connection(uuid), gmail_set_scopes(uuid, uuid, text[]),
  gmail_replace_token(uuid, uuid, text, text[]), mail_same_set(text[], text[]), mail_action_counts(mail_actions),
  mail_action_preview(uuid, uuid, text, text[]), mail_action_start(uuid, uuid, text), mail_action_undo(uuid, uuid, text),
  mail_action_status(uuid, uuid), mail_action_begin(uuid, uuid, text), mail_action_set_method(uuid, uuid, text),
  mail_action_progress(uuid, uuid, text, int, int, text[], text[]), mail_action_quota(uuid, uuid), mail_action_finish(uuid, uuid, text, text),
  mail_action_job_dead(), purge_mail_actions(uuid) from public, anon, authenticated;

-- UTC 04:53(KST 13:53). 다른 cron(매분, 매시 7분, 6시간 0분, 03:17·03:41·04:23·04:33·04:43·19:27 UTC)과 겹치지 않는다
select cron.schedule('mail-actions-purge-daily', '53 4 * * *', $$ select purge_mail_actions(); $$);
