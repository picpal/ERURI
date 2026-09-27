# PoC-8(기기 부분)·PoC-9 Share Extension 로컬 영속화 + OCR + 백그라운드 업로드

## 시뮬레이터에서 확인한 것

이 세션의 시뮬레이터(`assistant-poc`, UDID는 `poc/ios/.sim-udid`)에도 PoC-1/2/3/5와 동일하게 공유 시트에서
"EruriPoC" 확장을 탭하는 터치 자동화 도구(idb 등)가 없다. `simctl`에는 공유 시트를 열고 항목을 탭하는 명령이
없어, 계획서 Step 4가 명시적으로 허용한 대로 **launch-argument 디버그 훅**으로 `ShareViewController`가 하는 것과
동일한 `EruriCore` 호출(파일을 App Group에 복사 → `OCR.recognize` → `CaptureQueue.enqueue`)을 App 프로세스에서
직접 재현했다(`--poc-debug-share-image=<host 절대경로>`, `EruriPoCApp.swift`). 공유 시트 UI는 이 세션에서
자동화하지 못했고, 이후 재실측 (d)에서 XCUITest로 시뮬레이터 사진 앱의 공유 시트를 실제로 실행했다.

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
**이 코드 경로(파일 영속화 → OCR → 큐 적재)는 디버그 훅으로 확인했다(부분).** "공유 시트에서 실제로 사진을 골라 확장을
호출"하는 UI 동작은 이 세션에서 자동화하지 못했고 (d)에서 XCUITest로 확인했다.

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
4. **호스트 `ps aux`로 `EruriPoC` 프로세스가 실제로 사라졌음을 직접 확인**(폴링, 300ms 간격, 앱을 다시 열지 않음).
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
동안 시뮬레이터 프로세스 목록에 `EruriPoC` 바이너리는 없었다(직접 확인). 즉 앱 프로세스가 살아있지 않은 상태에서
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

### (d) 실제 공유 시트 UI — 시뮬레이터 XCUITest로 확인, 판정은 부분 (재실측 2026-09-24, Opus 재검증 반영 후)

XCUITest(`UITests/SimRemeasureUITests.testPhotosShareSheetRunsExtension`, `scripts/sim.sh uitest`)로 사진 앱을 조작했다.
`xcrun simctl addmedia`로 합성 이미지("[합성] 합성치과 예약 안내 9월 25일 15:00 진료")를 넣고, 사진 앱 그리드
(`Image`, identifier `PXGGridLayout-Info`) → 공유 버튼 → 공유 시트의 `shareCell` "ERURI PoC"를 탭했다.
확장 프로세스가 실제로 떠서 `poc.log`에 `ShareExtension file id=476CF7E4-… type=image ocrLen=43`(14:35:36Z)를 남겼고,
큐에 `SHARE | inbox/476CF7E4-….jpg | ocrText 43자` 행이 생겼다. 이전 세션의 "도구 부재" 판단은 XCUITest로 해소됐다.
시뮬레이터 결과이므로 `results.md` PoC-8 판정은 **부분**이다. 실기기 공유 시트(App Group 서명 포함) 확인이 남는다.

### 중복 업로드 (Task 7 관찰) — 수정·재실측

이전 세션 `poc.log`에 같은 id의 `upload ok`가 같은 초에 두 번(14:14:29Z), `upload fail`도 두 번씩 남아 있었다. 앱 init과
scenePhase `.active`가 연달아 `flush()`를 부르는데 in-flight 표시가 없었기 때문이다. `CaptureQueue.claim(limit:)`이
단일 `UPDATE … RETURNING`으로 `next_attempt_at = now + 600초` lease를 걸고 항목을 가져가게 바꿨다(연결·프로세스 간에도 원자적,
`testClaimFromTwoConnectionsNeverDuplicates`). 실패 콜백은 lease를 지수 백오프(30초×2ⁿ, 상한 1시간)로 덮어쓴다.
재실측: 앱 실행 한 번에 `flush claimed 1` 한 줄, 해당 id의 `upload fail`도 한 줄(14:31:28Z, 목 서버 미기동).
`Uploader`의 `@unchecked Sendable`은 URLSession delegate를 별도 `UploadDelegate`(상태 없음)로 분리하고 `session`을
`let`으로 바꿔 없앴다. 이제 컴파일러가 Sendable을 검사한다.

