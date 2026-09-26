# iOS 개인 비서 앱 설계 스펙

작성일: 2026-09-22 · 갱신: 2026-09-26 (AI 벤더 OpenAI 단일화) · 2026-09-24 (0단계 Task 1~7 실측 반영) · 상태: 초안(리뷰 대기) · 대상: iPhone 15 Pro 이상, iOS 26+, 한국

## 1. 목표

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
| 사용자 | 본인 → TestFlight로 지인 확대. Sign in with Apple | Supabase Auth `signInWithIdToken(provider: .apple)` 검증됨 |
| 백엔드 | Supabase 무료 티어 (Postgres+pgvector, Auth, Edge Functions, Storage, pg_cron) | 서버리스 선호, RLS 기본 제공 |
| 지능 위치 | 서버 중심. 기기는 필터·수집·EventKit·푸시 수신 | 앱 재배포 없이 파이프라인 수정, API 키 서버 보관 |
| 메일 | Gmail만. 초기 백필 3개월. `-category:promotions` 제외. Outlook은 만들지 않음 | 사용자 확정, Codex 리뷰 반영 |
| 문자 | Shortcuts **Message 트리거** → App Intent. 무확인 자동 실행 검증됨 | Apple 문서 "run automatically" 목록에 Message 포함 |
| 앱 알림 | Shortcuts **Notification 트리거** → App Intent. 카카오톡·Instagram·쇼핑/금융 앱 | **확인 배너 탭 필요 가능성 높음** (§3) |
| 공유 | Share Extension: 텍스트·URL·이미지·PDF | 사용자 확정 |
| 일정 등록 | 항상 확인 후. 알림 액션 버튼(`authenticationRequired`)으로 추가 | 사용자 확정 |
| 실행 권한 | Apple 캘린더 추가·수정, 미리알림 추가·완료 | 사용자 확정 |
| 기억 | 채팅·Siri·빠른 기억에서 사용자가 한 모든 말을 저장·검색 | 사용자 확정 |
| 제외 | OTP·인증번호, 카드·계좌번호 마스킹, 프로모션, 카톡 개인 대화, 의료 결과지 본문 | 사용자 확정 + 제안 |
| 보관 | 원문 90일(사용자별 키 암호화), 이미지 30일, 추출 사실·벡터 무기한 | 사용자 확정(1년) → 개인정보 검토로 90일 단축 |
| 진입점 | 채팅, Share, 푸시, Siri 질문, 액션버튼/컨트롤센터 빠른 기억 | 사용자 확정 |
| 비용 | 월 1만원. 기기 Foundation Models → OpenAI `gpt-6-luna` 분류·추출 → `gpt-6-sol` 채팅 | 사용자 확정. 벤더는 2026-09-26 Anthropic+Voyage → OpenAI 단일로 교체(사용자 결정) |
| AI 벤더 | OpenAI 단일. 키 `OPENAI_API_KEY` 하나. Responses API(`/v1/responses`) + Structured Outputs(`text.format` json_schema, `strict: true`), 모든 호출 `store: false` | 키·약관·청구 한 곳. §3 검증 표 |
| 임베딩 | OpenAI `text-embedding-3-small`, `dimensions: 512` | Supabase 내장 gte-small은 영어 전용. `vector(512)` 스키마 유지, HNSW 2000차원 한도 안 |

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
| Supabase gte-small 임베딩 | 검증됨, 그러나 **영어 전용** | OpenAI `text-embedding-3-small`로 교체 |
| OpenAI 모델·가격 (2026-09-26, developers.openai.com/api/docs/pricing · /api/docs/models/gpt-6-luna · /api/docs/models/gpt-6-sol) | 검증됨. `gpt-6-luna` $0.10/$0.01(캐시)/$0.50, `gpt-6-sol` $2.00/$0.20/$10.00 (1M 토큰 입력/캐시 입력/출력). 둘 다 Responses·Chat Completions, Structured Outputs, 이미지 입력, reasoning effort `none`~`max`(기본 `medium`) 지원. 스냅샷은 별칭과 같은 ID 하나뿐 | 분류·추출 `gpt-6-luna`(effort `none`), 채팅 `gpt-6-sol`(effort `low`). `gpt-6-astra`는 `none` 미지원·$10/$50이라 제외 |
| Structured Outputs (2026-09-26, /api/docs/guides/structured-outputs) | 검증됨. Responses API 권장, `text: { format: { type: "json_schema", name, schema, strict: true } }`. strict는 모든 객체 `additionalProperties: false`, 모든 필드 `required`, nullable은 `["string","null"]`, `pattern`·`default` 미지원. 거절은 `refusal` 콘텐츠, 잘림은 `status = incomplete` | 스키마는 strict 규칙으로 작성. 거절·잘림은 파싱하지 않고 잡 실패 처리 |
| 이미지·PDF 입력 (2026-09-26, /api/docs/guides/images-vision · /api/docs/guides/pdf-files) | 검증됨. `input_image`(data URL, PNG·JPEG·WEBP·GIF), `input_file`(`file_data` data URL, 파일당 50MB). PDF는 텍스트+페이지 이미지로 처리 | PoC-8 vision을 같은 모델로. 스펙 PDF 상한(10MB·50페이지)이 더 좁아 그대로 둔다 |
| OpenAI 임베딩 (2026-09-26, /api/docs/guides/embeddings · /api/docs/models/text-embedding-3-small · /api/reference/resources/embeddings/methods/create) | 검증됨. 기본 1536차원, `dimensions`로 축소(3세대 모델만), 출력 길이 1 정규화, 입력당 8,192토큰·요청당 30만 토큰·배열 2,048개, $0.02/1M. **한국어·다국어 성능 수치는 공식 문서에 없음** | `dimensions: 512`로 기존 `vector(512)` 유지. 한국어 품질은 PoC-7에서 판정, 미달 시 `text-embedding-3-large`(`dimensions: 512`, $0.13/1M) |
| OpenAI API 데이터 정책 (2026-09-26, /api/docs/guides/your-data) | 검증됨. API 입력은 기본 학습 미사용(2023-03-01부터, 옵트인 시에만). 남용 모니터링 로그 최대 30일. Responses API는 `store` 기본값으로 애플리케이션 상태 30일 보관. ZDR·수정 남용 모니터링은 OpenAI 사전 승인 필요. `/v1/responses`·`/v1/embeddings` 모두 ZDR 대상. 이미지는 CSAM 분류기 탐지 시 ZDR이어도 보관 | §12 통제 3 갱신, 임베딩 약관 보류 해제(§16). 모든 Responses 호출에 `store: false` |
| Deno에서 OpenAI SDK (2026-09-26, github.com/openai/openai-node) | 검증됨. Deno 1.28+ 지원, `import OpenAI from "npm:openai"`. 기본 타임아웃 10분·재시도 2회(`timeout`·`maxRetries` 옵션). 현재 npm 최신 7.23.0 | `npm:openai@7`, Edge 벽시계 150초에 맞춰 `timeout: 60_000`, `maxRetries: 1` |
| Edge Function에서 APNs HTTP/2 | **미확인.** Deno h2 이슈 보고 있음 | PoC-4. 실패 시 Cloudflare Worker 릴레이 |
| Supabase Storage TTL | 없음 | pg_cron 삭제 잡 |
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
                                          Postgres: items, purchases, facts,
                                          proposals, memories, chunks(pgvector)
                                                        │
                                   Edge: process (gpt-6-luna 분류·추출, OpenAI 임베딩)
                                                        │
                                   Edge: notify (APNs) ──► 잠금화면 제안 알림
                                                        │
                                   Edge: chat (하이브리드 검색 + gpt-6-sol)
