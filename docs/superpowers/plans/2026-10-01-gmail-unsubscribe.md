# ERURI 0.10.0 Gmail 광고 구독 해지 제안 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gmail 광고 메일을 보내는 발신자별로 "최근 30일 광고 N통"과 [해지] 버튼을 설정 화면에 보이고, **사용자가 고른 발신자에게만** RFC 8058 원클릭 해지 요청(POST)을 서버가 보낸다. 자동 해지 없음. Gmail 권한은 `gmail.readonly` 그대로(재동의·스코프 변경 없음). 서버(마이그레이션 + `gmail-fetch` 헤더 기록 + 30일 스캔 잡 + Edge `unsubscribe`) + 앱 0.10.0.

**Architecture:** 광고 메일은 지금 본문 없이 버려진다(규칙 `promotion` 폐기는 행조차 없음, 게이트 `promo` 폐기는 items 행만). 그래서 `gmail-fetch`가 폐기 판정과 같은 자리에서 **헤더 메타만**(From 주소·표시 이름·수신 시각·Gmail 메시지 키·해지 방법, 해지 URL은 사용자 키로 암호화) 새 표 `unsub_senders`·`unsub_mail`에 남긴다. 저장된 메일 중 `List-Unsubscribe`가 있는 것은 `item_id`로 연결해 두고, 게이트가 그 항목을 `promo`로 폐기했을 때만 광고로 센다. 배포 뒤 지난 30일분은 1회 스캔 잡(`format=metadata`)이 채운다. 해지는 Edge `unsubscribe`가 `unsub_begin`(행 잠금·방법 확인·복호화 감사) → URL 복호화 → SSRF 방어 POST(`_shared/safe-post.ts`) → `unsub_finish` 순으로 보낸다. DKIM 서명이 해지 헤더를 덮는 것이 Gmail `Authentication-Results`로 확인될 때만 원클릭으로 본다. 앱은 `unsub_list()` RPC(URL 제외)만 읽는다.

**Tech Stack:** Supabase(Postgres 마이그레이션, Edge Functions Deno/TS, `deno test`), Gmail API(`messages.get format=metadata`, readonly), WebCrypto AES-256-GCM(`_shared/crypto.ts`), `Deno.resolveDns`/DNS-over-HTTPS, SwiftUI iOS 26 앱 `Eruri` + Swift Package `EruriCore`(XCTest), xcodegen `ios/project.yml`, XCUITest(게이트 전용 임시 타깃), TestFlight(`ios/scripts/testflight.sh`).

**Spec:** `docs/superpowers/specs/2026-09-22-assistant-design.md` — U0이 §2(결정 표)·§7(Gmail 동기화 뒤 새 소절 "광고 구독 해지")·§8(표 2개·삭제 표)·§11(버전)·§12(통제 1~5)·§15(1단계 추가 범위·확장 후보 "사용자 지시 메일 정리")·§16(새 소절)을 먼저 고친다. 입력: 사용자 결정(2026-10-01 저녁, 아래 "사용자 결정"). 실행 규칙은 `AGENTS.md` §3(모델)·§5-8(실측 게이트)·§6(기계)·§7(개인정보)·§8(버전).

**출발점:** main `9d245d7` 위. 서버 `0001`~`0027` 적용, 앱 0.9.2(`ios/project.yml:13`). Gmail 게이트 계획(`2026-09-30-phase1-gmail.md`)이 측정 중(T0 = 2026-10-01 14:53:11 KST, ③b3 판정 10-02, ③c1 ≈ 10-07, ③c2 ≈ 10-08 15시 이후). 보관 계획 트랙 B(R-B1~R-B9)는 ③c2 뒤 시작, 마이그레이션은 원장 Ruling M#대로 **다음 빈 번호**.

**태스크:** `U0` 스펙·보관 계획 버전 → `U1` 헤더 해석(TDD) → `U2` 안전 POST(TDD) → `U3` 마이그레이션·DB 테스트·`db push`(창 밖) → `U4` 워커 기록·스캔 잡(TDD) → `U5` Edge `unsubscribe`·스모크 도구(TDD) → `U6` 서버 배포·스모크(창 밖) → `U7` EruriCore `Unsubscribe`(TDD) → `U8` 앱 화면·0.10.0 → `U9` 시뮬레이터 게이트·TestFlight → `U10` ③c2 뒤 30일 스캔·실기기 게이트. 원장 `.superpowers/sdd/2026-10-01-gmail-unsubscribe/progress.md`(상위 원장 `.superpowers/sdd/2026-09-30-phase1/progress.md`의 Rulings 승계).

## 사용자 결정 (2026-10-01 저녁, 이 계획의 원본)

| # | 결정 | 이 계획에서 |
|---|---|---|
| UD1 | **지금: 광고 구독 해지 제안.** 광고 메일(서버 규칙 `(광고)`·게이트로 폐기되는 것 포함)의 `List-Unsubscribe`/`List-Unsubscribe-Post`로 발신자별 "최근 30일 광고 N통"과 [해지]. 사용자가 고른 발신자만 원클릭 POST. 자동 해지 없음. 거래 메일 영향 없음. `gmail.readonly` 그대로 — 재동의·스코프 변경 금지 | U1~U10 전부 |
| UD2 | **나중: 사용자 지시 메일 정리**("이 발신자/이런 내용 메일 지워줘"). `gmail.modify` 재동의가 필요해 ③c2(10-08) 뒤 별도 계획. 이번에는 스펙 §15 확장 후보에 경과·제약만, ERURI 보관함 쪽 삭제 재사용 여부 한 줄 | U0 Step 6 |

## 계획이 정한 것 (사용자 결정이 열어 둔 항목)

| # | 항목 | 결정 | 이유 |
|---|---|---|---|
| D1 | 폐기 메일 헤더 보존 | 지금은 **어디에도 없다**(F3·F5). 새 표 `unsub_senders`(발신자별)·`unsub_mail`(광고 1통 = 1행)에 헤더 메타만 저장. 제목·본문 저장 없음. 해지 URL은 사용자 키 암호화, 주소·표시 이름은 `items.sender`와 같은 등급의 평문. `unsub_mail` 35일, 발신자는 마지막 수신 35일 뒤 삭제(해지 요청 기억 180일) | 30일 집계에 필요한 최소. URL은 받는 사람 식별 토큰·주소를 담는 경우가 많아 자격 증명처럼 다룬다 |
| D2 | 광고로 세는 메일 | 규칙 `promotion` 폐기(라벨·`(광고)` 표기) + 게이트 `promo` 폐기 항목(`items.status = 'discarded:server:promo'`). 사용자가 "복구"하면 광고에서 빠진다 | 거래 메일·뉴스레터를 광고로 오인하지 않게 판정이 이미 있는 것만 |
| D3 | mailto·웹 링크만 있는 발신자 | **목록에 보이고 버튼 없이 사유 표시**("메일 회신 방식 — 앱에서 해지할 수 없어요"). 제외하지 않는다 | 누가 많이 보내는지는 알려 주고, mailto 발송은 `gmail.send` 재동의, 링크 열기는 GET 페이지 조작이라 원클릭이 아님 |
| D4 | 해지 요청 보안 | https만·443·userinfo 금지·로컬 호스트명 금지·DNS A/AAAA 전부 공인 주소(사설·루프백·링크로컬·CGNAT·멀티캐스트·문서용·IPv4 매핑·NAT64·6to4 내장 사설 거부)·전체 10초·301/302/303은 접수로 보고 따라가지 않음·307/308만 2회까지 재검사·응답 본문 읽지 않음·쿠키/인증 헤더 없음. **DKIM 확인 실패면 보내지 않음**(`unverified`) | RFC 8058 §3(서명이 두 헤더를 덮어야 함) + 위조 발신자가 임의 URL로 POST를 유도하지 못하게 |
| D5 | 결과 기록·재표시 억제 | 성공 → `requested`(요청 시각), 실패 → `failed`(코드). 요청 뒤 **3일 유예** 뒤에도 광고가 오면 "해지 요청 뒤에도 N통" + [다시 요청]. 같은 발신자 5회 한도, 60초 안 재요청 `busy`, 60초 넘게 `requesting`이면 결과 없이 끝난 것으로 보고 다시 시도 가능 | 발신자가 처리하는 데 시간이 걸린다(Gmail 대량 발신 가이드 2일). 버튼 두 번 누름·Edge 중단 대비 |
| D6 | UI 위치 | **설정 "Gmail" 절 → "광고 메일 구독 해지" 화면 하나**. 채팅 카드·새 탭 기각 | 질문 응답이 아니라 관리 작업. 탭 4개 유지(스펙 §11) |
| D7 | 30일 과거분 | 배포 뒤 1회 `gmail-unsub-scan` 잡(목록 `newer_than:30d {category:promotions subject:광고} -in:drafts` + 게이트 promo 항목 id → 50개씩 `gmail-unsub-fetch`, `format=metadata`, 백필 레인). 실사용자 잡이므로 **③c2 뒤**(U10) | 배포 즉시 의미 있는 숫자. 측정 기간 실사용자 `jobs` 수정 금지 |
| D8 | 버전 | **이 기능 = 0.10.0**, 보관 계획 R-B9(요약·저장 공간)는 **0.11.0**으로 밀린다(U0이 스펙 §11·§15·보관 계획을 고친다). 실행 때 `git log --oneline -- ios/project.yml`로 0.10.0이 이미 main에 있으면(R-B9가 먼저 들어감) 이 기능이 다음 빈 마이너를 쓰고 스펙·두 계획을 같은 커밋에서 맞춘다 | 이 기능의 앱은 서버 DDL만 있으면 되고 ③c2를 기다리지 않아 R-B9보다 먼저 나간다 |
| D9 | 해지 요청 주체 | 서버(Edge). 기기 직접 POST 기각 | 기기로 URL을 내려야 하고 사용자 IP가 발신자에게 간다 |

## Global Constraints

- **스펙 먼저(AGENTS.md §1):** U0 커밋 전에는 코드 태스크를 시작하지 않는다. 계획과 스펙 문구가 다르면 스펙이 원본이다.
- **Gmail 권한:** `GMAIL_READONLY_SCOPE` 그대로. `gmail-connect`·OAuth 동의 화면·`GOOGLE_*` 설정을 바꾸지 않는다. 앱의 "다시 연결 (동의 다시 받기)"을 누르게 하지 않는다.
- **버전(AGENTS.md §8):** `MARKETING_VERSION: 0.10.0`(U8, D8 확인 후). 빌드 번호는 `testflight.sh` 기본값(`date +%Y%m%d%H%M`). 메이저 금지.
- **서버 변경 범위:** 마이그레이션 1개(`0028_unsubscribe.sql` — 실행 때 다음 빈 번호, 새 표·함수·cron만, **기존 표·함수·행을 바꾸지 않는다**) + `_shared/rules.ts`(`AD_MARK` export 한 단어) + `_shared/gmail.ts`(`getMessageMeta`) + `_shared/unsub.ts`(신규) + `_shared/safe-post.ts`(신규) + `_shared/gmail-jobs.ts`(`recordUnsub`·`gmailUnsubScan`·`gmailUnsubFetch`, `gmailFetch` 두 줄) + `worker/index.ts`(핸들러 2개) + `functions/unsubscribe/`(신규) + `config.toml`(`[functions.unsubscribe] verify_jwt = false`).
- **Gmail 수집 회귀 금지:** `gmailFetch`의 기록 호출은 **fail-open**(`recordUnsub`가 throw하지 않음). 기존 `supabase/tests/gmail.test.ts` 전부 통과가 U4의 완료 조건이다. 기존 테스트의 `fakeDeps`가 `GmailClient`에 생긴 `getMessageMeta`를 갖도록 기본값 한 줄을 더한다(타입 확인).
- **Gmail 측정 창(Gmail 계획 Global Constraints "측정 기간 금지"):** 아래 동작은 창 밖에서만 — `db push`(U3), 함수 배포(U6), 서버 스모크(U3·U5·U6, 테스트 사용자), 시뮬레이터 게이트(U9). 창:
  - ③b3 세션 진행 중(메인이 `.superpowers/sdd/2026-09-30-phase1-gmail/progress.md`·`docs/superpowers/phase1/gates.md`로 확인)
  - ③c1: **10-07(수) 14:30 ~ 16:30 KST**
  - ③c2: **10-08(목) 14:30 KST ~ ③c2 완료 기록**(10-09까지 갈 수 있다)
  - 정확한 시각은 메인이 원장의 마지막 `status.t0`로 다시 계산한다. 못 맞추면 그 단계를 미룬다.
  - **실사용자 행:** 이 계획은 실사용자 `items`·`jobs`·`connections`를 직접 고치지 않는다. 실사용자의 `gmail-unsub-scan` 잡 넣기와 실기기 게이트는 **③c2 완료 기록 뒤**(U10). 배포된 워커가 실사용자 Gmail 수집 중에 `unsub_*` 행을 만드는 것은 새 표라 측정 대상(`items`·`jobs`·`connections`)과 무관하다.
  - 새 잡 종류 `gmail-unsub-fetch`는 Gmail 게이트의 `gap --from-jobs`(백필 `gmail-fetch` 잡의 `payload.ids` ↔ items)에 섞이지 않는다 — 종류가 다르고 payload 키도 `msgs`다.
- **M2 검색 평가 ⑩b:** 이 계획은 chat·검색 함수를 바꾸지 않는다. ⑩b **실행 중이면** U6 워커 재배포만 그 뒤로 미룬다(배포가 진행 중인 워커 호출을 끊을 수 있다).
- **개인정보(AGENTS.md §7, 스펙 §12):** 로그·진단·게이트 기록에는 결과 코드·개수·id만. **발신자 주소·이름·해지 URL·도메인을 로그·`gates.md`·보고에 쓰지 않는다**(실사용자 기록은 `unsub-stats.ts`의 집계만). 테스트·시드는 합성 헤더(`example.com`·`example.net`·`합성` 표기), 실제 메일 헤더·주소를 픽스처에 넣지 않는다. `items.content_enc`·`unsub_senders.url_enc` 복호화 조회 금지(실사용자). 사용자가 앱 화면에서 자기 목록을 보는 것은 제품 기능이다.
- **기계(AGENTS.md §6):** `deno test`·빌드·시뮬레이터 전 `vm_stat | grep -E 'free|compressor'`. 시뮬레이터 빌드와 deno 테스트를 동시에 돌리지 않는다(`pgrep -x deno`가 비었을 때만 시뮬레이터, `pgrep -x xcodebuild`가 비었을 때만 deno). 시뮬레이터는 pane 전용 UDID.
- **테스트 명령:** 서버 `deno test --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/tests/<파일>`(저장소 루트), 타입 확인 `deno check supabase/functions/worker/index.ts supabase/functions/unsubscribe/index.ts supabase/scripts/*.ts`. 앱 `cd ios && ./scripts/sim.sh gen && ./scripts/sim.sh test EruriCoreTests/<클래스>`, 빌드 `cd ios && ./scripts/sim.sh build`.
- **호스팅 DB 테스트(AGENTS.md §7):** 전용 테스트 사용자(`tests/_testenv.ts` `testUser(n)`)·실행 태그(`RUN`)만, 자기 행만 지운다. 테스트 연결은 `connections`에 `account_ref = '<RUN>@example.com'`, `status = 'disconnected'`(cron의 `gmail_enqueue_all`이 고르지 않는다)로 만들고 끝나면 그 행만 지운다(cascade로 `unsub_*`). `purge_unsub`는 반드시 `p_user` 인자로 부른다. 앱 세션이 살아 있어야 하는 게이트 시드는 비밀번호를 바꾸지 않는 `testUserId(n)`만 쓴다.
- **`db push`:** push 직전 `git status --short supabase/migrations`·`ls supabase/migrations | tail -3`으로 **이 태스크 파일 하나만** 새 파일인지 확인하고 `supabase db push --dry-run`을 먼저 본다. 적용된 마이그레이션은 고치지 않는다.
- **모델(AGENTS.md §3):** U0 `opus`/`high`. U1~U5·U7·U8 구현·리뷰 `opus`/`high`(보안 판단 포함). U6 배포·스모크 `opus`/`medium`. U9 시뮬레이터 게이트 `opus`/`medium`. U10 실기기 세션(사용자 조작·대기) `sonnet`/`medium`, 판정·기록이 섞이면 `opus`/`medium`.
- **기록:** `docs/superpowers/phase1/gates.md`에 행 `UNS-server`(U6)·`UNS-sim`(U9)·`UNS-device`(U10). 상태는 통과·실패·대기만("부분"은 마감 아님, AGENTS.md §5-8). 커밋 칸은 비우고 메인이 채운다.
- **커밋:** 태스크마다, 트레일러 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. **push 금지**(메인이 회수 후 `git push origin main`).

## 이 계획이 기대는 사실 (코드에서 확인, 2026-10-01)

| # | 사실 | 출처 |
|---|---|---|
| F1 | watch는 `labelFilterBehavior: "EXCLUDE", labelIds: ["CATEGORY_PROMOTIONS"]` — 광고 메일만으로는 Pub/Sub 푸시가 오지 않는다 | `_shared/gmail.ts` `watch` |
| F2 | `history()`는 `labelId` 없이 `historyTypes=messageAdded`만 준다 → 다음 sync(다른 메일 푸시 또는 6시간 cron `gmail-sync-every-6h`)에 광고 메일 id도 `gmail-fetch`로 온다. 백필·404 재동기화 목록은 `-category:promotions -in:drafts`라 광고를 가져오지 않는다 | `_shared/gmail.ts` `history`·`resync`, 스펙 §7 Gmail 동기화 |
| F3 | `gmailFetch`: `getMessage(format=full)` → `gmailToItem` → `applyRules`가 `CATEGORY_PROMOTIONS` 라벨 또는 `AD_MARK`(제목·본문·발신자)면 `discard: promotion` → **items 행 없음**, 로그 `gmail_discard: "promotion"`만 | `_shared/gmail.ts:136-143`, `_shared/gmail-jobs.ts:84-102`, `_shared/rules.ts:26,109-110` |
| F4 | `AD_MARK`는 `rules.ts`의 모듈 상수(export 아님) | `_shared/rules.ts:26` |
| F5 | 게이트 `promo` 폐기: items 행 유지, `status = 'discarded:server:promo'`, `gate_label = 'promo'`, 본문 7일 격리 뒤 삭제(행·상태 유지). 복구하면 `queued` → 추출 | 스펙 §7, `0010_gate_quarantine.sql` |
| F6 | `insert_item`(0013 판, 12인자)은 새 항목 id, 중복·연결 없음이면 null을 돌려준다. `gmailFetch`는 지금 반환값을 버린다 | `0013_source_delete_lock.sql:1-29`, `gmail-jobs.ts:96` |
| F7 | `delete_gmail_source`는 연결 행을 지우고(→ FK cascade 대상), `payload.connection_id`가 그 연결인 잡을 kind 무관하게 지운다 | `0013_source_delete_lock.sql:33-71` |
| F8 | 재연결(`gmail_save_connection`)은 `(provider, account_ref)` upsert라 **연결 id가 유지**된다 | `0001_baseline.sql:236-238` |
| F9 | `Job` 타입에 `lease_key`가 없다(`id·kind·user_id·payload·attempts·checkpoint`) → 자식 잡 lease는 payload로 넘긴다 | `_shared/job.ts` |
| F10 | `jobs_set_priority`: `payload.backfill = true`면 40(백필 레인), 그 밖의 새 kind는 30 | `0005_jobs_priority.sql:8-16` |
| F11 | `claim_jobs(p_lease_prefix)`: 운영 워커는 `test:%` lease 잡을 가져가지 않는다 | `0003_test_scope.sql:5-27` |
| F12 | `encrypt/decrypt(userId, …)`는 AAD `items:<user>`의 사용자 키 AES-GCM, `fromBytea`는 `\x` hex 문자열을 받는다. `toBytea`는 `\x` hex | `_shared/crypto.ts:15-24,72-106` |
| F13 | `audit_log(user_id, actor, action, target)` FK 없음, `'decrypt'` 행 관례 | `0001_baseline.sql:98-106`, `0015_chunks_embed.sql:14` |
| F14 | 코드에 URL fetch·SSRF 방어 구현이 **없다**(스펙 §7 URL 규칙은 2단계). `Deno.resolveDns`·`redirect: "manual"` 사용처 없음 | `grep -rn 'resolveDns\|redirect: "manual"' supabase/functions` 결과 0 |
| F15 | Edge 함수 JWT: `config.toml`의 `[functions.<name>] verify_jwt`. `account`는 핸들러가 `sb.auth.getUser(token)`으로 사용자를 정한다 | `supabase/config.toml:387-396`, `functions/account/deps.ts` |
| F16 | 앱 설정 "Gmail" 절(`ContentView.swift:32-36`), 요청 도우미 `API.send(path, method:, json:, timeout:)`(401 한 번 재시도), 목록 화면 선례 `RecentDiscardsView` + `EruriCore/RecentDiscards`(행 해석·문구를 Core에 두고 XCTest) | `ios/App/ContentView.swift`, `ios/App/API.swift`, `ios/App/RecentDiscardsView.swift` |
| F17 | 앱 0.9.2, 보관 계획 R-B9가 0.10.0을 예약 | `ios/project.yml:13`, `2026-10-01-retention-summary.md:46,97,3162,3197` |
| F18 | ERURI 보관함 삭제는 출처 전체(`delete_gmail_source` — 사용자의 Gmail 항목 전부 + 연결)와 계정 전체뿐. 항목·발신자 단위 삭제 RPC·화면은 없다 | `0013_source_delete_lock.sql`, `functions/account/handler.ts`, `grep -rn delete_item` 0건 |

## Review Focus

1. **같은 주소로 광고와 거래 메일을 보내는 발신자**(쇼핑몰이 같은 From으로 주문 확인·세일 안내). 사람은 "30일 광고 N통"에 주문 확인이 섞이지 않고, 해지가 주문 메일을 끊지 않길 기대한다 → 광고 판정 메일만 센다: 게이트를 통과한 거래 메일(`extracted`)은 `item_id`로 기록돼도 세지 않는다(U3 `unsub_list counts rule ads and gate-promo items only`), 확인창에 "거래 메일은 계속 올 수 있습니다(발신자 정책)"(U7 `testConfirmCopy`).
2. **위조 발신자·악성 해지 URL**: From을 유명 쇼핑몰로 꾸미고 해지 URL을 내부 주소(`https://10.0.0.1/`, 사설로 풀리는 호스트명, 공인 → 307 → 사설)로 둔 메일. 사람은 그런 요청이 나가지 않길 기대한다 → DKIM 확인 실패면 `unverified`(버튼 없음, U1 `dkim: unsigned/unaligned/uncovered → unverified`), 확인된 URL도 hop마다 주소 검사(U2 `307 to a private address is blocked on the second hop`·`ipBlocked table`), 스모크에서 사설 IP 실제 차단(U5 `smoke-unsub` `blocked_private`).
3. **버튼을 두 번 누르거나 요청 중 앱·Edge가 끊긴다**. 사람은 요청이 한 번만 가고, 결과를 모르면 다시 시도할 수 있길 기대한다 → 60초 안 재요청 `busy`, 60초 넘은 `requesting`은 다시 시작 가능, 앱은 60초 넘은 `requesting`을 "요청 실패 (timeout)" + [다시 시도]로 보인다(U3 `begin: busy within 60s, stale requesting restarts`, U7 `testStaleRequestingIsRetryable`).
4. **해지했는데 광고가 계속 온다**. 사람은 며칠 기다린 뒤에도 오면 알 수 있고 다시 요청할 수 있길 기대한다 → 요청 시각 + 3일 뒤 광고 수 `ads_after_request` → "해지 요청 뒤에도 광고 N통" + [다시 요청], 3일 안 광고는 세지 않는다(U3 `requested sender: ads after the 3-day grace reopen the request`, U7 `testStates`).
5. **기록이 Gmail 수집을 깨뜨린다**: `worker_record_unsub` 오류·연결 삭제 경합·이상한 헤더(From 없음, 2,048자 넘는 URL, 깨진 `Authentication-Results`)로 `gmail-fetch` 잡이 실패하면 백오프·dead로 **거래 메일까지 유실**된다(Gmail 게이트 "누락 0"). 사람은 광고 기능 때문에 메일 수집이 멈추지 않길 기대한다 → `recordUnsub`는 throw하지 않는다(U4 `gmail-fetch: unsub record failure never fails the fetch`), 해석 함수는 어떤 입력에도 throw하지 않고 null·`none`을 낸다(U1 `unsubMeta never throws on malformed headers`).
6. **같은 메일이 두 번 들어온다**(sync 뒤 30일 스캔이 같은 메일을 다시 읽음, 재시도). 사람은 숫자가 부풀지 않길 기대한다 → `unsub_mail` pk `(user_id, msg_key)`, 두 번째 기록은 `item_id`만 보충(U3 `same message twice counts once`).

