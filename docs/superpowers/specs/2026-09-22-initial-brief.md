> 사용자가 2026-09-22 첫 브레인스토밍 때 가져온 초기 구상 문서다. 이후 확정 설계는 `2026-09-22-assistant-design.md`(단일 원본)이며, 두 문서가 다르면 그쪽을 따른다.

**요청 원문:** 비서 앱을 하나 만들거야.  편의성을 극대화 하고 싶고, 나의 기기에 있는 정보들을 관리 정리 보고, 등록 등을 해주는  아래는 초기 구상내용이고, 어떤 방법이든 상관없으니 sms 접근, 앱알림 기록 이메일 확인, 카카오톡 확인, instagram DM확인 , 등등..

---

# iOS 개인 비서 앱: 구현 가능성과 추천 아키텍처

작성 기준: 2026-09-22 · 대상: 한국에서 사용하는 iPhone · 문서 성격: 기존 논의 정리 및 구현 방향 제안

## 1. 목표와 핵심 결론

메일, 문자, 사용자가 전달한 대화, 캘린더와 미리알림을 하나의 개인 컨텍스트로 연결한다. AI는 이 정보를 바탕으로 해야 할 일과 약속을 추출하고, 과거 정보를 검색하며, 사용자가 확인한 내용을 일정이나 미리알림으로 등록한다.

**추천 구성은 iOS 네이티브 앱 + 서비스별 OAuth Connector + EventKit + Share Extension + 선택적 Shortcuts/App Intents + PostgreSQL/pgvector 기반 AI 서버다.**

제품의 약속은 “연결하거나 직접 저장한 정보를 기억하고 행동으로 이어주는 개인 비서”로 정의한다. 수집하지 않은 대화까지 알고 있다고 표현하지 않으며, 검색 결과에는 출처와 마지막 동기화 시각을 표시한다.

이 문서는 설계 제안이다. 공식 문서로 확인한 지원 범위와 실제 기기에서 검증해야 할 동작을 구분한다. 실제 앱 구현·실기기 테스트·배포 심사를 완료했다는 의미는 아니다.

### 구현 가능 범위

| 데이터 | 권장 입력 경로 | 자동화 수준 | 과거 데이터 및 주요 한계 |
|---|---|---|---|
| Gmail | Gmail API + OAuth | 서버에서 지속 동기화 가능 | 승인한 계정의 조회 가능 범위, 검증·쿼터·토큰 관리 필요 |
| Outlook | Microsoft Graph + OAuth | 서버에서 지속 동기화 가능 | 계정·조직 정책에 따라 접근 제한 |
| Calendar | 기기의 EventKit | 권한과 앱 실행 기회에 따라 동기화 | 기기에서 접근 가능한 캘린더, 서버 직접 접근 아님 |
| Reminders | 기기의 EventKit | 권한과 앱 실행 기회에 따라 동기화 | 기기에서 접근 가능한 미리알림 |
| SMS/iMessage | 메시지 수신 Shortcuts → App Intent | 사용자가 설정한 조건에 한해 자동화 | 기존 메시지함 전체 조회나 누락분 재조회 불가 |
| KakaoTalk | 사용자 공유·복사·붙여넣기 | 기본 경로는 수동 | 일반 개인 대화 전체를 가져오는 공개 API를 전제로 할 수 없음 |
| Safari·사진·파일 등 | iOS Share Extension | 사용자가 선택한 항목 수집 | 원본 앱이 실제 제공하는 데이터만 수신 |
| 앱 알림 | 지원 OS의 Shortcuts 알림 트리거 검토 | 추가 실기기 검증이 필요한 선택 기능 | 일반 앱의 전역 알림 읽기 권한과는 다름 |

위 표의 API 및 권한 근거는 아래 각 절에 연결했다.

## 2. 전체 아키텍처

