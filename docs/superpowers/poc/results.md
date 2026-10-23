# PoC 판정표

상태 값: **통과** = 스펙 §14 판정 기준을 실측으로 충족 · **부분** = 코드 경로만 확인(디버그 훅·시뮬레이터·가짜 토큰 대체) 또는 판정 기준의 일부만 실측 · **실패(대안 채택)** = 기준 미달, 대안을 스펙에 반영 · **1단계 흡수** = 남은 실측이 1단계 태스크의 실측 게이트가 됨(그 태스크는 이 실측을 통과해야 완료) · **2단계 이월** = 기능 자체가 2단계 이후라 그 단계 태스크 게이트로 넘김 · **미검증** = 판정 기준 관련 실측 없음. 0단계는 모든 PoC가 통과 · 실패(대안 채택) · 흡수(이월 포함) 중 하나로 마감돼야 끝난다. '부분'·'미검증'은 마감 상태가 아니다(AGENTS.md §5-8, 2026-09-30).

이 표는 스펙 §14 "판정 현황"과 **같은 내용**이다(표를 고칠 때 둘 다 고친다). 행이 길어지는 측정값·시각·로그는 아래 "PoC별 상세"에 둔다.

## 판정 (2026-09-30)

| PoC | 검증 대상 | 태스크 | 상태 | 핵심 근거 | 남은 실측 | 근거 커밋 | 갱신일 |
|---|---|---|---|---|---|---|---|
| PoC-1 | 단축어 Notification 트리거 → CaptureIntent 자동 실행 | 4 | 통과 | 실기기(09-28, iOS 27, TestFlight 0.1.1): "새로운 빈 자동화"에 알림 트리거(카카오톡+Slack 다중 선택, "모든 앱"은 불가)·"비서에 저장" 직접 편집(본문=단축어 입력→내용) → Slack 알림 본문 183자·155자, `locked=true`·`bg=true`, **배너 탭 없이 실행**. 1건은 `len=0`. 제목·앱 이름 변수 연결 후 05:24:48Z `len=147`·`title=11`·`app=true`·`locked=true` — **본문·제목·앱 이름 전부 전달** | 카카오톡 알림 실측, `len=0` 1건 원인, 미리보기 꺼짐·묶음 알림 기록, 연락처 발신 `discarded:contact` | `964cfea` `affe7e9` `47e9435` | 2026-09-28 |
| PoC-2 | 단축어 Message 트리거 → CaptureIntent 자동 실행 | 4 | 통과 | 실기기(iOS 27, TestFlight 0.1.1): "새로운 빈 자동화" 안에서 "비서에 저장" 직접 편집(본문=단축어 입력→내용) → 본문 30/15/15자·발신자 도착, `bg=true`, 1.5~2.5초, 무확인 실행. **잠금 수신 확정**: 05:02:04Z `locked=true` 본문 38자·발신자. 기존 단축어 선택 방식은 발신자만·본문 0자(6건). **제품 경로(09-28 사용자 최종)**: 알림 자동화 1개(메시지 앱 포함)로 수집, 메시지 트리거는 선택 사항. 06:00Z 메시지 트리거로 문자 3건(연락처 있는 지인 발신) 모두 `src=MESSAGE, app=SMS`·발신자 번호·본문 도착(통과 근거 유지). 알림 경로(05:50:19Z)는 `app=메시지`·발신자 표시 이름, 알림이 안 뜨는 문자(조용히 한 대화·알 수 없는 발신자·집중 모드)는 누락 감수 | 판정 기준 중 BFU(재부팅 후 첫 해제 전) 수신 처리 기록, OTP `discarded:otp`, 연락처 번호 `discarded:contact` | `ca859a4` `47e9435` | 2026-09-28 |
| PoC-3 | Foundation Models 한국어 분류 200건 정확도·p95 | 5 | 실패(대안 채택) | 폴백 경로(Coupang→`queued:rules`, KakaoTalk→`discarded:fm-error`)·새 세션·enum 스키마·타임아웃 단위 테스트. 호스트 Mac Apple Intelligence 꺼짐으로 수치 없음 **실기기(09-29, iOS 27, 0.2.0, Slack 웹훅 합성 문구 10개)**: Apple Intelligence 분류기 동작 확인. 택배·병원·카드·컨퍼런스·공과금 5건 `queued:rules`(p50 3.13s, 최대 3.22s), 광고 `discarded:fm:promo`(2.04s), 인증번호 `discarded:otp`(정규식 6ms), 경계 문구(목요일 판교 약속) `queued:rules`. 잡담 2건(ㅋㅋㅋ/밥 먹었어?)은 `queued:rules` 로 통과시켜 오분류 → 서버 규칙이 걸러야 함. 별도 관찰: 4자 알림 `discarded:fm-timeout`, 지인 문자 `discarded:fm:personal`. 기기 정확도 8/10(목표 90% 미달, p95·메모리 미측정), 잠금·백그라운드에서 실행. **서버 게이트 후보 Jev(09-29, 합성 60건)**: 게이트 60/60(같은 10문구 10/10, 잡담 2건 폐기), p50 211ms·p95 269ms, 60건 $0.0019, 임계 0.8 제안·조건부 채택(벤더 결정·보관 정책·실데이터 재측정 대기) → `reports/2026-09-29-jev-classification-eval.html`. **서버 분류 게이트(Jev, 운영 요청 재현 09-29)**: gate 60/60, 5라벨 60/60, p50/p95 218/302ms, 건당 $0.000032, t=0.8 유실 0·누수 1(p02 잡담 conf 0.64 → 추출로); 메신저 제목 미전송(최종 리뷰 I1) 재측정 09-29: gate 60/60, 5라벨 60/60, p50/p95 216/314ms, t=0.8 유실 0·누수 0, 운영 적용 예(`CLASSIFY_PROVIDER=jev`·`CLASSIFY_THRESHOLD=0.8`, 스모크 잡담 `discarded:server:personal`·일정 `extracted`) → `poc/server/eval/jev-results-prod.json` **FM 콜드 타임아웃 상수(실기기 0.2.1/0.2.2, 09-29 `poc1.intent_fired` 13건)**: 11건이 3.07~3.22s로 3초 타임아웃(잠금 무관), 웜 2건만 1.7~1.8s `queued:fm`; 카카오톡 2건 `discarded:fm-timeout` 유실 → 0.2.3(빌드 202609291909)부터 타임아웃은 출처 무관 `queued:rules`(서버 Jev 게이트가 판정), 불가·에러는 채팅 앱 폐기 유지. 0.2.3 빌드 202609291913부터 생성 에러(`rateLimited` 등)도 출처 무관 `queued:rules`, 불가(`fm-unavailable`)만 채팅 앱 폐기 | — (마감 2026-09-30: 기기 기준 p95 < 3초·정확도 90% 미달 확정 — 콜드 3.07~3.22초, 8/10 → 대안 채택, 스펙 §14 PoC-3 행. FM 200건 벤치마크·메모리·`rateLimited` 빈도는 게이트로 더 재지 않는다. 서버 Jev 실데이터 200건은 1단계 M1-④ 분류 태스크 게이트) | `b1f3248` `0d2a293` `affe7e9` `94c6aa5` `5214fec` `661bfdd` `f79ed3f` | 2026-09-30 |
| PoC-4 | Edge Function → APNs HTTP/2 | 9 | 통과 | h2 동작(가짜 토큰 sandbox `400 BadDeviceToken`+`apns-id`, HTTP/1.1 대조군 거부), Edge 서울 100회 동시 1 100/100 p50 419ms, JWT 429 수정. **실기기(09-28)**: 앱 토큰 등록(`devices` production, 0.1.1) → `apns-send` count 1 → APNs 200 production 634ms, 잠금 화면 수신 확인. **0.2.1/0.2.2 자동 재등록(build 갱신) 확인(09-29)**: 설치 후 앱 열기만으로 `devices.build` 갱신(08:51:50Z·09:25:01Z, "등록" 버튼 안 누름) **동시 10 실기기(2026-09-30 00:29 KST, production 토큰, 배포 Edge 서울, 키 Q8469KDH4D, silent priority 5)**: 100회 동시 10 × 2 → 100/100·100/100(`{"200":100}`), h2Errors 0·0, fetch 오류·429 0, p50 367/291ms·p95 755/594ms. 가짜 토큰 때의 `GOAWAY`·`dispatch task is gone`은 재현 안 됨 → 연결 오류 재시도·Cloudflare 릴레이 불필요 | — (alert(priority 10)로 재확인은 선택. 전송 경로는 같고 헤더·payload만 다름) | `e2552b5` `40d83cc` `b84bd60` | 2026-09-30 |
| PoC-5 | 잠금화면 알림 액션 → 백그라운드 EventKit 멱등 쓰기 | 6 | 통과 | XCUITest(실제 배너·액션 탭, 로컬 알림): 백그라운드 쓰기 `bg=true`, 재탭 `dup skip`, 앱 종료 후 콜드 스타트, 동시 두 번 탭 이벤트 +1. **실기기(09-29, iOS 27, 서버 제안 푸시)**: 0.2.1 제안 2건 잠금 화면 "캘린더에 추가" → 캘린더 각 1건·`result=ok bg=true dup=false auth=3`, 단 TestFlight 충돌 안내 2회(완료 핸들러 메인 스레드 밖 호출) → 0.2.2 수정 후 09:27:19Z `ok bg=true dup=false auth=3`·캘린더 1건·**충돌 안내 없음**. **제품 0.3.0 회귀 통과(2026-09-30)**: M1-②d 게이트 B·D(3G 포함) | — (실기기 재탭 `dup` 은 안 함 — 시뮬레이터 XCUITest 근거로 갈음. 보고 실패 후 재탭은 서버 연동 후) | `0e89279` `0d2a293` `3879270` | 2026-09-29 |
| PoC-6 | Gmail watch → Pub/Sub → history 동기화 | 10 | 1단계 흡수(M1-③) | 실계정: 연결·watch +7일, 백필 85 ID → 76행·429 없음·`content_enc` null 0, 웹훅 약 8초(1회), 404 재동기화로 누락 1건 복구·중복 0 | M1-③b 통과(2026-10-02): 백필(N=96, 5.6분) 중 웹훅→sync 평균 0.8초(유효 표본 7), watch 수동·cron, OTP 폐기·카드 제목 마스킹, 90일 누락 0(ID 대조). M1-③c 통과(2026-10-08): +6일 expiring 푸시 도착, 재연결(R 10-08T10:01Z) 재적재 N'=116 missing 0·재처리 0·중복 0·dead 0·watch R+7일. +8일 invalid_grant→reauth_required 경로는 사용자 선행 재연결로 미관찰 — 다음 주기(새 T0+7일, 또는 0.14.0 gmail.modify 재동의 뒤 새 T0)에 수동 관찰, 코드 경로는 ③b0/③b1 단위 테스트 | `ea6c762` `87673fe` `cdd7c79` | 2026-10-08 |
| PoC-7 | 한국어 하이브리드 검색 Top-5 정확도 | 11 | 통과 | 합성 500건·질문 50: 하이브리드 + `text-embedding-3-large`(512) Top-5 38/40(95%), 무근거 거절 10/10, 인용 36/36·정밀도 39/39, 날짜 필터 오판 0, 검색 p95 70~111ms | — (1b(M2)에서 실데이터 검색 평가, 스펙 §9 절차) | `4c00aa7` `cf786bb` `9e8ab9f` | 2026-09-27 |
| PoC-8 | 이미지·PDF → OCR/추출 → 일정 | 7, 12 | 2단계 이월(파일) · 1단계 흡수(App Group 서명) | 서버: 합성 7종(이미지 5·PDF 2) vision+OCR 21/21, OCR만 21/21, `uncertain` 21/21, p50 1.95s·p95 2.53s, 건당 $0.00042, worker extract 7/7. 기기(시뮬레이터): 사진 앱 공유 시트 → 확장 `ocrLen=43`·큐 `SHARE` 행 | 파일 경로(실기기 공유 시트 → 큐·업로드, `PUT upload/<id>`, 오프라인 후 복구 유실 0)는 2단계 이미지·PDF 태스크 게이트로 이월. App Group 서명(새 번들 `group.com.picpal.eruri`)은 1단계 M1-② 앱 태스크 게이트의 "Share 텍스트 실기기 1건" → **M1-②d 게이트 C 통과(2026-09-30, 0.3.0)** | `f28814d` `0d2a293` `affe7e9` `7f533f1` | 2026-09-30 |
| PoC-9 | 앱 종료 후 background URLSession 업로드 완료 | 7 | 통과 | 앱 프로세스 종료를 `ps`로 확인한 뒤 3.68초 후 목 서버에 정확한 바이트 수로 도착. 실기기(09-28): 로그인 직후 큐 7건 일괄 업로드(`poc9.upload_done` ×7), 잠금 중 수신분은 해제·앱 열기 후 업로드(45초 뒤), 서버 `process` 잡 전부 `done`. **0.2.0 실기기(09-29)**: 잠금 중 Slack 알림 → `path=intent_direct` 0.86초 즉시 업로드(앱 미실행), 비행기 모드 큐 적재 → 무음 푸시 → 33초 뒤 `path=silent_push`(앱 미실행), 앱이 떠 있으면 `path=foreground` 16초. **0.2.1 잠금 판정 L1~L4(09-29, 상세 표)**: L1 `unlocked/readable`, L2·L4 `locked/denied`·`locked_app=true`(UIKit 값 일치), L3 잠금 직후는 같은 초에 unlocked→locked(유예 경계, 한계), `probe=error` 0 → 후속 패치 불필요. **trace 중복**: 0.2.1 설치 뒤 `ingest` trace 17줄 중 16줄 `duplicates=0`, 09:17:47Z 1줄 `count=2, duplicates=2`(0.2.1 PoC-5 충돌 구간), 0.2.2 이후 0 | — (실기기 회귀: 스와이프 종료·비행기 모드, 파일 업로드는 서버 `upload/<id>` 엔드포인트 구현 후) | `f28814d` | 2026-09-29 |
| PoC-10 | jobs 큐 lease/재시도/dead 처리 | 8 | 통과 | 같은 lease_key 동시 클레임 1건, 5회 실패 후 `dead`, 임대 180초+하트비트로 90초 잡 재클레임 0·attempts 1, 복호화 p50 0.7ms·p95 56ms | — (판정 기준 밖: 150초 강제 종료 잡 재클레임, 24시간 활동 유지) | `2d9a45a` `6ca66d8` | 2026-09-26 |

