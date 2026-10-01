# ERURI 검색 후보 컷 · 숫자 어절 · 일정 기간 · 기기 캘린더 표시 · 겹침 확인 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 0.7.0 실기기 피드백 네 가지(거절인데 "보관함에서 보기", 무관 후보, 일정 질문에 기기 캘린더, 추가 때 겹침 확인)를 스펙 §16 "2026-10-01 검색·캘린더 결정"대로 제품에 넣는다 — 서버는 후보 상대 컷·거절 시 빈 후보·숫자 어절 변형 제거·일정 기간 필터와 `schedule` 응답, 앱 0.8.0은 채팅 "기기 캘린더" 절·제안 카드 상태·겹침 확인(앱 안 확인창, 잠금화면은 로컬 알림 유도).

**Architecture:** 서버는 Supabase 호스팅 `eruri`의 `chat` Edge 함수와 `hybrid_search` SQL 함수만 바꾼다. 후보는 `hybrid_search`가 이미 돌려주는 원점수(`sem_sim`·`kw_score`)로 이번 검색 1위 대비 상대 컷을 걸고, 인용 → 구별 조건 facts → 컷 통과 항목 순으로 20개까지, 거절이면 비운다. 필터 LLM이 일정 날짜를 `event_from/to`로 따로 내면 facts(`search_facts`·`fact_when`, 0019)가 그 날짜로 거르고, 일정 질문이면 응답에 `schedule {from,to}`만 싣는다. 앱은 그 기간의 EventKit 일정을 기기 안에서 읽어 답 아래에 보이며(서버·LLM으로 보내지 않음), 겹침 판정은 `AddEventGate`의 기존 ±1일 조회 배열 하나로 같은 직렬 구간 안에서 한다.

**Tech Stack:** Deno 2.x(Edge Functions·테스트·스크립트), `npm:@supabase/supabase-js@2`, `npm:openai@7`(Responses API strict json_schema, `store: false`), OpenAI `gpt-6-luna`·`text-embedding-3-large`(512), Postgres 17 + pgvector, SwiftUI iOS 26 앱 `Eruri` + Swift Package `EruriCore`(XCTest), EventKit·UserNotifications, xcodegen `ios/project.yml`.

**Spec:** `docs/superpowers/specs/2026-09-22-assistant-design.md` — 커밋 `e99f208`에서 이 계획을 위해 고친 절: §9 흐름 그림(필터 `event_range`, facts 기간, 후보·`schedule` 줄), 키워드 항(숫자 어절), "채팅 → 보관함 보기"(후보 정의 교체·거절이면 없음), 새 항 "일정 질문과 기기 캘린더", 구현 항(응답 `candidates`·`schedule`, 필터 스키마), §10 순서 3 "겹침 확인"·제안 리뷰 "겹침 확인 화면", §11 버전·권한 문구, §12 통제 2 "기기 캘린더는 기기에서만", §15 "1단계 추가 범위(검색·캘린더)", §16 "2026-10-01 검색·캘린더 결정"(결정 1~5, UC-4). 근거 검토는 `.context/fable-search-review.md`(요약 표·"먼저 바꿀 3가지"·A~E). 실행 규칙은 `AGENTS.md` §3(모델)·§5-8(실측 게이트)·§6(기계)·§7(개인정보·테스트 데이터)·§8(버전).

**출발점:** main `e99f208`(스펙) 위. 서버는 `0001`~`0022` 적용, `chat`은 R-A1(`5c3567b`, 후보 = 융합 80 전부·최대 100) 배포 상태. 앱은 0.7.1(`1e7f417`, 거절·후보 없음이면 "보관함에서 보기" 숨김). Gmail 게이트 계획이 T0(10-01) ~ ③c2(T0+8일) 측정 중이고, 보관 계획 트랙 B(`2026-10-01-retention-summary.md` R-B1~R-B9)는 ③c2 뒤에 시작한다. M2 검색 평가 ⑩b(U14)는 아직 돌지 않았다(`gates.md`에 행 없음).

