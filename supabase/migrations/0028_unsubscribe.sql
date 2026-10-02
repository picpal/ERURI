-- 광고 구독 해지 제안(스펙 §7 "광고 구독 해지", §8 unsub_senders·unsub_mail, §12). 새 표·함수·cron 만 — 기존 표·함수·행을 바꾸지 않는다
-- (Gmail 측정 기간에도 창 밖에서 push 가능, 계획 2026-10-01-gmail-unsubscribe.md Global Constraints)
create table unsub_senders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  connection_id uuid not null references connections(id) on delete cascade,   -- 출처 삭제(delete_gmail_source 가 연결 행 삭제) → cascade
  address text not null,                     -- From 주소(소문자). items.sender 와 같은 등급의 평문(§12 통제 1)
  display_name text,                         -- ≤60자
  last_seen_at timestamptz not null,
  status text not null default 'active' check (status in ('active', 'requesting', 'requested', 'failed')),
  status_at timestamptz,
  requested_at timestamptz,
  result_code text,
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  unique (connection_id, address)
  -- 해지 방법·URL 은 두지 않는다: 메일 행(unsub_mail)에서 광고로 세는 것만 고른다(리뷰 H2), URL 이 발신자 180일 보존에 끌려가지 않게
);
create table unsub_mail (
  user_id uuid not null references auth.users(id) on delete cascade,
  sender_id uuid not null references unsub_senders(id) on delete cascade,
  msg_key text not null,                     -- 'gmail:<id>'
  occurred_at timestamptz not null,
  item_id uuid references items(id) on delete cascade,   -- null = 규칙 광고. 있으면 그 항목이 게이트 promo 폐기일 때만 센다
  method text not null check (method in ('one_click', 'unverified', 'link_only', 'mailto', 'none')),
  url_enc bytea,                             -- one_click 해지 URL, 사용자 키 AES-256-GCM. 35일 뒤 행과 함께 삭제
  primary key (user_id, msg_key),
  check (method = 'one_click' or url_enc is null)
);
create index unsub_mail_sender_time on unsub_mail (sender_id, occurred_at);
create index unsub_mail_item on unsub_mail (item_id) where item_id is not null;
alter table unsub_senders enable row level security;
alter table unsub_mail enable row level security;
-- 정책 없음: 앱은 표를 직접 읽지 않고 unsub_list() 만 부른다(url_enc 를 클라이언트로 보내지 않는다)

-- gmail-fetch·스캔이 부른다. 연결이 이미 없으면 기록하지 않는다(null). 발신자 행은 더 최근 메일만 이름을 덮는다.
-- 같은 메일을 다시 읽으면(sync 뒤 스캔) item_id 만 보충한다
create or replace function worker_record_unsub(p_user uuid, p_connection uuid, p_address text, p_name text, p_method text,
  p_url_enc bytea, p_msg_key text, p_occurred_at timestamptz, p_item uuid default null) returns uuid language plpgsql as $$
declare v_id uuid;
begin
  if not exists (select 1 from connections where id = p_connection and user_id = p_user) then return null; end if;
  insert into unsub_senders as s (user_id, connection_id, address, display_name, last_seen_at)
  values (p_user, p_connection, lower(p_address), left(p_name, 60), p_occurred_at)
  on conflict (connection_id, address) do update set
    display_name = case when excluded.last_seen_at >= s.last_seen_at then coalesce(excluded.display_name, s.display_name) else s.display_name end,
    last_seen_at = greatest(s.last_seen_at, excluded.last_seen_at)
  returning id into v_id;
  insert into unsub_mail (user_id, sender_id, msg_key, occurred_at, item_id, method, url_enc)
  values (p_user, v_id, p_msg_key, p_occurred_at, p_item, p_method, case when p_method = 'one_click' then p_url_enc end)
  on conflict (user_id, msg_key) do update set item_id = coalesce(unsub_mail.item_id, excluded.item_id);
  return v_id;
end $$;

-- 광고로 세는 메일: 규칙 광고(item 없음) 또는 게이트 promo 폐기 항목. 복구되면(status 변경) 빠진다
create or replace function unsub_ad_mail(p_user uuid) returns table (sender_id uuid, msg_key text, occurred_at timestamptz, method text)
language sql stable as $$
  select m.sender_id, m.msg_key, m.occurred_at, m.method from unsub_mail m left join items i on i.id = m.item_id
  where m.user_id = p_user and (m.item_id is null or i.status = 'discarded:server:promo');
$$;

-- 발신자의 해지 방법·URL(리뷰 H2): 광고로 세는 메일 중 one_click 이 있으면 가장 최근 one_click, 없으면 가장 최근 메일.
-- 같은 From 의 거래·뉴스레터 메일(게이트 통과 항목)은 고르지 않는다. 없으면 0행
create or replace function unsub_best(p_user uuid, p_sender uuid) returns table (method text, url_enc bytea, msg_key text)
language sql stable as $$
  select m.method, m.url_enc, m.msg_key from unsub_mail m left join items i on i.id = m.item_id
  where m.user_id = p_user and m.sender_id = p_sender and (m.item_id is null or i.status = 'discarded:server:promo')
  order by (m.method = 'one_click') desc, m.occurred_at desc, m.msg_key desc
  limit 1;