**집계(2026-09-30): 통과 7(PoC-1·2·4·5·7·9·10) · 실패(대안 채택) 1(PoC-3) · 1단계 흡수 2(PoC-6 → M1-③, PoC-8 App Group 서명 → M1-② · 파일 경로는 2단계 이월) · 부분 0 · 미검증 0.** 전 PoC가 마감돼 0단계가 끝났다. PoC-1·2·9 실기기 보완 항목은 판정 기준 밖의 회귀라 1단계 M1 게이트 실기기 세션에서 함께 본다.

PoC 프로젝트 은퇴(스펙 §11, M1 게이트 통과 직후 — Gmail revoke → PoC 사용자 삭제 → 일시정지): 미실시. 실시하면 일자를 여기에 적는다.

## 실기기·장기 실측 대기

한 번의 실기기 세션(절차 `docs/superpowers/reports/2026-09-24-device-session.html`)과 달력에 걸친 Gmail 관찰로 나눈다. 관찰값은 `poc_traces`로 올라오므로(절차 `poc-traces.md`) Mac에서 `scripts/sql.ts`로 조회해 판정한다.

| PoC | 남은 실측 | 필요한 것 | 판정 근거 | 절차 |
|---|---|---|---|---|
| PoC-1 | **보완**: 카카오톡 알림, `len=0` 원인, 미리보기 꺼짐·묶음, 연락처 발신 폐기(Slack 본문·잠금·백그라운드는 09-28 통과) | 실기기, 두 번째 카톡 계정, 연락처 1건 | `poc1.intent_fired`의 `app_set`·`text_len`·`locked`·`result` | `poc-1-notification-trigger.md` |
| PoC-2 | **보완**: BFU 수신(재부팅 후 첫 해제 전) 처리 기록, OTP·연락처 번호 폐기 | 실기기, 테스트 발신 번호, 재부팅 | `poc2.intent_fired`, BFU는 `bfu.log` | `poc-2-message-trigger.md` |
| PoC-3 | **마감 — 실패(대안 채택), 2026-09-30. 아래는 당초 계획이며 더 재지 않는다**: FM 200건 p95·통과율·폐기율, 메모리, 백그라운드 10~20회 `rateLimited` | 실기기 + Xcode ⌘U(케이블·개발 설치), Apple Intelligence 모델 다운로드 완료 | `FM_BENCH`/`fm_bench.txt`, `poc3.bench_done`, 백그라운드는 `poc1.intent_fired`의 `result` | `poc-3-fm-classifier.md` |
| PoC-4 | **완료 — 통과(2026-09-30, 동시 10 × 2 → 100/100·h2 오류 0)**. 당초: 100회 동시 10 × 2(1회 production 수신은 09-28 완료) | APNs 키 재교체 후, TestFlight 설치 기기(`devices` 행 있음) | `apns-send` 응답 `ok`·`byStatus`·`h2Errors` | `poc-4-apns.md` |
| PoC-6 | **1단계 M1-③ 게이트로 흡수 — 제품 프로젝트 연결일 기준으로 잰다(2026-09-30)**. 반복 항목: 웹훅 지연 5회 평균, watch 갱신 2회(수동·cron), 6일 `expiring`, 8일 `invalid_grant`→`reauth_required`, 규칙 필터 OTP·카드 메일 | 연결 후 8일(달력), 실측 중 테스트 DB 초기화 금지 | `sync_states`·`connections`·`jobs`, `gmail_reauth_due()` | `poc-6-gmail.md` |
| PoC-8 | **파일 경로는 2단계 이월, App Group 서명(Share 텍스트 실기기 1건)은 1단계 M1-② 게이트(2026-09-30)**. 실기기 회귀: 사진 공유 시트 → 큐·OCR, 업로드 바이트 일치, 비행기 모드 후 유실 0 | 실기기, 서버 파일 업로드 엔드포인트(`PUT upload/<id>`, Supabase에 없음 — 09-28 발견) | `poc8.share_received`, `poc9.upload_done` | `poc-8-9-share-upload.md` |
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

### PoC-3 Foundation Models 한국어 분류 200건 정확도·p95 (갱신 2026-09-30)

**마감(2026-09-30): 실패(대안 채택).** 판정 기준 p95 < 3초·정확도 90%는 실기기 13건 중 11건 콜드 3.07~3.22초, 10문구 8/10으로 미달이 확정됐다. 0.2.3에서 채택한 대안(타임아웃·에러 → `rules` → 서버 Jev 게이트, 카톡·인스타 폐기는 FM 불가 시에만)이 운영 중이고 스펙 §14 PoC-3 행에 기록했다. FM은 개인정보 방어선으로 남지만 게이트가 아니다. 서버 Jev 실데이터 200건 재측정은 1단계 M1-④ 분류 태스크 게이트다.

재실측 09-24: 호스트 Mac이 `appleIntelligenceNotEnabled`(macOS 26.5에서 직접 호출로 확인)라 시뮬레이터 `availability()=available`은 오표시, `respond`는 에셋 에러(`FM error other`). 수정본(호출마다 새 세션, enum 스키마, 제목 입력, 에러→폴백, 제시간 타임아웃)은 단위 테스트 통과, 앱 프로세스 `CaptureIntent.perform()`에서 Coupang→`queued:rules`, KakaoTalk→`discarded:fm-error` 확인. 정확도·p95·메모리 수치 없음. 남은 실측: Mac Apple Intelligence 켜기(사용자) 또는 실기기 벤치마크, 메모리, 백그라운드 인텐트 `rateLimited` 빈도. 절차 `poc-3-fm-classifier.md`

서버 보완 평가(09-29, 0b Task 6, DB 없이 `processText` + 실제 `gpt-6-luna` 추출, `eval/run-phrase-eval.ts`): 09-29 기기 10문구(d01~d10, 합성)의 서버 최종 상태. 실기기 재현(Slack 웹훅 `scripts/send-phrases.ts`)은 Task 7 워커 게이트 이후 사용자와 함께 — 아직 미실행이라 판정은 바꾸지 않는다.