**리뷰:** 사용자 지정 절차 — 이 계획 → Codex(gpt-6-astra) 리뷰 → Fable 리뷰 → 서브에이전트 실행(SDD). 실행 방식은 정해져 있으므로 묻지 않는다. 원장은 `.superpowers/sdd/2026-10-01-search-calendar/progress.md`(상위 원장 `.superpowers/sdd/2026-09-30-phase1/progress.md`의 Rulings 승계 — 특히 Ruling M#: 마이그레이션은 다음 빈 번호, Ruling P: 서버·iOS pane 병렬).

**태스크 번호:** 서버 `S1`(후보 컷·거절 비우기) · `S2`(숫자 어절 변형 제거 마이그레이션) · `S3`(일정 기간 필터 → facts, 응답 `schedule`), iOS `C2`(겹침 확인) · `C1`(채팅 기기 캘린더 표시, 0.8.0 업로드·실기기 게이트). **C2를 C1보다 먼저 한다** — C1의 제안 카드 상태가 C2의 겹침 판정 함수를 쓰고, C2(스펙 "먼저 바꿀 3가지" ③)는 서버를 기다리지 않는다.

## Global Constraints

- **시점과 ⑩b:** S1은 `hits`·답변을 바꾸지 않아 평가와 무관하다 — 바로 배포한다. S2·S3은 모델 문서 순위(`hits`)를 바꾸므로 **M2 검색 평가(⑩b) 실행 전에** 둘 다 배포한다(스펙 §15 1단계 추가 범위). 사용자가 ⑩b를 **돌리는 중**이면 S1~S3 배포를 모두 그 뒤로 미룬다(함수 재배포가 평가 호출을 끊는다). ⑩b가 S2·S3보다 먼저 끝났다면 S3 배포 뒤 ⑩b를 다시 돈다(메인이 사용자에게 알린다). 배포 전 메인에게 "⑩b 실행 중 아님"을 확인받는다.
- **Gmail 측정 기간(T0 ~ ③c2):** S2는 `hybrid_search` **정의만** 바꾸고 S1·S3은 함수 코드만 바꾼다 — 실사용자 `items`·`jobs`를 만들거나 바꾸지 않으므로 Gmail 계획 Global Constraints에 걸리지 않는다. `purge_*`는 부르지 않는다.
- **개인정보(AGENTS.md §7, 스펙 §12):** 재현 스크립트(`search-probe.ts`)는 실사용자 코퍼스에 **합성 질문**만 던지고 개수·점수·불리언만 출력한다 — 본문·제목·item id·facts payload를 출력하지 않는다(`hybrid_search`는 id·점수만, `search_facts`는 `select("item_id")`로 id만 받아 세기만). 테스트·스모크는 전용 테스트 사용자(`tests/_testenv.ts`)와 합성 문구만. `console.log`에 질문·후보 id 목록·일정 내용을 넣지 않는다(개수·불리언만). **기기 캘린더 내용(제목·시각·메모)은 기기 밖으로 보내지 않는다** — chat 요청 본문은 `{question}` 그대로, `Trace`·`device_traces`에 일정 없음, `DiagLog`에는 개수만, 잠금화면 겹침 알림에 다른 일정의 제목 없음(스펙 §12 통제 2). 캘린더를 LLM에 넣는 안(UC-4)은 구현하지 않는다.
- **PoC-5 교훈(잠금화면 액션, 스펙 §10):** `NotificationDelegate`의 완료 핸들러는 **모든 경로에서 메인 스레드에서 정확히 1회** 부른다(completion-handler 판, poc5 SIGABRT). ADD 분기 구조를 바꾸지 않고 `Task` 안에서 겹침 알림 등록을 `await`한 뒤 기존 한 곳에서 `done`을 부른다. **5초 마감**: 순서 1 조회 5초(토큰 갱신 포함) + 순서 4 보고 5초 구조는 그대로 — 겹침이면 보고를 건너뛰고 추가되는 일은 네트워크 없는 로컬 알림 등록 1회뿐이다. 확인 → 표식 조회 → 겹침 판정 → 저장 → 기록은 `AddEventGate` actor 메서드 하나 안에서 `await` 없이 한다(동시 두 번 탭 +1).
- **명령:** 저장소 루트에서. 셸 상태가 호출 사이에 남지 않으므로 각 셸 호출 앞에 아래 머리 2줄을 붙인다(이하 `# 머리 2줄`). `.env`를 `source`하지 않는다.

```bash
s() { deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/sql.ts "$@"; }
U="$(grep '^ERURI_USER_ID=' supabase/.env | cut -d= -f2)"
```

- **테스트 명령:** 서버 `deno test --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/tests/<파일>`. 돌리기 전 `pgrep -x xcodebuild`가 비어 있고 `vm_stat | grep -E 'free|compressor'`를 본다(AGENTS.md §6). iOS `cd ios && ./scripts/sim.sh gen && ./scripts/sim.sh test EruriCoreTests/<클래스>`(pane 전용 UDID `ios/.sim-udid`, 돌리기 전 `pgrep -x deno`가 비어 있어야 한다). **시뮬레이터 빌드와 deno 테스트를 동시에 돌리지 않는다.**
- **병렬(Ruling P):** 서버 pane(S1 → S2 → S3, `supabase/**`·`docs/superpowers/phase1/gates.md`의 S행)과 iOS pane(C2 → C1, `ios/**`·gates.md의 C행)은 나란히 해도 된다 — 파일 영역이 겹치지 않는다. 단 위 테스트 명령의 `pgrep` 확인으로 deno와 시뮬레이터를 겹치지 않게 한다. `gates.md`는 두 pane이 각자 다른 행만 추가하고, 겹치면 나중 pane이 rebase한다. C1의 실기기 게이트는 S3 배포 뒤다.
- **`db push`(S2만):** `supabase db push`는 미적용 로컬 마이그레이션을 전부 올린다. push 직전 `git status --short supabase/migrations`와 `ls supabase/migrations | tail -3`으로 **S2 파일 하나만** 새 파일인지 확인한다. 적용된 마이그레이션은 고치지 않는다. 번호는 **다음 빈 번호**(작성 시점 `0023`, Ruling M#) — 보관 계획 트랙 B 예정 번호는 하나씩 밀린다(그 계획 머리에 적었다).
- **모델(AGENTS.md §3):** S1·S2·S3·C2·C1 구현 `opus`/`high`, 리뷰 `opus`/`high`, 실기기 게이트 세션(사용자가 옆에서 조작, 대기 김) `sonnet`/`medium`, 게이트 판정·기록이 섞이면 `opus`/`medium`.
- **버전(AGENTS.md §8):** 서버 태스크는 앱 버전 없음. C2가 `MARKETING_VERSION: 0.8.0`(기능 = 마이너), C1은 그대로. 업로드는 C1 끝에서 한 번(`testflight.sh`, 빌드 번호 `date +%Y%m%d%H%M`). 이후 수정은 0.8.1 식 패치. 요약·저장 공간 화면(보관 계획 R-B9)은 0.9.0. 메이저 금지.
- **iOS 기준 커밋:** C2는 `1e7f417`(0.7.1) 이후 main 최신 위에서 시작하고, 계획의 Swift 코드는 기존 파일에 **더하거나 해당 함수만 바꾸는** 방식이다(파일을 통째로 바꾸지 않는다).
- **기록:** `docs/superpowers/phase1/gates.md`에 행 `S1`·`S2`·`S3`·`C2`·`C1`(상태는 통과·실패·대기만, "부분"은 마감 아님). 커밋 칸은 비우고 메인이 채운다. 재현 수치는 전·후를 같은 행에 적는다.
- **커밋:** 태스크마다. 트레일러 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` / `Claude-Session: https://claude.ai/code/session_01DvGJysHzuAmN368mbby8b7`. **push 금지**(메인이 회수 후 `git push origin main`).

## 이 계획이 기대는 사실 (코드에서 확인, 2026-10-01)

| # | 사실 | 출처 |
|---|---|---|
| F1 | chat: 필터(gpt-6-luna) → `search_facts`(종류·가맹점 조건이 있을 때 상위 5, `occurred_at desc`) → `hybrid_search(p_limit 80)`(기간 0건이면 기간 없이 1회 더) → `dedupe` → 상위 12를 모델에, `hits` = 그 12의 item id. 감사 `read`는 facts + 하이브리드로 읽은 전부 | `chat/handler.ts:80-106`, `chat/deps.ts:46-64` |
| F2 | `hybrid_search`는 `(item_id, chunk_id, score, sem_sim, kw_score)`를 돌려준다. `sem_sim`은 의미 상위 40에 든 행만, `kw_score`는 키워드 상위 40에 든 행만 값이 있고 나머지는 null. `score`는 RRF(`1/(60+rk)`)라 순위만 반영한다 | `0017_chat_read.sql` |
| F3 | 지금 후보 = facts ∪ 융합 80 행의 항목 전부, 최대 100(`CANDIDATE_MAX`) | `handler.ts:69,95`, `deps.ts:55` |
| F4 | 거절(모델·강제)이어도 `candidates`를 그대로 돌려준다. 문서 0건이면 `[]` | `handler.ts:91-103` |
| F5 | 필터 스키마에 일정 날짜 칸이 없다(`date_from/to`는 받은 기간만, Ruling D). `kinds=['event']`만 있으면 `search_facts`가 질문과 무관한 최근 5건을 준다 | `chat/filters.ts`, `0019` |
| F6 | `hybrid_search`의 `variants`는 3자 이상 어절에서 끝 1자, 4자 이상에서 끝 2자를 뗀 부분 문자열(`strpos`)도 맞춘다 → `10월`→`10` | `0017` `variants` CTE |
| F7 | `search_facts(p_from, p_to)`는 event를 `payload.start`, task를 `payload.due`로 거른다(`fact_when`) | `0019_chat_fact_dates.sql` |
| F8 | `AddEventGate.add`는 한 actor 메서드 안에서 기록 확인 → ±1일 이벤트 조회 → 표식 복구 → 저장(1시간) → 기록, `await` 없음. 반환 `ok`·`recovered`·`dup`·`fail:<코드>` | `ios/App/NotificationActions.swift:85-113` |
| F9 | `handleAdd`는 순서 1 조회 5초 → gate → `fail` 아니면 이 제안만 보고 5초. 알림 액션·채팅 카드·제안 시트·제안 탭이 모두 이 함수를 쓴다 | `NotificationActions.swift:26-46`, `ChatView.swift:123`, `ProposalsView.swift:145` |
| F10 | `NotificationDelegate`는 completion-handler 판이고 ADD·IGNORE·배너 탭 모든 경로에서 `DispatchQueue.main.async { done.value() }` 1회. 배너 탭은 `ProposalReview.link`(카테고리 3종·UUID)로 `ProposalRouter.open` → 루트가 `ProposalSheet` | `NotificationActions.swift:118-162`, `EruriApp.swift:53` |
| F11 | `ProposalReview.sheet(for:list:)`: 목록에 있으면 `.pending`, 카테고리가 `ADD_EVENT`가 아니면 `.needsReview`, 목록 조회 실패면 `.offline(푸시 값)` | `EruriCore/ProposalReview.swift:57-64` |
| F12 | `ChatReply.Answer`는 합성 `Decodable` — 새 필드는 옵셔널이어야 옛 서버 응답도 읽는다. 0.7.1 `archiveIDs`는 거절·빈 후보면 nil | `EruriCore/ChatReply.swift` |
| F13 | `NSCalendarsFullAccessUsageDescription` = "제안된 일정을 캘린더에 추가합니다." 앱은 이미 전체 접근을 요청한다(`CalendarAccessSection`) | `ios/App/Info.plist:19`, `ProposalsView.swift:169-186` |
| F14 | `eval-search.ts`는 `hits`만 쓴다(후보·`schedule` 무관) | `supabase/scripts/eval-search.ts` |
| F15 | 마이그레이션은 `0022`까지 적용. 다음 빈 번호 `0023` | `supabase/migrations/` |
| F16 | `send-phrases.ts --only push`는 `[합성의원] D+3(요일) 오후 3시 30분 진료 예약` 문구를 Slack으로 보내 제안 푸시를 만든다(M1-②d 게이트 B 방식) | `supabase/eval/phrases.ts:27`, `supabase/scripts/_phrase-sender.ts` |

### 재현 기준선 (Fable, 2026-10-01, 제품 코퍼스: 청크가 있는 항목 25, 활성 event fact 7)

| 합성 질문 | 후보 항목 | 키워드 일치 청크 | 의미 1위 / 5위 / 12위 | 상위 12 구성 |
|---|---|---|---|---|
| 내일 치과 예약 몇 시야 | 25/25 | 4 | 0.552 / 0.376 / 0.234 | 둘 다 4, 의미만 8 |
| 10월 3일 일정 있어? | 25/25 | 11 | 0.521 / 0.416 / 0.309 | 둘 다 11, 의미만 1 |
| 이번 주 토요일 약속 뭐 있지 | 25/25 | 0 | 0.524 / 0.357 / 0.307 | 의미만 12 |
| 다음 주 회의 언제야 | 25/25 | 0 | 0.527 / 0.387 / 0.313 | 의미만 12 |
| 화성 탐사선 발사 일정(무근거) | 25/25 | 0 | 0.443 / 0.364 / 0.324 | 의미만 12 |
| 쿠팡에서 산 거 얼마였지(무근거) | 25/25 | 0 | 0.368 / 0.276 / 0.218 | 의미만 12 |

코퍼스는 Gmail 백필로 커진다. 게이트는 이 표가 아니라 **같은 시각에 잰 전·후**(S1은 한 실행 안의 두 규칙, S2는 `db push` 직전·직후)로 판정한다.

## Review Focus

1. **미리 판정 뒤 캘린더가 바뀐다**: 시트가 "겹침 없음"으로 뜬 뒤 사용자가 캘린더 앱에서 같은 시각 일정을 넣고 돌아와 "캘린더에 추가"를 누른다. 사람은 조용히 겹쳐 저장되는 것이 아니라 확인창을 기대한다 → 최종 판정은 `AddEventGate`가 다시 하고, 화면은 `conflict:` 결과를 받으면 다시 읽고 같은 확인창을 띄운다(C2 순수 테스트 `testConflictOutcomeAndCopy`의 `conflictCount` 해석 + C2 실기기 게이트 단계 5 "시트 연 채 캘린더 앱에서 일정 추가 → 돌아와 추가 → 확인창").
2. **겹침이 아닌 것을 겹침으로 센다**: 앞뒤로 맞닿은 일정(14:00–15:00 뒤 15:00 시작), 종일 일정(생일·휴가), 취소된 일정, 이 제안이 넣은 일정(표식)은 겹침이 아니어야 잠금화면 한 번 탭 추가가 살아 있다 → `ProposalFlow.conflicts` 제외 규칙(C2 `testConflicts`: 맞닿음 2·종일·취소·같은 표식 제외, 다른 제안 표식은 겹침).
3. **조사가 붙은 날짜 어절이 키워드 일치를 잃는다**: `10월에`·`3일에`는 사람이 흔히 쓰는 형태다. 숫자 어절 변형을 통째로 막으면 `10월에`가 본문의 `10월`에 맞지 않는다 → 숫자로 끝나는 변형만 막고 `10월에`→`10월`은 남긴다(S2 테스트 `numeric tokens … Hangul particles still drop`의 `10월에` 단언).
4. **필터 LLM이 이상한 일정 범위를 낸다**: `2026-02-30`, 거꾸로 된 범위, 한쪽만, "올해 일정" 같은 1년 범위. 사람은 오류(500)나 앱이 1년치 캘린더를 읽어 멈추는 것을 기대하지 않는다 → 달력에 없는 날짜·거꾸로 된 범위는 null, `schedule`은 양 끝·31일 이하·`kinds ∋ event`일 때만(S3 `normalizeFilters: event dates …`·`scheduleOf: …` 테스트). 앱은 31일 이하 구간만 받는다.
5. **거절·문서 0건 답에서 캘린더가 사라진다**: "10월 7일 일정 있어?"인데 메일에 없으면 서버는 거절한다. 사람은 캘린더에 있는 일정은 보이기를 기대한다 → `schedule`은 거절·문서 0건이어도 싣고(S3 `answerQuestion: schedule rides along even when refused …`), 앱은 거절 문구 대신 "저장된 메일·문자에는 없고, 캘린더에 N건 있습니다"를 보인다(C1 `testRefusalText`, C1 실기기 게이트 단계 3). 거절이면 후보는 비운다(S1 `candidates: refused …`).

---

## 파일 구조

```
supabase/functions/chat/handler.ts        # S1 ScoredRow·relevantItems·factsDistinct·pickCandidates·CANDIDATE_MAX 20 / S3 ChatResult.schedule
supabase/functions/chat/deps.ts           # S1 search → relevantItems / S3 facts → factRange
supabase/functions/chat/filters.ts        # S3 event_from/to·normalize·factRange·scheduleOf·요일
supabase/migrations/0023_hybrid_numeric_tokens.sql   # S2 (다음 빈 번호)
supabase/scripts/search-probe.ts          # S1 생성(합성 질문 6개, 개수·점수만) / S3 --filters
supabase/scripts/smoke-chat.ts            # S1 컷·거절 / S3 schedule
supabase/tests/chat.test.ts               # S1·S3
supabase/tests/chat-db.test.ts            # S1(컷 DB)·S3(facts 일정 기간)
supabase/tests/search.test.ts             # S2
ios/Packages/EruriCore/Sources/EruriCore/ProposalFlow.swift     # C2 CalendarEvent·conflicts·conflict 결과·문구
ios/Packages/EruriCore/Sources/EruriCore/ProposalReview.swift   # C2 conflictCategory
ios/Packages/EruriCore/Sources/EruriCore/ChatReply.swift        # C2 addFeedback conflict / C1 Schedule
ios/Packages/EruriCore/Sources/EruriCore/DeviceCalendar.swift   # C1 생성(절 문구·거절 대체·카드 상태)
ios/Packages/EruriCore/Tests/EruriCoreTests/ProposalFlowTests.swift     # C2
ios/Packages/EruriCore/Tests/EruriCoreTests/ProposalReviewTests.swift   # C2
ios/Packages/EruriCore/Tests/EruriCoreTests/ChatReplyTests.swift        # C2·C1
ios/Packages/EruriCore/Tests/EruriCoreTests/DeviceCalendarTests.swift   # C1 생성
ios/App/CalendarLookup.swift              # C2 생성(EventKit → CalendarEvent, 겹침 미리 판정) / C1 기간 일정·카드 상태
ios/App/NotificationActions.swift         # C2 카테고리·handleAdd(confirmed)·conflictNotice·AddEventGate·델리게이트 ADD
ios/App/ProposalsView.swift               # C2 ProposalActionsView 겹침 / C1 CalendarAccessPrompt
ios/App/ChatView.swift                    # C2 카드 확인창 / C1 기기 캘린더 절·카드 상태·거절 대체
ios/App/Info.plist                        # C1 캘린더 권한 문구
ios/project.yml                           # C2 0.8.0
docs/superpowers/phase1/gates.md          # 행 S1·S2·S3·C2·C1
```

## 실행 순서

| 순서 | 태스크 | 반영 | 선행 | pane |
|---|---|---|---|---|
| 1 | S1 후보 컷·거절 비우기 | `chat` 배포 | 스펙 `e99f208`, ⑩b 실행 중 아님 | 서버 |
| 2 | S2 숫자 어절 변형 제거 | `db push` 0023 | S1(재현 스크립트), ⑩b 전 | 서버 |
| 3 | S3 일정 기간 필터·`schedule` | `chat` 배포 | S2, ⑩b 전 | 서버 |
| 4 | C2 겹침 확인(0.8.0) | — | 스펙 | iOS(서버와 병렬 가능) |
| 5 | C1 기기 캘린더 표시 + 0.8.0 업로드 + 실기기 게이트(C2·C1) | TestFlight | C2, 게이트는 S3 배포 뒤 | iOS → 실기기 |

---

### Task S1: 후보 = 인용 ∪ 구별 facts ∪ 상대 컷, 최대 20 · 거절이면 비움

**Files:**
- Modify: `supabase/functions/chat/handler.ts` (타입 `ScoredRow`, 상수 `CANDIDATE_MAX`·`KW_CUT`·`SEM_CUT`, 함수 `relevantItems`·`factsDistinct`·`pickCandidates`, `answerOnce`)
- Modify: `supabase/functions/chat/deps.ts` (`search`의 `candidates`, import, 머리 주석)
- Create: `supabase/scripts/search-probe.ts`
- Modify: `supabase/scripts/smoke-chat.ts` (전체 교체)
- Test: `supabase/tests/chat.test.ts`, `supabase/tests/chat-db.test.ts`
- Docs: `docs/superpowers/phase1/gates.md` 행 `S1`

**Interfaces:**
- Consumes: `hybrid_search(...)` → `(item_id, chunk_id, score, sem_sim, kw_score)`(0017, 변경 없음). `SearchResult = { docs: ChatHit[]; candidates: string[] }`(R-A1).
- Produces: `export type ScoredRow = { item_id: string; sem_sim: number | null; kw_score: number | null }`; `export const CANDIDATE_MAX = 20`, `KW_CUT = 0.5`, `SEM_CUT = 0.85`; `export function relevantItems(rows: ScoredRow[]): string[]`(컷 통과 항목, 순위순·중복 없음); `export function factsDistinct(f: Filters): boolean`(S3가 본문을 바꾼다); `export function pickCandidates(o: { refused: boolean; cited: string[]; facts: string[]; searched: string[] }): string[]`. `SearchResult.candidates`의 뜻이 "융합 80 전부" → "컷 통과 항목"으로 바뀐다(타입 같음). `POST /chat`의 `candidates`는 ≤ 20, 거절이면 `[]`. 스크립트 `supabase/scripts/search-probe.ts`(질문 목록 `PROBE_QUESTIONS`, 옵션 `--user`·`--label`)를 S2가 전·후 비교에, S3가 `--filters` 추가에 쓴다. 보관 계획 R-B4의 `deps.search` 교체본이 `relevantItems`를 쓴다(그 계획에 적었다).

- [ ] **Step 1: 실패하는 테스트**

`supabase/tests/chat.test.ts` 머리 import의 handler 줄에 `relevantItems`를 더한다:

```ts
import { answerQuestion, type ChatDeps, type ChatHit, type Filters, formatDocuments, handleChat, REFUSAL, relevantItems, validateAnswer } from "../functions/chat/handler.ts";
```

같은 파일에서 R-A1 테스트 두 개 — `"candidates: facts first, then the whole fused list (beyond the 12 documents), deduped, capped at 100"`와 `"candidates: model refusal still returns them; nothing found → empty"` — 를 **지우고** 그 자리에 아래를 넣는다(`"candidates follow the date-fallback search …"`·`"POST /chat returns candidates next to hits"`는 그대로 둔다 — 기본 답변이 `i1`을 인용하므로 기대값이 바뀌지 않는다):

```ts
// 스펙 §9(2026-10-01 검색·캘린더 결정): 상대 컷 — 키워드 1위 × 0.5 또는 의미 1위 × 0.85 이상, 순위순·항목당 한 번. 각 경로의 1위는 늘 통과
Deno.test("relevantItems: keeps rows within 0.5× the keyword top or 0.85× the semantic top, in rank order, one per item", () => {
  const rows = [
    { item_id: "a", sem_sim: 0.55, kw_score: null }, { item_id: "b", sem_sim: 0.48, kw_score: null },
    { item_id: "c", sem_sim: 0.40, kw_score: 2.0 }, { item_id: "d", sem_sim: null, kw_score: 0.9 },
    { item_id: "a", sem_sim: 0.50, kw_score: null }, { item_id: "e", sem_sim: 0.30, kw_score: 1.0 },
  ];
  assertEquals(relevantItems(rows), ["a", "b", "c", "e"]);                   // b 0.48 ≥ 0.4675, d 0.9 < 1.0, e 1.0 ≥ 1.0
  assertEquals(relevantItems([]), []);
  assertEquals(relevantItems([{ item_id: "x", sem_sim: null, kw_score: null }]), []);
  assertEquals(relevantItems([{ item_id: "k", sem_sim: null, kw_score: 0.3 }, { item_id: "s", sem_sim: 0.2, kw_score: null }]), ["k", "s"]);
});

// 후보 순서 = 인용 → 구별 조건(가맹점·기간) facts → 컷 통과 검색 항목, 중복 제거, 20개. 모델 문서(hits)는 그대로
Deno.test("candidates: cited first, then merchant/date facts, then the cut search items; deduped, capped at 20", async () => {
  const many = Array.from({ length: 30 }, (_, i) => `c${i}`);
  const { d } = deps({ facts: [{ item_id: "f1", occurred_at: "2026-08-12T04:02:00Z", text: "[purchase] 합성상점 12,900원" }],
    filters: { kinds: ["purchase"], merchant: "합성상점" }, candidates: [["i2", "f1", "i1", ...many]] });
  const r = await answerQuestion("user-1", "합성상점에서 산 거", d);
  assertEquals(r.candidates.slice(0, 4), ["i1", "f1", "i2", "c0"]);
  assertEquals(r.candidates.length, 20);
  assertEquals(r.hits, ["f1", "i1", "i2"]);
});

// kinds 만으로 나온 facts("최근 5건")는 모델 문서로는 넣되 후보에서는 뺀다(재현: 합성 의원 예약이 일정 질문마다 후보 1~5위)
Deno.test("candidates: facts found by kind alone stay model documents but are not candidates", async () => {
  const { d, seen } = deps({ facts: [{ item_id: "f9", occurred_at: "2026-09-28T00:00:00Z", text: "[event] 합성의원 예약" }],
    filters: { kinds: ["event"] }, candidates: [["i1"]] });
  const r = await answerQuestion("user-1", "다음 주 회의 언제야", d);
  assertEquals(seen.answer[0].docs, ["f9", "i1", "i2"]);
  assertEquals(r.candidates, ["i1"]);
});

// 거절(모델·강제)이면 후보 없음 → 앱 버튼 없음(0.7.x 앱도 빈 배열이면 숨긴다). 문서 0건도 없음
Deno.test("candidates: refused (model or forced) → none; nothing found → none", async () => {
  const model = await answerQuestion("user-1", "여권 만료일", deps({ raw: { answer: "", source_item_ids: [], refused: true } }).d);
  assertEquals([model.refused, model.candidates], [true, []]);
  const forced = await answerQuestion("user-1", "여권 만료일", deps({ raw: { answer: "뭔가", source_item_ids: ["ghost"], refused: false } }).d);
  assertEquals([forced.refused, forced.candidates], [true, []]);
  const none = await answerQuestion("user-1", "여권 만료일", deps({ hits: [] }).d);
  assertEquals([none.refused, none.candidates], [true, []]);
});
```

`supabase/tests/chat-db.test.ts`에서 R-A1 테스트 `"chatDeps.search: documents ≤ 12, candidates = every item of the fused list in rank order"`를 **지우고** 아래로 바꾼다(두 어절을 다 가진 3건과 한 어절만 가진 12건. IDF: 합성어 A는 3건에만 있어 크고, B는 15건 모두에 있어 거의 0 → 약한 12건은 1위의 0.5배 미만. 청크에 임베딩이 없어 의미 경로는 비어 있다):

```ts
// 2026-10-01 검색·캘린더 S1: 후보 = 관련도 컷을 통과한 융합 행. 두 어절을 다 가진 3건만 남고 한 어절만 가진 12건은 빠진다
Deno.test("chatDeps.search: documents ≤ 12 from the fused list; candidates keep only rows within the relative cut", async () => {
  const strong: string[] = [], weak: string[] = [];
  try {
    for (let i = 0; i < 3; i++) {
      const id = await seed("SHARE", `cut-s${i}`, `합성 컷 ${i}`, `알파합성어 베타합성어 ${i}`);
      strong.push(id);
      assertEquals((await sb.from("item_chunks").insert({ item_id: id, user_id: USER, chunk_index: 0, text: `알파합성어 베타합성어 ${i}` })).error, null);
    }
    for (let i = 0; i < 12; i++) {
      const id = await seed("SHARE", `cut-w${i}`, `합성 컷 약 ${i}`, `베타합성어 ${i}`);
      weak.push(id);
      assertEquals((await sb.from("item_chunks").insert({ item_id: id, user_id: USER, chunk_index: 0, text: `베타합성어 ${i}` })).error, null);
    }
    const s = await chatDeps(sb).search(USER, { question: "알파합성어 베타합성어", from: null, to: null, sources: [] });
    assert(s.docs.length <= 12);
    assertEquals(new Set(s.candidates), new Set(strong));
    assert(weak.every((id) => !s.candidates.includes(id)));
  } finally {
    await sb.from("items").delete().eq("user_id", USER).in("id", [...strong, ...weak]);   // chunks cascade
  }
});
```

- [ ] **Step 2: 실패 확인**

Run: `pgrep -x xcodebuild; vm_stat | grep -E 'free|compressor'; deno test --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/tests/chat.test.ts supabase/tests/chat-db.test.ts`
Expected: FAIL — `relevantItems` 없음(타입 검사 오류), 새 DB 테스트는 약한 12건이 후보에 있어 실패.

- [ ] **Step 3: handler.ts**

`supabase/functions/chat/handler.ts`:

(1) 타입 줄(`export type SearchResult …` 아래)에 더한다:

```ts
// hybrid_search 행의 원점수(0017). RRF score 는 순위만 반영해 관련도 컷에 못 쓴다
export type ScoredRow = { item_id: string; sem_sim: number | null; kw_score: number | null };
```

(2) `// "보관함에서 보기" 후보 상한 …` 주석과 `export const CANDIDATE_MAX = 100;` 두 줄을 아래로 바꾼다:

```ts
// "보관함에서 보기" 후보(스펙 §9, 2026-10-01 검색·캘린더 결정): 인용 → 구별 조건 facts → 관련도 컷 통과 항목, 최대 20. 거절이면 없음
export const CANDIDATE_MAX = 20;
// 상대 컷: 이번 검색의 키워드 1위 × 0.5 또는 의미 유사도 1위 × 0.85 이상. 25항목 코퍼스·합성 질문 6개로 잡은 값 — 코퍼스가 커지면 S1 게이트에서 한 번 조정
export const KW_CUT = 0.5;
export const SEM_CUT = 0.85;
```

(3) `function dedupe` 위에 더한다:

```ts
// 융합 행 중 관련도 컷을 통과한 항목(순위순, 항목당 한 번). 각 경로의 1위는 늘 통과한다
export function relevantItems(rows: ScoredRow[]): string[] {
  const top = (k: "sem_sim" | "kw_score") => Math.max(0, ...rows.map((r) => r[k] ?? 0));
  const kwTop = top("kw_score"), semTop = top("sem_sim");
  const pass = (r: ScoredRow) => (kwTop > 0 && (r.kw_score ?? 0) >= KW_CUT * kwTop) || (semTop > 0 && (r.sem_sim ?? 0) >= SEM_CUT * semTop);
  return [...new Set(rows.filter(pass).map((r) => r.item_id))];
}

// facts 가 후보가 되는 것은 가맹점·기간처럼 대상을 가려내는 조건으로 나왔을 때뿐. 종류만으로 나온 "최근 5건"은 모델 문서로만 쓴다
export function factsDistinct(f: Filters): boolean {
  return f.merchant !== null || f.date_from !== null || f.date_to !== null;
}

// 불변식: 인용 ⊆ 후보 ⊆ facts ∪ 융합 80, 거절 ⇒ 후보 없음
export function pickCandidates(o: { refused: boolean; cited: string[]; facts: string[]; searched: string[] }): string[] {
  return o.refused ? [] : [...new Set([...o.cited, ...o.facts, ...o.searched])].slice(0, CANDIDATE_MAX);
}
```

(4) `answerOnce`에서 `const candidates = [...new Set([...factDocs.map((d) => d.item_id), ...s.candidates])].slice(0, CANDIDATE_MAX);` 줄을 **지우고**, `const v = validateAnswer(raw, docs);` 바로 아래에 넣는다:

```ts
    const candidates = pickCandidates({ refused: v.refused, cited: v.source_item_ids,
      facts: factsDistinct(filters) ? factDocs.map((d) => d.item_id) : [], searched: s.candidates });
```

(5) 파일 머리 주석 둘째 줄 끝 `→ 출처 메타·제안 카드.` 를 `→ 출처 메타·제안 카드·보관함 후보(인용 ∪ 구별 facts ∪ 관련도 컷, 거절이면 없음).`로 바꾼다.

- [ ] **Step 4: deps.ts**

`supabase/functions/chat/deps.ts`:

import 줄을 바꾼다:

```ts
import { ANSWER_SCHEMA, type ChatDeps, type ChatHit, formatDocuments, type Meta, type ProposalCard, type RawAnswer, relevantItems, type ScoredRow,
  type SearchResult, SYSTEM_PROMPT } from "./handler.ts";
```

머리 주석 `// 모델 문서는 지금처럼 상위 12 청크. "보관함에서 보기" 후보는 같은 한 번의 검색에서 융합 목록 전체(의미 40 ∪ 키워드 40, 스펙 §9)` 를 아래로:

```ts
// 모델 문서는 상위 12 청크. "보관함에서 보기" 후보는 같은 한 번의 검색의 융합 목록(의미 40 ∪ 키워드 40) 중 관련도 컷을 통과한 행(스펙 §9)
```

`search`의 두 줄을 바꾼다:

```ts
      const rows = (await rpc("hybrid_search", { p_user: u, p_query: q.question, p_embedding: toPgVector(v), p_limit: CANDIDATE_CHUNKS,
        p_from: q.from, p_to: q.to, p_sources: q.sources.length ? q.sources : null })) as (ScoredRow & { chunk_id: string })[];
      const candidates = relevantItems(rows);
```

- [ ] **Step 5: 통과 확인**

Run: `deno check supabase/functions/chat/index.ts && deno test --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/tests/chat.test.ts supabase/tests/chat-db.test.ts`
Expected: PASS. 이어서 전체 `deno test --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/tests/` 0 실패.

- [ ] **Step 6: 재현 스크립트**

Create `supabase/scripts/search-probe.ts`:

```ts
// 검색 후보·순위 재현(스펙 §9, §16 2026-10-01 검색·캘린더 결정). 합성 질문 6개를 사용자 코퍼스에 던져 개수·점수만 낸다.
// 출력에 본문·제목·item id 없음(AGENTS.md §7): hybrid_search 는 id·점수만 돌려주고 여기서도 id 는 세기만 한다. 질의 임베딩 6건(1원 미만)
// cand_old = R-A1 규칙(융합 80 의 항목 전부, ≤ 100), cand_cut = S1 상대 컷(인용·facts 를 더하기 전, ≤ 20)
// 사용: deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/search-probe.ts [--user <uuid>] [--label <이름>]
import { createClient } from "npm:@supabase/supabase-js@2";
import { SERVER_AUTH } from "../functions/_shared/crypto.ts";
import { embed, toPgVector } from "../functions/_shared/embeddings.ts";
import { CANDIDATE_CHUNKS, DOC_CHUNKS } from "../functions/chat/deps.ts";
import { CANDIDATE_MAX, relevantItems, type ScoredRow } from "../functions/chat/handler.ts";

const PROBE_QUESTIONS = ["내일 치과 예약 몇 시야", "10월 3일 일정 있어?", "이번 주 토요일 약속 뭐 있지", "다음 주 회의 언제야",
  "화성 탐사선 발사 일정", "쿠팡에서 산 거 얼마였지"];

const arg = (k: string) => { const i = Deno.args.indexOf(k); return i >= 0 ? Deno.args[i + 1] : undefined; };
const user = arg("--user") ?? Deno.env.get("ERURI_USER_ID");
if (!user) { console.error("ERURI_USER_ID 없음"); Deno.exit(2); }
const label = arg("--label") ?? "run";
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, SERVER_AUTH);
const vectors = await embed(PROBE_QUESTIONS, "query");
const r3 = (x: number | undefined) => (x === undefined ? null : Math.round(x * 1000) / 1000);

for (const [i, question] of PROBE_QUESTIONS.entries()) {
  const { data, error } = await sb.rpc("hybrid_search", { p_user: user, p_query: question, p_embedding: toPgVector(vectors[i]),
    p_limit: CANDIDATE_CHUNKS, p_from: null, p_to: null, p_sources: null });
  if (error) throw new Error("hybrid_search " + error.code);
  const rows = data as ScoredRow[];
  const sims = rows.flatMap((r) => (r.sem_sim === null ? [] : [r.sem_sim])).sort((a, b) => b - a);
  const top = rows.slice(0, DOC_CHUNKS);
  const items = new Set(rows.map((r) => r.item_id)).size;
  console.log(JSON.stringify({ label, q: i + 1, question, items, kw_chunks: rows.filter((r) => r.kw_score !== null).length,
    sem_at_1_5_12: [r3(sims[0]), r3(sims[4]), r3(sims[11])],
    top12: { both: top.filter((r) => r.sem_sim !== null && r.kw_score !== null).length,
      sem_only: top.filter((r) => r.kw_score === null).length, kw_only: top.filter((r) => r.sem_sim === null).length },
    cand_old: Math.min(items, 100), cand_cut: Math.min(relevantItems(rows).length, CANDIDATE_MAX) }));
}
```

Run: `deno check supabase/scripts/search-probe.ts`
Expected: 오류 0.

- [ ] **Step 7: 스모크 교체**

Replace `supabase/scripts/smoke-chat.ts` 전체:

```ts
// 배포된 chat 의 후보(스펙 §9, 2026-10-01 검색·캘린더 S1) 스모크. 전용 테스트 사용자·합성 문구만, 출력은 상태·개수·불리언만(AGENTS.md §7)
// 근거 있는 질문: 답함·후보 ≤ 20·인용 ⊆ 후보·근거 3건 모두 후보·무관 12건은 후보 아님. 근거 없는 질문: 거절·후보 0
// 사용: deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/smoke-chat.ts
import { encrypt, toBytea } from "../functions/_shared/crypto.ts";
import { RUN, service as sb, userClient } from "../tests/_testenv.ts";

type Reply = { refused: boolean; candidates?: string[]; source_item_ids?: string[]; schedule?: { from: string; to: string } | null };
const { u, c } = await userClient();
const ids: string[] = [], relevant: string[] = [];
async function add(tag: string, title: string, text: string): Promise<string> {
  const { data: id, error } = await sb.rpc("insert_item", { p_user: u.id, p_source: "SHARE", p_idempotency_key: `${RUN}:smokechat:${tag}`,
    p_sender: null, p_title: title, p_content_enc: toBytea(await encrypt(u.id, text)), p_occurred_at: new Date().toISOString(), p_enqueue: false });
  if (error) throw new Error("insert_item " + error.code);
  ids.push(id as string);
  const up = await sb.from("items").update({ status: "extracted" }).eq("user_id", u.id).eq("id", id);
  if (up.error) throw new Error("items " + up.error.code);
  const ch = await sb.from("item_chunks").insert({ item_id: id, user_id: u.id, chunk_index: 0, text: `${title}\n${text}` });
  if (ch.error) throw new Error("item_chunks " + ch.error.code);
  return id as string;
}
try {
  for (let i = 0; i < 3; i++) {
    relevant.push(await add(`r${i}`, `합성스모크치과 안내 ${i}`, `합성스모크치과 스케일링 예약이 ${10 + i}월 ${3 + i}일 오후 ${2 + i}시로 확정되었습니다`));
  }
  for (let i = 0; i < 12; i++) await add(`n${i}`, `스모크잡담 ${i}`, `스모크잡담 오늘 날씨 맑음 ${i}`);
  const { data: sess } = await c.auth.getSession();
  const ask = async (question: string) => {
    const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/chat`, { method: "POST",
      headers: { authorization: `Bearer ${sess.session!.access_token}`, apikey: Deno.env.get("SUPABASE_ANON_KEY")!, "content-type": "application/json" },
      body: JSON.stringify({ question }) });
    return { status: r.status, j: (await r.json()) as Reply };
  };
  const a = await ask("합성스모크치과 스케일링 예약 언제야");
  const ac = a.j.candidates ?? [];
  const b = await ask("합성스모크치과 화성 탐사선 발사 일정");
  console.log(JSON.stringify({
    answered: { status: a.status, refused: a.j.refused, candidates: ac.length, relevant: relevant.filter((id) => ac.includes(id)).length,
      noise: ac.filter((id) => !relevant.includes(id)).length, cited_subset: (a.j.source_item_ids ?? []).every((id) => ac.includes(id)) },
    unanswered: { status: b.status, refused: b.j.refused, candidates: (b.j.candidates ?? []).length },
  }));
} finally {
  await sb.from("items").delete().eq("user_id", u.id).in("id", ids);                  // chunks cascade
  await sb.from("usage_counters").delete().eq("user_id", u.id);
  await sb.from("llm_slots").delete().eq("user_id", u.id);
}
```

Run: `deno check supabase/scripts/smoke-chat.ts`
Expected: 오류 0.

- [ ] **Step 8: 코드 커밋**

```bash
git add supabase/functions/chat/handler.ts supabase/functions/chat/deps.ts supabase/scripts/search-probe.ts supabase/scripts/smoke-chat.ts supabase/tests/chat.test.ts supabase/tests/chat-db.test.ts
git commit -m "feat(chat): archive candidates = citations, distinct facts and a relative relevance cut (≤20); none on refusal (S1)"
```

- [ ] **Step 9: 배포 + 실측 게이트**

메인에게 "⑩b 실행 중 아님"을 확인받은 뒤:

```bash
# 머리 2줄
deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/search-probe.ts --label s1
supabase functions deploy chat
deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/smoke-chat.ts
```

통과 기준:
1. **재현(전·후)**: `search-probe` 6줄의 `cand_old`(R-A1 규칙) 대비 `cand_cut`(S1 규칙). 근거 있는 일정 질문 q1~q4는 `cand_old`가 20을 넘으면 `cand_cut < cand_old`이고 `cand_cut ≤ 20`. 6줄을 그대로 `gates.md`에 적는다. **조정 규칙(1회)**: q1~q4 중 3개 이상이 `cand_cut = 20`(포화)이면 `KW_CUT 0.6`·`SEM_CUT 0.9`로 올려 Step 5 테스트(기대값의 경계 숫자도 같이)를 다시 통과시키고 재측정·재배포한다. 그래도 포화면 조정하지 않고 수치만 적어 메인에게 알린다.
2. **스모크**: `answered` = `status 200`·`refused false`·`candidates ≤ 20`·`relevant 3`·`noise 0`·`cited_subset true`, `unanswered` = `status 200`·`refused true`·`candidates 0`. `unanswered.refused`가 false면(모델이 답함) 한 번 더 돌리고, 두 번 다 false면 실패로 적고 메인에게 알린다(거절 품질 문제 — S1 범위 밖).
3. **실기기(사용자, 앱 0.7.1 그대로)**: 채팅에서 "내일 치과 예약 몇 시야"·"10월 3일 일정 있어?"를 묻고 답이 거절이 아니면 "보관함에서 보기 (N건)"의 N(≤ 20)과 목록에서 질문과 무관한 항목 수를 사용자가 센다(개수만 받는다). "화성 탐사선 발사 일정"은 거절 + 버튼 없음. 기준: N ≤ 20, 무관 ≤ 2. 거절 답이면 N 없음으로 적는다.

- [ ] **Step 10: 기록 커밋**

`docs/superpowers/phase1/gates.md` 표 끝에 행 `S1`(게이트 = 위 1~3, 상태, 근거 = 배포 시각·probe 6줄·smoke 출력·실기기 N/무관 수, 커밋 칸 비움, 날짜).

```bash
git add docs/superpowers/phase1/gates.md
git commit -m "docs(gates): S1 chat candidates cut deployed — probe before/after, smoke, device check"
```

---

### Task S2: 숫자 어절은 숫자로 끝나는 변형을 만들지 않는다

**Files:**
- Create: `supabase/migrations/0023_hybrid_numeric_tokens.sql` (번호는 다음 빈 번호 — 먼저 `ls supabase/migrations | tail -1`로 확인하고 파일 이름·아래 명령의 번호를 실제 값으로)
- Test: `supabase/tests/search.test.ts`
- Docs: `docs/superpowers/phase1/gates.md` 행 `S2`

**Interfaces:**
- Consumes: 0017 `hybrid_search` 본문(인자·반환 동일), S1 `search-probe.ts`.
- Produces: `hybrid_search(p_user uuid, p_query text, p_embedding vector(512), p_limit int, p_from timestamptz, p_to timestamptz, p_kw_weight float, p_sources text[]) → (item_id, chunk_id, score, sem_sim, kw_score)` — 시그니처·반환 그대로, `variants` 조건만 `and (v = t or t !~ '[0-9]' or v !~ '[0-9]$')`. 보관 계획 R-B4의 `0024`(예정 번호, 실제는 하나 밀림)가 이 조건을 옮겨 적는다(그 계획에 적었다).

- [ ] **Step 1: 실패하는 테스트**

`supabase/tests/search.test.ts` 끝에 추가(파일의 `seed(text, embedding)`·`Hit` 사용, 임베딩 없음 = 키워드 경로만):

```ts
// 2026-10-01 검색·캘린더 S2: 숫자가 든 어절은 숫자로 끝나는 변형을 만들지 않는다(10월 → 10 금지). 10월에 → 10월, 한글 어절의 조사 떼기는 그대로
Deno.test("hybrid_search: numeric tokens do not shrink to bare numbers; Hangul particles still drop", async () => {
  const a = await seed("합성 문구: 모임알파 10월 3일 저녁 7시", null);
  const b = await seed("합성 문구: 결제베타 10,500원 승인 10:30", null);
  const c = await seed("합성 문구: 치과예약감마 안내", null);
  try {
    const found = async (q: string) =>
      new Set(((await sb.rpc("hybrid_search", { p_user: USER, p_query: q, p_embedding: null, p_limit: 20 })).data as Hit[]).map((r) => r.item_id));
    const oct = await found("10월 3일 일정");
    assert(oct.has(a), "10월·3일 원형은 맞는다");
    assert(!oct.has(b), "10월 → 10 변형이 10,500원·10:30 에 맞으면 안 된다");
    const particle = await found("10월에");
    assert(particle.has(a) && !particle.has(b), "10월에 → 10월 은 허용, 10 은 금지");
    assert((await found("치과예약감마는")).has(c), "한글 어절 끝 글자 떼기 유지");
  } finally {
    await sb.from("items").delete().eq("user_id", USER).in("id", [a, b, c]);          // 청크는 cascade
  }
});
```

- [ ] **Step 2: 실패 확인**

Run: `pgrep -x xcodebuild; deno test --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/tests/search.test.ts`
Expected: FAIL — `10월 → 10 변형이 …` 단언(지금은 `b`가 `10`으로 맞는다).

- [ ] **Step 3: 마이그레이션**

Create `supabase/migrations/0023_hybrid_numeric_tokens.sql` — 0017 본문 그대로, `variants`의 `where`만 다르다(시그니처·반환이 같아 `create or replace`):

```sql
-- 스펙 §9 키워드(2026-10-01 검색·캘린더 결정 2b): 숫자가 든 어절은 숫자로 끝나는 변형을 만들지 않는다.
-- 10월 → 10 이 strpos 부분 문자열로 시각·전화번호·금액의 10 에 맞아 "10월 3일 일정" 질문에서 청크 11/25 가 키워드 일치했다(재현).
-- 10월에 → 10월 (조사 떼기)은 남긴다. 한글 어절의 끝 1~2자 떼기는 0017 그대로. 인자·반환은 0017 과 같다
create or replace function hybrid_search(p_user uuid, p_query text, p_embedding extensions.vector(512), p_limit int,
                              p_from timestamptz default null, p_to timestamptz default null, p_kw_weight float default 1.0,
                              p_sources text[] default null)
