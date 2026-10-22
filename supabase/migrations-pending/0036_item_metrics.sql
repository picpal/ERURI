-- 0.18.0 본문 건수(스펙 §7 "본문 건수", §8 item_metrics·0036, §9 "본문 건수(0.18.0)"·RPC, §16 "2026-10-22 본문 건수 집계"). 배포 전까지 migrations-pending 에 둔다(계획 K1 — D1 이 git mv 후 적용).
-- 이 파일 ①(N1): item_metrics 표(service role 전용), worker_save_metrics(덮어쓰기), aggregate_items 키워드 공백·대소문자 무시(버그 조사 H2).
-- ②(N2): aggregate_items 본문 기준 값·발생 시각 기간·새 반환 칸(기존 칸 뜻 유지, K26).
-- 함수는 0035 처럼 service role 전용(public·anon·authenticated 실행 회수). 사용자 id 는 worker(잡의 user_id)·chat(JWT)이 정해 p_user 로 넘긴다

-- ── 본문 건수 ──
-- 저장 규칙 항목만, 항목당 최대 10행(ordinal 0~9). at = 발생 시각(워커가 검증한 본문 시각, 아니면 받은 시각 — UTC ISO 로 받는다, K3), at_body = 본문 시각을 썼는지.
-- label 은 평문 파생물(§12 통제 1 — facts.payload 와 같은 등급). 원문 만료 뒤에도 남고 항목·출처 삭제(items cascade)·계정 삭제가 지운다.
-- RLS 켜고 정책 없음 — 쓰기 worker_save_metrics, 읽기 aggregate_items(둘 다 service role). unique (item_id, ordinal) 의 색인이 item_id 조회를 겸한다(K14 — 별도 색인 없음)
create table item_metrics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  item_id uuid not null references items(id) on delete cascade,
  ordinal smallint not null check (ordinal between 0 and 9),
  label text not null check (char_length(label) between 1 and 30),
  count int not null check (count between 0 and 100000),   -- 0 = 본문 "오류 0건"(최종 리뷰 메인 판정 final-I2 — 맞은 0 은 메시지 값 0)
  at timestamptz not null,
  at_body boolean not null,
  created_at timestamptz not null default now(),
  unique (item_id, ordinal)
);
alter table item_metrics enable row level security;
revoke all on item_metrics from anon, authenticated;

-- 워커가 정규화(_shared/metrics.ts normalizeMetrics)한 배열을 save_facts·kept 전환 전에 넣는다(§7 "저장"). 빈 배열도 부른다 — 이전 행을 지우고 다시 넣어 재시도가 덮어쓴다.
-- 항목 행을 for update 로 잡은 뒤 지우고 넣는다 — 같은 항목 재시도가 겹쳐도 ordinal unique 충돌 없이 마지막 호출이 남는다(K15).
-- 없거나 남의 항목 → not_found. 정규화를 지난 값만 오므로 범위 밖은 고치지 않고 거절(bad_metrics) — 배열 아님·11개 이상·원소가 객체 아님·label 문자열 아님/1~30자 밖·
-- count 정수 아님/0~100000 밖·at null(문자열 아님)·at_body 불리언 아님. 반환 = 넣은 행 수
create or replace function worker_save_metrics(p_user uuid, p_item uuid, p_metrics jsonb) returns int language plpgsql as $$
declare n int;
begin
  perform 1 from items i where i.id = p_item and i.user_id = p_user for update;
  if not found then raise exception 'not_found'; end if;
  -- 검사는 차례로(OR 안의 평가 순서는 보장되지 않는다 — 배열 아닌 값에 jsonb_array_elements·숫자 아닌 count 캐스트가 먼저 돌면 다른 오류가 난다)
  if p_metrics is null or jsonb_typeof(p_metrics) <> 'array' or jsonb_array_length(p_metrics) > 10 then
    raise exception 'bad_metrics';
  end if;
  if exists (select 1 from jsonb_array_elements(p_metrics) e
             where case when jsonb_typeof(e) <> 'object' then true
                        when jsonb_typeof(e->'label') is distinct from 'string' or char_length(e->>'label') not between 1 and 30 then true
                        when jsonb_typeof(e->'count') is distinct from 'number' then true
                        when (e->>'count')::numeric <> trunc((e->>'count')::numeric) or (e->>'count')::numeric not between 0 and 100000 then true
                        when jsonb_typeof(e->'at') is distinct from 'string' then true
                        else jsonb_typeof(e->'at_body') is distinct from 'boolean' end) then
    raise exception 'bad_metrics';
  end if;
  delete from item_metrics where item_id = p_item;
  insert into item_metrics (user_id, item_id, ordinal, label, count, at, at_body)
  select p_user, p_item, (x.n - 1)::smallint, x.e->>'label', (x.e->>'count')::int, (x.e->>'at')::timestamptz, (x.e->>'at_body')::boolean
  from jsonb_array_elements(p_metrics) with ordinality x(e, n);
  get diagnostics n = row_count;
  return n;
