# ERURI — iOS 개인 비서 앱 설계 스펙

작성일: 2026-09-22 · 갱신: 2026-10-01 (보관 정책 계획 리뷰 반영 §8·§12·§16) · 2026-10-01 (보관 3년·요약 영구·용량 보호·채팅→보관함 보기, 사용자 결정 §16) · 2026-09-30 (1단계 범위 결정 반영, §16) · 2026-09-26 (AI 벤더 OpenAI 단일화) · 2026-09-24 (0단계 Task 1~7 실측 반영) · 상태: 초안(리뷰 대기) · 대상: iPhone 15 Pro 이상, iOS 26+, 한국

## 1. 목표

제품 이름은 **ERURI**(비서 앱). 홈 화면 표시 이름 `ERURI`, 0단계 PoC 빌드는 `ERURI PoC`.

메일·문자·앱 알림·공유한 이미지/URL/PDF·사용자 발화를 하나의 개인 컨텍스트로 모아,
(1) 일정·할 일을 뽑아 잠금화면 알림 버튼 한 번으로 캘린더/미리알림에 등록하고,
(2) "지난주 견적 메일", "에어팟 어디서 언제 샀지" 같은 질문에 출처와 함께 답한다.

제품 약속: **연결하거나 직접 저장한 정보만 기억한다.** 수집하지 않은 대화를 아는 것처럼 말하지 않는다. 모든 답변에 출처와 수집 시각을 붙인다.

### 우선순위 (사용자 확정)

1. 대화로 검색·질문 (구매 이력 포함)
2. 수신 즉시 제안 푸시 → 잠금화면에서 "추가"
3. 일정 메일 → 캘린더
4. 청첩장·행사 안내 이미지/URL/PDF → 캘린더

### 범위 밖

Outlook, Android, Mac 허브, 카카오톡 개인 대화 수집, App Store 공개 출시.

## 2. 확정 결정

| 항목 | 결정 | 근거 |
|---|---|---|
| 플랫폼 | iPhone 단독. iOS 26+, iPhone 15 Pro 이상 | 사용자 기기, Foundation Models 요건 |
| 사용자 | 1단계는 본인 전용. 지인 확대는 3단계(선행 조건 §15). 인증은 1단계부터 Sign in with Apple | Supabase Auth `signInWithIdToken(provider: .apple)` 검증됨. 모든 행이 `user_id`로 묶여 나중에 인증 수단을 바꾸면 identity 이전이 생긴다(2026-09-30) |
| 백엔드 | Supabase 무료 티어 (Postgres+pgvector, Auth, Edge Functions, Storage, pg_cron) | 서버리스 선호, RLS 기본 제공 |
| 지능 위치 | 서버 중심. 기기는 필터·수집·EventKit·푸시 수신 | 앱 재배포 없이 파이프라인 수정, API 키 서버 보관 |
| 메일 | Gmail만. 초기 백필 3개월. `-category:promotions` 제외. Outlook은 만들지 않음 | 사용자 확정, Codex 리뷰 반영 |
| 문자 | Shortcuts **Message 트리거** → App Intent. 무확인 자동 실행 검증됨. 원문 전체 수신, 실행마다 "자동화 실행" 배너(2026-10-01 앱별 분리, §5) | Apple 문서 "run automatically" 목록에 Message 포함 |
| 앱 알림 | Shortcuts **Notification 트리거** → App Intent. 카카오톡·Instagram·쇼핑/금융 앱(**메시지 앱 제외**, 본문 약 255자 잘림) | **확인 배너 탭 필요 가능성 높음** (§3) |
| 공유 | Share Extension: 텍스트·URL·이미지·PDF | 사용자 확정 |
| 일정 등록 | 항상 확인 후. 알림 액션 버튼(`authenticationRequired`)으로 추가 | 사용자 확정 |
| 실행 권한 | Apple 캘린더 추가·수정, 미리알림 추가·완료 | 사용자 확정 |
| 기억 | 채팅·Siri·빠른 기억에서 사용자가 한 모든 말을 저장·검색 | 사용자 확정 |
| 제외 | OTP·인증번호, 카드·계좌번호 마스킹, 프로모션, 카톡 개인 대화, 의료 결과지 본문 | 사용자 확정 + 제안 |
| 보관 | 원문(사용자별 키 암호화)·검색 청크 **3년**, 이미지 파일 30일, 항목별 **요약 영구**(사용자 키 암호화, 원문 삭제 뒤 검색 대상), 추출 사실 무기한. DB 용량이 한도에 가까워지면 오래된 원문·청크 → 오래된 요약 순으로 비운다(§8 용량 보호) | 사용자 확정(1년) → 개인정보 검토로 90일 단축 → **2026-10-01 사용자 결정으로 3년 + 요약 영구 + 용량 보호**(§16). 청크 평문 기간은 사용자 확인 대기(§16 UC-1) |
| 진입점 | 채팅, Share, 푸시, Siri 질문, 액션버튼/컨트롤센터 빠른 기억 | 사용자 확정 |
| 비용 | 월 1만원. 기기 Foundation Models → 서버 분류 게이트 Jev → OpenAI `gpt-6-luna` 추출 → `gpt-6-sol` 채팅 | 사용자 확정. 벤더는 2026-09-26 Anthropic+Voyage → OpenAI 단일로 교체(사용자 결정) |
| AI 벤더 | OpenAI 단일. 키 `OPENAI_API_KEY` 하나. Responses API(`/v1/responses`) + Structured Outputs(`text.format` json_schema, `strict: true`), 모든 호출 `store: false`. 분류 게이트(0b)는 TypeSafe Jev(jev-1.13.0, 키 JEV_API_KEY) 추가 — 2026-09-29 사용자 결정(평가 리포트 확인 후). OpenAI 소형 모델은 같은 인터페이스의 교체 후보로만 | 키·약관·청구 한 곳. §3 검증 표 |
| 임베딩 | OpenAI `text-embedding-3-large`, `dimensions: 512` (2026-09-27 결정) | Supabase 내장 gte-small은 영어 전용. PoC-7 합성 평가 하이브리드 Top-5가 large 38/40 vs small 31~33/40이고, 1인 사용량에서 가격 차이(1M 토큰당 $0.13 vs $0.02)는 월 수십 원 수준. `vector(512)` 스키마 유지, HNSW 2000차원 한도 안 |

## 3. 공식 문서 검증 결과 (2026-09-22)

설계의 전제를 Apple·Google·Supabase 공식 문서로 검증했다. 설계를 바꾼 항목만 적는다.

| 전제 | 판정 | 설계 반영 |
|---|---|---|
| Notification 트리거가 무확인 자동 실행된다 | **미확인, 부정적.** 지원 문서의 "자동 실행 가능" 트리거 목록(Time, Alarm, Message, Transaction, App 등)에 Notification 없음. 단, 목록 부재가 곧 확인 필수를 뜻하진 않음 | 기본 설계는 "배너 탭 1회" UX. 트리거 필터(제목·본문 키워드)로 탭 횟수 최소화. PoC-1에서 OS 버전별 확인 여부·본문 전달을 각각 판정 |
| Notification/Message 트리거가 본문을 Shortcut Input으로 넘긴다 | **미확인.** 문서에 입력 데이터 명세 없음 | PoC-1·PoC-2 필수 |
| Foundation Models를 App Intents extension에서 쓸 수 있다 | **미확인.** 문서 없음. 확장 메모리 "현저히 낮음" | Capture 인텐트를 **메인 앱 타깃**에 두고 `supportedModes = .background`로 실행. 확장 사용 안 함 |
| Foundation Models 한국어 | 검증됨. 컨텍스트 4,096토큰, 한국어 1자=1토큰 | 알림 텍스트 분류에 충분 |
| App Intent 잠금 상태 실행 | 검증됨. `authenticationPolicy` 기본 `.alwaysAllowed` | 잠금 중 수집 가능. 단 로컬 DB는 `.completeUntilFirstUserAuthentication` 보호 등급 |
| 알림 액션 → 앱 백그라운드 실행 | 검증됨 | 액션에 `authenticationRequired` 지정 후 EventKit 쓰기. EventKit 백그라운드 쓰기 자체는 문서 없음 → PoC-5 |
| Gmail 테스트 모드 | 검증됨. 테스트 사용자 100명, **동의 7일 후 만료** | 본인 사용 중엔 7일마다 재연결. 지인 확대 전 앱 검증 + CASA(추정 $500~4,500, 2~6주) 결정 |
| Gmail 쿼터 | 검증됨. **분당** 사용자 6,000 유닛 (`messages.get` 20) | 백필 배치 분당 250건 이하 |
| Gmail watch | 검증됨. 7일 내 갱신, historyId 404 시 전체 재동기화 | pg_cron 일 1회 watch 갱신. 404 시 마지막 성공 커서 시각부터 `messages.list(after:)`로 재동기화 (§7) |
| Supabase gte-small 임베딩 | 검증됨, 그러나 **영어 전용** | OpenAI 임베딩으로 교체. PoC-7 결과 `text-embedding-3-large`(`dimensions: 512`) 채택(2026-09-27, §2) |
| OpenAI 모델·가격 (2026-09-26, developers.openai.com/api/docs/pricing · /api/docs/models/gpt-6-luna · /api/docs/models/gpt-6-sol) | 검증됨. `gpt-6-luna` $0.10/$0.01(캐시)/$0.50, `gpt-6-sol` $2.00/$0.20/$10.00 (1M 토큰 입력/캐시 입력/출력). 둘 다 Responses·Chat Completions, Structured Outputs, 이미지 입력, reasoning effort `none`~`max`(기본 `medium`) 지원. 스냅샷은 별칭과 같은 ID 하나뿐 | 추출 `gpt-6-luna`(effort `none`, 분류는 2026-09-29부터 Jev 게이트 §7), 채팅 `gpt-6-sol`(effort `low`). `gpt-6-astra`는 `none` 미지원·$10/$50이라 제외 |
| Structured Outputs (2026-09-26, /api/docs/guides/structured-outputs) | 검증됨. Responses API 권장, `text: { format: { type: "json_schema", name, schema, strict: true } }`. strict는 모든 객체 `additionalProperties: false`, 모든 필드 `required`, nullable은 `["string","null"]`, `pattern`·`default` 미지원. 거절은 `refusal` 콘텐츠, 잘림은 `status = incomplete` | 스키마는 strict 규칙으로 작성. 거절·잘림은 파싱하지 않고 잡 실패 처리 |
| 이미지·PDF 입력 (2026-09-26, /api/docs/guides/images-vision · /api/docs/guides/pdf-files) | 검증됨. `input_image`(data URL, PNG·JPEG·WEBP·GIF), `input_file`(`file_data` data URL, 파일당 50MB). PDF는 텍스트+페이지 이미지로 처리 | PoC-8 vision을 같은 모델로. 스펙 PDF 상한(10MB·50페이지)이 더 좁아 그대로 둔다 |
| OpenAI 임베딩 (2026-09-26, /api/docs/guides/embeddings · /api/docs/models/text-embedding-3-small · /api/reference/resources/embeddings/methods/create) | 검증됨. 기본 1536차원, `dimensions`로 축소(3세대 모델만), 출력 길이 1 정규화, 입력당 8,192토큰·요청당 30만 토큰·배열 2,048개, $0.02/1M. **한국어·다국어 성능 수치는 공식 문서에 없음** | `dimensions: 512`로 기존 `vector(512)` 유지. PoC-7(2026-09-27, 합성 500건) 하이브리드 Top-5 small 31~33/40, large 38/40 → **`text-embedding-3-large`(`dimensions: 512`, $0.13/1M) 채택** |
| OpenAI API 데이터 정책 (2026-09-26, /api/docs/guides/your-data) | 검증됨. API 입력은 기본 학습 미사용(2023-03-01부터, 옵트인 시에만). 남용 모니터링 로그 최대 30일. Responses API는 `store` 기본값으로 애플리케이션 상태 30일 보관. ZDR·수정 남용 모니터링은 OpenAI 사전 승인 필요. `/v1/responses`·`/v1/embeddings` 모두 ZDR 대상. 이미지는 CSAM 분류기 탐지 시 ZDR이어도 보관 | §12 통제 3 갱신, 임베딩 약관 보류 해제(§16). 모든 Responses 호출에 `store: false` |
| Deno에서 OpenAI SDK (2026-09-26, github.com/openai/openai-node) | 검증됨. Deno 1.28+ 지원, `import OpenAI from "npm:openai"`. 기본 타임아웃 10분·재시도 2회(`timeout`·`maxRetries` 옵션). 현재 npm 최신 7.23.0 | `npm:openai@7`, Edge 벽시계 150초에 맞춰 `timeout: 60_000`, `maxRetries: 1` |
| Edge Function에서 APNs HTTP/2 (0단계 실측 2026-09-27) | **h2 동작 확인.** sandbox에 가짜 토큰으로 `400 BadDeviceToken` + `apns-id`(APNs는 HTTP/1.1을 연결 단계에서 거부), Edge 서울 100회 동시 1 → 100/100 p50 419ms. 동시 10은 가짜 토큰 탓 `GOAWAY` 오류가 섞여 실기기 토큰으로 재확인 대기 | Edge에서 직접 발송. JWT는 in-flight 공유 + 30분 경계 iat(동시 생성 시 `429 TooManyProviderTokenUpdates`), 연결 오류(`GOAWAY`) 1회 재시도. Cloudflare Worker 릴레이는 불필요(실기기 토큰 동시 10 × 2 → 100/100·h2 오류 0, 2026-09-30 PoC-4 통과) |
| Supabase Storage TTL | 없음 | pg_cron 삭제 잡 |
| Supabase DB 크기 한도 (2026-10-01, supabase.com/docs/guides/platform/database-size) | 검증됨. 크기는 `pg_database_size()` 합(클러스터의 모든 DB)으로 잰다. **무료 플랜은 500MB를 넘으면 읽기 전용**이 된다. 행을 지워도 Postgres가 공간을 바로 돌려주지 않아 보고 크기는 줄지 않는다(`VACUUM FULL`은 테이블 잠금) | §8 용량 보호: 측정은 같은 합, 판정은 재사용 가능 공간을 뺀 유효 크기, 비우기는 읽기 전용 전(85%)에 시작. Pro 플랜 디스크 포함량은 이 문서에 없음(가격표 확인 필요) |
| Edge Function 한계 | 검증됨. CPU 2초, 벽시계 150초(무료), 256MB | `waitUntil`은 큐가 아님. `jobs` 테이블 기반 영속 작업 큐 + pg_cron 워커 호출로 처리 (§7) |
| 무료 프로젝트 | 1주 미사용 시 일시정지 | pg_cron 일일 잡이 활동 유지. 지인 확대 시 Pro |

## 4. 아키텍처

```text
Gmail ── OAuth(serverAuthCode) ── Pub/Sub push ──────────────────► Edge: gmail-webhook
                                                                      │
iPhone                                                                │
  App (SwiftUI)                                                       │
   ├ CaptureIntent   ← Shortcuts Message/Notification 트리거           │
   ├ AskIntent       ← Siri                                           │
   ├ QuickMemoryIntent ← 액션버튼/컨트롤센터(OpenIntent)               │
   ├ Share Extension ← 텍스트/URL/이미지/PDF                           │
   ├ 알림 액션 핸들러 → EventKit 쓰기                                  │
   └ 채팅·보관함·설정                                                  │
        │  기기 필터(규칙 + Foundation Models)                         │
        ▼                                                             │
  App Group SQLite 큐 ── background URLSession ──► Edge: ingest ◄──────┘
                                                        │
                                          Postgres: items, facts, proposals,
                                          memories, chunks(pgvector) (purchases는 2단계)
                                                        │
                                   Edge: worker (Jev 분류 게이트, gpt-6-luna 추출, OpenAI 임베딩)
                                                        │
                                   Edge: notify (APNs) ──► 잠금화면 제안 알림
                                                        │
                                   Edge: chat (하이브리드 검색 + gpt-6-sol)
```

### 책임

- **기기**: 권한, 수집, 기기 필터, 오프라인 큐, EventKit 읽기·쓰기, 푸시 표시·액션, 설정 가이드.
- **서버**: Gmail 동기화, 분류 게이트(Jev), 추출, 임베딩, 제안 생성, 푸시 발송, 채팅 검색·답변, 보관 정리.
- **공통**: 요청 ID 멱등, 출처·시각·상태 기록. 서버는 클라이언트가 보낸 user_id를 믿지 않고 JWT에서 결정.

## 5. 수집 경로

| 경로 | 트리거 | 자동화 수준 | 전달 데이터(가정) | 한계 |
|---|---|---|---|---|
| Gmail | Pub/Sub → history.list | 완전 자동, 폰 꺼져도 | 전체 메일 | 테스트 모드 7일 재인증 |
| 문자(SMS/iMessage) | **자동화 ① 메시지 트리거**(조건 "메시지에 다음을 포함" 공백 한 칸 — iOS가 조건을 요구, 즉시 실행) → CaptureIntent(본문=단축어 입력의 내용, 출처=`MESSAGES`, 보낸 사람=발신자) | 무확인 자동(PoC-2 실측). 실행마다 시스템 "자동화 실행" 배너가 뜨고 끌 수 없다(**감수**) | 발신자·**원문 전체**(708자 장문 도착 실측, 2026-10-01 08:11:41Z) | 띄어쓰기 없는 짧은 문자("네" 등)는 조건에 안 걸려 미수집(**감수**). 과거 이력 불가 |
| 카카오톡·Slack·Instagram·쇼핑/금융 등 메시지 앱 외 | **자동화 ② 알림 트리거**(Notification, 앱 다중 선택, **메시지 앱 제외**) → CaptureIntent | 무확인 자동(PoC-1 실측, 배너 탭 없음) | 앱 이름·제목·본문. 본문은 iOS가 **약 255자로 자른다**(251자 실측) | 알림이 표시되지 않으면 누락 — 집중 모드·묶음 알림(감수). 미리보기 꺼지면 본문 없음. 과거 이력 불가 |
| 공유 | Share Extension | 사용자 선택 | NSItemProvider 실제 타입 | 로그인 필요한 URL 본문은 못 받음 |
| 채팅·Siri·빠른 기억 | AskIntent / QuickMemoryIntent | 사용자 입력 | 텍스트 | — |
| Calendar/Reminders | EventKit 전체 접근 | 앱 실행·복귀 시 대조 | 기기 캘린더 | 서버 직접 접근 불가 |

### 알림 트리거 설정 가이드 (제품의 일부)

**2026-10-01 사용자 결정: 수집 자동화는 2개, 앱별로 나눈다**(2026-09-28 "알림 1개" 결정을 대체, §16 "2026-10-01 수집 자동화 앱별 분리"). ① 문자는 메시지 트리거(조건 "메시지에 다음을 포함" 공백 한 칸, 즉시 실행)로 원문 전체를 받는다. ② 그 밖의 앱은 알림 트리거로 받고 **앱 선택에서 메시지 앱을 뺀다** — 앱별로 나눠 받으므로 같은 문자가 두 경로로 오지 않고 서버 중복 제거가 필요 없다. 메시지 트리거는 실행마다 시스템 "자동화 실행" 배너를 띄우며 끌 수 없다(iOS 26에 "실행 시 알림" 옵션이 없고, 설정 → 알림에 단축어 항목이 없다 — 사용자 확인). 앱 안에 "자동화 설치" 화면을 둔다(2단계). 앱별로 권장 필터를 제시하고, 단축어 앱을 열어 자동화를 만드는 단계를 스크린샷으로 안내한다.

1단계는 알림 자동화 경로를 **이관**만 한다(2026-09-30): `EruriCore`의 CaptureIntent·규칙 필터·FM 분류·큐·업로더를 제품 앱 타깃에 그대로 싣는다. 자동화는 앱의 인텐트에 묶이므로 번들이 바뀌면 사용자가 기존 HTML 가이드(`2026-09-27-shortcuts-setup-guide.html`)로 자동화를 새 앱으로 한 번 다시 만든다(2026-10-01부터 2개).

| 앱 | 권장 필터 | 목적 |
|---|---|---|
| 메시지 (메시지 트리거) | 문구: 공백 한 칸(전체 수신, 필터는 기기 규칙·FM이 맡는다) | 문자 원문 전체 |
| 카카오톡 | 문구: 주문, 배송, 예약, 결제, 출발 | 알림톡만 |
| Instagram | 제목: "님이 메시지를 보냈습니다" | DM 도착 사실만 |
| 쿠팡·네이버·은행 | 문구: 주문, 결제, 승인 | 구매 이력 |

## 6. 기기 파이프라인

```text
CaptureIntent(text = "", appName?, title?, sender?, source)
    supportedModes = .background, authenticationPolicy = .alwaysAllowed, 메인 앱 타깃
    text 기본값 "": 미리보기 꺼짐으로 본문이 비어 와도 단축어가 값을 묻지 않고 실행된다
  1. 규칙 필터 (동기, <10ms). text와 title 모두에 적용. 세부 규칙은 아래 "기기 규칙 필터"
     - 연락처 발신자 → 폐기 (카톡 개인 대화 배제)
     - OTP → 폐기. 본문은 남기지 않고 사유 코드(otp)만 기록
     - 카드번호·계좌번호 → 숫자 마지막 4자리만 남기고 마스킹
  2. Foundation Models 분류 (가능 시, 타임아웃 3초). 세부는 아래 "Foundation Models 분류"
     notice → 통과 (device_filter = "fm")
     personal/otp/promo/medical_result → 폐기 (사유 fm:<kind>)
     타임아웃·생성 에러 → 출처와 무관하게 kind = unknown, device_filter = "rules"로 통과 → 서버 분류 게이트(Jev, §7)에 맡긴다
       (0.2.3: 인텐트 프로세스의 FM 콜드 로드가 3초를 넘는 것이 상수이고, 백그라운드 `rateLimited`·에셋 오류도
        건별로 날 수 있어 폐기하면 채팅 앱 항목이 유실된다. 개인 대화 배제는 서버 Jev 게이트(§7)가 담당)
     불가(availability ≠ available) → 폴백:
       카카오톡·Instagram 출처는 **폐기** (Apple Intelligence가 꺼진 기기는 기기 쪽 방어선이 아예 없으므로 개인 대화 배제 원칙이 우선)
       그 외(메시지·쇼핑/금융 앱)는 kind = unknown, device_filter = "rules"로 통과 → 서버 분류 게이트(Jev, §7)에 맡긴다
  3. App Group SQLite 큐에 저장 (보호 등급 completeUntilFirstUserAuthentication, WAL + busy_timeout. 아래 "큐")
  4. 인텐트가 깨어 있는 동안 바로 POST /ingest(직접 요청, 타임아웃 8초) → 응답이 없으면 background URLSession
     (sharedContainerIdentifier, App Group outbox/ 파일 업로드)로 넘긴다. 보낼 항목은 claim(lease)으로 가져온다 (아래 "업로더").
     보조: 무음 푸시(content-available)·BGAppRefreshTask가 앱을 깨우면 같은 flush를 탄다 (0.2.0)
  5. 성공 시 큐 삭제, 실패 시 지수 재시도(30초 × 2^n, 상한 1시간). 앱 강제 종료 시 백그라운드 전송이 취소되므로
     앱 실행·복귀 시 큐를 다시 스캔해 재전송한다. "24시간 내"는 목표이지 보장이 아니다.
```

### 기기 규칙 필터 (0단계 Task 2 실측 반영, 2026-09-24)

서버 규칙 필터(§7)도 연락처 규칙을 뺀 같은 규칙을 쓴다. 적용 순서는 연락처 → OTP → 카드 → 계좌다. OTP 판정은 제목과 본문을 합친 문자열로 한다(키워드가 제목, 숫자가 본문에 있어도 폐기). 카드·계좌 마스킹은 제목·본문 각각에 적용하고, 마스킹된 제목이 FM 입력과 큐에 들어간다.

| 규칙 | 판정 | 근거 |
|---|---|---|
| 연락처 | 앱이 실행·포그라운드 복귀 때 CNContactStore에서 이름 목록을 읽어 App Group `contacts.json`에 캐시한다(이름만). 권한은 앱의 "권한 요청 (알림·캘린더·연락처)" 버튼에서 받고, 미허용이면 빈 목록을 캐시한다. 인텐트는 캐시만 읽는다. `sender`와 카톡처럼 발신자가 `title`에 오는 경우 모두 비교하고, **모든 공백을 지우고 끝의 호칭 "님"·"씨"를 뗀 뒤** 비교한다. 폐기 사유는 `contact` | 인텐트는 백그라운드 실행이라 매번 연락처 전체를 읽지 않는다 |
| OTP 키워드 | 인증번호·인증 코드·보안번호·승인번호·확인번호(`(인증\|보안\|승인\|확인)\s*(번호\|코드)`), verification·verify·passcode·one-time, 영문 `code`·`OTP` | 실측에서 "인증코드", "login code", "verify"가 새어 나갔다 |
| OTP 영문 경계 | `code`·`OTP`는 앞뒤가 영문자가 아닐 때만 키워드로 본다. `\b`는 ICU가 한글도 단어 문자로 보아 `OTP번호`를 놓치므로 쓰지 않는다 | "Hotpot 예약"이 `otp`로 폐기됐다 |
| OTP 숫자 | 4~8자리 또는 3-3 분리(`123-456`). 날짜·시각·금액 형태(`2026년`, `15:00`, `9/25`, `32,000원`)와 소수·점 날짜(`1234.5`, `2026.10.02`, `2026. 10. 2.`)는 제외. 숫자 바로 뒤 마침표는 소수(`1234.5`)·점 날짜(`2026. 10.`)가 이어질 때만 제외한다 — 문장 끝 마침표(`code is 603918.`, `482913. 3분 내`)는 OTP 숫자다(0b). 대괄호(`[482913]`)·괄호는 OTP 숫자로 본다. 영문 날짜의 연도(`Oct 3, 2026.` — `숫자,`와 공백 0~1칸 뒤의 19xx·20xx 네 자리)는 제외한다(0b 최종 리뷰) | 연도 숫자로 예약 안내가 폐기됐다; 0b: 문장 끝 마침표 앞 OTP가 서버·기기 규칙을 통과(Jev 평가 o02); 그 수정 뒤 `Use code SAVE10 by Dec 31, 2026.`이 `otp`로 폐기(서버 폐기는 되돌릴 수 없음) |
| OTP 창 | 키워드 **앞뒤 30자 안에** 숫자가 있을 때만 폐기한다. 문장 전체의 동시 출현이 아니다 | "인증번호는 타인에게 알리지 마세요… 문의 1588" 같은 안내문 오탐 |
| 승인번호 예외 | "승인번호/승인코드" + 결제 문맥(`N원`·금액·결제·승인취소·일시불·할부·누적)이면 폐기하지 않고, 키워드 뒤 첫 숫자(승인번호)만 전부 `*`로 가린 뒤 통과한다. 결제 문맥이 없으면 OTP로 폐기 | 카드 승인 문자는 구매 이력(§5) 수집 대상이다 |
| OTP 알려진 한계 | "예약 확인번호 58213" 같은 병원·식당 예약 안내는 `확인번호`+숫자로 **폐기된다**. 영숫자 OTP(`A1B2C3`)는 규칙으로 못 잡고 FM `otp`에 맡긴다 | `확인번호`를 OTP로 쓰는 문자가 있어 키워드에서 빼면 OTP가 샌다. 2단계에서 사유 코드 통계를 보고 재검토한다 |
| 카드 | 형식을 고정한다: 4-4-4-(1~7), 아멕스 4-6-5(한 번호 안에서 같은 구분자, 공백·점·하이픈), 또는 연속 13~19자리. 숫자 13~19개이고 Luhn을 통과할 때만 마스킹. 구분자는 유지 | **날짜 접두 케이스**: 이전 정규식은 `09-24 4111-…`, `2026-09-24 4111-…`의 날짜까지 한 매치로 삼켜 Luhn 실패 → 카드번호가 평문으로 남았다 |
| 계좌 후보 | 하이픈형: 2~6자리 그룹 3~4개, 숫자 합 10~14자리. 연속형: 10~16자리(15~16자리 가상계좌 포함). 한 문장의 후보를 모두 각각 검사 | 한국 계좌는 대부분 하이픈 표기인데 이전 규칙은 연속형만, 첫 매치만 잡았다 |
| 계좌 키워드 | 후보 **앞뒤 20자 안에** 은행·뱅크·계좌·예금주·입금·농협·신협·수협·우체국·새마을금고·주요 은행명(신한·국민·기업·IBK·KB·NH·SC제일·씨티) | "카카오뱅크", "3333… (신한은행)"처럼 키워드가 뒤에 오거나 "뱅크"인 경우를 놓쳤다 |
| 계좌 처리 | 숫자만 마지막 4자리를 남기고 `*`, 하이픈 유지. 가상계좌 입금 안내는 **마스킹 후 통과**한다. 키워드가 없는 숫자(운송장 등)와 하이픈형 14자리 초과는 그대로 둔다 | 입금 안내는 결제 정보라 버리지 않는다 |

### Foundation Models 분류 (0단계 Task 5 실측 반영, 2026-09-24)

- **호출마다 새 `LanguageModelSession`**을 만든다. 세션은 모든 프롬프트·응답을 transcript에 누적해 4,096토큰을 넘으면 `exceededContextWindowSize`를 던지고, 앞선 분류가 뒤 판단을 오염시킨다. 같은 세션에 동시 요청을 넣으면 `concurrentRequests`가 난다. actor 메서드의 `await`는 재진입 지점이라 actor로는 직렬화되지 않는다(초안의 "actor 직렬화" 전제 삭제).
- 입력은 앱 이름·제목·본문(본문 1,500자에서 절단). 제목은 카톡 채널명과 사람 이름을 가르는 가장 강한 신호다.
- 출력 `kind`는 `@Generable enum`이다. 문자열이면 스키마 밖 값("공지")이 나와 조용히 폐기되므로 쓰지 않는다.
- 타임아웃 3초는 `respond`의 취소 협조 여부와 무관하게 그 시점에 반환한다(응답·타이머 중 먼저 끝난 쪽이 결과를 정한다). `withThrowingTaskGroup`은 남은 자식 태스크를 기다리므로 쓰지 않는다.
- 실측(실기기 0.2.1/0.2.2, 2026-09-29, 인텐트 13건): 콜드 로드 3.07~3.22초로 11건이 3초 타임아웃, 웜 상태 2건만 1.7~1.8초로 `queued:fm`. 잠금 여부와 무관하다. 그래서 타임아웃은 출처와 무관하게 `rules`로 통과시킨다(0.2.3, 위 2단계).
- 생성 에러(`rateLimited`, `guardrailViolation`, `assetsUnavailable`, `decodingFailure` 등)도 타임아웃과 같이 출처와 무관하게 `rules`로 통과한다(0.2.3 빌드 2). 불가(`availability()`≠available)만 채팅 앱 폐기 폴백(위 2단계)을 탄다. 에러가 인텐트 실패로 전파되지 않는다. 로그에는 에러 종류 코드만 남긴다.
- **`availability()`가 `available`이어도 `respond()`가 에셋 오류를 낼 수 있다**(시뮬레이터에서 실측, §16). 그래서 가용성 판정(벤치마크 실행 여부, 설정 화면의 FM 상태 표시)은 짧은 합성 문장 1건을 먼저 호출하는 사전 점검 결과로 한다. 인텐트 경로는 건별 에러를 폴백으로 흡수하므로 사전 점검 없이도 안전하다.
- `rateLimited`는 앱이 백그라운드에서 시스템 한도를 넘을 때만 난다. `.background` 인텐트가 바로 그 경로다. 0.2.3부터 에러는 `rules`로 통과해 유실이 없으므로 빈도는 판정 게이트가 아니고 제품 `device_traces`(§8)로 지켜본다(PoC-3은 2026-09-30 실패(대안 채택)로 마감, §14).
- 폴백 여부는 큐 항목의 `device_filter`("fm" 또는 "rules")로 서버에 전달된다.
- 서버 분류 게이트(Jev, §7)가 생겨도 기기 FM 분류는 유지한다. 개인 대화·광고를 기기에서 먼저 걸러 서버·외부 공급자로 가는 원문을 줄이는
  **개인정보 방어선**이다(2026-09-29 사용자 결정, 대체 아님)

**분류 라벨 정의** (기기 FM 라벨. 서버 분류 게이트 Jev(§7)는 이 표를 바탕으로 한 6종을 쓴다 — 아래)