returns table(item_id uuid, chunk_id uuid, score float, sem_sim float, kw_score float)
language sql stable set search_path = public, extensions as $$
with base as (
  select c.id, c.item_id, lower(c.text) text, c.embedding from item_chunks c join items i on i.id = c.item_id
  where c.user_id = p_user and i.user_id = p_user
    and (p_from is null or i.occurred_at >= p_from) and (p_to is null or i.occurred_at <= p_to)
    and (p_sources is null or cardinality(p_sources) = 0 or i.source = any (p_sources))
), nb as (
  select greatest(count(*), 1)::float n from base
), sem as (
  select id, 1 - (embedding <=> p_embedding) sim, row_number() over (order by embedding <=> p_embedding) rk
  from base where p_embedding is not null and embedding is not null
  order by embedding <=> p_embedding limit 40
), toks as (
  select distinct t from regexp_split_to_table(lower(p_query), '[[:space:][:punct:]]+') t
  where char_length(t) >= 2 and t not in (
    '언제','언제야','언제지','어디','어디서','어디야','어디였지','어디에','뭐','뭐야','뭐지','뭐였지','뭐였더라','몇','얼마','얼마나',
    '누가','누구','무슨','어느','어떤','했지','했어','했나','했더라','샀지','샀어','샀더라','거','것','건','좀','내가','이번','그거',
    '있어','있나','됐어','됐나','돼','해','야','지','가야','하러','가는')
), variants as (
  select t, v from toks cross join lateral (values (t),
    (case when char_length(t) >= 3 then left(t, char_length(t) - 1) end),
    (case when char_length(t) >= 4 then left(t, char_length(t) - 2) end)) x(v)
  where v is not null and (v = t or t !~ '[0-9]' or v !~ '[0-9]$')
), tokmatch as (
  select distinct b.id, vt.t from base b join variants vt on strpos(b.text, vt.v) > 0
), df as (
  select t, count(*)::float n from tokmatch group by t
), kw as (
  select m.id, sum(ln((nb.n + 1) / (df.n + 0.5))) s, row_number() over (order by sum(ln((nb.n + 1) / (df.n + 0.5))) desc) rk
  from tokmatch m join df using (t) cross join nb group by m.id, nb.n order by s desc limit 40
), fused as (
  select coalesce(s.id, k.id) id, coalesce(1.0/(60+s.rk),0) + p_kw_weight * coalesce(1.0/(60+k.rk),0) score, s.sim, k.s kw
  from sem s full outer join kw k on s.id = k.id
)
select b.item_id, f.id, f.score::float, f.sim::float, f.kw::float from fused f join base b on b.id = f.id order by f.score desc limit p_limit;
$$;

revoke execute on function hybrid_search(uuid, text, extensions.vector, int, timestamptz, timestamptz, float, text[]) from public, anon, authenticated;
```

- [ ] **Step 4: 재현(전) → push → 테스트 → 재현(후)**

메인에게 "⑩b 실행 중 아님"을 확인받은 뒤:

```bash
# 머리 2줄
git status --short supabase/migrations; ls supabase/migrations | tail -3        # 새 파일이 S2 하나뿐인지
deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/search-probe.ts --label s2-before
supabase db push
pgrep -x xcodebuild; deno test --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/tests/search.test.ts supabase/tests/chat-db.test.ts supabase/tests/embed-db.test.ts
deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/search-probe.ts --label s2-after
s "select position('or v !~ ''[0-9]\$''' in pg_get_functiondef('hybrid_search(uuid, text, extensions.vector, int, timestamptz, timestamptz, float, text[])'::regprocedure)) > 0 as numeric_rule"
```

Expected: 테스트 PASS(새 테스트 + 0017 기준 `hybrid_search p_sources`·벡터 적중·S1 컷 DB 테스트), `numeric_rule true`. 전체 `deno test … supabase/tests/` 0 실패.

통과 기준(실측 게이트): 같은 코퍼스에서 잰 `s2-before`/`s2-after`의 **q2("10월 3일 일정 있어?") `kw_chunks`가 줄어든다**(기준선 11 → `10월`·`3일` 원형만), 숫자가 없는 q1·q3~q6의 `kw_chunks`·`cand_cut`은 **같다**(변형 제거는 숫자 어절에만 작용). 둘 사이에 새 항목이 들어와 q1·q3~q6이 달라졌으면 두 번 다시 잰다. q2가 줄지 않으면(코퍼스에 숫자 잡음이 없어진 경우) 전·후 수치와 새 테스트 통과로 판정하고 사유를 적는다.

- [ ] **Step 5: 기록·커밋**

`gates.md` 행 `S2`(게이트 = 위 기준, 근거 = push 시각·전후 12줄 요약(q마다 `kw_chunks`·`cand_cut` 전→후)·테스트 수, 비고 = "⑩b 기준선은 S2·S3 배포 뒤").

```bash
git add supabase/migrations/0023_hybrid_numeric_tokens.sql supabase/tests/search.test.ts docs/superpowers/phase1/gates.md
git commit -m "feat(search): numeric query tokens never shrink to a trailing digit (10월 ↛ 10); Hangul particle drop kept (S2)"
```

---

### Task S3: 일정 날짜 필터(`event_from/to`) → facts, 응답 `schedule`

**Files:**
- Modify: `supabase/functions/chat/filters.ts` (전체 교체)
- Modify: `supabase/functions/chat/handler.ts` (import·`ChatResult.schedule`·`validateAnswer` 반환 타입·`factsDistinct`·`answerOnce`·`handleChat`)
- Modify: `supabase/functions/chat/deps.ts` (`facts`, import)
- Modify: `supabase/scripts/search-probe.ts` (`--filters`), `supabase/scripts/smoke-chat.ts` (일정 질문 1개)
- Test: `supabase/tests/chat.test.ts`, `supabase/tests/chat-db.test.ts`
- Docs: `docs/superpowers/phase1/gates.md` 행 `S3`

**Interfaces:**
- Consumes: S1 `factsDistinct`·`pickCandidates`, 0019 `search_facts`(`fact_when`).
- Produces: `Filters = { date_from; date_to; event_from; event_to; sources; kinds; merchant }`(모두 `string | null`·`string[]`, 날짜는 `YYYY-MM-DDT00:00:00+09:00`·`…T23:59:59+09:00`); `export function factRange(f: Filters): [string | null, string | null]`; `export type Schedule = { from: string; to: string }`; `export function scheduleOf(f: Filters): Schedule | null`; `export const SCHEDULE_MAX_DAYS = 31`; `ChatResult.schedule: Schedule | null`; `POST /chat` 응답 `schedule: {from, to} | null`(거절·문서 0건에도). C1 앱이 `schedule`을 읽는다.

- [ ] **Step 1: 실패하는 테스트**

`supabase/tests/chat.test.ts`:

(1) filters import 줄을 바꾼다:

```ts
import { extractFilters, factRange, FILTER_SCHEMA, FILTER_SYSTEM, normalizeFilters, scheduleOf } from "../functions/chat/filters.ts";
```

(2) `deps()` 헬퍼의 기본 필터에 일정 날짜를 더한다:

```ts
    filters: async () => ({ filters: { date_from: null, date_to: null, event_from: null, event_to: null, sources: [], kinds: [], merchant: null, ...o.filters } }),
