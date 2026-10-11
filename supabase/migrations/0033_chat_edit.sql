-- 0033: 0.16.0 채팅 일정 개선(스펙 §9 "채팅 일정 개선" B 서버 1·5·C 서버, §10 "채팅 일정 고치기 실행", 계획 2026-10-08-chat-schedule-edit.md E1·E2).
-- 방금 채팅으로 등록한 일정 1건의 제안을 새 버전으로 고친다 — 캘린더에 들어간 버전이 없으면 새 create_event + 옛 최고 버전 stale,
-- 있으면 update_event(before = 그 버전 값, base_proposal_id, eventkit_id). 표·상태값은 바꾸지 않는다(함수만). 기존 행 값도 바꾸지 않는다.
-- 내부 함수는 어느 역할에도 실행 권한을 주지 않는다 — service role(chat)·security definer(resolve_uncertain) 안에서만 불린다.

-- ── 날짜·시각 도우미(내부). 형식이 틀리거나 달력에 없으면 null — 예외를 밖으로 내지 않는다 ──
create function chat_edit_day(p text) returns date language plpgsql immutable set search_path = public as $$
begin
  if p is null or p !~ '^\d{4}-\d{2}-\d{2}$' then return null; end if;
  return p::date;
exception when others then return null;
end $$;
create function chat_edit_ts(p text) returns timestamptz language plpgsql stable set search_path = public as $$
begin
  if p is null or p !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$' then return null; end if;
  return p::timestamptz;
exception when others then return null;
end $$;
-- 서울 ISO "YYYY-MM-DDTHH:MM:SS+09:00"(추출 정규화 normalizeDateTime 과 같은 모양)
create function chat_edit_iso(t timestamptz) returns text language sql stable set search_path = public as $$
  select to_char(t at time zone 'Asia/Seoul', 'YYYY-MM-DD"T"HH24:MI:SS') || '+09:00'
$$;
-- 제안 payload 의 네 칸(카드·응답·before)
create function chat_edit_values(p jsonb) returns jsonb language sql immutable set search_path = public as $$
  select jsonb_build_object('title', p->'title', 'start', p->'start', 'end', p->'end', 'location', p->'location')
$$;
-- 시작을 p_new 로 옮기고 끝을 같은 만큼(시각이면 시간 차이, 날짜만이면 날 수) 옮긴다. 끝이 없거나 기준을 잴 수 없으면 null(계획 K8)
create function chat_edit_moved(p_start text, p_end text, p_new text) returns jsonb language plpgsql stable set search_path = public as $$
declare os timestamptz := chat_edit_ts(p_start); ns timestamptz := chat_edit_ts(p_new); od date := chat_edit_day(p_start); nd date := chat_edit_day(p_new);
        oe timestamptz := chat_edit_ts(p_end); ed date := chat_edit_day(p_end); v_end text;
begin
  if p_end is null then v_end := null;
  elsif os is not null and ns is not null then
    v_end := case when oe is not null then chat_edit_iso(oe + (ns - os))
                  when ed is not null then to_char(ed + ((ns at time zone 'Asia/Seoul')::date - (os at time zone 'Asia/Seoul')::date), 'YYYY-MM-DD') end;
  elsif od is not null and nd is not null then
    v_end := case when ed is not null then to_char(ed + (nd - od), 'YYYY-MM-DD')
                  when oe is not null then chat_edit_iso(oe + make_interval(days => nd - od)) end;
  else v_end := null;
  end if;
  return jsonb_build_object('start', p_new, 'end', v_end);
end $$;