---

## 파일 구조

```
docs/superpowers/specs/2026-09-22-assistant-design.md          # U0 §2·§7·§8·§11·§12·§15·§16
docs/superpowers/plans/2026-10-01-retention-summary.md          # U0 R-B9 0.10.0 → 0.11.0
supabase/functions/_shared/rules.ts                            # U1 AD_MARK export
supabase/functions/_shared/unsub.ts                            # U1 신규: From·List-Unsubscribe·DKIM 정렬·방법 판정·광고 판정
supabase/tests/unsub.test.ts                                   # U1
supabase/functions/_shared/safe-post.ts                        # U2 신규: URL·IP 검사, 리졸버, 원클릭 POST
supabase/tests/safe-post.test.ts                               # U2
supabase/migrations/0028_unsubscribe.sql                       # U3 신규(다음 빈 번호): 표 2·RPC 8·cron 1
supabase/tests/unsub-db.test.ts                                # U3
supabase/functions/_shared/gmail.ts                            # U4 getMessageMeta·META_HEADERS
supabase/functions/_shared/gmail-jobs.ts                       # U4 recordUnsub·gmailUnsubScan·gmailUnsubFetch, gmailFetch 기록
supabase/functions/worker/index.ts                             # U4 핸들러 2개
supabase/tests/unsub-jobs.test.ts                              # U4
supabase/tests/gmail.test.ts                                   # U4 fakeDeps 기본값 getMessageMeta 한 줄
supabase/functions/unsubscribe/handler.ts, deps.ts, index.ts   # U5 신규
supabase/config.toml                                           # U5 [functions.unsubscribe]
supabase/tests/unsubscribe.test.ts                             # U5
supabase/scripts/smoke-unsub.ts                                # U5 신규: 배포 함수 실측(테스트 사용자)
supabase/scripts/seed-unsub.ts                                 # U5 신규: 시뮬레이터 게이트 시드(testUserId, 비밀번호 불변)
supabase/scripts/unsub-stats.ts                                # U5 신규: 실사용자 집계(주소 없음)·스캔 잡 넣기
ios/Packages/EruriCore/Sources/EruriCore/Unsubscribe.swift     # U7 신규
ios/Packages/EruriCore/Tests/EruriCoreTests/UnsubscribeTests.swift  # U7
ios/App/UnsubscribeView.swift                                  # U8 신규
ios/App/ContentView.swift                                      # U8 Gmail 절 NavigationLink
ios/project.yml                                                # U8 0.10.0
docs/superpowers/phase1/gates.md                               # U6·U9·U10 행
```

## 실행 순서

| 순서 | 태스크 | 선행 | pane | Gmail 창·⑩b |
|---|---|---|---|---|
| 1 | U0 스펙·버전 | 이 계획 커밋 | 문서 | 무관 |
| 2 | U1 헤더 해석 | U0 | 서버 | 무관(로컬) |
| 3 | U2 안전 POST | U0 | 서버(U1과 다른 파일 — 병렬 가능) | 무관(로컬) |
| 4 | U3 마이그레이션 | U1 | 서버 | **`db push`·DB 테스트는 창 밖** |
| 5 | U4 워커 기록·스캔 | U1·U3 | 서버 | 단위 테스트만(창 무관) |
| 6 | U5 Edge·도구 | U2·U3 | 서버 | 단위 테스트만(배포는 U6) |
| 7 | U7 EruriCore | U3 계약(`unsub_list` 열) | 앱(서버와 병렬 가능, deno·시뮬레이터 동시 실행 금지) | 무관 |
| 8 | U6 서버 배포 | U4·U5 | 서버 | **창 밖**, ⑩b 실행 중 아님 |
| 9 | U8 앱 화면·0.10.0 | U7 | 앱 | 무관 |
| 10 | U9 시뮬레이터 게이트·TestFlight | U6·U8 | 앱 | **창 밖**(시드·Edge 호출) |
| 11 | U10 30일 스캔·실기기 | U9 + **③c2 완료 기록** | 서버 + 사용자 | ③c2 뒤 |

---

### Task U0: 스펙·보관 계획 버전

**Files:**
- Modify: `docs/superpowers/specs/2026-09-22-assistant-design.md` (3행 머리, §2 표, §7 "Gmail 동기화" 끝, §8 표·삭제 표, §11 둘째 문단, §12 통제 1~5, §15, §16)
- Modify: `docs/superpowers/plans/2026-10-01-retention-summary.md` (R-B9 버전 4곳)

**Interfaces:**
- Produces: 스펙 §7 "광고 구독 해지" 소절(U1~U10이 따르는 원본), 표 이름 `unsub_senders`·`unsub_mail`, 방법 값 `one_click/unverified/link_only/mailto/none`, 상태 값 `active/requesting/requested/failed`.

행 번호는 `9d245d7` 기준 — 실행 때 `grep -n`으로 다시 찾는다.

- [ ] **Step 1: 머리 갱신 줄**

3행 `갱신:` 바로 뒤에 넣는다:

```
2026-10-01 (광고 구독 해지, 사용자 결정 §2·§7·§8·§11·§12·§15·§16) · 
```

- [ ] **Step 2: §2 결정 표에 행 추가** (`| 메일 |` 행 바로 아래)

```
| 광고 구독 해지 | Gmail 광고 메일(규칙 `promotion` 폐기·게이트 `promo` 폐기)의 발신자별 최근 30일 수와 **원클릭 해지(RFC 8058)** 버튼. 사용자가 고른 발신자에게만, 누를 때만 서버가 해지 POST. 자동 해지 없음. 권한은 `gmail.readonly` 그대로(헤더 읽기만) | 2026-10-01 사용자 결정(§7 "광고 구독 해지", §16) |
```

- [ ] **Step 3: §7 새 소절** — "### Gmail 동기화"의 마지막 bullet(`재인증 푸시:` 줄) 뒤, `## 8. 데이터 모델` 앞에 넣는다:

```markdown
### 광고 구독 해지 (2026-10-01 사용자 결정, 앱 0.10.0)

- **무엇**: 광고 메일을 보내는 발신자별로 "최근 30일 광고 N통"과 [해지]를 보인다. 사용자가 고른 발신자에게만, 확인창 뒤에 서버가 해지 요청을 보낸다. 자동 해지·일괄 해지 없음. 거래 메일은 대상이 아니다 — 광고로 판정된 메일만 세고, 해지는 그 발신자의 광고 수신 거부 요청이다(거래 메일 발송은 발신자 정책).
- **광고 판정**: (a) 서버 규칙 `promotion` 폐기(`CATEGORY_PROMOTIONS` 라벨·`(광고)` 표기) — 본문은 지금처럼 저장하지 않는다, (b) 저장된 Gmail 항목 중 Jev 게이트가 `promo`로 폐기한 것(`items.status = 'discarded:server:promo'`). 사용자가 "복구"하면 광고에서 빠진다.
- **기록(헤더 메타만)**: `gmail-fetch`가 (a) 메일과, 저장한 메일 중 `List-Unsubscribe` 헤더가 있는 것(게이트 판정 전이라 `item_id`로 연결해 두고 판정이 `promo`일 때만 센다)의 From 주소·표시 이름(60자)·수신 시각·Gmail 메시지 키(`gmail:<id>`)·해지 방법을 `unsub_senders`·`unsub_mail`(§8)에 남긴다. 제목·본문은 저장하지 않는다. 해지 URL은 `one_click`일 때만 사용자 데이터 키로 암호화해 둔다(§12 통제 1). 기록 실패는 메일 수집을 실패시키지 않는다(fail-open, 로그 코드 `unsub_record_error`).
- **도착 경로**: watch는 프로모션 라벨을 제외해 광고 메일만으로는 Pub/Sub이 오지 않는다. 광고 메일은 다음 sync(다른 메일의 푸시 또는 6시간 cron)의 history로 들어와 기록된다 — 집계는 최대 약 6시간 늦다. 백필·재동기화 목록의 `-category:promotions`는 그대로다.
- **30일 스캔(1회)**: 배포 뒤 운영자가 `gmail_enqueue_unsub_scan(user)`로 `gmail-unsub-scan` 잡을 넣는다(Gmail 게이트 ③c2 뒤). 목록 `newer_than:30d {category:promotions subject:광고} -in:drafts`와 최근 30일 게이트 `promo` 항목의 Gmail id를 모아 `gmail-unsub-fetch` 잡(50개씩, 백필 레인, lease `gmail:<connection>`)이 `messages.get format=metadata`(From·Subject·List-Unsubscribe·List-Unsubscribe-Post·Authentication-Results·DKIM-Signature)로 헤더만 읽는다. 라벨·제목 표기로 광고가 아니면 버린다. 연결을 지우고 다시 연결해도 스캔은 다시 넣지 않는다(새 광고부터 쌓인다).
- **해지 방법 판정**(그 발신자의 가장 최근 메일 기준): `one_click` = https URI + `List-Unsubscribe-Post: List-Unsubscribe=One-Click` + Gmail(`mx.google.com`)의 `Authentication-Results`에서 `dkim=pass`인 서명 도메인이 From 도메인과 같거나 그 상위 도메인이고 그 도메인의 `DKIM-Signature` `h=`가 `List-Unsubscribe`·`List-Unsubscribe-Post`를 모두 덮음(RFC 8058 §3) · `unverified` = 원클릭 헤더는 있으나 위 서명 확인 실패 · `link_only` = https 링크뿐(웹 페이지 방식) · `mailto` = 메일 주소뿐 · `none` = 헤더 없음. URL이 2,048자를 넘으면 없는 것으로 본다. **`one_click`만 [해지] 버튼**, 나머지는 사유만 보인다(mailto 발송은 `gmail.send` 재동의, 링크 열기는 원클릭이 아니어서 이번 범위 밖 — §16).
- **해지 요청**(Edge `unsubscribe`, 사용자 JWT, `POST {sender_id}`): `unsub_begin`(행 잠금, 방법·상태 확인, 복호화 감사) → URL 복호화 → 안전 POST → `unsub_finish`. 안전 POST(`_shared/safe-post.ts`): https만, 포트 443, userinfo 없음, `localhost`·`.local`·`.internal`·`.home.arpa`·점 없는 호스트 거부, DNS(A·AAAA) 결과가 하나라도 사설·루프백·링크로컬·CGNAT·멀티캐스트·예약·문서용·IPv4 매핑/NAT64/6to4 내장 사설이면 거부, 본문 `List-Unsubscribe=One-Click`(`application/x-www-form-urlencoded`), 쿠키·인증 헤더 없음, 전체 10초. 리다이렉트: 301·302·303은 접수로 보고 따라가지 않는다, 307·308만 최대 2회 주소를 다시 검사해 POST. 응답 본문은 읽지 않는다. 남은 위험: DNS 재바인딩(검사와 연결 사이 주소가 바뀜) — 응답을 돌려주지 않는 고정 본문 POST라 영향이 작다. 리졸버는 런타임의 `Deno.resolveDns`, 없으면 DNS-over-HTTPS(`dns.google`, 호스트 이름만 간다).
- **결과·재표시**: 2xx·301/302/303 → `requested`(요청 시각), 그 밖 → `failed`(결과 코드). 요청 시각 + 3일 뒤에도 광고가 오면 "해지 요청 뒤에도 광고 N통"과 [다시 요청]. 같은 발신자 요청은 5회까지, 60초 안 재요청은 `busy`, 60초 넘게 `requesting`이면 결과 없이 끝난 것으로 보고 다시 시도할 수 있다. 목록은 최근 30일 광고가 있거나 30일 안에 요청·실패한 발신자만, 30일 광고 수 순, 100곳까지.
- **보관**: `unsub_mail` 35일. 메일 행이 없고 마지막 수신 35일이 지난 발신자는 지운다(해지 요청한 발신자는 요청 뒤 180일 기억) — `unsub-purge-daily`. 출처 삭제(연결 행 삭제 cascade)·계정 삭제(cascade)가 함께 지운다.
- **화면**: 설정 "Gmail" 절의 "광고 메일 구독 해지" → 목록 화면(§11).
```

- [ ] **Step 4: §8 표 행 2개** (`| eval_judgments |` 행 바로 아래)

```
| `unsub_senders` | connection_id(connections cascade), address(From 주소, 소문자), display_name(≤60자), method(one_click/unverified/link_only/mailto/none), url_enc bytea(one_click만, 사용자 키 AES-256-GCM), last_seen_at, status(active/requesting/requested/failed), status_at, requested_at, result_code, attempts | 광고 구독 해지(§7). unique(connection_id, address). 주소·표시 이름은 `items.sender`와 같은 등급의 평문. RLS 켜고 정책 없음 — 앱은 `unsub_list()`(authenticated, url_enc 제외)만 부른다 |
| `unsub_mail` | sender_id(cascade), msg_key(`gmail:<id>`), occurred_at, item_id null(items cascade) | 광고 판정 후보 메일 1통 = 1행, pk(user_id, msg_key)(sync·스캔 중복 없음). item_id null = 규칙 광고, 있으면 그 항목이 게이트 `promo` 폐기일 때만 센다. 35일 보관 |
```

삭제·만료 표: `| 폐기 격리 만료 |` 행 아래에 추가

```
| 광고 발신자 기록 | pg_cron `unsub-purge-daily`(§7 광고 구독 해지) | 35일 지난 `unsub_mail`, 메일 행이 없고 마지막 수신 35일 지난 `unsub_senders`(해지 요청 180일 이내 제외) | — |
```

`| 항목·출처 삭제 |` 행의 "지우는 것" 칸 끝 `·Storage 객체` 뒤에 `·unsub_senders·unsub_mail(연결 cascade)`를 붙인다.

- [ ] **Step 5: §11 버전 문장**

`요약·저장 공간 화면은 서버 반영 뒤라 0.10.0)` → `광고 메일 구독 해지 화면(설정 Gmail 절 → 목록)은 0.10.0, 요약·저장 공간 화면은 서버 반영 뒤라 0.11.0)`

§15 "1단계 추가 범위(2026-10-01 사용자 결정, §16)" 문단의 `요약·저장 공간 화면은 앱 0.9.0이다.` → `요약·저장 공간 화면은 앱 0.11.0이다(0.9.x는 다건·종일·중복 일정, 0.10.0은 광고 구독 해지).`

- [ ] **Step 6: §12 통제·§15 확장 후보**

통제 1 "보호 범위" 문장의 `항목 요약 문장**(`item_summaries.summary_enc`, 2026-10-01)이다.` 뒤에 ` 광고 구독 해지 URL(`unsub_senders.url_enc`)도 같은 키로 암호화한다.`를 붙이고, 같은 문장의 평문 목록 `` `memories`는 검색·답변에 필요해 평문이며`` 를 `` `memories`, 광고 발신자 주소·표시 이름(`unsub_senders.address`·`display_name`)은 평문이며``로 고친다.

통제 2 마지막 bullet 뒤에 추가:

```
- 광고 메일(프로모션 라벨·`(광고)`·게이트 `promo`)은 본문·제목을 저장하지 않는 원칙 그대로다. 구독 해지를 위해 발신자 주소·표시 이름·수신 시각·Gmail 메시지 키·해지 방법과 암호화한 해지 URL만 35일(해지 요청한 발신자는 180일) 둔다(§7 광고 구독 해지). 이 메타는 LLM·Jev로 보내지 않는다.
```

통제 3 마지막 bullet 뒤에 추가:

```
- 광고 구독 해지 요청은 사용자가 고른 발신자의 해지 URL로만 간다(받는 쪽 = 그 발신자, 내용 = 고정 문자열 `List-Unsubscribe=One-Click`). Edge가 보내므로 사용자 기기 IP는 가지 않는다. DNS-over-HTTPS 대체 경로를 타면 그 호스트 이름이 Google 공개 DNS로 간다.
```

통제 4 `audit_log(user_id, actor, action, target)` bullet 뒤에 추가:

```
- 해지 URL 복호화는 `unsub_begin`이 `audit_log(actor='unsubscribe', action='decrypt', target='unsub:<sender_id>')`로, 결과는 `action='unsubscribe'`(대상 id·결과 코드만)로 남긴다. 함수 로그에는 결과 코드만(주소·URL·도메인 없음).
```

통제 5 "저장 공간" bullet 뒤에 추가:

```
- 광고 구독 해지(2026-10-01): 사용자가 [해지]를 누르고 확인창에서 승인할 때만 그 발신자 한 곳에 보낸다. 확인창에 "되돌리려면 그 서비스에서 다시 수신 동의" "거래 메일은 계속 올 수 있음"을 적는다(§7).
```

§15 "1단계 추가 범위(2026-10-01 검색·캘린더 결정, §16)" 문단 뒤에 추가:

```
**1단계 추가 범위(2026-10-01 광고 구독 해지 결정, §16)**: Gmail 광고 메일 발신자별 30일 수 + 원클릭 해지(§7 "광고 구독 해지"), 앱 0.10.0(설정 Gmail 절). 계획 `docs/superpowers/plans/2026-10-01-gmail-unsubscribe.md`. 마이그레이션은 새 표·함수·cron만이고 워커 기록은 fail-open이라 Gmail 측정 기간에도 측정 창 밖에서 push·배포한다. 실사용자 30일 스캔 잡과 실기기 게이트는 ③c2 뒤. M2 게이트와 독립.
```

"확장 후보" 목록 끝에 추가:

```
- **사용자 지시 메일 정리**("이 발신자/이런 내용 메일 지워줘", 2026-10-01 사용자 제안 — ③c2 뒤 별도 계획): Gmail 쪽 라벨·보관·휴지통은 `gmail.modify`가 필요하다 → 재동의(측정 기간 T0~③c2에는 금지라 그 뒤). `gmail.modify`는 제한(restricted) 범위라 테스트 모드 밖(지인 확대)에서는 앱 검증·CASA 대상이다(§3 Gmail 테스트 모드 줄과 같은 조건). 제약: 대상 목록(발신자·기간·개수, 제목만)을 먼저 보이고 **확인 단계 필수**, 영구 삭제(`messages.delete`, 더 넓은 `https://mail.google.com/` 범위) 없이 **휴지통(`messages.trash`, Gmail이 30일 뒤 비움)·보관(INBOX 라벨 제거)만** — 되돌릴 수 있게, 실행 개수와 되돌리기(untrash) 경로를 남긴다. ERURI 보관함 쪽: 지금은 출처 전체(`delete_gmail_source` — 사용자의 Gmail 항목 전부 + 연결)와 계정 전체 삭제만 있어 발신자·내용 단위로는 재사용할 수 없고, 같은 삭제 순서(잡 → facts 정정 연결 끊기 → facts → items, 한 트랜잭션)를 항목 id 배열을 받는 `delete_items(p_user, p_items)`로 일반화하면 된다.
```

- [ ] **Step 7: §16 새 소절** — "### 2026-10-01 날짜만 일정 = 종일 일정" 소절 뒤에 넣는다:

```markdown
### 2026-10-01 광고 구독 해지 (사용자 결정, 앱 0.10.0)

광고 메일은 서버 규칙·게이트로 버려지지만 받은편지함에는 계속 쌓인다. 결정: 발신자별 최근 30일 광고 수와 원클릭 해지 버튼, 사용자가 고른 발신자만 해지 요청(§7 "광고 구독 해지"). Gmail 권한은 `gmail.readonly` 그대로(측정 기간 재동의 금지와도 맞는다). 계획이 정한 것: 화면은 설정 Gmail 절 → 별도 목록 화면(채팅 카드·새 탭 기각 — 질문이 아니라 관리 작업이고 탭은 4개 유지), mailto·웹 링크 방식은 사유만 보이고 버튼 없음(mailto는 `gmail.send` 재동의, 링크 열기는 GET 페이지 조작이 필요해 원클릭이 아님), 해지는 서버(Edge)가 보낸다(기기에서 보내면 해지 URL을 기기로 내려야 하고 사용자 IP가 발신자에게 간다), 원클릭 헤더가 있어도 DKIM 서명 확인이 안 되면 보내지 않는다(위조 발신자가 임의 URL로 POST를 유도하지 못하게, RFC 8058 §3), 요청 뒤 3일 유예 뒤에도 광고가 오면 다시 요청을 연다, 버전은 이 기능이 0.10.0이고 보관 계획 R-B9(요약·저장 공간)는 0.11.0. 기각: 자동 해지(사용자 확인 원칙 — 일정 등록과 같은 이유), 광고 판정 안 된 뉴스레터까지 보이기(거래·구독 메일 오인 위험), 제목 저장(목록에는 발신자·개수면 충분), 해지 결과 페이지 따라가기(본문을 읽어야 하고 SSRF 표면이 넓어진다). 남은 것: 원클릭을 지원하지 않는 발신자 비율은 실측(계획 U10)으로 보고, 낮으면 "웹 페이지 열기(사용자 브라우저)"를 후속 후보로 사용자에게 묻는다.
```

- [ ] **Step 8: 보관 계획 R-B9 버전**

`docs/superpowers/plans/2026-10-01-retention-summary.md`에서:
- `**R-B9 = 0.10.0**(스펙 §11, 2026-10-01 검색·캘린더 결정 5)` → `**R-B9 = 0.11.0**(스펙 §11 — 0.10.0은 광고 구독 해지 계획 `2026-10-01-gmail-unsubscribe.md`)`
- `# R-A2 0.7.0 / R-B9 0.10.0` → `# R-A2 0.7.0 / R-B9 0.11.0`
- `버전: \`MARKETING_VERSION: 0.10.0\`(0.8.0은 검색·캘린더 계획 C1·C2 — \`git log --oneline -- ios/project.yml\`로 0.8.0이 main에 있는지 확인하고, 없으면 메인에게 알린다).` → `버전: \`MARKETING_VERSION: 0.11.0\`(0.10.0은 광고 구독 해지 계획 — \`git log --oneline -- ios/project.yml\`로 0.10.0이 main에 있는지 확인하고, 없으면 메인에게 알린다).`
- `보관·요약·용량은 Gmail 게이트 뒤(0.10.0 — 0.8.0은 검색·캘린더 계획)` → `보관·요약·용량은 Gmail 게이트 뒤(0.11.0 — 0.10.0은 광고 구독 해지 계획)`

Run: `grep -n '0\.10\.0\|0\.11\.0' docs/superpowers/plans/2026-10-01-retention-summary.md`
Expected: `0.10.0`이 남은 줄은 모두 "광고 구독 해지"를 함께 언급한다. 다른 `0.10.0`이 남아 있으면 같은 방식으로 고친다.

- [ ] **Step 9: 대조와 커밋**

Run: `grep -n '광고 구독 해지\|unsub_senders\|0\.11\.0' docs/superpowers/specs/2026-09-22-assistant-design.md | wc -l`
Expected: 12 이상(§2·§7·§8×3·§11·§12×4·§15×2·§16).

