# PoC-5 알림 액션 → 백그라운드 EventKit 멱등 쓰기

## 실기기: 서버 제안 푸시 경로 (0b, 2026-09-29~)

판정 기준(스펙 §14 PoC-5): 잠금 화면 알림 액션으로 **앱을 열지 않고 캘린더에 1건만** 생성. 근거는 `poc5.action_handled`(`result`·`bg`·`dup`)와 캘린더 앱 확인.

준비
1. 서버: 0013·0014 적용, `worker` 배포(Task 4·5). 부록 D(APNs 키 교체)를 했으면 새 키, 아니면 현재 키 — 판정과 무관.
2. 기기: TestFlight 설치본, 알림·캘린더 권한 허용, 설정 화면 PoC 계정 로그인, 알림 자동화에 Slack 포함, `devices` 행 확인:
   `cd poc/server && deno run --allow-net --allow-env --allow-read --env-file=.env scripts/sql.ts 'select device_id, apns_env, build, last_seen_at from devices where user_id = $1' "$(grep '^POC_USER_ID=' .env | cut -d= -f2)"`
3. 기기를 잠근다(20초 이상 기다려 잠금 유예 구간을 넘긴다).

실행
1. Mac: `cd poc/server && deno run --allow-net --allow-env --allow-read --env-file=.env scripts/send-phrases.ts --only push` (합성 병원 예약, 발송일 +3일 15:30 — Task 6).
2. 1~2분 안에 잠금 화면에 `일정 제안` / `M월 D일(요) 15:30 · …` 알림이 뜬다. 안 뜨면 아래 조회 Q1·Q2로 어디서 멈췄는지 본다.
3. 알림을 길게 눌러 **캘린더에 추가** → Face ID/암호 → 앱이 화면에 나오지 않는지 본다.
4. 알림 센터에 같은 알림이 남아 있으면 한 번 더 **캘린더에 추가**(재탭 → `dup`).
5. 캘린더 앱에서 그 날짜 15:30 일정이 **1건**인지 본다.

조회(본문 없음, id·상태만. `<POC_USER_ID>`는 `grep '^POC_USER_ID=' .env | cut -d= -f2`)
- Q1 항목·잡: `scripts/sql.ts 'select i.id, i.status, j.kind, j.status js, j.checkpoint from items i left join jobs j on j.payload->>$2 = i.id::text where i.user_id = $1 and i.captured_at > now() - make_interval(mins => 15) order by i.captured_at' "<POC_USER_ID>" item_id` → `extracted` / process `done` `proposed`
- Q2 제안·푸시: `scripts/sql.ts 'select p.id, p.action, p.status, pp.device_id, pp.status push, pp.apns_status, pp.reason, pp.env from proposals p left join proposal_pushes pp on pp.proposal_id = p.id where p.user_id = $1 and p.created_at > now() - make_interval(mins => 15) order by p.created_at' "<POC_USER_ID>"` → `create_event` `proposed`, push `sent` 200
- Q3 액션 trace: `scripts/sql.ts 'select at, fields from poc_traces where user_id = $1 and event = $2 and at > now() - make_interval(mins => 30) order by at' "<POC_USER_ID>" poc5.action_handled` → 첫 줄 `result=ok`·`bg=true`, 재탭 `result=dup`

판정: 3단계에서 앱이 열리지 않고, Q3 `result=ok`·`bg=true`, 캘린더 1건이며 **해당 시각에 크래시 리포트(TestFlight "앱이 충돌함" 안내, 기기 분석 데이터 `EruriPoC-*.ips`)가 없으면** **통과**. 서버 보고 실패 후 재탭(스펙 §14 방법의 마지막 시나리오)은 `executions` 서버 보고가 없어 이 절차 밖이다(남은 실측으로 적는다).

### 실기기 0.2.1 결과 (2026-09-29) — 크래시, 0.2.2 수정

