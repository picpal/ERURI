-- 스펙 §9 키워드(2026-10-01 검색·캘린더 결정 2b): 숫자가 든 어절은 숫자로 끝나는 변형을 만들지 않는다.
-- 10월 → 10 이 strpos 부분 문자열로 시각·전화번호·금액의 10 에 맞아 "10월 3일 일정" 질문에서 청크 11/25 가 키워드 일치했다(재현).
-- 예외: 3자 이상 원형에서 조사를 뗀 경우(1234는 → 1234 — 10월 → 10 과 구조가 같아 조사 목록으로만 가른다, Codex #3).
-- 10월에 → 10월 (조사 떼기)은 남긴다. 맨숫자 1~2자리 토큰("10/3 일정"의 10)은 어절에서 뺀다(Fable N6).
-- 한글 어절의 끝 1~2자 떼기는 0017 그대로. 인자·반환은 0017 과 같다
create or replace function hybrid_search(p_user uuid, p_query text, p_embedding extensions.vector(512), p_limit int,
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
  where char_length(t) >= 2 and t !~ '^[0-9]{1,2}$' and t not in (
    '언제','언제야','언제지','어디','어디서','어디야','어디였지','어디에','뭐','뭐야','뭐지','뭐였지','뭐였더라','몇','얼마','얼마나',
    '누가','누구','무슨','어느','어떤','했지','했어','했나','했더라','샀지','샀어','샀더라','거','것','건','좀','내가','이번','그거',
    '있어','있나','됐어','됐나','돼','해','야','지','가야','하러','가는')
), variants as (
  select t, v from toks cross join lateral (values (t),
    (case when char_length(t) >= 3 then left(t, char_length(t) - 1) end),
    (case when char_length(t) >= 4 then left(t, char_length(t) - 2) end)) x(v)
  where v is not null and (v = t or t !~ '[0-9]' or v !~ '[0-9]$'
         or (char_length(v) >= 3 and right(t, char_length(t) - char_length(v)) in
             ('은','는','이','가','을','를','에','의','도','로','와','과','만','에서','까지','부터','으로')))
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

revoke execute on function hybrid_search(uuid, text, extensions.vector, int, timestamptz, timestamptz, float, text[]) from public, anon, authenticated;
