# PoC-1 Notification 트리거 (실기기 절차)

> 다른 앱(카카오톡·Instagram)의 실제 알림과 알림 트리거 자동화는 시뮬레이터에 없어 이 PoC는 **실기기에서만** 판정 가능하다. 아래는 사용자가 iPhone에서 직접 따라 할 절차다.

## 시뮬레이터에서 확인한 것 (2026-09-24, Opus 재검증 반영 후)

- 빌드 산출물 `AssistantPoC.app/Metadata.appintents/extract.actionsdata`에 `CaptureIntent`(파라미터 text·appName·title·sender·source, supportedModes=background, authenticationPolicy=alwaysAllowed)와 App Shortcut "${applicationName}에 저장"이 등록돼 있다.
- XCUITest(`UITests/SimRemeasureUITests.testShortcutsAppRunsCaptureIntent`)로 **단축어 앱 → 모든 단축어 → Assistant PoC › "비서에 저장"**을 탭했다. 앱을 열지 않고 `queued:rules` 다이얼로그가 떴고 `poc.log`에 `CaptureIntent queued:rules 541ms src=NOTIFICATION app=nil titleLen=-1 textLen=0 sender=nil locked=false`(14:32:51Z)가 남았다. 즉 시스템(단축어) 경로로 인텐트가 호출되고, 본문 기본값 `""` 덕분에 값을 묻지 않고 실행된다.
- 이것은 **수동 실행 경로**다. 알림 트리거 자동화·배너 여부·필드 매핑은 여전히 실기기에서만 판정한다.

## 준비

1. iPhone(iOS 26+, iPhone 15 Pro 이상)에 `AssistantPoC`를 Xcode → Run(케이블 연결)으로 설치한다. `poc/ios/project.yml`의 서명 팀(`6626BYCJG4`, Automatic)이 실기기에도 그대로 적용된다.
2. 설정 → 알림 → 카카오톡·Instagram → 미리보기를 "항상"으로 설정한다(잠금 상태에서도 본문이 보여야 시나리오 3을 시험할 수 있다).
3. 단축어 앱 → 자동화 탭 → 새 자동화 → **알림** 선택 → 앱: 카카오톡, 필터: 없음. 같은 방법으로 **Instagram 자동화도 하나 더** 만든다(시나리오 5용).
   - "즉시 실행" 토글이 나타나는지 여부를 기록한다 (스펙 §문서 조사 결과 Notification 트리거는 공식적으로 "자동 실행 가능" 목록에 없어 미확인 상태).
4. 동작에 **"비서에 저장"**(`CaptureIntent`) 액션을 추가한다.
5. 단축어 입력 변수(알림 텍스트에서 사용 가능한 마법 변수 목록)를 본문(`text`)·앱 이름(`appName`)·제목(`title`) 파라미터에 연결할 수 있는지 확인하고, 가능한 변수 목록을 스크린샷으로 남긴다.
6. 앱 → "권한 요청 (알림·캘린더·연락처)"으로 연락처 권한을 허용하고, 합성 문구를 보낼 **두 번째 계정의 표시 이름을 연락처에 저장**한 뒤 앱을 한 번 열어 연락처 캐시를 갱신한다(시나리오 8). `poc.log`의 `contacts status=… names=<n>`에서 `names>0`인지 본다.
7. **테스트 문구는 합성만** 쓴다. 본인 두 번째 계정·채널에서 "[합성] 9월 25일 15시 예약 확정" 같은 문구를 보낸다. 실제 알림톡·대화 원문을 쓰지 않는다(AGENTS §7).

## 기록 읽는 법

`poc.log`의 한 줄이 한 번의 인텐트 실행이다. **값이 아니라 형식만** 남는다.

```
CaptureIntent <결과> <ms>ms src=<출처> app=<appName|nil> titleLen=<제목 길이|-1> textLen=<본문 길이> sender=<nil|set> locked=<true|false>
```