-- ── 대상 판정(B 서버 1·5, C 검사의 공통). 이 순서로 처음 걸리는 것:
--    본인 제안이 아님·없음·active event fact 가 아님·항목이 채팅 등록(SHARE·채팅)이 아님 → not_found(남의 id 인지 알리지 않는다)
--    p_edit(B): captured_at 이 30분 넘게 전 → expired, 그 항목의 active event fact ≥ 2 → multi
--    그 fact 의 최고 version 제안이 proposed·succeeded 가 아님 → not_found, 그 밖 → ok + 최고 버전.
--    p_lock 이면 최고 버전을 읽기 전에 그 fact 의 제안 행을 잠근다(동시 고치기·되묻기가 version 을 겹치지 않게) ──
create function chat_edit_state(p_user uuid, p_proposal uuid, p_lock boolean, p_edit boolean)
returns table (status text, fact_id uuid, item_id uuid, top_id uuid, top_version int, top_action text, top_status text, top_payload jsonb)
language plpgsql set search_path = public as $$
#variable_conflict use_column
declare v_fact uuid; v_item uuid; v_src text; v_app text; v_cap timestamptz; n int; t record;
begin
  select p.fact_id, f.item_id into v_fact, v_item
  from proposals p join facts f on f.id = p.fact_id and f.user_id = p_user and f.kind = 'event' and f.status = 'active'
  where p.id = p_proposal and p.user_id = p_user and p.action in ('create_event', 'update_event');
  if v_fact is null or v_item is null then status := 'not_found'; return next; return; end if;
  select i.source, i.app_name, i.captured_at into v_src, v_app, v_cap from items i where i.id = v_item and i.user_id = p_user;
  if v_src is distinct from 'SHARE' or v_app is distinct from '채팅' then status := 'not_found'; return next; return; end if;
  if p_edit then
    if v_cap < now() - interval '30 minutes' then status := 'expired'; return next; return; end if;
    select count(*) into n from facts f where f.item_id = v_item and f.user_id = p_user and f.kind = 'event' and f.status = 'active';
    if n >= 2 then status := 'multi'; return next; return; end if;
  end if;
  if p_lock then
    perform 1 from proposals p where p.fact_id = v_fact and p.user_id = p_user order by p.version for update;
  end if;
  select p.id, p.version, p.action, p.status, p.payload into t
  from proposals p where p.fact_id = v_fact and p.user_id = p_user order by p.version desc limit 1;
  if t.status not in ('proposed', 'succeeded') then status := 'not_found'; return next; return; end if;
  status := 'ok'; fact_id := v_fact; item_id := v_item; top_id := t.id; top_version := t.version;
  top_action := t.action; top_status := t.status; top_payload := t.payload;
  return next;
end $$;