```

(3) 테스트 `"normalizeFilters: Seoul day bounds; anything but YYYY-MM-DD becomes null"`의 두 객체에 `event_from: null, event_to: null,`을 더한다(`date_to` 다음).

(4) 테스트 `"filter prompt: dates mean when mail/texts were received or saved; schedule and deadline dates stay null (Ruling D)"`를 아래로 바꾼다:

```ts
Deno.test("filter prompt: received dates only in date_from/to; schedule and deadline dates go to event_from/to (Ruling D, 2026-10-01)", () => {
  for (const k of ["date_from", "date_to"] as const) {
    const desc = FILTER_SCHEMA.properties[k].description;
    assert(desc.includes("받은/저장한 기간을 말할 때만"), desc);
    assert(desc.includes("일정·약속·기한의 날짜") && desc.includes("10월 20일 미팅") && desc.includes("null"), desc);
  }
  for (const k of ["event_from", "event_to"] as const) {
    const desc = FILTER_SCHEMA.properties[k].description;
    assert(desc.includes("일정·약속·예약·기한의 날짜") && desc.includes("다음 주 → 그 주 월요일~일요일"), desc);
  }
  assert(FILTER_SCHEMA.required.includes("event_from") && FILTER_SCHEMA.required.includes("event_to"));
  assert(FILTER_SYSTEM.includes("받은/저장한 시각") && FILTER_SYSTEM.includes("event_from·event_to 에"));
});
```

(5) 실제 LLM 테스트 `"extractFilters (live): …"`를 아래로 바꾼다(2026-10-01은 목요일):

```ts
// 실제 gpt-6-luna 호출(합성 질문만, 약 0.1원/건). LIVE_LLM=1 일 때만. 2026-10-01(목) 기준: 이번 주 토요일 10-03, 다음 주 10-05~10-11
Deno.test({ name: "extractFilters (live): schedule dates → event_from/to, not date_from/to; received period → date_from/to", ignore: Deno.env.get("LIVE_LLM") !== "1", fn: async () => {
  const meeting = (await extractFilters("10월 20일 미팅 어디야?", "2026-10-01")).filters;
  assertEquals([meeting.date_from, meeting.date_to, meeting.kinds.includes("event")], [null, null, true]);
  assertEquals([meeting.event_from, meeting.event_to], ["2026-10-20T00:00:00+09:00", "2026-10-20T23:59:59+09:00"]);
  const plan = (await extractFilters("다음 주 약속 뭐 있어?", "2026-10-01")).filters;
  assertEquals([plan.date_from, plan.date_to, plan.event_from, plan.event_to], [null, null, "2026-10-05T00:00:00+09:00", "2026-10-11T23:59:59+09:00"]);
  const sat = (await extractFilters("이번 주 토요일 약속 뭐 있지", "2026-10-01")).filters;
  assertEquals([sat.event_from, sat.event_to], ["2026-10-03T00:00:00+09:00", "2026-10-03T23:59:59+09:00"]);
  const mail = (await extractFilters("지난달 받은 견적 메일 찾아줘", "2026-10-01")).filters;
  assertEquals([mail.date_from, mail.date_to, mail.sources, mail.event_from, mail.event_to],
    ["2026-09-01T00:00:00+09:00", "2026-09-30T23:59:59+09:00", ["GMAIL"], null, null]);
} });
```

(6) 파일 끝에 추가:

```ts
// 2026-10-01 검색·캘린더 S3: 일정 날짜 정규화 — 서울 날짜 경계, 달력에 없는 날짜·거꾸로 된 범위는 null(Postgres timestamptz 오류·엉뚱한 범위 방지)
Deno.test("normalizeFilters: event dates get Seoul day bounds; impossible dates and reversed ranges are dropped", () => {
  const f = normalizeFilters({ date_from: null, date_to: null, event_from: "2026-10-05", event_to: "2026-10-11", sources: [], kinds: ["event"], merchant: null });
  assertEquals([f.event_from, f.event_to], ["2026-10-05T00:00:00+09:00", "2026-10-11T23:59:59+09:00"]);
  const bad = normalizeFilters({ date_from: "2026-02-30", date_to: null, event_from: "2026-10-11", event_to: "2026-10-05", sources: [], kinds: ["event"], merchant: null });
  assertEquals([bad.date_from, bad.event_from, bad.event_to], [null, null, null]);
  const one = normalizeFilters({ date_from: null, date_to: null, event_from: "2026-10-03", event_to: null, sources: [], kinds: ["event"], merchant: null });
  assertEquals([one.event_from, one.event_to], ["2026-10-03T00:00:00+09:00", null]);
});

Deno.test("factRange: event/task facts use the schedule dates when present, else the received dates", () => {
  const base = { date_from: "R0", date_to: "R1", event_from: "E0", event_to: "E1", sources: [], merchant: null };
  assertEquals(factRange({ ...base, kinds: ["event"] }), ["E0", "E1"]);
  assertEquals(factRange({ ...base, kinds: ["task", "purchase"] }), ["E0", "E1"]);
  assertEquals(factRange({ ...base, kinds: ["purchase"] }), ["R0", "R1"]);
  assertEquals(factRange({ ...base, kinds: ["event"], event_from: null, event_to: null }), ["R0", "R1"]);
});

// schedule: 일정 질문(kinds ∋ event) · 양 끝 · 31일 이하일 때만 — 앱이 1년치 캘린더를 읽지 않게
Deno.test("scheduleOf: only event questions with both schedule bounds and at most 31 days", () => {
  const d = { date_from: null, date_to: null, event_from: "2026-10-03T00:00:00+09:00", event_to: "2026-10-03T23:59:59+09:00", sources: [], merchant: null };
  assertEquals(scheduleOf({ ...d, kinds: ["event"] }), { from: d.event_from, to: d.event_to });
  assertEquals(scheduleOf({ ...d, kinds: ["event"], event_to: "2026-11-02T23:59:59+09:00" }), { from: d.event_from, to: "2026-11-02T23:59:59+09:00" });
  assertEquals(scheduleOf({ ...d, kinds: ["task"] }), null);
  assertEquals(scheduleOf({ ...d, kinds: ["event"], event_to: null }), null);
  assertEquals(scheduleOf({ ...d, kinds: ["event"], event_to: "2026-12-31T23:59:59+09:00" }), null);
});

// schedule 은 거절·문서 0건에도 싣는다(앱이 캘린더만으로 보인다). 일정 날짜로 걸러진 facts 는 후보(구별 조건)
Deno.test("answerQuestion: schedule rides along even when refused or nothing found; schedule-dated facts become candidates", async () => {
  const f = { kinds: ["event"], event_from: "2026-10-03T00:00:00+09:00", event_to: "2026-10-03T23:59:59+09:00" };
  const sched = { from: f.event_from, to: f.event_to };
  const { d } = deps({ filters: f, facts: [{ item_id: "f3", occurred_at: "2026-09-20T00:00:00Z", text: "[event] 합성 모임 · 2026-10-03T19:00:00+09:00" }],
    raw: { answer: "합성 모임", source_item_ids: ["f3"], refused: false } });
  const r = await answerQuestion("user-1", "10월 3일 일정 있어?", d);
  assertEquals([r.schedule, r.candidates[0]], [sched, "f3"]);
  const refused = await answerQuestion("user-1", "10월 3일 일정 있어?", deps({ filters: f, raw: { answer: "", source_item_ids: [], refused: true } }).d);
  assertEquals([refused.refused, refused.candidates, refused.schedule], [true, [], sched]);
  const empty = await answerQuestion("user-1", "10월 3일 일정 있어?", deps({ filters: f, hits: [] }).d);
  assertEquals([empty.refused, empty.schedule], [true, sched]);
  const plain = await answerQuestion("user-1", "에어팟 어디서 샀지", deps().d);
  assertEquals(plain.schedule, null);
});

Deno.test("POST /chat returns schedule next to candidates (null when not a dated event question)", async () => {
  const res = await handleChat(req("chat", { question: "에어팟 어디서 샀지" }), deps().d);
  const j = await res.json();
  assertEquals([res.status, j.schedule], [200, null]);
  const dated = await handleChat(req("chat", { question: "10월 3일 일정 있어?" }),
    deps({ filters: { kinds: ["event"], event_from: "2026-10-03T00:00:00+09:00", event_to: "2026-10-03T23:59:59+09:00" } }).d);
  assertEquals((await dated.json()).schedule, { from: "2026-10-03T00:00:00+09:00", to: "2026-10-03T23:59:59+09:00" });
});
```

`supabase/tests/chat-db.test.ts`:

(1) 테스트 `"chat pipeline (real facts/hybrid RPCs) …"`의 `run` 안 기본 필터 객체에 `event_from: null, event_to: null,`을 더한다(`date_to` 다음).

(2) 파일 끝에 추가:

```ts
// 2026-10-01 검색·캘린더 S3: 일정 질문의 facts 는 일정 날짜(event_from/to)로 거른다 — kinds 만으로 나오던 "최근 5건" 대신 그날의 일정
Deno.test("chatDeps.facts: event facts are filtered by the schedule dates (event_from/to)", async () => {
  const id = await seed("GMAIL", "ev", "합성 초대", "합성 현장 미팅 10월 20일");
  try {
    assertEquals((await sb.rpc("save_fact", { p_user: USER, p_item: id, p_kind: "event", p_payload: { title: "합성 현장 미팅", start: "2026-10-20T10:00:00+09:00" },
      p_evidence: "합성 현장 미팅", p_action: null })).error, null);
    const f = (from: string, to: string): Filters => ({ date_from: null, date_to: null, event_from: from, event_to: to, sources: [], kinds: ["event"], merchant: null });
    const d = chatDeps(sb);
    assert((await d.facts(USER, f("2026-10-20T00:00:00+09:00", "2026-10-20T23:59:59+09:00"))).some((h) => h.item_id === id));
    assert(!(await d.facts(USER, f("2026-10-21T00:00:00+09:00", "2026-10-21T23:59:59+09:00"))).some((h) => h.item_id === id));
  } finally {
    await sb.from("facts").delete().eq("user_id", USER).eq("item_id", id);
    await sb.from("items").delete().eq("user_id", USER).eq("id", id);
  }
});
```

- [ ] **Step 2: 실패 확인**

Run: `pgrep -x xcodebuild; deno test --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/tests/chat.test.ts supabase/tests/chat-db.test.ts`
Expected: FAIL — `factRange`·`scheduleOf` 없음, `Filters`에 `event_from` 없음(타입 검사 오류).

- [ ] **Step 3: filters.ts**

Replace `supabase/functions/chat/filters.ts` 전체:

```ts
import { openai } from "../_shared/openai.ts";

// 질문 → 검색 필터(스펙 §9 "gpt-6-luna가 필터 추출"). strict json_schema, store:false, effort none. 질문 본문은 로그에 남기지 않는다
export type Filters = { date_from: string | null; date_to: string | null; event_from: string | null; event_to: string | null;
  sources: string[]; kinds: string[]; merchant: string | null };
// 기간은 메일·문자를 받은/저장한 시각(items.occurred_at)이다. 일정·기한 날짜를 여기에 넣으면 9/10 에 받은 10/20 미팅 메일이 빠진다(Ruling D)
const RECEIVED_ONLY = "메일·문자를 받은/저장한 기간을 말할 때만(예: 지난달 받은 메일, 어제 온 문자). 일정·약속·기한의 날짜(예: 10월 20일 미팅, 다음 주 약속, 이번 달 납부)는 null.";
// 일정 날짜(2026-10-01 검색·캘린더 결정): facts 의 event·task 를 이 날짜로 거르고, 일정 질문이면 앱이 이 기간의 기기 캘린더를 읽는다(schedule)
const EVENT_ONLY = "질문이 가리키는 일정·약속·예약·기한의 날짜(예: 내일, 10월 3일, 이번 주 토요일 → 그날 하루, 다음 주 → 그 주 월요일~일요일, 이번 달 → 1일~말일). 일정·기한 날짜가 없거나 받은/저장한 기간이면 null.";
export const FILTER_SCHEMA = {
  type: "object", additionalProperties: false, required: ["date_from", "date_to", "event_from", "event_to", "sources", "kinds", "merchant"],
  properties: {
    date_from: { type: ["string", "null"], description: `${RECEIVED_ONLY} 서울 기준 시작일 YYYY-MM-DD` },
    date_to: { type: ["string", "null"], description: `${RECEIVED_ONLY} 서울 기준 끝 날짜 YYYY-MM-DD(그날 포함)` },
    event_from: { type: ["string", "null"], description: `${EVENT_ONLY} 서울 기준 시작일 YYYY-MM-DD` },
    event_to: { type: ["string", "null"], description: `${EVENT_ONLY} 서울 기준 끝 날짜 YYYY-MM-DD(그날 포함)` },
    sources: { type: "array", items: { type: "string", enum: ["GMAIL", "MESSAGES", "NOTIFICATION", "SHARE"] },
      description: "질문이 출처를 말할 때만: 메일=GMAIL, 문자=MESSAGES와 NOTIFICATION, 카톡·앱 알림=NOTIFICATION, 공유·저장한 것=SHARE. 아니면 빈 배열" },
    kinds: { type: "array", items: { type: "string", enum: ["event", "task", "purchase"] },
      description: "구매·결제·주문 질문=purchase, 일정·약속·예약=event, 할 일·기한=task. 아니면 빈 배열" },
    merchant: { type: ["string", "null"], description: "질문에 가게·판매처·가맹점 이름이 있으면 그 이름, 없으면 null" },
  },
} as const;

export const FILTER_SYSTEM = ["사용자의 개인 비서 검색 질문에서 필터만 뽑는다. 질문에 없는 조건은 만들지 않는다.",
  "date_from·date_to 는 받은/저장한 시각 조건이다. 일정·약속·기한이 언제인지 묻거나 그 날짜로 대상을 가리키면 date_from·date_to 는 null 로 두고, 그 날짜는 event_from·event_to 에, 종류는 kinds 에 넣는다."].join("\n");

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
// 달력에 있는 YYYY-MM-DD 만. 2026-02-30 은 Postgres timestamptz 변환 오류(500)가 되므로 버린다
function day(s: string | null): string | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? s : null;
}
const bound = (s: string | null, end: boolean) => { const v = day(s); return v ? `${v}T${end ? "23:59:59" : "00:00:00"}+09:00` : null; };

export function normalizeFilters(f: Filters): Filters {
  let ef = bound(f.event_from, false), et = bound(f.event_to, true);
  if (ef && et && Date.parse(ef) > Date.parse(et)) { ef = null; et = null; }        // 거꾸로 된 일정 범위는 버린다
  return { ...f, date_from: bound(f.date_from, false), date_to: bound(f.date_to, true), event_from: ef, event_to: et };
}

// facts 의 event·task 는 일정 날짜로 거른다(0019 fact_when = start·due). 일정 날짜가 없으면 받은 기간(Ruling D 그대로)
export function factRange(f: Filters): [string | null, string | null] {
  const dated = f.kinds.includes("event") || f.kinds.includes("task");
  return dated && (f.event_from !== null || f.event_to !== null) ? [f.event_from, f.event_to] : [f.date_from, f.date_to];
}

// 응답 schedule(스펙 §9 "일정 질문과 기기 캘린더"): 일정 질문(kinds ∋ event)이고 일정 날짜 양 끝이 있으며 31일 이하일 때만
export const SCHEDULE_MAX_DAYS = 31;
export type Schedule = { from: string; to: string };
export function scheduleOf(f: Filters): Schedule | null {
  if (!f.kinds.includes("event") || f.event_from === null || f.event_to === null) return null;
  return (Date.parse(f.event_to) - Date.parse(f.event_from)) / 86_400_000 <= SCHEDULE_MAX_DAYS ? { from: f.event_from, to: f.event_to } : null;
}

export async function extractFilters(question: string, today: string) {
  const weekday = WEEKDAYS[new Date(`${today}T00:00:00Z`).getUTCDay()];            // "이번 주 토요일"·"다음 주" 해석용
  const r = await openai.responses.create({
    model: "gpt-6-luna", store: false, reasoning: { effort: "none" },
    input: [{ role: "system", content: FILTER_SYSTEM },
            { role: "user", content: `오늘(서울): ${today}(${weekday})\n질문: ${question}` }],
    text: { format: { type: "json_schema", name: "search_filters", schema: FILTER_SCHEMA, strict: true } },
  });
  if (r.status === "incomplete") throw new Error("filters incomplete");
  return { filters: normalizeFilters(JSON.parse(r.output_text) as Filters),
    usage: r.usage ? { input_tokens: r.usage.input_tokens, output_tokens: r.usage.output_tokens } : undefined };
}
```

- [ ] **Step 4: handler.ts · deps.ts**

`supabase/functions/chat/handler.ts`:

(1) filters import 두 줄을 바꾼다:

```ts
import { factRange, type Filters, type Schedule, scheduleOf } from "./filters.ts";
export type { Filters, Schedule } from "./filters.ts";
```

(2) `ChatResult`에 `schedule`을 더한다:

```ts
export type ChatResult = RawAnswer & { forced_refusal: boolean; dropped_ids: number; hits: string[]; candidates: string[]; citations: Meta[];
  proposals: ProposalCard[]; model: string | null; schedule: Schedule | null };