| 라벨 | 뜻 | 경계 사례 |
|---|---|---|
| `notice` | 기업·기관·봇의 정형 안내: 주문·배송·예약·결제·병원 예약 | 검진 **예약·준비물** 안내("내일 검진 8시간 금식")는 notice |
| `personal` | 사람이 쓴 대화. 키워드가 들어 있어도 personal | "예약했어?" |
| `otp` | 인증번호 | — |
| `promo` | 광고 | — |
| `medical_result` | 검사·검진 결과와 진단 내용 | 검사 **결과가 나왔다는** 안내("건강검진 결과가 준비되었습니다")도 medical_result로 폐기한다. 결과 안내만으로 검진 사실과 기관이 드러나 의료 결과지 제외 원칙(§2)에 가깝다 |

서버 Jev 게이트 라벨(1단계, 2026-09-30 결정): `actionable` · `notice` · `personal` · `promo` · `otp` · `medical_result` **6종**(0b의 5종에 `medical_result` 추가). 정의 원본은 `_shared/classify.ts` `LABEL_CRITERIA`다. `otp`·`promo`·`medical_result` 경계는 위 표와 같다. 기기의 `notice`는 Jev에서 `actionable`(일정·예약·주문·결제·배송·기한 등 행동이나 기록이 필요한 것)과 `notice`(행동이 필요 없는 안내)로 나뉘고, 기기의 `personal` 중 날짜·장소를 정하거나 할 일을 부탁하는 대화는 Jev에서 `actionable`이다. `medical_result`를 더하는 이유: 기기 FM이 타임아웃이면 "검진 결과가 준비되었습니다"가 `rules`로 서버에 오는데 5종에는 해당 라벨이 없어 `notice`로 통과·저장된다. 재평가(M1-④a, 2026-09-30, 합성 60 + 의료 10): t=0.8 actionable 유실 0, 의료 ≥0.8 폐기 10/10(6라벨 70/70, p50/p95 210/289ms) → 6종 채택(`supabase/eval/jev-results-6label.json`).

### 큐 (0단계 Task 3 실측 반영)

- 앱(인텐트·업로더 콜백)과 Share Extension이 같은 `queue.sqlite`를 서로 다른 프로세스·연결로 동시에 쓴다. 기본 롤백 저널에 busy handler가 없으면 겹치는 쓰기가 즉시 `SQLITE_BUSY`로 실패해 캡처가 유실된다. **실측: 두 연결에서 동시 enqueue 200건 중 162건 유실.**
- 해결: 연결을 열 때 `busy_timeout` 3초, `journal_mode=WAL`, `synchronous=NORMAL`. 수정 후 같은 테스트에서 200건 모두 남는다. WAL의 `-wal`·`-shm` 파일도 컨테이너 기본 보호 등급(completeUntilFirstUserAuthentication)을 따른다.
- 읽기 중 step 오류는 빈 큐로 삼키지 않고 오류로 올린다. 디코딩할 수 없는 행(poison row)은 건너뛰어 큐 전체를 막지 않는다. 순서는 `created_at, rowid`.

### 업로더 (0단계 Task 7 실측 반영)

- 중복 업로드 방지: 보낼 항목은 `claim(limit:)`으로 가져온다. 단일 `UPDATE … RETURNING`이 `next_attempt_at = now + 600초`(lease)를 걸면서 행을 반환하므로 연결·프로세스 사이에서도 원자적이다. 앱 시작과 `scenePhase == .active`가 연달아 flush해도 같은 항목을 두 번 올리지 않는다.
- 완료 콜백은 `markSent`(삭제), 실패 콜백은 `markFailed`(attempts+1, lease를 백오프 시각으로 덮어씀)로 lease를 끝낸다. 콜백 없이 lease가 만료된 항목(앱 강제 종료로 전송 취소)은 다음 flush가 다시 가져간다.
- 그래서 "보냈는데 콜백을 못 받은" 항목은 두 번 갈 수 있다. 서버 `/ingest`는 기기 항목의 `external_id`로 큐 항목 `id`(UUID)를 받아 멱등 키(§7)로 중복을 막는다.
- 전송 경로(0.2.0, 실기기 09-28 "잠금 중 도착이 해제·앱 열기까지 밀림" 대응): flush 트리거는 `intent`·`silent_push`·`bg_refresh`·`foreground` 넷이다. 각 트리거는 먼저 프로세스 안 직접 요청을 보내고, 네트워크 오류·타임아웃일 때만 background 세션에 넘긴다. 백그라운드에서 시작한 background 세션 전송은 iOS가 discretionary로 다뤄 늦어질 수 있어서다. HTTP 오류 응답은 넘기지 않고 `markFailed`로 백오프한다. 넘긴 전송은 앱이 없어도 iOS가 끝내고, `handleEventsForBackgroundURLSession`으로 앱을 깨워 완료 콜백을 전달한다. 인텐트 뒤 남은 항목이 있으면 BGAppRefreshTask(`com.picpal.assistant.poc.refresh`, 최소 15분)를 예약하고, 실행될 때마다 다시 예약한다. 무음 푸시는 `apns-send`의 `silent:true`(priority 5, `apns-push-type: background`)로 보낸다. 주기 발송(cron)은 아직 정하지 않았다.
- PoC trace `poc9.upload_done.path`: `intent_direct`(인텐트 실행 중 직접 요청 완료) · `bg_upload`(인텐트가 background 세션에 넘긴 전송) · `silent_push` · `bg_refresh` · `foreground`. `via`(direct/bg_session), `age_ms`(캡처→완료), `intent_locked`(인텐트 시작 시점 잠금)를 함께 남긴다. 잠금 판정(0.2.1)은 `.complete` 보호 파일 읽기 결과다: 읽힘 = false, 권한 거부 = true, 파일 없음·기타 오류 = null(`lock_state=unknown`). `UIApplication.isProtectedDataAvailable`는 백그라운드로 깨어난 프로세스에서 잠금 중에도 true로 찍혀 `locked=false`가 되므로(09-29 관찰) `locked_app`에 비교용으로만 남긴다. 잠금 후 약 10초 유예 구간은 잠금 해제로 보인다(한계)
- PoC trace 멱등(0b, 서버): `ingest/trace`는 `(user_id, device_id, event, at)`가 같은 행을 무시하고 `202 {inserted, duplicates}`를 준다(0015).
  기기 `at`은 ms 정밀도라 같은 기기·같은 이벤트가 같은 ms에 두 번 나지 않는다. 09-29 앱 열기 때의 전체 재업로드 같은 중복이 판정 집계를 부풀리지 않게 한다
- PoC trace 업로드(0b, 기기 0.2.1): 캡처와 같이 **직접 요청 우선**(8초). 2xx면 즉시 큐에서 지우고, HTTP 오류는 백오프, 응답이 없을 때만
  background 세션에 넘긴다. 넘긴 배치가 아직 끝나지 않았으면(`URLSession.allTasks`의 `trace:` 태스크) 그 id들의 lease를 늘려 다시 claim하지 않고,
  같은 프로세스의 동시 flush는 한 번만 돈다. 09-29 결함: background 세션으로만 올려 완료 콜백 전에 lease(600초)가 끝나 앱 열기 때 전부 재업로드
- 서버 멱등: 같은 `source:id` 재수신은 200 + 기존 `item_id`(`duplicate:true`). 기기는 2xx면 큐에서 지우므로 직접 요청이 타임아웃된 뒤 background 세션이 다시 보내도 실패로 남지 않는다.
- 업로드 서버 주소는 App Group `UserDefaults`(`group.com.picpal.assistant`) 키 `ingestURL`에 저장하고 앱 화면에서 바꾼다. PoC 앱은 저장값이 없을 때만 스킴 환경변수 `INGEST_URL`을 초기값으로 쓰고, 둘 다 없으면 `http://localhost:8787`이다. 홈 화면에서 다시 열어도 저장값이 유지된다.

Share Extension은 공유 1회에 들어온 텍스트 표현(`attributedContentText`, 첨부 plain-text, URL)을 모두 모아 서로 포함된 조각은 버리고 줄바꿈으로 이어 **큐 항목 1개**로 만든다(0.3.1, 실기기에서 메모 앱 공유 본문이 10자만 잡힌 결함 수정). 확장 메모리 한도(약 120MB) 때문에 표현 하나는 읽기 전에 앞 64KiB(UTF-8)까지만 읽고, 합친 본문은 65,536자에서 자른다. 잘리면 trace `share.received`의 `parts`에 `:truncated`(합친 본문은 `out:truncated`)로 남긴다. 그다음 규칙 단계만 적용하고 큐에 넣는다(텍스트·URL 문자열과 이미지 OCR 텍스트 모두). OTP로 폐기되면 큐에 넣지 않고 **파일도 App Group에 저장하지 않는다**. 그래서 이미지는 확장의 임시 복사본에서 OCR을 먼저 돌리고, 규칙을 통과한 경우에만 App Group `inbox/`로 영속화한다(임시 복사 → OCR → 규칙 → 영속화 → 큐). PDF는 OCR이 없어 규칙 대상 텍스트가 없으므로 그대로 영속화한다. 로그는 본문 없이 종류·결과만 남긴다: `ShareExtension file queued id=<uuid> type=image ocrLen=<n>`, 폐기면 `ShareExtension file discarded:otp id=- type=image ocrLen=<n>`, 텍스트·URL은 `ShareExtension text|url queued` 또는 `discarded:<reason>`. 이미지·PDF는 App Group 컨테이너에 파일로 영속화한 뒤 큐에 로컬 경로를 기록하고, 업로드는 앱이 background URLSession 파일 업로드로 수행한다. 업로드 성공 후에만 로컬 파일을 지운다. 이미지에는 정규식 마스킹이 적용되지 않으므로 사용자에게 "이미지는 서버로 그대로 전송됨"을 공유 화면에 표시한다.

이미지·PDF 공유 시 기기 Vision 프레임워크 OCR 텍스트를 **항상 함께** 생성해 큐에 넣는다. 서버가 vision 상한에 걸리면 이 텍스트로 대체하므로 기기 재개 절차가 필요 없다.

## 7. 서버 파이프라인

```text
/ingest  (JWT 필수)
  → idempotency_key(user_id + source + external_id | sha256(content + occurred_at 분 단위)) 중복 검사
      기기 항목의 external_id = 기기 큐 항목 id(UUID). lease 만료 후 재전송돼도 1건 (§6 업로더)
  → 서버 규칙 필터 재적용 (§6 "기기 규칙 필터"와 같은 OTP·카드(Luhn)·계좌 규칙 + 프로모션: `(광고)` 표기·Gmail 프로모션 라벨).
      연락처 발신자 규칙은 연락처가 기기에만 있어 기기에서만 적용. 통과 못 하면 저장 없이 204
  → 본문·OCR을 사용자 데이터 키로 암호화(§12 통제 1)
  → items INSERT (status = queued) + jobs INSERT (kind = process, item_id)
  → 새 잡이 생겼으면 워커 즉시 호출(아래 "작업자 즉시 호출") — 응답을 막지 않는다
  → 202 반환

jobs 워커  (pg_cron 매분 + 잡 생성 직후 즉시 호출 → Edge: worker. 임대(lease) 180초, 최대 5회 재시도, 실패 시 dead 상태)
  → **작업자 즉시 호출(2026-10-01, C2 실기기 피드백)**: 매분 cron만으로는 업로드→처리 시작이 평균 30초·최대 60초(실측 ~50초)라
    문자→알림이 1~2분 걸렸다. `/ingest`(insert_item이 process 잡을 만든 경우)와 `gmail-webhook`(`gmail_enqueue_for_account`가
    새 gmail-sync 잡을 만든 경우)이 `_shared/kick-worker.ts`로 `POST /functions/v1/worker {}`(service role Bearer)를
    `EdgeRuntime.waitUntil`로 띄운다(없으면 await 없이). 워커는 배치(최대 100초)를 다 돌고 응답하므로 3초만 기다리고 끊는다 —
    끊겨도 워커는 계속 돈다(cron의 pg_net timeout 5초와 같은 방식). 실패는 로그에 결과 코드만(`http_<status>`·`error`·`no_env`, 본문·키 없음).
    cron은 놓친 작업(호출 실패·미루기·백오프 뒤) 회수용으로 그대로 둔다. 즉시 호출과 cron이 겹쳐 워커가 동시에 여러 개 돌아도
    같은 잡을 두 번 처리하지 않는다: `claim_jobs`가 전역 advisory 락으로 클레임을 직렬화하고(락 뒤 새 스냅샷에서 이미 running·임대 중인
    잡을 제외), `for update skip locked`·같은 `lease_key` 실행 중 제외·임대 180초(> 벽시계 150초)가 받친다. LLM 동시 호출은 사용자당
    `llm_slots` 2개 그대로라, 업로드가 몰려 워커가 여럿 뜨면 슬롯을 못 잡은 잡은 **5초** 미뤄진다(`defer_job`, attempts 소비 없음,
    0.8.1 수정 1회차 — 30초였을 때는 앞 잡을 끝낸 워커가 비었다고 종료해 cron까지 30~60초 더 밀렸다). 워커 배치 루프는 클레임이 비어도
    곧 풀릴 queued 잡(`not_before`가 지금~6초 안, `claim_jobs`와 같은 테스트 잡 범위)이 있으면 그 시각(+250ms)까지 자고 다시 클레임한다
    (호출당 최대 5회, 100초 예산 안. 실패 백오프 60초~·예산 소진 다음 달은 창 밖이라 기다리지 않는다). 그동안 채팅이 `llm_busy`(서버
    3초 재시도 → 503, 앱이 한 번 재시도)를 볼 수 있다 — 채팅 경로는 바뀌지 않는다.
  → 실패한 잡은 `not_before = now + attempts × 60초`(60·120·180·240초) 전에는 클레임하지 않는다(0007). 한 호출이 클레임을 반복해도 일시 오류 잡이 수 초 만에 5회를 쓰지 않게
  → 임대 180초는 Edge 무료 wall-clock 150초보다 길다: 살아 있는 워커의 잡은 만료되지 않아 다른 호출이 재클레임하지 않는다.
    잡 하나를 30초 넘게 붙들면 30초마다 heartbeat_job(id)으로 leased_until을 연장한다
    (0단계 실측: 임대 60초에서 90초 잡이 65초에 재클레임돼 중복 실행 → 180초+하트비트에서 재클레임 0건)
  → cron 호출은 vault(worker_url, service_role_key)가 있을 때만 보낸다. worker는 secret 키 호출만 처리한다(§12 통제 4)
  → 단계별 체크포인트: classified(Jev 게이트) → extracted → embedded → proposed. 재시도는 마지막 체크포인트부터
  → 처리 순서(0b에서 구현, 1단계 제품 그대로 — 2026-09-30 결정): `process` 잡은 복호화한 텍스트에 (1) 서버 규칙 재적용 →
      (2) 분류 게이트(Jev, 아래 문단) → (3) 텍스트 추출(`text_fact`) → (4) `save_fact` 순으로 처리한다. 분류 단계는 Jev 게이트 하나이고
      별도 LLM 재분류는 두지 않는다(0b에서 추출이 그 역할을 흡수했다. `subscription`은 3단계 구독 추적 때 추출 종류로 추가, `reference`는
      소비처가 없어 두지 않는다). device_filter = "rules" 항목은 기기 FM 판정이 없으므로 여기서 처음 분류된다. 게이트 전에는 다른 외부 전송 없음.
      이미 처리된 항목(status ≠ queued)은 복호화·모델 호출 없이 끝난다
      폐기 처리: 서버 규칙 폐기(OTP 등)는 `content_enc`·`ocr_text_enc`를 즉시 지우고 status = `discarded:server:<사유>`.
      **게이트 폐기는 7일 격리**(1인 사용 기간, 2026-09-30): status = `discarded:server:<label>`로 두고 본문은 **암호화한 채 7일 유지** →
      제품 앱 "최근 폐기" 목록(제목·발신자·라벨·confidence, 본문 없음)에서 사용자가 "복구"하면 게이트 판정을 무시하고 추출로 넘긴다 →
      7일 뒤 pg_cron이 본문·청크를 지운다(행은 유지, 사유 코드만). 오폐기(actionable 유실)를 사용자가 확인할 길을 두고 실데이터 200건
      정확도(§16)의 정답을 얻기 위해서다. 트레이드오프: 개인 대화 원문이 암호화 상태로 7일 더 서버에 있다(지인 확대 시 재검토, §16).
      감사 로그 `discard`(item_id·사유 코드만). 추출 결과가 없으면 `discarded:server:empty`이고 원문은 남긴다(1b 검색 대상, 3년 만료 규칙(2026-10-01)
      그대로. 게이트를 저신뢰로 통과한 비행동 항목의 2차 방어선)
      구현(M1-④a): 워커가 분류한 항목마다 items.gate_label·gate_confidence를 남기고, 게이트 폐기는 quarantine_until = 폐기 + 7일.
      복구는 restore_discarded RPC(사용자 JWT) → status queued + process 잡 payload skip_gate + gate_feedback(wrong_discard).
      기한 경과·정리 뒤 복구는 `expired`. 테스트 항목(idempotency_key `test:<run>:…`)의 복구 잡은 lease_key 도 `test:<run>:` 접두(0011, 운영 워커 제외).
      pg_cron purge-quarantine-daily(하루 1회)가 기한 지난 본문·청크를 지운다 — 실제 보존은 7일 + 다음 일일 정리까지(최대 약 8일).
      **서버 분류 게이트(0b, 2026-09-29 사용자 결정 — Jev 채택)**: `Classifier` 인터페이스 `classify(text, meta) → {label, confidence} | null`.
      운영 공급자 `CLASSIFY_PROVIDER=jev`(TypeSafe Jev, 모델 `jev-1.13.0` 고정 — 버전이 바뀌면 confidence 분포가 바뀐다, 키 `JEV_API_KEY`.
      코드 기본값 none은 설정 누락 대비). 라벨은 0b 5종 actionable · personal · promo · otp · notice에 1단계에서 `medical_result`를 더해
      **6종**(§6 "서버 Jev 게이트 라벨", 경계는 `_shared/classify.ts` LABEL_CRITERIA, 평가 rubric 그대로). 추가 전에 합성 60 + 의료 10 문구로
      재평가한다(라벨 추가는 confidence 분포를 바꾼다). 재평가에서 actionable 유실이 늘면 5종으로 되돌리고 의료 결과 안내는 규칙 키워드
      ("검진 결과·검사 결과·진단")로 폐기한다. **정책: 비행동 라벨(actionable 외)이고 confidence ≥ 0.8일 때만 폐기(`discarded:server:<label>`). 그 외, 오류
      (401·422, 짧은 재시도 뒤에도 429·529), 타임아웃(3초)은 폐기하지 않고 추출로 넘긴다(fail-open — 행동 항목 유실이 가장 비싼 오류).**
      Jev에는 마스킹된 본문(≤2,000자)·제목·앱 이름만 보내고 발신자는 보내지 않는다. 메신저 알림(`source=MESSAGES`, 또는 앱 이름이
      메시지·SMS·iMessage·카카오톡·Slack·Instagram·Telegram·LINE 등 — 목록은 `_shared/classify.ts` `MESSENGER_APPS` 한 곳)은 제목이 곧
      발신자 표시 이름·단톡방 이름이므로 **제목도 보내지 않는다**(`classifierMeta`, 0b 최종 리뷰).
      평가(합성 60문구, `docs/superpowers/reports/2026-09-29-jev-classification-eval.html`): 게이트 정확도 **60/60**(2회 동일, 5라벨도 60/60),
      지연 **p50 211ms**·p95 269ms, **건당 약 $0.00003**(입력 평균 769토큰 × $0.042/1M, 월 약 $0.06), t=0.8에서 actionable 유실 0·비행동 누수 1/60.
      60/60은 상한값이다(같은 작성자의 문구, Jev 문서상 한국어는 주 언어 아님) — 실데이터 200건 재측정 전에는 폐기 권한을 넓히지 않는다.
      실데이터 200건 재측정은 1단계 M1 분류 태스크(④)의 게이트다: 사용자가 "최근 폐기" 목록과 보관함에서 200건 중 잘못 폐기·잘못 통과한
      것만 표시하고 러너는 라벨·confidence·표시 결과만 집계한다(원문 없음).
      기기 FM 분류기(§6)는 개인정보 방어선으로 유지한다. OpenAI 소형 모델은 같은 인터페이스의 교체 후보로만 둔다(교체 조건 §16)
  → 추출 (gpt-6-luna, Responses API `text.format` json_schema strict. `store: false`)
      event: title, start, end, allDay, location, tz, evidence, uncertain[]  (예: year, ampm, end, tz, date, location)
      uncertain은 모델 판단이 아니라 서버가 정한다(0단계 PoC-8 실측: 모델의 uncertain 표시가 반복마다 흔들림). 스키마에 사실 플래그
      (`year_in_text`, `lunar`)를 두고 서버가 year·date를 채운다. 이미지 경로는 연도 표기가 없으면 연도를 "오늘(서울) 이후 가장 가까운 해"로 서버가
      다시 계산한다(모델이 내년으로 채운 사례). 일시는 ISO 8601 +09:00로 정규화하고 해석 불가·종료 < 시작은 null + date/end.
      **음력 날짜는 확정하지 않는다**: 모델 환산이 하루씩 틀려(10-24 → 10-25) date를 넣어 REVIEW로 보낸다. 제품에서 자동 환산이 필요하면
      서버 음력 변환표(한국천문연구원 기준)로 한다. 종료 시각이 문서에 없으면 end는 null이고 uncertain에 넣지 않는다
      task: title, due, evidence, uncertain[]
      purchase: merchant, product[], ordered_at, amount, currency, order_no, status, recurrence?, evidence
      텍스트 항목(0b, 2026-09-29 · 다건 일정 2026-10-01 사용자 결정): 한 항목에서 종류를 event·task·purchase 중 하나(없으면 none)로 고르는 단일 strict 스키마 `text_fact`.
      **event는 `events` 배열에 최대 5개**: 날짜가 다른 별개 일정(1회차·2회차, 서로 다른 진료·공연)은 각각, 한 행사가 여러 날 이어지면 start~end 하나,
      접수·신청 기간·마감·발표·변경 기한·준비 안내(금식 등) 같은 **부수 일시는 별개 일정이 아니다**(본 행사가 없고 마감만 있으면 task), '매주' 같은 반복 표현은
      첫 회 하나(§10 반복 규칙). 광고·홍보성 행사 목록(라인업·출연진 공개, 티켓 할인·'지금 예매하세요' 같은 구매 권유)은 날짜가 여러 개여도 none이고,
      받는 사람의 예약·예매 확인이나 기관·학교·단체의 행사 일정 안내는 event다(T2 평가 m16 — 지시문 한 줄). 일정이 5개를 넘으면 **시작이 이른 5개**(모델 지시 — 서버 정렬은 모델이 빠뜨린 일정을 되살리지 못한다). 서버가 시작 없는 항목을 버리고,
      같은 시작·제목은 하나로, 시작 순으로 정렬해 앞 5개만 남긴다(모델이 더 내도). 지난 일정도 버리지 않는다(연도는 아래 기준일 문단 — 지난 일정은 제안으로 남고
      푸시·제안 목록에서 빠진다, notify·§10). evidence는 일정마다 그 일정이 적힌 한 구절(80자 이내 지시,
      서버 절단 300은 §8 그대로). task·purchase는 1개(최상위 필드). 출력 상한 512 → 2,048토큰(상한은 과금이 아니라 잘림 방지 — 잘리면 파서가 throw해 그 항목 전체가
      일정 0개가 된다. 장문 5건 실측 최대 < 1,230, §16 평가).
      상대 날짜('내일'·'목요일')와 연도 없는 날짜의 기준일은 **받은 시각(occurred_at)의 서울 날짜**다(오프라인 큐·지연 처리로
      처리 시각이 늦어도 날짜가 밀리지 않게). 연도 없는 날짜는 **이 기준일의 해(받은 해)**로 결정적으로 정한다 — 단건·다건 모두, 지난 날짜여도 내년으로 넘기지 않는다
      (2026-10-01 사용자 결정, 이전 규칙 "기준일 이후 가장 가까운 해"는 텍스트 경로에서 폐기). 단 원문에 연도 단서가 있으면 모델이 그 해로 쓰고 `year_in_text = true`로 낸다:
      명시 연도, '작년·지난해'(전년)·'내년·다음 해'(다음 해), '내일·다음 주 금요일'처럼 기준일로 정해지는 상대 날짜, 12월→1월처럼 해를 넘어가는 나열의 뒤쪽(다음 해).
      서버는 `year_in_text = false`인 날짜만 받은 해로 맞춘다(종료는 시작과 같은 햇수만큼). 지난 날짜가 된 일정은 제안으로 남고 푸시·제안 목록에서 빠진다(아래 notify, §10).
      텍스트 경로에서는 uncertain에 year를 넣지 않는다(year는 이미지 경로 규칙 — 넣으면 연도 없는 문자 약속이 모두 REVIEW가 된다, 0b 최종 리뷰).
      모델 입력은 출처·앱 이름·제목·본문(4,000자에서 절단)이고 발신자 필드는 보내지 않는다. 단 메신저 알림은 제목이 발신자 표시 이름이라
      추출(OpenAI)에는 표시 이름이 제목으로 간다(분류 게이트 Jev에는 보내지 않는다, 위).
      event는 시작 일시가 없으면, task는 제목이 없으면, purchase는 가맹점·금액이 모두 없으면 none. evidence는 마스킹된 본문의 구절 ≤300자
      요약(2026-10-01, §16): 같은 `text_fact` 호출이 `summary`(원문 없이도 알아볼 수 있게 누가·무엇·언제·어디·금액, 한국어 200자 이내)와
      `keywords`(사람·기관·가게·상품·장소·금액·날짜 표기, 12개 이하)를 kind와 무관하게(none 포함) 함께 낸다. 워커가 요약을 사용자 데이터 키로
      암호화해 `item_summaries`(§8)에 넣는다 — `save_fact`·empty 처리 **전**에 넣고 재시도는 덮어쓴다. 모델이 빈 요약을 내면 마스킹 본문 앞
      200자로 대신한다(요약 없는 항목이 매일 재요약되지 않게). 입력이 4,000자에서 잘리므로 긴 메일의 요약은 앞부분 기준이다. 출력 상한은 다건 일정 2,048에 요약 약 150을 더해 2,200토큰(보관 계획 R-B2가 올린다).
      M1 기간 항목과 실패분은 `summarize` 잡(요약 전용 strict 스키마, 백필 레인, 월 예산 `extract`)이 채운다: 매일 cron `enqueue_summary_backlog`
      (사용자당 하루 200건). 게이트 폐기(격리 중)·규칙 폐기·처리 전(queued) 항목은 요약하지 않는다(복구되면 process가 만든다).
      이미지·PDF(vision) 요약은 2단계 파일 경로와 함께 한다
  → 이미지/PDF: gpt-6-luna vision(`input_image`·`input_file`). 월 상한 100건(usage_counters). 초과 시 기기에서 같이 올라온 OCR 텍스트 사용
      기기 OCR 텍스트가 있으면 이미지·PDF와 함께 넣는다(0단계 실측 vision+OCR 21/21, vision만 19/21 — 스캔 PDF 제목 오류).
      건당 입력 3.8~4.3k 토큰, 약 $0.00042, 지연 p50 1.95s·p95 2.53s(PoC-8). 상한은 호출 전 예약(`reserve_vision_call`, 한 문장 upsert)
      PDF: 10MB·50페이지 초과, 암호화, 파싱 실패 → "앱에서 확인" 상태로 두고 푸시
  → URL: 허용 스킴 http(s)만, 사설·루프백 IP 차단, 리디렉션 3회, 응답 2MB·10초 제한, 텍스트 MIME만
      본문 추출 실패(HTML 파싱 오류·JS 전용) → "스크린샷 공유 요청" 푸시. 짧은 정상 문서는 그대로 저장
  → 연결(2단계, `purchases` 테이블과 함께): purchases는 (merchant, order_no) 복합 키. 없으면 (merchant, amount, ordered_at ±1일)로 후보 제시
      취소·변경 문구 → 기존 fact status = cancelled/superseded, 새 fact에 supersedes_id
  → 청크(512자) → item_chunks. 임베딩 `text-embedding-3-large`(`dimensions: 512`). 활성화 조건(PoC-7 통과)은 2026-09-27 충족,
      worker 연결 M2-⑧a(2026-09-30, `0015`·`0016`): process 잡이 저장(extracted)·empty(원문 유지) 뒤 embed 잡(lease `embed:<item>`, 백필 항목은
      백필 레인)을 넣고, embed 잡이 제목+본문을 512자 청크로 나눠 임베딩·저장한다(checkpoint embedded). 격리·규칙 폐기·원문 만료 항목은
      청크를 만들지 않는다. 비용은 예약·정산(§13, 임베딩은 백필 항목도 **월 예산** — 레인만 백필), LLM 슬롯(동시 2)을 같이 쓴다. M1 기간 항목은
      `enqueue_embed_backlog`로 한 번에(백필 레인 — 새 항목의 process·embed 잡 앞에 서지 않게). 청크 전에 서버 규칙을 다시 적용하고
      (§12 통제 2, 폐기 판정이면 청크 없음), 한 요청은 256청크 이하로 나눠 보낸다(요청당 30만 토큰·2,048개 한도). 임베딩을 월 예산으로 둔
      이유(M2-⑧a 리뷰 수정 `0016`): 백필 예산이면 추출이 먼저 다 써서 백필 메일 전체가 다음 달까지 검색(벡터·키워드 둘 다 `item_chunks`)에서 빠진다
      요약 임베딩은 **원문·청크가 지워질 때** 만든다(지연, 2026-10-01): 원문 만료·용량 비우기(§8)가 청크를 지운 항목마다 embed 잡
      (`payload.summary = true`, 백필 레인, 월 예산 `embed`)이 요약을 복호화해 임베딩한다. 청크가 있는 동안 벡터를 두 벌 두지 않아 용량을 아끼고,
      비우기가 OpenAI 가용성·예산에 묶이지 않는다. 요약 키워드 검색은 삭제 즉시, 요약 의미 검색은 이 잡이 돈 뒤부터(예산 소진이면 다음 달)
  → 저장(0b · 다건 2026-10-01, `0025`): 텍스트(process 잡)는 `save_facts`가 한 항목의 fact 전부를 **한 트랜잭션**으로 넣는다(일부만 저장된 채
      `extracted`가 되면 재시도가 나머지를 다시 뽑지 않으므로). 이미지(extract 잡)는 1건짜리 `save_fact`(같은 함수의 래퍼). 일정마다 fact 1건 —
      `facts.ordinal`(0~4, 시작 순) — 같은 항목·같은 종류·같은 순번의 active fact는 1개, task·purchase는 순번 0 하나뿐 +
      event → `create_event`, task → `create_reminder` 제안(purchase는 제안 없음. 1단계까지는 `purchases` 테이블 없이 facts.payload, 테이블은 2단계),
      items.status = `extracted`. 재시도는 새 행 없이 같은 fact·제안 id를 돌려주고 status만 `extracted`로 맞춘다. 항목 수가 1~5 밖이거나 event가 아닌데 2개 이상이면 아무것도 저장하지 않고 오류
  → proposals INSERT (event/task). uncertain 비어 있을 때만 잠금화면 "추가" 버튼 노출,
      아니면 REVIEW 카테고리로 앱에서 확인 유도
  → 백필(occurred_at이 수집 시각보다 3일 이상 과거)에서 나온 제안은 푸시하지 않는다. 보관함과 앱 "제안" 탭(§10 제안 리뷰 대기 목록)에는 보인다
  → jobs INSERT (kind = notify, lease `notify:<대표 proposal_id>`. **항목당 1개**(2026-10-01): 대표 = 그 항목에서 순번이 가장 작은 제안. 텍스트·이미지 경로 모두 —
      중복은 아래 기기별 1회가 막는다. 텍스트 process 잡이 재시도에서 이미 `extracted`인 항목을 만나면 대표 제안에 푸시 기록이 없을 때 대표만 다시 넣는다
      (0016 → 0025, save_facts 커밋 뒤 enqueue 전 종료 대비))
      → worker `notify`가 `_shared/apns.ts`로 사용자의 모든 기기(`devices`, 기기 환경·불일치 시 반대 환경 1회)에 발송(0b).
      기기별 1회(`proposal_pushes`, 0014): 400·403·404·410·413은 `rejected`(재시도 안 함), 429·5xx·연결 오류는 `failed`(잡 재시도 최대 5회).
      잡 임대(180초) 안의 `sending`은 `in_flight`로 보고 잡을 실패시켜 재시도한다. 임대가 지난 `sending`(발송 중 워커 종료)은 다시 가져간다(0016)
      푸시하지 않는 경우: 제안 status ≠ proposed, 백필(captured_at − occurred_at ≥ 3일), 시작·기한이 지난 제안
      (날짜만이면 오늘(서울)은 지나지 않은 것으로 본다)
      묶음(2026-10-01): notify 잡은 대표 제안의 항목에 딸린 같은 종류의 최신 제안 전부(`worker_get_proposal_bundle`, 순번 순)를 읽어 위 조건으로 푸시할 수 있는
      일정 제안만 남긴다. 0건이면 건너뛰고(사유는 순번 0의 것), 1건이면 지금과 같은 단건 푸시(그 제안의 id·카테고리), 2건 이상이면 묶음 푸시 1건(§10 `EVENT_BUNDLE`).
      기기별 1회 기록(`proposal_pushes`)은 대표 제안 id에 남긴다(단건으로 남은 것이 대표가 아니어도)
      **중복(2026-10-01 사용자 결정, 앱 0.9.2, `0027`)**: 같은 일정이 다른 경로(문자·메일·공유)로 또 들어오면 **제안은 만들고 푸시만 하지 않는다**.
      notify가 `worker_pending_event_peers(p_user, p_proposal)`(읽기 전용, service role)로 같은 사용자의 **다른 항목**에서 **먼저** 생긴(`(created_at, item_id)` 순 —
      두 항목의 notify가 동시에 돌아도 나중 것만 빠진다) 대기(`proposed`) 일정 제안 중 이 항목 일정과 같은 서울 시작 날짜(시작 앞 10자)이고
      **그 항목에 실제 발송 기록(`proposal_pushes.status='sent'`, 묶음은 대표 id로 기록되므로 항목 단위)이 있는** 것을 읽고(백필로 건너뛴 먼저 온 제안이 나중 제안의
      푸시를 지워 알림이 한 번도 안 가는 일을 막는다 — 리뷰 S1, 2026-10-01),
      워커가 정규화 제목(`_shared/notify.ts` `titleKey`: 소문자, 글자·숫자만 — 공백·기호·괄호 제거, 앱 `TitleMatch.normalize`와 같다)이 같은 일정을 뺀다.
      남은 것만으로 단건·묶음을 정하고, 중복 때문에 0건이면 건너뛴다(`duplicate`). 피어 조회가 실패하면 중복 없음으로 보고 보낸다(fail-open, 로그 `peers_error` —
      중복 푸시가 푸시 유실보다 싸고 앱의 "비슷한 일정" 확인(§10)이 받친다). 비교는 같은 날짜 + 같은 정규화 제목만(포함·핵심어 같은 느슨한 판정은 앱 몫 — 서버에서 오판하면
      알림이 조용히 사라진다). 기각: 제안을 만들지 않기 — `save_facts`(한 트랜잭션·재시도 멱등)에 판정을 넣어야 하고, 먼저 온 제안을 무시하면 새 정보가 사라져 되돌릴 수 없다.
      그래서 두 제안은 제안 탭·채팅 카드에 모두 보인다(하나를 넣으면 다른 하나는 "비슷한 일정"·"등록됨"으로 보인다, §10)
      한계: 날짜만 비교하므로 피어가 종일 "10/8 운동회"이고 새 제안이 "10/8 09:00 운동회"(시각이 더해짐)여도 푸시가 빠진다 — 새 제안은 제안 탭에 남는다.
      이미 캘린더에 넣은(`proposed` 아님) 제안은 피어가 아니어서 같은 일정이 다시 오면 푸시된다(잠금화면 추가는 앱 판정이 막는다, 다음 단계 후보)
```

