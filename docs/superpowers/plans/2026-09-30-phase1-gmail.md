# ERURI 1단계 Gmail 게이트 계획 (M1-③b 후반 · M1-③c)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 제품 프로젝트 `eruri`에 사용자 Gmail을 연결하고(T0), PoC-6에서 흡수한 Gmail 실측 게이트 — 백필 중 웹훅→sync ≤ 1분(5회 평균)·watch 갱신(수동+cron)·OTP·카드 규칙 메일·백필 누락 0·T0+6일 `expiring` 푸시·T0+8일 `invalid_grant`→`reauth_required`→재연결 뒤 누락 0 — 를 실제로 재서 기록하고 PoC-6을 마감한다.

**Architecture:** 서버·앱 코드는 이미 배포돼 있다(M1-③a `0005`~`0009`, M2 `0012`~`0016`, 앱 0.5.0). 이 계획은 (1) 게이트 스크립트 `gmail-gate.ts`를 원장·보고서에서 확인한 측정 함정(연결 직후 sync의 `via:webhook` 오표기, 실패 sync 백오프 중 웹훅 합쳐짐, PostgREST 1000행 상한, 백필 예산 미룸)에 맞게 고치는 코드 태스크 1개와 (2) 사용자 조작과 에이전트 조회를 분리한 실측 태스크 4개로 이뤄진다. 실측 태스크는 제품 코드를 바꾸지 않는다 — 게이트가 실패하면 원인을 적고 별도 수정 태스크를 만든다.

**Tech Stack:** Deno 2.7(스크립트·테스트), Supabase 호스팅(Postgres 17, pg_cron, PostgREST), `npm:@supabase/supabase-js@2`, Gmail API v1, Google Pub/Sub push(`gmail-push-eruri`), ERURI 앱 0.5.0(빌드 202609302012, GoogleSignIn-iOS 8), APNs.

**Spec:** `docs/superpowers/specs/2026-09-22-assistant-design.md` — §5(Gmail 경로·7일 재인증), §7(jobs 우선순위·백필 레인·Gmail 동기화·재인증 푸시), §13(백필 예산·임베딩 월 예산·LLM 동시 2), §14(PoC-6 판정 현황), §15 ③(게이트 문구), §16(Gmail 7일 재인증, 2026-09-30 판정 14·10). 실행 규칙은 `AGENTS.md` §5-8(실측 게이트)·§6(기계)·§7(개인정보·테스트 데이터).

**출발점:** `docs/superpowers/plans/2026-09-30-phase1.md`의 Task M1-③b Step 4~7과 Task M1-③c. M1-③b Step 1~3(U8 iOS 클라이언트 `eruri-ios`, U9 구독 `gmail-push-eruri` 인증 확인, 0.5.0 업로드, `gmail-gate.ts` 커밋 `6597874`)은 끝났다(`.superpowers/sdd/2026-09-30-phase1/task-M1-3b-report.md`). 원장 `.superpowers/sdd/2026-09-30-phase1/progress.md`의 Ruling 14·C·E·M#·G와 M1-③a 이월 사항을 반영했다.

**태스크 번호:** 1단계 계획의 ③b·③c를 이어서 `M1-③b1`(도구) · `M1-③b2`(연결·백필 중 지연) · `M1-③b3`(백필 완료·규칙·누락·watch·③b 기록) · `M1-③c1`(T0+6일) · `M1-③c2`(T0+8일·재연결·PoC-6 마감)로 나눈다. 원장에는 `M1-3b1`처럼 적는다.

### 원 계획 대비 바뀐 점

| 원 계획(1단계 계획 M1-③b Step 4~7, M1-③c) | 이 계획 | 근거 |
|---|---|---|
| T0 = 사용자가 연결한 시각 | T0 = `connections.expires_at − 7일`(refresh token을 저장한 순간, `status`가 출력). `refresh_token_stored=false`면 재동의 후 그 시각 | `gmail_save_connection`은 refresh token이 있을 때만 `expires_at`을 쓴다(0001). PoC와 같은 Web 클라이언트라 이전 동의가 남아 있을 수 있다 |
| 합성 메일 5통, 1분 이상 간격 | 지연 측정 6통 + OTP 1 + 카드 1 = 8통. 간격은 백필 규모 N으로 정한다(N < 180 → 30초, N ≥ 180 → 65초) | 같은 계정 PoC-6 90일 백필 85건(09-27) → 백필 전체가 약 5~8분에 끝날 수 있어 "백필 중" 표본 5개가 안 모일 위험 |
| `latency`: `via:webhook` sync 전부를 표본으로 | 연결 직후 sync(표식 오표기) 제외, 실패·재시도 sync 제외·별도 보고, 백필 대기 중 표본만 평균, 요약에 `gate` | M1-③a 보고 우려 2(연결 sync `via:webhook`), fix r1 우려 2(백오프 중 웹훅은 새 잡이 안 생김) |
| — | `mails`: 합성 메일별 Gmail 수신→저장 지연(보조 지표) | 백오프로 합쳐진 웹훅은 sync 지연 표본에 드러나지 않는다 |
| `status`: 백필 대기 잡 수, 항목 상태 1000행까지 | 백필 레인 분류(진행·백오프·예산 미룸·LLM 대기·dead), 최근 연결의 백필 ID 수 N, 금액 사용량, T0, 전 행 페이지 | Ruling C(백필 예산 소진 → 다음 달), PostgREST 요청당 1000행 |
| watch 수동 갱신 뒤 "약 +7일" | `watch_expires_at ≈ 지금 + 7일`(연결 때 값보다 몇 분 늦어질 뿐), cron 뒤 ≈ cron 시각 + 7일 | watch 만료는 호출 시점 + 7일 |
| 누락 확인 `gap --after <T0 − 1일>` | 백필 완결성 `gap --after <T0 − 89일>`(90일 전체, 경계 1일 여유) | 백필 fetch 잡 dead·404는 90일 구간 전체에 영향 |
| ③c 공백 시작 = `reauth_required` 시각 − 1일 | 재연결 **전에** 기록한 `sync.last_success_at`(L) − 1일 | 재연결이 `cursor`와 `last_success_at`을 새 값으로 덮는다(0001 `gmail_save_connection`) — 공백 구간은 90일 재적재(Ruling 14)로만 복구 |
| 재연결 뒤 누락 0 | + 공백 메일 각 1행, 재적재가 이미 있는 항목에 `process` 잡을 만들지 않음 | Ruling 14 비용 = Gmail API 호출뿐임을 실측 |
| +6·+8일 | 날짜 계산표(T0 = 09-30이면 10-06·10-08) | — |

## Global Constraints

- **전제:** 앱 ERURI **0.5.0 (202609302012)** 설치(Google 클라이언트 값 `GIDClientID`·`GIDServerClientID` 포함, ③b 보고 검증), Apple 로그인 사용자 = `supabase/.env`의 `ERURI_USER_ID`, 기기 `devices` production 등록, Pub/Sub 구독 `gmail-push-eruri`(만료 없음, 인증 확인 09-30 20:11 KST). 제품 코드는 이 계획에서 바꾸지 않는다(Task ③b1은 `supabase/scripts/`·`supabase/tests/`만).
- **측정 기간(T0 ~ Task ③c2 완료) 금지:** 앱 설정 "Gmail 데이터 삭제 (연결 해제)"·"계정 전체 삭제"·로그아웃·앱 삭제·알림 끄기, ③c2 Step 4 전의 재연결, `delete_gmail_source`·`purge_*` 수동 실행, 실사용자 `items`·`jobs`·`connections` 수정. 예외는 이 계획이 적은 운영 호출(`gmail_enqueue_all(<kind>, ERURI_USER_ID)`)과 "스펙 확인 필요" 1이 승인된 경우의 보충 부하뿐이다. **M2-⑥b의 실기기 "Gmail 데이터 삭제" 확인은 ③c2 뒤로 미룬다**(연결이 지워지면 달력 게이트가 처음부터 다시 7일).
- **개인정보(AGENTS.md §7, 스펙 §12):** 스크립트·명령 출력과 기록에는 id·상태·개수·시각·불리언만. 실메일 본문·제목·발신자·계정 주소를 출력하지 않는다. 제목 조건은 **합성 접두**(`[합성 지연 테스트`·`[합성카드테스트]`·`[합성] 로그인`·`[합성 공백 테스트`)로만 쓰고 결과에 제목을 싣지 않는다. `gap`은 메시지를 메모리에서 규칙으로만 판정한다. `items.content_enc`를 복호화해 보지 않는다. 대시보드 로그를 기록에 붙일 때도 코드·id만.
- **메일 발송:** 합성 문구만, **보내는 주소 = 받는 주소 = 연결한 Gmail 계정**(본인 계정 외 발송 금지). 에이전트가 Gmail 커넥터(`send_message`)로 보내는 것은 Task ③b2 Step 2에서 사용자가 승인하고 커넥터 계정이 연결 계정과 같을 때만. Gmail 앱에서 **초안을 미리 만들어 두지 않는다**(초안도 메시지라 백필·history가 가져간다 — "스펙 확인 필요" 3).
- **명령:** 저장소 루트에서. 셸 상태가 호출 사이에 남지 않으므로 **각 셸 호출 앞에** 다음을 붙인다. `.env`를 `source`하지 않는다.

```bash
G="deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/gmail-gate.ts"
S="deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/sql.ts"
U="$(grep '^ERURI_USER_ID=' supabase/.env | cut -d= -f2)"
```

- **시각:** 명령 인자는 UTC ISO(`2026-09-30T12:00:00Z`), 사용자에게 보여 줄 때는 KST. cron은 UTC 기준: `gmail-watch-daily` `17 3 * * *`(12:17 KST), `gmail-sync-every-6h` `0 */6 * * *`(09·15·21·03시 KST), `gmail-reauth-hourly` `7 * * * *`, `worker-every-minute`.
- **테스트(Task ③b1):** `deno test --allow-net --allow-env --allow-read --env-file=supabase/.env <파일>`. 전 `pgrep -x xcodebuild`가 비어 있어야 하고 `vm_stat | grep -E 'free|compressor'`를 본다. 호스팅 DB 테스트는 전용 테스트 사용자·실행 태그 `test:<run>`만 만들고 지운다.
- **모델(AGENTS.md §3):** ③b1 `opus`/`high`(코드). ③b2·③b3·③c2 `opus`/`medium`(흡수 PoC 실측 판정 — 표본 규칙·원인 판정이 결과를 좌우). ③c1 `sonnet`/`medium`(조회·확인 위주).
- **기록:** `docs/superpowers/phase1/gates.md`(M1-③b·M1-③c 행), `docs/superpowers/poc/results.md` PoC-6 행, 스펙 §14 판정 현황 PoC-6 행(같은 값), ③c2에서 §16 "Gmail 7일 재인증" 줄. gates.md 커밋 칸은 자기 SHA라 비우고 메인이 채운다. 상태는 **통과·실패·대기**만("부분"은 마감 아님, AGENTS.md §5-8).
- **커밋:** 태스크마다. 트레일러 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. **push 금지**(메인이 회수 후 `git push origin main`).

## 이 계획이 기대는 사실 (코드·원장·보고서에서 확인, 2026-09-30)