```

(3) `validateAnswer`의 반환 타입을 `Omit<ChatResult, "hits" | "candidates" | "citations" | "proposals" | "model" | "schedule">`로 바꾼다.

(4) S1의 `factsDistinct` 본문을 바꾼다(일정 날짜로 걸러진 facts도 구별 조건):

```ts
export function factsDistinct(f: Filters): boolean {
  return f.merchant !== null || factRange(f).some((x) => x !== null);
}
```

(5) `answerOnce`: `const { filters, usage: fu } = await deps.filters(question, today);` 바로 아래에

```ts
    const schedule = scheduleOf(filters);          // 일정 질문이면 앱이 이 기간의 기기 캘린더를 읽는다(§9) — 거절·문서 0건이어도 싣는다
```

를 넣고, 문서 0건 분기의 값 객체 `… proposals: [], model: null } as ChatResult` 를 `… proposals: [], model: null, schedule } as ChatResult` 로, 마지막 `return { value: { ...v, hits: docs.map((d) => d.item_id), candidates, citations, proposals, model: raw.model }, …` 를 `… model: raw.model, schedule }, …` 로 바꾼다.

(6) `handleChat`의 로그와 응답:

```ts
    console.log(JSON.stringify({ chat: r.refused ? "refused" : "answered", forced: r.forced_refusal, cited: r.source_item_ids.length,
      dropped: r.dropped_ids, hits: r.hits.length, candidates: r.candidates.length, schedule: r.schedule !== null, model: r.model }));   // id 목록·날짜는 로그에 넣지 않는다
    return Response.json({ answer_id: crypto.randomUUID(), answer: r.answer, refused: r.refused, source_item_ids: r.source_item_ids,
      citations: r.citations, proposals: r.proposals, hits: r.hits, candidates: r.candidates, schedule: r.schedule });
```

`supabase/functions/chat/deps.ts`: import를 `import { extractFilters, factRange, type Filters } from "./filters.ts";`로, `facts`를 아래로:

```ts
    async facts(u, f: Filters) {
      const [from, to] = factRange(f);                                       // event·task 는 일정 날짜, 없으면 받은 기간(§9)
      const rows = (await rpc("search_facts", { p_user: u, p_from: from, p_to: to, p_kinds: f.kinds, p_merchant: f.merchant })) as
        { item_id: string; kind: string; payload: Record<string, unknown>; evidence: string | null; occurred_at: string }[];
      return rows.map((r) => ({ item_id: r.item_id, occurred_at: r.occurred_at, text: factText(r) }));
    },
```

그 밖에 `Filters` 객체를 만드는 곳이 없는지 `grep -rn "merchant: null" supabase/functions supabase/tests supabase/scripts`로 확인한다(위 테스트 4곳 외에 있으면 `event_from: null, event_to: null`을 더한다).

- [ ] **Step 5: 통과 확인**

Run:
```bash
deno check supabase/functions/chat/index.ts supabase/scripts/eval-search.ts
pgrep -x xcodebuild; deno test --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/tests/chat.test.ts supabase/tests/chat-db.test.ts
LIVE_LLM=1 deno test --allow-net --allow-env --allow-read --env-file=supabase/.env --filter "extractFilters (live)" supabase/tests/chat.test.ts
```
Expected: PASS(live 1건 포함). 전체 `deno test … supabase/tests/` 0 실패. live가 실패하면(예: "다음 주"를 일요일 시작으로) `EVENT_ONLY`·`FILTER_SYSTEM` 문구만 고쳐 다시 돈다 — 기대값(월~일)은 스펙이므로 바꾸지 않는다. 세 번 고쳐도 실패하면 실패 줄을 메인에게 보고한다.

- [ ] **Step 6: 재현 스크립트 `--filters` · 스모크 일정 질문**

`supabase/scripts/search-probe.ts`:

머리 주석 사용 줄 끝에 ` [--filters]`를 더하고, 둘째 주석 줄 아래에 `// --filters: 필터(gpt-6-luna 6건, 1원 미만) → 종류·조건 유무·schedule 일수, facts 개수(받은 기간 기준 old / factRange 기준 new) — search_facts 는 item_id 열만 받는다` 를 더한다. import에 `import { extractFilters, factRange, scheduleOf } from "../functions/chat/filters.ts";`. `const r3 = …` 아래에:

```ts
const withFilters = Deno.args.includes("--filters");
const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
async function factCount(from: string | null, to: string | null, kinds: string[], merchant: string | null): Promise<number> {
  const { data, error } = await sb.rpc("search_facts", { p_user: user, p_from: from, p_to: to, p_kinds: kinds, p_merchant: merchant }).select("item_id");
  if (error) throw new Error("search_facts " + error.code);
  return (data as unknown[]).length;
}
```

루프 안 `console.log` 앞에:

```ts
  let extra = {};
  if (withFilters) {
    const { filters: f } = await extractFilters(question, today);
    const sch = scheduleOf(f), [ef, et] = factRange(f);
    extra = { kinds: f.kinds, merchant: f.merchant !== null, date_range: f.date_from !== null || f.date_to !== null,
      event_range: f.event_from !== null || f.event_to !== null,
      schedule_days: sch ? Math.round((Date.parse(sch.to) - Date.parse(sch.from)) / 86_400_000) : null,
      facts_old: await factCount(f.date_from, f.date_to, f.kinds, f.merchant), facts_new: await factCount(ef, et, f.kinds, f.merchant) };
  }
```

그리고 `console.log(JSON.stringify({ label, …, cand_cut: … }))`의 객체 끝에 `...extra`를 더한다.

`supabase/scripts/smoke-chat.ts`: 머리 주석 둘째 줄 끝에 ` 일정 질문: schedule = 그날 하루(서울).`를 더하고, `const b = await ask(…)` 아래에 `const dated = await ask("2026년 10월 7일 합성스모크치과 일정 있어?");`, 출력 객체에 두 항목을 더한다:

```ts
    dated: { status: dated.status, schedule_ok: JSON.stringify(dated.j.schedule) ===
      JSON.stringify({ from: "2026-10-07T00:00:00+09:00", to: "2026-10-07T23:59:59+09:00" }) },
```

`answered` 객체에 `schedule_null: a.j.schedule === null`을 더한다.

Run: `deno check supabase/scripts/search-probe.ts supabase/scripts/smoke-chat.ts`
Expected: 오류 0.

- [ ] **Step 7: 코드 커밋**

```bash
git add supabase/functions/chat/filters.ts supabase/functions/chat/handler.ts supabase/functions/chat/deps.ts supabase/scripts/search-probe.ts supabase/scripts/smoke-chat.ts supabase/tests/chat.test.ts supabase/tests/chat-db.test.ts
git commit -m "feat(chat): schedule dates (event_from/to) filter event/task facts; chat returns the schedule range for the device calendar (S3)"
```

- [ ] **Step 8: 배포 + 실측 게이트**

메인에게 "⑩b 실행 중 아님"을 확인받은 뒤:

```bash
# 머리 2줄
supabase functions deploy chat
deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/smoke-chat.ts
deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/search-probe.ts --label s3 --filters
```

통과 기준:
1. **스모크**: S1 기준 그대로 + `answered.schedule_null true` + `dated` = `status 200`·`schedule_ok true`.
2. **재현(필터)**: q1~q4는 `kinds`에 `event`, `event_range true`, `date_range false`, `schedule_days` = 1·1·1·7(q2 "10월 3일"은 날짜가 지나도 1). 네 질문 모두 `facts_new ≤ facts_old`이고, `facts_old`가 5인 질문(질문과 무관한 최근 5건)이 있으면 그 질문의 `facts_new`가 더 작다. q5("화성 탐사선 발사 일정")는 `event_range false`·`schedule_days null`. q6("쿠팡에서 산 거")는 `merchant true`·`schedule_days null`. 한 질문이라도 어긋나면 그 줄을 적고 Step 5의 문구 조정 규칙을 따른다.
3. LIVE 필터 테스트(Step 5) 통과 기록.

- [ ] **Step 9: 기록 커밋**

`gates.md` 행 `S3`(게이트 = 위 1~3, 근거 = 배포 시각·smoke 출력·probe 6줄의 필터 항목·live 결과, 비고 = "⑩b 기준선 = 이 배포 뒤").

```bash
git add docs/superpowers/phase1/gates.md
git commit -m "docs(gates): S3 schedule range deployed — smoke, probe filters, live filter test"
```

---

### Task C2: 겹침 확인 — `AddEventGate` · 제안 시트·탭 · 채팅 카드 · 잠금화면 로컬 알림 (0.8.0)

**Files:**
- Modify: `ios/Packages/EruriCore/Sources/EruriCore/ProposalFlow.swift` (`CalendarEvent`, `eventDuration`, `conflicts`, `conflictOutcome`·`conflictCount`, `conflictLine`, `confirmTitle`, 겹침 알림 문구·식별자)
- Modify: `ios/Packages/EruriCore/Sources/EruriCore/ProposalReview.swift` (`conflictCategory`, `categories`, `sheet(for:list:)`)
- Modify: `ios/Packages/EruriCore/Sources/EruriCore/ChatReply.swift` (`addFeedback` conflict)
- Create: `ios/App/CalendarLookup.swift`
- Modify: `ios/App/NotificationActions.swift` (`register`, `handleAdd(fields:confirmed:)`, `conflictNotice`, `AddEventRequest`, `AddEventGate.add`, 델리게이트 ADD 분기)
- Modify: `ios/App/ProposalsView.swift` (`ProposalActionsView`)
- Modify: `ios/App/ChatView.swift` (카드 추가 경로 `runAdd`·확인창)
- Modify: `ios/project.yml` (`MARKETING_VERSION: 0.8.0`)
- Test: `ios/Packages/EruriCore/Tests/EruriCoreTests/ProposalFlowTests.swift`, `ProposalReviewTests.swift`, `ChatReplyTests.swift`

**Interfaces:**
- Consumes: `ProposalFlow.marker(_:)`·`searchWindow(start:)`·`matchMarker(pid:events:)`, `ProposalReview.link`·`sheet`, `NotificationActions.handleAdd`.
- Produces(EruriCore): `public struct ProposalFlow.CalendarEvent: Equatable, Sendable { id: String; title: String; start: Date; end: Date; allDay: Bool; canceled: Bool; url: URL? }`(init 기본값 `allDay: false, canceled: false, url: nil`); `ProposalFlow.eventDuration: TimeInterval = 3600`; `ProposalFlow.conflicts(pid: String, start: Date, events: [CalendarEvent]) -> [CalendarEvent]`; `conflictOutcome(_ n: Int) -> String`("conflict:<n>"); `conflictCount(_ outcome: String) -> Int?`; `conflictLine(_ c: [CalendarEvent]) -> String?`; `confirmTitle(_ c: [CalendarEvent]) -> String`; `conflictNoticeTitle`, `conflictNoticeBody(_ n: Int) -> String`, `conflictNoticeID(_ pid: String) -> String`; `ProposalReview.conflictCategory = "ADD_EVENT_CONFLICT"`. 앱: `enum CalendarLookup { static var fullAccess: Bool; static func events(_ store: EKEventStore, from: Date, to: Date) -> [ProposalFlow.CalendarEvent]; static func conflicts(pid: String, start: Date) -> [ProposalFlow.CalendarEvent] }`; `NotificationActions.handleAdd(fields:confirmed: Bool = false) async -> String`(반환에 `conflict:<n>` 추가); `NotificationActions.conflictNotice(fields:count:) async`. C1이 `CalendarEvent`·`conflicts`·`CalendarLookup.events`를 쓴다.

- [ ] **Step 1: 실패하는 테스트**

`ProposalFlowTests.swift`에 추가:

```swift
  /// §10 겹침: 저장 구간 [start, start+1h)와 겹치는 일정, 시작 순. 맞닿음·종일·취소·같은 제안 표식은 제외, 다른 제안이 넣은 일정은 겹침
  func testConflicts() {
    let t = Date(timeIntervalSince1970: 1_800_000_000)
    func ev(_ id: String, _ a: TimeInterval, _ b: TimeInterval, allDay: Bool = false, canceled: Bool = false, url: URL? = nil) -> ProposalFlow.CalendarEvent {
      ProposalFlow.CalendarEvent(id: id, title: "합성 \(id)", start: t.addingTimeInterval(a), end: t.addingTimeInterval(b),
                                 allDay: allDay, canceled: canceled, url: url)
    }
    let events = [
      ev("inside", 1800, 5400), ev("around", -3600, 7200),
      ev("before", -3600, 0), ev("after", 3600, 7200),
      ev("allday", -36_000, 50_400, allDay: true), ev("canceled", 0, 3600, canceled: true),
      ev("mine", 0, 3600, url: ProposalFlow.marker("p-1")), ev("other", 0, 3600, url: ProposalFlow.marker("p-2")),
    ]
    XCTAssertEqual(ProposalFlow.conflicts(pid: "p-1", start: t, events: events).map(\.id), ["around", "other", "inside"])
    XCTAssertEqual(ProposalFlow.conflicts(pid: "p-1", start: t, events: []), [])
    XCTAssertEqual(ProposalFlow.eventDuration, 3600)
  }

  /// gate 결과 "conflict:<n>" 해석과 화면·잠금화면 문구. 잠금화면 본문에는 다른 일정의 제목이 없다
  func testConflictOutcomeAndCopy() throws {
    XCTAssertEqual(ProposalFlow.conflictOutcome(2), "conflict:2")
    XCTAssertEqual(ProposalFlow.conflictCount("conflict:2"), 2)
    XCTAssertNil(ProposalFlow.conflictCount("ok")); XCTAssertNil(ProposalFlow.conflictCount("fail:x")); XCTAssertNil(ProposalFlow.conflictCount("dup"))
    XCTAssertEqual(ProposalFlow.conflictNoticeID("p-1"), "conflict-p-1")
    XCTAssertEqual(ProposalFlow.conflictNoticeTitle, "겹치는 일정이 있습니다")
    XCTAssertEqual(ProposalFlow.conflictNoticeBody(2), "같은 시간에 다른 일정 2건 · 탭해서 확인")
    let t = try XCTUnwrap(ISO8601DateFormatter().date(from: "2026-10-04T05:00:00Z"))         // 서울 14:00
    let a = ProposalFlow.CalendarEvent(id: "a", title: "합성 회의", start: t, end: t.addingTimeInterval(3600))
    let b = ProposalFlow.CalendarEvent(id: "b", title: "합성 모임", start: t.addingTimeInterval(1800), end: t.addingTimeInterval(5400))
    XCTAssertEqual(ProposalFlow.conflictLine([a]), "겹치는 일정: 14:00–15:00 합성 회의")
    XCTAssertEqual(ProposalFlow.conflictLine([a, b]), "겹치는 일정: 14:00–15:00 합성 회의 외 1건")
    XCTAssertNil(ProposalFlow.conflictLine([]))
    XCTAssertEqual(ProposalFlow.confirmTitle([a]), "같은 시간에 '합성 회의' 일정이 있습니다. 그래도 추가할까요?")
    XCTAssertEqual(ProposalFlow.confirmTitle([]), "같은 시간에 다른 일정이 있습니다. 그래도 추가할까요?")
  }
```

`ProposalReviewTests.swift`에 추가:

```swift
  /// §10 겹침 로컬 알림: 탭하면 ADD_EVENT 배너처럼 제안 시트. 목록에 있으면 서버 값, 목록을 못 읽으면 알림 값으로 추가(offline), 목록에 없으면 처리됨
  func testConflictNoticeOpensSheet() throws {
    let f = ["proposal_id": pid, "title": "합성 회의", "start": "2026-10-02T15:30:00+09:00", "version": "2"]
    XCTAssertTrue(ProposalReview.categories.contains(ProposalReview.conflictCategory))
    let link = try XCTUnwrap(ProposalReview.link(actionIdentifier: ProposalReview.defaultAction, category: ProposalReview.conflictCategory, fields: f))
    XCTAssertEqual(ProposalReview.sheet(for: link, list: nil), .offline(f))
    let row = try XCTUnwrap(ProposalReview.decodeList(listJSON())?.first)
    XCTAssertEqual(ProposalReview.sheet(for: link, list: [row]), .pending(row))
    XCTAssertEqual(ProposalReview.sheet(for: link, list: []), .processed)
  }
```

`ChatReplyTests.swift`에 추가:

```swift
  /// 겹침(conflict:<n>)은 화면이 확인창으로 가로채지만, 문구로 떨어져도 뜻이 통하고 다시 누를 수 있게
  func testAddFeedbackConflict() {
    XCTAssertEqual(ChatReply.addFeedback("conflict:1").text, "같은 시간에 다른 일정이 있습니다")
    XCTAssertTrue(ChatReply.addFeedback("conflict:1").retry)
  }
```

- [ ] **Step 2: 실패 확인**

Run: `pgrep -x deno; vm_stat | grep -E 'free|compressor'; cd ios && ./scripts/sim.sh gen && ./scripts/sim.sh test EruriCoreTests/ProposalFlowTests`
Expected: FAIL(컴파일 오류 — `CalendarEvent`·`conflicts` 없음).

- [ ] **Step 3: EruriCore 구현**

`ProposalFlow.swift`의 `reportFollowUp` 아래(enum 닫는 `}` 앞)에 더한다:

```swift
  /// 기기 캘린더 일정 한 건(EventKit 을 모르는 판단용 값). 앱 CalendarLookup 이 EKEvent 에서 만든다
  public struct CalendarEvent: Equatable, Sendable {
    public let id: String; public let title: String; public let start: Date; public let end: Date
    public let allDay: Bool; public let canceled: Bool; public let url: URL?
    public init(id: String, title: String, start: Date, end: Date, allDay: Bool = false, canceled: Bool = false, url: URL? = nil) {
      self.id = id; self.title = title; self.start = start; self.end = end; self.allDay = allDay; self.canceled = canceled; self.url = url
    }
  }
  /// AddEventGate 가 저장하는 길이. 겹침은 이 구간으로 판정한다(제안 end 는 저장에 쓰지 않는다)
  public static let eventDuration: TimeInterval = 3600

  /// 겹침(스펙 §10 순서 3): 저장 구간 [start, start+1시간)과 겹치는 기존 일정, 시작 순.
  /// 종일·취소·같은 제안 표식(복구 경로)은 제외, 맞닿기만 하면(끝 = 시작) 겹침 아님
  public static func conflicts(pid: String, start: Date, events: [CalendarEvent]) -> [CalendarEvent] {
    let end = start.addingTimeInterval(eventDuration), m = marker(pid)
    return events.filter { !$0.allDay && !$0.canceled && $0.url != m && $0.start < end && $0.end > start }.sorted { $0.start < $1.start }
  }

  /// AddEventGate 결과 "conflict:<건수>" — 저장하지 않았고 서버 보고도 없다(제안은 proposed 로 남는다)
  public static func conflictOutcome(_ n: Int) -> String { "conflict:\(n)" }
  public static func conflictCount(_ outcome: String) -> Int? {
    guard outcome.hasPrefix("conflict:") else { return nil }
    return Int(outcome.dropFirst("conflict:".count))
  }

  /// 제안 시트·제안 탭 줄: "겹치는 일정: 14:00–15:00 합성 회의"(서울), 여러 건이면 " 외 N건"
  public static func conflictLine(_ c: [CalendarEvent]) -> String? {
    guard let f = c.first else { return nil }
    return "겹치는 일정: \(hm.string(from: f.start))–\(hm.string(from: f.end)) \(f.title)" + (c.count > 1 ? " 외 \(c.count - 1)건" : "")
  }
  /// 확인창 제목(앱 안에서만 — 제목을 보여도 된다)
  public static func confirmTitle(_ c: [CalendarEvent]) -> String {
    guard let f = c.first else { return "같은 시간에 다른 일정이 있습니다. 그래도 추가할까요?" }
    return "같은 시간에 '\(f.title)' 일정이 있습니다. 그래도 추가할까요?"
  }

  /// 잠금화면 "추가"가 겹침으로 멈췄을 때의 로컬 알림(§10). 다른 일정의 제목은 잠금화면에 쓰지 않는다. 식별자를 고정해 두 번 탭해도 1건
  public static let conflictNoticeTitle = "겹치는 일정이 있습니다"
  public static func conflictNoticeBody(_ n: Int) -> String { "같은 시간에 다른 일정 \(n)건 · 탭해서 확인" }
  public static func conflictNoticeID(_ pid: String) -> String { "conflict-\(pid)" }

  private static let hm: DateFormatter = {
    let f = DateFormatter()
    f.locale = Locale(identifier: "en_US_POSIX"); f.timeZone = TimeZone(identifier: "Asia/Seoul"); f.dateFormat = "HH:mm"
    return f
  }()
```

