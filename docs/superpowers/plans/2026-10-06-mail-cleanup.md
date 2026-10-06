# ERURI 0.14.0 메일 정리(채팅으로 Gmail 휴지통·읽음) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## 태스크 ID 표

| ID | 태스크 | 선행 | 시점·Gmail 측정 창 | 게이트 행 |
|---|---|---|---|---|
| M0 | 스펙 세부 반영(§7 켜기·실행·권한 업데이트·오류 코드, §8 열, §9 문구, §15 순서·게이트 이름, §16) + 광고 해지 계획 U6b 업로드 기준 한 줄 | 이 계획 커밋 | 무관(문서) | — |
| M1 | `_shared/mail-query.ts`: 칸 검사(거절·범위 하한)·정제·검색어 조립(순수) | M0 | 무관(로컬 deno) | `MAIL-server` |
| M2 | `_shared/gmail.ts`: 쓰기·목록·메타 래퍼 + 오류 `reasons` + `classifyGmailError`(fetch 스텁 테스트) | M0 | 무관(로컬) | `MAIL-server` |
| M3 | 마이그레이션 `0030_mail_cleanup.sql`(**`migrations-pending/`에 둔다, 미적용**) + 공유 SQL 사례 + PGlite 로컬 SQL 테스트 + 호스팅 트랜잭션 테스트 파일(M10에서 실행) | M0 | 로컬만. **호스팅 DB 테스트·`db push`는 M10(③c2 뒤)** | `MAIL-server` |
| M4 | 워커: `mail-action` 잡(묶음·폴백·reason 분기·units·결과 불명·마지막 시도 재조회) + 수집 경로 units 기록(fail-open) + `gmailAccessToken` 공개 | M2·M3(이름) | 로컬 테스트만. **워커 배포는 M10** | `MAIL-server` |
| M5 | Edge `mail-action`(preview·execute·undo·status) | M1·M2·M3(이름)·M4(`gmailAccessToken`·`noteGmailUnits`) | 로컬 테스트만. 배포는 M10 | `MAIL-server` |
| M6 | `gmail-connect`: `upgrade` 경로(revoke 0회·연결 불변) + 일반 경로 `scopes` 기록 | M2·M3(이름) | 로컬 테스트만. 배포는 M10 | `MAIL-server` |
| M7 | `INTENT-eval --mail-judged`(0.14.0 판정: 칸 일치 ≥ 90%) | 0.13.0 A2·A3 끝 | **실호출** — 10-07·10-08 14:30~16:30 KST 금지, 그날 13:45 이후 시작 금지 | `INTENT-eval`(mail) |
| M8 | EruriCore `MailCleanup`·`MailCleanupText`·`MailTurn` + `ChatHistory`(`.mailAction`·`mail`)·`ChatReply.Answer.mail`·`ChatAddEvent.intents`·`JSONValue.foundation` | M0 | 무관(시뮬레이터 단위 테스트) | — |
| M9 | 앱: 채팅 메일 정리 턴·카드·폴링·되돌리기 + 설정 [권한 업데이트]·`GmailConnect.upgrade` + 새 연결 readonly+modify | M8 | 무관(빌드·단위 테스트) | — |
| M10 | 배포: 호스팅 트랜잭션 DB 테스트 → `0030` 적용 → 워커 배포·회귀 → `mail-action`·`gmail-connect` 배포 → `MAIL_ACTIONS=on` → `smoke-mail`(테스트 사용자 22) | M1~M7 + **③c2 완료 기록 + U6b Step 3b(0029 적용) 완료** | ③c2 뒤, 16:30 KST 이후(실호출 포함) | `MAIL-deploy` |
| M11 | 시뮬레이터 게이트 `MAIL-sim`(테스트 사용자 23, 전용 UDID) → 통과 뒤 `MARKETING_VERSION: 0.14.0` | M9·M10 | 실호출(배포된 chat·mail-action·worker) | `MAIL-sim` |
| M12 | TestFlight 0.14.0 → `MAIL-real`(실기기, 사용자 조작 — 합성 메일 3통 + 대조 1통) | M11 | ③c2 뒤 | `MAIL-real` |

순서: M0 → (M1·M2 → M3 → M4 → M5·M6) ∥ (M8 → M9) → M7(창 밖 아무 때나, M10 전) → [③c2 완료 기록 + U6b 0029 적용] → M10 → M11 → M12. 서버(deno)와 앱(시뮬레이터)은 다른 파일이라 다른 pane에서 해도 되지만 **deno 테스트와 시뮬레이터 빌드를 같은 시각에 돌리지 않는다**(AGENTS.md §6 — `pgrep -x deno`·`pgrep -x xcodebuild`로 서로 확인).

**Goal:** 채팅에 "합성상점에서 온 광고 메일 휴지통에 버려줘"·"지난주 뉴스레터 읽음 처리해줘"라고 하면 서버가 정해진 칸으로 Gmail 받은편지함 검색어를 직접 만들어 대상을 미리 보이고(최대 1,000건, 위 20건), 사용자가 카드의 버튼을 누를 때만 서버 잡이 휴지통 이동·읽음 처리를 하며 7일 안에 한 번 되돌릴 수 있다. Gmail만 바뀌고 ERURI 보관함은 그대로다.

**Architecture:** chat(0.13.0)은 그대로 `intent = mail_action`과 모델 출력 `mail` 칸을 돌려준다(플래그 `MAIL_ACTIONS`만 켠다). 새 Edge `mail-action`이 칸을 한 곳에서 검사·정제해 검색어를 조립하고(`in:inbox -is:starred` 고정, 모델이 쓴 검색어는 읽지 않음) `messages.list`로 id를 모아 `mail_actions` 행(= 확인 토큰, 10분)을 만든다. 실행·되돌리기는 늘 `jobs` 잡 `mail-action`(lease `mail:<user>`)이 묶음마다 Gmail을 부르고 `mail_action_progress`(커서 비교)로 id별 결과를 한 트랜잭션에 남긴다 — 결과 불명은 멱등 재시도, 마지막 시도는 재조회, dead는 트리거가 마감. Gmail units는 사용자 분 카운터 `gmail_units`를 수집(기록만)과 메일 정리(가져가기, 합계 5,400·자기 몫 4,000)가 함께 쓴다. 권한은 설정 › Gmail [권한 업데이트] → `addScopes` → `gmail-connect {upgrade: true}`가 기존 연결을 유지한 채 토큰만 바꾼다(revoke 0회).

**Tech Stack:** Supabase Postgres 마이그레이션(pg_cron, vault), Edge Functions Deno/TS(`deno test`, `npm:@electric-sql/pglite` 로컬 SQL 테스트, `npm:postgres@3` 호스팅 트랜잭션 테스트), Gmail API v1(`messages.list`·`get format=metadata|minimal`·`batchModify`·`trash`·`untrash`·`modify`, scope `gmail.modify`), GoogleSignIn-iOS 8(`restorePreviousSignIn`·`addScopes`), SwiftUI iOS 26 앱 `Eruri` + Swift Package `EruriCore`(XCTest, Swift 6), xcodegen `ios/project.yml`, XCUITest(게이트 전용 임시 타깃, 커밋하지 않음), TestFlight(`ios/scripts/testflight.sh`).

**Spec:** `docs/superpowers/specs/2026-09-22-assistant-design.md` @ `26e47bb` — §2 "메일 정리" 행, §3 "Gmail 쓰기 `gmail.modify`" 줄, §7 "메일 정리"(무엇·켜기·지목·미리보기·실행·되돌리기·동기화와의 관계·권한 업데이트·보관·감사·진단)와 "Gmail 동기화", §8 `connections.scopes`·`mail_actions`·`gmail_units`·삭제 표 두 줄, §9 "채팅 의도 판별"·"채팅 메일 정리"·"대화 기록·짧은 맥락", §11(0.14.0 화면 변경), §12 통제 2·3·4·5의 메일 정리 줄, §15 "1단계 추가 범위(2026-10-06 메일 정리 결정)"(서버 테스트·MAIL-real), §16 "2026-10-06 메일 정리"·"외부 리뷰 반영 (채팅 의도·메일 정리 스펙)" #1~#7. 문서 검증 `.context/verify-gmail-modify.md`. M0이 이 계획의 세부 결정(아래 D표)을 스펙에 올린다. 실행 규칙은 `AGENTS.md` §3(모델)·§5-8(실측 게이트)·§6(기계)·§7(개인정보)·§8(버전).

**선행 계획(이어받음):** `docs/superpowers/plans/2026-10-06-chat-add-event.md` @ `36bfd41` "다음 계획(메일 정리, 0.14.0)이 쓰는 인터페이스" — 이름·타입을 그대로 쓴다(아래 "0.13.0에서 받는 인터페이스"). **0.13.0(A0~A6)이 먼저 main에 들어간다고 가정**한다(M0 Step 1이 확인).

**선례:** `2026-10-01-gmail-unsubscribe.md`(Gmail·워커 잡·측정 후 배포·U6b·`migrations-pending`·트랜잭션 DB 테스트·실기기 사용자 확인), `2026-10-04-chat-history.md`·`2026-10-06-chat-add-event.md`(대화 기록 턴 종류·epoch `settle`·게이트 하네스 `.context/gate01x0/`).

**출발점:** main `36bfd41` 위 + 0.13.0 구현 커밋들(A0~A6). 서버 `0001`~`0028` 적용, `0029_unsub_gap_scan.sql`은 `supabase/migrations-pending/`에서 U6b를 기다린다. 앱 `MARKETING_VERSION`은 0.13.0(A6 뒤). Gmail 측정 ③c2는 2026-10-08 15:00 KST까지 — 그때까지 워커·gmail-* 배포·마이그레이션 적용·재동의·실 Gmail 쓰기 금지.

## 사용자 결정 (2026-10-06 — 스펙 §16 "2026-10-06 메일 정리"가 원본)

| # | 결정 | 이 계획에서 |
|---|---|---|
| MD1 | 지목 A(채팅) — 방식 1: 필터가 정해진 칸(동작 trash/read·발신자·제목 단어·받은 기간·광고·안 읽음)만 채우고 **서버가 검색어 조립**, 항상 `in:inbox -is:starred`. 모델이 쓴 `q`는 실행하지 않는다 | M1 `checkConditions`·`buildQuery`, M5 |
| MD2 | 보관함 연동 A — Gmail만 바꾸고 ERURI 보관함·추출 결과는 그대로 | M4(보관함 RPC 없음), Review Focus 6 |
| MD3 | 건수 A — 한 번 최대 1,000건, "총 약 N건 중 1,000건 · 별표 약 M건 제외" + 위 20건, 실행 뒤 [다음 1,000건 보기]는 다시 미리보기·확인 | M5 preview, M8 `countLine`, M9 |
| MD4 | 확인 토큰(서버 행, 10분)으로 미리보기 때 찾은 id만 실행, 결과 카드 [되돌리기] 7일 | M3 `mail_action_start`·`mail_action_undo`, M4, M9 |
| MD5 | `mail_actions`는 Gmail id·동작·상태·방식·오류 코드·id별 결과만, 7일 뒤 삭제. 미리보기 글은 앱 화면·기기 대화 기록에만 | M3 표·purge, M5 로그 규칙, M8 `MailTurn` |
| MD6 | 권한: 설정 › Gmail [권한 업데이트]로 `gmail.modify` 재동의 — 기존 연결 유지·토큰 교체, 실패·취소 때 아무것도 안 바뀜, revoke 없음, 연결이 살아 있는 동안 `disconnect()` 재동의 기각 | M6, M9 `GmailConnect.upgrade` |
| MD7 | 배포·재동의는 ③c2(2026-10-08 15:00 KST) 뒤 | M10~M12 |
| MD8 | 메인 판단(스펙 §16): ① 휴지통 범위 하한 ② 읽음은 늘 `is:unread` ③ units 합산 카운터(합계 5,400·메일 정리 4,000) ④ "별표 약 M건" ⑤ 카드 버튼 = 확인 ⑥ 0.14.0 새 연결·주간 재연결은 readonly + modify ⑦ 옛 토큰은 vault에서만 지우고 revoke 안 함 | M1·M3·M8·M9·M6 |

## 계획이 정한 것

| # | 항목 | 결정 | 이유 |
|---|---|---|---|
| D1 | 마이그레이션 위치·적용 시점 | `supabase/migrations-pending/0030_mail_cleanup.sql`로 만들고 **M10(③c2 뒤, U6b가 0029를 적용한 뒤)**에 `supabase/migrations/`로 옮겨 `db push`. ③c2 전에는 PGlite 로컬 SQL 테스트만, 호스팅 트랜잭션 테스트(적용·롤백)도 M10 | 지시문 Global Constraints("마이그레이션 적용은 ③c2 뒤"). 0029가 미적용이라 0030을 먼저 올리면 번호 역순이 된다. 0030은 `jobs`에 트리거를 만들고 `connections`에 열을 더한다 — 트랜잭션 테스트라도 그동안 두 표에 잠금이 걸려 측정 중 수집·워커 클레임을 몇 초 멈출 수 있다 |
| D2 | U6b와 순서 | **U6b 먼저(Step 3 워커 배포·회귀 → Step 3b 0029 적용), 그다음 M10** — 합치지 않는다. 같은 날 저녁 이어서 해도 된다. U6b가 Step 3b 전에 막히면 M10을 시작하지 않고 메인이 사용자에게 (a) 기다림 (b) U6b 절차대로 0029만 먼저 적용 중 무엇을 할지 묻는다 | ① 번호 순서(0029 → 0030). ② 둘 다 워커를 바꾼다 — 한 번에 배포하면 회귀(`smoke-gate`·LNK·`gmail-gate status`)가 깨졌을 때 어느 변경 탓인지 가를 수 없다. ③ U6b는 자기 판정(원클릭 비율)으로 멈출 수 있고 그 판정은 0029 적용 뒤라 이 계획을 막지 않는다. ④ 비용은 워커 배포 1회·회귀 1회(약 15분)뿐 |
| D3 | `mail-action` 경로·오류 코드 | 스펙의 것 + `400 bad_json`·`400 needs_target`(휴지통 범위 하한)·`400 bad_token`/`bad_id`·`409 reauth_required`(연결이 active가 아니거나 토큰 갱신 불가)·`429 gmail_rate_limited`·`502 gmail_upstream`·`503 disabled`(`MAIL_ACTIONS` 꺼짐 — preview·execute만, undo·status는 꺼져도 동작)·`404 not_found`. **0건이면 행을 만들지 않고 200 `token: null`**. 되돌리기의 행 없음은 정리된 것과 가를 수 없어 `410 undo_expired` | 스펙이 정하지 않은 경우를 앱이 문구로 가를 수 있게. 꺼짐에서도 되돌리기를 막지 않는 것은 롤백(플래그 끄기) 때 사용자가 이미 한 정리를 되돌릴 수 있게 |
| D4 | 상태 응답 | 스펙 `{id, status, total, done, failed, undone, undo_failed, code}` + `method`(batch/single/null). `undone` = `undo_cursor − |undo_failed_ids|`. 실행·되돌리기·상태 응답이 같은 모양 | trace `chat.mail`의 `method`(스펙 §7 진단)를 앱이 채우고, MAIL-real ②의 batch/건별 판정을 앱 화면 없이 볼 수 있게 |
| D5 | 미리보기 표본 | `from` = From 표시 이름(없으면 주소, `_shared/unsub.ts` `parseFrom`, 60자), `subject` 100자, `date` = `internalDate` ISO. 404(그사이 삭제)인 표본은 빠지고 건수는 그대로. `total_estimate` = 끝까지 읽었으면 `count`, 아니면 `max(첫 페이지 resultSizeEstimate, count)` | 추정치가 모은 수보다 작으면 "총 약 900건 중 1,000건"이 된다 |
| D6 | 수집 경로 units 기록 | `gmail-fetch`·`gmail-unsub-fetch`는 10통마다 한 번(이미 있는 10통 단위 연결 확인 자리)에 `20 × 다음 통수`, `gmail-sync`는 history 페이지 2·list 페이지 5·profile 1. **fail-open**: 기록 RPC 1초 예산, 잡당 첫 실패·초과 뒤 나머지 기록 생략(로그 `units_note_error` 1줄). 미리보기도 같은 기록(호출 전) | 스펙 "수집 경로는 기록만". 통마다 RPC를 부르면 fetch 잡 RPC가 두 배가 된다. 카운터가 수집을 늦추거나 실패시키면 안 된다(광고 기록 차단기와 같은 이유) |
| D7 | 잡 시간 예산 | 잡 1회 30초(`MAIL_JOB_BUDGET_MS`), Gmail 호출 1건 15초 타임아웃. 예산 끝 → `Deferred(지금)`(attempts 되돌림, 커서 유지). units 못 가져감 → 다음 분 시작으로 `Deferred`. 쿼터 → `Deferred(+60초)`, 행 `quota_since`(첫 쿼터 미루기 시각, 성공 묶음이 지움)가 30분을 넘으면 `fail_job` | 워커 배치 예산 100초 끝 무렵 클레임돼도 100 + 30 + 15 < Edge 벽시계 150초. 30분 판정을 잡 payload(불변)가 아닌 행에 둔다 |
| D8 | 진행 기록 | `mail_action_progress(p_user, p_id, p_phase, p_from, p_cursor, p_ok, p_failed)` — **현재 커서 = `p_from`이고 `|ok|+|failed| = p_cursor − p_from`일 때만** 붙이고 true. 아니면 false → 잡은 `stale`로 끝난다 | lease가 끝난 뒤 늦게 깨어난 워커가 같은 묶음을 두 번 적지 못하게(스펙 "최종 결과 중복 없음") |
| D9 | 폴백 규칙 | batch → 건별 전환: 휴지통(실행·되돌리기) **400만**, 읽음 400·404. 건별에서 id 하나가 400·404면 그 id만 실패. 실행 단계의 전환만 행 `method`에 남긴다(되돌리기는 실행 방식을 따른다: 휴지통 `single`이면 처음부터 `untrash`, 읽음은 늘 batch 먼저) | 스펙 §7 휴지통·읽음·되돌리기 문장 그대로, 건별 400은 그 id 문제(일괄 미지원이 아님) |
| D10 | 마지막 시도 재조회 | `attempts ≥ 5`에서 결과 불명이면 그 묶음의 남은 id를 20개씩 `messages.get(format=minimal)`(20 units/통, 매번 `gmail_take_units`)으로 읽어 목표 상태면 성공·아니면(오류 포함) 실패로 적고 `mail_action_finish`가 커서 뒤를 실패로 마감. 재조회 중 units를 못 가져가면 진행을 남긴 채 `Deferred` | 1,000건 batch 재조회는 20,000 units라 한 분에 못 끝난다. 20개마다 남기면 미뤄도 잃지 않는다 |
| D11 | 잡의 연결 문제 코드 | 토큰을 못 얻으면 연결이 active가 아니면 `reauth_required`, 아니면 `no_connection`으로 `mail_action_finish`(남은 id 실패). 앱 문구는 둘 다 "Gmail 권한(연결)이 바뀌어 K건을 처리하지 못했어요" | 스펙 오류 문구 하나로 묶인다 |
| D12 | `upgrade` 계약 | `{code, upgrade: true}`(`upgrade`가 있는데 불리언이 아니면 400 `bad_upgrade` — 일반 연결로 흘러가 커서·백필을 다시 하지 않게). 교환 → 연결 조회(없으면 404 `no_connection`) → profile 계정 비교(대소문자 무시, 다르면 409 `account_mismatch`) → refresh token 없음 200 `{refresh_token_stored: false, upgraded: false}` → modify 없음 403 `gmail_scope_missing` → 새 토큰 갱신 1회(실패 502 `token_verify_failed`) → `gmail_replace_token`(실패 500 `replace_failed`) → 200 `{connection_id, refresh_token_stored: true, upgraded: true}`. profile 401·403도 연결 상태를 바꾸지 않는다. 일반 경로는 저장 직후 `gmail_set_scopes`(실패해도 연결은 성공) | 스펙 §7 권한 업데이트 순서 + 실패 경로 전부 "아무것도 안 바뀜" |
| D13 | iOS 권한 업데이트 | `restorePreviousSignIn()` → 사용자 있고 modify가 아직 없으면 `addScopes([modify])`, 아니면(복원 실패·이미 승인됨) `signIn(additionalScopes: [readonly, modify])`(**`disconnect()` 없음**) → `serverAuthCode` → `upgrade: true`. 취소(-5)는 서버를 부르지 않고 문구 없음. 코드 없음·`refresh_token_stored: false` → "Google이 새 권한을 아직 주지 않았어요. 다음 Gmail 재연결 때 함께 더해져요(테스트 모드는 7일마다 재연결 알림)" | 스펙 D13 문장. 이미 승인된 scope에 `addScopes`는 오류가 날 수 있어(문서 미명시) 새 코드를 받는 일반 로그인으로 돌린다 |
| D14 | 앱 문구 추가 | 스펙에 없던 경우: 미리보기 409 "Gmail 연결이 끊겼어요 — 설정 › Gmail에서 다시 연결해 주세요" + [설정 열기], 429 "Gmail이 잠시 바빠요 — 잠시 뒤 다시 요청해 주세요", 503 "메일 정리를 지금 쓸 수 없어요", 그 밖·네트워크 "메일 정리를 하지 못했어요 — 잠시 뒤 다시 해 주세요", 성공 0 결과 "휴지통으로 옮기지 못했어요 (K건 실패)"(읽음 "읽음으로 바꾸지 못했어요 (K건 실패)"), 읽음 되돌리기 실패·기간 지남의 안내 "Gmail에서 직접 안 읽음으로 바꿀 수 있어요", 되돌릴 것 없음 "되돌릴 메일이 없어요", 취소 "취소했어요", 앱이 닫혀 미리보기를 못 받음 "앱이 닫혀 메일을 찾지 못했어요 — 다시 요청해 주세요", 20분 넘게 끝나지 않음 "아직 처리 중이에요 — 다시 열면 상태를 다시 읽어요" | M0이 §9에 올린다 |
| D15 | [다시 미리보기]·[다음 1,000건 보기] | 둘 다 서버가 돌려준 `conditions`를 그대로 `preview` 본문으로 보낸다(같은 7칸 — 서버가 다시 검사하며 정제는 멱등, M1 테스트). [다시 미리보기]는 그 턴의 미리보기를 바꾸고(결과가 아직 없다), [다음 1,000건 보기]는 **새 메일 정리 턴**(입력 글 "다음 1,000건 보기")을 만든다 — 앞 턴의 결과·[되돌리기]를 지우지 않게 | 스펙 "같은 conditions로 미리보기부터 다시" |
| D16 | 권한 업데이트 버튼 표시 | 설정이 `connections?select=scopes`를 **따로** 읽는다 — 200이고 연결이 active이며 modify가 없을 때만 [권한 업데이트]. 400(열 없음 = 0030 전)이면 숨긴다. 기존 상태 줄 요청(`select=account_ref,status,expires_at`)은 바꾸지 않는다 | 한 요청에 `scopes`를 넣으면 0030 전 서버에서 400이 나 Gmail 상태 줄까지 사라진다 |
| D17 | 버전·공개 | 이 기능 = **0.14.0**(R-B9 0.15.0). **M11 `MAIL-sim` 통과 전에 0.14.0 커밋을 넣지 않는다.** M8·M9 기능 커밋(`feat(core): mail cleanup`·`feat(ios): mail cleanup`)은 main에 들어간다 — U6b·다른 업로드가 그 전에 올리게 되면 `feat(core): mail cleanup` 직전 커밋에서 올린다(M0 Step 6에서 광고 해지 계획에 한 줄). 0.14.0 TestFlight는 M12에서 **서버 배포(M10) 뒤**에만 — 배포 전 서버의 `gmail-connect`는 `upgrade`를 몰라 일반 연결(커서 덮기·백필)로 처리한다 | 미검증 기능이 0.13.x 이름으로 나가지 않게, 구 서버 + 새 앱 조합을 사용자 기기에 만들지 않게 |
| D18 | 테스트 사용자 | 호스팅 DB 트랜잭션 테스트 **21**(행은 롤백), `smoke-mail` **22**, `MAIL-sim` **23**. 이미 쓰는 번호 1·2·7·9·11~20·100(2026-10-06 `grep` — 구현 때 다시 본다) | AGENTS.md §7 |
| D19 | 게이트 하네스 | `.context/gate0140/`(token.ts·seed.ts·inject.py·inject.sh·drive.sh·probe.ts·cleanup.ts·`MailGate.swift.txt`·`project.gate0140.yml.txt`·udid) — **커밋하지 않는다**(끝나면 지운다). 선례 `.context/gate0120/` | 지시문 "하네스 커밋 금지" |
| D20 | 403 reason 실측 | MAIL-real ① 전에 운영자가 `.context/gate0140/probe.ts`로 **합성 메일 3통(제목 `[ERURI 테스트]`)에만** 지금(readonly) 토큰으로 `batchModify(removeLabelIds: ["UNREAD"])`를 한 번 보내 403과 `reasons`를 기록한다(권한이 없어 메일은 바뀌지 않는다). 쿼터 reason(`rateLimitExceeded` 등)은 안전하게 일으킬 수 없어 문서·단위 테스트로 두고 스펙 §16에 수용 위험으로 적는다 | 지시문 "미확인 전제는 게이트로: 403 reason". 실사용자 Gmail 쓰기 시도는 합성 메일만 |

## 0.13.0에서 받는 인터페이스 (바꾸지 않는다)

`2026-10-06-chat-add-event.md` "다음 계획(메일 정리, 0.14.0)이 쓰는 인터페이스" 그대로:

```ts
// POST /functions/v1/chat — 요청 { question, context?, intents?: ("add_event"|"mail_action")[] }, 응답에 intent·mail
intent: "question" | "add_event" | "mail_action";   // 목록·MAIL_ACTIONS 변환 뒤
mail: MailFields | null;                            // intent === "mail_action"일 때만 모델 출력 그대로

// supabase/functions/chat/filters.ts
export type MailFields = { action: "trash" | "read"; sender: string | null; subject_words: string[];
  received_from: string | null; received_to: string | null; promotions: boolean; unread_only: boolean };
export const MAIL_SCHEMA;  export function asIntent(v: unknown): Intent;
// handler.ts: resolveIntent(raw, allowed, mailOn), ChatDeps.mailActions() = Deno.env.get("MAIL_ACTIONS") === "on"
```

- 평가: `supabase/eval/intent-cases.json`(69), `supabase/scripts/_intent-eval.ts`(`sameMail`·`summarize(rows, runs, mailJudged)`), 러너 `supabase/scripts/eval-intent.ts --runs 3 --mail-judged`.
- 앱: `ChatAddEvent.intents: [String]`(0.13.0 `["add_event"]` → 이 계획이 `"mail_action"`을 더함), `ChatReply.Answer.intent: String?`(→ `mail`을 더함), `ChatHistory.Kind`(0.13.0 `question·link·image·addEvent` → `.mailAction`을 더함; 맥락 제외는 `context()`의 `.question` 조건이 보장), `ChatHistory.Record.kind`(var).
- chat 코드는 이 계획에서 바꾸지 않는다(M7이 칸 일치 실패로 `MAIL_SCHEMA` 설명을 고칠 때만 — 그때도 `intents` 없는 요청의 바이트 동일 테스트는 그대로).

## 이 계획이 만드는 인터페이스

**서버 순수**(`supabase/functions/_shared/mail-query.ts`, M1):

```ts
export type MailAction = "trash" | "read";
export type MailConditions = { action: MailAction; sender: string | null; subject_words: string[];
  received_from: string | null; received_to: string | null; promotions: boolean; unread_only: boolean };
export type CheckResult = { ok: true; c: MailConditions } | { ok: false; code: "bad_condition"; fields: string[] } | { ok: false; code: "needs_target" };
export const SENDER_MAX = 100, WORD_MAX = 30, WORDS_MAX = 3;
export function sanitize(v: string): string;
export function seoulMidnight(day: string): number | null;          // 서울 0시 epoch 초, 달력에 없는 날 null
export function checkConditions(raw: unknown): CheckResult;
export function buildQuery(c: MailConditions, starred = false): string;
```

**Gmail 래퍼**(`supabase/functions/_shared/gmail.ts`, M2): `GMAIL_MODIFY_SCOPE`, `GmailHttpError(call, status, reasons: string[] = [])`, `QUOTA_REASONS`·`SCOPE_REASONS`, `type GmailFailure = "quota"|"scope"|"rejected"|"gone"|"unknown"`, `classifyGmailError(e: unknown): GmailFailure`, `type ListPage = { messages?: {id}[]; nextPageToken?; resultSizeEstimate? }`, `interface GmailMailApi { list(q, maxResults, pageToken?): Promise<ListPage>; headers(id): Promise<GmailMessage>; labels(id): Promise<{id; labelIds?}>; batchModify(ids, add, remove): Promise<void>; trash(id): Promise<void>; untrash(id): Promise<void>; modify(id, add, remove): Promise<void> }`, `gmailMailApi(accessToken): GmailMailApi`, `MAIL_CALL_TIMEOUT_MS = 15_000`.

**DB**(`0030_mail_cleanup.sql`, M3) — 모두 service role 전용(`revoke … from public, anon, authenticated`):

| 함수 | 반환 | 용도 |
|---|---|---|
| `gmail_note_units(p_user uuid, p_units int)` | void | 수집·미리보기 기록(거절 없음) |
| `gmail_take_units(p_user uuid, p_units int)` | boolean | 메일 정리 잡: 가져간 뒤 합계 ≤ 5,400·자기 몫 ≤ 4,000일 때만 |
| `mail_connection(p_user uuid)` | table(connection_id uuid, account_ref text, status text, scopes text[]) | 사용자 Gmail 연결 1개(최신) |
| `gmail_set_scopes(p_user, p_connection, p_scopes text[])` | void | 일반 연결 경로 |
| `gmail_replace_token(p_user, p_connection, p_refresh_token text, p_scopes text[])` | boolean | 권한 업데이트: vault 교체 + scopes·expires_at(+7일)·active. 커서·watch 불변 |
| `mail_action_preview(p_user, p_connection, p_action text, p_ids text[])` | uuid(= 토큰) | 미리보기 행 |
| `mail_action_counts(r mail_actions)` | jsonb `{id,status,total,done,failed,undone,undo_failed,code,method}` | 상태 응답 모양 |
| `mail_action_start(p_user, p_id, p_lease_prefix text default '')` | jsonb `{result: started|current|not_found|expired, …counts}` | 실행 시작(잡 `mail-action`, 우선순위 20) |
| `mail_action_undo(p_user, p_id, p_lease_prefix text default '')` | jsonb `{result: started|current|busy|nothing_to_undo|expired|not_found, …counts}` | 되돌리기 시작 |
| `mail_action_status(p_user, p_id)` | jsonb counts 또는 null | 상태 |
| `mail_action_begin(p_user, p_id, p_phase text)` | jsonb `{status, action, method, connection_id, ids, cursor}` 또는 `{status}`(끝난 행) 또는 null | 워커: pending→running / undo_pending→undoing |
| `mail_action_set_method(p_user, p_id, p_method text)` | void | null·batch → batch/single |
| `mail_action_progress(p_user, p_id, p_phase, p_from int, p_cursor int, p_ok text[], p_failed text[])` | boolean | 커서 비교(D8) |
| `mail_action_quota(p_user, p_id)` | timestamptz | `quota_since` 처음이면 지금으로, 그 값을 돌려줌 |
| `mail_action_finish(p_user, p_id, p_phase, p_code text default null)` | jsonb counts 또는 null | 남은 id 실패·종료 상태·감사(멱등) |
| `purge_mail_actions(p_user uuid default null)` | jsonb `{mail_actions, gmail_units}` | cron `mail-actions-purge-daily`(UTC 04:53) |
| 트리거 `jobs_mail_action_dead` | — | kind `mail-action`이 dead가 되면 `mail_action_finish(…, 'job_dead')` |

**워커**(`supabase/functions/worker/mail-action.ts`·`mail-action-deps.ts`, M4): `type Phase = "execute"|"undo"`, `MailJobDeps`, `mailActionJob(d, job): Promise<string>`(반환 `done|verified|gone|noop|stale|scope_missing|reauth_required|no_connection`), 상수 `MAIL_JOB_BUDGET_MS`·`BATCH_MAX`·`SINGLE_CHUNK`·`MAX_ATTEMPTS`·`QUOTA_DEFER_MS`·`QUOTA_STUCK_MS`·`UNITS`. `_shared/gmail-jobs.ts`: `gmailAccessToken(sb, refresh, user, conn): Promise<string|null>`, `noteGmailUnits(sb, user, units, budgetMs?): Promise<boolean>`, `meteredApi(api, note): GmailApi`, `GmailJobDeps.noteUnits?`.

**Edge**(`supabase/functions/mail-action/`, M5): 아래 HTTP 계약, `handleMailAction(req, deps)`, `MailActionDeps`, `sampleOf(msg)`.

```text
POST /functions/v1/mail-action/preview  body = MailFields(7칸) → 200 {token|null, action, conditions, count, exact, total_estimate, starred_estimate, has_more, sample:[{from,subject,date}]}
     401 · 400 bad_json|bad_condition{fields}|needs_target · 403 scope_missing · 404 no_connection · 409 reauth_required · 429 gmail_rate_limited · 502 gmail_upstream · 503 disabled
POST /functions/v1/mail-action/execute  {token} → 202(새 잡)|200(같은 토큰 다시) counts · 400 bad_token · 403 scope_missing · 404 not_found|no_connection · 410 token_expired · 503 disabled
POST /functions/v1/mail-action/undo     {id}    → 202|200 counts · 400 bad_id · 403 scope_missing · 404 no_connection · 409 busy|nothing_to_undo · 410 undo_expired
GET  /functions/v1/mail-action/status?id=      → 200 counts · 400 bad_id · 404 not_found
counts = {id, status, total, done, failed, undone, undo_failed, code, method}
```

**gmail-connect**(M6): `ConnectDeps.refresh(refreshToken): Promise<string>` 추가, 요청 `{code, upgrade?: boolean}`(D12).

**앱**(M8·M9): `MailCleanup`(`intent`·`modifyScope`·`tokenTTL`·`undoTTL`·`isMailAction`·`Conditions`·`Sample`·`Preview`·`Status`·`preview(_:)`·`status(_:)`·`errorCode(_:)`·`conditionLine`·`countLine`·`sampleLine`·`moreLine`·`grouped`·`previewError`·`executeError`·`undoError`·`progress`·`result`·`canUndo`·`isTokenExpired`·`Note`), `MailCleanupText`, `MailTurn`, `ChatHistory.Kind.mailAction`·`Record.mail`, `ChatReply.Answer.mail: JSONValue?`, `JSONValue.foundation`, 앱 `MailCleanupAPI`·`MailCleanupCard`·`SettingsRouter`·`GmailConnect.upgrade()`.

## Global Constraints

- **스펙 먼저(AGENTS.md §1):** M0 커밋 전에는 코드 태스크를 시작하지 않는다. 계획과 스펙이 다르면 스펙이 원본이다.
- **버전(AGENTS.md §8):** `MARKETING_VERSION: 0.14.0`(M11, `MAIL-sim` 통과 뒤 커밋). 메이저 금지. R-B9는 0.15.0 — 이 계획은 0.15.0을 쓰지 않는다. 빌드 번호는 업로드 때 `date +%Y%m%d%H%M`(M12).
- **③c2 전 금지(2026-10-08 15:00 KST까지):** 함수·워커 배포, 마이그레이션 적용(`db push`·호스팅 트랜잭션 테스트 포함 — D1), `MAIL_ACTIONS` 켜기, 재동의, 실 Gmail 쓰기. 그 전에는 코드와 **로컬 테스트(가짜 Gmail·PGlite)만**. M10은 `docs/superpowers/phase1/gates.md`의 ③c2 완료 기록과 U6b Step 3b(0029 적용) 기록을 확인한 뒤 시작한다(D2).
- **실호출 창:** OpenAI를 부르는 실행(M7 INTENT-eval, M10 smoke의 chat 단계, M11 게이트)은 **10-07·10-08 14:30~16:30 KST 금지, 그날 13:45 이후 시작 금지**(메인이 원장 최신 `status.t0`로 다시 계산). 예상 소요 M7 ≈ 5분, M10 ≈ 40분, M11 ≈ 40분.
- **실 Gmail 쓰기:** 실사용자 Gmail에 대한 쓰기(시도 포함)는 MAIL-real의 합성 메일(제목 접두 `[ERURI 테스트]`)과 D20 probe(같은 3통, 권한 없음 확인)뿐이다. 대조 메일 `[ERURI 대조]`는 읽기만. **영구 삭제 API(`messages.delete`·`batchDelete`)는 코드에 넣지 않는다**(M2 리뷰 확인: `grep -rn 'batchDelete\|messages/.*delete\|method: "DELETE"' supabase/functions` 0줄).
- **개인정보(AGENTS.md §7, 스펙 §12):** 서버 DB·로그·trace·`gates.md`·`results.md`·보고에 메일 제목·발신자·본문·검색 칸 값(`conditions`·`mail`)·Gmail 메시지 id를 쓰지 않는다 — 결과 코드·개수·방식·reason·상태만. `mail_actions`에는 Gmail id·결과만(제목·발신자 열 없음, M3 테스트). 미리보기 글은 응답으로만 앱에 간다. 테스트·평가는 합성 문구만. `items.content_enc` 복호화 조회 금지. 실사용자(`ERURI_USER_ID`)의 items·jobs·connections를 테스트가 만들거나 지우지 않는다.
- **호스팅 DB(AGENTS.md §7):** 테스트 사용자 21·22·23은 이 계획 전용(D18). 21은 트랜잭션 롤백으로만 쓴다. 22·23은 자기 행만 지운다(그 사용자의 `mail_actions`·`gmail_units`·`jobs(kind='mail-action')`·`audit_log(actor='mail-action')`·직접 만든 `connections`, 23은 게이트 시작 이후 그 사용자 `usage_counters`·`llm_slots`·`device_traces`). `truncate`·조건 없는 `delete` 금지.
- **실패 시 아무것도 안 바뀜(MD6):** `gmail-connect` upgrade 경로는 어떤 실패에서도 `revoke`를 부르지 않고 `connections`·vault·`sync_states`·잡을 바꾸지 않는다(M6 테스트로 고정).
- **Swift 6 동시성:** `ChatView` 상태는 메인 액터. 모든 비동기 갱신은 `settle(id, epoch)`(F11) — `await` 뒤 색인으로 턴을 고치지 않는다. `MailCleanup`은 값·순수 함수만.
- **기계(AGENTS.md §6):** 빌드·시뮬레이터·deno 전 `vm_stat | grep -E 'free|compressor'`. 시뮬레이터 빌드와 deno를 동시에 돌리지 않는다. 시뮬레이터는 pane 전용 UDID(`.context/gate0140/udid`).
- **테스트 명령:** 서버 로컬 `deno test --allow-net --allow-env --allow-read --allow-write=/tmp --env-file=supabase/.env supabase/tests/<파일>`(PGlite는 `--allow-read`만 필요하지만 npm 캐시 때문에 `--allow-write=/tmp`를 둔다), 전체 `deno test --allow-net --allow-env --allow-read --allow-write=/tmp --env-file=supabase/.env supabase/tests/ && deno check supabase/functions/{worker,mail-action,gmail-connect,chat}/index.ts supabase/scripts/*.ts`(저장소 루트). **호스팅 DB를 쓰는 `*-db.test.ts`는 ③c2 전에는 이 계획의 새 파일만 빼고 기존 것을 돌리지 않는다** — 기존 DB 테스트는 이 계획이 바꾸지 않으므로 M10에서 전체로 한 번 돈다. 앱 `cd ios && ./scripts/sim.sh gen && ./scripts/sim.sh test EruriCoreTests/<클래스>`, 빌드 `cd ios && ./scripts/sim.sh build`.
- **로컬 필터:** ③c2 전에 기존 테스트 파일을 돌릴 때는 `LOCAL_FILTER='/^(?!daily watch cron|gmail_reauth_due|gmail_save_connection)/'`로 `gmail.test.ts`의 호스팅 DB 사례 3개(396·415·432행)를 뺀다. 이 계획이 고치는 다른 테스트 파일(`unsub-jobs.test.ts`)은 호스팅 DB를 쓰지 않는다. 구현 때 `grep -n '_testenv' supabase/tests/<파일>`로 다시 본다.
- **모델(AGENTS.md §3):** M0 `opus`/`high`. M1~M6·M8·M9 구현·리뷰 `opus`/`high`(M4 리뷰 확인 필수: "Gmail 성공 뒤 `progress` 전 예외 → 다음 실행이 같은 묶음을 다시 보내고 결과 중복 없음", "`Deferred`가 attempts를 되돌리는 경로만 미루기", "로그에 id 없음"; M9 리뷰 확인 필수: "await 뒤 색인으로 턴을 고치는 곳 0", "모든 `settle`에 보낼 때 잡은 epoch", "폴링 Task가 epoch·턴 소멸에서 멈춤", "`mail_action` 분기에서 `reply`를 저장하지 않음"). M7·M10 `opus`/`medium`. M11 `opus`/`medium`. M12 실기기 세션은 `sonnet`/`medium`(AGENTS.md §3 — 사람이 옆에서 조작), 판정 기록은 메인이 확인.
- **기록:** `docs/superpowers/phase1/gates.md`에 행 `MAIL-server`(M6 끝, M10 호스팅 DB 테스트를 근거 칸에 덧붙임)·`INTENT-eval`(mail 판정을 기존 행 근거 칸에, M7)·`MAIL-deploy`(M10)·`MAIL-sim`(M11)·`MAIL-real`(M12). `docs/superpowers/poc/results.md`에 MAIL-real 단계별 판정(스펙 §15). 상태는 통과·실패·대기만("부분"은 마감 아님, AGENTS.md §5-8).
- **커밋:** 태스크마다, 트레일러 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. **push 금지**(메인이 회수 후 `git push origin main`). 게이트 하네스(`.context/gate0140/`) 커밋 금지(D19).

## 이 계획이 기대는 사실 (코드에서 확인, 2026-10-06)

| # | 사실 | 출처 |
|---|---|---|
| F1 | `history.list`는 `historyTypes=messageAdded`이고 `collectNewMessageIds`는 `messagesAdded`의 id만 모은다 — 라벨 변경(휴지통·읽음·되돌리기)은 새 항목을 만들지 않는다. 다시 와도 멱등 키 `gmail:<id>` | `_shared/gmail.ts:66,158-170`, `gmail-jobs.ts:158` |
| F2 | `GmailHttpError(call, status)`는 본문을 읽지 않고(`body.cancel()`) 메시지가 `"<호출> <상태>"`뿐 | `_shared/gmail.ts:8-10,57-62` |
| F3 | `listMessageIds`는 `maxResults=100` 고정, `resultSizeEstimate`를 돌려주지 않는다 → 새 `list`가 필요 | `_shared/gmail.ts:57-63` |
| F4 | `GmailClient`를 구현하는 테스트 가짜가 여러 파일에 있다(`unsub-jobs.test.ts` `fakeDeps`, `gmail.test.ts` `connectDeps`) — `GmailClient`에 메서드를 더하면 그 가짜들이 타입 오류. 그래서 새 인터페이스 `GmailMailApi`로 분리 | `tests/unsub-jobs.test.ts:30-41`, `tests/gmail.test.ts:224-248` |
| F5 | `accessToken(sb, deps, user, conn)`(비공개): `gmail_get_refresh_token`(active만) → refresh, `invalid_grant`면 `gmail_update(reauth_required)` + `gmail_enqueue_reauth` 후 null | `_shared/gmail-jobs.ts:92-103` |
| F6 | `gmailFetch`는 `n++ % 10 === 0`마다 `gmail_state`로 연결 확인, 통마다 240ms 쉼. `gmailUnsubFetch`는 400ms | `gmail-jobs.ts:123-176,205-230` |
| F7 | 워커: 핸들러 표 `handlers[kind]`, `runJob`이 `Deferred` → `defer_job`(attempts −1, `not_before = until`), 그 밖 오류 → `fail_job`(attempts × 60초 뒤, attempts ≥ 5면 dead). 클레임이 attempts를 먼저 올린다(첫 실행 1) | `worker/index.ts:35-56`, `worker/run.ts`, `migrations/0007_jobs_backoff.sql:6-10,13-40`, `0014_usage_budget.sql`(`defer_job`) |
| F8 | 워커 배치 예산 100초, 한 번에 1건 클레임, lease 180초 + 30초 하트비트. Edge 벽시계 150초 | `worker/batch.ts:6`, `worker/index.ts:23`, `worker/heartbeat.ts` |
| F9 | 우선순위는 `jobs_set_priority` 트리거가 정한다(insert 때 덮어씀): backfill 40, notify 10, gmail-sync/fetch/watch/reauth 20, 그 밖 30 → `mail-action`을 20으로 하려면 이 함수를 바꿔야 한다 | `migrations/0005_jobs_priority.sql:8-17` |
| F10 | `delete_gmail_source`는 `payload->>'connection_id'`가 그 연결인 잡을 kind와 무관하게 지운다 → `mail-action` payload에 `connection_id`를 넣으면 출처 삭제가 잡도 지운다. `mail_actions.connection_id`는 cascade | `migrations/0013_source_delete_lock.sql:33-62` |
| F11 | `ChatView.settle(_:_:save:_:)`는 id로 턴을 찾고 epoch(`log.clearCount`)가 같을 때만 고친다. 0.13.0이 `add_event` 분기·`registerEvent`를 같은 방식으로 더한다 | `ios/App/ChatView.swift:138-142`, 선행 계획 A5 Step 5 |
| F12 | `gmail-connect`: 저장 전 실패에 `discardToken`(revoke), 저장 후 `gmail_update`·`enqueue_job`·`gmail_enqueue_for_account`. 테스트가 rpc 순서를 정확히 본다(`["gmail_save_connection","gmail_update","enqueue_job","enqueue_job","gmail_enqueue_for_account"]`, `rpcCalls[2]`) | `gmail-connect/handler.ts:28-118`, `tests/gmail.test.ts:267-279` |
| F13 | `gmail_save_connection`은 연결 upsert + vault + `sync_states` 커서 덮기(재연결마다). 권한 업데이트는 이것을 부르지 않는다 | `migrations/0001_baseline.sql:232-249` |
| F14 | 0029는 `supabase/migrations-pending/`에 있고 U6b Step 3b가 옮겨 적용한다. `unsub-gap-db.test.ts`가 "트랜잭션 안에서 적용·롤백" 선례(`postgres@3`, `.temp/pooler-url`, `SUPABASE_DB_PASSWORD`) | `supabase/migrations-pending/0029_unsub_gap_scan.sql`, `tests/unsub-gap-db.test.ts:1-35`, 광고 해지 계획 U6b Step 3b |
| F15 | cron 시각(UTC): 매분, 매시 7분, 6시간 0분, 03:17·03:41·04:23·04:33·04:43, 0029의 19:27 → 04:53이 비어 있다 | `migrations/*.sql`·`migrations-pending/0029` `cron.schedule` |
| F16 | iOS: `GmailConnect.run(forceConsent:)`은 `signIn(withPresenting:hint:additionalScopes: [scope])`(readonly), 취소 코드 −5, 401이면 세션 다시 받고 한 번 재시도. GoogleSignIn 8.x | `ios/App/GoogleSignIn.swift:12,21-70`, `ios/project.yml:18-20` |
| F17 | 설정 Gmail 절: 상태 줄(`connections?select=account_ref,status,expires_at&provider=eq.gmail`), [Gmail 연결]·[다시 연결]·광고 해지 링크 | `ios/App/ContentView.swift:33-38,98-105` |
| F18 | 탭 전환은 `@Observable` 라우터의 `openCount` 변화를 `EruriApp`이 `onChange`로 받는다(`ArchiveRouter`) | `ios/App/ArchiveView.swift:5-10`, `ios/App/EruriApp.swift:42-58` |
| F19 | 대화 기록 파일 `Application Support/chat/chat-history.json` `{version: 1, records}`, 날짜는 epoch 초(게이트 주입 선례 `inject.py`) | `EruriCore/ChatHistory.swift:141-147`, `.context/gate0120/inject.py` |
| F20 | `JSONValue`는 `Decodable`뿐(인코딩·Foundation 변환 없음) — `mail`을 "그대로" 다시 보내려면 변환이 필요 | `EruriCore/ChatReply.swift:81-90` |
| F21 | `_shared/unsub.ts` `parseFrom(v)` → `{address, name}`(1,000자 넘으면 null) | `_shared/unsub.ts:14` |
| F22 | `audit_log(user_id, actor, action, target, at)` — 상세 칸이 없어 개수는 `target`에 붙인다(선례 `unsub_finish`: `'unsub:<id> <code>'`) | `migrations/0001_baseline.sql:98-105`, `0028_unsubscribe.sql` |
| F23 | `config.toml`에 없는 함수는 `verify_jwt = true`(기본) — `mail-action`은 사용자 JWT 함수라 설정을 더하지 않는다 | `supabase/config.toml:387-399` |
| F24 | 2026-10-06 `grep`: 쓰인 테스트 사용자 번호 1·2·7·9·11~20·100 | `docs`·`.context`·`supabase` |

## 미확인 전제와 흡수 게이트 (추측하지 않는다)

| # | 전제 | 상태 | 흡수 게이트 | 실패하면 |
|---|---|---|---|---|
| U1 | `batchModify(addLabelIds: ["TRASH"])`가 휴지통 이동으로 동작한다(되돌리기 `removeLabelIds: ["TRASH"]`) | 문서 미명시(§3) | MAIL-real ②·④ — 행 `method`가 `batch`로 남고 Gmail 휴지통에 3통 | 거절(400)이면 코드가 이미 건별로 넘어간다(`method = single`) — 판정을 `results.md`에 "건별 폴백"으로 적고 스펙 §7대로 1차 batch 시도를 빼는 수정 태스크를 만든다(메인). 200인데 휴지통에 없으면 **실패** — `MAIL_ACTIONS=off`, 메인이 사용자에게 보고 |
| U2 | Gmail 403의 `error.errors[].reason`이 `insufficientPermissions`(권한)·`rateLimitExceeded`·`userRateLimitExceeded`·`quotaExceeded`(쿼터)로 온다 | 문서 근거(usage limits 오류 목록), 권한 쪽 미측정 | D20 probe(MAIL-real 전) — 권한 reason 실측. 쿼터 reason은 수용 위험(스펙 §16) | 다른 reason이면 `SCOPE_REASONS`에 더하는 패치(M2) 후 probe 재실행 |
| U3 | `addScopes` 뒤 `serverAuthCode`가 오고 서버가 새 refresh token을 받는다 | 문서 미명시(§3) | MAIL-real ① | 코드 없음·`refresh_token_stored: false`면 "다음 재연결 때" 안내가 나오고 연결·커서 불변을 확인한 뒤, 판정은 다음 주간 재연결(readonly + modify 요청) 뒤로 미룬다(스펙 §15 ①) |
| U4 | 휴지통 이동·되돌리기가 history로 새 메일처럼 오지 않는다(새 items 0) | 추론(§3·F1) | MAIL-real ③ | 새 items가 생기면 멱등 키로 1건 이하인지 보고, 생겼으면 실패로 적고 `collectNewMessageIds`가 `TRASH` 라벨 메시지를 거르는 수정 태스크(메인) |
| U5 | 되돌린 메일이 받은편지함에 다시 보인다(INBOX 라벨 복원) | 문서 미명시 | MAIL-real ④ | 안 보이면 되돌리기(휴지통)에 `addLabelIds: ["INBOX"]`를 더하는 수정(M4 `op`) 후 ④ 재실행(스펙 §7 문장 그대로) |
| U6 | Gmail 검색이 한글 제목 단어 `subject:"테스트"`와 `subject:"ERURI"`를 함께 맞춘다 | 미확인 | MAIL-real ② 미리보기 3건 | 0건이면 MAIL-real을 멈추고 조건 줄·건수만 기록, 메인이 사용자에게 보고(조립 규칙 변경은 스펙부터) |
| U7 | `npm:@electric-sql/pglite`가 이 Deno에서 열리고 plpgsql·`gen_random_uuid()`·`create role`이 된다 | 미확인 | M3 Step 2 | 안 되면 `mail-sql.test.ts`를 지우고 SQL 검증은 M10 호스팅 트랜잭션 테스트(같은 사례)만으로 한다 — 계획 순서는 그대로, M3 커밋 메시지에 적는다 |
| U8 | `GIDGoogleUser.addScopes(_:presenting:)`·`GIDSignIn.restorePreviousSignIn()`가 async로 있다(GoogleSignIn 8) | 미확인(이 세션에서 SDK 소스 안 봄) | M9 Step 6 빌드 | 콜백판만 있으면 `withCheckedThrowingContinuation`으로 감싼다(같은 흐름) |
| U9 | gpt-6-luna가 `mail` 칸을 INTENT-eval 기준(완전 일치 ≥ 90%)으로 채운다 | 0.13.0에서 측정만 | M7 | M7 Step 3 반복(최대 2회). 그래도 실패면 메인이 사용자에게 보고 — 칸이 틀려도 미리보기 조건 줄·건수·위 20건이 받치므로(§12 통제 3) 대안은 "실패 사례 그룹을 INTENT-eval에 더하고 0.14.0 진행" 또는 "보류" |

### 실기기가 필요한 이유 (MAIL-real만)

U1·U3·U4·U5·U6은 실제 Google 계정의 Gmail에서만 재현된다(테스트 사용자에게 Google 계정이 없고, 실사용자 계정을 시뮬레이터에 로그인시키는 것이 오히려 조작이 많다). 화면 흐름(카드·만료·되돌리기·복원·오류 문구·설정 버튼)은 `MAIL-sim`이 시뮬레이터로 닫는다(memory "시뮬레이터 먼저, 실기기는 필수 항목만"). MAIL-real은 사용자 한 세션(약 15분)으로 묶는다.

## Review Focus

1. **잘못된 조건이 범위를 넓힌다.** 사람은 "9월 30일부터 9월 1일까지 합성상점 광고 지워줘"(거꾸로)·"2월 30일 메일"·`"()"`만 있는 발신자가 **모든 광고**로 넓어지지 않길 기대한다 → 거꾸로 범위·달력에 없는 날·정제 뒤 빈 값·길이 초과는 `bad_condition`이고 검색·행이 없다(M1 `rejects instead of dropping`, M5 `bad_condition never lists`).
2. **같은 토큰을 두 번 / 응답을 못 받아 다시 보낸다.** 사람은 두 번 눌러도 한 번만 실행되길 기대한다 → 같은 토큰 → 잡 1개·200 현재 상태(M3 사례 `start twice`, M5 `execute twice`), 앱은 버튼을 누르는 즉시 `running`으로 바꿔 다시 누를 수 없다(M9).
3. **워커가 Gmail 성공 뒤·기록 전에 죽는다 / 잡이 dead가 된다.** 사람은 결과 카드의 숫자가 맞고 되돌리기가 바뀐 메일만 되돌리길 기대한다 → 다음 실행이 같은 묶음을 다시 보내고 `ok_ids` 중복 없음(M4 `crash after Gmail success`), 늦게 깬 워커는 `stale`(M3 `progress from stale cursor`, M4 `stale`), dead → 트리거가 남은 id 실패로 마감(M3 `dead trigger`).
4. **권한 업데이트가 실패·취소된다.** 사람은 지금 Gmail 연결·동기화가 그대로이길 기대한다 → upgrade 실패 경로 전부 revoke 0·`gmail_save_connection`·`gmail_update`·`enqueue_job` 0(M6), 취소는 서버를 부르지 않음(M9), `upgrade: "yes"`처럼 형식이 틀리면 400이고 일반 연결로 흘러가지 않음(M6).
5. **수집이 카운터 때문에 멈춘다.** 사람은 메일 정리를 켜도 새 메일 수집이 늦거나 빠지지 않길 기대한다 → 기록 RPC 실패·지연에도 `gmail-fetch`는 같은 수를 저장하고 기록은 잡당 한 번 실패 뒤 생략(M4 `units note fails open`), 0030 적용 전에 새 워커가 돌아도 수집은 성공(같은 테스트 — RPC 없음 오류).
6. **휴지통으로 보낸 메일이 ERURI에서도 사라질까 걱정한다 / 동기화가 새 메일로 다시 받는다.** 사람은 보관함이 그대로이고 같은 메일이 두 번 생기지 않길 기대한다 → 워커 잡에 items·facts RPC 없음(M4 `never touches items`), MAIL-real ③ 새 items 0.

---

## 파일 구조

```text
docs/superpowers/specs/2026-09-22-assistant-design.md          # M0 스펙 세부
docs/superpowers/plans/2026-10-01-gmail-unsubscribe.md         # M0 U6b 업로드 기준 한 줄
supabase/functions/_shared/mail-query.ts                       # M1 신규: checkConditions·sanitize·seoulMidnight·buildQuery
supabase/tests/mail-query.test.ts                              # M1 신규
supabase/functions/_shared/gmail.ts                            # M2 GMAIL_MODIFY_SCOPE·GmailHttpError.reasons·classifyGmailError·GmailMailApi·gmailMailApi
supabase/tests/gmail-mail.test.ts                              # M2 신규(fetch 스텁)
supabase/migrations-pending/0030_mail_cleanup.sql              # M3 신규(미적용 — M10이 supabase/migrations/로 옮김)
supabase/tests/_mail-sql.ts                                    # M3 신규: 공유 SQL 사례(Q 어댑터)
supabase/tests/_pglite-stubs.ts                                # M3 신규: PGlite용 auth·vault·cron·jobs·connections 최소 스텁
supabase/tests/mail-sql.test.ts                                # M3 신규: PGlite 로컬
supabase/tests/mail-actions-db.test.ts                         # M3 신규: 호스팅 트랜잭션(적용·롤백) — M10에서 실행
supabase/functions/_shared/gmail-jobs.ts                       # M4 gmailAccessToken·noteGmailUnits·meteredApi·unitsNoter·noteUnits 기록
supabase/functions/worker/mail-action.ts                       # M4 신규: mailActionJob
supabase/functions/worker/mail-action-deps.ts                  # M4 신규: mailJobDeps(sb)
supabase/functions/worker/index.ts                             # M4 handlers["mail-action"]
supabase/tests/mail-jobs.test.ts                               # M4 신규
supabase/tests/units.test.ts                                   # M4 신규(수집 경로 기록)
supabase/functions/mail-action/{handler,deps,index}.ts         # M5 신규
supabase/tests/mail-action.test.ts                             # M5 신규
supabase/functions/gmail-connect/{handler,index}.ts            # M6 upgrade·gmail_set_scopes·refresh
supabase/tests/gmail.test.ts                                   # M6 테스트 추가·rpc 순서 기대 갱신
supabase/scripts/smoke-mail.ts                                 # M10 신규(배포된 mail-action·chat, 사용자 22)
ios/Packages/EruriCore/Sources/EruriCore/MailCleanup.swift     # M8 신규: MailCleanup·MailCleanupText·MailTurn·JSONValue.foundation
ios/Packages/EruriCore/Tests/EruriCoreTests/MailCleanupTests.swift
ios/Packages/EruriCore/Sources/EruriCore/ChatHistory.swift     # M8 .mailAction·mail·restored
ios/Packages/EruriCore/Sources/EruriCore/ChatReply.swift       # M8 Answer.mail
ios/Packages/EruriCore/Sources/EruriCore/ChatAddEvent.swift    # M8 intents += mail_action
ios/Packages/EruriCore/Tests/EruriCoreTests/{ChatHistoryTests,ChatReplyTests,ChatAddEventTests}.swift
ios/App/MailCleanupAPI.swift                                   # M9 신규: preview·execute·undo·status 호출
ios/App/MailCleanupCard.swift                                  # M9 신규: 카드 뷰
ios/App/ChatView.swift                                         # M9 mail_action 분기·previewMail·executeMail·undoMail·pollMail·카드 행
ios/App/GoogleSignIn.swift                                     # M9 scopes readonly+modify·upgrade()
ios/App/ContentView.swift                                      # M9 [권한 업데이트]·SettingsRouter
ios/App/EruriApp.swift                                         # M9 설정 탭 전환
ios/project.yml                                                # M11 0.14.0
docs/superpowers/phase1/gates.md                               # M6·M7·M10·M11·M12
docs/superpowers/poc/results.md                                # M12 MAIL-real
```

`EruriCore`는 SPM이라 새 파일이 자동으로 들어간다. 앱 타깃 새 파일 2개(`MailCleanupAPI.swift`·`MailCleanupCard.swift`)는 `ios/project.yml`의 `sources: App` 경로 아래라 `sim.sh gen`이 넣는다(M9 Step 1에서 확인).

---

### Task M0: 스펙 세부·U6b 업로드 기준

**Files:**
- Modify: `docs/superpowers/specs/2026-09-22-assistant-design.md`(§2 메일 정리 행, §7 "메일 정리", §8 `mail_actions` 행, §9 "채팅 메일 정리", §15 "1단계 추가 범위(2026-10-06 메일 정리 결정)", §16 새 소절)
- Modify: `docs/superpowers/plans/2026-10-01-gmail-unsubscribe.md`(U6b Step 6 한 문단)

**Interfaces:**
- Consumes: 이 계획의 D1~D20.
- Produces: 스펙 문장(M1~M12의 근거). 이후 태스크는 스펙과 계획이 다르면 스펙을 따른다.

- [ ] **Step 1: 선행 확인 — 0.13.0이 main에 있는가**

Run: `git log --oneline -40 | grep -E 'feat\(core\): chat add-event|feat\(ios\): add events from chat|feat\(chat\)' ; grep -n 'export const MAIL_SCHEMA\|export type MailFields' supabase/functions/chat/filters.ts; ls supabase/scripts/eval-intent.ts supabase/scripts/_intent-eval.ts; grep -n 'case question, link, image, addEvent' ios/Packages/EruriCore/Sources/EruriCore/ChatHistory.swift; grep -n 'static let intents' ios/Packages/EruriCore/Sources/EruriCore/ChatAddEvent.swift`
Expected: 0.13.0 서버(chat)·EruriCore 커밋이 보이고, `MAIL_SCHEMA`·`MailFields`·`eval-intent.ts`·`.addEvent`·`intents`가 있다. 하나라도 없으면 멈추고 메인에게 알린다(이 계획은 0.13.0 위에서만 성립한다).

- [ ] **Step 2: §2·§7 켜기·지목·미리보기**

스펙에서 아래 문장들을 정확히 찾아 바꾼다(앵커는 2026-10-06 `26e47bb` 본문). 인라인 코드 안의 `\``는 스펙 본문의 실제 백틱이다 — 찾을 때는 역슬래시를 뺀다.

(a) §2 표 "메일 정리" 행 끝 `앱 0.14.0 — 배포·재동의는 Gmail 측정 ③c2(2026-10-08 15:00 KST) 뒤 |` → `앱 0.14.0 — 배포·마이그레이션 적용·재동의는 Gmail 측정 ③c2(2026-10-08 15:00 KST) 뒤(계획 \`2026-10-06-mail-cleanup.md\`) |`

(b) §7 "켜기" 문장 `Gmail 측정 ③c2(2026-10-08 15:00 KST) 전에는 마이그레이션만 넣고, \`mail-action\`·\`gmail-connect\`·worker 배포(실행은 워커 잡이고 수집 경로가 units 카운터를 쓴다, 아래)·플래그 켜기·재동의는 ③c2 뒤다(§15).`를 다음으로 바꾼다:

```text
Gmail 측정 ③c2(2026-10-08 15:00 KST) 전에는 코드와 로컬 테스트(가짜 Gmail, SQL은 PGlite)만 한다 — 마이그레이션 파일은 `supabase/migrations-pending/0030_mail_cleanup.sql`(미적용)이고, 적용은 ③c2 뒤 광고 해지 U6b가 0029를 적용한 다음이다(번호 순서, 그리고 `jobs` 트리거·`connections` 열이 측정 중 두 표에 잠금을 만들지 않게). `mail-action`·`gmail-connect`·worker 배포(실행은 워커 잡이고 수집 경로가 units 카운터를 쓴다, 아래)·플래그 켜기·재동의도 ③c2 뒤다(§15). 플래그가 꺼져 있으면 `mail-action`의 미리보기·실행은 503 `disabled`이고 되돌리기·상태는 동작한다(끄는 것이 롤백이어도 이미 한 정리를 되돌릴 수 있게).
```

(c) §7 지목의 거절 문장 끝 `→ 400 \`bad_condition\` \`{fields: [칸 이름]}\`(값은 돌려주지 않는다), 행을 만들지 않는다.` 바로 뒤에 붙인다:

```text
 불리언·날짜 칸이 없으면(키 없음·null) 거짓·없음으로 본다. 빈 문자열·공백뿐인 발신자·제목 단어는 값이 없는 것으로 본다(정제 뒤 비는 것 — 원래 글자가 있었는데 다 지워진 경우 — 만 거절). 제목 단어는 정제 뒤 같은 것을 하나로 친다. 알지 못하는 키(모델이 쓴 `q` 등)는 읽지 않는다.
```

(d) §7 범위 하한 문장 `(받은편지함 전체를 휴지통으로 보내는 요청을 막는다).` 바로 뒤에 ` 이 경우 400 \`needs_target\`(행·검색 없음).`을 붙인다.

(e) §7 미리보기의 "비용" 줄(`- 비용: list 5 units × 최대 6 …(아래 "속도", 거절하지 않음).`) 바로 아래에 줄을 더한다:

```text
  - 세부(계획 `2026-10-06-mail-cleanup.md` D3·D5): 연결이 active가 아니거나 토큰을 갱신하지 못하면 409 `reauth_required`(갱신의 `invalid_grant`는 수집 잡과 같이 연결을 `reauth_required`로 두고 재인증 푸시), Gmail 쿼터(429·403 쿼터 reason) 429 `gmail_rate_limited`, 그 밖 Gmail 오류·타임아웃 502 `gmail_upstream`. **0건이면 행을 만들지 않고** 200 `token: null`·`count: 0`. 표본은 `from` = From 표시 이름(없으면 주소, 60자)·`subject` 100자·`date` = 받은 시각 ISO이고, 그사이 지워진 표본(404)은 빠진다(건수는 그대로). `total_estimate`는 끝까지 읽었으면 `count`, 아니면 첫 페이지 추정치와 `count` 중 큰 값이다(추정치가 모은 수보다 작아 "총 약 900건 중 1,000건"이 되지 않게).
```

- [ ] **Step 3: §7 실행·되돌리기·권한 업데이트, §8**

(a) §7 "lease·예산" 줄 끝 `예산이 끝나면 커서를 남긴 채 \`defer_job\`(attempts 되돌림)으로 다시 대기한다.` 뒤에 붙인다:

```text
 잡 1회 예산은 30초, Gmail 호출 1건은 15초에서 끊는다(워커 배치 끝에 클레임돼도 Edge 벽시계 150초 안 — 계획 D7). 진행 기록은 커서 비교다: `mail_action_progress(p_user, p_id, p_phase, p_from, p_cursor, p_ok, p_failed)`는 지금 커서가 `p_from`이고 `|ok| + |failed| = p_cursor − p_from`일 때만 붙이고 아니면 false라, lease가 끝난 뒤 늦게 깬 워커는 아무것도 적지 않고 끝난다(D8). 쿼터 미루기의 시작 시각은 행 `quota_since`에 두고 성공한 묶음이 지운다(아래 30분 판정). 마지막 시도의 재조회는 20개씩 units를 가져가며 진행을 남기고, 못 가져가면 진행을 남긴 채 미룬다(D10). 토큰을 못 얻으면 연결이 active가 아니면 `reauth_required`, 아니면 `no_connection`으로 마감한다(D11).
```

(b) §7 "휴지통" 줄 끝 `실행 방식은 행의 \`method\`(batch/single)에 남긴다(되돌리기가 같은 방식을 쓴다).` 뒤에 붙인다:

```text
 건별에서 한 id가 400·404면 그 id만 실패다(일괄 미지원으로 보지 않는다). batch → 건별 전환은 실행 단계에서만 `method`에 남기고 되돌리기는 그 값을 따른다 — 휴지통 `single`이면 처음부터 `untrash`, `batch`면 batch 먼저(400이면 건별), 읽음은 늘 batch 먼저(계획 D9).
```

(c) §7 "진행·결과" 줄의 `\`{id, status, total, done, failed, undone, undo_failed, code}\`(개수·상태만)`를 `\`{id, status, total, done, failed, undone, undo_failed, code, method}\`(개수·상태·방식만 — \`undone\` = 되돌리기 커서 − 되돌리기 실패 수. 실행·되돌리기 응답도 같은 모양, 계획 D4)`로 바꾼다.

(d) §7 "되돌리기" 줄의 `(지남·정리됨 410 \`undo_expired\`)`를 `(지남·정리됨 410 \`undo_expired\` — 행이 없으면 정리된 것과 가를 수 없어 늘 410)`로 바꾼다.

(e) §7 권한 업데이트의 서버 문장 끝 `… \`scopes\`·\`expires_at\`(테스트 모드 +7일)·status active를 갱신한다.` 뒤에 붙인다:

```text
 세부(계획 D12): `upgrade`가 있는데 불리언이 아니면 400 `bad_upgrade`(일반 연결로 흘러 커서·백필을 다시 하지 않게), 연결이 없으면 404 `no_connection`, 계정 비교는 대소문자 무시, 갱신 확인 실패 502 `token_verify_failed`, 교체 실패 500 `replace_failed`, 성공 200 `{connection_id, refresh_token_stored: true, upgraded: true}`. profile의 401·403도 연결 상태를 바꾸지 않는다. 일반 연결 경로는 저장 직후 `gmail_set_scopes`로 `scopes`를 남기고, 그 기록이 실패해도 연결은 성공이다(readonly로 보여 [권한 업데이트]가 남을 뿐).
```

(f) §7 권한 업데이트의 iOS 줄(`- 설정 › Gmail [권한 업데이트](연결돼 있고 modify가 없을 때만 보인다): iOS …`) 끝에 붙인다:

```text
 앱은 먼저 `restorePreviousSignIn()`으로 사용자를 되살리고, 되살리지 못했거나 Google 쪽에 modify가 이미 승인돼 있으면 `disconnect()` 없이 일반 로그인(추가 scope readonly + modify)으로 새 코드를 받아 같은 `upgrade` 요청을 보낸다(계획 D13). 버튼 표시는 `connections`의 `scopes`를 상태 줄과 따로 읽어 정한다 — 열이 없는 서버(0030 전)면 숨긴다(D16).
```

(g) §8 `mail_actions` 행: `| \`mail_actions\` | connection_id(connections cascade),`를 `| \`mail_actions\` | user_id(auth.users cascade), connection_id(connections cascade),`로, `undo_failed_ids text[], error_code null,`을 `undo_failed_ids text[], error_code null, quota_since null(쿼터 미루기 시작 — 성공 묶음이 지운다, 계획 D7),`로 바꾼다.

- [ ] **Step 4: §9 문구·§15 순서·게이트**

(a) §9 "채팅 메일 정리" 실행 줄의 `+ \`has_more\`면 [다음 1,000건 보기](같은 \`conditions\`로 미리보기부터 다시, 다시 확인)`를 `+ \`has_more\`면 [다음 1,000건 보기](같은 \`conditions\`로 미리보기부터 다시, 다시 확인 — 입력 글 "다음 1,000건 보기"인 새 메일 정리 턴이라 앞 턴의 결과·[되돌리기]는 그대로, 계획 D15)`로 바꾼다.

(b) §9 오류 문구 줄 끝 `실행 중 권한·연결이 끊김(\`error_code\`) "Gmail 권한(연결)이 바뀌어 K건을 처리하지 못했어요" + [설정 열기].` 뒤에 붙인다:

```text
 그 밖(계획 D14): 미리보기 연결 끊김(409) "Gmail 연결이 끊겼어요 — 설정 › Gmail에서 다시 연결해 주세요" + [설정 열기], Gmail 쿼터(429) "Gmail이 잠시 바빠요 — 잠시 뒤 다시 요청해 주세요", 기능 꺼짐(503) "메일 정리를 지금 쓸 수 없어요", 그 밖·네트워크 "메일 정리를 하지 못했어요 — 잠시 뒤 다시 해 주세요"(실행 버튼은 다시 누를 수 있다 — 같은 토큰이라 멱등), 성공 0 결과 "휴지통으로 옮기지 못했어요 (K건 실패)"(읽음 "읽음으로 바꾸지 못했어요 (K건 실패)"), 읽음의 되돌리기 실패·기간 지남 안내는 "Gmail에서 직접 안 읽음으로 바꿀 수 있어요", 되돌릴 것 없음(409 `nothing_to_undo`) "되돌릴 메일이 없어요", [취소] "취소했어요", 미리보기를 받기 전에 앱이 닫힘 "앱이 닫혀 메일을 찾지 못했어요 — 다시 요청해 주세요", 20분 넘게 끝나지 않음 "아직 처리 중이에요 — 다시 열면 상태를 다시 읽어요". [다시 미리보기]는 서버가 확정한 `conditions`를 그대로 다시 보낸다(D15).
```

(c) §15 "1단계 추가 범위(2026-10-06 메일 정리 결정)" 문단의 `순서: 마이그레이션(새 표·함수만, 기존 경로 불변 — 측정 창 밖) → 서버 테스트(가짜 Gmail) → ③c2(2026-10-08 15:00 KST) 뒤 함수·**워커** 배포(실행이 워커 잡이고 수집 경로가 바뀌므로 측정 중에는 배포하지 않는다, 2026-10-06 리뷰 반영) → \`MAIL_ACTIONS=on\`·0.14.0 TestFlight·재동의.`를 다음으로 바꾼다:

```text
순서(계획 `2026-10-06-mail-cleanup.md`): 서버 테스트(가짜 Gmail, SQL은 PGlite 로컬 — 마이그레이션 파일은 `supabase/migrations-pending/0030_mail_cleanup.sql`, 미적용) → ③c2(2026-10-08 15:00 KST) 뒤, 광고 해지 U6b가 워커 배포·0029 적용을 마친 다음 호스팅 트랜잭션 DB 테스트 → 0030 적용 → **워커** 배포·회귀(실행이 워커 잡이고 수집 경로가 바뀌므로 측정 중에는 배포하지 않는다, 2026-10-06 리뷰 반영 — U6b와 합치지 않는다: 회귀가 깨졌을 때 어느 변경 탓인지 가르기 위해) → `mail-action`·`gmail-connect` 배포 → `MAIL_ACTIONS=on`·`MAIL-deploy` 스모크 → `MAIL-sim` → 0.14.0 TestFlight → 재동의·`MAIL-real`.
```

(d) 같은 문단 끝 `INTENT-eval은 0.13.0과 공유한다(\`mail\` 칸 판정 포함). 게이트:`는 그대로 두고, 바로 아래 "- **서버 테스트(가짜 Gmail)**:"를 "- **서버 테스트(가짜 Gmail) — 게이트 행 `MAIL-server`**:"로 바꾸고, 그 줄과 "- **MAIL-real**" 줄 사이에 두 줄을 넣는다:

```text
- **MAIL-deploy**(배포 스모크, 테스트 사용자 22 — Gmail 계정 없음): 401·404 `no_connection`·403 `scope_missing`·400 `bad_condition`(fields)·400 `needs_target`·409 `reauth_required`, 시드 행 실행 → 202 → 배포된 워커가 토큰 없음으로 `failed`(`no_connection`) 마감, 같은 토큰 다시 → 200 같은 상태, 만료 토큰 410, 남의·없는 토큰 404, 되돌리기 규칙(409 `nothing_to_undo`·202 → `undo_failed`·다시 200), `upgrade` 형식 오류 400·가짜 코드 502와 연결 행 불변, chat `intents`에 `mail_action`이 있을 때만 `mail_action`(없으면 `question`), 수집 회귀(`smoke-gate`·`gmail-gate status` dead 0).
- **MAIL-sim**(시뮬레이터, 테스트 사용자 23): 채팅 → 미연결·권한 없음·범위 없음 문구와 [설정 열기] → 설정 [권한 업데이트] 표시·숨김, 주입한 미리보기 카드(조건 줄·건수·위 20건·외 N건) → 실행 → 진행 → 결과(토큰 없음이라 권한(연결) 문구), 만료 → [다시 미리보기], 결과 → [되돌리기] → 되돌리기 결과, 앱 재실행 뒤 진행 중 턴이 상태를 다시 읽음, [다음 1,000건 보기]가 새 턴, 기기 로그에 합성 제목·발신자 없음.
```

(e) §15 "**MAIL-real**" 줄의 `①` 앞에 붙인다: `⓪ 운영자 probe — 지금(readonly) 토큰으로 합성 메일 3통(제목 \`[ERURI 테스트]\`)에만 \`batchModify(removeLabelIds: ["UNREAD"])\` 1회 → 403과 reason 기록(권한이 없어 바뀌지 않는다, 계획 D20). `

- [ ] **Step 5: §16 새 소절**

§16의 `### 플랜 B: 로컬 우선 구조` 바로 앞에 넣는다:

```text
### 2026-10-06 메일 정리 구현 계획 세부 (계획 `2026-10-06-mail-cleanup.md`, 메인 판단 — 사용자 재검토 가능)

계획이 스펙의 빈칸을 채운 것: ① 마이그레이션은 `migrations-pending/0030`으로 두고 ③c2 뒤 U6b의 0029 다음에 적용(D1) ② U6b 먼저, 이 계획 배포는 그다음 — 합치지 않음(D2, 회귀 귀속) ③ 오류 코드 추가(`needs_target`·`reauth_required`·`gmail_rate_limited`·`gmail_upstream`·`disabled`·`bad_upgrade`·`token_verify_failed`·`replace_failed`)와 0건이면 행 없음(D3·D12) ④ 상태 응답에 `method`(D4) ⑤ 수집 경로 units 기록은 10통·페이지 단위, fail-open(1초·잡당 차단기, D6) ⑥ 잡 30초·호출 15초 예산, 쿼터 30분 판정은 행 `quota_since`(D7) ⑦ 진행 기록은 커서 비교(D8) ⑧ 폴백·되돌리기 방식 규칙(D9) ⑨ 마지막 시도 재조회는 20개씩 진행 기록(D10) ⑩ iOS 권한 업데이트는 `restorePreviousSignIn` → `addScopes`, 안 되면 `disconnect()` 없는 일반 로그인(D13) ⑪ [다음 1,000건 보기]는 새 턴(D15) ⑫ [권한 업데이트] 표시는 `scopes`를 따로 읽음(D16) ⑬ 0.14.0 TestFlight는 서버 배포 뒤에만(구 `gmail-connect`는 `upgrade`를 몰라 일반 연결로 처리한다, D17).
수용 위험: 쿼터 403 reason(`rateLimitExceeded`·`userRateLimitExceeded`·`quotaExceeded`)은 안전하게 일으킬 수 없어 실측하지 않는다 — Gmail 오류 문서와 단위 테스트에 기대고, 다른 값이 오면 "결과 불명"(재시도·마지막 시도 재조회)으로 처리돼 메일이 잘못 바뀌지는 않는다. 권한 reason은 MAIL-real ⓪ probe로 잰다(D20).
```

- [ ] **Step 6: 광고 해지 계획 U6b 한 문단**

`docs/superpowers/plans/2026-10-01-gmail-unsubscribe.md`에서 `미검증 채팅 일정 등록이 0.12.x 이름으로 나가지 않게.`(0.13.0 계획 A0 Step 7이 넣은 문단의 끝)를 찾는다. 없으면 `미검증 채팅 기록 기능이 0.11.x 이름으로 나가지 않게.`를 앵커로 쓴다. 그 바로 뒤에 빈 줄 하나와 다음 문단을 넣는다:

```text
**메일 정리(계획 `2026-10-06-mail-cleanup.md` D17):** main에 `feat(core): mail cleanup` 커밋이 있는데 `gates.md`에 `MAIL-sim` 통과 행이 없으면 main HEAD를 올리지 않는다 — 그 커밋의 부모(`git log --format=%h -1 --grep '^feat(core): mail cleanup'`의 `^`)에서 위와 같은 방식으로 worktree를 만들어 올린다. 미검증 메일 정리가 0.13.x 이름으로, 그리고 `upgrade`를 모르는 구 `gmail-connect`와 함께 사용자 기기에 나가지 않게. 이 계획(메일 정리)의 배포(M10)는 U6b Step 3b(0029 적용)가 끝난 뒤에 시작한다.
```

- [ ] **Step 7: 확인·커밋**

Run: `git diff --stat && grep -c '2026-10-06-mail-cleanup.md' docs/superpowers/specs/2026-09-22-assistant-design.md && grep -n 'MAIL-deploy\|MAIL-sim\|needs_target\|quota_since\|bad_upgrade' docs/superpowers/specs/2026-09-22-assistant-design.md | wc -l`
Expected: 스펙·광고 해지 계획 두 파일만 바뀜, 계획 참조 ≥ 6, 새 이름 줄 ≥ 6.

```bash
git add docs/superpowers/specs/2026-09-22-assistant-design.md docs/superpowers/plans/2026-10-01-gmail-unsubscribe.md
git commit -m "docs(spec): mail cleanup plan details — pending 0030 applied after ③c2 and U6b's 0029, extra error codes and empty preview without a row, status carries method, compare-and-set progress, 30 s job budget and quota_since, fallback and undo method rules, upgrade contract and iOS restore/addScopes flow, new copy, gates MAIL-server/deploy/sim and probe step; U6b uploads before mail cleanup unless MAIL-sim passed

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task M1: 조건 검사·검색어 조립 (`_shared/mail-query.ts`)

**Files:**
- Create: `supabase/functions/_shared/mail-query.ts`
- Test: `supabase/tests/mail-query.test.ts`

**Interfaces:**
- Consumes: `MailFields`(타입만, `supabase/functions/chat/filters.ts` — 테스트에서 호환 확인).
- Produces: `MailAction`, `MailConditions`, `CheckResult`, `SENDER_MAX`·`WORD_MAX`·`WORDS_MAX`, `sanitize(v)`, `seoulMidnight(day)`, `checkConditions(raw)`, `buildQuery(c, starred?)` — M5가 쓴다.

- [ ] **Step 1: 실패하는 테스트**

`supabase/tests/mail-query.test.ts`:

```ts
import { assertEquals } from "jsr:@std/assert";
import type { MailFields } from "../functions/chat/filters.ts";
import { buildQuery, checkConditions, type MailConditions, sanitize, seoulMidnight } from "../functions/_shared/mail-query.ts";

// 메일 정리 지목(스펙 §7): 칸 검사·정제·서버 조립. 잘못된 칸은 버리지 않고 거절한다(리뷰 #1)
const base = { action: "trash", sender: null, subject_words: [], received_from: null, received_to: null, promotions: false, unread_only: false };
const ok = (raw: Record<string, unknown>) => {
  const r = checkConditions({ ...base, ...raw });
  if (!r.ok) throw new Error("expected ok, got " + JSON.stringify(r));
  return r.c;
};
const S = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d) / 1000 - 9 * 3600;   // 서울 0시 epoch 초

Deno.test("buildQuery: always in:inbox -is:starred first; sender/subject quoted; dates in Seoul; promotions; read adds is:unread", () => {
  const c = ok({ sender: "합성상점", subject_words: ["주문", "안내"], received_from: "2026-09-01", received_to: "2026-09-30", promotions: true });
  assertEquals(buildQuery(c), `in:inbox -is:starred from:"합성상점" subject:"주문" subject:"안내" after:${S(2026, 9, 1)} before:${S(2026, 10, 1)} category:promotions`);
  assertEquals(buildQuery(ok({ action: "read" })), "in:inbox -is:starred is:unread");
  assertEquals(buildQuery(ok({ promotions: true, unread_only: true })), "in:inbox -is:starred category:promotions is:unread");
  assertEquals(buildQuery(ok({ promotions: true }), true), "in:inbox is:starred category:promotions");
});

Deno.test("seoulMidnight: calendar dates only; 2026-02-30 and bad shapes are null", () => {
  assertEquals(seoulMidnight("2026-09-01"), S(2026, 9, 1));
  assertEquals(seoulMidnight("2026-02-30"), null);
  assertEquals(seoulMidnight("2026-9-1"), null);
  assertEquals(seoulMidnight("2026-13-01"), null);
});

Deno.test("sanitize: keeps letters, digits, spaces and @._+- only; quotes, parens, braces, colons, backslashes and emoji go", () => {
  assertEquals(sanitize(`합성"상점"(광고)`), "합성상점광고");
  assertEquals(sanitize("news@shop.example.com"), "news@shop.example.com");
  assertEquals(sanitize("a OR b"), "a OR b");                       // 따옴표 안이라 연산자가 아니다
  assertEquals(sanitize("in:anywhere {x} \\y"), "inanywhere x y");
  assertEquals(sanitize("합성🙂상점  "), "합성상점");
  assertEquals(sanitize("cafe\u0301"), "café");                     // 결합 문자는 NFC 로 합친 뒤 남는다
});

Deno.test("operators inside values stay literal: from:\"a OR b\" and a leading minus is quoted", () => {
  assertEquals(buildQuery(ok({ sender: "a OR b" })), `in:inbox -is:starred from:"a OR b"`);
  assertEquals(buildQuery(ok({ subject_words: ["-광고"] })), `in:inbox -is:starred subject:"-광고"`);
});

Deno.test("rejects instead of dropping: reversed range, impossible date, empty after sanitize, too long, too many words, wrong types", () => {
  assertEquals(checkConditions({ ...base, sender: "합성상점", received_from: "2026-09-30", received_to: "2026-09-01" }),
    { ok: false, code: "bad_condition", fields: ["received_from", "received_to"] });
  assertEquals(checkConditions({ ...base, promotions: true, received_from: "2026-02-30" }), { ok: false, code: "bad_condition", fields: ["received_from"] });
  assertEquals(checkConditions({ ...base, sender: `"()"` }), { ok: false, code: "bad_condition", fields: ["sender"] });
  assertEquals(checkConditions({ ...base, sender: "x".repeat(101) }), { ok: false, code: "bad_condition", fields: ["sender"] });
  assertEquals(checkConditions({ ...base, subject_words: ["y".repeat(31)] }), { ok: false, code: "bad_condition", fields: ["subject_words"] });
  assertEquals(checkConditions({ ...base, subject_words: ["a", "b", "c", "d"] }), { ok: false, code: "bad_condition", fields: ["subject_words"] });
  assertEquals(checkConditions({ ...base, subject_words: ["a", "{}"] }), { ok: false, code: "bad_condition", fields: ["subject_words"] });
  assertEquals(checkConditions({ ...base, promotions: "yes" }), { ok: false, code: "bad_condition", fields: ["promotions"] });
  assertEquals(checkConditions({ ...base, sender: "a", received_to: 20260930 }), { ok: false, code: "bad_condition", fields: ["received_to"] });
  assertEquals(checkConditions({ ...base, action: "delete" }), { ok: false, code: "bad_condition", fields: ["action"] });
  assertEquals(checkConditions(null), { ok: false, code: "bad_condition", fields: ["mail"] });
  assertEquals(checkConditions([base]), { ok: false, code: "bad_condition", fields: ["mail"] });
  assertEquals(checkConditions("in:inbox"), { ok: false, code: "bad_condition", fields: ["mail"] });
});

Deno.test("needs_target: trash needs sender/subject/date/promotions (unread alone is not enough); read needs nothing", () => {
  assertEquals(checkConditions({ ...base }), { ok: false, code: "needs_target" });
  assertEquals(checkConditions({ ...base, unread_only: true }), { ok: false, code: "needs_target" });
  assertEquals(checkConditions({ ...base, sender: "   " }), { ok: false, code: "needs_target" });   // 공백뿐 = 값 없음
  assertEquals(ok({ received_to: "2026-09-30" }).received_to, "2026-09-30");
  assertEquals(ok({ action: "read" }).unread_only, true);                                        // 읽음은 늘 안 읽은 메일만
});

Deno.test("model-written query strings and unknown keys are never read", () => {
  const c = ok({ promotions: true, q: "in:anywhere", query: "label:x", from: "boss@example.com" });
  assertEquals(buildQuery(c), "in:inbox -is:starred category:promotions");
});

Deno.test("absent booleans and dates are false/none; blank words are skipped; duplicate words after sanitize are one", () => {
  const r = checkConditions({ action: "trash", sender: "합성상점" });
  assertEquals(r, { ok: true, c: { ...base, sender: "합성상점" } as MailConditions });
  assertEquals(ok({ subject_words: ["주문", " ", "주문!"] }).subject_words, ["주문"]);
});

Deno.test("conditions round-trip: checking the returned conditions again gives the same conditions (re-preview sends them back)", () => {
  const c = ok({ sender: `합성"상점"`, subject_words: ["ERURI", "테스트"], received_from: "2026-09-01", promotions: true });
  assertEquals(checkConditions(c), { ok: true, c });
  const r = ok({ action: "read" });
  assertEquals(checkConditions(r), { ok: true, c: r });
});

Deno.test("chat MailFields (0.13.0) passes as-is", () => {
  const f: MailFields = { action: "read", sender: "뉴스레터", subject_words: [], received_from: "2026-09-28", received_to: "2026-10-04", promotions: false, unread_only: true };
  assertEquals(checkConditions(f).ok, true);
});
```

- [ ] **Step 2: 실패 확인**

Run: `deno test --allow-read supabase/tests/mail-query.test.ts`
Expected: FAIL — `Module not found "…/_shared/mail-query.ts"`.

- [ ] **Step 3: 구현**

`supabase/functions/_shared/mail-query.ts`:

```ts
// 메일 정리 지목(스펙 §7 "메일 정리"): 칸 검사·정제·검색어 조립을 한 곳에서 한다. chat 은 모델 출력 그대로 넘기고 앱이 보낸 칸도 믿지 않는다.
// 모델·앱이 쓴 검색어 문자열(q 등 모르는 키)은 읽지 않는다. 잘못된 칸은 버리지 않고 거절한다 — 버리면 범위가 넓어진다(리뷰 #1)
export type MailAction = "trash" | "read";
export type MailConditions = {
  action: MailAction; sender: string | null; subject_words: string[];
  received_from: string | null; received_to: string | null; promotions: boolean; unread_only: boolean;
};
export type CheckResult =
  | { ok: true; c: MailConditions }
  | { ok: false; code: "bad_condition"; fields: string[] }
  | { ok: false; code: "needs_target" };

export const SENDER_MAX = 100, WORD_MAX = 30, WORDS_MAX = 3;
const DROP = /[^\p{L}\p{M}\p{N}\s@._+-]/gu;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

// 글자·숫자·공백과 @._+- 만 남긴다(따옴표·괄호·중괄호·콜론·역슬래시 등은 지운다). 결과는 늘 따옴표로 감싸 쓴다
export function sanitize(v: string): string {
  return v.normalize("NFC").replace(DROP, "").replace(/\s+/g, " ").trim();
}

// 서울 날짜(YYYY-MM-DD)의 0시 epoch 초. 달력에 없는 날(2026-02-30)·다른 모양은 null
export function seoulMidnight(day: string): number | null {
  const m = DAY.exec(day);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const t = Date.UTC(y, mo - 1, d), back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return t / 1000 - 9 * 3600;
}

export function checkConditions(raw: unknown): CheckResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, code: "bad_condition", fields: ["mail"] };
  const r = raw as Record<string, unknown>;
  const bad: string[] = [];
  const action = r.action === "trash" || r.action === "read" ? r.action : null;
  if (!action) bad.push("action");

  let sender: string | null = null;
  if (r.sender !== null && r.sender !== undefined) {
    if (typeof r.sender !== "string" || r.sender.length > SENDER_MAX) bad.push("sender");
    else if (r.sender.trim() !== "") {
      const s = sanitize(r.sender);
      if (s === "") bad.push("sender"); else sender = s;
    }
  }

  const words: string[] = [];
  if (r.subject_words !== null && r.subject_words !== undefined) {
    const w = r.subject_words;
    if (!Array.isArray(w) || w.length > WORDS_MAX || w.some((x) => typeof x !== "string" || x.length > WORD_MAX)) bad.push("subject_words");
    else {
      for (const x of w as string[]) {
        if (x.trim() === "") continue;
        const s = sanitize(x);
        if (s === "") { bad.push("subject_words"); break; }
        if (!words.includes(s)) words.push(s);
      }
    }
  }

  const day = (k: "received_from" | "received_to"): string | null => {
    const v = r[k];
    if (v === null || v === undefined) return null;
    if (typeof v !== "string" || seoulMidnight(v) === null) { bad.push(k); return null; }
    return v;
  };
  const from = day("received_from"), to = day("received_to");
  if (from && to && from > to) bad.push("received_from", "received_to");

  const flag = (k: "promotions" | "unread_only"): boolean => {
    const v = r[k];
    if (v === null || v === undefined) return false;
    if (typeof v !== "boolean") { bad.push(k); return false; }
    return v;
  };
  const promotions = flag("promotions"), unread = flag("unread_only");

  if (bad.length) return { ok: false, code: "bad_condition", fields: [...new Set(bad)] };
  // 휴지통 범위 하한: 받은편지함 전체를 휴지통으로 보내지 않게(안 읽음만으로는 부족). 읽음은 되돌릴 수 있고 메일이 없어지지 않는다
  if (action === "trash" && !sender && words.length === 0 && !from && !to && !promotions) return { ok: false, code: "needs_target" };
  return { ok: true, c: { action: action!, sender, subject_words: words, received_from: from, received_to: to, promotions,
                          unread_only: action === "read" ? true : unread } };
}

// 늘 in:inbox -is:starred(별표 수는 starred = true 로 is:starred). 스팸·휴지통은 includeSpamTrash 기본값(false)으로 빠진다
export function buildQuery(c: MailConditions, starred = false): string {
  const q = ["in:inbox", starred ? "is:starred" : "-is:starred"];
  if (c.sender) q.push(`from:"${c.sender}"`);
  for (const w of c.subject_words) q.push(`subject:"${w}"`);
  if (c.received_from) q.push(`after:${seoulMidnight(c.received_from)}`);
  if (c.received_to) q.push(`before:${seoulMidnight(c.received_to)! + 86_400}`);
  if (c.promotions) q.push("category:promotions");
  if (c.unread_only || c.action === "read") q.push("is:unread");
  return q.join(" ");
}
```

- [ ] **Step 4: 통과 확인**

Run: `deno test --allow-read supabase/tests/mail-query.test.ts && deno check supabase/functions/_shared/mail-query.ts`
Expected: 10 passed, 0 failed, check 무오류. (`"합성🙂상점  "`의 이모지는 `\p{So}`라 지워진다. `cafe\u0301` 사례가 실패하면 NFC 정규화가 빠진 것.)

- [ ] **Step 5: 커밋**

```bash
git add supabase/functions/_shared/mail-query.ts supabase/tests/mail-query.test.ts
git commit -m "feat(server): mail cleanup conditions — check the seven fields in one place (reject reversed or impossible dates, values that sanitize to nothing, over-long or too many words, wrong types; never drop a field), trash needs sender/subject/date/promotions, read is always unread-only, and build the Gmail query server-side (in:inbox -is:starred, quoted values, Seoul day bounds) ignoring any model-written query

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task M2: Gmail 쓰기·목록·메타 래퍼 (`_shared/gmail.ts`)

**Files:**
- Modify: `supabase/functions/_shared/gmail.ts:8-11`(GmailHttpError·scope 상수), 파일 끝(새 함수·인터페이스)
- Test: `supabase/tests/gmail-mail.test.ts`

**Interfaces:**
- Consumes: 기존 `G`(API 기준 URL), `GmailMessage`.
- Produces: `GMAIL_MODIFY_SCOPE`, `MAIL_CALL_TIMEOUT_MS`, `GmailHttpError.reasons`, `QUOTA_REASONS`, `SCOPE_REASONS`, `GmailFailure`, `classifyGmailError(e)`, `ListPage`, `GmailMailApi`, `gmailMailApi(accessToken)` — M4·M5·M6이 쓴다. 기존 `GmailClient`·`gmailApi`는 바꾸지 않는다(F4).

- [ ] **Step 1: 실패하는 테스트**

`supabase/tests/gmail-mail.test.ts`:

```ts
import { assert, assertEquals, assertRejects } from "jsr:@std/assert";
import { classifyGmailError, GMAIL_MODIFY_SCOPE, GmailHttpError, gmailMailApi } from "../functions/_shared/gmail.ts";

// 메일 정리 Gmail 래퍼(스펙 §7): 요청 모양·reason 파싱·분류. fetch 를 바꿔 끼운다(네트워크 없음)
type Call = { url: URL; method: string; body: unknown; auth: string | null };
function stub(respond: (c: Call) => Response) {
  const calls: Call[] = [];
  const orig = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const c: Call = { url: new URL(input instanceof Request ? input.url : String(input)), method: init.method ?? "GET",
      body: typeof init.body === "string" ? JSON.parse(init.body) : null, auth: new Headers(init.headers).get("authorization") };
    calls.push(c);
    return respond(c);
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = orig; } };
}
const gErr = (status: number, reason: string, details?: string) => Response.json({ error: { code: status, message: "합성 메시지 본문",
  errors: [{ reason, message: "x" }], ...(details ? { details: [{ reason: details }] } : {}) } }, { status });

Deno.test("list: q, maxResults and pageToken in the URL; resultSizeEstimate passes through", async () => {
  const s = stub(() => Response.json({ messages: [{ id: "a" }], nextPageToken: "p2", resultSizeEstimate: 1234 }));
  try {
    const p = await gmailMailApi("at").list(`in:inbox -is:starred from:"합성상점"`, 500, "p1");
    assertEquals(p, { messages: [{ id: "a" }], nextPageToken: "p2", resultSizeEstimate: 1234 });
    const u = s.calls[0].url;
    assertEquals([u.pathname, u.searchParams.get("q"), u.searchParams.get("maxResults"), u.searchParams.get("pageToken"), s.calls[0].auth],
      ["/gmail/v1/users/me/messages", `in:inbox -is:starred from:"합성상점"`, "500", "p1", "Bearer at"]);
  } finally { s.restore(); }
});

Deno.test("headers: format=metadata with From and Subject only; labels: format=minimal", async () => {
  const s = stub(() => Response.json({ id: "m 1", internalDate: "1790000000000", labelIds: ["INBOX"] }));
  try {
    await gmailMailApi("at").headers("m 1");
    await gmailMailApi("at").labels("m 1");
    assertEquals(s.calls[0].url.pathname, "/gmail/v1/users/me/messages/m%201");
    assertEquals([s.calls[0].url.searchParams.get("format"), s.calls[0].url.searchParams.getAll("metadataHeaders")], ["metadata", ["From", "Subject"]]);
    assertEquals(s.calls[1].url.searchParams.get("format"), "minimal");
  } finally { s.restore(); }
});

Deno.test("writes: batchModify body, trash/untrash/modify paths and POST", async () => {
  const s = stub(() => new Response(null, { status: 204 }));
  try {
    const api = gmailMailApi("at");
    await api.batchModify(["a", "b"], ["TRASH"], []);
    await api.trash("a"); await api.untrash("a"); await api.modify("a", ["UNREAD"], []);
    assertEquals(s.calls.map((c) => [c.method, c.url.pathname]), [
      ["POST", "/gmail/v1/users/me/messages/batchModify"], ["POST", "/gmail/v1/users/me/messages/a/trash"],
      ["POST", "/gmail/v1/users/me/messages/a/untrash"], ["POST", "/gmail/v1/users/me/messages/a/modify"]]);
    assertEquals(s.calls[0].body, { ids: ["a", "b"], addLabelIds: ["TRASH"], removeLabelIds: [] });
    assertEquals(s.calls[3].body, { addLabelIds: ["UNREAD"], removeLabelIds: [] });
  } finally { s.restore(); }
});

Deno.test("errors carry status and reason codes only — never the message body", async () => {
  const s = stub(() => gErr(403, "insufficientPermissions", "ACCESS_TOKEN_SCOPE_INSUFFICIENT"));
  try {
    const e = await assertRejects(() => gmailMailApi("at").batchModify(["a"], [], ["UNREAD"]), GmailHttpError);
    assertEquals([e.message, e.status, e.reasons], ["messages.batchModify 403", 403, ["insufficientPermissions", "ACCESS_TOKEN_SCOPE_INSUFFICIENT"]]);
    assert(!JSON.stringify(e).includes("합성"));
  } finally { s.restore(); }
  const t = stub(() => Response.json({ error: { errors: [{ reason: "bad reason <x>" }, { reason: "a".repeat(80) }] } }, { status: 400 }));
  try {
    const e = await assertRejects(() => gmailMailApi("at").trash("a"), GmailHttpError);
    assertEquals(e.reasons, []);                                                  // 코드 모양이 아닌 값은 버린다
  } finally { t.restore(); }
});

Deno.test("classifyGmailError: 429 and quota reasons → quota, permission reasons → scope, 400 rejected, 404 gone, the rest unknown", () => {
  const E = (s: number, ...r: string[]) => new GmailHttpError("x", s, r);
  assertEquals(classifyGmailError(E(429)), "quota");
  assertEquals(classifyGmailError(E(403, "rateLimitExceeded")), "quota");
  assertEquals(classifyGmailError(E(403, "userRateLimitExceeded")), "quota");
  assertEquals(classifyGmailError(E(403, "quotaExceeded")), "quota");
  assertEquals(classifyGmailError(E(403, "insufficientPermissions")), "scope");
  assertEquals(classifyGmailError(E(403, "forbidden")), "unknown");              // 403 을 일괄 미지원으로 보지 않는다
  assertEquals(classifyGmailError(E(400, "invalidArgument")), "rejected");
  assertEquals(classifyGmailError(E(404)), "gone");
  assertEquals(classifyGmailError(E(500)), "unknown");
  assertEquals(classifyGmailError(new TypeError("network")), "unknown");
  assertEquals(GMAIL_MODIFY_SCOPE, "https://www.googleapis.com/auth/gmail.modify");
});
```

- [ ] **Step 2: 실패 확인**

Run: `deno test --allow-read supabase/tests/gmail-mail.test.ts`
Expected: FAIL — `gmailMailApi`·`classifyGmailError`·`GMAIL_MODIFY_SCOPE` export 없음.

- [ ] **Step 3: 구현**

`supabase/functions/_shared/gmail.ts` 8~11행을 바꾼다:

```ts
// Gmail API가 2xx가 아닌 상태를 돌려줌. 메시지는 "<호출> <상태>"만(토큰·본문 없음). reasons = 오류 본문의 reason 코드(메일 정리 쓰기 경로만 채운다)
export class GmailHttpError extends Error {
  constructor(readonly call: string, readonly status: number, readonly reasons: string[] = []) { super(`${call} ${status}`); this.name = "GmailHttpError"; }
}
export const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
export const GMAIL_MODIFY_SCOPE = "https://www.googleapis.com/auth/gmail.modify";   // 메일 정리(스펙 §7): 읽기·라벨·휴지통, 영구 삭제 불가
```

파일 끝에 더한다:

```ts
// ── 메일 정리(스펙 §7 "메일 정리"): 목록·메타·라벨 변경·휴지통. 영구 삭제(messages.delete·batchDelete)는 두지 않는다 ──
export const MAIL_CALL_TIMEOUT_MS = 15_000;
// 403 은 쿼터일 수도 권한일 수도 있다(스펙 §7 오류 reason 분기). 새 오류 형식(error.details[].reason)도 함께 읽는다
export const QUOTA_REASONS = new Set(["rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded", "RATE_LIMIT_EXCEEDED"]);
export const SCOPE_REASONS = new Set(["insufficientPermissions", "ACCESS_TOKEN_SCOPE_INSUFFICIENT"]);
export type GmailFailure = "quota" | "scope" | "rejected" | "gone" | "unknown";
export function classifyGmailError(e: unknown): GmailFailure {
  if (!(e instanceof GmailHttpError)) return "unknown";                    // 타임아웃·연결 끊김 = 결과 불명
  if (e.status === 429) return "quota";
  if (e.status === 403) {
    if (e.reasons.some((r) => QUOTA_REASONS.has(r))) return "quota";
    if (e.reasons.some((r) => SCOPE_REASONS.has(r))) return "scope";
    return "unknown";
  }
  if (e.status === 400) return "rejected";
  if (e.status === 404) return "gone";
  return "unknown";
}
async function mailError(call: string, r: Response): Promise<GmailHttpError> {
  type Body = { error?: { errors?: { reason?: unknown }[]; details?: { reason?: unknown }[] } };
  const j = await r.json().catch(() => null) as Body | null;
  const reasons = [...(j?.error?.errors ?? []), ...(j?.error?.details ?? [])].map((x) => x?.reason)
    .filter((x): x is string => typeof x === "string" && /^[A-Za-z_]{1,64}$/.test(x)).slice(0, 5);
  return new GmailHttpError(call, r.status, reasons);
}
function mailFetch(accessToken: string, url: string | URL, body?: unknown): Promise<Response> {
  return fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers: { authorization: `Bearer ${accessToken}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(MAIL_CALL_TIMEOUT_MS),
  });
}
const msgUrl = (id: string, rest = "") => `${G}/messages/${encodeURIComponent(id)}${rest}`;

export type ListPage = { messages?: { id: string }[]; nextPageToken?: string; resultSizeEstimate?: number };
export async function listMessages(accessToken: string, q: string, maxResults: number, pageToken?: string): Promise<ListPage> {
  const u = new URL(`${G}/messages`); u.searchParams.set("q", q); u.searchParams.set("maxResults", String(maxResults));
  if (pageToken) u.searchParams.set("pageToken", pageToken);
  const r = await mailFetch(accessToken, u);
  if (!r.ok) throw await mailError("messages.list", r);
  return await r.json() as ListPage;
}
export const PREVIEW_HEADERS = ["From", "Subject"];   // 미리보기 표본: 본문 없이 헤더만
export async function getMessageHeaders(accessToken: string, id: string): Promise<GmailMessage> {
  const u = new URL(msgUrl(id)); u.searchParams.set("format", "metadata");
  for (const h of PREVIEW_HEADERS) u.searchParams.append("metadataHeaders", h);
  const r = await mailFetch(accessToken, u);
  if (!r.ok) throw await mailError("messages.get", r);
  return await r.json() as GmailMessage;
}
export async function getMessageLabels(accessToken: string, id: string): Promise<{ id: string; labelIds?: string[] }> {
  const u = new URL(msgUrl(id)); u.searchParams.set("format", "minimal");
  const r = await mailFetch(accessToken, u);
  if (!r.ok) throw await mailError("messages.get", r);
  return await r.json() as { id: string; labelIds?: string[] };
}
async function post(accessToken: string, call: string, url: string, body: unknown): Promise<void> {
  const r = await mailFetch(accessToken, url, body);
  if (!r.ok) throw await mailError(call, r);
  await r.body?.cancel();
}
export const batchModify = (t: string, ids: string[], add: string[], remove: string[]) =>
  post(t, "messages.batchModify", `${G}/messages/batchModify`, { ids, addLabelIds: add, removeLabelIds: remove });
export const trashMessage = (t: string, id: string) => post(t, "messages.trash", msgUrl(id, "/trash"), {});
export const untrashMessage = (t: string, id: string) => post(t, "messages.untrash", msgUrl(id, "/untrash"), {});
export const modifyMessage = (t: string, id: string, add: string[], remove: string[]) =>
  post(t, "messages.modify", msgUrl(id, "/modify"), { addLabelIds: add, removeLabelIds: remove });

export interface GmailMailApi {
  list(q: string, maxResults: number, pageToken?: string): Promise<ListPage>;
  headers(id: string): Promise<GmailMessage>;
  labels(id: string): Promise<{ id: string; labelIds?: string[] }>;
  batchModify(ids: string[], add: string[], remove: string[]): Promise<void>;
  trash(id: string): Promise<void>;
  untrash(id: string): Promise<void>;
  modify(id: string, add: string[], remove: string[]): Promise<void>;
}
export function gmailMailApi(accessToken: string): GmailMailApi {
  return {
    list: (q, n, p) => listMessages(accessToken, q, n, p),
    headers: (id) => getMessageHeaders(accessToken, id),
    labels: (id) => getMessageLabels(accessToken, id),
    batchModify: (ids, a, r) => batchModify(accessToken, ids, a, r),
    trash: (id) => trashMessage(accessToken, id),
    untrash: (id) => untrashMessage(accessToken, id),
    modify: (id, a, r) => modifyMessage(accessToken, id, a, r),
  };
}
```

(`trash`·`untrash`는 빈 본문 `{}`를 POST한다 — Gmail은 본문을 무시한다. 테스트의 `body`가 `{}`인지 보지는 않는다.)

- [ ] **Step 4: 통과·회귀 확인**

Run: `deno test --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/tests/gmail-mail.test.ts supabase/tests/gmail.test.ts supabase/tests/unsub-jobs.test.ts --filter "$LOCAL_FILTER"`(`LOCAL_FILTER`는 Global Constraints)
Expected: `gmail-mail` 5 passed, `gmail.test.ts`·`unsub-jobs.test.ts`의 가짜 사례 전부 통과, 호스팅 DB 사례 3개는 걸러짐(filtered out 3).

Run: `grep -rn 'batchDelete\|messages/.*delete\|method: "DELETE"' supabase/functions; deno check supabase/functions/_shared/gmail.ts`
Expected: 첫 명령 출력 없음(영구 삭제 없음), check 무오류.

- [ ] **Step 5: 커밋**

```bash
git add supabase/functions/_shared/gmail.ts supabase/tests/gmail-mail.test.ts
git commit -m "feat(server): Gmail mail-cleanup calls — list with resultSizeEstimate, From/Subject metadata, minimal labels, batchModify/trash/untrash/modify with a 15 s timeout, errors carry status and reason codes only, and classifyGmailError splits 403 into quota or scope by reason (other 403s stay unknown, never treated as batch-unsupported); no permanent delete call exists

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task M3: 마이그레이션 `0030`(미적용) + SQL 테스트

**Files:**
- Create: `supabase/migrations-pending/0030_mail_cleanup.sql`
- Create: `supabase/tests/_mail-sql.ts`(공유 사례), `supabase/tests/_pglite-stubs.ts`(PGlite 최소 스텁)
- Test: `supabase/tests/mail-sql.test.ts`(PGlite 로컬 — 지금 실행), `supabase/tests/mail-actions-db.test.ts`(호스팅 트랜잭션 — **M10에서만 실행**)

**Interfaces:**
- Consumes: 기존 `connections`·`sync_states`·`jobs`(`priority`·`not_before`·`claimed_at`)·`audit_log`·`enqueue_job`·`fail_job`·`jobs_set_priority`·`gmail_save_connection`·`gmail_get_refresh_token`·vault·pg_cron(F7·F9·F13·F22).
- Produces: "이 계획이 만드는 인터페이스" DB 표 전부(이름·인자·반환 그대로) — M4·M5·M6·M10이 쓴다. `supabase/tests/_mail-sql.ts`의 `MIGRATION_0030`(M10이 경로를 바꾼다)·`CASES`·`setupCtx`.

- [ ] **Step 1: 마이그레이션 파일**

`supabase/migrations-pending/0030_mail_cleanup.sql`:

```sql
-- 메일 정리(스펙 §7 "메일 정리", §8 mail_actions·gmail_units·connections.scopes, §12 통제 2·4). 2026-10-06 사용자 결정, 앱 0.14.0.
-- 적용은 ③c2 뒤 U6b 의 0029 다음(계획 2026-10-06-mail-cleanup.md D1·M10). 그때까지 supabase/migrations-pending/ 에 둔다 — 다른 계획의 db push 에 딸려 가지 않게.
-- 기존 것에 닿는 것: connections.scopes 열(null 허용), jobs_set_priority 에 kind 하나(20), jobs dead 트리거(kind mail-action 만). 다른 kind 의 동작은 같다.
-- 함수는 모두 service role 전용(mail-action·gmail-connect 함수, 워커). 앱은 mail-action 함수로만 접근한다(표는 RLS 켜고 정책 없음)

alter table connections add column if not exists scopes text[];   -- 마지막 토큰 교환의 승인 scope. null = 0.14.0 전 연결(readonly 로 본다)

create table mail_actions (
  id uuid primary key default gen_random_uuid(),                     -- = 확인 토큰(생성 10분 안에만 실행 시작)
  user_id uuid not null references auth.users(id) on delete cascade,
  connection_id uuid not null references connections(id) on delete cascade,   -- 출처 삭제(delete_gmail_source) → cascade
  action text not null check (action in ('trash', 'read')),
  msg_ids text[] not null check (cardinality(msg_ids) between 1 and 1000),   -- 대상 Gmail id, 순서 고정
  count int not null,
  method text check (method in ('batch', 'single')),
  status text not null default 'previewed' check (status in ('previewed', 'pending', 'running', 'done', 'partial', 'failed',
                                                             'undo_pending', 'undoing', 'undone', 'undo_partial', 'undo_failed')),
  cursor int not null default 0,                                     -- 다음에 처리할 msg_ids 위치(0부터)
  ok_ids text[] not null default '{}',
  failed_ids text[] not null default '{}',
  undo_cursor int not null default 0,                                -- 다음에 되돌릴 ok_ids 위치
  undo_failed_ids text[] not null default '{}',
  error_code text,
  quota_since timestamptz,                                           -- 쿼터 미루기 시작(30분 넘으면 fail_job). 성공 묶음이 지운다
  created_at timestamptz not null default now(),
  executed_at timestamptz,
  undone_at timestamptz
  -- 제목·발신자·본문·검색 칸은 두지 않는다(§12 통제 2)
);
create index mail_actions_user_time on mail_actions (user_id, created_at);
create index mail_actions_created on mail_actions (created_at);
alter table mail_actions enable row level security;

-- 사용자 Gmail units 분 카운터(§7 "속도"): 수집·미리보기는 기록만, 메일 정리 잡은 합계 5,400·자기 몫 4,000 안에서만 가져간다
create table gmail_units (
  user_id uuid not null references auth.users(id) on delete cascade,
  minute timestamptz not null,
  used int not null default 0,
  mail_used int not null default 0,
  primary key (user_id, minute)
);
alter table gmail_units enable row level security;

-- 우선순위(0005): mail-action 은 실시간 Gmail 잡과 같은 20. 나머지 분기는 0005 그대로
create or replace function jobs_set_priority() returns trigger language plpgsql as $$
begin
  new.priority := case
    when coalesce(new.payload->>'backfill', '') = 'true' then 40
    when new.kind = 'notify' then 10
    when new.kind in ('gmail-sync', 'gmail-fetch', 'gmail-watch', 'gmail-reauth', 'mail-action') then 20
    else 30 end;
  return new;
end $$;

create or replace function gmail_note_units(p_user uuid, p_units int) returns void language sql as $$
  insert into gmail_units (user_id, minute, used) values (p_user, date_trunc('minute', now()), greatest(p_units, 0))
  on conflict (user_id, minute) do update set used = gmail_units.used + excluded.used;
$$;
create or replace function gmail_take_units(p_user uuid, p_units int) returns boolean language plpgsql as $$
declare m timestamptz := date_trunc('minute', now()); v_used int; v_mail int;
begin
  insert into gmail_units (user_id, minute) values (p_user, m) on conflict (user_id, minute) do nothing;
  select used, mail_used into v_used, v_mail from gmail_units where user_id = p_user and minute = m for update;
  if v_used + p_units > 5400 or v_mail + p_units > 4000 then return false; end if;
  update gmail_units set used = used + p_units, mail_used = mail_used + p_units where user_id = p_user and minute = m;
  return true;
end $$;

-- 사용자 Gmail 연결 하나(최신). 권한 확인(scopes)·upgrade 계정 비교·잡 토큰 실패 사유에 쓴다
create or replace function mail_connection(p_user uuid)
returns table (connection_id uuid, account_ref text, status text, scopes text[]) language sql stable as $$
  select c.id, c.account_ref, c.status, c.scopes from connections c
  where c.user_id = p_user and c.provider = 'gmail' order by c.created_at desc limit 1;
$$;
create or replace function gmail_set_scopes(p_user uuid, p_connection uuid, p_scopes text[]) returns void language sql as $$
  update connections set scopes = p_scopes where id = p_connection and user_id = p_user;
$$;
-- 권한 업데이트(§7): 토큰만 바꾼다 — 연결 행·sync_states(커서·watch)·잡은 그대로. 옛 토큰은 vault 에서 덮어쓸 뿐 revoke 하지 않는다
create or replace function gmail_replace_token(p_user uuid, p_connection uuid, p_refresh_token text, p_scopes text[]) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_secret uuid;
begin
  perform 1 from public.connections where id = p_connection and user_id = p_user and provider = 'gmail' for update;
  if not found then return false; end if;
  select id into v_secret from vault.secrets where name = 'gmail_rt:' || p_connection;
  if v_secret is null then perform vault.create_secret(p_refresh_token, 'gmail_rt:' || p_connection);
  else perform vault.update_secret(v_secret, p_refresh_token); end if;
  update public.connections set scopes = p_scopes, expires_at = now() + interval '7 days', status = 'active' where id = p_connection;
  return true;
end $$;

create or replace function mail_same_set(a text[], b text[]) returns boolean language sql immutable as $$
  select coalesce((select array_agg(x order by x) from unnest(a) x), '{}') = coalesce((select array_agg(x order by x) from unnest(b) x), '{}');
$$;
-- 상태 응답 모양(§7 진행·결과, 계획 D4). 개수·상태·방식·코드만
create or replace function mail_action_counts(r mail_actions) returns jsonb language sql stable as $$
  select jsonb_build_object('id', r.id, 'status', r.status, 'total', r.count, 'done', cardinality(r.ok_ids),
    'failed', cardinality(r.failed_ids), 'undone', greatest(r.undo_cursor - cardinality(r.undo_failed_ids), 0),
    'undo_failed', cardinality(r.undo_failed_ids), 'code', r.error_code, 'method', r.method);
$$;

create or replace function mail_action_preview(p_user uuid, p_connection uuid, p_action text, p_ids text[]) returns uuid language sql as $$
  insert into mail_actions (user_id, connection_id, action, msg_ids, count)
  select p_user, c.id, p_action, p_ids, cardinality(p_ids) from connections c where c.id = p_connection and c.user_id = p_user
  returning id;
$$;

-- 실행 시작(§7 실행 — 지속 잡): 행 잠금 → 본인 행 → previewed 이고 10분 안이면 pending + 잡. 같은 토큰을 다시 부르면 새 잡 없이 지금 상태.
-- p_lease_prefix 는 테스트 전용('test:<run>:' — 운영 워커가 가져가지 않는다, 0003)
create or replace function mail_action_start(p_user uuid, p_id uuid, p_lease_prefix text default '') returns jsonb language plpgsql as $$
declare r mail_actions;
begin
  if p_lease_prefix <> '' and p_lease_prefix not like 'test:%' then raise exception 'bad prefix'; end if;
  select * into r from mail_actions where id = p_id and user_id = p_user for update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  if r.status <> 'previewed' then return jsonb_build_object('result', 'current') || mail_action_counts(r); end if;
  if r.created_at < now() - interval '10 minutes' then return jsonb_build_object('result', 'expired'); end if;
  update mail_actions set status = 'pending' where id = p_id returning * into r;
  perform enqueue_job(p_user, 'mail-action', p_lease_prefix || 'mail:' || p_user,
    jsonb_build_object('id', p_id, 'phase', 'execute', 'connection_id', r.connection_id));   -- connection_id: 출처 삭제가 잡도 지운다(0013)
  return jsonb_build_object('result', 'started') || mail_action_counts(r);
end $$;

-- 되돌리기 시작(§7): done·partial 이고 성공 id 가 있고 7일 안일 때만. 진행 중 busy, 되돌리기 상태면 지금 상태(한 번뿐)
create or replace function mail_action_undo(p_user uuid, p_id uuid, p_lease_prefix text default '') returns jsonb language plpgsql as $$
declare r mail_actions;
begin
  if p_lease_prefix <> '' and p_lease_prefix not like 'test:%' then raise exception 'bad prefix'; end if;
  select * into r from mail_actions where id = p_id and user_id = p_user for update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  if r.status in ('pending', 'running') then return jsonb_build_object('result', 'busy') || mail_action_counts(r); end if;
  if r.status in ('undo_pending', 'undoing', 'undone', 'undo_partial', 'undo_failed') then
    return jsonb_build_object('result', 'current') || mail_action_counts(r);
  end if;
  if r.status not in ('done', 'partial') or cardinality(r.ok_ids) = 0 then
    return jsonb_build_object('result', 'nothing_to_undo') || mail_action_counts(r);
  end if;
  if r.created_at < now() - interval '7 days' then return jsonb_build_object('result', 'expired'); end if;
  update mail_actions set status = 'undo_pending' where id = p_id returning * into r;
  perform enqueue_job(p_user, 'mail-action', p_lease_prefix || 'mail:' || p_user,
    jsonb_build_object('id', p_id, 'phase', 'undo', 'connection_id', r.connection_id));
  return jsonb_build_object('result', 'started') || mail_action_counts(r);
end $$;

create or replace function mail_action_status(p_user uuid, p_id uuid) returns jsonb language sql stable as $$
  select mail_action_counts(m) from mail_actions m where m.id = p_id and m.user_id = p_user;
$$;

-- 워커: pending→running(실행) / undo_pending→undoing(되돌리기). 끝난 행이면 상태만, 없으면 null
create or replace function mail_action_begin(p_user uuid, p_id uuid, p_phase text) returns jsonb language plpgsql as $$
declare r mail_actions;
begin
  if p_phase not in ('execute', 'undo') then raise exception 'bad phase'; end if;
  select * into r from mail_actions where id = p_id and user_id = p_user for update;
  if not found then return null; end if;
  if p_phase = 'execute' and r.status = 'pending' then update mail_actions set status = 'running' where id = p_id returning * into r;
  elsif p_phase = 'undo' and r.status = 'undo_pending' then update mail_actions set status = 'undoing' where id = p_id returning * into r;
  end if;
  if (p_phase = 'execute' and r.status <> 'running') or (p_phase = 'undo' and r.status <> 'undoing') then
    return jsonb_build_object('status', r.status);
  end if;
  return jsonb_build_object('status', r.status, 'action', r.action, 'method', r.method, 'connection_id', r.connection_id,
    'ids', to_jsonb(case when p_phase = 'execute' then r.msg_ids else r.ok_ids end),
    'cursor', case when p_phase = 'execute' then r.cursor else r.undo_cursor end);
end $$;

-- 실행 단계 방식 기록: null → batch|single, batch → single 만(되돌리기는 이 값을 따른다, 계획 D9)
create or replace function mail_action_set_method(p_user uuid, p_id uuid, p_method text) returns void language sql as $$
  update mail_actions set method = p_method
  where id = p_id and user_id = p_user and status = 'running' and p_method in ('batch', 'single')
    and (method is null or (method = 'batch' and p_method = 'single'));
$$;

-- 묶음 결과(§7 id별 결과, 계획 D8): 지금 커서가 p_from 이고, 붙일 id 가 정확히 그 구간이면 붙이고 커서를 민다. 아니면 false(늦게 깬 워커)
create or replace function mail_action_progress(p_user uuid, p_id uuid, p_phase text, p_from int, p_cursor int, p_ok text[], p_failed text[])
returns boolean language plpgsql as $$
declare v_ok text[] := coalesce(p_ok, '{}'); v_failed text[] := coalesce(p_failed, '{}');
begin
  if p_cursor <= p_from or cardinality(v_ok) + cardinality(v_failed) <> p_cursor - p_from then return false; end if;
  if p_phase = 'execute' then
    update mail_actions set ok_ids = ok_ids || v_ok, failed_ids = failed_ids || v_failed, cursor = p_cursor, quota_since = null
    where id = p_id and user_id = p_user and status = 'running' and cursor = p_from and p_cursor <= cardinality(msg_ids)
      and mail_same_set(v_ok || v_failed, msg_ids[p_from + 1:p_cursor]);
  elsif p_phase = 'undo' then
    update mail_actions set undo_failed_ids = undo_failed_ids || v_failed, undo_cursor = p_cursor, quota_since = null
    where id = p_id and user_id = p_user and status = 'undoing' and undo_cursor = p_from and p_cursor <= cardinality(ok_ids)
      and mail_same_set(v_ok || v_failed, ok_ids[p_from + 1:p_cursor]);
  else
    return false;
  end if;
  return found;
end $$;

-- 쿼터 미루기 시작 시각(30분 판정, 계획 D7). 처음이면 지금으로 두고 그 값을 돌려준다
create or replace function mail_action_quota(p_user uuid, p_id uuid) returns timestamptz language sql as $$
  update mail_actions set quota_since = coalesce(quota_since, now()) where id = p_id and user_id = p_user returning quota_since;
$$;

-- 마감(§7): 커서 뒤 남은 id 를 실패로 적고 종료 상태·감사(개수만). 이미 끝났으면 바꾸지 않는다(멱등)
create or replace function mail_action_finish(p_user uuid, p_id uuid, p_phase text, p_code text default null) returns jsonb language plpgsql as $$
declare r mail_actions; v_status text;
begin
  select * into r from mail_actions where id = p_id and user_id = p_user for update;
  if not found then return null; end if;
  if p_phase = 'execute' then
    if r.status not in ('pending', 'running') then return mail_action_counts(r); end if;
    r.failed_ids := r.failed_ids || coalesce(r.msg_ids[(r.cursor + 1):], '{}');
    v_status := case when cardinality(r.ok_ids) = 0 then 'failed' when cardinality(r.failed_ids) = 0 then 'done' else 'partial' end;
    update mail_actions set failed_ids = r.failed_ids, cursor = cardinality(r.msg_ids), status = v_status,
      error_code = coalesce(p_code, error_code), executed_at = now(), quota_since = null where id = p_id returning * into r;
    insert into audit_log (user_id, actor, action, target) values (p_user, 'mail-action',
      case when r.action = 'trash' then 'mail_trash' else 'mail_read' end,
      'mail_action:' || p_id || ' ok=' || cardinality(r.ok_ids) || ' failed=' || cardinality(r.failed_ids));
  elsif p_phase = 'undo' then
    if r.status not in ('undo_pending', 'undoing') then return mail_action_counts(r); end if;
    r.undo_failed_ids := r.undo_failed_ids || coalesce(r.ok_ids[(r.undo_cursor + 1):], '{}');
    v_status := case when cardinality(r.undo_failed_ids) = 0 then 'undone'
                     when cardinality(r.undo_failed_ids) >= cardinality(r.ok_ids) then 'undo_failed' else 'undo_partial' end;
    update mail_actions set undo_failed_ids = r.undo_failed_ids, undo_cursor = cardinality(r.ok_ids), status = v_status,
      error_code = coalesce(p_code, error_code), undone_at = now(), quota_since = null where id = p_id returning * into r;
    insert into audit_log (user_id, actor, action, target) values (p_user, 'mail-action', 'mail_undo',
      'mail_action:' || p_id || ' undone=' || (cardinality(r.ok_ids) - cardinality(r.undo_failed_ids)) || ' failed=' || cardinality(r.undo_failed_ids));
  else
    raise exception 'bad phase';
  end if;
  return mail_action_counts(r);
end $$;

-- 잡이 dead 만 되면(워커가 마감 전에 죽음) 남은 id 를 재조회 없이 실패로 마감한다(§7 결과 불명·재개)
create or replace function mail_action_job_dead() returns trigger language plpgsql as $$
begin
  begin
    perform mail_action_finish(new.user_id, (new.payload->>'id')::uuid, coalesce(new.payload->>'phase', 'execute'), 'job_dead');
  exception when others then
    raise warning 'mail_action_job_dead %', sqlstate;       -- 마감 실패가 fail_job(잡 상태 변경)을 막지 않게
  end;
  return new;
end $$;
create trigger jobs_mail_action_dead after update of status on jobs for each row
  when (new.kind = 'mail-action' and new.status = 'dead' and old.status is distinct from 'dead')
  execute function mail_action_job_dead();

-- 보관(§7·§8): 생성 7일 지난 행(진행 중은 끝난 뒤), 1시간 지난 units 행. p_user = 테스트 범위
create or replace function purge_mail_actions(p_user uuid default null) returns jsonb language plpgsql as $$
declare a int; u int;
begin
  delete from mail_actions where created_at < now() - interval '7 days'
    and status not in ('pending', 'running', 'undo_pending', 'undoing') and (p_user is null or user_id = p_user);
  get diagnostics a = row_count;
  delete from gmail_units where minute < now() - interval '1 hour' and (p_user is null or user_id = p_user);
  get diagnostics u = row_count;
  return jsonb_build_object('mail_actions', a, 'gmail_units', u);
end $$;

revoke execute on function gmail_note_units(uuid, int), gmail_take_units(uuid, int), mail_connection(uuid), gmail_set_scopes(uuid, uuid, text[]),
  gmail_replace_token(uuid, uuid, text, text[]), mail_same_set(text[], text[]), mail_action_counts(mail_actions),
  mail_action_preview(uuid, uuid, text, text[]), mail_action_start(uuid, uuid, text), mail_action_undo(uuid, uuid, text),
  mail_action_status(uuid, uuid), mail_action_begin(uuid, uuid, text), mail_action_set_method(uuid, uuid, text),
  mail_action_progress(uuid, uuid, text, int, int, text[], text[]), mail_action_quota(uuid, uuid), mail_action_finish(uuid, uuid, text, text),
  mail_action_job_dead(), purge_mail_actions(uuid) from public, anon, authenticated;

-- UTC 04:53(KST 13:53). 다른 cron(매분, 매시 7분, 6시간 0분, 03:17·03:41·04:23·04:33·04:43·19:27 UTC)과 겹치지 않는다
select cron.schedule('mail-actions-purge-daily', '53 4 * * *', $$ select purge_mail_actions(); $$);
```

- [ ] **Step 2: PGlite가 열리는지(U7)**

Run: `deno eval 'import { PGlite } from "npm:@electric-sql/pglite@0.3"; const db = new PGlite(); await db.exec("create role anon; create function f() returns uuid language plpgsql as \$\$ begin return gen_random_uuid(); end \$\$;"); console.log((await db.query("select f() is not null as ok")).rows)'`
Expected: `[ { ok: true } ]`. 오류면 U7 실패 — Step 3의 `_pglite-stubs.ts`·`mail-sql.test.ts`를 만들지 않고 Step 4(공유 사례·호스팅 테스트 파일)만 만든 뒤 Step 6에서 `deno check`만 하고, 커밋 메시지에 "PGlite unavailable — SQL verified only in M10"을 적는다.

- [ ] **Step 3: PGlite 스텁**

`supabase/tests/_pglite-stubs.ts`:

```ts
// PGlite 로컬 SQL 테스트용 최소 스키마(계획 M3, U7). 0030 이 닿는 것만 — 열·함수 정의는 원본(0001·0005·0007)과 같게 둔다.
// Supabase 확장(vault·pg_cron·auth)은 같은 이름·인자 모양의 표·함수로 흉내 낸다. 호스팅 DB 테스트(mail-actions-db)가 진짜를 본다
export const PGLITE_STUBS = `
create role anon; create role authenticated; create role service_role;
create schema auth;
create table auth.users (id uuid primary key);
create schema vault;
create table vault.secrets (id uuid primary key default gen_random_uuid(), name text unique not null, secret text not null);
create view vault.decrypted_secrets as select id, name, secret as decrypted_secret from vault.secrets;
create function vault.create_secret(p_secret text, p_name text) returns uuid language sql as
  $$ insert into vault.secrets (name, secret) values (p_name, p_secret) returning id $$;
create function vault.update_secret(p_id uuid, p_secret text) returns void language sql as
  $$ update vault.secrets set secret = p_secret where id = p_id $$;
create schema cron;
create table cron.job (jobid bigserial primary key, jobname text unique, schedule text, command text);
create function cron.schedule(p_name text, p_schedule text, p_command text) returns bigint language sql as
  $$ insert into cron.job (jobname, schedule, command) values (p_name, p_schedule, p_command)
     on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning jobid $$;

create table connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  provider text not null check (provider in ('gmail')),
  account_ref text not null,
  status text not null default 'active' check (status in ('active','reauth_required','disconnected')),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  unique (provider, account_ref)
);
create table sync_states (
  connection_id uuid primary key references connections on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  cursor text not null,
  last_success_at timestamptz not null default now(),
  watch_expires_at timestamptz
);
create table jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  user_id uuid references auth.users on delete cascade,
  payload jsonb not null default '{}',
  lease_key text,
  leased_until timestamptz,
  attempts int not null default 0,
  status text not null default 'queued' check (status in ('queued','running','done','dead')),
  checkpoint text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  priority smallint not null default 30,
  claimed_at timestamptz,
  not_before timestamptz
);
create table audit_log (
  id bigint generated always as identity primary key,
  user_id uuid not null, actor text not null, action text not null, target text, at timestamptz not null default now()
);
create function enqueue_job(p_user uuid, p_kind text, p_lease_key text, p_payload jsonb) returns uuid language sql as $$
  insert into jobs (kind, user_id, lease_key, payload) values (p_kind, p_user, p_lease_key, p_payload) returning id;
$$;
create function fail_job(p_id uuid, p_error text) returns void language sql as $$
  update jobs set status = case when attempts >= 5 then 'dead' else 'queued' end,
                  not_before = case when attempts >= 5 then not_before else now() + make_interval(secs => attempts * 60) end,
                  last_error = p_error, leased_until = null, updated_at = now() where id = p_id;
$$;
create function jobs_set_priority() returns trigger language plpgsql as $$
begin
  new.priority := case
    when coalesce(new.payload->>'backfill', '') = 'true' then 40
    when new.kind = 'notify' then 10
    when new.kind in ('gmail-sync', 'gmail-fetch', 'gmail-watch', 'gmail-reauth') then 20
    else 30 end;
  return new;
end $$;
create trigger jobs_priority before insert on jobs for each row execute function jobs_set_priority();
create function gmail_save_connection(p_user uuid, p_account_ref text, p_refresh_token text, p_history_id text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_secret uuid;
begin
  insert into public.connections as c (user_id, provider, account_ref, status) values (p_user, 'gmail', p_account_ref, 'active')
  on conflict (provider, account_ref) do update set status = 'active' where c.user_id = excluded.user_id
  returning id into v_id;
  if v_id is null then raise exception 'account_ref linked to another user' using errcode = 'P0001'; end if;
  if p_refresh_token is not null then
    select id into v_secret from vault.secrets where name = 'gmail_rt:' || v_id;
    if v_secret is null then perform vault.create_secret(p_refresh_token, 'gmail_rt:' || v_id);
    else perform vault.update_secret(v_secret, p_refresh_token); end if;
    update public.connections set expires_at = now() + interval '7 days' where id = v_id;
  end if;
  insert into public.sync_states (connection_id, user_id, cursor) values (v_id, p_user, p_history_id)
  on conflict (connection_id) do update set cursor = excluded.cursor, last_success_at = now();
  return v_id;
end $$;
create function gmail_get_refresh_token(p_user uuid, p_connection uuid) returns text
language sql stable security definer set search_path = '' as $$
  select s.decrypted_secret from public.connections c join vault.decrypted_secrets s on s.name = 'gmail_rt:' || c.id
  where c.id = p_connection and c.user_id = p_user and c.status = 'active';
$$;
`;
```

- [ ] **Step 4: 공유 사례**

`supabase/tests/_mail-sql.ts`:

```ts
import { assert, assertEquals } from "jsr:@std/assert";

// 0030 SQL 사례(계획 M3): PGlite(로컬, mail-sql.test.ts)와 호스팅 트랜잭션(mail-actions-db.test.ts, M10)이 같은 사례를 돈다.
// 사례마다 한 트랜잭션 안에서 시작해 롤백으로 끝난다(실행자 쪽). 값은 합성 id·주소만
// deno-lint-ignore no-explicit-any
export type Row = Record<string, any>;
export type Q = (sql: string, params?: unknown[]) => Promise<Row[]>;
export type Ctx = { q: Q; user: string; conn: string; prefix: string; tag: string };
export const MIGRATION_0030 = new URL("../migrations-pending/0030_mail_cleanup.sql", import.meta.url);   // M10 Step 3 이 ../migrations/ 로 바꾼다

export const arr = (xs: string[]) => "{" + xs.map((x) => `"${x}"`).join(",") + "}";
const one = async (q: Q, sql: string, p: unknown[] = []) => (await q(sql, p))[0];
export async function setupCtx(q: Q, user: string, tag: string): Promise<Ctx> {
  const conn = (await one(q, "insert into connections (user_id, provider, account_ref, status, scopes) values ($1::uuid, 'gmail', $2, 'active', $3::text[]) returning id",
    [user, `${tag}-${crypto.randomUUID().slice(0, 8)}@example.com`, arr(["https://www.googleapis.com/auth/gmail.modify"])])).id as string;
  return { q, user, conn, prefix: `${tag}:`, tag };
}
const ids3 = (c: Ctx) => ["a", "b", "c"].map((x) => `${c.tag}-${x}`);
const preview = async (c: Ctx, ids = ids3(c), action = "trash") =>
  (await one(c.q, "select mail_action_preview($1::uuid, $2::uuid, $3, $4::text[]) as id", [c.user, c.conn, action, arr(ids)])).id as string;
const call = async (c: Ctx, fn: string, args: string, p: unknown[]) => (await one(c.q, `select ${fn}(${args}) as r`, p)).r;
const start = (c: Ctx, id: string) => call(c, "mail_action_start", "$1::uuid, $2::uuid, $3", [c.user, id, c.prefix]);
const undo = (c: Ctx, id: string) => call(c, "mail_action_undo", "$1::uuid, $2::uuid, $3", [c.user, id, c.prefix]);
const begin = (c: Ctx, id: string, phase: string) => call(c, "mail_action_begin", "$1::uuid, $2::uuid, $3", [c.user, id, phase]);
const progress = (c: Ctx, id: string, phase: string, from: number, to: number, ok: string[], failed: string[]) =>
  call(c, "mail_action_progress", "$1::uuid, $2::uuid, $3, $4::int, $5::int, $6::text[], $7::text[]", [c.user, id, phase, from, to, arr(ok), arr(failed)]);
const finish = (c: Ctx, id: string, phase: string, code: string | null = null) =>
  call(c, "mail_action_finish", "$1::uuid, $2::uuid, $3, $4", [c.user, id, phase, code]);
const row = (c: Ctx, id: string) => one(c.q, `select status, cursor, ok_ids, failed_ids, undo_cursor, undo_failed_ids, error_code, method,
  quota_since, executed_at, undone_at from mail_actions where id = $1::uuid`, [id]);
const jobs = (c: Ctx, id: string) => c.q("select id, kind, lease_key, priority, payload, status from jobs where user_id = $1::uuid and payload->>'id' = $2 order by created_at", [c.user, id]);
const audits = (c: Ctx, id: string) => c.q("select action, target from audit_log where user_id = $1::uuid and target like $2 order by id", [c.user, `mail_action:${id}%`]);
const done = async (c: Ctx, ok: string[], failed: string[] = []) => {     // 실행을 끝낸 행(되돌리기 사례용)
  const id = await preview(c, [...ok, ...failed]);
  await start(c, id); await begin(c, id, "execute");
  assertEquals(await progress(c, id, "execute", 0, ok.length + failed.length, ok, failed), true);
  await finish(c, id, "execute");
  return id;
};

export const CASES: { name: string; run(c: Ctx): Promise<void> }[] = [
  { name: "start: previewed → pending + one mail-action job (priority 20, lease <prefix>mail:<user>, payload id/phase/connection_id); again → current, no second job", run: async (c) => {
    const id = await preview(c);
    const r1 = await start(c, id);
    assertEquals([r1.result, r1.status, r1.total, r1.done, r1.failed, r1.method], ["started", "pending", 3, 0, 0, null]);
    const r2 = await start(c, id);
    assertEquals([r2.result, r2.status], ["current", "pending"]);
    const js = await jobs(c, id);
    assertEquals(js.length, 1);
    assertEquals([js[0].kind, js[0].lease_key, js[0].priority, js[0].payload],
      ["mail-action", `${c.prefix}mail:${c.user}`, 20, { id, phase: "execute", connection_id: c.conn }]);
  } },
  { name: "start: token older than 10 minutes → expired (stays previewed, no job); unknown id or another user → not_found", run: async (c) => {
    const id = await preview(c);
    await c.q("update mail_actions set created_at = now() - interval '11 minutes' where id = $1::uuid", [id]);
    assertEquals((await start(c, id)).result, "expired");
    assertEquals((await row(c, id)).status, "previewed");
    assertEquals((await jobs(c, id)).length, 0);
    assertEquals((await call(c, "mail_action_start", "$1::uuid, $2::uuid, $3", [crypto.randomUUID(), id, c.prefix])).result, "not_found");
    assertEquals((await start(c, crypto.randomUUID())).result, "not_found");
  } },
  { name: "begin → running with ids and cursor; progress per batch (compare-and-set); finish → partial, rest failed, audit once; finish again changes nothing", run: async (c) => {
    const [a, b, d] = ids3(c), id = await preview(c);
    await start(c, id);
    const g = await begin(c, id, "execute");
    assertEquals([g.status, g.action, g.ids, g.cursor, g.connection_id], ["running", "trash", [a, b, d], 0, c.conn]);
    assertEquals(await progress(c, id, "execute", 0, 2, [a], [b]), true);
    assertEquals(await progress(c, id, "execute", 0, 2, [a], [b]), false);           // 늦게 깬 워커: 같은 묶음 두 번 못 적음
    const f = await finish(c, id, "execute");
    assertEquals([f.status, f.done, f.failed], ["partial", 1, 2]);
    const r = await row(c, id);
    assertEquals([r.ok_ids, r.failed_ids, r.cursor], [[a], [b, d], 3]);
    assert(r.executed_at);
    assertEquals((await finish(c, id, "execute", "x")).status, "partial");
    assertEquals((await row(c, id)).error_code, null);
    const au = await audits(c, id);
    assertEquals(au.map((x) => [x.action, x.target]), [["mail_trash", `mail_action:${id} ok=1 failed=2`]]);
    assertEquals((await begin(c, id, "execute")).status, "partial");                 // 끝난 행: 상태만
  } },
  { name: "progress guards: count mismatch, ids outside the slice, past the end, backwards → false and nothing changes", run: async (c) => {
    const [a, b, d] = ids3(c), id = await preview(c);
    await start(c, id); await begin(c, id, "execute");
    assertEquals(await progress(c, id, "execute", 0, 2, [a], []), false);
    assertEquals(await progress(c, id, "execute", 0, 2, [a, d], []), false);
    assertEquals(await progress(c, id, "execute", 0, 4, [a, b, d, "x"], []), false);
    assertEquals(await progress(c, id, "execute", 0, 0, [], []), false);
    assertEquals(await progress(c, id, "undo", 0, 1, [a], []), false);              // 실행 중 행에 되돌리기 기록 없음
    const r = await row(c, id);
    assertEquals([r.cursor, r.ok_ids, r.failed_ids], [0, [], []]);
    assertEquals(await progress(c, id, "execute", 0, 3, [d, a], [b]), true);         // 구간 안의 순서는 묻지 않는다
  } },
  { name: "finish with a code marks everything after the cursor failed; zero ok → failed; pending (never begun) also closes", run: async (c) => {
    const [a] = ids3(c), id = await preview(c);
    await start(c, id); await begin(c, id, "execute");
    await progress(c, id, "execute", 0, 1, [a], []);
    const f = await finish(c, id, "execute", "scope_missing");
    assertEquals([f.status, f.done, f.failed, f.code], ["partial", 1, 2, "scope_missing"]);
    const id2 = await preview(c);
    await start(c, id2);
    const f2 = await finish(c, id2, "execute", "reauth_required");
    assertEquals([f2.status, f2.done, f2.failed, f2.code], ["failed", 0, 3, "reauth_required"]);
  } },
  { name: "undo rules: previewed/failed → nothing_to_undo, pending → busy, done → started (undo job), again → current, 8 days → expired, unknown → not_found", run: async (c) => {
    const [a, b] = ids3(c);
    const p = await preview(c);
    assertEquals((await undo(c, p)).result, "nothing_to_undo");
    await start(c, p);
    assertEquals((await undo(c, p)).result, "busy");
    await finish(c, p, "execute", "no_connection");                                   // 성공 0 → failed
    assertEquals((await undo(c, p)).result, "nothing_to_undo");
    const d = await done(c, [a, b]);
    const u1 = await undo(c, d);
    assertEquals([u1.result, u1.status, u1.done], ["started", "undo_pending", 2]);
    assertEquals((await jobs(c, d)).map((j) => j.payload.phase), ["execute", "undo"]);
    assertEquals((await undo(c, d)).result, "current");
    const old = await done(c, [a]);
    await c.q("update mail_actions set created_at = now() - interval '8 days' where id = $1::uuid", [old]);
    assertEquals((await undo(c, old)).result, "expired");
    assertEquals((await undo(c, crypto.randomUUID())).result, "not_found");
  } },
  { name: "undo uses ok_ids only: begin gives ok ids; progress/finish → undo_partial with undone/undo_failed counts; audit mail_undo", run: async (c) => {
    const [a, b, d] = ids3(c);
    const id = await done(c, [a, b], [d]);
    await undo(c, id);
    const g = await begin(c, id, "undo");
    assertEquals([g.status, g.ids, g.cursor], ["undoing", [a, b], 0]);
    assertEquals(await progress(c, id, "undo", 0, 2, [a], [b]), true);
    const f = await finish(c, id, "undo");
    assertEquals([f.status, f.undone, f.undo_failed, f.done, f.failed], ["undo_partial", 1, 1, 2, 1]);
    assert((await row(c, id)).undone_at);
    assertEquals((await audits(c, id)).map((x) => x.action), ["mail_trash", "mail_undo"]);
    assertEquals((await undo(c, id)).result, "current");                             // 되돌리기는 한 번뿐
  } },
  { name: "dead trigger: a mail-action job that goes dead closes the row (rest failed, job_dead); other kinds are untouched", run: async (c) => {
    const [a] = ids3(c), id = await preview(c);
    await start(c, id); await begin(c, id, "execute");
    await progress(c, id, "execute", 0, 1, [a], []);
    const j = (await jobs(c, id))[0];
    await c.q("update jobs set status = 'dead' where id = $1::uuid", [j.id]);
    const r = await row(c, id);
    assertEquals([r.status, r.error_code, r.failed_ids.length, r.ok_ids], ["partial", "job_dead", 2, [a]]);
    const other = (await one(c.q, "select enqueue_job($1::uuid, 'process', $2, $3::jsonb) as id", [c.user, c.prefix + "p", JSON.stringify({ id })])).id;
    await c.q("update jobs set status = 'dead' where id = $1::uuid", [other]);
    assertEquals((await row(c, id)).status, "partial");
  } },
  { name: "units: collection notes count toward 5,400; mail share stops at 4,000", run: async (c) => {
    const take = (n: number) => call(c, "gmail_take_units", "$1::uuid, $2::int", [c.user, n]);
    await c.q("select gmail_note_units($1::uuid, 1300)", [c.user]);
    assertEquals(await take(4000), true);
    assertEquals(await take(1), false);                                               // 자기 몫 4,000
    await c.q("delete from gmail_units where user_id = $1::uuid", [c.user]);
    await c.q("select gmail_note_units($1::uuid, 5000)", [c.user]);
    assertEquals(await take(401), false);                                             // 합계 5,400
    assertEquals(await take(400), true);
    const u = await one(c.q, "select used, mail_used from gmail_units where user_id = $1::uuid", [c.user]);
    assertEquals([u.used, u.mail_used], [5400, 400]);
  } },
  { name: "replace token: vault, scopes, expires_at, status change; cursor untouched; another user → false and nothing changes", run: async (c) => {
    const conn = (await one(c.q, "select gmail_save_connection($1::uuid, $2, 'rt-old', '700') as id", [c.user, `${c.tag}-rt@example.com`])).id as string;
    await c.q("update connections set status = 'reauth_required', expires_at = now() + interval '1 day' where id = $1::uuid", [conn]);
    assertEquals(await call(c, "gmail_replace_token", "$1::uuid, $2::uuid, 'rt-x', $3::text[]", [crypto.randomUUID(), conn, arr(["s"])]), false);
    assertEquals((await one(c.q, "select status from connections where id = $1::uuid", [conn])).status, "reauth_required");
    assertEquals(await call(c, "gmail_replace_token", "$1::uuid, $2::uuid, 'rt-new', $3::text[]", [c.user, conn, arr(["a", "b"])]), true);
    assertEquals(await call(c, "gmail_get_refresh_token", "$1::uuid, $2::uuid", [c.user, conn]), "rt-new");
    const k = await one(c.q, "select status, scopes, expires_at > now() + interval '6 days' as week from connections where id = $1::uuid", [conn]);
    assertEquals([k.status, k.scopes, k.week], ["active", ["a", "b"], true]);
    assertEquals((await one(c.q, "select cursor from sync_states where connection_id = $1::uuid", [conn])).cursor, "700");
  } },
  { name: "mail_connection returns the newest Gmail connection with account and scopes; gmail_set_scopes writes them", run: async (c) => {
    await c.q("select gmail_set_scopes($1::uuid, $2::uuid, $3::text[])", [c.user, c.conn, arr(["r", "m"])]);
    const rows = await c.q("select * from mail_connection($1::uuid)", [c.user]);
    assertEquals(rows.length, 1);
    assertEquals([rows[0].connection_id, rows[0].status, rows[0].scopes], [c.conn, "active", ["r", "m"]]);
    assert(String(rows[0].account_ref).startsWith(c.tag));
    assertEquals((await c.q("select * from mail_connection($1::uuid)", [crypto.randomUUID()])).length, 0);
  } },
  { name: "purge: 7-day rows except in-flight, 1-hour unit rows; cron mail-actions-purge-daily at 53 4", run: async (c) => {
    const old = await preview(c), running = await preview(c), fresh = await preview(c);
    await c.q("update mail_actions set created_at = now() - interval '8 days' where id = any($1::uuid[])", [`{${old},${running}}`]);
    await c.q("update mail_actions set status = 'running' where id = $1::uuid", [running]);
    await c.q("insert into gmail_units (user_id, minute, used) values ($1::uuid, date_trunc('minute', now()) - interval '2 hours', 5), ($1::uuid, date_trunc('minute', now()) - interval '10 minutes', 5)", [c.user]);
    const p = await call(c, "purge_mail_actions", "$1::uuid", [c.user]);
    assertEquals(p, { mail_actions: 1, gmail_units: 1 });
    const left = (await c.q("select id from mail_actions where user_id = $1::uuid", [c.user])).map((r) => r.id).sort();
    assertEquals(left, [running, fresh].sort());
    assertEquals((await one(c.q, "select schedule from cron.job where jobname = 'mail-actions-purge-daily'")).schedule, "53 4 * * *");
  } },
  { name: "cascade and columns: deleting the connection deletes its rows; mail_actions has no title/sender/body/query column", run: async (c) => {
    const id = await preview(c);
    await c.q("delete from connections where id = $1::uuid", [c.conn]);
    assertEquals((await c.q("select 1 from mail_actions where id = $1::uuid", [id])).length, 0);
    const cols = (await c.q("select column_name from information_schema.columns where table_schema = 'public' and table_name = 'mail_actions' order by ordinal_position")).map((r) => r.column_name);
    assertEquals(cols, ["id", "user_id", "connection_id", "action", "msg_ids", "count", "method", "status", "cursor", "ok_ids", "failed_ids",
      "undo_cursor", "undo_failed_ids", "error_code", "quota_since", "created_at", "executed_at", "undone_at"]);
  } },
  { name: "priority: mail-action 20; backfill 40, gmail-fetch 20, process 30 unchanged", run: async (c) => {
    const pr = async (kind: string, payload: Record<string, unknown>) => {          // 넣기와 읽기를 나눈다 — WHERE 안의 volatile 호출은 행마다 돈다
      const id = (await one(c.q, "select enqueue_job($1::uuid, $2, $3, $4::jsonb) as id", [c.user, kind, c.prefix + kind, JSON.stringify(payload)])).id;
      return (await one(c.q, "select priority from jobs where id = $1::uuid", [id])).priority;
    };
    assertEquals([await pr("mail-action", {}), await pr("gmail-fetch", { backfill: true }), await pr("gmail-fetch", {}), await pr("process", {})], [20, 40, 20, 30]);
  } },
  { name: "set_method: null → batch → single only while running; status json carries method", run: async (c) => {
    const id = await preview(c);
    await c.q("select mail_action_set_method($1::uuid, $2::uuid, 'single')", [c.user, id]);   // previewed: 안 바뀜
    assertEquals((await row(c, id)).method, null);
    await start(c, id); await begin(c, id, "execute");
    await c.q("select mail_action_set_method($1::uuid, $2::uuid, 'batch')", [c.user, id]);
    await c.q("select mail_action_set_method($1::uuid, $2::uuid, 'single')", [c.user, id]);
    await c.q("select mail_action_set_method($1::uuid, $2::uuid, 'batch')", [c.user, id]);    // single → batch 없음
    assertEquals((await row(c, id)).method, "single");
    assertEquals((await call(c, "mail_action_status", "$1::uuid, $2::uuid", [c.user, id])).method, "single");
    assertEquals(await call(c, "mail_action_status", "$1::uuid, $2::uuid", [crypto.randomUUID(), id]), null);
  } },
  { name: "quota: first call sets quota_since, later calls keep it; a progressed batch clears it", run: async (c) => {
    const [a] = ids3(c), id = await preview(c);
    await start(c, id); await begin(c, id, "execute");
    const q1 = await call(c, "mail_action_quota", "$1::uuid, $2::uuid", [c.user, id]);
    const q2 = await call(c, "mail_action_quota", "$1::uuid, $2::uuid", [c.user, id]);
    assertEquals(new Date(q1).getTime(), new Date(q2).getTime());
    await progress(c, id, "execute", 0, 1, [a], []);
    assertEquals((await row(c, id)).quota_since, null);
  } },
];
```

`supabase/tests/mail-sql.test.ts`(PGlite):

```ts
import { PGlite } from "npm:@electric-sql/pglite@0.3";
import { CASES, MIGRATION_0030, type Q, setupCtx } from "./_mail-sql.ts";
import { PGLITE_STUBS } from "./_pglite-stubs.ts";

// 0030 을 로컬 PGlite 에 적용하고 공유 사례를 돈다(계획 M3 — ③c2 전에도 돌릴 수 있다. 호스팅 DB 는 건드리지 않는다)
const db = new PGlite();
await db.exec(PGLITE_STUBS);
await db.exec(await Deno.readTextFile(MIGRATION_0030));
const q: Q = async (sql, params = []) => (await db.query(sql, params)).rows as Record<string, unknown>[];

for (const c of CASES) {
  Deno.test({ name: "pglite: " + c.name, sanitizeResources: false, sanitizeOps: false, fn: async () => {
    await db.exec("begin");
    try {
      const user = crypto.randomUUID();
      await q("insert into auth.users (id) values ($1::uuid)", [user]);
      await c.run(await setupCtx(q, user, "test:" + crypto.randomUUID().slice(0, 8)));
    } finally {
      await db.exec("rollback");
    }
  } });
}
```

`supabase/tests/mail-actions-db.test.ts`(호스팅 — M10에서만):

```ts
import postgres from "npm:postgres@3";
import { CASES, MIGRATION_0030, type Q, setupCtx } from "./_mail-sql.ts";
import { RUN, testUser } from "./_testenv.ts";

// 호스팅 DB(계획 M3·M10). unsub-gap-db 와 같은 방식: 0030 이 아직 없으면 한 트랜잭션 안에서만 적용하고 사례를 돈 뒤 **롤백**.
// 테스트 사용자 21 전용(D18). 행은 모두 같은 트랜잭션에서 만들어 롤백으로 사라진다(운영 워커는 커밋 전 행을 보지 못한다).
// ③c2 전에는 실행하지 않는다 — 0030 적용이 jobs·connections 에 잠금을 건다(D1)
const MIGRATION = await Deno.readTextFile(MIGRATION_0030);
function connect() {
  const base = Deno.readTextFileSync(new URL("../.temp/pooler-url", import.meta.url)).trim();
  const url = new URL(base);
  return postgres({ host: url.hostname, port: Number(url.port || 5432), database: url.pathname.slice(1) || "postgres",
    username: decodeURIComponent(url.username), password: Deno.env.get("SUPABASE_DB_PASSWORD")!, ssl: "require", prepare: false, onnotice: () => {} });
}
class Rollback extends Error {}

for (const c of CASES) {
  Deno.test("hosted: " + c.name, async () => {
    const user = (await testUser(21)).id;
    const sql = connect();
    try {
      await sql.begin(async (tx) => {
        const [{ deployed }] = await tx.unsafe("select to_regprocedure('public.mail_action_start(uuid, uuid, text)') is not null as deployed");
        if (!deployed) await tx.unsafe(MIGRATION);
        const q: Q = async (s, p = []) => await tx.unsafe(s, p as never[]) as unknown as Record<string, unknown>[];
        await c.run(await setupCtx(q, user, `${RUN}:m${crypto.randomUUID().slice(0, 4)}`));
        throw new Rollback();
      });
    } catch (e) {
      if (!(e instanceof Rollback)) throw e;
    } finally {
      await sql.end();
    }
  });
}
```

- [ ] **Step 5: PGlite 사례 실행(실패 → 고침)**

먼저 마이그레이션 없이 돌려 사례가 실제로 0030을 요구하는지 본다:

Run: `mv supabase/migrations-pending/0030_mail_cleanup.sql /tmp/0030.sql && deno test --allow-read --allow-env --allow-write=/tmp supabase/tests/mail-sql.test.ts; mv /tmp/0030.sql supabase/migrations-pending/0030_mail_cleanup.sql`
Expected: FAIL(`NotFound … 0030_mail_cleanup.sql`) — 파일이 없으면 시작조차 못 한다.

Run: `deno test --allow-read --allow-env --allow-write=/tmp supabase/tests/mail-sql.test.ts`
Expected: `pglite:` 사례 16개 통과. 실패하면 SQL을 고친다(사례 기대를 SQL에 맞춰 바꾸지 않는다 — 기대는 스펙 문장이다). PGlite에만 있는 차이(예: `create role` 중복)는 스텁에서 고친다.

- [ ] **Step 6: 타입 확인·호스팅 파일이 지금 돌지 않는지**

Run: `deno check supabase/tests/mail-sql.test.ts supabase/tests/mail-actions-db.test.ts supabase/tests/_mail-sql.ts && git status --short supabase/migrations`
Expected: 무오류. `supabase/migrations/`에 변화 없음(0030은 `migrations-pending/`에만). **`mail-actions-db.test.ts`는 실행하지 않는다**(M10).

- [ ] **Step 7: 커밋**

```bash
git add supabase/migrations-pending/0030_mail_cleanup.sql supabase/tests/_mail-sql.ts supabase/tests/_pglite-stubs.ts supabase/tests/mail-sql.test.ts supabase/tests/mail-actions-db.test.ts
git commit -m "feat(db): 0030 mail cleanup (pending, not applied — db push after ③c2 and U6b's 0029) — mail_actions as the confirmation token with per-id results and compare-and-set progress, start/undo/status/begin/finish with idempotent replays, dead-job trigger closes the row, gmail_units minute counter (collection notes, mail takes within 5,400/4,000), connections.scopes, gmail_replace_token keeps the connection and cursor, mail-action priority 20, 7-day purge cron; SQL cases run on local PGlite now and on the hosted DB in a rolled-back transaction at deploy time

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task M4: 워커 `mail-action` 잡 + 수집 경로 units 기록

**Files:**
- Create: `supabase/functions/worker/mail-action.ts`, `supabase/functions/worker/mail-action-deps.ts`
- Modify: `supabase/functions/worker/index.ts:1-21`(import), `:52`(핸들러 한 줄)
- Modify: `supabase/functions/_shared/gmail-jobs.ts:13-29`(deps), `:92-103`(토큰 함수 공개), `:105-121`(sync), `:123-176`(fetch), `:205-230`(unsub-fetch), 새 함수
- Test: `supabase/tests/mail-jobs.test.ts`, `supabase/tests/units.test.ts`

**Interfaces:**
- Consumes: M2 `GmailMailApi`·`classifyGmailError`·`GmailHttpError`·`gmailMailApi`·`refreshAccessToken`, M3 RPC 이름(`mail_action_begin`·`mail_action_set_method`·`mail_action_progress`·`mail_action_quota`·`mail_action_finish`·`gmail_take_units`·`gmail_note_units`·`mail_connection`), `Deferred`(`_shared/budget.ts`), `Job`.
- Produces: `mailActionJob(d, job)`·`MailJobDeps`·`opFor`·상수(M10 배포), `gmailAccessToken(sb, refresh, user, conn)`·`noteGmailUnits(sb, user, units, budgetMs?)`(M5가 쓴다), `meteredApi`·`unitsNoter`·`GmailJobDeps.noteUnits?`.

- [ ] **Step 1: 실패하는 테스트 — 잡**

`supabase/tests/mail-jobs.test.ts`:

```ts
import { assert, assertEquals, assertRejects } from "jsr:@std/assert";
import { Deferred } from "../functions/_shared/budget.ts";
import { GmailHttpError, type GmailMailApi } from "../functions/_shared/gmail.ts";
import type { Job } from "../functions/_shared/job.ts";
import { type Action, MAIL_JOB_BUDGET_MS, mailActionJob, type MailJobDeps, type Method, type Phase, QUOTA_STUCK_MS } from "../functions/worker/mail-action.ts";

// 메일 정리 잡(스펙 §7 실행·되돌리기): 행·DB 는 메모리 흉내(progress 는 커서 비교 — 0030 과 같은 규칙), Gmail 은 가짜
const USER = "00000000-0000-0000-0000-0000000000aa", T0 = 1_790_000_000_000;
const ids = (n: number) => Array.from({ length: n }, (_, i) => `m${i + 1}`);
const job = (phase: Phase = "execute", attempts = 1): Job =>
  ({ id: "job-1", kind: "mail-action", user_id: USER, payload: { id: "row-1", phase, connection_id: "conn-1" }, attempts, checkpoint: null });
const E = (s: number, ...r: string[]) => new GmailHttpError("x", s, r);

type Opts = { action?: Action; phase?: Phase; ids?: string[]; method?: Method | null; status?: string; api?: Partial<GmailMailApi>;
  token?: string | { code: "reauth_required" | "no_connection" }; take?: (u: number) => boolean; clock?: number[]; failProgressOnce?: boolean; quotaSince?: string };
function harness(o: Opts = {}) {
  const phase = o.phase ?? "execute", list = o.ids ?? ids(3);
  const st = { status: o.status ?? (phase === "execute" ? "running" : "undoing"), cursor: 0, ok: [] as string[], failed: [] as string[],
    method: (o.method ?? null) as Method | null, finished: undefined as string | null | undefined, quotaSince: (o.quotaSince ?? null) as string | null,
    taken: [] as number[], gmail: [] as string[], logs: [] as Record<string, unknown>[] };
  let failOnce = o.failProgressOnce ?? false, tick = 0;
  const now = () => (o.clock ? o.clock[Math.min(tick++, o.clock.length - 1)] : T0);
  const api: GmailMailApi = {
    list: () => Promise.resolve({}), headers: (id) => Promise.resolve({ id, internalDate: "0" }),
    labels: (id) => { st.gmail.push("labels:" + id); return Promise.resolve({ id, labelIds: [] }); },
    batchModify: (b, a, r) => { st.gmail.push(`batch:${b.length}:+${a.join()}:-${r.join()}`); return Promise.resolve(); },
    trash: (id) => { st.gmail.push("trash:" + id); return Promise.resolve(); },
    untrash: (id) => { st.gmail.push("untrash:" + id); return Promise.resolve(); },
    modify: (id, a, r) => { st.gmail.push(`modify:${id}:+${a.join()}:-${r.join()}`); return Promise.resolve(); },
    ...o.api,
  };
  const d: MailJobDeps = {
    begin: () => Promise.resolve(st.status === "gone" ? null : (st.status === "running" || st.status === "undoing")
      ? { status: st.status, action: o.action ?? "trash", method: st.method, connection_id: "conn-1", ids: list, cursor: st.cursor } : { status: st.status }),
    token: () => Promise.resolve(o.token ?? "access-1"),
    api: () => api,
    take: (u) => { st.taken.push(u); return Promise.resolve((o.take ?? (() => true))(u)); },
    setMethod: (_u, _i, m) => { if (st.method === null || (st.method === "batch" && m === "single")) st.method = m; return Promise.resolve(); },
    progress: (_u, _i, _p, from, to, ok, failed) => {
      if (failOnce) { failOnce = false; return Promise.reject(new Error("connection reset")); }   // Gmail 성공 뒤·기록 전 죽음
      if (from !== st.cursor || ok.length + failed.length !== to - from) return Promise.resolve(false);
      st.cursor = to; st.ok.push(...ok); st.failed.push(...failed); st.quotaSince = null;
      return Promise.resolve(true);
    },
    quota: () => Promise.resolve(st.quotaSince ??= new Date(now()).toISOString()),
    finish: (_u, _i, _p, code) => { st.failed.push(...list.slice(st.cursor)); st.cursor = list.length; st.finished = code; return Promise.resolve(); },
    now, log: (x) => { st.logs.push(x); },
  };
  return { d, st };
}

Deno.test("execute trash: one batchModify(+TRASH) for all ids, 50 units, method batch, clean finish", async () => {
  const { d, st } = harness();
  assertEquals(await mailActionJob(d, job()), "done");
  assertEquals([st.gmail, st.taken, st.method, st.ok, st.failed, st.finished], [["batch:3:+TRASH:-"], [50], "batch", ids(3), [], null]);
});

Deno.test("batch TRASH rejected with 400 → per-message trash in the same job (20 units each), method single", async () => {
  const { d, st } = harness({ api: { batchModify: () => Promise.reject(E(400, "invalidArgument")) } });
  assertEquals(await mailActionJob(d, job()), "done");
  assertEquals([st.gmail, st.taken, st.method, st.ok], [["trash:m1", "trash:m2", "trash:m3"], [50, 60], "single", ids(3)]);
});

Deno.test("quota (429, 403 rate/quota reasons) → defer one minute, no fallback; stuck over 30 minutes → plain error (fail_job)", async () => {
  for (const e of [E(429), E(403, "rateLimitExceeded"), E(403, "userRateLimitExceeded"), E(403, "quotaExceeded")]) {
    const { d, st } = harness({ api: { batchModify: () => Promise.reject(e) } });
    const err = await assertRejects(() => mailActionJob(d, job()), Deferred);
    assertEquals([err.message, err.until, st.gmail, st.method, st.cursor], ["mail_quota", new Date(T0 + 60_000).toISOString(), [], "batch", 0]);
  }
  const { d } = harness({ quotaSince: new Date(T0 - QUOTA_STUCK_MS - 1).toISOString(), api: { batchModify: () => Promise.reject(E(429)) } });
  const e2 = await assertRejects(() => mailActionJob(d, job()));
  assert(!(e2 instanceof Deferred));
  assertEquals((e2 as Error).message, "mail_quota_stuck");
});

Deno.test("403 insufficientPermissions → close as scope_missing (rest failed), no retry, no fallback", async () => {
  const { d, st } = harness({ api: { batchModify: () => Promise.reject(E(403, "insufficientPermissions")) } });
  assertEquals(await mailActionJob(d, job()), "scope_missing");
  assertEquals([st.finished, st.failed, st.ok, st.method], ["scope_missing", ids(3), [], "batch"]);
});

Deno.test("token problems close the row with the connection code and never call Gmail", async () => {
  for (const code of ["reauth_required", "no_connection"] as const) {
    const { d, st } = harness({ token: { code } });
    assertEquals(await mailActionJob(d, job()), code);
    assertEquals([st.finished, st.failed, st.gmail, st.taken], [code, ids(3), [], []]);
  }
});

Deno.test("single mode: a 404 or 400 on one message fails only that id", async () => {
  const { d, st } = harness({ method: "single", api: { trash: (id) => id === "m2" ? Promise.reject(E(404)) : id === "m3" ? Promise.reject(E(400)) : Promise.resolve() } });
  assertEquals(await mailActionJob(d, job()), "done");
  assertEquals([st.ok, st.failed, st.taken], [["m1"], ["m2", "m3"], [60]]);
});

Deno.test("unknown result (5xx, other 403, timeout) before the last attempt → plain error, nothing recorded, same batch next time", async () => {
  for (const e of [E(500), E(403, "forbidden"), new DOMException("t", "TimeoutError")]) {
    const { d, st } = harness({ api: { batchModify: () => Promise.reject(e) } });
    const err = await assertRejects(() => mailActionJob(d, job()));
    assert(!(err instanceof Deferred));
    assertEquals([st.cursor, st.ok, st.finished], [0, [], undefined]);
  }
});

Deno.test("last attempt with an unknown result → reread labels (20 units each): target state ok, others failed, then close", async () => {
  const { d, st } = harness({ api: { batchModify: () => Promise.reject(E(503)),
    labels: (id) => id === "m2" ? Promise.resolve({ id, labelIds: ["INBOX"] }) : id === "m3" ? Promise.reject(E(404)) : Promise.resolve({ id, labelIds: ["TRASH"] }) } });
  assertEquals(await mailActionJob(d, job("execute", 5)), "verified");
  assertEquals([st.ok, st.failed, st.finished, st.taken], [["m1"], ["m2", "m3"], null, [50, 60]]);
});

Deno.test("worker dies after Gmail success but before progress → next run resends the same batch and the result has no duplicates", async () => {
  const h = harness({ failProgressOnce: true });
  await assertRejects(() => mailActionJob(h.d, job()));
  assertEquals(h.st.cursor, 0);
  assertEquals(await mailActionJob(h.d, job("execute", 2)), "done");
  assertEquals([h.st.gmail, h.st.ok, h.st.failed], [["batch:3:+TRASH:-", "batch:3:+TRASH:-"], ids(3), []]);
});

Deno.test("stale: another worker already recorded the batch → stop without finishing", async () => {
  const { d, st } = harness();
  d.progress = () => Promise.resolve(false);
  assertEquals(await mailActionJob(d, job()), "stale");
  assertEquals(st.finished, undefined);
});

Deno.test("no units this minute → defer to the next minute before any Gmail call", async () => {
  const { d, st } = harness({ take: () => false });
  const e = await assertRejects(() => mailActionJob(d, job()), Deferred);
  assertEquals([e.message, e.until, st.gmail], ["mail_units", new Date(Math.floor(T0 / 60_000) * 60_000 + 60_000).toISOString(), []]);
});

Deno.test("budget: single mode stops after 30 s with progress kept and defers to now", async () => {
  const { d, st } = harness({ method: "single", ids: ids(45), clock: [T0, T0, T0 + MAIL_JOB_BUDGET_MS] });
  const e = await assertRejects(() => mailActionJob(d, job()), Deferred);
  assertEquals([e.message, e.until, st.cursor, st.ok.length], ["mail_budget", new Date(T0 + MAIL_JOB_BUDGET_MS).toISOString(), 20, 20]);
});

Deno.test("read: execute removes UNREAD in one batch; batch 404 → per-message modify; undo adds UNREAD back with batch even after single", async () => {
  const r1 = harness({ action: "read" });
  assertEquals(await mailActionJob(r1.d, job()), "done");
  assertEquals(r1.st.gmail, ["batch:3:+:-UNREAD"]);
  const r2 = harness({ action: "read", api: { batchModify: () => Promise.reject(E(404)) } });
  assertEquals(await mailActionJob(r2.d, job()), "done");
  assertEquals(r2.st.gmail, ["modify:m1:+:-UNREAD", "modify:m2:+:-UNREAD", "modify:m3:+:-UNREAD"]);
  const r3 = harness({ action: "read", phase: "undo", method: "single" });
  assertEquals(await mailActionJob(r3.d, job("undo")), "done");
  assertEquals(r3.st.gmail, ["batch:3:+UNREAD:-"]);
});

Deno.test("undo trash follows the execute method: single → untrash each (5 units), batch → remove TRASH once; trash batch 404 is not a fallback", async () => {
  const s = harness({ phase: "undo", method: "single" });
  assertEquals(await mailActionJob(s.d, job("undo")), "done");
  assertEquals([s.st.gmail, s.st.taken], [["untrash:m1", "untrash:m2", "untrash:m3"], [15]]);
  const b = harness({ phase: "undo", method: "batch" });
  assertEquals(await mailActionJob(b.d, job("undo")), "done");
  assertEquals(b.st.gmail, ["batch:3:+:-TRASH"]);
  const g = harness({ api: { batchModify: () => Promise.reject(E(404)) } });
  await assertRejects(() => mailActionJob(g.d, job()));                         // 휴지통 batch 404 = 결과 불명(재시도)
  assertEquals([g.st.gmail, g.st.method], [[], "batch"]);
});

Deno.test("row gone → gone; finished row → noop; neither calls Gmail nor finishes", async () => {
  for (const [status, want] of [["gone", "gone"], ["done", "noop"], ["undone", "noop"]]) {
    const { d, st } = harness({ status });
    assertEquals(await mailActionJob(d, job()), want);
    assertEquals([st.gmail, st.finished], [[], undefined]);
  }
});

Deno.test("quota in the middle of single mode records what was done, then defers", async () => {
  let n = 0;
  const { d, st } = harness({ method: "single", api: { trash: () => (++n === 3 ? Promise.reject(E(429)) : Promise.resolve()) } });
  await assertRejects(() => mailActionJob(d, job()), Deferred);
  assertEquals([st.cursor, st.ok], [2, ["m1", "m2"]]);
});

Deno.test("logs carry codes and counts only (no message ids); the job's deps never touch items or facts", async () => {
  const { d, st } = harness({ api: { batchModify: () => Promise.reject(E(400)) } });
  await mailActionJob(d, job());
  const text = JSON.stringify(st.logs);
  assert(!/m\d/.test(text), text);
  const src = await Deno.readTextFile(new URL("../functions/worker/mail-action-deps.ts", import.meta.url));
  assert(!/insert_item|save_fact|worker_set_item_status|delete_gmail_source|from\("items"\)|from\("facts"\)/.test(src));
});
```

- [ ] **Step 2: 실패하는 테스트 — 수집 경로 units**

`supabase/tests/units.test.ts`:

```ts
import { assert, assertEquals } from "jsr:@std/assert";
import type { GmailClient, GmailMessage } from "../functions/_shared/gmail.ts";
import { gmailFetch, type GmailJobDeps, gmailSync, gmailUnsubFetch, noteGmailUnits, type RpcClient } from "../functions/_shared/gmail-jobs.ts";
import type { Job } from "../functions/_shared/job.ts";

// 수집 경로 units 기록(스펙 §7 "속도", 계획 D6): 기록만, fail-open, 잡당 차단기. 가짜 RPC·Gmail
const USER = "00000000-0000-0000-0000-0000000000aa", CONN = "00000000-0000-0000-0000-0000000000cc";
const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const mk = (id: string): GmailMessage => ({ id, internalDate: "1790000000000", labelIds: ["INBOX"], payload: { mimeType: "text/plain",
  body: { data: b64("합성 본문") }, headers: [{ name: "From", value: "합성 <a@example.com>" }, { name: "Subject", value: "합성 안내" }] } });
const ids = (n: number) => Array.from({ length: n }, (_, i) => `g${i + 1}`);
const job = (kind: string, payload: Record<string, unknown>): Job => ({ id: "j", kind, user_id: USER, payload: { connection_id: CONN, ...payload }, attempts: 1, checkpoint: null });
function rpcFake() {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const rpc: RpcClient = { rpc: (fn, args = {}) => {
    calls.push({ fn, args });
    const data = fn === "gmail_get_refresh_token" ? "rt" : fn === "gmail_state" ? [{ cursor: "1", last_success_at: "2026-10-01T00:00:00Z" }]
      : fn === "insert_item" ? crypto.randomUUID() : null;
    return Promise.resolve({ data, error: null });
  } };
  return { rpc, calls };
}
function deps(noteUnits?: GmailJobDeps["noteUnits"], api: Partial<GmailClient> = {}): GmailJobDeps {
  return {
    refresh: () => Promise.resolve("at"),
    api: () => ({ history: () => Promise.resolve({ notFound: true as const }), listMessageIds: () => Promise.resolve({ messages: [] }),
      profile: () => Promise.resolve({ emailAddress: "x@example.com", historyId: "9" }), getMessage: (id) => Promise.resolve(mk(id)),
      getMessageMeta: (id) => Promise.resolve(mk(id)), watch: () => Promise.resolve({ historyId: "1", expiration: "1" }), ...api }),
    encrypt: (_u, t) => Promise.resolve(new TextEncoder().encode(t)), pause: () => Promise.resolve(), topic: () => "t", noteUnits,
  };
}
async function quiet<T>(f: () => Promise<T>): Promise<{ r: T; lines: string[] }> {
  const lines: string[] = [], orig = console.log;
  console.log = (s: unknown) => { lines.push(String(s)); };
  try { return { r: await f(), lines }; } finally { console.log = orig; }
}

Deno.test("gmail-fetch notes 20 units per message, once per 10 messages (23 → 200, 200, 60)", async () => {
  const notes: number[] = [];
  const { rpc } = rpcFake();
  await quiet(() => gmailFetch(rpc, job("gmail-fetch", { ids: ids(23) }), deps((_s, _u, n) => { notes.push(n); return Promise.resolve(true); })));
  assertEquals(notes, [200, 200, 60]);
});

Deno.test("units note fails open: the fetch still stores every message, later notes in that job are skipped, one log line", async () => {
  let calls = 0;
  const { rpc, calls: rc } = rpcFake();
  const { r, lines } = await quiet(() => gmailFetch(rpc, job("gmail-fetch", { ids: ids(23) }), deps(() => { calls++; return Promise.resolve(false); })));
  assertEquals([r, calls, rc.filter((c) => c.fn === "insert_item").length], ["fetched", 1, 23]);
  assertEquals(lines.filter((l) => l.includes("units_note_error")).length, 1);
});

Deno.test("without a noteUnits dep nothing is noted (old fakes and tests keep their RPC order)", async () => {
  const { rpc, calls } = rpcFake();
  await quiet(() => gmailFetch(rpc, job("gmail-fetch", { ids: ids(3) }), deps()));
  assertEquals(calls.filter((c) => c.fn === "gmail_note_units").length, 0);
});

Deno.test("gmail-sync notes 2 per history page, 1 for profile, 5 per list page (resync)", async () => {
  const notes: number[] = [];
  const { rpc } = rpcFake();
  await quiet(() => gmailSync(rpc, job("gmail-sync", {}), deps((_s, _u, n) => { notes.push(n); return Promise.resolve(true); }, {
    listMessageIds: (_q, p) => Promise.resolve(p ? { messages: [{ id: "b" }] } : { messages: [{ id: "a" }], nextPageToken: "2" }) })));
  assertEquals(notes, [2, 1, 5, 5]);
});

Deno.test("gmail-unsub-fetch notes 20 per header read, once per 10 (12 → 200, 40)", async () => {
  const notes: number[] = [];
  const { rpc } = rpcFake();
  await quiet(() => gmailUnsubFetch(rpc, job("gmail-unsub-fetch", { msgs: ids(12).map((id) => ({ id, item: null })) }),
    deps((_s, _u, n) => { notes.push(n); return Promise.resolve(true); })));
  assertEquals(notes, [200, 40]);
});

Deno.test("noteGmailUnits: ok → true; RPC error (e.g. function missing before 0030) → false; a hanging RPC → false within the budget", async () => {
  const ok = await noteGmailUnits({ rpc: () => Promise.resolve({ data: null, error: null }) }, USER, 20);
  const bad = await noteGmailUnits({ rpc: () => Promise.resolve({ data: null, error: { code: "PGRST202" } }) }, USER, 20);
  const t0 = performance.now();
  const hang = await noteGmailUnits({ rpc: () => new Promise(() => {}) }, USER, 20, 50);
  assertEquals([ok, bad, hang], [true, false, false]);
  assert(performance.now() - t0 < 1000);
});
```

- [ ] **Step 3: 실패 확인**

Run: `deno test --allow-read supabase/tests/mail-jobs.test.ts supabase/tests/units.test.ts`
Expected: FAIL — `worker/mail-action.ts` 없음, `noteGmailUnits` export 없음.

- [ ] **Step 4: `gmail-jobs.ts`**

(a) import에 `type GmailApi`를 더한다(`./gmail.ts` import 목록).

(b) `GmailJobDeps`에 마지막 필드를 더한다:

```ts
  noteUnits?(sb: RpcClient, user: string, units: number): Promise<boolean>;                   // 사용자 units 기록(스펙 §7 "속도", 0030). 없으면 기록 안 함(테스트 가짜)
```

`defaultGmailDeps`에 `noteUnits: (sb, user, units) => noteGmailUnits(sb, user, units),`를 더한다.

(c) 92~103행 `async function accessToken(…)`을 다음으로 바꾼다(본문은 같고 공개 함수로 옮긴다):

```ts
// refresh 실패(invalid_grant) → connections.status = reauth_required, 재인증 푸시(스펙 §7). 메일 정리 함수·잡도 쓴다
export async function gmailAccessToken(sb: RpcClient, refresh: (rt: string) => Promise<string>, user: string, conn: string): Promise<string | null> {
  const rt = await call(sb, "gmail_get_refresh_token", { p_user: user, p_connection: conn });
  if (!rt) return null;                   // 비활성 연결 또는 refresh token 없음
  try { return await refresh(rt as string); }
  catch (e) {
    if (!(e instanceof ReauthRequired)) throw e;
    await call(sb, "gmail_update", { p_user: user, p_connection: conn, p_status: "reauth_required" });
    await call(sb, "gmail_enqueue_reauth", { p_user: user });   // 끊김 즉시 재인증 푸시(스펙 §7)
    console.log(JSON.stringify({ connection_id: conn, gmail: "reauth_required" }));
    return null;
  }
}
const accessToken = (sb: RpcClient, deps: GmailJobDeps, user: string, conn: string) => gmailAccessToken(sb, deps.refresh, user, conn);
```

(d) `accessToken` 정의 바로 위에 더한다:

```ts
// ── 사용자 Gmail units 기록(스펙 §7 "속도", 계획 D6): 수집 경로는 더하기만. 기록은 수집을 늦추거나 실패시키지 않는다(fail-open) ──
export const NOTE_BUDGET_MS = 1000;
const GET_UNITS = 20;   // messages.get(공식 쿼터 표)
export async function noteGmailUnits(sb: RpcClient, user: string, units: number, budgetMs = NOTE_BUDGET_MS): Promise<boolean> {
  let timer: number | undefined;
  try {
    const work = Promise.resolve(sb.rpc("gmail_note_units", { p_user: user, p_units: units })).then((r) => { if (r.error) throw new Error("note"); });
    work.catch(() => {});
    await Promise.race([work, new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error("note_timeout")), budgetMs); })]);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
// 잡 하나의 기록기: 첫 실패·초과 뒤 그 잡의 나머지 기록은 건너뛴다(광고 기록 차단기와 같은 이유 — 멈춘 RPC 가 잡을 붙잡지 않게)
export function unitsNoter(sb: RpcClient, deps: Pick<GmailJobDeps, "noteUnits">, user: string, conn: string): (units: number) => Promise<void> {
  let off = false;
  return async (units) => {
    if (off || !deps.noteUnits) return;
    if (!await deps.noteUnits(sb, user, units)) {
      off = true;
      console.log(JSON.stringify({ connection_id: conn, code: "units_note_error" }));   // 코드만
    }
  };
}
// history.list 2, messages.list 5, profile 1 units(공식 쿼터 표)를 호출 전에 기록한다
export function meteredApi(api: GmailApi, note: (units: number) => Promise<void>): GmailApi {
  return {
    history: async (s, p) => { await note(2); return await api.history(s, p); },
    listMessageIds: async (q, p) => { await note(5); return await api.listMessageIds(q, p); },
    profile: async () => { await note(1); return await api.profile(); },
  };
}
```

(e) `gmailSync`의 `const r = await collectNewMessageIds(deps.api(token), …)`을 바꾼다:

```ts
  const note = unitsNoter(sb, deps, user, conn);
  const r = await collectNewMessageIds(meteredApi(deps.api(token), note), { cursor: st.cursor, lastSuccessAt: st.last_success_at });
```

(f) `gmailFetch`: `const api = deps.api(token);` 다음 줄에 `const note = unitsNoter(sb, deps, user, conn);`, `for (const id of job.payload.ids as string[]) {`를 `const all = job.payload.ids as string[];` + `for (const id of all) {`로 바꾸고, 10통 단위 블록의 `if (st.length === 0) { … return "connection_gone"; }` 다음 줄(블록 안)에 더한다:

```ts
      await note(GET_UNITS * Math.min(10, all.length - n + 1));   // 이번 10통 몫(호출 전 기록, D6)
```

(g) `gmailUnsubFetch`: `const api = deps.api(token);` 다음에 `const note = unitsNoter(sb, deps, user, conn);`와 `const msgs = job.payload.msgs as { id: string; item: string | null }[]; let n = 0;`, `for (const { id, item } of job.payload.msgs as { id: string; item: string | null }[]) {`를 `for (const { id, item } of msgs) {`로 바꾸고 루프 첫 줄에 더한다:

```ts
    if (n++ % 10 === 0) await note(GET_UNITS * Math.min(10, msgs.length - n + 1));
```

- [ ] **Step 5: 잡 모듈**

`supabase/functions/worker/mail-action.ts`:

```ts
import { Deferred } from "../_shared/budget.ts";
import { classifyGmailError, GmailHttpError, type GmailMailApi } from "../_shared/gmail.ts";
import type { Job } from "../_shared/job.ts";

// 메일 정리 실행·되돌리기 잡(스펙 §7 "실행 — 지속 잡"). lease 'mail:<user>' 라 사용자당 한 번에 하나.
// 묶음마다 units 가져가기 → Gmail → mail_action_progress(커서 비교, 계획 D8). 결과 불명은 같은 묶음을 다시 보낸다(라벨·trash·untrash 는 멱등).
// 보관함(items·facts)은 건드리지 않는다(Gmail 만 바꾼다). 로그는 결과 코드·개수·방식·상태만(Gmail id·검색 칸 없음)
export type Phase = "execute" | "undo";
export type Action = "trash" | "read";
export type Method = "batch" | "single";
export type Loaded = { status: string; action?: Action; method?: Method | null; connection_id?: string; ids?: string[]; cursor?: number };
export type TokenResult = string | { code: "reauth_required" | "no_connection" };
export type MailJobDeps = {
  begin(user: string, id: string, phase: Phase): Promise<Loaded | null>;
  token(user: string, conn: string): Promise<TokenResult>;
  api(accessToken: string): GmailMailApi;
  take(user: string, units: number): Promise<boolean>;
  setMethod(user: string, id: string, method: Method): Promise<void>;
  progress(user: string, id: string, phase: Phase, from: number, to: number, ok: string[], failed: string[]): Promise<boolean>;
  quota(user: string, id: string): Promise<string | null>;
  finish(user: string, id: string, phase: Phase, code: string | null): Promise<void>;
  now(): number;
  log(o: Record<string, unknown>): void;
};

export const MAIL_JOB_BUDGET_MS = 30_000;          // 잡 1회(계획 D7): 배치 끝(100초)에 클레임돼도 + 30 + 호출 15 < Edge 150초
export const BATCH_MAX = 1000, SINGLE_CHUNK = 20, MAX_ATTEMPTS = 5;
export const QUOTA_DEFER_MS = 60_000, QUOTA_STUCK_MS = 30 * 60_000;
export const UNITS = { batch: 50, trash: 20, untrash: 5, modify: 5, labels: 20 } as const;   // 공식 쿼터 표(§3)

type Op = {
  batch(api: GmailMailApi, ids: string[]): Promise<void>;
  single(api: GmailMailApi, id: string): Promise<void>;
  singleUnits: number;
  reached(labels: string[]): boolean;              // 마지막 시도 재조회의 목표 상태
  fallbackOn404: boolean;                          // 읽음은 400·404, 휴지통은 400만 건별로(D9)
};
export function opFor(action: Action, phase: Phase): Op {
  if (action === "trash" && phase === "execute") {
    return { batch: (a, ids) => a.batchModify(ids, ["TRASH"], []), single: (a, id) => a.trash(id),
             singleUnits: UNITS.trash, reached: (l) => l.includes("TRASH"), fallbackOn404: false };
  }
  if (action === "trash") {
    return { batch: (a, ids) => a.batchModify(ids, [], ["TRASH"]), single: (a, id) => a.untrash(id),
             singleUnits: UNITS.untrash, reached: (l) => !l.includes("TRASH"), fallbackOn404: false };
  }
  if (phase === "execute") {
    return { batch: (a, ids) => a.batchModify(ids, [], ["UNREAD"]), single: (a, id) => a.modify(id, [], ["UNREAD"]),
             singleUnits: UNITS.modify, reached: (l) => !l.includes("UNREAD"), fallbackOn404: true };
  }
  return { batch: (a, ids) => a.batchModify(ids, ["UNREAD"], []), single: (a, id) => a.modify(id, ["UNREAD"], []),
           singleUnits: UNITS.modify, reached: (l) => l.includes("UNREAD"), fallbackOn404: true };
}

class Interrupted extends Error {
  constructor(readonly ok: string[], readonly failed: string[], readonly reason: unknown) { super("interrupted"); }
}
// 건별: 한 id 의 400·404 는 그 id 만 실패. 그 밖의 오류는 그때까지의 결과를 들고 멈춘다
async function singles(api: GmailMailApi, o: Op, ids: string[]) {
  const ok: string[] = [], failed: string[] = [];
  for (const id of ids) {
    try { await o.single(api, id); ok.push(id); }
    catch (e) {
      const k = classifyGmailError(e);
      if (k === "gone" || k === "rejected") failed.push(id);
      else throw new Interrupted(ok, failed, e);
    }
  }
  return { ok, failed };
}
const iso = (ms: number) => new Date(ms).toISOString();
const nextMinute = (ms: number) => iso(Math.floor(ms / 60_000) * 60_000 + 60_000);
const codeOf = (e: unknown) => e instanceof GmailHttpError ? String(e.status) : e instanceof Error ? e.name : "error";
function stale(d: MailJobDeps, phase: Phase): string {
  d.log({ mail_action: "stale", phase });          // 다른 워커가 이미 그 구간을 적었다(lease 만료 뒤 늦게 깸, D8)
  return "stale";
}

export async function mailActionJob(d: MailJobDeps, job: Job): Promise<string> {
  const user = job.user_id;
  if (!user) throw new Error("mail-action without user_id");
  const id = String(job.payload.id ?? ""), phase: Phase = job.payload.phase === "undo" ? "undo" : "execute";
  const row = await d.begin(user, id, phase);
  if (!row) { d.log({ mail_action: "gone", phase }); return "gone"; }                    // 정리·출처 삭제로 행이 없음
  if (row.status !== (phase === "execute" ? "running" : "undoing")) { d.log({ mail_action: "noop", phase, status: row.status }); return "noop"; }
  const t = await d.token(user, row.connection_id!);
  if (typeof t !== "string") {
    await d.finish(user, id, phase, t.code);
    d.log({ mail_action: "closed", phase, code: t.code });
    return t.code;
  }
  const api = d.api(t), o = opFor(row.action!, phase), ids = row.ids ?? [];
  let cursor = row.cursor ?? 0;
  // 되돌리기는 실행 방식을 따른다: 휴지통 single 이면 처음부터 untrash, 읽음은 늘 batch 먼저(D9)
  let method: Method = phase === "undo" && row.action === "read" ? "batch" : (row.method ?? "batch");
  if (phase === "execute" && !row.method) await d.setMethod(user, id, "batch");
  const t0 = d.now(), last = job.attempts >= MAX_ATTEMPTS;
  while (cursor < ids.length) {
    if (d.now() - t0 >= MAIL_JOB_BUDGET_MS) throw new Deferred(iso(d.now()), "mail_budget");   // 커서는 남아 있다 — 곧 다시
    const chunk = ids.slice(cursor, cursor + (method === "batch" ? BATCH_MAX : SINGLE_CHUNK)), end = cursor + chunk.length;
    if (!await d.take(user, method === "batch" ? UNITS.batch : chunk.length * o.singleUnits)) throw new Deferred(nextMinute(d.now()), "mail_units");
    let ok: string[], failed: string[] = [];
    try {
      if (method === "batch") { await o.batch(api, chunk); ok = chunk; }   // 2xx = 그 호출의 id 전부 성공(Gmail 이 id별 결과를 주지 않는다)
      else ({ ok, failed } = await singles(api, o, chunk));
    } catch (e) {
      let err = e;
      if (e instanceof Interrupted) {
        err = e.reason;
        const n = e.ok.length + e.failed.length;
        if (n > 0) {
          if (!await d.progress(user, id, phase, cursor, cursor + n, e.ok, e.failed)) return stale(d, phase);
          cursor += n;
        }
      }
      const kind = classifyGmailError(err);
      if (method === "batch" && (kind === "rejected" || (kind === "gone" && o.fallbackOn404))) {
        method = "single";                                                           // 일괄 거절로 확인된 응답만(D9)
        if (phase === "execute") await d.setMethod(user, id, "single");
        d.log({ mail_action: "fallback", phase, status: codeOf(err) });
        continue;
      }
      if (kind === "quota") {
        const since = Date.parse((await d.quota(user, id)) ?? iso(d.now()));
        if (d.now() - since > QUOTA_STUCK_MS) throw new Error("mail_quota_stuck");  // fail_job(attempts 사용)
        throw new Deferred(iso(d.now() + QUOTA_DEFER_MS), "mail_quota");           // 폴백 없이 1분 뒤 같은 묶음
      }
      if (kind === "scope") {
        await d.finish(user, id, phase, "scope_missing");
        d.log({ mail_action: "closed", phase, code: "scope_missing" });
        return "scope_missing";
      }
      if (!last) throw new Error("mail_unknown " + codeOf(err));                    // 결과 불명: 백오프 뒤 같은 묶음(멱등)
      // 마지막 시도(D10): 남은 묶음을 다시 읽어 목표 상태면 성공, 아니면 실패로 적고 마감(커서 뒤는 finish 가 실패로)
      if (!await lookup(d, api, user, id, phase, o, ids.slice(cursor, end), cursor)) return stale(d, phase);
      await d.finish(user, id, phase, null);
      d.log({ mail_action: "verified", phase, method });
      return "verified";
    }
    if (!await d.progress(user, id, phase, cursor, end, ok, failed)) return stale(d, phase);
    cursor = end;
  }
  await d.finish(user, id, phase, null);
  d.log({ mail_action: "done", phase, method, n: ids.length });
  return "done";
}

async function lookup(d: MailJobDeps, api: GmailMailApi, user: string, id: string, phase: Phase, o: Op, rest: string[], from: number): Promise<boolean> {
  let cur = from;
  for (let i = 0; i < rest.length; i += SINGLE_CHUNK) {
    const sub = rest.slice(i, i + SINGLE_CHUNK);
    if (!await d.take(user, sub.length * UNITS.labels)) throw new Deferred(nextMinute(d.now()), "mail_units");   // 진행은 남아 있다
    const ok: string[] = [], failed: string[] = [];
    for (const m of sub) {
      try { (o.reached((await api.labels(m)).labelIds ?? []) ? ok : failed).push(m); }
      catch { failed.push(m); }                                                     // 읽지 못하면 실패(되돌리기 대상에서 빠진다)
    }
    if (!await d.progress(user, id, phase, cur, cur + sub.length, ok, failed)) return false;
    cur += sub.length;
  }
  return true;
}
```

`supabase/functions/worker/mail-action-deps.ts`:

```ts
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { gmailMailApi, refreshAccessToken } from "../_shared/gmail.ts";
import { gmailAccessToken } from "../_shared/gmail-jobs.ts";
import type { Loaded, MailJobDeps } from "./mail-action.ts";

// service role. 모든 RPC 에 user_id 를 넘긴다(스펙 §12 통제 4). 보관함 RPC 는 부르지 않는다(Gmail 만 바꾼다)
export function mailJobDeps(sb: SupabaseClient): MailJobDeps {
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await sb.rpc(fn, args);
    if (error) throw new Error(fn + " " + (error.code ?? "error"));
    return data;
  };
  return {
    begin: async (u, id, phase) => (await rpc("mail_action_begin", { p_user: u, p_id: id, p_phase: phase })) as Loaded | null,
    token: async (u, conn) => {
      const t = await gmailAccessToken(sb, refreshAccessToken, u, conn);
      if (t) return t;
      const rows = (await rpc("mail_connection", { p_user: u })) as { connection_id: string; status: string }[] | null;
      const c = rows?.find((r) => r.connection_id === conn);
      return { code: c && c.status !== "active" ? "reauth_required" : "no_connection" };   // D11
    },
    api: gmailMailApi,
    take: async (u, n) => (await rpc("gmail_take_units", { p_user: u, p_units: n })) === true,
    setMethod: async (u, id, m) => { await rpc("mail_action_set_method", { p_user: u, p_id: id, p_method: m }); },
    progress: async (u, id, phase, from, to, ok, failed) =>
      (await rpc("mail_action_progress", { p_user: u, p_id: id, p_phase: phase, p_from: from, p_cursor: to, p_ok: ok, p_failed: failed })) === true,
    quota: async (u, id) => (await rpc("mail_action_quota", { p_user: u, p_id: id })) as string | null,
    finish: async (u, id, phase, code) => { await rpc("mail_action_finish", { p_user: u, p_id: id, p_phase: phase, p_code: code }); },
    now: () => Date.now(),
    log: (o) => console.log(JSON.stringify(o)),
  };
}
```

`supabase/functions/worker/index.ts`: import 두 줄을 더하고(`import { mailActionJob } from "./mail-action.ts";`, `import { mailJobDeps } from "./mail-action-deps.ts";`), `const emb = embedDeps(sb);` 다음에 `const mail = mailJobDeps(sb);`, 핸들러 표의 `"gmail-reauth": …` 줄 다음에 더한다:

```ts
  // 메일 정리 실행·되돌리기(스펙 §7): 묶음마다 Gmail → id별 결과. 보관함은 건드리지 않는다
  "mail-action": (j) => mailActionJob(mail, j),
```

- [ ] **Step 6: 통과·회귀 확인**

Run: `deno test --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/tests/mail-jobs.test.ts supabase/tests/units.test.ts supabase/tests/unsub-jobs.test.ts supabase/tests/gmail.test.ts supabase/tests/run.test.ts supabase/tests/batch.test.ts --filter "$LOCAL_FILTER" && deno check supabase/functions/worker/index.ts`
Expected: `mail-jobs` 17·`units` 6 통과, 기존 `unsub-jobs`·`gmail`(가짜 사례)·`run`·`batch` 그대로 통과(기존 테스트는 `noteUnits`가 없는 가짜라 RPC 순서가 같다), check 무오류. `run.test.ts`·`batch.test.ts`가 호스팅 DB를 쓰면(`grep -n _testenv`) 빼고 돌린다.

- [ ] **Step 7: 커밋**

```bash
git add supabase/functions/worker/mail-action.ts supabase/functions/worker/mail-action-deps.ts supabase/functions/worker/index.ts supabase/functions/_shared/gmail-jobs.ts supabase/tests/mail-jobs.test.ts supabase/tests/units.test.ts
git commit -m "feat(worker): mail-action job — per batch take units then call Gmail and record per-id results with compare-and-set progress; trash batch 400 (read 400/404) falls back to per-message calls in the same job, quota reasons defer a minute (30 min → fail), insufficientPermissions closes as scope_missing, unknown results retry the same batch and the last attempt rereads labels; undo follows the execute method; 30 s per run; collection paths note Gmail units fail-open (1 s, one skip per job); gmailAccessToken exported

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task M5: Edge `mail-action` (preview·execute·undo·status)

**Files:**
- Create: `supabase/functions/mail-action/handler.ts`, `supabase/functions/mail-action/deps.ts`, `supabase/functions/mail-action/index.ts`
- Test: `supabase/tests/mail-action.test.ts`

**Interfaces:**
- Consumes: M1 `checkConditions`·`buildQuery`, M2 `GMAIL_MODIFY_SCOPE`·`GmailHttpError`·`classifyGmailError`·`GmailMailApi`·`gmailMailApi`·`refreshAccessToken`·`header`, M3 RPC(`mail_connection`·`mail_action_preview`·`mail_action_start`·`mail_action_undo`·`mail_action_status`), M4 `gmailAccessToken`·`noteGmailUnits`, `parseFrom`(`_shared/unsub.ts`), `kickInBackground`(`_shared/kick-worker.ts`).
- Produces: HTTP 계약("이 계획이 만드는 인터페이스" — M9 앱·M10 스모크가 쓴다), `handleMailAction(req, deps)`, `MailActionDeps`, `Counts`, `sampleOf(msg)`.

- [ ] **Step 1: 실패하는 테스트**

`supabase/tests/mail-action.test.ts`:

```ts
import { assert, assertEquals } from "jsr:@std/assert";
import { GmailHttpError, type GmailMessage } from "../functions/_shared/gmail.ts";
import { type Counts, handleMailAction, type MailActionDeps, type MailConnection, type RowResult, sampleOf } from "../functions/mail-action/handler.ts";

// 메일 정리 함수(스펙 §7): 가짜 deps(DB·Gmail 없음). 미리보기 글·조건 값이 로그에 남지 않는지도 본다
const MOD = "https://www.googleapis.com/auth/gmail.modify", RO = "https://www.googleapis.com/auth/gmail.readonly";
const USER = "00000000-0000-0000-0000-0000000000aa", CONN = "00000000-0000-0000-0000-0000000000cc", TOKEN = "11111111-1111-4111-8111-111111111111";
const mk = (id: string, from = "합성상점 <shop@example.com>", subject = "합성 광고 " + id) =>
  ({ id, internalDate: "1790000000000", payload: { headers: [{ name: "From", value: from }, { name: "Subject", value: subject }] } }) as GmailMessage;
type Page = { messages?: { id: string }[]; nextPageToken?: string; resultSizeEstimate?: number };
const C = (status: string, x: Partial<Counts> = {}): Counts =>
  ({ id: TOKEN, status, total: 3, done: 0, failed: 0, undone: 0, undo_failed: 0, code: null, method: null, ...x });
const many = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}` }));

type FakeOpts = { user?: string | null; conn?: Partial<MailConnection> | null; enabled?: boolean; token?: string | null; pages?: Page[]; starred?: number;
  list?: (q: string, n: number, p?: string) => Promise<Page>; headers?: (id: string) => Promise<GmailMessage>; row?: string | null;
  start?: RowResult; undo?: RowResult; status?: Counts | null };
function fake(o: FakeOpts = {}) {
  const calls = { list: [] as { q: string; n: number; p?: string }[], headers: [] as string[], notes: [] as number[],
    rows: [] as { action: string; ids: string[] }[], kicks: 0, starts: [] as string[], undos: [] as string[] };
  const pages = o.pages ?? [{ messages: [{ id: "a" }, { id: "b" }, { id: "c" }], resultSizeEstimate: 3 }];
  const d: MailActionDeps = {
    enabled: () => o.enabled ?? true,
    authUser: (t) => Promise.resolve(t === "user-jwt" ? (o.user === undefined ? USER : o.user) : null),
    connection: () => Promise.resolve(o.conn === null ? null : { connection_id: CONN, account_ref: "poc@example.com", status: "active", scopes: [RO, MOD], ...o.conn }),
    accessToken: () => Promise.resolve(o.token === undefined ? "at" : o.token),
    api: () => ({
      list: (q, n, p) => {
        calls.list.push({ q, n, p });
        if (o.list) return o.list(q, n, p);
        return Promise.resolve(n === 1 ? { resultSizeEstimate: o.starred ?? 0 } : pages[p ? Number(p) : 0]);
      },
      headers: (id) => { calls.headers.push(id); return o.headers ? o.headers(id) : Promise.resolve(mk(id)); },
    }),
    noteUnits: (_u, n) => { calls.notes.push(n); return Promise.resolve(); },
    createRow: (_u, _c, action, ids) => { calls.rows.push({ action, ids }); return Promise.resolve(o.row === undefined ? TOKEN : o.row); },
    start: (_u, id) => { calls.starts.push(id); return Promise.resolve(o.start ?? { result: "started", ...C("pending") }); },
    undo: (_u, id) => { calls.undos.push(id); return Promise.resolve(o.undo ?? { result: "started", ...C("undo_pending") }); },
    status: () => Promise.resolve(o.status === undefined ? C("running") : o.status),
    kick: () => { calls.kicks++; },
  };
  return { d, calls };
}
const req = (path: string, body?: unknown, o: { method?: string; token?: string | null } = {}) => new Request("http://x/functions/v1/mail-action/" + path, {
  method: o.method ?? (body === undefined ? "GET" : "POST"), body: body === undefined ? undefined : JSON.stringify(body),
  headers: { "content-type": "application/json", ...(o.token === null ? {} : { authorization: `Bearer ${o.token ?? "user-jwt"}` }) } });
const mail = (x: Record<string, unknown> = {}) =>
  ({ action: "trash", sender: "합성상점", subject_words: [], received_from: null, received_to: null, promotions: true, unread_only: false, ...x });
async function quiet<T>(f: () => Promise<T>): Promise<{ r: T; lines: string[] }> {
  const lines: string[] = [], orig = console.log;
  console.log = (s: unknown) => { lines.push(String(s)); };
  try { return { r: await f(), lines }; } finally { console.log = orig; }
}
const call = async (d: MailActionDeps, r: Request) => (await quiet(() => handleMailAction(r, d))).r;

Deno.test("401 without or with an invalid JWT; unknown route 404; nothing else is called", async () => {
  const { d, calls } = fake();
  assertEquals((await call(d, req("preview", mail(), { token: null }))).status, 401);
  assertEquals((await call(d, req("preview", mail(), { token: "bad" }))).status, 401);
  assertEquals((await call(d, req("purge", {}))).status, 404);
  assertEquals([calls.list.length, calls.rows.length], [0, 0]);
});

Deno.test("preview: server builds the query, lists 500 per page, estimates starred, reads 20 headers, creates the row; notes units before calls", async () => {
  const { d, calls } = fake({ starred: 2 });
  const r = await call(d, req("preview", mail()));
  assertEquals(r.status, 200);
  const j = await r.json();
  assertEquals(calls.list, [{ q: `in:inbox -is:starred from:"합성상점" category:promotions`, n: 500, p: undefined },
                            { q: `in:inbox is:starred from:"합성상점" category:promotions`, n: 1, p: undefined }]);
  assertEquals(calls.rows, [{ action: "trash", ids: ["a", "b", "c"] }]);
  assertEquals(calls.notes, [5, 5, 60]);
  assertEquals({ ...j, sample: j.sample.length }, { token: TOKEN, action: "trash", conditions: { action: "trash", sender: "합성상점", subject_words: [],
    received_from: null, received_to: null, promotions: true, unread_only: false }, count: 3, exact: true, total_estimate: 3, starred_estimate: 2, has_more: false, sample: 3 });
  assertEquals(j.sample[0], { from: "합성상점", subject: "합성 광고 a", date: new Date(1790000000000).toISOString() });
});

Deno.test("preview: conditions are the server-confirmed ones (sanitized), a model-written q is ignored", async () => {
  const { d, calls } = fake();
  const j = await (await call(d, req("preview", mail({ sender: `합성"상점"`, q: "in:anywhere" })))).json();
  assertEquals(j.conditions.sender, "합성상점");
  assert(!calls.list[0].q.includes("anywhere"));
});

Deno.test("preview paging: stops at 1,000 ids (has_more, estimate floor = count), exactly 1,000 with no next page is exact, 5-page cap", async () => {
  const p1 = fake({ pages: [{ messages: many("a", 500), nextPageToken: "1", resultSizeEstimate: 900 }, { messages: many("b", 500), nextPageToken: "2" }] });
  const j1 = await (await call(p1.d, req("preview", mail()))).json();
  assertEquals([j1.count, j1.exact, j1.has_more, j1.total_estimate, p1.calls.list.length], [1000, false, true, 1000, 3]);
  const p2 = fake({ pages: [{ messages: many("a", 500), nextPageToken: "1", resultSizeEstimate: 1000 }, { messages: many("b", 500) }] });
  const j2 = await (await call(p2.d, req("preview", mail()))).json();
  assertEquals([j2.count, j2.exact, j2.has_more, j2.total_estimate], [1000, true, false, 1000]);
  const p3 = fake({ pages: [0, 1, 2, 3, 4, 5].map((i) => ({ messages: many(`p${i}-`, 100), nextPageToken: String(i + 1), resultSizeEstimate: 4000 })) });
  const j3 = await (await call(p3.d, req("preview", mail()))).json();
  assertEquals([j3.count, j3.exact, j3.has_more, j3.total_estimate], [500, false, true, 4000]);
  const p4 = fake({ pages: [{ messages: many("a", 400), nextPageToken: "1" }, { messages: many("b", 400), nextPageToken: "2" }, { messages: many("c", 400) }] });
  const j4 = await (await call(p4.d, req("preview", mail()))).json();
  assertEquals([j4.count, j4.exact, j4.has_more], [1000, false, true]);       // 마지막 페이지에서 잘림 = 더 있다
});

Deno.test("bad_condition and needs_target: 400, never lists, never creates a row, values not echoed or logged", async () => {
  const { d, calls } = fake();
  const { r, lines } = await quiet(() => handleMailAction(req("preview", mail({ received_from: "2026-09-30", received_to: "2026-09-01" })), d));
  assertEquals([r.status, await r.json()], [400, { error: "bad_condition", fields: ["received_from", "received_to"] }]);
  const n = await call(d, req("preview", mail({ sender: null, promotions: false })));
  assertEquals([n.status, await n.json()], [400, { error: "needs_target" }]);
  assertEquals([calls.list.length, calls.rows.length], [0, 0]);
  assert(!lines.join("\n").includes("2026-09"));
});

Deno.test("connection and permission: none 404, readonly or null scopes 403 scope_missing, not active or no token 409 reauth_required", async () => {
  assertEquals((await call(fake({ conn: null }).d, req("preview", mail()))).status, 404);
  for (const scopes of [[RO], null]) {
    const f = fake({ conn: { scopes } });
    const r = await call(f.d, req("preview", mail()));
    assertEquals([r.status, await r.json(), f.calls.list.length], [403, { error: "scope_missing" }, 0]);
  }
  assertEquals((await call(fake({ conn: { status: "reauth_required" } }).d, req("preview", mail()))).status, 409);
  assertEquals((await call(fake({ token: null }).d, req("preview", mail()))).status, 409);
});

Deno.test("empty preview: 200 token null, count 0, no row, no header reads", async () => {
  const { d, calls } = fake({ pages: [{ resultSizeEstimate: 0 }] });
  const j = await (await call(d, req("preview", mail()))).json();
  assertEquals([j.token, j.count, j.exact, j.sample, calls.rows.length, calls.headers.length], [null, 0, true, [], 0, 0]);
});

Deno.test("samples: a message deleted in between (404) is left out but still counted; other Gmail errors fail the preview", async () => {
  const g = fake({ headers: (id) => id === "b" ? Promise.reject(new GmailHttpError("messages.get", 404)) : Promise.resolve(mk(id)) });
  const j = await (await call(g.d, req("preview", mail()))).json();
  assertEquals([j.count, j.sample.length], [3, 2]);
  const h = fake({ headers: () => Promise.reject(new GmailHttpError("messages.get", 500)) });
  const r = await call(h.d, req("preview", mail()));
  assertEquals([r.status, await r.json(), h.calls.rows.length], [502, { error: "gmail_upstream" }, 0]);
});

Deno.test("Gmail errors map: 429/403 rate → 429, 403 permissions → 403 scope_missing, 401 → 409, 5xx and timeout → 502", async () => {
  const cases: [unknown, number, string][] = [
    [new GmailHttpError("l", 429), 429, "gmail_rate_limited"], [new GmailHttpError("l", 403, ["rateLimitExceeded"]), 429, "gmail_rate_limited"],
    [new GmailHttpError("l", 403, ["insufficientPermissions"]), 403, "scope_missing"], [new GmailHttpError("l", 401), 409, "reauth_required"],
    [new GmailHttpError("l", 500), 502, "gmail_upstream"], [new DOMException("t", "TimeoutError"), 502, "gmail_upstream"]];
  for (const [e, status, code] of cases) {
    const r = await call(fake({ list: () => Promise.reject(e) }).d, req("preview", mail()));
    assertEquals([r.status, await r.json()], [status, { error: code }]);
  }
});

Deno.test("MAIL_ACTIONS off: preview and execute 503 disabled; undo and status still work", async () => {
  const { d } = fake({ enabled: false });
  assertEquals((await call(d, req("preview", mail()))).status, 503);
  assertEquals((await call(d, req("execute", { token: TOKEN }))).status, 503);
  assertEquals((await call(d, req("undo", { id: TOKEN }))).status, 202);
  assertEquals((await call(d, req("status?id=" + TOKEN))).status, 200);
});

Deno.test("execute: started → 202 + one kick; same token again → 200 current, no kick; not_found 404; expired 410; bad token 400; no scope 403 before start", async () => {
  const s = fake();
  const r = await call(s.d, req("execute", { token: TOKEN }));
  assertEquals([r.status, await r.json(), s.calls.kicks], [202, C("pending"), 1]);
  const c = fake({ start: { result: "current", ...C("running", { done: 1 }) } });
  const r2 = await call(c.d, req("execute", { token: TOKEN }));
  assertEquals([r2.status, (await r2.json()).status, c.calls.kicks], [200, "running", 0]);
  assertEquals((await call(fake({ start: { result: "not_found" } }).d, req("execute", { token: TOKEN }))).status, 404);
  const e = await call(fake({ start: { result: "expired" } }).d, req("execute", { token: TOKEN }));
  assertEquals([e.status, await e.json()], [410, { error: "token_expired" }]);
  assertEquals((await call(s.d, req("execute", { token: "not-a-uuid", ids: ["x"] }))).status, 400);
  const ns = fake({ conn: { scopes: [RO] } });
  assertEquals([(await call(ns.d, req("execute", { token: TOKEN }))).status, ns.calls.starts.length], [403, 0]);
});

Deno.test("undo: started 202 + kick; current 200; busy 409 with counts; nothing_to_undo 409; expired and not_found 410 undo_expired; bad id 400", async () => {
  const s = fake();
  assertEquals([(await call(s.d, req("undo", { id: TOKEN }))).status, s.calls.kicks], [202, 1]);
  assertEquals((await call(fake({ undo: { result: "current", ...C("undone") } }).d, req("undo", { id: TOKEN }))).status, 200);
  const b = await call(fake({ undo: { result: "busy", ...C("running") } }).d, req("undo", { id: TOKEN }));
  assertEquals([b.status, (await b.json()).error], [409, "busy"]);
  const n = await call(fake({ undo: { result: "nothing_to_undo", ...C("failed") } }).d, req("undo", { id: TOKEN }));
  assertEquals([n.status, await n.json()], [409, { error: "nothing_to_undo" }]);
  for (const result of ["expired", "not_found"]) {
    const x = await call(fake({ undo: { result } }).d, req("undo", { id: TOKEN }));
    assertEquals([x.status, await x.json()], [410, { error: "undo_expired" }]);
  }
  assertEquals((await call(s.d, req("undo", { id: "x" }))).status, 400);
});

Deno.test("status: GET → counts with exactly the contract keys; unknown 404; bad id 400; POST 405", async () => {
  const j = await (await call(fake({ status: C("partial", { done: 2, failed: 1, method: "single" }) }).d, req("status?id=" + TOKEN))).json();
  assertEquals(Object.keys(j).sort(), ["code", "done", "failed", "id", "method", "status", "total", "undo_failed", "undone"]);
  assertEquals([j.status, j.done, j.failed, j.method], ["partial", 2, 1, "single"]);
  assertEquals((await call(fake({ status: null }).d, req("status?id=" + TOKEN))).status, 404);
  assertEquals((await call(fake().d, req("status?id=abc"))).status, 400);
  assertEquals((await call(fake().d, req("status?id=" + TOKEN, {}))).status, 405);
});

Deno.test("privacy: preview logs carry stage, result, counts and ms — never sender, subject, query or ids", async () => {
  const { d } = fake();
  const { lines } = await quiet(() => handleMailAction(req("preview", mail({ subject_words: ["주문"] })), d));
  const text = lines.join("\n");
  assert(lines.length >= 1);
  for (const bad of ["합성상점", "합성 광고", "주문", "from:", "\"a\""]) assert(!text.includes(bad), bad);
});

Deno.test("sampleOf: display name, else address; subject clipped to 100; no headers → empty strings", () => {
  assertEquals(sampleOf(mk("x", "shop@example.com", "y".repeat(150))).from, "shop@example.com");
  assertEquals(sampleOf(mk("x", "합성상점 <shop@example.com>", "y".repeat(150))).subject.length, 100);
  assertEquals(sampleOf({ id: "x", internalDate: "0" }), { from: "", subject: "", date: new Date(0).toISOString() });
});
```

- [ ] **Step 2: 실패 확인**

Run: `deno test --allow-read --allow-env supabase/tests/mail-action.test.ts`
Expected: FAIL — `functions/mail-action/handler.ts` 없음.

- [ ] **Step 3: 구현**

`supabase/functions/mail-action/handler.ts`:

```ts
import { classifyGmailError, GMAIL_MODIFY_SCOPE, GmailHttpError, type GmailMailApi, type GmailMessage, header } from "../_shared/gmail.ts";
import { buildQuery, checkConditions } from "../_shared/mail-query.ts";
import { parseFrom } from "../_shared/unsub.ts";

// 메일 정리(스펙 §7 "메일 정리"): POST /mail-action/preview·/execute·/undo, GET /mail-action/status?id=. 사용자 JWT 로만 user_id 를 정한다(§12 통제 4).
// 미리보기 글(발신자·제목·날짜)과 conditions 는 응답으로만 앱에 간다 — 저장·로그 없음. 로그는 단계·결과 코드·개수·ms 만.
// 실행·되돌리기는 늘 워커 잡(mail_action_start·undo 가 한 트랜잭션으로 상태와 잡을 넣는다) — 이 함수는 Gmail 을 바꾸지 않는다
export type Counts = { id: string; status: string; total: number; done: number; failed: number; undone: number; undo_failed: number; code: string | null; method: string | null };
export type RowResult = { result: string } & Partial<Counts>;
export type MailConnection = { connection_id: string; account_ref: string; status: string; scopes: string[] | null };
export type MailActionDeps = {
  enabled(): boolean;                                                  // MAIL_ACTIONS=on (꺼지면 preview·execute 503, undo·status 는 동작)
  authUser(token: string): Promise<string | null>;
  connection(user: string): Promise<MailConnection | null>;
  accessToken(user: string, conn: string): Promise<string | null>;    // null = 토큰 없음·invalid_grant(연결은 reauth_required 로 표시됨)
  api(accessToken: string): Pick<GmailMailApi, "list" | "headers">;
  noteUnits(user: string, units: number): Promise<void>;               // 호출 전 기록(fail-open)
  createRow(user: string, conn: string, action: string, ids: string[]): Promise<string | null>;
  start(user: string, id: string): Promise<RowResult>;
  undo(user: string, id: string): Promise<RowResult>;
  status(user: string, id: string): Promise<Counts | null>;
  kick(): void;
};
export const PREVIEW_MAX = 1000, PAGE_SIZE = 500, PAGE_CAP = 5, SAMPLE = 20, SAMPLE_PARALLEL = 5;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COUNT_KEYS = ["id", "status", "total", "done", "failed", "undone", "undo_failed", "code", "method"] as const;
const err = (status: number, code: string, extra: Record<string, unknown> = {}) => Response.json({ error: code, ...extra }, { status });
const log = (o: Record<string, unknown>) => console.log(JSON.stringify({ mail_action: o.stage, ...o }));
const counts = (r: Partial<Counts>) => Object.fromEntries(COUNT_KEYS.map((k) => [k, r[k] ?? null]));

export function sampleOf(m: GmailMessage) {
  const f = parseFrom(header(m, "From"));
  return { from: (f?.name || f?.address || "").slice(0, 60), subject: (header(m, "Subject") ?? "").slice(0, 100),
           date: new Date(Number(m.internalDate)).toISOString() };
}
type Sample = ReturnType<typeof sampleOf>;

export async function handleMailAction(req: Request, d: MailActionDeps): Promise<Response> {
  const t0 = performance.now();
  const url = new URL(req.url);
  const route = url.pathname.match(/\/mail-action\/(preview|execute|undo|status)\/?$/)?.[1];
  const token = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  const user = token ? await d.authUser(token) : null;
  if (!user) return new Response(null, { status: 401 });
  if (!route) return err(404, "not_found");
  try {
    if (route === "status") {
      if (req.method !== "GET") return new Response(null, { status: 405 });
      const id = url.searchParams.get("id") ?? "";
      if (!UUID.test(id)) return err(400, "bad_id");
      const s = await d.status(user, id);
      return s ? Response.json(counts(s)) : err(404, "not_found");
    }
    if (req.method !== "POST") return new Response(null, { status: 405 });
    if ((route === "preview" || route === "execute") && !d.enabled()) return err(503, "disabled");
    let body: unknown;
    try { body = await req.json(); } catch { return err(400, "bad_json"); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return err(400, "bad_json");
    const conn = await d.connection(user);
    if (!conn) return err(404, "no_connection");
    if (!(conn.scopes ?? []).includes(GMAIL_MODIFY_SCOPE)) { log({ stage: route, result: "scope_missing" }); return err(403, "scope_missing"); }
    const b = body as Record<string, unknown>;
    if (route === "preview") return await preview(user, conn, b, d, t0);
    return await startRow(user, route === "execute" ? b.token : b.id, d, route === "execute" ? "execute" : "undo");
  } catch (e) {
    if (e instanceof GmailHttpError || (e instanceof Error && e.name === "TimeoutError")) {
      const k = classifyGmailError(e);
      const [status, code]: [number, string] = k === "quota" ? [429, "gmail_rate_limited"] : k === "scope" ? [403, "scope_missing"]
        : e instanceof GmailHttpError && e.status === 401 ? [409, "reauth_required"] : [502, "gmail_upstream"];
      log({ stage: route, result: code, google_status: e instanceof GmailHttpError ? e.status : "timeout" });
      return err(status, code);
    }
    log({ stage: route, result: "internal", error: e instanceof Error ? e.name : "unknown" });   // 메시지는 남기지 않는다
    return err(500, "internal");
  }
}

async function preview(user: string, conn: MailConnection, body: Record<string, unknown>, d: MailActionDeps, t0: number): Promise<Response> {
  if (conn.status !== "active") return err(409, "reauth_required");
  const chk = checkConditions(body);                                   // 앱이 보낸 칸도 믿지 않는다 — 검사·정제는 여기 한 곳
  if (!chk.ok) {
    log({ stage: "preview", result: chk.code });
    return chk.code === "needs_target" ? err(400, "needs_target") : err(400, "bad_condition", { fields: chk.fields });
  }
  const at = await d.accessToken(user, conn.connection_id);
  if (!at) { log({ stage: "preview", result: "reauth_required" }); return err(409, "reauth_required"); }
  const api = d.api(at), c = chk.c, q = buildQuery(c);
  const ids: string[] = [], seen = new Set<string>();
  let pageToken: string | undefined, pages = 0, estimate = 0, complete = false;
  do {
    await d.noteUnits(user, 5);
    const p = await api.list(q, PAGE_SIZE, pageToken);
    if (pages++ === 0) estimate = p.resultSizeEstimate ?? 0;
    let dropped = false;
    for (const m of p.messages ?? []) {
      if (seen.has(m.id)) continue;
      if (ids.length >= PREVIEW_MAX) { dropped = true; break; }
      seen.add(m.id); ids.push(m.id);
    }
    pageToken = p.nextPageToken;
    complete = !pageToken && !dropped;
  } while (pageToken && ids.length < PREVIEW_MAX && pages < PAGE_CAP);
  await d.noteUnits(user, 5);
  const starred = (await api.list(buildQuery(c, true), 1)).resultSizeEstimate ?? 0;   // 별표 수도 추정치("별표 약 M건")
  const head = ids.slice(0, SAMPLE);
  if (head.length) await d.noteUnits(user, 20 * head.length);
  const sample = await samples(api, head);
  const base = { action: c.action, conditions: c, count: ids.length, exact: complete,
    total_estimate: complete ? ids.length : Math.max(estimate, ids.length), starred_estimate: starred, has_more: !complete, sample };
  const ms = Math.round(performance.now() - t0);
  if (ids.length === 0) { log({ stage: "preview", result: "empty", pages, ms }); return Response.json({ token: null, ...base }); }
  const id = await d.createRow(user, conn.connection_id, c.action, ids);
  if (!id) return err(404, "no_connection");                           // 연결이 그사이 지워졌다
  log({ stage: "preview", result: "ok", count: ids.length, exact: complete, pages, ms });
  return Response.json({ token: id, ...base });
}

async function samples(api: Pick<GmailMailApi, "headers">, ids: string[]): Promise<Sample[]> {
  const out: (Sample | null)[] = ids.map(() => null);
  for (let i = 0; i < ids.length; i += SAMPLE_PARALLEL) {
    await Promise.all(ids.slice(i, i + SAMPLE_PARALLEL).map(async (id, k) => {
      try { out[i + k] = sampleOf(await api.headers(id)); }
      catch (e) { if (!(e instanceof GmailHttpError && e.status === 404)) throw e; }   // 그사이 지워진 표본만 뺀다
    }));
  }
  return out.filter((x): x is Sample => x !== null);
}

async function startRow(user: string, raw: unknown, d: MailActionDeps, stage: "execute" | "undo"): Promise<Response> {
  const id = typeof raw === "string" && UUID.test(raw) ? raw : null;   // 저장된 id 만 실행한다 — 요청의 다른 칸(ids·검색어)은 읽지 않는다
  if (!id) return err(400, stage === "execute" ? "bad_token" : "bad_id");
  const r = stage === "execute" ? await d.start(user, id) : await d.undo(user, id);
  log({ stage, result: r.result, status: r.status ?? null, total: r.total ?? null });
  switch (r.result) {
    case "started": d.kick(); return Response.json(counts(r), { status: 202 });
    case "current": return Response.json(counts(r));
    case "busy": return err(409, "busy", counts(r));
    case "nothing_to_undo": return err(409, "nothing_to_undo");
    case "expired": return err(410, stage === "execute" ? "token_expired" : "undo_expired");
    case "not_found": return stage === "execute" ? err(404, "not_found") : err(410, "undo_expired");   // 정리된 행과 가를 수 없다(D3)
    default: return err(500, "internal");
  }
}
```

`supabase/functions/mail-action/deps.ts`:

```ts
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { gmailMailApi, refreshAccessToken } from "../_shared/gmail.ts";
import { gmailAccessToken, noteGmailUnits } from "../_shared/gmail-jobs.ts";
import { kickInBackground } from "../_shared/kick-worker.ts";
import type { Counts, MailActionDeps, MailConnection, RowResult } from "./handler.ts";

// service role. 모든 RPC 에 user_id 를 넘긴다(스펙 §12 통제 4). 행·연결은 그 user_id 로만 찾는다
export function mailActionDeps(sb: SupabaseClient): MailActionDeps {
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await sb.rpc(fn, args);
    if (error) throw new Error(fn + " " + (error.code ?? "error"));
    return data;
  };
  return {
    enabled: () => Deno.env.get("MAIL_ACTIONS") === "on",
    authUser: async (t) => { const { data, error } = await sb.auth.getUser(t); return error ? null : data.user?.id ?? null; },
    connection: async (u) => ((await rpc("mail_connection", { p_user: u })) as MailConnection[] | null)?.[0] ?? null,
    accessToken: (u, c) => gmailAccessToken(sb, refreshAccessToken, u, c),
    api: gmailMailApi,
    noteUnits: async (u, n) => { await noteGmailUnits(sb, u, n); },
    createRow: async (u, c, a, ids) => (await rpc("mail_action_preview", { p_user: u, p_connection: c, p_action: a, p_ids: ids })) as string | null,
    start: async (u, id) => (await rpc("mail_action_start", { p_user: u, p_id: id })) as RowResult,
    undo: async (u, id) => (await rpc("mail_action_undo", { p_user: u, p_id: id })) as RowResult,
    status: async (u, id) => (await rpc("mail_action_status", { p_user: u, p_id: id })) as Counts | null,
    kick: () => { kickInBackground(); },
  };
}
```

`supabase/functions/mail-action/index.ts`:

```ts
import { createClient } from "npm:@supabase/supabase-js@2";
import { SERVER_AUTH } from "../_shared/crypto.ts";
import { mailActionDeps } from "./deps.ts";
import { handleMailAction } from "./handler.ts";

// 메일 정리(스펙 §7). 사용자 JWT 함수(config.toml 기본 verify_jwt = true). service role 키는 RPC 에만 쓴다
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, SERVER_AUTH);
const deps = mailActionDeps(sb);
Deno.serve((req) => handleMailAction(req, deps));
```

- [ ] **Step 4: 통과 확인**

Run: `deno test --allow-read --allow-env supabase/tests/mail-action.test.ts && deno check supabase/functions/mail-action/index.ts`
Expected: 15 passed, 0 failed, check 무오류.

- [ ] **Step 5: 커밋**

```bash
git add supabase/functions/mail-action supabase/tests/mail-action.test.ts
git commit -m "feat(server): mail-action function — preview checks permission and conditions first (bad_condition/needs_target never list), builds the query server-side, collects up to 1,000 ids over at most 5 pages of 500, estimates starred, reads 20 From/Subject headers and creates the token row (none when empty); execute/undo only start the stored row's job (202, same token → 200 current); status returns counts and method; MAIL_ACTIONS off blocks preview/execute only; logs carry codes and counts only

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task M6: `gmail-connect` 권한 업데이트(`upgrade`) + 일반 경로 `scopes` 기록

**Files:**
- Modify: `supabase/functions/gmail-connect/handler.ts:1-2`(import), `:13-20`(`ConnectDeps.refresh`), `:44-46`(본문·분기), `:74-75`(저장 직후 scopes), 파일 끝(`handleUpgrade`)
- Modify: `supabase/functions/gmail-connect/index.ts`(`refresh: refreshAccessToken`)
- Modify: `supabase/tests/gmail.test.ts:222-250`(가짜 deps 옵션), `:267-279`(rpc 순서 기대), 새 테스트 5개

**Interfaces:**
- Consumes: M2 `GMAIL_MODIFY_SCOPE`, `refreshAccessToken`, M3 RPC `mail_connection`·`gmail_replace_token`·`gmail_set_scopes`.
- Produces: 요청 `{code, upgrade?: boolean}`, 응답(D12) — M9 `GmailConnect.upgrade()`·M10 스모크가 쓴다. `ConnectDeps.refresh`.

- [ ] **Step 1: 가짜 deps 옵션과 실패하는 테스트**

`supabase/tests/gmail.test.ts`의 `connectDeps`(222행~)를 바꾼다 — 옵션 타입에 `account?: string; refreshFails?: boolean; replaceError?: string; mailConn?: null; exchangeFails?: boolean; scopesError?: string`를 더하고:

```ts
    exchange: async (code) => { calls.push("exchange:" + code); if (o.exchangeFails) throw new Error("token exchange 400 invalid_grant");
      return { access_token: "at", refresh_token: o.refreshToken === undefined ? "rt" : o.refreshToken ?? undefined,
      expires_in: 3600, scope: o.scope ?? `openid ${GMAIL_SCOPE} https://www.googleapis.com/auth/userinfo.email` }; },
    refresh: async (t) => { calls.push("refresh:" + t); if (o.refreshFails) throw new Error("token refresh 400"); return "at2"; },
```

`profile`의 반환을 `{ emailAddress: o.account ?? "poc@example.com", historyId: "400" }`로, `rpc` 안 `if (o.rpcThrows) …` 다음에 넣는다:

```ts
      if (fn === "mail_connection") return Promise.resolve({ data: o.mailConn === null ? [] : [{ connection_id: CONN, account_ref: "poc@example.com", status: "active", scopes: [GMAIL_SCOPE] }], error: null });
      if (fn === "gmail_replace_token") return Promise.resolve(o.replaceError ? { data: null, error: { code: o.replaceError } } : { data: true, error: null });
      if (fn === "gmail_set_scopes" && o.scopesError) return Promise.resolve({ data: null, error: { code: o.scopesError } });
```

기존 happy-path 테스트(267행)의 기대 두 줄을 바꾼다 — 저장 직후 `gmail_set_scopes`가 들어간다:

```ts
  assertEquals(rpcCalls.map((c) => c.fn), ["gmail_save_connection", "gmail_set_scopes", "gmail_update", "enqueue_job", "enqueue_job", "gmail_enqueue_for_account"]);
  …
  assertEquals([rpcCalls[3].args.p_lease_key, rpcCalls[3].args.p_payload], ["backfill:" + USER, { connection_id: CONN, ids: ["m1", "m2"], backfill: true }]);
```

`gmail-connect: unexpected exception` 테스트 다음에 더한다:

```ts
// ── 권한 업데이트(upgrade, 스펙 §7, 계획 D12): 어떤 실패에서도 revoke 0회, 연결·vault·커서·잡 불변 ──
const MODIFY = "https://www.googleapis.com/auth/gmail.modify";
const UP_SCOPE = `openid ${GMAIL_SCOPE} ${MODIFY}`;
const upReq = (code = "up-code", upgrade: unknown = true) => connectReq({ code, upgrade });
const WRITES = ["gmail_save_connection", "gmail_update", "enqueue_job", "gmail_enqueue_for_account", "gmail_set_scopes"];
const noWrites = (rpcCalls: { fn: string }[]) => assertEquals(rpcCalls.filter((c) => WRITES.includes(c.fn)).map((c) => c.fn), []);

Deno.test("gmail-connect upgrade: same account + refresh token + modify → verify once → gmail_replace_token; no watch, no backfill, no revoke", async () => {
  const c = connectDeps({ scope: UP_SCOPE });
  const r = await handleConnect(upReq(), c.d);
  assertEquals([r.status, await r.json()], [200, { connection_id: CONN, refresh_token_stored: true, upgraded: true }]);
  assertEquals(c.calls, ["exchange:up-code", "profile", "refresh:rt"]);
  assertEquals(c.rpcCalls.map((x) => x.fn), ["mail_connection", "gmail_replace_token"]);
  assertEquals(c.rpcCalls[1].args, { p_user: USER, p_connection: CONN, p_refresh_token: "rt", p_scopes: ["openid", GMAIL_SCOPE, MODIFY] });
  assertEquals(c.revoked, []);
});

Deno.test("gmail-connect upgrade failures never revoke and never write: mismatch 409, no token 200 false, no modify 403, verify 502, replace 500, no connection 404, exchange 502, profile 401", async () => {
  const cases: [Parameters<typeof connectDeps>[0], number, unknown][] = [
    [{ scope: UP_SCOPE, account: "other@example.com" }, 409, { error: "account_mismatch" }],
    [{ scope: UP_SCOPE, refreshToken: null }, 200, { connection_id: CONN, refresh_token_stored: false, upgraded: false }],
    [{}, 403, { error: "gmail_scope_missing" }],
    [{ scope: UP_SCOPE, refreshFails: true }, 502, { error: "token_verify_failed" }],
    [{ scope: UP_SCOPE, replaceError: "XX000" }, 500, { error: "replace_failed" }],
    [{ scope: UP_SCOPE, mailConn: null }, 404, { error: "no_connection" }],
    [{ scope: UP_SCOPE, exchangeFails: true }, 502, { error: "token_exchange_failed" }],
    [{ scope: UP_SCOPE, fail: { stage: "profile", status: 401 } }, 401, { error: "gmail_unauthorized" }],
  ];
  for (const [o, status, body] of cases) {
    const c = connectDeps(o);
    const r = await handleConnect(upReq(), c.d);
    assertEquals([r.status, await r.json()], [status, body], JSON.stringify(o));
    assertEquals(c.revoked, [], JSON.stringify(o));
    noWrites(c.rpcCalls);
    assertEquals(c.rpcCalls.filter((x) => x.fn === "gmail_replace_token").length, status === 500 ? 1 : 0);
    assert(!c.calls.some((x) => x === "watch" || x.startsWith("list:")));
  }
});

Deno.test("gmail-connect upgrade: account comparison ignores case; an unexpected rpc throw → 500 without revoke", async () => {
  const c = connectDeps({ scope: UP_SCOPE, account: "POC@Example.com" });
  assertEquals((await handleConnect(upReq(), c.d)).status, 200);
  const t = connectDeps({ scope: UP_SCOPE, rpcThrows: true });
  const r = await handleConnect(upReq(), t.d);
  assertEquals([r.status, t.revoked], [500, []]);
});

Deno.test("gmail-connect: upgrade must be a boolean — malformed is 400 and never falls into a normal connect; false is a normal connect", async () => {
  const c = connectDeps({ scope: UP_SCOPE });
  for (const v of ["true", 1, "yes", null]) {
    const r = await handleConnect(upReq("c", v), c.d);
    assertEquals([r.status, await r.json()], [400, { error: "bad_upgrade" }], String(v));
  }
  assertEquals([c.calls, c.rpcCalls], [[], []]);
  const n = connectDeps();
  assertEquals((await handleConnect(upReq("c", false), n.d)).status, 200);
  assertEquals(n.rpcCalls[0].fn, "gmail_save_connection");
});

Deno.test("gmail-connect normal path records granted scopes right after save; a failed scopes write still connects", async () => {
  const c = connectDeps({ scope: UP_SCOPE });
  assertEquals((await handleConnect(connectReq({ code: "c" }), c.d)).status, 200);
  assertEquals(c.rpcCalls[1], { fn: "gmail_set_scopes", args: { p_user: USER, p_connection: CONN, p_scopes: ["openid", GMAIL_SCOPE, MODIFY] } });
  const f = connectDeps({ scopesError: "42883" });
  assertEquals((await handleConnect(connectReq({ code: "c" }), f.d)).status, 200);
});
```

- [ ] **Step 2: 실패 확인**

Run: `deno test --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/tests/gmail.test.ts --filter "$LOCAL_FILTER"`
Expected: FAIL — 타입 오류(`ConnectDeps`에 `refresh` 없음) 또는 새 테스트·바뀐 순서 기대 실패.

- [ ] **Step 3: 구현**

`supabase/functions/gmail-connect/handler.ts`:

(a) 2행 import에 `GMAIL_MODIFY_SCOPE`를 더한다.

(b) `ConnectDeps`에 `refresh(refreshToken: string): Promise<string>;   // 권한 업데이트: 새 토큰으로 갱신 1회 확인(D12)`을 더한다.

(c) 44~46행을 바꾼다:

```ts
    let body: { code?: unknown; upgrade?: unknown };
    try { body = await req.json(); } catch { return err(400, "bad_json"); }
    if (typeof body.code !== "string" || body.code.length === 0) return err(400, "missing_code");
    // upgrade 는 불리언만 — 형식이 틀린 요청이 일반 연결(커서 덮기·백필)로 흘러가지 않게(D12)
    if (body.upgrade !== undefined && typeof body.upgrade !== "boolean") return err(400, "bad_upgrade");
    if (body.upgrade === true) return await handleUpgrade(user, body.code, deps, log);
```

(d) `const connId = saved.data as string;` 다음 줄에 더한다:

```ts
    // 승인 scope 기록(스펙 §8 connections.scopes, 0.14.0). 실패해도 연결은 성공 — readonly 로 보여 [권한 업데이트]가 남을 뿐(D12)
    try {
      const sc = await deps.rpc.rpc("gmail_set_scopes", { p_user: user, p_connection: connId, p_scopes: (t.scope ?? "").split(/\s+/).filter(Boolean) });
      if (sc.error) log({ result: "scopes_save_failed" });
    } catch { log({ result: "scopes_save_failed" }); }
```

(e) 파일 끝에 더한다:

```ts
// 권한 업데이트(스펙 §7 "권한 업데이트", 계획 D12): 기존 연결을 그대로 두고 refresh token 만 바꾼다. 어떤 실패에서도 새 토큰을 revoke 하지 않는다 —
// revoke 는 그 토큰이 속한 승인을 철회해 같은 계정·클라이언트로 저장된 기존 토큰까지 끊을 수 있다. 실패면 메모리에서 버리기만(만료까지 Google 에 남는 1개는 수용).
// 교체가 성공하기 전에는 connections·vault·sync_states·잡을 건드리지 않는다(gmail_save_connection·watch·백필 없음)
async function handleUpgrade(user: string, code: string, deps: ConnectDeps, log: (o: Record<string, unknown>) => void): Promise<Response> {
  let stage = "upgrade_exchange";
  const out = (status: number, name: string) => { log({ result: name, upgrade_stage: stage }); return err(status, name); };
  try {
    let t: TokenResponse;
    try { t = await deps.exchange(code); } catch { return out(502, "token_exchange_failed"); }
    stage = "upgrade_connection";
    const c = await deps.rpc.rpc("mail_connection", { p_user: user });
    if (c.error) return out(500, "internal");
    const conn = (c.data as { connection_id: string; account_ref: string }[] | null)?.[0];
    if (!conn) return out(404, "no_connection");
    stage = "upgrade_profile";
    const p = await deps.api(t.access_token).profile();
    if (p.emailAddress.toLowerCase() !== conn.account_ref.toLowerCase()) return out(409, "account_mismatch");
    if (!t.refresh_token) {                                          // 이전 동의 때문에 Google 이 다시 주지 않음 → 다음 재연결 때(스펙 §7)
      log({ result: "no_refresh_token", upgrade_stage: stage });
      return Response.json({ connection_id: conn.connection_id, refresh_token_stored: false, upgraded: false });
    }
    const scopes = (t.scope ?? "").split(/\s+/).filter(Boolean);
    if (!scopes.includes(GMAIL_MODIFY_SCOPE)) return out(403, "gmail_scope_missing");
    stage = "upgrade_verify";
    try { await deps.refresh(t.refresh_token); } catch { return out(502, "token_verify_failed"); }
    stage = "upgrade_replace";
    const r = await deps.rpc.rpc("gmail_replace_token", { p_user: user, p_connection: conn.connection_id, p_refresh_token: t.refresh_token, p_scopes: scopes });
    if (r.error || r.data !== true) return out(500, "replace_failed");
    log({ result: "upgraded", upgrade_stage: stage });
    return Response.json({ connection_id: conn.connection_id, refresh_token_stored: true, upgraded: true });
  } catch (e) {
    if (e instanceof GmailHttpError) { const m = mapGmail(e); return out(m.status, m.code); }   // 연결 상태는 바꾸지 않는다(reauth 표시 없음)
    log({ result: "internal", upgrade_stage: stage, error: e instanceof Error ? e.name : "unknown" });   // 메시지는 토큰을 담을 수 있어 남기지 않는다
    return err(500, "internal");
  }
}
```

`supabase/functions/gmail-connect/index.ts`: import에 `refreshAccessToken`을 더하고 deps에 `refresh: refreshAccessToken,`을 더한다.

(`handleUpgrade`가 바깥 `try` 안에서 불리지만 `pendingRefreshToken`을 채우지 않으므로 바깥 `catch`의 `discardToken`은 아무것도 하지 않는다 — 테스트 `rpcThrows`가 확인.)

- [ ] **Step 4: 통과 확인 + `MAIL-server` 로컬 묶음**

Run: `deno test --allow-net --allow-env --allow-read --allow-write=/tmp --env-file=supabase/.env supabase/tests/gmail.test.ts supabase/tests/gmail-mail.test.ts supabase/tests/mail-query.test.ts supabase/tests/mail-sql.test.ts supabase/tests/mail-jobs.test.ts supabase/tests/units.test.ts supabase/tests/mail-action.test.ts supabase/tests/unsub-jobs.test.ts --filter "$LOCAL_FILTER" && deno check supabase/functions/{worker,mail-action,gmail-connect,chat,unsubscribe,gmail-webhook}/index.ts`
Expected: 전부 통과(호스팅 DB 사례 3개는 걸러짐), check 무오류. 통과 수를 적어 둔다.

- [ ] **Step 5: `gates.md` `MAIL-server` 행**

`docs/superpowers/phase1/gates.md` 표 끝에 더한다(상태 **대기** — 호스팅 DB 트랜잭션 테스트는 M10에서 덧붙이고 그때 통과로 바꾼다):

```
| MAIL-server | 메일 정리 서버 테스트(가짜 Gmail·PGlite, 스펙 §15): 검색어 조립·거절·범위 하한, 1,000개 다중 페이지·exact 분기, 토큰 10분·한 번만·남의 토큰, conditions 일치, TRASH 400 폴백·403 쿼터 미루기·권한 scope_missing, 같은 토큰 두 번, 중간 실패 ok/failed·되돌리기 ok만, Gmail 성공 뒤 기록 전 죽음·stale, 마지막 시도 재조회, dead 트리거, units 5,400/4,000, upgrade revoke 0·불변 | 대기 | <KST> 로컬: mail-query <n>·gmail-mail <n>·mail-sql(PGlite) <n>·mail-jobs <n>·units <n>·mail-action <n>·gmail(가짜) <n> 통과. 호스팅 트랜잭션 DB 테스트는 M10 | | <날짜> |
```

- [ ] **Step 6: 커밋**

```bash
git add supabase/functions/gmail-connect supabase/tests/gmail.test.ts docs/superpowers/phase1/gates.md
git commit -m "feat(server): gmail-connect permission update — {code, upgrade: true} keeps the connection and cursor: exchange, find the user's connection, same account (case-insensitive), refresh token present, modify granted, verify one refresh, then gmail_replace_token; every failure discards the new token in memory without revoke or any write; malformed upgrade is 400 so it never runs a normal connect; the normal path records granted scopes right after save (failure only logs); MAIL-server gate row (pending hosted DB run)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task M7: `INTENT-eval --mail-judged` (0.14.0 판정)

**Files:**
- Modify: `docs/superpowers/phase1/gates.md`(기존 `INTENT-eval` 행 근거 칸에 덧붙임)
- (실패 때만) Modify: `supabase/functions/chat/filters.ts`(`MAIL_SCHEMA` 칸 설명), `supabase/tests/chat.test.ts`

**Interfaces:**
- Consumes: 0.13.0 `supabase/scripts/eval-intent.ts`·`_intent-eval.ts`·`intent-cases.json`(69 — `mail_action` 15, 정답 `mail` 칸).
- Produces: `INTENT-eval` mail 판정(M10 `MAIL_ACTIONS=on`의 선행 조건).

- [ ] **Step 1: 창 확인**

메인이 원장 최신 `status.t0`로 지금이 10-07·10-08 14:30~16:30 KST 창 밖이고 그날이면 13:45 전 시작인지 확인한다. 아니면 기다린다.

Run: `git log --oneline -1 -- supabase/functions/chat supabase/eval/intent-cases.json && grep -n 'INTENT-eval' docs/superpowers/phase1/gates.md`
Expected: 0.13.0 A2·A3 기록(`INTENT-eval` 통과)이 있다. 없으면 멈춘다(이 판정은 0.13.0 기준선 위에서만 뜻이 있다).

- [ ] **Step 2: 실행**

Run: `deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/eval-intent.ts --runs 3 --mail-judged | tee "$TMPDIR/intent-mail.log" | tail -3`
Expected: 마지막 줄 판정 JSON — **오탐 0**(3회 전체), `add_event`·`mail_action` 재현율 각 ≥ 90%, 두 행동 혼동 0, `mail` 칸 일치 ≥ 90%(`--mail-judged`), `"gate":"pass"`. 출력은 사례 id·의도·불리언·비율만(문장 없음 — 0.13.0 러너 계약).

- [ ] **Step 3: 실패하면(U9, 최대 2회)**

칸 일치만 못 넘으면 `$TMPDIR/intent-mail.log`에서 실패 사례 id와 틀린 칸 이름만 본다(문장은 보지 않아도 된다 — `supabase/eval/intent-cases.json`의 합성 문장을 읽는 것은 허용). 가장 많이 틀린 칸(예: 받은 기간·제목 단어)의 `MAIL_SCHEMA` `description`을 한 문장 고치고(예: "제목 단어는 사용자가 따옴표나 '제목에'로 말한 단어만, 조사·어미 없이"), `deno test --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/tests/chat.test.ts`(바이트 동일 테스트 포함 — `intents` 없는 요청은 `MAIL_SCHEMA`를 쓰지 않으므로 그대로 통과해야 한다)를 통과시킨 뒤 Step 2를 다시 한다. 오탐·재현율이 깨지면 고친 문장을 되돌린다. 2회 뒤에도 실패면 멈추고 메인이 사용자에게 보고한다(U9 대안). 고쳤으면 `chat`을 0.13.0 A3 Step과 같은 방식(배포본 기준선 확인 → 배포 → 다운로드 대조 → `smoke-chat` 두 번)으로 다시 배포한다 — chat 배포는 측정과 무관하다.

- [ ] **Step 4: 기록·커밋**

`docs/superpowers/phase1/gates.md`의 `INTENT-eval` 행 근거 칸 끝에 덧붙인다: `· 0.14.0 mail 판정 <KST>: 3회 오탐 0, add_event <x>%, mail_action <x>%, 혼동 0, mail 칸 일치 <x>%(≥90%) — <MAIL_SCHEMA 수정 없음|수정 1문장·chat 재배포 v<n>>`.

```bash
git add docs/superpowers/phase1/gates.md   # Step 3 에서 고쳤으면 supabase/functions/chat/filters.ts supabase/tests/chat.test.ts 도
git commit -m "docs(gates): INTENT-eval mail fields judged for 0.14.0 — three runs, no false actions, recall and mail-field match recorded

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task M8: EruriCore — 메일 정리 해석·문구·대화 기록

**Files:**
- Create: `ios/Packages/EruriCore/Sources/EruriCore/MailCleanup.swift`(`MailCleanup`·`MailCleanupText`·`MailTurn`·`JSONValue.foundation`)
- Test: `ios/Packages/EruriCore/Tests/EruriCoreTests/MailCleanupTests.swift`
- Modify: `ios/Packages/EruriCore/Sources/EruriCore/ChatHistory.swift`(Kind·`mail`·init·`restored`)
- Modify: `ios/Packages/EruriCore/Sources/EruriCore/ChatReply.swift`(`Answer.mail`)
- Modify: `ios/Packages/EruriCore/Sources/EruriCore/ChatAddEvent.swift`(`intents`)
- Test: `ChatHistoryTests.swift`·`ChatReplyTests.swift`·`ChatAddEventTests.swift`에 사례 추가

**Interfaces:**
- Consumes: 0.13.0 `ChatHistory.Kind`(`question, link, image, addEvent`)·`Record`(`kind` var, `itemID`)·`ChatReply.Answer.intent`·`ChatAddEvent.intents`, `JSONValue`(F20), M5 HTTP 계약(응답 JSON 모양).
- Produces(M9가 쓴다): `MailCleanup.intent`·`modifyScope`·`tokenTTL`·`undoTTL`·`pollInterval`·`pollLimit`·`isMailAction(_:)`·`Conditions`(`json`)·`Sample`·`Preview`·`Status`(`finished`·`undoPhase`)·`preview(_:)`·`status(_:)`·`errorCode(_:)`·`Note`·`previewError(status:code:)`·`executeError(status:code:)`·`undoError(status:code:action:)`·`conditionLine(_:)`·`countLine(_:)`·`sampleLine(_:)`·`moreLine(_:)`·`grouped(_:)`·`progress(_:action:)`·`result(_:action:)`·`canUndo(_:previewAt:now:)`·`isTokenExpired(previewAt:now:)`·`showNext(_:_:)`, `MailCleanupText.*`, `MailTurn`(`Phase`·`apply(_:)`), `ChatHistory.Kind.mailAction`, `Record.mail: MailTurn?`, `ChatReply.Answer.mail: JSONValue?`, `JSONValue.foundation`. 커밋 메시지는 `feat(core): mail cleanup`으로 시작한다(D17·M0 Step 6).

- [ ] **Step 1: 실패하는 테스트**

`ios/Packages/EruriCore/Tests/EruriCoreTests/MailCleanupTests.swift`:

```swift
import XCTest
@testable import EruriCore

/// 채팅 메일 정리(스펙 §7·§9, 0.14.0): 서버 응답 해석·조건 줄·건수·문구·시간 창
final class MailCleanupTests: XCTestCase {
  let previewJSON = #"""
  {"token":"11111111-1111-4111-8111-111111111111","action":"trash",
   "conditions":{"action":"trash","sender":"합성상점","subject_words":[],"received_from":"2026-09-01","received_to":"2026-09-30","promotions":true,"unread_only":false},
   "count":1000,"exact":false,"total_estimate":1234,"starred_estimate":3,"has_more":true,
   "sample":[{"from":"합성상점","subject":"합성 광고 1","date":"2026-09-30T15:30:00.000Z"}]}
  """#
  let t0 = Date(timeIntervalSince1970: 1_790_000_000)
  func p(_ s: String) -> MailCleanup.Preview { MailCleanup.preview(Data(s.utf8))! }
  func st(_ status: String, total: Int = 3, done: Int = 0, failed: Int = 0, undone: Int = 0, undoFailed: Int = 0, code: String? = nil) -> MailCleanup.Status {
    MailCleanup.Status(id: "x", status: status, total: total, done: done, failed: failed, undone: undone, undo_failed: undoFailed, code: code, method: nil)
  }

  func testDecodesPreviewStatusAndErrorCode() {
    let v = p(previewJSON)
    XCTAssertEqual([v.token, v.action], ["11111111-1111-4111-8111-111111111111", "trash"])
    XCTAssertEqual([v.count, v.total_estimate, v.starred_estimate], [1000, 1234, 3])
    let empty = p(#"{"token":null,"action":"read","conditions":{"action":"read","sender":null,"subject_words":[],"received_from":null,"received_to":null,"promotions":false,"unread_only":true},"count":0,"exact":true,"total_estimate":0,"starred_estimate":0,"has_more":false,"sample":[]}"#)
    XCTAssertNil(empty.token)
    let s = MailCleanup.status(Data(#"{"id":"x","status":"partial","total":3,"done":2,"failed":1,"undone":0,"undo_failed":0,"code":null,"method":"single"}"#.utf8))!
    XCTAssertEqual([s.status, s.method], ["partial", "single"])
    XCTAssertTrue(s.finished); XCTAssertFalse(s.undoPhase)
    XCTAssertTrue(st("undo_pending").undoPhase); XCTAssertFalse(st("running").finished)
    XCTAssertEqual(MailCleanup.errorCode(Data(#"{"error":"bad_condition","fields":["received_from"]}"#.utf8)), "bad_condition")
    XCTAssertNil(MailCleanup.errorCode(Data("x".utf8)))
  }

  func testConditionLineUsesServerConfirmedFields() {
    XCTAssertEqual(MailCleanup.conditionLine(p(previewJSON).conditions), "발신자 '합성상점' · 광고 · 9/1–9/30 · 별표 제외")
    let c = MailCleanup.Conditions(action: "read", sender: nil, subject_words: ["ERURI", "테스트"], received_from: nil, received_to: "2026-10-04", promotions: false, unread_only: true)
    XCTAssertEqual(MailCleanup.conditionLine(c), "제목 'ERURI' '테스트' · 10/4까지 · 안 읽은 메일 · 별표 제외")
    let one = MailCleanup.Conditions(action: "trash", sender: nil, subject_words: [], received_from: "2026-09-01", received_to: "2026-09-01", promotions: false, unread_only: false)
    XCTAssertEqual(MailCleanup.conditionLine(one), "9/1 · 별표 제외")
    let from = MailCleanup.Conditions(action: "trash", sender: nil, subject_words: [], received_from: "2026-09-01", received_to: nil, promotions: false, unread_only: false)
    XCTAssertEqual(MailCleanup.conditionLine(from), "9/1부터 · 별표 제외")
  }

  func testCountLineExactAndEstimated() {
    XCTAssertEqual(MailCleanup.countLine(p(previewJSON)), "총 약 1,234건 중 1,000건 · 별표 약 3건 제외")
    let exact = p(previewJSON.replacingOccurrences(of: #""count":1000,"exact":false,"total_estimate":1234,"starred_estimate":3"#,
                                                   with: #""count":3,"exact":true,"total_estimate":3,"starred_estimate":0"#))
    XCTAssertEqual(MailCleanup.countLine(exact), "3건")
  }

  func testSampleAndMoreLinesUseSeoulDates() {
    let v = p(previewJSON)
    XCTAssertEqual(MailCleanup.sampleLine(v.sample[0]), "합성상점 · 합성 광고 1 · 10/1")            // 15:30Z = 서울 다음 날 00:30
    XCTAssertEqual(MailCleanup.sampleLine(MailCleanup.Sample(from: "", subject: "", date: "2026-10-05T01:00:00Z")), "(보낸 사람 없음) · (제목 없음) · 10/5")
    XCTAssertEqual(MailCleanup.moreLine(v), "외 999건")
  }

  func testGrouped() {
    XCTAssertEqual([0, 999, 1000, 1_234_567].map(MailCleanup.grouped), ["0", "999", "1,000", "1,234,567"])
  }

  func testErrorNotes() {
    XCTAssertEqual(MailCleanup.previewError(status: 403, code: "scope_missing"), MailCleanup.Note(MailCleanupText.scopeMissing, settings: true))
    XCTAssertEqual(MailCleanup.previewError(status: 404, code: "no_connection").text, MailCleanupText.noConnection)
    XCTAssertEqual(MailCleanup.previewError(status: 400, code: "needs_target").text, MailCleanupText.needsTarget)
    XCTAssertEqual(MailCleanup.previewError(status: 400, code: "bad_condition").text, MailCleanupText.badCondition)
    XCTAssertEqual(MailCleanup.previewError(status: 409, code: "reauth_required"), MailCleanup.Note(MailCleanupText.reauth, settings: true))
    XCTAssertEqual(MailCleanup.previewError(status: 429, code: "gmail_rate_limited").text, MailCleanupText.busy)
    XCTAssertEqual(MailCleanup.previewError(status: 503, code: "disabled").text, MailCleanupText.disabled)
    XCTAssertEqual(MailCleanup.previewError(status: -1, code: nil).text, MailCleanupText.failed)
    XCTAssertEqual(MailCleanup.executeError(status: 410, code: "token_expired"), MailCleanup.Note(MailCleanupText.expired, repreview: true))
    XCTAssertEqual(MailCleanup.executeError(status: -1, code: nil), MailCleanup.Note(MailCleanupText.failed, retry: true))
    XCTAssertEqual(MailCleanup.undoError(status: 410, code: "undo_expired", action: "trash").text, "되돌리기 기간(7일)이 지났어요 — Gmail 휴지통에서 직접 복원할 수 있어요")
    XCTAssertEqual(MailCleanup.undoError(status: 410, code: "undo_expired", action: "read").text, "되돌리기 기간(7일)이 지났어요 — Gmail에서 직접 안 읽음으로 바꿀 수 있어요")
    XCTAssertEqual(MailCleanup.undoError(status: 409, code: "nothing_to_undo", action: "trash").text, MailCleanupText.nothingToUndo)
  }

  func testProgressAndResultTexts() {
    XCTAssertEqual(MailCleanup.progress(st("running", total: 1000, done: 400, failed: 2), action: "trash"), "휴지통으로 옮기는 중 402/1,000")
    XCTAssertEqual(MailCleanup.progress(st("pending"), action: "read"), "읽음으로 바꾸는 중 0/3")
    XCTAssertEqual(MailCleanup.progress(st("undoing", done: 3, undone: 1), action: "trash"), "되돌리는 중 1/3")
    XCTAssertEqual(MailCleanup.result(st("done", done: 3), action: "trash"), MailCleanup.Note("휴지통으로 3건 옮겼어요"))
    XCTAssertEqual(MailCleanup.result(st("partial", done: 2, failed: 1), action: "read").text, "2건을 읽음으로 바꿨어요 · 1건 실패")
    XCTAssertEqual(MailCleanup.result(st("failed", failed: 3, code: "job_dead"), action: "trash"), MailCleanup.Note("휴지통으로 옮기지 못했어요 (3건 실패)"))
    XCTAssertEqual(MailCleanup.result(st("partial", done: 1, failed: 2, code: "scope_missing"), action: "trash"),
                   MailCleanup.Note("휴지통으로 1건 옮겼어요 · 2건 실패\nGmail 권한(연결)이 바뀌어 2건을 처리하지 못했어요", settings: true))
    XCTAssertEqual(MailCleanup.result(st("failed", failed: 3, code: "no_connection"), action: "read").text,
                   "읽음으로 바꾸지 못했어요 (3건 실패)\nGmail 권한(연결)이 바뀌어 3건을 처리하지 못했어요")
    XCTAssertEqual(MailCleanup.result(st("undone", done: 3, undone: 3), action: "trash").text, "되돌렸어요")
    XCTAssertEqual(MailCleanup.result(st("undo_partial", done: 3, undone: 2, undoFailed: 1), action: "trash").text, "2건 되돌렸어요 · 1건 실패 — Gmail 휴지통에서 직접 복원할 수 있어요")
    XCTAssertEqual(MailCleanup.result(st("undo_failed", done: 3, undoFailed: 3), action: "read").text, "되돌리지 못했어요 — Gmail에서 직접 안 읽음으로 바꿀 수 있어요")
  }

  func testUndoAndTokenWindows() {
    XCTAssertTrue(MailCleanup.canUndo(st("done", done: 3), previewAt: t0, now: t0.addingTimeInterval(7 * 86_400 - 1)))
    XCTAssertFalse(MailCleanup.canUndo(st("done", done: 3), previewAt: t0, now: t0.addingTimeInterval(7 * 86_400)))
    XCTAssertTrue(MailCleanup.canUndo(st("partial", done: 1, failed: 2), previewAt: t0, now: t0))
    XCTAssertFalse(MailCleanup.canUndo(st("failed", failed: 3), previewAt: t0, now: t0))
    XCTAssertFalse(MailCleanup.canUndo(st("undone", done: 3), previewAt: t0, now: t0))
    XCTAssertFalse(MailCleanup.isTokenExpired(previewAt: t0, now: t0.addingTimeInterval(599)))
    XCTAssertTrue(MailCleanup.isTokenExpired(previewAt: t0, now: t0.addingTimeInterval(600)))
  }

  func testShowNextOnlyAfterAFinishedExecutionWithMore() {
    let v = p(previewJSON)
    XCTAssertTrue(MailCleanup.showNext(v, st("done", done: 3)))
    XCTAssertFalse(MailCleanup.showNext(v, st("running")))
    XCTAssertFalse(MailCleanup.showNext(v, st("undone", done: 3)))
    XCTAssertFalse(MailCleanup.showNext(v, nil))
  }

  func testConditionsJSONSendsNullsAndJSONValueFoundation() throws {
    let j = p(previewJSON).conditions.json
    XCTAssertTrue(JSONSerialization.isValidJSONObject(j))
    XCTAssertEqual(j["action"] as? String, "trash")
    let back = try JSONDecoder().decode(MailCleanup.Conditions.self, from: try JSONSerialization.data(withJSONObject: j))
    XCTAssertEqual(back, p(previewJSON).conditions)
    let v = try JSONDecoder().decode(JSONValue.self, from: Data(#"{"action":"trash","sender":null,"subject_words":["a"],"promotions":true}"#.utf8))
    let f = v.foundation
    XCTAssertTrue(JSONSerialization.isValidJSONObject(f))
    XCTAssertTrue((f as? [String: Any])?["sender"] is NSNull)
  }

  func testMailTurnApplyAndCopy() {
    var m = MailTurn()
    XCTAssertEqual(m.phase, .finding)
    m.apply(MailCleanup.Note(MailCleanupText.reauth, settings: true))
    XCTAssertEqual([m.note, m.settings ? "s" : "-"], [MailCleanupText.reauth, "s"])
    XCTAssertEqual(MailCleanupText.header("read"), "읽음으로 바꿀 메일")
    XCTAssertEqual(MailCleanupText.button("trash", 1000), "휴지통으로 이동 (1,000건)")
    XCTAssertEqual(MailCleanupText.upgradeResult(status: 200, body: ["upgraded": true]), MailCleanupText.upgradeDone)
    XCTAssertEqual(MailCleanupText.upgradeResult(status: 200, body: ["upgraded": false, "refresh_token_stored": false]), MailCleanupText.upgradeLater)
    XCTAssertEqual(MailCleanupText.upgradeResult(status: 409, body: [:]), MailCleanupText.upgradeMismatch)
    XCTAssertTrue(MailCleanup.isMailAction("mail_action")); XCTAssertFalse(MailCleanup.isMailAction(nil))
  }
}
```

`ChatHistoryTests.swift`에 더한다(파일의 `R`·`q`·`t0`·`tempStore()`를 쓴다):

```swift
  // ── 메일 정리 턴(0.14.0) ──
  func testRestoredEndsMailTurnsStillFinding_RunningStays() {
    let finding = R(at: t0, kind: .mailAction, question: "합성상점 광고 지워줘", mail: MailTurn(phase: .finding))
    let running = R(at: t0, kind: .mailAction, question: "합성 메일 읽음 처리해줘", mail: MailTurn(phase: .running))
    let none = R(at: t0, kind: .mailAction, question: "합성", mail: nil)
    let out = ChatHistory.restored([finding, running, none])
    XCTAssertEqual(out.map { $0.mail?.phase }, [MailTurn.Phase.ended, .running, .ended] as [MailTurn.Phase?])
    XCTAssertEqual([out[0].mail?.note, out[2].mail?.note], [MailCleanupText.interrupted, MailCleanupText.interrupted] as [String?])
  }

  func testMailTurnsKeepTheSegmentButAreNotContext() {
    let mailTurn = R(at: t0.addingTimeInterval(-300), kind: .mailAction, question: "합성상점 광고 지워줘", mail: MailTurn(phase: .ended))
    let r = [q("첫 질문", at: -600), mailTurn, q("둘째 질문", at: -60)]
    XCTAssertEqual(ChatHistory.context(r, now: t0).map(\.question), ["첫 질문", "둘째 질문"])
    XCTAssertEqual(ChatHistory.segmentStart(r, now: t0), 0)
  }

  func testStoreRoundTripsMailTurns_OldRecordsWithoutMailStillLoad() throws {
    let s = tempStore(); defer { s.wipe() }
    let pv = MailCleanup.preview(Data(#"{"token":"t","action":"trash","conditions":{"action":"trash","sender":"합성상점","subject_words":[],"received_from":null,"received_to":null,"promotions":true,"unread_only":false},"count":1,"exact":true,"total_estimate":1,"starred_estimate":0,"has_more":false,"sample":[{"from":"합성상점","subject":"합성","date":"2026-10-01T00:00:00Z"}]}"#.utf8))
    let m = R(at: t0, kind: .mailAction, question: "합성", mail: MailTurn(phase: .preview, preview: pv, previewAt: t0))
    try s.save([q("a", at: 0), m])
    XCTAssertEqual(try s.load(), [q("a", at: 0), m])
    // 0.13.0 파일(mail 키 없음)
    try Data(#"{"version":1,"records":[{"id":"6F1C2A3B-0000-4000-8000-000000000001","at":1790000000,"kind":"question","question":"q","linkDone":false,"linkSaved":false,"judged":{}}]}"#.utf8).write(to: s.url)
    XCTAssertNil(try s.load().first?.mail)
  }
```

`ChatReplyTests.swift`에 더한다:

```swift
  func testMailDecodesAsRawJSONValue_NullAndAbsentAreNil() throws {
    let base = #""answer_id":"a","answer":"","refused":false,"citations":[],"proposals":[],"candidates":[],"schedule":null"#
    let a = ChatReply.decode(Data(("{" + base + #","intent":"mail_action","mail":{"action":"trash","sender":"합성상점","subject_words":[],"received_from":null,"received_to":null,"promotions":true,"unread_only":false}}"#).utf8))!
    XCTAssertEqual(a.intent, "mail_action")
    guard case .object(let o)? = a.mail else { return XCTFail("mail") }
    XCTAssertEqual(o["sender"], .string("합성상점"))
    XCTAssertNil(ChatReply.decode(Data(("{" + base + #","intent":"question","mail":null}"#).utf8))!.mail)
    XCTAssertNil(ChatReply.decode(Data(("{" + base + "}").utf8))!.mail)
  }
```

`ChatAddEventTests.swift`의 `intents` 기대(0.13.0: `["add_event"]`)를 `["add_event", "mail_action"]`로 바꾼다(`grep -n 'intents' ios/Packages/EruriCore/Tests/EruriCoreTests/ChatAddEventTests.swift`로 찾는다 — 없으면 새 사례 `XCTAssertEqual(ChatAddEvent.intents, ["add_event", "mail_action"])`를 더한다).

- [ ] **Step 2: 실패 확인**

`pgrep -x deno`가 비었는지, `vm_stat | grep -E 'free|compressor'`를 본다.

Run: `cd ios && ./scripts/sim.sh gen && ./scripts/sim.sh test EruriCoreTests/MailCleanupTests`
Expected: 빌드 실패 — `MailCleanup`·`MailTurn` 없음.

- [ ] **Step 3: 구현 — `MailCleanup.swift`**

```swift
import Foundation

/// 채팅 메일 정리(스펙 §7 "메일 정리"·§9 "채팅 메일 정리", 앱 0.14.0): 서버 응답 해석·문구·시간 판단만. 네트워크·화면은 앱이 한다.
/// 미리보기 글(발신자·제목·날짜)은 이 기기 대화 기록에만 둔다 — DiagLog·trace 에 쓰지 않는다
public enum MailCleanup {
  public static let intent = "mail_action"
  public static let modifyScope = "https://www.googleapis.com/auth/gmail.modify"
  public static let tokenTTL: TimeInterval = 600              // 확인 토큰 10분(서버가 원본 — 410 token_expired)
  public static let undoTTL: TimeInterval = 7 * 86_400        // 되돌리기 7일(서버가 원본 — 410 undo_expired)
  public static let pollInterval: Duration = .seconds(3)
  public static let pollLimit: TimeInterval = 20 * 60         // 한 화면에서 상태를 읽는 상한(넘으면 "아직 처리 중이에요", D14)

  public static func isMailAction(_ intent: String?) -> Bool { intent == Self.intent }

  public struct Conditions: Codable, Sendable, Equatable {
    public let action: String
    public let sender: String?
    public let subject_words: [String]
    public let received_from: String?
    public let received_to: String?
    public let promotions: Bool
    public let unread_only: Bool
    /// [다시 미리보기]·[다음 1,000건 보기]의 요청 본문 — 서버가 확정한 칸 그대로(D15)
    public var json: [String: Any] {
      ["action": action, "sender": sender.map { $0 as Any } ?? NSNull(), "subject_words": subject_words,
       "received_from": received_from.map { $0 as Any } ?? NSNull(), "received_to": received_to.map { $0 as Any } ?? NSNull(),
       "promotions": promotions, "unread_only": unread_only]
    }
  }
  public struct Sample: Codable, Sendable, Equatable {
    public let from: String; public let subject: String; public let date: String
  }
  public struct Preview: Codable, Sendable, Equatable {
    public let token: String?                     // nil = 0건(행 없음)
    public let action: String
    public let conditions: Conditions
    public let count: Int
    public let exact: Bool
    public let total_estimate: Int
    public let starred_estimate: Int
    public let has_more: Bool
    public let sample: [Sample]
  }
  public struct Status: Codable, Sendable, Equatable {
    public let id: String
    public let status: String
    public let total: Int
    public let done: Int
    public let failed: Int
    public let undone: Int
    public let undo_failed: Int
    public let code: String?
    public let method: String?
    static let terminal: Set<String> = ["done", "partial", "failed", "undone", "undo_partial", "undo_failed"]
    public var finished: Bool { Self.terminal.contains(status) }
    public var undoPhase: Bool { status.hasPrefix("undo") }
  }

  public static func preview(_ d: Data) -> Preview? { try? JSONDecoder().decode(Preview.self, from: d) }
  public static func status(_ d: Data) -> Status? { try? JSONDecoder().decode(Status.self, from: d) }
  public static func errorCode(_ d: Data) -> String? { (try? JSONSerialization.jsonObject(with: d) as? [String: Any])?["error"] as? String }

  /// 화면 문구 + 버튼: [설정 열기]·[다시 미리보기]·실행 버튼 다시 켜기(같은 토큰이라 멱등)
  public struct Note: Equatable, Sendable {
    public let text: String; public let settings: Bool; public let repreview: Bool; public let retry: Bool
    public init(_ text: String, settings: Bool = false, repreview: Bool = false, retry: Bool = false) {
      self.text = text; self.settings = settings; self.repreview = repreview; self.retry = retry
    }
  }
  public static func previewError(status: Int, code: String?) -> Note {
    switch (status, code) {
    case (403, "scope_missing"?): return Note(MailCleanupText.scopeMissing, settings: true)
    case (404, "no_connection"?): return Note(MailCleanupText.noConnection)
    case (400, "needs_target"?): return Note(MailCleanupText.needsTarget)
    case (400, "bad_condition"?): return Note(MailCleanupText.badCondition)
    case (409, "reauth_required"?): return Note(MailCleanupText.reauth, settings: true)
    case (429, _): return Note(MailCleanupText.busy)
    case (503, "disabled"?): return Note(MailCleanupText.disabled)
    default: return Note(MailCleanupText.failed)
    }
  }
  public static func executeError(status: Int, code: String?) -> Note {
    switch (status, code) {
    case (410, _): return Note(MailCleanupText.expired, repreview: true)
    case (403, "scope_missing"?): return Note(MailCleanupText.scopeMissing, settings: true)
    case (404, "no_connection"?): return Note(MailCleanupText.noConnection)
    case (503, "disabled"?): return Note(MailCleanupText.disabled)
    default: return Note(MailCleanupText.failed, retry: true)
    }
  }
  public static func undoError(status: Int, code: String?, action: String) -> Note {
    switch (status, code) {
    case (410, _): return Note(MailCleanupText.undoExpired(action))
    case (409, "nothing_to_undo"?): return Note(MailCleanupText.nothingToUndo)
    case (409, "busy"?): return Note(MailCleanupText.stillRunning, retry: true)
    case (403, "scope_missing"?): return Note(MailCleanupText.scopeMissing, settings: true)
    default: return Note(MailCleanupText.failed, retry: true)
    }
  }

  /// 미리보기 카드 조건 줄 — 서버가 확정한 conditions 로만 만든다(앱이 보낸 칸을 다시 그리지 않는다, 스펙 §9)
  public static func conditionLine(_ c: Conditions) -> String {
    var parts: [String] = []
    if let s = c.sender { parts.append("발신자 '\(s)'") }
    if !c.subject_words.isEmpty { parts.append("제목 " + c.subject_words.map { "'\($0)'" }.joined(separator: " ")) }
    if c.promotions { parts.append("광고") }
    switch (c.received_from.flatMap(md), c.received_to.flatMap(md)) {
    case let (a?, b?): parts.append(a == b ? a : "\(a)–\(b)")
    case let (a?, nil): parts.append("\(a)부터")
    case let (nil, b?): parts.append("\(b)까지")
    default: break
    }
    if c.unread_only { parts.append("안 읽은 메일") }
    parts.append("별표 제외")
    return parts.joined(separator: " · ")
  }
  /// "2026-09-01" → "9/1"(서울 날짜 문자열 그대로 — 시간대 계산 없음)
  static func md(_ day: String) -> String? {
    let p = day.split(separator: "-")
    guard p.count == 3, let m = Int(p[1]), let d = Int(p[2]) else { return nil }
    return "\(m)/\(d)"
  }
  public static func countLine(_ p: Preview) -> String {
    let star = p.starred_estimate > 0 ? " · 별표 약 \(grouped(p.starred_estimate))건 제외" : ""
    return (p.exact ? "\(grouped(p.count))건" : "총 약 \(grouped(p.total_estimate))건 중 \(grouped(p.count))건") + star
  }
  public static func sampleLine(_ s: Sample) -> String {
    [s.from.isEmpty ? "(보낸 사람 없음)" : s.from, s.subject.isEmpty ? "(제목 없음)" : s.subject, seoulMD(s.date)].compactMap { $0 }.joined(separator: " · ")
  }
  public static func moreLine(_ p: Preview) -> String? { p.count > p.sample.count ? "외 \(grouped(p.count - p.sample.count))건" : nil }
  public static func grouped(_ n: Int) -> String {
    let s = String(n)
    var out = ""
    for (i, ch) in s.reversed().enumerated() { if i > 0 && i % 3 == 0 { out.append(",") }; out.append(ch) }
    return String(out.reversed())
  }
  nonisolated(unsafe) private static let isoFrac: ISO8601DateFormatter = {
    let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f
  }()
  nonisolated(unsafe) private static let isoPlain = ISO8601DateFormatter()
  static func seoulMD(_ s: String) -> String? {
    guard let d = isoFrac.date(from: s) ?? isoPlain.date(from: s) else { return nil }
    var cal = Calendar(identifier: .gregorian)
    cal.timeZone = TimeZone(identifier: "Asia/Seoul")!
    let c = cal.dateComponents([.month, .day], from: d)
    return "\(c.month ?? 0)/\(c.day ?? 0)"
  }

  public static func progress(_ s: Status, action: String) -> String {
    if s.undoPhase { return "\(MailCleanupText.undoing) \(grouped(s.undone + s.undo_failed))/\(grouped(s.done))" }
    return "\(action == "read" ? MailCleanupText.reading : MailCleanupText.trashing) \(grouped(s.done + s.failed))/\(grouped(s.total))"
  }
  public static func result(_ s: Status, action: String) -> Note {
    let perm = ["scope_missing", "reauth_required", "no_connection"].contains(s.code ?? "")
    switch s.status {
    case "done", "partial", "failed":
      var lines: [String] = []
      if s.done > 0 {
        lines.append((action == "read" ? "\(grouped(s.done))건을 읽음으로 바꿨어요" : "휴지통으로 \(grouped(s.done))건 옮겼어요")
                     + (s.failed > 0 ? " · \(grouped(s.failed))건 실패" : ""))
      } else {
        lines.append((action == "read" ? "읽음으로 바꾸지 못했어요" : "휴지통으로 옮기지 못했어요") + " (\(grouped(s.failed))건 실패)")
      }
      if perm && s.failed > 0 { lines.append("Gmail 권한(연결)이 바뀌어 \(grouped(s.failed))건을 처리하지 못했어요") }
      return Note(lines.joined(separator: "\n"), settings: perm && s.failed > 0)
    case "undone": return Note(MailCleanupText.undone)
    case "undo_partial":
      return Note("\(grouped(s.undone))건 되돌렸어요 · \(grouped(s.undo_failed))건 실패 — \(MailCleanupText.manual(action))", settings: perm)
    case "undo_failed": return Note("되돌리지 못했어요 — \(MailCleanupText.manual(action))", settings: perm)
    default: return Note(progress(s, action: action))
    }
  }
  /// [되돌리기]: done·partial 이고 성공이 있고 7일 안(서버가 원본). 되돌리기는 한 번뿐 — 되돌리기 상태면 false
  public static func canUndo(_ s: Status, previewAt: Date, now: Date) -> Bool {
    ["done", "partial"].contains(s.status) && s.done > 0 && now.timeIntervalSince(previewAt) < undoTTL
  }
  public static func isTokenExpired(previewAt: Date, now: Date) -> Bool { now.timeIntervalSince(previewAt) >= tokenTTL }
  /// [다음 1,000건 보기]: 더 있고 실행이 끝났을 때(되돌린 뒤에는 숨긴다)
  public static func showNext(_ p: Preview, _ s: Status?) -> Bool { p.has_more && (s.map { $0.finished && !$0.undoPhase } ?? false) }
}

public enum MailCleanupText {
  public static let finding = "메일을 찾는 중…"
  public static func header(_ action: String) -> String { action == "read" ? "읽음으로 바꿀 메일" : "휴지통으로 옮길 메일" }
  public static func button(_ action: String, _ n: Int) -> String {
    action == "read" ? "읽음 처리 (\(MailCleanup.grouped(n))건)" : "휴지통으로 이동 (\(MailCleanup.grouped(n))건)"
  }
  public static let cancel = "취소", cancelled = "취소했어요"
  public static let expired = "미리보기가 만료됐어요", repreview = "다시 미리보기"
  public static let scopeMissing = "메일을 정리하려면 Gmail 권한 업데이트가 필요해요", openSettings = "설정 열기"
  public static let noConnection = "Gmail이 연결되어 있지 않아요"
  public static let noneFound = "받은편지함에서 조건에 맞는 메일을 찾지 못했어요(별표 메일은 제외해요)"
  public static let needsTarget = "어떤 메일인지 발신자·제목·기간·광고 중 하나를 함께 말해 주세요"
  public static let badCondition = "조건을 정확히 알아듣지 못했어요 — 발신자·제목·기간을 다시 말해 주세요"
  public static let reauth = "Gmail 연결이 끊겼어요 — 설정 › Gmail에서 다시 연결해 주세요"
  public static let busy = "Gmail이 잠시 바빠요 — 잠시 뒤 다시 요청해 주세요"
  public static let disabled = "메일 정리를 지금 쓸 수 없어요"
  public static let failed = "메일 정리를 하지 못했어요 — 잠시 뒤 다시 해 주세요"
  public static let interrupted = "앱이 닫혀 메일을 찾지 못했어요 — 다시 요청해 주세요"
  public static let stillRunning = "아직 처리 중이에요 — 다시 열면 상태를 다시 읽어요"
  public static let nothingToUndo = "되돌릴 메일이 없어요"
  public static let trashing = "휴지통으로 옮기는 중", reading = "읽음으로 바꾸는 중", undoing = "되돌리는 중"
  public static let undo = "되돌리기", undone = "되돌렸어요", nextPage = "다음 1,000건 보기"
  public static func manual(_ action: String) -> String {
    action == "read" ? "Gmail에서 직접 안 읽음으로 바꿀 수 있어요" : "Gmail 휴지통에서 직접 복원할 수 있어요"
  }
  public static func undoExpired(_ action: String) -> String { "되돌리기 기간(7일)이 지났어요 — " + manual(action) }
  // 설정 › Gmail [권한 업데이트](스펙 §7 권한 업데이트·§12 통제 5)
  public static let upgradeButton = "권한 업데이트"
  public static let upgradeNote = "채팅으로 요청한 메일만 휴지통으로 옮기거나 읽음으로 바꿀 수 있게 권한을 더해요. 메일을 영구 삭제하지 않고, 실행 전에 대상을 보여 드려요. 보관함은 바뀌지 않아요."
  public static let upgradeDone = "Gmail 권한을 업데이트했어요"
  public static let upgradeLater = "Google이 새 권한을 아직 주지 않았어요. 다음 Gmail 재연결 때 함께 더해져요(테스트 모드는 7일마다 재연결 알림)"
  public static let upgradeNotGranted = "메일 정리 권한이 체크되지 않았어요 — 다시 눌러 권한을 체크해 주세요"
  public static let upgradeMismatch = "연결된 Gmail과 다른 Google 계정이에요 — 연결된 계정으로 다시 해 주세요"
  public static let upgradeFailed = "권한 업데이트를 하지 못했어요 — 잠시 뒤 다시 해 주세요"
  public static func upgradeResult(status: Int, body: [String: Any]) -> String {
    switch status {
    case 200: return (body["upgraded"] as? Bool) == true ? upgradeDone : upgradeLater
    case 409: return upgradeMismatch
    case 403: return upgradeNotGranted
    default: return upgradeFailed
    }
  }
}

/// 대화 기록의 메일 정리 턴(스펙 §9 "대화 기록"): 서버가 확정한 조건·미리보기 글(위 20건·건수)·토큰(= mail_actions id)·마지막 상태. 이 기기에만, 30일
public struct MailTurn: Codable, Sendable, Equatable {
  public enum Phase: String, Codable, Sendable { case finding, preview, running, ended }
  public var phase: Phase
  public var preview: MailCleanup.Preview?
  public var previewAt: Date?
  public var status: MailCleanup.Status?
  public var note: String?
  public var settings: Bool
  public var repreview: Bool
  public var retry: Bool
  public init(phase: Phase = .finding, preview: MailCleanup.Preview? = nil, previewAt: Date? = nil, status: MailCleanup.Status? = nil,
              note: String? = nil, settings: Bool = false, repreview: Bool = false, retry: Bool = false) {
    self.phase = phase; self.preview = preview; self.previewAt = previewAt; self.status = status
    self.note = note; self.settings = settings; self.repreview = repreview; self.retry = retry
  }
  public mutating func apply(_ n: MailCleanup.Note) { note = n.text; settings = n.settings; repreview = n.repreview; retry = n.retry }
}

extension JSONValue {
  /// JSONSerialization 용 값(null → NSNull). chat 응답의 mail 칸을 그대로 mail-action/preview 에 보낼 때(스펙 §9 "응답의 mail 칸을 그대로")
  public var foundation: Any {
    switch self {
    case .string(let s): return s
    case .number(let n): return n
    case .bool(let b): return b
    case .array(let a): return a.map(\.foundation)
    case .object(let o): return o.mapValues(\.foundation)
    case .null: return NSNull()
    }
  }
}
```

- [ ] **Step 4: 기존 파일 고치기**

`ChatHistory.swift`:
1. `public enum Kind: String, Codable, Sendable { case question, link, image, addEvent }` → `… { case question, link, image, addEvent, mailAction }   // mailAction = 채팅 메일 정리(0.14.0)`
2. `itemID` 줄(0.13.0) 뒤에 `public var mail: MailTurn?                 // 메일 정리 턴(0.14.0): 조건·미리보기 글·토큰·마지막 상태 — 이 기기에만`
3. `init`의 마지막 인자로 `mail: MailTurn? = nil`을 더하고 본문에 `self.mail = mail`.
4. `restored()`의 `switch x.kind`에 사례를 더한다:

```swift
      case .mailAction:
        // 미리보기를 받기 전에 닫혔으면 끝난 문구로. 실행·되돌리기 중(running)은 그대로 — 화면에 나올 때 서버 상태를 다시 읽는다(§9)
        if x.mail == nil { x.mail = MailTurn(phase: .ended, note: MailCleanupText.interrupted) }
        else if x.mail?.phase == .finding { x.mail?.phase = .ended; x.mail?.note = MailCleanupText.interrupted }
```

`ChatReply.swift` `Answer`의 `intent` 줄(0.13.0) 뒤에:

```swift
    /// 메일 정리 칸(스펙 §9, 0.14.0): intent = mail_action 일 때 모델 출력 그대로. 검사·정제는 서버 mail-action 한 곳이라 앱은 해석하지 않고 그대로 보낸다
    public let mail: JSONValue?
```

`ChatAddEvent.swift`: `public static let intents = ["add_event"]` → `public static let intents = ["add_event", "mail_action"]   // 이 앱이 처리하는 행동(§9 하위 호환) — 0.14.0 메일 정리`

- [ ] **Step 5: 통과 확인**

Run: `cd ios && ./scripts/sim.sh test EruriCoreTests/MailCleanupTests && ./scripts/sim.sh test EruriCoreTests/ChatHistoryTests && ./scripts/sim.sh test EruriCoreTests/ChatReplyTests && ./scripts/sim.sh test EruriCoreTests/ChatAddEventTests && ./scripts/sim.sh test`
Expected: 새 사례 포함 EruriCore 전체 0 실패, Swift 6 경고 0(새 경고가 있으면 고친다).

- [ ] **Step 6: 커밋**

```bash
git add ios/Packages/EruriCore/Sources/EruriCore/MailCleanup.swift ios/Packages/EruriCore/Sources/EruriCore/ChatHistory.swift ios/Packages/EruriCore/Sources/EruriCore/ChatReply.swift ios/Packages/EruriCore/Sources/EruriCore/ChatAddEvent.swift ios/Packages/EruriCore/Tests/EruriCoreTests
git commit -m "feat(core): mail cleanup — decode preview/status from mail-action, condition line from server-confirmed fields, exact or estimated counts with starred, Seoul M/D sample lines, error and result copy (permission/connection, zero-success, undo windows for trash and read), 10-minute token and 7-day undo checks, next-1,000 rule; mail-action chat turns in history (unfinished preview ends on restore, running turns reread status, never context); answer carries raw mail fields; app now sends intents [add_event, mail_action]

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task M9: 앱 — 채팅 메일 정리 턴·카드 + 설정 [권한 업데이트]

**Files:**
- Create: `ios/App/MailCleanupAPI.swift`, `ios/App/MailCleanupCard.swift`
- Modify: `ios/App/ChatView.swift`(상태 한 줄, `syncClear`, 200 분기, 턴 행, 새 함수들)
- Modify: `ios/App/GoogleSignIn.swift:12,39,74-95`(scope·`connect(upgrade:)`), 새 `upgrade()`
- Modify: `ios/App/ContentView.swift`(Gmail 절·상태·`SettingsRouter`), `ios/App/EruriApp.swift:46-58`(설정 탭 전환)

**Interfaces:**
- Consumes: M8 전부, M5·M6 HTTP 계약, 0.13.0 `ChatView.send`(200 분기의 `add_event` 블록)·`settle(_:_:save:_:)`·`append(_:)`·`scroll(to:)`·`syncClear()`, `API.send`, `Trace.log`, `DiagLog`.
- Produces: 화면 식별자(M11 게이트가 쓴다) `mail-card`·`mail-conditions`·`mail-count`·`mail-execute`·`mail-cancel`·`mail-expired`·`mail-repreview`·`mail-progress`·`mail-result`·`mail-undo`·`mail-undo-expired`·`mail-next`·`mail-note`·`mail-open-settings`·`settings-gmail-upgrade`·`settings-gmail-upgrade-result`, trace `chat.mail`(`stage`·`result`·`code`·`count`·`method`·`elapsed_ms`)·`device.gmail_upgrade`(`result`·`upgraded`). 커밋 메시지는 `feat(ios): mail cleanup`으로 시작한다(D17).

- [ ] **Step 1: 확인**

Run: `grep -n 'sources: \[App\]' ios/project.yml && grep -n 'ChatAddEvent.isAddEvent(a.intent)' ios/App/ChatView.swift && grep -n 'if let l = t.record.link {' ios/App/ChatView.swift`
Expected: 세 줄 모두 있다(새 앱 파일은 `sources: [App]`로 자동 포함, 0.13.0의 `add_event` 분기와 턴 행 사슬이 있다). 없으면 0.13.0이 바뀐 것이라 그 모양에 맞춰 아래 삽입 위치를 고르고 보고에 적는다.

- [ ] **Step 2: 서버 호출·카드 파일**

`ios/App/MailCleanupAPI.swift`:

```swift
import Foundation
import EruriCore

/// 메일 정리 서버 호출(스펙 §7 "메일 정리", 0.14.0). 본문(조건)·응답(미리보기 글)은 로그에 남기지 않는다 — 호출부가 상태·개수·코드만 trace
enum MailCleanupAPI {
  static func preview(_ body: [String: Any]) async -> (status: Int, data: Data)? {
    await API.send("functions/v1/mail-action/preview", method: "POST", json: body, timeout: 60)
  }
  static func execute(token: String) async -> (status: Int, data: Data)? {
    await API.send("functions/v1/mail-action/execute", method: "POST", json: ["token": token], timeout: 20)
  }
  static func undo(id: String) async -> (status: Int, data: Data)? {
    await API.send("functions/v1/mail-action/undo", method: "POST", json: ["id": id], timeout: 20)
  }
  static func status(id: String) async -> (status: Int, data: Data)? {
    await API.send("functions/v1/mail-action/status?id=\(id)", timeout: 10)
  }
}
```

`ios/App/MailCleanupCard.swift`:

```swift
import SwiftUI
import EruriCore

/// 채팅 메일 정리 카드(스펙 §9 "채팅 메일 정리", 0.14.0): 미리보기(서버가 확정한 조건 줄·건수·위 20건) → [실행]·[취소] → 진행 → 결과·[되돌리기]·[다음 1,000건 보기].
/// 실행 버튼이 곧 확인이다(확인창 없음). 시간 창(토큰 10분·되돌리기 7일)은 30초마다 다시 본다 — 서버가 원본(410)
struct MailCleanupCard: View {
  let turn: MailTurn
  var onExecute: () -> Void
  var onCancel: () -> Void
  var onUndo: () -> Void
  var onRepreview: () -> Void
  var onNext: () -> Void
  var onSettings: () -> Void

  var body: some View {
    TimelineView(.periodic(from: .now, by: 30)) { ctx in
      VStack(alignment: .leading, spacing: 8) {
        if turn.phase == .finding {
          HStack { ProgressView(); Text(MailCleanupText.finding).font(.subheadline) }
        } else {
          if let p = turn.preview { previewBlock(p, now: ctx.date) }
          if let s = turn.status { statusBlock(s, now: ctx.date) }
          else if turn.phase == .running { ProgressView().accessibilityIdentifier("mail-progress") }   // 실행·되돌리기 요청 중(응답 전)
        }
        if let n = turn.note { Text(n).font(.footnote).foregroundStyle(.secondary).accessibilityIdentifier("mail-note") }
        if turn.settings { Button(MailCleanupText.openSettings, action: onSettings).buttonStyle(.bordered).accessibilityIdentifier("mail-open-settings") }
      }
      .accessibilityElement(children: .contain)
      .accessibilityIdentifier("mail-card")
    }
  }

  @ViewBuilder private func previewBlock(_ p: MailCleanup.Preview, now: Date) -> some View {
    Text(MailCleanupText.header(p.action)).font(.headline)
    Text(MailCleanup.conditionLine(p.conditions)).font(.footnote).accessibilityIdentifier("mail-conditions")
    Text(MailCleanup.countLine(p)).font(.footnote).foregroundStyle(.secondary).accessibilityIdentifier("mail-count")
    ForEach(Array(p.sample.enumerated()), id: \.offset) { Text(MailCleanup.sampleLine($0.element)).font(.caption).lineLimit(1) }
    if let more = MailCleanup.moreLine(p) { Text(more).font(.caption).foregroundStyle(.secondary) }
    if turn.phase == .preview {
      if turn.repreview || (turn.previewAt.map { MailCleanup.isTokenExpired(previewAt: $0, now: now) } ?? true) {
        Text(MailCleanupText.expired).font(.footnote).accessibilityIdentifier("mail-expired")
        Button(MailCleanupText.repreview, action: onRepreview).buttonStyle(.bordered).accessibilityIdentifier("mail-repreview")
      } else {
        HStack {
          Button(MailCleanupText.button(p.action, p.count), action: onExecute).buttonStyle(.borderedProminent).accessibilityIdentifier("mail-execute")
          Button(MailCleanupText.cancel, action: onCancel).buttonStyle(.bordered).accessibilityIdentifier("mail-cancel")
        }
      }
    }
  }

  @ViewBuilder private func statusBlock(_ s: MailCleanup.Status, now: Date) -> some View {
    let action = turn.preview?.action ?? "trash"
    if !s.finished {
      HStack { ProgressView(); Text(MailCleanup.progress(s, action: action)).font(.subheadline) }.accessibilityIdentifier("mail-progress")
    } else {
      let r = MailCleanup.result(s, action: action)
      Text(r.text).font(.subheadline).accessibilityIdentifier("mail-result")
      if r.settings && !turn.settings { Button(MailCleanupText.openSettings, action: onSettings).buttonStyle(.bordered).accessibilityIdentifier("mail-open-settings") }
      if turn.phase == .ended, let at = turn.previewAt {
        if MailCleanup.canUndo(s, previewAt: at, now: now) {
          Button(MailCleanupText.undo, action: onUndo).buttonStyle(.bordered).accessibilityIdentifier("mail-undo")
        } else if ["done", "partial"].contains(s.status), s.done > 0 {
          Text(MailCleanupText.undoExpired(action)).font(.footnote).foregroundStyle(.secondary).accessibilityIdentifier("mail-undo-expired")
        }
        if let p = turn.preview, MailCleanup.showNext(p, s) {
          Button(MailCleanupText.nextPage, action: onNext).buttonStyle(.bordered).accessibilityIdentifier("mail-next")
        }
      }
    }
  }
}
```

(목록 행 안에 버튼이 여럿이라 `.bordered` 계열 스타일을 붙인다 — 기본 스타일이면 행을 누를 때 모든 버튼이 함께 눌린다.)

- [ ] **Step 3: `ChatView` — 분기·행·상태**

(a) `@State private var openItem: String?` 줄 아래에 더한다:

```swift
  @State private var mailPolling: Set<UUID> = []       // 상태를 읽는 중인 메일 정리 턴(같은 턴을 두 Task 가 읽지 않게, 0.14.0)
```

(b) `syncClear()`의 비우기 줄 끝에 `mailPolling = []`를 더한다(`… openItem = nil; mailPolling = []; loaded = true`).

(c) `send`의 200 분기에서 0.13.0 `if ChatAddEvent.isAddEvent(a.intent) { … return }` 블록 바로 뒤에 넣는다:

```swift
          if MailCleanup.isMailAction(a.intent) {
            // 채팅 메일 정리(§9, 0.14.0): 답이 아니다 — reply 를 저장하지 않고 턴을 "메일 정리"로 바꿔 mail 칸 그대로 미리보기를 부른다(검사는 서버 한 곳)
            DiagLog.append("CHAT intent mail_action ctx=\(withContext ? 1 : 0)")
            guard let body = a.mail?.foundation as? [String: Any] else {
              settle(id, epoch) { $0.record.kind = .mailAction; $0.record.mail = MailTurn(phase: .ended, note: MailCleanupText.failed) }
              return
            }
            settle(id, epoch) { $0.record.kind = .mailAction; $0.record.mail = MailTurn(phase: .finding) }
            previewMail(id, body: body, epoch: epoch)
            return
          }
```

(d) 턴 행: `if let l = t.record.link {` 줄 앞에 메일 정리 가지를 붙여 같은 if-else 사슬의 첫 가지로 만든다:

```swift
              if t.record.kind == .mailAction {                    // 메일 정리 턴(§9, 0.14.0): 카드 하나. 복원된 진행 중 턴은 나올 때 상태를 다시 읽는다
                MailCleanupCard(turn: t.record.mail ?? MailTurn(phase: .ended, note: MailCleanupText.failed),
                                onExecute: { executeMail(t.id) }, onCancel: { cancelMail(t.id) }, onUndo: { undoMail(t.id) },
                                onRepreview: { repreviewMail(t.id) }, onNext: { nextMail(t.id) }, onSettings: { SettingsRouter.shared.open() })
                  .onAppear { resumeMail(t.id) }
              } else if let l = t.record.link {
```

(0.13.0이 사슬 앞에 다른 가지를 더했으면 그 가지보다 앞에 둔다 — `.mailAction` 턴에는 `link`·`answer`가 없어 다른 가지로 가면 `ProgressView`만 돈다.)

- [ ] **Step 4: `ChatView` — 메일 정리 함수**

`registerEvent`(0.13.0) 아래에 더한다:

```swift
  // ── 채팅 메일 정리(스펙 §9, 0.14.0). 모든 갱신은 id·epoch 로(settle) — await 뒤 색인으로 턴을 고치지 않는다. 미리보기 글은 기록에만, 로그·trace 는 개수·코드만 ──

  /// 미리보기: 응답의 mail 칸(또는 서버가 확정한 conditions — 다시 미리보기·다음 1,000건)을 그대로 보낸다
  private func previewMail(_ id: UUID, body: [String: Any], epoch: Int) {
    Task {
      let started = Date()
      let r = await MailCleanupAPI.preview(body)
      let ms = Int(Date().timeIntervalSince(started) * 1000)
      if let r, r.status == 200, let p = MailCleanup.preview(r.data) {
        Trace.log("chat.mail", ["stage": "preview", "result": p.token == nil ? "empty" : "ok", "count": p.count, "elapsed_ms": ms])
        settle(id, epoch) {
          $0.record.mail = p.token == nil ? MailTurn(phase: .ended, note: MailCleanupText.noneFound) : MailTurn(phase: .preview, preview: p, previewAt: Date())
        }
      } else {
        let code = r.flatMap { MailCleanup.errorCode($0.data) }
        Trace.log("chat.mail", ["stage": "preview", "result": "error", "code": code ?? "http_\(r?.status ?? -1)", "elapsed_ms": ms])
        var m = MailTurn(phase: .ended)
        m.apply(MailCleanup.previewError(status: r?.status ?? -1, code: code))
        settle(id, epoch) { $0.record.mail = m }
      }
    }
  }

  /// [휴지통으로 이동]·[읽음 처리] = 확인. 누르는 즉시 버튼을 없앤다(서버도 같은 토큰은 한 번만)
  private func executeMail(_ id: UUID) {
    let epoch = log.clearCount
    guard let m = turns.first(where: { $0.id == id })?.record.mail, m.phase == .preview, let token = m.preview?.token else { return }
    settle(id, epoch) { $0.record.mail?.phase = .running; $0.record.mail?.note = nil; $0.record.mail?.retry = false }
    Task {
      let r = await MailCleanupAPI.execute(token: token)
      if let r, r.status == 200 || r.status == 202, let s = MailCleanup.status(r.data) {
        Trace.log("chat.mail", ["stage": "execute", "result": s.status, "count": s.total, "method": s.method ?? "-"])
        settle(id, epoch) { $0.record.mail?.status = s }
        pollMail(id, epoch: epoch)
      } else {
        let code = r.flatMap { MailCleanup.errorCode($0.data) }
        Trace.log("chat.mail", ["stage": "execute", "result": "error", "code": code ?? "http_\(r?.status ?? -1)"])
        let n = MailCleanup.executeError(status: r?.status ?? -1, code: code)
        settle(id, epoch) {
          if n.repreview { $0.record.mail?.phase = .preview; $0.record.mail?.repreview = true }          // 만료: 카드가 "미리보기가 만료됐어요" + [다시 미리보기]
          else if n.retry { $0.record.mail?.phase = .preview; $0.record.mail?.apply(n) }                 // 다시 누를 수 있다(멱등)
          else { $0.record.mail?.phase = .ended; $0.record.mail?.apply(n) }
        }
      }
    }
  }

  /// [되돌리기](7일, 한 번): 성공한 메일만 서버 잡이 되돌린다
  private func undoMail(_ id: UUID) {
    let epoch = log.clearCount
    guard let m = turns.first(where: { $0.id == id })?.record.mail, m.phase == .ended, let s = m.status else { return }
    let action = m.preview?.action ?? "trash"
    settle(id, epoch) { $0.record.mail?.phase = .running; $0.record.mail?.note = nil }
    Task {
      let r = await MailCleanupAPI.undo(id: s.id)
      if let r, r.status == 200 || r.status == 202, let n = MailCleanup.status(r.data) {
        Trace.log("chat.mail", ["stage": "undo", "result": n.status, "count": n.done, "method": n.method ?? "-"])
        settle(id, epoch) { $0.record.mail?.status = n }
        pollMail(id, epoch: epoch)
      } else {
        let code = r.flatMap { MailCleanup.errorCode($0.data) }
        Trace.log("chat.mail", ["stage": "undo", "result": "error", "code": code ?? "http_\(r?.status ?? -1)"])
        let n = MailCleanup.undoError(status: r?.status ?? -1, code: code, action: action)
        settle(id, epoch) { $0.record.mail?.phase = .ended; $0.record.mail?.apply(n) }
      }
    }
  }

  /// 상태를 3초마다 읽는다(§9). 앱을 닫아도 서버 잡은 계속되고, 다시 열면 그 턴이 화면에 나올 때 resumeMail 이 다시 부른다.
  /// 지우기(epoch)·턴 소멸·끝난 상태·20분에서 멈춘다
  private func pollMail(_ id: UUID, epoch: Int) {
    guard !mailPolling.contains(id) else { return }
    mailPolling.insert(id)
    Task {
      defer { mailPolling.remove(id) }
      let started = Date()
      while log.clearCount == epoch, let s = turns.first(where: { $0.id == id })?.record.mail?.status, !s.finished {
        if Date().timeIntervalSince(started) > MailCleanup.pollLimit {
          settle(id, epoch) { $0.record.mail?.phase = .ended; $0.record.mail?.note = MailCleanupText.stillRunning }
          return
        }
        try? await Task.sleep(for: MailCleanup.pollInterval)
        guard let r = await MailCleanupAPI.status(id: s.id) else { continue }
        if r.status == 404 { settle(id, epoch) { $0.record.mail?.phase = .ended }; return }   // 7일 정리된 행 — 마지막 상태로 끝
        if r.status == 200, let n = MailCleanup.status(r.data) { settle(id, epoch) { $0.record.mail?.status = n } }
      }
      guard log.clearCount == epoch, let s = turns.first(where: { $0.id == id })?.record.mail?.status, s.finished else { return }
      settle(id, epoch) { $0.record.mail?.phase = .ended }
      Trace.log("chat.mail", ["stage": s.undoPhase ? "undo" : "execute", "result": s.status, "count": s.undoPhase ? s.undone : s.done, "method": s.method ?? "-"])
    }
  }

  /// 다시 열었을 때: 실행·되돌리기 중(running)이던 턴은 서버 상태를 다시 읽는다. 실행 응답을 받기 전에 닫혔으면(상태 없음) 토큰으로 한 번 묻는다 —
  /// 아직 previewed 면 실행 요청이 서버에 닿지 않은 것이라 카드를 미리보기로 돌린다(만료면 [다시 미리보기])
  private func resumeMail(_ id: UUID) {
    let epoch = log.clearCount
    guard let m = turns.first(where: { $0.id == id })?.record.mail, m.phase == .running, !mailPolling.contains(id) else { return }
    if m.status != nil { pollMail(id, epoch: epoch); return }
    guard let token = m.preview?.token else { settle(id, epoch) { $0.record.mail?.phase = .ended }; return }
    Task {
      guard let r = await MailCleanupAPI.status(id: token), r.status == 200, let s = MailCleanup.status(r.data) else { return }
      settle(id, epoch) { if s.status == "previewed" { $0.record.mail?.phase = .preview } else { $0.record.mail?.status = s } }
      if s.status != "previewed" { pollMail(id, epoch: epoch) }
    }
  }

  /// [다시 미리보기](10분 지남): 그 턴의 미리보기를 서버가 확정한 conditions 로 다시 받는다(D15)
  private func repreviewMail(_ id: UUID) {
    let epoch = log.clearCount
    guard let c = turns.first(where: { $0.id == id })?.record.mail?.preview?.conditions else { return }
    settle(id, epoch) { $0.record.mail = MailTurn(phase: .finding) }
    previewMail(id, body: c.json, epoch: epoch)
  }

  /// [다음 1,000건 보기]: 새 메일 정리 턴 — 앞 턴의 결과·[되돌리기]를 지우지 않는다(D15). 맥락으로 가지 않는다
  private func nextMail(_ id: UUID) {
    guard let c = turns.first(where: { $0.id == id })?.record.mail?.preview?.conditions else { return }
    let nid = append(ChatHistory.Record(at: Date(), kind: .mailAction, question: MailCleanupText.nextPage, mail: MailTurn(phase: .finding)))
    previewMail(nid, body: c.json, epoch: log.clearCount)
  }

  /// [취소]: 서버를 부르지 않는다 — 행은 실행되지 않은 채 7일 뒤 정리된다
  private func cancelMail(_ id: UUID) {
    settle(id, log.clearCount) { $0.record.mail?.phase = .ended; $0.record.mail?.note = MailCleanupText.cancelled }
  }
```

- [ ] **Step 5: 설정 — 라우터·[권한 업데이트]**

`ios/App/ContentView.swift` 맨 아래(파일 끝)에 더한다:

```swift
/// 채팅 → 설정 탭(메일 정리 [설정 열기], 0.14.0). 루트가 openCount 로 탭을 옮긴다(ArchiveRouter 와 같은 방식)
@MainActor @Observable final class SettingsRouter {
  static let shared = SettingsRouter()
  var openCount = 0
  func open() { openCount += 1 }
}
```

`ContentView`: 상태 두 줄 `@State private var needsUpgrade = false`, `@State private var upgradeResult = ""`를 더하고, Gmail 절의 `Button("다시 연결 (동의 다시 받기)") …` 줄 다음에 넣는다:

```swift
          if needsUpgrade {                                      // 스펙 §7 권한 업데이트(0.14.0): 연결돼 있고 modify 가 없을 때만(D16)
            Button(MailCleanupText.upgradeButton) { upgradeGmail() }.disabled(busy || !GmailConnect.configured)
              .accessibilityIdentifier("settings-gmail-upgrade")
            Text(MailCleanupText.upgradeNote).font(.caption2).foregroundStyle(.secondary)
          }
          if !upgradeResult.isEmpty {
            Text(upgradeResult).font(.caption).foregroundStyle(.secondary).accessibilityIdentifier("settings-gmail-upgrade-result")
          }
```

`refresh()`의 `gmail = signedIn ? await gmailStatus() : ""` 다음 줄에 `needsUpgrade = signedIn ? await gmailNeedsUpgrade() : false`를 더하고, `connectGmail` 아래에 더한다:

```swift
  /// [권한 업데이트] 표시(D16): scopes 를 상태 줄과 따로 읽는다 — 열이 없는 서버(0030 전, 400)면 숨긴다. 연결이 active 이고 modify 가 없을 때만
  private func gmailNeedsUpgrade() async -> Bool {
    guard let r = await API.send("rest/v1/connections?select=status,scopes&provider=eq.gmail"), r.status == 200,
          let rows = try? JSONSerialization.jsonObject(with: r.data) as? [[String: Any]], let c = rows.first,
          c["status"] as? String == "active" else { return false }
    return !((c["scopes"] as? [String]) ?? []).contains(MailCleanup.modifyScope)
  }
  private func upgradeGmail() {
    busy = true
    Task { upgradeResult = await GmailConnect.upgrade(); busy = false; await refresh() }
  }
```

`ios/App/EruriApp.swift`: `private var archiveRouter: ArchiveRouter { ArchiveRouter.shared }` 아래에 `private var settingsRouter: SettingsRouter { SettingsRouter.shared }`, `.onChange(of: archiveRouter.openCount) …` 줄 아래에 `.onChange(of: settingsRouter.openCount) { _, _ in tab = .settings }   // 메일 정리 [설정 열기](0.14.0)`.

- [ ] **Step 6: `GoogleSignIn.swift` — 새 연결 scope·권한 업데이트**

(a) 12행 아래에 `static let modifyScope = MailCleanup.modifyScope   // 0.14.0: 새 연결·주간 재연결은 readonly + modify(스펙 §7, 서버는 readonly 만 확인)`.

(b) 39행 `additionalScopes: [scope]` → `additionalScopes: [scope, modifyScope]`.

(c) `connect(_:access:code:)`에 `upgrade: Bool = false` 인자를 더하고 본문을 바꾼다:

```swift
    r.httpBody = try? JSONSerialization.data(withJSONObject: upgrade ? ["code": code, "upgrade": true] as [String: Any] : ["code": code])
```

(d) `run(forceConsent:)` 아래에 더한다:

```swift
  /// 권한 업데이트(스펙 §7, 0.14.0, 계획 D13): 지금 연결을 그대로 두고 gmail.modify 를 더한다 — disconnect 하지 않는다(기존 승인을 끊지 않게).
  /// 되살린 사용자에게 addScopes, 못 되살렸거나 Google 쪽에 이미 승인돼 있으면 일반 로그인(readonly + modify)으로 새 코드를 받는다 → gmail-connect {code, upgrade: true}.
  /// 취소(-5)는 서버를 부르지 않고 빈 문구(버튼은 그대로). 코드·토큰은 로그에 남기지 않는다
  static func upgrade() async -> String {
    guard let cfg = config() else { return fail("config_missing", "앱 설정값(GID·Supabase)이 빌드에 없음") }
    guard var access = await SupabaseSession.shared.accessToken() else { return fail("no_session", "먼저 Apple로 로그인하세요") }
    GIDSignIn.sharedInstance.configuration = GIDConfiguration(clientID: cfg.clientID, serverClientID: cfg.serverClientID)
    guard let presenter = topViewController() else { return fail("no_presenter", "로그인 화면을 띄울 창을 찾지 못함") }
    let result: GIDSignInResult
    do {
      let restored = try? await GIDSignIn.sharedInstance.restorePreviousSignIn()
      if let u = restored, !(u.grantedScopes?.contains(modifyScope) ?? false) {
        DiagLog.append("gmail upgrade addScopes")
        result = try await u.addScopes([modifyScope], presenting: presenter)
      } else {
        DiagLog.append("gmail upgrade signIn restored=\(restored != nil)")
        result = try await GIDSignIn.sharedInstance.signIn(withPresenting: presenter, hint: restored?.profile?.email, additionalScopes: [scope, modifyScope])
      }
    } catch {
      let e = error as NSError
      if e.code == -5 { DiagLog.append("gmail upgrade cancelled"); return "" }      // 취소: 아무것도 바꾸지 않는다
      _ = fail("upgrade_signin_error", "\(e.domain) \(e.code)", code: e.code)
      return MailCleanupText.upgradeFailed
    }
    guard result.user.grantedScopes?.contains(modifyScope) == true else {
      Trace.log("device.gmail_upgrade", ["result": "not_granted"]); return MailCleanupText.upgradeNotGranted
    }
    guard let code = result.serverAuthCode else {                                   // U3: 문서 미명시 — 다음 재연결 때 더해진다
      Trace.log("device.gmail_upgrade", ["result": "no_code"]); return MailCleanupText.upgradeLater
    }
    var (status, body) = await connect(cfg, access: access, code: code, upgrade: true)
    if status == 401 {                                                               // 게이트웨이에서 막혀 코드가 소비되지 않았다 — 한 번만 다시
      await SupabaseSession.shared.invalidate()
      guard let a = await SupabaseSession.shared.accessToken() else { return fail("relogin_failed", "Supabase 재로그인 실패") }
      access = a
      (status, body) = await connect(cfg, access: access, code: code, upgrade: true)
    }
    Trace.log("device.gmail_upgrade", ["result": "http_\(status)", "upgraded": (body["upgraded"] as? Bool) == true])
    return MailCleanupText.upgradeResult(status: status, body: body)
  }
```

- [ ] **Step 7: 빌드·회귀**

`pgrep -x deno`가 비었는지, `vm_stat | grep -E 'free|compressor'`를 본다.

Run: `cd ios && ./scripts/sim.sh gen && ./scripts/sim.sh build`
Expected: BUILD SUCCEEDED, Swift 6 동시성 경고·오류 0. `addScopes`·`restorePreviousSignIn`의 async 판이 없다는 오류면 U8 — `withCheckedThrowingContinuation`으로 콜백판을 감싼다(같은 흐름).

Run: `cd ios && ./scripts/sim.sh test`
Expected: EruriCore 전체 0 실패.

자체 확인(리뷰 확인 항목과 같다): `grep -n 'turns\[idx\]\|turns\[i\]' ios/App/ChatView.swift` — 새 함수에 `await` 뒤 색인 접근이 없다. `grep -n 'settle(' ios/App/ChatView.swift`에서 새 함수의 호출이 모두 epoch 인자를 넘긴다. `mail_action` 분기에 `record.reply =`가 없다. `grep -n 'DiagLog.append\|Trace.log' ios/App/ChatView.swift ios/App/GoogleSignIn.swift | grep -i 'mail\|upgrade'` — 조건·발신자·제목·코드 문자열 값이 없다.

- [ ] **Step 8: 커밋**

```bash
git add ios/App/MailCleanupAPI.swift ios/App/MailCleanupCard.swift ios/App/ChatView.swift ios/App/GoogleSignIn.swift ios/App/ContentView.swift ios/App/EruriApp.swift
git commit -m "feat(ios): mail cleanup in chat — a mail_action reply turns the question into a mail turn (reply not saved) and previews with the mail fields as-is; the card shows server-confirmed conditions, counts and top 20, the action button is the confirmation (gone on tap), expired previews offer re-preview, execution and undo poll status every 3 s and resume on reopen, results offer a one-time undo within 7 days and next 1,000 as a new turn; Settings › Gmail shows Update permission only when scopes lack modify (read separately, hidden before 0030) and upgrades via restore/addScopes without disconnect; new connections ask readonly + modify

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task M10: 배포 — `0030` 적용 → 워커 → `mail-action`·`gmail-connect` → 플래그 → `MAIL-deploy` (③c2 뒤)

**Files:**
- Move: `supabase/migrations-pending/0030_mail_cleanup.sql` → `supabase/migrations/`(`git mv`), `supabase/tests/_mail-sql.ts`의 `MIGRATION_0030` 경로
- Create: `supabase/scripts/smoke-mail.ts`
- Apply: 호스팅 DB `0030`, 배포 `worker`·`mail-action`·`gmail-connect`, secret `MAIL_ACTIONS=on`
- Modify: `docs/superpowers/phase1/gates.md`(`MAIL-server` 통과, `MAIL-deploy` 새 행)

**Interfaces:**
- Consumes: M1~M7 커밋, U6b Step 3b(0029 적용), M3 `mail-actions-db.test.ts`.
- Produces: 배포된 서버(M11·M12가 쓴다), `smoke-mail.ts`(배포 회귀 도구 — 커밋).

- [ ] **Step 1: 선행 확인(하나라도 없으면 멈춘다)**

Run: `grep -n '③c2\|PoC-6' docs/superpowers/phase1/gates.md | tail -3; grep -n 'UNS-server' docs/superpowers/phase1/gates.md; grep -n 'MAIL-server\|INTENT-eval' docs/superpowers/phase1/gates.md; supabase migration list 2>/dev/null | tail -4; ls supabase/migrations-pending/; date '+%F %H:%M %Z'; pgrep -x xcodebuild || echo none`
Expected: ③c2 완료 기록(10-08 15:00 KST 이후), `UNS-server` 행에 U6b Step 3b "0029 적용" 기록, `INTENT-eval` mail 판정(M7) 통과, `MAIL-server` 대기 행, 원격 마이그레이션 목록 끝이 `0029`, `migrations-pending/`에 `0030_mail_cleanup.sql`만, 지금이 10-08 16:30 KST 이후(smoke의 chat 단계가 실호출 — Global Constraints), `none`. 메인에게 M2 ⑩b·다른 배포가 진행 중이 아님을 확인받는다.

- [ ] **Step 2: 전체 테스트(이제 호스팅 DB 사례 포함)**

Run: `deno test --allow-net --allow-env --allow-read --allow-write=/tmp --env-file=supabase/.env supabase/tests/ --ignore=supabase/tests/mail-actions-db.test.ts && deno check supabase/functions/{worker,mail-action,gmail-connect,chat,unsubscribe,gmail-webhook,ingest,account}/index.ts supabase/scripts/*.ts`
Expected: 0 실패(ignored 수는 직전 기록과 같음), 무오류. 실패가 이 계획과 무관하면 원인을 적고 메인에게 알린다 — 남의 행은 지우지 않는다.

- [ ] **Step 3: 호스팅 트랜잭션 DB 테스트 → `0030` 적용**

Run: `deno test --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/tests/mail-actions-db.test.ts`
Expected: `hosted:` 16 통과(0030을 트랜잭션 안에서만 적용·롤백 — 아직 운영 DB에 없다). 실패면 멈춘다(PGlite와 Supabase의 차이 — SQL을 고치고 M3 Step 5부터 다시).

Run: `git mv supabase/migrations-pending/0030_mail_cleanup.sql supabase/migrations/ && sed -i '' 's#"../migrations-pending/0030_mail_cleanup.sql"#"../migrations/0030_mail_cleanup.sql"#' supabase/tests/_mail-sql.ts && rmdir supabase/migrations-pending 2>/dev/null; git status --short`
Expected: `R  …/0030_mail_cleanup.sql`·`M supabase/tests/_mail-sql.ts`만. `migrations-pending`에 다른 파일이 남았으면 `rmdir`이 실패하고 남는다 — 그대로 둔다.

Run: `supabase db push --dry-run`
Expected: 적용 대상이 `0030_mail_cleanup.sql` **하나뿐**. 다른 파일이 보이면 push하지 않고 멈춰 메인에게 알린다.

Run: `supabase db push --yes && deno test --allow-net --allow-env --allow-read --allow-write=/tmp --env-file=supabase/.env supabase/tests/mail-actions-db.test.ts supabase/tests/mail-sql.test.ts supabase/tests/unsub-db.test.ts supabase/tests/jobs-priority-db.test.ts supabase/tests/retention-db.test.ts`
Expected: 적용 성공, 테스트 전부 통과(이제 `mail-actions-db`는 배포본을 그대로 쓰고 롤백, PGlite는 옮긴 경로를 읽는다, 기존 우선순위·보관·광고 DB 테스트 회귀 없음). `cron.job`에 `mail-actions-purge-daily`(`53 4 * * *`). cron을 수동으로 돌리지 않는다.

```bash
git add supabase/migrations/0030_mail_cleanup.sql supabase/tests/_mail-sql.ts
git commit -m "chore(db): move 0030 mail cleanup into supabase/migrations/ and apply it after ③c2 and U6b's 0029 (hosted rolled-back test passed first)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 4: 워커 배포·회귀**

U6b Step 7이 `UNS-server` 행에 적은 배포 HEAD를 `$U6B`로 둔다.

Run: `git diff --stat $U6B..HEAD -- supabase/functions/_shared supabase/functions/worker`
Expected: 이 계획의 파일만 — `_shared/gmail.ts`·`_shared/gmail-jobs.ts`·`_shared/mail-query.ts`·`worker/index.ts`·`worker/mail-action.ts`·`worker/mail-action-deps.ts`. 그 밖의 변경이 보이면 멈추고 메인에게 알린다(배포 귀속, D2).

Run: `supabase functions deploy worker`
Expected: 성공. 배포 시각(KST)·HEAD·버전을 적는다.

Run: `deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/smoke-gate.ts && deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/gmail-gate.ts status`
Expected: `{"gate":"pass",…}`, dead `gmail-fetch`·`gmail-sync` 0, 연결 `active`(직전 값과 같은 꼴).

관찰(게이트 아님): 다음 gmail-sync가 돈 뒤(Pub/Sub 또는 6시간 cron) `deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/sql.ts "select count(*) as rows, coalesce(sum(used),0) as used from gmail_units where user_id = \$1 and minute > now() - interval '1 hour'" "$ERURI_USER_ID"`로 수집 기록이 쌓이는지(숫자만) 본다. 0이어도 실패가 아니다(그 시간에 메일이 없었을 수 있다). `units_note_error` 로그 줄 수를 대시보드 worker 로그에서 센다(0이 기대).

- [ ] **Step 5: `mail-action`·`gmail-connect` 배포**

Run: `git log --oneline -8 -- supabase/functions/gmail-connect supabase/functions/mail-action && supabase functions deploy mail-action && supabase functions deploy gmail-connect`
Expected: 이 계획의 M5·M6 커밋만 새로 보이고, 두 배포 성공.

- [ ] **Step 6: 플래그 켜기 + 배포 스모크**

`supabase/scripts/smoke-mail.ts`:

```ts
// 배포 스모크 MAIL-deploy(계획 M10): 배포된 mail-action·gmail-connect·chat·worker. 테스트 사용자 22 전용 — Google 계정이 없어 Gmail 은 불리지 않는다
// (토큰 없음 → 409·워커가 no_connection 으로 마감). 출력은 단계 이름·상태 코드·불리언·개수만. 끝나면 이 사용자의 이번 실행 행만 지운다(AGENTS.md §7)
import { createClient } from "npm:@supabase/supabase-js@2";
import { SERVER_AUTH } from "../functions/_shared/crypto.ts";
import { service as sb, testUser } from "../tests/_testenv.ts";

const BASE = Deno.env.get("SUPABASE_URL")!.replace(/\/+$/, ""), ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const RO = "https://www.googleapis.com/auth/gmail.readonly", MOD = "https://www.googleapis.com/auth/gmail.modify";
const FINISHED = ["done", "partial", "failed", "undone", "undo_partial", "undo_failed"];
const started = new Date().toISOString();
const u = await testUser(22);
const c = createClient(BASE, ANON, SERVER_AUTH);
const { data: si, error: se } = await c.auth.signInWithPassword({ email: u.email, password: u.password });
if (se || !si.session) throw new Error("signin " + se?.code);
const jwt = si.session.access_token;

type R = { status: number; j: Record<string, unknown> | null };
async function call(path: string, body?: unknown, auth = true): Promise<R> {
  const r = await fetch(`${BASE}/functions/v1/${path}`, { method: body === undefined ? "GET" : "POST",
    headers: { apikey: ANON, "content-type": "application/json", ...(auth ? { authorization: `Bearer ${jwt}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text();
  let j: Record<string, unknown> | null = null;
  try { j = JSON.parse(t); } catch { /* 본문 없음 */ }
  return { status: r.status, j };
}
const out: Record<string, unknown> = {};
let failed = false;
const check = (name: string, ok: boolean, got: unknown) => { out[name] = ok ? "ok" : got; if (!ok) failed = true; };
const mail = (x: Record<string, unknown> = {}) =>
  ({ action: "trash", sender: "합성상점", subject_words: [], received_from: null, received_to: null, promotions: true, unread_only: false, ...x });
async function seed(conn: string, ids: string[]): Promise<string> {
  const { data, error } = await sb.rpc("mail_action_preview", { p_user: u.id, p_connection: conn, p_action: "trash", p_ids: ids });
  if (error || !data) throw new Error("seed " + error?.code);
  return data as string;
}
async function waitFinished(id: string, ms = 120_000): Promise<R> {
  const end = Date.now() + ms;
  let r = await call(`mail-action/status?id=${id}`);
  while (Date.now() < end && !FINISHED.includes(String(r.j?.status))) {
    await new Promise((x) => setTimeout(x, 3000));
    r = await call(`mail-action/status?id=${id}`);
  }
  return r;
}

let conn: string | null = null;
try {
  check("unauthorized", (await call("mail-action/preview", mail(), false)).status === 401, "-");
  const nc = await call("mail-action/preview", mail());
  check("no_connection", nc.status === 404 && nc.j?.error === "no_connection", nc.status);
  const ins = await sb.from("connections").insert({ user_id: u.id, provider: "gmail", status: "active", scopes: [RO],
    account_ref: `smoke-mail-${crypto.randomUUID().slice(0, 8)}@example.com` }).select("id").single();
  if (ins.error) throw new Error("conn " + ins.error.code);
  conn = ins.data.id as string;
  const sm = await call("mail-action/preview", mail());
  check("scope_missing", sm.status === 403 && sm.j?.error === "scope_missing", sm.status);
  await sb.from("connections").update({ scopes: [RO, MOD] }).eq("id", conn).eq("user_id", u.id);
  const bc = await call("mail-action/preview", mail({ received_from: "2026-02-30" }));
  check("bad_condition", bc.status === 400 && JSON.stringify(bc.j) === JSON.stringify({ error: "bad_condition", fields: ["received_from"] }), bc.status);
  const nt = await call("mail-action/preview", mail({ sender: null, promotions: false }));
  check("needs_target", nt.status === 400 && nt.j?.error === "needs_target", nt.status);
  const ra = await call("mail-action/preview", mail());
  check("reauth_without_token", ra.status === 409 && ra.j?.error === "reauth_required", ra.status);

  const tok = await seed(conn, ["smoke-1", "smoke-2", "smoke-3"]);
  const e1 = await call("mail-action/execute", { token: tok });
  check("execute_202", e1.status === 202 && e1.j?.status === "pending", e1.status);
  check("execute_again_200", (await call("mail-action/execute", { token: tok })).status === 200, "-");
  const fin = await waitFinished(tok);
  check("worker_closed", fin.j?.status === "failed" && fin.j?.code === "no_connection" && fin.j?.failed === 3 && fin.j?.done === 0, fin.j?.status);
  const e3 = await call("mail-action/execute", { token: tok });
  check("execute_after_close_200", e3.status === 200 && e3.j?.status === "failed", e3.status);
  const jobs = await sb.from("jobs").select("id", { count: "exact", head: true }).eq("user_id", u.id).eq("kind", "mail-action").eq("payload->>id", tok);
  check("one_job", jobs.count === 1, jobs.count);

  const old = await seed(conn, ["smoke-4"]);
  await sb.from("mail_actions").update({ created_at: new Date(Date.now() - 11 * 60_000).toISOString() }).eq("id", old).eq("user_id", u.id);
  const ex = await call("mail-action/execute", { token: old });
  check("token_expired", ex.status === 410 && ex.j?.error === "token_expired", ex.status);
  check("unknown_token", (await call("mail-action/execute", { token: crypto.randomUUID() })).status === 404, "-");

  const nu = await call("mail-action/undo", { id: tok });
  check("undo_nothing", nu.status === 409 && nu.j?.error === "nothing_to_undo", nu.status);
  const dn = await seed(conn, ["smoke-5", "smoke-6", "smoke-7"]);
  await sb.from("mail_actions").update({ status: "done", cursor: 3, ok_ids: ["smoke-5", "smoke-6", "smoke-7"], method: "batch",
    executed_at: new Date().toISOString() }).eq("id", dn).eq("user_id", u.id);
  const u1 = await call("mail-action/undo", { id: dn });
  check("undo_202", u1.status === 202 && u1.j?.status === "undo_pending", u1.status);
  const uf = await waitFinished(dn);
  check("undo_closed", uf.j?.status === "undo_failed" && uf.j?.undo_failed === 3, uf.j?.status);
  const u2 = await call("mail-action/undo", { id: dn });
  check("undo_once", u2.status === 200 && u2.j?.status === "undo_failed", u2.status);
  check("status_bad_id", (await call("mail-action/status?id=x")).status === 400, "-");
  check("status_unknown", (await call(`mail-action/status?id=${crypto.randomUUID()}`)).status === 404, "-");

  const before = await sb.from("connections").select("status,scopes,expires_at").eq("id", conn).single();
  const bu = await call("gmail-connect", { code: "x", upgrade: "yes" });
  check("upgrade_bad", bu.status === 400 && bu.j?.error === "bad_upgrade", bu.status);
  const bx = await call("gmail-connect", { code: "bogus-code", upgrade: true });
  check("upgrade_bogus_502", bx.status === 502 && bx.j?.error === "token_exchange_failed", bx.status);
  const after = await sb.from("connections").select("status,scopes,expires_at").eq("id", conn).single();
  check("upgrade_left_connection", JSON.stringify(before.data) === JSON.stringify(after.data), "changed");

  const q = "합성상점에서 온 광고 메일 휴지통에 버려줘";
  const c1 = await call("chat", { question: q, intents: ["add_event", "mail_action"] });
  check("chat_mail_action", c1.status === 200 && c1.j?.intent === "mail_action" && (c1.j?.mail as { action?: string } | null)?.action === "trash", c1.j?.intent);
  const c2 = await call("chat", { question: q, intents: ["add_event"] });
  check("chat_without_mail_intent", c2.status === 200 && c2.j?.intent === "question" && c2.j?.mail === null, c2.j?.intent);
  const c3 = await call("chat", { question: q });
  check("chat_old_app", c3.status === 200 && c3.j?.intent === "question", c3.j?.intent);
} finally {
  // deno-lint-ignore no-explicit-any
  const del = async (t: string, f: (b: any) => any) => { const r = await f(sb.from(t).delete({ count: "exact" })); return r.error ? r.error.code : r.count; };
  out.cleanup = {
    audit: await del("audit_log", (b) => b.eq("user_id", u.id).in("actor", ["mail-action", "chat"]).gte("at", started)),
    jobs: await del("jobs", (b) => b.eq("user_id", u.id).eq("kind", "mail-action")),
    units: await del("gmail_units", (b) => b.eq("user_id", u.id)),
    usage: await del("usage_counters", (b) => b.eq("user_id", u.id)),
    slots: await del("llm_slots", (b) => b.eq("user_id", u.id)),
    conn: conn ? await del("connections", (b) => b.eq("user_id", u.id).eq("id", conn)) : 0,      // mail_actions 는 cascade
  };
}
console.log(JSON.stringify({ smoke: failed ? "fail" : "pass", ...out }));
if (failed) Deno.exit(1);
```

Run: `supabase secrets set MAIL_ACTIONS=on && sleep 5 && deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/smoke-mail.ts`
Expected: `{"smoke":"pass", …, "cleanup":{…}}` — 모든 단계 `ok`. `chat_mail_action`만 실패하면(새 값이 아직 안 읽힘) 1분 뒤 한 번 더 돌리고, 그래도 `question`이면 `git diff <0.13.0 A3 배포 HEAD>..HEAD -- supabase/functions/chat`이 비었는지(M7에서 고쳤으면 M7 재배포 HEAD) 확인한 뒤 `supabase functions deploy chat`(같은 코드)으로 새 인스턴스를 띄우고 다시 돈다. 다른 단계가 실패하면 **`supabase secrets set MAIL_ACTIONS=off`** 로 되돌리고 멈춘다(0.13.0 앱은 `mail_action`을 보내지 않으므로 그동안 사용자 영향 없음).

- [ ] **Step 7: 기록·커밋**

`docs/superpowers/phase1/gates.md`: `MAIL-server` 행을 **통과**로 바꾸고 근거 끝에 `· 호스팅 트랜잭션 DB 16/16(<KST>, 적용 전), 적용 후 재실행 16/16`을 붙인다. 새 행:

```
| MAIL-deploy | 메일 정리 배포 스모크(스펙 §15): 0030 적용, worker·mail-action·gmail-connect 배포, MAIL_ACTIONS=on, smoke-mail(사용자 22) 전 단계, 수집 회귀 | 통과 | <KST>. 0030 push <KST>(cron mail-actions-purge-daily). worker v<n>(HEAD <sha>, $U6B 이후 이 계획 파일만) — smoke-gate pass, gmail-gate dead 0. mail-action v<n>·gmail-connect v<n>. smoke-mail <JSON 한 줄>. gmail_units 관찰 <rows/used 또는 미관측>, units_note_error <n>줄 | | <날짜> |
```

```bash
git add supabase/scripts/smoke-mail.ts docs/superpowers/phase1/gates.md
git commit -m "docs(gates): MAIL-server pass (hosted rolled-back DB run added) and MAIL-deploy pass — 0030 applied after U6b, worker then mail-action and gmail-connect deployed with collection regressions clean, MAIL_ACTIONS on, deploy smoke covers errors, token reuse and expiry, worker close without a token, undo once, malformed upgrade, and intents gating

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task M11: 시뮬레이터 게이트 `MAIL-sim` → 0.14.0

**Files:**
- Create(커밋 안 함, D19): `.context/gate0140/`(`seed.ts`·`inject.py`·`MailGate.swift.txt`·`cleanup.ts` + gate0120에서 복사해 고친 `token.ts`·`inject.sh`·`drive.sh`·`diag.sh`·`GateHost.swift.txt`·`project.gate0140.yml.txt`·`udid`), 임시 `ios/project.gate0140.yml`·`ios/GateHostTests/`·`ios/GateUITests/`(끝나면 지운다)
- Modify: `ios/project.yml:13`(0.14.0 — 통과 뒤), `docs/superpowers/phase1/gates.md`(`MAIL-sim`)

**Interfaces:**
- Consumes: M9 화면 식별자, M10 배포된 서버(사용자 23은 Google 계정이 없다 — 미리보기는 409·실행은 워커가 `no_connection`으로 마감), 0.13.0 `ADD-sim` 통과.
- Produces: `MAIL-sim` 통과, `MARKETING_VERSION: 0.14.0` 커밋(M12 TestFlight).

**왜 이 게이트가 필요한가:** 테스트 사용자에게는 Gmail이 없어 실제 미리보기 목록을 만들 수 없다. 그래서 서버가 만들어 주는 경로(오류 문구·실행·되돌리기·재개)는 **배포된 서버 그대로** 돌리고, 미리보기 카드 자체는 서버 응답과 같은 모양을 대화 기록에 주입해 그린다. 실제 Gmail 목록·휴지통은 MAIL-real이 본다.

| G | 확인 | 방법 |
|---|---|---|
| G1 | Gmail 미연결 → "Gmail이 연결되어 있지 않아요" | 채팅(실호출) |
| G2 | readonly 연결 → "권한 업데이트가 필요해요" + [설정 열기] → 설정 탭·[권한 업데이트] 보임 | 채팅 |
| G3 | modify·토큰 없음 → 범위 없는 요청 "발신자·제목·기간·광고 중 하나" / 조건 있는 요청 "연결이 끊겼어요" | 채팅 |
| G4 | 주입 미리보기: 조건 줄·건수·버튼 문구·표본 → [휴지통으로 이동] → 버튼 바로 사라짐 → 진행 → 결과(성공 0, 권한(연결) 문구 + [설정 열기]), [되돌리기] 없음 | 주입 + 배포 서버·워커 |
| G5 | 10분 지난 미리보기 → "미리보기가 만료됐어요" + [다시 미리보기](실행 버튼 없음) → 다시 미리보기가 서버를 부름(409 문구) | 주입 |
| G6 | 결과(done 3) → [되돌리기] → 되돌리기 결과(토큰 없음 → "되돌리지 못했어요 — Gmail 휴지통에서…"), [되돌리기] 사라짐 | 주입 + 서버 |
| G7 | 앱을 새로 열 때 진행 중 턴이 상태를 다시 읽고, 서버가 끝나면 결과·[되돌리기]로 바뀜 | 주입 + 드라이버가 행을 done으로 |
| G8 | [다음 1,000건 보기] → 새 턴("다음 1,000건 보기")이 생기고 앞 카드의 [되돌리기]는 그대로 | 주입 + 서버 |
| G9 | [취소] → "취소했어요", 실행 버튼 없음, 서버 행은 previewed 그대로 | 주입 |
| G10 | 설정 [권한 업데이트]: readonly일 때만 보이고 modify·미연결이면 숨김 | 시드 |
| G11 | 기기 로그(eruri.log)에 합성 발신자·제목 0줄 | `diag.sh` |

- [ ] **Step 1: 선행 확인**

Run: `grep -n 'MAIL-deploy\|ADD-sim' docs/superpowers/phase1/gates.md; grep -n 'MARKETING_VERSION' ios/project.yml; pgrep -x deno || echo none; vm_stat | grep -E 'free|compressor'`
Expected: `MAIL-deploy` 통과, `ADD-sim` 통과, `MARKETING_VERSION: 0.13.0`, `none`. 실호출 창(Global Constraints) 밖인지 메인이 확인한다.

- [ ] **Step 2: 하네스 준비(gate0120 복사)**

Run: `mkdir -p .context/gate0140/shots && cd .context/gate0140 && for f in token.ts inject.sh drive.sh diag.sh GateHost.swift.txt project.gate0120.yml.txt; do cp ../gate0120/$f .; done && mv project.gate0120.yml.txt project.gate0140.yml.txt && sed -i '' 's#gate0120#gate0140#g' inject.sh drive.sh diag.sh GateHost.swift.txt && sed -i '' 's/MARKETING_VERSION: 0.12.0/MARKETING_VERSION: 0.13.0/' project.gate0140.yml.txt && xcrun simctl create "ERURI gate0140" "iPhone 16 Pro" > udid && cat udid | wc -c`
Expected: UDID 한 줄(37자 근처). `drive.sh`의 `-only-testing` 인자는 `GateUITests/MailGate/<test>` 형식으로 쓴다. `diag.sh`의 grep을 `"\] (CHAT |trace chat.mail)"`로 바꾼다.

`.context/gate0140/seed.ts`:

```ts
// MAIL-sim(임시, 커밋 안 함): 테스트 사용자 23 의 합성 Gmail 연결·메일 정리 행. 출력은 단계·상태·개수만
// 사용: seed.ts conn none|readonly|modify · seed.ts rows · seed.ts finish-r3 · seed.ts status <r1|r1old|r2|r3|r4|r5>
import { service as sb, testUserId } from "../../supabase/tests/_testenv.ts";
const D = new URL(".", import.meta.url).pathname;
const RO = "https://www.googleapis.com/auth/gmail.readonly", MOD = "https://www.googleapis.com/auth/gmail.modify";
const user = await testUserId(23);
const read = () => { try { return JSON.parse(Deno.readTextFileSync(D + "run.json")); } catch { return {}; } };
const save = (o: Record<string, unknown>) => Deno.writeTextFileSync(D + "run.json", JSON.stringify({ ...read(), ...o }));
const now = () => new Date().toISOString();
const [cmd, arg] = Deno.args;
if (!read().started) save({ started: now(), user });
if (cmd === "conn") {
  await sb.from("connections").delete().eq("user_id", user).like("account_ref", "gate0140-%");      // mail_actions 는 cascade
  if (arg !== "none") {
    const { data, error } = await sb.from("connections").insert({ user_id: user, provider: "gmail", status: "active",
      account_ref: `gate0140-${crypto.randomUUID().slice(0, 8)}@example.com`, scopes: arg === "modify" ? [RO, MOD] : [RO] }).select("id").single();
    if (error) throw new Error("conn " + error.code);
    save({ conn: data.id });
  }
  console.log("conn", arg);
} else if (cmd === "rows") {
  const conn = read().conn as string;
  const mk = async (ids: string[]) => {
    const { data, error } = await sb.rpc("mail_action_preview", { p_user: user, p_connection: conn, p_action: "trash", p_ids: ids });
    if (error || !data) throw new Error("preview " + error?.code);
    return data as string;
  };
  const done = async (id: string, ids: string[]) => {
    const { error } = await sb.from("mail_actions").update({ status: "done", cursor: ids.length, ok_ids: ids, method: "batch", executed_at: now() }).eq("id", id).eq("user_id", user);
    if (error) throw new Error("done " + error.code);
  };
  const ids = { r1: await mk(["g-1", "g-2", "g-3"]), r1old: await mk(["g-4"]), r2: await mk(["g-5", "g-6", "g-7"]),
                r3: await mk(["g-8", "g-9", "g-10"]), r4: await mk(["g-11", "g-12", "g-13"]), r5: await mk(["g-14", "g-15", "g-16"]) };
  await sb.from("mail_actions").update({ created_at: new Date(Date.now() - 11 * 60_000).toISOString() }).eq("id", ids.r1old).eq("user_id", user);
  await done(ids.r2, ["g-5", "g-6", "g-7"]);
  await done(ids.r5, ["g-14", "g-15", "g-16"]);
  await sb.from("mail_actions").update({ status: "pending" }).eq("id", ids.r3).eq("user_id", user);   // 잡 없는 진행 중(G7) — 드라이버가 끝낸다
  Deno.writeTextFileSync(D + "ids.json", JSON.stringify(ids));
  console.log("rows", Object.keys(ids).length);
} else if (cmd === "finish-r3") {
  const { r3 } = JSON.parse(Deno.readTextFileSync(D + "ids.json"));
  await sb.from("mail_actions").update({ status: "done", cursor: 3, ok_ids: ["g-8", "g-9", "g-10"], method: "batch", executed_at: now() }).eq("id", r3).eq("user_id", user);
  console.log("r3 done");
} else if (cmd === "status") {
  const id = JSON.parse(Deno.readTextFileSync(D + "ids.json"))[arg];
  const { data } = await sb.from("mail_actions").select("status").eq("id", id).eq("user_id", user).single();
  console.log(arg, data?.status);
}
```

`.context/gate0140/inject.py`:

```python
# MAIL-sim 기록 주입(임시): 서버 미리보기 응답과 같은 모양의 메일 정리 턴. 합성 문구만, 글은 출력하지 않는다 — 개수만
import json, sys, time, uuid, os
D = os.path.dirname(os.path.abspath(__file__))
case, path = sys.argv[1], sys.argv[2]
ids = json.load(open(os.path.join(D, "ids.json")))
now = int(time.time())
COND = {"action": "trash", "sender": "합성상점", "subject_words": [], "received_from": "2026-09-01", "received_to": "2026-09-30", "promotions": True, "unread_only": False}
def preview(token, exact=True, total=3):
  return {"token": token, "action": "trash", "conditions": COND, "count": 3, "exact": exact, "total_estimate": total, "starred_estimate": 2,
          "has_more": not exact, "sample": [{"from": "합성상점", "subject": f"합성 광고 {i}", "date": "2026-09-2%dT01:00:00.000Z" % i} for i in (1, 2, 3)]}
def status(token, st, done=0):
  return {"id": token, "status": st, "total": 3, "done": done, "failed": 0, "undone": 0, "undo_failed": 0, "code": None, "method": "batch"}
def turn(at, mail, q="합성상점에서 온 광고 메일 휴지통에 버려줘"):
  m = {"settings": False, "repreview": False, "retry": False}; m.update(mail)
  return {"id": str(uuid.uuid4()).upper(), "at": at, "kind": "mailAction", "question": q, "linkDone": False, "linkSaved": False, "judged": {}, "mail": m}
C = {
  "g4": [turn(now - 30, {"phase": "preview", "preview": preview(ids["r1"]), "previewAt": now - 30})],
  "g5": [turn(now - 660, {"phase": "preview", "preview": preview(ids["r1old"]), "previewAt": now - 660})],
  "g6": [turn(now - 3600, {"phase": "ended", "preview": preview(ids["r2"]), "previewAt": now - 3600, "status": status(ids["r2"], "done", 3)})],
  "g7": [turn(now - 60, {"phase": "running", "preview": preview(ids["r3"]), "previewAt": now - 60, "status": status(ids["r3"], "pending")})],
  "g8": [turn(now - 3600, {"phase": "ended", "preview": preview(ids["r5"], exact=False, total=1234), "previewAt": now - 3600, "status": status(ids["r5"], "done", 3)})],
  "g9": [turn(now - 30, {"phase": "preview", "preview": preview(ids["r4"]), "previewAt": now - 30})],
}
if case not in C: sys.exit("unknown case")
os.makedirs(os.path.dirname(path), exist_ok=True)
json.dump({"version": 1, "records": C[case]}, open(path, "w"), ensure_ascii=False)
print("injected", case, "records", len(C[case]))
```

`.context/gate0140/MailGate.swift.txt`(→ `ios/GateUITests/MailGate.swift`):

```swift
import XCTest

/// 0.14.0 시뮬레이터 게이트 MAIL-sim(임시, 커밋 안 함). 합성 문구만. 화면 글은 출력하지 않는다 — 불리언·개수만.
/// 연결·행 시드(seed.ts)·기록 주입(inject.sh)·DiagLog 확인은 셸 드라이버가 테스트 사이에 한다
@MainActor final class MailGate: XCTestCase {
  let app = XCUIApplication(bundleIdentifier: "com.picpal.eruri")
  let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
  override func setUp() { continueAfterFailure = true }
  func log(_ s: String) { print("GATE: \(s)") }
  func id(_ s: String) -> XCUIElementQuery { app.descendants(matching: .any).matching(identifier: s) }
  func first(_ s: String, _ t: TimeInterval = 10) -> XCUIElement? { let e = id(s).firstMatch; return e.waitForExistence(timeout: t) ? e : nil }
  func launch() {
    app.launch()
    for l in ["Allow", "허용"] where springboard.buttons[l].waitForExistence(timeout: 1) { springboard.buttons[l].tap() }
  }
  func ask(_ q: String) {
    let f = app.textFields["질문하기"].exists ? app.textFields["질문하기"] : app.textViews.firstMatch
    f.tap(); f.typeText(q); app.buttons["보내기"].tap()
  }
  func waitLabel(_ ident: String, _ part: String, _ t: TimeInterval) -> Bool {
    let end = Date().addingTimeInterval(t)
    while Date() < end {
      if id(ident).allElementsBoundByIndex.contains(where: { $0.label.contains(part) }) { return true }
      usleep(500_000)
    }
    return false
  }
  let ask1 = "합성상점에서 온 광고 메일 휴지통에 버려줘"

  func test01_G1_noConnection() {
    launch(); ask(ask1)
    log("G1 note=\(waitLabel("mail-note", "연결되어 있지 않아요", 60)) card=\(id("mail-card").count)")
  }
  func test02_G2_scopeMissing() {
    launch(); ask(ask1)
    let note = waitLabel("mail-note", "권한 업데이트가 필요해요", 60)
    let open = first("mail-open-settings", 5); open?.tap()
    log("G2 note=\(note) openSettings=\(open != nil) upgradeVisible=\(first("settings-gmail-upgrade", 10) != nil)")
  }
  func test03_G3_needsTargetAndReauth() {
    launch(); ask("받은편지함 메일 다 휴지통에 버려줘")
    let nt = waitLabel("mail-note", "발신자·제목·기간·광고", 60)
    ask(ask1)
    log("G3 needsTarget=\(nt) reauth=\(waitLabel("mail-note", "연결이 끊겼어요", 60))")
  }
  func test04_G4_previewExecute() {
    launch()
    let cond = first("mail-conditions", 20)?.label == "발신자 '합성상점' · 광고 · 9/1–9/30 · 별표 제외"
    let count = first("mail-count")?.label == "3건 · 별표 약 2건 제외"
    let btn = first("mail-execute")
    let label = btn?.label == "휴지통으로 이동 (3건)"
    let samples = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "합성 광고")).count
    btn?.tap()
    let gone = id("mail-execute").count == 0
    let result = waitLabel("mail-result", "옮기지 못했어요", 90)
    log("G4 cond=\(cond) count=\(count) button=\(label) samples=\(samples) goneOnTap=\(gone) result=\(result) perm=\(waitLabel("mail-result", "권한(연결)", 1)) settings=\(first("mail-open-settings", 2) != nil) undo=\(id("mail-undo").count)")
  }
  func test05_G5_expired() {
    launch()
    let exp = first("mail-expired", 20) != nil, exec = id("mail-execute").count
    first("mail-repreview")?.tap()
    log("G5 expired=\(exp) executeHidden=\(exec == 0) repreviewReauth=\(waitLabel("mail-note", "연결이 끊겼어요", 60))")
  }
  func test06_G6_undo() {
    launch()
    let res = waitLabel("mail-result", "휴지통으로 3건 옮겼어요", 20)
    first("mail-undo")?.tap()
    let failed = waitLabel("mail-result", "되돌리지 못했어요", 90)
    log("G6 result=\(res) undoFailed=\(failed) manual=\(waitLabel("mail-result", "Gmail 휴지통에서", 1)) undoGone=\(id("mail-undo").count == 0)")
  }
  func test07_G7_resume() {
    launch()                                                  // 드라이버가 약 15초 뒤 r3 를 done 으로 바꾼다
    let prog = first("mail-progress", 20) != nil
    let res = waitLabel("mail-result", "휴지통으로 3건 옮겼어요", 60)
    log("G7 progressOnOpen=\(prog) resultAfterServerDone=\(res) undo=\(first("mail-undo", 5) != nil)")
  }
  func test08_G8_next() {
    launch()
    let before = id("mail-card").count
    first("mail-next", 20)?.tap()
    let newTurn = waitLabel("chat-question", "다음 1,000건 보기", 20)
    let reauth = waitLabel("mail-note", "연결이 끊겼어요", 60)
    log("G8 cardsBefore=\(before) after=\(id("mail-card").count) newTurn=\(newTurn) reauth=\(reauth) firstUndoKept=\(id("mail-undo").count >= 1)")
  }
  func test09_G9_cancel() {
    launch()
    first("mail-cancel", 20)?.tap()
    log("G9 cancelled=\(waitLabel("mail-note", "취소했어요", 5)) executeGone=\(id("mail-execute").count == 0)")
  }
  func test10_G10_settings() {
    launch(); app.tabBars.buttons["설정"].tap()
    log("G10 upgradeVisible=\(first("settings-gmail-upgrade", 10) != nil)")
  }
}
```

`.context/gate0140/cleanup.ts`:

```ts
// MAIL-sim 정리(임시): 사용자 23 의 이번 실행 행만. 남은 행 수 출력
import { service as sb } from "../../supabase/tests/_testenv.ts";
const D = new URL(".", import.meta.url).pathname;
const { user, started } = JSON.parse(Deno.readTextFileSync(D + "run.json"));
const n = async (p: PromiseLike<{ count: number | null; error: { code?: string } | null }>) => { const r = await p; return r.error ? r.error.code : r.count; };
console.log(JSON.stringify({
  conns: await n(sb.from("connections").delete({ count: "exact" }).eq("user_id", user).like("account_ref", "gate0140-%")),   // mail_actions cascade
  jobs: await n(sb.from("jobs").delete({ count: "exact" }).eq("user_id", user).eq("kind", "mail-action")),
  audit: await n(sb.from("audit_log").delete({ count: "exact" }).eq("user_id", user).in("actor", ["mail-action", "chat"]).gte("at", started)),
  units: await n(sb.from("gmail_units").delete({ count: "exact" }).eq("user_id", user)),
  usage: await n(sb.from("usage_counters").delete({ count: "exact" }).eq("user_id", user)),
  slots: await n(sb.from("llm_slots").delete({ count: "exact" }).eq("user_id", user)),
  traces: await n(sb.from("device_traces").delete({ count: "exact" }).eq("user_id", user).gte("received_at", started)),
  left_rows: (await sb.from("mail_actions").select("*", { count: "exact", head: true }).eq("user_id", user)).count,
}));
```

- [ ] **Step 3: 빌드·로그인 주입**

Run: `cp .context/gate0140/project.gate0140.yml.txt ios/project.gate0140.yml && mkdir -p ios/GateHostTests ios/GateUITests && cp .context/gate0140/GateHost.swift.txt ios/GateHostTests/GateHost.swift && cp .context/gate0140/MailGate.swift.txt ios/GateUITests/MailGate.swift && (cd ios && ./scripts/sim.sh config && xcodegen -s project.gate0140.yml && xcodebuild -project EruriGate.xcodeproj -scheme EruriGate -destination "platform=iOS Simulator,id=$(cat ../.context/gate0140/udid)" -derivedDataPath build-gate build-for-testing > ../.context/gate0140/build.log 2>&1; echo exit=$?) && deno run --allow-net --allow-env --allow-read --allow-write --env-file=supabase/.env .context/gate0140/token.ts one 23 .context/gate0140/rt && .context/gate0140/drive.sh GateHostTests/GateHost/test1_inject`
Expected: `exit=0`, `rt written true`, `GATE: injected=true`. (`sim.sh config`가 없는 하위 명령이면 gate0120 기록(`.context/gate0120/last.log`)의 순서를 따른다.)

- [ ] **Step 4: 실행(사례 순서 고정 — 연결을 바꾸면 행이 cascade로 지워지므로 G1~G3 → 행 시드 → G4~G9 → G10)**

```bash
G=.context/gate0140; S="deno run --allow-net --allow-env --allow-read --allow-write --env-file=supabase/.env $G/seed.ts"; T=GateUITests/MailGate
$S conn none;     $G/inject.sh none; $G/drive.sh $T/test01_G1_noConnection
$S conn readonly; $G/inject.sh none; $G/drive.sh $T/test02_G2_scopeMissing
$S conn modify;   $G/inject.sh none; $G/drive.sh $T/test03_G3_needsTargetAndReauth
$S rows
$G/inject.sh g4; $G/drive.sh $T/test04_G4_previewExecute
$G/inject.sh g5; $G/drive.sh $T/test05_G5_expired
$G/inject.sh g6; $G/drive.sh $T/test06_G6_undo
$G/inject.sh g7; (sleep 15; $S finish-r3) & $G/drive.sh $T/test07_G7_resume; wait
$G/inject.sh g8; $G/drive.sh $T/test08_G8_next
$G/inject.sh g9; $G/drive.sh $T/test09_G9_cancel; $S status r4
for m in modify readonly none; do $S conn $m; $G/inject.sh none; $G/drive.sh $T/test10_G10_settings; done
$G/diag.sh 40 | wc -l; L="$(xcrun simctl get_app_container "$(cat $G/udid)" com.picpal.eruri group.com.picpal.eruri)/eruri.log"; grep -c '합성상점\|합성 광고' "$L"
```

Expected(`GATE:` 줄):
- G1 `note=true card=1`
- G2 `note=true openSettings=true upgradeVisible=true`
- G3 `needsTarget=true reauth=true`(needsTarget이 false면 모델이 범위를 채운 것 — 그 줄의 `mail-note` 대신 미리보기 카드가 떴는지 기록하고 "광고 메일 말고 받은편지함 메일 전부 휴지통에 버려줘"로 한 번 더. 그래도 false면 실패로 적고 메인에게 — INTENT-eval 사례 추가 후보)
- G4 `cond=true count=true button=true samples=3 goneOnTap=true result=true perm=true settings=true undo=0`
- G5 `expired=true executeHidden=true repreviewReauth=true`
- G6 `result=true undoFailed=true manual=true undoGone=true`
- G7 `progressOnOpen=true resultAfterServerDone=true undo=true`
- G8 `cardsBefore=1 after=2 newTurn=true reauth=true firstUndoKept=true`
- G9 `cancelled=true executeGone=true`, `r4 previewed`
- G10 세 줄 `upgradeVisible=false`(modify), `true`(readonly), `false`(none)
- G11 `diag.sh` 줄 수 > 0(코드·개수 줄이 있다), 합성 문구 grep **0**

하나라도 다르면 실패 사례와 `GATE:` 줄만 적고, 앱 문제면 M9 수정 커밋 → 그 사례만 다시. 서버 문제면 메인에게 알린다.

- [ ] **Step 5: 정리·기록·0.14.0**

Run: `deno run --allow-net --allow-env --allow-read --env-file=supabase/.env .context/gate0140/cleanup.ts && rm -rf ios/project.gate0140.yml ios/GateHostTests ios/GateUITests ios/EruriGate.xcodeproj ios/build-gate && xcrun simctl shutdown "$(cat .context/gate0140/udid)"; git status --short`
Expected: 정리 JSON의 `left_rows: 0`, `git status`에 하네스 파일 없음(`.context/`는 gitignore). `.context/gate0140/`는 M12 probe 때문에 M12 끝까지 둔다.

`docs/superpowers/phase1/gates.md`에 행을 더한다:

```
| MAIL-sim | 0.14.0 채팅 메일 정리 시뮬레이터(스펙 §15): G1 미연결 · G2 권한 없음 → 설정 · G3 범위 없음·연결 끊김 · G4 주입 미리보기(조건 줄·건수·버튼·표본) → 실행(버튼 즉시 사라짐) → 권한(연결) 결과 · G5 만료 → 다시 미리보기 · G6 되돌리기 한 번 · G7 재실행 뒤 상태 다시 읽기 · G8 다음 1,000건 = 새 턴 · G9 취소 · G10 [권한 업데이트] 표시 규칙 · G11 기기 로그 무본문 | 통과 | <KST>, 사용자 23, UDID 전용, 배포본(worker v<n>·mail-action v<n>·chat v<n>). GATE 줄 요약 <…>. 정리 left_rows 0 | | <날짜> |
```

Run: `sed -i '' 's/MARKETING_VERSION: 0.13.0/MARKETING_VERSION: 0.14.0/' ios/project.yml && grep -n 'MARKETING_VERSION' ios/project.yml && cd ios && ./scripts/sim.sh gen && ./scripts/sim.sh build`
Expected: `MARKETING_VERSION: 0.14.0`, BUILD SUCCEEDED.

```bash
git add ios/project.yml docs/superpowers/phase1/gates.md
git commit -m "chore(ios): 0.14.0 — mail cleanup from chat (preview card, confirm by button, server job with progress, one-time undo within 7 days, next 1,000) and Gmail permission update in Settings; MAIL-sim pass (G1–G11 on simulator against the deployed server)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task M12: TestFlight 0.14.0 → `MAIL-real`(실기기, 사용자 조작)

**Files:**
- Create(커밋 안 함): `.context/gate0140/probe.ts`, `.context/gate0140/ids-real.json`(합성 메일 3통의 Gmail id — 끝나면 지운다)
- Modify: `docs/superpowers/poc/results.md`(MAIL-real 단계별 판정), `docs/superpowers/phase1/gates.md`(`MAIL-real`), 필요하면 스펙 §7·§16(U1·U5 결과 반영)

**Interfaces:**
- Consumes: M11(0.14.0 커밋), M10 배포, `.context/gate0140/`, `supabase/scripts/sql.ts`·`gmail-gate.ts`.
- Produces: U1·U2(권한 reason)·U3·U4·U5·U6 판정, `MAIL-real` 행.

**사람이 필요한 이유:** U1·U3~U6은 실제 Google 계정의 Gmail에서만 재현된다(위 "실기기가 필요한 이유"). 합성 메일을 보내고, 권한 동의 화면을 누르고, Gmail 앱에서 휴지통·받은편지함을 눈으로 보는 것은 사용자만 할 수 있다. 메인은 한 번의 요청으로 묶는다(약 15분).

- [ ] **Step 1: 선행 확인·TestFlight**

Run: `grep -n 'MAIL-sim\|MAIL-deploy\|ADD-sim' docs/superpowers/phase1/gates.md; grep -n 'MARKETING_VERSION' ios/project.yml; pgrep -x deno || echo none; vm_stat | grep -E 'free|compressor'`
Expected: 세 행 통과, `0.14.0`, `none`.

Run: `cd ios && ./scripts/sim.sh gen && ./scripts/testflight.sh`
Expected: 0.14.0(빌드 `YYYYMMDDHHMM`) 업로드 성공, App Store Connect 처리 VALID. 빌드 번호를 적는다.

- [ ] **Step 2: probe 도구**

`.context/gate0140/probe.ts`:

```ts
// MAIL-real ⓪(임시, 커밋 안 함, 계획 D20): 실사용자 연결의 지금 토큰으로 제목 "[ERURI 테스트]" 합성 메일만 다룬다. 토큰·id·제목은 출력하지 않는다.
// ids   : 받은편지함에서 그 3통의 id 를 파일로(읽기)
// probe : 연결 scopes 에 modify 가 없을 때만, 그 3통에 batchModify(removeLabelIds UNREAD) 1회 → 상태·reason 만(권한이 없어 메일은 바뀌지 않는다)
import { GMAIL_MODIFY_SCOPE, gmailMailApi, GmailHttpError, refreshAccessToken } from "../../supabase/functions/_shared/gmail.ts";
import { service as sb } from "../../supabase/tests/_testenv.ts";
const D = new URL(".", import.meta.url).pathname;
const user = Deno.env.get("ERURI_USER_ID")!;
const { data: conns } = await sb.rpc("mail_connection", { p_user: user });
const c = (conns as { connection_id: string; scopes: string[] | null; status: string }[] | null)?.[0];
if (!c) { console.log(JSON.stringify({ probe: "no_connection" })); Deno.exit(1); }
const rt = (await sb.rpc("gmail_get_refresh_token", { p_user: user, p_connection: c.connection_id })).data as string | null;
if (!rt) { console.log(JSON.stringify({ probe: "no_token", status: c.status })); Deno.exit(1); }
const api = gmailMailApi(await refreshAccessToken(rt));
if (Deno.args[0] === "ids") {
  const p = await api.list('in:inbox subject:"ERURI 테스트"', 10);
  const ids = (p.messages ?? []).map((m) => m.id);
  Deno.writeTextFileSync(D + "ids-real.json", JSON.stringify(ids));
  console.log(JSON.stringify({ ids: ids.length }));
} else if (Deno.args[0] === "probe") {
  if ((c.scopes ?? []).includes(GMAIL_MODIFY_SCOPE)) { console.log(JSON.stringify({ probe: "skipped_already_modify" })); Deno.exit(0); }
  const ids = JSON.parse(Deno.readTextFileSync(D + "ids-real.json")) as string[];
  if (ids.length !== 3) { console.log(JSON.stringify({ probe: "need_3", n: ids.length })); Deno.exit(1); }
  try { await api.batchModify(ids, [], ["UNREAD"]); console.log(JSON.stringify({ probe: "accepted" })); }
  catch (e) { console.log(JSON.stringify({ probe: "rejected", status: e instanceof GmailHttpError ? e.status : -1, reasons: e instanceof GmailHttpError ? e.reasons : [] })); }
}
```

- [ ] **Step 3: 사용자에게 한 번에 요청(메인이 전달)**

"TestFlight 0.14.0을 설치해 주세요. 다른 메일 계정에서 본인 Gmail로 제목이 `[ERURI 테스트] 합성 1`, `[ERURI 테스트] 합성 2`, `[ERURI 테스트] 합성 3`인 메일 3통(본문은 아무 합성 문장)을 보내고 **읽지 말고** 두세요. 다 도착하면 알려 주세요. 그다음 단계마다 결과를 짧게 알려 주시면 됩니다(제목·주소는 알려 주지 않아도 돼요)."

- [ ] **Step 4: ⓪ probe(U2) → ① 권한 업데이트(U3)**

3통 도착 알림 뒤:

Run: `deno run --allow-net --allow-env --allow-read --allow-write --env-file=supabase/.env .context/gate0140/probe.ts ids && deno run --allow-net --allow-env --allow-read --allow-write --env-file=supabase/.env .context/gate0140/probe.ts probe`
Expected: `{"ids":3}` 뒤 `{"probe":"rejected","status":403,"reasons":["insufficientPermissions",…]}`. `reasons`에 `SCOPE_REASONS`의 값이 있으면 U2(권한 쪽) 통과. 다른 값이면 M2 `SCOPE_REASONS`에 더하는 수정 → `mail-action`·worker 재배포 → 다시 probe. `skipped_already_modify`면(주간 재연결이 이미 modify를 붙였다) U2 권한 reason은 "측정 기회 없음 — 문서 근거로 수용"으로 적고 계속한다. `accepted`면 **멈춘다**(readonly 토큰이 쓰기를 통과 — 권한 판단이 틀렸다; 합성 3통이 읽음이 됐을 수 있으니 사용자에게 Gmail에서 안 읽음으로 되돌려 달라고 하고 메인에게 보고).

기준값(숫자·불리언만)을 남긴다:

Run: `deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/sql.ts "select c.status, c.scopes @> array['https://www.googleapis.com/auth/gmail.modify'] as has_modify, c.expires_at, md5(s.cursor) as cursor_hash, (select count(*) from jobs j where j.user_id = c.user_id and j.kind = 'gmail-fetch' and j.payload->>'backfill' = 'true') as backfill_jobs from connections c join sync_states s on s.connection_id = c.id where c.user_id = \$1 and c.provider = 'gmail'" "$ERURI_USER_ID"`
Expected: 한 줄. `has_modify`(false가 보통 — `skipped_already_modify`면 true), `cursor_hash`·`backfill_jobs`를 적어 둔다(커서 값 자체는 보지 않는다).

사용자에게: "설정 → Gmail → [권한 업데이트]를 눌러 Google 화면에서 허용해 주세요(버튼이 없으면 '없음'). 화면 아래에 나온 문구를 알려 주세요. 그다음 다른 계정에서 제목 `[ERURI 대조] 합성 4` 메일을 하나 더 보내고 읽지 말고 두세요."

판정 ①(U3):
- 문구 "Gmail 권한을 업데이트했어요" → 위 SQL을 다시 돌려 `status = active`, `has_modify = true`, `expires_at`가 지금 + 약 7일, **`cursor_hash` 같음**, **`backfill_jobs` 같음**(백필 다시 안 함)이면 통과. 5분 안에 대조 메일이 수집되는지: `deno run … supabase/scripts/sql.ts "select count(*) from items where user_id = \$1 and source = 'GMAIL' and created_at > now() - interval '10 minutes'" "$ERURI_USER_ID"` ≥ 1(동기화가 새 토큰으로 이어진다 — 그 사이 다른 실제 메일이 와도 ≥1은 같다; 0이면 6시간 cron까지 기다리지 말고 `gmail-gate.ts status`로 sync 잡 상태를 본다).
- 문구 "Google이 새 권한을 아직 주지 않았어요…" → 위 SQL의 `cursor_hash`·`backfill_jobs`·`status`가 그대로인지(연결 불변) 확인하고 U3을 **대기**로 적는다 — 판정은 다음 주간 재연결(readonly + modify 요청) 뒤. 이 경우 ②~⑤는 그 재연결 뒤로 미룬다(modify 없이는 성립하지 않는다 — memory "테스트 시나리오는 인과관계·필요성 먼저").
- 버튼 없음(이미 modify) → U3 "해당 없음(주간 재연결이 먼저 붙임)", ②로.
- 그 밖 문구(계정 불일치·체크 안 함·실패) → 문구만 적고 사용자와 한 번 더, 그래도 실패면 멈추고 메인에게.

- [ ] **Step 5: ② 휴지통(U1·U6) → ③ 새 items 0(U4)**

시작 시각을 `$T2`(ISO)로 적는다. 사용자에게: "채팅에 '제목에 ERURI 테스트 들어간 메일 휴지통으로 보내줘'라고 보내 주세요. 카드의 조건 줄과 건수 줄을 그대로 알려 주시고(합성 문구라 괜찮아요), **건수가 3건이 아니면 누르지 말고** 알려 주세요. 3건이면 [휴지통으로 이동 (3건)]을 누르고 결과 문구를 알려 주세요. 그다음 Gmail 앱에서 휴지통에 합성 1~3이 있는지, 받은편지함에 대조 메일이 그대로 있는지 봐 주세요."

판정 ②: 조건 줄이 `제목 'ERURI' '테스트' · 별표 제외`(서버가 정제한 칸 — 대괄호는 지워진다)이고 건수 `3건`(U6 통과 — 0건이면 U6 실패: 멈추고 메인에게), 결과 "휴지통으로 3건 옮겼어요", Gmail 휴지통에 3통·대조 메일 받은편지함.

Run: `deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/sql.ts "select status, method, cardinality(ok_ids) as ok, cardinality(failed_ids) as failed from mail_actions where user_id = \$1 order by created_at desc limit 1" "$ERURI_USER_ID"`
Expected: `done`, `method` = `batch`면 **U1 통과(batchModify TRASH 동작)**, `single`이면 **"건별 폴백"** — 결과는 같지만 스펙 §7대로 1차 batch 시도를 빼는 수정 태스크를 메인이 만든다(이 게이트는 통과로 적는다 — 기능은 동작했다).

판정 ③(U4): Run: `deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/sql.ts "select count(*) as n from jobs where user_id = \$1 and kind = 'gmail-fetch' and created_at >= \$2 and payload->'ids' ?| \$3::text[]" "$ERURI_USER_ID" "$T2" "$(deno eval 'console.log("{" + JSON.parse(Deno.readTextFileSync(".context/gate0140/ids-real.json")).join(",") + "}")')"`
Expected: `n = 0`(휴지통 이동·이후 되돌리기가 그 3통을 새 메일로 다시 가져오지 않았다 — 이 확인은 ④·⑤ 뒤에 한 번 더 돌린다). 1 이상이면 U4 실패 — 멱등 키로 항목은 늘지 않았는지(`select count(*) from items where user_id=$1 and idempotency_key = any(…)` = 3) 함께 적고 메인에게.

- [ ] **Step 6: ④ 되돌리기(U5) → ⑤ 읽음 → 되돌리기**

사용자에게: "방금 카드의 [되돌리기]를 누르고 결과 문구를 알려 주세요. Gmail 받은편지함에 합성 1~3이 다시 보이는지 봐 주세요. 그다음 채팅에 '제목에 ERURI 테스트 들어간 안 읽은 메일 읽음 처리해줘'라고 보내고, 건수가 3건이면 [읽음 처리 (3건)]을 누른 뒤 Gmail에서 합성 1~3이 읽음이고 대조 메일은 안 읽음인지 봐 주세요. 마지막으로 그 카드의 [되돌리기]를 누르고 합성 1~3이 다시 안 읽음이 됐는지, 대조 메일이 받은편지함·안 읽음 그대로인지 알려 주세요."

판정 ④(U5): 결과 "되돌렸어요" + 받은편지함에 3통 → 통과. 휴지통에서는 빠졌는데 받은편지함에 안 보이면 U5 실패 → 되돌리기(휴지통)에 `addLabelIds: ["INBOX"]`를 더하는 수정(M4 `opFor`의 휴지통 undo 두 줄 + 테스트) → 워커 재배포 → 사용자가 Gmail에서 3통을 받은편지함으로 옮긴 뒤 ②·④만 다시.
판정 ⑤: 미리보기 3건(대조 없음), 결과 "3건을 읽음으로 바꿨어요", 되돌리기 "되돌렸어요", 마지막 대조 메일 받은편지함·안 읽음.

Step 5의 판정 ③ SQL을 다시 돌려 `n = 0`을 확인한다.

- [ ] **Step 7: 기록·정리·커밋**

`docs/superpowers/poc/results.md` 끝에 절을 더한다:

```
## MAIL-real (메일 정리 0.14.0, <날짜>)

| 단계 | 전제 | 판정 | 근거(개수·코드만) |
|---|---|---|---|
| ⓪ probe | U2 403 권한 reason | <통과|측정 기회 없음> | status <n>, reasons <코드> |
| ① 권한 업데이트 | U3 addScopes → 새 serverAuthCode·refresh token, 연결·커서·백필 불변, 동기화 지속 | <통과|대기|해당 없음> | 문구 <…>, has_modify <b>, cursor 같음 <b>, backfill_jobs 같음 <b>, 대조 수집 <n> |
| ② 휴지통 | U1 batchModify TRASH / U6 한글 제목 검색 | <통과(batch)|통과(건별 폴백)> | 조건 줄 일치 <b>, 3건, method <…>, 대조 받은편지함 <b> |
| ③ 동기화 | U4 휴지통·되돌리기가 새 메일로 오지 않음 | <통과|실패> | gmail-fetch 잡 중 3통 id 포함 <n>(②·⑤ 뒤 두 번) |
| ④ 되돌리기 | U5 INBOX 복원 | <통과|실패→수정> | 결과 문구, 받은편지함 3통 <b> |
| ⑤ 읽음·되돌리기 | 읽음은 조건 메일만, 되돌리기 정확 | <통과|실패> | 3건, 대조 안 읽음 <b> |
```

`docs/superpowers/phase1/gates.md`에 행:

```
| MAIL-real | 메일 정리 실기기(스펙 §15): ⓪ probe · ① 권한 업데이트 · ② 휴지통 3통 · ③ 새 items 0 · ④ 되돌리기 INBOX · ⑤ 읽음·되돌리기, 대조 메일 불변 | <통과|대기> | <KST>, TestFlight 0.14.0 (<빌드>). results.md MAIL-real 절. U1 <batch|건별>, U2 <…>, U3 <…>, U4 0, U5 <…>, U6 3건 | | <날짜> |
```

U1이 "건별 폴백"이거나 U5가 INBOX 추가로 고쳐졌으면 스펙 §7 해당 문장("어느 쪽이 되는지는 MAIL-real 첫 단계가 판정…", "INBOX 라벨 복원은 MAIL-real에서 본다")을 판정 결과로 바꾼다.

Run: `rm -f .context/gate0140/ids-real.json .context/gate0140/rt && rm -rf .context/gate0140 && git status --short`
Expected: 하네스가 지워지고 `git status`에 하네스 파일 없음. 사용자에게 합성 메일 4통은 직접 지워도 된다고 알린다(서버는 지우지 않는다 — 영구 삭제 없음).

```bash
git add docs/superpowers/poc/results.md docs/superpowers/phase1/gates.md   # 스펙을 고쳤으면 docs/superpowers/specs/2026-09-22-assistant-design.md 도
git commit -m "docs(gates): MAIL-real — permission reason probe, permission update keeps the connection and cursor, three synthetic mails trashed and restored to the inbox, no re-collection, read and undo exact, control mail untouched (method and step verdicts in results.md)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## 자체 점검 (2026-10-06)

- **스펙 대조(§7 "메일 정리" 문장마다):** 무엇(휴지통·읽음만, 보관함 그대로) → M4(보관함 RPC 없음 테스트)·M2(영구 삭제 없음 grep). 켜기(`MAIL_ACTIONS`·③c2 뒤) → M5 `enabled`·M10 Step 6·Global Constraints. 지목(정해진 칸·서버 조립·`in:inbox -is:starred`·정제·거절·범위 하한) → M1. 미리보기(권한 → 칸 → list 500 × ≤5 → 1,000 → 별표 추정 → 20 표본 → 행 = 토큰, `conditions`, exact/추정, 표시, 미리보기 글 비저장, 비용 기록) → M5·M8·M9. 실행(지속 잡·한 트랜잭션·202·같은 토큰 200·미리보기 id만) → M3 `mail_action_start`·M5. 상태 전이 → M3. id별 결과·커서 → M3 progress·M4. 결과 불명·재개·마지막 시도 재조회·dead 트리거 → M3·M4. lease·예산 → M3(lease)·M4(30초). 읽음·휴지통·폴백·method → M4·D9. reason 분기 → M2 `classifyGmailError`·M4·M5. 속도(units 합산) → M3·M4 D6. 진행·결과 status → M3 counts·M5·M9. 되돌리기(ok_ids만·7일·상태 규칙·한 번) → M3·M4·M9. 동기화와의 관계 → F1·U4·MAIL-real ③. 권한 업데이트(scopes·[권한 업데이트]·upgrade 순서·revoke 금지·불변·코드 없을 때 안내·새 연결 readonly + modify) → M3·M6·M9·D12·D13·D16. 보관(7일·1시간·cascade) → M3 purge·cascade 사례. 감사(개수만) → M3 finish. 진단(trace `chat.mail`) → M9.
- **스펙 §9:** 의도·하위 호환(0.13.0 그대로, `intents`에 `mail_action` 추가) → M8 `ChatAddEvent.intents`·M10 smoke `chat_*`. 채팅 메일 정리 카드·문구·대화 기록·맥락 제외 → M8·M9·M11. **§12:** 서버 저장 범위·미리보기 글 기기만·LLM에 메타 안 감·검색어 서버 조립 → M3 열 사례·M5 로그 테스트·M1. **§15:** 서버 테스트 항목 전부 → M1~M6(아래 대조), MAIL-real ①~⑤ → M12, INTENT-eval mail 판정 → M7.
- **§15 서버 테스트 목록 대조:** 검색어 조립·`OR`·괄호·콜론·범위 하한·검색어 문자열 무시 → M1. 1,000개 다중 페이지·exact → M5 paging. 토큰 10분·한 번만·남의 토큰·미리보기 id만 → M3 사례 1·2·M5 execute. 잘못된 칸 400·행/검색 없음 → M1·M5. conditions = 실제 검색어 → M5 preview(쿼리·conditions 동시 확인). TRASH 400 폴백·403 쿼터 미루기·403 권한 failed → M4. 같은 토큰 두 번 → M3·M5·M10. 중간 실패 ok/failed·되돌리기 ok만 → M3 사례 3·7·M4. Gmail 성공 뒤 기록 전 죽음 → M4. 결과 불명 5회 → M4 last attempt. dead → M3. 되돌리기 상태 규칙 → M3 사례 6·M5. `gmail_take_units` 5,400/4,000 → M3. `scope_missing`·`no_connection` → M5. 플래그 꺼짐·`intents` 없음 → M5 disabled·M10 chat. 제목·발신자 없음 → M3 열 사례. 권한 업데이트 계정 불일치·불변·revoke 0 → M6.
- **이름 일치:** `checkConditions`·`buildQuery`(M1 → M5), `GmailMailApi`·`classifyGmailError`·`GMAIL_MODIFY_SCOPE`(M2 → M4·M5·M6·M12), RPC 이름·인자(M3 표 ↔ M4 deps ↔ M5 deps ↔ M6 handler ↔ M10 smoke ↔ M11 seed ↔ M12 probe), `gmailAccessToken`·`noteGmailUnits`(M4 → M5), HTTP 응답 키(M5 `COUNT_KEYS` ↔ M8 `Status` ↔ M3 `mail_action_counts`), 화면 식별자(M9 ↔ M11), 커밋 접두 `feat(core): mail cleanup`(M8 ↔ M0 Step 6 ↔ D17).
- **자리표시자:** 코드 단계는 모두 실제 코드. `<KST>`·`<n>`·`<sha>` 같은 꺾쇠는 `gates.md`·`results.md`에 실행 때 채우는 실측값 칸이다. M0의 스펙 수정은 앵커 문장과 넣을 문장을 그대로 적었다.
- **알려진 한계(계획에 적음):** 쿼터 403 reason은 실측하지 않는다(D20·스펙 §16 수용). 실행 1회 30초 예산이라 건별 폴백 1,000건은 여러 워커 호출에 걸친다(units 상한이 어차피 분당 200건). 수집 경로 units 기록은 10통 단위라 분 경계에서 조금 어긋날 수 있다(연성 상한 — reason 분기가 받친다). 미리보기 0건은 행을 만들지 않아 감사·trace에만 남는다. 테스트 사용자에게 Gmail이 없어 시뮬레이터 게이트의 미리보기 카드는 주입한다(실제 목록은 MAIL-real).

## 외부 리뷰 반영

(아직 없음 — 계획 리뷰 순서는 memory "계획 리뷰: Codex → Fable → SDD". 리뷰 뒤 번호별 반영/미반영을 이 절과 스펙 §16에 적는다.)
