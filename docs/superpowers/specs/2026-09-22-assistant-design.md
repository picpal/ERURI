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
| 비용 | 월 1만원. 기기 Foundation Models → `claude-haiku-4-5` 추출 → `claude-sonnet-5` 채팅 | 사용자 확정 |
| 임베딩 | Voyage `voyage-4-lite`, 512차원 | Supabase 내장 gte-small은 영어 전용. 한국어 필요 |

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
| Supabase gte-small 임베딩 | 검증됨, 그러나 **영어 전용** | Voyage로 교체 |
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
     - OTP: (인증|승인|확인)\s*번호|verification|OTP 와 4~8자리 숫자 동시 출현 → 폐기, 로그 없음
     - 카드번호: 13~19자리 숫자열(구분자 허용, Luhn 통과) → 마지막 4자리만 남기고 마스킹
     - 계좌번호: 은행명·"계좌" 키워드 ±20자 내 10~14자리 숫자열 → 마스킹
     - 발신자가 연락처에 있는 사람 이름 → 폐기 (카톡 개인 대화 배제)
  2. Foundation Models 분류 (가능 시, 타임아웃 3초)
     @Generable struct Verdict { kind: notice|personal|otp|promo|medical_result; confidence: 0-1 }
     personal/otp/promo/medical_result → 폐기
     불가·타임아웃 → 카카오톡·Instagram 출처는 **폐기** (개인 대화 배제 원칙이 우선),
                    메시지·쇼핑/금융 앱 출처는 device_filter = "rules"로 통과
  3. App Group SQLite 큐에 저장 (보호 등급 completeUntilFirstUserAuthentication)
  4. background URLSession (sharedContainerIdentifier) → POST /ingest
  5. 성공 시 큐 삭제, 실패 시 지수 재시도. 앱 강제 종료 시 백그라운드 전송이 취소되므로
     앱 실행·복귀 시 큐를 다시 스캔해 재전송한다. "24시간 내"는 목표이지 보장이 아니다.
```

Share Extension은 1단계만 적용하고 큐에 넣는다. 이미지·PDF는 **먼저 App Group 컨테이너에 파일로 영속화**한 뒤 큐에 로컬 경로를 기록하고, 업로드는 앱이 background URLSession 파일 업로드로 수행한다. 업로드 성공 후에만 로컬 파일을 지운다. 이미지에는 정규식 마스킹이 적용되지 않으므로 사용자에게 "이미지는 서버로 그대로 전송됨"을 공유 화면에 표시한다.

이미지·PDF 공유 시 기기 Vision 프레임워크 OCR 텍스트를 **항상 함께** 생성해 큐에 넣는다. 서버가 vision 상한에 걸리면 이 텍스트로 대체하므로 기기 재개 절차가 필요 없다.

## 7. 서버 파이프라인

```text
/ingest  (JWT 필수)
  → idempotency_key(user_id + source + external_id | sha256(content + occurred_at 분 단위)) 중복 검사
  → 서버 규칙 필터 재적용 (OTP·카드·계좌). 통과 못 하면 저장 없이 204
  → items INSERT (status = queued) + jobs INSERT (kind = process, item_id)
  → 202 반환

jobs 워커  (pg_cron 매분 → Edge: worker. 임대(lease) 60초, 최대 5회 재시도, 실패 시 dead 상태)
  → 단계별 체크포인트: classified → extracted → embedded → proposed. 재시도는 마지막 체크포인트부터
  → 재분류 (Haiku, ≤200 토큰 JSON): event|task|purchase|subscription|reference|discard|medical_result
      discard·medical_result → items DELETE, 감사 로그에 사유 코드만. 이 단계 전에는 다른 외부 전송 없음
  → 추출 (Haiku, output_config.format JSON 스키마)
      event: title, start, end, allDay, location, tz, evidence, uncertain[]  (예: year, ampm, end, tz)
      task: title, due, evidence, uncertain[]
      purchase: merchant, product[], ordered_at, amount, currency, order_no, status, recurrence?, evidence
  → 이미지/PDF: Haiku vision. 월 상한 100건(usage_counters). 초과 시 기기에서 같이 올라온 OCR 텍스트 사용
      PDF: 10MB·50페이지 초과, 암호화, 파싱 실패 → "앱에서 확인" 상태로 두고 푸시
  → URL: 허용 스킴 http(s)만, 사설·루프백 IP 차단, 리디렉션 3회, 응답 2MB·10초 제한, 텍스트 MIME만
      본문 추출 실패(HTML 파싱 오류·JS 전용) → "스크린샷 공유 요청" 푸시. 짧은 정상 문서는 그대로 저장
  → 연결: purchases는 (merchant, order_no) 복합 키. 없으면 (merchant, amount, ordered_at ±1일)로 후보 제시
      취소·변경 문구 → 기존 fact status = cancelled/superseded, 새 fact에 supersedes_id
  → 청크(512자) + Voyage 임베딩 → item_chunks
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
- pg_cron: 매일 watch 갱신, 만료 7일 전 재인증 푸시. refresh 실패 시 `connections.status = reauth_required`로 두고 잡 중단.