```bash
git add docs/superpowers/specs/2026-09-22-assistant-design.md docs/superpowers/plans/2026-10-01-retention-summary.md
git commit -m "docs(spec): Gmail ad unsubscribe (user decision, app 0.10.0) — §7 per-sender 30-day ad counts from header metadata only (rule promotion discards and gate promo items), RFC 8058 one-click POST from Edge only for the sender the user picks (DKIM covering both headers, https/public-IP/10s/no-follow), 3-day grace re-request, 35-day metadata; §8 unsub_senders/unsub_mail; §12 encrypted URL, plaintext sender address; §15 user-directed mail cleanup deferred past ③c2 (gmail.modify, confirm, trash only); retention R-B9 → 0.11.0

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task U1: 헤더 해석 (`_shared/unsub.ts`)

**Files:**
- Modify: `supabase/functions/_shared/rules.ts:26` (`const AD_MARK` → `export const AD_MARK`)
- Create: `supabase/functions/_shared/unsub.ts`
- Test: `supabase/tests/unsub.test.ts`

**Interfaces:**
- Consumes: `header(msg, name)`, `GmailMessage`(`_shared/gmail.ts`), `AD_MARK`(`_shared/rules.ts`).
- Produces:
  - `type UnsubMethod = "one_click" | "unverified" | "link_only" | "mailto" | "none"`
  - `type UnsubMeta = { address: string; name: string | null; method: UnsubMethod; url: string | null }` (`url`은 `one_click`일 때만)
  - `parseFrom(v: string | null): { address: string; name: string | null } | null`
  - `listUnsubUris(v: string | null): string[]`
  - `dkimCovers(msg, fromDomain: string): boolean`
  - `unsubMeta(msg: Pick<GmailMessage, "payload">): UnsubMeta | null` — 절대 throw하지 않는다
  - `hasListUnsub(msg): boolean`
  - `isAdMail(msg: Pick<GmailMessage, "payload" | "labelIds">): boolean`

- [ ] **Step 1: 실패하는 테스트 작성**

`supabase/tests/unsub.test.ts`:

```ts
import { assertEquals } from "jsr:@std/assert";
import type { GmailMessage } from "../functions/_shared/gmail.ts";
import { dkimCovers, hasListUnsub, isAdMail, listUnsubUris, parseFrom, unsubMeta } from "../functions/_shared/unsub.ts";

// 합성 헤더만(AGENTS.md §7). 도메인은 example.com/net
const msg = (h: Record<string, string | string[]>, labelIds = ["INBOX"]): GmailMessage => ({
  id: "m1", internalDate: "1790000000000", labelIds,
  payload: { headers: Object.entries(h).flatMap(([name, v]) => (Array.isArray(v) ? v : [v]).map((value) => ({ name, value }))) },
});
const FROM = '"합성쇼핑" <news@mail.example.com>';
const LU = "<mailto:unsub@mail.example.com?subject=unsub>, <https://u.example.com/one?t=abc>";
const LUP = "List-Unsubscribe=One-Click";
const AR_PASS = "mx.google.com; dkim=pass header.i=@example.com header.s=s1 header.b=AbC; spf=pass smtp.mailfrom=bounce@mail.example.com";
const SIG = "v=1; a=rsa-sha256; d=example.com; s=s1; h=From:Subject:List-Unsubscribe:List-Unsubscribe-Post:Date; bh=x; b=y";

Deno.test("parseFrom: display name + angle address, bare address, quoted, junk", () => {
  assertEquals(parseFrom(FROM), { address: "news@mail.example.com", name: "합성쇼핑" });
  assertEquals(parseFrom("News@Example.COM"), { address: "news@example.com", name: null });
  assertEquals(parseFrom("합성 상점 <a@example.net>"), { address: "a@example.net", name: "합성 상점" });
  assertEquals(parseFrom("x".repeat(80) + " <a@example.net>")!.name!.length, 60);
  assertEquals(parseFrom("no address here"), null);
  assertEquals(parseFrom(null), null);
});

Deno.test("listUnsubUris: angle-bracket list in order", () => {
  assertEquals(listUnsubUris(LU), ["mailto:unsub@mail.example.com?subject=unsub", "https://u.example.com/one?t=abc"]);
  assertEquals(listUnsubUris("https://no-brackets.example.com"), []);
  assertEquals(listUnsubUris(null), []);
});

Deno.test("one_click: https + Post header + Gmail dkim=pass aligned (parent domain) + signature covers both headers", () => {
  const m = msg({ From: FROM, "List-Unsubscribe": LU, "List-Unsubscribe-Post": LUP, "Authentication-Results": AR_PASS, "DKIM-Signature": SIG });
  assertEquals(unsubMeta(m), { address: "news@mail.example.com", name: "합성쇼핑", method: "one_click", url: "https://u.example.com/one?t=abc" });
  assertEquals(dkimCovers(m, "mail.example.com"), true);
});

Deno.test("dkim: unsigned / unaligned / uncovered / non-Gmail AR first → unverified, no url", () => {
  const base = { From: FROM, "List-Unsubscribe": LU, "List-Unsubscribe-Post": LUP };
  const cases: Record<string, string | string[]>[] = [
    { ...base },                                                                                   // 서명·AR 없음
    { ...base, "Authentication-Results": AR_PASS.replace("@example.com", "@evil.example.net"), "DKIM-Signature": SIG.replace("d=example.com", "d=evil.example.net") },
    { ...base, "Authentication-Results": AR_PASS, "DKIM-Signature": SIG.replace(":List-Unsubscribe-Post", "") },   // Post 헤더 미서명
    { ...base, "Authentication-Results": AR_PASS.replace("dkim=pass", "dkim=fail"), "DKIM-Signature": SIG },
    { ...base, "Authentication-Results": ["relay.example.net; dkim=pass header.i=@example.com"], "DKIM-Signature": SIG },  // Gmail AR 아님
  ];
  for (const h of cases) assertEquals(unsubMeta(msg(h))?.method, "unverified");
  for (const h of cases) assertEquals(unsubMeta(msg(h))?.url, null);
});

Deno.test("dkim: reverse alignment (signer is a subdomain of From) is not accepted", () => {
  const m = msg({ From: "a@example.com", "List-Unsubscribe": "<https://u.example.com/x>", "List-Unsubscribe-Post": LUP,
    "Authentication-Results": "mx.google.com; dkim=pass header.i=@mail.example.com", "DKIM-Signature": SIG.replace("d=example.com", "d=mail.example.com") });
  assertEquals(unsubMeta(m)?.method, "unverified");
});

Deno.test("methods: link_only, mailto, none; URL over 2048 chars ignored", () => {
  assertEquals(unsubMeta(msg({ From: FROM, "List-Unsubscribe": "<https://u.example.com/page>" }))?.method, "link_only");
  assertEquals(unsubMeta(msg({ From: FROM, "List-Unsubscribe": "<mailto:u@example.com>", "List-Unsubscribe-Post": LUP }))?.method, "mailto");
  assertEquals(unsubMeta(msg({ From: FROM }))?.method, "none");
  const long = "<https://u.example.com/" + "a".repeat(2100) + ">";
  assertEquals(unsubMeta(msg({ From: FROM, "List-Unsubscribe": long, "List-Unsubscribe-Post": LUP, "Authentication-Results": AR_PASS, "DKIM-Signature": SIG }))?.method, "none");
  assertEquals(unsubMeta(msg({ From: FROM, "List-Unsubscribe": "<http://u.example.com/x>", "List-Unsubscribe-Post": LUP }))?.method, "none");   // http 는 링크로 치지 않는다
});

Deno.test("unsubMeta never throws on malformed headers", () => {
  const weird: Record<string, string | string[]>[] = [
    {}, { From: "" }, { From: "<>" }, { From: FROM, "List-Unsubscribe": "<<<>>>" },
    { From: FROM, "List-Unsubscribe": LU, "List-Unsubscribe-Post": LUP, "Authentication-Results": ";;;=", "DKIM-Signature": "=;=;h" },
  ];
  for (const h of weird) unsubMeta(msg(h));
  assertEquals(unsubMeta({ payload: undefined }), null);
});

Deno.test("hasListUnsub / isAdMail: promotion label, (광고) subject or sender; not plain mail", () => {
  assertEquals(hasListUnsub(msg({ From: FROM, "List-Unsubscribe": LU })), true);
  assertEquals(hasListUnsub(msg({ From: FROM })), false);
  assertEquals(isAdMail(msg({ From: FROM, Subject: "가을 세일" }, ["INBOX", "CATEGORY_PROMOTIONS"])), true);
  assertEquals(isAdMail(msg({ From: FROM, Subject: "(광고) 합성 할인" })), true);
  assertEquals(isAdMail(msg({ From: "[광고] 합성몰 <a@example.com>", Subject: "안내" })), true);
  assertEquals(isAdMail(msg({ From: FROM, Subject: "합성 주문 확인" })), false);
  assertEquals(isAdMail(msg({ From: FROM, Subject: "광고 문의 답변" })), false);   // 맨 앞 (광고) 표기가 아니다
});
```

- [ ] **Step 2: 실패 확인**

Run: `deno test --allow-net --allow-env --allow-read supabase/tests/unsub.test.ts`
Expected: FAIL — `Module not found "…/_shared/unsub.ts"`.

- [ ] **Step 3: 구현**

`supabase/functions/_shared/rules.ts` 26행: `const AD_MARK =` → `export const AD_MARK =`.

`supabase/functions/_shared/unsub.ts`:

```ts
import { type GmailMessage, header } from "./gmail.ts";
import { AD_MARK } from "./rules.ts";

// 광고 구독 해지(스펙 §7 "광고 구독 해지"): 헤더만 해석한다. 어떤 입력에도 throw하지 않는다 — gmail-fetch 를 실패시키면 메일이 유실된다
export type UnsubMethod = "one_click" | "unverified" | "link_only" | "mailto" | "none";
export type UnsubMeta = { address: string; name: string | null; method: UnsubMethod; url: string | null };
type Msg = Pick<GmailMessage, "payload">;

const MAX_URL = 2048;

export function parseFrom(v: string | null): { address: string; name: string | null } | null {
  if (!v) return null;
  const m = v.match(/^\s*(.*?)\s*<([^<>\s]+)>\s*$/);
  const address = (m ? m[2] : v.trim()).toLowerCase();
  if (!/^[^@\s<>"]+@[^@\s<>"]+\.[^@\s<>"]+$/.test(address)) return null;
  const name = (m?.[1] ?? "").replace(/^"+|"+$/g, "").trim();
  return { address, name: name ? name.slice(0, 60) : null };
}

export function listUnsubUris(v: string | null): string[] {
  if (!v) return [];
  return [...v.matchAll(/<([^<>]+)>/g)].map((m) => m[1].trim()).filter((s) => s.length > 0);
}

function allHeaders(msg: Msg, name: string): string[] {
  return (msg.payload?.headers ?? []).filter((h) => h.name.toLowerCase() === name.toLowerCase()).map((h) => h.value ?? "");
}

function sigTags(v: string): { d: string; h: string[] } {
  const t: Record<string, string> = {};
  for (const part of v.split(";")) {
    const i = part.indexOf("=");
    if (i > 0) t[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).replace(/\s+/g, "").toLowerCase();
  }
  return { d: t.d ?? "", h: (t.h ?? "").split(":").filter(Boolean) };
}

// RFC 8058 §3: DKIM 서명이 List-Unsubscribe·List-Unsubscribe-Post 를 덮어야 한다.
// Gmail(mx.google.com)이 붙인 Authentication-Results 의 dkim=pass 서명 도메인 D 가 From 도메인과 같거나 그 상위이고,
// 같은 D 의 DKIM-Signature h= 가 두 헤더를 포함할 때만 true. 역방향(서명 도메인이 From 의 하위)은 받지 않는다
export function dkimCovers(msg: Msg, fromDomain: string): boolean {
  const ar = allHeaders(msg, "Authentication-Results").find((v) => /^\s*mx\.google\.com\s*;/i.test(v));
  if (!ar) return false;
  const passed = [...ar.matchAll(/\bdkim=pass\b[^;]*?\bheader\.(?:i|d)=(?:[^@\s;]*@)?([a-z0-9.-]+)/gi)].map((m) => m[1].toLowerCase());
  const sigs = allHeaders(msg, "DKIM-Signature").map(sigTags);
  return passed.some((d) =>
    (fromDomain === d || fromDomain.endsWith("." + d)) &&
    sigs.some((s) => s.d === d && s.h.includes("list-unsubscribe") && s.h.includes("list-unsubscribe-post"))
  );
}

export function unsubMeta(msg: Msg): UnsubMeta | null {
  try {
    const from = parseFrom(header(msg, "From"));
    if (!from) return null;
    const uris = listUnsubUris(header(msg, "List-Unsubscribe"));
    const https = uris.find((u) => /^https:\/\//i.test(u) && u.length <= MAX_URL) ?? null;
    const mailto = uris.some((u) => /^mailto:/i.test(u));
    const post = (header(msg, "List-Unsubscribe-Post") ?? "").replace(/\s+/g, "").toLowerCase() === "list-unsubscribe=one-click";
    let method: UnsubMethod = "none";
    if (https && post) method = dkimCovers(msg, from.address.split("@")[1]) ? "one_click" : "unverified";
    else if (https) method = "link_only";
    else if (mailto) method = "mailto";
    return { ...from, method, url: method === "one_click" ? https : null };
  } catch {
    return null;
  }
}

export function hasListUnsub(msg: Msg): boolean {
  return header(msg, "List-Unsubscribe") !== null;
}

// 메타데이터(format=metadata)만으로 하는 광고 판정: 프로모션 라벨, 제목·발신자의 (광고) 표기(본문 표기는 볼 수 없다)
export function isAdMail(msg: Pick<GmailMessage, "payload" | "labelIds">): boolean {
  if (msg.labelIds?.includes("CATEGORY_PROMOTIONS")) return true;
  return [header(msg, "Subject") ?? "", header(msg, "From") ?? ""].some((s) => AD_MARK.test(s));
}
```

- [ ] **Step 4: 통과 확인**

Run: `deno test --allow-net --allow-env --allow-read supabase/tests/unsub.test.ts supabase/tests/rules.test.ts`
Expected: PASS(새 8개 + 기존 rules 전부).

Note: `isAdMail` 테스트의 `"[광고] 합성몰 <a@example.com>"`는 `AD_MARK`(`^\s*(?:\[Web발신\]\s*)?[(\[]\s*광고\s*[)\]]`)가 대괄호도 받으므로 true다. `AD_MARK`가 다르게 정의돼 있으면 테스트가 아니라 이 줄의 기대를 `AD_MARK`에 맞춰 고치고 그 이유를 커밋 메시지에 적는다.

- [ ] **Step 5: 커밋**

```bash
git add supabase/functions/_shared/rules.ts supabase/functions/_shared/unsub.ts supabase/tests/unsub.test.ts
git commit -m "feat(server): unsubscribe header parsing — From address/name, List-Unsubscribe URIs, RFC 8058 one-click only when Gmail's Authentication-Results dkim=pass signer equals or parents the From domain and its DKIM-Signature h= covers both headers (else unverified), link_only/mailto/none, URLs over 2048 ignored, never throws; isAdMail from metadata (promotion label, (광고) in subject or sender) (spec §7)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task U2: 안전 POST (`_shared/safe-post.ts`)

**Files:**
- Create: `supabase/functions/_shared/safe-post.ts`
- Test: `supabase/tests/safe-post.test.ts`

**Interfaces:**
- Produces:
  - `type Resolver = (host: string) => Promise<string[]>`
  - `type PostCode = "ok" | "ok_redirect" | "blocked_scheme" | "blocked_host" | "blocked_private" | "dns_error" | "timeout" | "network" | "bad_redirect" | "too_many_redirects" | \`http_${number}\``
  - `ipBlocked(ip: string): boolean` (파싱 불가 = true)
  - `checkUrl(raw: string): URL | "blocked_scheme" | "blocked_host"`
  - `defaultResolver: Resolver` (`Deno.resolveDns` → 없으면 DoH)
  - `oneClickPost(url: string, o?: { fetch?: typeof fetch; resolve?: Resolver; timeoutMs?: number; maxRedirects?: number }): Promise<{ ok: boolean; code: PostCode }>`

- [ ] **Step 1: 실패하는 테스트 작성**

`supabase/tests/safe-post.test.ts`:

```ts
import { assertEquals } from "jsr:@std/assert";
import { checkUrl, ipBlocked, oneClickPost, type Resolver } from "../functions/_shared/safe-post.ts";

Deno.test("ipBlocked table", () => {
  const blocked = ["0.0.0.0", "10.1.2.3", "100.64.0.1", "127.0.0.1", "169.254.169.254", "172.16.0.1", "172.31.255.255", "192.0.0.8",
    "192.0.2.1", "192.168.1.1", "198.18.0.1", "198.51.100.2", "203.0.113.9", "224.0.0.1", "255.255.255.255",
    "::", "::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "::127.0.0.1", "64:ff9b::a00:1", "2002:c0a8:101::1", "fc00::1", "fd12:3456::1",
    "fe80::1", "ff02::1", "2001:db8::1", "fe80::1%en0", "not-an-ip", "1.2.3", "1:2:3:4:5:6:7:8:9"];
  const open = ["8.8.8.8", "1.1.1.1", "172.32.0.1", "100.128.0.1", "2606:4700::1111", "2001:4860:4860::8888", "::ffff:8.8.8.8", "64:ff9b::808:808"];
  for (const ip of blocked) assertEquals([ip, ipBlocked(ip)], [ip, true]);
  for (const ip of open) assertEquals([ip, ipBlocked(ip)], [ip, false]);
});

Deno.test("checkUrl: https only, 443, no userinfo, no local names", () => {
  assertEquals(checkUrl("http://u.example.com/x"), "blocked_scheme");
  assertEquals(checkUrl("ftp://u.example.com/x"), "blocked_scheme");
  assertEquals(checkUrl("not a url"), "blocked_scheme");
  for (const u of ["https://u.example.com:8443/x", "https://a:b@u.example.com/x", "https://localhost/x", "https://box.local/x",
                   "https://svc.internal/x", "https://router.home.arpa/x", "https://intranet/x", "https://x.localhost/x"]) {
    assertEquals([u, checkUrl(u)], [u, "blocked_host"]);
  }
  assertEquals((checkUrl("https://u.example.com:443/x?t=1") as URL).hostname, "u.example.com");
  assertEquals((checkUrl("https://2130706433/") as URL).hostname, "127.0.0.1");   // 정수 표기도 WHATWG 파서가 정규화 → IP 검사 대상
});

type Call = { url: string; init: RequestInit };
function fakeFetch(responses: (Response | Error)[]) {
  const calls: Call[] = [];
  const f = ((url: string | URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    const r = responses.shift()!;
    return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
  }) as typeof fetch;
  return { f, calls };
}
const pub: Resolver = async () => ["93.184.216.34"];

Deno.test("POST shape: one-click body, form content type, manual redirect, no auth/cookie", async () => {
  const { f, calls } = fakeFetch([new Response(null, { status: 200 })]);
  assertEquals(await oneClickPost("https://u.example.com/one?t=abc", { fetch: f, resolve: pub }), { ok: true, code: "ok" });
  assertEquals(calls.length, 1);
  const i = calls[0].init;
  assertEquals([calls[0].url, i.method, i.body, i.redirect], ["https://u.example.com/one?t=abc", "POST", "List-Unsubscribe=One-Click", "manual"]);
  const h = new Headers(i.headers);
  assertEquals([h.get("content-type"), h.get("authorization"), h.get("cookie")], ["application/x-www-form-urlencoded", null, null]);
});

Deno.test("2xx ok, 301/302/303 accepted without following, 4xx/5xx http_<n>", async () => {
  for (const [s, code] of [[202, "ok"], [204, "ok"], [302, "ok_redirect"], [303, "ok_redirect"], [404, "http_404"], [500, "http_500"]] as const) {
    const { f, calls } = fakeFetch([new Response(null, { status: s, headers: s >= 300 && s < 400 ? { location: "https://u.example.com/done" } : {} })]);
    assertEquals(await oneClickPost("https://u.example.com/x", { fetch: f, resolve: pub }), { ok: code.startsWith("ok"), code });
    assertEquals(calls.length, 1);
  }
});

Deno.test("307/308 re-POST up to 2 hops; third redirect → too_many_redirects", async () => {
  const r307 = (loc: string) => new Response(null, { status: 307, headers: { location: loc } });
  {
    const { f, calls } = fakeFetch([r307("/second"), new Response(null, { status: 308, headers: { location: "https://v.example.net/third" } }), new Response(null, { status: 200 })]);
    assertEquals(await oneClickPost("https://u.example.com/first", { fetch: f, resolve: pub }), { ok: true, code: "ok" });
    assertEquals(calls.map((c) => c.url), ["https://u.example.com/first", "https://u.example.com/second", "https://v.example.net/third"]);
  }
  {
    const { f } = fakeFetch([r307("/a"), r307("/b"), r307("/c")]);
    assertEquals(await oneClickPost("https://u.example.com/x", { fetch: f, resolve: pub }), { ok: false, code: "too_many_redirects" });
  }
  {
    const { f } = fakeFetch([new Response(null, { status: 307 })]);
    assertEquals(await oneClickPost("https://u.example.com/x", { fetch: f, resolve: pub }), { ok: false, code: "bad_redirect" });
  }
});

Deno.test("307 to a private address is blocked on the second hop (no request sent there)", async () => {
  const resolve: Resolver = async (h) => (h === "inside.example.com" ? ["10.0.0.5"] : ["93.184.216.34"]);
  const { f, calls } = fakeFetch([new Response(null, { status: 307, headers: { location: "https://inside.example.com/x" } })]);
  assertEquals(await oneClickPost("https://u.example.com/x", { fetch: f, resolve }), { ok: false, code: "blocked_private" });
  assertEquals(calls.length, 1);
  const { f: f2, calls: c2 } = fakeFetch([new Response(null, { status: 307, headers: { location: "http://u.example.com/x" } })]);
  assertEquals(await oneClickPost("https://u.example.com/x", { fetch: f2, resolve }), { ok: false, code: "blocked_scheme" });
  assertEquals(c2.length, 1);
});

Deno.test("DNS: any private answer blocks, empty or failing → dns_error, IP literal skips DNS", async () => {
  const { f, calls } = fakeFetch([]);
  assertEquals(await oneClickPost("https://u.example.com/x", { fetch: f, resolve: async () => ["93.184.216.34", "127.0.0.1"] }), { ok: false, code: "blocked_private" });
  assertEquals(await oneClickPost("https://u.example.com/x", { fetch: f, resolve: async () => [] }), { ok: false, code: "dns_error" });
  assertEquals(await oneClickPost("https://u.example.com/x", { fetch: f, resolve: () => Promise.reject(new Error("x")) }), { ok: false, code: "dns_error" });
  let asked = false;
  assertEquals(await oneClickPost("https://10.0.0.1/x", { fetch: f, resolve: async () => { asked = true; return ["93.184.216.34"]; } }), { ok: false, code: "blocked_private" });
  assertEquals(await oneClickPost("https://[::1]/x", { fetch: f, resolve: pub }), { ok: false, code: "blocked_private" });
  assertEquals([asked, calls.length], [false, 0]);
});

Deno.test("timeout and network errors", async () => {
  const hang = ((_u: string | URL, init: RequestInit = {}) =>
    new Promise((_, rej) => init.signal!.addEventListener("abort", () => rej(init.signal!.reason)))) as typeof fetch;
  assertEquals(await oneClickPost("https://u.example.com/x", { fetch: hang, resolve: pub, timeoutMs: 50 }), { ok: false, code: "timeout" });
  const { f } = fakeFetch([new TypeError("connection refused")]);
  assertEquals(await oneClickPost("https://u.example.com/x", { fetch: f, resolve: pub }), { ok: false, code: "network" });
});
```

- [ ] **Step 2: 실패 확인**

Run: `deno test --allow-net --allow-env --allow-read supabase/tests/safe-post.test.ts`
Expected: FAIL — `Module not found "…/_shared/safe-post.ts"`.

- [ ] **Step 3: 구현**

`supabase/functions/_shared/safe-post.ts`:

```ts
// 광고 구독 해지 POST(스펙 §7 "광고 구독 해지", RFC 8058). 외부 URL 로 가는 유일한 서버 요청이라 SSRF 를 막는다:
// https·443·userinfo 없음·로컬 이름 금지 → DNS(A·AAAA) 전부 공인 주소 → 고정 본문 POST(쿠키·인증 없음, 전체 10초)
// → 301/302/303 은 접수(따라가지 않음), 307/308 만 최대 2회 다시 검사. 응답 본문은 읽지 않는다.
// 남은 위험: DNS 재바인딩(검사와 연결 사이 주소 변경) — 응답을 돌려주지 않는 고정 본문 POST 라 영향이 작다
export type Resolver = (host: string) => Promise<string[]>;
export type PostCode =
  | "ok" | "ok_redirect" | "blocked_scheme" | "blocked_host" | "blocked_private" | "dns_error" | "timeout" | "network"
  | "bad_redirect" | "too_many_redirects" | `http_${number}`;

const BODY = "List-Unsubscribe=One-Click";

function v4(ip: string): number[] | null {
  const p = ip.split(".");
  if (p.length !== 4) return null;
  const n = p.map((x) => (/^\d{1,3}$/.test(x) ? Number(x) : NaN));
  return n.every((x) => x >= 0 && x <= 255) ? n : null;
}
function v4Blocked([a, b, c]: number[]): boolean {
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 192 && b === 0 && (c === 0 || c === 2)) || (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113);
}
function v6(ip: string): number[] | null {
  let s = ip.toLowerCase();
  const pct = s.indexOf("%");
  if (pct >= 0) s = s.slice(0, pct);
  let tail: number[] = [];
  const m = s.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (m) {
    const q = v4(m[2]);
    if (!q) return null;
    tail = [(q[0] << 8) | q[1], (q[2] << 8) | q[3]];
    s = m[1].endsWith("::") ? m[1] : m[1].slice(0, -1);
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const parse = (h: string) => (h === "" ? [] : h.split(":").map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN)));
  const head = parse(halves[0]), back = halves.length === 2 ? parse(halves[1]) : [];
  let groups: number[];
  if (halves.length === 2) {
    const fill = 8 - head.length - back.length - tail.length;
    if (fill < 1) return null;
    groups = [...head, ...new Array(fill).fill(0), ...back, ...tail];
  } else groups = [...head, ...tail];
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}
const embedded = (hi: number, lo: number) => v4Blocked([hi >> 8, hi & 255, lo >> 8]);
function v6Blocked(g: number[]): boolean {
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0 || g[5] === 0xffff)) {
    if (g[5] === 0 && g[6] === 0 && g[7] <= 1) return true;            // :: · ::1
    return embedded(g[6], g[7]);                                          // ::a.b.c.d · ::ffff:a.b.c.d
  }
  if (g[0] === 0x64 && g[1] === 0xff9b) return embedded(g[6], g[7]);    // NAT64
  if (g[0] === 0x2002) return embedded(g[1], g[2]);                     // 6to4
  return (g[0] & 0xfe00) === 0xfc00 || (g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xff00) === 0xff00 ||
    (g[0] === 0x2001 && g[1] === 0x0db8) || (g[0] === 0x0100 && g[1] === 0 && g[2] === 0 && g[3] === 0);
}
export function ipBlocked(ip: string): boolean {
  const a = v4(ip);
  if (a) return v4Blocked(a);
  if (!ip.includes(":")) return true;
  const b = v6(ip);
  return b ? v6Blocked(b) : true;                                         // 파싱 불가는 막는다
}
const isIpLiteral = (h: string) => v4(h) !== null || h.includes(":");

export function checkUrl(raw: string): URL | "blocked_scheme" | "blocked_host" {
  let u: URL;
  try { u = new URL(raw); } catch { return "blocked_scheme"; }
  if (u.protocol !== "https:") return "blocked_scheme";
  if (u.username || u.password || (u.port && u.port !== "443")) return "blocked_host";
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!h.includes(".") && !h.includes(":")) return "blocked_host";
  if (/(^|\.)(localhost|local|internal|localdomain|home\.arpa)$/.test(h)) return "blocked_host";
  return u;
}

async function doh(host: string): Promise<string[]> {
  const out: string[] = [];
  for (const [type, code] of [["A", 1], ["AAAA", 28]] as const) {
    const r = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(host)}&type=${type}`, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) { await r.body?.cancel(); throw new Error("doh " + r.status); }
    const j = await r.json() as { Answer?: { type: number; data: string }[] };
    for (const a of j.Answer ?? []) if (a.type === code) out.push(a.data);
  }
  return out;
}
type DenoDns = { resolveDns?: (q: string, t: "A" | "AAAA") => Promise<string[]> };
export const defaultResolver: Resolver = async (host) => {
  const rd = (Deno as unknown as DenoDns).resolveDns;
  if (typeof rd !== "function") return await doh(host);
  const [a, aaaa] = await Promise.all([rd(host, "A").catch(() => [] as string[]), rd(host, "AAAA").catch(() => [] as string[])]);
  return [...a, ...aaaa];
};
export const resolverKind = () => (typeof (Deno as unknown as DenoDns).resolveDns === "function" ? "deno" : "doh");

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error("dns_timeout")), ms);
    p.then((v) => { clearTimeout(t); res(v); }, (e) => { clearTimeout(t); rej(e); });
  });
}