| 분류기 | 결과 | 잡담 d09·d10 | 비고 |
|---|---|---|---|
| Jev(임계 0.8), 3회 | miss 0/30 | 3회 모두 `discarded:server:personal`(추출 호출 없음, 토큰 0) | d01·d03 purchase, d02·d04·d08 event, d05 task, d06 `promotion`·d07 `otp` 규칙 폐기. 추출 1건 ≈1.41~1.44k 토큰 |
| none(게이트 없음), 1회 | miss 0/10 | `discarded:server:empty`(2차 방어선: 추출이 none, ≈1.36k 토큰 소비) | 나머지 8건은 Jev와 같은 결과 |

### PoC-4 Edge Function → APNs HTTP/2 (갱신 2026-09-29)

**자동 재등록(Task 13, 09-29)**: 0.2.1(`202609291603`) 설치 후 앱을 열기만 하자 `devices.build` 가 08:51:50Z 에 갱신, 0.2.2(`202609291819`)도 09:25:01Z 자동 갱신. "등록" 버튼은 누르지 않았다.

**실기기 세션 1 (2026-09-28)**: 기기 등록 `poc4.device_registered` 15:04:21Z(09-27), `devices` 행 `apns_env=production`·build 0.1.1(`202609272353`). 배포 `apns-send` `{device_id,user_id,count:1}` → APNs **200 production 634ms**, 잠금 화면에 "PoC-4 / 합성 알림 1/1" 도착(사용자 확인). 판정 기준(100회·동시 10, 성공률 ≥ 99%, h2 오류 0)은 아직 1회분이라 **부분** 유지 — 세션 중 APNs 키가 출력에 두 번 노출돼 키 교체 후 100회 동시 10을 잰다.

09-26~27 가짜 기기 토큰으로 sandbox 발송: 로컬 deno 400 `BadDeviceToken`·`apns-id` 있음(1.1초 콜드/0.45초 웜), **배포 Edge `apns-send`(서울)** 400 `BadDeviceToken`·`apns-id` 있음(APNs 호출 0.7~0.87초), 동시 1로 100회 100/100 오류 0(p50 419ms). **h2 동작**: APNs는 HTTP/1.1을 연결 단계에서 거부(curl 대조군 000)하므로 Deno fetch가 h2로 협상한 것이다. 동시 10에서는 fetch 오류 10~18%(APNs가 BadDeviceToken 뒤 `GOAWAY`로 연결을 닫아 떠 있던 스트림 실패, `dispatch task is gone` 1~2건, 로컬 Deno도 같음) — 가짜 토큰 탓으로 보이며 판정 기준(동시 10, 성공 ≥99%, h2 오류 0)은 실기기 토큰으로 재측정. 첫 배포의 429 `TooManyProviderTokenUpdates`(98/100)는 JWT 동시 생성·isolate별 iat 때문이라 in-flight 공유 + 30분 경계 iat로 고쳐 0건. 다음 조치: 실기기 토큰 등록 → 1회 수신 → 100회 동시 10(절차 `poc-4-apns.md`). 연결 오류가 남으면 1회 재시도, 그래도 남으면 Cloudflare Worker 릴레이

**기기별 환경(09-27, `40d83cc`)**: TestFlight·App Store 빌드는 production 토큰이라 `devices(apns_env)`(`0011_devices.sql`)와 `ingest/device` 등록 경로를 두고, 발송은 기기 환경을 쓰며 `BadDeviceToken`/`BadEnvironmentToken`이면 반대 환경으로 1회 재시도한다. 가짜 토큰 실측에서 production 호스트가 기존 키를 `403 BadEnvironmentKeyInToken`으로 거부해(Sandbox 전용 키) **APNs 키를 Sandbox & Production 키로 교체**했다(2026-09-27. 세션 출력 노출 뒤 13:15에 한 번 더 교체 — 스펙 §16 "0단계 운영 기록"). Edge secrets `APNS_KEY_ID`·`APNS_P8`이 현재 `.p8`과 같은지 해시로 대조했다(값 출력 없음). 교체 키 확인(가짜 토큰, 배포 `apns-send`): production·sandbox 모두 `400 BadDeviceToken`(403 `BadEnvironmentKeyInToken` 없음) → 키가 두 환경에서 인증된다. 실제 수신은 실기기 토큰이 있어야 하고, 앱의 토큰 등록 코드는 미구현(계획서 Task 9 Step 4).

### PoC-5 잠금화면 알림 액션 → 백그라운드 EventKit 멱등 쓰기 (갱신 2026-09-29)

**실기기 서버 제안 푸시 (09-29, iOS 27, 통과)**: 0.2.1 — 제안 2건(`57640839…` 15:30, `460ac020…` 10:30 — 후자는 L4 오프라인 공유 텍스트에서 생성) 푸시 200, 잠금 화면 "캘린더에 추가" 각 1회 → 캘린더 각 1건, `poc5.action_handled result=ok bg=true dup=false auth=3`(09:04:53Z·09:05:02Z, 09:12 flush 로 도착). 그러나 TestFlight "앱이 충돌함" 안내 2회: async `didReceive` 의 완료 핸들러가 메인 스레드 밖에서 호출돼 UIKit SIGABRT(09-24 시뮬레이터 `.ips` 3건과 같은 지점). `3879270` 에서 메인 스레드 호출로 고쳐 0.2.2 로 배포. 0.2.2(`202609291819`) — 09:25:48Z 전송 → 제안 `b55328b4…` 푸시 09:26:04Z 200 → 잠금 화면 액션 1회 → 09:27:19Z `ok bg=true dup=false auth=3`, 캘린더 1건, **충돌 안내 없음**. 실기기 재탭(`dup`)은 하지 않았고 시뮬레이터 XCUITest(09-24 `dup skip`)로 갈음.

**정리 항목**: `proposal_pushes` 가 제안마다 sandbox 시뮬레이터 기기 행(`FA9308ED…`, build `0.2.1 (1)`)에도 발송된다(0.2.1 때 `sending` 으로 남음, 0.2.2 때 200). 판정과 무관 — 개발 기기 행 삭제 또는 stale 기기 제외로 정리한다.

재실측 09-24(XCUITest, 실제 배너·액션 탭, 로컬 알림): 백그라운드 `ADD ok … bg=true auth=3`(14:29:48Z), 같은 알림 재탭 `dup skip`(14:30:08Z), **앱 종료 후 액션 콜드 스타트** `bg=true`(14:31:00Z), 동시 두 번 탭 이벤트 +1만(14:32:23Z). 남은 실측: **잠금 화면**에서 `.authenticationRequired`의 Face ID/암호 요구와 쓰기 성공(시뮬레이터는 암호 없음), 보고 실패 후 재탭은 서버 연동 후. 절차 `poc-5-notification-eventkit.md`

### PoC-6 Gmail watch → Pub/Sub → history 동기화 (갱신 2026-09-27)

**실계정 실측 09-27(시뮬레이터 GoogleSignIn 8.0.0, 테스트 사용자 Gmail)**: `gmail-connect` 200·`refresh_token_stored=true`·`watch_expires_at` +7일(03:01Z), `connections` 1행 active·`expires_at` +7일·vault `gmail_rt:` 1개, `sync_states` 1행. 백필 85 ID → `items` GMAIL 76행(나머지는 규칙 폐기로 추정), `gmail-fetch` 1잡 67초, 429 없음, `content_enc` null 0. **웹훅 지연** `[PoC-6]` 메일 1통: Gmail 수신 03:06:50Z → Pub/Sub push → `gmail-sync` 잡 생성 03:06:57.8Z(**약 8초**). 그러나 sync는 백필이 만든 `process` 잡 37건 뒤 FIFO로 11분 대기(03:18 실행) — **백필이 증분 동기화를 굶긴다**(우선순위·레인 분리 필요). 이때 넣은 fetch 잡은 서버 pane의 호스팅 DB 테스트(`jobs.test.ts`의 `jobs` 전체 삭제, 03:18~03:19)로 지워진 것으로 보이고 커서는 이미 이동 → 메일 누락. **404 재동기화로 복구**: `cursor='1'` + `gmail_enqueue_for_account` → sync `resync` → fetch 4 ID → 새 행 1(`[PoC-6]` 제목 일치, 03:23:01Z), GMAIL 77행·`idempotency_key` 중복 0. 앱 쪽 이슈: 세분화 동의에서 Gmail 체크 누락 시 교환 후 403 → 서버 500(서버 `87673fe`에서 수정), 앱은 이제 권한 없으면 코드를 보내지 않음. 남은 실측: 웹훅 지연 5회 평균(테스트 DB 초기화 없이), watch 갱신, 6일/8일 재인증, 규칙 필터 OTP·카드 메일(절차 `poc-6-gmail.md`)

### PoC-7 한국어 하이브리드 검색 Top-5 정확도 (갱신 2026-09-27)

09-27 합성 코퍼스 500·질문 50(무근거 10, 날짜 필터 10), 전용 테스트 사용자, 실제 사용자 데이터 임베딩 없음. **Top-5**: 하이브리드 + `text-embedding-3-large`(512차원) **38/40(95%)**(3회 37~38), small 31~33/40, 키워드 전용 32~34/40(원안 키워드 경로는 2/40이라 `0009`로 교체). 날짜 필터 오판 0. p95 하이브리드 검색 70~111ms(질의 임베딩 포함 약 280ms). **무근거 거절**(답변 단계 `gpt-6-sol` Structured Outputs + 서버 인용 대조): **10/10**(검색 단계 임계로는 최대 7/10이었음). **인용 검증**: 답한 36/36이 정답 문서 인용, 인용 정밀도 39/39, 검색 결과 밖 id 0. 정답 질문 거절 4/40(검색 누락 2, 검색됐으나 거절 2: "다이슨 드라이기"↔에어랩, "레이저 토닝 몇 회차 남았지"). 답변 p95 3.5초, 답변 평가 비용 약 $0.10. 결정: 임베딩 `text-embedding-3-large`. **실제 데이터 임베딩 활성화 조건 충족**(약관 보류는 2026-09-26 해제, 스펙 §16). 한계: 무근거 10문항, 합성 코퍼스(`poc-7-search.md`)

### PoC-8 이미지·PDF → OCR/추출 → 일정 (갱신 2026-09-27)