### 규칙 필터 적용 (2026-09-25 코드 결정, 스펙 §6)

확장도 텍스트·URL 문자열·이미지 OCR 텍스트에 `RuleFilter`를 적용한 뒤 큐에 넣는다. OTP로 폐기되면 큐에 넣지 않고
파일도 App Group에 저장하지 않는다. 그래서 이미지는 순서가 임시 복사 → OCR → 규칙 → App Group `inbox/` 영속화 → 큐다.
PDF는 OCR이 없어 규칙 대상 텍스트가 없으므로 그대로 영속화한다. 로그(본문 없음): 통과 `ShareExtension file queued id=<uuid> type=image ocrLen=<n>`, 폐기 `ShareExtension file discarded:otp id=- type=image ocrLen=<n>`, 텍스트·URL은 `ShareExtension text|url queued` 또는 `discarded:<reason>`.
(a)의 순서(영속화 → OCR)는 이 변경 전 기록이다.

### 검증하지 못한 것

- 실기기 공유 시트 UI: 시뮬레이터에서는 (d)에서 XCUITest로 실제 실행을 확인했다(부분). 실기기 확인이 남는다.
- **Network Link Conditioner 100% loss 후 복구**(계획서 Step 4의 4번): 이 세션에 passwordless sudo가 없어
  `pfctl`/`dnctl` 기반 호스트 네트워크 제어를 시도하지 않았고, 시뮬레이터 Settings 앱의 UI 조작도 자동화 도구가 없어
  하지 못했다. 미검증.
- 오프라인 상태에서 정확히 몇 초/몇 회 만에 실패로 확정되는지의 수치: 미검증(3분 이상 걸림만 확인).

## 실기기에서 사용자가 할 일

1. iPhone(iOS 26+, iPhone 15 Pro 이상)에 Xcode로 `EruriPoC`를 설치한다.
2. `deno run --allow-net --allow-env poc/server/mock-ingest.ts`를 개발 머신에서 실행하고 방화벽에서 해당 포트를 허용한다
   (8787이 점유돼 있으면 `MOCK_INGEST_PORT=<PORT>`를 앞에 붙인다).
3. 앱 → "업로드 서버" 입력란에 `http://<MAC_IP>:<PORT>`를 입력하고 저장한다(실기기는 `localhost`가 자기 자신이므로 Mac의 LAN IP).
   저장값은 App Group에 남아 홈 화면에서 다시 열어도 유지된다. 스킴 환경변수 `INGEST_URL`은 저장값이 없을 때만 쓰인다.
   앱을 홈 화면에서 다시 열고 `poc.log`의 `ingest base=<url>`이 입력한 주소인지 확인한다.
   첫 업로드 때 iOS가 "로컬 네트워크" 권한 대화상자를 띄우면 허용하고, 대화상자가 떴는지(앱·확장 중 어디서) 기록한다.
4. 사진 앱에서 합성 이미지(청첩장·영수증 형태, 실제 원문 금지)를 길게 눌러 공유 → "ERURI PoC" 확장을 탭한다. 앱을 열어
   큐 화면에 `[SHARE]` 항목과 OCR 텍스트, `poc.log`에 `ShareExtension file queued id=<uuid> type=image ocrLen=<n>`이 보이는지 확인한다. 시뮬레이터에서는 (d)에서 확인했고, 실기기 확인이
   PoC-8 기기 부분의 남은 항목이다(App Group 서명이 실기기에서 통하는지도 여기서 드러난다).
5. `poc.log`의 `flush claimed N to=<host>:<port>`가 Mac 주소인지 본다. "업로드 flush" 버튼을 누르거나 앱을 백그라운드→포그라운드 전환해 `/received`(개발 머신에서 `curl`)에 파일이
   도착하는지 확인한다.
6. 공유 직후 앱을 앱 전환기에서 위로 스와이프해 강제 종료하고, 몇 초~몇십 초 후 개발 머신에서 `/received`를 확인해 파일이
   도착하는지, 도착 시각이 강제 종료 시각보다 뒤인지 기록한다. 도착하지 않으면 실패가 아니라 스펙 §14 PoC-9 문구대로
   "강제 종료 시 취소"로 기록하고, 앱을 다시 열어 업로드가 끝나는지(유실 0)를 확인한다. 시뮬레이터의 `simctl terminate`와
   사용자 스와이프 종료가 같은 조건인지는 이 결과로 판단한다.