| # | 사실 | 출처 |
|---|---|---|
| F1 | `gmail-connect`는 저장 → watch → 90일 목록(`newer_than:90d -category:promotions`, 페이지 100개)마다 백필 `gmail-fetch` 잡(lease `backfill:<user>`, `backfill:true`) → 마지막에 `gmail_enqueue_for_account`로 초기 sync. 이 sync에 `via:"webhook"`이 붙는다 | `gmail-connect/handler.ts`, 0005, M1-③a 보고 우려 2 |
| F2 | 우선순위 notify 10 · gmail-* 20 · process 30 · 백필 40. 백필 레인(fetch → process → embed)은 lease `backfill:<user>` 하나라 **직렬**, 같은 우선순위 안에서는 `created_at` 순. 워커는 매분 cron + 호출당 100초 동안 1건씩 클레임(인스턴스 최대 2개 겹침), 임대 180초, Edge 벽시계 150초 | 0005, `worker/index.ts`·`batch.ts`, M1-③a 보고 우려 1 |
| F3 | 실패한 잡은 `not_before = now + attempts × 60초`(60·120·180·240초). `gmail_enqueue_for_account`는 같은 연결에 queued sync가 있으면 새 잡을 만들지 않는다 → 백오프 중 도착한 웹훅은 그 잡에 합쳐지고 최대 4분 늦는다(누락은 없음, 커서 기반) | 0007, 0005, M1-③a fix r1 우려 2 |
| F4 | 백필 추출은 월 행 `backfill_reserved_krw` 상한 **1,500원**(Ruling C). 소진되면 `defer_job`으로 **다음 달 1일 00:00 KST**까지 미룬다(`last_error = budget_exhausted`, 실패 아님). 백필 항목 임베딩은 **월 예산**(`embed`, Ruling E, 0016). LLM 동시 호출 사용자당 2(`llm_slots`, 없으면 30초 미룸 `llm_busy`). Jev는 예약하지 않는다(Ruling 10) | 0014, 0016, `worker/text.ts`, `_shared/budget.ts` |
| F5 | 추출 입력은 본문 4,000자에서 자른다(`MAX_TEXT_CHARS`), 출력 상한 512토큰. 예약 추정 = (본문 길이 + 1,200) 입력 + 400 출력 토큰 | `_shared/extract-text.ts`, `worker/text.ts` |
| F6 | 백필 제안(수신이 수집보다 3일 이상 과거)은 푸시하지 않는다. 합성 메일(증분 sync)과 ③c2 공백 메일(재적재지만 1~2일 전 수신)은 제안 푸시가 간다 | 스펙 §7 notify |
| F7 | 재연결(`gmail_save_connection`)은 status → active, `expires_at = now + 7일`(refresh token이 있을 때), **`cursor`를 새 profile historyId로, `last_success_at = now()`로 덮는다**. 트리거가 그 연결의 `reauth_pushes`를 지운다(0008·0009). 이어서 90일 목록을 다시 넣는다(Ruling 14). 이미 있는 항목은 `insert_item`이 null을 돌려 `process` 잡을 만들지 않는다 | 0001, 0005, 0008·0009 |
| F8 | `reauth_required`인 동안 웹훅·6시간 cron·watch cron은 잡을 만들지 않는다(`status = 'active'` 조건). 재인증 대상: `expires_at < now + 24h`이고 active → `expiring`, `reauth_required` → `invalid_grant`. 창 키 = `expires_at` epoch 초. invalid_grant는 발생 즉시 `gmail_enqueue_reauth(p_user)`. 기기 0개면 기록을 풀고 매시 다시 | 0001, 0006, 0008, `_shared/gmail-jobs.ts`, `worker/reauth.ts` |
| F9 | 재인증 푸시 문구: 제목 "Gmail 다시 연결 필요", 본문 expiring "Gmail 연결이 24시간 안에 만료됩니다. 앱에서 다시 연결하세요." / invalid_grant "Gmail 연결이 끊겼습니다. 앱에서 다시 연결하세요." | `worker/reauth.ts` |
| F10 | 앱 설정 Gmail 절: 상태 줄("연결됨 · <주소>" / "다시 연결 필요 (<status>)"), "Gmail 연결", "다시 연결 (동의 다시 받기)"(GIDSignIn `disconnect()` 후 재동의). 연결 결과 줄에 `refresh_token_stored`·`backfill_messages`가 나온다 | `ios/App/ContentView.swift`, `ios/App/GoogleSignIn.swift` |
| F11 | `gmail-fetch`는 메시지마다 `messages.get(format=full)` + 240ms 쉼(분당 ≤ 250건), 10건마다 연결 존재 확인. `messages.get`이 404 등으로 실패하면 **잡 전체**가 실패·재시도(5회 뒤 dead) | `_shared/gmail-jobs.ts`, `_shared/gmail.ts` |
| F12 | Gmail API 쿼터(공식 문서 2026-09-30 확인): 프로젝트 분당 1,200,000 units, **사용자당 분당 6,000 units**. `messages.get` 20, `messages.list` 5, `history.list` 2, `watch` 100, `getProfile` 1 | developers.google.com/workspace/gmail/api/reference/quota |
| F13 | 같은 계정 PoC-6(09-27) 90일 백필 = 85 ID → 76행, `gmail-fetch` 1잡 67초(= 건당 약 0.8초) | `docs/superpowers/poc/results.md` PoC-6 상세 |
| F14 | PoC 프로젝트도 같은 Pub/Sub 토픽을 구독하고 같은 Web 클라이언트를 쓴다. 어느 코드도 `users.stop`을 부르지 않는다. PoC Gmail 연결의 refresh token은 10-04 경 만료 | results.md PoC-6, `_shared/gmail.ts`, Ruling 6 |

## 추정: 90일 백필 규모·시간·비용·Gmail 쿼터

N = 연결 시 90일 목록 ID 수(프로모션 제외). 기대값은 PoC-6 같은 계정 실측으로 **N ≈ 100**, 상한은 스펙 §13 가정 **N = 1,800**. 통과율 = 규칙·Jev 게이트를 지나 추출까지 가는 비율(미측정 → 50%~100% 범위로 둔다).

| 항목 | 건당 | N ≈ 100 | N = 1,800 |
|---|---|---|---|
| fetch 시간 | 약 0.8초(F13) | 약 1.3분 | 약 24분 |
| process 시간 | 추출 약 2.5초 / Jev 폐기 약 0.5초 | 2.5~4분 | 45~75분 |
| embed 시간 | 약 0.8초(추출·empty 항목만) | 약 0.7~1.3분 | 12~24분 |
| **백필 전체**(워커 가동률 ×1.2) | 약 N × 3~5초 | **약 5~8분** | **약 1.5~2.5시간** |
| 추출 비용(백필 예산 1,500원/월) | 실제 약 0.3~0.6원, 상한 약 1.1원(F5: 입력 ≤ 5.2k + 출력 ≤ 512토큰, `gpt-6-luna` $0.10/$0.50) | 15~60원 (상한 110원) | 270~1,080원 (**상한 약 1,980원 > 1,500원 → 초과분 다음 달로 미룸**) |
| 임베딩 비용(월 예산 1만원, Ruling E) | 약 0.25원(1.4k토큰 × $0.13/1M) | 약 13~25원 | 약 225~450원 |
| Jev(예약 없음) | 약 0.04원($0.00003) | 약 4원 | 약 76원 |
| 재연결 재적재(Ruling 14) | 이미 있는 항목은 LLM 0원 — Gmail API만 | Gmail만 | Gmail만 |
| 합성 메일 10통(월 예산) | 추출 약 0.5원 + 임베딩 0.25원 | 약 8원 | 약 8원 |

Gmail API(F12, 사용자당 분당 6,000 units):

| 호출 | units | N ≈ 100 | N = 1,800 |
|---|---|---|---|
| 연결: `getProfile` 1 + `watch` 100 + `messages.list` ⌈N/100⌉ × 5 | | 106 | 191 |
| 백필 fetch: `messages.get` N × 20 | 분당 ≤ 250건 → **≤ 5,000 units/분**(사용자 한도의 83%). PoC-6 실측 속도 76건/분 → 1,520 units/분(25%) | 2,000 | 36,000(≥ 7.2분에 걸쳐) |
| 증분: 메일 1통 = `history.list` 2 + `messages.get` 20 | | 22/통 | 22/통 |
| 매일 watch 100, 6시간 sync `history.list` 2~ | | 약 108/일 | 약 108/일 |
| 재연결(③c2) | 연결과 같음 | 2,106 | 36,191 |
| `gap` | `messages.list` 페이지 × 5 + **저장 안 된 ID만** `messages.get` × 20 | 수십~수백 | 90 + 규칙 폐기 수 × 20 |

결론: 쿼터 안이다. 프로젝트 한도(분당 120만)는 무관하다. 사용자 한도는 백필 fetch 단독으로 최대 83%까지 쓰므로 **백필 fetch 단계(레인에 `gmail-fetch`가 남아 있는 동안)에는 `gap`을 돌리지 않는다**. 겹쳐 429가 나면 fetch 잡이 실패·백오프하고(F3), 5회면 dead → 누락(F11)이다.

## 달력 (T0 기준, KST)

| 항목 | 규칙 | T0 = **2026-09-30(수) 21:00** 예 |
|---|---|---|
| watch cron 확인(③b3 Step 6) | T0 뒤 첫 12:17 KST(03:17 UTC) 이후 | **10-01(목) 12:17 이후** |
| `expiring` 푸시(③c1) | `expires_at − 24h` = T0 + 6일, 매시 :07 cron → T0 + 6일 + 1시간 안 | **10-06(화) 21:07 경**, 22:00 이후 확인 |
| refresh token 만료 | T0 + 7일(Google 테스트 모드) | 10-07(수) 21:00 경 |
| `reauth_required` 늦어도 | 만료 뒤 첫 refresh 시도: 웹훅 sync(메일 도착) 또는 6시간 cron(09·15·21·03시 KST) → T0 + 7일 + 6시간 안 | 10-08(목) 03:00 |
| ③c2 세션 | T0 + 7일 + 6시간 이후 아무 때(보통 T0 + 8일) | **10-08(목)** |

다른 T0: 10-01(목) → watch 10-02(금), +6일 10-07(수), +8일 10-09(금). 10-02(금) → watch 10-03(토), +6일 10-08(목), +8일 10-10(토). 연결 시각이 다르면 시·분을 그대로 옮긴다. T0가 09-30이면 백필 처리 금액이 9월·10월 두 월 행에 나뉜다(`seoul_month()`).

## Review Focus

1. **백필이 너무 짧아 "백필 중" 표본이 5개가 안 된다**(N ≈ 100이면 백필 5~8분): 사람은 "통과"를 기대하지만 표본 부족이 통과로 보이면 안 된다 → `summarize`가 `insufficient`를 돌려준다(③b1 테스트 "fewer than 5 … insufficient"), ③b2가 N으로 간격을 정하고 부족하면 "스펙 확인 필요" 1로 보충.
2. **연결 sync·재시도 sync가 표본을 오염한다**: 연결 직후 sync는 웹훅이 아닌데 `via:webhook`이고(F1), 실패한 sync의 백오프 중 웹훅은 새 잡이 안 생겨 지연이 표본에서 사라진다(F3) → `connectSyncIds`·`classify`(③b1 테스트 "connect sync"·"retried"), ③b2의 `mails` 보조 지표.
3. **refresh token 없이 연결됨**: 이전 동의가 남아 `refresh_token_stored=false`면 모든 Gmail 잡이 `skipped`인데 연결은 active로 보인다 → `t0Of(null) = null`(③b1 테스트), ③b2 Step 3이 `t0 = null`이면 재동의를 요구.
4. **백필 레인이 비지 않거나 조용히 잃는다**: 백필 예산 소진(F4)은 다음 달까지 queued, fetch 404·429 반복(F11)은 dead → "백필 끝" 판정이 이 둘을 진행 중과 구분해야 한다 → `backlog`(③b1 테스트 "budget-deferred and backoff … dead counted apart"), ③b3 Step 2 판정 규칙.
5. **재연결이 공백의 기준 시각을 지운다**: 재연결이 `last_success_at`·`cursor`를 덮어(F7) 공백 구간을 나중에 알 수 없다 → ③c2 Step 1이 재연결 **전에** L을 기록하고, Step 5가 `gap --after <L − 1일>`·공백 메일 각 1행·재처리 없음을 잰다.

---

## 파일 구조

```text
supabase/scripts/_gmail-gate.ts         # 신규(③b1) 판정 로직(순수): bursts·connectSyncIds·classify·summarize·backlog·mailDelays·t0Of
supabase/scripts/gmail-gate.ts          # 수정(③b1) run() 으로 감싸 테스트에서 호출. status 확장·latency 표본 규칙·mails·gap --q·1000행 페이지
supabase/tests/gmail-gate.test.ts       # 신규(③b1) 순수 테스트
supabase/tests/gmail-gate-db.test.ts    # 신규(③b1) 호스팅 DB — 테스트 사용자 합성 연결로 run() 호출
docs/superpowers/phase1/gates.md        # ③b2·③b3(M1-③b 행), ③c1·③c2(M1-③c 행)
docs/superpowers/poc/results.md         # PoC-6 행(③b3, ③c2)
docs/superpowers/specs/2026-09-22-assistant-design.md   # §14 PoC-6 행(③b3, ③c2), §16 Gmail 7일 재인증 줄(③c2)
```