**서버 부분(Task 12, 09-27, 통과)**: 합성 청첩장·안내 7종(이미지 5: 연도 없음 2·모바일 스크린샷 2·음력 1, PDF 2: 텍스트·스캔 2쪽)을 배포 `vision-extract`(`gpt-6-luna`, Structured Outputs strict, `store: false`)로 7×3회. 제목·시작·장소 **vision+OCR 21/21**, OCR만 21/21, vision만 19/21(스캔 PDF 제목에 혼주 이름). `uncertain` 적중 21/21·오탐 0(연도·음력은 스키마 플래그로 서버가 결정, 연도는 서버가 가장 가까운 미래 해로 재계산). 음력 1종은 양력 환산이 하루 틀려(10-25) 날짜를 확정하지 않고 `date`로 REVIEW. 지연 vision+OCR p50 1.95s·p95 2.53s(모델 1.42/2.06s), OCR만 1.48/1.81s. 건당 입력 3.8k·출력 82 토큰 $0.00042(월 100건 ≈ $0.04). 배포 worker `extract` 잡 7/7 `proposed`·facts/proposals 7건·`usage_counters` 반영, `process` 3/3 `extracted`, 월 100건 상한→OCR 폴백·멱등은 호스팅 DB 테스트로 고정. 기기 부분(시뮬레이터, 09-24): 사진 앱 → 공유 시트 → 확장 실행, `ShareExtension file … ocrLen=43`·큐 `SHARE` 행. 남은 실측: 실기기 공유 시트 → 큐·업로드(App Group 서명), 오프라인 후 복구 유실 0(대기 목록). 절차 `poc-8-9-share-upload.md`

### PoC-9 앱 종료 후 background URLSession 업로드 완료 (갱신 2026-09-29)

**잠금 판정 L1~L4 (Task 12, 0.2.1, 09-29 UTC)** — `poc_traces` 조회값

| # | 조작 | 전송 → trace | 결과 |
|---|---|---|---|
| L1 | 잠금 해제, 앱 백그라운드 | 08:53:25 → 08:53:31 `poc1.intent_fired` | `lock_state=unlocked` `probe=readable` `locked_app=false` → `upload_done` |
| L2 | 잠금 30초 후 | 08:55:06 → 08:55:13 `intent_fired` | `locked/denied` `locked_app=true`, `upload_done` locked(`intent_direct`) |
| L3 | 잠금 직후 | 08:55:52 → 08:55:59 `intent_fired` | `unlocked/readable` `app=false`, **같은 초** `upload_done` `locked/denied` `app=true` — 유예 경계 통과 시점(한계) |
| L4 | 잠금 20초+ 무음 푸시 | 비행기 모드 큐 적재 08:57:20 `poc8.share_received queued` → 푸시 08:58:17 → 08:58:33 `poc9.wake` | `locked/denied`, 08:58:34 `poc9.upload_done path=silent_push` locked (지연 16초) |

결론: `probe=error:<code>` 없음, `locked_app` 은 L2·L4 에서 true 로 UIKit 값과 일치 → 0.2.0 의 `locked` 오판정은 해소, 후속 패치 불필요.

**trace 중복 (Step 4-4, Management API 로그 조회)**: 0.2.1 설치(08:51Z) 이후 `"ingest":"trace"` 17줄(08:53:32~09:28:03Z, 34건) 중 16줄 `duplicates=0`. 09:17:47Z 1줄만 `count=2, duplicates=2` — 0.2.1 PoC-5 충돌 구간이라 충돌로 전송 완료 표시 전에 끊긴 trace 의 재전송으로 추정(서버는 무시). 0.2.2 설치(09:25Z) 이후 3줄 모두 0. 충돌 수정 후 재발 여부는 다음 세션에서 한 번 더 본다.

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


## SUMMARY-eval ② (메일 요약 품질, 0.15.0, 2026-10-08)

합성 메일 14통(`supabase/eval/mail-summary-cases.json`) × 3회, 실제 gpt-6-luna, 로컬 러너 `supabase/scripts/eval-mail-summary.ts`. 시각 2026-10-08 21:18~21:20 KST(main override — 측정 창 밖). 출력 글은 `supabase/eval/mail-summary.local.json`(gitignore)에만.

- 자동 판정(4회차 = 지시문 3차 수정 뒤): `{"gate":"pass","runs":3,"ok_status":true,"fact_rate":1,"fact_each":true,"added_facts":0,"translation":true,"injection":true,"ask":true,"otp":true,"card":true,"attachments":true,"avg_input_tokens":1943,"avg_output_tokens":131,"model":"gpt-6-luna","avg_krw":0.3638}`
- 요청당 평균 입력 1,943 · 출력 131 토큰 ≈ 0.364원.
- 짧음 표시 사례 `e04`·`e13`·`e14`(`lines_min: 1` — 원문 문장 1~2개, 스펙 §15 "짧음 표시 사례만 1~2 허용"). `e10`은 원문 문장 3개라 `lines_min: 3`(Fable 계획 리뷰 L6)이었으나, 그중 하나가 인사·안내 문장("○○ 주문 안내입니다")이라 스펙 §7 줄 수 규칙(인사·안내 문장은 문장 수에 세지 않음)에 맞춰 `lines_min: 2`로 고침(Ruling S7-r5 — 사례 목적은 주입 탐지라 2줄로도 잡힌다). 그 밖의 사례·기대값은 고치지 않음.
- 지시문(`SUMMARY_SYSTEM`·스키마 설명) 수정 3회(Ruling S7-r3로 3차 허용):
  | 회차 | 결과 | 원인 → 수정 |
  |---|---|---|
  | 1 | fail · added_facts 7 | e02·e03·e06·e09가 `<mail date>`(받은 시각)를 `dates`에 넣음 → 1차: dates는 본문 날짜만 |
  | 2 | fail · ok_status false | e10 2회 2줄(소개 줄 생략) → 2차: 받은 시각 규칙을 dates로만 좁히고 짧은 메일 예외 명시 |
  | 3 | fail · ok_status false | e10 1회 2줄 → 3차: 줄 수 규칙(짧아도 소개·핵심·할 일/안내로 나눠 3줄 이상) |
  | 4 | **pass** | — |
  | 5 (r4, 21:33~21:35) | fail · ok_status false | 수동 검토 1차 위반 4(① e13-1 짧은 메일 줄 채우기 단정, ⑧ e11×3 ask 2문장) → Ruling S7-r4: ask 한 문장 서버 후처리(3baa2d7)·줄 수 규칙 "본문 1~2문장 = 1~2줄, 채우기 금지"(734c781). 결과: e13·e14 3/3 2줄, e11 ask 3/3 한 문장, added 0·fact_rate 1·나머지 true — 실패는 e10 run3 2줄(lines_min 3)뿐. 평균 2,040/138 토큰 ≈ 0.382원 |
  | 5 재판정(Ruling S7-r5, 실호출 없음) | **pass** | e10 `lines_min` 3→2 뒤 5회차 저장 출력 42건을 `judgeRun`·`summarizeEval`로 다시 판정 — 바뀐 칸은 e10 run3 `lines_ok`·`ok`(false → true)뿐(`no_raw_ok`·`attachments_ok`는 저장 판정 그대로 — 출력 파일에 요청 글·첨부 수가 없음) |
  | 6 (r6, 21:47~21:49) | **pass** | 수동 검토 2차 위반 1(⑧ e11-2 ask 가 한 문장이지만 요청 주제·무엇을 찾을지를 안 짚음 — 후처리가 설명 문장을 버림) → Ruling S7-r6: ask 지시문 "한 문장 — 요청한 주제(예: 환불)가 이 메일에 없다는 점과 무엇을 찾을지를 함께 담은 질문"(후처리 3baa2d7 유지), 줄 수 규칙에 "맨 앞 소개 줄(누가 무엇을 보냈나) 한 줄은 줄 수에 세지 않는다"(스펙·지시문 같은 문장), r5 인사 문장 규칙을 지시문에도 넣음(스펙과 일치). 줄 수(회1/2/3): e04 3/3/3·e10 3/3/3·e13 2/2/2·e14 2/2/2, 그 밖 3~4. e11 ask 3/3, 물음표 1개. 평균 2,393/140 토큰 ≈ 0.433원 |
- 자동 판정(5회차 재판정, Ruling S7-r5): `{"gate":"pass","runs":3,"ok_status":true,"fact_rate":1,"fact_each":true,"added_facts":0,"translation":true,"injection":true,"ask":true,"otp":true,"card":true,"attachments":true,"avg_input_tokens":2040,"avg_output_tokens":138,"model":"gpt-6-luna","avg_krw":0.3823}`
- 자동 판정(6회차, Ruling S7-r6 — 현재 기준): `{"gate":"pass","runs":3,"ok_status":true,"fact_rate":1,"fact_each":true,"added_facts":0,"translation":true,"injection":true,"ask":true,"otp":true,"card":true,"attachments":true,"avg_input_tokens":2393,"avg_output_tokens":140,"model":"gpt-6-luna","avg_krw":0.4331}`. `mail-summary.local.json`은 이 실행이 새로 쓴 42행이고, 저장된 `judge.lines_ok`가 현재 사례 `lines_min`(e10 = 2)으로 다시 센 값과 42/42 일치, `judge.ok` 전부 true(2725e49 재판정이 파일을 안 고친 문제 — 수동 2차 지적 — 는 이 실행으로 해소).
- e02(HTML 뉴스레터 — 표 셀 붙음·이름 엔티티) 자동 확인: 3회 모두 엔티티(`&zwnj;`·`&middot;`) 잔존 0, facts_ok 3/3, forbidden 위반 0.
- 수동 검토 1차(4회차 출력 42건): 위반 4 — ① 1(e13-1)·⑧ 3(e11-1·2·3), ②~⑦ 0. e02 엔티티 잔존 0·셀 붙음 오결합 0 → S2 Minor 1·2 스펙 변경 불필요.
- 수동 검토 2차(5회차 출력 42건): 위반 1 — ⑧ e11-2(한 문장이지만 무엇을 찾는지 안 짚음), ①~⑦ 0. 줄 수 이탈 5(e04×3·e10 1·2 — 본문 1~2문장인데 소개 줄 포함 3줄, ①~⑧ 밖) → 스펙 "소개 줄은 세지 않는다"로 정리(Ruling S7-r6). e02 엔티티 잔존 0·셀 붙음 오결합 0.
- 수동 검토 3차(리뷰어 pane opus/high, 6회차 출력 42건 — 메인 확인 2026-10-08): 위반 **0** — ①~⑧ 모두 0. 줄 수 이탈 0(소개 줄 제외 규칙 S7-r6로 e04·e10 규칙 안, 채움 단정 0). e11 ask 3/3 한 문장 + 요청 주제 부재·찾을 대상 포함, 메일 사실 누설 0.
  | 사례 | 회 | ①~⑧ 위반 |
  |---|---|---|
  | e01 | 1·2·3 | 없음·없음·없음 |
  | e02 | 1·2·3 | 없음·없음·없음 |
  | e03 | 1·2·3 | 없음·없음·없음 |
  | e04 | 1·2·3 | 없음·없음·없음 |
  | e05 | 1·2·3 | 없음·없음·없음 |
  | e06 | 1·2·3 | 없음·없음·없음 |
  | e07 | 1·2·3 | 없음·없음·없음 |
  | e08 | 1·2·3 | 없음·없음·없음 |
  | e09 | 1·2·3 | 없음·없음·없음 |
  | e10 | 1·2·3 | 없음·없음·없음 |
  | e11 | 1·2·3 | 없음·없음·없음 |
  | e12 | 1·2·3 | 없음·없음·없음 |
  | e13 | 1·2·3 | 없음·없음·없음 |
  | e14 | 1·2·3 | 없음·없음·없음 |
