# PoC 추적 이벤트 (`poc_traces`)

실기기 PoC 세션(PoC-1·2·3·5 등)의 관찰값을 기기 로그 파일 대신 DB에 모아 Mac에서 바로 판정한다(사용자 결정 2026-09-27).
**PoC 전용**이며 1단계 제품 스키마에서는 테이블과 경로를 삭제한다. 본문은 절대 보내지 않는다(길이·해시만).

## 서버

- 테이블 `poc_traces(id, user_id, device_id, event, fields jsonb, at, received_at)` — 마이그레이션 `0007_poc_traces.sql`. 인덱스 `(user_id, at)`.
  RLS: `authenticated`가 **자기 행만 insert·select**. `anon` 권한 없음. 삭제는 운영자(`scripts/sql.ts`)만.
- 경로 `POST {SUPABASE_URL}/functions/v1/ingest/trace` — 기존 `POST /ingest`(CaptureItem) 계약과 경로로 분리. 코드 `functions/ingest/trace.ts`.
  삽입은 호출자의 사용자 JWT로 만든 클라이언트로 해서 RLS가 그대로 적용된다(service role 미사용).

## 기기 → 서버 계약

```http
POST {SUPABASE_URL}/functions/v1/ingest/trace
Authorization: Bearer <Supabase 사용자 access_token>
apikey: <SUPABASE_ANON_KEY (sb_publishable_…)>
content-type: application/json

[
  {"device_id":"<identifierForVendor>","event":"poc1.intent_fired","at":"2026-09-27T09:00:00+09:00",
   "fields":{"locked":true,"bg":true,"source":"NOTIFICATION","elapsed_ms":12,"text_len":48,"text_sha8":"a1b2c3d4"}}
]
```

| 항목 | 규칙 |
|---|---|
| 배치 | JSON 배열 1~200건. 기기에서 모아 두었다가 한 번에 보낸다(실패하면 다음 flush에 재전송. 서버는 (user_id, device_id, event, at)가 같은 행을 무시하고 202 {inserted, duplicates}를 준다 — 0015) |
| `device_id` | 1~100자. `UIDevice.current.identifierForVendor?.uuidString` 권장 |
| `event` | `<poc>.<event>` 소문자·숫자·`_`: 정규식 `^poc[0-9]+[a-z0-9_]*\.[a-z0-9_.]{1,60}$`. 예: `poc1.intent_fired`, `poc2.message_received`, `poc3.fm_classified`, `poc5.action_handled`, `poc8_9.upload_done` |
| `at` | 관찰 시각. ISO 8601 문자열, 또는 Swift `JSONEncoder` 기본 Date(2001-01-01 기준 초) |
| `fields` | JSON 객체(생략 시 `{}`). jsonb 그대로 저장. **문자열 값은 200자에서 자른다**(중첩 포함). 직렬화 4KB 초과는 거부 |
| 금지 키 | `content`·`text`·`body`(대소문자 무관, 어느 깊이든) → 400. 본문 유입 방지. `text_len`·`text_sha8`처럼 다른 이름은 허용 |

공통 `fields`(해당하는 것만 넣는다):

| 키 | 타입 | 뜻 |
|---|---|---|
| `locked` | bool 또는 null | 0.2.1: .complete 보호 파일 읽기로 판정(null = unknown). 함께 lock_state(locked/unlocked/unknown)·lock_probe(readable/denied/missing/error:<code>)·locked_app(UIKit 값, 비교용) |
| `bg` | bool | 앱이 백그라운드에서 실행됐는지 |
| `source` | string | `NOTIFICATION`·`MESSAGES`·`SHARE`·`CHAT` 등 수집 경로 |
| `elapsed_ms` | number | 해당 단계 소요 시간 |
| `text_len` | number | 본문 길이(글자 수). 본문 자체는 보내지 않는다 |
| `text_sha8` | string | 본문 SHA-256 hex 앞 8자. 같은 입력을 세션 간 대조할 때만 쓴다 |

그 밖의 키(예: `app`, `verdict`, `reason`, `auth`, `dup`)는 자유. 값에 원문·연락처 이름·토큰을 넣지 않는다(AGENTS.md §7).

응답: 202 `{"inserted": n}` / 400 `{"error": "<code>", "index": <배열 위치>}`(`bad_json`, `not_array`, `empty`, `too_many`, `bad_item`, `bad_device_id`, `bad_event`, `bad_at`, `bad_fields`, `forbidden_field`, `fields_too_large`) — 400이면 배치 전체를 저장하지 않는다 / 401 세션 없음·만료.

실측(2026-09-27, 배포 후): 2건 배치 202(200자 초과 문자열 잘림 확인), `text` 키 400 `forbidden_field`, 인증 없음 401, publishable 키 401. 기존 `/ingest`는 영향 없음(OTP 204).

## Mac에서 조회 (`poc/server`, `scripts/sql.ts`)

```bash
cd poc/server
Q() { deno run --allow-net --allow-env --allow-read --env-file=.env scripts/sql.ts "$@"; }
```

이벤트별 최근 50건:

```bash
Q "select event, at, device_id, fields from (
     select *, row_number() over (partition by event order by at desc) rn from poc_traces) t
   where rn <= 50 order by event, at desc"
```

세션 시간 범위(파라미터 `$1`·`$2`, ISO 시각)로 필터해 시간순:

```bash
Q "select at, event, fields from poc_traces where at between \$1 and \$2 order by at" \
  "2026-09-28T10:00:00+09:00" "2026-09-28T12:00:00+09:00"
```

세션 요약(이벤트별 건수·`elapsed_ms` p50/p95·잠금/백그라운드 건수):

```bash
Q "select event, count(*)::int n,
     percentile_cont(0.5) within group (order by (fields->>'elapsed_ms')::numeric) p50_ms,
     percentile_cont(0.95) within group (order by (fields->>'elapsed_ms')::numeric) p95_ms,
     count(*) filter (where (fields->>'locked')::boolean)::int locked,
     count(*) filter (where (fields->>'bg')::boolean)::int bg
   from poc_traces where at between \$1 and \$2 group by event order by event" \
  "2026-09-28T10:00:00+09:00" "2026-09-28T12:00:00+09:00"
```

특정 이벤트만(예: PoC-1 인텐트 발화, 최근 20건):

```bash
Q "select at, fields->>'source' source, fields->>'text_len' text_len, fields->>'locked' locked
   from poc_traces where event = 'poc1.intent_fired' order by at desc limit 20"
```

세션 뒤 정리(테스트 행 삭제): `Q "delete from poc_traces where device_id = \$1" "<device_id>"`.