## 8. 데이터 모델

모든 테이블에 `user_id uuid references auth.users` + RLS `(select auth.uid()) = user_id`.

| 테이블 | 핵심 컬럼 | 비고 |
|---|---|---|
| `connections` | provider, account_ref, status, expires_at | 토큰은 `vault` |
| `sync_states` | connection_id, cursor(historyId), last_success_at | |
| `items` | source(GMAIL/MESSAGES/NOTIFICATION/SHARE/CHAT), app_name, sender, title, content_enc bytea, ocr_text_enc bytea, occurred_at, captured_at, device_filter, idempotency_key, status, storage_key, expires_at | 원문. `content_enc`·`ocr_text_enc`는 사용자별 키로 pgsodium 암호화(§12). 90일 후 삭제, 행은 유지 |
| `user_keys` | user_id, key_id | 사용자별 데이터 키. 키 자체는 Supabase Vault, 이 테이블은 키 ID만 |
| `item_chunks` | item_id, chunk_index, text, embedding vector(512), tsv tsvector | HNSW + GIN. 원문 만료 시 삭제 |
| `facts` | item_id, kind, payload jsonb, evidence(원문 인용 ≤300자), status(active/cancelled/superseded), supersedes_id | 추출 결과, 무기한. evidence가 만료 후 출처 역할 |
| `purchases` | fact_id, merchant, product[], ordered_at, amount, currency, order_no, status, delivery_status, recurrence | 구매·구독. `purchase_evidence(purchase_id, item_id)`로 다대다 |
| `proposals` | fact_id, action(create_event/update_event/create_reminder/complete_reminder), payload, version, status(proposed/confirmed/succeeded/failed/stale), eventkit_id, idempotency_key | fact 변경 시 version 증가, 이전 제안은 stale |
| `executions` | proposal_id, device_id, eventkit_id, executed_at | 기기가 쓰기 성공 직후 기록. 보고 실패 복구용 |
| `jobs` | kind, payload, lease_key, leased_until, attempts, status(queued/running/done/dead), checkpoint | 영속 작업 큐 |
| `utterances` | text, embedding, said_at, source(chat/siri/quick), kind(statement/question/correction) | 사용자 발화 전체 기록 |
| `memories` | text, embedding, utterance_id, status(active/retracted), supersedes_id | "기억해줘" 또는 Haiku가 statement로 판정한 것만. 정정 발화는 이전 memory를 retracted 처리 |
| `devices` | apns_token, environment, last_seen_at | |
| `usage_counters` | month, vision_calls, haiku_tokens, sonnet_tokens, reserved_krw | 비용 상한. 호출 전 예약, 후 정산 |

### 삭제·만료 정책 (두 가지를 분리)

| 구분 | 트리거 | 지우는 것 | 남기는 것 |
|---|---|---|---|
| 원문 만료 | pg_cron, `expires_at` 경과 (원문 90일, 이미지 30일) | items.content_enc/ocr_text_enc, item_chunks.text(평문 청크), Storage 객체 | items 행(메타), item_chunks.embedding(벡터는 유지해 의미 검색 지속), facts, purchases, proposals, memories |
| 사용자 삭제 | 사용자가 항목·연결·전체 삭제 | 위 전부 + facts, purchases, proposals, executions, memories까지 연쇄 | 감사 로그의 사유 코드 |

만료 후 검색 결과의 출처는 facts.evidence 인용문과 "원문 만료됨" 표시로 대체한다.

