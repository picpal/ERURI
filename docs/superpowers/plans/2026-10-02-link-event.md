# ERURI 0.11.0 링크 → 일정 제안(청첩장·초대장·행사 페이지) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## 태스크 ID 표

| ID | 태스크 | 선행 | 시점·Gmail 측정 창 | 게이트 행 |
|---|---|---|---|---|
| L0 | 스펙 §2·§5·§6(새 소절 "링크 읽기")·§7·§8·§9·§10·§11·§12·§15·§16 + 보관 계획 R-B9 0.11.0 → 0.12.0 | 이 계획 커밋 | 무관(문서) | — |
| L1 | EruriCore `LinkText`·`LinkPage`·`LinkSettle` — 링크 판정·주소 검사·날짜 후보·본문 만들기·안정 판정(순수 함수) | L0 | 무관(로컬) | — |
| L2 | 큐 링크 대기 행(`kind = 'link'`) + `CapturePipeline.handleLink` + `LinkFlow`(확장·앱 흐름, 가짜 렌더러로 테스트) + `LinkCaptureText`(문구) | L1 | 무관(로컬) | — |
| L3 | `LinkRenderer`(WKWebView, 창 안·화면 밑) + `OCR.recognize(image:)` + 합성 HTML 픽스처 테스트(시뮬레이터) | L2 | 무관(로컬 시뮬레이터) | — |
| L4 | 공유 확장 링크 경로·상태 화면 | L3 | 무관(빌드) | — |
| L5 | 앱: 대기 링크 이어받기(foreground) + 채팅 붙여넣기(링크 턴·결과 폴링) + "공유한 링크" 출처 | L3 | 무관(빌드·단위 테스트) | — |
| L6 | 일정 위치 — 제안 `location` → EventKit `location` | L0 | 무관 | — |
| L7 | 서버 추출 평가 `LNK-eval` — 합성 링크 본문 × 3회를 **배포된** worker(테스트 lease)에 넣어 게이트·추출 비교. 배포 없음 | L1 | **③c1·③c2 창 밖** | `LNK-eval` |
| L8 | 0.11.0 + 시뮬레이터 게이트 `LNK-sim`(채팅 붙여넣기·이어받기, 로컬 합성 페이지) | L4·L5·L6·L7 | **③c1·③c2 창 밖** | `LNK-sim` |
| L9 | TestFlight 0.11.0 + 실기기 게이트 `LNK-device`(실제 공유 시트 1회·채팅 1회) | L8 + **0.10.0 TestFlight 기록(광고 해지 계획 U6b)** | ③c2 뒤(U6b 뒤) | `LNK-device` |

순서: L0 → L1 → L2 → L3 → L4·L5·L6(L6은 L0 뒤 언제든) → L7(L1 뒤 언제든, 창 밖) → L8 → [0.10.0 TestFlight] → L9. **서버 코드·마이그레이션·함수 배포가 없다** — Gmail 측정 기간에 워커를 배포하지 않으므로 ③c2를 기다릴 서버 태스크가 없다. 배포된 함수를 *호출*하는 L7·L8만 측정 창(③c1·③c2)을 피한다.

**Goal:** 청첩장·초대장·행사 페이지 링크를 ① 공유 시트로 공유하거나 ② 채팅창에 붙여넣으면, **기기가 페이지를 보이지 않는 웹뷰로 렌더링해** 글(제목·OG 설명·본문, 글이 없으면 화면 OCR)을 읽고 기존 SHARE 수집 경로로 보내, 서버의 기존 분류·추출·제안·겹침·묶음 알림(§7·§10)이 일정 제안을 만든다. 서버는 외부 URL을 가져오지 않는다.

**Architecture:** EruriCore에 순수 로직(`LinkText` — 판정·주소 검사·본문 만들기, `LinkSettle` — 대기 판정)과 WebKit 렌더러(`LinkRenderer` — WKWebView를 창 안 다른 화면 밑에 붙여 JS로 글을 읽고, 필요하면 화면 스냅샷을 Vision OCR)를 두고, 공유 확장과 앱이 같은 `LinkFlow`를 쓴다. 확장은 먼저 App Group 큐에 **링크 대기 행**을 남기고(확장이 죽거나 시간이 모자라면 앱이 다음 foreground에 이어받는다 — 확장은 앱을 열 수 없다) 10초 안에 글을 읽어 SHARE 큐 항목(`app_name = "웹 링크"`, 제목 = 페이지 제목)으로 넣는다. 날짜 후보가 없으면(이미지 전용 청첩장) 앱이 15초 + OCR로 다시 읽는다. 큐 항목 id는 대기 행마다 고정이라 다시 읽어도 서버 멱등 키(`SHARE:<id>`)가 같다. 서버·DB는 그대로다.

**Tech Stack:** SwiftUI iOS 26 앱 `Eruri` + Share Extension + Swift Package `EruriCore`(XCTest, Swift 6), WebKit(`WKWebView`, `callAsyncJavaScript`, `takeSnapshot`), Vision(`VNRecognizeTextRequest` ko-KR accurate), App Group SQLite 큐, xcodegen `ios/project.yml`, XCUITest(게이트 전용 임시 타깃), Deno 평가 스크립트(배포된 Edge `worker` 호출), TestFlight(`ios/scripts/testflight.sh`).

**Spec:** `docs/superpowers/specs/2026-09-22-assistant-design.md` — L0이 §15 후보 문단("링크 → 일정 제안", 커밋 `61f44d4`)을 아래 사용자 결정으로 바꿔 본문(§2·§5·§6·§7·§8·§9·§10·§11·§12·§15·§16)에 올린다. 실행 규칙은 `AGENTS.md` §3(모델)·§5-8(실측 게이트)·§6(기계)·§7(개인정보)·§8(버전).

**출발점:** main `74d752d` 위. 앱 `MARKETING_VERSION: 0.10.0`(광고 구독 해지, TestFlight는 U6b — ③c2 뒤), 서버 `0001`~`0028` 적용(`0029`는 `migrations-pending/`). Gmail 게이트 측정 중(③c1 ≈ 10-07, ③c2 ≈ 10-08 15시 이후). 보관 계획 트랙 B(R-B1~R-B9)는 ③c2 뒤.

**원장:** `.superpowers/sdd/2026-10-02-link-event/progress.md`(상위 원장 `.superpowers/sdd/2026-09-30-phase1/progress.md`의 Rulings 승계).

## 사용자 결정 (2026-10-02, 이 계획의 원본)

| # | 결정 | 이 계획에서 |
|---|---|---|
| LD1 | 입력: ① 공유 시트로 링크 공유 ② 채팅창에 링크 붙여넣기 — **둘 다** | L4(공유)·L5(채팅) |
| LD2 | **방식 A — 앱(기기)이 페이지를 렌더링해 읽는다.** 보이지 않는 WKWebView로 URL을 열고 렌더링된 텍스트·OG 메타·(필요 시) 주요 이미지를 얻어 서버의 기존 수집·일정 추출 경로(§7 extract·save_facts·§10 제안·겹침·묶음 알림)로 보낸다. **서버는 외부 URL을 가져오지 않는다(SSRF 없음).** 이미지 전용 청첩장 처리는 계획에서 결정 | L1~L5, 이미지는 D4 |
| LD3 | 원문 전체 저장 안 함 원칙(§15 후보 문단) — "추출 결과·링크만" 또는 "기존 항목처럼 암호화 저장"을 §7·§12 규칙과 맞춰 계획에서 결정·명시, 사용자 판단이 필요하면 표로 | D3 + "사용자 결정 필요" UQ1·UQ2 |

## 계획이 정한 것 (사용자 결정이 열어 둔 항목)

| # | 항목 | 결정 | 이유 |
|---|---|---|---|
| D1 | 렌더링 위치 | **공유 확장(10초, OCR 없음) + 앱(15초, OCR)**. 확장은 렌더링 **전에** App Group 큐에 링크 대기 행(lease 60초)을 남긴다. 성공하면 SHARE 큐 항목을 넣고 행을 지운다. 시간 초과·로드 실패·날짜 후보 없음이면 행을 앱에 넘기고(lease 즉시 만료) 시트에 "앱을 열면 다시 읽어요"를 보인다. 확장이 죽으면 60초 뒤 앱이 이어받는다. 앱은 foreground가 될 때만 대기 행을 처리한다. 확장 렌더링은 `LinkFlow.renderInShareExtension` 한 값으로 끌 수 있다(실기기 D1 실패 시 대안) | 확장에서 앱을 여는 공식 방법이 없다(F12). 확장 안 WKWebView는 공식 근거가 없어(U1) 실패해도 같은 대기 행 경로가 남게 한다. 백그라운드에서는 WebKit이 멈추므로(F13) 백그라운드 렌더링은 하지 않는다. 확장에서 미리 읽어 두면 다음 인텐트·BG refresh·무음 푸시 flush가 앱을 열지 않아도 올린다(F3) |
| D2 | 서버 경로 | **source `SHARE` 재사용**, `app_name = "웹 링크"`, `title` = 페이지 제목(og:title, 없으면 `document.title`, 120자, 규칙 마스킹). **새 source·마이그레이션·Edge 변경·배포 없음** | 새 source는 `items.source` check 제약(F6)·ingest `SOURCES`·앱 출처 표시·채팅 필터를 모두 바꾸고 배포가 필요하다. SHARE는 규칙 → Jev 게이트 → 추출 → 제안 → 알림이 이미 같다(F5·F7) |
| D3 | 저장(LD3, 기본안 A) | **기존 항목 규칙 그대로**: 큐 항목 본문 = 모델이 보는 발췌(머리 줄 + 본문 + OCR, **최대 4,000자** — 서버 추출 입력 상한과 같음)를 서버가 사용자 키로 암호화해 3년 보관, 요약(영구)·청크(§8)도 같다. 페이지 전체·이미지·스냅샷은 어디에도 저장하지 않는다(기기 메모리에서만). 주소는 **호스트만** 본문 첫 줄 `[웹 링크] <호스트>`에 둔다(경로·쿼리·조각 없음) | 기존 §7·§12 규칙과 같아 서버 변경이 없고, "청첩장 장소 어디였지" 검색이 된다. 모델이 보지 않는 뒷부분은 보내지 않으므로 "원문 전체"가 아니라 발췌다. 쿼리의 숫자(`?code=482913`)는 OTP 규칙(키워드 `code` + 숫자)에 걸려 **항목 전체가 폐기**되고(F9), 초대 토큰은 개인 식별자다. 사용자 판단 → UQ1·UQ2 |
| D4 | 이미지 전용 청첩장 | **기기 OCR**: 앱이 읽은 글(제목·설명·본문)에 날짜 후보가 없으면 웹뷰 화면을 최대 3화면 스냅샷(너비 780px) → Vision(ko-KR·en-US, accurate) → `이미지 속 글자:` 블록(1,500자). 확장에서는 OCR하지 않는다(메모리 한도 미확인, U3). 서버 vision 경로는 쓰지 않는다 | 제품에는 이미지 수집 경로가 없다 — 공유 확장은 이미지를 받지 않고 ingest에 `upload/<id>` 경로가 없다(F2, 스펙 §15 2단계). 기존 PoC `OCR`(Vision accurate)을 재사용하고 서버 변경이 없다 |
| D5 | 채팅 링크 판정 | 입력에 `http://`·`https://`로 적힌 주소가 **정확히 1개**면 링크 수집(질문 아님 — `/chat`을 부르지 않는다), 나머지 글은 메모(200자). **2개 이상**이면 "링크는 한 번에 하나씩 보내 주세요". 스킴 없는 도메인("naver.com")은 질문이다. 클립보드를 앱이 읽지 않는다(사용자가 입력창에 붙여넣은 글만) | 서버 chat은 URL을 읽지 못하므로 URL이 든 질문은 답할 수 없다. 프로그램으로 붙여넣기를 읽으면 iOS 16+가 허용 창을 띄운다(F14) |
| D6 | 렌더링 대기 | `didFinish`(오지 않으면 4초) 뒤 `innerText` 길이를 0.5초마다 재서 **3번 같으면 완료**, 예산(확장 10초·앱 15초)이 끝나면 그때까지 읽은 글로 진행(`timedOut`). 글이 0자면 실패 `timeout`·`empty` | WebKit에 network idle API가 없고 `didFinish`는 XHR·fetch 완료를 뜻하지 않는다(F15). SPA 청첩장은 로드 뒤 JS가 글을 그린다 |
| D7 | 웹뷰 설정 | 비영속 저장소(`.nonPersistent()` — 쿠키·로그인 없음), 미디어 자동 재생 금지(청첩장 배경 음악), 새 창·앱 스킴(`kakaolink:`·`intent:`·`itms-apps:` 등) 이동 차단(읽기는 계속), 메인 프레임 이동 6회(리다이렉트 5회) 넘으면 실패, 다운로드 취소, HTTP 4xx·5xx·표시 불가 MIME 실패. 주소 검사: http(s)만, **사설·루프백·링크로컬 IP 리터럴·`.local`·점 없는 호스트 거부**(DEBUG 빌드만 루프백 허용 — 시뮬레이터 게이트). 웹뷰는 실제 화면 크기(390×844pt)로 **창 안, 다른 화면 밑**에 붙인다 | 사용자가 브라우저로 여는 것과 같은 범위로 두되, 로컬 네트워크 권한 창·내부 기기 접근을 피한다(서버 SSRF가 아니라 기기 위생). WebKit은 창 안에 있고 foreground일 때만 보이는 뷰로 다뤄 타이머·렌더링을 돌린다(F16) |
| D8 | 결과를 사용자에게 | 확장: 시트 안 문구(읽는 중 → 결과, 1.5초 뒤 닫힘 또는 [닫기]). 채팅: 링크 턴 문구 → 직접 업로드 → 처리 결과 폴링(3초 간격, 60초) "일정 N건을 찾았어요 — '제안' 탭과 알림에서 추가할 수 있어요" 등. 앱 이어받기(foreground) 실패: 로컬 알림 1건(주소·제목 없이) | 확장·채팅은 사용자가 보고 있다. 이어받기는 사용자가 다른 화면에 있을 수 있다 |
| D9 | 일정 위치 | 제안 payload `location`(추출 결과, F11) → EventKit `location`(문자열). 경로: 제안 탭 행·배너 탭 시트(목록 값)·채팅 카드. **잠금화면 "캘린더에 추가"는 푸시에 location이 없어 장소 없이** 저장한다(서버 notify 변경은 이 계획 범위 밖 — 0.11.0은 서버 무변경) | §15 후보 "장소는 주소 그대로 일정 위치에". 지금은 모든 경로가 위치 없이 저장한다(F10) |
| D10 | 버전 | **이 기능 = 0.11.0**, 보관 계획 R-B9(요약·저장 공간)는 **0.12.0**(L0이 스펙 §11·§15·§16·보관 계획을 고친다). 실행 때 `git log --oneline -- ios/project.yml`로 0.11.0이 이미 main에 있으면(R-B9가 먼저) 이 기능이 다음 빈 마이너를 쓰고 스펙·두 계획을 같은 커밋에서 맞춘다. 메이저 금지 | 이 기능은 서버를 바꾸지 않아 ③c2를 기다리지 않는 R-B9보다 먼저 준비된다 |
| D11 | 공개 순서 | **TestFlight 0.11.0은 0.10.0 TestFlight(광고 해지 계획 U6b) 기록 뒤**. 0.11.0 빌드는 main의 0.10.0 해지 화면을 포함하므로 U6b의 원클릭 비율 판정 전에 내보내지 않는다. 시뮬레이터 게이트(L8)까지는 측정 창 밖이면 언제든 | 광고 해지 계획 D10·D11(워커 배포·판정 뒤 공개)을 깨지 않는다 |
| D12 | 여행 글 후보와의 관계 | §15 "여행 글 → 일정 초안" 후보의 "서버가 본문 가져오기"를 **기기 렌더러 공유**로 바꿔 적는다(이번 구현 없음) | 링크 가져오기 계층을 공유한다는 후보 문구(§15)를 방식 A와 맞춘다 |

## 사용자 결정 필요 (기본값으로 구현하고, 다르게 고르면 표의 영향만 바꾼다)

| # | 질문 | 선택지 | 계획 기본값 | 다르게 고르면 |
|---|---|---|---|---|
| UQ1 | 링크 페이지 글을 서버에 어떻게 남길까(LD3) | **A** 기존 항목처럼: 발췌(≤4,000자) 암호화 3년 + 요약·청크(검색 가능) · **B** 추출 결과만: 추출 뒤 본문 삭제(요약·facts만 남음) | **A** — 서버 변경 없음, §7·§12 규칙 그대로, 청첩장 장소·계좌 안내 검색 가능. 청크 평문 기간은 기존 UC-1(90일) 그대로 | B → 워커가 `app_name = '웹 링크'` 항목의 본문을 추출 뒤 지워야 한다(워커 변경 → ③c2 뒤 별도 계획). 앱(L1~L6)은 그대로 |
| UQ2 | 링크 주소를 어디까지 남길까 | **호스트만**(`[웹 링크] invite.example.com`) · 전체 주소 | **호스트만** — 쿼리 숫자가 OTP 규칙으로 항목 전체를 폐기하고(F9), 초대 토큰이 남지 않는다. 대가: 보관함에서 원래 링크를 다시 열 수 없다 | 전체 주소 → 서버 규칙이 주소 줄을 건너뛰도록 ingest·worker 규칙 변경(③c2 뒤, 별도 계획). 앱은 `LinkText.compose`의 첫 줄만 바꾼다 |
| UQ3 | 채팅 판정 범위 | 주소가 1개 들어 있으면 링크 수집 · 입력 전체가 주소일 때만 | **주소 1개면 수집**(나머지 글은 메모) — "청첩장 https://…"처럼 말을 붙여도 동작 | "입력 전체가 주소"면 `LinkText.chatIntent`의 메모 허용만 끈다(L1 한 줄 + 테스트 2개) |

UQ1~UQ3은 메인이 사용자에게 묻는다. 답이 오기 전에도 L1~L8은 기본값으로 진행한다(B·전체 주소는 별도 계획이라 이 계획의 코드를 버리지 않는다).

## Global Constraints

- **스펙 먼저(AGENTS.md §1):** L0 커밋 전에는 코드 태스크를 시작하지 않는다. 계획과 스펙 문구가 다르면 스펙이 원본이다.
- **서버 무변경:** `supabase/functions/**`·`supabase/migrations/**`·`supabase/config.toml`을 바꾸지 않는다. 새 파일은 `supabase/eval/link-cases.json`(합성)·`supabase/scripts/eval-link.ts`(배포된 worker를 테스트 lease로 호출)뿐이다. Edge 함수 배포·`db push` 없음.
- **Gmail 측정 창(Gmail 계획 Global Constraints):** 배포된 함수를 호출하는 L7(`eval-link.ts`)·L8(시뮬레이터 → ingest·worker)은 ③b3 진행 중·**③c1 10-07(수) 14:30~16:30 KST**·**③c2 10-08(목) 14:30 KST ~ ③c2 완료 기록**을 피한다(메인이 원장 `status.t0`로 다시 계산). 실사용자 `items`·`jobs`·`connections`를 만들거나 고치지 않는다 — 평가·게이트는 테스트 사용자만.
- **버전(AGENTS.md §8):** `MARKETING_VERSION: 0.11.0`(L8, D10 확인 후). 빌드 번호는 `testflight.sh` 기본값(`date +%Y%m%d%H%M`). 메이저 금지.
- **공개 순서(D11):** L9의 TestFlight 업로드는 `docs/superpowers/phase1/gates.md`에 0.10.0 TestFlight(UNS-server 통과 행, U6b)가 기록된 뒤.
- **개인정보(AGENTS.md §7, 스펙 §12):** 로그·`DiagLog`·trace·`gates.md`·보고에 **링크 주소·호스트·페이지 제목·본문·OCR 글을 쓰지 않는다** — 결과 코드·글자 수·경과 ms·불리언만. trace 이벤트 이름은 서버가 받는 접두(`share.`)만 쓴다(F8). 테스트·평가 픽스처는 합성(`합성`·`example.com`·`.test`), 실제 청첩장·초대장 글·주소를 픽스처에 넣지 않는다. 실기기 게이트(L9)는 사용자가 고른 실제 링크로 하되 기록은 메타(글자 수·OCR 여부·상태·일정 수)만. `items.content_enc` 복호화 조회 금지.
- **Swift 6 동시성:** WebKit 호출은 전부 메인 액터(`@MainActor`). Vision OCR은 메인 밖(`Task.detached`). `EruriCore`는 swift-tools 6.2(Swift 6 모드)다.
- **기계(AGENTS.md §6):** 빌드·시뮬레이터·deno 전 `vm_stat | grep -E 'free|compressor'`. 시뮬레이터 빌드와 deno를 동시에 돌리지 않는다(`pgrep -x deno`·`pgrep -x xcodebuild`가 비었을 때만). 시뮬레이터는 pane 전용 UDID.
- **테스트 명령:** 앱 `cd ios && ./scripts/sim.sh gen && ./scripts/sim.sh test EruriCoreTests/<클래스>`, 빌드 `cd ios && ./scripts/sim.sh build`. 평가 `deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/eval-link.ts --runs 3`(저장소 루트), 타입 확인 `deno check supabase/scripts/eval-link.ts`.
- **호스팅 DB(AGENTS.md §7):** L7은 **테스트 사용자 13**, L8 시뮬레이터 게이트는 **테스트 사용자 14**(다른 테스트·게이트가 1·2·7·9·11·12를 쓴다 — 구현 때 `grep -rhoE 'userClient\([0-9]+\)|testUser(Id)?\([0-9]+\)' supabase/tests supabase/scripts .context`로 비었는지 다시 본다). 실행 태그(`RUN`)·자기 행만 지운다.
- **모델(AGENTS.md §3):** L0 `opus`/`high`. L1~L6 구현·리뷰 `opus`/`high`(WebKit·동시성 판단). L7 평가 판정 `opus`/`medium`. L8 시뮬레이터 게이트 `opus`/`medium`. L9 실기기 세션(사용자 조작 대기 위주) `sonnet`/`medium`, 판정·기록이 섞이면 `opus`/`medium`.
- **기록:** `docs/superpowers/phase1/gates.md`에 행 `LNK-eval`(L7)·`LNK-sim`(L8)·`LNK-device`(L9). 상태는 통과·실패·대기만("부분"은 마감 아님, AGENTS.md §5-8). 커밋 칸은 비우고 메인이 채운다.
- **커밋:** 태스크마다, 트레일러 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. **push 금지**(메인이 회수 후 `git push origin main`).

## 이 계획이 기대는 사실 (코드·공식 문서에서 확인, 2026-10-02)

