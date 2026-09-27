-- 하이브리드 검색(스펙 §9): tsvector(simple) + pg_trgm ∪ pgvector cosine, RRF(k=60) 융합.
-- 임베딩은 PoC-7 통과 전까지 실제 사용자 데이터에 만들지 않는다(스펙 §16). 그동안 p_embedding = null → 키워드·trigram만
create extension if not exists vector with schema extensions;
create extension if not exists pg_trgm with schema extensions;
create table item_chunks (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references items(id) on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  chunk_index int not null,
  text text not null,
  embedding extensions.vector(512),       -- text-embedding-3-small dimensions 512. PoC-7 통과 전 실제 데이터는 null
  tsv tsvector generated always as (to_tsvector('simple', text)) stored
);
create index on item_chunks using hnsw (embedding extensions.vector_cosine_ops);
create index on item_chunks using gin (tsv);
create index on item_chunks using gin (text extensions.gin_trgm_ops);
create index on item_chunks (user_id);
alter table item_chunks enable row level security;
create policy item_chunks_owner_read on item_chunks for select using ((select auth.uid()) = user_id);

-- 반환: RRF score + 진단용 sem_sim(코사인 유사도, 의미 후보가 아니면 null)·kw_score(ts_rank와 trigram 유사도 중 큰 값)
create or replace function hybrid_search(p_user uuid, p_query text, p_embedding extensions.vector(512), p_limit int,
                                         p_from timestamptz default null, p_to timestamptz default null)
returns table(item_id uuid, chunk_id uuid, score float, sem_sim float, kw_score float)
language sql stable set search_path = public, extensions as $$
with base as (
  select c.id, c.item_id, c.text, c.embedding, c.tsv from item_chunks c join items i on i.id = c.item_id
  where c.user_id = p_user and i.user_id = p_user
    and (p_from is null or i.occurred_at >= p_from) and (p_to is null or i.occurred_at <= p_to)
), sem as (
  -- p_embedding이 null이면(임베딩 보류) 이 CTE는 비고 kw만으로 순위가 정해진다
  select id, 1 - (embedding <=> p_embedding) sim, row_number() over (order by embedding <=> p_embedding) rk
  from base where p_embedding is not null and embedding is not null
  order by embedding <=> p_embedding limit 40
), kw as (
  select id, s, row_number() over (order by s desc) rk from (
    select id, greatest(ts_rank(tsv, plainto_tsquery('simple', p_query)), similarity(text, p_query)) s
    from base where tsv @@ plainto_tsquery('simple', p_query) or similarity(text, p_query) > 0.2
  ) x order by s desc limit 40
), fused as (
  select coalesce(s.id, k.id) id, coalesce(1.0/(60+s.rk),0) + coalesce(1.0/(60+k.rk),0) score, s.sim, k.s kw
  from sem s full outer join kw k on s.id = k.id
)
select b.item_id, f.id, f.score::float, f.sim::float, f.kw::float from fused f join base b on b.id = f.id order by f.score desc limit p_limit;
$$;
revoke execute on function hybrid_search(uuid, text, extensions.vector, int, timestamptz, timestamptz) from public, anon, authenticated;