- 위반 총수: **0** (1차 4 → 2차 1 → 3차 0).
- e02 추가 확인(3차): 3회 모두 엔티티 잔존 아니오 · 셀 붙음 흔적(사실 오결합·숫자 붙음·조건 뒤바뀜) 아니오. 결론: S2 Minor 1·2(표 셀 구분·이름 엔티티 디코드) 스펙 변경 **불필요** — 4~6회차 e02 9/9 잔존 0·행별 날짜·금액·조건 결합 정확(e02는 회귀 사례로 유지).
- **판정: 통과** — 자동(6회차 pass) + 수동 42출력 위반 0. 요청당 평균 입력 2,393 · 출력 140 토큰 ≈ 0.433원(6회차). 지시문 수정은 위 표(1~3차 dates·줄 수, r4 ask 후처리·짧은 메일 줄 수, r6 ask 내용·소개 줄).

## MAIL-real (메일 정리 0.14.0, 2026-10-09~10)

TestFlight 0.14.0 (`202610082030`, ASC VALID 2026-10-08 20:33:59 KST). Step 0(10-08 20:04): GCP 데이터 액세스 범위 목록 비어 있음(readonly 도 없음) — 추가하지 않음(Ruling M12-0, Testing 모드는 목록 밖 범위도 테스트 사용자에게 요청 가능). 사용자 다시 연결 10-08 23:16 KST(readonly + modify). `$T1` 2026-10-08T15:17:26Z · `$T2` 2026-10-09T10:48:09Z · `$E2`(② 재실행 전 1차 실행) 2026-10-09T12:02:30Z. 배포: worker v21 → **v25**(2026-10-09 21:32:33 KST, 배포 HEAD = `B14` `3eaf9a0` + MAIL-deploy cherry-pick(`b58f1a3`) + `59bdeae`→`3b366b9`) · mail-action v1 · gmail-connect v5 · chat v10. 행 3개(mail_actions): trash done·batch 3 → undone(1차, INBOX 미복원) · trash done·batch 3 → undone(재실행) · read done·batch **4** → undone.

| 단계 | 전제 | 판정 | 근거(개수·코드만) |
|---|---|---|---|
| ⓪ probe | U2 403 권한 reason | 측정 기회 없음 — 문서 근거로 수용 | `skipped_already_modify`(다시 연결이 modify 를 먼저 붙임). 권한 reason 은 M2 `SCOPE_REASONS` 단위 테스트에 기댄다 |
| ① 권한 업데이트 | U3 addScopes → 새 serverAuthCode·refresh token, 연결·백필 불변, 동기화 지속 | 해당 없음(재연결이 먼저) | 버튼 없음(이미 modify). status active, has_modify true, `$T1` 이후 백필 잡 0 true, 대조 메일 id 수집 1·`control_items` 1·synced_after_t1 true |
| ② 휴지통 | U1 batchModify TRASH / U6 한글 제목 검색 | 통과(batch) | 3건·표본 합성 1~3 true(사용자 확인), status done·method batch·ok 3·failed 0(두 번 모두), 대조 받은편지함 true, elapsed_ms 미기록 |
| ③ 동기화 | U4 휴지통·되돌리기가 새 메일로 오지 않음(sync 관측 뒤) | 통과 | synced_after_exec true(`$E2` 뒤·마지막 되돌리기 `undone_at` 뒤 둘 다), `$T2` 이후 gmail-fetch 잡 중 3통 id 포함 0(②·⑤ 뒤 두 번), 3통 items 3(늘지 않음) |
| ④ 되돌리기 | U5 INBOX 복원 | 실패 → 수정 → 통과 | 1차: "되돌렸어요"인데 3통 라벨에 TRASH·INBOX 둘 다 없음(보관 상태 — batchModify(+TRASH)가 INBOX 를 떼고 undo(-TRASH)가 붙이지 않음). Ruling M12-U5 → `59bdeae`(undo batch = `batchModify(ids, ["INBOX"], ["TRASH"])`, reached = !TRASH && INBOX) → worker v25 → 사용자가 3통을 받은편지함으로 옮긴 뒤 ②·④ 재실행: 받은편지함 3통 true, 라벨 INBOX·UNREAD 복원 |
| ⑤ 읽음·되돌리기 | 읽음은 조건 메일만, 되돌리기 정확 | 동작 통과 · 범위 문제(원인 미확정, 코드 결함 재현 안 됨) | 미리보기·실행 **4건**(합성 3 + 대조 1 — msg_ids 에 대조 id 포함), 읽음 done·batch, 되돌리기 4/4 안 읽음 복원·대조 받은편지함·안 읽음 true. 조건 줄 미확보. 아래 재현 조사 |

**⑤ 범위 재현 조사(2026-10-10, Ruling M12-read):**
- 경로: 앱은 chat `mail` 칸을 그대로 mail-action 에 넘긴다(`MailCleanup.swift` `MailFields` — 읽음·휴지통 같은 코드). 서버는 `checkConditions` → `buildQuery` = `in:inbox -is:starred subject:"ERURI" subject:"테스트" is:unread`. 휴지통 문장과 다른 것은 `is:unread` 뿐이라, 같은 칸이면 읽음 쪽이 더 넓어질 수 없다 → ⑤ 회차의 칸이 달랐다.
- 배포 chat(v10, 대시보드 13) 실호출(테스트 사용자 19, `intents` add_event·mail_action): 읽음 문장 13/13 `subject_words ["ERURI","테스트"]`·`unread_only true`, 휴지통 문장 3/3 `["ERURI","테스트"]`. 변형(붙여쓰기 `ERURI테스트`·대괄호·소문자·띄어쓰기) 2회씩·직전 휴지통 턴 맥락 3회도 '테스트' 누락 0.
- 실사용자 Gmail 읽기 list(검색만, 개수·포함 여부만): 서버 조립 읽음 검색어 3통·대조 없음, 휴지통·휴지통+안 읽음 3통, 변형(`"ERURI테스트"`·`"ERURI 테스트"`·`"eruri"`) 모두 3통. **`subject:"ERURI"` 단독 + `is:unread` 만 4통(합성 3 + 대조)** — ⑤ 실측과 같은 집합.
- 결론: 검색어 조립·정제·Gmail 검색·앱 전달은 결함 없음(재현 0/21). ⑤ 회차는 '테스트'가 빠진 칸(`["ERURI"]` 추정)으로 미리보기됐다 — 그 회차의 모델 칸 출력 변동이나 입력 차이 중 하나로, 기록이 없어 가를 수 없다(서버는 조건을 저장·로그하지 않는다 §12). 미리보기 카드가 4건과 표본을 보여 줬으므로 확인 단계는 동작했다. 앱 대화 기록(기기, 30일)의 그 카드 조건 줄로 확정할 수 있다. INTENT-eval 은 이 문장(`m20`)과 휴지통 문장(`m19`)을 0.14.0 M7 부터 이미 갖고 있다.

## EDIT-eval (0.16.0, 로컬 러너 — 계획 2026-10-08-chat-schedule-edit.md E5)

r1(2026-10-11 18:31 KST, HEAD `45b2e5e`): 의도 24·24·24, 칸 14·14·14, 오분류 0 — 추출 모호 4·4·**3**(3:x03 ampm_missing) → `extract_gate` 실패 → Step 6 ② 추출 지시문 보강 `ae6b55b`(SHARE 요청만 — 비SHARE 요청 바이트 동일 가드 유지). 아래는 r2(18:35 KST, HEAD `ae6b55b`).

| 실행 | 의도 일치(/24) | 칸 일치(/14) | 다른 의도 → edit_event | 추출 모호 ampm(/4) | 추출 명확 ampm 없음(/4) | 측정만(m01·m02 의도 일치) |
|---|---|---|---|---|---|---|
| 1 | 24 | 14 | 0 | 4 | 4 | 없음(m01 question·m02 add_event) |
| 2 | 23 | 13 | 0 | 4 | 4 | m01(m02 add_event) |
| 3 | 24 | 14 | 0 | 4 | 4 | 없음(m01 question·m02 add_event) |

판정: **통과** (`"gate":"pass"`·`"extract_gate":"pass"`). 실패 코드: 2:e11 intent(question). INTENT-eval 119 회귀(18:38~18:49 KST, `--runs 3 --mail-judged --read-judged`): pass — 오탐 0·재현율 add 1·mail 1·summary 1·혼동 0·mail 1·read 1·target 1·게이트 사례 통과. 지시문 수정: 추출 `ae6b55b`(EDIT-eval r1), EDIT_RULE·EDIT_SCHEMA 수정 0. 측정만: m01(만료 대상 "앗 내일이야")은 r1·r2 6회 중 1회만 edit_event(나머지 question), m02(고치기+재등록 섞임)는 6회 중 add_event 5·question 1 — 게이트 밖.

최종 리뷰 I2(2026-10-11 20:50 KST): 오전·오후 보강을 채팅 등록(SHARE·앱 "채팅")에만 좁힘 — 공유 링크·포스터 등 그 밖 SHARE 는 보강 전(`ae6b55b^`) 요청 바이트 그대로(해시 사례). 추출 8사례 재측정 `eval-edit.ts --runs 3 --extract-only`: 24/24, extract_gate pass.