export async function oneClickPost(url: string, o: { fetch?: typeof fetch; resolve?: Resolver; timeoutMs?: number; maxRedirects?: number } = {}):
  Promise<{ ok: boolean; code: PostCode }> {
  // 전체 예산(모든 hop 합). AbortSignal.timeout 대신 직접 타이머 — 일찍 끝나면 지워서 deno test 의 타이머 누수 검사에 걸리지 않게
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(new DOMException("timeout", "TimeoutError")), o.timeoutMs ?? 10_000);
  try { return await post(url, o, ctl.signal); } finally { clearTimeout(timer); }
}

async function post(url: string, o: { fetch?: typeof fetch; resolve?: Resolver; maxRedirects?: number }, signal: AbortSignal):
  Promise<{ ok: boolean; code: PostCode }> {
  const f = o.fetch ?? fetch, resolve = o.resolve ?? defaultResolver, max = o.maxRedirects ?? 2;
  const done = (code: PostCode) => ({ ok: code === "ok" || code === "ok_redirect", code });
  let target = url;
  for (let hop = 0; hop <= max; hop++) {
    const u = checkUrl(target);
    if (typeof u === "string") return done(u);
    const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    let ips: string[];
    if (isIpLiteral(host)) ips = [host];
    else {
      try { ips = await withTimeout(resolve(host), 3000); } catch { return done("dns_error"); }
    }
    if (ips.length === 0) return done("dns_error");
    if (ips.some(ipBlocked)) return done("blocked_private");
    let r: Response;
    try {
      r = await f(u.toString(), { method: "POST", redirect: "manual", body: BODY, signal,
        headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "ERURI-Unsubscribe/1" } });
    } catch (e) {
      return done(signal.aborted || (e as Error)?.name === "TimeoutError" ? "timeout" : "network");
    }
    await r.body?.cancel().catch(() => {});
    if (r.status >= 200 && r.status < 300) return done("ok");
    if (r.status === 301 || r.status === 302 || r.status === 303) return done("ok_redirect");
    if (r.status === 307 || r.status === 308) {
      const loc = r.headers.get("location");
      if (!loc) return done("bad_redirect");
      try { target = new URL(loc, u).toString(); } catch { return done("bad_redirect"); }
      continue;
    }
    return done(`http_${r.status}`);
  }
  return done("too_many_redirects");
}
```

- [ ] **Step 4: 통과 확인**

Run: `deno test --allow-net --allow-env --allow-read supabase/tests/safe-post.test.ts`
Expected: PASS(8개). `ipBlocked table`이 실패하면 표의 그 주소가 위 규칙과 어긋나는지 먼저 확인한다 — 규칙을 넓히는 쪽(막는 쪽)으로만 고친다.

- [ ] **Step 5: 커밋**

```bash
git add supabase/functions/_shared/safe-post.ts supabase/tests/safe-post.test.ts
git commit -m "feat(server): SSRF-safe one-click POST — https/443/no userinfo/no local names, every A/AAAA answer public (private, loopback, link-local, CGNAT, multicast, reserved, doc ranges, v4-mapped/NAT64/6to4 embedded), fixed form body without cookies or auth, 10s total, 301/302/303 accepted unfollowed, 307/308 re-checked up to 2 hops, body never read; resolver Deno.resolveDns else DNS-over-HTTPS (spec §7)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task U3: 마이그레이션 `0028_unsubscribe.sql` + DB 테스트 + `db push`

**Files:**
- Create: `supabase/migrations/0028_unsubscribe.sql` (실행 때 다음 빈 번호 — `ls supabase/migrations | tail -1` 다음 번호. 바뀌면 이 계획의 파일명·`git add` 경로도 실제 번호로)
- Test: `supabase/tests/unsub-db.test.ts`

**Interfaces:**
- Consumes: `connections`, `items`, `jobs`, `audit_log`(기존).
- Produces (service role 전용, `anon`·`authenticated` 실행 회수):
  - `worker_record_unsub(p_user uuid, p_connection uuid, p_address text, p_name text, p_method text, p_url_enc bytea, p_msg_key text, p_occurred_at timestamptz, p_item uuid default null) → uuid`(sender id, 연결 없으면 null)
  - `unsub_scan_targets(p_user uuid, p_since timestamptz) → table(gmail_id text, item_id uuid)`
  - `gmail_enqueue_unsub_scan(p_user uuid, p_lease_prefix text default '') → int`
  - `unsub_begin(p_user uuid, p_sender uuid) → jsonb` `{result: ok|not_found|unsupported|busy|already|limit, url_enc?: "\\x…"}`
  - `unsub_finish(p_user uuid, p_sender uuid, p_code text) → void`
  - `purge_unsub(p_user uuid default null) → jsonb {mail, senders}`
  - 내부: `unsub_ad_mail(p_user uuid) → table(sender_id uuid, occurred_at timestamptz)`
- Produces (authenticated): `unsub_list() → table(sender_id uuid, display_name text, address text, method text, status text, status_at timestamptz, requested_at timestamptz, result_code text, ads_30d int, ads_after_request int, last_ad_at timestamptz)` — U7 `Unsubscribe.Row`가 이 열 이름을 그대로 디코드한다.
- cron `unsub-purge-daily` `43 4 * * *`.

- [ ] **Step 1: 실패하는 DB 테스트 작성**

`supabase/tests/unsub-db.test.ts`:

```ts
import { assert, assertEquals } from "jsr:@std/assert";
import { createClient } from "npm:@supabase/supabase-js@2";
import { encrypt, SERVER_AUTH, toBytea } from "../functions/_shared/crypto.ts";
import { deleteRunJobs, RUN, service as sb, userClient } from "./_testenv.ts";

// 호스팅 DB. 전용 테스트 사용자·실행 태그만(AGENTS.md §7). 연결은 disconnected 로 만들어 cron 이 고르지 않게 하고, 끝나면 그 행만 지운다(cascade)
const day = 86_400_000;
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

async function setup(n = 1) {
  const { u, c } = await userClient(n);
  const { data, error } = await sb.from("connections").insert({ user_id: u.id, provider: "gmail", account_ref: `${RUN}-${n}@example.com`, status: "disconnected" })
    .select("id").single();
  assertEquals(error, null);
  return { u, c, conn: data!.id as string };
}
async function cleanup(user: string, conn: string) {
  await deleteRunJobs();
  await sb.from("items").delete().eq("user_id", user).like("idempotency_key", `${RUN}%`);
  await sb.from("items").delete().eq("user_id", user).like("idempotency_key", `gmail:${RUN}%`);   // 스캔 대상 테스트가 운영 키 형식으로 바꾼 항목
  await sb.from("connections").delete().eq("user_id", user).eq("id", conn);            // unsub_* cascade
  await sb.from("audit_log").delete().eq("user_id", user).eq("actor", "unsubscribe");
}
async function rec(user: string, conn: string, o: { addr: string; key: string; at: string; method?: string; url?: string | null; item?: string | null; name?: string | null; raw?: boolean }) {
  const { data, error } = await sb.rpc("worker_record_unsub", { p_user: user, p_connection: conn, p_address: o.addr, p_name: o.name ?? "합성 발신자",
    p_method: o.method ?? "one_click", p_url_enc: o.url === null ? null : toBytea(await encrypt(user, o.url ?? "https://u.example.com/one")),
    p_msg_key: o.raw ? o.key : `${RUN}:${o.key}`, p_occurred_at: o.at, p_item: o.item ?? null });
  assertEquals(error, null);
  return data as string;
}
async function item(user: string, tag: string, status: "promo" | "queued"): Promise<string> {
  const { data: id, error } = await sb.rpc("insert_item", { p_user: user, p_source: "GMAIL", p_idempotency_key: `${RUN}:gmail:${tag}`, p_sender: "합성 발신자",
    p_title: "합성", p_content_enc: toBytea(await encrypt(user, "합성 광고 본문")), p_occurred_at: iso(day), p_enqueue: false });
  assertEquals(error, null);
  if (status === "promo") {
    assertEquals((await sb.rpc("worker_record_gate", { p_user: user, p_item: id, p_label: "promo", p_confidence: 0.95 })).error, null);
    assertEquals((await sb.rpc("worker_quarantine_item", { p_user: user, p_item: id, p_status: "discarded:server:promo" })).error, null);
  }
  return id as string;
}

Deno.test("unsub_list counts rule ads and gate-promo items only; 30-day window; url never returned; newsletter-only sender hidden", async () => {
  const { u, c, conn } = await setup();
  try {
    const promo = await item(u.id, "p1", "promo"), passed = await item(u.id, "q1", "queued");
    const a = await rec(u.id, conn, { addr: "ads@example.com", key: "a1", at: iso(day) });
    await rec(u.id, conn, { addr: "ads@example.com", key: "a2", at: iso(2 * day) });
    await rec(u.id, conn, { addr: "ads@example.com", key: "a3", at: iso(40 * day) });                // 30일 밖
    await rec(u.id, conn, { addr: "ads@example.com", key: "a4", at: iso(day), item: promo });       // 게이트 promo → 센다
    await rec(u.id, conn, { addr: "ads@example.com", key: "a5", at: iso(day), item: passed });      // 통과(거래) 메일 → 세지 않는다
    await rec(u.id, conn, { addr: "news@example.net", key: "n1", at: iso(day), item: passed, method: "link_only", url: null });
    const { data, error } = await c.rpc("unsub_list");
    assertEquals(error, null);
    assertEquals(data.map((r: { address: string; ads_30d: number }) => [r.address, r.ads_30d]), [["ads@example.com", 3]]);
    assertEquals(data[0].sender_id, a);
    assert(!("url_enc" in data[0]));
    assertEquals((await c.from("unsub_senders").select("id")).data, []);                         // 표 직접 읽기 불가(정책 없음)
  } finally {
    await cleanup(u.id, conn);
  }
});

Deno.test("same message twice counts once; later mail updates method/url, older mail does not", async () => {
  const { u, c, conn } = await setup();
  try {
    const promo = await item(u.id, "p2", "promo");
    await rec(u.id, conn, { addr: "dup@example.com", key: "d1", at: iso(day) });
    await rec(u.id, conn, { addr: "dup@example.com", key: "d1", at: iso(day), item: promo });       // 스캔이 다시 읽음 → item 만 보충
    const { data: m } = await sb.from("unsub_mail").select("item_id").eq("user_id", u.id).eq("msg_key", `${RUN}:d1`);
    assertEquals(m, [{ item_id: promo }]);
    await rec(u.id, conn, { addr: "dup@example.com", key: "d2", at: iso(10 * day), method: "mailto", url: null });   // 더 오래된 메일
    let { data: s } = await sb.from("unsub_senders").select("method, url_enc").eq("user_id", u.id).eq("address", "dup@example.com").single();
    assertEquals([s!.method, s!.url_enc !== null], ["one_click", true]);
    await rec(u.id, conn, { addr: "DUP@example.com", key: "d3", at: iso(1000), method: "mailto", url: null });       // 더 최근, 대문자 주소
    ({ data: s } = await sb.from("unsub_senders").select("method, url_enc").eq("user_id", u.id).eq("address", "dup@example.com").single());
    assertEquals([s!.method, s!.url_enc], ["mailto", null]);
    const { data: list } = await c.rpc("unsub_list");
    assertEquals(list.map((r: { ads_30d: number }) => r.ads_30d), [3]);
  } finally {
    await cleanup(u.id, conn);
  }
});

Deno.test("begin/finish: unsupported, ok + decrypt audit, busy within 60s, stale requesting restarts, requested → already, failure code, other user not_found, limit", async () => {
  const { u, conn } = await setup(1);
  const { u: u2 } = await userClient(2);
  try {
    const mail = await rec(u.id, conn, { addr: "m@example.com", key: "m1", at: iso(day), method: "mailto", url: null });
    assertEquals((await sb.rpc("unsub_begin", { p_user: u.id, p_sender: mail })).data, { result: "unsupported" });
    const s = await rec(u.id, conn, { addr: "o@example.com", key: "o1", at: iso(day) });
    assertEquals((await sb.rpc("unsub_begin", { p_user: u2.id, p_sender: s })).data, { result: "not_found" });
    const b1 = (await sb.rpc("unsub_begin", { p_user: u.id, p_sender: s })).data;
    assertEquals(b1.result, "ok");
    assert(String(b1.url_enc).startsWith("\\x"));
    assertEquals((await sb.rpc("unsub_begin", { p_user: u.id, p_sender: s })).data, { result: "busy" });
    await sb.from("unsub_senders").update({ status_at: iso(120_000) }).eq("id", s);                  // 2분 전 시작한 채 끝남
    assertEquals((await sb.rpc("unsub_begin", { p_user: u.id, p_sender: s })).data.result, "ok");
    assertEquals((await sb.rpc("unsub_finish", { p_user: u.id, p_sender: s, p_code: "ok" })).error, null);
    const { data: row } = await sb.from("unsub_senders").select("status, result_code, attempts, requested_at").eq("id", s).single();
    assertEquals([row!.status, row!.result_code, row!.attempts, row!.requested_at !== null], ["requested", "ok", 2, true]);
    assertEquals((await sb.rpc("unsub_begin", { p_user: u.id, p_sender: s })).data, { result: "already" });
    const { data: audit } = await sb.from("audit_log").select("action, target").eq("user_id", u.id).eq("actor", "unsubscribe").order("id");
    assertEquals(audit!.map((a) => a.action), ["decrypt", "decrypt", "unsubscribe"]);
    assertEquals(audit![2].target, `unsub:${s} ok`);
    // 실패 코드
    const f = await rec(u.id, conn, { addr: "f@example.com", key: "f1", at: iso(day) });
    await sb.rpc("unsub_begin", { p_user: u.id, p_sender: f });
    await sb.rpc("unsub_finish", { p_user: u.id, p_sender: f, p_code: "blocked_private" });
    const { data: fr } = await sb.from("unsub_senders").select("status, result_code, requested_at").eq("id", f).single();
    assertEquals([fr!.status, fr!.result_code, fr!.requested_at], ["failed", "blocked_private", null]);
    // 한도 5회
    await sb.from("unsub_senders").update({ attempts: 5, status: "failed" }).eq("id", f);
    assertEquals((await sb.rpc("unsub_begin", { p_user: u.id, p_sender: f })).data, { result: "limit" });
  } finally {
    await cleanup(u.id, conn);
  }
});

Deno.test("requested sender: ads after the 3-day grace reopen the request; ads inside the grace do not", async () => {
  const { u, c, conn } = await setup();
  try {
    const s = await rec(u.id, conn, { addr: "g@example.com", key: "g1", at: iso(6 * day) });
    await sb.from("unsub_senders").update({ status: "requested", status_at: iso(5 * day), requested_at: iso(5 * day), result_code: "ok" }).eq("id", s);
    await rec(u.id, conn, { addr: "g@example.com", key: "g2", at: iso(4 * day) });                  // 유예 안
    let { data } = await c.rpc("unsub_list");
    assertEquals(data.map((r: { ads_after_request: number }) => r.ads_after_request), [0]);
    assertEquals((await sb.rpc("unsub_begin", { p_user: u.id, p_sender: s })).data, { result: "already" });
    await rec(u.id, conn, { addr: "g@example.com", key: "g3", at: iso(day) });                      // 유예 뒤
    ({ data } = await c.rpc("unsub_list"));
    assertEquals(data.map((r: { ads_after_request: number; status: string }) => [r.status, r.ads_after_request]), [["requested", 1]]);
    assertEquals((await sb.rpc("unsub_begin", { p_user: u.id, p_sender: s })).data.result, "ok");
  } finally {
    await cleanup(u.id, conn);
  }
});

Deno.test("scan targets, scan enqueue (test prefix, backfill lane, once), purge by user, connection delete cascades, anon/authenticated cannot call worker RPCs", async () => {
  const { u, c, conn } = await setup();
  try {
    const promo = await item(u.id, "p3", "promo");
    await rec(u.id, conn, { addr: "t@example.com", key: "t1", at: iso(day) });
    const targets = async () => (await sb.rpc("unsub_scan_targets", { p_user: u.id, p_since: iso(30 * day) })).data;
    assertEquals(await targets(), []);                    // 테스트 키 'test:<run>:gmail:p3' 는 'gmail:%' 가 아니다 — 운영 키 형식만 고른다
    await sb.from("items").update({ idempotency_key: `gmail:${RUN}-p3` }).eq("id", promo);
    assertEquals(await targets(), [{ gmail_id: `${RUN}-p3`, item_id: promo }]);
    await rec(u.id, conn, { addr: "t@example.com", key: `gmail:${RUN}-p3`, raw: true, at: iso(day), item: promo });
    assertEquals(await targets(), []);                    // 이미 기록된 메일은 다시 읽지 않는다
    assertEquals((await sb.rpc("gmail_enqueue_unsub_scan", { p_user: u.id, p_lease_prefix: RUN + ":" })).data, 1);
    assertEquals((await sb.rpc("gmail_enqueue_unsub_scan", { p_user: u.id, p_lease_prefix: RUN + ":" })).data, 0);   // 이미 대기 중
    const { data: jobs } = await sb.from("jobs").select("kind, lease_key, priority, payload").eq("user_id", u.id).eq("kind", "gmail-unsub-scan");
    assertEquals(jobs!.map((j) => [j.lease_key, j.priority, j.payload.backfill, j.payload.lease_key]),
      [[`${RUN}:gmail:${conn}`, 40, true, `${RUN}:gmail:${conn}`]]);
    assert((await sb.rpc("gmail_enqueue_unsub_scan", { p_user: u.id, p_lease_prefix: "evil:" })).error !== null);
    // purge: 35일 지난 메일 행만, 이 사용자만
    await rec(u.id, conn, { addr: "old@example.com", key: "old", at: iso(40 * day) });
    await sb.from("unsub_senders").update({ last_seen_at: iso(40 * day) }).eq("user_id", u.id).eq("address", "old@example.com");
    const { data: p } = await sb.rpc("purge_unsub", { p_user: u.id });
    assertEquals([p.mail >= 1, p.senders >= 1], [true, true]);
    assertEquals((await sb.from("unsub_senders").select("id").eq("user_id", u.id).eq("address", "old@example.com")).data, []);
    assertEquals((await sb.from("unsub_senders").select("id").eq("user_id", u.id).eq("address", "t@example.com")).data!.length, 1);
    // 권한
    const anon = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, SERVER_AUTH);
    for (const [fn, args] of [["worker_record_unsub", {}], ["unsub_begin", { p_user: u.id, p_sender: conn }], ["purge_unsub", {}], ["gmail_enqueue_unsub_scan", { p_user: u.id }]] as const) {
      assert((await c.rpc(fn, args)).error !== null, fn);
      assert((await anon.rpc(fn, args)).error !== null, fn);
    }
    assert((await anon.rpc("unsub_list")).error !== null);                                       // anon 실행 회수
    // 연결 삭제(출처 삭제 경로) → unsub_* cascade
    await deleteRunJobs();
    await sb.from("connections").delete().eq("id", conn);
    assertEquals((await sb.from("unsub_senders").select("id").eq("user_id", u.id).eq("connection_id", conn)).data, []);
    assertEquals((await sb.from("unsub_mail").select("msg_key").eq("user_id", u.id).like("msg_key", `${RUN}%`)).data, []);
  } finally {
    await cleanup(u.id, conn);
  }
});
```

