# PoC 판정표

상태는 네 값만 쓴다: **통과** = 스펙 §14 판정 기준을 실측으로 충족 · **부분** = 코드 경로만 확인(디버그 훅·시뮬레이터·가짜 토큰 대체) 또는 판정 기준의 일부만 실측 · **실패** = 기준 미달(대안 채택) · **미검증** = 판정 기준 관련 실측 없음. 다음 단계 진입 조건은 해당 PoC가 **통과**인 것이다(AGENTS.md §5-8).

이 표는 스펙 §14 "판정 현황"과 **같은 내용**이다(표를 고칠 때 둘 다 고친다). 행이 길어지는 측정값·시각·로그는 아래 "PoC별 상세"에 둔다.

## 판정 (2026-09-28)

| PoC | 검증 대상 | 태스크 | 상태 | 핵심 근거 | 남은 실측 | 근거 커밋 | 갱신일 |
|---|---|---|---|---|---|---|---|
| PoC-1 | 단축어 Notification 트리거 → CaptureIntent 자동 실행 | 4 | 통과 | 실기기(09-28, iOS 27, TestFlight 0.1.1): "새로운 빈 자동화"에 알림 트리거(카카오톡+Slack 다중 선택, "모든 앱"은 불가)·"비서에 저장" 직접 편집(본문=단축어 입력→내용) → Slack 알림 본문 183자·155자, `locked=true`·`bg=true`, **배너 탭 없이 실행**. 1건은 `len=0`. 제목·앱 이름 변수 연결 후 05:24:48Z `len=147`·`title=11`·`app=true`·`locked=true` — **본문·제목·앱 이름 전부 전달** | 카카오톡 알림 실측, `len=0` 1건 원인, 미리보기 꺼짐·묶음 알림 기록, 연락처 발신 `discarded:contact` | `964cfea` `affe7e9` `47e9435` | 2026-09-28 |
| PoC-2 | 단축어 Message 트리거 → CaptureIntent 자동 실행 | 4 | 통과 | 실기기(iOS 27, TestFlight 0.1.1): "새로운 빈 자동화" 안에서 "비서에 저장" 직접 편집(본문=단축어 입력→내용) → 본문 30/15/15자·발신자 도착, `bg=true`, 1.5~2.5초, 무확인 실행. **잠금 수신 확정**: 05:02:04Z `locked=true` 본문 38자·발신자. 기존 단축어 선택 방식은 발신자만·본문 0자(6건). **제품 경로(09-28 사용자 최종)**: 알림 자동화 1개(메시지 앱 포함)로 수집, 메시지 트리거는 선택 사항. 06:00Z 메시지 트리거로 문자 3건(연락처 있는 지인 발신) 모두 `src=MESSAGE, app=SMS`·발신자 번호·본문 도착(통과 근거 유지). 알림 경로(05:50:19Z)는 `app=메시지`·발신자 표시 이름, 알림이 안 뜨는 문자(조용히 한 대화·알 수 없는 발신자·집중 모드)는 누락 감수 | 판정 기준 중 BFU(재부팅 후 첫 해제 전) 수신 처리 기록, OTP `discarded:otp`, 연락처 번호 `discarded:contact` | `ca859a4` `47e9435` | 2026-09-28 |
| PoC-3 | Foundation Models 한국어 분류 200건 정확도·p95 | 5 | 부분→통과(정확도 8/10) | 폴백 경로(Coupang→`queued:rules`, KakaoTalk→`discarded:fm-error`)·새 세션·enum 스키마·타임아웃 단위 테스트. 호스트 Mac Apple Intelligence 꺼짐으로 수치 없음 **실기기(09-29, iOS 27, 0.2.0, Slack 웹훅 합성 문구 10개)**: Apple Intelligence 분류기 동작 확인. 택배·병원·카드·컨퍼런스·공과금 5건 `queued:rules`(p50 3.13s, 최대 3.22s), 광고 `discarded:fm:promo`(2.04s), 인증번호 `discarded:otp`(정규식 6ms), 경계 문구(목요일 판교 약속) `queued:rules`. 잡담 2건(ㅋㅋㅋ/밥 먹었어?)은 `queued:rules` 로 통과시켜 오분류 → 서버 규칙이 걸러야 함. 별도 관찰: 4자 알림 `discarded:fm-timeout`, 지인 문자 `discarded:fm:personal`. 정확도 8/10, 잠금·백그라운드에서 실행 | 실기기 200건 p95·개인 대화 통과율·알림톡 폐기율, 메모리, 백그라운드 `rateLimited` 빈도. **실기기 관찰(09-28 06:00Z)**: 지인 약속 문구 문자 3건이 `discarded:fm:personal`로 폐기 → 약속·일정이 담긴 개인 대화의 폐기율을 재측정 | `b1f3248` `0d2a293` `affe7e9` | 2026-09-24 |
| PoC-4 | Edge Function → APNs HTTP/2 | 9 | 부분 | h2 동작(가짜 토큰 sandbox `400 BadDeviceToken`+`apns-id`, HTTP/1.1 대조군 거부), Edge 서울 100회 동시 1 100/100 p50 419ms, JWT 429 수정. **실기기(09-28)**: 앱 토큰 등록(`devices` production, 0.1.1) → `apns-send` count 1 → APNs 200 production 634ms, 잠금 화면 수신 확인 | 100회 동시 10 × 2(성공률 ≥ 99%, h2 오류 0) — 판정 기준. 노출된 APNs 키 교체 후 실시 | `e2552b5` `40d83cc` `b84bd60` | 2026-09-28 |
| PoC-5 | 잠금화면 알림 액션 → 백그라운드 EventKit 멱등 쓰기 | 6 | 부분 | XCUITest(실제 배너·액션 탭, 로컬 알림): 백그라운드 쓰기 `bg=true`, 재탭 `dup skip`, 앱 종료 후 콜드 스타트, 동시 두 번 탭 이벤트 +1 | 실기기 잠금 화면 `.authenticationRequired` 인증 후 1건. 보고 실패 후 재탭은 서버 연동 후 | `0e89279` `0d2a293` | 2026-09-24 |
| PoC-6 | Gmail watch → Pub/Sub → history 동기화 | 10 | 부분 | 실계정: 연결·watch +7일, 백필 85 ID → 76행·429 없음·`content_enc` null 0, 웹훅 약 8초(1회), 404 재동기화로 누락 1건 복구·중복 0 | 웹훅 지연 5회 평균, watch 갱신(수동+다음 날 cron), 6일 `expiring`·8일 `invalid_grant`, 규칙 필터 OTP·카드 메일. 백필이 증분 동기화를 굶기는 문제(스펙 §16) | `ea6c762` `87673fe` `cdd7c79` | 2026-09-27 |
| PoC-7 | 한국어 하이브리드 검색 Top-5 정확도 | 11 | 통과 | 합성 500건·질문 50: 하이브리드 + `text-embedding-3-large`(512) Top-5 38/40(95%), 무근거 거절 10/10, 인용 36/36·정밀도 39/39, 날짜 필터 오판 0, 검색 p95 70~111ms | — (1a에서 실데이터 검색 평가) | `4c00aa7` `cf786bb` `9e8ab9f` | 2026-09-27 |
| PoC-8 | 이미지·PDF → OCR/추출 → 일정 | 7, 12 | 부분 | 서버: 합성 7종(이미지 5·PDF 2) vision+OCR 21/21, OCR만 21/21, `uncertain` 21/21, p50 1.95s·p95 2.53s, 건당 $0.00042, worker extract 7/7. 기기(시뮬레이터): 사진 앱 공유 시트 → 확장 `ocrLen=43`·큐 `SHARE` 행 | 실기기 공유 시트 → 큐·업로드(App Group 서명), 오프라인 후 복구 유실 0 | `f28814d` `0d2a293` `affe7e9` `7f533f1` | 2026-09-27 |
| PoC-9 | 앱 종료 후 background URLSession 업로드 완료 | 7 | 통과 | 앱 프로세스 종료를 `ps`로 확인한 뒤 3.68초 후 목 서버에 정확한 바이트 수로 도착. 실기기(09-28): 로그인 직후 큐 7건 일괄 업로드(`poc9.upload_done` ×7), 잠금 중 수신분은 해제·앱 열기 후 업로드(45초 뒤), 서버 `process` 잡 전부 `done` | — (실기기 회귀: 스와이프 종료·비행기 모드, 파일 업로드는 서버 `upload/<id>` 엔드포인트 구현 후) | `f28814d` | 2026-09-28 **0.2.0 실기기(09-29)**: 잠금 중 Slack 알림 → `path=intent_direct` 0.86초 즉시 업로드(앱 미실행). 비행기 모드에서 공유 확장으로 큐 적재 → 잠금 화면에서 네트워크 복구 → 서버 무음 푸시(APNs 200) → 33초 뒤 `poc9.wake`·`poc9.upload_done path=silent_push` 도착(앱 미실행). 앱이 떠 있으면 `path=foreground` 16초. trace `locked` 값은 잠금 중에도 false 로 찍혀 신뢰 불가(버그) |
| PoC-10 | jobs 큐 lease/재시도/dead 처리 | 8 | 통과 | 같은 lease_key 동시 클레임 1건, 5회 실패 후 `dead`, 임대 180초+하트비트로 90초 잡 재클레임 0·attempts 1, 복호화 p50 0.7ms·p95 56ms | — (판정 기준 밖: 150초 강제 종료 잡 재클레임, 24시간 활동 유지) | `2d9a45a` `6ca66d8` | 2026-09-26 |