## 사용자 작업 모음

| # | 언제 | 사용자가 할 일 | 태스크 |
|---|---|---|---|
| U10-0 | T0 직전 | TestFlight ERURI **0.5.0 (202609302012)** 확인, 설정 화면에서 "로그인됨"·권한(알림 허용) 확인. 합성 메일 발송 방식 선택: (A) 에이전트가 Gmail 커넥터로 본인 주소→본인 주소 발송 승인, 또는 (B) 직접 발송(메모 앱에 문구 준비, **Gmail 초안 금지**) | ③b2 |
| U10-1 | T0 | 설정 → **"Gmail 연결"** → Google 화면에서 **Gmail 읽기 권한 체크** → 결과 줄 확인. `refresh_token_stored=false`가 보이면 **"다시 연결 (동의 다시 받기)"** | ③b2 |
| U10-2 | T0 + 45초부터 | (B일 때) 합성 메일 8통을 시간표대로 본인 주소로 발송 | ③b2 |
| U10-3 | ③b2 측정 뒤 | 합성 메일 제안 알림은 무시, 앱 "제안" 탭 "전체 무시" | ③b2 |
| U11-1 | T0 + 6일 + 1시간 이후 | 잠금화면 "Gmail 다시 연결 필요 / …24시간 안에 만료…" 알림 확인. **재연결하지 않는다** | ③c1 |
| U11-2 | T0 + 8일(③c2) | "…Gmail 연결이 끊겼습니다…" 알림 확인 → (B일 때) 공백 메일 2통 발송 → 에이전트 신호 뒤 **"다시 연결 (동의 다시 받기)"** → 합성 제안 무시 | ③c2 |
| — | T0 ~ ③c2 끝 | 로그아웃·앱 삭제·알림 끄기·"Gmail 데이터 삭제"·"계정 전체 삭제" 하지 않기. ERURI 앱 알림만 판정에 쓴다(PoC 앱 알림은 무시) | 전체 |

### 합성 메일 문구 (보내는 주소 = 받는 주소 = 연결 계정)

| 코드 | 제목 | 본문 |
|---|---|---|
| L1~L6 | `[합성 지연 테스트 k]` (k = 1~6) | `10월 2k일 오후 4시 합성 미팅이 있습니다. ERURI 게이트 합성 메일입니다.` (k=1 → 21일 … k=6 → 26일) |
| O1 | `[합성] 로그인 인증번호` | `인증번호 482913 를 3분 안에 입력하세요` |
| C1 | `[합성카드테스트] 4532-0151-1283-0366 승인 32,000원` (Luhn 유효) | `합성 결제 알림 메일입니다.` |
| P1·P2 | `[합성 공백 테스트 1]`·`[합성 공백 테스트 2]` | `11월 1일 오전 10시 합성 점검` · `11월 2일 오전 10시 합성 점검` |

---

### Task M1-③b1: 게이트 도구 보강 — 표본 규칙·백필 레인 분류·합성 메일 지연·페이지

**모델:** `opus`/`high`

**Files:**
- Create: `supabase/scripts/_gmail-gate.ts`, `supabase/tests/gmail-gate.test.ts`, `supabase/tests/gmail-gate-db.test.ts`
- Modify: `supabase/scripts/gmail-gate.ts`(전체 교체)

**Interfaces:**
- Consumes: 테이블 `connections`(id, status, expires_at, created_at), `sync_states`(last_success_at, watch_expires_at), `jobs`(kind, status, priority, payload, created_at, claimed_at, attempts, last_error, not_before), `items`(id, status, title, occurred_at, captured_at, idempotency_key), `usage_counters`(month, extract_tokens, backfill_tokens, reserved_krw, backfill_reserved_krw), `reauth_pushes`(reason, sent_at). RPC `gmail_get_refresh_token(p_user, p_connection)`, `insert_item(…, p_enqueue)`. `_shared/gmail.ts`(`gmailApi`, `gmailToItem`, `refreshAccessToken`). `tests/_testenv.ts`(`RUN`, `service`, `testUser`, `deleteRunJobs`).
- Produces (다음 태스크가 쓰는 CLI 계약):
  - `status` → JSON `{ connection: { status, created_at, expires_at, t0 }, sync: { last_success_at, watch_expires_at }, backfill: { active, backoff, deferred_budget, deferred_busy, dead, by_kind }, backfill_bursts, backfill_ids_latest, gmail_jobs_dead, gmail_items: { <status>: n }, usage: [{ month, extract_tokens, backfill_tokens, reserved_krw, backfill_reserved_krw }], reauth_pushes: [{ reason, sent_at }] }`. 연결 없음 → `{"error":"no_connection"}`, exit 1.
  - `latency --since <ISO>` → 표본 줄(`id\tcreated_at\tlatency_s\tbackfill_pending=n\tkind\tstatus`) + 끝 줄 JSON `{ webhook_syncs, connect_excluded, retried, open, during_backfill, avg_latency_s_during_backfill, max_latency_s_during_backfill, gate: "pass"|"fail"|"insufficient" }`.
  - `mails --prefix <접두> --since <ISO>` → 줄(`id\tdelay_s`) + 끝 줄 JSON `{ mails, max_delay_s, avg_delay_s }`.
  - `gap --after <ISO> --before <ISO> [--q <추가 검색어>]` → JSON `{ listed, stored, discarded_by_rule: { otp?, promotion? }, missing: [id] }`, 누락이 있으면 exit 1.
  - `export async function run(argv: string[], out: (line: string) => void, env?: (k: string) => string | undefined): Promise<number>`(exit 코드).
  - `_gmail-gate.ts`: `bursts(created: string[], gapMs?) → { start, end, n }[]`, `connectSyncIds(syncs, backfillFetchCreated, gapMs?) → Set<string>`, `classify(rows: SyncRow[], connectIds) → Sample[]`, `summarize(samples) → LatencySummary`, `backlog(rows: BacklogRow[], now: number) → Backlog`, `mailDelays(rows) → { id, delay_s }[]`, `t0Of(expiresAt: string | null) → string | null`, 상수 `BURST_GAP_MS = 30_000`, `GATE_MIN_SAMPLES = 5`, `GATE_AVG_S = 60`.

- [ ] **Step 1: 순수 테스트를 쓴다**

`supabase/tests/gmail-gate.test.ts`:

```ts
import { assertEquals } from "jsr:@std/assert";
import { backlog, bursts, classify, connectSyncIds, mailDelays, summarize, type SyncRow, t0Of } from "../scripts/_gmail-gate.ts";

// M1-③ 게이트 판정(순수). 시각은 기준 + s초
const T = (s: number) => new Date(Date.UTC(2026, 9, 1, 12, 0, 0) + s * 1000).toISOString();
const sync = (id: string, created: number, claimed: number | null, o: Partial<SyncRow> = {}): SyncRow => ({
  id, created_at: T(created), claimed_at: claimed === null ? null : T(claimed), status: claimed === null ? "queued" : "done",
  attempts: claimed === null ? 0 : 1, last_error: null, pending: 3, ...o,
});

Deno.test("bursts: backfill fetch jobs enqueued within 30s form one connect burst", () => {
  assertEquals(bursts([T(0), T(1), T(2), T(600), T(601)]).map((b) => b.n), [3, 2]);
});

Deno.test("connectSyncIds: first via:webhook sync right after each backfill burst is the connect sync (T0 and reconnect)", () => {
  const syncs = [sync("c1", 3, 10), sync("w1", 90, 95), sync("c2", 602, 610), sync("w2", 700, 705)];
  assertEquals([...connectSyncIds(syncs, [T(0), T(1), T(2), T(600), T(601)])].sort(), ["c1", "c2"]);
  assertEquals(connectSyncIds(syncs, []).size, 0);                                   // 백필이 없으면 뺄 것도 없다
});

// Review Focus 2: 연결 sync·재시도 sync 는 표본이 아니다
Deno.test("classify + summarize: connect and retried syncs are not samples; gate = 5 during-backfill samples averaging ≤ 60s", () => {
  const rows = [
    sync("c", 3, 10),
    sync("a", 60, 70), sync("b", 120, 150), sync("d", 180, 200), sync("e", 240, 260),
    sync("f", 300, 330, { attempts: 2, last_error: "history 503" }),                 // 실패·백오프를 거침 → 제외·보고
    sync("g", 360, 420),
    sync("h", 900, 905, { pending: 0 }),                                             // 백필이 끝난 뒤 → 평균 밖
    sync("q", 960, null),                                                            // 아직 클레임 전
  ];
  assertEquals(summarize(classify(rows, new Set(["c"]))), {
    webhook_syncs: 9, connect_excluded: 1, retried: 1, open: 1, during_backfill: 5,
    avg_latency_s_during_backfill: 28, max_latency_s_during_backfill: 60, gate: "pass",
  });
});

// Review Focus 1: 표본 부족은 통과가 아니다
Deno.test("summarize: fewer than 5 during-backfill samples is insufficient; a slow average fails", () => {
  const four = [sync("a", 0, 5), sync("b", 60, 65), sync("c", 120, 125), sync("d", 180, 185), sync("e", 240, 245, { pending: 0 })];
  assertEquals(summarize(classify(four, new Set())).gate, "insufficient");
  const slow = [0, 60, 120, 180, 240].map((t, i) => sync(`s${i}`, t, t + 90));
  assertEquals(summarize(classify(slow, new Set())).gate, "fail");
});

// Review Focus 4: 예산 미룸·백오프·dead 는 "진행 중"이 아니다
Deno.test("backlog: budget-deferred and backoff jobs are not active; expired llm_busy is active; dead counted apart", () => {
  const b = backlog([
    { kind: "gmail-fetch", status: "running", not_before: null, last_error: null },
    { kind: "process", status: "queued", not_before: null, last_error: null },
    { kind: "process", status: "queued", not_before: T(-60), last_error: "llm_busy" },            // 기한 지남 → 클레임 가능
    { kind: "process", status: "queued", not_before: T(86_400), last_error: "budget_exhausted" },
    { kind: "process", status: "queued", not_before: T(20), last_error: "llm_busy" },
    { kind: "embed", status: "queued", not_before: T(120), last_error: "embed 500" },
    { kind: "gmail-fetch", status: "dead", not_before: null, last_error: "messages.get 404" },
  ], Date.parse(T(0)));
  assertEquals(b, { active: 3, backoff: 1, deferred_budget: 1, deferred_busy: 1, dead: 1, by_kind: { "gmail-fetch": 1, process: 4, embed: 1 } });
});

Deno.test("mailDelays: per synthetic mail, Gmail receive → stored seconds, in receive order", () => {
  assertEquals(mailDelays([
    { id: "m2", occurred_at: T(60), captured_at: T(75.5) },
    { id: "m1", occurred_at: T(0), captured_at: T(42) },
  ]), [{ id: "m1", delay_s: 42 }, { id: "m2", delay_s: 15.5 }]);
});

// Review Focus 3: refresh token 없는 연결은 T0 가 없다
Deno.test("t0Of: connection time = refresh-token expiry − 7 days; no expiry (no refresh token stored) → null", () => {
  assertEquals([t0Of("2026-10-07T12:00:00+00:00"), t0Of(null)], ["2026-09-30T12:00:00.000Z", null]);
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pgrep -x xcodebuild; deno test --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/tests/gmail-gate.test.ts`
Expected: FAIL — `Module not found "file:///…/supabase/scripts/_gmail-gate.ts"`.

- [ ] **Step 3: 판정 모듈을 만든다**

`supabase/scripts/_gmail-gate.ts`:

