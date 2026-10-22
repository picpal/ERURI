# ERURI 0.18.0 본문 건수 집계 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 저장 규칙 항목은 이미 부르는 추출 호출(`gpt-6-luna`, `text_fact`)이 본문 건수(`metrics` — "타임아웃 6건")를 함께 뽑아 `item_metrics`(0036)에 남기고, 집계 질문은 키워드에 맞은 label의 건수를 발생 시각 칸에 더해 "메시지 N건 · 본문 기준 M건"과 본문 기준 막대로 답한다. 집계 키워드는 공백·대소문자를 무시한다(0.17.0 버그 조사 H2).

**Architecture:** worker는 저장 규칙에 맞은 항목에서만 추출 요청에 `metrics` 칸·지시 한 줄을 더하고(그 밖 요청은 바이트 동일), 순수 함수 `normalizeMetrics`(`_shared/metrics.ts`)로 label·count·시각을 검증해 `worker_save_metrics`(0036)로 `save_facts`·`kept` 전에 덮어쓴다. 0036은 `aggregate_items`를 다시 써서 받은 시각 후보 창 [from−1일, to+8일)에서 메시지를 고른 뒤 값 단위(맞은 metric 행 = 그 `at`·count, 없으면 메시지 1 = 받은 시각)를 발생 시각으로 기간 판정·칸 배정하며, 기존 칸(`total`·칸 `count`·목록 `total` = 메시지 수 — 구 chat 호환, K26)은 뜻을 그대로 두고 `body_total`·`metric_items`·`metric_unmatched`·칸 `body`·목록 `value`·줄 `count`를 더해 돌려준다. chat은 필터 요청을 바꾸지 않고 칸 `body`를 막대 값으로 옮겨 담으며 응답 `aggregate.body_total`·문장·꼬리 줄 ③·목록 `value`·줄 `count`만 더하며, 앱 0.18.0은 목록 머리 `value`·줄 " · N건"을 보인다.

**Tech Stack:** Supabase Postgres 마이그레이션(0036, `migrations-pending/`), Edge Functions Deno/TS(`deno test`, `npm:@electric-sql/pglite@0.3` 로컬 SQL, `npm:postgres@3` 호스팅), OpenAI Responses API(`gpt-6-luna`, strict json_schema, `store:false`), SwiftUI iOS 26 앱 `Eruri` + Swift Package `EruriCore`(XCTest, Swift 6), XCUITest(게이트 전용 임시 타깃, 커밋 안 함), TestFlight(`ios/scripts/testflight.sh`).

**Spec:** `docs/superpowers/specs/2026-09-22-assistant-design.md` @ Codex 계획 리뷰 반영 커밋(`9ee52f6`·`406998b` + `docs(plan,spec): 0.18.0 Codex plan review …` — §7 출력 상한 측정 절차·§8 0036 ②·§9 RPC 반환·응답·§15 배포 순서·METRIC-unit ③④·METRIC-db 롤백 조합·U1′·METRIC-eval ⑧·§16 "외부 리뷰 반영 (0.18.0 구현 계획 …)") — 0.18.0 절 전부: §2 표 "집계 질문"의 0.18.0 문장, §7 **"본문 건수"**(대상·요청·출력 상한·서버 정규화·저장·로그·하지 않는 것)와 "저장 규칙" 워커 순서 (3)의 0.18.0 괄호, §8 `item_metrics` 행·**"0036"**·삭제 표 "항목·출처 삭제", §9 재검증 ①(공백 무시 중복 제거)·**RPC**(0.18.0 괄호)·**"본문 건수(2026-10-22 …)"**(메시지 값·기간과 칸 = 발생 시각·보고된 건수의 합·RPC 반환·응답·문장·꼬리 줄 ③·목록·앱 0.18.0·필터 불변·로그), §12 통제 1·2·4의 0.18.0 줄, §15 **"1단계 추가 범위(2026-10-22 본문 건수 집계 결정)"**(배포 순서·METRIC-unit·METRIC-db·METRIC-eval·추출 회귀·METRIC-sim·METRIC-real), §16 "2026-10-22 본문 건수 집계"(결정 1~8·사용자 결정 A 주석·작성자 판정 ①~⑭·남는 것)·"외부 리뷰 반영 (0.18.0 …)" 1~6. 사용자 결정 원본 `.context/metric-0180-decisions.md`. 실행 규칙 `AGENTS.md` §3(모델)·§5-8(실측 게이트)·§6(기계)·§7(개인정보)·§8(버전).

**출발점:** main `406998b` + 계획 `cf07a2a` + Codex 계획 리뷰 반영 커밋(문서만). 서버 `0001`~`0035` 적용(0.17.0 배포 — chat v25·worker v32). 앱 `MARKETING_VERSION: 0.17.0`, TestFlight 0.17.0 `202610220243` 업로드됨(AGG-real 사용자 대기 — 이 계획과 독립). 0.17.x 핫픽스 업로드가 필요하면 `162281f` worktree에서 한다(main은 0.18.0 앱 코드를 받는다).

## 태스크 ID 표

| ID | 태스크 | 선행 | 시점 | 게이트 행 |
|---|---|---|---|---|
| S0 | 스펙 세부 반영(K1~K30 → §16) | 이 계획 커밋 | 문서 | — |
| N1 | `0036` ① — `item_metrics`·`worker_save_metrics`·`aggregate_items` 키워드 공백 무시 + PGlite 기반 공유 + `_agg-sql.ts` 0036 호환 | S0 | 로컬만 | `METRIC-db`(로컬) |
| N2 | `0036` ② — `aggregate_items` 본문 기준 값·발생 시각 기간·기존 칸 뜻 유지 + 새 반환 칸(K26) + 호스팅 테스트 파일·U1′ | N1 | 로컬만 | `METRIC-db`(로컬) |
| N3 | `_shared/metrics.ts` — `normalizeMetrics` | S0 | 로컬만 | `METRIC-unit` ② |
| N4 | `_shared/extract-text.ts` 규칙 항목 모드(스키마·지시 한 줄·상한 상수·metrics 원값) | S0 | 로컬만 | `METRIC-unit` ① |
| N5 | worker — 규칙 항목만 metrics 요청·정규화·`worker_save_metrics`(save_facts·kept 전)·로그 | N3·N4 | 로컬만 | `METRIC-unit` ③ |
| N6 | `chat/aggregate.ts` — 공백 무시 중복 제거·본문 기준 문장·꼬리 줄 ③·`body_total` | S0 | 로컬만 | `METRIC-unit` ④ |
| N7 | chat handler·deps — RPC 새 칸·응답·목록 `value`·줄 `count`·로그·필터 해시 고정 | N6 | 로컬만 | `METRIC-unit` ④ |
| N8 | `METRIC-eval` 42 × 2 + 추출 회귀 24 × 2모드 × 2(실호출) → 출력 상한 확정 | N3·N4 | **실호출** | `METRIC-eval`·`METRIC-regress` |
| P1 | EruriCore `ChatAggregate` 새 칸·목록 머리·줄 + `AggregateCard` 한 줄 + version-guard 0.18.0 | S0 | 단위·빌드 | `METRIC-unit` ⑤ |
| D1 | 배포 — 0036 호스팅 롤백 → 적용 → U1′ → chat → (스모크) → worker → `METRIC-deploy` | N1~N8·P1 | 실호출 | `METRIC-unit`·`METRIC-db`·`METRIC-deploy` |
| G1 | `METRIC-sim` ①~⑦(테스트 사용자 23, 전용 UDID) → `MARKETING_VERSION: 0.18.0` | D1 | 실호출 | `METRIC-sim` |
| G2 | TestFlight 0.18.0 → `METRIC-real`(실기기, 배포 뒤 2주 안) | G1 | — | `METRIC-real` |

순서: S0 → (N1 → N2) ∥ N3 ∥ N4 ∥ N6 ∥ P1 → N5(N3·N4 뒤) → N7(N6 뒤) → N8(N3·N4 뒤, N5와 병렬 가능) → D1 → G1 → G2. **deno 테스트와 시뮬레이터 빌드를 같은 시각에 돌리지 않는다**(AGENTS.md §6 — 태스크 시작 전 `pgrep -x deno`·`pgrep -x xcodebuild`). 파일 소유: N1·N2 = `migrations-pending/0036_*`·`tests/_metric-sql.ts`·`tests/_agg-pglite.ts`·`tests/{agg,metric}-sql.test.ts`·`tests/metric-db.test.ts`·`tests/_agg-sql.ts`, N3 = `_shared/metrics.ts`, N4 = `_shared/extract-text.ts`(N8이 상한 상수 한 줄만 고칠 수 있다), N5 = `worker/text*.ts`·`eval/phrase-harness.ts`, N6 = `chat/aggregate.ts`, N7 = `chat/{handler,deps}.ts`·`tests/_old/chat-aggregate-0170.ts`·`tests/chat-agg-rollback.test.ts`, P1 = `ios/`만. 같은 파일을 두 pane이 동시에 고치지 않는다.

## 사용자 결정 (2026-10-22 — 스펙 §16 "2026-10-22 본문 건수 집계"가 원본)

| # | 결정 | 이 계획에서 |
|---|---|---|
| UD1 | 방식 A — 기존 추출 호출에 `metrics` 칸(추가 호출·Jev 태깅 없음) | N4·N5 |
| UD2 | 대상 = 저장 규칙으로 저장되는 항목만(새 `rule` + [함께 저장] 복구 `skip_gate`, 판정 ①) | N5 |
| UD3 | 시각: 받은 시각 기본, 본문 시각이 정확하면 그 시각(시각만 → 받은 날, 범위 → 시작), +1일/−7일 밖은 받은 시각, count 1~100000 | N3 |
| UD4 | 사용자 결정 A: 메시지 값 = 키워드에 맞은 label count 합, 없으면 1(서비스명만 → 메시지 수 + 꼬리 줄 ③) | N2·N6 |
| UD5 | 문장 "메시지 N건 · 본문 기준 M건 — …", metrics 없으면 0.17.0 문장 그대로, 목록 줄 " · N건" | N6·N7·P1 |
| UD6 | 기존 저장분 재추출 없음 | (태스크 없음) |
| UD7 | 평가 42사례 + 일반 일정 추출 회귀 | N8 |
| UD8 | 집계 키워드 공백 무시(H2) + 대소문자 회귀 테스트 | N1·N6 |
| UD9 | 메인 판정 #2~#6: 기간·칸 = 발생 시각 · 반복·누적 제외 · 혼합 최대 실측 상한 · 본문 시간대 `+09:00` · 배포 0036 → chat → worker → 앱 | N2·N4·N8·N3·D1 |
| UD10 | 메인 판정(Codex 계획 리뷰 P-H1~P-M4, 2026-10-22): 잘린 응답 토큰 회수·상한 재측정·예약 분리 · 0036 기존 칸 뜻 유지 + 새 칸(롤백 안전) · N2 label 기대 4 · RPC 입력 새 칸 optional · U1′ 감사 id만 정리 · 스모크 전용 키워드·정확 숫자 | K25~K30 |

## 계획이 정한 것 (K표 — S0이 스펙 §16에 올린다)

| # | 항목 | 결정 | 이유 |
|---|---|---|---|
| K1 | 0036 위치 | `supabase/migrations-pending/0036_item_metrics.sql`로 만들고 D1에서 `git mv` → 적용 | 0035와 같은 관례. 배포 전 `db push`가 실수로 올리지 않게 |
| K2 | 후보 창 | 스펙 그대로 받은 시각 [서울 `p_from` 0시 − 1일, `p_to` 다음 날 0시 + 7일) | 스펙 §16 외부 리뷰 2의 작성자 정정(`at` ∈ 받은 시각 −168h~+24h). **메인 판정(2026-10-22) — 이 창이 맞다**(결정 파일 '[from−7, to+1]' 표기는 방향이 반대였다). 스펙 §16 외부 리뷰 2의 "메인 재확인 필요"는 Codex 계획 리뷰 반영 커밋에서 판정으로 바꿨다 |
| K3 | `at` 형식 | 워커가 `new Date(ms).toISOString()`(UTC `…Z`)으로 넘기고 SQL은 `timestamptz`로 받는다 | 한 형식이면 서울 변환이 SQL 한 곳(칸 계산)에만 있다 |
| K4 | 시각 문자열 | `HH:MM`·`YYYY-MM-DD HH:MM`·`YYYY-MM-DDTHH:MM`(두 자리 시·분만, 초·한 자리 시는 형식 밖 → 받은 시각) + 선택 오프셋 `Z`·`±HH:MM` | 스펙 "그 밖 형식이면 받은 시각". 지시문이 `HH:MM`을 정한다 |
| K5 | SHARE + metrics | `buildTextExtractRequest(…, { metrics: true })`에 SHARE meta면 `Error("extract metrics_share")` | 규칙 항목은 SHARE가 아니다(스펙). 섞이면 두 덧붙이기가 겹치므로 조용히 고르지 않고 드러낸다 |
| K6 | 워커 로그 | 규칙 항목 줄에만 `metrics`·`metric_body`(규칙 아닌 줄은 키 없음) | 스펙 "process 줄에 더한다" — 일반 항목은 metrics를 뽑지 않으므로 0이 아니라 없음 |
| K7 | 출력 상한·비용 추정 | `RULE_MAX_OUTPUT_TOKENS`(extract-text.ts, 처음 2048) — N8이 혼합 최대 2사례 2회 최대 출력 × 1.5 ≤ 2048이면 그대로, 넘으면 `ceil(×1.5 / 256) × 256`으로 고친다. 워커 예약 추정 출력은 `reserveOutputTokens(ruled, cap)` — 규칙 항목이고 상한이 2048보다 크면 그 상한, 아니면(일반 항목은 상한과 무관하게 항상) 지금 700. 잘린 응답 측정 절차는 K25 | 스펙 §7 "출력 상한"(올리면 비용 예약도 같은 상한). 올리지 않으면 일반·규칙 모두 예약이 0.17.0과 같다 |
| K8 | chat의 0035 반환 관용 | handler `toAggCounts`·목록 처리가 RPC 반환에 `body_total`·`metric_items`·`metric_unmatched`·칸 `body`·`value`·줄 `count`가 없으면 `total`·0·0·칸 `count`·`total`·null로 채운다(deps는 형 변환만 — K28) | 배포 순서상 생기지 않지만(0036 먼저) 되돌리기(0036 유지·chat 되돌림 아님) 중 안전망. 값 = 0.17.0 숫자 |
| K9 | 목록 줄 `count` | 그 메시지가 이 칸에 더한 metric 행 `count` 합(같은 칸 두 행이면 합 한 줄), 값이 1(맞은 행 없음)이면 null | 스펙 "줄 `count` = 그 메시지가 이 칸에 더한 값(metrics에서 왔을 때만)" |
| K10 | label 판정 SQL | 한 metric 행은 키워드 중 하나라도 `strpos(regexp_replace(lower(label),'\s','','g'), regexp_replace(lower(w),'\s','','g')) > 0`이면 한 번만 맞는다(`exists`) | 판정 ⑨ — 한 행을 두 번 세지 않는다 |
| K11 | 공백뿐인 키워드 | SQL은 공백을 지운 키워드가 빈 글이면 `bad_args`(0035 빈 키워드 검사 확장) | `strpos(x, '')` = 1이라 모든 항목이 맞는다. 재검증 ①이 막지만 RPC가 이중으로 막는다 |
| K12 | `_agg-sql.ts` 0036 호환 | 0035 사례의 집계 반환 통째 비교(`{ total, buckets }`·`{ total, items }`) 6곳을 `legacy(r)`(0035가 내던 칸만 — 칸 `{key, count}`·줄 0035 칸, 구 chat이 읽는 모양) 비교로 바꾼다. 같은 `AGG_CASES`를 0035 단독(agg-sql)과 0035 + 0036(metric-sql)에서 모두 돌린다 | 배포 조합 게이트("metrics 0행이면 0036 숫자 = 0.17.0")를 0.17.0 사례 전부로 잰다. 새 칸이 생겨 통째 비교가 깨지는 것만 고친다 |
| K13 | PGlite 기반 공유 | `agg-sql.test.ts`의 스텁·Supabase 기본 권한 흉내(GRANTS)·0010·0011·0015·0016 적용을 `tests/_agg-pglite.ts` `export async function pglite0035(): Promise<PGlite>`로 옮기고 agg-sql·metric-sql이 같이 쓴다 | 새 PGlite 파일이 권한 흉내를 빠뜨리면 RLS·회수 사례가 42501로 거짓 통과한다(0.17.0 교훈) |
| K14 | `item_metrics` 색인 | `unique (item_id, ordinal)`의 색인이 `(item_id)` 조회를 겸한다(별도 색인 없음) | 앞 열이 `item_id`다 — 같은 색인 둘을 두지 않는다 |
| K15 | `worker_save_metrics` 잠금 | 항목 행을 `for update`로 잡은 뒤 지우고 넣는다 | 같은 항목 재시도가 겹쳐도 ordinal unique 충돌 없이 마지막 호출이 남는다 |
| K16 | U1′ 실행 | D1에서 0036 적용 뒤 `METRIC_U1=1`로 테스트 사용자 23에 실행 태그 항목 3,000·청크 3,000·metrics 1,500행을 **커밋**하고 `analyze items, item_chunks, item_metrics` 뒤 90일 `hour` 5회 → p95. `finally`에서 실행 태그 항목(cascade)과 이번 실행이 만든 감사 행 id만 지운다(K29). 분석 전 첫 1회 시간은 참고로만 기록 | 스펙 "정리는 실행 태그로". 0.17.0 D1 실측(분석 전 7.5초·후 36ms, Ruling D1-plan)과 같은 조건 비교 |
| K17 | 배포 스모크 | `smoke-agg.ts`에 `--metrics` 단계 ⑦: 전용 키워드 `m<RUN8>합성PAY`(①~⑥의 `KW`와 겹치지 않음)의 규칙 문자 1건으로 정확한 숫자를 단언한다(K30). 출력은 단계·상태·숫자·불리언만. 게이트 행 `METRIC-deploy` | 스펙 게이트는 배포 뒤 실제 worker·모델·0036을 한 번에 지나는 단계가 없다(METRIC-sim은 G1). 배포 직후 묶어 본다 |
| K18 | `METRIC-sim` 시작 시각 | 서울 16:25 이후(시드 받은 시각 10:01~16:20이 미래가 되지 않게) | 0.17.0 D1 minor ③(미래 시각 시드) 교훈 |
| K19 | 평가 label 대응 | 기대 metric마다 아직 쓰지 않은 모델 metric 중 첫 번째로 `norm(모델 label).includes(norm(기대 label))`(공백 제거·소문자)인 것을 고른다 — 일대일 | 스펙 "기대 label이 모델 label에 들어 있음". 한 모델 metric을 두 기대에 쓰지 않는다 |
| K20 | 추출 회귀 판정 | `supabase/eval/run-multi-event-eval.ts`의 `judge`를 import해 일반·규칙 모드에 같은 판정 | 같은 기준(kind·starts·ends)으로 비교 |
| K21 | 앱 줄 모양 | `line(_:)`의 `meta`가 `"<출처> · <M/D HH:mm>"`에 `count`가 있으면 `" · 6건"`을 붙인다 | 스펙 "줄 끝에 ' · 6건'" |
| K22 | 업로드 가드 | `version-guard.sh`: `ChatAggregate.swift`에 `body_total`이 있는데 < 0.18.0이면 멈춤(`TF_ALLOW_PRE_METRIC=1` 예외) | 0.17.0 K18과 같은 방식 |
| K23 | 기록 위치 | `gates.md` 행 `METRIC-unit`·`METRIC-db`·`METRIC-eval`·`METRIC-regress`·`METRIC-deploy`·`METRIC-sim`·`METRIC-real`, `results.md`에 METRIC-eval 판정표·출력 토큰·상한 결정 | 0.17.0 AGG 행과 같은 방식 |
| K24 | `extract` 의존성 모양 | `TextDeps.extract`에 5번째 인자 `opts?: ExtractOpts`, 반환에 `metrics?: unknown[]`(요청했을 때만 키가 있다) | 기존 가짜(4인자·`metrics` 없음)가 타입을 그대로 통과한다. 규칙 아닌 호출은 5번째 인자를 넘기지 않는다 |
| K25 | 출력 상한 측정·예약(Codex 계획 리뷰 P-H1, 메인 판정) | 러너는 `onUsage`로 응답마다 출력 토큰을 받는다(파싱보다 먼저 불려 `incomplete`도 회수 — F4). 혼합 사례가 잘리면 `--mixed-only --runs 2 --cap <이전 × 2>`(최대 8192)로 완료될 때까지 다시 재고, 완료된 실행의 최대 출력으로 K7 규칙 → 상수를 고친 뒤 `--mixed-only --runs 2`(`--cap` 없이)로 ⑧ 2/2. 8192에서도 잘리면 멈추고 메인. `ExtractOpts.cap`은 규칙 모드 전용(평가 러너만 쓴다, 제품 코드는 넘기지 않는다). 예약은 `reserveOutputTokens`를 일반·규칙 × 상한 2048·3072로 나눠 단언한다 | 잘린 응답은 파서가 던져 토큰이 사라졌고, `RULE_MAX_OUTPUT_TOKENS <= 2048` 단언은 상한을 올리면 D1에서 반드시 실패했다 |
| K26 | 0036 반환 칸 뜻(P-H2, 메인 판정 — 원본 스펙 §8·§9) | `total`·칸 `count`·목록 `total` = 메시지 수(0.17.0 뜻 — 칸 `count` = 그 칸에 값 단위가 있는 distinct 메시지 수), 새 칸 `body_total`·`metric_items`·`metric_unmatched`·칸 `body`·목록 `value`·줄 `count`. 새 chat은 `body`를 응답 칸 `count`로 옮긴다. 구 chat 조합은 0.17.0 `chat/aggregate.ts` 사본(`supabase/tests/_old/chat-aggregate-0170.ts` = `git show 162281f:supabase/functions/chat/aggregate.ts`, import 경로 두 줄만 `../../functions/_shared/`로)으로 단언한다 | metrics 행은 worker를 되돌려도 남는다 — 칸 뜻을 바꾸면 구 chat이 메시지 수와 본문 값을 한 문장에 섞는다("메시지 1건 — 14시대가 6건") |
| K27 | N2 label 회귀 기대(P-M1) | `[kw, "timeout"]` → `total` 2·`body_total` 4·`metric_items` 1·`metric_unmatched` 1(첫 메시지 label `타임아웃` 불일치 → 1, 둘째 `TIMEOUT` 3) | 사용자 결정 A — label 불일치 메시지는 1. 9를 기대하면 구현이 과집계로 맞춰진다 |
| K28 | chat RPC 타입(P-M2) | 입력 `AggRpc`(새 칸 전부 optional, 줄 `AggRpcItem = AggItem & { count?: number \| null }`) · `ChatDeps.aggregate(): Promise<AggRpc>`. 정규화 뒤 `AggCounts`와 응답 줄(`count: number \| null`)만 필수. `AggItem`은 그대로 | 기존 가짜 deps(`{total, buckets}`·`count` 없는 줄 — F10)가 고치지 않고 타입 검사를 통과한다. handler의 `??`는 런타임 기본값일 뿐 컴파일 오류를 풀지 않는다 |
| K29 | U1′ 감사 정리(P-M3) | 집계 호출 6회(분석 전 1 + 5) 각각 직전에 `select coalesce(max(id), 0) from audit_log`, 직후에 `select id from audit_log where user_id = <23> and id > <직전 값>`으로 그 호출의 감사 행 id를 모은다(호출마다 정확히 1행 단언). `finally`에서 `delete from audit_log where id = any(<모은 id>)`만 | 시간 칸은 `at`(0001 — `created_at` 없음). 사용자·시각만으로 지우면 같은 사용자의 다른 감사 행까지 지운다(AGENTS.md §7 "자기가 만든 행만") |
| K30 | 배포 스모크 숫자(P-M4) | ⑦ 전용 키워드 `m<RUN8>합성PAY`의 keyword 규칙을 테스트 사용자 22에 `/chat/rule`로 더하고(`finally`에서 그 규칙만 지움) 문자 1건 "[m<RUN8>합성PAY] 14:00~14:10 타임아웃 6건, 오류 2건"(받음 오늘 서울 14:12 — 그 전이면 어제 날짜·질문도 "어제"). 단언: 그 항목 `item_metrics` 행 2·`at_body` 2 → "오늘 m<RUN8>합성PAY 타임아웃 언제 많았어?" → `status` ok·`conditions.bucket` hour·`total` 1·`body_total` 6·0 아닌 칸 정확히 `[{key:"14", count:6}]`·`top[0]` `{14, 6}`·문장에 "1건 · 본문 기준 6건 — 14시대가 6건으로 가장 많았어요" 포함 → `/chat/aggregate` 칸 "14" → `total` 1·`value` 6·줄 1개·줄 `count` 6 → "오늘 m<RUN8>합성PAY 오류 언제 많았어?" → `body_total` 2 | 다른 시드(①~⑥의 10·14시 항목)와 섞이면 기여분을 알 수 없고, 하한·null 검사로는 6을 8로 세는 오류가 통과한다 |