**집계: 통과 5(PoC-1·2·7·9·10) · 부분 5(PoC-3·4·5·6·8) · 실패 0 · 미검증 0.** 부분 5건과 PoC-1·2·9 실기기 보완 항목은 아래 "실기기·장기 실측 대기"(8개 PoC)로 넘어간다.

## 실기기·장기 실측 대기

한 번의 실기기 세션(절차 `docs/superpowers/reports/2026-09-24-device-session.html`)과 달력에 걸친 Gmail 관찰로 나눈다. 관찰값은 `poc_traces`로 올라오므로(절차 `poc-traces.md`) Mac에서 `scripts/sql.ts`로 조회해 판정한다.

| PoC | 남은 실측 | 필요한 것 | 판정 근거 | 절차 |
|---|---|---|---|---|
| PoC-1 | **보완**: 카카오톡 알림, `len=0` 원인, 미리보기 꺼짐·묶음, 연락처 발신 폐기(Slack 본문·잠금·백그라운드는 09-28 통과) | 실기기, 두 번째 카톡 계정, 연락처 1건 | `poc1.intent_fired`의 `app_set`·`text_len`·`locked`·`result` | `poc-1-notification-trigger.md` |
| PoC-2 | **보완**: BFU 수신(재부팅 후 첫 해제 전) 처리 기록, OTP·연락처 번호 폐기 | 실기기, 테스트 발신 번호, 재부팅 | `poc2.intent_fired`, BFU는 `bfu.log` | `poc-2-message-trigger.md` |
| PoC-3 | **신규 실측**: FM 200건 p95·통과율·폐기율, 메모리, 백그라운드 10~20회 `rateLimited` | 실기기 + Xcode ⌘U(케이블·개발 설치), Apple Intelligence 모델 다운로드 완료 | `FM_BENCH`/`fm_bench.txt`, `poc3.bench_done`, 백그라운드는 `poc1.intent_fired`의 `result` | `poc-3-fm-classifier.md` |
| PoC-4 | **동시 10**: 100회 동시 10 × 2(1회 production 수신은 09-28 완료) | APNs 키 재교체 후, TestFlight 설치 기기(`devices` 행 있음) | `apns-send` 응답 `ok`·`byStatus`·`h2Errors` | `poc-4-apns.md` |
| PoC-5 | **신규 실측**: 잠금 화면 `.authenticationRequired` 액션 → Face ID/암호 → 1건 | 실기기, 기기 암호 | `poc5.action_handled`의 `result`·`dup`·`bg`·`locked` | `poc-5-notification-eventkit.md` |
| PoC-6 | **반복 항목**: 웹훅 지연 5회 평균, watch 갱신 2회(수동·cron), 6일 `expiring`, 8일 `invalid_grant`→`reauth_required`, 규칙 필터 OTP·카드 메일 | 연결 후 8일(달력), 실측 중 테스트 DB 초기화 금지 | `sync_states`·`connections`·`jobs`, `gmail_reauth_due()` | `poc-6-gmail.md` |
| PoC-8 | **실기기 회귀**: 사진 공유 시트 → 큐·OCR, 업로드 바이트 일치, 비행기 모드 후 유실 0 | 실기기, 서버 파일 업로드 엔드포인트(`PUT upload/<id>`, Supabase에 없음 — 09-28 발견) | `poc8.share_received`, `poc9.upload_done` | `poc-8-9-share-upload.md` |
| PoC-9 | **실기기 회귀**: 공유 직후 스와이프 종료 → 도착 또는 취소 기록, 재실행 후 유실 0(텍스트 업로드 09-28, 무음 푸시·직접 업로드 09-29 확인; BGAppRefresh 경로는 미관측) | 위와 같음 + 서버 `upload/<id>` | `poc9.upload_done`, `/received`의 `at` | `poc-8-9-share-upload.md` |

