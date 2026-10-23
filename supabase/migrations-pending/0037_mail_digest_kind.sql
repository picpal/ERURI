-- 0.19.0 여러 메일 목록 요약(스펙 §13 "여러 메일 목록 요약", §7 "여러 통 — 목록 요약" 비용): 집계 kind mail_digest 만 더한다(D-M18).
-- 예약 kind 는 chat 그대로(월 예산 공유, D-M11) — reserve_usage_month·settle_usage_lines 본문·usage_counters 는 바꾸지 않는다. 넓히기만 해 되돌리지 않는다(§15)
alter table usage_ledger drop constraint usage_ledger_kind_check;
alter table usage_ledger add constraint usage_ledger_kind_check
  check (kind in ('chat', 'mail_summary', 'mail_digest', 'extract', 'backfill', 'embed', 'vision'));

create or replace function usage_ledger_pair(p_reserve text, p_line text) returns boolean language sql immutable as $$
  select case p_reserve
    when 'chat' then p_line in ('chat', 'mail_summary', 'mail_digest')
    when 'extract' then p_line = 'extract'
    when 'backfill' then p_line = 'backfill'
    when 'embed' then p_line = 'embed'
    else false end;
$$;

create or replace function usage_line_ok(l jsonb) returns boolean language sql immutable as $$
  select case when jsonb_typeof(l) = 'object' and jsonb_typeof(l->'kind') = 'string' and jsonb_typeof(l->'model') = 'string'
                   and jsonb_typeof(l->'input') = 'number' and jsonb_typeof(l->'cached') = 'number'
                   and jsonb_typeof(l->'output') = 'number' and jsonb_typeof(l->'krw') = 'number'
    then l->>'kind' in ('chat', 'mail_summary', 'mail_digest', 'extract', 'backfill', 'embed', 'vision')
      and char_length(l->>'model') between 1 and 60
      and (l->>'input')::numeric between 0 and 9223372036854775807 and (l->>'input')::numeric = trunc((l->>'input')::numeric)
      and (l->>'cached')::numeric between 0 and 9223372036854775807 and (l->>'cached')::numeric = trunc((l->>'cached')::numeric)
      and (l->>'output')::numeric between 0 and 9223372036854775807 and (l->>'output')::numeric = trunc((l->>'output')::numeric)
      and (l->>'cached')::numeric <= (l->>'input')::numeric
      and (l->>'krw')::numeric >= 0
    else false end;
$$;

revoke execute on function usage_ledger_pair(text, text), usage_line_ok(jsonb) from public, anon, authenticated;

-- 목록 요약 예약 식별자(Codex 0.19.0 계획 리뷰 #2, 계획 DP25): reserve_usage_month 는 멱등 식별자가 없어 제한 시간으로 기다림만 끝내면 늦게 성공한 예약이
-- reserved_krw 에 남는다. 요청 식별자(hold — 슬롯 holder 와 같은 UUID)로 예약·정산을 묶는다: 정산은 한 번만, 정산(보상)이 먼저 닿으면 묘비 cancelled 가
-- 늦은 예약을 막는다. 같은 (user_id, hold) 기본 키라 예약·정산이 겹쳐도 한쪽이 다른 쪽 커밋을 기다린다. 기존 함수는 안에서 그대로 부른다
create table usage_holds (
  user_id uuid not null references auth.users(id) on delete cascade,
  hold text not null check (hold ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  kind text not null,
  est_krw numeric not null check (est_krw >= 0),
  month date,
  state text not null check (state in ('held', 'settled', 'cancelled')),
  created_at timestamptz not null default now(),
  primary key (user_id, hold)
);
alter table usage_holds enable row level security;          -- 사용자 정책 없음: service role 전용

create or replace function reserve_usage_hold(p_user uuid, p_hold text, p_kind text, p_est_krw numeric) returns table (status text, month date) language plpgsql as $$
#variable_conflict use_column
declare r record;
begin
  delete from usage_holds h where h.user_id = p_user and h.state <> 'held' and h.created_at < now() - interval '1 day';   -- 끝난 행·묘비만 치운다
  insert into usage_holds (user_id, hold, kind, est_krw, state) values (p_user, p_hold, p_kind, p_est_krw, 'held') on conflict do nothing;
  if not found then return query select 'cancelled'::text, null::date; return; end if;   -- 보상 정산이 먼저 왔다(묘비) — 금액을 올리지 않는다
  select x.status, x.month into r from reserve_usage_month(p_user, p_kind, p_est_krw) x;
  if r.status = 'refused' then
    update usage_holds h set state = 'cancelled' where h.user_id = p_user and h.hold = p_hold;
  else
    update usage_holds h set month = r.month where h.user_id = p_user and h.hold = p_hold;
  end if;
  return query select r.status, r.month;
end $$;

create or replace function settle_usage_hold(p_user uuid, p_hold text, p_lines jsonb) returns text language plpgsql as $$
declare h usage_holds;
begin
  insert into usage_holds (user_id, hold, kind, est_krw, state) values (p_user, p_hold, 'chat', 0, 'cancelled') on conflict do nothing;
  if found then                                                          -- 예약이 아직 닿지 않았다: 묘비만 남긴다(늦은 예약은 cancelled 로 끝난다)
    if jsonb_typeof(p_lines) = 'array' and jsonb_array_length(p_lines) > 0 then raise exception 'reservation_missing'; end if;
    return 'absent';
  end if;
  select * into h from usage_holds x where x.user_id = p_user and x.hold = p_hold for update;
  if h.state <> 'held' then return 'done'; end if;                       -- 두 번째 정산·거절된 예약·묘비 = 할 일 없음
  perform settle_usage_lines(p_user, h.kind, h.est_krw, h.month, p_lines);
  update usage_holds x set state = 'settled' where x.user_id = p_user and x.hold = p_hold;
  return 'settled';
end $$;

revoke all on table usage_holds from anon, authenticated;
revoke execute on function reserve_usage_hold(uuid, text, text, numeric), settle_usage_hold(uuid, text, jsonb) from public, anon, authenticated;