```text
Gmail / Outlook
  └─ OAuth → 서버 Connector → 변경 알림·증분 동기화 ──────────┐
                                                          │
iPhone                                                    │
  ├─ SwiftUI 앱: 대화, 통합 보관함, 검색, 동의·연결 관리     │
  ├─ EventKit: Calendar / Reminders ↔ 로컬 동기화 계층       │
  ├─ Share Extension: 텍스트 / URL / 이미지 / 파일          │
  ├─ Shortcuts → App Intent: 사용자가 설정한 입력           │
  └─ 직접 입력 / 명시적 붙여넣기                            │
         ↓                                                │
  App Group 저장 공간 + 로컬 DB + 재시도 큐                 │
         ↓ 최소화·민감정보 필터·동기화 동의                 │
         └────────────────── HTTPS 수집 API ────────────────┘
                                  ↓
                     정규화 / 중복 제거 / 처리 큐
                                  ↓
                  분류 / 날짜·할 일 추출 / 출처 연결
                                  ↓
             PostgreSQL + pgvector + 선택적 첨부파일 저장소
                                  ↓
                권한·기간 필터 + 키워드·의미 검색
                                  ↓
                         LLM 응답 / 실행 제안
                                  ↓
                        사용자 확인 / 정책 검사
                                  ↓
              iPhone EventKit 실행 → 결과·연결 ID 기록
```

### 기기와 서버의 책임

- **기기:** 권한 요청, 공유 입력, EventKit 읽기·쓰기, 로컬 보관, 기기 입력의 전송 전 필터링, 실행 결과 표시.
- **서버:** 메일 동기화, 인증, 사용자별 저장, 검색, AI 처리, 작업 상태와 실패 관리.
- **공통:** 고유 요청 ID, 중복 방지, 삭제 전파, 출처·시각·동기화 상태 관리.

EventKit은 iPhone에서 실행한다. 서버가 iCloud Calendar나 Reminders에 EventKit으로 직접 접속할 수는 없다. 서버가 만든 실행 제안은 기기로 전달하며, 실제 쓰기가 성공한 후에만 “등록 완료”로 표시한다. iOS의 실행 기회에 의존하는 동작은 즉시 완료를 보장하지 않는 설계로 둔다.

기술 선택 예시는 Swift/SwiftUI, 로컬 SQLite 또는 SwiftData, HTTPS 백엔드, PostgreSQL이다. 백엔드 언어는 팀의 익숙한 기술을 사용하고, 모델 호출은 공급자를 교체할 수 있는 계층으로 분리한다.

## 3. Gmail / Outlook 연동

### Gmail