$$;

-- 30일 스캔이 헤더를 다시 읽을 게이트 promo 항목(아직 기록 없는 것). 운영 키 형식 'gmail:<id>' 만
create or replace function unsub_scan_targets(p_user uuid, p_since timestamptz) returns table (gmail_id text, item_id uuid) language sql stable as $$
  select substr(i.idempotency_key, 7), i.id from items i
  where i.user_id = p_user and i.source = 'GMAIL' and i.status = 'discarded:server:promo'
    and i.occurred_at >= p_since and i.idempotency_key like 'gmail:%'
    and not exists (select 1 from unsub_mail m where m.user_id = p_user and m.msg_key = i.idempotency_key);
$$;

-- 운영자가 ③c2 뒤 워커 배포 직후 한 번 부른다(계획 U6b). 백필 레인 lease 'backfill:<user>'(연결 시 90일 백필과 같은 레인 — 실시간
-- sync 의 'gmail:<connection>' 을 막지 않고 계정 Gmail 호출이 직렬, 리뷰 M3). 테스트는 p_lease_prefix 'test:<run>:'(운영 워커 제외, 0003).
-- 대기 중 검사는 같은 lease(접두 포함)로만 — 테스트 잡이 운영 스캔을 막지 않고, 실행끼리도 서로 막지 않는다(Codex 재확인 MED 2)
create or replace function gmail_enqueue_unsub_scan(p_user uuid, p_lease_prefix text default '') returns int language plpgsql as $$
declare n int; v_lease text := p_lease_prefix || 'backfill:' || p_user;
begin
  if p_lease_prefix <> '' and p_lease_prefix not like 'test:%' then raise exception 'bad prefix'; end if;
  insert into jobs (kind, user_id, lease_key, payload)
  select 'gmail-unsub-scan', c.user_id, v_lease, jsonb_build_object('connection_id', c.id, 'backfill', true, 'lease_key', v_lease)
  from connections c
  where c.user_id = p_user and c.provider = 'gmail' and c.status = 'active'
    and not exists (select 1 from jobs j where j.user_id = p_user and j.kind = 'gmail-unsub-scan' and j.lease_key = v_lease
                    and j.status in ('queued', 'running'));
  get diagnostics n = row_count;
  return n;
end $$;

-- Edge unsubscribe 가 부른다. 행 잠금으로 같은 발신자 동시 요청을 직렬화. 60초 안 재요청 busy, 60초 넘은 requesting 은 다시 시작.
-- URL 은 이 시점의 광고 메일에서 다시 고른다(unsub_best) — 목록을 본 뒤 바뀌어도 같은 발신자의 광고 해지 주소다
create or replace function unsub_begin(p_user uuid, p_sender uuid) returns jsonb language plpgsql as $$
declare s unsub_senders; b record; v_after int;
begin
  select * into s from unsub_senders where id = p_sender and user_id = p_user for update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  select * into b from unsub_best(p_user, p_sender);
  if not found or b.method <> 'one_click' or b.url_enc is null then return jsonb_build_object('result', 'unsupported'); end if;
  if s.status = 'requesting' and s.status_at > now() - interval '60 seconds' then return jsonb_build_object('result', 'busy'); end if;
  if s.status = 'requested' then
    select count(*) into v_after from unsub_ad_mail(p_user) a
    where a.sender_id = p_sender and a.occurred_at > s.requested_at + interval '3 days';
    if v_after = 0 then return jsonb_build_object('result', 'already'); end if;
  end if;
  if s.attempts >= 5 then return jsonb_build_object('result', 'limit'); end if;
  update unsub_senders set status = 'requesting', status_at = now(), attempts = attempts + 1 where id = p_sender;
  insert into audit_log (user_id, actor, action, target) values (p_user, 'unsubscribe', 'decrypt', 'unsub:' || p_sender);
  return jsonb_build_object('result', 'ok', 'url_enc', b.url_enc);
end $$;

-- 2xx('ok')만 접수. 3xx(redirect_<n>)·차단·오류는 failed(리뷰 M1)
create or replace function unsub_finish(p_user uuid, p_sender uuid, p_code text) returns void language plpgsql as $$
declare v_ok boolean := p_code = 'ok';
begin
  update unsub_senders set status = case when v_ok then 'requested' else 'failed' end, status_at = now(),
    requested_at = case when v_ok then now() else requested_at end, result_code = left(p_code, 40)
  where id = p_sender and user_id = p_user and status = 'requesting';
  insert into audit_log (user_id, actor, action, target) values (p_user, 'unsubscribe', 'unsubscribe', 'unsub:' || p_sender || ' ' || left(p_code, 40));
end $$;

-- 앱 목록(authenticated). url_enc 는 내보내지 않는다. 발신자 기준 left join — 광고 메일 행이 정리돼도 30일 안 요청·실패는 남는다(리뷰 M6)
create or replace function unsub_list() returns table (sender_id uuid, display_name text, address text, method text, status text,
  status_at timestamptz, requested_at timestamptz, result_code text, ads_30d int, ads_after_request int, last_ad_at timestamptz, can_request boolean)
