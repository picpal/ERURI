-- 스펙 §8 eval_judgments·§9 평가 절차 4(M2-⑨a 앱 채팅, 계획 0012 → Ruling M#): 사용자가 답변의 인용마다 👍/👎. 본문 없음. 러너는 집계만 읽는다.
-- 앱은 POST rest/v1/eval_judgments?on_conflict=user_id,question_id,item_id(merge-duplicates)로 user_id 없이 보낸다 → 기본값 auth.uid()
create table eval_judgments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  question_id text not null,              -- 채팅 응답의 answer_id
  item_id uuid not null references items on delete cascade,
  ok boolean not null,
  at timestamptz not null default now(),
  unique (user_id, question_id, item_id)
);
alter table eval_judgments enable row level security;
create policy eval_judgments_owner_read on eval_judgments for select to authenticated using ((select auth.uid()) = user_id);
create policy eval_judgments_owner_insert on eval_judgments for insert to authenticated with check ((select auth.uid()) = user_id
  and exists (select 1 from items i where i.id = item_id and i.user_id = (select auth.uid())));
create policy eval_judgments_owner_update on eval_judgments for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
revoke all on eval_judgments from anon;