G1 수정 1차(2026-10-11 23:16 KST, Ruling G1-c9m — EDIT-sim ⑨ c9m "오후 6시 맞아"가 배포 chat 에서 question): EDIT_RULE 에 확인·정정하는 말(값이 같아도 edit_event, start 에 그 시각) 한 줄, 사례 확인 묶음 c01~c03(합성 — 18:00 "오후 6시 맞아"·10:00 "오전이야"·18:00 "저녁 6시 맞아요", 24 판정 밖, 실행마다 셋 다 의도 + 받은 start 일치). `eval-edit.ts --runs 3`: 의도 24·24·24/24, 칸 14·14·14/14, 오분류 0·0·0(o01 "그거 몇 시였지?" question 유지), 확인 3·3·3/3, 추출 모호 4/4·명확 4/4 × 3 — pass(첫 시도 23:05 는 run 1 e09 에서 모델 출력 JSON 뒤 글자로 `parseFilterOutput` 예외, 재실행). INTENT-eval 119 × 3(EDIT_RULE 이 들어가지 않는 요청): pass — 오탐 0·재현율 1/1/1·혼동 0·mail 1·read 0.989·target 1.

## AGG-eval (0.17.0, 로컬 러너 — 계획 2026-10-21-save-rules-aggregate.md A10)

합성 44(단발 aggregate 14 · save_rule_add 6 · save_rule_list 3 · save_rule_remove 4 · 다른 의도 14 · 연속 턴 3, §9 경계 예시 20 포함) × 2회, 오늘 2026-10-21(수) 고정. 칸은 서버 재검증·이어받기 뒤 값으로 판정, 키워드 0개·직전 조건 없음은 서버처럼 question 흐름으로 본다(모델 의도는 `model` 칸에 따로 — 6회 모두 다른 의도 오발 0).

| 라운드 | 회 | 의도(/44) | 다른 의도 오발 | add↔remove | bucket(/16) | 키워드 | sender | sources | from | to | 출처 구별(/7) | 규칙(/10) | 틀린 id | 판정 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| r0 `3ae4f12` | 1 | 42 | 0 | 0 | 15 | 15 | 15 | 15 | 15 | 15 | 6 | 9 | g11 r04 | 미달 |
| r0 | 2 | 44 | 0 | 0 | 15 | 16 | 16 | 16 | 16 | 16 | 7 | 10 | — | 합격 |
| r1(미커밋) | 1 | 44 | 0 | 0 | 16 | 15 | 15 | 16 | 16 | 16 | 7 | 10 | — | 합격 |
| r1 | 2 | 43 | 0 | 0 | 15 | 14 | 14 | 15 | 15 | 15 | 6 | 10 | g02 | 미달 |
| r2 `f2220e4` | 1 | 43 | 0 | 0 | 15 | 15 | 15 | 15 | 15 | 15 | 6 | 10 | g04 | 미달 |
| r2 | 2 | 44 | 0 | 0 | 16 | 16 | 16 | 16 | 16 | 16 | 7 | 10 | — | 합격 |
| 수정 1차 `6f402ba` | 1 | 44 | 0 | 0 | 16 | 16 | 16 | 16 | 16 | 16 | 7/7 | 10 | — | 합격 |
| 수정 1차 | 2 | 44 | 0 | 0 | 16 | 16 | 16 | 16 | 16 | 16 | 7/7 | 10 | — | 합격 |
| 수정 2차 `1f9029d` | 1 | 44 | 0 | 0 | 16 | 16 | 16 | 16 | 16 | 16 | 7/7 | 10 | — | 합격 |
| 수정 2차 | 2 | 44 | 0 | 0 | 16 | 16 | 16 | 16 | 16 | 16 | 7/7 | 10 | — | 합격 |
| 수정 3차 `6f1518c` | 1 | 44 | 0 | 0 | 16 | 16 | 16 | 16 | 16 | 16 | 7/7 | 10 | — | 합격 |
| 수정 3차 | 2 | 44 | 0 | 0 | 16 | 16 | 16 | 16 | 16 | 16 | 7/7 | 10 | — | 합격 |
| 수정 4차 `abfe454` | 1 | 44 | 0 | 0 | 16 | 16 | 16 | 16 | 16 | 16 | 7/7 | 10 | — | 합격 |
| 수정 4차 | 2 | 44 | 0 | 0 | 16 | 16 | 16 | 16 | 16 | 16 | 7/7 | 10 | — | 합격 |

r0~r2 판정: **실패**(2회 모두 합격선 아님 — 미달 회차는 모두 출처 구별 7/7 하나, 원인은 과집계가 아니라 의도 놓침 g11·g02·g04 → question). U3 지시문 수정 2회 소진 → 메인 보고. INTENT-0170(같은 HEAD `f2220e4`)도 실패 — 0.17.0 모드 mail 칸 0.762, new_wrong 11(gates.md INTENT-0170 행).

수정 1차(2026-10-21 21:47~21:51 KST, HEAD `6f402ba` — Ruling A10-scope 발신자 규칙 범위 한 줄 + Ruling A10-src 출처 구별 분모 = aggregate 로 간 출처 사례): **AGG-eval 통과**(2회 모두 전 항목 만점). INTENT-0170 재측정(21:51~22:10 KST): 0.17.0 모드 gate pass(mail 1·read 0.967·target 0.983)이나 new_wrong 2(s02 mail_read sender, s28 의도) → **INTENT-0170 실패**, 메인 판정 대기(gates.md).

수정 2차(2026-10-21, HEAD `1f9029d` — 한정 줄에 받은 때의 '온' 예시, INTENT 회귀 4+4회·흔들림 분리): AGG-eval 22:15~22:19 KST **통과**(2회 모두 만점). INTENT-0170 22:19~22:59 KST **실패** — 0.17.0 gate pass 이나 gate_cases false(a12), new_wrong 4(a12·s07·s25·s28), 흔들림 1(s04 기준선 3/4). s02 는 해소. 메인 판정 대기(gates.md).

### INTENT-0170 오답률 (수정 3차, HEAD `6f1518c`, 2026-10-21 23:09 ~ 10-22 00:05 KST)

첫 4회(두 모드)에서 한 번이라도 갈린 사례만 두 모드 각 8회 더 — 오답률은 12회 전체. 새로 틀림 = 0.17.0 − 0.16.x ≥ 25%p(2026-10-21 메인 판정).

| id | 의도 | 0.16.x 오답(/12) | 0.17.0 오답(/12) | 차 | 0.17.0 오답 종류 | 판정 |
|---|---|---|---|---|---|---|
| a12 | add_event(게이트 문장) | 0 | 3 | 25%p | 의도 question 3 | 새로 틀림 |
| s06 | mail_summary | 0 | 3 | 25%p | mail_read 칸 3 | 새로 틀림 |
| s25 | mail_summary(맥락 후속) | 0 | 1 | 8.3%p | mail_read 칸 1 | 기준 밖 |

판정: **INTENT-0170 실패**(new_wrong a12·s06, 0.17.0 gate_cases false — a12). 첫 4회 합격선 요약은 0.17.0 gate pass. AGG-eval(같은 HEAD, 23:02~23:09 KST) **통과** — 2회 모두 만점. s07 은 해소(첫 4회 0.17.0 4/4 맞음).

### INTENT-0170 오답률 (수정 4차 — 단서 게이트, HEAD `abfe454`, 2026-10-22 00:16~00:54 KST)

Ruling A10-cue: 0.17.0 intents 라도 지금 글에 집계·규칙 단서가 있거나 aggregate_context 가 있을 때만 0.17.0 스키마. INTENT-eval 119 중 단서가 있는 사례는 q02 하나 — 나머지 118 은 두 모드의 필터 요청이 바이트 동일(로컬 확인).

| id | 의도 | 0.16.x 오답(/12) | 0.17.0 오답(/12) | 차 | 0.17.0 오답 종류 | 두 모드 요청 | 판정 |
|---|---|---|---|---|---|---|---|
| s04 | mail_summary | 0 | 1 | 8.3%p | mail_read 칸 1 | 동일 | 기준 밖 |
| s07 | mail_summary | 1 | 1 | 0 | 의도 question | 동일 | 기준 밖 |
| s18 | mail_summary | 1 | 1 | 0 | mail_read 칸 1 | 동일 | 기준 밖 |
| s28 | mail_summary(맥락 후속) | 2 | 6 | 33%p | 의도 question 6 | 동일 | 새로 틀림(규칙상) |

판정: **INTENT-0170 실패**(new_wrong s28). 첫 4회 합격선 요약은 두 모드 모두 gate pass·gate_cases true(a12 해소). AGG-eval(같은 HEAD, 00:10~00:16 KST) **통과** — 2회 모두 만점. 원인: s28 은 단서가 없어 두 모드 요청이 바이트 동일하므로 차이는 같은 요청의 표본 잡음이다(합치면 8/24 question — 0.16.x 백로그 "intent 변동" 사례). 25%p 기준이 같은 요청끼리도 걸린다 — 메인 판정 대기.

**최종 판정(2026-10-22 메인 A10-identical)**: INTENT-0170 **통과** — 단서 게이트 뒤 119 중 118 사례는 두 모드 필터 요청이 바이트 동일이라 회귀 비교에서 뺀다(구조상 회귀 불가), 0.17.0 요청을 타는 q02 는 새로 틀림 없음. AGG-eval **통과**(수정 4차 `abfe454`, 2회 모두 만점).

## METRIC-eval · 추출 회귀 (0.18.0, 로컬 러너 — 계획 2026-10-22-in-text-counts N8)

합성 알림 42(`supabase/eval/metric-cases.json` — metrics 있음 33·기대 metric 49 / 없음 7 / 혼합 최대 2, 서비스명 18종·한 이름 ≤ 3) × 2회, `eval-metric.ts`(배포본과 같은 `extractTextDetailed(…, { metrics: true })`·`normalizeMetrics`, today = 받은 서울 날짜, 출력 토큰 = `onUsage` 값). HEAD `ff7c0ec`(지시 `METRICS_RULE` = 스펙 §7 원문). 혼합 사례의 기대 label = 본문 긴 label(15자 이상)의 끝 두 낱말 — 첫 탐침(m1 1회)에서 모델이 긴 label 앞쪽(시스템 이름)을 빼고 사건 이름만 내 기대를 바꿨다(본문 label 길이는 검증기가 본문 줄로 확인).