`ProposalReview.swift`: `public static let categories: Set<String> = ["ADD_EVENT", "ADD_REMINDER", "REVIEW"]`를 아래로 바꾼다:

```swift
  /// 잠금화면 "추가"가 겹침으로 멈췄을 때의 로컬 알림 카테고리(액션 없음). 탭하면 ADD_EVENT 배너처럼 제안 시트(스펙 §10)
  public static let conflictCategory = "ADD_EVENT_CONFLICT"
  public static let categories: Set<String> = ["ADD_EVENT", "ADD_REMINDER", "REVIEW", conflictCategory]
```

`sheet(for:list:)`의 `guard link.category == "ADD_EVENT" else { return .needsReview }`를 `guard link.category == "ADD_EVENT" || link.category == conflictCategory else { return .needsReview }`로 바꾼다.

`ChatReply.swift` `addFeedback`의 `default:` 앞에 더한다:

```swift
    case let o where ProposalFlow.conflictCount(o) != nil: ("같은 시간에 다른 일정이 있습니다", true)
```

그리고 이 함수 주석의 반환 목록에 `conflict:<n>`을 더한다.

- [ ] **Step 4: 통과 확인**

Run: `cd ios && ./scripts/sim.sh test EruriCoreTests/ProposalFlowTests && ./scripts/sim.sh test EruriCoreTests/ProposalReviewTests && ./scripts/sim.sh test EruriCoreTests/ChatReplyTests`
Expected: PASS.

- [ ] **Step 5: 앱 — CalendarLookup · NotificationActions**

Create `ios/App/CalendarLookup.swift`:

```swift
import EventKit
import EruriCore

/// 기기 캘린더 읽기(스펙 §9 "일정 질문과 기기 캘린더"·§10 겹침·§12 통제 2). 읽은 일정은 화면·판정에만 쓰고 서버·Trace 로 보내지 않는다
enum CalendarLookup {
  static var fullAccess: Bool { EKEventStore.authorizationStatus(for: .event) == .fullAccess }

  /// [from, to] 에 걸친 일정. startDate·endDate 가 없는 항목은 버린다(SDK 상 Date! — 암시적 언래핑으로 죽지 않게)
  static func events(_ store: EKEventStore, from: Date, to: Date) -> [ProposalFlow.CalendarEvent] {
    store.events(matching: store.predicateForEvents(withStart: from, end: to, calendars: nil)).compactMap(value)
  }

  static func value(_ e: EKEvent) -> ProposalFlow.CalendarEvent? {
    guard let s = e.startDate, let t = e.endDate else { return nil }
    return ProposalFlow.CalendarEvent(id: e.eventIdentifier ?? e.calendarItemIdentifier, title: e.title ?? "", start: s, end: t,
                                      allDay: e.isAllDay, canceled: e.status == .canceled, url: e.url)
  }

  /// 제안 시각의 겹침(시트·제안 탭·채팅 확인창의 미리 판정). 전체 접근이 없으면 빈 배열 — 최종 판정은 AddEventGate 가 다시 한다
  static func conflicts(pid: String, start: Date) -> [ProposalFlow.CalendarEvent] {
    guard fullAccess else { return [] }
    let store = EKEventStore()
    let (from, to) = ProposalFlow.searchWindow(start: start)
    return ProposalFlow.conflicts(pid: pid, start: start, events: events(store, from: from, to: to))
  }
}
```

`ios/App/NotificationActions.swift`:

(1) `register()`의 `setNotificationCategories([…])` 배열 끝에 더한다:

```swift
      // 겹침으로 멈춘 잠금화면 추가의 로컬 알림(§10, 0.8.0). 버튼 없음 — 탭하면 제안 시트
      UNNotificationCategory(identifier: ProposalReview.conflictCategory, actions: [], intentIdentifiers: []),
```

(2) `handleAdd`를 아래로 바꾼다(주석의 반환 목록 포함):

```swift
  /// 스펙 §10 순서 1~5. fields: proposal_id·title·start(+09:00)·version. confirmed: 겹침을 사용자가 확인했음(앱 안 확인창 뒤에만 true)
  /// 백그라운드 실행 시간 안에 EventKit 쓰기와 완료 핸들러가 끝나도록 네트워크 구간마다 마감을 둔다(M1-②c 리뷰):
  /// 순서 1 조회 5초 + 순서 4 보고 5초, 둘 다 토큰 갱신 포함. 겹침이면 보고를 건너뛴다(저장 안 함)
  /// 반환: AddEventGate 결과(ok·recovered·dup·conflict:<n>·fail:<코드>) · "skip_<why>" · "invalid_payload".
  /// 알림 액션은 conflict 면 로컬 알림으로 넘기고(델리게이트), 채팅 카드·시트는 확인창을 띄운다
  @discardableResult
  static func handleAdd(fields f: [String: String], confirmed: Bool = false) async -> String {
    let started = Date()
    guard let pid = f["proposal_id"], UUID(uuidString: pid) != nil, let title = f["title"], let s = f["start"],
          let start = ISO8601DateFormatter().date(from: s) else {
      Trace.log("action.handled", ["result": "invalid_payload"]); return "invalid_payload"
    }
    // 1. 서버 최신 상태(토큰 갱신 포함 5초). 넘기거나 오프라인이면 건너뛰고 받은 버전으로 실행(순서 5)
    let server = await Deadline.run(seconds: 5) { await serverProposal(pid) }
    if case .stop(let why) = ProposalFlow.check(serverStatus: server?.status) {
      await ExecutionReporter.notice(title: "이미 처리된 제안", body: why == "stale" ? "제안이 바뀌어 추가하지 않았습니다." : "이미 캘린더에 추가된 제안입니다.")
      trace("skip_\(why)", pid: pid, started: started); return "skip_\(why)"
    }
    // 기록·보고 version 은 실제로 넣은 내용(푸시 페이로드)의 것. 서버가 더 새 version 이면 보고 결과 changed 로 알린다(순서 5)
    let version = Int(f["version"] ?? "") ?? server?.version ?? 1
    // 2~3. 확인 → 표식 조회 → 겹침 → 저장 → 기록(한 actor 구간, await 없음)
    let outcome = await AddEventGate.shared.add(AddEventRequest(pid: pid, title: title, start: start, version: version, confirmed: confirmed))
    trace(outcome, pid: pid, started: started)
    // 4. 이 제안 1건만 보고(5초). 실패·겹침(저장 안 함)은 보고하지 않는다. 나머지 미보고분은 앱 활성화 flush 가 보낸다
    if !outcome.hasPrefix("fail"), ProposalFlow.conflictCount(outcome) == nil { await ExecutionReporter.shared.report(proposalId: pid, within: 5) }
    return outcome
  }

  /// 잠금화면 "추가"가 겹침으로 멈췄을 때(스펙 §10): 저장 대신 로컬 알림 1건. 원래 제안 필드를 userInfo 에 그대로 실어
  /// 탭하면 배너 탭 경로(ProposalReview.link → 제안 시트)로 간다. 다른 일정의 제목은 쓰지 않는다. 식별자 고정 — 두 번 탭해도 1건. 네트워크 없음
  static func conflictNotice(fields f: [String: String], count: Int) async {
    guard let pid = f["proposal_id"] else { return }
    let c = UNMutableNotificationContent()
    c.title = ProposalFlow.conflictNoticeTitle; c.body = ProposalFlow.conflictNoticeBody(count)
    c.categoryIdentifier = ProposalReview.conflictCategory
    var info: [String: Any] = ["proposal_id": pid]
    for k in ["title", "start"] { if let v = f[k] { info[k] = v } }
    if let v = f["version"].flatMap({ Int($0) }) { info["version"] = v }       // 델리게이트가 version 을 Int 로 읽는다
    c.userInfo = info
    try? await UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: ProposalFlow.conflictNoticeID(pid), content: c, trigger: nil))
    DiagLog.append("ADD conflict notice n=\(count) \(pid)")
  }
```

(3) `struct AddEventRequest`를 아래로 바꾼다:

```swift
struct AddEventRequest: Sendable { let pid: String; let title: String; let start: Date; let version: Int; var confirmed = false }
```

(4) `AddEventGate`의 주석과 `add`를 아래로 바꾼다:

```swift
/// 확인 → 표식 조회 → 겹침 판정 → 저장 → 기록을 await 없이 한 actor 안에서 처리한다(스펙 §10 순서 2~3, PoC-5 실측: 동시 두 번 탭 +1).
/// 반환: "ok" · "recovered"(저장 후 기록 전 종료 복구) · "dup" · "conflict:<n>"(겹침, 저장 안 함) · "fail:<코드>"
actor AddEventGate {
  static let shared = AddEventGate()
  func add(_ r: AddEventRequest) -> String {
    do {
      let ex = try Executions.shared()
      if try ex.existing(proposalId: r.pid) != nil { return "dup" }
      let store = EKEventStore()
      let (from, to) = ProposalFlow.searchWindow(start: r.start)
      let events = CalendarLookup.events(store, from: from, to: to)
      if let found = ProposalFlow.matchMarker(pid: r.pid, events: events.map { (id: $0.id, url: $0.url) }) {
        try ex.record(proposalId: r.pid, eventkitId: found, version: r.version)
        return "recovered"
      }
      // 겹침(§10 순서 3): 표식 조회에 쓴 같은 배열로 판정 — EventKit 조회·await 가 늘지 않는다. 확인받지 않았으면 저장하지 않는다
      if !r.confirmed {
        let c = ProposalFlow.conflicts(pid: r.pid, start: r.start, events: events)
        if !c.isEmpty { return ProposalFlow.conflictOutcome(c.count) }
      }
      guard let cal = store.defaultCalendarForNewEvents, cal.allowsContentModifications else { return "fail:no_writable_calendar" }  // §10 읽기 전용 제외
      let ev = EKEvent(eventStore: store)
      ev.title = r.title; ev.startDate = r.start; ev.endDate = r.start.addingTimeInterval(ProposalFlow.eventDuration)
      ev.calendar = cal
      ev.url = ProposalFlow.marker(r.pid)
      try store.save(ev, span: .thisEvent, commit: true)
      let eid: String = ev.eventIdentifier ?? ev.calendarItemIdentifier   // SDK 상 String! — nil 이면 암시적 언래핑으로 죽는다
      try ex.record(proposalId: r.pid, eventkitId: eid, version: r.version)
      return "ok"
    } catch { return "fail:\(type(of: error))" }
  }
}
```

(5) `NotificationDelegate`의 ADD 분기 끝 `Task { await NotificationActions.handleAdd(fields: fields); DispatchQueue.main.async { done.value() } }`를 아래로 바꾼다 — **완료 핸들러는 여전히 이 한 곳에서 메인 1회**:

```swift
    Task {
      let outcome = await NotificationActions.handleAdd(fields: fields)
      // 겹침이면 저장하지 않았다 — 앱 확인을 유도하는 로컬 알림 1건(네트워크 없음, 5초 마감 안). 그 뒤 기존처럼 완료
      if let n = ProposalFlow.conflictCount(outcome) { await NotificationActions.conflictNotice(fields: fields, count: n) }
      DispatchQueue.main.async { done.value() }
    }
```

- [ ] **Step 6: 앱 — 제안 시트·탭 행, 채팅 카드**

`ios/App/ProposalsView.swift`의 `struct ProposalActionsView` 전체를 아래로 바꾼다:

```swift
/// 제안 한 건: 제목·시각·장소, "캘린더에 추가"(addFields 가 있을 때만)·"무시". 결과를 아래에 쓰고, 실패면 버튼을 다시 켠다.
/// 겹침(스펙 §10, 0.8.0): 뜰 때·앱 활성화 때 미리 판정해 "겹치는 일정" 줄과 "겹쳐도 추가"를 보이고, 확인창 뒤 confirmed 로 부른다.
/// 최종 판정은 AddEventGate — 미리 판정 뒤 캘린더가 바뀌어 conflict 가 오면 다시 읽고 같은 확인창
struct ProposalActionsView: View {
  let title: String; let when: String; let location: String?; let addFields: [String: String]?; let proposalId: String
  @Binding var state: ProposalReview.ActionState
  @Environment(\.scenePhase) private var scenePhase
  @State private var conflicts: [ProposalFlow.CalendarEvent] = []
  @State private var askConfirm = false

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(title).font(.headline)
      Text(when).font(.subheadline).foregroundStyle(.secondary)
      if let location { Label(location, systemImage: "mappin.and.ellipse").font(.caption).foregroundStyle(.secondary) }
      if addFields != nil, let line = ProposalFlow.conflictLine(conflicts) { Text(line).font(.caption).foregroundStyle(.orange) }
      HStack {
        if addFields != nil {
          Button(state == .running ? "처리하는 중…" : (conflicts.isEmpty ? "캘린더에 추가" : "겹쳐도 추가")) {
            if conflicts.isEmpty { add(confirmed: false) } else { askConfirm = true }
          }.buttonStyle(.borderedProminent)
        }
        Button("무시") {
          state = .running
          Task { state = .after(ProposalReview.dismissFeedback(await NotificationActions.dismiss(proposalId: proposalId))) }
        }.buttonStyle(.bordered)
      }
      .disabled(!state.buttonsEnabled)
      switch state {
      case .finished(let t): Text(t).font(.caption).foregroundStyle(.secondary)
      case .failed(let t): Text(t).font(.caption).foregroundStyle(.red)
      default: EmptyView()
      }
    }
    .padding(.vertical, 4)
    .task(id: addFields?["start"]) { refreshConflicts() }
    .onChange(of: scenePhase) { _, phase in if phase == .active { refreshConflicts() } }   // 캘린더 앱에서 바꾸고 돌아온 경우
    .confirmationDialog(ProposalFlow.confirmTitle(conflicts), isPresented: $askConfirm, titleVisibility: .visible) {
      Button("추가") { add(confirmed: true) }
      Button("취소", role: .cancel) {}
    }
  }

  private func refreshConflicts() {
    conflicts = addFields?["start"].flatMap { ISO8601DateFormatter().date(from: $0) }
      .map { CalendarLookup.conflicts(pid: proposalId, start: $0) } ?? []
  }

  /// §10 경로 그대로(handleAdd). 겹침(conflict)이면 저장하지 않고 돌아오므로 다시 읽고 확인창
  private func add(confirmed: Bool) {
    guard let fields = addFields else { return }
    state = .running
    Task {
      let outcome = await NotificationActions.handleAdd(fields: fields, confirmed: confirmed)
      if ProposalFlow.conflictCount(outcome) != nil { refreshConflicts(); state = .idle; askConfirm = true }
      else { state = .after(ChatReply.addFeedback(outcome)) }
    }
  }
}
```

`ios/App/ChatView.swift`:

(1) `@State private var adds …` 줄 아래에 더한다:

```swift
  @State private var confirm: ConfirmAdd?              // 겹침 확인창(§10): 제안 id·handleAdd 필드·다시 읽은 겹치는 일정
  struct ConfirmAdd: Identifiable { let id: String; let fields: [String: String]; let conflicts: [ProposalFlow.CalendarEvent] }
```

(2) `body`의 `.safeAreaInset(edge: .bottom) { inputPanel }` 다음 줄에 더한다:

```swift
      .confirmationDialog(ProposalFlow.confirmTitle(confirm?.conflicts ?? []),
                          isPresented: Binding(get: { confirm != nil }, set: { if !$0 { confirm = nil } }),
                          titleVisibility: .visible, presenting: confirm) { c in
        Button("추가") { runAdd(c, confirmed: true) }
        Button("취소", role: .cancel) {}
      }
```

(3) `proposalCard`의 `Button(…) { adds[p.id] = .running; Task { … } }` 액션 본문을 한 줄로 바꾼다:

```swift
        runAdd(ConfirmAdd(id: p.id, fields: ["proposal_id": p.id, "title": title, "start": start], conflicts: []), confirmed: false)
```

(4) `proposalCard` 아래에 더한다:

```swift
  /// 알림 액션과 같은 §10 경로(서버 상태 확인 → 표식 조회 → 겹침 → 저장 → 보고). 겹침이면 저장하지 않고 돌아오므로
  /// 겹치는 일정을 다시 읽어 확인창을 띄우고, "추가"면 confirmed 로 다시 부른다. 결과를 카드에 쓰고, 실패면 버튼을 다시 켠다
  private func runAdd(_ c: ConfirmAdd, confirmed: Bool) {
    adds[c.id] = .running
    Task {
      let outcome = await NotificationActions.handleAdd(fields: c.fields, confirmed: confirmed)
      if ProposalFlow.conflictCount(outcome) != nil {
        adds[c.id] = nil
        let start = c.fields["start"].flatMap { ISO8601DateFormatter().date(from: $0) }
        confirm = ConfirmAdd(id: c.id, fields: c.fields, conflicts: start.map { CalendarLookup.conflicts(pid: c.id, start: $0) } ?? [])
        return
      }
      let fb = ChatReply.addFeedback(outcome)
      adds[c.id] = fb.retry ? .failed(fb.text) : .finished(fb.text)
    }
  }
```

`ios/project.yml`: `MARKETING_VERSION: 0.7.1` → `MARKETING_VERSION: 0.8.0`.

- [ ] **Step 7: 전체 테스트·빌드**

Run: `pgrep -x deno; vm_stat | grep -E 'free|compressor'; cd ios && ./scripts/sim.sh gen && ./scripts/sim.sh test && ./scripts/sim.sh build`
Expected: `EruriCoreTests` 0 failed(FM 2 skipped는 기존과 같음), `** BUILD SUCCEEDED **`. 경고로 Swift 6 동시성 오류가 새로 생기지 않는다(`CalendarLookup`은 격리 없는 enum이라 `AddEventGate` actor 안에서 `await` 없이 부른다 — `await`가 필요하다는 오류가 나면 설계가 깨진 것이니 멈추고 보고).

