# ERURI 0.10.0 Gmail 광고 구독 해지 제안 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## 태스크 ID 표 (2026-10-02 리뷰 반영판)

| ID | 태스크 | 선행 | 시점·Gmail 측정 창 | 게이트 행 |
|---|---|---|---|---|
| U0 | 전제 확인(Step 0: 광고 메일이 history로 오는지 로그 개수) + 스펙 §2·§7·§8·§11·§12·§15·§16 + 보관 계획 R-B9 0.11.0 | 이 계획 커밋 | 무관 | — |
| U1 | 헤더 해석 — DKIM 서명을 AR의 selector·`b=` 앞부분으로 특정, 해지 헤더·https URI 각 1개 | U0 | 무관(로컬) | — |
| U2 | 안전 POST — 요청 1회·3xx는 `redirect_<n>` 실패, DoH 폴백, IPv6 허용 목록식 | U0 | 무관(로컬) | — |
| U3 | 마이그레이션 — 방법·URL은 메일 행, `unsub_best`, `unsub_list` left join·`can_request`, `unsub_stats`, lease `backfill:<user>` · DB 테스트 · `db push` | U1 | **push·DB 테스트는 창 밖** | — |
| U4 | 워커 — `recordUnsub` 2초 예산 + 잡 로컬 차단기, 스캔 기록 실패는 잡 실패, 재동기화 때 공백 구간 스캔, 일일 8일 공백 스캔 cron `0029`(파일만) | U1·U3 | 단위 테스트 + 0029 트랜잭션 적용·롤백 DB 테스트 | — |
| U5 | Edge `unsubscribe`(2xx만 접수, sink 키) + 스모크·시드·집계 도구 | U2·U3 | 단위 테스트만 | — |
| U6a | `unsubscribe` 함수만 배포 + `smoke-unsub` | U3 적용·U5 | **창 밖이면 언제든**(워커 안 건드림) | `UNS-server` 대기 |
| U7 | EruriCore `Unsubscribe`(`can_request`) | U3 계약 | 무관 | — |
| U8 | 앱 화면·0.10.0 | U7 | 무관 | — |
| U9 | 시뮬레이터 게이트(TestFlight 없음) | U6a·U8 | **창 밖** | `UNS-sim` |
| U6b | 워커 배포(SHARE 변경은 10-04 선배포됨 — `SHARE-deploy`) → 30일 스캔 → **원클릭 비율 판정(N1)** → TestFlight **0.11.0 한 빌드**(0.10.0 단독 빌드 없음, D12) | U9 + **③c2 완료 기록**(10-08 15:00 KST 이후) | ③c2 뒤 | `UNS-server` 통과 |
| U10 | `UNS-real` — 사용자 목록 확인 + 해지 1건 (한 번의 요청) | U6b 판정 통과 + TestFlight 0.11.0 VALID(같은 빌드, D12) | ③c2 뒤 | `UNS-real` |

순서: U0 → U1·U2 → U3 → U4·U5·U7 → U6a → U8 → U9 → [③c2 완료 기록] → U6b → U10. 측정 기간에 할 수 있는 것은 U0~U5·U7·U8 코드, U3 `db push`(창 밖), U6a, U9까지다. 워커 배포·스캔·TestFlight·사용자 확인은 ③c2 뒤로 모은다(리뷰 반영 H4).

**Goal:** Gmail 광고 메일을 보내는 발신자별로 "최근 30일 광고 N통"과 [해지] 버튼을 설정 화면에 보이고, **사용자가 고른 발신자에게만** RFC 8058 원클릭 해지 요청(POST)을 서버가 보낸다. 자동 해지 없음. Gmail 권한은 `gmail.readonly` 그대로(재동의·스코프 변경 없음). 서버(마이그레이션 + `gmail-fetch` 헤더 기록 + 30일 스캔 잡 + Edge `unsubscribe`) + 앱 0.10.0.

**Architecture:** 광고 메일은 지금 본문 없이 버려진다(규칙 `promotion` 폐기는 행조차 없음, 게이트 `promo` 폐기는 items 행만). 그래서 `gmail-fetch`가 폐기 판정과 같은 자리에서 **헤더 메타만** 남긴다 — 발신자(From 주소·표시 이름)는 `unsub_senders`, 메일 1통(Gmail 메시지 키·수신 시각·해지 방법·사용자 키로 암호화한 해지 URL)은 `unsub_mail`. 저장된 메일 중 `List-Unsubscribe`가 있는 것은 `item_id`로 연결해 두고, 게이트가 그 항목을 `promo`로 폐기했을 때만 광고로 센다. **해지 URL은 광고로 세는 메일 행에서만 고른다**(`unsub_best` — 같은 From의 거래 메일 URL로 POST하지 않는다). 지난 30일분은 ③c2 뒤 워커 배포와 함께 1회 스캔 잡(`format=metadata`, 백필 레인)이 채우고, 재동기화(history 404) 때는 그 공백 구간만 다시 스캔한다. 해지는 Edge `unsubscribe`가 `unsub_begin`(행 잠금·방법 확인·복호화 감사) → URL 복호화 → SSRF 방어 POST 1회(`_shared/safe-post.ts`, 3xx는 따라가지 않고 실패) → `unsub_finish` 순으로 보낸다. Gmail `Authentication-Results`의 `dkim=pass`가 selector·서명값으로 특정한 `DKIM-Signature` 하나가 해지 헤더 두 개(각 1개)를 덮을 때만 원클릭으로 본다. 앱은 `unsub_list()` RPC(URL 제외)만 읽는다.

**Tech Stack:** Supabase(Postgres 마이그레이션, Edge Functions Deno/TS, `deno test`), Gmail API(`messages.get format=metadata`, readonly), WebCrypto AES-256-GCM(`_shared/crypto.ts`), `Deno.resolveDns`/DNS-over-HTTPS, SwiftUI iOS 26 앱 `Eruri` + Swift Package `EruriCore`(XCTest), xcodegen `ios/project.yml`, XCUITest(게이트 전용 임시 타깃), TestFlight(`ios/scripts/testflight.sh`).

**Spec:** `docs/superpowers/specs/2026-09-22-assistant-design.md` — U0이 §2(결정 표)·§7(Gmail 동기화 뒤 새 소절 "광고 구독 해지")·§8(표 2개·삭제 표)·§11(버전)·§12(통제 1~5)·§15(1단계 추가 범위·확장 후보 "사용자 지시 메일 정리")·§16(새 소절)을 먼저 고친다. 입력: 사용자 결정(2026-10-01 저녁, 아래 "사용자 결정"). 실행 규칙은 `AGENTS.md` §3(모델)·§5-8(실측 게이트)·§6(기계)·§7(개인정보)·§8(버전).

**출발점:** main `9d245d7` 위. 서버 `0001`~`0027` 적용, 앱 0.9.2(`ios/project.yml:13`). Gmail 게이트 계획(`2026-09-30-phase1-gmail.md`)이 측정 중(T0 = 2026-10-01 14:53:11 KST, ③b3 판정 10-02, ③c1 ≈ 10-07, ③c2 ≈ 10-08 15시 이후). 보관 계획 트랙 B(R-B1~R-B9)는 ③c2 뒤 시작, 마이그레이션은 원장 Ruling M#대로 **다음 빈 번호**.

**태스크:** 맨 위 "태스크 ID 표". 원장 `.superpowers/sdd/2026-10-01-gmail-unsubscribe/progress.md`(상위 원장 `.superpowers/sdd/2026-09-30-phase1/progress.md`의 Rulings 승계).

## 사용자 결정 (2026-10-01 저녁, 이 계획의 원본)

| # | 결정 | 이 계획에서 |
|---|---|---|
| UD1 | **지금: 광고 구독 해지 제안.** 광고 메일(서버 규칙 `(광고)`·게이트로 폐기되는 것 포함)의 `List-Unsubscribe`/`List-Unsubscribe-Post`로 발신자별 "최근 30일 광고 N통"과 [해지]. 사용자가 고른 발신자만 원클릭 POST. 자동 해지 없음. 거래 메일 영향 없음. `gmail.readonly` 그대로 — 재동의·스코프 변경 금지 | U1~U10 전부 |
| UD2 | **나중: 사용자 지시 메일 정리**("이 발신자/이런 내용 메일 지워줘"). `gmail.modify` 재동의가 필요해 ③c2(10-08) 뒤 별도 계획. 이번에는 스펙 §15 확장 후보에 경과·제약만, ERURI 보관함 쪽 삭제 재사용 여부 한 줄 | U0 Step 6 |

## 계획이 정한 것 (사용자 결정이 열어 둔 항목)

| # | 항목 | 결정 | 이유 |
|---|---|---|---|
| D1 | 폐기 메일 헤더 보존 | 지금은 **어디에도 없다**(F3·F5). 새 표 `unsub_senders`(발신자별 — 주소·표시 이름·상태, **URL 없음**)·`unsub_mail`(광고 후보 1통 = 1행 — 메시지 키·수신 시각·해지 방법·암호화 URL)에 헤더 메타만 저장. 제목·본문 저장 없음. 해지 URL은 사용자 키 암호화, 주소·표시 이름은 `items.sender`와 같은 등급의 평문. `unsub_mail`(URL 포함) 35일(일일 정리라 최대 +1일), 발신자는 메일 행이 없고 마지막 수신 35일 뒤 삭제(해지 요청한 발신자는 주소·상태만 180일) | 30일 집계에 필요한 최소. URL은 받는 사람 식별 토큰·주소를 담는 경우가 많아 자격 증명처럼 다루고, 발신자 행 180일 보존에 끌려가지 않게 메일 행에 둔다(리뷰 H2·Codex 추가 판정) |
| D2 | 광고로 세는 메일 | 규칙 `promotion` 폐기(라벨·`(광고)` 표기) + 게이트 `promo` 폐기 항목(`items.status = 'discarded:server:promo'`). 사용자가 "복구"하면 광고에서 빠진다. **해지 방법·URL도 광고로 세는 메일에서만 고른다**(`unsub_best`: 그중 `one_click`이 있으면 가장 최근 `one_click`, 없으면 가장 최근 메일) | 거래 메일·뉴스레터를 광고로 오인하지 않게 판정이 이미 있는 것만. 같은 From의 더 최근 거래 메일 URL로 POST하지 않는다(리뷰 H2) |
| D3 | mailto·웹 링크만 있는 발신자 | **목록에 보이고 버튼 없이 사유 표시**("메일 회신 방식 — 앱에서 해지할 수 없어요"). 제외하지 않는다 | 누가 많이 보내는지는 알려 주고, mailto 발송은 `gmail.send` 재동의, 링크 열기는 GET 페이지 조작이라 원클릭이 아님 |
| D4 | 해지 요청 보안 | https만·443·userinfo 금지·로컬 호스트명 금지·DNS A/AAAA 전부 공인 주소(사설·루프백·링크로컬·CGNAT·멀티캐스트·문서용 IPv4, IPv6는 `2000::/3` 안이고 6to4·NAT64 내장 사설·문서용·`2001::/23`이 아닐 때만)·전체 10초·**요청 1회, 3xx는 따라가지 않고 실패**(`redirect_<상태>`)·응답 본문 읽지 않음·쿠키/인증 헤더 없음. **DKIM 확인 실패면 보내지 않음**(`unverified`). DNS 재바인딩은 수용 위험(메인 판정 2026-10-02, 사용자 재검토 가능 — 스펙 §12 통제 3) | RFC 8058 §3(유효한 서명이 두 헤더를 덮어야 함)·§3.1(발신자 서버는 리다이렉트하지 않는다) + 위조 발신자가 임의 URL로 POST를 유도하지 못하게. 리다이렉트를 없애 SSRF 창을 첫 요청 하나로 줄인다(리뷰 H3·M1) |
| D5 | 결과 기록·재표시 억제 | 2xx → `requested`(요청 시각), 그 밖 → `failed`(코드). 요청 뒤 **3일 유예** 뒤에도 광고가 오면 "해지 요청 뒤에도 N통" + [다시 요청]. 같은 발신자 5회 한도(목록 `can_request`로 버튼을 숨김), 60초 안 재요청 `busy`, 60초 넘게 `requesting`이면 결과 없이 끝난 것으로 보고 다시 시도 가능 | 발신자가 처리하는 데 시간이 걸린다(Gmail 대량 발신 가이드 2일). 버튼 두 번 누름·Edge 중단 대비. 한도에 닿은 뒤 누를 수 없는 버튼을 보이지 않는다(리뷰 N5) |
| D6 | UI 위치 | **설정 "Gmail" 절 → "광고 메일 구독 해지" 화면 하나**. 채팅 카드·새 탭 기각 | 질문 응답이 아니라 관리 작업. 탭 4개 유지(스펙 §11) |
| D7 | 30일 과거분·공백 | ③c2 뒤 워커 배포(U6b) 직후 1회 `gmail-unsub-scan` 잡(목록 `newer_than:30d {category:promotions subject:광고} -in:drafts` + 게이트 promo 항목 id → 50개씩 `gmail-unsub-fetch`, `format=metadata`, 백필 레인 lease `backfill:<user>`). 재동기화(history 404 — 드문 경우) 때는 `gmailSync`가 같은 구간(`after:<마지막 성공 − 1일>`)의 스캔 잡을 넣는다(메인 결정 2026-10-02, 리뷰 N4). 주간 재인증 공백(재연결은 history 유지)과 실시간 기록 누락은 일 1회 8일 공백 스캔 cron(`0029`, U6b에서 워커 배포 뒤 적용)이 메운다(U4 리뷰 I2) | 배포 즉시 의미 있는 숫자. 측정 기간 실사용자 `jobs` 수정 금지. 백필 lease는 기존 연결 백필(`gmail-connect`의 `backfill:<user>`)과 같아 실시간 sync를 막지 않고 계정 Gmail 호출이 직렬이 된다(리뷰 M3) |
| D8 | 버전 | **이 기능 = 0.10.0**, 보관 계획 R-B9(요약·저장 공간)는 **0.11.0**으로 밀린다(U0이 스펙 §11·§15·보관 계획을 고친다). 실행 때 `git log --oneline -- ios/project.yml`로 0.10.0이 이미 main에 있으면(R-B9가 먼저 들어감) 이 기능이 다음 빈 마이너를 쓰고 스펙·두 계획을 같은 커밋에서 맞춘다 | 이 기능의 앱은 서버 DDL만 있으면 되고 ③c2를 기다리지 않아 R-B9보다 먼저 나간다 |
| D9 | 해지 요청 주체 | 서버(Edge). 기기 직접 POST 기각 | 기기로 URL을 내려야 하고 사용자 IP가 발신자에게 간다 |
| D10 | 배포 분할 | **U6a**(`unsubscribe` 함수만 — 측정 창 밖이면 언제든) / **U6b**(워커·30일 스캔 — ③c2 완료 기록 뒤, 10-08 15:00 KST 이후) | 워커 재배포는 잡 처리 시간을 바꿔 7일 측정에 영향을 줄 수 있고, 일찍 배포해 얻는 것은 본문에만 `(광고)`가 있는 메일 며칠치뿐이다(30일 스캔이 나머지를 채움). 기능 스위치·지연 회귀 테스트보다 배포 순서로 푼다(리뷰 H4) |
| D11 | 원클릭 지원 비율 판정 | U6b 30일 스캔 직후·TestFlight 전에 `unsub_stats`의 방법 분포를 본다. 광고 발신자 중 `one_click` 0곳이면 멈추고 `UNS-real`을 "실패(대안 채택)" 후보로, 메인이 사용자에게 `link_only` "웹 페이지 열기"를 묻는다. 1곳 이상이면 TestFlight(0.11.0 — D12) → U10 | 국내 광고 발신자는 원클릭 헤더가 없는 곳이 많을 수 있다. 다 만든 뒤가 아니라 공개 전에 실현 가능성을 판정한다(AGENTS.md §5-6, 리뷰 N1) |
| D12 | 공개 빌드(2026-10-03 메인 판정, 링크 계획 최종 리뷰 F-I1 (B)) | **0.10.0을 따로 TestFlight에 올리지 않는다.** main이 이미 0.11.0(링크·이미지 → 일정 계획, `e0dcbcd`)이라 U6b는 원클릭 판정(D11) 통과 뒤 main HEAD에서 **0.11.0 한 빌드**를 올리고, U10(`UNS-real`)과 링크 계획 L9(`LNK-device`)가 같은 빌드를 쓴다(한 사용자 세션으로 묶어도 된다). 판정이 멈추면(원클릭 0곳) 0.11.0도 올리지 않는다 | 사용자 1명(본인) TestFlight라 0.10.0 단독 빌드(별도 worktree)의 이득이 작고 서명·생성 경로를 한 번 더 검증해야 한다. 0.11.0이 `LNK-device` 전에 사용자 기기에 설치되는 것은 수용(원장 Ruling F-I1) |

## Global Constraints

- **스펙 먼저(AGENTS.md §1):** U0 커밋 전에는 코드 태스크를 시작하지 않는다. 계획과 스펙 문구가 다르면 스펙이 원본이다.
- **Gmail 권한:** `GMAIL_READONLY_SCOPE` 그대로. `gmail-connect`·OAuth 동의 화면·`GOOGLE_*` 설정을 바꾸지 않는다. 앱의 "다시 연결 (동의 다시 받기)"을 누르게 하지 않는다.
- **버전(AGENTS.md §8):** `MARKETING_VERSION: 0.10.0`(U8, D8 확인 후). **TestFlight는 0.10.0이 아니라 U6b 판정 통과 뒤 0.11.0 한 빌드**(D12 — main이 이미 0.11.0). 빌드 번호는 `testflight.sh` 기본값(`date +%Y%m%d%H%M`). 메이저 금지.
- **서버 변경 범위:** 마이그레이션 1개(`0028_unsubscribe.sql` — 실행 때 다음 빈 번호, 새 표·함수·cron만, **기존 표·함수·행을 바꾸지 않는다**) + `_shared/rules.ts`(`AD_MARK` export 한 단어) + `_shared/gmail.ts`(`getMessageMeta`) + `_shared/unsub.ts`(신규) + `_shared/safe-post.ts`(신규) + `_shared/gmail-jobs.ts`(`recordUnsub`·`enqueueUnsubRescan`·`gmailUnsubScan`·`gmailUnsubFetch`, `gmailFetch` 두 분기, `gmailSync` 재동기화 훅 한 줄, `GmailJobDeps` 선택 필드 2개) + `worker/index.ts`(핸들러 2개) + `functions/unsubscribe/`(신규) + `config.toml`(`[functions.unsubscribe] verify_jwt = false`).
- **Gmail 수집 회귀 금지:** `gmailFetch`의 기록 호출은 **fail-open**(`recordUnsub`가 throw하지 않고, RPC·암호화가 **2초**를 넘으면 기다리지 않고 `"error"` — 리뷰 H4). 재동기화 스캔 잡 넣기도 실패를 삼킨다. 기존 `supabase/tests/gmail.test.ts` 전부 통과(단언 수정 없이)가 U4의 완료 조건이다. 기존 테스트의 `fakeDeps`가 `GmailClient`에 생긴 `getMessageMeta`를 갖도록 기본값 한 줄을 더한다(타입 확인). 새 `GmailJobDeps` 필드(`onResync`·`unsubBudgetMs`)는 선택이라 기존 가짜 deps는 그대로다.
- **Gmail 측정 창(Gmail 계획 Global Constraints "측정 기간 금지"):** 아래 동작은 창 밖에서만 — `db push`(U3), `unsubscribe` 함수 배포(U6a), 서버 스모크(U3·U5·U6a, 테스트 사용자), 시뮬레이터 게이트(U9). 창:
  - ③b3 세션 진행 중(메인이 `.superpowers/sdd/2026-09-30-phase1-gmail/progress.md`·`docs/superpowers/phase1/gates.md`로 확인)
  - ③c1: **10-07(수) 14:30 ~ 16:30 KST**
  - ③c2: **10-08(목) 14:30 KST ~ ③c2 완료 기록**(10-09까지 갈 수 있다)
  - 정확한 시각은 메인이 원장의 마지막 `status.t0`로 다시 계산한다. 못 맞추면 그 단계를 미룬다.
  - **워커 재배포는 ③c2 완료 기록 뒤에만 한다(U6b).** 잡 처리 시간이 바뀌면 측정(지연·재시도·후속 저장)에 영향을 줄 수 있다(리뷰 H4). 0028(새 표·함수)과 `unsubscribe` 함수는 워커를 바꾸지 않으므로 창 밖이면 측정 기간에도 된다.
  - **실사용자 행:** 이 계획은 실사용자 `items`·`jobs`·`connections`를 직접 고치지 않는다. 실사용자의 `gmail-unsub-scan` 잡 넣기·TestFlight·실기기 게이트는 **③c2 완료 기록 뒤**(U6b·U10).
  - 새 잡 종류 `gmail-unsub-fetch`는 Gmail 게이트의 `gap --from-jobs`(백필 `gmail-fetch` 잡의 `payload.ids` ↔ items)에 섞이지 않는다 — 종류가 다르고 payload 키도 `msgs`다.
- **M2 검색 평가 ⑩b:** 이 계획은 chat·검색 함수를 바꾸지 않는다. ⑩b **실행 중이면** U6b 워커 재배포만 그 뒤로 미룬다(배포가 진행 중인 워커 호출을 끊을 수 있다).
- **개인정보(AGENTS.md §7, 스펙 §12):** 로그·진단·게이트 기록에는 결과 코드·개수·id만. **발신자 주소·이름·해지 URL·도메인을 로그·`gates.md`·보고에 쓰지 않는다**(실사용자 기록은 `unsub_stats`의 집계만). 테스트·시드는 합성 헤더(`example.com`·`example.net`·`합성` 표기), 실제 메일 헤더·주소를 픽스처에 넣지 않는다. `items.content_enc`·`unsub_mail.url_enc` 복호화 조회 금지(실사용자). 사용자가 앱 화면에서 자기 목록을 보는 것은 제품 기능이다.
- **기계(AGENTS.md §6):** `deno test`·빌드·시뮬레이터 전 `vm_stat | grep -E 'free|compressor'`. 시뮬레이터 빌드와 deno 테스트를 동시에 돌리지 않는다(`pgrep -x deno`가 비었을 때만 시뮬레이터, `pgrep -x xcodebuild`가 비었을 때만 deno). 시뮬레이터는 pane 전용 UDID.
- **테스트 명령:** 서버 `deno test --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/tests/<파일>`(저장소 루트), 타입 확인 `deno check supabase/functions/worker/index.ts supabase/functions/unsubscribe/index.ts supabase/scripts/*.ts`. 앱 `cd ios && ./scripts/sim.sh gen && ./scripts/sim.sh test EruriCoreTests/<클래스>`, 빌드 `cd ios && ./scripts/sim.sh build`.
- **호스팅 DB 테스트(AGENTS.md §7):** 전용 테스트 사용자(`tests/_testenv.ts` `testUser(n)`)·실행 태그(`RUN`)만, 자기 행만 지운다.
  - U3 DB 테스트(사용자 1 공유): 연결은 `status = 'active'`, `account_ref = '<RUN>-<난수>@example.com'`(`insert_item(GMAIL)`은 disconnected가 아닌 Gmail 연결이 있어야 항목을 만든다 — 0013, 선례 `gmail-gate-db.test.ts:21`). refresh token이 없어 cron이 sync를 넣어도 `skipped`다. 정리 때 `payload->>connection_id`가 그 연결인 잡도 지운다(자기 연결의 잡). 주소에 실행 태그(`-<tag>@`)를 넣고 `unsub_list` 결과·audit(`target like 'unsub:<자기 sender id>%'`)를 그 범위로만 읽고 지운다(리뷰 M4·M5·N2).
  - 스모크(`smoke-unsub`)는 **사용자 11**, 시뮬레이터 시드·게이트는 **사용자 12**를 쓴다(다른 테스트가 1·2·7·9를 쓴다 — 구현 때 `grep -rhoE 'userClient\([0-9]+\)|testUser(Id)?\([0-9]+\)' supabase/tests supabase/scripts .context`로 비었는지 다시 본다). 이 둘의 연결은 `disconnected`(항목을 만들지 않는다).
  - `purge_unsub`는 반드시 `p_user` 인자로 부른다. 앱 세션이 살아 있어야 하는 게이트 시드는 비밀번호를 바꾸지 않는 `testUserId(n)`만 쓴다.
- **`db push`:** push 직전 `git status --short supabase/migrations`·`ls supabase/migrations | tail -3`으로 **이 태스크 파일 하나만** 새 파일인지 확인하고 `supabase db push --dry-run`을 먼저 본다. 적용된 마이그레이션은 고치지 않는다.
- **모델(AGENTS.md §3):** U0 `opus`/`high`. U1~U5·U7·U8 구현·리뷰 `opus`/`high`(보안 판단 포함). U6a 배포·스모크 `opus`/`medium`. U6b 배포·스캔·방법 분포 판정 `opus`/`medium`. U9 시뮬레이터 게이트 `opus`/`medium`. U10 사용자 확인 세션(대기 위주) `sonnet`/`medium`, 판정·기록이 섞이면 `opus`/`medium`.
- **기록:** `docs/superpowers/phase1/gates.md`에 행 `UNS-server`(U6a 대기 → U6b 통과)·`UNS-sim`(U9)·`UNS-real`(U10). 상태는 통과·실패·대기만("부분"은 마감 아님, AGENTS.md §5-8). 커밋 칸은 비우고 메인이 채운다.
- **커밋:** 태스크마다, 트레일러 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. **push 금지**(메인이 회수 후 `git push origin main`).

## 이 계획이 기대는 사실 (코드에서 확인, 2026-10-01)

