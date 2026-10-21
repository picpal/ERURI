# ERURI 0.17.0 저장 규칙·집계 질문 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 채팅으로 "앞으로 PINPAY 문자는 저장해"라고 하면 확인 카드로 저장 규칙(키워드 1개 또는 발신자 1개, 사용자당 20개)을 추가하고 — 그 뒤 맞는 메시지는 서버 분류 게이트(Jev)를 건너뛰어 저장되며(일정이 없으면 `kept`), 격리 중인 최근 폐기분도 [함께 저장]으로 되살린다 — "이번 주 PINPAY 타임아웃 언제 많았어?"처럼 키워드가 있는 개수·분포 질문은 DB가 센 숫자로 서버 템플릿 문장 + 막대(시·날짜·요일) 카드로 답한다.

**Architecture:** 서버는 마이그레이션 `0035`(테이블 `save_rules`, `items.status` `kept`, `gate_feedback.verdict` `rule_saved`, service role 함수 6개 + 내부 판정 함수 2개, embed 대상 함수 3개 재정의)를 바탕에 두고, 저장 규칙 일치 판정은 `_shared/save-rules.ts` 한 함수를 worker(process 잡의 규칙 단계)와 chat(폐기분 비교)이 같이 쓴다. chat은 앱이 `intents`에 새 의도 넷 중 하나라도 보낼 때만 0.17.0 필터 스키마(의도 8(+고치기 1)·칸 `aggregate`·`save_rule`·`<previous_aggregate>` 블록)를 쓰고 — 그 밖은 0.16.x와 바이트 동일 — 모델 칸을 `chat/aggregate.ts`가 재검증(①~⑥, 무효면 `bad_condition`)한 뒤 `aggregate_items`가 센 숫자로 문장·칸·꼬리 줄을 서버가 만든다. 버튼 라우트 `/chat/aggregate`(칸 목록)·`/chat/rule`(추가·빼기·함께 저장)은 모델을 부르지 않는다. 앱은 EruriCore에 순수 해석(`ChatAggregate`·`SaveRules`·`ChatHistory` 새 턴)을 두고 채팅 화면에 카드 두 개(`AggregateCard`·`SaveRuleCard`)를 더한다.

**Tech Stack:** Supabase Postgres 마이그레이션(0035, `migrations-pending/`), Edge Functions Deno/TS(`deno test`, `npm:@electric-sql/pglite@0.3` 로컬 SQL, `npm:postgres@3` 호스팅 롤백 트랜잭션), OpenAI Responses API(`gpt-6-luna`, strict json_schema, `store:false`), SwiftUI iOS 26 앱 `Eruri` + Swift Package `EruriCore`(XCTest, Swift 6), xcodegen, XCUITest(게이트 전용 임시 타깃, 커밋 안 함), TestFlight(`ios/scripts/testflight.sh`).

**Spec:** `docs/superpowers/specs/2026-09-22-assistant-design.md` @ `874e148`(커밋 `dc4683e`·`0221f95`·`874e148`) — 0.17.0 절 전부: §2 표 "저장 규칙"·"집계 질문", §6 FM 문단 끝 "저장 규칙은 서버 게이트만 건너뛴다", §7 "처리 순서"의 저장 규칙 문단·**"저장 규칙"**, §8 `items`(`kept`)·`item_chunks`·`gate_feedback`(`rule_saved`)·`save_rules`·**"0035"**·삭제 표 "폐기 격리 만료", §9 **"채팅 저장 규칙·집계 질문"**(의도 넷·앱 → 서버·칸·경계 예시 20·재검증 ①~⑥·RPC·응답·문장·목록·집계 카드·저장 규칙 응답·카드 버튼·저장 규칙 카드·오류 문구·대화 기록·로그·비용), §12 통제 1·2·4·5의 0.17.0 줄, §15 "1단계 추가 범위(2026-10-21 …)"(AGG-unit·AGG-db·AGG-eval·INTENT-eval 회귀·AGG-sim·AGG-real), §16 "2026-10-21 저장 규칙·집계 질문"(결정·운영 조치·사용자 결정 ⓐ~ⓒ·작성자 판정 ①~㉑·남는 것)·"외부 리뷰 반영 (0.17.0 …)" 1~6. 사용자 결정 원본 `.context/agg-0170-decisions.md`. 실행 규칙 `AGENTS.md` §3(모델)·§5-8(실측 게이트)·§6(기계)·§7(개인정보)·§8(버전).

**출발점:** main `874e148`. 서버 `0001`~`0034` 적용(0.16.1 배포 `b4fb778` — worker v31·chat v24·mail-read v4). 앱 `MARKETING_VERSION: 0.16.1`. 실사용자 MESSAGES 게이트 폐기 12건의 `quarantine_until` = 2026-11-30 23:59:59 KST(운영 조치 — **AGG-real은 그 전에 끝나야 한다**).

## 태스크 ID 표

| ID | 태스크 | 선행 | 시점 | 게이트 행 |
|---|---|---|---|---|
| S0 | 스펙 세부 반영(K1~K27·`rule_saved` 사용자 쓰기 금지 한 줄 — §8·§16) | 이 계획 커밋 | 문서 | — |
| A1 | `0035` ① — 테이블·상태·체크·정책·`save_rules_of`·`save_rule_add`·`save_rule_remove`·`is_messenger`·`sender_matches`·embed 함수 3개 + `_agg-sql.ts`·PGlite·호스팅 테스트 파일 | S0 | 로컬만 | `AGG-db`(로컬) |
| A2 | `0035` ② — `save_rule_candidates`·`save_rule_restore`·`aggregate_items` + 사례 | A1 | 로컬만 | `AGG-db`(로컬) |
| A3 | `_shared/save-rules.ts` — 값 정규화·`matchSaveRules`·SQL 메신저 목록 대조 | A1 | 로컬만 | `AGG-unit` ① |
| A4 | worker process 규칙 단계·`kept`·`gate_label 'rule'` | A3 | 로컬만 | `AGG-unit` ② |
| A5 | `gate-report` 순수 함수(`rule_skipped`·`rule_saved` 제외) | S0 | 로컬만 | `AGG-unit` ⑤ |
| A6 | `chat/aggregate.ts` — 재검증 ①~⑥·칸 채우기·top·문장·꼬리 줄·목록 재검증 | A3 | 로컬만 | `AGG-unit` ③ |
| A7 | `chat/filters.ts` 0.17.0 스키마(바이트 동일 고정 해시) | A6 | 로컬만 | `AGG-unit` ③ |
| A8 | `chat/save-rule.ts` + deps(0035 RPC·후보 복호화·감사) | A2·A3 | 로컬만 | `AGG-unit` ③ |
| A9 | chat handler — 의도 라우팅·`aggregate_context`·응답·`/chat/aggregate`·`/chat/rule`·로그 | A6·A7·A8 | 로컬만 | `AGG-unit` ③ |
| A10 | `AGG-eval`(44 × 2) + `INTENT-eval` 119 회귀(0.16.x·0.17.0 모드 각 2회) | A9 | **실호출** | `AGG-eval`·`INTENT-0170` |
| P1 | EruriCore 해석 — `ChatAggregate`·`SaveRules`·`ChatReply`·`ChatAddEvent.intents`·`Archive`·`RecentDiscards` + version-guard | S0 | 단위 | `AGG-unit` ④ |
| P2 | EruriCore `ChatHistory` — 턴 `.aggregate`·`.saveRule`·복원·맥락·`aggregateContext` | P1 | 단위 | `AGG-unit` ④ |
| P3 | 앱 집계 카드(`AggregateCard`·목록·복사) + `ChatView` 연결(`aggregate_context`·`bad_context`) | P2 | 빌드 | — |
| P4 | 앱 저장 규칙 카드(`SaveRuleCard`·버튼 API) + `ChatView` 연결 + 보관함 `.ruleSaved` | P3 | 빌드 | — |
| D1 | 배포 — 0035 호스팅 롤백 테스트 → 적용 → chat → worker → `AGG-deploy` 스모크 | A1~A10·P1~P4 | 실호출 | `AGG-db`(호스팅)·`AGG-unit`·`AGG-deploy` |
| G1 | `AGG-sim` ①~⑩(테스트 사용자 23, 전용 UDID) → `MARKETING_VERSION: 0.17.0` | D1 | 실호출 | `AGG-sim` |
| G2 | TestFlight 0.17.0 → `AGG-real`(실기기, 사용자 조작 — **2026-11-30 전**) | G1 | — | `AGG-real` |

순서: S0 → (A1 → A2) ∥ A3 ∥ A5 ∥ P1 → A4 → A6 → A7 → A8 → A9 → A10 ∥ (P2 → P3 → P4) → D1 → G1 → G2. **deno 테스트와 시뮬레이터 빌드를 같은 시각에 돌리지 않는다**(AGENTS.md §6 — 시작 전 `pgrep -x deno`·`pgrep -x xcodebuild`). 서버 태스크는 `supabase/`만, P1·P2는 EruriCore만, P3·P4는 `ios/App/`만 고친다. P3·P4는 둘 다 `ChatView.swift`를 고쳐 같은 pane에서 차례로 한다. A3·A4·A6·A8은 `_shared/save-rules.ts`를 만들거나 읽기만 한다(만드는 것은 A3).

## 사용자 결정 (2026-10-21 — 스펙 §16 "2026-10-21 저장 규칙·집계 질문"이 원본)

| # | 결정 | 이 계획에서 |
|---|---|---|
| UD1 | 집계 방식 ① 서버 조건 집계(모델은 조건만, 숫자는 DB) — 모델 세기·수신 태깅 기각 | A2 `aggregate_items`, A6 문장, A9 답변 모델 없음 |
| UD2 | 설계 1 저장 규칙 — 키워드/발신자 1개·20개·채팅으로만 관리·카드 누르기 전 변경 없음·폐기분 [함께 저장]·건수만 | A1·A2·A4·A8·A9·P4 |
| UD3 | 설계 2 집계 질문 — 조건 칸·기본 7일·최대 90일·bucket 셋·템플릿 문장·막대·목록·[복사]만·꼬리 줄 | A2·A6·A7·A9·P3 |
| UD4 | 설계 3 문구·게이트·버전 0.17.0·0035 | 전 태스크 |
| UD5 | ⓐ 종류 낱말만 있는 개수 질문은 `question`(q02) ⓑ 폐기분 문구에 "7일" 없음 ⓒ 개인 대화 저장 위험 수용 + 추가 카드 작은 글씨 | A7 `AGG_RULE`, P1 문구 |
| UD6 | 운영 조치: 실사용자 MESSAGES 폐기 12건 격리 2026-11-30까지 연장(0035는 되돌리지 않는다) | A1(그 값을 건드리는 문 없음), G2 기한 |
| UD7 | 메인 판정(이 계획 지시문): 사용자가 `rule_saved`를 직접 넣지 못하게 막는다 + 스펙에 한 줄 | A1 정책, S0 |

## 계획이 정한 것 (K표 — S0이 스펙 §16에 올린다)