용량 추정(1인 1년): 메일 일 20건 × 4KB 원문 + 청크 복제 + 512차원 벡터(2KB)×청크 3개 ≈ 연 90MB. 500MB 안이지만 `pg_database_size`를 주간 잡으로 기록해 400MB에서 경고한다.

## 9. 채팅·검색

```text
질문 → Haiku가 필터 추출 {date_range, sources, kinds, merchant?}
     → purchases/facts SQL 우선 (구조화 질문)
     → 하이브리드: tsvector(simple + pg_trgm) ∪ pgvector cosine, RRF 융합, 상위 12개
     → memories(active만) 상위 5개 포함. utterances의 question/correction은 검색 풀에서 제외
     → Sonnet 답변. output_config.format으로 {answer, citations:[{sentence_idx, source_ids[]}]} 구조화 출력
     → 서버 검증: citations의 source_id가 이번 검색 결과 집합에 있는지 확인. 없는 인용은 제거하고
        해당 문장을 "근거 미확인"으로 표시. 인용 0개면 "저장된 정보에서 확인되지 않음"으로 대체
     → 실행 가능 항목은 proposal 카드로 반환. 검색 문서 내용은 절대 proposal payload를 직접 만들지 못하고
        추출 파이프라인(§7)을 다시 거친다
```

- 한국어 키워드는 PostgreSQL `simple` 설정으로는 형태소가 안 잘리므로 pg_trgm 유사도를 함께 쓴다.
- 검색 품질 평가는 **1단계 완료 기준**에 포함한다(§15). 지표: 정답 포함(Top-5 ≥ 90%, 질문 50개), 무근거 질문 거절률, 취소·정정 반영, 인용 정확도, 날짜 필터 오판.
- 수집된 메일·웹·알림 안의 지시문은 데이터로만 취급한다. 검색 결과는 `<document>` 블록으로 감싸 user 턴에 넣고 시스템 프롬프트는 고정 + `cache_control`로 캐시한다. 도구 호출 권한은 chat 함수에 없다(읽기 전용).
- 모든 발화는 `utterances`에 기록하되, 사실로 검색되는 것은 `memories`(statement 판정 또는 "기억해줘")뿐이다. "아니 그거 안 샀어" 같은 정정은 이전 memory를 retracted로 바꾼다.

## 10. 실행

- 푸시 카테고리 `ADD_EVENT`, `ADD_REMINDER`, `REVIEW`. 액션 "추가"는 `authenticationRequired`, "무시", "앱에서 수정"은 `foreground`. `uncertain`이 있는 제안은 REVIEW로만 보낸다.
- 액션 핸들러 순서 (멱등):
  1. 서버에서 proposal 최신 버전 조회. `stale`·`succeeded`면 중단하고 안내.
  2. 로컬 `executions` 테이블(App Group SQLite)에 proposal_id가 있으면 재쓰기 없이 보고만 재시도.
  3. EventKit 쓰기 → 성공 즉시 로컬 executions에 (proposal_id, eventkit_id) 기록.
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

### 통제 1. 저장 암호화와 키 분리

- 디스크 암호화(Supabase 기본) 위에 **본문 컬럼을 사용자별 데이터 키로 암호화**한다. 키는 Supabase Vault에 두고 `user_keys`는 키 ID만 가진다.
- 암호화 대상: `items.content_enc`, `items.ocr_text_enc`, Storage 객체(서버 측 암호화 + 서명 URL만). 평문 유지: `item_chunks.text`(검색 필요, 90일 후 삭제), 벡터, `facts.payload`·`evidence`, `purchases`, `memories`.
- 복호화는 `jobs` 워커와 `chat` 함수만 수행한다. DB 덤프·백업이 유출돼도 본문은 읽히지 않는다.
- 사용자 전체 삭제 시 데이터 키를 Vault에서 지워 백업에 남은 암호문도 무효화한다(crypto-shredding).

### 통제 2. 최소화와 짧은 보관

- 수집 제외: 프로모션 라벨, 첨부파일(이미지·PDF는 사용자가 공유한 것만), OTP, 카드·계좌번호(마스킹), 카톡 개인 대화, 의료 결과지.
- 원문 90일, 이미지 30일 뒤 삭제. 추출 사실·구매 이력·벡터·`evidence` 인용(≤300자)만 남아 검색은 계속된다.
- 기기 입력은 기기에서 먼저 필터·마스킹 후 전송한다. Gmail은 서버가 직접 받으므로 "기기에서 먼저 마스킹"이라고 설명하지 않는다.
- 폐기된 항목은 저장하지 않으며 로그에도 본문을 남기지 않는다. Foundation Models 분류 결과는 저장하지 않는다.