| # | 사실 | 출처 |
|---|---|---|
| F1 | watch는 `labelFilterBehavior: "EXCLUDE", labelIds: ["CATEGORY_PROMOTIONS"]` — 광고 메일만으로는 Pub/Sub 푸시가 오지 않는다 | `_shared/gmail.ts` `watch` |
| F2 | `history()`는 `labelId` 없이 `historyTypes=messageAdded`만 준다 → 다음 sync(다른 메일 푸시 또는 6시간 cron `gmail-sync-every-6h`)에 광고 메일 id도 `gmail-fetch`로 온다. 백필·404 재동기화 목록은 `-category:promotions -in:drafts`라 광고를 가져오지 않는다. **코드 추론** — U0 Step 0이 워커 로그의 `gmail_discard: promotion` 개수로 확인한다 | `_shared/gmail.ts` `history`·`resync`, 스펙 §7 Gmail 동기화 |
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
| F19 | `collectNewMessageIds`는 history 404면 `resync`(목록 `after:<last_success_at − 1일> -category:promotions -in:drafts`, `mode: "resync"`)로 넘어간다 → 그 구간 광고 메일 id는 `gmail-fetch`로 오지 않는다(연결이 active인 채 sync가 history 보존 기간 넘게 멈춘 드문 경우. **주간 재인증 공백은 여기 해당하지 않는다** — 재연결 `gmail_save_connection`(`0001_baseline.sql:247`)이 커서를 새 historyId로 덮어 history 모드가 유지되고, 재연결 백필은 `-category:promotions`라 그 공백의 광고는 일일 공백 스캔 `0029`가 메운다 — U4 리뷰 I2). `gmailSync`는 `gmail_state`의 `last_success_at`을 읽은 뒤 `r.mode`를 돌려준다 | `_shared/gmail.ts:144-169`, `_shared/gmail-jobs.ts:53-68` |
| F20 | 연결 시 90일 백필 fetch 잡의 lease는 `backfill:<user>`(사용자당 1개 실행 — `jobs_one_running_per_key`) | `gmail-connect/handler.ts:89`, `0001_baseline.sql` `jobs_one_running_per_key` |
| F21 | `insert_item(GMAIL)`은 `status <> 'disconnected'`인 사용자 Gmail 연결이 없으면 null(항목 없음). 테스트 선례는 `status: "active"` + 실행 태그 `account_ref` | `0013_source_delete_lock.sql:14-16`, `tests/gmail-gate-db.test.ts:21` |
| F22 | 기존 `gmail.test.ts`의 `fakeDeps`는 `GmailJobDeps` 객체를 직접 만든다(기본값 펼침 없음) → 선택 필드를 더해도 기존 가짜 deps에는 들어가지 않는다. resync 테스트는 `enqueue_job` 호출 순서를 정확히 단언한다 | `tests/gmail.test.ts:110-126,129-144` |
| F23 | 0.9.0 시뮬레이터 하네스 원본은 `ios/`에서 지워졌다. 사본은 `.context/sim-gate-090-shots/{project.gate090.yml.txt, GateHost.swift.txt, Gate.swift.txt}`, 도구는 `.context/gate090/{token.ts, drive.sh}`(`drive.sh`는 번들 `com.picpal.eruri`·`.context/gate090/udid` 하드코딩). 순서 선례: token.ts(새 테스트 사용자 + 로그인 1회) → 시드(`testUserId`) → Host 주입 | `.context/sim-gate-090.report.md:4-6` |

## Review Focus

1. **같은 주소로 광고와 거래 메일을 보내는 발신자**(쇼핑몰이 같은 From으로 주문 확인·세일 안내). 사람은 "30일 광고 N통"에 주문 확인이 섞이지 않고, 해지가 주문 메일을 끊지 않길 기대한다 → 광고 판정 메일만 센다: 게이트를 통과한 거래 메일(`extracted`)은 `item_id`로 기록돼도 세지 않는다(U3 `unsub_list counts rule ads and gate-promo items only`). **해지 URL도 광고 판정 메일에서만 고른다** — 광고 A 뒤에 더 최근 거래 메일 B가 와도 요청은 A의 URL로 간다(U3 `H2: a newer non-ad mail never supplies the URL`). 확인창에 "거래 메일은 계속 올 수 있습니다(발신자 정책)"(U7 `testConfirmCopy`).
2. **위조 발신자·악성 해지 URL**: From을 유명 쇼핑몰로 꾸미고 해지 URL을 내부 주소(`https://10.0.0.1/`, 사설로 풀리는 호스트명, 공인 → 307 → 사설)로 둔 메일, 또는 같은 도메인의 무효 서명을 하나 더 붙여 `h=`에 해지 헤더를 적은 메일. 사람은 그런 요청이 나가지 않길 기대한다 → DKIM 확인은 Gmail AR이 특정한 서명 하나로만(U1 `dkim: signature pinned by selector and b= prefix`), 실패면 `unverified`(버튼 없음, U7·U9 G8), 리다이렉트는 따라가지 않는다(U2 `every 3xx is one request`), 주소 검사(U2 `ipBlocked table`), 스모크에서 사설 IP 실제 차단(U5 `smoke-unsub` `blocked_private`). DNS 재바인딩은 수용 위험(D4).
3. **버튼을 두 번 누르거나 요청 중 앱·Edge가 끊긴다**. 사람은 요청이 한 번만 가고, 결과를 모르면 다시 시도할 수 있길 기대한다 → 60초 안 재요청 `busy`, 60초 넘은 `requesting`은 다시 시작 가능, 앱은 60초 넘은 `requesting`을 `failed("timeout")`("응답이 없어요. 잠시 뒤 다시 시도해 주세요") + [다시 시도]로 보인다(U3 `begin: busy within 60s, stale requesting restarts`, U7 `testStaleRequestingIsRetryable`).
4. **해지했는데 광고가 계속 온다**. 사람은 며칠 기다린 뒤에도 오면 알 수 있고 다시 요청할 수 있길 기대한다 → 요청 시각 + 3일 뒤 광고 수 `ads_after_request` → "해지 요청 뒤에도 광고 N통" + [다시 요청], 3일 안 광고는 세지 않는다(U3 `requested sender: ads after the 3-day grace reopen the request`, U7 `testStates`).
5. **기록이 Gmail 수집을 깨뜨린다**: `worker_record_unsub` 오류·연결 삭제 경합·이상한 헤더(From 없음, 2,048자 넘는 URL, 깨진 `Authentication-Results`)로 `gmail-fetch` 잡이 실패하면 백오프·dead로 **거래 메일까지 유실**된다(Gmail 게이트 "누락 0"). 사람은 광고 기능 때문에 메일 수집이 멈추지 않길 기대한다 → `recordUnsub`는 throw하지 않고 2초를 넘기면 기다리지 않는다(U4 `gmail-fetch: unsub record failure never fails the fetch`·`a hanging record RPC does not hold the fetch`), 해석 함수는 어떤 입력에도 throw하지 않고 null·`none`을 낸다(U1 `unsubMeta never throws on malformed headers`). 워커 배포 자체는 ③c2 뒤(D10).
6. **같은 메일이 두 번 들어온다**(sync 뒤 30일 스캔이 같은 메일을 다시 읽음, 재시도). 사람은 숫자가 부풀지 않길 기대한다 → `unsub_mail` pk `(user_id, msg_key)`, 두 번째 기록은 `item_id`만 보충(U3 `same message twice counts once`).
7. **30일 스캔이 일부만 기록하고 끝난다**(DB·암호화 일시 장애). 사람은 "스캔 완료"가 정말 다 읽었다는 뜻이길 기대한다 → 스캔 fetch는 기록 실패면 잡을 실패시켜 재시도한다(U4 `gmail-unsub-fetch: a record error fails the job for retry`), U6b 완료 조건은 잡 dead 0.
8. **해지 요청한 발신자의 광고가 끊겨 메일 행이 정리됐다**. 사람은 "해지 요청함"이 목록에서 사라지지 않길 기대한다 → 목록은 발신자 기준 left join(U3 `requested sender stays listed after its ad rows are purged`).

## 리뷰 반영 (Codex gpt-6-astra · Fable, 2026-10-02)

입력: Codex `.context/codex-review-unsub.out.md`(HIGH 4·MED 8·LOW 1), Fable `.context/fable-review-unsub-plan.md`(Codex 지적별 판정 + N1~N12). 충돌하면 Fable 판정을 따랐다. 사용자 미결 2건은 메인이 권장안으로 판정했다(2026-10-02, 사용자 재검토 가능).

| # | 지적 | 판정 | 반영 위치 |
|---|---|---|---|
| H1 | AR의 통과 서명과 `h=` 검사가 분리, 중복 해지 헤더 | 반영 | U1 `dkimCovers`(맨 위 AR이 `mx.google.com`, `dkim=pass`의 d·`header.s`·`header.b` 앞부분으로 `DKIM-Signature` 정확히 1개 특정, 그 `h=`만 봄), `unsubMeta`(두 헤더·https URI 각 1개) + Codex 재현 사례 테스트. From–서명 도메인 정렬은 RFC가 아닌 제품 정책으로 스펙에 명시 |
| H2 | 광고 버튼이 거래·뉴스레터 URL로 POST | 반영(구조 변경) | U3 방법·URL을 `unsub_mail`로, `unsub_best`가 광고로 세는 메일에서만 고름(`one_click` 우선 → 최신), 복구된 항목 제외. "목록과 확인 사이 URL 변경 재확인"은 **미반영** — 바뀐 URL도 같은 발신자의 광고 해지 주소이고 `unsub_begin`이 요청 시점에 다시 고른다(Fable) |
| H3 | DNS 검사와 연결 분리(재바인딩) | **수용 위험**(MED로 하향) | 메인 판정 2026-10-02(사용자 재검토 가능): 리다이렉트 제거로 창을 첫 요청 하나로, 스펙 §12 통제 3에 근거 3줄(U0 Step 6), D4. IP 고정 연결·egress 경계는 미반영(Edge `fetch`에 수단이 없다고 봄 — 미확인) |
| H4 | fail-open이 지연·벽시계는 못 막음, 측정 독립성 근거 부족 | 반영(배포 순서 + 예산) | D10·U6a/U6b 분할(워커는 ③c2 뒤), `recordUnsub` 2초 예산 + 끝나지 않는 RPC 테스트. 기능 스위치·지연 회귀 기준은 미반영(배포 순서로 대체) |
| M1 | 3xx 접수 처리·재POST | 반영 | U2 요청 1회, 3xx는 `redirect_<n>` 실패, U3 `unsub_finish`는 `ok`만 접수, U5 smoke·U9 G3 기대 반전, U10 통과 기준 `ok` |
| M2 | 스캔 기록 실패가 done으로 숨음 | 반영 | U4 `gmailUnsubFetch`는 기록 `"error"`면 throw(잡 재시도, 기록 멱등), U6b 완료 조건 dead 0 |
| M3 | 스캔 lease가 sync와 같음, 쿼터 | 부분 반영 | lease `backfill:<user>`(F20, 기존 백필과 같은 레인 — 계정 Gmail 호출 직렬). 쿼터 단가는 U4 Step 0에서 공식 문서 1회 확인. 페이지 체크포인트·스캔 중 sync 지연 측정은 미반영(분리된 lease라 sync를 막지 않음) |
| M4 | disconnected 연결에서 GMAIL insert 불가 | 반영 | U3 테스트 연결 `active` + `assert(id)`(F21) |
| M5 | audit 정리가 실행 범위 밖 | 반영 | U3·U5 정리를 `target like 'unsub:<자기 sender id>%'`로 |
| M6 | inner join으로 요청 이력이 사라짐 | 반영 | U3 `unsub_list` 발신자 기준 left join + purge 뒤 테스트 |
| M7 | 스캔 판정 범위가 실시간과 다름 | 부분 반영 | 스펙 §7에 차이(본문 표기·OTP 제외 미적용)를 적고 수용. 화면 상태 표시(스캔 전·범위 제한·공백)는 미반영 — 스캔을 U6b 배포 직후 넣어 "스캔 전" 구간이 사용자에게 보이지 않는다(TestFlight가 스캔 뒤) |
| M8 | 집계가 PostgREST 응답 상한에 걸림 | 반영 | U3 `unsub_stats(p_user, p_jobs_since)` 서버 집계 RPC, U5 `unsub-stats.ts`가 그것만 호출·오류 전파. 1,000건 초과 fixture는 미반영(서버 집계라 행 상한이 없다) |
| L1 | "제목·본문 저장 안 함" 문구 범위 | 반영 | 스펙 §12 통제 2·U7 footer를 "구독 해지 기록에는"으로 한정, 보관 "+1일" 명시 |
| N1 | 원클릭 지원 비율을 맨 끝에야 잼 | 반영 | D11, U6b 판정 지점(스캔 직후·TestFlight 전) |
| N2 | 테스트 사용자 1 공유로 충돌 | 반영 | U3 실행 태그 주소·범위 비교, 스모크 사용자 11·시드 사용자 12 |
| N3 | 하네스 원본 경로 없음 | 반영 | F23, U9 Files·Step 1 |
| N4 | 재인증 공백 광고 누락 | **고친다**(메인 결정 2026-10-02) | U4 `onResync` 훅 → `enqueueUnsubRescan`(`after:`, 드문 404 재동기화) + 일 1회 8일 공백 스캔 cron `0029`(주간 재인증 — 재연결은 history 유지라 훅이 안 돎, U4 리뷰 I2), 스펙 §7 "도착 경로" |
| N5 | 5회 한도 뒤에도 버튼 | 반영 | U3 `can_request`, U7 `state()` |
| N6 | U9 게이트 구멍 | 반영 | G1 순서 단언, G3 리다이렉트 실패, G7 DB `attempts` 대조, G8 `unverified` |
| N7 | U10 판정 성립 조건·사용자 조작 분류 | 반영 | U10 → `UNS-real`, 선행 조건 U6b 판정, 한 번의 요청, "위 10곳" |
| N8 | Deno DNS가 던지면 DoH로 안 감 | 반영 | U2 `resolveWith` + 테스트 |
| N9 | 배포 스모크가 IP 리터럴뿐 | 반영(선택 사례) | U5 `smoke-unsub` `sslip` 사례 — 실패해도 게이트 판정에서 제외 |
| N10 | sink가 인증 없이 열림 | 반영 | U5 `UNSUB_SINK_KEY` 경로, 없으면 404 |
| N11 | IPv6 차단 열거식 | 반영 | U2 `v6Blocked` `2000::/3` 허용 목록식 |
| N12 | 고정 개수 기대, +6시간 질문 | 반영 | U4 "기존 전부", +6시간 확인은 U6b 스캔으로 대체 |
| F2 전제 | 프로모션 id가 history로 온다는 추론 | 반영 | U0 Step 0(로그 개수만) |

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
supabase/migrations/0028_unsubscribe.sql                       # U3 신규(다음 빈 번호): 표 2·RPC 10·cron 1
supabase/tests/unsub-db.test.ts                                # U3
supabase/functions/_shared/gmail.ts                            # U4 getMessageMeta·META_HEADERS
supabase/functions/_shared/gmail-jobs.ts                       # U4 recordUnsub·enqueueUnsubRescan·gmailUnsubScan·gmailUnsubFetch, gmailFetch 기록, gmailSync onResync
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
docs/superpowers/phase1/gates.md                               # U6a·U6b·U9·U10 행
```

## 실행 순서

| 순서 | 태스크 | 선행 | pane | Gmail 창·⑩b |
|---|---|---|---|---|
| 1 | U0 전제 확인·스펙·버전 | 이 계획 커밋 | 문서 | 무관 |
| 2 | U1 헤더 해석 | U0 | 서버 | 무관(로컬) |
| 3 | U2 안전 POST | U0 | 서버(U1과 다른 파일 — 병렬 가능) | 무관(로컬) |
| 4 | U3 마이그레이션 | U1 | 서버 | **`db push`·DB 테스트는 창 밖** |
| 5 | U4 워커 기록·스캔 | U1·U3 | 서버 | 단위 테스트만(배포는 U6b) |
| 6 | U5 Edge·도구 | U2·U3 | 서버(U4와 다른 파일) | 단위 테스트만(배포는 U6a) |
| 7 | U7 EruriCore | U3 계약(`unsub_list` 열 12개) | 앱(서버와 병렬 가능, deno·시뮬레이터 동시 실행 금지) | 무관 |
| 8 | U6a `unsubscribe` 배포 | U3 적용·U5 | 서버 | **창 밖** |
| 9 | U8 앱 화면·0.10.0 | U7 | 앱 | 무관 |
| 10 | U9 시뮬레이터 게이트 | U6a·U8 | 앱 | **창 밖**(시드·Edge 호출) |
| 11 | U6b 워커 배포·30일 스캔·방법 분포 판정·TestFlight | U4·U9 + **③c2 완료 기록** | 서버 + 앱 업로드 | ③c2 뒤, ⑩b 실행 중 아님 |
| 12 | U10 `UNS-real` | U6b 판정 통과 | 서버 + 사용자 | ③c2 뒤 |

---

### Task U0: 전제 확인·스펙·보관 계획 버전

**Files:**
- Modify: `docs/superpowers/specs/2026-09-22-assistant-design.md` (3행 머리, §2 표, §7 "Gmail 동기화" 끝, §8 표·삭제 표, §11 둘째 문단, §12 통제 1~5, §15, §16)
- Modify: `docs/superpowers/plans/2026-10-01-retention-summary.md` (R-B9 버전 4곳)

§16 "외부 리뷰 반영 (광고 구독 해지 계획, Codex gpt-6-astra · Fable, 2026-10-02)" 소절은 계획 수정 커밋에서 이미 들어갔다 — U0은 그 소절을 고치지 않고, 그 앞에 결정 소절(Step 7)을 넣는다.

**Interfaces:**
- Produces: 스펙 §7 "광고 구독 해지" 소절(U1~U10이 따르는 원본), 표 이름 `unsub_senders`·`unsub_mail`, 방법 값 `one_click/unverified/link_only/mailto/none`(메일 행), 상태 값 `active/requesting/requested/failed`(발신자 행), 결과 코드 `ok`·`redirect_<n>`·`http_<n>`·차단 코드.

행 번호는 `9d245d7` 기준 — 실행 때 `grep -n`으로 다시 찾는다.

- [ ] **Step 0: 전제 F2 확인 (읽기만, 개수만)**

광고 메일 id가 history로 `gmail-fetch`에 온다는 것(F2)은 코드 추론이다. 워커 로그에서 Gmail 측정 T0(2026-10-01 14:53:11 KST) 이후 `"gmail_discard":"promotion"` 줄 **개수만** 센다 — 대시보드 Edge Functions → `worker` → Logs 검색, 또는 Logs Explorer에서:

```sql
select count(*) as n from function_logs
where timestamp > '2026-10-01 05:53:11' and event_message like '%"gmail_discard":"promotion"%'
```

Expected: `n ≥ 1`. 메일 내용·발신자는 보지 않는다(로그에 코드만 있다). 0이면 멈추고 메인에게 보고한다(스펙 §7 "도착 경로"를 다시 써야 한다). 에이전트가 로그에 접근할 수단이 없으면 메인에게 위 쿼리 결과 숫자 하나만 사용자에게 받아 달라고 요청한다.

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
- **기록(헤더 메타만)**: `gmail-fetch`가 (a) 메일과, 저장한 메일 중 `List-Unsubscribe` 헤더가 있는 것(게이트 판정 전이라 `item_id`로 연결해 두고 판정이 `promo`일 때만 센다)의 헤더 메타를 남긴다 — 발신자 From 주소·표시 이름(60자)은 `unsub_senders`, 메일마다 Gmail 메시지 키(`gmail:<id>`)·수신 시각·해지 방법·해지 URL(`one_click`일 때만, 사용자 데이터 키로 암호화 — §12 통제 1)은 `unsub_mail`(§8). 발신자 행에는 URL을 두지 않는다. 구독 해지 기록에는 제목·본문을 저장하지 않는다. 실시간 기록 실패나 2초 초과는 메일 수집을 실패시키지 않는다(fail-open, 로그 코드 `unsub_record_error`). 2초 예산은 기록 1건마다라 기록 RPC가 계통적으로 멈추면 잡 지연이 기록 수만큼 커지므로, `gmail-fetch` 잡은 첫 기록 실패·초과 뒤 그 잡의 나머지 기록을 건너뛴다(로그 `unsub_record_skipped`·개수, 잡당 추가 지연 약 2초 — 빠진 기록은 일일 공백 스캔이 채운다). 스캔(아래)의 기록 실패는 잡 실패로 재시도한다(기록은 멱등).
- **도착 경로**: watch는 프로모션 라벨을 제외해 광고 메일만으로는 Pub/Sub이 오지 않는다. 광고 메일은 다음 sync(다른 메일의 푸시 또는 6시간 cron)의 history로 들어와 기록된다 — 집계는 최대 약 6시간 늦다. **주간 재인증 공백**은 재연결(`gmail_save_connection`)이 커서를 새 historyId로 덮어 history 모드가 유지되므로 재동기화가 일어나지 않고, 재연결 백필은 `-category:promotions`라 `reauth_required` 기간의 프로모션 광고는 실시간 경로로 오지 않는다. 이 공백은 **일일 공백 스캔**이 메운다: pg_cron(KST 04:27, `0029`)이 활성 Gmail 연결마다 최근 8일(`after:` = 지금 − 8일, 재인증 공백 7일 + 하루) 헤더 스캔 잡을 넣는다(`gmail_enqueue_unsub_gap`, 그 사용자에게 대기 중 스캔이 있으면 건너뜀). 실시간 기록이 빠진 것(아래 잡 로컬 차단기로 건너뛴 기록, 실시간 경로가 비는 경우)도 같은 스캔이 채운다(기록은 메시지 키로 멱등). history가 404여서 재동기화로 넘어가는 드문 경우(연결이 active인 채 sync가 history 보존 기간 넘게 멈춤)에는 재동기화한 sync가 같은 구간(`after:` = 마지막 성공 − 1일)의 헤더 스캔 잡을 바로 하나 넣는다(넣기 실패해도 sync는 계속, 2026-10-02 리뷰 반영). 백필·재동기화 목록의 `-category:promotions`는 그대로다.
- **30일 스캔**: 워커 배포 직후 운영자가 `gmail_enqueue_unsub_scan(user)`로 1회 넣는다(Gmail 게이트 ③c2 뒤). 목록 `newer_than:30d {category:promotions subject:광고} -in:drafts`(일일 공백·재동기화 스캔은 `after:<초>`)와 같은 기간 게이트 `promo` 항목의 Gmail id(이미 기록된 것 제외)를 모아 `gmail-unsub-fetch` 잡(50개씩, 백필 레인, lease `backfill:<user>` — 연결 시 90일 백필과 같은 레인이라 실시간 sync를 막지 않고 계정의 Gmail 호출이 한 줄로 선다)이 `messages.get format=metadata`(From·Subject·List-Unsubscribe·List-Unsubscribe-Post·Authentication-Results·DKIM-Signature)로 헤더만 읽는다. 라벨·제목·발신자 표기로 광고가 아니면 버린다. **스캔의 광고 판정은 실시간과 다르다**: 본문을 읽지 않아 본문에만 `(광고)` 표기가 있는 과거 메일은 세지 못하고 OTP 제외 규칙도 적용하지 않는다(광고 라벨·표기가 있는 메일이라 수용). 연결을 지우고 다시 연결해도 30일 스캔은 다시 넣지 않는다(새 광고와 일일 공백 스캔의 최근 8일부터 쌓인다).
- **해지 방법 판정**(메일마다): `one_click` = `List-Unsubscribe`·`List-Unsubscribe-Post` 헤더가 **각각 정확히 1개**, https URI가 정확히 1개, `List-Unsubscribe-Post: List-Unsubscribe=One-Click`, 그리고 **맨 위** `Authentication-Results`가 Gmail(`mx.google.com`)의 것이고 그 안의 `dkim=pass` 결과가 서명 도메인(`header.d` 또는 `header.i`의 도메인)·selector(`header.s`)·서명값 앞부분(`header.b`)으로 **`DKIM-Signature` 하나를 특정**하며 그 서명의 `h=`가 두 헤더를 모두 덮음(RFC 8058 §3 — 유효한 서명이 덮어야 한다). 추가로 서명 도메인이 From 도메인과 같거나 그 상위 도메인이어야 한다 — 이 정렬 조건은 RFC가 아니라 **제품 정책**이다(외부 발송 대행 도메인 서명은 `unverified`가 된다). `unverified` = 원클릭 헤더는 있으나 위 확인 실패(헤더·URI 중복 포함) · `link_only` = https 링크뿐(웹 페이지 방식) · `mailto` = 메일 주소뿐 · `none` = 헤더 없음. URL이 2,048자를 넘으면 없는 것으로 본다. 목록·요청에 쓰는 발신자의 방법·URL은 그 발신자의 **광고로 세는 메일**에서만 고른다 — 그중 `one_click`이 있으면 가장 최근 `one_click` 메일, 없으면 가장 최근 메일(같은 From의 거래·뉴스레터 메일 URL로 요청하지 않는다). **`one_click`만 [해지] 버튼**, 나머지는 사유만 보인다(mailto 발송은 `gmail.send` 재동의, 링크 열기는 원클릭이 아니어서 이번 범위 밖 — §16).
- **해지 요청**(Edge `unsubscribe`, 사용자 JWT, `POST {sender_id}`): `unsub_begin`(행 잠금, 상태 확인, 그 시점의 광고 메일에서 방법·URL 선택, 복호화 감사) → URL 복호화 → 안전 POST → `unsub_finish`. 안전 POST(`_shared/safe-post.ts`): https만, 포트 443, userinfo 없음, `localhost`·`.local`·`.internal`·`.home.arpa`·점 없는 호스트 거부, DNS(A·AAAA) 결과가 하나라도 사설·루프백·링크로컬·CGNAT·멀티캐스트·예약·문서용 IPv4이거나, IPv6가 전역 유니캐스트 `2000::/3` 밖이거나 그 안의 특수 대역(6to4·NAT64 내장 사설, 문서용, `2001::/23`)이면 거부, 본문 `List-Unsubscribe=One-Click`(`application/x-www-form-urlencoded`), 쿠키·인증 헤더 없음, 전체 10초, **요청은 한 번 — 3xx는 따라가지 않고 실패**(`redirect_<상태>`; RFC 8058 §3.1은 발신자 서버가 리다이렉트하지 않아야 한다고 정하므로 리다이렉트는 접수의 증거가 아니다). 응답 본문은 읽지 않는다. 남은 위험 DNS 재바인딩은 수용(§12 통제 3). 리졸버는 런타임의 `Deno.resolveDns`(A·AAAA 둘 다 실패하거나 함수가 없으면 DNS-over-HTTPS `dns.google`, 호스트 이름만 간다).
- **결과·재표시**: 2xx → `requested`(요청 시각), 그 밖(3xx 포함) → `failed`(결과 코드). 요청 시각 + 3일 뒤에도 광고가 오면 "해지 요청 뒤에도 광고 N통"과 [다시 요청]. 같은 발신자 요청은 5회까지(한도에 닿으면 버튼 대신 "요청 한도(5회)에 도달했어요"), 60초 안 재요청은 `busy`, 60초 넘게 `requesting`이면 결과 없이 끝난 것으로 보고 다시 시도할 수 있다. 목록은 발신자 기준으로 최근 30일 광고가 있거나 30일 안에 요청·실패한 발신자만(광고 메일 행이 정리된 뒤에도 요청 이력은 남는다), 30일 광고 수 순, 100곳까지. 화면의 수는 기록을 시작한 뒤(30일 스캔 포함)의 최근 30일이다.
- **보관**: `unsub_mail`(해지 URL 포함) 35일 — 일일 정리라 최대 +1일. 메일 행이 없고 마지막 수신 35일이 지난 발신자는 지운다(해지 요청한 발신자는 요청 뒤 180일 동안 주소·상태만 — URL은 메일 행과 함께 35일에 지워진다) — `unsub-purge-daily`. 메일이 계속 오면 발신자 행은 마지막 수신 기준으로 계속 남는다. 출처 삭제(연결 행 삭제 cascade)·계정 삭제(cascade)가 함께 지운다.
- **화면**: 설정 "Gmail" 절의 "광고 메일 구독 해지" → 목록 화면(§11).
```

