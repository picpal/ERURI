-- 스펙 §7 청크(512자) → item_chunks, 임베딩 text-embedding-3-large(dimensions 512). 1b(M2-⑧a)에서 worker 에 연결한다(계획 0010 → Ruling M#).
-- 대상: 게이트를 통과해 남은 항목(extracted, discarded:server:empty — 원문 유지). 격리·규칙 폐기·원문 만료 항목은 청크를 만들지 않는다
create or replace function worker_get_embed_source(p_user uuid, p_item uuid)
returns table (content_enc bytea, title text, backfill boolean) language plpgsql as $$
#variable_conflict use_column
declare r record;
begin
  select i.content_enc as enc, i.title as ttl, (i.captured_at - i.occurred_at) >= interval '3 days' as bf into r
  from items i join user_keys k on k.user_id = i.user_id
  where i.id = p_item and i.user_id = p_user and i.content_enc is not null
    and i.status in ('extracted', 'discarded:server:empty')
    and not exists (select 1 from item_chunks c where c.item_id = i.id);
  if not found then return; end if;
  insert into audit_log (user_id, actor, action, target) values (p_user, 'worker', 'decrypt', p_item::text);
  return query select r.enc, r.ttl, r.bf;
end $$;

-- 기존 청크를 교체한다. 복호화와 저장 사이에 대상에서 빠진 항목(격리·원문 만료)은 아무것도 넣지 않고 0 — 만료 뒤 청크가 되살아나지 않게
create or replace function worker_save_chunks(p_user uuid, p_item uuid, p_chunks jsonb) returns int language plpgsql
set search_path = public, extensions as $$
declare n int; ok boolean;
begin
  select i.content_enc is not null and i.status in ('extracted', 'discarded:server:empty') into ok
  from items i where i.id = p_item and i.user_id = p_user for share;
  if not found then raise exception 'item not found'; end if;
  if not ok then return 0; end if;
  delete from item_chunks where item_id = p_item and user_id = p_user;
  insert into item_chunks (item_id, user_id, chunk_index, text, embedding)
  select p_item, p_user, (c->>'i')::int, c->>'text', (c->>'embedding')::vector(512) from jsonb_array_elements(p_chunks) c;
  get diagnostics n = row_count;
  return n;
end $$;

-- 1b 연결 전에 쌓인 항목(M1 기간)을 한 번에 임베딩 잡으로. 대기 중인 embed 잡이 있으면 넣지 않는다.
-- 백필 레인(lease 'backfill:<user>', payload.backfill → 우선순위 40·사용자당 1개, 백필 예산): 수백 건이 새 항목의 process·embed 잡 앞에 서지 않게(스펙 §7 우선순위).
-- 테스트 항목(idempotency_key 'test:<run>:…')의 잡은 실행 태그를 물려받아 운영 워커가 가져가지 않는다(0011 과 같은 규칙, AGENTS.md §7)
create or replace function enqueue_embed_backlog(p_user uuid, p_limit int default 5000) returns int language plpgsql as $$
declare n int;
begin
  insert into jobs (kind, user_id, lease_key, payload)
  select 'embed', i.user_id,
         case when i.idempotency_key like 'test:%'
              then split_part(i.idempotency_key, ':', 1) || ':' || split_part(i.idempotency_key, ':', 2) || ':' else '' end
         || 'backfill:' || i.user_id,
         jsonb_build_object('item_id', i.id, 'backfill', true)
  from items i
  where i.user_id = p_user and i.content_enc is not null and i.status in ('extracted', 'discarded:server:empty')
    and not exists (select 1 from item_chunks c where c.item_id = i.id)
    and not exists (select 1 from jobs j where j.user_id = p_user and j.kind = 'embed' and j.payload->>'item_id' = i.id::text
                    and j.status in ('queued', 'running'))
  order by i.occurred_at desc limit p_limit;
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function worker_get_embed_source(uuid, uuid), worker_save_chunks(uuid, uuid, jsonb), enqueue_embed_backlog(uuid, int)
  from public, anon, authenticated;
