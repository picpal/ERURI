-- 스펙 §13 비용 통제: 호출 전 금액 예약 → 응답 후 정산. 월 상한 1만원(80% 강등, 100% 중단), 백필 1회 예산 별도, 동시 LLM 호출 사용자당 2개.
-- reserved_krw = 정산된 실제 금액 + 진행 중 예약. vision 월 100건 상한(reserve_vision_call)은 그대로 둔다
create or replace function budget_caps() returns table (monthly_krw numeric, backfill_krw numeric) language sql immutable as $$
  select 10000::numeric, 1500::numeric;
$$;
alter table usage_counters add column backfill_reserved_krw numeric not null default 0;
-- jobs.not_before 와 claim_jobs 의 not_before 조건은 0007(재시도 백오프)에 이미 있다. 같은 열을 쓴다:
-- 뜻은 둘 다 "이 시각 전에는 클레임하지 않는다"이고, 무엇 때문인지는 last_error 로 구분한다(백오프 = 오류 코드, 미루기 = budget_exhausted·llm_busy).
-- fail_job 은 attempts 를 쓰고 dead 로 갈 수 있지만, defer_job 은 attempts 를 되돌려 5회 한도를 쓰지 않는다
alter table jobs add column if not exists not_before timestamptz;

create or replace function reserve_usage(p_user uuid, p_kind text, p_est_krw numeric) returns text language plpgsql as $$
declare cap numeric; used numeric;
begin
  if p_kind not in ('extract', 'chat', 'embed', 'vision', 'backfill') then raise exception 'bad kind'; end if;
  if p_est_krw < 0 then raise exception 'bad estimate'; end if;
  insert into usage_counters (user_id, month) values (p_user, seoul_month()) on conflict do nothing;
  if p_kind = 'backfill' then
    select backfill_krw into cap from budget_caps();
    update usage_counters set backfill_reserved_krw = backfill_reserved_krw + p_est_krw
    where user_id = p_user and month = seoul_month() and backfill_reserved_krw + p_est_krw <= cap
    returning backfill_reserved_krw into used;
  else
    select monthly_krw into cap from budget_caps();
    update usage_counters set reserved_krw = reserved_krw + p_est_krw
    where user_id = p_user and month = seoul_month() and reserved_krw + p_est_krw <= cap
    returning reserved_krw into used;
  end if;
  if used is null then return 'refused'; end if;
  return case when used >= cap * 0.8 then 'degraded' else 'ok' end;
end $$;

-- 예약 est 를 실제 금액으로 바꾼다(호출 실패·슬롯 없음은 actual = 0 → 예약 취소)
create or replace function settle_usage(p_user uuid, p_kind text, p_est_krw numeric, p_actual_krw numeric) returns void language sql as $$
  update usage_counters set
    reserved_krw = case when p_kind = 'backfill' then reserved_krw else greatest(reserved_krw - p_est_krw + p_actual_krw, 0) end,
    backfill_reserved_krw = case when p_kind = 'backfill' then greatest(backfill_reserved_krw - p_est_krw + p_actual_krw, 0) else backfill_reserved_krw end
  where user_id = p_user and month = seoul_month();
$$;

-- 앱 설정 "이번 달 사용"(§13 "앱에 잔여 예산 표시"). 사용자는 auth.uid() 로만
create or replace function usage_status() returns table (month date, used_krw numeric, cap_krw numeric, level text)
language sql stable security definer set search_path = '' as $$
  select public.seoul_month(), coalesce(u.reserved_krw, 0), c.monthly_krw,
         case when coalesce(u.reserved_krw, 0) >= c.monthly_krw then 'stopped'
              when coalesce(u.reserved_krw, 0) >= c.monthly_krw * 0.8 then 'degraded' else 'ok' end
  from public.budget_caps() c
  left join public.usage_counters u on u.user_id = auth.uid() and u.month = public.seoul_month();
$$;

-- 예산 소진·LLM 슬롯 없음: 실패가 아니라 미룬다(attempts 를 되돌려 5회 한도를 쓰지 않는다)
create or replace function defer_job(p_id uuid, p_until timestamptz, p_code text) returns void language sql as $$
  update jobs set status = 'queued', not_before = p_until, attempts = greatest(attempts - 1, 0), leased_until = null,
                  last_error = left(p_code, 60), updated_at = now()
  where id = p_id;
$$;

create table llm_slots (
  user_id uuid not null references auth.users on delete cascade,
  slot smallint not null check (slot in (1, 2)),
  holder text,
  held_until timestamptz not null default 'epoch',
  primary key (user_id, slot)
);
alter table llm_slots enable row level security;          -- 사용자 정책 없음: service role 전용

-- 빈 슬롯(기한 지난 것 포함 — 죽은 워커의 슬롯은 p_seconds 뒤 풀린다) 하나를 잡는다. 없으면 null
create or replace function acquire_llm_slot(p_user uuid, p_holder text, p_seconds int default 90) returns smallint language plpgsql as $$
declare s smallint;
begin
  insert into llm_slots (user_id, slot) values (p_user, 1), (p_user, 2) on conflict do nothing;
  update llm_slots set holder = p_holder, held_until = now() + make_interval(secs => p_seconds)
  where user_id = p_user and slot = (select l.slot from llm_slots l where l.user_id = p_user and l.held_until < now()
                                     order by l.slot limit 1 for update skip locked)
  returning slot into s;
  return s;
end $$;
create or replace function release_llm_slot(p_user uuid, p_slot smallint, p_holder text) returns void language sql as $$
  update llm_slots set holder = null, held_until = 'epoch' where user_id = p_user and slot = p_slot and holder = p_holder;
$$;

revoke execute on function budget_caps(), reserve_usage(uuid, text, numeric), settle_usage(uuid, text, numeric, numeric), defer_job(uuid, timestamptz, text),
  acquire_llm_slot(uuid, text, int), release_llm_slot(uuid, smallint, text) from public, anon, authenticated;
revoke execute on function usage_status() from public, anon;
grant execute on function usage_status() to authenticated;
