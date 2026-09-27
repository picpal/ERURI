# PoC-6 Gmail 연결·watch·history 동기화

판정 기준은 스펙 §14 PoC-6. 서버 쪽은 Task 10에서 구현·배포했고(아래 "서버 상태"), 실계정 연결은 iOS GoogleSignIn 연동 뒤에 잰다.

## 서버 상태 (2026-09-27)

| 구성 | 내용 |
|---|---|
| 마이그레이션 | `0006_gmail.sql`: `connections`·`sync_states`(RLS 소유자 읽기), 저장 프로시저 `gmail_save_connection`(refresh token → vault `gmail_rt:<connection_id>`, 테스트 모드 `expires_at` 7일)·`gmail_get_refresh_token`(소유자·active만)·`gmail_state`·`gmail_update`·`gmail_enqueue_for_account`·`gmail_enqueue_all`·`gmail_reauth_due`, 연결 삭제 시 vault 토큰 삭제 트리거, cron `gmail-sync-every-6h`(`0 */6 * * *`)·`gmail-watch-daily`(`17 3 * * *`) |
| worker 잡 | `gmail-sync`(history → 404면 `last_success_at - 1일`부터 `messages.list(after:)` 재동기화, 잡을 다 넣은 뒤 커서 이동), `gmail-fetch`(50통/잡, 240ms 간격, 서버 규칙 필터 → `encrypt` → `insert_item`), `gmail-watch`(watch 갱신·`watch_expires_at`). lease_key `gmail:<connection_id>`. `invalid_grant`면 `reauth_required`로 바꾸고 잡은 `skipped`로 끝냄 |
| Edge 함수 | `gmail-connect`(JWT 검증), `gmail-webhook`(`verify_jwt = false`, Google OIDC 검증), `worker` |
| secrets | `GOOGLE_WEB_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GMAIL_PUBSUB_TOPIC` 등록. **`PUBSUB_PUSH_SA_EMAIL` 미등록**(없으면 webhook은 모든 요청을 401로 거부) |
| 테스트 | `tests/gmail.test.ts` 23개(모의 API 20 + DB 3), 전체 70개 통과 (2026-09-27 오류 처리 수정 후) |

실측(배포 후):

| 요청 | 결과 |
|---|---|
| webhook — 인증 없음 / 가짜 Bearer / 사용자 JWT / secret 키 | 모두 **401** (OIDC 아님, SA 이메일 미설정) |
| connect — 인증 없음 | 401 (게이트웨이 `UNAUTHORIZED_NO_AUTH_HEADER`) |
| connect — publishable 키를 Bearer로 | 401 (함수의 `auth.getUser` 실패) |
| connect — 사용자 JWT, `code` 없음 | 400 `missing_code` |
| connect — 사용자 JWT, 가짜 `code` | 502 `token_exchange_failed` (Google 토큰 엔드포인트까지 도달) |
| 로컬 `refreshAccessToken(가짜 토큰)` | `invalid_grant` → Web 클라이언트 ID·시크릿은 Google이 받아들임(틀리면 `invalid_client`) |

## Push 구독 만들기 (메인)

- 엔드포인트 = audience: `https://dbbdaawotqrcizlcpsjk.supabase.co/functions/v1/gmail-webhook`
- 인증: 서비스 계정 OIDC 토큰, audience는 위 URL과 **정확히 같게**(함수 기본값 = `SUPABASE_URL + /functions/v1/gmail-webhook`. 다르게 쓰면 secret `PUBSUB_PUSH_AUDIENCE`로 맞춘다)

```bash
gcloud pubsub subscriptions create gmail-push-sub --topic="$GMAIL_PUBSUB_TOPIC" \
  --push-endpoint="https://dbbdaawotqrcizlcpsjk.supabase.co/functions/v1/gmail-webhook" \
  --push-auth-service-account="<push용 SA 이메일>" \
  --push-auth-token-audience="https://dbbdaawotqrcizlcpsjk.supabase.co/functions/v1/gmail-webhook" \
  --ack-deadline=10
supabase secrets set PUBSUB_PUSH_SA_EMAIL=<push용 SA 이메일>    # poc/server 에서
```