- [ ] **Step 2: 마이그레이션 작성**

`supabase/migrations/0028_unsubscribe.sql`:

```sql
-- 광고 구독 해지 제안(스펙 §7 "광고 구독 해지", §8 unsub_senders·unsub_mail, §12). 새 표·함수·cron 만 — 기존 표·함수·행을 바꾸지 않는다
-- (Gmail 측정 기간에도 창 밖에서 push 가능, 계획 2026-10-01-gmail-unsubscribe.md Global Constraints)
create table unsub_senders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  connection_id uuid not null references connections(id) on delete cascade,   -- 출처 삭제(delete_gmail_source 가 연결 행 삭제) → cascade
  address text not null,                     -- From 주소(소문자). items.sender 와 같은 등급의 평문(§12 통제 1)
  display_name text,                         -- ≤60자
  method text not null check (method in ('one_click', 'unverified', 'link_only', 'mailto', 'none')),
  url_enc bytea,                             -- one_click 해지 URL, 사용자 키 AES-256-GCM
  last_seen_at timestamptz not null,
  status text not null default 'active' check (status in ('active', 'requesting', 'requested', 'failed')),
  status_at timestamptz,
  requested_at timestamptz,
  result_code text,
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  unique (connection_id, address),
  check (method = 'one_click' or url_enc is null)
);
create table unsub_mail (
  user_id uuid not null references auth.users(id) on delete cascade,
  sender_id uuid not null references unsub_senders(id) on delete cascade,
  msg_key text not null,                     -- 'gmail:<id>'
  occurred_at timestamptz not null,
  item_id uuid references items(id) on delete cascade,   -- null = 규칙 광고. 있으면 그 항목이 게이트 promo 폐기일 때만 센다
  primary key (user_id, msg_key)
);
create index unsub_mail_sender_time on unsub_mail (sender_id, occurred_at);
create index unsub_mail_item on unsub_mail (item_id) where item_id is not null;
alter table unsub_senders enable row level security;
alter table unsub_mail enable row level security;
-- 정책 없음: 앱은 표를 직접 읽지 않고 unsub_list() 만 부른다(url_enc 를 클라이언트로 보내지 않는다)

-- gmail-fetch·스캔이 부른다. 연결이 이미 없으면 기록하지 않는다(null). 더 최근 메일만 방법·URL·이름을 덮는다
create or replace function worker_record_unsub(p_user uuid, p_connection uuid, p_address text, p_name text, p_method text,
  p_url_enc bytea, p_msg_key text, p_occurred_at timestamptz, p_item uuid default null) returns uuid language plpgsql as $$
declare v_id uuid;
begin
  if not exists (select 1 from connections where id = p_connection and user_id = p_user) then return null; end if;
  insert into unsub_senders as s (user_id, connection_id, address, display_name, method, url_enc, last_seen_at)
  values (p_user, p_connection, lower(p_address), left(p_name, 60), p_method,
          case when p_method = 'one_click' then p_url_enc end, p_occurred_at)
  on conflict (connection_id, address) do update set
    display_name = case when excluded.last_seen_at >= s.last_seen_at then coalesce(excluded.display_name, s.display_name) else s.display_name end,
    method       = case when excluded.last_seen_at >= s.last_seen_at then excluded.method else s.method end,
    url_enc      = case when excluded.last_seen_at >= s.last_seen_at then excluded.url_enc else s.url_enc end,
    last_seen_at = greatest(s.last_seen_at, excluded.last_seen_at)
  returning id into v_id;
  insert into unsub_mail (user_id, sender_id, msg_key, occurred_at, item_id)
  values (p_user, v_id, p_msg_key, p_occurred_at, p_item)
  on conflict (user_id, msg_key) do update set item_id = coalesce(unsub_mail.item_id, excluded.item_id);
  return v_id;
end $$;

-- 광고로 세는 메일: 규칙 광고(item 없음) 또는 게이트 promo 폐기 항목. 복구되면(status 변경) 빠진다
create or replace function unsub_ad_mail(p_user uuid) returns table (sender_id uuid, occurred_at timestamptz) language sql stable as $$
  select m.sender_id, m.occurred_at from unsub_mail m left join items i on i.id = m.item_id
  where m.user_id = p_user and (m.item_id is null or i.status = 'discarded:server:promo');
$$;

-- 30일 스캔이 헤더를 다시 읽을 게이트 promo 항목(아직 기록 없는 것). 운영 키 형식 'gmail:<id>' 만
create or replace function unsub_scan_targets(p_user uuid, p_since timestamptz) returns table (gmail_id text, item_id uuid) language sql stable as $$
  select substr(i.idempotency_key, 7), i.id from items i
  where i.user_id = p_user and i.source = 'GMAIL' and i.status = 'discarded:server:promo'
    and i.occurred_at >= p_since and i.idempotency_key like 'gmail:%'
    and not exists (select 1 from unsub_mail m where m.user_id = p_user and m.msg_key = i.idempotency_key);
$$;

-- 운영자가 ③c2 뒤 한 번 부른다. 테스트는 p_lease_prefix 'test:<run>:'(운영 워커 제외, 0003)·비활성 연결 허용
create or replace function gmail_enqueue_unsub_scan(p_user uuid, p_lease_prefix text default '') returns int language plpgsql as $$
declare n int;
begin
  if p_lease_prefix <> '' and p_lease_prefix not like 'test:%' then raise exception 'bad prefix'; end if;
  insert into jobs (kind, user_id, lease_key, payload)
  select 'gmail-unsub-scan', c.user_id, p_lease_prefix || 'gmail:' || c.id,
         jsonb_build_object('connection_id', c.id, 'backfill', true, 'lease_key', p_lease_prefix || 'gmail:' || c.id)
  from connections c
  where c.user_id = p_user and c.provider = 'gmail' and (c.status = 'active' or p_lease_prefix <> '')
    and not exists (select 1 from jobs j where j.user_id = p_user and j.kind = 'gmail-unsub-scan' and j.status in ('queued', 'running'));
  get diagnostics n = row_count;
  return n;
end $$;

-- Edge unsubscribe 가 부른다. 행 잠금으로 같은 발신자 동시 요청을 직렬화. 60초 안 재요청 busy, 60초 넘은 requesting 은 다시 시작
create or replace function unsub_begin(p_user uuid, p_sender uuid) returns jsonb language plpgsql as $$
declare s unsub_senders; v_after int;
begin
  select * into s from unsub_senders where id = p_sender and user_id = p_user for update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  if s.method <> 'one_click' or s.url_enc is null then return jsonb_build_object('result', 'unsupported'); end if;
  if s.status = 'requesting' and s.status_at > now() - interval '60 seconds' then return jsonb_build_object('result', 'busy'); end if;
  if s.status = 'requested' then
    select count(*) into v_after from unsub_ad_mail(p_user) a
    where a.sender_id = p_sender and a.occurred_at > s.requested_at + interval '3 days';
    if v_after = 0 then return jsonb_build_object('result', 'already'); end if;
  end if;
  if s.attempts >= 5 then return jsonb_build_object('result', 'limit'); end if;
  update unsub_senders set status = 'requesting', status_at = now(), attempts = attempts + 1 where id = p_sender;
  insert into audit_log (user_id, actor, action, target) values (p_user, 'unsubscribe', 'decrypt', 'unsub:' || p_sender);
  return jsonb_build_object('result', 'ok', 'url_enc', s.url_enc);
end $$;

create or replace function unsub_finish(p_user uuid, p_sender uuid, p_code text) returns void language plpgsql as $$
declare v_ok boolean := p_code in ('ok', 'ok_redirect');
begin
  update unsub_senders set status = case when v_ok then 'requested' else 'failed' end, status_at = now(),
    requested_at = case when v_ok then now() else requested_at end, result_code = left(p_code, 40)
  where id = p_sender and user_id = p_user and status = 'requesting';
  insert into audit_log (user_id, actor, action, target) values (p_user, 'unsubscribe', 'unsubscribe', 'unsub:' || p_sender || ' ' || left(p_code, 40));
end $$;

-- 앱 목록(authenticated). url_enc 는 내보내지 않는다
create or replace function unsub_list() returns table (sender_id uuid, display_name text, address text, method text, status text,
  status_at timestamptz, requested_at timestamptz, result_code text, ads_30d int, ads_after_request int, last_ad_at timestamptz)
language sql stable security definer set search_path = public as $$
  with ad as (select a.sender_id, a.occurred_at from unsub_ad_mail((select auth.uid())) a),
  agg as (
    select s.id, s.display_name, s.address, s.method, s.status, s.status_at, s.requested_at, s.result_code,
      (count(*) filter (where ad.occurred_at >= now() - interval '30 days'))::int as n30,
      (count(*) filter (where s.requested_at is not null and ad.occurred_at > s.requested_at + interval '3 days'))::int as n_after,
      max(ad.occurred_at) as last_at
    from unsub_senders s join ad on ad.sender_id = s.id
    where s.user_id = (select auth.uid())
    group by s.id)
  select agg.id, agg.display_name, agg.address, agg.method, agg.status, agg.status_at, agg.requested_at, agg.result_code,
         agg.n30, agg.n_after, agg.last_at
  from agg
  where agg.n30 > 0 or (agg.status in ('requested', 'failed') and agg.status_at >= now() - interval '30 days')
  order by agg.n30 desc, agg.last_at desc
  limit 100;
$$;

-- 35일 지난 메일 행, 메일 행 없고 마지막 수신 35일 지난 발신자(해지 요청 180일 이내 제외). p_user = 테스트 범위
create or replace function purge_unsub(p_user uuid default null) returns jsonb language plpgsql as $$
declare n_mail int; n_send int;
begin
  delete from unsub_mail where occurred_at < now() - interval '35 days' and (p_user is null or user_id = p_user);
  get diagnostics n_mail = row_count;
  delete from unsub_senders s where (p_user is null or s.user_id = p_user)
    and not exists (select 1 from unsub_mail m where m.sender_id = s.id)
    and s.last_seen_at < now() - interval '35 days'
    and (s.requested_at is null or s.requested_at < now() - interval '180 days');
  get diagnostics n_send = row_count;
  return jsonb_build_object('mail', n_mail, 'senders', n_send);
end $$;

revoke execute on function worker_record_unsub(uuid, uuid, text, text, text, bytea, text, timestamptz, uuid), unsub_ad_mail(uuid),
  unsub_scan_targets(uuid, timestamptz), gmail_enqueue_unsub_scan(uuid, text), unsub_begin(uuid, uuid), unsub_finish(uuid, uuid, text),
  purge_unsub(uuid) from public, anon, authenticated;
revoke execute on function unsub_list() from public, anon;
grant execute on function unsub_list() to authenticated;

select cron.schedule('unsub-purge-daily', '43 4 * * *', $$ select purge_unsub(); $$);
```

- [ ] **Step 3: 창 확인 후 `db push` + DB 테스트 (창 밖)**

메인이 Gmail 측정 창 밖임을 확인한 뒤에만:

Run: `git status --short supabase/migrations; ls supabase/migrations | tail -3; supabase db push --dry-run`
Expected: 새 파일은 `0028_unsubscribe.sql` 하나, dry-run 목록도 그 하나.

Run: `vm_stat | grep -E 'free|compressor'; supabase db push && deno test --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/tests/unsub-db.test.ts`
Expected: push 후 PASS(5개). 실패하면 테스트·SQL을 고치되 **적용된 0028은 고치지 않고** 새 마이그레이션(다음 번호)으로 `create or replace`한다.

- [ ] **Step 4: 회귀 DB 테스트**

Run: `deno test --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/tests/quarantine-db.test.ts supabase/tests/retention-db.test.ts supabase/tests/jobs-priority-db.test.ts supabase/tests/account.test.ts`
Expected: PASS(기존 그대로 — 새 표는 기존 함수 동작을 바꾸지 않는다).

- [ ] **Step 5: 커밋**

```bash
git add supabase/migrations/0028_unsubscribe.sql supabase/tests/unsub-db.test.ts
git commit -m "feat(server): 0028 unsubscribe tables and RPCs — unsub_senders (per connection+address, one_click url encrypted, status/attempts) and unsub_mail (one row per message key, item link counts only when the item is a gate promo discard), worker_record_unsub (newer mail wins), unsub_list for the app without url (30-day ads, ads after the 3-day grace), unsub_begin/finish (row lock, busy 60s, stale restart, already, limit 5, decrypt and result audit), scan targets/enqueue (backfill lane, test prefix), purge_unsub daily cron (35 days, requested senders kept 180 days) (spec §7·§8)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task U4: 워커 — fetch 기록·30일 스캔 잡

**Files:**
- Modify: `supabase/functions/_shared/gmail.ts` (`META_HEADERS`, `getMessageMeta`, `GmailClient`·`gmailApi`)
- Modify: `supabase/functions/_shared/gmail-jobs.ts` (`recordUnsub`, `gmailUnsubScan`, `gmailUnsubFetch`, `gmailFetch`의 두 분기)
- Modify: `supabase/functions/worker/index.ts` (핸들러 2개)
- Modify: `supabase/tests/gmail.test.ts` (`fakeDeps` 기본값에 `getMessageMeta` 한 줄)
- Test: `supabase/tests/unsub-jobs.test.ts`

**Interfaces:**
- Consumes: U1 `unsubMeta`·`hasListUnsub`·`isAdMail`, U3 RPC `worker_record_unsub`·`unsub_scan_targets`·`enqueue_job`(기존).
- Produces:
  - `getMessageMeta(accessToken, id): Promise<GmailMessage>`, `GmailClient.getMessageMeta(id)`
  - `recordUnsub(sb: RpcClient, deps: Pick<GmailJobDeps, "encrypt">, user: string, conn: string, msg: GmailMessage, itemId: string | null): Promise<"recorded" | "skipped" | "error">` — throw하지 않는다
  - 잡 `gmail-unsub-scan`(payload `{connection_id, backfill: true, lease_key}`) → `gmail-unsub-fetch`(payload `{connection_id, backfill: true, msgs: {id: string; item: string | null}[]}`, ≤50)
  - `UNSUB_SCAN_Q = "newer_than:30d {category:promotions subject:광고} -in:drafts"`

- [ ] **Step 1: 실패하는 테스트 작성**

`supabase/tests/unsub-jobs.test.ts`:

```ts
import { assertEquals } from "jsr:@std/assert";
import type { GmailClient, GmailMessage } from "../functions/_shared/gmail.ts";
import { GmailHttpError } from "../functions/_shared/gmail.ts";
import { gmailFetch, type GmailJobDeps, gmailUnsubFetch, gmailUnsubScan, recordUnsub, type RpcClient, UNSUB_SCAN_Q } from "../functions/_shared/gmail-jobs.ts";
import type { Job } from "../functions/_shared/job.ts";

const USER = "00000000-0000-0000-0000-0000000000aa", CONN = "00000000-0000-0000-0000-0000000000cc";
const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const SIG = "v=1; d=example.com; s=s1; h=From:List-Unsubscribe:List-Unsubscribe-Post; b=y";
const AR = "mx.google.com; dkim=pass header.i=@example.com header.s=s1";
const mk = (id: string, o: { labels?: string[]; subject?: string; lu?: boolean; body?: string } = {}): GmailMessage => ({
  id, internalDate: "1790000000000", labelIds: o.labels ?? ["INBOX"],
  payload: { mimeType: "text/plain", body: { data: b64(o.body ?? "합성 본문") }, headers: [
    { name: "From", value: "합성쇼핑 <news@example.com>" }, { name: "Subject", value: o.subject ?? "합성 안내" },
    ...(o.lu ? [{ name: "List-Unsubscribe", value: "<https://u.example.com/one?t=1>" }, { name: "List-Unsubscribe-Post", value: "List-Unsubscribe=One-Click" },
                { name: "Authentication-Results", value: AR }, { name: "DKIM-Signature", value: SIG }] : []),
  ] },
});
const job = (kind: string, payload: Record<string, unknown> = {}): Job => ({ id: "job-1", kind, user_id: USER, payload: { connection_id: CONN, ...payload }, attempts: 1, checkpoint: null });

function fakeRpc(results: Record<string, unknown> = {}, failing: string[] = []) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const rpc: RpcClient = { rpc: (fn, args = {}) => {
    calls.push({ fn, args });
    if (failing.includes(fn)) return Promise.resolve({ data: null, error: { code: "XX000" } });
    return Promise.resolve({ data: fn in results ? results[fn] : null, error: null });
  } };
  return { rpc, calls };
}
function fakeDeps(api: Partial<GmailClient> = {}): GmailJobDeps {
  return {
    refresh: async () => "access-1",
    api: () => ({
      history: async () => ({ notFound: true as const }), listMessageIds: async () => ({ messages: [] }),
      profile: async () => ({ emailAddress: "poc@example.com", historyId: "1" }),
      getMessage: async (id) => mk(id), getMessageMeta: async (id) => mk(id),
      watch: async () => ({ historyId: "1", expiration: "1" }), ...api,
    }),
    encrypt: async (_u, t) => new TextEncoder().encode("ENC(" + t + ")"),
    pause: async () => {}, topic: () => "t",
  };
}
const hex = (s: string) => "\\x" + Array.from(new TextEncoder().encode(s), (x) => x.toString(16).padStart(2, "0")).join("");
const ST = { gmail_get_refresh_token: "rt-1", gmail_state: [{ cursor: "1", last_success_at: "2026-09-20T00:00:00Z" }] };

Deno.test("recordUnsub: one_click url encrypted, msg key, item link; rpc error → 'error' without throwing", async () => {
  const { rpc, calls } = fakeRpc();
  assertEquals(await recordUnsub(rpc, fakeDeps(), USER, CONN, mk("m1", { lu: true }), "item-9"), "recorded");
  assertEquals(calls[0].fn, "worker_record_unsub");
  assertEquals(calls[0].args, { p_user: USER, p_connection: CONN, p_address: "news@example.com", p_name: "합성쇼핑", p_method: "one_click",
    p_url_enc: hex("ENC(https://u.example.com/one?t=1)"), p_msg_key: "gmail:m1", p_occurred_at: new Date(1790000000000).toISOString(), p_item: "item-9" });
  const { rpc: bad } = fakeRpc({}, ["worker_record_unsub"]);
  assertEquals(await recordUnsub(bad, fakeDeps(), USER, CONN, mk("m2", { lu: true }), null), "error");
  const { rpc: r3, calls: c3 } = fakeRpc();
  const noFrom: GmailMessage = { id: "m3", internalDate: "1", payload: { headers: [] } };
  assertEquals(await recordUnsub(r3, fakeDeps(), USER, CONN, noFrom, null), "skipped");
  assertEquals(c3.length, 0);
});

Deno.test("gmail-fetch: promotion discard records (no item), pass with List-Unsubscribe records with item id, plain pass and OTP do not", async () => {
  const msgs: Record<string, GmailMessage> = {
    p: mk("p", { labels: ["INBOX", "CATEGORY_PROMOTIONS"], lu: true }),
    n: mk("n", { lu: true, subject: "합성 소식" }),
    t: mk("t", { subject: "합성 주문 확인" }),
    o: mk("o", { body: "인증번호 483920 을 입력하세요" }),
  };
  const { rpc, calls } = fakeRpc({ ...ST, insert_item: "item-n" });
  assertEquals(await gmailFetch(rpc, job("gmail-fetch", { ids: ["p", "n", "t", "o"] }), fakeDeps({ getMessage: async (id) => msgs[id] })), "fetched");
  const recs = calls.filter((c) => c.fn === "worker_record_unsub").map((c) => [c.args.p_msg_key, c.args.p_item]);
  assertEquals(recs, [["gmail:p", null], ["gmail:n", "item-n"]]);
  assertEquals(calls.filter((c) => c.fn === "insert_item").map((c) => c.args.p_idempotency_key), ["gmail:n", "gmail:t"]);
});

Deno.test("gmail-fetch: unsub record failure never fails the fetch; duplicate insert (null id) skips the record", async () => {
  const { rpc, calls } = fakeRpc({ ...ST, insert_item: null }, ["worker_record_unsub"]);
  const msgs: Record<string, GmailMessage> = { p: mk("p", { labels: ["CATEGORY_PROMOTIONS"], lu: true }), n: mk("n", { lu: true }) };
  assertEquals(await gmailFetch(rpc, job("gmail-fetch", { ids: ["p", "n"] }), fakeDeps({ getMessage: async (id) => msgs[id] })), "fetched");
  assertEquals(calls.filter((c) => c.fn === "worker_record_unsub").map((c) => c.args.p_msg_key), ["gmail:p"]);   // n 은 중복(null id) → 기록 없음
});

Deno.test("gmail-unsub-scan: list query + gate targets → gmail-unsub-fetch jobs of 50 on the payload lease, backfill lane", async () => {
  const ids = Array.from({ length: 70 }, (_, i) => "s" + i);
  const qs: string[] = [];
  const { rpc, calls } = fakeRpc({ ...ST, unsub_scan_targets: [{ gmail_id: "s3", item_id: "item-3" }, { gmail_id: "g1", item_id: "item-g" }] });
  const deps = fakeDeps({ listMessageIds: async (q, p) => { qs.push(q); return p ? { messages: ids.slice(60).map((id) => ({ id })) } : { messages: ids.slice(0, 60).map((id) => ({ id })), nextPageToken: "1" }; } });
  assertEquals(await gmailUnsubScan(rpc, job("gmail-unsub-scan", { backfill: true, lease_key: "test:r:gmail:" + CONN }), deps), "scanned");
  assertEquals(qs, [UNSUB_SCAN_Q, UNSUB_SCAN_Q]);
  const enq = calls.filter((c) => c.fn === "enqueue_job");
  assertEquals(enq.map((c) => [c.args.p_kind, c.args.p_lease_key, (c.args.p_payload as { msgs: unknown[] }).msgs.length]),
    [["gmail-unsub-fetch", "test:r:gmail:" + CONN, 50], ["gmail-unsub-fetch", "test:r:gmail:" + CONN, 21]]);
  const all = enq.flatMap((c) => (c.args.p_payload as { msgs: { id: string; item: string | null }[] }).msgs);
  assertEquals(all.find((m) => m.id === "s3"), { id: "s3", item: "item-3" });
  assertEquals(all.find((m) => m.id === "g1"), { id: "g1", item: "item-g" });
  assertEquals((enq[0].args.p_payload as { backfill: boolean }).backfill, true);
});