```ts
// gmail-gate.ts 판정 로직(순수, M1-③ 게이트). 입력은 jobs·items 의 id·시각·상태·개수뿐이다(본문·제목·주소 없음)
export type SyncRow = {
  id: string; created_at: string; claimed_at: string | null; status: string; attempts: number; last_error: string | null;
  pending: number;                                  // 이 sync 가 적재될 때 아직 클레임되지 않은 백필(우선순위 40) 잡 수
};
export type SampleKind = "connect" | "retried" | "open" | "ok";
export type Sample = SyncRow & { latency_s: number | null; kind: SampleKind };
export type LatencySummary = {
  webhook_syncs: number; connect_excluded: number; retried: number; open: number; during_backfill: number;
  avg_latency_s_during_backfill: number | null; max_latency_s_during_backfill: number | null; gate: "pass" | "fail" | "insufficient";
};
export type BacklogRow = { kind: string; status: string; not_before: string | null; last_error: string | null };
export type Backlog = { active: number; backoff: number; deferred_budget: number; deferred_busy: number; dead: number; by_kind: Record<string, number> };

export const BURST_GAP_MS = 30_000;
export const GATE_MIN_SAMPLES = 5;                 // 스펙 §15 ③ "5회 평균"
export const GATE_AVG_S = 60;                      // "≤ 1분"

const ms = (iso: string) => Date.parse(iso);
const r1 = (x: number) => Math.round(x * 10) / 10;

// gmail-connect 한 번이 넣은 백필 gmail-fetch 잡 묶음: 적재 시각이 앞 잡과 gapMs 안이면 같은 묶음
export function bursts(created: string[], gapMs = BURST_GAP_MS): { start: number; end: number; n: number }[] {
  const out: { start: number; end: number; n: number }[] = [];
  for (const t of created.map(ms).sort((a, b) => a - b)) {
    const last = out[out.length - 1];
    if (last && t - last.end <= gapMs) { last.end = t; last.n++; } else out.push({ start: t, end: t, n: 1 });
  }
  return out;
}

// gmail-connect 는 백필 잡을 넣은 직후 초기 sync 를 gmail_enqueue_for_account 로 넣어 via:webhook 표식이 붙는다(M1-③a 보고 우려 2).
// 묶음마다, 묶음 끝 뒤 gapMs 안에 적재된 첫 via:webhook sync 를 연결 sync 로 본다(T0 연결과 ③c 재연결 둘 다)
export function connectSyncIds(syncs: { id: string; created_at: string }[], backfillFetchCreated: string[], gapMs = BURST_GAP_MS): Set<string> {
  const sorted = [...syncs].sort((a, b) => ms(a.created_at) - ms(b.created_at));
  const out = new Set<string>();
  for (const b of bursts(backfillFetchCreated, gapMs)) {
    const s = sorted.find((x) => ms(x.created_at) >= b.end && ms(x.created_at) - b.end <= gapMs);
    if (s) out.add(s.id);
  }
  return out;
}

// connect = 연결 sync(표본 밖). retried = 실패해 백오프(not_before)를 거친 sync — 그동안 온 웹훅은 새 잡이 생기지 않아
// 그 지연이 표본에 드러나지 않으므로 평균에서 빼고 따로 센다(M1-③a fix r1 우려 2). open = 아직 클레임 전
export function classify(rows: SyncRow[], connectIds: Set<string>): Sample[] {
  return rows.map((r) => {
    const latency_s = r.claimed_at ? r1((ms(r.claimed_at) - ms(r.created_at)) / 1000) : null;
    const kind: SampleKind = connectIds.has(r.id) ? "connect"
      : r.attempts > 1 || r.last_error !== null ? "retried"
      : latency_s === null ? "open" : "ok";
    return { ...r, latency_s, kind };
  });
}

// 게이트(스펙 §15 ③): 백필 대기 중(pending > 0)에 적재된 ok 표본이 5개 이상이고 평균 ≤ 60초. 표본이 모자라면 통과가 아니라 insufficient
export function summarize(samples: Sample[]): LatencySummary {
  const n = (k: SampleKind) => samples.filter((s) => s.kind === k).length;
  const lat = samples.filter((s) => s.kind === "ok" && s.pending > 0).map((s) => s.latency_s!);
  const avg = lat.length ? r1(lat.reduce((a, b) => a + b, 0) / lat.length) : null;
  return {
    webhook_syncs: samples.length, connect_excluded: n("connect"), retried: n("retried"), open: n("open"),
    during_backfill: lat.length, avg_latency_s_during_backfill: avg, max_latency_s_during_backfill: lat.length ? Math.max(...lat) : null,
    gate: lat.length < GATE_MIN_SAMPLES ? "insufficient" : avg! <= GATE_AVG_S ? "pass" : "fail",
  };
}

// 백필 레인(우선순위 40) 잡 분류. deferred_budget = 백필 예산 소진으로 다음 달까지(Ruling C), deferred_busy = LLM 슬롯 대기(30초),
// backoff = 실패 뒤 재시도 대기(0007). "백필 끝" = active·backoff·deferred_busy 가 모두 0
export function backlog(rows: BacklogRow[], now: number): Backlog {
  const b: Backlog = { active: 0, backoff: 0, deferred_budget: 0, deferred_busy: 0, dead: 0, by_kind: {} };
  for (const r of rows) {
    if (r.status === "dead") { b.dead++; continue; }
    b.by_kind[r.kind] = (b.by_kind[r.kind] ?? 0) + 1;
    const waiting = r.status === "queued" && r.not_before !== null && ms(r.not_before) > now;
    if (!waiting) b.active++;
    else if (r.last_error === "budget_exhausted") b.deferred_budget++;
    else if (r.last_error === "llm_busy") b.deferred_busy++;
    else b.backoff++;
  }
  return b;
}

// 합성 메일별 Gmail 수신(occurred_at = internalDate) → 저장(captured_at) 초, 수신 순
export function mailDelays(rows: { id: string; occurred_at: string; captured_at: string }[]): { id: string; delay_s: number }[] {
  return [...rows].sort((a, b) => ms(a.occurred_at) - ms(b.occurred_at))
    .map((r) => ({ id: r.id, delay_s: r1((ms(r.captured_at) - ms(r.occurred_at)) / 1000) }));
}

// refresh token 을 저장한 연결 시각. gmail_save_connection 은 refresh token 이 있을 때만 expires_at = now + 7일 을 쓴다
export function t0Of(expiresAt: string | null): string | null {
  return expiresAt ? new Date(ms(expiresAt) - 7 * 86_400_000).toISOString() : null;
}
```

- [ ] **Step 4: 순수 테스트 통과**

Run: `deno test --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/tests/gmail-gate.test.ts`
Expected: `ok | 7 passed | 0 failed`.

- [ ] **Step 5: 호스팅 DB 테스트를 쓴다**

`supabase/tests/gmail-gate-db.test.ts`:

```ts
import { assert, assertEquals } from "jsr:@std/assert";
import { encrypt, toBytea } from "../functions/_shared/crypto.ts";
import { run } from "../scripts/gmail-gate.ts";
import { deleteRunJobs, RUN, service as sb, testUser } from "./_testenv.ts";

// 호스팅 DB. 전용 테스트 사용자에게 합성 Gmail 연결·잡·항목을 만들어 gmail-gate 의 조회식(필터·페이지)과 출력 형태를 본다(AGENTS.md §7).
// 잡 lease_key 는 RUN 접두라 워커 cron 이 가져가지 않는다. gap 은 실제 refresh token·Gmail API 가 필요해 여기서 다루지 않는다
const USER = (await testUser()).id;
async function gate(...args: string[]): Promise<{ code: number; lines: string[] }> {
  const lines: string[] = [];
  const code = await run([...args, "--user", USER], (l) => lines.push(l));
  return { code, lines };
}

Deno.test("gmail-gate status · latency · mails on a synthetic connection of the test user", async () => {
  const base = Date.now() - 3600_000;
  const at = (s: number) => new Date(base + s * 1000).toISOString();
  const { data: conn, error: ce } = await sb.from("connections").insert({ user_id: USER, provider: "gmail",
    account_ref: `${RUN}-gg-${crypto.randomUUID()}@example.com`, status: "active", expires_at: at(7 * 86_400) }).select("id").single();
  assertEquals(ce, null);
  const cid = conn!.id as string;
  let item: string | null = null;
  try {
    assertEquals((await sb.from("sync_states").insert({ connection_id: cid, user_id: USER, cursor: "1", watch_expires_at: at(7 * 86_400) })).error, null);
    const job = (kind: string, key: string, created: number, o: Record<string, unknown>) =>
      ({ kind, user_id: USER, lease_key: `${RUN}:${key}`, created_at: at(created), ...o });
    const webhook = { connection_id: cid, via: "webhook" };
    const { error } = await sb.from("jobs").insert([
      job("gmail-fetch", "backfill", 0, { payload: { connection_id: cid, ids: ["x1", "x2", "x3"], backfill: true }, status: "done", attempts: 1, claimed_at: at(5) }),
      job("gmail-sync", "gmail:c", 1, { payload: webhook, status: "done", attempts: 1, claimed_at: at(20) }),             // 연결 sync(via 오표기)
      job("process", "backfill", 30, { payload: { item_id: crypto.randomUUID(), backfill: true } }),                     // 대기 중인 백필
      ...[60, 120, 180, 240, 300].map((t, i) =>
        job("gmail-sync", `gmail:w${i}`, t, { payload: webhook, status: "done", attempts: 1, claimed_at: at(t + 10) })),
      job("gmail-sync", "gmail:r", 360, { payload: webhook, status: "done", attempts: 2, last_error: "history 503", claimed_at: at(365) }),
    ]);
    assertEquals(error, null);
    const ins = await sb.rpc("insert_item", { p_user: USER, p_source: "GMAIL", p_idempotency_key: `${RUN}:gg-mail`, p_sender: null,
      p_title: "[합성 게이트 테스트 1] 합성", p_content_enc: toBytea(await encrypt(USER, "합성 메일")),
      p_occurred_at: new Date(Date.now() - 30_000).toISOString(), p_enqueue: false });
    assertEquals(ins.error, null);
    item = ins.data as string;

    const s = await gate("status");
    assertEquals(s.code, 0);
    const st = JSON.parse(s.lines.join("\n"));
    assertEquals([st.connection.status, st.connection.t0, st.backfill.active, st.backfill.by_kind, st.backfill_bursts, st.backfill_ids_latest],
      ["active", at(0), 1, { process: 1 }, 1, 3]);
    assert(st.gmail_items.queued >= 1);

    const l = await gate("latency", "--since", at(-1));
    assertEquals(l.code, 0);
    const sum = JSON.parse(l.lines.at(-1)!);
    assertEquals([sum.webhook_syncs, sum.connect_excluded, sum.retried, sum.during_backfill, sum.avg_latency_s_during_backfill, sum.gate],
      [7, 1, 1, 5, 10, "pass"]);

    const m = await gate("mails", "--prefix", "[합성 게이트 테스트", "--since", at(0));
    assertEquals(m.code, 0);
    const mm = JSON.parse(m.lines.at(-1)!);
    assertEquals(mm.mails, 1);
    assert(mm.max_delay_s >= 25 && mm.max_delay_s <= 60, String(mm.max_delay_s));   // 30초 전 수신 → 지금 저장(시계 오차 여유)
  } finally {
    await deleteRunJobs();
    if (item) await sb.from("items").delete().eq("user_id", USER).eq("id", item);
    await sb.from("connections").delete().eq("id", cid);                              // sync_states cascade
  }
});
```

- [ ] **Step 6: 실패를 확인한다**

Run: `deno test --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/tests/gmail-gate-db.test.ts`
Expected: FAIL — `gmail-gate.ts`에 `run` export가 없다(`does not provide an export named 'run'`) — 현재 스크립트는 최상위 코드다.

- [ ] **Step 7: 스크립트를 교체한다**

`supabase/scripts/gmail-gate.ts`(전체):