### 통제 3. LLM·임베딩 공급자 조건

- Anthropic API: 기본 학습 미사용, 표준 보관 30일. 프롬프트 로그·요청 본문을 Supabase 로그에 남기지 않는다(`console.log`에 본문 금지, 요청 ID만).
- Voyage: 학습 미사용 조건과 보관 기간을 이용약관에서 확인해 §16에 기록한다. 확인 전까지 임베딩 대상은 마스킹된 텍스트뿐이다.
- 지인 확대 시 Anthropic ZDR(zero data retention) 신청을 검토한다.

### 통제 4. 접근 통제와 감사

- 모든 테이블 RLS(`(select auth.uid()) = user_id`). `service_role` 키는 Edge Function 시크릿에만 존재하고 개발 기기·CI에 두지 않는다.
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
| Haiku 분류·추출 | 일 60건 × 1.5k 토큰 | 약 $3 |
| Sonnet 채팅 | 일 10회 × 6k 입력/0.5k 출력 | 약 $5 |
| Vision | 월 30건 | 약 $0.5 |
| Voyage 임베딩 | 월 3M 토큰 | 약 $0.1 (가격 문서 미확인) |
| Supabase | 무료 | $0 |
| 합계 | | 약 $9 ≈ 1.2만원 |

자체 추정이 이미 상한을 넘으므로 다음 통제를 둔다.

- 호출 전 `usage_counters.reserved_krw`에 예상 비용을 예약하고, 월 상한(기본 1만원) 초과 예약은 거부한다. 응답 후 실제 토큰으로 정산한다.
- 80% 도달: Sonnet → Haiku 강등, vision → OCR 텍스트. 100% 도달: 추출·채팅 중단, 수집만 계속(jobs는 queued 유지). 앱에 잔여 예산 표시.
- 초기 백필 3개월(약 1,800건 × 1.5k 토큰 ≈ $3)은 별도 1회 예산으로 잡는다.
- 동시 LLM 호출은 사용자당 2개로 제한한다.

## 14. 0단계: 기능별 사전 검증 (구현 전 필수)

각 항목은 독립 PoC로 실기기에서 판정한다. 통과 기준을 못 채우면 대안을 채택하고 이 스펙을 갱신한다.

| # | 검증 대상 | 방법 | 통과 기준 | 실패 시 대안 |
|---|---|---|---|---|
| PoC-1 | Notification 트리거 → App Intent | 빈 앱 + CaptureIntent, 카카오톡·Instagram 알림 트리거 자동화. iOS 26과 27 각각 | 본문·앱명 전달 확인. 확인 배너 여부·잠금 상태·미리보기 꺼짐 상태·묶음 알림 동작 기록 | 본문 미전달 → 알림 경로 폐기, 공유만. 배너 필수 → 키워드 필터로 탭 최소화 |
| PoC-2 | Message 트리거 → App Intent | 문자 수신 시 발신자·본문 전달, 잠금 중 무확인 실행. 재부팅 후 첫 잠금 해제 전 수신 | 잠금 상태에서 큐에 저장됨. 첫 해제 전 수신분 처리 방식 기록 | 실패 시 문자도 공유 경로만 |
| PoC-3 | Foundation Models in-app 백그라운드 인텐트 | 한국어 알림 200건(개인 대화 100·알림톡 100) 분류, 지연·메모리 측정 | p95 < 3초. **개인 대화 통과율 ≤ 2%**, 알림톡 폐기율 ≤ 15% | 규칙 필터만 + 카톡·인스타 경로 폐기 |
| PoC-4 | Edge Function → APNs HTTP/2 | 프로덕션 리전에서 100회 발송, 동시 10회 포함 | 성공률 ≥ 99%, h2 스트림 오류 0 | Cloudflare Worker 릴레이 |
| PoC-5 | 알림 액션 → 백그라운드 EventKit 쓰기 | `authenticationRequired` 액션에서 이벤트 생성. 같은 알림 두 번 탭, 보고 실패 후 재탭 | 앱 열지 않고 캘린더에 1건만 생성 | `foreground` 액션으로 앱 열어 실행 |
| PoC-6 | Gmail serverAuthCode 교환 + watch + history | 테스트 계정으로 3개월 백필, push 수신. 8일 재인증 만료 재현, 커서 404 재현 | 쿼터 초과 없이 완료, push 1분 내 수신, 만료·404 후 누락 0건 | 폴링(15분) |
| PoC-7 | 한국어 하이브리드 검색 | 샘플 500건(메일·알림톡·발화 혼합), 질문 50개(무근거 10개 포함) | Top-5 ≥ 90%, 무근거 거절 ≥ 90%, 인용 검증 통과 | 임베딩 모델 교체, 청크 크기 조정 |
| PoC-8 | Share Extension 이미지 → 로컬 영속화 → 업로드 → vision 추출 | 청첩장 이미지 5종, 업로드 중 오프라인 전환 | 날짜·장소·연도 추출 5/5, 오프라인 후 복구 시 유실 0 | OCR 텍스트만 전송 |
| PoC-9 | background URLSession from App Intent | 잠금·오프라인·앱 강제 종료 후 복구 시 전송 | 앱 재실행 포함 시 유실 0. 강제 종료 시 취소되는 것을 기록 | 앱 포그라운드 시 재시도만 |
| PoC-10 | jobs 워커 | pg_cron → Edge worker, 임대 만료·중복 실행·5회 실패 | 같은 잡이 동시에 두 번 돌지 않고 dead 전환됨 | 단일 워커 직렬 처리 |