Deno.test("gmail-unsub-fetch: metadata only; gate target recorded with item, promo label/(광고) recorded, plain skipped, 404 skipped", async () => {
  const meta: Record<string, GmailMessage> = {
    a: mk("a", { lu: true }), b: mk("b", { labels: ["CATEGORY_PROMOTIONS"], lu: true }), c: mk("c", { subject: "(광고) 합성 세일" }), d: mk("d"),
  };
  const got: string[] = [];
  const { rpc, calls } = fakeRpc(ST);
  const deps = fakeDeps({
    getMessage: async () => { throw new Error("full format must not be used"); },
    getMessageMeta: async (id) => { got.push(id); if (id === "gone") throw new GmailHttpError("messages.get", 404); return meta[id]; },
  });
  const msgs = [{ id: "a", item: "item-a" }, { id: "b", item: null }, { id: "c", item: null }, { id: "d", item: null }, { id: "gone", item: null }];
  assertEquals(await gmailUnsubFetch(rpc, job("gmail-unsub-fetch", { msgs }), deps), "fetched");
  assertEquals(got, ["a", "b", "c", "d", "gone"]);
  assertEquals(calls.filter((c) => c.fn === "worker_record_unsub").map((c) => [c.args.p_msg_key, c.args.p_item]),
    [["gmail:a", "item-a"], ["gmail:b", null], ["gmail:c", null]]);
});
```

- [ ] **Step 2: 실패 확인**

Run: `deno test --allow-net --allow-env --allow-read supabase/tests/unsub-jobs.test.ts`
Expected: FAIL — `recordUnsub`·`gmailUnsubScan`·`gmailUnsubFetch`·`UNSUB_SCAN_Q` export 없음.

- [ ] **Step 3: `gmail.ts` — 메타데이터 조회**

`getMessage` 함수 바로 뒤에 추가:

```ts
// 광고 구독 해지 스캔(스펙 §7): 본문 없이 헤더만. messages.get format=metadata
export const META_HEADERS = ["From", "Subject", "List-Unsubscribe", "List-Unsubscribe-Post", "Authentication-Results", "DKIM-Signature"];
export async function getMessageMeta(accessToken: string, id: string) {
  const u = new URL(`${G}/messages/${encodeURIComponent(id)}`);
  u.searchParams.set("format", "metadata");
  for (const h of META_HEADERS) u.searchParams.append("metadataHeaders", h);
  const r = await fetch(u, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!r.ok) { await r.body?.cancel(); throw new GmailHttpError("messages.get", r.status); }
  return await r.json() as GmailMessage;
}
```

`GmailClient` 인터페이스에 `getMessageMeta(id: string): Promise<GmailMessage>;`를 `getMessage` 줄 아래에 더하고, `gmailApi`의 반환 객체에 `getMessageMeta: (id) => getMessageMeta(accessToken, id),`를 더한다.

`supabase/tests/gmail.test.ts`의 `fakeDeps` 안 `getMessage: async (id) => gmsg(id, "합성 본문", "합성 제목"),` 아래에 한 줄:

```ts
      getMessageMeta: async (id) => gmsg(id, "", "합성 제목"),
```

- [ ] **Step 4: `gmail-jobs.ts` — 기록·스캔**

import 줄에 추가:

```ts
import { hasListUnsub, isAdMail, unsubMeta } from "./unsub.ts";
```

`FETCH_GAP_MS` 정의 아래에 추가:

```ts
export const UNSUB_SCAN_Q = "newer_than:30d {category:promotions subject:광고} -in:drafts";

// 광고 구독 해지(스펙 §7): 헤더 메타만 기록한다. 절대 throw하지 않는다 — gmail-fetch 를 실패시키면 거래 메일까지 유실된다(fail-open)
export async function recordUnsub(sb: RpcClient, deps: Pick<GmailJobDeps, "encrypt">, user: string, conn: string, msg: GmailMessage,
                                  itemId: string | null): Promise<"recorded" | "skipped" | "error"> {
  try {
    const m = unsubMeta(msg);
    if (!m) return "skipped";
    const { error } = await sb.rpc("worker_record_unsub", {
      p_user: user, p_connection: conn, p_address: m.address, p_name: m.name, p_method: m.method,
      p_url_enc: m.url ? toBytea(await deps.encrypt(user, m.url)) : null,
      p_msg_key: "gmail:" + msg.id, p_occurred_at: new Date(Number(msg.internalDate)).toISOString(), p_item: itemId,
    });
    if (error) throw new Error("worker_record_unsub " + (error.code ?? "error"));
    return "recorded";
  } catch {
    console.log(JSON.stringify({ connection_id: conn, code: "unsub_record_error" }));   // 코드만(주소·URL 없음)
    return "error";
  }
}
```

`gmailFetch`의 루프 안 `const it = gmailToItem(msg);` 아래 분기를 다음으로 바꾼다(앞뒤 줄은 그대로):

```ts
    const it = gmailToItem(msg);                                   // /ingest와 같은 서버 규칙 필터
    if (it.kind === "discard") {
      discarded++;
      console.log(JSON.stringify({ connection_id: conn, gmail_discard: it.reason }));   // 사유 코드만
      if (it.reason === "promotion" && (await recordUnsub(sb, deps, user, conn, msg, null)) === "recorded") ads++;   // 광고 헤더 메타(§7)
    } else {
      const itemId = await call(sb, "insert_item", {
        p_user: user, p_source: "GMAIL", p_idempotency_key: "gmail:" + id,
        p_sender: it.sender, p_title: it.title,                    // 제목은 카드·계좌 마스킹된 값
        p_content_enc: toBytea(await deps.encrypt(user, it.text)), // 평문 본문은 DB로 가지 않는다
        p_occurred_at: it.occurredAt,
        p_backfill: job.payload.backfill === true,   // 연결 시 90일 백필 → 백필 레인(§7)
      }) as string | null;
      stored++;
      // 게이트가 promo 로 판정하면 광고로 센다(unsub_list). 중복(null)은 첫 수신 때 기록됐다
      if (itemId && hasListUnsub(msg)) await recordUnsub(sb, deps, user, conn, msg, itemId);
    }
```

`let stored = 0, discarded = 0, gone = 0;` → `let stored = 0, discarded = 0, gone = 0, ads = 0;`, 마지막 로그를 `gmail_fetch: { stored, discarded, gone, ads }`로 바꾼다.

`gmailWatch` 함수 앞에 추가:

```ts
// 광고 구독 해지 30일 스캔(스펙 §7): 운영자가 gmail_enqueue_unsub_scan 으로 1회 넣는다(③c2 뒤). 헤더만 읽는 자식 잡을 50개씩 넣는다
export async function gmailUnsubScan(sb: RpcClient, job: Job, deps = defaultGmailDeps): Promise<string> {
  const { user, conn } = ids(job);
  const token = await accessToken(sb, deps, user, conn);
  if (!token) return "skipped";
  const api = deps.api(token);
  const want = new Map<string, string | null>();                 // gmail id → 게이트 promo 항목 id(없으면 라벨·표기로 다시 판정)
  let pageToken: string | undefined;
  do {
    const p = await api.listMessageIds(UNSUB_SCAN_Q, pageToken);
    for (const m of p.messages ?? []) want.set(m.id, null);
    pageToken = p.nextPageToken;
  } while (pageToken);
  const listed = want.size;
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const targets = await call(sb, "unsub_scan_targets", { p_user: user, p_since: since }) as { gmail_id: string; item_id: string }[];
  for (const t of targets ?? []) want.set(t.gmail_id, t.item_id);
  const msgs = [...want].map(([id, item]) => ({ id, item }));
  const lease = typeof job.payload.lease_key === "string" ? job.payload.lease_key : "gmail:" + conn;
  for (let i = 0; i < msgs.length; i += FETCH_BATCH) {
    await call(sb, "enqueue_job", { p_user: user, p_kind: "gmail-unsub-fetch", p_lease_key: lease,
      p_payload: { connection_id: conn, backfill: true, msgs: msgs.slice(i, i + FETCH_BATCH) } });
  }
  console.log(JSON.stringify({ connection_id: conn, unsub_scan: { listed, targets: targets?.length ?? 0, jobs: Math.ceil(msgs.length / FETCH_BATCH) } }));
  return "scanned";
}

export async function gmailUnsubFetch(sb: RpcClient, job: Job, deps = defaultGmailDeps): Promise<string> {
  const { user, conn } = ids(job);
  const token = await accessToken(sb, deps, user, conn);
  if (!token) return "skipped";
  const api = deps.api(token);
  let recorded = 0, skipped = 0, gone = 0;
  for (const { id, item } of job.payload.msgs as { id: string; item: string | null }[]) {
    let msg: GmailMessage;
    try { msg = await api.getMessageMeta(id); }
    catch (e) {
      if (!(e instanceof GmailHttpError && e.status === 404)) throw e;   // 429·5xx 는 잡 재시도(기록은 멱등)
      gone++;
      await deps.pause(FETCH_GAP_MS);
      continue;
    }
    if (item || isAdMail(msg)) { if ((await recordUnsub(sb, deps, user, conn, msg, item)) === "recorded") recorded++; }
    else skipped++;
    await deps.pause(FETCH_GAP_MS);
  }
  console.log(JSON.stringify({ connection_id: conn, unsub_fetch: { recorded, skipped, gone } }));
  return "fetched";
}
```

`supabase/functions/worker/index.ts`: import에 `gmailUnsubFetch, gmailUnsubScan`을 더하고 `"gmail-watch"` 줄 아래에:

```ts
  // 광고 구독 해지 30일 스캔(스펙 §7): 헤더(format=metadata)만 읽어 unsub_* 에 기록
  "gmail-unsub-scan": (j) => gmailUnsubScan(sb, j),
  "gmail-unsub-fetch": (j) => gmailUnsubFetch(sb, j),
```

- [ ] **Step 5: 통과·회귀 확인**

Run: `deno test --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/tests/unsub-jobs.test.ts supabase/tests/gmail.test.ts supabase/tests/unsub.test.ts && deno check supabase/functions/worker/index.ts`
Expected: PASS(새 5개 + `gmail.test.ts` 기존 27개 전부), `deno check` 무오류. `gmail.test.ts`가 하나라도 실패하면 이 태스크는 끝나지 않는다(Global Constraints "Gmail 수집 회귀 금지").

- [ ] **Step 6: 커밋**

```bash
git add supabase/functions/_shared/gmail.ts supabase/functions/_shared/gmail-jobs.ts supabase/functions/worker/index.ts supabase/tests/unsub-jobs.test.ts supabase/tests/gmail.test.ts
git commit -m "feat(server): gmail-fetch records ad header metadata — promotion discards without an item, stored mail with List-Unsubscribe linked by item id (counted only if the gate says promo), fail-open recordUnsub (log code only); gmail-unsub-scan (30-day promotions/(광고) list + gate promo targets) → gmail-unsub-fetch jobs of 50 reading format=metadata on the connection lease in the backfill lane (spec §7)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task U5: Edge `unsubscribe` + 스모크·시드·집계 도구

**Files:**
- Create: `supabase/functions/unsubscribe/handler.ts`, `deps.ts`, `index.ts`
- Modify: `supabase/config.toml` (`[functions.unsubscribe] verify_jwt = false`)
- Test: `supabase/tests/unsubscribe.test.ts`
- Create: `supabase/scripts/smoke-unsub.ts`, `supabase/scripts/seed-unsub.ts`, `supabase/scripts/unsub-stats.ts`

**Interfaces:**
- Consumes: U2 `oneClickPost`·`resolverKind`, U3 `unsub_begin`·`unsub_finish`·`worker_record_unsub`·`gmail_enqueue_unsub_scan`·`unsub_list`, `_shared/crypto.ts` `decrypt`·`fromBytea`·`encrypt`·`toBytea`.
- Produces:
  - `POST /functions/v1/unsubscribe` (사용자 JWT, body `{sender_id: uuid}`) → 200 `{result: "requested" | "failed" | "unsupported" | "already" | "busy" | "limit" | "not_found", code?: PostCode | "error"}`, 401 세션 없음, 400 `bad_json`·`bad_sender`, 405
  - `POST /functions/v1/unsubscribe/sink` (인증 없음, 스모크 전용): 본문이 정확히 `List-Unsubscribe=One-Click`이면 200, 아니면 400. `/sink/redirect`는 307 → `/sink`
  - `handleUnsubscribe(req: Request, deps: UnsubDeps, sinkBase: string): Promise<Response>`
  - `UnsubDeps = { authUser(token): Promise<string | null>; begin(user, sender): Promise<{ result: string; url_enc?: string }>; decrypt(user, enc: string): Promise<string>; post(url): Promise<{ ok: boolean; code: string }>; finish(user, sender, code): Promise<void> }`

- [ ] **Step 1: 실패하는 테스트 작성**

`supabase/tests/unsubscribe.test.ts`:

```ts
import { assertEquals } from "jsr:@std/assert";
import { handleUnsubscribe, type UnsubDeps } from "../functions/unsubscribe/handler.ts";

const SID = "11111111-2222-3333-4444-555555555555";
const SINK = "https://proj.example.com/functions/v1/unsubscribe/sink";
function deps(o: Partial<UnsubDeps> = {}) {
  const log: string[] = [];
  const d: UnsubDeps = {
    authUser: async (t) => (t === "good" ? "user-1" : null),
    begin: async () => ({ result: "ok", url_enc: "\\x00" }),
    decrypt: async () => "https://u.example.com/one",
    post: async (u) => { log.push("post:" + u); return { ok: true, code: "ok" }; },
    finish: async (_u, s, c) => { log.push(`finish:${s}:${c}`); },
    ...o,
  };
  return { d, log };
}
const req = (body: unknown, token: string | null = "good", path = "/unsubscribe") =>
  new Request("https://proj.example.com" + path, { method: "POST", headers: token ? { authorization: "Bearer " + token } : {},
    body: typeof body === "string" ? body : JSON.stringify(body) });

Deno.test("auth and input: 401 without/invalid token, 400 bad json/sender, 405 GET", async () => {
  const { d } = deps();
  assertEquals((await handleUnsubscribe(req({ sender_id: SID }, null), d, SINK)).status, 401);
  assertEquals((await handleUnsubscribe(req({ sender_id: SID }, "bad"), d, SINK)).status, 401);
  assertEquals((await handleUnsubscribe(req("{", "good"), d, SINK)).status, 400);
  assertEquals((await handleUnsubscribe(req({ sender_id: "x; drop" }), d, SINK)).status, 400);
  const get = new Request("https://proj.example.com/unsubscribe", { headers: { authorization: "Bearer good" } });
  assertEquals((await handleUnsubscribe(get, d, SINK)).status, 405);
});

Deno.test("ok path: begin → decrypt → post → finish(code) → requested", async () => {
  const { d, log } = deps();
  const r = await handleUnsubscribe(req({ sender_id: SID }), d, SINK);
  assertEquals([r.status, await r.json()], [200, { result: "requested", code: "ok" }]);
  assertEquals(log, ["post:https://u.example.com/one", `finish:${SID}:ok`]);
});

Deno.test("begin refusals pass through without decrypt/post/finish", async () => {
  for (const result of ["not_found", "unsupported", "busy", "already", "limit"]) {
    const { d, log } = deps({ begin: async () => ({ result }), decrypt: () => { throw new Error("must not decrypt"); } });
    const r = await handleUnsubscribe(req({ sender_id: SID }), d, SINK);
    assertEquals(await r.json(), { result });
    assertEquals(log, []);
  }
});

Deno.test("post failure and decrypt failure are recorded as failed with a code", async () => {
  {
    const { d, log } = deps({ post: async () => ({ ok: false, code: "blocked_private" }) });
    assertEquals(await (await handleUnsubscribe(req({ sender_id: SID }), d, SINK)).json(), { result: "failed", code: "blocked_private" });
    assertEquals(log, [`finish:${SID}:blocked_private`]);
  }
  {
    const { d, log } = deps({ decrypt: () => Promise.reject(new Error("bad key")) });
    assertEquals(await (await handleUnsubscribe(req({ sender_id: SID }), d, SINK)).json(), { result: "failed", code: "error" });
    assertEquals(log, [`finish:${SID}:error`]);
  }
});

Deno.test("sink: exact one-click body only; /sink/redirect → 307 to the sink", async () => {
  const { d } = deps();
  assertEquals((await handleUnsubscribe(req("List-Unsubscribe=One-Click", null, "/unsubscribe/sink"), d, SINK)).status, 200);
  assertEquals((await handleUnsubscribe(req("hello", null, "/unsubscribe/sink"), d, SINK)).status, 400);
  const r = await handleUnsubscribe(req("List-Unsubscribe=One-Click", null, "/unsubscribe/sink/redirect"), d, SINK);
  assertEquals([r.status, r.headers.get("location")], [307, SINK]);
});
```

- [ ] **Step 2: 실패 확인**

Run: `deno test --allow-net --allow-env --allow-read supabase/tests/unsubscribe.test.ts`
Expected: FAIL — `Module not found "…/unsubscribe/handler.ts"`.

- [ ] **Step 3: 구현**

`supabase/functions/unsubscribe/handler.ts`:

```ts
// 광고 구독 해지 요청(스펙 §7 "광고 구독 해지"). 사용자 JWT 필수, 사용자는 JWT 에서만 정한다(verify_jwt = false — sink 때문에 핸들러가 인증한다).
// unsub_begin(행 잠금·방법 확인·복호화 감사) → URL 복호화 → 안전 POST → unsub_finish. 응답·로그에 주소·URL 없음, 결과 코드만
export type UnsubDeps = {
  authUser(token: string): Promise<string | null>;
  begin(user: string, sender: string): Promise<{ result: string; url_enc?: string }>;
  decrypt(user: string, enc: string): Promise<string>;
  post(url: string): Promise<{ ok: boolean; code: string }>;
  finish(user: string, sender: string, code: string): Promise<void>;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 스모크 전용 수신처: 공인 주소 경로의 실제 POST·307 을 잰다. 본문이 정확히 원클릭 문자열일 때만 200, 아무것도 저장·기록하지 않는다
async function sink(req: Request, path: string, sinkBase: string): Promise<Response> {
  if (req.method !== "POST") return new Response(null, { status: 405 });
  const body = (await req.text().catch(() => "")).trim();
  if (body !== "List-Unsubscribe=One-Click") return new Response(null, { status: 400 });
  if (/\/sink\/redirect\/?$/.test(path)) return new Response(null, { status: 307, headers: { location: sinkBase } });
  return new Response(null, { status: 200 });
}

export async function handleUnsubscribe(req: Request, deps: UnsubDeps, sinkBase: string): Promise<Response> {
  const path = new URL(req.url).pathname;
  if (/\/unsubscribe\/sink(\/redirect)?\/?$/.test(path)) return await sink(req, path, sinkBase);
  const token = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  const user = token ? await deps.authUser(token) : null;
  if (!user) return new Response(null, { status: 401 });
  if (req.method !== "POST") return new Response(null, { status: 405 });
  let b: { sender_id?: unknown };
  try { b = await req.json(); } catch { return Response.json({ error: "bad_json" }, { status: 400 }); }
  const sender = typeof b?.sender_id === "string" && UUID.test(b.sender_id) ? b.sender_id : null;
  if (!sender) return Response.json({ error: "bad_sender" }, { status: 400 });
  const begin = await deps.begin(user, sender);
  if (begin.result !== "ok" || !begin.url_enc) {
    console.log(JSON.stringify({ unsubscribe: begin.result }));
    return Response.json({ result: begin.result });
  }
  let code: string;
  try { code = (await deps.post(await deps.decrypt(user, begin.url_enc))).code; }
  catch { code = "error"; }
  await deps.finish(user, sender, code);
  const result = code === "ok" || code === "ok_redirect" ? "requested" : "failed";
  console.log(JSON.stringify({ unsubscribe: result, code }));
  return Response.json({ result, code });
}
```

`supabase/functions/unsubscribe/deps.ts`:

```ts
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { decrypt } from "../_shared/crypto.ts";
import { oneClickPost } from "../_shared/safe-post.ts";
import type { UnsubDeps } from "./handler.ts";

// service role. 모든 RPC 에 user_id 를 명시한다(스펙 §12 통제 4)
export function unsubDeps(sb: SupabaseClient): UnsubDeps {
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await sb.rpc(fn, args);
    if (error) throw new Error(fn + " " + error.code);
    return data;
  };
  return {
    authUser: async (t) => { const { data, error } = await sb.auth.getUser(t); return error ? null : data.user?.id ?? null; },
    begin: async (u, s) => (await rpc("unsub_begin", { p_user: u, p_sender: s })) as { result: string; url_enc?: string },
    decrypt: (u, enc) => decrypt(u, enc),
    post: (url) => oneClickPost(url),
    finish: async (u, s, c) => { await rpc("unsub_finish", { p_user: u, p_sender: s, p_code: c }); },
  };
}
```

`supabase/functions/unsubscribe/index.ts`:

```ts
import { createClient } from "npm:@supabase/supabase-js@2";
import { SERVER_AUTH } from "../_shared/crypto.ts";
import { resolverKind } from "../_shared/safe-post.ts";
import { unsubDeps } from "./deps.ts";
import { handleUnsubscribe } from "./handler.ts";

const url = Deno.env.get("SUPABASE_URL")!;
const sb = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, SERVER_AUTH);
const sinkBase = url.replace(/\/+$/, "") + "/functions/v1/unsubscribe/sink";
console.log(JSON.stringify({ unsubscribe: "boot", resolver: resolverKind() }));   // 배포 실측(U6): deno 또는 doh
Deno.serve((req) => handleUnsubscribe(req, unsubDeps(sb), sinkBase));
```

`supabase/config.toml`의 `[functions.apns-send]` 블록 뒤에 추가:

```toml
[functions.unsubscribe]
verify_jwt = false
```

- [ ] **Step 4: 통과 확인**

Run: `deno test --allow-net --allow-env --allow-read supabase/tests/unsubscribe.test.ts && deno check supabase/functions/unsubscribe/index.ts`
Expected: PASS(5개), 무오류.

- [ ] **Step 5: 도구 3개**

`supabase/scripts/smoke-unsub.ts` (배포 함수 실측 — U6에서 실행):

```ts
// 광고 구독 해지 배포 실측(계획 U6). 테스트 사용자 1 + 실행 태그 연결(disconnected)에 합성 발신자 5곳을 기록하고
// 배포된 unsubscribe 함수를 사용자 JWT 로 부른다. 끝나면 자기 행만 지운다(연결 cascade, audit actor=unsubscribe).
// 사용: deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/smoke-unsub.ts
import { encrypt, toBytea } from "../functions/_shared/crypto.ts";
import { RUN, service as sb, userClient } from "../tests/_testenv.ts";

const base = Deno.env.get("SUPABASE_URL")!.replace(/\/+$/, "");
const sink = base + "/functions/v1/unsubscribe/sink";
const { u, c } = await userClient(1);
const jwt = (await c.auth.getSession()).data.session!.access_token;
const { data: conn, error } = await sb.from("connections").insert({ user_id: u.id, provider: "gmail", account_ref: `${RUN}-smoke@example.com`, status: "disconnected" })
  .select("id").single();
if (error) throw new Error("connection " + error.code);
const cases = [
  { addr: "sink@example.com", url: sink, want: ["requested", "ok"] },
  { addr: "redirect@example.com", url: sink + "/redirect", want: ["requested", "ok"] },
  { addr: "private@example.com", url: "https://10.0.0.1/unsub", want: ["failed", "blocked_private"] },
  { addr: "scheme@example.com", url: "http://u.example.com/unsub", want: ["failed", "blocked_scheme"] },
  { addr: "mailto@example.com", url: null, want: ["unsupported", undefined] },
] as const;
const out: Record<string, unknown> = {};
let pass = true;
try {
  for (const k of cases) {
    const { data: id, error: e } = await sb.rpc("worker_record_unsub", { p_user: u.id, p_connection: conn!.id, p_address: k.addr, p_name: "합성 스모크",
      p_method: k.url ? "one_click" : "mailto", p_url_enc: k.url ? toBytea(await encrypt(u.id, k.url)) : null,
      p_msg_key: `${RUN}:${k.addr}`, p_occurred_at: new Date().toISOString(), p_item: null });
    if (e) throw new Error("record " + e.code);
    const r = await fetch(base + "/functions/v1/unsubscribe", { method: "POST",
      headers: { authorization: "Bearer " + jwt, apikey: Deno.env.get("SUPABASE_ANON_KEY")!, "content-type": "application/json" },
      body: JSON.stringify({ sender_id: id }) });
    const j = await r.json().catch(() => ({})) as { result?: string; code?: string };
    const ok = r.status === 200 && j.result === k.want[0] && j.code === k.want[1];
    pass &&= ok;
    out[k.addr.split("@")[0]] = { status: r.status, result: j.result, code: j.code, ok };
  }
  const { data: list } = await c.rpc("unsub_list");
  out.list = (list ?? []).map((r: { status: string; method: string }) => `${r.method}:${r.status}`).sort();
  console.log(JSON.stringify({ gate: pass ? "pass" : "fail", ...out }));
} finally {
  await sb.from("connections").delete().eq("user_id", u.id).eq("id", conn!.id);
  await sb.from("audit_log").delete().eq("user_id", u.id).eq("actor", "unsubscribe");
}
if (!pass) Deno.exit(1);
```