7. 비행기 모드를 켠 상태로 공유 → 앱 열기 → flush 실패 확인 → 비행기 모드 해제 → 앱을 다시 열어 재시도 성공과
   유실 0(같은 파일 크기 도착)을 확인한다.
8. 결과를 `docs/superpowers/poc/results.md`의 PoC-8·PoC-9 행에 반영한다.

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
- **`EruriPoCApp.swift`에 `--poc-debug-share-image=<path>` 훅 추가**: 당시 공유 시트 UI 자동화 수단이 없어(이후 (d) XCUITest로 해소)
  `ShareViewController`와 동일한 `EruriCore` 호출을 App 프로세스에서 재현하기 위한, Task 4/5 패턴을 따른 디버그
  훅. `AppInfo.plist`에 `NSAppTransportSecurity > NSAllowsLocalNetworking`을 추가해 시뮬레이터에서 `localhost`
  접근을 허용했다.
- **`Uploader.flush()`의 중복 방지 부재(관찰)**: 오프라인 중 여러 번 `flush()`를 호출하면 같은 항목에 대해 매번
  새 업로드 태스크가 만들어져(진행 중인 태스크 확인 로직 없음) 나중에 중복 실패 로그가 여러 줄 남는 것을 관찰했다.
  계획서 코드를 그대로 구현했고 데이터 유실로 이어지지는 않았지만, 제품화 시에는 `session.getAllTasks()`로 같은
  `taskDescription`이 이미 있으면 건너뛰는 처리가 필요해 보인다(이번 태스크 범위 밖이라 수정하지 않음).

## 판정 기준 (스펙 §14 PoC-8 기기 부분·PoC-9)

- **PoC-8(기기 부분) 통과 조건**: 이미지·PDF·URL·텍스트 공유가 App Group에 영속화되고, 이미지는 OCR 텍스트가 큐에
  같이 저장된다. → 시뮬레이터에서 디버그 훅(a)과 XCUITest 공유 시트(d)로 파일 저장·큐 적재·OCR을 확인했다. 판정은
  **부분**이고, 실기기 공유 시트 확인 후 통과로 올린다.
- **PoC-9 통과 조건**: 앱이 완전히 종료된 뒤에도 이미 시작된 background URLSession 전송이 서버까지 도착한다. →
  **통과**. 호스트 프로세스 목록으로 앱이 죽어 있음을 직접 확인한 뒤 3.68초 후 정확한 바이트 수로 서버에 도착하는
  것을 실측했다.
- 최종 판정은 `docs/superpowers/poc/results.md`(Task 13)에 반영했다.

## PoC-8 서버 부분 (Task 12, 2026-09-27)

### 구성

- `_shared/extract.ts` `extractEvent(input)`: `gpt-6-luna`, Responses API, `text.format` json_schema `strict: true`, `store: false`,
  reasoning `none`. 이미지는 `input_image`(data URL, detail high), PDF는 `input_file`(`file_data` data URL), 기기 OCR 텍스트가
  있으면 같이 `input_text`로 넣는다. 오늘 날짜는 서울 기준으로 주입(계획서의 하드코딩 제거).
- 정규화(서버, 결정적): 일시는 ISO 8601 `+09:00`(오프셋 없으면 서울 현지, 다른 오프셋은 변환, 날짜만이면 종일로 `YYYY-MM-DD`),
  해석 불가 → null + `date`, 종료 < 시작 → 종료 버림 + `end`. 스키마에 **사실 플래그** `year_in_text`·`lunar`를 두고
  (결과에는 남기지 않음) 연도 없음 → `year` + 연도를 "오늘 이후 가장 가까운 해"로 서버가 재계산, 음력 → `date`.