2021-04-08 이전에 만든 GCP 프로젝트라면 Pub/Sub 서비스 에이전트(`service-<프로젝트 번호>@gcp-sa-pubsub.iam.gserviceaccount.com`)에
push용 SA에 대한 `roles/iam.serviceAccountTokenCreator`가 필요하다. 구독 생성 뒤 확인: Gmail 연결 전이라도 `gcloud pubsub topics publish`로
`{"emailAddress":"x@example.com","historyId":"1"}`(base64 아님, gcloud가 인코딩)을 게시하면 webhook이 200(`no_new_job`)을 돌려야 한다. 401이면 audience·SA 이메일 불일치.

## iOS → `gmail-connect` 계약 (다음 pane)

전제: 앱이 PoC 사용자로 Supabase에 로그인해 access token을 갖는다. **service role 키를 앱에 넣지 않는다**
(계획서 Step 2의 "service role + user_id" 원안 대신 사용자 JWT를 쓴다).

```http
POST {SUPABASE_URL}/auth/v1/token?grant_type=password
apikey: <SUPABASE_ANON_KEY (sb_publishable_…)>
content-type: application/json

{"email":"poc-user@example.com","password":"<POC_USER_PASSWORD>"}
→ 200 {"access_token": "...", "expires_in": 3600, ...}
```

GoogleSignIn: `GIDConfiguration(clientID: <GOOGLE_CLIENT_ID (iOS)>, serverClientID: <GOOGLE_WEB_CLIENT_ID>)`,
`signIn(withPresenting:hint:additionalScopes: ["https://www.googleapis.com/auth/gmail.readonly"])` → `result.serverAuthCode`.
Info.plist에 `GIDClientID`, URL scheme = iOS 클라이언트의 reversed client ID. `serverAuthCode`는 **한 번만 쓸 수 있고 몇 분 안에 만료**되므로 받자마자 보낸다. 코드·토큰은 로그에 남기지 않는다(길이만).

```http
POST {SUPABASE_URL}/functions/v1/gmail-connect
Authorization: Bearer <Supabase 사용자 access_token>
apikey: <SUPABASE_ANON_KEY>
content-type: application/json

{"code":"<serverAuthCode>"}
```

| 상태 | 본문 | 의미·앱 처리 |
|---|---|---|
| 200 | `{"connection_id","account","refresh_token_stored","watch_expires_at","backfill_pages","backfill_messages"}` | 연결 성공. `refresh_token_stored: false`면 Google이 refresh token을 주지 않은 것(이전 동의가 남음) → `GIDSignIn.sharedInstance.disconnect()` 후 다시 로그인해 동의 화면을 거친다. 이 상태로 두면 이후 잡이 `skipped` |
| 400 | `{"error":"missing_code"}` / `{"error":"bad_json"}` | 요청 형식 |
| 401 | 빈 본문 또는 `{"code":"UNAUTHORIZED_…"}` | Supabase 세션 없음·만료 → 재로그인 |
| 403 | `{"error":"gmail_scope_missing"}` | Google 로그인에서 **Gmail 읽기 범위를 체크하지 않음**. 서버가 받은 refresh token을 폐기했으므로 다시 로그인하면 동의 화면이 뜬다 → 범위 체크 안내 후 재시도 |
| 401 | `{"error":"gmail_unauthorized"}` | Gmail API가 401. 본문이 있다는 점으로 세션 401과 구분한다 → 재로그인(Google) |
| 403 | `{"error":"gmail_forbidden"}` | Gmail API가 403(범위·계정 정책·API 비활성) → 재로그인(Google)·설정 확인 |
| 429 | `{"error":"gmail_rate_limited"}` | Gmail 한도 → 잠시 뒤 재시도 |
| 502 | `{"error":"gmail_upstream"}` | Gmail 5xx 등 → 잠시 뒤 재시도 |
| 409 | `{"error":"account_linked_to_another_user"}` | 같은 Gmail이 다른 사용자에 연결됨 |
| 502 | `{"error":"token_exchange_failed"}` | 코드 만료·재사용, 또는 `serverClientID`가 Web 클라이언트가 아님 |
| 500 | `{"error":"save_failed"}` / `{"error":"enqueue_failed"}` | 서버 오류(재시도 가능) |
| 500 | `{"error":"internal","request_id":"<uuid>"}` | 처리되지 않은 예외. 로그에 같은 `request_id`로 단계(`stage`)·오류 이름만 남는다 |