end $$;

-- ── 집계 질문(§9 RPC·"본문 건수(0.18.0)") ──
-- 키워드 판정 = 청크 글과 낱말을 둘 다 소문자로 바꾸고 공백(\s)을 지운 뒤 strpos > 0(§9 RPC, H2) — "abc pay"·"ABC PAY"·"abcpay" 가 "[ABCPAY]"·"ABC PAY" 둘 다에 맞는다.
-- strpos 라 % _ \ 는 글자 그대로(이스케이프 불필요). 한 metric 행 label 판정도 같은 식으로, 낱말 중 하나라도 들어 있으면 한 번만 맞는다(K10).
-- 공백을 지운 낱말이 빈 글이면 bad_args(K11 — strpos(x, '') = 1 이라 모든 항목이 맞는다. chat 재검증 ①이 막지만 RPC 도 막는다)
-- 메시지 선택(상태·출처·발신자·키워드 AND)은 0.17.0 그대로, 받은 시각은 후보 창 [서울 p_from 0시 − 1일, p_to 다음 날 0시 + 7일)(K2 — 본문 시각은 받은 시각 −168h~+24h).
-- 값 단위 = 키워드에 맞은 metric 행(그 at·count — count 0 이면 0, final-I2) 또는, 맞은 행이 없으면 메시지 1(받은 시각) — 사용자 결정 A. 기간·칸은 값 단위의 발생 시각(서울)으로 가른다.
-- 반환(K26 — 기존 칸 뜻 유지, 구 chat 은 total·칸 count·목록 total 만 읽는다):
--   집계 {total = 기간 안 값 단위가 있는 메시지 수, body_total = 값 합, metric_items = 맞은 행이 쓰인 메시지 수, metric_unmatched = metrics 가 있지만 맞은 행 없이 1로 센 메시지 수,
--         buckets: [{key, count = 그 칸에 값 단위가 있는 메시지 수, body = 그 칸 값 합}] 값이 있는 칸만 키 순}
--   목록 {total = 그 칸 메시지 수, value = 그 칸 값 합, items: 최신(받은 시각)순 50 [{…0035 칸, count = 그 메시지가 이 칸에 더한 metric 합, 맞은 행 없으면 null}]}(K9)
-- 감사 = 기간 안 값 단위가 있는 메시지(목록 모드는 그 칸 메시지) id 정렬 SHA-256, 0건은 sha256('')
create or replace function aggregate_items(p_user uuid, p_keywords text[], p_sender text, p_sources text[], p_from date, p_to date,
  p_bucket text, p_bucket_key text default null) returns jsonb language plpgsql volatile