```ts
// M1-③ 게이트(스펙 §15 ③, PoC-6 흡수): Gmail 연결 상태·웹훅→sync 지연·합성 메일 저장 지연·재연결 공백 누락을 id·수치로만 본다.
// 본문·제목·주소는 출력하지 않는다(합성 메일 제목 접두는 조회 조건에만 쓴다). gap 은 Gmail 메시지를 메모리에서 서버 규칙으로만 다시 판정한다
// (출력·저장 없음, AGENTS.md §7). 판정 로직은 _gmail-gate.ts(순수, tests/gmail-gate.test.ts)
// 사용: deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/gmail-gate.ts <명령> [옵션] [--user <uuid>]
//   status                                        연결·T0(expires_at − 7일)·watch·백필 레인 분류·최근 연결 백필 ID 수·GMAIL 항목 상태별 수·사용량·재인증 푸시
//   latency --since <ISO>                         via:webhook gmail-sync 의 적재→첫 클레임(초). 연결 sync·재시도 sync 는 표본 밖, 끝 줄 요약에 gate
//   mails --prefix <합성 제목 접두> --since <ISO>    합성 메일 항목의 Gmail 수신(occurred_at)→저장(captured_at) 초
//   gap --after <ISO> --before <ISO> [--q <검색어>] 그 구간 Gmail 메시지 id(-category:promotions [검색어]) ↔ items: 저장·규칙 폐기·누락
import { createClient } from "npm:@supabase/supabase-js@2";
import { SERVER_AUTH } from "../functions/_shared/crypto.ts";
import { gmailApi, gmailToItem, refreshAccessToken } from "../functions/_shared/gmail.ts";
import { backlog, type BacklogRow, bursts, classify, connectSyncIds, mailDelays, summarize, type SyncRow, t0Of } from "./_gmail-gate.ts";

type Rows<T> = PromiseLike<{ data: T[] | null; error: { code?: string } | null }>;
type Count = PromiseLike<{ count: number | null; error: { code?: string } | null }>;

// PostgREST 는 요청당 최대 1000행이다. 백필이 1,000건을 넘으면 잘리므로 끝까지 페이지로 읽는다
async function all<T>(page: (from: number, to: number) => Rows<T>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) throw new Error("query " + (error.code ?? "error"));
    out.push(...(data ?? []));
    if ((data ?? []).length < 1000) return out;
  }
}
async function count(q: Count): Promise<number> {
  const { count: n, error } = await q;
  if (error) throw new Error("count " + (error.code ?? "error"));
  return n ?? 0;
}

export async function run(argv: string[], out: (line: string) => void,
  env: (k: string) => string | undefined = (k) => Deno.env.get(k)): Promise<number> {
  const cmd = argv[0];
  const arg = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const userArg = arg("--user") ?? env("ERURI_USER_ID");
  if (!userArg) { console.error("ERURI_USER_ID 없음"); return 2; }
  const user: string = userArg;
  const sb = createClient(env("SUPABASE_URL")!, env("SUPABASE_SERVICE_ROLE_KEY")!, SERVER_AUTH);
  const { data: conns } = await sb.from("connections").select("id, status, expires_at, created_at").eq("user_id", user).eq("provider", "gmail");
  const conn = conns?.[0];
  if (!conn) { out(JSON.stringify({ error: "no_connection" })); return 1; }

  // gmail-connect 가 넣은 백필 gmail-fetch 잡의 적재 시각·ID 수(ID 값은 출력하지 않는다)
  const backfillFetches = async (since?: string) => (await all<{ created_at: string; payload: { ids?: unknown[] } }>((a, b) => {
    let q = sb.from("jobs").select("created_at, payload").eq("user_id", user).eq("kind", "gmail-fetch").eq("payload->>backfill", "true");
    if (since) q = q.gte("created_at", since);
    return q.order("created_at").range(a, b);
  })).map((r) => ({ created_at: r.created_at, n: r.payload.ids?.length ?? 0 }));

  if (cmd === "status") {
    const { data: st } = await sb.from("sync_states").select("last_success_at, watch_expires_at").eq("connection_id", conn.id).eq("user_id", user).single();
    const lane = await all<BacklogRow>((a, b) => sb.from("jobs").select("kind, status, not_before, last_error").eq("user_id", user)
      .eq("priority", 40).in("status", ["queued", "running", "dead"]).range(a, b));
    const fetches = await backfillFetches();
    const bs = bursts(fetches.map((f) => f.created_at));
    const latest = bs.at(-1);
    const idsLatest = latest ? fetches.filter((f) => Date.parse(f.created_at) >= latest.start).reduce((n, f) => n + f.n, 0) : 0;
    const gmailDead = await count(sb.from("jobs").select("id", { count: "exact", head: true }).eq("user_id", user).like("kind", "gmail-%").eq("status", "dead"));
    const items = await all<{ status: string }>((a, b) => sb.from("items").select("status").eq("user_id", user).eq("source", "GMAIL").range(a, b));
    const byStatus: Record<string, number> = {};
    for (const r of items) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    const { data: usage } = await sb.from("usage_counters").select("month, extract_tokens, backfill_tokens, reserved_krw, backfill_reserved_krw")
      .eq("user_id", user).order("month");
    const { data: pushes } = await sb.from("reauth_pushes").select("reason, sent_at").eq("user_id", user).order("sent_at");
    out(JSON.stringify({
      connection: { status: conn.status, created_at: conn.created_at, expires_at: conn.expires_at, t0: t0Of(conn.expires_at) },
      sync: st, backfill: backlog(lane, Date.now()), backfill_bursts: bs.length, backfill_ids_latest: idsLatest,
      gmail_jobs_dead: gmailDead, gmail_items: byStatus, usage, reauth_pushes: pushes,
    }, null, 1));
    return 0;
  }

  if (cmd === "latency") {
    const since = arg("--since");
    if (!since) { console.error("--since <ISO>"); return 2; }
    const syncs = await all<Omit<SyncRow, "pending">>((a, b) => sb.from("jobs").select("id, created_at, claimed_at, status, attempts, last_error")
      .eq("user_id", user).eq("kind", "gmail-sync").eq("payload->>via", "webhook").gte("created_at", since).order("created_at").range(a, b));
    const rows: SyncRow[] = [];
    for (const s of syncs) {
      // 이 sync 적재 시점에 클레임 전이던 백필 잡 = 그 전에 적재됐고 (아직 클레임 전이거나 그 뒤에 클레임됨)
      const lane = () => sb.from("jobs").select("id", { count: "exact", head: true }).eq("user_id", user).eq("priority", 40).lte("created_at", s.created_at);
      const pending = await count(lane().is("claimed_at", null)) + await count(lane().gt("claimed_at", s.created_at));
      rows.push({ ...s, pending });
    }
    const samples = classify(rows, connectSyncIds(rows, (await backfillFetches(since)).map((f) => f.created_at)));
    for (const s of samples) out([s.id, s.created_at, s.latency_s ?? "-", `backfill_pending=${s.pending}`, s.kind, s.status].join("\t"));
    out(JSON.stringify(summarize(samples)));
    return 0;
  }

  if (cmd === "mails") {
    const prefix = arg("--prefix"), since = arg("--since");
    if (!prefix || !since) { console.error("--prefix <합성 제목 접두> --since <ISO>"); return 2; }
    const rows = await all<{ id: string; occurred_at: string; captured_at: string }>((a, b) => sb.from("items").select("id, occurred_at, captured_at")
      .eq("user_id", user).eq("source", "GMAIL").like("title", `${prefix}%`).gte("occurred_at", since).range(a, b));
    const d = mailDelays(rows);
    for (const m of d) out([m.id, m.delay_s].join("\t"));
    const xs = d.map((m) => m.delay_s);
    out(JSON.stringify({ mails: d.length, max_delay_s: xs.length ? Math.max(...xs) : null,
      avg_delay_s: xs.length ? Math.round(xs.reduce((a, x) => a + x, 0) / xs.length * 10) / 10 : null }));
    return 0;
  }

  if (cmd === "gap") {
    const after = Math.floor(Date.parse(arg("--after") ?? "") / 1000), before = Math.floor(Date.parse(arg("--before") ?? "") / 1000);
    if (!Number.isFinite(after) || !Number.isFinite(before)) { console.error("--after <ISO> --before <ISO>"); return 2; }
    const extra = arg("--q");
    const { data: rt, error } = await sb.rpc("gmail_get_refresh_token", { p_user: user, p_connection: conn.id });
    if (error || !rt) { out(JSON.stringify({ error: "no_refresh_token" })); return 1; }
    const api = gmailApi(await refreshAccessToken(rt as string));
    const ids: string[] = [];
    let page: string | undefined;
    do {
      const p = await api.listMessageIds(`after:${after} before:${before} -category:promotions${extra ? " " + extra : ""}`, page);
      ids.push(...(p.messages ?? []).map((m) => m.id));
      page = p.nextPageToken;
    } while (page);
    const have = new Set<string>();
    for (let i = 0; i < ids.length; i += 100) {
      const { data } = await sb.from("items").select("idempotency_key").eq("user_id", user).in("idempotency_key", ids.slice(i, i + 100).map((x) => "gmail:" + x));
      for (const r of data ?? []) have.add(r.idempotency_key.slice("gmail:".length));
    }
    const ruled: Record<string, number> = {};
    const missing: string[] = [];
    for (const id of ids.filter((x) => !have.has(x))) {
      const v = gmailToItem(await api.getMessage(id));
      if (v.kind === "discard") ruled[v.reason] = (ruled[v.reason] ?? 0) + 1;
      else missing.push(id);
    }
    out(JSON.stringify({ listed: ids.length, stored: have.size, discarded_by_rule: ruled, missing }));
    return missing.length ? 1 : 0;
  }

  console.error("usage: gmail-gate.ts <status|latency|mails|gap>");
  return 2;
}

if (import.meta.main) Deno.exit(await run(Deno.args, (line) => console.log(line)));
```

- [ ] **Step 8: 검사·테스트 통과·연결 전 스모크**

Run:
```bash
deno check supabase/scripts/gmail-gate.ts supabase/scripts/_gmail-gate.ts supabase/tests/gmail-gate.test.ts supabase/tests/gmail-gate-db.test.ts
pgrep -x xcodebuild; deno test --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/tests/gmail-gate.test.ts supabase/tests/gmail-gate-db.test.ts
G="deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/gmail-gate.ts"; $G status; echo "exit=$?"
deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/sql.ts "select count(*) from jobs where lease_key like 'test:%'"
```
Expected: check 오류 0. `ok | 8 passed | 0 failed`. 실사용자 `status` → `{"error":"no_connection"}`, `exit=1`(연결 전 기대값, 읽기 전용). `test:%` 잡 `[{"count":"0"}]`(정리 확인).
실패 시: DB 테스트의 `like("title", …)`나 `payload->>via` 필터가 PostgREST에서 0행이면 supabase-js 인코딩을 확인하고 고친다(이 테스트가 실측 전에 조회식을 잡으려고 있다).

- [ ] **Step 9: 커밋**

