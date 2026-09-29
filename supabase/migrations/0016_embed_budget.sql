-- M2-⑧a 리뷰 수정(Ruling E). 백필 항목 embed 도 월 예산(embed kind)으로 정산한다 — 레인(backfill:<user>, 우선순위 40)은 그대로.
-- 그래서 worker_get_embed_source 는 더 이상 backfill 여부를 돌려주지 않는다(반환형이 바뀌어 drop 후 재생성).
drop function if exists worker_get_embed_source(uuid, uuid);
create function worker_get_embed_source(p_user uuid, p_item uuid)
returns table (content_enc bytea, title text) language plpgsql as $$
#variable_conflict use_column
declare r record;
begin
  select i.content_enc as enc, i.title as ttl into r
  from items i join user_keys k on k.user_id = i.user_id
  where i.id = p_item and i.user_id = p_user and i.content_enc is not null
    and i.status in ('extracted', 'discarded:server:empty')
    and not exists (select 1 from item_chunks c where c.item_id = i.id);
  if not found then return; end if;
  insert into audit_log (user_id, actor, action, target) values (p_user, 'worker', 'decrypt', p_item::text);
  return query select r.enc, r.ttl;
end $$;

-- 같은 항목의 embed 잡 둘(실시간 embed:<id> 와 백로그 backfill:<user>)이 겹쳐도 청크가 2벌 남지 않게 for update:
-- 뒤 트랜잭션은 앞 커밋을 기다린 뒤 새 스냅샷에서 delete 가 앞 청크를 지운다(for share 는 서로 호환돼 둘 다 빈 상태에서 insert 했다)
create or replace function worker_save_chunks(p_user uuid, p_item uuid, p_chunks jsonb) returns int language plpgsql
set search_path = public, extensions as $$
declare n int; ok boolean;
begin
  select i.content_enc is not null and i.status in ('extracted', 'discarded:server:empty') into ok
  from items i where i.id = p_item and i.user_id = p_user for update;
  if not found then raise exception 'item not found'; end if;
  if not ok then return 0; end if;
  delete from item_chunks where item_id = p_item and user_id = p_user;
  insert into item_chunks (item_id, user_id, chunk_index, text, embedding)
  select p_item, p_user, (c->>'i')::int, c->>'text', (c->>'embedding')::vector(512) from jsonb_array_elements(p_chunks) c;
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function worker_get_embed_source(uuid, uuid), worker_save_chunks(uuid, uuid, jsonb) from public, anon, authenticated;
