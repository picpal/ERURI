# iOS 개인 비서 앱 설계 스펙

작성일: 2026-09-22 · 상태: 초안(리뷰 대기) · 대상: iPhone 15 Pro 이상, iOS 26+, 한국

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

Outlook(인터페이스만 남김), Android, Mac 허브, 카카오톡 개인 대화 수집, App Store 공개 출시.

## 2. 확정 결정

| 항목 | 결정 | 근거 |
|---|---|---|
| 플랫폼 | iPhone 단독. iOS 26+, iPhone 15 Pro 이상 | 사용자 기기, Foundation Models 요건 |
| 사용자 | 본인 → TestFlight로 지인 확대. Sign in with Apple | Supabase Auth `signInWithIdToken(provider: .apple)` 검증됨 |
| 백엔드 | Supabase 무료 티어 (Postgres+pgvector, Auth, Edge Functions, Storage, pg_cron) | 서버리스 선호, RLS 기본 제공 |
| 지능 위치 | 서버 중심. 기기는 필터·수집·EventKit·푸시 수신 | 앱 재배포 없이 파이프라인 수정, API 키 서버 보관 |
| 메일 | Gmail만. 초기 백필 3개월. `-category:promotions` 제외 | 사용자 확정 |
| 문자 | Shortcuts **Message 트리거** → App Intent. 무확인 자동 실행 검증됨 | Apple 문서 "run automatically" 목록에 Message 포함 |
| 앱 알림 | Shortcuts **Notification 트리거** → App Intent. 카카오톡·Instagram·쇼핑/금융 앱 | **확인 배너 탭 필요 가능성 높음** (§3) |
| 공유 | Share Extension: 텍스트·URL·이미지·PDF | 사용자 확정 |
| 일정 등록 | 항상 확인 후. 알림 액션 버튼(`authenticationRequired`)으로 추가 | 사용자 확정 |
| 실행 권한 | Apple 캘린더 추가·수정, 미리알림 추가·완료 | 사용자 확정 |
| 기억 | 채팅·Siri·빠른 기억에서 사용자가 한 모든 말을 저장·검색 | 사용자 확정 |
| 제외 | OTP·인증번호, 카드·계좌번호 마스킹, 프로모션, 카톡 개인 대화, 의료 결과지 본문 | 사용자 확정 + 제안 |
| 보관 | 원문 1년, 이미지 30일, 추출 사실 무기한 | 사용자 확정 |
| 진입점 | 채팅, Share, 푸시, Siri 질문, 액션버튼/컨트롤센터 빠른 기억 | 사용자 확정 |
| 비용 | 월 1만원. 기기 Foundation Models → `claude-haiku-4-5` 추출 → `claude-sonnet-5` 채팅 | 사용자 확정 |
| 임베딩 | Voyage `voyage-4-lite`, 512차원 | Supabase 내장 gte-small은 영어 전용. 한국어 필요 |

## 3. 공식 문서 검증 결과 (2026-09-22)

설계의 전제를 Apple·Google·Supabase 공식 문서로 검증했다. 설계를 바꾼 항목만 적는다.