권장 순서(한 세션): TestFlight 설치 → 권한·PoC 사용자 로그인 → 단축어 자동화 3개(PoC-1·2)와 백그라운드 FM 10~20회 → PoC-4 토큰 등록·발송(production) → 잠금 화면 로컬 알림 액션(PoC-5) → 공유·업로드(PoC-8·9) → FM ⌘U 벤치마크(PoC-3, 케이블·개발 설치가 TestFlight 앱을 덮어쓰므로 후반) → 재부팅 BFU(PoC-2 시나리오 3). PoC-6은 세션과 별개로 연결일 기준 6일·8일째에 확인한다.

## PoC별 상세

표의 "핵심 근거"를 뒷받침하는 측정값·시각·로그 원본이다(이전 판정표의 "근거 / 남은 실측" 열을 그대로 옮겼다).

### PoC-1 단축어 Notification 트리거 → CaptureIntent 자동 실행 (갱신 2026-09-28)

**iOS 27 단축어 UI 관찰(09-27~28, 실기기)**: iOS 26 문서와 화면이 다르다. 자동화 트리거 화면에 "즉시 실행/실행 전에 묻기"·"다음" 버튼이 없고, 단축어를 고르지 않으면 목록에 "설정 마저 하기"로 남는다. 메시지 자동화는 조건(보낸 사람 또는 포함 문구)이 있어야 켜지며 "메시지 → 다음을 포함" 조건을 두면 "실행 묻지 않기"가 나타난다. "입력 없음" 칩은 세부사항 화면으로 가고 "공유 시트 유형" 항목이 없다. 알림 자동화도 PoC-2와 같이 "기존 단축어 선택"이 아니라 자동화 안에서 액션을 직접 편집하는 방식으로 잰다(아래 PoC-2).

**알림 트리거(09-28 새벽, 사용자 보고)**: 자동화 목록에 알림 트리거가 있다. 앱은 여러 개를 동시에 고를 수 있고 "모든 앱"은 고를 수 없다 → 알림 자동화 1개에 앱 여러 개를 체크하도록 안내한다. 본문·앱명 전달은 아래 실측.