각 PoC는 `poc/<n>-<name>/`에 두고 결과를 `docs/superpowers/poc/`에 기록한다. PoC 코드는 폐기 대상이며 제품 코드에 복사하지 않는다.

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

### 플랜 B: 로컬 우선 구조 (미채택, 신뢰 문제 발생 시 전환)

서버 저장에 대한 신뢰 문제가 지인 확대 단계에서 커지면 다음 구조로 전환할 수 있다. 1인 데이터 규모(연 청크 2만 개)에서는 기기 SQLite(FTS5 trigram + 벡터 브루트포스)로 검색 효율이 충분하다는 것을 확인했다.

- 기기 SQLite가 단일 원본. 서버는 (a) Gmail Pub/Sub → APNs 가시 푸시 중계, (b) LLM 프록시·예산 카운터만 담당하며 내용을 저장하지 않는다.
- 실시간 처리는 Notification Service Extension(푸시마다 30초, 앱 강제 종료 시에도 실행)이 Gmail 페치 → 추출 → 알림 교체를 수행한다. 따라잡기는 `BGAppRefreshTask`, 무거운 배치(임베딩·정리·백필)는 `BGProcessingTask`(충전 중).
- 서버를 완전히 없애는 변형: Gmail을 Apple Mail에 추가하고 Shortcuts **Email 트리거**(무확인 자동 실행 목록에 있음)로 수집. 지연 15분 이상, 트리거가 본문을 넘기는지 미확인.
- 잃는 것: 폰이 꺼진 동안의 처리, 기기 간 공유, 서버 측 검색 품질 튜닝. 전환 비용: §7 파이프라인 대부분을 Swift로 재작성.

- **알림 트리거 배너 탭**: 사용자가 알림마다 탭해야 하면 편의성이 크게 떨어진다. PoC-1 결과에 따라 2단계 범위를 재조정한다.
- **Voyage 데이터 정책**: 학습 미사용·보관 기간 미확인. 확인 전 임베딩 대상은 마스킹 텍스트만.
- **pgsodium 복호화 비용**: 워커가 건마다 복호화하므로 CPU 2초 제한 안에서 배치 크기를 정해야 한다. PoC-10에 항목 추가.
- **Gmail 7일 재인증**: 본인 사용 기간엔 감수. 지인 확대 시점에 앱 검증 비용을 결정한다.
- **APNs from Deno**: 미확인. PoC-4.
- **Voyage 가격·한국어 품질**: 공식 가격 페이지 미확인. PoC-7에서 품질 판정.
- **Supabase 무료 티어 500MB**: 1인 1년 원문이면 충분하나 이미지 포함 시 Storage 1GB 상한 감시.
- **Foundation Models 가용성**: Apple Intelligence 꺼진 기기는 규칙 필터만. 지인 확대 시 안내 필요.
