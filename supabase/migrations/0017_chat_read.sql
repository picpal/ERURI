-- 스펙 §9 채팅(M2-⑧b, 계획 0011 → Ruling M#): facts SQL 우선(구조화 질문, 1단계는 facts.payload), 하이브리드(출처 필터 추가),
-- 출처 메타·원문 표시(복호화는 chat 함수만, §12 통제 1), 평문 파생물 읽기 감사(§12 통제 4). 모든 함수는 service role 전용이고 user_id 를 명시한다
drop function hybrid_search(uuid, text, extensions.vector, int, timestamptz, timestamptz, float);
create function hybrid_search(p_user uuid, p_query text, p_embedding extensions.vector(512), p_limit int,
                              p_from timestamptz default null, p_to timestamptz default null, p_kw_weight float default 1.0,
                              p_sources text[] default null)
returns table(item_id uuid, chunk_id uuid, score float, sem_sim float, kw_score float)
language sql stable set search_path = public, extensions as $$
with base as (
  select c.id, c.item_id, lower(c.text) text, c.embedding from item_chunks c join items i on i.id = c.item_id
  where c.user_id = p_user and i.user_id = p_user
    and (p_from is null or i.occurred_at >= p_from) and (p_to is null or i.occurred_at <= p_to)
    and (p_sources is null or cardinality(p_sources) = 0 or i.source = any (p_sources))
), nb as (
  select greatest(count(*), 1)::float n from base
), sem as (
  select id, 1 - (embedding <=> p_embedding) sim, row_number() over (order by embedding <=> p_embedding) rk
  from base where p_embedding is not null and embedding is not null
  order by embedding <=> p_embedding limit 40
), toks as (
  select distinct t from regexp_split_to_table(lower(p_query), '[[:space:][:punct:]]+') t
  where char_length(t) >= 2 and t not in (
    '언제','언제야','언제지','어디','어디서','어디야','어디였지','어디에','뭐','뭐야','뭐지','뭐였지','뭐였더라','몇','얼마','얼마나',
    '누가','누구','무슨','어느','어떤','했지','했어','했나','했더라','샀지','샀어','샀더라','거','것','건','좀','내가','이번','그거',
    '있어','있나','됐어','됐나','돼','해','야','지','가야','하러','가는')
), variants as (
  select t, v from toks cross join lateral (values (t),
    (case when char_length(t) >= 3 then left(t, char_length(t) - 1) end),
    (case when char_length(t) >= 4 then left(t, char_length(t) - 2) end)) x(v)
  where v is not null
), tokmatch as (
  select distinct b.id, vt.t from base b join variants vt on strpos(b.text, vt.v) > 0
), df as (
  select t, count(*)::float n from tokmatch group by t
), kw as (
  select m.id, sum(ln((nb.n + 1) / (df.n + 0.5))) s, row_number() over (order by sum(ln((nb.n + 1) / (df.n + 0.5))) desc) rk
  from tokmatch m join df using (t) cross join nb group by m.id, nb.n order by s desc limit 40
), fused as (
  select coalesce(s.id, k.id) id, coalesce(1.0/(60+s.rk),0) + p_kw_weight * coalesce(1.0/(60+k.rk),0) score, s.sim, k.s kw
  from sem s full outer join kw k on s.id = k.id
)
select b.item_id, f.id, f.score::float, f.sim::float, f.kw::float from fused f join base b on b.id = f.id order by f.score desc limit p_limit;
$$;

-- 구조화 조건(종류·가맹점)이 있을 때만 facts 를 찾는다. 원문이 만료된 항목의 fact 도 포함(evidence 가 출처 역할, §8)
create or replace function search_facts(p_user uuid, p_from timestamptz, p_to timestamptz, p_kinds text[], p_merchant text, p_limit int default 5)
returns table (fact_id uuid, item_id uuid, kind text, payload jsonb, evidence text, occurred_at timestamptz) language sql stable as $$
  select f.id, f.item_id, f.kind, f.payload, f.evidence, i.occurred_at
  from facts f join items i on i.id = f.item_id and i.user_id = p_user
  where f.user_id = p_user and f.status = 'active'
    and (p_merchant is not null or (p_kinds is not null and cardinality(p_kinds) > 0))
    and (p_kinds is null or cardinality(p_kinds) = 0 or f.kind = any (p_kinds))
    and (p_from is null or i.occurred_at >= p_from) and (p_to is null or i.occurred_at <= p_to)
    and (p_merchant is null or f.payload->>'merchant' ilike '%' || p_merchant || '%')
  order by i.occurred_at desc limit p_limit;
$$;

create or replace function chat_item_meta(p_user uuid, p_ids uuid[])
returns table (item_id uuid, source text, app_name text, title text, sender text, occurred_at timestamptz, expired boolean) language sql stable as $$
  select i.id, i.source, i.app_name, i.title, i.sender, i.occurred_at, i.content_enc is null
  from items i where i.user_id = p_user and i.id = any (p_ids);
$$;

-- 출처 원문 표시(§12 통제 1: chat 함수만 복호화). 본인 항목일 때만 행을 준다. 암호문이 있을 때만(원문 만료 아님) 복호화 감사를 남긴다
create or replace function chat_get_item(p_user uuid, p_item uuid)
returns table (content_enc bytea, source text, app_name text, title text, sender text, occurred_at timestamptz) language plpgsql as $$
#variable_conflict use_column
declare r record;
begin
  select i.content_enc as enc, i.source as src, i.app_name as app, i.title as ttl, i.sender as snd, i.occurred_at as at into r
  from items i join user_keys k on k.user_id = i.user_id where i.id = p_item and i.user_id = p_user;
  if not found then return; end if;
  if r.enc is not null then
    insert into audit_log (user_id, actor, action, target) values (p_user, 'chat', 'decrypt', p_item::text);
  end if;
  return query select r.enc, r.src, r.app, r.ttl, r.snd, r.at;
end $$;

-- 인용 항목의 제안 카드(Ruling 8). 앱은 create_event·proposed 만 버튼으로 보이고(ChatReply.calendarStart), succeeded 는 결과 표시용
create or replace function chat_proposals(p_user uuid, p_items uuid[])
returns table (id uuid, item_id uuid, action text, status text, payload jsonb) language sql stable as $$
  select p.id, f.item_id, p.action, p.status, p.payload from proposals p join facts f on f.id = p.fact_id and f.user_id = p_user
  where p.user_id = p_user and f.item_id = any (p_items) and p.status in ('proposed', 'succeeded');
$$;

-- 평문 파생물(item_chunks·facts) 읽기 감사(§12 통제 4: target = item_id 목록 해시)
create or replace function audit_read(p_user uuid, p_actor text, p_target text) returns void language sql as $$
  insert into audit_log (user_id, actor, action, target) values (p_user, p_actor, 'read', p_target);
$$;

revoke execute on function hybrid_search(uuid, text, extensions.vector, int, timestamptz, timestamptz, float, text[]),
  search_facts(uuid, timestamptz, timestamptz, text[], text, int), chat_item_meta(uuid, uuid[]), chat_get_item(uuid, uuid),
  chat_proposals(uuid, uuid[]), audit_read(uuid, text, text) from public, anon, authenticated;