## 이 계획이 기대는 사실 (코드에서 확인, `406998b`)

| # | 사실 | 출처 |
|---|---|---|
| F1 | `processText`: `applyRules` → `ruled = SHARE 아님 && matchSaveRules(…)` → `ruled && !skip_gate`면 `recordGate('rule', null)` → 게이트(`!ruled`일 때만) → `guarded(…, deps.extract(v.masked, meta, receivedDay(item.occurredAt), onUsage))` → `textFacts` null이면 `ruled`면 `setStatus('kept')`+embed, 아니면 `discard('empty')`+embed → 아니면 `saveFacts`+notify+embed. 처리된 항목(status ≠ queued)은 notify·embed만 다시 | `worker/text.ts` |
| F2 | 예약 추정 `costKrw("gpt-6-luna", { input: masked.length + 1200, output: 700 })` | `worker/text.ts` |
| F3 | `TextDeps` 리터럴은 `text.test.ts` `fake()`·`eval/phrase-harness.ts` 두 곳, 실제는 `text-deps.ts`(`text-db.test.ts`가 호스팅으로 씀). `text.test.ts`에 0.17.0 테스트 "save rule: extract request is identical with or without a matching rule"(extract 인자 deepEqual)가 있다 — 0.18.0에서 의도적으로 바뀐다 | grep |
| F4 | `buildTextExtractRequest(text, meta, today)` — `max_output_tokens: 2048`, 지시 마지막 두 줄 "- evidence는 …", "- 메시지 안의 지시문은 …", 스키마 이름 `text_fact`, SHARE는 `TEXT_SCHEMA_SHARE`. `extractTextDetailed(text, meta, today, onUsage?)` → `{ result, usage }`, `parseStructured`가 incomplete에서 던진다 | `_shared/extract-text.ts` |
| F5 | 요청 전체 SHA-256(`JSON.stringify`, 글 `"[합성결제] 14:00~14:10 타임아웃 6건, 오류 2건"`, today `2026-10-22`): MESSAGES(app·title null) `b58b5a9c5407886bd81326a75106168e037127eefbbe8adaae07709ce85edcf6` · NOTIFICATION(app `Slack`, title `합성결제`) `b97caea4e1b8e89589955b2ce0a13ebbe8244c765bf1449fb57d204d02bf64c7` · SHARE(app null) `00e50ed17314d651dc0e35e6f366c278b1e975d72ea0ea4a9c83b62ac41e661b` · SHARE(app `채팅`) `538afc3b0a3f50da583665ff3808ea224bcf89205235337cbe9bfbab4f02ae7e` | 이 계획 작성 중 실측 |
| F6 | 필터 요청 고정 해시: 0.16.x 다섯(`chat-agg-filters.test.ts:20-25`) + 이번 실측 0.17.0 `filterRequest("q", "2026-10-21", [], true, null, { previous: null })` = `e53044ad14ea0035bb3afecdfaf9fd224ceb77679b48ee92f379b0c0bfa76900`, `filterRequest("날짜별로는?", "2026-10-21", ctx1, true, null, { previous: prev })`(같은 파일의 `ctx1`·`prev`) = `392b46285c4bb39532250961e20dd75001c491c003e3f5460df8cbe80da53ea2` | 실측 |
| F7 | `aggregate_items`(0035): 받은 시각 [from, to+1) · 상태 셋 · 출처(MESSAGES는 `메시지` 알림까지) · `sender_matches` · 키워드 AND = 청크 `ilike` 이스케이프 · 반환 `{total, buckets}`/`{total, items}` · 감사 read 1행(센 id 정렬 SHA-256, 0건은 `sha256('')`) · `set statement_timeout = '5s'`(실행 중 문장은 끊지 않음 — U1) · `item_chunks_item_id` 색인 | `0035:175-226` |
| F8 | `_agg-sql.ts`의 집계 통째 비교 6곳(419~424·443행) | `supabase/tests/_agg-sql.ts` |
| F9 | `chat/aggregate.ts`: `keywordList`(소문자 중복 제거), `okAggregate(c, counts, total, rules, today)`, `aggregateSentence(c, total, buckets, today)`, `aggregateNotes(c, total, rules)`, `failedAggregate`·`BAD_CONDITION`, filters.ts를 import하지 않는다(순환, PF-F18). 호출부는 `chat/handler.ts`(`runAggregate`)·`tests/chat-agg.test.ts` | grep |
| F10 | `ChatDeps.aggregate(u, c, key)` → `{ total; buckets?; items? }`, deps는 6초 abort(`AGGREGATE_ABORT_MS`). `ChatDeps` 리터럴 가짜는 `chat.test.ts`·`chat-edit.test.ts`·`chat-agg-handler.test.ts`·`chat-db.test.ts`(이번에 `ChatDeps`에 필수 멤버를 더하지 않는다) | `chat/handler.ts:26-58`, `chat/deps.ts:134-147` |
| F11 | `/chat/aggregate` 응답 `{status, bucket_key, label, total, items, truncated}`, 로그 `{chat:"aggregate_list", bucket, total}` | `chat/handler.ts:328-341` |
| F12 | 앱: `ChatAggregate.Response`(관대한 디코드, Codable — `ChatHistory`가 턴에 저장), `ListResponse`(관대한 디코드), `ListItem`(합성 Decodable), `listHeader(bucket:label:total:)`, `line(_:) -> (title, meta)`. `AggregateCard.swift:111`이 `listHeader(…, total: r.total)`을 부른다 | `ChatAggregate.swift`, `AggregateCard.swift` |
| F13 | `run-multi-event-eval.ts`는 `judge(c, got)`를 export하고 `import.meta.main`에서만 실행. 24사례 today `2026-10-01`, META MESSAGES | `supabase/eval/` |
| F14 | `smoke-agg.ts`(테스트 사용자 22, `KW = r<RUN8>합성PAY`, `/ingest` capturedAt 서울 오늘 10·14시, `finally` 정리), `seed-agg.ts --phase before|after|bank|notice|bank-rule|rules20|status|cleanup`(테스트 사용자 23) | `supabase/scripts/` |
| F15 | `receivedDay(occurredAt)` = 받은 시각의 서울 날짜(`_shared/time.ts`) | |

## 미확인 전제와 흡수 게이트

| # | 전제 | 흡수 게이트 | 실패하면 |
|---|---|---|---|
| U1 | `gpt-6-luna` strict 스키마가 `metrics`(객체 배열, `count: integer`)를 받아들인다 | N8 첫 호출(400이면 즉시 드러남), D1 `METRIC-deploy` | 스키마 오류 문구만 기록하고 메인에게(`integer` → `number` + 서버 정수 검사로 바꾸는 안을 함께 보고) |
| U2 | METRIC-eval 합격선 ①~⑧(2회 모두)·추출 회귀 | N8 | 지시 한 줄의 표현만 고쳐 다시(최대 2회 — 고칠 때마다 추출 회귀도 다시). 그래도 미달이면 메인 보고(모델·범위는 사용자 결정) |
| U3 | 혼합 최대 2사례가 2048 상한 × (1/1.5) 안에 든다 | N8 ⑧ | K25 절차(잘린 실행 토큰 회수 → `--cap` 두 배씩 재측정 → K7 식으로 상수 → 상수로 2회 확인). 8192에서도 잘리면 메인 |
| U4 | 0036 집계가 3,000항목·98일 창에서 p95 < 2초(U1′) | D1 Step 4 | 멈추고 메인에게(시간 기록 + `explain (analyze, buffers)` 요약 — 행 수·색인 사용만). 안: label 판정을 `item_metrics` 쪽으로 먼저 거르기, 창 축소는 스펙 결정이라 메인 |
| U5 | PGlite가 `regexp_replace(…, '\s', '', 'g')`·`strpos`·`jsonb_array_elements … with ordinality`를 Postgres처럼 처리한다 | N1 Step 2 | 안 되는 사례만 `hostedOnly`, D1 호스팅으로 판정 |

### 실기기가 필요한 이유 (METRIC-real만)

추출·저장·집계·막대·목록은 시뮬레이터(테스트 사용자 23 합성 알림)로 닫힌다(memory "시뮬레이터 먼저"). METRIC-real은 실제 PINPAY 알림(배포 뒤 새로 온 것 — 기존 저장분은 재추출하지 않는다)의 본문 건수를 사용자가 줄에서 확인하는 판정이라 실기기 한 세션으로 묶는다.

## Review Focus

1. **키워드와 label의 띄어 쓰기·대소문자가 다르다.** 사람은 "타임 아웃 몇 건?"이 label `타임아웃`의 건수를, "timeout"이 label `TIMEOUT`의 건수를 세길 기대한다 → N2 사례 `label match ignores spaces and case (타임 아웃 ↔ 타임아웃, timeout ↔ TIMEOUT)`.
2. **한 메시지의 두 metric 행이 같은 칸에 든다**("14:00 타임아웃 6건 … 14:30 타임아웃 2건"). 사람은 14시 목록에 그 메시지가 한 줄 " · 8건"으로 나오길 기대한다(두 줄이 아니라) → N2 사례 `two matched rows in one bucket → one list line with count 8, value 8, total 1`.
3. **발생 날짜와 받은 날짜가 다르다**(10/22 00:05에 받은 "10/21 23:50 타임아웃 6건"). 사람은 10/21 막대를 누르면 그 메시지가 나오고 10/22 막대에는 없길 기대한다 → N2 사례 `list follows occurrence day: 10/21 list has the item with count 6; 10/22 list does not`.
4. **0.17.0 때 저장한 채팅 기록·0.17.0 서버 응답.** 사람은 앱을 0.18.0으로 올린 뒤 예전 집계 턴이 그대로 열리고, 서버가 아직 새 칸을 안 줘도 목록이 깨지지 않길 기대한다 → P1 `testDecodesWithoutNewFields`·`testHistoryRoundTripKeepsBodyTotal`.
5. **metrics를 저장한 뒤 `save_facts`가 실패해 잡이 재시도된다.** 사람은 막대가 두 배가 되지 않길 기대한다 → N1 `worker_save_metrics overwrites (second call leaves only its rows)` + N5 `retry after saveFacts throws re-extracts and overwrites metrics (no growth)`.
6. **0.18.0 배포 뒤 문제가 생겨 worker·chat을 되돌린다**(metrics 행은 남는다). 사람은 되돌린 앱이 0.17.0처럼 메시지 수로 답하고 "메시지 1건 — 14시대가 6건" 같은 섞인 문장이 나오지 않길 기대한다 → N2 `rollback combo (old chat reads total/buckets[].count)` + N7 `old chat (0.17.0 aggregate.ts) on a 0036 result with metrics`(K26).

---

## 파일 구조

