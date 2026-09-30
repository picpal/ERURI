# ERURI 1단계 Gmail 게이트 계획 (M1-③b 후반 · M1-③c)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 제품 프로젝트 `eruri`에 사용자 Gmail을 **새 동의로** 연결하고(T0), PoC-6에서 흡수한 Gmail 실측 게이트를 실제로 재서 기록하고 PoC-6을 마감한다. 게이트: 백필 중 웹훅→sync ≤ 1분(5회 평균)·watch 갱신(수동+cron)·OTP·카드 규칙 메일·백필 누락 0·T0+6일 `expiring` 푸시·T0+8일 `invalid_grant`→`reauth_required`→재연결 뒤 누락 0.

**Architecture:** 서버·앱 코드는 이미 배포돼 있다(M1-③a `0005`~`0009`, M2 `0012`~`0016`, 앱 0.5.0). 이 계획은 (1) T0 전에 게이트를 망가뜨리는 제품 결함 두 가지(fetch 404가 잡 전체를 죽임, 초안 수집)를 고치는 제품 코드 태스크 ③b0, (2) 게이트 스크립트 `gmail-gate.ts`를 측정 함정(연결 창 sync, 재시도 표본, 실행 중 백필 잡, PostgREST 1000행, 백필 예산 미룸, 벽시계 종료)에 맞게 고치는 도구 태스크 ③b1, (3) 사용자 조작과 에이전트 조회를 분리한 실측 태스크 4개로 이뤄진다. 실측 태스크는 제품 코드를 바꾸지 않는다 — 게이트가 실패하면 원인을 적고 별도 수정 태스크를 만든다.

**Tech Stack:** Deno 2.7(스크립트·테스트), Supabase 호스팅(Postgres 17, pg_cron, PostgREST), `npm:@supabase/supabase-js@2`, Gmail API v1, Google Pub/Sub push(`gmail-push-eruri`), ERURI 앱 0.5.0(빌드 202609302012, GoogleSignIn-iOS 8), APNs.

**Spec:** `docs/superpowers/specs/2026-09-22-assistant-design.md` — §5(Gmail 경로·7일 재인증), §7(jobs 우선순위·백필 레인·Gmail 동기화·재인증 푸시), §10(제안 대기 목록), §12 통제 2(최소화), §13(백필 예산·임베딩 월 예산·LLM 동시 2), §14(PoC-6 판정 현황), §15 ③(게이트 문구), §16(Gmail 7일 재인증, 2026-09-30 판정 14·10, 외부 리뷰 반영). 실행 규칙은 `AGENTS.md` §5-8(실측 게이트)·§6(기계)·§7(개인정보·테스트 데이터).

**출발점:** `docs/superpowers/plans/2026-09-30-phase1.md`의 Task M1-③b Step 4~7과 Task M1-③c. M1-③b Step 1~3(U8 iOS 클라이언트 `eruri-ios`, U9 구독 `gmail-push-eruri` 인증 확인, 0.5.0 업로드, `gmail-gate.ts` 커밋 `6597874`)은 끝났다(`.superpowers/sdd/2026-09-30-phase1/task-M1-3b-report.md`). 원장 `.superpowers/sdd/2026-09-30-phase1/progress.md`의 Ruling 14·C·E·M#·G와 M1-③a 이월 사항을 반영했다.

**리뷰:** Codex gpt-6-astra(8건 + 스펙 확인 a~e)와 Fable(Codex 판정 + 놓친 결함 N1~N6)을 반영한 수정판이다(끝 "리뷰 반영" 절). 두 리뷰가 다르면 Fable 판정을 따랐다.

**태스크 번호:** 1단계 계획의 ③b·③c를 이어서 `M1-③b0`(제품 수정: fetch 404·초안) · `M1-③b1`(도구) · `M1-③b2`(연결·백필 중 지연) · `M1-③b3`(백필 완료·규칙·누락·watch·③b 기록) · `M1-③c1`(T0+6일) · `M1-③c2`(T0+8일·재연결·PoC-6 마감)로 나눈다. 원장에는 `M1-3b0`처럼 적는다.

## T0 전 필수 / T0 이후로 미룸

T0를 누르기 전에 아래 "T0 전 필수"가 전부 끝나야 한다. 하나라도 빠지면 게이트를 다시 재는 데 8일이 든다.