```bash
git add supabase/scripts/_gmail-gate.ts supabase/scripts/gmail-gate.ts supabase/tests/gmail-gate.test.ts supabase/tests/gmail-gate-db.test.ts
git commit -m "feat(scripts): gmail-gate sample rules (connect/retried syncs), backfill lane states, synthetic mail delay, paging (M1-③b1)" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task M1-③b2: 연결(T0) + 백필 중 웹훅→sync 지연 + 규칙 메일 발송

사용자가 옆에 있는 한 세션이다(T0 = 2026-09-30 또는 이후). 시작 전에 "스펙 확인 필요" 1(표본 보충 방법)과 4(fetch 404)의 판정을 받아 둔다.

**모델:** `opus`/`medium`

**Files:**
- Modify: `docs/superpowers/phase1/gates.md`(M1-③b 행 추가, 상태 **대기**)

**Interfaces:**
- Consumes: ③b1 CLI(`status`·`latency`·`mails`), `sql.ts`, 앱 설정 Gmail 절(F10), Gmail 커넥터 `send_message`(A 방식일 때).
- Produces: `gates.md` M1-③b 행에 T0(UTC ISO), N, 발송 방식·간격, `latency` 요약, `mails` 요약, 카드 마스킹 결과. ③b3·③c가 T0를 여기서 읽는다.

- [ ] **Step 1: (에이전트) 사전 점검**

```bash
G="deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/gmail-gate.ts"
S="deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/sql.ts"
U="$(grep '^ERURI_USER_ID=' supabase/.env | cut -d= -f2)"
test -n "$U" && echo user_set
$G status
$S "select apns_env, build, last_seen_at > now() - interval '1 day' as fresh from devices where user_id = \$1" "$U"
$S "select kind, status, count(*) from jobs where user_id = \$1 and status in ('queued','running','dead') group by 1, 2" "$U"
$S "select d.status, max(d.start_time) as last from cron.job_run_details d join cron.job j using (jobid) where j.jobname = 'worker-every-minute' and d.start_time > now() - interval '5 minutes' group by 1"
$S "select month, reserved_krw, backfill_reserved_krw from usage_counters where user_id = \$1 order by month" "$U"
```

통과 기준: `user_set`, `status` = `{"error":"no_connection"}`, 기기 1행 이상 `apns_env=production`·`build=202609302012`·`fresh=true`, 워커 cron `succeeded` 최근 5분 안, 대기 잡이 비었거나 적음(수를 기록), 사용량 행(없어도 됨)을 기록.
실패 시: 연결이 이미 있음 → 이 계획의 T0가 아니다, 메인에 보고하고 멈춘다(연결을 지우지 않는다). 기기 없음·빌드 다름 → 사용자에게 앱 열기/0.5.0 업데이트(U10-0). 워커 cron 실패 → 멈추고 원인부터(모든 측정이 워커에 달려 있다).

- [ ] **Step 2: (사용자 U10-0) 발송 방식 결정**

사용자에게 묻는다: (A) 에이전트가 Gmail 커넥터로 합성 메일을 **연결할 계정 주소 → 같은 주소**로 보내도 되는지, (B) 직접 보낼지. A는 사용자 승인 + 커넥터 계정 = 연결할 계정일 때만(연결 뒤 `$S "select account_ref = \$2 as same from connections where user_id = \$1 and provider = 'gmail'" "$U" "<커넥터 계정 주소>"`로 불리언만 확인). 커넥터를 이 세션에서 쓸 수 없으면 B. B면 합성 메일 문구 표를 사용자 메모 앱에 옮겨 두게 하고 **Gmail 초안은 만들지 않게** 한다.

- [ ] **Step 3: (사용자 U10-1) 연결 → (에이전트) T0·N 확인**

사용자: 설정 → "Gmail 연결" → Gmail 읽기 권한 체크 → 결과 줄 확인.
에이전트(연결 직후 바로):

```bash
G="deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/gmail-gate.ts"
$G status
```

통과 기준: `connection.status = active`, `connection.t0` ≠ null(= T0), `backfill_ids_latest` = N, `backfill.active > 0`(N > 0일 때), `sync.watch_expires_at` ≈ T0 + 7일.
실패 시:
- `t0 = null` 또는 결과 줄 `refresh_token_stored=false` → 사용자에게 "다시 연결 (동의 다시 받기)" → `status` 다시(T0는 이때 시각). 이 재동의는 같은 Web 클라이언트의 PoC Gmail 연결을 끊을 수 있다("스펙 확인 필요" 5).
- 앱 결과 줄 403 `gmail_scope_missing`/`scope_not_granted` → Gmail 체크박스를 켜고 다시. 409 → 다른 사용자에 연결된 계정, 멈추고 보고. 502 → 다시 시도(코드 만료). 500 → 대시보드 gmail-connect 로그에서 `stage`·`result` 코드만 확인.
- 연결 전 첫 시도의 잡(`skipped`)은 무해하다. T0는 항상 `status`의 `t0`.

T0(UTC ISO), N을 `gates.md` 초안에 적는다. 백필 예상 시간 ≈ N × 5초(상한).

- [ ] **Step 4: 합성 메일 발송 (간격은 N으로)**

시간표(T0 기준): **N < 180 → 30초 간격** T0+0:45, 1:15, 1:45, 2:15, 2:45, 3:15, 3:45, 4:15. **N ≥ 180 → 65초 간격** T0+1:00, 2:05, 3:10, 4:15, 5:20, 6:25, 7:30, 8:35. 순서 L1, L2, O1, L3, C1, L4, L5, L6.
- A: 에이전트가 커넥터로 보낸다(도구 호출 간격이 시간표에서 ±15초면 된다 — 간격은 판정 기준이 아니고 표본 수만 채우면 된다). 보낸 UTC 시각을 적는다.
- B: 사용자가 시간표대로 보낸다(작성 창에 붙여넣고 바로 보내기).

간격 근거: 같은 연결에 queued sync가 있으면 새 웹훅은 합쳐진다(F3). fetch 단계(첫 약 N × 0.8초)에는 한 인스턴스가 fetch 잡을 잡고 있어 sync가 다음 cron까지 기다릴 수 있고, process·embed 단계에서는 클레임이 수 초마다 돌아 합쳐지지 않는다.

- [ ] **Step 5: (에이전트) 측정 — 마지막 메일 2분 뒤**

```bash
G="deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/gmail-gate.ts"
$G status
$G latency --since <T0 − 2분>
$G mails --prefix "[합성 지연 테스트" --since <T0 − 1분>
```

통과 기준(스펙 §15 ③ 게이트): `latency` 끝 줄 `gate = "pass"` — 백필 대기 중 유효 표본 `during_backfill ≥ 5`, `avg_latency_s_during_backfill ≤ 60`. `open = 0`(남아 있으면 1분 뒤 다시). 보조: `mails` = 6(각 메일 1행 — 초안 개정이 섞이면 6보다 많다, "스펙 확인 필요" 3에 기록), `max_delay_s ≤ 180`.
실패·예외 시:
- `gate = "insufficient"`(백필이 먼저 끝남): 표본 줄을 적고 "스펙 확인 필요" 1의 판정대로 보충 측정한다. 판정 전에는 보충 부하를 만들지 않는다.
- `gate = "fail"`: 느린 표본마다 그 sync 적재~클레임 사이에 클레임된 잡을 id·kind·priority로만 본다 — `$S "select id, kind, priority, claimed_at from jobs where user_id = \$1 and claimed_at between \$2 and \$3 order by claimed_at" "$U" <created_at> <claimed_at>` — 그리고 워커 cron `cron.job_run_details` 상태를 본다. 원인(워커 호출 실패, Edge 벽시계 종료, 레인 규칙 오류)을 적고 게이트는 **실패**로 둔다. 코드 수정은 별도 태스크.
- `retried > 0`: 해당 sync의 `last_error` 코드를 적는다(Gmail 5xx·429면 외부 일시 오류, 그 밖이면 결함 후보). 평균 판정은 유효 표본으로 한다. `mails`의 `max_delay_s > 180`이면 그 구간을 함께 적는다.
- 연결 sync가 `connect_excluded = 0`으로 나오면(묶음 탐지 실패) 표본 줄에서 T0 직후 첫 sync를 사람 눈으로 빼고 그 사실을 적는다.

- [ ] **Step 6: (에이전트) 카드·OTP 메일 — 저장 쪽 확인**

```bash
S="deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/sql.ts"
U="$(grep '^ERURI_USER_ID=' supabase/.env | cut -d= -f2)"
$S "select id, title like '%****%' as masked, title ~ '[0-9]{4}[- ]?[0-9]{4}[- ]?[0-9]{4}' as has_card_digits from items where user_id = \$1 and source = 'GMAIL' and title like '[합성카드테스트]%'" "$U"
$S "select count(*) from items where user_id = \$1 and source = 'GMAIL' and title like '[합성] 로그인%'" "$U"
```

통과 기준: 카드 메일 1행 `masked=true, has_card_digits=false`. OTP 메일 0행(규칙 폐기 → 저장 안 됨, 폐기 사유는 ③b3 `gap`의 `discarded_by_rule.otp`로 확인).
실패 시: 카드 0행 → Jev 격리 여부와 무관하게 행은 있어야 한다 — 수신 여부를 `mails --prefix "[합성카드테스트]"`로 보고, 없으면 발송 확인. 마스킹 안 됨 → 규칙 결함, 게이트 실패로 적고 별도 태스크.

- [ ] **Step 7: (사용자 U10-3) 합성 제안 정리 → 기록·커밋**

사용자: 합성 미팅 제안 알림 무시, "제안" 탭 "전체 무시".
`gates.md`에 M1-③b 행을 **대기**로 추가한다(③b3에서 통과 판정): `T0 <ISO>(KST 병기), N=<n>, 발송 <A|B>·<30|65>초, latency: webhook_syncs <a>·connect_excluded <b>·retried <c>·during_backfill <d>·평균 <e>초·최대 <f>초 → gate <pass|…>, mails 6통 최대 <g>초·평균 <h>초, 카드 제목 masked=true·숫자 없음, OTP 저장 0`.

```bash
git add docs/superpowers/phase1/gates.md
git commit -m "docs(phase1): M1-③b2 Gmail connected (T0), webhook→sync during backfill" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task M1-③b3: 백필 완료·규칙 폐기·90일 누락 0·비용·watch 갱신 → M1-③b 판정

T0 당일(백필이 끝난 뒤)과 T0 다음 날(watch cron) 두 번에 걸친다. 사용자 조작 없음.

**모델:** `opus`/`medium`

**Files:**
- Modify: `docs/superpowers/phase1/gates.md`(M1-③b 행 판정), `docs/superpowers/poc/results.md` PoC-6 행, 스펙 §14 판정 현황 PoC-6 행

**Interfaces:**
- Consumes: ③b1 CLI(`status`·`gap`), ③b2의 T0·N.
- Produces: M1-③b 통과/실패, 백필 소요·실제 비용(③c2 재적재 비교 기준).

- [ ] **Step 1: (에이전트) 백필 진행 확인 — 끝날 때까지 10분 간격**

```bash
G="deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/gmail-gate.ts"
$G status
```

"백필 끝" = `backfill.active = 0`, `backoff = 0`, `deferred_busy = 0`. 같이 볼 것: `backfill.dead = 0`, `gmail_jobs_dead = 0`.
실패·예외 시:
- `deferred_budget > 0`: 백필 예산(1,500원/월)이 찼다(Ruling C) — 수를 적고 기다리지 않는다(다음 달 1일 00:00 KST 재개). 항목은 fetch 때 이미 저장돼 Step 3 `gap`에는 영향이 없다.
- `backoff`가 줄지 않음 → `$S "select kind, last_error, attempts from jobs where user_id = \$1 and priority = 40 and status = 'queued' and not_before > now() and coalesce(last_error, '') not in ('budget_exhausted','llm_busy')" "$U"`로 코드만 본다. `messages.get 429`면 쿼터(F12) — 백필과 겹친 다른 호출이 없었는지 확인.
- `dead > 0` → `$S "select id, kind, last_error, attempts from jobs where user_id = \$1 and priority = 40 and status = 'dead'" "$U"`. `messages.get 404`면 "스펙 확인 필요" 4(영구 삭제 메일 하나가 잡 전체를 죽임) — Step 3 `gap`이 누락을 보여 준다.

- [ ] **Step 2: (에이전트) 백필 소요·비용 기록**

```bash
S="deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/sql.ts"
U="$(grep '^ERURI_USER_ID=' supabase/.env | cut -d= -f2)"
$S "select kind, count(*), min(created_at) as first_in, max(updated_at) as last_done from jobs where user_id = \$1 and priority = 40 and status = 'done' and created_at >= \$2 group by 1" "$U" "<T0 − 2분>"
$S "select month, extract_tokens, backfill_tokens, reserved_krw, backfill_reserved_krw from usage_counters where user_id = \$1 order by month" "$U"
$S "select status, count(*) from items where user_id = \$1 and source = 'GMAIL' group by 1" "$U"
```

기록: 백필 소요 = T0 → 레인 마지막 `last_done`, kind별 잡 수(fetch ⌈N/100⌉·process·embed), `backfill_tokens`, `backfill_reserved_krw`(백필 추출 실제 원), `reserved_krw`에서 Step 1 사전 값을 뺀 증가분(백필 임베딩 + 합성 메일, 월 예산), 항목 상태 분포(extracted·격리 `discarded:server:*`·empty). "추정" 표의 N 행과 비교해 벗어나면 이유를 적는다. T0가 월 경계면 두 월 행을 더한다.

- [ ] **Step 3: (에이전트) 90일 누락·규칙 폐기 — 백필 fetch가 끝난 뒤에만**