```

### 책임

- **기기**: 권한, 수집, 기기 필터, 오프라인 큐, EventKit 읽기·쓰기, 푸시 표시·액션, 설정 가이드.
- **서버**: Gmail 동기화, 재분류, 추출, 임베딩, 제안 생성, 푸시 발송, 채팅 검색·답변, 보관 정리.
- **공통**: 요청 ID 멱등, 출처·시각·상태 기록. 서버는 클라이언트가 보낸 user_id를 믿지 않고 JWT에서 결정.

## 5. 수집 경로

| 경로 | 트리거 | 자동화 수준 | 전달 데이터(가정) | 한계 |
|---|---|---|---|---|
| Gmail | Pub/Sub → history.list | 완전 자동, 폰 꺼져도 | 전체 메일 | 테스트 모드 7일 재인증 |
| SMS/iMessage | Message 트리거(발신자·포함 문구 조건) → CaptureIntent | 무확인 자동(문서 확인) | 발신자·본문 (PoC) | 조건 미충족·자동화 꺼짐 시 누락. 과거 이력 불가 |
| 카카오톡·Instagram·쇼핑/금융 | Notification 트리거(앱·제목·본문 조건) → CaptureIntent | **배너 탭 1회 예상** | 앱·제목·본문 (PoC) | 미리보기 꺼지면 본문 없음. 과거 대화 불가 |
| 공유 | Share Extension | 사용자 선택 | NSItemProvider 실제 타입 | 로그인 필요한 URL 본문은 못 받음 |
| 채팅·Siri·빠른 기억 | AskIntent / QuickMemoryIntent | 사용자 입력 | 텍스트 | — |
| Calendar/Reminders | EventKit 전체 접근 | 앱 실행·복귀 시 대조 | 기기 캘린더 | 서버 직접 접근 불가 |

### 알림 트리거 설정 가이드 (제품의 일부)

앱 안에 "자동화 설치" 화면을 둔다. 앱별로 권장 필터를 제시하고, 단축어 앱을 열어 자동화를 만드는 단계를 스크린샷으로 안내한다.

| 앱 | 권장 필터 | 목적 |
|---|---|---|
| 메시지 | 문구: 예약, 접수, 배송, 도착, 결제 | 병원·택배·결제 |
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
     불가·타임아웃·생성 에러 → 같은 폴백:
       카카오톡·Instagram 출처는 **폐기** (개인 대화 배제 원칙이 우선)
       그 외(메시지·쇼핑/금융 앱)는 kind = unknown, device_filter = "rules"로 통과 → 서버 LLM 분류(§7)에 맡긴다
  3. App Group SQLite 큐에 저장 (보호 등급 completeUntilFirstUserAuthentication, WAL + busy_timeout. 아래 "큐")
  4. background URLSession (sharedContainerIdentifier) → POST /ingest. 보낼 항목은 claim(lease)으로 가져온다 (아래 "업로더")
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
| OTP 숫자 | 4~8자리 또는 3-3 분리(`123-456`). 날짜·시각·금액 형태(`2026년`, `15:00`, `9/25`, `32,000원`)는 제외 | 연도 숫자로 예약 안내가 폐기됐다 |
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
- 불가(`availability()`≠available)·타임아웃·생성 에러(`rateLimited`, `guardrailViolation`, `assetsUnavailable`, `decodingFailure` 등)는 모두 같은 폴백(위 2단계)을 탄다. 에러가 인텐트 실패로 전파되지 않는다. 로그에는 에러 종류 코드만 남긴다.
- **`availability()`가 `available`이어도 `respond()`가 에셋 오류를 낼 수 있다**(시뮬레이터에서 실측, §16). 그래서 가용성 판정(벤치마크 실행 여부, 설정 화면의 FM 상태 표시)은 짧은 합성 문장 1건을 먼저 호출하는 사전 점검 결과로 한다. 인텐트 경로는 건별 에러를 폴백으로 흡수하므로 사전 점검 없이도 안전하다.
- `rateLimited`는 앱이 백그라운드에서 시스템 한도를 넘을 때만 난다. `.background` 인텐트가 바로 그 경로이므로 빈도를 PoC-3 실기기에서 잰다.
- 폴백 여부는 큐 항목의 `device_filter`("fm" 또는 "rules")로 서버에 전달된다.

**분류 라벨 정의** (기기 FM과 서버 LLM 분류(§7)가 같은 정의를 쓴다)

| 라벨 | 뜻 | 경계 사례 |
|---|---|---|
| `notice` | 기업·기관·봇의 정형 안내: 주문·배송·예약·결제·병원 예약 | 검진 **예약·준비물** 안내("내일 검진 8시간 금식")는 notice |
| `personal` | 사람이 쓴 대화. 키워드가 들어 있어도 personal | "예약했어?" |
| `otp` | 인증번호 | — |
| `promo` | 광고 | — |
| `medical_result` | 검사·검진 결과와 진단 내용 | 검사 **결과가 나왔다는** 안내("건강검진 결과가 준비되었습니다")도 medical_result로 폐기한다. 결과 안내만으로 검진 사실과 기관이 드러나 의료 결과지 제외 원칙(§2)에 가깝다 |

### 큐 (0단계 Task 3 실측 반영)

- 앱(인텐트·업로더 콜백)과 Share Extension이 같은 `queue.sqlite`를 서로 다른 프로세스·연결로 동시에 쓴다. 기본 롤백 저널에 busy handler가 없으면 겹치는 쓰기가 즉시 `SQLITE_BUSY`로 실패해 캡처가 유실된다. **실측: 두 연결에서 동시 enqueue 200건 중 162건 유실.**
- 해결: 연결을 열 때 `busy_timeout` 3초, `journal_mode=WAL`, `synchronous=NORMAL`. 수정 후 같은 테스트에서 200건 모두 남는다. WAL의 `-wal`·`-shm` 파일도 컨테이너 기본 보호 등급(completeUntilFirstUserAuthentication)을 따른다.
- 읽기 중 step 오류는 빈 큐로 삼키지 않고 오류로 올린다. 디코딩할 수 없는 행(poison row)은 건너뛰어 큐 전체를 막지 않는다. 순서는 `created_at, rowid`.

### 업로더 (0단계 Task 7 실측 반영)

- 중복 업로드 방지: 보낼 항목은 `claim(limit:)`으로 가져온다. 단일 `UPDATE … RETURNING`이 `next_attempt_at = now + 600초`(lease)를 걸면서 행을 반환하므로 연결·프로세스 사이에서도 원자적이다. 앱 시작과 `scenePhase == .active`가 연달아 flush해도 같은 항목을 두 번 올리지 않는다.
- 완료 콜백은 `markSent`(삭제), 실패 콜백은 `markFailed`(attempts+1, lease를 백오프 시각으로 덮어씀)로 lease를 끝낸다. 콜백 없이 lease가 만료된 항목(앱 강제 종료로 전송 취소)은 다음 flush가 다시 가져간다.
- 그래서 "보냈는데 콜백을 못 받은" 항목은 두 번 갈 수 있다. 서버 `/ingest`는 기기 항목의 `external_id`로 큐 항목 `id`(UUID)를 받아 멱등 키(§7)로 중복을 막는다.
- 업로드 서버 주소는 App Group `UserDefaults`(`group.com.picpal.assistant`) 키 `ingestURL`에 저장하고 앱 화면에서 바꾼다. PoC 앱은 저장값이 없을 때만 스킴 환경변수 `INGEST_URL`을 초기값으로 쓰고, 둘 다 없으면 `http://localhost:8787`이다. 홈 화면에서 다시 열어도 저장값이 유지된다.

Share Extension은 1단계(규칙 필터)만 적용하고 큐에 넣는다(텍스트·URL 문자열과 이미지 OCR 텍스트 모두). OTP로 폐기되면 큐에 넣지 않고 **파일도 App Group에 저장하지 않는다**. 그래서 이미지는 확장의 임시 복사본에서 OCR을 먼저 돌리고, 규칙을 통과한 경우에만 App Group `inbox/`로 영속화한다(임시 복사 → OCR → 규칙 → 영속화 → 큐). PDF는 OCR이 없어 규칙 대상 텍스트가 없으므로 그대로 영속화한다. 로그는 본문 없이 종류·결과만 남긴다: `ShareExtension file queued id=<uuid> type=image ocrLen=<n>`, 폐기면 `ShareExtension file discarded:otp id=- type=image ocrLen=<n>`, 텍스트·URL은 `ShareExtension text|url queued` 또는 `discarded:<reason>`. 이미지·PDF는 App Group 컨테이너에 파일로 영속화한 뒤 큐에 로컬 경로를 기록하고, 업로드는 앱이 background URLSession 파일 업로드로 수행한다. 업로드 성공 후에만 로컬 파일을 지운다. 이미지에는 정규식 마스킹이 적용되지 않으므로 사용자에게 "이미지는 서버로 그대로 전송됨"을 공유 화면에 표시한다.

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
  → 202 반환