사용자가 OAuth로 연결하면 Gmail API로 메일을 조회한다. MVP는 `gmail.readonly` 범위에서 시작하고, 답장 초안은 앱 내부 텍스트로 생성한다. Gmail 자체에 초안을 저장하거나 발송하려면 해당 작업에 맞는 추가 권한이 필요하다. 읽기 전용도 restricted scope이며, 공개 서비스의 OAuth 검증과 서버 저장·전송에 대한 보안 평가 요건을 출시 계획에 포함해야 한다. [Google: Gmail API scopes](https://developers.google.com/workspace/gmail/api/auth/scopes)

권장 흐름은 초기 조회 → `watch`/Cloud Pub/Sub 변경 통지 → `history.list`로 변경 확인 → 필요한 메일 조회다. 통지 자체를 메일 본문으로 취급하지 않는다. 구독 갱신과 주기적 대조 조회를 운영하고, 커서가 유효하지 않으면 범위를 정해 다시 동기화한다. [Google: Gmail push notifications](https://developers.google.com/workspace/gmail/api/guides/push), [Google: Synchronize clients](https://developers.google.com/workspace/gmail/api/guides/sync)

제품에서는 최근 일정 기간, 선택 라벨, 첨부파일 제외 등 수집 범위를 제공한다. 이 필터는 앱의 수집 정책이며 OAuth 권한 자체가 해당 라벨로 제한된다는 뜻은 아니다.

### Outlook

개인 Outlook 및 지원되는 Microsoft 365 계정은 Microsoft Graph의 위임 권한으로 연결한다. 본문 처리가 필요하면 `Mail.Read`를 사용하고, 조직 계정은 관리자 동의나 테넌트 정책을 반영한다. 변경 알림 구독과 폴더별 delta 조회를 조합하며, 폴더마다 동기화 상태를 저장한다. 구독 만료·재인증·메일 이동과 삭제도 처리한다. [Microsoft: Outlook change notifications](https://learn.microsoft.com/en-us/graph/outlook-change-notifications-overview), [Microsoft: message delta](https://learn.microsoft.com/en-us/graph/api/message-delta?view=graph-rest-1.0)

### 메일 UX와 주의점

- “지난주 견적 관련 메일”, “금요일까지 처리할 요청”을 검색한다.
- “답장하지 않은 중요 메일”은 연결된 계정·보낸편지함·스레드 범위 안에서 추정했다고 표시한다.
- 연결 해제, 수집 중지, 보관 데이터 삭제를 구분해 제공한다.
- Apple Mail을 사용하더라도 Gmail/Outlook 계정 자체를 연결한다. Apple Mail 앱의 통합 메일함을 읽는 범용 Connector로 설명하지 않는다.

## 4. Calendar / Reminders: EventKit

`EKEventStore`를 통해 사용자 권한을 받은 일정과 미리알림에 접근한다. iOS 17 이상에서는 캘린더의 쓰기 전용과 전체 접근을 구분한다. 기존 일정 조회에는 전체 접근이 필요하며, 별도 읽기 전용 권한은 없다. 미리알림도 조회·관리를 위해 전체 접근을 요청한다. 일정 추가 UI만 필요하다면 EventKitUI의 편집 화면을 활용할 수 있다. [Apple: Accessing the event store](https://developer.apple.com/documentation/eventkit/accessing-the-event-store)

| 기능 | 구현 방향 |
|---|---|
| 내일 일정·빈 시간 조회 | Calendar 전체 접근, 선택 캘린더만 조회 |
| 일정 추가 | EventKitUI 확인 화면 또는 필요한 쓰기 권한 |
| 할 일·기한 조회 및 등록 | Reminders 전체 접근 |
| 수정·삭제 | 원본 식별자 확인 및 사용자 의도 검증 |

권한 설명에는 기능과 필요 이유를 명시한다. 캘린더와 미리알림은 별도로 요청하고 거부·철회 상태를 처리한다. [Apple: Calendar access migration](https://developer.apple.com/documentation/technotes/tn3152-migrating-to-the-latest-calendar-access-levels)

추천 설계는 다음과 같다.

- 읽기 전용 캘린더와 편집 가능한 캘린더를 구분한다.
- 앱 실행·복귀 시 변경을 대조하고 마지막 확인 시각을 표시한다.
- 원본 이벤트와 AI가 추출한 후보를 연결해 중복 제안을 줄인다.
- 시간대와 종일 일정을 별도로 처리한다. 한국 사용자 기본값은 `Asia/Seoul`로 두되 사용자 설정을 존중한다.
- 서버에 저장된 일정 사본은 최신성 표시가 필요한 캐시로 취급한다.

## 5. SMS/iMessage: Shortcuts + App Intents

### 가능한 연결 경로

Apple Shortcuts에는 메시지 수신 트리거가 있으며 발신자나 포함 문구로 조건을 설정할 수 있다. 메시지 자동화는 자동 실행을 지원하는 유형에 포함된다. 다만 트리거 지원과 모든 후속 동작의 무인 실행 보장은 구분해야 한다. [Apple: Communication triggers](https://support.apple.com/guide/shortcuts/communication-triggers-apdd711f9dff/ios), [Apple: Personal automation settings](https://support.apple.com/en-by/guide/shortcuts/-apd602971e63/ios)

```text
조건에 맞는 SMS/iMessage 수신
  → 사용자가 구성한 Shortcuts 자동화
  → 단축어 입력에서 사용할 수 있는 본문·메타데이터 추출
  → SaveAssistantItem App Intent
  → 로컬 저장 / 필터링 / 동의한 서버 전송
```

App Intent는 앱의 “정보 저장” 같은 동작을 시스템에 노출하는 인터페이스다. 일부 동작은 App Intents Extension을 통해 앱 화면을 열지 않고 실행할 수 있지만, 실행 모드와 인증·기기 상태에 따른 제약이 있다. **App Intent 자체가 메시지를 읽는 권한을 제공하지는 않는다.** [Apple: App Intents](https://developer.apple.com/documentation/appintents/getting-started-with-the-app-intents-framework), [Apple: App Intents extension](https://developer.apple.com/documentation/appintents/app-extension)

HTTPS 엔드포인트에 직접 보내는 단축어도 대안이다. 제품에서는 자격증명 관리와 로컬 큐를 앱에 모으기 쉬운 App Intent를 우선한다. 직접 전송을 지원할 때는 사용자별 폐기 가능한 제한 토큰을 사용하고, 서버의 비밀 키를 단축어에 넣지 않는다.

### 반드시 명시할 한계

- 일반 앱이 Messages의 기존 전체 SMS/iMessage 데이터베이스를 조회하는 구조는 범위에서 제외한다.
- 사용자에게 자동화 설정과 권한 확인 과정이 필요하다. 앱 설치만으로 모든 문자 수집이 켜진다고 안내하지 않는다.
- 조건에 맞지 않는 메시지, 자동화 중지 기간, 실패한 수신분은 빠질 수 있다. 서버 동기화처럼 누락분을 재조회할 수 있다고 가정하지 않는다.
- 발신자·원문 시각·첨부파일·대화 식별자가 항상 제공된다고 가정하지 않는다. 알 수 없는 값은 비워 두고 수집 시각과 원문 시각을 구분한다.
- SMS와 iMessage 구분 근거가 없으면 `source=MESSAGES`, `transport=unknown`으로 저장한다.
- 잠금 상태, 재부팅 후 첫 잠금 해제 전, 네트워크 단절, 권한 변경과 지원 OS별 동작을 실기기로 확인한다.
- OTP·비밀번호·금융 인증 문구는 기본 수집 제외 대상으로 두고, 병원·택배 등 사용자가 선택한 범위부터 적용한다.

메시지함 접근을 대신할 목적으로 기본 메시징 앱 지정이나 통신사 메시징 프레임워크를 도입하지 않는다. 별도 자격·지역 조건이 있는 기능은 한국 일반 사용자용 MVP의 의존성에서 제외한다. [Apple: TelephonyMessagingKit](https://developer.apple.com/documentation/telephonymessagingkit)

## 6. KakaoTalk: API 제약과 사용자 전달

카카오의 일반 카카오톡 메시지 API는 메시지 발송을 위한 기능이다. 개인 채팅방 목록, 모든 수신 메시지, 과거 대화 전체를 비서가 가져오는 공개 읽기 API로 사용할 수 없다. 카카오톡 공유 API 역시 앱의 콘텐츠를 카카오톡으로 보내는 경로이며, 카카오톡의 대화를 외부 앱으로 수집하는 권한과 다르다. [Kakao: 메시지 REST API](https://developers.kakao.com/docs/ko/kakaotalk-message/rest-api)

### 권장 입력 UX

1. 사용자가 필요한 메시지·이미지·파일을 선택한다.
2. 해당 콘텐츠가 iOS 시스템 공유 시트를 지원하면 `공유 → Assistant`로 보낸다.
3. 외부 공유가 없으면 `복사 → Assistant에서 붙여넣기`를 사용한다.
4. 필요하면 사용자가 직접 선택한 스크린샷을 공유하고 OCR 결과를 확인한다.
5. 저장된 내용을 일정·할 일 후보로 제안한다.

**“카카오톡 메시지를 길게 누르면 항상 외부 Share Extension으로 보낼 수 있다”는 가정은 하지 않는다.** 카카오톡 안의 전달 메뉴와 iOS 시스템 공유는 별개이며, 앱 버전·메시지 종류별 실기기 검증이 필요하다. 출처 앱, 보낸 사람, 원문 시각도 자동으로 식별된다고 보장하지 않는다.

### 알림 접근에 대한 최신 보완

일반 iOS 앱에 다른 앱 알림 전체를 직접 조회하는 범용 권한이 있다고 설계하지 않는다. 다만 Apple의 **iOS 27 Shortcuts 문서에는 앱 및 제목·부제·메시지 조건으로 설정하는 Notification 트리거가 있다.** 따라서 과거 논의의 “알림을 통한 자동화는 전혀 불가능”이라는 단정은 수정해야 한다. [Apple: Event triggers, iOS 27](https://support.apple.com/guide/shortcuts/event-triggers-apd932ff833f/ios)

이 경로는 카카오톡 알림 기반 입력의 **선택적 PoC 후보**다. 한국 기기에서의 지원, 실제 전달되는 본문·식별 정보, 잠금 화면 미리보기 설정, 알림 묶음·누락, OS 버전별 실행을 확인한 뒤 도입한다. 트리거 문서만으로 완전한 대화 수집을 보장할 수는 없다. 과거 대화 조회도 대체하지 못한다.

Accessory Notifications는 별개 기능이다. Apple 문서는 소비자 사용에 EU 내 기기와 EU 지역 Apple Account 조건을 명시하므로 한국 일반 사용자용 기본 경로에서 제외한다. [Apple: Accessory Notifications](https://developer.apple.com/documentation/accessorynotifications)

## 7. Share Extension의 범용 활용

Share Extension은 카카오톡 전용 수집기가 아니라 **사용자가 선택한 정보를 비서에 저장하는 공통 입구**로 만든다. 시스템 공유 화면을 통해 호스트 앱이 전달한 텍스트·URL·첨부파일을 받는다. [Apple: Share extensions](https://developer.apple.com/library/archive/documentation/General/Conceptual/ExtensibilityPG/Share.html)

| 입력 | 사용자 의도 | 처리 예시 |
|---|---|---|
| Safari URL | 이 글 기억하기 | URL·제목 저장, 접근 가능한 본문 요약 |
| 공유 가능한 메모·업무 메시지 | 해야 할 일 저장 | 텍스트 분류·기한 후보 추출 |
| 사진·스크린샷 | 예약·주소 기록 | OCR, 원본과 추출값 대조 |
| PDF·파일 | 문서 내용 검색 | 텍스트 추출, 페이지 단위 출처 연결 |
| 상품·장소 링크 | 나중에 보기 | 관심 항목·장소 분류 |

호스트 앱이 넘겨주는 `NSItemProvider`의 실제 형식을 기준으로 처리한다. URL만 공유되면 로그인된 웹 본문까지 전달받은 것으로 보지 않는다. 크기·형식·개수 제한을 안내하고, 지원하지 않는 입력에는 대체 경로를 제공한다.

확장에서는 미리보기와 저장을 빠르게 완료하고, 긴 OCR·LLM 작업은 후속 처리로 넘긴다. 앱과 확장 간 대기 항목은 App Group 저장 공간으로 공유한다. 로컬 저장 완료와 서버 처리 완료를 별도로 표시한다. [Apple: Configuring app groups](https://developer.apple.com/documentation/xcode/configuring-app-groups)

## 8. AI 처리 파이프라인

아래는 추천 구현 설계이며, 특정 모델의 정확도를 보장하는 설명은 아니다.

### 수집·추출

```text
입력 인증 및 사용자 식별
 → 파일·본문 검증 / 수집 정책 적용
 → 민감정보 제외·마스킹
 → 공통 모델로 정규화
 → 원본 ID·해시·요청 ID로 중복 확인
 → 분류: 일정 / 할 일 / 참고 / 예약 / 기타
 → 날짜·시간·장소·기한·인물 후보 추출
 → JSON 스키마 및 날짜 규칙 검사
 → 원문 근거와 불확실성 저장
 → 필요 시 청크 분할·임베딩
```

“토요일 2시”는 오전·오후가 불명확할 수 있다. 원문 시각과 시간대를 기준으로 후보 날짜를 계산하고, 애매하면 확인을 받는다. “예약이 취소되었습니다”, “금요일에서 월요일로 변경”도 기존 후보와 연결해 반영한다. 단순히 새 일정 하나를 더 생성하지 않는다.

### 질문·답변

```text
질문 → 인증된 사용자 범위 고정 → 날짜·출처 필터
     → 키워드 + 의미 검색 → 관련 근거 선택
     → LLM 답변 → 출처·상태·최신성 표시
```

검색하지 못한 사실은 만들어내지 않는다. “저장한 정보에서는 확인되지 않습니다”와 “일정이 없습니다”를 구분한다. 수집된 메일·웹페이지·대화 안의 지시문은 외부 데이터로 취급하고, 시스템 명령이나 사용자 승인으로 승격시키지 않는다.

### 실행

LLM은 `CreateEvent` 또는 `CreateReminder` 후보를 구조화해 제안한다. 실행 계층이 사용자 의도, 권한, 필수 필드, 중복 여부를 검증하고, 초기 MVP에서는 확인 후 실행한다. 상태는 `proposed → confirmed → queued → succeeded / failed`로 기록한다. “기억하기”와 “캘린더에 등록하기”는 별개 동작이다.

## 9. PostgreSQL + pgvector 저장 구조

PostgreSQL을 정형 데이터의 기준 저장소로 사용하고 pgvector로 의미 검색을 보완한다. 날짜·상태·소유자 필터는 SQL로, “지난번 추천받은 조용한 카페” 같은 표현은 벡터 검색으로 처리한다. pgvector는 PostgreSQL 안에서 벡터 저장 및 정확·근사 최근접 검색을 지원한다. [pgvector 공식 저장소](https://github.com/pgvector/pgvector)

### 논리 테이블 제안

| 테이블 | 주요 필드 | 역할 |
|---|---|---|
| `users` | `id`, `timezone`, `retention_policy` | 사용자 설정 |
| `connections` | `user_id`, `provider`, `account_ref`, `scopes`, `status` | 연결 계정·동의 상태 |
| `sync_states` | `connection_id`, `folder_id`, `cursor`, `last_success_at` | 서비스별 증분 동기화 |
| `assistant_items` | `id`, `user_id`, `source`, `ingestion_method`, `external_id`, `content`, `occurred_at`, `captured_at`, `metadata` | 정규화된 원본 항목 |
| `item_chunks` | `id`, `item_id`, `user_id`, `chunk_index`, `text`, `embedding`, `embedding_model` | 검색용 텍스트·벡터 |
| `extracted_facts` | `item_id`, `kind`, `structured_value`, `evidence`, `status` | AI 추출 후보와 근거 |
| `action_proposals` | `user_id`, `fact_id`, `payload`, `status`, `idempotency_key`, `target_id` | 실행 제안·결과 |
| `attachments` | `item_id`, `storage_key`, `mime_type`, `size`, `expires_at` | 첨부파일 참조·보관 기한 |

OAuth 토큰은 일반 메타데이터와 분리해 암호화 저장한다. 모델 프롬프트·검색 결과·로그에 넣지 않는다.

### 공통 항목 예시

```json
{
  "id": "item-example-001",
  "source": "KAKAO",
  "sourceAttribution": "user_selected",
  "ingestionMethod": "PASTE",
  "externalId": null,
  "sender": null,
  "content": "토요일 오후 2시에 선유도에서 만나자",
  "occurredAt": null,
  "capturedAt": "2026-09-22T10:00:00+09:00",
  "timezone": "Asia/Seoul",
  "itemType": "MESSAGE",
  "status": "UNREVIEWED"
}
```

위 예시에서 출처는 사용자가 선택했고 발신자와 원문 시각은 모른다. 서버는 인증 정보에서 소유자를 결정하며, 클라이언트가 보내는 사용자 ID를 그대로 신뢰하지 않는다.

### 저장·검색 운영 원칙

- 모든 원본·청크·사실·작업에 소유자 경계를 적용한다. 검색 후 화면에서만 타 사용자 데이터를 제거하는 방식은 피한다.
- 앱 쿼리의 사용자 필터와 PostgreSQL RLS를 함께 적용하는 설계를 권장한다. 관리자·백그라운드 작업도 별도 권한을 명확히 한다.
- 원본 ID가 있으면 계정+원본 ID로 멱등 처리한다. 수동 입력은 해시·시간·출처를 중복 후보 판단에 쓰되 동일 문구의 별도 약속을 잘못 합치지 않는다.
- 시간은 `timestamptz`와 원래 시간대를 함께 보관한다. 종일 일정·시간 미정 항목은 별도 표현한다.
- 임베딩 모델·차원·버전을 기록한다. 다른 모델의 벡터를 같은 검색 공간에서 혼용하지 않는다.
- 소규모에서는 단순 검색으로 시작하고 데이터가 늘면 HNSW 등을 검토한다. 근사 검색과 필터 조합은 실제 사용자별 데이터로 검색 누락을 평가한다.
- 한국어 키워드 검색은 PostgreSQL 기본 전문 검색만으로 충분하다고 가정하지 않고 부분 일치·trigram·별도 분석기 필요성을 평가한다.
- 삭제 시 원문, 청크, 벡터, 추출 사실, 캐시와 첨부파일까지 전파한다. 백업 만료 정책도 별도로 둔다.

## 10. 개인정보 처리

### 입력 경로별 데이터 이동

**기기 입력:** Share Extension·Shortcuts·EventKit 데이터는 기기에서 우선 최소화하고, 동의한 필드만 서버로 전송한다.

**서버 메일 Connector:** 메일 제공자에서 서버로 직접 가져오는 경로이므로 “모든 데이터가 iPhone에서 먼저 마스킹된다”고 설명하면 안 된다. 서버의 수집 단계에서 최소화하고, 외부 LLM에 전달하기 전에 추가 필터링한다. 기기 밖에 원문이 나가지 않는 모드가 필요하면 별도 로컬 중심 아키텍처가 필요하다.

### 제품 기본값 제안

- 출처별 수집·서버 저장·외부 AI 처리를 분리해 이해하기 쉽게 안내한다.
- 원문 저장 기간, 첨부파일 수집, 자동 동기화를 사용자가 조정할 수 있게 한다.
- 인증번호·비밀번호는 기본 제외하고 카드번호·계좌번호 등은 최소화한다. 마스킹의 완전성을 보장하지 않는다.
- 의료·금융·타인의 대화는 민감도가 높으므로 필요한 부분만 저장하고 공유 미리보기를 제공한다.
- 전송 구간 암호화, 저장소 암호화, Keychain·서버 키 관리, 사용자별 접근 통제를 적용한다.
- 임베딩과 요약도 개인정보의 파생물로 취급한다. 원문을 지웠다는 이유로 벡터를 무기한 남기지 않는다.
- LLM 공급자의 보관·학습 사용·처리 지역 조건을 확인하고 실제 데이터 흐름에 맞게 안내한다.
- 연결 해제, 데이터 내보내기, 전체 삭제, 처리 이력 조회를 제공한다. 운영 로그에는 본문·토큰을 기본 기록하지 않는다.
- 잠금 화면 알림에는 민감한 본문을 기본 노출하지 않는다.

이 절은 제품·보안 설계 제안이며 법률 준수 판정이 아니다. 실제 서비스 출시 전 개인정보 처리와 국외 처리·위탁 구조를 검토하고, Gmail 등 각 제공자의 데이터 정책과 App Store 요구사항을 별도로 확인한다. Gmail 권한 검증 요건은 [Google 공식 범위 문서](https://developers.google.com/workspace/gmail/api/auth/scopes)를 기준으로 관리한다.

## 11. 실제 사용 예시

예시 기준일은 2026-09-22 화요일, 시간대는 서울이다.

| 입력 | 내용 | 처리 결과 |
|---|---|---|
| 연결된 Gmail | “금요일까지 견적서를 보내주세요.” | 9월 25일 기한의 할 일 후보 |
| 설정한 SMS 자동화 | “내일 오후 3시 병원 예약입니다.” | 9월 23일 15시 일정 후보 |
| 사용자가 전달한 카카오톡 내용 | “토요일 오후 2시에 선유도에서 만나자.” | 9월 26일 14시 일정 후보 |
| EventKit Calendar | 목요일 10시 팀 미팅 | 9월 24일 10시 등록된 일정 |

사용자: “이번 주에 해야 할 일 정리해줘.”

```text
9월 23일 수요일 15:00 — 병원 예약
  문자에서 추출 · 캘린더 등록 전

9월 24일 목요일 10:00 — 팀 미팅
  캘린더에 등록된 일정

9월 25일 금요일까지 — 견적서 발송
  Gmail 요청에서 추출 · 완료 여부 미확인

9월 26일 토요일 14:00 — 선유도 약속
  사용자가 저장한 카카오톡 내용에서 추출 · 확인 필요
```

사용자가 “병원 예약을 캘린더에 추가해줘”라고 하면 날짜·시간·대상 캘린더를 보여주고 확인 후 실행한다. 이후에는 해당 원본과 생성된 이벤트를 연결해 같은 약속을 중복 등록하지 않는다.

장소명이 비슷하거나 시간이 모호하면 추측해서 실행하지 않는다. 데이터 수집이 끊겼다면 마지막 동기화 시각과 확인 가능한 범위를 함께 알린다.

## 12. MVP 1~3단계

### 1단계 — 매일 사용할 수 있는 기본 비서

**구성:** iOS 앱 + Gmail Connector + Calendar/Reminders + 텍스트·URL Share Extension + 붙여넣기 + PostgreSQL + LLM.

- 오늘·이번 주 일정과 저장한 요청을 하나의 보관함에서 확인한다.
- 원문 기반 요약, 기본 검색, 일정·할 일 후보 생성과 확인 후 등록을 제공한다.
- 권한 거부·연결 해제·삭제·오프라인 대기 상태를 처음부터 구현한다.
- Gmail 공개 배포 검증과 비용을 초기에 확인한다. 검증 전 개발자 테스트 범위를 제품 출시 가능 상태와 혼동하지 않는다.
- Outlook은 같은 Connector 인터페이스로 설계하되, 초기 사용자 수요에 따라 이 단계 후반 또는 2단계에 추가한다.

**완료 기준:** 실제 기기에서 공유·붙여넣기한 내용을 다시 찾을 수 있고, 메일에서 추출한 후보를 중복 없이 일정·미리알림으로 등록하며, 권한 철회와 삭제가 정상 반영된다.

### 2단계 — 선택적 자동화와 입력 확장

**구성:** 메시지 Shortcuts + App Intents + Outlook + 이미지/OCR·PDF 입력.

- 사용자가 선택한 문자 조건에 대한 자동화 설정 가이드를 제공한다.
- 잠금·오프라인·재부팅·권한 변경 상황에서 저장 및 재시도 동작을 검증한다.
- 성공 시각과 실패 내역을 보여주되, 알 수 없는 누락 건수를 정확한 값처럼 표시하지 않는다.
- iOS 27 알림 트리거는 별도 PoC로 검증하고 확인된 조합에만 제공한다.

**완료 기준:** 지원하는 OS·기기·입력 조건을 문서화하고, 지원 범위에서 문자 저장과 후속 처리가 재현된다. 카카오톡 직접 공유가 없는 경우에도 붙여넣기로 핵심 흐름을 완료할 수 있다.

### 3단계 — 장기 기억과 능동적 제안

**구성:** pgvector 의미 검색 + 키워드 검색 결합 + 근거가 연결된 장기 기억 + 변경·취소 감지 + 알림.

- “지난번 추천받은 카페”, “아직 처리하지 않은 견적 요청” 같은 검색을 강화한다.
- 사용자가 확인한 사실과 AI 추정을 구분하고 오래된 기억을 갱신·삭제한다.
- 일정 변경·취소와 완료 상태를 반영해 불필요한 알림을 줄인다.
- 알림 시간대·빈도·민감정보 노출을 사용자가 설정한다.
- 일부 OCR·분류·마스킹의 온디바이스 처리를 검토한다.

**완료 기준:** 한국어 실제 사용 질문으로 검색 품질을 평가하고, 다른 사용자 데이터 노출·취소된 일정 재알림·삭제 데이터 재등장·동일 작업 중복 실행을 방지한다.

## 13. 최종 추천 방향

**메일과 EventKit을 안정적인 기반으로 삼고, Share Extension과 붙여넣기를 범용 입력 경로로 제공한 뒤 Shortcuts 자동화를 확장한다.**

1. 메일은 공식 OAuth/API로 연결하고 서버 동기화를 운영한다.
2. Calendar/Reminders는 기기의 EventKit으로 읽고 실행한다.
3. 카카오톡은 사용자가 선택한 내용의 전달을 기본 경험으로 만든다.
4. SMS/iMessage는 조건부 Shortcuts 입력으로 제공하고 전체 문자 동기화라고 표현하지 않는다.
5. 최신 알림 트리거는 기본 기능과 분리해 한국 실기기에서 검증한다.
6. PostgreSQL에 출처·상태·시간·동의를 보관하고 pgvector로 검색을 보완한다.
7. AI의 추출·답변·실행을 분리하고, 실행 성공 여부는 실제 도구 결과로 확정한다.

이 조합은 한국 iOS 환경에서 공식 연결 경로를 중심으로 개발할 수 있는 현실적인 출발점이다. 제품의 신뢰는 수집량보다 **무엇을 알고 있는지, 어디서 얻었는지, 어떤 행동이 실제로 완료되었는지**를 정확하게 보여주는 데서 나온다.
</pasted_content id="c214">