**알림 자동화 실측(09-28, 실기기)**: "새로운 빈 자동화"에 알림 트리거(카카오톡+Slack 다중 선택), "비서에 저장" 직접 편집(본문 = 단축어 입력 → "내용"). Slack 알림 05:08:33Z `len=183`·`locked=true`·`bg=true`, 05:08:39Z `len=0`, 05:08:43Z `len=155`·`locked=true`. 확인 배너 탭 없이 실행. 제목·앱 이름은 처음엔 변수 미연결로 비었으나, 제목·앱 이름 칸에도 단축어 입력 변수를 연결한 뒤 05:24:48Z `len=147`·`title=11`·`app=true`·`locked=true` 로 전부 전달됐다. 판정: 본문·제목·앱 이름 전달, 잠금, 백그라운드 무확인 실행 모두 확인 → **통과**. 카카오톡 알림·미리보기 꺼짐·묶음 알림은 미기록.

시뮬레이터(재실측 09-24): `Metadata.appintents`에 CaptureIntent·App Shortcut 등록 확인, XCUITest로 **단축어 앱에서 수동 실행** 시 앱을 열지 않고 `CaptureIntent queued:rules … textLen=0 locked=false`(14:32:51Z). 이것은 인텐트 호출 경로일 뿐 판정 기준(알림 트리거로 본문·앱명 전달)은 아니다. 남은 실측: 실기기 알림 자동화 시나리오 1~8(`app=`·`textLen=` 로그, 시나리오 8은 연락처 발신 카톡 `discarded:contact`). 절차 `poc-1-notification-trigger.md`

### PoC-2 단축어 Message 트리거 → CaptureIntent 자동 실행 (갱신 2026-09-28)

**실기기 세션 1 (2026-09-28, iOS 27, TestFlight 0.1.1 `202609272353`, `poc_traces`·`items`·`jobs` 조회, 본문 조회 없음)**:
- **자동화 → "단축어 선택"으로 기존 단축어(ERURI에 저장) 실행**: 발신자(Sender 속성)만 전달, 본문 0자 — 6건, 단축어 파일 v1·v2(Content)·v2-b(Body) 모두. v2-alt(입력에서 텍스트 가져오기)는 실행 자체가 안 됨.
- **자동화 → "새로운 빈 자동화"에서 "비서에 저장" 직접 편집, 본문 = 단축어 입력 → "내용"**: 본문 30자·15자·15자 + 발신자 도착(04:46:28Z, 04:47:55Z, 04:50:38Z), `bg=true`, elapsed 1.5~2.5초, 확인 없이 실행. 잠금 상태 수신 건(04:50:38Z, 사용자 보고)도 본문 도착 — 단 trace `locked=false`(`isProtectedDataAvailable` 기준이라 잠금 직후 유예 구간으로 보인다). 이후 05:02:04Z 수신은 `locked=true`·본문 38자·발신자로 **잠금 수집 확정**. 같은 방식의 공개 사례: zhgchg.li(iOS 단축어 SMS 전달), dev.to/noha1337(SMS → 웹훅).
- **제약**: 메시지 자동화는 조건 필수 → "메시지 → 다음을 포함"에 공백 한 칸으로 전체 수신, "실행 묻지 않기" 선택 가능. 자동화는 파일·링크로 배포할 수 없어 사용자가 기기에서 직접 만든다(공유 단축어 파일은 보조). iOS 27 단축어 UI는 iOS 26 문서와 다르다(PoC-1 상세).
- 판정: 판정 기준 "잠금 상태에서 큐에 저장됨"은 `locked=true` 수신(05:02:04Z)으로 **통과**. "첫 해제 전 수신분 처리 방식 기록"(BFU)은 아직 없어 보완 항목으로 남긴다. OTP·연락처 번호 폐기도 미실측.

이전(09-24): 인텐트 호출 경로는 PoC-1과 같이 시뮬레이터에서 확인. 남은 실측: 실기기 메시지 자동화, 잠금 15초 후 수신 `locked=true`, BFU 수신은 `bfu.log`(보호 등급 none, 내용 없이 길이만)로 판독, OTP 문자 `discarded:otp`, 연락처 번호 문자 `discarded:contact`. 절차 `poc-2-message-trigger.md`

### PoC-3 Foundation Models 한국어 분류 200건 정확도·p95 (갱신 2026-09-24)

재실측 09-24: 호스트 Mac이 `appleIntelligenceNotEnabled`(macOS 26.5에서 직접 호출로 확인)라 시뮬레이터 `availability()=available`은 오표시, `respond`는 에셋 에러(`FM error other`). 수정본(호출마다 새 세션, enum 스키마, 제목 입력, 에러→폴백, 제시간 타임아웃)은 단위 테스트 통과, 앱 프로세스 `CaptureIntent.perform()`에서 Coupang→`queued:rules`, KakaoTalk→`discarded:fm-error` 확인. 정확도·p95·메모리 수치 없음. 남은 실측: Mac Apple Intelligence 켜기(사용자) 또는 실기기 벤치마크, 메모리, 백그라운드 인텐트 `rateLimited` 빈도. 절차 `poc-3-fm-classifier.md`

### PoC-4 Edge Function → APNs HTTP/2 (갱신 2026-09-28)