- [ ] **Step 8: 커밋**

```bash
git add ios/App/CalendarLookup.swift ios/App/NotificationActions.swift ios/App/ProposalsView.swift ios/App/ChatView.swift ios/project.yml ios/Packages/EruriCore
git commit -m "feat(ios): overlap check before adding a proposal — confirm dialog in sheet/tab/chat, lock-screen action posts a local notice instead (0.8.0, C2)"
```

실측 게이트는 C1 뒤 0.8.0 업로드에서 한 번에 잰다(C1 Step 9). `gates.md` `C2` 행은 그때 쓴다.

---

### Task C1: 채팅 "기기 캘린더" 절 · 제안 카드 상태 · 거절 대체 문구 (0.8.0 업로드 · 실기기 게이트)

**Files:**
- Create: `ios/Packages/EruriCore/Sources/EruriCore/DeviceCalendar.swift`
- Modify: `ios/Packages/EruriCore/Sources/EruriCore/ChatReply.swift` (`Answer.schedule`, `Schedule`)
- Modify: `ios/App/CalendarLookup.swift` (`scheduleEvents`, `cardStatuses`)
- Modify: `ios/App/ChatView.swift` (`Turn`, `send`, `readCalendar`, `answerRows`, `calendarRows`, `proposalCard`)
- Modify: `ios/App/ProposalsView.swift` (`CalendarAccessPrompt` 추가)
- Modify: `ios/App/Info.plist` (`NSCalendarsFullAccessUsageDescription`)
- Test: `ios/Packages/EruriCore/Tests/EruriCoreTests/DeviceCalendarTests.swift`(생성), `ChatReplyTests.swift`
- Docs: `docs/superpowers/phase1/gates.md` 행 `C2`·`C1`

**Interfaces:**
- Consumes: S3 `POST /chat` `schedule: {from, to} | null`, C2 `ProposalFlow.CalendarEvent`·`conflicts`·`CalendarLookup.events`/`value`/`fullAccess`.
- Produces(EruriCore): `ChatReply.Answer.schedule: ChatReply.Schedule?`, `public struct ChatReply.Schedule: Decodable, Sendable, Equatable { from: String; to: String; var interval: DateInterval? }`; `public enum DeviceCalendar { maxLines = 5; header; emptyText; accessText; visible(_:); lines(_:) -> (lines: [String], more: Int); label(_:); refusalText(events:) -> String?; enum CardStatus { clear, inCalendar, conflict }; cardStatus(pid:title:start:events:); statusText(_:) }`. 앱: `CalendarLookup.scheduleEvents(_ interval: DateInterval) -> [ProposalFlow.CalendarEvent]`, `CalendarLookup.cardStatuses(_ cards: [(pid: String, title: String, start: Date)]) -> [String: DeviceCalendar.CardStatus]`, `struct CalendarAccessPrompt: View(message:onChange:)`.

- [ ] **Step 1: 실패하는 테스트**

Create `ios/Packages/EruriCore/Tests/EruriCoreTests/DeviceCalendarTests.swift`:

```swift
import XCTest
@testable import EruriCore

/// 스펙 §9 "일정 질문과 기기 캘린더": 절 문구(서울, 최대 5 + 외 N건), 거절 대체 문구, 제안 카드 상태
final class DeviceCalendarTests: XCTestCase {
  private let t = ISO8601DateFormatter().date(from: "2026-10-03T05:00:00Z")!            // 서울 10/3(토) 14:00
  private func ev(_ id: String, _ offset: TimeInterval, title: String? = nil, allDay: Bool = false, canceled: Bool = false,
                  url: URL? = nil) -> ProposalFlow.CalendarEvent {
    ProposalFlow.CalendarEvent(id: id, title: title ?? "합성 \(id)", start: t.addingTimeInterval(offset), end: t.addingTimeInterval(offset + 3600),
                               allDay: allDay, canceled: canceled, url: url)
  }

  func testLabelSeoulWeekdayAndAllDay() {
    XCTAssertEqual(DeviceCalendar.label(ev("a", 0)), "10/3(토) 14:00 합성 a")
    XCTAssertEqual(DeviceCalendar.label(ev("b", 0, allDay: true)), "10/3(토) 종일 합성 b")
  }

  func testLinesSortedCappedCanceledDropped() {
    let evs = (0..<7).reversed().map { ev("e\($0)", TimeInterval($0) * 3600) } + [ev("x", -3600, canceled: true)]
    let l = DeviceCalendar.lines(evs)
    XCTAssertEqual(l.lines.count, 5); XCTAssertEqual(l.more, 2)
    XCTAssertEqual(l.lines.first, "10/3(토) 14:00 합성 e0")
    XCTAssertEqual(DeviceCalendar.lines([]).lines, []); XCTAssertEqual(DeviceCalendar.lines([]).more, 0)
  }

  /// 거절인데 그 기간 일정이 있으면 거절 문구 대신(취소된 일정은 세지 않는다)
  func testRefusalText() {
    XCTAssertEqual(DeviceCalendar.refusalText(events: [ev("a", 0), ev("b", 3600)]), "저장된 메일·문자에는 없고, 캘린더에 2건 있습니다")
    XCTAssertNil(DeviceCalendar.refusalText(events: [ev("c", 0, canceled: true)]))
    XCTAssertNil(DeviceCalendar.refusalText(events: []))
  }

  /// 같은 표식이거나 시작(분)·제목이 같으면 이미 있음, 아니면 §10 겹침이면 겹침, 맞닿음은 없음
  func testCardStatus() {
    XCTAssertEqual(DeviceCalendar.cardStatus(pid: "p-1", title: "합성 회의", start: t, events: [ev("m", 0, url: ProposalFlow.marker("p-1"))]), .inCalendar)
    XCTAssertEqual(DeviceCalendar.cardStatus(pid: "p-1", title: "합성 회의", start: t, events: [ev("same", 0, title: " 합성 회의 ")]), .inCalendar)
    XCTAssertEqual(DeviceCalendar.cardStatus(pid: "p-1", title: "합성 회의", start: t, events: [ev("o", 1800, title: "합성 다른 일")]), .conflict)
    XCTAssertEqual(DeviceCalendar.cardStatus(pid: "p-1", title: "합성 회의", start: t, events: [ev("late", 3600)]), .clear)
    XCTAssertEqual(DeviceCalendar.cardStatus(pid: "p-1", title: "합성 회의", start: t, events: []), .clear)
    XCTAssertEqual(DeviceCalendar.statusText(.inCalendar), "이미 캘린더에 있음")
    XCTAssertEqual(DeviceCalendar.statusText(.conflict), "같은 시간에 다른 일정 있음")
    XCTAssertNil(DeviceCalendar.statusText(.clear))
  }
}
```

`ChatReplyTests.swift`에 추가:

```swift
  /// S3 schedule: 서울 날짜 경계 구간. 키 없음(0.7.x 서버)·null·거꾸로 된 구간은 nil
  func testScheduleDecode() throws {
    let s = #""schedule":{"from":"2026-10-03T00:00:00+09:00","to":"2026-10-03T23:59:59+09:00"},"hits":"#
    let a = try XCTUnwrap(ChatReply.decode(Data(body.replacingOccurrences(of: #""hits":"#, with: s).utf8)))
    let i = try XCTUnwrap(a.schedule?.interval)
    XCTAssertEqual(i.start, ISO8601DateFormatter().date(from: "2026-10-02T15:00:00Z"))
    XCTAssertEqual(i.duration, 86_399)
    XCTAssertNil(try XCTUnwrap(ChatReply.decode(Data(body.utf8))).schedule)
    let null = body.replacingOccurrences(of: #""hits":"#, with: #""schedule":null,"hits":"#)
    XCTAssertNil(try XCTUnwrap(ChatReply.decode(Data(null.utf8))).schedule)
    let reversed = body.replacingOccurrences(of: #""hits":"#, with: #""schedule":{"from":"2026-10-04T00:00:00+09:00","to":"2026-10-03T23:59:59+09:00"},"hits":"#)
    XCTAssertNil(try XCTUnwrap(ChatReply.decode(Data(reversed.utf8))).schedule?.interval)
  }
```

- [ ] **Step 2: 실패 확인**

Run: `pgrep -x deno; cd ios && ./scripts/sim.sh gen && ./scripts/sim.sh test EruriCoreTests/DeviceCalendarTests`
Expected: FAIL(컴파일 오류 — `DeviceCalendar`·`schedule` 없음).

- [ ] **Step 3: EruriCore 구현**

Create `ios/Packages/EruriCore/Sources/EruriCore/DeviceCalendar.swift`:

```swift
import Foundation

/// 채팅 "기기 캘린더" 절·제안 카드 상태(스펙 §9 "일정 질문과 기기 캘린더"). EventKit 없이 판단·문구만 — 읽기는 앱 CalendarLookup.
/// 캘린더 내용은 기기 밖으로 나가지 않는다(§12 통제 2)
public enum DeviceCalendar {
  public static let maxLines = 5
  public static let header = "기기 캘린더"
  public static let emptyText = "이 기간에 등록된 일정 없음"
  public static let accessText = "캘린더 접근을 허용하면 등록된 일정도 함께 확인합니다"

  /// 보일 일정: 취소된 것을 빼고 시작 순
  public static func visible(_ events: [ProposalFlow.CalendarEvent]) -> [ProposalFlow.CalendarEvent] {
    events.filter { !$0.canceled }.sorted { $0.start < $1.start }
  }
  /// 절의 줄(최대 5)과 넘친 건수("외 N건")
  public static func lines(_ events: [ProposalFlow.CalendarEvent]) -> (lines: [String], more: Int) {
    let v = visible(events)
    return (v.prefix(maxLines).map(label), max(0, v.count - maxLines))
  }
  /// "10/3(토) 14:00 합성 회의", 종일이면 "10/3(토) 종일 합성 회의"(서울 벽시계)
  public static func label(_ e: ProposalFlow.CalendarEvent) -> String {
    let c = seoul.dateComponents([.month, .day, .weekday, .hour, .minute], from: e.start)
    let day = "\(c.month ?? 0)/\(c.day ?? 0)(\(weekdays[((c.weekday ?? 1) + 6) % 7]))"
    return "\(day) \(e.allDay ? "종일" : String(format: "%02ld:%02ld", c.hour ?? 0, c.minute ?? 0)) \(e.title)"
  }
  /// 거절 답변인데 그 기간 일정이 있으면 거절 문구 대신 보일 문장. 없으면 nil(거절 문구 그대로)
  public static func refusalText(events: [ProposalFlow.CalendarEvent]) -> String? {
    let n = visible(events).count
    return n > 0 ? "저장된 메일·문자에는 없고, 캘린더에 \(n)건 있습니다" : nil
  }

  public enum CardStatus: Equatable, Sendable { case clear, inCalendar, conflict }
  /// 제안 카드 상태: 같은 제안 표식이거나 시작 시각(분)·제목이 같은 일정이 있으면 inCalendar, 아니면 §10 겹침이 있으면 conflict
  public static func cardStatus(pid: String, title: String, start: Date, events: [ProposalFlow.CalendarEvent]) -> CardStatus {
    let marker = ProposalFlow.marker(pid), name = title.trimmingCharacters(in: .whitespacesAndNewlines)
    let minute = { (d: Date) in Int((d.timeIntervalSince1970 / 60).rounded(.down)) }
    let same = events.contains { e in
      !e.canceled && (e.url == marker || (minute(e.start) == minute(start) && e.title.trimmingCharacters(in: .whitespacesAndNewlines) == name))
    }
    if same { return .inCalendar }
    return ProposalFlow.conflicts(pid: pid, start: start, events: events).isEmpty ? .clear : .conflict
  }
  public static func statusText(_ s: CardStatus) -> String? {
    switch s {
    case .clear: nil
    case .inCalendar: "이미 캘린더에 있음"
    case .conflict: "같은 시간에 다른 일정 있음"
    }
  }

  private static let weekdays = ["일", "월", "화", "수", "목", "금", "토"]      // Calendar.weekday 1 = 일요일
  private static let seoul: Calendar = {
    var c = Calendar(identifier: .gregorian)
    c.timeZone = TimeZone(identifier: "Asia/Seoul")!
    return c
  }()
}
```

(`weekdays[((c.weekday ?? 1) + 6) % 7]`: weekday 1(일) → 0, 7(토) → 6.)

`ChatReply.swift`: `Answer`의 `archiveIDs` 줄 아래에 더한다:

```swift
    /// 일정 질문의 일정 기간(스펙 §9 "일정 질문과 기기 캘린더", 서버 S3). 앱이 이 기간의 기기 캘린더를 읽는다. 0.7.x 서버·일정 질문이 아니면 nil
    public let schedule: Schedule?
```

`Answer` 구조체 아래(같은 enum 안)에 더한다:

```swift
  public struct Schedule: Decodable, Sendable, Equatable {
    public let from: String; public let to: String
    /// [from, to] 구간. 읽지 못하거나 거꾸로면 nil(앱은 캘린더를 읽지 않는다)
    public var interval: DateInterval? {
      guard let a = ChatReply.iso.date(from: from), let b = ChatReply.iso.date(from: to), a <= b else { return nil }
      return DateInterval(start: a, end: b)
    }
  }
```

파일 머리 주석의 계약 목록에 `schedule`을 더한다(`… hits, candidates, schedule}`).

- [ ] **Step 4: 통과 확인**

Run: `cd ios && ./scripts/sim.sh test EruriCoreTests/DeviceCalendarTests && ./scripts/sim.sh test EruriCoreTests/ChatReplyTests`
Expected: PASS.

- [ ] **Step 5: 앱 — CalendarLookup · 권한 안내 · Info.plist**

`ios/App/CalendarLookup.swift`의 enum 끝에 더한다:

```swift
  /// "기기 캘린더" 절(§9): 서버가 준 일정 기간(≤ 31일)의 일정. 생일·구독(공휴일) 캘린더는 뺀다. 진단 로그에는 개수만
  static func scheduleEvents(_ interval: DateInterval) -> [ProposalFlow.CalendarEvent] {
    guard fullAccess else { return [] }
    let store = EKEventStore()
    let cals = store.calendars(for: .event).filter { $0.type != .birthday && $0.type != .subscription }
    guard !cals.isEmpty else { return [] }
    let found = store.events(matching: store.predicateForEvents(withStart: interval.start, end: interval.end, calendars: cals)).compactMap(value)
    DiagLog.append("CAL schedule n=\(found.count)")
    return found
  }

  /// 채팅 제안 카드 상태(§9): 카드마다 제안 시각 ±1일을 읽어 판정
  static func cardStatuses(_ cards: [(pid: String, title: String, start: Date)]) -> [String: DeviceCalendar.CardStatus] {
    guard fullAccess, !cards.isEmpty else { return [:] }
    let store = EKEventStore()
    return cards.reduce(into: [:]) { out, c in
      let (from, to) = ProposalFlow.searchWindow(start: c.start)
      out[c.pid] = DeviceCalendar.cardStatus(pid: c.pid, title: c.title, start: c.start, events: events(store, from: from, to: to))
    }
  }
```

`ios/App/ProposalsView.swift`: `struct CalendarAccessSection` 위에 더한다(`CalendarAccessSection`은 그대로 둔다):

```swift
/// 채팅 일정 질문의 캘린더 접근 안내 한 줄(§9): 목록 행 안에 들어가므로 Section 이 아니고 버튼은 borderless.
/// 아직 묻지 않았으면 여기서 묻고, 거부·추가만 허용이면 설정 앱으로
struct CalendarAccessPrompt: View {
  let message: String
  let onChange: () -> Void
  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      Text(message).font(.caption).foregroundStyle(.secondary)
      if EKEventStore.authorizationStatus(for: .event) == .notDetermined {
        Button("캘린더 접근 허용") {
          Task {
            _ = try? await EKEventStore().requestFullAccessToEvents()
            NotificationActions.register()
            onChange()
          }
        }.buttonStyle(.borderless).font(.caption)
      } else if let url = URL(string: UIApplication.openSettingsURLString) {
        Link("설정에서 허용하기", destination: url).font(.caption)
      }
    }
  }
}
```

`ios/App/Info.plist`: `<key>NSCalendarsFullAccessUsageDescription</key><string>제안된 일정을 캘린더에 추가합니다.</string>`를 아래로:

```xml
  <key>NSCalendarsFullAccessUsageDescription</key><string>등록된 일정을 확인하고 제안된 일정을 추가합니다. 일정 내용은 기기 밖으로 보내지 않습니다.</string>
```

- [ ] **Step 6: 앱 — ChatView**

`ios/App/ChatView.swift`:

(1) `struct Turn` 줄을 아래로 바꾼다:

```swift
  struct Turn: Identifiable {
    let id = UUID(); let question: String; var answer: ChatReply.Answer?; var error: String?
    var calendar: [ProposalFlow.CalendarEvent]?                 // "기기 캘린더" 절(§9): 일정 기간의 기기 일정. nil = 일정 질문 아님·읽지 않음
    var cardStatus: [String: DeviceCalendar.CardStatus] = [:]   // 제안 id → 그 시각 캘린더 상태
  }
```

(2) `body`의 `if let a = t.answer { answerRows(a, question: t.question) }`를 `if let a = t.answer { answerRows(t, a) }`로 바꾼다.

(3) `send()`의 `if let a = ChatReply.decode(r.data) { turns[idx].answer = a } else { … }`를 아래로:

```swift
          if let a = ChatReply.decode(r.data) { turns[idx].answer = a; readCalendar(idx, a) } else { turns[idx].error = "응답을 읽지 못했습니다" }
```

(4) `answerRows`를 아래로 바꾼다(인용·보관함 버튼 부분은 기존 그대로 옮긴다):

