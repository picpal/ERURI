-- 기능별 비용 기록(스펙 §13 "기능별 기록", §8 usage_ledger·usage_counters, §9 설정 "이번 달 사용"). 2026-10-07 사용자 결정, 서버·앱 0.15.0.
-- 적용은 0.14.0 MAIL-real 뒤 0031 다음(계획 2026-10-07-mail-summary.md D2·D3). 그때까지 supabase/migrations-pending/ 에 둔다.
-- 기존 것에 닿는 것: usage_counters.chat_tokens 삭제(쓰고 읽는 코드 없음, 2026-10-07 확인). 0014 reserve_usage·settle_usage 는 배포 사이 옛 워커·chat 이
-- 부르므로 그대로 둔다(0.16.0 정리). 메일 요약 감사 RPC audit_mail_read 도 여기 둔다(계획 D4 — audit_read 는 action 'read' 고정).
-- 함수는 usage_breakdown(authenticated)만 앱용, 나머지는 service role 전용. 표는 RLS 켜고 정책 없음. 숫자와 모델 이름만(§13 "개인정보")

create table usage_ledger (
  user_id uuid not null references auth.users on delete cascade,
  month date not null,                                               -- 서울 월 1일: 예약한 달(정산), vision 은 기록한 달
  kind text not null check (kind in ('chat', 'mail_summary', 'extract', 'backfill', 'embed', 'vision')),
  model text not null check (char_length(model) between 1 and 60),    -- API 모델 ID 그대로
  calls int not null default 0 check (calls >= 0),                    -- 과금된 API 응답 수
  input_tokens bigint not null default 0 check (input_tokens >= 0),
  cached_tokens bigint not null default 0 check (cached_tokens >= 0), -- input 의 일부
  output_tokens bigint not null default 0 check (output_tokens >= 0), -- reasoning 포함
  krw numeric not null default 0 check (krw >= 0),                    -- 호출별 원 금액의 합(그때 단가·환율로 확정)
  updated_at timestamptz not null default now(),
  primary key (user_id, month, kind, model),
  check (cached_tokens <= input_tokens)
);
alter table usage_ledger enable row level security;

alter table usage_counters drop column chat_tokens;

-- 예약 kind(어느 예산) → 허용 집계 kind(어느 기능). 메일 요약은 chat 예산을 같이 쓴다(§7·§13)
create or replace function usage_ledger_pair(p_reserve text, p_line text) returns boolean language sql immutable as $$
  select case p_reserve
    when 'chat' then p_line in ('chat', 'mail_summary')
    when 'extract' then p_line = 'extract'
    when 'backfill' then p_line = 'backfill'
    when 'embed' then p_line = 'embed'
    else false end;
$$;

-- 원소 {kind, model, input, cached, output, krw}: 모든 키가 있고 타입이 맞고, 토큰은 0 이상 bigint 범위 정수·cached ≤ input, krw ≥ 0, model 1~60자.
-- case 로 타입을 먼저 본다(and 는 평가 순서를 보장하지 않아 문자열 숫자가 캐스트 오류가 될 수 있다)
create or replace function usage_line_ok(l jsonb) returns boolean language sql immutable as $$
  select case when jsonb_typeof(l) = 'object' and jsonb_typeof(l->'kind') = 'string' and jsonb_typeof(l->'model') = 'string'
                   and jsonb_typeof(l->'input') = 'number' and jsonb_typeof(l->'cached') = 'number'
                   and jsonb_typeof(l->'output') = 'number' and jsonb_typeof(l->'krw') = 'number'
    then l->>'kind' in ('chat', 'mail_summary', 'extract', 'backfill', 'embed', 'vision')
      and char_length(l->>'model') between 1 and 60
      and (l->>'input')::numeric between 0 and 9223372036854775807 and (l->>'input')::numeric = trunc((l->>'input')::numeric)
      and (l->>'cached')::numeric between 0 and 9223372036854775807 and (l->>'cached')::numeric = trunc((l->>'cached')::numeric)
      and (l->>'output')::numeric between 0 and 9223372036854775807 and (l->>'output')::numeric = trunc((l->>'output')::numeric)
      and (l->>'cached')::numeric <= (l->>'input')::numeric
      and (l->>'krw')::numeric >= 0
    else false end;
$$;

-- 검사를 마친 원소를 (kind, model) 마다 더한다(내부용 — settle_usage_lines·record_usage 만 부른다)
create or replace function usage_ledger_add(p_user uuid, p_month date, p_lines jsonb) returns void language sql as $$
  insert into usage_ledger as g (user_id, month, kind, model, calls, input_tokens, cached_tokens, output_tokens, krw)
  select p_user, p_month, x.e->>'kind', x.e->>'model', count(*), sum((x.e->>'input')::bigint), sum((x.e->>'cached')::bigint),
         sum((x.e->>'output')::bigint), sum((x.e->>'krw')::numeric)
  from jsonb_array_elements(p_lines) as x(e) group by x.e->>'kind', x.e->>'model'
  on conflict (user_id, month, kind, model) do update set calls = g.calls + excluded.calls, input_tokens = g.input_tokens + excluded.input_tokens,
    cached_tokens = g.cached_tokens + excluded.cached_tokens, output_tokens = g.output_tokens + excluded.output_tokens,
    krw = g.krw + excluded.krw, updated_at = now();
$$;

