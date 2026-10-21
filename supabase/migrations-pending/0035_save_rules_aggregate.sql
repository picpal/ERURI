-- 0.17.0 저장 규칙·집계 질문(스펙 §7 "저장 규칙", §8 0035, §9 "채팅 저장 규칙·집계 질문"). 배포 전까지 migrations-pending 에 둔다(계획 K1 — D1 이 git mv 후 적용).
-- 이 파일 ①(A1): save_rules 표·정책, items.status 'kept', gate_feedback 'rule_saved'(사용자 쓰기 금지, K2), 규칙 함수 셋, 판정 함수 둘(K3·K4), embed 대상 함수 셋에 kept.
-- 함수는 모두 service role 전용(public·anon·authenticated 실행 회수). 사용자 id 는 chat·worker 가 정해 p_user 로 넘긴다(hybrid_search 와 같은 방식).
-- items.status 'kept'(저장 규칙에 맞고 일정 없음, 원문 유지)는 체크 제약이 없어 값만 더한다(0034 'failed' 와 같다). 격리 기한(quarantine_until)을 바꾸는 문은 두지 않는다(운영 조치 UD6)

-- ── 저장 규칙 ──
-- 값은 비교용 평문(§12 통제 1 — items.sender·title 과 같은 등급). 쓰기는 chat 이 service role 함수로만 — RLS 는 본인 select 정책만
create table save_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  kind text not null check (kind in ('keyword', 'sender')),
  value text not null check (char_length(value) between 2 and 30),
  value_norm text generated always as (lower(value)) stored,
  created_at timestamptz not null default now(),
  unique (user_id, kind, value_norm)
);
alter table save_rules enable row level security;
create policy save_rules_owner_read on save_rules for select to authenticated using ((select auth.uid()) = user_id);
revoke all on save_rules from anon;