서버 규칙 필터와 source: `rules.ts`의 `applyRules`는 source·app_name으로 분기하지 않고 모든 항목에 같은 OTP·카드·계좌·`(광고)` 규칙을 적용한다. 따라서 알림 자동화로 온 문자(`source=NOTIFICATION, app_name=메시지`)도 `MESSAGES`와 같은 규칙을 받는다(2026-09-28 확인, 코드 변경 불필요). 2026-10-01부터 문자는 메시지 트리거로 `source=MESSAGES`로 들어오고 알림 자동화에서 메시지 앱을 뺀다(§5). 그래도 **`NOTIFICATION + app_name=메시지` 취급 규칙은 유지한다** — 09-28~10-01 알림 경로로 쌓인 기존 문자 항목이 있고, 사용자가 알림 자동화에 메시지 앱을 남겨 둘 수도 있다. 연락처 규칙은 기기에서 `title`(표시 이름)로도 비교하므로 알림 경로에서도 `discarded:contact`가 동작한다(실측). **1단계**: source로 문자를 구분하는 코드(분류·추출·검색 표시)는 `NOTIFICATION + app_name=메시지`를 `MESSAGES`와 같이 취급만 한다. 두 경로를 함께 켠 경우의 2건 중복(발신자 번호 ≠ 표시 이름이라 멱등 키가 다름)은 앱별 분리(알림 자동화에서 메시지 앱 제외)로 막고, 서버 중복 제거는 만들지 않는다(2026-10-01).

`jobs`는 items 외에 gmail-sync·notify·cleanup도 같은 테이블로 처리한다. 사용자·연결별로 동시에 하나만 실행하도록 `lease_key`를 둔다. 1단계는 `jobs.priority`로 잡 종류별 우선순위를 둔다: notify > gmail-sync > process > backfill(백필이 만든 잡). 워커는 우선순위 순으로 클레임하고, 백필 잡은 사용자당 동시 1개로 제한한다(PoC-6에서 백필 `process` 잡 뒤에 웹훅 `gmail-sync`가 11분 대기, §16). 값: notify 10 · gmail-sync/gmail-fetch/gmail-watch/gmail-reauth 20 · process 등 30 · 백필 40(payload.backfill=true, insert 트리거가 정한다). 백필 잡(연결 시 90일 목록의 gmail-fetch와 그 항목의 process)은 lease_key `backfill:<user_id>`를 같이 써 기존 lease 규칙으로 사용자당 동시 1개가 된다. 워커 호출 1회는 100초 예산 안에서 1건씩 클레임을 반복한다(백필이 분당 1건으로 늘어지지 않게). 실패한 잡은 `not_before`(attempts × 60초) 뒤에 다시 클레임되므로 같은 호출에서 반복 실행되지 않는다.

### Gmail 동기화

- OAuth 클라이언트 두 개의 역할: **iOS 클라이언트**(`GOOGLE_CLIENT_ID`)는 앱의 Google Sign-In에만 쓰고(시크릿 없음), **Web 클라이언트**(`GOOGLE_WEB_CLIENT_ID` + `GOOGLE_CLIENT_SECRET`, Edge secret)는 앱의 `serverClientID`이자 서버의 코드 교환·토큰 갱신에 쓴다.
- 연결: iOS Google Sign-In(`gmail.readonly`) → `serverAuthCode`(1회용, 수 분 내 만료) → `POST /functions/v1/gmail-connect`. 인증은 **Supabase 사용자 JWT**(`Authorization: Bearer <access_token>`, body `{ code }`)이고 user_id는 JWT에서 얻는다. service role 키는 앱에 두지 않는다. Edge가 Web 클라이언트로 교환(`redirect_uri=""`) → `profile` → `watch` → `gmail_save_connection`(refresh token은 `vault`의 `gmail_rt:<connection_id>`, 연결 삭제 시 트리거가 함께 삭제) → 90일 백필 `gmail-fetch` 잡 → `gmail-sync` 잡.
  - 응답: 200 `{ connection_id, account, refresh_token_stored, watch_expires_at, backfill_pages, backfill_messages }`. `refresh_token_stored: false`면 Google이 이전 동의 때문에 refresh token을 다시 주지 않은 것이라 앱이 `disconnect()` 후 재동의한다. 401 세션 없음·만료, 400 `missing_code`, 409 `account_linked_to_another_user`, 502 `token_exchange_failed`(코드 만료·재사용·`serverClientID` 불일치).
- 초기: `messages.list q="newer_than:90d -category:promotions -in:drafts"`(페이지 100개 = 백필 `gmail-fetch` 잡 1개) → `messages.get(format=full)`, 240ms 간격(**fetch 실행 1개당** 분당 ≤ 250건 = 5,000 units, 사용자당 분당 6,000 units의 83%. 계정 전체 보장이 아니다 — 백필과 증분 fetch는 lease가 달라 겹칠 수 있고, 증분은 통당 22 units).
- 증분: `users.watch` → Pub/Sub push → jobs INSERT(kind = gmail-sync) → 워커 즉시 호출(§7 "작업자 즉시 호출") → `history.list(startHistoryId)` 페이지 전부 처리 후 커서 갱신. 404 시 `sync_states.last_success_at - 1일`부터 `messages.list(after: … -category:promotions -in:drafts)`로 재동기화.
- 초안 제외: 초안은 저장할 때마다·발송할 때 메시지 id가 바뀐다(Gmail 공식 동작). 목록 q에 `-in:drafts`를 붙이고, history로 들어온 초안은 `DRAFT` 라벨로 규칙 폐기(사유 `draft`)한다. 쓰다 만 메일은 저장·LLM 전송하지 않는다(§12 통제 2).
- fetch 404: 목록·history 뒤 사라진 메시지(영구 삭제, 초안 교체·발송)의 `messages.get` 404는 그 id만 건너뛰고 코드 `gmail_fetch_gone`만 남긴다(잡은 계속). 429·5xx는 지금처럼 잡 실패 → 백오프 재시도(0007).
- 푸시 유실 대비: pg_cron 6시간마다 연결별 gmail-sync 잡을 무조건 넣는다 (커서 기반이라 중복 비용 없음).
- 웹훅 인증: Pub/Sub push 구독에 OIDC 토큰을 붙이고 Edge에서 Google 공개키(JWKS)로 서명·issuer를 확인한 뒤 `aud`(구독의 audience = 웹훅 URL)와 `email`(푸시용 서비스 계정, Edge secret `PUBSUB_PUSH_SA_EMAIL`, `email_verified`)을 검증한다. 이 secret이 없으면 모든 요청을 거부한다. 모르는 계정·형식 오류는 재전송 폭주를 막으려고 200으로 ack하고 로그에는 코드만 남긴다. 본문의 `emailAddress`를 `connections.account_ref`로 조회해 user_id를 결정한다. 검증 실패는 저장 없이 401. 이 함수는 `verify_jwt = false`이며 service role로 동작하므로 **모든 쿼리에 user_id를 명시**한다.
- Gmail 수집 본문도 `/ingest`와 같은 서버 규칙 필터를 거친 뒤 암호화해 저장한다(프로모션 라벨 메일은 폐기).
- 만료 두 가지를 분리한다.
  - **Gmail watch 만료** `sync_states.watch_expires_at`: `users.watch` 응답의 expiration(7일). pg_cron이 매일 watch를 갱신해 이 값을 밀어낸다.
  - **OAuth refresh token 만료** `connections.expires_at`: 테스트 모드에서 발급 후 7일. 앱 게시(Production) 후에는 null.
- 재인증 푸시: `connections.expires_at` 24시간 전, 또는 토큰 갱신에서 `invalid_grant`가 발생했을 때 보낸다. refresh 실패 시 `connections.status = reauth_required`로 두고 해당 연결의 잡을 중단한다. pg_cron 매시(`gmail-reauth-hourly`)와 invalid_grant 발생 즉시 `gmail-reauth` 잡을 넣고, 같은 연결·사유·만료 창에는 한 번만 보낸다(`reauth_pushes`). 창 키는 `connections.expires_at`의 epoch 초, 없으면(Production 모드) `-`이고, 재연결(status → active)이 그 연결의 기록을 지워 다음 끊김에 다시 보낸다(0008). 기기가 0개면 기록을 풀어 매시 cron이 다시 넣는다. 문구에 계정 주소를 넣지 않는다.

## 8. 데이터 모델

모든 테이블에 `user_id uuid references auth.users` + RLS `(select auth.uid()) = user_id`.

| 테이블 | 핵심 컬럼 | 비고 |
|---|---|---|
| `connections` | provider, account_ref(unique with provider), status(active/reauth_required/disconnected), expires_at, created_at | 토큰은 `vault` `gmail_rt:<id>`(행 삭제 시 트리거로 삭제). `expires_at` = OAuth refresh token 만료(테스트 모드 7일, 게시 후 null) |
| `sync_states` | connection_id(pk), cursor(historyId), last_success_at, watch_expires_at | `watch_expires_at` = Gmail watch 만료(7일, 매일 갱신). 0단계 `0006_gmail.sql`과 일치 |
| `items` | source(GMAIL/MESSAGES/NOTIFICATION/SHARE/CHAT), app_name, sender, title, content_enc bytea, ocr_text_enc bytea, occurred_at, captured_at, device_filter, idempotency_key, status, storage_key, expires_at, gate_label, gate_confidence, quarantine_until | 원문. `content_enc`·`ocr_text_enc`는 Edge Function이 사용자 데이터 키로 AES-256-GCM 암호화해 저장(§12). 수집 3년 뒤(`expires_at = captured_at + 3년`, 2026-10-01) 삭제, 행은 유지. status: queued → extracted \| discarded:server:<사유>(0b). 게이트 폐기 항목은 본문을 7일 격리 후 삭제(§7). gate_label·gate_confidence = Jev 판정(분류한 항목만, 폐기·통과 모두), quarantine_until = 게이트 폐기 본문 보존 기한(규칙 폐기는 null, M1-④a `0010`) |
| `user_keys` | user_id, wrapped_key bytea, created_at | 사용자별 데이터 키를 마스터 키로 감싼 값(봉투 암호화). 마스터 키는 Edge Function 시크릿에만 있고 DB에 없다 |
| `utterances` / `memories` | (아래) | 평문. 사용자 삭제 시 연쇄 |
| `item_chunks` | item_id, chunk_index, text, text_enc(콜드), embedding vector(512) | 원문 만료(3년)·용량 비우기 때 행 전체 삭제. `tsv` 생성 열과 GIN(tsv)·GIN(trgm) 색인, **HNSW 색인**은 `hybrid_search`(0017, `strpos` 부분 문자열, `base` CTE 실체화 뒤 정확 탐색)가 쓰지 않아 용량 보호 태스크에서 지운다(HNSW는 `explain` 확인 뒤, 3년 분량 검색 지연이 1.5초를 넘으면 색인을 쓰게 바꾸는 후속 태스크 — 2026-10-01 리뷰 반영). `item_summaries`에도 HNSW를 만들지 않는다. `text`는 수집 90일까지 평문, 그 뒤 사용자 키로 암호화(`text_enc`)하고 평문을 지우며 임베딩은 유지(§16 UC-1 안 B — 리뷰 권고로 계획의 기본값, 사용자 확인 대기). worker embed 잡이 제목+본문 512자 청크로 채운다(M2-⑧a `0015`, 대상 = extracted·discarded:server:empty 이고 원문 있음) |
| `item_summaries` | item_id(pk, items cascade), summary_enc bytea, keywords text, embedding vector(512) null, model, created_at | 항목별 요약(2026-10-01, §7). **본문과 같은 등급**: `summary_enc`는 사용자 데이터 키 AES-256-GCM(계정 삭제 = crypto-shred), 복호화는 worker·chat만, LLM 전송은 본문 규칙 그대로(OpenAI 추출 호출이 만들고 chat 답변 문서로만 간다, Jev에는 보내지 않는다), 출처·계정 삭제가 함께 지운다(cascade). `keywords`는 원문 삭제 뒤 키워드 검색용 평문(`facts.payload`와 같은 등급의 평문 파생물, §12 통제 1). 시간 만료 없음(영구) — 용량 비우기 3단계만 지운다. `embedding`은 원문·청크가 지워질 때 채운다(§7 지연 임베딩). 검색 대상은 평문 청크가 없는 항목뿐(§9). RLS 자기 행 읽기(앱은 직접 읽지 않고 `/chat/item`으로 받는다) |
| `capacity_log` | at, scope(null = 운영, 테스트는 테스트 사용자 id), db_bytes, reusable_bytes, effective_bytes, limit_bytes, level(ok/warn/purge/hard), action(measure/purge/purge_hard/stuck/reclaim — stuck = 85~95%인데 1단계 후보 없음, reclaim = 보고 크기 90%), originals, summaries, freed_est, oldest_left, method(pgstattuple/fallback) | 용량 보호 기록(2026-10-01, 아래). 시스템 표(사용자 열 없음, service role 전용). 180일 보관 |
| `capacity_pushes` | user_id, level(warn/purged/full), window_key, sent_at | 용량 알림 1회 기록(`reauth_pushes`와 같은 방식). warn·full은 7일 창, purged는 비우기 1회마다 |
| `facts` | item_id, kind, ordinal(0~4, 2026-10-01), payload jsonb, evidence(원문 인용 ≤300자), status(active/cancelled/superseded), supersedes_id | 추출 결과, 무기한(원문 만료 뒤에도 남는다). evidence가 만료 후 출처 역할. items 행이 지워지면(출처·전체 삭제) 함께 지워진다(`item_id` on delete cascade, 0020). 한 항목에 event fact 최대 5개(순번), 부분 unique (item_id, kind, ordinal) where active(0025) |
| `purchases` | fact_id, merchant, product[], ordered_at, amount, currency, order_no, status, delivery_status, recurrence | **2단계**(facts 백필 마이그레이션과 함께). 구매·구독. `purchase_evidence(purchase_id, item_id)`로 다대다. 1단계는 `facts(kind=purchase).payload` |
| `proposals` | fact_id, action(create_event/update_event/create_reminder/complete_reminder), payload, version, status(proposed/confirmed/succeeded/failed/stale/dismissed), eventkit_id, idempotency_key | fact 변경 시 version 증가, 이전 제안은 stale. dismissed = 사용자가 "무시"(알림 액션·제안 시트·"제안" 탭, `dismiss_proposal`, 0021). 무시 뒤 다른 경로로 실제 추가해 보고되면 succeeded로 올린다(`report_execution`) |
| `executions` | user_id, proposal_id(unique), device_id, eventkit_id, version, executed_at, reported_at | 기기가 쓰기 성공 직후 기록(로컬 SQLite), 서버는 `report_execution`으로 받는다. 보고 실패 복구·version 불일치(§10 순서 5) 판정용 |
| `proposal_pushes` | proposal_id, device_id(쌍 unique), status(sending/sent/failed/rejected), apns_status, reason, apns_id, env, claimed_at | 제안 푸시 기기별 1회(0014, 0b). failed와 잡 임대(180초)가 지난 sending 행(발송 중 워커 종료)만 다시 가져간다. 임대 안의 sending은 잡을 재시도시킨다(0016) |
| `jobs` | kind, payload, priority, lease_key, leased_until, attempts, status(queued/running/done/dead), checkpoint, claimed_at, not_before | 영속 작업 큐. `priority`는 1단계(§7: notify > gmail-sync > process > backfill). claimed_at(첫 클레임, 웹훅→sync 지연 측정). not_before(이 시각 전에는 클레임 안 함: 실패 백오프 attempts × 60초(`fail_job`, attempts 소비), M2-⑦ 예산·슬롯 미루기(`defer_job`, attempts 되돌림) — 이유는 last_error 로 구분) |
| `utterances` | text, embedding, said_at, source(chat/siri/quick), kind(statement/question/correction) | 사용자 발화 전체 기록 |
| `memories` | text, embedding, utterance_id, status(active/retracted), supersedes_id | "기억해줘" 또는 gpt-6-luna가 statement로 판정한 것만. 정정 발화는 이전 memory를 retracted 처리 |
| `devices` | device_id(unique with user_id), apns_token, apns_env(sandbox/production), build, last_seen_at | 개발 설치 = sandbox, TestFlight·App Store = production 토큰. 발송은 기기 환경으로, 환경 불일치 응답이면 반대 환경 1회 재시도. 0단계 `0011_devices.sql`과 일치. 앱은 App Group에 마지막 등록의 환경·build·token_sha8을 두고 셋 중 하나라도 바뀌면(업데이트 설치·토큰 갱신) 앱 활성화·토큰 수신 때 자동 재등록한다(0.2.1. 0.2.0은 토큰이 같으면 생략해 build가 0.1.1로 남았다). 발송 대상은 `last_seen_at`이 7일 안인 기기만이다(버려진 개발 설치·시뮬레이터 제외, 0b). `last_seen_at`은 등록과 추적 업로드(`/ingest/trace`, 같은 device_id)가 갱신한다. 앱은 마지막 등록 뒤 24시간이 지나면 인텐트·BG refresh·무음 푸시·앱 활성화 중 먼저 오는 때에 다시 등록한다(진단 전송이 꺼져도 last_seen_at 유지, M1-⑤). 로그아웃은 등록 표식을 지워 다음 로그인에서 다시 등록한다. |
| `usage_counters` | month, vision_calls, extract_tokens, backfill_tokens, chat_tokens, reserved_krw, backfill_reserved_krw | 비용 상한. 호출 전 예약(`reserve_usage(kind, est_krw)`, §13), 후 정산. reserved_krw = 월 예산(정산된 실제 + 진행 중 예약), backfill_reserved_krw = 백필 예산(월 행이라 매달 1,500원, 월 상한 1만원과 별도 → 실질 월 최대 11,500원; M2-⑦) |
| `llm_slots` | user_id, slot(1·2), holder, held_until | 동시 LLM 2개(§13), service role 전용 |
| `device_traces` | device_id, event, at, 속성 jsonb(본문 없음) | 진단 trace(1단계, `poc_traces`의 제품판). 30일 보관. 설정의 "진단 전송" 토글 기본 켜짐(1인 사용). 별도 마이그레이션(`0002_diagnostics`)이라 지인 확대 시 기본값만 끈다. 실기기 게이트(잠금 상태·업로드 경로·액션 결과) 판정 근거 |
| `reauth_pushes` | connection_id, reason(expiring/invalid_grant), window_key, sent_at | 재인증 푸시 1회 기록(M1-③a). window_key = expires_at epoch 초 또는 `-`, 재연결 시 그 연결 행 삭제(0008) |
| `gate_feedback` | item_id, verdict(wrong_discard/wrong_pass), at | Jev 정확도 정답(사용자 표시, 본문 없음). RLS 자기 행. 표시는 평가 전용, 판정·검색에 영향 없음(2026-09-30 사용자 결정) — 보관함 버튼 "잘못 통과로 표시 (정확도 평가용)". 복구(wrong_discard)만 별도로 항목을 다시 처리한다 |
| `eval_judgments` | question_id, item_id, ok | 1b 검색 평가의 인용 판정(§9). 사용자가 앱 채팅에서 누른 👍/👎만, 본문 없음. question_id = 채팅 응답 answer_id(M2-⑨a), unique(user_id, question_id, item_id)·RLS 자기 행 읽기·쓰기·수정, 자기 항목에만(0018) |

### 삭제·만료 정책 (두 가지를 분리)

| 구분 | 트리거 | 지우는 것 | 남기는 것 |
|---|---|---|---|
| 원문 만료 | pg_cron, `expires_at` 경과 (원문·OCR·청크 3년 = `captured_at + 3년`, 2026-10-01). 요약 대상인데 요약이 없으면 요약 잡을 넣고 최대 7일 미룬다 | items.content_enc/ocr_text_enc, item_chunks **행 전체**(text·embedding) | items 행(메타), **item_summaries**(요약 임베딩 잡을 넣는다), facts(payload·evidence ≤300자), purchases, proposals, memories |
| 이미지 파일 만료 | pg_cron, `captured_at + 30일` (Storage 객체만, 2026-10-01부터 원문 만료와 분리) | Storage 객체 | OCR 텍스트(3년 규칙) |
| 용량 비우기 | pg_cron 매시, 유효 크기 ≥ 한도 85% (아래 "용량 보호") | 1단계 오래된 원문·청크(요약 있음·원문 없음·영구 폐기 항목, 수집 90일 이내 제외) → 2단계(유효 크기 95% 이상일 때만) 요약 없는 오래된 원문(queued 포함) → 3단계(95% 이상일 때만) 원문이 지워진 항목의 오래된 요약 | items 행, facts, proposals, memories(자동으로 지우지 않는다) |
| 폐기 격리 만료 | pg_cron, 게이트 폐기 후 7일 (§7, 1인 사용 기간) | items.content_enc/ocr_text_enc, item_chunks 행 | items 행(status·사유 코드) |
| 항목·출처 삭제 | 사용자가 항목 또는 출처(예: Gmail 연결) 삭제 | 해당 items·chunks·**summaries**(items cascade)·facts·purchases·purchase_evidence·proposals·executions·jobs(payload 포함 — summarize·요약 embed 잡도 `payload.item_id`로)·Storage 객체 | 다른 출처 데이터, memories |
| 전체 삭제 | 사용자가 계정 삭제 | 위 전부(요약 포함 — `summary_enc`는 `user_keys` 삭제로 백업에서도 복호화 불가) + capacity_pushes + utterances·memories·connections(Gmail 토큰 revoke 호출 포함)·devices·audit_log 본문 없는 행만 유지 + `user_keys` 행 삭제(crypto-shredding) + 기기에 삭제 푸시(로컬 큐·executions 정리) | 감사 로그의 사유 코드 |

구현(M2-⑥a): 원문 만료 = pg_cron purge-expired-daily(purge_expired + Storage는 purge-media 잡), 출처 삭제 = Edge account/source → delete_gmail_source(연결 행 잠금 → 잡 → facts → items → 연결 순, 한 트랜잭션. 범위는 사용자의 Gmail 항목 전부. 연결이 이미 없어도 항목 삭제는 수행), Gmail 항목 insert 는 살아 있는 gmail 연결이 있을 때만(삭제와 직렬화 — 삭제 뒤 진행 중 fetch 가 되살리지 못함), 진행 중 추출의 fact 는 `facts.item_id` cascade 로 item 과 함께 지워진다(삭제가 facts 를 지운 뒤 커밋된 fact 포함 — 최종 리뷰 I-1, 0020), 전체 삭제 = Edge account/delete(기기 목록 선조회 → revoke → Storage(오류면 중단) → Auth 사용자 삭제 → 감사 → 보관한 토큰으로 기기 삭제 푸시 eruri_wipe. 사용자 삭제 실패 시 기기·감사는 건드리지 않음). 이미지·PDF 항목은 insert 때 expires_at = 30일이었다 → 2026-10-01부터 OCR 텍스트는 3년, Storage 객체는 `captured_at + 30일`(`worker_expired_media`)로 분리한다.

만료·비우기 후 검색은 **요약**(키워드 = `keywords`, 의미 = 요약 임베딩, §9)과 facts·purchases·memories가 대상이며 출처는 요약·facts.evidence 인용문과 "원문 만료됨" 표시로 대체한다. 청크 벡터는 원문과 함께 지워진다. 요약까지 지워진 항목(용량 비우기 3단계)은 facts로만 찾는다. 백업은 Supabase 일일 백업 보관 기간(무료 7일) 동안 삭제 전 상태를 담고 있으며, `user_keys`가 지워진 뒤에는 백업의 `content_enc`를 복호화할 수 없다. 평문 파생물(청크·요약 키워드·facts)은 백업 보관 기간 후에 완전히 사라진다. 이 사실을 §12 통제 5의 화면에 그대로 적는다.

### 용량 보호 (2026-10-01 사용자 결정)

용량 추정(1인, 실측으로 보정 — 용량 보호 태스크 게이트): 메일 1통 ≈ 30~40KB(원문 암호문 + 청크 평문 + 청크당 512차원 벡터 2KB + HNSW 약 2.3KB, 사용하지 않는 `tsv`·GIN 색인 제거 후. 제거 전은 약 50KB. 리뷰 반영으로 HNSW도 지우면 청크당 약 2.3KB가 더 준다 — 용량 태스크 실측으로 보정), 알림 1건 ≈ 5KB, 요약 1건 ≈ 1KB(원문 삭제 뒤 벡터 +4KB). 메일 일 20·알림 일 40이면 **연 약 300MB**이고 Gmail 연결 때 90일 백필이 한 번에 약 60MB다. `cron.job_run_details`(pg_cron 실행 기록, 매분 워커 cron만 하루 1,440행)는 지우지 않으면 **연 약 250MB**로 사용자 데이터만큼 커진다. 따라서 무료 플랜 500MB에서 원문 3년은 불가능하고, 유효 크기가 85%에 닿는 **약 1.2~1.5년** 뒤부터는 가장 오래된 원문이 롤링으로 지워진다 — 사용자 확인 대기(§16 UC-2: 무료 롤링 수용 또는 Pro 전환).

| 항목 | 결정 |
|---|---|
| 측정 | `sum(pg_database_size(datname)) from pg_database`(Supabase가 한도에 쓰는 값, §3) = db_bytes. 지운 행 공간은 autovacuum 뒤 새 행이 다시 쓰지만 크기는 줄지 않으므로(§3), 판정은 **유효 크기 = db_bytes − 재사용 가능 공간**으로 한다. 재사용 가능 공간 = 큰 공개 테이블(items·item_chunks·item_summaries·jobs·audit_log·facts·device_traces) 힙의 `pgstattuple_approx` free + dead(색인 여유는 넣지 않아 보수적). 재사용은 VACUUM 뒤에만 되므로 `items`·`item_chunks`·`item_summaries`의 autovacuum 임계를 2%(`autovacuum_vacuum_scale_factor`, TOAST 포함, 호스팅 기본 20%)로 낮춘다 — 기본값이면 비우기 한 번(테이블의 약 7%)이 임계에 못 미쳐 dead 공간이 쌓이는 동안 새 행이 파일을 늘린다(2026-10-01 리뷰 반영). 보고 크기(db_bytes)도 따로 본다: 90%면 `reclaim` 운영 경보(운영자 `vacuum-full`), 설정 화면·푸시에 유효·보고 크기를 함께 보인다. `pgstattuple`을 쓸 수 없으면(용량 태스크 Step 1 탐침) 재사용 공간을 0으로 두고, 크기가 줄어 보이지 않으므로 비우기를 24시간에 1회·최근 24시간 유입량까지만으로 제한한다(롤링 유지, 과다 삭제 방지) |
| 한도 | `capacity_caps()` 한 곳(`budget_caps()`와 같은 방식): 한도 500MB(무료), 경고 70%, 비우기 시작 85% → 목표 75%, 위험 95%, 보고 크기 경보 90%. 플랜을 바꾸면 함수만 고친다(적용된 마이그레이션은 고치지 않고 새 마이그레이션으로 `create or replace`) |
| 정리(항상) | 매일: `cron.job_run_details` 14일, `jobs` done·dead 30일, `capacity_log` 180일 지난 행 삭제. 사용자 데이터가 아니므로 비우기보다 먼저 |
| 비우는 순서 | 오래된 순 = `occurred_at`(받은 시각) 오름차순. 1단계 원문·청크 — 대상은 명시 열거: 요약 있음 · 원문 없음(OCR·청크만 남음) · 영구 폐기(`discarded:*`, 단 요약 대상인 `discarded:server:empty` 제외). **수집 90일 이내는 지우지 않는다** → 2단계(유효 크기 ≥ 95%일 때만) 요약 없는 원문(`queued`·처리 중·요약 실패 포함) → 3단계(유효 크기 ≥ 95%일 때만) 원문이 이미 지워진 항목의 요약(같은 실행에서 원문을 비운 항목은 제외). 85~95%에서 1단계 후보가 없으면 지우지 않고 `stuck`으로 기록하고 위험 알림을 보낸다. facts·proposals·memories는 자동으로 지우지 않는다. 지울 양 = 유효 크기 − 목표(75%), 항목별 추정 바이트(암호문 길이 + 청크 본문 길이(평문 또는 콜드 암호문) + 청크당 고정 오버헤드, 게이트 실측값)로 누적해 멈춘다. 안전판: 한 번에 한도의 5% 이하, 6시간에 1회, 겹친 실행은 advisory lock으로 건너뜀. 원문을 비울 때는 `items`를 먼저 비운 뒤(행 잠금으로 청크·요약 저장과 직렬화) 청크를 지운다 (2026-10-01 리뷰 반영) |
| 주기 | 매시 `capacity-hourly`(측정·기록, 85% 이상일 때만 비우기). Gmail 90일 백필(약 60MB)이 하루 안에 들어와도 85%→100% 사이 75MB 여유가 있다 |
| 사용자 알림 | 푸시(본문·제목 없이 비율·개수·날짜만, 유효·보고 크기를 함께): 경고(70% 이상, 7일에 1회) "저장 공간 72% 사용(보고 74%) — 85%부터 오래된 원문을 지웁니다. 요약은 95% 이상일 때만 지웁니다.", 비우기 뒤 "저장 공간 확보: YYYY-MM-DD까지의 원문 N건[과 요약 M건]을 지웠습니다. [요약·]추출 정보는 남아 있습니다."(날짜 = 이번에 지운 항목의 가장 늦은 받은 날짜, 원문·요약 건수를 나눠 말하고 요약을 지웠으면 "요약은 남음"이라 하지 않는다), 위험(유효 95% · 보고 90% · `stuck`, 7일에 1회) "저장 공간이 거의 찼습니다(사용 N%, 보고 M%). 가득 차면 수집이 멈춥니다. 설정에서 확인하세요." 설정 "저장 공간" 절: 사용률·MB·보고 크기 비율·원문 보관 시작일(가장 오래 남은 원문)·마지막 비우기(원문·요약 건수) |
| 운영 | db_bytes(보고 크기)가 95% 이상인데 유효 크기가 낮으면 재사용 공간이 크다는 뜻 → 운영자가 `scripts/capacity.ts vacuum-full`(테이블 잠금, 한 문장씩)로 보고 크기를 줄인다. 지인 확대(3단계)에서는 전역 비우기 대신 사용자별 할당으로 바꾼다 |