- worker `extract` 잡: `items.storage_key` → Storage(`poc` 비공개 버킷) → `reserve_vision_call`(월 100건, 호출 전 예약,
  한 문장 upsert로 동시 호출에도 초과 없음) → vision, **상한 초과 시 OCR 텍스트만**, OCR도 없으면 `needs_review`.
  PDF 10MB 초과도 `needs_review`. 결과는 `save_event_fact`로 `facts`(event) + `proposals`(create_event) 한 트랜잭션,
  같은 항목 재시도는 1건 유지. 토큰은 `usage_counters.extract_tokens`에 정산. 로그는 id·경로(vision/ocr)·유무·개수만.
- worker `process` 잡(계획서 Step 3): 복호화된 텍스트만 `extractEvent({ ocrText })`에 넘기고 checkpoint `extracted`.
- `vision-extract`(측정용): body `{ storagePath: 'poc/…', ocrText? }`, secret 키 호출만, `poc` 버킷만.
- 마이그레이션 `0012_extract.sql`: `usage_counters`·`facts`·`proposals`, `insert_media_item`(extract 잡, 테스트는
  `test:` lease_key), `worker_get_media`(소유 조건 + OCR 복호화 감사), `reserve_vision_call`, `add_extract_tokens`,
  `save_event_fact`. worker는 secret 키 호출 본문에 `lease_prefix: 'test:…'`가 있으면 그 테스트 잡만 가져간다(cron은 본문 `{}`).
- 테스트: `extract.test.ts` 16개(스키마 strict·요청 구성·정규화·연도/음력 플래그·잘림/거절·상한 폴백·needs_review·
  vision-extract 권한), `extract-db.test.ts` 3개(호스팅 DB: 99→100→거부·동시 2건도 100 유지, vision→OCR 폴백 e2e,
  fact·proposal 멱등, 소유자 외 거부). 전용 테스트 사용자·`test:` 태그만.

### 합성 입력 (eval/images, git 제외, `eval/gen-images.py` → `make-pdf.sh` → `ocr.swift`)

| 파일 | 형태 | 날짜 표기 | 정답 시작 | 기대 uncertain |
|---|---|---|---|---|
| 01-formal.png | 청첩장 카드 | 2026년 10월 17일 토요일 오후 1시 (+식사 12시 30분 방해) | 2026-10-17 13:00 | 없음 |
| 02-mobile-slash.png | 모바일 청첩장 스크린샷 | 10/31(토) 11:30 (연도 없음) | 2026-10-31 11:30 | year |
| 03-mobile-noon.png | 모바일 청첩장 스크린샷 | 11월 14일 토요일 낮 12시 (연도 없음) | 2026-11-14 12:00 | year |
| 04-event-dot.png | 동창회 안내 | 2026. 12. 5.(토) 18:00 ~ 21:00 (+입금 마감 방해) | 2026-12-05 18:00, 종료 21:00 | 없음 |
| 05-lunar.png | 칠순 잔치 | 2026년 음력 9월 14일 (토) 낮 12시 30분 | 양력 2026-10-24 12:30 | date |
| 06-notice.pdf | 텍스트 PDF(가정통신문) | 2026년 11월 20일(금) 오전 10시 ~ 11시 30분 (+발행일·회신 기한 방해) | 2026-11-20 10:00, 종료 11:30 | 없음 |
| 07-scan.pdf | 스캔형 2쪽 이미지 PDF | 2쪽: 2026년 12월 19일 토요일 오후 2시 30분 | 2026-12-19 14:30 | 없음 |

OCR 텍스트는 macOS Vision(ko-KR, accurate, Share Extension과 같은 API)으로 만들었고 텍스트 PDF는 PDFKit 문자열.

### 실측 (배포 `vision-extract`, 서울, 7파일 × 3회 × 모드, `eval/out/vision-20260927-r3.json`)

| 모드 | 제목·시작·장소 모두 | uncertain 적중 | 오탐 uncertain | 호출 지연 p50 / p95 | 모델 p50 / p95 | 입력/출력 토큰 | 건당 비용 |
|---|---|---|---|---|---|---|---|
| vision + OCR (worker 기본 경로) | **21/21** | 21/21 | 0 | 1.95s / 2.53s | 1.42s / 2.06s | 3,814 / 82 | $0.00042 |
| vision만 | 19/21 | 21/21 | 0 | 1.99s / 4.07s | 1.43s / 1.74s | 3,675 / 82 | $0.00041 |
| OCR 텍스트만 (상한 초과 폴백) | **21/21** | 21/21 | 0 | 1.48s / 1.81s | 1.17s / 1.47s | 871 / 82 | $0.00013 |