- `textLen>0`이면 본문 전달, `textLen=0`이면 미전달(또는 자리표시자 없이 빈 값). `app=`으로 앱명 전달 여부를 본다.
- 결과: `queued:fm`(FM 통과) · `queued:rules`(FM 불가·타임아웃·에러, 규칙만 통과) · `discarded:otp|contact|fm:<kind>|fm-timeout|fm-unavailable|fm-error`.
- `locked=`는 `isProtectedDataAvailable`로 판정한다. 잠근 직후 약 10초는 아직 `false`로 찍히므로 **잠근 뒤 15초 이상 기다린 다음** 발송한다.
- 인텐트가 에러로 끝나면 `CaptureIntent error <타입> ...`가 남는다.

## 시나리오

각 시나리오 실행 후 앱을 열어 큐 목록과 `poc.log`(ContentView 하단 섹션)를 확인해 기록한다.

| # | 상황 | 절차 | 기록할 것 | 기대 결과 |
|---|---|---|---|---|
| 1 | 잠금 해제, 카톡 알림톡 수신 | 합성 알림톡 전송 → 수신 대기 | 확인 배너 표시 여부, `app=`·`titleLen=`·`textLen=` (값은 적지 않음) | 배너 없이 자동 실행되면 이상적. 배너가 뜨면 탭 1회로 실행되는지 |
| 2 | 잠금 상태 수신 | 화면 잠그고 **15초 이상** 기다린 뒤 동일 알림 수신 | 자동화 실행 여부, `poc.log`의 `locked=` 값 | 실행 여부와 `locked=true` 기록 |
| 3 | 미리보기 "잠금 해제 시" 설정 후 잠금 상태 수신 | 설정 변경 후 2와 동일 | `text`가 비어 있는지("알림이 있습니다" 같은 자리표시자인지) | 본문이 비어 있으면 이 설정에서는 PoC-1 가치 없음으로 기록 |
| 4 | 5초 안에 알림 3건 연속(묶음) | 짧은 간격으로 3건 발송 | 3건 모두 큐에 도착했는지, 순서·중복 여부 | 3건 모두 개별 항목으로 적재 |
| 5 | Instagram DM 알림 | Instagram DM 수신(준비 3의 Instagram 자동화) | `titleLen`/`textLen` 형식(발신자명이 제목에 오는지 등) | 앱마다 필드 구성이 다를 수 있음을 기록 |
| 6 | 필터 "주문" 설정 후 "주문" 없는 알림 수신 | 자동화 필터 조건 추가 | 트리거가 실행되지 않는지 | 필터링된 알림은 큐에 없어야 함 |
| 7 | (iOS 27 기기가 있다면) 1~2 반복 | 동일 절차 | OS 버전 간 차이 | 있으면 스펙 §14 각주에 기록 |
| 8 | 연락처에 저장한 두 번째 계정에서 보낸 카톡 | 준비 6 후 합성 문구 카톡 발송 | `poc.log`의 결과 코드 | `CaptureIntent discarded:contact`(발신자는 카톡 `title`에 온다) |

## 판정 기준 (스펙 §14 PoC-1 문구 그대로)

- **통과**: 본문·앱명 전달 확인(`textLen>0`, `app=`로 앱 식별 가능).
- **기록**(판정이 아니라 설계 입력): 확인 배너 여부, 잠금 상태 동작, 미리보기 꺼짐 상태, 묶음 알림 동작.
- **대안**: 본문 미전달 → 알림 경로 폐기, 공유만. 배너 필수 → 키워드 필터로 탭 최소화.
- 연락처 발신자 폐기는 시나리오 8로 확인한다. 앱이 연락처 이름을 App Group에 캐시하고 인텐트가 `sender`·`title`과 비교한다(공백 전부 제거, 끝 "님"/"씨" 제거). 판정 기준이 아니라 규칙 배선 확인이다.
- 판정 결과는 `docs/superpowers/poc/results.md`에 적는다. 원문 값은 적지 않는다.
