-- PoC-7 평가(2026-09-27): 0008의 키워드 경로는 한국어 질문에서 Top-5 2/40.
--   plainto_tsquery('simple')는 질문의 모든 어절(조사·어미 포함)을 AND로 요구하고, 문서 전체와의 trigram similarity는 짧은 질의에서 0.2를 넘지 못한다.
-- 대체: 질문을 어절로 나누고(질문어 제외) 끝 1~2글자를 뗀 형태까지 부분 문자열로 맞춘 뒤, 어절별 IDF 합으로 점수를 낸다.
--   RRF 융합에 키워드 가중치 p_kw_weight(기본 1)를 둔다. p_embedding = null이면 키워드만(임베딩 보류 경로).
drop function if exists hybrid_search(uuid, text, extensions.vector, int, timestamptz, timestamptz);
create or replace function hybrid_search(p_user uuid, p_query text, p_embedding extensions.vector(512), p_limit int,
                                         p_from timestamptz default null, p_to timestamptz default null, p_kw_weight float default 1.0)
returns table(item_id uuid, chunk_id uuid, score float, sem_sim float, kw_score float)
language sql stable set search_path = public, extensions as $$
with base as (
  select c.id, c.item_id, lower(c.text) text, c.embedding from item_chunks c join items i on i.id = c.item_id
  where c.user_id = p_user and i.user_id = p_user
    and (p_from is null or i.occurred_at >= p_from) and (p_to is null or i.occurred_at <= p_to)
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
), variants as (                                             -- 질문 쪽 조사·어미: 끝 1~2글자를 뗀 형태도 후보(최소 2글자)
  select t, v from toks cross join lateral (values (t),
    (case when char_length(t) >= 3 then left(t, char_length(t) - 1) end),
    (case when char_length(t) >= 4 then left(t, char_length(t) - 2) end)) x(v)
  where v is not null
), tokmatch as (                                             -- 문서별로 맞은 어절(변형 중 하나라도 부분 문자열)
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
revoke execute on function hybrid_search(uuid, text, extensions.vector, int, timestamptz, timestamptz, float) from public, anon, authenticated;