jobs 워커  (pg_cron 매분 → Edge: worker. 임대(lease) 180초, 최대 5회 재시도, 실패 시 dead 상태)
  → 임대 180초는 Edge 무료 wall-clock 150초보다 길다: 살아 있는 워커의 잡은 만료되지 않아 다른 호출이 재클레임하지 않는다.
    잡 하나를 30초 넘게 붙들면 30초마다 heartbeat_job(id)으로 leased_until을 연장한다
    (0단계 실측: 임대 60초에서 90초 잡이 65초에 재클레임돼 중복 실행 → 180초+하트비트에서 재클레임 0건)
  → cron 호출은 vault(worker_url, service_role_key)가 있을 때만 보낸다. worker는 secret 키 호출만 처리한다(§12 통제 4)
  → 단계별 체크포인트: classified → extracted → embedded → proposed. 재시도는 마지막 체크포인트부터
  → 재분류 (gpt-6-luna, effort none, ≤200 토큰 Structured Outputs JSON): event|task|purchase|subscription|reference|discard|medical_result
      medical_result·personal 경계는 §6 분류 라벨 정의와 같다. device_filter = "rules" 항목은 기기 FM 판정이 없으므로 여기서 처음 분류된다
      discard·medical_result → items DELETE, 감사 로그에 사유 코드만. 이 단계 전에는 다른 외부 전송 없음
  → 추출 (gpt-6-luna, Responses API `text.format` json_schema strict. `store: false`)
      event: title, start, end, allDay, location, tz, evidence, uncertain[]  (예: year, ampm, end, tz)
      task: title, due, evidence, uncertain[]
      purchase: merchant, product[], ordered_at, amount, currency, order_no, status, recurrence?, evidence
  → 이미지/PDF: gpt-6-luna vision(`input_image`·`input_file`). 월 상한 100건(usage_counters). 초과 시 기기에서 같이 올라온 OCR 텍스트 사용
      PDF: 10MB·50페이지 초과, 암호화, 파싱 실패 → "앱에서 확인" 상태로 두고 푸시
  → URL: 허용 스킴 http(s)만, 사설·루프백 IP 차단, 리디렉션 3회, 응답 2MB·10초 제한, 텍스트 MIME만
      본문 추출 실패(HTML 파싱 오류·JS 전용) → "스크린샷 공유 요청" 푸시. 짧은 정상 문서는 그대로 저장
  → 연결: purchases는 (merchant, order_no) 복합 키. 없으면 (merchant, amount, ordered_at ±1일)로 후보 제시
      취소·변경 문구 → 기존 fact status = cancelled/superseded, 새 fact에 supersedes_id
  → 청크(512자) → item_chunks. 임베딩(`text-embedding-3-small`, 512차원)은 PoC-7 통과 전까지 생성하지 않고 embedding = null로 둔다(§16)
  → proposals INSERT (event/task). uncertain 비어 있을 때만 잠금화면 "추가" 버튼 노출,
      아니면 REVIEW 카테고리로 앱에서 확인 유도
  → 백필(occurred_at이 수집 시각보다 3일 이상 과거)에서 나온 제안은 푸시하지 않고 보관함에만 표시
  → jobs INSERT (kind = notify) → APNs 발송, 실패 시 재시도
```

`jobs`는 items 외에 gmail-sync·notify·cleanup도 같은 테이블로 처리한다. 사용자·연결별로 동시에 하나만 실행하도록 `lease_key`를 둔다.

### Gmail 동기화

- 연결: iOS Google Sign-In → `serverAuthCode` → Edge가 웹 클라이언트 ID·시크릿으로 교환. refresh token은 `vault` 스키마에 암호화 저장.
- 초기: `messages.list q="newer_than:90d -category:promotions"` → 분당 250건 이하로 `messages.get(format=metadata)` 후 필요 시 full.
- 증분: `users.watch` → Pub/Sub push → jobs INSERT(kind = gmail-sync) → `history.list(startHistoryId)` 페이지 전부 처리 후 커서 갱신. 404 시 `sync_states.last_success_at - 1일`부터 `messages.list(after:)`로 재동기화.
- 푸시 유실 대비: pg_cron 6시간마다 연결별 gmail-sync 잡을 무조건 넣는다 (커서 기반이라 중복 비용 없음).
- 웹훅 인증: Pub/Sub push 구독에 OIDC 토큰을 붙이고 Edge에서 Google 발급 JWT의 `aud`·`email`(서비스 계정)을 검증한다. 본문의 `emailAddress`를 `connections.account_ref`로 조회해 user_id를 결정한다. 검증 실패는 저장 없이 401. 이 함수는 `verify_jwt = false`이며 service role로 동작하므로 **모든 쿼리에 user_id를 명시**한다.
- Gmail 수집 본문도 `/ingest`와 같은 서버 규칙 필터를 거친 뒤 암호화해 저장한다(프로모션 라벨 메일은 폐기).
- 만료 두 가지를 분리한다.
  - **Gmail watch 만료** `sync_states.watch_expires_at`: `users.watch` 응답의 expiration(7일). pg_cron이 매일 watch를 갱신해 이 값을 밀어낸다.
  - **OAuth refresh token 만료** `connections.expires_at`: 테스트 모드에서 발급 후 7일. 앱 게시(Production) 후에는 null.
- 재인증 푸시: `connections.expires_at` 24시간 전, 또는 토큰 갱신에서 `invalid_grant`가 발생했을 때 보낸다. refresh 실패 시 `connections.status = reauth_required`로 두고 해당 연결의 잡을 중단한다.

## 8. 데이터 모델

모든 테이블에 `user_id uuid references auth.users` + RLS `(select auth.uid()) = user_id`.

| 테이블 | 핵심 컬럼 | 비고 |
|---|---|---|
| `connections` | provider, account_ref, status(active/reauth_required/disconnected), expires_at | 토큰은 `vault`. `expires_at` = OAuth refresh token 만료(테스트 모드 7일, 게시 후 null) |
| `sync_states` | connection_id, cursor(historyId), last_success_at, watch_expires_at | `watch_expires_at` = Gmail watch 만료(7일, 매일 갱신) |
| `items` | source(GMAIL/MESSAGES/NOTIFICATION/SHARE/CHAT), app_name, sender, title, content_enc bytea, ocr_text_enc bytea, occurred_at, captured_at, device_filter, idempotency_key, status, storage_key, expires_at | 원문. `content_enc`·`ocr_text_enc`는 Edge Function이 사용자 데이터 키로 AES-256-GCM 암호화해 저장(§12). 90일 후 삭제, 행은 유지 |
| `user_keys` | user_id, wrapped_key bytea, created_at | 사용자별 데이터 키를 마스터 키로 감싼 값(봉투 암호화). 마스터 키는 Edge Function 시크릿에만 있고 DB에 없다 |
| `utterances` / `memories` | (아래) | 평문. 사용자 삭제 시 연쇄 |
| `item_chunks` | item_id, chunk_index, text, embedding vector(512), tsv tsvector | HNSW + GIN. 원문 만료 시 삭제 |
| `facts` | item_id, kind, payload jsonb, evidence(원문 인용 ≤300자), status(active/cancelled/superseded), supersedes_id | 추출 결과, 무기한. evidence가 만료 후 출처 역할 |
| `purchases` | fact_id, merchant, product[], ordered_at, amount, currency, order_no, status, delivery_status, recurrence | 구매·구독. `purchase_evidence(purchase_id, item_id)`로 다대다 |
| `proposals` | fact_id, action(create_event/update_event/create_reminder/complete_reminder), payload, version, status(proposed/confirmed/succeeded/failed/stale), eventkit_id, idempotency_key | fact 변경 시 version 증가, 이전 제안은 stale |
| `executions` | proposal_id, device_id, eventkit_id, executed_at | 기기가 쓰기 성공 직후 기록. 보고 실패 복구용 |
| `jobs` | kind, payload, lease_key, leased_until, attempts, status(queued/running/done/dead), checkpoint | 영속 작업 큐 |
| `utterances` | text, embedding, said_at, source(chat/siri/quick), kind(statement/question/correction) | 사용자 발화 전체 기록 |
| `memories` | text, embedding, utterance_id, status(active/retracted), supersedes_id | "기억해줘" 또는 gpt-6-luna가 statement로 판정한 것만. 정정 발화는 이전 memory를 retracted 처리 |
| `devices` | apns_token, environment, last_seen_at | |
| `usage_counters` | month, vision_calls, extract_tokens, chat_tokens, reserved_krw | 비용 상한. 호출 전 예약, 후 정산 |

### 삭제·만료 정책 (두 가지를 분리)

| 구분 | 트리거 | 지우는 것 | 남기는 것 |
|---|---|---|---|
| 원문 만료 | pg_cron, `expires_at` 경과 (원문 90일, 이미지 30일) | items.content_enc/ocr_text_enc, item_chunks **행 전체**(text·tsv·embedding), Storage 객체 | items 행(메타), facts(payload·evidence ≤300자), purchases, proposals, memories |
| 항목·출처 삭제 | 사용자가 항목 또는 출처(예: Gmail 연결) 삭제 | 해당 items·chunks·facts·purchases·purchase_evidence·proposals·executions·jobs(payload 포함)·Storage 객체 | 다른 출처 데이터, memories |
| 전체 삭제 | 사용자가 계정 삭제 | 위 전부 + utterances·memories·connections(Gmail 토큰 revoke 호출 포함)·devices·audit_log 본문 없는 행만 유지 + `user_keys` 행 삭제(crypto-shredding) + 기기에 삭제 푸시(로컬 큐·executions 정리) | 감사 로그의 사유 코드 |

만료 후 검색은 facts·purchases·memories만 대상이며 출처는 facts.evidence 인용문과 "원문 만료됨" 표시로 대체한다. 만료된 항목의 의미 검색은 되지 않는다(벡터 삭제). 백업은 Supabase 일일 백업 보관 기간(무료 7일) 동안 삭제 전 상태를 담고 있으며, `user_keys`가 지워진 뒤에는 백업의 `content_enc`를 복호화할 수 없다. 평문 파생물(청크·facts)은 백업 보관 기간 후에 완전히 사라진다. 이 사실을 §12 통제 5의 화면에 그대로 적는다.

용량 추정(1인 1년): 메일 일 20건 × 4KB 원문 + 청크 복제 + 512차원 벡터(2KB)×청크 3개 ≈ 연 90MB. 500MB 안이지만 `pg_database_size`를 주간 잡으로 기록해 400MB에서 경고한다.

## 9. 채팅·검색

```text
질문 → gpt-6-luna가 필터 추출 {date_range, sources, kinds, merchant?}
     → purchases/facts SQL 우선 (구조화 질문)
     → 하이브리드: tsvector(simple + pg_trgm) ∪ pgvector cosine, RRF 융합, 상위 12개
     → memories(active만) 상위 5개 포함. utterances의 question/correction은 검색 풀에서 제외
     → gpt-6-sol 답변(effort low). Responses API `text.format` json_schema strict로
        {sentences:[{text, source_item_ids[]}]} 출력. 검색 결과는 <document id="item_id"> 블록으로 넣는다
        (OpenAI에는 Anthropic식 citations 기능이 없으므로 인용은 모델이 JSON에 적은 item_id뿐이다)
     → 서버 검증: 각 문장의 source_item_ids가 이번 검색 결과 집합에 있는지 대조. 없는 id는 제거하고
        id가 하나도 남지 않은 문장은 "근거 미확인"으로 표시. 전체 유효 인용 0개면 "저장된 정보에서 확인되지 않음"으로 대체.
        인용 id는 존재만 검증되고 문장이 그 문서에 실제로 근거하는지는 보장하지 않는다 → 인용 정확도(§9 지표)로 측정
     → 실행 가능 항목은 proposal 카드로 반환. 검색 문서 내용은 절대 proposal payload를 직접 만들지 못하고
        추출 파이프라인(§7)을 다시 거친다
