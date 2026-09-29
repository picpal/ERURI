-- 최종 리뷰 I-1: Gmail 출처 삭제와 진행 중인 추출의 경합(스펙 §8 출처 삭제 → facts·proposals, §12 통제 5)
--  delete_gmail_source(T1)가 facts 를 지운 뒤 items 를 지우기 전에 save_fact(T2)의 fact insert 가 커밋되면,
--  on delete set null 이 그 fact 의 item_id 를 null 로 바꿔 fact·proposal 이 삭제 뒤에도 남았다(워커의 notify 가 제안 푸시까지 보냄).
--  items 행이 지워지는 경로는 출처 삭제·계정 삭제뿐이다(원문 만료·격리 만료·폐기는 content_enc 만 null). 그래서 set null 이 필요한 경로가 없다.
--  cascade 의 RI 삭제는 최신 스냅숏으로 돌아 T2 가 커밋한 fact 까지 지우고, proposals·executions 는 기존 cascade 로 따라간다.
--  삭제 뒤의 save_fact 는 'item not found'(또는 FK 오류)로 실패한다. notify 잡은 제안을 못 찾아 skipped 로 끝난다.

-- 이 버그(와 수정 전 테스트 정리)로 이미 남은 고아 fact: 원문 행이 지워진 fact 는 §8 에 따라 없어야 한다(적용 시점 테스트 사용자 2건뿐)
update facts set supersedes_id = null where supersedes_id in (select id from facts where item_id is null);
delete from facts where item_id is null;

alter table facts drop constraint facts_item_id_fkey,
  add constraint facts_item_id_fkey foreign key (item_id) references items on delete cascade;   -- facts 는 원문 만료 뒤에도 남는다(행은 유지)