```bash
G="deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/gmail-gate.ts"
$G gap --after <T0 − 89일> --before <지금 UTC ISO>
$G gap --after <T0 − 89일> --before <지금 UTC ISO> --q in:drafts
```

통과 기준(첫 줄): `missing = []`, `discarded_by_rule.otp ≥ 1`(O1), `listed ≈ N + 합성 8통 + T0 뒤 도착분`.
둘째 줄은 판정이 아니라 관찰이다: `listed` = 90일 초안 수, `stored` = 항목이 된 초안 수 → "스펙 확인 필요" 3의 근거로 기록(누락 exit 1은 무시).
실패 시: `missing`의 id마다 `$S "select status, last_error from jobs where user_id = \$1 and kind = 'gmail-fetch' and payload->'ids' ? \$2" "$U" <id>`로 그 id를 맡은 fetch 잡 상태를 본다(dead → 원인 코드, 없음 → 목록 단계 누락). 누락이 있으면 게이트 **실패** — 원인·조치를 적고 조치 뒤 같은 명령으로 다시 잰다.

- [ ] **Step 4: (에이전트) watch 수동 갱신**

```bash
G="deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/gmail-gate.ts"
S="deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/sql.ts"
U="$(grep '^ERURI_USER_ID=' supabase/.env | cut -d= -f2)"
$G status          # sync.watch_expires_at = W0 기록
$S "select gmail_enqueue_all('gmail-watch', \$1)" "$U"
# 2분 뒤
$S "select status, checkpoint, last_error from jobs where user_id = \$1 and kind = 'gmail-watch' order by created_at desc limit 1" "$U"
$G status          # W1
```

통과 기준: `gmail_enqueue_all` = 1, 잡 `done`·`watched`, `W1 > W0`이고 `|W1 − (호출 시각 + 7일)| < 1시간`. (W1은 W0보다 몇 분~몇 시간만 늦다 — 연결 때 이미 +7일이었다.)
실패 시: 잡 `skipped` → refresh token 문제(`connection.status` 확인). 오류 코드 → Gmail `watch` 상태 코드(403이면 토픽 권한 — `gmail-api-push@system.gserviceaccount.com`의 Pub/Sub Publisher, PoC-6과 같은 토픽이라 이미 있어야 한다).

- [ ] **Step 5: 중간 기록**

`gates.md` M1-③b 행에 Step 1~4 결과를 붙인다(상태는 Step 6 뒤에 정한다): `백필 <분>분(fetch <a>·process <b>·embed <c> 잡), backfill_tokens <t>, 백필 추출 <x>원·임베딩 등 월 <y>원, 항목 <상태 분포>, gap 90일 listed <l>·stored <s>·otp <o>·missing 0, 초안 관찰 listed <dl>·stored <ds>, watch 수동 W0→W1`.

- [ ] **Step 6: (에이전트) watch cron — T0 뒤 첫 12:17 KST 이후(T0 = 09-30 21:00이면 10-01 12:17 이후)**

```bash
G="deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/gmail-gate.ts"
S="deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/sql.ts"
U="$(grep '^ERURI_USER_ID=' supabase/.env | cut -d= -f2)"
$S "select d.status, d.start_time from cron.job_run_details d join cron.job j using (jobid) where j.jobname = 'gmail-watch-daily' order by d.start_time desc limit 1"
$S "select status, checkpoint, created_at from jobs where user_id = \$1 and kind = 'gmail-watch' order by created_at desc limit 1" "$U"
$G status
```

통과 기준: cron `succeeded`(03:17 UTC), 그 뒤 gmail-watch 잡 `done`·`watched`, `watch_expires_at ≈ cron 시각 + 7일`(W1보다 늦음). 같이 기록: `sync.last_success_at`이 최근 6시간 안(6시간 cron sync 동작), `gmail_jobs_dead = 0`.
실패 시: cron 없음·실패 → `cron.job_run_details`의 `return_message` 코드만 기록, 조치 후 다음 날 다시. 늦어도 ③c1 세션에서 같은 확인을 한다.

- [ ] **Step 7: M1-③b 판정·기록·커밋**

통과 = ③b2 `gate = pass` + 카드 마스킹·OTP 폐기 + 90일 `missing = []` + watch 수동·cron. 하나라도 빠지면 **실패**(원인·조치·재측정 계획).
- `gates.md` M1-③b 행 상태를 **통과**(또는 실패)로.
- `results.md` PoC-6 행 "남은 실측"을 `M1-③b 통과(<날짜>): 백필(N=<n>, <분>분) 중 웹훅→sync 평균 <e>초(유효 표본 <d>), watch 수동·cron, OTP 폐기·카드 제목 마스킹, 90일 누락 0. +6일·+8일은 M1-③c(<T0+6일>·<T0+8일>)`로, 갱신일을 오늘로. 스펙 §14 판정 현황 PoC-6 행 같은 칸을 같은 문장으로.

```bash
git add docs/superpowers/phase1/gates.md docs/superpowers/poc/results.md docs/superpowers/specs/2026-09-22-assistant-design.md
git commit -m "docs(phase1): M1-③b Gmail gate 1 — backfill latency, rule mails, 90-day gap, watch renew" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task M1-③c1: T0 + 6일 — `expiring` 재인증 푸시

T0 + 6일 + 1시간 이후 한 번(T0 = 09-30 21:00이면 **10-06(화) 22:00 이후**). 다른 태스크와 병행 중이어도 된다.

**모델:** `sonnet`/`medium`

**Files:**
- Modify: `docs/superpowers/phase1/gates.md`(M1-③c 행 추가, 상태 **대기**)

**Interfaces:**
- Consumes: `status`의 `connection`·`reauth_pushes`, `gmail-reauth` 잡, 기기 알림.
- Produces: `expiring` 푸시 도착 여부(③c2 판정에 쓴다).

- [ ] **Step 1: (에이전트) 푸시 기록 확인**

```bash
G="deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/gmail-gate.ts"
S="deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/sql.ts"
U="$(grep '^ERURI_USER_ID=' supabase/.env | cut -d= -f2)"
$G status
$S "select status, checkpoint, payload->>'reason' as reason, created_at from jobs where user_id = \$1 and kind = 'gmail-reauth' order by created_at desc limit 3" "$U"
```

통과 기준: `connection.status = active`, `reauth_pushes`에 `reason = expiring` 1행이고 `sent_at`이 [T0 + 6일, T0 + 6일 + 1시간 5분] 안(매시 :07 cron + 워커 클레임 1분), `gmail-reauth` 잡 `done`·`reauth_sent`. 같이: `sync.last_success_at` 최근 6시간 안, `watch_expires_at` ≈ 최근 03:17 UTC + 7일(③b3 Step 6을 못 했으면 여기서 판정), `gmail_jobs_dead = 0`.
실패 시:
- 행 없음 → `$S "select reason from gmail_reauth_due() where user_id = \$1" "$U"`(기대 `expiring`), `gmail-reauth-hourly` cron 최근 실행 상태, 잡 `checkpoint`: `no_device` → 기기 `last_seen_at`·등록 확인(앱 열기), `reauth_rejected` → APNs 거절(토큰·환경).
- 원인을 적고 조치한다. 같은 창(`expires_at`)에는 다시 보내지 않으므로 재측정은 다음 주기(③c2 재연결 R 기준 R + 6일)에 한다.

- [ ] **Step 2: (사용자 U11-1) 알림 확인**

사용자에게: 잠금화면·알림 센터에 ERURI "Gmail 다시 연결 필요 / Gmail 연결이 24시간 안에 만료됩니다. 앱에서 다시 연결하세요."가 왔는지. **재연결하지 않는다**(+8일 경로를 재야 한다).
통과 기준: 사용자 "도착" 확인. 기록 행은 있는데 알림이 없으면 집중 모드·알림 설정을 확인하고 실패로 적는다(재측정은 다음 주기).

- [ ] **Step 3: 기록·커밋**

`gates.md`에 M1-③c 행을 **대기**로: `+6일 expiring: reauth_pushes sent_at <ISO>(T0+<h>시간), 잡 reauth_sent, 잠금화면 도착 확인(<시각> KST). watch 매일 갱신 <W>, 6시간 sync 정상`.

```bash
git add docs/superpowers/phase1/gates.md
git commit -m "docs(phase1): M1-③c1 Gmail +6 day expiring push" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task M1-③c2: T0 + 8일 — `invalid_grant` → `reauth_required` → 공백 메일 → 재연결 → 누락 0 (PoC-6 흡수 마감)

T0 + 7일 + 6시간 이후 한 세션(T0 = 09-30 21:00이면 **10-08(목)**). 사용자가 옆에 있어야 한다.

**모델:** `opus`/`medium`

**Files:**
- Modify: `docs/superpowers/phase1/gates.md`(M1-③c 행 판정), `docs/superpowers/poc/results.md` PoC-6 행, 스펙 §14 판정 현황 PoC-6 행·§16 "Gmail 7일 재인증" 줄

**Interfaces:**
- Consumes: ③b1 CLI(`status`·`latency`·`gap`), ③b3의 N·백필 비용, ③c1의 expiring 결과, 앱 "다시 연결 (동의 다시 받기)".
- Produces: PoC-6 흡수분 최종 판정.

- [ ] **Step 1: (에이전트) 끊김 확인과 기준 시각 L 기록 — 재연결 전**

```bash
G="deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/gmail-gate.ts"
S="deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/sql.ts"
U="$(grep '^ERURI_USER_ID=' supabase/.env | cut -d= -f2)"
$G status
$S "select kind, checkpoint, created_at from jobs where user_id = \$1 and kind in ('gmail-sync','gmail-watch','gmail-reauth') and created_at > \$2 order by created_at" "$U" "<T0 + 7일 − 1시간>"
```

통과 기준: `connection.status = reauth_required`, `reauth_pushes`에 `invalid_grant` 1행(`expiring` 행도 남아 있음), T0 + 7일 뒤 첫 refresh 잡의 `checkpoint = skipped`, 그 직후 `gmail-reauth`(`invalid_grant`) `reauth_sent`. **L = `sync.last_success_at`**, 끊긴 시각 ≈ `invalid_grant` 잡 `created_at`을 기록한다(재연결이 L을 덮는다, F7).
실패 시:
- 아직 `active`이고 T0 + 7일 뒤 sync가 성공(`history`·`resync`)했다 → refresh token이 7일에 만료되지 않았다. `$S "select gmail_enqueue_all('gmail-sync', \$1)" "$U"`로 한 번 더 refresh를 시도하고 2분 뒤 `status`. 그래도 active면 세션을 T0 + 9일로 미루고, T0 + 9일에도 active면 "Google 테스트 모드 7일 만료가 이 연결에 적용되지 않음"을 기록하고 메인에 보고(스펙 §5·§16 가정 재검토).
- `reauth_required`인데 `invalid_grant` 푸시 행이 없음 → ③c1 Step 1의 원인 확인 절차(`gmail_reauth_due`, cron, 잡 checkpoint).

- [ ] **Step 2: (사용자 U11-2) 끊김 알림 확인 → 공백 메일 2통**

사용자: ERURI "Gmail 다시 연결 필요 / Gmail 연결이 끊겼습니다. 앱에서 다시 연결하세요." 도착 확인, 설정 Gmail 줄이 "다시 연결 필요 (reauth_required)"인지.
그다음 P1·P2 발송(A면 에이전트가 커넥터로, B면 사용자). 보낸 시각을 적는다.

- [ ] **Step 3: (에이전트) 공백 확인 — 끊긴 동안 수집되지 않음**

2분 뒤:

```bash
G="deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/gmail-gate.ts"
S="deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/sql.ts"
U="$(grep '^ERURI_USER_ID=' supabase/.env | cut -d= -f2)"
$S "select count(*) from items where user_id = \$1 and source = 'GMAIL' and title like '[합성 공백 테스트%'" "$U"
$G latency --since <P1 발송 − 1분>
```

통과 기준: 항목 0, `webhook_syncs = 0`(reauth_required 동안 웹훅이 잡을 만들지 않음, F8). 0이 아니면 연결이 끊기지 않은 것 — Step 1로 돌아간다.

- [ ] **Step 4: (사용자 U11-2) 재연결**

