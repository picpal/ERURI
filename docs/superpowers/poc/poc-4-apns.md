# PoC-4 Edge Function → APNs HTTP/2

판정 기준(스펙 §14): 프로덕션 리전에서 100회 발송(동시 10 포함), **성공률 ≥ 99%, h2 스트림 오류 0**. 대안: Cloudflare Worker 릴레이.

## 서버 경로 실측 (2026-09-26~27 가짜 토큰, 2026-09-30 실기기 production 토큰)

가짜 기기 토큰(무작위 64자 hex)으로 sandbox(`api.sandbox.push.apple.com`)에 보냈다. APNs는 TLS·HTTP/2·JWT(.p8 ES256) 인증을
모두 통과한 요청에만 `400 BadDeviceToken`과 `apns-id`를 돌려주므로, 이 응답이 서버 경로 동작의 증거다.

| 경로 | 결과 | 지연 |
|---|---|---|
| 로컬 `deno test`(`tests/apns.test.ts`) | 400 `BadDeviceToken`, `apns-id` 있음 | 첫 호출 1,069~1,130ms, 두 번째 441~450ms |
| 배포 Edge `apns-send`(서울 리전), 1회 | 400 `BadDeviceToken`, `apns-id` 있음 | 함수 안 APNs 호출 675~866ms(콜드), 701~798ms(웜) |
| 배포 Edge, 100회 동시 1 | 400 `BadDeviceToken` 100/100, `apns-id` 100, fetch 오류 0 | p50 419ms, p95 431ms |
| 배포 Edge, 100회 동시 10 (2회) | 400 82/100·90/100, 나머지는 fetch 오류(아래) | p50 1.6~2.9초, p95 약 4.1초 |
| 로컬 Deno, 100회 동시 10 | 400 98/100, `dispatch task is gone` 2 | p50 4.2초 |
| `curl --http1.1` 대조군 | 연결 실패(000) — APNs는 HTTP/1.1을 받지 않는다 | — |
| `curl --http2` 대조군 | 400 `BadDeviceToken`, proto=2 | — |
| **실기기 production 토큰**, 배포 Edge 100회 동시 10 1회차 (2026-09-30 00:29:40 KST, silent priority 5) | 200 100/100, `apns-id` 100, h2 오류 0, fetch 오류 0, envRetries 0 | p50 367ms, p95 755ms, max 756ms (함수 total 3,549ms) |
| **실기기 production 토큰**, 배포 Edge 100회 동시 10 2회차 (2026-09-30 00:29:46 KST, silent priority 5) | 200 100/100, `apns-id` 100, h2 오류 0, fetch 오류 0, envRetries 0 | p50 291ms, p95 594ms, max 595ms (함수 total 2,934ms) |

**h2 판정: 동작한다.** Deno `fetch`(로컬·Edge 모두)는 HTTP/2로 협상한다. HTTP/1.1이면 APNs가 연결 단계에서 거부하므로
400 응답과 `apns-id`를 받을 수 없다. 오류 메시지도 `http2 error: …`로 hyper h2 클라이언트임을 보여 준다.

**동시 10 오류의 해석(실기기 토큰으로 재측정 필요)**:
- `http2 error: connection error received: not a result of an error (b"{\"reason\":\"BadDeviceToken\"}")` 9~18건:
  APNs가 잘못된 토큰 뒤에 연결을 `GOAWAY`(NO_ERROR, 디버그 데이터 `BadDeviceToken`)로 닫고, 같은 연결에 떠 있던
  스트림이 실패한 것이다. 가짜 토큰이라 생기는 현상으로 보이며, 순차 발송(동시 1)은 100/100 오류 없이 끝났다.
- `dispatch task is gone: runtime dropped the dispatch task` 1~2건: 연결이 닫히는 중에 Deno(hyper) 클라이언트가 낸 오류.
  로컬 Deno에서도 재현되어 Edge 고유 문제는 아니다.
- 실기기 토큰에서도 이 오류가 남으면 판정 기준(h2 오류 0)을 못 맞춘다. 그때 조치: (1) `GOAWAY`로 처리되지 않은 스트림(연결 오류)은
  1회 재시도(APNs가 받지 않은 요청이라 중복 알림이 생기지 않음), (2) 그래도 남으면 스펙 §16 대안인 Cloudflare Worker 릴레이.

**429 `TooManyProviderTokenUpdates` (고침)**: 첫 배포에서 100회 동시 10 중 98건이 429였다. 캐시가 채워지기 전 동시 호출이 각자
JWT를 만들고, isolate마다 iat가 달라 APNs가 "토큰 갱신이 너무 잦다"고 본 것이다. `makeJWT`가 생성 중인 Promise를 공유하고
iat를 30분 경계로 내림(isolate가 달라도 같은 iat, 나이 ≤ 30분)하도록 고친 뒤 429는 0건이다(테스트 `concurrent callers share one in-flight JWT`,
`iat is rounded down to the bucket …`).