`gmail_*` 오류와 refresh token 처리(2026-09-27 수정, iOS 실측에서 범위 미체크 코드로 **오류 코드 없는 500 + refresh token 유실** 발견):

| 실패 시점 | refresh token | 연결 상태 |
|---|---|---|
| 범위 확인(`gmail_scope_missing`), `profile` 실패, 409, 저장 전 예외 | 받은 것이 있으면 Google `revoke`로 폐기(저장하지 않음) | 만들지 않음 |
| 저장 뒤 `watch`·백필 목록 실패 | vault에 그대로 둔다 | 401·403 → `reauth_required`(워커 잡 `skipped`), 429·5xx → `active` 유지(일일 `gmail-watch`·6시간 `gmail-sync` cron이 복구) |

재시도는 새 로그인(새 `serverAuthCode`)으로 한다. 재로그인에서 refresh token이 다시 오지 않아도(`refresh_token_stored: false`) vault의 기존 토큰이 유지되고 연결은 `active`로 돌아온다.

서버는 교환(Web 클라이언트, `redirect_uri=""`) → 토큰 응답 `scope`에 `gmail.readonly` 확인 → `profile` → 저장(refresh token은 vault, 커서 = profile `historyId`) → `watch`(프로모션 라벨 제외) → 90일 백필(`newer_than:90d -category:promotions`) `gmail-fetch` 잡 → `gmail-sync` 잡 순으로 처리한다. 백필 본문은 워커가 분당 약 250통으로 가져온다.

## iOS 연결 절차 (실제, 2026-09-27)

앱 쪽은 `poc/ios/App/GoogleSignIn.swift`(`GmailConnect.run`)와 디버그 화면의 "Gmail (PoC-6)" 섹션.

```bash
cd poc/ios
./scripts/sim.sh config      # poc/server/.env → Config/Secrets.xcconfig (gitignore). 클라이언트 ID 2개·Supabase 호스트·publishable 키만
./scripts/sim.sh gen && ./scripts/sim.sh build && ./scripts/sim.sh install
./scripts/sim.sh gmail --poc-gmail-connect           # 비밀번호는 launch argument 로만. 앱이 바로 흐름을 시작한다
./scripts/sim.sh gmail --poc-gmail-connect=consent   # disconnect 후 동의 화면을 다시 거친다(refresh token 재발급)
./scripts/sim.sh log 10
```

1. 앱이 Supabase 비밀번호 로그인을 먼저 한다(Google 시트에서 사람이 시간을 쓰므로). 시트가 1시간 넘게 떠 있으면 토큰이 만료돼 첫 `gmail-connect`가 401 → 앱이 재로그인 후 같은 코드로 한 번 재시도한다(게이트웨이 401이라 코드는 소비되지 않음, 실측 확인).
2. "계속" → Google 로그인 → **세분화된 동의 화면에서 "Gmail 읽기" 체크박스를 켠다.** 빼면 교환은 성공하지만 서버의 `profile`이 403 → 코드만 소비된다(첫 시도에서 500으로 실측, 서버 `87673fe`에서 오류 매핑 수정). 앱은 `grantedScopes`에 `gmail.readonly`가 없으면 코드를 보내지 않고 `scope_not_granted`를 남긴다 → "재동의 연결".
3. `poc.log`에 `gmail connect 200 … refresh_token_stored=true watch_expires_at=… backfill_messages=…`(계정은 앞 2글자만). 재연결은 같은 `connection_id`를 갱신한다(중복 행 없음).

확인 쿼리(`poc/server`에서 `deno run --allow-net --allow-env --allow-read --env-file=.env scripts/sql.ts "<sql>"`, 토큰·본문 조회 금지):

```sql
select id, status, expires_at, (select count(*) from vault.secrets v where v.name = 'gmail_rt:' || c.id) rt from connections c;
select connection_id, last_success_at, watch_expires_at from sync_states;
select kind, status, created_at, updated_at, checkpoint from jobs where kind like 'gmail%' order by created_at;
select count(*), count(*) filter (where content_enc is null) from items where source = 'GMAIL';
select jobname, status, start_time from cron.job_run_details join cron.job using (jobid) order by start_time desc limit 5;  -- 워커 cron
select created, status_code, left(content::text, 200) from net._http_response order by created desc limit 5;             -- 워커 응답(claimed 수)
```