`supabase/scripts/seed-unsub.ts` (시뮬레이터 게이트 시드 — 비밀번호 불변 `testUserId`):

```ts
// 시뮬레이터 게이트(U9) 시드: 테스트 사용자 n 에 합성 광고 발신자 5곳. --cleanup 이면 이 시드의 연결만 지운다(cascade).
// 사용: deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/seed-unsub.ts [--user-n 1] [--cleanup]
import { encrypt, toBytea } from "../functions/_shared/crypto.ts";
import { service as sb, testUserId } from "../tests/_testenv.ts";

const n = Number(Deno.args[Deno.args.indexOf("--user-n") + 1] || 1) || 1;
const user = await testUserId(n);
const REF = "test-seed-unsub@example.com";
const old = await sb.from("connections").select("id").eq("user_id", user).eq("account_ref", REF);
for (const r of old.data ?? []) await sb.from("connections").delete().eq("id", r.id);
await sb.from("audit_log").delete().eq("user_id", user).eq("actor", "unsubscribe");
if (Deno.args.includes("--cleanup")) { console.log(JSON.stringify({ cleanup: true })); Deno.exit(0); }

const sink = Deno.env.get("SUPABASE_URL")!.replace(/\/+$/, "") + "/functions/v1/unsubscribe/sink";
const { data: conn, error } = await sb.from("connections").insert({ user_id: user, provider: "gmail", account_ref: REF, status: "disconnected" }).select("id").single();
if (error) throw new Error("connection " + error.code);
const H = 3_600_000, D = 24 * H;
const senders = [
  { addr: "s1@example.com", name: "합성쇼핑", method: "one_click", url: sink, ads: 12 },
  { addr: "s2@example.com", name: "합성여행", method: "one_click", url: sink + "/redirect", ads: 5 },
  { addr: "s3@example.net", name: "합성메일진", method: "mailto", url: null, ads: 3 },
  { addr: "s4@example.com", name: "합성사설", method: "one_click", url: "https://10.0.0.1/unsub", ads: 2 },
  { addr: "s5@example.com", name: "합성계속", method: "one_click", url: sink, ads: 1 },
];
const ids: Record<string, string> = {};
for (const s of senders) {
  for (let i = 0; i < s.ads; i++) {
    const { data, error: e } = await sb.rpc("worker_record_unsub", { p_user: user, p_connection: conn!.id, p_address: s.addr, p_name: s.name, p_method: s.method,
      p_url_enc: s.url ? toBytea(await encrypt(user, s.url)) : null, p_msg_key: `seed-unsub:${s.addr}:${i}`,
      p_occurred_at: new Date(Date.now() - (i + 1) * H).toISOString(), p_item: null });
    if (e) throw new Error("record " + e.code);
    ids[s.addr] = data as string;
  }
}
// s5: 5일 전 해지 요청함 → 1시간 전 광고 1통 = 유예(3일) 뒤 → "해지 요청 뒤에도 광고 1통"
await sb.from("unsub_senders").update({ status: "requested", status_at: new Date(Date.now() - 5 * D).toISOString(),
  requested_at: new Date(Date.now() - 5 * D).toISOString(), result_code: "ok", attempts: 1 }).eq("id", ids["s5@example.com"]);
console.log(JSON.stringify({ seeded: senders.length, user_n: n }));
```

`supabase/scripts/unsub-stats.ts` (실사용자 집계 — 주소·이름·URL 출력 없음):

```ts
// 광고 구독 해지 실측 집계(계획 U6·U10). 개인정보(AGENTS.md §7): 개수·방법·상태·결과 코드만 출력한다(주소·이름·URL·도메인 없음).
// 사용: deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/unsub-stats.ts [--enqueue-scan]
import { createClient } from "npm:@supabase/supabase-js@2";
import { SERVER_AUTH } from "../functions/_shared/crypto.ts";

const user = Deno.env.get("ERURI_USER_ID");
if (!user) { console.error("ERURI_USER_ID 없음"); Deno.exit(2); }
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, SERVER_AUTH);
if (Deno.args.includes("--enqueue-scan")) {
  const { data, error } = await sb.rpc("gmail_enqueue_unsub_scan", { p_user: user });
  if (error) throw new Error("enqueue " + error.code);
  console.log(JSON.stringify({ enqueued: data }));
}
const { data: senders, error: e1 } = await sb.from("unsub_senders").select("id, method, status, result_code").eq("user_id", user);
if (e1) throw new Error("senders " + e1.code);
const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
const { data: ad, error: e2 } = await sb.rpc("unsub_ad_mail", { p_user: user });
if (e2) throw new Error("ad " + e2.code);
const recent = (ad ?? []).filter((a: { occurred_at: string }) => a.occurred_at >= since);
const withAds = new Set(recent.map((a: { sender_id: string }) => a.sender_id));
const count = (xs: string[]) => xs.reduce((m, x) => ({ ...m, [x]: (m[x] ?? 0) + 1 }), {} as Record<string, number>);
const { data: jobs } = await sb.from("jobs").select("kind, status").eq("user_id", user).in("kind", ["gmail-unsub-scan", "gmail-unsub-fetch"]);
console.log(JSON.stringify({
  senders: senders!.length,
  senders_with_ads_30d: withAds.size,
  ads_30d: recent.length,
  method_of_senders_with_ads: count(senders!.filter((s) => withAds.has(s.id)).map((s) => s.method)),
  status: count(senders!.map((s) => s.status)),
  result_codes: count(senders!.filter((s) => s.result_code).map((s) => s.result_code!)),
  jobs: count((jobs ?? []).map((j) => `${j.kind}:${j.status}`)),
}));
```

`unsub_ad_mail`은 U3에서 `authenticated`·`anon`·`public` 실행을 회수했지만 service role은 실행할 수 있다.

Run: `deno check supabase/scripts/smoke-unsub.ts supabase/scripts/seed-unsub.ts supabase/scripts/unsub-stats.ts`
Expected: 무오류.

- [ ] **Step 6: 커밋**