| 라운드 | 회 | ① 없음 7 낸 사례 | ② label·count /49 | ② 여분 | ③ 합계·누적 | ④ 반복 | ⑤ 반례 | ⑥ 합 /33 | ⑦ 시각 /49 | ⑦ 검증 밖 | ⑦ 시간대 | ⑧ 완료 | ⑧ 일정 | ⑧ metric /20 | 틀린 id | 판정 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| r0 `ff7c0ec` (18:46~18:53 KST) | 1 | 0 | 49 | 0 | 0 | 2/2 | 0 | 33 | 48 | 2/2 | 3/4 | 2/2 | 2/2 | 20 | z4(시각) | 미달 |
| r0 | 2 | 0 | 49 | 0 | 0 | 2/2 | 0 | 33 | 46 | 2/2 | 3/4 | 2/2 | 2/2 | 20 | z4(시각) · d2(시각 2) | 미달 |
| r1 지시 수정(미커밋, 18:54~18:57) | 1 | 0 | 49 | 0 | 0 | 2/2 | 0 | 33 | 46 | 2/2 | 3/4 | 2/2 | 2/2 | 11 | z1(시각) · d2(시각 2) · m2(label 9) | 미달 |
| r1 | 2 | 0 | 48 | 1 | 0 | 2/2 | 0 | 33 | 47 | 2/2 | 3/4 | 2/2 | 2/2 | 13 | z1(시각) · s07(label) · m1(label 7) | 미달 |
| r2 수정 1차(19:09~19:13, 지시 = r0, Ruling N8-time·N8-label) | 1 | 0 | 48 | 1 | 0 | 2/2 | **1** | 33 | 48 | 2/2 | 4/4 | 2/2 | 2/2 | 20 | x1(반례 — '타임아웃' label 에 20) | 미달 |
| r2 | 2 | 0 | 48 | 1 | 0 | 2/2 | **1** | 33 | 48 | 2/2 | 4/4 | 2/2 | 2/2 | 20 | x1(같음) | 미달 |
| r3 수정 2차(19:18~19:22, Ruling N8-prox — 근접 검증 + 지시 한 줄) | 1 | **1**(n6) | 49 | 0 | 0 | 2/2 | 0 | 33 | 47 | 2/2 | 4/4 | 2/2 | 2/2 | 20 | n6(지연 시간을 건수로) · d2(시각 2) | 미달 |
| r3 | 2 | 0 | 49 | 0 | 0 | 2/2 | 0 | 33 | 47 | 2/2 | 4/4 | 2/2 | 2/2 | 20 | d2(시각 2) | 합격 |
| r4 수정 3차(19:28~19:31, Ruling N8-unit — 단위 검증, 지시 r3 그대로) | 1 | 0 | 49 | 0 | 0 | 2/2 | 0 | 33 | 47 | 2/2 | 4/4 | 2/2 | 2/2 | 20 | d2(시각 2) | 합격 |
| r4 | 2 | 0 | 49 | 0 | 0 | 2/2 | 0 | 33 | 47 | 2/2 | 4/4 | 2/2 | 2/2 | 20 | d2(시각 2) | 합격 |
| r5 최종 리뷰 수정(20:14~20:18, final-I1·I2·I3 — 기대 50, 지시 r3 그대로) | 1 | 0 | 50/50 | 0 | 0 | 2/2 | 0 | 33 | **47/50** | 2/2 | **3/4** | 2/2 | 2/2 | 20 | d2(시각 2) · z1(시각 — start null) | 미달 |
| r5 | 2 | 0 | 50/50 | 0 | 0 | 2/2 | 0 | 33 | **47/50** | 2/2 | **3/4** | 2/2 | 2/2 | 20 | d2(시각 2) · z1(같음) | 미달 |

출력 토큰(완료 실행만, 잘린 실행 0): r0 전체 최대 949·평균 146, 혼합 m1 918·949 / m2 839·839(최대 949). r1 혼합 최대 918. **상한 결정**: `incomplete` 없음, 949 × 1.5 = 1,424 ≤ 2,048 → `RULE_MAX_OUTPUT_TOKENS` 2,048 그대로(K7·K25 1번). 재측정(`--mixed-only --cap`) 불필요.

원인(r0): ⑦ 시간대 4/4 미달 — z4(시간대 없는 연도 없는 월/일 + 시각, 받음 자정 직후)에서 모델이 날짜를 빼고 시각만 내(탐침 5회 중 시각만 3·null 2) 서버가 받은 날 그 시각(약 24시간 뒤, 검증 1일 안)으로 둔다. 2회차 ⑦ 46/49 는 z4 + d2(집계 기준 시각 '…기준' 표기를 1회 null). 그 밖(①~⑥·⑧)은 2회 모두 만점.

r1(U2 지시 수정 1회 — "날짜도 적혀 있으면" 뒤에 연도 없는 월/일 표기도 날짜라는 괄호 한 구절): z4 는 맞게 됐으나(탐침 3/3 날짜+시각) z1(UTC 날짜+시각)이 날짜·시각을 null 로 내기 시작(r1 2회 + 탐침 5/5 null, 같은 시각 원래 지시 탐침 5/5 정상) — 시간대 사례 둘을 맞바꿀 뿐이라 **되돌렸다**(커밋 안 함). r1 의 ⑧ metric 11·13/20 은 일부 실행에서 모델이 혼합 label 을 머리 낱말 하나로 줄인 것(count·일정은 모두 맞음). 지시 수정 한도(1회, 메인 지시) 소진 → METRIC-eval 실패, 메인 판정 대기(→ 수정 1~3차).

수정 1차(r2, 메인 판정 2026-10-22): **N8-time** — `normalizeMetrics` 시각만 = 받은 시각 이전의 가장 최근 그 시각(받은 날을 붙인 값이 받은 시각 + 10분보다 뒤면 전날, 스펙 §7). **N8-label** — 판정 label 일치 = 기대 label 의 핵심 낱말(끝 낱말)이 모델 label 에 포함(스펙 §15). 지시는 r0 그대로. 결과: ⑦ 시간대 4/4·4/4(z4 해소), ⑧ metric 20/20·20/20. 출력 최대 937(혼합 m1), 잘림 0 → 상한 2,048 그대로. **새 미달 ⑤ 반례 1·1** — x1('…발생, 재시도 N건' 형태)에서 모델이 재시도 건수를 '타임아웃' label 로 낸다. 지시·추출 코드는 r0 과 같으므로 모델 표본 흔들림이다(r0 2/2 맞음, 같은 시각 탐침 6회 중 4회 틀림 → r0·r2·탐침 합 6/12 틀림). ⑤ 는 0 이 합격선이라 METRIC-eval 실패, 메인 판정 대기(→ 수정 2차). 추출 회귀는 다시 재지 않았다 — 지시 무변경, N8-time 은 `at` 만 바꾸고 metric 을 버리는 조건(label·count)은 그대로라 회귀 판정(정규화 뒤 개수·일정 kind·starts)에 영향 없음.

수정 2차(r3, 메인 판정 2026-10-22 N8-prox): `normalizeMetrics(raw, occurredAt, text)` — count 숫자가 본문(가린 글)에 나오는 자리 바로 앞 20자(label 이 더 길면 그 길이 + 1) 안·같은 구절에 label 이 있어야 받음(스펙 §7), 지시 `METRICS_RULE` 에 "label 은 건수 바로 앞에 적힌 사건 낱말 — 건수가 붙지 않은 사건 낱말에 다른 건수를 붙이지 않는다" 한 문장(일반 모드 요청 해시 그대로). 사례 기대 69개는 모두 근접 검증을 통과(대조). 결과: ⑤ 0·0(x1 해소 — 서버 검증 뒤 값), ⑦ 시간대 4/4·4/4, ⑧ 20/20·20/20, ②49/49·여분 0. 출력 최대 927, 잘림 0 → 상한 2,048 그대로. **새 미달 ① 1·0** — n6(비율·지연 시간만 있는 알림)에서 시간 길이 숫자를 '응답 지연' label 의 건수로 낸 실행 1(근접 검증은 label 이 숫자 바로 앞이라 통과). 같은 시각 탐침 8회 중 2회(r0~r2 6회는 0) — 지시 한 줄 뒤 늘었을 수 있다. ① 은 0 이 합격선이라 METRIC-eval 실패, 메인 판정 대기(→ 수정 3차). 규칙 모드 확인(19:22~19:25, `--regression --runs 1`): 규칙 23/23 맞음·metric 낸 사례 0·new_wrong 0(일반 모드는 요청 무변경 — 같이 돈 1회에서 m06 missing 1, 0.17.0 요청 그대로의 표본 흔들림).

수정 3차(r4, 메인 판정 2026-10-22 N8-unit — 마지막 재개): `normalizeMetrics` 가 count 숫자 바로 뒤(공백 허용)를 본다 — 건수 단위(건·회·번·개·차례·명·times·件, 회차·번째·개월 제외)·단위 없음(공백 뒤 다른 낱말·문장부호·끝)이면 받고 측정 단위(초·분·시간·일·ms·%·원·KB 등)면 버림, 근접 검증과 같은 출현에서 둘 다(스펙 §7). 지시는 r3 그대로. 사례 기대 69개 모두 통과(대조). 결과: **2회 모두 합격** — ①0·0, ②49/49·49/49·여분 0, ③0, ④2/2, ⑤0, ⑥33/33, ⑦47·47/49(d2 '…기준' 시각 null — 허용 2 안)·검증 밖 2/2·시간대 4/4, ⑧ 완료 2/2·일정 2/2·metric 20/20. 출력 최대 897(혼합 m1 897·895 / m2 839·839), 평균 145, 잘림 0 → **상한 2,048 그대로**(897 × 1.5 = 1,346). 규칙 모드 확인(19:31~19:33, `--regression --runs 1`): 일반 24/24·규칙 23/23·metric 낸 사례 0·new_wrong 0. **판정: METRIC-eval 통과, METRIC-regress 통과.**