## 실측 결과 (2026-09-27)

| 항목 | 결과 |
|---|---|
| 연결 | 200, `refresh_token_stored=true`, `watch_expires_at` = 연결 +7일, `connections` active·`expires_at` +7일·vault 토큰 1개, `sync_states` 1행 |
| 백필 | 90일 85 ID(1페이지) → `items` 76행, `gmail-fetch` 1잡 03:01:50→03:02:57(67초), 429 없음, `content_enc` null 0 |
| 웹훅 지연(1회) | `[PoC-6]` 메일 Gmail 수신 03:06:50Z → `gmail-sync` 잡 생성 03:06:57.8Z, **약 8초**. Push 구독·OIDC 검증 동작 |
| 큐 대기 | 백필이 만든 `process` 잡 76건(워커 분당 5건)이 FIFO로 앞서 sync가 **11분** 대기(03:18 실행). 증분 동기화 지연 목표를 지키려면 잡 우선순위 또는 kind별 레인이 필요 |
| 유실과 복구 | 03:18 sync가 커서를 옮긴 직후 호스팅 DB에서 테스트(`tests/jobs.test.ts`가 `jobs` 전체 삭제)가 돌아 fetch 잡이 사라진 것으로 보임 → 메일 누락. `cursor='1'` → `gmail_enqueue_for_account` → `resync`(4 ID) → 새 행 1(`[PoC-6]` 제목), GMAIL 77행·`idempotency_key` 중복 0 |

교훈: 호스팅 DB에서 `jobs`를 지우는 테스트는 실측 중에 돌리지 않는다(또는 테스트가 자기 행만 지우게 한다). 웹훅 지연 5회 평균은 이 조건에서 다시 잰다.

## 실계정 절차 초안 (iOS 연동 후)

GoogleSignIn은 시뮬레이터에서도 동작하므로(웹 인증 세션) 연결·동기화 실측은 **시뮬레이터로 가능**하다. 푸시(Pub/Sub → webhook)는 서버 경로라 기기와 무관하다.

1. ~~구독 생성·`PUBSUB_PUSH_SA_EMAIL` 등록~~(09-27 완료, 웹훅 동작 확인). 앱 연결은 위 "iOS 연결 절차"(09-27 완료). 응답의 `watch_expires_at`이 약 7일 뒤인지, `refresh_token_stored: true`인지 기록.
2. 백필: `backfill_messages`와 완료 시각(`select count(*), max(captured_at) from items where source='GMAIL'`), `gmail-fetch` 잡 상태(`select status, count(*) from jobs where kind='gmail-fetch' group by 1`), 429 여부(`last_error`). 본문 암호화 확인: `select count(*) filter (where content_enc is null) from items where source='GMAIL'` = 0 (복호화해 보지 않는다).
3. 본인에게 합성 메일 5통 → 발송 시각과 `jobs(kind='gmail-sync').created_at` 차이(웹훅 지연), 그 뒤 `items` 생성까지(워커 cron 1분 주기 포함).
4. 404 재동기화: `update sync_states set cursor = '1' where connection_id = '<id>'` → 다음 sync에서 `mode: "resync"`(잡 `checkpoint = 'resync'`), 누락 0(직전 24시간 Gmail 메시지 ID와 `items.idempotency_key = 'gmail:<id>'` 비교).
5. watch 갱신: `select gmail_enqueue_all('gmail-watch')` → `watch_expires_at` 갱신. 다음 날 03:17 UTC cron 뒤 한 번 더.
6. 6일 뒤 `select * from gmail_reauth_due()`에 `expiring`.
7. 8일 뒤(테스트 모드 7일 만료) sync가 `skipped`, `connections.status = 'reauth_required'`, `gmail_reauth_due()`에 `invalid_grant`.
8. 규칙 필터: 합성 OTP 메일("인증번호 483920")은 `items`에 없고 카드번호 메일은 1행(제목 마스킹은 `title`로 확인 가능, 본문은 복호화하지 않음).
