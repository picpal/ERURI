# PoC 판정표

상태: **통과** = 계획서 판정 기준을 실측으로 충족 · **부분** = 코드 경로만 확인(디버그 훅·시뮬레이터 대체) · **실패** · **미검증**. 다음 단계 진입 조건은 해당 PoC 가 **통과**인 것이다. 실기기 필요 항목은 실기기 세션 후 갱신한다.

| PoC | 검증 대상 | 태스크 | 상태 | 근거 / 남은 실측 | 갱신일 |
|---|---|---|---|---|---|
| PoC-1 | 단축어 Notification 트리거 → CaptureIntent 자동 실행 | 4 | 미검증 | 시뮬레이터(재실측 09-24): `Metadata.appintents`에 CaptureIntent·App Shortcut 등록 확인, XCUITest로 **단축어 앱에서 수동 실행** 시 앱을 열지 않고 `CaptureIntent queued:rules … textLen=0 locked=false`(14:32:51Z). 이것은 인텐트 호출 경로일 뿐 판정 기준(알림 트리거로 본문·앱명 전달)은 아니다. 남은 실측: 실기기 알림 자동화 시나리오 1~8(`app=`·`textLen=` 로그, 시나리오 8은 연락처 발신 카톡 `discarded:contact`). 절차 `poc-1-notification-trigger.md` | 2026-09-24 |
| PoC-2 | 단축어 Message 트리거 → CaptureIntent 자동 실행 | 4 | 미검증 | 인텐트 호출 경로는 PoC-1과 같이 시뮬레이터에서 확인. 남은 실측: 실기기 메시지 자동화, 잠금 15초 후 수신 `locked=true`, BFU 수신은 `bfu.log`(보호 등급 none, 내용 없이 길이만)로 판독, OTP 문자 `discarded:otp`, 연락처 번호 문자 `discarded:contact`. 절차 `poc-2-message-trigger.md` | 2026-09-24 |
| PoC-3 | Foundation Models 한국어 분류 200건 정확도·p95 | 5 | 부분 | 재실측 09-24: 호스트 Mac이 `appleIntelligenceNotEnabled`(macOS 26.5에서 직접 호출로 확인)라 시뮬레이터 `availability()=available`은 오표시, `respond`는 에셋 에러(`FM error other`). 수정본(호출마다 새 세션, enum 스키마, 제목 입력, 에러→폴백, 제시간 타임아웃)은 단위 테스트 통과, 앱 프로세스 `CaptureIntent.perform()`에서 Coupang→`queued:rules`, KakaoTalk→`discarded:fm-error` 확인. 정확도·p95·메모리 수치 없음. 남은 실측: Mac Apple Intelligence 켜기(사용자) 또는 실기기 벤치마크, 메모리, 백그라운드 인텐트 `rateLimited` 빈도. 절차 `poc-3-fm-classifier.md` | 2026-09-24 |
| PoC-4 | Edge Function → APNs HTTP/2 | 9 | 미검증 | Supabase 프로젝트·.p8 필요 | 2026-09-24 |
| PoC-5 | 잠금화면 알림 액션 → 백그라운드 EventKit 멱등 쓰기 | 6 | 부분 | 재실측 09-24(XCUITest, 실제 배너·액션 탭, 로컬 알림): 백그라운드 `ADD ok … bg=true auth=3`(14:29:48Z), 같은 알림 재탭 `dup skip`(14:30:08Z), **앱 종료 후 액션 콜드 스타트** `bg=true`(14:31:00Z), 동시 두 번 탭 이벤트 +1만(14:32:23Z). 남은 실측: **잠금 화면**에서 `.authenticationRequired`의 Face ID/암호 요구와 쓰기 성공(시뮬레이터는 암호 없음), 보고 실패 후 재탭은 서버 연동 후. 절차 `poc-5-notification-eventkit.md` | 2026-09-24 |
| PoC-6 | Gmail watch → Pub/Sub → history 동기화 | 10 | 미검증 | GCP OAuth·Pub/Sub 필요 | 2026-09-24 |
| PoC-7 | 한국어 하이브리드 검색 Top-5 정확도 | 11 | 미검증 | Supabase·Voyage 키 필요 | 2026-09-24 |
| PoC-8 | 이미지·PDF → OCR/추출 → 일정 | 7, 12 | 부분 | 기기 부분(시뮬레이터): 재실측 09-24 XCUITest로 **사진 앱 → 공유 시트 → Assistant PoC 확장**을 실제로 실행, `ShareExtension file … ocrLen=43`(14:35:36Z)·큐 `SHARE` 행 확인(합성 이미지). 남은 실측: 실기기 공유 시트 → 큐·업로드(App Group 서명 포함, 대기 목록), 서버 부분(vision 추출 5/5, 오프라인 유실 0)은 Task 12. 절차 `poc-8-9-share-upload.md` | 2026-09-24 |
| PoC-9 | 앱 종료 후 background URLSession 업로드 완료 | 7 | 통과 | 호스트 `ps aux`로 앱 프로세스 완전 종료 확인(14:07:27.946) 후 3.68초 뒤 목 서버에 정확한 바이트 수로 도착(14:07:31.628) 실측. 실기기 회귀 확인은 대기 목록. 절차 `poc-8-9-share-upload.md` | 2026-09-24 |
| PoC-10 | jobs 큐 lease/재시도/dead 처리 | 8 | 미검증 | Supabase 프로젝트 필요 | 2026-09-24 |