```swift
  @ViewBuilder private func answerRows(_ t: Turn, _ a: ChatReply.Answer) -> some View {
    // 거절인데 그 기간 기기 캘린더에 일정이 있으면 거절 문구 대신(기기 안 문구, §9)
    Text(a.refused ? DeviceCalendar.refusalText(events: t.calendar ?? []) ?? a.answer : a.answer)
    ForEach(a.citations) { c in
      HStack {
        NavigationLink {
          ItemDetailView(itemID: c.item_id)
        } label: {
          VStack(alignment: .leading) {
            Text(c.title ?? "(제목 없음)").font(.caption)
            Text("\(SourceLabel.label(source: c.source, appName: c.app_name)) · \(ChatReply.seoulLabel(c.occurred_at))\(c.expired ? " · 원문 만료됨" : "")")
              .font(.caption2).foregroundStyle(.secondary)
          }
        }
        judgeButton(a.answer_id, c.item_id, true, "👍")
        judgeButton(a.answer_id, c.item_id, false, "👎")
      }
    }
    // 스펙 §9 채팅 → 보관함 보기: 인용 ∪ 구별 facts ∪ 관련도 컷(서버 S1). 거절 답변·후보 없음이면 숨긴다(0.7.1)
    if let ids = a.archiveIDs {
      let scope = Archive.Scope(question: t.question, ids: ids)
      Button("보관함에서 보기 (\(scope.ids.count)건)") { ArchiveRouter.shared.open(scope) }
        .font(.caption).buttonStyle(.borderless)
    }
    if a.schedule != nil { calendarRows(t, a) }
    // 푸시 "추가" 액션과 같이 캘린더 전체 접근이 없으면 카드를 숨긴다(§10 권한 철회)
    if CalendarLookup.fullAccess {
      ForEach(a.proposals) { p in
        if let start = ChatReply.calendarStart(p) {
          proposalCard(p, title: p.payload["title"]?.string ?? "일정", start: start, status: t.cardStatus[p.id] ?? .clear)
        }
      }
    }
  }

  /// "기기 캘린더" 절(§9 일정 질문과 기기 캘린더). 전체 접근이 없으면(추가만 허용 포함) 절 대신 안내 한 줄 — 허용하면 이 턴을 다시 읽는다
  @ViewBuilder private func calendarRows(_ t: Turn, _ a: ChatReply.Answer) -> some View {
    if !CalendarLookup.fullAccess {
      CalendarAccessPrompt(message: DeviceCalendar.accessText) {
        if let i = turns.firstIndex(where: { $0.id == t.id }) { readCalendar(i, a) }
      }
    } else if let events = t.calendar {
      let l = DeviceCalendar.lines(events)
      VStack(alignment: .leading, spacing: 2) {
        Text(DeviceCalendar.header).font(.caption).bold()
        if l.lines.isEmpty { Text(DeviceCalendar.emptyText).font(.caption2).foregroundStyle(.secondary) }
        ForEach(Array(l.lines.enumerated()), id: \.offset) { Text($0.element).font(.caption2) }
        if l.more > 0 { Text("외 \(l.more)건").font(.caption2).foregroundStyle(.secondary) }
      }
    }
  }

  /// 기기 캘린더(§9·§12 통제 2): 이 답의 일정 기간 일정과 제안 카드 상태를 기기 안에서만 읽어 턴에 둔다. 서버로 보내지 않는다
  private func readCalendar(_ idx: Int, _ a: ChatReply.Answer) {
    guard CalendarLookup.fullAccess else { return }
    if let range = a.schedule?.interval { turns[idx].calendar = CalendarLookup.scheduleEvents(range) }
    let cards = a.proposals.compactMap { p -> (pid: String, title: String, start: Date)? in
      guard let s = ChatReply.calendarStart(p), let at = ISO8601DateFormatter().date(from: s) else { return nil }
      return (p.id, p.payload["title"]?.string ?? "일정", at)
    }
    turns[idx].cardStatus = CalendarLookup.cardStatuses(cards)
  }
```

(5) `proposalCard` 시그니처에 `status: DeviceCalendar.CardStatus`를 더하고, 버튼 아래(`switch state` 앞)에 상태 줄을 넣는다:

```swift
  @ViewBuilder private func proposalCard(_ p: ChatReply.Proposal, title: String, start: String, status: DeviceCalendar.CardStatus) -> some View {
```

```swift
      if let s = DeviceCalendar.statusText(status) {
        Text(s).font(.caption).foregroundStyle(status == .conflict ? Color.orange : Color.secondary)
      }
```

`import EventKit`는 `ChatView.swift`에서 더 쓰지 않으면 지운다(`CalendarLookup`이 대신한다 — 컴파일러 경고로 확인).

- [ ] **Step 7: 전체 테스트·빌드·시뮬레이터 눈 확인**

Run: `pgrep -x deno; vm_stat | grep -E 'free|compressor'; cd ios && ./scripts/sim.sh gen && ./scripts/sim.sh test && ./scripts/sim.sh build`
Expected: 0 failed, `** BUILD SUCCEEDED **`.

시뮬레이터(pane 전용 UDID)에서 `./scripts/sim.sh install && ./scripts/sim.sh launch` 후 캘린더 권한을 허용하고 채팅에 "내일 일정 있어?"를 보내 "기기 캘린더" 절이 뜨는지(시뮬레이터 캘린더가 비어 있으면 "이 기간에 등록된 일정 없음") 스크린샷 1장으로 확인한다(S3 배포 전이면 `schedule`이 없어 절이 안 뜬다 — 그때는 이 확인을 실기기 게이트로 넘긴다).

- [ ] **Step 8: 커밋 · 업로드**

```bash
git add ios/App/CalendarLookup.swift ios/App/ChatView.swift ios/App/ProposalsView.swift ios/App/Info.plist ios/Packages/EruriCore
git commit -m "feat(ios): chat shows the device calendar for schedule questions, proposal card status, refusal replaced when the calendar has events (0.8.0, C1)"
cd ios && ./scripts/testflight.sh
```
Expected: `Upload succeeded`, 빌드 `0.8.0 (<yyyymmddHHMM>)`. 업로드는 S3 배포와 무관하지만 **실기기 게이트(Step 9)는 S3 배포(`gates.md` S3 통과) 뒤**에 한다.

- [ ] **Step 9: 실기기 게이트 (사용자 옆, `sonnet`/`medium` 또는 `opus`/`medium`)**

준비: TestFlight 0.8.0 설치, 캘린더 "전체 접근" 허용. 날짜 `D` = 오늘 + 3일(푸시 문구 `{D+3}`와 같은 날), `E` = 오늘 + 5일. 사용자가 만드는 일정 제목은 합성 문구(`합성 겹침`, `합성 일정 가/나`)만 쓰고, 끝나면 사용자가 지운다. 서버 확인은 id·상태만:

```bash
# 머리 2줄
s "select at, fields->>'result' r, fields->>'bg' bg from device_traces where user_id = \$1 and event = 'action.handled' order by at desc limit 3" "$U"
s "select id, status, updated_at from proposals where user_id = \$1 order by created_at desc limit 3" "$U"
```

**C2 (겹침 확인)**:
1. 사용자가 캘린더 앱에서 `D` 15:00–16:00 `합성 겹침`을 만든다. 기기 잠금 20초 뒤 Mac: `deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/send-phrases.ts --only push` → 잠금화면 "일정 제안" → 길게 눌러 "캘린더에 추가" → Face ID(앱을 열지 않는다).
   기대: 캘린더에 `D` 15:30 ERURI 일정 **+0**, 잠금화면에 "겹치는 일정이 있습니다 / 같은 시간에 다른 일정 1건 · 탭해서 확인" **1건**(다른 일정 제목 없음), `action.handled` 최신 `r=conflict:1`, 제안 `status=proposed`.
2. 그 알림을 탭 → 앱이 열리고 제안 시트: "겹치는 일정: 15:00–16:00 합성 겹침", 버튼 "겹쳐도 추가" → 누르면 확인창("같은 시간에 '합성 겹침' 일정이 있습니다. 그래도 추가할까요?") → "추가".
   기대: 캘린더 `D` 15:30 ERURI 일정 **+1**, 시트 "캘린더에 추가했습니다", 제안 `status=succeeded`(보고 1초 안팎).
3. (회귀, 겹침 없음) 사용자가 `합성 겹침`과 방금 추가된 ERURI 일정을 지운다. 다시 `send-phrases.ts --only push` → 잠금화면 "캘린더에 추가" → 기대: **+1**, `r=ok`, 로컬 알림 없음, `succeeded`(M1-②d 게이트 B와 같음).
4. (제안 탭·채팅 카드) 다시 `send-phrases.ts --only push` 하고 알림은 **누르지 않는다**. 사용자가 `D` 15:00–16:00 `합성 겹침`을 다시 만든다. 앱 "제안" 탭 → 그 행에 "겹치는 일정: 15:00–16:00 합성 겹침"·"겹쳐도 추가"가 보이면 누르지 않고 "취소"까지만 확인. 채팅에서 "합성의원 진료 예약 언제야?" → 답의 제안 카드에 "같은 시간에 다른 일정 있음" → 카드 "캘린더에 추가" → 확인창 → "추가" → **+1**, 카드 "캘린더에 추가했습니다", `succeeded`.
5. (미리 판정 뒤 변경, Review Focus 1) 다시 `send-phrases.ts --only push`, 알림은 누르지 않는다. `합성 겹침`과 앞 단계의 ERURI 일정을 지우고 앱 "제안" 탭에서 그 행이 "캘린더에 추가"(겹침 없음)로 보이는 것을 확인 → 앱을 벗어나지 않고 **제어 센터 등으로 앱을 비활성화하지 않은 채** 다른 기기(Mac 캘린더, 같은 계정)에서 `D` 15:00–16:00 `합성 겹침`을 만들고 동기화를 기다린 뒤(최대 1분) 행의 "캘린더에 추가"를 누른다. 기대: 저장되지 않고 확인창이 뜬다 → "취소" → 캘린더 +0, 제안 `proposed`. (같은 계정 다른 기기가 없으면 이 단계는 "해당 기기 없음"으로 적고 시뮬레이터 대체는 하지 않는다 — 판정 논리는 C2 단위 테스트가 본다.)
6. 충돌 로그: 설정 → 개인정보 보호 및 보안 → 분석 및 향상 → 분석 데이터에 이 세션 시각의 `Eruri` 항목 없음(완료 핸들러 메인 1회, PoC-5).

**C1 (기기 캘린더 표시)**:
1. 사용자가 `E` 10:00 `합성 일정 가`, `E` 14:00 `합성 일정 나`를 만든다. 채팅 "<E의 M>월 <E의 D>일 일정 있어?" → 답 아래 "기기 캘린더" 절에 `M/D(요) 10:00 합성 일정 가`·`M/D(요) 14:00 합성 일정 나` 2줄.
2. 일정이 없는 날(오늘 + 20일, 사용자 캘린더에 그날 일정이 없는지 먼저 확인)로 같은 질문 → "이 기간에 등록된 일정 없음".
3. (거절 + 캘린더) "<E> 합성 화성 탐사 일정 있어?" → 서버 거절이면 거절 문구 대신 "저장된 메일·문자에는 없고, 캘린더에 2건 있습니다", "보관함에서 보기" 없음. 서버가 거절하지 않으면 답 그대로 + 절 2줄로 적는다.
4. (권한) 설정 → ERURI → 캘린더 → "이벤트 추가만"으로 바꾸고 1의 질문 → 절 없음, 한 줄 "캘린더 접근을 허용하면 등록된 일정도 함께 확인합니다" + "설정에서 허용하기", 답변은 그대로. 끝나면 "전체 접근"으로 되돌린다.
5. (기기 밖으로 안 나감) `grep -n 'functions/v1/chat' ios/App/ChatView.swift` → 요청 본문이 `["question": q]`뿐. 앱 설정 → 진단(있으면)의 DiagLog에 `CAL schedule n=2`처럼 개수만 있고 일정 제목 없음. `s "select count(*) from device_traces where user_id = \$1 and at > now() - interval '1 hour' and fields::text like '%합성 일정%'" "$U"` → 0.

통과 기준: C2 1~4·6 기대대로(5는 해당 기기가 있을 때), C1 1~5 기대대로. 어긋나면 그 단계의 관찰(개수·상태·문구)을 적고 원인 조치 후 0.8.1로 다시 잰다.

- [ ] **Step 10: 기록 커밋**

`gates.md` 행 `C2`(게이트 = C2 1~6, 근거 = 빌드·시각·`r=` 값·제안 id·status·캘린더 증감 개수)와 `C1`(게이트 = C1 1~5, 근거 = 줄 수·문구 일치 여부·grep 결과·count 0). 사용자가 만든 합성 일정을 지웠는지 적는다.

```bash
git add docs/superpowers/phase1/gates.md
git commit -m "docs(gates): 0.8.0 device gates — overlap check (lock screen notice, sheet, tab, chat card) and device calendar in chat"
```

---

## 스펙 확인 필요

계획이 스펙·Fable 결정의 빈칸을 채우거나 문구를 좁힌 곳이다. 리뷰(Codex·Fable)와 메인이 판정한다. ★는 스펙 `e99f208`에 이미 이 계획의 선택으로 적었다(뒤집으면 스펙도 고친다).

1. ★ **숫자 어절 규칙을 좁혔다**: Fable B-3 문구는 "숫자가 든 어절은 원형만"인데, 그러면 `10월에`·`3일에`·`14시에`가 본문의 `10월`·`3일`·`14시`에 맞지 않는다(Review Focus 3). 계획은 "숫자로 끝나는 변형만 금지"(`10월`→`10` 금지, `10월에`→`10월` 허용). Fable 문구 그대로 가려면 S2 SQL 조건을 `t !~ '[0-9]'`로 바꾸고 테스트의 `10월에` 단언을 뺀다.
2. **facts 후보의 구별 조건에 받은 기간을 넣었다**: Fable은 "가맹점 또는 일정 기간"만 적었다. 계획은 "`kinds`만으로 나온 것이 아니면 후보" — 받은 기간(`date_from/to`)으로 걸러진 facts도 후보다(S1 `factsDistinct`). 받은 기간을 빼려면 S1·S3의 `factsDistinct`에서 날짜 조건을 `event_from/to`로만.
3. ★ **`schedule` 조건**: `kinds ∋ event` + 양 끝 + 31일 이하. 할 일(`task`)만 있는 질문·한쪽만 있는 범위("10월 3일 이후")·긴 범위("올해")는 `null`(캘린더 절 없음). 31일은 계획 값이다.
4. ★ **겹침 구간은 저장 길이 1시간**: Fable은 `[start, end ?? start+1h)`인데 `AddEventGate`는 제안 `end`와 무관하게 1시간으로 저장한다(F8) — 판정과 저장을 맞췄다. 제안 `end`를 저장에 쓰게 되면 `ProposalFlow.conflicts`에 `end`를 넘긴다(후속).
5. ★ **겹침 제외 목록**: 종일·취소·같은 제안 표식만. "한가함(free)"으로 표시된 일정, 구독 캘린더의 시각 일정은 겹침으로 센다. "기기 캘린더" 절은 생일·구독 캘린더를 빼지만 겹침 판정은 빼지 않는다(구독 공휴일은 종일이라 어차피 제외).
6. ★ **"이미 캘린더에 있음"**: 같은 제안 표식이거나 시작 시각(분)·제목(앞뒤 공백 제거) 완전 일치. 그때도 추가 버튼은 남긴다(상태 줄만). 인용에는 일정 시각이 없어 상태를 붙이지 않는다(Fable C의 "인용된 일정마다"를 제안 카드로 좁힘).
7. ★ **로컬 알림 카테고리 `ADD_EVENT_CONFLICT`를 새로 둔다**(버튼 없음). `ADD_EVENT`를 재사용하면 길게 눌렀을 때 "캘린더에 추가"가 다시 떠 같은 겹침 알림이 반복된다.
8. **필터 사용자 메시지에 요일을 넣었다**(`오늘(서울): 2026-10-01(목)`) — "이번 주 토요일"·"다음 주"를 모델이 계산하게. 필터 프롬프트 캐시 앞부분(시스템)은 그대로다.
9. **상대 컷 재조정 규칙**: S1 게이트에서 근거 있는 질문 4개 중 3개 이상이 20에 포화하면 `0.6`·`0.9`로 한 번만 올린다. 그 뒤 조정은 새 결정으로.
10. **⑩b 순서**: S2·S3을 ⑩b 전에. 이미 돌았으면 재측정한다 — 사용자 시간(질문 50개는 그대로 재사용, 👍/👎 20건은 다시)이 든다.
11. ★ **권한 문구에 한 문장을 더했다**: Fable 문구 "등록된 일정을 확인하고 제안된 일정을 추가합니다" + "일정 내용은 기기 밖으로 보내지 않습니다."(마이크 문구와 같은 형식).
12. **거절 대체 문구가 서버 답을 덮는다**: 거절 + 캘린더 일정이면 앱이 "저장된 메일·문자에는 없고, 캘린더에 N건 있습니다"를 보인다. 인용·보관함 버튼은 여전히 없다(거절). 서버 로그·`eval-search`는 거절로 센다.
13. **C2 실기기 5단계(미리 판정 뒤 변경)**는 같은 계정의 다른 기기가 있어야 잰다. 없으면 단위 테스트로만 보장하고 게이트 행에 "해당 기기 없음"으로 적는다 — 마감 상태로 인정할지 메인이 판정한다.

## Self-Review

1. **스펙 커버리지**: §9 흐름·필터(`event_range`) → S3; facts 일정 날짜 → S3 `factRange`·`deps.facts`; 후보 정의·최대 20·거절 없음·불변식 → S1; 숫자 어절 → S2; "일정 질문과 기기 캘린더"(schedule·절·5건·외 N건·빈 문구·거절 대체·카드 상태·권한 안내·생일/구독 제외) → S3 + C1; 응답 계약(`candidates`·`schedule`) → S1·S3; §10 순서 3 겹침(같은 배열·제외·`conflict`·보고 없음·`confirmed`) → C2 `AddEventGate`·`handleAdd`; 겹침 화면(잠금화면 로컬 알림·카테고리·식별자·userInfo·시트·탭·채팅 카드·재판정) → C2; §11 0.8.0·권한 문구 → C2 `project.yml`·C1 Info.plist; §12 통제 2(기기 밖으로 안 나감, 개수만) → Global Constraints·C1 `scheduleEvents` DiagLog·C1 게이트 5; §15 ⑩b 전 → Global Constraints; §16 UC-4 → 구현 안 함(Global Constraints). 보관 계획 R-B4 반영 → 그 계획에 적음(이 커밋). 빠진 것 없음.
2. **자리표시 검사**: "TBD·적절히·나중에" 없음. 코드 단계는 모두 코드 블록. "Task N과 같이" 없음 — S3의 smoke·probe 확장은 추가할 줄을 그대로 적었다.
3. **타입 일관성**: `ScoredRow`·`relevantItems`·`factsDistinct`·`pickCandidates`(S1) → S3가 `factsDistinct` 본문만 교체, 시그니처 같음. `Filters`에 `event_from/to` 추가 → 테스트 4곳·`deps` 헬퍼·chat-db `run` 모두 갱신 단계 있음. `ChatResult.schedule` → `validateAnswer` Omit에 `"schedule"` 추가 단계 있음. `ProposalFlow.CalendarEvent`(C2) ← C1 `DeviceCalendar`·`CalendarLookup.scheduleEvents`가 같은 이름으로 씀. `conflictCount`(C2) ← `handleAdd`·델리게이트·시트·채팅이 같은 이름. `AddEventRequest(…, confirmed:)`는 `var confirmed = false`라 기존 호출도 컴파일된다. `proposalCard(…, status:)`(C1)는 C2의 `runAdd` 호출을 그대로 품는다.
4. **Review Focus**: 1 → C2 `testConflictOutcomeAndCopy` + C2 게이트 5, 2 → C2 `testConflicts`, 3 → S2 테스트 `10월에`, 4 → S3 `normalizeFilters: event dates …`·`scheduleOf: …`, 5 → S3 `answerQuestion: schedule rides along …` + S1 `candidates: refused …` + C1 `testRefusalText`·게이트 3.