**실기기 세션 1 (2026-09-28)**: 기기 등록 `poc4.device_registered` 15:04:21Z(09-27), `devices` 행 `apns_env=production`·build 0.1.1(`202609272353`). 배포 `apns-send` `{device_id,user_id,count:1}` → APNs **200 production 634ms**, 잠금 화면에 "PoC-4 / 합성 알림 1/1" 도착(사용자 확인). 판정 기준(100회·동시 10, 성공률 ≥ 99%, h2 오류 0)은 아직 1회분이라 **부분** 유지 — 세션 중 APNs 키가 출력에 두 번 노출돼 키 교체 후 100회 동시 10을 잰다.

09-26~27 가짜 기기 토큰으로 sandbox 발송: 로컬 deno 400 `BadDeviceToken`·`apns-id` 있음(1.1초 콜드/0.45초 웜), **배포 Edge `apns-send`(서울)** 400 `BadDeviceToken`·`apns-id` 있음(APNs 호출 0.7~0.87초), 동시 1로 100회 100/100 오류 0(p50 419ms). **h2 동작**: APNs는 HTTP/1.1을 연결 단계에서 거부(curl 대조군 000)하므로 Deno fetch가 h2로 협상한 것이다. 동시 10에서는 fetch 오류 10~18%(APNs가 BadDeviceToken 뒤 `GOAWAY`로 연결을 닫아 떠 있던 스트림 실패, `dispatch task is gone` 1~2건, 로컬 Deno도 같음) — 가짜 토큰 탓으로 보이며 판정 기준(동시 10, 성공 ≥99%, h2 오류 0)은 실기기 토큰으로 재측정. 첫 배포의 429 `TooManyProviderTokenUpdates`(98/100)는 JWT 동시 생성·isolate별 iat 때문이라 in-flight 공유 + 30분 경계 iat로 고쳐 0건. 다음 조치: 실기기 토큰 등록 → 1회 수신 → 100회 동시 10(절차 `poc-4-apns.md`). 연결 오류가 남으면 1회 재시도, 그래도 남으면 Cloudflare Worker 릴레이

**기기별 환경(09-27, `40d83cc`)**: TestFlight·App Store 빌드는 production 토큰이라 `devices(apns_env)`(`0011_devices.sql`)와 `ingest/device` 등록 경로를 두고, 발송은 기기 환경을 쓰며 `BadDeviceToken`/`BadEnvironmentToken`이면 반대 환경으로 1회 재시도한다. 가짜 토큰 실측에서 production 호스트가 기존 키를 `403 BadEnvironmentKeyInToken`으로 거부해(Sandbox 전용 키) **APNs 키를 Sandbox & Production 키로 교체**했다(2026-09-27. 세션 출력 노출 뒤 13:15에 한 번 더 교체 — 스펙 §16 "0단계 운영 기록"). Edge secrets `APNS_KEY_ID`·`APNS_P8`이 현재 `.p8`과 같은지 해시로 대조했다(값 출력 없음). 교체 키 확인(가짜 토큰, 배포 `apns-send`): production·sandbox 모두 `400 BadDeviceToken`(403 `BadEnvironmentKeyInToken` 없음) → 키가 두 환경에서 인증된다. 실제 수신은 실기기 토큰이 있어야 하고, 앱의 토큰 등록 코드는 미구현(계획서 Task 9 Step 4).

### PoC-5 잠금화면 알림 액션 → 백그라운드 EventKit 멱등 쓰기 (갱신 2026-09-24)

재실측 09-24(XCUITest, 실제 배너·액션 탭, 로컬 알림): 백그라운드 `ADD ok … bg=true auth=3`(14:29:48Z), 같은 알림 재탭 `dup skip`(14:30:08Z), **앱 종료 후 액션 콜드 스타트** `bg=true`(14:31:00Z), 동시 두 번 탭 이벤트 +1만(14:32:23Z). 남은 실측: **잠금 화면**에서 `.authenticationRequired`의 Face ID/암호 요구와 쓰기 성공(시뮬레이터는 암호 없음), 보고 실패 후 재탭은 서버 연동 후. 절차 `poc-5-notification-eventkit.md`

### PoC-6 Gmail watch → Pub/Sub → history 동기화 (갱신 2026-09-27)

**실계정 실측 09-27(시뮬레이터 GoogleSignIn 8.0.0, 테스트 사용자 Gmail)**: `gmail-connect` 200·`refresh_token_stored=true`·`watch_expires_at` +7일(03:01Z), `connections` 1행 active·`expires_at` +7일·vault `gmail_rt:` 1개, `sync_states` 1행. 백필 85 ID → `items` GMAIL 76행(나머지는 규칙 폐기로 추정), `gmail-fetch` 1잡 67초, 429 없음, `content_enc` null 0. **웹훅 지연** `[PoC-6]` 메일 1통: Gmail 수신 03:06:50Z → Pub/Sub push → `gmail-sync` 잡 생성 03:06:57.8Z(**약 8초**). 그러나 sync는 백필이 만든 `process` 잡 37건 뒤 FIFO로 11분 대기(03:18 실행) — **백필이 증분 동기화를 굶긴다**(우선순위·레인 분리 필요). 이때 넣은 fetch 잡은 서버 pane의 호스팅 DB 테스트(`jobs.test.ts`의 `jobs` 전체 삭제, 03:18~03:19)로 지워진 것으로 보이고 커서는 이미 이동 → 메일 누락. **404 재동기화로 복구**: `cursor='1'` + `gmail_enqueue_for_account` → sync `resync` → fetch 4 ID → 새 행 1(`[PoC-6]` 제목 일치, 03:23:01Z), GMAIL 77행·`idempotency_key` 중복 0. 앱 쪽 이슈: 세분화 동의에서 Gmail 체크 누락 시 교환 후 403 → 서버 500(서버 `87673fe`에서 수정), 앱은 이제 권한 없으면 코드를 보내지 않음. 남은 실측: 웹훅 지연 5회 평균(테스트 DB 초기화 없이), watch 갱신, 6일/8일 재인증, 규칙 필터 OTP·카드 메일(절차 `poc-6-gmail.md`)