set statement_timeout = '5s' as $$
declare res jsonb; ids text;
begin
  if coalesce(p_bucket, '') not in ('hour', 'day', 'weekday') or coalesce(cardinality(p_keywords), 0) = 0
     or exists (select 1 from unnest(p_keywords) w where coalesce(w, '') = '')
     or exists (select 1 from unnest(p_keywords) w where regexp_replace(w, '\s', '', 'g') = '') then
    raise exception 'bad_args';
  end if;
  with cand as (
    select i.id, i.title, i.sender, i.source, i.app_name, i.occurred_at
    from items i
    where i.user_id = p_user and i.status in ('extracted', 'discarded:server:empty', 'kept')
      and i.occurred_at >= ((p_from - 1)::timestamp at time zone 'Asia/Seoul') and i.occurred_at < ((p_to + 8)::timestamp at time zone 'Asia/Seoul')
      and (coalesce(cardinality(p_sources), 0) = 0
           or i.source = any (p_sources)
           or ('MESSAGES' = any (p_sources) and i.source = 'NOTIFICATION' and i.app_name = '메시지'))
      and (p_sender is null or sender_matches(i.source, i.app_name, i.sender, i.title, p_sender))
      and not exists (select 1 from unnest(p_keywords) w
                      where not exists (select 1 from item_chunks c where c.item_id = i.id and c.user_id = p_user
                                        and strpos(regexp_replace(lower(c.text), '\s', '', 'g'), regexp_replace(lower(w), '\s', '', 'g')) > 0))
  ), hit as (
    select m.item_id, m.at, m.count from item_metrics m join cand on cand.id = m.item_id
    where m.user_id = p_user
      and exists (select 1 from unnest(p_keywords) w
                  where strpos(regexp_replace(lower(m.label), '\s', '', 'g'), regexp_replace(lower(w), '\s', '', 'g')) > 0)
  ), u as (
    select h.item_id, h.at, h.count, true as from_metric from hit h
    union all
    select c.id, c.occurred_at, 1, false from cand c where not exists (select 1 from hit h where h.item_id = c.id)
  ), t as (
    select u.*, case p_bucket when 'hour' then to_char(u.at at time zone 'Asia/Seoul', 'HH24')
                              when 'day' then to_char(u.at at time zone 'Asia/Seoul', 'YYYY-MM-DD')
                              else extract(isodow from u.at at time zone 'Asia/Seoul')::int::text end as k
    from u
    where u.at >= (p_from::timestamp at time zone 'Asia/Seoul') and u.at < ((p_to + 1)::timestamp at time zone 'Asia/Seoul')
  ), s as (
    select * from t where p_bucket_key is null or t.k = p_bucket_key
  ), per as (       -- 메시지별: 맞은 행이 있으면 그 합(줄 count), 없으면 null
    select s.item_id, case when bool_or(s.from_metric) then sum(s.count)::int end as n, bool_or(s.from_metric) as fm from s group by s.item_id
  )
  select case when p_bucket_key is null then
           jsonb_build_object('total', (select count(*)::int from per),
             'body_total', (select coalesce(sum(s.count), 0)::int from s),
             'metric_items', (select count(*)::int from per where per.fm),
             'metric_unmatched', (select count(*)::int from per where not per.fm and exists (select 1 from item_metrics x where x.item_id = per.item_id)),
             'buckets', coalesce((select jsonb_agg(jsonb_build_object('key', b.k, 'count', b.n, 'body', b.body) order by b.k)
                                  from (select s.k, count(distinct s.item_id)::int as n, sum(s.count)::int as body from s group by s.k) b), '[]'::jsonb))
         else
           jsonb_build_object('total', (select count(*)::int from per),
             'value', (select coalesce(sum(s.count), 0)::int from s),
             'items', coalesce((select jsonb_agg(jsonb_build_object('item_id', l.id, 'title', l.title, 'sender', l.sender, 'source', l.source,
                                                                    'app_name', l.app_name, 'occurred_at', l.occurred_at, 'count', l.n) order by l.occurred_at desc, l.id)
                                from (select cand.*, per.n from per join cand on cand.id = per.item_id order by cand.occurred_at desc, cand.id limit 50) l), '[]'::jsonb))
         end,
         coalesce((select string_agg(per.item_id::text, ',' order by per.item_id) from per), '')
  into res, ids;
  insert into audit_log (user_id, actor, action, target) values (p_user, 'chat', 'read', encode(sha256(convert_to(ids, 'UTF8')), 'hex'));
  return res;
end $$;

-- service role 전용. 새 함수는 기본 부여를 걷어 내고, create or replace 한 aggregate_items 도 0035 와 같게 다시 회수한다(멱등)
revoke execute on function worker_save_metrics(uuid, uuid, jsonb),
  aggregate_items(uuid, text[], text, text[], date, date, text, text)
  from public, anon, authenticated;