```

- 한국어 키워드는 PostgreSQL `simple` 설정으로는 형태소가 안 잘리므로 pg_trgm 유사도를 함께 쓴다.
- 검색 품질 평가는 **1단계 완료 기준**에 포함한다(§15). 지표: 정답 포함(Top-5 ≥ 90%, 질문 50개), 무근거 질문 거절률, 취소·정정 반영, 인용 정확도, 날짜 필터 오판.
- 수집된 메일·웹·알림 안의 지시문은 데이터로만 취급한다. 검색 결과는 `<document>` 블록으로 감싸 user 턴에 넣고 시스템 프롬프트는 고정해 앞에 두어 OpenAI 자동 프롬프트 캐시(캐시 입력 단가 1/10)에 걸리게 한다. 도구 호출 권한은 chat 함수에 없다(읽기 전용).
- 모든 발화는 `utterances`에 기록하되, 사실로 검색되는 것은 `memories`(statement 판정 또는 "기억해줘")뿐이다. "아니 그거 안 샀어" 같은 정정은 이전 memory를 retracted로 바꾼다.

## 10. 실행

- 푸시 카테고리 `ADD_EVENT`, `ADD_REMINDER`, `REVIEW`. 액션 "추가"는 `authenticationRequired`, "무시", "앱에서 수정"은 `foreground`. `uncertain`이 있는 제안은 REVIEW로만 보낸다.
- 액션 핸들러 순서 (멱등):
  1. 서버에서 proposal 최신 버전 조회. `stale`·`succeeded`면 중단하고 안내.
  2. 로컬 `executions` 테이블(App Group SQLite)에 proposal_id가 있으면 재쓰기 없이 보고만 재시도.
  3. EventKit 쓰기 → 성공 즉시 로컬 executions에 (proposal_id, eventkit_id) 기록.
     **2~3단계는 한 직렬 구간에서 원자적으로 수행한다.** 확인 → 저장 → 기록을 하나의 actor 메서드 안에서 `await` 없이 처리한다(PoC `AddEventGate`). 액션 핸들러는 동시에 여러 번 불릴 수 있어(같은 proposal_id의 알림 두 개를 연달아 탭) 둘 다 "기록 없음"을 보고 저장하면 `INSERT OR IGNORE`로 기록은 1건이어도 이벤트는 2건이 된다. 시뮬레이터 실측: 동시 두 번 탭에서 이벤트 +1만 생성(PoC-5).
     **저장 후 기록 전에 프로세스가 죽으면** 재탭 시 중복이 생길 수 있다. 대응: 저장하는 이벤트의 `url`에 `assistant://proposal/<proposal_id>` 표식을 넣고, 로컬 기록이 없을 때는 쓰기 전에 제안 시각 ±1일의 이벤트를 조회해 같은 표식이 있으면 새로 만들지 않고 그 `eventIdentifier`로 기록만 복구한다.
  4. 서버 `executions` 보고. 실패하면 다음 앱 실행 시 로컬 미보고 항목을 재전송.
  5. 오프라인이면 1단계의 서버 조회를 건너뛰고 마지막으로 받은 버전으로 실행하되, 보고 시 서버가 version 불일치를 감지하면 사용자에게 "변경된 제안" 알림.
- `update_event`는 `eventkit_id`로 원본을 찾고, 사용자가 캘린더에서 직접 수정한 흔적(lastModifiedDate > 제안 시각)이 있으면 자동 갱신하지 않고 REVIEW로 보낸다. 원본이 삭제됐으면 제안을 stale 처리.
- `complete_reminder`는 미리알림 `isCompleted`만 바꾼다.
- 읽기 전용 캘린더는 대상 목록에서 제외. 권한 철회 시 모든 proposal을 보관함에만 표시하고 푸시 액션을 숨긴다.
- 반복 일정은 1단계 범위 밖. 추출 결과에 반복 표현이 있으면 단일 일정 + uncertain=["recurrence"].
- 채팅에서 "기억해줘"와 "캘린더에 추가"는 별개 동작이다.

## 11. 앱 구조