- [ ] **Step 4: §8 표 행 2개** (`| eval_judgments |` 행 바로 아래)

```
| `unsub_senders` | connection_id(connections cascade), address(From 주소, 소문자), display_name(≤60자), last_seen_at, status(active/requesting/requested/failed), status_at, requested_at, result_code, attempts | 광고 구독 해지(§7). unique(connection_id, address). 해지 방법·URL은 두지 않는다(메일 행). 주소·표시 이름은 `items.sender`와 같은 등급의 평문. RLS 켜고 정책 없음 — 앱은 `unsub_list()`(authenticated, URL 없음)만 부른다 |
| `unsub_mail` | sender_id(cascade), msg_key(`gmail:<id>`), occurred_at, item_id null(items cascade), method(one_click/unverified/link_only/mailto/none), url_enc bytea(one_click만, 사용자 키 AES-256-GCM) | 광고 판정 후보 메일 1통 = 1행, pk(user_id, msg_key)(sync·스캔 중복 없음). item_id null = 규칙 광고, 있으면 그 항목이 게이트 `promo` 폐기일 때만 센다. 해지 요청은 광고로 세는 행의 URL만 쓴다. 35일(일일 정리라 최대 +1일) |
```

삭제·만료 표: `| 폐기 격리 만료 |` 행 아래에 추가

```
| 광고 발신자 기록 | pg_cron `unsub-purge-daily`(§7 광고 구독 해지) | 35일 지난 `unsub_mail`(해지 URL 포함), 메일 행이 없고 마지막 수신 35일 지난 `unsub_senders`(해지 요청 180일 이내 제외 — 주소·상태만 남음) | — |
```

`| 항목·출처 삭제 |` 행의 "지우는 것" 칸 끝 `·Storage 객체` 뒤에 `·unsub_senders·unsub_mail(연결 cascade)`를 붙인다.

- [ ] **Step 5: §11 버전 문장**

`요약·저장 공간 화면은 서버 반영 뒤라 0.10.0)` → `광고 메일 구독 해지 화면(설정 Gmail 절 → 목록)은 0.10.0, 요약·저장 공간 화면은 서버 반영 뒤라 0.11.0)`

§15 "1단계 추가 범위(2026-10-01 사용자 결정, §16)" 문단의 `요약·저장 공간 화면은 앱 0.9.0이다.` → `요약·저장 공간 화면은 앱 0.11.0이다(0.9.x는 다건·종일·중복 일정, 0.10.0은 광고 구독 해지).`

- [ ] **Step 6: §12 통제·§15 확장 후보**

통제 1 "보호 범위" 문장의 `항목 요약 문장**(`item_summaries.summary_enc`, 2026-10-01)이다.` 뒤에 ` 광고 구독 해지 URL(`unsub_mail.url_enc`)도 같은 키로 암호화한다.`를 붙이고, 같은 문장의 평문 목록 `` `memories`는 검색·답변에 필요해 평문이며`` 를 `` `memories`, 광고 발신자 주소·표시 이름(`unsub_senders.address`·`display_name`)은 평문이며``로 고친다.

통제 2 마지막 bullet 뒤에 추가:

```
- 구독 해지 기록에는 제목·본문을 저장하지 않는다(§7 광고 구독 해지). 게이트 후보 메일의 암호화 저장·Jev 분류·`promo` 7일 격리는 기존대로다. 해지 기록은 발신자 주소·표시 이름·수신 시각·Gmail 메시지 키·해지 방법과 암호화한 해지 URL만 35일(일일 정리라 최대 +1일), 해지 요청한 발신자는 주소·상태만 180일 둔다. 이 메타는 LLM·Jev로 보내지 않는다.
```

통제 3 마지막 bullet 뒤에 추가:

```
- 광고 구독 해지 요청은 사용자가 고른 발신자의 해지 URL로만 간다(받는 쪽 = 그 발신자, 내용 = 고정 문자열 `List-Unsubscribe=One-Click`). Edge가 보내므로 사용자 기기 IP는 가지 않는다. DNS-over-HTTPS 대체 경로를 타면 그 호스트 이름이 Google 공개 DNS로 간다.
- 해지 POST의 **DNS 재바인딩은 수용 위험**이다(메인 판정 2026-10-02, 사용자 재검토 가능 — §16 외부 리뷰 반영 H3). 안전 POST는 DNS 답을 검사한 뒤 `fetch`가 이름을 다시 풀어 연결하므로, 검사 때는 공인 주소·연결 때는 내부 주소를 주는 DNS면 내부 HTTPS 엔드포인트로 고정 본문 POST 한 번이 갈 수 있다(Edge `fetch`에 연결 주소를 고정하는 수단이 없다고 본다 — 미확인). 수용 근거: (a) 요청은 DKIM 확인을 통과한 광고 메일의 URL로, 사용자가 그 발신자를 직접 고르고 확인창에서 승인할 때만 간다 (b) 본문은 고정 문자열이고 응답은 읽지도 돌려주지도 않아 읽기 유출이 없다 (c) 닿을 수 있는 내부 주소는 Supabase Edge 실행 환경 쪽이지 이 프로젝트의 DB·사용자 기기가 아니다. 리다이렉트를 따라가지 않으므로 남는 창은 첫 요청 한 번이다. 사용자가 다시 판단하면 해지 POST를 끄거나(목록·수만 보이기) 주소 고정이 되는 경로로 옮긴다.
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
**1단계 추가 범위(2026-10-01 광고 구독 해지 결정, §16)**: Gmail 광고 메일 발신자별 30일 수 + 원클릭 해지(§7 "광고 구독 해지"), 앱 0.10.0(설정 Gmail 절). 계획 `docs/superpowers/plans/2026-10-01-gmail-unsubscribe.md`. 마이그레이션(새 표·함수·cron)과 `unsubscribe` 함수는 Gmail 측정 기간에도 측정 창 밖에서 push·배포한다. 워커 배포·실사용자 30일 스캔·원클릭 비율 판정·TestFlight·사용자 확인 게이트는 ③c2 뒤(워커 재배포가 측정에 주는 영향을 피한다). M2 게이트와 독립.
```

"확장 후보" 목록 끝에 추가:

```
- **사용자 지시 메일 정리**("이 발신자/이런 내용 메일 지워줘", 2026-10-01 사용자 제안 — ③c2 뒤 별도 계획): Gmail 쪽 라벨·보관·휴지통은 `gmail.modify`가 필요하다 → 재동의(측정 기간 T0~③c2에는 금지라 그 뒤). `gmail.modify`는 제한(restricted) 범위라 테스트 모드 밖(지인 확대)에서는 앱 검증·CASA 대상이다(§3 Gmail 테스트 모드 줄과 같은 조건). 제약: 대상 목록(발신자·기간·개수, 제목만)을 먼저 보이고 **확인 단계 필수**, 영구 삭제(`messages.delete`, 더 넓은 `https://mail.google.com/` 범위) 없이 **휴지통(`messages.trash`, Gmail이 30일 뒤 비움)·보관(INBOX 라벨 제거)만** — 되돌릴 수 있게, 실행 개수와 되돌리기(untrash) 경로를 남긴다. ERURI 보관함 쪽: 지금은 출처 전체(`delete_gmail_source` — 사용자의 Gmail 항목 전부 + 연결)와 계정 전체 삭제만 있어 발신자·내용 단위로는 재사용할 수 없고, 같은 삭제 순서(잡 → facts 정정 연결 끊기 → facts → items, 한 트랜잭션)를 항목 id 배열을 받는 `delete_items(p_user, p_items)`로 일반화하면 된다.
```

- [ ] **Step 7: §16 새 소절** — "### 2026-10-01 날짜만 일정 = 종일 일정" 소절 뒤에 넣는다:

```markdown
### 2026-10-01 광고 구독 해지 (사용자 결정, 앱 0.10.0)

광고 메일은 서버 규칙·게이트로 버려지지만 받은편지함에는 계속 쌓인다. 결정: 발신자별 최근 30일 광고 수와 원클릭 해지 버튼, 사용자가 고른 발신자만 해지 요청(§7 "광고 구독 해지"). Gmail 권한은 `gmail.readonly` 그대로(측정 기간 재동의 금지와도 맞는다). 계획이 정한 것: 화면은 설정 Gmail 절 → 별도 목록 화면(채팅 카드·새 탭 기각 — 질문이 아니라 관리 작업이고 탭은 4개 유지), mailto·웹 링크 방식은 사유만 보이고 버튼 없음(mailto는 `gmail.send` 재동의, 링크 열기는 GET 페이지 조작이 필요해 원클릭이 아님), 해지는 서버(Edge)가 보낸다(기기에서 보내면 해지 URL을 기기로 내려야 하고 사용자 IP가 발신자에게 간다), 원클릭 헤더가 있어도 Gmail이 확인한 그 서명이 해지 헤더를 덮지 않으면 보내지 않는다(위조 발신자가 임의 URL로 POST를 유도하지 못하게, RFC 8058 §3), 해지 URL은 광고로 세는 메일에서만 고른다(같은 From의 거래 메일 URL로 요청하지 않게), 요청 뒤 3일 유예 뒤에도 광고가 오면 다시 요청을 연다, 워커 배포·30일 스캔은 Gmail 측정(③c2) 뒤, 버전은 이 기능이 0.10.0이고 보관 계획 R-B9(요약·저장 공간)는 0.11.0. 기각: 자동 해지(사용자 확인 원칙 — 일정 등록과 같은 이유), 광고 판정 안 된 뉴스레터까지 보이기(거래·구독 메일 오인 위험), 제목 저장(목록에는 발신자·개수면 충분), 리다이렉트·결과 페이지 따라가기(RFC 8058 §3.1상 원클릭 접수의 증거가 아니고, 다시 POST하면 SSRF 표면이 넓어진다 — 3xx는 실패로 기록). 남은 것: 원클릭을 지원하는 발신자 비율은 TestFlight 공개 전 판정 지점(계획 U6b — 30일 스캔 직후)에서 보고, 광고 발신자 중 `one_click`이 0곳이면 실기기 확인 전에 "웹 페이지 열기(사용자 브라우저)" 대안을 사용자에게 묻는다. DNS 재바인딩은 수용 위험(§12 통제 3).
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
Expected: 19 이상 — 계획 수정 커밋 뒤 4줄(3행 머리·§16 외부 리뷰 반영 소절 3줄) + U0이 더하는 15줄(§2·§7×2·§8×3·§11·§15 버전·§12 통제 1·2·3·5·§15 추가 범위·§16 결정 소절×2. Step 1 머리는 같은 3행이라 늘지 않는다). 모자라면 빠진 Step을 찾는다.

```bash
git add docs/superpowers/specs/2026-09-22-assistant-design.md docs/superpowers/plans/2026-10-01-retention-summary.md
git commit -m "docs(spec): Gmail ad unsubscribe (user decision, app 0.10.0) — §7 per-sender 30-day ad counts from header metadata only (rule promotion discards and gate promo items), method and url per mail row and chosen only from mails counted as ads, RFC 8058 one-click POST from Edge only for the sender the user picks (Gmail AR dkim=pass pinning one signature that covers both single headers, https/public-IP/10s, single request, 3xx fails), resync gap scan, 3-day grace re-request, 35-day metadata; §8 unsub_senders/unsub_mail; §12 encrypted URL, plaintext sender address, DNS rebinding accepted (main ruling 2026-10-02, user may revisit); §15 user-directed mail cleanup deferred past ③c2 (gmail.modify, confirm, trash only); retention R-B9 → 0.11.0

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
  - `dkimCovers(msg, fromDomain: string): boolean` — 맨 위 AR이 `mx.google.com`, 그 `dkim=pass`(d·`header.s`·`header.b`)가 특정한 `DKIM-Signature` 정확히 1개의 `h=`만 본다
  - `unsubMeta(msg: Pick<GmailMessage, "payload">): UnsubMeta | null` — 절대 throw하지 않는다. `one_click`은 `List-Unsubscribe`·`List-Unsubscribe-Post`·https URI가 각각 1개일 때만
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
// Gmail AR 형식: dkim=pass header.i=@<d> header.s=<selector> header.b=<서명값 앞 8자>
const AR_PASS = "mx.google.com; dkim=pass header.i=@example.com header.s=s1 header.b=AbC+d/Ef; spf=pass smtp.mailfrom=bounce@mail.example.com";
const SIG = "v=1; a=rsa-sha256; d=example.com; s=s1; h=From:Subject:List-Unsubscribe:List-Unsubscribe-Post:Date; bh=x; b=AbC+d/Ef 9xYz\r\n Qw==";

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
    "Authentication-Results": "mx.google.com; dkim=pass header.i=@mail.example.com header.s=s1 header.b=AbC+d/Ef", "DKIM-Signature": SIG.replace("d=example.com", "d=mail.example.com") });
  assertEquals(unsubMeta(m)?.method, "unverified");
});

// 리뷰 H1: 통과한 서명과 h= 를 검사하는 서명이 같아야 한다. Codex 재현 사례 — 정상 서명은 From·Subject 만, 같은 d= 의 무효 서명이 해지 헤더를 h= 에 적음
Deno.test("dkim: signature pinned by selector and b= prefix; duplicate headers/URIs, AR without header.b, Gmail AR not on top → unverified", () => {
  const base = { From: FROM, "List-Unsubscribe": LU, "List-Unsubscribe-Post": LUP };
  const AR_GOOD = "mx.google.com; dkim=pass header.i=@example.com header.s=good header.b=GOOD1234";
  const good = "v=1; d=example.com; s=good; h=From:Subject; b=GOOD1234rest";
  const forged = "v=1; d=example.com; s=forged; h=From:List-Unsubscribe:List-Unsubscribe-Post; b=INVALID";
  const sameSelector = "v=1; d=example.com; s=good; h=From:List-Unsubscribe:List-Unsubscribe-Post; b=BAD00000";   // selector 같아도 b= 가 다르면 다른 서명
  const cases: Record<string, string | string[]>[] = [
    { ...base, "Authentication-Results": AR_GOOD, "DKIM-Signature": [good, forged] },
    { ...base, "Authentication-Results": AR_GOOD, "DKIM-Signature": [good, sameSelector] },
    { ...base, "List-Unsubscribe": [LU, "<https://other.example.com/u>"], "Authentication-Results": AR_PASS, "DKIM-Signature": SIG },   // 해지 헤더 2개
    { ...base, "List-Unsubscribe-Post": [LUP, LUP], "Authentication-Results": AR_PASS, "DKIM-Signature": SIG },
    { ...base, "List-Unsubscribe": "<https://u.example.com/a>, <https://u.example.com/b>", "Authentication-Results": AR_PASS, "DKIM-Signature": SIG },   // https URI 2개
    { ...base, "Authentication-Results": "mx.google.com; dkim=pass header.i=@example.com header.s=s1", "DKIM-Signature": SIG },    // header.b 없음
    { ...base, "Authentication-Results": ["relay.example.net; spf=pass", AR_PASS], "DKIM-Signature": SIG },                         // 맨 위 AR 이 Gmail 것이 아님
    { ...base, "Authentication-Results": AR_PASS, "DKIM-Signature": [SIG, SIG] },                                                   // 같은 서명 둘 = 특정 불가
  ];
  for (const [i, h] of cases.entries()) assertEquals([i, unsubMeta(msg(h))?.method, unsubMeta(msg(h))?.url], [i, "unverified", null]);
  // 통과 서명이 둘 중 하나일 때도 그 하나가 덮으면 one_click
  const ok = msg({ ...base, "Authentication-Results": AR_PASS, "DKIM-Signature": [forged, SIG] });
  assertEquals(unsubMeta(ok)?.method, "one_click");
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

type Sig = { d: string; s: string; b: string; h: string[] };
function sigTags(v: string): Sig {
  const t: Record<string, string> = {};
  for (const part of v.split(";")) {
    const i = part.indexOf("=");
    if (i > 0) t[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).replace(/\s+/g, "");   // 접힌 줄·공백 제거
  }
  // d·s·h 는 대소문자 무시, b= 는 base64 라 그대로
  return { d: (t.d ?? "").toLowerCase(), s: (t.s ?? "").toLowerCase(), b: t.b ?? "", h: (t.h ?? "").toLowerCase().split(":").filter(Boolean) };
}

// Authentication-Results 의 dkim=pass 결과마다 서명 도메인·selector·서명값 앞부분(Gmail 은 header.b 에 앞 8자)
function arDkimPass(ar: string): { d: string; s: string; b: string }[] {
  const out: { d: string; s: string; b: string }[] = [];
  for (const part of ar.split(";").slice(1)) {
    if (!/^\s*dkim=pass\b/i.test(part)) continue;
    const tag = (k: string) => part.match(new RegExp(`\\bheader\\.${k}=([^\\s;]+)`, "i"))?.[1] ?? "";
    const d = (tag("d") || tag("i").replace(/^[^@]*@/, "")).toLowerCase();
    const s = tag("s").toLowerCase(), b = tag("b");
    if (d && s && b) out.push({ d, s, b });
  }
  return out;
}

// RFC 8058 §3: **유효한** DKIM 서명이 List-Unsubscribe·List-Unsubscribe-Post 를 덮어야 한다(리뷰 H1).
// 맨 위 Authentication-Results 가 Gmail(mx.google.com)의 것이어야 한다(수신 서버가 맨 위에 붙인다 — 원문에 끼워 넣은 AR 은 아래에 온다).
// 그 안의 dkim=pass 가 (d, selector, b= 앞부분)으로 특정하는 DKIM-Signature 가 정확히 1개이고, 그 서명의 h= 가 두 헤더를 모두 포함할 때만 true.
// 서명 도메인 D 가 From 도메인과 같거나 그 상위여야 한다 — RFC 가 아니라 제품 정책(외부 발송 대행 서명은 unverified). 역방향(D 가 From 의 하위)은 받지 않는다
export function dkimCovers(msg: Msg, fromDomain: string): boolean {
  const ar = allHeaders(msg, "Authentication-Results")[0];
  if (!ar || !/^\s*mx\.google\.com\s*;/i.test(ar)) return false;
  const sigs = allHeaders(msg, "DKIM-Signature").map(sigTags);
  return arDkimPass(ar).some((p) => {
    if (!(fromDomain === p.d || fromDomain.endsWith("." + p.d))) return false;
    const hit = sigs.filter((s) => s.d === p.d && s.s === p.s && s.b.startsWith(p.b));
    return hit.length === 1 && hit[0].h.includes("list-unsubscribe") && hit[0].h.includes("list-unsubscribe-post");
  });
}

export function unsubMeta(msg: Msg): UnsubMeta | null {
  try {
    const from = parseFrom(header(msg, "From"));
    if (!from) return null;
    const lu = allHeaders(msg, "List-Unsubscribe"), lup = allHeaders(msg, "List-Unsubscribe-Post");
    const uris = lu.flatMap(listUnsubUris);
    const https = uris.filter((u) => /^https:\/\//i.test(u) && u.length <= MAX_URL);
    const mailto = uris.some((u) => /^mailto:/i.test(u));
    const post = lup.some((v) => v.replace(/\s+/g, "").toLowerCase() === "list-unsubscribe=one-click");
    let method: UnsubMethod = "none";
    if (https.length > 0 && post) {
      // 헤더·URI 가 하나씩일 때만 서명이 덮은 값과 POST 대상이 같다고 볼 수 있다(리뷰 H1)
      const single = lu.length === 1 && lup.length === 1 && https.length === 1;
      method = single && dkimCovers(msg, from.address.split("@")[1]) ? "one_click" : "unverified";
    } else if (https.length > 0) method = "link_only";
    else if (mailto) method = "mailto";
    return { ...from, method, url: method === "one_click" ? https[0] : null };
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
Expected: PASS(새 9개 + 기존 rules 전부).

Note: `isAdMail` 테스트의 `"[광고] 합성몰 <a@example.com>"`는 `AD_MARK`(`^\s*(?:\[Web발신\]\s*)?[(\[]\s*광고\s*[)\]]`)가 대괄호도 받으므로 true다. `AD_MARK`가 다르게 정의돼 있으면 테스트가 아니라 이 줄의 기대를 `AD_MARK`에 맞춰 고치고 그 이유를 커밋 메시지에 적는다.

- [ ] **Step 5: 커밋**

```bash
git add supabase/functions/_shared/rules.ts supabase/functions/_shared/unsub.ts supabase/tests/unsub.test.ts
git commit -m "feat(server): unsubscribe header parsing — From address/name, List-Unsubscribe URIs, RFC 8058 one-click only when the topmost Authentication-Results is Gmail's and its dkim=pass (domain, selector, b= prefix) pins exactly one DKIM-Signature whose h= covers both headers, single List-Unsubscribe/-Post header and single https URI, signer equal to or parent of the From domain (product policy) (else unverified), link_only/mailto/none, URLs over 2048 ignored, never throws; isAdMail from metadata (promotion label, (광고) in subject or sender) (spec §7)

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
  - `type PostCode = "ok" | "blocked_scheme" | "blocked_host" | "blocked_private" | "dns_error" | "timeout" | "network" | \`redirect_${number}\` | \`http_${number}\``
  - `ipBlocked(ip: string): boolean` (파싱 불가 = true, IPv6는 `2000::/3` 밖이면 true)
  - `checkUrl(raw: string): URL | "blocked_scheme" | "blocked_host"`
  - `resolveWith(rd: DenoResolveDns | undefined, fallback: Resolver, host: string): Promise<string[]>` (A·AAAA 둘 다 reject거나 함수 없음 → fallback)
  - `defaultResolver: Resolver` (`resolveWith(Deno.resolveDns, doh)`)
  - `oneClickPost(url: string, o?: { fetch?: typeof fetch; resolve?: Resolver; timeoutMs?: number }): Promise<{ ok: boolean; code: PostCode }>` — 요청 1회, `ok`는 2xx만

- [ ] **Step 1: 실패하는 테스트 작성**

`supabase/tests/safe-post.test.ts`:

```ts
import { assertEquals } from "jsr:@std/assert";
import { checkUrl, ipBlocked, oneClickPost, type Resolver, resolveWith } from "../functions/_shared/safe-post.ts";

Deno.test("ipBlocked table", () => {
  const blocked = ["0.0.0.0", "10.1.2.3", "100.64.0.1", "127.0.0.1", "169.254.169.254", "172.16.0.1", "172.31.255.255", "192.0.0.8",
    "192.0.2.1", "192.168.1.1", "198.18.0.1", "198.51.100.2", "203.0.113.9", "224.0.0.1", "255.255.255.255",
    "::", "::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "::127.0.0.1", "64:ff9b::a00:1", "2002:c0a8:101::1", "fc00::1", "fd12:3456::1",
    "fe80::1", "ff02::1", "2001:db8::1", "fe80::1%en0", "not-an-ip", "1.2.3", "1:2:3:4:5:6:7:8:9",
    // 리뷰 N11: 2000::/3 밖·특수 대역은 열거하지 않아도 막힌다
    "64:ff9b:1::a00:1", "2001::1", "2001:0:4136:e378::1", "3fff::1", "100::1", "4000::1", "1234::1"];
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

// 리뷰 M1: RFC 8058 §3.1 — 발신자 서버는 리다이렉트하지 않아야 한다. 3xx 는 접수 증거가 아니고, 따라가면 SSRF 표면이 넓어진다
Deno.test("2xx ok; every 3xx is one request and redirect_<n> (never followed); 4xx/5xx http_<n>", async () => {
  for (const [s, code] of [[200, "ok"], [202, "ok"], [204, "ok"], [301, "redirect_301"], [302, "redirect_302"], [303, "redirect_303"],
                           [307, "redirect_307"], [308, "redirect_308"], [404, "http_404"], [500, "http_500"]] as const) {
    const { f, calls } = fakeFetch([new Response(null, { status: s, headers: s >= 300 && s < 400 ? { location: "https://inside.example.com/x" } : {} })]);
    assertEquals(await oneClickPost("https://u.example.com/x", { fetch: f, resolve: pub }), { ok: code === "ok", code });
    assertEquals(calls.length, 1);
  }
});

// 리뷰 N8: Edge 에서 Deno.resolveDns 가 있어도 권한·미지원으로 던지면 DoH 로 넘어가야 한다
Deno.test("resolveWith: both Deno lookups reject → fallback; one answer is enough; no resolveDns → fallback", async () => {
  const doh: Resolver = async () => ["93.184.216.34"];
  const rej = () => Promise.reject(new Error("PermissionDenied"));
  assertEquals(await resolveWith(rej, doh, "u.example.com"), ["93.184.216.34"]);
  assertEquals(await resolveWith((_h, t) => (t === "A" ? Promise.resolve(["1.1.1.1"]) : rej()), doh, "u.example.com"), ["1.1.1.1"]);
  assertEquals(await resolveWith(async (_h, t) => (t === "A" ? ["1.1.1.1"] : ["2606:4700::1111"]), doh, "u.example.com"), ["1.1.1.1", "2606:4700::1111"]);
  assertEquals(await resolveWith(undefined, doh, "u.example.com"), ["93.184.216.34"]);
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
// https·443·userinfo 없음·로컬 이름 금지 → DNS(A·AAAA) 전부 공인 주소 → 고정 본문 POST 1회(쿠키·인증 없음, 전체 10초)
// → 2xx 만 접수. 3xx 는 따라가지 않고 redirect_<n>(RFC 8058 §3.1: 발신자 서버는 리다이렉트하지 않는다). 응답 본문은 읽지 않는다.
// 남은 위험: DNS 재바인딩(검사와 연결 사이 주소 변경) — 수용 위험(스펙 §12 통제 3, 메인 판정 2026-10-02). 리다이렉트가 없어 창은 첫 요청 하나
export type Resolver = (host: string) => Promise<string[]>;
export type PostCode =
  | "ok" | "blocked_scheme" | "blocked_host" | "blocked_private" | "dns_error" | "timeout" | "network"
  | `redirect_${number}` | `http_${number}`;

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
// 허용 목록식(리뷰 N11): v4 매핑·NAT64(/96)는 내장 v4 로 판정, 그 밖은 전역 유니캐스트 2000::/3 안이고 특수 대역이 아닐 때만 연다
function v6Blocked(g: number[]): boolean {
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0 || g[5] === 0xffff)) {
    if (g[5] === 0 && g[6] === 0 && g[7] <= 1) return true;            // :: · ::1
    return embedded(g[6], g[7]);                                          // ::a.b.c.d · ::ffff:a.b.c.d
  }
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return embedded(g[6], g[7]);   // NAT64 64:ff9b::/96
  if (g[0] < 0x2000 || g[0] > 0x3fff) return true;                      // 2000::/3 밖(64:ff9b:1::/48·fc00::/7·fe80::/10·ff00::/8 포함)
  if (g[0] === 0x2002) return embedded(g[1], g[2]);                     // 6to4
  if (g[0] === 0x2001 && (g[1] === 0x0db8 || g[1] < 0x0200)) return true;   // 문서용 2001:db8::/32, IETF 특수 2001::/23(Teredo 포함)
  if (g[0] === 0x3fff && g[1] < 0x1000) return true;                    // 문서용 3fff::/20
  return false;
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
export type DenoResolveDns = (q: string, t: "A" | "AAAA") => Promise<string[]>;
type DenoDns = { resolveDns?: DenoResolveDns };
// A·AAAA 중 하나라도 답하면 그 답(둘 다 모은다). 둘 다 던지면(Edge 권한·미지원) 또는 함수가 없으면 fallback(DoH) — 리뷰 N8
export async function resolveWith(rd: DenoResolveDns | undefined, fallback: Resolver, host: string): Promise<string[]> {
  if (typeof rd !== "function") return await fallback(host);
  const [a, aaaa] = await Promise.allSettled([rd(host, "A"), rd(host, "AAAA")]);
  if (a.status === "rejected" && aaaa.status === "rejected") return await fallback(host);
  return [...(a.status === "fulfilled" ? a.value : []), ...(aaaa.status === "fulfilled" ? aaaa.value : [])];
}
export const defaultResolver: Resolver = (host) => resolveWith((Deno as unknown as DenoDns).resolveDns, doh, host);
export const resolverKind = () => (typeof (Deno as unknown as DenoDns).resolveDns === "function" ? "deno" : "doh");

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error("dns_timeout")), ms);
    p.then((v) => { clearTimeout(t); res(v); }, (e) => { clearTimeout(t); rej(e); });
  });
}

export async function oneClickPost(url: string, o: { fetch?: typeof fetch; resolve?: Resolver; timeoutMs?: number } = {}):
  Promise<{ ok: boolean; code: PostCode }> {
  // 전체 예산(DNS + 요청). AbortSignal.timeout 대신 직접 타이머 — 일찍 끝나면 지워서 deno test 의 타이머 누수 검사에 걸리지 않게
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(new DOMException("timeout", "TimeoutError")), o.timeoutMs ?? 10_000);
  try { return await post(url, o, ctl.signal); } finally { clearTimeout(timer); }
}

async function post(url: string, o: { fetch?: typeof fetch; resolve?: Resolver }, signal: AbortSignal): Promise<{ ok: boolean; code: PostCode }> {
  const f = o.fetch ?? fetch, resolve = o.resolve ?? defaultResolver;
  const done = (code: PostCode) => ({ ok: code === "ok", code });
  const u = checkUrl(url);
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
  if (r.status >= 300 && r.status < 400) return done(`redirect_${r.status}`);   // 따라가지 않는다(리뷰 M1·H3)
  return done(`http_${r.status}`);
}
```

- [ ] **Step 4: 통과 확인**

Run: `deno test --allow-net --allow-env --allow-read supabase/tests/safe-post.test.ts`
Expected: PASS(7개). `ipBlocked table`이 실패하면 표의 그 주소가 위 규칙과 어긋나는지 먼저 확인한다 — 규칙을 넓히는 쪽(막는 쪽)으로만 고친다.

- [ ] **Step 5: 커밋**

```bash
git add supabase/functions/_shared/safe-post.ts supabase/tests/safe-post.test.ts
git commit -m "feat(server): SSRF-safe one-click POST — https/443/no userinfo/no local names, every A/AAAA answer public (private, loopback, link-local, CGNAT, multicast, reserved, doc ranges, v4-mapped/NAT64/6to4 embedded), IPv6 allowed only inside 2000::/3 minus special ranges, fixed form body without cookies or auth, 10s total, a single request — every 3xx is redirect_<n> and never followed, only 2xx is ok, body never read; resolver Deno.resolveDns, DNS-over-HTTPS when both lookups throw or the API is missing (spec §7, review H3/M1/N8/N11)

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
  - `worker_record_unsub(p_user uuid, p_connection uuid, p_address text, p_name text, p_method text, p_url_enc bytea, p_msg_key text, p_occurred_at timestamptz, p_item uuid default null) → uuid`(sender id, 연결 없으면 null) — 인자 9개는 그대로, 방법·URL은 `unsub_mail` 행에 들어간다
  - `unsub_scan_targets(p_user uuid, p_since timestamptz) → table(gmail_id text, item_id uuid)`
  - `gmail_enqueue_unsub_scan(p_user uuid, p_lease_prefix text default '') → int` — lease `<prefix>backfill:<user>`
  - `unsub_begin(p_user uuid, p_sender uuid) → jsonb` `{result: ok|not_found|unsupported|busy|already|limit, url_enc?: "\\x…"}` — URL은 `unsub_best`
  - `unsub_finish(p_user uuid, p_sender uuid, p_code text) → void` — `p_code = 'ok'`만 `requested`
  - `purge_unsub(p_user uuid default null) → jsonb {mail, senders}`
  - `unsub_stats(p_user uuid, p_jobs_since timestamptz default null) → jsonb {senders, senders_with_ads_30d, ads_30d, method_of_senders_with_ads, status, result_codes, jobs}`(리뷰 M8)
  - 내부: `unsub_ad_mail(p_user uuid) → table(sender_id uuid, msg_key text, occurred_at timestamptz, method text)`, `unsub_best(p_user uuid, p_sender uuid) → table(method text, url_enc bytea, msg_key text)`(광고로 세는 메일 중 `one_click` 우선 → 최신 1행, 리뷰 H2)
- Produces (authenticated): `unsub_list() → table(sender_id uuid, display_name text, address text, method text, status text, status_at timestamptz, requested_at timestamptz, result_code text, ads_30d int, ads_after_request int, last_ad_at timestamptz, can_request boolean)` — 열 12개. `method`는 `unsub_best`(광고 메일이 없으면 `'none'`), `can_request = attempts < 5`. U7 `Unsubscribe.Row`가 이 열 이름을 그대로 디코드한다.
- cron `unsub-purge-daily` `43 4 * * *`.

- [ ] **Step 1: 실패하는 DB 테스트 작성**

`supabase/tests/unsub-db.test.ts`:

```ts
import { assert, assertEquals } from "jsr:@std/assert";
import { createClient } from "npm:@supabase/supabase-js@2";
import { decrypt, encrypt, SERVER_AUTH, toBytea } from "../functions/_shared/crypto.ts";
import { deleteRunJobs, RUN, service as sb, userClient } from "./_testenv.ts";

// 호스팅 DB. 전용 테스트 사용자·실행 태그만(AGENTS.md §7). 사용자 1은 다른 테스트·pane 과 공유하므로(리뷰 N2)
// 주소에 실행 태그를 넣고 unsub_list·audit 를 그 범위로만 읽고 지운다. 연결은 active(insert_item(GMAIL) 조건, 0013 — 리뷰 M4)이고
// refresh token 이 없어 cron 이 sync 를 넣어도 skipped. 끝나면 그 연결의 잡·행만 지운다(cascade)
const day = 86_400_000;
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
const TAG = RUN.slice(5);                                            // 'test:ab12cd34' → 'ab12cd34'
const A = (local: string) => `${local}-${TAG}@example.com`;          // 이 실행의 합성 주소
type ListRow = { sender_id: string; address: string; method: string; status: string; ads_30d: number; ads_after_request: number; can_request: boolean };
const mine = (rows: ListRow[] | null) => (rows ?? []).filter((r) => r.address.endsWith(`-${TAG}@example.com`));

async function setup(n = 1) {
  const { u, c } = await userClient(n);
  const { data, error } = await sb.from("connections").insert({ user_id: u.id, provider: "gmail",
    account_ref: `${RUN}-${crypto.randomUUID().slice(0, 8)}@example.com`, status: "active" }).select("id").single();
  assertEquals(error, null);
  return { u, c, conn: data!.id as string };
}
async function cleanup(user: string, conn: string) {
  const { data: senders } = await sb.from("unsub_senders").select("id").eq("user_id", user).eq("connection_id", conn);
  for (const s of senders ?? []) await sb.from("audit_log").delete().eq("user_id", user).like("target", `unsub:${s.id}%`);   // 자기 sender 의 감사 행만(리뷰 M5)
  await deleteRunJobs();
  await sb.from("jobs").delete().eq("user_id", user).eq("payload->>connection_id", conn);    // cron 이 이 연결에 넣었을 수 있는 잡
  await sb.from("items").delete().eq("user_id", user).like("idempotency_key", `${RUN}%`);
  await sb.from("items").delete().eq("user_id", user).like("idempotency_key", `gmail:${RUN}%`);   // 스캔 대상 테스트가 운영 키 형식으로 바꾼 항목
  await sb.from("connections").delete().eq("user_id", user).eq("id", conn);            // unsub_* cascade
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
  assert(id, "insert_item returned null — active Gmail connection missing?");
  if (status === "promo") {
    assertEquals((await sb.rpc("worker_record_gate", { p_user: user, p_item: id, p_label: "promo", p_confidence: 0.95 })).error, null);
    assertEquals((await sb.rpc("worker_quarantine_item", { p_user: user, p_item: id, p_status: "discarded:server:promo" })).error, null);
  }
  return id as string;
}
const begin = async (user: string, sender: string) => (await sb.rpc("unsub_begin", { p_user: user, p_sender: sender })).data;

Deno.test("unsub_list counts rule ads and gate-promo items only; 30-day window; url never returned; newsletter-only sender hidden", async () => {
  const { u, c, conn } = await setup();
  try {
    const promo = await item(u.id, "p1", "promo"), passed = await item(u.id, "q1", "queued");
    const a = await rec(u.id, conn, { addr: A("ads"), key: "a1", at: iso(day) });
    await rec(u.id, conn, { addr: A("ads"), key: "a2", at: iso(2 * day) });
    await rec(u.id, conn, { addr: A("ads"), key: "a3", at: iso(40 * day) });                // 30일 밖
    await rec(u.id, conn, { addr: A("ads"), key: "a4", at: iso(day), item: promo });       // 게이트 promo → 센다
    await rec(u.id, conn, { addr: A("ads"), key: "a5", at: iso(day), item: passed });      // 통과(거래) 메일 → 세지 않는다
    await rec(u.id, conn, { addr: A("news"), key: "n1", at: iso(day), item: passed, method: "link_only", url: null });
    const { data, error } = await c.rpc("unsub_list");
    assertEquals(error, null);
    const rows = mine(data);
    assertEquals(rows.map((r) => [r.address, r.ads_30d, r.method, r.can_request]), [[A("ads"), 3, "one_click", true]]);
    assertEquals(rows[0].sender_id, a);
    assert(!("url_enc" in rows[0]));
    assertEquals((await c.from("unsub_senders").select("id")).data, []);                       // 표 직접 읽기 불가(정책 없음)
    assertEquals((await c.from("unsub_mail").select("msg_key")).data, []);
  } finally {
    await cleanup(u.id, conn);
  }
});

// 리뷰 H2: 같은 From 의 더 최근 거래·뉴스레터 메일이 해지 URL 을 바꾸지 못한다. 복구된 항목은 후보에서 빠진다
Deno.test("H2: a newer non-ad mail never supplies the URL; one_click ad wins over a newer unverified ad; restored item drops out", async () => {
  const { u, c, conn } = await setup();
  try {
    const passed = await item(u.id, "q2", "queued");
    const s = await rec(u.id, conn, { addr: A("shop"), key: "h1", at: iso(2 * day), url: "https://u.example.com/AD" });               // 광고 A
    await rec(u.id, conn, { addr: A("shop"), key: "h2", at: iso(day), item: passed, url: "https://u.example.com/ORDER" });            // 더 최근 거래 B(one_click)
    await rec(u.id, conn, { addr: A("shop"), key: "h3", at: iso(1000), item: passed, method: "mailto", url: null });                  // 더 최근 거래 C(mailto)
    let { data } = await c.rpc("unsub_list");
    assertEquals(mine(data).map((r) => [r.address, r.method, r.ads_30d]), [[A("shop"), "one_click", 1]]);
    const b1 = await begin(u.id, s);
    assertEquals([b1.result, await decrypt(u.id, b1.url_enc)], ["ok", "https://u.example.com/AD"]);   // 합성 값이라 복호화 확인 가능
    await sb.rpc("unsub_finish", { p_user: u.id, p_sender: s, p_code: "http_500" });
    await rec(u.id, conn, { addr: A("shop"), key: "h4", at: iso(500), method: "unverified", url: null });                           // 더 최근 광고지만 unverified
    assertEquals(await decrypt(u.id, (await begin(u.id, s)).url_enc), "https://u.example.com/AD");                                   // one_click 광고가 우선
    // 유일한 광고가 게이트 promo 항목인 발신자: 사용자가 복구하면(queued) 광고가 아니다 → 요청 불가·목록에서 빠짐
    const promo = await item(u.id, "p2", "promo");
    const r = await rec(u.id, conn, { addr: A("restored"), key: "r1", at: iso(day), item: promo });
    assertEquals((await begin(u.id, r)).result, "ok");
    await sb.from("unsub_senders").update({ status: "active", status_at: null, attempts: 0 }).eq("id", r);
    await sb.from("items").update({ status: "queued" }).eq("id", promo);
    assertEquals(await begin(u.id, r), { result: "unsupported" });
    ({ data } = await c.rpc("unsub_list"));
    assertEquals(mine(data).map((x) => x.address).includes(A("restored")), false);
  } finally {
    await cleanup(u.id, conn);
  }
});

Deno.test("same message twice counts once; method/url stay on the mail row; sender name follows the newest mail", async () => {
  const { u, c, conn } = await setup();
  try {
    const promo = await item(u.id, "p3", "promo");
    await rec(u.id, conn, { addr: A("dup"), key: "d1", at: iso(day), name: "옛 이름" });
    await rec(u.id, conn, { addr: A("dup"), key: "d1", at: iso(day), item: promo });       // 스캔이 다시 읽음 → item 만 보충
    const { data: m } = await sb.from("unsub_mail").select("item_id, method").eq("user_id", u.id).eq("msg_key", `${RUN}:d1`);
    assertEquals(m, [{ item_id: promo, method: "one_click" }]);
    await rec(u.id, conn, { addr: A("dup"), key: "d2", at: iso(10 * day), method: "mailto", url: null, name: "더 옛 이름" });   // 더 오래된 메일
    await rec(u.id, conn, { addr: A("dup").toUpperCase(), key: "d3", at: iso(1000), method: "mailto", url: null, name: "새 이름" });   // 더 최근, 대문자 주소
    const { data: s } = await sb.from("unsub_senders").select("display_name").eq("user_id", u.id).eq("address", A("dup")).single();
    assertEquals(s!.display_name, "새 이름");
    const { data: list } = await c.rpc("unsub_list");
    assertEquals(mine(list).map((r) => [r.ads_30d, r.method]), [[3, "one_click"]]);     // 최신 메일이 mailto 여도 one_click 광고가 있으면 one_click
  } finally {
    await cleanup(u.id, conn);
  }
});

Deno.test("begin/finish: unsupported, ok + decrypt audit, busy within 60s, stale requesting restarts, requested → already, 3xx code fails, other user not_found, limit + can_request", async () => {
  const { u, c, conn } = await setup();
  try {
    const mail = await rec(u.id, conn, { addr: A("m"), key: "m1", at: iso(day), method: "mailto", url: null });
    assertEquals(await begin(u.id, mail), { result: "unsupported" });
    const s = await rec(u.id, conn, { addr: A("o"), key: "o1", at: iso(day) });
    assertEquals(await begin(crypto.randomUUID(), s), { result: "not_found" });              // 다른 사용자(존재하지 않는 id 로 충분)
    const b1 = await begin(u.id, s);
    assertEquals(b1.result, "ok");
    assert(String(b1.url_enc).startsWith("\\x"));
    assertEquals(await begin(u.id, s), { result: "busy" });
    await sb.from("unsub_senders").update({ status_at: iso(120_000) }).eq("id", s);          // 2분 전 시작한 채 끝남
    assertEquals((await begin(u.id, s)).result, "ok");
    assertEquals((await sb.rpc("unsub_finish", { p_user: u.id, p_sender: s, p_code: "ok" })).error, null);
    const { data: row } = await sb.from("unsub_senders").select("status, result_code, attempts, requested_at").eq("id", s).single();
    assertEquals([row!.status, row!.result_code, row!.attempts, row!.requested_at !== null], ["requested", "ok", 2, true]);
    assertEquals(await begin(u.id, s), { result: "already" });
    const { data: audit } = await sb.from("audit_log").select("action, target").eq("user_id", u.id).like("target", `unsub:${s}%`).order("id");
    assertEquals(audit!.map((a) => a.action), ["decrypt", "decrypt", "unsubscribe"]);
    assertEquals(audit![2].target, `unsub:${s} ok`);
    // 3xx 는 접수가 아니다(리뷰 M1)
    const f = await rec(u.id, conn, { addr: A("f"), key: "f1", at: iso(day) });
    await begin(u.id, f);
    await sb.rpc("unsub_finish", { p_user: u.id, p_sender: f, p_code: "redirect_302" });
    const { data: fr } = await sb.from("unsub_senders").select("status, result_code, requested_at").eq("id", f).single();
    assertEquals([fr!.status, fr!.result_code, fr!.requested_at], ["failed", "redirect_302", null]);
    // 한도 5회: begin 은 limit, 목록은 can_request = false(리뷰 N5)
    await sb.from("unsub_senders").update({ attempts: 5, status: "failed" }).eq("id", f);
    assertEquals(await begin(u.id, f), { result: "limit" });
    const { data: list } = await c.rpc("unsub_list");
    assertEquals(mine(list).find((r) => r.sender_id === f)?.can_request, false);
  } finally {
    await cleanup(u.id, conn);
  }
});

Deno.test("requested sender: ads after the 3-day grace reopen the request; ads inside the grace do not", async () => {
  const { u, c, conn } = await setup();
  try {
    const s = await rec(u.id, conn, { addr: A("g"), key: "g1", at: iso(6 * day) });
    await sb.from("unsub_senders").update({ status: "requested", status_at: iso(5 * day), requested_at: iso(5 * day), result_code: "ok" }).eq("id", s);
    await rec(u.id, conn, { addr: A("g"), key: "g2", at: iso(4 * day) });                  // 유예 안
    let { data } = await c.rpc("unsub_list");
    assertEquals(mine(data).map((r) => r.ads_after_request), [0]);
    assertEquals(await begin(u.id, s), { result: "already" });
    await rec(u.id, conn, { addr: A("g"), key: "g3", at: iso(day) });                      // 유예 뒤
    ({ data } = await c.rpc("unsub_list"));
    assertEquals(mine(data).map((r) => [r.status, r.ads_after_request]), [["requested", 1]]);
    assertEquals((await begin(u.id, s)).result, "ok");
  } finally {
    await cleanup(u.id, conn);
  }
});

// 리뷰 M6: 광고 메일 행이 정리돼도 30일 안에 요청한 발신자는 목록에 남는다(발신자 기준 left join)
Deno.test("requested sender stays listed after its ad rows are purged", async () => {
  const { u, c, conn } = await setup();
  try {
    const s = await rec(u.id, conn, { addr: A("gone"), key: "x1", at: iso(40 * day) });
    await sb.from("unsub_senders").update({ status: "requested", status_at: iso(7 * day), requested_at: iso(7 * day), result_code: "ok", last_seen_at: iso(40 * day) }).eq("id", s);
    assertEquals((await sb.rpc("purge_unsub", { p_user: u.id })).error, null);
    assertEquals((await sb.from("unsub_mail").select("msg_key").eq("sender_id", s)).data, []);
    const { data } = await c.rpc("unsub_list");
    assertEquals(mine(data).map((r) => [r.address, r.status, r.ads_30d, r.method]), [[A("gone"), "requested", 0, "none"]]);
  } finally {
    await cleanup(u.id, conn);
  }
});

