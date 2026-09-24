# PoC-5 알림 액션 → 백그라운드 EventKit 멱등 쓰기

## 시뮬레이터에서 확인한 것

이 세션의 시뮬레이터(`iPhone 17 Pro`, iOS 26.3, UDID는 `poc/ios/.sim-udid`)에는 알림 배너를 길게 눌러 액션 버튼("캘린더에 추가")을 탭하는 터치 자동화 도구(idb 등)가 없다. `simctl`에는 탭·스와이프·홈 버튼 입력 명령이 없고, 알림 권한(`UNUserNotificationCenter.requestAuthorization`)도 `simctl privacy`가 다루는 TCC 서비스 목록(calendar/contacts/photos 등)에 포함되지 않아 시스템 "허용" 대화상자를 자동으로 넘길 방법이 없다. 실제로 권한을 요청하지 않은 상태로 `push.sh`를 실행하면 `xcrun simctl push`는 성공(exit 0)하지만 배너는 뜨지 않는다(스크린샷으로 확인, 큐 화면만 보임).

그래서 계획서 Step 7의 지시대로 **Task 4의 `--poc-debug-capture`와 같은 launch-argument 디버그 훅** 방식을 그대로 적용했다:

- `NotificationDelegate.userNotificationCenter(_:didReceive:)`가 하던 일을 `NotificationActions.handleAdd(userInfo:)`로 분리했다. 델리게이트는 이 함수를 호출만 한다.
- `AssistantPoCApp.init()`에 `--poc-debug-notification-action [--proposal-id=<id>]` 훅을 추가해, 실제 알림 액션 탭과 동일한 코드 경로(`handleAdd`)를 launch argument로 직접 호출한다.
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

## 실기기에서 사용자가 할 일

1. iPhone(iOS 26+, iPhone 15 Pro 이상)에 Xcode로 `AssistantPoC`를 설치한다.
2. 앱 실행 → ContentView의 "권한 요청 (알림·캘린더)" 버튼을 눌러 알림(`.alert,.sound`)과 캘린더 전체 접근 권한을 **실제로 대화상자에서 허용**한다.
3. 화면을 잠그거나 홈으로 나가 앱을 백그라운드 상태로 둔다.
4. 다른 기기(또는 서버)에서 같은 `add_event.apns` 페이로드 형태의 원격 푸시를 이 기기로 보낸다(시뮬레이터의 `simctl push`는 실기기에 쓸 수 없으므로 APNs HTTP/2 경로나 PoC-4의 `apns-send` 함수로 대체).
5. 알림을 길게 눌러 "캘린더에 추가" 액션을 탭한다. 캘린더 앱에 이벤트가 1건 생기는지, `poc.log`에 `ADD ok ... bg=true`가 남는지 확인한다.
6. 같은 `proposal_id`로 다시 보내 같은 액션을 탭한다. 캘린더에 이벤트가 늘지 않고 `poc.log`에 `ADD dup skip`이 남는지 확인한다.
7. **잠금 화면 상태**(화면을 잠그고 알림 배너에서 바로 액션을 탭하는 경우, `options: [.authenticationRequired]`가 Face ID/암호 확인을 요구하는지)에서 1·2를 반복한다.
8. 위 결과(특히 `bg=` 값과 잠금 화면에서의 인증 요구 여부)를 `docs/superpowers/poc/results.md`의 PoC-5 행에 옮겨 적는다.

## 계획서와 달라진 점

- `NotificationDelegate` 내부에 인라인으로 있던 처리 로직을 `NotificationActions.handleAdd(userInfo:)`로 분리했다. 델리게이트가 하는 일은 동일하지만, 알림 배너 UI 없이도 launch-argument 훅에서 같은 함수를 직접 호출해 검증할 수 있게 하기 위함이다(계획서 Step 7의 "핸들러를 직접 호출해 검증" 지시를 실행하려면 필요한 최소 리팩터였다).
- 계획서에 없던 `--poc-debug-count-events` 훅을 추가했다. 우리 코드가 남긴 로그만으로는 "정말 EventKit에 1건만 있는지"를 독립적으로 보증하지 못해서, `EKEventStore`에 직접 질의하는 별도 검증 경로를 넣었다.
- Swift 6 엄격 동시성 오류는 발생하지 않았다(`AssistantPoC` 전체 빌드 성공). `UIApplication.shared.applicationState` 접근은 `await MainActor.run { ... }`로 감쌌다.

## 판정 기준 (스펙 §14 PoC-5)

- **통과**: 백그라운드(잠금 상태 포함)에서 알림 액션 처리 시 EventKit 쓰기가 성공하고, 동일 `proposal_id` 재실행 시 이벤트가 중복 생성되지 않는다.
- **부분 통과**: 포그라운드에서는 성공하지만 백그라운드/잠금 상태에서 실패하거나 미확인인 경우 — **이 세션은 이 상태다.** 멱등성과 코드 경로는 시뮬레이터 디버그 훅으로 통과를 확인했으나, 진짜 백그라운드 실행 성공 여부는 실기기 확인이 남아 있다.
- **실패**: 멱등성이 깨지거나(중복 이벤트 생성), 실기기 백그라운드에서 EventKit 쓰기가 항상 실패하는 경우 → 알림 액션 대신 앱을 열어야만 처리되는 대안(예: 알림 탭 시 앱 오픈 후 인앱 확인 버튼)으로 전환.
- 최종 판정은 위 "실기기에서 사용자가 할 일"을 수행한 뒤 `docs/superpowers/poc/results.md`(Task 13)에 기록한다.