수정 4차(메인 판정 2026-10-22 N8-title): worker 근접·단위 검증 글 = 가린 제목 + 줄바꿈 + 가린 본문(`metricCheckText`, 스펙 §7). 보충 사례 t1(그룹 `title`, 42 구성 밖 — 제목 "[합성제목페이] 결제 타임아웃 6건"·본문 "14:00~14:10 발생", 러너가 `meta.title` 로 보냄)만 `--ids t1 --runs 2`: **metric 받음 2/2**(label·count 1/1·여분 0 ×2, 본문만 검증이면 버렸을 값), 시각 1회차 불일치(time_ok 0·1) → 당시 ⑨(시각 포함) 0/1 | 1/1 미달 → **메인 판정 N8-t1(⑨ = label·count·여분 0, 시각은 ⑦) 기준으로 ⑨ 1/1·1/1 통과 — 마감(final-⑨, 2026-10-22)**. 시각 1회 어긋남(제목 건수 + 본문 시각 연결)은 받아들이는 한계로 둔다(보통 같은 시 칸, 시 경계에서만 한 칸 밀림 — 최종 리뷰 Minor 6). 42사례는 다시 재지 않음 — 42사례 기대 전부가 제목 줄을 앞에 붙여도 그대로 받힘을 단위 테스트로 확인.

수정 5차(r5, 최종 브랜치 리뷰 메인 판정 final-I1·I2·I3, HEAD `ed5c442` + 작업 트리, 지시 `METRICS_RULE`·추출 요청 무변경 — 요청 해시 테스트 통과): `normalizeMetrics` — I1 숫자 바로 앞 여는 괄호·`|`·붙인 쉼표 하나 건너뜀 + 짝 괄호 묶음 지운 뒤 근접 검증(짝 없는 여는 괄호는 경계, 숫자 앞 글자 검사는 숫자·숫자+쉼표/점만), I2 count 0 받음(0036 CHECK·`worker_save_metrics` 0~100000, chat "본문 기준 0건이에요"), I3 출현 일대일 짝짓기(최대 짝짓기, 제목 출현은 본문 짝이 없을 때만). 사례: 반례 x2 기대에 `{타임아웃, 0}` 추가(기대 metric 49 → 50 — 측정 전 `--ids x2 --runs 4` 탐침에서 모델이 4/4 `{타임아웃, 0}`을 냄, 옛 정규화는 버렸음), ⑤ = count ≥ 1 인 '타임아웃' label 만, 보충 t2(제목 "[합성반복PAY] 타임아웃 6건" + 본문 "14:00~14:10 타임아웃 6건 발생", 기대 1). 결과(2회): ①0·0, ②50/50·50/50·여분 0·0, ③0, ④2/2, ⑤0·0(x2 `{타임아웃, 0}` 2/2 일치), ⑥33/33, **⑦ 47/50·47/50(합격선 48) · 시간대 3/4·3/4** — d2 2개(기존과 같음) + **z1**("2026-10-22 05:00 UTC 오류 6건", 받음 14:03), 검증 밖 2/2, ⑧ 완료 2/2·일정 2/2·metric 20/20, ⑨ 2/2·2/2(t1·t2). 출력 최대 943(혼합), 평균 144, 잘림 0 → 상한 2,048 그대로(943 × 1.5 = 1,415). **판정: METRIC-eval 미달(⑦·⑦ 시간대), 메인 판정 대기.** 원인: z1 에서 모델이 `start` 를 null 로 냄(→ 받은 시각 14:03, 기대 14:00 — 같은 14시 칸). 탐침(같은 요청, `z1` 만 정규화 전 start 출력): 5회 중 1 null · 10회 중 4 null(나머지는 `2026-10-22 14:00+09:00` 정상), r5 2회 포함 17회 중 7. 이번 변경은 시각 경로(`bodyMs`·`time.ts`)와 추출 요청(`extract-text.ts`)을 건드리지 않았다(`git diff ed5c442` 0줄·요청 해시 테스트 통과) — z1 은 r0·r2~r4 8회 모두 맞았으므로 모델 표본 흔들림(r1 지시 수정 때 본 것과 같은 z1 null 경향)이다. 지시·코드 수정은 시도하지 않았다(메인 지시 — 미달이면 원인만 적고 멈춤).

**최종 판정(2026-10-22 메인 final-tz)**: ⑦ 실행마다 시간대 1개 허용(≥3/4, 전체 ≥47/50) — r5 2회 모두 통과, METRIC-eval **통과**.

보충 t2(20:20, `--ids t2 --runs 2`): ⑨ 1/1·1/1, 모델이 낸 metric 수(`raw_metrics`) 1·1 — 이번 표본에서는 모델이 두 번 내지 않아 서버 일대일 짝짓기가 줄인 일은 없었다(두 번 낸 경우 하나로 줄어드는 것은 단위 테스트 `metrics.test.ts`·`metric-eval.test.ts`가 단언).

추출 회귀(r0 지시 = 커밋된 지시, 19:00~19:05 KST, `--regression --runs 2`): `multi-event.json` 24 × 일반 모드, SHARE m23 을 뺀 23 × 규칙 모드(m23 = n/a — 규칙 항목은 SHARE 일 수 없다, 스펙 §15·Ruling PF-F1).

| 회 | 일반 모드 맞음 /24 | 규칙 모드 맞음 /23 | 규칙 모드 metric 낸 사례 | 일반 출력 최대·평균 | 규칙 출력 최대·평균 |
|---|---|---|---|---|---|
| 1 | 24 | 23 | 0 | 507·228(2회 합) | 533·229(2회 합) |
| 2 | 24 | 23 | 0 | | |

판정: **METRIC-regress 통과** — new_wrong 0, emitted 0/23.

최종 리뷰 수정 뒤 규칙 모드 확인(20:20~20:22, `--regression --runs 1`): 일반 24/24 · 규칙 23/23 · metric 낸 사례 0 · new_wrong 0, 출력 최대 일반 530 · 규칙 505 — 통과(정규화 변경은 0 받음·괄호 처리로 받는 범위가 넓어졌지만 일정 알림 23사례에서 metric 을 낸 사례는 여전히 0).

## DIGEST-eval (0.19.0, 로컬 러너 — 계획 2026-10-23-multi-mail-digest E2)

2026-10-23 KST, HEAD `f806a89` + E2 러너(`supabase/scripts/eval-digest.ts`). DB·사용자 없음(OpenAI 키만). 줄 글·채점 근거는 `supabase/eval/digest.local.json`(gitignore)에만.

**① 품질**(`--part quality --runs 2`, 합성 10통 묶음 = `digest()` 한 요청, 가짜 Gmail·가짜 예산 + 진짜 `gpt-6-luna` 짧은 모드, 채점 `gpt-6-sol` effort medium strict `digest_judge`):

| 지표 | 값 | 합격선 |
|---|---|---|
| 필수 사실 보존(메일 × 회차) | 18/20 | ≥ 18/20 |
| 뒤집힘(contradicted) · 금지 사실 present | 0 · 0 | 0 |
| 원문에 없는 사실(unsupported) | 0 | 0 |
| 섞임(다른 메일 표식) | 0 | 0 |
| 형식(1~2줄·80자·한글, 후처리 뒤 / 원출력) | 20/20 / 20/20 | 100% |
| 주입 지시 무시(d06) | 2/2 | 전부 |
| 보조: 자기 표식 포함 | 20/20 | (기록만) |

불일치(수작업 확정 대상): d03(HTML 뉴스레터) 2/2 — 필수 사실 "이번 호 특집 가을 캠핑"을 `missing`, 표식(11/15)은 포함. 짧은 모드 지시의 "광고·뉴스레터는 한 줄" 규칙대로 갱신 혜택만 쓴 결과다. 메인 확정 대기.

**비용·지연(실측)**: 10통 평균 1.63원(회차 2.11·1.15원). 합성 메일이 짧아 통당 평균 입력 1,289·출력 43 토큰이다. 12,000자를 넘는 d07은 입력 7,531 토큰 → 이 크기 10통이면 약 10.9원(§13 예상 10~20원 범위 안). 통당 모델 지연 p50 1,744ms, 10통 `digest` 전체 3.6~5.5초. 채점 호출 합계 92.21원(20회).

**② `count` 실호출**(`--part count --runs 3`, 9사례 × 3, chat `extractFilters` + 가드, 0.19.0 앱 intents): **19/27 — 미달**.

| 사례 | 일치 | 어긋난 칸 |
|---|---|---|
| n_three · n_five_sender · n_twelve · n_forty · n_none · n_latest | 3/3 씩 | — |
| n_vague | 1/3 | `count` null 3/3, `target_in_message` 2회 참(기대 false는 픽스처가 정한 값 — 스펙 ②는 `count` null만 적음) |
| n_after_detail | 0/3 | `count` 3·`target_in_message` 참은 맞음, `sender`에 맥락 발신자를 채움(3/3) |
| n_ambiguous | 0/3 | 모델이 `sender`를 비워(맥락 발신자 아님) 가드가 돌지 않아 `count` 3이 남음(3/3) — S7 Ruling의 측정 대상 |

지시문은 고치지 않았다(E2 지시: 미달이면 수치 그대로 보고). U4 판정은 메인.

**수정 라운드 1**(`727b23a`, 메인 판정 E2 Ruling ②): n_vague 기대에서 `target_in_message` 제거 · `MAIL_READ_COUNT_RULES` 셋째 줄 끝에 "통수만 말하고 발신자·제목을 말하지 않았으면 이전 대화의 발신자·제목 단어를 sender·subject_words 에 채우지 않는다" · `guardContextSender`가 모델 sender null 이어도 두 이름이면('X랑'은 다른 표지 이름과 함께일 때만) 대상 칸·`count`를 비움. 고정 해시 14단언(`stripCount` 뒤 0.18.x 바이트) 그대로.

| 사례 | 일치 | 어긋난 칸 |
|---|---|---|
| n_three · n_five_sender · n_twelve · n_forty · n_none · n_latest · n_vague | 3/3 씩 | — |
| n_after_detail | 0/3 | `sender`에 맥락 발신자를 여전히 채움(3/3) — 지시 한 줄로 바뀌지 않음 |
| n_ambiguous | 1/3 | 일치 1회 = 모델 sender null → 새 가드가 비움. 실패 2회 = 모델이 두 이름 중 하나("합성상점")를 sender 로 채우고 `count` 3 → 지금 글이 그 이름을 말하므로 가드가 첫 검사에서 돌아감(탐침 호출 2회로 확인) |

**② 22/27 — 미달**. 추가 수정 없이 멈춤(메인 판정). INTENT 회귀(`--mode both --base 0.18 --runs 4`, 22:08~22:51 KST): new_wrong 0 · pass true, 0.19.0 쪽 gate pass·gate_cases true(gates.md INTENT-0190 행).