- 0.2.1(202609291603)에서 두 제안 알림(18:04:53·18:05:02 KST)을 잠금 화면에서 탭했다. 두 건 모두 캘린더 1건 저장, `poc5.action_handled` `result=ok`·`bg=true`·`auth=3`까지 정상이었다.
- 그런데 두 번 다 TestFlight 충돌 안내가 떴다. 원인은 async 판 `didReceive` 이다. 컴파일러 thunk 가 완료 핸들러를 Swift 협력 스레드에서 불렀고, UIKit 스냅샷 갱신(`_performBlockAfterCATransactionCommitSynchronizes:`)이 메인 스레드 단언으로 SIGABRT 했다.
- 09-24 시뮬레이터 실측도 매번 같은 크래시(`~/Library/Logs/DiagnosticReports/AssistantPoC-2026-09-24-*.ips` 3건)를 냈다. 판정이 로그 줄만 봐서 놓쳤다.
- 0.2.2: delegate 를 completion-handler 판으로 바꾸고 완료를 모든 경로에서 메인 큐로 1회 호출한다. `eventIdentifier` 암시적 언래핑도 제거했다.
- 시뮬레이터 XCUITest(백그라운드 탭·재탭 dup·콜드 스타트)에서 새 `.ips` 가 0건이다. 이제 판정에 "크래시 리포트 없음"을 포함한다.

## 시뮬레이터 재실측 (2026-09-24, Opus 재검증 반영 후) — 실제 배너·액션 탭

이전 세션은 "알림 권한을 넘길 수단이 없다"고 보고 디버그 훅만 썼다. `simctl privacy … notifications`는 실제로
`Operation not permitted`(서비스 목록에 없음)이지만, **XCUITest가 springboard 권한 대화상자와 배너를 조작할 수 있다**.
`UITests/SimRemeasureUITests.swift`를 추가하고 `scripts/sim.sh uitest <테스트>`로 실행했다. 알림은 앱이 예약하는
**로컬 알림**(`--poc-debug-local-notification=<초> --proposal-id=<id>`, ContentView "10초 뒤 ADD_EVENT 로컬 알림" 버튼과 같은 코드)이라 APNs가 필요 없다.

| 시나리오 | 방법 | 근거 로그 (`poc.log`, UTC) | 결과 |
|---|---|---|---|
| 권한 | 앱 "권한 요청" → springboard "허용" 탭 | `14:29:27 calendar permission granted=true`, `14:29:29 notif permission granted=true` | 통과 |
| 배너 → 액션 → 백그라운드 쓰기 | 로컬 알림 예약 → 홈 → 배너 길게 눌러 "캘린더에 추가" | `14:29:48 notif response action=ADD`, `ADD ok p-ui-bg-1790260163 … bg=true auth=3` | 통과 (`bg=true`, 앱은 화면에 나오지 않음, auth=3 = fullAccess) |
| 같은 알림 두 번 탭 | 같은 pid로 다시 예약·탭 | `14:30:08 ADD dup skip p-ui-bg-1790260163 <같은 eventkit id> unreported=2 bg=true` | 통과 |
| 콜드 스타트 | 예약 후 `app.terminate()`(state=notRunning 단정) → 배너 액션 | `14:31:00 ADD ok p-ui-cold-1790260245 … bg=true auth=3` | 통과 |
| 동시 두 번 탭 경쟁 (MED-5) | `--poc-debug-notification-action-concurrent`: `async let` 두 개로 같은 pid의 `handleAdd` | `14:32:23 ADD dup skip p-conc2-…` + `ADD ok p-conc2-…` (같은 eventkit id), `EventCount 병원 예약` 4 → 5 | 통과 (이벤트 +1). 수정 전 코드의 경쟁 재현은 하지 않았다 |

부수 발견: 동시 훅 첫 실행에서 이벤트는 1건만 생겼는데 `ADD ok` 줄이 로그에서 사라졌다. `PoCLog.append`가
seek→write라 동시 쓰기에서 서로 덮어썼다(호스트 재현: 200줄 중 69줄만 남음). `O_APPEND` 한 번 쓰기로 고쳤다(`PoCLogTests`).

수정 내용: 확인→저장→기록을 `AddEventGate` actor 안에서 `await` 없이 처리, 저장하는 이벤트 `url`에
`assistant://proposal/<id>` 표식(저장 후 기록 전 종료 시 1단계 복구용), 로그에 `auth=`(EventKit 권한)와 dup skip 시 `unreported=`.

