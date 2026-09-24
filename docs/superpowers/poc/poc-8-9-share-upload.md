# PoC-8(기기 부분)·PoC-9 Share Extension 로컬 영속화 + OCR + 백그라운드 업로드

## 시뮬레이터에서 확인한 것

이 세션의 시뮬레이터(`assistant-poc`, UDID는 `poc/ios/.sim-udid`)에도 PoC-1/2/3/5와 동일하게 공유 시트에서
"AssistantPoC" 확장을 탭하는 터치 자동화 도구(idb 등)가 없다. `simctl`에는 공유 시트를 열고 항목을 탭하는 명령이
없어, 계획서 Step 4가 명시적으로 허용한 대로 **launch-argument 디버그 훅**으로 `ShareViewController`가 하는 것과
동일한 `AssistantCore` 호출(파일을 App Group에 복사 → `OCR.recognize` → `CaptureQueue.enqueue`)을 App 프로세스에서
직접 재현했다(`--poc-debug-share-image=<host 절대경로>`, `AssistantPoCApp.swift`). 공유 시트 UI 자체는 이 세션에서
검증하지 못했다 — 아래 "부분 검증" 항목.

목 서버는 계획서의 8787 포트가 이 머신에 30일째 떠 있는 무관한 `python -m http.server`에 점유돼 있어(작업과 무관한
프로세스라 종료하지 않았다) 8788도 다른 `workerd` 프로세스가 선점 중이었다. 둘 다 loopback 바인딩 우선순위 때문에
와일드카드로 바인딩한 deno보다 우선 응답해 혼선이 있었고, 최종적으로 완전히 비어 있는 **8799** 포트로 옮겨 확인했다
(`mock-ingest.ts`에 `MOCK_INGEST_PORT` 환경변수 추가, 기본값은 계획서와 동일한 8787).

### (a) 공유 → App Group 파일·큐 행 생성 — 부분 검증(디버그 훅), 파일시스템 직접 확인으로 실측

한글 문구가 든 합성 청첩장 이미지를 직접 그려(`PIL`, `AppleSDGothicNeo` 폰트) `simctl addmedia`로 사진 앱에 추가하고,
같은 이미지 경로로 `--poc-debug-share-image`를 실행했다. **앱의 로그가 아니라 시뮬레이터 컨테이너 파일시스템을 호스트에서
직접 열어** 확인한 결과:

- `Shared/AppGroup/<id>/inbox/<uuid>.jpg` — 29,120바이트, 원본과 동일한 실제 JPEG 파일 생성됨.
- `queue.sqlite`의 `payload` 컬럼(JSON) — `source":"SHARE"`, `localFile":"inbox/<uuid>.jpg"`,
  `ocrText":"모바일 청첩자\n김철수 • 이영희 결혼합니다\n2026년 10월 18일 (일) 오후 1시\n장소: 서울 강남구 삼성동 코엑스 3층"`.

Vision(`ko-KR`, `.accurate`)이 4줄 69자를 정확히 인식했다(원문 "청첩장"을 "청첩자"로 1글자 오인식한 것 외에는 정확).
**이 코드 경로(파일 영속화 → OCR → 큐 적재) 자체는 실측으로 통과했다.** 다만 "공유 시트에서 실제로 사진을 골라 확장을
호출"하는 UI 동작은 자동화하지 못해 미검증으로 남는다.

### (b) 앱 열기 → flush() → 목 서버 도착 — 통과, 실측

두 경로 모두 실제 HTTP 왕복으로 확인했다:

- **JSON POST 경로**: Task 4에서 남아있던 큐 항목(파일 없음)을 `simctl launch`로 앱을 열어 flush했더니
  `POST /ingest`로 정확히 같은 필드(`id`, `text`, `title` 등)가 도착(202) → `poc.log`에 `upload ok`, 큐에서 삭제됨.
- **파일 PUT 경로**: (a)에서 만든 이미지 항목을 flush했더니 `PUT /upload/<id>`로 29,120바이트가 정확히
  도착(`/received`에 `bytes:29120`) → `upload ok` → 큐 삭제. 두 번째 이미지로도 동일하게 재현됨(`BE8D1358...`).

### (c) 앱 강제 종료 후에도 background URLSession 전송 완료 — **통과, PoC-9 핵심 실측**

루프백은 전송이 300ms 안팎으로 끝나 "종료가 전송 도중에 일어났는지" 구분하기 어려워서, 이 측정에서만
`mock-ingest.ts`에 `MOCK_INGEST_SLOW_MS`(청크 단위로 읽어 인위적으로 늦게 응답, 기본값 0=계획서 동작과 동일)를
추가해 서버 응답을 늦췄다. 절차:

1. `--poc-debug-share-image`로 새 미전송 항목(`40711470...`) 생성.
2. `SIMCTL_CHILD_INGEST_URL=http://localhost:8799 xcrun simctl launch`로 앱 실행(`init()`이 `Uploader.shared.flush()`를
   즉시 호출해 `PUT /upload/<id>` 백그라운드 업로드 태스크를 `resume()`).
