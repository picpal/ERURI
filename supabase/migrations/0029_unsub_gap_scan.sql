-- 광고 구독 해지 일일 공백 스캔(스펙 §7 도착 경로, 리뷰 U4-I2).
-- 주간 재인증(테스트 모드 7일)은 재연결 → gmail_save_connection 이 커서를 새 historyId 로 덮어 history 모드가 유지된다 → resync 훅이 돌지 않고,
-- 재연결 백필은 -category:promotions 라 reauth_required 기간의 프로모션 광고가 어느 경로로도 기록되지 않는다.
-- 그래서 하루 1회 활성 Gmail 연결마다 최근 8일(재인증 공백 7일 + 하루) 헤더 스캔 잡을 넣는다. 0028 의 잡·payload 형식을 그대로 쓰고
-- payload.after(epoch 초, 숫자)만 더한다 — 워커 gmailUnsubScan 이 이미 after 로 목록 질의·게이트 대상을 좁히고 30일로 자른다.
-- 실시간 기록이 빠진 것(잡 로컬 차단기 unsub_record_skipped, 실시간 경로 0건 F2)도 이 스캔이 메운다. 기록은 msg_key 로 멱등.
-- 적용은 U6b(워커 배포 뒤) — 먼저 적용하면 배포된 워커가 모르는 잡 kind → dead.

-- p_after 를 더한다. 인자 목록이 바뀌어 create or replace 는 오버로드를 만든다(이름 호출 (p_user, p_lease_prefix) 가 모호해짐) → 지우고 다시 만든다.
-- 0028 호출 형식(p_user[, p_lease_prefix])은 그대로 동작하고 payload 도 같다(after 없음)
drop function if exists gmail_enqueue_unsub_scan(uuid, text);
create or replace function gmail_enqueue_unsub_scan(p_user uuid, p_lease_prefix text default '', p_after timestamptz default null)
returns int language plpgsql as $$
declare n int; v_lease text := p_lease_prefix || 'backfill:' || p_user;
begin
  if p_lease_prefix <> '' and p_lease_prefix not like 'test:%' then raise exception 'bad prefix'; end if;
  insert into jobs (kind, user_id, lease_key, payload)
  select 'gmail-unsub-scan', c.user_id, v_lease,
    jsonb_build_object('connection_id', c.id, 'backfill', true, 'lease_key', v_lease)
      || case when p_after is null then '{}'::jsonb else jsonb_build_object('after', floor(extract(epoch from p_after))::bigint) end
  from connections c
  where c.user_id = p_user and c.provider = 'gmail' and c.status = 'active'
    and not exists (select 1 from jobs j where j.user_id = p_user and j.kind = 'gmail-unsub-scan' and j.lease_key = v_lease
                    and j.status in ('queued', 'running'));
  get diagnostics n = row_count;
  return n;
end $$;

-- cron 이 부른다(p_user null = 활성 Gmail 연결이 있는 모든 사용자). 테스트는 p_user·p_lease_prefix 'test:<run>:' 로 좁힌다(0003).
-- 대기 중 스캔(30일 스캔 포함)이 있으면 그 사용자는 건너뛴다 — 30일 스캔이 8일을 덮는다
create or replace function gmail_enqueue_unsub_gap(p_user uuid default null, p_lease_prefix text default '') returns int language plpgsql as $$
declare n int := 0; u uuid;
begin
  if p_lease_prefix <> '' and p_lease_prefix not like 'test:%' then raise exception 'bad prefix'; end if;
  for u in select distinct c.user_id from connections c
           where c.provider = 'gmail' and c.status = 'active' and (p_user is null or c.user_id = p_user) loop
    n := n + gmail_enqueue_unsub_scan(u, p_lease_prefix, now() - interval '8 days');
  end loop;
  return n;
end $$;

revoke execute on function gmail_enqueue_unsub_scan(uuid, text, timestamptz), gmail_enqueue_unsub_gap(uuid, text) from public, anon, authenticated;

-- UTC 19:27 = KST 04:27. 다른 cron(매분, 매시 7분, 6시간 0분, 03:17·03:41·04:23·04:33·04:43 UTC)과 겹치지 않는다
select cron.schedule('unsub-gap-scan-daily', '27 19 * * *', $$ select gmail_enqueue_unsub_gap(); $$);