| 전제 | 판정 | 설계 반영 |
|---|---|---|
| Notification 트리거가 무확인 자동 실행된다 | **반박됨.** "자동 실행 가능" 트리거 목록(Time, Alarm, Message, Transaction, App 등)에 Notification 없음 | 알림 수집은 "배너 탭 1회" UX로 설계. 트리거 필터(제목·본문 키워드)로 탭 횟수 최소화. PoC-1에서 실기기 판정 |
| Notification/Message 트리거가 본문을 Shortcut Input으로 넘긴다 | **미확인.** 문서에 입력 데이터 명세 없음 | PoC-1·PoC-2 필수 |
| Foundation Models를 App Intents extension에서 쓸 수 있다 | **미확인.** 문서 없음. 확장 메모리 "현저히 낮음" | Capture 인텐트를 **메인 앱 타깃**에 두고 `supportedModes = .background`로 실행. 확장 사용 안 함 |
| Foundation Models 한국어 | 검증됨. 컨텍스트 4,096토큰, 한국어 1자=1토큰 | 알림 텍스트 분류에 충분 |
| App Intent 잠금 상태 실행 | 검증됨. `authenticationPolicy` 기본 `.alwaysAllowed` | 잠금 중 수집 가능. 단 로컬 DB는 `.completeUntilFirstUserAuthentication` 보호 등급 |
| 알림 액션 → 앱 백그라운드 실행 | 검증됨 | 액션에 `authenticationRequired` 지정 후 EventKit 쓰기. EventKit 백그라운드 쓰기 자체는 문서 없음 → PoC-3 |
| Gmail 테스트 모드 | 검증됨. 테스트 사용자 100명, **동의 7일 후 만료** | 본인 사용 중엔 7일마다 재연결. 지인 확대 전 앱 검증 + CASA(추정 $500~4,500, 2~6주) 결정 |
| Gmail 쿼터 | 검증됨. **분당** 사용자 6,000 유닛 (`messages.get` 20) | 백필 배치 분당 250건 이하 |
| Gmail watch | 검증됨. 7일 내 갱신, historyId 404 시 전체 재동기화 | pg_cron 일 1회 watch 갱신 |
| Supabase gte-small 임베딩 | 검증됨, 그러나 **영어 전용** | Voyage로 교체 |
| Edge Function에서 APNs HTTP/2 | **미확인.** Deno h2 이슈 보고 있음 | PoC-4. 실패 시 Cloudflare Worker 릴레이 |
| Supabase Storage TTL | 없음 | pg_cron 삭제 잡 |
| Edge Function 한계 | 검증됨. CPU 2초, 벽시계 150초(무료), 256MB | LLM 호출은 `EdgeRuntime.waitUntil` 배경 처리, 응답은 먼저 반환 |
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
                                   Edge: process (Haiku 분류·추출, Voyage 임베딩)
                                                        │
                                   Edge: notify (APNs) ──► 잠금화면 제안 알림
                                                        │
                                   Edge: chat (하이브리드 검색 + Sonnet)
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
CaptureIntent(text, appName?, title?, sender?)   supportedModes = .background, 메인 앱 타깃
  1. 규칙 필터 (동기, <10ms)
     - OTP 정규식 (인증번호|verification).{0,10}\d{4,8} → 폐기, 로그 없음
     - 카드번호 \d{4}-\*{4}-\*{4}-\d{4} / 계좌번호 → 마스킹
     - 발신자가 연락처에 있는 사람 이름 → 폐기 (카톡 개인 대화 배제)
  2. Foundation Models 분류 (가능 시, 타임아웃 3초)
     @Generable struct Verdict { kind: notice|personal|otp|promo; confidence: 0-1 }
     personal/otp/promo → 폐기. 불가·타임아웃 → device_filter = "rules"
  3. App Group SQLite 큐에 저장 (보호 등급 completeUntilFirstUserAuthentication)
  4. background URLSession (sharedContainerIdentifier) → POST /ingest
  5. 성공 시 큐 삭제, 실패 시 지수 재시도 (최대 24h)
```

Share Extension은 1단계만 적용하고 큐에 넣는다. 이미지·PDF는 Storage 서명 업로드 URL로 올리고 `storage_key`만 큐에 남긴다.

## 7. 서버 파이프라인

```text
/ingest  (JWT 필수)
  → idempotency_key(user_id + source + external_id|sha256(content)) 중복 검사
  → items INSERT (status = queued)
  → EdgeRuntime.waitUntil(process(item))
  → 202 반환

process(item)
  → 재분류 (Haiku, ≤200 토큰 JSON): event|task|purchase|subscription|reference|discard
      discard(개인 대화 판정) → items DELETE, 감사 로그에 사유 코드만
  → 추출 (Haiku, output_config.format JSON 스키마)
      event: title, start, end, allDay, location, tz, evidence
      task: title, due, evidence
      purchase: merchant, product, ordered_at, amount, currency, order_no, status, recurrence?
  → 이미지/PDF: Haiku vision. 월 상한 100건, 초과 시 iOS Vision OCR 텍스트만 전송
  → URL: fetch 후 본문 <200자면 "스크린샷 공유 요청" 푸시
  → 연결: 같은 order_no → purchases UPDATE. 취소·변경 문구 → 기존 fact 상태 변경
  → 청크(512자) + Voyage 임베딩 → item_chunks
  → proposals INSERT (event/task만) → APNs 발송