3. 런치 0.4초 뒤 `xcrun simctl terminate` 실행.
4. **호스트 `ps aux`로 `AssistantPoC` 프로세스가 실제로 사라졌음을 직접 확인**(폴링, 300ms 간격, 앱을 다시 열지 않음).
5. 목 서버 `/received`를 계속 폴링.

실측 시각(모두 같은 머신 UTC):

| 이벤트 | 시각 |
|---|---|
| `simctl launch` | 14:07:26.786 |
| `simctl terminate` 발행 | 14:07:27.406 |
| `simctl terminate` 명령 반환 | 14:07:27.517 |
| 호스트 `ps aux`에서 앱 프로세스 완전히 사라짐 확인 | **14:07:27.946** |
| 목 서버 `/received`에 파일 전체(29,120바이트, 원본과 일치) 도착 | **14:07:31.628** |

프로세스가 완전히 죽은 시점(14:07:27.946)과 서버 도착 시점(14:07:31.628) 사이에 **3.68초**의 간극이 있다. 이 구간
동안 시뮬레이터 프로세스 목록에 `AssistantPoC` 바이너리는 없었다(직접 확인). 즉 앱 프로세스가 살아있지 않은 상태에서
`sharedContainerIdentifier`를 쓰는 background `URLSession`이 데이터를 계속 전송해 서버까지 정확한 바이트 수로
도착시켰다 — **PoC-9의 핵심 주장(백그라운드 전송이 앱 생명주기와 무관하게 완료된다)을 시뮬레이터에서 직접 재현·측정했다.**

부가 관찰: 이후 재실행 시 `poc.log`에 `upload ok`가 서버 도착과 거의 같은 시각에 남는 경우가 있었는데, 이는 iOS가
완료된 백그라운드 세션 이벤트를 전달하기 위해 앱을 짧게 백그라운드로 재기동했다가 다시 중단하는 것으로 보인다(문서화된
`handleEventsForBackgroundURLSession` 메커니즘과 일치하는 정황이나, 이 세션에서 그 과정 자체를 별도로 관찰하지는
못했다 — 참고 사항으로만 기록).

### 부가 시나리오: 오프라인 → 복구 후 재시도(계획서 Step 4의 2번) — 부분, 유실 0은 확인

목 서버를 끈 상태에서 이미지 항목(`487EBBF8...`)을 만들고 여러 차례 `simctl launch`로 flush를 시도했다. **실패
콜백(`didCompleteWithError`)이 즉시 오지 않았다** — 3분 넘게 기다려도 `poc.log`에 아무 기록이 없었다(연결이 거부되는
상황인데도 background `URLSession`은 즉시 실패 처리하지 않고 자체 유예/재시도 정책을 따르는 것으로 보인다). 서버를
다시 켠 뒤 몇 차례 더 flush를 시도하자 그제서야 `upload fail`이 여러 번(오프라인 기간 동안 반복 launch로 쌓인
중복 태스크들이 각자 타임아웃되며) 기록된 뒤, 결국 `upload ok`로 정확히 29,120바이트가 도착해 큐에서 사라졌다.
**데이터 유실은 0건**이었지만, `Uploader.flush()`가 같은 항목에 대해 이미 진행 중인 업로드 태스크가 있는지 확인하지
않고 매번 새 태스크를 만드는 것을 확인했다(계획서에 없던 관찰 — 아래 "계획서와 달라진 점" 참고). 실패 감지까지 걸리는
정확한 시간과 재시도 백오프 정책은 이 세션에서 특정하지 못해 **미검증**으로 남긴다.

### 검증하지 못한 것

- **실제 공유 시트 UI**(사진 앱 → 공유 → AssistantPoC 확장 탭): 자동화 도구 부재로 미검증.
- **Network Link Conditioner 100% loss 후 복구**(계획서 Step 4의 4번): 이 세션에 passwordless sudo가 없어
  `pfctl`/`dnctl` 기반 호스트 네트워크 제어를 시도하지 않았고, 시뮬레이터 Settings 앱의 UI 조작도 자동화 도구가 없어
  하지 못했다. 미검증.
- 오프라인 상태에서 정확히 몇 초/몇 회 만에 실패로 확정되는지의 수치: 미검증(3분 이상 걸림만 확인).

## 실기기에서 사용자가 할 일

1. iPhone(iOS 26+, iPhone 15 Pro 이상)에 Xcode로 `AssistantPoC`를 설치한다. `INGEST_URL` 환경변수(스킴 편집 →
   Run → Arguments → Environment Variables)를 개발 머신의 LAN IP:포트로 맞춘다(실기기는 `localhost`가 자기 자신이므로).
2. `deno run --allow-net --allow-env poc/server/mock-ingest.ts`를 개발 머신에서 실행하고 방화벽에서 해당 포트를 허용한다.
3. 사진 앱에서 실제 이미지(청첩장·영수증 등)를 길게 눌러 공유 → "AssistantPoC" 확장을 탭한다. 앱을 열어 큐 화면에
   `[SHARE]` 항목과 OCR 텍스트가 보이는지 확인한다(이 부분이 이 세션에서 미검증으로 남긴 유일한 핵심 항목이다).