### PoC-7 한국어 하이브리드 검색 Top-5 정확도 (갱신 2026-09-27)

09-27 합성 코퍼스 500·질문 50(무근거 10, 날짜 필터 10), 전용 테스트 사용자, 실제 사용자 데이터 임베딩 없음. **Top-5**: 하이브리드 + `text-embedding-3-large`(512차원) **38/40(95%)**(3회 37~38), small 31~33/40, 키워드 전용 32~34/40(원안 키워드 경로는 2/40이라 `0009`로 교체). 날짜 필터 오판 0. p95 하이브리드 검색 70~111ms(질의 임베딩 포함 약 280ms). **무근거 거절**(답변 단계 `gpt-6-sol` Structured Outputs + 서버 인용 대조): **10/10**(검색 단계 임계로는 최대 7/10이었음). **인용 검증**: 답한 36/36이 정답 문서 인용, 인용 정밀도 39/39, 검색 결과 밖 id 0. 정답 질문 거절 4/40(검색 누락 2, 검색됐으나 거절 2: "다이슨 드라이기"↔에어랩, "레이저 토닝 몇 회차 남았지"). 답변 p95 3.5초, 답변 평가 비용 약 $0.10. 결정: 임베딩 `text-embedding-3-large`. **실제 데이터 임베딩 활성화 조건 충족**(약관 보류는 2026-09-26 해제, 스펙 §16). 한계: 무근거 10문항, 합성 코퍼스(`poc-7-search.md`)

### PoC-8 이미지·PDF → OCR/추출 → 일정 (갱신 2026-09-27)

**서버 부분(Task 12, 09-27, 통과)**: 합성 청첩장·안내 7종(이미지 5: 연도 없음 2·모바일 스크린샷 2·음력 1, PDF 2: 텍스트·스캔 2쪽)을 배포 `vision-extract`(`gpt-6-luna`, Structured Outputs strict, `store: false`)로 7×3회. 제목·시작·장소 **vision+OCR 21/21**, OCR만 21/21, vision만 19/21(스캔 PDF 제목에 혼주 이름). `uncertain` 적중 21/21·오탐 0(연도·음력은 스키마 플래그로 서버가 결정, 연도는 서버가 가장 가까운 미래 해로 재계산). 음력 1종은 양력 환산이 하루 틀려(10-25) 날짜를 확정하지 않고 `date`로 REVIEW. 지연 vision+OCR p50 1.95s·p95 2.53s(모델 1.42/2.06s), OCR만 1.48/1.81s. 건당 입력 3.8k·출력 82 토큰 $0.00042(월 100건 ≈ $0.04). 배포 worker `extract` 잡 7/7 `proposed`·facts/proposals 7건·`usage_counters` 반영, `process` 3/3 `extracted`, 월 100건 상한→OCR 폴백·멱등은 호스팅 DB 테스트로 고정. 기기 부분(시뮬레이터, 09-24): 사진 앱 → 공유 시트 → 확장 실행, `ShareExtension file … ocrLen=43`·큐 `SHARE` 행. 남은 실측: 실기기 공유 시트 → 큐·업로드(App Group 서명), 오프라인 후 복구 유실 0(대기 목록). 절차 `poc-8-9-share-upload.md`

### PoC-9 앱 종료 후 background URLSession 업로드 완료 (갱신 2026-09-28)

**실기기 세션 1 (2026-09-28)**: PoC 계정 로그인 직후 큐 7건 일괄 업로드(15:03:12Z, `poc9.upload_done` ×7), 이후 수신 건은 개별 업로드. 잠금 중 수신분은 잠금 해제·앱 열기 후 업로드(04:50:38Z 인텐트 실행 → 04:51:23Z 서버 수신). 서버 `process` 잡 최근 항목 모두 `done`(`extracted`). 통과 유지. 파일(사진·PDF) 업로드는 서버에 `PUT upload/<id>`가 없어 아직 못 잰다.

호스트 `ps aux`로 앱 프로세스 완전 종료 확인(14:07:27.946) 후 3.68초 뒤 목 서버에 정확한 바이트 수로 도착(14:07:31.628) 실측. 실기기 회귀 확인은 대기 목록. 절차 `poc-8-9-share-upload.md`

### PoC-10 jobs 큐 lease/재시도/dead 처리 (갱신 2026-09-26)