코드: `poc/server/supabase/functions/_shared/apns.ts`(`makeJWT`, `sendAPNs`, `normalizeP8`),
`functions/apns-send/index.ts`(secret 키 호출만, 응답에 토큰·JWT 없음), `tests/apns.test.ts`(8개).
Edge secrets: `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_TOPIC`, `APNS_P8`(`.p8` 파일 원문. `.env`의 한 줄 `\n` 표기도 `normalizeP8`이 받는다).

## APNs 환경: 기기별 sandbox/production (2026-09-27)

개발 서명(Xcode 설치) 앱은 **sandbox** 토큰, **TestFlight·App Store 빌드는 production** 토큰을 발급한다. 서버는 기기별 환경으로 보낸다.

- `devices(user_id, device_id, apns_token, apns_env, build, last_seen_at)` — 마이그레이션 `0011_devices.sql`, RLS 소유자 select/insert/update. (스펙 §8 `devices`의 `environment` 열 이름을 이번 구현은 `apns_env`로 썼다.)
- secret `APNS_ENV`(`sandbox`|`production`, 기본 sandbox): 토큰만 받은 발송의 기본 환경. **현재 `production`으로 설정.**
- 발송(`sendWithEnvFallback`): 400 `BadDeviceToken`/`BadEnvironmentToken`이면 반대 환경으로 **1회** 재시도하고 `{"apns":"env_retry","from","to","reason"}`를 로그(토큰 없음). 403 `BadEnvironmentKeyInToken`은 재시도하지 않고 `key_env_mismatch`를 로그한다.

### 기기 등록 계약

```http
POST {SUPABASE_URL}/functions/v1/ingest/device
Authorization: Bearer <Supabase 사용자 access_token>
apikey: <SUPABASE_ANON_KEY>
content-type: application/json

{"device_id":"<identifierForVendor>","apns_token":"<hex 64~200자>","apns_env":"production","build":"1.0 (7)"}
```

- 앱은 `didRegisterForRemoteNotificationsWithDeviceToken`마다(실행 시·토큰 갱신 시) 보낸다. `apns_env`는 빌드 구성으로 정한다: TestFlight·App Store 배포 빌드 = `production`, Xcode Debug 설치 = `sandbox`(entitlement `aps-environment`와 같게).
- 응답: 200 `{"device_id","apns_env"}` / 400 `bad_device_id`·`bad_apns_token`·`bad_apns_env`·`bad_build`·`bad_body`·`bad_json` / 401 세션 없음. 같은 `(user_id, device_id)`는 한 행으로 갱신된다. 토큰은 소문자로 저장.
- 발송: `apns-send` body `{ "device_id": "...", "user_id": "<uuid>", "count": 1, "concurrency": 1 }`(service 키)로 기기에 저장된 토큰·환경을 쓴다. `{ "token": "...", "env"?: "sandbox"|"production" }`도 된다(env 생략 시 `APNS_ENV`). 응답에 `env`·`envRetries`·`byEnv` 추가.

### 실측 (배포 후, 가짜 토큰·전용 테스트 사용자)

| 요청 | 결과 |
|---|---|
| `ingest/device` 인증 없음 / `apns_env: "prod"` / 정상 | 401 / 400 `bad_apns_env` / 200 |
| `apns-send` device_id(production) 1회 | **403 `BadEnvironmentKeyInToken`**, `apns-id` 있음, 0.8초 |
| `apns-send` token(기본 `APNS_ENV=production`) | 403 `BadEnvironmentKeyInToken` |

**(해소, 2026-09-27) 당시 `.p8` 키(`APNS_KEY_ID`)는 Sandbox 전용이었다.** 이후 Sandbox & Production 키로 교체했고(세션 출력 노출 뒤 13:15 재교체), 교체 키로 가짜 토큰 발송 시 production·sandbox 모두 `400 BadDeviceToken`(403 없음)이라 두 환경에서 인증된다. Edge secrets `APNS_KEY_ID`·`APNS_P8`은 현재 `.p8`과 해시로 대조해 일치. 아래는 교체 전 기록이다. production 호스트가 키 단계에서 거부하므로 TestFlight 설치 기기로는 푸시가 가지 않는다.
조치(사용자): developer.apple.com → Keys에서 APNs 키를 **Sandbox & Production**(또는 Production)으로 새로 만든다. 그다음 `poc/server/keys/`에 `.p8`을 두고 `.env`의 `APNS_KEY_ID`·`APNS_P8`을 바꾼 뒤, secrets `APNS_KEY_ID`·`APNS_P8`을 다시 설정한다(에이전트가 `.p8` 원문으로 등록).
그 전까지 Xcode 개발 설치(sandbox)로 실측하려면 `APNS_ENV=sandbox`로 되돌리거나 기기를 `apns_env: "sandbox"`로 등록한다.