| 타깃 | 역할 |
|---|---|
| `Assistant` (앱) | 채팅, 보관함, 제안 리뷰, 연결·권한, 자동화 설치 가이드, EventKit, 알림 액션, CaptureIntent/AskIntent/QuickMemoryIntent |
| `ShareExtension` | 입력 수신 → 큐 |
| `ControlExtension` (WidgetKit) | 컨트롤센터/액션버튼 "빠른 기억" 버튼(OpenIntent) |
| `AssistantCore` (Swift Package) | 큐, 규칙 필터, FM 분류, API 클라이언트, 모델. 단위 테스트 대상 |
| `supabase/` | 마이그레이션, Edge Functions(Deno/TS), 테스트 |

## 12. 개인정보

이 앱은 Superhuman·Spark 같은 서버 동기화형 메일 비서와 같은 구조다. 서버에 본문이 있으며, 그 사실을 숨기지 않고 아래 다섯 통제로 보호한다. 온디바이스 저장 구조는 실시간성·백그라운드 처리를 잃어 채택하지 않았다(§16 플랜 B).

### 통제 1. 저장 암호화와 키 분리 (보호 범위를 정직하게)

- 방식: **봉투 암호화를 Edge Function에서 수행**한다. 사용자별 데이터 키(32바이트)는 마스터 키(Edge 시크릿 `MASTER_KEY`, DB에 없음)로 감싸 `user_keys.wrapped_key`에 둔다. 본문은 WebCrypto AES-256-GCM으로 `ingest`·`gmail-fetch`가 INSERT 전에 암호화한다. pgsodium은 Supabase가 폐기 예정으로 안내하므로 쓰지 않는다.
- 복호화는 `worker`(추출·청크 생성)와 `chat`(출처 원문 표시) 두 함수만 메모리에서 수행하고, 복호화된 평문을 응답 로그·오류 로그에 남기지 않는다. DB 함수·대시보드에서는 복호화가 불가능하다(마스터 키가 DB에 없음).
- **보호 범위**: 이 암호화가 지키는 것은 **메일 원문 전체와 이미지·OCR 원문**이다. `item_chunks.text`(90일), `facts.payload`·`evidence`, `purchases`, `memories`는 검색·답변에 필요해 평문이며, 청크를 이어 붙이면 원문 상당 부분이 복원된다. 따라서 "DB 덤프가 유출돼도 안전"하다고 말하지 않는다. 덤프 유출 시 노출되는 것은 최근 90일 청크와 추출 사실이고, 90일 이전 원문·첨부는 노출되지 않는다. 실제 1차 방어는 통제 4(접근 통제)와 통제 2(짧은 보관)다.
- Storage 객체(이미지·PDF)는 업로드 전 기기에서 같은 사용자 키로 암호화할 수 없으므로(키가 서버에만 있음) Supabase 서버 측 암호화 + 비공개 버킷 + 서명 URL(60초)로 보호하고 30일 뒤 삭제한다.
- crypto-shredding은 **계정 전체 삭제에만** 적용한다(사용자당 키 하나). 부분 삭제는 행 삭제로 처리하며 백업 보관 기간(7일) 동안 평문 파생물이 백업에 남는다는 점을 통제 5에 명시한다.

### 통제 2. 최소화와 짧은 보관

- 수집 제외: 프로모션 라벨, 첨부파일(이미지·PDF는 사용자가 공유한 것만), OTP, 카드·계좌번호(마스킹), 카톡 개인 대화, 의료 결과지.
- 원문 90일, 이미지 30일 뒤 삭제. 추출 사실·구매 이력·벡터·`evidence` 인용(≤300자)만 남아 검색은 계속된다.
- 기기 입력은 기기에서 먼저 필터·마스킹 후 전송한다. Gmail은 서버가 직접 받으므로 "기기에서 먼저 마스킹"이라고 설명하지 않는다.
- 처리 순서(§7과 동일): 규칙 필터(기기·서버) → 암호화 저장 → 워커가 복호화 → gpt-6-luna 분류 → discard 판정 시 즉시 삭제 → 통과분만 추출·청크·임베딩 → 감사 기록. **예외를 명시한다**: 규칙 필터를 통과한 항목은 LLM 분류 전에 암호화된 채 저장되고 분류를 위해 OpenAI로 1회 전송된다. 즉 "의료 결과지·개인 대화는 저장·전송되지 않는다"가 아니라 "암호화 저장 후 분류 1회 전송 뒤 삭제된다"이다. 예산 소진 시에는 분류되지 못한 항목이 암호화 상태로 `queued`에 남으며 90일 만료 규칙이 그대로 적용된다.
- URL 본문·이미지 OCR·채팅 발화도 서버 규칙 필터(OTP·카드·계좌)를 같은 함수로 통과시킨 뒤 저장한다. URL 본문은 fetch 직후, OCR은 기기에서 이미 적용된 것을 서버에서 재적용한다.
- 폐기 판정된 항목은 행을 삭제하고 로그에는 사유 코드만 남긴다. Foundation Models 분류 결과는 저장하지 않는다.

### 통제 3. LLM·임베딩 공급자 조건

- 공급자는 OpenAI 하나(LLM·임베딩). 근거: 공식 문서 "Data controls in the OpenAI platform"(2026-09-26 확인, §3).
  - API 입력·출력은 기본 학습 미사용(옵트인하지 않는다).
  - 남용 모니터링 로그 최대 30일 보관(법적 요구 시 연장 가능). 이 30일은 끌 수 없으며 ZDR·수정 남용 모니터링은 OpenAI 사전 승인이 필요하다.
  - Responses API는 `store` 기본값이면 응답을 30일 보관하므로 **모든 호출에 `store: false`**를 넣는다. `previous_response_id` 대화 이어가기는 쓰지 않는다(대화 문맥은 서버가 직접 구성).
  - 이미지 입력은 CSAM 분류기에 걸리면 ZDR이어도 수동 검토용으로 보관된다. 사용자가 공유한 이미지만 보내는 현재 범위에서 수용한다.
- 임베딩(`/v1/embeddings`)은 분류·추출과 **같은 공급자·같은 약관**이다. 분류 단계에서 이미 같은 텍스트가 OpenAI로 가므로 임베딩이 새 수신자를 만들지 않는다. 따라서 약관 사유의 임베딩 보류는 해제한다(§16). 마스킹은 개인정보 전송 제한이 아니므로 근거로 삼지 않는다.
- 프롬프트·요청 본문을 Supabase 로그에 남기지 않는다(`console.log`에 본문 금지, 요청 ID만).
- 지인 확대 시 OpenAI ZDR(`/v1/responses`·`/v1/embeddings` 모두 대상) 신청을 검토한다. 승인되지 않으면 30일 남용 모니터링 보관을 처리방침에 적는다.

### 통제 4. 접근 통제와 감사

- 모든 테이블 RLS(`(select auth.uid()) = user_id`)는 **앱 클라이언트 경로**를 격리한다. `service_role`은 RLS를 우회하므로 워커·웹훅은 별도 규칙을 따른다: (a) 모든 쿼리에 `user_id`를 명시하는 저장 프로시저(`worker_claim_item(p_user, p_item)` 등)만 호출하고 테이블 직접 접근 금지, (b) 복호화는 `user_keys`의 소유자와 `items.user_id`가 일치할 때만 수행(함수 내부 검사), (c) `service_role` 키는 Edge Function 시크릿에만 존재하고 개발 기기·CI에 두지 않는다.
- **워커 호출 인증**: Edge 게이트웨이의 JWT 검증은 publishable(anon) 키로도 통과한다(0단계 실측). `worker`처럼 service role로 도는 함수는 게이트웨이 검증에 기대지 않고, 함수 안에서 `Authorization: Bearer`가 런타임이 주입한 secret 키(`SUPABASE_SERVICE_ROLE_KEY`·`SUPABASE_SECRET_KEYS`)와 같을 때만 처리하고 아니면 403을 돌려준다. cron은 vault의 secret 키로 호출한다.
- 평문 파생물 읽기도 감사한다: `chat`·`worker`가 `item_chunks`·`facts`를 읽을 때 `audit_log(action='read', target=item_id 목록 해시)`를 남긴다. 복호화 호출은 `action='decrypt'`로 별도 기록한다.
- 운영자(본인 포함)가 대시보드 SQL 편집기로 본문을 조회하지 않는다. 디버깅은 `item_id`·상태·오류 코드로만 한다. 이 규칙을 `CLAUDE.md`에 적어 에이전트에도 적용한다.
- `audit_log(user_id, actor, action, target, at)`에 삭제·연결 해제·내보내기·복호화 호출을 기록한다. 본문은 기록하지 않는다.
- 로그 보관 30일. 오류 로그에 본문·토큰이 섞이지 않도록 Edge Function 공통 오류 핸들러가 메시지를 정형화한다.