호스팅 프로젝트 `assistant-poc`(서울) 실측. 같은 lease_key 2건 동시 클레임 시 1건만(deno 테스트), pg_cron 매분 → worker로 `unknown` 잡 5회 후 `dead`·attempts=5, 변조 암호문 잡 5회 후 `dead`(last_error=`decrypt failed`, 본문 없음). **재실측 09-26(임대 180초 + 30초 하트비트, `6ca66d8`)**: `sleep` 90초 잡 클레임 후 65초에 두 번째 워커 호출 → `claimed: 0`, 65초 시점 임대 잔여 177초(하트비트 약 32·62초에 연장), 최종 `done` attempts=1. 이전 임대 60초에서는 같은 조건에서 재클레임·중복 실행(attempts=2)이었다. 남은 확인(판정 기준 밖): Edge wall-clock 150초를 넘겨 강제 종료된 잡의 임대 만료 후 재클레임, 24시간 일시정지 없음(시나리오 7). 상세는 아래 "PoC-10 실측"

## 실기기 세션 1 (2026-09-28 새벽, iOS 27, TestFlight 0.1.1 `202609272353`)

판정 변경: PoC-1 미검증→**통과**(Slack 알림 본문·제목·앱 이름·잠금·백그라운드), PoC-2 미검증→**통과**(`locked=true` 확정), PoC-4 부분 유지(production 1회 수신), PoC-9 통과 유지(실기기 텍스트 업로드 확인). PoC-3·5·8은 이번 세션에서 재지 못했다.

발견된 결함·할 일:
1. Release 빌드의 서버 URL 기본값이 `localhost`였다 → 0.1.1에서 수정.
2. 실기기에 로그인 수단이 없었다 → 설정 화면에 PoC 계정 로그인 추가.
3. 공유 파일 `PUT upload/<id>` 엔드포인트가 Supabase에 없다 → PoC-8·9 파일 경로 실측 전에 서버 작업 필요.
4. APNs 키가 세션 출력에 두 번 노출 → 교체 예정(스펙 §16 운영 기록). PoC-4 동시 10 측정은 교체 후.
5. trace `locked` 판정(`isProtectedDataAvailable`)이 잠금 직후 유예 구간에서 `false`로 나온다(04:50:38Z). 잠금이 이어진 뒤 수신분은 `true`(05:02:04Z 문자, 05:08Z 알림)라 판정에는 영향 없음 — 유예 구간 기록 방식만 재검토.
6. 알림 자동화에서 제목·앱 이름은 액션 파라미터에 변수를 연결해야 온다(연결 후 `title=11`·`app=true` 확인) → 가이드에 세 칸 모두 연결하도록 명시.

## PoC-10 실측 (2026-09-26, Task 8)

- 환경: Supabase 호스팅 `dbbdaawotqrcizlcpsjk`(ap-northeast-2), 마이그레이션 `0001_jobs`·`0002_cron`·`0003_items_keys`, Edge `ingest`·`worker`(JWT 검증 유지). 키는 새 형식(`sb_publishable_`/`sb_secret_`)으로 supabase-js 2.x·Edge 게이트웨이 모두 동작.
- deno 테스트 39개 통과: jobs 6(호스팅 DB), heartbeat 3, crypto 5, rules 18(기기 `RuleFilter` 회귀 케이스 포함), ingest 7. 테스트 중 cron 비활성 → 종료 후 재활성.
- 시나리오 1 noop 20개(+unknown 1개 동시): cron 틱당 5건(`p_limit` 5) 처리라 20개 완료까지 **270초(5틱)**. 계획서 기대 "2분 후 전부 done"은 `p_limit` 5와 맞지 않는다.
- 시나리오 2 lease 만료(1차, 임대 60초): 65초 시점 임대 만료 → 두 번째 호출이 재클레임해 동시에 두 번 실행, 두 호출 모두 약 90.4초 뒤 200, 최종 `done` attempts=2.
- 시나리오 2 재실측(임대 180초 + 하트비트, `0004_lease_heartbeat`·`worker/heartbeat.ts`): 10초 시점 임대 잔여 172초, 65초 시점 잔여 177초(`updated_at` 62초 = 하트비트 연장), 두 번째 호출 264ms에 `claimed: 0`, 첫 호출 92초에 `done`(attempts=1), 완료 후 호출 `claimed: 0`. deno 테스트로 고정: 기본 임대 180초·만료 전 재클레임 0건, `heartbeat_job`이 만료된 임대를 연장해 재클레임 막음·완료 잡은 false, `withHeartbeat` 주기 호출·종료 후 정지.
- 시나리오 3 unknown: 첫 클레임 후 5틱째 `dead`, attempts=5, last_error=`unknown kind unknown`.
- 시나리오 4 복호화 비용(5KB 합성 50건, 워커 수동 호출 11회): `decrypt_ms` p50 **0.7ms**, p95 **56ms**(격리 인스턴스별 첫 호출의 `get_wrapped_key` 왕복·unwrap 포함), 최대 77ms. 잡당 전체 p50 104ms·p95 169ms(대부분 RPC I/O). 5건 배치 함수 시간 p50 646ms·최대 700ms(호출 왕복 p50 840ms). CPU 사용은 복호화 1ms 미만/건이라 CPU 2초 한도는 배치 크기를 제약하지 않는다. `p_limit` 5 유지(배치 1초 미만), 늘릴 때는 cron `timeout_milliseconds` 5초와 wall-clock을 기준으로 정한다. `audit_log` decrypt 54행(정상 49 + 변조 항목 재시도 5, 항목 50개 전부).
- 시나리오 5 변조 검출: `content_enc` 마지막 바이트 XOR 1 → 5회 후 `dead`, last_error=`decrypt failed`(WebCrypto 메시지·본문 없음). 함수 로그는 코드상 `item_id`·`decrypt_ms`·`chars`만 남긴다(대시보드 로그 직접 열람은 안 함).
- 시나리오 6 ingest 실호출(PoC 사용자 JWT): 카드 문자 **202**, OTP **204**, `(광고)` **204**, 토큰 없음 401, publishable 키를 Bearer로 보내면 401, 같은 id 재전송 202 `duplicate:true`. `items` MESSAGES 1행(`content_enc` 72바이트, 평문 본문 컬럼 없음), process 잡 생성. 왕복: 콜드 약 2.4~2.7초, 웜 10건 p50 **347ms**·p95 376ms. ingest 1건 → cron → worker 복호화 → `done`까지 10초 안(해당 항목 decrypt 감사 1행).
- 보안 발견: Edge 게이트웨이 JWT 검증은 **publishable 키로도 `worker` 호출을 통과**시킨다(원안의 legacy anon JWT도 같음). `worker`는 service role로 돌므로 함수 안에서 Bearer가 런타임 주입 secret 키(`SUPABASE_SERVICE_ROLE_KEY`·`SUPABASE_SECRET_KEYS`)와 같을 때만 처리하고 아니면 403(실측: secret 200, publishable 403).
- 운영 메모: `0002_cron`은 vault(`worker_url`·`service_role_key`) 등록 전부터 매분 실행돼 `net.http_post` url null 오류를 냈다 → `0005_cron_vault_guard`로 vault 두 값이 있을 때만 호출(교체 후 cron 틱 `succeeded`·HTTP 200, noop 40초 안에 `done`; 값이 없을 때 조건 0행 확인). vault 등록은 `scripts/vault-setup.ts`(값 출력 없음). 테스트 전체 39개 통과. 24시간 활동 유지 확인은 남음.