## 실기기에서 할 일 (사용자)

### 1. 앱에 토큰 등록 추가 (구현 필요, 계획서 Task 9 Step 4)

> 2026-09-27 갱신: 토큰은 `poc.log` 대신 위 "기기 등록 계약"대로 `POST ingest/device`로 보낸다(TestFlight 빌드는 `apns_env: "production"`). 발송은 `apns-send`에 `{ device_id, user_id }`. 앱 쪽 등록 코드는 아직 없다. 아래 코드는 토큰을 얻는 부분의 원안이다.

`App.entitlements`에 `aps-environment = development`가 이미 있다. 개발 서명(Xcode 설치)이면 토큰은 **sandbox** 용이다.
Automatic 서명이 Push Notifications capability를 프로비저닝 프로필에 넣는지 설치 때 확인한다.

앱에 아래를 더한다(PoC 전용, 토큰은 로그로 내보낸다):

```swift
// EruriPoCApp.swift
@UIApplicationDelegateAdaptor(PushDelegate.self) var pushDelegate

final class PushDelegate: NSObject, UIApplicationDelegate {
  func application(_ app: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken token: Data) {
    PoCLog.append("apns token=\(token.map { String(format: "%02x", $0) }.joined()) env=development")
  }
  func application(_ app: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
    PoCLog.append("apns register failed \((error as NSError).code)")
  }
}

// ContentView: "푸시 토큰 등록" 버튼 (알림 권한은 기존 "권한 요청" 버튼)
Button("푸시 토큰 등록") { UIApplication.shared.registerForRemoteNotifications() }
```

토큰은 비밀값은 아니지만 커밋·문서에 넣지 않는다. 1단계 제품에서는 스펙 §8 `devices(user_id, apns_token, environment, last_seen_at)`에
upsert한다(RLS 소유자 읽기, 쓰기는 Edge 경유). 0단계에는 이 테이블 마이그레이션이 없고 `poc.log`로 대신한다.

### 2. 토큰 확인

앱 실행 → "권한 요청"으로 알림 허용 → "푸시 토큰 등록" → 앱 화면의 `poc.log`에서 `apns token=<64자 hex>`를 복사한다.

### 3. 1회 발송 — 실제 수신

Mac 터미널(`poc/server`)에서, 토큰을 `APNS_DEVICE_TOKEN`으로 넘긴다(값을 셸 기록에 남기지 않으려면 파일에서 읽는다):

```bash
cd poc/server
deno eval --env-file=.env '
const r = await fetch(Deno.env.get("SUPABASE_URL") + "/functions/v1/apns-send", { method: "POST",
  headers: { authorization: "Bearer " + Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), "content-type": "application/json" },
  body: JSON.stringify({ token: Deno.readTextFileSync("/tmp/apns-token.txt").trim(), count: 1, concurrency: 1 }) });
console.log(r.status, await r.text());'
```

기대: `ok: 1`, `byStatus: {"200": 1}`, iPhone 잠금 화면에 "PoC-4 / 합성 알림 1/1". 앱을 종료한 상태와 잠금 상태에서 각각 1회.

### 4. 100회 동시 10 — 판정

위 명령에서 `count: 100, concurrency: 10`. 알림이 100개 오므로 기기 알림 설정에서 미리 "요약"을 끄거나 그대로 둔다.
기록: `ok`(성공률), `byStatus`, `reasons`, `h2Errors`, `errors`, `ms.p50/p95`. 같은 측정을 2회 한다.

- 성공률 ≥ 99%이고 `h2Errors` 0 → PoC-4 **통과**.
- 연결 오류(`GOAWAY`·`dispatch task is gone`)가 남으면 → `sendAPNs`에 연결 오류 1회 재시도를 넣고 재측정 → 그래도 남으면 Cloudflare Worker 릴레이 채택(스펙 §3·§16 갱신).
- 400 `BadDeviceToken`이면 토큰 환경 불일치(개발 서명 → sandbox가 맞다). 403 `InvalidProviderToken`이면 Key ID·Team ID·.p8 확인.

결과는 `results.md` PoC-4 행과 이 문서 "서버 경로 실측" 표에 추가한다.
