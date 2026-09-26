# PoC-6 Gmail 연결·watch·history 동기화

판정 기준은 스펙 §14 PoC-6. 서버 쪽은 Task 10에서 구현·배포했고(아래 "서버 상태"), 실계정 연결은 iOS GoogleSignIn 연동 뒤에 잰다.

## 서버 상태 (2026-09-27)

| 구성 | 내용 |
|---|---|
| 마이그레이션 | `0006_gmail.sql`: `connections`·`sync_states`(RLS 소유자 읽기), 저장 프로시저 `gmail_save_connection`(refresh token → vault `gmail_rt:<connection_id>`, 테스트 모드 `expires_at` 7일)·`gmail_get_refresh_token`(소유자·active만)·`gmail_state`·`gmail_update`·`gmail_enqueue_for_account`·`gmail_enqueue_all`·`gmail_reauth_due`, 연결 삭제 시 vault 토큰 삭제 트리거, cron `gmail-sync-every-6h`(`0 */6 * * *`)·`gmail-watch-daily`(`17 3 * * *`) |
| worker 잡 | `gmail-sync`(history → 404면 `last_success_at - 1일`부터 `messages.list(after:)` 재동기화, 잡을 다 넣은 뒤 커서 이동), `gmail-fetch`(50통/잡, 240ms 간격, 서버 규칙 필터 → `encrypt` → `insert_item`), `gmail-watch`(watch 갱신·`watch_expires_at`). lease_key `gmail:<connection_id>`. `invalid_grant`면 `reauth_required`로 바꾸고 잡은 `skipped`로 끝냄 |
| Edge 함수 | `gmail-connect`(JWT 검증), `gmail-webhook`(`verify_jwt = false`, Google OIDC 검증), `worker` |
| secrets | `GOOGLE_WEB_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GMAIL_PUBSUB_TOPIC` 등록. **`PUBSUB_PUSH_SA_EMAIL` 미등록**(없으면 webhook은 모든 요청을 401로 거부) |
| 테스트 | `tests/gmail.test.ts` 19개(모의 API 16 + DB 3), 전체 66개 통과 |

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
| 409 | `{"error":"account_linked_to_another_user"}` | 같은 Gmail이 다른 사용자에 연결됨 |
| 502 | `{"error":"token_exchange_failed"}` | 코드 만료·재사용, 또는 `serverClientID`가 Web 클라이언트가 아님 |
| 500 | `{"error":"save_failed"}` / `{"error":"enqueue_failed"}` | 서버 오류(재시도 가능) |

서버는 교환(Web 클라이언트, `redirect_uri=""`) → `profile` → `watch`(프로모션 라벨 제외) → 저장 → 90일 백필(`newer_than:90d -category:promotions`) `gmail-fetch` 잡 → `gmail-sync` 잡 순으로 처리한다. 백필 본문은 워커가 분당 약 250통으로 가져온다.

## 실계정 절차 초안 (iOS 연동 후)

GoogleSignIn은 시뮬레이터에서도 동작하므로(웹 인증 세션) 연결·동기화 실측은 **시뮬레이터로 가능**하다. 푸시(Pub/Sub → webhook)는 서버 경로라 기기와 무관하다.

1. 구독 생성·`PUBSUB_PUSH_SA_EMAIL` 등록(위). 앱에서 Supabase 로그인 → Google 로그인 → `gmail-connect` 200. 응답의 `watch_expires_at`이 약 7일 뒤인지, `refresh_token_stored: true`인지 기록.
2. 백필: `backfill_messages`와 완료 시각(`select count(*), max(captured_at) from items where source='GMAIL'`), `gmail-fetch` 잡 상태(`select status, count(*) from jobs where kind='gmail-fetch' group by 1`), 429 여부(`last_error`). 본문 암호화 확인: `select count(*) filter (where content_enc is null) from items where source='GMAIL'` = 0 (복호화해 보지 않는다).
3. 본인에게 합성 메일 5통 → 발송 시각과 `jobs(kind='gmail-sync').created_at` 차이(웹훅 지연), 그 뒤 `items` 생성까지(워커 cron 1분 주기 포함).
4. 404 재동기화: `update sync_states set cursor = '1' where connection_id = '<id>'` → 다음 sync에서 `mode: "resync"`(잡 `checkpoint = 'resync'`), 누락 0(직전 24시간 Gmail 메시지 ID와 `items.idempotency_key = 'gmail:<id>'` 비교).
5. watch 갱신: `select gmail_enqueue_all('gmail-watch')` → `watch_expires_at` 갱신. 다음 날 03:17 UTC cron 뒤 한 번 더.
6. 6일 뒤 `select * from gmail_reauth_due()`에 `expiring`.
7. 8일 뒤(테스트 모드 7일 만료) sync가 `skipped`, `connections.status = 'reauth_required'`, `gmail_reauth_due()`에 `invalid_grant`.
8. 규칙 필터: 합성 OTP 메일("인증번호 483920")은 `items`에 없고 카드번호 메일은 1행(제목 마스킹은 `title`로 확인 가능, 본문은 복호화하지 않음).