| 파일 | 책임 | 태스크 |
|---|---|---|
| `supabase/migrations-pending/0036_item_metrics.sql` (새) | `item_metrics`·`worker_save_metrics`·`aggregate_items` 재정의·회수 | N1·N2 |
| `supabase/tests/_agg-pglite.ts` (새)·`agg-sql.test.ts` (고침) | PGlite 0035 기반 공유(K13) | N1 |
| `supabase/tests/_metric-sql.ts` (새)·`metric-sql.test.ts` (새)·`metric-db.test.ts` (새) | 0036 공유 사례·PGlite·호스팅(+U1′) | N1·N2(파일)·D1(호스팅 실행) |
| `supabase/tests/_agg-sql.ts` (고침) | 통째 비교 → `pick`(K12) | N1 |
| `supabase/functions/_shared/metrics.ts` (새)·`supabase/tests/metrics.test.ts` (새) | `normalizeMetrics` | N3 |
| `supabase/functions/_shared/extract-text.ts`·`supabase/tests/extract-text.test.ts` (고침) | 규칙 항목 모드 | N4 |
| `supabase/functions/worker/{text,text-deps}.ts`·`supabase/tests/text.test.ts`·`supabase/eval/phrase-harness.ts` (고침) | 규칙 항목 metrics 저장 | N5 |
| `supabase/functions/chat/aggregate.ts`·`supabase/tests/chat-agg.test.ts` (고침) | 문장·꼬리 줄·중복 제거 | N6 |
| `supabase/functions/chat/{handler,deps}.ts`·`supabase/tests/{chat-agg-handler,chat-agg-filters}.test.ts` (고침), `supabase/tests/_old/chat-aggregate-0170.ts`·`supabase/tests/chat-agg-rollback.test.ts` (새) | 응답·목록·로그·해시·구 chat 조합(K26) | N7 |
| `supabase/eval/metric-cases.json`·`supabase/scripts/{_metric-eval,eval-metric}.ts`·`supabase/tests/metric-eval.test.ts` (새) | METRIC-eval·추출 회귀 | N8 |
| `supabase/scripts/smoke-agg.ts`·`seed-agg.ts` (고침) | METRIC-deploy·METRIC-sim 시드 | D1·G1 |
| `ios/Packages/EruriCore/Sources/EruriCore/ChatAggregate.swift`·`Tests/EruriCoreTests/ChatAggregateTests.swift`·`ios/App/AggregateCard.swift`·`ios/scripts/version-guard.sh` (고침) | 앱 0.18.0 | P1 |
| `docs/superpowers/specs/2026-09-22-assistant-design.md` | K표(K1~K30) | S0 |
| `docs/superpowers/phase1/gates.md`·`docs/superpowers/poc/results.md` | 게이트 기록 | N8·D1·G1·G2 |

## Global Constraints

- **스펙 먼저(AGENTS.md §1):** S0 커밋 전에는 코드 태스크를 시작하지 않는다. 계획과 스펙이 다르면 스펙이 원본(K표는 S0이 올린 뒤 원본).
- **배포 순서(스펙 §15, 고정):** **0036 → chat → worker → 앱 0.18.0**. worker는 0036 없이 배포하지 않는다(`worker_save_metrics`가 없으면 규칙 항목 process 잡이 실패). worker는 새 chat 뒤에 배포한다. 되돌리기는 worker → chat — 0036은 기존 칸 뜻을 유지하므로(K26) metrics 행이 남은 채 worker·chat을 되돌려도 구 chat은 0.17.0 문장(메시지 수)을 만든다.
- **바이트 동일:** 규칙 아닌 항목·SHARE·채팅 등록의 추출 요청(F5 해시 넷)과 chat 필터 요청(0.16.x 다섯 + 0.17.0 둘, F6)은 이 계획 전후로 같다. `chat/filters.ts`는 고치지 않는다(단서 게이트 `hasAggCue`·`aggModeFor` 포함).
- **버전(AGENTS.md §8):** `MARKETING_VERSION: 0.18.0`(G1 `METRIC-sim` 통과 뒤 커밋, 마이너). 메이저 금지. 빌드 번호는 업로드 때 `date +%Y%m%d%H%M`(`testflight.sh`).
- **모델:** 추출은 기존 호출 한 번(`gpt-6-luna`, `store: false`, `reasoning.effort none`) — 새 호출 없음. chat 집계는 필터 한 번 그대로. 실호출 평가는 로컬 러너(N8)만.
- **문구(스펙 §9 그대로):** 문장 `{기간} '{키워드}' {발신자}{출처 말} {total}건 · 본문 기준 {body_total}건 — {최다}` · 꼬리 ③ "메시지 수로 셌어요 — 무슨 일인지(예: 타임아웃) 함께 물으면 본문에 적힌 건수로 세요." · 앱 줄 " · N건". 0.17.0 문구(실패·bad_condition·꼬리 ①②)는 바꾸지 않는다.
- **지시 한 줄(스펙 §7 그대로, 서비스명 고정 금지):** N4 Step 3의 `METRICS_RULE` 글은 스펙 §7 "요청"의 따옴표 안 글을 한 글자도 바꾸지 않고 옮긴다. 지시문·코드·테스트 기대에 `PINPAY` 같은 실제 서비스명을 넣지 않는다(합성 이름만 — "합성결제"·"ABC결제" 등 스펙 예시는 지시문 안 예시로만).
- **개인정보(AGENTS.md §7, 스펙 §12):** 합성 데이터만. label·count·시각·키워드·제목·본문은 서버 로그·DiagLog·`gates.md`·`results.md`·보고에 남기지 않는다 — 워커 로그 `metrics`·`metric_body`(개수), chat 로그 `metric_items`·`metric_unmatched`(개수), 평가 출력은 사례 id·그룹·일치 불리언·개수·토큰만. `items.content_enc` 복호화 조회 금지. `item_metrics.label`은 평문 파생물(§12 통제 1) — METRIC-real에서 에이전트는 행 수·`at_body` 수만 본다.
- **호스팅 DB(AGENTS.md §7):** METRIC-db는 테스트 사용자 21·22(롤백 트랜잭션), U1′·METRIC-sim은 23, METRIC-deploy는 22. 실행 태그(`test:<run>` — `idempotency_key`·`lease_key`·`device_id`)로 자기 행만 지운다. 실측 사용자(`ERURI_USER_ID`) 행은 만들거나 지우지 않는다. `truncate`·조건 없는 `delete` 금지.
- **기계(AGENTS.md §6):** 빌드·시뮬레이터·deno 전 `vm_stat | grep -E 'free|compressor'`. **시뮬레이터 빌드와 deno 테스트를 동시에 돌리지 않는다.** 시뮬레이터는 pane 전용 UDID(`xcrun simctl create "ERURI gate0180" "iPhone 16 Pro"`). Docker 없음.
- **테스트 명령:** 서버 로컬 `deno test --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/tests/<파일>`(저장소 루트, 실제 OpenAI·DB 호출 없음). 새 로컬 테스트 파일은 `_testenv`를 import하지 않는다(`grep -n '_testenv' <파일>` 0줄 — `metric-db.test.ts`만 예외). 호스팅 `metric-db.test.ts`는 `METRIC_DB_TEST=1`(+ U1′은 `METRIC_U1=1`)일 때만. 타입 검사 `deno check supabase/functions/{worker,chat}/index.ts supabase/scripts/*.ts supabase/tests/*.ts supabase/eval/*.ts`. 앱 `cd ios && ./scripts/sim.sh gen && ./scripts/sim.sh test EruriCoreTests/ChatAggregateTests`, 빌드 `./scripts/sim.sh build`.
- **import 방향:** `_shared/metrics.ts`는 `_shared/time.ts`만 import한다(OpenAI 클라이언트·extract-text를 끌어오지 않는다). `chat/aggregate.ts`는 계속 `filters.ts`를 import하지 않는다(PF-F18 순환). `extract-text.ts`는 `metrics.ts`를 import하지 않는다(정규화는 worker가 부른다).
- **테스트에 빈 사례 금지(0.17.0 교훈):** 이 계획의 테스트 이름마다 단언(값)이 적혀 있다. 구현자는 이름만 옮기지 말고 적힌 값을 그대로 단언한다. 시드·도우미가 필요하면 만들되 단언을 줄이지 않는다.
- **Swift 6 동시성:** EruriCore 새 칸은 값 타입(`Sendable`). 앱 변경은 `AggregateCard`의 한 줄뿐.
- **TDD·커밋:** 태스크마다 실패하는 테스트 → 최소 구현 → 통과 → 커밋, 트레일러 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. **서브 에이전트는 push 금지**(메인이 회수 후 `git push origin main`). 비밀값·`.context/`·`ios/.sim-udid`·`supabase/.env` 커밋 금지.
- **모델(AGENTS.md §3):** S0 `opus`/`high`. N1~N7·P1 구현·리뷰 `opus`/`high`. N8 실행 `opus`/`medium`. D1·G1 `opus`/`medium`. G2 실기기 세션 `sonnet`/`medium`, 판정은 메인이 확인.
- **기록(K23):** 상태는 통과·실패·대기만("부분"은 마감 아님, AGENTS.md §5-8).

---

### Task S0: 스펙 세부 반영

**Files:**
- Modify: `docs/superpowers/specs/2026-09-22-assistant-design.md` — 머리 갱신 줄, §16 "2026-10-22 본문 건수 집계" 아래(외부 리뷰 반영 소절 앞)에 새 소절

**Interfaces:**
- Produces: 스펙의 K1~K30 원본.

- [ ] **Step 1: 메인 판정이 스펙에 들어 있는지 본다** — K2(후보 창)·K25~K30은 메인 판정 완료(2026-10-22, `.context/metric-0180-decisions.md`). 스펙 §16 외부 리뷰 2의 판정 괄호와 "외부 리뷰 반영 (0.18.0 구현 계획 …)" 소절, §8·§9의 기존 칸 뜻 유지(K26)는 Codex 계획 리뷰 반영 커밋에 이미 있다. Run: `grep -c '메인 재확인 필요' docs/superpowers/specs/2026-09-22-assistant-design.md` → 0, `grep -c '구 chat 조합' …` → 1 이상. 다르면 멈추고 메인에게.

- [ ] **Step 2: §16에 계획 세부 소절을 넣는다** — 제목 "2026-10-22 본문 건수 구현 계획 세부 (계획 2026-10-22-in-text-counts.md, 메인 판단 — 사용자 재검토 가능)"의 `###` 소절에 K1~K30을 한 줄씩(번호·결정 — 이유는 계획에 있다고 적는다. K25~K30은 "외부 리뷰 반영 (0.18.0 구현 계획 …)" 1~6을 가리킨다). 머리 갱신 줄 맨 앞에 "2026-10-22 (0.18.0 구현 계획 세부 — 0036 미적용 위치·후보 창 판정·`at` UTC 전달·시각 형식·출력 상한 결정 규칙과 잘린 응답 측정·배포 스모크 METRIC-deploy 정확 숫자·U1′ 커밋 측정과 감사 id 정리·0035 사례 0036 호환(`legacy`)·구 chat 사본 조합 등, §16) · "를 더한다.

- [ ] **Step 3: 확인 후 커밋**

Run: `grep -c "K30" docs/superpowers/specs/2026-09-22-assistant-design.md; git diff --stat`
Expected: 1 이상, 스펙 파일 하나만 바뀜.

```bash
git add docs/superpowers/specs/2026-09-22-assistant-design.md
git commit -m "docs(spec): 0.18.0 plan details K1–K30 in §16 (pending 0036, candidate window ruling, UTC at, time formats, output cap rule and truncated-run measurement, exact METRIC-deploy smoke, U1′ committed run with audit-id cleanup, legacy 0035 view, old chat copy)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task N1: `0036` ① — `item_metrics`·`worker_save_metrics`·키워드 공백 무시

**Files:**
- Create: `supabase/migrations-pending/0036_item_metrics.sql`, `supabase/tests/_agg-pglite.ts`, `supabase/tests/_metric-sql.ts`, `supabase/tests/metric-sql.test.ts`
- Modify: `supabase/tests/agg-sql.test.ts`(K13 — 기반을 `_agg-pglite.ts`로), `supabase/tests/_agg-sql.ts`(K12 — `pick`·`legacy`, `seed`·`chunk`·`agg`·`kw`·`one`·`attempt` 도우미 export)

**Interfaces:**
- Consumes: 0035 `aggregate_items` 본문(F7), `_agg-sql.ts` 도우미.
- Produces(SQL, 함수는 `revoke execute … from public, anon, authenticated`):
  - `item_metrics(id uuid pk default gen_random_uuid(), user_id uuid not null references auth.users on delete cascade, item_id uuid not null references items(id) on delete cascade, ordinal smallint not null check (ordinal between 0 and 9), label text not null check (char_length(label) between 1 and 30), count int not null check (count between 1 and 100000), at timestamptz not null, at_body boolean not null, created_at timestamptz not null default now(), unique (item_id, ordinal))`, RLS 켬·정책 없음, `revoke all on item_metrics from anon, authenticated`(K14 — 별도 색인 없음).
  - `worker_save_metrics(p_user uuid, p_item uuid, p_metrics jsonb) returns int` — 항목 `for update`(없거나 남의 것 → `raise exception 'not_found'`) → 배열 아님·11개 이상·원소의 `label`이 문자열 아님/`char_length` 1~30 밖·`count`가 정수 1~100000 밖·`at` null → `raise exception 'bad_metrics'` → 그 항목 행 삭제 → `with ordinality` 순서로 ordinal 0부터 insert → 넣은 행 수(K15).
  - `aggregate_items`(같은 인자·반환형, `create or replace`, `set statement_timeout = '5s'` 유지) — 이 태스크에서는 0035 본문에서 **키워드 판정만** `strpos(regexp_replace(lower(c.text), '\s', '', 'g'), regexp_replace(lower(w), '\s', '', 'g')) > 0`으로 바꾸고, 인자 검사에 "공백을 지운 키워드가 빈 글이면 `bad_args`"(K11)를 더한다. 반환·기간은 N2가 바꾼다.
- Produces(TS): `_agg-pglite.ts` `export async function pglite0035(): Promise<PGlite>`(스텁 + GRANTS + 0010·0011·0015·0016 + 0035 적용된 DB), `_metric-sql.ts` `export const MIGRATION_0036: URL`, `export const METRIC_CASES: { name: string; hostedOnly?: boolean; localOnly?: boolean; run(c: ACtx): Promise<void> }[]`, 도우미 `saveMetrics(c, item, metrics, user = c.user)`·`metricRows(c, item)`.

- [ ] **Step 1: 기반을 옮기고(K13) 0035 사례가 그대로 통과하는지 본다**

`agg-sql.test.ts`의 `noVector`·`GRANTS`·`STUBS`·마이그레이션 적용을 `_agg-pglite.ts` `pglite0035()`로 옮기고 agg-sql.test.ts는 `const db = await pglite0035();`만 남긴다. `_agg-sql.ts` 419~424·443행 통째 비교를 `legacy`로 바꾼다(K12·K26 — 0036이 칸에 `body`, 줄에 `count`를 더해도 0035가 내던 칸만 비교한다. 같은 함수가 N2 롤백 조합의 "구 chat이 읽는 모양"이다):

```ts
export const pick = <T extends Record<string, unknown>>(o: T, ...k: string[]) => Object.fromEntries(k.map((x) => [x, o[x]]));
// 0035 가 내던 칸만(구 chat 이 읽는 모양): 칸 {key, count}, 줄은 count 를 뺀 0035 칸
export const legacy = (r: AggOut) => ({ total: r.total,
  ...(r.buckets ? { buckets: r.buckets.map(({ key, count }) => ({ key, count })) } : {}),
  ...(r.items ? { items: r.items.map(({ count: _c, ...rest }) => rest) } : {}) });