-- 0014 reserve_usage 와 같은 검사·상한·80% 강등. 달은 함수 시작에서 한 번 읽어 행 삽입·예약·반환에 같이 쓴다(§13 "월 경계")
create or replace function reserve_usage_month(p_user uuid, p_kind text, p_est_krw numeric) returns table (status text, month date) language plpgsql as $$
#variable_conflict use_column
declare v_month date := seoul_month(); cap numeric; used numeric;
begin
  if p_kind is null or p_kind not in ('extract', 'chat', 'embed', 'vision', 'backfill') then raise exception 'bad kind'; end if;
  if p_est_krw is null or p_est_krw < 0 then raise exception 'bad estimate'; end if;
  insert into usage_counters (user_id, month) values (p_user, v_month) on conflict do nothing;
  if p_kind = 'backfill' then
    select c.backfill_krw into cap from budget_caps() c;
    update usage_counters u set backfill_reserved_krw = u.backfill_reserved_krw + p_est_krw
    where u.user_id = p_user and u.month = v_month and u.backfill_reserved_krw + p_est_krw <= cap
    returning u.backfill_reserved_krw into used;
  else
    select c.monthly_krw into cap from budget_caps() c;
    update usage_counters u set reserved_krw = u.reserved_krw + p_est_krw
    where u.user_id = p_user and u.month = v_month and u.reserved_krw + p_est_krw <= cap
    returning u.reserved_krw into used;
  end if;
  return query select (case when used is null then 'refused' when used >= cap * 0.8 then 'degraded' else 'ok' end)::text, v_month;
end $$;

-- 예약한 달(p_month)의 usage_counters 정산과 usage_ledger 기록을 한 트랜잭션으로(§13 "기록 시점"). 어긋나면 예외 — 전부 되돌리고 예약이 남는다
create or replace function settle_usage_lines(p_user uuid, p_kind text, p_est_krw numeric, p_month date, p_lines jsonb) returns void language plpgsql as $$
declare cur date := seoul_month(); l jsonb; total numeric := 0;
begin
  if p_kind is null or p_kind not in ('extract', 'chat', 'embed', 'backfill') then raise exception 'bad kind'; end if;
  if p_est_krw is null or p_est_krw < 0 then raise exception 'bad estimate'; end if;
  if p_month is null or p_month not in (cur, (cur - interval '1 month')::date) then raise exception 'bad_month'; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) > 50 then raise exception 'bad_lines'; end if;
  for l in select value from jsonb_array_elements(p_lines) loop
    if not usage_line_ok(l) then raise exception 'bad_line'; end if;
    if not usage_ledger_pair(p_kind, l->>'kind') then raise exception 'bad_pair'; end if;
    total := total + (l->>'krw')::numeric;
  end loop;
  update usage_counters u set
    reserved_krw = case when p_kind = 'backfill' then u.reserved_krw else greatest(u.reserved_krw - p_est_krw + total, 0) end,
    backfill_reserved_krw = case when p_kind = 'backfill' then greatest(u.backfill_reserved_krw - p_est_krw + total, 0) else u.backfill_reserved_krw end
  where u.user_id = p_user and u.month = p_month;
  if not found then raise exception 'reservation_missing'; end if;
  perform usage_ledger_add(p_user, p_month, p_lines);
end $$;

-- vision(이미지·PDF 추출)은 금액 예약 없이 기록만(§13 "vision은 기록만") — 기록한 달, usage_counters 는 건드리지 않는다
create or replace function record_usage(p_user uuid, p_lines jsonb) returns void language plpgsql as $$
declare l jsonb;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) > 50 then raise exception 'bad_lines'; end if;
  for l in select value from jsonb_array_elements(p_lines) loop
    if not usage_line_ok(l) then raise exception 'bad_line'; end if;
    if l->>'kind' <> 'vision' then raise exception 'bad_pair'; end if;
  end loop;
  perform usage_ledger_add(p_user, seoul_month(), p_lines);
end $$;

-- 앱 설정 "이번 달 사용" 기능별 줄(§9). 사용자는 auth.uid() 로만, 이번 달 행만
create or replace function usage_breakdown() returns table (kind text, model text, calls int, input_tokens bigint, cached_tokens bigint, output_tokens bigint, krw numeric)
language sql stable security definer set search_path = '' as $$
  select l.kind, l.model, l.calls, l.input_tokens, l.cached_tokens, l.output_tokens, l.krw from public.usage_ledger l
  where l.user_id = auth.uid() and l.month = public.seoul_month() order by l.kind, l.model;
$$;

-- 메일 요약 감사(§7 "로그·감사", §12 통제 4): 본문을 받은 읽기마다. target = Gmail 메시지 id 의 SHA-256 hex(id 평문이 감사 행에 남지 않게 모양을 강제)
create or replace function audit_mail_read(p_user uuid, p_target text) returns void language plpgsql as $$
begin
  if p_target is null or p_target !~ '^[0-9a-f]{64}$' then raise exception 'bad_target'; end if;
  insert into audit_log (user_id, actor, action, target) values (p_user, 'mail-read', 'read_mail', p_target);
end $$;

revoke execute on function usage_ledger_pair(text, text), usage_line_ok(jsonb), usage_ledger_add(uuid, date, jsonb), reserve_usage_month(uuid, text, numeric),
  settle_usage_lines(uuid, text, numeric, date, jsonb), record_usage(uuid, jsonb), audit_mail_read(uuid, text) from public, anon, authenticated;
revoke execute on function usage_breakdown() from public, anon;
grant execute on function usage_breakdown() to authenticated;