```bash
git add supabase/functions/unsubscribe supabase/config.toml supabase/tests/unsubscribe.test.ts supabase/scripts/smoke-unsub.ts supabase/scripts/seed-unsub.ts supabase/scripts/unsub-stats.ts
git commit -m "feat(server): Edge unsubscribe — user JWT checked in the handler (verify_jwt off for the sink), unsub_begin → decrypt → safe one-click POST → unsub_finish, refusals pass through, result codes only in logs; /sink and /sink/redirect for live smoke; scripts smoke-unsub (deployed function, test user), seed-unsub (sim gate, password kept), unsub-stats (real-user aggregates without addresses, --enqueue-scan) (spec §7)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task U6: 서버 배포·스모크 (측정 창 밖)

**Files:**
- Modify: `docs/superpowers/phase1/gates.md` (행 `UNS-server`)

**Interfaces:**
- Consumes: U3(적용됨)·U4·U5 커밋.
- Produces: 배포된 `worker`(fetch 기록·스캔 핸들러)·`unsubscribe`, 리졸버 종류 기록.

- [ ] **Step 1: 선행 확인**

메인에게 확인: 지금이 Gmail 측정 창 밖이고(③b3 세션 아님, ③c1·③c2 창 아님), M2 ⑩b 실행 중이 아니다. 아니면 멈추고 보고한다.

Run: `vm_stat | grep -E 'free|compressor'; pgrep -x xcodebuild || echo none`
Expected: `none`(시뮬레이터 빌드와 동시 실행 금지).

- [ ] **Step 2: 전체 테스트·타입 확인**

Run: `deno test --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/tests/ && deno check supabase/functions/worker/index.ts supabase/functions/unsubscribe/index.ts supabase/functions/chat/index.ts supabase/scripts/*.ts`
Expected: 0 실패(ignored 수는 직전 기록과 같음), 무오류. 실패가 이 계획과 무관하면(다른 실행의 잔여 행 등) 원인을 적고 메인에게 알린다 — 남의 행은 지우지 않는다.

- [ ] **Step 3: 배포**

Run: `git log --oneline -1 && supabase functions deploy worker && supabase functions deploy unsubscribe`
Expected: 두 함수 배포 성공. 배포 시각(KST)·HEAD를 적어 둔다.

- [ ] **Step 4: 스모크**

Run: `deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/smoke-unsub.ts`
Expected: `{"gate":"pass","sink":{…"result":"requested","code":"ok"…},"redirect":{…"requested","ok"…},"private":{…"failed","blocked_private"…},"scheme":{…"failed","blocked_scheme"…},"mailto":{…"unsupported"…},"list":[…]}`.

`sink`가 `dns_error`면 리졸버 문제다: `supabase functions logs unsubscribe`(또는 대시보드 로그)에서 `{"unsubscribe":"boot","resolver":…}`를 확인하고 `deno`면 `Deno.resolveDns`가 Edge에서 실패하는 것 → `defaultResolver`를 DoH 우선으로 바꾸는 수정 태스크를 만들어 메인에게 보고한다(이 Step에서 고치지 않는다).

Run: `deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/smoke-gate.ts`
Expected: 기존 단건 회귀 `{"gate":"pass",…}`(워커 재배포가 process·notify 경로를 깨지 않았다).

- [ ] **Step 5: Gmail 수집 회귀·기록 동작 확인**

Run: `deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/gmail-gate.ts status`
Expected: 배포 뒤 dead `gmail-fetch` 0, 연결 `active`(Gmail 게이트 원장의 직전 값과 같은 꼴).

배포 6시간 이상 뒤(6시간 sync cron이 한 번 돈 뒤) 한 번:

Run: `deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/unsub-stats.ts`
Expected: `senders ≥ 1`이고 `ads_30d ≥ 1`(그사이 광고 메일이 한 통이라도 왔다면 — F2 경로 확인). 0이면 사용자에게 "지난 6시간 Gmail 프로모션 탭에 새 메일이 있었는지"만 묻고(내용·발신자는 묻지 않는다), 있었는데 0이면 실패로 적고 원인 조사 태스크를 만든다.

- [ ] **Step 6: 기록·커밋**

`docs/superpowers/phase1/gates.md` 표 끝에 행 추가(수치는 실제 값):

```
| UNS-server | 0028 + worker·unsubscribe 배포 뒤 smoke-unsub(sink 200·307 재POST·사설 IP·http 차단·mailto 거부)·smoke-gate 단건 회귀·gmail-gate status dead 0·6시간 뒤 unsub-stats 기록 증가, 전체 deno 0 실패 | 통과 | 배포 <KST>(worker v<n>·unsubscribe v<n>), HEAD <sha>, resolver <deno|doh>. smoke-unsub <JSON 한 줄>. smoke-gate <JSON 한 줄>. unsub-stats(+6h) senders <n>·ads_30d <n>(주소 없음). 전체 deno <n> 통과·0 실패·<n> ignored | | <날짜> |
```

```bash
git add docs/superpowers/phase1/gates.md
git commit -m "docs(gates): UNS-server — 0028 applied, worker and unsubscribe deployed; smoke-unsub pass (sink, 307, private/http blocked, mailto refused), smoke-gate single regression pass, Gmail fetch dead 0

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task U7: EruriCore `Unsubscribe`

**Files:**
- Create: `ios/Packages/EruriCore/Sources/EruriCore/Unsubscribe.swift`
- Test: `ios/Packages/EruriCore/Tests/EruriCoreTests/UnsubscribeTests.swift`

**Interfaces:**
- Consumes: U3 `unsub_list()` 열 이름(snake_case 그대로 디코드), U5 응답 `{result, code?}`.
- Produces:
  - `Unsubscribe.listPath = "rest/v1/rpc/unsub_list"`, `Unsubscribe.requestPath = "functions/v1/unsubscribe"`
  - `Unsubscribe.Row`(Identifiable·Decodable·Sendable·Equatable): `sender_id, display_name, address, method, status, status_at, requested_at, result_code, ads_30d, ads_after_request, last_ad_at`, `name`, `countLine`, `state(now:)`
  - `Unsubscribe.State`: `.available`·`.requesting`·`.requested(String)`·`.stillComing(Int)`·`.failed(String)`·`.unsupported(String)`, `label`, `buttonTitle: String?`, `isWarning`
  - `Unsubscribe.decode(_:) -> [Row]?`, `summary(count:) -> String`, `message(status: Int?, data: Data?) -> String`, `confirmTitle(_:) -> String`, `confirmMessage`, `footer`

- [ ] **Step 1: 실패하는 테스트 작성**

`ios/Packages/EruriCore/Tests/EruriCoreTests/UnsubscribeTests.swift`:

```swift
import XCTest
@testable import EruriCore

final class UnsubscribeTests: XCTestCase {
  // rpc/unsub_list 행(0028). 합성 값. timestamptz 는 PostgREST 가 마이크로초·+00:00 로 준다
  let json = """
  [{"sender_id":"a1","display_name":"합성쇼핑","address":"s1@example.com","method":"one_click","status":"active","status_at":null,"requested_at":null,"result_code":null,"ads_30d":12,"ads_after_request":0,"last_ad_at":"2026-10-09T03:00:00.123456+00:00"},
   {"sender_id":"b2","display_name":null,"address":"s3@example.net","method":"mailto","status":"active","status_at":null,"requested_at":null,"result_code":null,"ads_30d":3,"ads_after_request":0,"last_ad_at":null}]
  """.data(using: .utf8)!
  let now = ISO8601DateFormatter().date(from: "2026-10-10T00:00:00Z")!

  func row(method: String = "one_click", status: String = "active", statusAt: String? = nil, requestedAt: String? = nil,
           code: String? = nil, after: Int = 0) -> Unsubscribe.Row {
    Unsubscribe.Row(sender_id: "x", display_name: "합성", address: "x@example.com", method: method, status: status, status_at: statusAt,
                    requested_at: requestedAt, result_code: code, ads_30d: 4, ads_after_request: after, last_ad_at: nil)
  }

  func testDecodeAndLines() throws {
    let rows = try XCTUnwrap(Unsubscribe.decode(json))
    XCTAssertEqual(rows.map(\.id), ["a1", "b2"])
    XCTAssertEqual(rows.map(\.name), ["합성쇼핑", "s3@example.net"])                     // 이름 없으면 주소
    XCTAssertEqual(rows[0].countLine, "최근 30일 광고 12통 · s1@example.com")
    XCTAssertNil(Unsubscribe.decode(Data(#"{"code":"PGRST202"}"#.utf8)))
  }

  func testStates() {
    XCTAssertEqual(row().state(now: now), .available)
    XCTAssertEqual(row(status: "requesting", statusAt: "2026-10-09T23:59:30+00:00").state(now: now), .requesting)
    XCTAssertEqual(row(status: "requested", requestedAt: "2026-10-08T15:30:00.5+00:00").state(now: now), .requested("10/9"))   // 서울 날짜
    XCTAssertEqual(row(status: "requested", requestedAt: "2026-10-01T00:00:00+00:00", after: 2).state(now: now), .stillComing(2))
    XCTAssertEqual(row(status: "failed", code: "blocked_private").state(now: now), .failed("blocked_private"))
    for (m, text) in [("mailto", "메일 회신 방식 — 앱에서 해지할 수 없어요"), ("link_only", "웹 페이지 방식 — 앱에서 해지할 수 없어요"),
                      ("unverified", "발신자 확인이 안 돼 해지 요청을 보내지 않아요"), ("none", "해지 링크가 없어요")] {
      XCTAssertEqual(row(method: m).state(now: now), .unsupported(text))
    }
    XCTAssertEqual(row(method: "mailto", status: "requested", requestedAt: "2026-10-01T00:00:00+00:00").state(now: now), .requested("10/1"))
  }

  func testStaleRequestingIsRetryable() {
    let s = row(status: "requesting", statusAt: "2026-10-09T23:58:00+00:00").state(now: now)   // 2분 전
    XCTAssertEqual(s, .failed("timeout"))
    XCTAssertEqual(s.buttonTitle, "다시 시도")
  }

  func testLabelsAndButtons() {
    XCTAssertEqual([Unsubscribe.State.available, .requesting, .requested("10/9"), .stillComing(2), .failed("http_500"), .unsupported("해지 링크가 없어요")].map(\.label),
                   ["원클릭 해지 지원", "요청 중…", "해지 요청함 · 10/9", "해지 요청 뒤에도 광고 2통", "요청 실패 (http_500)", "해지 링크가 없어요"])
    XCTAssertEqual([Unsubscribe.State.available, .requesting, .requested("10/9"), .stillComing(2), .failed("x"), .unsupported("y")].map(\.buttonTitle),
                   ["해지", nil, nil, "다시 요청", "다시 시도", nil])
    XCTAssertEqual([Unsubscribe.State.stillComing(1), .failed("x"), .available].map(\.isWarning), [true, true, false])
  }

  func testMessages() {
    func m(_ s: Int?, _ body: String?) -> String { Unsubscribe.message(status: s, data: body.map { Data($0.utf8) }) }
    XCTAssertEqual(m(200, #"{"result":"requested","code":"ok"}"#), "해지 요청을 보냈어요. 발신자가 처리하는 데 며칠 걸릴 수 있어요")
    XCTAssertEqual(m(200, #"{"result":"failed","code":"timeout"}"#), "해지 요청 실패 (timeout)")
    XCTAssertEqual(m(200, #"{"result":"unsupported"}"#), "이 발신자는 앱에서 해지할 수 없어요")
    XCTAssertEqual(m(200, #"{"result":"already"}"#), "이미 해지 요청을 보냈어요")
    XCTAssertEqual(m(200, #"{"result":"busy"}"#), "요청 중이에요. 잠시 뒤 새로고침해 주세요")
    XCTAssertEqual(m(200, #"{"result":"limit"}"#), "이 발신자에게는 더 요청할 수 없어요 (5회)")
    XCTAssertEqual(m(200, #"{"result":"not_found"}"#), "목록이 바뀌었어요. 새로고침해 주세요")
    XCTAssertEqual(m(401, ""), "요청 실패: http_401")
    XCTAssertEqual(m(nil, nil), "요청 실패: network")
  }

  func testConfirmCopy() {
    XCTAssertEqual(Unsubscribe.confirmTitle(row()), "합성의 광고 수신 거부를 요청할까요?")
    XCTAssertTrue(Unsubscribe.confirmMessage.contains("거래 메일은 계속 올 수 있어요"))
    XCTAssertTrue(Unsubscribe.confirmMessage.contains("다시 수신 동의"))
    XCTAssertEqual(Unsubscribe.summary(count: 0), "최근 30일 광고 메일이 없어요")
    XCTAssertEqual(Unsubscribe.summary(count: 7), "광고 발신자 7곳 · 많이 보낸 순")
  }
}
```

- [ ] **Step 2: 실패 확인**

Run: `vm_stat | grep -E 'free|compressor'; pgrep -x deno || echo none; cd ios && ./scripts/sim.sh gen && ./scripts/sim.sh test EruriCoreTests/UnsubscribeTests`
Expected: `none` 뒤 FAIL — `cannot find 'Unsubscribe' in scope`.

- [ ] **Step 3: 구현**

`ios/Packages/EruriCore/Sources/EruriCore/Unsubscribe.swift`:

```swift
import Foundation

/// 광고 메일 구독 해지(스펙 §7 "광고 구독 해지"): rpc/unsub_list 행 해석·상태 문구·요청 결과. 화면은 App/UnsubscribeView.
/// 해지 URL 은 앱으로 오지 않는다(서버 unsub_list 가 내보내지 않음)
public enum Unsubscribe {
  public static let listPath = "rest/v1/rpc/unsub_list"
  public static let requestPath = "functions/v1/unsubscribe"

  public struct Row: Identifiable, Decodable, Sendable, Equatable {
    public let sender_id: String
    public let display_name: String?
    public let address: String
    public let method: String
    public let status: String
    public let status_at: String?
    public let requested_at: String?
    public let result_code: String?
    public let ads_30d: Int
    public let ads_after_request: Int
    public let last_ad_at: String?

    public var id: String { sender_id }
    public var name: String { (display_name?.isEmpty == false ? display_name : nil) ?? address }
    public var countLine: String { "최근 30일 광고 \(ads_30d)통 · \(address)" }
    public func state(now: Date = Date()) -> State { Unsubscribe.state(self, now: now) }
  }

  public enum State: Equatable, Sendable {
    case available, requesting, requested(String), stillComing(Int), failed(String), unsupported(String)

    public var label: String {
      switch self {
      case .available: return "원클릭 해지 지원"
      case .requesting: return "요청 중…"
      case .requested(let d): return "해지 요청함 · \(d)"
      case .stillComing(let n): return "해지 요청 뒤에도 광고 \(n)통"
      case .failed(let c): return "요청 실패 (\(c))"
      case .unsupported(let r): return r
      }
    }
    public var buttonTitle: String? {
      switch self {
      case .available: return "해지"
      case .stillComing: return "다시 요청"
      case .failed: return "다시 시도"
      default: return nil
      }
    }
    public var isWarning: Bool {
      switch self { case .stillComing, .failed: return true; default: return false }
    }
  }

  static func state(_ r: Row, now: Date) -> State {
    let oneClick = r.method == "one_click"
    if r.status == "requesting", let t = date(r.status_at), now.timeIntervalSince(t) < 60 { return .requesting }
    if r.status == "requested" {
      if r.ads_after_request == 0 { return .requested(shortDate(r.requested_at)) }
      if oneClick { return .stillComing(r.ads_after_request) }
    }
    if !oneClick { return .unsupported(reason(r.method)) }
    if r.status == "failed" { return .failed(r.result_code ?? "error") }
    if r.status == "requesting" { return .failed("timeout") }           // 60초 넘게 결과 없음 = 요청 중 종료, 다시 시도 가능
    return .available
  }

  static func reason(_ method: String) -> String {
    switch method {
    case "mailto": return "메일 회신 방식 — 앱에서 해지할 수 없어요"
    case "link_only": return "웹 페이지 방식 — 앱에서 해지할 수 없어요"
    case "unverified": return "발신자 확인이 안 돼 해지 요청을 보내지 않아요"
    case "none": return "해지 링크가 없어요"
    default: return "해지 방법을 알 수 없어요"
    }
  }

  /// PostgREST timestamptz("2026-10-09T03:00:00.123456+00:00") — 소수 초를 떼고 읽는다
  static func date(_ s: String?) -> Date? {
    guard let s else { return nil }
    return ISO8601DateFormatter().date(from: s.replacingOccurrences(of: #"\.\d+"#, with: "", options: .regularExpression))
  }
  static func shortDate(_ s: String?) -> String {
    guard let d = date(s) else { return "-" }
    var cal = Calendar(identifier: .gregorian)
    cal.timeZone = TimeZone(identifier: "Asia/Seoul")!
    let c = cal.dateComponents([.month, .day], from: d)
    return "\(c.month ?? 0)/\(c.day ?? 0)"
  }

  public static func decode(_ data: Data) -> [Row]? { try? JSONDecoder().decode([Row].self, from: data) }

  public static func summary(count: Int) -> String {
    count == 0 ? "최근 30일 광고 메일이 없어요" : "광고 발신자 \(count)곳 · 많이 보낸 순"
  }

  /// Edge unsubscribe 응답 {result, code?} → 사용자 문구
  public static func message(status: Int?, data: Data?) -> String {
    guard let status, let data else { return "요청 실패: network" }
    guard status == 200, let o = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any], let r = o["result"] as? String else {
      return "요청 실패: http_\(status)"
    }
    switch r {
    case "requested": return "해지 요청을 보냈어요. 발신자가 처리하는 데 며칠 걸릴 수 있어요"
    case "failed": return "해지 요청 실패 (\(o["code"] as? String ?? "error"))"
    case "unsupported": return "이 발신자는 앱에서 해지할 수 없어요"
    case "already": return "이미 해지 요청을 보냈어요"
    case "busy": return "요청 중이에요. 잠시 뒤 새로고침해 주세요"
    case "limit": return "이 발신자에게는 더 요청할 수 없어요 (5회)"
    case "not_found": return "목록이 바뀌었어요. 새로고침해 주세요"
    default: return "요청 실패: \(r)"
    }
  }

  public static func confirmTitle(_ r: Row) -> String { "\(r.name)의 광고 수신 거부를 요청할까요?" }
  public static let confirmMessage = "발신자 서버로 수신 거부 요청을 보냅니다. 주문·배송 같은 거래 메일은 계속 올 수 있어요(발신자 정책). 되돌리려면 그 서비스에서 다시 수신 동의해야 합니다."
  public static let footer = "Gmail에서 광고로 분류됐거나 (광고) 표시가 있는 메일만 셉니다. 해지 요청은 고른 발신자에게만, 누를 때만 보냅니다. 메일 제목·본문은 저장하지 않습니다."
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd ios && ./scripts/sim.sh test EruriCoreTests/UnsubscribeTests`
Expected: PASS(6개). `testStates`의 `"10/9"`(15:30Z = 서울 10/9 00:30)이 틀리면 `shortDate`의 시간대를 확인한다 — 기대값을 바꾸지 않는다.

- [ ] **Step 5: 커밋**

```bash
git add ios/Packages/EruriCore/Sources/EruriCore/Unsubscribe.swift ios/Packages/EruriCore/Tests/EruriCoreTests/UnsubscribeTests.swift
git commit -m "feat(core): Unsubscribe rows and states — unsub_list decode, available/requesting/requested (Seoul M/d)/still coming after the grace/failed (stale requesting = timeout, retryable)/unsupported reasons per method, button titles, Edge result messages, confirm copy (transactional mail may continue, re-consent to undo) (spec §7)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task U8: 앱 화면·0.10.0

**Files:**
- Create: `ios/App/UnsubscribeView.swift`
- Modify: `ios/App/ContentView.swift:32-36` (Gmail 절)
- Modify: `ios/project.yml:13` (`MARKETING_VERSION`)

**Interfaces:**
- Consumes: U7 `Unsubscribe.*`, `API.send`(F16).
- Produces: 화면 식별자(U9 XCUITest): 셀 `unsub-row-<address>`, 버튼 `unsub-button-<address>`, 상태 문구 `unsub-state-<address>`, 결과 문구 `unsub-message`, 설정 링크 `settings-unsubscribe`.

- [ ] **Step 1: 버전 확인 (D8)**

Run: `git log --oneline -- ios/project.yml | head -3; grep -n MARKETING_VERSION ios/project.yml`
Expected: 현재 `0.9.2`. 이미 `0.10.0` 이상이면 다음 빈 마이너를 쓰고, 스펙 §11·§15·§16과 보관 계획 R-B9 표기를 같은 커밋에서 맞춘다(U0 Step 5·8과 같은 방식).

- [ ] **Step 2: 화면 작성**

`ios/App/UnsubscribeView.swift`:

```swift
import SwiftUI
import EruriCore

/// 광고 메일 구독 해지(스펙 §7): 발신자별 최근 30일 광고 수와 원클릭 해지. 요청은 확인창 뒤에만, 고른 발신자 하나에만
struct UnsubscribeView: View {
  @State private var rows: [Unsubscribe.Row] = []
  @State private var message = ""
  @State private var confirm: Unsubscribe.Row?
  @State private var sending: String?

  var body: some View {
    List {
      if !message.isEmpty {
        Text(message).font(.caption).foregroundStyle(.secondary).accessibilityIdentifier("unsub-message")
      }
      ForEach(rows) { r in
        let st = r.state()
        VStack(alignment: .leading, spacing: 4) {
          Text(r.name)
          Text(r.countLine).font(.caption).foregroundStyle(.secondary)
          Text(st.label).font(.caption2).foregroundStyle(st.isWarning ? .orange : .secondary)
            .accessibilityIdentifier("unsub-state-\(r.address)")
          if let title = st.buttonTitle {
            Button(title) { confirm = r }
              .buttonStyle(.bordered).disabled(sending != nil)
              .accessibilityIdentifier("unsub-button-\(r.address)")
          }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("unsub-row-\(r.address)")
      }
      Section { Text(Unsubscribe.footer).font(.caption2).foregroundStyle(.secondary) }
    }
    .navigationTitle("광고 메일 구독 해지")
    // 확인창은 List 에 단다(Section 에 달면 표시되지 않는다 — 설정 화면 M2-⑥b 와 같은 이유)
    .alert(confirm.map(Unsubscribe.confirmTitle) ?? "", isPresented: Binding(get: { confirm != nil }, set: { if !$0 { confirm = nil } }),
           presenting: confirm) { r in
      Button("해지 요청", role: .destructive) { send(r) }
      Button("취소", role: .cancel) {}
    } message: { _ in
      Text(Unsubscribe.confirmMessage)
    }
    .task { await load() }
    .refreshable { await load() }
  }

  private func load() async {
    guard let r = await API.send(Unsubscribe.listPath, method: "POST", json: [String: String]()), r.status == 200,
          let v = Unsubscribe.decode(r.data) else {
      message = "불러오지 못했어요"; return
    }
    rows = v
    message = Unsubscribe.summary(count: v.count)
  }

  private func send(_ r: Unsubscribe.Row) {
    sending = r.id
    Task {
      let res = await API.send(Unsubscribe.requestPath, method: "POST", json: ["sender_id": r.id], timeout: 30)
      let text = Unsubscribe.message(status: res?.status, data: res?.data)
      await load()
      message = text                                             // 목록 요약보다 요청 결과를 보인다
      sending = nil
    }
  }
}
```

- [ ] **Step 3: 설정 링크·버전**

`ios/App/ContentView.swift`의 Gmail 절에서 `Button("다시 연결 (동의 다시 받기)") …` 줄 아래에 추가:

```swift
          NavigationLink("광고 메일 구독 해지") { UnsubscribeView() }        // 스펙 §7 광고 구독 해지(0.10.0)
            .accessibilityIdentifier("settings-unsubscribe")
```

`ios/project.yml` 13행: `MARKETING_VERSION: 0.9.2` → `MARKETING_VERSION: 0.10.0`.

- [ ] **Step 4: 빌드·Core 회귀**

Run: `vm_stat | grep -E 'free|compressor'; pgrep -x deno || echo none; cd ios && ./scripts/sim.sh gen && ./scripts/sim.sh build && ./scripts/sim.sh test EruriCoreTests`
Expected: `none` 뒤 BUILD SUCCEEDED, EruriCoreTests 전부 통과.

- [ ] **Step 5: 커밋**

```bash
git add ios/App/UnsubscribeView.swift ios/App/ContentView.swift ios/project.yml
git commit -m "feat(ios): 0.10.0 ad mail unsubscribe screen — Settings › Gmail › 광고 메일 구독 해지 lists senders by 30-day ad count with state lines, 해지/다시 요청/다시 시도 only for one-click senders, confirm alert before each request (one sender), result message then reload; accessibility ids for the sim gate (spec §7·§11)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task U9: 시뮬레이터 게이트·TestFlight (창 밖)

**Files:**
- Modify: `docs/superpowers/phase1/gates.md` (행 `UNS-sim`)
- 게이트 하네스(임시, **커밋하지 않는다**): `ios/project.gate0100.yml`, `EruriGate.xcodeproj`, `GateHostTests`·`GateUITests` — 0.9.0 하네스(`.context/gate090/`, `.context/sim-gate-090.report.md`)를 복사해 쓴다.

**Interfaces:**
- Consumes: U6 배포된 `unsubscribe`·0028, U5 `seed-unsub.ts`, U8 화면 식별자.

- [ ] **Step 1: 선행 확인·시드**

메인에게 창 밖임을 확인받는다. `pgrep -x deno`·`pgrep -x xcodebuild`가 비어 있는지 본다.

Run: `deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/seed-unsub.ts --user-n 1`
Expected: `{"seeded":5,"user_n":1}`. (비밀번호를 바꾸지 않으므로 하네스가 넣은 앱 세션이 유지된다.)

- [ ] **Step 2: 하네스로 로그인 상태 만들기**

0.9.0 하네스와 같이 `GateHostTests`가 테스트 사용자 1의 refresh token을 앱 Keychain에 넣는다(전용 시뮬레이터 UDID, `ios/.sim-udid`가 아닌 새 기기).

- [ ] **Step 3: UI 게이트 실행**

`GateUITests`에 아래 테스트를 더해 돌린다(하네스 파일 — 커밋 안 함):

```swift
func testUnsubscribeGate() throws {
  let app = XCUIApplication(); app.launch()
  app.tabBars.buttons["설정"].tap()
  app.buttons["settings-unsubscribe"].tap()
  // G1 순서·문구
  let s1 = app.staticTexts["unsub-state-s1@example.com"]
  XCTAssertTrue(s1.waitForExistence(timeout: 10))
  XCTAssertEqual(s1.label, "원클릭 해지 지원")
  XCTAssertEqual(app.staticTexts["unsub-state-s3@example.net"].label, "메일 회신 방식 — 앱에서 해지할 수 없어요")
  XCTAssertFalse(app.buttons["unsub-button-s3@example.net"].exists)                          // G5 mailto 버튼 없음
  XCTAssertEqual(app.staticTexts["unsub-state-s5@example.com"].label, "해지 요청 뒤에도 광고 1통")   // G6
  XCTAssertEqual(app.buttons["unsub-button-s5@example.com"].label, "다시 요청")
  // 결과 문구는 처음부터 목록 요약("광고 발신자 5곳 …")으로 있으므로 존재가 아니라 label 이 바뀔 때까지 기다린다
  func waitLabel(_ e: XCUIElement, _ p: String) {
    expectation(for: NSPredicate(format: p), evaluatedWith: e); waitForExpectations(timeout: 30)
  }
  let m = app.staticTexts["unsub-message"]
  // G2 원클릭 → 확인창 → 요청 → 해지 요청함
  app.buttons["unsub-button-s1@example.com"].tap()
  XCTAssertTrue(app.alerts.firstMatch.waitForExistence(timeout: 5))
  app.alerts.firstMatch.buttons["해지 요청"].tap()
  waitLabel(m, "label == '해지 요청을 보냈어요. 발신자가 처리하는 데 며칠 걸릴 수 있어요'")
  waitLabel(app.staticTexts["unsub-state-s1@example.com"], "label BEGINSWITH '해지 요청함 · '")
  XCTAssertFalse(app.buttons["unsub-button-s1@example.com"].exists)
  // G3 307 경로
  app.buttons["unsub-button-s2@example.com"].tap(); app.alerts.firstMatch.buttons["해지 요청"].tap()
  waitLabel(app.staticTexts["unsub-state-s2@example.com"], "label BEGINSWITH '해지 요청함 · '")
  // G4 사설 IP 차단 → 실패 + 다시 시도
  app.buttons["unsub-button-s4@example.com"].tap(); app.alerts.firstMatch.buttons["해지 요청"].tap()
  waitLabel(m, "label == '해지 요청 실패 (blocked_private)'")
  XCTAssertEqual(app.staticTexts["unsub-state-s4@example.com"].label, "요청 실패 (blocked_private)")
  XCTAssertEqual(app.buttons["unsub-button-s4@example.com"].label, "다시 시도")
  // G7 취소는 요청을 보내지 않는다
  app.buttons["unsub-button-s5@example.com"].tap(); app.alerts.firstMatch.buttons["취소"].tap()
  XCTAssertEqual(app.staticTexts["unsub-state-s5@example.com"].label, "해지 요청 뒤에도 광고 1통")
}
```

각 단계 스크린샷을 `.context/unsub-sim-shots/`에 남긴다(XCTAttachment). 게이트 판정 기준:

| # | 확인 | 통과 |
|---|---|---|
| G1 | 목록 순서·문구 | s1(12)·s2(5)·s3(3)·s4(2)·s5(1) 순, 상태 문구 일치 |
| G2 | 원클릭 요청 | 확인창 → "해지 요청을 보냈어요…" → s1 "해지 요청함 · M/D", 버튼 없음 |
| G3 | 307 재POST | s2 "해지 요청함" |
| G4 | 사설 IP | "요청 실패 (blocked_private)" + [다시 시도] |
| G5 | mailto | 사유 문구, 버튼 없음 |
| G6 | 유예 뒤 광고 | s5 "해지 요청 뒤에도 광고 1통" + [다시 요청] |
| G7 | 취소 | 상태 변화 없음 |

DB 대조(테스트 사용자, service role):

Run: `deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/sql.ts "select address, status, result_code, attempts from unsub_senders where user_id = \$1 order by address" <testUserId 1>`
Expected: s1·s2 `requested`·`ok`, s4 `failed`·`blocked_private`, s3 `active`, s5 `requested`(취소로 그대로). 주소는 합성 값이라 출력해도 된다.

- [ ] **Step 4: 정리·TestFlight**

Run: `deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/seed-unsub.ts --user-n 1 --cleanup`
Expected: `{"cleanup":true}`. 하네스 파일(`ios/project.gate0100.yml`·`EruriGate.xcodeproj`)을 지우고 `git status --short ios`가 비어 있는지 본다.

Run: `cd ios && ./scripts/testflight.sh`
Expected: 0.10.0 (빌드 번호 `YYYYMMDDHHMM`) 업로드 성공, App Store Connect 처리 VALID.

- [ ] **Step 5: 기록·커밋**

`docs/superpowers/phase1/gates.md` 행 추가:

```
| UNS-sim | 0.10.0 시뮬레이터: G1 목록 순서·문구 · G2 원클릭 요청(배포 함수 → sink 200) · G3 307 재POST · G4 사설 IP 차단 + 다시 시도 · G5 mailto 버튼 없음 · G6 유예 뒤 광고 다시 요청 · G7 취소 | 통과 | <KST>, 전용 시뮬레이터 <모델·iOS>, 테스트 사용자 1 시드(합성 5곳) → DB 대조 s1·s2 requested/ok, s4 failed/blocked_private, s3 active, s5 그대로. 스크린샷 `.context/unsub-sim-shots/`. 정리 완료. TestFlight 0.10.0 (<빌드>) VALID | | <날짜> |
```

```bash
git add docs/superpowers/phase1/gates.md
git commit -m "docs(gates): UNS-sim — 0.10.0 unsubscribe screen on the deployed function (one-click, 307, private IP blocked with retry, mailto without button, still-coming re-request, cancel), TestFlight 0.10.0

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task U10: 30일 스캔·실기기 게이트 (③c2 뒤)

**Files:**
- Modify: `docs/superpowers/phase1/gates.md` (행 `UNS-device`)

**Interfaces:**
- Consumes: U5 `unsub-stats.ts --enqueue-scan`, 배포된 워커 스캔 핸들러, TestFlight 0.10.0.

**실기기가 필요한 이유:** 실사용자 Gmail 광고 메일로 만든 목록이 사용자가 아는 광고 발신자와 맞는지(거래 전용 발신자가 섞이지 않는지)와, 실제 발신자 서버로 해지 요청이 접수되는지는 사용자 계정·판단이 있어야 한다. 화면 동작 자체는 U9가 시뮬레이터로 닫았다 — 여기서는 사용자 조작을 **목록 확인 1회 + 해지 1건**으로 줄인다.

- [ ] **Step 1: 선행 확인**

`docs/superpowers/phase1/gates.md`에 ③c2(PoC-6 마감) 행이 기록돼 있는지 확인한다. 없으면 멈춘다.

- [ ] **Step 2: 30일 스캔**

Run: `deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/unsub-stats.ts --enqueue-scan`
Expected: `{"enqueued":1}` 뒤 집계 한 줄.

10분 간격으로(최대 1시간) 다시 실행해 `jobs`에 `gmail-unsub-scan:done`이 있고 `gmail-unsub-fetch`가 모두 `done`(dead 0)인지 본다. dead가 있으면 `jobs.last_error` 코드만 조회해 적는다.

Run: `deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/unsub-stats.ts`
Expected: `senders_with_ads_30d ≥ 1`, `ads_30d ≥ 1`. `method_of_senders_with_ads`(예: `{"one_click": a, "link_only": b, "mailto": c, "unverified": d, "none": e}`)를 기록한다 — 주소 없음.

- [ ] **Step 3: 사용자 확인 D1 (목록)**

사용자에게: "TestFlight 0.10.0 설치 뒤 설정 → Gmail → 광고 메일 구독 해지를 열어 주세요. (a) 위 다섯 발신자가 실제로 광고를 보내는 곳인가요? (b) 주문·배송·결제만 보내는 곳(광고 없이)이 목록에 있나요?" — 답은 예/아니오와 개수만 받는다. 발신자 이름은 기록하지 않는다.

통과: (a) 예, (b) 0곳. (b)가 1곳 이상이면 그 행의 상태 문구와 광고 수만 받아(이름 없이) 실패로 적고, 원인(게이트 promo 오판인지 규칙 광고 표기인지)을 조사하는 태스크를 만든다.

- [ ] **Step 4: 사용자 확인 D2 (해지 1건)**

사용자에게: "[해지] 버튼이 있는 발신자 중 정말 끊고 싶은 곳 하나를 골라 [해지] → 확인창 [해지 요청]을 눌러 주세요. 화면 위 결과 문구를 알려 주세요."

Run: `deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/unsub-stats.ts`
Expected: `status.requested`가 1 늘고 `result_codes`에 `ok` 또는 `ok_redirect`. 결과 문구가 "해지 요청 실패 (<code>)"면 그 코드를 적는다 — `http_4xx`·`timeout`은 발신자 쪽 문제일 수 있으므로 사용자가 원하면 다른 발신자 1곳으로 한 번 더 한다.

통과: 1건 이상 `requested`.

- [ ] **Step 5: 관찰 (게이트 아님)**

요청 4일 뒤(3일 유예 + 1일) 한 번 `unsub-stats.ts`를 돌려, 요청한 발신자의 상태가 화면에서 "해지 요청함"인지(광고가 멈춤) "해지 요청 뒤에도 광고 N통"인지 사용자에게 묻고 비고에 적는다. 원클릭 지원 비율(`one_click` / 광고 발신자 수)이 20% 미만이면 스펙 §16 소절 "남은 것"에 따라 "웹 페이지 열기" 후속 후보를 메인이 사용자에게 묻도록 보고에 적는다.

- [ ] **Step 6: 기록·커밋**

```
| UNS-device | 0.10.0 실기기: 30일 스캔 잡 done·dead 0 → D1 목록이 실제 광고 발신자이고 거래 전용 발신자 0곳(사용자 확인) · D2 사용자가 고른 발신자 1곳 해지 요청 접수(ok/ok_redirect) | 통과 | <KST>. 스캔 jobs <집계>. unsub-stats senders_with_ads_30d <n>·ads_30d <n>·방법 <JSON>(주소 없음). D1 (a) 예 (b) 0곳. D2 result <code>. 관찰(+4일): <요청한 곳 광고 멈춤|계속 N통>. 원클릭 비율 <x>% | | <날짜> |
```

```bash
git add docs/superpowers/phase1/gates.md
git commit -m "docs(gates): UNS-device — 30-day unsubscribe scan done, real list confirmed by the user (no transactional-only senders), one user-chosen sender unsubscribed (ok); method mix recorded without addresses

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## 자체 점검 (계획 작성 뒤, 2026-10-01)

- **사용자 결정 대조:** UD1 — 헤더 기반(U1)·광고만(D2·U3 `unsub_ad_mail`)·발신자별 30일 수(U3 `unsub_list`)·[해지](U7·U8)·고른 발신자만(U5 sender 하나, U8 확인창)·원클릭 POST(U2)·자동 해지 없음(요청 경로는 Edge 호출뿐, cron·워커에 POST 없음)·거래 메일 영향 없음(Review Focus 1)·`gmail.readonly` 그대로(Global Constraints, `getMessageMeta`는 readonly 범위). 확인 항목: 헤더 보존 범위·§12(D1, U0 Step 6) · mailto(D3) · 보안(D4, U2) · 결과 기록·재표시 억제(D5, U3) · UI 위치(D6) · 버전 충돌(D8, U0 Step 5·8, U8 Step 1). UD2 — U0 Step 6 §15 확장 후보(재동의 ③c2 뒤·restricted 범위·확인 필수·휴지통만·되돌리기) + ERURI 보관함 한 줄(F18).
- **스펙 대조:** U0 §7 소절의 문장마다 구현 위치 — 광고 판정(a)(b) → U4 `gmailFetch`·U3 `unsub_ad_mail`, 기록 필드 → U3 `worker_record_unsub`, fail-open → U4 `recordUnsub`, 도착 경로(최대 6시간) → U6 Step 5, 30일 스캔 → U3 `gmail_enqueue_unsub_scan`·U4 스캔 핸들러·U10, 방법 판정·2,048자 → U1, 해지 요청 순서·안전 POST → U2·U5, 결과·유예·5회·busy·stale → U3·U7, 보관 35/180일 → U3 `purge_unsub`·cron, cascade → U3 FK·테스트, 화면 → U8.
- **이름 일치:** `unsubMeta`·`hasListUnsub`·`isAdMail`(U1 → U4), `oneClickPost`·`resolverKind`(U2 → U5), `worker_record_unsub` 인자 9개(U3 ↔ U4 `recordUnsub` ↔ U5 도구), `unsub_list` 열 11개(U3 ↔ U7 `Row` ↔ U5 smoke `method:status`), `unsub_begin` 반환 `{result, url_enc}`(U3 ↔ U5 `UnsubDeps.begin`), 결과 코드 `ok`·`ok_redirect`(U2 ↔ U3 `unsub_finish` ↔ U5), 잡 payload `lease_key`·`msgs`(U3 ↔ U4), 식별자 `unsub-*`(U8 ↔ U9).
- **자리표시자:** 코드 단계는 모두 실제 코드. `<KST>`·`<sha>` 같은 꺾쇠는 gates.md에 실행 때 채우는 실측값 칸이다.
- **알려진 한계(계획에 적음):** 게이트 `promo` 판정된 메일 중 `List-Unsubscribe`가 없는 것은 실시간으로는 기록되지 않는다(스캔은 잡는다) — 어차피 버튼이 없는 행이라 수용. DNS 재바인딩 잔여 위험(D4). 재연결 뒤 스캔 자동 재실행 없음(§7 문장).