## 실기기 세션 대기 목록

PoC-1, PoC-2, PoC-3, PoC-5, PoC-8(기기 부분), PoC-9. 한 세션에서 순서대로 진행: 설치 → 권한(알림·캘린더·연락처) → 단축어 자동화 3개(카톡 알림·인스타 알림·메시지) → FM 벤치마크(⌘U, 메모리 게이지 기록) → 단축어로 백그라운드 FM 10~20회 → 잠금 화면 로컬 알림 액션(APNs 불필요, Face ID 요구 기록) → 공유·업로드 → 재부팅 후 BFU 문자 수신.

PoC-8·9 실기기 항목(절차 `poc-8-9-share-upload.md` "실기기에서 사용자가 할 일"):

- 목 서버 LAN 접속: Mac에서 목 서버 실행, 앱 "업로드 서버" 입력란에 `http://<MAC_IP>:<PORT>` 저장, 앱 재실행 후 `poc.log`의 `ingest base=<url>` 확인, iPhone Safari로 `/received` 도달 확인. 로컬 네트워크 권한 대화상자가 뜨는지 기록.
- 실기기 사진 앱 공유 시트 → Assistant PoC 확장 → 큐 `SHARE` 행·OCR 텍스트(App Group 서명이 실기기에서 통하는지 포함).
- flush → 목 서버 `PUT /upload/<id>` 도착, 바이트 수 일치.
- 공유 직후 앱 전환기에서 강제 종료 → 도착 여부와 시각(스펙 §14 PoC-9: 강제 종료 시 취소되면 그대로 기록), 앱 재실행 후 업로드로 유실 0.
- 비행기 모드 공유 → 복구 후 재시도 성공, 유실 0.

## 참고 (Opus 재검증 반영, 2026-09-24)

- **연락처 규칙 배선 (2026-09-25)**: 앱이 연락처 이름을 App Group `contacts.json`에 캐시하고(권한 미허용이면 빈 집합, `contacts status=<상태> names=0`), 인텐트는 캐시만 읽어 `sender`·`title`을 비교한다(공백 전부 제거, 끝 "님"/"씨" 제거). 계획서 Task 4 Step 6. 실기기 카톡·문자 확인은 PoC-1 시나리오 8·PoC-2 시나리오 5.
  - 시뮬레이터 실측 (2026-09-25, `affe7e9`, 합성 연락처 "합성연락처" 1건을 `simctl addmedia`로 추가, 인텐트 디버그 훅 `--poc-debug-capture-intent`): 권한 revoke 상태 → `contacts status=denied names=0`, 제목 "합성연락처님"이 연락처 규칙에 걸리지 않고 FM 폴백(`discarded:fm-error`)으로 진행(11:59:33Z). 권한 grant 후 → `contacts status=authorized names=8`(기본 샘플 포함), 제목 "합성연락처님" `CaptureIntent discarded:contact 1ms`(11:59:47Z), 발신자 " 합성 연락처 씨" `discarded:contact`(11:59:56Z), 대조군 제목 "박지훈"은 연락처 규칙 비해당(`discarded:fm-error`, 12:00:04Z). 알림 자동화 경로가 아니라 앱 프로세스 인텐트 호출이므로 판정은 **부분**, 실기기 확인은 위 시나리오.
- **업로드 서버 설정 유지 (2026-09-25, `affe7e9`)**: XCUITest `testIngestURLPersistsAcrossRelaunch`로 앱 입력란에 `http://192.168.77.7:9787` 저장 → 앱 종료 → **홈 화면 아이콘으로 재실행**(환경변수 없음) → 화면·로그 `ingest base=http://192.168.77.7:9787` 유지(11:59:14Z). 이어서 `SIMCTL_CHILD_INGEST_URL=http://10.9.9.9:8787`로 실행해도 저장값 유지(11:59:28Z) — 스킴 환경변수는 저장값이 없을 때 초기값으로만 쓰인다. 공유 확장 변경 후 사진 공유 시트 XCUITest 재실행: `ShareExtension file queued id=… type=image ocrLen=43`(12:00:41Z).
- **App Group 테스트**: `AppGroupTests`는 시뮬레이터가 App Group 프로비저닝을 강제하지 않아 통과한다. 서명·포털 등록은 실기기 설치 때 확인한다.
- **시뮬레이터 UI 실측 도구**: `scripts/sim.sh uitest [AssistantPoCUITests/SimRemeasureUITests/<테스트>]`, 로그는 `scripts/sim.sh log [n]`.
- **FM 폴백**: FM 불가·타임아웃·에러 모두 같은 폴백(카톡·인스타 폐기, 그 외 `device_filter="rules"`로 적재, `kind=unknown` 로그)이다. `CaptureItem.deviceFilter`에 저장된다.