| # | T0 전 필수 | 어디서 | 왜 |
|---|---|---|---|
| 1 | **사용자 확인 2건**: UC-1 PoC Gmail 동의 철회(되돌릴 수 없음), UC-2 에이전트 Gmail 커넥터로 본인→본인 합성 메일 발송. 거절 시 대체 경로 확정 | "사용자 확인" 절 | UC-1: 7일 시계가 PoC 동의(09-27)에 묶이면 +6일 푸시를 못 잰다(N1). UC-2: 발송 방식이 ③b2 시간표를 정한다 |
| 2 | **M1-③b0**: fetch 404는 그 id만 건너뛰고 `gmail_fetch_gone` 기록, 초안 제외(`-in:drafts` + `DRAFT` 라벨 폐기), 스펙 §7 `format=full`·쿼터·초안·404 문구. 배포·smoke-gate 회귀 | Task ③b0 | 사용자가 직접 발송하면 Gmail 앱 자동 저장 초안 id가 같은 fetch 잡에 들어가 404 → 잡 dead → **합성 메일 발송본이 저장되지 않는다**(결정 d) |
| 3 | **M1-③b1 수정판**: 재시도 sync도 표본(플래그), `busy(t)`(실행 중 잡 포함), 연결 창 제외, `gap --from-jobs`·쉼·404 `gone`·조회 오류 throw, `status.backfill.stalled`, `--connection`·전용 테스트 사용자 7 | Task ③b1 | Codex #2·#3·#4·#6·#8, N2·N3 |
| 4 | **명령 예제 zsh 호환**: `$G`·`$S` 변수 대신 셸 함수 `g`·`s` | Global Constraints, 모든 Step | zsh는 변수 단어 분리를 안 한다 — T0 직후 45초 안에 명령이 돌아야 한다(Codex #7) |
| 5 | **DB 테스트 범위 격리**: 조회를 `--connection <id>`로, 테스트 사용자 `testUser(7)` 전용, 전역 `test:%` 개수 검사 삭제 | Task ③b1 Step 5·8 | 다른 pane 테스트와 충돌(Codex #8) |
| 6 | **"전체 무시" 사용 금지** → 제목에 `합성`이 들어간 제안만 개별 무시 | ③b2 Step 7, ③c2 Step 6, U10-3, U11-2 | `dismissAll()`은 90일 백필의 **실제 미래 일정 제안**까지 지운다(Codex #1) |
| 7 | ③b2 사전 점검에 **백필 레인 잔여 0**(우선순위 40 `queued`·`running` = 0, 예산 미룸 제외, dead 0) | ③b2 Step 1 | 남은 레인 잡이 "백필 중" 표본을 부풀린다(N6) |

| T0 이후로 미룸 | 언제 | 이유 |
|---|---|---|
| 백필 fetch 잡 50 ID 분할(`gmail-connect` 목록 페이지 100 → 잡 2개) — 후속 태스크 **M1-③x1** | 계정 확대 전(3단계) 또는 ③c2 뒤 | N ≈ 100이라 이번 게이트와 무관. T0 전 제품 변경은 최소로(N2). 이번 게이트에서는 `status.backfill.stalled`로 벽시계 종료를 구분만 한다 |
| Gmail 실할당량 확인(GCP 콘솔 → APIs → Gmail API → Quotas, 사용자당 분당 units) | 선택, ③b3 뒤 아무 때 | 증분 22 units/통, 백필 fetch 1개당 ≤ 5,000 units/분 < 6,000(Codex #6 부분) |
| M1-G PoC 정리 범위 갱신 — UC-1로 동의를 T0 전에 철회하면 PoC 행 삭제만 남는다(Ruling 6 위험 소멸) | M1-G 실행 때 | UC-1 결과에 따라 달라진다 |
| ③b3 Step 6(watch cron), ③c1, ③c2 | 달력대로 | — |

## 사용자 확인 (T0 전, 메인 세션이 받는다)

- [ ] **UC-1: PoC Gmail 동의 철회 — 되돌릴 수 없음**

사용자에게 묻는다: "T0 직전에 Google 계정 → 보안 → **서드파티 앱 및 서비스** 에서 이 프로젝트(ERURI/PoC와 같은 GCP 프로젝트·같은 Web 클라이언트)의 앱 액세스를 삭제해도 되는가. PoC Gmail 연결이 즉시 끊긴다(PoC-6은 이미 흡수됐고 PoC 토큰은 10-04 경 어차피 만료)."
- 승인 → ③b2 Step 2에서 T0 직전에 사용자가 삭제한다. 그 뒤 첫 "Gmail 연결"은 반드시 동의 화면을 띄운다 → 새 동의로 T0.
- 거절 → 그대로 진행하되 ③b2 T0를 **잠정**으로 적고, 달력에 **10-04(일) 15:10 KST 이후 `g status` 점검**을 넣는다. 이때 `reauth_required`면 동의 기준 만료 확정(PoC 동의 09-27 03:01Z + 7일) → 즉시 "다시 연결 (동의 다시 받기)", 그 `status.t0`가 새 T0이고 달력을 다시 계산한다. `active`면 잠정 T0를 확정한다.

- [ ] **UC-2: 합성 메일 발송 방식 — 에이전트 Gmail 커넥터(본인→본인)**

사용자에게 묻는다: (A) ③b2·③c2를 맡은 에이전트가 Gmail 커넥터(`send_message`)로 합성 메일을 **연결할 계정 주소 → 같은 주소**로 보내도 되는가. 승인이면 사용자가 **"커넥터 계정 = 연결할 계정"을 구두로 확인**한다(주소는 사용자가 말한 값을 발송 인자로만 쓰고 명령·SQL·기록에 넣지 않는다, N4).
- 승인 → A. ③b2 Step 4에서 L1이 2분 안에 `mails`에 1행으로 잡히는지로 자가 확인하고, 0행이면 그 자리에서 B로 전환한다.
- 거절 또는 커넥터를 그 세션에서 쓸 수 없음 → **B: 사용자가 직접 발송**. 합성 메일 문구 표를 메모 앱에 옮겨 두고, 시간표대로 작성 창에 붙여넣고 바로 보낸다. Gmail 앱의 자동 저장 초안은 ③b0 뒤 수집되지 않고(`DRAFT` 폐기, `-in:drafts`) 초안 id 404가 잡을 죽이지 않는다. 그래도 초안을 미리 만들어 두지는 않는다.

두 결과(UC-1 승인/거절, UC-2 A/B)를 `.superpowers/sdd/2026-09-30-phase1/progress.md`에 Ruling으로 적고 ③b2 지시문에 넣는다.

## 원 계획 대비 바뀐 점

| 원 계획(1단계 계획 M1-③b Step 4~7, M1-③c) | 이 계획 | 근거 |
|---|---|---|
| T0 = 사용자가 연결한 시각 | T0 = **새 동의** 뒤 `connections.expires_at − 7일`(`status.t0`). 동의 화면(Gmail 체크박스)이 떴음을 사용자가 확인해야 T0로 인정. PoC 동의는 T0 전에 철회(UC-1) | Google 테스트 모드 승인은 동의 시점부터 7일. 같은 GCP 프로젝트·Web 클라이언트·계정의 PoC 동의(09-27)가 남아 있으면 10-04에 끊겨 +6일 푸시를 못 잰다(N1) |
| — | T0 전 제품 수정 ③b0: fetch 404는 그 id만 건너뜀, 초안 제외 | 결정 c·d |
| 합성 메일 5통, 1분 이상 간격 | 지연 측정 6통 + OTP 1 + 카드 1 = 8통. 간격은 N으로(N < 180 → 30초, N ≥ 180 → 65초). 표본 부족 시 **일반 "Gmail 연결" 재탭**으로 보충(최대 3회) | PoC-6 같은 계정 N = 85 → 백필 5~8분(결정 a) |
| `latency`: `via:webhook` sync 전부를 표본으로 | 연결 창([묶음 시작 − 30초, 끝 + 30초]) sync 제외. **재시도 sync는 표본에 포함**(플래그만). "백필 중" = 적재 시각에 레인 잡이 미클레임이거나 **실행 중**(`busy > 0`) | `claim_jobs`는 첫 클레임 시각을 보존한다(0005·0007) — 재시도 sync의 지연도 유효 표본(Codex #2). 단일 fetch 실행 중엔 미클레임 0(Codex #4) |
| — | `mails`: 합성 메일별 Gmail 수신→저장 지연. **6행 필수**, `max_delay_s > 180`이면 원인 분류 필수 | 백오프로 합쳐진 웹훅은 sync 표본에 드러나지 않는다 |
| `status`: 백필 대기 잡 수, 1000행까지 | 백필 레인 분류(진행·**stalled**·백오프·예산 미룸·LLM 대기·dead), N, 사용량, T0, 전 행 페이지 | Ruling C, PostgREST 1000행, Edge 벽시계(N2) |
| watch 수동 갱신 뒤 "약 +7일" | `watch_expires_at ≈ 지금 + 7일`, cron 뒤 ≈ cron 시각 + 7일 | watch 만료는 호출 시점 + 7일 |
| 누락 확인 `gap --after <T0 − 1일>` | **ID 대조(주)** `gap --from-jobs`(백필 잡 `payload.ids` 전체 ↔ items) + **기간 gap(보조)** `--after <T0 − 89일> --before <지금 − 5분>` | 경계와 무관하게 fetch dead·404 유실을 잡는다(Codex #3) |
| ③c 공백 시작 = `reauth_required` 시각 − 1일 | 재연결 **전에** 기록한 `sync.last_success_at`(L) − 1일 | 재연결이 `cursor`·`last_success_at`을 덮는다(F7) |
| 재연결 뒤 누락 0 | + P1·P2 **Gmail id 기준** 저장, 재처리 0을 직접 조회(`captured_at < R`인 항목에 R 뒤 `process` 잡 0), 재적재 종료 = active·backoff·deferred_busy·stalled 0 + dead 0 | Codex #5 |
| +6·+8일 | 달력(T0 = **10-01(목) 14:00 KST** 예, T0는 10:00~18:00 KST 권장) | +6일 푸시가 잠든 시간에 떨어지지 않게(N5) |

## Global Constraints

- **전제:** 앱 ERURI **0.5.0 (202609302012)** 설치(`GIDClientID`·`GIDServerClientID` 포함, ③b 보고 검증), Apple 로그인 사용자 = `supabase/.env`의 `ERURI_USER_ID`, 기기 `devices` production 등록, Pub/Sub 구독 `gmail-push-eruri`(만료 없음, 인증 확인 09-30 20:11 KST). **제품 코드는 Task ③b0만 바꾼다**(fetch 404·초안, 스펙 §7 먼저). ③b1은 `supabase/scripts/`·`supabase/tests/gmail-gate*`만, 실측 태스크는 기록 파일만.
- **측정 기간(T0 ~ Task ③c2 완료) 금지:** 앱 설정 "Gmail 데이터 삭제 (연결 해제)"·"계정 전체 삭제"·로그아웃·앱 삭제·알림 끄기, ③c2 Step 4 전의 **재동의**("다시 연결 (동의 다시 받기)", 단 ③b2 Step 3의 T0 확정용 재동의는 예외), 제안 탭 **"전체 무시"**, `delete_gmail_source`·`purge_*` 수동 실행, 실사용자 `items`·`jobs`·`connections` 수정. 예외는 이 계획이 적은 운영 호출(`gmail_enqueue_all(<kind>, ERURI_USER_ID)`)과 결정 (a)의 일반 "Gmail 연결" 재탭 보충뿐이다. **M2-⑥b의 실기기 "Gmail 데이터 삭제" 확인은 ③c2 뒤로 미룬다**(연결이 지워지면 달력 게이트가 처음부터 다시 7일).
- **개인정보(AGENTS.md §7, 스펙 §12):** 스크립트·명령 출력과 기록에는 id·상태·개수·시각·불리언만. 실메일 본문·제목·발신자·**계정 주소**를 출력·명령 인자·기록에 넣지 않는다(커넥터 발송 인자만 예외, UC-2). 제목 조건은 **합성 접두**(`[합성 지연 테스트`·`[합성 지연 보충`·`[합성카드테스트]`·`[합성] 로그인`·`[합성 공백 테스트`)로만 쓰고 결과에 제목을 싣지 않는다. `gap`은 메시지를 메모리에서 규칙으로만 판정한다. `items.content_enc`를 복호화해 보지 않는다. 대시보드 로그를 기록에 붙일 때도 코드·id만.
- **메일 발송:** 합성 문구만, **보내는 주소 = 받는 주소 = 연결한 Gmail 계정**(본인 계정 외 발송 금지). A 방식(에이전트 커넥터)은 UC-2 승인 + 커넥터 계정 = 연결 계정 구두 확인일 때만.
- **명령:** 저장소 루트에서. 셸 상태가 호출 사이에 남지 않으므로 **각 셸 호출 앞에 다음 머리 3줄**을 붙인다(zsh·bash 모두 동작 — 변수에 명령을 담지 않는다). `.env`를 `source`하지 않는다. 아래 Step의 명령 블록은 이 3줄을 생략하고 `# 머리 3줄` 로만 표시한다.

```bash
g() { deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/gmail-gate.ts "$@"; }
s() { deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/sql.ts "$@"; }
U="$(grep '^ERURI_USER_ID=' supabase/.env | cut -d= -f2)"
```

- **시각:** 명령 인자는 UTC ISO(`2026-10-01T05:00:00Z`), 사용자에게 보여 줄 때는 KST. cron은 UTC 기준: `gmail-watch-daily` `17 3 * * *`(12:17 KST), `gmail-sync-every-6h` `0 */6 * * *`(09·15·21·03시 KST), `gmail-reauth-hourly` `7 * * * *`, `worker-every-minute`.
- **테스트(Task ③b0·③b1):** `deno test --allow-net --allow-env --allow-read --env-file=supabase/.env <파일>`. 전 `pgrep -x xcodebuild`가 비어 있어야 하고 `vm_stat | grep -E 'free|compressor'`를 본다. 호스팅 DB 테스트는 전용 테스트 사용자·실행 태그 `test:<run>`만 만들고 **자기 행만** 지운다.
- **모델(AGENTS.md §3):** ③b0·③b1 `opus`/`high`(코드). ③b2·③b3·③c2 `opus`/`medium`(흡수 PoC 실측 판정). ③c1 `sonnet`/`medium`(조회·확인 위주).
- **기록:** `docs/superpowers/phase1/gates.md`(M1-③b0·M1-③b·M1-③c 행), `docs/superpowers/poc/results.md` PoC-6 행, 스펙 §14 판정 현황 PoC-6 행(같은 값), ③c2에서 §16 "Gmail 7일 재인증" 줄. gates.md 커밋 칸은 자기 SHA라 비우고 메인이 채운다. 상태는 **통과·실패·대기**만("부분"은 마감 아님, AGENTS.md §5-8).
- **커밋:** 태스크마다. 트레일러 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. **push 금지**(메인이 회수 후 `git push origin main`).

## 이 계획이 기대는 사실 (코드·원장·보고서에서 확인, 2026-09-30)

| # | 사실 | 출처 |
|---|---|---|
| F1 | `gmail-connect`는 교환 → profile → **저장** → **watch** → 90일 목록(`newer_than:90d -category:promotions`, ③b0 뒤 `-in:drafts` 추가, 페이지 100개)마다 백필 `gmail-fetch` 잡(lease `backfill:<user>`, `backfill:true`) → 마지막에 `gmail_enqueue_for_account`로 초기 sync(`via:"webhook"` 표식). watch가 부르는 즉시 알림은 **묶음보다 앞서** 진짜 웹훅 sync를 만들 수 있다 | `gmail-connect/handler.ts:68~96`, M1-③a 보고 우려 2 |
| F2 | 우선순위 notify 10 · gmail-* 20 · process 30 · 백필 40(`payload.backfill = true`면 40, 0005 트리거). 백필 레인(fetch → process → embed)은 lease `backfill:<user>` 하나라 **직렬**, 같은 우선순위 안에서는 `created_at` 순. 워커는 매분 cron + 호출당 100초 동안 1건씩 클레임(인스턴스 최대 2개 겹침), 임대 180초, Edge 벽시계 150초 | 0005, `worker/index.ts`·`batch.ts` |
| F3 | 실패한 잡은 `not_before = now + attempts × 60초`. `gmail_enqueue_for_account`는 같은 연결에 queued sync가 있으면 새 잡을 만들지 않는다 → 백오프 중 도착한 웹훅은 그 잡에 합쳐지고 최대 4분 늦는다(누락은 없음, 커서 기반) | 0007, 0005 |
| F4 | 백필 추출은 월 행 `backfill_reserved_krw` 상한 **1,500원**(Ruling C). 소진되면 `defer_job`으로 **다음 달 1일 00:00 KST**까지(`last_error = budget_exhausted`, 실패 아님). 백필 항목 임베딩은 **월 예산**(Ruling E, 0016). LLM 동시 호출 사용자당 2(`llm_busy`, 30초). Jev는 예약하지 않는다(Ruling 10) | 0014, 0016, `worker/text.ts`, `_shared/budget.ts` |
| F5 | 추출 입력은 본문 4,000자에서 자른다, 출력 상한 512토큰. 예약 추정 = (본문 길이 + 1,200) 입력 + 400 출력 토큰 | `_shared/extract-text.ts`, `worker/text.ts` |
| F6 | 백필 제안(수신이 수집보다 3일 이상 과거)은 푸시하지 않지만 **대기 목록에는 나온다**. 합성 메일과 ③c2 공백 메일은 제안 푸시가 간다 | 스펙 §7 notify, §10 |
| F7 | 재연결(`gmail_save_connection`)은 `(provider, account_ref)` upsert라 **같은 연결 id**를 유지하고 status → active, `expires_at = now + 7일`(refresh token이 있을 때만), **`cursor`를 새 profile historyId로, `last_success_at = now()`로 덮는다**. 트리거가 그 연결의 `reauth_pushes`를 지운다(0008·0009). 이어서 90일 목록을 다시 넣는다(Ruling 14). 이미 있는 항목은 `insert_item`이 null → `process` 잡 없음 | 0001:236~249, 0005, 0008·0009 |
| F8 | `reauth_required`인 동안 웹훅·6시간 cron·watch cron은 잡을 만들지 않는다. 재인증 대상: `expires_at < now + 24h`이고 active → `expiring`, `reauth_required` → `invalid_grant`. 창 키 = `expires_at` epoch 초. invalid_grant는 발생 즉시 `gmail_enqueue_reauth(p_user)`. 기기 0개면 기록을 풀고 매시 다시 | 0001, 0006, 0008, `_shared/gmail-jobs.ts`, `worker/reauth.ts` |
| F9 | 재인증 푸시 문구: 제목 "Gmail 다시 연결 필요", 본문 expiring "Gmail 연결이 24시간 안에 만료됩니다. 앱에서 다시 연결하세요." / invalid_grant "Gmail 연결이 끊겼습니다. 앱에서 다시 연결하세요." | `worker/reauth.ts` |
| F10 | 앱 설정 Gmail 절: 상태 줄, "Gmail 연결", "다시 연결 (동의 다시 받기)"(GIDSignIn `disconnect()` 후 재동의, 연결 여부와 무관하게 활성). 결과 줄에 `refresh_token_stored`·`backfill_messages` | `ios/App/ContentView.swift:34~35`, `ios/App/GoogleSignIn.swift:31~34` |
| F11 | `gmail-fetch`는 메시지마다 `messages.get(format=full)` + 240ms 쉼(**fetch 실행 1개당** 분당 ≤ 250건), 10건마다 연결 존재 확인. **③b0 전**: `messages.get` 404 하나가 잡 전체를 실패·재시도(5회 뒤 dead). **③b0 뒤**: 404는 그 id만 건너뛰고 `gmail_fetch_gone`, 429·5xx는 잡 실패·백오프 | `_shared/gmail-jobs.ts:80`, `_shared/gmail.ts:77` |
| F12 | Gmail API 쿼터(공식 문서 2026-09-30): 프로젝트 분당 1,200,000 units, **사용자당 분당 6,000 units**. `messages.get` 20, `messages.list` 5, `history.list` 2, `watch` 100, `getProfile` 1 | developers.google.com/workspace/gmail/api/reference/quota |
| F13 | 같은 계정 PoC-6(09-27) 90일 백필 = 85 ID → 76행, `gmail-fetch` 1잡 67초(건당 약 0.8초) | `docs/superpowers/poc/results.md` PoC-6 |
| F14 | PoC 프로젝트도 같은 Pub/Sub 토픽을 구독하고 **같은 GCP 프로젝트·Web 클라이언트·Gmail 계정**을 쓴다. PoC Gmail 동의 09-27 03:01Z(→ 10-04 12:01 KST 만료). 어느 코드도 `users.stop`을 부르지 않는다 | results.md PoC-6, Ruling 6 |
| F15 | `claim_jobs`는 `claimed_at = coalesce(claimed_at, now())` — 재시도해도 **첫 클레임 시각**이 남고, 클레임·종료·실패마다 `updated_at = now()` | 0005·0007 |
| F16 | Gmail 초안은 저장할 때마다·발송할 때 **메시지 id가 바뀐다**(공식 동작). history 한 번에 `[초안 id, 발송본 id]`가 같이 들어와 같은 fetch 잡이 될 수 있다 | Gmail API drafts 문서, Fable 결정 d |

## 추정: 90일 백필 규모·시간·비용·Gmail 쿼터

N = 연결 시 90일 목록 ID 수(프로모션·초안 제외). 기대값은 PoC-6 같은 계정 실측으로 **N ≈ 100**, 상한은 스펙 §13 가정 **N = 1,800**. 통과율 = 규칙·Jev 게이트를 지나 추출까지 가는 비율(미측정 → 50%~100%).

| 항목 | 건당 | N ≈ 100 | N = 1,800 |
|---|---|---|---|
| fetch 시간 | 약 0.8초(F13) | 약 1.3분 | 약 24분 (**벽시계 주석** 아래) |
| process 시간 | 추출 약 2.5초 / Jev 폐기 약 0.5초 | 2.5~4분 | 45~75분 |
| embed 시간 | 약 0.8초(추출·empty 항목만) | 약 0.7~1.3분 | 12~24분 |
| **백필 전체**(워커 가동률 ×1.2) | 약 N × 3~5초 | **약 5~8분** | **약 1.5~2.5시간** (벽시계 종료 시 더 길다) |
| 추출 비용(백필 예산 1,500원/월) | 실제 약 0.3~0.6원, 상한 약 1.1원 | 15~60원 (상한 110원) | 270~1,080원 (**상한 약 1,980원 > 1,500원 → 초과분 다음 달로 미룸**) |
| 임베딩 비용(월 예산 1만원, Ruling E) | 약 0.25원 | 약 13~25원 | 약 225~450원 |
| Jev(예약 없음) | 약 0.04원 | 약 4원 | 약 76원 |
| 재연결 재적재(Ruling 14) | 이미 있는 항목은 LLM 0원 — Gmail API만 | Gmail만 | Gmail만 |
| 합성 메일 10~16통(월 예산) | 추출 약 0.5원 + 임베딩 0.25원 | 약 8~12원 | 약 8~12원 |

**벽시계 주석(N2, 코드 산술·미실측):** 백필 fetch 잡은 목록 페이지 단위 100 ID ≈ 80초. 워커 호출은 100초 예산 안에서 클레임을 반복하므로, 첫 잡을 79초에 끝낸 인스턴스가 곧바로 둘째 잡을 잡으면 150초 벽시계에 걸려 실행 중 종료된다 → 임대(약 3분)가 남아 레인이 멈추고 다음 인스턴스가 처음부터 다시 돈다(중복 무해, 누락 없음). N = 1,800이면 둘째 잡부터 잡당 약 6분 → fetch 약 1시간 45분. `status.backfill.stalled`(running인데 `leased_until < now`)와 `attempts ≥ 2`·`last_error null`인 fetch 잡이 이 현상이고 결함이 아니다. 제품 수정(백필 잡 50 ID)은 T0 이후 M1-③x1.

Gmail API(F12, 사용자당 분당 6,000 units):

| 호출 | units | N ≈ 100 | N = 1,800 |
|---|---|---|---|
| 연결: `getProfile` 1 + `watch` 100 + `messages.list` ⌈N/100⌉ × 5 | | 106 | 191 |
| 백필 fetch: `messages.get` N × 20 | **fetch 실행 1개당** 분당 ≤ 250건 → ≤ 5,000 units/분(83%). PoC-6 실측 76건/분 → 1,520 units/분 | 2,000 | 36,000(≥ 7.2분) |
| 증분: 메일 1통 = `history.list` 2 + `messages.get` 20 (증분 fetch는 lease `gmail:<conn>`이라 백필과 겹칠 수 있다 — 통당 22 units라 5,000 + 수십 < 6,000) | | 22/통 | 22/통 |
| 매일 watch 100, 6시간 sync `history.list` 2~ | | 약 108/일 | 약 108/일 |
| 재연결·보충 재탭 1회 | 연결과 같음 | 2,106 | 36,191 |
| `gap` | `messages.list` 페이지 × 5 + **저장 안 된 ID만** `messages.get` × 20, **240ms 쉼**(≤ 5,000 units/분), 429는 5초 뒤 1회 재시도 | 수십~수백 | 90 + 규칙 폐기 수 × 20 |

결론: 쿼터 안이다. 사용자 한도는 백필 fetch 단독으로 최대 83%까지 쓰므로 **백필 fetch 단계(레인에 `gmail-fetch`가 남아 있는 동안)에는 넓은 `gap`을 돌리지 않는다**(합성 제목 `--q` 한 통짜리는 30 units 미만이라 허용). 겹쳐 429가 나면 fetch 잡이 실패·백오프한다(F3).

## 달력 (T0 기준, KST)

T0는 **10:00~18:00 KST**에 잡는다(+6일 푸시·+8일 끊김이 깨어 있는 시간에 오도록). 예시 T0 = **2026-10-01(목) 14:00 KST (05:00Z)**. T0 전 필수(③b0·③b1·리뷰·배포)가 그 전에 끝나야 한다.

| 항목 | 규칙 | T0 = 10-01(목) 14:00 예 |
|---|---|---|
| (UC-1 거절 시만) PoC 동의 기준 만료 점검 | PoC 동의 09-27 03:01Z + 7일 = 10-04 12:01 KST → 다음 6시간 cron 15:00 + 클레임 여유 | **10-04(일) 15:10 이후** `g status` |
| watch cron 확인(③b3 Step 6) | T0 뒤 첫 12:17 KST(03:17 UTC) 이후 | **10-02(금) 12:17 이후** |
| `expiring` 푸시(③c1) | `expires_at − 24h` = T0 + 6일, 매시 :07 cron + 워커 클레임 1분 → T0 + 6일 + 1시간 5분 안 | **10-07(수) 14:07 경**, 15:10 이후 확인 |
| refresh token 만료 | T0 + 7일(Google 테스트 모드, 새 동의 기준) | 10-08(목) 14:00 경 |
| `reauth_required` 늦어도 | 만료 뒤 첫 refresh 시도: 웹훅 sync(메일 도착) 또는 6시간 cron(09·15·21·03시 KST) + 클레임·실행 수 분 | 10-08(목) 15:10 경 |
| ③c2 세션 | **시작 조건 = `g status`의 `connection.status = reauth_required` 확인**(시각이 아니다). 보통 T0 + 7일 + 수 시간 ~ T0 + 8일 | **10-08(목) 저녁 ~ 10-09(금, 한글날)** |

다른 T0: 10-02(금) 14:00 → watch 10-03(토), +6일 10-08(목) 14:07, 만료 10-09(금) 14:00, ③c2 10-09 저녁 ~ 10-10(토). 연결 시각이 다르면 시·분을 그대로 옮긴다. T0는 항상 마지막 `status.t0`(보충 재탭·T0 확정 재동의로 몇 분 움직일 수 있다). T0가 월 경계면 백필 금액이 두 월 행에 나뉜다(`seoul_month()`).

## Review Focus

1. **T0가 새 동의가 아니다**(N1): 동의 화면 없이 `refresh_token_stored=true`면 7일 시계가 PoC 동의에 묶여 있을 수 있다 → UC-1 철회, ③b2 Step 3이 "동의 화면 떴음" 확인을 통과 기준으로 둔다. 거절 시 10-04 점검.
2. **백필이 너무 짧아 "백필 중" 표본이 5개가 안 된다**(N ≈ 100이면 5~8분): 표본 부족이 통과로 보이면 안 된다 → `summarize`가 `insufficient`(③b1 테스트), 보충은 일반 "Gmail 연결" 재탭(결정 a), 그래도 부족하면 **대기**로 두고 ③c2 재적재 창에서 이어 모은다.
3. **표본 오염·소실**: 연결 창 sync(watch 즉시 알림 + 초기 sync)는 웹훅 지연이 아니다(F1) → `connectSyncIds` 창 방식. 재시도 sync는 **표본에 남긴다**(F15) → `classify`의 `retried` 플래그. 단일 fetch 실행 중·중복뿐인 재적재에서도 "백필 중"을 잡아야 한다 → `busyAt`(③b1 테스트 3건). 백오프로 합쳐진 웹훅은 `mails` 6행·`max_delay_s` 원인 분류로 본다.
4. **백필 레인이 비지 않거나 조용히 잃는다**: 예산 미룸(F4)은 다음 달까지 queued, 벽시계 종료는 stalled, 404·초안은 ③b0로 제거 → `backlog`(③b1 테스트), 누락은 `gap --from-jobs`(ID 대조)로 경계와 무관하게 잡는다. `gap` 자체의 조회 오류는 "누락 없음"이 아니라 예외다.
5. **재연결이 공백의 기준 시각을 지운다**(F7): ③c2 Step 1이 재연결 **전에** L을 기록하고, Step 5가 P1·P2 id 기준 저장·재처리 0 직접 조회·재적재 종료 조건을 잰다.

---

## 파일 구조

```text
supabase/functions/_shared/gmail-jobs.ts   # 수정(③b0) gmailFetch: messages.get 404 → 그 id만 건너뜀(gmail_fetch_gone)
supabase/functions/_shared/gmail.ts        # 수정(③b0) gmailToItem: DRAFT → discard(draft), resync q -in:drafts
supabase/functions/gmail-connect/handler.ts # 수정(③b0) BACKFILL_QUERY -in:drafts
supabase/tests/gmail.test.ts               # 수정(③b0) 404·초안·q 테스트
supabase/scripts/_gmail-gate.ts            # 신규(③b1) 판정 로직: bursts·connectSyncIds·busyAt·classify·summarize·backlog·mailDelays·t0Of·judgeIds
supabase/scripts/gmail-gate.ts             # 교체(③b1) run(), --connection, status 확장, latency 표본 규칙, mails, gap(--from-jobs, 쉼, 404 gone)
supabase/tests/gmail-gate.test.ts          # 신규(③b1) 순수 테스트
supabase/tests/gmail-gate-db.test.ts       # 신규(③b1) 호스팅 DB — 테스트 사용자 7의 합성 연결로 run() 호출
docs/superpowers/phase1/gates.md           # ③b0, ③b2·③b3(M1-③b 행), ③c1·③c2(M1-③c 행)
docs/superpowers/poc/results.md            # PoC-6 행(③b3, ③c2)
docs/superpowers/specs/2026-09-22-assistant-design.md   # §7 Gmail(③b0), §14 PoC-6 행(③b3, ③c2), §16 Gmail 7일 재인증 줄(③c2)
```

## 사용자 작업 모음

| # | 언제 | 사용자가 할 일 | 태스크 |
|---|---|---|---|
| UC-1 | 지금(T0 전) | PoC Gmail 동의 철회 승인/거절 | 사용자 확인 |
| UC-2 | 지금(T0 전) | 에이전트 커넥터 발송(A) 승인 + 커넥터 계정 = 연결 계정 구두 확인, 또는 직접 발송(B) | 사용자 확인 |
| U10-0 | T0 직전 | TestFlight ERURI **0.5.0 (202609302012)** 확인, 설정 "로그인됨"·알림 허용 확인. (UC-1 승인 시) Google 계정 → 보안 → 서드파티 앱 및 서비스 → 이 프로젝트 앱 **액세스 삭제**. (B일 때) 메모 앱에 합성 문구 준비 | ③b2 |
| U10-1 | T0 | 설정 → **"Gmail 연결"** → **Google 동의 화면(Gmail 읽기 체크박스)이 떴는지 에이전트에게 알림** → 체크 → 결과 줄 확인. 에이전트가 요청하면 "다시 연결 (동의 다시 받기)" 한 번 | ③b2 |
| U10-2 | T0 + 45초부터 | (B일 때) 합성 메일 8통을 시간표대로 본인 주소로 발송 | ③b2 |
| U10-2b | 에이전트가 "표본 부족"이라 할 때 | 일반 **"Gmail 연결"**(재동의 아님)을 에이전트 신호마다 다시 누름(최대 3회). (B일 때) 신호에 맞춰 보충 메일 발송 | ③b2 |
| U10-3 | ③b2 측정 뒤 | 합성 제안 알림은 무시. 앱 "제안" 탭에서 **제목에 `합성`이 들어간 제안만 하나씩 "무시"**. **"전체 무시"는 누르지 않는다**(실제 백필 일정 제안까지 지워진다) | ③b2 |
| U10-4 | (UC-1 거절 시) 10-04 15:10 이후 에이전트 신호 | `reauth_required`로 확인되면 "다시 연결 (동의 다시 받기)" → 새 T0 | 달력 |
| U11-1 | T0 + 6일 + 1시간 이후 | 잠금화면 "Gmail 다시 연결 필요 / …24시간 안에 만료…" 알림 확인. **재연결하지 않는다** | ③c1 |
| U11-2 | ③c2 | "…Gmail 연결이 끊겼습니다…" 알림 확인 → (B일 때) 공백 메일 2통 발송 → 에이전트 신호 뒤 **"다시 연결 (동의 다시 받기)"** → 합성 제안만 개별 무시 | ③c2 |
| — | T0 ~ ③c2 끝 | 로그아웃·앱 삭제·알림 끄기·"Gmail 데이터 삭제"·"계정 전체 삭제"·"전체 무시" 하지 않기. ERURI 앱 알림만 판정에 쓴다 | 전체 |

### 합성 메일 문구 (보내는 주소 = 받는 주소 = 연결 계정)

| 코드 | 제목 | 본문 |
|---|---|---|
| L1~L6 | `[합성 지연 테스트 k]` (k = 1~6) | `10월 2k일 오후 4시 합성 미팅이 있습니다. ERURI 게이트 합성 메일입니다.` (k=1 → 21일 … k=6 → 26일) |
| O1 | `[합성] 로그인 인증번호` | `인증번호 482913 를 3분 안에 입력하세요` |
| C1 | `[합성카드테스트] 4532-0151-1283-0366 승인 32,000원` (Luhn 유효) | `합성 결제 알림 메일입니다.` |
| S1~S6 | `[합성 지연 보충 k]` (k = 1~6, 표본 보충 때만) | `ERURI 게이트 합성 보충 메일입니다.` (일정 문구 없음 → 제안 없음) |
| P1·P2 | `[합성 공백 테스트 1]`·`[합성 공백 테스트 2]` | `11월 1일 오전 10시 합성 점검` · `11월 2일 오전 10시 합성 점검` |

---

### Task M1-③b0: fetch 404 건너뜀 · 초안 제외 (T0 전 제품 수정)

**모델:** `opus`/`high` (TDD)

이 태스크만 제품 코드를 바꾼다. 스펙 §7을 먼저 고치고(AGENTS.md §1 "스펙과 코드가 다르면 스펙을 먼저"), 테스트 → 구현 → 리뷰 → 배포 → smoke-gate 회귀 순이다. ③b1과 파일이 겹치지 않아 다른 pane에서 병행해도 된다(호스팅 DB 테스트는 서로 다른 테스트 사용자).

**Files:**
- Modify: `docs/superpowers/specs/2026-09-22-assistant-design.md` §7 "Gmail 동기화"
- Modify: `supabase/functions/_shared/gmail-jobs.ts`(`gmailFetch`), `supabase/functions/_shared/gmail.ts`(`GmailItem`·`gmailToItem`·`resync`), `supabase/functions/gmail-connect/handler.ts`(`BACKFILL_QUERY`)
- Modify: `supabase/tests/gmail.test.ts`
- Modify: `docs/superpowers/phase1/gates.md`(M1-③b0 행)

**Interfaces:**
- Produces: `GmailItem` discard 사유에 `"draft"` 추가(③b1 `gap`의 `discarded_by_rule.draft`가 쓴다). worker 로그 코드 `gmail_fetch_gone`, `gmail_fetch` 요약에 `gone` 수. 백필·재동기화 목록 q에 `-in:drafts`.

- [ ] **Step 1: 스펙 §7 "Gmail 동기화"를 고친다**

`- 초기: …` 줄을 다음으로 바꾼다:

```markdown
- 초기: `messages.list q="newer_than:90d -category:promotions -in:drafts"`(페이지 100개 = 백필 `gmail-fetch` 잡 1개) → `messages.get(format=full)`, 240ms 간격(**fetch 실행 1개당** 분당 ≤ 250건 = 5,000 units, 사용자당 분당 6,000 units의 83%. 계정 전체 보장이 아니다 — 백필과 증분 fetch는 lease가 달라 겹칠 수 있고, 증분은 통당 22 units).
```

`- 증분: …` 줄의 재동기화 부분 `messages.list(after:)`를 `messages.list(after: … -category:promotions -in:drafts)`로 바꾸고, 그 줄 바로 뒤에 두 줄을 넣는다:

```markdown
- 초안 제외: 초안은 저장할 때마다·발송할 때 메시지 id가 바뀐다(Gmail 공식 동작). 목록 q에 `-in:drafts`를 붙이고, history로 들어온 초안은 `DRAFT` 라벨로 규칙 폐기(사유 `draft`)한다. 쓰다 만 메일은 저장·LLM 전송하지 않는다(§12 통제 2).
- fetch 404: 목록·history 뒤 사라진 메시지(영구 삭제, 초안 교체·발송)의 `messages.get` 404는 그 id만 건너뛰고 코드 `gmail_fetch_gone`만 남긴다(잡은 계속). 429·5xx는 지금처럼 잡 실패 → 백오프 재시도(0007).
```

- [ ] **Step 2: 실패하는 테스트를 쓴다**

`supabase/tests/gmail.test.ts`:
- 기존 "history 404 → profile first …" 테스트의 기대 호출 두 곳 `list:after:${after} -category:promotions`를 `list:after:${after} -category:promotions -in:drafts`로.
- 기존 "gmail-connect: exchange → …" 테스트의 기대 `"list:newer_than:90d -category:promotions:"`·`"list:newer_than:90d -category:promotions:1"`을 `"list:newer_than:90d -category:promotions -in:drafts:"`·`"list:newer_than:90d -category:promotions -in:drafts:1"`로.
- "gmailToItem applies server rules …" 테스트 뒤에 추가:

```ts
// 스펙 §7 초안 제외: 초안은 저장마다·발송 시 id 가 바뀐다 → 쓰다 만 메일은 저장·LLM 전송하지 않는다
Deno.test("gmailToItem discards drafts (DRAFT label) before any rule", () => {
  assertEquals(gmailToItem(gmsg("m1", "10월 21일 오후 4시 합성 미팅", "합성 초안", ["DRAFT"])), { kind: "discard", reason: "draft" });
});
```

- "gmail-fetch: backfill job stores items …" 테스트 뒤에 추가:

```ts
// 스펙 §7 fetch 404: 목록 뒤 사라진 id(영구 삭제·초안 교체) 하나가 잡 전체를 dead 로 만들지 않는다. 429·5xx 는 여전히 잡 실패(백오프)
Deno.test("gmail-fetch: messages.get 404 skips only that id (gmail_fetch_gone) and keeps going; 429 still fails the job", async () => {
  const st = { gmail_get_refresh_token: "rt-1", insert_item: "item-x", gmail_state: [{ cursor: "1", last_success_at: "2026-09-20T00:00:00Z" }] };
  const { rpc, calls } = fakeRpc(st);
  const { deps } = fakeDeps({ api: { getMessage: async (id) => {
    if (id === "gone") throw new GmailHttpError("messages.get", 404);
    return gmsg(id, "합성 안내 메일", "합성 제목");
  } } });
  const logs: string[] = [];
  const log = stub(console, "log", (...a: unknown[]) => { logs.push(String(a[0])); });
  try {
    assertEquals(await gmailFetch(rpc, job("gmail-fetch", { ids: ["a", "gone", "c"], backfill: true }), deps), "fetched");
  } finally { log.restore(); }
  assertEquals(calls.filter((c) => c.fn === "insert_item").map((c) => c.args.p_idempotency_key), ["gmail:a", "gmail:c"]);
  assert(logs.some((l) => JSON.parse(l).code === "gmail_fetch_gone"));
  assertEquals(JSON.parse(logs.at(-1)!).gmail_fetch, { stored: 2, discarded: 0, gone: 1 });

  const { rpc: rpc2 } = fakeRpc(st);
  const { deps: d429 } = fakeDeps({ api: { getMessage: async () => { throw new GmailHttpError("messages.get", 429); } } });
  await assertRejects(() => gmailFetch(rpc2, job("gmail-fetch", { ids: ["a"] }), d429), GmailHttpError, "messages.get 429");
});
```

- [ ] **Step 3: 실패를 확인한다**

Run: `pgrep -x xcodebuild; vm_stat | grep -E 'free|compressor'; deno test --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/tests/gmail.test.ts`
Expected: FAIL 4건 — q 기대 2건(`-in:drafts` 없음), DRAFT 테스트(`reason: "draft"` 아님 — 규칙이 통과시키거나 다른 사유), 404 테스트(`GmailHttpError: messages.get 404`로 잡 전체 실패).

- [ ] **Step 4: 구현한다**

`supabase/functions/_shared/gmail.ts`:
- `GmailItem`의 discard 사유를 `"otp" | "promotion" | "draft"`로.
- `gmailToItem` 첫 줄에 `if (m.labelIds?.includes("DRAFT")) return { kind: "discard", reason: "draft" };   // 초안은 저장마다·발송 시 id 가 바뀐다(§7)`.
- `resync`의 q를 `` `after:${after} -category:promotions -in:drafts` ``로.

`supabase/functions/gmail-connect/handler.ts`: `const BACKFILL_QUERY = "newer_than:90d -category:promotions -in:drafts";`

`supabase/functions/_shared/gmail-jobs.ts`:
- import에 `GmailHttpError`, `type GmailMessage` 추가.
- `gmailFetch` 루프를 다음 모양으로:

```ts
  let stored = 0, discarded = 0, gone = 0;
  let n = 0;
  for (const id of job.payload.ids as string[]) {
    if (n++ % 10 === 0) { /* 기존 연결 존재 확인 그대로 */ }
    let msg: GmailMessage;
    try { msg = await api.getMessage(id); }
    catch (e) {
      if (!(e instanceof GmailHttpError && e.status === 404)) throw e;   // 429·5xx 는 잡 실패 → 백오프 재시도(0007)
      gone++;                                                           // 목록 뒤 삭제·초안 교체: 그 id 만 건너뛴다(§7)
      console.log(JSON.stringify({ connection_id: conn, code: "gmail_fetch_gone" }));   // 코드만(id 없음)
      await deps.pause(FETCH_GAP_MS);
      continue;
    }
    const it = gmailToItem(msg);                                   // /ingest와 같은 서버 규칙 필터
    /* 이하 기존 discard / insert_item / pause 그대로 */
  }
  console.log(JSON.stringify({ connection_id: conn, gmail_fetch: { stored, discarded, gone } }));
```

- [ ] **Step 5: 테스트 통과 — 해당 파일, 그다음 전체**

Run:
```bash
deno check supabase/functions/_shared/gmail-jobs.ts supabase/functions/_shared/gmail.ts supabase/functions/gmail-connect/handler.ts supabase/tests/gmail.test.ts
deno test --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/tests/gmail.test.ts
pgrep -x xcodebuild; vm_stat | grep -E 'free|compressor'; deno test --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/tests/
```
Expected: check 오류 0. `gmail.test.ts` 전부 통과(기존 + 2건). 전체 `0 failed`(통과 수를 기록).

- [ ] **Step 6: 커밋**

```bash
git add docs/superpowers/specs/2026-09-22-assistant-design.md supabase/functions/_shared/gmail-jobs.ts supabase/functions/_shared/gmail.ts supabase/functions/gmail-connect/handler.ts supabase/tests/gmail.test.ts
git commit -m "fix(gmail): fetch skips 404 ids (gmail_fetch_gone), drafts excluded from lists and discarded by label (M1-③b0)" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 7: 리뷰(SDD 리뷰 pane) → 지적 반영 → 재커밋**

- [ ] **Step 8: 배포·회귀·기록**

```bash
vm_stat | grep -E 'free|compressor'
for f in worker gmail-connect; do supabase functions deploy $f || break; done
deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/smoke-gate.ts
```
통과 기준: 배포 2개 성공, `smoke-gate.ts` `gate: pass`(정리 후 이 실행의 `test:` 잡 0). `gates.md`에 `M1-③b0 | fetch 404 건너뜀·초안 제외, 배포 회귀 | 통과 | <테스트 수>·smoke-gate item <id> …` 행을 추가하고 커밋. 메인이 push한다.
실패 시: 배포 실패 → 원인 코드 기록 후 멈춤(T0 금지). smoke-gate 실패 → 이 변경과 무관한지 먼저(worker 로그 코드만), 관련이면 되돌리고 보고.

---

### Task M1-③b1: 게이트 도구 보강 — 표본 규칙·백필 레인 분류·합성 메일 지연·ID 대조·페이지

**모델:** `opus`/`high`

**Files:**
- Create: `supabase/scripts/_gmail-gate.ts`, `supabase/tests/gmail-gate.test.ts`, `supabase/tests/gmail-gate-db.test.ts`
- Modify: `supabase/scripts/gmail-gate.ts`(전체 교체)

**Interfaces:**
- Consumes: 테이블 `connections`(id, status, expires_at, created_at), `sync_states`(last_success_at, watch_expires_at), `jobs`(kind, status, priority, payload, created_at, claimed_at, updated_at, leased_until, attempts, last_error, not_before), `items`(id, status, title, occurred_at, captured_at, idempotency_key), `usage_counters`, `reauth_pushes`(reason, sent_at). RPC `gmail_get_refresh_token`, `insert_item`. `_shared/gmail.ts`(`gmailApi`, `GmailHttpError`, `gmailToItem`, `refreshAccessToken`). `tests/_testenv.ts`(`RUN`, `service`, `testUser`, `deleteRunJobs`).
- Produces (다음 태스크가 쓰는 CLI 계약, 모든 명령은 `[--user <uuid>] [--connection <uuid>]`; 연결은 `--connection`이 없으면 그 사용자의 가장 최근 Gmail 연결):
  - `status` → JSON `{ connection: { id, status, created_at, expires_at, t0 }, sync: { last_success_at, watch_expires_at }, backfill: { active, stalled, backoff, deferred_budget, deferred_busy, dead, by_kind }, backfill_bursts, backfill_ids_latest, gmail_jobs_dead, gmail_items: { <status>: n }, usage: [...], reauth_pushes: [{ reason, sent_at }] }`. 연결 없음 → `{"error":"no_connection"}`, exit 1.
  - `latency --since <ISO>` → 표본 줄(`id\tcreated_at\tlatency_s\tbusy=n\tkind[+retried]\tstatus`) + 끝 줄 JSON `{ webhook_syncs, connect_excluded, open, retried, during_backfill, retried_during_backfill, avg_latency_s_during_backfill, max_latency_s_during_backfill, gate: "pass"|"fail"|"insufficient" }`.
  - `mails --prefix <접두> --since <ISO>` → 줄(`id\tdelay_s`) + 끝 줄 JSON `{ mails, max_delay_s, avg_delay_s }`.
  - `gap --after <ISO> --before <ISO> [--q <검색어>]` · `gap --from-jobs [--since <ISO>]` → JSON `{ listed, stored, discarded_by_rule: { otp?, promotion?, draft? }, gone, missing: [id] }`, 누락이 있으면 exit 1. items 조회 오류·Gmail 404/429(1회 재시도 뒤) 외 오류는 예외(exit ≠ 0, 결과 JSON 없음).
  - `export async function run(argv: string[], out: (line: string) => void, env?: (k: string) => string | undefined): Promise<number>`.
  - `_gmail-gate.ts`: `bursts`, `connectSyncIds`, `busyAt`, `classify`, `summarize`, `backlog`, `mailDelays`, `t0Of`, `judgeIds`, 상수 `BURST_GAP_MS = 30_000`, `CONNECT_WINDOW_MS = 30_000`, `GATE_MIN_SAMPLES = 5`, `GATE_AVG_S = 60`.

- [ ] **Step 1: 순수 테스트를 쓴다**

`supabase/tests/gmail-gate.test.ts`:

```ts
import { assertEquals } from "jsr:@std/assert";
import {
  backlog, bursts, busyAt, classify, connectSyncIds, judgeIds, type LaneRow, mailDelays, summarize, type SyncRow, t0Of, type Verdict,
} from "../scripts/_gmail-gate.ts";

// M1-③ 게이트 판정(순수). 시각은 기준 + s초
const T = (s: number) => new Date(Date.UTC(2026, 9, 1, 5, 0, 0) + s * 1000).toISOString();
const at = (s: number) => Date.parse(T(s));
const sync = (id: string, created: number, claimed: number | null, o: Partial<SyncRow> = {}): SyncRow => ({
  id, created_at: T(created), claimed_at: claimed === null ? null : T(claimed), status: claimed === null ? "queued" : "done",
  attempts: claimed === null ? 0 : 1, last_error: null, busy: 3, ...o,
});
const lane = (created: number, claimed: number | null, status: string, updated: number): LaneRow =>
  ({ created_at: T(created), claimed_at: claimed === null ? null : T(claimed), status, updated_at: T(updated) });

Deno.test("bursts: backfill fetch jobs enqueued within 30s form one connect burst", () => {
  assertEquals(bursts([T(0), T(1), T(2), T(600), T(601)]).map((b) => b.n), [3, 2]);
});

// Review Focus 3: watch 즉시 알림은 묶음 앞, 초기 sync 는 묶음 뒤 — 창 안이면 모두 연결 sync. 45초 뒤 합성 메일 sync 는 표본
Deno.test("connectSyncIds: every via:webhook sync within [burst start − 30s, burst end + 30s] is a connect sync (T0 and reconnect)", () => {
  const syncs = [sync("w0", -2, 1), sync("c1", 3, 10), sync("l1", 45, 50), sync("c2", 602, 610), sync("w2", 700, 705)];
  assertEquals([...connectSyncIds(syncs, [T(0), T(1), T(2), T(600), T(601)])].sort(), ["c1", "c2", "w0"]);
  assertEquals(connectSyncIds(syncs, []).size, 0);                                   // 백필이 없으면 뺄 것도 없다
});

// Review Focus 3: 미클레임 0 이어도 fetch 가 실행 중이면 백필 중. 중복뿐인 재적재(process 잡 없음)도 같다
Deno.test("busyAt: a single running backfill fetch counts though nothing is unclaimed; a dedup-only reload stays busy until its last fetch ends", () => {
  const one = [lane(0, 5, "done", 85)];
  assertEquals([busyAt(one, at(3)), busyAt(one, at(40)), busyAt(one, at(90))], [1, 1, 0]);
  const reload = [lane(0, 5, "done", 85), lane(1, 86, "running", 86)];
  assertEquals([busyAt(reload, at(-1)), busyAt(reload, at(40)), busyAt(reload, at(100))], [0, 2, 1]);
});

// Review Focus 3: 연결 sync 만 표본 밖. 재시도 sync(첫 클레임 시각 보존)는 평균에 들어간다
Deno.test("classify + summarize: only connect syncs are excluded; a retried slow sync stays in the average", () => {
  const rows = [
    sync("c", 3, 10),
    sync("a", 60, 70), sync("b", 120, 150), sync("d", 180, 200), sync("e", 240, 260),
    sync("f", 300, 400, { attempts: 2, last_error: "history 503" }),                 // 100초 기다린 뒤 실패·재시도 → 표본(플래그)
    sync("g", 360, 420),
    sync("h", 900, 905, { busy: 0 }),                                                // 백필이 끝난 뒤 → 평균 밖
    sync("q", 960, null),                                                            // 아직 클레임 전
  ];
  assertEquals(summarize(classify(rows, new Set(["c"]))), {
    webhook_syncs: 9, connect_excluded: 1, open: 1, retried: 1, during_backfill: 6, retried_during_backfill: 1,
    avg_latency_s_during_backfill: 40, max_latency_s_during_backfill: 100, gate: "pass",
  });
});

// Review Focus 2: 표본 부족은 통과가 아니다
Deno.test("summarize: fewer than 5 during-backfill samples is insufficient; a slow average fails", () => {
  const four = [sync("a", 0, 5), sync("b", 60, 65), sync("c", 120, 125), sync("d", 180, 185), sync("e", 240, 245, { busy: 0 })];
  assertEquals(summarize(classify(four, new Set())).gate, "insufficient");
  const slow = [0, 60, 120, 180, 240].map((t, i) => sync(`s${i}`, t, t + 90));
  assertEquals(summarize(classify(slow, new Set())).gate, "fail");
});

// Review Focus 4: 예산 미룸·백오프·dead·벽시계 종료(stalled)는 "진행 중"이 아니다
Deno.test("backlog: budget-deferred, backoff, stalled (lease expired while running) and dead are apart from active", () => {
  const b = backlog([
    { kind: "gmail-fetch", status: "running", not_before: null, last_error: null, leased_until: T(60) },
    { kind: "process", status: "queued", not_before: null, last_error: null, leased_until: null },
    { kind: "process", status: "queued", not_before: T(-60), last_error: "llm_busy", leased_until: null },     // 기한 지남 → 클레임 가능
    { kind: "process", status: "queued", not_before: T(86_400), last_error: "budget_exhausted", leased_until: null },
    { kind: "process", status: "queued", not_before: T(20), last_error: "llm_busy", leased_until: null },
    { kind: "embed", status: "queued", not_before: T(120), last_error: "embed 500", leased_until: null },
    { kind: "gmail-fetch", status: "running", not_before: null, last_error: null, leased_until: T(-30) },     // Edge 150초 벽시계 종료 뒤
    { kind: "gmail-fetch", status: "dead", not_before: null, last_error: "messages.get 500", leased_until: null },
  ], at(0));
  assertEquals(b, { active: 3, stalled: 1, backoff: 1, deferred_budget: 1, deferred_busy: 1, dead: 1,
    by_kind: { "gmail-fetch": 2, process: 4, embed: 1 } });
});

Deno.test("mailDelays: per synthetic mail, Gmail receive → stored seconds, in receive order", () => {
  assertEquals(mailDelays([
    { id: "m2", occurred_at: T(60), captured_at: T(75.5) },
    { id: "m1", occurred_at: T(0), captured_at: T(42) },
  ]), [{ id: "m1", delay_s: 42 }, { id: "m2", delay_s: 15.5 }]);
});

// Review Focus 1: refresh token 없는 연결은 T0 가 없다
Deno.test("t0Of: connection time = refresh-token expiry − 7 days; no expiry (no refresh token stored) → null", () => {
  assertEquals([t0Of("2026-10-08T05:00:00+00:00"), t0Of(null)], ["2026-10-01T05:00:00.000Z", null]);
});

// Review Focus 4: 404(목록 뒤 삭제)는 누락이 아니라 gone, 규칙 폐기는 사유별, 나머지만 누락. Gmail 호출마다 쉼
Deno.test("judgeIds: stored ids skipped, gone counted, rule discards by reason, the rest missing; pause per Gmail call", async () => {
  let pauses = 0;
  const v: Record<string, Verdict> = { o: { kind: "discard", reason: "otp" }, d: { kind: "discard", reason: "draft" }, x: "gone", m: { kind: "pass" } };
  const r = await judgeIds(["s1", "o", "d", "x", "m", "s1"], new Set(["s1"]), async (id) => v[id], async () => { pauses++; });
  assertEquals(r, { listed: 5, stored: 1, discarded_by_rule: { otp: 1, draft: 1 }, gone: 1, missing: ["m"] });
  assertEquals(pauses, 4);
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pgrep -x xcodebuild; deno test --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/tests/gmail-gate.test.ts`
Expected: FAIL — `Module not found "file:///…/supabase/scripts/_gmail-gate.ts"`.

- [ ] **Step 3: 판정 모듈을 만든다**

`supabase/scripts/_gmail-gate.ts`:

```ts
// gmail-gate.ts 판정 로직(순수, M1-③ 게이트). 입력은 jobs·items 의 id·시각·상태·개수와 규칙 판정 결과뿐이다(본문·제목·주소 없음)
export type SyncRow = {
  id: string; created_at: string; claimed_at: string | null; status: string; attempts: number; last_error: string | null;
  busy: number;                                     // 이 sync 적재 시각에 백필 레인(우선순위 40)을 점유하던 잡 수(busyAt)
};
export type LaneRow = { created_at: string; claimed_at: string | null; status: string; updated_at: string };
export type SampleKind = "connect" | "open" | "ok";
export type Sample = SyncRow & { latency_s: number | null; kind: SampleKind; retried: boolean };
export type LatencySummary = {
  webhook_syncs: number; connect_excluded: number; open: number; retried: number; during_backfill: number; retried_during_backfill: number;
  avg_latency_s_during_backfill: number | null; max_latency_s_during_backfill: number | null; gate: "pass" | "fail" | "insufficient";
};
export type BacklogRow = { kind: string; status: string; not_before: string | null; last_error: string | null; leased_until: string | null };
export type Backlog = {
  active: number; stalled: number; backoff: number; deferred_budget: number; deferred_busy: number; dead: number; by_kind: Record<string, number>;
};
export type Verdict = { kind: "discard"; reason: string } | { kind: "pass" } | "gone";
export type GapResult = { listed: number; stored: number; discarded_by_rule: Record<string, number>; gone: number; missing: string[] };

export const BURST_GAP_MS = 30_000;
export const CONNECT_WINDOW_MS = 30_000;
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

// gmail-connect 는 저장 → watch → 목록·백필 잡 → 초기 sync(gmail_enqueue_for_account, via:webhook 표식) 순이다.
// watch 즉시 알림은 묶음 앞, 초기 sync 는 묶음 뒤에 적재되므로 묶음마다 [start − 창, end + 창] 안의 via:webhook sync 전부를 연결 sync 로 본다
export function connectSyncIds(syncs: { id: string; created_at: string }[], backfillFetchCreated: string[], windowMs = CONNECT_WINDOW_MS): Set<string> {
  const out = new Set<string>();
  for (const b of bursts(backfillFetchCreated)) {
    for (const s of syncs) { const t = ms(s.created_at); if (t >= b.start - windowMs && t <= b.end + windowMs) out.add(s.id); }
  }
  return out;
}

// t 에 백필 레인을 점유하던 잡 수 = 적재됐지만 아직 클레임 전 + 클레임돼 실행 중.
// claimed_at 은 첫 클레임 시각이고(0005·0007 coalesce), 끝난 잡(done·dead)은 updated_at 을 종료 시각으로 본다
export function busyAt(lane: LaneRow[], t: number): number {
  return lane.filter((r) => {
    if (ms(r.created_at) > t) return false;
    if (r.claimed_at === null || ms(r.claimed_at) > t) return true;
    return r.status === "running" || ((r.status === "done" || r.status === "dead") && ms(r.updated_at) > t);
  }).length;
}

// connect = 연결 창 sync(표본 밖). open = 아직 클레임 전. retried 는 분류가 아니라 플래그 — 첫 클레임 시각이 남으므로
// 재시도 sync 의 적재→첫 클레임 지연도 유효 표본이다(느리게 실패한 표본을 평균에서 빼지 않는다)
export function classify(rows: SyncRow[], connectIds: Set<string>): Sample[] {
  return rows.map((r) => {
    const latency_s = r.claimed_at ? r1((ms(r.claimed_at) - ms(r.created_at)) / 1000) : null;
    const kind: SampleKind = connectIds.has(r.id) ? "connect" : latency_s === null ? "open" : "ok";
    return { ...r, latency_s, kind, retried: r.attempts > 1 || r.last_error !== null };
  });
}

// 게이트(스펙 §15 ③): 백필 점유 중(busy > 0)에 적재된 ok 표본이 5개 이상이고 평균 ≤ 60초. 표본이 모자라면 통과가 아니라 insufficient
export function summarize(samples: Sample[]): LatencySummary {
  const n = (k: SampleKind) => samples.filter((s) => s.kind === k).length;
  const during = samples.filter((s) => s.kind === "ok" && s.busy > 0);
  const lat = during.map((s) => s.latency_s!);
  const avg = lat.length ? r1(lat.reduce((a, b) => a + b, 0) / lat.length) : null;
  return {
    webhook_syncs: samples.length, connect_excluded: n("connect"), open: n("open"),
    retried: samples.filter((s) => s.kind !== "connect" && s.retried).length,
    during_backfill: lat.length, retried_during_backfill: during.filter((s) => s.retried).length,
    avg_latency_s_during_backfill: avg, max_latency_s_during_backfill: lat.length ? Math.max(...lat) : null,
    gate: lat.length < GATE_MIN_SAMPLES ? "insufficient" : avg! <= GATE_AVG_S ? "pass" : "fail",
  };
}

// 백필 레인(우선순위 40) 잡 분류. stalled = running 인데 임대 만료(Edge 150초 벽시계 종료 뒤 재클레임 대기, 결함 아님),
// deferred_budget = 백필 예산 소진(Ruling C), deferred_busy = LLM 슬롯 대기(30초), backoff = 실패 뒤 재시도 대기(0007).
// "백필 끝" = active·stalled·backoff·deferred_busy 가 모두 0
export function backlog(rows: BacklogRow[], now: number): Backlog {
  const b: Backlog = { active: 0, stalled: 0, backoff: 0, deferred_budget: 0, deferred_busy: 0, dead: 0, by_kind: {} };
  for (const r of rows) {
    if (r.status === "dead") { b.dead++; continue; }
    b.by_kind[r.kind] = (b.by_kind[r.kind] ?? 0) + 1;
    if (r.status === "running" && r.leased_until !== null && ms(r.leased_until) < now) { b.stalled++; continue; }
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

// gap 판정: 저장된 id 는 건너뛰고, 나머지만 get(Gmail 에서 받아 서버 규칙으로 메모리 판정)으로 본다.
// "gone"(404: 목록 뒤 삭제·초안 교체)은 누락이 아니다. Gmail 호출마다 pause(쿼터)
export async function judgeIds(ids: string[], stored: Set<string>, get: (id: string) => Promise<Verdict>, pause: () => Promise<void>): Promise<GapResult> {
  const uniq = [...new Set(ids)];
  const r: GapResult = { listed: uniq.length, stored: 0, discarded_by_rule: {}, gone: 0, missing: [] };
  for (const id of uniq) {
    if (stored.has(id)) { r.stored++; continue; }
    const v = await get(id);
    if (v === "gone") r.gone++;
    else if (v.kind === "discard") r.discarded_by_rule[v.reason] = (r.discarded_by_rule[v.reason] ?? 0) + 1;
    else r.missing.push(id);
    await pause();
  }
  return r;
}
```

- [ ] **Step 4: 순수 테스트 통과**

Run: `deno test --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/tests/gmail-gate.test.ts`
Expected: `ok | 9 passed | 0 failed`.

- [ ] **Step 5: 호스팅 DB 테스트를 쓴다**

`supabase/tests/gmail-gate-db.test.ts`:

```ts
import { assert, assertEquals } from "jsr:@std/assert";
import { encrypt, toBytea } from "../functions/_shared/crypto.ts";
import { run } from "../scripts/gmail-gate.ts";
import { deleteRunJobs, RUN, service as sb, testUser } from "./_testenv.ts";

// 호스팅 DB. 전용 테스트 사용자 7(poc-test-7, 이 파일만 쓴다)에게 합성 Gmail 연결·잡·항목을 만들어 조회식(필터·페이지)과 출력 형태를 본다(AGENTS.md §7).
// 조회는 --connection 으로 이 실행의 연결만 본다. 잡 lease_key 는 RUN 접두라 워커가 가져가지 않는다(0007). gap 은 실제 Gmail API 가 필요해
// judgeIds(순수, gmail-gate.test.ts)로만 다룬다. 정리는 finally 가 자기 행만 지운다
const USER = (await testUser(7)).id;
let CID = "";
async function gate(...args: string[]): Promise<{ code: number; lines: string[] }> {
  const lines: string[] = [];
  const code = await run([...args, "--user", USER, "--connection", CID], (l) => lines.push(l));
  return { code, lines };
}

Deno.test("gmail-gate status · latency · mails on a synthetic connection of test user 7", async () => {
  const base = Date.now() - 3600_000;
  const at = (s: number) => new Date(base + s * 1000).toISOString();
  const { data: conn, error: ce } = await sb.from("connections").insert({ user_id: USER, provider: "gmail",
    account_ref: `${RUN}-gg-${crypto.randomUUID()}@example.com`, status: "active", expires_at: at(7 * 86_400) }).select("id").single();
  assertEquals(ce, null);
  CID = conn!.id as string;
  let item: string | null = null;
  try {
    assertEquals((await sb.from("sync_states").insert({ connection_id: CID, user_id: USER, cursor: "1", watch_expires_at: at(7 * 86_400) })).error, null);
    const job = (kind: string, key: string, created: number, o: Record<string, unknown>) =>
      ({ kind, user_id: USER, lease_key: `${RUN}:${key}`, created_at: at(created), ...o });
    const webhook = { connection_id: CID, via: "webhook" };
    const { error } = await sb.from("jobs").insert([
      // 연결 묶음(0초): 백필 fetch 1잡이 5~50초 실행, process 1잡은 30초부터 대기 → 60~360초 sync 는 모두 busy > 0
      job("gmail-fetch", "backfill", 0, { payload: { connection_id: CID, ids: ["x1", "x2", "x3"], backfill: true },
        status: "done", attempts: 1, claimed_at: at(5), updated_at: at(50) }),
      job("process", "backfill", 30, { payload: { item_id: crypto.randomUUID(), backfill: true } }),
      job("gmail-sync", "gmail:w", -2, { payload: webhook, status: "done", attempts: 1, claimed_at: at(4) }),    // watch 즉시 알림(묶음 앞)
      job("gmail-sync", "gmail:c", 1, { payload: webhook, status: "done", attempts: 1, claimed_at: at(20) }),    // 초기 sync(via 오표기)
      ...[60, 120, 180, 240, 300].map((t, i) =>
        job("gmail-sync", `gmail:l${i}`, t, { payload: webhook, status: "done", attempts: 1, claimed_at: at(t + 10) })),
      job("gmail-sync", "gmail:r", 360, { payload: webhook, status: "done", attempts: 2, last_error: "history 503", claimed_at: at(365) }),  // 재시도도 표본
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
    assertEquals([st.connection.id, st.connection.status, st.connection.t0, st.backfill.active, st.backfill.stalled, st.backfill.by_kind,
      st.backfill_bursts, st.backfill_ids_latest], [CID, "active", at(0), 1, 0, { process: 1 }, 1, 3]);
    assert(st.gmail_items.queued >= 1);

    const l = await gate("latency", "--since", at(-5));
    assertEquals(l.code, 0);
    const sum = JSON.parse(l.lines.at(-1)!);
    assertEquals([sum.webhook_syncs, sum.connect_excluded, sum.retried, sum.during_backfill, sum.retried_during_backfill,
      sum.avg_latency_s_during_backfill, sum.gate], [8, 2, 1, 6, 1, 9.2, "pass"]);

    const m = await gate("mails", "--prefix", "[합성 게이트 테스트", "--since", at(0));
    assertEquals(m.code, 0);
    const mm = JSON.parse(m.lines.at(-1)!);
    assertEquals(mm.mails, 1);
    assert(mm.max_delay_s >= 25 && mm.max_delay_s <= 60, String(mm.max_delay_s));   // 30초 전 수신 → 지금 저장(시계 오차 여유)
  } finally {
    await deleteRunJobs();
    if (item) await sb.from("items").delete().eq("user_id", USER).eq("id", item);
    await sb.from("connections").delete().eq("id", CID);                              // sync_states cascade
  }
});
```

- [ ] **Step 6: 실패를 확인한다**

Run: `deno test --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/tests/gmail-gate-db.test.ts`
Expected: FAIL — `gmail-gate.ts`에 `run` export가 없다(`does not provide an export named 'run'`).

- [ ] **Step 7: 스크립트를 교체한다**

`supabase/scripts/gmail-gate.ts`(전체):

```ts
// M1-③ 게이트(스펙 §15 ③, PoC-6 흡수): Gmail 연결 상태·웹훅→sync 지연·합성 메일 저장 지연·백필/공백 누락을 id·수치로만 본다.
// 본문·제목·주소는 출력하지 않는다(합성 메일 제목 접두는 조회 조건에만 쓴다). gap 은 Gmail 메시지를 메모리에서 서버 규칙으로만 다시 판정한다
// (출력·저장 없음, AGENTS.md §7). 판정 로직은 _gmail-gate.ts(순수, tests/gmail-gate.test.ts)
// 사용: deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/gmail-gate.ts <명령> [옵션] [--user <uuid>] [--connection <uuid>]
//   status                                        연결·T0(expires_at − 7일)·watch·백필 레인 분류·최근 연결 백필 ID 수·GMAIL 항목 상태별 수·사용량·재인증 푸시
//   latency --since <ISO>                         via:webhook gmail-sync 의 적재→첫 클레임(초). 연결 창 sync 는 표본 밖, 재시도는 표본(플래그), 끝 줄 요약에 gate
//   mails --prefix <합성 제목 접두> --since <ISO>    합성 메일 항목의 Gmail 수신(occurred_at)→저장(captured_at) 초
//   gap --after <ISO> --before <ISO> [--q <검색어>] 그 구간 Gmail 목록 id(-category:promotions [검색어]) ↔ items
//   gap --from-jobs [--since <ISO>]               이 연결의 백필 gmail-fetch 잡 payload.ids 전체 ↔ items (저장·규칙 폐기·gone·누락)
import { createClient } from "npm:@supabase/supabase-js@2";
import { SERVER_AUTH } from "../functions/_shared/crypto.ts";
import { gmailApi, GmailHttpError, gmailToItem, refreshAccessToken } from "../functions/_shared/gmail.ts";
import {
  backlog, type BacklogRow, bursts, busyAt, classify, connectSyncIds, judgeIds, type LaneRow, mailDelays, summarize, type SyncRow, t0Of, type Verdict,
} from "./_gmail-gate.ts";

type Rows<T> = PromiseLike<{ data: T[] | null; error: { code?: string } | null }>;
type Count = PromiseLike<{ count: number | null; error: { code?: string } | null }>;

const GAP_PAUSE_MS = 240;                 // gmail-fetch 와 같은 간격(분당 ≤ 250건 = 5,000 units)
const RETRY_429_MS = 5_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
  const iso = (k: string) => { const t = Date.parse(arg(k) ?? ""); return Number.isFinite(t) ? new Date(t).toISOString() : undefined; };
  const userArg = arg("--user") ?? env("ERURI_USER_ID");
  if (!userArg) { console.error("ERURI_USER_ID 없음"); return 2; }
  const user: string = userArg;
  const sb = createClient(env("SUPABASE_URL")!, env("SUPABASE_SERVICE_ROLE_KEY")!, SERVER_AUTH);
  let cq = sb.from("connections").select("id, status, expires_at, created_at").eq("user_id", user).eq("provider", "gmail");
  const connArg = arg("--connection");
  if (connArg) cq = cq.eq("id", connArg);
  const { data: conns, error: connErr } = await cq.order("created_at", { ascending: false }).limit(1);
  if (connErr) throw new Error("connections " + (connErr.code ?? "error"));
  const conn = conns?.[0];
  if (!conn) { out(JSON.stringify({ error: "no_connection" })); return 1; }

  // 이 연결의 gmail-connect 가 넣은 백필 gmail-fetch 잡(적재 시각·ID). ID 값은 gap 판정에만 쓰고 출력하지 않는다
  const backfillFetches = async (since?: string) => (await all<{ created_at: string; payload: { ids?: string[] } }>((a, b) => {
    let q = sb.from("jobs").select("created_at, payload").eq("user_id", user).eq("kind", "gmail-fetch")
      .eq("payload->>backfill", "true").eq("payload->>connection_id", conn.id);
    if (since) q = q.gte("created_at", since);
    return q.order("created_at").range(a, b);
  })).map((r) => ({ created_at: r.created_at, ids: r.payload.ids ?? [] }));

  if (cmd === "status") {
    const { data: st } = await sb.from("sync_states").select("last_success_at, watch_expires_at").eq("connection_id", conn.id).eq("user_id", user).single();
    const lane = await all<BacklogRow>((a, b) => sb.from("jobs").select("kind, status, not_before, last_error, leased_until").eq("user_id", user)
      .eq("priority", 40).in("status", ["queued", "running", "dead"]).range(a, b));
    const fetches = await backfillFetches();
    const bs = bursts(fetches.map((f) => f.created_at));
    const latest = bs.at(-1);
    const idsLatest = latest ? fetches.filter((f) => Date.parse(f.created_at) >= latest.start).reduce((n, f) => n + f.ids.length, 0) : 0;
    const gmailDead = await count(sb.from("jobs").select("id", { count: "exact", head: true }).eq("user_id", user).like("kind", "gmail-%").eq("status", "dead"));
    const items = await all<{ status: string }>((a, b) => sb.from("items").select("status").eq("user_id", user).eq("source", "GMAIL").range(a, b));
    const byStatus: Record<string, number> = {};
    for (const r of items) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    const { data: usage } = await sb.from("usage_counters").select("month, extract_tokens, backfill_tokens, reserved_krw, backfill_reserved_krw")
      .eq("user_id", user).order("month");
    const { data: pushes } = await sb.from("reauth_pushes").select("reason, sent_at").eq("user_id", user).order("sent_at");
    out(JSON.stringify({
      connection: { id: conn.id, status: conn.status, created_at: conn.created_at, expires_at: conn.expires_at, t0: t0Of(conn.expires_at) },
      sync: st, backfill: backlog(lane, Date.now()), backfill_bursts: bs.length, backfill_ids_latest: idsLatest,
      gmail_jobs_dead: gmailDead, gmail_items: byStatus, usage, reauth_pushes: pushes,
    }, null, 1));
    return 0;
  }

  if (cmd === "latency") {
    const since = iso("--since");
    if (!since) { console.error("--since <ISO>"); return 2; }
    const syncs = await all<Omit<SyncRow, "busy">>((a, b) => sb.from("jobs").select("id, created_at, claimed_at, status, attempts, last_error")
      .eq("user_id", user).eq("kind", "gmail-sync").eq("payload->>via", "webhook").eq("payload->>connection_id", conn.id)
      .gte("created_at", since).order("created_at").range(a, b));
    // 레인 점유 판정용: since 뒤에 움직였거나 아직 끝나지 않은 백필 레인 잡
    const lane = await all<LaneRow>((a, b) => sb.from("jobs").select("created_at, claimed_at, status, updated_at").eq("user_id", user)
      .eq("priority", 40).or(`updated_at.gte.${since},status.in.(queued,running)`).order("created_at").range(a, b));
    const rows: SyncRow[] = syncs.map((s) => ({ ...s, busy: busyAt(lane, Date.parse(s.created_at)) }));
    const samples = classify(rows, connectSyncIds(rows, (await backfillFetches(since)).map((f) => f.created_at)));
    for (const s of samples) {
      out([s.id, s.created_at, s.latency_s ?? "-", `busy=${s.busy}`, s.kind + (s.retried ? "+retried" : ""), s.status].join("\t"));
    }
    out(JSON.stringify(summarize(samples)));
    return 0;
  }

  if (cmd === "mails") {
    const prefix = arg("--prefix"), since = iso("--since");
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
    const fromJobs = argv.includes("--from-jobs");
    const after = iso("--after"), before = iso("--before"), extra = arg("--q");
    if (!fromJobs && (!after || !before)) { console.error("--after <ISO> --before <ISO> [--q <검색어>] | --from-jobs [--since <ISO>]"); return 2; }
    const { data: rt, error } = await sb.rpc("gmail_get_refresh_token", { p_user: user, p_connection: conn.id });
    if (error || !rt) { out(JSON.stringify({ error: "no_refresh_token" })); return 1; }
    const api = gmailApi(await refreshAccessToken(rt as string));
    const ids: string[] = [];
    if (fromJobs) for (const f of await backfillFetches(iso("--since"))) ids.push(...f.ids);
    else {
      const q = `after:${Math.floor(Date.parse(after!) / 1000)} before:${Math.floor(Date.parse(before!) / 1000)} -category:promotions${extra ? " " + extra : ""}`;
      let page: string | undefined;
      do {
        const p = await api.listMessageIds(q, page);
        ids.push(...(p.messages ?? []).map((m) => m.id));
        page = p.nextPageToken;
      } while (page);
    }
    const uniq = [...new Set(ids)];
    const have = new Set<string>();
    for (let i = 0; i < uniq.length; i += 100) {
      const { data, error: e } = await sb.from("items").select("idempotency_key").eq("user_id", user)
        .in("idempotency_key", uniq.slice(i, i + 100).map((x) => "gmail:" + x));
      if (e) throw new Error("items " + (e.code ?? "error"));       // 조회 실패를 "저장 안 됨"이나 "누락 없음"으로 보지 않는다
      for (const r of data ?? []) have.add(r.idempotency_key.slice("gmail:".length));
    }
    const get = async (id: string): Promise<Verdict> => {
      for (let tries = 0; ; tries++) {
        try { return gmailToItem(await api.getMessage(id)); }
        catch (e) {
          if (e instanceof GmailHttpError && e.status === 404) return "gone";                         // 목록 뒤 삭제·초안 교체
          if (e instanceof GmailHttpError && e.status === 429 && tries === 0) { await sleep(RETRY_429_MS); continue; }
          throw e;
        }
      }
    };
    const r = await judgeIds(uniq, have, get, () => sleep(GAP_PAUSE_MS));
    out(JSON.stringify(r));
    return r.missing.length ? 1 : 0;
  }

  console.error("usage: gmail-gate.ts <status|latency|mails|gap>");
  return 2;
}

if (import.meta.main) Deno.exit(await run(Deno.args, (line) => console.log(line)));
```

- [ ] **Step 8: 검사·테스트 통과·연결 전 스모크**

Run:
```bash
# 머리 3줄
deno check supabase/scripts/gmail-gate.ts supabase/scripts/_gmail-gate.ts supabase/tests/gmail-gate.test.ts supabase/tests/gmail-gate-db.test.ts
pgrep -x xcodebuild; deno test --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/tests/gmail-gate.test.ts supabase/tests/gmail-gate-db.test.ts
g status; echo "exit=$?"
```
Expected: check 오류 0. `ok | 10 passed | 0 failed`. 실사용자 `status` → `{"error":"no_connection"}`, `exit=1`(연결 전 기대값, 읽기 전용). 전역 `test:%` 개수 검사는 하지 않는다(다른 pane 실행과 충돌 — 정리는 `finally`가 자기 행만).
실패 시: DB 테스트의 `like("title", …)`·`payload->>via`·`payload->>connection_id`·`.or(…)` 필터가 PostgREST에서 0행이면 supabase-js 인코딩을 확인하고 고친다(이 테스트가 실측 전에 조회식을 잡으려고 있다). `updated_at` 명시 insert가 무시되면(트리거) fetch 잡의 종료 시각 기대를 확인하고 테스트 데이터만 고친다.

- [ ] **Step 9: 커밋 → 리뷰 → 메인 push**

```bash
git add supabase/scripts/_gmail-gate.ts supabase/scripts/gmail-gate.ts supabase/tests/gmail-gate.test.ts supabase/tests/gmail-gate-db.test.ts
git commit -m "feat(scripts): gmail-gate keeps retried samples, busy lane incl. running jobs, connect window, gap by job ids, stalled lane (M1-③b1)" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task M1-③b2: 연결(T0, 새 동의) + 백필 중 웹훅→sync 지연 + 규칙 메일 발송

사용자가 옆에 있는 한 세션이다. **선행: UC-1·UC-2 결과, ③b0 배포·smoke-gate 통과, ③b1 커밋·push.** 권장 시각 10:00~18:00 KST(예: 10-01(목) 14:00).

**모델:** `opus`/`medium`

**Files:**
- Modify: `docs/superpowers/phase1/gates.md`(M1-③b 행 추가, 상태 **대기**)

**Interfaces:**
- Consumes: ③b1 CLI(`status`·`latency`·`mails`·`gap --q`), `sql.ts`, 앱 설정 Gmail 절(F10), Gmail 커넥터 `send_message`(A 방식일 때), UC-1·UC-2 결과.
- Produces: `gates.md` M1-③b 행에 T0(UTC ISO, 확정/잠정), 동의 화면 확인, N, 발송 방식·간격, `latency` 요약, `mails` 요약, 카드 마스킹·OTP 결과. ③b3·③c가 T0를 여기서 읽는다.

- [ ] **Step 1: (에이전트) 사전 점검**

```bash
# 머리 3줄
test -n "$U" && echo user_set
g status
s "select apns_env, build, last_seen_at > now() - interval '1 day' as fresh from devices where user_id = \$1" "$U"
s "select status, coalesce(last_error, '') = 'budget_exhausted' as budget, count(*) from jobs where user_id = \$1 and priority = 40 and status in ('queued','running','dead') group by 1, 2" "$U"
s "select kind, status, count(*) from jobs where user_id = \$1 and status in ('queued','running','dead') group by 1, 2" "$U"
s "select d.status, max(d.start_time) as last from cron.job_run_details d join cron.job j using (jobid) where j.jobname = 'worker-every-minute' and d.start_time > now() - interval '5 minutes' group by 1"
s "select month, reserved_krw, backfill_reserved_krw from usage_counters where user_id = \$1 order by month" "$U"
```

통과 기준: `user_set`, `status` = `{"error":"no_connection"}`, 기기 1행 이상 `apns_env=production`·`build=202609302012`·`fresh=true`, **백필 레인 잔여 0**(우선순위 40 행이 없거나 `(queued, budget=true)`뿐, dead 0), 워커 cron `succeeded` 최근 5분 안, 전체 대기 잡 수·사용량 행을 기록.
실패 시: 연결이 이미 있음 → 이 계획의 T0가 아니다, 메인에 보고하고 멈춘다(연결을 지우지 않는다). 기기 없음·빌드 다름 → 사용자에게 앱 열기/0.5.0 업데이트. 레인 잔여 > 0 → 끝날 때까지 **T0를 미룬다**(N6). 워커 cron 실패 → 멈추고 원인부터.

- [ ] **Step 2: (사용자 U10-0) 동의 철회·발송 준비**

- UC-1 승인: 사용자가 지금 Google 계정 → 보안 → 서드파티 앱 및 서비스에서 이 프로젝트 앱 액세스를 삭제하고 "삭제함"을 알린다. 거절: 건너뛰고 T0를 **잠정**으로 적는다.
- UC-2 = A: 에이전트가 커넥터 사용 가능 여부만 확인한다(주소를 조회·출력하지 않는다). 쓸 수 없으면 B로.
- UC-2 = B: 사용자가 메모 앱에 문구를 준비했는지 확인.

- [ ] **Step 3: (사용자 U10-1) 연결 → (에이전트) T0·N 확인**

사용자: 설정 → "Gmail 연결" → **동의 화면이 떴는지 알림** → Gmail 읽기 권한 체크 → 결과 줄 확인.
에이전트(연결 직후 바로):

```bash
# 머리 3줄
g status
```

통과 기준: 사용자 "동의 화면(Gmail 체크박스) 떴음", `connection.status = active`, `connection.t0` ≠ null(= T0), `backfill_ids_latest` = N, `backfill.active > 0`(N > 0일 때), `sync.watch_expires_at` ≈ T0 + 7일.
실패 시:
- **동의 화면 없이 `refresh_token_stored=true`**(UC-1 거절이거나 철회가 반영 안 됨) → T0 불인정. 사용자에게 "다시 연결 (동의 다시 받기)" 한 번 → `g status` 다시, 그 `t0`가 T0.
- `t0 = null` 또는 `refresh_token_stored=false` → "다시 연결 (동의 다시 받기)" → `g status` 다시.
- 앱 결과 줄 403 `gmail_scope_missing` → Gmail 체크박스를 켜고 다시. 409 → 다른 사용자에 연결된 계정, 멈추고 보고. 502 → 다시 시도(코드 만료). 500 → 대시보드 gmail-connect 로그에서 `stage`·`result` 코드만.
- T0는 항상 마지막 `status.t0`.

T0(UTC ISO, 확정/잠정), N을 `gates.md` 초안에 적는다. 백필 예상 시간 ≈ N × 5초(상한).

- [ ] **Step 4: 합성 메일 발송 (간격은 N으로)**

시간표(T0 기준): **N < 180 → 30초 간격** T0+0:45, 1:15, 1:45, 2:15, 2:45, 3:15, 3:45, 4:15. **N ≥ 180 → 65초 간격** T0+1:00, 2:05, 3:10, 4:15, 5:20, 6:25, 7:30, 8:35. 순서 L1, L2, O1, L3, C1, L4, L5, L6.
- A: 에이전트가 커넥터로 보낸다(시간표 ±15초면 된다 — 간격은 판정 기준이 아니고 표본 수만 채우면 된다). 보낸 UTC 시각을 적는다. **L1 발송 2분 뒤** `g mails --prefix "[합성 지연 테스트" --since <T0 − 1분>`이 `mails ≥ 1`인지 본다 — 0이면 커넥터 계정 ≠ 연결 계정일 수 있다 → 남은 메일은 B로 전환하고 기록.
- B: 사용자가 시간표대로 보낸다(작성 창에 붙여넣고 바로 보내기).

간격 근거: 같은 연결에 queued sync가 있으면 새 웹훅은 합쳐진다(F3). 첫 메일을 T0+45초 이후로 둔 것은 연결 창(묶음 끝 + 30초)을 피하려는 것이다.

- [ ] **Step 5: (에이전트) 측정 — 마지막 메일 2분 뒤**

```bash
# 머리 3줄
g status
g latency --since <T0 − 2분>
g mails --prefix "[합성 지연 테스트" --since <T0 − 1분>
```

판정 규칙(그대로 적용):

| 상황 | 판정 |
|---|---|
| `during_backfill ≥ 5` 이고 `avg_latency_s_during_backfill ≤ 60`(재시도 sync 포함) | 지연 통과 |
| `during_backfill < 5` (`gate = insufficient`) | 통과 아님. 아래 보충 → 그래도 부족하면 **대기**(③c2 재적재 창에서 이어 수집) |
| `gate = fail` | 실패. 느린 표본마다 원인 조사(아래) |
| `mails` < 6행 | **실패(유실)**. 원인부터 |
| `mails` 6행, `max_delay_s > 180` | 원인이 **레인 굶김**(그 구간에 우선순위 40 잡이 sync보다 먼저 클레임)이면 실패, **외부 일시 오류**(Gmail 5xx·429 재시도)면 통과 유지 + 기록 |
| `open > 0` | 1분 뒤 다시 |

조사 명령(시각은 해당 표본·메일의 구간):
```bash
# 머리 3줄
s "select id, kind, priority, claimed_at, attempts, last_error from jobs where user_id = \$1 and claimed_at between \$2 and \$3 order by claimed_at" "$U" "<구간 시작>" "<구간 끝>"
s "select d.status, d.start_time from cron.job_run_details d join cron.job j using (jobid) where j.jobname = 'worker-every-minute' and d.start_time between \$1 and \$2 order by 2" "<구간 시작>" "<구간 끝>"
```
`retried_during_backfill > 0`이면 해당 sync의 `last_error` 코드를 적는다(Gmail 5xx·429 = 외부 일시 오류, 그 밖이면 결함 후보). 연결 창에 합성 메일 sync가 걸려 빠졌으면(`connect_excluded`가 기대보다 큼) 표본 줄로 확인해 기록한다. 원인은 적고, 코드 수정은 별도 태스크.

**표본 보충(결정 a, `insufficient`일 때만):** 같은 세션에서 사용자가 **일반 "Gmail 연결"**(재동의 아님)을 누른다(U10-2b) → Ruling 14 재적재가 레인을 약 N × 0.8초 점유한다 → 누른 지 45초 뒤부터 30초 간격으로 S1~S6 중 남은 것을 보낸다(A: 에이전트, B: 사용자). 최대 3회 반복. 매 회 뒤:
```bash
# 머리 3줄
g status                                   # connection.t0 = 새 T0(몇 분 움직일 수 있음) → 기록 갱신
g latency --since <T0 − 2분>
g mails --prefix "[합성 지연 보충" --since <첫 재탭 − 1분>
```
최초 백필 표본과 합산하되 기록은 구분한다(`최초 <a>개 · 보충 <b>개`). 3회 뒤에도 5개 미만이면 ③b 지연 항목은 **대기**, ③c2 Step 5b에서 이어 모은다. SQL로 실사용자 레인에 잡을 넣는 보충은 하지 않는다(결정 a 기각).

- [ ] **Step 6: (에이전트) 카드·OTP 메일 — 저장 쪽 확인**

```bash
# 머리 3줄
s "select id, title like '%****%' as masked, title ~ '[0-9]{4}[- ]?[0-9]{4}[- ]?[0-9]{4}' as has_card_digits from items where user_id = \$1 and source = 'GMAIL' and title like '[합성카드테스트]%'" "$U"
s "select count(*) from items where user_id = \$1 and source = 'GMAIL' and title like '[합성] 로그인%'" "$U"
g gap --after <T0 − 1분> --before <지금 UTC ISO> --q 'subject:"[합성] 로그인"'
```

통과 기준: 카드 메일 1행 `masked=true, has_card_digits=false`. OTP 메일 항목 0행. `gap` = `listed 1 · stored 0 · discarded_by_rule.otp 1 · missing []`(합성 O1이 OTP 규칙으로 폐기됨을 id로 보인다 — 90일 안의 실제 OTP 메일로는 증거가 안 된다, N3). 이 `gap`은 한 통짜리라(30 units 미만) 백필 fetch 중에도 돌려도 된다.
실패 시: 카드 0행 → `g mails --prefix "[합성카드테스트]" --since <T0 − 1분>`로 수신 여부, 없으면 발송 확인. 마스킹 안 됨 → 규칙 결함, 게이트 실패로 적고 별도 태스크. OTP `listed 0` → 발송 확인. `missing`에 있으면 규칙 결함.

- [ ] **Step 7: (사용자 U10-3) 합성 제안 정리 → 기록·커밋**

사용자: 합성 미팅 제안 알림 무시. 앱 "제안" 탭에서 **제목에 `합성`이 들어간 제안만 하나씩 "무시"**(L1~L6, 6건 안팎). **"전체 무시" 금지**(실제 백필 일정 제안까지 지운다).
`gates.md`에 M1-③b 행을 **대기**로 추가한다(③b3에서 판정): `T0 <ISO>(KST 병기, 확정|잠정), 동의 화면 확인, N=<n>, 발송 <A|B>·<30|65>초, latency: webhook_syncs <a>·connect_excluded <b>·retried <c>(백필 중 <c'>)·during_backfill <d>(최초 <d1>·보충 <d2>)·평균 <e>초·최대 <f>초 → gate <pass|…>, mails 6통 최대 <g>초·평균 <h>초, 카드 제목 masked=true·숫자 없음, OTP 저장 0·gap otp 1`.

```bash
git add docs/superpowers/phase1/gates.md
git commit -m "docs(phase1): M1-③b2 Gmail connected (T0, fresh consent), webhook→sync during backfill" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task M1-③b3: 백필 완료·규칙 폐기·90일 누락 0·비용·watch 갱신 → M1-③b 판정

T0 당일(백필이 끝난 뒤)과 T0 다음 날(watch cron) 두 번에 걸친다. 사용자 조작 없음.

**모델:** `opus`/`medium`

**Files:**
- Modify: `docs/superpowers/phase1/gates.md`(M1-③b 행 판정), `docs/superpowers/poc/results.md` PoC-6 행, 스펙 §14 판정 현황 PoC-6 행

**Interfaces:**
- Consumes: ③b1 CLI(`status`·`gap`), ③b2의 T0·N.
- Produces: M1-③b 통과/실패/대기, 백필 소요·실제 비용(③c2 재적재 비교 기준).

- [ ] **Step 1: (에이전트) 백필 진행 확인 — 끝날 때까지 10분 간격**

```bash
# 머리 3줄
g status
```

"백필 끝" = `backfill.active = 0`, `stalled = 0`, `backoff = 0`, `deferred_busy = 0`. 같이 볼 것: `backfill.dead = 0`, `gmail_jobs_dead = 0`.
실패·예외 시:
- `stalled > 0` 또는 fetch 잡 `attempts ≥ 2`·`last_error null` → Edge 벽시계 종료 뒤 재실행(N2, 결함 아님). 수를 적고 기다린다.
- `deferred_budget > 0`: 백필 예산이 찼다(Ruling C) — 수를 적고 기다리지 않는다. 항목은 fetch 때 이미 저장돼 Step 3 `gap`에는 영향이 없다.
- `backoff`가 줄지 않음 → `s "select kind, last_error, attempts from jobs where user_id = \$1 and priority = 40 and status = 'queued' and not_before > now() and coalesce(last_error, '') not in ('budget_exhausted','llm_busy')" "$U"`로 코드만 본다. `messages.get 429`면 쿼터(F12) — 겹친 호출이 없었는지 확인.
- `dead > 0` → `s "select id, kind, last_error, attempts from jobs where user_id = \$1 and priority = 40 and status = 'dead'" "$U"`. 원인 코드를 적는다(③b0 뒤 404는 dead를 만들지 않는다 — 404로 dead면 ③b0 배포 확인). Step 3이 누락을 보여 준다.

- [ ] **Step 2: (에이전트) 백필 소요·비용 기록**

```bash
# 머리 3줄
s "select kind, count(*), min(created_at) as first_in, max(updated_at) as last_done, max(attempts) as max_attempts from jobs where user_id = \$1 and priority = 40 and status = 'done' and created_at >= \$2 group by 1" "$U" "<T0 − 2분>"
s "select month, extract_tokens, backfill_tokens, reserved_krw, backfill_reserved_krw from usage_counters where user_id = \$1 order by month" "$U"
s "select status, count(*) from items where user_id = \$1 and source = 'GMAIL' group by 1" "$U"
```

기록: 백필 소요 = T0 → 레인 마지막 `last_done`, kind별 잡 수(fetch ⌈N/100⌉·process·embed)·`max_attempts`, `backfill_tokens`, `backfill_reserved_krw`(백필 추출 실제 원), `reserved_krw`의 ③b2 Step 1 대비 증가분(백필 임베딩 + 합성 메일, 월 예산), 항목 상태 분포. "추정" 표의 N 행과 비교해 벗어나면 이유를 적는다(보충 재탭이 있었으면 재적재분 포함). T0가 월 경계면 두 월 행을 더한다.

- [ ] **Step 3: (에이전트) 90일 누락·규칙 폐기 — 백필 fetch가 끝난 뒤에만**

```bash
# 머리 3줄
g gap --from-jobs --since <T0 − 2분>
g gap --after <T0 − 89일> --before <지금 − 5분>
```

통과 기준:
- **ID 대조(주)** `--from-jobs`: `missing = []`. `listed` = 연결(과 보충 재탭)이 넣은 백필 ID 합집합(≈ N), `stored + Σdiscarded_by_rule + gone = listed`. `gone`(목록 뒤 삭제)과 `discarded_by_rule`(otp·promotion·draft)을 기록한다.
- **기간 gap(보조, 목록 단계 누락용)**: `missing = []`. `--before`는 "지금 − 5분"(방금 도착해 아직 fetch 전인 메일을 누락으로 세지 않게). `T0 − 89일`의 하루 여유는 `newer_than:90d`의 날짜 단위 경계 때문이다.
- 어느 쪽이든 스크립트가 예외로 끝나면(items 조회 오류·Gmail 오류) **판정 없음** — 원인 코드를 적고 다시 돌린다(누락 없음으로 보지 않는다).
실패 시: `missing`의 id마다 `s "select status, last_error, attempts from jobs where user_id = \$1 and kind = 'gmail-fetch' and payload->'ids' ? \$2" "$U" <id>`로 그 id를 맡은 fetch 잡 상태를 본다(dead → 원인 코드, 잡 없음 → 목록 단계 누락). 누락이 있으면 게이트 **실패** — 원인·조치를 적고 조치 뒤 같은 명령으로 다시 잰다.

- [ ] **Step 4: (에이전트) watch 수동 갱신**

```bash
# 머리 3줄
g status          # sync.watch_expires_at = W0 기록
s "select gmail_enqueue_all('gmail-watch', \$1)" "$U"
# 2분 뒤
s "select status, checkpoint, last_error from jobs where user_id = \$1 and kind = 'gmail-watch' order by created_at desc limit 1" "$U"
g status          # W1
```

통과 기준: `gmail_enqueue_all` = 1, 잡 `done`·`watched`, `W1 > W0`이고 `|W1 − (호출 시각 + 7일)| < 1시간`.
실패 시: 잡 `skipped` → refresh token 문제(`connection.status` 확인). 오류 코드 → Gmail `watch` 상태 코드(403이면 토픽 권한 — `gmail-api-push@system.gserviceaccount.com`의 Pub/Sub Publisher).

- [ ] **Step 5: 중간 기록**

`gates.md` M1-③b 행에 Step 1~4 결과를 붙인다(상태는 Step 6 뒤에): `백필 <분>분(fetch <a>·process <b>·embed <c> 잡, stalled <s>), backfill_tokens <t>, 백필 추출 <x>원·임베딩 등 월 <y>원, 항목 <상태 분포>, ID 대조 listed <l>·stored <st>·규칙 <otp/promotion/draft>·gone <g>·missing 0, 기간 gap listed <pl>·missing 0, watch 수동 W0→W1`.

- [ ] **Step 6: (에이전트) watch cron — T0 뒤 첫 12:17 KST 이후(T0 = 10-01 14:00이면 10-02(금) 12:17 이후)**

```bash
# 머리 3줄
s "select d.status, d.start_time from cron.job_run_details d join cron.job j using (jobid) where j.jobname = 'gmail-watch-daily' order by d.start_time desc limit 1"
s "select status, checkpoint, created_at from jobs where user_id = \$1 and kind = 'gmail-watch' order by created_at desc limit 1" "$U"
g status
```

통과 기준: cron `succeeded`(03:17 UTC), 그 뒤 gmail-watch 잡 `done`·`watched`, `watch_expires_at ≈ cron 시각 + 7일`(W1보다 늦음). 같이 기록: `sync.last_success_at`이 최근 6시간 안, `gmail_jobs_dead = 0`.
실패 시: cron 없음·실패 → `return_message` 코드만 기록, 조치 후 다음 날 다시. 늦어도 ③c1 세션에서 같은 확인을 한다.

- [ ] **Step 7: M1-③b 판정·기록·커밋**

통과 = ③b2 지연 통과(`gate = pass`, mails 6행, `max_delay_s > 180`이면 외부 일시 오류로 분류됨) + 카드 마스킹·OTP 폐기(gap otp 1) + 90일 ID 대조·기간 gap `missing = []` + watch 수동·cron. 지연이 표본 부족으로 **대기**면 M1-③b도 **대기**(③c2 Step 5b에서 이어 판정). 그 밖에 하나라도 빠지면 **실패**(원인·조치·재측정 계획).
- `gates.md` M1-③b 행 상태를 **통과**(또는 대기·실패)로.
- `results.md` PoC-6 행 "남은 실측"을 `M1-③b 통과(<날짜>): 백필(N=<n>, <분>분) 중 웹훅→sync 평균 <e>초(유효 표본 <d>), watch 수동·cron, OTP 폐기·카드 제목 마스킹, 90일 누락 0(ID 대조). +6일·+8일은 M1-③c(<T0+6일>·<T0+8일>)`로, 갱신일을 오늘로. 스펙 §14 판정 현황 PoC-6 행 같은 칸을 같은 문장으로.

```bash
git add docs/superpowers/phase1/gates.md docs/superpowers/poc/results.md docs/superpowers/specs/2026-09-22-assistant-design.md
git commit -m "docs(phase1): M1-③b Gmail gate 1 — backfill latency, rule mails, 90-day gap by job ids, watch renew" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task M1-③c1: T0 + 6일 — `expiring` 재인증 푸시

T0 + 6일 + 1시간 5분 이후 한 번(T0 = 10-01 14:00이면 **10-07(수) 15:10 이후**). 다른 태스크와 병행 중이어도 된다.

**모델:** `sonnet`/`medium`

**Files:**
- Modify: `docs/superpowers/phase1/gates.md`(M1-③c 행 추가, 상태 **대기**)

**Interfaces:**
- Consumes: `status`의 `connection`·`reauth_pushes`, `gmail-reauth` 잡, 기기 알림.
- Produces: `expiring` 푸시 도착 여부(③c2 판정에 쓴다).

- [ ] **Step 1: (에이전트) 푸시 기록 확인**

```bash
# 머리 3줄
g status
s "select status, checkpoint, payload->>'reason' as reason, created_at from jobs where user_id = \$1 and kind = 'gmail-reauth' order by created_at desc limit 3" "$U"
```

통과 기준: `connection.status = active`, `reauth_pushes`에 `reason = expiring` 1행이고 `sent_at`이 [T0 + 6일, T0 + 6일 + 1시간 5분] 안, `gmail-reauth` 잡 `done`·`reauth_sent`. 같이: `sync.last_success_at` 최근 6시간 안, `watch_expires_at` ≈ 최근 03:17 UTC + 7일(③b3 Step 6을 못 했으면 여기서 판정), `gmail_jobs_dead = 0`.
실패 시:
- 행 없음 → `s "select reason from gmail_reauth_due() where user_id = \$1" "$U"`(기대 `expiring`), `gmail-reauth-hourly` cron 최근 실행 상태, 잡 `checkpoint`: `no_device` → 기기 `last_seen_at`·등록 확인(앱 열기), `reauth_rejected` → APNs 거절(토큰·환경).
- `connection.status = reauth_required`가 이미 나옴 → 7일 시계가 T0보다 이르다(T0가 새 동의가 아니었을 가능성, N1). `reauth_pushes`·잡 시각을 적고 메인에 보고.
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

**시작 조건은 시각이 아니라 `g status`의 `connection.status = reauth_required` 확인이다**(T0 = 10-01 14:00이면 보통 10-08(목) 저녁 ~ 10-09(금)). 사용자가 옆에 있어야 한다.

**모델:** `opus`/`medium`

**Files:**
- Modify: `docs/superpowers/phase1/gates.md`(M1-③c 행 판정, 필요 시 M1-③b 행), `docs/superpowers/poc/results.md` PoC-6 행, 스펙 §14 판정 현황 PoC-6 행·§16 "Gmail 7일 재인증" 줄

**Interfaces:**
- Consumes: ③b1 CLI(`status`·`latency`·`mails`·`gap`), ③b3의 N·백필 비용, ③c1의 expiring 결과, 앱 "다시 연결 (동의 다시 받기)".
- Produces: PoC-6 흡수분 최종 판정.

- [ ] **Step 1: (에이전트) 끊김 확인과 기준 시각 L 기록 — 재연결 전**

```bash
# 머리 3줄
g status
s "select kind, checkpoint, created_at from jobs where user_id = \$1 and kind in ('gmail-sync','gmail-watch','gmail-reauth') and created_at > \$2 order by created_at" "$U" "<T0 + 7일 − 1시간>"
```

통과 기준: `connection.status = reauth_required`, `reauth_pushes`에 `invalid_grant` 1행(`expiring` 행도 남아 있음), T0 + 7일 뒤 첫 refresh 잡의 `checkpoint = skipped`, 그 직후 `gmail-reauth`(`invalid_grant`) `reauth_sent`. **L = `sync.last_success_at`**, 끊긴 시각 ≈ `invalid_grant` 잡 `created_at`을 기록한다(재연결이 L을 덮는다, F7).
실패 시:
- 아직 `active`이고 T0 + 7일 뒤 sync가 성공했다 → refresh token이 7일에 만료되지 않았다. `s "select gmail_enqueue_all('gmail-sync', \$1)" "$U"`로 한 번 더 refresh를 시도하고 2분 뒤 `g status`. 그래도 active면 세션을 T0 + 9일로 미루고, T0 + 9일에도 active면 "Google 테스트 모드 7일 만료가 이 연결에 적용되지 않음"을 기록하고 메인에 보고(스펙 §5·§16 가정 재검토).
- `reauth_required`인데 `invalid_grant` 푸시 행이 없음 → ③c1 Step 1의 원인 확인 절차.

- [ ] **Step 2: (사용자 U11-2) 끊김 알림 확인 → 공백 메일 2통**

사용자: ERURI "Gmail 다시 연결 필요 / Gmail 연결이 끊겼습니다. 앱에서 다시 연결하세요." 도착 확인, 설정 Gmail 줄이 "다시 연결 필요 (reauth_required)"인지.
그다음 P1·P2 발송(A면 에이전트가 커넥터로, B면 사용자). 보낸 시각을 적는다.

- [ ] **Step 3: (에이전트) 공백 확인 — 끊긴 동안 수집되지 않음**

2분 뒤:

```bash
# 머리 3줄
s "select count(*) from items where user_id = \$1 and source = 'GMAIL' and title like '[합성 공백 테스트%'" "$U"
g latency --since <P1 발송 − 1분>
```

통과 기준: 항목 0, `webhook_syncs = 0`(reauth_required 동안 웹훅이 잡을 만들지 않음, F8). 0이 아니면 연결이 끊기지 않은 것 — Step 1로 돌아간다.

- [ ] **Step 4: (사용자 U11-2) 재연결**

사용자: 설정 → **"다시 연결 (동의 다시 받기)"** → 동의 화면에서 Gmail 읽기 권한 체크 → 결과 줄 확인(`refresh_token_stored=true`). 이 시각 = R(= 직후 `g status`의 `t0`).

- [ ] **Step 5: (에이전트) 재연결 상태 → 재적재 완료 → 누락 0**

```bash
# 머리 3줄
g status
```

바로 통과 기준: `connection.status = active`, `connection.t0` = R, `reauth_pushes = []`(재연결 트리거가 지움, 0008), `backfill_bursts` = 이전 + 1, `backfill_ids_latest` = N'(≈ N + T0 뒤 도착분), `sync.last_success_at` ≈ R.
재적재가 끝날 때까지(**`backfill.active = stalled = backoff = deferred_busy = 0`, `dead = 0`**, 5분 간격 `g status`) 기다린 뒤:

```bash
# 머리 3줄
g gap --from-jobs --since <R − 2분>
g gap --after <L − 1일> --before <지금 − 5분> --q 'subject:"[합성 공백 테스트"'
g gap --after <L − 1일> --before <지금 − 5분>
s "select count(*) as rows, count(distinct idempotency_key) as ids from items where user_id = \$1 and source = 'GMAIL' and title like '[합성 공백 테스트%'" "$U"
s "select count(*) as reprocessed from jobs j join items i on i.id = (j.payload->>'item_id')::uuid where j.user_id = \$1 and i.user_id = \$1 and j.kind = 'process' and j.created_at >= \$2 and i.captured_at < \$2" "$U" "<R ISO>"
g gap --after <R − 89일> --before <지금 − 5분>
g latency --since <R − 2분>
```

통과 기준(PoC-6 흡수분):
- 재적재 ID 대조 `--from-jobs --since <R − 2분>`: `missing = []`.
- P1·P2 **Gmail id 기준**: `--q` gap = `listed 2 · stored 2 · missing []`.
- 공백 창 gap(`L − 1일` ~ 지금 − 5분): `missing = []`.
- 공백 메일 항목 `rows = 2, ids = 2`(각 1행, 중복 없음).
- **재처리 0**: `reprocessed = 0`(R 이전에 저장된 항목에 R 뒤 `process` 잡 없음 — Ruling 14 비용 = Gmail API만, F7).
- 90일 gap: `missing = []`.
- `latency`: `connect_excluded ≥ 1`(재연결 창 sync 제외 확인, 관찰).
- 공백 메일 제안 푸시(수신 1~2일 전 → 백필 억제 대상 아님, F6)는 관찰로 적는다.
- 스크립트 예외 = 판정 없음(③b3 Step 3과 같이 다시 돌린다).
실패 시: 누락 → 그 id의 fetch 잡 상태(③b3 Step 3 방법), `gmail_discard`·`gmail_fetch_gone` 코드(대시보드 worker 로그의 코드만). `reprocessed > 0` → 재처리 결함, 게이트 실패·별도 태스크. 원인·조치를 적고 조치 뒤 다음 만료 주기(R + 6일·R + 8일)에 ③c1·③c2를 다시 잰다.

- [ ] **Step 5b: (③b 지연이 대기일 때만) 재적재 창에서 지연 표본 이어 모으기**

Step 4 직후(재적재가 레인을 점유하는 동안) R + 45초부터 30초 간격으로 S1~S6 중 남은 것을 보낸다(A/B). 재적재가 짧아 모자라면 ③b2 Step 5의 일반 "Gmail 연결" 재탭(최대 3회, 재동의 아님 — R·`expires_at`이 몇 분 움직일 수 있어 R은 마지막 `status.t0`)으로 보충한다. `g latency --since <R − 2분>`·`g mails --prefix "[합성 지연 보충" --since <R − 1분>` 결과를 ③b2 표본과 합산해 ③b2 판정 규칙대로 판정하고, `gates.md` M1-③b 행을 **통과/실패**로 고친다. 그래도 5개 미만이면 M1-③b는 **대기**로 두고 메인에 보고(스펙 §15 ③ 문구 재검토 여부는 사용자 결정 — 기준 완화는 이 계획에서 하지 않는다).

- [ ] **Step 6: (사용자) 합성 제안 정리**

공백 메일(·보충) 제안 알림 무시. "제안" 탭에서 **제목에 `합성`이 들어간 제안만 하나씩 "무시"**. **"전체 무시" 금지.**

- [ ] **Step 7: PoC-6 판정·기록·커밋**

통과 = ③b 통과 + ③c1(expiring 기록·도착) + Step 1~3(`reauth_required`·invalid_grant 푸시·공백 수집 0) + Step 5 기준 전부.
- `gates.md` M1-③c 행 상태 **통과**(또는 실패): `+8일: reauth_required <ISO>(T0+<h>시간, 계기 <webhook|6h cron|watch cron>), invalid_grant 푸시 도착, L <ISO>, 공백 메일 2통 수집 0 → 재연결 R <ISO>, 재적재 N'=<n> <분>분, 재적재 ID 대조 missing 0, P1·P2 listed 2·stored 2, 공백 항목 2행, 재처리 0, 공백·90일 gap missing 0, Gmail API 약 <units> units`.
- `results.md` PoC-6 행: 상태 `1단계 흡수(M1-③)`는 그대로, "남은 실측"을 `— (M1-③ 게이트 통과 <날짜>: 백필 중 웹훅→sync 평균 <e>초, watch 수동·cron, +6일 expiring, +8일 reauth_required → 재연결 누락 0·재처리 0)`로, 갱신일·근거 커밋(③b0·③b1·③b3·③c2)을 고친다. 스펙 §14 판정 현황 PoC-6 행을 같은 값으로.
- 스펙 §16 "Gmail 7일 재인증" 항목 끝 `6일·8일 동작은 1단계 M1-③ 게이트(PoC-6 흡수).`를 `6일·8일 동작은 M1-③c에서 확인(<날짜>).`로.

```bash
git add docs/superpowers/phase1/gates.md docs/superpowers/poc/results.md docs/superpowers/specs/2026-09-22-assistant-design.md
git commit -m "docs(poc): PoC-6 absorbed gate passed in product project (M1-③c)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## 실행 순서와 다른 태스크와의 관계

| 순서 | 태스크 | 언제 | 선행 |
|---|---|---|---|
| 0 | 사용자 확인 UC-1·UC-2 | 지금(메인) | — |
| 1 | M1-③b0 (제품 수정) | 지금, **T0 전 필수** | — (리뷰 → 배포 → smoke-gate → 메인 push) |
| 1' | M1-③b1 (도구) | 지금, **T0 전 필수**, ③b0와 다른 pane 병행 가능 | — (리뷰 통과 후 메인 push) |
| 2 | M1-③b2 | T0(권장 10-01(목) 14:00 KST, 10:00~18:00) | UC-1·UC-2, ③b0 배포, ③b1 push |
| 3 | M1-③b3 | T0 당일 백필 뒤 + T0 다음 날 12:17 KST 이후 | ③b2 |
| — | (UC-1 거절 시) PoC 동의 기준 만료 점검 | 10-04(일) 15:10 KST 이후 | ③b2 |
| 4 | M1-③c1 | T0 + 6일 + 1시간 5분 이후 | ③b2(T0) |
| 5 | M1-③c2 | `status = reauth_required` 확인 뒤(보통 T0 + 8일) | ③c1 |
| 후 | M1-③x1 백필 fetch 잡 50 ID 분할 | ③c2 뒤 또는 계정 확대 전 | — (T0 이후 별도 태스크) |

- M1-G(PoC 은퇴)는 ③c2 통과 뒤(스펙 §15 M1 완료 기준). UC-1로 PoC 동의를 T0 전에 철회했으면 M1-G의 Gmail 부분은 **PoC 행 삭제만** 남는다(같은 Web 클라이언트 revoke가 제품 연결을 끊는 Ruling 6 위험은 제품 연결 전에 해소) — M1-G 실행 때 범위를 고친다. U13의 PoC Pub/Sub 구독 삭제는 제품 구독에 영향이 없다.
- M2-⑥b 실기기 "Gmail 데이터 삭제" 확인은 ③c2 뒤로(Global Constraints).
- 합성 메일 항목(8 + 보충 ≤ 6 + 2개)이 실사용자 보관함에 남는다: M1-④b 200건 라벨 집계와 M2-⑩b 검색 평가 질문에서 `[합성` 제목 항목은 빼고 센다(두 태스크 실행 때 브리프에 적는다).
- 측정 기간 중 다른 pane의 deno 테스트는 테스트 사용자만 건드리므로 병행해도 된다. 단 ③b2 측정 창(T0 ~ 백필 끝)에는 넓은 `gap`·대량 조회를 돌리지 않는다(쿼터·워커 경합).

## Self-Review

- 범위: 1단계 계획 M1-③b Step 4(연결·백필 중 측정)=③b2, Step 5(watch)=③b3 Step 4·6, Step 6(백필 완료·규칙·누락)=③b3 Step 1~3, Step 7(기록)=③b3 Step 7, M1-③c Step 1=③c1, Step 2~4=③c2. 스펙 §15 ③ 게이트 문구와 PoC-6 흡수 항목(watch 수동+cron, OTP·카드 규칙) 전부 대응. T0 전 제품 결함(결정 c·d)은 ③b0.
- 요구 사실 반영: 새 동의 T0(N1·UC-1·③b2 Step 3), 연결 창 제외(F1·`connectSyncIds`), 재시도 표본 유지(F15·`classify`), 실행 중 레인(`busyAt`), 백오프 합쳐짐(F3·`mails` 규칙), 벽시계(N2·`stalled`), Ruling 14(F7·③c2 재처리 0 직접 조회), Ruling C(F4·`deferred_budget`), Ruling E(비용 표·③b3 Step 2), LLM 동시 2(`deferred_busy`), 0.5.0 전제, 사용자/에이전트 분리, 달력(10-01 기준), 개인정보·발송 제한(주소 비출력, N4), 비용·쿼터(`gap` 쉼·429).
- 자리표시자 없음. 타입·이름: `SyncRow.busy`·`LaneRow`·`Verdict`·`summarize` 반환 키·`status` JSON 키(`backfill.stalled`, `connection.id`)가 테스트·스크립트·게이트 Step에서 같다. 순수 테스트 9 + DB 1 = 10.

---

## 결정 기록 (구 "스펙 확인 필요", 2026-09-30 Codex·Fable 판정)

1. **(a) 표본 부족 시 보충** — 결정: 제품 경로 보충. 같은 세션에서 일반 **"Gmail 연결"**(재동의 아님) 재탭 최대 3회로 Ruling 14 재적재가 레인을 점유하게 하고 그 창에서 S1~S6를 보낸다(③b2 Step 5). 최초 표본과 합산·기록 구분. 그래도 부족하면 **대기** → ③c2 Step 5b. **기각:** 실사용자 레인에 SQL로 중복 fetch 잡 주입(AGENTS.md §7 예외를 만들 값어치가 없다), 기준 완화(스펙 §15 ③ 문구 변경). 전제: `busyAt`(중복뿐인 재적재도 "백필 중").
2. **(b) 스펙 §7 `format=full`·쿼터 문구** — 결정: 스펙을 코드에 맞춘다. "`messages.get(format=full)`, 240ms 간격(**fetch 실행 1개당** 분당 ≤ 250건)" + 계정 전체 보장이 아님을 명시. ③b0 Step 1.
3. **(c) 초안 수집** — 결정: 제외, **T0 전**. "실측 후 결정" 단계 삭제(초안 id 변경은 Gmail 공식 동작). 백필·재동기화 q `-in:drafts`, `gmailToItem`이 `DRAFT` → `draft` 폐기(§12 통제 2 최소화). ③b0.
4. **(d) fetch 404** — 결정: **T0 전 필수** 수정. 404는 그 id만 건너뛰고 `gmail_fetch_gone`, 429·5xx는 잡 실패·재시도. B 방식(직접 발송)의 자동 저장 초안 id가 같은 fetch 잡에서 404를 내 발송본까지 잃는 경로를 막는다(커서는 이미 전진해 6시간 cron으로 복구 안 됨). ③b0.
5. **(e) 재동의가 PoC 연결을 끊음** — 결정: "허용"이 아니라 **T0 전에 일부러 철회**(N1). 사용자 확인 UC-1(되돌릴 수 없음). 거절 시 잠정 T0 + 10-04 점검.

## 리뷰 반영 (Gmail 계획 b586342 → 이 수정판)

Codex gpt-6-astra(`.context/codex-review-gmail.out.md`)와 Fable(`.context/fable-review-gmail.md`, Codex 판정 포함)의 번호별 반영 여부. 판정이 갈리면 Fable을 따랐다.

### Codex 지적 8건

| # | Codex | Fable 판정 | 반영 | 어디 |
|---|---|---|---|---|
| 1 | HIGH "전체 무시"가 실제 제안까지 지움 | 동의 HIGH | **반영** — 합성 제안만 개별 무시, "전체 무시" 금지 | U10-3, U11-2, ③b2 Step 7, ③c2 Step 6, Global Constraints |
| 2 | HIGH 재시도 표본 제외로 게이트가 통과될 수 있음 | 동의 HIGH | **반영** — `retried`는 플래그, 평균 포함. `mails` 6행 필수, `max_delay_s > 180` 원인 분류(레인 굶김 = 실패). **미반영:** "측정 불가면 통과 보류"(과함, 게이트는 sync 잡 시작 지연) | ③b1 `classify`·`summarize`, ③b2 Step 5 판정 규칙 |
| 3 | HIGH "90일 누락 0" 증명 못 함 | 부분동의 MED | **반영** — `gap --from-jobs` ID 대조(주) + 기간 gap(보조), items 조회 오류 throw, 404 `gone`. **미반영:** `T0 − 89일` 경계 여유 제거(날짜 단위 경계의 거짓 누락 회피용 허용오차) | ③b1 `judgeIds`·`gap`, ③b3 Step 3, ③c2 Step 5 |
| 4 | MED 백필 중 판정·연결 sync 식별이 추정 | 동의 MED | **반영** — `busyAt`(미클레임 + 실행 중), 연결 창 [start − 30초, end + 30초], 테스트 3건(묶음 앞 sync, 단일 fetch 실행 중, 중복뿐인 재적재). **미반영:** 제품 코드에 `via:"connect"` 표식(불필요 — watch 알림은 진짜 웹훅) | ③b1 Step 1·3·7 |
| 5 | MED 공백 복구·재처리 검증이 집계뿐 | 동의 MED | **반영** — P1·P2 `gap --q` id 기준, 재처리 0 직접 조회(`captured_at < R`), 재적재 종료 = active·stalled·backoff·deferred_busy 0 + dead 0 | ③c2 Step 5 |
| 6 | MED 쿼터 계산이 동시 호출을 빠뜨림 | 부분동의 LOW | **부분 반영** — `gap` 240ms 쉼·429 1회 재시도, 스펙 §7 "fetch 실행 1개당" 문구, 쿼터 표 주석. **미반영:** 계정 합산 예산 도입(증분 22 units/통 → 5,000 + 수십 < 6,000). 실할당량 확인은 T0 이후 선택 | ③b1 Step 7, ③b0 Step 1, 쿼터 표 |
| 7 | MED 명령 예제가 zsh에서 안 돎 | 동의 MED | **반영** — 셸 함수 `g`·`s`, 모든 블록 `# 머리 3줄` | Global Constraints, 전 Step |
| 8 | MED DB 테스트 조회 범위가 병렬과 충돌 | 부분동의 LOW | **반영** — `--connection`, 연결 선택 최근순 정렬, `testUser(7)` 전용, 전역 `test:%` 검사 삭제 | ③b1 Step 5·7·8 |
| 달력 | LOW +7일+6시간에 클레임 여유 없음·Testing 전제 | 동의 LOW | **반영** — ③c2 시작 조건 = `reauth_required` 확인, 달력에 cron + 클레임 여유 | 달력, ③c2 머리 |

### Codex "스펙 확인 필요" a~e · "먼저 바꿀 3가지"

| 항목 | Codex | 반영 |
|---|---|---|
| (a) 보충 부하 | SQL안 보류, 별도 운영 부하 실험 | **부분 반영** — SQL안 기각은 같고, 별도 실험 대신 제품 경로(일반 "Gmail 연결" 재탭) 보충(Fable). 결정 1 |
| (b) full·쿼터 | 스펙을 코드에 맞춤, 실행별 제한 명시 | **반영** — 결정 2, ③b0 Step 1 |
| (c) 초안 | 제외 채택 | **반영(T0 전)** — 결정 3, ③b0 |
| (d) fetch 404 | T0 전 수정 | **반영(T0 전 필수)** — 결정 4, ③b0 |
| (e) PoC 재동의 영향 | 허용, T0 전에 수행 | **반영+강화** — T0 전 의도적 철회, 사용자 확인 UC-1. 결정 5 |
| 먼저 바꿀 3가지 | ① 전체 무시 제거 ② 실패 표본 보존·백필 구간 식별 ③ ID 기준 완결성 | ①② 반영. ③ 반영(우선순위는 Fable대로 ③b0·새 동의 T0 뒤) |

### Fable이 추가한 결함 N1~N6

| # | 결함 | 반영 | 어디 |
|---|---|---|---|
| N1 | HIGH T0가 새 동의라는 보장 없음 — 7일 시계가 PoC 동의(09-27)에 묶일 수 있음 | **반영** — UC-1 철회, ③b2 Step 3 "동의 화면 떴음" 기준·불인정 시 재동의, 거절 시 잠정 T0 + 10-04 15:10 점검, ③c1 조기 `reauth_required` 분기 | 사용자 확인, ③b2, 달력, ③c1 |
| N2 | MED 100 ID fetch 잡이 Edge 150초 벽시계에 걸림 | **부분 반영** — 추정 표 주석, `status.backfill.stalled`, ③b3 Step 1 문구. 제품 수정(50 ID 분할)은 **T0 이후** M1-③x1 | 추정, ③b1, ③b3, T0 이후 표 |
| N3 | MED `gap`이 O1을 증명 못 함·경계 거짓 실패·404 예외 | **반영** — O1은 `gap --q` `listed 1·stored 0·otp 1`, `--before` 지금 − 5분, 404 `gone` | ③b2 Step 6, ③b1 `judgeIds` |
| N4 | MED A 방식 계정 확인이 주소를 명령에 남김·시간표 불일치 | **반영** — UC-2 구두 확인, L1 `mails` 자가 확인(2분 0행 → B 전환), SQL 비교 삭제 | UC-2, ③b2 Step 2·4 |
| N5 | LOW 달력 예시 불가능·밤 T0 | **반영** — T0 = 10-01(목) 14:00 KST 예, 10:00~18:00 권장 | 달력 |
| N6 | LOW 사전 점검에 백필 레인 잔여 0 조건 없음 | **반영** — 우선순위 40 queued·running 0(예산 미룸 제외)·dead 0, 아니면 T0 연기 | ③b2 Step 1 |
| (선택) | L2~L6 본문을 비일정 문구로(개별 무시 건수 감소) | **미반영** — 판정과 무관, 개별 무시 6건 안팎은 감수. 보충 메일 S1~S6만 비일정 문구 | 합성 메일 표 |