- 파일별(vision+OCR): 01~04·06·07 모두 제목·시작·장소·종료 3/3. 05 음력은 `date` 표시 3/3이지만 **양력 환산 정확 0/3**
  (3회 모두 10-25, 하루 어긋남). vision만 2/3, OCR만 3/3 정확. 즉 음력 환산은 모델에 맡길 수 없고 `date` 표시로
  REVIEW 경로에 보내는 것이 맞다.
- vision만의 실패 2건은 07 스캔 PDF 제목을 혼주 부모 이름("윤태식·강동수 결혼식")으로 지은 것. 일시·장소는 맞다.
  기기 OCR을 함께 넣으면 3/3.
- 반복 개선 기록: r1(초기 지시문) vision+OCR 21/21이나 음력 `date` 표시 2/3·연도 `year` 표시 OCR 1/3, 모델이 종료가 없는
  행사에 `end`를 넣어 "추가" 버튼이 막히는 문제 → 지시문 수정. r2(플래그 도입) `uncertain` 적중 100%, 그러나 연도 없는
  03을 2027로 채운 1건 → r3(연도 서버 재계산) 해소.
- 배포 worker 전 경로(`eval/run-worker-extract.ts`, 테스트 사용자·`test:` 태그): extract 잡 7/7 `done`·checkpoint
  `proposed`(attempts 1), `facts` 7 + `proposals` 7(create_event), 시작 정답 또는 `date` 표시 7/7, `usage_counters`
  vision_calls 7·extract_tokens 29,789(건당 약 4.3k). process 잡 3/3 `extracted`. 잡당 1.4~2.8초, 5잡 배치 9~11초
  (cron `timeout_milliseconds` 5초보다 길지만 pg_net 응답 대기일 뿐 함수는 끝까지 실행). 끝난 뒤 이번 실행 행·파일 삭제,
  배포 후 cron 틱 `succeeded`·HTTP 200.
- 비용: vision 월 100건 상한 × $0.00042 ≈ **$0.04/월**(스펙 §13 추정 $0.01보다 약 4배, 토큰이 3k가 아니라 3.8~4.3k).

### 판정

- 서버 부분(스펙 §14 "날짜·장소·연도 추출 5/5"): **통과** — 청첩장·안내 7종(이미지 5, PDF 2) 제목·시작·장소
  vision+OCR 21/21, 연도 없는 2종은 연도 맞고 `year` 표시 3/3. 단 음력 1종은 날짜를 확정하지 않고 `date`로 사용자
  확인에 넘긴다(환산값은 하루 틀림). 대안(OCR 텍스트만)도 21/21.
- PoC-8 전체는 기기 부분(실기기 공유 시트·오프라인 후 유실 0)이 남아 **부분**.

### 계획서·스펙과 달라진 점 / 반영 필요

- 스키마에 `year_in_text`·`lunar` 플래그 추가, 연도는 서버가 재계산(계획서 Step 1 스키마·"가장 가까운 미래 연도로 채워라"를
  모델에 맡기던 부분). 스펙 §7 추출 절에 "uncertain은 서버가 사실 플래그로 결정" 반영 필요.
- 음력 날짜: 스펙에 규칙 없음 → "음력은 `date` 표시로 REVIEW, 제품에서는 서버 음력 변환표로 환산" 추가 필요.
- 계획서 Step 2는 "Storage `poc/` 버킷에 5종" — 실제로는 7종(PDF 2), `vision-extract`는 secret 키 전용.
- 스펙 §8 `facts`·`proposals`·`usage_counters` 최소 컬럼만 생성. 재시도 시 vision 예약이 한 번 더 올라간다(상한 계산이
  보수적), PDF 50페이지 검사는 미구현(10MB만).
- 스펙 §13 vision 토큰 추정(건당 3k) → 실측 3.8~4.3k.
- `process` 잡이 분류 없이 모든 텍스트 항목에 추출을 호출한다(계획서 Step 3 그대로). 스펙 §7 순서(분류 → discard 삭제 →
  추출)와 다르므로 분류 단계 도입 전까지 실제 Gmail 항목도 추출 호출 1회가 추가된다.
