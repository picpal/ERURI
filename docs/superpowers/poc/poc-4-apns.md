# PoC-4 Edge Function → APNs HTTP/2

판정 기준(스펙 §14): 프로덕션 리전에서 100회 발송(동시 10 포함), **성공률 ≥ 99%, h2 스트림 오류 0**. 대안: Cloudflare Worker 릴레이.

## 서버 경로 실측 (2026-09-26~27, 실기기 토큰 없음)

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

## 실기기에서 할 일 (사용자)

### 1. 앱에 토큰 등록 추가 (구현 필요, 계획서 Task 9 Step 4)

`App.entitlements`에 `aps-environment = development`가 이미 있다. 개발 서명(Xcode 설치)이면 토큰은 **sandbox** 용이다.
Automatic 서명이 Push Notifications capability를 프로비저닝 프로필에 넣는지 설치 때 확인한다.

앱에 아래를 더한다(PoC 전용, 토큰은 로그로 내보낸다):

```swift
// AssistantPoCApp.swift
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