language sql stable security definer set search_path = public as $$
  with ad as (select a.sender_id, a.occurred_at from unsub_ad_mail((select auth.uid())) a),
  agg as (
    select s.id, s.display_name, s.address, s.status, s.status_at, s.requested_at, s.result_code, s.attempts,
      (count(ad.occurred_at) filter (where ad.occurred_at >= now() - interval '30 days'))::int as n30,
      (count(ad.occurred_at) filter (where s.requested_at is not null and ad.occurred_at > s.requested_at + interval '3 days'))::int as n_after,
      max(ad.occurred_at) as last_at
    from unsub_senders s left join ad on ad.sender_id = s.id
    where s.user_id = (select auth.uid())
    group by s.id)
  select agg.id, agg.display_name, agg.address, coalesce(b.method, 'none'), agg.status, agg.status_at, agg.requested_at, agg.result_code,
         agg.n30, agg.n_after, agg.last_at, agg.attempts < 5
  from agg left join lateral unsub_best((select auth.uid()), agg.id) b on true
  where agg.n30 > 0 or (agg.status in ('requested', 'failed') and agg.status_at >= now() - interval '30 days')
  order by agg.n30 desc, agg.last_at desc nulls last
  limit 100;
$$;

-- 35일 지난 메일 행(URL 포함), 메일 행 없고 마지막 수신 35일 지난 발신자(해지 요청 180일 이내 제외).
-- p_user·p_connection = 테스트 범위(공유 테스트 사용자에서 이번 실행의 연결만, Codex 재확인 MED 2). cron 은 인자 없이 전체
create or replace function purge_unsub(p_user uuid default null, p_connection uuid default null) returns jsonb language plpgsql as $$
declare n_mail int; n_send int;
begin
  delete from unsub_mail m where m.occurred_at < now() - interval '35 days' and (p_user is null or m.user_id = p_user)
    and (p_connection is null or m.sender_id in (select s.id from unsub_senders s where s.connection_id = p_connection));
  get diagnostics n_mail = row_count;
  delete from unsub_senders s where (p_user is null or s.user_id = p_user) and (p_connection is null or s.connection_id = p_connection)
    and not exists (select 1 from unsub_mail m where m.sender_id = s.id)
    and s.last_seen_at < now() - interval '35 days'
    and (s.requested_at is null or s.requested_at < now() - interval '180 days');
  get diagnostics n_send = row_count;
  return jsonb_build_object('mail', n_mail, 'senders', n_send);
end $$;

-- 실측 집계(계획 U6b·U10, unsub-stats.ts). 개수·방법·상태·결과 코드만 — 주소·이름·URL 없음. 서버에서 세므로 PostgREST 행 상한과 무관(리뷰 M8).
-- p_jobs_since 가 있으면 그 뒤에 만든 스캔 잡만 센다(이번 스캔 실행 대조)
create or replace function unsub_stats(p_user uuid, p_jobs_since timestamptz default null) returns jsonb language sql stable as $$
  with ad as (select * from unsub_ad_mail(p_user) a where a.occurred_at >= now() - interval '30 days'),
  s as (
    select s.id, s.status, s.result_code, coalesce(b.method, 'none') as method, exists (select 1 from ad where ad.sender_id = s.id) as has_ad
    from unsub_senders s left join lateral unsub_best(p_user, s.id) b on true
    where s.user_id = p_user),
  j as (
    select kind || ':' || status as k from jobs
    where user_id = p_user and kind in ('gmail-unsub-scan', 'gmail-unsub-fetch') and (p_jobs_since is null or created_at >= p_jobs_since))
  select jsonb_build_object(
    'senders', (select count(*) from s),
    'senders_with_ads_30d', (select count(*) from s where has_ad),
    'ads_30d', (select count(*) from ad),
    'method_of_senders_with_ads', coalesce((select jsonb_object_agg(method, n) from (select method, count(*) as n from s where has_ad group by method) x), '{}'::jsonb),
    'status', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) as n from s group by status) x), '{}'::jsonb),
    'result_codes', coalesce((select jsonb_object_agg(result_code, n) from (select result_code, count(*) as n from s where result_code is not null group by result_code) x), '{}'::jsonb),
    'jobs', coalesce((select jsonb_object_agg(k, n) from (select k, count(*) as n from j group by k) x), '{}'::jsonb));
$$;

revoke execute on function worker_record_unsub(uuid, uuid, text, text, text, bytea, text, timestamptz, uuid), unsub_ad_mail(uuid),
  unsub_best(uuid, uuid), unsub_scan_targets(uuid, timestamptz), gmail_enqueue_unsub_scan(uuid, text), unsub_begin(uuid, uuid),
  unsub_finish(uuid, uuid, text), purge_unsub(uuid, uuid), unsub_stats(uuid, timestamptz) from public, anon, authenticated;
revoke execute on function unsub_list() from public, anon;
grant execute on function unsub_list() to authenticated;

select cron.schedule('unsub-purge-daily', '43 4 * * *', $$ select purge_unsub(); $$);