**여전히 시뮬레이터로 검증할 수 없는 것**: 잠금 화면에서의 액션과 `.authenticationRequired`의 Face ID/암호 요구
(시뮬레이터는 암호가 없다), 서버 보고 실패 후 재탭(서버 없음 — `unreported=` 증가로 기록만 확인).

<details><summary>이전 세션 기록 (디버그 훅, 포그라운드)</summary>

### 이전 세션: 디버그 훅

이 세션의 시뮬레이터(`iPhone 17 Pro`, iOS 26.3, UDID는 `poc/ios/.sim-udid`)에는 알림 배너를 길게 눌러 액션 버튼("캘린더에 추가")을 탭하는 터치 자동화 도구(idb 등)가 없다. `simctl`에는 탭·스와이프·홈 버튼 입력 명령이 없고, 알림 권한(`UNUserNotificationCenter.requestAuthorization`)도 `simctl privacy`가 다루는 TCC 서비스 목록(calendar/contacts/photos 등)에 포함되지 않아 시스템 "허용" 대화상자를 자동으로 넘길 방법이 없다. 실제로 권한을 요청하지 않은 상태로 `push.sh`를 실행하면 `xcrun simctl push`는 성공(exit 0)하지만 배너는 뜨지 않는다(스크린샷으로 확인, 큐 화면만 보임).

그래서 계획서 Step 7의 지시대로 **Task 4의 `--poc-debug-capture`와 같은 launch-argument 디버그 훅** 방식을 그대로 적용했다:

- `NotificationDelegate.userNotificationCenter(_:didReceive:)`가 하던 일을 `NotificationActions.handleAdd(userInfo:)`로 분리했다. 델리게이트는 이 함수를 호출만 한다.
- `EruriPoCApp.init()`에 `--poc-debug-notification-action [--proposal-id=<id>]` 훅을 추가해, 실제 알림 액션 탭과 동일한 코드 경로(`handleAdd`)를 launch argument로 직접 호출한다.
- 독립 검증용으로 `--poc-debug-count-events` 훅도 추가해, 우리 코드가 직접 쓴 로그가 아니라 `EKEventStore`에서 실제로 조회한 이벤트 개수를 `poc.log`에 남긴다.

`xcrun simctl launch <udid> com.picpal.assistant.poc --poc-debug-notification-action --proposal-id=p-001`로 두 번 실행한 결과(`poc.log`, 매 실행은 `simctl terminate` 후 재실행 = 콜드 스타트):

```
[13:34:54Z] ADD ok p-001 86F0CF3C-...:CEAEC0A5-... bg=false
[13:35:05Z] ADD dup skip p-001 86F0CF3C-...:CEAEC0A5-...
[13:35:13Z] EventCount 병원 예약 1
```

- **멱등성 통과**: 같은 `proposal_id`로 두 번 호출해도 두 번째는 `Executions.existing`에서 걸려 `EKEventStore.save`를 다시 부르지 않았고, `EventKit`에 독립적으로 질의(`--poc-debug-count-events`)해도 "병원 예약" 이벤트는 정확히 1건이다.
- **`executions` 테이블 기록 통과**: `ExecutionsTests` 3종(기록 후 조회, 중복 기록 시 최초값 유지, `markReported`) 모두 통과. `existing()`이 첫 `eventkit_id`를 그대로 반환함을 실제 시뮬레이터 실행에서도 재확인했다(두 로그 줄의 `eventkit_id`가 동일).
- **캘린더 권한**: `xcrun simctl privacy <udid> grant calendar com.picpal.assistant.poc`로 비대화형 부여했다("시뮬레이터에서 직접 허용"에 해당하는 이 세션의 실행 가능한 방법). `EKEventStore().save(...)`가 실제로 `eventIdentifier`를 반환하는 것으로 권한이 유효함을 확인했다.
- **`bg=false`(포그라운드) 한계**: `simctl launch`는 앱을 항상 포그라운드로 띄운다. `simctl`에는 앱을 백그라운드/잠금 상태로 보내는 명령이 없어(홈 버튼·잠금 입력 불가), 이 세션에서는 **"백그라운드에서 알림 액션 처리 시 EventKit 쓰기가 성공하는가"(PoC-5의 핵심 판정 기준)를 검증하지 못했다.** `applicationState`는 매번 `.active`였다. 코드 경로 자체(권한이 `.authorizedWhenInUse`가 아니라 EventKit 전체 접근 권한이므로 포그라운드/백그라운드에 관계없이 API 자체는 성공해야 하지만)는 실기기 검증이 필요하다.
- **실제 알림 배너·액션 버튼 UI**: 이 세션에서 자동화하지 못했다. `push.sh`로 페이로드는 정상 전송됐지만(exit 0), 알림 권한을 대화형으로 승인할 수단이 없어 배너 자체가 뜨지 않았다(스크린샷 `/tmp/poc5-evidence/after-push.png`에 배너 없음, 앱 화면만 보임 — 로컬 임시 경로라 커밋 대상 아님).