### 통제 5. 투명성과 사용자 통제

- 설정 화면 "내 데이터": 출처별로 **서버 보관 기간·LLM 전송 여부·마지막 동기화 시각·항목 수**를 표로 보여준다.
- 연결 해제(수집 중지, 데이터 유지) / 수집 중지 / 출처별 삭제 / 전체 삭제 / 내보내기(JSON)를 분리 제공한다. 삭제는 §8 연쇄 규칙과 키 파기까지 포함한다.
- 잠금 화면 알림에 본문 대신 요약("일정 제안 1건")만 노출하는 옵션을 둔다.
- 지인 확대 시 개인정보 처리방침, Google API Services User Data Policy(Limited Use) 준수 문구, Gmail 앱 검증(CASA)을 선행한다.

## 13. 비용 (월, 1인 기준 추정)

| 항목 | 가정 | 비용 |
|---|---|---|
가격 근거: developers.openai.com/api/docs/pricing (2026-09-26, 1M 토큰당, Standard). `gpt-6-luna` 입력 $0.10·출력 $0.50, `gpt-6-sol` 입력 $2.00·캐시 입력 $0.20·출력 $10.00, `text-embedding-3-small` $0.02.

| 항목 | 가정 | 비용 |
|---|---|---|
| gpt-6-luna 분류·추출 | 일 60건 × 입력 1.5k + 출력 0.3k 토큰 → 월 입력 2.7M, 출력 0.54M | 약 $0.5 |
| gpt-6-sol 채팅 | 일 10회 × 입력 6k(시스템 1k 캐시)/출력 0.5k + reasoning low 0.5k → 월 입력 1.8M(캐시 0.3M), 출력 0.3M | 약 $6 |
| Vision (gpt-6-luna) | 월 30건 × 입력 약 3k(이미지·PDF 페이지) + 출력 0.3k | 약 $0.01 |
| 임베딩 `text-embedding-3-small` | 월 3M 토큰 | 약 $0.06 |
| Supabase | 무료 | $0 |
| 합계 | | 약 $6.6 ≈ 0.9만원 |

채팅이 비용의 90%다. 기존 Anthropic+Voyage 추정(약 $9)보다 싸지만 상한과 여유가 없으므로 다음 통제를 둔다. reasoning 토큰은 출력 단가로 청구되므로 채팅은 effort `low`, 분류·추출은 `none`으로 고정한다.

- 호출 전 `usage_counters.reserved_krw`에 예상 비용을 예약하고, 월 상한(기본 1만원) 초과 예약은 거부한다. 응답 후 실제 토큰으로 정산한다.
- 80% 도달: 채팅 gpt-6-sol → gpt-6-luna 강등, vision → OCR 텍스트. 100% 도달: 추출·채팅 중단, 수집만 계속(jobs는 queued 유지). 앱에 잔여 예산 표시.
- 초기 백필 3개월(약 1,800건 × 1.8k 토큰, gpt-6-luna ≈ $0.5)은 별도 1회 예산으로 잡는다.
- 동시 LLM 호출은 사용자당 2개로 제한한다.

## 14. 0단계: 기능별 사전 검증 (구현 전 필수)

각 항목은 독립 PoC로 판정한다. 통과 기준을 못 채우면 대안을 채택하고 이 스펙을 갱신한다. 기기 항목은 시뮬레이터로 코드 경로를 먼저 확인하되, 디버그 훅·시뮬레이터 대체는 **부분**이지 통과가 아니다. 실기기가 필요한 항목은 실기기 세션에서 통과시킨 뒤 다음 단계로 간다.

| # | 검증 대상 | 방법 | 통과 기준 | 실패 시 대안 |
|---|---|---|---|---|
| PoC-1 | Notification 트리거 → App Intent | 빈 앱 + CaptureIntent, 카카오톡·Instagram 알림 트리거 자동화. iOS 26 (iOS 27 기기가 있다면 27도) | 본문·앱명 전달 확인. 확인 배너 여부·잠금 상태·미리보기 꺼짐 상태·묶음 알림 동작 기록 | 본문 미전달 → 알림 경로 폐기, 공유만. 배너 필수 → 키워드 필터로 탭 최소화 |
| PoC-2 | Message 트리거 → App Intent | 문자 수신 시 발신자·본문 전달, 잠금 중 무확인 실행. 재부팅 후 첫 잠금 해제 전 수신 | 잠금 상태에서 큐에 저장됨. 첫 해제 전 수신분 처리 방식 기록 | 실패 시 문자도 공유 경로만 |
| PoC-3 | Foundation Models in-app 백그라운드 인텐트 | 한국어 알림 200건(개인 대화 100·알림톡 96·검진 결과 안내 `medical_result` 4) 분류, 지연·메모리 측정. 백그라운드 인텐트 10~20회 연속 호출로 `rateLimited` 빈도 측정 | p95 < 3초. **개인 대화 통과율 ≤ 2%**, 알림톡 폐기율 ≤ 15%(분모 notice 96, `medical_result` 4건은 따로 센다) | 규칙 필터만 + 카톡·인스타 경로 폐기 |
| PoC-4 | Edge Function → APNs HTTP/2 | 프로덕션 리전에서 100회 발송, 동시 10회 포함 | 성공률 ≥ 99%, h2 스트림 오류 0 | Cloudflare Worker 릴레이 |
| PoC-5 | 알림 액션 → 백그라운드 EventKit 쓰기 | `authenticationRequired` 액션에서 이벤트 생성. 같은 알림 두 번 탭, 동시 두 번 탭, 앱 종료 후 액션(콜드 스타트), 보고 실패 후 재탭. APNs 없이 로컬 알림으로 가능 | 앱 열지 않고 캘린더에 1건만 생성 | `foreground` 액션으로 앱 열어 실행 |
| PoC-6 | Gmail serverAuthCode 교환 + watch + history | 테스트 계정으로 3개월 백필, push 수신. 8일 재인증 만료 재현, 커서 404 재현 | 쿼터 초과 없이 완료, push 1분 내 수신, 만료·404 후 누락 0건 | 폴링(15분) |
| PoC-7 | 한국어 하이브리드 검색 | 샘플 500건(메일·알림톡·발화 혼합), 질문 50개(무근거 10개 포함) | Top-5 ≥ 90%, 무근거 거절 ≥ 90%, 인용 검증 통과 | 임베딩 모델 교체, 청크 크기 조정 |
| PoC-8 | Share Extension 이미지 → 로컬 영속화 → 업로드 → vision 추출 | 청첩장 이미지 5종, 업로드 중 오프라인 전환 | 날짜·장소·연도 추출 5/5, 오프라인 후 복구 시 유실 0 | OCR 텍스트만 전송 |
| PoC-9 | background URLSession from App Intent | 잠금·오프라인·앱 강제 종료 후 복구 시 전송 | 앱 재실행 포함 시 유실 0. 강제 종료 시 취소되는 것을 기록 | 앱 포그라운드 시 재시도만 |
| PoC-10 | jobs 워커 | pg_cron → Edge worker, 임대 만료·중복 실행·5회 실패 | 같은 잡이 동시에 두 번 돌지 않고 dead 전환됨 | 단일 워커 직렬 처리 |

기기 PoC는 앱 하나(`poc/ios`: 앱 + Share Extension + `AssistantCore` 패키지 + UI 테스트)에, 서버 PoC는 `poc/server`에 둔다. 결과는 `docs/superpowers/poc/`에 기록하고 판정의 원본은 `results.md`다. PoC 코드는 폐기 대상이며 제품 코드에 복사하지 않는다.

### 판정 현황 (2026-09-24, 원본 `docs/superpowers/poc/results.md`)