| # | 사실 | 출처 |
|---|---|---|
| F1 | 공유 확장은 **텍스트·URL만** 받는다(활성화 규칙 `public.url`·`public.plain-text`). 모든 텍스트 표현을 `ShareText.compose`로 합쳐 `CapturePipeline.handleShare`(규칙만, `appName`·`title` nil)로 큐에 넣고 **화면 없이 바로** `completeRequest`한다 | `ios/ShareExtension/ShareViewController.swift`, `Info.plist`, `EruriCore/ShareText.swift`, `CapturePipeline.swift:20-27` |
| F2 | 제품에 이미지 수집 경로가 없다: 확장이 이미지를 받지 않고, ingest는 `device`·`trace`·본 ingest만 처리한다(`upload/<id>` 없음, `handler.ts` 주석 "localFile 항목은 이 경로로 오지 않는다"). worker `extract.ts`·`insert_media_item`은 PoC 잔재로 진입점이 없다(스펙 §15 2단계 "이미지·PDF 공유 파일 경로") | `supabase/functions/ingest/index.ts`, `handler.ts:3`, 스펙 §15 |
| F3 | 확장은 큐에 넣기만 하고 업로드는 앱 flush(트리거 `intent`·`silent_push`·`bg_refresh`·`foreground`)가 한다. 확장에는 세션이 없다(refresh token은 앱 Keychain) | `ios/App/Uploader.swift`, `ios/App/SupabaseSession.swift:7` |
| F4 | 큐는 표 하나(`queue`, `id` PK, `kind` = `capture`·`trace`), `INSERT OR IGNORE`, 캡처 `claim`·`pending`은 `kind = 'capture'`만, `markSent(id:)`는 kind 무관 삭제, `markFailed`는 백오프 | `EruriCore/CaptureQueue.swift` |
| F5 | ingest: `SOURCES` = MESSAGES·NOTIFICATION·SHARE·CHAT, 멱등 키 `${source}:${id}`, 제목+본문 규칙(OTP면 204, 저장 없음), 202 `{item_id, duplicate:false}`·중복 200 | `supabase/functions/ingest/handler.ts` |
| F6 | `items.source` check 제약 = GMAIL·MESSAGES·NOTIFICATION·SHARE·CHAT | `supabase/migrations/0001_baseline.sql:83` |
| F7 | worker process: 규칙 재적용 → Jev 게이트(메신저가 아니면 제목 포함) → 추출(입력 4,000자 절단, 머리 `출처:`·`앱:`·`제목:`) → `save_facts` → notify·embed. 비행동 라벨 ≥0.8만 7일 격리 폐기, 결과 없음 = `discarded:server:empty`(원문 유지) | `worker/text.ts`, `_shared/extract-text.ts:9,90-92`, 스펙 §7 |
| F8 | trace 이벤트 이름은 `^(capture|device|action|share|upload)\.[a-z0-9_.]{1,60}$`만 서버가 받는다(어기면 배치 400). 금지 필드 `content`·`text`·`body` | `EruriCore/Trace.swift:7-8`, `supabase/functions/ingest/trace.ts` |
| F9 | 기기·서버 규칙: OTP 키워드에 영문 `code`(앞뒤 비영문)가 있고 30자 안에 4~8자리 숫자면 **항목 전체 폐기**. `RuleFilter()` 기본값은 연락처 없음(`init(contactNames: [])`), `apply(title:text:sender:)`가 제목+본문을 함께 판정 | `EruriCore/RuleFilter.swift:10,48`, 스펙 §6 표 |
| F10 | EventKit 저장은 제목·시각·표식 `url`만 넣는다(`location` 없음). `AddEventRequest`에 위치가 없다. `handleAdd(fields:)`는 `[String: String]` 키(`proposal_id`·`title`·`start`·`end`·`version`)를 읽는다 | `ios/App/NotificationActions.swift:33-48,137,166-171` |
| F11 | 제안 payload = 추출 event(`title`·`start`·`end`·`location`·`uncertain`…, `via` 제외). 대기 목록 행에 `location`, 채팅 응답 `proposals[].payload`(JSON)에도 있다 | `_shared/facts.ts:26`, `0025_multi_event.sql:34-35`, `EruriCore/ProposalReview.swift:10`, `ChatReply.swift:12` |
| F12 | 확장에서 컨테이너 앱을 여는 지원 경로가 없다(`NSExtensionContext.open`은 Today·iMessage만, Frameworks Engineer 2025-01 "no supported way") | developer.apple.com `NSExtensionContext/open(_:completionHandler:)`, Apple Developer Forums(검증 표 `scratchpad/wk-premises.md` #3) |
| F13 | 백그라운드로 깨어난 앱은 몇 초 뒤 정지되고 WebKit은 백그라운드를 비가시로 다룬다 → 백그라운드 렌더링은 기대하지 않는다 | Apple Developer Forums 64150(Frameworks Engineer), WebKit 소스(검증 #8) |
| F14 | iOS 16+에서 앱이 클립보드를 프로그램으로 읽으면 허용 창이 뜬다. 사용자가 입력창에 직접 붙여넣는 것은 창이 없다 | `UIPasteControl`·`UIPasteboard` 문서, WWDC22 10096(검증 #9) |
| F15 | WebKit에는 network idle API가 없고 `didFinish`는 메인 내비게이션 완료일 뿐 JS의 XHR·fetch를 기다리지 않는다 | `WKNavigationDelegate` 문서(검증 #5a) |
| F16 | WebContent 프로세스 메모리는 앱(확장)과 **따로** 계산되고 넘치면 그 프로세스만 끝난다(`webViewWebContentProcessDidTerminate`). WebKit은 **창 안 + foreground**일 때 뷰를 보이는 것으로 본다 | Forums 21956(Frameworks Engineer), WebKit `isActiveViewVisible`(검증 #1b·#4a) |
| F17 | `WKWebsiteDataStore.nonPersistent()`는 메모리에만 두고 디스크에 쓰지 않는다. Vision 한국어는 **accurate**에서만(기존 `OCR`이 accurate + `["ko-KR","en-US"]`) | 문서(검증 #6·#7), `EruriCore/OCR.swift` |
| F18 | 채팅 `send()`는 500 UTF-16 이하 질문을 `/chat`에 보낸다. 링크 처리는 없다. 앱 활성화 때 `Uploader.flush()`·기기 등록·실행 보고가 돈다 | `ios/App/ChatView.swift:342-`, `ios/App/EruriApp.swift:24-30` |
| F19 | 앱은 RLS로 자기 `items`·`facts`를 REST로 읽는다(보관함·항목 상세 선례) | `0001_baseline.sql:110,490`, `EruriCore/Archive.swift:79`, `ItemDetailView.swift:50` |
| F20 | 테스트 lease 접두(`test:<run>`)로 worker를 부르면 그 잡과 자식 잡(notify·embed, `o.leasePrefix`)만 가져간다. 선례 `smoke-process.ts`(insert_item `p_enqueue:false` + `enqueue_job` + worker `{lease_prefix}`) | `worker/index.ts:60-65`, `worker/text-deps.ts:31,52`, `supabase/scripts/smoke-process.ts` |
| F21 | 앱 0.10.0(`ios/project.yml:13`), 보관 계획 R-B9 = 0.11.0(스펙 §11·§15·§16 결정 5, `2026-10-01-retention-summary.md:46,97,3162,3197`) | 해당 파일 |
| F22 | 시뮬레이터 게이트 하네스 사본: `.context/sim-gate-090-shots/{project.gate090.yml.txt, GateHost.swift.txt, Gate.swift.txt}`, 로그인 도구 `.context/gate090/token.ts`(광고 해지 U9 선례: token.ts → Host 주입 → UI 테스트) | `docs/superpowers/plans/2026-10-01-gmail-unsubscribe.md` U9 |

## 미확인 전제와 흡수 게이트 (추측하지 않는다)

| # | 전제 | 상태 | 흡수 게이트 | 실패하면 |
|---|---|---|---|---|
| U1 | iOS 26 **공유 확장 안에서** WKWebView가 원격 https 페이지를 로드하고 JS를 실행한다 | **미확인**(공식 허용·금지 문장 없음, 검증 #1a) | L9 `LNK-device` D1 | `LinkFlow.renderInShareExtension = false`(확장은 대기 행만, "앱을 열면 읽어요") → 0.11.1, `LNK-device` "실패(대안 채택)" + 스펙 §6·§16 반영 |
| U2 | 창 안·다른 화면 밑에 붙인 WKWebView가 타이머·렌더링·`takeSnapshot`을 정상 수행한다 | 미확인(공식 문서 없음, WebKit 소스상 창 안이면 가시) | L3 테스트(시뮬레이터: 지연 JS·스냅샷 OCR), L9 D1·D2(실기기) | 웹뷰를 화면 위 투명도 0.01로 올리는 대안 → 같은 테스트 |
| U3 | 확장 메모리 한도(수치 미공개, "현저히 낮음") 안에서 확장의 렌더링(OCR 없음)이 버틴다 | 미확인(120MB는 공식 수치 아님) | L9 D1(실제 청첩장) | U1과 같은 대안 |
| U4 | iOS 26 **시뮬레이터**에서 Vision ko-KR accurate가 동작한다 | 미확인(macOS 26 실측만, 검증 #7) | L3 `testImageOnlyPageUsesOCR` | 시뮬레이터에서 안 되면 그 테스트를 실기기 D2로 옮기고 L3은 스냅샷이 비지 않음만 단언 |
| U5 | 시뮬레이터 앱이 `http://127.0.0.1:<port>`를 ATS 예외로 로드한다 | 미확인(ATS는 IP 주소 연결에 적용되지 않는다고 기억 — 문서 재확인 안 함) | L8 Step 2 | 게이트 하네스(커밋 안 함)의 Info.plist에 `NSAppTransportSecurity`·`NSAllowsLocalNetworking = YES` |
| U6 | 흔한 모바일 청첩장(바른손·카카오 등)·지도 링크에서 글이 나온다 | 미확인(실제 페이지는 픽스처로 쓸 수 없다) | 합성 형태별 L3 픽스처(정적·지연 JS·숨은 덮개·이미지 전용·지도형), L9 D1·D3(사용자 실제 링크, 메타만) | 실패 형태를 메타로 기록하고 사용자에게 보고(새 형태는 픽스처 추가 태스크) |
| U7 | Jev 게이트가 합성 링크 본문(청첩장·돌잔치·행사)을 행동 항목으로 통과시킨다 | 미확인 | L7 `LNK-eval` | 행동 사례가 게이트로 폐기되면 멈추고 메인이 사용자에게 "사용자가 공유한 링크는 게이트 생략"(워커 변경 → ③c2 뒤 별도 계획)을 묻는다 |
| U8 | HTTP 서버 리다이렉트도 `decidePolicyFor navigationAction`을 거쳐 이동 횟수에 세어진다 | 미확인 | 없음(영향 작음 — 넘쳐도 예산 시간이 끊는다) | — |
| U9 | `UIImage`·`CGImage`를 `Task.detached`로 넘길 수 있다(Sendable) | 미확인(SDK 표기) | L3 컴파일 | `struct OCRImage: @unchecked Sendable { let cg: CGImage }`(불변 이미지) |

## Review Focus

1. **끝나지 않는 페이지**(배경 슬라이드·카운트다운·방명록 자동 갱신)·무거운 갤러리. 사람은 공유가 오래 걸리지 않고 읽은 만큼이라도 처리되길 기대한다 → 예산(10·15초)이 끝나면 그때까지의 글로 진행(L1 `testSettleDeadline`, L3 `testNeverSettlingPageReturnsPartial`).
2. **"터치해서 열기" 덮개 뒤 본문**(숨은 요소). 사람은 덮개가 있어도 날짜를 찾길 기대한다 → 보이는 글에 날짜가 없고 숨은 글에 있으면 숨은 글(L1 `testBodyPrefersHiddenTextWhenOnlyItHasDate`, L3 `testHiddenCoverTextIsRead`).
3. **이미지 전용 청첩장**. 사람은 그림 속 날짜·장소로 일정이 오길 기대한다 → 앱이 스냅샷 OCR(L3 `testImageOnlyPageUsesOCR`, L7 사례 `wedding-ocr`), 확장은 앱에 넘기고 시트에 "앱을 열면 그림 속 글자를 읽어요"(L2 `testShareWithoutDateHandsOff`).
4. **공유 직후 확장이 죽거나 시트를 닫는다**·같은 링크가 두 번 처리된다. 사람은 링크가 사라지지 않고 일정이 두 번 오지 않길 기대한다 → 대기 행 lease 60초 뒤 앱이 이어받고, 캡처 id는 대기 행마다 고정이라 큐(`INSERT OR IGNORE`)·서버(`SHARE:<id>`) 모두 한 건(L2 `testExtensionDeathHandsOffAfterLease`·`testFinishTwiceKeepsOneCapture`).
5. **페이지가 앱 스킴으로 튄다**(`kakaolink://`, `intent:`)·새 창을 연다. 사람은 다른 앱이 열리지 않고 읽기가 이어지길 기대한다 → 차단하고 계속(L3 `testAppSchemeNavigationIsBlockedAndPageStillRead`).
6. **주소 쿼리의 숫자**(`?code=482913`). 사람은 청첩장이 "인증번호"로 버려지지 않길 기대한다 → 본문에는 호스트만(L1 `testComposeKeepsHostOnly`, L2 `testQueryDigitsDoNotDiscard`).
7. **채팅 질문에 주소가 섞임·주소 두 개**. 사람은 예측 가능한 동작을 기대한다 → 주소 1개면 링크 수집(메모 유지), 2개면 안내, 스킴 없는 도메인은 질문(L1 `testChatIntent`).
8. **진단 기록에 주소·제목이 샌다**. → trace 필드는 `LinkFlow.traceFields`가 코드·수만 만든다(L2 `testTraceFieldsHaveNoURLOrText`).

## 파일 구조

```text
docs/superpowers/specs/2026-09-22-assistant-design.md          # L0 스펙(원본)
docs/superpowers/plans/2026-10-01-retention-summary.md         # L0 R-B9 0.11.0 → 0.12.0
ios/Packages/EruriCore/Sources/EruriCore/LinkText.swift        # L1 신규: 링크 판정·주소 검사·날짜 후보·본문 만들기 + LinkPage + LinkSettle
ios/Packages/EruriCore/Tests/EruriCoreTests/LinkTextTests.swift
ios/Packages/EruriCore/Sources/EruriCore/CaptureQueue.swift    # L2 링크 대기 행(kind = 'link')
ios/Packages/EruriCore/Sources/EruriCore/CapturePipeline.swift # L2 handleLink
ios/Packages/EruriCore/Sources/EruriCore/LinkFlow.swift        # L2 신규: PendingLink · LinkRendering · LinkRenderOutcome · 확장/앱 흐름 · trace 필드
ios/Packages/EruriCore/Tests/EruriCoreTests/LinkFlowTests.swift
ios/Packages/EruriCore/Sources/EruriCore/LinkCaptureText.swift # L2 신규: 확장·채팅·알림 문구, 서버 상태 → 결과(L4·L5가 쓴다)
ios/Packages/EruriCore/Tests/EruriCoreTests/LinkCaptureTextTests.swift
ios/Packages/EruriCore/Sources/EruriCore/LinkRenderer.swift    # L3 신규: WKWebView 렌더러(@MainActor) + 추출 JS
ios/Packages/EruriCore/Sources/EruriCore/OCR.swift             # L3 recognize(image:)
ios/Packages/EruriCore/Tests/EruriCoreTests/LinkRendererTests.swift
ios/ShareExtension/ShareViewController.swift                   # L4 링크 경로
ios/ShareExtension/LinkStatusView.swift                        # L4 신규: 시트 안 상태 화면(UIKit)
ios/App/LinkCapture.swift                                      # L5 신규: 앱 렌더 호스트·이어받기·채팅 업로드·폴링
ios/App/ChatView.swift                                         # L5 링크 턴
ios/App/EruriApp.swift                                         # L5 foreground 이어받기
ios/Packages/EruriCore/Sources/EruriCore/ScheduleCard.swift     # L5 "공유한 링크" · L6 location
ios/Packages/EruriCore/Tests/EruriCoreTests/ScheduleCardTests.swift
ios/Packages/EruriCore/Sources/EruriCore/ProposalReview.swift   # L6 addFields location
ios/Packages/EruriCore/Tests/EruriCoreTests/ProposalReviewTests.swift
ios/App/NotificationActions.swift                              # L6 AddEventRequest.location → EKEvent.location
supabase/eval/link-cases.json                                  # L7 신규(합성 링크 본문 + 기대값)
supabase/scripts/eval-link.ts                                  # L7 신규(배포된 worker, 테스트 lease, 테스트 사용자 13)
ios/project.yml                                                # L8 0.11.0
docs/superpowers/phase1/gates.md                               # L7 LNK-eval · L8 LNK-sim · L9 LNK-device
```

`EruriCore`는 SPM이라 새 파일이 자동으로 들어간다. 앱·확장 타깃은 xcodegen 폴더 소스라 새 파일 뒤 `./scripts/sim.sh gen`이 필요하다. 테스트 픽스처는 파일이 아니라 테스트 안 HTML 문자열이다(번들 리소스 추가 없음).

## 실행 순서

1. L0(스펙) 커밋 → 메인 push.
2. L1 → L2 → L3(각 태스크 리뷰 통과 뒤 다음). L6은 L0 뒤 아무 때나(다른 파일).
3. L4·L5는 L3 뒤 병렬 가능(L4 = `ios/ShareExtension/`, L5 = `ios/App/`·`LinkCaptureText`·`ScheduleCard` 출처 — L6과 `ScheduleCard.swift`가 겹치므로 **L5와 L6은 같은 pane에서 순서대로** 하거나 L6을 먼저 끝낸다).
4. L7은 L1 뒤, 측정 창 밖이면 언제든(배포 없음). 결과가 L8 진행 조건이다(U7).
5. L8(0.11.0 + 시뮬레이터 게이트) — 측정 창 밖.
6. [광고 해지 계획 U6b: 0.10.0 TestFlight 기록] → L9.

---

### Task L0: 스펙·버전 문서

**Files:**
- Modify: `docs/superpowers/specs/2026-09-22-assistant-design.md`(머리 줄·§2·§5·§6·§7·§8·§9·§10·§11·§12·§15·§16)
- Modify: `docs/superpowers/plans/2026-10-01-retention-summary.md`(R-B9 버전 4곳)

**Interfaces:**
- Produces: 스펙 §6 "링크 읽기"(이후 태스크의 원본 — 상수·문구·형식), 버전 0.11.0(이 기능)·0.12.0(R-B9).

- [ ] **Step 1: 버전 확인**

Run: `git log --oneline -5 -- ios/project.yml && grep -n MARKETING_VERSION ios/project.yml`
Expected: `MARKETING_VERSION: 0.10.0`. 0.11.0 이상이면 멈추고 메인에게 알린다(D10 — 다음 빈 마이너로 아래 숫자를 모두 바꾼다).

- [ ] **Step 2: 머리 줄**

`작성일: 2026-09-22 · 갱신: ` 바로 뒤에 넣는다:

```text
2026-10-02 (링크 → 일정 제안 방식 A — 기기 렌더링, 사용자 결정 §2·§5·§6·§7·§8·§9·§10·§11·§12·§15·§16) · 
```

- [ ] **Step 3: §2 결정 표**

`| 공유 | Share Extension: 텍스트·URL·이미지·PDF | 사용자 확정 |` 행 바로 아래에 행을 더한다:

```text
| 링크 → 일정 | 청첩장·초대장·행사 페이지 링크를 공유 시트 또는 채팅 붙여넣기로 받으면 **기기가 보이지 않는 웹뷰로 렌더링해** 글(제목·OG 설명·본문, 날짜가 없으면 화면 OCR)을 읽어 SHARE 항목(`app_name = "웹 링크"`)으로 보낸다. **서버는 외부 URL을 가져오지 않는다** | 2026-10-02 사용자 결정 방식 A(§6 "링크 읽기", §16) |
```

- [ ] **Step 4: §5 수집 경로 표 두 행**

`| 공유 | Share Extension | 사용자 선택 | NSItemProvider 실제 타입 | 로그인 필요한 URL 본문은 못 받음 |` →

```text
| 공유 | Share Extension | 사용자 선택 | NSItemProvider 실제 타입. 웹 주소 하나면 기기가 페이지를 읽은 글(§6 "링크 읽기") | 로그인이 필요한 페이지는 못 읽음(웹뷰 비영속 저장소). 이미지·PDF는 2단계 |
```

`| 채팅·Siri·빠른 기억 | AskIntent / QuickMemoryIntent | 사용자 입력 | 텍스트 | — |` →

```text
| 채팅·Siri·빠른 기억 | AskIntent / QuickMemoryIntent | 사용자 입력 | 텍스트. 채팅 입력에 `http(s)://` 주소가 정확히 하나면 질문이 아니라 링크 수집(§9) | — |
```

- [ ] **Step 5: §6 새 소절 "링크 읽기"**

`## 7. 서버 파이프라인` 줄 바로 앞(빈 줄 하나 두고)에 넣는다:

````text
### 링크 읽기 (2026-10-02 사용자 결정 방식 A, 앱 0.11.0)

청첩장·초대장·행사 페이지 링크는 **기기가 렌더링해 읽는다**. 서버는 외부 URL을 가져오지 않는다(§7). 순수 로직은 `EruriCore` `LinkText`·`LinkSettle`, 웹뷰는 `LinkRenderer`, 흐름은 `LinkFlow`(공유 확장·앱 공용).

- **입력**: ① 공유 시트 — 공유 한 번의 텍스트 표현(`ShareText.compose`)에 `http://`·`https://`로 적힌 주소가 정확히 하나면 링크(나머지 글은 메모, 200자). 둘 이상이면 지금처럼 텍스트 공유. ② 채팅 — 입력에 그런 주소가 정확히 하나면 질문이 아니라 링크 수집(§9). 스킴 없는 도메인은 링크로 보지 않는다. 앱은 클립보드를 읽지 않는다(사용자가 입력창에 붙여넣은 글만).
- **주소 검사**: http(s)만. 사설·루프백·링크로컬·CGNAT IP 리터럴, `.local`·`.localhost`·`.internal`·`.home.arpa`, 점 없는 호스트는 열지 않는다(DEBUG 빌드만 `localhost`·`127.0.0.1` 허용 — 시뮬레이터 게이트). 서버 SSRF 방어가 아니라 기기 위생이다(로컬 네트워크 권한 창·내부 기기 접근 회피). 이름이 사설 주소로 풀리는 경우는 브라우저처럼 막지 않는다.
- **웹뷰**: `WKWebView`(390×844pt)를 창 안 다른 화면 **밑**에 붙여 사용자에게 보이지 않게 연다. WebKit은 창 안·foreground일 때만 뷰를 보이는 것으로 다뤄 렌더링·타이머를 정상으로 돌린다 — 화면 밖·창 밖, iOS 26 `WebPage` 단독 사용은 비가시 스로틀이 미확인이라 쓰지 않는다. 비영속 저장소(쿠키·로그인 없음 — 로그인이 필요한 페이지는 못 읽는다), 미디어 자동 재생 금지, 새 창·앱 스킴 이동(`kakaolink:` 등)·다운로드는 막고 읽기는 계속, 메인 프레임 이동 6회 초과·HTTP 4xx/5xx·표시할 수 없는 형식은 실패. JS는 켠다(SPA 청첩장).
- **대기**: WebKit에는 network idle 판정이 없다. `didFinish`(오지 않으면 4초) 뒤 `document.body.innerText` 길이를 0.5초마다 재서 3번 같으면 완료. 예산(확장 10초·앱 15초)이 끝나면 그때까지 읽은 글로 진행하고, 0자면 실패.
- **읽는 것**: 격리된 JS 세계(`WKContentWorld.defaultClient`)에서 `document.title`, `og:title`, `og:description`(없으면 `description`), 보이는 글(`innerText`), 숨은 요소를 포함한 글(스크립트·스타일 제외 텍스트 노드 — "터치해서 열기" 덮개 뒤 본문). 본문은 보이는 글을 쓰고, 보이는 글에 날짜 후보가 없는데 숨은 글에 있으면 숨은 글을 쓴다. 각 200,000자에서 자른다.
- **이미지 전용**: 제목·설명·본문에 날짜 후보(`11월 14일`·`2026.11.14`·`2026-11-14`·`11/14`·`11. 14.(토)`·영문 월 + 일)가 없으면 **앱에서만** 화면을 최대 3화면 스냅샷(너비 780px, 스크롤 뒤 0.6초 대기)해 기기 Vision OCR(ko-KR·en-US, accurate)로 읽는다. 스냅샷·이미지는 메모리에서만 쓰고 저장·전송하지 않는다. 서버 vision 경로(이미지 업로드)는 제품에 없다(2단계).
- **보내는 글**(큐 항목 1개, source `SHARE`, `app_name = "웹 링크"`, `title` = og:title, 없으면 document.title, 120자):

  ```text
  [웹 링크] <호스트>
  제목: <페이지 제목>
  설명: <OG 설명 300자 — 제목에 들어 있으면 생략>
  메모: <공유·채팅에 함께 적은 글 200자>
  본문:
  <줄 단위 — 공백 정리·같은 줄 제거>
  (뒤쪽 일시·장소 줄)
  <본문이 넘칠 때 뒤쪽에서 날짜·시각·장소 단어가 있는 줄, 1,000자>
  이미지 속 글자:
  <OCR 1,500자>
  ```

  전체 4,000자(서버 추출 입력 상한과 같다 — 모델이 보지 않는 뒷부분은 보내지 않는다). 주소는 **호스트만** — 경로·쿼리의 숫자가 OTP 규칙(`code` + 숫자)에 걸려 항목 전체가 폐기되는 것을 막고 초대 토큰을 남기지 않는다(대가: 보관함에서 원래 링크를 다시 열 수 없다, §16 UQ2). 그다음은 지금 공유와 같다: 기기 규칙(연락처 규칙 없음) → 큐 → 업로드 → 서버 규칙·게이트·추출·제안(§7).
- **확장과 앱의 이어받기**: 확장은 렌더링 **전에** App Group 큐에 링크 대기 행(`kind = 'link'`, id `link:<uuid>`, 캡처 id·주소·메모·공유 시각, lease 60초)을 남긴다. 확장은 OCR 없이 10초 동안 읽고, 날짜 후보가 있으면 큐 항목을 넣고 행을 지운다. 시간 초과·로드 실패·웹 프로세스 종료·날짜 후보 없음이면 행을 앱에 넘기고(lease 즉시 만료) 시트에 "앱을 열면 다시 읽어요"를 보인다. 막힌 주소·HTTP 오류·이동 초과·빈 페이지는 다시 해도 같으므로 행을 지우고 실패를 보인다. 확장이 죽으면 60초 뒤 행이 풀린다. 앱은 **foreground가 될 때만** 대기 행을 처리한다(백그라운드에서는 WebKit이 멈춘다). 확장은 앱을 열 수 없다(지원 경로 없음). 큐 항목 id = 대기 행의 캡처 id라 같은 링크를 다시 읽어도 큐(`INSERT OR IGNORE`)·서버 멱등 키(`SHARE:<id>`)가 한 건으로 막는다. 앱 이어받기가 실패하면 로컬 알림 1건("공유한 링크를 읽지 못했어요", 주소·제목 없음). 공유·붙여넣은 시각이 `occurred_at`(상대 날짜 기준일)이다. 확장이 넣은 항목의 업로드는 지금 공유와 같이 다음 flush(인텐트·BG refresh·무음 푸시·앱 활성화)다.
- **실기기 미확인(게이트)**: 공유 확장 안 WKWebView 동작과 확장 메모리 한도는 공식 문서에 없다 → 0.11.0 실기기 게이트. 실패하면 확장 렌더링을 끄고(`LinkFlow.renderInShareExtension = false` — 행만 남기고 "앱을 열면 읽어요") 앱만 읽는다.
- **진단**: trace `share.link`(필드 `origin`·`result`·`code`·`elapsed_ms`·`chars`·`ocr`·`timed_out`·`blocked_nav`)만. 주소·호스트·제목·본문은 로그·trace에 남기지 않는다.

````

- [ ] **Step 6: §7 URL 줄**

다음 두 줄을

```text
  → URL: 허용 스킴 http(s)만, 사설·루프백 IP 차단, 리디렉션 3회, 응답 2MB·10초 제한, 텍스트 MIME만
      본문 추출 실패(HTML 파싱 오류·JS 전용) → "스크린샷 공유 요청" 푸시. 짧은 정상 문서는 그대로 저장
```

이것으로 바꾼다:

```text
  → URL: **서버는 외부 URL을 가져오지 않는다**(2026-10-02 사용자 결정 방식 A). 링크는 기기가 렌더링해 읽은 글이
      SHARE 항목(`app_name = "웹 링크"`, 제목 = 페이지 제목)으로 오고(§6 "링크 읽기") 다른 SHARE 항목과 같이 규칙 → 게이트 → 추출 → 제안을 탄다
```

- [ ] **Step 7: §8 items 행 비고 끝**

`(규칙 폐기는 null, M1-④a `0010`) |` →

```text
(규칙 폐기는 null, M1-④a `0010`). 링크 항목(2026-10-02)은 source `SHARE` + `app_name = '웹 링크'` + `title` = 페이지 제목, 본문 = 기기가 만든 발췌(≤4,000자, 첫 줄 `[웹 링크] <호스트>`, §6 "링크 읽기") — 새 source 없음 |
```

- [ ] **Step 8: §9 채팅 링크 붙여넣기**

`- 채팅 음성 입력: 기기 안 받아쓰기(Speech, 온디바이스 전용, ko-KR), 서버 전송 없음 — 2026-10-01 사용자 요청. 받아쓴 글은 입력창에 채워질 뿐이고 보내기 전까지 전송되지 않는다(앱 0.6.0).` 줄 바로 아래에 넣는다:

```text
- **채팅 링크 붙여넣기(2026-10-02 사용자 결정, 앱 0.11.0)**: 입력에 `http://`·`https://`로 적힌 주소가 정확히 하나면 질문이 아니라 **링크 수집**이다 — `/chat`을 부르지 않고 앱이 페이지를 읽어(§6 "링크 읽기", 15초 + 필요하면 OCR) SHARE 항목으로 바로 올린다(나머지 글은 메모). 둘 이상이면 "링크는 한 번에 하나씩 보내 주세요". 스킴 없는 도메인은 질문이다. 링크 턴은 답 대신 상태 문구를 보인다: "링크를 읽는 중…" → "페이지에서 글 N자를 읽었어요. 일정을 찾는 중…" → 처리 결과(3초마다 최대 60초 — 본인 `items.status`·`facts` 종류만 읽는다): 일정 "일정 N건을 찾았어요 — '제안' 탭과 알림에서 추가할 수 있어요", 할 일 "할 일을 찾았어요 — 알림에서 확인하세요", 결과 없음 "이 페이지에서 일정을 찾지 못했어요", 게이트 격리 "분류에서 걸러졌어요 — 보관함 › 최근 폐기에서 복구할 수 있어요", 규칙 폐기(기기·서버) "인증번호 같은 숫자가 있어 저장하지 않았어요", 60초 초과 "아직 처리 중이에요 — 끝나면 알림으로 알려 드려요", 읽기 실패 "페이지를 읽지 못했어요(<사유>)". 링크 턴에는 일정 답 카드·"보관함에서 보기"·맞아요/틀렸어요 막대가 없다(제안은 "제안" 탭·알림).
```

- [ ] **Step 8b: §9 일정 답 카드 출처 문구**

`그 밖의 앱 알림 "<앱 이름> 알림", 공유 "공유한 내용", 못 찾으면 "저장된 정보")` →

```text
그 밖의 앱 알림 "<앱 이름> 알림", 공유 "공유한 내용"(링크 항목 `app_name = '웹 링크'`는 "공유한 링크", 0.11.0), 못 찾으면 "저장된 정보")
```

- [ ] **Step 9: §10 일정 위치**

`- 채팅에서 "기억해줘"와 "캘린더에 추가"는 별개 동작이다.` 줄 바로 아래에 넣는다:

```text
- **일정 위치(2026-10-02, 앱 0.11.0)**: 제안 payload의 `location`(추출한 장소·주소 그대로)이 있으면 EventKit 일정의 위치(`location`, 문자열)에 넣는다. 경로는 "제안" 탭 행·배너 탭 시트(목록 값)·채팅 일정 답 카드다. 잠금화면 "캘린더에 추가"와 목록에 없어 알림 값으로 추가하는 경로는 푸시 페이로드에 위치가 없어 위치 없이 저장한다(서버 notify에 위치를 싣는 것은 다음 단계 후보). 위치는 표식·겹침·비슷한 일정 판정에 쓰지 않는다.
```

- [ ] **Step 10: §11 타깃 표·버전**

`| `ShareExtension` | 입력 수신 → 큐 |` →

```text
| `ShareExtension` | 입력 수신 → 큐. 웹 주소 하나면 링크 읽기(§6) 뒤 큐, 못 읽으면 대기 행을 앱에 넘김 |
```

`광고 메일 구독 해지 화면(설정 Gmail 절 → 목록)은 0.10.0, 요약·저장 공간 화면은 서버 반영 뒤라 0.11.0)` →

```text
광고 메일 구독 해지 화면(설정 Gmail 절 → 목록)은 0.10.0, 링크 → 일정(공유 시트·채팅 붙여넣기)은 0.11.0, 요약·저장 공간 화면은 서버 반영 뒤라 0.12.0)
```

- [ ] **Step 11: §12 통제 2**

`- URL 본문·이미지 OCR·채팅 발화도 서버 규칙 필터(OTP·카드·계좌)를 같은 함수로 통과시킨 뒤 저장한다. URL 본문은 fetch 직후, OCR은 기기에서 이미 적용된 것을 서버에서 재적용한다.` →

```text
- 링크 본문(기기 렌더링·OCR)·이미지 OCR·채팅 발화도 서버 규칙 필터(OTP·카드·계좌)를 같은 함수로 통과시킨 뒤 저장한다. 링크 본문과 OCR은 기기 규칙을 거쳐 올라오고 서버가 재적용한다(서버는 URL을 가져오지 않는다, 2026-10-02).
- **링크 읽기(2026-10-02)**: 페이지는 사용자 기기가 연다 — 사이트는 기기 IP를 본다(브라우저로 여는 것과 같다). 웹뷰는 비영속 저장소(쿠키·로그인 없음). 서버로 가는 것은 발췌(≤4,000자)·페이지 제목·호스트뿐이고 경로·쿼리·페이지 전체·이미지·스냅샷은 보내지도 저장하지도 않는다. 발췌는 다른 항목과 같이 암호화 3년·요약·청크(§8, 청크 평문 기간은 UC-1). Jev·OpenAI로 가는 것은 다른 SHARE 항목과 같다(새 수신자 없음). 로그·trace에는 결과 코드·글자 수만(주소·호스트·제목 없음). 저장 범위(발췌 저장 / 추출 결과만)와 주소 범위(호스트 / 전체)는 사용자 확인 대기(§16 "2026-10-02 링크 → 일정" UQ1·UQ2).
```

- [ ] **Step 12: §15 1단계 추가 범위·확장 후보**

`Outlook 커넥터 인터페이스는 만들지 않는다.` 줄 바로 앞(빈 줄 하나 두고)에 넣는다:

```text
**1단계 추가 범위(2026-10-02 링크 → 일정 결정, §16)**: 청첩장·초대장·행사 페이지 링크를 공유 시트·채팅 붙여넣기로 받아 기기가 렌더링해 읽고(§6 "링크 읽기") 기존 SHARE 경로로 일정 제안, EventKit 일정 위치(§10). 계획 `docs/superpowers/plans/2026-10-02-link-event.md`, 앱 0.11.0. **서버 변경·배포 없음**(새 source·마이그레이션 없음) — Gmail 측정 기간 제약은 배포된 함수를 호출하는 평가·시뮬레이터 게이트의 측정 창(③c1·③c2) 회피뿐이다. TestFlight는 0.10.0(광고 해지) TestFlight 뒤. M2 게이트와 독립.

```

확장 후보의 `- 링크 → 일정 제안(청첩장·초대장·행사 페이지, **사용자가 필요하다고 함**, 2026-10-02): …` 한 줄(전체)을 이것으로 바꾼다:

```text
- 링크 → 일정 제안(청첩장·초대장·행사 페이지): 2026-10-02 사용자 결정으로 1단계 추가 범위(위)로 옮겼다 — 서버 가져오기 대신 기기 렌더링(방식 A, §6 "링크 읽기").
```

여행 글 후보의 `서버가 본문 가져오기(네이버 블로그 모바일 주소·티스토리·일반 HTML)` →

```text
기기 렌더러로 본문 읽기(§6 "링크 읽기" 공유 — 서버는 URL을 가져오지 않는다, 2026-10-02)
```

`요약·저장 공간 화면은 앱 0.11.0이다(0.9.x는 다건·종일·중복 일정, 0.10.0은 광고 구독 해지).` →

```text
요약·저장 공간 화면은 앱 0.12.0이다(0.9.x는 다건·종일·중복 일정, 0.10.0은 광고 구독 해지, 0.11.0은 링크 → 일정).
```

- [ ] **Step 13: §16 버전 행·새 소절**

`(→ 0.11.0, 2026-10-01 광고 구독 해지)(§11) |` →

```text
(→ 0.11.0, 2026-10-01 광고 구독 해지)(→ 0.12.0, 2026-10-02 링크 → 일정)(§11) |
```

`### 플랜 B: 로컬 우선 구조 (미채택, 신뢰 문제 발생 시 전환)` 줄 바로 앞(빈 줄 하나 두고)에 넣는다:

```text
### 2026-10-02 링크 → 일정 (사용자 결정, 앱 0.11.0)

청첩장·초대장·행사 페이지 링크에서 일정 제안을 받고 싶다(사용자가 필요하다고 함). 입력은 공유 시트와 채팅 붙여넣기 둘 다. **방식 A: 기기가 렌더링해 읽는다** — 서버는 외부 URL을 가져오지 않는다(§6 "링크 읽기"). 기각: (1) 서버 가져오기(§15 후보 원안) — SSRF 방어·DNS 재바인딩(§12 통제 3과 같은 수용 위험)을 새로 지고, JS로 글을 그리는 모바일 청첩장을 못 읽는다 (2) 새 source `LINK` — `items.source` check 제약·ingest·앱 출처 표시·채팅 필터를 모두 바꾸고 배포가 필요한데 처리 경로는 SHARE와 같다 (3) 확장만 렌더링 — 확장 안 WKWebView·메모리 한도가 미확인이고 확장은 앱을 열 수 없어 실패하면 길이 없다 → 확장 + 앱 대기 행 이어받기 (4) iOS 26 `WebPage` 단독 사용 — 뷰 없이 쓸 수 있으나 비가시 스로틀이 미확인 (5) 서버 vision으로 이미지 청첩장 — 제품에 이미지 업로드 경로가 없다(2단계) → 앱 OCR. 계획이 정한 것: 저장은 기존 항목 규칙(발췌 ≤4,000자 암호화 3년·요약·청크), 주소는 호스트만, 이미지 전용은 앱 OCR(확장은 OCR 없음), 채팅은 주소 1개면 수집, 일정 위치는 EventKit에(잠금화면 경로 제외). **사용자 확인 대기**: UQ1 저장 범위(A 기존 규칙 — 계획 기본 / B 추출 결과만 — 워커 변경, ③c2 뒤 별도 계획), UQ2 주소 범위(호스트만 — 기본 / 전체 주소 — 서버 규칙 변경), UQ3 채팅 판정(주소 1개면 — 기본 / 입력 전체가 주소일 때만). 미확인 전제(공유 확장 안 WKWebView, 창 안·화면 밑 렌더링, 확장 메모리, 시뮬레이터 Vision 한국어, 실제 청첩장 서비스 형태, Jev 게이트 통과)는 0.11.0 게이트(`LNK-eval`·`LNK-sim`·`LNK-device`)가 판정한다. 개인정보 등급 변화: 새 수신자 없음(Jev·OpenAI는 SHARE와 같다), 페이지는 사용자 기기가 연다.

```

- [ ] **Step 14: 보관 계획 R-B9 버전 4곳**

`docs/superpowers/plans/2026-10-01-retention-summary.md`:
- `**R-B9 = 0.11.0**(스펙 §11 — 0.10.0은 광고 구독 해지 계획 `2026-10-01-gmail-unsubscribe.md`)` → `**R-B9 = 0.12.0**(스펙 §11 — 0.10.0은 광고 구독 해지 계획 `2026-10-01-gmail-unsubscribe.md`, 0.11.0은 링크 → 일정 계획 `2026-10-02-link-event.md`)`
- `# R-A2 0.7.0 / R-B9 0.11.0` → `# R-A2 0.7.0 / R-B9 0.12.0`
- `버전: `MARKETING_VERSION: 0.11.0`(0.10.0은 광고 구독 해지 계획 — `git log --oneline -- ios/project.yml`로 0.10.0이 main에 있는지 확인하고, 없으면 메인에게 알린다).` → `버전: `MARKETING_VERSION: 0.12.0`(0.10.0은 광고 구독 해지, 0.11.0은 링크 → 일정 계획 — `git log --oneline -- ios/project.yml`로 0.11.0이 main에 있는지 확인하고, 없으면 메인에게 알린다).`
- `보관·요약·용량은 Gmail 게이트 뒤(0.11.0 — 0.10.0은 광고 구독 해지 계획)` → `보관·요약·용량은 Gmail 게이트 뒤(0.12.0 — 0.10.0은 광고 구독 해지, 0.11.0은 링크 → 일정 계획)`

- [ ] **Step 15: 확인**

Run:

```bash
S=docs/superpowers/specs/2026-09-22-assistant-design.md
grep -c '링크 읽기' $S                                   # 5 이상
grep -n '허용 스킴 http(s)만, 사설·루프백 IP 차단' $S     # 0줄
grep -n '0.12.0' $S | wc -l                              # 3 이상(§11·§15·§16)
grep -n '사용자가 필요하다고 함' $S                        # 0줄(후보 문단 교체)
grep -n 'R-B9 = 0.12.0\|R-B9 0.12.0\|MARKETING_VERSION: 0.12.0\|(0.12.0 —' docs/superpowers/plans/2026-10-01-retention-summary.md | wc -l   # 4
grep -n '0\.11\.0' docs/superpowers/plans/2026-10-01-retention-summary.md   # 남은 줄은 "0.11.0은 링크 → 일정" 설명뿐
```

- [ ] **Step 16: 커밋**

```bash
git add docs/superpowers/specs/2026-09-22-assistant-design.md docs/superpowers/plans/2026-10-01-retention-summary.md
git commit -m "docs(spec): link → event proposals (user decision, method A, app 0.11.0) — §6 link reading on device: share sheet or chat paste with exactly one http(s) URL, hidden WKWebView in the window under other views (non-persistent store, no autoplay, app-scheme and new-window navigations blocked, 6 main-frame navigations, private/loopback IP literals and .local refused), settle on 3 equal innerText lengths after didFinish or 4 s within 10 s (extension) / 15 s (app), title/og/visible and hidden text, app-only snapshot OCR when no date candidate, one SHARE item (app_name 웹 링크, host only, ≤4,000 chars), pending link row with 60 s lease handed to the app on foreground; §7 server never fetches URLs; §9 chat link turn states; §10 EventKit location from proposal payload; §11/§15 0.11.0 and R-B9 0.12.0; §12 privacy; §16 decision, rejected options, UQ1–UQ3 pending

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```


### Task L1: EruriCore `LinkText`·`LinkPage`·`LinkSettle` (순수 로직)

**Files:**
- Create: `ios/Packages/EruriCore/Sources/EruriCore/LinkText.swift`
- Test: `ios/Packages/EruriCore/Tests/EruriCoreTests/LinkTextTests.swift`

**Interfaces:**
- Consumes: 없음(Foundation만).
- Produces:
  - `LinkText.maxChars = 4000`·`tailKeyChars = 1000`·`ocrMaxChars = 1500`·`titleMaxChars = 120`·`descMaxChars = 300`·`noteMaxChars = 200`·`appName = "웹 링크"`
  - `LinkText.webURLs(in: String) -> [URL]`
  - `enum LinkText.ChatIntent: Equatable { case none, link(URL, note: String?), tooMany(Int) }` · `LinkText.chatIntent(_ input: String) -> ChatIntent`
  - `LinkText.shareLink(_ composed: String) -> (url: URL, note: String?)?`
  - `enum LinkText.Blocked: String { case scheme, host }` · `LinkText.check(_ url: URL, allowLoopback: Bool) -> Blocked?`
  - `LinkText.hasDateCandidate(_ s: String) -> Bool`
  - `struct LinkText.Composed: Equatable { title: String?; text: String; bodyChars: Int; truncated: Bool }` · `LinkText.compose(_ page: LinkPage, note: String?) -> Composed`
  - `struct LinkPage: Equatable, Sendable { host, title, description, visibleText, allText: String; ocrText: String?; timedOut: Bool; body; searchable; isEmpty; static decode(json:host:) -> LinkPage? }` — init 인자는 `host` 외 전부 기본값
  - `struct LinkSettle { static pollInterval: Duration = .milliseconds(500); static stableSamples = 3; static finishGrace: TimeInterval = 4; enum Decision { wait, done, deadline }; init(budget:); mutating observe(length:finished:elapsed:) -> Decision }`

- [ ] **Step 1: 실패하는 테스트**

`ios/Packages/EruriCore/Tests/EruriCoreTests/LinkTextTests.swift`:

```swift
import XCTest
@testable import EruriCore

/// 링크 → 일정(스펙 §6 "링크 읽기"): 판정·주소 검사·날짜 후보·본문 만들기·대기 판정. 글은 모두 합성
final class LinkTextTests: XCTestCase {
  let invite = URL(string: "https://invite.example.com/m/abc?code=482913")!

  /// 채팅(스펙 §9): http(s):// 주소가 정확히 하나면 링크 수집, 나머지 글은 메모. 둘 이상은 안내, 스킴 없는 도메인은 질문
  func testChatIntent() {
    XCTAssertEqual(LinkText.chatIntent("https://invite.example.com/m/abc?code=482913"), .link(invite, note: nil))
    XCTAssertEqual(LinkText.chatIntent("청첩장 https://invite.example.com/m/abc?code=482913 이에요"), .link(invite, note: "청첩장 이에요"))
    XCTAssertEqual(LinkText.chatIntent("내일 치과 몇 시야?"), .none)
    XCTAssertEqual(LinkText.chatIntent("naver.com 에서 산 거 언제야"), .none)
    XCTAssertEqual(LinkText.chatIntent("ftp://files.example.com/x"), .none)
    XCTAssertEqual(LinkText.chatIntent("https://a.example.com/1 https://b.example.com/2"), .tooMany(2))
    XCTAssertEqual(LinkText.chatIntent("https://a.example.com/1 다시 https://a.example.com/1"),
                   .link(URL(string: "https://a.example.com/1")!, note: "다시"))               // 같은 주소 두 번은 하나
  }

  /// 공유(스펙 §6): ShareText.compose 결과에 주소가 정확히 하나일 때만 링크. 둘 이상·없음은 지금처럼 텍스트 공유
  func testShareLink() {
    let one = LinkText.shareLink("합성 청첩장\nhttps://invite.example.com/m/abc?code=482913")
    XCTAssertEqual(one?.url, invite)
    XCTAssertEqual(one?.note, "합성 청첩장")
    XCTAssertNil(LinkText.shareLink("[합성] 10월 20일 오후 2시 회의"))
    XCTAssertNil(LinkText.shareLink("https://a.example.com/1\nhttps://b.example.com/2"))
  }

  /// 주소 검사(스펙 §6): http(s)만, 사설·루프백·링크로컬·CGNAT IP 리터럴과 로컬 이름 거부. DEBUG 게이트만 루프백 허용
  func testCheck() {
    func c(_ s: String, loop: Bool = false) -> LinkText.Blocked? { LinkText.check(URL(string: s)!, allowLoopback: loop) }
    XCTAssertNil(c("https://invite.example.com/x"))
    XCTAssertNil(c("http://invite.example.com/x"))
    XCTAssertNil(c("http://93.184.216.34/"))
    XCTAssertNil(c("https://[2606:4700::1111]/"))
    XCTAssertEqual(c("kakaolink://send?x=1"), .scheme)
    XCTAssertEqual(c("file:///etc/hosts"), .scheme)
    for h in ["http://10.0.0.1/", "http://192.168.0.1/", "http://172.20.1.1/", "http://169.254.1.1/", "http://100.64.0.1/",
              "http://0.0.0.0/", "http://224.0.0.1/", "http://127.0.0.1:8765/", "http://localhost:8765/", "http://router.local/",
              "http://intranet/", "http://svc.internal/", "http://[::1]/", "http://[fe80::1]/", "http://[fd00::1]/", "http://[2001:db8::1]/"] {
      XCTAssertEqual(c(h), .host, h)
    }
    XCTAssertNil(c("http://127.0.0.1:8765/link-wedding.html", loop: true))
    XCTAssertNil(c("http://localhost:8765/link-wedding.html", loop: true))
    XCTAssertEqual(c("http://10.0.0.1/", loop: true), .host)                                   // 루프백만 풀린다
  }

  func testDateCandidates() {
    for s in ["2026년 11월 14일 토요일", "11월 14일", "2026.11.14", "2026-11-14", "2026. 12. 5. SAT", "11/14", "11. 14.(토)",
              "Nov 14, 2026", "December 5"] {
      XCTAssertTrue(LinkText.hasDateCandidate(s), s)
    }
    for s in ["오후 1시 30분", "합성웨딩홀 3층", "010-1234-5678", "터치하면 음악이 재생됩니다", "축의금 50,000원"] {
      XCTAssertFalse(LinkText.hasDateCandidate(s), s)
    }
  }

  /// "터치해서 열기" 덮개(스펙 §6): 보이는 글에 날짜가 없고 숨은 글에 있으면 숨은 글
  func testBodyPrefersHiddenTextWhenOnlyItHasDate() {
    let p = LinkPage(host: "invite.example.com", visibleText: "터치해서 열기", allText: "터치해서 열기\n2026년 11월 14일 오후 1시 합성웨딩홀")
    XCTAssertTrue(p.body.contains("11월 14일"))
    let q = LinkPage(host: "x.example.com", visibleText: "2026년 11월 14일 합성웨딩홀", allText: "메뉴\n2026년 11월 14일 합성웨딩홀\n숨은 글")
    XCTAssertEqual(q.body, "2026년 11월 14일 합성웨딩홀")
    XCTAssertEqual(LinkPage(host: "x.example.com", visibleText: "  ", allText: "합성 안내문").body, "합성 안내문")
    XCTAssertTrue(LinkPage(host: "x.example.com").isEmpty)
  }

  func testDecode() {
    let json = #"{"title":"문서 제목","ogTitle":"합성신랑 ♥ 합성신부","ogDescription":"11월 14일","text":"보이는 글","all":"전체 글"}"#
    let p = LinkPage.decode(json: json, host: "invite.example.com")
    XCTAssertEqual(p?.host, "invite.example.com")
    XCTAssertEqual(p?.title, "합성신랑 ♥ 합성신부")
    XCTAssertEqual(p?.description, "11월 14일")
    XCTAssertEqual(p?.visibleText, "보이는 글")
    XCTAssertEqual(p?.allText, "전체 글")
    XCTAssertEqual(LinkPage.decode(json: #"{"title":"문서 제목","ogTitle":""}"#, host: "h.example.com")?.title, "문서 제목")
    XCTAssertNil(LinkPage.decode(json: "not json", host: "h.example.com"))
  }

  /// 보내는 글 형식(스펙 §6): 머리 줄 → 본문(공백 정리·같은 줄 제거). 메모는 한 줄로
  func testComposeFormat() {
    let p = LinkPage(host: "invite.example.com", title: "합성신랑 ♥ 합성신부 결혼합니다", description: "2026년 11월 14일 토요일 오후 1시 30분",
                     visibleText: "일시\n2026년 11월 14일 토요일 오후 1시 30분\n\n장소\n합성웨딩홀   3층\n일시")
    let c = LinkText.compose(p, note: "  청첩장 \n 보내요 ")
    XCTAssertEqual(c.title, "합성신랑 ♥ 합성신부 결혼합니다")
    XCTAssertEqual(c.text, """
      [웹 링크] invite.example.com
      제목: 합성신랑 ♥ 합성신부 결혼합니다
      설명: 2026년 11월 14일 토요일 오후 1시 30분
      메모: 청첩장 보내요
      본문:
      일시
      2026년 11월 14일 토요일 오후 1시 30분
      장소
      합성웨딩홀 3층
      """)
    XCTAssertFalse(c.truncated)
  }

  /// 주소는 호스트만(스펙 §6): 쿼리 숫자가 OTP 규칙에 걸리지 않게
  func testComposeKeepsHostOnly() {
    let c = LinkText.compose(LinkPage(host: "invite.example.com", visibleText: "본문"), note: nil)
    XCTAssertTrue(c.text.hasPrefix("[웹 링크] invite.example.com\n"))
    XCTAssertFalse(c.text.contains("482913"))
    XCTAssertFalse(c.text.contains("code"))
    XCTAssertNil(c.title)
  }

  func testComposeDropsDescriptionInsideTitle() {
    let c = LinkText.compose(LinkPage(host: "h.example.com", title: "합성 북토크 10월 21일", description: "합성 북토크", visibleText: "본문"), note: nil)
    XCTAssertFalse(c.text.contains("설명:"))
  }

  /// 긴 페이지: 앞부분 + 뒤쪽의 일시·장소 줄(1,000자), 전체 4,000자
  func testComposeTruncatesAndKeepsTailKeyLines() {
    let filler = (1...400).map { "합성 갤러리 사진 설명 \($0)번" }
    let p = LinkPage(host: "h.example.com",
                     visibleText: (filler + ["예식 일시 2026년 11월 14일 오후 1시", "장소 합성웨딩홀 3층", "방명록 남기기"]).joined(separator: "\n"))
    let c = LinkText.compose(p, note: nil)
    XCTAssertTrue(c.truncated)
    XCTAssertLessThanOrEqual(c.text.count, LinkText.maxChars)
    XCTAssertTrue(c.text.contains("합성 갤러리 사진 설명 1번\n"))
    XCTAssertTrue(c.text.contains("(뒤쪽 일시·장소 줄)\n예식 일시 2026년 11월 14일 오후 1시\n장소 합성웨딩홀 3층"))
    XCTAssertFalse(c.text.contains("방명록 남기기"))
  }

  func testComposeOCRBlock() {
    let p = LinkPage(host: "card.example.com", title: "모바일 청첩장", visibleText: "터치하면 음악이 재생됩니다",
                     ocrText: "합성민수 그리고 합성지은\n2026. 12. 5. SAT PM 12:00\n\n합성 컨벤션 웨딩홀 5층")
    XCTAssertEqual(LinkText.compose(p, note: nil).text, """
      [웹 링크] card.example.com
      제목: 모바일 청첩장
      본문:
      터치하면 음악이 재생됩니다
      이미지 속 글자:
      합성민수 그리고 합성지은
      2026. 12. 5. SAT PM 12:00
      합성 컨벤션 웨딩홀 5층
      """)
  }

  /// 대기(스펙 §6): didFinish(또는 4초) 뒤 같은 길이 3번이면 완료, 0자는 완료가 아니다
  func testSettle() {
    var s = LinkSettle(budget: 10)
    XCTAssertEqual(s.observe(length: 0, finished: false, elapsed: 0.5), .wait)
    XCTAssertEqual(s.observe(length: 120, finished: true, elapsed: 1.0), .wait)
    XCTAssertEqual(s.observe(length: 120, finished: true, elapsed: 1.5), .wait)
    XCTAssertEqual(s.observe(length: 120, finished: true, elapsed: 2.0), .done)
    var g = LinkSettle(budget: 10)
    for t in [0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5] { XCTAssertEqual(g.observe(length: 80, finished: false, elapsed: t), .wait) }
    XCTAssertEqual(g.observe(length: 80, finished: false, elapsed: 4.0), .done)
    var e = LinkSettle(budget: 10)
    for t in [1.0, 1.5, 2.0, 2.5] { XCTAssertEqual(e.observe(length: 0, finished: true, elapsed: t), .wait) }
  }

  /// 끝없이 바뀌는 페이지: 예산이 끝나면 deadline
  func testSettleDeadline() {
    var s = LinkSettle(budget: 3)
    var n = 0, t = 0.0
    while t < 3 { n += 10; XCTAssertEqual(s.observe(length: n, finished: true, elapsed: t), .wait); t += 0.5 }
    XCTAssertEqual(s.observe(length: n + 10, finished: true, elapsed: 3.0), .deadline)
  }
}
```

- [ ] **Step 2: 실패 확인**

Run: `cd ios && ./scripts/sim.sh gen && ./scripts/sim.sh test EruriCoreTests/LinkTextTests`
Expected: 컴파일 실패(`cannot find 'LinkText' in scope`).

- [ ] **Step 3: 구현**

`ios/Packages/EruriCore/Sources/EruriCore/LinkText.swift`:

```swift
import Foundation

/// 링크 → 일정(스펙 §6 "링크 읽기", 2026-10-02 사용자 결정 방식 A): 기기가 렌더링해 읽은 글을 SHARE 항목으로 보낸다.
/// 이 파일은 WebKit 없이 테스트하는 부분이다 — 링크 판정·주소 검사·날짜 후보·본문 만들기(LinkText), 렌더링 결과(LinkPage), 대기 판정(LinkSettle)
public enum LinkText {
  /// 큐 항목 본문 상한(글자). 서버 추출 입력 상한(`MAX_TEXT_CHARS` 4,000)과 같다 — 모델이 보지 않는 뒷부분은 보내지 않는다
  public static let maxChars = 4000
  /// 본문이 넘칠 때 뒤쪽에서 따로 붙이는 일시·장소 줄 몫(글자)
  public static let tailKeyChars = 1000
  public static let ocrMaxChars = 1500
  public static let titleMaxChars = 120
  public static let descMaxChars = 300
  public static let noteMaxChars = 200
  /// 서버 `items.app_name` 표식. source 는 SHARE 그대로(새 source·마이그레이션 없음, 스펙 §8)
  public static let appName = "웹 링크"
  static let tailHeader = "(뒤쪽 일시·장소 줄)"

  // MARK: 링크 판정

  private static let detector = try! NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue)

  /// 글 안에서 `http://`·`https://` 로 적힌 주소(호스트 있음)의 모든 자리. 스킴 없는 도메인("naver.com")은 링크가 아니다
  static func matches(_ text: String) -> [(url: URL, range: NSRange)] {
    let ns = text as NSString
    return detector.matches(in: text, range: NSRange(location: 0, length: ns.length)).compactMap { (m: NSTextCheckingResult) -> (url: URL, range: NSRange)? in
      guard let u = m.url, let s = u.scheme?.lowercased(), s == "http" || s == "https", u.host() != nil,
            ns.substring(with: m.range).lowercased().hasPrefix("http") else { return nil }
      return (u, m.range)
    }
  }

  /// 나온 순서대로, 같은 주소는 한 번
  public static func webURLs(in text: String) -> [URL] {
    var seen = Set<String>()
    return matches(text).map { $0.url }.filter { seen.insert($0.absoluteString).inserted }
  }

  /// 주소 자리를 모두 지운 나머지 글(메모). 한 줄로, 200자. 비면 nil
  static func note(_ text: String, removing ranges: [NSRange]) -> String? {
    let ns = NSMutableString(string: text)
    for r in ranges.sorted(by: { $0.location > $1.location }) { ns.replaceCharacters(in: r, with: " ") }
    let n = clip(oneLine(ns as String), noteMaxChars)
    return n.isEmpty ? nil : n
  }

  public enum ChatIntent: Equatable, Sendable { case none, link(URL, note: String?), tooMany(Int) }

  /// 채팅 입력(스펙 §9): 주소가 정확히 하나면 링크 수집(나머지 글은 메모), 둘 이상이면 tooMany, 없으면 질문(none)
  public static func chatIntent(_ input: String) -> ChatIntent {
    let urls = webURLs(in: input)
    switch urls.count {
    case 0: return .none
    case 1: return .link(urls[0], note: note(input, removing: matches(input).map { $0.range }))
    default: return .tooMany(urls.count)
    }
  }

  /// 공유 본문(`ShareText.compose` 결과)의 링크(스펙 §6): 주소가 정확히 하나일 때만(둘 이상은 지금처럼 텍스트 공유)
  public static func shareLink(_ composed: String) -> (url: URL, note: String?)? {
    let urls = webURLs(in: composed)
    guard urls.count == 1 else { return nil }
    return (urls[0], note(composed, removing: matches(composed).map { $0.range }))
  }

  // MARK: 주소 검사

  public enum Blocked: String, Sendable { case scheme, host }

  /// 기기가 열 주소인가(스펙 §6 "주소 검사"): http(s)만, 사설·루프백·링크로컬·CGNAT IP 리터럴과 로컬 이름을 거부한다.
  /// 서버 SSRF 방어가 아니라 기기 위생(로컬 네트워크 권한 창·내부 기기 접근 회피). allowLoopback = DEBUG 빌드의 시뮬레이터 게이트
  public static func check(_ url: URL, allowLoopback: Bool) -> Blocked? {
    guard let s = url.scheme?.lowercased(), s == "http" || s == "https" else { return .scheme }
    guard var h = url.host(percentEncoded: false)?.lowercased(), !h.isEmpty else { return .host }
    if h.hasPrefix("["), h.hasSuffix("]") { h = String(h.dropFirst().dropLast()) }
    if h == "localhost" || h == "127.0.0.1" || h == "::1" { return allowLoopback ? nil : .host }
    if let v4 = ipv4(h) { return publicV4(v4) ? nil : .host }
    if h.contains(":") { return publicV6(h) ? nil : .host }
    let bare = h.hasSuffix(".") ? String(h.dropLast()) : h
    if !bare.contains(".") { return .host }                                       // 점 없는 이름(사내 호스트)
    for suffix in [".local", ".localhost", ".internal", ".home.arpa"] where bare.hasSuffix(suffix) { return .host }
    return nil
  }

  static func ipv4(_ h: String) -> [Int]? {
    let p = h.split(separator: ".", omittingEmptySubsequences: false)
    guard p.count == 4, p.allSatisfy({ part in !part.isEmpty && part.count <= 3 && part.allSatisfy { $0.isASCII && $0.isNumber } }) else { return nil }
    let n = p.compactMap { Int($0) }
    return n.allSatisfy { (0...255).contains($0) } ? n : nil
  }

  static func publicV4(_ a: [Int]) -> Bool {
    switch (a[0], a[1]) {
    case (0, _), (10, _), (127, _): return false
    case (100, 64...127): return false            // CGNAT
    case (169, 254): return false                 // 링크로컬
    case (172, 16...31): return false
    case (192, 168): return false
    case (192, 0) where a[2] == 0: return false
    case (198, 18...19): return false
    default: return a[0] < 224                    // 멀티캐스트·예약
    }
  }

  /// IPv6 리터럴: 전역 유니캐스트(2000::/3)이고 문서용(2001:db8::/32)이 아닐 때만
  static func publicV6(_ h: String) -> Bool {
    guard let f = h.first, f == "2" || f == "3" else { return false }
    return !h.hasPrefix("2001:db8")
  }

  // MARK: 날짜 후보·일시 장소 줄

  private static let datePatterns: [NSRegularExpression] = [
    #"\d{1,2}\s*월\s*\d{1,2}\s*일"#,
    #"(?:19|20)\d{2}\s*[.\-/년]\s*\d{1,2}\s*[.\-/월]\s*\d{1,2}"#,
    #"(?<![\d.])\d{1,2}\s*[./]\s*\d{1,2}\s*\.?\s*\(\s*[월화수목금토일]"#,
    #"(?<![\d/.,])\d{1,2}/\d{1,2}(?![\d/])"#,
    #"(?i)\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?!\d)"#,
  ].map { try! NSRegularExpression(pattern: $0) }
  private static let timePattern = try! NSRegularExpression(pattern: #"(?:오전|오후|낮|저녁|밤)\s*\d{1,2}\s*시|(?<!\d)\d{1,2}:\d{2}(?!\d)|(?i)\b(?:am|pm)\s*\d{1,2}"#)
  private static let placeWords = try! NSRegularExpression(pattern: #"일시|장소|예식|식장|웨딩|홀|층|오시는\s*길|주소|위치|시작|입장|개최|행사|시간"#)

  private static func found(_ r: NSRegularExpression, _ s: String) -> Bool {
    r.firstMatch(in: s, range: NSRange(location: 0, length: (s as NSString).length)) != nil
  }

  /// 날짜 후보(스펙 §6 "이미지 전용"): "11월 14일"·"2026.11.14"·"2026-11-14"·"11/14"·"11. 14.(토)"·영문 월 + 일. 시각만은 아니다
  public static func hasDateCandidate(_ s: String) -> Bool { datePatterns.contains { found($0, s) } }

  /// 본문 뒤쪽에서 끌어올릴 줄: 날짜·시각·장소 단어
  static func isKeyLine(_ l: String) -> Bool { hasDateCandidate(l) || found(timePattern, l) || found(placeWords, l) }

  // MARK: 보내는 글

  public struct Composed: Equatable, Sendable {
    /// 큐 항목 제목(서버 items.title). 없으면 nil
    public let title: String?
    public let text: String
    /// 본문 몫에 담은 글자 수(진단)
    public let bodyChars: Int
    public let truncated: Bool
  }

  /// 렌더링 결과 → 큐 항목 본문(스펙 §6 "보내는 글"). 주소는 호스트만, 전체 4,000자
  public static func compose(_ p: LinkPage, note: String?) -> Composed {
    let title = clip(oneLine(p.title), titleMaxChars)
    var head = ["[웹 링크] \(p.host)"]
    if !title.isEmpty { head.append("제목: \(title)") }
    let desc = clip(oneLine(p.description), descMaxChars)
    if !desc.isEmpty, !title.contains(desc) { head.append("설명: \(desc)") }
    if let n = note.map({ clip(oneLine($0), noteMaxChars) }), !n.isEmpty { head.append("메모: \(n)") }
    let headText = head.joined(separator: "\n")
    let ocr = clip(lines(p.ocrText ?? "").joined(separator: "\n"), ocrMaxChars)
    let ocrBlock = ocr.isEmpty ? "" : "\n이미지 속 글자:\n" + ocr
    let bodyHeader = "\n본문:\n"
    let fitted = fit(lines(p.body), budget: maxChars - headText.count - ocrBlock.count - bodyHeader.count)
    let text = headText + (fitted.text.isEmpty ? "" : bodyHeader + fitted.text) + ocrBlock
    return Composed(title: title.isEmpty ? nil : title, text: clip(text, maxChars), bodyChars: fitted.text.count, truncated: fitted.truncated)
  }

  /// 줄을 순서대로 budget 안에 담는다. 넘치면 앞쪽은 (budget − 뒤쪽 몫)까지, 남은 줄 중 일시·장소 줄을 tailKeyChars 안에서 따로 붙인다
  static func fit(_ ls: [String], budget: Int) -> (text: String, truncated: Bool) {
    guard budget > 0 else { return ("", !ls.isEmpty) }
    let all = ls.joined(separator: "\n")
    if all.count <= budget { return (all, false) }
    let headBudget = max(0, budget - tailKeyChars - tailHeader.count - 2)
    var head: [String] = [], used = 0, i = 0
    while i < ls.count {
      let add = ls[i].count + (head.isEmpty ? 0 : 1)
      if used + add > headBudget { break }
      head.append(ls[i]); used += add; i += 1
    }
    if head.isEmpty, i < ls.count, headBudget > 0 { head = [String(ls[i].prefix(headBudget))]; i += 1 }   // 한 줄이 예산보다 길다
    var tail: [String] = [], tailUsed = 0
    for l in ls[i...] where isKeyLine(l) {
      let add = l.count + (tail.isEmpty ? 0 : 1)
      if tailUsed + add > tailKeyChars { continue }                               // 긴 줄은 건너뛰고 다음 줄을 본다
      tail.append(l); tailUsed += add
    }
    let text = head.joined(separator: "\n") + (tail.isEmpty ? "" : "\n" + tailHeader + "\n" + tail.joined(separator: "\n"))
    return (text, true)
  }

  /// 한 줄로: 줄바꿈·연속 공백을 공백 하나로, 앞뒤 공백 제거
  static func oneLine(_ s: String) -> String { s.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ") }
  static func clip(_ s: String, _ n: Int) -> String { s.count <= n ? s : String(s.prefix(n)) }

  /// 줄 단위로 나눠 공백 정리, 빈 줄·이미 나온 줄 제거(메뉴·버튼 글이 여러 번 나온다)
  static func lines(_ s: String) -> [String] {
    var seen = Set<String>(), out: [String] = []
    for raw in s.split(whereSeparator: \.isNewline) {
      let l = oneLine(String(raw))
      if !l.isEmpty, seen.insert(l).inserted { out.append(l) }
    }
    return out
  }
}

/// 렌더링 결과(기기 메모리에서만 — 저장·전송하지 않는다). `LinkRenderer` 가 채우고 `LinkText.compose` 가 큐 항목 본문으로 만든다
public struct LinkPage: Equatable, Sendable {
  public var host: String
  /// og:title, 없으면 document.title
  public var title: String
  /// og:description, 없으면 description
  public var description: String
  /// 보이는 글(innerText)
  public var visibleText: String
  /// 숨은 요소를 포함한 글(스크립트·스타일 제외 텍스트 노드) — "터치해서 열기" 덮개 뒤 본문
  public var allText: String
  /// 화면 스냅샷 OCR(앱에서만, 날짜 후보가 없을 때)
  public var ocrText: String?
  /// 예산이 끝나 그때까지 읽은 글
  public var timedOut: Bool

  public init(host: String, title: String = "", description: String = "", visibleText: String = "", allText: String = "",
              ocrText: String? = nil, timedOut: Bool = false) {
    self.host = host; self.title = title; self.description = description; self.visibleText = visibleText
    self.allText = allText; self.ocrText = ocrText; self.timedOut = timedOut
  }

  /// 본문(스펙 §6 "읽는 것"): 보이는 글. 보이는 글에 날짜 후보가 없고 숨은 글에 있으면 숨은 글, 보이는 글이 비면 숨은 글
  public var body: String {
    if !LinkText.hasDateCandidate(visibleText), LinkText.hasDateCandidate(allText) { return allText }
    return visibleText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? allText : visibleText
  }

  /// 날짜 후보 판단 대상: 제목·설명·본문·OCR
  public var searchable: String { [title, description, body, ocrText ?? ""].joined(separator: "\n") }
  public var isEmpty: Bool { searchable.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

  /// 추출 JS 결과(JSON 문자열, `LinkScript.extract`) → LinkPage. 형식이 다르면 nil
  public static func decode(json: String, host: String) -> LinkPage? {
    guard let d = json.data(using: .utf8), let o = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] else { return nil }
    func s(_ k: String) -> String { o[k] as? String ?? "" }
    let og = s("ogTitle")
    return LinkPage(host: host, title: og.isEmpty ? s("title") : og, description: s("ogDescription"), visibleText: s("text"), allText: s("all"))
  }
}

/// 렌더링 대기 판정(스펙 §6 "대기"): WebKit 에는 network idle 판정이 없어 글 길이가 멈췄는지로 본다
public struct LinkSettle: Sendable {
  public static let pollInterval: Duration = .milliseconds(500)
  public static let stableSamples = 3
  /// didFinish 가 오지 않아도(긴 폴링·끝없는 하위 리소스) 이 시간 뒤에는 길이만 보고 끝낸다
  public static let finishGrace: TimeInterval = 4
  public enum Decision: Equatable, Sendable { case wait, done, deadline }
  public let budget: TimeInterval
  private var last = -1, same = 0
  public init(budget: TimeInterval) { self.budget = budget }

  public mutating func observe(length: Int, finished: Bool, elapsed: TimeInterval) -> Decision {
    if elapsed >= budget { return .deadline }
    if length == last { same += 1 } else { last = length; same = 1 }
    return (finished || elapsed >= Self.finishGrace) && length > 0 && same >= Self.stableSamples ? .done : .wait
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd ios && ./scripts/sim.sh test EruriCoreTests/LinkTextTests`
Expected: `LinkTextTests` 13개 통과. `testDateCandidates`의 음성 사례가 실패하면 정규식을 고치고(사례를 빼지 않는다), `testCheck`의 IPv6 사례에서 `URL.host(percentEncoded:)`가 괄호를 남기는지에 따라 `check`의 괄호 제거가 동작하는지 본다.

- [ ] **Step 5: 회귀**

Run: `cd ios && ./scripts/sim.sh test EruriCoreTests`
Expected: 전체 통과(기존 실패·건너뜀 수는 그대로 — FM 2 skipped).

- [ ] **Step 6: 커밋**

```bash
git add ios/Packages/EruriCore/Sources/EruriCore/LinkText.swift ios/Packages/EruriCore/Tests/EruriCoreTests/LinkTextTests.swift
git commit -m "feat(core): LinkText — link reading pure logic (spec §6): exactly one http(s) URL in chat input or share text is a link (rest is a 200-char note, two or more stay as before), device URL check (http(s) only, private/loopback/link-local/CGNAT IP literals and .local/.internal/dotless names refused, loopback only for DEBUG gates), date candidates for the OCR decision, compose one SHARE body (host only, title/description/note header, body lines deduped, tail date/place lines when over budget, OCR block, ≤4,000 chars), LinkPage (hidden cover text when only it has a date) and LinkSettle (3 equal lengths after didFinish or 4 s, deadline)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task L2: 링크 대기 행 + `handleLink` + `LinkFlow` + `LinkCaptureText`

**Files:**
- Modify: `ios/Packages/EruriCore/Sources/EruriCore/CaptureQueue.swift`(진단 trace 절 뒤에 링크 대기 행 절)
- Modify: `ios/Packages/EruriCore/Sources/EruriCore/CapturePipeline.swift`(`handleShareFile` 뒤에 `handleLink`)
- Create: `ios/Packages/EruriCore/Sources/EruriCore/LinkFlow.swift`
- Create: `ios/Packages/EruriCore/Sources/EruriCore/LinkCaptureText.swift`
- Test: `ios/Packages/EruriCore/Tests/EruriCoreTests/LinkFlowTests.swift`, `ios/Packages/EruriCore/Tests/EruriCoreTests/LinkCaptureTextTests.swift`

**Interfaces:**
- Consumes: L1 `LinkText.compose`·`hasDateCandidate`·`appName`, `LinkPage`.
- Produces:
  - `struct PendingLink: Codable, Equatable, Sendable { id ("link:<uuid>"), captureID (uuid), url: String, note: String?, origin: String, capturedAt: Date; init(url: URL, note: String?, origin: String, capturedAt: Date = Date()) }`
  - `CaptureQueue.enqueueLink(_ l: PendingLink, lease: TimeInterval, now: Date = Date()) throws` · `releaseLink(id: String, now: Date = Date()) throws` · `claimLinks(limit: Int, now: Date = Date()) throws -> [PendingLink]` · `linkCount() throws -> Int` (삭제는 기존 `markSent(id:)`)
  - `CapturePipeline.handleLink(id: String, title: String?, text: String, capturedAt: Date) throws -> String` ("queued" | "discarded:<reason>")
  - `enum LinkRenderOutcome: Equatable, Sendable { case page(LinkPage, elapsedMs: Int), failed(String) }`
  - `@MainActor protocol LinkRendering: AnyObject { func render(_ url: URL, budget: TimeInterval, ocr: Bool) async -> LinkRenderOutcome }`
  - `enum LinkFlow { shareLease = 60, shareBudget = 10, appBudget = 15, renderInShareExtension = true, handOffCodes; enum Outcome { queued(captureID:chars:ocr:timedOut:), discarded(String), handedOff(String), failed(String) }; @MainActor static share(_:renderer:queue:render:) async -> Outcome; @MainActor static app(_:renderer:queue:) async -> Outcome; static finish(_:page:queue:) -> Outcome; static code(_:) -> String; static traceFields(_:origin:elapsedMs:blockedNav:) -> [String: Any] }`
  - `enum LinkCaptureText { reading, tooMany, discarded, pending, drainFailedTitle; reason(_:); share(_:); chat(_:); chatResult(status:gateLabel:kinds:); drainFailedBody(_:) }`

- [ ] **Step 1: 실패하는 테스트**

`ios/Packages/EruriCore/Tests/EruriCoreTests/LinkFlowTests.swift`:

```swift
import XCTest
@testable import EruriCore

/// 링크 대기 행·흐름(스펙 §6 "확장과 앱의 이어받기"). 렌더러는 가짜 — WebKit 은 LinkRendererTests
final class LinkFlowTests: XCTestCase {
  @MainActor final class FakeRenderer: LinkRendering {
    let outcome: LinkRenderOutcome
    private(set) var calls: [(budget: TimeInterval, ocr: Bool)] = []
    init(_ o: LinkRenderOutcome) { outcome = o }
    func render(_ url: URL, budget: TimeInterval, ocr: Bool) async -> LinkRenderOutcome { calls.append((budget, ocr)); return outcome }
  }

  let url = URL(string: "https://invite.example.com/m/abc?code=482913")!
  let page = LinkPage(host: "invite.example.com", title: "합성신랑 ♥ 합성신부 결혼합니다",
                      visibleText: "일시\n2026년 11월 14일 토요일 오후 1시 30분\n장소\n합성웨딩홀 3층")

  private func makeQueue() throws -> CaptureQueue {
    try CaptureQueue(url: FileManager.default.temporaryDirectory.appendingPathComponent("link-\(UUID().uuidString).sqlite"))
  }

  func testPendingLinkIDs() {
    let l = PendingLink(url: url, note: nil, origin: "share")
    XCTAssertEqual(l.id, "link:" + l.captureID)
    XCTAssertNotNil(UUID(uuidString: l.captureID))
    XCTAssertEqual(l.url, url.absoluteString)
  }

  @MainActor func testShareQueuesCaptureAndDropsPendingRow() async throws {
    let q = try makeQueue(), r = FakeRenderer(.page(page, elapsedMs: 900))
    let link = PendingLink(url: url, note: "청첩장", origin: "share")
    let o = await LinkFlow.share(link, renderer: r, queue: q)
    guard case .queued(let id, let chars, false, false) = o else { return XCTFail("\(o)") }
    XCTAssertEqual(id, link.captureID)
    XCTAssertGreaterThan(chars, 0)
    XCTAssertEqual(r.calls.first?.budget, LinkFlow.shareBudget)
    XCTAssertEqual(r.calls.first?.ocr, false)                                    // 확장은 OCR 하지 않는다
    XCTAssertEqual(try q.linkCount(), 0)
    let items = try q.claim(limit: 10)
    XCTAssertEqual(items.count, 1)
    XCTAssertEqual(items[0].id, link.captureID)
    XCTAssertEqual(items[0].source, "SHARE")
    XCTAssertEqual(items[0].appName, "웹 링크")
    XCTAssertEqual(items[0].title, "합성신랑 ♥ 합성신부 결혼합니다")
    XCTAssertTrue(items[0].text.hasPrefix("[웹 링크] invite.example.com\n"))
    XCTAssertTrue(items[0].text.contains("메모: 청첩장"))
    XCTAssertEqual(items[0].capturedAt.timeIntervalSince1970, link.capturedAt.timeIntervalSince1970, accuracy: 0.001)
  }

  /// 주소 쿼리의 code=482913 이 본문에 들어가면 OTP 규칙이 항목 전체를 폐기한다(F9) — 호스트만 들어가므로 통과한다
  @MainActor func testQueryDigitsDoNotDiscard() async throws {
    let q = try makeQueue()
    let o = await LinkFlow.share(PendingLink(url: url, note: nil, origin: "share"), renderer: FakeRenderer(.page(page, elapsedMs: 1)), queue: q)
    guard case .queued = o else { return XCTFail("\(o)") }
    XCTAssertFalse(try q.claim(limit: 1)[0].text.contains("482913"))
    // 대조: 전체 주소를 본문에 넣으면 폐기된다(호스트만 쓰는 이유). 이 단언이 깨지면 규칙이 F9 와 다르다 — 메인에게 알린다
    let full = try CapturePipeline(filter: RuleFilter(), queue: q).handleLink(id: UUID().uuidString, title: nil,
                                                                             text: "링크: \(url.absoluteString)", capturedAt: Date())
    XCTAssertEqual(full, "discarded:otp")
  }

  /// 이미지 전용(날짜 후보 없음): 확장은 캡처를 넣지 않고 앱에 넘긴다 — 앱이 바로 가져간다
  @MainActor func testShareWithoutDateHandsOff() async throws {
    let q = try makeQueue(), link = PendingLink(url: url, note: nil, origin: "share")
    let bare = LinkPage(host: "card.example.com", title: "모바일 청첩장", visibleText: "터치하면 음악이 재생됩니다")
    let o = await LinkFlow.share(link, renderer: FakeRenderer(.page(bare, elapsedMs: 1)), queue: q)
    XCTAssertEqual(o, .handedOff("no_date"))
    XCTAssertEqual(try q.claim(limit: 10).count, 0)
    XCTAssertEqual(try q.claimLinks(limit: 10).map(\.id), [link.id])
  }

  @MainActor func testShareTimeoutHandsOffAndHTTPErrorFails() async throws {
    let q = try makeQueue()
    let a = PendingLink(url: url, note: nil, origin: "share"), b = PendingLink(url: url, note: nil, origin: "share")
    let oa = await LinkFlow.share(a, renderer: FakeRenderer(.failed("timeout")), queue: q)
    let ob = await LinkFlow.share(b, renderer: FakeRenderer(.failed("http_404")), queue: q)
    XCTAssertEqual(oa, .handedOff("timeout"))
    XCTAssertEqual(ob, .failed("http_404"))
    XCTAssertEqual(try q.claimLinks(limit: 10).map(\.id), [a.id])                // 404 는 다시 해도 같다 — 행 삭제
  }

  @MainActor func testShareRenderingDisabledHandsOff() async throws {
    let q = try makeQueue(), r = FakeRenderer(.page(page, elapsedMs: 1))
    let o = await LinkFlow.share(PendingLink(url: url, note: nil, origin: "share"), renderer: r, queue: q, render: false)
    XCTAssertEqual(o, .handedOff("disabled"))
    XCTAssertTrue(r.calls.isEmpty)
    XCTAssertEqual(try q.claimLinks(limit: 10).count, 1)
  }

  /// 확장이 행을 남기고 죽었다: lease(60초) 동안은 앱이 가져가지 않고, 그 뒤 한 번 가져간다. 캡처 업로드와 섞이지 않는다
  func testExtensionDeathHandsOffAfterLease() throws {
    let q = try makeQueue(), t0 = Date()
    let link = PendingLink(url: url, note: nil, origin: "share", capturedAt: t0)
    try q.enqueueLink(link, lease: LinkFlow.shareLease, now: t0)
    XCTAssertEqual(try q.claimLinks(limit: 10, now: t0.addingTimeInterval(30)).count, 0)
    XCTAssertEqual(try q.claim(limit: 10, now: t0.addingTimeInterval(61)).count, 0)
    XCTAssertEqual(try q.pending(limit: 10, now: t0.addingTimeInterval(61)).count, 0)
    XCTAssertEqual(try q.claimLinks(limit: 10, now: t0.addingTimeInterval(61)).map(\.id), [link.id])
    XCTAssertEqual(try q.claimLinks(limit: 10, now: t0.addingTimeInterval(62)).count, 0)   // 앱이 잡은 동안(600초) 다시 안 나온다
    XCTAssertEqual(try q.captureCount(), 0)
    XCTAssertEqual(try q.linkCount(), 1)
  }

  func testUnreadableLinkRowIsDropped() throws {
    let q = try makeQueue()
    try q.enqueueLink(PendingLink(url: url, note: nil, origin: "share"), lease: 0)
    try q.insertRawLinkForTesting(id: "link:poison", payload: Data("{".utf8))
    XCTAssertEqual(try q.claimLinks(limit: 10).count, 1)
    XCTAssertEqual(try q.linkCount(), 1)                                          // poison 행은 지워졌다
  }

  @MainActor func testAppUsesOCRBudgetAndQueues() async throws {
    let q = try makeQueue()
    let p = LinkPage(host: "card.example.com", title: "모바일 청첩장", visibleText: "터치하면 음악이 재생됩니다",
                     ocrText: "2026. 12. 5. SAT PM 12:00\n합성 컨벤션 웨딩홀 5층")
    let r = FakeRenderer(.page(p, elapsedMs: 4000))
    try q.enqueueLink(PendingLink(url: url, note: nil, origin: "share"), lease: 0)
    let claimed = try q.claimLinks(limit: 1)
    let o = await LinkFlow.app(claimed[0], renderer: r, queue: q)
    guard case .queued(_, _, true, false) = o else { return XCTFail("\(o)") }
    XCTAssertEqual(r.calls.first?.budget, LinkFlow.appBudget)
    XCTAssertEqual(r.calls.first?.ocr, true)
    XCTAssertEqual(try q.linkCount(), 0)
    XCTAssertTrue(try q.claim(limit: 1)[0].text.contains("이미지 속 글자:\n2026. 12. 5. SAT PM 12:00"))
  }

  @MainActor func testAppFailureDropsRow() async throws {
    let q = try makeQueue()
    try q.enqueueLink(PendingLink(url: url, note: nil, origin: "share"), lease: 0)
    let claimed = try q.claimLinks(limit: 1)
    let o = await LinkFlow.app(claimed[0], renderer: FakeRenderer(.failed("timeout")), queue: q)
    XCTAssertEqual(o, .failed("timeout"))
    XCTAssertEqual(try q.linkCount(), 0)                                          // 이어받기는 한 번 — 실패하면 알림
  }

  @MainActor func testOTPPageIsDiscardedWithoutCapture() async throws {
    let q = try makeQueue()
    let otp = LinkPage(host: "x.example.com", title: "합성 예약", visibleText: "2026년 11월 14일 방문\n인증번호 482913 을 입력하세요")
    let o = await LinkFlow.share(PendingLink(url: url, note: nil, origin: "share"), renderer: FakeRenderer(.page(otp, elapsedMs: 1)), queue: q)
    XCTAssertEqual(o, .discarded("otp"))
    XCTAssertEqual(try q.claim(limit: 10).count, 0)
    XCTAssertEqual(try q.linkCount(), 0)
  }

  /// 확장이 큐 항목을 넣고 행을 지우기 전에 죽음 → 앱이 같은 행으로 다시 읽음: 캡처 id 가 같아 큐에 한 건(서버도 SHARE:<id> 로 한 건)
  func testFinishTwiceKeepsOneCapture() throws {
    let q = try makeQueue(), link = PendingLink(url: url, note: nil, origin: "share")
    try q.enqueueLink(link, lease: 0)
    _ = LinkFlow.finish(link, page: page, queue: q)
    try q.enqueueLink(link, lease: 0)
    _ = LinkFlow.finish(link, page: page, queue: q)
    XCTAssertEqual(try q.claim(limit: 10).map(\.id), [link.captureID])
  }

  func testTraceFieldsHaveNoURLOrText() {
    let f = LinkFlow.traceFields(.queued(captureID: "c", chars: 812, ocr: true, timedOut: false), origin: "share", elapsedMs: 3400, blockedNav: 1)
    XCTAssertEqual(Set(f.keys), ["origin", "elapsed_ms", "result", "chars", "ocr", "timed_out", "blocked_nav"])
    XCTAssertEqual(f["result"] as? String, "queued")
    XCTAssertTrue(Set(f.keys).isDisjoint(with: Trace.forbiddenKeys))
    let g = LinkFlow.traceFields(.failed("http_404"), origin: "drain", elapsedMs: 1)
    XCTAssertEqual(g["result"] as? String, "failed")
    XCTAssertEqual(g["code"] as? String, "http_404")
    XCTAssertEqual(LinkFlow.code(.handedOff("no_date")), "handed_off:no_date")
  }
}
```

`ios/Packages/EruriCore/Tests/EruriCoreTests/LinkCaptureTextTests.swift`:

```swift
import XCTest
@testable import EruriCore

/// 링크 읽기 문구(스펙 §6·§9). 주소·제목을 받는 인자가 없다
final class LinkCaptureTextTests: XCTestCase {
  func testShareTexts() {
    XCTAssertEqual(LinkCaptureText.share(.queued(captureID: "c", chars: 812, ocr: false, timedOut: false)),
                   "페이지에서 글 812자를 읽었어요. 일정을 찾으면 알림으로 알려 드릴게요.")
    XCTAssertEqual(LinkCaptureText.share(.handedOff("no_date")), "그림으로 된 페이지 같아요. ERURI 앱을 열면 그림 속 글자까지 다시 읽어요.")
    XCTAssertEqual(LinkCaptureText.share(.handedOff("timeout")), "지금은 다 읽지 못했어요. ERURI 앱을 열면 다시 읽어요.")
    XCTAssertEqual(LinkCaptureText.share(.discarded("otp")), "인증번호 같은 숫자가 있어 저장하지 않았어요.")
    XCTAssertEqual(LinkCaptureText.share(.failed("http_404")), "페이지를 읽지 못했어요(페이지 오류 404).")
    XCTAssertEqual(LinkCaptureText.share(.failed("blocked_host")), "페이지를 읽지 못했어요(내부 네트워크 주소는 열지 않아요).")
  }

  func testChatTexts() {
    XCTAssertEqual(LinkCaptureText.chat(.queued(captureID: "c", chars: 640, ocr: true, timedOut: false)), "페이지에서 글 640자를 읽었어요. 일정을 찾는 중…")
    XCTAssertEqual(LinkCaptureText.chat(.failed("timeout")), "페이지를 읽지 못했어요(시간이 너무 걸려요).")
    XCTAssertEqual(LinkCaptureText.chat(.discarded("otp")), "인증번호 같은 숫자가 있어 저장하지 않았어요.")
  }

  /// 서버 처리 결과(스펙 §9): 본인 items.status·gate_label·facts 종류만 본다
  func testChatResult() {
    XCTAssertNil(LinkCaptureText.chatResult(status: nil, gateLabel: nil, kinds: []))
    XCTAssertNil(LinkCaptureText.chatResult(status: "queued", gateLabel: nil, kinds: []))
    XCTAssertEqual(LinkCaptureText.chatResult(status: "extracted", gateLabel: "actionable", kinds: ["event", "event"]),
                   "일정 2건을 찾았어요 — '제안' 탭과 알림에서 추가할 수 있어요.")
    XCTAssertEqual(LinkCaptureText.chatResult(status: "extracted", gateLabel: "actionable", kinds: ["task"]), "할 일을 찾았어요 — 알림에서 확인하세요.")
    XCTAssertEqual(LinkCaptureText.chatResult(status: "extracted", gateLabel: nil, kinds: ["purchase"]), "이 페이지에서 일정을 찾지 못했어요.")
    XCTAssertEqual(LinkCaptureText.chatResult(status: "discarded:server:empty", gateLabel: "notice", kinds: []), "이 페이지에서 일정을 찾지 못했어요.")
    XCTAssertEqual(LinkCaptureText.chatResult(status: "discarded:server:promo", gateLabel: "promo", kinds: []),
                   "분류에서 걸러졌어요 — 보관함 › 최근 폐기에서 복구할 수 있어요.")
    XCTAssertEqual(LinkCaptureText.chatResult(status: "discarded:server:otp", gateLabel: nil, kinds: []), "인증번호 같은 숫자가 있어 저장하지 않았어요.")
  }

  func testReasonsCarryNoAddress() {
    for code in ["blocked_scheme", "blocked_host", "redirects", "unsupported", "timeout", "empty", "web_process", "cancelled", "http_500", "load_failed", "queue"] {
      XCTAssertFalse(LinkCaptureText.reason(code).isEmpty, code)
      XCTAssertFalse(LinkCaptureText.reason(code).contains("http"), code)
    }
    XCTAssertEqual(LinkCaptureText.drainFailedBody("timeout"), "시간이 너무 걸려요. 날짜·장소 글을 복사해 ERURI로 공유해 주세요.")
  }
}
```

- [ ] **Step 2: 실패 확인**

Run: `cd ios && ./scripts/sim.sh test EruriCoreTests/LinkFlowTests`
Expected: 컴파일 실패(`cannot find 'PendingLink' in scope`).

- [ ] **Step 3: 큐 링크 대기 행**

`CaptureQueue.swift`의 `public func purgeTraces()` 줄 바로 앞에 넣는다(같은 파일이라 `run`·`count`·`msg`·`transient`·`enc`·`dec`를 쓴다):

```swift
  // MARK: - 링크 대기 행 (kind = 'link', payload = PendingLink JSON, 스펙 §6 "확장과 앱의 이어받기")

  /// 확장이 렌더링 전에 남긴다. lease 동안은 앱이 가져가지 않는다(확장이 죽으면 lease 뒤 앱이 이어받는다). 캡처 claim·pending 은 kind = 'capture' 만 본다
  public func enqueueLink(_ l: PendingLink, lease: TimeInterval, now: Date = Date()) throws {
    let data = try enc.encode(l)
    try run("INSERT OR IGNORE INTO queue(id,payload,attempts,created_at,next_attempt_at,kind) VALUES(?,?,0,?,?,'link')") { s in
      sqlite3_bind_text(s, 1, l.id, -1, Self.transient)
      data.withUnsafeBytes { sqlite3_bind_blob(s, 2, $0.baseAddress, Int32(data.count), Self.transient) }
      sqlite3_bind_double(s, 3, now.timeIntervalSince1970)
      sqlite3_bind_double(s, 4, now.timeIntervalSince1970 + lease)
    }
  }
  /// 확장이 앱에 넘긴다: lease 를 지금으로(다음 foreground 가 바로 가져간다)
  public func releaseLink(id: String, now: Date = Date()) throws {
    try run("UPDATE queue SET next_attempt_at = ? WHERE id = ? AND kind = 'link'") { s in
      sqlite3_bind_double(s, 1, now.timeIntervalSince1970); sqlite3_bind_text(s, 2, id, -1, Self.transient)
    }
  }
  /// 앱(foreground): 처리할 링크를 캡처와 같은 lease(600초)로 가져온다. 읽을 수 없는 행은 지운다(큐를 막지 않게)
  public func claimLinks(limit: Int, now: Date = Date()) throws -> [PendingLink] {
    var s: OpaquePointer?
    let sql = """
      UPDATE queue SET next_attempt_at = ?1
      WHERE id IN (SELECT id FROM queue WHERE kind = 'link' AND next_attempt_at <= ?2 ORDER BY created_at, rowid LIMIT ?3)
      RETURNING id, payload
      """
    guard sqlite3_prepare_v2(db, sql, -1, &s, nil) == SQLITE_OK, let st = s else { throw Error.sqlite(msg) }
    sqlite3_bind_double(st, 1, now.timeIntervalSince1970 + Self.lease)
    sqlite3_bind_double(st, 2, now.timeIntervalSince1970); sqlite3_bind_int(st, 3, Int32(limit))
    var out: [PendingLink] = [], poison: [String] = []
    var rc = sqlite3_step(st)
    while rc == SQLITE_ROW {
      let id = String(cString: sqlite3_column_text(st, 0))
      let len = Int(sqlite3_column_bytes(st, 1))
      if let b = sqlite3_column_blob(st, 1), let l = try? dec.decode(PendingLink.self, from: Data(bytes: b, count: len)) { out.append(l) }
      else { poison.append(id) }
      rc = sqlite3_step(st)
    }
    let err = rc == SQLITE_DONE ? nil : msg
    sqlite3_finalize(st)                                                          // 아래 삭제 전에 문장을 끝낸다
    if let err { throw Error.sqlite(err) }
    for id in poison { try markSent(id: id) }
    return out.sorted { $0.capturedAt < $1.capturedAt }                          // RETURNING 순서는 보장되지 않는다
  }
  public func linkCount() throws -> Int { try count("link") }

  /// 테스트 전용: 디코딩 불가 링크 행
  func insertRawLinkForTesting(id: String, payload: Data) throws {
    try run("INSERT INTO queue(id,payload,attempts,created_at,kind) VALUES(?,?,0,0,'link')") { s in
      sqlite3_bind_text(s, 1, id, -1, Self.transient)
      payload.withUnsafeBytes { sqlite3_bind_blob(s, 2, $0.baseAddress, Int32(payload.count), Self.transient) }
    }
  }
```

- [ ] **Step 4: `handleLink`**

`CapturePipeline.swift`의 `handleShareFile` 함수 바로 뒤에 넣는다:

```swift
  /// 링크 → 일정(스펙 §6 "링크 읽기"): 페이지 제목·본문을 규칙에 통과시켜 SHARE 항목(`app_name = "웹 링크"`)으로 넣는다.
  /// id = 대기 행의 captureID — 확장이 죽은 뒤 앱이 다시 읽어도 큐(INSERT OR IGNORE)·서버 멱등 키(SHARE:<id>)가 한 건.
  /// 연락처 규칙은 쓰지 않는다(호출 쪽이 RuleFilter() — 사용자가 고른 링크). 반환: "queued" 또는 "discarded:<reason>"
  public func handleLink(id: String, title: String?, text: String, capturedAt: Date) throws -> String {
    switch filter.apply(title: title, text: text, sender: nil) {
    case .discard(let r): return "discarded:\(r)"
    case .pass(let maskedTitle, let masked):
      try queue.enqueue(CaptureItem(id: id, source: "SHARE", appName: LinkText.appName, sender: nil, title: maskedTitle,
                                    text: masked, localFile: nil, ocrText: nil, capturedAt: capturedAt, attempts: 0))
      return "queued"
    }
  }
```

- [ ] **Step 5: `LinkFlow`**

`ios/Packages/EruriCore/Sources/EruriCore/LinkFlow.swift`:

```swift
import Foundation

/// 링크 대기 행(스펙 §6 "확장과 앱의 이어받기"). App Group 큐(`kind = 'link'`)에 JSON 으로 둔다
public struct PendingLink: Codable, Equatable, Sendable {
  /// 큐 행 id `link:<uuid>` — 캡처 행과 같은 표(id PK)를 쓰므로 접두로 나눈다
  public var id: String
  /// 큐 항목 id = 서버 멱등 키(`SHARE:<captureID>`). 같은 링크를 다시 읽어도 같다
  public var captureID: String
  public var url: String
  public var note: String?
  /// share | chat
  public var origin: String
  /// 공유·붙여넣은 시각 = 서버 occurred_at(상대 날짜 기준일)
  public var capturedAt: Date

  public init(url: URL, note: String?, origin: String, capturedAt: Date = Date()) {
    let u = UUID().uuidString
    id = "link:" + u; captureID = u; self.url = url.absoluteString; self.note = note; self.origin = origin; self.capturedAt = capturedAt
  }
}

/// 렌더링 결과. 실패 코드는 진단·화면 문구에만 쓴다(주소·본문 없음):
/// blocked_scheme · blocked_host · http_<n> · unsupported · redirects · load_failed · web_process · timeout · empty · extract_failed · no_host · cancelled
public enum LinkRenderOutcome: Equatable, Sendable {
  case page(LinkPage, elapsedMs: Int)
  case failed(String)
}

/// 렌더러(실제는 `LinkRenderer`, 테스트는 가짜). WebKit 이라 메인 액터
@MainActor public protocol LinkRendering: AnyObject {
  func render(_ url: URL, budget: TimeInterval, ocr: Bool) async -> LinkRenderOutcome
}

/// 링크 → 큐 항목 흐름(스펙 §6 "링크 읽기"). 공유 확장·앱이 같이 쓴다
public enum LinkFlow {
  public static let shareLease: TimeInterval = 60
  public static let shareBudget: TimeInterval = 10
  public static let appBudget: TimeInterval = 15
  /// 공유 확장에서 렌더링할지. 실기기 게이트(LNK-device D1)가 실패하면 false — 확장은 대기 행만 남기고 앱이 읽는다(스펙 §6 "실기기 미확인")
  public static let renderInShareExtension = true
  /// 앱에 넘길 실패(앱은 시간이 더 길고 OCR 을 한다). 나머지(blocked_*·http_<n>·unsupported·redirects·empty)는 다시 해도 같다 — 행을 지운다
  public static let handOffCodes: Set<String> = ["timeout", "load_failed", "web_process", "extract_failed", "no_host", "cancelled"]

  public enum Outcome: Equatable, Sendable {
    case queued(captureID: String, chars: Int, ocr: Bool, timedOut: Bool)
    /// 기기 규칙(otp 등) — 큐에 아무것도 남기지 않는다
    case discarded(String)
    /// 앱이 이어받는다(no_date · disabled · handOffCodes)
    case handedOff(String)
    /// 끝(사유 코드). 대기 행도 지웠다(queue = 큐 쓰기 실패 — 행이 남아 다음에 다시)
    case failed(String)
  }

  /// 공유 확장: 대기 행을 먼저 남기고(확장이 죽어도 앱이 이어받게) OCR 없이 읽는다. 날짜 후보가 없으면 앱(OCR)에 넘긴다
  @MainActor public static func share(_ link: PendingLink, renderer: LinkRendering?, queue: CaptureQueue,
                                      render: Bool = renderInShareExtension) async -> Outcome {
    do { try queue.enqueueLink(link, lease: shareLease) } catch { return .failed("queue") }
    guard render, let renderer, let url = URL(string: link.url) else { try? queue.releaseLink(id: link.id); return .handedOff("disabled") }
    switch await renderer.render(url, budget: shareBudget, ocr: false) {
    case .failed(let code) where handOffCodes.contains(code):
      try? queue.releaseLink(id: link.id); return .handedOff(code)
    case .failed(let code):
      try? queue.markSent(id: link.id); return .failed(code)
    case .page(let page, _):
      guard LinkText.hasDateCandidate(page.searchable) else { try? queue.releaseLink(id: link.id); return .handedOff("no_date") }
      return finish(link, page: page, queue: queue)
    }
  }

  /// 앱(foreground): 15초 + 날짜 후보가 없으면 OCR. 실패하면 행을 지운다(이어받기는 한 번 — 호출 쪽이 알린다)
  @MainActor public static func app(_ link: PendingLink, renderer: LinkRendering, queue: CaptureQueue) async -> Outcome {
    guard let url = URL(string: link.url) else { try? queue.markSent(id: link.id); return .failed("bad_url") }
    switch await renderer.render(url, budget: appBudget, ocr: true) {
    case .failed(let code): try? queue.markSent(id: link.id); return .failed(code)
    case .page(let page, _): return finish(link, page: page, queue: queue)
    }
  }

  /// 본문 만들기 → 기기 규칙 → 큐 항목(id = captureID) → 대기 행 삭제. 큐 쓰기가 실패하면 행을 남긴다(다음 foreground 에 다시)
  static func finish(_ link: PendingLink, page: LinkPage, queue: CaptureQueue) -> Outcome {
    let c = LinkText.compose(page, note: link.note)
    let result: String
    do {
      result = try CapturePipeline(filter: RuleFilter(), queue: queue)
        .handleLink(id: link.captureID, title: c.title, text: c.text, capturedAt: link.capturedAt)
    } catch { return .failed("queue") }
    try? queue.markSent(id: link.id)
    guard result == "queued" else { return .discarded(String(result.dropFirst("discarded:".count))) }
    return .queued(captureID: link.captureID, chars: c.text.count, ocr: page.ocrText != nil, timedOut: page.timedOut)
  }

  /// 로그 한 단어(DiagLog): queued · discarded:<r> · handed_off:<r> · failed:<r>
  public static func code(_ o: Outcome) -> String {
    switch o {
    case .queued: return "queued"
    case .discarded(let r): return "discarded:\(r)"
    case .handedOff(let r): return "handed_off:\(r)"
    case .failed(let r): return "failed:\(r)"
    }
  }

  /// trace `share.link` 필드(스펙 §6 "진단"): 결과 코드·수만. 주소·호스트·제목·본문 없음(이벤트 접두는 서버가 받는 share. — F8)
  public static func traceFields(_ o: Outcome, origin: String, elapsedMs: Int, blockedNav: Int = 0) -> [String: Any] {
    var f: [String: Any] = ["origin": origin, "elapsed_ms": elapsedMs, "blocked_nav": blockedNav]
    switch o {
    case .queued(_, let chars, let ocr, let timedOut): f["result"] = "queued"; f["chars"] = chars; f["ocr"] = ocr; f["timed_out"] = timedOut
    case .discarded(let r): f["result"] = "discarded"; f["code"] = r
    case .handedOff(let r): f["result"] = "handed_off"; f["code"] = r
    case .failed(let r): f["result"] = "failed"; f["code"] = r
    }
    return f
  }
}
```

- [ ] **Step 6: `LinkCaptureText`**

`ios/Packages/EruriCore/Sources/EruriCore/LinkCaptureText.swift`:

```swift
import Foundation

/// 링크 읽기 문구(스펙 §6·§9, 계획 D8). 주소·호스트·제목을 넣지 않는다
public enum LinkCaptureText {
  public static let reading = "링크를 읽는 중…"
  public static let tooMany = "링크는 한 번에 하나씩 보내 주세요"
  public static let discarded = "인증번호 같은 숫자가 있어 저장하지 않았어요."
  public static let pending = "아직 처리 중이에요 — 끝나면 알림으로 알려 드려요."
  public static let drainFailedTitle = "공유한 링크를 읽지 못했어요"
  static let noSchedule = "이 페이지에서 일정을 찾지 못했어요."

  /// 실패 코드 → 사유(주소 없음)
  public static func reason(_ code: String) -> String {
    switch code {
    case "blocked_scheme": return "웹 주소가 아니에요"
    case "blocked_host": return "내부 네트워크 주소는 열지 않아요"
    case "redirects": return "페이지가 계속 다른 곳으로 넘어가요"
    case "unsupported": return "웹 페이지가 아니에요"
    case "timeout": return "시간이 너무 걸려요"
    case "empty": return "읽을 글이 없어요"
    case "web_process": return "페이지가 너무 무거워요"
    case "cancelled": return "취소했어요"
    case let c where c.hasPrefix("http_"): return "페이지 오류 \(c.dropFirst(5))"
    default: return "연결할 수 없어요"
    }
  }

  /// 공유 시트 결과(확장)
  public static func share(_ o: LinkFlow.Outcome) -> String {
    switch o {
    case .queued(_, let chars, _, _): return "페이지에서 글 \(chars)자를 읽었어요. 일정을 찾으면 알림으로 알려 드릴게요."
    case .handedOff("no_date"): return "그림으로 된 페이지 같아요. ERURI 앱을 열면 그림 속 글자까지 다시 읽어요."
    case .handedOff: return "지금은 다 읽지 못했어요. ERURI 앱을 열면 다시 읽어요."
    case .discarded: return discarded
    case .failed(let code): return "페이지를 읽지 못했어요(\(reason(code)))."
    }
  }

  /// 채팅 링크 턴의 읽기 결과(스펙 §9). queued 면 서버 처리를 기다린다
  public static func chat(_ o: LinkFlow.Outcome) -> String {
    switch o {
    case .queued(_, let chars, _, _): return "페이지에서 글 \(chars)자를 읽었어요. 일정을 찾는 중…"
    case .discarded: return discarded
    case .handedOff(let code), .failed(let code): return "페이지를 읽지 못했어요(\(reason(code)))."
    }
  }

  /// 채팅 링크 턴의 서버 처리 결과(스펙 §9): 본인 items.status·gate_label·facts 종류. nil = 아직(행 없음·queued)
  public static func chatResult(status: String?, gateLabel: String?, kinds: [String]) -> String? {
    guard let status, status != "queued" else { return nil }
    if status == "extracted" {
      let events = kinds.filter { $0 == "event" }.count
      if events > 0 { return "일정 \(events)건을 찾았어요 — '제안' 탭과 알림에서 추가할 수 있어요." }
      if kinds.contains("task") { return "할 일을 찾았어요 — 알림에서 확인하세요." }
      return noSchedule
    }
    if status == "discarded:server:empty" { return noSchedule }
    if let g = gateLabel, status == "discarded:server:\(g)" { return "분류에서 걸러졌어요 — 보관함 › 최근 폐기에서 복구할 수 있어요." }   // 게이트 7일 격리
    if status.hasPrefix("discarded:") { return discarded }                                                                      // 서버 규칙(게이트 전)
    return nil
  }

  /// 앱 이어받기 실패 로컬 알림 본문(주소·제목 없음)
  public static func drainFailedBody(_ code: String) -> String { "\(reason(code)). 날짜·장소 글을 복사해 ERURI로 공유해 주세요." }
}
```

- [ ] **Step 7: 통과 확인**

Run: `cd ios && ./scripts/sim.sh gen && ./scripts/sim.sh test EruriCoreTests/LinkFlowTests && ./scripts/sim.sh test EruriCoreTests/LinkCaptureTextTests`
Expected: `LinkFlowTests` 13개·`LinkCaptureTextTests` 4개 통과. `testQueryDigitsDoNotDiscard`의 대조 단언(`discarded:otp`)이 깨지면 고치지 말고 멈춰 메인에게 알린다(D3·UQ2의 근거가 달라진다).

- [ ] **Step 8: 회귀**

Run: `cd ios && ./scripts/sim.sh test EruriCoreTests`
Expected: 전체 통과(`CaptureQueueTests`·`CaptureIntentTests` 포함 — 캡처 claim·pending은 kind = 'capture'만 본다).

- [ ] **Step 9: 커밋**

```bash
git add ios/Packages/EruriCore/Sources/EruriCore/CaptureQueue.swift ios/Packages/EruriCore/Sources/EruriCore/CapturePipeline.swift \
  ios/Packages/EruriCore/Sources/EruriCore/LinkFlow.swift ios/Packages/EruriCore/Sources/EruriCore/LinkCaptureText.swift \
  ios/Packages/EruriCore/Tests/EruriCoreTests/LinkFlowTests.swift ios/Packages/EruriCore/Tests/EruriCoreTests/LinkCaptureTextTests.swift
git commit -m "feat(core): link pending rows and LinkFlow (spec §6 hand-off) — queue kind 'link' (PendingLink JSON, link:<uuid> id, capture id fixed per row) with lease, release and claim (poison rows dropped, never mixed with capture claim/pending); CapturePipeline.handleLink puts one SHARE item (app_name 웹 링크, masked title) with the row's capture id; LinkFlow.share leaves the row first, renders 10 s without OCR, queues when a date candidate exists, hands timeouts/load failures/no-date pages to the app and drops deterministic failures; LinkFlow.app renders 15 s with OCR once; trace fields carry codes and counts only; LinkCaptureText share/chat/result/notice copy without addresses

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task L3: `LinkRenderer`(WKWebView) + `OCR.recognize(image:)` + 합성 HTML 테스트

**Files:**
- Create: `ios/Packages/EruriCore/Sources/EruriCore/LinkRenderer.swift`
- Modify: `ios/Packages/EruriCore/Sources/EruriCore/OCR.swift`
- Test: `ios/Packages/EruriCore/Tests/EruriCoreTests/LinkRendererTests.swift`

**Interfaces:**
- Consumes: L1 `LinkText.check`·`hasDateCandidate`, `LinkPage.decode`, `LinkSettle`. L2 `LinkRendering`·`LinkRenderOutcome`.
- Produces:
  - `@MainActor final class LinkRenderer: NSObject, LinkRendering, WKNavigationDelegate` — `static viewport = CGSize(390, 844)`, `static maxNavigations = 6`, `static ocrScreens = 3`, `init(host: UIView, allowLoopback: Bool, html: String? = nil)`(`html`은 테스트 전용), `static makeConfiguration() -> WKWebViewConfiguration`, `render(_:budget:ocr:) async -> LinkRenderOutcome`, `private(set) var blockedNavigations: Int`
  - `OCR.recognize(image: UIImage) async throws -> String`

설계 메모(구현자가 알아야 할 WebKit 사실): 네트워크 idle API 없음(F15) → `LinkSettle`로 길이 안정 판정. 웹뷰는 `host`(창 안에 있는 뷰)의 **맨 아래 서브뷰**로 붙여 다른 화면에 가려지게 한다 — WebKit은 창 안·foreground일 때만 보이는 뷰로 다룬다(F16, 화면 밖·창 밖은 미확인 U2). JS는 `callAsyncJavaScript(_:arguments:in:contentWorld:)`(반환 `Any?` — `evaluateJavaScript` async 판은 결과가 없으면 문제를 일으킨 적이 있어 쓰지 않는다)와 격리 세계 `.defaultClient`(DOM은 공유, 페이지 스크립트는 우리 함수를 못 바꾼다). 위임 메서드는 async 판(`decidePolicyFor … async -> WKNavigationActionPolicy`)만 구현한다(같은 선택자의 완료 핸들러 판과 함께 두면 모호하다).

- [ ] **Step 1: 실패하는 테스트**

`ios/Packages/EruriCore/Tests/EruriCoreTests/LinkRendererTests.swift`:

```swift
import XCTest
import UIKit
@testable import EruriCore

/// WKWebView 렌더러(스펙 §6 "링크 읽기"): 합성 HTML 을 네트워크 없이(loadHTMLString, 기준 주소 = 공유 주소) 창 안 다른 화면 밑에서 읽는다.
/// 창 안·화면 밑 렌더링(U2)과 시뮬레이터 Vision 한국어(U4)를 여기서 판정한다. 글은 모두 합성
final class LinkRendererTests: XCTestCase {
  struct Failed: Error { let outcome: String }
  let base = URL(string: "https://invite.example.com/m/abc?code=482913")!

  /// 테스트 호스트 앱의 장면에 새 창을 띄우고, 사용자 화면 역할의 불투명 뷰를 올린다 — 웹뷰는 그 밑에 붙는다
  @MainActor private func window() throws -> UIWindow {
    let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
    let w = UIWindow(windowScene: scene)
    w.frame = CGRect(origin: .zero, size: LinkRenderer.viewport)
    let cover = UIView(frame: w.bounds)
    cover.backgroundColor = .systemBackground
    w.addSubview(cover)
    w.isHidden = false
    return w
  }

  @MainActor private func read(_ html: String, budget: TimeInterval = 6, ocr: Bool = false) async throws -> (LinkRenderOutcome, LinkRenderer) {
    let w = try window()
    defer { w.isHidden = true }
    let r = LinkRenderer(host: w, allowLoopback: false, html: html)
    let o = await r.render(base, budget: budget, ocr: ocr)
    return (o, r)
  }

  private func page(_ o: LinkRenderOutcome) throws -> LinkPage {
    if case .page(let p, _) = o { return p }
    throw Failed(outcome: "\(o)")
  }

  @MainActor func testConfigurationIsEphemeralAndSilent() {
    let c = LinkRenderer.makeConfiguration()
    XCTAssertFalse(c.websiteDataStore.isPersistent)
    XCTAssertEqual(c.mediaTypesRequiringUserActionForPlayback, .all)
    XCTAssertFalse(c.preferences.javaScriptCanOpenWindowsAutomatically)
  }

  @MainActor func testStaticPageReadsMetaAndText() async throws {
    let (o, _) = try await read("""
      <html><head><title>문서 제목</title><meta property="og:title" content="합성신랑 ♥ 합성신부 결혼합니다">
      <meta property="og:description" content="2026년 11월 14일 토요일 오후 1시 30분"></head>
      <body><h1>초대합니다</h1><p>일시 2026년 11월 14일 토요일 오후 1시 30분</p><p>장소 합성웨딩홀 3층</p></body></html>
      """)
    let p = try page(o)
    XCTAssertEqual(p.host, "invite.example.com")
    XCTAssertEqual(p.title, "합성신랑 ♥ 합성신부 결혼합니다")
    XCTAssertEqual(p.description, "2026년 11월 14일 토요일 오후 1시 30분")
    XCTAssertTrue(p.body.contains("장소 합성웨딩홀 3층"))
    XCTAssertFalse(p.timedOut)
    XCTAssertNil(p.ocrText)
  }

  /// SPA: 로드 1.2초 뒤 JS 가 글을 그린다(didFinish 는 그 전에 온다) — 길이가 멈출 때까지 기다린다
  @MainActor func testDelayedScriptTextIsWaitedFor() async throws {
    let (o, _) = try await read("""
      <html><body><div id="app">불러오는 중</div><script>
      setTimeout(() => { document.getElementById('app').innerHTML = '<p>2026년 10월 24일(토) 오후 6시</p><p>합성뷔페 2층 연회장</p>'; }, 1200);
      </script></body></html>
      """)
    XCTAssertTrue(try page(o).body.contains("10월 24일"))
  }

  /// "터치해서 열기" 덮개: 본문이 display:none 이어도 숨은 글로 읽는다
  @MainActor func testHiddenCoverTextIsRead() async throws {
    let (o, _) = try await read("""
      <html><body><button>터치해서 열기</button><div style="display:none"><p>2026년 11월 14일 오후 1시</p><p>합성웨딩홀</p></div></body></html>
      """)
    let p = try page(o)
    XCTAssertFalse(p.visibleText.contains("11월 14일"))
    XCTAssertTrue(p.body.contains("11월 14일"))
  }

  /// 끝없이 늘어나는 글(카운트다운·방명록): 예산이 끝나면 그때까지 읽은 글로
  @MainActor func testNeverSettlingPageReturnsPartial() async throws {
    let (o, _) = try await read("""
      <html><body><p>2026년 11월 14일 합성 행사</p><div id="t"></div><script>
      setInterval(() => { document.getElementById('t').textContent += '가'; }, 200);
      </script></body></html>
      """, budget: 3)
    let p = try page(o)
    XCTAssertTrue(p.timedOut)
    XCTAssertTrue(p.body.contains("11월 14일"))
  }

  /// 앱 스킴 이동·새 창은 막고 읽기는 계속한다
  @MainActor func testAppSchemeNavigationIsBlockedAndPageStillRead() async throws {
    let (o, r) = try await read("""
      <html><body><p>2026년 11월 14일 합성웨딩홀</p><script>
      setTimeout(() => { location.href = 'kakaolink://send?x=1'; window.open('https://other.example.com/'); }, 200);
      </script></body></html>
      """)
    XCTAssertTrue(try page(o).body.contains("11월 14일"))
    XCTAssertGreaterThanOrEqual(r.blockedNavigations, 1)
  }

  @MainActor func testEmptyPageFails() async throws {
    let (o, _) = try await read("<html><body></body></html>", budget: 2)
    XCTAssertEqual(o, .failed("empty"))
  }

  @MainActor func testBlockedAddressesAreNotLoaded() async throws {
    let w = try window()
    defer { w.isHidden = true }
    let r = LinkRenderer(host: w, allowLoopback: false)
    let a = await r.render(URL(string: "http://192.168.0.1/")!, budget: 2, ocr: false)
    let b = await r.render(URL(string: "kakaolink://send")!, budget: 2, ocr: false)
    XCTAssertEqual(a, .failed("blocked_host"))
    XCTAssertEqual(b, .failed("blocked_scheme"))
  }

  @MainActor func testHostOutsideWindowFails() async throws {
    let detached = UIView(frame: CGRect(origin: .zero, size: LinkRenderer.viewport))
    let o = await LinkRenderer(host: detached, allowLoopback: false).render(base, budget: 2, ocr: false)
    XCTAssertEqual(o, .failed("no_host"))
  }

  /// 이미지 전용 청첩장(D4): 글에 날짜가 없으면 화면 스냅샷 OCR. 그림은 테스트 안에서 그린다(저장소에 그림 파일 없음)
  @MainActor func testImageOnlyPageUsesOCR() async throws {
    let img = UIGraphicsImageRenderer(size: CGSize(width: 360, height: 240)).image { _ in
      UIColor.white.setFill(); UIRectFill(CGRect(x: 0, y: 0, width: 360, height: 240))
      let a: [NSAttributedString.Key: Any] = [.font: UIFont.boldSystemFont(ofSize: 26), .foregroundColor: UIColor.black]
      ("2026년 12월 5일 토요일" as NSString).draw(at: CGPoint(x: 16, y: 60), withAttributes: a)
      ("합성 컨벤션 웨딩홀" as NSString).draw(at: CGPoint(x: 16, y: 120), withAttributes: a)
    }
    let b64 = try XCTUnwrap(img.pngData()).base64EncodedString()
    let (o, _) = try await read("""
      <html><body style="margin:0"><p>터치하면 음악이 재생됩니다</p><img src="data:image/png;base64,\(b64)" width="360"></body></html>
      """, budget: 6, ocr: true)
    let p = try page(o)
    let t = try XCTUnwrap(p.ocrText, "OCR 결과 없음 — U4(시뮬레이터 Vision 한국어)·U2(스냅샷)를 메인에게 알린다")
    XCTAssertTrue(LinkText.hasDateCandidate(t), "OCR 글자 수 \(t.count)")
  }

  /// OCR 을 끄면(확장) 날짜가 없어도 스냅샷하지 않는다
  @MainActor func testNoOCRWhenDisabled() async throws {
    let (o, _) = try await read("<html><body><p>터치하면 음악이 재생됩니다</p></body></html>", budget: 4, ocr: false)
    XCTAssertNil(try page(o).ocrText)
  }
}
```

- [ ] **Step 2: 실패 확인**

Run: `cd ios && ./scripts/sim.sh test EruriCoreTests/LinkRendererTests`
Expected: 컴파일 실패(`cannot find 'LinkRenderer' in scope`).

- [ ] **Step 3: OCR**

`ios/Packages/EruriCore/Sources/EruriCore/OCR.swift`를 이것으로 바꾼다(기존 `recognize(imageURL:)`는 그대로):

```swift
import Vision
import Foundation
import UIKit

public enum OCR {
  public static func recognize(imageURL: URL) async throws -> String {
    let req = VNRecognizeTextRequest()
    req.recognitionLanguages = ["ko-KR", "en-US"]
    req.recognitionLevel = .accurate
    try VNImageRequestHandler(url: imageURL).perform([req])
    return (req.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
  }

  /// 링크 화면 스냅샷(스펙 §6 "이미지 전용"). Vision 은 메인 밖에서 돈다. 한국어는 accurate 에서만(F17)
  public static func recognize(image: UIImage) async throws -> String {
    guard let cg = image.cgImage else { return "" }
    let box = Image(cg: cg)
    return try await Task.detached(priority: .userInitiated) { try recognize(cgImage: box.cg) }.value
  }

  /// 불변 이미지를 메인 밖으로 넘긴다(U9 — CGImage 의 Sendable 표기를 기대지 않는다)
  struct Image: @unchecked Sendable { let cg: CGImage }

  static func recognize(cgImage: CGImage) throws -> String {
    let req = VNRecognizeTextRequest()
    req.recognitionLanguages = ["ko-KR", "en-US"]
    req.recognitionLevel = .accurate
    try VNImageRequestHandler(cgImage: cgImage).perform([req])
    return (req.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
  }
}
```

- [ ] **Step 4: `LinkRenderer`**

`ios/Packages/EruriCore/Sources/EruriCore/LinkRenderer.swift`:

```swift
import UIKit
import WebKit

/// 보이지 않는 웹뷰로 페이지를 읽는다(스펙 §6 "링크 읽기"). WebKit 이라 메인 액터에서만.
/// 웹뷰는 실제 화면 크기로 host(창 안에 있는 뷰)의 **맨 아래**에 붙는다 — WebKit 은 창 안·foreground 일 때만 보이는 뷰로 다뤄 렌더링·타이머를 돌린다(F16)
@MainActor public final class LinkRenderer: NSObject, LinkRendering, WKNavigationDelegate {
  public static let viewport = CGSize(width: 390, height: 844)
  /// 메인 프레임 이동 상한(첫 로드 + 리다이렉트 5회)
  public static let maxNavigations = 6
  public static let ocrScreens = 3
  static let subframeSchemes: Set<String> = ["http", "https", "about", "data", "blob"]

  private weak var host: UIView?
  private let allowLoopback: Bool
  private let html: String?
  private var finished = false, committed = false, failure: String?, navigations = 0
  /// 이번 렌더링에서 막은 이동 수(앱 스킴·새 창·사설 주소) — 진단용
  public private(set) var blockedNavigations = 0

  /// host = 창 안에 있는 뷰(확장: 시트 루트 뷰, 앱: 키 창). html = 테스트 전용 — 네트워크 대신 그 문서를 url 기준으로 연다
  public init(host: UIView, allowLoopback: Bool, html: String? = nil) {
    self.host = host; self.allowLoopback = allowLoopback; self.html = html
  }

  public static func makeConfiguration() -> WKWebViewConfiguration {
    let c = WKWebViewConfiguration()
    c.websiteDataStore = .nonPersistent()                          // 쿠키·저장소를 디스크에 남기지 않는다(F17)
    c.mediaTypesRequiringUserActionForPlayback = .all              // 청첩장 배경 음악 자동 재생 금지
    c.allowsInlineMediaPlayback = false
    c.preferences.javaScriptCanOpenWindowsAutomatically = false
    c.defaultWebpagePreferences.allowsContentJavaScript = true     // SPA 청첩장은 JS 로 글을 그린다
    return c
  }

  public func render(_ url: URL, budget: TimeInterval, ocr: Bool) async -> LinkRenderOutcome {
    if let b = LinkText.check(url, allowLoopback: allowLoopback) { return .failed("blocked_\(b.rawValue)") }
    guard let host, host.window != nil else { return .failed("no_host") }
    finished = false; committed = false; failure = nil; navigations = 0; blockedNavigations = 0
    let clock = ContinuousClock(), start = clock.now
    func elapsed() -> TimeInterval {
      let c = start.duration(to: clock.now).components
      return Double(c.seconds) + Double(c.attoseconds) / 1e18
    }
    let wv = WKWebView(frame: CGRect(origin: .zero, size: Self.viewport), configuration: Self.makeConfiguration())
    wv.isUserInteractionEnabled = false
    wv.navigationDelegate = self
    host.insertSubview(wv, at: 0)                                  // 다른 화면 밑 — 사용자에게 보이지 않는다
    defer { wv.stopLoading(); wv.navigationDelegate = nil; wv.removeFromSuperview() }
    if let html { wv.loadHTMLString(html, baseURL: url) } else { wv.load(URLRequest(url: url, timeoutInterval: budget)) }

    var settle = LinkSettle(budget: budget), timedOut = false
    wait: while true {
      if Task.isCancelled { return .failed("cancelled") }
      if let f = failure { return .failed(f) }
      let len = (try? await wv.callAsyncJavaScript(LinkScript.length, contentWorld: .defaultClient)) as? Int ?? 0
      switch settle.observe(length: len, finished: finished, elapsed: elapsed()) {
      case .done: break wait
      case .deadline:
        if len == 0 { return .failed(committed ? "empty" : "timeout") }
        timedOut = true
        break wait
      case .wait: try? await Task.sleep(for: LinkSettle.pollInterval)
      }
    }
    guard let json = (try? await wv.callAsyncJavaScript(LinkScript.extract, contentWorld: .defaultClient)) as? String,
          var page = LinkPage.decode(json: json, host: wv.url?.host() ?? url.host() ?? "") else { return .failed("extract_failed") }
    page.timedOut = timedOut
    if ocr, !LinkText.hasDateCandidate(page.searchable) { page.ocrText = await snapshotText(wv) }
    if page.isEmpty { return .failed("empty") }
    return .page(page, elapsedMs: Int(elapsed() * 1000))
  }

  /// 이미지 전용 청첩장(스펙 §6): 최대 3화면을 스냅샷(너비 780px)해 기기 OCR. 스냅샷은 메모리에서만 쓴다
  private func snapshotText(_ wv: WKWebView) async -> String? {
    var parts: [String] = []
    for i in 0..<Self.ocrScreens {
      if i > 0 {
        let y = Double(i) * Double(Self.viewport.height)
        guard Double(wv.scrollView.contentSize.height) > y else { break }          // 페이지 끝
        _ = try? await wv.callAsyncJavaScript("window.scrollTo(0, y); return window.scrollY;", arguments: ["y": y], contentWorld: .defaultClient)
        try? await Task.sleep(for: .milliseconds(600))                               // 지연 로딩 그림
      }
      let cfg = WKSnapshotConfiguration()
      cfg.snapshotWidth = NSNumber(value: Double(Self.viewport.width) * 2)
      guard let img = try? await wv.takeSnapshot(configuration: cfg), let text = try? await OCR.recognize(image: img), !text.isEmpty else { continue }
      parts.append(text)
    }
    let joined = parts.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
    return joined.isEmpty ? nil : joined
  }

  // MARK: WKNavigationDelegate (async 판만)

  public func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction) async -> WKNavigationActionPolicy {
    if navigationAction.shouldPerformDownload { return .cancel }
    guard let u = navigationAction.request.url, let frame = navigationAction.targetFrame else { blockedNavigations += 1; return .cancel }   // 새 창
    let scheme = u.scheme?.lowercased() ?? ""
    if !frame.isMainFrame { return Self.subframeSchemes.contains(scheme) ? .allow : .cancel }
    if LinkText.check(u, allowLoopback: allowLoopback) != nil { blockedNavigations += 1; return .cancel }   // 앱 스킴·사설 주소 — 읽기는 계속
    navigations += 1
    if navigations > Self.maxNavigations { failure = "redirects"; return .cancel }
    return .allow
  }

  public func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse) async -> WKNavigationResponsePolicy {
    guard navigationResponse.isForMainFrame else { return .allow }
    if let h = navigationResponse.response as? HTTPURLResponse, h.statusCode >= 400 { failure = "http_\(h.statusCode)"; return .cancel }
    if !navigationResponse.canShowMIMEType { failure = "unsupported"; return .cancel }
    return .allow
  }

  public func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) { finished = false }
  public func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) { committed = true }
  public func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { finished = true }
  public func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { loadError(error) }
  public func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { loadError(error); finished = true }
  public func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { failure = "web_process" }

  /// 우리가 취소한 이동(-999, WebKitErrorDomain 102 정책 변경)은 실패가 아니다. 페이지가 이미 섰으면 뒤 이동의 실패로 읽기를 멈추지 않는다
  private func loadError(_ error: Error) {
    let e = error as NSError
    if e.code == NSURLErrorCancelled || (e.domain == "WebKitErrorDomain" && e.code == 102) { return }
    if !committed, failure == nil { failure = "load_failed" }
  }
}

/// 추출 JS — callAsyncJavaScript 의 함수 본문. 격리 세계(.defaultClient)에서 돈다(DOM 공유, 페이지 스크립트가 바꿀 수 없다)
enum LinkScript {
  static let length = "return document.body ? document.body.innerText.length : 0;"
  /// 제목·OG·보이는 글(innerText)·숨은 요소 포함 글(스크립트·스타일 제외 텍스트 노드). 각 200,000자
  static let extract = #"""
    const meta = (k) => { const e = document.querySelector(`meta[property="${k}"],meta[name="${k}"]`); return e ? (e.getAttribute("content") || "") : ""; };
    const cap = (s) => (s || "").slice(0, 200000);
    let all = "";
    if (document.body) {
      const c = document.body.cloneNode(true);
      c.querySelectorAll("script,style,noscript,template,svg,iframe").forEach((e) => e.remove());
      const w = document.createTreeWalker(c, NodeFilter.SHOW_TEXT);
      const parts = []; let n;
      while ((n = w.nextNode())) { const t = n.nodeValue.trim(); if (t) parts.push(t); }
      all = parts.join("\n");
    }
    return JSON.stringify({ title: document.title || "", ogTitle: meta("og:title"),
      ogDescription: meta("og:description") || meta("description"),
      text: cap(document.body ? document.body.innerText : ""), all: cap(all) });
    """#
}
```

- [ ] **Step 5: 통과 확인**

메모리 확인(`vm_stat | grep -E 'free|compressor'`) 뒤:

Run: `cd ios && ./scripts/sim.sh test EruriCoreTests/LinkRendererTests`
Expected: 11개 통과(전체 약 40초). 실패하면 원인별로:
- `testDelayedScriptTextIsWaitedFor`·`testNeverSettlingPageReturnsPartial`이 실패(타이머가 안 돎) → U2 실패. 웹뷰를 `host.addSubview(wv)` + `wv.alpha = 0.01`(맨 위, 거의 투명)로 바꿔 다시 돌리고, 결과를 보고에 적는다(스펙 §6 문구도 그 방식으로 L0 커밋에 이어 고친다).
- `testImageOnlyPageUsesOCR`만 실패 → 스냅샷이 비었는지(`takeSnapshot`) Vision이 한국어를 못 읽는지 구분한다: 같은 테스트에서 `p.ocrText`가 nil이고 `takeSnapshot` 이미지의 `size`가 0이면 U2, 이미지는 있는데 글자가 없으면 U4. U4면 이 테스트에 `try XCTSkipIf(true, "U4: 시뮬레이터 Vision 한국어 — LNK-device D2에서 판정")`를 넣고 보고한다(테스트를 지우지 않는다).
- 컴파일 오류 `OCR.Image`가 Sendable 아님 → 이미 `@unchecked Sendable`이다. `UIImage` 관련이면 `recognize(image:)` 안에서 `cgImage`만 꺼내 넘기는지 확인.

- [ ] **Step 6: 회귀**

Run: `cd ios && ./scripts/sim.sh test EruriCoreTests && ./scripts/sim.sh build`
Expected: 전체 통과, 앱·확장 빌드 성공(EruriCore가 WebKit을 링크한다).

- [ ] **Step 7: 커밋**

```bash
git add ios/Packages/EruriCore/Sources/EruriCore/LinkRenderer.swift ios/Packages/EruriCore/Sources/EruriCore/OCR.swift \
  ios/Packages/EruriCore/Tests/EruriCoreTests/LinkRendererTests.swift
git commit -m "feat(core): LinkRenderer — hidden WKWebView at the bottom of a view inside the window (spec §6): non-persistent store, no autoplay, JS on, app-scheme/new-window/private-address navigations blocked while reading continues, 6 main-frame navigations, HTTP ≥400 and unshowable MIME fail, settle on stable innerText length (LinkSettle), extract title/og/visible/hidden text in the isolated client world, app-only snapshot OCR of up to 3 screens when no date candidate (OCR.recognize(image:) off the main actor); simulator tests on synthetic HTML (static, delayed SPA, hidden cover, never settling, app scheme, empty, blocked, detached host, image-only OCR)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task L4: 공유 확장 — 링크 경로·상태 화면

**Files:**
- Create: `ios/ShareExtension/LinkStatusView.swift`
- Modify: `ios/ShareExtension/ShareViewController.swift`(전체 교체 — 텍스트 경로는 그대로)

**Interfaces:**
- Consumes: L1 `LinkText.shareLink`, L2 `LinkFlow.share`·`PendingLink`·`LinkFlow.traceFields`·`LinkFlow.code`·`LinkCaptureText.reading`·`LinkCaptureText.share`, L3 `LinkRenderer`.
- Produces: 확장이 남긴 **링크 대기 행**(L5의 앱 이어받기가 소비), SHARE 큐 항목(`app_name = "웹 링크"`). 접근성 id `share-link-status`·`share-link-close`(L9 실기기 확인용).

활성화 규칙(`Info.plist`)은 바꾸지 않는다 — 이미 `public.url`·`public.plain-text`를 받는다(F1). 확장은 앱을 열 수 없다(F12) → 앱에 넘길 때는 시트 문구로 "앱을 열면 다시 읽어요"를 알린다.

- [ ] **Step 1: 상태 화면**

`ios/ShareExtension/LinkStatusView.swift`:

```swift
import UIKit

/// 공유 시트 안 링크 읽기 상태(스펙 §6, 계획 D8). 전체를 덮는 불투명 화면 — 웹뷰는 이 밑(루트 뷰의 맨 아래)에 붙어 보이지 않는다
final class LinkStatusView: UIView {
  private let label = UILabel()
  private let spinner = UIActivityIndicatorView(style: .medium)
  private let close = UIButton(type: .system)
  private var closed = false
  private var waiter: CheckedContinuation<Void, Never>?
  /// 읽는 중 [닫기]: 렌더링 취소(대기 행은 앱에 넘어간다)
  var onClose: (() -> Void)?

  override init(frame: CGRect) {
    super.init(frame: frame)
    backgroundColor = .systemBackground
    label.numberOfLines = 0
    label.textAlignment = .center
    label.font = .preferredFont(forTextStyle: .body)
    label.adjustsFontForContentSizeCategory = true
    label.accessibilityIdentifier = "share-link-status"
    close.setTitle("닫기", for: .normal)
    close.accessibilityIdentifier = "share-link-close"
    close.addAction(UIAction { [weak self] _ in self?.tapClose() }, for: .touchUpInside)
    let stack = UIStackView(arrangedSubviews: [spinner, label, close])
    stack.axis = .vertical
    stack.spacing = 16
    stack.alignment = .center
    stack.translatesAutoresizingMaskIntoConstraints = false
    addSubview(stack)
    NSLayoutConstraint.activate([
      stack.centerXAnchor.constraint(equalTo: centerXAnchor),
      stack.centerYAnchor.constraint(equalTo: centerYAnchor),
      stack.leadingAnchor.constraint(greaterThanOrEqualTo: leadingAnchor, constant: 24),
      stack.trailingAnchor.constraint(lessThanOrEqualTo: trailingAnchor, constant: -24),
    ])
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

  func show(_ text: String, done: Bool = false) {
    label.text = text
    if done { spinner.stopAnimating() } else { spinner.startAnimating() }
  }

  /// 결과를 보인 뒤: [닫기]를 누르거나 seconds 가 지나면 돌아온다(읽는 중에 이미 닫기를 눌렀으면 바로)
  func waitClose(seconds: Double) async {
    if closed { return }
    await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in
      waiter = c
      Task { @MainActor [weak self] in
        try? await Task.sleep(for: .seconds(seconds))
        self?.finish()
      }
    }
  }

  private func tapClose() { closed = true; onClose?(); finish() }
  private func finish() { waiter?.resume(); waiter = nil }
}
```

- [ ] **Step 2: `ShareViewController` 교체**

`ios/ShareExtension/ShareViewController.swift` 전체를 이것으로 바꾼다(텍스트 경로의 코드·로그·trace는 글자 하나 바꾸지 않고 `handleText`로 옮긴다):

```swift
import UIKit
import EruriCore

final class ShareViewController: UIViewController {
  /// DEBUG 빌드만 루프백 주소를 연다(시뮬레이터 게이트, 스펙 §6 "주소 검사")
  #if DEBUG
  static let allowLoopback = true
  #else
  static let allowLoopback = false
  #endif

  override func viewDidLoad() {
    super.viewDidLoad()
    Task { await handle(); extensionContext?.completeRequest(returningItems: nil) }
  }

  /// 스펙 §6: 규칙 단계만 적용해 큐에 넣는다. 폐기(OTP)면 큐에도, App Group 에도 남기지 않는다.
  /// 1단계는 텍스트·URL 만 받는다(스펙 §15 1a). 이미지·PDF 는 서버 파일 업로드가 생기는 2단계에서 다시 붙인다.
  /// 공유 한 번의 모든 텍스트 표현(attributedContentText·첨부 plain-text·URL)을 모아 `ShareText.compose` 로 큐 항목 하나로 만든다.
  /// 첨부 하나만 읽으면 호스트가 넘긴 제목·일부만 들어온다(실기기 0.3.0 메모 앱 10자, 2026-09-30). 표현마다 64KiB, 본문 64K자 상한.
  /// 웹 주소가 정확히 하나면 링크 읽기(스펙 §6 "링크 읽기", 0.11.0) — 시트 안 상태 화면을 띄우고 끝나면 닫는다
  private func handle() async {
    guard let items = extensionContext?.inputItems as? [NSExtensionItem] else { return }
    let started = Date()
    let collected = await ShareText.collect(items)
    guard let out = ShareText.compose(collected.pieces) else {
      Self.trace("-", "empty", started, collected.fields(truncatedOutput: false)); return
    }
    if let link = LinkText.shareLink(out.text) { await readLink(link.url, note: link.note); return }
    handleText(out, collected, started)
  }

  private func handleText(_ out: ShareText.Composed, _ collected: ShareText.Collected, _ started: Date) {
    let text = out.text, diag = collected.fields(truncatedOutput: out.truncated)
    let kind = ShareText.isWebURL(text) ? "url" : "text"
    do {
      let pipeline = CapturePipeline(filter: RuleFilter(), queue: try CaptureQueue.shared())
      let result = try pipeline.handleShare(text: text)
      DiagLog.append("ShareExtension \(kind) \(result)")
      Self.trace(kind, result, started, diag.merging(["text_len": text.count, "text_sha8": Trace.sha8(text)]) { a, _ in a })
    } catch {
      DiagLog.append("ShareExtension error \(type(of: error))")
      Self.trace(kind, "error:\(type(of: error))", started, diag)
    }
  }

  // 진단 필드(share.received): 확장이 받은 형식·결과·본문 길이. 확장에서는 UIApplication 을 쓸 수 없어 locked·bg 는 넣지 않는다
  // parts 는 조각별 "출처:길이[:truncated]", utis_aN 은 N번째 첨부가 등록한 형식(ShareText.Collected). 본문은 넣지 않는다
  private static func trace(_ type: String, _ result: String, _ started: Date, _ extra: [String: Any] = [:]) {
    Trace.log("share.received", ["source": "SHARE", "type": type, "result": result,
                                 "elapsed_ms": Int(Date().timeIntervalSince(started) * 1000)].merging(extra) { a, _ in a })
  }

  /// 링크 읽기(스펙 §6·D8): 상태 화면 → LinkFlow.share(대기 행 먼저, 10초, OCR 없음) → 결과 문구 → 1.5초 뒤 또는 [닫기].
  /// 읽는 중 [닫기]는 렌더링을 취소하고 대기 행을 앱에 넘긴다. 로그·trace 에 주소·제목 없음
  private func readLink(_ url: URL, note: String?) async {
    let status = LinkStatusView(frame: view.bounds)
    status.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    view.addSubview(status)
    status.show(LinkCaptureText.reading)
    for _ in 0..<40 where view.window == nil { try? await Task.sleep(for: .milliseconds(50)) }   // viewDidLoad 때는 창이 없다 — 최대 2초(없으면 no_host → 앱)
    let started = Date()
    let work = Task { @MainActor () -> LinkFlow.Outcome in
      guard let q = try? CaptureQueue.shared() else { return .failed("queue") }
      let renderer = LinkRenderer(host: self.view, allowLoopback: Self.allowLoopback)
      let o = await LinkFlow.share(PendingLink(url: url, note: note, origin: "share"), renderer: renderer, queue: q)
      Trace.log("share.link", LinkFlow.traceFields(o, origin: "share", elapsedMs: Int(Date().timeIntervalSince(started) * 1000),
                                                   blockedNav: renderer.blockedNavigations))
      return o
    }
    status.onClose = { work.cancel() }
    let o = await work.value
    DiagLog.append("ShareExtension link \(LinkFlow.code(o))")
    status.show(LinkCaptureText.share(o), done: true)
    await status.waitClose(seconds: 1.5)
  }
}
```

- [ ] **Step 3: 빌드**

Run: `cd ios && ./scripts/sim.sh gen && ./scripts/sim.sh build`
Expected: `** BUILD SUCCEEDED **`. `ShareText.Composed`·`ShareText.Collected`가 public인지 확인(이미 public — `ShareText.swift`). 텍스트 경로 회귀를 위해 `git diff ios/ShareExtension/ShareViewController.swift`에서 텍스트 경로의 문자열(`"ShareExtension \(kind) \(result)"`, `share.received` 필드)이 그대로인지 본다.

- [ ] **Step 4: 회귀**

Run: `cd ios && ./scripts/sim.sh test EruriCoreTests/ShareTextTests && ./scripts/sim.sh test EruriCoreTests/LinkFlowTests`
Expected: 통과(확장 자체의 실동작은 L8 G6(선택)·L9 D1에서 판정 — U1).

- [ ] **Step 5: 커밋**

```bash
git add ios/ShareExtension/ShareViewController.swift ios/ShareExtension/LinkStatusView.swift
git commit -m "feat(share): link reading in the share extension (spec §6) — exactly one http(s) URL in the shared text shows an opaque status view, leaves the pending link row, renders 10 s without OCR under the status view, queues one SHARE item or hands the row to the app (timeout, load failure, no date, close tapped), result copy for 1.5 s or until 닫기; trace share.link with codes only; text sharing unchanged

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task L5: 앱 — 대기 링크 이어받기 + 채팅 붙여넣기 + "공유한 링크" 출처

**Files:**
- Create: `ios/App/LinkCapture.swift`
- Modify: `ios/App/ChatView.swift`(`Turn`·행 분기·`send()` 앞부분·`sendLink`·`linkRow`)
- Modify: `ios/App/EruriApp.swift`(`.active`에서 이어받기)
- Modify: `ios/Packages/EruriCore/Sources/EruriCore/ScheduleCard.swift`(`origin`의 SHARE 줄)
- Test: `ios/Packages/EruriCore/Tests/EruriCoreTests/ScheduleCardTests.swift`

**Interfaces:**
- Consumes: L1 `LinkText.chatIntent`·`appName`, L2 `PendingLink`·`LinkFlow.app`·`traceFields`·`code`·`LinkCaptureText.*`·`CaptureQueue.claimLinks`·`enqueueLink`, L3 `LinkRenderer`. 앱 기존 `API.send`·`Uploader.shared.flush(trigger:)`·`ExecutionReporter.notice(title:body:)`.
- Produces: `@MainActor final class LinkCapture { static shared; drainPending() async; chatRead(url:note:) async -> ChatRead; chatResult(captureID:) async -> String }`, 채팅 링크 턴(접근성 id `chat-link-status` — L8 게이트가 읽는다).

- [ ] **Step 1: 실패하는 테스트("공유한 링크")**

`ScheduleCardTests.swift`의 `testSourceAndReceivedLines` 바로 뒤에 넣는다:

```swift
  /// 링크 항목(0.11.0, app_name "웹 링크", 스펙 §9 ①)은 "공유한 링크", 그 밖의 공유는 그대로
  func testLinkSourceLines() {
    XCTAssertEqual(ScheduleCard.sourceLine(cite("SHARE", app: "웹 링크")), "공유한 링크에서 찾은 일정")
    XCTAssertEqual(ScheduleCard.receivedLine(cite("SHARE", app: "웹 링크")), "10/1 공유한 링크")
    XCTAssertEqual(ScheduleCard.sourceLine(cite("SHARE")), "공유한 내용에서 찾은 일정")
  }
```

Run: `cd ios && ./scripts/sim.sh test EruriCoreTests/ScheduleCardTests/testLinkSourceLines`
Expected: FAIL(`"공유한 내용에서 찾은 일정"`).

- [ ] **Step 2: `ScheduleCard.origin`**

`ScheduleCard.swift`의 `case "SHARE": return ("공유한 내용", "공유함")` →

```swift
    case "SHARE": return c.app_name == LinkText.appName ? ("공유한 링크", "공유한 링크") : ("공유한 내용", "공유함")   // 링크 읽기(스펙 §6, 0.11.0)
```

Run: `cd ios && ./scripts/sim.sh test EruriCoreTests/ScheduleCardTests`
Expected: 통과.

- [ ] **Step 3: `LinkCapture`**

`ios/App/LinkCapture.swift`:

```swift
import UIKit
import EruriCore

/// 앱의 링크 읽기(스펙 §6 "확장과 앱의 이어받기"·§9 "채팅 링크 붙여넣기"). 렌더 호스트는 키 창(다른 화면 밑).
/// 백그라운드에서는 WebKit 이 멈추므로(F13) foreground 에서만 부른다. 로그·trace 에 주소·제목 없음
@MainActor final class LinkCapture {
  static let shared = LinkCapture()
  #if DEBUG
  static let allowLoopback = true            // 시뮬레이터 게이트(스펙 §6 "주소 검사")
  #else
  static let allowLoopback = false
  #endif
  private var draining = false

  struct ChatRead: Sendable { let text: String; let captureID: String? }

  /// 지금 화면에 붙은 키 창(웹뷰를 그 맨 아래에 붙인다)
  private func hostWindow() -> UIWindow? {
    UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
      .first { $0.activationState == .foregroundActive }?.keyWindow
  }

  private static func ms(since d: Date) -> Int { Int(Date().timeIntervalSince(d) * 1000) }

  /// foreground: 확장이 넘긴(또는 확장이 죽어 lease 가 끝난) 대기 행을 하나씩 읽는다. 실패하면 로컬 알림 1건(주소·제목 없음)
  func drainPending() async {
    guard !draining, let host = hostWindow(), let q = try? CaptureQueue.shared(),
          let links = try? q.claimLinks(limit: 5), !links.isEmpty else { return }
    draining = true
    defer { draining = false }
    for link in links {
      let started = Date(), r = LinkRenderer(host: host, allowLoopback: Self.allowLoopback)
      let o = await LinkFlow.app(link, renderer: r, queue: q)
      Trace.log("share.link", LinkFlow.traceFields(o, origin: "drain", elapsedMs: Self.ms(since: started), blockedNav: r.blockedNavigations))
      DiagLog.append("link drain \(LinkFlow.code(o))")
      if case .failed(let code) = o, code != "queue" {
        await ExecutionReporter.notice(title: LinkCaptureText.drainFailedTitle, body: LinkCaptureText.drainFailedBody(code))
      }
    }
    await Uploader.shared.flush(trigger: .foreground)
  }

  /// 채팅 붙여넣기 1단계(스펙 §9): 대기 행(앱이 죽어도 다음 foreground 가 이어받게, lease 600초) → 읽기(15초 + OCR) → 큐 → 업로드
  func chatRead(url: URL, note: String?) async -> ChatRead {
    guard let host = hostWindow(), let q = try? CaptureQueue.shared() else { return ChatRead(text: LinkCaptureText.chat(.failed("no_host")), captureID: nil) }
    let link = PendingLink(url: url, note: note, origin: "chat")
    do { try q.enqueueLink(link, lease: CaptureQueue.lease) } catch { return ChatRead(text: LinkCaptureText.chat(.failed("queue")), captureID: nil) }
    let started = Date(), r = LinkRenderer(host: host, allowLoopback: Self.allowLoopback)
    let o = await LinkFlow.app(link, renderer: r, queue: q)
    Trace.log("share.link", LinkFlow.traceFields(o, origin: "chat", elapsedMs: Self.ms(since: started), blockedNav: r.blockedNavigations))
    DiagLog.append("link chat \(LinkFlow.code(o))")
    guard case .queued(let id, _, _, _) = o else { return ChatRead(text: LinkCaptureText.chat(o), captureID: nil) }
    await Uploader.shared.flush(trigger: .foreground)        // 직접 요청 우선(8초), 응답이 없으면 background 세션(스펙 §6 업로더)
    return ChatRead(text: LinkCaptureText.chat(o), captureID: id)
  }

  /// 2단계: 서버 처리 결과를 3초마다 최대 60초 확인(본인 items.status·gate_label·facts 종류만 — RLS, F19)
  func chatResult(captureID: String) async -> String {
    let key = "SHARE:\(captureID)".addingPercentEncoding(withAllowedCharacters: .alphanumerics.union(CharacterSet(charactersIn: "-"))) ?? captureID
    for _ in 0..<20 {
      try? await Task.sleep(for: .seconds(3))
      if let text = await result(key: key) { return text }
    }
    return LinkCaptureText.pending
  }

  private func result(key: String) async -> String? {
    guard let r = await API.send("rest/v1/items?select=id,status,gate_label&idempotency_key=eq.\(key)"), r.status == 200,
          let rows = (try? JSONSerialization.jsonObject(with: r.data)) as? [[String: Any]], let row = rows.first,
          let itemID = row["id"] as? String, let status = row["status"] as? String else { return nil }
    var kinds: [String] = []
    if status == "extracted", let f = await API.send("rest/v1/facts?select=kind&status=eq.active&item_id=eq.\(itemID)"), f.status == 200,
       let fr = (try? JSONSerialization.jsonObject(with: f.data)) as? [[String: Any]] {
      kinds = fr.compactMap { $0["kind"] as? String }
    }
    return LinkCaptureText.chatResult(status: status, gateLabel: row["gate_label"] as? String, kinds: kinds)
  }
}
```

- [ ] **Step 4: 채팅 링크 턴**

`ChatView.swift`:

(a) `struct Turn`의 `var cardsMore = 0` 줄 뒤에 더한다:

```swift
    var link: String?                             // 링크 턴(§9 채팅 링크 붙여넣기, 0.11.0): 상태 문구. nil = 질문 턴
    var linkDone = false
```

(b) `ForEach(turns)` 안의 행 분기

```swift
              if let a = t.answer { answerRows(t, a) }
              else if t.error == nil { ProgressView() }
```

를 이것으로 바꾼다:

```swift
              if let l = t.link { linkRow(l, done: t.linkDone) }
              else if let a = t.answer { answerRows(t, a) }
              else if t.error == nil { ProgressView() }
```

(c) `send(keepFocus:)`의 `dictation.stopIfRecording()` 줄 바로 뒤(500자 검사 앞)에 넣는다:

```swift
    // 링크 붙여넣기(§9, 0.11.0): http(s) 주소가 정확히 하나면 질문이 아니라 링크 수집 — /chat 을 부르지 않는다. 둘 이상이면 안내(입력은 남긴다)
    switch LinkText.chatIntent(q) {
    case .link(let url, let note): sendLink(q, url: url, note: note, keepFocus: keepFocus); return
    case .tooMany: turns.append(Turn(question: q, error: LinkCaptureText.tooMany)); return
    case .none: break
    }
```

(d) `send(keepFocus:)` 함수 바로 뒤(같은 `struct ChatView` 안)에 넣는다:

```swift
  /// 링크 수집 턴(§9): 읽기(15초 + OCR) 동안만 보내기를 막고, 서버 결과(최대 60초)는 따로 기다린다
  private func sendLink(_ q: String, url: URL, note: String?, keepFocus: Bool) {
    input = ""
    if !keepFocus { inputFocused = false }
    var t = Turn(question: q)
    t.link = LinkCaptureText.reading
    turns.append(t)
    let idx = turns.count - 1
    scroll(to: turns[idx].id)
    busy = true
    Task {
      let read = await LinkCapture.shared.chatRead(url: url, note: note)
      turns[idx].link = read.text
      busy = false
      guard let id = read.captureID else { turns[idx].linkDone = true; return }
      turns[idx].link = await LinkCapture.shared.chatResult(captureID: id)
      turns[idx].linkDone = true
    }
  }

  /// 링크 턴(§9): 상태 문구만 — 일정 카드·보관함 버튼·맞아요 막대 없음(제안은 "제안" 탭·알림)
  private func linkRow(_ text: String, done: Bool) -> some View {
    HStack(alignment: .firstTextBaseline, spacing: 8) {
      if !done { ProgressView() }
      Text(text).accessibilityIdentifier("chat-link-status")
    }
  }
```

- [ ] **Step 5: foreground 이어받기**

`EruriApp.swift`의 `.onChange(of: scenePhase)` 안 `Task { await DeviceRegistrar.shared.register(); await ExecutionReporter.shared.flush() }` 줄 바로 뒤에 넣는다:

```swift
        Task { await LinkCapture.shared.drainPending() }   // 공유 확장이 넘긴 링크(스펙 §6 이어받기) — foreground 에서만 WebKit 이 돈다
```

- [ ] **Step 6: 빌드·회귀**

Run: `cd ios && ./scripts/sim.sh gen && ./scripts/sim.sh build && ./scripts/sim.sh test EruriCoreTests`
Expected: 빌드 성공, 전체 테스트 통과. 채팅·이어받기의 실동작은 L8 게이트(G1~G5)가 판정한다.

- [ ] **Step 7: 커밋**

```bash
git add ios/App/LinkCapture.swift ios/App/ChatView.swift ios/App/EruriApp.swift \
  ios/Packages/EruriCore/Sources/EruriCore/ScheduleCard.swift ios/Packages/EruriCore/Tests/EruriCoreTests/ScheduleCardTests.swift
git commit -m "feat(ios): link reading in the app (spec §6, §9) — on foreground the app renders pending link rows handed over by the share extension (15 s + OCR, one try, local notice without address on failure); chat input with exactly one http(s) URL becomes a link turn instead of a question (pending row, render, queue, upload, then poll own items.status/gate_label and facts kinds every 3 s up to 60 s for the result line), two or more URLs ask for one at a time; schedule cards say 공유한 링크 for link items

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task L6: 일정 위치 — 제안 `location` → EventKit

**Files:**
- Modify: `ios/Packages/EruriCore/Sources/EruriCore/ProposalReview.swift`(`place(_:)`, `Pending.addFields`)
- Modify: `ios/Packages/EruriCore/Sources/EruriCore/ScheduleCard.swift`(`Model.location`, `model(...)`, `addFields`)
- Modify: `ios/App/NotificationActions.swift`(`AddEventRequest.location`, `handleAdd`, `AddEventGate`)
- Test: `ios/Packages/EruriCore/Tests/EruriCoreTests/ProposalReviewTests.swift`, `ios/Packages/EruriCore/Tests/EruriCoreTests/ScheduleCardTests.swift`

**Interfaces:**
- Consumes: 제안 payload `location`(F11), 목록 행 `Pending.location`.
- Produces: `ProposalReview.place(_ s: String?) -> String?`(앞뒤 공백 제거, 비면 nil), handleAdd 입력 키 `location`(선택), `AddEventRequest.location: String?`.

위치는 표식·겹침·비슷한 일정 판정에 쓰지 않는다(스펙 §10). 잠금화면 액션·알림 값 경로는 `userInfo`에 `location`이 없어 그대로 위치 없이 저장된다(D9) — 이 태스크는 알림 쪽을 건드리지 않는다.

- [ ] **Step 1: 실패하는 테스트**

`ProposalReviewTests.swift`의 `testAddFields` 바로 뒤에 넣는다:

```swift
  /// 일정 위치(스펙 §10, 0.11.0): 목록 행의 location 을 handleAdd 입력으로. 공백뿐이면 넣지 않는다
  func testAddFieldsCarryLocation() throws {
    let row = try XCTUnwrap(ProposalReview.decodeList(listJSON())?.first)
    XCTAssertEqual(row.addFields?["location"], "합성 회의실")
    let blank = try XCTUnwrap(ProposalReview.decodeList(Data("""
      [{"proposal_id":"\(pid)","action":"ADD_EVENT","title":"t","start":"2026-10-02T06:30:00+00:00","end":null,"location":"  ","version":1,"created_at":"x"}]
      """.utf8))?.first)
    XCTAssertNil(blank.addFields?["location"])
    XCTAssertEqual(ProposalReview.place("  합성웨딩홀 3층 \n"), "합성웨딩홀 3층")
    XCTAssertNil(ProposalReview.place(nil))
  }
```

`ScheduleCardTests.swift`의 `testAllDayMultiDayModel` 바로 뒤에 넣는다:

```swift
  /// 일정 위치(스펙 §10, 0.11.0): 제안 payload 의 location → 카드 추가 필드. 없으면 키도 없다
  func testCardAddFieldsCarryLocation() throws {
    var p = prop("p-loc", start: .string("2026-10-05T05:00:00+00:00"), title: "합성 결혼식")
    p = ChatReply.Proposal(id: p.id, item_id: p.item_id, action: p.action, status: p.status,
                           payload: p.payload.merging(["location": .string("합성웨딩홀 3층")]) { _, n in n })
    let m = ScheduleCard.model(try XCTUnwrap(ScheduleCard.card(p, now: now)), events: [], executed: false)
    XCTAssertEqual(m.location, "합성웨딩홀 3층")
    XCTAssertEqual(ScheduleCard.addFields(m)["location"], "합성웨딩홀 3층")
    let plain = ScheduleCard.model(try XCTUnwrap(ScheduleCard.card(prop("p-2", start: .string("2026-10-05T05:00:00+00:00")), now: now)),
                                   events: [], executed: false)
    XCTAssertNil(ScheduleCard.addFields(plain)["location"])
  }
```

Run: `cd ios && ./scripts/sim.sh test EruriCoreTests/ProposalReviewTests && ./scripts/sim.sh test EruriCoreTests/ScheduleCardTests`
Expected: 컴파일 실패(`place`·`location` 없음).

- [ ] **Step 2: `ProposalReview`**

`ProposalReview.swift`의 `public var addFields: [String: String]? {` 블록을 이것으로 바꾼다:

```swift
    public var addFields: [String: String]? {
      guard let t = timing else { return nil }
      var f = t.fieldValues.merging(["proposal_id": proposal_id, "title": title, "version": String(version)]) { a, _ in a }
      if let l = ProposalReview.place(location) { f["location"] = l }          // 일정 위치(스펙 §10, 0.11.0)
      return f
    }
```

같은 파일 `public static func decodeList` 바로 앞에 넣는다:

```swift
  /// 일정 위치(스펙 §10, 0.11.0): 제안의 장소·주소 그대로, 앞뒤 공백만 뗀다. 비면 nil(EventKit 에 넣지 않는다)
  public static func place(_ s: String?) -> String? {
    guard let t = s?.trimmingCharacters(in: .whitespacesAndNewlines), !t.isEmpty else { return nil }
    return t
  }
```

- [ ] **Step 3: `ScheduleCard`**

`public struct Model`의 `public let moreLines: Int` 줄 뒤에 더한다:

```swift
    /// 제안 payload 의 location(일정 위치, 스펙 §10 0.11.0) — addFields 로 EventKit 에
    public var location: String? = nil
```

`model(...)`의 `return Model(…)` 호출 두 번째 줄

```swift
                 endText: c.proposal.payload["end"]?.string, kind: c.kind, start: c.start, timed: c.timed, status: st, lines: l?.lines, moreLines: l?.more ?? 0)
```

을 이것으로 바꾼다(인자 하나 추가):

```swift
                 endText: c.proposal.payload["end"]?.string, kind: c.kind, start: c.start, timed: c.timed, status: st, lines: l?.lines, moreLines: l?.more ?? 0,
                 location: ProposalReview.place(c.proposal.payload["location"]?.string))
```

`public static func addFields(_ m: Model) -> [String: String] {` 블록의 `return f` 앞에 넣는다:

```swift
    if let l = m.location { f["location"] = l }
```

- [ ] **Step 4: 앱 저장 경로**

`NotificationActions.swift`:

`struct AddEventRequest: Sendable { let pid: String; let title: String; let timing: ProposalTiming; let version: Int; var confirmed = false }` →

```swift
struct AddEventRequest: Sendable { let pid: String; let title: String; let timing: ProposalTiming; let version: Int; var confirmed = false; var location: String? = nil }
```

`handleAdd`의 `AddEventRequest(pid: pid, title: title, timing: timing, version: version, confirmed: confirmed)` →

```swift
AddEventRequest(pid: pid, title: title, timing: timing, version: version, confirmed: confirmed, location: ProposalReview.place(f["location"]))
```

`AddEventGate.add`의 `ev.title = r.title; ev.isAllDay = r.timing.isAllDay; ev.startDate = span.start; ev.endDate = span.end` 줄 바로 뒤에 넣는다:

```swift
      ev.location = r.location                                       // 일정 위치(스펙 §10, 0.11.0). 잠금화면 경로는 nil
```

- [ ] **Step 5: 통과·빌드**

Run: `cd ios && ./scripts/sim.sh test EruriCoreTests && ./scripts/sim.sh build`
Expected: 전체 통과(`testAllDayMultiDayModel`의 addFields 동등 비교는 payload에 location이 없어 그대로), 빌드 성공. EventKit 저장 결과는 L8 G4에서 본다.

- [ ] **Step 6: 커밋**

```bash
git add ios/Packages/EruriCore/Sources/EruriCore/ProposalReview.swift ios/Packages/EruriCore/Sources/EruriCore/ScheduleCard.swift \
  ios/App/NotificationActions.swift ios/Packages/EruriCore/Tests/EruriCoreTests/ProposalReviewTests.swift \
  ios/Packages/EruriCore/Tests/EruriCoreTests/ScheduleCardTests.swift
git commit -m "feat(ios): event location from proposals (spec §10, 0.11.0) — list rows and chat cards pass the proposal's location (trimmed, empty dropped) to handleAdd and AddEventGate sets EKEvent.location; lock-screen and notification-value paths carry no location (push payload unchanged); location never affects marker, conflict or similar checks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task L7: 서버 추출 평가 `LNK-eval` (배포 없음)

**Files:**
- Create: `supabase/eval/link-cases.json`(합성 링크 본문 8종 + 기대값)
- Create: `supabase/scripts/_link-eval.ts`(판정 순수 함수)
- Create: `supabase/scripts/eval-link.ts`(배포된 worker를 테스트 lease로 호출)
- Test: `supabase/tests/link-eval.test.ts`(판정 함수, 네트워크 없음)
- Modify: `docs/superpowers/phase1/gates.md`(행 `LNK-eval`)

**Interfaces:**
- Consumes: L1 본문 형식(스펙 §6 "보내는 글" — 사례는 그 형식으로 쓴 합성 글), 배포된 `worker`(F20), `insert_item`(`p_enqueue:false`, `p_app_name`), `enqueue_job`, `tests/_testenv.ts`(`RUN`·`testUser`·`deleteRunJobs`).
- Produces: 게이트 행 `LNK-eval`(통과면 L8 진행, U7 판정).

판정: **행동 사례 6종(청첩장 글·청첩장 OCR·돌잔치(연도 없음)·북토크(신청 기간 + 행사)·2회차 클래스·날짜만 결혼식)은 3회 모두** `status = extracted`·일정 수·시작·장소가 기대와 같고, **비행동 2종(광고 라인업·지도만)은 3회 모두 일정 0**(상태는 `discarded:server:empty` 또는 그 사례가 허용한 게이트 라벨). 하나라도 어긋나면 "실패"로 기록하고 멈춘다 — 행동 사례가 게이트로 격리됐으면 U7(메인이 사용자에게 "공유 링크는 게이트 생략"을 묻는다, 워커 변경 → ③c2 뒤 별도 계획), 추출이 틀렸으면 지시문 변경(워커 배포 → ③c2 뒤) 여부를 메인이 정한다. 이 태스크는 서버 코드를 고치지 않는다.

- [ ] **Step 1: 사례 파일**

`supabase/eval/link-cases.json`:

```json
[
  {
    "id": "wedding-text",
    "title": "합성신랑 ♥ 합성신부 결혼합니다",
    "text": "[웹 링크] invite.example.com\n제목: 합성신랑 ♥ 합성신부 결혼합니다\n설명: 2026년 11월 14일 토요일 오후 1시 30분 합성웨딩홀 3층\n본문:\n저희 두 사람이 사랑의 결실을 맺게 되었습니다.\n귀한 걸음 하시어 축복해 주시면 감사하겠습니다.\n일시\n2026년 11월 14일 토요일 오후 1시 30분\n장소\n합성웨딩홀 3층 그랜드볼룸\n서울 합성구 합성로 123\n오시는 길\n지하철 합성역 2번 출구 도보 5분\n마음 전하실 곳\n신랑측 합성은행 ***-****-1234",
    "expect": { "status": ["extracted"], "events": 1, "starts": ["2026-11-14T13:30"], "location": "합성웨딩홀" }
  },
  {
    "id": "wedding-ocr",
    "title": "모바일 청첩장",
    "text": "[웹 링크] card.example.com\n제목: 모바일 청첩장\n본문:\n터치하면 음악이 재생됩니다\n이미지 속 글자:\n합성민수 그리고 합성지은\n2026. 12. 5. SAT PM 12:00\n합성 컨벤션 웨딩홀 5층",
    "expect": { "status": ["extracted"], "events": 1, "starts": ["2026-12-05T12:00"], "location": "합성 컨벤션" }
  },
  {
    "id": "first-birthday",
    "title": "합성아기 첫 돌잔치에 초대합니다",
    "text": "[웹 링크] party.example.com\n제목: 합성아기 첫 돌잔치에 초대합니다\n본문:\n건강하게 자라 첫 번째 생일을 맞이합니다.\n일시: 10월 24일(토) 오후 6시\n장소: 합성뷔페 2층 연회장",
    "expect": { "status": ["extracted"], "events": 1, "starts": ["2026-10-24T18:00"], "location": "합성뷔페" }
  },
  {
    "id": "book-talk",
    "title": "합성 북토크 — 작가와의 만남",
    "text": "[웹 링크] library.example.com\n제목: 합성 북토크 — 작가와의 만남\n설명: 신청 기간 10월 1일~10월 15일, 행사 10월 21일(수) 오후 7시\n본문:\n신청 기간\n2026년 10월 1일(목) ~ 10월 15일(목)\n행사 일시\n2026년 10월 21일(수) 오후 7시 ~ 9시\n장소\n합성도서관 1층 강당",
    "expect": { "status": ["extracted"], "events": 1, "starts": ["2026-10-21T19:00"], "location": "합성도서관" }
  },
  {
    "id": "two-sessions",
    "title": "합성 문화센터 도자기 원데이 클래스",
    "text": "[웹 링크] culture.example.com\n제목: 합성 문화센터 도자기 원데이 클래스\n본문:\n1회차 2026년 11월 3일(화) 오후 2시\n2회차 2026년 11월 10일(화) 오후 2시\n장소 합성 문화센터 3층 공방",
    "expect": { "status": ["extracted"], "events": 2, "starts": ["2026-11-03T14:00", "2026-11-10T14:00"], "location": "합성 문화센터" }
  },
  {
    "id": "date-only",
    "title": "합성 결혼식 안내",
    "text": "[웹 링크] invite.example.com\n제목: 합성 결혼식 안내\n본문:\n2026년 11월 28일 토요일\n합성 가든 웨딩\n예식 시간은 추후 안내드리겠습니다.",
    "expect": { "status": ["extracted"], "events": 1, "starts": ["2026-11-28"] }
  },
  {
    "id": "promo-lineup",
    "title": "합성 페스티벌 2026 라인업 공개!",
    "text": "[웹 링크] festival.example.com\n제목: 합성 페스티벌 2026 라인업 공개!\n설명: 지금 예매하면 30% 할인\n본문:\n11/7(토) 합성밴드 · 합성가수\n11/8(일) 합성듀오 · 합성 오케스트라\n얼리버드 티켓 30% 할인 — 지금 예매하세요",
    "expect": { "status": ["discarded:server:empty", "discarded:server:promo"], "events": 0 }
  },
  {
    "id": "map-only",
    "title": "합성웨딩홀 : 지도",
    "text": "[웹 링크] map.example.com\n제목: 합성웨딩홀 : 지도\n본문:\n합성웨딩홀\n서울 합성구 합성로 123\n길찾기\n전화",
    "expect": { "status": ["discarded:server:empty", "discarded:server:notice"], "events": 0 }
  }
]
```

- [ ] **Step 2: 판정 함수와 실패하는 테스트**

`supabase/tests/link-eval.test.ts`:

```ts
import { assertEquals } from "jsr:@std/assert@1";
import { type Case, type Fact, judge } from "../scripts/_link-eval.ts";

// LNK-eval 판정(순수, 네트워크 없음): 상태·일정 수·시작(날짜만은 같음, 시각은 분까지 앞부분)·장소(부분 문자열)
const c: Case = { id: "t", title: null, text: "합성", expect: { status: ["extracted"], events: 2, starts: ["2026-11-03T14:00", "2026-11-28"], location: "합성 문화센터" } };
const ev = (ordinal: number, start: string, location: string | null = null): Fact => ({ kind: "event", ordinal, payload: { start, location } });

Deno.test("link-eval judge: all match", () => {
  assertEquals(judge(c, "extracted", [ev(1, "2026-11-28"), ev(0, "2026-11-03T14:00:00+09:00", "합성 문화센터 3층")]), []);
});

Deno.test("link-eval judge: status, count, start, location misses", () => {
  assertEquals(judge(c, "discarded:server:personal", []), ["status:discarded:server:personal", "events:0", "start0", "start1", "location"]);
  assertEquals(judge(c, "extracted", [ev(0, "2026-11-03T15:00:00+09:00", "합성 문화센터"), ev(1, "2026-11-28T10:00:00+09:00")]), ["start0", "start1"]);
  assertEquals(judge({ ...c, expect: { status: ["discarded:server:empty"], events: 0 } }, "discarded:server:empty",
    [{ kind: "purchase", ordinal: 0, payload: {} }]), []);                                   // 일정이 아닌 fact 는 세지 않는다
});
```

Run: `deno test --allow-read supabase/tests/link-eval.test.ts`
Expected: FAIL(모듈 없음).

`supabase/scripts/_link-eval.ts`:

```ts
// LNK-eval 판정(계획 2026-10-02-link-event L7) — 네트워크 없는 순수 함수. eval-link.ts 와 link-eval.test.ts 가 쓴다
export type Expect = { status: string[]; events: number; starts?: string[]; location?: string };
export type Case = { id: string; title: string | null; text: string; expect: Expect };
export type Fact = { kind: string; ordinal: number; payload: { start?: string | null; location?: string | null } };

// 어긋난 항목 코드(빈 배열 = 일치). start: 기대가 날짜만(10자)이면 같아야 하고, 시각이면 그 앞부분(분까지)으로 시작해야 한다.
// location: 일정 중 하나의 장소가 기대 문자열을 포함. 일정이 아닌 fact(task·purchase)는 세지 않는다
export function judge(c: Case, status: string, facts: Fact[]): string[] {
  const miss: string[] = [];
  const events = facts.filter((f) => f.kind === "event").sort((a, b) => a.ordinal - b.ordinal);
  if (!c.expect.status.includes(status)) miss.push(`status:${status}`);
  if (events.length !== c.expect.events) miss.push(`events:${events.length}`);
  (c.expect.starts ?? []).forEach((s, k) => {
    const got = events[k]?.payload.start ?? "";
    if (s.length === 10 ? got !== s : !got.startsWith(s)) miss.push(`start${k}`);
  });
  const want = c.expect.location;
  if (want && !events.some((e) => (e.payload.location ?? "").includes(want))) miss.push("location");
  return miss;
}
```

Run: `deno test --allow-read supabase/tests/link-eval.test.ts`
Expected: 2 passed.

- [ ] **Step 3: 평가 스크립트**

`supabase/scripts/eval-link.ts`:

```ts
// LNK-eval(계획 2026-10-02-link-event L7): 앱이 만드는 링크 본문 형식(스펙 §6 "보내는 글")의 합성 사례를 배포된 worker 의 process 경로
// (실제 서버 규칙 → Jev 게이트 → gpt-6-luna 추출 → save_facts)에 테스트 lease 로 넣고 상태·일정만 비교한다. 배포·서버 코드 변경 없음.
// 전용 테스트 사용자 13·실행 태그만 쓰고 끝나면 자기 행을 지운다(AGENTS.md §7). 출력은 사례 id·상태·게이트 라벨·개수·어긋난 항목 코드만(본문 없음)
// 사용: deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/eval-link.ts [--runs 3]
import { encrypt, toBytea } from "../functions/_shared/crypto.ts";
import { deleteRunJobs, RUN, service as sb, testUser } from "../tests/_testenv.ts";
import { type Case, type Fact, judge } from "./_link-eval.ts";

const cases: Case[] = JSON.parse(await Deno.readTextFile(new URL("../eval/link-cases.json", import.meta.url)));
const at = Deno.args.indexOf("--runs");
const runs = at >= 0 ? Number(Deno.args[at + 1]) : 1;
const OCCURRED = "2026-10-02T03:00:00.000Z";                   // 받은 시각(서울 10-02) — 연도 없는 날짜의 해 = 2026(스펙 §7)
const USER = (await testUser(13)).id;
const BASE = Deno.env.get("SUPABASE_URL")!, KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ids: string[] = [];
let failures = 0;

try {
  for (let r = 0; r < runs; r++) {
    for (const c of cases) {
      const { data: id, error } = await sb.rpc("insert_item", { p_user: USER, p_source: "SHARE", p_idempotency_key: `${RUN}:link:${c.id}:${r}`,
        p_sender: null, p_title: c.title, p_content_enc: toBytea(await encrypt(USER, c.text)), p_occurred_at: OCCURRED,
        p_enqueue: false, p_app_name: "웹 링크" });
      if (error || !id) throw new Error("insert_item " + (error?.code ?? "null"));
      ids.push(id as string);
      const e = await sb.rpc("enqueue_job", { p_user: USER, p_kind: "process", p_lease_key: `${RUN}:process:${c.id}:${r}`, p_payload: { item_id: id } });
      if (e.error) throw new Error("enqueue_job " + e.error.code);
    }
    // 테스트 lease 접두를 주면 worker 는 그 잡과 자식 잡(notify·embed)만 가져간다(F20). 한 호출 100초 예산 — 남으면 다시 부른다
    for (let call = 0; call < 6; call++) {
      const w = await fetch(`${BASE}/functions/v1/worker`, { method: "POST",
        headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" }, body: JSON.stringify({ lease_prefix: RUN }) });
      await w.body?.cancel();
      const { count } = await sb.from("jobs").select("id", { count: "exact", head: true }).eq("user_id", USER)
        .like("lease_key", `${RUN}:process:%`).in("status", ["queued", "running"]);
      if ((count ?? 0) === 0) break;
    }
    for (const c of cases) {
      const { data: item } = await sb.from("items").select("id, status, gate_label, gate_confidence").eq("user_id", USER)
        .eq("idempotency_key", `${RUN}:link:${c.id}:${r}`).single();
      const { data: facts } = await sb.from("facts").select("kind, ordinal, payload").eq("user_id", USER).eq("item_id", item?.id ?? "")
        .eq("status", "active");
      const miss = judge(c, item?.status ?? "missing", (facts ?? []) as Fact[]);
      if (miss.length) failures++;
      console.log(JSON.stringify({ run: r, case: c.id, status: item?.status ?? null, gate: item?.gate_label ?? null,
        conf: item?.gate_confidence ?? null, events: ((facts ?? []) as Fact[]).filter((f) => f.kind === "event").length, ok: miss.length === 0, miss }));
    }
  }
  console.log(JSON.stringify({ gate: failures === 0 ? "pass" : "fail", runs, cases: cases.length, failures }));
  if (failures) Deno.exitCode = 1;
} finally {
  if (ids.length) {
    await sb.from("facts").delete().eq("user_id", USER).in("item_id", ids);                 // proposals → proposal_pushes cascade
    await sb.from("jobs").delete().eq("user_id", USER).in("payload->>item_id", ids);
    await sb.from("items").delete().eq("user_id", USER).in("id", ids);
  }
  await deleteRunJobs();
  await sb.from("usage_counters").delete().eq("user_id", USER);                              // 테스트 사용자 행만
  await sb.from("llm_slots").delete().eq("user_id", USER);
}
```

Run: `deno check supabase/scripts/eval-link.ts`
Expected: 타입 오류 없음.

- [ ] **Step 4: 평가 실행(측정 창 밖)**

메인에게 지금이 ③b3·③c1·③c2 창 밖인지 확인받는다. `pgrep -x xcodebuild`가 비었는지, `vm_stat`를 본다.

Run: `deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/eval-link.ts --runs 3`
Expected: 마지막 줄 `{"gate":"pass","runs":3,"cases":8,"failures":0}`. 사례 줄은 id·상태·게이트 라벨·개수·`miss` 코드만(본문·시작값·장소값을 출력하지 않는다).

정리 확인: `deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/sql.ts "select count(*) from items where user_id = (select id from auth.users where email = 'poc-test-13@example.com') and idempotency_key like 'test:%:link:%'"`가 0(이 스크립트의 사용법이 다르면 `supabase/scripts/sql.ts` 머리 주석대로 같은 질의를 돌린다).

- [ ] **Step 5: 기록**

`docs/superpowers/phase1/gates.md` 끝에 행을 더한다(커밋 칸은 비운다):

```text
| LNK-eval | 링크 본문 형식(스펙 §6) 합성 8종 × 3회를 배포된 worker(테스트 lease, 사용자 13)에: 행동 6종 extracted·일정 수·시작·장소 일치, 비행동 2종 일정 0 | 통과 또는 실패 | <실행 시각 KST>, HEAD <sha>. 사례별 3회 결과(상태·게이트 라벨·confidence 범위·miss 코드), 실패면 U7(게이트) 또는 추출 원인 구분 | | <날짜> |
```

실패면 멈추고 메인에게 보고한다(L8로 넘어가지 않는다).

- [ ] **Step 6: 커밋**

```bash
git add supabase/eval/link-cases.json supabase/scripts/_link-eval.ts supabase/scripts/eval-link.ts supabase/tests/link-eval.test.ts docs/superpowers/phase1/gates.md
git commit -m "test(server): LNK-eval — 8 synthetic link bodies in the app's link format (spec §6) through the deployed worker's process path with a test lease (user 13, no deploy): wedding text, wedding OCR, first birthday without year, book talk with an application period, two sessions, date-only wedding must extract the expected events, starts and places; ad lineup and map-only must yield no event; offline judge tests

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task L8: 0.11.0 + 시뮬레이터 게이트 `LNK-sim` (측정 창 밖)

**Files:**
- Modify: `ios/project.yml`(`MARKETING_VERSION: 0.11.0`)
- Modify: `docs/superpowers/phase1/gates.md`(행 `LNK-sim`)
- 게이트 하네스(임시, **커밋하지 않는다**): `ios/project.gate0110.yml`, `EruriGate.xcodeproj`, `ios/GateHostTests/GateHost.swift`, `ios/GateUITests/LinkGate.swift`, `.context/gate0110/`(rt·udid·site/·cleanup.ts). 원본은 사본에서 만든다(F22): `.context/sim-gate-090-shots/project.gate090.yml.txt` → `ios/project.gate0110.yml`(`MARKETING_VERSION: 0.11.0`), `GateHost.swift.txt` → `ios/GateHostTests/GateHost.swift`(`test1_inject`만 남기고 rt 경로를 `.context/gate0110/rt`로, 아래 테스트를 더한다). 실행 도구는 `.context/gate090/drive.sh`를 `.context/gate0110/drive.sh`로 복사해 경로(`gate090` → `gate0110`)만 바꾼다(푸시 마커는 쓰지 않는다).

**Interfaces:**
- Consumes: L4·L5·L6 앱, L7 `LNK-eval` 통과, 배포된 `ingest`·`worker`(서버 변경 없음), `.context/gate090/token.ts`.
- 테스트 사용자 **14**(게이트 전용). 순서는 광고 해지 U9 선례: token.ts(사용자 14 생성 + 로그인 1회) → Host 주입. 이후 `testUser(14)`·`userClient(14)` 호출 금지(앱 세션이 끊긴다 — 정리는 `testUserId(14)`).

판정(전부 통과해야 `LNK-sim` 통과): G1 채팅 붙여넣기(정적 페이지) → "일정 1건" · G2 지연 JS(SPA) → "일정 1건" · G3 그림 전용 → OCR로 "일정 1건" · G4 제안 탭 추가 → EventKit 일정의 위치에 장소 · G5 이어받기(대기 행 → foreground → 보관함에 항목, 대기 행 0) · G6 주소 두 개 → 안내 + 입력 유지 · G7 스킴 없는 도메인 질문은 링크 턴이 아님 · G9 앱 로그에 주소·제목 없음. G8(Safari 공유 시트 자동화)은 선택 — 20분 안에 안 되면 "L9 D1로" 적고 판정에서 뺀다.

- [ ] **Step 1: 선행 확인·버전**

메인에게 창 밖임을 확인받는다(③b3·③c1·③c2). `gates.md`에 `LNK-eval` 통과가 있는지 본다. `pgrep -x deno`가 비어 있는지, `vm_stat | grep -E 'free|compressor'`를 본다.

Run: `git log --oneline -3 -- ios/project.yml && grep -n MARKETING_VERSION ios/project.yml`
Expected: `0.10.0`. 0.11.0 이상이 이미 있으면 멈추고 메인에게 알린다(D10).

`ios/project.yml`의 `MARKETING_VERSION: 0.10.0` → `MARKETING_VERSION: 0.11.0`.

```bash
git add ios/project.yml
git commit -m "chore(ios): 0.11.0 — link → event proposals (share sheet and chat paste, device rendering)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 2: 합성 페이지·로컬 서버**

`.context/gate0110/site/`에 만든다(합성, 커밋 안 함):

`wedding.html`:

```html
<!doctype html><html><head><meta charset="utf-8"><title>모바일 청첩장</title>
<meta property="og:title" content="합성신랑 ♥ 합성신부 결혼합니다">
<meta property="og:description" content="2026년 11월 14일 토요일 오후 1시 30분 합성웨딩홀 3층"></head>
<body><h1>초대합니다</h1><p>일시 2026년 11월 14일 토요일 오후 1시 30분</p><p>장소 합성웨딩홀 3층 그랜드볼룸</p><p>서울 합성구 합성로 123</p></body></html>
```

`wedding2.html`:

```html
<!doctype html><html><head><meta charset="utf-8"><title>합성민준 ♥ 합성서연 결혼합니다</title></head>
<body><p>2026년 11월 21일 토요일 오전 11시</p><p>합성 가든홀 2층</p></body></html>
```

`spa.html`:

```html
<!doctype html><html><head><meta charset="utf-8"><title>합성 북토크</title></head><body><div id="app">불러오는 중</div>
<script>setTimeout(() => { document.getElementById('app').innerHTML = '<p>합성 북토크 2026년 11월 21일(토) 오후 3시</p><p>합성도서관 강당</p>'; }, 1500);</script>
</body></html>
```

`image.html`(본문에 날짜가 없고 그림에만 있다):

```html
<!doctype html><html><head><meta charset="utf-8"><title>모바일 청첩장</title></head>
<body style="margin:0"><p>터치하면 음악이 재생됩니다</p><img src="card.svg" width="360"></body></html>
```

`card.svg`:

```xml
<svg xmlns="http://www.w3.org/2000/svg" width="360" height="240"><rect width="100%" height="100%" fill="white"/>
<text x="16" y="80" font-size="26" font-weight="bold">2026년 12월 5일 토요일 정오</text>
<text x="16" y="140" font-size="26" font-weight="bold">합성 컨벤션 웨딩홀</text></svg>
```

Run(백그라운드): `python3 -m http.server 8765 --bind 127.0.0.1 --directory .context/gate0110/site`
확인: `curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8765/wedding.html` → `200`.

- [ ] **Step 3: 시뮬레이터·로그인·권한**

전용 시뮬레이터를 만든다(이름 `Eruri-gate0110`, UDID는 `.context/gate0110/udid` — `ios/.sim-udid`가 아닌 새 기기). 

Run: `mkdir -p .context/gate0110 && deno run --allow-net --allow-env --allow-read --allow-write --env-file=supabase/.env .context/gate090/token.ts one 14 .context/gate0110/rt`
Expected: `user <id> rt written true`(토큰 값은 출력되지 않는다).

`GateHost.swift`(하네스)에 `test1_inject`(rt 경로 `.context/gate0110/rt`) 뒤로 더한다:

```swift
  // G5 이어받기: 확장이 넘긴 것과 같은 대기 행을 App Group 큐에 넣는다(lease 0 — 다음 foreground 가 가져간다)
  func test2_seedPendingLink() throws {
    let q = try CaptureQueue.shared()
    try q.enqueueLink(PendingLink(url: URL(string: "http://127.0.0.1:8765/wedding2.html")!, note: nil, origin: "share"), lease: 0)
    print("GATE: pending_links=\(try q.linkCount())")
  }

  func test3_pendingAfterDrain() throws {
    print("GATE: pending_links=\(try CaptureQueue.shared().linkCount())")
  }

  // G4: 제안 탭에서 추가한 11/14 일정의 위치(EventKit, 앱 프로세스 — 캘린더 권한은 simctl 로 준다)
  func test4_calendarLocation() throws {
    let store = EKEventStore()
    let from = ISO8601DateFormatter().date(from: "2026-11-14T00:00:00+09:00")!
    let evs = store.events(matching: store.predicateForEvents(withStart: from, end: from.addingTimeInterval(86_400), calendars: nil))
    let hit = evs.first { $0.url?.absoluteString.hasPrefix("assistant://proposal/") == true }
    print("GATE: marker_event=\(hit != nil) location_ok=\(hit?.location?.contains("합성웨딩홀") == true)")
  }
```

(파일 머리에 `import EventKit`·`import EruriCore`를 더한다.) `xcodegen --spec ios/project.gate0110.yml` 뒤 `test1_inject`를 돌린다(`GATE: injected=true`). 캘린더 권한: `xcrun simctl privacy $(cat .context/gate0110/udid) grant calendar com.picpal.eruri`.

- [ ] **Step 4: UI 게이트**

`ios/GateUITests/LinkGate.swift`(하네스 — 커밋 안 함):

```swift
import XCTest

final class LinkGate: XCTestCase {
  let app = XCUIApplication()
  override func setUp() { continueAfterFailure = true }
  func log(_ s: String) { print("GATE: \(s)") }
  var input: XCUIElement { app.textFields["질문하기"].exists ? app.textFields["질문하기"] : app.textViews.firstMatch }
  func send(_ s: String) { input.tap(); input.typeText(s); app.buttons["보내기"].tap() }
  func text(_ c: String) -> XCUIElement { app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", c)).firstMatch }
  var linkTurns: Int { app.staticTexts.matching(identifier: "chat-link-status").count }

  // G1 정적 페이지 → 링크 턴 → 서버 처리 결과
  func test1_G1_static() {
    app.launch(); app.tabBars.buttons["채팅"].tap()
    send("http://127.0.0.1:8765/wedding.html")
    log("G1 read=\(text("읽었어요").waitForExistence(timeout: 30))")
    log("G1 result=\(text("일정 1건을 찾았어요").waitForExistence(timeout: 120))")
  }

  // G4 제안 탭 → 캘린더에 추가(위치는 GateHost test4 가 본다)
  func test2_G4_add() {
    app.launch(); app.tabBars.buttons["제안"].tap()
    let add = app.buttons["캘린더에 추가"].firstMatch
    log("G4 row=\(add.waitForExistence(timeout: 20))")
    add.tap()
    log("G4 added=\(text("등록").waitForExistence(timeout: 15) || !app.buttons["캘린더에 추가"].exists)")
  }

  // G2 지연 JS · G3 그림 전용(OCR)
  func test3_G2_G3() {
    app.launch(); app.tabBars.buttons["채팅"].tap()
    send("http://127.0.0.1:8765/spa.html")
    log("G2 result=\(text("일정 1건을 찾았어요").waitForExistence(timeout: 120))")
    let before = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "일정 1건을 찾았어요")).count
    send("http://127.0.0.1:8765/image.html")
    let deadline = Date().addingTimeInterval(150)
    var after = before
    while Date() < deadline, after == before {
      sleep(3); after = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "일정 1건을 찾았어요")).count
    }
    log("G3 result=\(after > before)")
  }

  // G5 이어받기: GateHost test2 가 대기 행을 넣은 뒤 실행 — foreground 가 읽고 올린다
  func test4_G5_drain() {
    app.launch(); app.tabBars.buttons["보관함"].tap()
    log("G5 archived=\(text("합성민준 ♥ 합성서연").waitForExistence(timeout: 120))")
  }

  // G6 주소 두 개 · G7 스킴 없는 도메인은 질문
  func test5_G6_G7() {
    app.launch(); app.tabBars.buttons["채팅"].tap()
    let turns = linkTurns
    send("http://127.0.0.1:8765/a.html http://127.0.0.1:8765/b.html")
    log("G6 notice=\(text("링크는 한 번에 하나씩").waitForExistence(timeout: 10)) kept=\((input.value as? String)?.contains("a.html") == true)")
    input.tap(); input.typeText(XCUIKeyboardKey.delete.rawValue.repeated(80))   // 입력 비우기(남아 있는 것을 확인한 뒤)
    send("naver.com 에서 산 거 언제야?")
    sleep(20)
    log("G7 not_link=\(linkTurns == turns)")
  }
}

private extension String { func repeated(_ n: Int) -> String { String(repeating: self, count: n) } }
```

실행 순서(각각 `drive.sh LinkGate/<test>` 또는 `GateHostTests/GateHost/<test>`):
1. `LinkGate/test1_G1_static` → `GATE: G1 read=true`, `G1 result=true`
2. `LinkGate/test2_G4_add` → `G4 row=true added=true` → `GateHost/test4_calendarLocation` → `marker_event=true location_ok=true`
3. `LinkGate/test3_G2_G3` → `G2 result=true`, `G3 result=true`(G3 실패면 L3의 U4 판정과 대조해 원인을 적는다)
4. `GateHost/test2_seedPendingLink` → `pending_links=1` → `LinkGate/test4_G5_drain` → `G5 archived=true` → `GateHost/test3_pendingAfterDrain` → `pending_links=0`
5. `LinkGate/test5_G6_G7` → `G6 notice=true kept=true`, `G7 not_link=true`

각 단계 실패 시 스크린샷(`xcrun simctl io <udid> screenshot .context/gate0110/<g>.png`)을 남기고 원인을 적는다. U5(ATS)로 로드가 막히면(`G1 read=false`, 앱 로그 `link chat failed:load_failed`) 하네스 yml의 앱 Info.plist 설정에 `NSAppTransportSecurity: { NSAllowsLocalNetworking: true }`를 더해 다시 빌드하고 그 사실을 기록한다(제품 Info.plist는 바꾸지 않는다).

- [ ] **Step 5: (선택) G8 Safari 공유 시트**

20분 안에서만 시도한다: `XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")`로 `http://127.0.0.1:8765/wedding.html`을 열고 공유 → ERURI → `share-link-status`가 "읽었어요"를 포함하는지. 공유 시트 자동화가 안 되면 "G8: L9 D1로"만 적는다(판정에서 뺀다).

- [ ] **Step 6: G9 로그 개인정보**

Run: `cd ios && UDID=$(cat ../.context/gate0110/udid) && tail -200 "$(xcrun simctl get_app_container "$UDID" com.picpal.eruri group.com.picpal.eruri)/eruri.log" | grep -c -E '127\.0\.0\.1|wedding|spa\.html|합성신랑|합성웨딩홀'`
Expected: `0`. 같은 로그에 `link chat queued`·`link drain queued`가 있다.

- [ ] **Step 7: 정리**

`.context/gate0110/cleanup.ts`(커밋 안 함):

```ts
// LNK-sim 정리: 게이트 전용 테스트 사용자 14 의 링크 항목과 그 파생 행만 지운다(AGENTS.md §7). 출력은 개수만
import { service as sb, testUserId } from "../../supabase/tests/_testenv.ts";
const u = await testUserId(14);
const { data } = await sb.from("items").select("id").eq("user_id", u).eq("source", "SHARE").eq("app_name", "웹 링크");
const ids = (data ?? []).map((r) => r.id as string);
if (ids.length) {
  await sb.from("facts").delete().eq("user_id", u).in("item_id", ids);
  await sb.from("jobs").delete().eq("user_id", u).in("payload->>item_id", ids);
  await sb.from("items").delete().eq("user_id", u).in("id", ids);
}
await sb.from("jobs").delete().eq("user_id", u).eq("kind", "notify");
await sb.from("executions").delete().eq("user_id", u);
await sb.from("devices").delete().eq("user_id", u);
await sb.from("usage_counters").delete().eq("user_id", u);
await sb.from("llm_slots").delete().eq("user_id", u);
console.log(JSON.stringify({ deleted_items: ids.length }));
```

Run: `deno run --allow-net --allow-env --allow-read --env-file=supabase/.env .context/gate0110/cleanup.ts` → `{"deleted_items":5}`(G1·G2·G3·G5 = 4 + G8을 했으면 5). 로컬 서버를 끄고(백그라운드 작업 종료), 시뮬레이터 `Eruri-gate0110`을 지우고(`xcrun simctl delete`), 하네스 파일(`ios/project.gate0110.yml`·`ios/EruriGate.xcodeproj`·`ios/GateHostTests/`·`ios/GateUITests/`·`ios/build-gate/`)을 지운다. `git status --short`에 하네스가 남지 않았는지 본다.

- [ ] **Step 8: 기록·커밋**

`docs/superpowers/phase1/gates.md` 끝에 행을 더한다:

```text
| LNK-sim | 0.11.0 시뮬레이터(테스트 사용자 14, 로컬 합성 페이지): G1 채팅 붙여넣기 정적 → 일정 1건 · G2 지연 JS → 일정 1건 · G3 그림 전용 OCR → 일정 1건 · G4 제안 탭 추가 → EventKit 위치 · G5 대기 행 이어받기 → 보관함·행 0 · G6 주소 두 개 안내·입력 유지 · G7 도메인 질문은 링크 턴 아님 · G9 로그에 주소·제목 없음 (G8 Safari 공유 시트: 선택) | 통과 또는 실패 | <시각 KST>, HEAD <sha>, 전용 시뮬레이터(이름·iOS), 단계별 GATE 줄 요약, U2·U4·U5 판정 | | <날짜> |
```

```bash
git add docs/superpowers/phase1/gates.md
git commit -m "docs(gates): LNK-sim — 0.11.0 link reading on the simulator (chat paste static/SPA/image-only OCR, EventKit location, pending-row hand-off, two-URL notice, domain question unaffected, no address in logs)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task L9: TestFlight 0.11.0 + 실기기 게이트 `LNK-device` (U6b 뒤)

**Files:**
- Modify: `docs/superpowers/phase1/gates.md`(행 `LNK-device`)
- (실패 시) Modify: `ios/Packages/EruriCore/Sources/EruriCore/LinkFlow.swift`(`renderInShareExtension = false`), `ios/project.yml`(0.11.1), 스펙 §6·§16

**Interfaces:**
- Consumes: L8 통과, `gates.md`의 0.10.0 TestFlight 기록(광고 해지 U6b, D11), `ios/scripts/testflight.sh`.
- 사용자가 실기기에서 조작한다. 에이전트는 메타만 본다: `device_traces`의 `share.link`(필드 origin·result·code·elapsed_ms·chars·ocr·timed_out·blocked_nav), 실사용자(`ERURI_USER_ID`) `items`의 `app_name = '웹 링크'` 행의 `id·status·gate_label`과 그 `facts` 종류·개수. 본문·제목·주소는 보지 않는다(AGENTS.md §7).

판정(`LNK-device` 통과 = D1·D3·D4·D5 모두): D1 실제 공유 시트에서 확장이 페이지를 읽고(결과 `queued` 또는 `handed_off:no_date`) 확장이 죽지 않음 · D3 채팅 붙여넣기 결과 줄 · D4 읽는 중 [닫기] → 앱 열기 → 이어받기 `queued` · D5 제안 탭 추가 → 캘린더 일정에 위치. D2(실기기 그림 청첩장 OCR)는 사용자에게 그림 전용 링크가 있을 때만 — 없으면 별도 행 `LNK-ocr-device` "대기"로 두고 첫 실제 그림 청첩장 때 판정한다(시뮬레이터 G3가 같은 API를 이미 통과).

- [ ] **Step 1: 선행 확인·업로드**

`gates.md`에서 `LNK-sim` 통과와 0.10.0 TestFlight(U6b) 기록을 확인한다. 없으면 멈춘다(D11).

Run: `cd ios && ./scripts/sim.sh gen && ./scripts/testflight.sh`
Expected: `Upload succeeded`, 빌드 `0.11.0 (<yyyymmddHHMM>)`. App Store Connect에서 `VALID`가 되면 사용자에게 설치를 요청한다.

- [ ] **Step 2: 사용자 세션(메인이 안내)**

사용자에게 순서대로 부탁한다(문구는 메인이 다듬는다):
1. **D1**: Safari 또는 카카오톡 인앱 브라우저에서 실제 청첩장·초대장·행사 페이지를 열고 공유 → ERURI. 시트에 "링크를 읽는 중…" 뒤 결과 문구가 보이는지, 시트가 갑자기 사라지지 않는지.
2. **D3**: 같은(또는 다른) 링크를 ERURI 채팅창에 붙여넣고 보내기. 링크 턴의 결과 줄.
3. **D4**: 다른 링크를 공유한 뒤 "링크를 읽는 중…"일 때 바로 [닫기] → ERURI 앱 열기.
4. **D5**: "제안" 탭에서 그 일정 "캘린더에 추가" → 캘린더 앱에서 일정의 위치가 보이는지.
5. (있으면) **D2**: 글 없이 그림만 있는 청첩장 링크를 채팅에 붙여넣기.

- [ ] **Step 3: 메타 확인**

Run: `deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/sql.ts "select at, fields->>'origin' o, fields->>'result' r, fields->>'code' c, fields->>'elapsed_ms' ms, fields->>'chars' n, fields->>'ocr' ocr, fields->>'blocked_nav' b from device_traces where user_id = \$1 and event = 'share.link' and at > now() - interval '2 hours' order by at" "$ERURI_USER_ID"`
(먼저 `ERURI_USER_ID=$(grep '^ERURI_USER_ID=' supabase/.env | cut -d= -f2-)` — `.env`를 `source`하지 않는다. `device_traces` 열 이름이 다르면 `select column_name from information_schema.columns where table_name = 'device_traces'`로 확인해 바꾼다.)
Expected: D1 `o=share r=queued`(또는 `handed_off c=no_date`), D3 `o=chat r=queued`, D4 `o=share r=handed_off c=cancelled` 다음 `o=drain r=queued`.

Run: `deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/sql.ts "select i.id, i.status, i.gate_label, count(f.id) filter (where f.kind = 'event') events from items i left join facts f on f.item_id = i.id and f.status = 'active' where i.user_id = \$1 and i.app_name = '웹 링크' and i.captured_at > now() - interval '2 hours' group by i.id order by i.captured_at" "$ERURI_USER_ID"`
Expected: D1·D3·D4 항목이 `extracted`(일정 ≥ 1) 또는 `discarded:server:empty`(그 페이지에 일정이 없을 때 — 사용자에게 페이지에 날짜가 있었는지 묻는다). D5는 사용자 확인.

- [ ] **Step 4: D1 실패면 대안(U1·U3)**

확장이 결과 없이 닫히거나(`share.link` trace 없음 + 대기 행이 남아 앱 열기 때 `o=drain`), 시트가 멈추면: `LinkFlow.renderInShareExtension = false`, `MARKETING_VERSION: 0.11.1`, 스펙 §6 "실기기 미확인" 문단을 "확장은 대기 행만 남기고 '앱을 열면 읽어요'"로 고치고 §16에 판정을 적는다. 다시 업로드 → D1'(공유 → 시트 "앱을 열면 다시 읽어요" → 앱 열기 → `o=drain r=queued`). `LNK-device`는 "실패(대안 채택)"로 기록한다(AGENTS.md §5-8).

- [ ] **Step 5: 기록·커밋**

`docs/superpowers/phase1/gates.md` 끝에 행을 더한다(D2가 없으면 `LNK-ocr-device` 대기 행도):

```text
| LNK-device | 0.11.0 실기기: D1 실제 공유 시트에서 확장 읽기(queued/handed_off:no_date, 확장 생존) · D3 채팅 붙여넣기 결과 줄 · D4 [닫기] → 앱 이어받기 queued · D5 캘린더 위치 | 통과 / 실패(대안 채택) | <시각 KST>, 빌드 0.11.0 (<번호>), trace 메타(origin·result·code·elapsed_ms·chars·ocr·blocked_nav), items 상태·일정 수(본문·주소 없음), U1·U3 판정 | | <날짜> |
| LNK-ocr-device | 실기기 그림 전용 청첩장 OCR(앱, 15초) → 일정 | 대기 | 사용자에게 그림 전용 링크가 생기면 D2로 판정(시뮬레이터 G3 통과) | | <날짜> |
```

```bash
git add docs/superpowers/phase1/gates.md
git commit -m "docs(gates): LNK-device — 0.11.0 on device (share-sheet rendering in the extension, chat paste, close-then-open hand-off, calendar location)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

## 자체 점검 (계획 작성 뒤, 2026-10-02)

1. **스펙·사용자 결정 대비:** LD1(공유·채팅 둘 다) → L4·L5. LD2(기기 렌더링, 서버 URL 가져오기 없음, 기존 추출 경로) → L1~L5, 서버 무변경(Global Constraints), 이미지 전용은 D4(앱 OCR — 제품에 이미지 업로드 경로가 없음, F2). LD3(저장) → D3 + UQ1·UQ2, 스펙 §12 문구(L0 Step 11). §15 후보의 "장소는 주소 그대로 일정 위치에" → D9·L6. "JS 렌더링 전용 페이지는 실패" → 방식 A로 해소(렌더링). "링크 가져오기 계층은 여행 글 후보와 공유" → D12·L0 Step 12. 버전 → D10·L0 Step 10·14·L8 Step 1. 측정 창 → Global Constraints·L7 Step 4·L8 Step 1.
2. **확인할 것 목록 대비:** ShareExtension 구조·받는 타입(F1), 업로드 경로(F3), 채팅 입력과 링크 판정(D5·F18), 확장 WKWebView·메모리(U1·U3 — 공식 문서 없음, 실기기 게이트로 흡수), 앱으로 넘기기(F12 — 지원 경로 없음 → 대기 행 + foreground), 렌더링 대기(F15·D6), 흔한 형태(합성 픽스처 L3 7종 + L8 페이지 4종, 실제 서비스는 U6 — L9), 서버 최소화(D2 — 새 source·마이그레이션·배포 없음, F6), 개인정보(§12 문구·로그 규칙·G9), 버전 충돌(D10), 게이트(L7 서버 평가·L8 시뮬레이터·L9 실기기 필수만).
3. **자리표시 검사:** 코드 단계는 전부 실제 코드. 게이트 기록 행의 `<시각>`·`<sha>`는 실행 때 채우는 값이다(계획 단계에서 알 수 없음).
4. **이름·타입 일관성:** `LinkText.chatIntent`·`shareLink`·`check`·`hasDateCandidate`·`compose`(L1) ↔ L2·L4·L5 사용처, `PendingLink(url:note:origin:capturedAt:)`·`id`·`captureID`(L2) ↔ L4·L5·L8 GateHost, `LinkFlow.share(_:renderer:queue:render:)`·`app(_:renderer:queue:)`·`traceFields(_:origin:elapsedMs:blockedNav:)`·`code(_:)`(L2) ↔ L4·L5, `LinkRenderer(host:allowLoopback:html:)`·`blockedNavigations`(L3) ↔ L4·L5, `LinkCaptureText.reading`·`share`·`chat`·`chatResult(status:gateLabel:kinds:)`·`pending`·`tooMany`·`drainFailedTitle`·`drainFailedBody`(L2) ↔ L4·L5, `ProposalReview.place`(L6) ↔ `ScheduleCard`·`NotificationActions`, `CaptureQueue.enqueueLink`·`releaseLink`·`claimLinks`·`linkCount`(L2) ↔ L5·L8. 접근성 id `chat-link-status`(L5) ↔ L8, `share-link-status`·`share-link-close`(L4) ↔ L9.
5. **Review Focus 대비:** 1 → L1 `testSettleDeadline`·L3 `testNeverSettlingPageReturnsPartial`. 2 → L1 `testBodyPrefersHiddenTextWhenOnlyItHasDate`·L3 `testHiddenCoverTextIsRead`. 3 → L2 `testShareWithoutDateHandsOff`·L3 `testImageOnlyPageUsesOCR`·L7 `wedding-ocr`·L8 G3. 4 → L2 `testExtensionDeathHandsOffAfterLease`·`testFinishTwiceKeepsOneCapture`·L8 G5·L9 D4. 5 → L3 `testAppSchemeNavigationIsBlockedAndPageStillRead`. 6 → L1 `testComposeKeepsHostOnly`·L2 `testQueryDigitsDoNotDiscard`. 7 → L1 `testChatIntent`·L8 G6·G7. 8 → L2 `testTraceFieldsHaveNoURLOrText`·L2 `testReasonsCarryNoAddress`·L8 G9.
6. **남은 위험(계획이 감수):** 확장이 넣은 항목의 업로드는 다음 flush까지 늦을 수 있다(지금 공유와 같음, F3). 서버 규칙만의 폐기(`(광고)` 표기 — 204)는 채팅 턴에서 "아직 처리 중"으로 끝난다(항목이 생기지 않아 구분 불가, 드묾). 잠금화면 추가에는 위치가 없다(D9). 보관함에서 원래 링크를 다시 열 수 없다(UQ2).