| # | 항목 | 결정 | 이유 |
|---|---|---|---|
| K1 | 0035 위치 | `supabase/migrations-pending/0035_save_rules_aggregate.sql`로 만들고 D1에서 `git mv` → 적용 | 0.16.0 계획 관례. `supabase db push`가 배포 전에 실수로 적용하지 못하게 |
| K2 | `rule_saved` 사용자 쓰기 금지 | 0035가 `gate_feedback_owner_insert`를 다시 만들며 `with check`에 `and verdict <> 'rule_saved'`, `gate_feedback_owner_delete`의 `using`에도 `and verdict <> 'rule_saved'`(update 정책은 원래 없다) | 사용자가 `rule_saved`를 넣으면 그 항목이 정확도에서 빠지고, 지우면 `notice` → `kept` 항목이 Jev 통과로 둔갑한다(Codex #5와 같은 오염). 지우기 금지는 메인 판정의 같은 목적 확장 — **메인 판정 ① 유지**(K27) |
| K3 | 메신저 판정 SQL | 0035에 `is_messenger(p_source, p_app) returns boolean immutable` — `classify.ts` `MESSENGER_APPS`와 같은 목록(공백 제거·소문자). A3 테스트가 마이그레이션 글의 배열과 TS 집합을 대조 | 저장 규칙(TS)과 집계(SQL)의 발신자·메신저 제목 판정이 갈리면 규칙으로 저장한 카톡 문자를 집계가 못 센다(Review Focus 2) |
| K4 | 발신자 조건 SQL | `sender_matches(p_source, p_app, p_sender, p_title, p_value) returns boolean immutable` = 공백(`\s`) 제거·소문자 `strpos` > 0, 메신저 항목은 제목도. ILIKE가 아니라 이스케이프가 필요 없다 | 스펙 "공백·대소문자 무시, 메신저 항목은 제목도 — 저장 규칙 `sender`와 같은 판정" |
| K5 | `statement_timeout` | 스펙대로 함수 속성 `set statement_timeout = '5s'`를 두고, chat deps가 `aggregate_items` RPC를 `AbortSignal.timeout(6000)`으로 끊어 `failed`로 만든다. 함수 속성이 실행 중 문장을 끊는지는 U1로 실측 | Postgres는 실행 중 문장의 타이머를 함수 SET으로 다시 걸지 않는다고 알려져 있다 — 미실측이라 사용자 대기는 chat 쪽에서 확실히 묶는다. 끊지 않으면 D1이 스펙 문장을 보강한다(**메인 판정 ② 유지**, K27·U1) |
| K6 | 규칙 비교 글 | worker: 제목 = `applyRules`의 `maskedTitle ?? item.title`, 본문 = `masked`. chat 후보: 저장된 제목·본문(ingest가 이미 마스킹해 저장) | 스펙 §16 판정 ⑪(마스킹 뒤 글) |
| K7 | 규칙 조회 범위 | worker는 `item.source !== "SHARE"`일 때만 `save_rules_of`를 부른다(잡마다 최대 한 번) | SHARE는 규칙과 무관(스펙 §7) — 호출을 아낀다 |
| K8 | 길이 단위 | 2~30자 = 코드 포인트(`[...s].length`, SQL `char_length`). 정규화 = 앞뒤 공백 제거 + 안쪽 연속 공백(`\s+`) 한 칸. chat이 정규화한 값을 넘기고 SQL도 같은 정규화를 다시 한다(멱등) | SQL·TS가 같은 수를 센다 |
| K9 | 집계·후보 위치 | 집계 RPC와 저장 규칙 후보 복호화는 `guarded`(예약 `chat`) 클로저 안 — 키워드 0개 → 질문 흐름 전환을 같은 클로저에서 하려고 | 비용은 필터 한 번(스펙 §9 "비용"), 슬롯 보유는 최대 6초 더 |
| K10 | 집계 맥락 | `ChatHistory.context`는 `status = "ok"` 집계 턴만 `{question, answer: sentence}`로 넣는다(`bad_condition`·`failed` 문구는 넣지 않는다, 구간은 잇는다) | 오류 문구가 다음 필터의 맥락이 되면 판단만 흐린다 |
| K11 | `aggregate_context` 검사 | 서버: 객체 + 8칸 타입이 맞고(`defaulted`·`clamped`는 불리언), **검색 조건 6칸**(`keywords`·`sender`·`sources`·`from`·`to`·`bucket`)만 `revalidateAggregate(6칸, today, null)`에 넣어 `ok`이고 재검증된 6칸이 입력 6칸과 같아야 한다 — 아니면 400 `bad_context`. **이력 플래그 `defaulted`·`clamped`는 비교에서 뺀다**(확정된 `from`·`to`를 다시 검증하면 `defaulted: false`, 이미 90일인 기간은 `clamped: false`가 되므로). 통과하면 6칸 + 입력의 두 플래그를 돌려준다. 이어받기 ⑥에서 지금 글이 `from`·`to`를 둘 다 비우면(기간을 이어받으면) 직전 `defaulted`·`clamped`를 그대로 잇고, 하나라도 말하면 ④가 새로 정한다. 앱: 400 `bad_context`면 `context`·`aggregate_context`를 둘 다 빼고 한 번 더(지금 맥락 재시도와 같은 한 번) | 재검증된 값만 받는다(스펙 "서버가 재검증한 값 그대로") — 날이 바뀌어 미래 칸이 된 직전 조건은 버리고 새로 묻게. 플래그까지 비교하면 기본 기간·90일 줄임 응답 직후 "날짜별로는?"이 늘 400이 된다(Codex 계획 리뷰 #1 HIGH) — 왕복 테스트 A6·A9 |
| K12 | 응답 키 | `/chat` 응답에 `aggregate`·`save_rule`을 늘 싣는다(그 의도가 아니면 null) | `edit`과 같은 방식. 0.16.x 앱 디코더는 모르는 키를 무시한다 |
| K13 | INTENT-eval 회귀 기준 | 같은 세션에서 119개를 0.16.x 모드(새 의도 없음) 2회 + 0.17.0 모드 2회. **새로 틀린 사례** = 0.16.x 2회 모두 맞고 0.17.0 2회 중 한 번이라도 틀림 | 저장된 0.16.x 결과가 HEAD 코드와 같은 문장 기준인지 보장할 수 없다 — 같은 시각 기준선이 정직하다 |
| K14 | AGG-eval 사례 | §9 경계 예시 20개를 그대로 + 나머지 24개를 §15 구성표에 맞춰 합성(검사 함수가 구성을 강제) | 스펙 §15 |
| K15 | AGG-db 호스팅 | 테스트 사용자 22(주)·21(남). 사용자 삭제 cascade는 PGlite만 실행, 호스팅은 FK `confdeltype = 'c'` 확인. 동시 추가 사례만 커밋 — 규칙 값 = 실행 태그(`r<8자>-<n>`)로 만들고 `finally`에서 `user_id = 22 and value like 'r<8자>-%'`만 지운다 | 호스팅 `auth.users`를 지우지 않는다. 동시 사례는 커밋 없이 잴 수 없다(0.16.0 동시 고치기와 같은 방식) |
| K16 | 저장 규칙 턴 복원 | 버튼 요청 중 앱이 닫혔으면 다시 열 때 "바꾸지 못했어요. 다시 눌러 주세요."(버튼 유지). 버튼 결과는 K23 필드로 기록에 남는다 | 같은 버튼을 두 번 눌러도 바뀌지 않는다(스펙 — `duplicate`·`not_found`) |
| K17 | 최근 폐기 복구 행 | `RecentDiscards.restoreState`가 `kept`를 `.noSchedule`("일정을 찾지 못했어요")로 본다 | 규칙에 맞는 항목을 "최근 폐기"에서 복구하면 `kept`가 된다 — 지금 코드는 90초 동안 "처리 중…"으로 남는다(Review Focus 1) |
| K18 | 업로드 가드 | `version-guard.sh`에 0.17.0 가드(`ChatAggregate.swift`가 있는데 < 0.17.0이면 멈춤, `TF_ALLOW_PRE_AGG=1` 예외) | 0.16.0·0.16.1과 같은 방식 |
| K19 | Gmail 프로모션 라벨 | worker 테스트는 OTP·`(광고)`만. Gmail 프로모션 라벨은 수집(`gmail.ts` `applyRules(…, {labels})`)에서 폐기돼 worker에 오지 않는다 — 기존 `gmail-mail.test.ts`가 덮는다 | `processText`의 `applyRules`에는 라벨이 없다(코드 확인) |
| K20 | 목록 칸 키 | `/chat/aggregate`의 `bucket_key`: `hour` `"00"`~`"23"`, `weekday` `"1"`~`"7"`, `day` = `from`~`to` 안의 `YYYY-MM-DD` — 밖이면 400 `bad_request` | 스펙 "그 칸 종류 밖이면 400"의 `day` 해석 |
| K21 | [함께 저장] 0건 | `/chat/rule` `restore`에서 `save_rule_restore`가 0을 돌려주면 `none` | 그사이 다른 경로로 복구·정리된 경우 |
| K22 | 집계 0건 칸 탭 | 앱이 서버를 부르지 않고 "이 칸에는 없어요" | 스펙 문구, 호출 절약 |
| K23 | 저장 규칙 턴 영속 필드 | `SaveRuleTurn`(Codable) = `phase`·`addStatus`(`added`·`duplicate`·`limit`·`bad_value`)·`ruleID`(add 결과 `rule.id`)·`addedCount`(N/20)·`matched`·`restoreStatus`(`queued`·`none`·`not_found`)·`restored`·`removedIDs`·`note`. 디코드는 관대하게(없는 칸은 기본값, 모르는 `phase`는 `.idle`). [함께 저장] 대상 = `SaveRuleTurn.restoreRuleID(response)` — `restoreStatus`가 있으면 nil(이미 누름), `addStatus`가 `added`·`duplicate`이고 `ruleID`가 있고 `matched > 0`이면 `ruleID`, 그 밖은 `SaveRules.restoreRuleID(response)`(채팅 판정 `duplicate`) | 첫 `reply`는 바꾸기 전 확인 응답이라 새 규칙 id가 없다 — 추가 성공 뒤 앱을 다시 열어도 [함께 저장]이 같은 규칙으로 가야 한다(Codex 계획 리뷰 #2) |
| K24 | SQL 테스트 멱등 키 | `_agg-sql.ts` 시드 키 = `<tag>:<source>-<k>`, `tag` = `test:<run8>`(호스팅은 `_testenv` `RUN`) — 0011 `restore_discarded`의 `idempotency_key like 'test:%'` 판정과 같다. `save_rule_restore`는 0011의 lease 식을 그대로 복사한다(`test:` 접두면 `test:<run>:item:<id>`, 아니면 `item:<id>`). **`/ingest` source 접두 형식(`<source>:test:<run>:…`)은 지원하지 않는다** — 그 항목의 복구 잡은 `item:<id>`이고 배포 워커가 처리한다(D1 스모크·AGG-sim ②⑨는 배포 워커 처리가 필요하다). 그 잡은 스크립트 정리가 `payload->>item_id`로 지운다(smoke-gate와 같은 방식) | 복사 대상 0011과 다른 키를 쓰면 복구 잡 lease 기대값이 어긋난다(Codex 계획 리뷰 #3) |
| K25 | AGG-sim 실행 순서 | ① → ② → ③ → ④ → ⑩(스펙 "④ 바로 뒤") → ⑤ → ⑥ → ⑦ → **⑨ → ⑧**. ⑧의 `--phase rules20`은 그때 있는 규칙(⑨의 "합성은행" 포함)을 세어 **합계 20개**까지만 채운다(값 `r<run8>-<n>`) | 스펙 번호 순서대로면 ⑧이 20개를 채워 ⑨의 추가가 `limit`가 된다(Codex 계획 리뷰 #4). 번호·판정은 스펙 그대로, 실행 순서만 바꾼다 |
| K26 | 규칙 목록 테스트 | 중복·정규화 사례는 `save_rules_of` 결과를 `kind:value` 정렬 배열로 비교(순서 무관). 정렬은 별도 사례 — `created_at`을 서로 다르게 명시해 직접 insert(삽입 순서와 다르게)한 뒤 `created_at, id` 순을 단언 | 한 트랜잭션 안의 `default now()`는 같은 값이라 순서가 임의 UUID에 달린다(Codex 계획 리뷰 #5) |
| K27 | 메인 판정 (2026-10-21, Codex 계획 리뷰 뒤) | ① `gate_feedback` `rule_saved`는 사용자 insert·delete 모두 금지(K2 유지) ② 5초 `statement_timeout` 함수 속성이 실행 중 문장을 끊지 않으면 D1이 `gates.md` 기록과 함께 스펙 문장을 보강한다(사전 승인, K5·U1 유지) ③ **D1 시작 = 이 계획의 서버·앱 코드 태스크(A1~A10·P1~P4) 전부 완료·리뷰 통과 뒤** — 다른 버전의 게이트(0.15.0·0.16.0 대기 행)를 기다리지 않는다 ④ **AGG-real 기한 2026-11-30**(격리 연장분 만료) | 계획 작성자 확인 항목에 대한 메인 판정 |

## 이 계획이 기대는 사실 (코드에서 확인, `874e148`)

| # | 사실 | 출처 |
|---|---|---|
| F1 | `processText`: `applyRules`(라벨 없음) → `skip_gate`·SHARE 아니면 Jev → `recordGate(label, confidence: number)` → 폐기면 `quarantine` → 추출 → `textFacts` null이면 `discard("empty")` + embed, 아니면 `saveFacts` + notify + embed. 이미 처리된 항목은 `extracted`·`empty`만 embed 재적재 | `worker/text.ts` |
| F2 | `worker_record_gate(p_user, p_item, p_label text, p_confidence real)` — null confidence를 받는다. `worker_set_item_status`는 아무 상태나 쓴다(wipe일 때만 감사) | `0011:29`, `0001:597` |
| F3 | embed 대상 상태 `('extracted', 'discarded:server:empty')`는 `worker_get_embed_source`·`worker_save_chunks`(0016)·`enqueue_embed_backlog`(0015) 세 곳뿐 | `grep` |
| F4 | `gate_feedback`: verdict 체크 `('wrong_discard','wrong_pass')`, 정책 read·insert(본인 항목)·delete(본인), update 정책 없음. 앱은 `wrong_pass`만 POST하고 `verdict=eq.wrong_pass`만 DELETE한다 | `0010:9-20`, `ArchiveView.swift:130-140`, `Archive.swift:113` |
| F5 | `restore_discarded`(0011): 행 잠금 → `queued`·`quarantine_until null` → `gate_feedback` upsert → process 잡(`skip_gate`, 테스트 태그 lease 물려받기) → 감사 `restore` | `0011:6-27` |
| F6 | `retry_item`(0034)은 `failed`·`queued` 밖이면 `not_failed` — `kept`도 자동으로 `not_failed` | `0034:64` |
| F7 | `filterRequest` 현재 SHA-256(`JSON.stringify`): intents 맥락 없음 `cfd4768ad2dd6241c0869296ba1d1176e7dbc7f09a3fbeeb6ce8e42b51af2f82`, 맥락 `ctx1` `c7f84e8cb37a07aa37eaa2a0a4e612f2014f4964db39182d020c9210803b2bdc`, 고치기 `{registered: reg}`(질문 `"q"`·`2026-10-04`·맥락 없음, `reg`는 `chat-edit.test.ts:166` 값) `24931659e5d488ff73d6bb37819783b70a30712ec2663c96cb77302e62d9d9b8`, 고치기 `{registered: null}` + `ctx1` `88c98dfdaf1ecb62cd0af0f5649c6674de34a42a9b538a4ff16f1ab406b8083f`, intents 없음 `afd4a3b9cb6bb986c81f69b83348929206730a75b00623011f39a63fcf67b22c` | 이 계획 작성 중 실측(`874e148`) |
| F8 | `parseIntents`는 `ACTION_INTENTS`에 있는 값만 남긴다. `resolveIntent`는 `allowed`에 없으면 `question`. 응답 JSON은 `answer_id … mail_read, edit` | `chat/handler.ts` |
| F9 | `/chat/item`은 같은 `handleChat`에서 경로로 가른다 | `chat/handler.ts:handleChat` |
| F10 | ingest는 본문을 `applyRules`로 마스킹해 저장하고 멱등 키 = `<source>:<id>`, `occurred_at` = `capturedAt` | `ingest/handler.ts:43-61` |
| F11 | `isMessenger` = `source === "MESSAGES"` 또는 `MESSENGER_APPS`(공백 제거·소문자) | `_shared/classify.ts:11-17` |
| F12 | `Archive.statusKo`에 `kept` 없음, `gatePassed`는 라벨이 있고 그 라벨 폐기 상태가 아니면 참, `Feedback` = `none·wrongPass·restored·unknown`. `ArchiveView`는 `state != .restored`일 때만 버튼 | `Archive.swift:93-121`, `ArchiveView.swift:114` |
| F13 | `RecentDiscards.restoreState`는 `extracted`·`discarded:server:empty`만 끝 상태로 보고 그 밖 비폐기 상태는 nil(계속 확인) | `RecentDiscards.swift:72-83` |
| F14 | `ChatView.send`: `["question", "intents": ChatAddEvent.intents]` + `context`·`edit_target`, 400 `bad_context`면 맥락 없이 한 번 더, 응답 의도별로 턴 종류를 바꾼다. `ChatHistory.Kind`는 `question, link, image, addEvent, mailAction, mailSummary, editEvent` | `ChatView.swift:667-786`, `ChatHistory.swift:6` |
| F15 | PGlite 사례 선례: `_failed-sql.ts`(공유 사례) + `failed-sql.test.ts`(스텁 + 마이그레이션) + `failed-db.test.ts`(호스팅, `FAILED_DB_TEST=1`, 테스트 사용자 23, 사례마다 savepoint, 끝에서 롤백, 미적용이면 트랜잭션 안에서 적용) | `supabase/tests/` |
| F16 | `eval-intent.ts`는 `extractFilters(c.text, today, ctx, true)`를 직접 부르고 `_intent-eval.ts`가 판정·집계(119 = question 50·add_event 18·mail_action 21·mail_summary 30) | `supabase/scripts/` |

## 미확인 전제와 흡수 게이트

| # | 전제 | 흡수 게이트 | 실패하면 |
|---|---|---|---|
| U1 | 함수 속성 `set statement_timeout = '5s'`가 그 함수를 부른 RPC 문장을 끊는다 | D1 Step 3 호스팅 사례 `statement_timeout attribute`(임시 함수 `set statement_timeout='1s'` + `pg_sleep(2)`) | 끊지 않으면 chat 6초 abort(K5)만으로 사용자 대기를 묶는다 — 결과를 `gates.md`에 적고 D1이 스펙 문장 "statement_timeout 5초(함수 속성)" 옆에 "실행 중 문장은 끊지 않음 — chat 6초"를 더해 같은 커밋에 넣는다(메인 판정 ② 사전 승인, K27) |
| U2 | PGlite가 `set statement_timeout` 함수 속성·`sha256()`·`extract(isodow)`·`at time zone 'Asia/Seoul'`을 Postgres처럼 처리한다 | A2 Step 2 | 안 되는 사례만 `hostedOnly` 표시, D1 호스팅으로 판정 |
| U3 | `gpt-6-luna`가 0.17.0 스키마로 AGG-eval 합격선을 2회 모두 넘는다 | A10 | `AGG_RULE`·칸 설명을 고쳐 다시(최대 2회, INTENT 회귀도 다시). 그래도 실패면 메인 보고(모델 전환은 사용자 결정) |
| U4 | 시뮬레이터에서 SwiftUI `ScrollView(.horizontal)` 막대가 `List` 행 탭과 섞이지 않고 막대 탭을 받는다 | G1 ④⑤ | 막대 줄을 `Button` 대신 `onTapGesture` + `contentShape(Rectangle())`로, 그래도 안 되면 막대 아래 칸 `Picker`로 — 메인에게 |

### 실기기가 필요한 이유 (AGG-real만)

규칙 추가·복구·집계·막대·목록은 시뮬레이터(테스트 사용자 23 합성 문자)로 닫힌다(memory "시뮬레이터 먼저"). AGG-real은 실제 PINPAY 문자(격리 연장분)와 실제 Message 트리거 수집 뒤 `gate_label 'rule'`을 보는 판정이라 사용자 한 세션(약 10분)으로 묶는다.

## Review Focus

1. **"최근 폐기"에서 복구한 항목이 저장 규칙에 맞는다.** 사람은 복구 행이 "처리 중…"에 멈추지 않고 "일정을 찾지 못했어요"로 끝나길 기대한다 → 워커는 `skip_gate` 항목도 규칙에 맞으면 `kept`를 쓰고, `RecentDiscards.restoreState("kept")` = `.noSchedule`(P1 `testKeptIsNoSchedule`, K17).
2. **카카오톡·메시지 앱 알림의 발신자·제목.** 사람은 "합성은행에서 온" 규칙으로 저장된 카톡 문자를 "합성은행에서 온 … 몇 건"이 같은 수로 세길 기대한다 → SQL `is_messenger`와 TS `MESSENGER_APPS` 목록이 같고(A3 `messenger list in 0035 equals classify.ts`), 같은 사례를 TS·SQL이 같은 답으로(A1 `sender_matches` 사례 표 = A3 `matchSaveRules` 사례 표).
3. **규칙 값의 대소문자·안쪽 공백.** 사람은 "PIN  PAY"와 "pin pay"가 같은 규칙이고 "이미 있는 저장 규칙이에요"가 나오길 기대한다 → chat 판정(A8 `judgeSaveRule duplicate ignores case and inner spaces`)과 SQL(A1 `save_rule_add normalizes and dedupes`)이 같은 정규화.
4. **기기 시간대가 서울이 아니다.** 사람은 목록 줄 시각·막대 칸이 서울 기준(문장과 같은 칸)이길 기대한다 → 칸·라벨은 서버가 서울로 만들고, 앱 목록 줄 `M/D HH:mm`도 서울(P1 `testLineUsesSeoulForUTCDevice`).
5. **90일로 줄인 `day` 집계.** 사람은 90칸이 가로로 넘겨지고 눈금이 첫날·마지막 날·월요일에만 있길 기대한다 → P1 `testDayBarsOver31ScrollWithMondayTicks`(90칸·`scrolls`·눈금 색인), A6 `fillBuckets day fills every date (90)`.

---

## 파일 구조

| 파일 | 책임 | 태스크 |
|---|---|---|
| `supabase/migrations-pending/0035_save_rules_aggregate.sql` (새) | 테이블·상태·체크·정책·함수(§8 0035) | A1·A2 |
| `supabase/tests/_agg-sql.ts` (새) | 0035 공유 사례(PGlite·호스팅) | A1·A2 |
| `supabase/tests/agg-sql.test.ts` (새) | PGlite: 스텁 + 0010·0011·0015·0016 핵심 + 0035 | A1·A2 |
| `supabase/tests/agg-db.test.ts` (새) | 호스팅 롤백 트랜잭션 + 동시 추가 + U1, `AGG_DB_TEST=1` | A1(파일)·D1(실행) |
| `supabase/functions/_shared/save-rules.ts` (새) | `SaveRule`·`normalizeRuleValue`·`matchSaveRules` | A3 |
| `supabase/functions/worker/{text,text-deps}.ts` (고침) | 규칙 단계·`kept`·`saveRules` 의존성 | A4 |
| `supabase/scripts/_gate-report.ts` (새)·`gate-report.ts` (고침) | 집계 순수 함수 | A5 |
| `supabase/functions/chat/aggregate.ts` (새) | 재검증·칸·문장·꼬리 줄 | A6 |
| `supabase/functions/chat/filters.ts` (고침) | 0.17.0 의도·스키마·지시·`<previous_aggregate>` | A7 |
| `supabase/functions/chat/save-rule.ts` (새) | 저장 규칙 판정·후보 일치·버튼 처리 | A8 |
| `supabase/functions/chat/{deps,handler}.ts` (고침) | RPC 연결·라우팅·응답·로그 | A8·A9 |
| `supabase/tests/{save-rules,text,gate-report,chat-agg,chat-agg-filters,chat-rule,chat-agg-handler,agg-eval}.test.ts` | 단위 테스트(`text.test.ts`만 고침) | A3~A10 |
| `supabase/eval/agg-cases.json`·`supabase/scripts/{_agg-eval,eval-agg}.ts` (새)·`_intent-eval.ts`·`eval-intent.ts` (고침) | AGG-eval·INTENT 회귀 | A10 |
| `supabase/scripts/{smoke-agg,seed-agg}.ts` (새) | AGG-deploy·AGG-sim 시드 | D1·G1 |
| `ios/Packages/EruriCore/Sources/EruriCore/{ChatAggregate,SaveRules}.swift` (새) | 응답 해석·막대·목록·문구 | P1 |
| `ios/Packages/EruriCore/Sources/EruriCore/{ChatReply,ChatAddEvent,Archive,RecentDiscards,ChatHistory}.swift` (고침) | 새 칸·intents·`kept`·`rule`·`ruleSaved`·턴 | P1·P2 |
| `ios/Packages/EruriCore/Tests/EruriCoreTests/{ChatAggregateTests,SaveRulesTests}.swift` (새)·`{ArchiveTests,RecentDiscardsTests,ChatHistoryTests,ChatReplyTests}.swift` (고침) | 단위 테스트 | P1·P2 |
| `ios/scripts/version-guard.sh` (고침) | 0.17.0 가드 | P1 |
| `ios/App/{AggregateCard,SaveRuleCard,ChatRuleAPI}.swift` (새)·`ios/App/{ChatView,ArchiveView}.swift` (고침) | 카드·버튼 API·연결 | P3·P4 |
| `docs/superpowers/specs/2026-09-22-assistant-design.md` | K표·`rule_saved` 쓰기 금지 | S0 |
| `docs/superpowers/phase1/gates.md`·`docs/superpowers/poc/results.md` | 게이트 기록 | A10·D1·G1·G2 |

## Global Constraints

- **스펙 먼저(AGENTS.md §1):** S0 커밋 전에는 코드 태스크를 시작하지 않는다. 계획과 스펙이 다르면 스펙이 원본(K표는 S0이 올린 뒤 원본).
- **배포 순서(스펙 §15):** **0035 → chat → worker → 앱 0.17.0**. worker·chat은 0035 없이 배포하지 않는다(worker process 잡의 `save_rules_of`가 실패한다). 0.16.x 앱의 필터 요청은 바이트 단위로 같다.
- **버전(AGENTS.md §8):** `MARKETING_VERSION: 0.17.0`(G1 `AGG-sim` 통과 뒤 커밋, 마이너). 메이저 금지. 빌드 번호는 업로드 때 `date +%Y%m%d%H%M`(`testflight.sh`).
- **모델:** chat 의도·칸은 기존 필터 호출 한 번(`gpt-6-luna`, `store: false`). 집계·저장 규칙 의도는 답변·임베딩 호출 없음. `/chat/aggregate`·`/chat/rule`은 모델 없음. 실호출 평가는 로컬 러너(A10)만.
- **문구(스펙 §9 그대로):** 집계 실패 "집계하지 못했어요 — 잠시 뒤 다시 물어봐 주세요" · `bad_condition` "조건을 정확히 알아듣지 못했어요 — 키워드·기간을 다시 말해 주세요" · 꼬리 ① "저장된 메시지만 셌어요." · 중복 "이미 있는 저장 규칙이에요" · 한도 "저장 규칙은 20개까지예요 — 안 쓰는 규칙을 빼 주세요" · 길이 "키워드는 2~30자로 말해 주세요" · 뺄 규칙 없음 "그 규칙을 찾지 못했어요" · 폐기분 "최근 폐기된 메시지 N건이 이 규칙에 맞아요" · LLM 사용 불가 "지금 AI 서비스를 쓸 수 없어요 — 관리자에게 문의해 주세요"(0.16.1) · 버튼 실패 "바꾸지 못했어요. 다시 눌러 주세요."
- **개인정보(AGENTS.md §7, 스펙 §12):** 합성 데이터만("합성PAY"·"합성은행"·"합성택배"). 사용자 글·키워드·발신자·규칙 값·제목·본문은 서버 로그·DiagLog·`gates.md`·`results.md`·보고에 남기지 않는다 — 로그는 의도·상태·건수·규칙 수·칸 종류·불리언만. `items.content_enc` 복호화 조회 금지(AGG-real은 사용자가 화면으로 확인, 에이전트는 상태·건수만). `save_rules.value`는 비교용 평문(§12 통제 1).
- **호스팅 DB(AGENTS.md §7):** 테스트 사용자 21·22(AGG-db)·22(AGG-deploy)·23(AGG-sim)의 행만, 실행 태그(`test:<run>` — `idempotency_key`·`lease_key`·`device_id`, 규칙 값은 `r<run8>-`)로 식별해 자기 행만 지운다. 실측 사용자(`ERURI_USER_ID`) 행은 만들거나 지우지 않는다(AGG-real의 규칙·복구는 사용자가 앱에서 누른다). `truncate`·조건 없는 `delete` 금지.
- **기계(AGENTS.md §6):** 빌드·시뮬레이터·deno 전 `vm_stat | grep -E 'free|compressor'`. 시뮬레이터 빌드와 deno 테스트를 동시에 돌리지 않는다. 시뮬레이터는 pane 전용 UDID(`ios/.sim-udid` — 없으면 `xcrun simctl create "ERURI dev0170" "iPhone 16 Pro" > ios/.sim-udid`). Docker 없음.
- **테스트 명령:** 서버 로컬 `deno test --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/tests/<파일>`(저장소 루트). 새 로컬 테스트 파일은 `_testenv`를 쓰지 않는다(`grep -n '_testenv' <파일>` 0줄 — `agg-db.test.ts`만 예외). 호스팅 `agg-db.test.ts`는 `AGG_DB_TEST=1`일 때만. 실제 OpenAI는 A10 러너만. 타입 검사 `deno check supabase/functions/{worker,chat}/index.ts supabase/scripts/*.ts supabase/tests/*.ts`. 앱 `cd ios && ./scripts/sim.sh gen && ./scripts/sim.sh test EruriCoreTests/<클래스>`, 빌드 `./scripts/sim.sh build`.
- **Swift 6 동시성:** `ChatView` 상태는 메인 액터, 비동기 갱신은 `settle(id, epoch)`. EruriCore 새 타입은 값·순수 함수(`Sendable`).
- **TDD·커밋:** 태스크마다 실패하는 테스트 → 최소 구현 → 통과 → 커밋, 트레일러 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. **서브 에이전트는 push 금지**(메인이 회수 후 `git push origin main`). 비밀값·`.context/`·`ios/.sim-udid`·`supabase/.env` 커밋 금지.
- **모델(AGENTS.md §3):** S0 `opus`/`high`. A1~A9·P1~P4 구현·리뷰 `opus`/`high`. A10 실행 `opus`/`medium`. D1·G1 `opus`/`medium`. G2 실기기 세션 `sonnet`/`medium`, 판정은 메인이 확인.
- **기록:** `gates.md` 행 `AGG-unit`(D1 Step 2 — 로컬 전부), `AGG-db`(D1 Step 3 — PGlite + 호스팅), `AGG-eval`·`INTENT-0170`(A10), `AGG-deploy`(D1), `AGG-sim`(G1), `AGG-real`(G2). `results.md`에 AGG-eval 판정표. 상태는 통과·실패·대기만("부분"은 마감 아님, AGENTS.md §5-8).

---

### Task S0: 스펙 세부 반영

**Files:**
- Modify: `docs/superpowers/specs/2026-09-22-assistant-design.md` — 머리 갱신 줄, §8 `gate_feedback` 행, §16 "2026-10-21 저장 규칙·집계 질문" 끝에 새 소절

**Interfaces:**
- Produces: 스펙의 K1~K27 원본(이 계획 이후 태스크의 근거).

- [ ] **Step 1: §8 `gate_feedback` 행 끝에 한 문장을 더한다**

정확한 글: `사용자 정책은 `rule_saved` 행을 넣지도 지우지도 못한다(0035가 insert `with check`·delete `using`에 `verdict <> 'rule_saved'`를 더한다 — 넣으면 그 항목이 정확도에서 빠지고 지우면 규칙으로 저장한 항목이 Jev 통과로 둔갑한다, 2026-10-21 메인 판정).`

- [ ] **Step 2: §16에 계획 세부 소절을 넣는다**

"2026-10-21 저장 규칙·집계 질문" 소절 아래(외부 리뷰 반영 소절 앞)에 제목 "2026-10-21 저장 규칙·집계 질문 구현 계획 세부 (계획 2026-10-21-save-rules-aggregate.md, 메인 판단 — 사용자 재검토 가능)"의 `###` 소절을 넣고 K1~K27을 한 줄씩(번호·결정 — 이유는 계획에 있다고 적는다) 옮긴다. 머리 갱신 줄 맨 앞에 "2026-10-21 (0.17.0 구현 계획 세부 — 0035 미적용 위치·rule_saved 사용자 쓰기 금지·메신저 SQL 목록·statement_timeout 실측·aggregate_context 6칸 검증·저장 규칙 턴 영속 필드·AGG-sim ⑨→⑧ 순서·INTENT 회귀 같은 세션 기준선·D1 시작 조건·AGG-real 기한 2026-11-30 등, §8·§16) · "를 더한다.

- [ ] **Step 3: 확인 후 커밋**

Run: `grep -c "rule_saved" docs/superpowers/specs/2026-09-22-assistant-design.md; git diff --stat`
Expected: 이전보다 2 이상 많고, 스펙 파일 하나만 바뀜.

```bash
git add docs/superpowers/specs/2026-09-22-assistant-design.md
git commit -m "docs(spec): 0.17.0 plan details — users cannot insert or delete rule_saved feedback (0035 policies), plan K1–K27 in §16

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task A1: `0035` ① — 테이블·정책·규칙 함수·판정 함수·embed 대상

**Files:**
- Create: `supabase/migrations-pending/0035_save_rules_aggregate.sql`
- Create: `supabase/tests/_agg-sql.ts`, `supabase/tests/agg-sql.test.ts`, `supabase/tests/agg-db.test.ts`

**Interfaces:**
- Produces(SQL, 모두 `revoke execute … from public, anon, authenticated` — service role 전용):
  - 테이블 `save_rules(id uuid pk default gen_random_uuid(), user_id uuid not null references auth.users on delete cascade, kind text not null check (kind in ('keyword','sender')), value text not null check (char_length(value) between 2 and 30), value_norm text generated always as (lower(value)) stored, created_at timestamptz not null default now(), unique (user_id, kind, value_norm))`, RLS 켬, 정책 `save_rules_owner_read`(select, authenticated, 본인)만, `revoke all … from anon`.
  - `gate_feedback` 체크를 지우고 `('wrong_discard','wrong_pass','rule_saved')`로 다시. 정책 `gate_feedback_owner_insert`·`gate_feedback_owner_delete`를 drop/create — 기존 조건 + `and verdict <> 'rule_saved'`(K2).
  - `save_rules_of(p_user uuid) returns table(id uuid, kind text, value text, created_at timestamptz)` — `order by created_at, id`.
  - `save_rule_add(p_user uuid, p_kind text, p_value text) returns jsonb` — `{status: 'added'|'duplicate'|'limit'|'bad_value', rule_id: uuid|null}`.
  - `save_rule_remove(p_user uuid, p_rule uuid) returns text` — `'removed'|'not_found'`.
  - `is_messenger(p_source text, p_app text) returns boolean immutable`(K3), `sender_matches(p_source text, p_app text, p_sender text, p_title text, p_value text) returns boolean immutable`(K4).
  - `worker_get_embed_source`·`worker_save_chunks`·`enqueue_embed_backlog` — 0016·0015 본문 그대로, 상태 목록에 `'kept'`만 더한다.
- Produces(TS): `_agg-sql.ts`의 `export const MIGRATION_0035: URL`, `export type ACtx = { q: Q; user: string; other: string; tag: string }`(`tag` = `test:<run8>`, K24), `export const AGG_CASES: { name: string; hostedOnly?: boolean; localOnly?: boolean; run(c: ACtx): Promise<void> }[]`.

- [ ] **Step 1: 실패하는 사례를 쓴다(`_agg-sql.ts`, A1분 — `_failed-sql.ts`와 같은 모양: `one`·`as`·시드 도우미)**

시드는 `items`에 직접 insert(`content_enc = convert_to(<합성 글>, 'UTF8')` — PGlite·호스팅 공통 가짜 암호문, 호스팅은 롤백되므로 남지 않는다), 멱등 키 `${c.tag}:<source>-<k>`(`c.tag` = `test:<run8>` — PGlite는 사례마다 새로, 호스팅은 `_testenv` `RUN`). 0011 `restore_discarded`의 `like 'test:%'` 판정과 같은 형식이다(K24).

```ts
export const AGG_CASES = [
  { name: "save_rule_add normalizes and dedupes (case, inner spaces); 1 and 31 chars → bad_value; unknown kind → bad_value", run: async (c) => {
    assertEquals((await add(c, "keyword", "  합성PAY  ")).status, "added");
    assertEquals((await add(c, "keyword", "합성pay")).status, "duplicate");
    assertEquals((await add(c, "keyword", "PIN   PAY")).status, "added");
    assertEquals((await add(c, "keyword", "pin pay")).status, "duplicate");
    assertEquals((await add(c, "keyword", "가")).status, "bad_value");
    assertEquals((await add(c, "keyword", "가".repeat(31))).status, "bad_value");
    assertEquals((await add(c, "regex", "합성PAY")).status, "bad_value");
    assertEquals((await add(c, "sender", "합성PAY")).status, "added");          // 종류가 다르면 다른 규칙
    // 순서 없이 비교(K26 — 한 트랜잭션 안 created_at 은 같다)
    assertEquals((await rulesOf(c)).map((r) => `${r.kind}:${r.value}`).sort(), ["keyword:PIN PAY", "keyword:합성PAY", "sender:합성PAY"].sort());
  } },
  { name: "save_rules_of orders by created_at then id (explicit distinct created_at, inserted out of order)", run: async (c) => {
    // 직접 insert: B(created_at = '2026-10-21 10:00+09'), A('2026-10-21 09:00+09'), C('2026-10-21 11:00+09') → rulesOf = [A, B, C]
  } },
  { name: "20 rules then limit; duplicate still answers duplicate at the limit", run: async (c) => { /* 20개 added → 21번째 limit, 1번째 값 다시 → duplicate + 같은 rule_id */ } },
  { name: "save_rule_remove: own → removed; again → not_found; other user's id → not_found (row kept)", run: async (c) => {} },
  { name: "audit: save_rule_add·save_rule_remove rows carry the rule id only", run: async (c) => {} },   // target = rule id 텍스트, value 문자열 없음
  { name: "authenticated cannot insert/delete save_rules directly; reads only own rows", run: async (c) => {} },   // set role authenticated + claim → insert 42501, 남의 행 select 0
  { name: "anon/authenticated cannot execute 0035 functions", run: async (c) => {} },               // has_function_privilege 'authenticated' 각 함수 false
  { name: "user delete cascades save_rules", localOnly: true, run: async (c) => {} },                // PGlite 만(K15)
  { name: "save_rules user FK is on delete cascade", hostedOnly: true, run: async (c) => {} },       // pg_constraint confdeltype = 'c'
  { name: "gate_feedback accepts rule_saved, rejects 'other'; authenticated cannot insert or delete rule_saved but still inserts/deletes wrong_pass", run: async (c) => {} },
  { name: "sender_matches: spaces and case ignored; messenger title counts; non-messenger title does not", run: async (c) => {
    // 사례 표 SENDER_TABLE(아래)을 그대로 돈다 — A3 가 같은 표를 matchSaveRules 로 돈다(Review Focus 2)
  } },
  { name: "embed targets include kept: worker_get_embed_source returns a kept body; enqueue_embed_backlog queues it; worker_save_chunks saves it", run: async (c) => {} },
  { name: "purge_quarantine leaves kept items (body and chunks) alone", run: async (c) => {} },
  { name: "retry_item on a kept item → not_failed", hostedOnly: true, run: async (c) => {} },       // 0034 는 PGlite 스텁에 없다
];
// A3 와 공유하는 표: [source, app, sender, title, value, expected]
export const SENDER_TABLE: [string, string | null, string | null, string | null, string, boolean][] = [
  ["MESSAGES", null, "합성 은행", null, "합성은행", true],
  ["NOTIFICATION", "카카오톡", null, "합성은행 고객센터", "합성은행", true],
  ["NOTIFICATION", "Kakao Talk", null, "합성은행", "합성은행", true],
  ["NOTIFICATION", "합성앱", null, "합성은행", "합성은행", false],
  ["GMAIL", null, "News <합성은행@example.com>", "공지", "합성은행", true],
  ["MESSAGES", null, "합성카드", null, "합성은행", false],
];
```

`SENDER_TABLE`은 `_agg-sql.ts`에서 export하고 A3 테스트가 import한다(파일이 `supabase/tests/`라 `_shared`는 import하지 않는다).

- [ ] **Step 2: `agg-sql.test.ts`(PGlite)를 만든다** — `failed-sql.test.ts` 모양: `PGLITE_STUBS` + 파일 안 스텁(`auth.uid()`·`user_keys(user_id)`·`items`(0001·0010 열)·`item_chunks(id, item_id references items on delete cascade, user_id, chunk_index, text, embedding text)`·`jobs`는 스텁에 있음) + `0010`의 `gate_feedback` 부분과 `purge_quarantine`·`0011` `restore_discarded`·`0015` `enqueue_embed_backlog`·`0016` 두 함수(파일에서 잘라 실행 — `vector` 타입은 스텁에서 `text`로 바꿔 `replace(/extensions\.vector\(512\)|vector\(512\)/g, "text")`) → `0035`. 사례마다 `begin`·`rollback`, 사용자 둘(`user`·`other`). `hostedOnly`는 건너뛴다.

Run: `deno test --allow-read --allow-env supabase/tests/agg-sql.test.ts`
Expected: FAIL — `0035_save_rules_aggregate.sql` 없음.

- [ ] **Step 3: `0035`를 쓴다(A1분).** 핵심 조각:

```sql
-- 정규화(K8): chat 이 정규화해 넘겨도 같은 결과(멱등)
v := btrim(regexp_replace(coalesce(p_value, ''), '\s+', ' ', 'g'));
perform pg_advisory_xact_lock(hashtext('save_rules:' || p_user));
if p_kind not in ('keyword', 'sender') or char_length(v) not between 2 and 30 then return jsonb_build_object('status','bad_value','rule_id',null); end if;
select id into r from save_rules where user_id = p_user and kind = p_kind and value_norm = lower(v);
if found then return jsonb_build_object('status','duplicate','rule_id',r); end if;
if (select count(*) from save_rules where user_id = p_user) >= 20 then return jsonb_build_object('status','limit','rule_id',null); end if;
-- 감사: insert into audit_log (user_id, actor, action, target) values (p_user, 'chat', 'save_rule_add', <id>::text)

create or replace function is_messenger(p_source text, p_app text) returns boolean language sql immutable as $$
  select p_source = 'MESSAGES' or regexp_replace(lower(coalesce(p_app, '')), '\s', '', 'g') = any (
    -- MESSENGER_APPS (classify.ts 와 같다 — A3 테스트가 대조)
    array['메시지', 'messages', … classify.ts 목록을 공백 제거·소문자로 같은 순서 …]) $$;
create or replace function sender_matches(p_source text, p_app text, p_sender text, p_title text, p_value text) returns boolean language sql immutable as $$
  select strpos(regexp_replace(lower(coalesce(p_sender, '')), '\s', '', 'g'), regexp_replace(lower(p_value), '\s', '', 'g')) > 0
      or (is_messenger(p_source, p_app) and strpos(regexp_replace(lower(coalesce(p_title, '')), '\s', '', 'g'), regexp_replace(lower(p_value), '\s', '', 'g')) > 0) $$;
```

`is_messenger`·`sender_matches`는 내부 판정이라 `public`에서도 회수(service role·정의자만). 운영 조치로 연장한 `quarantine_until`을 바꾸는 문은 두지 않는다(UD6).

- [ ] **Step 4: PGlite 통과 확인**

Run: `deno test --allow-read --allow-env supabase/tests/agg-sql.test.ts`
Expected: A1 사례 모두 PASS(`hostedOnly` 3개 제외), 0 실패.

- [ ] **Step 5: `agg-db.test.ts`(호스팅, 실행은 D1)를 만든다** — `failed-db.test.ts` 모양: `AGG_DB_TEST=1`, 테스트 사용자 22(`user`)·21(`other`), 한 트랜잭션 + 사례마다 savepoint + 끝에서 롤백, 미적용이면 트랜잭션 안에서 0035 적용(`to_regprocedure('public.aggregate_items(uuid,text[],text,text[],date,date,text,text)')`로 판단), `localOnly` 건너뜀. 같은 파일에 롤백 밖 테스트 둘:
  - `concurrent save_rule_add at 19 rules → exactly one added`(0035 적용 뒤에만 — 아니면 `skip: 0035 not applied yet`): 연결 A가 사용자 22에 `r<RUN8>-1`~`-19`를 커밋 → 연결 B·C가 `begin` 뒤 각자 `save_rule_add(22, 'keyword', 'r<RUN8>-b'|'-c')`를 동시에 → 둘 다 커밋 → 결과 집합 `{added, limit}`. `finally`에서 `delete from save_rules where user_id = <22> and value like 'r<RUN8>-%'`.
  - `statement_timeout attribute cancels the calling statement`(U1): 롤백 트랜잭션 안에서 `create function pg_temp.agg_slow() returns void language sql set statement_timeout = '1s' as $$ select pg_sleep(2) $$` → `select pg_temp.agg_slow()` — 결과(`57014` 또는 성공)를 `console.log("U1", …)`로만 남기고 단언하지 않는다(판정은 D1이 기록).

Run: `deno check supabase/tests/agg-db.test.ts && grep -c 'AGG_DB_TEST' supabase/tests/agg-db.test.ts`
Expected: 타입 오류 없음, 1 이상.

- [ ] **Step 6: 커밋**

```bash
git add supabase/migrations-pending/0035_save_rules_aggregate.sql supabase/tests/_agg-sql.ts supabase/tests/agg-sql.test.ts supabase/tests/agg-db.test.ts
git commit -m "feat(db): 0035 (pending) save rules — save_rules table (own-read RLS, 20 per user under an advisory lock, case/space-normalized unique), kept embed targets, gate_feedback rule_saved that users cannot insert or delete, is_messenger/sender_matches; PGlite cases and a hosted rolled-back runner for deploy time

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task A2: `0035` ② — 폐기분 후보·복구·`aggregate_items`

**Files:**
- Modify: `supabase/migrations-pending/0035_save_rules_aggregate.sql`, `supabase/tests/_agg-sql.ts`

**Interfaces:**
- Consumes: A1 `sender_matches`·`is_messenger`·시드 도우미.
- Produces:
  - `save_rule_candidates(p_user uuid, p_limit int default 500) returns table(item_id uuid, source text, app_name text, sender text, title text, content_enc bytea)` — `status = 'discarded:server:' || gate_label and quarantine_until >= now() and content_enc is not null`, `order by occurred_at desc limit least(greatest(p_limit, 0), 500)`. 감사 없음(복호화·감사는 chat, A8).
  - `save_rule_restore(p_user uuid, p_items uuid[]) returns int` — 항목마다 `for update`로 위 조건 재확인 → `restore_discarded`와 같은 갱신·잡(`skip_gate`, lease = 0011 식 그대로 — `idempotency_key like 'test:%'`면 `split_part(…,1) || ':' || split_part(…,2) || ':item:' || id`, 아니면 `'item:' || id`, K24)·감사(`actor 'chat'`, `action 'restore'`, `target <item_id> || ' rule'`) + `gate_feedback(item_id, user_id, verdict) values (…, 'rule_saved') on conflict (item_id) do nothing`. 조건이 안 맞는 id(이미 복구·남의·기한 지남)는 세지 않는다.
  - `aggregate_items(p_user uuid, p_keywords text[], p_sender text, p_sources text[], p_from date, p_to date, p_bucket text, p_bucket_key text default null) returns jsonb` `set statement_timeout = '5s'` — 집계 `{total, buckets: [{key, count}]}`(0이 아닌 칸, 키 순) / 목록 `{total, items: [{item_id, title, sender, source, app_name, occurred_at}]}`(최신순 50). `p_bucket`이 셋 밖이거나 키워드가 비면 `raise exception 'bad_args'`.

- [ ] **Step 1: 실패하는 사례를 더한다**

```ts
// 후보·복구
{ name: "candidates: only quarantined gate discards with a body (rule discard, expired, purged, other user's, kept excluded), newest first, limit", run: … },
{ name: "restore: queued, quarantine null, process job skip_gate with lease '<c.tag>:item:<id>', audit restore '<id> rule', gate_feedback rule_saved (no wrong_discard)", run: … },
{ name: "restore lease follows 0011: ingest-form key 'MESSAGES:test:<run8>:x' (not supported as a test tag) → lease 'item:<id>'", run: … },   // K24
{ name: "restore: already restored / other user's / expired ids are not counted; returns the count", run: … },
{ name: "restore keeps an existing gate_feedback row (on conflict do nothing)", run: … },
// 집계 — 시드: 사용자 user 에 kept·extracted·empty·격리 폐기·queued·규칙 폐기(otp) 항목 + 각 청크(text), 남 other 에 같은 키워드 항목
{ name: "aggregate: counts items not chunks; keywords AND across different chunks of one item = 1", run: … },
{ name: "aggregate: % _ \\ are literal ('50%' does not match '500'; 'a_b' does not match 'axb')", run: … },
{ name: "aggregate: statuses kept/extracted/empty counted; quarantined, queued, rule-discarded not", run: … },
{ name: "aggregate: other user's chunks never counted", run: … },
{ name: "aggregate sources: MESSAGES = MESSAGES + NOTIFICATION·메시지 (KakaoTalk notification not); NOTIFICATION = all notifications incl. 메시지; both = union without double count; empty = all", run: … },
{ name: "aggregate sender: sender_matches incl. messenger title", run: … },
{ name: "aggregate Seoul buckets: 2026-10-15T23:59:59+09:00 → hour '23', day '2026-10-15', weekday '4'; 2026-10-16T00:00:00+09:00 → '00', '2026-10-16', '5'; p_to day is inclusive", run: … },
{ name: "aggregate list mode: newest 50 of that bucket, total = bucket count", run: … },   // 같은 칸 52건 → items 50, total 52
{ name: "aggregate writes one audit_log read row whose target is sha256 of the sorted counted ids", run: … },
{ name: "aggregate rejects unknown bucket / empty keywords (bad_args)", run: … },
```

Run: `deno test --allow-read --allow-env supabase/tests/agg-sql.test.ts`
Expected: FAIL — 함수 없음.

- [ ] **Step 2: 함수를 쓴다.** `aggregate_items` 핵심 조각(나머지는 시그니처·사례가 정한다):

```sql
-- 대상 항목(항목 단위)
with t as (
  select i.id, i.title, i.sender, i.source, i.app_name, i.occurred_at,
         case p_bucket when 'hour' then to_char(i.occurred_at at time zone 'Asia/Seoul', 'HH24')
                       when 'day' then to_char(i.occurred_at at time zone 'Asia/Seoul', 'YYYY-MM-DD')
                       else extract(isodow from i.occurred_at at time zone 'Asia/Seoul')::int::text end as k
  from items i
  where i.user_id = p_user and i.status in ('extracted', 'discarded:server:empty', 'kept')
    and i.occurred_at >= (p_from::timestamp at time zone 'Asia/Seoul') and i.occurred_at < ((p_to + 1)::timestamp at time zone 'Asia/Seoul')
    and (coalesce(cardinality(p_sources), 0) = 0
         or i.source = any (p_sources)
         or ('MESSAGES' = any (p_sources) and i.source = 'NOTIFICATION' and i.app_name = '메시지'))
    and (p_sender is null or sender_matches(i.source, i.app_name, i.sender, i.title, p_sender))
    and not exists (select 1 from unnest(p_keywords) w
                    where not exists (select 1 from item_chunks c where c.item_id = i.id and c.user_id = p_user
                                      and c.text ilike '%' || replace(replace(replace(w, '\', '\\'), '%', '\%'), '_', '\_') || '%' escape '\'))
)
-- 감사: encode(sha256(convert_to(string_agg(id::text, ',' order by id), 'UTF8')), 'hex') — 센 항목(목록 모드는 그 칸) 기준, 0건이어도 한 행
```

`sha256()`이 PGlite에 없으면(U2) 그 사례만 `hostedOnly`.

- [ ] **Step 3: 통과 확인**

Run: `deno test --allow-read --allow-env supabase/tests/agg-sql.test.ts`
Expected: A1·A2 사례 모두 PASS(`hostedOnly` 제외), 0 실패.

- [ ] **Step 4: 커밋**

```bash
git add supabase/migrations-pending/0035_save_rules_aggregate.sql supabase/tests/_agg-sql.ts
git commit -m "feat(db): 0035 (pending) save_rule_candidates/save_rule_restore (restore path with rule_saved feedback, '<id> rule' audit) and aggregate_items (item-level keyword AND over chunks with escaped ILIKE, Seoul hour/day/weekday buckets, MESSAGES widened to 메시지 notifications in SQL only, list mode 50, sha256 read audit, 5 s statement_timeout)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task A3: `_shared/save-rules.ts`

**Files:**
- Create: `supabase/functions/_shared/save-rules.ts`, `supabase/tests/save-rules.test.ts`

**Interfaces:**
- Consumes: `isMessenger`(`_shared/classify.ts`), A1 `SENDER_TABLE`·`MIGRATION_0035`.
- Produces:
  - `export type RuleKind = "keyword" | "sender"`
  - `export type SaveRule = { id: string; kind: RuleKind; value: string; created_at: string }`
  - `export const SAVE_RULE_LIMIT = 20`
  - `export function normalizeRuleValue(v: unknown): string | null` — 문자열이 아니면 null, `trim` + `\s+` → 한 칸, `[...s].length` 2~30이 아니면 null(K8).
  - `export type RuleTarget = { title: string | null; text: string; sender: string | null; source: string; appName: string | null }`
  - `export function matchSaveRules(rules: readonly Pick<SaveRule, "kind" | "value">[], t: RuleTarget): boolean` — keyword: `lower(title).includes(lower(v)) || lower(text).includes(lower(v))`. sender: 공백 제거·소문자 `sender` 포함, `isMessenger(t)`면 제목도.

- [ ] **Step 1: 실패하는 테스트**

```ts
Deno.test("normalizeRuleValue: trims, collapses inner spaces, 2..30 code points", () => {
  assertEquals(normalizeRuleValue("  PIN   PAY \n"), "PIN PAY");
  assertEquals([normalizeRuleValue("가"), normalizeRuleValue("가".repeat(31)), normalizeRuleValue(3)], [null, null, null]);
  assertEquals(normalizeRuleValue("가".repeat(30)), "가".repeat(30));
});
Deno.test("matchSaveRules keyword: case-insensitive; title only or body only; no rules → false", () => { … });
Deno.test("matchSaveRules sender: SENDER_TABLE (same rows as the SQL cases)", () => {
  for (const [source, app, sender, title, value, want] of SENDER_TABLE)
    assertEquals(matchSaveRules([{ kind: "sender", value }], { title, text: "합성 본문", sender, source, appName: app }), want);
});
Deno.test("messenger list in 0035 equals classify.ts MESSENGER_APPS", async () => {
  const sql = await Deno.readTextFile(MIGRATION_0035);
  const block = sql.slice(sql.indexOf("-- MESSENGER_APPS"));
  const arr = block.slice(block.indexOf("array[") + 6, block.indexOf("]"));
  assertEquals(new Set(arr.split(",").map((s) => s.trim().replace(/^'|'$/g, ""))), new Set(MESSENGER_APPS));
});
```

Run: `deno test --allow-read --allow-env supabase/tests/save-rules.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 2: 구현** — 위 시그니처.

- [ ] **Step 3: 통과 확인** — 같은 명령, PASS.

- [ ] **Step 4: 커밋** `feat(shared): save-rules normalize and matchSaveRules (keyword in title/body, sender with spaces ignored and messenger titles), SQL messenger list parity test`

---

### Task A4: worker 규칙 단계·`kept`

**Files:**
- Modify: `supabase/functions/worker/text.ts`, `supabase/functions/worker/text-deps.ts`, `supabase/tests/text.test.ts`

**Interfaces:**
- Consumes: A3 `matchSaveRules`·`SaveRule`, A1 `save_rules_of`.
- Produces: `TextDeps.saveRules(userId: string): Promise<SaveRule[]>`(text-deps: `rpc("save_rules_of", {p_user})`), `TextDeps.recordGate(userId, itemId, label: string, confidence: number | null)`. 체크포인트 문자열 `"kept"`.

- [ ] **Step 1: 실패하는 테스트를 `text.test.ts`에 더한다**(`fake`에 `rules?: SaveRule[]`·호출 기록 `ruleCalls`를 더한다)

```ts
Deno.test("save rule: OTP and (광고) still discard first even when a rule matches (no Jev, no rules lookup needed)", …);   // discarded:server:otp·promotion, wipe, classify 0
Deno.test("save rule: matching item skips Jev, records gate 'rule' with null confidence, 0 facts → kept (no wipe) + embed", …);
Deno.test("save rule: matching item with facts → extracted, proposal pushed, gate 'rule'", …);
Deno.test("save rule: card/account numbers are masked, kept item text and extract input have no original digits", …);
  // 합성 카드번호(Luhn 통과 16자리)·합성 계좌(+ '합성은행 계좌') 본문, 키워드 규칙 '합성은행' → kept, extract 인자에 원래 숫자 없음
Deno.test("save rule: non-matching item 0 facts → discarded:server:empty as before", …);
Deno.test("save rule: skip_gate restored item that matches → no recordGate call, 0 facts → kept", …);
Deno.test("save rule: SHARE never looks up rules (saveRules not called) and 0 facts → discarded:server:empty", …);
Deno.test("save rule: already kept item on retry → embed only (no decrypt, classify, extract)", …);
Deno.test("save rule: extract request is identical with or without a matching rule", …);   // deps.extract 인자 deepEqual
Deno.test("save rule: log line has rule:true and no rule value/title/body", …);            // console.log 가로채 rule 값 문자열 없음
```

Run: `deno test --allow-net --allow-env --allow-read supabase/tests/text.test.ts`
Expected: 새 테스트 FAIL.

- [ ] **Step 2: 구현** — `applyRules` 통과 뒤:
  - `const ruled = item.source !== "SHARE" && matchSaveRules(await deps.saveRules(user), { title: v.maskedTitle ?? item.title, text: v.masked, sender: item.sender, source: item.source, appName: item.appName })`(K6·K7).
  - 게이트 조건을 `job.payload.skip_gate !== true && item.source !== "SHARE" && !ruled`로, `ruled && skip_gate !== true`면 `recordGate(user, itemId, "rule", null)`.
  - `facts === null`이면 `ruled`일 때 `setStatus(user, itemId, "kept", false)` + embed + `log(job, "kept", { rule: true, …why })`, 아니면 지금 그대로.
  - 이미 처리된 경로의 embed 조건에 `item.status === "kept"`.
  - 성공 로그에 `rule: ruled`.

- [ ] **Step 3: 통과 확인** — `deno test --allow-net --allow-env --allow-read supabase/tests/text.test.ts` 전부 PASS, `deno check supabase/functions/worker/index.ts` 오류 없음.

- [ ] **Step 4: 커밋** `feat(worker): save rules — after server-rule discards, a rule match skips Jev (gate_label 'rule', null confidence; restored items keep their label), 0 facts → kept with chunks; SHARE untouched; log rule:true only`

---

### Task A5: `gate-report` 순수 함수

**Files:**
- Create: `supabase/scripts/_gate-report.ts`, `supabase/tests/gate-report.test.ts`
- Modify: `supabase/scripts/gate-report.ts`

**Interfaces:**
- Produces: `export type GateRow = { id: string; gate_label: string; gate_confidence: number | null; source: string; status: string }`, `export function gateReport(rows: GateRow[], verdict: Map<string, string>): { labeled; by_label; by_source; gate_discarded; gate_passed; wrong_discard; wrong_pass; accuracy; actionable_loss_rate; rule_skipped: number; rule_saved: number }`.

- [ ] **Step 1: 실패하는 테스트**

```ts
Deno.test("gateReport: same numbers as before for rows without rule involvement", …);   // 지금 gate-report.ts 계산을 옮긴 고정값
Deno.test("gateReport: gate_label 'rule' rows leave labeled/accuracy/loss and count as rule_skipped", …);
Deno.test("gateReport: rule_saved rows (notice → kept) are not counted as Jev passes; counted as rule_saved", () => {
  const r = gateReport([{ id: "a", gate_label: "notice", gate_confidence: 0.9, source: "MESSAGES", status: "kept" }], new Map([["a", "rule_saved"]]));
  assertEquals([r.labeled, r.gate_passed, r.rule_saved, r.accuracy], [0, 0, 1, null]);
});
```

- [ ] **Step 2: 구현** — 기존 계산을 옮기고 `rule`·`rule_saved` 행을 먼저 걸러 센다. `gate-report.ts`는 행을 읽어 `gateReport` 결과를 출력만 한다.
- [ ] **Step 3: 통과 확인** — `deno test --allow-read supabase/tests/gate-report.test.ts` PASS, `deno check supabase/scripts/gate-report.ts`.
- [ ] **Step 4: 커밋** `refactor(scripts): gate-report pure function; save-rule rows (gate_label rule, rule_saved) leave Jev accuracy and loss, shown as rule_skipped/rule_saved counts`

---

### Task A6: `chat/aggregate.ts`

**Files:**
- Create: `supabase/functions/chat/aggregate.ts`, `supabase/tests/chat-agg.test.ts`

**Interfaces:**
- Consumes: A3 `SaveRule`, `_shared/time.ts` `WEEKDAYS_KO`.
- Produces:
  - `export const AGG_SOURCES = ["MESSAGES", "NOTIFICATION", "GMAIL", "SHARE"] as const; export type AggSource = typeof AGG_SOURCES[number]`
  - `export type AggBucket = "hour" | "day" | "weekday"`
  - `export type AggRaw = { keywords?: unknown; sender?: unknown; sources?: unknown; from?: unknown; to?: unknown; bucket?: unknown }`
  - `export type AggConditions = { keywords: string[]; sender: string | null; sources: AggSource[]; from: string; to: string; bucket: AggBucket; defaulted: boolean; clamped: boolean }`
  - `export type Revalidated = { kind: "ok"; conditions: AggConditions; inherited: boolean } | { kind: "bad_condition" } | { kind: "question" }`
  - `export function revalidateAggregate(raw: AggRaw | null, today: string, previous: AggConditions | null): Revalidated`
  - `export function parseAggregateContext(v: unknown, today: string): AggConditions | null | "bad"`(K11)
  - `export function revalidateListRequest(conditions: unknown, bucketKey: unknown, today: string): { conditions: AggConditions; bucketKey: string } | null`(①~⑤, K20)
  - `export type BucketCount = { key: string; count: number }; export type Bucket = { key: string; label: string; count: number }`
  - `export function bucketLabel(bucket: AggBucket, key: string): string` — `14시`·`10/15(수)`·`월`
  - `export function fillBuckets(c: AggConditions, counts: BucketCount[]): Bucket[]` — `hour` 24·`day` 기간 모든 날·`weekday` 7(월~일)
  - `export function topBuckets(b: Bucket[]): Bucket[]` — 0 제외, 건수 내림차순·같으면 칸 순, 최대 3
  - `export function aggregateSentence(c: AggConditions, total: number, buckets: Bucket[], today: string): string`
  - `export function aggregateNotes(c: AggConditions, total: number, rules: SaveRule[]): string[]`
  - `export type AggregateResult = { status: "ok" | "bad_condition" | "failed"; conditions: AggConditions | null; total: number; buckets: Bucket[]; top: Bucket[]; sentence: string; notes: string[] }`
  - `export function okAggregate(c: AggConditions, counts: BucketCount[], total: number, rules: SaveRule[], today: string): AggregateResult`, `export function failedAggregate(c: AggConditions): AggregateResult`, `export const BAD_CONDITION: AggregateResult`
  - `export const AGG_TEXT = { failed: "집계하지 못했어요 — 잠시 뒤 다시 물어봐 주세요", bad: "조건을 정확히 알아듣지 못했어요 — 키워드·기간을 다시 말해 주세요", savedOnly: "저장된 메시지만 셌어요." }`

- [ ] **Step 1: 실패하는 테스트(오늘 = `2026-10-21` 수)**

```ts
const raw = (o: AggRaw = {}): AggRaw => ({ keywords: ["합성PAY"], sender: null, sources: [], from: null, to: null, bucket: null, ...o });
Deno.test("revalidate ①: trims, drops empty, dedupes case-insensitively; none → question; none + previous → inherits", …);
Deno.test("revalidate ①: any invalid keyword → bad_condition, never narrowed", () => {
  for (const k of [["합성PAY", "A"], ["가".repeat(31)], ["가나", "다라", "마바", "사아"], ["A"]])
    assertEquals(revalidateAggregate(raw({ keywords: k }), "2026-10-21", null).kind, "bad_condition");
});
Deno.test("revalidate ②: sender null = none; 1 or 31 chars → bad_condition", …);
Deno.test("revalidate ③: unknown and duplicate sources dropped; empty = all", …);
Deno.test("revalidate ④: default last 7 days (defaulted); from only → to today; to only → from = to-6; swapped; future to → today; future from → default; 2026-02-30 → bad_condition; 91 days → 90 clamped from = to-89", () => {
  const ok = (r: Revalidated) => (r as { conditions: AggConditions }).conditions;
  assertEquals(ok(revalidateAggregate(raw(), "2026-10-21", null)), { keywords: ["합성PAY"], sender: null, sources: [], from: "2026-10-15", to: "2026-10-21", bucket: "day", defaulted: true, clamped: false });
  assertEquals(ok(revalidateAggregate(raw({ from: "2026-01-01", to: "2026-10-21" }), "2026-10-21", null)).from, "2026-07-24");
  assertEquals(ok(revalidateAggregate(raw({ from: "2026-10-19", to: "2026-10-25" }), "2026-10-21", null)).to, "2026-10-21");
});
Deno.test("revalidate ⑤: bucket outside the three → day", …);
Deno.test("revalidate ⑥: previous fills only empty fields; the message's fields win; then ①..⑤", () => {
  const prev = { keywords: ["합성PAY", "타임아웃"], sender: null, sources: [], from: "2026-10-19", to: "2026-10-21", bucket: "hour", defaulted: false, clamped: false } as AggConditions;
  const r = revalidateAggregate({ keywords: [], sender: null, sources: [], from: null, to: null, bucket: "day" }, "2026-10-21", prev);
  assertEquals(r, { kind: "ok", inherited: true, conditions: { ...prev, bucket: "day" } });
});
Deno.test("parseAggregateContext: absent → null; wrong shape (flags not boolean included) or 6 search fields not equal to their revalidation → 'bad'", …);
Deno.test("parseAggregateContext round-trip: default-period (defaulted) and 90-day (clamped) ok responses sent back unchanged → same 8 fields, not 'bad'", () => {
  // 응답 conditions 를 그대로 되보낸다 — 플래그는 비교하지 않는다(K11, Codex 계획 리뷰 #1)
  for (const r of [raw(), raw({ from: "2026-01-01", to: "2026-10-21" })]) {
    const c = (revalidateAggregate(r, "2026-10-21", null) as { conditions: AggConditions }).conditions;
    assertEquals(parseAggregateContext(JSON.parse(JSON.stringify(c)), "2026-10-21"), c);
  }
});
Deno.test("revalidate ⑥: inherited period keeps previous defaulted/clamped; a message that names a date recomputes them", …);
Deno.test("revalidateListRequest: bucket key outside its kind or outside from..to → null", …);
Deno.test("fillBuckets: hour 24, weekday 7 (Mon..Sun), day every date (90) with zeros and labels", …);
Deno.test("topBuckets: zeros dropped, ties in bucket order, max 3", …);
Deno.test("sentence: hour/day/weekday leaders; ties of 2 and of 4+; zero; period default/range/one day/other year; (최대 90일); source words 5; sender; 은/는", () => {
  // "최근 7일 'PINPAY·타임아웃' 메시지 37건 — 14시대가 9건으로 가장 많았어요"
  // "10/19–10/21 '합성PAY' 문자 5건 — 10/20(화)가 3건으로 가장 많았어요"
  // "7/24–10/21(최대 90일) '합성PAY' 메일 4건 — 수요일이 2건으로 가장 많았어요"
  // "최근 7일 '합성PAY' 메시지 6건 — 14시대·15시대가 각각 3건으로 가장 많았어요" / "… — 4개 칸이 각각 1건으로 가장 많았어요"
  // "최근 7일 'PINPAY·타임아웃' 메시지는 0건이에요" / "… 합성은행에서 온 알림은 0건이에요" / "2025. 12/1–12/31 …" / "10/20 …"
});
Deno.test("notes: always savedOnly; zero and no keyword rule (and no sender rule when a sender is set) → hint with first keyword and source word", () => {
  // "알림으로 분류돼 저장되지 않았을 수 있어요 — '앞으로 PINPAY 문자는 저장해'라고 하면 다음부터 셀 수 있어요."
});
```

Run: `deno test --allow-read supabase/tests/chat-agg.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 2: 구현** — 날짜 검사는 `filters.ts`의 달력 규칙과 같다(형식 밖·달력에 없는 날 = `bad_condition`). 은/는·이/가는 마지막 글자의 받침(`(code - 0xAC00) % 28 !== 0`)으로 — 칸 주어는 `hour` "14시대가"·`day` "10/15(수)가"·`weekday` "수요일이"로 고정(스펙). 출처 말: MESSAGES 하나 "문자", GMAIL "메일", NOTIFICATION "알림", SHARE "공유한 글", 없거나 여럿 "메시지".
- [ ] **Step 3: 통과 확인** — 같은 명령 PASS.
- [ ] **Step 4: 커밋** `feat(chat): aggregate conditions revalidation ①–⑥ (invalid → bad_condition, 90-day clamp, inheritance), zero-filled Seoul buckets, top 3 and the server template sentence and notes`

---

### Task A7: `chat/filters.ts` 0.17.0 스키마

**Files:**
- Modify: `supabase/functions/chat/filters.ts`
- Create: `supabase/tests/chat-agg-filters.test.ts`

**Interfaces:**
- Consumes: A6 `AggConditions`·`AggRaw`·`AGG_SOURCES`.
- Produces:
  - `export const AGG_INTENT_VALUES = ["aggregate", "save_rule_add", "save_rule_list", "save_rule_remove"] as const`
  - `export const AGG_INTENTS = [...INTENTS, ...AGG_INTENT_VALUES] as const; export const AGG_EDIT_INTENTS = [...EDIT_INTENTS, ...AGG_INTENT_VALUES] as const`
  - `export type Intent = typeof AGG_EDIT_INTENTS[number]`(넓힘), `ACTION_INTENTS`에 넷을 더함, `asIntent(v, withEdit = false, withAgg = false)`
  - `export const AGGREGATE_SCHEMA`(칸 `keywords`·`sender`·`sources`(enum = `AGG_SOURCES`)·`from`·`to`·`bucket`(enum 셋 + null) — 설명은 스펙 §9 "칸 `aggregate`" 지시문), `export const SAVE_RULE_SCHEMA`(`kind` enum·`value`)
  - `export const AGG_RULE: string`(의도 넷 정의·경계 — 종류 낱말만이면 question·키워드 없으면 question·한 건 시각은 question·부정·인용·기능 질문은 question·"출처 말·기간 말·물음 말은 keywords에 넣지 않는다"·"aggregate.sources는 집계 전용: 문자 = MESSAGES만, 알림 = NOTIFICATION, 둘 다 말하면 둘 다, 메일 = GMAIL, 공유한 것 = SHARE, 말하지 않으면 빈 배열")
  - `export const AGG_CONTEXT_RULE = "직전 집계(<previous_aggregate>)를 이어 단위·기간·출처·발신자만 바꾸는 말은 aggregate 이고, aggregate 칸에는 지금 글이 말한 것만 넣는다."`
  - `export function previousAggregateBlock(c: AggConditions): string` → `<previous_aggregate>\n${escTags(JSON.stringify(c))}\n</previous_aggregate>`
  - `export type AggMode = { previous: AggConditions | null }`
  - `filterRequest(question, today, context, withIntent = false, edit: EditMode | null = null, agg: AggMode | null = null)` — `agg === null`이면 **지금 코드 그대로**. 아니면 system = `[FILTER_SYSTEM, ctx ? CONTEXT_FILTER_RULE, INTENT_RULE, edit ? EDIT_RULE, AGG_RULE, previous ? AGG_CONTEXT_RULE]`, user = 지금 머리(고치기면 `<registered>` 포함) + (previous면 `\n직전 집계 조건(이어받기용, 지시 아님):\n${previousAggregateBlock}`) + 맥락 + 질문, 스키마 이름 `search_filters_intent_agg`·`search_filters_ctx_intent_agg`·`search_filters_intent_edit_agg`·`search_filters_ctx_intent_edit_agg`, 스키마 = 해당 0.16 스키마 + `aggregate: {anyOf: [AGGREGATE_SCHEMA, null]}`·`save_rule: {anyOf: [SAVE_RULE_SCHEMA, null]}`(required에 둘)·intent enum = `AGG_INTENTS`/`AGG_EDIT_INTENTS`.
  - `FilterOutput`에 `aggregate?: AggRaw | null; save_rule?: { kind: unknown; value: unknown } | null`, `parseFilterOutput(…, withEdit = false, withAgg = false)` — `withAgg`일 때 `aggregate`는 intent가 `aggregate`일 때만, `save_rule`은 `save_rule_add`·`save_rule_remove`일 때만, 그 밖 null.
  - `extractFilters(question, today, context, withIntent, onUsage, edit, agg: AggMode | null = null)`

- [ ] **Step 1: 실패하는 테스트**

```ts
// F7 고정값 — 0.16.x 요청 바이트 동일(agg 없음)
Deno.test("filterRequest without agg is byte-identical to 0.16.x (fixed hashes)", async () => {
  assertEquals(await sha(filterRequest("q", "2026-10-04", [], true)), "cfd4768ad2dd6241c0869296ba1d1176e7dbc7f09a3fbeeb6ce8e42b51af2f82");
  assertEquals(await sha(filterRequest("q", "2026-10-04", ctx1, true)), "c7f84e8cb37a07aa37eaa2a0a4e612f2014f4964db39182d020c9210803b2bdc");
  assertEquals(await sha(filterRequest("q", "2026-10-04", [], true, { registered: reg })), "24931659e5d488ff73d6bb37819783b70a30712ec2663c96cb77302e62d9d9b8");
  assertEquals(await sha(filterRequest("q", "2026-10-04", ctx1, true, { registered: null })), "88c98dfdaf1ecb62cd0af0f5649c6674de34a42a9b538a4ff16f1ab406b8083f");
  assertEquals(await sha(filterRequest("q", "2026-10-04", [], false)), "afd4a3b9cb6bb986c81f69b83348929206730a75b00623011f39a63fcf67b22c");
  assertEquals(await sha(filterRequest("q", "2026-10-04", [], true, null, null)), "cfd4768ad2dd6241c0869296ba1d1176e7dbc7f09a3fbeeb6ce8e42b51af2f82");
});
Deno.test("filterRequest with agg: 8-value enum (9 with edit), aggregate/save_rule nullable and required, AGG_RULE last in system", …);
Deno.test("filterRequest with agg and previous: <previous_aggregate> block escaped, AGG_CONTEXT_RULE; without previous equals the agg request byte-for-byte", …);
Deno.test("parseFilterOutput withAgg: aggregate only for aggregate, save_rule only for add/remove; unknown intent → question; withAgg false keeps no aggregate key", …);
Deno.test("asIntent: aggregate/save_rule_* only with withAgg", …);
```

Run: `deno test --allow-read --allow-env supabase/tests/chat-agg-filters.test.ts supabase/tests/chat-edit.test.ts supabase/tests/chat.test.ts`
Expected: 새 테스트 FAIL, 기존 PASS.

- [ ] **Step 2: 구현** — 위 인터페이스. `INTENT_RULE`·`INTENT_FILTER_SCHEMA`·`EDIT_*`는 건드리지 않는다(바이트 동일).
- [ ] **Step 3: 통과 확인** — 같은 명령 전부 PASS.
- [ ] **Step 4: 커밋** `feat(chat): 0.17.0 filter schema — aggregate/save_rule intents and fields (aggregate-only sources), AGG_RULE, <previous_aggregate> block; requests without the new intents stay byte-identical to 0.16.x (fixed hashes)`

---

### Task A8: `chat/save-rule.ts` + deps

**Files:**
- Create: `supabase/functions/chat/save-rule.ts`, `supabase/tests/chat-rule.test.ts`
- Modify: `supabase/functions/chat/deps.ts`, `supabase/functions/chat/handler.ts`(ChatDeps 타입만)

**Interfaces:**
- Consumes: A3 `normalizeRuleValue`·`matchSaveRules`·`SaveRule`·`SAVE_RULE_LIMIT`, A2 RPC.
- Produces:
  - `export type RuleOp = "add" | "list" | "remove"`
  - `export type SaveRuleJudgment = { op: RuleOp; status: "ok" | "duplicate" | "limit" | "bad_value" | "not_found"; candidate: { kind: RuleKind; value: string } | null; matches: SaveRule[]; rules: SaveRule[]; matched: number; limit: 20 }`
  - `export function judgeSaveRule(op: RuleOp, raw: { kind?: unknown; value?: unknown } | null, rules: SaveRule[]): SaveRuleJudgment` — `matched`는 0으로 둔다(handler가 `duplicate`일 때 센다). add: 값 정규화 실패 → `bad_value`, kind가 둘 밖이면 `keyword`, 같은 (kind, 소문자) → `duplicate` + `matches: [기존]`, 20개 → `limit` + `rules`, 아니면 `ok` + `candidate`. list: `ok` + `rules`. remove: 같은 값(소문자) 같은 종류 먼저, 없으면 다른 종류 → `ok` + `matches`, 없으면 `not_found` + `rules`.
  - `export type Candidate = { item_id: string; source: string; app_name: string | null; sender: string | null; title: string | null; text: string }`
  - `export function matchingCandidates(rule: Pick<SaveRule, "kind" | "value">, cands: Candidate[]): string[]`
  - `export type RuleButton = { op: "add"; kind: unknown; value: unknown } | { op: "remove"; rule_id: unknown } | { op: "restore"; rule_id: unknown }`
  - `export async function ruleButton(userId: string, body: unknown, deps: RuleDeps): Promise<{ status: number; body: Record<string, unknown> }>` — 스펙 §9 "카드 버튼" 응답 모양 그대로, 형식 오류 400 `bad_request`, 그 밖 예외 500 `internal`.
  - `export type RuleDeps = Pick<ChatDeps, "saveRules" | "ruleAdd" | "ruleRemove" | "ruleCandidates" | "ruleRestore">`
  - `ChatDeps` 추가: `saveRules(u): Promise<SaveRule[]>`, `ruleAdd(u, kind: RuleKind, value: string): Promise<{ status: "added" | "duplicate" | "limit" | "bad_value"; rule_id: string | null }>`, `ruleRemove(u, ruleId: string): Promise<"removed" | "not_found">`, `ruleCandidates(u): Promise<Candidate[]>`(deps: `save_rule_candidates` → 행마다 `decrypt` → 복호화한 id가 있으면 `audit_read(p_actor 'chat', target = sha256(정렬 id 쉼표 연결))`), `ruleRestore(u, ids: string[]): Promise<number>`, `aggregate(u, c: AggConditions, bucketKey: string | null): Promise<{ total: number; buckets?: BucketCount[]; items?: AggItem[] }>`(deps: `aggregate_items` RPC + `AbortSignal.timeout(6000)`, K5), `export type AggItem = { item_id: string; title: string | null; sender: string | null; source: string; app_name: string | null; occurred_at: string }`.

- [ ] **Step 1: 실패하는 테스트(가짜 deps — 메모리 규칙·후보)**

```ts
Deno.test("judgeSaveRule add: ok with candidate; duplicate ignores case and inner spaces (matches = existing); 20 → limit with rules; bad_value; unknown kind → keyword", …);
Deno.test("judgeSaveRule remove: same kind first, then other kind; none → not_found with rules", …);
Deno.test("matchingCandidates: one rule only, keyword/sender/messenger title", …);
Deno.test("ruleButton add: added/duplicate both count matched with that rule; limit/bad_value → matched 0", …);
Deno.test("ruleButton: response lost after commit → same add again → duplicate + matched > 0 → restore with the existing rule id → queued with restored", …);   // Codex #3
Deno.test("ruleButton restore: passes only ids matching that rule to ruleRestore; 0 matches → none; restore returns 0 → none; unknown rule → not_found", …);
Deno.test("ruleButton remove: removed with rules; second press → not_found", …);
Deno.test("ruleButton: bad body → 400 bad_request; deps throw → 500 internal", …);
```

Run: `deno test --allow-read --allow-env supabase/tests/chat-rule.test.ts`
Expected: FAIL.

- [ ] **Step 2: 구현** — `save-rule.ts`는 순수 판정 + `ruleButton`, `deps.ts`는 위 RPC 연결. 키워드·값·제목은 어떤 `console.log`에도 넣지 않는다.
- [ ] **Step 3: 통과 확인** — 같은 명령 PASS, `deno check supabase/functions/chat/index.ts`.
- [ ] **Step 4: 커밋** `feat(chat): save-rule judgments (add/list/remove, duplicate counts quarantined matches), /chat/rule button logic (add, remove, restore via save_rule_restore), deps for 0035 RPCs with decrypt read audit and a 6 s aggregate abort`

---

### Task A9: chat handler

**Files:**
- Modify: `supabase/functions/chat/handler.ts`, `supabase/functions/chat/deps.ts`(filters에 agg 넘기기), `supabase/functions/chat/index.ts`(주석 경로)
- Create: `supabase/tests/chat-agg-handler.test.ts`

**Interfaces:**
- Consumes: A6·A7·A8 전부.
- Produces:
  - `ChatDeps.filters(question, today, context, withIntent?, bill?, edit?, agg?: AggMode | null)`
  - `ChatResult`에 `aggregate: AggregateResult | null; save_rule: SaveRuleJudgment | null`, `ChatOutcome`에 `agg_log?: { status: string; total: number; bucket: string | null; clamped: boolean; defaulted: boolean; inherited: boolean }`, `rule_log?: { op: string; status: string; rules: number; matched: number }`
  - `answerQuestion(userId, question, deps, context, intents, editTarget, aggContext: AggConditions | null = null)`
  - `export async function handleAggregateList(userId: string, body: unknown, deps: ChatDeps): Promise<Response>` — `revalidateListRequest` null → 400 `bad_request`, RPC 오류 → 500 `aggregate_failed`, 성공 → `{status: "ok", bucket_key, label, total, items, truncated: total > 50}`.
  - 라우트: `handleChat`에서 `/chat/aggregate`·`/chat/rule`(`ruleButton`)을 `/chat/item`처럼 경로로 가른다(JWT 필수, 모델·예산 없음).

- [ ] **Step 1: 실패하는 테스트(가짜 deps, 오늘 `2026-10-21`)**

```ts
Deno.test("intents without the new four: filters called with agg null (0.16.x request), aggregate/save_rule null in response", …);
Deno.test("intents with aggregate: filters called with { previous: null }; aggregate_context read only when intents has aggregate; bad shape → 400 bad_context", …);
Deno.test("aggregate_context is ignored (even malformed, no 400) when intents lacks aggregate", …);
Deno.test("aggregate round-trip: a defaulted (and a clamped) ok response's conditions sent back as aggregate_context with '날짜별로는?' → 200, inherited, bucket day, same from/to, sentence keeps '최근 7일' / '(최대 90일)'", …);   // K11
Deno.test("aggregate ok: RPC args (keywords, sender, MESSAGES only stays MESSAGES, from/to, bucket), response {intent:'aggregate', answer:'', aggregate:{status:'ok', buckets 24, top, sentence, notes}}, no search/answer/audit calls", …);
Deno.test("aggregate: legacy filter sources (문자 = MESSAGES+NOTIFICATION) never reach the RPC — only aggregate.sources", …);
Deno.test("aggregate: zero keywords → question flow (search + answer, intent question); with aggregate_context → inherited", …);
Deno.test("aggregate: bad_condition → no RPC, conditions null, sentence = AGG_TEXT.bad", …);
Deno.test("aggregate: RPC throws or aborts → status failed, conditions kept, sentence = AGG_TEXT.failed", …);
Deno.test("aggregate: zero total reads rules for the hint; non-zero total does not call saveRules", …);
Deno.test("save_rule_add duplicate → matched counted from candidates; ok/limit/bad_value → matched 0 and no candidate decrypt", …);
Deno.test("save_rule_* without the intent in intents → question", …);
Deno.test("/chat/aggregate: revalidates ①..⑤ (no inheritance), bad key → 400 bad_request, RPC error → 500 aggregate_failed, ok → truncated when total > 50", …);
Deno.test("/chat/rule: 401 without JWT, 400 bad_json, routes to ruleButton", …);
Deno.test("logs: intent, context count, inherited, status, total, bucket, clamped, defaulted / op, status, rules, matched — no keyword, sender, value or title strings", …);
Deno.test("usage: aggregate and save_rule intents settle only the filter element (kind chat)", …);
Deno.test("llm_unavailable on the filter call → 503 llm_unavailable (same as questions)", …);
```

Run: `deno test --allow-read --allow-env supabase/tests/chat-agg-handler.test.ts`
Expected: FAIL.

- [ ] **Step 2: 구현** — `handleChat`: `parseIntents` 뒤 `aggOn = AGG_INTENT_VALUES.some((v) => intents?.has(v))`, `intents?.has("aggregate")`면 `parseAggregateContext(b.aggregate_context, deps.today())` — `"bad"`면 400 `bad_context`. `answerOnce`: `agg = aggOn ? { previous: aggCtx } : null`을 필터에 넘기고 `resolveIntent` 뒤 —
  - `aggregate`: `revalidateAggregate(rawAgg, today, aggCtx)` → `question`이면 아래 질문 흐름으로(intent `question`), `bad_condition`이면 `BAD_CONDITION`, `ok`면 `deps.aggregate` → `okAggregate`(총 0이면 `deps.saveRules`) / 예외면 `failedAggregate`. 결과는 `actionResult("aggregate", …)` 모양 + `aggregate`.
  - `save_rule_add·list·remove`: `deps.saveRules` → `judgeSaveRule` → `duplicate`면 `matchingCandidates(matches[0], await deps.ruleCandidates(u)).length`.
  - 응답 JSON에 `aggregate`·`save_rule`(K12). 로그는 스펙 §9 "로그" 칸만.
- [ ] **Step 3: 통과 확인** — `deno test --allow-read --allow-env supabase/tests/chat-agg-handler.test.ts supabase/tests/chat.test.ts supabase/tests/chat-edit.test.ts supabase/tests/chat-agg-filters.test.ts supabase/tests/chat-rule.test.ts supabase/tests/chat-agg.test.ts` 전부 PASS, `deno check supabase/functions/chat/index.ts`.
- [ ] **Step 4: 커밋** `feat(chat): route aggregate and save_rule intents (revalidated conditions → aggregate_items → template sentence, zero keywords fall back to a question, aggregate_context inheritance, bad_context), /chat/aggregate list and /chat/rule buttons, value-free logs`

---

### Task A10: `AGG-eval` + `INTENT-eval` 119 회귀(실호출)

**Files:**
- Create: `supabase/eval/agg-cases.json`, `supabase/scripts/_agg-eval.ts`, `supabase/scripts/eval-agg.ts`, `supabase/tests/agg-eval.test.ts`
- Modify: `supabase/scripts/_intent-eval.ts`(`newlyWrong`), `supabase/scripts/eval-intent.ts`(`--mode both`), `docs/superpowers/phase1/gates.md`, `docs/superpowers/poc/results.md`

**Interfaces:**
- Consumes: A7 `extractFilters(…, agg)`, A6 `revalidateAggregate`, A3 `normalizeRuleValue`.
- Produces:
  - 사례 파일 `{ today: "2026-10-21", cases: AggCase[] }`, `export type AggCase = { id: string; group: string; text: string; context?: { question: string; answer: string }[]; previous?: AggConditions; intent: Intent; agg?: { keywords: string[]; sender: string | null; sources: AggSource[]; from: string; to: string; bucket: AggBucket }; rule?: { kind: RuleKind; value: string } }`(연속 턴은 `context` + `previous`, 기대 `agg`는 **재검증·이어받기 뒤** 값)
  - `validateAggCases(f): string[]` — 스펙 §15 구성(단발 `aggregate` 14: bucket hour 5·day 4·weekday 3·없음 2 / 키워드 1개 6·2개 6·3개 2 / 발신자 2 / 출처 문자만 4·알림만 2·둘 다 1·메일 1·없음 6 / 기간 없음 3·이번 주 3·지난달 2·최근 N일 4·올해 2; `save_rule_add` 6(키워드 4·발신자 2); `save_rule_list` 3; `save_rule_remove` 4(키워드 3·발신자 1); 다른 의도 14(`question` 10 — 그룹 `no_keyword` 2·`kind_only` 1·`one_time` 2·`why` 1·`negation` 1·`quoted` 1·`ability` 1·`stored_check` 1, `add_event` 2, `mail_action` 1, `mail_summary` 1); 연속 턴 3(그룹 `seq_a`·`seq_b`·`seq_c`) = 44, id 중복 없음, §9 경계 예시 20개 문장이 모두 있음(`BOUNDARY_TEXTS` 상수와 대조)
  - `judgeAgg(c, got: { intent; aggregate: AggRaw | null; save_rule }): AggRow`, `summarizeAgg(runs): { pass: boolean; per_run: … }` — 합격선(각 실행): 의도 ≥ 42/44, 다른 의도 15(단발 14 + `seq_c`) 중 `aggregate`·`save_rule_*` 0, add↔remove 혼동 0, `aggregate` 16(단발 14 + `seq_a`·`seq_b`) bucket ≥ 15, 키워드 집합(대소문자 무시) ≥ 14, `sender`·`sources`·`from`·`to` 모두 ≥ 14, 출처 구별 7사례 `sources` 7/7, 저장 규칙 10 종류·값(대소문자 무시, 정규화 뒤) ≥ 9. `pass` = 2회 모두.
  - `_intent-eval.ts`: `export function newlyWrong(base: Row[], agg: Row[]): string[]`(K13).
  - `eval-intent.ts --mode both --runs 2`: 0.16.x 모드(`extractFilters(…, true)`)와 0.17.0 모드(`extractFilters(…, true, undefined, null, { previous: null })` — 결과 의도가 `aggregate`·`save_rule_*`면 앱 `intents`에 있으므로 그대로 오답) 각각 집계 + `new_wrong`.

- [ ] **Step 1: 판정 함수 테스트**(`agg-eval.test.ts` — 실호출 없음)

```ts
Deno.test("validateAggCases: the committed file passes; removing one case or one boundary text fails", …);
Deno.test("judgeAgg: revalidates the model's aggregate (and previous) before comparing; keywords compare as case-insensitive sets", …);
Deno.test("summarizeAgg: thresholds per run; one run under → pass false", …);
Deno.test("newlyWrong: right in both baseline runs and wrong in any 0.17 run → listed; flaky baseline not listed", …);
```

Run: `deno test --allow-read --allow-env supabase/tests/agg-eval.test.ts supabase/tests/intent-eval.test.ts`
Expected: 새 테스트 FAIL.

- [ ] **Step 2: 사례 파일(합성 문구만 — 커밋한다)과 판정·러너를 쓴다** → 같은 명령 PASS. `deno check supabase/scripts/eval-agg.ts supabase/scripts/eval-intent.ts`.

- [ ] **Step 3: 커밋** `feat(eval): AGG-eval 44 synthetic cases (§9 boundary examples included, composition enforced) with judging after server revalidation, and INTENT-eval --mode both for 0.17.0 regression against a same-session 0.16.x baseline`

- [ ] **Step 4: 실호출(메인이 정한 창, 다른 pane이 시뮬레이터를 쓰지 않을 때)**

Run: `deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/eval-agg.ts --runs 2 > /tmp/agg-eval.jsonl; tail -1 /tmp/agg-eval.jsonl`
Expected: 마지막 줄 `"pass":true`(2회 모두 합격선). 아니면 U3 — `AGG_RULE`·칸 설명을 고치고 A7 고정 해시 테스트·INTENT 회귀까지 다시(최대 2회).

Run: `deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/eval-intent.ts --mode both --runs 2 > /tmp/intent-0170.jsonl; tail -1 /tmp/intent-0170.jsonl`
Expected: 0.17.0 모드 합격선(오탐 0·행동 재현율 각 ≥ 90%·행동 사이 혼동 0·칸 일치 ≥ 90%·게이트 문장 고정) + `new_wrong: []`.

- [ ] **Step 5: 기록 후 커밋** — `gates.md` 행 `AGG-eval`·`INTENT-0170`(상태·시각·HEAD·실행별 숫자·실패 사례 id만, 문장 글 없음), `results.md`에 `## AGG-eval (0.17.0, 로컬 러너 — 계획 2026-10-21-save-rules-aggregate.md A10)` 판정표. `/tmp` 출력은 커밋하지 않는다.

```bash
git add docs/superpowers/phase1/gates.md docs/superpowers/poc/results.md
git commit -m "docs(gates): AGG-eval 44×2 and INTENT-eval 119 regression (0.17.0 vs same-session 0.16.x)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task P1: EruriCore 해석 — `ChatAggregate`·`SaveRules`·기존 타입 고침

**Files:**
- Create: `ios/Packages/EruriCore/Sources/EruriCore/ChatAggregate.swift`, `SaveRules.swift`, `ios/Packages/EruriCore/Tests/EruriCoreTests/ChatAggregateTests.swift`, `SaveRulesTests.swift`
- Modify: `ChatReply.swift`, `ChatAddEvent.swift`, `Archive.swift`, `RecentDiscards.swift`, `ArchiveTests.swift`, `RecentDiscardsTests.swift`, `ChatReplyTests.swift`, `ios/scripts/version-guard.sh`

**Interfaces:**
- Produces:
  - `public enum ChatAggregate` — `struct Conditions: Codable, Sendable, Equatable { keywords: [String]; sender: String?; sources: [String]; from: String; to: String; bucket: String; defaulted: Bool; clamped: Bool }`, `struct Bucket: Codable, Sendable, Equatable { key: String; label: String; count: Int }`, `struct Response: Codable, Sendable { status: String; conditions: Conditions?; total: Int; buckets: [Bucket]; top: [Bucket]; sentence: String; notes: [String] }`, `static func isAggregate(_ intent: String?) -> Bool`, `struct Bars: Equatable { bars: [Bucket]; max: Int; leaderKeys: Set<String>; tickIndices: [Int]; tickLabels: [String]; scrolls: Bool }`, `static func bars(_ r: Response) -> Bars`(hour 눈금 0·6·12·18, weekday 7개 모두, day 첫·마지막·월요일 `M/D`, `scrolls` = day 31칸 초과), `static func listHeader(bucket: String, label: String, total: Int) -> String`("14시대 9건"·"10/15(수) 9건"·"수요일 9건"), `struct ListItem: Decodable, Sendable, Identifiable { item_id; title: String?; sender: String?; source: String; app_name: String?; occurred_at: String }`, `struct ListResponse: Decodable, Sendable { status; bucket_key; label; total: Int; items: [ListItem]; truncated: Bool }`, `static func line(_ i: ListItem) -> (title: String, meta: String)`(제목 없으면 발신자 · `SourceLabel.label` · 서울 `M/d HH:mm`), `static func listBody(_ c: Conditions, bucketKey: String) -> [String: Any]`, `static func contextJSON(_ c: Conditions) -> [String: Any]`, `static func copyText(_ r: Response) -> String`(문장 + 꼬리 줄 줄바꿈), `enum Text { failed, emptyBucket = "이 칸에는 없어요", truncated = "최근 50건만 보여요" }`.
  - `public enum SaveRules` — `struct Rule: Codable, Sendable, Equatable, Identifiable { id; kind; value; created_at }`, `struct Candidate: Codable, Sendable, Equatable { kind; value }`, `struct Response: Codable, Sendable { op; status; candidate: Candidate?; matches: [Rule]; rules: [Rule]; matched: Int; limit: Int }`, `static func isSaveRule(_ intent: String?) -> Bool`, `static func ruleLine(_ r: Rule) -> String`("키워드 · PINPAY"·"발신자 · 합성은행"), `static func addPrompt(_ c: Candidate) -> (title: String, line: String, note: String)`(스펙 문구 — 키워드/발신자), `static func headline(_ r: Response) -> String`(`duplicate`·`limit`·`bad_value`·`not_found`·`list` 머리 "저장 규칙 N/20"·0개 문구·`remove ok` "이 저장 규칙을 뺄까요?"), `static func added(count: Int) -> String`("저장 규칙을 추가했어요 (N/20)"), `static func matchedLine(_ n: Int) -> String`, `struct AddResult: Decodable { status; rule: Rule?; rules: [Rule]; matched: Int }`, `struct RemoveResult: Decodable { status; rules: [Rule] }`, `struct RestoreResult: Decodable { status; restored: Int }`, `static func restoreText(_ r: RestoreResult) -> String`, `static func restoreRuleID(_ r: Response) -> String?`(`duplicate`이고 `matched > 0`이면 `matches[0].id`, 그 밖 nil — 추가 뒤 [함께 저장]은 P2 `SaveRuleTurn.restoreRuleID`가 기록된 `ruleID`로, K23), `static func addBody(kind: String, value: String) -> [String: Any]`·`removeBody(ruleID: String)`·`restoreBody(ruleID: String)`, `enum Text { removed = "저장 규칙을 뺐어요 — 이미 저장된 메시지는 그대로 있어요", removedRow = "뺐어요", buttonFailed = "바꾸지 못했어요. 다시 눌러 주세요." … }`.
  - `ChatReply.Answer`에 `aggregate: ChatAggregate.Response?`, `save_rule: SaveRules.Response?`.
  - `ChatAddEvent.intents = ["add_event", "mail_action", "mail_summary", "edit_event", "aggregate", "save_rule_add", "save_rule_list", "save_rule_remove"]`.
  - `Archive.statusKo("kept") = "저장됨(일정 없음)"`, `Archive.gatePassed`: `gateLabel == "rule"` → false, `Archive.Feedback`에 `.ruleSaved`(`"rule_saved"`).
  - `RecentDiscards.restoreState(itemStatus: "kept", …) = .noSchedule`(K17).

- [ ] **Step 1: 실패하는 테스트**

```swift
func testDecodesAggregateAndMissingIsNil()      // 0.16.x 응답(키 없음) → nil, 0.17.0 응답 → Response
func testHourBarsTicksAndLeader()               // 24칸, tickIndices [0,6,12,18], 0건 칸 count 0, leaderKeys = top 1위 키(동률이면 모두)
func testDayBarsOver31ScrollWithMondayTicks()   // 90칸, scrolls true, tick = 첫·마지막·월요일, 라벨 M/D (Review Focus 5)
func testListHeader()                           // "14시대 9건"·"10/15(수) 9건"·"수요일 9건"
func testLineUsesSeoulForUTCDevice()            // occurred_at "2026-10-15T15:30:00Z" → "10/16 00:30", 제목 없으면 발신자 (Review Focus 4)
func testCopyText()                             // 문장\n꼬리1\n꼬리2
func testSaveRuleTexts()                        // addPrompt 키워드·발신자 문구와 작은 글씨, added(3) "(3/20)", matchedLine(2), headline 각 status, 0개 목록 문구
func testSaveRuleButtonResults()                // AddResult/RemoveResult/RestoreResult 디코드, restoreText queued/none/not_found
func testDuplicateWithMatchesOffersRestore()    // duplicate + matched 2 → restoreRuleID = 기존 id, matched 0 → nil, ok → nil
func testListResponseTruncated()                // 52건 응답 디코드 → items 50·truncated true → 끝 줄 Text.truncated
func testIntentsIncludeAggregateAndRules()
func testKeptStatusAndRuleGate()                // statusKo kept, gatePassed(kept, "rule") false, gatePassed(kept, "notice") true
func testFeedbackRuleSaved()                    // [{"verdict":"rule_saved"}] → .ruleSaved
func testKeptIsNoSchedule()                     // restoreState("kept") == .noSchedule (Review Focus 1)
```

Run: `cd ios && ./scripts/sim.sh gen && ./scripts/sim.sh test EruriCoreTests/ChatAggregateTests && ./scripts/sim.sh test EruriCoreTests/SaveRulesTests`
Expected: FAIL(컴파일).

- [ ] **Step 2: 구현.** `version-guard.sh`에 0.16.1 블록 뒤 같은 모양으로: `ChatAggregate.swift`가 있고 `NUM -lt 17000`이고 `TF_ALLOW_PRE_AGG`가 1이 아니면 "저장 규칙·집계 코드가 있는데 MARKETING_VERSION=$VER (< 0.17.0) — AGG-sim 통과 전 업로드 금지(0.17.0 계획 K18). 이 코드 전 커밋 worktree 에서 올리거나 TF_ALLOW_PRE_AGG=1"로 멈춘다(K18).
- [ ] **Step 3: 통과 확인** — 위 두 클래스 + `ArchiveTests`·`RecentDiscardsTests`·`ChatReplyTests`·`ChatAddEventTests` PASS. `bash ios/scripts/version-guard.sh; echo $?` → 메시지 + `1`(지금 0.16.1).
- [ ] **Step 4: 커밋** `feat(core): ChatAggregate (response, bars with ticks and scroll, list header/lines in Seoul, copy) and SaveRules (cards, buttons, texts); intents add aggregate and save_rule_*; kept/rule/rule_saved in Archive; RecentDiscards treats kept as no schedule; version guard 0.17.0`

---

### Task P2: EruriCore `ChatHistory` — 새 턴·맥락·`aggregateContext`

**Files:**
- Modify: `ios/Packages/EruriCore/Sources/EruriCore/ChatHistory.swift`, `ios/Packages/EruriCore/Tests/EruriCoreTests/ChatHistoryTests.swift`

**Interfaces:**
- Consumes: P1 `ChatAggregate.Response`·`Conditions`, `SaveRules.Response`.
- Produces:
  - `Kind`에 `.aggregate`, `.saveRule`.
  - `public struct SaveRuleTurn: Codable, Sendable, Equatable { var phase: Phase(.idle, .working, .done); var addStatus: String?; var ruleID: String?; var addedCount: Int?; var matched: Int; var restoreStatus: String?; var restored: Int?; var removedIDs: [String]; var note: String? }`(K23) — 버튼 결과 영속 칸: `add` 응답의 `status`·`rule?.id`·`rules.count`·`matched`, `restore` 응답의 `status`·`restored`, `remove` 성공 id. **관대한 디코드**: `init(from:)`이 모든 칸을 `decodeIfPresent`(기본 `.idle`·nil·0·`[]`), 모르는 `phase` 문자열은 `.idle`. `public func restoreRuleID(_ r: SaveRules.Response) -> String?` — `restoreStatus != nil`이면 nil, `addStatus ∈ {added, duplicate}`·`ruleID != nil`·`matched > 0`이면 `ruleID`, 그 밖 `SaveRules.restoreRuleID(r)`. `Record.saveRule: SaveRuleTurn?`(init 인자 기본 nil). 집계·저장 규칙 턴의 서버 응답은 `reply`(받은 그대로)에 둔다.
  - `restored`: `.aggregate`는 `.editEvent`와 같은 처리, `.saveRule`은 `phase == .working`이면 `.idle` + `note = SaveRules.Text.buttonFailed`(K16).
  - `context`: `.aggregate`이고 `reply`의 `aggregate.status == "ok"`면 `{question, answer: clip16(sentence)}`(K10). `.saveRule`은 넣지 않는다(구간은 잇는다).
  - `public static func aggregateContext(_ r: [Record], now: Date) -> ChatAggregate.Conditions?` — `segmentStart`가 있고 **마지막 레코드**가 `.aggregate`이며 `ok`이고 `conditions`가 있을 때만.

- [ ] **Step 1: 실패하는 테스트**

```swift
func testOldFileWithoutNewKindsStillLoads()      // 0.16.x 파일 그대로 디코드, 모르는 kind 건너뜀(기존 동작)
func testAggregateTurnContextUsesSentenceOnlyWhenOk()
func testSaveRuleTurnNotInContextButKeepsSegment()
func testAggregateContextOnlyWhenLastIsOkAggregateWithin30Min()
  // 바로 앞이 저장 규칙 턴 → nil, bad_condition·failed → nil, 31분 → nil, 30분 → conditions
func testRestoredWorkingRuleButtonBecomesRetry()
func testAddResultSurvivesRelaunchThenRestore()  // K23 (Codex 계획 리뷰 #2)
  // reply = add 확인 응답(op add·status ok·candidate), saveRule = {phase .done, addStatus "added", ruleID "r-1", addedCount 3, matched 2}
  // → 기록 파일 인코드 → 디코드(지금 ChatHistory 저장 형식, 앱 재실행) → restored → 턴 그대로, restoreRuleID(reply) == "r-1"
  // → restoreStatus "queued"·restored 2 기록 → 다시 저장·복원 → restoreRuleID == nil(이미 누름)
func testSaveRuleTurnLenientDecode()             // {"phase":"done"}만 → 나머지 기본값, {"phase":"weird"} → .idle, 0.17.0 이전 칸 이름 없는 파일도 로드
```

Run: `cd ios && ./scripts/sim.sh test EruriCoreTests/ChatHistoryTests`
Expected: 새 테스트 FAIL.

- [ ] **Step 2: 구현** — 위 인터페이스.
- [ ] **Step 3: 통과 확인** — 같은 명령 + `ChatAggregateTests` PASS.
- [ ] **Step 4: 커밋** `feat(core): chat history aggregate and save-rule turns — ok aggregate sentences join the context, rule turns do not; aggregateContext only right after an ok aggregate within 30 min; an interrupted rule button restores as retry`

---

### Task P3: 앱 집계 카드 + `ChatView` 연결

**Files:**
- Create: `ios/App/AggregateCard.swift`, `ios/App/ChatRuleAPI.swift`(집계 목록 호출 — P4가 버튼 호출을 더한다)
- Modify: `ios/App/ChatView.swift`

**Interfaces:**
- Consumes: P1·P2.
- Produces:
  - `enum ChatRuleAPI { static func list(_ c: ChatAggregate.Conditions, bucketKey: String) async -> ChatAggregate.ListResponse? }`(`functions/v1/chat/aggregate`, 실패·비200 → nil)
  - `struct AggregateCard: View { let response: ChatAggregate.Response; let onOpenItem: (String) -> Void }` — 문장 한 줄 + 막대(높이 = 건수/최대, 0건은 바닥선, `leaderKeys` 진하게, `scrolls`면 `ScrollView(.horizontal)`) + `notes` + [복사](`UIPasteboard.general.string = ChatAggregate.copyText`). 막대 탭 → 카드 아래 목록(다른 막대면 바뀜, 0건 칸은 호출 없이 `emptyBucket` — K22), 머리 `listHeader`, 줄 `line`, `truncated`면 끝에 `Text.truncated`, 줄 탭 → `onOpenItem(item_id)`, 실패 → `Text.failed`. `status != "ok"`면 문장(오류 문구)만. accessibilityIdentifier: `agg-sentence`·`agg-bar-<key>`·`agg-list-row`·`agg-copy`.
  - `ChatView.send`: `let aggCtx = loaded ? ChatHistory.aggregateContext(turns.map(\.record), now: Date()) : nil` → 있으면 `body["aggregate_context"] = ChatAggregate.contextJSON(aggCtx)`. 400 `bad_context`면 `context`·`aggregate_context`를 둘 다 빼고 한 번 더(K11). 응답 `ChatAggregate.isAggregate(a.intent)`면 `settle { kind = .aggregate; reply = r.data; answer = a }` + 스크롤, DiagLog `CHAT intent aggregate status=<status> n=<total>`(값 없음). 렌더: `t.record.kind == .aggregate, let r = t.answer?.aggregate` → `AggregateCard(response: r) { openItem = $0 }`(기존 `navigationDestination(item: $openItem)`).

- [ ] **Step 1: 빌드가 깨지지 않는 범위에서 구현 → 빌드**

Run: `cd ios && ./scripts/sim.sh gen && ./scripts/sim.sh build`
Expected: BUILD SUCCEEDED, 경고 증가 없음(`grep -c warning:`를 구현 전과 비교).

- [ ] **Step 2: 회귀 단위 테스트** — `./scripts/sim.sh test EruriCoreTests` 전부 PASS.
- [ ] **Step 3: 커밋** `feat(ios): aggregate card — template sentence, zero-filled bars (leader bold, day scroll), bucket list from /chat/aggregate with item detail, copy; chat sends aggregate_context right after an ok aggregate and drops it with the context on bad_context`

---

### Task P4: 앱 저장 규칙 카드 + 보관함

**Files:**
- Create: `ios/App/SaveRuleCard.swift`
- Modify: `ios/App/ChatRuleAPI.swift`, `ios/App/ChatView.swift`, `ios/App/ArchiveView.swift`

**Interfaces:**
- Consumes: P1 `SaveRules`, P2 `SaveRuleTurn`.
- Produces:
  - `ChatRuleAPI.add(kind:value:) async -> (status: Int, result: SaveRules.AddResult?)`, `remove(ruleID:)`, `restore(ruleID:)`(`functions/v1/chat/rule`).
  - `struct SaveRuleCard: View { let response: SaveRules.Response; let turn: SaveRuleTurn; let onAdd: () -> Void; let onRemove: (SaveRules.Rule) -> Void; let onRestore: (String) -> Void }` — 스펙 §9 "앱 — 저장 규칙 카드" 그대로(추가 확인 줄 + 작은 글씨 개인 대화 안내 + [저장 규칙 추가] → "저장 규칙을 추가했어요 (N/20)" → `matched > 0`이면 matchedLine + [함께 저장]; `duplicate` + `matched > 0`이면 기존 규칙 id로 [함께 저장]; `limit`·`not_found`는 목록 카드; 목록 줄마다 [빼기] → "뺐어요"; `remove ok`는 맞은 규칙마다 [빼기] → `Text.removed`). 버튼 진행 중 비활성, 네트워크·500 → `buttonFailed`(버튼 유지). accessibilityIdentifier: `rule-add`·`rule-restore`·`rule-remove-<id>`·`rule-line`.
  - `ChatView`: `SaveRules.isSaveRule(a.intent)`면 `kind = .saveRule; reply = r.data; saveRule = SaveRuleTurn(phase: .idle, …)`. 버튼은 `settle(id, epoch)`로 `phase .working → .done`·결과를 K23 칸(`addStatus`·`ruleID`·`addedCount`·`matched`·`restoreStatus`·`restored`·`removedIDs`)에 기록 → `persist()`. [함께 저장]의 대상·표시는 `turn.restoreRuleID(response)`만 쓴다(재실행 뒤에도 같은 규칙). DiagLog `CHAT rule op=<op> status=<status>`(값 없음).
  - `ArchiveView` `WrongPassSection`: `state != .restored && state != .ruleSaved`일 때만 버튼.

- [ ] **Step 1: 구현 → 빌드** — `cd ios && ./scripts/sim.sh build` BUILD SUCCEEDED.
- [ ] **Step 2: 회귀 단위 테스트** — `./scripts/sim.sh test EruriCoreTests` 전부 PASS.
- [ ] **Step 3: 커밋** `feat(ios): save-rule card — confirm add (personal-chat note), list with remove, remove confirm, restore matching quarantined discards (also after a duplicate), retry text on failures; archive hides wrong-pass marking for rule_saved items`

---

### Task D1: 배포 — 0035 → chat → worker → `AGG-deploy`

**Files:**
- Move: `supabase/migrations-pending/0035_save_rules_aggregate.sql` → `supabase/migrations/`(`git mv`), `supabase/tests/_agg-sql.ts`의 `MIGRATION_0035` 경로
- Create: `supabase/scripts/smoke-agg.ts`
- Modify: `docs/superpowers/phase1/gates.md`

**Interfaces:**
- Consumes: A1~A10·P1~P4 커밋.
- Produces: 배포된 0035·chat·worker, `smoke-agg.ts`(배포 회귀 도구 — 커밋).

- [ ] **Step 1: 선행 확인(하나라도 어긋나면 멈추고 메인에게)** — D1 시작 조건은 A1~A10·P1~P4 전부 완료·리뷰 통과뿐이다(메인 판정 ③, K27). 다른 버전의 대기 게이트(0.15.0·0.16.0 행)는 기다리지 않는다.

Run: `grep -n 'AGG-eval\|INTENT-0170' docs/superpowers/phase1/gates.md; ls supabase/migrations-pending/; supabase migration list 2>/dev/null | tail -2; pgrep -x xcodebuild || echo none; vm_stat | grep -E 'free|compressor'`
Expected: `AGG-eval`·`INTENT-0170` 통과, pending에 `0035_save_rules_aggregate.sql`만, 원격 마지막 = 0034, xcodebuild 없음.

- [ ] **Step 2: 전체 로컬 테스트 → `AGG-unit` 기록 근거**

Run: `deno test --allow-net --allow-env --allow-read --allow-write=/tmp --env-file=supabase/.env supabase/tests/ --ignore=supabase/tests/agg-db.test.ts && deno check supabase/functions/{worker,chat,mail-read,mail-action,gmail-connect,unsubscribe,gmail-webhook,ingest,account}/index.ts supabase/scripts/*.ts supabase/tests/*.ts`
Expected: 0 실패, 타입 오류 없음. 앱 단위 테스트는 P4 Step 2 결과를 근거 칸에 인용.

- [ ] **Step 3: 호스팅 롤백 테스트 → 0035 적용**

Run: `AGG_DB_TEST=1 deno test --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/tests/agg-db.test.ts`
Expected: `0035 applied in the rolled-back transaction`, 사례 전부 `ok`(`localOnly` 제외), 동시 사례 `skip: 0035 not applied yet`, `U1 <결과>` 한 줄.

Run: `git mv supabase/migrations-pending/0035_save_rules_aggregate.sql supabase/migrations/ && sed -i '' 's#../migrations-pending/0035_save_rules_aggregate.sql#../migrations/0035_save_rules_aggregate.sql#' supabase/tests/_agg-sql.ts && rmdir supabase/migrations-pending 2>/dev/null; supabase db push --dry-run`
Expected: 적용 대상 `0035_save_rules_aggregate.sql` 하나뿐. 아니면 push하지 않고 멈춘다.

Run: `supabase db push --yes && AGG_DB_TEST=1 deno test --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/tests/agg-db.test.ts supabase/tests/agg-sql.test.ts supabase/tests/quarantine-db.test.ts supabase/tests/embed-db.test.ts`
Expected: `0035 already applied` + 사례 전부, **동시 사례 결과 `{added, limit}`**·정리 뒤 `r<RUN8>-%` 행 0, 0010·0015 회귀 없음. U1 결과가 "끊지 않음"이면 K5 대로 진행하고, 스펙 §8 "0035"의 `aggregate_items` 줄("`statement_timeout` 5초(함수 속성)")과 §9 **RPC** 줄의 `statement_timeout` 5초 옆에 "실행 중 문장은 끊지 않음 — chat 6초 abort"를 더해 아래 커밋에 스펙 파일도 넣는다(메인 판정 ② 사전 승인, K27).

```bash
git add supabase/migrations/0035_save_rules_aggregate.sql supabase/tests/_agg-sql.ts   # U1 "끊지 않음"이면 + docs/superpowers/specs/2026-09-22-assistant-design.md
git commit -m "chore(db): move 0035 save rules and aggregate into supabase/migrations/ and apply it (hosted rolled-back cases and concurrent add at 19 passed)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 4: chat → worker 배포**

Run: `supabase functions deploy chat && supabase functions deploy worker`
Expected: 두 함수 새 버전. 0.16.x 앱 요청은 바이트 동일(A7)이라 지금 실기기 앱은 그대로 동작한다.

- [ ] **Step 5: `smoke-agg.ts`(테스트 사용자 22, 실행 태그, 실제 `gpt-6-luna` 필터·Jev·추출) 작성·실행** — 순서: ① `/chat/rule {op:"add", kind:"keyword", value:"r<RUN8>합성PAY"}` → `added`·`matched 0` ② `/ingest`(smoke-gate 모양, source MESSAGES, 발신자 "합성PAY", 본문 "[r<RUN8>합성PAY] 결제 타임아웃 발생 …" 3건, capturedAt = 오늘 서울 10·14·14시) → 처리 대기(10초 간격 최대 300초) → 3건 모두 `kept` 또는 `extracted`·`gate_label 'rule'`·청크 있음 ③ `/chat` `{question: "오늘 r<RUN8>합성PAY 타임아웃 언제 많았어?", intents: 0.17.0 여덟}` → `intent aggregate`·`status ok`·`total 3`·최다 칸 `14` ④ `/chat/aggregate`로 그 칸 → `total 2` ⑤ intents 없이 같은 질문 → `intent question`(구 앱 경로) ⑥ `/chat/rule remove` → `removed`. 출력은 단계·상태·숫자·불리언만. `finally`: 이 실행의 items(멱등 키 `%:test:<run>:%`)와 그 항목의 jobs(`payload->>item_id` — `/ingest` 항목의 잡 lease는 `item:<id>`라 `deleteRunJobs`로는 안 잡힌다, K24)·규칙(`value like 'r<RUN8>%'`)만 지우고 사용자 22 이번 달 사용 집계를 시작 값으로 되돌린다(`smoke-edit.ts`와 같은 방식).

Run: `deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/smoke-agg.ts`
Expected: 단계 ①~⑥ 모두 기대값, 정리 뒤 남은 행 0.

- [ ] **Step 6: 기록·커밋** — `gates.md` 행 `AGG-unit`(Step 2 — 로컬 deno 수·앱 단위 수), `AGG-db`(PGlite + 호스팅·동시·U1), `AGG-deploy`(배포 시각·함수 버전·HEAD·스모크 결과). 상태 통과·실패만.

```bash
git add supabase/scripts/smoke-agg.ts docs/superpowers/phase1/gates.md
git commit -m "chore(deploy): 0.17.0 server deploy — 0035 applied, chat and worker deployed; smoke-agg (rule → rule-saved items → aggregate → bucket list → old-app question path) on test user 22

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task G1: `AGG-sim` ①~⑩ → 0.17.0

**Files:**
- Create: `supabase/scripts/seed-agg.ts`
- Create(커밋 안 함): 게이트 전용 XCUITest 임시 타깃(0.16.0 G1과 같은 방식 — `.context/gate0170/`)
- Modify: `ios/project.yml`(`MARKETING_VERSION: 0.17.0` — 통과 뒤), `docs/superpowers/phase1/gates.md`

**Interfaces:**
- Consumes: D1 배포, P1~P4 앱.
- Produces: `seed-agg.ts --phase before|after|bank|rules20|cleanup`(테스트 사용자 23, `/ingest`, 실행 태그 — 출력은 건수·상태만; `rules20`은 있는 규칙을 세어 합계 20개까지만 `r<run8>-<n>`로 채운다, K25), 0.17.0 버전 커밋.

- [ ] **Step 1: 준비** — `vm_stat`, `pgrep -x deno`(없어야 함), 전용 UDID 시뮬레이터에 0.16.1 기록을 지운 앱 설치·테스트 사용자 23 로그인.
- [ ] **Step 2: 스펙 §15 AGG-sim ①~⑩을 K25 순서로 실행한다** — ① → ② → ③ → ④ → ⑩ → ⑤ → ⑥ → ⑦ → **⑨ → ⑧**(⑧이 먼저면 ⑨의 추가가 한도에 막힌다). 문구·숫자는 스펙. 각 단계 판정 근거 = 화면 식별자·DiagLog 코드·DB 상태(항목 `status`·`gate_label`·`gate_feedback.verdict`·청크 수)와 `gate-report --user <23>`의 `labeled`·`rule_saved`. ①의 시드 시각은 이번 주 월요일~오늘 안에서 정하고 ④ 최다 시각 기대값을 그 분포로 미리 적어 둔다. ⑨는 `/chat/rule`을 스크립트로 직접 불러 응답을 버린다.
- [ ] **Step 3: 통과 뒤 버전** — `ios/project.yml` `MARKETING_VERSION: 0.17.0`, `bash ios/scripts/version-guard.sh` → `version-guard ok (0.17.0)`.
- [ ] **Step 4: 정리** — `seed-agg.ts --phase cleanup`(실행 태그 항목과 그 항목의 jobs(`payload->>item_id`, K24)·테스트 사용자 23 규칙만), 남은 행 0 확인.
- [ ] **Step 5: 기록·커밋**

```bash
git add supabase/scripts/seed-agg.ts ios/project.yml docs/superpowers/phase1/gates.md
git commit -m "chore(ios): 0.17.0 after AGG-sim ①–⑩ on the simulator (test user 23)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task G2: TestFlight 0.17.0 → `AGG-real`(실기기)

**Files:**
- Modify: `docs/superpowers/phase1/gates.md`

**Interfaces:**
- Consumes: G1 커밋.

- [ ] **Step 1: 기한 확인** — `date '+%F'`가 2026-11-30 전이어야 한다(운영 조치 격리 연장분). 지났으면 멈추고 메인에게(N ≥ 1 조건을 다시 정해야 한다).
- [ ] **Step 2: 업로드** — `cd ios && ./scripts/testflight.sh`(빌드 번호 `date +%Y%m%d%H%M`), VALID 확인.
- [ ] **Step 3: 사용자 세션(약 10분)** — 스펙 §15 AGG-real 그대로: "앞으로 PINPAY 문자는 저장해" → [저장 규칙 추가] → "최근 폐기된 메시지 N건…"(N ≥ 1) → [함께 저장] → 보관함 "저장됨(일정 없음)" → "이번 주 PINPAY 타임아웃 언제 많았어?" → 막대 → 최다 막대 탭 → 사용자가 줄이 모두 PINPAY 타임아웃인지 확인(틀린 줄 0) → "10월 PINPAY 타임아웃 언제 많았어?"로 같은 확인 → 규칙 뒤 새 PINPAY 문자가 `gate_label = 'rule'`. 에이전트는 메타데이터만: 실사용자 `save_rules` 수, 복구 항목 `status`·`gate_feedback.verdict` 건수, 카드 숫자와 같은 조건의 `aggregate_items` 결과(건수만)가 같은지.
- [ ] **Step 4: 기록·커밋** — `gates.md` 행 `AGG-real`(통과·실패, 건수·불리언만 — 키워드·제목 없음). 커밋 `docs(gates): AGG-real on device (0.17.0)`.

---

## 자체 점검 (2026-10-21)

**1. 스펙 대응** — §7 "저장 규칙": 규칙·정규화(A1·A3) · 일치 판정 한 함수(A3, 워커 A4·chat A8) · 워커 순서(A4 — 규칙 폐기 먼저·마스킹 진행·`rule`·`skip_gate` 라벨 유지·`kept`·embed) · 출처(A4 SHARE) · `kept` 보관(A1 purge·embed, P1 라벨) · 함께 저장(A2·A8·A9·P4 — `duplicate`도) · 로그(A4·A9) · Jev 정확도(A5·P1·P4). §8 0035 함수 6 + embed 3 + `rule_saved` 체크(A1·A2), RLS 본인 select만(A1). §9 의도 넷·앱 → 서버 바이트 동일(A7)·칸 둘(A7)·경계 예시 20(A10)·재검증 ①~⑥(A6)·RPC(A2)·응답·문장·꼬리 줄(A6·A9)·목록(A9·P3)·집계 카드(P3)·저장 규칙 응답·버튼·카드(A8·A9·P4)·오류 문구(Global)·대화 기록·`aggregate_context`(P2·P3·A9)·로그·비용(A9). §12 감사(A1·A2·A8). §15 AGG-unit ①~⑤(A3~A9·P1·P2)·AGG-db(A1·A2·D1)·AGG-eval·INTENT 회귀(A10)·AGG-sim(G1)·AGG-real(G2). 메인 판정 `rule_saved` 사용자 쓰기 금지(A1 정책 + S0 스펙 한 줄).

**2. 자리표시자** — "TBD·적절히" 없음. `gates.md`의 시각·해시·숫자는 실행 결과 칸. G1 ①의 시드 시각은 실행자가 정하되 ④ 기대값을 먼저 적게 했다(스펙이 "정해 둔 시각들"로만 정함).

**3. 이름·타입 일관성** — `SaveRule`·`RuleKind`(A3)를 A4·A6·A8이, `AggConditions`·`AggRaw`·`BucketCount`(A6)를 A7·A8·A9·A10이, `AggMode`(A7)를 A9·A10이, `SaveRuleJudgment`·`Candidate`·`ruleButton`(A8)을 A9가, `ChatAggregate.Conditions`(P1)를 P2·P3이, `SaveRuleTurn`(P2)을 P4가 같은 이름으로 쓴다. SQL 이름은 스펙 §8과 같다.

**4. Review Focus** — 다섯 줄 모두 소유 태스크에 테스트가 있다: ① P1 `testKeptIsNoSchedule` ② A3 메신저 목록 대조 + A1·A3 공유 `SENDER_TABLE` ③ A1 `save_rule_add normalizes and dedupes` + A8 `judgeSaveRule … duplicate ignores case and inner spaces` ④ P1 `testLineUsesSeoulForUTCDevice` ⑤ P1 `testDayBarsOver31ScrollWithMondayTicks` + A6 `fillBuckets … (90)`.

**Codex 계획 리뷰 반영 (2026-10-21, `.context/codex-review-plan0170.out.md` 1~5 — 메인 판정 5건 모두 반영)** — #1 HIGH K11 6칸 검증·플래그 비교 제외 + 왕복 테스트(A6·A9) · #2 K23 `SaveRuleTurn` 영속 칸 + 재실행 뒤 [함께 저장] 테스트(P2·P4) · #3 K24 SQL 시드 키 `test:` 접두·0011 lease 식 복사·`/ingest` 형식 미지원 명시(A1·A2·D1·G1) · #4 K25 AGG-sim ⑨ → ⑧(G1) · #5 K26 목록 순서 무관 비교 + 정렬 사례 분리(A1). 메인 판정 ①~④는 K27.

**5. 분량** — 함수 본문은 알고리즘이 시그니처로 정해지지 않는 곳(집계 SQL 조각·정규화)만 적었다. 문구는 스펙이 고정한 것만 옮겼다.

**실행 방식:** SQL 반환 모양 → chat 해석 → 앱 해석 → 화면으로 인터페이스가 이어지고, 잘못 나가면 규칙이 개인 대화를 3년 남기거나 집계가 넓게 셀 수 있어 **Subagent-driven**(태스크마다 구현 pane + 리뷰, 끝에 전체 리뷰)을 권한다(AGENTS.md §2, memory "계획 리뷰: Codex → Fable → SDD").