Deno.test("scan targets, scan enqueue (test prefix, backfill lease, once), stats, purge by user, connection delete cascades, anon/authenticated cannot call worker RPCs", async () => {
  const { u, c, conn } = await setup();
  try {
    const promo = await item(u.id, "p4", "promo");
    await rec(u.id, conn, { addr: A("t"), key: "t1", at: iso(day) });
    const targets = async () => (await sb.rpc("unsub_scan_targets", { p_user: u.id, p_since: iso(30 * day) })).data;
    const mineT = async () => ((await targets()) ?? []).filter((t: { item_id: string }) => t.item_id === promo);
    assertEquals(await mineT(), []);                      // 테스트 키 'test:<run>:gmail:p4' 는 'gmail:%' 가 아니다 — 운영 키 형식만 고른다
    await sb.from("items").update({ idempotency_key: `gmail:${RUN}-p4` }).eq("id", promo);
    assertEquals(await mineT(), [{ gmail_id: `${RUN}-p4`, item_id: promo }]);
    await rec(u.id, conn, { addr: A("t"), key: `gmail:${RUN}-p4`, raw: true, at: iso(day), item: promo });
    assertEquals(await mineT(), []);                      // 이미 기록된 메일은 다시 읽지 않는다
    assertEquals((await sb.rpc("gmail_enqueue_unsub_scan", { p_user: u.id, p_lease_prefix: RUN + ":" })).data, 1);
    assertEquals((await sb.rpc("gmail_enqueue_unsub_scan", { p_user: u.id, p_lease_prefix: RUN + ":" })).data, 0);   // 이미 대기 중
    const { data: jobs } = await sb.from("jobs").select("kind, lease_key, priority, payload").eq("user_id", u.id).eq("kind", "gmail-unsub-scan").like("lease_key", `${RUN}%`);
    assertEquals(jobs!.map((j) => [j.lease_key, j.priority, j.payload.backfill, j.payload.lease_key, j.payload.connection_id]),
      [[`${RUN}:backfill:${u.id}`, 40, true, `${RUN}:backfill:${u.id}`, conn]]);
    assert((await sb.rpc("gmail_enqueue_unsub_scan", { p_user: u.id, p_lease_prefix: "evil:" })).error !== null);
    // 집계 RPC(리뷰 M8): 서버에서 센다. 사용자 1 공유라 이 실행이 더한 만큼 이상인지만 본다
    const { data: st, error: se } = await sb.rpc("unsub_stats", { p_user: u.id, p_jobs_since: iso(60_000) });
    assertEquals(se, null);
    assert(st.senders >= 1 && st.ads_30d >= 2 && (st.method_of_senders_with_ads.one_click ?? 0) >= 1, JSON.stringify(st));
    assert((st.jobs["gmail-unsub-scan:queued"] ?? 0) >= 1);
    // purge: 35일 지난 메일 행만, 이 사용자만
    await rec(u.id, conn, { addr: A("old"), key: "old", at: iso(40 * day) });
    await sb.from("unsub_senders").update({ last_seen_at: iso(40 * day) }).eq("user_id", u.id).eq("address", A("old"));
    const { data: p } = await sb.rpc("purge_unsub", { p_user: u.id });
    assertEquals([p.mail >= 1, p.senders >= 1], [true, true]);
    assertEquals((await sb.from("unsub_senders").select("id").eq("user_id", u.id).eq("address", A("old"))).data, []);
    assertEquals((await sb.from("unsub_senders").select("id").eq("user_id", u.id).eq("address", A("t"))).data!.length, 1);
    // 권한
    const anon = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, SERVER_AUTH);
    for (const [fn, args] of [["worker_record_unsub", {}], ["unsub_begin", { p_user: u.id, p_sender: conn }], ["purge_unsub", {}],
                              ["gmail_enqueue_unsub_scan", { p_user: u.id }], ["unsub_stats", { p_user: u.id }],
                              ["unsub_best", { p_user: u.id, p_sender: conn }], ["unsub_ad_mail", { p_user: u.id }]] as const) {
      assert((await c.rpc(fn, args)).error !== null, fn);
      assert((await anon.rpc(fn, args)).error !== null, fn);
    }
    assert((await anon.rpc("unsub_list")).error !== null);                                       // anon 실행 회수
    // 연결 삭제(출처 삭제 경로) → unsub_* cascade
    const { data: ids } = await sb.from("unsub_senders").select("id").eq("connection_id", conn);
    for (const s of ids ?? []) await sb.from("audit_log").delete().eq("user_id", u.id).like("target", `unsub:${s.id}%`);
    await deleteRunJobs();
    await sb.from("jobs").delete().eq("user_id", u.id).eq("payload->>connection_id", conn);
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
  last_seen_at timestamptz not null,
  status text not null default 'active' check (status in ('active', 'requesting', 'requested', 'failed')),
  status_at timestamptz,
  requested_at timestamptz,
  result_code text,
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  unique (connection_id, address)
  -- 해지 방법·URL 은 두지 않는다: 메일 행(unsub_mail)에서 광고로 세는 것만 고른다(리뷰 H2), URL 이 발신자 180일 보존에 끌려가지 않게
);
create table unsub_mail (
  user_id uuid not null references auth.users(id) on delete cascade,
  sender_id uuid not null references unsub_senders(id) on delete cascade,
  msg_key text not null,                     -- 'gmail:<id>'
  occurred_at timestamptz not null,
  item_id uuid references items(id) on delete cascade,   -- null = 규칙 광고. 있으면 그 항목이 게이트 promo 폐기일 때만 센다
  method text not null check (method in ('one_click', 'unverified', 'link_only', 'mailto', 'none')),
  url_enc bytea,                             -- one_click 해지 URL, 사용자 키 AES-256-GCM. 35일 뒤 행과 함께 삭제
  primary key (user_id, msg_key),
  check (method = 'one_click' or url_enc is null)
);
create index unsub_mail_sender_time on unsub_mail (sender_id, occurred_at);
create index unsub_mail_item on unsub_mail (item_id) where item_id is not null;
alter table unsub_senders enable row level security;
alter table unsub_mail enable row level security;
-- 정책 없음: 앱은 표를 직접 읽지 않고 unsub_list() 만 부른다(url_enc 를 클라이언트로 보내지 않는다)

-- gmail-fetch·스캔이 부른다. 연결이 이미 없으면 기록하지 않는다(null). 발신자 행은 더 최근 메일만 이름을 덮는다.
-- 같은 메일을 다시 읽으면(sync 뒤 스캔) item_id 만 보충한다
create or replace function worker_record_unsub(p_user uuid, p_connection uuid, p_address text, p_name text, p_method text,
  p_url_enc bytea, p_msg_key text, p_occurred_at timestamptz, p_item uuid default null) returns uuid language plpgsql as $$
declare v_id uuid;
begin
  if not exists (select 1 from connections where id = p_connection and user_id = p_user) then return null; end if;
  insert into unsub_senders as s (user_id, connection_id, address, display_name, last_seen_at)
  values (p_user, p_connection, lower(p_address), left(p_name, 60), p_occurred_at)
  on conflict (connection_id, address) do update set
    display_name = case when excluded.last_seen_at >= s.last_seen_at then coalesce(excluded.display_name, s.display_name) else s.display_name end,
    last_seen_at = greatest(s.last_seen_at, excluded.last_seen_at)
  returning id into v_id;
  insert into unsub_mail (user_id, sender_id, msg_key, occurred_at, item_id, method, url_enc)
  values (p_user, v_id, p_msg_key, p_occurred_at, p_item, p_method, case when p_method = 'one_click' then p_url_enc end)
  on conflict (user_id, msg_key) do update set item_id = coalesce(unsub_mail.item_id, excluded.item_id);
  return v_id;
end $$;

-- 광고로 세는 메일: 규칙 광고(item 없음) 또는 게이트 promo 폐기 항목. 복구되면(status 변경) 빠진다
create or replace function unsub_ad_mail(p_user uuid) returns table (sender_id uuid, msg_key text, occurred_at timestamptz, method text)
language sql stable as $$
  select m.sender_id, m.msg_key, m.occurred_at, m.method from unsub_mail m left join items i on i.id = m.item_id
  where m.user_id = p_user and (m.item_id is null or i.status = 'discarded:server:promo');
$$;

-- 발신자의 해지 방법·URL(리뷰 H2): 광고로 세는 메일 중 one_click 이 있으면 가장 최근 one_click, 없으면 가장 최근 메일.
-- 같은 From 의 거래·뉴스레터 메일(게이트 통과 항목)은 고르지 않는다. 없으면 0행
create or replace function unsub_best(p_user uuid, p_sender uuid) returns table (method text, url_enc bytea, msg_key text)
language sql stable as $$
  select m.method, m.url_enc, m.msg_key from unsub_mail m left join items i on i.id = m.item_id
  where m.user_id = p_user and m.sender_id = p_sender and (m.item_id is null or i.status = 'discarded:server:promo')
  order by (m.method = 'one_click') desc, m.occurred_at desc, m.msg_key desc
  limit 1;
$$;

-- 30일 스캔이 헤더를 다시 읽을 게이트 promo 항목(아직 기록 없는 것). 운영 키 형식 'gmail:<id>' 만
create or replace function unsub_scan_targets(p_user uuid, p_since timestamptz) returns table (gmail_id text, item_id uuid) language sql stable as $$
  select substr(i.idempotency_key, 7), i.id from items i
  where i.user_id = p_user and i.source = 'GMAIL' and i.status = 'discarded:server:promo'
    and i.occurred_at >= p_since and i.idempotency_key like 'gmail:%'
    and not exists (select 1 from unsub_mail m where m.user_id = p_user and m.msg_key = i.idempotency_key);
$$;

-- 운영자가 ③c2 뒤 워커 배포 직후 한 번 부른다(계획 U6b). 백필 레인 lease 'backfill:<user>'(연결 시 90일 백필과 같은 레인 — 실시간
-- sync 의 'gmail:<connection>' 을 막지 않고 계정 Gmail 호출이 직렬, 리뷰 M3). 테스트는 p_lease_prefix 'test:<run>:'(운영 워커 제외, 0003)
create or replace function gmail_enqueue_unsub_scan(p_user uuid, p_lease_prefix text default '') returns int language plpgsql as $$
declare n int;
begin
  if p_lease_prefix <> '' and p_lease_prefix not like 'test:%' then raise exception 'bad prefix'; end if;
  insert into jobs (kind, user_id, lease_key, payload)
  select 'gmail-unsub-scan', c.user_id, p_lease_prefix || 'backfill:' || c.user_id,
         jsonb_build_object('connection_id', c.id, 'backfill', true, 'lease_key', p_lease_prefix || 'backfill:' || c.user_id)
  from connections c
  where c.user_id = p_user and c.provider = 'gmail' and c.status = 'active'
    and not exists (select 1 from jobs j where j.user_id = p_user and j.kind = 'gmail-unsub-scan' and j.status in ('queued', 'running'));
  get diagnostics n = row_count;
  return n;
end $$;

-- Edge unsubscribe 가 부른다. 행 잠금으로 같은 발신자 동시 요청을 직렬화. 60초 안 재요청 busy, 60초 넘은 requesting 은 다시 시작.
-- URL 은 이 시점의 광고 메일에서 다시 고른다(unsub_best) — 목록을 본 뒤 바뀌어도 같은 발신자의 광고 해지 주소다
create or replace function unsub_begin(p_user uuid, p_sender uuid) returns jsonb language plpgsql as $$
declare s unsub_senders; b record; v_after int;
begin
  select * into s from unsub_senders where id = p_sender and user_id = p_user for update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  select * into b from unsub_best(p_user, p_sender);
  if not found or b.method <> 'one_click' or b.url_enc is null then return jsonb_build_object('result', 'unsupported'); end if;
  if s.status = 'requesting' and s.status_at > now() - interval '60 seconds' then return jsonb_build_object('result', 'busy'); end if;
  if s.status = 'requested' then
    select count(*) into v_after from unsub_ad_mail(p_user) a
    where a.sender_id = p_sender and a.occurred_at > s.requested_at + interval '3 days';
    if v_after = 0 then return jsonb_build_object('result', 'already'); end if;
  end if;
  if s.attempts >= 5 then return jsonb_build_object('result', 'limit'); end if;
  update unsub_senders set status = 'requesting', status_at = now(), attempts = attempts + 1 where id = p_sender;
  insert into audit_log (user_id, actor, action, target) values (p_user, 'unsubscribe', 'decrypt', 'unsub:' || p_sender);
  return jsonb_build_object('result', 'ok', 'url_enc', b.url_enc);
end $$;

-- 2xx('ok')만 접수. 3xx(redirect_<n>)·차단·오류는 failed(리뷰 M1)
create or replace function unsub_finish(p_user uuid, p_sender uuid, p_code text) returns void language plpgsql as $$
declare v_ok boolean := p_code = 'ok';
begin
  update unsub_senders set status = case when v_ok then 'requested' else 'failed' end, status_at = now(),
    requested_at = case when v_ok then now() else requested_at end, result_code = left(p_code, 40)
  where id = p_sender and user_id = p_user and status = 'requesting';
  insert into audit_log (user_id, actor, action, target) values (p_user, 'unsubscribe', 'unsubscribe', 'unsub:' || p_sender || ' ' || left(p_code, 40));
end $$;

-- 앱 목록(authenticated). url_enc 는 내보내지 않는다. 발신자 기준 left join — 광고 메일 행이 정리돼도 30일 안 요청·실패는 남는다(리뷰 M6)
create or replace function unsub_list() returns table (sender_id uuid, display_name text, address text, method text, status text,
  status_at timestamptz, requested_at timestamptz, result_code text, ads_30d int, ads_after_request int, last_ad_at timestamptz, can_request boolean)
language sql stable security definer set search_path = public as $$
  with ad as (select a.sender_id, a.occurred_at from unsub_ad_mail((select auth.uid())) a),
  agg as (
    select s.id, s.display_name, s.address, s.status, s.status_at, s.requested_at, s.result_code, s.attempts,
      (count(ad.occurred_at) filter (where ad.occurred_at >= now() - interval '30 days'))::int as n30,
      (count(ad.occurred_at) filter (where s.requested_at is not null and ad.occurred_at > s.requested_at + interval '3 days'))::int as n_after,
      max(ad.occurred_at) as last_at
    from unsub_senders s left join ad on ad.sender_id = s.id
    where s.user_id = (select auth.uid())
    group by s.id)
  select agg.id, agg.display_name, agg.address, coalesce(b.method, 'none'), agg.status, agg.status_at, agg.requested_at, agg.result_code,
         agg.n30, agg.n_after, agg.last_at, agg.attempts < 5
  from agg left join lateral unsub_best((select auth.uid()), agg.id) b on true
  where agg.n30 > 0 or (agg.status in ('requested', 'failed') and agg.status_at >= now() - interval '30 days')
  order by agg.n30 desc, agg.last_at desc nulls last
  limit 100;
$$;

-- 35일 지난 메일 행(URL 포함), 메일 행 없고 마지막 수신 35일 지난 발신자(해지 요청 180일 이내 제외). p_user = 테스트 범위
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

-- 실측 집계(계획 U6b·U10, unsub-stats.ts). 개수·방법·상태·결과 코드만 — 주소·이름·URL 없음. 서버에서 세므로 PostgREST 행 상한과 무관(리뷰 M8).
-- p_jobs_since 가 있으면 그 뒤에 만든 스캔 잡만 센다(이번 스캔 실행 대조)
create or replace function unsub_stats(p_user uuid, p_jobs_since timestamptz default null) returns jsonb language sql stable as $$
  with ad as (select * from unsub_ad_mail(p_user) a where a.occurred_at >= now() - interval '30 days'),
  s as (
    select s.id, s.status, s.result_code, coalesce(b.method, 'none') as method, exists (select 1 from ad where ad.sender_id = s.id) as has_ad
    from unsub_senders s left join lateral unsub_best(p_user, s.id) b on true
    where s.user_id = p_user),
  j as (
    select kind || ':' || status as k from jobs
    where user_id = p_user and kind in ('gmail-unsub-scan', 'gmail-unsub-fetch') and (p_jobs_since is null or created_at >= p_jobs_since))
  select jsonb_build_object(
    'senders', (select count(*) from s),
    'senders_with_ads_30d', (select count(*) from s where has_ad),
    'ads_30d', (select count(*) from ad),
    'method_of_senders_with_ads', coalesce((select jsonb_object_agg(method, n) from (select method, count(*) as n from s where has_ad group by method) x), '{}'::jsonb),
    'status', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) as n from s group by status) x), '{}'::jsonb),
    'result_codes', coalesce((select jsonb_object_agg(result_code, n) from (select result_code, count(*) as n from s where result_code is not null group by result_code) x), '{}'::jsonb),
    'jobs', coalesce((select jsonb_object_agg(k, n) from (select k, count(*) as n from j group by k) x), '{}'::jsonb));
$$;

revoke execute on function worker_record_unsub(uuid, uuid, text, text, text, bytea, text, timestamptz, uuid), unsub_ad_mail(uuid),
  unsub_best(uuid, uuid), unsub_scan_targets(uuid, timestamptz), gmail_enqueue_unsub_scan(uuid, text), unsub_begin(uuid, uuid),
  unsub_finish(uuid, uuid, text), purge_unsub(uuid), unsub_stats(uuid, timestamptz) from public, anon, authenticated;
revoke execute on function unsub_list() from public, anon;
grant execute on function unsub_list() to authenticated;

select cron.schedule('unsub-purge-daily', '43 4 * * *', $$ select purge_unsub(); $$);
```

- [ ] **Step 3: 창 확인 후 `db push` + DB 테스트 (창 밖)**

메인이 Gmail 측정 창 밖임을 확인한 뒤에만:

Run: `git status --short supabase/migrations; ls supabase/migrations | tail -3; supabase db push --dry-run`
Expected: 새 파일은 `0028_unsubscribe.sql` 하나, dry-run 목록도 그 하나.

Run: `vm_stat | grep -E 'free|compressor'; supabase db push && deno test --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/tests/unsub-db.test.ts`
Expected: push 후 PASS(7개). 실패하면 테스트·SQL을 고치되 **적용된 0028은 고치지 않고** 새 마이그레이션(다음 번호)으로 `create or replace`한다.

- [ ] **Step 4: 회귀 DB 테스트**

Run: `deno test --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/tests/quarantine-db.test.ts supabase/tests/retention-db.test.ts supabase/tests/jobs-priority-db.test.ts supabase/tests/account.test.ts`
Expected: PASS(기존 그대로 — 새 표는 기존 함수 동작을 바꾸지 않는다).

- [ ] **Step 5: 커밋**

```bash
git add supabase/migrations/0028_unsubscribe.sql supabase/tests/unsub-db.test.ts
git commit -m "feat(server): 0028 unsubscribe tables and RPCs — unsub_senders (per connection+address, status/attempts, no url) and unsub_mail (one row per message key with method and encrypted one_click url, item link counts only when the item is a gate promo discard), unsub_best picks the url only from mails counted as ads (one_click first, then newest), worker_record_unsub, unsub_list for the app without url (sender-based left join, 30-day ads, ads after the 3-day grace, can_request), unsub_begin/finish (row lock, busy 60s, stale restart, already, limit 5, only 2xx 'ok' is requested, decrypt and result audit), scan targets/enqueue (backfill:<user> lease, test prefix), unsub_stats server-side aggregates, purge_unsub daily cron (35 days, requested senders kept 180 days) (spec §7·§8, review H2/M1/M3/M4/M5/M6/M8/N2/N5)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task U4: 워커 — fetch 기록·30일 스캔 잡

**Files:**
- Modify: `supabase/functions/_shared/gmail.ts` (`META_HEADERS`, `getMessageMeta`, `GmailClient`·`gmailApi`)
- Modify: `supabase/functions/_shared/gmail-jobs.ts` (`GmailJobDeps` 선택 필드 2개, `recordUnsub`, `enqueueUnsubRescan`, `unsubScanQuery`, `gmailUnsubScan`, `gmailUnsubFetch`, `gmailFetch`의 두 분기, `gmailSync` 훅 한 줄)
- Modify: `supabase/functions/worker/index.ts` (핸들러 2개)
- Modify: `supabase/tests/gmail.test.ts` (`fakeDeps` 기본값에 `getMessageMeta` 한 줄 — 단언은 바꾸지 않는다)
- Test: `supabase/tests/unsub-jobs.test.ts`

**Interfaces:**
- Consumes: U1 `unsubMeta`·`hasListUnsub`·`isAdMail`, U3 RPC `worker_record_unsub`·`unsub_scan_targets`·`enqueue_job`(기존).
- Produces:
  - `getMessageMeta(accessToken, id): Promise<GmailMessage>`, `GmailClient.getMessageMeta(id)`
  - `GmailJobDeps.onResync?(sb, user, conn, lastSuccessAt): Promise<void>`(기본 `enqueueUnsubRescan`), `GmailJobDeps.unsubBudgetMs?: number`(기본 2000)
  - `recordUnsub(sb: RpcClient, deps: Pick<GmailJobDeps, "encrypt" | "unsubBudgetMs">, user: string, conn: string, msg: GmailMessage, itemId: string | null): Promise<"recorded" | "skipped" | "error">` — throw하지 않고, RPC·암호화가 예산을 넘기면 기다리지 않고 `"error"`(리뷰 H4)
  - `enqueueUnsubRescan(sb, user, conn, lastSuccessAt): Promise<void>` — throw하지 않는다(리뷰 N4)
  - 잡 `gmail-unsub-scan`(payload `{connection_id, backfill: true, lease_key, after?: number}`) → `gmail-unsub-fetch`(payload `{connection_id, backfill: true, msgs: {id: string; item: string | null}[]}`, ≤50, lease = 부모 payload `lease_key`, 없으면 `backfill:<user>`)
  - `UNSUB_SCAN_Q = "newer_than:30d {category:promotions subject:광고} -in:drafts"`, `unsubScanQuery(after?: number | null): string`

- [ ] **Step 0: Gmail API 단가 확인 (문서 1회)**

공식 사용 한도 문서(`https://developers.google.com/workspace/gmail/api/reference/quota`)에서 `messages.get`·`messages.list` 단가와 사용자당 분당 한도를 확인해 원장에 한 줄 적는다(리뷰 M3 — Codex는 `messages.get` 20 units라 했고 Fable은 미확인). `FETCH_GAP_MS = 240`(분당 250건) × 단가가 사용자당 분당 한도를 넘으면 스캔 fetch에만 쓰는 간격 `UNSUB_FETCH_GAP_MS`를 따로 두고(분당 한도의 절반 이하) `gmailUnsubFetch`의 `deps.pause` 인자를 그 값으로 바꾼다. 스캔은 `backfill:<user>` lease라 연결 백필 fetch와 동시에 돌지 않는다(F20).

- [ ] **Step 1: 실패하는 테스트 작성**

`supabase/tests/unsub-jobs.test.ts`:

```ts
import { assert, assertEquals, assertRejects } from "jsr:@std/assert";
import type { GmailClient, GmailMessage } from "../functions/_shared/gmail.ts";
import { GmailHttpError } from "../functions/_shared/gmail.ts";
import {
  enqueueUnsubRescan, gmailFetch, type GmailJobDeps, gmailSync, gmailUnsubFetch, gmailUnsubScan, recordUnsub, type RpcClient, UNSUB_SCAN_Q, unsubScanQuery,
} from "../functions/_shared/gmail-jobs.ts";
import type { Job } from "../functions/_shared/job.ts";

const USER = "00000000-0000-0000-0000-0000000000aa", CONN = "00000000-0000-0000-0000-0000000000cc";
const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
// U1 규칙: AR 의 dkim=pass 가 selector·b= 앞부분으로 서명 하나를 특정해야 one_click
const SIG = "v=1; d=example.com; s=s1; h=From:List-Unsubscribe:List-Unsubscribe-Post; b=AbCdEf12rest";
const AR = "mx.google.com; dkim=pass header.i=@example.com header.s=s1 header.b=AbCdEf12";
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

// 리뷰 H4: 기록 RPC 가 끝나지 않아도 gmail-fetch 는 예산 안에 다음 메일로 간다
Deno.test("gmail-fetch: a hanging record RPC does not hold the fetch (budget → 'error', mail still stored)", async () => {
  const calls: string[] = [];
  const results: Record<string, unknown> = { ...ST, insert_item: "item-n" };
  const rpc: RpcClient = { rpc: (fn, _args = {}) => {
    calls.push(fn);
    if (fn === "worker_record_unsub") return new Promise(() => {});                         // 끝나지 않는 RPC
    return Promise.resolve({ data: fn in results ? results[fn] : null, error: null });
  } };
  const t0 = Date.now();
  assertEquals(await recordUnsub(rpc, { ...fakeDeps(), unsubBudgetMs: 50 }, USER, CONN, mk("m1", { lu: true }), null), "error");
  const msgs: Record<string, GmailMessage> = { p: mk("p", { labels: ["CATEGORY_PROMOTIONS"], lu: true }), n: mk("n", { lu: true }) };
  assertEquals(await gmailFetch(rpc, job("gmail-fetch", { ids: ["p", "n"] }), { ...fakeDeps({ getMessage: async (id) => msgs[id] }), unsubBudgetMs: 50 }), "fetched");
  assert(Date.now() - t0 < 2000, "budget not applied");
  assertEquals(calls.filter((f) => f === "insert_item").length, 1);                         // 광고 기록이 멈춰도 다음 메일은 저장됐다
});

Deno.test("gmail-unsub-scan: list query + gate targets → gmail-unsub-fetch jobs of 50 on the payload lease, backfill lane", async () => {
  const ids = Array.from({ length: 70 }, (_, i) => "s" + i);
  const qs: string[] = [];
  const { rpc, calls } = fakeRpc({ ...ST, unsub_scan_targets: [{ gmail_id: "s3", item_id: "item-3" }, { gmail_id: "g1", item_id: "item-g" }] });
  const deps = fakeDeps({ listMessageIds: async (q, p) => { qs.push(q); return p ? { messages: ids.slice(60).map((id) => ({ id })) } : { messages: ids.slice(0, 60).map((id) => ({ id })), nextPageToken: "1" }; } });
  assertEquals(await gmailUnsubScan(rpc, job("gmail-unsub-scan", { backfill: true, lease_key: "test:r:backfill:" + USER }), deps), "scanned");
  assertEquals(qs, [UNSUB_SCAN_Q, UNSUB_SCAN_Q]);
  const enq = calls.filter((c) => c.fn === "enqueue_job");
  assertEquals(enq.map((c) => [c.args.p_kind, c.args.p_lease_key, (c.args.p_payload as { msgs: unknown[] }).msgs.length]),
    [["gmail-unsub-fetch", "test:r:backfill:" + USER, 50], ["gmail-unsub-fetch", "test:r:backfill:" + USER, 21]]);
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

// 리뷰 M2: 스캔은 기록 자체가 목적이라 실패를 done 으로 숨기지 않는다(잡 재시도, 기록은 멱등)
Deno.test("gmail-unsub-fetch: a record error fails the job for retry", async () => {
  const { rpc } = fakeRpc(ST, ["worker_record_unsub"]);
  const deps = fakeDeps({ getMessageMeta: async (id) => mk(id, { lu: true }) });
  await assertRejects(() => gmailUnsubFetch(rpc, job("gmail-unsub-fetch", { msgs: [{ id: "a", item: "item-a" }] }), deps), Error, "unsub_record_error");
});

// 리뷰 N4: 재동기화 공백 스캔은 after: 로 그 구간만, 30일보다 오래되면 30일로 자른다
Deno.test("gmail-unsub-scan: payload.after narrows the list query and gate targets; lease defaults to backfill:<user>", async () => {
  const after = Math.floor(Date.now() / 1000) - 3 * 86_400;
  assertEquals(unsubScanQuery(after), `after:${after} {category:promotions subject:광고} -in:drafts`);
  assertEquals(unsubScanQuery(null), UNSUB_SCAN_Q);
  const qs: string[] = [];
  const { rpc, calls } = fakeRpc({ ...ST, unsub_scan_targets: [] });
  const deps = fakeDeps({ listMessageIds: async (q) => { qs.push(q); return { messages: [{ id: "x1" }] }; } });
  assertEquals(await gmailUnsubScan(rpc, job("gmail-unsub-scan", { backfill: true, after }), deps), "scanned");
  assertEquals(qs, [unsubScanQuery(after)]);
  assertEquals(calls.find((c) => c.fn === "unsub_scan_targets")!.args.p_since, new Date(after * 1000).toISOString());
  assertEquals(calls.find((c) => c.fn === "enqueue_job")!.args.p_lease_key, "backfill:" + USER);
  const old = Math.floor(Date.now() / 1000) - 90 * 86_400;
  const { rpc: r2 } = fakeRpc({ ...ST, unsub_scan_targets: [] });
  qs.length = 0;
  await gmailUnsubScan(r2, job("gmail-unsub-scan", { backfill: true, after: old }), deps);
  assert(Number(qs[0].match(/^after:(\d+) /)![1]) > old + 50 * 86_400, qs[0]);              // 30일로 잘림
});

Deno.test("gmail-sync: resync calls onResync once with the last success time, history mode does not; enqueueUnsubRescan never throws", async () => {
  const seen: string[] = [];
  const onResync = async (_sb: RpcClient, u: string, c: string, at: string) => { seen.push(`${u}|${c}|${at}`); };
  const { rpc } = fakeRpc(ST);
  assertEquals(await gmailSync(rpc, job("gmail-sync"), { ...fakeDeps(), onResync }), "resync");     // fakeDeps 기본 history = 404
  assertEquals(seen, [`${USER}|${CONN}|2026-09-20T00:00:00Z`]);
  const hist = fakeDeps({ history: async () => ({ history: [], historyId: "2" }) });
  assertEquals(await gmailSync(rpc, job("gmail-sync"), { ...hist, onResync }), "history");
  assertEquals(seen.length, 1);
  const { rpc: r2, calls: c2 } = fakeRpc();
  await enqueueUnsubRescan(r2, USER, CONN, "2026-09-20T00:00:00Z");
  assertEquals(c2.map((c) => [c.args.p_kind, c.args.p_lease_key, c.args.p_payload]), [["gmail-unsub-scan", "backfill:" + USER,
    { connection_id: CONN, backfill: true, lease_key: "backfill:" + USER, after: Math.floor(Date.parse("2026-09-20T00:00:00Z") / 1000) - 86_400 }]]);
  const { rpc: bad } = fakeRpc({}, ["enqueue_job"]);
  await enqueueUnsubRescan(bad, USER, CONN, "2026-09-20T00:00:00Z");                           // 실패를 삼킨다(sync 는 계속)
});
```