사용자: 설정 → **"다시 연결 (동의 다시 받기)"** → Gmail 읽기 권한 체크 → 결과 줄 확인(`refresh_token_stored=true`). 이 시각 = R.

- [ ] **Step 5: (에이전트) 재연결 상태 → 재적재 완료 → 누락 0**

```bash
G="deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/gmail-gate.ts"
$G status
```

바로 통과 기준: `connection.status = active`, `connection.t0` = R(재동의 시각, `expires_at = R + 7일`), `reauth_pushes = []`(재연결 트리거가 지움, 0008), `backfill_bursts` = 이전 + 1, `backfill_ids_latest` = N'(≈ N + T0 뒤 도착분), `sync.last_success_at` ≈ R.
재적재가 끝날 때까지(`backfill.active = 0`, 약 N' × 0.8초 + 공백 메일 처리) 기다린 뒤:

```bash
G="deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/gmail-gate.ts"
S="deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/sql.ts"
U="$(grep '^ERURI_USER_ID=' supabase/.env | cut -d= -f2)"
$G gap --after <L − 1일> --before <R + 10분>
$S "select count(*) from items where user_id = \$1 and source = 'GMAIL' and title like '[합성 공백 테스트%'" "$U"
$S "select (select count(*) from jobs j join items i on i.id = (j.payload->>'item_id')::uuid where j.user_id = \$1 and j.kind = 'process' and j.created_at >= \$2 and i.source = 'GMAIL') as gmail_process_jobs, (select count(*) from items where user_id = \$1 and source = 'GMAIL' and captured_at >= \$2) as new_gmail_items" "$U" "<R ISO>"
$G gap --after <R − 89일> --before <R + 10분>
$G latency --since <R − 2분>
```

통과 기준(PoC-6 흡수분):
- 공백 창 `gap`: `missing = []`, 공백 메일 2통이 `stored`에 포함.
- 공백 메일 항목 **2행**(각 1행 — 중복 없음. `items (user_id, idempotency_key)` unique가 보장하는 것을 실측으로 확인).
- `gmail_process_jobs = new_gmail_items` — 재적재가 이미 있는 항목에 `process` 잡을 만들지 않는다(Ruling 14 비용 = Gmail API만, F7).
- 90일 `gap`: `missing = []`.
- `latency`: `connect_excluded ≥ 1`(재연결 sync 제외 확인, 관찰).
- 공백 메일 제안 푸시(수신 1~2일 전 → 백필 억제 대상 아님, F6)는 관찰로 적는다.
실패 시: 공백 창 누락 → 그 id의 fetch 잡 상태(③b3 Step 3 방법), `gmail_discard` 사유 코드(대시보드 worker 로그의 `gmail_discard` 코드만). `gmail_process_jobs > new_gmail_items` → 재처리 결함, 게이트 실패·별도 태스크. 원인·조치를 적고 조치 뒤 다음 만료 주기(R + 6일·R + 8일)에 ③c1·③c2를 다시 잰다.

- [ ] **Step 6: (사용자) 합성 제안 정리**

공백 메일 제안 알림 무시, "제안" 탭 "전체 무시".

- [ ] **Step 7: PoC-6 판정·기록·커밋**

통과 = ③b 통과 + ③c1(expiring 기록·도착) + Step 1~3(`reauth_required`·invalid_grant 푸시·공백 수집 0) + Step 5 기준 전부.
- `gates.md` M1-③c 행 상태 **통과**(또는 실패): `+8일: reauth_required <ISO>(T0+<h>시간, 계기 <webhook|6h cron|watch cron>), invalid_grant 푸시 도착, L <ISO>, 공백 메일 2통 수집 0 → 재연결 R <ISO>, 재적재 N'=<n> <분>분, 공백 gap missing 0·stored ⊇ P1·P2, 공백 항목 2행, 재처리 0(process <a> = 새 항목 <a>), 90일 gap missing 0, Gmail API 약 <units> units`.
- `results.md` PoC-6 행: 상태 `1단계 흡수(M1-③)`는 그대로, "남은 실측"을 `— (M1-③ 게이트 통과 <날짜>: 백필 중 웹훅→sync 평균 <e>초, watch 수동·cron, +6일 expiring, +8일 reauth_required → 재연결 누락 0·재처리 0)`로, 갱신일·근거 커밋(③b1·③b3·③c2)을 고친다. 스펙 §14 판정 현황 PoC-6 행을 같은 값으로.
- 스펙 §16 "Gmail 7일 재인증" 항목 끝 `6일·8일 동작은 1단계 M1-③ 게이트(PoC-6 흡수).`를 `6일·8일 동작은 M1-③c에서 확인(<날짜>).`로.

```bash
git add docs/superpowers/phase1/gates.md docs/superpowers/poc/results.md docs/superpowers/specs/2026-09-22-assistant-design.md
git commit -m "docs(poc): PoC-6 absorbed gate passed in product project (M1-③c)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## 실행 순서와 다른 태스크와의 관계

| 순서 | 태스크 | 언제 | 선행 |
|---|---|---|---|
| 1 | M1-③b1 | 지금 | — (코드 리뷰 통과 후 메인이 push) |
| 2 | M1-③b2 | T0(사용자 가능 시각, 09-30 이후) | ③b1, "스펙 확인 필요" 1·4 판정 |
| 3 | M1-③b3 | T0 당일 백필 뒤 + T0 다음 날 12:17 KST 이후 | ③b2 |
| 4 | M1-③c1 | T0 + 6일 + 1시간 이후 | ③b2(T0) |
| 5 | M1-③c2 | T0 + 7일 + 6시간 이후(보통 T0 + 8일) | ③c1 |

- M1-G(PoC 은퇴)는 ③c2 통과 뒤(스펙 §15 M1 완료 기준 "연결 +8일 재인증 통과"). U13의 PoC Pub/Sub 구독 삭제는 제품 구독에 영향이 없다.
- M2-⑥b 실기기 "Gmail 데이터 삭제" 확인은 ③c2 뒤로(Global Constraints).
- 합성 메일 항목 8 + 2개가 실사용자 보관함에 남는다: M1-④b 200건 라벨 집계와 M2-⑩b 검색 평가 질문에서 `[합성` 제목 항목은 빼고 센다(두 태스크 실행 때 브리프에 적는다).
- 측정 기간 중 다른 pane의 deno 테스트는 테스트 사용자만 건드리므로 병행해도 된다. 단 ③b2 측정 창(T0 ~ 백필 끝)에는 `gap`·대량 조회를 돌리지 않는다(쿼터·워커 경합).

## Self-Review

- 범위: 1단계 계획 M1-③b Step 4(연결·백필 중 측정)=③b2, Step 5(watch)=③b3 Step 4·6, Step 6(백필 완료·규칙·누락)=③b3 Step 1~3, Step 7(기록)=③b3 Step 7, M1-③c Step 1=③c1, Step 2~4=③c2. 스펙 §15 ③ 게이트 문구(백필 중 ≤ 1분 5회 평균, +6일 expiring, +8일 reauth_required → 누락 0)와 PoC-6 흡수 항목(watch 수동+cron, OTP·카드 규칙) 전부 대응.
- 요구 사실 반영: 연결 sync 제외(F1·③b1), 백오프 합쳐짐(F3·③b1 `retried`·`mails`), Ruling 14(F7·③c2 재처리 0), Ruling C(F4·`deferred_budget`), Ruling E(비용 표·③b3 Step 2), LLM 동시 2(F4·`deferred_busy`), 0.5.0 전제(Global), 사용자/에이전트 분리(각 Step 머리), 날짜 계산(달력), 개인정보·발송 제한(Global), 비용·쿼터(추정 표).
- 자리표시자 없음. 타입·이름: `SyncRow`·`BacklogRow`·`summarize` 반환 키·`status` JSON 키가 테스트·스크립트·게이트 Step에서 같다.

---

## 스펙 확인 필요

1. **[MED] 백필이 짧아 "백필 중" 표본이 5개가 안 될 때의 보충 방법**(③b2 Step 5 `insufficient`). 같은 계정 90일 N ≈ 100이면 백필이 약 5~8분이라 30초 간격 8통으로도 모자랄 수 있다.
   - (a) **권장**: 실사용자 백필 레인에 **중복 전용** `gmail-fetch` 잡을 운영 SQL로 k개 넣어 레인을 약 k × 80초 점유하는 동안 L1~L6과 같은 합성 메일 6통(제목 `[합성 지연 보충 k]`)으로 다시 잰다. 이미 저장된 ID만 넣으므로 `insert_item`이 null → 항목·`process` 잡 변화 없음(F7). Gmail 쿼터 ≤ 5,000 units/분. 명령(k번): `$S "select enqueue_job(\$1, 'gmail-fetch', 'backfill:' || \$1, jsonb_build_object('connection_id', (select id from connections where user_id = \$1 and provider = 'gmail'), 'ids', to_jsonb(array(select substr(idempotency_key, 7) from items where user_id = \$1 and source = 'GMAIL' and idempotency_key like 'gmail:%' order by occurred_at desc limit 100)), 'backfill', true))" "$U"`. AGENTS.md §7 "실측 데이터의 jobs를 테스트가 만들지 않는다"의 예외(운영 측정 잡)로 사용자 승인이 필요하다.
   - (b) 사용자가 "다시 연결"을 반복해 제품 경로(Ruling 14 재적재)로 같은 부하를 만든다 — N ≈ 100이면 한 번에 1~2분뿐이고 **T0·`expires_at`이 바뀌어 ③c 달력이 밀린다**.
   - (c) 기준 완화(예: 백필 중 ≥ 3 + 전체 5 평균 ≤ 60초) — 스펙 §15 ③ 문구 변경.
2. **[LOW] 스펙 §7 Gmail "초기" 문구와 쿼터 수치.** 스펙은 "`messages.get(format=metadata)` 후 필요 시 full"이지만 코드는 항상 `format=full`(F11). 공식 쿼터는 `messages.get` 20 units·사용자당 분당 6,000 units(F12, 2026-09-30)라 분당 250건이면 5,000 units(83%). 권장: 스펙을 코드에 맞춰 "`messages.get(format=full)`, 240ms 간격(분당 ≤ 250건 = 사용자 한도 83%)"로 고친다(코드 변경 없음).
3. **[MED] 초안(DRAFT) 메시지 수집.** 백필 목록(`newer_than:90d -category:promotions`)과 history `messagesAdded`에는 초안이 들어오고, 초안은 저장할 때마다 새 메시지 id가 된다(추정) → 초안 개정마다 항목·추출 비용이 생길 수 있다. 스펙 §7에 초안 규칙이 없다. ③b3 Step 3 둘째 `gap --q in:drafts`와 ③b2 `mails` 행 수로 실측한 뒤 결정: 권장 (a) 백필 q에 `-in:drafts`, `gmailToItem`이 `DRAFT` 라벨을 규칙 폐기(`draft`) — 스펙 §7 규칙 추가 + 코드 태스크, (b) 그대로(보낸 뒤 사라지는 초안 항목을 감수).
4. **[MED] `gmail-fetch`의 404 처리.** 백필 목록 뒤 사용자가 메일을 **영구 삭제**하면 `messages.get` 404 하나로 fetch 잡 전체가 실패·재시도하다 5회 뒤 dead가 되고, 그 잡의 나머지 ID(최대 99개)가 누락된다(F11). 권장: T0 전에 작은 수정 태스크 — 404는 그 ID만 건너뛰고(로그 `gmail_fetch_gone` 코드) 잡을 계속한다, `gmail.test.ts`에 테스트 1개. 받아들이면 ③b3 `gap`이 누락으로 잡고 게이트가 실패한다.
5. **[LOW] 재동의가 PoC Gmail 연결을 끊을 수 있음.** 첫 연결에서 `refresh_token_stored=false`가 나와 "다시 연결 (동의 다시 받기)"(GIDSignIn `disconnect()`)를 쓰면, 같은 Web 클라이언트 동의를 쓰는 PoC 연결이 끊길 수 있다(Ruling 6과 같은 위험). PoC-6 측정은 제품으로 흡수됐고 PoC refresh token은 10-04 경 어차피 만료되므로 권장: 허용(PoC 앱의 Gmail 오류·알림은 무시).
