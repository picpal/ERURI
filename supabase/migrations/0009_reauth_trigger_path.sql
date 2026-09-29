-- 0008 트리거 함수 수정: gmail_save_connection(security definer, search_path '') 안에서 발동하면 비한정 reauth_pushes 를 못 찾아
-- 재연결이 실패했다(42P01). 검색 경로를 고정하고 스키마를 한정한다
create or replace function reauth_pushes_clear_on_reconnect() returns trigger language plpgsql set search_path = '' as $$
begin
  delete from public.reauth_pushes where connection_id = new.id;
  return new;
end $$;
