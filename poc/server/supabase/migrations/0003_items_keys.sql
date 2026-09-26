create table user_keys (
  user_id uuid primary key references auth.users on delete cascade,   -- 계정 삭제 = crypto-shredding
  wrapped_key bytea not null,             -- 사용자 데이터 키(32B)를 MASTER_KEY로 AES-256-GCM 감싼 값
  created_at timestamptz not null default now()
);
create table items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  source text not null check (source in ('GMAIL','MESSAGES','NOTIFICATION','SHARE','CHAT')),
  app_name text,
  sender text,
  title text,
  content_enc bytea,                      -- 원문. Edge에서 사용자 데이터 키로 암호화. 원문 만료 시 null
  ocr_text_enc bytea,                     -- 이미지 OCR 원문. 같은 방식
  occurred_at timestamptz not null,
  captured_at timestamptz not null default now(),
  device_filter text,
  idempotency_key text not null,
  status text not null default 'queued',
  storage_key text,
  expires_at timestamptz not null default now() + interval '90 days',
  unique (user_id, idempotency_key)
);
create table audit_log (
  id bigint generated always as identity primary key,
  user_id uuid not null,                  -- FK 없음: 계정 삭제 후에도 사유 코드 행은 남긴다(§8)
  actor text not null,
  action text not null,
  target text,
  at timestamptz not null default now()
);
alter table user_keys enable row level security;
alter table items enable row level security;
alter table audit_log enable row level security;
create policy user_keys_owner_read on user_keys for select using ((select auth.uid()) = user_id);
create policy items_owner_read on items for select using ((select auth.uid()) = user_id);
create policy audit_owner_read on audit_log for select using ((select auth.uid()) = user_id);

create or replace function get_wrapped_key(p_user uuid) returns bytea language sql stable as $$
  select wrapped_key from user_keys where user_id = p_user;
$$;
-- 동시에 두 함수가 키를 만들면 먼저 저장된 값을 돌려준다(둘 다 같은 키로 암호화하게 됨)
create or replace function put_wrapped_key(p_user uuid, p_wrapped bytea) returns bytea language plpgsql as $$
begin
  insert into user_keys (user_id, wrapped_key) values (p_user, p_wrapped) on conflict (user_id) do nothing;
  return (select wrapped_key from user_keys where user_id = p_user);
end $$;

create or replace function insert_item(p_user uuid, p_source text, p_idempotency_key text, p_sender text, p_title text,
                                       p_content_enc bytea, p_occurred_at timestamptz, p_enqueue boolean default true,
                                       p_app_name text default null, p_ocr_text_enc bytea default null)
returns uuid language plpgsql as $$
declare v_id uuid;
begin
  insert into items (user_id, source, app_name, sender, title, content_enc, ocr_text_enc, occurred_at, idempotency_key)
  values (p_user, p_source, p_app_name, p_sender, p_title, p_content_enc, p_ocr_text_enc, p_occurred_at, p_idempotency_key)
  on conflict (user_id, idempotency_key) do nothing
  returning id into v_id;
  if v_id is not null and p_enqueue then
    insert into jobs (kind, user_id, lease_key, payload)
    values ('process', p_user, 'item:' || v_id, jsonb_build_object('item_id', v_id));
  end if;
  return v_id;                            -- 중복이면 null
end $$;

-- §12 통제 4(b): items.user_id와 user_keys 소유자가 p_user로 같을 때만 암호문을 돌려주고 복호화 감사를 남긴다
create or replace function worker_get_item(p_user uuid, p_item uuid)
returns table (id uuid, content_enc bytea, ocr_text_enc bytea) language plpgsql as $$
#variable_conflict use_column
begin
  return query
    select i.id, i.content_enc, i.ocr_text_enc from items i join user_keys k on k.user_id = i.user_id
    where i.id = p_item and i.user_id = p_user and i.content_enc is not null;
  if found then
    insert into audit_log (user_id, actor, action, target) values (p_user, 'worker', 'decrypt', p_item::text);
  end if;
end $$;

revoke execute on function get_wrapped_key(uuid), put_wrapped_key(uuid, bytea),
  insert_item(uuid, text, text, text, text, bytea, timestamptz, boolean, text, bytea), worker_get_item(uuid, uuid)
  from public, anon, authenticated;