- [ ] **Step 2: 실패 확인**

Run: `deno test --allow-net --allow-env --allow-read supabase/tests/unsub-jobs.test.ts`
Expected: FAIL — `recordUnsub`·`enqueueUnsubRescan`·`gmailUnsubScan`·`gmailUnsubFetch`·`UNSUB_SCAN_Q`·`unsubScanQuery` export 없음.

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

`GmailJobDeps` 타입 끝(`topic(): string;` 아래)에 선택 필드 두 줄 — 기존 테스트의 가짜 deps(F22)는 바꾸지 않아도 된다:

```ts
  onResync?(sb: RpcClient, user: string, conn: string, lastSuccessAt: string): Promise<void>;   // 재동기화 공백의 광고 헤더 스캔(스펙 §7)
  unsubBudgetMs?: number;                                                                     // recordUnsub 예산(기본 2000)
```

`defaultGmailDeps`에 `onResync: enqueueUnsubRescan,` 한 줄(함수 선언이라 아래에 있어도 된다).

`FETCH_GAP_MS` 정의 아래에 추가:

```ts
export const UNSUB_SCAN_Q = "newer_than:30d {category:promotions subject:광고} -in:drafts";
export const unsubScanQuery = (after?: number | null) => (after ? `after:${after} {category:promotions subject:광고} -in:drafts` : UNSUB_SCAN_Q);
const RECORD_BUDGET_MS = 2000;

// 광고 구독 해지(스펙 §7): 헤더 메타만 기록한다. 절대 throw하지 않는다 — gmail-fetch 를 실패시키면 거래 메일까지 유실된다(fail-open).
// RPC·암호화가 예산을 넘기면 기다리지 않는다(리뷰 H4 — catch 만으로는 멈춘 RPC 가 fetch 루프를 붙잡는다). 늦게 끝난 기록은 그대로 남는다(멱등)
export async function recordUnsub(sb: RpcClient, deps: Pick<GmailJobDeps, "encrypt" | "unsubBudgetMs">, user: string, conn: string, msg: GmailMessage,
                                  itemId: string | null): Promise<"recorded" | "skipped" | "error"> {
  let timer: number | undefined;
  try {
    const m = unsubMeta(msg);
    if (!m) return "skipped";
    const work = (async () => {
      const { error } = await sb.rpc("worker_record_unsub", {
        p_user: user, p_connection: conn, p_address: m.address, p_name: m.name, p_method: m.method,
        p_url_enc: m.url ? toBytea(await deps.encrypt(user, m.url)) : null,
        p_msg_key: "gmail:" + msg.id, p_occurred_at: new Date(Number(msg.internalDate)).toISOString(), p_item: itemId,
      });
      if (error) throw new Error("worker_record_unsub " + (error.code ?? "error"));
    })();
    work.catch(() => {});                                       // 예산을 넘긴 뒤 늦게 난 거부가 처리되지 않은 거부로 남지 않게
    const budget = new Promise<never>((_, rej) => {
      timer = setTimeout(() => rej(new Error("unsub_record_timeout")), deps.unsubBudgetMs ?? RECORD_BUDGET_MS);
    });
    await Promise.race([work, budget]);
    return "recorded";
  } catch {
    console.log(JSON.stringify({ connection_id: conn, code: "unsub_record_error" }));   // 코드만(주소·URL 없음)
    return "error";
  } finally {
    clearTimeout(timer);
  }
}

// 재동기화(history 404) 구간의 광고는 resync 목록(-category:promotions)에 없다 → 같은 구간만 헤더 스캔 잡(스펙 §7, 리뷰 N4).
// gmailSync 의 기본 onResync. 실패해도 sync 는 계속한다(throw 하지 않음)
export async function enqueueUnsubRescan(sb: RpcClient, user: string, conn: string, lastSuccessAt: string): Promise<void> {
  try {
    const lease = "backfill:" + user;
    await call(sb, "enqueue_job", { p_user: user, p_kind: "gmail-unsub-scan", p_lease_key: lease,
      p_payload: { connection_id: conn, backfill: true, lease_key: lease, after: Math.floor(new Date(lastSuccessAt).getTime() / 1000) - 86_400 } });
  } catch {
    console.log(JSON.stringify({ connection_id: conn, code: "unsub_rescan_enqueue_error" }));
  }
}
```

`gmailSync`에서 `await call(sb, "gmail_update", { … p_cursor: r.cursor });` 줄 바로 아래에 한 줄(기존 테스트의 가짜 deps에는 `onResync`가 없어 호출 순서 단언이 그대로다 — F22):

```ts
  if (r.mode === "resync" && deps.onResync) await deps.onResync(sb, user, conn, st.last_success_at);   // 공백 구간 광고 스캔(스펙 §7)
```

`gmailFetch`의 루프 안 `const it = gmailToItem(msg);` 아래 분기를 다음으로 바꾼다(앞뒤 줄은 그대로):