## 9. 채팅·검색

```text
질문 → gpt-6-luna가 필터 추출 {date_range, event_range, sources, kinds, merchant?}
        (date_range = 메일·문자를 받은/저장한 기간을 말할 때만. event_range = 질문이 가리키는 일정·기한의 날짜, 없으면 null — 2026-10-01)
     → facts SQL 우선 (구조화 질문. 1단계는 facts(kind=purchase).payload jsonb 조회, 2단계부터 purchases 테이블.
        date_range 는 항상 받은 시각(occurred_at), event_range 는 event·task 의 start·due 에만 — 둘 다 있으면 둘 다 건다.
        event_range 가 있으면 일정 시작 순 상위 8, 없으면 받은 시각 역순 상위 5 — 0024. 상한은 fact 단위라 다건 항목 하나가 여러 칸을 쓴다. 같은 항목의 fact 문서는 한 문서로 합친다(2026-10-01 — 따로 두면 item_id 중복 제거가 두 번째 일정부터 버린다. 인용·👍👎 판정(0.8.3)은 원래 항목 단위라 그대로))
     → 하이브리드: tsvector(simple + pg_trgm) ∪ pgvector cosine, RRF 융합, 상위 12개(기간 필터로 0건이면 기간 없이 1회 더)
        (원문·청크가 지워진 항목은 요약 문서로 참여: 키워드 = item_summaries.keywords, 의미 = 요약 임베딩 — 2026-10-01)
     → memories(active만) 상위 5개 포함. utterances의 question/correction은 검색 풀에서 제외
     → gpt-6-sol 답변(effort low). Responses API `text.format` json_schema strict로
        {sentences:[{text, source_item_ids[]}]} 출력. 검색 결과는 <document id="item_id"> 블록으로 넣는다
        (OpenAI에는 Anthropic식 citations 기능이 없으므로 인용은 모델이 JSON에 적은 item_id뿐이다)
     → 서버 검증: 각 문장의 source_item_ids가 이번 검색 결과 집합에 있는지 대조. 없는 id는 제거하고
        id가 하나도 남지 않은 문장은 "근거 미확인"으로 표시. 전체 유효 인용 0개면 "저장된 정보에서 확인되지 않음"으로 대체.
        인용 id는 존재만 검증되고 문장이 그 문서에 실제로 근거하는지는 보장하지 않는다 → 인용 정확도(§9 지표)로 측정
     → 실행 가능 항목은 proposal 카드로 반환. 검색 문서 내용은 절대 proposal payload를 직접 만들지 못하고
        추출 파이프라인(§7)을 다시 거친다
     → 검색 후보(candidates: 인용 ∪ 가맹점·기간으로 걸러진 facts ∪ 관련도 컷을 통과한 융합 행의 항목 id, 최대 20, 거절이면 빈 배열) 반환 → 앱 "보관함에서 보기"
     → 일정 질문이면 일정 기간(schedule {from,to}) 반환 → 앱이 그 기간의 기기 캘린더를 읽어 답 아래에 표시(캘린더는 기기 밖으로 안 나감, 2026-10-01)
```

- 임베딩은 `text-embedding-3-large`(`dimensions: 512`)로 한다(§2, PoC-7).
- 한국어 키워드는 PostgreSQL `simple` 설정으로는 형태소가 안 잘린다. `plainto_tsquery`의 전체 어절 AND와 문서 전체 trigram 유사도는 PoC-7에서 Top-5 2/40이었다. 그래서 질문 어절(질문어 제외)을 끝 1~2글자를 뗀 형태까지 부분 문자열로 맞추고, 어절별 IDF 합으로 순위를 매겨 RRF에 합친다(`hybrid_search` 0009, 키워드 전용 32~34/40). **숫자가 든 어절은 숫자로 끝나는 변형을 만들지 않는다**(`10월`→`10` 금지, `10월에`→`10월`은 허용) — `10`이 시각·전화번호·금액에 부분 문자열로 맞아 "10월 3일 일정" 질문에서 청크 11/25가 키워드 일치했다(2026-10-01 재현). 예외: 3자 이상 원형에서 조사(은·는·이·가·을·를·에·의·도·로·와·과·만·에서·까지·부터·으로)를 뗀 경우는 숫자로 끝나도 허용한다(`1234는`→`1234` — 주문번호·연도 질문, `10월`→`10`과 구조가 같아 조사 목록으로만 가른다). 맨숫자 1~2자리 토큰("10/3 일정"의 `10`)은 어절에서 뺀다. 한글 어절의 끝 글자 떼기(조사)는 그대로다(외부 리뷰 반영 2026-10-01).
- 무근거 거절과 인용은 **답변 단계**에서 판정한다. 검색 점수 임계로는 거절이 최대 7/10이고 정답 오거절이 함께 났다(PoC-7). 답변 모델은 `{answer, source_item_ids[], refused}`를 출력한다. 서버는 인용 id를 이번 검색 결과와 대조하고, 없는 id를 지운 뒤 근거가 0개면 거절로 강제한다. 합성 평가 결과: 무근거 거절 10/10, 답한 36/36이 정답 문서 인용, 환각 id 0.
- 검색 품질 평가는 **1단계 완료 기준**(1b 게이트)에 포함한다(§15). 지표: 정답 포함(Top-5 ≥ 90%, 질문 50개), 무근거 질문 거절률, 취소·정정 반영, 인용 정확도, 날짜 필터 오판.
- **실데이터 평가 절차**(2026-09-30 결정 — 운영자·에이전트의 본문 열람 금지(§12 통제 4) 아래에서 잰다. 사용자 본인이 제품 앱으로 자기 데이터를 보는 것은 제품 기능이라 금지 대상이 아니다):
  1. `scripts/list-items-meta.ts`가 `(item_id, source, app_name, sender, title, occurred_at, status)`만 출력한다(본문·OCR 열 없음).
  2. 사용자가 `eval/questions.json`(gitignore)에 질문 50개를 쓴다: 정답 40(각 `expected_item_ids`), 무근거 10, 날짜 필터 10은 정답 40 안에서.
     **제목·발신자만으로 답이 안 나오는 질문 ≥ 15**를 조건으로 건다(제목 편향 방지). 본문이 필요한 질문은 제품 앱 보관함에서 항목을 열어 보고 쓴다.
  3. `scripts/eval-search.ts`(사용자 JWT)가 질문마다 `chat`을 호출해 Top-5 id·정답 포함 여부·거절 여부·인용 id 검증 결과·지연만 stdout에 낸다.
     답변 본문은 `eval/answers.local.json`(gitignore)에만 쓰고 에이전트는 열지 않는다.
  4. 인용 정확도("있는 문서를 잘못 인용")는 사용자가 앱 채팅에서 답변 20건을 👍/👎로 판정한다 → `eval_judgments`(§8, RLS, 본문 없음, 항목 단위 그대로). 👍 = 그 답의 인용 항목 전부 관련 있음, 👎 = 시트에서 인용 항목별 관련 있음/없음을 골라 저장(아래 "채팅 답 표시"). 러너는 집계만 읽는다.
  5. 합격선은 위 지표 그대로(Top-5 ≥ 90%, 무근거 거절 ≥ 90%). 인용 정확도가 PoC-7 수준에 못 미치면 문장-문서 재검증(§16)을 추가한다.
- 수집된 메일·웹·알림 안의 지시문은 데이터로만 취급한다. 검색 결과는 `<document>` 블록으로 감싸 user 턴에 넣고 시스템 프롬프트는 고정해 앞에 두어 OpenAI 자동 프롬프트 캐시(캐시 입력 단가 1/10)에 걸리게 한다. 도구 호출 권한은 chat 함수에 없다(읽기 전용).
- **채팅 답 표시(2026-10-01 실기기 피드백, 앱 0.8.3)**: 답 아래에 인용 줄(제목·출처·시각·👍👎)을 두지 않는다 — 출처 원문은 일정 답 카드의 "원문 보기", "보관함에서 보기", "틀렸어요" 시트에서 연다. 답(카드·"기기 캘린더" 절 포함) 맨 아래에 작은 텍스트 캡슐 버튼 막대 "맞아요" · "틀렸어요" · "복사"를 둔다(앱 0.9.0, 사용자 지시 2026-10-01 — 0.8.3의 👍👎⧉ 아이콘 막대를 대신한다. 회색 테두리 캡슐, 고른 쪽은 강조색으로 채움, 복사 직후 "복사됨". List 안에서 행이 아니라 버튼 자체 탭으로 1회에 눌린다(borderless). 접근성 라벨 "맞아요, 근거 전부 관련 있음"·"틀렸어요, 근거 항목별 평가"·"답 복사", 고른 쪽은 선택됨 특성). 거절(인용 0)이면 "복사"만. "맞아요"(👍)는 인용 항목 전부를 관련 있음으로, "틀렸어요"(👎)는 인용 항목 목록(제목·출처·시각·원문 보기)과 항목별 "관련 있음" 토글(처음엔 이미 고른 값, 없으면 관련 없음) 시트를 열어 "저장"할 때만 항목별로 기록하고 닫기만 하면 기록하지 않는다. 막대 상태는 항목 기록에서 나온다 — 하나라도 관련 없음이면 "틀렸어요", 전부 관련 있음이면 "맞아요"가 채워진다. 다시 누르면 바꾸고(merge-duplicates), 실패한 항목은 표시를 되돌린다. 서버·`eval_judgments`(0018) 변경 없음. 입력창은 하드웨어 키보드 Return = 보내기(비었거나 보내는 중이면 무시, 키보드 포커스 유지), Shift+Return = 줄바꿈, 한글 조합 중 Return = 조합 확정만이고 화면 키보드 동작은 그대로다.
- **채팅 → 보관함 보기(2026-10-01 사용자 결정, 후보 정의는 같은 날 "검색·캘린더 결정"으로 교체)**: 답변 아래 "보관함에서 보기 (N건)" 버튼이 그 질문의 **검색 후보**를 보관함 탭에 넘겨 그 집합만 보여준다. 후보 = **인용 항목**(인용 순) ∪ **구별 조건으로 걸러진 facts**(가맹점 또는 기간 — `kinds`만으로 나온 "최근 5건"은 모델 문서로만 쓰고 후보에서 뺀다) ∪ **관련도 컷을 통과한 융합 행의 항목**(융합 목록 = 의미 상위 40 ∪ 키워드 상위 40 청크·요약 문서, `hybrid_search` `p_limit` 80. 컷 = 키워드 점수 ≥ 이번 검색 키워드 1위의 0.5배 **또는** 의미 유사도 ≥ 이번 검색 의미 1위의 0.85배 — 요약 문서 행도 같은 규칙), 이 순서로 중복 제거·**최대 20**. 불변식: `인용 ⊆ 후보 ⊆ facts ∪ 융합 80`. 컷은 상대값이다 — 의미 상위 40은 관련 없어도 항상 채워져 25항목 코퍼스에서는 어떤 질문이든 25/25가 후보였고(2026-10-01 재현), 절대 점수 컷은 무근거 질문의 1위 유사도(0.44)와 근거 있는 질문의 5위(0.36~0.42)가 겹쳐 쓰지 않는다(PoC-7 점수 임계 거절과 같은 이유). RRF 점수는 순위만 반영해 컷에 못 쓰므로 원점수(`sem_sim`·`kw_score`)로 자른다. 0.5·0.85·20은 합성 질문 6개로 잡은 값이다. 포화(20개 꽉 참)는 상한이 순위순으로 자르므로 실패가 아니다 — 컷을 올려도 키워드 1위 어절 동점 행은 그대로라 포화가 풀리지 않고 재현율만 깎인다. 상수는 M2 검색 평가(⑩b) 때 **후보 재현율**(답한 정답 질문의 `expected_item_ids ∩ 후보` 비율, 집계만)을 재서, 0.9 미만이면 이 절을 먼저 고친 뒤 재결정한다(외부 리뷰 반영 2026-10-01). **거절 답변에는 후보를 돌려주지 않고 버튼도 없다**(2026-10-01 실기기 피드백: 거절인데 무관 목록이 보였다 — 앱은 0.7.1부터 거절이면 숨기고, 서버는 빈 배열). 거절 시 직접 찾는 길은 보관함 탭(출처 필터)이다. 모델에 넣는 문서(상위 12, `hits`)와 답변은 바뀌지 않는다 — 같은 한 번의 검색에서 자르기만 다르다(기간 폴백 뒤의 최종 검색 기준). 후보에는 id만 담고 본문을 읽지 않으므로 새 감사 행은 없다(항목을 열면 `/chat/item`이 복호화 감사). 보관함은 **후보 순서**(인용 → facts → 검색 순위)로 보여 준다(보관함 기본 최신순과 다름). 문서 0건이면 후보도 없고 버튼도 없다. 보관함 범위 모드: 머리 줄 "채팅 검색 결과 N건 · '<질문 앞 20자>'" + "전체 보기"(해제), 출처 탭 필터(서버 조건)·원문 보기(항목 상세)·무한 스크롤(50개씩 id 조각을 불러오고 끝 5행 전에 다음 조각)은 그대로, "최근 폐기"는 숨긴다(격리 항목은 후보가 아니다). 범위는 앱 메모리에만 두고 새 "보관함에서 보기"나 "전체 보기"까지 유지한다(앱 0.7.0)
- **요약 검색(2026-10-01)**: `hybrid_search`의 문서 집합 = 청크 ∪ **평문 청크가 없는 항목의 요약**(`keywords` 부분 문자열 + 요약 임베딩). 청크가 있는 항목의 요약은 넣지 않는다(순위·평가 기준선 유지). chat이 상위 문서 중 요약 문서만 복호화해 `[요약] …`으로 넣고 항목마다 감사 `decrypt`를 남긴다. `/chat/item` 응답에 `summary`(복호화, 없으면 null)를 더해 앱 항목 상세에 "요약" 절로 보인다 — 원문이 있는 동안에도 보여 사용자가 무엇이 남을지 확인한다
- **일정 질문과 기기 캘린더(2026-10-01 사용자 요청, 앱 0.8.0)**: 일정 질문(필터 `kinds ∋ event`이고 `event_range`의 양 끝이 있으며 31일 이하)이면 chat 응답에 `schedule {from, to}`(서울 날짜 경계 `YYYY-MM-DDT00:00:00+09:00`·`…T23:59:59+09:00`)를 싣고, 그 밖이면 `null`이다. 앱은 캘린더 전체 접근이 있을 때 그 기간의 기기 캘린더(EventKit)를 읽어 답 아래 **"기기 캘린더 · 이 기간 일정 N건"** 절에 시작 순 최대 5건(`M/D(요) HH:mm 제목`, 종일은 `종일`, 넘치면 "외 N건"), 없으면 머리 "기기 캘린더"와 "이 기간에 등록된 일정 없음"을 보인다. 앱도 32일을 넘는 구간은 읽지 않는다. 생일·구독(공휴일) 캘린더와 취소된 일정은 뺀다. **거절 답변이어도 거절 문구는 그대로 두고** 절 머리의 건수로만 알린다 — 거절은 메일·문자에 없다는 증명이 아니고 N은 대상 일치가 아닌 기간 일치라서 "메일엔 없고 캘린더에 N건" 같은 대체 문구를 쓰지 않는다(외부 리뷰 반영 2026-10-01). 채팅 제안 카드는 아래 "일정 답 카드"다(0.8.2 — 0.8.0·0.8.1의 상태 한 줄 카드를 대체한다). 앱 활성화(설정에서 권한을 바꾸고 돌아옴·캘린더 앱에서 일정을 바꿈)와 카드 추가 성공 뒤에는 마지막 5개 턴의 절·카드 상태를 다시 읽고, 전체 접근이 없으면 절을 지우고 카드는 캘린더 줄 대신 허용 안내를 둔다(EventKit 변경 알림은 구독하지 않는다). 인용에는 일정 시각이 없어 상태를 붙이지 않는다. **캘린더 내용은 기기 밖으로 나가지 않는다** — 서버·LLM은 캘린더를 보지 않고, 앱은 읽은 일정을 화면에만 쓴다(§12 통제 2). 그래서 "다음 주 비는 시간", "메일엔 3시인데 캘린더엔 몇 시?" 같은 섞어 답하기는 하지 못하고 목록만 보인다(섞어 답하는 안은 §16 UC-4, 사용자 확인 대기). 전체 접근이 없으면(추가만 허용 포함) 절을 그리지 않고 일정 질문에만 한 줄 "캘린더 접근을 허용하면 등록된 일정도 함께 확인합니다"(허용·설정 링크)를 두며 답변 자체는 그대로다.
- **일정 답 카드(2026-10-01 실기기 피드백, 앱 0.8.2)**: 답의 인용 항목에 일정 제안(`create_event`, 서버가 주는 `proposed`·`succeeded`)이 있으면 답 아래에 제안마다 카드 한 장을 둔다. 카드는 세 부분이다 — ① **찾은 곳**: "문자에서 찾은 일정"(출처는 같은 응답 `citations`에서 `item_id`로 찾은 `source`·`app_name` — 문자·메시지 앱 알림 "문자", Gmail "메일", 그 밖의 앱 알림 "<앱 이름> 알림", 공유 "공유한 내용", 못 찾으면 "저장된 정보"), 추출한 일정 "10/4(일) 15:30 제목"(날짜만이면 종일 "10/4(일) 종일 제목", 여러 날 "10/4(일)–10/6(화) 종일 제목" — 0.9.1, 전에는 "시간 미정"), "10/1 받은 문자 · 원문 보기"(원문은 기존 `ItemDetailView`·`/chat/item` 경로) ② **"내 캘린더 · 10/4(일)"**: 제안 날짜의 서울 하루 일정 — **일정 질문이 아니어도(`schedule` 없음) 읽는다**. 겹치는 일정은 어느 캘린더든 맨 위(주황), 그다음 종일("종일 제목"), 그다음 시작 순. 생일·구독 캘린더와 취소된 일정은 뺀다(겹친 일정은 빼지 않는다). 그날 안이면 `HH:mm–HH:mm 제목`, 날짜를 걸치면 `M/d HH:mm–M/d HH:mm 제목`(다음 날 0시에 끝나는 일정은 그날 안으로 본다 — "23:00–00:00", 상태 문구도 같은 표기), 최대 4줄 + "외 N건", 없으면 "이 날 등록된 일정 없음" ③ **상태**: 아래 순서에서 처음 걸리는 하나. 1) 이 제안 표식 일정이 같은 시작(분) "✅ 캘린더에 등록됨" 2) 표식 일정의 시작이 다름 "✅ 캘린더에 등록됨 · 캘린더에서는 10/5(월) 10:00" 3) 표식 없이 시작(분)·제목이 같은 일정 "✅ 같은 일정이 캘린더에 있음" 4) 표식을 못 찾았는데 이 기기 실행 기록이 있거나 서버 상태가 `succeeded` "이전에 추가한 일정 · 이 날 캘린더에서는 찾지 못함(옮겼거나 지웠을 수 있음)" — 1~4는 버튼 없음 5) §10 겹침 "⚠️ 아직 캘린더에 없음 · 겹치는 일정 15:00–16:00 제목"(여러 건이면 " 외 N건", 겹친 일정이 다른 ERURI 제안 표식이고 시작(분)이 같으면 끝에 " (같은 일정일 수 있음)") + [겹쳐도 추가] 6) "아직 캘린더에 없음" + [캘린더에 추가]. 표식 판정은 카드 날짜 ±1일 범위, 취소된 일정은 없는 것으로 본다. 서버 `succeeded`만으로 "등록됨"이라 하지 않는다(캘린더에서 지웠거나 다른 기기에서 넣었을 수 있다). **날짜만 있는 제안은 종일 일정(§10 "종일 일정", 0.9.1)**: 상태는 같은 순서에서 "같은 시작(분)" 대신 같은 서울 날짜의 종일 일정으로 본다 — 1) 이 제안 표식 종일 일정이 그 날짜 "✅ 캘린더에 등록됨" 2) 표식 일정이 다른 날 "✅ 캘린더에 등록됨 · 캘린더에서는 10/6(화) 종일"(시각 일정으로 바꿨으면 시각 표기) 3) 표식 없이 그 날짜·같은 제목의 종일 일정 "✅ 같은 일정이 캘린더에 있음" 4) 그대로 5) 겹침 없음(종일은 판정 대상이 아니다) 6) "아직 캘린더에 없음" + [종일 일정으로 추가]. **비슷한 일정(0.9.2, §10)**: 종일 제안은 1) 뒤에 다른 ERURI 제안 표식 + 같은 날짜 + 같은 정규화 제목 일정이 있으면 "✅ 캘린더에 등록됨"(같은 일정을 다른 제안으로 넣음), 4) 뒤에 제목이 비슷한 일정이 있으면 "✅ 캘린더에 비슷한 일정이 있음 · 10/8(목) 제목" + [그래도 추가](테두리, 확인창 없이 `confirmed = true`). 시각 제안은 5) 겹침이 없을 때만 같은 날 비슷한 제목을 같은 문구·버튼으로(겹침이 우선, §10 Ruling). 여러 날 종일 제안은 그 기간과 겹치는 날에서 찾는다. 종일 일정은 기기 시간대 0시로 오므로 서울 날짜로 옮겨 가른다(위 "그날 내 캘린더"와 같은 규칙). `uncertain`이 있으면 "내용 확인이 필요해 바로 추가하지 않음", 지난 일정(시각 < 지금, 날짜만은 그날이 끝남)은 "지난 일정". 무시한 제안은 서버가 주지 않아 카드가 없다. 제안이 여럿이면 `schedule`이 있을 때 그 기간 안에서 시작하는 것만, 다가올 일정을 시작 순으로 먼저, 지난 일정은 그 뒤에 최근 것부터. 같은 시작(분)·제목은 한 장(`succeeded`가 있으면 그것), 최대 3장 + "일정 제안 N건 더 있음". 카드가 있고 `schedule`이 없거나 카드 날짜 하루와 같으면 위 "기기 캘린더" 절을 따로 그리지 않고, 더 넓은 기간(주간 질문)이면 카드 아래에 절을 그대로 둔다. 카드 상태는 미리 보기이고 최종 판정은 저장 직전 §10 순서(`AddEventGate`)다. 답 문장의 시각과 카드의 추출 시각이 달라도 검출하지 않는다 — 두 값이 화면에 같이 보이고 원문 보기로 확인한다. 캘린더 전체 접근이 없으면 ①은 그대로, ② 자리에 첫 카드만 허용·설정 안내(이때 "기기 캘린더" 절의 안내는 생략), ③은 확인 필요·지난 일정 문구만 남고 버튼은 없다. 권한이 없어지면 화면에 남은 모든 턴의 카드에서 캘린더 줄·상태·버튼을 걷는다. 카드 버튼은 모양이 보이는 스타일(캘린더에 추가 = 강조 채움, 겹쳐도 추가 = 주황 테두리)이고 목록 행 탭이 아니라 버튼 자체 탭으로 눌린다(0.8.1 실기기에서 스타일 없는 카드 버튼이 텍스트처럼 보이고 눌리지 않았다). 성공하면 결과 문구 대신 상태가 "✅ 캘린더에 등록됨"으로 바뀌고, 실패 문구만 따로 보인다. 질문을 보내면 키보드를 내리고, 답이 오면 그 질문이 보이게 스크롤한다(그 턴이 화면보다 길면 질문이 맨 위에 오고 카드는 쓸어 올려 본다). 진단 로그에는 카드 수와 일정 기간 종류(없음·하루·넓음)만 남긴다.
- 채팅 음성 입력: 기기 안 받아쓰기(Speech, 온디바이스 전용, ko-KR), 서버 전송 없음 — 2026-10-01 사용자 요청. 받아쓴 글은 입력창에 채워질 뿐이고 보내기 전까지 전송되지 않는다(앱 0.6.0).
- 모든 발화는 `utterances`에 기록하되, 사실로 검색되는 것은 `memories`(statement 판정 또는 "기억해줘")뿐이다. "아니 그거 안 샀어" 같은 정정은 이전 memory를 retracted로 바꾼다.
- 구현(M2-⑧b, 0017): `POST /chat` `{question}`(≤500자) → `{answer_id, answer, refused, source_item_ids, citations(출처 메타 item_id·source·app_name·title·sender·occurred_at·expired = 원문 만료 여부), proposals(인용 항목의 제안 id·item_id·action·status·payload, proposed·succeeded), hits(문서 순서 = facts 우선 + 하이브리드, item 단위 중복 제거, 최대 12), candidates(위 "채팅 → 보관함 보기", ≤ 20, 거절이면 빈 배열 — R-A1, 2026-10-01 교체), schedule(위 "일정 질문과 기기 캘린더", `{from, to}` 또는 null — 거절·문서 0건이어도 싣는다)}`. `POST /chat/item` `{item_id}` → 본인 항목 원문 `{item_id, source, app_name, title, sender, occurred_at, expired, text}`(원문 만료면 text null, 남의 항목·형식 오류 404, 복호화 감사 actor `chat`). 필터는 gpt-6-luna(effort none, {date_from, date_to, event_from, event_to, sources, kinds, merchant}, 서울 날짜, 사용자 메시지에 오늘 날짜와 요일). 기간은 메일·문자를 **받은/저장한** 기간을 말할 때만 채우고 일정·약속·기한의 날짜("10월 20일 미팅", "다음 주 약속")는 null 이다(Ruling D, 0019). 그 날짜는 `event_from`·`event_to`에 넣는다(2026-10-01 — "다음 주" = 그 주 월요일~일요일, "10월 3일"·"이번 주 토요일" = 그날 하루). 받은 기간과 일정 날짜가 한 질문에 둘 다 있으면("지난달 받은 메일 중 10월 20일 미팅") 둘 다 채운다. 달력에 없는 날짜(`2026-02-30`)·거꾸로 된 범위는 null 로 버린다. `search_facts`(0024)는 받은 기간(`date_from/to`)을 **항상** 받은 시각(`occurred_at`)에 걸고, 일정 기간(`event_from/to`)은 event·task 행의 `fact_when`(event 는 `payload.start`·task 는 `payload.due`, 날짜만이면 서울 0시, 없거나 해석 불가면 받은 시각)에만 건다 — 구매 등 다른 종류에는 걸지 않는다. 일정 기간이 있으면 시작 순 상위 8, 없으면 받은 시각 역순 상위 5다(가까운 일정이 늦게 받았다고 빠지지 않게). 하이브리드의 `date_from/to`(받은 시각) 의미는 그대로고, 기간 필터로 0건이면 기간만 빼고(출처 유지) 한 번 더 검색한다 — 필터가 일정 날짜를 받은 기간에 잘못 넣을 때의 안전망은 이 폴백뿐이다(0019 의 facts 쪽 안전망은 "9월에 받은 예약"을 9월 시작 일정으로 거르는 부작용이 있어 0024 에서 뺐다, 외부 리뷰 반영 2026-10-01). facts 는 종류·가맹점 조건이 있을 때만(`search_facts`, 가맹점은 부분 문자열), 답변은 예산 80% 미만 gpt-6-sol·이상 gpt-6-luna(effort low). 서버가 읽은 item_id 목록(facts + 하이브리드, 모델에 넣지 않고 12개 밖으로 버린 것 포함)은 `audit_log(action='read', target=목록 SHA-256)`. 예산 소진 `429 budget_exhausted`, LLM 슬롯 없음은 서버가 1초·2초 두 번 기다렸다 다시 시도한 뒤에도 없으면 `503 llm_busy`(retry-after 30). 답변 형식은 `{answer, source_item_ids, refused}`(PoC-7 측정 형식, Ruling 5) — 위 그림의 문장별 인용·"근거 미확인"은 1단계 계획 "스펙 확인 필요" #5로 보류. `memories` 단계는 1단계 제외(Ruling 7).

## 10. 실행

- 푸시 카테고리 `ADD_EVENT`, `ADD_REMINDER`, `REVIEW`, `EVENT_BUNDLE`(2026-10-01, 앱 0.9.0). 액션 "추가"는 `authenticationRequired`, "무시", "앱에서 수정"은 `foreground`. `uncertain`이 있는 제안은 REVIEW로만 보낸다.
- 제안 푸시 페이로드(0b): `aps.alert` 제목 `일정 제안`·`일정 확인 필요`·`할 일 제안`, 본문 `M월 D일(요) HH:mm · <추출 제목 ≤40자>`
  (원문 본문 금지, §12). `aps.category`: `ADD_EVENT`(시각 있는 시작 또는 날짜만(종일, 0.9.1) + uncertain 없음) · `REVIEW`(uncertain 있음) · `ADD_REMINDER`(할 일).
  최상위 키 `proposal_id`, `title`, `start`(`ADD_EVENT`면 `YYYY-MM-DDTHH:mm:ss+09:00` 또는 날짜만 `YYYY-MM-DD` = 종일) 또는 `due`. 1단계(M1-②b)부터 `version`(제안 버전 정수)도 싣는다 — 순서 5(오프라인 실행 후 보고 시 불일치 판정)에 쓴다.
  `end`는 종일 `ADD_EVENT`가 여러 날일 때만 싣는다(마지막 날 `YYYY-MM-DD`, 서울 — 제안 end 가 날짜만이거나 시각이면 그 서울 날짜이고 시작 다음 날 이후일 때만). 시각 있는 일정은 end 를 싣지 않는다(저장은 1시간).
  **묶음 푸시(2026-10-01 사용자 결정, 앱 0.9.0)**: 한 항목에서 푸시할 일정 제안이 2건 이상이면(§7 notify) 알림 1건 — `aps.category` `EVENT_BUNDLE`,
  `aps.alert` 제목 `일정 제안 N건`, 본문 `<가장 이른 일정의 M월 D일(요) HH:mm 또는 M월 D일(요)> · <그 제목 ≤40자> 외 N−1건`. 최상위 `proposal_id`·`version`·`title`·`start`는
  가장 이른 일정의 값(하위 호환), `events`는 시작 순 배열(최대 5, 날짜만은 그날 서울 0시로 본 순서) — 원소마다 `proposal_id`·`version`·`title`(≤40자)·`start`·(종일 여러 날이면 `end`)·`category`(그 일정을 단건으로 보냈을 때의
  `ADD_EVENT`·`REVIEW`). 5건·40자에서도(종일 `end` 포함) 4KB 미만. **잠금화면 액션은 없다**(배너 탭 → 시트만): "모두 추가"는 순서 1·4의 마감(조회 5초 + 보고 5초)이 N배가 되어
  백그라운드 실행 시간 안에 끝난다는 보장이 없고(PoC-5 — 완료 핸들러는 메인에서 정확히 1회), 겹치면 저장 대신 로컬 알림을 띄우는 잠금화면 겹침 규칙(아래)이 N건에서
  일부 저장 + 겹침 알림 여러 개가 되며, 날짜 여러 개 공지는 회차 중 하나를 고르는 경우가 흔해 전부 넣기가 뜻이 아닐 수 있다. 1건이면 지금과 같다(`ADD_EVENT` 잠금화면
  "캘린더에 추가" 유지). 0.8.3 이하 앱은 이 카테고리를 등록하지 않아 배너 탭이 앱만 연다 — ADD_EVENT 일정은 제안 탭에 보이지만 날짜만·확인 필요 일정은
  보이지 않으므로 앱 0.9.0을 서버 배포보다 먼저 올린다
  0단계 앱은 `ADD_EVENT`만 등록하므로 `REVIEW`·`ADD_REMINDER`는 버튼 없는 알림으로 보인다. 제품 앱(1단계 M1)은 세 카테고리를 모두 등록하고
  `ADD_REMINDER`·`REVIEW`는 알림 액션 버튼이 없다(배너 탭은 아래 제안 리뷰의 시트). `ADD_EVENT`의 "무시"는 캘린더 권한이 없어도 남기고 "추가"만 숨긴다