| # | 상태 | 시뮬레이터에서 확인한 것 (부분 검증) | 실기기·외부 자원이 필요한 남은 실측 |
|---|---|---|---|
| PoC-1 | 미검증 | CaptureIntent·App Shortcut 등록(`Metadata.appintents`), 단축어 앱에서 수동 실행 시 앱을 열지 않고 인텐트 실행(XCUITest). 알림 트리거가 아닌 호출 경로 확인일 뿐 | **실기기**: 알림 자동화 시나리오 1~7, `app=`·`textLen=` 로그로 본문·앱명 전달 판정. 연락처에 저장한 계정에서 보낸 카톡 → `discarded:contact` |
| PoC-2 | 미검증 | 인텐트 호출 경로(PoC-1과 같음) | **실기기**: 메시지 자동화, 잠금 15초 후 수신 `locked=true`, BFU 수신(`bfu.log`, 길이만), OTP 문자 `discarded:otp`, 연락처 번호 문자 `discarded:contact` |
| PoC-3 | 부분 | 폴백 경로(앱 프로세스에서 Coupang→`queued:rules`, KakaoTalk→`discarded:fm-error`), 새 세션·enum 스키마·타임아웃 단위 테스트. 호스트 Mac Apple Intelligence 꺼짐으로 `respond` 에셋 오류, 정확도·p95 수치 없음 | **실기기**(또는 사용자가 Mac Apple Intelligence 켠 뒤 시뮬레이터 참고치): 200건 정확도·p95·메모리, 백그라운드 `rateLimited` 빈도 |
| PoC-4 | 미검증 | — | Supabase 프로젝트·APNs `.p8` |
| PoC-5 | 부분 | 실제 배너·액션 탭(XCUITest, 로컬 알림): 백그라운드 쓰기 `bg=true`, 재탭 `dup skip`, 앱 종료 후 콜드 스타트, 동시 두 번 탭 이벤트 +1 | **실기기**: 잠금 화면에서 `.authenticationRequired`의 Face ID/암호 요구와 쓰기 성공. 보고 실패 후 재탭은 서버 연동 후 |
| PoC-6 | 미검증 | — | GCP OAuth·Pub/Sub |
| PoC-7 | 미검증 | — | Supabase·OpenAI 키(합성 코퍼스) |
| PoC-8 | 부분 | 기기 부분: 사진 앱 → 공유 시트 → 확장 실행, OCR 텍스트와 `SHARE` 큐 행(합성 이미지) | 서버 부분(Task 12): vision 추출 5/5, 오프라인 후 유실 0 |
| PoC-9 | **통과** | 앱 프로세스 완전 종료 확인 후 3.68초 뒤 목 서버에 정확한 바이트 수로 도착 | — (시뮬레이터 실측이 판정 기준을 그대로 재현) |
| PoC-10 | 미검증 | — | Supabase 프로젝트 |

실기기 세션 한 번에 PoC-1·2·3·5를 순서대로 진행한다: 설치 → 권한 → 단축어 자동화 3개(카톡 알림·인스타 알림·메시지) → FM 벤치마크(메모리 게이지 기록) → 단축어로 백그라운드 FM 10~20회 → 잠금 화면 로컬 알림 액션 → 재부팅 후 BFU 문자 수신.

## 15. 단계 계획

| 단계 | 범위 | 완료 기준 |
|---|---|---|
| 0 | PoC-1~10 | 판정표 작성, 스펙 갱신 |
| 1a | Supabase 스키마·RLS·Auth·jobs, Gmail 동기화(복구 포함), ingest/worker/chat Edge, 앱 채팅·보관함, Share(텍스트·URL), 보관·삭제 잡 | **검색 평가 통과**(§9 지표). 메일·공유 텍스트를 채팅으로 다시 찾고 출처가 검증됨 |
| 1b | 추출·proposals, notify Edge(APNs), EventKit + 알림 액션(멱등) | 메일에서 뽑은 일정을 잠금화면 버튼으로 캘린더에 1건만 넣음 |
| 2 | Message/Notification 트리거 + 기기 필터, 자동화 설치 가이드, 이미지·PDF vision + OCR, purchases 추출·질문 | 알림톡 주문이 구매 이력에 쌓이고 "어디서 샀지" 답변 |
| 3 | Siri·빠른 기억, 구독 추적, TestFlight | 지인이 가이드만으로 셋업 완료 |

Outlook 커넥터 인터페이스는 만들지 않는다. 필요해지면 그때 추가한다.

## 16. 리스크와 미결

### 외부 리뷰 반영 (Codex gpt-6-astra, 2026-09-23)

21개 지적 중 반영: 영속 작업 큐(2), 보관 정책 분리(3), 서버 필터 재적용·의료 결과지 분류(4), FM 실패 시 카톡 폐기(5), Gmail 복구·정기 대조(6), 웹훅 인증(7), EventKit 멱등(8), 수정·완료 액션(9), 불확실 필드 확인(10), 로컬 영속화·강제 종료(11), 발화/사실 분리(12), 인용 서버 검증(13), URL 제한(14), 구매 다대다(15), OCR 동시 생성(16), 백필 푸시 억제(17), 검색 평가 1단계 이동(18), 비용 예약(19), 용량 측정(20), Outlook 인터페이스 삭제(21).

미반영·사용자 판단: (1) Notification 트리거 판정은 "미확인"으로 완화하고 PoC-1에 위임. (21) MVP를 검색 전용으로 더 줄이는 제안은 1a/1b 분리로 절충했다.

### 2차 리뷰 반영 (Codex gpt-6-astra, 2026-09-23, 개인정보 설계)

10건 모두 반영: 암호화 보호 범위 정직화(1), 백업·키 파기 한계 명시(2), 삭제 범위 3단계로 통일(3), 저장→분류→삭제 순서와 예외 명시(4), service_role 격리·평문 읽기 감사(5), 만료 시 청크 행 전체 삭제(6), 임베딩 공급자 확인 전 보류(7, 2026-09-26 OpenAI 약관 확인으로 해제 — 아래 "임베딩 보류"), pgsodium → Edge 봉투 암호화(8), NSE 조건·상한 명시(9), BG 작업 비보장·`requiresExternalPower`·watch 갱신 주체(10).

### 플랜 B: 로컬 우선 구조 (미채택, 신뢰 문제 발생 시 전환)

서버 저장에 대한 신뢰 문제가 지인 확대 단계에서 커지면 다음 구조로 전환할 수 있다. 1인 데이터 규모(연 청크 2만 개)에서는 기기 SQLite(FTS5 trigram + 벡터 브루트포스)로 검색 효율이 충분하다는 것을 확인했다.

- 기기 SQLite가 단일 원본. 서버는 (a) Gmail Pub/Sub → APNs 가시 푸시 중계, (b) LLM 프록시·예산 카운터, (c) Gmail `watch` 7일 갱신(refresh token은 서버에 남음)만 담당한다. 프록시는 저장하지 않을 뿐 평문을 처리하므로 서버 신뢰가 완전히 사라지지는 않는다.
- 실시간 처리는 Notification Service Extension이 맡는다. 조건: 푸시에 `mutable-content: 1`과 alert 페이로드가 있어야 하고, 사용자가 이 앱 알림을 꺼 두면 NSE는 실행되지 않는다. 실행 시간은 **최대** 30초(보장 아님)이며 초과 시 시스템이 원래 알림을 그대로 표시한다. 따라서 NSE는 Gmail 페치 → 로컬 저장까지를 체크포인트로 두고, 추출까지 못 마치면 "새 메일 1건" 알림으로 끝내고 앱 실행 시 이어서 처리한다. 잠금 중 Gmail 토큰 접근을 위해 키체인 항목은 `kSecAttrAccessibleAfterFirstUnlock`.
- 따라잡기는 `BGAppRefreshTask`(시스템 재량, 보장 없음), 무거운 배치(임베딩·정리·백필)는 `BGProcessingTask`에 `requiresExternalPower = true`로 요청. 둘 다 앱 강제 종료 시 실행되지 않으므로 앱 실행 시 전체 flush가 최종 안전망이다.
- 서버를 완전히 없애는 변형: Gmail을 Apple Mail에 추가하고 Shortcuts **Email 트리거**(무확인 자동 실행 목록에 있음)로 수집. 지연 15분 이상, 트리거가 본문을 넘기는지 미확인.
- 잃는 것: 폰이 꺼진 동안의 처리, 기기 간 공유, 서버 측 검색 품질 튜닝. 전환 비용: §7 파이프라인 대부분을 Swift로 재작성.