4. "업로드 flush" 버튼을 누르거나 앱을 백그라운드→포그라운드 전환해 `/received`(개발 머신에서 `curl`)에 파일이
   도착하는지 확인한다.
5. 공유 직후 앱을 홈 화면 위로 스와이프해 강제 종료하고, 몇 초~몇십 초 후 개발 머신에서 `/received`를 확인해 파일이
   도착하는지, 도착 시각이 강제 종료 시각보다 뒤인지 확인한다(시뮬레이터에서 이미 통과를 확인했으므로 실기기에서는
   회귀만 확인하면 된다).
6. 비행기 모드를 켠 상태로 공유 → 앱 열기 → flush 실패 확인 → 비행기 모드 해제 → 앱을 다시 열어 재시도 성공과
   유실 0(같은 파일 크기 도착)을 확인한다.
7. 결과를 `docs/superpowers/poc/results.md`의 PoC-8·PoC-9 행에 반영한다.

## 계획서와 달라진 점

- **포트**: 이 머신에 8787·8788이 이미 무관한 프로세스(30일째 떠 있는 `python -m http.server`, `workerd`)에
  점유돼 있어 `mock-ingest.ts`에 `MOCK_INGEST_PORT` 환경변수(기본값 8787, 계획서와 동일)를 추가하고 이 세션은
  8799로 실행했다. 무관한 프로세스라 종료하지 않고 우회했다(AGENTS.md의 "불확실하면 건드리지 않는다" 원칙).
- **`MOCK_INGEST_SLOW_MS`**: PoC-9 측정 전용으로 업로드 바디를 청크 단위로 늦게 읽는 옵션을 추가했다(기본값 0,
  미설정 시 계획서 코드와 동일하게 동작). 루프백에서 전송이 너무 빨라 "종료가 전송 도중에 일어났는가"를 구분할 수
  없어서 추가했다.
- **`NSItemProvider.loadFileURL`에 `@MainActor` 추가**: Swift 6 엄격 동시성에서 "sending 'p' risks causing data
  races"(비-Sendable `NSItemProvider`를 nonisolated 함수로 넘김) 오류가 나서, 이 확장 메서드를 호출부(`handle()`,
  `ShareViewController`는 UIKit 기본 `@MainActor`)와 같은 액터로 고정해 액터 경계를 없앴다. 최소 수정.
- **`Uploader`에 `@unchecked Sendable` 추가**: `URLSessionDelegate`/`URLSessionTaskDelegate`를 채택한 싱글턴이
  `lazy var session`으로 가변 상태를 갖고 있어 Swift 6에서 요구했다. 델리게이트 콜백이 여러 스레드에서 올 수 있지만
  내부 상태 변경은 `CaptureQueue`(자체 sqlite 직렬화)와 `PoCLog`(파일 append)로만 하므로 안전하다고 판단했다.
- **`AssistantPoCApp.swift`에 `--poc-debug-share-image=<path>` 훅 추가**: 공유 시트 UI 자동화가 불가능해
  `ShareViewController`와 동일한 `AssistantCore` 호출을 App 프로세스에서 재현하기 위한, Task 4/5 패턴을 따른 디버그
  훅. `AppInfo.plist`에 `NSAppTransportSecurity > NSAllowsLocalNetworking`을 추가해 시뮬레이터에서 `localhost`
  접근을 허용했다.
- **`Uploader.flush()`의 중복 방지 부재(관찰)**: 오프라인 중 여러 번 `flush()`를 호출하면 같은 항목에 대해 매번
  새 업로드 태스크가 만들어져(진행 중인 태스크 확인 로직 없음) 나중에 중복 실패 로그가 여러 줄 남는 것을 관찰했다.
  계획서 코드를 그대로 구현했고 데이터 유실로 이어지지는 않았지만, 제품화 시에는 `session.getAllTasks()`로 같은
  `taskDescription`이 이미 있으면 건너뛰는 처리가 필요해 보인다(이번 태스크 범위 밖이라 수정하지 않음).

## 판정 기준 (스펙 §14 PoC-8 기기 부분·PoC-9)

- **PoC-8(기기 부분) 통과 조건**: 이미지·PDF·URL·텍스트 공유가 App Group에 영속화되고, 이미지는 OCR 텍스트가 큐에
  같이 저장된다. → **파일 저장·큐 적재·OCR은 실측 통과**(디버그 훅 경유). 공유 시트 UI 자체의 통과 여부는 실기기에서
  마저 확인해야 한다.
- **PoC-9 통과 조건**: 앱이 완전히 종료된 뒤에도 이미 시작된 background URLSession 전송이 서버까지 도착한다. →
  **통과**. 호스트 프로세스 목록으로 앱이 죽어 있음을 직접 확인한 뒤 3.68초 후 정확한 바이트 수로 서버에 도착하는
  것을 실측했다.
- 최종 판정은 `docs/superpowers/poc/results.md`(Task 13)에 반영했다.
