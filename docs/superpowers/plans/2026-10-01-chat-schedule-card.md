# ERURI 0.8.2 채팅 일정 답 카드 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 2026-10-01 실기기 피드백("일정이 언제야?"에 알림 기준 판단·캘린더 내용·추가/겹침 여부가 같이 나와야 맥락이 읽힌다)과 0.8.1 실기기에서 확정된 카드 버튼 무반응 버그를, 채팅 답 아래 **일정 답 카드**(① 찾은 곳 ② 그날 내 캘린더 ③ 상태·버튼)로 고친다 — 앱 0.8.2, 서버 변경 없음.

**Architecture:** 판단·문구는 EruriCore 새 파일 `ScheduleCard.swift`(EventKit·SwiftUI 없음, TDD)로 모은다. 앱은 카드 날짜(서울 하루) ±1일의 모든 캘린더 일정을 **한 번** 읽어(`CalendarLookup.cardEvents`) 그날 줄·등록 판정·겹침에 같이 쓰고, 이 기기 실행 기록(`Executions`)과 서버 상태(`succeeded`)는 "넣은 적 있음"의 보조 근거로만 쓴다. `ChatView`는 카드를 Section 안의 행 세 개로 그리고, 카드 버튼은 스타일을 명시해(추가 `.borderedProminent`, 겹쳐도 추가 `.bordered`) 행 탭이 아닌 자기 제스처로 눌리게 한다. 권한 안내의 `Link`는 `Button`+`openURL`로 바꾼다. 서버 응답(`proposals`(proposed·succeeded)·`citations`·`schedule`)은 이미 필요한 것을 다 준다.

**Tech Stack:** SwiftUI iOS 26 앱 `Eruri` + Swift Package `EruriCore`(XCTest), EventKit, SQLite(`Executions`), xcodegen `ios/project.yml`, XCUITest(게이트 전용 임시 타깃), TestFlight(`ios/scripts/testflight.sh`).

**Spec:** `docs/superpowers/specs/2026-09-22-assistant-design.md` — 이 계획의 T0이 §9("일정 질문과 기기 캘린더" 문장 교체 + 새 항 "일정 답 카드")·§10(채팅 카드 버튼 줄)·§11(버전)·§12 통제 2(카드의 그날 캘린더 줄)·§16(리뷰 반영·실기기 피드백)을 먼저 고친다. 설계 입력은 `.context/chat-card-design.md`(사용자 피드백 + 실기기 버그 확정 2026-10-01 12:31), 근거 리뷰는 `.context/fable-review-chatcard.md`(요약 표 12건·"먼저 바꿀 3가지"·§2 상태 표·§4 버튼·§5 게이트). 실행 규칙은 `AGENTS.md` §3(모델)·§5-8(실측 게이트)·§6(기계)·§7(개인정보)·§8(버전).

**출발점:** main `8ab7999` 위. 앱 0.8.1(`167653c`: "겹쳐도 추가" 확인창 생략), 서버는 S3(`cd18179`, `schedule`) 배포 상태. 0.8.1 시뮬레이터 게이트 결과 `.context/sim-gate-081.report.md`(채팅 카드 버튼·"설정에서 허용하기" 1회 탭 무반응), 실기기 확인 2026-10-01 12:31(카드 "겹쳐도 추가" 탭 무반응·텍스트처럼 보임).

**리뷰·실행:** 설계안은 Fable 리뷰를 거쳤고 그 권장안을 기본으로 채택했다(끝 "Fable 리뷰 반영" 절). 이 계획은 Codex(gpt-6-astra) → Fable 계획 리뷰를 거쳐 이 판에 반영했다(끝 "계획 리뷰 반영" 절 — 판정이 갈리면 Fable 판정을 따랐다. T0 Step 6이 스펙 §16에도 적는다). Fable 최종 권장대로 추가 리뷰 없이 SDD로 간다. 실행은 SDD, 원장 `.superpowers/sdd/2026-10-01-chat-schedule-card/progress.md`(상위 원장 `.superpowers/sdd/2026-09-30-phase1/progress.md`의 Rulings 승계).

**태스크:** `T0` 스펙 → `T1` EruriCore `ScheduleCard`(TDD) → `T2` 앱 카드(조회·뷰·버튼 스타일·스크롤·권한 안내 버튼) → `T3` 0.8.2·시뮬레이터 게이트·업로드·실기기 게이트. 설계 초안의 T2(조회)·T3(뷰)·T4(권한 안내)는 **T2 하나로 합쳤다** — 조회만 바꾸면 `ChatView`가 옛 카드와 새 모델을 함께 들고 있어야 해 따로 검증할 산출물이 없고, 권한 안내 수정은 3줄이라 따로 리뷰할 단위가 아니다. 게이트(초안 T5)는 T3.

## Global Constraints