- **종일 일정(2026-10-01 실기기 · 사용자 결정 A, 앱 0.9.1)**: 날짜만 있는 일정 제안(`start` = `YYYY-MM-DD`, uncertain 없음)은 **종일 일정**으로 추가하고, 시각이 있으면 지금처럼 그 시각으로(1시간) 추가한다.
  전에는 푸시만 `REVIEW`로 가고 목록·채팅 카드에서 빠져 처리할 곳이 없었다. 앱 해석(EruriCore `ProposalTiming`, 알림 액션·제안 탭·묶음 시트·채팅 카드 공용):
  `start`가 오프셋 있는 시각이면 시각, 달력에 있는 날짜만이면 종일 — 첫날 = 그 서울 날짜, 마지막 날 = `end`(날짜만이거나 시각의 서울 날짜)가 첫날보다 뒤면 그날, 아니면 첫날.
  EventKit 은 `isAllDay = true`, 시작 = 기기 달력의 첫날 0시, 끝 = 마지막 날 0시(하루면 같다 — 서울 날짜를 기기 시간대의 같은 날짜로 옮겨 날짜가 밀리지 않게).
  표식(`url`)·실행 기록·보고·멱등은 시각 일정과 같다(순서 1~5, 표식 조회 창은 첫날 서울 0시 −1일 ~ 마지막 날 다음 날 0시 +1일 — 0.9.1은 첫날 ±1일, 0.9.2에서 비슷한 일정을 기간 전체에서 보려고 넓힘). **종일은 겹침 판정 대상이 아니다**(기존 일정 쪽 종일을 겹침에서 빼는 규칙과 같은 이유 — 하루를 차지하지 않는다) — 그래서 "겹쳐도 추가"·확인창·잠금화면 겹침 로컬 알림이 없다.
  표시: 시트·제안 탭 "10/8(목) · 종일"(여러 날 "10/8(목)–10/10(토) · 종일", 확인 필요(REVIEW)는 "10/8(목)"만), 버튼 "종일 일정으로 추가". 잠금화면 "캘린더에 추가"도 종일로 저장한다.
  배포 순서: **앱 0.9.1 → 마이그레이션 0026 → 함수(worker notify)**. 0.9.0 앱은 날짜만 `ADD_EVENT` 잠금화면 액션을 `invalid_payload`로 버리고(저장 없음), 목록의 날짜만 행은 추가 버튼 없이 날짜만 보인다(무시는 된다) — 잘못된 0시 일정은 생기지 않는다.
- **비슷한 일정(2026-10-01 사용자 결정, 앱 0.9.2)**: 종일은 겹침 판정 대상이 아니므로 "같은 일정이 이미 있는가"로 중복을 잡는다 — **느슨하게** 잡고 사용자가 보고 "그래도 추가"를 고른다.
  판정(EruriCore `ProposalFlow.similar`·`TitleMatch`, 순수 함수): 제안 날짜(종일이면 그 기간과 겹치는 서울 날짜, 시각이면 그 시각의 서울 하루)에 걸친 캘린더 일정(종일·시각 모두,
  종일 일정은 기기 시간대 0시로 오므로 서울 날짜로 옮겨 가른다) 중 제목이 비슷한 것. 제외: 취소, 생일·구독 캘린더(§9 카드 줄과 같은 규칙), 이 제안 표식(복구 경로).
  비슷함 = 정규화(소문자, 글자·숫자만 — 공백·기호·괄호 제거) 후 같음, 또는 한쪽이 다른 쪽을 포함(짧은 쪽 정규화 길이 ≥ 2 — 1글자는 거의 모든 제목에 들어 있다),
  또는 그 일정이 **ERURI 제안 표식**(다른 제안)을 가졌고 공통 핵심어(2글자 이상 이어진 한글 덩어리, 같거나 한쪽이 다른 쪽을 포함 — 조사가 붙어도)가 하나 이상. 표식 없는 일정은
  핵심어만 같아서는 비슷하다고 보지 않는다("합성 치과 예약"과 "합성 미용실 예약").
  **Ruling(시각 제안)**: 기존 겹침 규칙(아래 순서 3)이 우선이고, **겹침이 없을 때만** 같은 날 비슷한 제목을 "비슷한 일정"으로 보인다(겹침이 있으면 "겹치는 일정"과 "겹쳐도 추가"만 —
  사용자에게 같은 확인을 두 번 받지 않는다). 종일 제안은 겹침이 없으므로 비슷한 일정만 본다. 한 판정을 미리 판정(`ProposalFlow.preview`)·저장 직전(`AddEventGate`)·채팅 카드가 같이 쓴다.
  **같은 일정을 다른 제안으로 이미 넣음**: 종일 제안에서 비슷한 일정이 다른 ERURI 제안 표식 + 같은 서울 날짜(첫날) + 같은 정규화 제목이면 "✅ 캘린더에 등록됨"(기존 상태)으로 보이고 추가 버튼을 두지 않는다(무시만).
  표시(제안 탭 행·단건·묶음 시트 카드): 상태 줄 "✅ 캘린더에 비슷한 일정이 있음 · 10/8(목) <제목>"(그 일정의 서울 시작 날짜, 여러 건이면 " 외 N건", 제목은 기기 화면에서만) + 버튼 "그래도 추가" —
  누르면 확인창 없이 `confirmed = true`(사용자가 보고 누름, 겹침의 "겹쳐도 추가"와 같다). 채팅 카드는 §9 상태 순서.
  잠금화면 "캘린더에 추가"(앱을 열지 않는 경로): 비슷한 일정이 있으면 저장하지 않고 겹침과 같은 방식의 로컬 알림 1건 — 제목 "비슷한 일정이 있습니다", 본문 "캘린더에 비슷한 일정 N건 · 탭해서 확인"
  (일정 제목은 잠금화면에 쓰지 않는다), 식별자·카테고리·`userInfo`·2초 마감·완료 핸들러 메인 1회는 겹침 알림 그대로(PoC-5).
  서버 중복(§7 notify, 0027)은 같은 날짜 + 같은 정규화 제목의 **대기 제안끼리**만 푸시에서 빼고, 이미 캘린더에 넣은 일정과의 비교는 이 앱 판정이 한다.
  배포 순서: **앱 0.9.2 → 마이그레이션 0027 → 함수(worker)**. 0027 없이 워커만 배포돼도 피어 조회 실패 → fail-open(지금처럼 푸시). 0.9.1 앱은 서버 변경과 무관하다(푸시 페이로드 불변).