```ts
    const it = gmailToItem(msg);                                   // /ingest와 같은 서버 규칙 필터
    if (it.kind === "discard") {
      discarded++;
      console.log(JSON.stringify({ connection_id: conn, gmail_discard: it.reason }));   // 사유 코드만
      if (it.reason === "promotion") await recordUnsub(sb, deps, user, conn, msg, null);   // 광고 헤더 메타(§7), fail-open
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

카운터·마지막 로그 `gmail_fetch: { stored, discarded, gone }`는 **바꾸지 않는다** — 기존 `gmail.test.ts`의 404 테스트가 그 모양을 정확히 단언한다(F22, 단언 수정 금지). 기록 실패는 `unsub_record_error` 줄로만 남는다.

`gmailWatch` 함수 앞에 추가:

```ts
// 광고 구독 해지 스캔(스펙 §7): 30일 1회(운영자가 gmail_enqueue_unsub_scan, ③c2 뒤) 또는 재동기화 공백(payload.after, enqueueUnsubRescan).
// 헤더만 읽는 자식 잡을 50개씩 넣는다. 백필 레인 lease 'backfill:<user>' — 실시간 sync 를 막지 않는다(리뷰 M3)
export async function gmailUnsubScan(sb: RpcClient, job: Job, deps = defaultGmailDeps): Promise<string> {
  const { user, conn } = ids(job);
  const token = await accessToken(sb, deps, user, conn);
  if (!token) return "skipped";
  const api = deps.api(token);
  const floor = Math.floor(Date.now() / 1000) - 30 * 86_400;     // 공백 스캔도 30일보다 오래된 구간은 읽지 않는다(화면이 30일)
  const after = typeof job.payload.after === "number" ? Math.max(job.payload.after, floor) : null;
  const want = new Map<string, string | null>();                 // gmail id → 게이트 promo 항목 id(없으면 라벨·표기로 다시 판정)
  let pageToken: string | undefined;
  do {
    const p = await api.listMessageIds(unsubScanQuery(after), pageToken);
    for (const m of p.messages ?? []) want.set(m.id, null);
    pageToken = p.nextPageToken;
  } while (pageToken);
  const listed = want.size;
  const since = new Date((after ?? floor) * 1000).toISOString();
  const targets = await call(sb, "unsub_scan_targets", { p_user: user, p_since: since }) as { gmail_id: string; item_id: string }[];
  for (const t of targets ?? []) want.set(t.gmail_id, t.item_id);
  const msgs = [...want].map(([id, item]) => ({ id, item }));
  const lease = typeof job.payload.lease_key === "string" ? job.payload.lease_key : "backfill:" + user;
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
    if (item || isAdMail(msg)) {
      // 스캔은 기록 자체가 목적이라 실패를 done 으로 숨기지 않는다 — 잡 재시도(기록은 멱등, 리뷰 M2)
      const r = await recordUnsub(sb, deps, user, conn, msg, item);
      if (r === "error") throw new Error("unsub_record_error");
      if (r === "recorded") recorded++; else skipped++;
    } else skipped++;
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
Expected: PASS(새 9개 + `gmail.test.ts` 기존 전부 — 단언 수정 없이), `deno check` 무오류. `gmail.test.ts`가 하나라도 실패하면 이 태스크는 끝나지 않는다(Global Constraints "Gmail 수집 회귀 금지"). 이 태스크는 배포하지 않는다 — 워커 배포는 U6b(③c2 뒤).

- [ ] **Step 6: 커밋**

```bash
git add supabase/functions/_shared/gmail.ts supabase/functions/_shared/gmail-jobs.ts supabase/functions/worker/index.ts supabase/tests/unsub-jobs.test.ts supabase/tests/gmail.test.ts
git commit -m "feat(server): gmail-fetch records ad header metadata — promotion discards without an item, stored mail with List-Unsubscribe linked by item id (counted only if the gate says promo), fail-open recordUnsub with a 2s budget (log code only); gmail-unsub-scan (30-day promotions/(광고) list or the resync gap via after:, plus gate promo targets) → gmail-unsub-fetch jobs of 50 reading format=metadata on the backfill:<user> lease, record errors fail the job for retry; gmailSync resync hook enqueues the gap scan (optional deps, existing tests untouched) (spec §7, review H4/M2/M3/N4)

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
- Consumes: U2 `oneClickPost`·`resolverKind`, U3 `unsub_begin`·`unsub_finish`·`worker_record_unsub`·`gmail_enqueue_unsub_scan`·`unsub_list`·`unsub_stats`, `_shared/crypto.ts` `decrypt`·`encrypt`·`toBytea`.
- Produces:
  - `POST /functions/v1/unsubscribe` (사용자 JWT, body `{sender_id: uuid}`) → 200 `{result: "requested" | "failed" | "unsupported" | "already" | "busy" | "limit" | "not_found", code?: PostCode | "error"}`(`requested`는 `code === "ok"`일 때만), 401 세션 없음, 400 `bad_json`·`bad_sender`, 405
  - `POST /functions/v1/unsubscribe/sink/<UNSUB_SINK_KEY>` (인증 없음, 스모크·시뮬레이터 게이트 전용, 리뷰 N10): 본문이 정확히 `List-Unsubscribe=One-Click`이면 200, 아니면 400. `…/<key>/redirect`는 307 → `…/<key>`. secret `UNSUB_SINK_KEY`가 없거나 키가 다르면 404
  - `type Sink = { base: string; key: string } | null`, `handleUnsubscribe(req: Request, deps: UnsubDeps, sink: Sink): Promise<Response>`
  - `UnsubDeps = { authUser(token): Promise<string | null>; begin(user, sender): Promise<{ result: string; url_enc?: string }>; decrypt(user, enc: string): Promise<string>; post(url): Promise<{ ok: boolean; code: string }>; finish(user, sender, code): Promise<void> }`

- [ ] **Step 1: 실패하는 테스트 작성**

`supabase/tests/unsubscribe.test.ts`:

```ts
import { assertEquals } from "jsr:@std/assert";
import { handleUnsubscribe, type Sink, type UnsubDeps } from "../functions/unsubscribe/handler.ts";

const SID = "11111111-2222-3333-4444-555555555555";
const SINK: Sink = { base: "https://proj.example.com/functions/v1/unsubscribe/sink", key: "k123abc" };
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

Deno.test("post failure, redirect and decrypt failure are recorded as failed with a code", async () => {
  for (const code of ["blocked_private", "redirect_307"]) {                                   // 3xx 는 접수가 아니다(리뷰 M1)
    const { d, log } = deps({ post: async () => ({ ok: false, code }) });
    assertEquals(await (await handleUnsubscribe(req({ sender_id: SID }), d, SINK)).json(), { result: "failed", code });
    assertEquals(log, [`finish:${SID}:${code}`]);
  }
  {
    const { d, log } = deps({ decrypt: () => Promise.reject(new Error("bad key")) });
    assertEquals(await (await handleUnsubscribe(req({ sender_id: SID }), d, SINK)).json(), { result: "failed", code: "error" });
    assertEquals(log, [`finish:${SID}:error`]);
  }
});

// 리뷰 N10: sink 는 secret 키 경로에서만 열린다
Deno.test("sink: only under the secret key; exact one-click body; /<key>/redirect → 307; closed without the secret", async () => {
  const { d } = deps();
  const at = (path: string, body = "List-Unsubscribe=One-Click", s: Sink = SINK) => handleUnsubscribe(req(body, null, path), d, s);
  assertEquals((await at("/unsubscribe/sink/k123abc")).status, 200);
  assertEquals((await at("/unsubscribe/sink/k123abc", "hello")).status, 400);
  const r = await at("/unsubscribe/sink/k123abc/redirect");
  assertEquals([r.status, r.headers.get("location")], [307, SINK!.base + "/k123abc"]);
  assertEquals((await at("/unsubscribe/sink/wrong")).status, 404);
  assertEquals((await at("/unsubscribe/sink")).status, 404);
  assertEquals((await at("/unsubscribe/sink/k123abc", undefined, null)).status, 404);
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
export type Sink = { base: string; key: string } | null;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 스모크·시뮬레이터 게이트 전용 수신처: 공인 주소 경로의 실제 POST·307 을 잰다. secret UNSUB_SINK_KEY 경로에서만 열린다(리뷰 N10).
// 본문이 정확히 원클릭 문자열일 때만 200, 아무것도 저장·기록하지 않는다
async function sink(req: Request, path: string, s: Sink): Promise<Response> {
  const m = path.match(/\/unsubscribe\/sink\/([^/]+)(\/redirect)?\/?$/);
  if (!s || !m || m[1] !== s.key) return new Response(null, { status: 404 });
  if (req.method !== "POST") return new Response(null, { status: 405 });
  const body = (await req.text().catch(() => "")).trim();
  if (body !== "List-Unsubscribe=One-Click") return new Response(null, { status: 400 });
  if (m[2]) return new Response(null, { status: 307, headers: { location: `${s.base}/${s.key}` } });
  return new Response(null, { status: 200 });
}

export async function handleUnsubscribe(req: Request, deps: UnsubDeps, sinkCfg: Sink): Promise<Response> {
  const path = new URL(req.url).pathname;
  if (/\/unsubscribe\/sink(\/|$)/.test(path)) return await sink(req, path, sinkCfg);
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
  const result = code === "ok" ? "requested" : "failed";                // 2xx 만 접수(리뷰 M1)
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
const key = Deno.env.get("UNSUB_SINK_KEY") ?? "";                                  // 없으면 sink 닫힘(404)
const sink = key ? { base: url.replace(/\/+$/, "") + "/functions/v1/unsubscribe/sink", key } : null;
console.log(JSON.stringify({ unsubscribe: "boot", resolver: resolverKind(), sink: !!sink }));   // 배포 실측(U6a): deno 또는 doh. 키 값은 찍지 않는다
Deno.serve((req) => handleUnsubscribe(req, unsubDeps(sb), sink));
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

세 도구 모두 실사용자 주소·URL을 출력하지 않는다. `UNSUB_SINK_KEY`는 U6a에서 `supabase/.env`와 Edge secret에 같은 값을 넣는다(값은 출력·커밋하지 않는다).

`supabase/scripts/smoke-unsub.ts` (배포 함수 실측 — U6a에서 실행):

```ts
// 광고 구독 해지 배포 실측(계획 U6a). 테스트 사용자 11(스모크 전용, 리뷰 N2) + 실행 태그 연결(disconnected)에 합성 발신자를 기록하고
// 배포된 unsubscribe 함수를 사용자 JWT 로 부른다. 끝나면 자기 행만 지운다(연결 cascade, audit 는 자기 sender id 범위 — 리뷰 M5).
// 사용: deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/smoke-unsub.ts
import { encrypt, toBytea } from "../functions/_shared/crypto.ts";
import { RUN, service as sb, userClient } from "../tests/_testenv.ts";

const base = Deno.env.get("SUPABASE_URL")!.replace(/\/+$/, "");
const key = Deno.env.get("UNSUB_SINK_KEY");
if (!key) { console.error("UNSUB_SINK_KEY 없음(supabase/.env)"); Deno.exit(2); }
const sink = `${base}/functions/v1/unsubscribe/sink/${key}`;
const { u, c } = await userClient(11);
const jwt = (await c.auth.getSession()).data.session!.access_token;
const { data: conn, error } = await sb.from("connections").insert({ user_id: u.id, provider: "gmail", account_ref: `${RUN}-smoke@example.com`, status: "disconnected" })
  .select("id").single();
if (error) throw new Error("connection " + error.code);
// optional: 외부 와일드카드 DNS(sslip.io)가 이름을 사설 주소로 푸는 경로(리뷰 N9). 그 서비스가 안 되면 dns_error 일 수 있어 판정에서 뺀다
const cases = [
  { addr: "sink@example.com", url: sink, want: ["requested", "ok"], optional: false },
  { addr: "redirect@example.com", url: sink + "/redirect", want: ["failed", "redirect_307"], optional: false },   // 따라가지 않는다(리뷰 M1)
  { addr: "private@example.com", url: "https://10.0.0.1/unsub", want: ["failed", "blocked_private"], optional: false },
  { addr: "scheme@example.com", url: "http://u.example.com/unsub", want: ["failed", "blocked_scheme"], optional: false },
  { addr: "mailto@example.com", url: null, want: ["unsupported", undefined], optional: false },
  { addr: "rebind@example.com", url: "https://10-0-0-1.sslip.io/unsub", want: ["failed", "blocked_private"], optional: true },
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
    if (!k.optional) pass &&= ok;
    out[k.addr.split("@")[0]] = { status: r.status, result: j.result, code: j.code, ok, ...(k.optional ? { optional: true } : {}) };
  }
  // 키 없는 sink 는 닫혀 있다(리뷰 N10)
  const closed = await fetch(base + "/functions/v1/unsubscribe/sink", { method: "POST", body: "List-Unsubscribe=One-Click",
    headers: { apikey: Deno.env.get("SUPABASE_ANON_KEY")! } });
  await closed.body?.cancel();
  out.sink_closed = closed.status;
  pass &&= closed.status === 404;
  const { data: list } = await c.rpc("unsub_list");
  out.list = (list ?? []).map((r: { status: string; method: string }) => `${r.method}:${r.status}`).sort();
  console.log(JSON.stringify({ gate: pass ? "pass" : "fail", ...out }));
} finally {
  const { data: senders } = await sb.from("unsub_senders").select("id").eq("connection_id", conn!.id);
  for (const s of senders ?? []) await sb.from("audit_log").delete().eq("user_id", u.id).like("target", `unsub:${s.id}%`);
  await sb.from("connections").delete().eq("user_id", u.id).eq("id", conn!.id);
}
if (!pass) Deno.exit(1);
```

`supabase/scripts/seed-unsub.ts` (시뮬레이터 게이트 시드 — 비밀번호 불변 `testUserId`):

```ts
// 시뮬레이터 게이트(U9) 시드: 테스트 사용자 n(기본 12 — 게이트 전용, 리뷰 N2)에 합성 광고 발신자 6곳. --cleanup 이면 이 시드의 연결·감사 행만 지운다.
// 사용자 12 는 하네스 token.ts(testUser 12 + 로그인 1회)가 먼저 만든다 — 이 스크립트는 비밀번호를 바꾸지 않는다(앱 세션 유지).
// 사용: deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/seed-unsub.ts [--user-n 12] [--cleanup]
import { encrypt, toBytea } from "../functions/_shared/crypto.ts";
import { service as sb, testUserId } from "../tests/_testenv.ts";

const n = Deno.args.includes("--user-n") ? Number(Deno.args[Deno.args.indexOf("--user-n") + 1]) : 12;
if (!Number.isInteger(n) || n < 1) throw new Error("bad --user-n");
const user = await testUserId(n);
const REF = "test-seed-unsub@example.com";
const old = await sb.from("connections").select("id").eq("user_id", user).eq("account_ref", REF);
for (const r of old.data ?? []) {
  const { data: senders } = await sb.from("unsub_senders").select("id").eq("connection_id", r.id);
  for (const s of senders ?? []) await sb.from("audit_log").delete().eq("user_id", user).like("target", `unsub:${s.id}%`);   // 시드 sender 범위(리뷰 M5)
  await sb.from("connections").delete().eq("id", r.id);
}
if (Deno.args.includes("--cleanup")) { console.log(JSON.stringify({ cleanup: true })); Deno.exit(0); }

const key = Deno.env.get("UNSUB_SINK_KEY");
if (!key) { console.error("UNSUB_SINK_KEY 없음(supabase/.env)"); Deno.exit(2); }
const sink = `${Deno.env.get("SUPABASE_URL")!.replace(/\/+$/, "")}/functions/v1/unsubscribe/sink/${key}`;
const { data: conn, error } = await sb.from("connections").insert({ user_id: user, provider: "gmail", account_ref: REF, status: "disconnected" }).select("id").single();
if (error) throw new Error("connection " + error.code);
const H = 3_600_000, D = 24 * H;
// 목록 순서(30일 광고 수): s1 12 · s2 5 · s6 4 · s3 3 · s4 2 · s5 1
const senders = [
  { addr: "s1@example.com", name: "합성쇼핑", method: "one_click", url: sink, ads: 12 },
  { addr: "s2@example.com", name: "합성여행", method: "one_click", url: sink + "/redirect", ads: 5 },   // 307 → 실패(따라가지 않음)
  { addr: "s3@example.net", name: "합성메일진", method: "mailto", url: null, ads: 3 },
  { addr: "s4@example.com", name: "합성사설", method: "one_click", url: "https://10.0.0.1/unsub", ads: 2 },
  { addr: "s5@example.com", name: "합성계속", method: "one_click", url: sink, ads: 1 },
  { addr: "s6@example.com", name: "합성위조", method: "unverified", url: null, ads: 4 },                // 서명 확인 실패 → 버튼 없음(G8)
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
// 광고 구독 해지 실측 집계(계획 U6b·U10). 개인정보(AGENTS.md §7): 개수·방법·상태·결과 코드만 출력한다(주소·이름·URL·도메인 없음).
// 집계는 서버 RPC unsub_stats(행 상한 없음, 리뷰 M8). --since <ISO> 면 그 뒤에 만든 스캔 잡만 센다(이번 스캔 대조)
// 사용: deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/unsub-stats.ts [--enqueue-scan] [--since <ISO>]
import { createClient } from "npm:@supabase/supabase-js@2";
import { SERVER_AUTH } from "../functions/_shared/crypto.ts";

const user = Deno.env.get("ERURI_USER_ID");
if (!user) { console.error("ERURI_USER_ID 없음"); Deno.exit(2); }
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, SERVER_AUTH);
let since = Deno.args.includes("--since") ? Deno.args[Deno.args.indexOf("--since") + 1] : null;
if (since && Number.isNaN(Date.parse(since))) throw new Error("bad --since");
if (Deno.args.includes("--enqueue-scan")) {
  since ??= new Date(Date.now() - 60_000).toISOString();
  const { data, error } = await sb.rpc("gmail_enqueue_unsub_scan", { p_user: user });
  if (error) throw new Error("enqueue " + error.code);
  console.log(JSON.stringify({ enqueued: data, since }));
}
const { data, error } = await sb.rpc("unsub_stats", { p_user: user, p_jobs_since: since });
if (error) throw new Error("unsub_stats " + error.code);
console.log(JSON.stringify(data));
```

`unsub_stats`는 U3에서 `authenticated`·`anon`·`public` 실행을 회수했지만 service role은 실행할 수 있다.

Run: `deno check supabase/scripts/smoke-unsub.ts supabase/scripts/seed-unsub.ts supabase/scripts/unsub-stats.ts`
Expected: 무오류.

- [ ] **Step 6: 커밋**

```bash
git add supabase/functions/unsubscribe supabase/config.toml supabase/tests/unsubscribe.test.ts supabase/scripts/smoke-unsub.ts supabase/scripts/seed-unsub.ts supabase/scripts/unsub-stats.ts
git commit -m "feat(server): Edge unsubscribe — user JWT checked in the handler (verify_jwt off for the sink), unsub_begin → decrypt → safe one-click POST → unsub_finish, only code ok is requested, refusals pass through, result codes only in logs; sink only under the UNSUB_SINK_KEY path (404 otherwise); scripts smoke-unsub (deployed function, test user 11, redirect fails, optional sslip rebinding case, sink closed without key), seed-unsub (sim gate user 12, password kept, unverified sender), unsub-stats (unsub_stats RPC aggregates without addresses, --enqueue-scan, --since) (spec §7, review M1/M5/M8/N2/N9/N10)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task U6a: `unsubscribe` 함수 배포·스모크 (측정 창 밖, 워커 안 건드림)

**Files:**
- Modify: `docs/superpowers/phase1/gates.md` (행 `UNS-server`, 상태 대기)
- Modify(커밋 안 함): `supabase/.env` (`UNSUB_SINK_KEY` 한 줄 — gitignore)

**Interfaces:**
- Consumes: U3(적용됨)·U5 커밋.
- Produces: 배포된 `unsubscribe`(sink 키 경로), Edge secret `UNSUB_SINK_KEY`, 리졸버 종류 기록. **워커는 배포하지 않는다**(D10 — U6b).

- [ ] **Step 1: 선행 확인**

메인에게 확인: 지금이 Gmail 측정 창 밖이다(③b3 세션 아님, ③c1·③c2 창 아님). 이 태스크는 워커를 바꾸지 않으므로 M2 ⑩b와는 무관하다. 창 안이면 멈추고 보고한다.

Run: `vm_stat | grep -E 'free|compressor'; pgrep -x xcodebuild || echo none`
Expected: `none`(시뮬레이터 빌드와 동시 실행 금지).

- [ ] **Step 2: 관련 테스트·타입 확인**

Run: `deno test --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/tests/unsub.test.ts supabase/tests/safe-post.test.ts supabase/tests/unsubscribe.test.ts supabase/tests/unsub-db.test.ts && deno check supabase/functions/unsubscribe/index.ts supabase/scripts/smoke-unsub.ts supabase/scripts/seed-unsub.ts supabase/scripts/unsub-stats.ts`
Expected: 0 실패, 무오류. 실패가 이 계획과 무관하면(다른 실행의 잔여 행 등) 원인을 적고 메인에게 알린다 — 남의 행은 지우지 않는다.

- [ ] **Step 3: sink 키·배포**

키를 만들어 `supabase/.env`와 Edge secret에 같은 값을 넣는다(값은 출력하지 않는다):

```bash
grep -q '^UNSUB_SINK_KEY=' supabase/.env || echo "UNSUB_SINK_KEY=$(openssl rand -hex 16)" >> supabase/.env
supabase secrets set UNSUB_SINK_KEY="$(grep '^UNSUB_SINK_KEY=' supabase/.env | cut -d= -f2)" >/dev/null && echo secret-set
git status --short supabase/.env   # 비어 있어야 한다(gitignore)
```

Run: `git log --oneline -1 && supabase functions deploy unsubscribe`
Expected: `secret-set`, `git status` 출력 없음, 배포 성공. 배포 시각(KST)·HEAD를 적어 둔다. `worker`는 배포하지 않는다.

- [ ] **Step 4: 스모크**

Run: `deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/smoke-unsub.ts`
Expected: `{"gate":"pass","sink":{…"result":"requested","code":"ok"…},"redirect":{…"failed","redirect_307"…},"private":{…"failed","blocked_private"…},"scheme":{…"failed","blocked_scheme"…},"mailto":{…"unsupported"…},"rebind":{…,"optional":true},"sink_closed":404,"list":[…]}`. `rebind`(선택)는 결과를 그대로 적는다 — `blocked_private`면 배포 런타임의 "이름 → 사설 주소" 차단 확인, `dns_error`면 외부 DNS 서비스 문제로 보고 판정에서 뺀다.

`sink`가 `dns_error`면 리졸버 문제다: 대시보드 `unsubscribe` 로그의 `{"unsubscribe":"boot","resolver":…}`를 확인한다. U2의 `resolveWith`가 Deno 조회가 둘 다 던지면 DoH로 넘어가므로 `dns_error`는 DoH까지 실패했다는 뜻이다 — 원인(Edge 외부 DNS·`dns.google` 접근)을 적고 메인에게 보고한다(이 Step에서 고치지 않는다).

- [ ] **Step 5: 기록·커밋**

`docs/superpowers/phase1/gates.md` 표 끝에 행 추가(수치는 실제 값). 워커 배포·30일 스캔이 남아 있어 **대기**다:

```
| UNS-server | 0028 + `unsubscribe` 배포 뒤 smoke-unsub(sink 200 · 307 은 따라가지 않고 실패 · 사설 IP·http 차단 · mailto 거부 · 키 없는 sink 404) → (U6b, ③c2 뒤) 워커 배포 · smoke-gate 단건 회귀 · gmail-gate status dead 0 · 30일 스캔 잡 done·dead 0 · 원클릭 발신자 ≥1 | 대기 | U6a <KST>(unsubscribe v<n>), HEAD <sha>, resolver <deno|doh>. smoke-unsub <JSON 한 줄>(rebind <코드>). 관련 deno <n> 통과·0 실패. 워커 배포·스캔은 ③c2 뒤(U6b) | | <날짜> |
```

```bash
git add docs/superpowers/phase1/gates.md
git commit -m "docs(gates): UNS-server pending — 0028 applied and the unsubscribe function deployed (sink behind a secret key); smoke-unsub pass (sink ok, 307 not followed, private/http blocked, mailto refused, keyless sink 404); worker deploy and the 30-day scan wait for ③c2

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
  - `Unsubscribe.Row`(Identifiable·Decodable·Sendable·Equatable): `sender_id, display_name, address, method, status, status_at, requested_at, result_code, ads_30d, ads_after_request, last_ad_at, can_request`(열 12개), `name`, `countLine`, `state(now:)`
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
  [{"sender_id":"a1","display_name":"합성쇼핑","address":"s1@example.com","method":"one_click","status":"active","status_at":null,"requested_at":null,"result_code":null,"ads_30d":12,"ads_after_request":0,"last_ad_at":"2026-10-09T03:00:00.123456+00:00","can_request":true},
   {"sender_id":"b2","display_name":null,"address":"s3@example.net","method":"mailto","status":"active","status_at":null,"requested_at":null,"result_code":null,"ads_30d":3,"ads_after_request":0,"last_ad_at":null,"can_request":true}]
  """.data(using: .utf8)!
  let now = ISO8601DateFormatter().date(from: "2026-10-10T00:00:00Z")!

  func row(method: String = "one_click", status: String = "active", statusAt: String? = nil, requestedAt: String? = nil,
           code: String? = nil, after: Int = 0, canRequest: Bool = true) -> Unsubscribe.Row {
    Unsubscribe.Row(sender_id: "x", display_name: "합성", address: "x@example.com", method: method, status: status, status_at: statusAt,
                    requested_at: requestedAt, result_code: code, ads_30d: 4, ads_after_request: after, last_ad_at: nil, can_request: canRequest)
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

  // 리뷰 N5: 5회 한도에 닿은 발신자에는 누를 수 없는 버튼을 보이지 않는다
  func testLimitHidesButton() {
    let limit = Unsubscribe.State.unsupported("요청 한도(5회)에 도달했어요")
    XCTAssertEqual(row(status: "failed", code: "http_500", canRequest: false).state(now: now), limit)
    XCTAssertEqual(row(canRequest: false).state(now: now), limit)
    XCTAssertEqual(row(status: "requested", requestedAt: "2026-10-01T00:00:00+00:00", after: 2, canRequest: false).state(now: now), limit)
    XCTAssertEqual(row(status: "requested", requestedAt: "2026-10-08T15:30:00+00:00", canRequest: false).state(now: now), .requested("10/9"))   // 버튼 없는 상태는 그대로
    XCTAssertNil(limit.buttonTitle)
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
    XCTAssertEqual(m(200, #"{"result":"failed","code":"redirect_302"}"#), "해지 요청 실패 (redirect_302)")
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
    XCTAssertTrue(Unsubscribe.footer.contains("구독 해지 기록에는 메일 제목·본문을 저장하지 않습니다"))   // 리뷰 L1: 범위를 이 기능 기록으로 한정
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
    public let can_request: Bool                                       // attempts < 5 (서버 unsub_list)

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
      if oneClick && r.can_request { return .stillComing(r.ads_after_request) }
    }
    if !oneClick { return .unsupported(reason(r.method)) }
    if !r.can_request { return .unsupported("요청 한도(5회)에 도달했어요") }   // 버튼이 붙는 상태(available·stillComing·failed) 앞에서 막는다
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
  public static let footer = "Gmail에서 광고로 분류됐거나 (광고) 표시가 있는 메일만 셉니다. 해지 요청은 고른 발신자에게만, 누를 때만 보냅니다. 구독 해지 기록에는 메일 제목·본문을 저장하지 않습니다."
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd ios && ./scripts/sim.sh test EruriCoreTests/UnsubscribeTests`
Expected: PASS(7개). `testStates`의 `"10/9"`(15:30Z = 서울 10/9 00:30)이 틀리면 `shortDate`의 시간대를 확인한다 — 기대값을 바꾸지 않는다.

- [ ] **Step 5: 커밋**

```bash
git add ios/Packages/EruriCore/Sources/EruriCore/Unsubscribe.swift ios/Packages/EruriCore/Tests/EruriCoreTests/UnsubscribeTests.swift
git commit -m "feat(core): Unsubscribe rows and states — unsub_list decode (12 columns incl. can_request), available/requesting/requested (Seoul M/d)/still coming after the grace/failed (stale requesting = timeout, retryable)/unsupported reasons per method and at the 5-request limit, button titles, Edge result messages, confirm copy (transactional mail may continue, re-consent to undo), footer scoped to unsubscribe records (spec §7, review N5/L1)

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

### Task U9: 시뮬레이터 게이트 (창 밖, TestFlight 없음)

**Files:**
- Modify: `docs/superpowers/phase1/gates.md` (행 `UNS-sim`)
- 게이트 하네스(임시, **커밋하지 않는다**): `ios/project.gate0100.yml`, `EruriGate.xcodeproj`, `ios/GateHostTests/`·`ios/GateUITests/`, `.context/gate0100/`(rt·udid). 원본은 `ios/`에서 지워졌으므로 사본에서 만든다(F23, 리뷰 N3): `.context/sim-gate-090-shots/project.gate090.yml.txt` → `ios/project.gate0100.yml`, `GateHost.swift.txt` → `ios/GateHostTests/GateHost.swift`(`test1_inject`만 남기고 rt 경로를 `.context/gate0100/rt`로), `Gate.swift.txt` → `ios/GateUITests/Gate.swift`(아래 테스트로 교체). 도구 `.context/gate090/token.ts`는 그대로 쓰고, `drive.sh`는 쓰지 않는다(푸시 없음 — 번들 `com.picpal.eruri`·`.context/gate090/udid` 하드코딩이라 복사하면 경로를 고쳐야 한다).

**Interfaces:**
- Consumes: U6a 배포된 `unsubscribe`(sink 키)·0028, U5 `seed-unsub.ts`, U8 화면 식별자.
- 테스트 사용자 **12**(게이트 전용, 리뷰 N2). 순서는 0.9.0 선례(F23): token.ts(testUser 12 생성 + 로그인 1회) → 시드(`testUserId`, 비밀번호 불변) → Host 주입. 이후 `testUser(12)`·`userClient(12)` 호출 금지(앱 세션이 끊긴다).

- [ ] **Step 1: 선행 확인·로그인 토큰·시드**

메인에게 창 밖임을 확인받는다. `pgrep -x deno`·`pgrep -x xcodebuild`가 비어 있는지 본다.

Run: `mkdir -p .context/gate0100 && deno run --allow-net --allow-env --allow-read --allow-write --env-file=supabase/.env .context/gate090/token.ts one 12 .context/gate0100/rt`
Expected: `user <id> rt written true`(토큰 값은 출력되지 않는다).

Run: `deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/seed-unsub.ts --user-n 12`
Expected: `{"seeded":6,"user_n":12}`.

- [ ] **Step 2: 하네스로 로그인 상태 만들기**

전용 시뮬레이터를 만든다(`ios/.sim-udid`가 아닌 새 기기, 이름 `Eruri-gate0100`, UDID는 `.context/gate0100/udid`). `xcodegen --spec ios/project.gate0100.yml` 뒤 `GateHostTests/GateHost/test1_inject`를 그 기기에서 돌려 테스트 사용자 12의 refresh token을 앱 Keychain에 넣는다(`GATE: injected=true`).

- [ ] **Step 3: UI 게이트 실행**

`GateUITests`에 아래 테스트를 넣어 돌린다(하네스 파일 — 커밋 안 함):

```swift
func testUnsubscribeGate() throws {
  let app = XCUIApplication(); app.launch()
  app.tabBars.buttons["설정"].tap()
  app.buttons["settings-unsubscribe"].tap()
  func state(_ a: String) -> XCUIElement { app.staticTexts["unsub-state-\(a)"] }
  func button(_ a: String) -> XCUIElement { app.buttons["unsub-button-\(a)"] }
  // G1 순서(30일 광고 수: s1 12 · s2 5 · s6 4 · s3 3 · s4 2 · s5 1)·문구. 화면 밖 행이 있으면 swipeUp 뒤 다시 본다
  XCTAssertTrue(state("s1@example.com").waitForExistence(timeout: 10))
  let order = ["s1@example.com", "s2@example.com", "s6@example.com", "s3@example.net", "s4@example.com", "s5@example.com"]
  let ys = order.map { state($0).frame.minY }
  XCTAssertEqual(ys, ys.sorted(), "목록 순서")                                            // 리뷰 N6: 순서를 실제로 단언
  XCTAssertEqual(state("s1@example.com").label, "원클릭 해지 지원")
  XCTAssertEqual(state("s3@example.net").label, "메일 회신 방식 — 앱에서 해지할 수 없어요")
  XCTAssertFalse(button("s3@example.net").exists)                                        // G5 mailto 버튼 없음
  XCTAssertEqual(state("s6@example.com").label, "발신자 확인이 안 돼 해지 요청을 보내지 않아요")
  XCTAssertFalse(button("s6@example.com").exists)                                        // G8 서명 확인 실패 버튼 없음
  XCTAssertEqual(state("s5@example.com").label, "해지 요청 뒤에도 광고 1통")               // G6
  XCTAssertEqual(button("s5@example.com").label, "다시 요청")
  // 결과 문구는 처음부터 목록 요약("광고 발신자 6곳 …")으로 있으므로 존재가 아니라 label 이 바뀔 때까지 기다린다
  func waitLabel(_ e: XCUIElement, _ p: String) {
    expectation(for: NSPredicate(format: p), evaluatedWith: e); waitForExpectations(timeout: 30)
  }
  let m = app.staticTexts["unsub-message"]
  // G2 원클릭 → 확인창 → 요청 → 해지 요청함
  button("s1@example.com").tap()
  XCTAssertTrue(app.alerts.firstMatch.waitForExistence(timeout: 5))
  app.alerts.firstMatch.buttons["해지 요청"].tap()
  waitLabel(m, "label == '해지 요청을 보냈어요. 발신자가 처리하는 데 며칠 걸릴 수 있어요'")
  waitLabel(state("s1@example.com"), "label BEGINSWITH '해지 요청함 · '")
  XCTAssertFalse(button("s1@example.com").exists)
  // G3 리다이렉트는 따라가지 않고 실패(리뷰 M1) → 다시 시도
  button("s2@example.com").tap(); app.alerts.firstMatch.buttons["해지 요청"].tap()
  waitLabel(m, "label == '발신자가 다른 주소로 넘겨 요청하지 못했어요'")                 // 코드 원문 대신 사용자 문구(U8) — 정확한 코드 redirect_307 은 DB 대조
  XCTAssertEqual(state("s2@example.com").label, "발신자가 다른 주소로 넘겨 요청하지 못했어요")
  XCTAssertEqual(button("s2@example.com").label, "다시 시도")
  // G4 사설 IP 차단 → 실패 + 다시 시도
  button("s4@example.com").tap(); app.alerts.firstMatch.buttons["해지 요청"].tap()
  waitLabel(m, "label == '해지 페이지가 안전하지 않아 요청하지 않았어요'")               // 정확한 코드 blocked_private 는 DB 대조
  XCTAssertEqual(state("s4@example.com").label, "해지 페이지가 안전하지 않아 요청하지 않았어요")
  XCTAssertEqual(button("s4@example.com").label, "다시 시도")
  // G7 취소는 요청을 보내지 않는다(DB 대조에서 s5 attempts 1 그대로로 확인)
  button("s5@example.com").tap(); app.alerts.firstMatch.buttons["취소"].tap()
  XCTAssertEqual(state("s5@example.com").label, "해지 요청 뒤에도 광고 1통")
}
```

각 단계 스크린샷을 `.context/unsub-sim-shots/`에 남긴다(XCTAttachment). 게이트 판정 기준:

| # | 확인 | 통과 |
|---|---|---|
| G1 | 목록 순서·문구 | s1(12)·s2(5)·s6(4)·s3(3)·s4(2)·s5(1) 순(`frame.minY` 단언), 상태 문구 일치 |
| G2 | 원클릭 요청 | 확인창 → "해지 요청을 보냈어요…" → s1 "해지 요청함 · M/D", 버튼 없음 |
| G3 | 리다이렉트 | s2 "발신자가 다른 주소로 넘겨 요청하지 못했어요" + [다시 시도](307을 따라가지 않음 — DB `result_code` `redirect_307`) |
| G4 | 사설 IP | "해지 페이지가 안전하지 않아 요청하지 않았어요" + [다시 시도](DB `result_code` `blocked_private`) |
| G5 | mailto | 사유 문구, 버튼 없음 |
| G6 | 유예 뒤 광고 | s5 "해지 요청 뒤에도 광고 1통" + [다시 요청] |
| G7 | 취소 | 상태 변화 없음 + DB `attempts` 그대로 |
| G8 | 서명 확인 실패 | s6 "발신자 확인이 안 돼 해지 요청을 보내지 않아요", 버튼 없음 |

DB 대조(테스트 사용자 12, service role):

Run: `deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/sql.ts "select address, status, result_code, attempts from unsub_senders where user_id = \$1 order by address" <testUserId 12>`
Expected: s1 `requested`·`ok`·1, s2 `failed`·`redirect_307`·1, s3 `active`·null·0, s4 `failed`·`blocked_private`·1, **s5 `requested`·`ok`·1(시드 값 그대로 — 취소로 요청이 가지 않았다)**, s6 `active`·null·0. 주소는 합성 값이라 출력해도 된다.

- [ ] **Step 4: 정리**

Run: `deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/seed-unsub.ts --user-n 12 --cleanup`
Expected: `{"cleanup":true}`. 하네스 파일(`ios/project.gate0100.yml`·`EruriGate.xcodeproj`·`ios/GateHostTests`·`ios/GateUITests`·`ios/build-gate`)을 지우고 `git status --short ios`가 비어 있는지 본다. 전용 시뮬레이터는 지운다(`xcrun simctl delete $(cat .context/gate0100/udid)`). **TestFlight는 여기서 올리지 않는다** — U6b 원클릭 비율 판정 뒤(D11).

- [ ] **Step 5: 기록·커밋**

`docs/superpowers/phase1/gates.md` 행 추가:

```
| UNS-sim | 0.10.0 시뮬레이터: G1 목록 순서·문구 · G2 원클릭 요청(배포 함수 → sink 200) · G3 307 은 따라가지 않고 실패 + 다시 시도 · G4 사설 IP 차단 + 다시 시도 · G5 mailto 버튼 없음 · G6 유예 뒤 광고 다시 요청 · G7 취소(요청 안 감) · G8 서명 확인 실패 버튼 없음 | 통과 | <KST>, 전용 시뮬레이터 <모델·iOS>, 테스트 사용자 12 시드(합성 6곳) → DB 대조 s1 requested/ok, s2 failed/redirect_307, s4 failed/blocked_private, s3·s6 active, s5 attempts 1 그대로. 스크린샷 `.context/unsub-sim-shots/`. 정리 완료 | | <날짜> |
```

```bash
git add docs/superpowers/phase1/gates.md
git commit -m "docs(gates): UNS-sim — 0.10.0 unsubscribe screen on the deployed function (order asserted, one-click ok, 307 not followed and retryable, private IP blocked, mailto and unverified without button, still-coming re-request, cancel sends nothing)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task U6b: 워커 배포·30일 스캔·원클릭 비율 판정·TestFlight (③c2 뒤)

**Files:**
- Modify: `docs/superpowers/phase1/gates.md` (행 `UNS-server` 대기 → 통과)
- Move: `supabase/migrations-pending/0029_unsub_gap_scan.sql` → `supabase/migrations/` (Step 3b, `git mv`), `supabase/tests/unsub-gap-db.test.ts` 경로 되돌림
- Apply: `supabase/migrations/0029_unsub_gap_scan.sql` (호스팅 DB, 워커 배포 뒤)

**Interfaces:**
- Consumes: U4 커밋(워커 기록·스캔·재동기화 훅·잡 로컬 차단기, `0029_unsub_gap_scan.sql` 파일 — 미적용, 다른 계획의 `db push`에 딸려 올라가지 않게 `supabase/migrations-pending/`에 둠(최종 리뷰 I3)), U6a(배포된 `unsubscribe`·`UNSUB_SINK_KEY`), U8·U9(0.10.0 앱, 시뮬레이터 게이트 통과), U5 `unsub-stats.ts`.
- Produces: 배포된 `worker`, 실사용자 30일 스캔 결과(집계만), **원클릭 비율 판정(D11)**, TestFlight 0.11.0(D12 — U10·링크 계획 L9와 같은 빌드).

**왜 ③c2 뒤인가(D10):** 워커 재배포는 잡 처리 시간을 바꿔 Gmail 7일 측정(지연·재시도·후속 저장)에 영향을 줄 수 있다. 30일 스캔이 배포 전 광고를 채우므로 일찍 배포해 얻는 것이 거의 없다.

- [ ] **Step 1: 선행 확인**

`docs/superpowers/phase1/gates.md`에 ③c2(PoC-6 마감) 행이 기록돼 있는지 확인한다(10-08 15:00 KST 이후). 없으면 멈춘다. 메인에게 M2 ⑩b 실행 중이 아님을 확인받는다(배포가 진행 중인 워커 호출을 끊을 수 있다). `UNS-sim`이 통과로 기록돼 있어야 한다(U9).

Run: `vm_stat | grep -E 'free|compressor'; pgrep -x xcodebuild || echo none`
Expected: `none`.

- [ ] **Step 2: 전체 테스트·타입 확인**

Run: `deno test --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/tests/ && deno check supabase/functions/worker/index.ts supabase/functions/unsubscribe/index.ts supabase/functions/chat/index.ts supabase/scripts/*.ts`
Expected: 0 실패(ignored 수는 직전 기록과 같음), 무오류. 실패가 이 계획과 무관하면 원인을 적고 메인에게 알린다 — 남의 행은 지우지 않는다.

- [ ] **Step 3: 워커 배포·회귀**

**SHARE 변경은 10-04 선배포됨**(gates.md `SHARE-deploy`, 2026-10-04 02:00:58 KST worker v17 = 기준선 `39728f3` + `a17bc61`·`51229cb`·`b3caac8` cherry-pick, 사용자 승인 B — gmail 경로 파일은 바이트 동일). 그래서 아래 diff 의 기준은 `39728f3` 이고, SHARE 3파일(`_shared/extract-text.ts`·`_shared/facts.ts`·`worker/text.ts`)은 이미 배포본과 같으므로 이번 배포의 새 변경은 이 계획의 gmail·unsub 커밋뿐이다(그 사이 SHARE 파일이 또 바뀌었으면 그것도 새 변경으로 본다).

Run: `git log --oneline -1 && git diff --stat 39728f3..HEAD -- supabase/functions/_shared supabase/functions/worker`
Expected: 이 계획의 커밋(U1·U2·U4 등)과 **SHARE 게이트 생략 `a17bc61`(`worker/text.ts`, 스펙 §7·§16 2026-10-03 사용자 결정 — 함께 배포한다)**, **SHARE 추출 지시·empty 사유 로그 `51229cb`·`b3caac8`(`_shared/extract-text.ts`·`_shared/facts.ts`·`worker/text.ts`, 스펙 §7 2026-10-03 사용자 결정 — 함께 배포한다)**만 보인다. 그 밖의 서버 변경이 함께 배포되면 멈추고 메인에게 알린다(최종 리뷰 권고).

Run: `supabase functions deploy worker`
Expected: 배포 성공. 배포 시각(KST)·HEAD를 적어 둔다.

Run: `deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/smoke-gate.ts`
Expected: 기존 단건 회귀 `{"gate":"pass",…}`(워커 재배포가 process·notify 경로를 깨지 않았다).

Run: `deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/gmail-gate.ts status`
Expected: dead `gmail-fetch` 0, 연결 `active`(Gmail 게이트 원장의 직전 값과 같은 꼴).

**SHARE 게이트 생략(`a17bc61`)과 SHARE 추출 지시(`51229cb`·`b3caac8`)는 10-04 선배포됨** — 배포 직후 LNK 54/54·다건 24/24(`--runs 1`)·empty 사유 로그 확인을 마쳤다(gates.md `LNK-eval`·`SHARE-deploy`). U6b 에서는 워커가 다시 배포되므로 아래 재실행을 **회귀 확인**으로 한 번 더 한다. 배포 뒤 SHARE 합성 항목(테스트 사용자 13)이 게이트 없이 추출되고 새 지시(단계별 일정표·공개 행사·notes)가 배포본에 실렸는지 **LNK-eval·다건 평가를 재실행**한다(배포 전 로컬 추출기 확인: LNK 54/54, 다건 72/72 — `.context/server-share-extract.report.md`). LNK-eval 러너가 SHARE 합성 18건을 배포된 worker 의 process 경로에 테스트 lease 로 넣고 자기 행을 지운다(본문 출력 없음 — 사례 id·상태·게이트 라벨·개수만).

Run: `deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/eval-link.ts --runs 3 | tee "$TMPDIR/share-smoke.log" && grep -c '"gate":null' "$TMPDIR/share-smoke.log" && grep -E '"case":"(wedding-text|contest-[a-z]+|poster-[a-z-]+)"' "$TMPDIR/share-smoke.log"`
Expected: 사례 54줄(18종 × 3) 모두 `"gate":null,"conf":null`(Jev 미호출 — count 54), `wedding-text` 이 `"status":"extracted"`·일정 1, `contest-timeline`·`contest-photo` 일정 3(마감 23:59·notes 포함 — `miss` 에 `start0`·`notes` 없음), `contest-hiring` 일정 4, `poster-festival`·`poster-festival-ocr` 일정 1, 상태에 `discarded:server:promo|notice|personal` 없음(`promo-lineup` 은 `discarded:server:empty`·일정 0), 마지막 줄 `{"gate":"pass",…}`. 한 줄이라도 gate 라벨이 남으면 배포본에 `a17bc61` 이 빠진 것, contest 사례가 일정 1이면 `51229cb` 가 빠진 것 — 멈추고 메인에게 알린다. 모델 흔들림으로 한두 줄만 어긋나면(로컬 54/54 기준) 그 사례만 `--runs 3` 한 번 더 보고, 다시 어긋나면 메인에게 알린다.

Run: `deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/eval/run-multi-event-eval.ts --runs 3`
Expected: 마지막 줄 `ok` 72(24종 × 3, m23 SHARE 단계 3건·m24 문자 대조 1건 포함), `split`·`missing` 0, 종료 코드 0. 이 평가는 배포본이 아니라 HEAD 의 추출기를 직접 부르므로 배포와 같은 HEAD 에서 돌린 값이 배포본의 기준이다.

Supabase 대시보드 Edge Functions › `worker` 로그에서 위 LNK 실행의 `discarded:server:empty` 줄(예: `promo-lineup`)에 `why`·`raw_events` 가 있는지 본다(R1 — 값은 코드·개수뿐). 결과는 `docs/superpowers/phase1/gates.md` `LNK-eval` 행 비고에 "SHARE 게이트 생략·추출 지시 배포 뒤 재실행 — LNK n/54, 다건 n/72, empty 사유 로그 확인" 한 줄로 적는다.

- [ ] **Step 3b: 0029 적용 (일일 공백 스캔 cron, U4 리뷰 I2)**

워커 배포·회귀 뒤에만 적용한다 — 먼저 적용하면 배포 전 워커가 `gmail-unsub-scan`을 모르는 잡으로 받아 dead가 된다. 그때까지 파일은 `supabase/migrations-pending/`에 있다(최종 리뷰 I3 — `supabase/migrations/`에 두면 다른 계획의 `db push`가 함께 적용한다).

Run: `git mv supabase/migrations-pending/0029_unsub_gap_scan.sql supabase/migrations/ && sed -i '' 's#"../migrations-pending/0029_unsub_gap_scan.sql"#"../migrations/0029_unsub_gap_scan.sql"#' supabase/tests/unsub-gap-db.test.ts && rmdir supabase/migrations-pending 2>/dev/null; git status --short`
Expected: `R  …/0029_unsub_gap_scan.sql`·`M supabase/tests/unsub-gap-db.test.ts`만. 다른 미적용 마이그레이션 파일이 `supabase/migrations-pending/`에 남아 있으면 `rmdir`이 실패하고 디렉터리가 남는다 — 그대로 둔다.

Run: `supabase db push --dry-run`
Expected: 적용 대상 목록이 `0029_unsub_gap_scan.sql` **하나뿐**. 다른 파일이 함께 보이면(다른 계획의 미적용 마이그레이션) push하지 않고 멈춰 메인에게 알린다.

Run: `supabase db push --yes && deno test --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/tests/unsub-gap-db.test.ts supabase/tests/unsub-db.test.ts`
Expected: 적용 성공, 테스트 전부 통과(`unsub-gap-db`는 배포본을 그대로 쓰고 롤백). `cron.job`에 `unsub-gap-scan-daily`(`27 19 * * *`)가 있다. cron을 수동으로 돌리지 않는다 — 돌리면 8일 공백 스캔이 대기에 걸려 Step 4가 `enqueued: 0`을 낸다(최종 리뷰 Minor 5). 첫 실행(다음 KST 04:27) 뒤 `unsub-stats.ts`의 `jobs`에 `gmail-unsub-scan:done`이 늘었는지·dead 0인지 Step 4의 확인과 함께 본다.

```bash
git add supabase/migrations/0029_unsub_gap_scan.sql supabase/tests/unsub-gap-db.test.ts
git commit -m "chore(db): move 0029 gap-scan migration back into supabase/migrations/ and apply it after the worker deploy (U6b Step 3b)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 4: 30일 스캔**

Step 3b 직후 바로 실행한다(KST 04:27 cron 전에).

Run: `deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/unsub-stats.ts --enqueue-scan`
Expected: `{"enqueued":1,"since":"<ISO>"}` 뒤 집계 한 줄. `since` 값을 적어 둔다. `enqueued`는 활성 Gmail 연결 수(1인 1계정이라 1)다. `enqueued: 0`이면 둘 중 하나다 — (a) 같은 lease(`backfill:<user>`)에 대기·실행 중인 `gmail-unsub-scan`이 있다(Step 3b 뒤 04:27 cron의 8일 공백 스캔): `unsub-stats.ts`의 `jobs`에서 `gmail-unsub-scan:queued`·`running`이 0이 된 뒤 다시 실행한다(8일 공백 스캔이 끝나도 30일 스캔은 따로 필요하다). (b) 연결이 `active`가 아니다(주간 재인증 공백): `gmail-gate.ts status`의 연결 상태를 보고, 사용자가 재연결한 뒤 실행한다. 두 경우 모두 다시 실행한 쪽의 `since`를 쓴다.

10분 간격으로(최대 1시간) `unsub-stats.ts --since <위 since>`를 다시 실행해 `jobs`에 `gmail-unsub-scan:done`이 있고 `gmail-unsub-fetch:*`가 모두 `done`(queued·running 0, **dead 0**)인지 본다. 같은 시점에 `gmail-gate.ts status`로 실시간 sync dead 0도 본다(스캔은 `backfill:<user>` lease라 sync를 막지 않는다). dead가 있으면 `jobs.last_error` 코드만 조회해 적는다 — 스캔 fetch의 기록 실패는 잡 실패로 남으므로(U4) dead 0이 완료 조건이다.

**429 확인(U4 파킹 M1·M2, 기록만 — 게이트 아님):** 스캔 fetch(분당 약 3,000 units)와 실시간 fetch가 겹치면 사용자당 분당 6,000 units를 넘을 수 있다. 429는 잡 재시도(백오프)로 회복되면 dead에 남지 않으므로 dead 0만으로는 보이지 않는다. 스캔 잡이 다 끝난 뒤 한 번 실행한다(개수만, 행 내용 없음 — `done` 잡도 마지막 `last_error`를 지우지 않으므로 재시도 뒤 성공한 잡도 잡힌다. 잡마다 마지막 오류만 남아 하한이다):

Run: `deno eval --env-file=supabase/.env 'import { createClient } from "npm:@supabase/supabase-js@2"; const sb = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } }); const [since] = Deno.args; const out = {}; for (const k of ["gmail-fetch", "gmail-unsub-fetch"]) { const q = () => sb.from("jobs").select("id", { count: "exact", head: true }).eq("user_id", Deno.env.get("ERURI_USER_ID")).eq("kind", k).gte("updated_at", since); const a = await q().like("last_error", "% 429"); const b = await q().gt("attempts", 1); out[k] = { last_error_429: a.error ? a.error.code : a.count, retried: b.error ? b.error.code : b.count }; } console.log(JSON.stringify(out));' <위 since>`
Expected: `{"gmail-fetch":{"last_error_429":<n>,"retried":<n>},"gmail-unsub-fetch":{…}}` 한 줄을 적는다. 판정에 쓰지 않는다. `gmail-fetch` 쪽 `last_error_429 ≥ 1`이면(실시간 수집이 스캔과 겹쳐 밀림) 메인에게 보고에 적는다 — 스캔 fetch 간격(400ms)을 늘릴지 후속 판단.

- [ ] **Step 5: 원클릭 비율 판정 (D11, TestFlight 전)**

Run: `deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/unsub-stats.ts --since <위 since>`
Expected: `senders_with_ads_30d ≥ 1`, `ads_30d ≥ 1`. `method_of_senders_with_ads`(예: `{"one_click": a, "link_only": b, "mailto": c, "unverified": d, "none": e}`)를 적는다 — 주소 없음. `status`에 `requesting`·`requested`·`failed`가 없다(실사용자 해지 요청 0건 — 아래 동치의 전제).

**판정 기준(D11, 최종 리뷰 I1 — 계획 U10 Step 1과 같은 문장):** `method_of_senders_with_ads.one_click ≥ 1` **그리고** `senders_with_ads_30d ≤ 100`이면 진행한다. 이것은 앱과 같은 `unsub_list` 반환 행(상위 100) 중 `can_request && method = 'one_click'` ≥ 1(원장 Ruling U6b)과 같다 — U6b 시점에는 실사용자 요청이 0건이라 `attempts`가 모두 0(`can_request` 모두 참)이고, `unsub_list` 행은 곧 30일 광고가 있는 발신자 상위 100이며 방법은 `unsub_stats`와 같은 `unsub_best`다. `unsub_list`는 `auth.uid()`로 사용자를 정해 service role 운영자 도구로는 부를 수 없으므로(실사용자 JWT 없음) 직접 부르지 않는다. `senders_with_ads_30d > 100`이면 **멈춘다** — 상위 100 밖의 원클릭 발신자가 섞여 동치가 깨진다. 메인이 `unsub_stats`에 `listed_requestable_one_click`(`unsub_list`와 같은 필터·정렬·`limit 100`·`attempts < 5`를 `p_user`로 계산)을 더하는 소태스크를 만든다(0029는 이미 적용됐으므로 새 마이그레이션). 그 값으로 다시 판정한다.

판정:
- `one_click ≥ 1` 그리고 `senders_with_ads_30d ≤ 100` → 진행(Step 6).
- `one_click = 0` → **멈춘다.** `UNS-server` 비고에 분포를 적고, 메인이 사용자에게 "앱에서 바로 해지할 수 있는 발신자가 0곳입니다. 웹 페이지 열기(사용자 브라우저)로 바꿀까요?"를 묻는다. `UNS-real`은 "실패(대안 채택)" 후보이며 대안이 정해지면 스펙 §7·§16과 계획을 고친 뒤 다시 판정한다. TestFlight는 올리지 않는다.
- `unverified`가 광고 발신자의 절반을 넘으면(원클릭 헤더는 있는데 확인 실패) U1의 "맨 위 AR이 Gmail 것" 가정을 의심한다 — 메인에게 보고하고, 합성 헤더가 아니라 실사용자 메일의 **헤더 이름 순서만**(값 없이) 1통 확인하는 조사 태스크를 제안한다(값·주소를 보지 않는다).
- `senders_with_ads_30d = 0`이면 30일 스캔 경로 문제다 — 실패로 적고 원인 조사 태스크를 만든다.

**F2 관찰(게이트 아님, 원장 Ruling F2·U4-I2 · 최종 리뷰 I2):** 실시간 경로(history로 오는 광고)가 동작하는지는 `unsub_mail`로 가를 수 없다 — 출처 열이 없고, 30일·일일 공백 스캔이 같은 `msg_key`를 다시 쓴다. 대안(일 1회 공백 스캔)은 0029로 이미 들어가 있으므로 판정하지 않는다. 관찰만 한다: Step 7 기록 시점에 Supabase 대시보드 Edge Functions › `worker` 로그에서 Step 3 배포 뒤 `gmail_discard`의 `promotion` 줄 개수(개수만 — 줄에는 connection_id·사유 코드만 있다)를 적는다. 0이어도 실패가 아니다(공백 스캔이 메운다).

- [ ] **Step 6: TestFlight 0.11.0 (D12 — 0.10.0 단독 빌드 없음)**

먼저 `docs/superpowers/phase1/gates.md`에 링크 계획 `LNK-sim` 통과 행이 있는지 본다(0.11.0은 링크·사진 기능을 포함한다). 없으면 올리지 않고 메인에게 알린다.

Run: `vm_stat | grep -E 'free|compressor'; pgrep -x deno || echo none; grep -n 'MARKETING_VERSION' ios/project.yml; cd ios && ./scripts/sim.sh gen && ./scripts/testflight.sh`
Expected: `none`, `MARKETING_VERSION: 0.11.0` 뒤 0.11.0(빌드 번호 `YYYYMMDDHHMM`) 업로드 성공, App Store Connect 처리 VALID. 0.11.0이 아니면(그 사이 0.11.x·0.12.0이 들어갔으면) 올리지 않고 메인에게 알린다. 이 빌드를 U10과 링크 계획 L9가 쓴다.

- [ ] **Step 7: 기록·커밋**

`docs/superpowers/phase1/gates.md`의 `UNS-server` 행 상태를 **통과**로 바꾸고 비고 끝에 붙인다:

```
U6b <KST>(worker v<n>), HEAD <sha>. smoke-gate <JSON 한 줄>. gmail-gate status dead 0. 0029 적용 <KST>(cron unsub-gap-scan-daily). 스캔 since <ISO> jobs <집계>(dead 0). 429 <JSON 한 줄>(기록만). unsub-stats senders_with_ads_30d <n>(≤100)·ads_30d <n>·방법 <JSON>(주소 없음) → 원클릭 <a>곳 ≥1 진행(unsub_list 기준과 동치, 요청 0건). F2 관찰 gmail_discard promotion <n>줄. 전체 deno <n> 통과·0 실패·<n> ignored. TestFlight 0.11.0 (<빌드>) VALID(D12 — U10·LNK-device 같은 빌드)
```

스펙 §7 "광고 구독 해지"의 m1 문구(일일 공백 스캔은 라벨·제목에 광고 표기가 있는 메일만 메운다 — 본문·발신자 이름에만 `(광고)`가 있는 규칙 광고는 잡 로컬 차단기로 빠지면 메우지 못한다)는 2026-10-02 최종 리뷰 수정에서 이미 고쳤다. 확인만 하고, U6b에서 바뀐 사실(예: 429로 스캔 간격 조정)이 있을 때만 스펙을 함께 고친다.

```bash
git add docs/superpowers/phase1/gates.md
git commit -m "docs(gates): UNS-server pass — worker deployed after ③c2, smoke-gate and Gmail fetch regressions clean, 30-day unsubscribe scan done with no dead jobs, one-click senders present (method mix without addresses), TestFlight 0.11.0 (one build with link reading, no separate 0.10.0)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task U10: `UNS-real` — 실사용자 목록 확인·해지 1건 (③c2 뒤, U6b 판정 통과 뒤)

**Files:**
- Modify: `docs/superpowers/phase1/gates.md` (행 `UNS-real`)

**Interfaces:**
- Consumes: U6b(워커 배포·30일 스캔 done·원클릭 발신자 ≥1·TestFlight 0.11.0 VALID — D12, 링크 계획 L9와 같은 빌드), U5 `unsub-stats.ts`.

**사람이 필요한 이유(리뷰 N7):** 하드웨어 기능 때문이 아니라 **사용자 판단** 때문이다 — 실사용자 광고 메일로 만든 목록이 사용자가 아는 광고 발신자와 맞는지(거래 전용 발신자가 섞이지 않는지)는 사용자만 알고, 어느 발신자를 끊을지는 사용자가 고른다(자동 해지 금지 원칙). 화면 동작은 U9가 시뮬레이터로 닫았다. 시뮬레이터로 옮기려면 사용자가 시뮬레이터에 Apple 로그인을 해야 해서 조작이 오히려 늘어나므로 사용자 기기의 TestFlight 앱에서 **한 번의 요청(약 2분)**으로 묶는다. 실기기 고유 동작 게이트가 아니므로 이름을 `UNS-real`로 한다.

| 단계 | 필요한 것 | 어디서 |
|---|---|---|
| 스캔·집계 | 서버만 | U6b(끝남) |
| D1 목록이 실제와 맞는지 | 실사용자 데이터 + 사용자 판단 | 사용자 기기 TestFlight |
| D2 해지 1건 | 사용자의 선택 | 같은 세션 |

- [ ] **Step 1: 선행 확인**

`docs/superpowers/phase1/gates.md`의 `UNS-server`가 **통과**(U6b — 원클릭 발신자 ≥1, TestFlight VALID)인지 본다. 대기거나 원클릭 0곳으로 멈췄으면 이 태스크는 성립하지 않는다(메모리 "테스트 시나리오는 인과관계·필요성 먼저") — 멈추고 메인에게 보고한다.

Run: `deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/unsub-stats.ts`
Expected: `senders_with_ads_30d ≥ 1`, 그리고 U6b Step 5와 같은 판정 기준 — `method_of_senders_with_ads.one_click ≥ 1` **그리고** `senders_with_ads_30d ≤ 100`이면 앱의 `unsub_list` 반환 행(상위 100) 중 `can_request && method = 'one_click'` ≥ 1과 같다(요청 0건이라 `can_request` 모두 참 — `status`에 `requesting`·`requested`·`failed`가 없는지 함께 본다). `senders_with_ads_30d > 100`이면 U6b Step 5처럼 `listed_requestable_one_click` 값으로 본다. 값(개수만)을 적어 둔다.

- [ ] **Step 2: 사용자 확인 D1·D2 (한 번의 요청)**

메인이 사용자에게 한 번에 묻는다(답은 예/아니오·개수·결과 문구만, 발신자 이름은 기록하지 않는다):

"TestFlight 0.11.0을 설치하고 설정 → Gmail → 광고 메일 구독 해지를 열어 주세요. 목록 위에서 10곳(10곳보다 적으면 전부)을 보고 (a) 광고를 보내는 곳이 맞나요? (b) 주문·배송·결제 메일만 보내는 곳이 있나요(몇 곳)? 그다음 [해지] 버튼이 있는 곳 중 정말 끊고 싶은 한 곳을 골라 [해지] → 확인창 [해지 요청]을 누르고, 화면 위에 나온 결과 문구를 알려 주세요. 끊고 싶은 곳이 없으면 '없음'이라고 해 주세요."

D1 통과: (a) 예, (b) 0곳. (b)가 1곳 이상이면 그 행의 상태 문구와 광고 수만 받아(이름 없이) 실패로 적고, 원인(게이트 promo 오판인지 규칙 광고 표기인지)을 조사하는 태스크를 만든다.

D2: 사용자가 "없음"이면 D2는 판정하지 않고 대기로 둔다(사용자가 끊고 싶은 곳이 생길 때 다시 묻는다 — 자동 해지 금지라 대신 고르지 않는다).

Run: `deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/unsub-stats.ts`
Expected: `status.requested`가 1 늘고 `result_codes`에 `ok`. 결과가 실패 문구(U8부터 코드 원문 대신 사용자 문구)면 `unsub_stats`/`unsub_senders.result_code`의 코드를 적는다 — `redirect_<n>`·`http_4xx`·`timeout`은 발신자 쪽 방식일 수 있으므로 사용자가 원하면 다른 발신자 1곳으로 한 번 더 한다.

D2 통과: `result_codes.ok ≥ 1`(사용자가 고른 발신자 1곳 이상 `requested`).

- [ ] **Step 3: 관찰 (게이트 아님)**

요청 4일 뒤(3일 유예 + 1일) 한 번 `unsub-stats.ts`를 돌리고, 요청한 발신자의 화면 상태가 "해지 요청함"인지(광고가 멈춤) "해지 요청 뒤에도 광고 N통"인지 사용자에게 묻고 비고에 적는다. 해지 효과를 보장하는 게이트가 아니다. 원클릭 지원 비율(`one_click` / 광고 발신자 수)이 20% 미만이면 스펙 §16 소절 "남은 것"에 따라 "웹 페이지 열기" 후속 후보를 메인이 사용자에게 묻도록 보고에 적는다.

- [ ] **Step 4: 기록·커밋**

```
| UNS-real | 0.10.0 기능 사용자 확인(TestFlight 0.11.0 빌드, D12): D1 목록 위 10곳이 실제 광고 발신자이고 거래 전용 발신자 0곳(사용자 확인) · D2 사용자가 고른 발신자 1곳 해지 요청 접수(2xx `ok`) | 통과 | <KST>. unsub-stats senders_with_ads_30d <n>·ads_30d <n>·방법 <JSON>(주소 없음). D1 (a) 예 (b) 0곳(본 곳 <n>). D2 result <code>. 관찰(+4일): <요청한 곳 광고 멈춤|계속 N통>. 원클릭 비율 <x>% | | <날짜> |
```

```bash
git add docs/superpowers/phase1/gates.md
git commit -m "docs(gates): UNS-real — real list confirmed by the user (top 10 are ad senders, no transactional-only senders), one user-chosen sender unsubscribed with a 2xx; method mix recorded without addresses

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## 자체 점검 (계획 작성 뒤 2026-10-01, 리뷰 반영 뒤 2026-10-02 다시)

- **사용자 결정 대조:** UD1 — 헤더 기반(U1)·광고만(D2·U3 `unsub_ad_mail`·`unsub_best`)·발신자별 30일 수(U3 `unsub_list`)·[해지](U7·U8)·고른 발신자만(U5 sender 하나, U8 확인창)·원클릭 POST(U2, 요청 1회)·자동 해지 없음(요청 경로는 Edge 호출뿐, cron·워커에 POST 없음, U10도 사용자가 고름)·거래 메일 영향 없음(Review Focus 1 — 세지도 않고 그 URL로 요청하지도 않음)·`gmail.readonly` 그대로(Global Constraints, `getMessageMeta`는 readonly 범위). 확인 항목: 헤더 보존 범위·§12(D1, U0 Step 6) · mailto(D3) · 보안(D4, U2, 재바인딩 수용 §12 통제 3) · 결과 기록·재표시 억제(D5, U3) · UI 위치(D6) · 버전 충돌(D8, U0 Step 5·8, U8 Step 1) · 배포 분할(D10) · 원클릭 비율 판정(D11). UD2 — U0 Step 6 §15 확장 후보 + ERURI 보관함 한 줄(F18).
- **메인 결정(2026-10-02) 대조:** H3 수용 → D4, U0 Step 6 통제 3 bullet("메인 판정 2026-10-02, 사용자 재검토 가능"), 스펙 §16 외부 리뷰 반영 소절. N4 고침 → D7, U4 `onResync`·`enqueueUnsubRescan`·`unsubScanQuery`, U0 §7 "도착 경로". 배포 분할 → U6a(창 밖이면 언제든)·U6b(③c2 완료 기록 뒤, 10-08 15:00 KST 이후). N1 판정 지점 → U6b Step 5(스캔 직후·TestFlight 전).
- **스펙 대조:** U0 §7 소절의 문장마다 구현 위치 — 광고 판정(a)(b) → U4 `gmailFetch`·U3 `unsub_ad_mail`, 기록 필드(발신자/메일 행 분리) → U3 `worker_record_unsub`, fail-open·2초 → U4 `recordUnsub`, 스캔 기록 실패 재시도 → U4 `gmailUnsubFetch`, 도착 경로·재동기화 공백 → U4 `gmailSync` 훅, 30일 스캔(lease `backfill:<user>`) → U3 `gmail_enqueue_unsub_scan`·U4 스캔 핸들러·U6b, 방법 판정(서명 특정·헤더 1개·정렬은 제품 정책)·2,048자 → U1, 방법·URL 선택(광고 메일만) → U3 `unsub_best`, 해지 요청 순서·안전 POST(3xx 실패) → U2·U5, 결과·유예·5회(`can_request`)·busy·stale → U3·U7, 목록 left join → U3, 보관 35(+1)/180일 → U3 `purge_unsub`·cron, cascade → U3 FK·테스트, 화면 → U8.
- **이름 일치:** `unsubMeta`·`hasListUnsub`·`isAdMail`(U1 → U4), `oneClickPost`·`resolverKind`·`resolveWith`(U2 → U5), `worker_record_unsub` 인자 9개(U3 ↔ U4 `recordUnsub` ↔ U5 도구), `unsub_list` 열 12개(U3 ↔ U7 `Row` ↔ U5 smoke `method:status`), `unsub_begin` 반환 `{result, url_enc}`(U3 ↔ U5 `UnsubDeps.begin`), 결과 코드 `ok`만 접수·`redirect_<n>`(U2 ↔ U3 `unsub_finish` ↔ U5 handler ↔ U7 문구 ↔ U9 G3), 잡 payload `lease_key`(`backfill:<user>`)·`msgs`·`after`(U3 ↔ U4), `unsub_stats(p_user, p_jobs_since)`(U3 ↔ U5 `unsub-stats.ts` ↔ U6b·U10), sink `/sink/<UNSUB_SINK_KEY>`(U5 ↔ U6a ↔ U9 시드), 식별자 `unsub-*`(U8 ↔ U9), 테스트 사용자 11(스모크)·12(시드·게이트).
- **자리표시자:** 코드 단계는 모두 실제 코드. `<KST>`·`<sha>` 같은 꺾쇠는 gates.md에 실행 때 채우는 실측값 칸이다.
- **알려진 한계(계획에 적음):** 게이트 `promo` 판정된 메일 중 `List-Unsubscribe`가 없는 것은 실시간으로는 기록되지 않는다(스캔은 잡는다) — 어차피 버튼이 없는 행이라 수용. DNS 재바인딩은 수용 위험(D4, 스펙 §12 통제 3). 같은 From의 여러 구독 목록은 구분하지 않고, 요청은 그 발신자의 최신 원클릭 광고 메일 URL 하나로만 간다(Codex H2의 "복수 구독 구분"은 범위 밖). 스캔의 광고 판정은 라벨·제목·발신자 표기만(본문 표기·OTP 제외 미적용 — 스펙 §7). 연결 삭제 뒤 재연결 때 30일 스캔 자동 재실행 없음(재동기화 공백 스캔과 다름). U1의 "맨 위 AR이 Gmail 것" 가정은 합성 헤더로만 확인 — 실제 분포는 U6b Step 5에서 `unverified` 비율로 본다.