- **범위: 앱만.** 서버(`supabase/**`) 코드·마이그레이션·배포 없음. chat 응답은 이미 `proposals`(인용 항목의 `proposed`·`succeeded`, 0017 `chat_proposals`)·`citations`(`item_id`·`source`·`app_name`·`occurred_at`)·`schedule`을 준다. "무시" 상태 카드(서버가 dismissed 를 주지 않음)는 0.8.2에서 하지 않는다(Fable #6).
- **버전(AGENTS.md §8):** `MARKETING_VERSION: 0.8.2`(수정 = 패치), T3에서 올린다. 빌드 번호는 `testflight.sh` 기본값(`date +%Y%m%d%H%M`). 메이저 금지.
- **개인정보(AGENTS.md §7, 스펙 §12 통제 2):** 기기 캘린더의 제목·시각·메모는 기기 밖으로 보내지 않는다 — chat 요청 본문은 `{"question": q}` 그대로, `Trace`·`device_traces`에 일정 없음, `DiagLog`에는 개수와 기간 종류만(`CAL card n=… more=… access=… sched=none|day|wide`). 0.8.2부터 **일정 질문이 아닌 답에도 그날 캘린더 제목이 화면에 뜬다** — 기기 안 화면 표시뿐이라 §12 등급 변화는 없지만 §9 문구가 바뀌므로 T0이 먼저다. 원문은 기존 "원문 보기" → `ItemDetailView`(`/chat/item`, 복호화 감사) 경로뿐, 새 감사 행·새 수신자 없음. 응답의 `sender`는 디코드하지 않는다. 테스트 픽스처·게이트 데이터는 합성 문구(`합성` 포함)만, 기준 날짜 **2026-10-04(일)**(Fable #11 — 설계안 예시의 "토"는 틀림).
- **Gmail 측정 창(Gmail 계획 Global Constraints):** T0 = **2026-10-01 14:00 KST**(③b2 시작) ~ ③b3 백필 완료 기록까지가 ③b2 창, ③c1 = T0+6일(≈10-07 14:00), ③c2 = T0+8일(≈10-09 14:00). 실제 시각은 게이트 전 메인이 `.superpowers/sdd/2026-09-30-phase1-gmail/progress.md`·`docs/superpowers/phase1/gates.md`로 확인한다.
  - 실기기 게이트(T3 D1·D2)는 실사용자 제안을 쓰거나(`send-phrases --only push`면 실사용자 `items`·`jobs`·`proposals`를 만든다) 실사용자 제안을 `succeeded`로 바꾼다 → **③b2 창 밖**, ③c1·③c2 측정 시각과 **30분 이상** 떨어뜨린다.
  - 시뮬레이터 게이트(T3 G1~G7)는 테스트 사용자만 쓰지만 시드 항목이 배포 워커 잡·LLM 슬롯을, 채팅 질문이 LLM 슬롯을 쓴다 → ③b2 창(백필 진행 중 지연 측정)에도 **겹치지 않게** 한다.
  - 제안 탭 **"전체 무시" 금지**(90일 백필의 실제 미래 일정 제안까지 지운다). 게이트가 남긴 합성 제안은 제목에 `합성`이 든 것만 한 건씩 무시.
- **기계(AGENTS.md §6):** 빌드·시뮬레이터 전 `vm_stat | grep -E 'free|compressor'`, `pgrep -x deno`가 비어 있을 때만 시뮬레이터 빌드·테스트. 시뮬레이터는 pane 전용 UDID(`ios/.sim-udid`, 게이트는 새로 만든 전용 기기). 다른 pane 기기를 만지지 않는다.
- **테스트 명령:** `cd ios && ./scripts/sim.sh gen && ./scripts/sim.sh test EruriCoreTests/<클래스>`(전체는 `EruriCoreTests`), 앱 빌드 `cd ios && ./scripts/sim.sh build`.
- **모델(AGENTS.md §3):** T0 `opus`/`high`(스펙 수정), T1·T2 구현·리뷰 `opus`/`high`, T3 시뮬레이터 게이트 `opus`/`medium`, T3 실기기 세션(사용자 조작·대기) `sonnet`/`medium`, 게이트 판정·기록이 섞이면 `opus`/`medium`.
- **기존 코드 위에 더한다:** 계획의 Swift 코드는 기존 파일에 더하거나 **해당 함수만** 바꾼다. `ChatView.swift`의 입력 패널·받아쓰기·판정 버튼·`runAdd`의 확인창 경로(C2-5)는 그대로 둔다.
- **기록:** `docs/superpowers/phase1/gates.md`에 행 `C3-sim`·`C3-device`(상태는 통과·실패·대기만, "부분"은 마감 아님). 커밋 칸은 비우고 메인이 채운다.
- **커밋:** 태스크마다, 트레일러 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. **push 금지**(메인이 회수 후 `git push origin main`).

## 이 계획이 기대는 사실 (코드에서 확인, 2026-10-01)

| # | 사실 | 출처 |
|---|---|---|
| F1 | `chat_proposals`는 인용 항목의 제안 중 `status in ('proposed','succeeded')`만 준다. 거절이면 서버가 `proposals: []` | `0017_chat_read.sql:81-83`, `chat/handler.ts:125` |
| F2 | 제안 payload: `title`·`start`(오프셋 있는 시각 또는 날짜만)·`uncertain`(배열). 푸시는 `uncertain` 비고 시각 있을 때만 `ADD_EVENT` | `_shared/notify.ts:28-42` |
| F3 | 지금 카드는 `ChatReply.calendarStart`(create_event · **proposed** · 시각 · uncertain 없음 · 미래)만 그린다 → succeeded·날짜만·지난 제안은 카드 자체가 없다(Fable #1) | `ChatReply.swift:39-45`, `ChatView.swift:124-130` |
| F4 | 지금 카드 상태(`DeviceCalendar.cardStatus`)는 ±1일 조회로 inCalendar·conflict·clear 셋, 그날 일정 목록은 `schedule`이 있을 때만(`scheduleEvents`, 생일·구독 제외) | `DeviceCalendar.swift:28-45`, `CalendarLookup.swift:31-48` |
| F5 | 카드 `Button`·`CalendarAccessPrompt`의 `Link`만 buttonStyle 미지정. 같은 List의 `.borderless`("보관함에서 보기"·👍👎)는 눌린다. List에 `simultaneousGesture(TapGesture)` | `ChatView.swift:41,174`, `ProposalsView.swift:211` |
| F6 | `AddEventGate.add`: 실행 기록 있으면 `dup` → 전체 접근 없으면 `fail:no_full_access` → ±1일 표식이면 `recovered` → 미확인 겹침이면 `conflict:<n>` → 저장(1시간, url 표식) → 기록 `ok` | `NotificationActions.swift` `AddEventGate` |
| F7 | `Executions.shared().existing(proposalId:)` = 이 기기 실행 기록(SQLite, FULLMUTEX) | `Executions.swift:17-24` |
| F8 | `ProposalFlow.conflicts`: [start, start+1h)와 겹치는 일정, 종일·취소·같은 제안 표식 제외, 맞닿음 제외. 다른 제안 표식은 겹침 | `ProposalFlow.swift:46-51` |
| F9 | `SourceLabel.label`: MESSAGES·메시지 앱 NOTIFICATION → "문자", GMAIL → "메일", 그 밖의 NOTIFICATION → 앱 이름 | `SourceLabel.swift` |
| F10 | `ChatReply.Citation`은 `occurred_at`을 Postgres 소수 초 포함 문자열로 받는다 | `ChatReply.swift:6-10`, `ChatReplyTests` 픽스처 |
| F11 | 0.8.1 게이트 하네스: 전용 시뮬레이터 + 임시 xcodegen 스펙(`ios/project.gate081.yml` → `EruriGate.xcodeproj`) + `GateHostTests`(테스트 사용자 refresh token 을 앱 Keychain 에 넣음) + `GateUITests`(러너 프로세스가 EventKit 으로 합성 일정을 씀). `testUser()`는 호출마다 비밀번호를 바꿔 앱 refresh token 을 무효화한다 | `.context/sim-gate-081.report.md`, `.context/sim-gate-081-shots/Gate.swift.txt` |
| F12 | iOS 26 iPhone 에서 `confirmationDialog`가 팝오버로 떠 "취소" 버튼이 없다(바깥 탭으로 닫힘) | 0.8.1 게이트 C2-5 관찰 |

## Review Focus

1. **겹친 일정이 목록에서 빠진다**: 구독(스포츠·공휴일) 캘린더의 시각 있는 일정이 제안 시각과 겹치면 겹침 판정은 잡는데 표시 목록은 구독을 빼서 "겹침"이 가리키는 줄이 없다. 사람은 무엇과 겹치는지 보기를 기대한다 → 겹친 일정은 어느 캘린더든 줄 맨 위(주황), 상태 문구에도 그 일정을 직접 적는다(T1 `testDayLines`의 `listed: false` 겹침 줄, `testStatusText`).
2. **넣은 뒤 캘린더에서 옮기거나 지웠다**: 사용자가 ERURI가 넣은 일정을 캘린더 앱에서 옮기거나 지운 뒤 같은 질문을 한다. 사람은 "아직 없음 + 추가 버튼"(누르면 `dup`으로 아무것도 안 됨)이 아니라 실제 상태를 기대한다 → 옮김 "✅ 캘린더에 등록됨 · 캘린더에서는 10/5(월) 10:00", 지움 "이전에 추가한 일정 · 이 날 캘린더에서는 찾지 못함", 둘 다 버튼 없음(T1 `testStatus`, T3 G4).
3. **같은 예약의 재안내 문자**: 재안내 문자가 다른 제안(pid 다름, 제목 조금 다름)이 되어 첫 제안이 넣은 일정과 같은 시각에 걸린다. 사람은 "중복일 수 있다"는 신호를 기대한다 → 겹친 일정이 다른 ERURI 표식이고 시작(분)이 같으면 "(같은 일정일 수 있음)", 버튼은 남긴다(T1 `testStatus` `reNotice`).
4. **자정을 걸친·여러 날·종일 일정, 기기 시간대가 서울이 아님**: 전날 23:00–01:00 일정을 "23:00–01:00"으로만 쓰면 오독한다. 해외에서 기기 시간대가 달라도 서울 날짜로 묶여야 한다 → 그날 안이면 `HH:mm–HH:mm`, 걸치면 `M/d HH:mm–M/d HH:mm`, 종일은 "종일"(겹침 아님), 모든 포매터는 서울 고정(T1 `testDayLines`·`testStatusText` `night`).
5. **주간 질문의 기간 목록이 사라진다**: "다음 주 일정"에 카드가 붙었을 때 카드 하루만 보이면 0.8.0 C1-1(기간 목록)이 회귀한다. 하루 질문에서는 같은 목록이 두 번 보이면 안 된다 → 카드가 있고 `schedule`이 없거나 카드 날짜 하루면 카드만, 더 넓으면 카드 + "기기 캘린더" 절(T1 `testShowsRangeSection`, T3 G5).
6. **키보드가 올라온 채 카드 버튼을 누른다**: 입력창을 다시 눌러 키보드가 올라온 상태에서 카드 버튼을 한 번 누른다. 0.8.1 은 여기서 이벤트가 없었다 → 한 번에 "추가하는 중…"이 떠야 한다(T3 G1a, 실기기 D1 — 둘 다 탭 직전 키보드가 있었는지 기록). 순수 함수로는 잴 수 없어 XCUITest·실기기로만 닫는다.
7. **매일 반복 일정과 겹침**: 매일 15:00 반복 일정이 제안과 겹친다. 반복 일정은 회차마다 id(`eventIdentifier`)가 같고 카드는 ±1일을 읽어, id 로만 겹침을 가리면 전날·당일·다음날 회차가 모두 주황 줄이 된다 → 겹친 당일 회차 한 줄만(T1 `testDayLines` daily — 겹침은 값 비교).
8. **예전 예약과 새 예약이 같이 인용됨**: "합성의원 예약 언제야?"에 지난 예약 문자·90일 백필 메일이 같이 인용된다. 시작 순이면 지난 카드가 앞에 서고 4건째부터 추가할 수 있는 미래 카드가 "N건 더 있음"으로 밀린다 → 다가올 일정이 맨 위(시작 순), 지난 일정은 뒤(최근 것부터)(T1 `testPick` mixed).

---

## 파일 구조

```
docs/superpowers/specs/2026-09-22-assistant-design.md                 # T0 §9·§10·§11·§12·§16
ios/Packages/EruriCore/Sources/EruriCore/ScheduleCard.swift            # T1 생성: 카드 고르기·찾은 곳·그날 줄·상태 6종·버튼·절 동시 표시
ios/Packages/EruriCore/Sources/EruriCore/ProposalFlow.swift            # T1 CalendarEvent.listed(생일·구독 = false)
ios/Packages/EruriCore/Tests/EruriCoreTests/ScheduleCardTests.swift    # T1 생성
ios/Packages/EruriCore/Sources/EruriCore/DeviceCalendar.swift          # T2 CardStatus·cardStatus·statusText 삭제(카드가 대체)
ios/Packages/EruriCore/Sources/EruriCore/ChatReply.swift               # T2 calendarStart 삭제(ScheduleCard.card 가 대체)
ios/Packages/EruriCore/Tests/EruriCoreTests/DeviceCalendarTests.swift  # T2 testCardStatus 삭제
ios/Packages/EruriCore/Tests/EruriCoreTests/ChatReplyTests.swift       # T2 calendarStart 테스트 2개 삭제
ios/App/CalendarLookup.swift                                           # T2 value 의 listed, cardEvents 추가, cardStatuses 삭제
ios/App/ChatView.swift                                                 # T2 Turn·스크롤·answerRows·cardRows·statusRow·readCalendar·refresh
ios/App/ProposalsView.swift                                            # T2 CalendarAccessPrompt Link → Button+openURL
ios/project.yml                                                        # T3 0.8.2
docs/superpowers/phase1/gates.md                                       # T3 행 C3-sim·C3-device
```

## 실행 순서

| 순서 | 태스크 | 선행 | pane | Gmail 창 |
|---|---|---|---|---|
| 1 | T0 스펙 | 이 계획 커밋 | 문서 | 무관 |
| 2 | T1 EruriCore | T0 | iOS(시뮬레이터 UDID) | 무관(로컬 테스트) |
| 3 | T2 앱 카드 | T1 | iOS(같은 pane) | 무관(빌드만) |
| 4 | T3-a 0.8.2·시뮬레이터 게이트 G1~G7 | T2 | 게이트 pane(새 전용 시뮬레이터) | ③b2 창 밖(시드·채팅이 워커·LLM 슬롯 사용) |
| 5 | T3-b TestFlight 업로드 | G1~G7 통과 | 게이트 pane | 무관 |
| 6 | T3-c 실기기 D1·D2 | 업로드 처리 끝 | 실기기(사용자 + `sonnet`) | ③b2 창 밖, ③c1·③c2와 30분 이상 |

- T1·T2는 같은 pane에서 차례로(같은 시뮬레이터, `ChatView`는 T2만 편집). 서버 pane과 겹칠 일이 없다(서버 변경 없음).
- G1이 1회 탭에 실패하면 T3를 멈추고 메인이 T2 수정 태스크를 연다(T2 "예비 조치" 단계). G1b가 스크롤(버튼이 화면 밖)로만 실패하면 스크롤만 고치는 수정 태스크다(T3 Step 4).
- G2·G3 스크린샷은 업로드 전에 사용자에게 먼저 보인다(T3 Step 5b) — D2에서 처음 보면 문구 수정이 빌드 하나를 더 낳는다.
- 사용자 확인이 필요한 항목: 없음(개인정보 등급 변화 없음). D2(맥락이 읽히는지)는 사용자 판단 자체가 게이트다.

---

### Task T0: 스펙 §9·§10·§11·§12·§16 — "일정 답 카드"

**Files:**
- Modify: `docs/superpowers/specs/2026-09-22-assistant-design.md` (§9 469행 문장 교체·새 항, §10 492행, §11 521행, §12 557행, §16 새 소절)

**Interfaces:**
- Consumes: 없음.
- Produces: T1·T2가 따르는 문구·규칙 원본(§9 "일정 답 카드"). 문구는 T1 테스트의 기대값과 글자 단위로 같아야 한다.

- [ ] **Step 1: §9 "일정 질문과 기기 캘린더" 문장 교체**

469행 안에서 다음 문장을 찾아

```
채팅 제안 카드에는 그 시각의 캘린더로 상태를 붙인다: "이미 캘린더에 있음"(같은 제안 표식이거나 시작 시각(분)·제목이 같은 일정) · "같은 시간에 일정 있음"(§10 겹침 판정 — 이 카드의 버튼은 "겹쳐도 추가"이고 확인창 없이 저장한다, 0.8.1).
```

이것으로 바꾼다:

```
채팅 제안 카드는 아래 "일정 답 카드"다(0.8.2 — 0.8.0·0.8.1의 상태 한 줄 카드를 대체한다).
```

같은 행의 "앱 활성화(…)와 카드 추가 성공 뒤에는 마지막 5개 턴의 절·카드 상태를 다시 읽고, 전체 접근이 없으면 지운다" 문장 끝의 "전체 접근이 없으면 지운다"를 "전체 접근이 없으면 절을 지우고 카드는 캘린더 줄 대신 허용 안내를 둔다"로 바꾼다.

- [ ] **Step 2: §9 새 항 "일정 답 카드" (469행 바로 아래에 한 줄로 추가)**

```
- **일정 답 카드(2026-10-01 실기기 피드백, 앱 0.8.2)**: 답의 인용 항목에 일정 제안(`create_event`, 서버가 주는 `proposed`·`succeeded`)이 있으면 답 아래에 제안마다 카드 한 장을 둔다. 카드는 세 부분이다 — ① **찾은 곳**: "문자에서 찾은 일정"(출처는 같은 응답 `citations`에서 `item_id`로 찾은 `source`·`app_name` — 문자·메시지 앱 알림 "문자", Gmail "메일", 그 밖의 앱 알림 "<앱 이름> 알림", 공유 "공유한 내용", 못 찾으면 "저장된 정보"), 추출한 일정 "10/4(일) 15:30 제목"(날짜만이면 "시간 미정"), "10/1 받은 문자 · 원문 보기"(원문은 기존 `ItemDetailView`·`/chat/item` 경로) ② **"내 캘린더 · 10/4(일)"**: 제안 날짜의 서울 하루 일정 — **일정 질문이 아니어도(`schedule` 없음) 읽는다**. 겹치는 일정은 어느 캘린더든 맨 위(주황), 그다음 종일("종일 제목"), 그다음 시작 순. 생일·구독 캘린더와 취소된 일정은 뺀다(겹친 일정은 빼지 않는다). 그날 안이면 `HH:mm–HH:mm 제목`, 날짜를 걸치면 `M/d HH:mm–M/d HH:mm 제목`(다음 날 0시에 끝나는 일정은 그날 안으로 본다 — "23:00–00:00", 상태 문구도 같은 표기), 최대 4줄 + "외 N건", 없으면 "이 날 등록된 일정 없음" ③ **상태**: 아래 순서에서 처음 걸리는 하나. 1) 이 제안 표식 일정이 같은 시작(분) "✅ 캘린더에 등록됨" 2) 표식 일정의 시작이 다름 "✅ 캘린더에 등록됨 · 캘린더에서는 10/5(월) 10:00" 3) 표식 없이 시작(분)·제목이 같은 일정 "✅ 같은 일정이 캘린더에 있음" 4) 표식을 못 찾았는데 이 기기 실행 기록이 있거나 서버 상태가 `succeeded` "이전에 추가한 일정 · 이 날 캘린더에서는 찾지 못함(옮겼거나 지웠을 수 있음)" — 1~4는 버튼 없음 5) §10 겹침 "⚠️ 아직 캘린더에 없음 · 겹치는 일정 15:00–16:00 제목"(여러 건이면 " 외 N건", 겹친 일정이 다른 ERURI 제안 표식이고 시작(분)이 같으면 끝에 " (같은 일정일 수 있음)") + [겹쳐도 추가] 6) "아직 캘린더에 없음" + [캘린더에 추가]. 표식 판정은 카드 날짜 ±1일 범위, 취소된 일정은 없는 것으로 본다. 서버 `succeeded`만으로 "등록됨"이라 하지 않는다(캘린더에서 지웠거나 다른 기기에서 넣었을 수 있다). 시각 없는 제안은 버튼 없이 "날짜만 확인돼 바로 추가하지 않음", `uncertain`이 있으면 "내용 확인이 필요해 바로 추가하지 않음", 지난 일정(시각 < 지금, 날짜만은 그날이 끝남)은 "지난 일정". 무시한 제안은 서버가 주지 않아 카드가 없다. 제안이 여럿이면 `schedule`이 있을 때 그 기간 안에서 시작하는 것만, 다가올 일정을 시작 순으로 먼저, 지난 일정은 그 뒤에 최근 것부터. 같은 시작(분)·제목은 한 장(`succeeded`가 있으면 그것), 최대 3장 + "일정 제안 N건 더 있음". 카드가 있고 `schedule`이 없거나 카드 날짜 하루와 같으면 위 "기기 캘린더" 절을 따로 그리지 않고, 더 넓은 기간(주간 질문)이면 카드 아래에 절을 그대로 둔다. 카드 상태는 미리 보기이고 최종 판정은 저장 직전 §10 순서(`AddEventGate`)다. 답 문장의 시각과 카드의 추출 시각이 달라도 검출하지 않는다 — 두 값이 화면에 같이 보이고 원문 보기로 확인한다. 캘린더 전체 접근이 없으면 ①은 그대로, ② 자리에 첫 카드만 허용·설정 안내(이때 "기기 캘린더" 절의 안내는 생략), ③은 시각 없음·지난 일정 문구만 남고 버튼은 없다. 권한이 없어지면 화면에 남은 모든 턴의 카드에서 캘린더 줄·상태·버튼을 걷는다. 카드 버튼은 모양이 보이는 스타일(캘린더에 추가 = 강조 채움, 겹쳐도 추가 = 주황 테두리)이고 목록 행 탭이 아니라 버튼 자체 탭으로 눌린다(0.8.1 실기기에서 스타일 없는 카드 버튼이 텍스트처럼 보이고 눌리지 않았다). 성공하면 결과 문구 대신 상태가 "✅ 캘린더에 등록됨"으로 바뀌고, 실패 문구만 따로 보인다. 질문을 보내면 키보드를 내리고, 답이 오면 그 질문이 보이게 스크롤한다(그 턴이 화면보다 길면 질문이 맨 위에 오고 카드는 쓸어 올려 본다). 진단 로그에는 카드 수와 일정 기간 종류(없음·하루·넓음)만 남긴다.
```

- [ ] **Step 3: §10 채팅 카드 줄 (492행 교체)**

```
    - 채팅 제안 카드: §9 상태 줄이 "같은 시간에 일정 있음"이면 버튼이 "겹쳐도 추가"이고 같은 규칙으로 확인창 없이 `confirmed = true`. 상태 줄이 없으면 "캘린더에 추가"(`confirmed = false`).
```

을 다음으로 바꾼다:

```
    - 채팅 일정 답 카드(§9, 0.8.2): 상태가 겹침("⚠️ 아직 캘린더에 없음 · 겹치는 일정 …")이면 버튼이 "겹쳐도 추가"이고 같은 규칙으로 확인창 없이 `confirmed = true`. "아직 캘린더에 없음"이면 "캘린더에 추가"(`confirmed = false`). 등록됨·같은 일정·이전에 추가함·시각 없음·확인 필요·지난 일정은 버튼이 없다.
```

- [ ] **Step 4: §11 버전 (521행)**

`채팅 "기기 캘린더" 절·제안 카드 상태·겹침 확인(§9·§10)은 0.8.0("겹쳐도 추가" 확인창 생략은 0.8.1)`을 `채팅 "기기 캘린더" 절·제안 카드 상태·겹침 확인(§9·§10)은 0.8.0("겹쳐도 추가" 확인창 생략은 0.8.1, 일정 답 카드는 0.8.2)`으로 바꾼다.

- [ ] **Step 5: §12 통제 2 (557행)**

`채팅의 "기기 캘린더" 절·제안 카드 상태(§9)`를 `채팅의 "기기 캘린더" 절·일정 답 카드(§9 — 일정 질문이 아니어도 제안 날짜 하루의 일정 제목을 화면에 보인다)`로 바꾼다.

- [ ] **Step 6: §16 새 소절 — "외부 리뷰 반영 (검색·캘린더 계획 …)" 소절(709행) 바로 아래에 추가**

```
### 외부 리뷰 반영 (채팅 일정 답 카드, Codex gpt-6-astra · Fable, 2026-10-01)

2026-10-01 실기기 피드백("일정이 언제야?"에 알림 기준 판단·캘린더 내용·추가/겹침 여부가 같이 나와야 맥락이 읽힌다)과 0.8.1 실기기 확인(12:31, 채팅 카드 "겹쳐도 추가" 탭에 이벤트 없음·텍스트처럼 보임 — 시뮬레이터 게이트 C2-4 무반응과 같은 버그로 확정)에 대한 설계안(`.context/chat-card-design.md`)을 Fable이 검토(`.context/fable-review-chatcard.md`)했고 권장안을 채택했다. 반영: #1 카드 표시와 버튼 조건 분리·succeeded도 카드, #2 캘린더 줄은 제안 날짜 하루(일정 질문이 아니어도), #3 겹친 일정은 어느 캘린더든 줄 맨 위·상태 문구에 직접, #4 카드 버튼 스타일 명시·권한 안내 `Link` → 버튼·실패했던 XCUITest를 회귀 게이트로, #5 보내면 키보드 내림·답이 오면 그 질문을 맨 위로(권장 "턴 끝"을 "질문 맨 위"로 바꿔 카드가 위에서부터 읽히게), #7 주간 질문은 카드 + 기간 절, #8 출처 표기, #9 여러 제안 규칙(최대 3), #10 "(같은 일정일 수 있음)", #11 예시 요일(10/4 = 일), #12 추출 시각·원문 보기. 미반영: #6 "무시" 상태(서버가 dismissed 를 주지 않음 — 서버 변경 없음 유지). 문구 조정: 겹침 상태를 "'제목'과 시간이 겹침" 대신 "겹치는 일정 HH:mm–HH:mm 제목"(제목 끝 받침에 따라 조사가 틀린다), 넘친 카드를 "외 N건은 제안 탭에서" 대신 "일정 제안 N건 더 있음"(succeeded·지난 제안은 제안 탭에 없다). 개인정보 등급 변화 없음(캘린더는 기기 화면에만). 서버 변경 없음, 앱 0.8.2. 계획 `docs/superpowers/plans/2026-10-01-chat-schedule-card.md`. 계획 리뷰(Codex gpt-6-astra · Fable, 2026-10-01): Codex #1 권한 가드(부분, MED로) · #2 대표 선택(반영) · #3 수용 기준 조정(부분) · #4 분기 로그(부분, 응답 주입 미채택) · #5 D1 키보드(반영) · #6 자정 끝 정책 고정(부분). Fable F1 반복 일정 겹침 줄 · F2 다가올 일정 먼저 · F3 스크롤 시점.
```

- [ ] **Step 7: 확인**

Run: `grep -c "일정 답 카드" docs/superpowers/specs/2026-09-22-assistant-design.md`
Expected: 5 이상(§9 두 곳·§10·§11·§12·§16).
Run: `grep -n "같은 시간에 일정 있음" docs/superpowers/specs/2026-09-22-assistant-design.md`
Expected: 출력 없음(0.8.0 상태 문구가 남지 않음 — §16 역사 기록에도 이 문구는 없다).

- [ ] **Step 8: 커밋**

```bash
git add docs/superpowers/specs/2026-09-22-assistant-design.md
git commit -m "docs(spec): §9 schedule answer card — source, that day's calendar even without a schedule range, six-way status, button styles (0.8.2); §10·§11·§12 follow; §16 Fable design review and Codex·Fable plan reviews of the chat card" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task T1: EruriCore `ScheduleCard` — 카드 고르기·찾은 곳·그날 줄·상태 6종·버튼 (TDD)

**Files:**
- Create: `ios/Packages/EruriCore/Sources/EruriCore/ScheduleCard.swift`
- Modify: `ios/Packages/EruriCore/Sources/EruriCore/ProposalFlow.swift` (`CalendarEvent`에 `listed`)
- Test: `ios/Packages/EruriCore/Tests/EruriCoreTests/ScheduleCardTests.swift` (생성)

**Interfaces:**
- Consumes: `ChatReply.Proposal`(`id`·`item_id`·`action`·`status`·`payload`), `ChatReply.Citation`, `JSONValue`, `ProposalFlow.CalendarEvent`·`marker`·`conflicts`, `SourceLabel.label`.
- Produces (T2가 쓴다):
  - `ProposalFlow.CalendarEvent.listed: Bool`(init 마지막 인자 `listed: Bool = true`)
  - `public enum ScheduleCard`
    - `enum Kind: Equatable, Sendable { case addable, dateOnly, needsReview, past }`
    - `struct Pick: Sendable { proposal: ChatReply.Proposal; kind: Kind; start: Date; timed: Bool; var title: String; var day: DateInterval }`
    - `static func card(_ p: ChatReply.Proposal, now: Date = Date()) -> Pick?`
    - `static func pick(_ ps: [ChatReply.Proposal], schedule: DateInterval?, now: Date = Date()) -> (cards: [Pick], more: Int)`
    - `static func sourceLine(_ c: ChatReply.Citation?) -> String`, `static func receivedLine(_ c: ChatReply.Citation?) -> String?`
    - `struct DayLine: Equatable, Sendable { text: String; conflict: Bool }`, `static func dayLines(day:events:conflicts:) -> (lines: [DayLine], more: Int)`
    - `enum Status: Equatable, Sendable { case added, addedMoved(Date), sameEvent, addedMissing, conflict([ProposalFlow.CalendarEvent], maybeSame: Bool), clear }`, `static func status(pid:title:start:serverStatus:executed:events:) -> Status`, `static func statusText(_ s: Status) -> String`
    - `struct Model: Equatable, Sendable { pid; itemID; title; startText; kind; start; timed; status: Status?; lines: [DayLine]?; moreLines: Int; var day: DateInterval }`, `static func model(_ c: Pick, events: [ProposalFlow.CalendarEvent]?, executed: Bool) -> Model`
    - `enum Action: Equatable, Sendable { case add, addAnyway }`, `static func action(_ m: Model) -> Action?`, `static func buttonTitle(_ a: Action) -> String`, `static func statusText(_ m: Model) -> String?`, `static func isWarning(_ m: Model) -> Bool`
    - `static func whenLine(_ m: Model) -> String`, `static func dayHeader(_ day: DateInterval) -> String`, `static let emptyDayText`, `static func moreText(_ n: Int) -> String`
    - `static func showsRangeSection(schedule: DateInterval?, cardDays: [DateInterval]) -> Bool`, `static func seoulDay(_ d: Date) -> DateInterval`

- [ ] **Step 1: 실패하는 테스트**

Create `ios/Packages/EruriCore/Tests/EruriCoreTests/ScheduleCardTests.swift`:

```swift
import XCTest
@testable import EruriCore

/// 스펙 §9 "일정 답 카드"(0.8.2): 카드 고르기·찾은 곳·그날 캘린더 줄·등록 상태 6종·버튼·"기기 캘린더" 절 동시 표시.
/// 기준 날짜 2026-10-04(일), 서울. 문구는 전부 합성
final class ScheduleCardTests: XCTestCase {
  private func d(_ s: String) -> Date { ISO8601DateFormatter().date(from: s)! }
  private func prop(_ id: String, start: JSONValue?, title: String = "합성의원 진료 예약", status: String = "proposed",
                    action: String = "create_event", uncertain: [String] = [], item: String = "item-1") -> ChatReply.Proposal {
    var payload: [String: JSONValue] = ["title": .string(title), "uncertain": .array(uncertain.map { .string($0) })]
    if let start { payload["start"] = start }
    return ChatReply.Proposal(id: id, item_id: item, action: action, status: status, payload: payload)
  }
  private func ev(_ id: String, _ start: String, _ end: String, title: String? = nil, allDay: Bool = false, canceled: Bool = false,
                  url: URL? = nil, listed: Bool = true) -> ProposalFlow.CalendarEvent {
    ProposalFlow.CalendarEvent(id: id, title: title ?? "합성 \(id)", start: d(start), end: d(end), allDay: allDay, canceled: canceled,
                               url: url, listed: listed)
  }
  private func cite(_ source: String, app: String? = nil, at occurred: String = "2026-10-01T00:10:00.123456+00:00") -> ChatReply.Citation {
    ChatReply.Citation(item_id: "item-1", source: source, app_name: app, title: "합성", occurred_at: occurred, expired: false)
  }
  private var now: Date { d("2026-10-01T03:00:00Z") }                                    // 서울 10/1(목) 12:00

  /// 시각 있음·미래 → addable, 날짜만 → dateOnly(서울 0시), uncertain → needsReview, 지남 → past.
  /// create_event 아님·start 없음·오프셋 없는 시각(handleAdd 가 못 읽음) → 카드 없음. 서버 상태는 kind 에 영향 없음
  func testCardKinds() throws {
    let a = try XCTUnwrap(ScheduleCard.card(prop("p", start: .string("2026-10-04T15:30:00+09:00")), now: now))
    XCTAssertEqual(a.kind, .addable); XCTAssertEqual(a.start, d("2026-10-04T06:30:00Z")); XCTAssertTrue(a.timed)
    let day = try XCTUnwrap(ScheduleCard.card(prop("p", start: .string("2026-10-04")), now: now))
    XCTAssertEqual(day.kind, .dateOnly); XCTAssertEqual(day.start, d("2026-10-03T15:00:00Z")); XCTAssertFalse(day.timed)
    XCTAssertEqual(ScheduleCard.card(prop("p", start: .string("2026-10-04T15:30:00+09:00"), uncertain: ["year"]), now: now)?.kind, .needsReview)
    XCTAssertEqual(ScheduleCard.card(prop("p", start: .string("2026-10-04"), uncertain: ["time"]), now: now)?.kind, .needsReview)
    XCTAssertEqual(ScheduleCard.card(prop("p", start: .string("2026-09-30T15:30:00+09:00")), now: now)?.kind, .past)
    XCTAssertEqual(ScheduleCard.card(prop("p", start: .string("2026-09-30")), now: now)?.kind, .past)
    XCTAssertEqual(ScheduleCard.card(prop("p", start: .string("2026-10-01")), now: now)?.kind, .dateOnly)        // 오늘(서울)은 아직 안 지남
    XCTAssertEqual(ScheduleCard.card(prop("p", start: .string("2026-10-01T12:00:00+09:00")), now: now)?.kind, .addable)  // start == now 는 안 지남(notify.ts)
    XCTAssertEqual(ScheduleCard.card(prop("p", start: .string("2026-10-04T15:30:00+09:00"), status: "succeeded"), now: now)?.kind, .addable)
    XCTAssertNil(ScheduleCard.card(prop("p", start: .string("2026-10-04T15:30:00+09:00"), action: "create_reminder"), now: now))
    XCTAssertNil(ScheduleCard.card(prop("p", start: nil), now: now))
    XCTAssertNil(ScheduleCard.card(prop("p", start: .null), now: now))
    XCTAssertNil(ScheduleCard.card(prop("p", start: .string("2026-10-04T15:30")), now: now))
    XCTAssertEqual(ScheduleCard.card(prop("p", start: .string("2026-10-04T15:30:00+09:00"), title: "  "), now: now)?.title, "일정")
  }

  /// 일정 기간이 있으면 그 안에서 시작하는 것만, 다가올 일정 시작 순 → 지난 일정 최근 것부터,
  /// 같은 시작(분)·제목은 한 장(succeeded 가 대표 — 초 차이·입력 순서 무관), 최대 3 + 넘친 수
  func testPick() {
    let ps = [
      prop("c", start: .string("2026-10-06T10:00:00+09:00"), title: "합성 셋"),
      prop("a2", start: .string("2026-10-04T15:30:00+09:00")),
      prop("a1", start: .string("2026-10-04T15:30:00+09:00"), title: " 합성의원 진료 예약", status: "succeeded"),
      prop("b", start: .string("2026-10-05T09:00:00+09:00"), title: "합성 둘"),
      prop("d", start: .string("2026-10-07T09:00:00+09:00"), title: "합성 넷"),
      prop("r", start: .string("2026-10-05T09:00:00+09:00"), action: "create_reminder"),
    ]
    let all = ScheduleCard.pick(ps, schedule: nil, now: now)
    XCTAssertEqual(all.cards.map(\.proposal.id), ["a1", "b", "c"]); XCTAssertEqual(all.more, 1)
    let oct5 = DateInterval(start: d("2026-10-04T15:00:00Z"), duration: 86_399)              // 서버 schedule 10/5 00:00:00~23:59:59
    let inDay = ScheduleCard.pick(ps, schedule: oct5, now: now)
    XCTAssertEqual(inDay.cards.map(\.proposal.id), ["b"]); XCTAssertEqual(inDay.more, 0)
    XCTAssertTrue(ScheduleCard.pick(ps, schedule: DateInterval(start: d("2026-10-19T15:00:00Z"), duration: 86_399), now: now).cards.isEmpty)
    XCTAssertTrue(ScheduleCard.pick([], schedule: nil, now: now).cards.isEmpty)
    // 같은 분·다른 초: succeeded 가 대표(입력 순서 무관, Codex #2)
    let secs = [prop("s1", start: .string("2026-10-04T15:30:00+09:00")), prop("s2", start: .string("2026-10-04T15:30:30+09:00"), status: "succeeded")]
    XCTAssertEqual(ScheduleCard.pick(secs, schedule: nil, now: now).cards.map(\.proposal.id), ["s2"])
    XCTAssertEqual(ScheduleCard.pick(secs.reversed(), schedule: nil, now: now).cards.map(\.proposal.id), ["s2"])
    // 지난 일정은 뒤로(최근 것부터) — 추가할 수 있는 카드가 잘리지 않는다(Fable F2)
    let mixed = [prop("old1", start: .string("2026-08-01T10:00:00+09:00"), title: "합성 옛1"), prop("old2", start: .string("2026-09-01T10:00:00+09:00"), title: "합성 옛2"),
                 prop("old3", start: .string("2026-09-20T10:00:00+09:00"), title: "합성 옛3"), prop("next", start: .string("2026-10-04T15:30:00+09:00"))]
    let m = ScheduleCard.pick(mixed, schedule: nil, now: now)
    XCTAssertEqual(m.cards.map(\.proposal.id), ["next", "old3", "old2"]); XCTAssertEqual(m.more, 1)
  }

  /// ① 찾은 곳: SourceLabel 과 같은 문자 판정, 메일·앱 알림·공유, 인용 없으면 "저장된 정보". 받은 날짜는 서울(소수 초 허용)
  func testSourceAndReceivedLines() {
    XCTAssertEqual(ScheduleCard.sourceLine(cite("MESSAGES")), "문자에서 찾은 일정")
    XCTAssertEqual(ScheduleCard.sourceLine(cite("NOTIFICATION", app: "메시지")), "문자에서 찾은 일정")
    XCTAssertEqual(ScheduleCard.sourceLine(cite("NOTIFICATION", app: "카카오톡")), "카카오톡 알림에서 찾은 일정")
    XCTAssertEqual(ScheduleCard.sourceLine(cite("NOTIFICATION")), "앱 알림에서 찾은 일정")
    XCTAssertEqual(ScheduleCard.sourceLine(cite("NOTIFICATION", app: "")), "앱 알림에서 찾은 일정")
    XCTAssertEqual(ScheduleCard.sourceLine(cite("GMAIL")), "메일에서 찾은 일정")
    XCTAssertEqual(ScheduleCard.sourceLine(cite("SHARE")), "공유한 내용에서 찾은 일정")
    XCTAssertEqual(ScheduleCard.sourceLine(nil), "저장된 정보에서 찾은 일정")
    XCTAssertEqual(ScheduleCard.receivedLine(cite("MESSAGES")), "10/1 받은 문자")
    XCTAssertEqual(ScheduleCard.receivedLine(cite("GMAIL", at: "2026-09-30T15:30:00+00:00")), "10/1 받은 메일")     // UTC 9/30 → 서울 10/1
    XCTAssertEqual(ScheduleCard.receivedLine(cite("NOTIFICATION", app: "카카오톡")), "10/1 받은 알림")
    XCTAssertEqual(ScheduleCard.receivedLine(cite("SHARE")), "10/1 공유함")
    XCTAssertNil(ScheduleCard.receivedLine(cite("GMAIL", at: "어제")))
    XCTAssertNil(ScheduleCard.receivedLine(nil))
  }

  /// ② 그날(서울) 줄: 겹친 일정(어느 캘린더든) → 종일 → 시작 순. 표시 대상 캘린더(listed)만·취소·다른 날 제외. 최대 4 + 넘친 수.
  /// 겹침은 값 비교(반복 일정은 회차마다 id 가 같다), 다음 날 0시에 끝나면 그날 안
  func testDayLines() {
    let day = DateInterval(start: d("2026-10-03T15:00:00Z"), duration: 86_400)                     // 10/4(일)
    let sub = ev("sub", "2026-10-04T06:00:00Z", "2026-10-04T07:00:00Z", title: "합성 구독 경기", listed: false)   // 15:00–16:00, 구독 캘린더
    let evs = [
      ev("late", "2026-10-04T09:00:00Z", "2026-10-04T10:00:00Z", title: "합성 저녁"),               // 18:00–19:00
      sub,
      ev("bday", "2026-10-03T15:00:00Z", "2026-10-04T15:00:00Z", title: "합성 생일", allDay: true, listed: false),
      ev("trip", "2026-10-03T15:00:00Z", "2026-10-05T15:00:00Z", title: "합성 여행", allDay: true),
      ev("night", "2026-10-03T14:00:00Z", "2026-10-03T16:00:00Z", title: "합성 야간"),              // 10/3 23:00–10/4 01:00
      ev("x", "2026-10-04T01:00:00Z", "2026-10-04T02:00:00Z", canceled: true),
      ev("prev", "2026-10-02T01:00:00Z", "2026-10-02T02:00:00Z"),
      ev("edge", "2026-10-03T14:00:00Z", "2026-10-03T15:00:00Z"),                                   // 10/3 23:00–24:00 맞닿음 → 그날 아님
      ev("am", "2026-10-04T00:00:00Z", "2026-10-04T01:00:00Z", title: "합성 오전"),                  // 09:00–10:00
    ]
    let l = ScheduleCard.dayLines(day: day, events: evs, conflicts: [sub])
    XCTAssertEqual(l.lines.map(\.text), ["15:00–16:00 합성 구독 경기", "종일 합성 여행", "10/3 23:00–10/4 01:00 합성 야간", "09:00–10:00 합성 오전"])
    XCTAssertEqual(l.lines.map(\.conflict), [true, false, false, false])
    XCTAssertEqual(l.more, 1)                                                                       // 18:00 합성 저녁
    XCTAssertTrue(ScheduleCard.dayLines(day: day, events: [], conflicts: []).lines.isEmpty)
    XCTAssertEqual(ScheduleCard.dayLines(day: day, events: [ev("t", "2026-10-04T00:00:00Z", "2026-10-04T01:00:00Z", title: " ")], conflicts: []).lines.map(\.text),
                   ["09:00–10:00 (제목 없음)"])
    // 매일 반복 일정: 회차마다 id 가 같다 — 겹친 당일 회차만 한 줄(Fable F1)
    let daily = [ev("daily", "2026-10-03T06:00:00Z", "2026-10-03T07:00:00Z"), ev("daily", "2026-10-04T06:00:00Z", "2026-10-04T07:00:00Z"),
                 ev("daily", "2026-10-05T06:00:00Z", "2026-10-05T07:00:00Z")]
    let r = ScheduleCard.dayLines(day: day, events: daily, conflicts: [daily[1]])
    XCTAssertEqual(r.lines.map(\.text), ["15:00–16:00 합성 daily"]); XCTAssertEqual(r.lines.map(\.conflict), [true])
    // 다음 날 0시에 끝남 → 그날 안(§9, Codex #6)
    let mid = ev("mid", "2026-10-04T14:00:00Z", "2026-10-04T15:00:00Z", title: "합성 심야")                // 10/4 23:00–10/5 00:00
    XCTAssertEqual(ScheduleCard.dayLines(day: day, events: [mid], conflicts: []).lines.map(\.text), ["23:00–00:00 합성 심야"])
  }

  /// ③ 등록 판정(§9 상태 1~6): EventKit 표식이 1순위, 실행 기록·서버 succeeded 는 "넣은 적 있음" 보조 근거, 그다음 §10 겹침
  func testStatus() {
    let t = d("2026-10-04T06:30:00Z"), m = ProposalFlow.marker("p-1")
    func s(_ evs: [ProposalFlow.CalendarEvent], server: String = "proposed", executed: Bool = false) -> ScheduleCard.Status {
      ScheduleCard.status(pid: "p-1", title: "합성의원 진료 예약", start: t, serverStatus: server, executed: executed, events: evs)
    }
    let mine = ev("mine", "2026-10-04T06:30:00Z", "2026-10-04T07:30:00Z", title: "합성의원 진료 예약", url: m)
    XCTAssertEqual(s([mine]), .added)
    XCTAssertEqual(s([mine], server: "succeeded", executed: true), .added)
    let moved = ev("mine", "2026-10-05T01:00:00Z", "2026-10-05T02:00:00Z", title: "합성의원 진료 예약", url: m)     // 10/5(월) 10:00
    XCTAssertEqual(s([moved]), .addedMoved(d("2026-10-05T01:00:00Z")))
    XCTAssertEqual(s([ev("same", "2026-10-04T06:30:00Z", "2026-10-04T07:30:00Z", title: " 합성의원 진료 예약 ")]), .sameEvent)
    XCTAssertEqual(s([], server: "succeeded"), .addedMissing)
    XCTAssertEqual(s([], executed: true), .addedMissing)
    let other = ev("o", "2026-10-04T06:00:00Z", "2026-10-04T07:00:00Z", title: "합성 겹침")
    XCTAssertEqual(s([other]), .conflict([other], maybeSame: false))
    XCTAssertEqual(s([other], server: "succeeded"), .addedMissing)                                 // 넣은 적 있으면 겹침보다 앞
    let reNotice = ev("re", "2026-10-04T06:30:00Z", "2026-10-04T07:30:00Z", title: "합성의원 예약 재안내", url: ProposalFlow.marker("p-2"))
    XCTAssertEqual(s([reNotice]), .conflict([reNotice], maybeSame: true))
    let canceledMine = ev("c", "2026-10-04T06:30:00Z", "2026-10-04T07:30:00Z", title: "합성의원 진료 예약", canceled: true, url: m)
    XCTAssertEqual(s([canceledMine]), .clear)                                                      // 취소된 일정은 없는 것
    XCTAssertEqual(s([ev("touch", "2026-10-04T05:30:00Z", "2026-10-04T06:30:00Z")]), .clear)         // 맞닿음
    XCTAssertEqual(s([]), .clear)
  }

  func testStatusText() {
    let o = ev("o", "2026-10-04T06:00:00Z", "2026-10-04T07:00:00Z", title: "합성 겹침")
    let o2 = ev("o2", "2026-10-04T06:45:00Z", "2026-10-04T07:15:00Z")
    let night = ev("n", "2026-10-03T14:00:00Z", "2026-10-04T07:00:00Z", title: "합성 야간")
    XCTAssertEqual(ScheduleCard.statusText(.added), "✅ 캘린더에 등록됨")
    XCTAssertEqual(ScheduleCard.statusText(.addedMoved(d("2026-10-05T01:00:00Z"))), "✅ 캘린더에 등록됨 · 캘린더에서는 10/5(월) 10:00")
    XCTAssertEqual(ScheduleCard.statusText(.sameEvent), "✅ 같은 일정이 캘린더에 있음")
    XCTAssertEqual(ScheduleCard.statusText(.addedMissing), "이전에 추가한 일정 · 이 날 캘린더에서는 찾지 못함(옮겼거나 지웠을 수 있음)")
    XCTAssertEqual(ScheduleCard.statusText(.conflict([o], maybeSame: false)), "⚠️ 아직 캘린더에 없음 · 겹치는 일정 15:00–16:00 합성 겹침")
    XCTAssertEqual(ScheduleCard.statusText(.conflict([o, o2], maybeSame: true)),
                   "⚠️ 아직 캘린더에 없음 · 겹치는 일정 15:00–16:00 합성 겹침 외 1건 (같은 일정일 수 있음)")
    XCTAssertEqual(ScheduleCard.statusText(.conflict([night], maybeSame: false)), "⚠️ 아직 캘린더에 없음 · 겹치는 일정 10/3 23:00–10/4 16:00 합성 야간")
    let mid = ev("mid", "2026-10-04T14:00:00Z", "2026-10-04T15:00:00Z", title: "합성 심야")                // 줄과 같은 표기(자정 끝 = 그날 안)
    XCTAssertEqual(ScheduleCard.statusText(.conflict([mid], maybeSame: false)), "⚠️ 아직 캘린더에 없음 · 겹치는 일정 23:00–00:00 합성 심야")
    XCTAssertEqual(ScheduleCard.statusText(.clear), "아직 캘린더에 없음")
  }

  /// 카드 모델·버튼: 버튼은 시각 있는 미래 제안이 "아직 없음"(추가)·겹침(겹쳐도 추가)일 때만.
  /// 캘린더를 못 읽으면(전체 접근 없음) 상태·줄·버튼 없음 — 시각 없음·확인 필요·지난 일정 문구는 남는다
  func testModel() throws {
    let c = try XCTUnwrap(ScheduleCard.card(prop("p-1", start: .string("2026-10-04T15:30:00+09:00")), now: now))
    let o = ev("o", "2026-10-04T06:00:00Z", "2026-10-04T07:00:00Z", title: "합성 겹침")
    let conflict = ScheduleCard.model(c, events: [o], executed: false)
    XCTAssertEqual(conflict.status, .conflict([o], maybeSame: false))
    XCTAssertEqual(ScheduleCard.action(conflict), .addAnyway)
    XCTAssertEqual(conflict.lines?.map(\.conflict), [true])
    XCTAssertTrue(ScheduleCard.isWarning(conflict))
    XCTAssertEqual(conflict.startText, "2026-10-04T15:30:00+09:00"); XCTAssertEqual(conflict.pid, "p-1"); XCTAssertEqual(conflict.itemID, "item-1")
    XCTAssertEqual(ScheduleCard.whenLine(conflict), "10/4(일) 15:30 합성의원 진료 예약")
    XCTAssertEqual(ScheduleCard.dayHeader(conflict.day), "내 캘린더 · 10/4(일)")
    XCTAssertEqual(conflict.day, DateInterval(start: d("2026-10-03T15:00:00Z"), duration: 86_400))
    let clear = ScheduleCard.model(c, events: [], executed: false)
    XCTAssertEqual(ScheduleCard.action(clear), .add); XCTAssertEqual(clear.lines, []); XCTAssertFalse(ScheduleCard.isWarning(clear))
    XCTAssertEqual(ScheduleCard.statusText(clear), "아직 캘린더에 없음")
    XCTAssertNil(ScheduleCard.action(ScheduleCard.model(c, events: [], executed: true)))                // 이전에 추가함
    let noAccess = ScheduleCard.model(c, events: nil, executed: false)
    XCTAssertNil(noAccess.status); XCTAssertNil(noAccess.lines); XCTAssertNil(ScheduleCard.action(noAccess)); XCTAssertNil(ScheduleCard.statusText(noAccess))
    let past = ScheduleCard.model(try XCTUnwrap(ScheduleCard.card(prop("p-2", start: .string("2026-09-30T15:30:00+09:00")), now: now)), events: [], executed: false)
    XCTAssertNil(past.status); XCTAssertNil(ScheduleCard.action(past)); XCTAssertEqual(ScheduleCard.statusText(past), "지난 일정")
    let dateOnly = ScheduleCard.model(try XCTUnwrap(ScheduleCard.card(prop("p-3", start: .string("2026-10-05")), now: now)), events: nil, executed: false)
    XCTAssertEqual(ScheduleCard.statusText(dateOnly), "날짜만 확인돼 바로 추가하지 않음")
    XCTAssertEqual(ScheduleCard.whenLine(dateOnly), "10/5(월) 시간 미정 합성의원 진료 예약")
    let review = ScheduleCard.model(try XCTUnwrap(ScheduleCard.card(prop("p-4", start: .string("2026-10-05T10:00:00+09:00"), uncertain: ["year"]), now: now)),
                                    events: [], executed: false)
    XCTAssertEqual(ScheduleCard.statusText(review), "내용 확인이 필요해 바로 추가하지 않음"); XCTAssertNil(ScheduleCard.action(review))
    XCTAssertEqual(ScheduleCard.buttonTitle(.add), "캘린더에 추가"); XCTAssertEqual(ScheduleCard.buttonTitle(.addAnyway), "겹쳐도 추가")
    XCTAssertEqual(ScheduleCard.moreText(2), "일정 제안 2건 더 있음")
    XCTAssertEqual(ScheduleCard.emptyDayText, "이 날 등록된 일정 없음")
  }

  /// "기기 캘린더" 절을 카드와 같이 그릴지: 일정 기간이 있고, 카드가 없거나 기간이 카드 날짜 하루보다 넓을 때(C1-1 회귀 방지)
  func testShowsRangeSection() {
    let d4 = DateInterval(start: d("2026-10-03T15:00:00Z"), duration: 86_400)
    let oneDay = DateInterval(start: d("2026-10-03T15:00:00Z"), duration: 86_399)
    let week = DateInterval(start: d("2026-10-04T15:00:00Z"), end: d("2026-10-11T14:59:59Z"))
    XCTAssertFalse(ScheduleCard.showsRangeSection(schedule: nil, cardDays: [d4]))
    XCTAssertFalse(ScheduleCard.showsRangeSection(schedule: nil, cardDays: []))
    XCTAssertFalse(ScheduleCard.showsRangeSection(schedule: oneDay, cardDays: [d4]))
    XCTAssertTrue(ScheduleCard.showsRangeSection(schedule: oneDay, cardDays: []))
    XCTAssertTrue(ScheduleCard.showsRangeSection(schedule: week, cardDays: [DateInterval(start: d("2026-10-05T15:00:00Z"), duration: 86_400)]))
    XCTAssertTrue(ScheduleCard.showsRangeSection(schedule: DateInterval(start: d("2026-10-04T15:00:00Z"), duration: 86_399), cardDays: [d4]))
    XCTAssertEqual(ScheduleCard.seoulDay(d("2026-10-04T14:59:59Z")), d4)                          // 서울 23:59:59 는 그날
  }
}
```

- [ ] **Step 2: 실패 확인**

Run: `vm_stat | grep -E 'free|compressor'; pgrep -x deno; cd ios && ./scripts/sim.sh gen && ./scripts/sim.sh test EruriCoreTests/ScheduleCardTests`
Expected: FAIL — `error:` 줄(`ScheduleCard` 없음, `CalendarEvent` init 에 `listed` 없음). `sim.sh test`는 `Test Case|passed|failed|error:` 줄만 보인다.

- [ ] **Step 3: `CalendarEvent.listed`**

`ProposalFlow.swift`의 `CalendarEvent`를 다음으로 바꾼다(필드 하나와 init 마지막 인자만 늘어난다 — 기존 호출은 그대로 컴파일된다):

```swift
  /// 기기 캘린더 일정 한 건(EventKit 을 모르는 판단용 값). 앱 CalendarLookup 이 EKEvent 에서 만든다
  public struct CalendarEvent: Equatable, Sendable {
    public let id: String; public let title: String; public let start: Date; public let end: Date
    public let allDay: Bool; public let canceled: Bool; public let url: URL?
    /// 채팅 일정 답 카드의 줄로 보일 캘린더인가(생일·구독 캘린더 = false). 겹침 판정에는 쓰지 않는다 — 겹친 일정은 어느 캘린더든 보인다(§9)
    public let listed: Bool
    public init(id: String, title: String, start: Date, end: Date, allDay: Bool = false, canceled: Bool = false, url: URL? = nil,
                listed: Bool = true) {
      self.id = id; self.title = title; self.start = start; self.end = end; self.allDay = allDay; self.canceled = canceled; self.url = url
      self.listed = listed
    }
  }
```

- [ ] **Step 4: `ScheduleCard.swift`**

Create `ios/Packages/EruriCore/Sources/EruriCore/ScheduleCard.swift`:

```swift
import Foundation

/// 채팅 일정 답 카드(스펙 §9 "일정 답 카드", 앱 0.8.2): 제안 한 건을 ① 찾은 곳 ② 그날 내 캘린더 ③ 상태·버튼 한 묶음으로 보인다.
/// EventKit·SwiftUI 없이 판단·문구만 — 읽기는 앱 CalendarLookup. 캘린더 내용은 기기 밖으로 나가지 않는다(§12 통제 2)
public enum ScheduleCard {
  /// 제안 시각의 종류. addable 만 캘린더 대조 상태와 버튼이 있다
  public enum Kind: Equatable, Sendable { case addable, dateOnly, needsReview, past }

  /// 카드로 고른 제안. start = 시각, 날짜만이면 그날 서울 0시
  public struct Pick: Sendable {
    public let proposal: ChatReply.Proposal; public let kind: Kind; public let start: Date; public let timed: Bool
    public var title: String { ScheduleCard.title(proposal) }
    public var day: DateInterval { ScheduleCard.seoulDay(start) }
  }

  public static let maxCards = 3, maxLines = 4

  /// 카드로 보일 제안이면 Pick: create_event 이고 start 가 오프셋 있는 시각(handleAdd 와 같은 파서)이거나 날짜만(YYYY-MM-DD).
  /// 지남(시각 < now, 날짜만은 그날이 끝남) → past, uncertain → needsReview, 날짜만 → dateOnly, 나머지 addable. 서버 상태는 보지 않는다(상태는 캘린더 대조가 정한다)
  public static func card(_ p: ChatReply.Proposal, now: Date = Date()) -> Pick? {
    guard p.action == "create_event", let s = p.payload["start"]?.string else { return nil }
    let uncertain: Bool = { if case .array(let u)? = p.payload["uncertain"] { return !u.isEmpty }; return false }()
    if let at = iso.date(from: s) {
      return Pick(proposal: p, kind: at < now ? .past : uncertain ? .needsReview : .addable, start: at, timed: true)
    }
    guard s.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil, let day = dayParser.date(from: s) else { return nil }
    return Pick(proposal: p, kind: seoulDay(day).end <= now ? .past : uncertain ? .needsReview : .dateOnly, start: day, timed: false)
  }

  /// 한 답의 카드: 일정 기간이 있으면 그 안에서 시작하는 것만(인용 항목의 무관한 일정 제외), 다가올 일정을 시작 순으로 먼저,
  /// 지난 일정은 그 뒤에 최근 것부터(추가할 수 있는 카드가 "N건 더 있음"으로 밀리지 않게). 같은 시작(분)·제목은 한 장(succeeded 가 있으면 그것), 최대 3 + 넘친 수
  public static func pick(_ ps: [ChatReply.Proposal], schedule: DateInterval?, now: Date = Date()) -> (cards: [Pick], more: Int) {
    let rank = { (c: Pick) in c.proposal.status == "succeeded" ? 0 : 1 }
    // 다가올 일정 먼저(시작 순), 지난 일정은 그 뒤(최근 것부터). 1순위가 분이라 같은 분·제목 묶음에서 succeeded 가 대표가 된다(초 차이 무시)
    let key = { (c: Pick) -> (Int, Int, Int, String) in
      c.kind == .past ? (1, -minute(c.start), rank(c), c.proposal.id) : (0, minute(c.start), rank(c), c.proposal.id)
    }
    let sorted = ps.compactMap { card($0, now: now) }
      .filter { c in schedule.map { $0.start <= c.start && c.start <= $0.end } ?? true }
      .sorted { key($0) < key($1) }
    var seen = Set<String>(), out: [Pick] = []
    for c in sorted where seen.insert("\(minute(c.start))|\(c.title)").inserted { out.append(c) }
    return (Array(out.prefix(maxCards)), max(0, out.count - maxCards))
  }

  // MARK: ① 찾은 곳

  /// "문자에서 찾은 일정" — 같은 응답의 인용(item_id 일치)에서. 인용이 없으면 "저장된 정보에서 찾은 일정"
  public static func sourceLine(_ c: ChatReply.Citation?) -> String { "\(origin(c).found)에서 찾은 일정" }
  /// "10/1 받은 문자"(서울). 인용이 없거나 시각을 못 읽으면 nil
  public static func receivedLine(_ c: ChatReply.Citation?) -> String? {
    guard let c, let at = iso.date(from: c.occurred_at.replacingOccurrences(of: #"\.\d+"#, with: "", options: .regularExpression)) else { return nil }
    return "\(md.string(from: at)) \(origin(c).received)"
  }
  private static func origin(_ c: ChatReply.Citation?) -> (found: String, received: String) {
    guard let c else { return ("저장된 정보", "저장") }
    switch c.source {
    case "MESSAGES": return ("문자", "받은 문자")
    case "NOTIFICATION":
      if SourceLabel.label(source: c.source, appName: c.app_name) == "문자" { return ("문자", "받은 문자") }
      return ("\(c.app_name.flatMap { $0.isEmpty ? nil : $0 } ?? "앱") 알림", "받은 알림")
    case "GMAIL": return ("메일", "받은 메일")
    case "SHARE": return ("공유한 내용", "공유함")
    default: return ("저장된 정보", "저장")
    }
  }

  // MARK: ② 그날 내 캘린더

  public struct DayLine: Equatable, Sendable { public let text: String; public let conflict: Bool }
  public static let emptyDayText = "이 날 등록된 일정 없음"
  public static func dayHeader(_ day: DateInterval) -> String { "내 캘린더 · \(dayLabel(day.start))" }

  /// 그날(서울 하루) 줄: 겹친 일정(어느 캘린더든, 그날 밖이어도) → 종일 → 시작 순. 나머지는 표시 대상 캘린더(listed)만, 취소 제외. 최대 4 + 넘친 수
  public static func dayLines(day: DateInterval, events: [ProposalFlow.CalendarEvent],
                              conflicts: [ProposalFlow.CalendarEvent]) -> (lines: [DayLine], more: Int) {
    // id 만 보면 안 된다 — 반복 일정은 회차마다 id(eventIdentifier)가 같고 카드는 ±1일을 읽는다
    let isHit = { (e: ProposalFlow.CalendarEvent) in conflicts.contains(e) }
    let shown = events.filter { e in
      !e.canceled && (isHit(e) || (e.listed && e.start < day.end && (e.end > day.start || (e.start == e.end && e.start >= day.start))))
    }
    let rank = { (e: ProposalFlow.CalendarEvent) in isHit(e) ? 0 : e.allDay ? 1 : 2 }
    let lines = shown.sorted { (rank($0), $0.start, $0.id) < (rank($1), $1.start, $1.id) }
      .map { DayLine(text: "\(span($0, within: day)) \(name($0))", conflict: isHit($0)) }
    return (Array(lines.prefix(maxLines)), max(0, lines.count - maxLines))
  }

  // MARK: ③ 상태

  public enum Status: Equatable, Sendable {
    case added, addedMoved(Date), sameEvent, addedMissing
    case conflict([ProposalFlow.CalendarEvent], maybeSame: Bool)
    case clear
  }

  /// 등록 판정(§9 상태 1~6). events = 카드 날짜 ±1일 일정(표식이 옮겨졌어도 찾는다). 캘린더 실제 상태가 1순위이고
  /// 실행 기록·서버 succeeded 는 "넣은 적 있음"의 보조 근거(succeeded 만으로 "등록됨"이라 하지 않는다). 최종 판정은 AddEventGate
  public static func status(pid: String, title: String, start: Date, serverStatus: String, executed: Bool,
                            events: [ProposalFlow.CalendarEvent]) -> Status {
    let live = events.filter { !$0.canceled }, m = ProposalFlow.marker(pid), name = trimmed(title)
    if let mine = live.filter({ $0.url == m }).min(by: { abs($0.start.timeIntervalSince(start)) < abs($1.start.timeIntervalSince(start)) }) {
      return minute(mine.start) == minute(start) ? .added : .addedMoved(mine.start)
    }
    if live.contains(where: { minute($0.start) == minute(start) && trimmed($0.title) == name }) { return .sameEvent }
    if executed || serverStatus == "succeeded" { return .addedMissing }
    let c = ProposalFlow.conflicts(pid: pid, start: start, events: events)
    if c.isEmpty { return .clear }
    // 같은 예약의 재안내 → 다른 제안이 이미 넣은 일정(Fable #10). 자동 차단은 하지 않는다 — 오판이면 추가할 길이 없어진다
    let same = c.contains { $0.url?.absoluteString.hasPrefix(markerPrefix) == true && minute($0.start) == minute(start) }
    return .conflict(c, maybeSame: same)
  }

  public static func statusText(_ s: Status) -> String {
    switch s {
    case .added: return "✅ 캘린더에 등록됨"
    case .addedMoved(let d): return "✅ 캘린더에 등록됨 · 캘린더에서는 \(dayLabel(d)) \(hm.string(from: d))"
    case .sameEvent: return "✅ 같은 일정이 캘린더에 있음"
    case .addedMissing: return "이전에 추가한 일정 · 이 날 캘린더에서는 찾지 못함(옮겼거나 지웠을 수 있음)"
    case .conflict(let cs, let same):
      guard let f = cs.first else { return "⚠️ 아직 캘린더에 없음" }
      return "⚠️ 아직 캘린더에 없음 · 겹치는 일정 \(span(f)) \(name(f))" + (cs.count > 1 ? " 외 \(cs.count - 1)건" : "") + (same ? " (같은 일정일 수 있음)" : "")
    case .clear: return "아직 캘린더에 없음"
    }
  }

  // MARK: 카드 모델·버튼

  public struct Model: Equatable, Sendable {
    public let pid: String; public let itemID: String; public let title: String
    /// 제안 payload 의 start 원문 — handleAdd 에 그대로 넘긴다(같은 파서)
    public let startText: String
    public let kind: Kind; public let start: Date; public let timed: Bool
    /// addable 이고 캘린더를 읽었을 때만
    public let status: Status?
    /// nil = 캘린더를 읽지 못함(전체 접근 없음) — 그 자리에 허용 안내
    public let lines: [DayLine]?
    public let moreLines: Int
    public var day: DateInterval { ScheduleCard.seoulDay(start) }
  }

  /// 카드 한 장. events = 카드 날짜 ±1일의 모든 캘린더 일정(앱 CalendarLookup.cardEvents), nil = 전체 접근 없음. executed = 이 기기 실행 기록
  public static func model(_ c: Pick, events: [ProposalFlow.CalendarEvent]?, executed: Bool) -> Model {
    let st: Status? = c.kind == .addable ? events.map {
      status(pid: c.proposal.id, title: c.title, start: c.start, serverStatus: c.proposal.status, executed: executed, events: $0)
    } : nil
    var conflicts: [ProposalFlow.CalendarEvent] = []
    if case .conflict(let cs, _)? = st { conflicts = cs }
    let l = events.map { dayLines(day: c.day, events: $0, conflicts: conflicts) }
    return Model(pid: c.proposal.id, itemID: c.proposal.item_id, title: c.title, startText: c.proposal.payload["start"]?.string ?? "",
                 kind: c.kind, start: c.start, timed: c.timed, status: st, lines: l?.lines, moreLines: l?.more ?? 0)
  }

  public enum Action: Equatable, Sendable { case add, addAnyway }
  /// 버튼: 시각 있는 미래 제안이 "아직 없음"이면 캘린더에 추가, 겹침이면 겹쳐도 추가(확인창 없음, §10). 그 밖은 없음
  public static func action(_ m: Model) -> Action? {
    guard m.kind == .addable else { return nil }
    switch m.status {
    case .clear?: return .add
    case .conflict?: return .addAnyway
    default: return nil
    }
  }
  public static func buttonTitle(_ a: Action) -> String { a == .add ? "캘린더에 추가" : "겹쳐도 추가" }
  /// 상태 줄: 캘린더 대조 상태, 없으면 종류 문구(시각 없음·확인 필요·지난 일정). 시각 있는 미래 제안인데 캘린더를 못 읽었으면 nil(안내가 대신한다)
  public static func statusText(_ m: Model) -> String? {
    if let s = m.status { return statusText(s) }
    switch m.kind {
    case .addable: return nil
    case .dateOnly: return "날짜만 확인돼 바로 추가하지 않음"
    case .needsReview: return "내용 확인이 필요해 바로 추가하지 않음"
    case .past: return "지난 일정"
    }
  }
  public static func isWarning(_ m: Model) -> Bool { if case .conflict? = m.status { return true }; return false }
  /// "10/4(일) 15:30 제목", 날짜만이면 "10/4(일) 시간 미정 제목"
  public static func whenLine(_ m: Model) -> String { "\(dayLabel(m.start)) \(m.timed ? hm.string(from: m.start) : "시간 미정") \(m.title)" }
  public static func moreText(_ n: Int) -> String { "일정 제안 \(n)건 더 있음" }

  /// "기기 캘린더" 절을 카드와 같이 그릴지(§9): 일정 기간이 있고, 카드가 없거나 기간이 카드 날짜 하루(서울)보다 넓을 때
  public static func showsRangeSection(schedule: DateInterval?, cardDays: [DateInterval]) -> Bool {
    guard let s = schedule else { return false }
    guard !cardDays.isEmpty else { return true }
    let day = seoulDay(s.start)
    return !(s.start == day.start && s.end < day.end && cardDays.allSatisfy { $0 == day })
  }
  public static func seoulDay(_ d: Date) -> DateInterval { DateInterval(start: seoul.startOfDay(for: d), duration: 86_400) }

  // MARK: 내부

  static func title(_ p: ChatReply.Proposal) -> String {
    let t = trimmed(p.payload["title"]?.string ?? "")
    return t.isEmpty ? "일정" : t
  }
  /// 종일이면 "종일". day 안에 다 들면 "HH:mm–HH:mm", 아니면 "M/d HH:mm–M/d HH:mm". day 없이 부르면(상태 문구) 일정이 시작한 서울 하루로 판단 —
  /// 다음 날 0시에 끝나면 그날 안("23:00–00:00", §9). 줄과 상태 문구가 같은 일정을 같은 표기로 쓴다
  static func span(_ e: ProposalFlow.CalendarEvent, within day: DateInterval? = nil) -> String {
    if e.allDay { return "종일" }
    let d = day ?? seoulDay(e.start)
    let inside = e.start >= d.start && e.end <= d.end
    let f = inside ? hm : mdhm
    return "\(f.string(from: e.start))–\(f.string(from: e.end))"
  }
  private static func name(_ e: ProposalFlow.CalendarEvent) -> String { let t = trimmed(e.title); return t.isEmpty ? "(제목 없음)" : t }
  private static func trimmed(_ s: String) -> String { s.trimmingCharacters(in: .whitespacesAndNewlines) }
  private static func minute(_ d: Date) -> Int { Int((d.timeIntervalSince1970 / 60).rounded(.down)) }
  /// "10/4(일)"
  static func dayLabel(_ d: Date) -> String { "\(md.string(from: d))(\(weekdays[seoul.component(.weekday, from: d) - 1]))" }

  private static let markerPrefix = "assistant://proposal/"                  // ProposalFlow.marker 의 접두
  private static let weekdays = ["일", "월", "화", "수", "목", "금", "토"]      // Calendar.weekday 1 = 일요일
  private static let seoul: Calendar = {
    var c = Calendar(identifier: .gregorian)
    c.timeZone = TimeZone(identifier: "Asia/Seoul")!
    return c
  }()
  // handleAdd·ChatReply 와 같은 파서여야 카드 시각과 실행이 어긋나지 않는다. SDK 가 Sendable 표시를 안 해서 unsafe(설정 후 읽기만)
  nonisolated(unsafe) private static let iso = ISO8601DateFormatter()
  private static let hm = seoulFormatter("HH:mm"), md = seoulFormatter("M/d"), mdhm = seoulFormatter("M/d HH:mm"), dayParser = seoulFormatter("yyyy-MM-dd")
  private static func seoulFormatter(_ format: String) -> DateFormatter {
    let f = DateFormatter()
    f.locale = Locale(identifier: "en_US_POSIX"); f.timeZone = TimeZone(identifier: "Asia/Seoul"); f.dateFormat = format
    return f
  }
}
```

- [ ] **Step 5: 통과 확인**

Run: `cd ios && ./scripts/sim.sh test EruriCoreTests/ScheduleCardTests`
Expected: `Test Case … passed` 8줄, `failed`·`error:` 0줄(`sim.sh test`는 `Test Case|passed|failed|error:` 줄만 보인다).
Run: `cd ios && ./scripts/sim.sh test EruriCoreTests`
Expected: 전체 통과(기존 `ProposalFlowTests`·`DeviceCalendarTests`는 `listed` 기본값으로 그대로 컴파일).

- [ ] **Step 6: 커밋**

```bash
git add ios/Packages/EruriCore/Sources/EruriCore/ScheduleCard.swift ios/Packages/EruriCore/Sources/EruriCore/ProposalFlow.swift ios/Packages/EruriCore/Tests/EruriCoreTests/ScheduleCardTests.swift
git commit -m "feat(core): schedule answer card — pick ≤3 in the schedule range (upcoming first, succeeded represents a minute·title group), source and received lines, that day's lines with conflicts first (value match for recurring events), six-way calendar status and button (0.8.2, T1)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task T2: 앱 일정 답 카드 — 조회·뷰·버튼 스타일·스크롤·권한 안내 버튼

**Files:**
- Modify: `ios/App/CalendarLookup.swift` (`value`의 `listed`, `cardEvents` 추가, `cardStatuses` 삭제)
- Modify: `ios/App/ChatView.swift` (`Turn`, 스크롤 상태, `body`의 List 감싸기, `answerRows`, `calendarRows`의 안내 콜백, `cardRows`·`statusRow`·`addButton` 추가, `proposalCard` 삭제, `readCalendar`·`refreshCalendars`·`recheck`·`executed`, `send`)
- Modify: `ios/App/ProposalsView.swift` (`CalendarAccessPrompt`만)
- Modify: `ios/Packages/EruriCore/Sources/EruriCore/DeviceCalendar.swift` (`CardStatus`·`cardStatus`·`statusText` 삭제)
- Modify: `ios/Packages/EruriCore/Sources/EruriCore/ChatReply.swift` (`calendarStart` 삭제)
- Modify: `ios/Packages/EruriCore/Tests/EruriCoreTests/DeviceCalendarTests.swift` (`testCardStatus` 삭제), `ChatReplyTests.swift` (`testCalendarStartOnlyForTimedCertainProposed`·`testCalendarStartSkipsPast` 삭제 — 같은 조건은 T1 `testCardKinds`가 덮는다)

**Interfaces:**
- Consumes: T1 전부, `NotificationActions.handleAdd`, `ProposalFlow.tapConfirmed`·`needsConfirm`, `Executions.shared()`, `ItemDetailView(itemID:)`, `ArchiveRouter`, `CalendarLookup.scheduleEvents`·`events`·`store`·`fullAccess`.
- Produces: `@MainActor CalendarLookup.cardEvents(day: DateInterval) -> [ProposalFlow.CalendarEvent]?`(전체 접근 없으면 nil), `ChatView.Turn.cards: [ScheduleCard.Model]`·`cardsMore: Int`, 카드 버튼 접근성 식별자 `scheduleCard.add`(T3 XCUITest가 쓴다), 버튼 라벨 "캘린더에 추가"·"겹쳐도 추가"·"추가하는 중…".

- [ ] **Step 1: `CalendarLookup` — `listed`·`cardEvents`, `cardStatuses` 삭제**

`value(_:)`를 바꾼다:

```swift
  static func value(_ e: EKEvent) -> ProposalFlow.CalendarEvent? {
    guard let s = e.startDate, let t = e.endDate else { return nil }
    // 생일·구독(공휴일) 캘린더는 채팅 카드 줄에서 뺀다(겹침 판정에는 쓴다, §9 일정 답 카드). calendar 는 SDK 상 EKCalendar! — 옵셔널로 읽는다
    let listed = e.calendar.map { $0.type != .birthday && $0.type != .subscription } ?? true
    return ProposalFlow.CalendarEvent(id: e.eventIdentifier ?? e.calendarItemIdentifier, title: e.title ?? "", start: s, end: t,
                                      allDay: e.isAllDay, canceled: e.status == .canceled, url: e.url, listed: listed)
  }
```

`cardStatuses(_:)` 함수(주석 포함 `/// 채팅 제안 카드 상태(§9)…`부터 닫는 `}`까지)를 지우고 그 자리에 넣는다:

```swift
  /// 일정 답 카드(§9, 0.8.2): 카드 날짜(서울 하루) ±1일의 모든 캘린더 일정 — 한 번 읽어 그날 줄(생일·구독은 listed=false)·등록 판정(표식 ±1일)·
  /// 겹침에 같이 쓴다. 전체 접근이 없으면 nil(카드는 그 자리에 안내). 공유 store, 진단 로그 없음(호출부가 카드 수만 남긴다)
  @MainActor static func cardEvents(day: DateInterval) -> [ProposalFlow.CalendarEvent]? {
    guard fullAccess else { return nil }
    return events(store, from: day.start.addingTimeInterval(-86_400), to: day.end.addingTimeInterval(86_400))
  }
```

- [ ] **Step 2: `CalendarAccessPrompt` — `Link` → `Button`+`openURL`**

`ProposalsView.swift`의 `struct CalendarAccessPrompt`를 다음으로 바꾼다(`CalendarAccessSection`은 그대로 — 제안 탭 Section 의 단독 행이라 0.8.1 게이트에서 문제가 없었다):

```swift
struct CalendarAccessPrompt: View {
  let message: String
  let onChange: () -> Void
  @Environment(\.openURL) private var openURL
  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      Text(message).font(.caption).foregroundStyle(.secondary)
      if EKEventStore.authorizationStatus(for: .event) == .notDetermined {
        Button("캘린더 접근 허용") {
          Task {
            _ = try? await EKEventStore().requestFullAccessToEvents()
            NotificationActions.register()
            onChange()
          }
        }.buttonStyle(.borderless).font(.caption)
      } else if let url = URL(string: UIApplication.openSettingsURLString) {
        // Link 는 List 행 안에서 행 탭 경로로 동작해 채팅 목록의 탭 제스처와 겹치면 1회 탭이 먹지 않았다(0.8.1 게이트 C1-4: 3회째에 열림).
        // 자기 제스처를 갖는 borderless 버튼으로 연다
        Button("설정에서 허용하기") { openURL(url) }.buttonStyle(.borderless).font(.caption)
      }
    }
  }
}
```

- [ ] **Step 3: `ChatView` — `Turn`·스크롤 상태**

`struct Turn`을 바꾼다:

```swift
  struct Turn: Identifiable {
    let id = UUID(); let question: String; var answer: ChatReply.Answer?; var error: String?
    var calendar: [ProposalFlow.CalendarEvent]?   // "기기 캘린더" 절(§9): 일정 기간의 기기 일정. nil = 일정 질문 아님·읽지 않음·카드가 그 하루를 대신함
    var cards: [ScheduleCard.Model] = []          // 일정 답 카드(§9, 0.8.2): 시작 순 최대 3
    var cardsMore = 0                             // 카드로 못 보인 제안 수
  }
```

`@State private var confirm: ConfirmAdd?` 줄 위에 더한다:

```swift
  struct ScrollRequest: Equatable { let id: UUID; let seq: Int }
  @State private var scrollRequest: ScrollRequest?     // 보낼 때·답이 올 때 그 질문이 보이게(턴이 화면보다 길면 맨 위, 0.8.2 — 카드가 입력 패널·키보드 뒤에 깔리지 않게)
```

- [ ] **Step 4: `ChatView.body` — List 를 `ScrollViewReader`로 감싼다**

`body`를 다음으로 바꾼다(List 의 기존 수식어는 순서·내용 그대로 List 에 붙어 있고, 질문 행에 `.id(t.id)`와 마지막 `onChange(of: scrollRequest)`만 늘었다). 스크롤은 다음 메인 턴으로 미룬다 — 답 행 삽입과 같은 갱신에서 `scrollTo`를 부르면 List 가 새 행을 배치하기 전 높이로 계산해 카드가 다시 패널 뒤에 남을 수 있다(추론, T3 G1b 가 앞 턴 2개를 쌓고 판정한다):

```swift
  var body: some View {
    NavigationStack {
      ScrollViewReader { proxy in
        List {
          ForEach(turns) { t in
            Section {
              Text(t.question).font(.subheadline).foregroundStyle(.secondary).id(t.id)
              if let e = t.error { Text(e).foregroundStyle(.red) }
              if let a = t.answer { answerRows(t, a) }
              else if t.error == nil { ProgressView() }
            }
          }
        }
        .scrollDismissesKeyboard(.interactively)
        .scrollBounceBehavior(.always)   // 대화가 비었거나 짧아 넘치지 않아도 끌려서 아래로 쓸면 키보드가 내려간다
        .simultaneousGesture(TapGesture().onEnded { inputFocused = false })   // 목록 탭은 행 버튼·링크를 막지 않고 포커스만 푼다
        .safeAreaInset(edge: .bottom) { inputPanel }
        .confirmationDialog(ProposalFlow.confirmTitle(confirm?.conflicts ?? []),
                            isPresented: Binding(get: { confirm != nil }, set: { if !$0 { confirm = nil } }),
                            titleVisibility: .visible, presenting: confirm) { c in
          Button("추가") { runAdd(c, confirmed: true) }
          Button("취소", role: .cancel) {}
        }
        .navigationTitle("채팅")
        .onAppear { dictation.onText = { input = $0 }; dictation.refresh() }
        .onDisappear { dictation.stopIfRecording() }
        // 백그라운드·전화로 비활성이 되면 녹음을 끊고, 돌아오면 권한을 다시 읽는다(설정에서 허용하고 온 경우).
        // 캘린더 절·카드도 다시 읽는다(설정에서 캘린더 권한·캘린더 앱에서 일정을 바꾸고 온 경우, Codex #6)
        .onChange(of: scenePhase) { _, p in if p == .active { dictation.refresh(); refreshCalendars() } else { dictation.stopIfRecording() } }
        // 새 행이 목록에 놓인 다음 턴에 스크롤한다 — 같은 갱신에서 부르면 옛 높이로 계산돼 카드가 패널 뒤에 남을 수 있다
        .onChange(of: scrollRequest) { _, r in
          guard let r else { return }
          Task { @MainActor in withAnimation { proxy.scrollTo(r.id, anchor: .top) } }
        }
      }
    }
  }

  private func scroll(to id: UUID) { scrollRequest = ScrollRequest(id: id, seq: (scrollRequest?.seq ?? 0) + 1) }
```

- [ ] **Step 5: `answerRows`·`calendarRows`의 카드·절 부분**

`answerRows`에서 `if a.schedule != nil { calendarRows(t, a) }`부터 끝의 `// 푸시 "추가" 액션과 같이 …` 주석과 `if CalendarLookup.fullAccess { ForEach(a.proposals) … }` 블록까지를 다음으로 바꾼다(위의 답·인용·"보관함에서 보기"는 그대로):

```swift
    // 일정 답 카드(§9, 0.8.2): 찾은 곳 → 그날 내 캘린더 → 상태·버튼. 일정 기간이 카드 하루보다 넓을 때만 아래 "기기 캘린더" 절도 그린다.
    // 전체 접근이 없으면 카드가 안내를 대신 들고, 절의 안내는 카드가 없을 때만
    ForEach(Array(t.cards.enumerated()), id: \.element.pid) { pair in cardRows(t, pair.element, first: pair.offset == 0) }
    if t.cardsMore > 0 { Text(ScheduleCard.moreText(t.cardsMore)).font(.caption2).foregroundStyle(.secondary) }
    if a.schedule != nil, t.cards.isEmpty || t.calendar != nil { calendarRows(t, a) }
```

`calendarRows`의 `CalendarAccessPrompt(message: DeviceCalendar.accessText) { … }` 콜백을 `{ recheck(t.id) }`로 바꾼다(주석 "거부했으면 다시 그려…" 줄은 지운다 — `readCalendar`가 권한에 따라 절·카드를 다시 쓴다).

- [ ] **Step 6: `cardRows`·`statusRow`·`addButton` 추가, `proposalCard` 삭제**

`proposalCard(_:title:start:status:)` 함수 전체를 지우고 그 자리에 넣는다:

```swift
  /// 일정 답 카드(§9, 0.8.2) 한 장 = 같은 Section 의 행 셋. 행마다 탭 경로가 하나다 — ① 출처 행은 원문 링크, ② 캘린더 줄은 탭 없음,
  /// ③ 버튼은 스타일을 명시해 행 탭이 아니라 자기 제스처로 눌린다(0.8.1 실기기: 스타일 없는 카드 버튼이 텍스트처럼 보이고 눌리지 않았다)
  @ViewBuilder private func cardRows(_ t: Turn, _ c: ScheduleCard.Model, first: Bool) -> some View {
    let cite = t.answer?.citations.first(where: { $0.item_id == c.itemID })
    // 권한은 그릴 때 다시 본다 — 턴에 남은 캘린더 줄·상태가 권한 철회 뒤에도 보이지 않게, 허용 뒤 낡은 안내가 남지 않게(권한 상태는 관찰되지 않는다)
    let access = CalendarLookup.fullAccess
    NavigationLink {
      ItemDetailView(itemID: c.itemID)
    } label: {
      VStack(alignment: .leading, spacing: 2) {
        Text(ScheduleCard.sourceLine(cite)).font(.caption).bold()
        Text(ScheduleCard.whenLine(c)).font(.subheadline)
        Text([ScheduleCard.receivedLine(cite), "원문 보기"].compactMap { $0 }.joined(separator: " · "))
          .font(.caption2).foregroundStyle(.secondary)
      }
    }
    if access, let lines = c.lines {
      VStack(alignment: .leading, spacing: 2) {
        Text(ScheduleCard.dayHeader(c.day)).font(.caption).bold()
        if lines.isEmpty { Text(ScheduleCard.emptyDayText).font(.caption2).foregroundStyle(.secondary) }
        ForEach(Array(lines.enumerated()), id: \.offset) {
          Text($0.element.text).font(.caption2).foregroundStyle($0.element.conflict ? Color.orange : Color.primary)
        }
        if c.moreLines > 0 { Text("외 \(c.moreLines)건").font(.caption2).foregroundStyle(.secondary) }
      }
    } else if !access, first {
      CalendarAccessPrompt(message: DeviceCalendar.accessText) { recheck(t.id) }
    }
    statusRow(c, access: access)
  }

  /// ③ 상태 줄 + 버튼(§9 상태 1~6·§10). 버튼은 "아직 캘린더에 없음"(캘린더에 추가, 강조 채움)·겹침(겹쳐도 추가, 주황 테두리 — 확인창 없이 저장)일 때만.
  /// 결과 문구는 실패이거나 버튼이 남아 있을 때만 — 성공하면 재조회로 상태가 "✅ 캘린더에 등록됨"으로 바뀌어 같은 말을 두 번 하지 않는다
  @ViewBuilder private func statusRow(_ c: ScheduleCard.Model, access: Bool) -> some View {
    let state = adds[c.pid], action = access ? ScheduleCard.action(c) : nil
    let line = access || c.status == nil ? ScheduleCard.statusText(c) : nil      // 권한이 없으면 캘린더 대조 상태는 숨기고 종류 문구(시간 미정·지난 일정)만
    if line != nil || action != nil || state != nil {
      VStack(alignment: .leading, spacing: 6) {
        if let line { Text(line).font(.caption).foregroundStyle(ScheduleCard.isWarning(c) ? Color.orange : Color.secondary) }
        if let action {
          if action == .add { addButton(c, action, state).buttonStyle(.borderedProminent) }
          else { addButton(c, action, state).buttonStyle(.bordered).tint(.orange) }
        }
        switch state {
        case .failed(let m)?: Text(m).font(.caption).foregroundStyle(.red)
        case .finished(let m)? where action != nil: Text(m).font(.caption).foregroundStyle(.secondary)
        default: EmptyView()
        }
      }
    }
  }

  private func addButton(_ c: ScheduleCard.Model, _ action: ScheduleCard.Action, _ state: AddState?) -> some View {
    Button(state.isRunning ? "추가하는 중…" : ScheduleCard.buttonTitle(action)) {
      runAdd(ConfirmAdd(id: c.pid, fields: ["proposal_id": c.pid, "title": c.title, "start": c.startText], conflicts: []),
             confirmed: ProposalFlow.tapConfirmed(conflictsShown: action == .addAnyway))
    }
    .font(.subheadline)
    .disabled(state.isRunning || state.isFinished)
    .accessibilityIdentifier("scheduleCard.add")
  }
```

- [ ] **Step 7: `readCalendar`·`refreshCalendars`·`recheck`·`executed`**

`readCalendar`와 `refreshCalendars`를 바꾸고 둘 아래에 `recheck`·`executed`를 더한다:

```swift
  /// 기기 캘린더(§9·§12 통제 2): 일정 답 카드(그날 일정·등록 판정)와 넓은 기간의 "기기 캘린더" 절을 기기 안에서만 읽어 턴에 둔다.
  /// 서버로 보내지 않는다. 전체 접근이 없으면 카드는 줄·상태 없이(안내 자리), 절은 지운다. 진단 로그에는 개수만
  private func readCalendar(_ idx: Int, _ a: ChatReply.Answer) {
    let range = a.schedule?.interval
    let picked = ScheduleCard.pick(a.proposals, schedule: range)
    let ex = try? Executions.shared()                     // 카드마다 SQLite 를 새로 열지 않는다(활성화마다 최대 5턴 × 3장)
    turns[idx].cards = picked.cards.map { ScheduleCard.model($0, events: CalendarLookup.cardEvents(day: $0.day), executed: executed(ex, $0.proposal.id)) }
    turns[idx].cardsMore = picked.more
    // 기간 종류는 진단 로그에도 남긴다(T3 G5 가 분기를 가른다) — 일정 내용은 아니다
    let sched = range == nil ? "none" : ScheduleCard.showsRangeSection(schedule: range, cardDays: picked.cards.map(\.day)) ? "wide" : "day"
    let wide = CalendarLookup.fullAccess && sched == "wide"
    turns[idx].calendar = wide ? range.map { CalendarLookup.scheduleEvents($0) } : nil
    if !picked.cards.isEmpty { DiagLog.append("CAL card n=\(picked.cards.count) more=\(picked.more) access=\(CalendarLookup.fullAccess ? 1 : 0) sched=\(sched)") }
  }

  /// 앱 활성화(설정에서 권한을 바꾸고 돌아옴·캘린더 앱에서 일정을 바꿈)·카드 추가 성공 뒤(Codex #6): 마지막 5개 턴만 다시 읽는다(EventKit 조회 비용).
  /// 전체 접근이 없으면 조회가 없으므로 모든 턴에서 캘린더 줄·상태·버튼을 걷는다. EventKit 변경 알림은 구독하지 않는다
  private func refreshCalendars() {
    let idx = CalendarLookup.fullAccess ? Array(turns.indices.suffix(5)) : Array(turns.indices)
    for i in idx { if let a = turns[i].answer { readCalendar(i, a) } }
  }

  /// 권한 안내에서 허용·거부한 뒤 다시 읽는다(권한 상태는 관찰되지 않는다 — 다시 그려 "설정에서 허용하기"로 바뀌게).
  /// 마지막 5개 턴과 같이 그 턴도 — 5개 밖이어도 안내를 누른 턴은 바로 바뀐다
  private func recheck(_ id: UUID) {
    refreshCalendars()
    if let i = turns.firstIndex(where: { $0.id == id }), i < turns.count - 5, let a = turns[i].answer { readCalendar(i, a) }
  }

  /// 이 기기에서 넣은 적 있는 제안(§10 실행 기록). 등록 판정의 보조 근거 — 캘린더에서 지웠으면 "이전에 추가한 일정"
  private func executed(_ ex: Executions?, _ pid: String) -> Bool {
    (try? ex?.existing(proposalId: pid)) != nil
  }
```

(`try? ex?.existing(...)`는 `String?`로 평탄화된다 — 기록 없음·오류·`Executions` 열기 실패 모두 nil. `refreshCalendars`가 권한 없을 때 모든 턴을 도는 것은 EventKit 조회가 없어 싸다.)

`runAdd`를 두 곳 고친다(나머지는 그대로):
- 마지막 줄 주석을 `// 추가 뒤 카드 상태가 "✅ 캘린더에 등록됨"으로·절이 바로 바뀐다(Codex #6)`로(코드는 그대로).
- `needsConfirm` 분기에서 `confirm = ConfirmAdd(…)` 다음 줄(`return` 앞)에 `refreshCalendars()` — 확인창을 닫은 뒤 카드가 "아직 캘린더에 없음"으로 남지 않고 새 겹침 상태·"겹쳐도 추가"로 바뀐다(제안 탭 `refreshConflicts()`와 같은 동작, Fable F7).

- [ ] **Step 8: `send` — 키보드 내림·스크롤**

`send()`에서 `input = ""`부터 `let idx = turns.count - 1`까지를 다음으로 바꾸고:

```swift
    input = ""
    inputFocused = false                                   // 보내면 키보드를 내린다(답·카드가 키보드 뒤에 깔리지 않게, 0.8.2)
    turns.append(Turn(question: q))
    let idx = turns.count - 1
    scroll(to: turns[idx].id)
```

200 응답 줄을 다음으로 바꾼다:

```swift
          if let a = ChatReply.decode(r.data) { turns[idx].answer = a; readCalendar(idx, a); scroll(to: turns[idx].id) } else { turns[idx].error = "응답을 읽지 못했습니다" }
```

- [ ] **Step 9: EruriCore 옛 카드 API 삭제**

- `DeviceCalendar.swift`: `public enum CardStatus …`부터 `statusText(_:)`의 닫는 `}`까지(28~45행) 삭제. 파일 머리 주석 `채팅 "기기 캘린더" 절·제안 카드 상태`를 `채팅 "기기 캘린더" 절`로.
- `ChatReply.swift`: `calendarStart(_:now:)`와 그 위 주석 3줄 삭제.
- `DeviceCalendarTests.swift`: `testCardStatus()` 삭제(위 주석 1줄 포함).
- `ChatReplyTests.swift`: `testCalendarStartOnlyForTimedCertainProposed()`·`testCalendarStartSkipsPast()` 삭제(각 위 주석 포함).

- [ ] **Step 10: 남은 참조 확인·빌드·테스트**

Run: `grep -rn "cardStatuses\|CardStatus\|calendarStart\|proposalCard\|Link(\"설정에서 허용하기\"" ios/App ios/Packages/EruriCore/Sources ios/Packages/EruriCore/Tests`
Expected: `ios/App/ProposalsView.swift`의 `CalendarAccessSection` 안 `Link("설정에서 허용하기", destination: url)` 한 줄만.
Run: `grep -n 'functions/v1/chat' ios/App/ChatView.swift`
Expected: `json: ["question": q]` 한 곳(요청 본문 불변).
Run: `vm_stat | grep -E 'free|compressor'; pgrep -x deno; cd ios && ./scripts/sim.sh gen && ./scripts/sim.sh build && ./scripts/sim.sh test EruriCoreTests`
Expected: `** BUILD SUCCEEDED **`, EruriCoreTests 전체 통과(경고에 새 Sendable·deprecated 경고 없음).

- [ ] **Step 11: 커밋**

```bash
git add ios/App/CalendarLookup.swift ios/App/ChatView.swift ios/App/ProposalsView.swift ios/Packages/EruriCore/Sources/EruriCore/DeviceCalendar.swift ios/Packages/EruriCore/Sources/EruriCore/ChatReply.swift ios/Packages/EruriCore/Tests/EruriCoreTests/DeviceCalendarTests.swift ios/Packages/EruriCore/Tests/EruriCoreTests/ChatReplyTests.swift
git commit -m "feat(ios): chat schedule answer card — source and original link, that day's calendar with conflicts first, six-way status; card buttons styled so a single tap fires; settings prompt is a button; answered question scrolls into view on the next main turn; card calendar content gated on current access (0.8.2, T2)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **T2 리뷰어 확인 항목(게이트 아님):** 권한이 없을 때 `cardRows`·`statusRow`가 캐시된 캘린더 줄·상태·버튼을 그리지 않고, `refreshCalendars`가 그때 모든 턴을 다시 읽는다(Codex #1 — 설정에서 권한을 바꾸면 앱이 종료돼 시뮬레이터로 재현할 수 없고, 주입하려면 디버그 훅이 필요해 테스트로 두지 않는다).

- [ ] **예비 조치(실행하지 않는다 — T3 G1 또는 실기기 D1의 1회 탭이 실패했을 때만 메인이 수정 태스크로 연다):** 스타일 명시 뒤에도 G1(또는 실기기 D1)의 1회 탭이 실패하면 다음 후보는 List 수준 `simultaneousGesture(TapGesture)`다(추론 — Fable §4 조치 3). 지운 뒤 G1이 통과하는지로 확인한다. `body`에서 `.simultaneousGesture(TapGesture().onEnded { inputFocused = false })` 한 줄만 지운다 — 보내기 시 `inputFocused = false`(Step 8)와 `.scrollDismissesKeyboard(.interactively)`가 키보드 내리기를 맡는다. 처음부터 같이 지우지 않는 이유: 스타일만으로 통과하는지 봐야 원인이 갈리고, 빈 곳 탭으로 키보드 내리기(0.7.1)를 불필요하게 잃지 않는다. 지운 뒤 G1부터 다시 돈다.

---

### Task T3: 0.8.2 · 시뮬레이터 게이트 G1~G7 · TestFlight · 실기기 D1·D2

**Files:**
- Modify: `ios/project.yml` (`MARKETING_VERSION: 0.8.2`)
- Modify: `docs/superpowers/phase1/gates.md` (행 `C3-sim`·`C3-device`)
- 임시(커밋하지 않음, 끝나면 삭제): `ios/project.gate082.yml`, `ios/EruriGate.xcodeproj`, 게이트 테스트 소스(`ios/GateTests/…` 등 임시 경로), 시드 스크립트(`.context/` 아래), 스크린샷 `.context/sim-gate-082-shots/`, 보고 `.context/sim-gate-082.report.md`

**Interfaces:**
- Consumes: T2의 화면 문구("캘린더에 추가"·"겹쳐도 추가"·"추가하는 중…"·"✅ 캘린더에 등록됨"·"⚠️ 아직 캘린더에 없음 · 겹치는 일정"·"내 캘린더 · "·"문자에서 찾은 일정"·"설정에서 허용하기"), 접근성 식별자 `scheduleCard.add`, `DiagLog` `ADD <result> <pid>`·`CAL card n=… sched=none|day|wide`, 0.8.1 하네스(F11).
- Produces: `gates.md` 행, `.context/sim-gate-082.report.md`, TestFlight 0.8.2 빌드.

**게이트 원칙(사용자 지시):** 시뮬레이터로 확인할 수 있는 것은 전부 시뮬레이터 pane 에서 닫고, 실기기는 **실기기에서 실패가 확인된 항목(카드 버튼 1회 탭)과 사용자 판단(D2)만** 한다. 실기기 고유 동작(잠금화면·Face ID·실제 푸시)은 이번 변경과 무관해 다시 재지 않는다.

- [ ] **Step 1: 버전**

`ios/project.yml`의 `MARKETING_VERSION: 0.8.1` → `MARKETING_VERSION: 0.8.2`. 커밋은 Step 9에서 `gates.md`와 함께.

- [ ] **Step 2: 시뮬레이터 게이트 준비 (pane `opus`/`medium`)**

0.8.1 하네스(`.context/sim-gate-081.report.md` "환경·방법", `.context/sim-gate-081-shots/Gate.swift.txt`)를 그대로 재사용한다.

1. 시각: 메인이 Gmail 원장으로 ③b2 창(백필 진행 중)이 아님을 확인한 뒤 시작(Global Constraints).
2. `vm_stat | grep -E 'free|compressor'`, `pgrep -x deno` 비어 있음. 전용 시뮬레이터 `Eruri-gate082`(iPhone 17, iOS 26.x)를 새로 만들고 UDID를 이 pane 만 쓴다. 다른 pane 기기 금지.
3. 임시 xcodegen 스펙 `ios/project.gate082.yml` → `EruriGate.xcodeproj`(현재 HEAD = T2 + 0.8.2 소스). `GateHostTests`(앱 호스트): 테스트 사용자 `poc-test-1`의 refresh token 을 앱 Keychain 에 넣는다(값 출력 금지). `GateUITests`: 아래 G 단계, 러너 프로세스가 EventKit 으로 합성 일정을 쓰고 지운다(앱 밖 쓰기).
4. 시드(테스트 사용자, 실행 태그 `test:g082-<run>`, `tests/_testenv.ts`): 합성 항목 2건 → 배포 워커(process)로 facts·proposals.
   - P1 `[합성의원] <D=오늘+3일>(<요일>) 오후 3시 30분 진료 예약` → 제안 D 15:30
   - P2 `[합성치과] <E=오늘+4일>(<요일>) 오후 2시 진료 예약` → 제안 E 14:00
   `testUser()`는 호출마다 비밀번호를 바꿔 앱 refresh token 을 무효화한다 — 토큰 발급 때 한 번만 부른다(0.8.1 재현 팁).
5. 실사용자(`ERURI_USER_ID`) 데이터는 만들거나 지우지 않는다. 푸시·배포·업로드 금지(업로드는 Step 7).

- [ ] **Step 3: 시뮬레이터 게이트 G1~G7**

| 단계 | 조작 | 통과 기준 |
|---|---|---|
| G1a 겹침 카드 1회 탭(키보드 올림) — **0.8.1 실패 XCUITest 회귀** | 러너가 D 15:00–16:00 `합성 겹침` 저장 → 채팅 "합성의원 진료 예약 언제야?" → 답 도착 뒤 입력창을 눌러 키보드를 올린 채 `app.buttons.matching(NSPredicate(format: "label BEGINSWITH '겹쳐도 추가'")).firstMatch`를 **`tap()` 한 번만**(0.8.1 하네스의 `press` 재시도 없이). 탭 직전 `app.keyboards.count ≥ 1`과 버튼 `isHittable`을 기록한다. 키보드가 버튼을 가리면 목록을 쓸지 말고(키보드가 내려간다) 앞 턴 없이 새로 띄운 화면에서 다시 한다 | 탭 직전 키보드 있음, 1초 안에 "추가하는 중…" 또는 결과, 확인창 없음, 캘린더 D 15:30 ERURI 일정 +1, `DiagLog` `ADD ok <P1>`, 서버 P1 `succeeded`. 카드 ①에 "문자에서 찾은 일정"(또는 시드 출처에 맞는 표기)·"<D> 15:30 합성의원 진료 예약"·"받은 … · 원문 보기" |
| G1b 추가 카드 1회 탭(키보드 내림) + 스크롤 | 앱을 새로 띄우고 같은 실행(앱 재실행 없이)에서 일정과 무관한 다른 질문 2개를 먼저 보내 목록이 화면보다 길어진 뒤 → 채팅 "합성치과 예약 언제야?" → 답 도착 직후(스와이프 없이) 마지막 턴의 `scheduleCard.add` 버튼(앞 턴에 카드가 있으면 그 버튼과 섞이지 않게 라벨 "캘린더에 추가"·마지막 요소로 고른다)이 `isHittable`인지 기록 → `tap()` 한 번 | 답 도착 직후 상태 줄·버튼이 화면 안(입력 패널 위)(이 시드의 짧은 답 기준. 화면보다 긴 답은 질문이 맨 위에 오면 통과 — 스펙 §9), 1회 탭 → "추가하는 중…" → 캘린더 E 14:00 +1, `ADD ok <P2>` |
| G2 겹침 카드 표시 | G1a 탭 전 스크린샷 | ② "내 캘린더 · <D>(<요일>)" 첫 줄 `15:00–16:00 합성 겹침`, ③ "⚠️ 아직 캘린더에 없음 · 겹치는 일정 15:00–16:00 합성 겹침", 버튼 "겹쳐도 추가"(테두리) |
| G2b 미리 판정 뒤 겹침(C2-5 회귀) | (G1b 전에) 채팅 "합성치과 예약 언제야?" → 카드가 "아직 캘린더에 없음"·"캘린더에 추가"인 채로 러너가 E 13:30–14:30 `합성 겹침2` 저장(앱은 전경 그대로) → 버튼 1회 탭 | 저장 안 됨, 확인창 "같은 시간에 '합성 겹침2' 일정이 있습니다. 그래도 추가할까요?"(iOS 26 팝오버 — 바깥 탭으로 닫음, F12) → 캘린더 +0, `ADD conflict:1`, P2 `proposed` 유지. 닫은 뒤 카드가 겹침 상태("⚠️ … 겹치는 일정 13:30–14:30 합성 겹침2")·"겹쳐도 추가"로 바뀜(Fable F7). 그 뒤 러너가 `합성 겹침2`를 지우고 G1b 진행 |
| G3 등록 상태 | G1a 직후 같은 턴, 이어 같은 질문을 새로 보냄 | 같은 턴 ③ "✅ 캘린더에 등록됨", 버튼 없음, "캘린더에 추가했습니다" 문구 없음. 새 턴(서버 `succeeded`)도 카드가 있고 "✅ 캘린더에 등록됨" |
| G4 옮김·지움 | 러너가 P1 일정(url `assistant://proposal/<P1>`)을 D 16:30으로 옮김 → 앱 백그라운드·복귀(`XCUIDevice.shared.press(.home)` → `app.activate()`) → 이어 그 일정을 지움 → 백그라운드·복귀 | 옮김 "✅ 캘린더에 등록됨 · 캘린더에서는 <D>(<요일>) 16:30", 지움 "이전에 추가한 일정 · 이 날 캘린더에서는 찾지 못함(옮겼거나 지웠을 수 있음)", 둘 다 버튼 없음 |
| G5 절 규칙(C1 회귀 포함) | ⓐ "합성의원 진료 예약 언제야?"(schedule 없음 예상) ⓑ "<D월 D일> 합성의원 예약 몇 시야?"(하루) ⓒ "<D월 D일>부터 <D+2>일까지 합성 일정 있어?"(넓은 기간) ⓓ 0.8.1 C1-1~3(러너 일정 D+5 둘 → "<D+5> 일정 있어?" / D+20 → "일정 없음" / "<D+5> 합성 화성 탐사 일정 있어?" 거절) | ⓐ 카드 ②에 그날 줄(일정 질문이 아니어도) ⓑ 카드만, "기기 캘린더" 절 머리 없음 ⓒ 카드 + "기기 캘린더 · 이 기간 일정 N건" ⓓ 0.8.1 C1-1~3과 같은 결과(절 2줄 / "이 기간에 등록된 일정 없음" / 거절 문구 그대로 + 절, "보관함에서 보기" 없음). ⓐⓑⓒ는 DiagLog `CAL card … sched=none` / `day` / `wide`가 각각 한 번 이상 찍혀야 한다. 예상 분기가 안 나오면 질문 문구를 바꿔 다시 하고(최대 3회), 그래도 없으면 그 분기는 "미실행" — G5는 통과가 아니다(응답 주입 대체는 쓰지 않는다, AGENTS §5-8) |
| G6 추가만 허용 + 설정 버튼 1회 탭 | 설정 → 앱 → ERURI → 캘린더 "이벤트 추가만" → "합성의원 진료 예약 언제야?" → "설정에서 허용하기"를 `tap()` 한 번. 관찰(판정 아님): 같은 권한 상태에서 제안 탭 `CalendarAccessSection`의 "설정에서 허용하기"도 1회 탭해 열리는지 기록 — 안 열리면 0.8.3 후보 | 카드 ①은 보임, ② 자리에 "캘린더 접근을 허용하면 등록된 일정도 함께 확인합니다" + "설정에서 허용하기"(첫 카드만), 버튼 없음, 절 안내 중복 없음. 1회 탭에 설정 앱이 전경(`settings.state == .runningForeground`, 5초 안). 전체 접근으로 되돌린 뒤 앱이 재시작되면 그 사실만 기록(0.8.1 관찰) |
| G7 개인정보 | `grep -n 'functions/v1/chat' ios/App/ChatView.swift`, 앱 `eruri.log`(`sim.sh log 200`), `device_traces` 최근 1시간 | 요청 본문 `["question": q]`뿐. 로그의 `CAL`·`ADD` 줄에 일정 제목·`합성` 0건(개수·id·결과만). `device_traces` 1시간 내 `%합성%` 0건 |

실행 순서: G2 → G1a → G3 → G4 → G2b → G1b → G5 → G6 → G7(G1a·G3·G4는 P1, G2b·G1b는 P2를 쓴다 — 한 제안은 한 번만 저장된다).

정리: 러너가 만든 `합성` 일정 전부 삭제, 테스트 사용자의 이 실행 items·facts(→proposals cascade)·jobs·그 제안 id 의 device_traces 삭제 후 0행 확인, 임시 스펙·프로젝트·테스트 소스 삭제 후 `git status --short`에 `ios/project.yml`(0.8.2) 외 변경 없음, 시뮬레이터 `Eruri-gate082` 삭제. 결과는 `.context/sim-gate-082.report.md`(단계별 통과/실패 + 관찰 문구·개수 + 스크린샷 경로 `.context/sim-gate-082-shots/`).

- [ ] **Step 4: G1 실패 시**

G1a 또는 G1b가 1회 탭에 실패하면 여기서 멈추고 메인에 보고한다. 메인이 T2 "예비 조치"를 수정 태스크로 열고, 반영 뒤 G1부터 다시 돈다. G1b가 1회 탭은 되는데 답 도착 직후 버튼이 화면 밖(스크롤)으로만 실패하면 예비 조치가 아니라 스크롤만 고치는 수정 태스크로 연다(T2 Step 4 `onChange(of: scrollRequest)`). 시뮬레이터에서 통과하지 못한 채 업로드하지 않는다.

- [ ] **Step 5: G1~G7 판정 기록**

`docs/superpowers/phase1/gates.md` 끝 표에 행을 추가한다(커밋 칸은 비움):

```
| C3-sim | 0.8.2 채팅 일정 답 카드 시뮬레이터 게이트 G1a·G1b(카드 버튼 1회 탭 — 키보드 올림/내림, 0.8.1 실패 XCUITest 회귀)·G2·G2b·G3·G4·G5(C1-1~3 회귀)·G6(설정 버튼 1회 탭 — 0.8.1 C1-4 "부분" 해소)·G7 | <통과|실패> | <단계별 관찰: 문구·개수·DiagLog·trace, 스크린샷 경로> | | <날짜> |
```

- [ ] **Step 5b: 업로드 전 화면 미리 확인 (메인 + 사용자)**

메인이 G2·G3 스크린샷(`.context/sim-gate-082-shots/`)을 사용자에게 보여 문구·구성에 걸리는 점이 있는지 먼저 묻는다(Fable F5 — D2에서 처음 보면 문구 수정이 빌드 하나를 더 낳는다). 고칠 점이 있으면 업로드 전에 T2 수정 태스크로 반영하고 해당 G 단계를 다시 돈다. 최종 D2 판정은 실기기에서 한다(이 확인으로 D2를 닫지 않는다).

- [ ] **Step 6: 실기기 게이트 시각 확인 (메인)**

메인이 Gmail 원장·`gates.md`로 확인: ③b2 창 밖(T0 2026-10-01 14:00 KST ~ ③b3 백필 완료 기록), ③c1(≈10-07)·③c2(≈10-09) 측정 시각과 30분 이상 떨어짐. 못 맞추면 D1·D2를 미룬다(시뮬레이터 결과로 닫지 않는다).

- [ ] **Step 7: TestFlight 업로드**

Run: `vm_stat | grep -E 'free|compressor'; pgrep -x deno; cd ios && ./scripts/sim.sh gen && ./scripts/testflight.sh`
Expected: 업로드 성공 로그, 빌드 번호 `date +%Y%m%d%H%M`, 버전 0.8.2. 처리 완료 뒤 사용자에게 설치를 부탁한다.

- [ ] **Step 8: 실기기 D1·D2 (사용자 + pane `sonnet`/`medium`)**

준비 데이터(실사용자 계정 — 실기기는 제품 로그인):
1. 먼저 기존 합성 제안을 쓴다: `proposals`에서 `user_id = ERURI_USER_ID`, `status = 'proposed'`, `payload->>'title' like '%합성%'`, `payload->>'start'`가 미래인 행의 **개수와 id 만** 조회(제목·본문 출력 금지). 있으면 그 제안의 일정 질문("합성의원 진료 예약 언제야?")을 쓴다 — 새 `items`·`jobs`를 만들지 않는다.
2. 없으면 `send-phrases --only push` **1회**(합성 문구, 실사용자 `items`·`jobs`·`proposals` 생성 — Step 6의 시각 조건 필수).
3. 그 제안 시각에 겹치는 일정이 캘린더에 이미 있으면 그대로 쓴다. 없으면 만들지 않는다 — 카드 버튼은 "캘린더에 추가"가 되고 D1은 그 버튼으로 닫는다(두 버튼 스타일은 G1a·G1b가 시뮬레이터에서 닫았다, Fable F4).

| 단계 | 조작(사용자) | 통과 기준 |
|---|---|---|
| D1 카드 버튼(키보드 올림) | 0.8.2 앱 채팅에서 질문 → 답이 오면 카드 ①·②·③과 버튼 모양(채움 "캘린더에 추가" 또는 테두리 "겹쳐도 추가") 확인 → **입력창을 눌러 키보드를 올린다** → 키보드 위에 보이는 카드 버튼을 **한 번** 누른다(가려져 있으면 키보드를 내리고 누르고 그 사실을 기록) | 한 번에 "추가하는 중…" → ③ "✅ 캘린더에 등록됨", 캘린더에 그 일정 +1. 메인이 `device_traces`의 `action.handled` `result=ok`(그 제안 id)·제안 `succeeded`로 확인. 탭 순간 키보드가 있었는지 기록. 실기기에서 실패가 확인된 항목이라 시뮬레이터 통과만으로 닫지 않는다. 실패하면 메인이 T2 "예비 조치"를 수정 태스크로 연다 |
| D2 맥락 | 같은 화면을 사용자가 읽는다 | 사용자 판단: "알림 기준 판단·캘린더 내용·추가/겹침 여부"가 한눈에 읽히는가(원래 피드백의 수용 기준). 고칠 점이 나오면 그대로 적고 0.8.3 후보로 넘긴다(판정은 사용자 말 그대로) |

정리: 사용자가 캘린더에서 D1이 넣은 `합성의원 진료 예약`을 지운다(겹침 일정은 원래 있던 것이면 그대로). 남은 합성 제안은 제목에 `합성`이 든 것만 제안 탭에서 **한 건씩** "무시"(**"전체 무시" 금지**). `succeeded`가 된 제안은 그대로 둔다.

`gates.md`에 행을 추가한다:

```
| C3-device | 0.8.2 실기기: D1 채팅 카드 버튼 모양 + 키보드 올린 상태 1회 탭 저장(0.8.1 12:31 무반응 해소), D2 사용자 맥락 판단 | <통과|실패|대기> | <제안 id 출처(기존/send-phrases), trace result·elapsed_ms, 사용자 판단 원문, Gmail 창과의 간격> | | <날짜> |
```

- [ ] **Step 9: 커밋**

```bash
git add ios/project.yml docs/superpowers/phase1/gates.md
git commit -m "chore(ios): 0.8.2; docs(gates): C3 chat schedule card — simulator G1–G7 and device D1–D2" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(실기기 게이트가 시뮬레이터보다 늦으면 Step 5 뒤 `ios/project.yml`+`C3-sim` 행을 먼저 커밋하고, `C3-device` 행은 따로 커밋한다.)

---

## Self-Review

- **스펙(T0 후 §9 "일정 답 카드") 대조:** ① 찾은 곳(출처 표기 5종·받은 날짜·원문 보기) → T1 `sourceLine`·`receivedLine`, T2 `cardRows` ① / ② 그날 줄(일정 질문 아니어도, 겹침 먼저·종일·시작 순, 생일·구독·취소 제외, 걸침 표기, 최대 4, 빈 날 문구) → T1 `dayLines`, T2 `cardEvents`·`listed` / ③ 상태 6종·순서·succeeded 단독 불가 → T1 `status` / 시각 없음·확인 필요·지난 일정 → T1 `card`·`statusText(Model)` / 여러 제안 규칙 → T1 `pick` / 절 동시 표시 → T1 `showsRangeSection`, T2 `readCalendar`·`answerRows` / 권한 없음 → T1 `model(events: nil)`, T2 첫 카드 안내 / 권한이 없어지면 모든 턴에서 걷음 → T2 `cardRows`·`statusRow`(`access`)·`refreshCalendars`(리뷰어 확인 항목) / 버튼 스타일·1회 탭 → T2 `statusRow`, T3 G1·D1 / 성공 시 결과 문구 숨김 → T2 `statusRow` / 스크롤·키보드 → T2 Step 4·8, T3 G1b / 진단 로그 개수·기간 종류만 → T2 `readCalendar`(`sched=`), T3 G5·G7 / §10 버튼 규칙 → T2 `addButton`(`tapConfirmed`), T3 G2b.
- **자리표시 검사:** "TBD"·"적절히" 없음. 게이트 하네스는 0.8.1 하네스 파일 경로와 바뀌는 단계를 명시했다(임시 파일이라 저장소에 코드를 남기지 않는다).
- **타입 일관성:** `ScheduleCard.Pick`(T1) → `model(_:events:executed:)`(T1) → `Turn.cards: [ScheduleCard.Model]`(T2). `CalendarLookup.cardEvents(day:) -> [CalendarEvent]?`의 nil 이 `model(events: nil)`의 "전체 접근 없음"과 맞물린다. `Model.startText`가 `handleAdd`의 `start`로 간다(같은 `ISO8601DateFormatter`). `action == .addAnyway` → `tapConfirmed(conflictsShown: true)`.
- **Review Focus:** 1·2·3·4·5·7·8은 T1 테스트에, 6은 T3 G1a·D1에 있다.

## Fable 리뷰 반영 (2026-10-01, `.context/fable-review-chatcard.md`)

| # | 심각도 | 반영 | 어디 |
|---|---|---|---|
| 1 | HIGH | 반영 — 카드 표시(종류)와 버튼(상태) 분리, succeeded 도 카드, 상태 6종 | T0 §9, T1 `card`·`status`·`action` |
| 2 | HIGH | 반영 — 캘린더 줄은 제안 날짜 서울 하루, 스펙 먼저 | T0 Step 1·2·5, T1 `dayLines`, T2 `cardEvents` |
| 3 | HIGH | 반영 — 겹친 일정은 어느 캘린더든 맨 위·상태 문구에 직접 | T1 `dayLines`(`listed`)·`statusText` |
| 4 | HIGH | 반영 — 버튼 스타일 명시, `Link` → `Button`+`openURL`, 실패 XCUITest 회귀, 조치 3은 예비 | T2 Step 2·6·예비, T3 G1·G6·D1 |
| 5 | MED | 반영(조정) — 보내면 키보드 내림, 답이 오면 **질문으로 스크롤**(권장 "턴 끝" 대신: 카드가 위에서부터 읽히고 List 행 id 로 안정적으로 스크롤). 계획 리뷰에서 수용 기준·시점 보완(Codex #3·Fable F3) | T2 Step 4·8, T3 G1b |
| 6 | MED | **미반영** — "무시" 상태는 서버가 dismissed 를 주지 않아 0.8.2 제외(서버 변경 없음 유지, 메인 지시) | — |
| 7 | MED | 반영 | T1 `showsRangeSection`, T3 G5 |
| 8 | MED | 반영 | T1 `sourceLine`·`receivedLine` |
| 9 | MED | 반영 — 기간 안만·시작 순·중복 한 장·최대 3. 넘친 문구는 "일정 제안 N건 더 있음"(succeeded·지난 제안은 제안 탭에 없음) | T1 `pick`·`moreText` |
| 10 | MED | 반영 — 버튼은 남김 | T1 `status` `maybeSame` |
| 11 | LOW | 반영 — 10/4 = 일요일 픽스처 | T1 테스트 |
| 12 | LOW | 반영 — 검출하지 않고 추출 시각·원문 보기 | T0 §9, T2 `cardRows` ① |

문구 조정: 겹침 상태를 Fable 안 "'제목'과 시간이 겹침" 대신 "겹치는 일정 HH:mm–HH:mm 제목" — 제목 끝 받침에 따라 "과/와"가 틀린다. Fable §2의 `eventkit_id`로 옮긴 일정 직접 조회는 Fable 자신이 0.8.2 범위 밖으로 둔 것이라 넣지 않았다.

## 계획 리뷰 반영 (2026-10-01, Codex gpt-6-astra · Fable)

원문: `.context/codex-review-chatcard.out.md`(Codex, HEAD `950c575`), `.context/fable-review-chatcard-plan.md`(Fable 판정·§3 수정 지시·최종 권장). 판정이 갈리면 Fable 판정을 따랐다. 구조(T0→T1→T2→T3)·인터페이스·서버 변경 없음 전제·게이트의 시뮬레이터/실기기 분류는 그대로다. 개인정보 등급 변화 없음 — 사용자 확인 불필요. 스펙 쪽 반영은 T0 Step 2·6 텍스트에 넣었다(스펙 파일은 T0 실행 때 고친다).

### Codex 6건

| # | Codex(심각도) | Fable 판정 | 반영 | 바뀐 곳 |
|---|---|---|---|---|
| 1 | 권한 철회 뒤 낡은 카드의 캘린더 내용·버튼이 남음(HIGH) | 부분동의(MED) | **반영(축소)** — 그릴 때 `CalendarLookup.fullAccess`로 다시 가름(권한 없으면 캐시된 줄·상태·버튼 숨김, 반대로 허용 뒤 낡은 안내도 안 남음), 권한 없으면 `refreshCalendars`가 모든 턴, `recheck`는 5개 밖 턴도. "6턴 보존 후 권한 전환 주입" 테스트는 **미반영** — 권한 변경 시 앱이 종료돼(0.8.1 관찰) 시뮬레이터로 재현 불가, 주입은 디버그 훅 필요. T2 리뷰어 확인 항목으로 | T0 Step 2(§9 "모든 턴에서 걷는다"), T2 Step 6 `cardRows`·`statusRow(access:)`, Step 7 `refreshCalendars`·`recheck`, T2 리뷰어 확인 항목, Self-Review |
| 2 | 분 단위 중복 제거가 succeeded 를 버림(MED) | 동의 | **반영** — 정렬 1순위를 분으로(같은 분·제목 묶음에서 succeeded 대표), 옛 "메모"(초 단위 설명) 삭제, 테스트 같은 분·다른 초 정·역순. 실행 기록을 대표 선택에 반영하는 것은 **미반영**(Fable: 과함 — succeeded 대표면 충분) | T0 Step 2, T1 Step 1 `testPick`·Step 4 `pick` |
| 3 | 질문 맨 위 스크롤이 버튼 노출을 보장 못 함(MED) | 부분동의(MED) | **반영(변형)** — 새 스크롤 기제(카드 행으로 스크롤)는 **미반영**(List anchor 없는 `scrollTo` 미검증). 수용 기준을 고침: "질문이 보이게, 턴이 화면보다 길면 질문이 맨 위·카드는 쓸어 올려 본다". G1b 통과 기준에 "짧은 답 기준, 긴 답은 질문 맨 위면 통과" | T0 Step 2, T2 Step 3·4 주석, T3 G1b·Step 4 |
| 4 | G5가 schedule 분기를 고정하지 않음(MED) | 부분동의(MED) | **반영(변형)** — 합성 응답 주입은 **미반영**(제품 앱에 테스트 경로, 대체는 "부분"이지 통과 아님 — AGENTS §5-8). `CAL card … sched=none/day/wide` 로그로 분기를 가르고, 예상 분기가 3회 시도에도 안 나오면 "미실행" = G5 통과 아님 | T0 Step 2(진단 로그 문장), Global Constraints, T2 Step 7 `readCalendar`, T3 Interfaces·G5 |
| 5 | 실기기 D1에 키보드 올린 상태가 없음(MED) | 동의 | **반영** — D1 조작에 "입력창을 눌러 키보드를 올린다 → 키보드 위 카드 버튼 1회 탭"(가려지면 내리고 누르고 기록), 탭 순간 키보드 유무 기록, `gates.md` C3-device 설명에 "키보드 올린 상태" | T3 Step 8 D1·C3-device 행, Review Focus 6 |
| 6 | 자정에 끝나는 일정 날짜 표기가 규칙과 다름(LOW) | 부분동의(LOW) | **반영(변형)** — 표기는 바꾸지 않고 정책 고정: "다음 날 0시에 끝나면 그날 안(23:00–00:00)". Fable 추가 지적(줄과 상태 문구가 다르게 찍힘)도 `span`의 day 없는 경로를 시작한 서울 하루로 바꿔 맞춤. 테스트 `testDayLines`·`testStatusText`에 `mid` | T0 Step 2, T1 Step 1·Step 4 `span` |

Codex "먼저 바꿀 3가지": ① 권한 철회 무효화 → #1(렌더 가드 + 전체 턴 갱신, 주입 테스트 제외) ② succeeded 근거 보존 → #2 ③ UI 수용 기준 고정 → #3(수용 기준 조정)·#4(분기 로그)·#5(D1 키보드).

### Fable 추가 지적 (번호는 리뷰 원문 — 위 "이 계획이 기대는 사실"의 F 번호와 다르다)

| # | 심각도 | 반영 | 바뀐 곳 |
|---|---|---|---|
| F1 | HIGH | **반영** — 겹침 판별을 id 대신 값 비교(`conflicts.contains(e)`) — 매일 반복 일정의 ±1일 회차가 겹침 줄 3개로 나오던 결함. 테스트 `daily` | T1 Step 1 `testDayLines`·Step 4 `dayLines`, Review Focus 7 |
| F2 | MED | **반영** — 다가올 일정 먼저(시작 순), 지난 일정은 뒤(최근 것부터). Codex #2와 같은 정렬 키. 테스트 `mixed` | T0 Step 2, T1 `testPick`·`pick`, Review Focus 8 |
| F3 | MED | **반영** — 스크롤을 다음 메인 턴으로(`Task { @MainActor in … }`). G1b 앞에 같은 실행에서 다른 질문 2개를 쌓음(0.8.1 하네스는 메서드마다 `launch()`라 턴 하나로는 못 잰다) | T2 Step 4, T3 G1b |
| F4 | MED | **반영** — 실기기 준비에서 사용자가 겹침 일정을 만들지 않음(있으면 쓰고 없으면 "캘린더에 추가"로 D1). 두 버튼 스타일은 G1a·G1b가 닫음 | T3 Step 8 준비 3·정리 |
| F5 | LOW | **반영** — 업로드 전 G2·G3 스크린샷을 사용자에게 먼저(D2 최종 판정은 실기기 유지) | T3 Step 5b, 실행 순서 |
| F6 | LOW | **반영** — G1a 탭 직전 `keyboards.count`·`isHittable` 기록, 키보드가 가리면 쓸지 말고 새 화면에서 다시 | T3 G1a |
| F7 | LOW | **반영** — `runAdd` 확인 분기에서 `refreshCalendars()`, G2b 통과 기준에 "닫은 뒤 겹침 상태·겹쳐도 추가" | T2 Step 7, T3 G2b |
| F8 | LOW | **반영** — 기대 출력을 `sim.sh test` grep(`Test Case`·`passed`·`failed`·`error:` 줄만)에 맞춤 | T1 Step 2·5 |
| F9 | LOW | **반영** — 예비 조치는 "다음 후보(추론)", 발동 조건에 실기기 D1 실패 포함, D1 실패 시 예비 조치 명시 | T2 예비 조치, T3 D1 |
| F10 | LOW | **반영** — `readCalendar`에서 `Executions.shared()` 한 번, `executed(ex, pid)` | T2 Step 7 |
| F11 | LOW | **반영** — 이 절, 머리 "리뷰·실행", T0 Step 6 §16 문단·소절 제목 | 머리, T0 Step 6·8, 이 절 |

Fable §2 게이트 분류 표의 관찰 항목(제안 탭 `CalendarAccessSection` "설정에서 허용하기" 1회 탭)은 G6 관찰로 넣었다(판정 아님 — 안 열리면 0.8.3 후보). G1b 버튼 선택(마지막 턴 "캘린더에 추가")은 턴을 쌓으면서 앞 턴 카드 버튼과 섞일 수 있어 이 판에서 더한 보완이다. Fable 최종 권장대로 반영 뒤 추가 리뷰 없이 SDD로 넘어간다. 버튼 1회 탭이 실제로 고쳐지는지는 여전히 미검증이고 G1a·G1b·D1이 닫는다.
