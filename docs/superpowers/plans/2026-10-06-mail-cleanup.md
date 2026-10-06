# ERURI 0.14.0 메일 정리(채팅으로 Gmail 휴지통·읽음) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## 태스크 ID 표

| ID | 태스크 | 선행 | 시점·Gmail 측정 창 | 게이트 행 |
|---|---|---|---|---|
| M0 | 스펙 세부 반영(§7 켜기·지목·실행·되돌리기·권한 업데이트·오류 코드 — 어긋난 옛 문장은 제자리 교체, §8 열, §9 문구, §15 순서·게이트 이름, §16) + 광고 해지 계획 U6b **Step 3 워커 배포 기준 커밋(worktree)**·Step 6 업로드 기준 | 이 계획 커밋 | 무관(문서) | — |
| M1 | `_shared/mail-query.ts`: 칸 검사(거절·범위 하한)·정제·검색어 조립(순수) | M0 | 무관(로컬 deno) | `MAIL-server` |
| M2 | `_shared/gmail.ts`: 쓰기·목록·메타 래퍼 + 오류 `reasons` + `classifyGmailError`(fetch 스텁 테스트) | M0 | 무관(로컬) | `MAIL-server` |
| M3 | 마이그레이션 `0030_mail_cleanup.sql`(**`migrations-pending/`에 둔다, 미적용**) + 공유 SQL 사례 + PGlite 로컬 SQL 테스트 + 호스팅 트랜잭션 테스트 파일(M10에서 실행) | M0 | 로컬만. **호스팅 DB 테스트·`db push`는 M10(③c2 뒤)** | `MAIL-server` |
| M4a | 수집 계측: `_shared/gmail-jobs.ts` 수집 경로 units 기록(fail-open) + `gmailAccessToken`·`noteGmailUnits` 공개 | M2·M3(이름) | 로컬 테스트만. **워커 배포는 M10** | `MAIL-server` |
| M4b | 실행 복구: 워커 `mail-action` 잡(묶음·폴백·reason 분기·units·**호출마다 예산 검사**·결과 불명·진행 뒤 미루기·마지막 시도 재조회) | M4a·M3(이름) | 로컬 테스트만. 워커 배포는 M10 | `MAIL-server` |
| M5 | Edge `mail-action`(preview·execute·undo·status) | M1·M2·M3(이름)·M4a(`gmailAccessToken`·`noteGmailUnits`) | 로컬 테스트만. 배포는 M10 | `MAIL-server` |
| M6 | `gmail-connect`: `upgrade` 경로(revoke 0회·연결 불변) + 일반 경로 `scopes` 기록 | M2·M3(이름) | 로컬 테스트만. 배포는 M10 | `MAIL-server` |
| M7 | `INTENT-eval --mail-judged`(0.14.0 판정: 칸 일치 ≥ 90% + 게이트 문장 4개 3/3) — **판정은 로컬 러너, chat 배포 없음**(고쳤으면 재배포는 M10) | 0.13.0 A2·A3 끝 | **실호출** — 10-07·10-08 14:30~16:30 KST 금지, 그날 13:45 이후 시작 금지 | `INTENT-eval`(mail) |
| M8 | EruriCore `MailCleanup`·`MailCleanupText`·`MailTurn`(상태 다시 읽기 판단 포함) + `ChatHistory`(`.mailAction`·`mail`)·`ChatReply.Answer.mail`·`ChatAddEvent.intents`·`JSONValue.foundation` | M0 | 무관(시뮬레이터 단위 테스트) | — |
| M9a | 앱 권한 UI: 설정 [권한 업데이트]·`SettingsRouter`·`GmailConnect.upgrade` + 새 연결 readonly+modify + `testflight.sh` 0.14.0 전 업로드 가드 | M8 | 무관(빌드·단위 테스트) | — |
| M9b | 앱 채팅 복원: 채팅 메일 정리 턴·카드·폴링·결과 불명 다시 읽기·재개·되돌리기 | M9a | 무관(빌드·단위 테스트) | — |
| M10 | 배포: 호스팅 트랜잭션 DB 테스트 → `0030` 적용 → 워커 배포·회귀 → `mail-action`·`gmail-connect` 배포 → (M7이 고쳤으면) chat 재배포 → `MAIL_ACTIONS=on` → `smoke-mail`(테스트 사용자 22)·CTX-eval(intents) | M1~M7 + **③c2 완료 기록 + U6b Step 3b(0029 적용) 완료** | ③c2 뒤, 16:30 KST 이후(실호출 포함) | `MAIL-deploy` |
| M11 | 시뮬레이터 게이트 `MAIL-sim`(테스트 사용자 23, 전용 UDID) → 통과 뒤 `MARKETING_VERSION: 0.14.0` | M9b·M10 | 실호출(배포된 chat·mail-action·worker) | `MAIL-sim` |
| M12 | TestFlight 0.14.0 → `MAIL-real`(실기기, 사용자 조작 — 합성 메일 3통 + 대조 1통) | M11 | ③c2 뒤 | `MAIL-real` |

순서: M0 → (M1·M2 → M3 → M4a → M4b → M5·M6) ∥ (M8 → M9a → M9b) → M7(창 밖 아무 때나, M10 전) → [③c2 완료 기록 + U6b 0029 적용] → M10 → M11 → M12. M4a/M4b·M9a/M9b는 **커밋·리뷰 단위만** 나눈다 — 같은 pane에서 순서대로 한다(파일이 이미 갈라져 있다: M4a는 수집 경로 변경을 U6b 배포본과 따로 비교·되돌리기 쉽게, M9a는 scope 변경을 격리). 서버(deno)와 앱(시뮬레이터)은 다른 파일이라 다른 pane에서 해도 되지만 **deno 테스트와 시뮬레이터 빌드를 같은 시각에 돌리지 않는다**(AGENTS.md §6 — `pgrep -x deno`·`pgrep -x xcodebuild`로 서로 확인).

**Goal:** 채팅에 "합성상점에서 온 광고 메일 휴지통에 버려줘"·"지난주 뉴스레터 읽음 처리해줘"라고 하면 서버가 정해진 칸으로 Gmail 받은편지함 검색어를 직접 만들어 대상을 미리 보이고(최대 1,000건, 위 20건), 사용자가 카드의 버튼을 누를 때만 서버 잡이 휴지통 이동·읽음 처리를 하며 7일 안에 한 번 되돌릴 수 있다. Gmail만 바뀌고 ERURI 보관함은 그대로다.

**Architecture:** chat(0.13.0)은 그대로 `intent = mail_action`과 모델 출력 `mail` 칸을 돌려준다(플래그 `MAIL_ACTIONS`만 켠다). 새 Edge `mail-action`이 칸을 한 곳에서 검사·정제해 검색어를 조립하고(`in:inbox -is:starred` 고정, 모델이 쓴 검색어는 읽지 않음) `messages.list`로 id를 모아 `mail_actions` 행(= 확인 토큰, 10분)을 만든다. 실행·되돌리기는 늘 `jobs` 잡 `mail-action`(lease `mail:<user>`)이 묶음마다 Gmail을 부르고 `mail_action_progress`(커서 비교)로 id별 결과를 한 트랜잭션에 남긴다 — 결과 불명은 멱등 재시도, 마지막 시도는 재조회, dead는 트리거가 마감. Gmail units는 사용자 분 카운터 `gmail_units`를 수집(기록만)과 메일 정리(가져가기, 합계 5,400·자기 몫 4,000)가 함께 쓴다. 권한은 설정 › Gmail [권한 업데이트] → `addScopes` → `gmail-connect {upgrade: true}`가 기존 연결을 유지한 채 토큰만 바꾼다(revoke 0회).

**Tech Stack:** Supabase Postgres 마이그레이션(pg_cron, vault), Edge Functions Deno/TS(`deno test`, `npm:@electric-sql/pglite` 로컬 SQL 테스트, `npm:postgres@3` 호스팅 트랜잭션 테스트), Gmail API v1(`messages.list`·`get format=metadata|minimal`·`batchModify`·`trash`·`untrash`·`modify`, scope `gmail.modify`), GoogleSignIn-iOS 8(`restorePreviousSignIn`·`addScopes`), SwiftUI iOS 26 앱 `Eruri` + Swift Package `EruriCore`(XCTest, Swift 6), xcodegen `ios/project.yml`, XCUITest(게이트 전용 임시 타깃, 커밋하지 않음), TestFlight(`ios/scripts/testflight.sh`).

**Spec:** `docs/superpowers/specs/2026-09-22-assistant-design.md` @ `26e47bb` — §2 "메일 정리" 행, §3 "Gmail 쓰기 `gmail.modify`" 줄, §7 "메일 정리"(무엇·켜기·지목·미리보기·실행·되돌리기·동기화와의 관계·권한 업데이트·보관·감사·진단)와 "Gmail 동기화", §8 `connections.scopes`·`mail_actions`·`gmail_units`·삭제 표 두 줄, §9 "채팅 의도 판별"·"채팅 메일 정리"·"대화 기록·짧은 맥락", §11(0.14.0 화면 변경), §12 통제 2·3·4·5의 메일 정리 줄, §15 "1단계 추가 범위(2026-10-06 메일 정리 결정)"(서버 테스트·MAIL-real), §16 "2026-10-06 메일 정리"·"외부 리뷰 반영 (채팅 의도·메일 정리 스펙)" #1~#7. 문서 검증 `.context/verify-gmail-modify.md`. M0이 이 계획의 세부 결정(아래 D표)을 스펙에 올린다. 실행 규칙은 `AGENTS.md` §3(모델)·§5-8(실측 게이트)·§6(기계)·§7(개인정보)·§8(버전).

**선행 계획(이어받음):** `docs/superpowers/plans/2026-10-06-chat-add-event.md` @ `8e9c62d`(리뷰 반영본 — 러너 `gate_cases`, `ChatAddEvent.Verdict`) "다음 계획(메일 정리, 0.14.0)이 쓰는 인터페이스" — 이름·타입을 그대로 쓴다(아래 "0.13.0에서 받는 인터페이스"). **0.13.0(A0~A6)이 먼저 main에 들어간다고 가정**한다(M0 Step 1이 확인).

**선례:** `2026-10-01-gmail-unsubscribe.md`(Gmail·워커 잡·측정 후 배포·U6b·`migrations-pending`·트랜잭션 DB 테스트·실기기 사용자 확인), `2026-10-04-chat-history.md`·`2026-10-06-chat-add-event.md`(대화 기록 턴 종류·epoch `settle`·게이트 하네스 `.context/gate01x0/`).

**출발점:** main `8e9c62d` 위 + 0.13.0 구현 커밋들(A0~A6). 서버 `0001`~`0028` 적용, `0029_unsub_gap_scan.sql`은 `supabase/migrations-pending/`에서 U6b를 기다린다. 앱 `MARKETING_VERSION`은 0.13.0(A6 뒤). Gmail 측정 ③c2는 2026-10-08 15:00 KST까지 — 그때까지 워커·gmail-* 배포·마이그레이션 적용·재동의·실 Gmail 쓰기 금지.

## 사용자 결정 (2026-10-06 — 스펙 §16 "2026-10-06 메일 정리"가 원본)

| # | 결정 | 이 계획에서 |
|---|---|---|
| MD1 | 지목 A(채팅) — 방식 1: 필터가 정해진 칸(동작 trash/read·발신자·제목 단어·받은 기간·광고·안 읽음)만 채우고 **서버가 검색어 조립**, 항상 `in:inbox -is:starred`. 모델이 쓴 `q`는 실행하지 않는다 | M1 `checkConditions`·`buildQuery`, M5 |
| MD2 | 보관함 연동 A — Gmail만 바꾸고 ERURI 보관함·추출 결과는 그대로 | M4b(보관함 RPC 없음), Review Focus 6 |
| MD3 | 건수 A — 한 번 최대 1,000건, "총 약 N건 중 1,000건 · 별표 약 M건 제외" + 위 20건, 실행 뒤 [다음 1,000건 보기]는 다시 미리보기·확인 | M5 preview, M8 `countLine`·`showNext`, M9b |
| MD4 | 확인 토큰(서버 행, 10분)으로 미리보기 때 찾은 id만 실행, 결과 카드 [되돌리기] 7일 | M3 `mail_action_start`·`mail_action_undo`, M4b, M9b |
| MD5 | `mail_actions`는 Gmail id·동작·상태·방식·오류 코드·id별 결과만, 7일 뒤 삭제. 미리보기 글은 앱 화면·기기 대화 기록에만 | M3 표·purge, M5 로그 규칙, M8 `MailTurn` |
| MD6 | 권한: 설정 › Gmail [권한 업데이트]로 `gmail.modify` 재동의 — 기존 연결 유지·토큰 교체, 실패·취소 때 아무것도 안 바뀜, revoke 없음, 연결이 살아 있는 동안 `disconnect()` 재동의 기각 | M6, M9a `GmailConnect.upgrade` |
| MD7 | 배포·재동의는 ③c2(2026-10-08 15:00 KST) 뒤 | M10~M12 |
| MD8 | 메인 판단(스펙 §16): ① 휴지통 범위 하한 ② 읽음은 늘 `is:unread` ③ units 합산 카운터(합계 5,400·메일 정리 4,000) ④ "별표 약 M건" ⑤ 카드 버튼 = 확인 ⑥ 0.14.0 새 연결·주간 재연결은 readonly + modify ⑦ 옛 토큰은 vault에서만 지우고 revoke 안 함 | M1·M3·M8·M9a·M9b·M6 |

## 계획이 정한 것

| # | 항목 | 결정 | 이유 |
|---|---|---|---|
| D1 | 마이그레이션 위치·적용 시점 | `supabase/migrations-pending/0030_mail_cleanup.sql`로 만들고 **M10(③c2 뒤, U6b가 0029를 적용한 뒤)**에 `supabase/migrations/`로 옮겨 `db push`. ③c2 전에는 PGlite 로컬 SQL 테스트만, 호스팅 트랜잭션 테스트(적용·롤백)도 M10 | 지시문 Global Constraints("마이그레이션 적용은 ③c2 뒤"). 0029가 미적용이라 0030을 먼저 올리면 번호 역순이 된다. 0030은 `jobs`에 트리거를 만들고 `connections`에 열을 더한다 — 트랜잭션 테스트라도 그동안 두 표에 잠금이 걸려 측정 중 수집·워커 클레임을 몇 초 멈출 수 있다 |
| D2 | U6b와 순서·배포 격리 | **U6b 먼저(Step 3 워커 배포·회귀 → Step 3b 0029 적용), 그다음 M10** — 합치지 않는다. 같은 날 저녁 이어서 해도 된다. **U6b Step 3 워커 배포는 main HEAD가 아니라 기준 커밋 = 이 계획 M1 첫 커밋의 부모**(`git log --diff-filter=A --format=%h -- supabase/functions/_shared/mail-query.ts`의 `^`)의 worktree에서 한다 — M1·M2·M4a·M4b가 ③c2 전에 main에 들어가므로 main HEAD에서 배포하면 U6b가 허용 diff 검사에서 멈추거나 메일 정리 워커를 함께 내보낸다. `UNS-server`에 적는 배포 HEAD = 그 기준 커밋(M10 Step 4의 `$U6B`). M0 Step 6이 이 계획과 광고 해지 계획 U6b Step 3에 같은 문단을 넣는다. U6b가 Step 3b 전에 막히면 M10을 시작하지 않고 메인이 사용자에게 (a) 기다림 (b) U6b 절차대로 0029만 먼저 적용 중 무엇을 할지 묻는다 | ① 번호 순서(0029 → 0030). ② 둘 다 워커를 바꾼다 — 한 번에 배포하면 회귀(`smoke-gate`·LNK·`gmail-gate status`)가 깨졌을 때 어느 변경 탓인지 가를 수 없다. ③ U6b는 자기 판정(원클릭 비율)으로 멈출 수 있고 그 판정은 0029 적용 뒤라 이 계획을 막지 않는다. ④ 비용은 워커 배포 1회·회귀 1회(약 15분)뿐. ⑤ 브랜치로 미뤄 두기는 한 체크아웃에서 앱·서버 pane을 병행하기 어려워 차선, 순서 뒤집기는 ③c2 제약 위반이라 기각(Codex C2·Fable 판정) |
| D3 | `mail-action` 경로·오류 코드 | 스펙의 것 + `400 bad_json`(세 POST 모두)·`400 needs_target`(휴지통 범위 하한)·`400 bad_token`/`bad_id`·`409 reauth_required`(연결이 active가 아니거나 토큰 갱신 불가 — **preview·execute·undo 모두 RPC 전에 본다, undo는 토큰 갱신까지 확인**해 행을 바꾸지 않는다)·`429 gmail_rate_limited`·`502 gmail_upstream`(Gmail 오류·타임아웃·토큰 갱신 일시 오류·미리보기 총 예산 25초 초과)·`503 disabled`(`MAIL_ACTIONS` 꺼짐 — preview·execute만, undo·status는 꺼져도 동작)·`404 not_found`·`405`(경로에 맞지 않는 메서드)·`500 internal`. 401·405는 본문 없음. **0건이면 행을 만들지 않고 200 `token: null`**. 되돌리기의 행 없음은 정리된 것과 가를 수 없어 `410 undo_expired`. Gmail 연결은 사용자당 1개로 본다(`mail_connection`이 최신 1개) | 스펙이 정하지 않은 경우를 앱이 문구로 가를 수 있게. 꺼짐에서도 되돌리기를 막지 않는 것은 롤백(플래그 끄기) 때 사용자가 이미 한 정리를 되돌릴 수 있게. 연결이 만료된 동안 [되돌리기]를 눌러 한 번뿐인 되돌리기가 소진되지 않게(Fable N-H1 — 테스트 모드는 토큰 7일·되돌리기 7일이라 만료가 늘 창 안에 온다) |
| D4 | 상태 응답 | 스펙 `{id, status, total, done, failed, undone, undo_failed, code}` + `method`(batch/single/null). `undone` = `undo_cursor − |undo_failed_ids|`. 실행·되돌리기·상태 응답이 같은 모양 | trace `chat.mail`의 `method`(스펙 §7 진단)를 앱이 채우고, MAIL-real ②의 batch/건별 판정을 앱 화면 없이 볼 수 있게 |
| D5 | 미리보기 표본 | `from` = From 표시 이름(없으면 주소, `_shared/unsub.ts` `parseFrom`, 60자), `subject` 100자, `date` = `internalDate` ISO. 404(그사이 삭제)인 표본은 빠지고 건수는 그대로. `total_estimate` = 끝까지 읽었으면 `count`, 아니면 `max(첫 페이지 resultSizeEstimate, count)` | 추정치가 모은 수보다 작으면 "총 약 900건 중 1,000건"이 된다 |
| D6 | 수집 경로 units 기록 | `gmail-fetch`·`gmail-unsub-fetch`는 10통마다 한 번(이미 있는 10통 단위 연결 확인 자리)에 `20 × 다음 통수`, `gmail-sync`는 history 페이지 2·list 페이지 5·profile 1. **fail-open**: 기록 RPC 1초 예산, 잡당 첫 실패·초과 뒤 나머지 기록 생략(로그 `units_note_error` 1줄). 미리보기도 같은 기록(호출 전) | 스펙 "수집 경로는 기록만". 통마다 RPC를 부르면 fetch 잡 RPC가 두 배가 된다. 카운터가 수집을 늦추거나 실패시키면 안 된다(광고 기록 차단기와 같은 이유) |
| D7 | 잡 시간 예산 | 잡 1회 25초(`MAIL_JOB_BUDGET_MS`, `t0`는 잡 함수 첫 줄 — 토큰 갱신 포함), Gmail 호출 1건·토큰 갱신 15초 타임아웃. **Gmail 호출 직전마다** 예산을 본다(batch 묶음 시작, 건별 매 id, 재조회 매 id) — 넘으면 그때까지 처리한 id를 `mail_action_progress`로 적고 `Deferred(지금, mail_budget)`(attempts 되돌림, 커서 유지). units 못 가져감 → 다음 분 시작으로 `Deferred`. 쿼터 → `Deferred(+60초)`, 행 `quota_since`(첫 쿼터 미루기 시각, 성공 묶음이 지움)가 30분을 넘으면 `fail_job`. **이번 실행에서 커서가 전진한 뒤의 결과 불명은 `Deferred(+60초, mail_retry)`** — attempts는 진행이 없을 때만 쓴다 | 워커 배치 예산 100초 끝 무렵 클레임돼도 100 + 25 + 15 = 140 < Edge 벽시계 150초(여유 10초). 묶음 시작에서만 보면 건별 20 × 15초 = 300초·재조회 200통 연속이 가능해 Edge가 잡을 죽이고, `claim_jobs`가 lease 만료 잡을 attempts +1로 다시 집어(상한 없음, `0007`) 죽음이 쌓이면 평범한 예외 한 번에 dead → 이미 휴지통에 간 id가 실패로 마감돼 되돌리기에서 빠진다(Codex C1). `fail_job`은 attempts를 되돌리지 않아 건별 1,000건에 흩어진 일시 오류 5번이면 뒤 수백 건이 시도 없이 실패로 마감된다(Fable N-M1). 30분 판정을 잡 payload(불변)가 아닌 행에 둔다 |
| D8 | 진행 기록 | `mail_action_progress(p_user, p_id, p_phase, p_from, p_cursor, p_ok, p_failed)` — **현재 커서 = `p_from`이고 `|ok|+|failed| = p_cursor − p_from`일 때만** 붙이고 true. 아니면 false → 잡은 `stale`로 끝난다 | lease가 끝난 뒤 늦게 깨어난 워커가 같은 묶음을 두 번 적지 못하게(스펙 "최종 결과 중복 없음") |
| D9 | 폴백 규칙 | batch → 건별 전환: **휴지통·읽음 모두(실행·되돌리기) 400·404**(2026-10-06 메인 판정 — 휴지통 404 채택, 스펙 §7은 M0이 먼저 고친다). 건별에서 id 하나가 400·404면 그 id만 실패. 실행 단계의 전환만 행 `method`에 남긴다(되돌리기는 실행 방식을 따른다: 휴지통 `single`이면 처음부터 `untrash`, 읽음은 늘 batch 먼저) | 건별 400·404는 그 id 문제(일괄 미지원이 아님). 휴지통 batch 404를 결과 불명으로 두면, 되돌리기 대상 중 한 통을 사용자가 영구 삭제했을 때(batchModify가 404를 주면 — 미확인) 10분 백오프 뒤 재조회가 나머지를 "아직 TRASH = 실패"로 적어 한 통 때문에 999통 복원이 실패하고 되돌리기는 한 번뿐이다(Fable N-M3). 건별 `trash`·`untrash`는 문서에 있는 API라 404 id만 가른다 |
| D10 | 마지막 시도 재조회 | `attempts ≥ 5`이고 이번 실행에 진행이 없는데 결과 불명이면 그 묶음의 남은 id를 20개씩 `messages.get(format=minimal)`(20 units/통, 매번 `gmail_take_units`)으로 읽어 목표 상태면 성공·404 등 오류면 실패로 적고 `mail_action_finish`가 커서 뒤를 실패로 마감. 호출 전마다 예산을 보고(넘으면 읽은 앞부분을 적고 `Deferred`), **429·쿼터 reason이면 읽은 앞부분만 적고 쿼터 미루기**(같은 30분 판정). units를 못 가져가면 진행을 남긴 채 `Deferred` | 1,000건 batch 재조회는 20,000 units라 한 분에 못 끝난다. 20개마다 남기면 미뤄도 잃지 않는다. 재조회는 통당 20 units라 쿼터 압박 때 429가 나기 쉽고, 쿼터 오류를 실패로 적으면 휴지통에 간 메일이 되돌리기에서 빠진다(Fable N-M2). `Deferred`는 attempts를 되돌리고 클레임이 다시 올려 다음 실행도 마지막 시도다 |
| D11 | 잡의 연결 문제 코드 | 토큰을 못 얻으면 연결이 active가 아니면 `reauth_required`, 아니면 `no_connection`으로 `mail_action_finish`. 실행이면 남은 id 실패(앱 "Gmail 권한(연결)이 바뀌어 K건을 처리하지 못했어요"). **되돌리기에서 아직 하나도 되돌리지 않았으면(`undo_cursor = 0`) 되돌리기를 쓰지 않은 것으로 돌린다** — 상태를 실행 종료 상태(`done`/`partial`)로 되돌리고 `error_code = undo_<코드>`만 남김(감사 없음), 앱 "Gmail 연결이 끊겨 되돌리지 못했어요 — 설정 › Gmail에서 다시 연결한 뒤 되돌려 주세요" + [되돌리기] 유지. 마감 때 남은 id가 0이면 코드를 적지 않는다(`job_dead` 포함) | 재연결은 같은 connection id를 유지하므로(`gmail_save_connection` `on conflict (provider, account_ref)`) 소진만 막으면 재연결 뒤 되돌리기가 된다(Fable N-H1 — Edge 선검사가 대부분을 막고, 잡이 `invalid_grant`를 처음 발견하는 드문 경우를 SQL이 받친다). 남은 id 없는 마감에 코드를 적으면 `done`인데 `job_dead`가 붙는다(N-M12) |
| D12 | `upgrade` 계약 | `{code, upgrade: true}`(`upgrade`가 있는데 불리언이 아니면 400 `bad_upgrade` — 일반 연결로 흘러가 커서·백필을 다시 하지 않게). 교환 → 연결 조회(없으면 404 `no_connection`, active가 아니면 409 `reauth_required` — `gmail_replace_token`도 `status = 'active'`일 때만) → profile 계정 비교(대소문자 무시, 다르면 409 `account_mismatch`) → refresh token 없음 200 `{refresh_token_stored: false, upgraded: false}` → modify **또는 readonly**가 없음 403 `gmail_scope_missing` → 새 토큰 갱신 1회(실패 502 `token_verify_failed`) → `gmail_replace_token`(실패 500 `replace_failed`) → 200 `{connection_id, refresh_token_stored: true, upgraded: true}`. profile 401·403도 연결 상태를 바꾸지 않고, profile 401은 **502 `gmail_unauthorized`**(401이면 iOS가 세션을 바꿔 일회용 코드를 다시 보내 버린다). 일반 경로는 **refresh token을 저장했을 때만** 저장 직후 `gmail_set_scopes`(실패해도 연결은 성공) | 스펙 §7 권한 업데이트 순서 + 실패 경로 전부 "아무것도 안 바뀜". `reauth_required` 연결을 upgrade가 `active`로 되살리면 커서·watch는 옛 값인데 sync 적재가 없어 다음 cron까지 동기화가 쉰다(Fable N-M7). 스펙 §7의 "readonly는 계속 함께 승인" 전제를 서버가 확인하지 않으면 modify 단독 토큰이 옛 토큰을 복구 불가로 덮는다(N-M6). 일반 경로가 refresh token 없이 scope를 쓰면 vault의 옛(readonly) 토큰과 `scopes`가 어긋나 [권한 업데이트]가 숨고 실행 잡이 403으로 끝난다(N-M5) |
| D13 | iOS 권한 업데이트 | `restorePreviousSignIn()` → 사용자 있고 modify가 아직 없으면 `addScopes([modify])`, 아니면(복원 실패·이미 승인됨) `signIn(additionalScopes: [readonly, modify])`(**`disconnect()` 없음**) → `serverAuthCode` → `upgrade: true`. 취소(-5)는 서버를 부르지 않고 문구 없음. 코드 없음·`refresh_token_stored: false` → "Google이 새 권한을 아직 주지 않았어요. 다음 Gmail 재연결 때 함께 더해져요(테스트 모드는 7일마다 재연결 알림)" | 스펙 D13 문장. 이미 승인된 scope에 `addScopes`는 오류가 날 수 있어(문서 미명시) 새 코드를 받는 일반 로그인으로 돌린다 |
| D14 | 앱 문구 추가 | 스펙에 없던 경우: 미리보기 409 "Gmail 연결이 끊겼어요 — 설정 › Gmail에서 다시 연결해 주세요" + [설정 열기], 429 "Gmail이 잠시 바빠요 — 잠시 뒤 다시 요청해 주세요", 503 "메일 정리를 지금 쓸 수 없어요", 그 밖·네트워크 "메일 정리를 하지 못했어요 — 잠시 뒤 다시 해 주세요", 성공 0 결과 "휴지통으로 옮기지 못했어요 (K건 실패)"(읽음 "읽음으로 바꾸지 못했어요 (K건 실패)"), 읽음 되돌리기 실패·기간 지남의 안내 "Gmail에서 직접 안 읽음으로 바꿀 수 있어요", 되돌릴 것 없음 "되돌릴 메일이 없어요", 취소 "취소했어요", 앱이 닫혀 미리보기를 못 받음 "앱이 닫혀 메일을 찾지 못했어요 — 다시 요청해 주세요", 20분 넘게 끝나지 않음 "아직 처리 중이에요 — 다시 열면 상태를 다시 읽어요"(진행 중 그대로 두고 다시 열거나 앱이 활성화되면 서버를 다시 읽는다), 실행 요청 결과를 모르고 상태도 못 읽음 "결과를 확인하는 중이에요"(진행 중으로 두고 다시 읽는다), 상태 행이 없음(404) "결과를 확인하지 못했어요 — Gmail에서 직접 확인해 주세요", 연결 끊김으로 되돌리기가 시작되지 않음 "Gmail 연결이 끊겨 되돌리지 못했어요 — 설정 › Gmail에서 다시 연결한 뒤 되돌려 주세요" + [설정 열기]([되돌리기]는 남는다), 잡이 끝까지 못 감(`job_dead`·`job_lost`) 결과 둘째 줄 "일부는 이미 바뀌었을 수 있어요 — Gmail 휴지통에서 직접 복원할 수 있어요"(읽음 "… Gmail에서 직접 안 읽음으로 바꿀 수 있어요"), 조건 줄·표본 날짜는 서울 기준 올해가 아니면 연도를 붙인다(`2025/9/1–9/30`, 표본 `2025/9/3`) | M0이 §9에 올린다. 연도: 카드 버튼이 유일한 확인인데 모델이 다른 해를 채우면 "9/1–9/30"만으로는 가려낼 수 없다(Fable N-H3). 결과 불명: 실행 요청이 서버에 닿았는데 응답을 못 받으면 서버는 실행하는데 화면은 "하지 못했어요"가 되고 10분 뒤 [다시 미리보기]가 토큰(= 되돌리기 id)을 버린다(N-H2) |
| D15 | [다시 미리보기]·[다음 1,000건 보기] | 둘 다 서버가 돌려준 `conditions`를 그대로 `preview` 본문으로 보낸다(같은 7칸 — 서버가 다시 검사하며 정제는 멱등, M1 테스트). [다시 미리보기]는 그 턴의 미리보기를 바꾸고(결과가 아직 없다), [다음 1,000건 보기]는 **새 메일 정리 턴**(입력 글 "다음 1,000건 보기")을 만든다 — 앞 턴의 결과·[되돌리기]를 지우지 않게 | 스펙 "같은 conditions로 미리보기부터 다시" |
| D16 | 권한 업데이트 버튼 표시 | 설정이 `connections?select=scopes`를 **따로** 읽는다 — 200이고 연결이 active이며 modify가 없을 때만 [권한 업데이트]. 400(열 없음 = 0030 전)이면 숨긴다. 기존 상태 줄 요청(`select=account_ref,status,expires_at`)은 바꾸지 않는다 | 한 요청에 `scopes`를 넣으면 0030 전 서버에서 400이 나 Gmail 상태 줄까지 사라진다 |
| D17 | 버전·공개 | 이 기능 = **0.14.0**(R-B9 0.15.0). **M11 `MAIL-sim` 통과 전에 0.14.0 커밋을 넣지 않는다.** M8·M9a·M9b 기능 커밋(`feat(core): mail cleanup`·`feat(ios): mail cleanup permission`·`feat(ios): mail cleanup chat`)은 main에 들어간다 — U6b·다른 업로드가 그 전에 올리게 되면 `feat(core): mail cleanup` 직전 커밋에서 올린다(M0 Step 6에서 광고 해지 계획에 한 줄). 기계 가드: M9a가 `ios/scripts/testflight.sh`에 "`MailCleanup.swift`가 있는데 `MARKETING_VERSION` < 0.14.0이면 중단"(우회 `TF_ALLOW_PRE_MAIL=1`, 의도한 예외만)을 넣는다. **MAIL-sim 전 `.mailAction`이 든 빌드(시뮬레이터 Debug 포함)를 실기기에 설치하지 않는다.** 0.14.0 TestFlight는 M12에서 **서버 배포(M10) 뒤**에만 — 배포 전 서버의 `gmail-connect`는 `upgrade`를 몰라 일반 연결(커서 덮기·백필)로 처리한다 | 미검증 기능이 0.13.x 이름으로 나가지 않게, 구 서버 + 새 앱 조합을 사용자 기기에 만들지 않게. M9a의 새 연결·주간 재연결 scope(readonly + modify)가 ③c2 전에 기기로 나가면 그 빌드의 주간 재연결이 곧 modify 재동의다(제약 위반 — Fable N-M13). 가드가 U6b 계획의 문단 하나뿐이면 0.13.x 핫픽스 업로드 경로가 막히지 않는다 |
| D18 | 테스트 사용자 | 호스팅 DB 트랜잭션 테스트 **21**(행은 롤백), `smoke-mail` **22**, `MAIL-sim` **23**. 이미 쓰는 번호 1·2·7·9·11~20·100(2026-10-06 `grep` — 구현 때 다시 본다) | AGENTS.md §7 |
| D19 | 게이트 하네스 | `.context/gate0140/`(token.ts·seed.ts·inject.py·inject.sh·drive.sh·probe.ts·cleanup.ts·`MailGate.swift.txt`·`project.gate0140.yml.txt`·`expected.txt`·udid) — **커밋하지 않는다**(끝나면 지운다). 선례 `.context/gate0130/`(없으면 `gate0120/`) | 지시문 "하네스 커밋 금지" |
| D20 | 403 reason 실측 | MAIL-real ① 전에 운영자가 `.context/gate0140/probe.ts`로 **합성 메일 3통(제목 `[ERURI 테스트]`)에만** 지금(readonly) 토큰으로 `batchModify(removeLabelIds: ["UNREAD"])`를 한 번 보내 403과 `reasons`를 기록한다(권한이 없어 메일은 바뀌지 않는다). 쿼터 reason(`rateLimitExceeded` 등)은 안전하게 일으킬 수 없어 문서·단위 테스트로 두고 스펙 §16에 수용 위험으로 적는다 | 지시문 "미확인 전제는 게이트로: 403 reason". 실사용자 Gmail 쓰기 시도는 합성 메일만 |
| D21 | 칸 검사 보강 | 발신자·제목 단어는 정제 뒤 **글자·숫자(`\p{L}`·`\p{N}`)가 하나도 없으면** `bad_condition`(`"-"`·`"."`·`"@._+-"`·`"❤️"`). 날짜는 **연도 < 2004**면 `bad_condition`(Gmail 출시 전 — 음수 epoch 방지). 정제는 지우기 → NFC 순서라 멱등(`sanitize(sanitize(x)) = sanitize(x)`) | 서버가 "앱이 보낸 칸도 믿지 않는" 유일한 관문이다. Gmail이 구두점·비표시 문자만 있는 구나 음수 epoch를 무시하면(미확인) 휴지통 범위 하한을 통과한 요청이 받은편지함 전체로 넓어진다 — 미확인 동작은 거절 쪽으로 닫는다(Fable N-H4·N-M16). [다시 미리보기]는 서버가 확정한 칸을 다시 보내므로 정제가 멱등이어야 한다(D15) |
| D22 | 앱 상태 다시 읽기 계약 | 메일 정리 턴은 `MailTurn.needsStatusRead`(진행 중이거나 저장된 상태가 끝나지 않음)이면 **저장된 상태와 무관하게 서버를 먼저 한 번 읽는다** — 화면에 나올 때(`onAppear`)와 앱이 활성화될 때(`scenePhase == .active`, 안 보이는 턴 포함). 20분 상한은 GET 뒤에 보고, 넘으면 진행 중 그대로 문구만 남긴다. 실행 요청이 확정 코드(400·403·404·409·410·503)가 아니면(네트워크·5xx·401) 문구 전에 토큰 상태를 1~2회 읽어 `previewed`일 때만 버튼으로 돌린다. [다시 미리보기]도 옛 토큰이 실행됐는지 먼저 본다. 이 프로세스가 요청 중인 턴은 재개하지 않는다(`mailRequesting`) | 되돌리기 요청 직후 앱이 닫히면 저장된 상태는 옛 실행 결과(`done`)라 GET 없이 끝나 "옮겼어요" + [되돌리기]가 남고(Codex C3), 20분 뒤 `ended`가 되면 재개 조건에서 빠져 영구 스피너가 되며(C4), 결과 불명을 "하지 못했어요"로 단정하면 실행된 토큰을 버린다(Fable N-H2) |

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
- chat 코드는 이 계획에서 바꾸지 않는다(M7이 칸 일치 실패로 `MAIL_SCHEMA` 설명을 고칠 때만 — 그때도 `intents` 없는 요청의 바이트 동일 테스트는 그대로, 재배포는 M10). M7은 평가 사례 파일(`intent-cases.json`)·러너 `GATE`·`_intent-eval.ts`의 `WANT`에 0.14.0 게이트 문장 4개를 더한다(선행 계획 "사례를 더하면 `validateCases` 개수 기준도 같이 고친다").

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

**Gmail 래퍼**(`supabase/functions/_shared/gmail.ts`, M2): `GMAIL_MODIFY_SCOPE`, `GmailHttpError(call, status, reasons: string[] = [])`, `QUOTA_REASONS`·`SCOPE_REASONS`, `type GmailFailure = "quota"|"scope"|"rejected"|"gone"|"unknown"`, `classifyGmailError(e: unknown): GmailFailure`, `type ListPage = { messages?: {id}[]; nextPageToken?; resultSizeEstimate? }`, `interface GmailMailApi { list(q, maxResults, pageToken?): Promise<ListPage>; headers(id): Promise<GmailMessage>; labels(id): Promise<{id; labelIds?}>; batchModify(ids, add, remove): Promise<void>; trash(id): Promise<void>; untrash(id): Promise<void>; modify(id, add, remove): Promise<void> }`, `gmailMailApi(accessToken): GmailMailApi`, `MAIL_CALL_TIMEOUT_MS = 15_000`, 기존 `refreshAccessToken(refreshToken, timeoutMs?)`(선택 인자 — 없으면 지금과 같다, 메일 정리 함수·잡은 15초).

**DB**(`0030_mail_cleanup.sql`, M3) — 모두 service role 전용(`revoke … from public, anon, authenticated`):

| 함수 | 반환 | 용도 |
|---|---|---|
| `gmail_note_units(p_user uuid, p_units int)` | void | 수집·미리보기 기록(거절 없음) |
| `gmail_take_units(p_user uuid, p_units int)` | boolean | 메일 정리 잡: 가져간 뒤 합계 ≤ 5,400·자기 몫 ≤ 4,000일 때만 |
| `mail_connection(p_user uuid)` | table(connection_id uuid, account_ref text, status text, scopes text[]) | 사용자 Gmail 연결 1개(최신) |
| `gmail_set_scopes(p_user, p_connection, p_scopes text[])` | void | 일반 연결 경로 |
| `gmail_replace_token(p_user, p_connection, p_refresh_token text, p_scopes text[])` | boolean | 권한 업데이트: **active 연결만**(아니면 false, 불변) vault 교체 + scopes·expires_at(+7일). 커서·watch 불변 |
| `mail_action_preview(p_user, p_connection, p_action text, p_ids text[])` | uuid(= 토큰) | 미리보기 행 |
| `mail_action_counts(r mail_actions)` | jsonb `{id,status,total,done,failed,undone,undo_failed,code,method}` | 상태 응답 모양 |
| `mail_action_start(p_user, p_id, p_lease_prefix text default '')` | jsonb `{result: started|current|not_found|expired, …counts}` | 실행 시작(잡 `mail-action`, 우선순위 20) |
| `mail_action_undo(p_user, p_id, p_lease_prefix text default '')` | jsonb `{result: started|current|busy|nothing_to_undo|expired|not_found, …counts}` | 되돌리기 시작 |
| `mail_action_status(p_user, p_id)` | jsonb counts 또는 null | 상태 |
| `mail_action_begin(p_user, p_id, p_phase text)` | jsonb `{status, action, method, connection_id, ids, cursor}` 또는 `{status}`(끝난 행) 또는 null | 워커: pending→running / undo_pending→undoing |
| `mail_action_set_method(p_user, p_id, p_method text)` | void | null·batch → batch/single |
| `mail_action_progress(p_user, p_id, p_phase, p_from int, p_cursor int, p_ok text[], p_failed text[])` | boolean | 커서 비교(D8) |
| `mail_action_quota(p_user, p_id)` | timestamptz | `quota_since` 처음이면 지금으로, 그 값을 돌려줌 |
| `mail_action_finish(p_user, p_id, p_phase, p_code text default null)` | jsonb counts 또는 null | 남은 id 실패·종료 상태·감사(멱등). 남은 id가 0이면 `p_code`를 적지 않는다. 되돌리기에서 `p_code` ∈ (`reauth_required`, `no_connection`)이고 `undo_cursor = 0`이면 실행 종료 상태로 되돌리고 `error_code = 'undo_' \|\| p_code`(감사 없음, D11) |
| `purge_mail_actions(p_user uuid default null)` | jsonb `{mail_actions, gmail_units, lost}` | cron `mail-actions-purge-daily`(UTC 04:53). 생성 8일 지났고 살아 있는 잡이 없는 진행 중 행을 먼저 `job_lost`로 마감(`lost`) |
| 트리거 `jobs_mail_action_dead` | — | kind `mail-action`이 dead가 되면 `mail_action_finish(…, 'job_dead')` |

**워커**(`supabase/functions/worker/mail-action.ts`·`mail-action-deps.ts`, M4b): `type Phase = "execute"|"undo"`, `MailJobDeps`, `mailActionJob(d, job): Promise<string>`(반환 `done|verified|gone|noop|stale|scope_missing|reauth_required|no_connection`, 미루기는 `Deferred` 코드 `mail_budget|mail_units|mail_quota|mail_retry`), 상수 `MAIL_JOB_BUDGET_MS`(25초)·`BATCH_MAX`·`SINGLE_CHUNK`·`MAX_ATTEMPTS`·`QUOTA_DEFER_MS`·`QUOTA_STUCK_MS`·`RETRY_DEFER_MS`·`UNITS`. `_shared/gmail-jobs.ts`(M4a): `gmailAccessToken(sb, refresh, user, conn): Promise<string|null>`, `noteGmailUnits(sb, user, units, budgetMs?): Promise<boolean>`, `meteredApi(api, note): GmailApi`, `unitsNoter`, `GmailJobDeps.noteUnits?`.

**Edge**(`supabase/functions/mail-action/`, M5): 아래 HTTP 계약, `handleMailAction(req, deps)`, `MailActionDeps`, `sampleOf(msg)`.

```text
POST /functions/v1/mail-action/preview  body = MailFields(7칸) → 200 {token|null, action, conditions, count, exact, total_estimate, starred_estimate, has_more, sample:[{from,subject,date}]}
     401 · 400 bad_json|bad_condition{fields}|needs_target · 403 scope_missing · 404 no_connection · 409 reauth_required · 429 gmail_rate_limited · 502 gmail_upstream · 503 disabled
POST /functions/v1/mail-action/execute  {token} → 202(새 잡)|200(같은 토큰 다시) counts · 400 bad_json|bad_token · 403 scope_missing · 404 not_found|no_connection · 409 reauth_required · 410 token_expired · 503 disabled
POST /functions/v1/mail-action/undo     {id}    → 202|200 counts · 400 bad_json|bad_id · 403 scope_missing · 404 no_connection · 409 busy(+counts)|nothing_to_undo|reauth_required · 410 undo_expired · 502 gmail_upstream(토큰 갱신 일시 오류)
GET  /functions/v1/mail-action/status?id=      → 200 counts · 400 bad_id · 404 not_found
공통: 401(JWT 없음·무효, 본문 없음) · 404 not_found(경로) · 405(메서드, 본문 없음) · 500 internal
counts = {id, status, total, done, failed, undone, undo_failed, code, method}   # code 는 error_code — undo_reauth_required·undo_no_connection 포함(D11)
```

**gmail-connect**(M6): `ConnectDeps.refresh(refreshToken): Promise<string>` 추가, 요청 `{code, upgrade?: boolean}`(D12).

**앱**(M8·M9a·M9b): `MailCleanup`(`intent`·`modifyScope`·`tokenTTL`·`undoTTL`·`isMailAction`·`Conditions`·`Sample`·`Preview`·`Status`·`preview(_:)`·`status(_:)`·`errorCode(_:)`·`conditionLine(_:now:)`·`countLine`·`sampleLine(_:now:)`·`moreLine`·`grouped`·`previewError`·`executeError`·`executeIsDefinite(status:)`·`undoError`·`progress`·`result`·`canUndo`·`isTokenExpired`·`showNext`·`needsUpgrade(rows:)`·`Note`), `MailCleanupText`, `MailTurn`(`needsStatusRead`·`afterStatusRead(_:)`·`apply(_:)`), `ChatHistory.Kind.mailAction`·`Record.mail`, `ChatReply.Answer.mail: JSONValue?`, `JSONValue.foundation`, 앱 `SettingsRouter`·`GmailConnect.upgrade()`(M9a), `MailCleanupAPI`·`MailCleanupCard`(M9b).

## Global Constraints

- **스펙 먼저(AGENTS.md §1):** M0 커밋 전에는 코드 태스크를 시작하지 않는다. 계획과 스펙이 다르면 스펙이 원본이다.
- **버전(AGENTS.md §8):** `MARKETING_VERSION: 0.14.0`(M11, `MAIL-sim` 통과 뒤 커밋). 메이저 금지. R-B9는 0.15.0 — 이 계획은 0.15.0을 쓰지 않는다. 빌드 번호는 업로드 때 `date +%Y%m%d%H%M`(M12).
- **③c2 전 금지(2026-10-08 15:00 KST까지):** 함수·워커 배포, 마이그레이션 적용(`db push`·호스팅 트랜잭션 테스트 포함 — D1), `MAIL_ACTIONS` 켜기, 재동의, 실 Gmail 쓰기. 그 전에는 코드와 **로컬 테스트(가짜 Gmail·PGlite)만**. chat도 예외가 아니다 — M7이 `MAIL_SCHEMA`를 고쳐도 판정은 로컬 러너로 하고 재배포는 M10에서 한다(2026-10-06 메인 판정 (b)). M10은 `docs/superpowers/phase1/gates.md`의 ③c2 완료 기록과 U6b Step 3b(0029 적용) 기록을 확인한 뒤 시작한다(D2).
- **실호출 창:** OpenAI를 부르는 실행(M7 INTENT-eval, M10 smoke의 chat 단계, M11 게이트)은 **10-07·10-08 14:30~16:30 KST 금지, 그날 13:45 이후 시작 금지**(메인이 원장 최신 `status.t0`로 다시 계산). 예상 소요 M7 ≈ 5분, M10 ≈ 40분, M11 ≈ 40분.
- **실 Gmail 쓰기:** 실사용자 Gmail에 대한 쓰기(시도 포함)는 MAIL-real의 합성 메일(제목 접두 `[ERURI 테스트]`)과 D20 probe(같은 3통, 권한 없음 확인)뿐이다. 대조 메일 `[ERURI 대조]`는 읽기만. **영구 삭제 API(`messages.delete`·`batchDelete`)는 코드에 넣지 않는다**(M2 리뷰 확인: `grep -rn 'batchDelete\|messages/.*delete\|method: "DELETE"' supabase/functions` 0줄).
- **개인정보(AGENTS.md §7, 스펙 §12):** 서버 DB·로그·trace·`gates.md`·`results.md`·보고에 메일 제목·발신자·본문·검색 칸 값(`conditions`·`mail`)·Gmail 메시지 id를 쓰지 않는다 — 결과 코드·개수·방식·reason·상태만. `mail_actions`에는 Gmail id·결과만(제목·발신자 열 없음, M3 테스트). 미리보기 글은 응답으로만 앱에 간다. 테스트·평가는 합성 문구만. `items.content_enc` 복호화 조회 금지. 실사용자(`ERURI_USER_ID`)의 items·jobs·connections를 테스트가 만들거나 지우지 않는다.
- **호스팅 DB(AGENTS.md §7):** 테스트 사용자 21·22·23은 이 계획 전용(D18). 21은 트랜잭션 롤백으로만 쓴다. 22·23은 자기 행만 지운다(그 사용자의 `mail_actions`·`gmail_units`·`jobs(kind='mail-action')`·`audit_log(actor='mail-action')`·직접 만든 `connections`, 23은 게이트 시작 이후 그 사용자 `usage_counters`·`llm_slots`·`device_traces`). `truncate`·조건 없는 `delete` 금지.
- **실패 시 아무것도 안 바뀜(MD6):** `gmail-connect` upgrade 경로는 어떤 실패에서도 `revoke`를 부르지 않고 `connections`·vault·`sync_states`·잡을 바꾸지 않는다(M6 테스트로 고정).
- **Swift 6 동시성:** `ChatView` 상태는 메인 액터. 모든 비동기 갱신은 `settle(id, epoch)`(F11) — `await` 뒤 색인으로 턴을 고치지 않는다. `MailCleanup`은 값·순수 함수만.
- **기계(AGENTS.md §6):** 빌드·시뮬레이터·deno 전 `vm_stat | grep -E 'free|compressor'`. 시뮬레이터 빌드와 deno를 동시에 돌리지 않는다. 시뮬레이터는 pane 전용 UDID(`.context/gate0140/udid`).
- **테스트 명령:** 서버 로컬 `deno test --allow-net --allow-env --allow-read --allow-write=/tmp --env-file=supabase/.env supabase/tests/<파일>`(PGlite는 `--allow-read`만 필요하지만 npm 캐시 때문에 `--allow-write=/tmp`를 둔다), 전체 `deno test --allow-net --allow-env --allow-read --allow-write=/tmp --env-file=supabase/.env supabase/tests/ && deno check supabase/functions/{worker,mail-action,gmail-connect,chat}/index.ts supabase/scripts/*.ts`(저장소 루트). **호스팅 DB를 쓰는 `*-db.test.ts`는 ③c2 전에는 이 계획의 새 파일만 빼고 기존 것을 돌리지 않는다** — 기존 DB 테스트는 이 계획이 바꾸지 않으므로 M10에서 전체로 한 번 돈다. 앱 `cd ios && ./scripts/sim.sh gen && ./scripts/sim.sh test EruriCoreTests/<클래스>`, 빌드 `cd ios && ./scripts/sim.sh build`.
- **로컬 필터:** ③c2 전에 기존 테스트 파일을 돌릴 때는 `LOCAL_FILTER='/^([^dg]|d[^a]|g[^m]|gm[^a]|gma[^i]|gmai[^l]|gmail[^_])/'`로(deno 2.7 `--filter` 정규식은 lookahead 미지원 — M2 실측, 2026-10-07. 이 식은 `da…`·`gmail_…`로 시작하는 이름을 모두 빼므로 실행마다 `filtered out` 수가 호스팅 DB 사례 수(gmail.test.ts 3)와 같은지 확인하고, 더 많으면 빠진 이름을 적어 그 파일은 필터 없이 따로 돈다) `gmail.test.ts`의 호스팅 DB 사례 3개(396·415·432행)를 뺀다. 이 계획이 고치는 다른 테스트 파일(`unsub-jobs.test.ts`)은 호스팅 DB를 쓰지 않는다. 구현 때 `grep -n '_testenv' supabase/tests/<파일>`로 다시 본다.
- **모델(AGENTS.md §3):** M0 `opus`/`high`. M1~M6·M8·M9a·M9b 구현·리뷰 `opus`/`high`(M4b 리뷰 확인 필수: "Gmail 성공 뒤 `progress` 전 예외 → 다음 실행이 같은 묶음을 다시 보내고 결과 중복 없음", "Gmail 호출 직전마다 예산 검사 — 건별·재조회 루프 안", "`Deferred`가 attempts를 되돌리는 경로만 미루기(진행 뒤 결과 불명 포함)", "Gmail이 바뀌었을 수 있는 id를 시도·확인 없이 실패로 적는 경로 0(쿼터·예산은 앞부분만 적고 미룸)", "로그에 id 없음"; M9b 리뷰 확인 필수: "await 뒤 색인으로 턴을 고치는 곳 0", "모든 `settle`에 보낼 때 잡은 epoch", "폴링 Task가 epoch·턴 소멸에서 멈춤", "`mail_action` 분기에서 `reply`를 저장하지 않음", "결과 불명 실행·[다시 미리보기]가 상태를 읽기 전에 토큰을 버리지 않음", "재개가 저장된 상태와 무관하게 GET 먼저"). M7·M10 `opus`/`medium`. M11 `opus`/`medium`. M12 실기기 세션은 `sonnet`/`medium`(AGENTS.md §3 — 사람이 옆에서 조작), 판정 기록은 메인이 확인.
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
| F25 | `claim_jobs`는 lease가 끝난 running 잡을 attempts +1로 다시 집고 상한이 없다. `fail_job`은 attempts를 되돌리지 않고 `defer_job`만 −1 | `0007_jobs_backoff.sql:13-40`, `0014_usage_budget.sql:52-56` |
| F26 | `gmail_update(p_cursor)`가 커서를 받으면 `sync_states.last_success_at = now()`(동기화 성공 시각). done 잡을 지우는 cron은 없다(잡 삭제는 사용자·출처 삭제뿐) | `0001_baseline.sql:271-277`, `0012_retention.sql:51`, `0013_source_delete_lock.sql:46` |
| F27 | 앱 `API.send`는 네트워크 오류·타임아웃에 nil이고 401에서만 세션을 바꿔 한 번 재시도한다 | `ios/App/API.swift:5-24` |
| F28 | `ChatView.append`는 새 턴으로 스크롤한다. `scenePhase == .active`에서 `syncClear`·기록 정리·캘린더를 다시 읽는다 | `ios/App/ChatView.swift:103-105,128-135` |
| F29 | `gmail-connect` 재연결은 `gmail_save_connection`의 `on conflict (provider, account_ref)`로 같은 connection id를 유지한다 | `migrations/0001_baseline.sql:236` |

## 미확인 전제와 흡수 게이트 (추측하지 않는다)

| # | 전제 | 상태 | 흡수 게이트 | 실패하면 |
|---|---|---|---|---|
| U1 | `batchModify(addLabelIds: ["TRASH"])`가 휴지통 이동으로 동작한다(되돌리기 `removeLabelIds: ["TRASH"]`) | 문서 미명시(§3) | MAIL-real ②·④ — 행 `method`가 `batch`로 남고 Gmail 휴지통에 3통 | 거절(400)이면 코드가 이미 건별로 넘어간다(`method = single`) — 판정을 `results.md`에 "건별 폴백"으로 적고 스펙 §7대로 1차 batch 시도를 빼는 수정 태스크를 만든다(메인). 200인데 휴지통에 없으면 **실패** — `MAIL_ACTIONS=off`, 메인이 사용자에게 보고 |
| U2 | Gmail 403의 `error.errors[].reason`이 `insufficientPermissions`(권한)·`rateLimitExceeded`·`userRateLimitExceeded`·`quotaExceeded`(쿼터)로 온다 | 문서 근거(usage limits 오류 목록), 권한 쪽 미측정 | D20 probe(MAIL-real 전) — 권한 reason 실측. 쿼터 reason은 수용 위험(스펙 §16) | 다른 reason이면 `SCOPE_REASONS`에 더하는 패치(M2) 후 probe 재실행 |
| U3 | `addScopes` 뒤 `serverAuthCode`가 오고 서버가 새 refresh token을 받는다 | 문서 미명시(§3) | MAIL-real ① | 코드 없음·`refresh_token_stored: false`면 "다음 재연결 때" 안내가 나오고 연결·커서 불변을 확인한 뒤, 판정은 다음 주간 재연결(readonly + modify 요청) 뒤로 미룬다(스펙 §15 ①) |
| U4 | 휴지통 이동·되돌리기가 history로 새 메일처럼 오지 않는다(새 items 0) | 추론(§3·F1) | MAIL-real ③ | 새 items가 생기면 멱등 키로 1건 이하인지 보고, 생겼으면 실패로 적고 `collectNewMessageIds`가 `TRASH` 라벨 메시지를 거르는 수정 태스크(메인) |
| U5 | 되돌린 메일이 받은편지함에 다시 보인다(INBOX 라벨 복원) | 문서 미명시 | MAIL-real ④ | 안 보이면 되돌리기(휴지통)에 `addLabelIds: ["INBOX"]`를 더하는 수정(M4b `opFor`) 후 ④ 재실행(스펙 §7 문장 그대로) |
| U6 | Gmail 검색이 한글 제목 단어 `subject:"테스트"`와 `subject:"ERURI"`를 함께 맞춘다 | 미확인 | MAIL-real ② 미리보기 3건 | 0건이면 MAIL-real을 멈추고 조건 줄·건수만 기록, 메인이 사용자에게 보고(조립 규칙 변경은 스펙부터) |
| U7 | `npm:@electric-sql/pglite`가 이 Deno에서 열리고 plpgsql·`gen_random_uuid()`·`create role`이 된다 | 미확인 | M3 Step 2 | 안 되면 `mail-sql.test.ts`를 지우고 SQL 검증은 M10 호스팅 트랜잭션 테스트(같은 사례)만으로 한다 — 계획 순서는 그대로, M3 커밋 메시지에 적는다 |
| U8 | `GIDGoogleUser.addScopes(_:presenting:)`·`GIDSignIn.restorePreviousSignIn()`가 async로 있다(GoogleSignIn 8) | 미확인(이 세션에서 SDK 소스 안 봄) | M9a Step 5 빌드 | 콜백판만 있으면 `withCheckedThrowingContinuation`으로 감싼다(같은 흐름) |
| U9 | gpt-6-luna가 `mail` 칸을 INTENT-eval 기준(완전 일치 ≥ 90%)으로 채운다 | 0.13.0에서 측정만 | M7 | M7 Step 3 반복(최대 2회). 그래도 실패면 메인이 사용자에게 보고 — 칸이 틀려도 미리보기 조건 줄·건수·위 20건이 받치므로(§12 통제 3) 대안은 "실패 사례 그룹을 INTENT-eval에 더하고 0.14.0 진행" 또는 "보류" |

### 실기기가 필요한 이유 (MAIL-real만)

U1·U3·U4·U5·U6은 실제 Google 계정의 Gmail에서만 재현된다(테스트 사용자에게 Google 계정이 없고, 실사용자 계정을 시뮬레이터에 로그인시키는 것이 오히려 조작이 많다). 화면 흐름(카드·만료·되돌리기·복원·오류 문구·설정 버튼)은 `MAIL-sim`이 시뮬레이터로 닫는다(memory "시뮬레이터 먼저, 실기기는 필수 항목만"). MAIL-real은 사용자 한 세션(약 15분)으로 묶는다.

## Review Focus

1. **잘못된 조건이 범위를 넓힌다.** 사람은 "9월 30일부터 9월 1일까지 합성상점 광고 지워줘"(거꾸로)·"2월 30일 메일"·`"()"`·`"-"`만 있는 발신자·1970년 같은 날짜가 **모든 광고·받은편지함 전체**로 넓어지지 않길 기대한다 → 거꾸로 범위·달력에 없는 날·2004년 전·정제 뒤 빈 값·글자·숫자 없는 값·길이 초과는 `bad_condition`이고 검색·행이 없다(M1 `rejects instead of dropping`, M5 `bad_condition never lists`). 카드 조건 줄은 다른 해 날짜에 연도를 붙인다(M8).
2. **같은 토큰을 두 번 / 응답을 못 받아 다시 보낸다.** 사람은 두 번 눌러도 한 번만 실행되고, 응답을 못 받았어도 실제로 실행됐으면 결과와 [되돌리기]가 보이길 기대한다 → 같은 토큰 → 잡 1개·200 현재 상태(M3 사례 `start twice`, M5 `execute twice`), 앱은 버튼을 누르는 즉시 `running`으로 바꿔 다시 누를 수 없고, 결과 불명이면 토큰 상태를 먼저 읽는다(M8 `executeIsDefinite`, M9b, M11 G7c).
3. **워커가 Gmail 성공 뒤·기록 전에 죽는다 / 잡이 dead가 된다 / Edge 벽시계에 걸린다.** 사람은 결과 카드의 숫자가 맞고 되돌리기가 바뀐 메일만 되돌리길 기대한다 → 다음 실행이 같은 묶음을 다시 보내고 `ok_ids` 중복 없음(M4b `worker dies after Gmail success`·`worker dies in the middle of a single chunk`), 호출마다 예산을 봐 죽기 전에 적고 미룸(M4b `budget is checked before every …`), 늦게 깬 워커는 `stale`(M3 `progress from stale cursor`, M4b `stale`), dead → 트리거가 남은 id 실패로 마감(M3 `dead trigger`)하고 결과 카드가 "일부는 이미 바뀌었을 수 있어요"를 보인다(M8).
4. **권한 업데이트가 실패·취소된다.** 사람은 지금 Gmail 연결·동기화가 그대로이길 기대한다 → upgrade 실패 경로 전부 revoke 0·`gmail_save_connection`·`gmail_update`·`enqueue_job` 0(M6), 취소는 서버를 부르지 않음(M9a), `upgrade: "yes"`처럼 형식이 틀리면 400이고 일반 연결로 흘러가지 않음(M6), 끊긴 연결은 upgrade가 되살리지 않음(M6·M3).
5. **수집이 카운터·메일 정리 때문에 멈춘다.** 사람은 메일 정리를 켜도 새 메일 수집이 빠지지 않길 기대한다 → 기록 RPC 실패·지연에도 `gmail-fetch`는 같은 수를 저장하고 기록은 잡당 한 번 실패 뒤 생략(M4a `units note fails open`), 0030 적용 전에 새 워커가 돌아도 수집은 성공(같은 테스트 — RPC 없음 오류). **수용:** 건별 폴백 1,000건 잡은 `gmail-sync`·`gmail-fetch`와 같은 우선순위 20이라 그동안 수집이 실행 1회(≤ 25초)씩 늦어질 수 있다(lease가 달라 막지는 않는다).
6. **휴지통으로 보낸 메일이 ERURI에서도 사라질까 걱정한다 / 동기화가 새 메일로 다시 받는다.** 사람은 보관함이 그대로이고 같은 메일이 두 번 생기지 않길 기대한다 → 워커 잡에 items·facts RPC 없음(M4b `never touches items`), MAIL-real ③ 새 items 0(동기화가 실제로 돈 것을 관측한 뒤 판정).
7. **되돌리기를 잃는다.** 사람은 [되돌리기]가 실제로 한 번 시도된 뒤에만 사라지길 기대한다 — 원칙: **Gmail이 바뀌었을 수 있는 메일을 시도 없이·확인 없이 실패로 적지 않는다, 되돌리기 종료 상태는 실제로 시도한 뒤에만 만든다.** → 진행 뒤 결과 불명은 attempts를 쓰지 않음(M4b `scattered errors`), 재조회 429는 미룸(M4b `reread hits quota`), 휴지통 batch 404는 건별(M4b), 연결 만료 중 [되돌리기]는 409이고 행 불변(M5), 잡이 토큰을 처음 못 얻어도 되돌리기를 되살림(M3 `undo bounce`), 앱이 [다시 미리보기] 전에 옛 토큰 상태를 읽음(M9b).

---

## 파일 구조

```text
docs/superpowers/specs/2026-09-22-assistant-design.md          # M0 스펙 세부
docs/superpowers/plans/2026-10-01-gmail-unsubscribe.md         # M0 U6b Step 3 워커 배포 기준 커밋·Step 6 업로드 기준
supabase/functions/_shared/mail-query.ts                       # M1 신규: checkConditions·sanitize·seoulMidnight·buildQuery
supabase/tests/mail-query.test.ts                              # M1 신규
supabase/functions/_shared/gmail.ts                            # M2 GMAIL_MODIFY_SCOPE·GmailHttpError.reasons·classifyGmailError·GmailMailApi·gmailMailApi·refreshAccessToken 타임아웃 인자
supabase/tests/gmail-mail.test.ts                              # M2 신규(fetch 스텁)
supabase/migrations-pending/0030_mail_cleanup.sql              # M3 신규(미적용 — M10이 supabase/migrations/로 옮김)
supabase/tests/_mail-sql.ts                                    # M3 신규: 공유 SQL 사례(Q 어댑터)
supabase/tests/_pglite-stubs.ts                                # M3 신규: PGlite용 auth·vault·cron·jobs·connections 최소 스텁
supabase/tests/mail-sql.test.ts                                # M3 신규: PGlite 로컬
supabase/tests/mail-actions-db.test.ts                         # M3 신규: 호스팅 트랜잭션(적용·롤백) — M10에서 실행
supabase/functions/_shared/gmail-jobs.ts                       # M4a gmailAccessToken·noteGmailUnits·meteredApi·unitsNoter·noteUnits 기록
supabase/tests/units.test.ts                                   # M4a 신규(수집 경로 기록)
supabase/functions/worker/mail-action.ts                       # M4b 신규: mailActionJob
supabase/functions/worker/mail-action-deps.ts                  # M4b 신규: mailJobDeps(sb)
supabase/functions/worker/index.ts                             # M4b handlers["mail-action"]
supabase/tests/mail-jobs.test.ts                               # M4b 신규
supabase/functions/mail-action/{handler,deps,index}.ts         # M5 신규
supabase/tests/mail-action.test.ts                             # M5 신규
supabase/functions/gmail-connect/{handler,index}.ts            # M6 upgrade·gmail_set_scopes·refresh
supabase/tests/gmail.test.ts                                   # M6 테스트 추가·rpc 순서 기대 갱신
supabase/eval/intent-cases.json                                # M7 0.14.0 게이트 문장 4개(mail_action)
supabase/scripts/_intent-eval.ts·eval-intent.ts                # M7 WANT 개수·GATE 목록
supabase/scripts/smoke-mail.ts                                 # M10 신규(배포된 mail-action·chat, 사용자 22)
ios/Packages/EruriCore/Sources/EruriCore/MailCleanup.swift     # M8 신규: MailCleanup·MailCleanupText·MailTurn·JSONValue.foundation
ios/Packages/EruriCore/Tests/EruriCoreTests/MailCleanupTests.swift
ios/Packages/EruriCore/Sources/EruriCore/ChatHistory.swift     # M8 .mailAction·mail·restored
ios/Packages/EruriCore/Sources/EruriCore/ChatReply.swift       # M8 Answer.mail
ios/Packages/EruriCore/Sources/EruriCore/ChatAddEvent.swift    # M8 intents += mail_action
ios/Packages/EruriCore/Tests/EruriCoreTests/{ChatHistoryTests,ChatReplyTests,ChatAddEventTests}.swift
ios/App/GoogleSignIn.swift                                     # M9a scopes readonly+modify·upgrade()
ios/App/ContentView.swift                                      # M9a [권한 업데이트]·SettingsRouter
ios/App/EruriApp.swift                                         # M9a 설정 탭 전환
ios/scripts/testflight.sh                                      # M9a 0.14.0 전 버전 이름으로 메일 정리 업로드 금지 가드
ios/App/MailCleanupAPI.swift                                   # M9b 신규: preview·execute·undo·status 호출
ios/App/MailCleanupCard.swift                                  # M9b 신규: 카드 뷰
ios/App/ChatView.swift                                         # M9b mail_action 분기·previewMail·executeMail·readBack·undoMail·pollMail·resumeMail·카드 행
ios/project.yml                                                # M11 0.14.0
docs/superpowers/phase1/gates.md                               # M6·M7·M10·M11·M12
docs/superpowers/poc/results.md                                # M12 MAIL-real
```

`EruriCore`는 SPM이라 새 파일이 자동으로 들어간다. 앱 타깃 새 파일 2개(`MailCleanupAPI.swift`·`MailCleanupCard.swift`)는 `ios/project.yml`의 `sources: App` 경로 아래라 `sim.sh gen`이 넣는다(M9b Step 1에서 확인).

---

### Task M0: 스펙 세부·U6b 배포·업로드 기준

**Files:**
- Modify: `docs/superpowers/specs/2026-09-22-assistant-design.md`(§2 메일 정리 행, §7 "메일 정리" — 덧붙이기와 **어긋난 옛 문장 제자리 교체**, §8 `mail_actions` 행, §9 "채팅 메일 정리", §15 "1단계 추가 범위(2026-10-06 메일 정리 결정)", §16 새 소절 둘)
- Modify: `docs/superpowers/plans/2026-10-01-gmail-unsubscribe.md`(U6b Step 3 워커 배포 기준 커밋 한 문단, U6b Step 6 업로드 한 문단)

**Interfaces:**
- Consumes: 이 계획의 D1~D22, 2026-10-06 메인 판정 (a) 휴지통 batch 404 건별 (b) chat 재배포는 M10 (c) 받은 기간 한쪽 끝으로 범위 하한 충족 수용.
- Produces: 스펙 문장(M1~M12의 근거). 이후 태스크는 스펙과 계획이 다르면 스펙을 따른다.

- [ ] **Step 1: 선행 확인 — 0.13.0이 main에 있는가**

Run: `git log --oneline -40 | grep -E 'feat\(core\): chat add-event|feat\(ios\): add events from chat|feat\(chat\)' ; grep -n 'export const MAIL_SCHEMA\|export type MailFields' supabase/functions/chat/filters.ts; ls supabase/scripts/eval-intent.ts supabase/scripts/_intent-eval.ts; grep -n 'case question, link, image, addEvent' ios/Packages/EruriCore/Sources/EruriCore/ChatHistory.swift; grep -n 'static let intents' ios/Packages/EruriCore/Sources/EruriCore/ChatAddEvent.swift`
Expected: 0.13.0 서버(chat)·EruriCore 커밋이 보이고, `MAIL_SCHEMA`·`MailFields`·`eval-intent.ts`·`.addEvent`·`intents`가 있다. 하나라도 없으면 멈추고 메인에게 알린다(이 계획은 0.13.0 위에서만 성립한다).

- [ ] **Step 2: §2·§7 켜기·지목·미리보기**

스펙에서 아래 문장들을 정확히 찾아 바꾼다(앵커는 2026-10-06 `26e47bb` 본문). 인라인 코드 안의 `\``는 스펙 본문의 실제 백틱이다 — 찾을 때는 역슬래시를 뺀다. 코드 블록 안의 "찾기"·"바꾸기"는 글자 그대로다. **덧붙이기만 하면 스펙 안에 옛 문장과 새 문장이 함께 남는 곳은 제자리에서 바꾼다**(Fable N-M17).

(a) §2 표 "메일 정리" 행 끝 `앱 0.14.0 — 배포·재동의는 Gmail 측정 ③c2(2026-10-08 15:00 KST) 뒤 |` → `앱 0.14.0 — 배포·마이그레이션 적용·재동의는 Gmail 측정 ③c2(2026-10-08 15:00 KST) 뒤(계획 \`2026-10-06-mail-cleanup.md\`) |`

(b) §7 "켜기" 문장 `Gmail 측정 ③c2(2026-10-08 15:00 KST) 전에는 마이그레이션만 넣고, \`mail-action\`·\`gmail-connect\`·worker 배포(실행은 워커 잡이고 수집 경로가 units 카운터를 쓴다, 아래)·플래그 켜기·재동의는 ③c2 뒤다(§15).`를 다음으로 바꾼다:

```text
Gmail 측정 ③c2(2026-10-08 15:00 KST) 전에는 코드와 로컬 테스트(가짜 Gmail, SQL은 PGlite)만 한다 — 마이그레이션 파일은 `supabase/migrations-pending/0030_mail_cleanup.sql`(미적용)이고, 적용은 ③c2 뒤 광고 해지 U6b가 0029를 적용한 다음이다(번호 순서, 그리고 `jobs` 트리거·`connections` 열이 측정 중 두 표에 잠금을 만들지 않게). `mail-action`·`gmail-connect`·worker·chat 배포(실행은 워커 잡이고 수집 경로가 units 카운터를 쓴다, 아래)·플래그 켜기·재동의도 ③c2 뒤다(§15). 광고 해지 U6b의 워커 배포는 메일 정리 서버 커밋 직전의 기준 커밋에서 하고, 메일 정리 워커는 그 뒤 따로 배포한다(회귀 귀속 — 계획 D2). 플래그가 꺼져 있으면 `mail-action`의 미리보기·실행은 503 `disabled`이고 되돌리기·상태는 동작한다(끄는 것이 롤백이어도 이미 한 정리를 되돌릴 수 있게).
```

(c) §7 지목의 거절 목록을 **제자리에서** 바꾼다.

찾기:

```text
정제 뒤 빈 값(값이 있었는데 남는 글자가 없음), 달력에 없는 날짜(`2026-02-30`)
```

바꾸기:

```text
정제 뒤 빈 값이거나 글자·숫자가 하나도 남지 않음(값이 있었는데 남는 글자가 없거나 `-`·`.`·이모지처럼 기호만 남음 — Gmail이 그런 구를 무시하면 범위가 넓어진다), 달력에 없는 날짜(`2026-02-30`)·2004년 전 날짜(Gmail 출시 전 — 음수 epoch 방지)
```

그리고 같은 줄 끝 `→ 400 \`bad_condition\` \`{fields: [칸 이름]}\`(값은 돌려주지 않는다), 행을 만들지 않는다.` 바로 뒤에 붙인다:

```text
 불리언·날짜 칸이 없으면(키 없음·null) 거짓·없음으로 본다. 빈 문자열·공백뿐인 발신자·제목 단어는 값이 없는 것으로 본다(정제 뒤 비거나 글자·숫자가 없는 것 — 원래 글자가 있었는데 지워진 경우 — 만 거절). 정제는 지우기 → NFC 순서라 같은 값을 다시 정제해도 같다(멱등 — [다시 미리보기]가 서버가 확정한 칸을 다시 보낸다). 제목 단어는 정제 뒤 같은 것을 하나로 친다. 알지 못하는 키(모델이 쓴 `q` 등)는 읽지 않는다.
```

(d) §7 범위 하한 문장 `(받은편지함 전체를 휴지통으로 보내는 요청을 막는다).` 바로 뒤에 ` 이 경우 400 \`needs_target\`(행·검색 없음). 받은 기간은 한쪽 끝(시작만·끝만)으로도 하한을 채운다(2026-10-06 메인 판정 — 수용, 카드 조건 줄·건수·위 20건이 받친다).`을 붙인다.

(e) §7 미리보기 문장의 표본 읽기를 **제자리에서** 바꾼다: `앞 20개 \`messages.get(format=metadata, From·Subject·Date)\`` → `앞 20개 \`messages.get(format=metadata, From·Subject)\`(날짜는 메시지의 \`internalDate\`)`. 그리고 "비용" 줄(`- 비용: list 5 units × 최대 6 …(아래 "속도", 거절하지 않음).`) 바로 아래에 줄을 더한다:

```text
  - 세부(계획 `2026-10-06-mail-cleanup.md` D3·D5): 연결이 active가 아니거나 토큰을 갱신하지 못하면 409 `reauth_required`(갱신의 `invalid_grant`는 수집 잡과 같이 연결을 `reauth_required`로 두고 재인증 푸시), Gmail 쿼터(429·403 쿼터 reason) 429 `gmail_rate_limited`, 그 밖 Gmail 오류·타임아웃·토큰 갱신 일시 오류 502 `gmail_upstream`. 미리보기 전체는 25초 예산이다(목록 6회 + 표본 4묶음 × 호출 15초가 겹쳐 Edge 벽시계에 걸리지 않게 — 넘으면 502 `gmail_upstream`, 행 없음). **0건이면 행을 만들지 않고** 200 `token: null`·`count: 0`. 표본은 `from` = From 표시 이름(없으면 주소, 60자)·`subject` 100자·`date` = 받은 시각 ISO이고, 그사이 지워진 표본(404)은 빠진다(건수는 그대로). `total_estimate`는 끝까지 읽었으면 `count`, 아니면 첫 페이지 추정치와 `count` 중 큰 값이다(추정치가 모은 수보다 작아 "총 약 900건 중 1,000건"이 되지 않게).
```

- [ ] **Step 3: §7 실행·되돌리기·권한 업데이트·보관, §8**

(a) §7 실행 문장 `**미리보기 때 찾은 id만** 실행한다(그사이 새로 온 메일은 대상이 아니다).` 뒤에 붙인다:

```text
 반대로 그사이 사용자가 별표를 달거나 받은편지함에서 옮긴 메일도 대상에 남는다(수용 — 결과 카드의 [되돌리기]로 복구한다). 연결이 active가 아니면 실행·되돌리기 요청도 409 `reauth_required`이고 행을 바꾸지 않는다.
```

(b) §7 "id별 결과" 줄의 옛 시그니처를 **제자리에서** 바꾼다: `\`mail_action_progress(p_id, p_ok, p_failed, p_cursor)\` 한 트랜잭션으로` → `\`mail_action_progress(p_user, p_id, p_phase, p_from, p_cursor, p_ok, p_failed)\` 한 트랜잭션으로(지금 커서가 \`p_from\`이고 \`|ok| + |failed| = p_cursor − p_from\`일 때만 붙인다 — 아니면 false라 lease가 끝난 뒤 늦게 깬 워커는 아무것도 적지 않고 끝난다, 계획 D8)`.

(c) §7 "결과 불명·재개" 줄을 **제자리에서** 두 군데 바꾼다.

찾기 1:

```text
타임아웃·연결 끊김·5xx로 결과를 모르면 잡 실패(`fail_job`, 백오프 attempts × 60초)로 같은 묶음을 다시 보낸다
```

바꾸기 1:

```text
타임아웃·연결 끊김·5xx로 결과를 모르면 같은 묶음을 다시 보낸다 — 이번 실행에서 아직 진행이 없으면 잡 실패(`fail_job`, 백오프 attempts × 60초), 이번 실행에서 커서가 이미 전진했으면 1분 미루기(`defer_job`, attempts 쓰지 않음 — 흩어진 일시 오류가 attempts를 쌓아 마지막 시도로 몰고 뒤 id를 시도 없이 실패로 마감하지 않게, 계획 D7)
```

찾기 2:

```text
목표 상태(휴지통 = `TRASH` 있음, 읽음 = `UNREAD` 없음)면 성공, 아니면 실패로 적고
```

바꾸기 2:

```text
목표 상태(휴지통 = `TRASH` 있음, 읽음 = `UNREAD` 없음)면 성공, 아니면(404 등 오류 포함) 실패로 적고 — 재조회도 20개씩 units를 가져가 진행을 남기고, 호출 전마다 예산을 보며(넘으면 읽은 앞부분을 적고 미룸), 429·쿼터 reason이면 읽은 앞부분만 적고 쿼터 미루기를 한다(휴지통에 간 메일을 쿼터 때문에 실패로 적지 않게, 계획 D10) —
```

그리고 같은 줄 끝(`… "Gmail 휴지통에서 직접 복원" 안내가 받친다).`) 바로 뒤에 붙인다: ` 마감 때 커서 뒤 남은 id가 없으면 오류 코드를 적지 않는다(마지막 기록 뒤 잡이 죽어도 \`done\`에 \`job_dead\`가 붙지 않게).`

(d) §7 "lease·예산" 줄의 예산 문장을 **제자리에서** 바꾼다.

찾기:

```text
워커 호출 예산(100초) 안에서 묶음을 이어가고, 예산이 끝나면 커서를 남긴 채 `defer_job`(attempts 되돌림)으로 다시 대기한다.
```

바꾸기:

```text
잡 1회 예산은 25초이고(토큰 갱신 포함) Gmail 호출 직전마다 본다 — batch 묶음 시작, 건별은 id마다, 재조회도 id마다. 넘으면 그때까지 처리한 id를 적고 커서를 남긴 채 `defer_job`(attempts 되돌림)으로 다시 대기한다. Gmail 호출 1건과 토큰 갱신은 15초에서 끊는다(워커 배치 예산 100초 끝에 클레임돼도 100 + 25 + 15 = 140 < Edge 벽시계 150초 — 묶음 시작에서만 보면 건별 20 × 15초가 벽시계를 넘어 잡이 죽고, 죽음은 lease 만료 재클레임으로 attempts만 쌓는다, 계획 D7). 쿼터 미루기의 시작 시각은 행 `quota_since`에 두고 성공한 묶음이 지운다(아래 30분 판정). 토큰을 못 얻으면 연결이 active가 아니면 `reauth_required`, 아니면 `no_connection`으로 마감한다(D11).
```

(e) §7 "휴지통" 줄의 폴백 조건을 **제자리에서** 바꾼다(2026-10-06 메인 판정 (a)).

찾기:

```text
**일괄 TRASH 거절로 확인된 응답(400 — `invalidArgument`·`badRequest` 등)에서만** 같은 잡에서 건별 `messages.trash`로 넘어간다.
```

바꾸기:

```text
**일괄 거절로 확인된 응답(400 — `invalidArgument`·`badRequest` 등)이나 404(사라진 id 섞임 추정)일 때** 같은 잡에서 건별 `messages.trash`로 넘어간다(2026-10-06 메인 판정 — 404를 결과 불명으로 두면 사용자가 영구 삭제한 한 통 때문에 재조회가 나머지를 실패로 적어 되돌리기를 잃는다. 건별은 404 id만 실패로 가른다, 계획 D9).
```

그리고 같은 줄 끝 `실행 방식은 행의 \`method\`(batch/single)에 남긴다(되돌리기가 같은 방식을 쓴다).` 뒤에 붙인다:

```text
 건별에서 한 id가 400·404면 그 id만 실패다(일괄 미지원으로 보지 않는다). batch → 건별 전환은 실행 단계에서만 `method`에 남기고 되돌리기는 그 값을 따른다 — 휴지통 `single`이면 처음부터 `untrash`, `batch`면 batch 먼저(400·404면 건별), 읽음은 늘 batch 먼저(계획 D9).
```

(f) §7 "오류 reason 분기" 줄의 토큰 문장을 **제자리에서** 바꾼다.

찾기:

```text
토큰 갱신 `invalid_grant` → 같은 방식(`reauth_required`, 기존 재인증 경로가 연결을 처리).
```

바꾸기:

```text
토큰 갱신 `invalid_grant` → 실행은 같은 방식(`reauth_required`, 남은 id 실패, 기존 재인증 경로가 연결을 처리). 되돌리기는 아직 하나도 되돌리지 않았으면(`undo_cursor = 0`) 행을 실행 종료 상태(`done`/`partial`)로 되돌리고 `error_code = undo_reauth_required`(연결 없음이면 `undo_no_connection`)만 남긴다 — 되돌리기를 쓰지 않은 것이라 다시 연결한 뒤 되돌릴 수 있다(재연결은 같은 연결 id를 쓴다. 테스트 모드는 토큰 7일·되돌리기 7일이라 만료가 늘 되돌리기 창 안에 온다, 계획 D11). 대부분은 함수가 먼저 막는다 — 되돌리기 요청 때 연결이 active가 아니거나 토큰을 갱신하지 못하면 409 `reauth_required`이고 행을 바꾸지 않는다.
```

(g) §7 "속도" 줄의 기록 문장을 **제자리에서** 바꾼다.

찾기:

```text
수집 경로(`gmail-fetch`·`gmail-sync`·`gmail-unsub-fetch`)와 미리보기는 호출 전에 `gmail_note_units(p_user, p_units)`로 쓴 양을 더하기만 한다(거절 없음 — 수집은 지금처럼 240ms 간격이 실행당 몫을 제한한다).
```

바꾸기:

```text
수집 경로와 미리보기는 호출 전에 `gmail_note_units(p_user, p_units)`로 쓸 양을 더하기만 한다(거절 없음 — 수집은 지금처럼 240ms 간격이 실행당 몫을 제한한다). `gmail-fetch`·`gmail-unsub-fetch`는 이미 있는 10통 단위 연결 확인 자리에서 다음 10통 몫(20 × 통수)을, `gmail-sync`는 history 페이지 2·list 페이지 5·profile 1을 호출마다 적는다. 기록은 fail-open이다 — RPC 1초 예산, 잡당 첫 실패·초과 뒤 그 잡의 나머지 기록은 생략(로그 `units_note_error` 1줄)해 카운터가 수집을 늦추거나 실패시키지 않는다(계획 D6). 메일 정리 잡이 units를 못 가져가 미루는 데는 상한이 없다 — 그동안 행은 `running`이라 되돌리기는 `busy`다(수용, 수집이 분당 몫을 다 쓰는 동안만 생긴다).
```

(h) §7 "진행·결과" 줄의 `\`{id, status, total, done, failed, undone, undo_failed, code}\`(개수·상태만)`를 `\`{id, status, total, done, failed, undone, undo_failed, code, method}\`(개수·상태·방식만 — \`undone\` = 되돌리기 커서 − 되돌리기 실패 수. 실행·되돌리기 응답도 같은 모양, 계획 D4)`로 바꾼다.

(i) §7 "되돌리기" 줄 두 군데: `(지남·정리됨 410 \`undo_expired\`)`를 `(지남·정리됨 410 \`undo_expired\` — 행이 없으면 정리된 것과 가를 수 없어 늘 410. 연결이 active가 아니거나 토큰을 갱신하지 못하면 409 \`reauth_required\`이고 행을 바꾸지 않는다)`로, `휴지통: \`method = batch\`면 \`batchModify(removeLabelIds: ["TRASH"])\`,`를 `휴지통: \`method = batch\`면 \`batchModify(removeLabelIds: ["TRASH"])\`(400·404면 건별 \`untrash\`),`로 바꾼다.

(j) §7 "보관" 줄의 `\`pending\`·\`running\`·\`undo_pending\`·\`undoing\` 행은 끝날 때까지 건너뛴다)` 뒤에 붙인다: ` 생성 8일이 지났는데 살아 있는 잡이 없는 진행 중 행은 같은 정리가 먼저 \`job_lost\`로 마감한다(잡이 사라진 행이 영원히 남지 않게).`

(k) §7 권한 업데이트의 서버 문장 끝 `… \`scopes\`·\`expires_at\`(테스트 모드 +7일)·status active를 갱신한다.` 뒤에 붙인다:

```text
 세부(계획 D12): `upgrade`가 있는데 불리언이 아니면 400 `bad_upgrade`(일반 연결로 흘러 커서·백필을 다시 하지 않게), 연결이 없으면 404 `no_connection`, 연결이 active가 아니면 409 `reauth_required`(upgrade는 끊긴 연결을 되살리지 않는다 — `gmail_replace_token`도 active 연결만 바꾼다. 끊긴 연결은 기존 재연결로), 계정 비교는 대소문자 무시, 새 토큰의 `scope`에 modify **와 readonly**가 둘 다 있어야 한다(읽기 경로가 readonly 승인을 전제하므로 없으면 403 `gmail_scope_missing`, 옛 토큰을 덮지 않는다), 갱신 확인 실패 502 `token_verify_failed`, 교체 실패 500 `replace_failed`, profile 401은 502 `gmail_unauthorized`(401이면 앱이 세션을 바꿔 일회용 코드를 다시 보낸다), 성공 200 `{connection_id, refresh_token_stored: true, upgraded: true}`. profile의 401·403도 연결 상태를 바꾸지 않는다. 일반 연결 경로는 refresh token을 저장했을 때만 저장 직후 `gmail_set_scopes`로 `scopes`를 남기고(토큰 없이 scope만 쓰면 vault의 옛 토큰과 어긋난다), 그 기록이 실패해도 연결은 성공이다(readonly로 보여 [권한 업데이트]가 남을 뿐).
```

(l) §7 권한 업데이트의 iOS 줄(`- 설정 › Gmail [권한 업데이트](연결돼 있고 modify가 없을 때만 보인다): iOS …`) 끝에 붙인다:

```text
 앱은 먼저 `restorePreviousSignIn()`으로 사용자를 되살리고, 되살리지 못했거나 Google 쪽에 modify가 이미 승인돼 있으면 `disconnect()` 없이 일반 로그인(추가 scope readonly + modify)으로 새 코드를 받아 같은 `upgrade` 요청을 보낸다(계획 D13). 서버 호출이 네트워크 오류면 같은 코드로 한 번 다시 보낸다. 버튼 표시는 `connections`의 `scopes`를 상태 줄과 따로 읽어 정한다 — 열이 없는 서버(0030 전)면 숨긴다(D16). 0.14.0 전 버전 이름으로는 이 코드가 든 빌드를 올리지 않는다(`testflight.sh` 가드, D17).
```

(m) §8 `mail_actions` 행: `| \`mail_actions\` | connection_id(connections cascade),`를 `| \`mail_actions\` | user_id(auth.users cascade), connection_id(connections cascade),`로, `undo_failed_ids text[], error_code null,`을 `undo_failed_ids text[], error_code null(\`scope_missing\`·\`reauth_required\`·\`no_connection\`·\`job_dead\`·\`job_lost\`·\`undo_reauth_required\`·\`undo_no_connection\`), quota_since null(쿼터 미루기 시작 — 성공 묶음이 지운다, 계획 D7),`로 바꾼다.

- [ ] **Step 4: §9 문구·§15 순서·게이트**

(a) §9 "채팅 메일 정리" 실행 줄의 `+ \`has_more\`면 [다음 1,000건 보기](같은 \`conditions\`로 미리보기부터 다시, 다시 확인)`를 `+ \`has_more\`이고 성공이 있으면 [다음 1,000건 보기](같은 \`conditions\`로 미리보기부터 다시, 다시 확인 — 입력 글 "다음 1,000건 보기"인 새 메일 정리 턴이라 앞 턴의 결과·[되돌리기]는 그대로, 계획 D15)`로 바꾼다.

(b) §9 미리보기 카드 줄 두 군데를 **제자리에서** 바꾼다: `예 "발신자 '합성상점' · 광고 · 9/1–9/30 · 별표 제외")`를 `예 "발신자 '합성상점' · 광고 · 9/1–9/30 · 별표 제외". 서울 기준 올해가 아닌 날짜는 연도를 붙인다 — "2025/9/1–9/30", 모델이 다른 해를 채워도 사용자가 카드에서 가려낼 수 있게)`로, `위 20건 \`발신자 · 제목 · M/D\`(나머지는 "외 N건")`를 `위 20건 \`발신자 · 제목 · M/D\`(올해가 아니면 \`Y/M/D\`, 보낸 사람·제목이 없으면 "(보낸 사람 없음)"·"(제목 없음)", 나머지는 "외 N건")`로.

(c) §9 실행 줄의 `3초마다 상태, 앱을 닫아도 서버에서 계속되고 다시 열면 그 턴이 상태를 다시 읽는다)`(앞은 `(읽음 "읽음으로 바꾸는 중 N/M", `)를 `3초마다 상태, 앱을 닫아도 서버에서 계속되고 다시 열거나 앱이 활성화되면 그 턴이 저장된 상태와 무관하게 서버 상태를 먼저 다시 읽는다 — 되돌리기 요청 직후 닫혀도 옛 실행 결과가 남지 않게. 20분이 지나도 끝나지 않으면 진행 중 그대로 "아직 처리 중이에요 — 다시 열면 상태를 다시 읽어요"를 보인다. 실행 요청의 응답을 받지 못했으면(네트워크·5xx) 문구를 내기 전에 토큰 상태를 먼저 읽어 실행되지 않았을 때만 버튼으로 돌린다. [다시 미리보기]도 옛 토큰이 그사이 실행됐는지 먼저 본다 — 실행된 턴을 새 미리보기로 덮어 [되돌리기]를 잃지 않게, 계획 D22)`로 바꾼다.

(d) §9 오류 문구 줄 끝 `실행 중 권한·연결이 끊김(\`error_code\`) "Gmail 권한(연결)이 바뀌어 K건을 처리하지 못했어요" + [설정 열기].` 뒤에 붙인다:

```text
 그 밖(계획 D14): 미리보기 연결 끊김(409) "Gmail 연결이 끊겼어요 — 설정 › Gmail에서 다시 연결해 주세요" + [설정 열기], Gmail 쿼터(429) "Gmail이 잠시 바빠요 — 잠시 뒤 다시 요청해 주세요", 기능 꺼짐(503) "메일 정리를 지금 쓸 수 없어요", 그 밖·네트워크 "메일 정리를 하지 못했어요 — 잠시 뒤 다시 해 주세요"(실행 요청이면 토큰 상태를 먼저 읽고 실행되지 않았을 때만 — 버튼을 다시 누를 수 있다, 같은 토큰이라 멱등), 실행 요청 결과를 모르고 상태도 못 읽음 "결과를 확인하는 중이에요"(진행 중으로 두고 다시 읽는다), 상태 행이 없음 "결과를 확인하지 못했어요 — Gmail에서 직접 확인해 주세요", 성공 0 결과 "휴지통으로 옮기지 못했어요 (K건 실패)"(읽음 "읽음으로 바꾸지 못했어요 (K건 실패)"), 잡이 끝까지 못 감(`job_dead`·`job_lost`) 결과 둘째 줄 "일부는 이미 바뀌었을 수 있어요 — Gmail 휴지통에서 직접 복원할 수 있어요"(읽음 "… Gmail에서 직접 안 읽음으로 바꿀 수 있어요"), 읽음의 되돌리기 실패·기간 지남 안내는 "Gmail에서 직접 안 읽음으로 바꿀 수 있어요", 되돌릴 것 없음(409 `nothing_to_undo`) "되돌릴 메일이 없어요", 연결 끊김으로 되돌리기가 시작되지 않음(409 `reauth_required`, 또는 결과 코드 `undo_reauth_required`·`undo_no_connection`) "Gmail 연결이 끊겨 되돌리지 못했어요 — 설정 › Gmail에서 다시 연결한 뒤 되돌려 주세요" + [설정 열기]([되돌리기]는 남는다), [취소] "취소했어요", 미리보기를 받기 전에 앱이 닫힘 "앱이 닫혀 메일을 찾지 못했어요 — 다시 요청해 주세요". [다시 미리보기]는 서버가 확정한 `conditions`를 그대로 다시 보낸다(D15). 권한 업데이트 결과: "Gmail 권한을 업데이트했어요", 코드·새 토큰 없음 "Google이 새 권한을 아직 주지 않았어요. 다음 Gmail 재연결 때 함께 더해져요(테스트 모드는 7일마다 재연결 알림)", 동의 화면에서 메일 정리 권한을 빼면 "메일 정리 권한이 체크되지 않았어요 — 다시 눌러 권한을 체크해 주세요", 다른 계정 "연결된 Gmail과 다른 Google 계정이에요 — 연결된 계정으로 다시 해 주세요", 그 밖 "권한 업데이트를 하지 못했어요 — 잠시 뒤 다시 해 주세요", 취소는 문구 없음.
```

(e) §15 "1단계 추가 범위(2026-10-06 메일 정리 결정)" 문단의 `순서: 마이그레이션(새 표·함수만, 기존 경로 불변 — 측정 창 밖) → 서버 테스트(가짜 Gmail) → ③c2(2026-10-08 15:00 KST) 뒤 함수·**워커** 배포(실행이 워커 잡이고 수집 경로가 바뀌므로 측정 중에는 배포하지 않는다, 2026-10-06 리뷰 반영) → \`MAIL_ACTIONS=on\`·0.14.0 TestFlight·재동의.`를 다음으로 바꾼다:

```text
순서(계획 `2026-10-06-mail-cleanup.md`): 서버 테스트(가짜 Gmail, SQL은 PGlite 로컬 — 마이그레이션 파일은 `supabase/migrations-pending/0030_mail_cleanup.sql`, 미적용) → ③c2(2026-10-08 15:00 KST) 뒤, 광고 해지 U6b가 워커 배포(메일 정리 서버 커밋 직전 기준 커밋에서)·0029 적용을 마친 다음 호스팅 트랜잭션 DB 테스트 → 0030 적용 → **워커** 배포·회귀(실행이 워커 잡이고 수집 경로가 바뀌므로 측정 중에는 배포하지 않는다, 2026-10-06 리뷰 반영 — U6b와 합치지 않는다: 회귀가 깨졌을 때 어느 변경 탓인지 가르기 위해) → `mail-action`·`gmail-connect` 배포(INTENT-eval에서 `MAIL_SCHEMA`를 고쳤으면 chat도 이때) → `MAIL_ACTIONS=on`·`MAIL-deploy` 스모크 → `MAIL-sim` → 0.14.0 TestFlight → 재동의·`MAIL-real`.
```

(f) 같은 문단 끝 `INTENT-eval은 0.13.0과 공유한다(\`mail\` 칸 판정 포함). 게이트:`를 `INTENT-eval은 0.13.0과 공유한다(\`mail\` 칸 판정 포함 — 0.14.0 게이트 문장 4개 "합성상점에서 온 광고 메일 휴지통에 버려줘"·"받은편지함 메일 다 휴지통에 버려줘"·"제목에 ERURI 테스트 들어간 메일 휴지통으로 보내줘"·"제목에 ERURI 테스트 들어간 안 읽은 메일 읽음 처리해줘"는 3회 모두 의도·칸이 기대값). 게이트:`로 바꾸고, 바로 아래 "- **서버 테스트(가짜 Gmail)**:"를 "- **서버 테스트(가짜 Gmail) — 게이트 행 `MAIL-server`**:"로 바꾸고, 그 줄 끝 `테스트 사용자·실행 태그 규칙(AGENTS.md §7).` 앞에 `잡이 Gmail 호출 직전마다 예산을 보고 넘으면 처리한 만큼 적고 미룸·진행 뒤 결과 불명은 attempts를 쓰지 않음·재조회 쿼터는 미룸, 되돌리기 연결 문제는 되돌리기를 되살림, 함수·표 권한(service role 전용·RLS 켜짐·정책 없음), `를 넣는다. 그 줄과 "- **MAIL-real**" 줄 사이에 두 줄을 넣는다:

```text
- **MAIL-deploy**(배포 스모크, 테스트 사용자 22 — Gmail 계정 없음): 401·404 `no_connection`·403 `scope_missing`·400 `bad_condition`(fields)·400 `needs_target`·409 `reauth_required`, 시드 행 실행 → 202 → 배포된 워커가 토큰 없음으로 `failed`(`no_connection`) 마감, 같은 토큰 다시 → 200 같은 상태, 만료 토큰 410, 남의·없는 토큰 404, 되돌리기 규칙(409 `nothing_to_undo`·토큰 없는 연결의 되돌리기 409 `reauth_required`와 행 불변), `upgrade` 형식 오류 400·가짜 코드 502와 연결 행 불변, chat `intents`에 `mail_action`이 있을 때만 `mail_action`(없으면 `question`), 수집 회귀(`smoke-gate`·`gmail-gate status` dead 0), 맥락 경로 질문 회귀(CTX-eval, `intents` add_event·mail_action).
- **MAIL-sim**(시뮬레이터, 테스트 사용자 23): 채팅 → 미연결·권한 없음·범위 없음 문구와 [설정 열기] → 설정 [권한 업데이트] 표시·숨김, 주입한 미리보기 카드(조건 줄·건수·위 20건·외 N건) → 실행 → 진행 → 결과(토큰 없음이라 권한(연결) 문구), 만료 → [다시 미리보기], 결과 → [되돌리기](토큰 없음이라 409 — 행 불변, [되돌리기] 남음), 앱 재실행 뒤 진행 중 턴이 상태를 다시 읽음(저장된 상태가 끝난 것이어도 서버를 먼저 읽음), 이미 실행된 토큰의 [실행]이 결과 카드로 이어짐, [다음 1,000건 보기]가 새 턴, 기기 로그에 합성 제목·발신자 없음.
```

(f2) §15 "**INTENT-eval**(0.13.0·0.14.0 공유)" 줄의 `\`mail_action\` 15(문장마다 정답 \`mail\` 칸, 맥락으로 대상을 채우는 "그 발신자 메일 휴지통에 버려줘" 2 포함).`를 `\`mail_action\` 15(문장마다 정답 \`mail\` 칸, 맥락으로 대상을 채우는 "그 발신자 메일 휴지통에 버려줘" 2 포함). 0.14.0 판정 전에 메일 정리 게이트 문장 4개("합성상점에서 온 광고 메일 휴지통에 버려줘"·"받은편지함 메일 다 휴지통에 버려줘"(칸은 동작만 — 범위 없음)·"제목에 ERURI 테스트 들어간 메일 휴지통으로 보내줘"·"제목에 ERURI 테스트 들어간 안 읽은 메일 읽음 처리해줘")를 \`mail_action\`에 더해 73개(\`mail_action\` 19)로 돌리고, 이 4개는 3회 모두 의도·칸이 기대값이어야 한다(이미 같은 글이 있으면 그 사례를 쓴다 — 메일 정리 계획 M7).`로 바꾼다.

(g) §15 "**MAIL-real**" 줄의 `): ① 설정 › Gmail [권한 업데이트]`를 `): ⓪ 운영자 probe — 지금(readonly) 토큰으로 합성 메일 3통(제목 \`[ERURI 테스트]\`)에만 \`batchModify(removeLabelIds: ["UNREAD"])\` 1회 → 403과 reason 기록(권한이 없어 바뀌지 않는다, 계획 D20) ① 설정 › Gmail [권한 업데이트]`로 바꾸고, 같은 줄의 `③ 그동안 새 items 0건(history 이벤트가 새 메일로 잡히지 않음)`을 `③ 그동안 새 items 0건(history 이벤트가 새 메일로 잡히지 않음 — 실행 뒤 동기화가 실제로 돈 것(\`sync_states.last_success_at\`이 실행 시각 뒤)을 본 다음 판정한다)`로 바꾼다.

- [ ] **Step 5: §16 새 소절 둘**

§16의 `### 플랜 B: 로컬 우선 구조` 바로 앞에 넣는다:

```text
### 2026-10-06 메일 정리 구현 계획 세부 (계획 `2026-10-06-mail-cleanup.md`, 메인 판단 — 사용자 재검토 가능)

계획이 스펙의 빈칸을 채운 것: ① 마이그레이션은 `migrations-pending/0030`으로 두고 ③c2 뒤 U6b의 0029 다음에 적용(D1) ② U6b 먼저, 이 계획 배포는 그다음 — 합치지 않음, U6b 워커는 메일 정리 서버 커밋 직전 기준 커밋에서 배포(D2, 회귀 귀속) ③ 오류 코드 추가(`needs_target`·`reauth_required`·`gmail_rate_limited`·`gmail_upstream`·`disabled`·`bad_upgrade`·`token_verify_failed`·`replace_failed`)와 0건이면 행 없음(D3·D12) ④ 상태 응답에 `method`(D4) ⑤ 수집 경로 units 기록은 10통·페이지 단위, fail-open(1초·잡당 차단기, D6) ⑥ 잡 25초·호출 15초 예산을 Gmail 호출 직전마다 보고, 진행 뒤 결과 불명은 미루기, 쿼터 30분 판정은 행 `quota_since`(D7) ⑦ 진행 기록은 커서 비교(D8) ⑧ 폴백·되돌리기 방식 규칙 — 휴지통 batch도 400·404에서 건별(D9) ⑨ 마지막 시도 재조회는 20개씩 진행 기록, 쿼터는 미룸(D10) ⑩ 되돌리기가 연결 문제로 하나도 못 했으면 되돌리기를 되살림(D11) ⑪ iOS 권한 업데이트는 `restorePreviousSignIn` → `addScopes`, 안 되면 `disconnect()` 없는 일반 로그인(D13) ⑫ [다음 1,000건 보기]는 새 턴(D15) ⑬ [권한 업데이트] 표시는 `scopes`를 따로 읽음(D16) ⑭ 0.14.0 TestFlight는 서버 배포 뒤에만, 0.14.0 전 버전 이름 업로드는 `testflight.sh`가 막음(구 `gmail-connect`는 `upgrade`를 몰라 일반 연결로 처리한다, D17) ⑮ 칸 검사: 글자·숫자 없는 값·2004년 전 날짜 거절, 정제 멱등(D21) ⑯ 앱은 진행 중·결과 불명 턴의 서버 상태를 먼저 읽는다(D22) ⑰ 다른 해 날짜는 조건 줄·표본에 연도 표기.
메인 판정(2026-10-06, 계획 리뷰 뒤): (a) 휴지통 batch 404도 건별 — 위 ⑧ (b) INTENT-eval에서 `MAIL_SCHEMA`를 고쳐도 chat 재배포는 서버 배포 단계(③c2 뒤)에서 — 판정은 로컬 러너 (c) 받은 기간 한쪽 끝만으로 휴지통 범위 하한을 채우는 것은 스펙대로 수용(카드가 받친다).
수용 위험: 쿼터 403 reason(`rateLimitExceeded`·`userRateLimitExceeded`·`quotaExceeded`)은 안전하게 일으킬 수 없어 실측하지 않는다 — Gmail 오류 문서와 단위 테스트에 기대고, 다른 값이 오면 "결과 불명"(재시도·마지막 시도 재조회)으로 처리돼 메일이 잘못 바뀌지는 않는다. 권한 reason은 MAIL-real ⓪ probe로 잰다(D20). 메일 정리 잡의 units 미루기는 상한이 없다(그동안 되돌리기 `busy`). 건별 폴백 잡은 수집과 같은 우선순위 20이라 수집이 실행 1회씩 늦어질 수 있다. 미리보기와 실행 사이에 별표를 단 메일도 대상에 남는다(되돌리기로 복구).

### 외부 리뷰 반영 (메일 정리 계획, Codex gpt-6-astra · Fable, 2026-10-06)

계획 `2026-10-06-mail-cleanup.md` @ `5c3641b`를 Codex(HIGH 2·MED 4·LOW 1)와 Fable(Codex 7건 판정 + 놓친 것 HIGH 4·MED 19·LOW)이 읽기 전용으로 리뷰했다. 계획 리뷰 반영 커밋이 HIGH·MED를 모두 반영했다(태스크 분할은 커밋·리뷰 단위만 — 부분, LOW 하나 미반영, 받은 기간 한쪽 끝 하한은 수용 — 번호별 반영·부분·미반영과 이유는 계획 끝 "외부 리뷰 반영" 표). 스펙에 닿는 것: Codex #1 호출마다 예산(§7 lease·예산), #2 U6b 워커 배포 격리(§7 켜기·§15 순서), #3·#4 재개 계약(§9 실행 줄), Fable N-H1 연결 만료 중 되돌리기 소진 방지(§7 reason 분기·되돌리기), N-H2 실행 결과 불명(§9), N-H3 연도 표기(§9), N-H4·N-M16 칸 검사(§7 지목), N-M1·N-M2 진행 뒤 미루기·재조회 쿼터(§7 결과 불명), N-M3 휴지통 batch 404(§7 휴지통, 메인 판정 (a)), N-M5~N-M7 권한 업데이트 세부(§7), N-M12 `job_dead` 안내·남은 id 없는 마감(§7·§9), N-M17 옛 문장 제자리 교체(이 커밋).
```

- [ ] **Step 6: 광고 해지 계획 U6b — Step 3 워커 배포 기준 커밋·Step 6 업로드**

`docs/superpowers/plans/2026-10-01-gmail-unsubscribe.md`에 두 문단을 넣는다.

(a) **Step 3(워커 배포·회귀)**: `— \`_shared/extract-text.ts\` 는 v19 배포본과 같아야 한다(다르면 새 변경).`로 끝나는 문단 바로 뒤(`Run: \`git log --oneline -1 && git diff --stat 39728f3..HEAD …\`` 앞)에 빈 줄 하나와 다음을 넣는다(Codex C2·Fable 판정):

````text
**메일 정리 격리(계획 `2026-10-06-mail-cleanup.md` D2, 2026-10-06 리뷰 반영):** main에 메일 정리 서버 커밋(`supabase/functions/_shared/mail-query.ts`를 처음 더한 커밋 — 메일 정리 M1)이 있으면 **이 Step의 diff·배포·회귀는 main HEAD가 아니라 기준 커밋 `B` = 그 커밋의 부모의 worktree에서 한다**. 메일 정리 워커(수집 경로 units 기록·`mail-action` 잡)는 ③c2·이 U6b 뒤 메일 정리 계획 M10이 따로 배포한다(회귀 귀속). 메일 정리 커밋이 없으면 `B` = main HEAD(지금 절차 그대로).

```bash
ROOT=$PWD; REF=$(cat supabase/.temp/project-ref)                 # .temp·.env 는 gitignore — worktree 에는 없다
M1=$(git log --diff-filter=A --format=%h -1 -- supabase/functions/_shared/mail-query.ts)
if [ -n "$M1" ]; then B=$(git rev-parse --short "$M1^"); else B=$(git rev-parse --short HEAD); fi
WT="$TMPDIR/u6b-worker-$B" && git worktree add --detach "$WT" "$B" && cd "$WT" && cp -R "$ROOT/supabase/.temp" supabase/ && git log --oneline -1   # .temp(pooler-url 등)를 읽는 스크립트용 — gitignore라 커밋되지 않는다
```

그 트리에서 아래 `git diff --stat 39728f3..HEAD …`(HEAD = `B`)·`supabase functions deploy worker --project-ref "$REF"`·회귀 스크립트(`smoke-gate`·`gmail-gate status`·`eval-link`·`run-multi-event-eval`, 모두 `--env-file="$ROOT/supabase/.env"`)를 실행한다 — 회귀가 배포본과 같은 코드를 본다. `UNS-server`에 적는 배포 HEAD는 `B`다(메일 정리 M10 Step 4가 `$U6B`로 쓴다). 끝나면 `cd "$ROOT" && git worktree remove "$WT"` — Step 3b부터는 main(`$ROOT`)에서 한다. 채팅 일정 등록(0.13.0)은 `_shared`·`worker`를 바꾸지 않으므로 Expected 목록은 그대로다 — `B`까지의 diff에 이 계획·SHARE 밖 변경이 보이면 멈추고 메인에게 알린다.
````

(b) **Step 6(TestFlight)**: `미검증 채팅 일정 등록이 0.12.x 이름으로 나가지 않게.`(0.13.0 계획 A0 Step 7이 넣은 문단의 끝)를 찾는다. 없으면 `미검증 채팅 기록 기능이 0.11.x 이름으로 나가지 않게.`를 앵커로 쓴다. 그 바로 뒤에 빈 줄 하나와 다음 문단을 넣는다:

```text
**메일 정리(계획 `2026-10-06-mail-cleanup.md` D17):** main에 `feat(core): mail cleanup` 커밋이 있는데 `gates.md`에 `MAIL-sim` 통과 행이 없으면 main HEAD를 올리지 않는다 — 그 커밋의 부모(`git log --format=%h -1 --grep '^feat(core): mail cleanup'`의 `^`)에서 위와 같은 방식으로 worktree를 만들어 올린다(main의 `testflight.sh`도 0.14.0 전 버전 이름이면 멈춘다). 위 채팅 기록·일정 등록 규칙과 함께 걸리면 **더 이른 커밋**에서 올린다. 미검증 메일 정리가 0.13.x 이름으로, 그리고 `upgrade`를 모르는 구 `gmail-connect`와 함께 사용자 기기에 나가지 않게. 이 계획(메일 정리)의 배포(M10)는 U6b Step 3b(0029 적용)가 끝난 뒤에 시작한다.
```

- [ ] **Step 7: 확인·커밋**

Run: `git diff --stat && grep -c '2026-10-06-mail-cleanup.md' docs/superpowers/specs/2026-09-22-assistant-design.md && grep -n 'MAIL-deploy\|MAIL-sim\|needs_target\|quota_since\|bad_upgrade\|undo_reauth_required\|job_lost' docs/superpowers/specs/2026-09-22-assistant-design.md | wc -l && grep -c 'mail_action_progress(p_id, p_ok\|워커 호출 예산(100초)\|From·Subject·Date)\|TRASH 거절로 확인된\|invalid_grant. → 같은 방식(\|결과를 모르면 잡 실패' docs/superpowers/specs/2026-09-22-assistant-design.md; grep -n '메일 정리 격리\|메일 정리(계획' docs/superpowers/plans/2026-10-01-gmail-unsubscribe.md`
Expected: 스펙·광고 해지 계획 두 파일만 바뀜, 계획 참조 ≥ 4, 새 이름 줄 ≥ 8, **옛 문장 0**(제자리 교체 확인 — 0이 아니면 그 문장을 찾아 바꾼다), 광고 해지 계획에 두 문단(Step 3·Step 6).

```bash
git add docs/superpowers/specs/2026-09-22-assistant-design.md docs/superpowers/plans/2026-10-01-gmail-unsubscribe.md
git commit -m "docs(spec): mail cleanup plan details — pending 0030 applied after ③c2 and U6b's 0029, U6b deploys its worker from the commit before mail cleanup, extra error codes and empty preview without a row, status carries method, compare-and-set progress, 25 s job budget checked before every Gmail call and deferral after progress, trash batch 404 falls back per message, last-attempt reread defers on quota, undo blocked by a dead connection is restored, rejects symbol-only values and pre-2004 dates, years on other-year dates, app rereads server state before resuming or re-previewing, upgrade contract and iOS restore/addScopes flow, new copy, gates MAIL-server/deploy/sim and probe step, outdated sentences replaced in place; external plan review section; U6b uploads before mail cleanup unless MAIL-sim passed

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
  for (const x of ["e🙂\u0301", "합성\"상점\"", "a  {b}  c", "❤️x"]) assertEquals(sanitize(sanitize(x)), sanitize(x), x);   // 멱등(D15·D21): 지운 뒤 NFC
  assertEquals(sanitize("e🙂\u0301"), "é");
});

Deno.test("symbol-only values and pre-2004 dates are rejected (they could make Gmail ignore the term and widen the range)", () => {
  for (const s of ["-", ".", "@._+-", "❤️", "--", "_"]) {
    assertEquals(checkConditions({ ...base, sender: s }), { ok: false, code: "bad_condition", fields: ["sender"] }, s);
    assertEquals(checkConditions({ ...base, promotions: true, subject_words: [s] }), { ok: false, code: "bad_condition", fields: ["subject_words"] }, s);
  }
  assertEquals(checkConditions({ ...base, received_from: "1999-12-31" }), { ok: false, code: "bad_condition", fields: ["received_from"] });
  assertEquals(checkConditions({ ...base, received_to: "1969-12-31" }), { ok: false, code: "bad_condition", fields: ["received_to"] });
  assertEquals(ok({ received_from: "2004-01-01" }).received_from, "2004-01-01");
  assertEquals(ok({ sender: "a-b" }).sender, "a-b");                                              // 글자가 있으면 기호는 남는다
});

Deno.test("query shape: one-day range, end only, start only", () => {
  assertEquals(buildQuery(ok({ received_from: "2026-09-01", received_to: "2026-09-01" })), `in:inbox -is:starred after:${S(2026, 9, 1)} before:${S(2026, 9, 2)}`);
  assertEquals(buildQuery(ok({ received_to: "2026-09-30" })), `in:inbox -is:starred before:${S(2026, 10, 1)}`);
  assertEquals(buildQuery(ok({ received_from: "2026-09-01" })), `in:inbox -is:starred after:${S(2026, 9, 1)}`);
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
  assertEquals(checkConditions({ ...base, sender: 5 }), { ok: false, code: "bad_condition", fields: ["sender"] });
  assertEquals(checkConditions({ ...base, promotions: true, subject_words: "주문" }), { ok: false, code: "bad_condition", fields: ["subject_words"] });
  assertEquals(checkConditions({ ...base, promotions: true, subject_words: [1] }), { ok: false, code: "bad_condition", fields: ["subject_words"] });
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
  assertEquals(ok({ promotions: true, subject_words: [" "] }).subject_words, []);               // 공백뿐 = 값 없음(거절 아님)
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
export const YEAR_MIN = 2004;                                         // Gmail 출시 전 날짜는 거절(음수 epoch — Gmail 이 무시하면 범위가 넓어진다, D21)
const DROP = /[^\p{L}\p{M}\p{N}\s@._+-]/gu;
const WORDY = /[\p{L}\p{N}]/u;                                         // 정제 뒤 글자·숫자가 하나는 있어야 한다(기호만 남은 구는 거절, D21)
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

// 글자·숫자·공백과 @._+- 만 남긴다(따옴표·괄호·중괄호·콜론·역슬래시 등은 지운다). 결과는 늘 따옴표로 감싸 쓴다.
// 지운 뒤 NFC — 지우기가 결합 문자를 앞 글자에 붙여 주므로 이 순서여야 멱등이다(다시 미리보기, D15)
export function sanitize(v: string): string {
  return v.replace(DROP, "").normalize("NFC").replace(/\s+/g, " ").trim();
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
      if (!WORDY.test(s)) bad.push("sender"); else sender = s;
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
        if (!WORDY.test(s)) { bad.push("subject_words"); break; }
        if (!words.includes(s)) words.push(s);
      }
    }
  }

  const day = (k: "received_from" | "received_to"): string | null => {
    const v = r[k];
    if (v === null || v === undefined) return null;
    if (typeof v !== "string" || seoulMidnight(v) === null || Number(v.slice(0, 4)) < YEAR_MIN) { bad.push(k); return null; }
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
Expected: 12 passed, 0 failed, check 무오류. (`"합성🙂상점  "`의 이모지는 `\p{So}`라 지워진다. `cafe\u0301` 사례가 실패하면 NFC 정규화가 빠진 것, 멱등 사례가 실패하면 지우기·NFC 순서가 뒤집힌 것. `"❤️"`는 U+2764(지움)와 U+FE0F(결합 표시 — 남음)라 글자·숫자 검사로 거절된다.)

- [ ] **Step 5: 커밋**

```bash
git add supabase/functions/_shared/mail-query.ts supabase/tests/mail-query.test.ts
git commit -m "feat(server): mail cleanup conditions — check the seven fields in one place (reject reversed, impossible or pre-2004 dates, values that sanitize to nothing or to symbols only, over-long or too many words, wrong types; never drop a field; sanitize is idempotent), trash needs sender/subject/date/promotions, read is always unread-only, and build the Gmail query server-side (in:inbox -is:starred, quoted values, Seoul day bounds) ignoring any model-written query

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task M2: Gmail 쓰기·목록·메타 래퍼 (`_shared/gmail.ts`)

**Files:**
- Modify: `supabase/functions/_shared/gmail.ts:7-11`(주석 줄 포함 — GmailHttpError·scope 상수), `:35-44`(`refreshAccessToken` 선택 타임아웃 인자), 파일 끝(새 함수·인터페이스)
- Test: `supabase/tests/gmail-mail.test.ts`

**Interfaces:**
- Consumes: 기존 `G`(API 기준 URL), `GmailMessage`.
- Produces: `GMAIL_MODIFY_SCOPE`, `MAIL_CALL_TIMEOUT_MS`, `GmailHttpError.reasons`, `QUOTA_REASONS`, `SCOPE_REASONS`, `GmailFailure`, `classifyGmailError(e)`, `ListPage`, `GmailMailApi`, `gmailMailApi(accessToken)`, `refreshAccessToken(rt, timeoutMs?)` — M4b·M5·M6이 쓴다. 기존 `GmailClient`·`gmailApi`는 바꾸지 않는다(F4). `refreshAccessToken`은 인자가 없으면 지금과 같다(수집 경로 불변).

- [ ] **Step 1: 실패하는 테스트**

`supabase/tests/gmail-mail.test.ts`:

```ts
import { assert, assertEquals, assertRejects } from "jsr:@std/assert";
import { classifyGmailError, GMAIL_MODIFY_SCOPE, GmailHttpError, gmailMailApi, MAIL_CALL_TIMEOUT_MS, refreshAccessToken } from "../functions/_shared/gmail.ts";

// 메일 정리 Gmail 래퍼(스펙 §7): 요청 모양·reason 파싱·분류. fetch 를 바꿔 끼운다(네트워크 없음)
type Call = { url: URL; method: string; body: unknown; auth: string | null; signal: AbortSignal | null };
function stub(respond: (c: Call) => Response) {
  const calls: Call[] = [];
  const orig = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const c: Call = { url: new URL(input instanceof Request ? input.url : String(input)), method: init.method ?? "GET",
      body: typeof init.body === "string" ? JSON.parse(init.body) : null, auth: new Headers(init.headers).get("authorization"),
      signal: init.signal ?? null };
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
    assert(s.calls.every((c) => c.signal instanceof AbortSignal));                // 호출마다 타임아웃 신호(D7 — 15초)
    assertEquals(MAIL_CALL_TIMEOUT_MS, 15_000);
  } finally { s.restore(); }
});

Deno.test("refreshAccessToken: an optional timeout adds an abort signal; without it the request is unchanged (collection path)", async () => {
  const s = stub(() => Response.json({ access_token: "at" }));
  try {
    assertEquals(await refreshAccessToken("rt"), "at");
    assertEquals(await refreshAccessToken("rt", MAIL_CALL_TIMEOUT_MS), "at");
    assertEquals([s.calls[0].signal, s.calls[1].signal instanceof AbortSignal], [null, true]);
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
  assertEquals(classifyGmailError(E(401)), "unknown");                           // 401 은 함수·잡이 따로 다룬다(연결 문제)
  assertEquals(classifyGmailError(new TypeError("network")), "unknown");
  assertEquals(classifyGmailError(new DOMException("t", "TimeoutError")), "unknown");
  assertEquals(GMAIL_MODIFY_SCOPE, "https://www.googleapis.com/auth/gmail.modify");
});
```

- [ ] **Step 2: 실패 확인**

Run: `deno test --allow-read --allow-env supabase/tests/gmail-mail.test.ts`(`refreshAccessToken`이 클라이언트 env 를 읽는다)
Expected: FAIL — `gmailMailApi`·`classifyGmailError`·`GMAIL_MODIFY_SCOPE`·`MAIL_CALL_TIMEOUT_MS` export 없음.

- [ ] **Step 3: 구현**

`supabase/functions/_shared/gmail.ts` 7~11행(주석 한 줄 + 클래스 + readonly 상수)을 바꾼다:

```ts
// Gmail API가 2xx가 아닌 상태를 돌려줌. 메시지는 "<호출> <상태>"만(토큰·본문 없음). reasons = 오류 본문의 reason 코드(메일 정리 쓰기 경로만 채운다)
export class GmailHttpError extends Error {
  constructor(readonly call: string, readonly status: number, readonly reasons: string[] = []) { super(`${call} ${status}`); this.name = "GmailHttpError"; }
}
export const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
export const GMAIL_MODIFY_SCOPE = "https://www.googleapis.com/auth/gmail.modify";   // 메일 정리(스펙 §7): 읽기·라벨·휴지통, 영구 삭제 불가
```

`refreshAccessToken`(35행)에 선택 인자를 더한다 — 메일 정리 함수·잡은 15초에서 끊고(D7), 인자가 없는 기존 호출(수집 경로)은 그대로다:

```ts
export async function refreshAccessToken(refreshToken: string, timeoutMs?: number): Promise<string> {
  const r = await fetch(TOKEN_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ refresh_token: refreshToken, ...webClient(), grant_type: "refresh_token" }),
    ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}) });
```

(나머지 본문은 그대로.) 파일 끝에 더한다:

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
Expected: `gmail-mail` 6 passed, `gmail.test.ts`·`unsub-jobs.test.ts`의 가짜 사례 전부 통과, 호스팅 DB 사례 3개는 걸러짐(filtered out 3). `AbortSignal.timeout` 타이머가 deno 테스트 sanitizer(`Leaking async ops`)에 걸리면 — 스텁이 즉시 응답해 타이머가 남는 경우 — 해당 `Deno.test`를 `{ name, sanitizeOps: false, fn }` 꼴로 바꾸고 보고에 적는다(제품 코드는 바꾸지 않는다).

Run: `grep -rn 'batchDelete\|messages/.*delete\|method: "DELETE"' supabase/functions; deno check supabase/functions/_shared/gmail.ts`
Expected: 첫 명령 출력 없음(영구 삭제 없음), check 무오류.

- [ ] **Step 5: 커밋**

```bash
git add supabase/functions/_shared/gmail.ts supabase/tests/gmail-mail.test.ts
git commit -m "feat(server): Gmail mail-cleanup calls — list with resultSizeEstimate, From/Subject metadata, minimal labels, batchModify/trash/untrash/modify with a 15 s timeout, errors carry status and reason codes only, and classifyGmailError splits 403 into quota or scope by reason (other 403s stay unknown, never treated as batch-unsupported); refreshAccessToken takes an optional timeout (collection calls unchanged); no permanent delete call exists

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
- Produces: "이 계획이 만드는 인터페이스" DB 표 전부(이름·인자·반환 그대로) — M4b·M5·M6·M10이 쓴다. `supabase/tests/_mail-sql.ts`의 `MIGRATION_0030`(M10이 경로를 바꾼다)·`CASES`(19)·`setupCtx`·`MAIL_FUNCTIONS`.

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
-- 권한 업데이트(§7): 토큰만 바꾼다 — 연결 행·sync_states(커서·watch)·잡은 그대로. 옛 토큰은 vault 에서 덮어쓸 뿐 revoke 하지 않는다.
-- active 연결만(계획 D12): 끊긴 연결을 되살리면 커서·watch 는 옛 값인데 sync 적재가 없어 동기화가 쉰다 — 끊긴 연결은 기존 재연결 경로로
create or replace function gmail_replace_token(p_user uuid, p_connection uuid, p_refresh_token text, p_scopes text[]) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_secret uuid;
begin
  perform 1 from public.connections where id = p_connection and user_id = p_user and provider = 'gmail' and status = 'active' for update;
  if not found then return false; end if;
  select id into v_secret from vault.secrets where name = 'gmail_rt:' || p_connection;
  if v_secret is null then perform vault.create_secret(p_refresh_token, 'gmail_rt:' || p_connection);
  else perform vault.update_secret(v_secret, p_refresh_token); end if;
  update public.connections set scopes = p_scopes, expires_at = now() + interval '7 days' where id = p_connection;
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

-- 마감(§7): 커서 뒤 남은 id 를 실패로 적고 종료 상태·감사(개수만). 이미 끝났으면 바꾸지 않는다(멱등).
-- 남은 id 가 없으면 p_code 를 적지 않는다(마지막 기록 뒤 잡이 죽어도 done 에 job_dead 가 붙지 않게, 계획 D11)
create or replace function mail_action_finish(p_user uuid, p_id uuid, p_phase text, p_code text default null) returns jsonb language plpgsql as $$
declare r mail_actions; v_status text; v_rest text[];
begin
  select * into r from mail_actions where id = p_id and user_id = p_user for update;
  if not found then return null; end if;
  if p_phase = 'execute' then
    if r.status not in ('pending', 'running') then return mail_action_counts(r); end if;
    v_rest := coalesce(r.msg_ids[(r.cursor + 1):], '{}');
    r.failed_ids := r.failed_ids || v_rest;
    v_status := case when cardinality(r.ok_ids) = 0 then 'failed' when cardinality(r.failed_ids) = 0 then 'done' else 'partial' end;
    update mail_actions set failed_ids = r.failed_ids, cursor = cardinality(r.msg_ids), status = v_status,
      error_code = case when cardinality(v_rest) > 0 then coalesce(p_code, error_code) else error_code end,
      executed_at = now(), quota_since = null where id = p_id returning * into r;
    insert into audit_log (user_id, actor, action, target) values (p_user, 'mail-action',
      case when r.action = 'trash' then 'mail_trash' else 'mail_read' end,
      'mail_action:' || p_id || ' ok=' || cardinality(r.ok_ids) || ' failed=' || cardinality(r.failed_ids));
  elsif p_phase = 'undo' then
    if r.status not in ('undo_pending', 'undoing') then return mail_action_counts(r); end if;
    -- 연결 문제로 하나도 되돌리지 못했으면 되돌리기를 쓰지 않은 것으로 돌린다 — 다시 연결한 뒤 되돌릴 수 있게(계획 D11, Fable N-H1).
    -- 상태는 실행 종료 상태로, 코드는 undo_<코드>(앱 문구), 감사 없음(Gmail 이 바뀌지 않았다)
    if p_code in ('reauth_required', 'no_connection') and r.undo_cursor = 0 then
      update mail_actions set status = case when cardinality(r.failed_ids) = 0 then 'done' else 'partial' end,
        error_code = 'undo_' || p_code, quota_since = null where id = p_id returning * into r;
      return mail_action_counts(r);
    end if;
    v_rest := coalesce(r.ok_ids[(r.undo_cursor + 1):], '{}');
    r.undo_failed_ids := r.undo_failed_ids || v_rest;
    v_status := case when cardinality(r.undo_failed_ids) = 0 then 'undone'
                     when cardinality(r.undo_failed_ids) >= cardinality(r.ok_ids) then 'undo_failed' else 'undo_partial' end;
    update mail_actions set undo_failed_ids = r.undo_failed_ids, undo_cursor = cardinality(r.ok_ids), status = v_status,
      error_code = case when cardinality(v_rest) > 0 then coalesce(p_code, error_code) else error_code end,
      undone_at = now(), quota_since = null where id = p_id returning * into r;
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

-- 보관(§7·§8): 생성 7일 지난 행(진행 중은 끝난 뒤), 1시간 지난 units 행. p_user = 테스트 범위.
-- 안전망: 생성 8일 지났는데 살아 있는 잡이 없는 진행 중 행은 먼저 job_lost 로 마감한다(잡이 지워져 영원히 남는 행이 없게)
create or replace function purge_mail_actions(p_user uuid default null) returns jsonb language plpgsql as $$
declare a int; u int; l int;
begin
  perform mail_action_finish(m.user_id, m.id, case when m.status in ('pending', 'running') then 'execute' else 'undo' end, 'job_lost')
  from mail_actions m
  where m.created_at < now() - interval '8 days' and m.status in ('pending', 'running', 'undo_pending', 'undoing')
    and (p_user is null or m.user_id = p_user)
    and not exists (select 1 from jobs j where j.kind = 'mail-action' and j.payload->>'id' = m.id::text and j.status in ('queued', 'running'));
  get diagnostics l = row_count;
  delete from mail_actions where created_at < now() - interval '7 days'
    and status not in ('pending', 'running', 'undo_pending', 'undoing') and (p_user is null or user_id = p_user);
  get diagnostics a = row_count;
  delete from gmail_units where minute < now() - interval '1 hour' and (p_user is null or user_id = p_user);
  get diagnostics u = row_count;
  return jsonb_build_object('mail_actions', a, 'gmail_units', u, 'lost', l);
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
Expected: `[ { ok: true } ]`. 오류면 U7 실패 — Step 3의 `_pglite-stubs.ts`·`mail-sql.test.ts`를 만들지 않고 Step 4(공유 사례·호스팅 테스트 파일)만 만든 뒤 Step 6에서 `deno check`만 하고, 커밋 메시지에 "PGlite unavailable — SQL verified only in M10"을 적는다. 이 경우 M10 Step 3에 SQL 수정 1회(수정 커밋 → 호스팅 트랜잭션 테스트 재실행)의 여유를 메인에게 알린다(배포 창 시간 계획).

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
const jobs = (c: Ctx, id: string) => c.q("select id, kind, lease_key, priority, payload, status from jobs where user_id = $1::uuid and payload->>'id' = $2 order by created_at, payload->>'phase'", [c.user, id]);   // 한 트랜잭션 안은 created_at 이 같다 — execute < undo
const dead = async (c: Ctx, jobId: string) => {                            // 실제 dead 경로(fail_job, attempts ≥ 5)
  await c.q("update jobs set attempts = 5 where id = $1::uuid", [jobId]);
  await c.q("select fail_job($1::uuid, 'test')", [jobId]);
};
export const MAIL_FUNCTIONS = ["gmail_note_units", "gmail_take_units", "mail_connection", "gmail_set_scopes", "gmail_replace_token", "mail_same_set",
  "mail_action_counts", "mail_action_preview", "mail_action_start", "mail_action_undo", "mail_action_status", "mail_action_begin",
  "mail_action_set_method", "mail_action_progress", "mail_action_quota", "mail_action_finish", "mail_action_job_dead", "purge_mail_actions"];
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
  { name: "dead trigger: a mail-action job that goes dead via fail_job closes the row (rest failed, job_dead); other kinds are untouched", run: async (c) => {
    const [a] = ids3(c), id = await preview(c);
    await start(c, id); await begin(c, id, "execute");
    await progress(c, id, "execute", 0, 1, [a], []);
    const j = (await jobs(c, id))[0];
    await dead(c, j.id);
    assertEquals((await one(c.q, "select status from jobs where id = $1::uuid", [j.id])).status, "dead");
    const r = await row(c, id);
    assertEquals([r.status, r.error_code, r.failed_ids.length, r.ok_ids], ["partial", "job_dead", 2, [a]]);
    const other = (await one(c.q, "select enqueue_job($1::uuid, 'process', $2, $3::jsonb) as id", [c.user, c.prefix + "p", JSON.stringify({ id })])).id;
    await dead(c, other);
    assertEquals((await row(c, id)).status, "partial");
  } },
  { name: "nothing left to close: dead after the last progress → done without a code; finish with a code after the cursor reached the end writes no code", run: async (c) => {
    const [a, b, d] = ids3(c), id = await preview(c);
    await start(c, id); await begin(c, id, "execute");
    await progress(c, id, "execute", 0, 3, [a, b, d], []);
    await dead(c, (await jobs(c, id))[0].id);
    const r = await row(c, id);
    assertEquals([r.status, r.error_code, r.failed_ids], ["done", null, []]);
    const id2 = await preview(c);
    await start(c, id2); await begin(c, id2, "execute");
    await progress(c, id2, "execute", 0, 3, [a, b], [d]);
    assertEquals([(await finish(c, id2, "execute", "scope_missing")).status, (await row(c, id2)).error_code], ["partial", null]);
  } },
  { name: "undo bounce: a connection problem before any undo puts the row back to done/partial with undo_<code>, no audit, and undo can start again; after progress it closes normally", run: async (c) => {
    const [a, b, d] = ids3(c);
    const id = await done(c, [a, b], [d]);
    await undo(c, id); await begin(c, id, "undo");
    const f = await finish(c, id, "undo", "reauth_required");
    assertEquals([f.status, f.code, f.undone, f.undo_failed, f.done], ["partial", "undo_reauth_required", 0, 0, 2]);
    const r = await row(c, id);
    assertEquals([r.undo_cursor, r.undo_failed_ids, r.undone_at], [0, [], null]);
    assertEquals((await audits(c, id)).map((x) => x.action), ["mail_trash"]);                // 되돌리기 감사 없음
    const u2 = await undo(c, id);
    assertEquals([u2.result, u2.status], ["started", "undo_pending"]);                       // 다시 연결한 뒤 되돌릴 수 있다
    await begin(c, id, "undo");
    await progress(c, id, "undo", 0, 1, [a], []);
    const f2 = await finish(c, id, "undo", "no_connection");                                 // 진행 뒤 = 보통 마감
    assertEquals([f2.status, f2.undone, f2.undo_failed, f2.code], ["undo_partial", 1, 1, "no_connection"]);
    const n = await done(c, [a]);
    await undo(c, n);
    assertEquals((await finish(c, n, "undo", "no_connection")).code, "undo_no_connection");  // undo_pending(시작 전)도 같다
  } },
  { name: "privileges: every 0030 function is not executable by anon or authenticated; both tables have RLS on and no policy", run: async (c) => {
    const rows = await c.q(`select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon,
      has_function_privilege('authenticated', p.oid, 'execute') as auth from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = any($1::text[])`, [arr(MAIL_FUNCTIONS)]);
    assertEquals(rows.map((r) => r.proname).sort(), [...MAIL_FUNCTIONS].sort());
    assertEquals(rows.filter((r) => r.anon || r.auth).map((r) => r.proname), []);
    const rls = await c.q("select relname, relrowsecurity from pg_class where relname in ('mail_actions', 'gmail_units') and relnamespace = 'public'::regnamespace order by relname");
    assertEquals(rls.map((r) => [r.relname, r.relrowsecurity]), [["gmail_units", true], ["mail_actions", true]]);
    assertEquals((await c.q("select 1 from pg_policies where schemaname = 'public' and tablename in ('mail_actions', 'gmail_units')")).length, 0);
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
  { name: "replace token: active connection only — vault, scopes, expires_at change, cursor untouched; another user or a reauth_required connection → false and nothing changes", run: async (c) => {
    const conn = (await one(c.q, "select gmail_save_connection($1::uuid, $2, 'rt-old', '700') as id", [c.user, `${c.tag}-rt@example.com`])).id as string;
    await c.q("update connections set expires_at = now() + interval '1 day' where id = $1::uuid", [conn]);
    assertEquals(await call(c, "gmail_replace_token", "$1::uuid, $2::uuid, 'rt-x', $3::text[]", [crypto.randomUUID(), conn, arr(["s"])]), false);
    assertEquals(await call(c, "gmail_replace_token", "$1::uuid, $2::uuid, 'rt-new', $3::text[]", [c.user, conn, arr(["a", "b"])]), true);
    assertEquals(await call(c, "gmail_get_refresh_token", "$1::uuid, $2::uuid", [c.user, conn]), "rt-new");
    const k = await one(c.q, "select status, scopes, expires_at > now() + interval '6 days' as week from connections where id = $1::uuid", [conn]);
    assertEquals([k.status, k.scopes, k.week], ["active", ["a", "b"], true]);
    assertEquals((await one(c.q, "select cursor from sync_states where connection_id = $1::uuid", [conn])).cursor, "700");
    await c.q("update connections set status = 'reauth_required' where id = $1::uuid", [conn]);
    assertEquals(await call(c, "gmail_replace_token", "$1::uuid, $2::uuid, 'rt-z', $3::text[]", [c.user, conn, arr(["z"])]), false);
    const z = await one(c.q, "select c.status, c.scopes, s.secret from connections c join vault.secrets s on s.name = 'gmail_rt:' || c.id where c.id = $1::uuid", [conn]);
    assertEquals([z.status, z.scopes, z.secret], ["reauth_required", ["a", "b"], "rt-new"]);   // 끊긴 연결은 되살리지 않는다(D12)
  } },
  { name: "mail_connection returns the newest Gmail connection with account and scopes; gmail_set_scopes writes them", run: async (c) => {
    await c.q("select gmail_set_scopes($1::uuid, $2::uuid, $3::text[])", [c.user, c.conn, arr(["r", "m"])]);
    const rows = await c.q("select * from mail_connection($1::uuid)", [c.user]);
    assertEquals(rows.length, 1);
    assertEquals([rows[0].connection_id, rows[0].status, rows[0].scopes], [c.conn, "active", ["r", "m"]]);
    assert(String(rows[0].account_ref).startsWith(c.tag));
    assertEquals((await c.q("select * from mail_connection($1::uuid)", [crypto.randomUUID()])).length, 0);
  } },
  { name: "purge: 7-day rows except in-flight with a live job; in-flight 8+ days with no live job closes as job_lost then goes; 1-hour unit rows; cron at 53 4", run: async (c) => {
    const old = await preview(c), running = await preview(c), lost = await preview(c), fresh = await preview(c);
    await start(c, running); await start(c, lost);                                           // 둘 다 pending + 잡
    await c.q("delete from jobs where user_id = $1::uuid and payload->>'id' = $2", [c.user, lost]);   // 잡이 사라진 진행 중 행
    await c.q("update mail_actions set created_at = now() - interval '9 days' where id = any($1::uuid[])", [`{${old},${running},${lost}}`]);
    await c.q("insert into gmail_units (user_id, minute, used) values ($1::uuid, date_trunc('minute', now()) - interval '2 hours', 5), ($1::uuid, date_trunc('minute', now()) - interval '10 minutes', 5)", [c.user]);
    const p = await call(c, "purge_mail_actions", "$1::uuid", [c.user]);
    assertEquals(p, { mail_actions: 2, gmail_units: 1, lost: 1 });
    const left = (await c.q("select id from mail_actions where user_id = $1::uuid", [c.user])).map((r) => r.id).sort();
    assertEquals(left, [running, fresh].sort());
    assertEquals((await audits(c, lost)).map((x) => x.target), [`mail_action:${lost} ok=0 failed=3`]);   // 마감 감사는 남는다
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

// 호스팅 DB(계획 M3·M10). unsub-gap-db 와 같은 방식이지만 **트랜잭션 하나**: 0030 이 아직 없으면 그 안에서 한 번만 적용하고,
// 사례마다 savepoint 로 되감은 뒤 끝에서 전체를 **롤백**한다(Fable N-M8 — 사례마다 적용·롤백하면 운영 connections(ACCESS EXCLUSIVE)·jobs(SHARE ROW EXCLUSIVE)
// 잠금을 사례 수만큼 잡는다). lock_timeout 3초 — 운영 잠금 뒤에서 오래 기다리지 않는다. 그동안(수 초) 운영 수집·워커 클레임이 이 트랜잭션을 기다린다(M10 에 명시).
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

Deno.test("hosted: 0030 cases in one rolled-back transaction", async (t) => {
  const user = (await testUser(21)).id;
  const sql = connect();
  try {
    await sql.begin(async (tx) => {
      await tx.unsafe("set local lock_timeout = '3s'");
      const [{ deployed }] = await tx.unsafe("select to_regprocedure('public.mail_action_start(uuid, uuid, text)') is not null as deployed");
      if (!deployed) await tx.unsafe(MIGRATION);
      const q: Q = async (s, p = []) => await tx.unsafe(s, p as never[]) as unknown as Record<string, unknown>[];
      for (const c of CASES) {
        await tx.unsafe("savepoint mail_case");
        try {
          await t.step(c.name, async () => { await c.run(await setupCtx(q, user, `${RUN}:m${crypto.randomUUID().slice(0, 4)}`)); });
        } finally {
          await tx.unsafe("rollback to savepoint mail_case");            // 실패한 사례(트랜잭션 오류 상태 포함)도 다음 사례 전에 되감는다
        }
      }
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  } finally {
    await sql.end();
  }
});
```

- [ ] **Step 5: PGlite 사례 실행(실패 → 고침)**

먼저 마이그레이션 없이 돌려 사례가 실제로 0030을 요구하는지 본다:

Run: `mv supabase/migrations-pending/0030_mail_cleanup.sql /tmp/0030.sql && deno test --allow-read --allow-env --allow-write=/tmp supabase/tests/mail-sql.test.ts; mv /tmp/0030.sql supabase/migrations-pending/0030_mail_cleanup.sql`
Expected: FAIL(`NotFound … 0030_mail_cleanup.sql`) — 파일이 없으면 시작조차 못 한다.

Run: `deno test --allow-read --allow-env --allow-write=/tmp supabase/tests/mail-sql.test.ts`
Expected: `pglite:` 사례 19개 통과. 실패하면 SQL을 고친다(사례 기대를 SQL에 맞춰 바꾸지 않는다 — 기대는 스펙 문장이다). PGlite에만 있는 차이(예: `create role` 중복, `pg_policies`·`has_function_privilege` 동작)는 스텁에서 고친다 — 권한 사례가 PGlite에서만 다르면 그 사례를 PGlite 쪽에서만 건너뛰고(`c.name.startsWith("privileges")`) 호스팅(M10)에서 판정한다, 보고에 적는다.

- [ ] **Step 6: 타입 확인·호스팅 파일이 지금 돌지 않는지**

Run: `deno check supabase/tests/mail-sql.test.ts supabase/tests/mail-actions-db.test.ts supabase/tests/_mail-sql.ts && git status --short supabase/migrations`
Expected: 무오류. `supabase/migrations/`에 변화 없음(0030은 `migrations-pending/`에만). **`mail-actions-db.test.ts`는 실행하지 않는다**(M10).

- [ ] **Step 7: 커밋**

```bash
git add supabase/migrations-pending/0030_mail_cleanup.sql supabase/tests/_mail-sql.ts supabase/tests/_pglite-stubs.ts supabase/tests/mail-sql.test.ts supabase/tests/mail-actions-db.test.ts
git commit -m "feat(db): 0030 mail cleanup (pending, not applied — db push after ③c2 and U6b's 0029) — mail_actions as the confirmation token with per-id results and compare-and-set progress, start/undo/status/begin/finish with idempotent replays, dead-job trigger closes the row, gmail_units minute counter (collection notes, mail takes within 5,400/4,000), connections.scopes, gmail_replace_token keeps the connection and cursor, mail-action priority 20, 7-day purge cron; finish writes no code when nothing is left and gives the undo back when a dead connection stopped it before any progress, 8-day lost in-flight rows close as job_lost, replace token touches active connections only; SQL cases (incl. privileges and RLS) run on local PGlite now and on the hosted DB in one rolled-back transaction with lock_timeout at deploy time

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task M4a: 수집 계측 — units 기록·`gmailAccessToken` 공개 (`_shared/gmail-jobs.ts`)

**Files:**
- Modify: `supabase/functions/_shared/gmail-jobs.ts:13-29`(deps), `:92-103`(토큰 함수 공개), `:105-121`(sync), `:123-176`(fetch), `:205-230`(unsub-fetch), 새 함수
- Test: `supabase/tests/units.test.ts`

**Interfaces:**
- Consumes: 기존 `GmailJobDeps`·`RpcClient`·`ReauthRequired`, M3 RPC 이름 `gmail_note_units`.
- Produces: `gmailAccessToken(sb, refresh, user, conn)`·`noteGmailUnits(sb, user, units, budgetMs?)`(M4b·M5가 쓴다), `meteredApi`·`unitsNoter`·`GmailJobDeps.noteUnits?`. 이 태스크는 **수집 경로만** 바꾼다 — M10 Step 4가 U6b 배포본(`$U6B`)과의 diff를 이 커밋과 M4b로 나눠 본다.

- [ ] **Step 1: 실패하는 테스트 — 수집 경로 units**

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

- [ ] **Step 2: 실패 확인**

Run: `deno test --allow-read supabase/tests/units.test.ts`
Expected: FAIL — `noteGmailUnits` export 없음.

- [ ] **Step 3: `gmail-jobs.ts`**

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

- [ ] **Step 4: 통과·회귀 확인**

Run: `deno test --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/tests/units.test.ts supabase/tests/unsub-jobs.test.ts supabase/tests/gmail.test.ts --filter "$LOCAL_FILTER" && deno check supabase/functions/worker/index.ts supabase/functions/_shared/gmail-jobs.ts`
Expected: `units` 6 통과, 기존 `unsub-jobs`·`gmail`(가짜 사례) 그대로 통과(기존 테스트는 `noteUnits`가 없는 가짜라 RPC 순서가 같다), check 무오류.

- [ ] **Step 5: 커밋**

```bash
git add supabase/functions/_shared/gmail-jobs.ts supabase/tests/units.test.ts
git commit -m "feat(worker): collection paths note Gmail units for the per-user minute counter — gmail-fetch and gmail-unsub-fetch once per 10 messages, gmail-sync per history/list/profile call; fail-open (1 s budget, first failure skips the rest of that job, one log line) so the counter never slows or fails collection, even before 0030 exists; gmailAccessToken and noteGmailUnits exported for mail cleanup

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task M4b: 실행 복구 — 워커 `mail-action` 잡

**Files:**
- Create: `supabase/functions/worker/mail-action.ts`, `supabase/functions/worker/mail-action-deps.ts`
- Modify: `supabase/functions/worker/index.ts:1-21`(import), `:52`(핸들러 한 줄)
- Test: `supabase/tests/mail-jobs.test.ts`

**Interfaces:**
- Consumes: M2 `GmailMailApi`·`classifyGmailError`·`GmailHttpError`·`gmailMailApi`·`refreshAccessToken(rt, timeoutMs)`·`MAIL_CALL_TIMEOUT_MS`, M3 RPC 이름(`mail_action_begin`·`mail_action_set_method`·`mail_action_progress`·`mail_action_quota`·`mail_action_finish`·`gmail_take_units`·`mail_connection`), M4a `gmailAccessToken`, `Deferred`(`_shared/budget.ts`), `Job`.
- Produces: `mailActionJob(d, job)`·`MailJobDeps`·`opFor`·상수(`MAIL_JOB_BUDGET_MS` 25초·`RETRY_DEFER_MS` 등, M10 배포).

- [ ] **Step 1: 실패하는 테스트**

`supabase/tests/mail-jobs.test.ts`:

```ts
import { assert, assertEquals, assertRejects } from "jsr:@std/assert";
import { Deferred } from "../functions/_shared/budget.ts";
import { GmailHttpError, type GmailMailApi } from "../functions/_shared/gmail.ts";
import type { Job } from "../functions/_shared/job.ts";
import { type Action, MAIL_JOB_BUDGET_MS, mailActionJob, type MailJobDeps, type Method, type Phase, QUOTA_STUCK_MS, RETRY_DEFER_MS } from "../functions/worker/mail-action.ts";

// 메일 정리 잡(스펙 §7 실행·되돌리기): 행·DB 는 메모리 흉내(progress 는 커서 비교 — 0030 과 같은 규칙), Gmail 은 가짜.
// 시계는 Gmail 호출마다(성공·실패 모두) step ms 씩 간다 — 예산 검사가 호출 직전마다 있는지 본다(Codex C1)
const USER = "00000000-0000-0000-0000-0000000000aa", T0 = 1_790_000_000_000;
const ids = (n: number) => Array.from({ length: n }, (_, i) => `m${i + 1}`);
const job = (phase: Phase = "execute", attempts = 1): Job =>
  ({ id: "job-1", kind: "mail-action", user_id: USER, payload: { id: "row-1", phase, connection_id: "conn-1" }, attempts, checkpoint: null });
const E = (s: number, ...r: string[]) => new GmailHttpError("x", s, r);
const iso = (ms: number) => new Date(ms).toISOString();

type Opts = { action?: Action; phase?: Phase; ids?: string[]; method?: Method | null; status?: string; api?: Partial<GmailMailApi>;
  token?: string | { code: "reauth_required" | "no_connection" }; take?: (units: number) => boolean; step?: number; failProgressOnce?: boolean; quotaSince?: string };
function harness(o: Opts = {}) {
  const phase = o.phase ?? "execute", list = o.ids ?? ids(3);
  const st = { status: o.status ?? (phase === "execute" ? "running" : "undoing"), cursor: 0, ok: [] as string[], failed: [] as string[],
    method: (o.method ?? null) as Method | null, finished: undefined as string | null | undefined, quotaSince: (o.quotaSince ?? null) as string | null,
    taken: [] as number[], gmail: [] as string[], logs: [] as Record<string, unknown>[] };
  let failOnce = o.failProgressOnce ?? false, t = T0;
  const now = () => t;
  const raw: GmailMailApi = {
    list: () => Promise.resolve({}), headers: (id) => Promise.resolve({ id, internalDate: "0" }),
    labels: (id) => { st.gmail.push("labels:" + id); return Promise.resolve({ id, labelIds: [] }); },
    batchModify: (b, a, r) => { st.gmail.push(`batch:${b.length}:+${a.join()}:-${r.join()}`); return Promise.resolve(); },
    trash: (id) => { st.gmail.push("trash:" + id); return Promise.resolve(); },
    untrash: (id) => { st.gmail.push("untrash:" + id); return Promise.resolve(); },
    modify: (id, a, r) => { st.gmail.push(`modify:${id}:+${a.join()}:-${r.join()}`); return Promise.resolve(); },
    ...o.api,
  };
  const api = Object.fromEntries(Object.entries(raw).map(([k, f]) =>
    [k, (...a: unknown[]) => { t += o.step ?? 0; return (f as (...x: unknown[]) => Promise<unknown>)(...a); }])) as unknown as GmailMailApi;
  const d: MailJobDeps = {
    begin: () => Promise.resolve(st.status === "gone" ? null : (st.status === "running" || st.status === "undoing")
      ? { status: st.status, action: o.action ?? "trash", method: st.method, connection_id: "conn-1", ids: list, cursor: st.cursor } : { status: st.status }),
    token: () => Promise.resolve(o.token ?? "access-1"),
    api: () => api,
    take: (_user, units) => { st.taken.push(units); return Promise.resolve((o.take ?? (() => true))(units)); },
    setMethod: (_u, _i, m) => { if (st.method === null || (st.method === "batch" && m === "single")) st.method = m; return Promise.resolve(); },
    progress: (_u, _i, _p, from, to, ok, failed) => {
      if (failOnce) { failOnce = false; return Promise.reject(new Error("connection reset")); }   // Gmail 성공 뒤·기록 전 죽음
      if (from !== st.cursor || ok.length + failed.length !== to - from) return Promise.resolve(false);
      st.cursor = to; st.ok.push(...ok); st.failed.push(...failed); st.quotaSince = null;
      return Promise.resolve(true);
    },
    quota: () => Promise.resolve(st.quotaSince ??= iso(now())),
    finish: (_u, _i, _p, code) => { st.failed.push(...list.slice(st.cursor)); st.cursor = list.length; st.finished = code; return Promise.resolve(); },
    now, log: (x) => { st.logs.push(x); },
  };
  return { d, st };
}

Deno.test("execute trash: one batchModify(+TRASH) for all ids, 50 units, method batch, clean finish, elapsed in the done log", async () => {
  const { d, st } = harness();
  assertEquals(await mailActionJob(d, job()), "done");
  assertEquals([st.gmail, st.taken, st.method, st.ok, st.failed, st.finished], [["batch:3:+TRASH:-"], [50], "batch", ids(3), [], null]);
  assertEquals([st.logs.at(-1)?.mail_action, typeof st.logs.at(-1)?.elapsed_ms], ["done", "number"]);
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
    assertEquals([err.message, err.until, st.gmail, st.method, st.cursor], ["mail_quota", iso(T0 + 60_000), [], "batch", 0]);
  }
  const { d } = harness({ quotaSince: iso(T0 - QUOTA_STUCK_MS - 1), api: { batchModify: () => Promise.reject(E(429)) } });
  const e2 = await assertRejects(() => mailActionJob(d, job()));
  assert(!(e2 instanceof Deferred));
  assertEquals((e2 as Error).message, "mail_quota_stuck");
});

Deno.test("403 insufficientPermissions → close as scope_missing (rest failed), no retry, no fallback", async () => {
  const { d, st } = harness({ api: { batchModify: () => Promise.reject(E(403, "insufficientPermissions")) } });
  assertEquals(await mailActionJob(d, job()), "scope_missing");
  assertEquals([st.finished, st.failed, st.ok, st.method], ["scope_missing", ids(3), [], "batch"]);
});

Deno.test("token problems close the row with the connection code and never call Gmail (the SQL gives an untouched undo back, M3)", async () => {
  for (const phase of ["execute", "undo"] as const) {
    for (const code of ["reauth_required", "no_connection"] as const) {
      const { d, st } = harness({ phase, token: { code } });
      assertEquals(await mailActionJob(d, job(phase)), code);
      assertEquals([st.finished, st.gmail, st.taken], [code, [], []]);
    }
  }
});

Deno.test("single mode: a 404 or 400 on one message fails only that id", async () => {
  const { d, st } = harness({ method: "single", api: { trash: (id) => id === "m2" ? Promise.reject(E(404)) : id === "m3" ? Promise.reject(E(400)) : Promise.resolve() } });
  assertEquals(await mailActionJob(d, job()), "done");
  assertEquals([st.ok, st.failed, st.taken], [["m1"], ["m2", "m3"], [60]]);
});

Deno.test("unknown result (5xx, other 403, timeout) with no progress in this run, before the last attempt → plain error, nothing recorded, same batch next time", async () => {
  for (const e of [E(500), E(403, "forbidden"), new DOMException("t", "TimeoutError")]) {
    const { d, st } = harness({ api: { batchModify: () => Promise.reject(e) } });
    const err = await assertRejects(() => mailActionJob(d, job()));
    assert(!(err instanceof Deferred));
    assertEquals([st.cursor, st.ok, st.finished], [0, [], undefined]);
  }
});

Deno.test("unknown result after progress in the same run → defer one minute (attempts kept), even on the last attempt", async () => {
  for (const attempts of [1, 5]) {
    const { d, st } = harness({ method: "single", api: { trash: (id) => id === "m2" ? Promise.reject(E(500)) : Promise.resolve() } });
    const e = await assertRejects(() => mailActionJob(d, job("execute", attempts)), Deferred);
    assertEquals([e.message, e.until, st.cursor, st.ok, st.finished], ["mail_retry", iso(T0 + RETRY_DEFER_MS), 1, ["m1"], undefined]);
  }
});

Deno.test("last attempt with an unknown result and no progress → reread labels (20 units each): target state ok, others failed, then close", async () => {
  const { d, st } = harness({ api: { batchModify: () => Promise.reject(E(503)),
    labels: (id) => id === "m2" ? Promise.resolve({ id, labelIds: ["INBOX"] }) : id === "m3" ? Promise.reject(E(404)) : Promise.resolve({ id, labelIds: ["TRASH"] }) } });
  assertEquals(await mailActionJob(d, job("execute", 5)), "verified");
  assertEquals([st.ok, st.failed, st.finished, st.taken], [["m1"], ["m2", "m3"], null, [50, 60]]);
});

Deno.test("reread hits quota → records what it read and defers (quota rule), never marks the rest failed", async () => {
  const { d, st } = harness({ api: { batchModify: () => Promise.reject(E(503)),
    labels: (id) => id === "m2" ? Promise.reject(E(429)) : Promise.resolve({ id, labelIds: ["TRASH"] }) } });
  const e = await assertRejects(() => mailActionJob(d, job("execute", 5)), Deferred);
  assertEquals([e.message, e.until, st.cursor, st.ok, st.failed, st.finished], ["mail_quota", iso(T0 + 60_000), 1, ["m1"], [], undefined]);
});

Deno.test("worker dies after Gmail success but before progress → next run resends the same batch and the result has no duplicates", async () => {
  const h = harness({ failProgressOnce: true });
  await assertRejects(() => mailActionJob(h.d, job()));
  assertEquals(h.st.cursor, 0);
  assertEquals(await mailActionJob(h.d, job("execute", 2)), "done");
  assertEquals([h.st.gmail, h.st.ok, h.st.failed], [["batch:3:+TRASH:-", "batch:3:+TRASH:-"], ids(3), []]);
});

Deno.test("worker dies in the middle of a single chunk (7 trashed, nothing recorded) → rerun resends from the cursor without duplicates", async () => {
  const sent: string[] = [];
  let boom = 1;
  const h = harness({ method: "single", ids: ids(20), failProgressOnce: true,
    api: { trash: (id) => { sent.push(id); return id === "m8" && boom-- > 0 ? Promise.reject(E(500)) : Promise.resolve(); } } });
  await assertRejects(() => mailActionJob(h.d, job()));                         // 7통 뒤 결과 불명 → 기록 시도에서 죽음
  assertEquals(h.st.cursor, 0);
  assertEquals(await mailActionJob(h.d, job("execute", 2)), "done");
  assertEquals([h.st.ok, h.st.failed, sent.filter((x) => x === "m1").length, sent.length], [ids(20), [], 2, 28]);
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
  assertEquals([e.message, e.until, st.gmail], ["mail_units", iso(Math.floor(T0 / 60_000) * 60_000 + 60_000), []]);
});

Deno.test("budget is checked before every single call: 10 s per call → 3 calls, those 3 recorded, then defer to now", async () => {
  const { d, st } = harness({ method: "single", ids: ids(45), step: 10_000 });
  const e = await assertRejects(() => mailActionJob(d, job()), Deferred);
  assertEquals([e.message, e.until, st.cursor, st.ok, st.gmail.length], ["mail_budget", iso(T0 + 30_000), 3, ["m1", "m2", "m3"], 3]);
  assert(30_000 >= MAIL_JOB_BUDGET_MS);
});

Deno.test("budget is checked before every reread call: records what it read, defers, does not close", async () => {
  const { d, st } = harness({ step: 10_000, api: { batchModify: () => Promise.reject(E(503)), labels: (id) => Promise.resolve({ id, labelIds: ["TRASH"] }) } });
  const e = await assertRejects(() => mailActionJob(d, job("execute", 5)), Deferred);
  assertEquals([e.message, st.cursor, st.ok, st.finished, st.taken], ["mail_budget", 2, ["m1", "m2"], undefined, [50, 60]]);
});

Deno.test("scattered transient errors over 100 single ids never use attempts (each follows progress) and never close the row early", async () => {
  const flaky = new Set(["m10", "m30", "m50", "m70", "m90"]);
  const { d, st } = harness({ method: "single", ids: ids(100),
    api: { trash: (id) => flaky.delete(id) ? Promise.reject(E(500)) : Promise.resolve() } });
  let attempts = 1, plain = 0, deferred = 0, r = "";
  for (let i = 0; i < 20 && !r; i++) {
    try { r = await mailActionJob(d, job("execute", attempts)); }
    catch (e) { if (e instanceof Deferred) deferred++; else { plain++; attempts++; } }   // defer_job −1·클레임 +1 = 그대로, fail_job = +1
  }
  assertEquals([r, plain, deferred, st.ok.length, st.failed.length, st.finished], ["done", 0, 5, 100, 0, null]);
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

Deno.test("undo trash follows the execute method: single → untrash each (5 units), batch → remove TRASH once; trash batch 404 → per-message (D9)", async () => {
  const s = harness({ phase: "undo", method: "single" });
  assertEquals(await mailActionJob(s.d, job("undo")), "done");
  assertEquals([s.st.gmail, s.st.taken], [["untrash:m1", "untrash:m2", "untrash:m3"], [15]]);
  const b = harness({ phase: "undo", method: "batch" });
  assertEquals(await mailActionJob(b.d, job("undo")), "done");
  assertEquals(b.st.gmail, ["batch:3:+:-TRASH"]);
  const g = harness({ api: { batchModify: () => Promise.reject(E(404)) } });
  assertEquals(await mailActionJob(g.d, job()), "done");                        // 휴지통 batch 404 = 사라진 id 섞임 → 건별(그 id 만 실패)
  assertEquals([g.st.gmail, g.st.method, g.st.taken], [["trash:m1", "trash:m2", "trash:m3"], "single", [50, 60]]);
  const u = harness({ phase: "undo", method: "batch", api: { batchModify: () => Promise.reject(E(404)), untrash: (id) => id === "m2" ? Promise.reject(E(404)) : Promise.resolve() } });
  assertEquals(await mailActionJob(u.d, job("undo")), "done");
  assertEquals([u.st.ok, u.st.failed, u.st.method], [["m1", "m3"], ["m2"], "batch"]);   // 되돌리기 전환은 method 에 남기지 않는다
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

(`u` 사례: 되돌리기에서 휴지통 batch가 404면 건별 `untrash`로 넘어가고 한 id의 404는 그 id만 되돌리기 실패다. `harness`의 `ok`·`failed`는 단계와 무관하게 progress 인자를 담는다.)

- [ ] **Step 2: 실패 확인**

Run: `deno test --allow-read supabase/tests/mail-jobs.test.ts`
Expected: FAIL — `worker/mail-action.ts` 없음.

- [ ] **Step 3: 잡 모듈**

`supabase/functions/worker/mail-action.ts`:

```ts
import { Deferred } from "../_shared/budget.ts";
import { classifyGmailError, GmailHttpError, type GmailMailApi } from "../_shared/gmail.ts";
import type { Job } from "../_shared/job.ts";

// 메일 정리 실행·되돌리기 잡(스펙 §7 "실행 — 지속 잡"). lease 'mail:<user>' 라 사용자당 한 번에 하나.
// 묶음마다 units 가져가기 → Gmail → mail_action_progress(커서 비교, 계획 D8). 결과 불명은 같은 묶음을 다시 보낸다(라벨·trash·untrash 는 멱등).
// 원칙(Review Focus 7): Gmail 이 바뀌었을 수 있는 id 를 시도·확인 없이 실패로 적지 않는다 — 예산·쿼터·진행 뒤 결과 불명은 처리한 만큼 적고 미룬다.
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

export const MAIL_JOB_BUDGET_MS = 25_000;          // 잡 1회(계획 D7): Gmail 호출 직전마다 본다. 배치 끝(100초)에 클레임돼도 100 + 25 + 호출 15 = 140 < Edge 150초
export const BATCH_MAX = 1000, SINGLE_CHUNK = 20, MAX_ATTEMPTS = 5;
export const QUOTA_DEFER_MS = 60_000, QUOTA_STUCK_MS = 30 * 60_000, RETRY_DEFER_MS = 60_000;
export const UNITS = { batch: 50, trash: 20, untrash: 5, modify: 5, labels: 20 } as const;   // 공식 쿼터 표(§3)

type Op = {
  batch(api: GmailMailApi, ids: string[]): Promise<void>;
  single(api: GmailMailApi, id: string): Promise<void>;
  singleUnits: number;
  reached(labels: string[]): boolean;              // 마지막 시도 재조회의 목표 상태
};
// batch 가 400(일괄 거절)·404(사라진 id 섞임)면 휴지통·읽음 모두 건별로 넘어간다(D9 — 2026-10-06 메인 판정)
export function opFor(action: Action, phase: Phase): Op {
  if (action === "trash" && phase === "execute") {
    return { batch: (a, ids) => a.batchModify(ids, ["TRASH"], []), single: (a, id) => a.trash(id),
             singleUnits: UNITS.trash, reached: (l) => l.includes("TRASH") };
  }
  if (action === "trash") {
    return { batch: (a, ids) => a.batchModify(ids, [], ["TRASH"]), single: (a, id) => a.untrash(id),
             singleUnits: UNITS.untrash, reached: (l) => !l.includes("TRASH") };
  }
  if (phase === "execute") {
    return { batch: (a, ids) => a.batchModify(ids, [], ["UNREAD"]), single: (a, id) => a.modify(id, [], ["UNREAD"]),
             singleUnits: UNITS.modify, reached: (l) => !l.includes("UNREAD") };
  }
  return { batch: (a, ids) => a.batchModify(ids, ["UNREAD"], []), single: (a, id) => a.modify(id, ["UNREAD"], []),
           singleUnits: UNITS.modify, reached: (l) => l.includes("UNREAD") };
}

const BUDGET = "budget";                           // Interrupted 이유: 예산 끝(다음 호출 전에 멈춤)
class Interrupted extends Error {
  constructor(readonly ok: string[], readonly failed: string[], readonly reason: unknown) { super("interrupted"); }
}
// 건별: 호출 직전마다 예산을 본다(D7). 한 id 의 400·404 는 그 id 만 실패. 예산 끝·그 밖의 오류는 그때까지의 결과를 들고 멈춘다
async function singles(api: GmailMailApi, o: Op, ids: string[], over: () => boolean) {
  const ok: string[] = [], failed: string[] = [];
  for (const id of ids) {
    if (over()) throw new Interrupted(ok, failed, BUDGET);
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
// 쿼터(D7): 행 quota_since 로 30분 판정 — 넘으면 평범한 오류(fail_job, attempts 사용), 아니면 1분 뒤 같은 묶음(attempts 되돌림)
async function quotaDefer(d: MailJobDeps, user: string, id: string): Promise<never> {
  const since = Date.parse((await d.quota(user, id)) ?? iso(d.now()));
  if (d.now() - since > QUOTA_STUCK_MS) throw new Error("mail_quota_stuck");
  throw new Deferred(iso(d.now() + QUOTA_DEFER_MS), "mail_quota");
}

export async function mailActionJob(d: MailJobDeps, job: Job): Promise<string> {
  const t0 = d.now();                                                  // 예산은 잡 시작부터(토큰 갱신 포함, D7)
  const over = () => d.now() - t0 >= MAIL_JOB_BUDGET_MS;
  const user = job.user_id;
  if (!user) throw new Error("mail-action without user_id");
  const id = String(job.payload.id ?? ""), phase: Phase = job.payload.phase === "undo" ? "undo" : "execute";
  const row = await d.begin(user, id, phase);
  if (!row) { d.log({ mail_action: "gone", phase }); return "gone"; }                    // 정리·출처 삭제로 행이 없음
  if (row.status !== (phase === "execute" ? "running" : "undoing")) { d.log({ mail_action: "noop", phase, status: row.status }); return "noop"; }
  const t = await d.token(user, row.connection_id!);                  // deps 가 갱신을 15초에서 끊는다
  if (typeof t !== "string") {
    await d.finish(user, id, phase, t.code);                           // 되돌리기에서 진행 0 이면 SQL 이 되돌리기를 되살린다(D11)
    d.log({ mail_action: "closed", phase, code: t.code });
    return t.code;
  }
  const api = d.api(t), o = opFor(row.action!, phase), ids = row.ids ?? [];
  let cursor = row.cursor ?? 0;
  const start = cursor, last = job.attempts >= MAX_ATTEMPTS;          // start: 이번 실행이 진행했는지(진행 뒤 결과 불명은 미룸, D7)
  // 되돌리기는 실행 방식을 따른다: 휴지통 single 이면 처음부터 untrash, 읽음은 늘 batch 먼저(D9)
  let method: Method = phase === "undo" && row.action === "read" ? "batch" : (row.method ?? "batch");
  if (phase === "execute" && !row.method) await d.setMethod(user, id, "batch");
  while (cursor < ids.length) {
    if (over()) throw new Deferred(iso(d.now()), "mail_budget");      // 커서는 남아 있다 — 곧 다시
    const chunk = ids.slice(cursor, cursor + (method === "batch" ? BATCH_MAX : SINGLE_CHUNK)), end = cursor + chunk.length;
    if (!await d.take(user, method === "batch" ? UNITS.batch : chunk.length * o.singleUnits)) throw new Deferred(nextMinute(d.now()), "mail_units");
    let ok: string[], failed: string[] = [];
    try {
      if (method === "batch") { await o.batch(api, chunk); ok = chunk; }   // 2xx = 그 호출의 id 전부 성공(Gmail 이 id별 결과를 주지 않는다)
      else ({ ok, failed } = await singles(api, o, chunk, over));
    } catch (e) {
      let err = e;
      if (e instanceof Interrupted) {
        err = e.reason;
        const n = e.ok.length + e.failed.length;
        if (n > 0) {
          if (!await d.progress(user, id, phase, cursor, cursor + n, e.ok, e.failed)) return stale(d, phase);
          cursor += n;
        }
        if (err === BUDGET) throw new Deferred(iso(d.now()), "mail_budget");   // 처리한 만큼 적었다 — 곧 다시(D7)
      }
      const kind = classifyGmailError(err);
      if (method === "batch" && (kind === "rejected" || kind === "gone")) {
        method = "single";                                            // 일괄 거절(400)·사라진 id 섞임(404) → 건별(D9)
        if (phase === "execute") await d.setMethod(user, id, "single");
        d.log({ mail_action: "fallback", phase, status: codeOf(err) });
        continue;
      }
      if (kind === "quota") return await quotaDefer(d, user, id);     // 폴백 없이 1분 뒤 같은 묶음
      if (kind === "scope") {
        await d.finish(user, id, phase, "scope_missing");
        d.log({ mail_action: "closed", phase, code: "scope_missing" });
        return "scope_missing";
      }
      // 결과 불명: 이번 실행에서 진행했으면 attempts 를 쓰지 않고 1분 뒤(흩어진 일시 오류가 마지막 시도로 몰지 않게, D7)
      if (cursor > start) throw new Deferred(iso(d.now() + RETRY_DEFER_MS), "mail_retry");
      if (!last) throw new Error("mail_unknown " + codeOf(err));       // 진행 없음: fail_job 백오프 뒤 같은 묶음(멱등)
      // 마지막 시도(D10): 남은 묶음을 다시 읽어 목표 상태면 성공, 아니면 실패로 적고 마감(커서 뒤는 finish 가 실패로)
      if (!await lookup(d, api, user, id, phase, o, ids.slice(cursor, end), cursor, over)) return stale(d, phase);
      await d.finish(user, id, phase, null);
      d.log({ mail_action: "verified", phase, method, elapsed_ms: d.now() - t0 });
      return "verified";
    }
    if (!await d.progress(user, id, phase, cursor, end, ok, failed)) return stale(d, phase);
    cursor = end;
  }
  await d.finish(user, id, phase, null);
  d.log({ mail_action: "done", phase, method, n: ids.length, elapsed_ms: d.now() - t0 });   // 1,000건 batch 응답 시간을 MAIL-real 에서 본다
  return "done";
}

// 마지막 시도 재조회(D10): 20개씩 units 를 가져가 라벨을 읽고 적는다. 호출 직전마다 예산을 보고(넘으면 읽은 앞부분을 적고 미룸),
// 쿼터면 읽은 앞부분만 적고 쿼터 미루기 — 휴지통에 간 메일을 쿼터 때문에 실패로 적지 않는다(Fable N-M2). 404·그 밖의 오류는 실패(스펙 수용 범위)
async function lookup(d: MailJobDeps, api: GmailMailApi, user: string, id: string, phase: Phase, o: Op, rest: string[], from: number,
                      over: () => boolean): Promise<boolean> {
  let cur = from;
  for (let i = 0; i < rest.length; i += SINGLE_CHUNK) {
    const sub = rest.slice(i, i + SINGLE_CHUNK);
    if (!await d.take(user, sub.length * UNITS.labels)) throw new Deferred(nextMinute(d.now()), "mail_units");   // 진행은 남아 있다
    const ok: string[] = [], failed: string[] = [];
    let stop: "budget" | "quota" | null = null;
    for (const m of sub) {
      if (over()) { stop = "budget"; break; }
      try { (o.reached((await api.labels(m)).labelIds ?? []) ? ok : failed).push(m); }
      catch (e) {
        if (classifyGmailError(e) === "quota") { stop = "quota"; break; }
        failed.push(m);                                               // 읽지 못하면 실패(되돌리기 대상에서 빠진다)
      }
    }
    const n = ok.length + failed.length;
    if (n > 0) {
      if (!await d.progress(user, id, phase, cur, cur + n, ok, failed)) return false;
      cur += n;
    }
    if (stop === "budget") throw new Deferred(iso(d.now()), "mail_budget");
    if (stop === "quota") return await quotaDefer(d, user, id);
  }
  return true;
}
```

`supabase/functions/worker/mail-action-deps.ts`:

```ts
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { gmailMailApi, MAIL_CALL_TIMEOUT_MS, refreshAccessToken } from "../_shared/gmail.ts";
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
      const t = await gmailAccessToken(sb, (rt) => refreshAccessToken(rt, MAIL_CALL_TIMEOUT_MS), u, conn);   // 갱신도 15초(D7)
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

- [ ] **Step 4: 통과·회귀 확인**

Run: `deno test --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/tests/mail-jobs.test.ts supabase/tests/units.test.ts supabase/tests/unsub-jobs.test.ts supabase/tests/gmail.test.ts supabase/tests/run.test.ts supabase/tests/batch.test.ts --filter "$LOCAL_FILTER" && deno check supabase/functions/worker/index.ts`
Expected: `mail-jobs` 22 통과, `units`·기존 `unsub-jobs`·`gmail`(가짜 사례)·`run`·`batch` 그대로 통과, check 무오류. `run.test.ts`·`batch.test.ts`가 호스팅 DB를 쓰면(`grep -n _testenv`) 빼고 돌린다. 자체 확인: `grep -n 'await o.single\|api.labels' supabase/functions/worker/mail-action.ts` — 두 호출 모두 바로 앞 줄에 `over()` 검사가 있다(건별·재조회 루프 안).

- [ ] **Step 5: 커밋**

```bash
git add supabase/functions/worker/mail-action.ts supabase/functions/worker/mail-action-deps.ts supabase/functions/worker/index.ts supabase/tests/mail-jobs.test.ts
git commit -m "feat(worker): mail-action job — per batch take units then call Gmail and record per-id results with compare-and-set progress; the 25 s budget is checked before every Gmail call (single and reread loops too) and what was done is recorded before deferring; batch 400/404 falls back to per-message calls for trash and read, quota reasons defer a minute (30 min → fail), insufficientPermissions closes as scope_missing, unknown results after progress in the same run defer without using attempts, otherwise retry the same batch and the last attempt rereads labels (quota there defers, never marks failed); undo follows the execute method; token refresh capped at 15 s

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task M5: Edge `mail-action` (preview·execute·undo·status)

**Files:**
- Create: `supabase/functions/mail-action/handler.ts`, `supabase/functions/mail-action/deps.ts`, `supabase/functions/mail-action/index.ts`
- Test: `supabase/tests/mail-action.test.ts`

**Interfaces:**
- Consumes: M1 `checkConditions`·`buildQuery`, M2 `GMAIL_MODIFY_SCOPE`·`GmailHttpError`·`classifyGmailError`·`GmailMailApi`·`gmailMailApi`·`refreshAccessToken(rt, timeoutMs)`·`MAIL_CALL_TIMEOUT_MS`·`header`, M3 RPC(`mail_connection`·`mail_action_preview`·`mail_action_start`·`mail_action_undo`·`mail_action_status`), M4a `gmailAccessToken`·`noteGmailUnits`, `parseFrom`(`_shared/unsub.ts`), `kickInBackground`(`_shared/kick-worker.ts`).
- Produces: HTTP 계약("이 계획이 만드는 인터페이스" — M9b 앱·M10 스모크가 쓴다), `handleMailAction(req, deps)`, `MailActionDeps`, `Counts`, `sampleOf(msg)`.

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

type FakeOpts = { user?: string | null; conn?: Partial<MailConnection> | null; enabled?: boolean; token?: string | null; tokenThrows?: boolean; pages?: Page[]; starred?: number;
  list?: (q: string, n: number, p?: string) => Promise<Page>; headers?: (id: string) => Promise<GmailMessage>; row?: string | null;
  start?: RowResult; undo?: RowResult; status?: Counts | null; step?: number };
function fake(o: FakeOpts = {}) {
  const calls = { list: [] as { q: string; n: number; p?: string }[], headers: [] as string[], notes: [] as number[],
    rows: [] as { action: string; ids: string[] }[], kicks: 0, starts: [] as string[], undos: [] as string[], tokens: 0 };
  const pages = o.pages ?? [{ messages: [{ id: "a" }, { id: "b" }, { id: "c" }], resultSizeEstimate: 3 }];
  let clock = 0;
  const d: MailActionDeps = {
    enabled: () => o.enabled ?? true,
    authUser: (t) => Promise.resolve(t === "user-jwt" ? (o.user === undefined ? USER : o.user) : null),
    connection: () => Promise.resolve(o.conn === null ? null : { connection_id: CONN, account_ref: "poc@example.com", status: "active", scopes: [RO, MOD], ...o.conn }),
    accessToken: () => { calls.tokens++; return o.tokenThrows ? Promise.reject(new Error("token refresh 503")) : Promise.resolve(o.token === undefined ? "at" : o.token); },
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
    now: () => (clock += o.step ?? 0),                                   // 부를 때마다 step ms(미리보기 예산)
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

Deno.test("execute and undo on a connection that is not active → 409 reauth_required before any row change (the one undo is not used up)", async () => {
  for (const [path, body] of [["execute", { token: TOKEN }], ["undo", { id: TOKEN }]] as const) {
    const f = fake({ conn: { status: "reauth_required" } });
    const r = await call(f.d, req(path, body));
    assertEquals([r.status, await r.json(), f.calls.starts.length, f.calls.undos.length], [409, { error: "reauth_required" }, 0, 0]);
  }
});

Deno.test("undo refreshes the token first: none → 409 reauth_required, transient refresh error → 502 gmail_upstream, neither starts the undo", async () => {
  const n = fake({ token: null });
  const r = await call(n.d, req("undo", { id: TOKEN }));
  assertEquals([r.status, await r.json(), n.calls.undos.length], [409, { error: "reauth_required" }, 0]);
  const x = fake({ tokenThrows: true });
  const r2 = await call(x.d, req("undo", { id: TOKEN }));
  assertEquals([r2.status, await r2.json(), x.calls.undos.length], [502, { error: "gmail_upstream" }, 0]);
  const ok = fake();
  assertEquals([(await call(ok.d, req("undo", { id: TOKEN }))).status, ok.calls.tokens, ok.calls.undos.length], [202, 1, 1]);
  const ex = fake();
  await call(ex.d, req("execute", { token: TOKEN }));
  assertEquals(ex.calls.tokens, 0);                                            // 실행은 토큰을 잡이 얻는다(실패해도 Gmail 은 그대로)
});

Deno.test("preview: transient token refresh error or a network TypeError → 502 gmail_upstream, no row; the whole preview stops at 25 s → 502, no row", async () => {
  const x = fake({ tokenThrows: true });
  const r = await call(x.d, req("preview", mail()));
  assertEquals([r.status, await r.json(), x.calls.rows.length], [502, { error: "gmail_upstream" }, 0]);
  const y = fake({ list: () => Promise.reject(new TypeError("error sending request")) });
  assertEquals([(await call(y.d, req("preview", mail()))).status, y.calls.rows.length], [502, 0]);
  const z = fake({ step: 10_000, pages: [0, 1, 2, 3, 4].map((i) => ({ messages: many(`p${i}-`, 100), nextPageToken: String(i + 1) })) });
  const r3 = await call(z.d, req("preview", mail()));
  assertEquals([r3.status, await r3.json(), z.calls.rows.length, z.calls.list.length < 5], [502, { error: "gmail_upstream" }, 0, true]);
});

Deno.test("contract: execute/undo with a non-JSON body → 400 bad_json; 401 and 405 have no body", async () => {
  const { d } = fake();
  const bad = new Request("http://x/functions/v1/mail-action/execute", { method: "POST", body: "{", headers: { authorization: "Bearer user-jwt" } });
  assertEquals([(await call(d, bad)).status], [400]);
  const u = await call(d, req("preview", mail(), { token: null }));
  assertEquals([u.status, await u.text()], [401, ""]);
  const m = await call(d, req("status?id=" + TOKEN, {}));
  assertEquals([m.status, await m.text()], [405, ""]);
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
  now(): number;                                                       // ms(미리보기 총 예산·로그 ms)
};
export const PREVIEW_MAX = 1000, PAGE_SIZE = 500, PAGE_CAP = 5, SAMPLE = 20, SAMPLE_PARALLEL = 5;
export const PREVIEW_BUDGET_MS = 25_000;                               // 미리보기 전체(목록 6 + 표본 4묶음 × 호출 15초가 겹쳐 Edge 벽시계에 걸리지 않게, D3)
class PreviewTimeout extends Error {}
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
  const t0 = d.now();
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
    const conn = await d.connection(user);                             // Gmail 연결은 사용자당 1개(최신, D3)
    if (!conn) return err(404, "no_connection");
    if (!(conn.scopes ?? []).includes(GMAIL_MODIFY_SCOPE)) { log({ stage: route, result: "scope_missing" }); return err(403, "scope_missing"); }
    // 끊긴 연결: 미리보기·실행·되돌리기 모두 행을 바꾸기 전에 409(되돌리기는 한 번뿐이라 소진되지 않게 — D3, Fable N-H1)
    if (conn.status !== "active") { log({ stage: route, result: "reauth_required" }); return err(409, "reauth_required"); }
    const b = body as Record<string, unknown>;
    if (route === "preview") return await preview(user, conn, b, d, t0);
    return await startRow(user, conn, route === "execute" ? b.token : b.id, d, route === "execute" ? "execute" : "undo");
  } catch (e) {
    if (e instanceof PreviewTimeout) { log({ stage: route, result: "preview_budget" }); return err(502, "gmail_upstream"); }
    // Gmail HTTP 오류·타임아웃·연결 오류(fetch TypeError)는 Gmail 쪽 문제로 본다
    if (e instanceof GmailHttpError || (e instanceof Error && (e.name === "TimeoutError" || e.name === "TypeError"))) {
      const k = classifyGmailError(e);
      const [status, code]: [number, string] = k === "quota" ? [429, "gmail_rate_limited"] : k === "scope" ? [403, "scope_missing"]
        : e instanceof GmailHttpError && e.status === 401 ? [409, "reauth_required"] : [502, "gmail_upstream"];
      log({ stage: route, result: code, google_status: e instanceof GmailHttpError ? e.status : e.name });
      return err(status, code);
    }
    log({ stage: route, result: "internal", error: e instanceof Error ? e.name : "unknown" });   // 메시지는 남기지 않는다
    return err(500, "internal");
  }
}

// 토큰: null = 토큰 없음·invalid_grant(연결은 reauth_required 로 표시됨) → 409, 던짐 = 갱신 일시 오류 → 502(D3)
async function accessFor(user: string, conn: MailConnection, d: MailActionDeps, stage: string): Promise<string | Response> {
  let at: string | null;
  try { at = await d.accessToken(user, conn.connection_id); }
  catch { log({ stage, result: "token_error" }); return err(502, "gmail_upstream"); }
  if (!at) { log({ stage, result: "reauth_required" }); return err(409, "reauth_required"); }
  return at;
}

async function preview(user: string, conn: MailConnection, body: Record<string, unknown>, d: MailActionDeps, t0: number): Promise<Response> {
  const chk = checkConditions(body);                                   // 앱이 보낸 칸도 믿지 않는다 — 검사·정제는 여기 한 곳
  if (!chk.ok) {
    log({ stage: "preview", result: chk.code });
    return chk.code === "needs_target" ? err(400, "needs_target") : err(400, "bad_condition", { fields: chk.fields });
  }
  const at = await accessFor(user, conn, d, "preview");
  if (at instanceof Response) return at;
  const over = () => { if (d.now() - t0 > PREVIEW_BUDGET_MS) throw new PreviewTimeout(); };   // Gmail 호출 직전마다
  const api = d.api(at), c = chk.c, q = buildQuery(c);
  const ids: string[] = [], seen = new Set<string>();
  let pageToken: string | undefined, pages = 0, estimate = 0, complete = false;
  do {
    over();
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
  over();
  await d.noteUnits(user, 5);
  const starred = (await api.list(buildQuery(c, true), 1)).resultSizeEstimate ?? 0;   // 별표 수도 추정치("별표 약 M건")
  const head = ids.slice(0, SAMPLE);
  if (head.length) await d.noteUnits(user, 20 * head.length);
  const sample = await samples(api, head, over);
  const base = { action: c.action, conditions: c, count: ids.length, exact: complete,
    total_estimate: complete ? ids.length : Math.max(estimate, ids.length), starred_estimate: starred, has_more: !complete, sample };
  const ms = Math.round(d.now() - t0);
  if (ids.length === 0) { log({ stage: "preview", result: "empty", pages, ms }); return Response.json({ token: null, ...base }); }
  const id = await d.createRow(user, conn.connection_id, c.action, ids);
  if (!id) return err(404, "no_connection");                           // 연결이 그사이 지워졌다
  log({ stage: "preview", result: "ok", count: ids.length, exact: complete, pages, ms });
  return Response.json({ token: id, ...base });
}

async function samples(api: Pick<GmailMailApi, "headers">, ids: string[], over: () => void): Promise<Sample[]> {
  const out: (Sample | null)[] = ids.map(() => null);
  for (let i = 0; i < ids.length; i += SAMPLE_PARALLEL) {
    over();
    await Promise.all(ids.slice(i, i + SAMPLE_PARALLEL).map(async (id, k) => {
      try { out[i + k] = sampleOf(await api.headers(id)); }
      catch (e) { if (!(e instanceof GmailHttpError && e.status === 404)) throw e; }   // 그사이 지워진 표본만 뺀다
    }));
  }
  return out.filter((x): x is Sample => x !== null);
}

async function startRow(user: string, conn: MailConnection, raw: unknown, d: MailActionDeps, stage: "execute" | "undo"): Promise<Response> {
  const id = typeof raw === "string" && UUID.test(raw) ? raw : null;   // 저장된 id 만 실행한다 — 요청의 다른 칸(ids·검색어)은 읽지 않는다
  if (!id) return err(400, stage === "execute" ? "bad_token" : "bad_id");
  if (stage === "undo") {                                              // 되돌리기는 한 번뿐 — 토큰을 실제로 갱신할 수 있을 때만 시작한다(D3·N-H1)
    const at = await accessFor(user, conn, d, "undo");
    if (at instanceof Response) return at;
  }
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
import { gmailMailApi, MAIL_CALL_TIMEOUT_MS, refreshAccessToken } from "../_shared/gmail.ts";
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
    accessToken: (u, c) => gmailAccessToken(sb, (rt) => refreshAccessToken(rt, MAIL_CALL_TIMEOUT_MS), u, c),   // 갱신 15초(D7)
    api: gmailMailApi,
    noteUnits: async (u, n) => { await noteGmailUnits(sb, u, n); },
    createRow: async (u, c, a, ids) => (await rpc("mail_action_preview", { p_user: u, p_connection: c, p_action: a, p_ids: ids })) as string | null,
    start: async (u, id) => (await rpc("mail_action_start", { p_user: u, p_id: id })) as RowResult,
    undo: async (u, id) => (await rpc("mail_action_undo", { p_user: u, p_id: id })) as RowResult,
    status: async (u, id) => (await rpc("mail_action_status", { p_user: u, p_id: id })) as Counts | null,
    kick: () => { kickInBackground(); },
    now: () => performance.now(),
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
Expected: 19 passed, 0 failed, check 무오류.

- [ ] **Step 5: 커밋**

```bash
git add supabase/functions/mail-action supabase/tests/mail-action.test.ts
git commit -m "feat(server): mail-action function — preview checks permission, connection and conditions first (bad_condition/needs_target never list), builds the query server-side, collects up to 1,000 ids over at most 5 pages of 500 within a 25 s budget, estimates starred, reads 20 From/Subject headers and creates the token row (none when empty); execute/undo only start the stored row's job (202, same token → 200 current) and refuse with 409 while the connection is not active — undo also refreshes the token first so the one undo is never used up on a dead connection; transient token or network errors are 502; status returns counts and method; MAIL_ACTIONS off blocks preview/execute only; logs carry codes and counts only

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task M6: `gmail-connect` 권한 업데이트(`upgrade`) + 일반 경로 `scopes` 기록

**Files:**
- Modify: `supabase/functions/gmail-connect/handler.ts:1-2`(import), `:13-20`(`ConnectDeps.refresh`), `:44-46`(본문·분기), `:74-75`(저장 직후 scopes), 파일 끝(`handleUpgrade`)
- Modify: `supabase/functions/gmail-connect/index.ts`(`refresh: refreshAccessToken`)
- Modify: `supabase/tests/gmail.test.ts:222-250`(가짜 deps 옵션), `:267-279`(rpc 순서 기대), 새 테스트 5개(실패 행렬 11사례)

**Interfaces:**
- Consumes: M2 `GMAIL_MODIFY_SCOPE`, `refreshAccessToken`, M3 RPC `mail_connection`·`gmail_replace_token`·`gmail_set_scopes`.
- Produces: 요청 `{code, upgrade?: boolean}`, 응답(D12) — M9a `GmailConnect.upgrade()`·M10 스모크가 쓴다. `ConnectDeps.refresh`.

- [ ] **Step 1: 가짜 deps 옵션과 실패하는 테스트**

`supabase/tests/gmail.test.ts`의 `connectDeps`(222행~)를 바꾼다 — 옵션 타입에 `account?: string; refreshFails?: boolean; replaceError?: string; mailConn?: null; mailConnStatus?: string; exchangeFails?: boolean; scopesError?: string`를 더하고:

```ts
    exchange: async (code) => { calls.push("exchange:" + code); if (o.exchangeFails) throw new Error("token exchange 400 invalid_grant");
      return { access_token: "at", refresh_token: o.refreshToken === undefined ? "rt" : o.refreshToken ?? undefined,
      expires_in: 3600, scope: o.scope ?? `openid ${GMAIL_SCOPE} https://www.googleapis.com/auth/userinfo.email` }; },
    refresh: async (t) => { calls.push("refresh:" + t); if (o.refreshFails) throw new Error("token refresh 400"); return "at2"; },
```

`profile`의 반환을 `{ emailAddress: o.account ?? "poc@example.com", historyId: "400" }`로, `rpc` 안 `if (o.rpcThrows) …` 다음에 넣는다:

```ts
      if (fn === "mail_connection") return Promise.resolve({ data: o.mailConn === null ? [] : [{ connection_id: CONN, account_ref: "poc@example.com", status: o.mailConnStatus ?? "active", scopes: [GMAIL_SCOPE] }], error: null });
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

Deno.test("gmail-connect upgrade failures never revoke and never write: mismatch 409, no token 200 false, no modify or no readonly 403, verify 502, replace 500, no connection 404, dead connection 409, exchange 502, profile 401 → 502", async () => {
  const cases: [Parameters<typeof connectDeps>[0], number, unknown][] = [
    [{ scope: UP_SCOPE, account: "other@example.com" }, 409, { error: "account_mismatch" }],
    [{ scope: UP_SCOPE, refreshToken: null }, 200, { connection_id: CONN, refresh_token_stored: false, upgraded: false }],
    [{}, 403, { error: "gmail_scope_missing" }],
    [{ scope: `openid ${MODIFY}` }, 403, { error: "gmail_scope_missing" }],                  // readonly 가 빠진 토큰은 옛 토큰을 덮지 않는다(D12)
    [{ scope: UP_SCOPE, refreshFails: true }, 502, { error: "token_verify_failed" }],
    [{ scope: UP_SCOPE, replaceError: "XX000" }, 500, { error: "replace_failed" }],
    [{ scope: UP_SCOPE, mailConn: null }, 404, { error: "no_connection" }],
    [{ scope: UP_SCOPE, mailConnStatus: "reauth_required" }, 409, { error: "reauth_required" }],   // 끊긴 연결은 되살리지 않는다(D12)
    [{ scope: UP_SCOPE, exchangeFails: true }, 502, { error: "token_exchange_failed" }],
    [{ scope: UP_SCOPE, fail: { stage: "profile", status: 401 } }, 502, { error: "gmail_unauthorized" }],   // 401 이면 앱이 일회용 코드를 다시 보낸다
    [{ scope: UP_SCOPE, fail: { stage: "profile", status: 403 } }, 403, { error: "gmail_forbidden" }],
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

Deno.test("gmail-connect normal path records granted scopes right after save only when a refresh token was stored; a failed scopes write still connects", async () => {
  const c = connectDeps({ scope: UP_SCOPE });
  assertEquals((await handleConnect(connectReq({ code: "c" }), c.d)).status, 200);
  assertEquals(c.rpcCalls[1], { fn: "gmail_set_scopes", args: { p_user: USER, p_connection: CONN, p_scopes: ["openid", GMAIL_SCOPE, MODIFY] } });
  const n = connectDeps({ scope: UP_SCOPE, refreshToken: null });                 // vault 의 옛 토큰과 scopes 가 어긋나지 않게(D12)
  assertEquals((await handleConnect(connectReq({ code: "c" }), n.d)).status, 200);
  assertEquals(n.rpcCalls.filter((x) => x.fn === "gmail_set_scopes").length, 0);
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
    // 승인 scope 기록(스펙 §8 connections.scopes, 0.14.0) — 새 refresh token 을 저장했을 때만(아니면 vault 에는 옛 토큰이 남아 scope 와 어긋난다).
    // 실패해도 연결은 성공 — readonly 로 보여 [권한 업데이트]가 남을 뿐(D12)
    if (t.refresh_token) {
      try {
        const sc = await deps.rpc.rpc("gmail_set_scopes", { p_user: user, p_connection: connId, p_scopes: (t.scope ?? "").split(/\s+/).filter(Boolean) });
        if (sc.error) log({ result: "scopes_save_failed" });
      } catch { log({ result: "scopes_save_failed" }); }
    }
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
    const conn = (c.data as { connection_id: string; account_ref: string; status: string }[] | null)?.[0];
    if (!conn) return out(404, "no_connection");
    if (conn.status !== "active") return out(409, "reauth_required");   // 끊긴 연결은 기존 재연결로 — upgrade 가 되살리면 sync 가 다음 cron 까지 쉰다(D12)
    stage = "upgrade_profile";
    const p = await deps.api(t.access_token).profile();
    if (p.emailAddress.toLowerCase() !== conn.account_ref.toLowerCase()) return out(409, "account_mismatch");
    if (!t.refresh_token) {                                          // 이전 동의 때문에 Google 이 다시 주지 않음 → 다음 재연결 때(스펙 §7)
      log({ result: "no_refresh_token", upgrade_stage: stage });
      return Response.json({ connection_id: conn.connection_id, refresh_token_stored: false, upgraded: false });
    }
    const scopes = (t.scope ?? "").split(/\s+/).filter(Boolean);
    // modify 와 readonly 둘 다(스펙 §7 — 읽기 경로는 readonly 승인을 전제한다. modify 단독 토큰으로 옛 토큰을 덮지 않는다)
    if (!scopes.includes(GMAIL_MODIFY_SCOPE) || !scopes.includes(GMAIL_READONLY_SCOPE)) return out(403, "gmail_scope_missing");
    stage = "upgrade_verify";
    try { await deps.refresh(t.refresh_token); } catch { return out(502, "token_verify_failed"); }
    stage = "upgrade_replace";
    const r = await deps.rpc.rpc("gmail_replace_token", { p_user: user, p_connection: conn.connection_id, p_refresh_token: t.refresh_token, p_scopes: scopes });
    if (r.error || r.data !== true) return out(500, "replace_failed");
    log({ result: "upgraded", upgrade_stage: stage });
    return Response.json({ connection_id: conn.connection_id, refresh_token_stored: true, upgraded: true });
  } catch (e) {
    if (e instanceof GmailHttpError) {                               // 연결 상태는 바꾸지 않는다(reauth 표시 없음)
      const m = mapGmail(e);
      return out(m.status === 401 ? 502 : m.status, m.code);         // 401 이면 앱이 세션을 바꿔 소비된 일회용 코드를 다시 보낸다 — 502 로
    }
    log({ result: "internal", upgrade_stage: stage, error: e instanceof Error ? e.name : "unknown" });   // 메시지는 토큰을 담을 수 있어 남기지 않는다
    return err(500, "internal");
  }
}
```

`supabase/functions/gmail-connect/index.ts`: import에 `refreshAccessToken`을 더하고 deps에 `refresh: refreshAccessToken,`을 더한다.

(`handleUpgrade`는 자기 `try`로 모든 예외를 잡아 응답을 돌려주므로 바깥 `catch`(`discardToken`)까지 가지 않고, 가더라도 `pendingRefreshToken`이 아직 비어 revoke하지 않는다 — 테스트 `rpcThrows`(500·revoke 0)가 확인.)

- [ ] **Step 4: 통과 확인 + `MAIL-server` 로컬 묶음**

Run: `deno test --allow-net --allow-env --allow-read --allow-write=/tmp --env-file=supabase/.env supabase/tests/gmail.test.ts supabase/tests/gmail-mail.test.ts supabase/tests/mail-query.test.ts supabase/tests/mail-sql.test.ts supabase/tests/mail-jobs.test.ts supabase/tests/units.test.ts supabase/tests/mail-action.test.ts supabase/tests/unsub-jobs.test.ts --filter "$LOCAL_FILTER" && deno check supabase/functions/{worker,mail-action,gmail-connect,chat,unsubscribe,gmail-webhook}/index.ts`
Expected: 전부 통과(호스팅 DB 사례 3개는 걸러짐), check 무오류. 통과 수를 적어 둔다.

- [ ] **Step 5: `gates.md` `MAIL-server` 행**

`docs/superpowers/phase1/gates.md` 표 끝에 더한다(상태 **대기** — 호스팅 DB 트랜잭션 테스트는 M10에서 덧붙이고 그때 통과로 바꾼다):

```
| MAIL-server | 메일 정리 서버 테스트(가짜 Gmail·PGlite, 스펙 §15): 검색어 조립·거절(기호만·2004년 전 포함)·범위 하한, 1,000개 다중 페이지·exact 분기·미리보기 25초, 토큰 10분·한 번만·남의 토큰, conditions 일치, TRASH 400·404 폴백·403 쿼터 미루기·권한 scope_missing, 같은 토큰 두 번, 중간 실패 ok/failed·되돌리기 ok만, Gmail 성공 뒤 기록 전 죽음·stale, 호출마다 예산·진행 뒤 미루기·재조회 쿼터 미루기, 마지막 시도 재조회, dead 트리거·남은 id 없는 마감, 끊긴 연결의 되돌리기 409·되살림, units 5,400/4,000, 함수·표 권한, upgrade revoke 0·불변·끊긴 연결 409 | 대기 | <KST> 로컬: mail-query <n>·gmail-mail <n>·mail-sql(PGlite) <n>·units <n>·mail-jobs <n>·mail-action <n>·gmail(가짜) <n> 통과. 호스팅 트랜잭션 DB 테스트는 M10 | | <날짜> |
```

- [ ] **Step 6: 커밋**

```bash
git add supabase/functions/gmail-connect supabase/tests/gmail.test.ts docs/superpowers/phase1/gates.md
git commit -m "feat(server): gmail-connect permission update — {code, upgrade: true} keeps the connection and cursor: exchange, find the user's active connection (dead → 409), same account (case-insensitive), refresh token present, modify and readonly granted, verify one refresh, then gmail_replace_token; every failure discards the new token in memory without revoke or any write; profile 401 is 502 so the app never resends the spent code; malformed upgrade is 400 so it never runs a normal connect; the normal path records granted scopes right after save only when a refresh token was stored (failure only logs); MAIL-server gate row (pending hosted DB run)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task M7: `INTENT-eval --mail-judged` (0.14.0 판정)

**Files:**
- Modify: `supabase/eval/intent-cases.json`(0.14.0 게이트 문장 4개), `supabase/scripts/_intent-eval.ts`(`WANT.mail_action`), `supabase/scripts/eval-intent.ts`(`GATE`·판정식)
- Modify: `docs/superpowers/phase1/gates.md`(기존 `INTENT-eval` 행 근거 칸에 덧붙임)
- (실패 때만) Modify: `supabase/functions/chat/filters.ts`(`MAIL_SCHEMA` 칸 설명), `supabase/tests/chat.test.ts`

**Interfaces:**
- Consumes: 0.13.0 `supabase/scripts/eval-intent.ts`·`_intent-eval.ts`·`intent-cases.json`(69 — `mail_action` 15, 정답 `mail` 칸)·`GATE`(a01·a12·a13·q04).
- Produces: `INTENT-eval` mail 판정(M10 `MAIL_ACTIONS=on`의 선행 조건). `MAIL_SCHEMA`를 고쳤으면 그 커밋(M10 Step 5b가 chat을 재배포한다).

**배포 없음(2026-10-06 메인 판정 (b)):** 러너는 chat 필터 함수(`extractFilters`)를 로컬에서 직접 부르므로 판정에 배포가 필요 없다. `MAIL_SCHEMA`를 고쳐도 chat 재배포·맥락 경로 회귀(CTX-eval — 배포본을 부른다)는 ③c2 뒤 M10에서 한다(Global Constraints "③c2 전 함수 배포 금지").

- [ ] **Step 1: 창 확인·기준선**

메인이 원장 최신 `status.t0`로 지금이 10-07·10-08 14:30~16:30 KST 창 밖이고 그날이면 13:45 전 시작인지 확인한다. 아니면 기다린다.

Run: `git log --oneline -1 -- supabase/functions/chat supabase/eval/intent-cases.json && grep -n 'INTENT-eval' docs/superpowers/phase1/gates.md`
Expected: 0.13.0 A2·A3 기록(`INTENT-eval` 통과, `gate_cases` true, A3 배포 HEAD)이 있다. 없으면 멈춘다(이 판정은 0.13.0 기준선 위에서만 뜻이 있다). A3가 적은 chat 배포 HEAD를 `$A3`로 둔다.

Run: `git diff --stat $A3..HEAD -- supabase/functions/chat; git log --format=%h -1 -- supabase/functions/chat`
Expected: diff 0줄(배포본 = HEAD — 지금 판정이 배포된 chat의 판정이다). 해시를 기록에 적는다. 줄이 있으면 멈추고 메인에게 알린다(누가 chat을 바꿨는지 먼저 본다).

- [ ] **Step 2: 게이트 문장 4개 사례**

MAIL-sim·MAIL-real·smoke-mail이 쓰는 문장이 실제로 기대한 의도·칸이 나오는지 3회 모두 확인한다(재현율 90% 합격선은 특정 문장의 실패를 허용한다 — 0.13.0 `gate_cases`와 같은 이유). `jq -r '.cases[] | select(.intent == "mail_action") | .id' supabase/eval/intent-cases.json | tail -1`로 마지막 mail id를 보고 그다음 번호로 더한다(아래는 `m16`~`m19`로 적는다). **같은 글이 이미 있으면 새 사례를 더하지 않고 그 id를 쓴다**(개수 기준도 그만큼 덜 늘린다). 그룹은 `mail_gate`.

```json
{ "id": "m16", "group": "mail_gate", "text": "합성상점에서 온 광고 메일 휴지통에 버려줘", "intent": "mail_action",
  "mail": { "action": "trash", "sender": "합성상점", "subject_words": [], "received_from": null, "received_to": null, "promotions": true, "unread_only": false } },
{ "id": "m17", "group": "mail_gate", "text": "받은편지함 메일 다 휴지통에 버려줘", "intent": "mail_action",
  "mail": { "action": "trash", "sender": null, "subject_words": [], "received_from": null, "received_to": null, "promotions": false, "unread_only": false } },
{ "id": "m18", "group": "mail_gate", "text": "제목에 ERURI 테스트 들어간 메일 휴지통으로 보내줘", "intent": "mail_action",
  "mail": { "action": "trash", "sender": null, "subject_words": ["ERURI", "테스트"], "received_from": null, "received_to": null, "promotions": false, "unread_only": false } },
{ "id": "m19", "group": "mail_gate", "text": "제목에 ERURI 테스트 들어간 안 읽은 메일 읽음 처리해줘", "intent": "mail_action",
  "mail": { "action": "read", "sender": null, "subject_words": ["ERURI", "테스트"], "received_from": null, "received_to": null, "promotions": false, "unread_only": true } }
```

(m17은 MAIL-sim G3의 "범위 없음" 문장이다 — 모델이 받은 기간·광고를 채우면 `needs_target` 대신 미리보기가 떠 G3가 성립하지 않는다.)

`supabase/scripts/_intent-eval.ts`: `const WANT = { question: 39, add_event: 15, mail_action: 15 } as const;`의 `mail_action`을 더한 수만큼 올린다(4개 모두 새로 더했으면 19). 주석 "스펙 §15 구성"은 그대로(스펙은 M0 (f2)가 고쳤다).

`supabase/scripts/eval-intent.ts`: 마지막 두 줄을 바꾼다 — 게이트 문장은 의도가 맞고 mail 칸도 맞아야 한다(행동이 아닌 문장은 `mail_ok`가 null):

```ts
// ADD-sim 문장(G1 = a01, G3 = a12, G7 = a13, G4 = q04)과 0.14.0 메일 정리 게이트 문장(m16~m19 — MAIL-sim·MAIL-real·smoke-mail)은
// 3회 모두 기대값이어야 한다 — 재현율 0.9 합격선은 특정 문장의 실패를 허용한다(Fable F2, 메일 정리 계획 리뷰 N-M11)
const GATE = ["a01", "a12", "a13", "q04", "m16", "m17", "m18", "m19"];
console.log(JSON.stringify({ ...summarize(rows, runs, mailJudged),
  gate_cases: GATE.every((id) => rows.filter((r) => r.id === id).every((r) => r.got === r.expected && r.mail_ok !== false)) }));
```

(이미 있던 글을 썼으면 `GATE`에 그 id를 넣는다.)

Run: `deno test --allow-env --allow-read supabase/tests/intent-eval.test.ts && deno check supabase/scripts/eval-intent.ts`
Expected: 통과(`validateCases(file)`가 `[]` — 개수 기준을 함께 고쳤다), 오류 0. `grep -rn '69' supabase/tests/intent-eval.test.ts supabase/scripts/_intent-eval.ts`에 사례 수를 단언하는 줄이 있으면 같이 고친다.

- [ ] **Step 3: 실행**

Run: `deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/eval-intent.ts --runs 3 --mail-judged | tee "$TMPDIR/intent-mail.log" | tail -1`
Expected: 판정 JSON — **오탐 0**(3회 전체), `add_event`·`mail_action` 재현율 각 ≥ 90%, 두 행동 혼동 0, `mail` 칸 일치 ≥ 90%(`--mail-judged`), `"cases":73`(새로 더한 수만큼), `"gate":"pass"`, **`"gate_cases":true`**. 출력은 사례 id·의도·불리언·비율만(문장 없음 — 0.13.0 러너 계약).

- [ ] **Step 4: 실패하면(U9, 최대 2회)**

칸 일치·게이트 문장만 못 넘으면 `$TMPDIR/intent-mail.log`에서 실패 사례 id와 틀린 칸 이름만 본다(문장은 보지 않아도 된다 — `supabase/eval/intent-cases.json`의 합성 문장을 읽는 것은 허용). 가장 많이 틀린 칸(예: 받은 기간·제목 단어)의 `MAIL_SCHEMA` `description`을 한 문장 고치고(예: "제목 단어는 사용자가 따옴표나 '제목에'로 말한 단어만, 조사·어미 없이", "받은편지함 전체·'다'는 범위가 아니다 — 받은 기간·광고를 채우지 않는다"), `deno test --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/tests/chat.test.ts`(바이트 동일 테스트 포함 — `intents` 없는 요청은 `MAIL_SCHEMA`를 쓰지 않으므로 그대로 통과해야 한다)를 통과시킨 뒤 Step 3을 다시 한다. 오탐·재현율이 깨지면 고친 문장을 되돌린다. 2회 뒤에도 실패면 멈추고 메인이 사용자에게 보고한다(U9 대안 — 게이트 문장이 실패면 그 문장을 바꿀지·보류할지).

**고쳐도 지금 배포하지 않는다.** 커밋 `fix(chat): mail fields — <요지>`만 남기고, chat 재배포·`smoke-chat` 두 번·CTX-eval(`EVAL_INTENTS=add_event,mail_action`, 맥락 경로 질문 회귀 — 필수)은 M10 Step 5b에서 한다. `MAIL_SCHEMA` 설명을 고치면 0.13.0+ 앱의 모든 질문(필터에 `intents`가 실린다)의 요청이 바뀌므로, 그 회귀를 배포본으로 확인하기 전에는 `MAIL_ACTIONS`를 켜지 않는다(M10 순서).

- [ ] **Step 5: 기록·커밋**

`docs/superpowers/phase1/gates.md`의 `INTENT-eval` 행 근거 칸 끝에 덧붙인다: `· 0.14.0 mail 판정 <KST>(chat HEAD <해시> = A3 배포본): 3회 오탐 0, add_event <x>%, mail_action <x>%, 혼동 0, mail 칸 일치 <x>%(≥90%), 게이트 문장 m16~m19 3/3(gate_cases true) — <MAIL_SCHEMA 수정 없음|수정 1문장(<커밋>) — 재배포·CTX-eval은 M10>`.

```bash
git add supabase/eval/intent-cases.json supabase/scripts/_intent-eval.ts supabase/scripts/eval-intent.ts docs/superpowers/phase1/gates.md   # Step 4 에서 고쳤으면 supabase/functions/chat/filters.ts supabase/tests/chat.test.ts 도
git commit -m "test(eval): INTENT-eval mail fields judged for 0.14.0 — four mail-cleanup gate sentences (MAIL-sim, MAIL-real, smoke) must match intent and fields in all three runs; three runs, no false actions, recall and mail-field match recorded; no deploy (chat redeploy, if the schema changed, waits for M10)

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
- Produces(M9a·M9b가 쓴다): `MailCleanup.intent`·`modifyScope`·`tokenTTL`·`undoTTL`·`pollInterval`·`pollLimit`·`isMailAction(_:)`·`Conditions`(`json`)·`Sample`·`Preview`·`Status`(`finished`·`undoPhase`)·`preview(_:)`·`status(_:)`·`errorCode(_:)`·`Note`(`text`·`settings`·`repreview`)·`previewError(status:code:)`·`executeIsDefinite(status:)`·`executeError(status:code:)`·`undoError(status:code:action:)`·`conditionLine(_:now:)`·`countLine(_:)`·`sampleLine(_:now:)`·`moreLine(_:)`·`grouped(_:)`·`progress(_:action:)`·`result(_:action:)`·`canUndo(_:previewAt:now:)`·`isTokenExpired(previewAt:now:)`·`showNext(_:_:)`·`needsUpgrade(rows:)`, `MailCleanupText.*`(`checking`·`unknownResult`·`maybeChanged`·`undoReconnect` 포함), `MailTurn`(`Phase`·`apply(_:)`·`needsStatusRead`·`afterStatusRead(_:)`), `ChatHistory.Kind.mailAction`, `Record.mail: MailTurn?`, `ChatReply.Answer.mail: JSONValue?`, `JSONValue.foundation`. 커밋 메시지는 `feat(core): mail cleanup`으로 시작한다(D17·M0 Step 6). 상태 전이 판단(재개·결과 불명·권한 버튼)은 여기 순수 함수로 두고 테스트한다 — 앱(M9b)은 부르기만 한다(Fable N-M15).

- [ ] **Step 1: 실패하는 테스트**

`ios/Packages/EruriCore/Tests/EruriCoreTests/MailCleanupTests.swift`:

```swift
import XCTest
@testable import EruriCore

/// 채팅 메일 정리(스펙 §7·§9, 0.14.0): 서버 응답 해석·조건 줄·건수·문구·시간 창·상태 다시 읽기 판단
final class MailCleanupTests: XCTestCase {
  let previewJSON = #"""
  {"token":"11111111-1111-4111-8111-111111111111","action":"trash",
   "conditions":{"action":"trash","sender":"합성상점","subject_words":[],"received_from":"2026-09-01","received_to":"2026-09-30","promotions":true,"unread_only":false},
   "count":1000,"exact":false,"total_estimate":1234,"starred_estimate":3,"has_more":true,
   "sample":[{"from":"합성상점","subject":"합성 광고 1","date":"2026-09-30T15:30:00.000Z"}]}
  """#
  let t0 = Date(timeIntervalSince1970: 1_790_000_000)     // 2026-09 (서울 기준 올해 = 2026)
  func p(_ s: String) -> MailCleanup.Preview { MailCleanup.preview(Data(s.utf8))! }
  func st(_ status: String, total: Int = 3, done: Int = 0, failed: Int = 0, undone: Int = 0, undoFailed: Int = 0, code: String? = nil) -> MailCleanup.Status {
    MailCleanup.Status(id: "x", status: status, total: total, done: done, failed: failed, undone: undone, undo_failed: undoFailed, code: code, method: nil)
  }
  func cond(from: String?, to: String?) -> MailCleanup.Conditions {
    MailCleanup.Conditions(action: "trash", sender: nil, subject_words: [], received_from: from, received_to: to, promotions: false, unread_only: false)
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
    XCTAssertTrue(st("undo_pending").undoPhase); XCTAssertFalse(st("running").finished); XCTAssertFalse(st("previewed").finished)
    let busy = MailCleanup.status(Data(#"{"error":"busy","id":"x","status":"running","total":3,"done":1,"failed":0,"undone":0,"undo_failed":0,"code":null,"method":"batch"}"#.utf8))
    XCTAssertEqual(busy?.status, "running")                                      // 409 busy 본문의 counts 도 읽힌다(M9b 가 폴링을 잇는다)
    XCTAssertEqual(MailCleanup.errorCode(Data(#"{"error":"bad_condition","fields":["received_from"]}"#.utf8)), "bad_condition")
    XCTAssertNil(MailCleanup.errorCode(Data("x".utf8)))
  }

  func testConditionLineUsesServerConfirmedFields() {
    XCTAssertEqual(MailCleanup.conditionLine(p(previewJSON).conditions, now: t0), "발신자 '합성상점' · 광고 · 9/1–9/30 · 별표 제외")
    let c = MailCleanup.Conditions(action: "read", sender: nil, subject_words: ["ERURI", "테스트"], received_from: nil, received_to: "2026-10-04", promotions: false, unread_only: true)
    XCTAssertEqual(MailCleanup.conditionLine(c, now: t0), "제목 'ERURI' '테스트' · 10/4까지 · 안 읽은 메일 · 별표 제외")
    XCTAssertEqual(MailCleanup.conditionLine(cond(from: "2026-09-01", to: "2026-09-01"), now: t0), "9/1 · 별표 제외")
    XCTAssertEqual(MailCleanup.conditionLine(cond(from: "2026-09-01", to: nil), now: t0), "9/1부터 · 별표 제외")
  }

  func testOtherYearDatesShowTheYear() {
    // 모델이 다른 해를 채워도 카드에서 가려낼 수 있게(N-H3): 서울 기준 올해가 아닌 날짜만 연도를 붙인다
    XCTAssertEqual(MailCleanup.conditionLine(cond(from: "2025-09-01", to: "2025-09-30"), now: t0), "2025/9/1–9/30 · 별표 제외")
    XCTAssertEqual(MailCleanup.conditionLine(cond(from: "2025-12-01", to: "2026-01-05"), now: t0), "2025/12/1–1/5 · 별표 제외")
    XCTAssertEqual(MailCleanup.conditionLine(cond(from: "2024-12-01", to: "2025-01-05"), now: t0), "2024/12/1–2025/1/5 · 별표 제외")
    XCTAssertEqual(MailCleanup.conditionLine(cond(from: nil, to: "2025-10-04"), now: t0), "2025/10/4까지 · 별표 제외")
    XCTAssertEqual(MailCleanup.sampleLine(MailCleanup.Sample(from: "합성상점", subject: "합성", date: "2025-09-03T01:00:00Z"), now: t0), "합성상점 · 합성 · 2025/9/3")
    // 서울 1월 1일 00:30 = UTC 전날 15:30 — 연도도 서울 기준
    XCTAssertEqual(MailCleanup.sampleLine(MailCleanup.Sample(from: "a", subject: "b", date: "2025-12-31T15:30:00Z"), now: t0), "a · b · 1/1")
  }

  func testCountLineExactAndEstimated() {
    XCTAssertEqual(MailCleanup.countLine(p(previewJSON)), "총 약 1,234건 중 1,000건 · 별표 약 3건 제외")
    let exact = p(previewJSON.replacingOccurrences(of: #""count":1000,"exact":false,"total_estimate":1234,"starred_estimate":3"#,
                                                   with: #""count":3,"exact":true,"total_estimate":3,"starred_estimate":0"#))
    XCTAssertEqual(MailCleanup.countLine(exact), "3건")
    let exactStar = p(previewJSON.replacingOccurrences(of: #""count":1000,"exact":false,"total_estimate":1234,"starred_estimate":3"#,
                                                       with: #""count":3,"exact":true,"total_estimate":3,"starred_estimate":2"#))
    XCTAssertEqual(MailCleanup.countLine(exactStar), "3건 · 별표 약 2건 제외")
  }

  func testSampleAndMoreLinesUseSeoulDates() {
    let v = p(previewJSON)
    XCTAssertEqual(MailCleanup.sampleLine(v.sample[0], now: t0), "합성상점 · 합성 광고 1 · 10/1")            // 15:30Z = 서울 다음 날 00:30
    XCTAssertEqual(MailCleanup.sampleLine(MailCleanup.Sample(from: "", subject: "", date: "2026-10-05T01:00:00Z"), now: t0), "(보낸 사람 없음) · (제목 없음) · 10/5")
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
    XCTAssertEqual(MailCleanup.previewError(status: 502, code: "gmail_upstream").text, MailCleanupText.failed)
    XCTAssertEqual(MailCleanup.previewError(status: 401, code: nil).text, MailCleanupText.failed)
    XCTAssertEqual(MailCleanup.previewError(status: -1, code: nil).text, MailCleanupText.failed)
    // 실행: 확정 코드만 문구로(행이 바뀌지 않았다), 나머지는 앱이 상태를 먼저 읽는다(D22)
    XCTAssertEqual(MailCleanup.executeError(status: 410, code: "token_expired"), MailCleanup.Note(MailCleanupText.expired, repreview: true))
    XCTAssertEqual(MailCleanup.executeError(status: 404, code: "not_found"), MailCleanup.Note(MailCleanupText.expired, repreview: true))
    XCTAssertEqual(MailCleanup.executeError(status: 400, code: "bad_token"), MailCleanup.Note(MailCleanupText.expired, repreview: true))
    XCTAssertEqual(MailCleanup.executeError(status: 404, code: "no_connection").text, MailCleanupText.noConnection)
    XCTAssertEqual(MailCleanup.executeError(status: 409, code: "reauth_required"), MailCleanup.Note(MailCleanupText.reauth, settings: true))
    XCTAssertEqual(MailCleanup.executeError(status: 403, code: "scope_missing"), MailCleanup.Note(MailCleanupText.scopeMissing, settings: true))
    XCTAssertEqual([400, 403, 404, 409, 410, 503].map { MailCleanup.executeIsDefinite(status: $0) }, Array(repeating: true, count: 6))
    XCTAssertEqual([nil, -1, 401, 500, 502, 504].map { MailCleanup.executeIsDefinite(status: $0) }, Array(repeating: false, count: 6))
    // 되돌리기
    XCTAssertEqual(MailCleanup.undoError(status: 410, code: "undo_expired", action: "trash").text, "되돌리기 기간(7일)이 지났어요 — Gmail 휴지통에서 직접 복원할 수 있어요")
    XCTAssertEqual(MailCleanup.undoError(status: 410, code: "undo_expired", action: "read").text, "되돌리기 기간(7일)이 지났어요 — Gmail에서 직접 안 읽음으로 바꿀 수 있어요")
    XCTAssertEqual(MailCleanup.undoError(status: 409, code: "nothing_to_undo", action: "trash").text, MailCleanupText.nothingToUndo)
    XCTAssertEqual(MailCleanup.undoError(status: 409, code: "reauth_required", action: "trash"), MailCleanup.Note(MailCleanupText.undoReconnect, settings: true))
    XCTAssertEqual(MailCleanup.undoError(status: 404, code: "no_connection", action: "trash").text, MailCleanupText.noConnection)
    XCTAssertEqual(MailCleanup.undoError(status: 502, code: "gmail_upstream", action: "trash").text, MailCleanupText.failed)
  }

  func testProgressAndResultTexts() {
    XCTAssertEqual(MailCleanup.progress(st("running", total: 1000, done: 400, failed: 2), action: "trash"), "휴지통으로 옮기는 중 402/1,000")
    XCTAssertEqual(MailCleanup.progress(st("pending"), action: "read"), "읽음으로 바꾸는 중 0/3")
    XCTAssertEqual(MailCleanup.progress(st("undoing", done: 3, undone: 1), action: "trash"), "되돌리는 중 1/3")
    XCTAssertEqual(MailCleanup.result(st("done", done: 3), action: "trash"), MailCleanup.Note("휴지통으로 3건 옮겼어요"))
    XCTAssertEqual(MailCleanup.result(st("partial", done: 2, failed: 1), action: "read").text, "2건을 읽음으로 바꿨어요 · 1건 실패")
    XCTAssertEqual(MailCleanup.result(st("failed", failed: 3, code: "job_dead"), action: "trash"),
                   MailCleanup.Note("휴지통으로 옮기지 못했어요 (3건 실패)\n일부는 이미 바뀌었을 수 있어요 — Gmail 휴지통에서 직접 복원할 수 있어요"))
    XCTAssertEqual(MailCleanup.result(st("partial", done: 1, failed: 2, code: "job_lost"), action: "read").text,
                   "1건을 읽음으로 바꿨어요 · 2건 실패\n일부는 이미 바뀌었을 수 있어요 — Gmail에서 직접 안 읽음으로 바꿀 수 있어요")
    XCTAssertEqual(MailCleanup.result(st("partial", done: 1, failed: 2, code: "scope_missing"), action: "trash"),
                   MailCleanup.Note("휴지통으로 1건 옮겼어요 · 2건 실패\nGmail 권한(연결)이 바뀌어 2건을 처리하지 못했어요", settings: true))
    XCTAssertEqual(MailCleanup.result(st("failed", failed: 3, code: "no_connection"), action: "read").text,
                   "읽음으로 바꾸지 못했어요 (3건 실패)\nGmail 권한(연결)이 바뀌어 3건을 처리하지 못했어요")
    // 연결 끊김으로 되돌리기가 시작되지 않음(SQL 이 실행 종료 상태로 되돌림, D11) — [되돌리기]는 남는다
    XCTAssertEqual(MailCleanup.result(st("done", done: 3, code: "undo_reauth_required"), action: "trash"),
                   MailCleanup.Note("휴지통으로 3건 옮겼어요\n" + MailCleanupText.undoReconnect, settings: true))
    XCTAssertTrue(MailCleanup.canUndo(st("done", done: 3, code: "undo_reauth_required"), previewAt: t0, now: t0))
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

  func testShowNextOnlyAfterAFinishedExecutionWithSuccessAndMore() {
    let v = p(previewJSON)
    XCTAssertTrue(MailCleanup.showNext(v, st("done", done: 3)))
    XCTAssertFalse(MailCleanup.showNext(v, st("running")))
    XCTAssertFalse(MailCleanup.showNext(v, st("undone", done: 3)))
    XCTAssertFalse(MailCleanup.showNext(v, st("failed", failed: 3)))                 // 성공 0 이면 다음 1,000건을 권하지 않는다
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
    XCTAssertEqual(MailCleanupText.upgradeResult(status: 502, body: [:]), MailCleanupText.upgradeFailed)
    XCTAssertTrue(MailCleanup.isMailAction("mail_action")); XCTAssertFalse(MailCleanup.isMailAction(nil))
  }

  // ── 상태 다시 읽기 계약(D22 — Codex C3·C4, Fable N-H2·N-M15) ──
  func testNeedsStatusRead() {
    XCTAssertTrue(MailTurn(phase: .running, status: st("done", done: 3)).needsStatusRead)        // 되돌리기 요청 직후 닫힘: 저장된 상태는 옛 실행 결과
    XCTAssertTrue(MailTurn(phase: .running).needsStatusRead)                                     // 실행 응답 전에 닫힘(토큰으로 묻는다)
    XCTAssertTrue(MailTurn(phase: .ended, status: st("running")).needsStatusRead)                // 20분 상한·옛 기록 — 끝나지 않은 상태
    XCTAssertFalse(MailTurn(phase: .ended, status: st("done", done: 3)).needsStatusRead)
    XCTAssertFalse(MailTurn(phase: .preview).needsStatusRead)
    XCTAssertFalse(MailTurn(phase: .ended, note: MailCleanupText.cancelled).needsStatusRead)
  }

  func testAfterStatusRead() {
    var a = MailTurn(phase: .running, note: MailCleanupText.checking)
    a.afterStatusRead(st("previewed"))                                                          // 실행 요청이 서버에 닿지 않았다 — 버튼으로
    XCTAssertEqual([a.phase == .preview, a.status == nil, a.note == MailCleanupText.failed], [true, true, true])
    var b = MailTurn(phase: .running, status: st("done", done: 3), note: MailCleanupText.stillRunning)
    b.afterStatusRead(st("undoing", done: 3, undone: 1))
    XCTAssertEqual([b.phase == .running, b.status?.status == "undoing", b.note == nil], [true, true, true])
    b.afterStatusRead(st("undone", done: 3, undone: 3))
    XCTAssertEqual([b.phase == .ended, b.needsStatusRead], [true, false])
  }

  func testNeedsUpgrade() {
    let mod = MailCleanup.modifyScope, ro = "https://www.googleapis.com/auth/gmail.readonly"
    XCTAssertTrue(MailCleanup.needsUpgrade(rows: [["status": "active", "scopes": [ro]]]))
    XCTAssertTrue(MailCleanup.needsUpgrade(rows: [["status": "active", "scopes": NSNull()]]))     // 0.14.0 전 연결(null) = readonly
    XCTAssertFalse(MailCleanup.needsUpgrade(rows: [["status": "active", "scopes": [ro, mod]]]))
    XCTAssertFalse(MailCleanup.needsUpgrade(rows: [["status": "reauth_required", "scopes": [ro]]]))
    XCTAssertFalse(MailCleanup.needsUpgrade(rows: []))
  }

  func testMailTurnDecodesWithUnknownKeysAndWithoutOptionalOnes() throws {
    // 기록 파일 호환: 모르는 키는 무시, Optional 필드는 없어도 된다(이후 필드는 Optional 로만 더한다)
    let m = try JSONDecoder().decode(MailTurn.self, from: Data(#"{"phase":"ended","settings":false,"repreview":false,"later_field":1}"#.utf8))
    XCTAssertEqual([m.phase == .ended, m.preview == nil, m.status == nil, m.previewAt == nil, m.note == nil], [true, true, true, true, true])
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
  public static let pollLimit: TimeInterval = 20 * 60         // 한 번 읽기 시작해 이어 읽는 상한(넘으면 진행 중 그대로 "아직 처리 중이에요", D14·D22)

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

  /// 화면 문구 + 버튼: [설정 열기]·[다시 미리보기]
  public struct Note: Equatable, Sendable {
    public let text: String; public let settings: Bool; public let repreview: Bool
    public init(_ text: String, settings: Bool = false, repreview: Bool = false) {
      self.text = text; self.settings = settings; self.repreview = repreview
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
  /// 실행 요청 응답이 "행이 바뀌지 않았다"가 확실한 코드인가. 아니면(네트워크·5xx·401) 앱은 문구 전에 토큰 상태를 먼저 읽는다(D22 — 요청이 서버에 닿았으면 잡은 돈다)
  public static func executeIsDefinite(status: Int?) -> Bool { status.map { [400, 403, 404, 409, 410, 503].contains($0) } ?? false }
  /// 확정 코드의 문구(executeIsDefinite 가 참일 때만 부른다)
  public static func executeError(status: Int, code: String?) -> Note {
    switch (status, code) {
    case (410, _), (404, "not_found"?), (400, _): return Note(MailCleanupText.expired, repreview: true)   // 토큰이 지났거나 없다 — 다시 미리보기
    case (403, "scope_missing"?): return Note(MailCleanupText.scopeMissing, settings: true)
    case (404, _): return Note(MailCleanupText.noConnection)
    case (409, _): return Note(MailCleanupText.reauth, settings: true)
    case (503, _): return Note(MailCleanupText.disabled)
    default: return Note(MailCleanupText.failed)
    }
  }
  public static func undoError(status: Int, code: String?, action: String) -> Note {
    switch (status, code) {
    case (410, _): return Note(MailCleanupText.undoExpired(action))
    case (409, "nothing_to_undo"?): return Note(MailCleanupText.nothingToUndo)
    case (409, "reauth_required"?): return Note(MailCleanupText.undoReconnect, settings: true)   // 행은 그대로 — [되돌리기]가 남는다(D3)
    case (409, "busy"?): return Note(MailCleanupText.stillRunning)       // 앱은 본문의 counts 로 폴링을 잇는다 — 이 문구는 counts 를 못 읽었을 때만
    case (403, "scope_missing"?): return Note(MailCleanupText.scopeMissing, settings: true)
    case (404, _): return Note(MailCleanupText.noConnection)
    default: return Note(MailCleanupText.failed)
    }
  }

  /// 미리보기 카드 조건 줄 — 서버가 확정한 conditions 로만 만든다(앱이 보낸 칸을 다시 그리지 않는다, 스펙 §9).
  /// 서울 기준 올해가 아닌 날짜는 연도를 붙인다 — 모델이 다른 해를 채워도 카드에서 가려낼 수 있게(N-H3)
  public static func conditionLine(_ c: Conditions, now: Date = Date()) -> String {
    let year = seoulYear(now)
    let show = { (x: (y: Int, md: String)) in x.y == year ? x.md : "\(x.y)/\(x.md)" }
    var parts: [String] = []
    if let s = c.sender { parts.append("발신자 '\(s)'") }
    if !c.subject_words.isEmpty { parts.append("제목 " + c.subject_words.map { "'\($0)'" }.joined(separator: " ")) }
    if c.promotions { parts.append("광고") }
    switch (c.received_from.flatMap(ymd), c.received_to.flatMap(ymd)) {
    case let (a?, b?):
      if a.y == b.y && a.md == b.md { parts.append(show(a)) }
      else { parts.append("\(show(a))–\(a.y == b.y ? b.md : show(b))") }   // 끝 날짜는 시작과 해가 다를 때만 연도
    case let (a?, nil): parts.append("\(show(a))부터")
    case let (nil, b?): parts.append("\(show(b))까지")
    default: break
    }
    if c.unread_only { parts.append("안 읽은 메일") }
    parts.append("별표 제외")
    return parts.joined(separator: " · ")
  }
  /// "2026-09-01" → (2026, "9/1")(서울 날짜 문자열 그대로 — 시간대 계산 없음)
  static func ymd(_ day: String) -> (y: Int, md: String)? {
    let p = day.split(separator: "-")
    guard p.count == 3, let y = Int(p[0]), let m = Int(p[1]), let d = Int(p[2]) else { return nil }
    return (y, "\(m)/\(d)")
  }
  static func seoulCalendar() -> Calendar {
    var cal = Calendar(identifier: .gregorian)
    cal.timeZone = TimeZone(identifier: "Asia/Seoul")!
    return cal
  }
  static func seoulYear(_ d: Date) -> Int { seoulCalendar().component(.year, from: d) }
  public static func countLine(_ p: Preview) -> String {
    let star = p.starred_estimate > 0 ? " · 별표 약 \(grouped(p.starred_estimate))건 제외" : ""
    return (p.exact ? "\(grouped(p.count))건" : "총 약 \(grouped(p.total_estimate))건 중 \(grouped(p.count))건") + star
  }
  public static func sampleLine(_ s: Sample, now: Date = Date()) -> String {
    [s.from.isEmpty ? "(보낸 사람 없음)" : s.from, s.subject.isEmpty ? "(제목 없음)" : s.subject, seoulDay(s.date, now: now)].compactMap { $0 }.joined(separator: " · ")
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
  /// 받은 시각 ISO → 서울 "M/D"(올해가 아니면 "Y/M/D")
  static func seoulDay(_ s: String, now: Date) -> String? {
    guard let d = isoFrac.date(from: s) ?? isoPlain.date(from: s) else { return nil }
    let c = seoulCalendar().dateComponents([.year, .month, .day], from: d)
    let md = "\(c.month ?? 0)/\(c.day ?? 0)"
    return c.year == seoulYear(now) ? md : "\(c.year ?? 0)/\(md)"
  }

  public static func progress(_ s: Status, action: String) -> String {
    if s.undoPhase { return "\(MailCleanupText.undoing) \(grouped(s.undone + s.undo_failed))/\(grouped(s.done))" }
    return "\(action == "read" ? MailCleanupText.reading : MailCleanupText.trashing) \(grouped(s.done + s.failed))/\(grouped(s.total))"
  }
  public static func result(_ s: Status, action: String) -> Note {
    let code = s.code ?? ""
    let perm = ["scope_missing", "reauth_required", "no_connection"].contains(code)
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
      // 잡이 끝까지 못 감: 실패로 적힌 id 중 실제로 바뀐 메일이 있을 수 있다(스펙 §7 결과 불명·재개, N-M12)
      if ["job_dead", "job_lost"].contains(code) { lines.append("\(MailCleanupText.maybeChanged) — \(MailCleanupText.manual(action))") }
      // 연결 끊김으로 되돌리기가 시작되지 않음(D11) — [되돌리기]는 남는다(canUndo)
      let bounced = code.hasPrefix("undo_")
      if bounced { lines.append(MailCleanupText.undoReconnect) }
      return Note(lines.joined(separator: "\n"), settings: (perm && s.failed > 0) || bounced)
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
  /// [다음 1,000건 보기]: 더 있고 실행이 끝났고 성공이 있을 때(되돌린 뒤·성공 0 이면 숨긴다)
  public static func showNext(_ p: Preview, _ s: Status?) -> Bool { p.has_more && (s.map { $0.finished && !$0.undoPhase && $0.done > 0 } ?? false) }
  /// 설정 [권한 업데이트] 표시(D16): `connections?select=status,scopes` 첫 행이 active 이고 scopes 에 modify 가 없을 때만(null = 0.14.0 전 = readonly)
  public static func needsUpgrade(rows: [[String: Any]]) -> Bool {
    guard let c = rows.first, c["status"] as? String == "active" else { return false }
    return !((c["scopes"] as? [String]) ?? []).contains(modifyScope)
  }
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
  public static let checking = "결과를 확인하는 중이에요"
  public static let unknownResult = "결과를 확인하지 못했어요 — Gmail에서 직접 확인해 주세요"
  public static let maybeChanged = "일부는 이미 바뀌었을 수 있어요"
  public static let undoReconnect = "Gmail 연결이 끊겨 되돌리지 못했어요 — 설정 › Gmail에서 다시 연결한 뒤 되돌려 주세요"
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
    case 409 where body["error"] as? String == "reauth_required": return reauth   // 끊긴 연결은 다시 연결부터(D12)
    case 409: return upgradeMismatch
    case 403: return upgradeNotGranted
    default: return upgradeFailed
    }
  }
}

/// 대화 기록의 메일 정리 턴(스펙 §9 "대화 기록"): 서버가 확정한 조건·미리보기 글(위 20건·건수)·토큰(= mail_actions id)·마지막 상태. 이 기기에만, 30일.
/// 기록 파일 호환(F19): 이후에 더하는 필드는 Optional 로만(없는 키를 읽어도 실패하지 않게). 모르는 키는 무시된다
public struct MailTurn: Codable, Sendable, Equatable {
  public enum Phase: String, Codable, Sendable { case finding, preview, running, ended }
  public var phase: Phase
  public var preview: MailCleanup.Preview?
  public var previewAt: Date?
  public var status: MailCleanup.Status?
  public var note: String?
  public var settings: Bool
  public var repreview: Bool
  public init(phase: Phase = .finding, preview: MailCleanup.Preview? = nil, previewAt: Date? = nil, status: MailCleanup.Status? = nil,
              note: String? = nil, settings: Bool = false, repreview: Bool = false) {
    self.phase = phase; self.preview = preview; self.previewAt = previewAt; self.status = status
    self.note = note; self.settings = settings; self.repreview = repreview
  }
  public mutating func apply(_ n: MailCleanup.Note) { note = n.text; settings = n.settings; repreview = n.repreview }
  /// 서버 상태를 먼저 읽어야 하는 턴(D22): 진행 중(실행·되돌리기 요청 중 닫힘 포함)이거나 저장된 상태가 아직 끝나지 않음(20분 상한·옛 기록)
  public var needsStatusRead: Bool { phase == .running || (status.map { !$0.finished } ?? false) }
  /// 서버 상태를 읽은 뒤: previewed = 실행 요청이 닿지 않음 → 미리보기(버튼)로. 그 밖은 그 상태로(끝났으면 ended)
  public mutating func afterStatusRead(_ s: MailCleanup.Status) {
    if s.status == "previewed" { phase = .preview; status = nil; note = MailCleanupText.failed; settings = false; return }
    status = s; phase = s.finished ? .ended : .running; note = nil; settings = false
  }
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
1. `Kind` 정의(0.13.0 — `case question, link, image, addEvent`, 뒤에 0.13.0 주석이 붙어 있을 수 있다)의 `addEvent` 뒤에 `, mailAction`을 더하고 줄 끝 주석에 `· mailAction = 채팅 메일 정리(0.14.0)`를 붙인다(글자 그대로 치환하지 말고 `grep -n 'case question, link, image, addEvent' …ChatHistory.swift`로 찾아 고친다).
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
git commit -m "feat(core): mail cleanup — decode preview/status from mail-action, condition line from server-confirmed fields with the year on other-year dates, exact or estimated counts with starred, Seoul M/D sample lines, error and result copy (permission/connection, zero-success, possibly-changed after a dead job, undo stopped by a dead connection, undo windows for trash and read), which execute replies are definite, when a turn must reread server state and how a read applies, Update-permission visibility, 10-minute token and 7-day undo checks, next-1,000 only after success; mail-action chat turns in history (unfinished preview ends on restore, running turns reread status, never context); answer carries raw mail fields; app now sends intents [add_event, mail_action]

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task M9a: 앱 권한 UI — 설정 [권한 업데이트]·새 연결 scope·업로드 가드

**Files:**
- Modify: `ios/App/GoogleSignIn.swift:12,39,74-95`(scope·`connect(upgrade:)`), 새 `upgrade()`
- Modify: `ios/App/ContentView.swift`(Gmail 절·상태·`SettingsRouter`), `ios/App/EruriApp.swift:46-58`(설정 탭 전환)
- Create: `ios/scripts/version-guard.sh` · Modify: `ios/scripts/testflight.sh`(가드 호출 한 줄)

**Interfaces:**
- Consumes: M8 `MailCleanup.modifyScope`·`needsUpgrade(rows:)`·`MailCleanupText.upgrade*`, M6 HTTP 계약(D12), `API.send`, `Trace.log`, `DiagLog`.
- Produces: `SettingsRouter.shared.open()`(M9b 카드 [설정 열기]가 쓴다), `GmailConnect.upgrade()`, 화면 식별자 `settings-gmail-upgrade`·`settings-gmail-upgrade-result`(M11), trace `device.gmail_upgrade`(`result`·`upgraded`), `ios/scripts/version-guard.sh`. 커밋 메시지는 `feat(ios): mail cleanup permission`으로 시작한다(D17).

**이 태스크가 따로인 이유(Codex·Fable 태스크 분할):** 새 연결·주간 재연결 scope(readonly + modify) 한 줄은 ③c2 전 기기로 나가면 그 자체로 modify 재동의가 된다(D17). 이 커밋에 업로드 가드를 함께 넣어 scope 변경과 가드가 갈라지지 않게 한다.

- [ ] **Step 1: 확인**

Run: `grep -n 'static let scope' ios/App/GoogleSignIn.swift && grep -n 'Button("다시 연결' ios/App/ContentView.swift && grep -n 'archiveRouter.openCount' ios/App/EruriApp.swift && grep -n 'MARKETING_VERSION' ios/project.yml`
Expected: 네 줄 모두 있다(`MARKETING_VERSION: 0.13.0`). 없으면 그 모양에 맞춰 아래 삽입 위치를 고르고 보고에 적는다.

- [ ] **Step 2: 설정 — 라우터·[권한 업데이트]**

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
  /// [권한 업데이트] 표시(D16): scopes 를 상태 줄과 따로 읽는다 — 열이 없는 서버(0030 전, 400)면 숨긴다. 판단은 EruriCore(needsUpgrade)
  private func gmailNeedsUpgrade() async -> Bool {
    guard let r = await API.send("rest/v1/connections?select=status,scopes&provider=eq.gmail"), r.status == 200,
          let rows = try? JSONSerialization.jsonObject(with: r.data) as? [[String: Any]] else { return false }
    return MailCleanup.needsUpgrade(rows: rows)
  }
  private func upgradeGmail() {
    busy = true
    Task { upgradeResult = await GmailConnect.upgrade(); busy = false; await refresh() }
  }
```

`ios/App/EruriApp.swift`: `private var archiveRouter: ArchiveRouter { ArchiveRouter.shared }` 아래에 `private var settingsRouter: SettingsRouter { SettingsRouter.shared }`, `.onChange(of: archiveRouter.openCount) …` 줄 아래에 `.onChange(of: settingsRouter.openCount) { _, _ in tab = .settings }   // 메일 정리 [설정 열기](0.14.0)`.

- [ ] **Step 3: `GoogleSignIn.swift` — 새 연결 scope·권한 업데이트**

(a) 12행 아래에 `static let modifyScope = MailCleanup.modifyScope   // 0.14.0: 새 연결·주간 재연결은 readonly + modify(스펙 §7, 서버는 readonly 만 확인). ③c2 전 기기 설치 금지(D17)`.

(b) 39행 `additionalScopes: [scope]` → `additionalScopes: [scope, modifyScope]`.

(c) `connect(_:access:code:)`에 `upgrade: Bool = false` 인자를 더하고 본문을 바꾼다:

```swift
    r.httpBody = try? JSONSerialization.data(withJSONObject: upgrade ? ["code": code, "upgrade": true] as [String: Any] : ["code": code])
```

(d) `run(forceConsent:)` 아래에 더한다:

```swift
  /// 권한 업데이트(스펙 §7, 0.14.0, 계획 D13): 지금 연결을 그대로 두고 gmail.modify 를 더한다 — disconnect 하지 않는다(기존 승인을 끊지 않게).
  /// 되살린 사용자에게 addScopes, 못 되살렸거나 Google 쪽에 이미 승인돼 있으면 일반 로그인(readonly + modify)으로 새 코드를 받는다 → gmail-connect {code, upgrade: true}.
  /// 취소(-5)는 서버를 부르지 않고 빈 문구(버튼은 그대로). 서버 호출이 네트워크 오류면 같은 코드로 한 번만 다시(교환 전에 끊겼을 수 있다 — 교환됐으면 502 로 끝난다).
  /// 화면 문구는 MailCleanupText 의 것만(진단 문자열은 DiagLog·trace 로만). 코드·토큰은 로그에 남기지 않는다
  static func upgrade() async -> String {
    guard let cfg = config() else { _ = fail("config_missing", "앱 설정값(GID·Supabase)이 빌드에 없음"); return MailCleanupText.upgradeFailed }
    guard var access = await SupabaseSession.shared.accessToken() else { _ = fail("no_session", "먼저 Apple로 로그인하세요"); return MailCleanupText.upgradeFailed }
    GIDSignIn.sharedInstance.configuration = GIDConfiguration(clientID: cfg.clientID, serverClientID: cfg.serverClientID)
    guard let presenter = topViewController() else { _ = fail("no_presenter", "로그인 화면을 띄울 창을 찾지 못함"); return MailCleanupText.upgradeFailed }
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
    if status == -1 {                                                                // 네트워크 오류 — 같은 코드로 한 번만(MAIL-real ①이 일시 오류로 7일 밀리지 않게)
      DiagLog.append("gmail upgrade network retry")
      (status, body) = await connect(cfg, access: access, code: code, upgrade: true)
    }
    if status == 401 {                                                               // 게이트웨이에서 막혀 코드가 소비되지 않았다 — 한 번만 다시(서버는 Google 401 을 502 로 준다, D12)
      await SupabaseSession.shared.invalidate()
      guard let a = await SupabaseSession.shared.accessToken() else { _ = fail("relogin_failed", "Supabase 재로그인 실패"); return MailCleanupText.upgradeFailed }
      access = a
      (status, body) = await connect(cfg, access: access, code: code, upgrade: true)
    }
    Trace.log("device.gmail_upgrade", ["result": "http_\(status)", "upgraded": (body["upgraded"] as? Bool) == true])
    return MailCleanupText.upgradeResult(status: status, body: body)
  }
```

(`fail(_:_:code:)`은 기존 함수 — 진단 문자열을 `lastError`·trace에 남기고 그 문자열을 돌려준다. 권한 업데이트 화면에는 그 문자열 대신 `upgradeFailed`를 보인다.)

- [ ] **Step 4: 업로드 가드**

`ios/scripts/version-guard.sh`(실행 권한 `chmod +x`):

```bash
#!/bin/bash
# 업로드 버전 가드(계획 2026-10-06-mail-cleanup.md D17): 메일 정리 코드(새 연결·주간 재연결의 modify scope 요청 포함)가 있는데
# MARKETING_VERSION 이 0.14.0 전이면 멈춘다 — MAIL-sim 전 빌드가 0.13.x 이름으로 사용자 기기에 나가 주간 재연결이 곧 modify 재동의가 되지 않게.
# 의도한 예외(메인이 승인한 핫픽스 등)만 TF_ALLOW_PRE_MAIL=1
set -euo pipefail
cd "$(dirname "$0")/.."
VER=$(awk '/MARKETING_VERSION:/ {print $2; exit}' project.yml)
NUM=$(echo "$VER" | awk -F. '{print $1 * 1000000 + $2 * 1000 + $3}')
if [ -f Packages/EruriCore/Sources/EruriCore/MailCleanup.swift ] && [ "$NUM" -lt 14000 ] && [ "${TF_ALLOW_PRE_MAIL:-0}" != 1 ]; then
  echo "메일 정리 코드가 있는데 MARKETING_VERSION=$VER (< 0.14.0) — MAIL-sim 통과 전 업로드 금지(D17). 'feat(core): mail cleanup' 직전 커밋 worktree 에서 올리거나 TF_ALLOW_PRE_MAIL=1"
  exit 1
fi
echo "version-guard ok ($VER)"
```

`ios/scripts/testflight.sh`: `vm_stat | grep -E 'free|compressor'   # 아카이브는 …` 줄 바로 앞에 `./scripts/version-guard.sh   # 0.14.0 전 버전 이름으로 메일 정리를 올리지 않는다(D17)` 한 줄(`set -e`라 실패하면 멈춘다).

Run: `cd ios && ./scripts/version-guard.sh; echo exit=$?; TF_ALLOW_PRE_MAIL=1 ./scripts/version-guard.sh; echo exit=$?; bash -n scripts/testflight.sh && echo syntax-ok`
Expected: 첫 실행 메시지 + `exit=1`(MailCleanup.swift 있음·0.13.0), 둘째 `version-guard ok (0.13.0)` + `exit=0`, `syntax-ok`.

- [ ] **Step 5: 빌드·회귀**

`pgrep -x deno`가 비었는지, `vm_stat | grep -E 'free|compressor'`를 본다.

Run: `cd ios && ./scripts/sim.sh gen && ./scripts/sim.sh build && ./scripts/sim.sh test`
Expected: BUILD SUCCEEDED, Swift 6 동시성 경고·오류 0, EruriCore 전체 0 실패. `addScopes`·`restorePreviousSignIn`의 async 판이 없다는 오류면 U8 — `withCheckedThrowingContinuation`으로 콜백판을 감싼다(같은 흐름).

자체 확인: `grep -n 'DiagLog.append\|Trace.log' ios/App/GoogleSignIn.swift | grep -i upgrade` — 코드·토큰·계정 값이 없다.

- [ ] **Step 6: 커밋**

```bash
git add ios/App/GoogleSignIn.swift ios/App/ContentView.swift ios/App/EruriApp.swift ios/scripts/version-guard.sh ios/scripts/testflight.sh
git commit -m "feat(ios): mail cleanup permission — Settings › Gmail shows Update permission only when the active connection's scopes lack modify (read separately, hidden before 0030) and upgrades via restore/addScopes without disconnect (one retry on a network error, copy from MailCleanupText only); SettingsRouter for chat's Open Settings; new connections ask readonly + modify; testflight.sh refuses to upload mail-cleanup code under a pre-0.14.0 version name (TF_ALLOW_PRE_MAIL=1 to override)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task M9b: 앱 채팅 복원 — 메일 정리 턴·카드·폴링·재개

**Files:**
- Create: `ios/App/MailCleanupAPI.swift`, `ios/App/MailCleanupCard.swift`
- Modify: `ios/App/ChatView.swift`(상태 두 줄, `syncClear`, 활성화 재개, 200 분기, 턴 행, 새 함수들)

**Interfaces:**
- Consumes: M8 전부(`executeIsDefinite`·`MailTurn.needsStatusRead`·`afterStatusRead` 포함), M9a `SettingsRouter`, M5 HTTP 계약, 0.13.0 `ChatView.send`(200 분기의 `add_event` 블록)·`settle(_:_:save:_:)`·`append(_:)`(새 턴으로 스크롤 포함, F28)·`syncClear()`·`scenePhase` 분기, `API.send`, `Trace.log`, `DiagLog`.
- Produces: 화면 식별자(M11 게이트가 쓴다) `mail-card`·`mail-conditions`·`mail-count`·`mail-execute`·`mail-cancel`·`mail-expired`·`mail-repreview`·`mail-progress`·`mail-result`·`mail-undo`·`mail-undo-expired`·`mail-next`·`mail-note`·`mail-open-settings`, trace `chat.mail`(`stage`·`result`·`code`·`count`·`method`·`elapsed_ms`). 커밋 메시지는 `feat(ios): mail cleanup chat`으로 시작한다(D17).

**상태 계약(D22):** 메일 정리 턴은 `needsStatusRead`이면 저장된 상태와 무관하게 서버를 먼저 읽는다(화면에 나올 때·앱 활성화). 실행 응답이 확정 코드가 아니면 문구 전에 토큰 상태를 읽는다. [다시 미리보기]도 옛 토큰이 실행됐는지 먼저 본다. 이 프로세스가 요청 중인 턴(`mailRequesting`)은 재개하지 않는다.

- [ ] **Step 1: 확인**

Run: `grep -n 'sources: \[App\]' ios/project.yml && grep -n 'ChatAddEvent.isAddEvent(a.intent)' ios/App/ChatView.swift && grep -n 'if let l = t.record.link {' ios/App/ChatView.swift && grep -n 'if p == .active {' ios/App/ChatView.swift && grep -n 'final class SettingsRouter' ios/App/ContentView.swift`
Expected: 다섯 줄 모두 있다(새 앱 파일은 `sources: [App]`로 자동 포함, 0.13.0의 `add_event` 분기와 턴 행 사슬, 활성화 분기, M9a 라우터). 없으면 0.13.0이 바뀐 것이라 그 모양에 맞춰 아래 삽입 위치를 고르고 보고에 적는다.

- [ ] **Step 2: 서버 호출·카드 파일**

`ios/App/MailCleanupAPI.swift`:

```swift
import Foundation
import EruriCore

/// 메일 정리 서버 호출(스펙 §7 "메일 정리", 0.14.0). 본문(조건)·응답(미리보기 글)은 로그에 남기지 않는다 — 호출부가 상태·개수·코드만 trace.
/// body 는 호출 직전에 JSON 객체로 만든 [String: Any](Swift 6: Task 경계를 넘기지 않는다 — 넘겨야 하면 Conditions/JSONValue 를 넘기고 여기서 변환)
enum MailCleanupAPI {
  static func preview(_ body: [String: Any]) async -> (status: Int, data: Data)? {
    await API.send("functions/v1/mail-action/preview", method: "POST", json: body, timeout: 60)
  }
  static func execute(token: String) async -> (status: Int, data: Data)? {
    await API.send("functions/v1/mail-action/execute", method: "POST", json: ["token": token], timeout: 20)
  }
  static func undo(id: String) async -> (status: Int, data: Data)? {
    await API.send("functions/v1/mail-action/undo", method: "POST", json: ["id": id], timeout: 30)
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
/// 실행 버튼이 곧 확인이다(확인창 없음). 시간 창(토큰 10분·되돌리기 7일)·연도 표기는 30초마다 다시 본다 — 서버가 원본(410)
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
          else if turn.phase == .running { ProgressView().accessibilityIdentifier("mail-progress") }   // 실행 요청 중·결과 확인 중(상태 전)
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
    Text(MailCleanup.conditionLine(p.conditions, now: now)).font(.footnote).accessibilityIdentifier("mail-conditions")
    Text(MailCleanup.countLine(p)).font(.footnote).foregroundStyle(.secondary).accessibilityIdentifier("mail-count")
    ForEach(Array(p.sample.enumerated()), id: \.offset) { Text(MailCleanup.sampleLine($0.element, now: now)).font(.caption).lineLimit(1) }
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
      if turn.phase == .running {
        ProgressView().accessibilityIdentifier("mail-progress")              // 되돌리기 요청 중(저장된 상태는 실행 결과)
      } else if turn.phase == .ended, let at = turn.previewAt {
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

- [ ] **Step 3: `ChatView` — 분기·행·상태·활성화**

(a) `@State private var openItem: String?` 줄 아래에 더한다:

```swift
  @State private var mailPolling: Set<UUID> = []       // 상태를 읽는 중인 메일 정리 턴(같은 턴을 두 Task 가 읽지 않게, 0.14.0)
  @State private var mailRequesting: Set<UUID> = []    // 실행·되돌리기·다시 미리보기 요청 중인 턴 — 재개(onAppear·활성화)가 끼어들지 않게(D22)
```

(b) `syncClear()`의 비우기 줄 끝에 `mailPolling = []; mailRequesting = []`를 더한다(`… openItem = nil; mailPolling = []; mailRequesting = []; loaded = true`).

(c) `.onChange(of: scenePhase)`의 `.active` 분기 끝(`refreshCalendars()` 뒤)에 `; resumeMailTurns()`를 더한다 — 화면에 안 보이는 진행 중 턴도 활성화 때 서버를 다시 읽는다(D22, Codex C4).

(d) `send`의 200 분기에서 0.13.0 `if ChatAddEvent.isAddEvent(a.intent) { … return }` 블록 바로 뒤에 넣는다:

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

(e) 턴 행: `if let l = t.record.link {` 줄 앞에 메일 정리 가지를 붙여 같은 if-else 사슬의 첫 가지로 만든다:

```swift
              if t.record.kind == .mailAction {                    // 메일 정리 턴(§9, 0.14.0): 카드 하나. 상태를 다시 읽어야 하는 턴은 나올 때 서버를 먼저 읽는다
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
  // ── 채팅 메일 정리(스펙 §9, 0.14.0). 모든 갱신은 id·epoch 로(settle) — await 뒤 색인으로 턴을 고치지 않는다. 미리보기 글은 기록에만, 로그·trace 는 개수·코드만.
  //    상태 계약(D22): 진행 중·끝나지 않은 턴은 서버를 먼저 읽는다, 결과를 모르면 토큰 상태를 읽기 전에 버튼·토큰을 버리지 않는다 ──

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

  /// [휴지통으로 이동]·[읽음 처리] = 확인. 누르는 즉시 버튼을 없앤다(서버도 같은 토큰은 한 번만).
  /// 확정 코드가 아니면(네트워크·5xx·401) 요청이 서버에 닿았을 수 있다 — 문구 전에 토큰 상태를 읽는다(N-H2)
  private func executeMail(_ id: UUID) {
    let epoch = log.clearCount
    guard let m = turns.first(where: { $0.id == id })?.record.mail, m.phase == .preview, let token = m.preview?.token,
          !mailRequesting.contains(id) else { return }
    mailRequesting.insert(id)
    settle(id, epoch) { $0.record.mail?.phase = .running; $0.record.mail?.note = nil }
    Task {
      defer { mailRequesting.remove(id) }
      let r = await MailCleanupAPI.execute(token: token)
      if let r, r.status == 200 || r.status == 202, let s = MailCleanup.status(r.data) {
        Trace.log("chat.mail", ["stage": "execute", "result": s.status, "count": s.total, "method": s.method ?? "-"])
        settle(id, epoch) { $0.record.mail?.status = s }
        pollMail(id, epoch: epoch)
        return
      }
      let code = r.flatMap { MailCleanup.errorCode($0.data) }
      Trace.log("chat.mail", ["stage": "execute", "result": "error", "code": code ?? "http_\(r?.status ?? -1)"])
      if let r, MailCleanup.executeIsDefinite(status: r.status) {               // 행이 바뀌지 않았다
        let n = MailCleanup.executeError(status: r.status, code: code)
        settle(id, epoch) {
          if n.repreview { $0.record.mail?.phase = .preview; $0.record.mail?.repreview = true }   // 카드가 "미리보기가 만료됐어요" + [다시 미리보기]
          else { $0.record.mail?.phase = .ended; $0.record.mail?.apply(n) }
        }
        return
      }
      await readBack(id, token: token, epoch: epoch)
    }
  }

  /// 결과를 모를 때(실행 응답을 못 받음·재개 때 상태 없음): 토큰 상태를 최대 2번 읽는다. previewed 면 실행되지 않은 것 — 버튼으로 돌린다.
  /// 그 밖이면 그 상태로 진행·결과를 잇는다. 둘 다 못 읽으면 진행 중으로 두고 "결과를 확인하는 중이에요" — 다시 열거나 활성화되면 다시 읽는다(D22)
  private func readBack(_ id: UUID, token: String, epoch: Int) async {
    for attempt in 0..<2 {
      if attempt > 0 { try? await Task.sleep(for: .seconds(2)) }
      guard let r = await MailCleanupAPI.status(id: token) else { continue }
      if r.status == 200, let s = MailCleanup.status(r.data) {
        Trace.log("chat.mail", ["stage": "status", "result": s.status])
        settle(id, epoch) { $0.record.mail?.afterStatusRead(s) }
        if !s.finished && s.status != "previewed" { pollMail(id, epoch: epoch) }
        return
      }
      if r.status == 404 {                                                        // 행이 없다(정리·출처 삭제) — 결과를 확인할 수 없다
        settle(id, epoch) { $0.record.mail?.phase = .ended; $0.record.mail?.note = MailCleanupText.unknownResult }
        return
      }
    }
    settle(id, epoch) { $0.record.mail?.note = MailCleanupText.checking }
  }

  /// [되돌리기](7일, 한 번): 성공한 메일만 서버 잡이 되돌린다. 결과 불명이면 저장된 상태로 폴링을 이어 서버 상태를 읽는다(GET 먼저)
  private func undoMail(_ id: UUID) {
    let epoch = log.clearCount
    guard let m = turns.first(where: { $0.id == id })?.record.mail, m.phase == .ended, let s = m.status,
          !mailRequesting.contains(id) else { return }
    let action = m.preview?.action ?? "trash"
    mailRequesting.insert(id)
    settle(id, epoch) { $0.record.mail?.phase = .running; $0.record.mail?.note = nil; $0.record.mail?.settings = false }
    Task {
      defer { mailRequesting.remove(id) }
      let r = await MailCleanupAPI.undo(id: s.id)
      let code = r.flatMap { MailCleanup.errorCode($0.data) }
      // 202·200 = 되돌리기 상태, 409 busy = 실행이 아직 진행 중 — 둘 다 본문 counts 로 폴링을 잇는다
      if let r, r.status == 200 || r.status == 202 || (r.status == 409 && code == "busy"), let n = MailCleanup.status(r.data) {
        Trace.log("chat.mail", ["stage": "undo", "result": n.status, "count": n.done, "method": n.method ?? "-"])
        settle(id, epoch) { $0.record.mail?.status = n }
        pollMail(id, epoch: epoch)
        return
      }
      Trace.log("chat.mail", ["stage": "undo", "result": "error", "code": code ?? "http_\(r?.status ?? -1)"])
      if let r, [400, 403, 404, 409, 410].contains(r.status) {                   // 확정: 행이 바뀌지 않았다([되돌리기]는 canUndo 대로 남는다)
        let n = MailCleanup.undoError(status: r.status, code: code, action: action)
        settle(id, epoch) { $0.record.mail?.phase = .ended; $0.record.mail?.apply(n) }
        return
      }
      pollMail(id, epoch: epoch)                                                  // 결과 불명: 서버 상태를 읽어 잇는다(실패하면 진행 중으로 남아 재개 때 다시)
    }
  }

  /// 상태를 읽는다(§9): **먼저 한 번 읽고**(저장된 상태와 무관 — 되돌리기 요청 직후 닫혔으면 저장된 것은 옛 실행 결과다, Codex C3), 끝나지 않았으면 3초마다.
  /// 지우기(epoch)·턴 소멸·끝난 상태에서 멈춘다. 20분 상한은 GET 뒤에 보고, 넘으면 진행 중 그대로 문구만 남긴다 — 다시 열거나 활성화되면 resumeMail 이 다시 읽는다(C4)
  private func pollMail(_ id: UUID, epoch: Int) {
    guard !mailPolling.contains(id), let sid = turns.first(where: { $0.id == id })?.record.mail?.status?.id else { return }
    mailPolling.insert(id)
    Task {
      defer { mailPolling.remove(id) }
      let started = Date()
      while log.clearCount == epoch, turns.contains(where: { $0.id == id }) {
        if let r = await MailCleanupAPI.status(id: sid) {
          if r.status == 404 {                                                    // 7일 정리·출처 삭제
            settle(id, epoch) { $0.record.mail?.phase = .ended; $0.record.mail?.note = MailCleanupText.unknownResult }
            return
          }
          if r.status == 200, let n = MailCleanup.status(r.data) {
            settle(id, epoch) { $0.record.mail?.afterStatusRead(n) }
            if n.finished || n.status == "previewed" {
              Trace.log("chat.mail", ["stage": n.undoPhase ? "undo" : "execute", "result": n.status, "count": n.undoPhase ? n.undone : n.done, "method": n.method ?? "-"])
              return
            }
          }
        }
        if Date().timeIntervalSince(started) > MailCleanup.pollLimit {
          settle(id, epoch) { $0.record.mail?.note = MailCleanupText.stillRunning }   // phase 는 running 그대로(needsStatusRead)
          return
        }
        try? await Task.sleep(for: MailCleanup.pollInterval)
      }
    }
  }

  /// 다시 열었을 때·활성화될 때(D22): 상태를 다시 읽어야 하는 턴(needsStatusRead)은 서버를 먼저 읽는다. 상태가 없으면(실행 응답 전에 닫힘) 토큰으로 묻는다.
  /// 이 프로세스가 요청 중인 턴은 건너뛴다(N-M14 — 재개가 요청 중인 턴의 버튼을 되살리지 않게)
  private func resumeMail(_ id: UUID) {
    let epoch = log.clearCount
    guard let m = turns.first(where: { $0.id == id })?.record.mail, m.needsStatusRead,
          !mailPolling.contains(id), !mailRequesting.contains(id) else { return }
    if m.status != nil { pollMail(id, epoch: epoch); return }
    guard let token = m.preview?.token else {
      settle(id, epoch) { $0.record.mail?.phase = .ended; $0.record.mail?.note = MailCleanupText.unknownResult }
      return
    }
    mailRequesting.insert(id)
    Task { defer { mailRequesting.remove(id) }; await readBack(id, token: token, epoch: epoch) }
  }
  private func resumeMailTurns() { for t in turns where t.record.mail?.needsStatusRead == true { resumeMail(t.id) } }

  /// [다시 미리보기](10분 지남·토큰이 없음): 옛 토큰이 그사이 실행됐는지 먼저 본다 — 실행된 턴을 새 미리보기로 덮어 [되돌리기]를 잃지 않게(N-H2).
  /// previewed·행 없음(404)이면 서버가 확정한 conditions 로 다시 받는다(D15). 상태를 못 읽으면 덮지 않는다
  private func repreviewMail(_ id: UUID) {
    let epoch = log.clearCount
    guard let m = turns.first(where: { $0.id == id })?.record.mail, let c = m.preview?.conditions, !mailRequesting.contains(id) else { return }
    mailRequesting.insert(id)
    settle(id, epoch) { $0.record.mail?.phase = .running; $0.record.mail?.note = nil }   // 확인 중(스피너)
    Task {
      defer { mailRequesting.remove(id) }
      if let token = m.preview?.token {
        guard let r = await MailCleanupAPI.status(id: token), r.status == 200 || r.status == 404 else {
          settle(id, epoch) { $0.record.mail?.phase = .preview; $0.record.mail?.note = MailCleanupText.failed }
          return
        }
        if r.status == 200, let s = MailCleanup.status(r.data), s.status != "previewed" {   // 그사이 실행됐다 — 그 결과로 잇는다
          settle(id, epoch) { $0.record.mail?.afterStatusRead(s) }
          if !s.finished { pollMail(id, epoch: epoch) }
          return
        }
      }
      settle(id, epoch) { $0.record.mail = MailTurn(phase: .finding) }
      previewMail(id, body: c.json, epoch: epoch)                                // Conditions(Sendable)를 잡고 여기서 본문을 만든다
    }
  }

  /// [다음 1,000건 보기]: 새 메일 정리 턴 — 앞 턴의 결과·[되돌리기]를 지우지 않는다(D15). append 가 새 턴으로 스크롤한다(F28). 맥락으로 가지 않는다
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

(`[String: Any]`는 `Sendable`이 아니다 — `repreviewMail`은 `Conditions`(Sendable)를 Task로 잡고 호출 직전에 `c.json`을 만든다. `previewMail(body:)`가 `[String: Any]`를 Task로 넘기는 곳에서 Swift 6가 sending 오류를 내면(미확인) `previewMail`이 `JSONValue`/`Conditions`를 받게 바꾸고 `MailCleanupAPI.preview` 안에서 변환한다 — Step 5 Expected.)

- [ ] **Step 5: 빌드·회귀**

`pgrep -x deno`가 비었는지, `vm_stat | grep -E 'free|compressor'`를 본다.

Run: `cd ios && ./scripts/sim.sh gen && ./scripts/sim.sh build`
Expected: BUILD SUCCEEDED, Swift 6 동시성 경고·오류 0. `[String: Any]`를 Task·`async` 경계로 넘기는 곳(`previewMail(body:)`·`repreviewMail`)에서 sending 오류가 나면(미확인) 위 괄호의 대비책대로 `Conditions`/`JSONValue`를 넘기고 호출 직전에 변환한다 — 흐름은 같다.

Run: `cd ios && ./scripts/sim.sh test`
Expected: EruriCore 전체 0 실패.

자체 확인(리뷰 확인 항목과 같다): `grep -n 'turns\[idx\]\|turns\[i\]' ios/App/ChatView.swift` — 새 함수에 `await` 뒤 색인 접근이 없다. `grep -n 'settle(' ios/App/ChatView.swift`에서 새 함수의 호출이 모두 epoch 인자를 넘긴다. `mail_action` 분기에 `record.reply =`가 없다. `grep -n 'MailTurn(phase: .finding)' ios/App/ChatView.swift` — `repreviewMail`에서는 상태 확인 뒤에만 나온다. `grep -n 'DiagLog.append\|Trace.log' ios/App/ChatView.swift | grep -i 'mail'` — 조건·발신자·제목 문자열 값이 없다.

- [ ] **Step 6: 커밋**

```bash
git add ios/App/MailCleanupAPI.swift ios/App/MailCleanupCard.swift ios/App/ChatView.swift
git commit -m "feat(ios): mail cleanup chat — a mail_action reply turns the question into a mail turn (reply not saved) and previews with the mail fields as-is; the card shows server-confirmed conditions (year on other-year dates), counts and top 20, the action button is the confirmation (gone on tap); a non-definite execute reply reads the token's status before any copy and only a still-previewed row gets the button back; turns that are running or hold an unfinished status always read the server first when shown or when the app becomes active, polling every 3 s and keeping the turn running past 20 minutes; re-preview checks the old token first so an executed turn keeps its undo; results offer a one-time undo within 7 days (a dead connection leaves it in place) and next 1,000 as a new turn

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task M10: 배포 — `0030` 적용 → 워커 → `mail-action`·`gmail-connect` → (chat) → 플래그 → `MAIL-deploy` (③c2 뒤)

**Files:**
- Move: `supabase/migrations-pending/0030_mail_cleanup.sql` → `supabase/migrations/`(`git mv`), `supabase/tests/_mail-sql.ts`의 `MIGRATION_0030` 경로
- Create: `supabase/scripts/smoke-mail.ts`
- Apply: 호스팅 DB `0030`, 배포 `worker`·`mail-action`·`gmail-connect`(M7이 `MAIL_SCHEMA`를 고쳤으면 `chat`도), secret `MAIL_ACTIONS=on`
- Modify: `docs/superpowers/phase1/gates.md`(`MAIL-server` 통과, `INTENT-eval` 근거에 chat 재배포·CTX-eval, `MAIL-deploy` 새 행)

**Interfaces:**
- Consumes: M1~M7 커밋(M4a·M4b 포함), U6b Step 3(기준 커밋 `B` 배포)·3b(0029 적용), M3 `mail-actions-db.test.ts`.
- Produces: 배포된 서버(M11·M12가 쓴다), `smoke-mail.ts`(배포 회귀 도구 — 커밋).

- [ ] **Step 1: 선행 확인(하나라도 없으면 멈춘다)**

Run: `grep -n '③c2\|PoC-6' docs/superpowers/phase1/gates.md | tail -3; grep -n 'UNS-server' docs/superpowers/phase1/gates.md; grep -n 'MAIL-server\|INTENT-eval' docs/superpowers/phase1/gates.md; supabase migration list 2>/dev/null | tail -4; ls supabase/migrations-pending/; date '+%F %H:%M %Z'; pgrep -x xcodebuild || echo none`
Expected: ③c2 완료 기록(10-08 15:00 KST 이후), `UNS-server` 행에 U6b 워커 배포 HEAD(= 메일 정리 M1 첫 커밋의 부모 `B` — D2; main HEAD로 배포됐으면 메일 정리 워커가 이미 나간 것이니 멈추고 메인에게)와 Step 3b "0029 적용" 기록, `INTENT-eval` mail 판정(M7) 통과, `MAIL-server` 대기 행, 원격 마이그레이션 목록 끝이 `0029`, `migrations-pending/`에 `0030_mail_cleanup.sql`만, 지금이 10-08 16:30 KST 이후(smoke의 chat 단계가 실호출 — Global Constraints), `none`. 메인에게 M2 ⑩b·다른 배포가 진행 중이 아님을 확인받는다.

- [ ] **Step 2: 전체 테스트(이제 호스팅 DB 사례 포함)**

Run: `deno test --allow-net --allow-env --allow-read --allow-write=/tmp --env-file=supabase/.env supabase/tests/ --ignore=supabase/tests/mail-actions-db.test.ts && deno check supabase/functions/{worker,mail-action,gmail-connect,chat,unsubscribe,gmail-webhook,ingest,account}/index.ts supabase/scripts/*.ts`
Expected: 0 실패(ignored 수는 직전 기록과 같음), 무오류. 실패가 이 계획과 무관하면 원인을 적고 메인에게 알린다 — 남의 행은 지우지 않는다.

- [ ] **Step 3: 호스팅 트랜잭션 DB 테스트 → `0030` 적용**

Run: `deno test --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/tests/mail-actions-db.test.ts`
Expected: `hosted: 0030 cases in one rolled-back transaction` 1 통과(단계 19 — 0030을 트랜잭션 하나 안에서 한 번만 적용, 사례마다 savepoint로 되감고 끝에서 롤백 — 아직 운영 DB에 없다). **그 수 초 동안 이 트랜잭션이 `connections`(열 추가 — ACCESS EXCLUSIVE)·`jobs`(트리거 — SHARE ROW EXCLUSIVE) 잠금을 쥐어 운영 수집·워커 클레임이 기다린다**(Fable N-M8 — 사례마다 적용하던 것을 한 번으로 줄였다). `lock_timeout` 3초에 걸리면(운영 잠금이 길다) 1분 뒤 한 번 더, 그래도면 멈추고 메인에게 알린다. 실패면 멈춘다(PGlite와 Supabase의 차이 — SQL을 고치고 M3 Step 5부터 다시, 권한 사례를 PGlite에서 건너뛰었으면 여기서 판정한다).

Run: `git mv supabase/migrations-pending/0030_mail_cleanup.sql supabase/migrations/ && sed -i '' 's#"../migrations-pending/0030_mail_cleanup.sql"#"../migrations/0030_mail_cleanup.sql"#' supabase/tests/_mail-sql.ts && rmdir supabase/migrations-pending 2>/dev/null; git status --short`
Expected: `R  …/0030_mail_cleanup.sql`·`M supabase/tests/_mail-sql.ts`만. `migrations-pending`에 다른 파일이 남았으면 `rmdir`이 실패하고 남는다 — 그대로 둔다.

Run: `supabase db push --dry-run`
Expected: 적용 대상이 `0030_mail_cleanup.sql` **하나뿐**. 다른 파일이 보이면 push하지 않고 멈춰 메인에게 알린다.

Run: `supabase db push --yes && deno test --allow-net --allow-env --allow-read --allow-write=/tmp --env-file=supabase/.env supabase/tests/mail-actions-db.test.ts supabase/tests/mail-sql.test.ts supabase/tests/unsub-db.test.ts supabase/tests/jobs-priority-db.test.ts supabase/tests/retention-db.test.ts`
Expected: 적용 성공, 테스트 전부 통과(이제 `mail-actions-db`는 배포본을 그대로 쓰고 롤백, PGlite는 옮긴 경로를 읽는다, 기존 우선순위·보관·광고 DB 테스트 회귀 없음). `cron.job`에 `mail-actions-purge-daily`(`53 4 * * *`). cron을 수동으로 돌리지 않는다. 0030은 추가형(새 표·함수·열·`mail-action` 전용 트리거)이라 아래 배포가 실패해도 되돌리지 않는다 — U6b 워커는 이 함수들을 부르지 않는다.

```bash
git add supabase/migrations/0030_mail_cleanup.sql supabase/tests/_mail-sql.ts
git commit -m "chore(db): move 0030 mail cleanup into supabase/migrations/ and apply it after ③c2 and U6b's 0029 (hosted rolled-back test passed first)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 4: 워커 배포·회귀**

U6b Step 3이 `UNS-server` 행에 적은 배포 HEAD(= 기준 커밋 `B` — 메일 정리 M1 첫 커밋의 부모, D2)를 `$U6B`로 둔다.

Run: `git diff --stat $U6B..HEAD -- supabase/functions/_shared supabase/functions/worker && git log --oneline $U6B..HEAD -- supabase/functions/_shared supabase/functions/worker`
Expected: 이 계획의 파일만 — `_shared/gmail.ts`(M2)·`_shared/mail-query.ts`(M1)·`_shared/gmail-jobs.ts`(M4a)·`worker/index.ts`·`worker/mail-action.ts`·`worker/mail-action-deps.ts`(M4b), 커밋은 이 계획의 M1·M2·M4a·M4b(+ 이 계획의 수정 커밋)만. 그 밖의 변경이 보이면 멈추고 메인에게 알린다(배포 귀속, D2). 수집 경로 변경은 M4a 커밋 하나다(`git show --stat <M4a>`) — 회귀가 깨지면 먼저 의심한다.

Run: `supabase functions deploy worker`
Expected: 성공. 배포 시각(KST)·HEAD·버전을 적는다.

Run: `deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/smoke-gate.ts && deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/gmail-gate.ts status`
Expected: `{"gate":"pass",…}`, dead `gmail-fetch`·`gmail-sync` 0, 연결 `active`(직전 값과 같은 꼴).

**회귀가 깨지면(되돌리기):** `smoke-gate` 실패이거나 dead > 0이면 `$U6B` worktree(`git worktree add --detach "$TMPDIR/mail-rollback" $U6B`)에서 `supabase functions deploy worker --project-ref "$(cat supabase/.temp/project-ref)"`(main 체크아웃에서 읽은 값)로 U6b 배포본을 다시 올리고 `smoke-gate`가 pass인지 본 뒤 멈춰 메인에게 알린다. 0030은 그대로 둔다(추가형). 이 계획의 나머지 Step은 하지 않는다.

관찰(게이트 아님): 다음 gmail-sync가 돈 뒤(Pub/Sub 또는 6시간 cron) `deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/sql.ts "select count(*) as rows, coalesce(sum(used),0) as used from gmail_units where user_id = \$1 and minute > now() - interval '1 hour'" "$ERURI_USER_ID"`로 수집 기록이 쌓이는지(숫자만) 본다. 0이어도 실패가 아니다(그 시간에 메일이 없었을 수 있다). `units_note_error` 로그 줄 수를 대시보드 worker 로그에서 센다(0이 기대).

- [ ] **Step 5: `mail-action`·`gmail-connect` 배포**

Run: `git log --oneline -8 -- supabase/functions/gmail-connect supabase/functions/mail-action && supabase functions deploy mail-action && supabase functions deploy gmail-connect`
Expected: 이 계획의 M5·M6 커밋만 새로 보이고, 두 배포 성공. **되돌리기:** `gmail-connect` 회귀(아래 smoke의 `upgrade_*`·기존 재연결 경로)가 깨지면 M6 직전 커밋(`git log --format=%h -1 --grep '^feat(server): gmail-connect permission update'`의 `^`) worktree에서 `gmail-connect`를 다시 배포하고 멈춘다. `mail-action`은 플래그를 켜기 전이라 사용자 경로가 없다(문제면 배포만 두고 멈춘다).

- [ ] **Step 5b: (M7이 `MAIL_SCHEMA`를 고쳤을 때만) chat 재배포**

`git diff --stat <M7 Step 1의 $A3>..HEAD -- supabase/functions/chat`가 0줄이면 이 Step을 건너뛰고 기록에 "chat 변경 없음"만 적는다. 줄이 있으면(M7 Step 4 커밋) 0.13.0 A3 Step과 같은 방식으로 배포한다 — 배포본 기준선 확인(`supabase functions download chat`이 `$A3`과 같은지) → `supabase functions deploy chat` → 다운로드 대조 0 diff → `smoke-chat.ts`를 `intents` 없이 한 번·`SMOKE_INTENTS=add_event`로 한 번(0.13.0 A3의 기대값 그대로). 실패하면 `$A3` worktree에서 chat을 다시 배포하고 멈춘다. 맥락 경로 회귀(CTX-eval)는 플래그를 켠 뒤 Step 6에서 함께 본다.

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
  // 토큰 없는 연결의 되돌리기: 함수가 갱신을 먼저 해 보고 409 — 행은 done 그대로(한 번뿐인 되돌리기가 소진되지 않는다, D3)
  const u1 = await call("mail-action/undo", { id: dn });
  check("undo_reauth_409", u1.status === 409 && u1.j?.error === "reauth_required", u1.status);
  const ust = await call(`mail-action/status?id=${dn}`);
  check("undo_row_untouched", ust.j?.status === "done" && ust.j?.undone === 0, ust.j?.status);
  const ujobs = await sb.from("jobs").select("id", { count: "exact", head: true }).eq("user_id", u.id).eq("kind", "mail-action").eq("payload->>id", dn);
  check("undo_no_job", ujobs.count === 0, ujobs.count);
  // 끊긴 연결: 실행도 행을 바꾸기 전에 409
  const dead = await seed(conn, ["smoke-8"]);
  await sb.from("connections").update({ status: "reauth_required" }).eq("id", conn).eq("user_id", u.id);
  const ex409 = await call("mail-action/execute", { token: dead });
  check("execute_reauth_409", ex409.status === 409 && ex409.j?.error === "reauth_required", ex409.status);
  check("execute_row_untouched", (await call(`mail-action/status?id=${dead}`)).j?.status === "previewed", "-");
  await sb.from("connections").update({ status: "active" }).eq("id", conn).eq("user_id", u.id);
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
    conn_jobs: conn ? await del("jobs", (b) => b.eq("user_id", u.id).eq("payload->>connection_id", conn)) : 0,   // cron 이 이 연결에 넣은 gmail-sync·watch 잡
    conn: conn ? await del("connections", (b) => b.eq("user_id", u.id).eq("id", conn)) : 0,      // mail_actions 는 cascade
  };
}
console.log(JSON.stringify({ smoke: failed ? "fail" : "pass", ...out }));
if (failed) Deno.exit(1);
```

Run: `supabase secrets set MAIL_ACTIONS=on && sleep 5 && deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/smoke-mail.ts`
Expected: `{"smoke":"pass", …, "cleanup":{…}}` — 모든 단계 `ok`, `cleanup.conn_jobs`는 숫자(cron이 이 연결에 넣은 `gmail-sync`·`gmail-watch` 잡까지 지운다). `chat_mail_action`만 실패하면(새 값이 아직 안 읽힘) 1분 뒤 한 번 더 돌리고, 그래도 `question`이면 `git diff <배포된 chat HEAD — Step 5b를 했으면 그 HEAD, 아니면 $A3>..HEAD -- supabase/functions/chat`이 비었는지 확인한 뒤 `supabase functions deploy chat`(같은 코드)으로 새 인스턴스를 띄우고 다시 돈다. 다른 단계가 실패하면 **`supabase secrets set MAIL_ACTIONS=off`** 로 되돌리고 멈춘다(0.13.0 앱은 `mail_action`을 보내지 않으므로 그동안 사용자 영향 없음).

맥락 경로 질문 회귀(필수 — 플래그가 켜지면 0.14.0 앱의 맥락 있는 질문은 `intents`에 `mail_action`을 싣고 `search_filters_ctx_intent`가 `mail` 칸까지 채운다, 선행 계획 D13·Fable N-M11):

Run: `EVAL_INTENTS=add_event,mail_action deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/eval-context.ts --runs 3 | tail -1`
Expected: `{"intents":["add_event","mail_action"],"gate":"pass", …}` — 0.12.0 `CTX-eval` 합격선 그대로(failures 0). 미달이면 `MAIL_ACTIONS=off`로 되돌리고(Step 5b를 했으면 chat도 `$A3`로) 실패 사례 id·miss 종류만 기록하고 멈춘다(메인 보고). 약 8분(실호출 창 밖).

- [ ] **Step 7: 기록·커밋**

`docs/superpowers/phase1/gates.md`: `MAIL-server` 행을 **통과**로 바꾸고 근거 끝에 `· 호스팅 트랜잭션 DB 19/19(<KST>, 적용 전 — 트랜잭션 하나·lock_timeout 3s), 적용 후 재실행 19/19`를 붙인다. `INTENT-eval` 행 근거 끝에 `· 0.14.0 배포 <KST>: chat <변경 없음|v<n> 재배포(다운로드 대조 0 diff, smoke-chat 두 번 같은 값)>, MAIL_ACTIONS=on 뒤 CTX-eval(intents add_event,mail_action) <summarize 줄>`을 붙인다. 새 행:

```
| MAIL-deploy | 메일 정리 배포 스모크(스펙 §15): 0030 적용, worker·mail-action·gmail-connect(·chat) 배포, MAIL_ACTIONS=on, smoke-mail(사용자 22) 전 단계(끊긴 연결의 실행·되돌리기 409와 행 불변 포함), 수집 회귀, 맥락 경로 회귀 | 통과 | <KST>. 0030 push <KST>(cron mail-actions-purge-daily). worker v<n>(HEAD <sha>, $U6B=<B> 이후 이 계획 M1·M2·M4a·M4b만) — smoke-gate pass, gmail-gate dead 0. mail-action v<n>·gmail-connect v<n>·chat <변경 없음|v<n>>. smoke-mail <JSON 한 줄>. CTX-eval(intents add_event,mail_action) <gate·failures>. gmail_units 관찰 <rows/used 또는 미관측>, units_note_error <n>줄 | | <날짜> |
```

```bash
git add supabase/scripts/smoke-mail.ts docs/superpowers/phase1/gates.md
git commit -m "docs(gates): MAIL-server pass (hosted rolled-back DB run added) and MAIL-deploy pass — 0030 applied after U6b, worker (only this plan's commits since U6b's base) then mail-action and gmail-connect deployed with collection regressions clean, MAIL_ACTIONS on, deploy smoke covers errors, token reuse and expiry, worker close without a token, dead-connection execute/undo refused with the row untouched, malformed upgrade, and intents gating; context-path questions pass CTX-eval with mail_action intents

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task M11: 시뮬레이터 게이트 `MAIL-sim` → 0.14.0

**Files:**
- Create(커밋 안 함, D19): `.context/gate0140/`(`seed.ts`·`inject.py`·`MailGate.swift.txt`·`cleanup.ts`·`expected.txt` + 가장 최근 게이트 하네스(`.context/gate0130/`, 없으면 `gate0120/`)에서 복사해 고친 `token.ts`·`inject.sh`·`drive.sh`·`diag.sh`·`GateHost.swift.txt`·`project.gate0140.yml.txt`·`udid`), 임시 `ios/project.gate0140.yml`·`ios/GateHostTests/`·`ios/GateUITests/`(끝나면 지운다)
- Modify: `ios/project.yml:13`(0.14.0 — 통과 뒤), `docs/superpowers/phase1/gates.md`(`MAIL-sim`)

**Interfaces:**
- Consumes: M9a·M9b 화면 식별자, M10 배포된 서버(사용자 23은 Google 계정이 없다 — 미리보기·되돌리기는 409, 실행은 워커가 `no_connection`으로 마감), 0.13.0 `ADD-sim` 통과.
- Produces: `MAIL-sim` 통과, `MARKETING_VERSION: 0.14.0` 커밋(M12 TestFlight).

**왜 이 게이트가 필요한가:** 테스트 사용자에게는 Gmail이 없어 실제 미리보기 목록을 만들 수 없다. 그래서 서버가 만들어 주는 경로(오류 문구·실행·되돌리기·재개)는 **배포된 서버 그대로** 돌리고, 미리보기 카드 자체는 서버 응답과 같은 모양을 대화 기록에 주입해 그린다. 실제 Gmail 목록·휴지통은 MAIL-real이 본다.

| G | 확인 | 방법 |
|---|---|---|
| G1 | Gmail 미연결 → "Gmail이 연결되어 있지 않아요" | 채팅(실호출) |
| G2 | readonly 연결 → "권한 업데이트가 필요해요" + [설정 열기] → 설정 탭·[권한 업데이트] 보임 | 채팅 |
| G3 | modify·토큰 없음 → 범위 없는 요청 "발신자·제목·기간·광고 중 하나" / 조건 있는 요청 "연결이 끊겼어요" | 채팅 |
| G4 | 주입 미리보기: 조건 줄·건수·버튼 문구·표본 → [휴지통으로 이동] → 버튼 바로 사라짐 → 진행 → 결과(성공 0, 권한(연결) 문구 + [설정 열기]), [되돌리기] 없음 | 주입 + 배포 서버·워커 |
| G5 | 10분 지난 미리보기 → "미리보기가 만료됐어요" + [다시 미리보기](실행 버튼 없음) → 다시 미리보기가 서버를 부름(409 문구) | 주입 |
| G6 | 결과(done 3) → [되돌리기] → 토큰 없는 연결이라 409 → "Gmail 연결이 끊겨 되돌리지 못했어요 — … 다시 연결한 뒤 되돌려 주세요" + [설정 열기], **[되돌리기]는 남고 서버 행은 `done` 그대로**(한 번뿐인 되돌리기가 소진되지 않는다, D3) | 주입 + 서버 |
| G7 | 앱을 새로 열 때 진행 중 턴이 상태를 다시 읽고, 서버가 끝나면 결과·[되돌리기]로 바뀜 | 주입 + 드라이버가 행을 done으로 |
| G7b | 되돌리기 요청 직후 닫힌 턴(주입 `phase: running` + 저장 상태 `done`, 서버 행은 `undone`)을 열면 저장된 상태가 아니라 서버를 먼저 읽어 "되돌렸어요", [되돌리기] 없음(Codex C3) | 주입 + 시드 |
| G7c | 이미 실행된 토큰의 미리보기 카드(주입 `phase: preview`, 서버 행 `done`)에서 [휴지통으로 이동] → 200 현재 상태 → 결과 "휴지통으로 3건 옮겼어요" + [되돌리기](결과 불명 다시 읽기와 같은 결과 경로, N-H2) | 주입 + 시드 |
| G8 | [다음 1,000건 보기] → 새 턴("다음 1,000건 보기")이 생기고 앞 카드의 [되돌리기]는 그대로 | 주입 + 서버 |
| G9 | [취소] → "취소했어요", 실행 버튼 없음, 서버 행은 previewed 그대로 | 주입 |
| G10 | 설정 [권한 업데이트]: readonly일 때만 보이고 modify·미연결이면 숨김 | 시드 |
| G11 | 기기 로그(eruri.log)에 합성 발신자·제목 0줄 | `diag.sh` |

- [ ] **Step 1: 선행 확인**

Run: `grep -n 'MAIL-deploy\|ADD-sim' docs/superpowers/phase1/gates.md; grep -n 'MARKETING_VERSION' ios/project.yml; pgrep -x deno || echo none; vm_stat | grep -E 'free|compressor'`
Expected: `MAIL-deploy` 통과, `ADD-sim` 통과, `MARKETING_VERSION: 0.13.0`, `none`. 실호출 창(Global Constraints) 밖인지 메인이 확인한다.

- [ ] **Step 2: 하네스 준비(가장 최근 게이트 하네스 복사)**

Run: `SRC=$(ls -d .context/gate0130 .context/gate0120 2>/dev/null | head -1); OLD=$(basename "$SRC"); echo "$SRC"; mkdir -p .context/gate0140/shots && cd .context/gate0140 && for f in token.ts inject.sh drive.sh diag.sh GateHost.swift.txt project.$OLD.yml.txt; do cp ../$OLD/$f .; done && mv project.$OLD.yml.txt project.gate0140.yml.txt && sed -i '' "s#$OLD#gate0140#g" inject.sh drive.sh diag.sh GateHost.swift.txt && sed -i '' -E 's/MARKETING_VERSION: 0\.1[0-9]\.[0-9]+/MARKETING_VERSION: 0.13.0/' project.gate0140.yml.txt && xcrun simctl create "ERURI gate0140" "iPhone 16 Pro" > udid && cat udid | wc -c`
Expected: 복사 원본 경로 한 줄(0.13.0 `gate0130`이 있으면 그것 — 0.13.0 하네스가 대화 기록·카드 주입을 이미 고쳤다), UDID 한 줄(37자 근처). `drive.sh`의 `-only-testing` 인자는 `GateUITests/MailGate/<test>` 형식으로 쓴다. `diag.sh`의 grep을 `"\] (CHAT |trace chat.mail)"`로 바꾼다. `drive.sh`가 `GATE:` 줄을 출력에 그대로 내는지 본다(아래 `got.txt`가 그 줄을 모은다).

`.context/gate0140/seed.ts`:

```ts
// MAIL-sim(임시, 커밋 안 함): 테스트 사용자 23 의 합성 Gmail 연결·메일 정리 행. 출력은 단계·상태·개수만
// 사용: seed.ts conn none|readonly|modify · seed.ts rows · seed.ts finish-r3 · seed.ts status <r1|r1old|r2|r3|r4|r5|r6|r7>
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
                r3: await mk(["g-8", "g-9", "g-10"]), r4: await mk(["g-11", "g-12", "g-13"]), r5: await mk(["g-14", "g-15", "g-16"]),
                r6: await mk(["g-17", "g-18", "g-19"]), r7: await mk(["g-20", "g-21", "g-22"]) };
  await sb.from("mail_actions").update({ created_at: new Date(Date.now() - 11 * 60_000).toISOString() }).eq("id", ids.r1old).eq("user_id", user);
  await done(ids.r2, ["g-5", "g-6", "g-7"]);
  await done(ids.r5, ["g-14", "g-15", "g-16"]);
  await done(ids.r7, ["g-20", "g-21", "g-22"]);                                                       // G7c: 이미 실행된 토큰
  await done(ids.r6, ["g-17", "g-18", "g-19"]);                                                       // G7b: 서버에서는 되돌리기까지 끝남
  await sb.from("mail_actions").update({ status: "undone", undo_cursor: 3, undone_at: now() }).eq("id", ids.r6).eq("user_id", user);
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
  m = {"settings": False, "repreview": False}; m.update(mail)
  return {"id": str(uuid.uuid4()).upper(), "at": at, "kind": "mailAction", "question": q, "linkDone": False, "linkSaved": False, "judged": {}, "mail": m}
C = {
  "g4": [turn(now - 30, {"phase": "preview", "preview": preview(ids["r1"]), "previewAt": now - 30})],
  "g5": [turn(now - 660, {"phase": "preview", "preview": preview(ids["r1old"]), "previewAt": now - 660})],
  "g6": [turn(now - 3600, {"phase": "ended", "preview": preview(ids["r2"]), "previewAt": now - 3600, "status": status(ids["r2"], "done", 3)})],
  "g7": [turn(now - 60, {"phase": "running", "preview": preview(ids["r3"]), "previewAt": now - 60, "status": status(ids["r3"], "pending")})],
  "g7b": [turn(now - 3600, {"phase": "running", "preview": preview(ids["r6"]), "previewAt": now - 3600, "status": status(ids["r6"], "done", 3)})],
  "g7c": [turn(now - 30, {"phase": "preview", "preview": preview(ids["r7"]), "previewAt": now - 30})],
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
    let reconnect = waitLabel("mail-note", "다시 연결한 뒤 되돌려 주세요", 30)
    log("G6 result=\(res) undoReconnect=\(reconnect) settings=\(first("mail-open-settings", 2) != nil) undoKept=\(first("mail-undo", 5) != nil)")
  }
  func test07_G7_resume() {
    launch()                                                  // 드라이버가 약 15초 뒤 r3 를 done 으로 바꾼다
    let prog = first("mail-progress", 20) != nil
    let res = waitLabel("mail-result", "휴지통으로 3건 옮겼어요", 60)
    log("G7 progressOnOpen=\(prog) resultAfterServerDone=\(res) undo=\(first("mail-undo", 5) != nil)")
  }
  func test07b_G7b_rereadAfterUndoRequest() {
    launch()                                                  // 저장된 상태는 done, 서버는 undone — 서버가 이겨야 한다
    let undone = waitLabel("mail-result", "되돌렸어요", 20)
    log("G7b undone=\(undone) undoHidden=\(id("mail-undo").count == 0)")
  }
  func test07c_G7c_executedToken() {
    launch()
    first("mail-execute", 20)?.tap()
    let res = waitLabel("mail-result", "휴지통으로 3건 옮겼어요", 30)
    log("G7c result=\(res) undo=\(first("mail-undo", 5) != nil)")
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
  jobs: await n(sb.from("jobs").delete({ count: "exact" }).eq("user_id", user).in("kind", ["mail-action", "gmail-sync", "gmail-watch", "gmail-fetch", "gmail-reauth"])),   // cron 이 합성 연결에 넣은 잡 포함(사용자 23 전용)
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
$G/inject.sh g7b; $G/drive.sh $T/test07b_G7b_rereadAfterUndoRequest
$G/inject.sh g7c; $G/drive.sh $T/test07c_G7c_executedToken
$G/inject.sh g8; $G/drive.sh $T/test08_G8_next
$G/inject.sh g9; $G/drive.sh $T/test09_G9_cancel; $S status r4; $S status r2
for m in modify readonly none; do $S conn $m; $G/inject.sh none; $G/drive.sh $T/test10_G10_settings; done
$G/diag.sh 40 | wc -l; L="$(xcrun simctl get_app_container "$(cat $G/udid)" com.picpal.eruri group.com.picpal.eruri)/eruri.log"; grep -c '합성상점\|합성 광고' "$L"
```

위 블록은 `{ …; } 2>&1 | tee "$G/run.log"`로 감싸 돌린다(출력에 글 없음 — 불리언·개수·상태만).

**판정은 사람이 눈으로 대조하지 않고 `diff`로 한다**(Codex C7 — XCUITest는 불리언을 출력만 하므로 테스트 성공이 게이트 통과가 아니다). `.context/gate0140/expected.txt`(순서 그대로):

```text
GATE: G1 note=true card=1
GATE: G2 note=true openSettings=true upgradeVisible=true
GATE: G3 needsTarget=true reauth=true
GATE: G4 cond=true count=true button=true samples=3 goneOnTap=true result=true perm=true settings=true undo=0
GATE: G5 expired=true executeHidden=true repreviewReauth=true
GATE: G6 result=true undoReconnect=true settings=true undoKept=true
GATE: G7 progressOnOpen=true resultAfterServerDone=true undo=true
GATE: G7b undone=true undoHidden=true
GATE: G7c result=true undo=true
GATE: G8 cardsBefore=1 after=2 newTurn=true reauth=true firstUndoKept=true
GATE: G9 cancelled=true executeGone=true
GATE: G10 upgradeVisible=false
GATE: G10 upgradeVisible=true
GATE: G10 upgradeVisible=false
```

Run: `grep -o 'GATE: .*' "$G/run.log" > "$G/got.txt"; diff "$G/expected.txt" "$G/got.txt" && echo GATE-DIFF-OK; grep -E '^(r4|r2) ' "$G/run.log"`
Expected: `GATE-DIFF-OK`(diff 0줄), `r4 previewed`(G9 — 취소는 서버를 부르지 않는다), `r2 done`(G6 — 409 뒤 서버 행 그대로). G11: `diag.sh` 줄 수 > 0(코드·개수 줄이 있다), 합성 문구 grep **0**.

diff가 0이 아니면 다른 줄만 본다:
- **G1·G2가 다르면(모델 의존):** 채팅 문장이 `mail_action`이 아니라 질문으로 갔을 수 있다 — 그 사례만 한 번 다시 돌린다(`$S conn …`부터). 그래도 다르면 실패로 적는다(M7 게이트 문장 m16이 3/3이었는데도 여기서 `question`이면 배포된 chat·플래그 문제 — 메인에게).
- **G3 `needsTarget=false`:** 모델이 범위를 채운 것 — 그 줄의 `mail-note` 대신 미리보기 카드가 떴는지 기록하고 "광고 메일 말고 받은편지함 메일 전부 휴지통에 버려줘"로 한 번 더. 그래도 false면 실패로 적고 메인에게(M7 m17이 3/3이었으면 배포본 확인).
- 그 밖: 실패 사례와 `GATE:` 줄만 적고, 앱 문제면 M9b(또는 M9a) 수정 커밋 → 그 사례만 다시. 서버 문제면 메인에게 알린다.

- [ ] **Step 5: 정리·기록·0.14.0**

Run: `deno run --allow-net --allow-env --allow-read --env-file=supabase/.env .context/gate0140/cleanup.ts && rm -rf ios/project.gate0140.yml ios/GateHostTests ios/GateUITests ios/EruriGate.xcodeproj ios/build-gate && xcrun simctl shutdown "$(cat .context/gate0140/udid)"; xcrun simctl delete "$(cat .context/gate0140/udid)"; git status --short`
Expected: 정리 JSON의 `left_rows: 0`, `git status`에 하네스 파일 없음(`.context/`는 gitignore), 전용 시뮬레이터 삭제. `.context/gate0140/`는 M12 probe 때문에 M12 끝까지 둔다.

`docs/superpowers/phase1/gates.md`에 행을 더한다:

```
| MAIL-sim | 0.14.0 채팅 메일 정리 시뮬레이터(스펙 §15): G1 미연결 · G2 권한 없음 → 설정 · G3 범위 없음·연결 끊김 · G4 주입 미리보기(조건 줄·건수·버튼·표본) → 실행(버튼 즉시 사라짐) → 권한(연결) 결과 · G5 만료 → 다시 미리보기(옛 토큰 확인 뒤) · G6 끊긴 연결의 되돌리기 409 — [되돌리기] 남음·행 불변 · G7 재실행 뒤 상태 다시 읽기 · G7b 되돌리기 요청 직후 닫힌 턴이 서버 상태를 먼저 읽음 · G7c 이미 실행된 토큰 → 결과 카드 · G8 다음 1,000건 = 새 턴 · G9 취소 · G10 [권한 업데이트] 표시 규칙 · G11 기기 로그 무본문 | 통과 | <KST>, 사용자 23, UDID 전용(삭제함), 배포본(worker v<n>·mail-action v<n>·chat v<n>). expected.txt diff 0(14줄), r4 previewed·r2 done. 재시도 <없음|G1·G2·G3 n회>. 정리 left_rows 0 | | <날짜> |
```

Run: `sed -i '' 's/MARKETING_VERSION: 0.13.0/MARKETING_VERSION: 0.14.0/' ios/project.yml && grep -n 'MARKETING_VERSION' ios/project.yml && cd ios && ./scripts/sim.sh gen && ./scripts/sim.sh build`
Expected: `MARKETING_VERSION: 0.14.0`, BUILD SUCCEEDED.

```bash
git add ios/project.yml docs/superpowers/phase1/gates.md
git commit -m "chore(ios): 0.14.0 — mail cleanup from chat (preview card, confirm by button, server job with progress, one-time undo within 7 days, next 1,000) and Gmail permission update in Settings; MAIL-sim pass (G1–G11 incl. reread-before-resume and executed-token cases on simulator against the deployed server, judged by diff against expected GATE lines)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task M12: TestFlight 0.14.0 → `MAIL-real`(실기기, 사용자 조작)

**Files:**
- Create(커밋 안 함): `.context/gate0140/probe.ts`, `.context/gate0140/ids-real.json`·`ids-control.json`(합성 메일 3통·대조 메일의 Gmail id — 끝나면 지운다)
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
// MAIL-real ⓪(임시, 커밋 안 함, 계획 D20): 실사용자 연결의 지금 토큰으로 제목 "[ERURI 테스트] 합성 n"·"[ERURI 대조] 합성 4" 합성 메일만 다룬다. 토큰·id·제목은 출력하지 않는다.
// ids     : 받은편지함의 오늘 온 안 읽은 합성 테스트 메일 id 를 파일로(읽기) — 서버 조립식처럼 단어마다 subject:, 옛 합성 메일이 섞이지 않게 is:unread newer_than:1d
// control : 같은 방식으로 대조 메일 id 를 파일로(읽기) — ① 수집 확인용
// probe   : 연결 scopes 에 modify 가 없을 때만, 그 3통에 batchModify(removeLabelIds UNREAD) 1회 → 상태·reason 만(권한이 없어 메일은 바뀌지 않는다)
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
const Q = { ids: 'in:inbox is:unread newer_than:1d subject:"ERURI" subject:"테스트" subject:"합성"',
            control: 'in:inbox is:unread newer_than:1d subject:"ERURI" subject:"대조" subject:"합성"' } as const;
if (Deno.args[0] === "ids" || Deno.args[0] === "control") {
  const which = Deno.args[0] as keyof typeof Q;
  const p = await api.list(Q[which], 10);
  const ids = (p.messages ?? []).map((m) => m.id);
  Deno.writeTextFileSync(D + (which === "ids" ? "ids-real.json" : "ids-control.json"), JSON.stringify(ids));
  console.log(JSON.stringify({ [which]: ids.length }));
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

Run: `deno run --allow-net --allow-env --allow-read --allow-write --env-file=supabase/.env .context/gate0140/probe.ts ids`
Expected: `{"ids":3}`. **3이 아니면(`need_3`) probe를 돌리지 않고 멈춘다** — 0이면 아직 도착 전(몇 분 뒤 다시), 4 이상이면 오늘 온 다른 합성 테스트 메일이 섞인 것이라 사용자에게 "제목이 `[ERURI 테스트]`인 이전 메일을 읽음 처리하거나 지워 주세요(새로 보낸 3통은 그대로)"를 부탁한 뒤 다시 센다. 3이 될 때까지 ②도 하지 않는다(미리보기 3건 판정이 성립하지 않는다).

Run: `deno run --allow-net --allow-env --allow-read --allow-write --env-file=supabase/.env .context/gate0140/probe.ts probe`
Expected: `{"probe":"rejected","status":403,"reasons":["insufficientPermissions",…]}`. `reasons`에 `SCOPE_REASONS`의 값이 있으면 U2(권한 쪽) 통과. 다른 값이면 M2 `SCOPE_REASONS`에 더하는 수정 → `mail-action`·worker 재배포 → 다시 probe. `skipped_already_modify`면(주간 재연결이 이미 modify를 붙였다) U2 권한 reason은 "측정 기회 없음 — 문서 근거로 수용"으로 적고 계속한다. `accepted`면 **멈춘다**(readonly 토큰이 쓰기를 통과 — 권한 판단이 틀렸다; 합성 3통이 읽음이 됐을 수 있으니 사용자에게 Gmail에서 안 읽음으로 되돌려 달라고 하고 메인에게 보고).

기준값(숫자·불리언만)을 남기고, 그 시각을 `$T1`(ISO)로 적는다:

Run: `T1=$(date -u +%FT%TZ); deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/sql.ts "select c.status, c.scopes @> array['https://www.googleapis.com/auth/gmail.modify'] as has_modify, c.expires_at, md5(s.cursor) as cursor_hash, s.last_success_at, (select count(*) from jobs j where j.user_id = c.user_id and j.kind = 'gmail-fetch' and j.payload->>'backfill' = 'true') as backfill_jobs from connections c join sync_states s on s.connection_id = c.id where c.user_id = \$1 and c.provider = 'gmail'" "$ERURI_USER_ID"`
Expected: 한 줄. `has_modify`(false가 보통 — `skipped_already_modify`면 true), `cursor_hash`(참고값 — 정상 sync가 돌면 바뀐다)·`last_success_at`·`backfill_jobs`를 적어 둔다(커서 값 자체는 보지 않는다).

**요청 1(권한 업데이트만):** 사용자에게: "설정 → Gmail → [권한 업데이트]를 눌러 Google 화면에서 허용해 주세요(버튼이 없으면 '없음'). 화면 아래에 나온 문구를 알려 주세요." — 대조 메일은 아직 보내지 않는다(그 메일의 정상 sync가 커서를 바꿔 불변 판정과 섞이지 않게, Fable N-M18).

판정 ①(U3) — 문구를 받은 뒤 위 SQL을 다시 돌린다:
- 문구 "Gmail 권한을 업데이트했어요" → `status = active`, `has_modify = true`, `expires_at`가 지금 + 약 7일, **`$T1` 이후 그 사용자의 백필 `gmail-fetch` 잡 생성 0**(`select count(*) from jobs where user_id = $1 and kind = 'gmail-fetch' and payload->>'backfill' = 'true' and created_at >= $2` — 재연결 경로(`gmail_save_connection`)를 타지 않았다)이면 통과. `cursor_hash`는 참고로만 적는다(같으면 "커서 불변", 다르면 그 사이 정상 sync가 돈 것 — `last_success_at`이 `$T1` 뒤인지 함께 적는다). 이어서 아래 **요청 2**로 동기화가 새 토큰으로 이어지는지 본다.
- 문구 "Google이 새 권한을 아직 주지 않았어요…" → `status`·`has_modify = false`·`$T1` 이후 백필 잡 0(연결 불변)을 확인하고 U3을 **대기**로 적는다 — 판정은 다음 주간 재연결(readonly + modify 요청) 뒤. 이 경우 ②~⑤는 그 재연결 뒤로 미룬다(modify 없이는 성립하지 않는다 — memory "테스트 시나리오는 인과관계·필요성 먼저"). 재개 기한은 그 연결의 `connections.expires_at`(주간 재연결 알림 시각) — 메인이 사용자에게 "재연결 알림이 오면 재연결 뒤 이어서 할지, 오늘 설정 › Gmail [다시 연결]로 바로 할지" 한 줄로 묻는다(후자는 커서·백필이 주간 재연결과 같다 — D13).
- 버튼 없음(이미 modify) → U3 "해당 없음(주간 재연결이 먼저 붙임)", 요청 2로.
- 그 밖 문구(계정 불일치·체크 안 함·실패) → 문구만 적고 사용자와 한 번 더, 그래도 실패면 멈추고 메인에게.

**요청 2(대조 메일·동기화 관측):** 사용자에게: "다른 계정에서 제목 `[ERURI 대조] 합성 4` 메일을 하나 더 보내고 읽지 말고 두세요. 도착하면 알려 주세요." 도착 알림 뒤:

Run: `deno run --allow-net --allow-env --allow-read --allow-write --env-file=supabase/.env .context/gate0140/probe.ts control && deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/sql.ts "select (select count(*) from items where user_id = \$1 and idempotency_key = any(\$2::text[])) as control_items, (select last_success_at > \$3::timestamptz from sync_states s join connections c on c.id = s.connection_id where c.user_id = \$1 and c.provider = 'gmail') as synced_after_t1" "$ERURI_USER_ID" "$(deno eval 'console.log("{" + JSON.parse(Deno.readTextFileSync(".context/gate0140/ids-control.json")).map((i) => "gmail:" + i).join(",") + "}")')" "$T1"`
Expected: `{"control":1}` 뒤 5분 안에(1분 간격으로 다시) `control_items = 1`, `synced_after_t1 = true` — **대조 메일 그 자체가 새 토큰으로 수집됐다**(Codex C6 — "최근 items ≥ 1"은 다른 메일로도 참이 된다). 5분이 지나도 0이면 `gmail-gate.ts status`로 sync 잡 상태(dead·reauth)를 보고 메인에게 알린다(6시간 cron까지 기다리지 않는다). 대조 메일이 광고로 분류돼 버려졌으면(`control_items = 0`인데 sync는 돌았다) — 합성 문구라 드물다 — `gmail-fetch` 잡 중 그 id가 든 잡이 `done`인지로 대신 판정하고 적는다.

- [ ] **Step 5: ② 휴지통(U1·U6) → ③ 새 items 0(U4)**

시작 시각을 `$T2`(ISO)로 적는다. 사용자에게: "채팅에 '제목에 ERURI 테스트 들어간 메일 휴지통으로 보내줘'라고 보내 주세요. 카드의 조건 줄과 건수 줄을 그대로 알려 주세요(합성 문구라 괜찮아요). **건수가 3건이고 아래 목록 3줄이 모두 `[ERURI 테스트] 합성 1~3`일 때만** [휴지통으로 이동 (3건)]을 누르고 결과 문구를 알려 주세요 — 하나라도 다르면 누르지 말고 알려 주세요. 그다음 Gmail 앱에서 휴지통에 합성 1~3이 있는지, 받은편지함에 대조 메일이 그대로 있는지 봐 주세요."

판정 ②: 조건 줄이 `제목 'ERURI' '테스트' · 별표 제외`(서버가 정제한 칸 — 대괄호는 지워진다)이고 건수 `3건`·표본 3줄이 합성 1~3(U6 통과 — 0건이면 U6 실패: 멈추고 메인에게. 3도 0도 아니거나 표본에 다른 메일이 있으면 누르지 않았는지 확인하고 멈춰 메인에게 — 검색 조립·옛 합성 메일 문제를 먼저 본다), 결과 "휴지통으로 3건 옮겼어요", Gmail 휴지통에 3통·대조 메일 받은편지함.

Run: `deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/sql.ts "select status, method, cardinality(ok_ids) as ok, cardinality(failed_ids) as failed, executed_at from mail_actions where user_id = \$1 order by created_at desc limit 1" "$ERURI_USER_ID"`
Expected: **`status = done`이고 `method = batch`면 U1 통과(batchModify TRASH 동작)** — `method`만으로는 증거가 아니다(`setMethod("batch")`는 호출 전에 기록된다). `done`이고 `single`이면 **"건별 폴백"** — 결과는 같지만 스펙 §7대로 1차 batch 시도를 빼는 수정 태스크를 메인이 만든다(이 게이트는 통과로 적는다 — 기능은 동작했다). `executed_at`을 `$E2`로 적는다. 워커 로그의 `done` 줄 `elapsed_ms`(1,000건이 아니라 3건이지만 batch 한 번의 응답 시간)를 참고로 적는다.

판정 ③(U4) — **동기화가 실행 뒤에 실제로 돈 것을 본 다음에만** 판정한다(Codex C6 — sync가 안 돌았으면 "재수집 0"은 아무것도 증명하지 않는다):

Run: `deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/sql.ts "select s.last_success_at > \$2::timestamptz as synced_after_exec from sync_states s join connections c on c.id = s.connection_id where c.user_id = \$1 and c.provider = 'gmail'" "$ERURI_USER_ID" "$E2"`
Expected: `true`(실행 뒤 history 구간을 처리했다 — `gmail_update`가 커서를 받을 때만 `last_success_at`을 갱신한다, F26). 5분 안에 `false`면 사용자에게 "아무 계정에서 본인 Gmail로 메일 하나만 더 보내 주세요(제목 자유, 읽어도 됩니다)"를 부탁해 sync를 일으키고 다시 본다. 그래도 false면 `gmail-gate.ts status`로 sync 잡을 보고 메인에게 알린다(③은 **대기**).

Run: `deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/sql.ts "select count(*) as n from jobs where user_id = \$1 and kind = 'gmail-fetch' and created_at >= \$2 and payload->'ids' ?| \$3::text[]" "$ERURI_USER_ID" "$T2" "$(deno eval 'console.log("{" + JSON.parse(Deno.readTextFileSync(".context/gate0140/ids-real.json")).join(",") + "}")')"`
Expected: `n = 0`(휴지통 이동·이후 되돌리기가 그 3통을 새 메일로 다시 가져오지 않았다 — done 잡을 지우는 cron은 없으므로 `$T2` 이후 잡이 그대로 남아 있다, F26. 이 확인은 ④·⑤ 뒤에 sync 관측과 함께 한 번 더 돌린다). 1 이상이면 U4 실패 — 멱등 키로 항목은 늘지 않았는지(`select count(*) from items where user_id=$1 and idempotency_key = any(…)` = 3) 함께 적고 메인에게.

- [ ] **Step 6: ④ 되돌리기(U5) → ⑤ 읽음 → 되돌리기**

사용자에게: "방금 카드의 [되돌리기]를 누르고 결과 문구를 알려 주세요. Gmail 받은편지함에 합성 1~3이 다시 보이는지 봐 주세요. 그다음 채팅에 '제목에 ERURI 테스트 들어간 안 읽은 메일 읽음 처리해줘'라고 보내고, **건수가 3건이고 목록 3줄이 모두 `[ERURI 테스트] 합성 1~3`일 때만** [읽음 처리 (3건)]을 누른 뒤(아니면 누르지 말고 알려 주세요) Gmail에서 합성 1~3이 읽음이고 대조 메일은 안 읽음인지 봐 주세요. 마지막으로 그 카드의 [되돌리기]를 누르고 합성 1~3이 다시 안 읽음이 됐는지, 대조 메일이 받은편지함·안 읽음 그대로인지 알려 주세요."

판정 ④(U5): 결과 "되돌렸어요" + 받은편지함에 3통 → 통과. 휴지통에서는 빠졌는데 받은편지함에 안 보이면 U5 실패 → 되돌리기(휴지통)에 `addLabelIds: ["INBOX"]`를 더하는 수정(M4b `opFor`의 휴지통 undo 두 줄 + 테스트) → 워커 재배포 → 사용자가 Gmail에서 3통을 받은편지함으로 옮긴 뒤 ②·④만 다시.
판정 ⑤: 미리보기 3건·표본 3줄이 합성 1~3(대조 없음 — 아니면 누르지 않았는지 확인하고 멈춰 메인에게), 결과 "3건을 읽음으로 바꿨어요", 되돌리기 "되돌렸어요", 마지막 대조 메일 받은편지함·안 읽음.

Step 5의 판정 ③ 두 SQL을 다시 돌린다 — `$E2` 대신 마지막 되돌리기의 `undone_at`(`select undone_at from mail_actions where user_id = $1 order by created_at desc limit 1`)으로 `synced_after_exec = true`를 본 뒤 `n = 0`.

- [ ] **Step 7: 기록·정리·커밋**

`docs/superpowers/poc/results.md` 끝에 절을 더한다:

```
## MAIL-real (메일 정리 0.14.0, <날짜>)

| 단계 | 전제 | 판정 | 근거(개수·코드만) |
|---|---|---|---|
| ⓪ probe | U2 403 권한 reason | <통과|측정 기회 없음> | status <n>, reasons <코드> |
| ① 권한 업데이트 | U3 addScopes → 새 serverAuthCode·refresh token, 연결·백필 불변(재연결 경로 안 탐), 동기화 지속 | <통과|대기|해당 없음> | 문구 <…>, has_modify <b>, $T1 이후 백필 잡 0 <b>, cursor 같음 <b>(참고), 대조 메일 id 수집 <n>·synced_after_t1 <b> |
| ② 휴지통 | U1 batchModify TRASH / U6 한글 제목 검색 | <통과(batch)|통과(건별 폴백)> | 조건 줄 일치 <b>, 3건·표본 합성 1~3 <b>, status done·method <…>, 대조 받은편지함 <b>, elapsed_ms <n> |
| ③ 동기화 | U4 휴지통·되돌리기가 새 메일로 오지 않음(sync 관측 뒤) | <통과|실패|대기> | synced_after_exec <b>(②·⑤ 뒤), gmail-fetch 잡 중 3통 id 포함 <n>(두 번) |
| ④ 되돌리기 | U5 INBOX 복원 | <통과|실패→수정> | 결과 문구, 받은편지함 3통 <b> |
| ⑤ 읽음·되돌리기 | 읽음은 조건 메일만, 되돌리기 정확 | <통과|실패> | 3건, 대조 안 읽음 <b> |
```

`docs/superpowers/phase1/gates.md`에 행:

```
| MAIL-real | 메일 정리 실기기(스펙 §15): ⓪ probe · ① 권한 업데이트(재연결 경로 안 탐·대조 메일 수집) · ② 휴지통 3통 · ③ sync 관측 뒤 새 items 0 · ④ 되돌리기 INBOX · ⑤ 읽음·되돌리기, 대조 메일 불변 | <통과|대기> | <KST>, TestFlight 0.14.0 (<빌드>). results.md MAIL-real 절. U1 <batch(done)|건별>, U2 <…>, U3 <…>, U4 0(sync 관측), U5 <…>, U6 3건 | | <날짜> |
```

U1이 "건별 폴백"이거나 U5가 INBOX 추가로 고쳐졌으면 스펙 §7 해당 문장("어느 쪽이 되는지는 MAIL-real 첫 단계가 판정…", "INBOX 라벨 복원은 MAIL-real에서 본다")을 판정 결과로 바꾼다.

Run: `rm -f .context/gate0140/ids-real.json .context/gate0140/ids-control.json .context/gate0140/rt && rm -rf .context/gate0140 && git status --short`
Expected: 하네스가 지워지고 `git status`에 하네스 파일 없음. 사용자에게 합성 메일 4통은 직접 지워도 된다고 알린다(서버는 지우지 않는다 — 영구 삭제 없음).

```bash
git add docs/superpowers/poc/results.md docs/superpowers/phase1/gates.md   # 스펙을 고쳤으면 docs/superpowers/specs/2026-09-22-assistant-design.md 도
git commit -m "docs(gates): MAIL-real — permission reason probe, permission update keeps the connection and cursor, three synthetic mails trashed and restored to the inbox, no re-collection, read and undo exact, control mail untouched (method and step verdicts in results.md)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## 자체 점검 (2026-10-06, 리뷰 반영 뒤 다시)

- **스펙 대조(§7 "메일 정리" 문장마다):** 무엇(휴지통·읽음만, 보관함 그대로) → M4b(보관함 RPC 없음 테스트)·M2(영구 삭제 없음 grep). 켜기(`MAIL_ACTIONS`·③c2 뒤·U6b 기준 커밋 배포) → M5 `enabled`·M10 Step 6·Global Constraints·D2·M0 Step 6. 지목(정해진 칸·서버 조립·`in:inbox -is:starred`·정제(멱등)·거절(기호만·2004년 전 포함)·범위 하한) → M1·D21. 미리보기(권한 → 연결 → 칸 → list 500 × ≤5 → 1,000 → 별표 추정 → 20 표본 → 행 = 토큰, `conditions`, exact/추정, 표시(다른 해 연도), 미리보기 글 비저장, 비용 기록, 25초 예산) → M5·M8·M9b. 실행(지속 잡·한 트랜잭션·202·같은 토큰 200·미리보기 id만·끊긴 연결 409) → M3 `mail_action_start`·M5. 상태 전이 → M3. id별 결과·커서 → M3 progress·M4b. 결과 불명·재개(진행 뒤 미루기)·마지막 시도 재조회(쿼터 미루기)·dead 트리거·남은 id 없는 마감 → M3·M4b. lease·예산 → M3(lease)·M4b(25초, 호출 직전마다). 읽음·휴지통·폴백(400·404)·method → M4b·D9. reason 분기 → M2 `classifyGmailError`·M4b·M5. 토큰 `invalid_grant`(실행 마감·되돌리기 되살림) → M3 finish·M4b·M5·D11. 속도(units 합산, 기록 fail-open) → M3·M4a D6. 진행·결과 status → M3 counts·M5·M9b. 되돌리기(ok_ids만·7일·상태 규칙·한 번·끊긴 연결 409) → M3·M4b·M5·M9b. 동기화와의 관계 → F1·U4·MAIL-real ③(sync 관측 뒤). 권한 업데이트(scopes·[권한 업데이트]·upgrade 순서·active만·readonly+modify·revoke 금지·불변·코드 없을 때 안내·새 연결 readonly + modify·0.14.0 전 업로드 가드) → M3·M6·M9a·D12·D13·D16·D17. 보관(7일·1시간·cascade·`job_lost` 안전망) → M3 purge·cascade 사례. 감사(개수만) → M3 finish. 진단(trace `chat.mail`) → M9b.
- **스펙 §9:** 의도·하위 호환(0.13.0 그대로, `intents`에 `mail_action` 추가) → M8 `ChatAddEvent.intents`·M10 smoke `chat_*`·CTX-eval. 채팅 메일 정리 카드·문구(연도·결과 불명·되살린 되돌리기·`job_dead`)·대화 기록·맥락 제외·재개 계약 → M8·M9b·M11(G7·G7b·G7c). **§12:** 서버 저장 범위·미리보기 글 기기만·LLM에 메타 안 감·검색어 서버 조립·함수 권한 → M3 열·권한 사례·M5 로그 테스트·M1. **§15:** 서버 테스트 항목 전부 → M1~M6(아래 대조), MAIL-real ⓪~⑤ → M12, INTENT-eval mail 판정(게이트 문장 4개 포함) → M7.
- **§15 서버 테스트 목록 대조:** 검색어 조립·`OR`·괄호·콜론·범위 하한·검색어 문자열 무시 → M1. 1,000개 다중 페이지·exact → M5 paging. 토큰 10분·한 번만·남의 토큰·미리보기 id만 → M3 사례 1·2·M5 execute. 잘못된 칸 400·행/검색 없음 → M1·M5. conditions = 실제 검색어 → M5 preview(쿼리·conditions 동시 확인). TRASH 400(·404) 폴백·403 쿼터 미루기·403 권한 failed → M4b. 같은 토큰 두 번 → M3·M5·M10. 중간 실패 ok/failed·되돌리기 ok만 → M3 사례·M4b. Gmail 성공 뒤 기록 전 죽음(batch·건별 묶음 도중) → M4b. 결과 불명 5회 → M4b last attempt + 진행 뒤 미루기·흩어진 오류. dead → M3. 되돌리기 상태 규칙 → M3 사례·M5. `gmail_take_units` 5,400/4,000 → M3. `scope_missing`·`no_connection` → M5. 플래그 꺼짐·`intents` 없음 → M5 disabled·M10 chat. 제목·발신자 없음 → M3 열 사례. 권한 업데이트 계정 불일치·불변·revoke 0·끊긴 연결 → M6·M3.
- **이름 일치:** `checkConditions`·`buildQuery`·`YEAR_MIN`(M1 → M5), `GmailMailApi`·`classifyGmailError`·`GMAIL_MODIFY_SCOPE`·`MAIL_CALL_TIMEOUT_MS`·`refreshAccessToken(rt, timeoutMs)`(M2 → M4b·M5·M6·M12), RPC 이름·인자(M3 표 ↔ M4b deps ↔ M5 deps ↔ M6 handler ↔ M10 smoke ↔ M11 seed ↔ M12 probe), `gmailAccessToken`·`noteGmailUnits`(M4a → M4b·M5), HTTP 응답 키(M5 `COUNT_KEYS` ↔ M8 `Status` ↔ M3 `mail_action_counts`), 오류 코드 `undo_reauth_required`·`undo_no_connection`·`job_lost`(M3 ↔ M8 `result` ↔ M0 §8·§9), `MailActionDeps.now`(M5 handler ↔ deps ↔ 테스트 가짜), `MailTurn.needsStatusRead`·`afterStatusRead`·`MailCleanup.executeIsDefinite`·`needsUpgrade(rows:)`(M8 ↔ M9a·M9b), `SettingsRouter`(M9a ↔ M9b), 화면 식별자(M9a·M9b ↔ M11), 게이트 문장 id `m16`~`m19`(M7 ↔ M0 (f2)·M11 G1·G3·M12 ②⑤), 커밋 접두 `feat(core): mail cleanup`(M8 ↔ M0 Step 6 ↔ D17·`version-guard.sh`), `feat(ios): mail cleanup permission`·`… chat`(M9a·M9b ↔ D17), `feat(server): gmail-connect permission update`(M6 ↔ M10 Step 5 되돌리기).
- **테스트 수:** mail-query 12 · gmail-mail 6 · mail-sql(PGlite) 19 · units 6 · mail-jobs 22 · mail-action 19 · hosted 1(단계 19) — 각 Step Expected와 같다.
- **자리표시자:** 코드 단계는 모두 실제 코드. `<KST>`·`<n>`·`<sha>` 같은 꺾쇠는 `gates.md`·`results.md`에 실행 때 채우는 실측값 칸이다. M0의 스펙 수정은 앵커 문장과 넣을 문장을 그대로 적었다(앵커는 2026-10-06 스펙 본문에서 한 번씩만 나오는 것을 확인 — 리뷰 반영 때 대조).
- **알려진 한계(계획에 적음):** 쿼터 403 reason은 실측하지 않는다(D20·스펙 §16 수용). 실행 1회 25초 예산이라 건별 폴백 1,000건은 여러 워커 호출에 걸친다(units 상한이 어차피 분당 200건). 수집 경로 units 기록은 10통 단위라 분 경계에서 조금 어긋날 수 있다(연성 상한 — reason 분기가 받친다). 미리보기 0건은 행을 만들지 않아 감사·trace에만 남는다. 테스트 사용자에게 Gmail이 없어 시뮬레이터 게이트의 미리보기 카드는 주입한다(실제 목록은 MAIL-real). 잡이 토큰을 처음 못 얻은 되돌리기는 진행 0일 때만 되살린다(진행 뒤 연결이 끊기면 남은 것은 되돌리기 실패 — 드물다). 결과 불명 실행의 상태 GET도 실패하면 진행 중으로 남아 다음 열기·활성화 때 읽는다.

## 외부 리뷰 반영

계획 @ `5c3641b` 리뷰: Codex(`gpt-6-astra`, `.context/codex-review-mail-cleanup.out.md` — HIGH 2·MED 4·LOW 1 + 태스크 분할 제안), Fable(`.context/fable-review-mail-cleanup.md` — Codex 판정 + 놓친 것 HIGH 4·MED 19·LOW). 둘이 다르면 Fable 판정을 따랐다. 메인 판정(2026-10-06): (a) 휴지통 batch 404 건별 채택 (b) M7은 코드·로컬 판정까지, chat 재배포는 M10 — Global Constraints 158행 유지 (c) 받은 기간 한쪽 끝으로 범위 하한 충족 수용 (d) 태스크는 커밋·리뷰 단위만 분리(M4a/M4b, M9a/M9b) (e) U6b Step 3 워커 배포는 M1 첫 커밋의 부모 worktree. 스펙 §16 반영은 M0 Step 5가 소절 "외부 리뷰 반영 (메일 정리 계획, …)"을 넣는다.

| # | 출처·심각도 | 지적 | 반영 | 어디에·이유 |
|---|---|---|---|---|
| C1 | Codex HIGH | M4 건별 20건·재조회에 시간 검사 없음 — Edge 벽시계 초과 | 반영 | M4b `singles`·`lookup`이 Gmail 호출 직전마다 `over()`, 넘으면 처리한 만큼 `progress` 뒤 `Deferred(mail_budget)`. `t0` 첫 줄·예산 25초·토큰 갱신 15초(D7). 테스트 "budget … every single call"·"every reread call" |
| C2 | Codex HIGH | U6b Step 3가 main HEAD 워커를 배포 — 메일 정리 워커 동반 배포·diff 검사 정지 | 반영 | D2·M0 Step 6 (a): U6b Step 3 diff·배포·회귀를 M1 첫 커밋의 부모 `B` worktree에서, `UNS-server` HEAD = `B` = M10 `$U6B`. M10 Step 1·4가 확인 |
| C3 | Codex MED | 되돌리기 직후 종료 → 저장된 done 때문에 GET 없이 끝남 | 반영 | D22·M8 `MailTurn.needsStatusRead`(running이면 참)·M9b `pollMail`이 첫 GET 먼저. M11 G7b |
| C4 | Codex MED | 20분 뒤 `.ended` → 재개 조건에서 빠져 다시 읽지 않음 | 반영 | 20분 상한은 GET 뒤·phase 유지·문구만(M9b `pollMail`), `scenePhase == .active`에서 `resumeMailTurns`, `needsStatusRead`(끝나지 않은 상태) |
| C5 | Codex MED | 가짜 `take: (u)`가 사용자 문자열을 units로 받음 | 반영 | M4b 하네스 `take: (_user, units)`, 옵션 `take?: (units) => boolean` |
| C6 | Codex MED | MAIL-real 동기화 미관측 통과(최근 items ≥1, fetch 0) | 반영 | M12 ①: 대조 메일 id(`probe.ts control`)의 `gmail:<id>` 항목 = 1 + `last_success_at > $T1`. ③: `last_success_at > executed_at`(F26 — `gmail_update` 확인) 뒤에만 n = 0 판정, 5분 안에 없으면 메일 1통으로 sync 유도 |
| C7 | Codex LOW | XCUITest가 불리언 출력만 — 테스트 성공 ≠ 게이트 통과 | 반영(대안) | M11 `expected.txt` + `diff`(Fable 단순 대안 — 시드별 단언보다 유지가 쉽다) |
| C8 | Codex 제안 | M4 → 수집 계측/실행 복구, M9 → 권한 UI/채팅 복원 분할 | 부분(Fable 판정) | 커밋·리뷰 단위만 분리(M4a/M4b, M9a/M9b) — 같은 pane·순차(deno·xcodebuild 동시 금지). M10 Step 4가 M4a(수집 경로)를 따로 본다 |
| N-H1 | Fable HIGH | 연결 만료 중 [되돌리기] → 한 번뿐인 되돌리기 소진 | 반영 | M5: execute·undo RPC 전 `conn.status` 409, undo는 토큰 갱신까지 확인(null 409·일시 오류 502). M3 `mail_action_finish`: 되돌리기 진행 0 + 연결 코드면 실행 종료 상태로 되돌리고 `undo_<code>`. M8 `undoReconnect` 문구·[되돌리기] 유지. M0 (f)·(i). M10 smoke·M11 G6 |
| N-H2 | Fable HIGH | 실행 결과 불명 → "하지 못했어요" + 토큰 버림 | 반영 | M8 `executeIsDefinite`·`afterStatusRead`, M9b `readBack`(토큰 상태 1~2회, previewed일 때만 버튼), `repreviewMail`이 옛 토큰 상태 먼저(못 읽으면 덮지 않음). M11 G7c(같은 결과 경로) |
| N-H3 | Fable HIGH | 조건 줄·표본에 연도 없음 | 반영 | M8 `conditionLine(_:now:)`·`sampleLine(_:now:)`(서울 올해가 아니면 Y/M/D) + 테스트, M0 Step 4 (b) |
| N-H4 | Fable HIGH | 글자·숫자 없는 값이 칸 검사·범위 하한 통과 | 반영 | M1 `WORDY` 검사(sender·subject_words) + 6값 × 2칸 테스트, M0 Step 2 (c), D21 |
| N-M1 | Fable MED | attempts가 진행 뒤에도 회복 안 됨 | 반영 | M4b: 이번 실행에서 커서 전진 뒤 결과 불명 → `Deferred(+60s, mail_retry)`(마지막 시도보다 먼저). 테스트 "after progress …"·"scattered transient errors"(100건·5회 → plain 0) |
| N-M2 | Fable MED | 재조회가 429·타임아웃을 실패로 적음 | 반영 | M4b `lookup`: 쿼터면 읽은 앞부분만 적고 쿼터 미루기(30분 판정 공유), 예산도 같다. 404·그 밖은 실패(스펙 수용 범위). 테스트 "reread hits quota" |
| N-M3 | Fable MED | 휴지통 batch 404 → 재조회가 999통 실패 | 반영(메인 판정 a) | D9·M4b `opFor`(`fallbackOn404` 제거 — 400·404 모두 건별), M0 Step 3 (e) 스펙 제자리 교체. 테스트 실행·되돌리기 404 사례 |
| N-M4 | Fable MED | C1을 받칠 테스트 없음 | 반영 | M4b 테스트 4건(건별 예산·재조회 예산·건별 묶음 도중 죽음·재조회 429) + 흩어진 오류·진행 뒤 미루기 |
| N-M5 | Fable MED | 일반 경로가 refresh token 없이 scopes 기록 | 반영 | M6 `if (t.refresh_token)`일 때만 `gmail_set_scopes` + 테스트(null → 0회) |
| N-M6 | Fable MED | upgrade가 readonly 포함 여부를 안 봄 | 반영 | M6 modify·readonly 둘 다 없으면 403 + 행렬 사례(`openid modify`) |
| N-M7 | Fable MED | upgrade가 reauth_required 연결을 되살림 | 반영 | M6 non-active 409 `reauth_required`(쓰기 0) + 사례, M3 `gmail_replace_token`에 `status = 'active'` + SQL 사례 |
| N-M8 | Fable MED | 호스팅 테스트 16사례가 각자 0030 적용(잠금 16번), lock_timeout 없음 | 반영 | M3 `mail-actions-db.test.ts`: 트랜잭션 하나·`set local lock_timeout = '3s'`·사례마다 savepoint·`testUser` 1회. M10 Step 3에 "수 초 기다림" 명시 |
| N-M9 | Fable MED | service role 전용·RLS 단언 없음 | 반영 | M3 사례 "privileges"(`has_function_privilege` anon·authenticated false, `relrowsecurity`, `pg_policies` 0), `MAIL_FUNCTIONS` |
| N-M10 | Fable MED | M7 chat 재배포 ↔ 158행 어긋남 | 반영(메인 판정 b) | M7은 로컬 판정·커밋만, 재배포는 M10 Step 5b. 158행에 "chat도 예외 아님" 한 문장 |
| N-M11 | Fable MED | `MAIL_SCHEMA` 고치면 질문 회귀가 smoke-chat뿐, 게이트 문장이 평가에 없음 | 반영 | M7 Step 2 게이트 문장 4개(m16~m19)·`WANT`·`GATE`(의도+칸 3/3). CTX-eval(`EVAL_INTENTS=add_event,mail_action`)은 플래그를 켠 뒤 M10 Step 6에서 **항상**(배포본을 부르므로 M7에선 불가). M0 (f2) 스펙 개수 |
| N-M12 | Fable MED | `job_dead` 결과 단정·done에 job_dead | 반영 | M8 `result` 둘째 줄 `maybeChanged`(job_dead·job_lost), M3 finish가 남은 id 0이면 코드 미기록 + 사례 |
| N-M13 | Fable MED | readonly+modify 빌드가 ③c2 전 기기로 나갈 수 있음 | 반영 | M9a `ios/scripts/version-guard.sh`(testflight.sh가 호출 — 3줄 대신 따로 둬 Step 4에서 실행해 볼 수 있게)·`TF_ALLOW_PRE_MAIL`, D17 "MAIL-sim 전 `.mailAction` 빌드 실기기 설치 금지" |
| N-M14 | Fable MED | `resumeMail` onAppear가 요청 중인 턴과 경쟁 | 반영 | M9b `mailRequesting` 집합 — 실행·되돌리기·다시 미리보기·재개 읽기 중에는 재개 안 함 |
| N-M15 | Fable MED | M9 단위 테스트 0 | 반영 | 순수 판단을 EruriCore로(`needsStatusRead`·`afterStatusRead`·`executeIsDefinite`·`needsUpgrade(rows:)`) + 테스트 4개. 뷰 전체 리듀서는 Fable 판정대로 하지 않음 |
| N-M16 | Fable MED | 1970년 이전 날짜 → 음수 epoch | 반영 | M1 `YEAR_MIN = 2004`(2004년 전 거절) + 테스트, D21 |
| N-M17 | Fable MED | M0이 덧붙이기만 해 스펙에 옛 문장 잔존 | 반영 | M0 Step 2·3 제자리 교체(progress 시그니처·100초 예산·From·Subject·Date·속도 기록·결과 불명·휴지통·invalid_grant) + Step 7 옛 문장 0 grep. §9 문구·§16 리뷰 소절 |
| N-M18 | Fable MED | MAIL-real ① 요청이 묶여 cursor 판정 깨짐·중단 조건·probe 쿼리 | 반영 | M12 요청 1·2 분리, 불변 판정 = `$T1` 이후 백필 잡 0(cursor는 참고), ②⑤ "3건 + 표본 3줄 합성 1~3일 때만", probe `is:unread newer_than:1d` 단어별 `subject:` + `need_3` 분기 |
| N-M19 | Fable MED | 회귀 실패 되돌리기 절차 없음·C3·C4·N-H2 재현 사례 없음 | 반영 | M10 Step 4·5·5b·6 되돌리기 한 줄씩(`$U6B` worktree 워커, M6 직전 gmail-connect, `$A3` chat, 플래그 off, 0030 유지), M11 G7b·G7c |
| L-M1 | Fable LOW | sanitize 멱등·타입 오류·공백 단어·쿼리 모양 | 반영 | M1 지우기 → NFC, 멱등 4사례, 타입 3사례, `[" "]`, 하루·끝만·시작만 쿼리 |
| L-M2 | Fable LOW | 줄 범위·signal·401/Timeout 분류·sanitizer | 반영 | M2 7~11행, 호출마다 `AbortSignal` 단언(15초 값은 상수 단언), 401·TimeoutError → unknown, sanitizer 걸리면 `sanitizeOps: false` |
| L-M3 | Fable LOW | purge 안전망·정렬·dead 경로·testUser·U7 여유 | 반영 | `job_lost` 마감(8일·살아 있는 잡 없음), `order by created_at, payload->>'phase'`, `fail_job` 경로 dead, `testUser` 1회, U7 실패 시 M10 SQL 수정 1회 여유 |
| L-M4 | Fable LOW | units 미루기 무상한·우선순위 20 지연·elapsed·토큰 타임아웃·예산 25초 | 반영 | 스펙 §16·M0 (g) 수용 문장, Review Focus 5 수용, `done`·`verified` 로그 `elapsed_ms`, `refreshAccessToken(rt, 15s)`, D7 |
| L-M4' | Fable LOW | Review Focus 6 테스트가 소스 grep이라 약함 | 미반영 | 잡 모듈은 `MailJobDeps`(Gmail·행 RPC만)로만 바깥에 닿고 실제 RPC는 `mail-action-deps.ts` 한 파일이라 그 파일 grep이 경로 전체를 덮는다. 타입으로 더 막으려면 deps 인터페이스를 쪼개야 해 이득이 작다 |
| L-M5 | Fable LOW | 미리보기 총 예산·일시 오류 502·별표 이탈 수용·연결 1개·헤더 계약 | 반영 | `PREVIEW_BUDGET_MS` 25초(`d.now()` 주입), 토큰 갱신 오류·fetch `TypeError` → 502, M0 Step 3 (a), D3, HTTP 계약 405·500·bad_json·본문 없음 + 테스트 |
| L-M6 | Fable LOW | profile 401 → iOS 코드 재전송·주석 | 반영 | M6 401 → 502 `gmail_unauthorized` + 사례, 주석 정정 |
| L-M7 | Fable LOW | M7 Step 1 chat diff 0줄·해시 | 반영 | M7 Step 1 `$A3..HEAD` diff 0 |
| L-M8 | Fable LOW | executeError 404/400·undo 404·Codable 호환·countLine·previewError 502/401·치환 앵커 | 반영 | M8 테스트·코드, `MailTurn` 디코드 호환 테스트·주석, Step 4-1 "`addEvent` 뒤에 `mailAction`" |
| L-M9 | Fable LOW | busy → 폴링·retry 필드·되돌리기 스피너·showNext·스크롤·upgrade 재시도·fail 문구·Swift 6 | 반영 | 409 busy counts로 `pollMail`, `MailTurn.retry`·`Note.retry` 삭제, 카드 running+finished 스피너, `showNext` `done > 0`, 스크롤은 `append`가 이미 함(F28 — 변경 없음), 네트워크 1회 재시도, 문구는 `MailCleanupText`만, Swift 6 sending 대비책 |
| L-M10 | Fable LOW | smoke·cleanup 연결 잡·simctl delete·G1/G2 재시도·하네스 원본·대기 기한·② 판정 문장·업로드 기준 둘 | 반영 | `conn_jobs` 삭제·게이트 cleanup gmail-* 잡, `simctl delete`, G1·G2·G3 재시도 규칙, 최근 gate 디렉터리 복사, ① 대기 분기 `expires_at`·사용자 선택, "`done`이고 `batch`", U6b Step 6 문단 "더 이른 커밋" |
| L-M0 | Fable LOW | 선행 계획 해시·Expected ≥ 4·앵커·§16 리뷰 소절 | 반영 | `8e9c62d`, M0 Step 7, Step 4 (g) 앵커 `): ① 설정 › Gmail [권한 업데이트]`, M0 Step 5 두 번째 소절 |
| (c) | Fable 판단 요청 | 받은 기간 한쪽 끝만으로 범위 하한 충족 | 미반영(수용, 메인 판정 c) | 스펙대로 — 카드 조건 줄·건수·위 20건이 받친다. M0 Step 2 (d)에 한 문장 |