- 제안 리뷰(1단계, Ruling 8' 2026-09-30): 알림을 놓치거나 잠금화면에서 길게 누르지 않고 배너를 탭하면 등록 수단이 없던 공백을 메운다.
  - **배너 탭**(기본 동작, 제안 id가 있는 알림): 앱을 열고 그 제안의 시트(제목·시각·장소, "캘린더에 추가"·"무시")를 띄운다. 콜드 스타트에서도 대기 딥링크를 보관했다가 UI 준비 뒤 표시한다.
    `REVIEW`·`ADD_REMINDER` 알림의 시트는 "무시"만 둔다(시각을 확정할 수 없어 추가는 2단계 수정 화면).
    `EVENT_BUNDLE` 알림은 시트 하나에 `events` 순서대로 카드 N장을 두고 카드마다 따로 추가·무시한다. 판정은 목록(50건 제한·ADD_EVENT 조건만)이 아니라 알림에 든
    제안 id(≤5)의 상태를 직접 조회해서(`proposals?id=in.(…)&select=id,status`, 본인 행, 목록 조회와 같은 5초 마감으로 병렬): status ≠ proposed → "이미 처리됨"(REVIEW 포함),
    proposed + 목록에 있음 → 서버 값, proposed + 목록에 없음 → 알림 값(안내 문구 없이), `REVIEW` 일정은 "무시"만, 상태 조회 실패 → 위 단건 판정 그대로(목록에 없으면
    "이미 처리됨", 목록도 못 읽으면 알림 값). 카드마다 겹침 미리 판정·"겹쳐도 추가" 규칙(아래)이 그대로다. 캘린더 권한 안내는 시트 맨 위에 한 번
  - **"무시"**(알림 액션·시트·"제안" 탭 공통): 앱이 사용자 JWT로 `dismiss_proposal(p_proposal)` → `ok`(이미 dismissed여도 ok, 재전송 멱등)·`not_pending`(succeeded·stale 등)·`not_found`. 본인 `proposed` 제안만 `dismissed`가 된다.
  - **제안 탭 전체 무시**(0.5.0): 목록이 있을 때 "전체 무시" → 확인창("대기 중인 제안 N건을 모두 무시할까요?"). 서버 새 경로 없이 앱이 목록의 id마다 `dismiss_proposal`을 반복(동시 2, 요청당 8초 마감), 끝나면 "N건 무시, 실패 M건"을 보이고 새로고침한다. 실패한 행은 남는다.
  - **대기 목록** `list_pending_proposals()`: 본인·`proposed`·푸시 `ADD_EVENT` 조건(create_event, 시각·오프셋 있는 start 또는 날짜만(종일), uncertain 없음)·시각은 start > 지금−1시간, 종일은 start 날짜(서울)가 아직 끝나지 않음(≥ 오늘)·생성 30일 이내, 시작 오름차순(종일은 그날 서울 0시로 본다, 같으면 id) 최대 50행. 행 `{proposal_id, action='ADD_EVENT', title(푸시와 같이 ≤40자), start, end, all_day, location, version, created_at}` — 0026(0.9.1)부터 `start`·`end`는 text: 시각 일정은 서울 ISO `YYYY-MM-DDTHH:MI:SS+09:00`(end 는 형식이 맞을 때만), 종일(`all_day = true`)은 `YYYY-MM-DD`이고 `end`는 마지막 날(시작 다음 날 이후일 때만, 아니면 null). 확인 필요(REVIEW)·할 일은 목록에 없다(수정 화면은 2단계). 백필 제안(§7, 푸시 안 함)도 조건이 맞으면 목록에 나온다. start·end 는 캘린더상 불가능한 값이면 행 단위로 거른다(start 면 행 제외, end 면 null — 0022, 날짜만도 같다). 반환 열이 바뀌어 0026 은 함수를 drop 후 다시 만들고 권한(authenticated 만)을 다시 건다.
  - 캘린더 추가는 새 경로를 만들지 않고 알림 액션·채팅 카드와 같은 멱등 핸들러(아래 순서 1~5, `report_execution`)를 쓴다.
  - **겹침 확인 화면(2026-10-01, 앱 0.8.0 · 확인창 범위 0.8.1)** — 판정은 순서 3 한 곳이고 화면은 알리고 확인받기만 한다:
    - 잠금화면 "캘린더에 추가": 앱을 열지 않아 확인 UI가 없으므로 `conflict`면 저장 대신 **로컬 알림 1건**을 띄운다 — 제목 "겹치는 일정이 있습니다", 본문 "같은 시간에 일정 N건 · 탭해서 확인"(겹친 일정의 제목은 잠금화면에 쓰지 않는다. "다른 일정"이라 하지 않는다 — 메일 초대·예약은 같은 일정이 이미 캘린더에 있는 경우가 흔하다), 카테고리 `ADD_EVENT_CONFLICT`(액션 버튼 없음), 식별자 `conflict-<proposal_id>`(두 번 탭해도 1건), `userInfo`는 원래 제안 필드(proposal_id·title·start·version) 그대로. 탭하면 배너 탭 경로로 그 제안의 시트가 뜬다(목록을 못 읽으면 알림 값으로 추가 — `ADD_EVENT`와 같다). 완료 핸들러는 기존처럼 메인 스레드에서 정확히 1회, 추가되는 일은 네트워크 없는 로컬 알림 등록 1회뿐이고 그것도 **2초 마감**으로 감싸 결과(`ok`·`fail`·`timeout`)를 진단 로그와 `action.handled`의 `notice`에 남긴다. `conflict`면 순서 4 보고(5초)를 건너뛰므로 정상 경로보다 짧다(PoC-5). 그 제안을 앱에서 추가(`ok`·`recovered`·`dup`)하거나 무시하면 알림 센터에 남은 이 알림을 지운다(외부 리뷰 반영 2026-10-01). 액션을 `foreground`로 바꾸는 안은 겹침과 무관하게 매번 앱이 열려 잠금화면 한 번 탭 추가를 잃어 기각, "저장 후 알림" 안은 "겹치면 확인" 요청에 어긋나 기각.
    - 비슷한 일정(0.9.2)도 같은 로컬 알림 경로다(위 "비슷한 일정" — 제목·본문만 다르다).
    - 제안 시트·"제안" 탭 행: 뜰 때 미리 판정해 "겹치는 일정: HH:mm–HH:mm 제목"(여러 건이면 "외 N건") 줄을 보이고 버튼을 "겹쳐도 추가"로 바꾼다. 누르면 **확인창 없이** `confirmed = true`로 핸들러를 부른다 — 사용자가 겹침을 이미 보고 고른 것이라 한 번 더 묻지 않는다(2026-10-01 실기기 C2 피드백, 앱 0.8.1). 앱 활성화 때 다시 판정한다.
    - 채팅 일정 답 카드(§9, 0.8.2): 상태가 겹침("⚠️ 아직 캘린더에 없음 · 겹치는 일정 …")이면 버튼이 "겹쳐도 추가"이고 같은 규칙으로 확인창 없이 `confirmed = true`. "아직 캘린더에 없음"이면 "캘린더에 추가"(`confirmed = false`). 종일 제안은 겹침이 없어 "아직 캘린더에 없음" + "종일 일정으로 추가"(`confirmed = false`)다(0.9.1). 등록됨·같은 일정·이전에 추가함·확인 필요·지난 일정은 버튼이 없다.
    - 확인창은 **미리 판정이 겹침 없음("캘린더에 추가")이었는데 저장 직전 판정에서 겹침이 나온 경우만** 띄운다: 그사이 캘린더가 바뀌어 순서 3이 `conflict`를 돌려주면, 다시 읽고 확인창("같은 시간에 '제목' 일정이 있습니다. 그래도 추가할까요?" → 추가/취소) 뒤 `confirmed = true`로 다시 부른다(게이트 C2-5, 한 경로). 판정은 EruriCore `ProposalFlow.tapConfirmed`·`needsConfirm`. "겹쳐도 추가"(겹침 A를 보인 상태)를 누를 때 그사이 겹침 B가 새로 생겼어도 묻지 않고 저장한다 — 사용자가 이미 겹침을 감수하고 고른 것이라 감수한다(리뷰 Minor 3, 2026-10-01).
- 액션 핸들러 순서 (멱등):
  1. 서버에서 proposal 최신 버전 조회(토큰 갱신 포함 5초 마감, 넘으면 받은 버전으로 진행). `stale`·`succeeded`면 중단하고 안내. 서버 version이 더 새로워도 여기서 중단하지 않고, 푸시로 받은 version(실제로 넣은 내용)으로 기록·보고해 순서 5의 불일치 판정에 맡긴다. 핸들러 안 보고는 방금 처리한 1건만, 나머지 미보고분은 앱 활성화 때 보낸다.
  2. 로컬 `executions` 테이블(App Group SQLite)에 proposal_id가 있으면 재쓰기 없이 보고만 재시도.
  3. EventKit 쓰기 → 성공 즉시 로컬 executions에 (proposal_id, eventkit_id) 기록.
     **2~3단계는 한 직렬 구간에서 원자적으로 수행한다.** 확인 → 저장 → 기록을 하나의 actor 메서드 안에서 `await` 없이 처리한다(PoC `AddEventGate`). 액션 핸들러는 동시에 여러 번 불릴 수 있어(같은 proposal_id의 알림 두 개를 연달아 탭) 둘 다 "기록 없음"을 보고 저장하면 `INSERT OR IGNORE`로 기록은 1건이어도 이벤트는 2건이 된다. 시뮬레이터 실측: 동시 두 번 탭에서 이벤트 +1만 생성(PoC-5).
     **저장 후 기록 전에 프로세스가 죽으면** 재탭 시 중복이 생길 수 있다. 대응: 저장하는 이벤트의 `url`에 `assistant://proposal/<proposal_id>` 표식을 넣고, 로컬 기록이 없을 때는 쓰기 전에 제안 시각 ±1일의 이벤트를 조회해 같은 표식이 있으면 새로 만들지 않고 그 `eventIdentifier`로 기록만 복구한다.
     **겹침 확인(2026-10-01 사용자 요청, 앱 0.8.0)**: 표식 조회에 쓴 같은 ±1일 일정 배열로 겹침을 판정한다(같은 직렬 구간 — EventKit 조회·`await`가 늘지 않는다). 저장할 구간 `[start, start+1시간)`과 겹치는 일정이 있으면 겹침이다(종일 제안은 판정하지 않는다 — 위 "종일 일정", 0.9.1). 제외: 종일 일정, 취소된 일정, 같은 제안 표식을 가진 일정(복구 경로). 맞닿기만 하면(끝 = 시작) 겹침이 아니다. 겹침이 있고 사용자가 확인하지 않았으면(`confirmed = false`) **저장하지 않고** `conflict:<건수>`를 돌려준다. `conflict`는 실패가 아니다: 서버 보고(순서 4)를 하지 않고 제안은 `proposed`로 남아 "제안" 탭에 계속 보인다. `confirmed = true`면 겹침 판정만 건너뛴다(기록 확인·표식 복구는 그대로).
     **비슷한 일정(0.9.2)**: 겹침이 없으면 같은 배열로 위 "비슷한 일정" 판정을 하고, 있으면(`confirmed = false`) 저장하지 않고 `similar:<건수>`를 돌려준다 — `conflict`와 같은 취급(실패 아님, 보고 없음, 제안은 `proposed`).
     `confirmed = true`면 이것도 건너뛴다. 확인창은 미리 판정이 아무것도 보이지 않았는데 저장 직전에 겹침·비슷한 일정이 나온 경우만(`ProposalFlow.needsConfirm`, 비슷한 일정 문구 "캘린더에 비슷한 일정이 있습니다 — '제목'. 그래도 추가할까요?").
  4. 서버 `executions` 보고.(앱이 사용자 JWT로 `report_execution` RPC 호출 → `ok`·`changed`·`stale`·`not_found`, 성공 시 제안 status = succeeded) 실패하면 다음 앱 실행 시 로컬 미보고 항목을 재전송.
  5. 오프라인이면 순서 1의 서버 조회를 건너뛰고 마지막으로 받은 버전으로 실행하되, 보고 시 서버가 version 불일치를 감지하면 사용자에게 "변경된 제안" 알림.
- `update_event`는 `eventkit_id`로 원본을 찾고, 사용자가 캘린더에서 직접 수정한 흔적(lastModifiedDate > 제안 시각)이 있으면 자동 갱신하지 않고 REVIEW로 보낸다. 원본이 삭제됐으면 제안을 stale 처리.
- `complete_reminder`는 미리알림 `isCompleted`만 바꾼다.
- 읽기 전용 캘린더는 대상 목록에서 제외. 권한 철회 시 모든 proposal을 보관함에만 표시하고 푸시 액션을 숨긴다.
- 반복 일정은 1단계(제품) 범위 밖. 추출 결과에 반복 표현이 있으면 단일 일정 + uncertain=["recurrence"].
- 채팅에서 "기억해줘"와 "캘린더에 추가"는 별개 동작이다.

## 11. 앱 구조

| 타깃 | 역할 |
|---|---|
| `Eruri` (앱, 표시 이름 `ERURI`) | 채팅, 보관함, 제안 리뷰, 연결·권한, 자동화 설치 가이드(2단계), EventKit, 알림 액션, CaptureIntent/AskIntent/QuickMemoryIntent |
| `ShareExtension` | 입력 수신 → 큐 |
| `ControlExtension` (WidgetKit) | 컨트롤센터/액션버튼 "빠른 기억" 버튼(OpenIntent) |
| `EruriCore` (Swift Package) | 큐, 규칙 필터, FM 분류, API 클라이언트, 모델. 단위 테스트 대상 |
| `supabase/` | 마이그레이션, Edge Functions(Deno/TS), 테스트 |

1단계 제품 번들 ID 는 `com.picpal.eruri`, App Group `group.com.picpal.eruri` 로 새로 등록한다(0단계 PoC 는 이미 등록·TestFlight 배포된 `com.picpal.assistant.poc`·`group.com.picpal.assistant` 유지).

1단계 앱 탭: **채팅 | 제안 | 보관함 | 설정**. "제안" 탭은 `list_pending_proposals` 목록에 행마다 "캘린더에 추가"·"무시", 당겨서·앱 활성화 때 새로고침, 캘린더 전체 접근이 없으면 추가 버튼 대신 권한 안내(§10 제안 리뷰, Ruling 8'). 보관함은 채팅 "보관함에서 보기"로 그 질문의 검색 후보만 보이는 범위 모드가 되고(§9), 항목 상세에 "요약" 절, 설정에 "저장 공간" 절(§8 용량 보호)을 둔다(2026-10-01. 채팅→보관함은 앱 0.7.0, 채팅 "기기 캘린더" 절·제안 카드 상태·겹침 확인(§9·§10)은 0.8.0("겹쳐도 추가" 확인창 생략은 0.8.1, 일정 답 카드는 0.8.2), 다건 일정 묶음 알림 시트는 0.9.0, 날짜만 제안의 종일 추가는 0.9.1, 요약·저장 공간 화면은 서버 반영 뒤라 0.10.0). 캘린더 권한 문구(`NSCalendarsFullAccessUsageDescription`)는 "등록된 일정을 확인하고 제안된 일정을 추가합니다. 일정 내용은 기기 밖으로 보내지 않습니다."(0.8.0 — 전에는 추가만 적었다).

**제품 분리 시점과 방식** (2026-09-30 결정): 1단계 Task 1(서버)·Task 2(앱)가 분리 자체다.

| 항목 | 결정 |
|---|---|
| 번들·타깃 | `com.picpal.eruri`, App Group `group.com.picpal.eruri`, Xcode 타깃 `Eruri` + `ShareExtension`. `EruriCore` 패키지는 그대로 쓴다. `EruriPoC` 타깃은 손대지 않고 얼린다 |
| Supabase | 새 프로젝트 `eruri`(ap-northeast-2). 새 `MASTER_KEY`·service role·publishable 키(PoC 키 재사용 금지). 마이그레이션은 PoC 0001~0018을 제품 베이스라인 `0001_baseline.sql` 하나로 squash하고, 진단 trace·테스트 범위는 `0002_diagnostics`·`0003_test_scope`로 이력 구분용으로 분리한다(되돌리지 않는다 — ingest가 `device_traces`, 워커가 `claim_jobs(p_lease_prefix)`를 쓴다). Edge 함수는 `poc/server`를 `supabase/`로 옮기며 이름·secrets만 정리 |
| Google | iOS OAuth 클라이언트는 번들 ID에 묶이므로 새 iOS 클라이언트 1개. Web 클라이언트·동의 화면·테스트 사용자는 재사용. Pub/Sub는 새 웹훅 URL로 구독을 새로 만든다 |
| APNs | 키 `Q8469KDH4D`는 Team scoped라 재사용. `APNS_TOPIC`만 새 번들. TestFlight는 새 앱 레코드 |
| 버전 | 제품 앱 `MARKETING_VERSION`은 **0.3.0**부터(0.2.x는 PoC). 메이저는 올리지 않고 빌드 번호 규칙은 그대로(AGENTS.md §8) |
| PoC 데이터 | **이전하지 않는다**. PoC 키로 감싼 본문을 새 마스터 키로 다시 감싸려면 에이전트가 복호화 스크립트를 돌려야 하고(AGENTS.md §7 경계), Gmail 90일 백필(≈$0.5·1시간)이면 같은 데이터가 다시 생기며, 메시지·알림 항목은 새 자동화부터 쌓인다 |
| PoC 프로젝트 은퇴 | M1 게이트 통과(제품 앱이 자동화·Gmail을 넘겨받음, §15) 직후: PoC 앱에서 Gmail 연결 해제(revoke) → PoC 사용자 삭제(cascade, `user_keys` 삭제 = crypto-shred) → 프로젝트 일시정지 → 1단계 종료 시 삭제. 은퇴 일자는 `results.md`에 기록. 은퇴 전까지는 두 앱이 같은 자동화를 받을 수 없으므로 자동화를 새 앱으로 옮기는 시점 = M1 게이트 실기기 세션 |

**PoC 코드 재사용**: `EruriCore`와 `poc/server`(→ `supabase/`)는 리뷰 1회를 거쳐 제품으로 승격한다 — PoC 번들 문자열·디버그 훅·`poc_traces` 의존을 제거하고 파일별 "제품 승격" 체크를 남긴다(계획서 Task 1·2). 버리는 것: `EruriPoC` 앱 타깃(UI·PoC 계정 로그인·벤치마크 화면), `poc/ios` XCUITest 중 PoC UI에 의존하는 테스트.

## 12. 개인정보

이 앱은 Superhuman·Spark 같은 서버 동기화형 메일 비서와 같은 구조다. 서버에 본문이 있으며, 그 사실을 숨기지 않고 아래 다섯 통제로 보호한다. 온디바이스 저장 구조는 실시간성·백그라운드 처리를 잃어 채택하지 않았다(§16 플랜 B).

### 통제 1. 저장 암호화와 키 분리 (보호 범위를 정직하게)

- 방식: **봉투 암호화를 Edge Function에서 수행**한다. 사용자별 데이터 키(32바이트)는 마스터 키(Edge 시크릿 `MASTER_KEY`, DB에 없음)로 감싸 `user_keys.wrapped_key`에 둔다. 본문은 WebCrypto AES-256-GCM으로 `ingest`·`gmail-fetch`가 INSERT 전에 암호화한다. pgsodium은 Supabase가 폐기 예정으로 안내하므로 쓰지 않는다.
- 복호화는 `worker`(추출·청크 생성)와 `chat`(출처 원문 표시) 두 함수만 메모리에서 수행하고, 복호화된 평문을 응답 로그·오류 로그에 남기지 않는다. DB 함수·대시보드에서는 복호화가 불가능하다(마스터 키가 DB에 없음).
- **보호 범위**: 이 암호화가 지키는 것은 **메일 원문 전체와 이미지·OCR 원문, 항목 요약 문장**(`item_summaries.summary_enc`, 2026-10-01)이다. `item_chunks.text`, `item_summaries.keywords`, `facts.payload`·`evidence`, `purchases`, `memories`는 검색·답변에 필요해 평문이며, 청크를 이어 붙이면 원문 상당 부분이 복원된다. 따라서 "DB 덤프가 유출돼도 안전"하다고 말하지 않는다. **2026-10-01 보관 3년 결정의 영향**: 청크 평문을 원문과 같이 3년 두면 덤프 유출 시 노출 범위가 "최근 90일 청크"에서 **"최근 3년 청크(마스킹된 본문 상당 부분)"**로 넓어진다 — 통제 2의 "짧은 보관"이 청크에는 더 이상 성립하지 않는다. 그래서 청크 평문 기간은 사용자 확인 대기다(§16 UC-1). **권장(안 B)**: 수집 90일까지만 청크 `text` 평문, 그 뒤에는 청크 본문을 사용자 키로 암호화(`text_enc`)하고 평문을 지우며 임베딩은 3년 유지 — 의미 검색·답변(chat이 상위 문서만 복호화)은 3년 그대로, 키워드 검색은 90일 이후 원문에서 빠지고 요약 키워드·facts가 대신한다. 덤프 노출은 지금과 같은 "최근 90일 청크 + 요약 키워드 + 추출 사실". 안 A(3년 평문)는 구현이 없고 키워드 검색 3년, 노출 3년. 안 C(청크 전부 암호화)는 최근 항목의 키워드 검색까지 잃어 PoC-7 하이브리드(38/40)의 키워드 몫을 버린다(1단계 검색 평가 재측정 필요) — 비권장. 임베딩 벡터도 평문이며 짧은 문장은 벡터에서 일부 복원될 수 있다(임베딩 역추정 연구) — 512차원 축소로 완화될 뿐 없어지지 않는다. 요약 `keywords`는 키워드 검색에 필요한 최소 평문(사람·기관·가게·상품·장소·금액·날짜)으로 `facts.payload`와 같은 등급이다(요약 문장을 평문으로 두는 것과의 차이는 문장 관계가 없다는 정도로 크지 않다 — §16 UC-3). 계획은 Codex·Fable 리뷰 권고대로 안 B를 기본값으로 구현한다(계획 R-B7 필수 태스크, 사용자 확인 대기 — A로 답하면 `chunk-cool-daily` cron만 끈다). 12-29 전에는 90일 넘은 청크가 없어 B를 켜도 암호화 대상이 없다. 원문·요약 암호문(3년·영구)은 덤프만으로는 복호화되지 않는다(마스터 키가 DB에 없다). 실제 1차 방어는 통제 4(접근 통제)와 통제 2(최소화)다.
- Storage 객체(이미지·PDF)는 업로드 전 기기에서 같은 사용자 키로 암호화할 수 없으므로(키가 서버에만 있음) Supabase 서버 측 암호화 + 비공개 버킷 + 서명 URL(60초)로 보호하고 30일 뒤 삭제한다.
- crypto-shredding은 **계정 전체 삭제에만** 적용한다(사용자당 키 하나). 부분 삭제는 행 삭제로 처리하며 백업 보관 기간(7일) 동안 평문 파생물이 백업에 남는다는 점을 통제 5에 명시한다.

### 통제 2. 최소화와 짧은 보관

- 수집 제외: 프로모션 라벨, 첨부파일(이미지·PDF는 사용자가 공유한 것만), OTP, 카드·계좌번호(마스킹), 카톡 개인 대화, 의료 결과지.
- 원문·청크 3년(2026-10-01, 사용자 결정 — 이전 90일), 이미지 파일 30일 뒤 삭제. 원문 삭제 뒤에는 항목 요약(암호화, 영구)·추출 사실·구매 이력·`evidence` 인용(≤300자)이 남아 검색은 계속된다. DB가 한도에 가까우면 3년 전이라도 오래된 원문부터 비운다(§8 용량 보호) — 보관 기간 3년은 상한이지 보장이 아니다(무료 플랜에서 실질 약 1.2~1.5년, §16 UC-2). 청크 평문 기간은 §16 UC-1.
- 기기 입력은 기기에서 먼저 필터·마스킹 후 전송한다. Gmail은 서버가 직접 받으므로 "기기에서 먼저 마스킹"이라고 설명하지 않는다.
- 처리 순서(§7과 동일): 규칙 필터(기기·서버) → 암호화 저장 → 워커가 복호화 → 분류 게이트(Jev) → 폐기 판정 시 7일 격리 후 본문 삭제(1인 사용 기간, §7) → 통과분만 추출·청크·임베딩 → 감사 기록. **예외를 명시한다**: 규칙 필터를 통과한 항목은 분류 전에 암호화된 채 저장되고 분류를 위해 Jev로 1회 전송된다(통제 3). 즉 "의료 결과지·개인 대화는 저장·전송되지 않는다"가 아니라 "암호화 저장 후 분류 1회 전송, 7일 격리 뒤 본문 삭제"이다. 격리는 오폐기를 사용자가 복구하고 게이트 정확도를 재기 위한 1인 사용 기간의 예외이며, 지인 확대 때 즉시 삭제로 되돌릴지 재검토한다(§16). 예산 소진 시에는 분류되지 못한 항목이 암호화 상태로 `queued`에 남으며 원문 만료 규칙(3년)이 그대로 적용된다(요약 없음).
- URL 본문·이미지 OCR·채팅 발화도 서버 규칙 필터(OTP·카드·계좌)를 같은 함수로 통과시킨 뒤 저장한다. URL 본문은 fetch 직후, OCR은 기기에서 이미 적용된 것을 서버에서 재적용한다.
- 음성은 기기 밖으로 나가지 않는다: 채팅 음성 입력은 온디바이스 인식만 쓰고(`requiresOnDeviceRecognition`) 오디오를 저장·전송하지 않는다. 서버에는 사용자가 보낸 글만 간다(2026-10-01).
- **기기 캘린더는 기기에서만 읽는다**(2026-10-01): 채팅의 "기기 캘린더" 절·일정 답 카드(§9 — 일정 질문이 아니어도 제안 날짜 하루의 일정 제목을 화면에 보인다)와 겹침 확인(§10)은 EventKit을 앱 안에서 조회해 화면에만 쓰고, 일정 제목·시각·메모를 서버·LLM·`device_traces`로 보내지 않는다(진단 로그에는 개수만). 서버에서 앱으로 가는 것은 질문이 가리키는 날짜 범위(`schedule`)뿐이다. 잠금화면 겹침 알림에도 다른 일정의 제목을 쓰지 않는다. 캘린더 내용을 답변 모델에 넣는 안은 수집·전송 범위가 넓어지는 변경이라 사용자 확인 없이는 하지 않는다(§16 UC-4).
- 폐기 판정된 항목은 본문을 지우고(규칙 폐기는 즉시, 게이트 폐기는 7일 격리 뒤) 행에는 상태·사유 코드만, 로그에도 사유 코드만 남긴다. Foundation Models 분류 결과는 저장하지 않는다.

### 통제 3. LLM·임베딩 공급자 조건

- 공급자는 OpenAI 하나(LLM·임베딩). 근거: 공식 문서 "Data controls in the OpenAI platform"(2026-09-26 확인, §3).
  - API 입력·출력은 기본 학습 미사용(옵트인하지 않는다).
  - 남용 모니터링 로그 최대 30일 보관(법적 요구 시 연장 가능). 이 30일은 끌 수 없으며 ZDR·수정 남용 모니터링은 OpenAI 사전 승인이 필요하다.
  - Responses API는 `store` 기본값이면 응답을 30일 보관하므로 **모든 호출에 `store: false`**를 넣는다. `previous_response_id` 대화 이어가기는 쓰지 않는다(대화 문맥은 서버가 직접 구성).
  - 이미지 입력은 CSAM 분류기에 걸리면 ZDR이어도 수동 검토용으로 보관된다. 사용자가 공유한 이미지만 보내는 현재 범위에서 수용한다.
  - 분류 게이트 공급자 TypeSafe Jev(0b)는 OpenAI와 **다른 두 번째 수신자**다(2026-09-29 사용자 결정으로 채택). 보내는 것: 마스킹된 본문(≤2,000자)·
    제목·앱 이름(발신자 없음. 메신저 앱은 제목이 발신자 표시 이름이라 제목도 보내지 않는다 — §7 `classifierMeta`). 약관(평가 리포트 ⑦): 학습에 쓰지 않음, 보관 기간은 DPA에 "필요한 기간"만 있고 명시 없음, ZDR은 엔터프라이즈 전용,
    하위 처리자·처리 리전 미확인 — 문의 중. OpenAI(store:false, 남용 모니터링 최대 30일)보다 약하다고 확인되면 §16 교체 조건에 해당한다
- 임베딩(`/v1/embeddings`)은 추출과 **같은 공급자·같은 약관**이다. 추출 단계에서 이미 같은 텍스트가 OpenAI로 가므로 임베딩이 새 수신자를 만들지 않는다. 따라서 약관 사유의 임베딩 보류는 해제한다(§16). 마스킹은 개인정보 전송 제한이 아니므로 근거로 삼지 않는다.
- 프롬프트·요청 본문을 Supabase 로그에 남기지 않는다(`console.log`에 본문 금지, 요청 ID만).
- 지인 확대 시 OpenAI ZDR(`/v1/responses`·`/v1/embeddings` 모두 대상) 신청을 검토한다. 승인되지 않으면 30일 남용 모니터링 보관을 처리방침에 적는다.

### 통제 4. 접근 통제와 감사

- 모든 테이블 RLS(`(select auth.uid()) = user_id`)는 **앱 클라이언트 경로**를 격리한다. `service_role`은 RLS를 우회하므로 워커·웹훅은 별도 규칙을 따른다: (a) 모든 쿼리에 `user_id`를 명시하는 저장 프로시저(`worker_claim_item(p_user, p_item)` 등)만 호출하고 테이블 직접 접근 금지, (b) 복호화는 `user_keys`의 소유자와 `items.user_id`가 일치할 때만 수행(함수 내부 검사), (c) `service_role` 키는 Edge Function 시크릿에만 존재하고 개발 기기·CI에 두지 않는다.
- **워커 호출 인증**: Edge 게이트웨이의 JWT 검증은 publishable(anon) 키로도 통과한다(0단계 실측). `worker`처럼 service role로 도는 함수는 게이트웨이 검증에 기대지 않고, 함수 안에서 `Authorization: Bearer`가 런타임이 주입한 secret 키(`SUPABASE_SERVICE_ROLE_KEY`·`SUPABASE_SECRET_KEYS`)와 같을 때만 처리하고 아니면 403을 돌려준다. cron은 vault의 secret 키로 호출한다.
- 평문 파생물 읽기도 감사한다: `chat`·`worker`가 `item_chunks`·`facts`를 읽을 때 `audit_log(action='read', target=item_id 목록 해시)`를 남긴다. 복호화 호출은 `action='decrypt'`로 별도 기록한다. 요약 복호화(worker 요약 임베딩, chat 요약 문서·`/chat/item`)도 `decrypt`로 남긴다(2026-10-01). 에이전트·운영자는 실데이터의 `summary_enc`를 복호화하지 않고 `keywords`·`item_chunks.text`도 조회하지 않는다(AGENTS.md §7).
- 운영자(본인 포함)가 대시보드 SQL 편집기로 본문을 조회하지 않는다. 디버깅은 `item_id`·상태·오류 코드로만 한다. 이 규칙을 `AGENTS.md` §7에 적어 에이전트에도 적용한다. 사용자 본인이 제품 앱(chat 함수 경로·보관함)으로 자기 데이터를 보는 것은 제품 기능이라 금지 대상이 아니다(§9 평가 절차).
- `audit_log(user_id, actor, action, target, at)`에 삭제·연결 해제·내보내기·복호화 호출을 기록한다. 본문은 기록하지 않는다.
- 로그 보관 30일. 오류 로그에 본문·토큰이 섞이지 않도록 Edge Function 공통 오류 핸들러가 메시지를 정형화한다.

### 통제 5. 투명성과 사용자 통제

- 설정 화면 "내 데이터"(3단계): 출처별로 **서버 보관 기간·LLM 전송 여부·마지막 동기화 시각·항목 수**를 표로 보여준다.
- 연결 해제(수집 중지, 데이터 유지) / 수집 중지 / 출처별 삭제 / 전체 삭제 / 내보내기(JSON)를 분리 제공한다. 삭제는 §8 연쇄 규칙과 키 파기까지 포함한다. **1단계**는 전체 삭제(계정 + crypto-shred + Gmail revoke)와 출처 삭제를 설정 화면 버튼 2개로 둔다(M2 "보관·삭제 잡" 태스크)(M2-⑥). 내보내기(JSON)는 3단계.
- 잠금 화면 알림에 본문 대신 요약("일정 제안 1건")만 노출하는 옵션을 둔다(3단계).
- 저장 공간(2026-10-01): 설정 "저장 공간" 절에 사용률·원문 보관 시작일·마지막 비우기를 보이고, 경고·비우기·위험 푸시를 보낸다(§8 용량 보호). 용량 비우기는 사용자가 누르지 않아도 도는 자동 삭제이므로 기준(오래된 순, 90일 이내 원문 보호, 요약은 95% 이상에서만 지움, 사실 유지)과 요약 키워드가 평문임(§16 UC-3)을 이 화면 문구에 그대로 적는다.
- 지인 확대(3단계) 선행 조건: 개인정보 처리방침, Google API Services User Data Policy(Limited Use) 준수 문구, Gmail 앱 검증(CASA), OpenAI ZDR 신청(통제 3), 위 "내 데이터" 표·내보내기(§15 3단계).

## 13. 비용 (월, 1인 기준 추정)

| 항목 | 가정 | 비용 |
|---|---|---|
가격 근거: developers.openai.com/api/docs/pricing (2026-09-26, 1M 토큰당, Standard). `gpt-6-luna` 입력 $0.10·출력 $0.50, `gpt-6-sol` 입력 $2.00·캐시 입력 $0.20·출력 $10.00, `text-embedding-3-large` $0.13(채택, 2026-09-27), `text-embedding-3-small` $0.02(비교용). 2026-09-27 OpenAI 전환 후 재검산.

| 항목 | 가정 | 비용 |
|---|---|---|
| gpt-6-luna 추출 | 일 60건 × 입력 1.5k + 출력 0.3k 토큰 → 월 입력 2.7M($0.27), 출력 0.54M($0.27). 분류를 Jev로 옮기기 전 추정을 상한으로 유지 | 약 $0.54 |
| Jev 분류 게이트 | 건당 약 $0.00003(합성 60문구 실측, §7) × 일 60건 | 약 $0.06 |
| gpt-6-sol 채팅 | 일 10회 × 입력 6k(시스템 1k 캐시)/출력 0.5k + reasoning low 0.5k → 월 입력 1.5M($3.00)·캐시 0.3M($0.06), 출력 0.3M($3.00). **상한 추정**: PoC-7 합성 평가 실측은 질문당 입력 약 0.7k·출력 약 0.06k(약 $0.002, 월 약 $0.6)였으나 실제 메일 청크는 합성 문서보다 길어 추정을 유지 | 약 $6.06 (실측 기준 약 $0.6) |
| Vision (gpt-6-luna) | 월 30건 × 입력 약 4k(PoC-8 실측 3.8~4.3k, 기기 OCR 포함) + 출력 약 0.1k → 건당 $0.00042. 월 상한 100건이면 $0.04 | 약 $0.013 |
| 임베딩 `text-embedding-3-large` (512차원) | 월 3M 토큰 × $0.13 | 약 $0.39 |
| 요약(2026-10-01) | 추출 호출에 지시 약 150토큰·출력 약 150토큰 추가, 일 60건 → 월 입력 0.27M($0.03)·출력 0.27M($0.14). `summarize` 잡(M1 기간 항목·실패분, 건당 입력 약 1.6k·출력 0.15k ≈ $0.00024)은 처음 한 번 수백 건. 요약 임베딩은 원문 삭제 때 건당 약 80토큰 | 약 $0.17 (첫 달 백로그 +$0.1~0.3) |
| Supabase | 무료(DB 500MB — 넘으면 읽기 전용, §3·§8 용량 보호. Pro 전환은 §16 UC-2) | $0 |
| 합계 | | 약 $7.3 ≈ 1.02만원 상한 추정 (채팅 실측 기준이면 약 $1.8) |

채팅이 비용의 약 87%다(상한 추정 기준). 기존 Anthropic+Voyage 추정(약 $9)보다 싸지만 상한과 여유가 없으므로 다음 통제를 둔다. reasoning 토큰은 출력 단가로 청구되므로 채팅은 effort `low`, 분류·추출은 `none`으로 고정한다.

- 호출 전 `usage_counters.reserved_krw`에 예상 비용을 예약하고, 월 상한(기본 1만원) 초과 예약은 거부한다. 응답 후 실제 토큰으로 정산한다. 1단계에서 vision 전용 `reserve_vision_call`을 `reserve_usage(kind, est_krw)`로 일반화하고, 예약·정산과 80/100% 강등을 M2의 chat 태스크 **직전** 태스크로 만든다(채팅이 비용의 87%). 구현(M2-⑦): reserve_usage(p_user, kind, est_krw) → ok·degraded(≥80%)·refused, settle_usage, 상한 budget_caps() = 월 10,000원·백필 1,500원, 환율 USD_KRW(기본 1400). 소진·슬롯 없음은 잡 실패가 아니라 defer_job(not_before)로 미룬다(다음 달 1일 00:00 서울 / 30초). 동시 LLM 슬롯 llm_slots(사용자당 2). Jev 분류(건당 약 $0.00003)는 예약하지 않는다. vision 금액 예약은 파일 경로(2단계)와 함께 연결한다.
- 80% 도달: 채팅 gpt-6-sol → gpt-6-luna 강등, vision → OCR 텍스트. 100% 도달: 추출·채팅 중단, 수집만 계속(jobs는 queued 유지). 앱에 잔여 예산 표시.
- 초기 백필 3개월(약 1,800건 × 1.8k 토큰, gpt-6-luna 추출 ≈ $0.5, 임베딩 `text-embedding-3-large` ≈ 1,800건 × 1.4k 토큰 × $0.13/1M ≈ $0.33 ≈ 460원 — 합계 ≈ 1,150~1,400원) 중 **추출**은 월 상한과 별도인 백필 예산(`usage_counters` 월 행의 `backfill_reserved_krw`, 매달 1,500원)으로 잡는다. 백필 예산이 소진되면 월 예산이 남아 있어도 백필 추출 잡은 다음 달로 미룬다(2026-09-30 판정: 재연결 재적재도 같은 예산을 쓰므로 월 단위가 맞다). **임베딩**은 백필 항목도 월 예산(`embed`)으로 예약·정산한다 — 레인(우선순위 40)은 백필 그대로, 추출이 백필 예산을 다 써도 검색 인덱스가 다음 달까지 비지 않게(M2-⑧a 리뷰, 2026-09-30; 월 1만원 대비 수백 원)(1단계 M1 Gmail 태스크에서 별도 카운터(`usage_counters.backfill_tokens`, 백필 항목의 추출 토큰은 월 `extract_tokens`에 넣지 않는다)).
- 동시 LLM 호출은 사용자당 2개로 제한한다.
- 요약(2026-10-01): 추출과 같은 호출이므로 추출 예약(`extract`·백필은 `backfill`)의 출력 추정을 400 → 550토큰으로 올린다. `summarize` 잡은 월 예산 `extract`(백필 레인), 요약 임베딩은 `embed`. 예산이 소진되면 요약은 다음 달로 밀리고, 원문 만료는 요약을 최대 7일 기다린 뒤 요약 없이 지운다(보관 상한이 요약보다 우선, §8). 용량 비우기는 LLM을 부르지 않는다(요약은 수집 때 이미 있고, 요약 임베딩은 비우기 뒤 별도 잡).

## 14. 0단계: 기능별 사전 검증 (구현 전 필수)

각 항목은 독립 PoC로 판정한다. 통과 기준을 못 채우면 대안을 채택하고 이 스펙을 갱신한다. 기기 항목은 시뮬레이터로 코드 경로를 먼저 확인하되, 디버그 훅·시뮬레이터 대체는 **부분**이지 통과가 아니다. 실기기가 필요한 항목은 실기기 세션에서 통과시킨 뒤 다음 단계로 간다. 0단계는 모든 PoC가 **통과 · 실패(대안 채택, 스펙 반영) · 1단계 태스크 게이트로 흡수** 중 하나로 마감돼야 끝난다(AGENTS.md §5-8, 2026-09-30). 흡수된 항목은 그 태스크의 실측 게이트가 되고, 기능 자체가 2단계 이후로 밀린 부분(PoC-8 파일 경로)은 그 단계 태스크 게이트로 이월한다. '부분'은 마감 상태가 아니다.

| # | 검증 대상 | 방법 | 통과 기준 | 실패 시 대안 |
|---|---|---|---|---|
| PoC-1 | Notification 트리거 → App Intent | 빈 앱 + CaptureIntent, 카카오톡·Instagram 알림 트리거 자동화. iOS 26 (iOS 27 기기가 있다면 27도) | 본문·앱명 전달 확인. 확인 배너 여부·잠금 상태·미리보기 꺼짐 상태·묶음 알림 동작 기록 | 본문 미전달 → 알림 경로 폐기, 공유만. 배너 필수 → 키워드 필터로 탭 최소화 |
| PoC-2 | Message 트리거 → App Intent | 문자 수신 시 발신자·본문 전달, 잠금 중 무확인 실행. 재부팅 후 첫 잠금 해제 전 수신 | 잠금 상태에서 큐에 저장됨. 첫 해제 전 수신분 처리 방식 기록 | 실패 시 문자도 공유 경로만 |
| PoC-3 | Foundation Models in-app 백그라운드 인텐트 | 한국어 알림 200건(개인 대화 100·알림톡 96·검진 결과 안내 `medical_result` 4) 분류, 지연·메모리 측정. 백그라운드 인텐트 10~20회 연속 호출로 `rateLimited` 빈도 측정 | p95 < 3초. **개인 대화 통과율 ≤ 2%**, 알림톡 폐기율 ≤ 15%(분모 notice 96, `medical_result` 4건은 따로 센다) | (당초) 규칙 필터만 + 카톡·인스타 경로 폐기. **채택된 대안(2026-09-29)**: FM 타임아웃·에러는 `rules`로 통과 → 서버 Jev 게이트가 판정. 카톡·인스타 폐기는 FM 불가 시에만. FM은 방어선으로 유지(게이트 아님). 상태 실패(대안 채택, 2026-09-30) |
| PoC-4 | Edge Function → APNs HTTP/2 | 프로덕션 리전에서 100회 발송, 동시 10회 포함 | 성공률 ≥ 99%, h2 스트림 오류 0 | Cloudflare Worker 릴레이 |
| PoC-5 | 알림 액션 → 백그라운드 EventKit 쓰기 | `authenticationRequired` 액션에서 이벤트 생성. 같은 알림 두 번 탭, 동시 두 번 탭, 앱 종료 후 액션(콜드 스타트), 보고 실패 후 재탭. APNs 없이 로컬 알림으로 가능 | 앱 열지 않고 캘린더에 1건만 생성 | `foreground` 액션으로 앱 열어 실행 |
| PoC-6 | Gmail serverAuthCode 교환 + watch + history | 테스트 계정으로 3개월 백필, push 수신. 8일 재인증 만료 재현, 커서 404 재현 | 쿼터 초과 없이 완료, push 1분 내 수신, 만료·404 후 누락 0건 | 폴링(15분) |
| PoC-7 | 한국어 하이브리드 검색 | 샘플 500건(메일·알림톡·발화 혼합), 질문 50개(무근거 10개 포함) | Top-5 ≥ 90%, 무근거 거절 ≥ 90%, 인용 검증 통과 | 임베딩 모델 교체, 청크 크기 조정 |
| PoC-8 | Share Extension 이미지 → 로컬 영속화 → 업로드 → vision 추출 | 청첩장 이미지 5종, 업로드 중 오프라인 전환 | 날짜·장소·연도 추출 5/5, 오프라인 후 복구 시 유실 0 | OCR 텍스트만 전송 |
| PoC-9 | background URLSession from App Intent | 잠금·오프라인·앱 강제 종료 후 복구 시 전송 | 앱 재실행 포함 시 유실 0. 강제 종료 시 취소되는 것을 기록 | 앱 포그라운드 시 재시도만 |
| PoC-10 | jobs 워커 | pg_cron → Edge worker, 임대 만료·중복 실행·5회 실패 | 같은 잡이 동시에 두 번 돌지 않고 dead 전환됨 | 단일 워커 직렬 처리 |

PoC-3 서버 보완(0b): 09-29 기기 실측 10문구(`poc/server/eval/phrases.json`의 d01~d10, Jev 평가와 같은 합성 문구 — 원문이 기록된 것은 d09·d10뿐이고
나머지는 기록된 주제로 재구성)로 서버 최종 상태를 잰다 — 결정적 테스트(`phrases.test.ts`), 실제 추출 평가(`eval/run-phrase-eval.ts`),
실기기 재현(Slack 웹훅 `scripts/send-phrases.ts`, 문자 `scripts/send-sms.ts`). 다음 실기기 세션부터는 이 문구를 그대로 보낸다(리포트 ⑦-6).
PoC-5 제안 푸시 실측용 문구(`push`)는 날짜가 늘 미래가 되게 발송일 기준 상대값으로 만든다

기기 PoC는 앱 하나(`poc/ios`: 앱 + Share Extension + `EruriCore` 패키지 + UI 테스트)에, 서버 PoC는 `poc/server`에 둔다. 결과는 `docs/superpowers/poc/`에 기록하고 판정의 원본은 `results.md`다. PoC **앱 타깃·UI**(`EruriPoC`)는 폐기 대상이다. 패키지(`EruriCore`)·서버 코드(`poc/server`)는 리뷰 1회 후 제품으로 승격한다(§11 "PoC 코드 재사용").

### 판정 현황 (2026-09-30, 원본 `docs/superpowers/poc/results.md`)

`results.md` "판정" 표와 같은 내용이다. 측정 원본은 `results.md` "PoC별 상세", 남은 실측의 필요 조건·판정 근거(`poc_traces` 이벤트)는 `results.md` "실기기·장기 실측 대기"에 있다.

| PoC | 검증 대상 | 태스크 | 상태 | 핵심 근거 | 남은 실측 | 근거 커밋 | 갱신일 |
|---|---|---|---|---|---|---|---|
| PoC-1 | 단축어 Notification 트리거 → CaptureIntent 자동 실행 | 4 | 통과 | 실기기(09-28, iOS 27, TestFlight 0.1.1): "새로운 빈 자동화"에 알림 트리거(카카오톡+Slack 다중 선택, "모든 앱"은 불가)·"비서에 저장" 직접 편집(본문=단축어 입력→내용) → Slack 알림 본문 183자·155자, `locked=true`·`bg=true`, **배너 탭 없이 실행**. 1건은 `len=0`. 제목·앱 이름 변수 연결 후 05:24:48Z `len=147`·`title=11`·`app=true`·`locked=true` — **본문·제목·앱 이름 전부 전달** | 카카오톡 알림 실측, `len=0` 1건 원인, 미리보기 꺼짐·묶음 알림 기록, 연락처 발신 `discarded:contact` | `964cfea` `affe7e9` `47e9435` | 2026-09-28 |
| PoC-2 | 단축어 Message 트리거 → CaptureIntent 자동 실행 | 4 | 통과 | 실기기(iOS 27, TestFlight 0.1.1): "새로운 빈 자동화" 안에서 "비서에 저장" 직접 편집(본문=단축어 입력→내용) → 본문 30/15/15자·발신자 도착, `bg=true`, 1.5~2.5초, 무확인 실행. **잠금 수신 확정**: 05:02:04Z `locked=true` 본문 38자·발신자. 기존 단축어 선택 방식은 발신자만·본문 0자(6건). **제품 경로(09-28 사용자 최종)**: 알림 자동화 1개(메시지 앱 포함)로 수집, 메시지 트리거는 선택 사항. 06:00Z 메시지 트리거로 문자 3건(연락처 있는 지인 발신) 모두 `src=MESSAGE, app=SMS`·발신자 번호·본문 도착(통과 근거 유지). 알림 경로(05:50:19Z)는 `app=메시지`·발신자 표시 이름, 알림이 안 뜨는 문자(조용히 한 대화·알 수 없는 발신자·집중 모드)는 누락 감수 | 판정 기준 중 BFU(재부팅 후 첫 해제 전) 수신 처리 기록, OTP `discarded:otp`, 연락처 번호 `discarded:contact` | `ca859a4` `47e9435` | 2026-09-28 |
| PoC-3 | Foundation Models 한국어 분류 200건 정확도·p95 | 5 | 실패(대안 채택) | 폴백 경로(Coupang→`queued:rules`, KakaoTalk→`discarded:fm-error`)·새 세션·enum 스키마·타임아웃 단위 테스트. 호스트 Mac Apple Intelligence 꺼짐으로 수치 없음 **실기기(09-29, iOS 27, 0.2.0, Slack 웹훅 합성 문구 10개)**: Apple Intelligence 분류기 동작 확인. 택배·병원·카드·컨퍼런스·공과금 5건 `queued:rules`(p50 3.13s, 최대 3.22s), 광고 `discarded:fm:promo`(2.04s), 인증번호 `discarded:otp`(정규식 6ms), 경계 문구(목요일 판교 약속) `queued:rules`. 잡담 2건(ㅋㅋㅋ/밥 먹었어?)은 `queued:rules` 로 통과시켜 오분류 → 서버 규칙이 걸러야 함. 별도 관찰: 4자 알림 `discarded:fm-timeout`, 지인 문자 `discarded:fm:personal`. 기기 정확도 8/10(목표 90% 미달, p95·메모리 미측정), 잠금·백그라운드에서 실행. **서버 게이트 후보 Jev(09-29, 합성 60건)**: 게이트 60/60(같은 10문구 10/10, 잡담 2건 폐기), p50 211ms·p95 269ms, 60건 $0.0019, 임계 0.8 제안·조건부 채택(벤더 결정·보관 정책·실데이터 재측정 대기) → `reports/2026-09-29-jev-classification-eval.html`. **서버 분류 게이트(Jev, 운영 요청 재현 09-29)**: gate 60/60, 5라벨 60/60, p50/p95 218/302ms, 건당 $0.000032, t=0.8 유실 0·누수 1(p02 잡담 conf 0.64 → 추출로); 메신저 제목 미전송(최종 리뷰 I1) 재측정 09-29: gate 60/60, 5라벨 60/60, p50/p95 216/314ms, t=0.8 유실 0·누수 0, 운영 적용 예(`CLASSIFY_PROVIDER=jev`·`CLASSIFY_THRESHOLD=0.8`, 스모크 잡담 `discarded:server:personal`·일정 `extracted`) → `poc/server/eval/jev-results-prod.json` **FM 콜드 타임아웃 상수(실기기 0.2.1/0.2.2, 09-29 `poc1.intent_fired` 13건)**: 11건이 3.07~3.22s로 3초 타임아웃(잠금 무관), 웜 2건만 1.7~1.8s `queued:fm`; 카카오톡 2건 `discarded:fm-timeout` 유실 → 0.2.3(빌드 202609291909)부터 타임아웃은 출처 무관 `queued:rules`(서버 Jev 게이트가 판정), 불가·에러는 채팅 앱 폐기 유지. 0.2.3 빌드 202609291913부터 생성 에러(`rateLimited` 등)도 출처 무관 `queued:rules`, 불가(`fm-unavailable`)만 채팅 앱 폐기 | — (마감 2026-09-30: 기기 기준 p95 < 3초·정확도 90% 미달 확정 — 콜드 3.07~3.22초, 8/10 → 대안 채택, 스펙 §14 PoC-3 행. FM 200건 벤치마크·메모리·`rateLimited` 빈도는 게이트로 더 재지 않는다. 서버 Jev 실데이터 200건은 1단계 M1-④ 분류 태스크 게이트) | `b1f3248` `0d2a293` `affe7e9` `94c6aa5` `5214fec` `661bfdd` `f79ed3f` | 2026-09-30 |
| PoC-4 | Edge Function → APNs HTTP/2 | 9 | 통과 | h2 동작(가짜 토큰 sandbox `400 BadDeviceToken`+`apns-id`, HTTP/1.1 대조군 거부), Edge 서울 100회 동시 1 100/100 p50 419ms, JWT 429 수정. **실기기(09-28)**: 앱 토큰 등록(`devices` production, 0.1.1) → `apns-send` count 1 → APNs 200 production 634ms, 잠금 화면 수신 확인. **0.2.1/0.2.2 자동 재등록(build 갱신) 확인(09-29)**: 설치 후 앱 열기만으로 `devices.build` 갱신(08:51:50Z·09:25:01Z, "등록" 버튼 안 누름) **동시 10 실기기(2026-09-30 00:29 KST, production 토큰, 배포 Edge 서울, 키 Q8469KDH4D, silent priority 5)**: 100회 동시 10 × 2 → 100/100·100/100(`{"200":100}`), h2Errors 0·0, fetch 오류·429 0, p50 367/291ms·p95 755/594ms. 가짜 토큰 때의 `GOAWAY`·`dispatch task is gone`은 재현 안 됨 → 연결 오류 재시도·Cloudflare 릴레이 불필요 | — (alert(priority 10)로 재확인은 선택. 전송 경로는 같고 헤더·payload만 다름) | `e2552b5` `40d83cc` `b84bd60` | 2026-09-30 |
| PoC-5 | 잠금화면 알림 액션 → 백그라운드 EventKit 멱등 쓰기 | 6 | 통과 | XCUITest(실제 배너·액션 탭, 로컬 알림): 백그라운드 쓰기 `bg=true`, 재탭 `dup skip`, 앱 종료 후 콜드 스타트, 동시 두 번 탭 이벤트 +1. **실기기(09-29, iOS 27, 서버 제안 푸시)**: 0.2.1 제안 2건 잠금 화면 "캘린더에 추가" → 캘린더 각 1건·`result=ok bg=true dup=false auth=3`, 단 TestFlight 충돌 안내 2회(완료 핸들러 메인 스레드 밖 호출) → 0.2.2 수정 후 09:27:19Z `ok bg=true dup=false auth=3`·캘린더 1건·**충돌 안내 없음**. **제품 0.3.0 회귀 통과(2026-09-30)**: M1-②d 게이트 B·D(3G 포함) | — (실기기 재탭 `dup` 은 안 함 — 시뮬레이터 XCUITest 근거로 갈음. 보고 실패 후 재탭은 서버 연동 후) | `0e89279` `0d2a293` `3879270` | 2026-09-29 |
| PoC-6 | Gmail watch → Pub/Sub → history 동기화 | 10 | 1단계 흡수(M1-③) | 실계정: 연결·watch +7일, 백필 85 ID → 76행·429 없음·`content_enc` null 0, 웹훅 약 8초(1회), 404 재동기화로 누락 1건 복구·중복 0 | 1단계 M1-③ Gmail 제품화 태스크 게이트로 흡수 — **제품 프로젝트에서** 연결일 기준으로 잰다: 백필 중 웹훅→sync ≤ 1분(5회 평균), watch 갱신(수동+cron), +6일 `expiring`, +8일 `invalid_grant`→`reauth_required` → 재연결 후 누락 0, 규칙 필터 OTP·카드 메일. 백필이 증분 동기화를 굶기는 문제는 `jobs.priority`(스펙 §7) | `ea6c762` `87673fe` `cdd7c79` | 2026-09-30 |
| PoC-7 | 한국어 하이브리드 검색 Top-5 정확도 | 11 | 통과 | 합성 500건·질문 50: 하이브리드 + `text-embedding-3-large`(512) Top-5 38/40(95%), 무근거 거절 10/10, 인용 36/36·정밀도 39/39, 날짜 필터 오판 0, 검색 p95 70~111ms | — (1b(M2)에서 실데이터 검색 평가, 스펙 §9 절차) | `4c00aa7` `cf786bb` `9e8ab9f` | 2026-09-27 |
| PoC-8 | 이미지·PDF → OCR/추출 → 일정 | 7, 12 | 2단계 이월(파일) · 1단계 흡수(App Group 서명) | 서버: 합성 7종(이미지 5·PDF 2) vision+OCR 21/21, OCR만 21/21, `uncertain` 21/21, p50 1.95s·p95 2.53s, 건당 $0.00042, worker extract 7/7. 기기(시뮬레이터): 사진 앱 공유 시트 → 확장 `ocrLen=43`·큐 `SHARE` 행 | 파일 경로(실기기 공유 시트 → 큐·업로드, `PUT upload/<id>`, 오프라인 후 복구 유실 0)는 2단계 이미지·PDF 태스크 게이트로 이월. App Group 서명(새 번들 `group.com.picpal.eruri`)은 1단계 M1-② 앱 태스크 게이트의 "Share 텍스트 실기기 1건" → **M1-②d 게이트 C 통과(2026-09-30, 0.3.0)** | `f28814d` `0d2a293` `affe7e9` `7f533f1` | 2026-09-30 |
| PoC-9 | 앱 종료 후 background URLSession 업로드 완료 | 7 | 통과 | 앱 프로세스 종료를 `ps`로 확인한 뒤 3.68초 후 목 서버에 정확한 바이트 수로 도착. 실기기(09-28): 로그인 직후 큐 7건 일괄 업로드(`poc9.upload_done` ×7), 잠금 중 수신분은 해제·앱 열기 후 업로드(45초 뒤), 서버 `process` 잡 전부 `done`. **0.2.0 실기기(09-29)**: 잠금 중 Slack 알림 → `path=intent_direct` 0.86초 즉시 업로드(앱 미실행), 비행기 모드 큐 적재 → 무음 푸시 → 33초 뒤 `path=silent_push`(앱 미실행), 앱이 떠 있으면 `path=foreground` 16초. **0.2.1 잠금 판정 L1~L4(09-29, 상세 표)**: L1 `unlocked/readable`, L2·L4 `locked/denied`·`locked_app=true`(UIKit 값 일치), L3 잠금 직후는 같은 초에 unlocked→locked(유예 경계, 한계), `probe=error` 0 → 후속 패치 불필요. **trace 중복**: 0.2.1 설치 뒤 `ingest` trace 17줄 중 16줄 `duplicates=0`, 09:17:47Z 1줄 `count=2, duplicates=2`(0.2.1 PoC-5 충돌 구간), 0.2.2 이후 0 | — (실기기 회귀: 스와이프 종료·비행기 모드, 파일 업로드는 서버 `upload/<id>` 엔드포인트 구현 후) | `f28814d` | 2026-09-29 |
| PoC-10 | jobs 큐 lease/재시도/dead 처리 | 8 | 통과 | 같은 lease_key 동시 클레임 1건, 5회 실패 후 `dead`, 임대 180초+하트비트로 90초 잡 재클레임 0·attempts 1, 복호화 p50 0.7ms·p95 56ms | — (판정 기준 밖: 150초 강제 종료 잡 재클레임, 24시간 활동 유지) | `2d9a45a` `6ca66d8` | 2026-09-26 |

**집계(2026-09-30): 통과 7(PoC-1·2·4·5·7·9·10) · 실패(대안 채택) 1(PoC-3) · 1단계 흡수 2(PoC-6 → M1-③, PoC-8 App Group 서명 → M1-② · 파일 경로는 2단계 이월) · 부분 0 · 미검증 0.** 전 PoC가 마감돼 0단계가 끝났다. PoC-1·2·9 실기기 보완 항목은 판정 기준 밖의 회귀라 1단계 M1 게이트 실기기 세션에서 함께 본다.

남은 0단계 실측은 없다(PoC-4 동시 10은 2026-09-30 통과 — Cloudflare Worker 릴레이 불필요). PoC-6 반복 항목은 제품 프로젝트 연결일 기준 6일·8일째에 M1-③ 게이트로 확인한다.

## 15. 단계 계획

| 단계 | 범위 | 완료 기준 |
|---|---|---|
| 0 | PoC-1~10 | **전 PoC 마감**(통과 · 실패(대안 채택, 스펙 반영) · 1단계 태스크 게이트로 흡수 중 하나, §14), 스펙 갱신 |
| 1a = M1 이관 | 제품 Supabase 프로젝트·앱 타깃 분리(§11), Sign in with Apple, 수집 경로(알림 자동화 이관 §5 · Share 텍스트/URL), jobs 우선순위(§7), Jev 6종 분류 → 폐기 7일 격리·삭제 → 추출 → 제안 → notify → EventKit 액션(멱등, 표식 조회 복구 포함 §10), Gmail 제품화(우선순위 레인·watch 갱신·재인증 푸시·404 재동기화), 기기 등록 정리, `device_traces` | **제품 앱이 PoC 앱을 완전히 대체**: 자동화 재지정 후 합성 문구 10개(`phrases.json` d01~d10) → 서버 최종 상태 일치, 제안 푸시 → 캘린더 1건, Gmail 백필 중 웹훅→sync ≤ 1분, 연결 +8일 재인증 통과, Jev 실데이터 200건 라벨 기록. 통과 직후 **PoC 프로젝트 은퇴**(§11) |
| 1b = M2 검색 | 임베딩 worker 연결(`text-embedding-3-large` 512), chat Edge, 앱 채팅·보관함 UI, 제안 리뷰(배너 탭 시트·"제안" 탭·무시, §10, 2026-09-30 1단계로 당김), 보관·삭제 잡(90일·30일 만료, 전체 삭제·출처 삭제 버튼 §12 통제 5), 비용 상한(§13, chat 직전 태스크), 검색 평가 도구·실행(§9 절차) | **검색 평가 통과**(§9 지표). 메일·공유 텍스트·알림 항목을 채팅으로 다시 찾고 출처가 검증됨 |
| 2 | 앱 안 자동화 설치 가이드 화면(자동화 2개, §5), 이미지·PDF 공유 파일 경로(`PUT upload/<id>`, PoC-8 이월)·vision + OCR, `purchases` 테이블(facts 백필)·구매 질문 | 알림톡 주문이 구매 이력에 쌓이고 "어디서 샀지" 답변 |
| 3 | Siri·빠른 기억, 구독 추적(`subscription` 추출), **지인 확대** — 선행 조건: Gmail 앱 검증(CASA), OpenAI ZDR 신청, 개인정보 처리방침·Limited Use 문구, 설정 "내 데이터" 표·JSON 내보내기·잠금 화면 요약 옵션(§12 통제 5), 폐기 격리 재검토(§16), 메일 수집 대안 결정(Microsoft Graph 연동 후보, 비 Gmail 전달 주소, §16 2026-09-30) | 지인이 가이드만으로 셋업 완료 |

1단계 계획 구조(2026-09-30 결정): **계획서 1개, 마일스톤 2개**(M1 = 1a, M2 = 1b). 이관을 먼저 하는 이유는 0b에서 추출·제안·notify·EventKit이 이미 동작해 사용자 일상에 들어가 있고, 이관해야 데이터가 제품 프로젝트에 쌓이며 PoC 프로젝트를 접을 수 있고, Gmail 8일 시계·Jev 실데이터 200건이 M1에서 시작해야 M2 중에 차기 때문이다. 첫 3개 태스크:

1. **제품 Supabase 부트스트랩**: 프로젝트 `eruri` 생성, 베이스라인 squash 마이그레이션, secrets(새 MASTER_KEY·service role·OPENAI·JEV·APNS·Google web), vault·cron, `poc/server` → `supabase/` 이동·정리, Edge 배포, 전용 테스트 사용자로 `deno test` 통과. 게이트: 합성 항목 ingest → worker → `extracted` → `proposal_pushes` 행(기기가 없으면 rejected로 끝나도 됨). (선행 PoC-4 동시 10은 2026-09-30 통과.)
2. **제품 앱 타깃 `Eruri`**: 번들·App Group·Apple 로그인·APNs 등록·EruriCore 수집 경로·ShareExtension(텍스트·URL)·알림 카테고리 3종(§10)·설정(Gmail 연결·계정 삭제 자리). `MARKETING_VERSION 0.3.0`, TestFlight. 게이트: 실기기에서 자동화 재지정 → 10문구 서버 상태 일치, 제안 푸시 → 캘린더 1건(PoC-5 회귀), Share 텍스트 1건(App Group 서명, PoC-8 흡수).
3. **Gmail 제품화**: 새 iOS OAuth 클라이언트, 연결 → 90일 백필, `jobs.priority`, watch 일 1회 갱신 cron, 재인증 푸시(`expires_at` −24h·`invalid_grant`), 404 재동기화, 프로모션·OTP·카드 메일 규칙. 게이트: 백필 중 웹훅→sync 잡 실행 ≤ 1분(5회 평균), +6일 `expiring` 푸시, +8일 `reauth_required` → 재연결 후 누락 0(PoC-6 흡수).

이후 순서(참고): ④ 분류 Jev 6종 + 폐기 격리·삭제 + 실데이터 200건 라벨 기록 → ⑤ 기기 등록 정리·stale 기기 → [M1 게이트] → ⑥ 보관·삭제 잡 + 전체/출처 삭제 → ⑦ 비용 상한 → ⑧ 임베딩 worker + chat Edge → ⑨ 앱 채팅·보관함 → ⑩ 검색 평가 도구·실행 → [M2 게이트].

**1단계 추가 범위(2026-10-01 사용자 결정, §16)**: 보관 3년·요약 영구·용량 보호·채팅→보관함 보기. 계획 `docs/superpowers/plans/2026-10-01-retention-summary.md`, 앱 0.7.0(채팅→보관함, 지금)·요약·저장 공간 화면은 서버 반영 뒤. M2 게이트(검색 평가)와 독립이다. 서버 반영(마이그레이션 적용·함수 배포)은 Gmail 게이트 ③c2가 끝난 뒤 한다(측정 기간 중 실사용자 items·jobs 변경 금지, Gmail 계획 Global Constraints). 1b 행의 "90일·30일 만료"는 이 결정으로 원문 3년·이미지 파일 30일이 된다. 요약·저장 공간 화면은 앱 0.9.0이다.

**1단계 추가 범위(2026-10-01 검색·캘린더 결정, §16)**: 검색 후보 컷·거절 시 후보 없음(chat 함수만), 숫자 어절 변형 제거(`hybrid_search` 마이그레이션), 일정 기간 필터(`event_range` → facts, 응답 `schedule`), 앱 0.8.0(채팅 "기기 캘린더" 절·제안 카드 상태·겹침 확인). 계획 `docs/superpowers/plans/2026-10-01-search-calendar.md`. 순위가 바뀌는 서버 변경(숫자 어절·일정 기간 필터)은 **M2 검색 평가(⑩b) 전에** 넣고, 이미 돌렸으면 다시 잰다. 함수 정의만 바꾸고 실사용자 행은 건드리지 않아 Gmail 측정 기간 제약에 걸리지 않는다.

Outlook 커넥터 인터페이스는 만들지 않는다. 필요해지면 그때 추가한다.

**확장 후보(2026-10-01 조사, 구현 결정 없음)**:
- 네이버 캘린더 → 아이폰 캘린더(CalDAV) 연결 가이드: `docs/superpowers/guides/naver-calendar-caldav.md` — 코드 변경 없이 §9 기기 캘린더 절·§10 겹침 확인에 반영된다.
- 네이버 예약 신청: 대신 신청 불가(공개 API 없음·자동화는 약관 위반), 예약 화면 열기만 가능 — `docs/superpowers/guides/naver-booking-feasibility.md`.
- 여행 글 → 일정 초안: 공유 시트로 블로그 링크 공유 → 서버가 본문 가져오기(네이버 블로그 모바일 주소·티스토리·일반 HTML) → LLM 장소 추출 → 지도 지역 검색(네이버/카카오)으로 위치 확인 → 지역별 묶음·일차별 동선 초안 → 채팅 "여행 계획 초안" 카드에서 날짜 선택 → 일정 제안 여러 건(§10 제안·겹침 흐름 재사용). 인스타그램은 로그인 장벽·약관 때문에 링크 수집 불가, 캡션을 붙여넣은 텍스트만. 영업시간·이동시간은 없으므로 "초안"으로 표시하고 위치 확인 실패 장소는 따로 보인다. 원문 전체는 저장하지 않고 요약·장소 목록만(저작권). LLM 비용은 §8 월 예산 안. 1단계 게이트 이후 별도 기능으로 검토(2026-10-01 사용자 제안).

## 16. 리스크와 미결

### 외부 리뷰 반영 (Codex gpt-6-astra, 2026-09-23)

21개 지적 중 반영: 영속 작업 큐(2), 보관 정책 분리(3), 서버 필터 재적용·의료 결과지 분류(4), FM 실패 시 카톡 폐기(5), Gmail 복구·정기 대조(6), 웹훅 인증(7), EventKit 멱등(8), 수정·완료 액션(9), 불확실 필드 확인(10), 로컬 영속화·강제 종료(11), 발화/사실 분리(12), 인용 서버 검증(13), URL 제한(14), 구매 다대다(15), OCR 동시 생성(16), 백필 푸시 억제(17), 검색 평가 1단계 이동(18), 비용 예약(19), 용량 측정(20), Outlook 인터페이스 삭제(21).

미반영·사용자 판단: (1) Notification 트리거 판정은 "미확인"으로 완화하고 PoC-1에 위임. (21) MVP를 검색 전용으로 더 줄이는 제안은 1a/1b 분리로 절충했다(2026-09-30에 1a = M1 이관, 1b = M2 검색으로 재정의, 아래).

### 2차 리뷰 반영 (Codex gpt-6-astra, 2026-09-23, 개인정보 설계)

10건 모두 반영: 암호화 보호 범위 정직화(1), 백업·키 파기 한계 명시(2), 삭제 범위 3단계로 통일(3), 저장→분류→삭제 순서와 예외 명시(4), service_role 격리·평문 읽기 감사(5), 만료 시 청크 행 전체 삭제(6), 임베딩 공급자 확인 전 보류(7, 2026-09-26 OpenAI 약관 확인으로 해제 — 아래 "임베딩 보류"), pgsodium → Edge 봉투 암호화(8), NSE 조건·상한 명시(9), BG 작업 비보장·`requiresExternalPower`·watch 갱신 주체(10).

### 외부 리뷰 반영 (Gmail 계획, Codex gpt-6-astra · Fable, 2026-09-30)

`docs/superpowers/plans/2026-09-30-phase1-gmail.md` 리뷰: Codex 8건 중 반영 #1·#2·#4·#5·#7·#8, 부분 반영 #3(ID 대조 추가, 89일 경계 여유 유지)·#6(gap 쉼·문구, 합산 예산 미도입), a~e 전부 판정(a 제품 경로 재탭 보충·SQL 주입 기각, b·c·d 반영 — c·d는 T0 전 제품 수정 M1-③b0, e 강화 — T0 전 PoC 동의 철회, 사용자 확인). Fable 추가 결함 N1(새 동의 T0)·N3~N6 반영, N2는 표시만 하고 제품 수정(백필 fetch 50 ID)은 T0 이후. 번호별 상세는 계획서 "리뷰 반영" 절.

### 외부 리뷰 반영 (보관 정책 계획, Codex gpt-6-astra · Fable, 2026-10-01)

`docs/superpowers/plans/2026-10-01-retention-summary.md` 리뷰: Codex 9건 반영(#2 문장 순서·advisory lock으로 축소, #4 보고 크기 기반 유입 제한만 미반영), Fable 추가 N1(autovacuum 2%)·N2(`ArchiveView` e895cae 기준)·N3(요약 백로그 30일 재시도)·N4(HNSW 제거)·N5(트랙 B 직렬)·N6(정합 3건) 반영, UC-1 기본값 A → B(R-B7 필수)·UC-2 무료 + 롤링·UC-3 평문 키워드는 사용자 확인 대기, R-B5·R-B6·R-B7 Codex 재검토 1회를 계획 절차에 넣음. 번호별 상세는 계획서 "리뷰 반영" 절.

### 외부 리뷰 반영 (검색·캘린더 계획, Codex gpt-6-astra · Fable, 2026-10-01)

`docs/superpowers/plans/2026-10-01-search-calendar.md` 리뷰: Codex 8건 모두 반영(#1 받은 기간·일정 기간 SQL 분리 → `search_facts` 0024, #2 S1 조정 규칙 삭제·⑩b 후보 재현율 집계, #3 숫자 어절 조사 예외, #4 거절 대체 문구 삭제·절 머리 건수, #5 겹침 알림 2초 마감·결과 기록, #6 활성화·추가 뒤 재조회(EventKit 변경 구독은 미반영), #7 C2 게이트 5단계 필수(반복 일정 별도 실측은 미반영), #8 앱 32일 상한), Fable 추가 N1(실기기 게이트를 Gmail ③b2 창 밖으로·개별 무시)·N2(일정 기간이면 시작 순 8)·N3·N4(공유 읽기 store)·N5(처리 후 알림 제거·"다른" 문구 제거)·N6(테스트 단언 완화·맨숫자 토큰 제외) 반영. 개인정보 등급 변화 없음. 보관 계획 트랙 B 예정 번호 두 칸 밀림. 번호별 상세는 계획서 "리뷰 반영" 절.

### 외부 리뷰 반영 (채팅 일정 답 카드, Codex gpt-6-astra · Fable, 2026-10-01)

2026-10-01 실기기 피드백("일정이 언제야?"에 알림 기준 판단·캘린더 내용·추가/겹침 여부가 같이 나와야 맥락이 읽힌다)과 0.8.1 실기기 확인(12:31, 채팅 카드 "겹쳐도 추가" 탭에 이벤트 없음·텍스트처럼 보임 — 시뮬레이터 게이트 C2-4 무반응과 같은 버그로 확정)에 대한 설계안(`.context/chat-card-design.md`)을 Fable이 검토(`.context/fable-review-chatcard.md`)했고 권장안을 채택했다. 반영: #1 카드 표시와 버튼 조건 분리·succeeded도 카드, #2 캘린더 줄은 제안 날짜 하루(일정 질문이 아니어도), #3 겹친 일정은 어느 캘린더든 줄 맨 위·상태 문구에 직접, #4 카드 버튼 스타일 명시·권한 안내 `Link` → 버튼·실패했던 XCUITest를 회귀 게이트로, #5 보내면 키보드 내림·답이 오면 그 질문을 맨 위로(권장 "턴 끝"을 "질문 맨 위"로 바꿔 카드가 위에서부터 읽히게), #7 주간 질문은 카드 + 기간 절, #8 출처 표기, #9 여러 제안 규칙(최대 3), #10 "(같은 일정일 수 있음)", #11 예시 요일(10/4 = 일), #12 추출 시각·원문 보기. 미반영: #6 "무시" 상태(서버가 dismissed 를 주지 않음 — 서버 변경 없음 유지). 문구 조정: 겹침 상태를 "'제목'과 시간이 겹침" 대신 "겹치는 일정 HH:mm–HH:mm 제목"(제목 끝 받침에 따라 조사가 틀린다), 넘친 카드를 "외 N건은 제안 탭에서" 대신 "일정 제안 N건 더 있음"(succeeded·지난 제안은 제안 탭에 없다). 개인정보 등급 변화 없음(캘린더는 기기 화면에만). 서버 변경 없음, 앱 0.8.2. 계획 `docs/superpowers/plans/2026-10-01-chat-schedule-card.md`. 계획 리뷰(Codex gpt-6-astra · Fable, 2026-10-01): Codex #1 권한 가드(부분, MED로) · #2 대표 선택(반영) · #3 수용 기준 조정(부분) · #4 분기 로그(부분, 응답 주입 미채택) · #5 D1 키보드(반영) · #6 자정 끝 정책 고정(부분). Fable F1 반복 일정 겹침 줄 · F2 다가올 일정 먼저 · F3 스크롤 시점.

### 2026-09-30 1단계 범위 결정(리뷰 반영)

1단계 범위 리뷰(Opus, 2026-09-30)의 권장안을 사용자 지시로 전부 반영했다.

1. **Q1 0단계 마감**: PoC-3은 실패(대안 채택)로 마감, PoC-4 동시 10은 1단계 계획 전에 측정, PoC-6은 M1-③ 게이트로 흡수(제품 프로젝트에서 측정), PoC-8은 파일 경로 2단계 이월·App Group 서명만 M1-② 게이트. 마감 세 상태를 AGENTS.md §5-8·§14·§15에 반영.
2. **Q2 알림 자동화 경로**: 1단계에 "이관"으로 포함(§5). 앱 안 설치 가이드 화면은 2단계. 메시지 트리거 병행 중복 제거는 앱별 분리로 불필요해졌다(2026-10-01, §5).
3. **Q3 제품 분리**: 1단계 Task 1(서버)·Task 2(앱)가 분리 자체. 새 번들·App Group·Supabase 프로젝트 `eruri`·키, 마이그레이션 squash, PoC 데이터는 이전하지 않고 M1 게이트 뒤 PoC 프로젝트 은퇴(§11).
4. **Q4 사용자 범위**: 1단계는 본인 전용이되 인증은 처음부터 Sign in with Apple(§2). CASA·ZDR·처리방침·"내 데이터"·내보내기는 3단계 지인 확대 선행 조건(§12 통제 5, §15).
5. **Q5 검색 평가**: 메타데이터 기반 사용자 출제 + 앱 안 👍/👎 판정, 러너는 id·점수·집계만(§9). 사용자 본인의 앱 열람은 금지 대상이 아님을 AGENTS.md §7·§12 통제 4에 명시.
6. **Q6 분류 단일화**: 분류 = Jev 게이트 6종(`medical_result` 추가, 재평가 후), 추출 = `text_fact`(event·task·purchase·none). gpt-6-luna 7종 재분류 삭제, `subscription`은 3단계·`reference`는 두지 않음. 1단계에서 추출은 켠다(§6, §7).
7. **Q7 나머지 모호점**: `purchases` 테이블은 2단계(1단계는 facts.payload, §7·§8·§9), 비용 상한 `reserve_usage`는 M2 chat 직전 태스크(§13), 전체·출처 삭제는 1단계·"내 데이터"·내보내기는 3단계(§12), "1단계" 용어 정리(§6·§10), §14 PoC-3 대안 기록.
8. **Q8 계획 구조**: 계획서 1개·마일스톤 2개, 1a := M1 이관, 1b := M2 검색. 첫 3개 태스크는 제품 Supabase 부트스트랩 → 제품 앱 타깃 → Gmail 제품화(§15).

목록 밖 추가 결정: (HIGH) `EruriCore`·`poc/server`는 리뷰 후 제품으로 승격하고 PoC 앱 타깃·UI만 폐기(§11, §14). (HIGH) 게이트 폐기 항목 7일 격리 후 본문 삭제, 제품 앱 "최근 폐기"에서 복구(§7, §8, §12 통제 2), 지인 확대 시 재검토(아래 미결 리스크). (MED) PoC 프로젝트 은퇴 절차·시점을 §11·§15 1a 완료 기준에 명시하고 `results.md`에 기록. (MED) 제품 앱 `MARKETING_VERSION`은 0.3.0부터(§11). (LOW) 진단 trace는 제품 `device_traces`(본문 없음, 30일, 진단 전송 토글)로 유지(§8).

**2026-09-30 확인 항목 8 판정 변경**: 제안 리뷰 화면을 1단계로(실기기에서 알림을 놓치면 등록 수단이 없음 발견 — 잠금화면 알림을 길게 눌러 "캘린더에 추가"할 때만 등록되고 배너 탭은 앱만 열었다). 사용자 승인(Ruling 8'): 배너 탭 → 제안 시트, 앱 "제안" 탭(대기 목록·추가·무시), 알림 "무시" = `dismiss_proposal`(§8 `dismissed`, §10, §11). REVIEW·할 일 제안의 수정 화면은 여전히 2단계.

### 2026-10-01 보관 정책 변경(사용자 결정)

사용자 결정(2026-10-01, 1인 사용 1단계). 절차는 사용자 지정대로 스펙·계획 → Codex 리뷰 → Fable 리뷰 → 서브에이전트 실행. 계획 `docs/superpowers/plans/2026-10-01-retention-summary.md`.

1. **채팅 → 보관함 보기**: 답변의 "보관함에서 보기"가 그 질문의 검색 후보 전체(인용만이 아니라 하이브리드 융합 목록 전체 + facts, 최대 100)를 보관함에 넘긴다(후보 정의·상한은 아래 "2026-10-01 검색·캘린더 결정" 1·2로 교체 — 인용 ∪ 구별 facts ∪ 관련도 컷, 최대 20, 거절이면 없음). 보관함은 그 집합만 순위순으로, 출처 탭·원문 보기·무한 스크롤과 함께 보인다(§9, §11).
2. **원문·청크 90일 → 3년**: `items.content_enc`·`ocr_text_enc`와 `item_chunks`. 기준은 지금과 같이 서버 수집 시각(`captured_at + 3년`) — 받은 시각 기준이면 90일 백필 메일이 3개월 일찍 지워진다. 이미 있는 행도 연장한다. 이미지 **파일**(Storage)은 결정 범위 밖이라 30일 그대로 두고 원문 만료와 분리한다(§8).
3. **요약 영구 보존**: 원문을 지우기 전에 항목별 요약을 사용자 키로 암호화해 남기고, 원문 삭제 뒤에도 요약으로 검색한다(키워드·임베딩). 생성 시점 판단:

   | 안 | 비용(월, 일 60건) | 의존성·위험 | 판정 |
   |---|---|---|---|
   | A. 수집 때 추출 호출에 필드 추가 | 약 $0.17(출력 150토큰 추가분) | 추출 스키마 변경(출력 상한 800), 원문을 다시 읽지 않음, 요약이 수집 직후부터 있음(상세 화면에서 확인 가능) | **채택** |
   | B. 만료 직전 배치 | 건당 약 $0.00024 × 누적분(1년치 약 2.2만 건이 한 달에 몰리면 약 $5 ≈ 7,400원, 월 상한의 74%) | 3년 뒤 모델 퇴역·가격 변동, 예산 소진 시 요약 없이 지우거나 원문을 못 지움, **용량 비우기가 LLM 가용성에 묶임** | 기각 |
   | C. 수집 때 별도 호출 | 약 $0.45(입력을 한 번 더) | LLM 슬롯 2배 사용, 이득 없음 | 기각 |

   A의 빈틈(M1 기간 항목·실패·복구)은 `summarize` 잡이 월 예산 `extract`로 메운다. 요약 임베딩은 원문·청크가 지워질 때 만든다(지연 — 청크가 있는 동안 벡터 두 벌을 두지 않아 요약당 약 4KB 절약, 비우기가 OpenAI에 묶이지 않음). 요약의 개인정보 등급은 본문과 같다(§8 `item_summaries`, §12).
4. **용량 보호**: 한도(무료 500MB)에 가까우면 오래된 원문·청크 → 오래된 요약 순으로 비운다. 측정·임계·순서·주기·알림은 §8 "용량 보호".

**사용자 확인 대기** (계획 "스펙 확인 필요" 절과 같은 번호):

- **UC-1 청크 평문 기간**: A 3년 평문(구현 없음, 키워드 검색 3년, 덤프 노출 3년) · **B 90일 평문 뒤 청크 본문 암호화·임베딩 유지(권장)** · C 전부 암호화(최근 키워드 검색 상실, 비권장). 상세 §12 통제 1. 계획은 리뷰 권고로 B를 기본값으로 둔다(계획의 R-B7 필수 태스크, R-B8에서 `chunk-cool-daily` 등록) — 무응답을 3년 평문 승인으로 취급하지 않는다. A로 답하면 cron만 끈다.
- **UC-2 무료 플랜에서 3년 불가**: 추정 연 약 300MB(메일 20·알림 40/일)라 유효 크기 85%에 약 1.2~1.5년 뒤 닿고 그때부터 가장 오래된 원문이 롤링으로 지워진다. 권장: 1인 단계는 무료 + 롤링 수용(요약·사실은 남음), 3년을 지키려면 Pro 전환(월 $25 수준 — 월 1만원 예산 밖, 가격표 확인 필요).
- **UC-3 요약 키워드 평문**: 키워드 검색 요구를 지키려면 평문 키워드가 필요하다(권장, `facts.payload` 등급). 거절하면 원문 삭제 뒤 요약은 의미 검색만 된다.

### 2026-10-01 검색·캘린더 결정

0.7.0 실기기 피드백(2026-10-01 02시대) 네 가지 — ① 거절 답변에도 "보관함에서 보기"가 뜬다 ② 후보에 무관 항목(합성 의원 예약 문자, 다른 날짜가 든 문자)이 섞인다 ③ 일정 질문은 기기 캘린더도 함께 봐야 한다 ④ 일정 추가 때 겹치면 확인받아야 한다 — 를 Fable 검토(`.context/fable-search-review.md`, 제품 DB 합성 질문 6개 재현 — 점수·개수만)의 권장대로 정했다. 절차는 사용자 지정대로 스펙·계획 → Codex 리뷰 → Fable 리뷰 → 서브에이전트 실행. 계획 `docs/superpowers/plans/2026-10-01-search-calendar.md`.

재현(청크가 있는 항목 25, 활성 event fact 7): 여섯 질문 모두 후보 **25/25**(의미 상위 40이 하한 없이 채워지고 후보 = 융합 80 전부), "10월 3일 일정 있어?"는 `10월`→`10` 변형이 시각·번호의 `10`에 맞아 키워드 일치 청크 11/25, 일정 질문의 facts는 기간 없이 `kinds=['event']`만 남아 질문과 무관한 최근 5건이 문서·후보 맨 앞에 왔다.

| # | 결정 | 바뀌는 곳 | 사용자 확인 |
|---|---|---|---|
| 1 | 거절이면 서버가 `candidates: []` → 버튼 없음(앱 0.7.1은 이미 거절이면 숨긴다) | chat 함수 | 불필요 |
| 2 | 후보 = 인용 ∪ 구별 조건 facts ∪ 상대 컷(키워드 ≥ 1위×0.5 또는 의미 ≥ 1위×0.85) 통과 융합 행, 최대 20(§9) | chat 함수(마이그레이션 없음) | 불필요 |
| 2b | 숫자가 든 어절은 숫자로 끝나는 변형을 만들지 않는다(§9) — 순위가 바뀌므로 ⑩b 전에 | `hybrid_search` 마이그레이션 | 불필요 |
| 2c | 필터에 `event_from/to` → facts를 일정 날짜로 거름(§9). 받은 기간과 일정 기간은 SQL 에서 분리(외부 리뷰 반영) | chat 함수 + `search_facts` 마이그레이션 0024(`fact_when`은 0019) | 불필요 |
| 3 | **기기 안 결합**: 서버는 일정 기간(`schedule`)만 주고 앱이 EventKit을 읽어 답 아래에 표시. 캘린더 내용은 서버·LLM으로 가지 않는다(§9, §12 통제 2) | chat 응답 필드 1개 + 앱 0.8.0 | 불필요(등급 변화 없음) |
| 4 | 겹침이면 저장하지 않는다. 앱 안은 확인창, 잠금화면은 로컬 알림으로 앱 확인 유도(§10). 0.8.1: 겹침을 보고 "겹쳐도 추가"를 누르면 확인창 없이 저장 | 앱 0.8.0·0.8.1 | 불필요 |
| 5 | 버전: 서버 수정은 앱 버전 없음. 앱 0.8.0 = 캘린더 표시 + 겹침 확인, 요약·저장 공간 화면(보관 계획 R-B9)은 0.10.0(0.9.0은 다건 일정, 2026-10-01)(§11) | §11 | 불필요 |

- 캘린더 결합 방식 비교(Fable C): 앱이 모든 질문에 일정을 첨부(과수집, 기각) · 두 번 왕복해 LLM이 섞어 답함(UC-4로 보류) · 앱이 날짜 표현을 직접 해석(서버 필터와 어긋남, 기각) · **기기 안 결합(채택)**.
- 보관 계획 트랙 B와의 관계: R-B4(요약 검색)는 `hybrid_search`를 다시 만들므로 2b의 숫자 어절 조건을, `deps.search` 교체본은 2의 상대 컷을 그대로 옮긴다(보관 계획 R-B4에 적었다). 마이그레이션 번호는 원장 Ruling M#대로 다음 빈 번호라 트랙 B 예정 번호가 두 칸 밀린다(이 계획이 0023·0024를 쓴다).
- 상대 컷 상수(0.5·0.85·20)는 25항목 코퍼스 값이다. 게이트에서 후보 개수만 보고 고치지 않는다 — ⑩b 후보 재현율(§9)이 0.9 미만이면 §9를 먼저 고쳐 재결정한다(외부 리뷰 반영).

**사용자 확인 대기**:

- **UC-4 캘린더를 답변 모델에 섞기(2차 안)**: 일정 질문이면 서버가 "캘린더 필요 + 기간"을 돌려주고 앱이 EventKit을 읽어 일정을 첨부해 다시 묻는 두 번 왕복 안이다. "다음 주 비는 시간", "메일엔 3시인데 캘린더엔 몇 시?" 같은 섞어 답하기가 되지만 **캘린더 제목·시각이 chat 함수와 OpenAI로 간다** — ERURI가 수집하지 않던 데이터 범주가 새 수신자에게 가는 변경(§12 통제 2·3)이고 지연이 2배다. 사용자 확인 전까지 구현하지 않는다(0.8.0 범위 밖). 한다면 조건: 일정 질문일 때만, 서버가 돌려준 기간만, 필드는 제목·시작·끝·종일 여부만(메모·참석자·장소·URL 제외), 서버 저장·로그 없음(`store: false`, 요청 메모리에서만), 설정에 끄기 스위치.

**2026-10-01 실기기 C2 피드백**: ① 겹침을 보고 "겹쳐도 추가"를 누르면 확인창 없이 저장하고, 누른 순간 새로 발견된 겹침(C2-5)만 확인창을 띄운다(§10, 앱 0.8.1) ② 업로드→처리 시작 ~50초(매분 cron 대기)를 줄이려고 `/ingest`·`gmail-webhook`이 잡 생성 직후 워커를 즉시 호출하고 cron은 회수용으로 둔다(§7 "작업자 즉시 호출").

### 2026-10-01 수집 자동화 앱별 분리(사용자 결정)

사용자 결정(2026-10-01 17:2x KST): **수집 자동화 2개, 앱별 분리**. 2026-09-28 "알림 트리거 1개(메시지 앱 포함)" 결정을 대체한다(§5).

- **자동화 ① 문자**: 메시지 트리거, 조건 "메시지에 다음을 포함 ' '"(띄어쓰기 한 칸 — iOS가 조건을 요구), 즉시 실행 → "비서에 저장" 본문 = 단축어 입력의 내용, 출처 = `MESSAGES`, 보낸 사람 = 발신자.
- **자동화 ② 그 밖의 앱**: 알림 트리거, 앱 선택에서 **메시지 앱 제외**. 앱별로 나눠 받으므로 같은 문자가 두 번 오지 않고 서버 중복 제거가 필요 없다(§15 2단계의 "병행 시 2건 중복 제거" 삭제).
- 경과·근거: 알림 트리거는 iOS가 알림 본문을 약 255자로 잘라 넘긴다 — 양천구청 장문 문자가 251자로 잘려 도착(item `94a7c530…`, Apple 개발자 포럼 709671에도 같은 보고). 메시지 트리거는 원문 전체를 넘긴다 — 708자 장문 도착(08:11:41Z). 대신 실행마다 시스템 "자동화 실행" 배너가 뜨고 끌 수 없다: iOS 26에 "실행 시 알림" 옵션이 없고, 설정 → 알림에 단축어 항목이 없다(사용자 확인 — 09-28 기록의 "단축어 알림 허용 끄기로 줄임"은 이 기기에서 성립하지 않는다).
- **감수**: 문자마다 배너, 띄어쓰기 없는 짧은 문자("네" 등)는 조건에 안 걸려 미수집.
- 기존 데이터: 09-28~10-01 알림 경로로 들어온 문자(`source=NOTIFICATION, app_name=메시지`)가 남아 있으므로 이 조합을 `MESSAGES`와 같이 취급하는 규칙(서버 규칙 필터·Jev 메신저 판정·`SourceLabel`·보관함 출처 탭, §7)은 **유지**한다.
- 가이드 `docs/superpowers/reports/2026-09-27-shortcuts-setup-guide.html`을 자동화 2개 흐름으로 고쳤다. 앱 코드는 바꾸지 않는다(`CaptureIntent`의 `source` 파라미터에 사용자가 `MESSAGES`를 넣는다).

### 2026-10-01 다건 일정·묶음 알림 (사용자 결정, 앱 0.9.0)

실사용 문자 1건(날짜 여럿)이 일정 제안 1건만 만든 원인은 둘이었다(`.context/sms-multidate.report.md` — 원문 없이 길이·id·상태만): 수집에서 알림 트리거가 본문을 255자로 잘랐고(위 "수집 자동화 앱별 분리"로 해결 — 문자는 원문 전체), 그와 별개로 스키마(단일 객체)·지시문("하나를 골라")·`save_fact`(같은 항목·같은 종류 active fact 1개)가 모두 "항목당 하나"로 설계돼 있었다. 결정: event 최대 5개(별개 일정은 각각, 같은 행사 기간은 하나, 부수 일시는 일정 아님, 넘치면 시작이 이른 5개), 연도 없는 날짜는 받은 해(단건·다건, 지난 날짜여도 내년으로 넘기지 않음, 원문의 연도 단서는 따름 — 지난 일정은 제안만 남고 푸시 없음), 행사 나열 문자도 최대 5건(고르는 것은 사용자), task·purchase 1개, 알림은 항목당 1개 — 2건 이상이면 `EVENT_BUNDLE` 묶음(잠금화면 액션 없음, 배너 탭 → 시트 N장, 카드 판정은 제안 id 상태 직접 조회), 1건이면 그대로(§7·§10). 저장은 한 트랜잭션(`save_facts`, 0025). 기존 항목은 다시 추출하지 않는다. 앱 0.9.0을 서버 배포보다 먼저 올린다(0.8.3 이하는 묶음 속 확인 필요 일정을 보이지 못한다). 계획 `docs/superpowers/plans/2026-10-01-multi-event.md`. 영향: 출력 토큰 상한 512 → 2,048(상한은 잘림 방지 — 실사용량만 과금, 평균·최대 출력은 평가 기록 `MEV-eval`), 채팅 facts 상한(5·8)은 fact 단위라 다건 항목이 여러 칸을 쓴다, M2 검색 평가 ⑩b — 코퍼스가 고정이면 기준선은 같고, 배포 뒤 다건 항목이 facts 칸을 여러 개 쓰므로 ⑩b 기록에 실행 시각·배포 시각을 적는다. 회귀 위험은 공지형 문자 오분할·장문 출력 잘림 — 합성 공지 22종 × 3회 실제 모델 평가(`supabase/eval/run-multi-event-eval.ts`)로 게이트한다.

### 2026-10-01 중복 일정 확인 (사용자 결정, 앱 0.9.2)

종일 일정은 겹침 판정 대상이 아니라(0.9.1) 같은 공지를 두 번 받거나 이미 손으로 넣은 행사를 또 추가해도 막을 길이 없었다. 결정: "같은 일정이 이미 있는가"로 **느슨하게** 잡고 사용자가 보고 승인한다("그래도 추가"). 앱(§10 "비슷한 일정"): 제안 날짜의 캘린더 일정 중 제목이 비슷하면(정규화 같음·포함·ERURI 표식 + 공통 핵심어) 상태 줄과 "그래도 추가", 잠금화면은 저장 대신 로컬 알림. 시각 제안은 겹침이 우선이고 겹침이 없을 때만 비슷한 일정(Ruling). 서버(§7 notify, 0027): 다른 항목의 먼저 생긴 대기 제안과 같은 날짜 + 같은 정규화 제목이면 제안은 만들고 푸시만 뺀다(묶음은 남은 것만, 0건이면 푸시 없음). 기각: 서버에서 제안을 만들지 않기(save_facts 판정·되돌릴 수 없음), 서버에서 느슨한 비교(오판이면 알림이 조용히 사라짐), 비슷하면 자동 차단(오판이면 추가할 길이 없어짐 — Fable #10과 같은 이유). 남은 것: 같은 일정 대기 제안 두 건이 제안 탭에 함께 보인다(하나를 넣으면 다른 하나는 "등록됨"·"비슷한 일정").

### 2026-10-01 날짜만 일정 = 종일 일정 (사용자 결정 A, 앱 0.9.1)

실기기에서 공유한 공지의 일정이 시각 없이 날짜만 추출됐다(`start` = `YYYY-MM-DD`). 배너는 갔지만(`REVIEW`) 대기 목록(0022)은 시각 있는 start 만, 채팅 카드는 "시간 미정 · 날짜만 확인돼 바로 추가하지 않음"이라 처리할 곳이 없었다. 결정 A: 날짜만이면 종일 일정으로 추가, 시각이 있으면 지금처럼 그 시각으로. 푸시 `ADD_EVENT`(+ 여러 날이면 `end`), 목록 0026(text start·end, `all_day`), 앱 `ProposalTiming`(§10 "종일 일정"). 종일은 겹침 판정 대상이 아니다. 기각: B(날짜만은 계속 버튼 없이 안내만 — 처리 경로 공백이 그대로), C(시각 입력 화면 — 2단계 수정 화면 범위).

### 외부 리뷰 반영 (다건 일정 계획, Codex gpt-6-astra · Fable, 2026-10-01)

| # | 지적 | 반영 |
|---|---|---|
| 1 | 묶음 카드 상태를 50건 제한 목록으로 판정(Codex 1) | 반영(경량) — 알림의 제안 id ≤5 상태를 REST 로 직접 조회, 새 RPC 없음(§10). "대기 51건"은 단위 테스트만 |
| 2 | 서버 롤백 절차(Codex 2) | 반영(하향) — DB 는 되돌리지 않고 옛 워커 재배포·전진 수정 기준만(계획 T6). "다건 추출만 끄는 복구 버전"은 미반영(옛 워커 재배포가 그 역할) |
| 3 | 장문·5건 출력 상한(Codex 3 · Fable N1) | 반영 — 상한 2,048, evidence 80자 지시, 장문 사례·`error` 코드 |
| 4 | 날짜 접두 비교가 시각 환각 통과(Codex 4) | 반영 — 날짜만 기대는 완전 일치, 원인 코드 `time` |
| 5 | 6개 이상일 때 고르는 5개(Codex 5) | 반영 — 지시문 "시작이 이른 5개" + 섞인 순서 사례 |
| 6 | 시드·G1 불일치(Codex 6) | 반영 — 출력 디렉터리 생성, 시드를 시작 순으로 |
| 7 | 연도 없는 지난 회차가 내년으로(Fable N2) | 사용자 결정으로 대체 — 버리지 않고 연도 없는 날짜는 받은 해(단건·다건, 연도 단서는 따름), 지난 일정은 푸시 없음 |
| 8 | 전제 "입력 잘림 없음"이 §16 과 모순(Fable N3) | 반영 — 위 소절 문구 |
| 9 | 게이트 재시드가 앱 세션을 끊음(Fable N4) | 반영 — 비밀번호 불변 `testUserId`, 시드 한 번에 두 항목 |
| 10 | 내 일정이 아닌 행사 목록 증폭(Fable N5) | 반영 — 광고 라인업 `none`, 기관 월간 소식은 최대 5건(사용자 결정 — 고르는 것은 사용자, 불편하면 그때 수정) |
| 11 | 배포 순서·실기기 최소화·`save_facts` payload 검증·시트 식별·grep 기대(Fable N6~N10) | 반영 |

### 플랜 B: 로컬 우선 구조 (미채택, 신뢰 문제 발생 시 전환)

서버 저장에 대한 신뢰 문제가 지인 확대 단계에서 커지면 다음 구조로 전환할 수 있다. 1인 데이터 규모(연 청크 2만 개)에서는 기기 SQLite(FTS5 trigram + 벡터 브루트포스)로 검색 효율이 충분하다는 것을 확인했다.

- 기기 SQLite가 단일 원본. 서버는 (a) Gmail Pub/Sub → APNs 가시 푸시 중계, (b) LLM 프록시·예산 카운터, (c) Gmail `watch` 7일 갱신(refresh token은 서버에 남음)만 담당한다. 프록시는 저장하지 않을 뿐 평문을 처리하므로 서버 신뢰가 완전히 사라지지는 않는다.
- 실시간 처리는 Notification Service Extension이 맡는다. 조건: 푸시에 `mutable-content: 1`과 alert 페이로드가 있어야 하고, 사용자가 이 앱 알림을 꺼 두면 NSE는 실행되지 않는다. 실행 시간은 **최대** 30초(보장 아님)이며 초과 시 시스템이 원래 알림을 그대로 표시한다. 따라서 NSE는 Gmail 페치 → 로컬 저장까지를 체크포인트로 두고, 추출까지 못 마치면 "새 메일 1건" 알림으로 끝내고 앱 실행 시 이어서 처리한다. 잠금 중 Gmail 토큰 접근을 위해 키체인 항목은 `kSecAttrAccessibleAfterFirstUnlock`.
- 따라잡기는 `BGAppRefreshTask`(시스템 재량, 보장 없음), 무거운 배치(임베딩·정리·백필)는 `BGProcessingTask`에 `requiresExternalPower = true`로 요청. 둘 다 앱 강제 종료 시 실행되지 않으므로 앱 실행 시 전체 flush가 최종 안전망이다.
- 서버를 완전히 없애는 변형: Gmail을 Apple Mail에 추가하고 Shortcuts **Email 트리거**(무확인 자동 실행 목록에 있음)로 수집. 지연 15분 이상, 트리거가 본문을 넘기는지 미확인.
- 잃는 것: 폰이 꺼진 동안의 처리, 기기 간 공유, 서버 측 검색 품질 튜닝. 전환 비용: §7 파이프라인 대부분을 Swift로 재작성.

### 미결 리스크 (2026-09-27)

- **알림 트리거 배너 탭**: 사용자가 알림마다 탭해야 하면 편의성이 크게 떨어진다. PoC-1(실기기) 결과에 따라 2단계 범위를 재조정한다.
- **백필이 증분 동기화를 굶긴다** (PoC-6 실측 2026-09-27): `jobs`가 생성 순 FIFO라 백필이 만든 `process` 잡 37건 뒤에 웹훅의 `gmail-sync`가 11분 대기했다. 1a(M1 Gmail 제품화 태스크)에서 `jobs.priority`(notify > gmail-sync > process > backfill, §7)를 둔다. 백필 잡은 사용자당 동시 1개로 제한.
- **OpenAI 30일 보관**: ZDR은 사전 승인제라 본인 사용 단계에서는 남용 모니터링 30일 보관을 수용한다. 지인 확대 시 ZDR 신청, 거절되면 처리방침에 명시.
- **인용 검증의 한계**: OpenAI에는 문서 인용 기능이 없어 인용은 모델이 JSON에 적은 `source_item_ids`다. 서버는 id가 검색 결과에 있는지만 확인하므로 "있는 문서를 잘못 인용"은 구조적으로 막지 못한다. PoC-7 합성 평가에서는 인용 36/36·정밀도 39/39였다. 1b(M2) 실데이터 검색 평가(§9 절차, 사용자 👍/👎)에서 다시 재고, 미달 시 문장-문서 대조(gpt-6-luna 재검증) 단계를 추가한다.
- **음력 날짜** (PoC-8 실측): 모델의 음력→양력 환산이 하루씩 틀린다. 음력 표기는 `uncertain: date`로 REVIEW에 보낸다(§7). 자동 환산은 서버 변환표로만.
- **worker 분류와 폐기(0b → 1단계)**: 처리 순서(규칙 → Jev 게이트 → 추출 → `save_fact`)는 0b 그대로 제품 순서다(§7). 폐기 처리(게이트 폐기 7일 격리 → 본문 삭제, Jev 6종)는 1단계 M1 분류 태스크(④)에서 만든다(2026-09-30, 이전의 "1a 진입 조건"을 이 태스크로 옮김).
- **폐기 7일 격리(1인 사용 기간)**: 게이트 폐기 항목의 본문이 암호화 상태로 7일 서버에 남는다(개인 대화 포함). 오폐기 복구와 Jev 실데이터 정확도 측정을 위해서다. 지인 확대(3단계) 때 즉시 삭제로 되돌릴지 재검토한다.
- **Gmail 7일 재인증**: 테스트 모드 refresh token 만료(`connections.expires_at`) 24시간 전 푸시로 완화. 본인 사용 기간엔 감수. 지인 확대(3단계) 시점에 앱 검증 비용을 결정한다. 6일·8일 동작은 1단계 M1-③ 게이트(PoC-6 흡수).
- **모델 ID 수명**: `gpt-6-luna`·`gpt-6-sol`은 별칭과 스냅샷이 같은 ID 하나뿐이다. 날짜 고정 스냅샷이 나오면 제품 코드에서는 스냅샷으로 고정한다.
- **Supabase 무료 티어 500MB** (2026-10-01 갱신): 원문 3년 결정 뒤에는 1인 데이터만으로 약 1.2~1.5년에 85%에 닿는다(§8 용량 보호 추정). 넘으면 프로젝트가 읽기 전용이 되어 수집·처리가 멈춘다(§3). 대응: `cron.job_run_details` 정리(없으면 연 약 250MB), 쓰지 않는 `tsv`·GIN 색인 제거, 매시 측정·85% 비우기, 보고 크기(`pg_database_size`)가 줄지 않는 문제는 유효 크기 판정 + 운영자 `VACUUM FULL`. 이미지 포함 시 Storage 1GB 상한 감시. 무료 롤링 대 Pro는 UC-2.
- **Foundation Models 가용성**: Apple Intelligence 꺼진 기기는 규칙 필터만(카톡·인스타 폐기, 그 외 서버 분류). 지인 확대 시 안내 필요.
- **시뮬레이터 FM 가용성이 호스트 Mac 설정에 종속**: 시뮬레이터는 호스트 Mac의 모델을 쓴다. 호스트가 Apple Intelligence 꺼짐(`appleIntelligenceNotEnabled`, macOS 26.5에서 직접 호출로 확인)이면 시뮬레이터 `respond`는 에셋 오류를 내는데 `availability()`는 **`available`로 오표시**한다. 따라서 시뮬레이터 FM 결과는 판정 근거가 아니고, 가용성은 1건 사전 점검(§6)으로 판단한다. PoC-3 실기기 수치(콜드 타임아웃 상수)로 PoC-3은 실패(대안 채택)로 마감했다(2026-09-30).
- **FM 백그라운드 `rateLimited`**: 백그라운드 인텐트에서만 나는 에러다. 0.2.3부터 에러는 출처와 무관하게 `rules`로 적재되므로 유실은 없다. 대신 빈도가 높으면 기기 방어선 없이 카톡·인스타 원문이 서버 게이트로 간다. 제품 `device_traces`(§8)로 빈도를 지켜본다(PoC-3은 실패(대안 채택)로 마감, 게이트 아님).
- **예약 확인번호 오탐**: "예약 확인번호 58213"이 든 병원·식당 예약 안내는 OTP 규칙으로 폐기된다(§6 알려진 한계). 2단계에서 `otp` 사유 코드 비율을 보고 재검토한다.
- **연락처 규칙**: 앱이 연락처 이름을 App Group에 캐시하고 인텐트가 `sender`·`title`과 비교하도록 배선했다. 시뮬레이터 실측 완료(합성 연락처, `results.md` 참고). 실기기 카톡·문자에서의 확인은 PoC-1/2에서 한다.
- **서버 분류 게이트 Jev(0b)**: 2026-09-29 채택(합성 60문구 60/60, p50 211ms, 건당 약 $0.00003). 남은 조건: 실데이터 200건 이상 재측정
  (1단계 M1-④ 게이트. 원문 없이 라벨·confidence와 사용자의 오폐기·오통과 표시만 기록, 기준 게이트 정확도 ≥ 90%·t=0.8 actionable 유실 ≤ 1%), TypeSafe 보관 기간·하위 처리자·리전 확인(§12 통제 3).
  OpenAI 소형 모델로 바꾸는 조건(하나라도): 보관 조건이 OpenAI store:false보다 약함, 실데이터 기준 미달, worker 429·529 fail-open 비율 > 5%,
  Edge 리전 p95 > 1초. 운영 요청 형태(jev-1.13.0 고정, 발신자 미전송) 재현 결과는 results.md PoC-3 → 운영 적용(09-29)

### 해소된 리스크

- **임베딩 보류 — 해소 (2026-09-27, PoC-7 통과, `9e8ab9f`)**: 약관 사유는 2026-09-26 OpenAI 데이터 정책 확인(학습 미사용·남용 모니터링 30일, 임베딩은 분류와 같은 공급자·약관이라 새 전송처가 아님, §12 통제 3)으로 먼저 풀렸고, 남은 조건인 PoC-7(합성 코퍼스, 하이브리드 경로)이 통과했다. 실제 데이터 임베딩은 1b(M2) worker에서 연결한다. 실데이터 연결 M2-⑧a.
- **임베딩 한국어 품질 — 해소 (2026-09-27, PoC-7)**: 공식 문서에 한국어 수치가 없어 합성 평가로 판정했다. 하이브리드 Top-5 `text-embedding-3-small` 31~33/40, `text-embedding-3-large`(`dimensions: 512`) 38/40 → large 채택(§2).
- **APNs from Deno (h2) — 해소 (2026-09-27, `e2552b5`)**: Deno `fetch`가 HTTP/2로 협상한다(sandbox 가짜 토큰 `400 BadDeviceToken` + `apns-id`, HTTP/1.1 대조군은 연결 거부). Edge 서울 100회 동시 1 → 100/100 p50 419ms. JWT 동시 생성 429는 in-flight 공유 + 30분 경계 iat로 고쳤다. PoC-4 판정 실측(2026-09-30, 실기기 production 토큰 100회 동시 10 × 2)은 100/100·h2 오류 0으로 통과했고 `GOAWAY` 스트림 오류는 재현되지 않았다(가짜 토큰의 부작용). Cloudflare Worker 릴레이는 불필요.
- **jobs 임대 만료로 중복 실행 — 해소 (2026-09-26, PoC-10, `6ca66d8`)**: 임대 60초에서 90초 잡이 65초에 재클레임돼 두 번 실행됐다. 임대 180초(Edge wall-clock 150초보다 김) + 30초 하트비트로 재클레임 0건·attempts 1(§7).
- **Edge 복호화 비용 — 해소 (2026-09-26, PoC-10)**: 건당 AES-GCM 복호화 p50 0.7ms·p95 56ms(격리 인스턴스 첫 호출의 키 조회 포함), CPU 1ms 미만이라 CPU 2초 한도는 배치 크기를 제약하지 않는다. `p_limit` 5 유지, 늘릴 때는 cron `timeout_milliseconds`·wall-clock 기준.

### 0단계 Opus 재검증 반영 (2026-09-24, Task 1~7)

재검증 A(Task 1~3), B(Task 4~6) 지적을 `0d2a293`에서 반영했고 이 스펙에 결과를 옮겼다: 큐 WAL·busy_timeout(§6 큐), 카드·계좌·OTP 규칙 정밀화(§6 기기 규칙 필터), FM 새 세션·enum·에러 폴백·제시간 타임아웃(§6 FM 분류), 알림 액션 직렬 구간(§10), claim lease(§6 업로더), 검진 결과 안내 라벨 결정(§6 라벨 정의). 판단 근거는 각 절에 한 줄씩 적었다.

### 코드 수정 필요 (스펙 대비, 2026-09-24)

코드가 스펙을 어긴 곳이다. 스펙은 그대로 두고 코드를 고친다. 1~4는 코드 수정 완료, 5는 1a(M1) 제품 앱 이관 때 구현한다. 표의 "순서 1"은 §6 기기 파이프라인의 규칙 필터 단계다.

| # | 스펙 | 현재 코드 | 수정 |
|---|---|---|---|
| 1 | §6 순서 1: 규칙 필터를 `text`와 `title`에 적용 | `CaptureIntent`·`CapturePipeline`이 `text`만 필터링. `title`은 원문 그대로 큐에 들어간다 | `title`에도 OTP 폐기·카드/계좌 마스킹 적용. **완료 (affe7e9)**: OTP는 제목+본문을 합쳐 판정, 마스킹은 각각, 마스킹된 `title`이 FM 입력과 큐로 |
| 2 | §6: Share Extension도 규칙 단계 적용 | `ShareViewController`가 텍스트·URL·OCR 텍스트를 규칙 필터 없이 큐에 넣는다 | 텍스트·URL·OCR에 `RuleFilter` 적용. OTP 폐기면 큐에도 넣지 않고 파일도 영속화하지 않는다(임시 복사 → OCR → 규칙 → 영속화). **완료 (affe7e9)** |
| 3 | §6 연락처 규칙: 목록 캐시, `sender`+`title` 비교, 공백·호칭("님"/"씨") 정규화 | `RuleFilter()`를 연락처 없이 생성, `sender` 정확 일치만 비교 | 앱 실행 시 연락처 이름을 App Group에 캐시하고 인텐트가 읽는다(0단계 계획 Task 4 Step 6). **완료 (affe7e9)**: `ContactNames`, 공백 전부 제거·끝 "님"/"씨" 제거, `sender`·`title` 비교 |
| 4 | §6 라벨 정의: 검진 결과 준비 안내 = `medical_result` | FM 픽스처 4건("건강검진 결과가 준비되었습니다")이 `expected: notice`, `@Guide` 설명에 결과 안내 경계가 없다 | 4건을 `medical_result`로 바꾸고 벤치마크 집계(개인 대화 통과율·알림톡 폐기율)에서 따로 센다. `@Guide`에 경계 문구 추가. **완료 (affe7e9)**: 픽스처 personal 100·notice 96·medical_result 4, `medicalDrop=x/4` |
| 5 | §10: 기록 없을 때 EventKit 표식 조회로 복구 | 표식(`ev.url`)은 넣지만 저장 전 조회는 없다 | PoC에서는 허용. 1a(M1) 제품 앱 이관 때 구현 |

### 0단계 운영 기록 (규칙 위반과 조치)

- 2026-09-27 03:18: 서버 pane의 호스팅 DB 테스트(`jobs.test.ts`)가 `jobs`를 조건 없이 지워 PoC-6 실측 중이던 fetch 잡이 사라졌다(메일 1건 누락, 404 재동기화로 복구). 조치: 전용 테스트 사용자·실행 태그로 자기 행만 지우고 전역 함수에 범위 인자(`0010_test_scope.sql`, `cf786bb`), AGENTS.md §7에 규칙 추가.
- 2026-09-27: Task 11 검색 평가(deno)가 다른 pane의 시뮬레이터 빌드와 겹쳐 돌았다(AGENTS.md §6 "시뮬레이터 빌드와 deno 테스트를 동시에 돌리지 않는다" 위반). 조치: 서버 태스크 지시문에 deno 테스트 전 `pgrep -x xcodebuild` 확인을 넣었다.
- 2026-09-27: Task 12에서 `.env`를 셸로 `source`하다 파싱 오류 메시지에 APNs `.p8` 개인키 일부가 에이전트 세션 출력에 찍혔다(커밋·외부 전송 없음). 조치: 키를 새로 발급해 교체(13:15, Edge secrets 반영을 해시로 대조), `.env`는 셸로 읽지 않고 `deno --env-file` 또는 필요한 한 값만 추출한다.
- 2026-09-28: 실기기 세션 1에서 APNs `.p8` 키가 에이전트 세션 출력에 두 번 노출됐다(커밋·외부 전송 없음). 조치: 키 교체 예정, PoC-4 동시 10 측정은 교체 뒤에 한다.
- 2026-09-29: APNs 키 교체 완료(JBJLM8Q473 → Q8469KDH4D, Sandbox & Production, Team scoped). `.env`는 `APNS_P8_PATH` 파일 경로 방식, Edge secret `APNS_P8` digest 를 파일 sha256 과 대조해 일치, JWT 테스트 12건 통과, 실기기 무음 푸시 200 → `poc9.wake` 1초. 구 키 Revoke·파일 삭제. 발급·취소는 브라우저 자동화로 수행했고 키 본문은 출력하지 않았다.
- 2026-09-28 결정(실기기 PoC-2, iOS 27): 자동화에서 "기존 단축어 선택"으로 실행하면 발신자만 오고 본문은 0자다(6건). 자동화 안에서 "비서에 저장" 액션을 직접 편집하고 본문을 단축어 입력의 "내용"으로 두면 본문·발신자가 온다. 따라서 **문자 수집은 자동화 안 직접 편집 방식으로 안내**하고, 공유 단축어 파일(`ERURI에 저장.shortcut`)은 보조로만 쓴다. 제약: 메시지 자동화는 조건이 필수라 "메시지 → 다음을 포함"에 공백 한 칸으로 전체 수신(이 조건에서 "실행 묻지 않기" 선택 가능), 자동화는 파일·링크로 배포할 수 없어 사용자마다 직접 만든다, iOS 27 단축어 UI는 iOS 26 문서와 다르다. §5 "알림 트리거 설정 가이드"도 같은 방식으로 만든다.
- 2026-09-28 사용자 최종 결정(**2026-10-01 "수집 자동화 앱별 분리"로 대체**): **수집 자동화는 알림 트리거 1개**(메시지 앱 포함). 경과: 05:50:19Z 메시지 앱 알림 경로로 문자가 `source=NOTIFICATION, app=메시지, title=발신자 이름, text 15자`로 도착(연락처라 `discarded:contact`, 정상) → 알림 1개 통일 검토 → 알림 누락(조용히 한 대화·알 수 없는 발신자 필터·집중 모드) 우려로 자동화 2개(`d8d34b4`)를 적었다 → 06:00Z 메시지 트리거 재생성 후 문자 3건(연락처에 있는 지인 발신) 모두 `src=MESSAGE, app=SMS`, 발신자 번호·본문 도착 → 사용자가 설정 단순함을 택해 알림 1개로 확정. 감수하는 한계: 알림이 뜨지 않는 문자는 수집 안 됨, 발신자는 표시 이름. 메시지 트리거(PoC-2 통과)는 원하는 사용자만 추가하는 선택 사항. 3건은 기기 FM이 `discarded:fm:personal`(지인 약속 문구)로 폐기 → PoC-3 실기기 재측정 항목. 시스템 "자동화 실행" 배너는 단축어 알림 허용 끄기로 줄일 수 있고 상단 잠깐 표시는 불가. 가이드 `2026-09-27-shortcuts-setup-guide.html`을 알림 자동화 1개 흐름으로 고쳤다.
- 2026-09-28: 실기기 세션 1에서 찾은 결함 — Release 빌드 서버 URL 기본값 `localhost`(0.1.1에서 수정), 실기기 로그인 수단 없음(설정 화면 PoC 계정 로그인 추가), 공유 파일 `PUT upload/<id>` 엔드포인트 없음(PoC-8·9 파일 경로 전 서버 작업), trace `locked` 판정이 잠금 직후 유예 구간에서 `false`(재검토). 상세 `results.md` "실기기 세션 1".
- 2026-09-30: 제품 Supabase 프로젝트 eruri(ap-northeast-2) 생성, 베이스라인 0001~0003 적용(PoC 카탈로그 대조 일치), 함수 6개 배포, M1-①b 게이트 통과.
- 2026-09-30: 제품 앱 0.3.0(202609300951) TestFlight, 단축어 알림 자동화를 ERURI로 재지정(이후 수집은 제품 프로젝트).

- **2026-09-30 1단계 계획 확인 항목 판정(계획서 "스펙 확인 필요" 15건)**: 1 서버는 `git mv`, `EruriCore`는 `ios/`로 복사 승격(PoC 동결 유지). 2 자동화 재지정은 M1-②d. 3 Jev 실데이터 정확도·유실 판정은 M2-⑨b(보관함 오통과 표시 뒤), M1-④b는 라벨 200건·오폐기 검토. 4 §7 요구를 담는 추가 열·표(`items.gate_*`·`quarantine_until`, `gate_feedback`, `reauth_pushes`, `executions.version`, `jobs.priority`·`claimed_at`·`not_before`, 백필 카운터, `llm_slots`)는 각 태스크에서 §8에 반영. 5 답변 형식은 `{answer, source_item_ids[], refused}`. 6 PoC 은퇴 시 Gmail은 연결 행 삭제만 기본(같은 Web 클라이언트라 revoke가 제품 연결을 끊을 수 있음), revoke는 사용자 선택. 7 발화·기억·정정은 1단계 제외, "취소·정정 반영" 지표는 2단계에서 판정. 8 알림 액션은 ADD_EVENT "캘린더에 추가"·"무시", ADD_REMINDER·REVIEW는 앱 열기, 제안 리뷰 화면은 2단계. 9 전체 삭제는 테스트 사용자로 서버 실측, 기기 정리는 시뮬레이터 단위 테스트. 10 `USD_KRW` 1400, 백필 예산 매달 1,500원, Jev는 예약 안 함. 11 기기 등록 정리 = 하루 1회 재등록 + 로그아웃 정리. 12 기기 FM 폐기로 인한 10문구 불일치는 자동 통과가 아니라 사용자 확인 후 판정. 13 Sign in with Apple은 이메일 범위 요청. 14 재연결 시 90일 재적재 유지. 15 URL 서버 fetch는 1단계 제외(URL 문자열만 저장), 2단계 파일 경로와 함께 구현.

- **2026-09-30 메일 수집 확장 후보(사용자 요청으로 기록, 1단계 범위 밖)**: iOS는 다른 앱이 메일 앱 본문을 읽는 API가 없다(MailKit은 macOS 전용, 단축어에 메일 읽기 동작 없음). 메일 앱 알림을 알림 자동화에 넣으면 발신자·제목·미리보기만 들어온다. 서비스 확대 시 후보: (1) **Microsoft Graph**(`Mail.Read` 위임 권한, Outlook.com·Hotmail·Microsoft 365) — Gmail과 같은 구조(OAuth 연결, 90일 백필, 변경 알림 웹훅 약 3일마다 구독 갱신 cron, 재인증 푸시, 동기화 복구)로 현재 서버 설계를 그대로 따를 수 있다. 공개 서비스에 CASA 같은 필수 보안 심사는 없고 게시자 확인 권장, 회사 계정은 테넌트 관리자 동의가 필요할 수 있다. (2) **전달 주소**(사용자별 수신 주소로 자동 전달) — 네이버·다음 등 API 없는 메일과 Gmail CASA 회피용, 과거 메일 없음. (3) IMAP 앱 비밀번호는 자격 증명 보관 부담으로 비권장. 결정 시점: 3단계 지인 확대 선행 조건(Gmail 앱 검증·CASA 비용)과 함께.