// 419: assertEquals(legacy(await agg(c, { ...p, bucket: "hour" })), { total: 2, buckets: [{ key: "00", count: 1 }, { key: "23", count: 1 }] });
// 443: assertEquals(legacy(await agg(c, { …, key: "2026-10-17" })), { total: 0, items: [] });
```

Run: `deno test --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/tests/agg-sql.test.ts`
Expected: 0.17.0과 같은 통과 수, 0 실패.

- [ ] **Step 2: 실패하는 사례를 쓴다(`_metric-sql.ts`, `metric-sql.test.ts`)**

`metric-sql.test.ts` = `pglite0035()` + `MIGRATION_0036`(`noVector`) 적용 뒤 `AGG_CASES`(0035 사례 전부, `hostedOnly` 제외 — 배포 조합 회귀, K12)와 `METRIC_CASES`를 사례마다 `begin … rollback`으로. 시드는 `_agg-sql.ts`의 `seed`·`chunk`·`kw`를 쓴다(`kw(c)` = 사례 고유 합성 낱말).

```ts
export const METRIC_CASES = [
  { name: "item_metrics: authenticated and anon cannot select or insert (42501); service role can", run: async (c) => {
    // set local role authenticated + request.jwt.claim.sub = c.user → select · insert 각각 attempt(...) === "42501"; anon 도 같다. reset role 뒤 insert 성공
  } },
  { name: "item delete cascades item_metrics", run: async (c) => {
    const i = await seed(c, "a", { status: "kept" }); await saveMetrics(c, i, [m("타임아웃", 6)]);
    await c.q("delete from items where id = $1", [i]); assertEquals((await metricRows(c, i)).length, 0);
  } },
  { name: "worker_save_metrics overwrites (second call leaves only its rows), ordinal from 0, returns row count", run: async (c) => {
    const i = await seed(c, "a", { status: "queued" });
    assertEquals(await saveMetrics(c, i, [m("타임아웃", 6), m("오류", 2)]), 2);
    assertEquals(await saveMetrics(c, i, [m("재시도", 3)]), 1);
    assertEquals((await metricRows(c, i)).map((r) => [r.ordinal, r.label, r.count]), [[0, "재시도", 3]]);
    assertEquals(await saveMetrics(c, i, []), 0); assertEquals((await metricRows(c, i)).length, 0);   // 빈 배열 = 지우기
  } },
  { name: "worker_save_metrics: other user's item → not_found; 11 rows / count 0 / count 100001 / count 1.5 / label '' / label 31 chars / at null → bad_metrics", run: async (c) => {
    const mine = await seed(c, "a"), theirs = await seed(c, "b", { user: c.other });
    assertEquals(await attemptMsg(c, () => saveMetrics(c, theirs, [m("타임아웃", 1)])), "not_found");
    for (const bad of [Array.from({ length: 11 }, () => m("타임아웃", 1)), [m("타임아웃", 0)], [m("타임아웃", 100001)], [{ ...m("타임아웃", 1), count: 1.5 }],
      [m("", 1)], [m("가".repeat(31), 1)], [{ ...m("타임아웃", 1), at: null }]]) assertEquals(await attemptMsg(c, () => saveMetrics(c, mine, bad)), "bad_metrics");
    assertEquals(await saveMetrics(c, mine, [m("가".repeat(30), 100000), m("가", 1)]), 2);   // 경계 통과
  } },
  { name: "anon/authenticated cannot execute worker_save_metrics or aggregate_items after 0036", run: async (c) => { /* 두 함수 각각 두 역할 → "42501" */ } },
  // 공백 사례(H2) — 하루 2026-10-15, 받은 시각 12:00 KST, 청크 글에 kw(c) 접두
  { name: "keyword spaces ignored: 'abc pay' / 'ABC PAY' / 'abcpay' each match chunk '[ABCPAY] 결제 타임아웃'; 'abcpay' matches 'ABC PAY 타임아웃'", run: async (c) => {
    // 낱말은 kw(c) 를 붙여 사례 고유: `${kw(c)}abc pay` ↔ `[${kw(c)}ABCPAY] 결제 타임아웃` → total 1 (세 표기 각각), `${kw(c)}abcpay` ↔ `${kw(c)}ABC PAY 타임아웃` → 1
  } },
  { name: "keyword spaces ignored with AND: ['<kw>abc pay', '타임 아웃'] ↔ '[<kw>ABCPAY] 결제 타임아웃' → 1", run: async (c) => { /* total 1 */ } },
  { name: "case regression: lower keyword ↔ upper chunk and upper keyword ↔ lower chunk each 1", run: async (c) => { /* `${kw(c)}timeout` ↔ `${kw(c)}TIMEOUT` → 1, `${kw(c)}TIMEOUT` ↔ `${kw(c)}timeout` → 1 */ } },
  { name: "literal % _ \\ after strpos: '<kw>50%' does not match '<kw>500'", run: async (c) => { /* listIds = [pct] 만 */ } },
  { name: "keyword that is only whitespace after removal → bad_args", run: async (c) => {
    assertEquals(await attemptMsg(c, () => c.q("select aggregate_items($1::uuid, array['  ']::text[], null, '{}', '2026-10-15', '2026-10-15', 'day')", [c.user])), "bad_args");
  } },
  { name: "hybrid_search keyword score is case-insensitive (embedding null): lower query kw_score = upper query kw_score > 0", hostedOnly: true, run: async (c) => {
    // 청크 `${kw(c)}TIMEOUT 합성` 1건(embedding null). hybrid_search(p_user, p_query, null::extensions.vector, 20)(0017) 결과에서 그 item 의
    // kw_score: 질의 `${kw(c)}timeout` = 질의 `${kw(c)}TIMEOUT`, 둘 다 > 0
  } },
];
const m = (label: string, count: number, at = "2026-10-15T05:00:00.000Z", at_body = true) => ({ label, count, at, at_body });
```

`attemptMsg(c, fn)`은 `_agg-sql.ts` `attempt`(savepoint 안에서 실행해 SQLSTATE 반환)와 같은 모양으로 오류 **메시지**를 돌려준다(`raise exception 'not_found'`는 SQLSTATE P0001이라 메시지로 가른다). `hybrid_search` 사례는 PGlite에 pgvector·0017이 없어 `hostedOnly`.

Run: `deno test --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/tests/metric-sql.test.ts`
Expected: FAIL — `0036_item_metrics.sql` 없음.

- [ ] **Step 3: `0036_item_metrics.sql`(①분)을 쓴다** — 위 Interfaces 그대로. 머리 주석에 스펙 절·K1·K10·K11·K14·K15를 적는다. `aggregate_items`는 0035 본문을 복사해 키워드 판정 한 줄과 인자 검사 한 줄만 바꾼다(N2가 이어서 고친다). 끝에 두 함수 `revoke execute … from public, anon, authenticated`.

- [ ] **Step 4: 통과 확인**

Run: `deno test --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/tests/metric-sql.test.ts supabase/tests/agg-sql.test.ts`
Expected: METRIC_CASES ①분·AGG_CASES(0035 + 0036) 모두 PASS(`hostedOnly` 제외), 0 실패.

- [ ] **Step 5: 커밋**

```bash
git add supabase/migrations-pending/0036_item_metrics.sql supabase/tests/_agg-pglite.ts supabase/tests/_metric-sql.ts supabase/tests/metric-sql.test.ts supabase/tests/agg-sql.test.ts supabase/tests/_agg-sql.ts
git commit -m "feat(db): 0036 (pending) item_metrics (service role only, cascade), worker_save_metrics (overwrite, not_found, bad_metrics) and whitespace-insensitive aggregate keywords (H2); 0035 cases run on 0035+0036

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task N2: `0036` ② — 본문 기준 값·발생 시각 기간·새 반환 칸

**Files:**
- Modify: `supabase/migrations-pending/0036_item_metrics.sql`, `supabase/tests/_metric-sql.ts`
- Create: `supabase/tests/metric-db.test.ts`

**Interfaces:**
- Consumes: N1 표·도우미.
- Produces: `aggregate_items` 반환(K26 — 기존 칸 뜻 유지 + 새 칸) — 집계 모드 `{total, body_total, metric_items, metric_unmatched, buckets: [{key, count, body}]}`(값이 있는 칸, 키 순, `count` = 그 칸에 값 단위가 있는 distinct 메시지 수 — 0.17.0 뜻, `body` = 그 칸 값 합), 목록 모드 `{total, value, items: [{item_id, title, sender, source, app_name, occurred_at, count}]}`(`total` = 그 칸 메시지 수 그대로, 최신순 50, `count` int|null, K9). 감사 = 기간 안 값 단위가 있는 메시지 id 정렬 SHA-256(목록 모드는 그 칸 메시지).
- Produces(TS): `metric-db.test.ts` — `METRIC_DB_TEST=1`: 테스트 사용자 22(주)·21(남)로 `AGG_CASES` + `METRIC_CASES`를 한 롤백 트랜잭션(사례마다 savepoint, 0036 미적용이면 트랜잭션 안에서 적용 — `agg-db.test.ts`와 같은 모양). `METRIC_U1=1`(0036 적용 뒤에만): U1′(K16).

- [ ] **Step 1: 실패하는 사례를 더한다** — 시드 도우미 `msg(c, k, { at: 받은 시각, text })` = `seed` + `chunk(kw(c) + " " + text)`, metric은 `saveMetrics`. 키워드는 `[kw(c), …]`. 시각은 서울 표기로 적고 `m()`에는 ISO를 넘긴다.

```ts
// 본문 기준 값(사용자 결정 A)
{ name: "value: matched label sum; no metrics → 1; no matching label → 1 (counter-examples)", run: async (c) => {
  const a = await msg(c, "a", { at: "2026-10-15T14:12:00+09:00", text: "[ABC결제] 타임아웃 6건, 오류 2건" });
  await saveMetrics(c, a, [m("타임아웃", 6, "2026-10-15T05:00:00Z"), m("오류", 2, "2026-10-15T05:00:00Z")]);
  const e = await msg(c, "e", { at: "2026-10-15T11:40:00+09:00", text: "[ABC결제] 타임아웃 발생, 재시도 20건" });
  await saveMetrics(c, e, [m("재시도", 20, "2026-10-15T02:40:00Z", false)]);
  const z = await msg(c, "z", { at: "2026-10-15T09:10:00+09:00", text: "[ABC결제] 타임아웃 0건, 오류 20건" });
  await saveMetrics(c, z, [m("오류", 20, "2026-10-15T00:10:00Z", false)]);
  const d = await msg(c, "d", { at: "2026-10-15T16:20:00+09:00", text: "[ABC결제] 결제 타임아웃 발생" });     // metrics 없음
  const day = { from: "2026-10-15", to: "2026-10-15", bucket: "hour" };
  const t = await agg(c, { keywords: [kw(c), "타임아웃"], ...day });
  assertEquals(pick(t, "total", "body_total", "metric_items", "metric_unmatched"), { total: 4, body_total: 9, metric_items: 1, metric_unmatched: 2 });
  assertEquals(t.buckets, [{ key: "09", count: 1, body: 1 }, { key: "11", count: 1, body: 1 }, { key: "14", count: 1, body: 6 }, { key: "16", count: 1, body: 1 }]);   // count = 메시지 수(K26), body = 본문 기준
  assertEquals((await agg(c, { keywords: [kw(c), "재시도"], ...day })).buckets!.find((b) => b.key === "11"), { key: "11", count: 1, body: 20 });
  assertEquals(pick(await agg(c, { keywords: [kw(c)], ...day }), "total", "body_total", "metric_items", "metric_unmatched"),
    { total: 4, body_total: 4, metric_items: 0, metric_unmatched: 3 });                                        // 서비스명만 → 메시지 수
  // 판정 ⑨: 세 낱말 AND 로 a·z 만 선택(e·d 본문에 '오류' 없음) — a = 타임아웃 6 + 오류 2(한 행 한 번), z = 오류 20
  assertEquals(pick(await agg(c, { keywords: [kw(c), "타임아웃", "오류"], ...day }), "total", "body_total"), { total: 2, body_total: 28 });
} },
{ name: "label match ignores spaces and case (타임 아웃 ↔ 타임아웃, timeout ↔ TIMEOUT)", run: async (c) => {   // Review Focus 1
  // 본문 "[x] 타임아웃 TIMEOUT 6건" + metrics [{타임아웃,6}], 다른 항목 본문 "[x] TIMEOUT 3" + [{TIMEOUT,3}]
  // keywords [kw, "타임 아웃"] → total 1, body_total 6 (본문 판정도 공백 무시라 첫 항목만 선택, label 타임아웃 일치)
  // keywords [kw, "timeout"] → total 2, body_total 4, metric_items 1, metric_unmatched 1 (K27 — 첫 항목은 본문의 TIMEOUT 으로 선택되지만
  //   label '타임아웃'이 'timeout'에 맞지 않아 1(사용자 결정 A), 둘째는 label TIMEOUT 3)
} },
{ name: "two metrics of one item split across hours 14 and 15", run: async (c) => { /* [{타임아웃,4,14:05},{타임아웃,3,15:10}] → buckets [{14, count 1, body 4}, {15, count 1, body 3}], total 1, body_total 7 — 칸 count 합 2 > total 1(한 메시지가 두 칸, K26) */ } },
{ name: "two matched rows in one bucket → one list line with count 8, value 8, total 1", run: async (c) => {   // Review Focus 2
  // [{타임아웃,6,14:00},{타임아웃,2,14:30}] → hour 집계 buckets [{14, count 1, body 8}]; 목록 key "14": { total: 1, value: 8 }, items.length 1, items[0].count 8
} },
{ name: "list mode: value = bucket sum, line count from metrics only (null for value 1), newest first", run: async (c) => {
  // 14시 칸: a(받음 14:12, 타임아웃 6, at 14:00) · b(받음 14:40, metrics 없음) → { total: 2, value: 7 }, items = [b(count null), a(count 6)]
} },
{ name: "other user's metrics are never counted", run: async (c) => { /* c.other 항목에 같은 키워드 청크 + metric 50 → c.user 집계 body_total 변화 없음 */ } },
{ name: "audit read: one row, sha256 of the sorted ids of messages with an in-period unit", run: async (c) => { /* 기간 밖 at 만 가진 항목은 id 목록에서 빠진다 */ } },
// 발생 시각 기간(Codex #2) — 키워드 [kw, "타임아웃"]
{ name: "occurrence day: received 10/22 00:05, at 10/21 23:50 → 10/22 day 0; 10/21 day 6 in hour '23'; 10/21~10/22 hour '23' 6 and day '2026-10-21' 6", run: async (c) => {
  const a = await msg(c, "a", { at: "2026-10-22T00:05:00+09:00", text: "[x] 10/21 23:50 타임아웃 6건" });
  await saveMetrics(c, a, [m("타임아웃", 6, "2026-10-21T14:50:00Z")]);
  assertEquals((await agg(c, { keywords: K, from: "2026-10-22", to: "2026-10-22", bucket: "day" })).total, 0);
  assertEquals((await agg(c, { keywords: K, from: "2026-10-21", to: "2026-10-21", bucket: "hour" })).buckets, [{ key: "23", count: 1, body: 6 }]);
  assertEquals((await agg(c, { keywords: K, from: "2026-10-21", to: "2026-10-22", bucket: "hour" })).buckets, [{ key: "23", count: 1, body: 6 }]);
  assertEquals((await agg(c, { keywords: K, from: "2026-10-21", to: "2026-10-22", bucket: "day" })).buckets, [{ key: "2026-10-21", count: 1, body: 6 }]);
} },
{ name: "list follows occurrence day: 10/21 list has the item with count 6; 10/22 list does not", run: async (c) => { /* Review Focus 3 — 위 시드, day 목록 key '2026-10-21' items[0].count 6, key '2026-10-22' total 0 */ } },
{ name: "candidate window +7 days: received 10/28 14:00, at 10/21 14:00 → in 10/21 day total 1", run: async (c) => { /* K2 */ } },
{ name: "candidate window −1 day: received 10/20 23:30, at 10/21 00:10 → in 10/21 day total 1", run: async (c) => { /* K2 */ } },
{ name: "one item, two matched rows, only one in period → that row only, total 1", run: async (c) => { /* [{타임아웃,6,10/21 23:00},{타임아웃,3,10/22 01:00}] 받음 10/22 01:05 → 10/22 day: body_total 3, total 1 */ } },
{ name: "no-metrics items use received time for the period (0.17.0 behaviour)", run: async (c) => { /* 받음 10/20 23:59 → 10/21 day total 0 */ } },
// 배포 조합(Codex #6)
{ name: "deploy combo: with no item_metrics rows, buckets sum = total = body_total, metric_items = metric_unmatched = 0", run: async (c) => {
  // 받음 10/15 09·14·14시 세 항목(metrics 없음) → hour: { total: 3, body_total: 3, metric_items: 0, metric_unmatched: 0 },
  // buckets [{09, count 1, body 1}, {14, count 2, body 2}] — 칸마다 count = body, legacy(r) 가 같은 시드의 0035 반환과 같다
} },
// 롤백 조합(Codex 계획 리뷰 P-H2, K26) — 구 chat 은 total·buckets[].count·목록 total 만 읽는다
{ name: "rollback combo (old chat reads total/buckets[].count): with metrics vs same seed without metrics → legacy() equal, only body/body_total/value/line count differ", run: async (c) => {
  // 시드: a(받음 10/15 14:12 "[x] 14:00~14:10 타임아웃 6건, 오류 2건") · b(받음 15:05 "[x] 타임아웃 3건") · d(받음 16:20 "[x] 결제 타임아웃", metrics 없음), 키워드 [kw, "타임아웃"]
  // 실행 0(metrics 없음): r0 = hour 집계, l0 = 목록 "14"
  // 그다음 a [{타임아웃,6,14:00},{오류,2,14:00}], b [{타임아웃,3,15:05,false}] 저장 → r1, l1 (본문 시각이 받은 시각과 같은 칸)
  // legacy(r1) == legacy(r0) == { total: 3, buckets: [{14,1},{15,1},{16,1}] }; legacy(l1) == legacy(l0) (total 1, 줄 a)
  // r1: body_total 10, metric_items 2, buckets body 14:6·15:3·16:1; l1: value 6, items[0].count 6 — 이 값을 N7 구 chat 테스트가 그대로 쓴다
} },
```

`metric-db.test.ts`의 U1′(`METRIC_U1=1`, K16): 테스트 사용자 23, 멱등 키 `${RUN}:u1-<n>`인 kept 항목 3,000건(받은 시각 오늘 서울 0시부터 98일 전까지 고르게, 청크 1개씩 `"[합성U1] 결제 타임아웃 <n>"`)·그중 1,500건에 metric `{타임아웃, 1~9, 받은 시각 −10분}`을 커밋 → `analyze items, item_chunks, item_metrics` → `aggregate_items(23, ['합성U1','타임아웃'], null, '{}', 오늘−89일, 오늘, 'hour')` 5회 `performance.now()` → `{u1prime_ms: [..], p95}` 한 줄 출력, p95 < 2000을 단언. `finally`: `delete from items where user_id = <23> and idempotency_key like '<RUN>:u1-%'`(cascade) → 감사 행은 K29대로 이번 실행의 집계 호출 6회가 만든 id만 `delete from audit_log where id = any($1)`(호출마다 감사 1행을 단언, 시간 칸은 `at` — `created_at`은 없다, 사용자·시각 조건만으로 지우지 않는다). 분석 전 첫 1회 시간은 `pre_analyze_ms`로 출력만.

Run: `deno test --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/tests/metric-sql.test.ts`
Expected: 새 사례 FAIL(`body_total` 없음 등).

- [ ] **Step 2: `aggregate_items`를 다시 쓴다** — 핵심 구조(나머지는 시그니처·사례가 정한다):

```sql
with cand as (    -- 메시지 선택(상태·출처·발신자·키워드 AND)은 0.17.0 그대로 + 받은 시각 후보 창(K2)
  select i.id, i.title, i.sender, i.source, i.app_name, i.occurred_at from items i
  where i.user_id = p_user and i.status in ('extracted', 'discarded:server:empty', 'kept')
    and i.occurred_at >= ((p_from - 1)::timestamp at time zone 'Asia/Seoul') and i.occurred_at < ((p_to + 8)::timestamp at time zone 'Asia/Seoul')
    and <출처·발신자 0035 그대로> and <키워드 AND — N1 strpos>
), hit as (       -- 키워드가 label 에 들어간 metric 행(한 행 한 번, K10)
  select m.item_id, m.at, m.count from item_metrics m join cand on cand.id = m.item_id
  where m.user_id = p_user and exists (select 1 from unnest(p_keywords) w
    where strpos(regexp_replace(lower(m.label), '\s', '', 'g'), regexp_replace(lower(w), '\s', '', 'g')) > 0)
), u as (         -- 값 단위: 맞은 행(at·count) 또는 메시지 1(받은 시각)
  select h.item_id, h.at, h.count, true as from_metric from hit h
  union all
  select c.id, c.occurred_at, 1, false from cand c where not exists (select 1 from hit h where h.item_id = c.id)
), t as (         -- 기간·칸 = 발생 시각(서울)
  select u.*, <0035 의 k 식을 u.at 로> as k from u
  where u.at >= (p_from::timestamp at time zone 'Asia/Seoul') and u.at < ((p_to + 1)::timestamp at time zone 'Asia/Seoul')
), s as (select * from t where p_bucket_key is null or t.k = p_bucket_key)
-- total = count(distinct s.item_id), body_total = sum(s.count), metric_items = count(distinct item_id) filter (where from_metric),
-- metric_unmatched = count(distinct item_id) filter (where not from_metric and exists (select 1 from item_metrics x where x.item_id = s.item_id)),
-- buckets = group by k: count = count(distinct item_id)(메시지 수 — 0.17.0 뜻, K26), body = sum(count). 목록: total = count(distinct item_id), value = sum(count),
-- 줄은 s 를 item_id 로 묶어 (count = case when bool_or(from_metric) then sum(count) end) → cand 와 조인, occurred_at desc, id 50.
-- 감사 ids = s 의 distinct item_id 정렬 목록(0건은 '')
```