-- ── 새 버전 규칙(B 서버 5 — 호출부가 chat_edit_state(p_lock) 로 잠근 뒤에만). p_patch = 네 칸 중 고친 것, p_clear = uncertain 에서 지울 코드.
--    기준 버전 = 캘린더에 들어간 버전(succeeded 이거나 executions 행 — 늦은 stale 보고도 행을 남긴다, Codex H1) 중 version 이 가장 큰 것.
--    없음(추가 전): 새 create_event proposed + 옛 최고 버전 stale. 있음(추가됨): 새 update_event(before·base_proposal_id·eventkit_id) +
--    최고 버전이 기준이 아니고 proposed 면 stale(succeeded 이력은 그대로). fact payload 네 칸도 새 값(검색·일정 기간 필터). 푸시 없음 ──
create function chat_edit_apply(p_user uuid, p_fact uuid, p_patch jsonb, p_clear text[]) returns jsonb
language plpgsql set search_path = public as $$
declare t record; b record; v_unc jsonb; v_new jsonb; v_before jsonb; v_after jsonb; v_id uuid; v_ver int; v_action text;
begin
  select p.id, p.version, p.action, p.status, p.payload into t
  from proposals p where p.fact_id = p_fact and p.user_id = p_user order by p.version desc limit 1;
  select p.id, p.payload, coalesce(p.eventkit_id, e.eventkit_id) as ek into b
  from proposals p left join executions e on e.proposal_id = p.id and e.user_id = p_user
  where p.fact_id = p_fact and p.user_id = p_user and (p.status = 'succeeded' or e.id is not null)
  order by p.version desc limit 1;
  v_unc := coalesce((select jsonb_agg(x.u order by x.o) from jsonb_array_elements_text(coalesce(t.payload->'uncertain', '[]'::jsonb)) with ordinality as x(u, o)
                     where x.u <> all (coalesce(p_clear, '{}'::text[]))), '[]'::jsonb);
  v_new := (t.payload - 'before' - 'base_proposal_id') || p_patch || jsonb_build_object('uncertain', v_unc);
  v_before := chat_edit_values(t.payload);
  v_after := chat_edit_values(v_new);
  -- 결과 일관성 가드(Codex 플랜 리뷰 H1·Fable #5): patch 는 chat 이 잠그기 전에 읽은 값으로 만들었다 — 그 사이 다른 쓰기(전송 중 되묻기 버튼)가
  -- 최고 버전을 바꿨으면 끝이 새 시작과 종류가 다르거나 시작 이전일 수 있다. 그러면 patch 의 끝을 버리고 최고 버전의 길이로 옮긴다
  -- (chat/edit.ts revalidate 와 같은 규칙 — 시각은 끝 > 시작, 종일은 마지막 날 ≥ 첫날). 시작을 못 읽으면(시작 없는 제안) 보지 않는다
  if v_new->>'end' is not null and (
       (chat_edit_ts(v_new->>'start') is not null
        and (chat_edit_ts(v_new->>'end') is null or chat_edit_ts(v_new->>'end') <= chat_edit_ts(v_new->>'start')))
    or (chat_edit_day(v_new->>'start') is not null
        and (chat_edit_day(v_new->>'end') is null or chat_edit_day(v_new->>'end') < chat_edit_day(v_new->>'start')))) then
    v_new := v_new || chat_edit_moved(t.payload->>'start', t.payload->>'end', v_new->>'start');
    v_after := chat_edit_values(v_new);
  end if;
  -- 네 칸과 uncertain 이 모두 같으면 새 버전을 만들지 않는다(계획 K6 — 코드만 지우는 되묻기는 새 버전이다)
  if v_before = v_after and coalesce(t.payload->'uncertain', '[]'::jsonb) = v_unc then
    return jsonb_build_object('status', 'no_change', 'proposal_id', t.id, 'version', t.version, 'action', t.action, 'before', v_before, 'after', v_after);
  end if;
  v_ver := t.version + 1;
  if b.id is null then
    v_action := 'create_event';
    insert into proposals (user_id, fact_id, action, payload, version, idempotency_key)
    values (p_user, p_fact, 'create_event', v_new, v_ver, 'proposal:' || p_fact || ':v' || v_ver) returning id into v_id;
    update proposals set status = 'stale', updated_at = now() where id = t.id and user_id = p_user and status = 'proposed';
  else
    v_action := 'update_event';
    insert into proposals (user_id, fact_id, action, payload, version, eventkit_id, idempotency_key)
    values (p_user, p_fact, 'update_event', v_new || jsonb_build_object('before', chat_edit_values(b.payload), 'base_proposal_id', b.id),
            v_ver, b.ek, 'proposal:' || p_fact || ':v' || v_ver) returning id into v_id;
    if t.id <> b.id and t.status = 'proposed' then
      update proposals set status = 'stale', updated_at = now() where id = t.id and user_id = p_user;
    end if;
  end if;
  update facts set payload = payload || jsonb_build_object('title', v_new->'title', 'start', v_new->'start', 'end', v_new->'end', 'location', v_new->'location')
  where id = p_fact and user_id = p_user;
  return jsonb_build_object('status', 'ok', 'proposal_id', v_id, 'version', v_ver, 'action', v_action, 'before', v_before, 'after', v_after);
end $$;

-- ── B 서버 1: 대상 읽기(chat 함수, service role). ok 면 감사 한 행(target = 항목 id SHA-256 hex, 계획 K23) ──
create function chat_edit_target(p_user uuid, p_proposal uuid) returns jsonb language plpgsql set search_path = public as $$
declare s record;
begin
  select * into s from chat_edit_state(p_user, p_proposal, false, true);
  if s.status <> 'ok' then return jsonb_build_object('status', s.status); end if;
  insert into audit_log (user_id, actor, action, target) values (p_user, 'chat', 'read', encode(sha256(convert_to(s.item_id::text, 'UTF8')), 'hex'));
  return jsonb_build_object('status', 'ok', 'proposal_id', s.top_id, 'action', s.top_action) || chat_edit_values(s.top_payload);
end $$;

-- ── B 서버 5: 고치기(chat 함수, service role, 한 트랜잭션). 잠근 뒤 1의 검사를 다시 하고(그 사이 추가·무시·다른 고치기) 새 버전 규칙.
--    p_patch 가 비어 있으면 p_clear 의 코드만 지운다(값이 같고 확인 코드만 있는 글 — 그 코드가 이미 없으면 apply 가 no_change) ──
create function chat_edit_proposal(p_user uuid, p_proposal uuid, p_patch jsonb, p_clear text[]) returns jsonb language plpgsql set search_path = public as $$
declare s record;
begin
  -- 빈 patch 는 확인 코드(p_clear)가 있을 때만 — 값은 그대로이고 이번 글이 확인한 코드만 지우는 고치기("오후 6시 맞아", 계획 K6)
  if p_patch is null or jsonb_typeof(p_patch) <> 'object'
     or (p_patch = '{}'::jsonb and cardinality(coalesce(p_clear, '{}'::text[])) = 0)
     or exists (select 1 from jsonb_each(p_patch) e
                where e.key not in ('title', 'start', 'end', 'location')
                   or jsonb_typeof(e.value) not in ('string', 'null')
                   or (e.key in ('title', 'start') and jsonb_typeof(e.value) <> 'string')
                   -- start 는 시각(오프셋 포함)·날짜로 읽혀야 한다(chat/edit.ts revalidate 의 방어선 — 최종 리뷰 E1 ②)
                   or (e.key = 'start' and chat_edit_ts(e.value #>> '{}') is null and chat_edit_day(e.value #>> '{}') is null)) then
    raise exception 'bad_patch';
  end if;
  if exists (select 1 from unnest(coalesce(p_clear, '{}'::text[])) c where c not in ('year', 'ampm', 'end', 'tz', 'date', 'location')) then
    raise exception 'bad_clear';
  end if;
  select * into s from chat_edit_state(p_user, p_proposal, true, true);
  if s.status <> 'ok' then return jsonb_build_object('status', s.status); end if;
  return chat_edit_apply(p_user, s.fact_id, p_patch, p_clear);
end $$;

-- ── 채팅 답 카드(0017 → 0033): fact 별 최고 버전만, 그 상태가 proposed·succeeded 일 때(옛·새 버전이 카드 두 장이 되지 않게, 스펙 §9 B 서버 5) ──
create or replace function chat_proposals(p_user uuid, p_items uuid[])
returns table (id uuid, item_id uuid, action text, status text, payload jsonb) language sql stable as $$
  select t.id, t.item_id, t.action, t.status, t.payload from (
    select distinct on (p.fact_id) p.id, f.item_id, p.action, p.status, p.payload
    from proposals p join facts f on f.id = p.fact_id and f.user_id = p_user
    where p.user_id = p_user and f.item_id = any (p_items)
    order by p.fact_id, p.version desc) t
  where t.status in ('proposed', 'succeeded');
$$;

revoke execute on function chat_edit_day(text), chat_edit_ts(text), chat_edit_iso(timestamptz), chat_edit_values(jsonb),
  chat_edit_moved(text, text, text), chat_edit_state(uuid, uuid, boolean, boolean), chat_edit_apply(uuid, uuid, jsonb, text[]),
  chat_edit_target(uuid, uuid), chat_edit_proposal(uuid, uuid, jsonb, text[]), chat_proposals(uuid, uuid[]) from public, anon, authenticated;

-- ── C 서버: 되묻기 버튼(사용자 JWT — auth.uid() 로만 사용자를 정한다). 대상 = 본인 채팅 등록 항목 fact 의 최고 버전·proposed·create_event 인
--    p_proposal 그 자체(30분·다건 검사 없음 — 버튼은 카드가 보이는 동안). 값은 코드별로 그 칸만 바꿀 수 있게 서버가 검사하고 끝은 서버가 옮긴다(계획 K8).
--    성공하면 그 코드를 uncertain 에서 뺀다(date 는 year 도 — 날짜 선택이 연도를 정한다, Codex M5). 새 버전 규칙은 B 와 같은 chat_edit_apply ──
create function resolve_uncertain(p_proposal uuid, p_code text, p_value text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); s record; v_start text; v_end text; os timestamptz; ns timestamptz; od date; nd date;
        v_today date := (now() at time zone 'Asia/Seoul')::date; v_y int; v_patch jsonb; v_clear text[]; r jsonb;
        bad constant jsonb := '{"status": "bad_value"}';
begin
  if v_user is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select * into s from public.chat_edit_state(v_user, p_proposal, true, false);
  if s.status <> 'ok' or s.top_id <> p_proposal or s.top_status <> 'proposed' or s.top_action <> 'create_event' then
    return jsonb_build_object('status', 'not_found');
  end if;
  if p_code is null or p_code not in ('date', 'year', 'ampm', 'location') then return bad; end if;
  if not (coalesce(s.top_payload->'uncertain', '[]'::jsonb) ? p_code) then return jsonb_build_object('status', 'not_uncertain'); end if;
  v_start := s.top_payload->>'start'; v_end := s.top_payload->>'end';
  os := public.chat_edit_ts(v_start); od := public.chat_edit_day(v_start);
  if p_code = 'location' then
    if p_value is distinct from '' then return bad; end if;
    v_patch := jsonb_build_object('location', null);
  elsif p_code = 'ampm' then
    ns := public.chat_edit_ts(p_value);
    if os is null or ns is null or (ns - os) not in (interval '0', interval '12 hours', interval '-12 hours')
       or (ns at time zone 'Asia/Seoul')::date <> (os at time zone 'Asia/Seoul')::date then return bad; end if;
    v_patch := public.chat_edit_moved(v_start, v_end, public.chat_edit_iso(ns));
  elsif p_code = 'year' then
    v_y := extract(year from v_today)::int;
    if os is not null then
      ns := public.chat_edit_ts(p_value);
      if ns is null or to_char(ns at time zone 'Asia/Seoul', 'MM-DD HH24:MI:SS') <> to_char(os at time zone 'Asia/Seoul', 'MM-DD HH24:MI:SS')
         or extract(year from ns at time zone 'Asia/Seoul')::int not in (v_y, v_y + 1) then return bad; end if;
      v_patch := public.chat_edit_moved(v_start, v_end, public.chat_edit_iso(ns));
    elsif od is not null then
      nd := public.chat_edit_day(p_value);
      if nd is null or to_char(nd, 'MM-DD') <> to_char(od, 'MM-DD') or extract(year from nd)::int not in (v_y, v_y + 1) then return bad; end if;
      v_patch := public.chat_edit_moved(v_start, v_end, to_char(nd, 'YYYY-MM-DD'));
    else return bad;
    end if;
  else  -- date
    nd := public.chat_edit_day(p_value);
    if nd is null or nd < (v_today - interval '1 year')::date or nd > (v_today + interval '2 years')::date then return bad; end if;
    if os is not null then
      v_patch := public.chat_edit_moved(v_start, v_end, public.chat_edit_iso((nd + (os at time zone 'Asia/Seoul')::time) at time zone 'Asia/Seoul'));
    elsif od is not null then
      v_patch := public.chat_edit_moved(v_start, v_end, to_char(nd, 'YYYY-MM-DD'));
    else
      v_patch := jsonb_build_object('start', to_char(nd, 'YYYY-MM-DD'), 'end', null);    -- 시작이 없던 제안: 그 날 종일, 끝 null(K8)
    end if;
  end if;
  v_clear := case when p_code = 'date' then array['date', 'year'] else array[p_code] end;
  r := public.chat_edit_apply(v_user, s.fact_id, v_patch, v_clear);
  if r->>'status' is distinct from 'ok' then return r; end if;          -- apply 가 새 버전을 만들지 않았으면 ok(옛 id)로 바꾸지 않는다(최종 리뷰 E2 ③)
  return jsonb_build_object('status', 'ok', 'proposal_id', r->'proposal_id', 'version', r->'version');
end $$;
revoke execute on function resolve_uncertain(uuid, text, text) from public, anon;
grant execute on function resolve_uncertain(uuid, text, text) to authenticated;