-- ── gate_feedback 'rule_saved' ──
-- save_rule_restore(폐기분 함께 저장)가 넣는다 — 게이트가 틀린 것이 아니라 사용자가 보관을 고른 항목이라 Jev 정확도 집계에서 뺀다(Codex 0.17.0 리뷰 #5).
-- 사용자는 rule_saved 를 넣지도 지우지도 못한다(K2·K27 ①): 넣으면 그 항목이 정확도에서 빠지고, 지우면 규칙으로 저장한 항목이 Jev 통과로 둔갑한다
alter table gate_feedback drop constraint gate_feedback_verdict_check;
alter table gate_feedback add constraint gate_feedback_verdict_check check (verdict in ('wrong_discard', 'wrong_pass', 'rule_saved'));
drop policy gate_feedback_owner_insert on gate_feedback;
create policy gate_feedback_owner_insert on gate_feedback for insert to authenticated with check ((select auth.uid()) = user_id
  and exists (select 1 from items i where i.id = item_id and i.user_id = (select auth.uid()))
  and verdict <> 'rule_saved');
drop policy gate_feedback_owner_delete on gate_feedback;
create policy gate_feedback_owner_delete on gate_feedback for delete to authenticated using ((select auth.uid()) = user_id
  and verdict <> 'rule_saved');

-- ── 규칙 함수 ──
-- 만든 순(created_at, id). 워커(process 잡마다 한 번)·chat 이 쓴다
create or replace function save_rules_of(p_user uuid) returns table (id uuid, kind text, value text, created_at timestamptz)
language sql stable as $$
  select r.id, r.kind, r.value, r.created_at from save_rules r where r.user_id = p_user order by r.created_at, r.id;
$$;

-- 정규화(K8) = 앞뒤 공백 제거 + 안쪽 연속 공백 한 칸. chat 이 정규화해 넘겨도 같은 결과(멱등). 길이는 코드 포인트(char_length).
-- 사용자 advisory 잠금 안에서 세므로 두 연결이 19개에서 동시에 추가해도 하나만 added. 감사 target = 규칙 id(값 없음)
create or replace function save_rule_add(p_user uuid, p_kind text, p_value text) returns jsonb language plpgsql as $$
declare v text; r uuid;
begin
  v := btrim(regexp_replace(coalesce(p_value, ''), '\s+', ' ', 'g'));
  perform pg_advisory_xact_lock(hashtext('save_rules:' || p_user));
  if coalesce(p_kind, '') not in ('keyword', 'sender') or char_length(v) not between 2 and 30 then
    return jsonb_build_object('status', 'bad_value', 'rule_id', null);
  end if;
  select s.id into r from save_rules s where s.user_id = p_user and s.kind = p_kind and s.value_norm = lower(v);
  if found then return jsonb_build_object('status', 'duplicate', 'rule_id', r); end if;
  if (select count(*) from save_rules s where s.user_id = p_user) >= 20 then
    return jsonb_build_object('status', 'limit', 'rule_id', null);
  end if;
  insert into save_rules (user_id, kind, value) values (p_user, p_kind, v) returning id into r;
  insert into audit_log (user_id, actor, action, target) values (p_user, 'chat', 'save_rule_add', r::text);
  return jsonb_build_object('status', 'added', 'rule_id', r);
end $$;

-- 남의 id·없는 id 는 not_found. 이미 kept·extracted 인 항목은 그대로(다시 판정하지 않는다, §7)
create or replace function save_rule_remove(p_user uuid, p_rule uuid) returns text language plpgsql as $$
begin
  delete from save_rules where id = p_rule and user_id = p_user;
  if not found then return 'not_found'; end if;
  insert into audit_log (user_id, actor, action, target) values (p_user, 'chat', 'save_rule_remove', p_rule::text);
  return 'removed';
end $$;

-- ── 판정 함수(내부) ──
-- 메신저 항목 = MESSAGES 또는 메신저 앱 알림(제목이 발신자 표시 이름). 앱 이름은 공백 제거·소문자 비교 — classify.ts isMessenger 와 같다(K3)
create or replace function is_messenger(p_source text, p_app text) returns boolean language sql immutable as $$
  select coalesce(p_source, '') = 'MESSAGES' or regexp_replace(lower(coalesce(p_app, '')), '\s', '', 'g') = any (
    -- MESSENGER_APPS (classify.ts 와 같은 목록·순서, 공백 제거·소문자 — save-rules 테스트가 대조)
    array['메시지', 'messages', 'sms', 'imessage', '카카오톡', 'kakaotalk', 'slack', '슬랙', 'instagram', '인스타그램', 'telegram', '텔레그램',
          'line', '라인', 'whatsapp', '왓츠앱', 'messenger', '메신저', 'discord', '디스코드', 'teams', 'microsoftteams', '팀즈'])
$$;

-- 발신자 조건 = 값이 발신자에 들어 있음(값·발신자 모두 공백 제거·소문자, strpos 라 %·_ 이스케이프 불필요), 메신저 항목은 제목도(K4).
-- 저장 규칙 sender(_shared/save-rules.ts matchSaveRules)와 같은 판정 — 같은 사례 표(tests/_agg-sql.ts SENDER_TABLE)를 둘 다 돈다
create or replace function sender_matches(p_source text, p_app text, p_sender text, p_title text, p_value text) returns boolean
language sql immutable as $$
  select coalesce(strpos(regexp_replace(lower(coalesce(p_sender, '')), '\s', '', 'g'), regexp_replace(lower(p_value), '\s', '', 'g')) > 0
      or (is_messenger(p_source, p_app) and strpos(regexp_replace(lower(coalesce(p_title, '')), '\s', '', 'g'), regexp_replace(lower(p_value), '\s', '', 'g')) > 0), false)
$$;

-- ── embed 대상에 kept(0015·0016 본문 그대로, 상태 목록만) ──
-- kept 는 규칙으로 저장한 원문 — 청크가 검색·집계 대상이다(§7 "저장 규칙")
create or replace function worker_get_embed_source(p_user uuid, p_item uuid)
returns table (content_enc bytea, title text) language plpgsql as $$
#variable_conflict use_column
declare r record;
begin
  select i.content_enc as enc, i.title as ttl into r
  from items i join user_keys k on k.user_id = i.user_id
  where i.id = p_item and i.user_id = p_user and i.content_enc is not null
    and i.status in ('extracted', 'discarded:server:empty', 'kept')
    and not exists (select 1 from item_chunks c where c.item_id = i.id);
  if not found then return; end if;
  insert into audit_log (user_id, actor, action, target) values (p_user, 'worker', 'decrypt', p_item::text);
  return query select r.enc, r.ttl;
end $$;

create or replace function worker_save_chunks(p_user uuid, p_item uuid, p_chunks jsonb) returns int language plpgsql
set search_path = public, extensions as $$
declare n int; ok boolean;
begin
  select i.content_enc is not null and i.status in ('extracted', 'discarded:server:empty', 'kept') into ok
  from items i where i.id = p_item and i.user_id = p_user for update;
  if not found then raise exception 'item not found'; end if;
  if not ok then return 0; end if;
  delete from item_chunks where item_id = p_item and user_id = p_user;
  insert into item_chunks (item_id, user_id, chunk_index, text, embedding)
  select p_item, p_user, (c->>'i')::int, c->>'text', (c->>'embedding')::vector(512) from jsonb_array_elements(p_chunks) c;
  get diagnostics n = row_count;
  return n;
end $$;

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
  where i.user_id = p_user and i.content_enc is not null and i.status in ('extracted', 'discarded:server:empty', 'kept')
    and not exists (select 1 from item_chunks c where c.item_id = i.id)
    and not exists (select 1 from jobs j where j.user_id = p_user and j.kind = 'embed' and j.payload->>'item_id' = i.id::text
                    and j.status in ('queued', 'running'))
  order by i.occurred_at desc limit p_limit;
  get diagnostics n = row_count;
  return n;
end $$;

-- service role 전용. create or replace 는 권한을 유지하지만 0015·0016 과 같게 다시 회수한다(멱등)
revoke execute on function save_rules_of(uuid), save_rule_add(uuid, text, text), save_rule_remove(uuid, uuid),
  is_messenger(text, text), sender_matches(text, text, text, text, text),
  worker_get_embed_source(uuid, uuid), worker_save_chunks(uuid, uuid, jsonb), enqueue_embed_backlog(uuid, int)
  from public, anon, authenticated;