</details>

## 실기기에서 사용자가 할 일

1. iPhone(iOS 26+)에 Xcode로 `EruriPoC`를 설치하고, 기기 암호(Face ID)가 켜져 있는지 확인한다.
2. 앱 실행 → "권한 요청 (알림·캘린더·연락처)" → 세 대화상자 모두 허용.
3. "10초 뒤 ADD_EVENT 로컬 알림" 버튼을 누르고 **즉시 화면을 잠근다.** (APNs·PoC-4 없이 된다.)
4. 잠금 화면 배너를 길게 눌러 "캘린더에 추가" → Face ID/암호를 요구하는지 기록 → 인증 후 캘린더에 1건 생기는지, `poc.log`에 `ADD ok p-local-1 … bg=true`가 남는지 확인.
5. **같은 알림 두 번 탭**: 버튼을 다시 누르고 잠근 뒤 같은 액션 → 이벤트가 늘지 않고 `ADD dup skip p-local-1 … unreported=1`.
6. **보고 실패 후 재탭**(스펙 방법): 서버가 없으므로 `reported=0`인 상태 그대로다. 5의 `unreported=1`이 "보고 안 된 실행이 남아 있어도 재탭은 중복을 만들지 않는다"의 근거다. 서버 보고(Task 9) 이후 다시 확인한다.
7. **콜드 스타트**: 버튼을 누르고 앱 전환기에서 앱을 위로 밀어 종료 → 잠금 → 액션 탭 → `ADD ok … bg=true`.
8. 결과(`bg=`, 인증 요구 여부, 이벤트 수)를 `results.md` PoC-5 행에 적는다.

## 판정 기준 (스펙 §14 PoC-5)

- **통과**: 잠금 상태의 `authenticationRequired` 액션에서 앱을 열지 않고 캘린더에 1건만 생성(두 번 탭·보고 실패 후 재탭 포함).
  **해당 시각에 앱 크래시 리포트가 없어야 한다**(로그·trace 가 정상이어도 완료 뒤 크래시가 날 수 있다. 0.2.1 사례).
- **실패 → 대안**: `foreground` 액션으로 앱을 열어 실행.

## 계획서와 달라진 점

- `NotificationDelegate` 내부에 인라인으로 있던 처리 로직을 `NotificationActions.handleAdd(userInfo:)`로 분리했다. 델리게이트가 하는 일은 동일하지만, 알림 배너 UI 없이도 launch-argument 훅에서 같은 함수를 직접 호출해 검증할 수 있게 하기 위함이다(계획서 Step 7의 "핸들러를 직접 호출해 검증" 지시를 실행하려면 필요한 최소 리팩터였다).
- 계획서에 없던 `--poc-debug-count-events` 훅을 추가했다. 우리 코드가 남긴 로그만으로는 "정말 EventKit에 1건만 있는지"를 독립적으로 보증하지 못해서, `EKEventStore`에 직접 질의하는 별도 검증 경로를 넣었다.
- Swift 6 엄격 동시성 오류는 발생하지 않았다(`EruriPoC` 전체 빌드 성공). `UIApplication.shared.applicationState` 접근은 `await MainActor.run { ... }`로 감쌌다.

- (재검증 반영) 처리 본체를 `AddEventGate` actor로 옮기고, 로컬 알림 예약·동시 탭·UI 테스트 경로를 추가했다. 델리게이트는 포그라운드에서도 배너를 띄운다(`willPresent` → `.banner`).