## 참고 (Opus 재검증 반영, 2026-09-24)

- **연락처 규칙 배선 (2026-09-25)**: 앱이 연락처 이름을 App Group `contacts.json`에 캐시하고(권한 미허용이면 빈 집합, `contacts status=<상태> names=0`), 인텐트는 캐시만 읽어 `sender`·`title`을 비교한다(공백 전부 제거, 끝 "님"/"씨" 제거). 계획서 Task 4 Step 6. 실기기 카톡·문자 확인은 PoC-1 시나리오 8·PoC-2 시나리오 5.
  - 시뮬레이터 실측 (2026-09-25, `affe7e9`, 합성 연락처 "합성연락처" 1건을 `simctl addmedia`로 추가, 인텐트 디버그 훅 `--poc-debug-capture-intent`): 권한 revoke 상태 → `contacts status=denied names=0`, 제목 "합성연락처님"이 연락처 규칙에 걸리지 않고 FM 폴백(`discarded:fm-error`)으로 진행(11:59:33Z). 권한 grant 후 → `contacts status=authorized names=8`(기본 샘플 포함), 제목 "합성연락처님" `CaptureIntent discarded:contact 1ms`(11:59:47Z), 발신자 " 합성 연락처 씨" `discarded:contact`(11:59:56Z), 대조군 제목 "박지훈"은 연락처 규칙 비해당(`discarded:fm-error`, 12:00:04Z). 알림 자동화 경로가 아니라 앱 프로세스 인텐트 호출이므로 판정은 **부분**, 실기기 확인은 위 시나리오.
- **업로드 서버 설정 유지 (2026-09-25, `affe7e9`)**: XCUITest `testIngestURLPersistsAcrossRelaunch`로 앱 입력란에 `http://192.168.77.7:9787` 저장 → 앱 종료 → **홈 화면 아이콘으로 재실행**(환경변수 없음) → 화면·로그 `ingest base=http://192.168.77.7:9787` 유지(11:59:14Z). 이어서 `SIMCTL_CHILD_INGEST_URL=http://10.9.9.9:8787`로 실행해도 저장값 유지(11:59:28Z) — 스킴 환경변수는 저장값이 없을 때 초기값으로만 쓰인다. 공유 확장 변경 후 사진 공유 시트 XCUITest 재실행: `ShareExtension file queued id=… type=image ocrLen=43`(12:00:41Z).
- **App Group 테스트**: `AppGroupTests`는 시뮬레이터가 App Group 프로비저닝을 강제하지 않아 통과한다. 서명·포털 등록은 실기기 설치 때 확인한다.
- **시뮬레이터 UI 실측 도구**: `scripts/sim.sh uitest [EruriPoCUITests/SimRemeasureUITests/<테스트>]`, 로그는 `scripts/sim.sh log [n]`.
- **FM 폴백**: FM 불가·타임아웃·에러 모두 같은 폴백(카톡·인스타 폐기, 그 외 `device_filter="rules"`로 적재, `kind=unknown` 로그)이다. `CaptureItem.deviceFilter`에 저장된다.