```

### Gmail 동기화

- 연결: iOS Google Sign-In → `serverAuthCode` → Edge가 웹 클라이언트 ID·시크릿으로 교환. refresh token은 `vault` 스키마에 암호화 저장.
- 초기: `messages.list q="newer_than:90d -category:promotions"` → 분당 250건 이하로 `messages.get(format=metadata)` 후 필요 시 full.
- 증분: `users.watch` → Pub/Sub push → `history.list(startHistoryId)`. 404 시 최근 7일 재동기화.
- pg_cron: 매일 watch 갱신, 만료 7일 전 재인증 푸시.

## 8. 데이터 모델

모든 테이블에 `user_id uuid references auth.users` + RLS `(select auth.uid()) = user_id`.

| 테이블 | 핵심 컬럼 | 비고 |
|---|---|---|
| `connections` | provider, account_ref, status, expires_at | 토큰은 `vault` |
| `sync_states` | connection_id, cursor(historyId), last_success_at | |
| `items` | source(GMAIL/MESSAGES/NOTIFICATION/SHARE/CHAT), app_name, sender, title, content, occurred_at, captured_at, device_filter, idempotency_key, status, storage_key, expires_at | 원문. 1년 후 삭제 |
| `item_chunks` | item_id, chunk_index, text, embedding vector(512), tsv tsvector | HNSW + GIN |
| `facts` | item_id, kind, payload jsonb, evidence, status(active/cancelled/superseded) | 추출 결과, 무기한 |
| `purchases` | item_id, merchant, product, ordered_at, amount, currency, order_no, status, delivery_status, recurrence | 구매·구독 |
| `proposals` | fact_id, action(create_event/create_reminder), payload, status(proposed/confirmed/succeeded/failed), eventkit_id, idempotency_key | |
| `memories` | text, embedding, said_at, source(chat/siri/quick) | 사용자 발화 |
| `devices` | apns_token, environment, last_seen_at | |
| `usage_counters` | month, vision_calls, haiku_tokens, sonnet_tokens | 비용 상한 |

삭제는 items → chunks/facts/purchases/proposals/storage 객체까지 전파. pg_cron 일일 잡이 `expires_at` 지난 원문과 30일 지난 Storage 객체를 지운다.

## 9. 채팅·검색

```text
질문 → Haiku가 필터 추출 {date_range, sources, kinds, merchant?}
     → purchases/facts SQL 우선 (구조화 질문)
     → 하이브리드: tsvector(simple + pg_trgm) ∪ pgvector cosine, RRF 융합, 상위 12개
     → memories 상위 5개 포함
     → Sonnet 답변. 각 문장에 [출처 n] 표시. 근거 없으면 "저장된 정보에서 확인되지 않음"
     → 실행 가능 항목은 proposal 카드로 반환