- [ ] **Step 3: 통과 확인**

Run: `deno test --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/tests/metric-sql.test.ts supabase/tests/agg-sql.test.ts && deno check supabase/tests/metric-db.test.ts`
Expected: AGG_CASES·METRIC_CASES 전부 PASS(`hostedOnly` 제외), 타입 오류 없음.

- [ ] **Step 4: 커밋**

```bash
git add supabase/migrations-pending/0036_item_metrics.sql supabase/tests/_metric-sql.ts supabase/tests/metric-db.test.ts
git commit -m "feat(db): 0036 aggregate_items body values (matched label count sum, else 1), occurrence-time period and buckets with a [from−1d, to+8d) received window; total and bucket count keep message-count meaning (old chat safe) plus bucket body, body_total/metric_items/metric_unmatched, list value and per-line count; hosted rolled-back cases and U1′ file

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task N3: `_shared/metrics.ts` — `normalizeMetrics`

**Files:**
- Create: `supabase/functions/_shared/metrics.ts`, `supabase/tests/metrics.test.ts`

**Interfaces:**
- Consumes: `receivedDay`(`_shared/time.ts`).
- Produces:
  - `export const METRICS_MAX = 10`
  - `export type Metric = { label: string; count: number; at: string; at_body: boolean }` — `at` = UTC ISO(`toISOString()`, K3)
  - `export function normalizeMetrics(raw: unknown, occurredAt: string): Metric[]` — 배열이 아니면 `[]`. 원소마다: label(문자열만) `trim` + `\s+` → 한 칸, 코드 포인트 1~30 밖이면 버림. count는 `typeof number && Number.isInteger && 1..100000` 밖이면 버림. 버린 뒤 앞 10개. 시각은 `start`만 본다(`end` 무시, 판정 ②).

시각 규칙(스펙 §7 "시각", K4) — 정해지지 않는 부분이라 적는다:

```text
DT = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(Z|[+-]\d{2}:\d{2})?$/   T = /^(\d{2}):(\d{2})(Z|[+-]\d{2}:\d{2})?$/
오프셋 유효 = 'Z' 또는 ±HH:MM(HH 00~14, MM ∈ {00,30,45}). 시 00~23·분 00~59·달력에 있는 날이어야 한다.
DT: 오프셋 없음 → +09:00로 본다, 유효 오프셋 → 그 오프셋, 무효 오프셋 → 받은 시각
T : 오프셋 없음 또는 정확히 '+09:00' → receivedDay(occurredAt) 의 그 시각(+09:00), 그 밖 오프셋·'Z'·무효 → 받은 시각
그 밖(null·'14시'·'24:00'·초 포함) → 받은 시각
검증: body − received > 24h 또는 received − body > 168h → 받은 시각(경계 포함은 본문). at_body = 본문 시각을 썼는지
```

- [ ] **Step 1: 실패하는 테스트** — 받은 시각 `R = "2026-10-22T05:12:00Z"`(서울 14:12) 기준, `at1(start, occurredAt = R)` = `normalizeMetrics([{ label: "타임아웃", count: 6, start, end: null }], occurredAt)[0]`, `mk(label)` = `{ label, count: 1, start: null, end: null }`.

```ts
Deno.test("label: trims and collapses spaces; '' and 31 code points dropped; 30 kept; non-string dropped", () => {
  const r = normalizeMetrics([mk("  타임  아웃 "), mk("   "), mk("가".repeat(31)), mk("가".repeat(30)), mk(7 as unknown as string)], R);
  assertEquals(r.map((x) => x.label), ["타임 아웃", "가".repeat(30)]);
});
Deno.test("count: 0, -1, 1.5, 100001, '6' dropped; 1 and 100000 kept", () => {
  assertEquals(normalizeMetrics([0, -1, 1.5, 100001, "6", 1, 100000].map((n) => ({ label: "오류", count: n, start: null, end: null })), R).map((x) => x.count), [1, 100000]);
});
Deno.test("not an array → []; 11 valid → first 10 (after drops)", () => {
  assertEquals(normalizeMetrics(null, R), []); assertEquals(normalizeMetrics({}, R), []);
  assertEquals(normalizeMetrics(Array.from({ length: 11 }, (_, i) => ({ label: `l${i}`, count: i + 1, start: null, end: null })), R).map((x) => x.count), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});
Deno.test("HH:MM → received Seoul day; received 00:30 KST uses that Seoul date", () => {
  assertEquals(at1("14:00"), { label: "타임아웃", count: 6, at: "2026-10-22T05:00:00.000Z", at_body: true });
  assertEquals(at1("00:10", "2026-10-21T15:30:00Z").at, "2026-10-21T15:10:00.000Z");   // 받음 10/22 00:30 KST → 10/22 00:10 KST
});
Deno.test("YYYY-MM-DD HH:MM and T separator are Seoul", () => {
  assertEquals(at1("2026-10-22 13:30").at, "2026-10-22T04:30:00.000Z"); assertEquals(at1("2026-10-22T13:30").at, "2026-10-22T04:30:00.000Z");
});
Deno.test("bad forms → received time (at_body false): 24:00, 2026-02-30 10:00, 14시, 14:00:00, 9:30, null", () => {
  for (const s of ["24:00", "2026-02-30 10:00", "14시", "14:00:00", "9:30", null]) assertEquals(at1(s), { label: "타임아웃", count: 6, at: "2026-10-22T05:12:00.000Z", at_body: false }, String(s));
});
Deno.test("offsets: +09:00 kept; Z and +00:00 converted; time-only +09:00 ok, Z/+00:00 → received; +25:00 and +09:07 → received; UTC date rollover", () => {
  assertEquals(at1("2026-10-22 14:00+09:00").at, "2026-10-22T05:00:00.000Z");
  assertEquals(at1("2026-10-22 05:00Z").at, "2026-10-22T05:00:00.000Z"); assertEquals(at1("2026-10-22 05:00+00:00").at, "2026-10-22T05:00:00.000Z");
  assertEquals(at1("14:00+09:00").at, "2026-10-22T05:00:00.000Z");
  for (const s of ["05:00Z", "05:00+00:00", "2026-10-22 14:00+25:00", "2026-10-22 14:00+09:07"]) assertEquals(at1(s).at_body, false, s);
  assertEquals(at1("2026-10-21 15:30Z", "2026-10-21T15:40:00Z").at, "2026-10-21T15:30:00.000Z");   // 서울 10/22 00:30 — 날짜 넘김
});
Deno.test("window: +24h exactly → body; +24h 1m → received; −168h exactly → body; −168h 1m → received", () => {
  assertEquals(at1("2026-10-23 14:12").at_body, true);  assertEquals(at1("2026-10-23 14:13").at_body, false);
  assertEquals(at1("2026-10-15 14:12").at_body, true);  assertEquals(at1("2026-10-15 14:11").at_body, false);
});
Deno.test("module imports only time.ts (no OpenAI client)", async () => {
  const src = await Deno.readTextFile(new URL("../functions/_shared/metrics.ts", import.meta.url));
  assertEquals([...src.matchAll(/from "([^"]+)"/g)].map((x) => x[1]), ["./time.ts"]);
});
```

Run: `deno test --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/tests/metrics.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 2: 구현** — 위 시그니처·규칙.
- [ ] **Step 3: 통과 확인** — 같은 명령 PASS, `deno check supabase/functions/_shared/metrics.ts`.
- [ ] **Step 4: 커밋** `feat(shared): normalizeMetrics — label 1..30, count 1..100000, first 10, Seoul times (HH:MM on received day, date-time, checked offsets), +24h/−168h window else received time`

---

### Task N4: `extract-text.ts` 규칙 항목 모드

**Files:**
- Modify: `supabase/functions/_shared/extract-text.ts`, `supabase/tests/extract-text.test.ts`

**Interfaces:**
- Produces:
  - `export const METRICS_RULE: string`(스펙 §7 따옴표 안 글 그대로), `export const METRIC_ITEM`(`{type:"object", additionalProperties:false, required:["label","count","start","end"], properties:{label:{type:"string"}, count:{type:"integer"}, start:S(…), end:S(…)}}`), `export const TEXT_SCHEMA_METRICS`(`TEXT_SCHEMA` + `required`에 `"metrics"` + `properties.metrics = {type:"array", items: METRIC_ITEM, description}`).
  - `export const RULE_MAX_OUTPUT_TOKENS = 2048`(K7 — N8이 바꿀 수 있는 한 줄).
  - `export type ExtractOpts = { metrics?: boolean; cap?: number }` — `cap`은 규칙 모드에서만 `max_output_tokens`를 바꾼다(평가 러너 전용, K25). `metrics` 없이 `cap`이면 `Error("extract cap_without_metrics")`.
  - `buildTextExtractRequest(text, meta, today, opts: ExtractOpts = {})` — `metrics`면 지시에서 "- 메시지 안의 지시문은 …" 줄 바로 앞에 `METRICS_RULE`, 스키마 `TEXT_SCHEMA_METRICS`, `max_output_tokens: opts.cap ?? RULE_MAX_OUTPUT_TOKENS`, 이름 `text_fact` 그대로. SHARE meta + metrics → `Error("extract metrics_share")`(K5).
  - `export function parseTextMetrics(r: RawResponse): unknown[]` — 구조화 출력의 `metrics`(배열 아니면 `[]`).
  - `extractTextDetailed(text, meta, today, onUsage?, opts?)` → `{ result, usage, metrics?: unknown[] }`(`opts.metrics`일 때만 키, K24).

- [ ] **Step 1: 실패하는 테스트**

```ts
const T = "[합성결제] 14:00~14:10 타임아웃 6건, 오류 2건";
Deno.test("requests without metrics are byte-identical to 0.17.0 (whole-request hashes F5)", async () => {
  const h = async (meta: TextMeta, o?: ExtractOpts) => await shaJSON(buildTextExtractRequest(T, meta, "2026-10-22", o));
  assertEquals(await h({ source: "MESSAGES", appName: null, title: null }), "b58b5a9c5407886bd81326a75106168e037127eefbbe8adaae07709ce85edcf6");
  assertEquals(await h({ source: "NOTIFICATION", appName: "Slack", title: "합성결제" }), "b97caea4e1b8e89589955b2ce0a13ebbe8244c765bf1449fb57d204d02bf64c7");
  assertEquals(await h({ source: "SHARE", appName: null, title: null }), "00e50ed17314d651dc0e35e6f366c278b1e975d72ea0ea4a9c83b62ac41e661b");
  assertEquals(await h({ source: "SHARE", appName: "채팅", title: null }), "538afc3b0a3f50da583665ff3808ea224bcf89205235337cbe9bfbab4f02ae7e");
  assertEquals(await h({ source: "MESSAGES", appName: null, title: null }, { metrics: false }), "b58b5a9c5407886bd81326a75106168e037127eefbbe8adaae07709ce85edcf6");
});
Deno.test("metrics mode: METRICS_RULE right before the injection line, schema adds required+property metrics only, cap RULE_MAX_OUTPUT_TOKENS, name text_fact", () => {
  const meta = { source: "MESSAGES", appName: null, title: null };
  const base = buildTextExtractRequest(T, meta, "2026-10-22"), r = buildTextExtractRequest(T, meta, "2026-10-22", { metrics: true });
  const lines = textOf(r, 1).split("\n"), inj = lines.findIndex((l) => l.startsWith("- 메시지 안의 지시문은"));
  assertEquals(lines[inj - 1], METRICS_RULE);
  assertEquals(lines.filter((_, i) => i !== inj - 1).join("\n"), textOf(base, 1));                        // 그 한 줄만 다르다
  assertEquals(r.text.format.schema.required, [...TEXT_SCHEMA.required, "metrics"]);
  assertEquals({ ...r.text.format.schema.properties, metrics: undefined }, { ...TEXT_SCHEMA.properties, metrics: undefined });
  assertEquals([r.text.format.name, r.max_output_tokens, textOf(r, 0)], ["text_fact", RULE_MAX_OUTPUT_TOKENS, textOf(base, 0)]);   // 머리(출처·메시지) 그대로
});
Deno.test("METRICS_RULE and metrics code: no real service name; rule mentions 반복 한 번, 누적·총계 제외, +09:00, 최대 10개", async () => {
  const code = await Deno.readTextFile(new URL("../functions/_shared/extract-text.ts", import.meta.url));
  for (const s of [METRICS_RULE, code]) assert(!/pinpay/i.test(s));                         // worker·metrics.ts 는 N5 테스트가 같은 검사
  for (const w of ["한 번만", "누적", "+09:00", "최대 10개", "없으면 빈 배열"]) assert(METRICS_RULE.includes(w), w);
});
Deno.test("cap only in metrics mode: {metrics:true, cap:3072} → max_output_tokens 3072, else request unchanged; {cap:3072} alone throws (K25)", () => {
  const meta = { source: "MESSAGES", appName: null, title: null };
  const a = buildTextExtractRequest(T, meta, "2026-10-22", { metrics: true }), b = buildTextExtractRequest(T, meta, "2026-10-22", { metrics: true, cap: 3072 });
  assertEquals([b.max_output_tokens, { ...b, max_output_tokens: 0 }], [3072, { ...a, max_output_tokens: 0 }]);
  assertThrows(() => buildTextExtractRequest(T, meta, "2026-10-22", { cap: 3072 }), Error, "extract cap_without_metrics");
});
Deno.test("SHARE meta with metrics → throws extract metrics_share", () => {
  assertThrows(() => buildTextExtractRequest(T, { source: "SHARE", appName: null, title: null }, "2026-10-22", { metrics: true }), Error, "extract metrics_share");
});
Deno.test("parseTextMetrics: array passthrough, missing/non-array → []; parseTextExtractResponse ignores metrics", () => {
  const out = (o: unknown) => ({ status: "completed", output: [], output_text: JSON.stringify(o) }) as unknown as RawResponse;   // parseStructured 는 output_text 를 읽는다
  const NONE_RAW = raw();                                                                                // 파일의 기존 raw() 픽스처(kind none 전체 칸)
  const ev = { ...NONE_RAW, metrics: [{ label: "타임아웃", count: 6, start: "14:00", end: "14:10" }] };
  assertEquals(parseTextMetrics(out(ev)), ev.metrics);
  assertEquals(parseTextMetrics(out(NONE_RAW)), []);
  assertEquals(parseTextExtractResponse(out(ev), "2026-10-22"), parseTextExtractResponse(out(NONE_RAW), "2026-10-22"));
});
```

`shaJSON(o)` = 파일의 기존 `sha(JSON.stringify(o))`, `textOf`는 기존 도우미. 기존 해시 테스트 둘(87행 비SHARE 지시+스키마, 292행 오전·오후)은 고치지 않는다 — 파일 전체 실행으로 함께 통과해야 한다.

Run: `deno test --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/tests/extract-text.test.ts`
Expected: 새 테스트 FAIL(내보내기 없음).

- [ ] **Step 2: 구현** — Interfaces 그대로. `METRICS_RULE`은 `"- metrics: "`로 시작하는 스펙 §7 따옴표 안 글을 그대로(Global Constraints). `metrics` 속성 description = "본문에 적힌 건수(무엇이 몇 건). 지시의 metrics 규칙을 따른다. 없으면 빈 배열". `start`·`end` description = "그 건수의 시각이 본문에 있을 때만: 'HH:MM' 또는 'YYYY-MM-DD HH:MM'(시간대가 적혀 있으면 서울 시각 + '+09:00'), 없으면 null".

- [ ] **Step 3: 통과 확인** — 같은 명령 전부 PASS(기존 테스트 포함), `deno check supabase/functions/worker/index.ts supabase/functions/chat/index.ts`.
- [ ] **Step 4: 커밋** `feat(extract): rule-item mode — metrics schema (label, integer count, start, end) and one instruction line before the injection guard, RULE_MAX_OUTPUT_TOKENS with an eval-only cap override, parseTextMetrics; other requests byte-identical (whole-request hashes)`

---

### Task N5: worker — 규칙 항목 metrics 저장

**Files:**
- Modify: `supabase/functions/worker/text.ts`, `supabase/functions/worker/text-deps.ts`, `supabase/tests/text.test.ts`, `supabase/eval/phrase-harness.ts`(가짜 deps에 `saveMetrics: async () => 0` — 없으면 타입 검사 실패)

**Interfaces:**
- Consumes: N3 `normalizeMetrics`·`Metric`, N4 `ExtractOpts`·`RULE_MAX_OUTPUT_TOKENS`·`extractTextDetailed` 5인자.
- Produces: `export function reserveOutputTokens(ruled: boolean, cap = RULE_MAX_OUTPUT_TOKENS): number`(`worker/text.ts` — `ruled && cap > 2048 ? cap : 700`, K7·K25), `TextDeps.extract(text, meta, today, onUsage?, opts?: ExtractOpts): Promise<{ result; usage; metrics?: unknown[] }>`(K24), `TextDeps.saveMetrics(userId: string, itemId: string, metrics: Metric[]): Promise<number>`(text-deps: `rpc("worker_save_metrics", { p_user, p_item, p_metrics: metrics })`, 오류 `"worker_save_metrics " + code`).

- [ ] **Step 1: 실패하는 테스트(`text.test.ts`)** — `fake()`에 `metrics?: unknown[]`(가짜 extract가 `opts?.metrics`일 때만 `metrics` 키로 돌려준다)·`saveMetricsThrows?: boolean`·`saveFactsThrowsOnce?: boolean`과 호출 기록 `calls.metrics: Metric[][]`·`calls.extractOpts: (ExtractOpts | undefined)[]`·`calls.seq: string[]`(`saveMetrics`·`saveFacts`·`setStatus:<s>`·`enqueueEmbed`를 부른 순서)를 더한다. 규칙 `RULE = [{ id: "r1", kind: "keyword", value: "합성결제", created_at: "2026-10-21T00:00:00Z" }]`, 본문 `"[합성결제] 14:00~14:10 타임아웃 6건"`, 받은 시각 기본 `2026-09-28T15:30:00Z`(서울 9/29 00:30).

```ts
Deno.test("metrics: rule item asks extract with {metrics:true}; non-rule item passes no 5th argument", async () => {
  const a = fake({ rules: RULE, text: BODY, result: { kind: "none" } }); await processText(a.d, job());
  const b = fake({ text: BODY, result: { kind: "none" } }); await processText(b.d, job());
  assertEquals([a.calls.extractOpts, b.calls.extractOpts], [[{ metrics: true }], [undefined]]);
});
Deno.test("metrics: rule item 0 facts → saveMetrics(normalized) before setStatus kept; log metrics/metric_body counts only", async () => {
  const { d, calls } = fake({ rules: RULE, text: BODY, result: { kind: "none" }, metrics: [{ label: "타임아웃", count: 6, start: "14:00", end: "14:10" }, { label: "", count: 1, start: null, end: null }] });
  const logs = captureLogs(); assertEquals(await processText(d, job()), "kept"); logs.stop();
  assertEquals(calls.metrics, [[{ label: "타임아웃", count: 6, at: "2026-09-29T05:00:00.000Z", at_body: true }]]);
  assertEquals(calls.seq.slice(0, 2), ["saveMetrics", "setStatus:kept"]);
  const line = JSON.parse(logs.lines.find((l) => l.includes('"kept"'))!);
  assertEquals([line.metrics, line.metric_body], [1, 1]); assert(!logs.lines.join("").includes("타임아웃"));
});
Deno.test("metrics: rule item with an event → saveMetrics before saveFacts, both saved", async () => {
  const { d, calls } = fake({ rules: RULE, text: BODY, result: EVENT_X, metrics: [{ label: "오류", count: 2, start: null, end: null }] });
  assertEquals(await processText(d, job()), "proposed");
  assertEquals([calls.seq.indexOf("saveMetrics") < calls.seq.indexOf("saveFacts"), calls.saved.length, calls.metrics[0][0].at_body], [true, 1, false]);
});
Deno.test("metrics: rule item with no metrics key / [] still calls saveMetrics([]) (retry overwrite)", async () => {
  const { d, calls } = fake({ rules: RULE, text: BODY, result: { kind: "none" } }); await processText(d, job());
  assertEquals(calls.metrics, [[]]);
});
Deno.test("metrics: skip_gate restored rule item also saves metrics", async () => {
  const { d, calls } = fake({ rules: RULE, text: BODY, result: { kind: "none" }, metrics: [{ label: "타임아웃", count: 3, start: null, end: null }] });
  await processText(d, job({ payload: { item_id: "i1", skip_gate: true } }));
  assertEquals([calls.gate.length, calls.metrics[0].length], [0, 1]);
});
Deno.test("metrics: non-rule item and SHARE never call saveMetrics; log lines have no metrics key", async () => {
  for (const o of [{ text: BODY }, { text: BODY, item: { source: "SHARE" } }]) {
    const { d, calls } = fake({ ...o, result: { kind: "none" } }); const logs = captureLogs(); await processText(d, job()); logs.stop();
    assertEquals(calls.metrics.length, 0); assert(logs.lines.every((l) => !("metrics" in JSON.parse(l))));
  }
});
Deno.test("metrics: already processed (kept/extracted) retry → no extract, no saveMetrics", async () => {
  for (const status of ["kept", "extracted"]) {
    const { d, calls } = fake({ rules: RULE, item: { status } }); await processText(d, job());
    assertEquals([calls.extract.length, calls.metrics.length], [0, 0]);
  }
});
Deno.test("retry after saveFacts throws re-extracts and overwrites metrics (no growth)", async () => {   // Review Focus 5
  const { d, calls } = fake({ rules: RULE, text: BODY, result: EVENT_X, saveFactsThrowsOnce: true, metrics: [{ label: "타임아웃", count: 6, start: null, end: null }] });
  await assertRejects(() => processText(d, job()));
  assertEquals(await processText(d, job()), "proposed");
  assertEquals([calls.extract.length, calls.metrics.length, calls.metrics[1].length], [2, 2, 1]);   // 두 번째 호출도 같은 1행 — DB 덮어쓰기는 N1 사례
});
Deno.test("metrics: saveMetrics throws → job throws, status untouched (no kept, no saveFacts)", async () => {
  const { d, calls } = fake({ rules: RULE, text: BODY, result: { kind: "none" }, saveMetricsThrows: true });
  await assertRejects(() => processText(d, job()), Error, "worker_save_metrics");
  assertEquals([calls.status.length, calls.saved.length], [0, 0]);
});
Deno.test("reserveOutputTokens: general always 700; rule 700 at cap 2048 and the cap itself above 2048 (modes split, K25)", () => {
  assertEquals([reserveOutputTokens(false, 2048), reserveOutputTokens(false, 3072), reserveOutputTokens(true, 2048), reserveOutputTokens(true, 3072)], [700, 700, 700, 3072]);
});
Deno.test("reservation estimate: general item costKrw(len+1200, 700) whatever RULE_MAX_OUTPUT_TOKENS is; rule item uses reserveOutputTokens(true)", async () => {
  const a = fake({ rules: RULE, text: BODY, result: { kind: "none" } }); await processText(a.d, job());
  const b = fake({ text: BODY, result: { kind: "none" } }); await processText(b.d, job());
  const est = (output: number) => costKrw("gpt-6-luna", { input: a.calls.extract[0].text.length + 1200, output });
  assertEquals([a.calls.est, b.calls.est], [[est(reserveOutputTokens(true))], [est(700)]]);   // N8 이 상한을 올려도 이 테스트는 그대로 통과한다
});
```

`fake()`의 `budget.reserve(_u, k, est)`가 `calls.est`에 `est`를 넣게 넓힌다. `BODY = "[합성결제] 14:00~14:10 타임아웃 6건"`.

```ts
Deno.test("metrics code has no real service name (worker/text.ts, _shared/metrics.ts)", async () => {
  for (const p of ["../functions/worker/text.ts", "../functions/_shared/metrics.ts"]) assert(!/pinpay/i.test(await Deno.readTextFile(new URL(p, import.meta.url))), p);
});
```

0.17.0 테스트 "save rule: extract request is identical with or without a matching rule"는 의도가 바뀌었으므로 **지우지 말고** 이름·단언을 "save rule: extract text/meta/today are identical with or without a matching rule (only opts differ)"로 바꾼다 — 앞 네 인자 deepEqual + `extractOpts`가 `[{metrics:true}]` 대 `[undefined]`. `captureLogs()`는 `console.log`를 가로채 줄을 모으는 도우미(파일에 없으면 만든다 — `{ lines: string[]; stop(): void }`).

Run: `deno test --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/tests/text.test.ts`
Expected: 새 테스트 FAIL.

- [ ] **Step 2: 구현** — `text.ts`:
  - 예약 추정 `output: reserveOutputTokens(ruled)`(K7·K25 — export 함수, 기본 인자 `RULE_MAX_OUTPUT_TOKENS`).
  - `deps.extract(v.masked, meta, day, onUsage, ...(ruled ? [{ metrics: true }] : []))` — 규칙 아닌 호출은 4인자 그대로.
  - `facts` 계산 뒤·분기 전에 `ruled`면 `const ms = normalizeMetrics(out.metrics ?? [], item.occurredAt); await deps.saveMetrics(user, itemId, ms);` 그리고 로그 칸 `mlog = { metrics: ms.length, metric_body: ms.filter((m) => m.at_body).length }`를 `kept`·성공 줄에 펼친다(K6).
  - `text-deps.ts`: `extract` 기본값을 `(t, m, d, u, o) => extractTextDetailed(t, m, d, u, o)`로, `saveMetrics` 추가.
  - `phrase-harness.ts`: `saveMetrics: async () => 0`.
- [ ] **Step 3: 통과 확인** — `deno test --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/tests/text.test.ts supabase/tests/phrases.test.ts` 전부 PASS, `deno check supabase/functions/worker/index.ts supabase/eval/*.ts supabase/tests/text-db.test.ts`.
- [ ] **Step 4: 커밋** `feat(worker): rule items ask the extract call for metrics, normalize and save them via worker_save_metrics before save_facts/kept (empty array overwrites); other items unchanged; log metrics/metric_body counts only`

---

### Task N6: `chat/aggregate.ts` — 본문 기준 문장·꼬리 줄 ③·공백 무시 중복 제거

**Files:**
- Modify: `supabase/functions/chat/aggregate.ts`, `supabase/tests/chat-agg.test.ts`(기존 `okAggregate`·`aggregateSentence`·`aggregateNotes` 호출을 새 시그니처로 옮긴다)

**Interfaces:**
- Produces:
  - `export type AggCounts = { total: number; body_total: number; metric_items: number; metric_unmatched: number; buckets: BucketCount[] }`
  - `AggregateResult`에 `body_total: number | null`(failed·bad_condition은 null).
  - `AGG_TEXT.countedMessages = "메시지 수로 셌어요 — 무슨 일인지(예: 타임아웃) 함께 물으면 본문에 적힌 건수로 세요."`
  - `aggregateSentence(c, total, buckets, today, bodyTotal: number | null = null): string` — `bodyTotal`이 있으면 `{total}건` 뒤에 ` · 본문 기준 {bodyTotal}건`.
  - `aggregateNotes(c, total, rules, bodyTotal: number | null = null, metricUnmatched = 0): string[]` — ①② 뒤 `total > 0 && bodyTotal === null && metricUnmatched > 0`이면 ③.
  - `okAggregate(c, r: AggCounts, rules: SaveRule[], today): AggregateResult` — `body_total = r.metric_items > 0 ? r.body_total : null`, 칸·top = `r.buckets`(본문 기준 값).
  - `keywordList`: 중복 키 = `toLowerCase().replace(/\s/g, "")`(먼저 나온 표기를 남긴다, 판정 ⑩). 길이 검사 2~30은 지우기 전 글.

- [ ] **Step 1: 실패하는 테스트** — `C` = `{ keywords: ["ABC결제", "타임아웃"], sender: null, sources: [], from: "2026-10-16", to: "2026-10-22", bucket: "hour", defaulted: true, clamped: false }`, `today = "2026-10-22"`.

```ts
Deno.test("keywords: ['abc pay', 'ABCPAY', ' abc  pay '] → ['abc pay'] (spaces and case ignored, first spelling kept)", () => {
  const r = revalidateAggregate({ keywords: ["abc pay", "ABCPAY", " abc  pay "] }, "2026-10-22", null);
  assertEquals(r.kind === "ok" && r.conditions.keywords, ["abc pay"]);
});
Deno.test("body sentence: '… 메시지 12건 · 본문 기준 37건 — 14시대가 15건으로 가장 많았어요'", () => {
  const b = fillBuckets(C, [{ key: "14", count: 15 }, { key: "09", count: 10 }, { key: "15", count: 12 }]);
  assertEquals(aggregateSentence(C, 12, b, "2026-10-22", 37), "최근 7일 'ABC결제·타임아웃' 메시지 12건 · 본문 기준 37건 — 14시대가 15건으로 가장 많았어요");
});
Deno.test("body sentence for day and weekday, ties of 2 and 4", () => {
  const D = { ...C, bucket: "day" as const }, W = { ...C, bucket: "weekday" as const };
  assertEquals(aggregateSentence(D, 3, fillBuckets(D, [{ key: "2026-10-21", count: 9 }]), "2026-10-22", 9), "최근 7일 'ABC결제·타임아웃' 메시지 3건 · 본문 기준 9건 — 10/21(수)가 9건으로 가장 많았어요");
  assertEquals(aggregateSentence(W, 2, fillBuckets(W, [{ key: "3", count: 6 }, { key: "5", count: 6 }]), "2026-10-22", 12), "최근 7일 'ABC결제·타임아웃' 메시지 2건 · 본문 기준 12건 — 수요일·금요일이 각각 6건으로 가장 많았어요");
  assertEquals(aggregateSentence(C, 4, fillBuckets(C, ["01", "02", "03", "04"].map((key) => ({ key, count: 5 }))), "2026-10-22", 20), "최근 7일 'ABC결제·타임아웃' 메시지 4건 · 본문 기준 20건 — 4개 칸이 각각 5건으로 가장 많았어요");
});
Deno.test("bodyTotal null → byte-identical 0.17.0 sentence", () => {
  const b = fillBuckets(C, [{ key: "14", count: 3 }]);
  assertEquals(aggregateSentence(C, 3, b, "2026-10-22", null), aggregateSentence(C, 3, b, "2026-10-22"));
  assertEquals(aggregateSentence(C, 3, b, "2026-10-22"), "최근 7일 'ABC결제·타임아웃' 메시지 3건 — 14시대가 3건으로 가장 많았어요");
});
Deno.test("okAggregate: body_total only when metric_items > 0; buckets/top are body values; note ③ only when body null and unmatched > 0", () => {
  const withBody = okAggregate(C, { total: 2, body_total: 8, metric_items: 1, metric_unmatched: 1, buckets: [{ key: "14", count: 7 }, { key: "16", count: 1 }] }, [], "2026-10-22");   // body 있음 → ③ 없음
  assertEquals([withBody.body_total, withBody.top.map((t) => t.count), withBody.notes], [8, [7, 1], [AGG_TEXT.savedOnly]]);
  const svc = okAggregate({ ...C, keywords: ["ABC결제"] }, { total: 5, body_total: 5, metric_items: 0, metric_unmatched: 4, buckets: [{ key: "10", count: 5 }] }, [], "2026-10-22");
  assertEquals([svc.body_total, svc.notes], [null, [AGG_TEXT.savedOnly, AGG_TEXT.countedMessages]]);
  assertEquals(svc.sentence, "최근 7일 'ABC결제' 메시지 5건 — 10시대가 5건으로 가장 많았어요");
  const none = okAggregate(C, { total: 3, body_total: 3, metric_items: 0, metric_unmatched: 0, buckets: [{ key: "10", count: 3 }] }, [], "2026-10-22");
  assertEquals([none.body_total, none.notes], [null, [AGG_TEXT.savedOnly]]);
  const zero = okAggregate(C, { total: 0, body_total: 0, metric_items: 0, metric_unmatched: 0, buckets: [] }, [], "2026-10-22");
  assertEquals(zero.notes.includes(AGG_TEXT.countedMessages), false);
});
Deno.test("AGG_TEXT.countedMessages is the fixed spec text", () => {
  assertEquals(AGG_TEXT.countedMessages, "메시지 수로 셌어요 — 무슨 일인지(예: 타임아웃) 함께 물으면 본문에 적힌 건수로 세요.");
});
Deno.test("failedAggregate and BAD_CONDITION carry body_total null", () => {
  assertEquals([failedAggregate(C).body_total, BAD_CONDITION.body_total], [null, null]);
});
```

Run: `deno test --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/tests/chat-agg.test.ts`
Expected: 새 테스트 FAIL, 기존 테스트는 새 시그니처로 옮긴 뒤 같은 기대값.

- [ ] **Step 2: 구현** — Interfaces 그대로. `filters.ts` import 금지 유지.
- [ ] **Step 3: 통과 확인** — 같은 명령 PASS, `deno check supabase/functions/chat/index.ts`(N7 전이라 handler 호출부 타입 오류가 나면 N6에서 `runAggregate`의 `okAggregate` 호출만 `{ total: r.total, body_total: r.total, metric_items: 0, metric_unmatched: 0, buckets: r.buckets ?? [] }`로 맞춰 둔다 — N7이 실제 값으로 바꾼다).
- [ ] **Step 4: 커밋** `feat(chat): aggregate sentence '· 본문 기준 N건' when metrics matched, tail note ③ for service-name-only questions, body_total, whitespace-insensitive keyword dedupe`

---

### Task N7: chat handler·deps — RPC 새 칸·응답·목록·로그·해시 고정

**Files:**
- Modify: `supabase/functions/chat/handler.ts`, `supabase/functions/chat/deps.ts`, `supabase/tests/chat-agg-handler.test.ts`, `supabase/tests/chat-agg-filters.test.ts`
- Create: `supabase/tests/_old/chat-aggregate-0170.ts`(0.17.0 사본 — K26), `supabase/tests/chat-agg-rollback.test.ts`

**Interfaces:**
- Consumes: N6 `AggCounts`·`okAggregate`.
- Produces:
  - 입력 타입(K28 — 새 칸은 전부 optional): `export type AggRpcItem = AggItem & { count?: number | null }`, `export type AggRpc = { total: number; body_total?: number; metric_items?: number; metric_unmatched?: number; buckets?: (BucketCount & { body?: number })[]; value?: number; items?: AggRpcItem[] }`. `ChatDeps.aggregate(...)`: `Promise<AggRpc>`(deps.ts는 `data as AggRpc` — 채우지 않는다). `AggItem`은 그대로, `ChatDeps` 필수 멤버는 늘리지 않는다 — 기존 가짜(F10)의 `{ total, buckets }`·`count` 없는 줄이 고치지 않고 타입 검사를 통과한다.
  - `export function toAggCounts(r: AggRpc): AggCounts`(handler.ts) — `{ total: r.total, body_total: r.body_total ?? r.total, metric_items: r.metric_items ?? 0, metric_unmatched: r.metric_unmatched ?? 0, buckets: (r.buckets ?? []).map((b) => ({ key: b.key, count: b.body ?? b.count })) }`(K8·K26 — 막대 값은 칸 `body`, 없으면 칸 `count`). 정규화 뒤 `AggCounts`만 필수.
  - `/chat` 응답 `aggregate.body_total`(N6), 로그 `agg_log`에 `metric_items`·`metric_unmatched`(ok일 때 RPC 값, 그 밖 0).
  - `/chat/aggregate` 응답 `{status, bucket_key, label, total, value, items: (AggItem & { count: number | null })[], truncated}` — `value: r.value ?? r.total`, 줄 `count: x.count ?? null`. 로그 그대로(`bucket`·`total`).

- [ ] **Step 1: 실패하는 테스트(`chat-agg-handler.test.ts`)** — 기존 `adeps({ rpc })` 가짜에 RPC 반환을 지정해 쓴다.

```ts
Deno.test("aggregate with metrics: RPC body fields → response body_total 37, buckets/top body values, sentence with '· 본문 기준 37건', log metric_items/metric_unmatched only", async () => {
  // rpc 반환 { total: 12, body_total: 37, metric_items: 9, metric_unmatched: 1, buckets: [{key:"14",count:5,body:15},{key:"09",count:4,body:10},{key:"15",count:3,body:12}] }
  // → json.aggregate.body_total 37, top[0] {key:"14",count:15}(칸 body — 메시지 수 5가 아니다, K26), sentence 에 "메시지 12건 · 본문 기준 37건 — 14시대가 15건" 포함
  // 로그 줄 JSON 에 metric_items 9·metric_unmatched 1, 키워드·label 글자 없음
});
Deno.test("aggregate service name only: metric_items 0, metric_unmatched 4 → body_total null, 0.17.0 sentence, notes end with countedMessages", async () => { /* … */ });
Deno.test("aggregate on a 0035-shaped RPC result (no new fields) → body_total null, sentence byte-identical to 0.17.0", async () => {
  // rpc 반환 { total: 3, buckets: [{key:"14",count:3}] } → aggregate.body_total null, sentence === 0.17.0 기대 문장(기존 테스트의 같은 시드 값)
});
Deno.test("/chat/aggregate: value and per-line count passed through; 0035 shape → value = total, count null", async () => {
  // rpc 목록 { total: 2, value: 7, items: [{…b, count: null}, {…a, count: 6}] } → json.value 7, items.map(count) [null, 6], truncated false
  // rpc 목록 { total: 2, items: [b, a](count 없음) } → json.value 2, items.map(count) [null, null]
});
```

`chat-agg-rollback.test.ts`(구 chat 조합, K26 — Review Focus 6). 사본은 `git show 162281f:supabase/functions/chat/aggregate.ts`에서 import 두 줄의 `"../_shared/`만 `"../../functions/_shared/`로 바꾸고 맨 위에 `// 0.17.0 사본(162281f) — 구 chat 조합 테스트 전용, 고치지 않는다` 한 줄을 더한다(그 밖 바이트 그대로 — Step 3에서 `diff <(git show 162281f:supabase/functions/chat/aggregate.ts) supabase/tests/_old/chat-aggregate-0170.ts`가 그 세 줄만):

```ts
import { okAggregate as okAggregate0170 } from "./_old/chat-aggregate-0170.ts";
Deno.test("old chat (0.17.0 aggregate.ts) on a 0036 result with metrics → 0.17.0 message-count sentence, identical to the no-metrics result", () => {
  const C = { keywords: ["합성결제", "타임아웃"], sender: null, sources: [], from: "2026-10-22", to: "2026-10-22", bucket: "hour" as const, defaulted: false, clamped: false };
  // N2 롤백 조합 사례의 r1·r0 모양(키만 오늘 날짜로)
  const withM = { total: 3, body_total: 10, metric_items: 2, metric_unmatched: 0, buckets: [{ key: "14", count: 1, body: 6 }, { key: "15", count: 1, body: 3 }, { key: "16", count: 1, body: 1 }] };
  const noM = { total: 3, buckets: [{ key: "14", count: 1 }, { key: "15", count: 1 }, { key: "16", count: 1 }] };
  const s = (r: { total: number; buckets: { key: string; count: number }[] }) => okAggregate0170(C, r.buckets, r.total, [], "2026-10-22").sentence;   // 0.17.0 handler 호출 모양(F9)
  assertEquals(s(withM), s(noM));
  assertEquals(s(withM), "10/22 '합성결제·타임아웃' 메시지 3건 — 14시대·15시대·16시대가 각각 1건으로 가장 많았어요");
  assert(!s(withM).includes("6건"));
});
```

`chat-agg-filters.test.ts`에 0.17.0 요청 해시 고정을 더한다(F6, 필터 불변 단언):

```ts
Deno.test("0.17.0 agg filter requests unchanged in 0.18.0 (fixed hashes)", async () => {
  assertEquals(await sha(filterRequest("q", "2026-10-21", [], true, null, { previous: null })), "e53044ad14ea0035bb3afecdfaf9fd224ceb77679b48ee92f379b0c0bfa76900");
  assertEquals(await sha(filterRequest("날짜별로는?", "2026-10-21", ctx1, true, null, { previous: prev })), "392b46285c4bb39532250961e20dd75001c491c003e3f5460df8cbe80da53ea2");
});
```

Run: `deno test --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/tests/chat-agg-handler.test.ts supabase/tests/chat-agg-filters.test.ts`
Expected: 새 handler 테스트 FAIL, 해시 테스트는 PASS(지금 값의 고정 — 이후 회귀 감시).

- [ ] **Step 2: 구현** — Interfaces 그대로. `runAggregate`가 RPC 반환을 `AggCounts`로 바꿔 `okAggregate`에 넘긴다. `handleAggregateList`가 `value`·줄 `count`를 싣는다.
- [ ] **Step 3: 통과 확인** — `deno test --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/tests/chat-agg-handler.test.ts supabase/tests/chat-agg-filters.test.ts supabase/tests/chat-agg-rollback.test.ts supabase/tests/chat-agg.test.ts supabase/tests/chat.test.ts supabase/tests/chat-edit.test.ts supabase/tests/chat-rule.test.ts` 전부 PASS, `deno check supabase/functions/chat/index.ts supabase/tests/*.ts supabase/tests/_old/*.ts`, `git diff --stat -- supabase/tests/chat.test.ts supabase/tests/chat-edit.test.ts supabase/tests/chat-db.test.ts` 빈 출력(가짜 deps 무수정 컴파일 — K28), 사본 diff는 세 줄만.
- [ ] **Step 4: 커밋** `feat(chat): aggregate response body_total and bars from 0036 bucket body (optional RPC fields, 0035 shape tolerated), list value and per-line count, log metric_items/metric_unmatched; old-chat combo test on a 0.17.0 aggregate.ts copy; pin 0.17.0 filter request hashes`

---

### Task N8: `METRIC-eval` + 추출 회귀(실호출) → 출력 상한

**Files:**
- Create: `supabase/eval/metric-cases.json`, `supabase/scripts/_metric-eval.ts`, `supabase/scripts/eval-metric.ts`, `supabase/tests/metric-eval.test.ts`
- Modify(결과에 따라): `supabase/functions/_shared/extract-text.ts`(`RULE_MAX_OUTPUT_TOKENS` 한 줄 또는 `METRICS_RULE` 표현 — U2), `docs/superpowers/phase1/gates.md`, `docs/superpowers/poc/results.md`

**Interfaces:**
- Consumes: N3 `normalizeMetrics`, N4 `extractTextDetailed(…, { metrics: true })`·`RULE_MAX_OUTPUT_TOKENS`, `run-multi-event-eval.ts` `judge`(K20).
- Produces:
  - 사례 파일 `{ "_note", "cases": [{ id, group, time?, service, text, occurred_at, expect: [{label, count, at, at_body}], events?: [{starts}] }] }` — `group` ∈ `single`(12)·`multi`(10)·`sum_detail`(2)·`repeat`(2)·`cumulative_mixed`(1)·`counter`(2)·`tz`(4)·`none_plain`(2)·`none_money`(2)·`none_ratio`(2)·`none_cumulative`(1)·`mixed_max`(2) = 42. metrics 있는 33사례의 `time` ∈ `range`(12)·`point`(4)·`datetime`(4)·`none`(7)·`out_of_window`(2)·`tz`(4). 기대 metric 합 49(metrics 있는 33사례), 혼합 2사례는 일정 5 + metric 10씩. 서비스명 12종 이상·한 이름 4사례 이하. 스펙 §15에 문장이 적힌 사례(반례 2·누적 2·시간대 4)는 그 글 그대로.
  - `_metric-eval.ts`: `validateMetricCases(f): string[]`(구성·합계·서비스명 수·한 이름 ≤ 4·`expect` 모양 위반 목록), `judgeMetricCase(c, got: { metrics: Metric[]; events: string[]; status: "ok" | "incomplete" | "error"; output_tokens: number }): MetricRow`, `summarizeMetric(rows: MetricRow[], cap: number): { pass: boolean; checks: Record<"c1"|"c2"|"c2_extra"|"c3"|"c4"|"c5"|"c6"|"c7"|"c7_out"|"c7_tz"|"c8_done"|"c8_events"|"c8_metrics", string> ; cap: number; incomplete: string[]; max_mixed_output: number; max_mixed_output_incomplete: number }`(K25 — `max_mixed_output`는 완료된 실행만, 잘린 실행의 토큰은 `max_mixed_output_incomplete`·`incomplete` 사례 id로 따로), `judgeRegression(general: string[][], rule: string[][], ruleEmitted: number[]): { new_wrong: string[]; emitted: number; pass: boolean }`.
  - `eval-metric.ts --runs 2 [--cap n]`(METRIC-eval), `--regression --runs 2`(multi-event 24 × 일반·규칙 모드), `--mixed-only --runs 2 [--cap n]`(혼합 2사례만 — K25 재측정·확정 확인). `--cap`은 `ExtractOpts.cap`으로만 넘긴다(상수를 고치지 않고 잰다). 출력은 사례 id·그룹·불리언·개수·토큰·status·cap만.

- [ ] **Step 1: 실패하는 테스트(`metric-eval.test.ts`)**

```ts
Deno.test("validateMetricCases: committed file passes; dropping a case, a 5th use of one service name, or a wrong expect total fails", async () => {
  const f = JSON.parse(await Deno.readTextFile(new URL("../eval/metric-cases.json", import.meta.url)));
  assertEquals(validateMetricCases(f), []);
  assert(validateMetricCases({ ...f, cases: f.cases.slice(1) }).length > 0);
  const five = structuredClone(f); for (const c of five.cases.slice(0, 5)) c.service = "합성같은이름"; assert(validateMetricCases(five).length > 0);
  const extra = structuredClone(f); extra.cases.find((c: { group: string }) => c.group === "single").expect.push({ label: "x", count: 1, at: "2026-10-22T05:00:00.000Z", at_body: false });
  assert(validateMetricCases(extra).length > 0);
});
Deno.test("judgeMetricCase: label containment (spaces/case), count, at minute and at_body; one model metric used once (K19)", () => {
  const c = { id: "s1", group: "multi", time: "range", expect: [{ label: "타임아웃", count: 6, at: "2026-10-22T05:00:00.000Z", at_body: true }, { label: "타임아웃", count: 2, at: "2026-10-22T05:00:00.000Z", at_body: true }] };
  const r = judgeMetricCase(c as never, { metrics: [{ label: "결제 타임 아웃", count: 6, at: "2026-10-22T05:00:30.000Z", at_body: true }], events: [], status: "ok", output_tokens: 80 });
  assertEquals([r.matched, r.extra, r.time_ok, r.sum_ok], [1, 0, 1, false]);
});
Deno.test("summarizeMetric: one run under any threshold → pass false; thresholds 0 none-emit, ≥47/49, extra ≤1, sum ≥32/33, time ≥47/49, out 2/2, tz 4/4, mixed done 2/2 events 2/2 metrics ≥19/20", () => {
  // 합격 줄 하나(모든 사례 일치) → pass true; 같은 줄에서 none_plain 한 사례가 metric 1개 → pass false, checks.c1 "1 emitted"
});
Deno.test("summarizeMetric: incomplete mixed run → c8_done fails, its tokens go to max_mixed_output_incomplete and its id to incomplete, max_mixed_output counts completed runs only (K25)", () => {
  // 합격 줄에서 혼합 사례 m1 의 한 실행을 { status: "incomplete", output_tokens: 2048 } 로, 다른 실행 1500 → pass false, incomplete ["m1"],
  // max_mixed_output_incomplete 2048, max_mixed_output = 완료된 실행의 최대(1500 이하 값), cap 은 넘긴 값 그대로
});
Deno.test("judgeRegression: right in both general runs and wrong in any rule run → new_wrong; rule-mode metric emission ≤ 1/24", () => {
  assertEquals(judgeRegression([["ok", "ok"], ["ok", "kind"]], [["ok", "split"], ["ok", "ok"]], [0, 0]).new_wrong, ["0"]);
  assertEquals(judgeRegression([["ok", "ok"]], [["ok", "ok"]], [2]).pass, true);                    // 한 사례가 낸 것은 사례 1로 센다
});
```

(`judgeRegression`의 입력은 사례 색인별 `[run1, run2]` 판정 코드, `ruleEmitted`는 사례별 규칙 모드에서 metric을 낸 실행 수.)

Run: `deno test --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/tests/metric-eval.test.ts`
Expected: FAIL — 모듈·파일 없음.

- [ ] **Step 2: 사례 파일·판정·러너를 쓴다** — 받은 시각은 2026-10-22 전후, 러너는 사례마다 `today = receivedDay(occurred_at)`, `meta = { source: "MESSAGES", appName: null, title: null }`, `let usage = null; extractTextDetailed(text, meta, today, (u) => { usage = u; }, { metrics: true, ...(cap ? { cap } : {}) })` → `normalizeMetrics(out.metrics, occurred_at)`. **출력 토큰은 `onUsage`로 받은 값**이다 — `onUsage`는 파싱보다 먼저 불리므로(F4) `incomplete`로 던진 실행도 토큰이 남는다(K25). incomplete·throw는 `status`로 남긴다(그 사례는 metric 0개로 판정, 토큰은 `onUsage` 값). 혼합 사례 `events`는 `judge`와 같은 접두 규칙.

- [ ] **Step 3: 단위 테스트 통과** — Step 1 명령 PASS, `deno check supabase/scripts/eval-metric.ts`.

- [ ] **Step 4: 실호출(측정 창 밖, `vm_stat` 확인)**

Run: `deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/eval-metric.ts --runs 2`
Expected: 마지막 줄 `{"pass":…,"cap":2048,"incomplete":[…],"max_mixed_output":<n>,"max_mixed_output_incomplete":<m>}`. 상한 확정 절차(K25):
1. `incomplete`가 비어 있고 `n × 1.5 ≤ 2048`이면 상수 그대로 — ⑧은 이 실행으로 판정.
2. `incomplete`가 비어 있고 `n × 1.5 > 2048`이면 `RULE_MAX_OUTPUT_TOKENS = ceil(n × 1.5 / 256) × 256`으로 고친 뒤 3의 확인.
3. 혼합 사례가 잘렸으면(`incomplete`에 혼합 id) `--mixed-only --runs 2 --cap 4096` → 아직 잘리면 `--cap 8192`. 두 사례 2회가 모두 완료된 실행의 최대 출력 `n`으로 2의 식을 적용해 상수를 고친다. 8192에서도 잘리면 멈추고 메인에게(토큰·사례 id만). 혼합 아닌 사례가 잘리면 같은 절차를 그 사례에도 적용하고 보고한다.
4. 상수를 고쳤으면 `--mixed-only --runs 2`(`--cap` 없이 — 커밋할 상수 그대로)로 ⑧ 2/2를 확인한다. N5 예약 테스트는 상한과 무관하게 통과해야 한다(`deno test … supabase/tests/text.test.ts`).

Run: `deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/eval-metric.ts --regression --runs 2`
Expected: `{"new_wrong":[],"emitted":<≤1>,"pass":true}`.

미달이면 U2: `METRICS_RULE`의 표현만 고쳐(스펙 지시문을 바꾸게 되므로 **고친 글을 스펙 §7에도 같은 커밋으로 반영**하고 메인에 보고) 두 명령을 다시, 최대 2회.

- [ ] **Step 5: 기록·커밋** — `results.md`에 METRIC-eval 판정표(①~⑧ 회차별 값, 출력 토큰 최대·평균, 잘린 실행과 그 토큰·재측정 상한(K25), 상한 결정), 추출 회귀 표. `gates.md` 행 `METRIC-eval`·`METRIC-regress`(통과·실패, 숫자만).

```bash
git add supabase/eval/metric-cases.json supabase/scripts/_metric-eval.ts supabase/scripts/eval-metric.ts supabase/tests/metric-eval.test.ts docs/superpowers/phase1/gates.md docs/superpowers/poc/results.md   # 상한·지시를 고쳤으면 + extract-text.ts (+ 스펙)
git commit -m "feat(eval): METRIC-eval 42 synthetic alerts x2 (counter-examples, repeats, cumulative, time zones, mixed max) and extraction regression 24 x general/rule x2 — <결과 한 줄>

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task P1: EruriCore `ChatAggregate` + 카드 한 줄 + 업로드 가드

**Files:**
- Modify: `ios/Packages/EruriCore/Sources/EruriCore/ChatAggregate.swift`, `ios/Packages/EruriCore/Tests/EruriCoreTests/ChatAggregateTests.swift`, `ios/App/AggregateCard.swift`(111행 한 줄), `ios/scripts/version-guard.sh`

**Interfaces:**
- Produces:
  - `Response.body_total: Int?`(관대한 디코드 `decodeIfPresent`, init 인자 기본값 nil — 합성 Encodable이 턴 저장에 싣는다).
  - `ListResponse.value: Int?`, `ListItem.count: Int?`.
  - `public static func headerCount(_ r: ListResponse) -> Int` = `r.value ?? r.total`.
  - `line(_:)`의 `meta`에 `count`가 있으면 `" · \(count)건"`(K21).
  - version-guard 0.18.0(K22).

- [ ] **Step 1: 실패하는 테스트**

```swift
func testDecodesWithoutNewFields() throws {          // Review Focus 4 — 0.17.0 서버 응답·저장 턴
  let r = try JSONDecoder().decode(ChatAggregate.Response.self, from: Data(#"{"status":"ok","total":3,"buckets":[],"top":[],"sentence":"s","notes":[]}"#.utf8))
  XCTAssertNil(r.body_total)
  let l = try XCTUnwrap(ChatAggregate.decodeList(Data(#"{"status":"ok","bucket_key":"14","label":"14시","total":2,"items":[{"item_id":"a","title":"t","sender":null,"source":"MESSAGES","app_name":null,"occurred_at":"2026-10-22T05:12:00Z"}],"truncated":false}"#.utf8)))
  XCTAssertEqual(ChatAggregate.headerCount(l), 2); XCTAssertNil(l.items[0].count)
}
func testHistoryRoundTripKeepsBodyTotal() throws {
  let r = ChatAggregate.Response(status: "ok", conditions: nil, total: 12, buckets: [], top: [], sentence: "s", notes: [], body_total: 37)
  XCTAssertEqual(try JSONDecoder().decode(ChatAggregate.Response.self, from: JSONEncoder().encode(r)).body_total, 37)
}
func testListHeaderUsesValue() throws {
  let l = try XCTUnwrap(ChatAggregate.decodeList(Data(#"{"status":"ok","bucket_key":"14","label":"14시","total":2,"value":7,"items":[],"truncated":false}"#.utf8)))
  XCTAssertEqual(ChatAggregate.listHeader(bucket: "hour", label: l.label, total: ChatAggregate.headerCount(l)), "14시대 7건")
}
func testLineAppendsCountOnlyWhenPresent() throws {
  let json = #"{"status":"ok","bucket_key":"14","label":"14시","total":2,"value":7,"truncated":false,"items":[{"item_id":"a","title":"합성 알림","sender":null,"source":"MESSAGES","app_name":null,"occurred_at":"2026-10-22T05:12:00Z","count":6},{"item_id":"b","title":"합성 알림2","sender":null,"source":"MESSAGES","app_name":null,"occurred_at":"2026-10-22T05:40:00Z","count":null}]}"#
  let r = try XCTUnwrap(ChatAggregate.decodeList(Data(json.utf8)))
  XCTAssertEqual(ChatAggregate.line(r.items[0]).meta, "문자 · 10/22 14:12 · 6건")
  XCTAssertEqual(ChatAggregate.line(r.items[1]).meta, "문자 · 10/22 14:40")
}
```

`version-guard.sh` 확인(테스트 대신 Run): `body_total`이 든 상태에서 `MARKETING_VERSION: 0.17.0`이면 멈춤 문구, `TF_ALLOW_PRE_METRIC=1`이면 통과.

Run: `cd ios && ./scripts/sim.sh gen && ./scripts/sim.sh test EruriCoreTests/ChatAggregateTests`
Expected: 새 테스트 FAIL(컴파일 오류 포함).

- [ ] **Step 2: 구현** — Interfaces 그대로. `AggregateCard.swift:111`의 `total: r.total` → `total: ChatAggregate.headerCount(r)`. 가드:

```bash
# 0.18.0 계획 K22: 본문 건수 코드(ChatAggregate 의 body_total)가 있는데 0.18.0 전 이름이면 멈춘다 — METRIC-sim 전 빌드가 0.17.x 이름으로 나가지 않게
if grep -q "body_total" Packages/EruriCore/Sources/EruriCore/ChatAggregate.swift && [ "$NUM" -lt 18000 ] && [ "${TF_ALLOW_PRE_METRIC:-0}" != 1 ]; then
  echo "본문 건수 코드가 있는데 MARKETING_VERSION=$VER (< 0.18.0) — METRIC-sim 통과 전 업로드 금지(0.18.0 계획 K22). 162281f worktree 에서 올리거나 TF_ALLOW_PRE_METRIC=1"
  exit 1
fi
```

- [ ] **Step 3: 통과 확인** — `./scripts/sim.sh test EruriCoreTests/ChatAggregateTests` PASS, `./scripts/sim.sh build` 성공(새 경고 0), `bash ios/scripts/version-guard.sh` → 멈춤 문구(0.17.0 이름), `TF_ALLOW_PRE_METRIC=1 bash ios/scripts/version-guard.sh` → `version-guard ok (0.17.0)`.
- [ ] **Step 4: 커밋** `feat(core): aggregate body_total, list value header and ' · N건' line suffix (lenient decode for 0.17.0 server and saved turns); version guard 0.18.0`

---

### Task D1: 배포 — 0036 → chat → worker → `METRIC-deploy`

**Files:**
- Move: `supabase/migrations-pending/0036_item_metrics.sql` → `supabase/migrations/`(`git mv`), `supabase/tests/_metric-sql.ts`의 `MIGRATION_0036` 경로
- Modify: `supabase/scripts/smoke-agg.ts`(K17 `--metrics`), `docs/superpowers/phase1/gates.md`

**Interfaces:**
- Consumes: N1~N8·P1 커밋.
- Produces: 배포된 0036·chat·worker, `smoke-agg.ts --metrics`.

- [ ] **Step 1: 선행 확인(하나라도 어긋나면 멈추고 메인에게)**

Run: `grep -n 'METRIC-eval\|METRIC-regress' docs/superpowers/phase1/gates.md; ls supabase/migrations-pending/; supabase migration list 2>/dev/null | tail -2; pgrep -x xcodebuild || echo none; vm_stat | grep -E 'free|compressor'`
Expected: 두 행 통과, pending에 `0036_item_metrics.sql`만, 원격 마지막 = 0035, xcodebuild 없음.

- [ ] **Step 2: 전체 로컬 테스트 → `METRIC-unit` 근거**

Run: `deno test --allow-net --allow-env --allow-read --allow-write=/tmp --env-file=supabase/.env supabase/tests/ --ignore=supabase/tests/agg-db.test.ts,supabase/tests/metric-db.test.ts && deno check supabase/functions/{worker,chat,mail-read,mail-action,gmail-connect,unsubscribe,gmail-webhook,ingest,account}/index.ts supabase/scripts/*.ts supabase/tests/*.ts supabase/eval/*.ts`
Expected: 0 실패(0035 미적용 시절처럼 호스팅 테스트가 0036 미적용으로 실패하면 그 이름만 적고 Step 3 뒤 다시), 타입 오류 없음. 앱 단위 수는 P1 결과를 인용.

- [ ] **Step 3: 호스팅 롤백 테스트 → 0036 적용**

Run: `METRIC_DB_TEST=1 deno test --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/tests/metric-db.test.ts`
Expected: `0036 applied in the rolled-back transaction`, AGG_CASES·METRIC_CASES 전부 ok(`localOnly` 제외, `hybrid_search` 대소문자 사례 포함).

Run: `git mv supabase/migrations-pending/0036_item_metrics.sql supabase/migrations/ && sed -i '' 's#../migrations-pending/0036_item_metrics.sql#../migrations/0036_item_metrics.sql#' supabase/tests/_metric-sql.ts && rmdir supabase/migrations-pending 2>/dev/null; supabase db push --dry-run`
Expected: 적용 대상 `0036_item_metrics.sql` 하나뿐. 아니면 멈춘다.

Run: `supabase db push --yes && METRIC_DB_TEST=1 deno test --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/tests/metric-db.test.ts supabase/tests/metric-sql.test.ts supabase/tests/text-db.test.ts && AGG_DB_TEST=1 deno test --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/tests/agg-db.test.ts`
Expected: `0036 already applied` + 사례 전부(롤백 조합 포함), 0.17.0 AGG 호스팅 사례 회귀 없음(배포 조합), text-db 통과.

```bash
git add supabase/migrations/0036_item_metrics.sql supabase/tests/_metric-sql.ts
git commit -m "chore(db): move 0036 item metrics into supabase/migrations/ and apply it (hosted rolled-back METRIC and AGG cases passed)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 4: U1′(K16)**

Run: `METRIC_DB_TEST=1 METRIC_U1=1 deno test --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/tests/metric-db.test.ts --filter U1`
Expected: `{u1prime_ms:[…], p95:<2000, pre_analyze_ms:…, audit_ids:6}` 한 줄, 정리 뒤 실행 태그 항목 0·모은 감사 id 행 0(K29). p95 ≥ 2000이면 U4대로 멈춘다.

- [ ] **Step 5: chat 배포 → 스모크(구 worker) → worker 배포 → 스모크(+metrics)**

`smoke-agg.ts`에 `--metrics`를 더한다(K17·K30): 기존 ①~⑥ 뒤 ⑦ — 전용 키워드 `m<RUN8>합성PAY`(①~⑥의 `KW`와 겹치지 않아 기여분이 이 한 건뿐)의 keyword 규칙을 테스트 사용자 22에 `/chat/rule`로 더한 뒤 `/ingest` "[m<RUN8>합성PAY] 14:00~14:10 타임아웃 6건, 오류 2건"(받음 오늘 서울 14:12 — 그 전이면 어제 날짜로 넣고 질문도 "어제") → 처리 대기 → 그 항목 `item_metrics` 행 **정확히 2**·`at_body` 2(숫자만) → `/chat` "오늘 m<RUN8>합성PAY 타임아웃 언제 많았어?"(intents 0.17.0 여덟) → `status` ok·`conditions.bucket` hour·`total` **1**·`body_total` **6**·0 아닌 칸 정확히 `[{key:"14", count:6}]`·`top[0]` `{14, 6}`·문장에 "1건 · 본문 기준 6건 — 14시대가 6건으로 가장 많았어요" 포함 → `/chat/aggregate` 칸 "14" → `total` 1·`value` **6**·줄 1개·줄 `count` **6** → `/chat` "오늘 m<RUN8>합성PAY 오류 언제 많았어?" → `body_total` **2**. 하나라도 다르면 그 단계 이름과 숫자로 실패(오류를 타임아웃에 합친 8, 메시지 수 1로 남은 막대 등이 여기서 걸린다). 출력은 단계·상태·숫자·불리언만. 정리: 기존 `finally`(실행 태그 항목 cascade로 metrics도 지워진다) + 이번에 더한 규칙만 삭제.

Run: `supabase functions deploy chat && deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/smoke-agg.ts`
Expected: ①~⑥ 0.17.0 기대값 그대로(새 chat + 구 worker + 0036, metrics 0행).

Run: `supabase functions deploy worker && deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/smoke-agg.ts --metrics`
Expected: ①~⑦ 모두 정확한 기대값(K30), 정리 뒤 남은 행 0(항목·metrics·규칙).

- [ ] **Step 6: 기록·커밋** — `gates.md` 행 `METRIC-unit`(Step 2 deno 수 + P1 앱 수), `METRIC-db`(PGlite + 호스팅 + U1′ p95), `METRIC-deploy`(배포 시각·함수 버전·HEAD·스모크 결과).

```bash
git add supabase/scripts/smoke-agg.ts docs/superpowers/phase1/gates.md
git commit -m "chore(deploy): 0.18.0 server deploy — 0036 applied, chat then worker deployed; smoke-agg old-worker regression and --metrics (rule item metrics saved, body_total in the sentence) on test user 22

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task G1: `METRIC-sim` ①~⑦ → 0.18.0

**Files:**
- Modify: `supabase/scripts/seed-agg.ts`(`--phase metrics|metrics-status|metrics-rpc`), `ios/project.yml`(`MARKETING_VERSION: 0.18.0` — 통과 뒤), `docs/superpowers/phase1/gates.md`
- Create(커밋 안 함): 게이트 전용 XCUITest 임시 타깃(`.context/gate0180/`)

**Interfaces:**
- Consumes: D1 배포, P1 앱.
- Produces: `seed-agg.ts --phase metrics`(테스트 사용자 23 — 키워드 규칙 "합성결제"가 없으면 `/chat/rule add`, 스펙 §15 METRIC-sim A~E 다섯 건을 `/ingest`로 오늘 받은 시각 A 14:12·B 15:05·C 10:01·D 16:20·E 11:40, 처리 대기 후 상태 수만), `--phase metrics-status`(항목별 `item_metrics` 행 수·`at_body` 수만 — 기대 A 2/2·B 1/0·C 1/1·D 0/0·E 1/0), `--phase metrics-rpc --keywords <k,…>`(같은 조건 `aggregate_items` 숫자만: total·body_total·칸 `count`(메시지 수)·`body`), 0.18.0 버전 커밋.

- [ ] **Step 1: 준비** — 서울 16:25 이후(K18, `TZ=Asia/Seoul date +%H%M` ≥ 1625), `vm_stat`, `pgrep -x deno` 없음, 전용 UDID `ERURI gate0180`에 0.18.0 코드 앱 설치·테스트 사용자 23 로그인, `seed-agg.ts --phase metrics` → 5건 `kept`, `--phase metrics-status`가 기대 행 수와 같음(다르면 스펙대로 실패 기록 + 그 문장을 METRIC-eval 사례에 더해 지시 수정 경로 — 메인에게).
- [ ] **Step 2: 스펙 §15 METRIC-sim ①~⑦을 화면에서** — 문구·숫자는 스펙 그대로(① "… 메시지 5건 · 본문 기준 15건 — 14시대가 6건으로 가장 많았어요", 막대 9·11·14·15·16시 = 4·1·6·3·1 / ② 0.17.0 문장 "… 메시지 5건 — 5개 칸이 각각 1건으로 가장 많았어요" + 꼬리 ③ / ③ 띄어 쓴 질문 = ①과 같은 5건·15건 / ④ 14시 탭 → 머리 "14시대 6건"·줄 A " · 6건" / ⑤ 16시 탭 → 줄 D 접미 없음 / ⑥ ①의 숫자 = `--phase metrics-rpc --keywords 합성결제,타임아웃`(카드 막대 = 칸 `body`, 문장 메시지 수 = `total`) / ⑦ "… 메시지 1건 · 본문 기준 20건 — 11시대가 20건으로 가장 많았어요"). 판정 근거 = 화면 식별자(`agg-*`)·DiagLog 코드·RPC 숫자.
- [ ] **Step 3: 통과 뒤 버전** — `ios/project.yml` `MARKETING_VERSION: 0.18.0`, `bash ios/scripts/version-guard.sh` → `version-guard ok (0.18.0)`.
- [ ] **Step 4: 정리** — `seed-agg.ts --phase cleanup`(실행 태그 항목과 그 jobs(`payload->>item_id`)·테스트 사용자 23 규칙), 남은 행 0.
- [ ] **Step 5: 기록·커밋**

```bash
git add supabase/scripts/seed-agg.ts ios/project.yml docs/superpowers/phase1/gates.md
git commit -m "chore(ios): 0.18.0 after METRIC-sim ①–⑦ on the simulator (test user 23)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task G2: TestFlight 0.18.0 → `METRIC-real`(실기기)

**Files:**
- Modify: `docs/superpowers/phase1/gates.md`

- [ ] **Step 1: 업로드** — `cd ios && ./scripts/testflight.sh`(빌드 번호 `date +%Y%m%d%H%M`), VALID 확인. `gates.md`에 배포 날짜를 적고 기한 = 배포일 + 14일.
- [ ] **Step 2: 대기** — 저장 규칙 항목 중 본문에 건수가 적힌 알림이 새로 들어왔는지 메타데이터로만 본다(실사용자 `item_metrics` 행 수 > 0 — label·숫자 없음). 기한 안에 0이면 멈추고 메인에게(스펙: 사용자와 다시 정한다).
- [ ] **Step 3: 사용자 세션** — 스펙 §15 METRIC-real 그대로: "이번 주 PINPAY 타임아웃 언제 많았어?"(또는 그 알림의 키워드) → 문장 "본문 기준 N건"·막대 → 최다 막대 탭 → 사용자가 줄 " · N건"이 본문 건수와 맞는지 확인(틀린 줄 0) → 에이전트는 같은 조건 `aggregate_items` 숫자만 비교.
- [ ] **Step 4: 기록·커밋** — `gates.md` 행 `METRIC-real`(통과·실패, 숫자·불리언만). 커밋 `docs(gates): METRIC-real on device (0.18.0)`.

---

## 자체 점검 (2026-10-22)

**1. 스펙 대응** — §7 "본문 건수": 대상(N5 규칙·`skip_gate`·SHARE 제외) · 요청(N4 스키마·지시 한 줄·바이트 동일) · 출력 상한(N4 상수·N8 실측·N5 예약) · 정규화(N3 전부, 오프셋·검증 경계 포함) · 저장 순서·빈 배열·재시도(N5·N1) · 로그(N5) · 하지 않는 것(재추출 없음 — 태스크 없음). §8 `item_metrics`·0036 두 함수·회수·cascade(N1·N2). §9 재검증 ① 공백 중복 제거(N6) · RPC 공백 키워드(N1) · 메시지 값·발생 시각·후보 창·보고된 합·RPC 반환(N2) · 응답·문장·꼬리 ③(N6·N7) · 목록 `value`·`count`(N2·N7·P1) · 앱 0.18.0(P1) · 필터 불변(N7 해시) · 로그(N5·N7). §12 로그 개수만(Global·N5·N7). §15 METRIC-unit ①(N4)·②(N3)·③(N5)·④(N6·N7)·⑤(P1) · METRIC-db(N1·N2·D1 — 공백·대소문자·`hybrid_search`·본문 기준·반례·발생 시각·배포 조합·U1′) · METRIC-eval·추출 회귀(N8) · METRIC-sim(G1) · METRIC-real(G2) · 배포 순서(D1).

**2. 자리표시자** — "TBD·적절히" 없음. N2 Step 1 첫 사례의 세 키워드 기대는 키워드 AND 선택 규칙으로 계산해 본문에 `{ total: 2, body_total: 28 }`로 확정했다. 주석만 있는 사례(`/* … */`)는 모두 입력과 기대 숫자를 주석에 적었다 — 구현자는 그 값을 단언으로 옮긴다(Global "빈 사례 금지"). 게이트 기록의 시각·버전·p95는 실행 결과 칸.

**3. 이름·타입 일관성** — `Metric`·`normalizeMetrics`(N3)를 N5·N8이, `ExtractOpts`·`RULE_MAX_OUTPUT_TOKENS`·`METRICS_RULE`(N4)를 N5·N8이, `AggCounts`·`AGG_TEXT.countedMessages`(N6)를 N7이, SQL 칸 `body_total`·`metric_items`·`metric_unmatched`·`value`·줄 `count`(N2)를 N7·P1이 같은 이름으로 쓴다. `saveMetrics`는 TS 의존성 이름(N5), SQL은 `worker_save_metrics`(N1), 테스트 도우미 `saveMetrics(c, …)`(N1 `_metric-sql.ts`) — 파일이 달라 겹치지 않는다.

**4. Review Focus** — 여섯 줄 모두 소유 태스크에 테스트가 있다: ① N2 `label match ignores spaces and case` ② N2 `two matched rows in one bucket` ③ N2 `list follows occurrence day` ④ P1 `testDecodesWithoutNewFields`·`testHistoryRoundTripKeepsBodyTotal` ⑤ N1 `worker_save_metrics overwrites` + N5 `retry after saveFacts throws` ⑥ N2 `rollback combo` + N7 `old chat (0.17.0 aggregate.ts)`.

**5. 분량** — SQL은 알고리즘이 시그니처로 정해지지 않는 `aggregate_items` 구조와 시각 규칙만 적었고, 나머지는 시그니처·사례·스펙 문구다.

**6. Codex 계획 리뷰(2026-10-22, 메인 판정 6건)** — P-H1 → K25(N4 `cap`·N5 `reserveOutputTokens` 분리 테스트·N8 잘린 실행 토큰 회수·재측정 절차) · P-H2 → K26(스펙 §8·§9·§15 먼저, N2 칸 `count`/`body`·롤백 조합 사례, N1 `legacy`, N7 `toAggCounts`·구 chat 사본 테스트) · P-M1 → K27(N2 기대 4) · P-M2 → K28(N7 `AggRpc` optional) · P-M3 → K29(U1′ 감사 id) · P-M4 → K30(D1 스모크 전용 키워드·정확 숫자). Review Focus 6 추가.

**실행 방식:** SQL 반환 모양 → chat 문장 → 앱 줄로 숫자가 이어지고 잘못 나가면 막대·문장이 부풀어 보이는 기능이라 **Subagent-driven**(태스크마다 구현 pane + 리뷰, 끝에 전체 리뷰)을 권한다(AGENTS.md §2, memory "계획 리뷰: Codex → Fable → SDD").
