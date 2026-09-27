-- Task 12(PoC-8 서버 부분): 이미지·PDF 추출. 스펙 §7(월 vision 100건, 초과 시 OCR 텍스트), §8(usage_counters·facts·proposals).
-- PoC 최소 컬럼만 둔다. 쓰기는 모두 service role(worker) RPC로, 사용자는 자기 행 읽기만.

-- 비공개 버킷. 경로는 '<user_id>/<파일>' , items.storage_key = 'poc/<user_id>/<파일>'
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('poc', 'poc', false, 20971520, array['image/png', 'image/jpeg', 'application/pdf'])
on conflict (id) do nothing;

create table usage_counters (
  user_id uuid not null references auth.users on delete cascade,
  month date not null,                    -- Asia/Seoul 기준 월 1일
  vision_calls int not null default 0,
  extract_tokens bigint not null default 0,
  chat_tokens bigint not null default 0,
  reserved_krw numeric not null default 0,
  primary key (user_id, month)
);

create table facts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  item_id uuid references items on delete set null,       -- facts는 무기한(§8), 원문 행이 사라져도 남는다
  kind text not null check (kind in ('event', 'task', 'purchase', 'subscription')),
  payload jsonb not null,
  evidence text,                          -- 원문 인용 ≤300자. vision 추출은 인용이 없어 null
  status text not null default 'active' check (status in ('active', 'cancelled', 'superseded')),
  supersedes_id uuid references facts,
  created_at timestamptz not null default now()
);
-- 재시도 멱등: 같은 항목의 같은 종류 active fact는 하나(PoC 단순화)
create unique index facts_one_active_per_item on facts (item_id, kind) where status = 'active';

create table proposals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  fact_id uuid not null references facts on delete cascade,
  action text not null check (action in ('create_event', 'update_event', 'create_reminder', 'complete_reminder')),
  payload jsonb not null,
  version int not null default 1,
  status text not null default 'proposed' check (status in ('proposed', 'confirmed', 'succeeded', 'failed', 'stale')),
  eventkit_id text,
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table usage_counters enable row level security;
alter table facts enable row level security;
alter table proposals enable row level security;
create policy usage_owner_read on usage_counters for select to authenticated using ((select auth.uid()) = user_id);
create policy facts_owner_read on facts for select to authenticated using ((select auth.uid()) = user_id);
create policy proposals_owner_read on proposals for select to authenticated using ((select auth.uid()) = user_id);

create or replace function seoul_month() returns date language sql stable as $$
  select date_trunc('month', now() at time zone 'Asia/Seoul')::date;
$$;

-- 호출 전 예약(§13): 이번 달 vision_calls < p_limit 이면 1 올리고 true, 아니면 false. 한 문장이라 동시 호출에도 상한을 넘지 않는다
create or replace function reserve_vision_call(p_user uuid, p_limit int default 100) returns boolean language plpgsql as $$
declare v int;
begin
  if p_limit < 1 then return false; end if;
  insert into usage_counters (user_id, month, vision_calls) values (p_user, seoul_month(), 1)
  on conflict (user_id, month) do update set vision_calls = usage_counters.vision_calls + 1
    where usage_counters.vision_calls < p_limit
  returning vision_calls into v;
  return v is not null;
end $$;

create or replace function add_extract_tokens(p_user uuid, p_tokens bigint) returns void language sql as $$
  insert into usage_counters (user_id, month, extract_tokens) values (p_user, seoul_month(), p_tokens)
  on conflict (user_id, month) do update set extract_tokens = usage_counters.extract_tokens + excluded.extract_tokens;
$$;

-- 이미지·PDF 항목 + extract 잡. 테스트는 p_lease_key에 실행 태그('test:<run>…')를 넘겨 워커 cron이 가져가지 않게 한다
create or replace function insert_media_item(p_user uuid, p_source text, p_idempotency_key text, p_storage_key text,
                                             p_ocr_text_enc bytea, p_occurred_at timestamptz, p_lease_key text default null)
returns uuid language plpgsql as $$
declare v_id uuid;
begin
  insert into items (user_id, source, storage_key, ocr_text_enc, occurred_at, idempotency_key)
  values (p_user, p_source, p_storage_key, p_ocr_text_enc, p_occurred_at, p_idempotency_key)
  on conflict (user_id, idempotency_key) do nothing
  returning id into v_id;
  if v_id is not null then
    insert into jobs (kind, user_id, lease_key, payload)
    values ('extract', p_user, coalesce(p_lease_key, 'item:' || v_id), jsonb_build_object('item_id', v_id));
  end if;
  return v_id;
end $$;

-- worker_get_item과 같은 소유 조건(§12 통제 4(b)). OCR 암호문을 줄 때만 복호화 감사를 남긴다
create or replace function worker_get_media(p_user uuid, p_item uuid)
returns table (storage_key text, ocr_text_enc bytea) language plpgsql as $$
#variable_conflict use_column
declare v_key text; v_ocr bytea;
begin
  select i.storage_key, i.ocr_text_enc into v_key, v_ocr from items i join user_keys k on k.user_id = i.user_id
  where i.id = p_item and i.user_id = p_user;
  if not found then return; end if;
  if v_ocr is not null then
    insert into audit_log (user_id, actor, action, target) values (p_user, 'worker', 'decrypt', p_item::text);
  end if;
  return query select v_key, v_ocr;
end $$;

-- 일정 fact + create_event 제안을 한 트랜잭션으로. 같은 항목의 active event fact가 있으면 그대로 돌려준다(재시도 멱등)
create or replace function save_event_fact(p_user uuid, p_item uuid, p_payload jsonb) returns uuid language plpgsql as $$
declare v_fact uuid;
begin
  if not exists (select 1 from items where id = p_item and user_id = p_user) then raise exception 'item not found'; end if;
  insert into facts (user_id, item_id, kind, payload) values (p_user, p_item, 'event', p_payload)
  on conflict (item_id, kind) where status = 'active' do nothing
  returning id into v_fact;
  if v_fact is null then
    select id into v_fact from facts where item_id = p_item and kind = 'event' and status = 'active';
    return v_fact;
  end if;
  insert into proposals (user_id, fact_id, action, payload, idempotency_key)
  values (p_user, v_fact, 'create_event', p_payload - 'via', 'proposal:' || v_fact || ':v1');
  update items set status = 'proposed' where id = p_item;
  return v_fact;
end $$;

revoke execute on function seoul_month(), reserve_vision_call(uuid, int), add_extract_tokens(uuid, bigint),
  insert_media_item(uuid, text, text, text, bytea, timestamptz, text), worker_get_media(uuid, uuid), save_event_fact(uuid, uuid, jsonb)
  from public, anon, authenticated;