- **알림 트리거 배너 탭**: 사용자가 알림마다 탭해야 하면 편의성이 크게 떨어진다. PoC-1 결과에 따라 2단계 범위를 재조정한다.
- **임베딩 보류 → 약관 사유 해제 (2026-09-26)**: 벤더를 OpenAI로 바꾸며 학습 미사용·보관 30일(남용 모니터링)을 공식 문서로 확인했고, 임베딩은 분류와 같은 공급자·약관이라 새 전송처가 아니다(§12 통제 3). 남은 활성화 조건은 **PoC-7 통과(합성 코퍼스, 하이브리드 경로)** 하나다. 그 전까지 실제 사용자 데이터의 `embedding`은 null, 검색은 키워드 경로. PoC-7 평가는 여전히 합성 코퍼스로만 한다.
- **OpenAI 30일 보관**: ZDR은 사전 승인제라 본인 사용 단계에서는 남용 모니터링 30일 보관을 수용한다. 지인 확대 시 ZDR 신청, 거절되면 처리방침에 명시.
- **인용 검증의 한계**: OpenAI에는 문서 인용 기능이 없어 인용은 모델이 JSON에 적은 `source_item_ids`다. 서버는 id가 검색 결과에 있는지만 확인하므로 "있는 문서를 잘못 인용"은 막지 못한다. PoC-7·1a 검색 평가의 인용 정확도 지표로 측정하고, 미달 시 문장-문서 대조(gpt-6-luna 재검증) 단계를 추가한다.
- **Edge 복호화 비용**: 워커가 건마다 AES-GCM 복호화하므로 CPU 2초 제한 안에서 배치 크기를 정해야 한다. PoC-10에 항목 추가.
- **Gmail 7일 재인증**: 테스트 모드 refresh token 만료(`connections.expires_at`) 24시간 전 푸시로 완화. 본인 사용 기간엔 감수. 지인 확대 시점에 앱 검증 비용을 결정한다.
- **APNs from Deno**: 미확인. PoC-4.
- **임베딩 한국어 품질**: `text-embedding-3-small` 가격($0.02/1M)은 확인, 한국어·다국어 성능 수치는 공식 문서에 없다. PoC-7(합성 코퍼스)에서 판정하고 미달 시 `text-embedding-3-large`(`dimensions: 512`)로 재평가.
- **모델 ID 수명**: `gpt-6-luna`·`gpt-6-sol`은 별칭과 스냅샷이 같은 ID 하나뿐이다. 날짜 고정 스냅샷이 나오면 제품 코드에서는 스냅샷으로 고정한다.
- **Supabase 무료 티어 500MB**: 1인 1년 원문이면 충분하나 이미지 포함 시 Storage 1GB 상한 감시.
- **Foundation Models 가용성**: Apple Intelligence 꺼진 기기는 규칙 필터만(카톡·인스타 폐기, 그 외 서버 분류). 지인 확대 시 안내 필요.
- **시뮬레이터 FM 가용성이 호스트 Mac 설정에 종속**: 시뮬레이터는 호스트 Mac의 모델을 쓴다. 호스트가 Apple Intelligence 꺼짐(`appleIntelligenceNotEnabled`, macOS 26.5에서 직접 호출로 확인)이면 시뮬레이터 `respond`는 에셋 오류를 낸다. 그런데 시뮬레이터 `availability()`는 **`available`로 오표시**한다. 따라서 시뮬레이터 FM 결과는 판정 근거가 아니고, 가용성은 1건 사전 점검(§6)으로 판단하며, PoC-3 수치는 실기기에서 잰다. 시뮬레이터로 참고치를 보려면 사용자가 Mac의 Apple Intelligence를 켜고 모델 다운로드를 마쳐야 한다.
- **FM 백그라운드 `rateLimited`**: 백그라운드 인텐트에서만 나는 에러다. 폴백으로 흡수되지만 빈도가 높으면 카톡·인스타 항목이 대량 폐기된다. PoC-3 실기기에서 빈도를 재고, 높으면 카톡 경로의 폴백 정책을 다시 정한다.
- **예약 확인번호 오탐**: "예약 확인번호 58213"이 든 병원·식당 예약 안내는 OTP 규칙으로 폐기된다(§6 알려진 한계). 2단계에서 `otp` 사유 코드 비율을 보고 재검토한다.
- **연락처 규칙**: 앱이 연락처 이름을 App Group에 캐시하고 인텐트가 `sender`·`title`과 비교하도록 배선했다. 시뮬레이터 실측 완료(합성 연락처, 결과는 `results.md`). 실기기 카톡·문자에서의 확인은 PoC-1/2에서 한다.

### 0단계 Opus 재검증 반영 (2026-09-24, Task 1~7)

재검증 A(Task 1~3), B(Task 4~6) 지적을 `0d2a293`에서 반영했고 이 스펙에 결과를 옮겼다: 큐 WAL·busy_timeout(§6 큐), 카드·계좌·OTP 규칙 정밀화(§6 기기 규칙 필터), FM 새 세션·enum·에러 폴백·제시간 타임아웃(§6 FM 분류), 알림 액션 직렬 구간(§10), claim lease(§6 업로더), 검진 결과 안내 라벨 결정(§6 라벨 정의). 판단 근거는 각 절에 한 줄씩 적었다.

### 코드 수정 필요 (스펙 대비, 2026-09-24)

코드가 스펙을 어긴 곳이다. 스펙은 그대로 두고 코드를 고친다. 1~4는 코드 수정 완료, 5는 1b 제품 코드로 미룬다.

| # | 스펙 | 현재 코드 | 수정 |
|---|---|---|---|
| 1 | §6 1단계: 규칙 필터를 `text`와 `title`에 적용 | `CaptureIntent`·`CapturePipeline`이 `text`만 필터링. `title`은 원문 그대로 큐에 들어간다 | `title`에도 OTP 폐기·카드/계좌 마스킹 적용. **완료 (affe7e9)**: OTP는 제목+본문을 합쳐 판정, 마스킹은 각각, 마스킹된 `title`이 FM 입력과 큐로 |
| 2 | §6: Share Extension도 1단계 적용 | `ShareViewController`가 텍스트·URL·OCR 텍스트를 규칙 필터 없이 큐에 넣는다 | 텍스트·URL·OCR에 `RuleFilter` 적용. OTP 폐기면 큐에도 넣지 않고 파일도 영속화하지 않는다(임시 복사 → OCR → 규칙 → 영속화). **완료 (affe7e9)** |
| 3 | §6 연락처 규칙: 목록 캐시, `sender`+`title` 비교, 공백·호칭("님"/"씨") 정규화 | `RuleFilter()`를 연락처 없이 생성, `sender` 정확 일치만 비교 | 앱 실행 시 연락처 이름을 App Group에 캐시하고 인텐트가 읽는다(0단계 계획 Task 4 Step 6). **완료 (affe7e9)**: `ContactNames`, 공백 전부 제거·끝 "님"/"씨" 제거, `sender`·`title` 비교 |
| 4 | §6 라벨 정의: 검진 결과 준비 안내 = `medical_result` | FM 픽스처 4건("건강검진 결과가 준비되었습니다")이 `expected: notice`, `@Guide` 설명에 결과 안내 경계가 없다 | 4건을 `medical_result`로 바꾸고 벤치마크 집계(개인 대화 통과율·알림톡 폐기율)에서 따로 센다. `@Guide`에 경계 문구 추가. **완료 (affe7e9)**: 픽스처 personal 100·notice 96·medical_result 4, `medicalDrop=x/4` |
| 5 | §10: 기록 없을 때 EventKit 표식 조회로 복구 | 표식(`ev.url`)은 넣지만 저장 전 조회는 없다 | PoC에서는 허용. 1b 제품 코드에서 구현 |