```

- 한국어 키워드는 PostgreSQL `simple` 설정으로는 형태소가 안 잘리므로 pg_trgm 유사도를 함께 쓴다. 검색 품질은 3단계에서 실제 질문 20개로 평가한다.
- 수집된 메일·웹·알림 안의 지시문은 데이터로만 취급한다. 시스템 프롬프트에 명시하고, 프롬프트는 `system` 고정 + `cache_control`로 캐시한다.
- 모든 사용자 발화는 `memories`에 저장한다.

## 10. 실행

- 푸시 카테고리 `ADD_EVENT`, `ADD_REMINDER`, `REVIEW`. 액션 "추가"는 `authenticationRequired`, "무시", "앱에서 수정"은 `foreground`.
- 액션 핸들러: proposal 조회 → EventKit 쓰기 → `eventkit_id`와 함께 `succeeded` 보고. 실패 시 `failed` + 로컬 알림 "앱에서 확인".
- 같은 fact에 대한 중복 제안은 `idempotency_key`로 차단. 이미 등록된 이벤트 수정 제안은 `eventkit_id`로 원본을 찾아 갱신.
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

- 기기 입력은 기기에서 먼저 필터·마스킹 후 전송. Gmail은 서버가 직접 받으므로 "기기에서 먼저 마스킹"이라고 설명하지 않는다.
- 폐기된 항목은 저장하지 않으며 로그에도 본문을 남기지 않는다.
- Foundation Models 분류 결과는 저장하지 않고 통과/폐기 판정에만 쓴다.
- 외부 LLM(Anthropic, Voyage)으로 나가는 데이터 범위를 설정 화면에 명시한다.
- 연결 해제·수집 중지·전체 삭제·내보내기를 분리 제공한다.
- 지인 확대 시 개인정보 처리방침과 Gmail 앱 검증을 선행한다.

## 13. 비용 (월, 1인 기준 추정)

| 항목 | 가정 | 비용 |
|---|---|---|
| Haiku 분류·추출 | 일 60건 × 1.5k 토큰 | 약 $3 |
| Sonnet 채팅 | 일 10회 × 6k 입력/0.5k 출력 | 약 $5 |
| Vision | 월 30건 | 약 $0.5 |
| Voyage 임베딩 | 월 3M 토큰 | 약 $0.1 (가격 문서 미확인) |
| Supabase | 무료 | $0 |
| 합계 | | 약 $9 ≈ 1.2만원 |

`usage_counters`로 월 상한 도달 시 Sonnet → Haiku 강등, vision → OCR 강등을 자동 적용한다.

## 14. 0단계: 기능별 사전 검증 (구현 전 필수)

각 항목은 독립 PoC로 실기기에서 판정한다. 통과 기준을 못 채우면 대안을 채택하고 이 스펙을 갱신한다.

| # | 검증 대상 | 방법 | 통과 기준 | 실패 시 대안 |
|---|---|---|---|---|
| PoC-1 | Notification 트리거 → App Intent | 빈 앱 + CaptureIntent, 카카오톡·Instagram 알림 트리거 자동화 | 본문·앱명 전달 확인. 확인 배너 여부·잠금 상태 동작 기록 | 본문 미전달 → 알림 경로 폐기, 공유만. 배너 필수 → 키워드 필터로 탭 최소화 |
| PoC-2 | Message 트리거 → App Intent | 문자 수신 시 발신자·본문 전달, 잠금 중 무확인 실행 | 잠금 상태에서 큐에 저장됨 | 실패 시 문자도 공유 경로만 |
| PoC-3 | Foundation Models in-app 백그라운드 인텐트 | 한국어 알림 50건 분류, 지연·메모리 측정 | p95 < 3초, 정확도 ≥ 90% | 규칙 필터만 + 서버 분류 |
| PoC-4 | Edge Function → APNs HTTP/2 | 프로덕션 리전에서 100회 발송 | 성공률 ≥ 99% | Cloudflare Worker 릴레이 |
| PoC-5 | 알림 액션 → 백그라운드 EventKit 쓰기 | `authenticationRequired` 액션에서 이벤트 생성 | 앱 열지 않고 캘린더에 생성 | `foreground` 액션으로 앱 열어 실행 |
| PoC-6 | Gmail serverAuthCode 교환 + watch + history | 테스트 계정으로 3개월 백필, push 수신 | 쿼터 초과 없이 완료, push 1분 내 수신 | 폴링(15분) |
| PoC-7 | 한국어 하이브리드 검색 | 샘플 200건, 질문 20개 | Top-5 정답 포함률 ≥ 80% | 임베딩 모델 교체, 청크 크기 조정 |
| PoC-8 | Share Extension 이미지 → Storage 서명 업로드 → vision 추출 | 청첩장 이미지 5종 | 날짜·장소 추출 5/5 | OCR 텍스트만 전송 |
| PoC-9 | background URLSession from App Intent | 잠금·오프라인 후 복구 시 전송 | 24시간 내 전송 완료 | 앱 포그라운드 시 재시도만 |

각 PoC는 `poc/<n>-<name>/`에 두고 결과를 `docs/superpowers/poc/`에 기록한다. PoC 코드는 폐기 대상이며 제품 코드에 복사하지 않는다.

## 15. 단계 계획

| 단계 | 범위 | 완료 기준 |
|---|---|---|
| 0 | PoC-1~9 | 판정표 작성, 스펙 갱신 |
| 1 | Supabase 스키마·RLS·Auth, Gmail 동기화, ingest/process/notify/chat Edge, 앱 채팅·보관함, Share(텍스트·URL), EventKit, 알림 액션 | 메일에서 뽑은 일정을 잠금화면 버튼으로 캘린더에 넣고 채팅으로 다시 찾음 |
| 2 | Message/Notification 트리거 + 기기 필터, 자동화 설치 가이드, 이미지·PDF vision, purchases 추출·질문 | 알림톡 주문이 구매 이력에 쌓이고 "어디서 샀지" 답변 |
| 3 | Siri·빠른 기억, 구독 추적, 변경·취소 감지, 보관 정리 잡, 검색 품질 평가, TestFlight | 지인이 가이드만으로 셋업 완료. 검색 Top-5 ≥ 80% |

## 16. 리스크와 미결

- **알림 트리거 배너 탭**: 사용자가 알림마다 탭해야 하면 편의성이 크게 떨어진다. PoC-1 결과에 따라 2단계 범위를 재조정한다.
- **Gmail 7일 재인증**: 본인 사용 기간엔 감수. 지인 확대 시점에 앱 검증 비용을 결정한다.
- **APNs from Deno**: 미확인. PoC-4.
- **Voyage 가격·한국어 품질**: 공식 가격 페이지 미확인. PoC-7에서 품질 판정.
- **Supabase 무료 티어 500MB**: 1인 1년 원문이면 충분하나 이미지 포함 시 Storage 1GB 상한 감시.
- **Foundation Models 가용성**: Apple Intelligence 꺼진 기기는 규칙 필터만. 지인 확대 시 안내 필요.
