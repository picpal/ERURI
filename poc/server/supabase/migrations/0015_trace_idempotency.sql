-- 0b(2026-09-29): 기기 trace 재전송(09-29 silent_push 업로드 뒤 앱 열기 때 전부 재업로드)을 서버에서 무시한다(스펙 §6 PoC trace 멱등).
-- 멱등 키 = (user_id, device_id, event, at). 이미 들어간 중복은 같은 키 중 received_at(첫 도착)이 가장 이른 행만 남긴다 —
-- 도착 시각이 판정 근거라서. 본문 없는 PoC 관찰값만 지운다
delete from poc_traces t using poc_traces k
where k.user_id = t.user_id and k.device_id = t.device_id and k.event = t.event and k.at = t.at
  and (k.received_at, k.id) < (t.received_at, t.id);
create unique index poc_traces_idem on poc_traces (user_id, device_id, event, at);
