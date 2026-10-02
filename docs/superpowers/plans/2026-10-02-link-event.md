# ERURI 0.11.0 링크·이미지 → 일정 제안(청첩장·초대장·행사 페이지) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**개정 2026-10-02(리뷰 반영):** 초판 `9273791`에 Codex(HIGH 3·MED 6)·Fable(C1~C9 판정 + F1~F12 + 이미지 입력 LI1~LI5) 리뷰와 메인 판정(UQ1 기본값 유지 + 저장 범위 문구, 같은 링크 재입력 = 중복, 이미지 입력 0.11.0 포함)을 반영했다. 번호별 반영 위치는 끝의 "리뷰 반영" 절, 스펙 기록은 §16 "외부 리뷰 반영 (링크 → 일정 계획 …)".

## 태스크 ID 표

| ID | 태스크 | 선행 | 시점·Gmail 측정 창 | 게이트 행 |
|---|---|---|---|---|
| L0 | 스펙 §2·§5·§6(새 소절 "링크·이미지 읽기", 공유 확장 이미지 문단)·§7·§8·§9·§10·§11·§12·§15·§16 + 보관 계획 R-B9 0.11.0 → 0.12.0 | 이 계획 커밋 | 무관(문서) | — |
| L1 | EruriCore `LinkText`(판정 — 긴 글·날짜 있는 글은 링크 아님, 주소 검사, https 올리기, 같은 링크 id, 날짜 후보, 본문 — 일시·장소 줄을 앞에) · `LinkPage` · `LinkSettle`(글 0자 완료) · `ImageText`(LI1) | L0 | 무관(로컬) | — |
| L2 | 큐 링크 대기 행(`kind = 'link'`, 7일 만료, 시도 수) + 읽은 링크 기록(`link_seen`, 30일) + `CapturePipeline.handleRead` + `LinkFlow`(관문: 중복·메모 규칙 → 확장·앱 흐름, 재시도/확정 실패 구분) + `ImageFlow`(LI3) + `LinkCaptureText`(링크·이미지 문구) | L1 | 무관(로컬) | — |
| L3 | `LinkRenderer`(WKWebView, 창 안·화면 밑, 독립 기한 경주, 하위 프레임 검사 + 콘텐츠 규칙, https 올리기, 글 0자 → OCR) + `OCR.recognize(image:)`·`recognize(data:maxPixel:)`(LI2) + `ShareImages` + 합성 HTML·루프백 서버 테스트(시뮬레이터) | L2 | 무관(로컬 시뮬레이터) | — |
| L4 | 공유 확장: 링크 경로·상태 화면([닫기] 즉시)·확정 실패 시 텍스트 폴백 + 이미지 공유(LI4, 활성화 규칙 `public.image`) | L3 | 무관(빌드) | — |
| L5 | 앱: 대기 링크 이어받기(foreground 반복·비활성 전환 시 취소·행 유지) + 채팅 붙여넣기(링크 턴·결과 폴링·중복 문구) + 채팅 사진 첨부(LI5, `PhotosPicker`) + "공유한 링크"·"공유한 이미지" 출처 | L4(순서대로 — 같은 프로젝트·`ios/build`·`.sim-udid`) | 무관(빌드·단위 테스트) | — |
| L6 | 일정 위치 — 제안 `location` → EventKit `location` | L0 | 무관 | — |
| L7 | 서버 추출 평가 `LNK-eval` — 합성 본문 13종(링크 10·이미지 3) × 3회를 **배포된** worker(테스트 lease)에 넣어 게이트·추출 비교. 배포 없음 | L1 | **③c1·③c2 창 밖** | `LNK-eval` |
| L8 | 0.11.0 + 시뮬레이터 게이트 `LNK-sim`(채팅 붙여넣기·이어받기·실패 알림·**Safari 공유 시트(필수)**·사진 공유·채팅 사진·같은 링크 중복, 로컬 합성 페이지) | L4·L5·L6·L7 | **③c1·③c2 창 밖** | `LNK-sim` |
| L9 | TestFlight 0.11.0 + 실기기 게이트 `LNK-device`(실제 공유 시트·채팅·캘린더 위치·같은 링크 중복·사진 공유) | L8 + **0.10.0 TestFlight 기록(광고 해지 계획 U6b)** | ③c2 뒤(U6b 뒤) | `LNK-device` |

순서: L0 → L1 → L2 → L3 → L4 → L5(L6은 L0 뒤 언제든, L5와 `ScheduleCard.swift`가 겹치므로 같은 pane에서 순서대로) → L7(L1 뒤 언제든, 창 밖) → L8 → [0.10.0 TestFlight] → L9. **서버 코드·마이그레이션·함수 배포가 없다** — Gmail 측정(③c2 ≈ 10-08) 동안 워커·gmail 함수를 배포하지 않는다는 조건은 그대로이고, 이 계획에는 배포할 것이 없다. 배포된 함수를 *호출*하는 L7·L8만 측정 창(③c1·③c2)을 피한다.

**Goal:** 청첩장·초대장·행사 페이지 링크를 ① 공유 시트로 공유하거나 ② 채팅창에 붙여넣으면 **기기가 페이지를 보이지 않는 웹뷰로 렌더링해** 글(제목·OG 설명·본문, 날짜가 없거나 글이 없으면 화면 OCR)을 읽고, 청첩장·초대장 **사진**을 ③ 공유 시트로 공유하거나 ④ 채팅 "+"로 첨부하면 **기기 Vision OCR**로 글을 읽어, 기존 SHARE 수집 경로로 보내 서버의 기존 분류·추출·제안·겹침·묶음 알림(§7·§10)이 일정 제안을 만든다. 서버는 외부 URL을 가져오지 않고 이미지를 받지 않는다.

**Architecture:** EruriCore에 순수 로직(`LinkText` — 판정·주소 검사·같은 링크 id·본문 만들기, `LinkSettle` — 대기 판정, `ImageText` — 사진 OCR 본문)과 WebKit·Vision(`LinkRenderer` — WKWebView를 창 안 다른 화면 밑에 붙여 JS로 글을 읽고 필요하면 화면 스냅샷을 OCR, 내부 작업과 독립 기한을 경주시켜 멈춘 페이지에서도 정해진 시간에 돌아온다 / `OCR` / `ShareImages`)를 두고, 공유 확장과 앱이 같은 `LinkFlow`·`ImageFlow`를 쓴다. 링크는 관문(이미 읽은 링크면 중복, 메모가 기기 규칙에 걸리면 폐기 — 둘 다 행을 만들지 않는다)을 지나 App Group 큐에 **링크 대기 행**을 남긴 뒤 읽는다(확장이 죽거나 시간이 모자라면 앱이 다음 foreground에 이어받는다 — 확장은 앱을 열 수 없다). 확장은 10초(+추출 2초) 안에 글을 읽어 SHARE 큐 항목(`app_name = "웹 링크"`)을 넣고, 날짜 후보가 없으면(이미지 전용 청첩장) 앱이 15초 + OCR로 다시 읽는다. 큐 항목 id는 **주소에서 정해진다**(같은 링크 = 같은 id)라 다시 읽어도 큐·서버 멱등 키(`SHARE:<id>`)가 한 건이고, 기기의 "읽은 링크" 기록(30일)이 재입력을 "이미 읽은 링크예요"로 돌린다. 사진은 파일을 어디에도 저장하지 않고 그 자리에서 축소본(긴 변 2,048px)을 OCR해 SHARE 항목(`app_name = "이미지"`)으로 넣는다. 서버·DB는 그대로다.

**Tech Stack:** SwiftUI iOS 26 앱 `Eruri` + Share Extension + Swift Package `EruriCore`(XCTest, Swift 6), WebKit(`WKWebView`, `callAsyncJavaScript`, `takeSnapshot`, `WKContentRuleList`), Vision(`VNRecognizeTextRequest` ko-KR accurate), ImageIO(축소·방향), PhotosUI(`PhotosPicker`), Network(테스트 루프백 서버), App Group SQLite 큐, xcodegen `ios/project.yml`, XCUITest(게이트 전용 임시 타깃), Deno 평가 스크립트(배포된 Edge `worker` 호출), TestFlight(`ios/scripts/testflight.sh`).

**Spec:** `docs/superpowers/specs/2026-09-22-assistant-design.md` — L0이 §15 후보 문단("링크 → 일정 제안", 커밋 `61f44d4`)을 아래 사용자 결정·메인 판정으로 바꿔 본문(§2·§5·§6·§7·§8·§9·§10·§11·§12·§15·§16)에 올린다. 리뷰 판정 기록은 이 계획 커밋에서 §16 "외부 리뷰 반영 (링크 → 일정 계획, Codex gpt-6-astra · Fable, 2026-10-02)"에 먼저 넣었다(선례: 광고 해지 계획 `c586a1a`). 실행 규칙은 `AGENTS.md` §3(모델)·§5-8(실측 게이트)·§6(기계)·§7(개인정보)·§8(버전).

**출발점:** main `74d752d` 위(이 개정 커밋 포함). 앱 `MARKETING_VERSION: 0.10.0`(광고 구독 해지, TestFlight는 U6b — ③c2 뒤), 서버 `0001`~`0028` 적용(`0029`는 `migrations-pending/`). Gmail 게이트 측정 중(③c1 ≈ 10-07, ③c2 ≈ 10-08 15시 이후). 보관 계획 트랙 B(R-B1~R-B9)는 ③c2 뒤.

**원장:** `.superpowers/sdd/2026-10-02-link-event/progress.md`(상위 원장 `.superpowers/sdd/2026-09-30-phase1/progress.md`의 Rulings 승계).

## 사용자 결정 (2026-10-02, 이 계획의 원본)

| # | 결정 | 이 계획에서 |
|---|---|---|
| LD1 | 입력: ① 공유 시트로 링크 공유 ② 채팅창에 링크 붙여넣기 — **둘 다** | L4(공유)·L5(채팅) |
| LD2 | **방식 A — 앱(기기)이 페이지를 렌더링해 읽는다.** 보이지 않는 WKWebView로 URL을 열고 렌더링된 텍스트·OG 메타·(필요 시) 주요 이미지를 얻어 서버의 기존 수집·일정 추출 경로(§7 extract·save_facts·§10 제안·겹침·묶음 알림)로 보낸다. **서버는 외부 URL을 가져오지 않는다(SSRF 없음).** 이미지 전용 청첩장 처리는 계획에서 결정 | L1~L5, 이미지 전용은 D4 |
| LD3 | 원문 전체 저장 안 함 원칙(§15 후보 문단) — "추출 결과·링크만" 또는 "기존 항목처럼 암호화 저장"을 §7·§12 규칙과 맞춰 계획에서 결정·명시, 사용자 판단이 필요하면 표로 | D3 + 메인 판정 MR1 |
| LD4 | (2026-10-02 20:5x 추가) **이미지 공유·채팅 사진 첨부도 인식** — 기기 Vision OCR → 같은 텍스트 경로, **서버 업로드 없음**. 실제 청첩장 링크는 사용자가 갖고 있다(L9에서 요청) | D13, L1~L5(LI1~LI5), L7·L8·L9 게이트 |

## 메인 판정 (2026-10-02, 사용자 위임 범위 — 원장 Ruling)

| # | 판정 | 이 계획에서 |
|---|---|---|
| MR1 | UQ1 저장 범위는 **기본값 A 유지**(기존 항목처럼 발췌 ≤4,000자 암호화 3년 + 요약·청크). 단 "짧은 페이지는 보이는 글 전체가 저장된다(이름·전화번호 포함, 계좌·카드 번호는 마스킹)"를 **스펙과 화면에 명시**한다 | D3, L0 Step 5·11·13, `LinkCaptureText.storageNote`(확장 상태 화면·채팅 링크·사진 턴) |
| MR2 | **같은 링크 재입력 = 멱등 중복**: 다시 읽지 않고 "이미 읽은 링크예요. 제안 탭에서 확인해 주세요" | D14, L1 `captureID(for:)`, L2 `link_seen`·`LinkFlow.admit`, L8 G12, L9 D3b |
| MR3 | 이미지 입력(공유 시트 이미지·채팅 `PhotosPicker`, 기기 Vision OCR, 파일 비저장, 서버 업로드 없음)을 **0.11.0에 포함**(Fable 안) | D13, LI1~LI5 |
| MR4 | 나머지 리뷰 충돌은 Fable 판정을 따른다 | "리뷰 반영" 절 |

## 계획이 정한 것 (사용자 결정이 열어 둔 항목)

| # | 항목 | 결정 | 이유 |
|---|---|---|---|
| D1 | 렌더링 위치·이어받기 | **공유 확장(10초, OCR 없음) + 앱(15초, OCR)**, 각각 추출 2초·OCR 8초를 더한 **절대 상한**(확장 12초·앱 25초)에서 렌더러가 무조건 돌아온다(D15). 확장은 관문(D14) 뒤 렌더링 **전에** App Group 큐에 링크 대기 행(lease 60초)을 남긴다. 성공하면 SHARE 큐 항목을 넣고 행을 지운다. 시간 초과·로드 실패·웹 프로세스 종료·날짜 후보 없음·글 0자면 행을 앱에 넘기고(lease 즉시 만료) 시트에 "앱을 열면 다시 읽어요"를 보인다. 확장이 죽으면 60초 뒤 앱이 이어받는다. 앱은 **foreground일 때만** 대기 행을 처리하고, 남은 행이 있으면 활성 상태 동안 다음 시도 시각(lease·백오프)에 맞춰 반복한다(2분 안의 것만). 앱의 실패는 **재시도 가능**(timeout·load_failed·web_process·no_host·extract_failed — 백오프 30초×2ⁿ, 3회째에 삭제)과 **확정**(blocked_*·http_<n>·unsupported·redirects·insecure·OCR 뒤 empty — 바로 삭제)으로 나누고, 읽는 중 앱이 비활성으로 가면 작업을 취소하고 행을 그대로 돌려놓는다(시도 수 증가 없음). 대기 행은 **7일 지나면 지운다**. 확장 렌더링은 `LinkFlow.renderInShareExtension` 한 값으로 끈다(실기기 D1 실패 시 대안) | 확장에서 앱을 여는 공식 방법이 없다(F12). 확장 안 WKWebView는 공식 근거가 없어(U1 — 시뮬레이터 L8 G8에서 판정) 실패해도 같은 대기 행 경로가 남게 한다. 백그라운드에서는 WebKit이 멈추므로(F13) 백그라운드 렌더링은 하지 않는다. 읽는 중 앱을 떠났다고 정상 링크가 지워지고 실패 알림이 가면 안 된다(Fable C4) |
| D2 | 서버 경로 | **source `SHARE` 재사용**, 링크 `app_name = "웹 링크"`·`title` = 페이지 제목(og:title, 없으면 `document.title`, 120자, 규칙 마스킹), 사진 `app_name = "이미지"`·제목 없음. **새 source·마이그레이션·Edge 변경·배포 없음** | 새 source는 `items.source` check 제약(F6)·ingest `SOURCES`·앱 출처 표시·채팅 필터를 모두 바꾸고 배포가 필요하다. SHARE는 규칙 → Jev 게이트 → 추출 → 제안 → 알림이 이미 같다(F5·F7) |
| D3 | 저장(LD3·MR1) | **기존 항목 규칙 그대로**: 큐 항목 본문 = 모델이 보는 발췌(머리 줄 + 일시·장소 줄 + 본문 + OCR, **최대 4,000자** — 서버 추출 입력 상한과 같음)를 서버가 사용자 키로 암호화해 3년 보관, 요약(영구)·청크(§8)도 같다. **짧은 페이지는 4,000자 안에 보이는 글 전체가 들어간다**(혼주 이름·전화번호 포함 — 계좌·카드 번호는 기기·서버 규칙이 마스킹) — 화면에 한 줄로 알린다(`LinkCaptureText.storageNote`). 페이지 전체·이미지·스냅샷·사진 파일은 어디에도 저장하지 않는다(기기 메모리에서만). 주소는 **호스트만** 본문 첫 줄 `[웹 링크] <호스트>`에 둔다(경로·쿼리·조각 없음). 기기 대기 행에는 전체 주소와 (규칙을 거친) 메모가 최대 7일 남는다(이어받기에 필요, 기기 밖으로 나가지 않음, 계정 삭제 때 `LocalWipe`가 큐 파일을 지운다) | 기존 §7·§12 규칙과 같아 서버 변경이 없고, "청첩장 장소 어디였지" 검색이 된다. 쿼리의 숫자(`?code=482913`)는 OTP 규칙(키워드 `code` + 숫자)에 걸려 **항목 전체가 폐기**되고(F9), 초대 토큰은 개인 식별자다. "발췌"라는 말만으로는 짧은 페이지의 전문 저장을 감출 수 있어(Codex 3) 문구로 명시한다 |
| D4 | 이미지 전용 청첩장(링크) | **앱 OCR**: 앱이 읽은 글(제목·설명·본문)에 날짜 후보가 없거나 **글이 0자**면 웹뷰 화면을 최대 3화면 스냅샷(너비 390pt — 3배율 기기 1,170px) → Vision(ko-KR·en-US, accurate) → `이미지 속 글자:` 블록(1,500자). 글 0자 페이지도 `didFinish` 뒤 4초가 지나면 완료로 보고 OCR로 간다. 확장에서는 OCR하지 않고(메모리 한도 미확인, U3) 앱에 넘긴다. 서버 vision 경로는 쓰지 않는다 | 제품에는 서버 이미지 수집 경로가 없다(F2, 스펙 §15 2단계). 순수 이미지 페이지가 OCR 전에 `empty`로 끝나 지워지면 핵심 사례를 놓친다(Codex 1) |
| D5 | 링크 판정 | 공유 본문·채팅 입력에 `http://`·`https://`로 적힌 주소가 **정확히 1개**이고, 주소를 뺀 나머지 글이 **200자 이하이며 날짜 후보가 없을 때만** 링크(나머지 글은 메모). 그 밖은 지금처럼 텍스트 공유(공유)·질문(채팅). 주소가 **2개 이상**이면 공유는 텍스트, 채팅은 "링크는 한 번에 하나씩 보내 주세요". 스킴 없는 도메인("naver.com")은 링크가 아니다. 주소 바로 뒤에 붙은 비 ASCII 글자("…/1이에요")는 주소에서 뗀다(한글 경로 주소는 링크로 보지 않는 대가). 클립보드를 앱이 읽지 않는다 | 주소 1개가 든 긴 공지·일정 문자를 링크로 바꾸면 본문이 200자 메모로 잘리고 페이지 실패 시 통째로 사라진다(Fable F1 — 기존 기능 회귀). 서버 chat은 URL을 읽지 못하므로 짧은 "청첩장 https://…"는 수집이 맞다. 프로그램으로 붙여넣기를 읽으면 iOS 16+가 허용 창을 띄운다(F14) |
| D6 | 렌더링 대기 | `didFinish`(오지 않으면 로드 시작 4초) 뒤 `innerText` 길이를 0.5초마다 재서 **3번 같으면 완료** — `didFinish` 전 샘플은 세지 않는다(고정 "로딩 중…" 글에서 끝내지 않게). 글 0자는 **`didFinish` 뒤** 4초가 지났을 때만 완료(SPA가 그릴 시간, 늦은 `didFinish`도 그 뒤 4초 — 스펙 §6 "대기", L0L1 리뷰 I2). 예산(확장 10초·앱 15초)이 끝나면 그때까지 읽은 글로 진행(`timedOut`) — 0자여도 추출(OG 메타)·OCR로 간다. 커밋도 못 했으면 `timeout` | WebKit에 network idle API가 없고 `didFinish`는 XHR·fetch 완료를 뜻하지 않는다(F15) |
| D7 | 웹뷰 설정 | 비영속 저장소(쿠키·로그인 없음), 미디어 자동 재생 금지, 새 창·앱 스킴 이동 차단(읽기는 계속), 메인 프레임 이동 6회(리다이렉트 5회) 초과·`NSURLErrorHTTPTooManyRedirects`는 `redirects`, 다운로드 취소, HTTP 4xx·5xx·표시 불가 MIME 실패. 주소 검사(메인·**하위 프레임** 모두): http(s)만, 사설·루프백·링크로컬·CGNAT IP 리터럴·`.local`·점 없는 호스트 거부. **하위 리소스(img·fetch·XHR·iframe)는 `WKContentRuleList`로 사설 IP 리터럴·`localhost`·`.local` 요청을 막는다**(DEBUG 빌드만 루프백 허용 — 시뮬레이터 게이트). 공개 이름이 사설 주소로 풀리는 경우는 막지 않는다. **`http://`는 `https://`로 올려 연다**(앱·확장에 ATS 예외가 없어 공개 http 로드는 막힌다 — F24). 올린 https가 TLS·연결 거부로 실패하면 `insecure`("보안 연결(https)이 안 되는 페이지예요"). ATS 예외는 넣지 않는다. 웹뷰는 실제 화면 크기(390×844pt)로 **창 안, 다른 화면 밑**에 붙인다 | 로컬 네트워크 권한 창·내부 기기 접근을 피한다(서버 SSRF가 아니라 기기 위생). 위임 메서드는 하위 리소스를 거치지 않아(Codex 6) 콘텐츠 규칙이 필요하다. 평문 로드를 열 이유가 약하다(Fable F3) |
| D8 | 결과를 사용자에게 | 확장: 시트 안 문구(읽는 중 → 결과 + 저장 범위 한 줄, 1.5초 뒤 닫힘 또는 [닫기] — **[닫기]는 결과를 기다리지 않고 즉시 닫는다**). 채팅: 링크 턴 문구 → 직접 업로드 → 처리 결과 폴링(3초 간격, 60초). 앱 이어받기 **확정 실패·3회 실패**만 로컬 알림 1건(주소·제목 없이, foreground 배너 — F25). 확장에서 링크가 확정 실패하면 **원래 공유 글을 지금처럼 텍스트 항목으로 넣는다**(주소만 공유했으면 주소 문자열 항목 — 0.10.0과 같다) | 확장·채팅은 사용자가 보고 있다. 이어받기는 사용자가 다른 화면에 있을 수 있다. 확정 실패로 공유 자체가 사라지면 안 된다(Fable F1) |
| D9 | 일정 위치 | 제안 payload `location`(추출 결과, F11) → EventKit `location`(문자열). 경로: 제안 탭 행·배너 탭 시트(목록 값)·채팅 카드. **잠금화면 "캘린더에 추가"는 푸시에 location이 없어 장소 없이** 저장한다(서버 notify 변경은 이 계획 범위 밖 — 0.11.0은 서버 무변경) | §15 후보 "장소는 주소 그대로 일정 위치에". 지금은 모든 경로가 위치 없이 저장한다(F10) |
| D10 | 버전 | **이 기능 = 0.11.0**, 보관 계획 R-B9(요약·저장 공간)는 **0.12.0**(L0이 스펙 §11·§15·§16·보관 계획을 고친다). 실행 때 `git log --oneline -- ios/project.yml`로 0.11.0이 이미 main에 있으면(R-B9가 먼저) 이 기능이 다음 빈 마이너를 쓰고 스펙·두 계획을 같은 커밋에서 맞춘다. 메이저 금지 | 이 기능은 서버를 바꾸지 않아 ③c2를 기다리지 않는 R-B9보다 먼저 준비된다 |
| D11 | 공개 순서 | **TestFlight 0.11.0은 0.10.0 TestFlight(광고 해지 계획 U6b) 기록 뒤**. 0.11.0 빌드는 main의 0.10.0 해지 화면을 포함하므로 U6b의 원클릭 비율 판정 전에 내보내지 않는다. 시뮬레이터 게이트(L8)까지는 측정 창 밖이면 언제든 | 광고 해지 계획 D10·D11(워커 배포·판정 뒤 공개)을 깨지 않는다 |
| D12 | 여행 글 후보와의 관계 | §15 "여행 글 → 일정 초안" 후보의 "서버가 본문 가져오기"를 **기기 렌더러 공유**로 바꿔 적는다(이번 구현 없음) | 링크 가져오기 계층을 공유한다는 후보 문구(§15)를 방식 A와 맞춘다 |
| D13 | 이미지 입력(LD4·MR3) | 사진 → 기기 Vision OCR → `[이미지] 사진 N장` + `메모:` + (넘치면 `일시·장소 줄:`) + `이미지 속 글자:`(전체 4,000자) → 기기 규칙 → SHARE 큐(`app_name = "이미지"`). **이미지 파일·축소본을 App Group·디스크에 저장하지 않는다** — 확장·앱이 `loadDataRepresentation`/`loadTransferable`로 메모리에 받아 한 장씩 그 자리에서 OCR하고 버린다(대기 행 없음 — 확장이 죽으면 그 공유는 사라지고 다시 공유하면 된다). 한 번에 **최대 3장**, 한 항목으로 합친다. 디코딩은 `CGImageSourceCreateThumbnailAtIndex`(긴 변 2,048px, EXIF 방향 반영). OCR 글이 합쳐 10자 미만이면 "사진에서 글자를 찾지 못했어요"(큐에 아무것도 넣지 않음). 공유에 웹 주소 1개(D5 조건)와 이미지가 같이 오면 링크(Safari 미리보기 그림). 채팅은 "+" 메뉴(지금 비활성 "2단계 예정", F26)에 `PhotosPicker`(이미지, 최대 3장 — 사진 권한 창 없음), 입력창 글은 메모. 파일 업로드·서버 vision·PDF는 그대로 2단계 | 사용자 요구(서버 업로드 없음). 스펙 §6 "규칙 통과 전 영속화 없음"과 맞다. 48MP 원본을 통째로 풀지 않는다(확장 메모리, U10). 기존 `VNImageRequestHandler(cgImage:)`는 방향을 모른다 |
| D14 | 같은 링크(MR2) | 캡처 id = `LinkText.captureID(for:)` — 조각(`#…`)을 떼고 스킴을 https로 맞춘 주소의 SHA-256 앞 16바이트(UUID 모양). 대기 행 id `link:<captureID>`. 큐 항목이 들어가면(`queued`) 기기 `link_seen`(App Group 큐 파일의 표, captureID와 만료 시각만 — 주소 없음)에 30일 남긴다. 관문이 기록을 찾으면 렌더링·행 없이 `duplicate` → "이미 읽은 링크예요. 제안 탭에서 확인해 주세요". 기록이 없어도(재설치) 서버 멱등 키(`SHARE:<id>`)가 같아 항목은 한 건이다. 확장이 죽어 남은 같은 주소의 대기 행은 다시 공유하면 lease만 새로 걸고 다시 읽는다. 규칙 폐기·실패는 기록하지 않는다(다시 해 볼 수 있게) | 같은 청첩장을 공유·채팅으로 두 번 넣으면 같은 일정이 두 번 제안된다(Fable F6). 읽은 링크 기록에 주소를 두지 않는다 |
| D15 | 절대 상한·취소 | 렌더러는 내부 작업(로드·대기·추출·스냅샷·OCR)과 **독립 기한(예산 + 추출 2초 + OCR 8초)·취소**를 경주시켜 먼저 끝난 쪽으로 돌아오고 웹뷰를 뗀다. 늦게 온 결과는 버린다. WebContent가 바쁜 루프에 걸려 JS 호출이 돌아오지 않아도 기한에 `timeout`으로 끝난다 | 기한 검사가 JS 반환 뒤에만 있으면 멈춘 페이지에서 공유 시트가 갇힌다(Codex 2) |

## 사용자 결정 필요 (기본값으로 구현하고, 다르게 고르면 표의 영향만 바꾼다)

| # | 질문 | 선택지 | 계획 기본값 | 다르게 고르면 |
|---|---|---|---|---|
| UQ1 | 링크·사진 글을 서버에 어떻게 남길까(LD3) | **A** 기존 항목처럼: 발췌(≤4,000자 — **짧은 페이지는 보이는 글 전체**, 이름·전화번호 포함, 계좌·카드는 마스킹) 암호화 3년 + 요약·청크(검색 가능) · **B** 추출 결과만: 추출 뒤 본문 삭제(요약·facts만 남음) | **A — 메인 판정 MR1(2026-10-02)로 확정, 사용자 재검토 가능.** 서버 변경 없음, §7·§12 규칙 그대로. 청크 평문 기간은 기존 UC-1(90일) 그대로 | B → 워커가 `app_name in ('웹 링크','이미지')` 항목의 본문을 추출 뒤 지워야 한다(워커 변경 → ③c2 뒤 별도 계획). 앱(L1~L6)은 그대로(`storageNote` 문구만) |
| UQ2 | 링크 주소를 어디까지 남길까 | **호스트만**(`[웹 링크] invite.example.com`) · 전체 주소 | **호스트만** — 쿼리 숫자가 OTP 규칙으로 항목 전체를 폐기하고(F9), 초대 토큰이 남지 않는다. 대가: 보관함에서 원래 링크를 다시 열 수 없다 | 전체 주소 → 서버 규칙이 주소 줄을 건너뛰도록 ingest·worker 규칙 변경(③c2 뒤, 별도 계획). 앱은 `LinkText.compose`의 첫 줄만 바꾼다 |
| UQ3 | 채팅 판정 범위 | 주소 1개 + 짧은 메모(200자 이하, 날짜 후보 없음)면 링크 수집 · 입력 전체가 주소일 때만 | **주소 1개 + 짧은 메모면 수집**(D5) — "청첩장 https://…"처럼 말을 붙여도 동작, 긴 글·날짜 있는 글은 질문 | "입력 전체가 주소"면 `LinkText.linkCandidate`의 메모 허용만 끈다(L1 한 줄 + 테스트 2개) |

UQ2·UQ3은 기본값으로 진행하고 메인이 사용자에게 알린다(B·전체 주소는 별도 계획이라 이 계획의 코드를 버리지 않는다).

## Global Constraints

- **스펙 먼저(AGENTS.md §1):** L0 커밋 전에는 코드 태스크를 시작하지 않는다. 계획과 스펙 문구가 다르면 스펙이 원본이다.
- **서버 무변경:** `supabase/functions/**`·`supabase/migrations/**`·`supabase/config.toml`을 바꾸지 않는다. 새 파일은 `supabase/eval/link-cases.json`(합성)·`supabase/scripts/_link-eval.ts`·`supabase/scripts/eval-link.ts`(배포된 worker를 테스트 lease로 호출)·`supabase/tests/link-eval.test.ts`뿐이다. Edge 함수 배포·`db push` 없음.
- **Gmail 측정 창(Gmail 계획 Global Constraints):** ③c2(≈ 10-08) 측정 동안 워커·gmail 함수 배포 금지는 그대로다(이 계획은 배포가 없다). 배포된 함수를 호출하는 L7(`eval-link.ts`)·L8(시뮬레이터 → ingest·worker)은 ③b3 진행 중·**③c1 10-07(수) 14:30~16:30 KST**·**③c2 10-08(목) 14:30 KST ~ ③c2 완료 기록**을 피한다(메인이 원장의 최신 `status.t0`와 완료 기록으로 다시 계산 — 날짜는 예시). 실사용자 `items`·`jobs`·`connections`를 만들거나 고치지 않는다 — 평가·게이트는 테스트 사용자만.
- **버전(AGENTS.md §8):** `MARKETING_VERSION: 0.11.0`(L8, D10 확인 후). 빌드 번호는 `testflight.sh` 기본값(`date +%Y%m%d%H%M`). 메이저 금지.
- **공개 순서(D11):** L9의 TestFlight 업로드는 `docs/superpowers/phase1/gates.md`에 0.10.0 TestFlight(UNS-server 통과 행, U6b)가 기록된 뒤.
- **개인정보(AGENTS.md §7, 스펙 §12):** 로그·`DiagLog`·trace·`gates.md`·보고에 **링크 주소·호스트·페이지 제목·본문·OCR 글을 쓰지 않는다** — 결과 코드·글자 수·장 수·경과 ms·불리언만. trace 이벤트 이름은 서버가 받는 접두(`share.`)만 쓴다(F8 — `share.link`·`share.image`). 테스트·평가 픽스처는 합성(`합성`·`example.com`·`.test`), 실제 청첩장·초대장 글·주소·사진을 픽스처에 넣지 않는다(사진은 테스트 안에서 그린다). 실기기 게이트(L9)는 사용자가 고른 실제 링크·사진으로 하되 기록은 메타(글자 수·장 수·OCR 여부·상태·일정 수)만. `items.content_enc` 복호화 조회 금지.
- **Swift 6 동시성:** WebKit 호출은 전부 메인 액터(`@MainActor`). Vision OCR은 메인 밖(`Task.detached`). `EruriCore`는 swift-tools 6.2(Swift 6 모드)다.
- **기계(AGENTS.md §6):** 빌드·시뮬레이터·deno 전 `vm_stat | grep -E 'free|compressor'`. 시뮬레이터 빌드와 deno를 동시에 돌리지 않는다(`pgrep -x deno`·`pgrep -x xcodebuild`가 비었을 때만). 시뮬레이터는 pane 전용 UDID. 시간에 기대는 테스트는 스왑 포화를 감안해 예산 5초 이상으로 둔다.
- **테스트 명령:** 앱 `cd ios && ./scripts/sim.sh gen && ./scripts/sim.sh test EruriCoreTests/<클래스>`, 빌드 `cd ios && ./scripts/sim.sh build`. 평가 `deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/eval-link.ts --runs 3`(저장소 루트), 타입 확인 `deno check supabase/scripts/eval-link.ts`.
- **호스팅 DB(AGENTS.md §7):** L7은 **테스트 사용자 13**, L8 시뮬레이터 게이트는 **테스트 사용자 14**(다른 테스트·게이트가 1·2·7·9·11·12를 쓴다 — 구현 때 `grep -rhoE 'userClient\([0-9]+\)|testUser(Id)?\([0-9]+\)' supabase/tests supabase/scripts .context`로 비었는지 다시 본다). 실행 태그(`RUN`)·자기 행만 지운다. 사용자 14는 이 게이트 전용이라 정리는 링크·이미지 항목(`captured_at` ≥ 게이트 시작)과 그 파생 행으로 한정한다.
- **모델(AGENTS.md §3):** L0 `opus`/`high`. L1~L6 구현·리뷰 `opus`/`high`(WebKit·동시성 판단 — **L3 구현 리뷰는 렌더러 경주·콘텐츠 규칙 때문에 반드시 `opus`/`high` 한 번 더**). L7 평가 판정 `opus`/`medium`. L8 시뮬레이터 게이트 `opus`/`medium`. L9 실기기 세션(사용자 조작 대기 위주) `sonnet`/`medium`, 판정·기록이 섞이면 `opus`/`medium`.
- **기록:** `docs/superpowers/phase1/gates.md`에 행 `LNK-eval`(L7)·`LNK-sim`(L8)·`LNK-device`(L9)(·필요하면 `LNK-ocr-device`). 상태는 통과·실패·대기만("부분"은 마감 아님, AGENTS.md §5-8). 커밋 칸은 비우고 메인이 채운다.
- **커밋:** 태스크마다, 트레일러 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. **push 금지**(메인이 회수 후 `git push origin main`).

## 이 계획이 기대는 사실 (코드·공식 문서에서 확인, 2026-10-02)

| # | 사실 | 출처 |
|---|---|---|
| F1 | 공유 확장은 지금 **텍스트·URL만** 받는다(활성화 규칙: 모든 첨부가 `public.url`·`public.plain-text`). 모든 텍스트 표현을 `ShareText.compose`로 합쳐 `CapturePipeline.handleShare`(규칙만, `appName`·`title` nil)로 큐에 넣고 **화면 없이 바로** `completeRequest`한다. `ShareText.collect`는 plain-text·URL 표현만 읽는다(이미지 첨부는 건너뛴다) | `ios/ShareExtension/ShareViewController.swift`, `Info.plist`, `EruriCore/ShareText.swift:125-145`, `CapturePipeline.swift:20-27` |
| F2 | 제품에 서버 이미지 수집 경로가 없다: ingest는 `device`·`trace`·본 ingest만 처리한다(`upload/<id>` 없음, `handler.ts` 주석 "localFile 항목은 이 경로로 오지 않는다"). worker `extract.ts`·`insert_media_item`은 PoC 잔재로 진입점이 없다(스펙 §15 2단계 "이미지·PDF 공유 파일 경로"). `CapturePipeline.handleShareFile`(파일 영속화)도 호출처가 없다 | `supabase/functions/ingest/index.ts`, `handler.ts:3`, 스펙 §15 |
| F3 | 확장은 큐에 넣기만 하고 업로드는 앱 flush(트리거 `intent`·`silent_push`·`bg_refresh`·`foreground`)가 한다. 확장에는 세션이 없다(refresh token은 앱 Keychain) | `ios/App/Uploader.swift`, `ios/App/SupabaseSession.swift:7` |
| F4 | 큐는 표 하나(`queue`, `id` PK, `kind` = `capture`·`trace`), `INSERT OR IGNORE`, 캡처 `claim`·`pending`은 `kind = 'capture'`만, `markSent(id:)`는 kind 무관 삭제, `markFailed`는 attempts+1·백오프(30초×2^attempts, 상한 1시간) | `EruriCore/CaptureQueue.swift` |
| F5 | ingest: `SOURCES` = MESSAGES·NOTIFICATION·SHARE·CHAT, 멱등 키 `${source}:${id}`, 제목+본문 규칙(OTP면 204, 저장 없음), 202 `{item_id, duplicate:false}`·중복 200 | `supabase/functions/ingest/handler.ts` |
| F6 | `items.source` check 제약 = GMAIL·MESSAGES·NOTIFICATION·SHARE·CHAT | `supabase/migrations/0001_baseline.sql:83` |
| F7 | worker process: 규칙 재적용 → Jev 게이트(메신저가 아니면 제목 포함) → 추출(입력 4,000자 절단, 머리 `출처:`·`앱:`·`제목:`) → `save_facts` → notify·embed. 비행동 라벨 ≥0.8만 7일 격리 폐기, 결과 없음 = `discarded:server:empty`(원문 유지) | `worker/text.ts`, `_shared/extract-text.ts:9,90-92`, 스펙 §7 |
| F8 | trace 이벤트 이름은 `^(capture|device|action|share|upload)\.[a-z0-9_.]{1,60}$`만 서버가 받는다(어기면 배치 400). 금지 필드 `content`·`text`·`body` | `EruriCore/Trace.swift:7-8`, `supabase/functions/ingest/trace.ts` |
| F9 | 기기·서버 규칙: OTP 키워드에 영문 `code`(앞뒤 비영문)가 있고 30자 안에 4~8자리 숫자면 **항목 전체 폐기**. `RuleFilter()` 기본값은 연락처 없음(`init(contactNames: [])`), `apply(title:text:sender:)`가 제목+본문을 함께 판정, `apply(text:sender:)`는 본문만 | `EruriCore/RuleFilter.swift:10,40-48`, 스펙 §6 표 |
| F10 | EventKit 저장은 제목·시각·표식 `url`만 넣는다(`location` 없음). `AddEventRequest`에 위치가 없다. `handleAdd(fields:)`는 `[String: String]` 키(`proposal_id`·`title`·`start`·`end`·`version`)를 읽는다 | `ios/App/NotificationActions.swift:33-48,137,166-171` |
| F11 | 제안 payload = 추출 event(`title`·`start`·`end`·`location`·`uncertain`…, `via` 제외). 대기 목록 행에 `location`, 채팅 응답 `proposals[].payload`(JSON)에도 있다 | `_shared/facts.ts:26`, `0025_multi_event.sql:34-35`, `EruriCore/ProposalReview.swift:10`, `ChatReply.swift:12` |
| F12 | 확장에서 컨테이너 앱을 여는 지원 경로가 없다(`NSExtensionContext.open`은 Today·iMessage만, Frameworks Engineer 2025-01 "no supported way") | developer.apple.com `NSExtensionContext/open(_:completionHandler:)`, Apple Developer Forums(검증 표 `scratchpad/wk-premises.md` #3) |
| F13 | 백그라운드로 깨어난 앱은 몇 초 뒤 정지되고 WebKit은 백그라운드를 비가시로 다룬다 → 백그라운드 렌더링은 기대하지 않는다 | Apple Developer Forums 64150(Frameworks Engineer), WebKit 소스(검증 #8) |
| F14 | iOS 16+에서 앱이 클립보드를 프로그램으로 읽으면 허용 창이 뜬다. 사용자가 입력창에 직접 붙여넣는 것은 창이 없다 | `UIPasteControl`·`UIPasteboard` 문서, WWDC22 10096(검증 #9) |
| F15 | WebKit에는 network idle API가 없고 `didFinish`는 메인 내비게이션 완료일 뿐 JS의 XHR·fetch를 기다리지 않는다 | `WKNavigationDelegate` 문서(검증 #5a) |
| F16 | WebContent 프로세스 메모리는 앱(확장)과 **따로** 계산되고 넘치면 그 프로세스만 끝난다(`webViewWebContentProcessDidTerminate`). WebKit은 **창 안 + foreground**일 때 뷰를 보이는 것으로 본다 | Forums 21956(Frameworks Engineer), WebKit `isActiveViewVisible`(검증 #1b·#4a) |
| F17 | `WKWebsiteDataStore.nonPersistent()`는 메모리에만 두고 디스크에 쓰지 않는다. Vision 한국어는 **accurate**에서만(기존 `OCR`이 accurate + `["ko-KR","en-US"]`). `WKNavigationDelegate`의 정책 결정은 내비게이션(메인·하위 프레임)만 거치고 img·fetch·XHR 같은 하위 리소스는 거치지 않는다 — 하위 리소스 차단은 `WKContentRuleList` | 문서(검증 #6·#7), `EruriCore/OCR.swift` |
| F18 | 채팅 `send()`는 500 UTF-16 이하 질문을 `/chat`에 보낸다. 링크 처리는 없다. 앱 활성화 때 `Uploader.flush()`·기기 등록·실행 보고가 돈다(`EruriApp` `.onChange(of: scenePhase)`) | `ios/App/ChatView.swift:342-`, `ios/App/EruriApp.swift:26-31` |
| F19 | 앱은 RLS로 자기 `items`·`facts`를 REST로 읽는다(보관함·항목 상세 선례) | `0001_baseline.sql:110,490`, `EruriCore/Archive.swift:79`, `ItemDetailView.swift:50` |
| F20 | 테스트 lease 접두(`test:<run>`)로 worker를 부르면 그 잡과 자식 잡(notify·embed, `o.leasePrefix`)만 가져간다. 선례 `smoke-process.ts`(insert_item `p_enqueue:false` + `enqueue_job` + worker `{lease_prefix}`) | `worker/index.ts:60-65`, `worker/text-deps.ts:31,52`, `supabase/scripts/smoke-process.ts` |
| F21 | 앱 0.10.0(`ios/project.yml:13`), 보관 계획 R-B9 = 0.11.0(스펙 §11·§15·§16 결정 5, `2026-10-01-retention-summary.md:46,97,3162,3197`) | 해당 파일 |
| F22 | 시뮬레이터 게이트 하네스 사본: `.context/sim-gate-090-shots/{project.gate090.yml.txt, GateHost.swift.txt, Gate.swift.txt}`, 로그인 도구 `.context/gate090/token.ts`(광고 해지 U9 선례: token.ts → Host 주입 → UI 테스트). PoC-8에 사진 앱 공유 시트 XCUITest 선례가 있다(`docs/superpowers/poc/results.md` PoC-8 기기 행) | `docs/superpowers/plans/2026-10-01-gmail-unsubscribe.md` U9, results.md |
| F23 | Jev 게이트는 본문 앞 **2,000자만** 본다(`JEV_BODY_MAX = 2000`, 게이트 입력 `text.slice(0, 2000)`). 추출은 4,000자 | `supabase/functions/_shared/jev.ts:10` |
| F24 | `ios/App/Info.plist`·`ios/ShareExtension/Info.plist`에 `NSAppTransportSecurity`가 없다 → WKWebView도 ATS를 따라 공개 호스트의 `http://` 로드는 실패한다 | 두 Info.plist |
| F25 | 앱 알림 위임 `willPresent`가 `[.banner, .list]`를 돌려 foreground에서도 로컬 알림 배너가 뜬다. `ExecutionReporter.notice(title:body:)`는 즉시 로컬 알림 1건 | `ios/App/NotificationActions.swift:231-234`, `ios/App/ExecutionReporter.swift:48-51` |
| F26 | 채팅 "+" 메뉴는 `Button("이미지·파일 첨부 (2단계 예정)") {}.disabled(true)` 하나뿐이다 | `ios/App/ChatView.swift:93-95` |
| F27 | `ScheduleCard.origin`은 SHARE를 "공유한 내용"·"공유함", `SourceLabel.label`은 SHARE를 "공유"로 보인다(보관함 출처) | `EruriCore/ScheduleCard.swift`, `EruriCore/SourceLabel.swift:12` |

## 미확인 전제와 흡수 게이트 (추측하지 않는다)

| # | 전제 | 상태 | 흡수 게이트 | 실패하면 |
|---|---|---|---|---|
| U1 | iOS 26 **공유 확장 안에서** WKWebView가 페이지를 로드하고 JS를 실행한다 | **미확인**(공식 허용·금지 문장 없음, 검증 #1a) | **L8 `LNK-sim` G8(필수, 시뮬레이터 Safari 공유 시트)** | `LinkFlow.renderInShareExtension = false`(확장은 대기 행만, "앱을 열면 읽어요") — 0.11.0 TestFlight 전이라 같은 버전에서 바꾸고 스펙 §6·§16 반영, `LNK-sim` 행에 "U1 실패(대안 채택)" |
| U2 | 창 안·다른 화면 밑에 붙인 WKWebView가 타이머·렌더링·`takeSnapshot`을 정상 수행한다 | 미확인(공식 문서 없음, WebKit 소스상 창 안이면 가시) | L3 테스트(시뮬레이터: 지연 JS·스냅샷 OCR), L9 D1(실기기) — 실기기 스냅샷 OCR은 사용자 링크가 OCR을 탈 때만 판정, 아니면 `LNK-ocr-device` 대기 | 웹뷰를 화면 위 투명도 0.01로 올리는 대안 → 같은 테스트 |
| U3 | 확장 메모리 한도(수치 미공개, "현저히 낮음") 안에서 확장의 렌더링(OCR 없음)이 실제 청첩장에서 버틴다 | 미확인(120MB는 공식 수치 아님) | L9 D1(실제 청첩장) | U1과 같은 대안 → 0.11.1 |
| U4 | iOS 26 **시뮬레이터**에서 Vision ko-KR accurate가 동작한다 | 미확인(macOS 26 실측만, 검증 #7. PoC-8 시뮬레이터 확장 `ocrLen=43` 선례) | L3 `testImageOnlyPageUsesOCR`·`OCRImageTests` | 시뮬레이터에서 안 되면 그 테스트를 `XCTSkip`(U4)로 두고 실기기 D6에서 판정 |
| U5 | 시뮬레이터 앱이 `http://127.0.0.1:<port>`를 ATS 예외 없이 로드한다(공개 호스트 http는 ATS로 막힌다 — F24, 그래서 D7은 https로 올린다) | 미확인(ATS는 IP 주소 연결에 적용되지 않는다고 기억 — 문서 재확인 안 함) | L3 루프백 서버 대조 테스트(`testLoopbackControlLoads`), L8 Step 2 | L3 서버 테스트는 `XCTSkip("U5")`로 두고, 게이트 하네스(커밋 안 함)의 Info.plist에 `NSAppTransportSecurity`·`NSAllowsLocalNetworking = YES` |
| U6 | 흔한 모바일 청첩장(바른손·카카오 등)·지도 링크에서 글이 나온다 | 미확인(실제 페이지는 픽스처로 쓸 수 없다) | 합성 형태별 L3 픽스처, L9 D1·D3(사용자 실제 링크, 메타만) | 실패 형태를 메타로 기록하고 사용자에게 보고(새 형태는 픽스처 추가 태스크) |
| U7 | Jev 게이트가 합성 링크·사진 본문(청첩장·돌잔치·행사)을 행동 항목으로 통과시킨다. 대화 캡처 사진은 `personal`로 격리될 수 있다 | 미확인 | L7 `LNK-eval`(대화 캡처는 측정만) | 행동 사례가 게이트로 폐기되면 멈추고 메인이 사용자에게 "사용자가 공유한 링크·사진은 게이트 생략"(워커 변경 → ③c2 뒤 별도 계획)을 묻는다 |
| U9 | `UIImage`·`CGImage`를 `Task.detached`로 넘길 수 있다(Sendable) | 미확인(SDK 표기) | L3 컴파일 | `struct Image: @unchecked Sendable { let cg: CGImage }`(불변 이미지 — 계획 코드가 이미 이렇게 한다) |
| U10 | 실기기 **공유 확장 안에서** Vision accurate(2,048px 축소본, 한 장씩)가 메모리 한도 안에 돈다(PoC-8은 시뮬레이터만) | 미확인 | L9 `LNK-device` D6 | 확장은 축소본을 App Group `inbox/`에 두고 대기 행으로 앱에 넘김(0.11.1 — 스펙 §6 "규칙 통과 전 영속화 없음"의 예외를 사용자에게 묻고 반영) |
| U11 | 시뮬레이터 XCUITest로 Safari·사진 앱 공유 시트와 `PhotosPicker`를 조작할 수 있다 | 미확인(PoC-8 사진 앱 공유 시트 선례) | L8 G8·G10·G11 | 그 G는 "대기"(원인 기록) — 판정에서 빼지 않는다. `LNK-sim`이 대기면 L9로 가지 않는다 |

(초판 U8 "서버 리다이렉트가 `decidePolicyFor`에 세어진다"는 `NSURLErrorHTTPTooManyRedirects`도 `redirects`로 읽게 바꿔 결과가 같아져 지웠다 — L3 `testTooManyRedirectsFail`가 어느 쪽이든 판정한다.)

## Review Focus

1. **끝나지 않는 페이지**(배경 슬라이드·카운트다운·방명록 자동 갱신)·무거운 갤러리. 사람은 공유가 오래 걸리지 않고 읽은 만큼이라도 처리되길 기대한다 → 예산이 끝나면 그때까지의 글로 진행(L1 `testSettleDeadline`, L3 `testNeverSettlingPageReturnsPartial`).
2. **멈춘 페이지**(무한 루프 JS). 사람은 [닫기]가 바로 듣고 시트가 갇히지 않길 기대한다 → 독립 기한 경주(L3 `testStuckPageTimesOut`), [닫기]는 결과를 기다리지 않음(L4).
3. **"터치해서 열기" 덮개 뒤 본문**(숨은 요소) → 보이는 글에 날짜가 없고 숨은 글에 있으면 숨은 글(L1 `testBodyPrefersHiddenTextWhenOnlyItHasDate`, L3 `testHiddenCoverTextIsRead`).
4. **이미지 전용 청첩장**(글 0자 포함). 사람은 그림 속 날짜·장소로 일정이 오길 기대한다 → 앱이 스냅샷 OCR(L3 `testImageOnlyPageUsesOCR` — 글 0자, L7 `wedding-ocr`, L8 G3), 확장은 앱에 넘김(L2 `testShareWithoutDateHandsOff`·`testShareEmptyPageHandsOff`).
5. **주소가 든 긴 공지·일정 문자 공유**. 사람은 지금처럼 글 전체가 저장되길 기대한다 → 링크 아님(L1 `testLongTextWithURLIsNotALink`), 링크 확정 실패면 텍스트 폴백(L4).
6. **긴 청첩장**(갤러리·인사말 3,000자). 사람은 게이트가 날짜를 놓치지 않길 기대한다 → 일시·장소 줄을 본문 앞에(L1 `testComposeTruncatesAndKeepsKeyLinesFirst`, L7 `wedding-long`·`wedding-noisy`).
7. **공유 직후 확장이 죽거나 시트를 닫는다·읽는 중 앱을 떠난다·같은 링크가 두 번 들어온다**. 사람은 링크가 사라지지 않고 일정이 두 번 오지 않길 기대한다 → 대기 행 lease·재시도·취소 시 행 유지, 같은 링크 = 같은 id + 읽은 링크 기록(L2 `testExtensionDeathHandsOffAfterLease`·`testAppRetryableFailureKeepsRow`·`testAppCancelledReleasesRow`·`testSameLinkIsDuplicate`, L8 G5·G12, L9 D3b).
8. **페이지가 앱 스킴으로 튄다·내부 주소를 부른다**. 사람은 다른 앱·로컬 네트워크 권한 창이 뜨지 않길 기대한다 → 차단하고 계속(L3 `testAppSchemeNavigationIsBlockedAndPageStillRead`·`testPrivateSubresourcesAreBlocked`).
9. **주소 쿼리의 숫자**(`?code=482913`)·**메모의 인증번호**. 사람은 청첩장이 "인증번호"로 버려지지 않길, 인증번호가 기기에 남지 않길 기대한다 → 본문에는 호스트만(L1 `testComposeKeepsHostOnly`, L2 `testQueryDigitsDoNotDiscard`), 메모는 행을 만들기 전에 규칙(L2 `testOTPNoteLeavesNoRow`).
10. **사진 여러 장·회전된 사진·글자 없는 사진**. 사람은 세 장까지 한 번에, 돌아간 사진도 읽히고, 글자가 없으면 그렇다고 알려 주길 기대한다 → `ImageText`(L1), `OCR.recognize(data:)` 방향 반영(L3 `testRecognizeDataAppliesOrientation`), 10자 미만 `empty`(L2 `testImageEmptyQueuesNothing`).
11. **진단 기록에 주소·제목이 샌다**. → trace 필드는 `LinkFlow.traceFields`·`ImageFlow.traceFields`가 코드·수만 만든다(L2 `testTraceFieldsHaveNoURLOrText`, L8 G9).

## 파일 구조

```text
docs/superpowers/specs/2026-09-22-assistant-design.md          # L0 스펙(원본)
docs/superpowers/plans/2026-10-01-retention-summary.md         # L0 R-B9 0.11.0 → 0.12.0
ios/Packages/EruriCore/Sources/EruriCore/LinkText.swift        # L1 신규: 링크 판정·주소 검사·https 올리기·같은 링크 id·날짜 후보·본문 + LinkPage + LinkSettle
ios/Packages/EruriCore/Tests/EruriCoreTests/LinkTextTests.swift
ios/Packages/EruriCore/Sources/EruriCore/ImageText.swift       # L1 신규(LI1): 사진 OCR 글 → 본문
ios/Packages/EruriCore/Tests/EruriCoreTests/ImageTextTests.swift
ios/Packages/EruriCore/Sources/EruriCore/CaptureQueue.swift    # L2 링크 대기 행(kind = 'link', 7일 만료, attempts) + link_seen 표
ios/Packages/EruriCore/Sources/EruriCore/CapturePipeline.swift # L2 handleRead
ios/Packages/EruriCore/Sources/EruriCore/LinkFlow.swift        # L2 신규: PendingLink · LinkRendering · LinkRenderOutcome · 관문 · 확장/앱 흐름 · ImageFlow · trace 필드
ios/Packages/EruriCore/Tests/EruriCoreTests/LinkFlowTests.swift
ios/Packages/EruriCore/Sources/EruriCore/LinkCaptureText.swift # L2 신규: 확장·채팅·알림 문구(링크·사진), 서버 상태 → 결과
ios/Packages/EruriCore/Tests/EruriCoreTests/LinkCaptureTextTests.swift
ios/Packages/EruriCore/Sources/EruriCore/LinkRenderer.swift    # L3 신규: WKWebView 렌더러(@MainActor) + 독립 기한 경주 + 콘텐츠 규칙 + 추출 JS
ios/Packages/EruriCore/Sources/EruriCore/OCR.swift             # L3 recognize(image:) · recognize(data:maxPixel:)(LI2)
ios/Packages/EruriCore/Sources/EruriCore/ShareImages.swift     # L3 신규(LI4 전반): 공유 이미지 첨부를 한 장씩 메모리로 받아 OCR
ios/Packages/EruriCore/Tests/EruriCoreTests/LinkRendererTests.swift
ios/Packages/EruriCore/Tests/EruriCoreTests/OCRImageTests.swift
ios/ShareExtension/Info.plist                                  # L4 활성화 규칙에 public.image
ios/ShareExtension/ShareViewController.swift                   # L4 링크·이미지 경로
ios/ShareExtension/LinkStatusView.swift                        # L4 신규: 시트 안 상태 화면(UIKit)
ios/App/LinkCapture.swift                                      # L5 신규: 앱 렌더 호스트·이어받기·채팅 링크/사진·폴링
ios/App/ChatView.swift                                         # L5 링크·사진 턴, "+" 메뉴 PhotosPicker
ios/App/EruriApp.swift                                         # L5 foreground 이어받기·비활성 전환 취소
ios/Packages/EruriCore/Sources/EruriCore/ScheduleCard.swift     # L5 "공유한 링크"·"공유한 이미지" · L6 location
ios/Packages/EruriCore/Sources/EruriCore/SourceLabel.swift      # L5 보관함 출처 "공유한 링크"·"공유한 이미지"
ios/Packages/EruriCore/Tests/EruriCoreTests/ScheduleCardTests.swift
ios/Packages/EruriCore/Tests/EruriCoreTests/SourceLabelTests.swift
ios/Packages/EruriCore/Sources/EruriCore/ProposalReview.swift   # L6 addFields location
ios/Packages/EruriCore/Tests/EruriCoreTests/ProposalReviewTests.swift
ios/App/NotificationActions.swift                              # L6 AddEventRequest.location → EKEvent.location
supabase/eval/link-cases.json                                  # L7 신규(합성 링크·사진 본문 13종 + 기대값)
supabase/scripts/_link-eval.ts                                 # L7 신규(판정·본문 펼치기 순수 함수)
supabase/scripts/eval-link.ts                                  # L7 신규(배포된 worker, 테스트 lease, 테스트 사용자 13)
supabase/tests/link-eval.test.ts                               # L7 신규(네트워크 없음)
ios/project.yml                                                # L8 0.11.0
docs/superpowers/phase1/gates.md                               # L7 LNK-eval · L8 LNK-sim · L9 LNK-device
```

`EruriCore`는 SPM이라 새 파일이 자동으로 들어간다. 앱·확장 타깃은 xcodegen 폴더 소스라 새 파일 뒤 `./scripts/sim.sh gen`이 필요하다. 테스트 픽스처는 파일이 아니라 테스트 안 HTML 문자열·그린 그림이다(번들 리소스 추가 없음). `SourceLabelTests.swift`가 이미 있으면 그 파일에 더하고, 없으면 만든다(구현 때 `ls`로 확인).

## 실행 순서

1. L0(스펙) 커밋 → 메인 push.
2. L1 → L2 → L3(각 태스크 리뷰 통과 뒤 다음, L3는 `opus`/`high` 구현 리뷰를 한 번 더). L6은 L0 뒤 아무 때나(다른 파일).
3. L4 → L5 **순서대로**(둘 다 `sim.sh gen`·`build`·`test`로 같은 `Eruri.xcodeproj`·`ios/build`·`ios/.sim-udid`를 쓴다 — AGENTS.md §2·§6). L5와 L6은 `ScheduleCard.swift`가 겹치므로 같은 pane에서 순서대로 하거나 L6을 먼저 끝낸다.
4. L7은 L1 뒤, 측정 창 밖이면 언제든(배포 없음). 결과가 L8 진행 조건이다(U7).
5. L8(0.11.0 + 시뮬레이터 게이트) — 측정 창 밖. `LNK-sim` 통과(U1 판정 포함) 뒤에만 L9.
6. [광고 해지 계획 U6b: 0.10.0 TestFlight 기록] → L9.

---

### Task L0: 스펙·버전 문서

**Files:**
- Modify: `docs/superpowers/specs/2026-09-22-assistant-design.md`(머리 줄·§2·§5·§6·§7·§8·§9·§10·§11·§12·§15·§16)
- Modify: `docs/superpowers/plans/2026-10-01-retention-summary.md`(R-B9 버전 4곳)

**Interfaces:**
- Produces: 스펙 §6 "링크·이미지 읽기"(이후 태스크의 원본 — 상수·문구·형식), 버전 0.11.0(이 기능)·0.12.0(R-B9).

§16 "외부 리뷰 반영 (링크 → 일정 계획 …)" 판정 기록은 이 계획 개정 커밋에 이미 들어 있다 — L0은 손대지 않는다.

- [ ] **Step 1: 버전 확인**

Run: `git log --oneline -5 -- ios/project.yml && grep -n MARKETING_VERSION ios/project.yml`
Expected: `MARKETING_VERSION: 0.10.0`. 0.11.0 이상이면 멈추고 메인에게 알린다(D10 — 다음 빈 마이너로 아래 숫자를 모두 바꾼다).

- [ ] **Step 2: 머리 줄**

`작성일: 2026-09-22 · 갱신: ` 바로 뒤에 넣는다:

```text
2026-10-02 (링크·이미지 → 일정 제안 방식 A — 기기 렌더링·기기 OCR, 사용자 결정 §2·§5·§6·§7·§8·§9·§10·§11·§12·§15·§16) · 
```

- [ ] **Step 3: §2 결정 표**

`| 공유 | Share Extension: 텍스트·URL·이미지·PDF | 사용자 확정 |` 행 바로 아래에 행을 더한다:

```text
| 링크·이미지 → 일정 | 청첩장·초대장·행사 페이지 링크를 공유 시트 또는 채팅 붙여넣기로 받으면 **기기가 보이지 않는 웹뷰로 렌더링해** 글(제목·OG 설명·본문, 날짜가 없거나 글이 없으면 화면 OCR)을 읽어 SHARE 항목(`app_name = "웹 링크"`)으로 보낸다. 사진(공유 시트·채팅 "+", 최대 3장)은 **기기 OCR 글만** SHARE 항목(`app_name = "이미지"`)으로 보낸다. **서버는 외부 URL을 가져오지 않고 이미지 파일을 받지 않는다**(파일 경로는 2단계) | 2026-10-02 사용자 결정 방식 A + 이미지 입력(§6 "링크·이미지 읽기", §16) |
```

- [ ] **Step 4: §5 수집 경로 표 두 행**

`| 공유 | Share Extension | 사용자 선택 | NSItemProvider 실제 타입 | 로그인 필요한 URL 본문은 못 받음 |` →

```text
| 공유 | Share Extension | 사용자 선택 | NSItemProvider 실제 타입. 웹 주소 하나 + 짧은 메모면 기기가 페이지를 읽은 글, 사진은 기기 OCR 글(§6 "링크·이미지 읽기") | 로그인이 필요한 페이지는 못 읽음(웹뷰 비영속 저장소). 이미지 파일·PDF 업로드는 2단계 |
```

`| 채팅·Siri·빠른 기억 | AskIntent / QuickMemoryIntent | 사용자 입력 | 텍스트 | — |` →

```text
| 채팅·Siri·빠른 기억 | AskIntent / QuickMemoryIntent | 사용자 입력 | 텍스트. 채팅 입력에 `http(s)://` 주소가 정확히 하나이고 나머지 글이 짧으면(200자 이하, 날짜 없음) 질문이 아니라 링크 수집, 채팅 "+" 사진은 기기 OCR 글(§9) | — |
```

- [ ] **Step 5: §6 공유 확장 이미지 문단·새 소절 "링크·이미지 읽기"**

(a) `이미지·PDF 공유 시 기기 Vision 프레임워크 OCR 텍스트를 **항상 함께**`로 시작하는 줄 바로 앞(빈 줄 하나 두고)에 넣는다:

```text
**1단계(앱 0.11.0)의 이미지는 기기 OCR 글만 보낸다**(아래 "링크·이미지 읽기", 2026-10-02 사용자 결정). 위 문단의 파일 영속화(`inbox/`)·파일 업로드·"이미지는 서버로 그대로 전송됨" 표시와 아래 문단은 **2단계 파일 경로**의 설계다(§15). PDF는 1단계에서 받지 않는다.

```

(b) `## 7. 서버 파이프라인` 줄 바로 앞(빈 줄 하나 두고)에 넣는다:

````text
### 링크·이미지 읽기 (2026-10-02 사용자 결정 방식 A + 이미지 입력, 앱 0.11.0)

청첩장·초대장·행사 페이지 링크는 **기기가 렌더링해 읽고**, 사진은 **기기가 OCR한 글만** 보낸다. 서버는 외부 URL을 가져오지 않고 이미지 파일을 받지 않는다(§7). 순수 로직은 `EruriCore` `LinkText`·`LinkSettle`·`ImageText`, 웹뷰는 `LinkRenderer`, OCR은 `OCR`·`ShareImages`, 흐름은 `LinkFlow`·`ImageFlow`(공유 확장·앱 공용).

- **입력(링크)**: ① 공유 시트 — 공유 한 번의 텍스트 표현(`ShareText.compose`)에 `http://`·`https://`로 적힌 주소가 정확히 하나이고, 주소를 뺀 나머지 글이 200자 이하이며 날짜 후보가 없으면 링크(나머지 글은 메모). 그 밖(주소 둘 이상, 긴 글·날짜가 있는 글 + 주소)은 지금처럼 텍스트 공유 — 주소 하나가 든 공지·일정 문자가 메모로 잘리지 않게 한다. ② 채팅 — 같은 조건이면 질문이 아니라 링크 수집(§9), 주소 둘 이상이면 "링크는 한 번에 하나씩 보내 주세요". 스킴 없는 도메인은 링크로 보지 않는다. 주소 바로 뒤에 붙은 비 ASCII 글자("…/1이에요")는 주소에서 뗀다(한글 경로 주소는 링크로 보지 않는다). 앱은 클립보드를 읽지 않는다(사용자가 입력창에 붙여넣은 글만).
- **입력(이미지)**: ③ 공유 시트 — 이미지 첨부(`public.image`, 최대 3장, 넘는 장은 버림)를 공유하면 사진 경로. 웹 주소(위 조건)와 이미지가 같이 오면 링크(Safari 미리보기 그림). 이미지와 함께 온 글은 메모(200자 — 더 길면 그 글은 따로 텍스트 공유 항목으로도 넣는다). ④ 채팅 "+" — `PhotosPicker`(이미지, 최대 3장, 사진 권한 창 없음), 입력창 글은 메모.
- **같은 링크**: 캡처 id = 조각(`#…`)을 떼고 스킴을 https로 맞춘 주소의 SHA-256 앞 16바이트(UUID 모양) — 같은 링크면 같은 id다. 큐 항목이 들어가면 기기에 "읽은 링크" 기록(App Group 큐 파일의 `link_seen` 표: 캡처 id·만료 시각만, 주소 없음, 30일)을 남기고, 다시 들어오면 렌더링 없이 "이미 읽은 링크예요. 제안 탭에서 확인해 주세요". 기록이 없어도(재설치) 서버 멱등 키(`SHARE:<id>`)가 한 건으로 막는다. 규칙 폐기·읽기 실패는 기록하지 않는다.
- **주소 검사**: http(s)만. 사설·루프백·링크로컬·CGNAT IP 리터럴, `.local`·`.localhost`·`.internal`·`.home.arpa`, 점 없는 호스트는 열지 않는다(메인 프레임·하위 프레임 모두). 하위 리소스(이미지·fetch·XHR·iframe)는 콘텐츠 규칙(`WKContentRuleList`)으로 사설 IP 리터럴·`localhost`·`.local` 요청을 막는다. DEBUG 빌드만 `localhost`·`127.0.0.1`을 허용한다(시뮬레이터 게이트). 서버 SSRF 방어가 아니라 기기 위생이다(로컬 네트워크 권한 창·내부 기기 접근 회피). **공개 이름이 사설 주소로 풀리는 경우는 막지 않는다**(브라우저와 같다). `http://`는 `https://`로 올려 연다 — 앱·확장에 ATS 예외가 없어 평문 로드는 막히고, 예외를 두지 않는다. 올린 https가 TLS·연결 거부로 실패하면 "보안 연결(https)이 안 되는 페이지예요".
- **웹뷰**: `WKWebView`(390×844pt)를 창 안 다른 화면 **밑**에 붙여 사용자에게 보이지 않게 연다. WebKit은 창 안·foreground일 때만 뷰를 보이는 것으로 다뤄 렌더링·타이머를 정상으로 돌린다 — 화면 밖·창 밖, iOS 26 `WebPage` 단독 사용은 비가시 스로틀이 미확인이라 쓰지 않는다. 비영속 저장소(쿠키·로그인 없음 — 로그인이 필요한 페이지는 못 읽는다), 미디어 자동 재생 금지, 새 창·앱 스킴 이동(`kakaolink:` 등)·다운로드는 막고 읽기는 계속, 메인 프레임 이동 6회 초과(또는 WebKit의 리다이렉트 초과)·HTTP 4xx/5xx·표시할 수 없는 형식은 실패. JS는 켠다(SPA 청첩장).
- **대기**: WebKit에는 network idle 판정이 없다. `didFinish`(오지 않으면 4초) 뒤 `document.body.innerText` 길이를 0.5초마다 재서 3번 같으면 완료. 글이 0자면 `didFinish` 뒤 4초가 지나고 3번 같을 때 완료(SPA가 그릴 시간). 예산(확장 10초·앱 15초)이 끝나면 그때까지 읽은 글로 진행한다(0자여도 메타·OCR로 간다, 페이지가 서지도 못했으면 시간 초과). **절대 상한**: 렌더러는 내부 작업과 독립 기한(예산 + 추출 2초 + 앱의 OCR 8초)을 경주시켜 먼저 끝난 쪽으로 돌아온다 — 페이지 스크립트가 멈춰도 확장 12초·앱 25초 안에 끝난다.
- **읽는 것**: 격리된 JS 세계(`WKContentWorld.defaultClient`)에서 `document.title`, `og:title`, `og:description`(없으면 `description`), 보이는 글(`innerText`), 숨은 요소를 포함한 글(스크립트·스타일 제외 텍스트 노드 — "터치해서 열기" 덮개 뒤 본문). 본문은 보이는 글을 쓰고, 보이는 글에 날짜 후보가 없는데 숨은 글에 있으면 숨은 글을 쓴다. 각 200,000자에서 자른다.
- **이미지 전용 페이지**: 제목·설명·본문에 날짜 후보(`11월 14일`·`2026.11.14`·`2026-11-14`·`11/14`·`11. 14.(토)`·영문 월 + 일)가 없거나 글이 0자면 **앱에서만** 화면을 최대 3화면 스냅샷(너비 390pt, 스크롤 뒤 0.6초 대기)해 기기 Vision OCR(ko-KR·en-US, accurate)로 읽는다. 스냅샷은 메모리에서만 쓰고 저장·전송하지 않는다.
- **사진 OCR**: 이미지를 메모리로 받아(`loadDataRepresentation`·`loadTransferable`) 한 장씩 ImageIO 축소본(긴 변 2,048px, EXIF 방향 반영)을 Vision(ko-KR·en-US, accurate)으로 읽고 바로 버린다. **이미지 파일·축소본은 App Group·디스크 어디에도 저장하지 않는다**(대기 행도 없다 — 확장이 죽으면 그 공유는 남지 않고 다시 공유하면 된다). OCR 글이 합쳐 10자 미만이면 "사진에서 글자를 찾지 못했어요"(큐에 넣지 않는다).
- **보내는 글(링크)**(큐 항목 1개, source `SHARE`, `app_name = "웹 링크"`, `title` = og:title, 없으면 document.title, 120자):

  ```text
  [웹 링크] <호스트>
  제목: <페이지 제목>
  설명: <OG 설명 300자 — 제목에 들어 있으면 생략>
  메모: <공유·채팅에 함께 적은 글 200자>
  일시·장소 줄:
  <본문이 넘칠 때만 — 본문 전체에서 날짜·시각·장소 단어가 있는 줄, 1,000자>
  본문:
  <줄 단위 — 공백 정리·같은 줄 제거, 남은 몫까지 앞쪽부터>
  이미지 속 글자:
  <OCR 1,500자>
  ```

  전체 4,000자(서버 추출 입력 상한과 같다 — 모델이 보지 않는 뒷부분은 보내지 않는다). 일시·장소 줄을 본문 **앞**에 두는 것은 서버 분류 게이트가 본문 앞 2,000자만 보기 때문이다(긴 갤러리·인사말 뒤의 날짜를 놓치지 않게). 주소는 **호스트만** — 경로·쿼리의 숫자가 OTP 규칙(`code` + 숫자)에 걸려 항목 전체가 폐기되는 것을 막고 초대 토큰을 남기지 않는다(대가: 보관함에서 원래 링크를 다시 열 수 없다, §16 UQ2). **짧은 페이지는 4,000자 안에 보이는 글 전체가 들어간다**(혼주 이름·전화번호 포함 — 계좌·카드 번호는 규칙이 마스킹) — 확장 상태 화면과 채팅 링크·사진 턴에 "읽은 글은 공유한 내용처럼 암호화해 보관해요. 짧은 페이지는 보이는 글 전체가 저장돼요."를 보인다.
- **보내는 글(사진)**(source `SHARE`, `app_name = "이미지"`, 제목 없음): `[이미지] 사진 N장` · `메모: …` · (넘칠 때만 `일시·장소 줄:`) · `이미지 속 글자:` + 사진마다의 OCR 줄(같은 줄 제거), 전체 4,000자. 그다음은 링크와 같다.
- 그다음은 지금 공유와 같다: 기기 규칙(연락처 규칙 없음) → 큐 → 업로드 → 서버 규칙·게이트·추출·제안(§7).
- **확장과 앱의 이어받기(링크)**: 관문 — 읽은 링크면 중복, 메모가 기기 규칙(OTP)에 걸리면 폐기(행도 만들지 않는다 — App Group에 인증번호를 남기지 않는다), 통과하면 마스킹한 메모로 진행. 확장은 렌더링 **전에** App Group 큐에 링크 대기 행(`kind = 'link'`, id `link:<캡처 id>`, 주소·메모·공유 시각, lease 60초)을 남긴다. 확장은 OCR 없이 10초 동안 읽고, 날짜 후보가 있으면 큐 항목을 넣고 행을 지운다. 시간 초과·로드 실패·웹 프로세스 종료·날짜 후보 없음·글 0자·[닫기]면 행을 앱에 넘기고(lease 즉시 만료) 시트에 "앱을 열면 다시 읽어요"를 보인다. 막힌 주소·HTTP 오류·이동 초과·https 불가는 다시 해도 같으므로 행을 지우고, **원래 공유 글을 지금처럼 텍스트 항목으로 넣는다**(주소만 공유했으면 주소 문자열 — 0.10.0과 같다). 확장이 죽으면 60초 뒤 행이 풀린다. 앱은 **foreground일 때만** 대기 행을 처리하고(백그라운드에서는 WebKit이 멈춘다), 남은 행의 다음 시도 시각이 2분 안이면 활성 상태에서 그때 다시 본다. 앱의 실패 중 시간 초과·로드 실패·웹 프로세스 종료·추출 실패는 백오프(30초×2ⁿ)로 다시 하고 3회째에 지운다. 읽는 중 앱이 비활성이 되면 읽기를 취소하고 행을 그대로 돌려놓는다(시도 수 증가 없음). 막힌 주소·HTTP 오류·이동 초과·https 불가·OCR까지 했는데 빈 페이지는 바로 지운다. 지울 때만 로컬 알림 1건("공유한 링크를 읽지 못했어요", 주소·제목 없음). 대기 행은 7일이 지나면 지운다(기기 밖으로 나가지 않고, 계정 삭제 때 큐 파일째 지운다). 확장은 앱을 열 수 없다(지원 경로 없음). 공유·붙여넣은 시각이 `occurred_at`(상대 날짜 기준일)이다. 확장이 넣은 항목의 업로드는 지금 공유와 같이 다음 flush(인텐트·BG refresh·무음 푸시·앱 활성화)다.
- **실기기 미확인(게이트)**: 공유 확장 안 WKWebView 동작은 시뮬레이터 게이트(Safari 공유 시트)에서, 확장 메모리 한도(렌더링·사진 OCR)는 0.11.0 실기기 게이트에서 판정한다. 실패하면 확장 렌더링을 끄고(`LinkFlow.renderInShareExtension = false` — 행만 남기고 "앱을 열면 읽어요") 앱만 읽는다. 확장 사진 OCR이 메모리로 죽으면 축소본을 App Group에 두고 앱에 넘기는 대안을 사용자에게 묻는다(이 소절의 "저장하지 않는다"가 바뀐다).
- **진단**: trace `share.link`(필드 `origin`·`result`·`code`·`elapsed_ms`·`chars`·`ocr`·`timed_out`·`blocked_nav`)·`share.image`(`origin`·`result`·`code`·`elapsed_ms`·`chars`·`images`)만. 주소·호스트·제목·본문·OCR 글은 로그·trace에 남기지 않는다.

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
      SHARE 항목(`app_name = "웹 링크"`, 제목 = 페이지 제목)으로, 사진은 기기 OCR 글이 SHARE 항목(`app_name = "이미지"`)으로 오고
      (§6 "링크·이미지 읽기") 다른 SHARE 항목과 같이 규칙 → 게이트 → 추출 → 제안을 탄다
```

- [ ] **Step 7: §8 items 행 비고 끝**

`(규칙 폐기는 null, M1-④a `0010`) |` →

```text
(규칙 폐기는 null, M1-④a `0010`). 링크 항목(2026-10-02)은 source `SHARE` + `app_name = '웹 링크'` + `title` = 페이지 제목, 본문 = 기기가 만든 발췌(≤4,000자, 첫 줄 `[웹 링크] <호스트>` — 짧은 페이지는 보이는 글 전체), 사진 항목은 `app_name = '이미지'` + 본문 = 기기 OCR 글(첫 줄 `[이미지] 사진 N장`), §6 "링크·이미지 읽기" — 새 source 없음, `idempotency_key` = `SHARE:<캡처 id>`(링크는 주소에서 정해져 같은 링크는 한 건) |
```

- [ ] **Step 8: §9 채팅 링크 붙여넣기·사진 첨부**

`- 채팅 음성 입력: 기기 안 받아쓰기(Speech, 온디바이스 전용, ko-KR), 서버 전송 없음 — 2026-10-01 사용자 요청. 받아쓴 글은 입력창에 채워질 뿐이고 보내기 전까지 전송되지 않는다(앱 0.6.0).` 줄 바로 아래에 넣는다:

```text
- **채팅 링크 붙여넣기(2026-10-02 사용자 결정, 앱 0.11.0)**: 입력에 `http://`·`https://`로 적힌 주소가 정확히 하나이고 나머지 글이 200자 이하이며 날짜 후보가 없으면 질문이 아니라 **링크 수집**이다 — `/chat`을 부르지 않고 앱이 페이지를 읽어(§6 "링크·이미지 읽기", 15초 + 필요하면 OCR) SHARE 항목으로 바로 올린다(나머지 글은 메모). 주소가 둘 이상이면 "링크는 한 번에 하나씩 보내 주세요"(입력은 남긴다). 긴 글·날짜가 있는 글 + 주소, 스킴 없는 도메인은 질문이다. 이미 읽은 링크(30일)면 읽지 않고 "이미 읽은 링크예요. 제안 탭에서 확인해 주세요". 링크 턴은 답 대신 상태 문구를 보인다: "링크를 읽는 중…" → "페이지에서 글 N자를 읽었어요. 일정을 찾는 중…"(아래에 저장 범위 한 줄 "읽은 글은 공유한 내용처럼 암호화해 보관해요. 짧은 페이지는 보이는 글 전체가 저장돼요.") → 처리 결과(3초마다 최대 60초 — 본인 `items.status`·`gate_label`·`facts` 종류만 읽는다): 일정 "일정 N건을 찾았어요 — '제안' 탭과 알림에서 추가할 수 있어요", 할 일 "할 일을 찾았어요 — 알림에서 확인하세요", 결과 없음 "이 페이지에서 일정을 찾지 못했어요", 게이트 격리 "분류에서 걸러졌어요 — 보관함 › 최근 폐기에서 복구할 수 있어요", 규칙 폐기(기기·서버) "보안 숫자로 보이는 내용이 있어 저장하지 않았어요", 60초 초과 "아직 처리 중이에요 — 끝나면 알림으로 알려 드려요", 읽기 실패 "페이지를 읽지 못했어요(<사유>)", 다시 해 볼 실패 "지금은 다 읽지 못했어요(<사유>). 잠시 뒤 다시 읽고, 일정을 찾으면 알림으로 알려 드려요", 읽는 중 앱을 떠남 "앱으로 돌아오면 다시 읽어요". 링크 턴에는 일정 답 카드·"보관함에서 보기"·맞아요/틀렸어요 막대가 없다(제안은 "제안" 탭·알림).
- **채팅 사진 첨부(2026-10-02 사용자 결정, 앱 0.11.0)**: "+" 메뉴 "사진에서 일정 읽기" → `PhotosPicker`(이미지, 최대 3장). 앱이 사진을 메모리로 받아 기기 OCR한 글만 SHARE 항목(`app_name = "이미지"`)으로 올린다(§6 "링크·이미지 읽기" — 파일은 저장·전송하지 않는다). 입력창 글은 메모. 사진 턴은 링크 턴과 같은 상태 문구를 쓴다: "사진에서 글자를 읽는 중…" → "사진에서 글 N자를 읽었어요. 일정을 찾는 중…" → 처리 결과(결과 없음은 "이 사진에서 일정을 찾지 못했어요"), 글자가 없으면 "사진에서 글자를 찾지 못했어요". 파일 업로드·서버 vision은 2단계다.
```

- [ ] **Step 8b: §9 일정 답 카드 출처 문구**

`그 밖의 앱 알림 "<앱 이름> 알림", 공유 "공유한 내용", 못 찾으면 "저장된 정보")` →

```text
그 밖의 앱 알림 "<앱 이름> 알림", 공유 "공유한 내용"(링크 항목 `app_name = '웹 링크'`는 "공유한 링크", 사진 항목 `app_name = '이미지'`는 "공유한 이미지", 0.11.0 — 보관함 출처도 같다), 못 찾으면 "저장된 정보")
```

- [ ] **Step 9: §10 일정 위치**

`- 채팅에서 "기억해줘"와 "캘린더에 추가"는 별개 동작이다.` 줄 바로 아래에 넣는다:

```text
- **일정 위치(2026-10-02, 앱 0.11.0)**: 제안 payload의 `location`(추출한 장소·주소 그대로)이 있으면 EventKit 일정의 위치(`location`, 문자열)에 넣는다. 경로는 "제안" 탭 행·배너 탭 시트(목록 값)·채팅 일정 답 카드다. 잠금화면 "캘린더에 추가"와 목록에 없어 알림 값으로 추가하는 경로는 푸시 페이로드에 위치가 없어 위치 없이 저장한다(서버 notify에 위치를 싣는 것은 다음 단계 후보). 위치는 표식·겹침·비슷한 일정 판정에 쓰지 않는다.
```

- [ ] **Step 10: §11 타깃 표·버전**

`| `ShareExtension` | 입력 수신 → 큐 |` →

```text
| `ShareExtension` | 입력 수신 → 큐. 웹 주소 하나 + 짧은 메모면 링크 읽기(§6) 뒤 큐(못 읽으면 대기 행을 앱에 넘기고, 확정 실패면 텍스트로), 사진은 기기 OCR 글을 큐(파일 저장 없음) |
```

`광고 메일 구독 해지 화면(설정 Gmail 절 → 목록)은 0.10.0, 요약·저장 공간 화면은 서버 반영 뒤라 0.11.0)` →

```text
광고 메일 구독 해지 화면(설정 Gmail 절 → 목록)은 0.10.0, 링크·이미지 → 일정(공유 시트·채팅 붙여넣기·채팅 사진)은 0.11.0, 요약·저장 공간 화면은 서버 반영 뒤라 0.12.0)
```

- [ ] **Step 11: §12 통제 2**

`- URL 본문·이미지 OCR·채팅 발화도 서버 규칙 필터(OTP·카드·계좌)를 같은 함수로 통과시킨 뒤 저장한다. URL 본문은 fetch 직후, OCR은 기기에서 이미 적용된 것을 서버에서 재적용한다.` →

```text
- 링크 본문(기기 렌더링·OCR)·사진 OCR·채팅 발화도 서버 규칙 필터(OTP·카드·계좌)를 같은 함수로 통과시킨 뒤 저장한다. 링크 본문과 OCR은 기기 규칙을 거쳐 올라오고 서버가 재적용한다(서버는 URL을 가져오지 않고 이미지를 받지 않는다, 2026-10-02).
- **링크·이미지 읽기(2026-10-02)**: 페이지는 사용자 기기가 연다 — 사이트는 기기 IP를 본다(브라우저로 여는 것과 같다). 웹뷰는 비영속 저장소(쿠키·로그인 없음). 서버로 가는 것은 발췌(≤4,000자)·페이지 제목·호스트, 사진은 OCR 글(≤4,000자)뿐이고 경로·쿼리·페이지 전체·이미지·스냅샷·사진 파일은 보내지도 저장하지도 않는다. **짧은 페이지는 보이는 글 전체가 발췌가 된다**(혼주 이름·전화번호 포함, 계좌·카드 번호는 마스킹) — 화면에 알린다. 발췌·OCR 글은 다른 항목과 같이 암호화 3년·요약·청크(§8, 청크 평문 기간은 UC-1). Jev·OpenAI로 가는 것은 다른 SHARE 항목과 같다(새 수신자 없음). 기기에는 이어받기용 링크 대기 행(전체 주소·규칙을 거친 메모, 최대 7일)과 읽은 링크 기록(캡처 id·만료 시각, 30일)만 남는다 — 메모는 행을 만들기 전에 기기 규칙을 거쳐 OTP면 행을 만들지 않는다. 하위 리소스의 사설 IP 리터럴·로컬 이름 요청은 막지만 공개 이름이 사설 주소로 풀리는 경우는 막지 않는다(기기 위생 범위, 브라우저와 같음). 로그·trace에는 결과 코드·글자 수·장 수만(주소·호스트·제목 없음). 저장 범위는 메인 판정(2026-10-02, 기존 항목 규칙 — 사용자 재검토 가능), 주소 범위(호스트만)는 기본값(§16 "2026-10-02 링크·이미지 → 일정" UQ1·UQ2).
```

- [ ] **Step 12: §15 1단계 추가 범위·2단계 행·확장 후보**

`Outlook 커넥터 인터페이스는 만들지 않는다.` 줄 바로 앞(빈 줄 하나 두고)에 넣는다:

```text
**1단계 추가 범위(2026-10-02 링크·이미지 → 일정 결정, §16)**: 청첩장·초대장·행사 페이지 링크를 공유 시트·채팅 붙여넣기로 받아 기기가 렌더링해 읽고, 사진(공유 시트·채팅 "+", 최대 3장)은 기기 OCR 글만 받아(§6 "링크·이미지 읽기") 기존 SHARE 경로로 일정 제안, EventKit 일정 위치(§10). 계획 `docs/superpowers/plans/2026-10-02-link-event.md`, 앱 0.11.0. **서버 변경·배포 없음**(새 source·마이그레이션 없음) — Gmail 측정 기간 제약은 배포된 함수를 호출하는 평가·시뮬레이터 게이트의 측정 창(③c1·③c2) 회피뿐이다. TestFlight는 0.10.0(광고 해지) TestFlight 뒤. M2 게이트와 독립.

```

2단계 행의 `이미지·PDF 공유 파일 경로(`PUT upload/<id>`, PoC-8 이월)·vision + OCR` →

```text
이미지·PDF 공유 파일 경로(`PUT upload/<id>`, PoC-8 이월)·vision + OCR(1단계 0.11.0의 사진은 기기 OCR 글만 — §6 "링크·이미지 읽기")
```

확장 후보의 `- 링크 → 일정 제안(청첩장·초대장·행사 페이지, **사용자가 필요하다고 함**, 2026-10-02): …` 한 줄(전체)을 이것으로 바꾼다:

```text
- 링크 → 일정 제안(청첩장·초대장·행사 페이지): 2026-10-02 사용자 결정으로 1단계 추가 범위(위)로 옮겼다 — 서버 가져오기 대신 기기 렌더링(방식 A), 사진은 기기 OCR(§6 "링크·이미지 읽기").
```

여행 글 후보의 `서버가 본문 가져오기(네이버 블로그 모바일 주소·티스토리·일반 HTML)` →

```text
기기 렌더러로 본문 읽기(§6 "링크·이미지 읽기" 공유 — 서버는 URL을 가져오지 않는다, 2026-10-02)
```

`요약·저장 공간 화면은 앱 0.11.0이다(0.9.x는 다건·종일·중복 일정, 0.10.0은 광고 구독 해지).` →

```text
요약·저장 공간 화면은 앱 0.12.0이다(0.9.x는 다건·종일·중복 일정, 0.10.0은 광고 구독 해지, 0.11.0은 링크·이미지 → 일정).
```

- [ ] **Step 13: §16 버전 행·새 소절**

`(→ 0.11.0, 2026-10-01 광고 구독 해지)(§11) |` →

```text
(→ 0.11.0, 2026-10-01 광고 구독 해지)(→ 0.12.0, 2026-10-02 링크·이미지 → 일정)(§11) |
```

`### 플랜 B: 로컬 우선 구조 (미채택, 신뢰 문제 발생 시 전환)` 줄 바로 앞(빈 줄 하나 두고)에 넣는다:

```text
### 2026-10-02 링크·이미지 → 일정 (사용자 결정, 앱 0.11.0)

청첩장·초대장·행사 페이지 링크에서 일정 제안을 받고 싶다(사용자가 필요하다고 함). 입력은 공유 시트와 채팅 붙여넣기 둘 다, 그리고 같은 날 추가 요구로 **사진 공유·채팅 사진 첨부**도. **방식 A: 기기가 렌더링해 읽는다** — 서버는 외부 URL을 가져오지 않는다. 사진은 **기기 OCR 글만** 보낸다 — 서버로 이미지를 올리지 않는다(§6 "링크·이미지 읽기"). 기각: (1) 서버 가져오기(§15 후보 원안) — SSRF 방어·DNS 재바인딩(§12 통제 3과 같은 수용 위험)을 새로 지고, JS로 글을 그리는 모바일 청첩장을 못 읽는다 (2) 새 source `LINK` — `items.source` check 제약·ingest·앱 출처 표시·채팅 필터를 모두 바꾸고 배포가 필요한데 처리 경로는 SHARE와 같다 (3) 확장만 렌더링 — 확장 안 WKWebView·메모리 한도가 미확인이고 확장은 앱을 열 수 없어 실패하면 길이 없다 → 확장 + 앱 대기 행 이어받기 (4) iOS 26 `WebPage` 단독 사용 — 뷰 없이 쓸 수 있으나 비가시 스로틀이 미확인 (5) 서버 vision으로 이미지 청첩장·사진 — 제품에 이미지 업로드 경로가 없다(2단계) → 기기 OCR (6) 사진을 App Group에 두고 앱이 읽기 — 규칙 통과 전 영속화가 된다(§6) → 확장이 그 자리에서 OCR, 실기기 메모리 게이트 실패 때만 다시 묻는다 (7) 주소 하나만 있으면 무조건 링크 — 주소가 든 긴 공지·일정 문자가 메모로 잘리고 페이지 실패 시 사라진다(외부 리뷰 F1) → 나머지 글이 짧고 날짜가 없을 때만 (8) ATS 예외로 http 로드 — 평문 로드를 열 이유가 약하다 → https로 올린다. 계획이 정한 것: 저장은 기존 항목 규칙(발췌 ≤4,000자 암호화 3년·요약·청크 — 짧은 페이지는 보이는 글 전체, 화면에 명시), 주소는 호스트만, 이미지 전용 페이지는 앱 OCR(확장은 OCR 없음, 글 0자 페이지도 OCR), 일시·장소 줄은 본문 앞(게이트가 앞 2,000자만 봄), 같은 링크는 주소에서 정해진 id + 기기 읽은 링크 기록(30일)으로 "이미 읽은 링크예요", 앱 이어받기는 재시도(3회)·확정 실패 구분과 비활성 전환 시 행 유지, 대기 행 7일, 렌더러 절대 상한(확장 12초·앱 25초), 확장 확정 실패는 텍스트 폴백, 사진은 최대 3장·한 항목·파일 비저장, 일정 위치는 EventKit에(잠금화면 경로 제외). **메인 판정(사용자 위임 범위, 사용자 재검토 가능)**: UQ1 저장 범위 A 유지 + 문구 명시, 같은 링크 재입력은 중복, 이미지 입력 0.11.0 포함. **기본값으로 진행**: UQ2 주소 범위(호스트만 / 전체 주소 — 서버 규칙 변경), UQ3 채팅 판정(주소 1개 + 짧은 메모 / 입력 전체가 주소일 때만). 미확인 전제(공유 확장 안 WKWebView — 시뮬레이터 게이트, 창 안·화면 밑 렌더링, 확장 메모리(렌더링·사진 OCR), 시뮬레이터 Vision 한국어, 실제 청첩장 서비스 형태, Jev 게이트 통과(대화 캡처 사진 포함))는 0.11.0 게이트(`LNK-eval`·`LNK-sim`·`LNK-device`)가 판정한다. 개인정보 등급 변화: 새 수신자 없음(Jev·OpenAI는 SHARE와 같다), 페이지는 사용자 기기가 연다, 사진 파일은 기기를 떠나지 않는다. 외부 리뷰 판정은 위 "외부 리뷰 반영 (링크 → 일정 계획 …)".

```

- [ ] **Step 14: 보관 계획 R-B9 버전 4곳**

`docs/superpowers/plans/2026-10-01-retention-summary.md`:
- `**R-B9 = 0.11.0**(스펙 §11 — 0.10.0은 광고 구독 해지 계획 `2026-10-01-gmail-unsubscribe.md`)` → `**R-B9 = 0.12.0**(스펙 §11 — 0.10.0은 광고 구독 해지 계획 `2026-10-01-gmail-unsubscribe.md`, 0.11.0은 링크·이미지 → 일정 계획 `2026-10-02-link-event.md`)`
- `# R-A2 0.7.0 / R-B9 0.11.0` → `# R-A2 0.7.0 / R-B9 0.12.0`
- `버전: `MARKETING_VERSION: 0.11.0`(0.10.0은 광고 구독 해지 계획 — `git log --oneline -- ios/project.yml`로 0.10.0이 main에 있는지 확인하고, 없으면 메인에게 알린다).` → `버전: `MARKETING_VERSION: 0.12.0`(0.10.0은 광고 구독 해지, 0.11.0은 링크·이미지 → 일정 계획 — `git log --oneline -- ios/project.yml`로 0.11.0이 main에 있는지 확인하고, 없으면 메인에게 알린다).`
- `보관·요약·용량은 Gmail 게이트 뒤(0.11.0 — 0.10.0은 광고 구독 해지 계획)` → `보관·요약·용량은 Gmail 게이트 뒤(0.12.0 — 0.10.0은 광고 구독 해지, 0.11.0은 링크·이미지 → 일정 계획)`

- [ ] **Step 15: 확인**

Run:

```bash
S=docs/superpowers/specs/2026-09-22-assistant-design.md
grep -c '링크·이미지 읽기' $S                             # 8 이상
grep -n '허용 스킴 http(s)만, 사설·루프백 IP 차단' $S     # 0줄
grep -n '0.12.0' $S | wc -l                              # 3 이상(§11·§15·§16)
grep -n '사용자가 필요하다고 함' $S                        # 0줄(후보 문단 교체)
grep -c '짧은 페이지는 보이는 글 전체' $S                  # 3 이상(§6·§12·§16)
grep -c '이미 읽은 링크예요' $S                            # 2 이상(§6·§9)
grep -n 'R-B9 = 0.12.0\|R-B9 0.12.0\|MARKETING_VERSION: 0.12.0\|(0.12.0 —' docs/superpowers/plans/2026-10-01-retention-summary.md | wc -l   # 4
grep -n '0\.11\.0' docs/superpowers/plans/2026-10-01-retention-summary.md   # 남은 줄은 "0.11.0은 링크·이미지 → 일정" 설명뿐
```

- [ ] **Step 16: 커밋**

```bash
git add docs/superpowers/specs/2026-09-22-assistant-design.md docs/superpowers/plans/2026-10-01-retention-summary.md
git commit -m "docs(spec): link and image → event proposals (user decision, method A + image input, app 0.11.0) — §6 link and image reading on device: share sheet or chat paste with exactly one http(s) URL and a short note (≤200 chars, no date; longer or dated text stays text/question), same link = URL-derived capture id + 30-day link_seen record (already read), hidden WKWebView in the window under other views (non-persistent store, no autoplay, app-scheme/new-window blocked, main and subframe address check, content rules for private subresources, http upgraded to https, insecure on TLS failure), settle on 3 equal innerText lengths (0 chars after didFinish + 4 s) within 10 s (extension) / 15 s (app) and an absolute limit (12 s / 25 s), app-only snapshot OCR when no date or no text, one SHARE item (app_name 웹 링크, host only, date/place lines before the body, ≤4,000 chars — short pages store all visible text, shown on screen), pending row gate (note screened before the row), extension hand-off with 7-day expiry, app retry ×3 vs final failures, cancel on leaving active keeps the row, text fallback on final failure in the extension; photos (share sheet, chat PhotosPicker, max 3) read by on-device Vision from memory only (no file, no upload, app_name 이미지); §7 server never fetches URLs or receives images; §9 chat link/photo turn states; §10 EventKit location; §11/§15 0.11.0 and R-B9 0.12.0; §12 privacy; §16 decision, rejected options, main rulings and defaults

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task L1: EruriCore `LinkText`·`LinkPage`·`LinkSettle`·`ImageText` (순수 로직)

**Files:**
- Create: `ios/Packages/EruriCore/Sources/EruriCore/LinkText.swift`
- Create: `ios/Packages/EruriCore/Sources/EruriCore/ImageText.swift`(LI1)
- Test: `ios/Packages/EruriCore/Tests/EruriCoreTests/LinkTextTests.swift`, `ios/Packages/EruriCore/Tests/EruriCoreTests/ImageTextTests.swift`

**Interfaces:**
- Consumes: 없음(Foundation·CryptoKit만).
- Produces:
  - `LinkText.maxChars = 4000`·`tailKeyChars = 1000`·`ocrMaxChars = 1500`·`titleMaxChars = 120`·`descMaxChars = 300`·`noteMaxChars = 200`·`appName = "웹 링크"`·`keyHeader = "일시·장소 줄:"`
  - `LinkText.webURLs(in: String) -> [URL]`
  - `enum LinkText.Candidate: Equatable { case none, link(URL, note: String?), tooMany(Int), text }` · `LinkText.linkCandidate(_ text: String) -> Candidate`(D5 — 주소 1개 + 짧은 메모만 `link`, 긴 글·날짜 있는 글 + 주소 1개는 `text`)
  - `enum LinkText.ChatIntent: Equatable { case none, link(URL, note: String?), tooMany(Int) }` · `LinkText.chatIntent(_ input: String) -> ChatIntent`
  - `LinkText.shareLink(_ composed: String) -> (url: URL, note: String?)?`
  - `enum LinkText.Blocked: String { case scheme, host }` · `LinkText.check(_ url: URL, allowLoopback: Bool) -> Blocked?`
  - `LinkText.upgraded(_ url: URL, allowLoopback: Bool) -> URL`(http → https, DEBUG 루프백 제외)
  - `LinkText.captureID(for url: URL) -> String`(D14 — 같은 링크 = 같은 UUID 문자열)
  - `LinkText.hasDateCandidate(_ s: String) -> Bool`
  - `struct LinkText.Composed: Equatable { title: String?; text: String; bodyChars: Int; truncated: Bool }` · `LinkText.compose(_ page: LinkPage, note: String?) -> Composed`
  - `LinkText.fit(_ lines: [String], budget: Int) -> (keys: String, body: String, truncated: Bool)`·`lines(_:)`·`oneLine(_:)`·`clip(_:_:)`(모듈 안 — `ImageText`가 쓴다)
  - `struct LinkPage: Equatable, Sendable { host, title, description, visibleText, allText: String; ocrText: String?; timedOut: Bool; body; searchable; isEmpty; static decode(json:host:) -> LinkPage? }` — init 인자는 `host` 외 전부 기본값
  - `struct LinkSettle { static pollInterval: Duration = .milliseconds(500); static stableSamples = 3; static finishGrace: TimeInterval = 4; enum Decision { wait, done, deadline }; init(budget:); mutating observe(length:finished:elapsed:) -> Decision }`
  - `enum ImageText { appName = "이미지"; maxImages = 3; minChars = 10; enum Composed { text(String, truncated: Bool), empty }; static compose(ocr: [String], images: Int, note: String?) -> Composed }`

- [ ] **Step 1: 실패하는 테스트**

`ios/Packages/EruriCore/Tests/EruriCoreTests/LinkTextTests.swift`:

```swift
import XCTest
@testable import EruriCore

/// 링크 → 일정(스펙 §6 "링크·이미지 읽기"): 판정·주소 검사·같은 링크 id·날짜 후보·본문 만들기·대기 판정. 글은 모두 합성
final class LinkTextTests: XCTestCase {
  let invite = URL(string: "https://invite.example.com/m/abc?code=482913")!

  /// 채팅(스펙 §9): http(s):// 주소가 정확히 하나 + 짧은 메모면 링크 수집. 둘 이상은 안내, 스킴 없는 도메인은 질문
  func testChatIntent() {
    XCTAssertEqual(LinkText.chatIntent("https://invite.example.com/m/abc?code=482913"), .link(invite, note: nil))
    XCTAssertEqual(LinkText.chatIntent("청첩장 https://invite.example.com/m/abc?code=482913 이에요"), .link(invite, note: "청첩장 이에요"))
    XCTAssertEqual(LinkText.chatIntent("내일 치과 몇 시야?"), .none)
    XCTAssertEqual(LinkText.chatIntent("naver.com 에서 산 거 언제야"), .none)
    XCTAssertEqual(LinkText.chatIntent("ftp://files.example.com/x"), .none)
    XCTAssertEqual(LinkText.chatIntent("https://a.example.com/1 https://b.example.com/2"), .tooMany(2))
    XCTAssertEqual(LinkText.chatIntent("https://a.example.com/1 다시 https://a.example.com/1"),
                   .link(URL(string: "https://a.example.com/1")!, note: "다시"))               // 같은 주소 두 번은 하나
    // 주소에 한글이 붙어 있다 — 첫 비 ASCII 글자에서 주소가 끝난다(NSDataDetector 경계를 고정)
    XCTAssertEqual(LinkText.chatIntent("https://a.example.com/1이에요"), .link(URL(string: "https://a.example.com/1")!, note: "이에요"))
    // 끝 ?·: 는 주소가 아니다(리뷰 Minor 3), 영숫자·한글 없는 메모는 없음(Minor 4)
    let one = URL(string: "https://a.example.com/1")!
    XCTAssertEqual(LinkText.chatIntent("https://a.example.com/1?"), .link(one, note: nil))
    XCTAssertEqual(LinkText.chatIntent("https://a.example.com/1:"), .link(one, note: nil))
    XCTAssertEqual(LinkText.chatIntent("여기 https://a.example.com/1?"), .link(one, note: "여기 ?"))
    XCTAssertEqual(LinkText.chatIntent("(https://a.example.com/1)"), .link(one, note: nil))
    XCTAssertEqual(LinkText.chatIntent("\"https://a.example.com/1\"."), .link(one, note: nil))
  }

  /// 공유(스펙 §6): ShareText.compose 결과에 주소가 정확히 하나 + 짧은 메모일 때만 링크. 나머지는 지금처럼 텍스트 공유
  func testShareLink() {
    let one = LinkText.shareLink("합성 청첩장\nhttps://invite.example.com/m/abc?code=482913")
    XCTAssertEqual(one?.url, invite)
    XCTAssertEqual(one?.note, "합성 청첩장")
    XCTAssertNil(LinkText.shareLink("[합성] 10월 20일 오후 2시 회의"))
    XCTAssertNil(LinkText.shareLink("https://a.example.com/1\nhttps://b.example.com/2"))
  }

  /// 주소 하나가 든 긴 공지·날짜가 있는 글은 링크가 아니다(Fable F1 — 본문이 메모로 잘리고 페이지 실패 시 사라지는 회귀 방지)
  func testLongTextWithURLIsNotALink() {
    let notice = String(repeating: "합성 동호회 공지 내용입니다. ", count: 12) + "자료 https://docs.example.com/a"
    XCTAssertEqual(LinkText.linkCandidate(notice), .text)
    XCTAssertNil(LinkText.shareLink(notice))
    XCTAssertEqual(LinkText.chatIntent(notice), .none)
    let dated = "10월 20일 오후 2시 회의, 자료 https://docs.example.com/a"
    XCTAssertEqual(LinkText.linkCandidate(dated), .text)
    XCTAssertNil(LinkText.shareLink(dated))
    XCTAssertEqual(LinkText.chatIntent(dated), .none)
    XCTAssertEqual(LinkText.linkCandidate("합성 공지"), .none)
  }

  /// 주소 검사(스펙 §6): http(s)만, 사설·루프백·링크로컬·CGNAT IP 리터럴과 로컬 이름 거부. DEBUG 게이트만 루프백 허용
  func testCheck() {
    func c(_ s: String, loop: Bool = false) -> LinkText.Blocked? { LinkText.check(URL(string: s)!, allowLoopback: loop) }
    XCTAssertNil(c("https://invite.example.com/x"))
    XCTAssertNil(c("http://invite.example.com/x"))                                            // 검사 통과 — 실제 로드는 https 로 올린다(L3, upgraded)
    XCTAssertNil(c("http://93.184.216.34/"))
    XCTAssertNil(c("https://[2606:4700::1111]/"))
    XCTAssertEqual(c("kakaolink://send?x=1"), .scheme)
    XCTAssertEqual(c("file:///etc/hosts"), .scheme)
    for h in ["http://10.0.0.1/", "http://192.168.0.1/", "http://172.20.1.1/", "http://169.254.1.1/", "http://100.64.0.1/",
              "http://0.0.0.0/", "http://224.0.0.1/", "http://127.0.0.1:8765/", "http://localhost:8765/", "http://router.local/",
              "http://intranet/", "http://svc.internal/", "http://[::1]/", "http://[fe80::1]/", "http://[fd00::1]/", "http://[2001:db8::1]/"] {
      XCTAssertEqual(c(h), .host, h)
    }
    // WebKit(WHATWG)이 IPv4 로 정규화하는 변형(리뷰 Minor 2): 끝 점·축약·16진·8진(앞 0) — 엄격한 10진 4부가 아니면 막는다
    for h in ["http://127.0.0.1./", "http://192.168.0.1./", "http://127.1/", "http://0x7f.0.0.1/", "http://0177.0.0.1/",
              "http://012.0.0.1/", "http://2130706433/", "http://[2002:c0a8:1::1]/"] {
      XCTAssertEqual(c(h), .host, h)
    }
    XCTAssertNil(c("http://93.184.216.34./"))
    XCTAssertNil(c("https://a1.example.com/"))
    XCTAssertNil(c("http://127.0.0.1:8765/link-wedding.html", loop: true))
    XCTAssertNil(c("http://localhost:8765/link-wedding.html", loop: true))
    XCTAssertEqual(c("http://10.0.0.1/", loop: true), .host)                                   // 루프백만 풀린다
  }

  /// http 는 https 로 올려 연다(F24 — 앱·확장에 ATS 예외가 없다). DEBUG 루프백만 그대로
  func testUpgraded() {
    func u(_ s: String, loop: Bool = false) -> String { LinkText.upgraded(URL(string: s)!, allowLoopback: loop).absoluteString }
    XCTAssertEqual(u("http://invite.example.com/m/abc?code=1"), "https://invite.example.com/m/abc?code=1")
    XCTAssertEqual(u("http://invite.example.com:80/x"), "https://invite.example.com/x")
    XCTAssertEqual(u("https://invite.example.com/x"), "https://invite.example.com/x")
    XCTAssertEqual(u("http://127.0.0.1:8765/a.html", loop: true), "http://127.0.0.1:8765/a.html")
    XCTAssertEqual(u("http://127.0.0.1:8765/a.html"), "https://127.0.0.1:8765/a.html")        // 어차피 check 가 막는다
  }

  /// 같은 링크 = 같은 캡처 id(스펙 §6 "같은 링크"): 조각·스킴(http/https)·호스트 대소문자는 무시, 쿼리는 구분
  func testCaptureID() {
    let a = LinkText.captureID(for: URL(string: "https://invite.example.com/m/abc?code=1#gallery")!)
    let b = LinkText.captureID(for: URL(string: "http://INVITE.example.com/m/abc?code=1")!)
    let c = LinkText.captureID(for: URL(string: "https://invite.example.com/m/abc?code=2")!)
    XCTAssertEqual(a, b)
    XCTAssertNotEqual(a, c)
    XCTAssertNotNil(UUID(uuidString: a))
    XCTAssertEqual(a, LinkText.captureID(for: URL(string: "https://invite.example.com/m/abc?code=1")!))   // 실행마다 같다
    XCTAssertEqual(LinkText.captureID(for: URL(string: "https://a.example.com")!),
                   LinkText.captureID(for: URL(string: "https://a.example.com/")!))            // 빈 경로 = "/"(리뷰 Minor 3)
  }

  func testDateCandidates() {
    for s in ["2026년 11월 14일 토요일", "11월 14일", "2026.11.14", "2026-11-14", "2026. 12. 5. SAT", "11/14", "11. 14.(토)",
              "Nov 14, 2026", "December 5"] {
      XCTAssertTrue(LinkText.hasDateCandidate(s), s)
    }
    for s in ["오후 1시 30분", "합성웨딩홀 3층", "010-1234-5678", "터치하면 음악이 재생됩니다", "축의금 50,000원",
              "market 5", "decent 3", "Junior 2", "Marathon 10"] {
      XCTAssertFalse(LinkText.hasDateCandidate(s), s)
    }
    for s in ["11 . 14 . ( 토", "11.14.\n(토)", "Sept 5", "March 3", "Dec. 24"] { XCTAssertTrue(LinkText.hasDateCandidate(s), s) }
  }

  /// 날짜 후보는 정리 전 원문(숨은 글 200,000자까지)에 돈다 — "1.1" + 공백 5만 자가 2차 백트래킹으로 수십 초 걸리지 않는다(리뷰 I1).
  /// 고치기 전 실측 4만 자 27초. 상한은 스왑 포화를 감안한 5초(계획 "기계")
  func testDateCandidateWhitespaceFloodIsFast() {
    let flood = "1.1" + String(repeating: " \n", count: 25_000)
    let t0 = Date()
    XCTAssertFalse(LinkText.hasDateCandidate(flood))
    let p = LinkPage(host: "x.example.com", visibleText: "합성", allText: flood)
    _ = p.body; _ = p.isEmpty
    XCTAssertLessThan(Date().timeIntervalSince(t0), 5)
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

  /// 보내는 글 형식(스펙 §6): 머리 줄 → 본문(공백 정리·같은 줄 제거). 메모는 한 줄로. 넘치지 않으면 일시·장소 줄 블록이 없다
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

  /// 긴 페이지(Fable F2): 일시·장소 줄을 본문 **앞**에 둔다 — 서버 Jev 게이트는 본문 앞 2,000자만 본다(F23). 전체 4,000자
  func testComposeTruncatesAndKeepsKeyLinesFirst() throws {
    let filler = (1...400).map { "합성 갤러리 사진 설명 \($0)번" }
    let p = LinkPage(host: "h.example.com",
                     visibleText: (filler + ["예식 일시 2026년 11월 14일 오후 1시", "장소 합성웨딩홀 3층", "방명록 남기기"]).joined(separator: "\n"))
    let c = LinkText.compose(p, note: nil)
    XCTAssertTrue(c.truncated)
    XCTAssertLessThanOrEqual(c.text.count, LinkText.maxChars)
    XCTAssertTrue(c.text.contains("일시·장소 줄:\n예식 일시 2026년 11월 14일 오후 1시\n장소 합성웨딩홀 3층\n본문:\n합성 갤러리 사진 설명 1번\n"))
    let key = try XCTUnwrap(c.text.range(of: "예식 일시"))
    XCTAssertLessThan(c.text.distance(from: c.text.startIndex, to: key.lowerBound), 2000)
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

  /// 대기(스펙 §6): didFinish(또는 4초) 뒤 같은 길이 3번이면 완료
  func testSettle() {
    var s = LinkSettle(budget: 10)
    XCTAssertEqual(s.observe(length: 0, finished: false, elapsed: 0.5), .wait)
    XCTAssertEqual(s.observe(length: 120, finished: true, elapsed: 1.0), .wait)
    XCTAssertEqual(s.observe(length: 120, finished: true, elapsed: 1.5), .wait)
    XCTAssertEqual(s.observe(length: 120, finished: true, elapsed: 2.0), .done)
    var g = LinkSettle(budget: 10)
    for t in [0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5] { XCTAssertEqual(g.observe(length: 80, finished: false, elapsed: t), .wait) }
    XCTAssertEqual(g.observe(length: 80, finished: false, elapsed: 4.0), .done)
    // didFinish 전 샘플은 "3번 같음"에 들지 않는다(스펙 §6 "didFinish 뒤 … 3번") — HTML 의 고정 "로딩 중…" 글에서 바로 끝내지 않는다
    var h = LinkSettle(budget: 10)
    XCTAssertEqual(h.observe(length: 120, finished: false, elapsed: 0.5), .wait)
    XCTAssertEqual(h.observe(length: 120, finished: false, elapsed: 1.0), .wait)
    XCTAssertEqual(h.observe(length: 120, finished: true, elapsed: 1.5), .wait)
    XCTAssertEqual(h.observe(length: 120, finished: true, elapsed: 2.0), .wait)
    XCTAssertEqual(h.observe(length: 120, finished: true, elapsed: 2.5), .done)
  }

  /// 글 0자(Codex 1 — 순수 이미지 페이지): didFinish **뒤** 4초가 지나야 완료(스펙 §6 "대기" — SPA 가 그릴 시간). didFinish 전 0자는 계속 기다린다
  func testSettleEmptyPage() {
    var e = LinkSettle(budget: 10)
    for t in stride(from: 1.0, through: 4.5, by: 0.5) { XCTAssertEqual(e.observe(length: 0, finished: true, elapsed: t), .wait, "\(t)") }
    XCTAssertEqual(e.observe(length: 0, finished: true, elapsed: 5.0), .done)
    // 늦은 didFinish(느린 망, 5초): 로드 시작 기준이 아니라 didFinish 기준 4초 — 9초에 완료
    var l = LinkSettle(budget: 10)
    for t in stride(from: 0.5, through: 4.5, by: 0.5) { XCTAssertEqual(l.observe(length: 0, finished: false, elapsed: t), .wait, "\(t)") }
    for t in stride(from: 5.0, through: 8.5, by: 0.5) { XCTAssertEqual(l.observe(length: 0, finished: true, elapsed: t), .wait, "\(t)") }
    XCTAssertEqual(l.observe(length: 0, finished: true, elapsed: 9.0), .done)
    var n = LinkSettle(budget: 10)
    for t in stride(from: 0.5, through: 9.5, by: 0.5) { XCTAssertEqual(n.observe(length: 0, finished: false, elapsed: t), .wait) }
    XCTAssertEqual(n.observe(length: 0, finished: false, elapsed: 10), .deadline)
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

`ios/Packages/EruriCore/Tests/EruriCoreTests/ImageTextTests.swift`:

```swift
import XCTest
@testable import EruriCore

/// 사진 → 일정(스펙 §6 "링크·이미지 읽기", LI1): 사진마다의 OCR 글을 한 항목 본문으로. 글은 모두 합성
final class ImageTextTests: XCTestCase {
  func testComposeFormat() {
    let c = ImageText.compose(ocr: ["합성동훈 그리고 합성미래\n2026년 12월 19일 토요일 오후 3시", "합성웨딩홀 5층\n2026년 12월 19일 토요일 오후 3시"],
                              images: 2, note: " 청첩장 \n 사진 ")
    XCTAssertEqual(c, .text("""
      [이미지] 사진 2장
      메모: 청첩장 사진
      이미지 속 글자:
      합성동훈 그리고 합성미래
      2026년 12월 19일 토요일 오후 3시
      합성웨딩홀 5층
      """, truncated: false))
  }

  /// 글자가 없는 사진(공백 제외 10자 미만)은 empty — 큐에 넣지 않는다
  func testEmpty() {
    XCTAssertEqual(ImageText.compose(ocr: [], images: 1, note: nil), .empty)
    XCTAssertEqual(ImageText.compose(ocr: ["", "  가 나 "], images: 2, note: "청첩장"), .empty)
  }

  /// 긴 OCR(캡처 여러 장): 일시·장소 줄을 앞에(게이트 2,000자, F23), 전체 4,000자
  func testKeyLinesFirstWhenLong() throws {
    let filler = (1...300).map { "합성 갤러리 사진 설명 \($0)번" }.joined(separator: "\n")
    guard case .text(let t, let truncated) = ImageText.compose(ocr: [filler, "예식 2027년 1월 9일 오후 5시"], images: 2, note: nil) else {
      return XCTFail("empty")
    }
    XCTAssertTrue(truncated)
    XCTAssertLessThanOrEqual(t.count, LinkText.maxChars)
    XCTAssertTrue(t.hasPrefix("[이미지] 사진 2장\n일시·장소 줄:\n예식 2027년 1월 9일 오후 5시\n이미지 속 글자:\n합성 갤러리 사진 설명 1번\n"))
  }
}
```

- [ ] **Step 2: 실패 확인**

Run: `cd ios && ./scripts/sim.sh gen && ./scripts/sim.sh test EruriCoreTests/LinkTextTests`
Expected: 컴파일 실패(`cannot find 'LinkText' in scope`).

- [ ] **Step 3: 구현 — `LinkText.swift`**

`ios/Packages/EruriCore/Sources/EruriCore/LinkText.swift`:

```swift
import Foundation
import CryptoKit

/// 링크 → 일정(스펙 §6 "링크·이미지 읽기", 2026-10-02 사용자 결정 방식 A): 기기가 렌더링해 읽은 글을 SHARE 항목으로 보낸다.
/// 이 파일은 WebKit 없이 테스트하는 부분이다 — 링크 판정·주소 검사·같은 링크 id·날짜 후보·본문 만들기(LinkText), 렌더링 결과(LinkPage), 대기 판정(LinkSettle)
public enum LinkText {
  /// 큐 항목 본문 상한(글자). 서버 추출 입력 상한(`MAX_TEXT_CHARS` 4,000)과 같다 — 모델이 보지 않는 뒷부분은 보내지 않는다
  public static let maxChars = 4000
  /// 본문이 넘칠 때 앞에 따로 두는 일시·장소 줄 몫(글자)
  public static let tailKeyChars = 1000
  public static let ocrMaxChars = 1500
  public static let titleMaxChars = 120
  public static let descMaxChars = 300
  public static let noteMaxChars = 200
  /// 서버 `items.app_name` 표식. source 는 SHARE 그대로(새 source·마이그레이션 없음, 스펙 §8)
  public static let appName = "웹 링크"
  /// 넘칠 때 본문 앞에 두는 블록 머리 — 서버 Jev 게이트가 본문 앞 2,000자만 본다(F23)
  public static let keyHeader = "일시·장소 줄:"

  // MARK: 링크 판정

  private static let detector = try! NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue)

  /// 글 안에서 `http://`·`https://` 로 적힌 주소(호스트 있음)의 모든 자리. 스킴 없는 도메인("naver.com")은 링크가 아니다.
  /// 주소 바로 뒤에 붙은 비 ASCII 글자("…/1이에요")는 주소가 아니다 — 첫 비 ASCII·공백 글자에서 자른다(한글 경로 주소는 링크로 보지 않는 대가).
  /// 끝의 `?`·`:` 도 문장 부호로 본다("…/1?" 가 다른 캡처 id·다른 경로가 되지 않게)
  static func matches(_ text: String) -> [(url: URL, range: NSRange)] {
    let ns = text as NSString
    return detector.matches(in: text, range: NSRange(location: 0, length: ns.length)).compactMap { (m: NSTextCheckingResult) -> (url: URL, range: NSRange)? in
      var scalars = String.UnicodeScalarView()
      for u in ns.substring(with: m.range).unicodeScalars {
        guard u.isASCII, !u.properties.isWhitespace else { break }
        scalars.append(u)
      }
      while let l = scalars.last, l == "?" || l == ":" { scalars.removeLast() }
      let s = String(scalars)
      guard s.lowercased().hasPrefix("http"), let u = URL(string: s), let scheme = u.scheme?.lowercased(),
            scheme == "http" || scheme == "https", u.host() != nil else { return nil }
      return (u, NSRange(location: m.range.location, length: (s as NSString).length))
    }
  }

  /// 나온 순서대로, 같은 주소는 한 번
  public static func webURLs(in text: String) -> [URL] {
    var seen = Set<String>()
    return matches(text).map { $0.url }.filter { seen.insert($0.absoluteString).inserted }
  }

  /// 주소 자리를 모두 지운 나머지 글(한 줄로, 자르지 않음)
  static func rest(_ text: String, removing ranges: [NSRange]) -> String {
    let ns = NSMutableString(string: text)
    for r in ranges.sorted(by: { $0.location > $1.location }) { ns.replaceCharacters(in: r, with: " ") }
    return oneLine(ns as String)
  }

  public enum Candidate: Equatable, Sendable {
    /// 주소 없음
    case none
    /// 주소 1개 + 짧은 메모(200자 이하, 날짜 후보 없음) — 링크 읽기
    case link(URL, note: String?)
    /// 주소 둘 이상
    case tooMany(Int)
    /// 주소 1개지만 나머지 글이 길거나 날짜가 있다 — 지금처럼 글로 다룬다(공유 = 텍스트 항목, 채팅 = 질문)
    case text
  }

  /// 링크 판정(스펙 §6 "입력", D5). 주소가 든 긴 공지·일정 문자를 링크로 바꾸면 본문이 메모로 잘리고 페이지 실패 시 사라진다(Fable F1)
  public static func linkCandidate(_ text: String) -> Candidate {
    let urls = webURLs(in: text)
    switch urls.count {
    case 0: return .none
    case 1:
      let r = rest(text, removing: matches(text).map { $0.range })
      if r.count > noteMaxChars || hasDateCandidate(r) { return .text }
      // 주소를 둘렀던 괄호·따옴표·마침표만 남은 메모("( )")는 없음
      let hasWord = r.unicodeScalars.contains { CharacterSet.alphanumerics.contains($0) }
      return .link(urls[0], note: hasWord ? r : nil)
    default: return .tooMany(urls.count)
    }
  }

  public enum ChatIntent: Equatable, Sendable { case none, link(URL, note: String?), tooMany(Int) }

  /// 채팅 입력(스펙 §9): 링크면 수집(나머지 글은 메모), 둘 이상이면 tooMany, 나머지(주소 없음·긴 글·날짜 있는 글)는 질문(none)
  public static func chatIntent(_ input: String) -> ChatIntent {
    switch linkCandidate(input) {
    case .link(let u, let n): return .link(u, note: n)
    case .tooMany(let k): return .tooMany(k)
    case .none, .text: return .none
    }
  }

  /// 공유 본문(`ShareText.compose` 결과)의 링크(스펙 §6): 링크일 때만. 나머지는 지금처럼 텍스트 공유
  public static func shareLink(_ composed: String) -> (url: URL, note: String?)? {
    guard case .link(let u, let n) = linkCandidate(composed) else { return nil }
    return (u, n)
  }

  // MARK: 주소 검사·https 올리기·같은 링크 id

  public enum Blocked: String, Sendable { case scheme, host }

  /// 기기가 열 주소인가(스펙 §6 "주소 검사"): http(s)만, 사설·루프백·링크로컬·CGNAT IP 리터럴과 로컬 이름을 거부한다.
  /// 서버 SSRF 방어가 아니라 기기 위생(로컬 네트워크 권한 창·내부 기기 접근 회피). allowLoopback = DEBUG 빌드의 시뮬레이터 게이트
  public static func check(_ url: URL, allowLoopback: Bool) -> Blocked? {
    guard let s = url.scheme?.lowercased(), s == "http" || s == "https" else { return .scheme }
    guard var h = url.host(percentEncoded: false)?.lowercased(), !h.isEmpty else { return .host }
    if h.hasPrefix("["), h.hasSuffix("]") { h = String(h.dropFirst().dropLast()) }
    if h == "localhost" || h == "127.0.0.1" || h == "::1" { return allowLoopback ? nil : .host }
    if h.contains(":") { return publicV6(h) ? nil : .host }
    let bare = h.hasSuffix(".") ? String(h.dropLast()) : h
    if let v4 = ipv4(bare) { return publicV4(v4) ? nil : .host }
    // 마지막 라벨이 숫자·0x… 면 WebKit(WHATWG "ends in a number")이 IPv4 로 읽는다("127.1"·"0x7f.0.0.1"·"0177.0.0.1"·"2130706433").
    // 엄격한 10진 4부(위)가 아니면 어느 주소로 풀릴지 따지지 않고 막는다
    if let last = bare.split(separator: ".").last, last.hasPrefix("0x") || last.allSatisfy({ $0.isASCII && $0.isNumber }) { return .host }
    if !bare.contains(".") { return .host }                                       // 점 없는 이름(사내 호스트)
    for suffix in [".local", ".localhost", ".internal", ".home.arpa"] where bare.hasSuffix(suffix) { return .host }
    return nil
  }

  /// http → https(스펙 §6 "주소 검사", F24 — 앱·확장에 ATS 예외가 없어 평문 로드는 막힌다. 예외를 두지 않는다).
  /// DEBUG 시뮬레이터 게이트의 루프백(allowLoopback)만 http 그대로
  public static func upgraded(_ url: URL, allowLoopback: Bool) -> URL {
    guard url.scheme?.lowercased() == "http" else { return url }
    if allowLoopback, let h = url.host(percentEncoded: false)?.lowercased(), h == "localhost" || h == "127.0.0.1" { return url }
    var c = URLComponents(url: url, resolvingAgainstBaseURL: false)
    c?.scheme = "https"
    if c?.port == 80 { c?.port = nil }
    return c?.url ?? url
  }

  /// 같은 링크 = 같은 캡처 id(스펙 §6 "같은 링크", D14): 조각(#…)을 떼고 스킴을 https·호스트를 소문자로 맞춘 주소의 SHA-256 앞 16바이트를
  /// UUID 모양(이름 기반 v5 비트)으로. 큐(INSERT OR IGNORE)·서버 멱등 키(SHARE:<id>)·기기 읽은 링크 기록이 이 값을 쓴다 — 주소 자체는 남기지 않는다
  public static func captureID(for url: URL) -> String {
    var key = url.absoluteString
    if var c = URLComponents(url: url, resolvingAgainstBaseURL: false) {
      c.fragment = nil
      let scheme = c.scheme?.lowercased()
      c.scheme = scheme == "http" ? "https" : scheme
      if c.port == 80 || c.port == 443 { c.port = nil }
      let host = c.percentEncodedHost?.lowercased()
      c.percentEncodedHost = host                                                  // IPv6 괄호를 그대로 둔다
      if c.percentEncodedPath.isEmpty { c.percentEncodedPath = "/" }               // "https://a.example.com" = "…/"
      key = c.string ?? key
    }
    var b = Array(SHA256.hash(data: Data(("link:" + key).utf8)).prefix(16))
    b[6] = (b[6] & 0x0F) | 0x50
    b[8] = (b[8] & 0x3F) | 0x80
    return UUID(uuid: (b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7], b[8], b[9], b[10], b[11], b[12], b[13], b[14], b[15])).uuidString
  }

  /// 엄격한 10진 4부 IPv4. 앞 0("012")은 WebKit 이 8진으로 읽으므로 아니다(check 가 막는다)
  static func ipv4(_ h: String) -> [Int]? {
    let p = h.split(separator: ".", omittingEmptySubsequences: false)
    guard p.count == 4, p.allSatisfy({ part in
      !part.isEmpty && part.count <= 3 && !(part.count > 1 && part.first == "0") && part.allSatisfy { $0.isASCII && $0.isNumber }
    }) else { return nil }
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

  /// IPv6 리터럴: 전역 유니캐스트(2000::/3)이고 문서용(2001:db8::/32)·6to4(2002::/16 — 사설 IPv4 를 품을 수 있다)가 아닐 때만
  static func publicV6(_ h: String) -> Bool {
    guard let f = h.first, f == "2" || f == "3" else { return false }
    return !h.hasPrefix("2001:db8") && !h.hasPrefix("2002:")
  }

  // MARK: 날짜 후보·일시 장소 줄

  private static let datePatterns: [NSRegularExpression] = [
    #"\d{1,2}\s*월\s*\d{1,2}\s*일"#,
    #"(?:19|20)\d{2}\s*[.\-/년]\s*\d{1,2}\s*[.\-/월]\s*\d{1,2}"#,
    #"(?<![\d.])\d{1,2}\s{0,3}[./]\s{0,3}\d{1,2}\s{0,3}\.?\s{0,3}\(\s{0,3}[월화수목금토일]"#,   // \s* 는 "1.1" + 긴 공백에서 2차 백트래킹(리뷰 I1)
    #"(?<![\d/.,])\d{1,2}/\d{1,2}(?![\d/])"#,
    #"(?i)\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b\.?\s+\d{1,2}(?!\d)"#,
  ].map { try! NSRegularExpression(pattern: $0) }
  private static let timePattern = try! NSRegularExpression(pattern: #"(?:오전|오후|낮|저녁|밤)\s*\d{1,2}\s*시|(?<!\d)\d{1,2}:\d{2}(?!\d)|(?i)\b(?:am|pm)\s*\d{1,2}"#)
  private static let placeWords = try! NSRegularExpression(pattern: #"일시|장소|예식|식장|웨딩|홀|층|오시는\s*길|주소|위치|시작|입장|개최|행사|시간"#)

  private static func found(_ r: NSRegularExpression, _ s: String) -> Bool {
    r.firstMatch(in: s, range: NSRange(location: 0, length: (s as NSString).length)) != nil
  }

  /// 날짜 후보(스펙 §6 "이미지 전용 페이지"·"입력"): "11월 14일"·"2026.11.14"·"2026-11-14"·"11/14"·"11. 14.(토)"·영문 월 + 일. 시각만은 아니다.
  /// 정리 전 원문(숨은 글 200,000자까지)에도 돌므로 공백을 먼저 접는다 — 패턴의 \s 는 줄바꿈도 받으므로 판정은 같다(리뷰 I1)
  public static func hasDateCandidate(_ s: String) -> Bool {
    let t = oneLine(s)
    return datePatterns.contains { found($0, t) }
  }

  /// 본문에서 앞으로 끌어올릴 줄: 날짜·시각·장소 단어
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

  /// 렌더링 결과 → 큐 항목 본문(스펙 §6 "보내는 글(링크)"). 주소는 호스트만, 넘치면 일시·장소 줄을 본문 앞에, 전체 4,000자
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
    let f = fit(lines(p.body), budget: maxChars - headText.count - ocrBlock.count - bodyHeader.count)
    let keyBlock = f.keys.isEmpty ? "" : "\n" + keyHeader + "\n" + f.keys
    let text = headText + keyBlock + (f.body.isEmpty ? "" : bodyHeader + f.body) + ocrBlock
    return Composed(title: title.isEmpty ? nil : title, text: clip(text, maxChars), bodyChars: f.body.count, truncated: f.truncated)
  }

  /// 줄을 budget 안에 담는다. 다 들어가면 keys 없이 그대로. 넘치면 전체 줄에서 일시·장소 줄을 tailKeyChars 안에서 뽑아 keys 로 두고
  /// (호출 쪽이 본문 **앞**에 `keyHeader` 블록으로 놓는다 — 게이트가 앞 2,000자만 본다, F23), keys 블록 몫(머리·줄바꿈 포함)을 뺀 나머지에 앞쪽 줄부터 담는다
  static func fit(_ ls: [String], budget: Int) -> (keys: String, body: String, truncated: Bool) {
    guard budget > 0 else { return ("", "", !ls.isEmpty) }
    let all = ls.joined(separator: "\n")
    if all.count <= budget { return ("", all, false) }
    var keys: [String] = [], keyUsed = 0
    for l in ls where isKeyLine(l) {
      let add = l.count + (keys.isEmpty ? 0 : 1)
      if keyUsed + add > tailKeyChars { continue }                                // 긴 줄은 건너뛰고 다음 줄을 본다
      keys.append(l); keyUsed += add
    }
    let keyText = keys.joined(separator: "\n")
    let bodyBudget = max(0, budget - (keys.isEmpty ? 0 : keyHeader.count + 2 + keyText.count))
    var head: [String] = [], used = 0
    for l in ls {
      let add = l.count + (head.isEmpty ? 0 : 1)
      if used + add > bodyBudget { break }
      head.append(l); used += add
    }
    if head.isEmpty, let first = ls.first, bodyBudget > 0 { head = [String(first.prefix(bodyBudget))] }   // 한 줄이 예산보다 길다
    return (keyText, head.joined(separator: "\n"), true)
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
  /// 화면 스냅샷 OCR(앱에서만, 날짜 후보가 없거나 글이 없을 때)
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
  /// didFinish 가 오지 않아도(긴 폴링·끝없는 하위 리소스) 로드 시작 뒤 이 시간이 지나면 길이만 보고 끝낸다. 글 0자는 **didFinish 뒤** 이 시간이 지나야 끝낸다
  public static let finishGrace: TimeInterval = 4
  public enum Decision: Equatable, Sendable { case wait, done, deadline }
  public let budget: TimeInterval
  private var last = -1, same = 0
  /// didFinish 를 처음 본 elapsed(스펙 §6 "대기"의 기준 시각 — 로드 시작이 아니다)
  private var finishedAt: TimeInterval?
  public init(budget: TimeInterval) { self.budget = budget }

  public mutating func observe(length: Int, finished: Bool, elapsed: TimeInterval) -> Decision {
    if elapsed >= budget { return .deadline }
    // didFinish 전 샘플은 "3번 같음"에 넣지 않는다 — HTML 의 고정 "로딩 중…" 글만 읽고 끝내지 않게(리뷰 I2)
    if finished, finishedAt == nil { finishedAt = elapsed; last = -1 }
    if length == last { same += 1 } else { last = length; same = 1 }
    guard same >= Self.stableSamples else { return .wait }
    // 글 0자(순수 이미지 페이지, Codex 1): didFinish 뒤 SPA 가 그릴 시간(4초)이 지났을 때만 완료 — 렌더러가 OCR 로 간다.
    // 느린 망에서 didFinish 가 늦게 와도 그 뒤 4초를 준다
    if length == 0 {
      guard let f = finishedAt else { return .wait }
      return elapsed - f >= Self.finishGrace ? .done : .wait
    }
    return finishedAt != nil || elapsed >= Self.finishGrace ? .done : .wait
  }
}
```

- [ ] **Step 4: 구현 — `ImageText.swift`(LI1)**

`ios/Packages/EruriCore/Sources/EruriCore/ImageText.swift`:

```swift
import Foundation

/// 사진 → 일정(스펙 §6 "링크·이미지 읽기", 2026-10-02 사용자 결정): 기기 OCR 글만 SHARE 항목(`app_name = "이미지"`)으로 보낸다.
/// 사진 파일·축소본은 어디에도 저장하지 않는다(OCR 은 `OCR.recognize(data:maxPixel:)`, 흐름은 `ImageFlow`)
public enum ImageText {
  /// 서버 `items.app_name` 표식(source 는 SHARE 그대로 — 새 source 없음)
  public static let appName = "이미지"
  /// 한 번에 읽는 최대 장 수(넘는 장은 버린다)
  public static let maxImages = 3
  /// OCR 글이 합쳐 이보다 적으면(공백 제외) 글자가 없는 사진으로 본다
  public static let minChars = 10
  static let ocrHeader = "이미지 속 글자:"

  public enum Composed: Equatable, Sendable { case text(String, truncated: Bool), empty }

  /// 사진마다의 OCR 글 → 큐 항목 본문(스펙 §6 "보내는 글(사진)"). images = 읽은 장 수(글자가 없던 장 포함).
  /// 줄은 공백 정리·같은 줄 제거, 넘치면 일시·장소 줄을 앞에(LinkText.fit — 게이트 2,000자), 전체 4,000자
  public static func compose(ocr: [String], images: Int, note: String?) -> Composed {
    let ls = LinkText.lines(ocr.joined(separator: "\n"))
    guard ls.joined().filter({ !$0.isWhitespace }).count >= minChars else { return .empty }
    var head = ["[이미지] 사진 \(images)장"]
    if let n = note.map({ LinkText.clip(LinkText.oneLine($0), LinkText.noteMaxChars) }), !n.isEmpty { head.append("메모: \(n)") }
    let headText = head.joined(separator: "\n")
    let bodyHeader = "\n" + ocrHeader + "\n"
    let f = LinkText.fit(ls, budget: LinkText.maxChars - headText.count - bodyHeader.count)
    let keys = f.keys.isEmpty ? "" : "\n" + LinkText.keyHeader + "\n" + f.keys
    return .text(LinkText.clip(headText + keys + bodyHeader + f.body, LinkText.maxChars), truncated: f.truncated)
  }
}
```

- [ ] **Step 5: 통과 확인**

Run: `cd ios && ./scripts/sim.sh test EruriCoreTests/LinkTextTests && ./scripts/sim.sh test EruriCoreTests/ImageTextTests`
Expected: `LinkTextTests` 18개·`ImageTextTests` 3개 통과. `testDateCandidates`의 음성 사례가 실패하면 정규식을 고치고(사례를 빼지 않는다), `testCheck`의 IPv6 사례에서 `URL.host(percentEncoded:)`가 괄호를 남기는지에 따라 `check`의 괄호 제거가 동작하는지 본다. `testChatIntent`의 한글 붙은 주소 사례가 실패하면 `NSDataDetector`가 그 입력에서 주소를 아예 못 찾는 것인지(`matches`가 빈 배열) 확인해 보고한다(사례를 빼지 않는다).

- [ ] **Step 6: 회귀**

Run: `cd ios && ./scripts/sim.sh test EruriCoreTests`
Expected: 전체 통과(기존 실패·건너뜀 수는 그대로 — FM 2 skipped).

- [ ] **Step 7: 커밋**

```bash
git add ios/Packages/EruriCore/Sources/EruriCore/LinkText.swift ios/Packages/EruriCore/Sources/EruriCore/ImageText.swift \
  ios/Packages/EruriCore/Tests/EruriCoreTests/LinkTextTests.swift ios/Packages/EruriCore/Tests/EruriCoreTests/ImageTextTests.swift
git commit -m "feat(core): LinkText and ImageText — link and photo reading pure logic (spec §6): exactly one http(s) URL with a short note (≤200 chars, no date candidate) is a link, longer or dated text with one URL stays text/question, two or more ask one at a time, non-ASCII right after a URL ends it; device URL check (private/loopback/link-local/CGNAT IP literals and local names refused, loopback only for DEBUG gates), http upgraded to https, URL-derived capture id (fragment dropped, scheme/host normalized) for duplicate links; compose one SHARE body (host only, date/place lines before the body when over budget so the 2,000-char gate sees them, OCR block, ≤4,000 chars); LinkSettle finishes empty pages after didFinish + 4 s; ImageText composes [이미지] bodies from per-photo OCR (max 3, empty under 10 chars)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task L2: 링크 대기 행·읽은 링크 기록 + `handleRead` + `LinkFlow`·`ImageFlow` + `LinkCaptureText`

**Files:**
- Modify: `ios/Packages/EruriCore/Sources/EruriCore/CaptureQueue.swift`(`init`에 `link_seen` 표, 진단 trace 절 뒤에 링크 대기 행·읽은 링크 절)
- Modify: `ios/Packages/EruriCore/Sources/EruriCore/CapturePipeline.swift`(`handleShareFile` 뒤에 `handleRead`)
- Create: `ios/Packages/EruriCore/Sources/EruriCore/LinkFlow.swift`(`ImageFlow` 포함 — LI3)
- Create: `ios/Packages/EruriCore/Sources/EruriCore/LinkCaptureText.swift`
- Test: `ios/Packages/EruriCore/Tests/EruriCoreTests/LinkFlowTests.swift`, `ios/Packages/EruriCore/Tests/EruriCoreTests/LinkCaptureTextTests.swift`

**Interfaces:**
- Consumes: L1 `LinkText.compose`·`hasDateCandidate`·`captureID(for:)`·`appName`, `LinkPage`, `ImageText.compose`·`appName`.
- Produces:
  - `struct PendingLink: Codable, Equatable, Sendable { id ("link:<captureID>"), captureID (= LinkText.captureID(for: url)), url: String, note: String?, origin: String, capturedAt: Date, attempts: Int; init(url: URL, note: String?, origin: String, capturedAt: Date = Date()) }`
  - `CaptureQueue.linkMaxAge = 7일`·`linkSeenFor = 30일` · `enqueueLink(_:lease:now:) throws`(같은 id면 lease·payload만 갱신) · `releaseLink(id:now:) throws` · `claimLinks(limit:now:) throws -> [PendingLink]`(7일 지난 행 삭제, attempts 채움) · `nextLinkAttempt() throws -> Date?` · `linkCount() throws -> Int` · `markLinkSeen(captureID:now:) throws` · `isLinkSeen(captureID:now:) throws -> Bool` (삭제는 기존 `markSent(id:)`, 백오프는 기존 `markFailed(id:)`)
  - `CapturePipeline.handleRead(id: String, appName: String, title: String?, text: String, capturedAt: Date) throws -> String` ("queued" | "discarded:<reason>")
  - `enum LinkRenderOutcome: Equatable, Sendable { case page(LinkPage, elapsedMs: Int), failed(String) }`
  - `@MainActor protocol LinkRendering: AnyObject { func render(_ url: URL, budget: TimeInterval, ocr: Bool) async -> LinkRenderOutcome }`
  - `enum LinkFlow { shareLease = 60, shareBudget = 10, appBudget = 15, renderInShareExtension = true, handOffCodes, retryCodes, maxAppAttempts = 3; enum Outcome { queued(captureID:chars:ocr:timedOut:), duplicate, discarded(String), handedOff(String), retry(String), failed(String) }; enum Admission { go(PendingLink), stop(Outcome) }; static admit(_:queue:lease:now:) -> Admission; @MainActor static share(_:renderer:queue:render:) async -> Outcome; @MainActor static app(_:renderer:queue:) async -> Outcome; static finish(_:page:queue:) -> Outcome; static code(_:) -> String; static traceFields(_:origin:elapsedMs:blockedNav:) -> [String: Any] }`
  - `enum ImageFlow { enum Outcome { queued(captureID:chars:images:), discarded(String), empty, failed(String) }; static finish(ocr:images:note:queue:capturedAt:) -> Outcome; static code(_:) -> String; static traceFields(_:origin:elapsedMs:images:) -> [String: Any] }`
  - `enum LinkCaptureText { reading, imageReading, tooMany, discarded, duplicate, pending, storageNote, drainFailedTitle, imageEmpty, imageFailed; enum Subject { page, image }; reason(_:); share(_:); shareFallback(_:); chat(_:); image(_:chat:); chatResult(status:gateLabel:kinds:subject:); drainFailedBody(_:) }`

- [ ] **Step 1: 실패하는 테스트**

`ios/Packages/EruriCore/Tests/EruriCoreTests/LinkFlowTests.swift`:

```swift
import XCTest
@testable import EruriCore

/// 링크 대기 행·흐름(스펙 §6 "확장과 앱의 이어받기"·"같은 링크")과 사진 흐름(ImageFlow). 렌더러는 가짜 — WebKit 은 LinkRendererTests
final class LinkFlowTests: XCTestCase {
  @MainActor final class FakeRenderer: LinkRendering {
    let outcome: LinkRenderOutcome
    private(set) var calls: [(budget: TimeInterval, ocr: Bool)] = []
    init(_ o: LinkRenderOutcome) { outcome = o }
    func render(_ url: URL, budget: TimeInterval, ocr: Bool) async -> LinkRenderOutcome { calls.append((budget, ocr)); return outcome }
  }

  let url = URL(string: "https://invite.example.com/m/abc?code=482913")!
  let url2 = URL(string: "https://party.example.com/p/1")!
  let page = LinkPage(host: "invite.example.com", title: "합성신랑 ♥ 합성신부 결혼합니다",
                      visibleText: "일시\n2026년 11월 14일 토요일 오후 1시 30분\n장소\n합성웨딩홀 3층")

  private func makeQueue() throws -> CaptureQueue {
    try CaptureQueue(url: FileManager.default.temporaryDirectory.appendingPathComponent("link-\(UUID().uuidString).sqlite"))
  }

  /// 같은 주소 = 같은 id(D14). 대기 행 id 는 캡처 id 에 접두
  func testPendingLinkIDs() {
    let l = PendingLink(url: url, note: nil, origin: "share")
    XCTAssertEqual(l.id, "link:" + l.captureID)
    XCTAssertEqual(l.captureID, LinkText.captureID(for: url))
    XCTAssertEqual(PendingLink(url: url, note: "다른 메모", origin: "chat").id, l.id)
    XCTAssertNotEqual(PendingLink(url: url2, note: nil, origin: "share").id, l.id)
    XCTAssertEqual(l.url, url.absoluteString)
    XCTAssertEqual(l.attempts, 0)
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
    XCTAssertTrue(try q.isLinkSeen(captureID: link.captureID))                   // 읽은 링크 기록(D14)
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

  /// 같은 링크 재입력(메인 판정 MR2): 렌더링·행 없이 duplicate. 30일이 지나면 기록이 풀린다
  @MainActor func testSameLinkIsDuplicate() async throws {
    let q = try makeQueue(), r = FakeRenderer(.page(page, elapsedMs: 1))
    _ = await LinkFlow.share(PendingLink(url: url, note: nil, origin: "share"), renderer: r, queue: q)
    let again = await LinkFlow.share(PendingLink(url: URL(string: "http://invite.example.com/m/abc?code=482913#top")!, note: "또", origin: "chat"),
                                     renderer: r, queue: q)
    XCTAssertEqual(again, .duplicate)
    XCTAssertEqual(r.calls.count, 1)
    XCTAssertEqual(try q.linkCount(), 0)
    XCTAssertEqual(try q.claim(limit: 10).count, 1)
    let id = LinkText.captureID(for: url)
    XCTAssertFalse(try q.isLinkSeen(captureID: id, now: Date().addingTimeInterval(CaptureQueue.linkSeenFor + 60)))
  }

  /// 주소 쿼리의 code=482913 이 본문에 들어가면 OTP 규칙이 항목 전체를 폐기한다(F9) — 호스트만 들어가므로 통과한다
  @MainActor func testQueryDigitsDoNotDiscard() async throws {
    let q = try makeQueue()
    let o = await LinkFlow.share(PendingLink(url: url, note: nil, origin: "share"), renderer: FakeRenderer(.page(page, elapsedMs: 1)), queue: q)
    guard case .queued = o else { return XCTFail("\(o)") }
    XCTAssertFalse(try q.claim(limit: 1)[0].text.contains("482913"))
    // 대조: 전체 주소를 본문에 넣으면 폐기된다(호스트만 쓰는 이유). 이 단언이 깨지면 규칙이 F9 와 다르다 — 메인에게 알린다
    let full = try CapturePipeline(filter: RuleFilter(), queue: q).handleRead(id: UUID().uuidString, appName: LinkText.appName, title: nil,
                                                                             text: "링크: \(url.absoluteString)", capturedAt: Date())
    XCTAssertEqual(full, "discarded:otp")
  }

  /// 메모가 기기 규칙에 걸리면 행도 만들지 않는다(Codex 3 — App Group 에 인증번호를 남기지 않는다)
  @MainActor func testOTPNoteLeavesNoRow() async throws {
    let q = try makeQueue(), r = FakeRenderer(.page(page, elapsedMs: 1))
    let o = await LinkFlow.share(PendingLink(url: url, note: "인증번호 482913", origin: "share"), renderer: r, queue: q)
    XCTAssertEqual(o, .discarded("otp"))
    XCTAssertTrue(r.calls.isEmpty)
    XCTAssertEqual(try q.linkCount(), 0)
    XCTAssertEqual(try q.claim(limit: 10).count, 0)
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

  /// 글 0자 페이지(Codex 1): 확장 렌더러는 빈 페이지를 .page 로 돌려 no_date 로, 혹시 empty 실패가 와도 앱(OCR)에 넘긴다
  @MainActor func testShareEmptyPageHandsOff() async throws {
    let q = try makeQueue()
    let a = await LinkFlow.share(PendingLink(url: url, note: nil, origin: "share"),
                                 renderer: FakeRenderer(.page(LinkPage(host: "card.example.com"), elapsedMs: 1)), queue: q)
    let b = await LinkFlow.share(PendingLink(url: url2, note: nil, origin: "share"), renderer: FakeRenderer(.failed("empty")), queue: q)
    XCTAssertEqual(a, .handedOff("no_date"))
    XCTAssertEqual(b, .handedOff("empty"))
    XCTAssertEqual(try q.linkCount(), 2)
  }

  @MainActor func testShareTimeoutHandsOffAndHTTPErrorFails() async throws {
    let q = try makeQueue()
    let a = PendingLink(url: url, note: nil, origin: "share"), b = PendingLink(url: url2, note: nil, origin: "share")
    let oa = await LinkFlow.share(a, renderer: FakeRenderer(.failed("timeout")), queue: q)
    let ob = await LinkFlow.share(b, renderer: FakeRenderer(.failed("http_404")), queue: q)
    XCTAssertEqual(oa, .handedOff("timeout"))
    XCTAssertEqual(ob, .failed("http_404"))
    XCTAssertEqual(try q.claimLinks(limit: 10).map(\.id), [a.id])                // 404 는 다시 해도 같다 — 행 삭제(확장은 텍스트로 폴백, L4)
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
    XCTAssertEqual(try q.nextLinkAttempt()?.timeIntervalSince1970 ?? 0, t0.addingTimeInterval(60).timeIntervalSince1970, accuracy: 0.01)
    XCTAssertEqual(try q.claim(limit: 10, now: t0.addingTimeInterval(61)).count, 0)
    XCTAssertEqual(try q.pending(limit: 10, now: t0.addingTimeInterval(61)).count, 0)
    XCTAssertEqual(try q.claimLinks(limit: 10, now: t0.addingTimeInterval(61)).map(\.id), [link.id])
    XCTAssertEqual(try q.claimLinks(limit: 10, now: t0.addingTimeInterval(62)).count, 0)   // 앱이 잡은 동안(600초) 다시 안 나온다
    XCTAssertEqual(try q.captureCount(), 0)
    XCTAssertEqual(try q.linkCount(), 1)
  }

  /// 같은 주소를 다시 공유하면(확장이 죽어 행이 남은 상태) 행은 하나, lease 만 새로 건다
  func testReEnqueueSameLinkRefreshesLease() throws {
    let q = try makeQueue(), t0 = Date()
    try q.enqueueLink(PendingLink(url: url, note: nil, origin: "share", capturedAt: t0), lease: 0, now: t0)
    try q.enqueueLink(PendingLink(url: url, note: "다시", origin: "share", capturedAt: t0), lease: 60, now: t0.addingTimeInterval(5))
    XCTAssertEqual(try q.linkCount(), 1)
    XCTAssertEqual(try q.claimLinks(limit: 10, now: t0.addingTimeInterval(30)).count, 0)
    XCTAssertEqual(try q.claimLinks(limit: 10, now: t0.addingTimeInterval(66)).first?.note, "다시")
  }

  func testUnreadableLinkRowIsDropped() throws {
    let q = try makeQueue()
    try q.enqueueLink(PendingLink(url: url, note: nil, origin: "share"), lease: 0)
    try q.insertRawLinkForTesting(id: "link:poison", payload: Data("{".utf8))
    XCTAssertEqual(try q.claimLinks(limit: 10).count, 1)
    XCTAssertEqual(try q.linkCount(), 1)                                          // poison 행은 지워졌다
  }

  /// 대기 행은 7일 지나면 지운다(Codex 3 — 기기에 주소·메모가 무기한 남지 않게)
  func testExpiredLinkRowsAreDropped() throws {
    let q = try makeQueue(), t0 = Date()
    try q.enqueueLink(PendingLink(url: url, note: "청첩장", origin: "share", capturedAt: t0), lease: 0, now: t0)
    XCTAssertEqual(try q.claimLinks(limit: 10, now: t0.addingTimeInterval(CaptureQueue.linkMaxAge + 60)).count, 0)
    XCTAssertEqual(try q.linkCount(), 0)
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

  /// 앱의 재시도 가능한 실패(Fable C4): 행을 남기고 백오프(30초·60초), 3회째에 지운다
  @MainActor func testAppRetryableFailureKeepsRow() async throws {
    let q = try makeQueue(), t = Date(), r = FakeRenderer(.failed("timeout"))
    try q.enqueueLink(PendingLink(url: url, note: nil, origin: "share"), lease: 0, now: t)
    let first = try q.claimLinks(limit: 1, now: t)
    let o1 = await LinkFlow.app(first[0], renderer: r, queue: q)
    XCTAssertEqual(o1, .retry("timeout"))
    XCTAssertEqual(try q.linkCount(), 1)
    XCTAssertEqual(try q.claimLinks(limit: 1, now: t.addingTimeInterval(10)).count, 0)       // 백오프 30초
    let second = try q.claimLinks(limit: 1, now: t.addingTimeInterval(40))
    XCTAssertEqual(second.first?.attempts, 1)
    let o2 = await LinkFlow.app(second[0], renderer: r, queue: q)
    XCTAssertEqual(o2, .retry("timeout"))
    let third = try q.claimLinks(limit: 1, now: t.addingTimeInterval(130))
    XCTAssertEqual(third.first?.attempts, 2)
    let o3 = await LinkFlow.app(third[0], renderer: r, queue: q)
    XCTAssertEqual(o3, .failed("timeout"))
    XCTAssertEqual(try q.linkCount(), 0)
  }

  /// 확정 실패(막힌 주소·HTTP 오류·OCR 뒤 빈 페이지 …)는 바로 지운다(호출 쪽이 알린다)
  @MainActor func testAppDefinitiveFailureDropsRow() async throws {
    let q = try makeQueue()
    try q.enqueueLink(PendingLink(url: url, note: nil, origin: "share"), lease: 0)
    let claimed = try q.claimLinks(limit: 1)
    let o = await LinkFlow.app(claimed[0], renderer: FakeRenderer(.failed("http_404")), queue: q)
    XCTAssertEqual(o, .failed("http_404"))
    XCTAssertEqual(try q.linkCount(), 0)
  }

  /// 읽는 중 앱이 비활성(취소): 행을 그대로 돌려놓는다 — 시도로 세지 않고, 다음 foreground 가 바로 가져간다
  @MainActor func testAppCancelledReleasesRow() async throws {
    let q = try makeQueue()
    try q.enqueueLink(PendingLink(url: url, note: nil, origin: "share"), lease: 0)
    let claimed = try q.claimLinks(limit: 1)
    let o = await LinkFlow.app(claimed[0], renderer: FakeRenderer(.failed("cancelled")), queue: q)
    XCTAssertEqual(o, .retry("cancelled"))
    let again = try q.claimLinks(limit: 1)
    XCTAssertEqual(again.first?.attempts, 0)
  }

  @MainActor func testOTPPageIsDiscardedWithoutCapture() async throws {
    let q = try makeQueue()
    let otp = LinkPage(host: "x.example.com", title: "합성 예약", visibleText: "2026년 11월 14일 방문\n인증번호 482913 을 입력하세요")
    let o = await LinkFlow.share(PendingLink(url: url, note: nil, origin: "share"), renderer: FakeRenderer(.page(otp, elapsedMs: 1)), queue: q)
    XCTAssertEqual(o, .discarded("otp"))
    XCTAssertEqual(try q.claim(limit: 10).count, 0)
    XCTAssertEqual(try q.linkCount(), 0)
    XCTAssertFalse(try q.isLinkSeen(captureID: LinkText.captureID(for: url)))       // 폐기는 기록하지 않는다
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
    XCTAssertEqual(LinkFlow.traceFields(.duplicate, origin: "chat", elapsedMs: 1)["result"] as? String, "duplicate")
    XCTAssertEqual(LinkFlow.traceFields(.retry("timeout"), origin: "drain", elapsedMs: 1)["code"] as? String, "timeout")
    XCTAssertEqual(LinkFlow.code(.handedOff("no_date")), "handed_off:no_date")
    XCTAssertEqual(LinkFlow.code(.retry("cancelled")), "retry:cancelled")
    let i = ImageFlow.traceFields(.queued(captureID: "c", chars: 300, images: 2), origin: "share", elapsedMs: 2100, images: 2)
    XCTAssertEqual(Set(i.keys), ["origin", "elapsed_ms", "images", "result", "chars"])
    XCTAssertTrue(Set(i.keys).isDisjoint(with: Trace.forbiddenKeys))
    XCTAssertEqual(ImageFlow.code(.empty), "empty")
  }

  // MARK: 사진(LI3, 스펙 §6 "사진 OCR") — 파일 없이 OCR 글만 SHARE 항목으로

  func testImageQueuesShareItem() throws {
    let q = try makeQueue()
    let o = ImageFlow.finish(ocr: ["합성웨딩홀 5층\n2026년 12월 19일 토요일 오후 3시"], images: 1, note: "청첩장", queue: q)
    guard case .queued(let id, let chars, 1) = o else { return XCTFail("\(o)") }
    XCTAssertGreaterThan(chars, 0)
    let items = try q.claim(limit: 10)
    XCTAssertEqual(items.map(\.id), [id])
    XCTAssertEqual(items[0].source, "SHARE")
    XCTAssertEqual(items[0].appName, "이미지")
    XCTAssertNil(items[0].title)
    XCTAssertNil(items[0].localFile)                                               // 파일 없음
    XCTAssertTrue(items[0].text.hasPrefix("[이미지] 사진 1장\n메모: 청첩장\n이미지 속 글자:\n"))
    XCTAssertEqual(try q.linkCount(), 0)                                            // 대기 행 없음
  }

  func testImageEmptyQueuesNothing() throws {
    let q = try makeQueue()
    XCTAssertEqual(ImageFlow.finish(ocr: ["", " 가 "], images: 2, note: nil, queue: q), .empty)
    XCTAssertEqual(try q.claim(limit: 10).count, 0)
  }

  func testImageOTPIsDiscarded() throws {
    let q = try makeQueue()
    XCTAssertEqual(ImageFlow.finish(ocr: ["인증번호 482913 을 입력하세요"], images: 1, note: nil, queue: q), .discarded("otp"))
    XCTAssertEqual(try q.claim(limit: 10).count, 0)
  }
}
```

`ios/Packages/EruriCore/Tests/EruriCoreTests/LinkCaptureTextTests.swift`:

```swift
import XCTest
@testable import EruriCore

/// 링크·사진 읽기 문구(스펙 §6·§9). 주소·제목을 받는 인자가 없다
final class LinkCaptureTextTests: XCTestCase {
  func testShareTexts() {
    XCTAssertEqual(LinkCaptureText.share(.queued(captureID: "c", chars: 812, ocr: false, timedOut: false)),
                   "페이지에서 글 812자를 읽었어요. 일정을 찾으면 알림으로 알려 드릴게요.")
    XCTAssertEqual(LinkCaptureText.share(.duplicate), "이미 읽은 링크예요. 제안 탭에서 확인해 주세요.")
    XCTAssertEqual(LinkCaptureText.share(.handedOff("no_date")), "그림으로 된 페이지 같아요. ERURI 앱을 열면 그림 속 글자까지 다시 읽어요.")
    XCTAssertEqual(LinkCaptureText.share(.handedOff("empty")), "그림으로 된 페이지 같아요. ERURI 앱을 열면 그림 속 글자까지 다시 읽어요.")
    XCTAssertEqual(LinkCaptureText.share(.handedOff("timeout")), "지금은 다 읽지 못했어요. ERURI 앱을 열면 다시 읽어요.")
    XCTAssertEqual(LinkCaptureText.share(.discarded("otp")), "보안 숫자로 보이는 내용이 있어 저장하지 않았어요.")
    XCTAssertEqual(LinkCaptureText.share(.failed("http_404")), "페이지를 읽지 못했어요(페이지 오류 404).")
    XCTAssertEqual(LinkCaptureText.share(.failed("blocked_host")), "페이지를 읽지 못했어요(내부 네트워크 주소는 열지 않아요).")
    XCTAssertEqual(LinkCaptureText.shareFallback("insecure"), "페이지를 읽지 못해 공유한 글만 저장했어요(보안 연결(https)이 안 되는 페이지예요).")
    XCTAssertEqual(LinkCaptureText.storageNote, "읽은 글은 공유한 내용처럼 암호화해 보관해요. 짧은 페이지는 보이는 글 전체가 저장돼요.")
  }

  func testChatTexts() {
    XCTAssertEqual(LinkCaptureText.chat(.queued(captureID: "c", chars: 640, ocr: true, timedOut: false)), "페이지에서 글 640자를 읽었어요. 일정을 찾는 중…")
    XCTAssertEqual(LinkCaptureText.chat(.failed("timeout")), "페이지를 읽지 못했어요(시간이 너무 걸려요).")
    XCTAssertEqual(LinkCaptureText.chat(.discarded("otp")), "보안 숫자로 보이는 내용이 있어 저장하지 않았어요.")
    XCTAssertEqual(LinkCaptureText.chat(.duplicate), "이미 읽은 링크예요. 제안 탭에서 확인해 주세요.")
    XCTAssertEqual(LinkCaptureText.chat(.retry("cancelled")), "앱으로 돌아오면 다시 읽어요.")
    XCTAssertEqual(LinkCaptureText.chat(.retry("timeout")), "지금은 다 읽지 못했어요(시간이 너무 걸려요). 잠시 뒤 다시 읽고, 일정을 찾으면 알림으로 알려 드려요.")
  }

  func testImageTexts() {
    XCTAssertEqual(LinkCaptureText.image(.queued(captureID: "c", chars: 120, images: 2), chat: false),
                   "사진에서 글 120자를 읽었어요. 일정을 찾으면 알림으로 알려 드릴게요.")
    XCTAssertEqual(LinkCaptureText.image(.queued(captureID: "c", chars: 120, images: 2), chat: true), "사진에서 글 120자를 읽었어요. 일정을 찾는 중…")
    XCTAssertEqual(LinkCaptureText.image(.empty, chat: true), "사진에서 글자를 찾지 못했어요.")
    XCTAssertEqual(LinkCaptureText.image(.discarded("otp"), chat: false), "보안 숫자로 보이는 내용이 있어 저장하지 않았어요.")
    XCTAssertEqual(LinkCaptureText.image(.failed("queue"), chat: false), "사진을 읽지 못했어요.")
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
    XCTAssertEqual(LinkCaptureText.chatResult(status: "discarded:server:empty", gateLabel: nil, kinds: [], subject: .image), "이 사진에서 일정을 찾지 못했어요.")
    XCTAssertEqual(LinkCaptureText.chatResult(status: "discarded:server:promo", gateLabel: "promo", kinds: []),
                   "분류에서 걸러졌어요 — 보관함 › 최근 폐기에서 복구할 수 있어요.")
    XCTAssertEqual(LinkCaptureText.chatResult(status: "discarded:server:otp", gateLabel: nil, kinds: []), "보안 숫자로 보이는 내용이 있어 저장하지 않았어요.")
  }

  func testReasonsCarryNoAddress() {
    for code in ["blocked_scheme", "blocked_host", "redirects", "unsupported", "timeout", "empty", "web_process", "cancelled", "http_500",
                 "load_failed", "insecure", "queue", "bad_url"] {
      XCTAssertFalse(LinkCaptureText.reason(code).isEmpty, code)
      XCTAssertFalse(LinkCaptureText.reason(code).contains("http:"), code)
    }
    XCTAssertEqual(LinkCaptureText.reason("insecure"), "보안 연결(https)이 안 되는 페이지예요")
    XCTAssertEqual(LinkCaptureText.drainFailedBody("timeout"), "시간이 너무 걸려요. 날짜·장소 글을 복사해 ERURI로 공유해 주세요.")
  }
}
```

- [ ] **Step 2: 실패 확인**

Run: `cd ios && ./scripts/sim.sh test EruriCoreTests/LinkFlowTests`
Expected: 컴파일 실패(`cannot find 'PendingLink' in scope`).

- [ ] **Step 3: 큐 링크 대기 행·읽은 링크 기록**

(a) `CaptureQueue.swift`의 `public static let lease: TimeInterval = 600` 줄 바로 뒤에 더한다:

```swift
  /// 링크 대기 행 보관 상한(스펙 §6 이어받기 — 기기에 주소·메모가 무기한 남지 않게)
  public static let linkMaxAge: TimeInterval = 7 * 86_400
  /// 읽은 링크 기록(캡처 id 만) 보관 기간(스펙 §6 "같은 링크")
  public static let linkSeenFor: TimeInterval = 30 * 86_400
```

(b) `init`의 `try? exec("ALTER TABLE queue ADD COLUMN kind TEXT NOT NULL DEFAULT 'capture'")` 줄 바로 뒤에 더한다:

```swift
    // 읽은 링크(스펙 §6 "같은 링크"): 캡처 id(주소의 해시)와 만료 시각만 — 주소는 두지 않는다
    try exec("CREATE TABLE IF NOT EXISTS link_seen(id TEXT PRIMARY KEY, until REAL NOT NULL)")
```

(c) `public func purgeTraces()` 줄 바로 앞에 넣는다(같은 파일이라 `run`·`count`·`msg`·`transient`·`enc`·`dec`를 쓴다):

```swift
  // MARK: - 링크 대기 행 (kind = 'link', payload = PendingLink JSON, 스펙 §6 "확장과 앱의 이어받기")

  /// 렌더링 전에 남긴다. lease 동안은 앱이 가져가지 않는다(확장이 죽으면 lease 뒤 앱이 이어받는다). 캡처 claim·pending 은 kind = 'capture' 만 본다.
  /// 같은 주소 = 같은 id(D14) — 행이 이미 있으면(확장이 죽어 남은 행을 다시 공유) lease·payload 만 새로 건다(attempts·created_at 은 그대로)
  public func enqueueLink(_ l: PendingLink, lease: TimeInterval, now: Date = Date()) throws {
    let data = try enc.encode(l)
    try run("""
      INSERT INTO queue(id,payload,attempts,created_at,next_attempt_at,kind) VALUES(?1,?2,0,?3,?4,'link')
      ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, next_attempt_at = excluded.next_attempt_at
      """) { s in
      sqlite3_bind_text(s, 1, l.id, -1, Self.transient)
      data.withUnsafeBytes { sqlite3_bind_blob(s, 2, $0.baseAddress, Int32(data.count), Self.transient) }
      sqlite3_bind_double(s, 3, now.timeIntervalSince1970)
      sqlite3_bind_double(s, 4, now.timeIntervalSince1970 + lease)
    }
  }
  /// 앱에 넘긴다(확장) / 그대로 돌려놓는다(앱이 비활성 — 취소): lease 를 지금으로(다음 foreground 가 바로 가져간다)
  public func releaseLink(id: String, now: Date = Date()) throws {
    try run("UPDATE queue SET next_attempt_at = ? WHERE id = ? AND kind = 'link'") { s in
      sqlite3_bind_double(s, 1, now.timeIntervalSince1970); sqlite3_bind_text(s, 2, id, -1, Self.transient)
    }
  }
  /// 앱(foreground): 처리할 링크를 캡처와 같은 lease(600초)로 가져온다. 7일 지난 행·읽을 수 없는 행은 지운다(큐를 막지 않게). attempts 는 열에서 채운다
  public func claimLinks(limit: Int, now: Date = Date()) throws -> [PendingLink] {
    try run("DELETE FROM queue WHERE kind = 'link' AND created_at < ?") { sqlite3_bind_double($0, 1, now.timeIntervalSince1970 - Self.linkMaxAge) }
    var s: OpaquePointer?
    let sql = """
      UPDATE queue SET next_attempt_at = ?1
      WHERE id IN (SELECT id FROM queue WHERE kind = 'link' AND next_attempt_at <= ?2 ORDER BY created_at, rowid LIMIT ?3)
      RETURNING id, payload, attempts
      """
    guard sqlite3_prepare_v2(db, sql, -1, &s, nil) == SQLITE_OK, let st = s else { throw Error.sqlite(msg) }
    sqlite3_bind_double(st, 1, now.timeIntervalSince1970 + Self.lease)
    sqlite3_bind_double(st, 2, now.timeIntervalSince1970); sqlite3_bind_int(st, 3, Int32(limit))
    var out: [PendingLink] = [], poison: [String] = []
    var rc = sqlite3_step(st)
    while rc == SQLITE_ROW {
      let id = String(cString: sqlite3_column_text(st, 0))
      let len = Int(sqlite3_column_bytes(st, 1))
      if let b = sqlite3_column_blob(st, 1), var l = try? dec.decode(PendingLink.self, from: Data(bytes: b, count: len)) {
        l.attempts = Int(sqlite3_column_int(st, 2)); out.append(l)
      } else { poison.append(id) }
      rc = sqlite3_step(st)
    }
    let err = rc == SQLITE_DONE ? nil : msg
    sqlite3_finalize(st)                                                          // 아래 삭제 전에 문장을 끝낸다
    if let err { throw Error.sqlite(err) }
    for id in poison { try markSent(id: id) }
    return out.sorted { $0.capturedAt < $1.capturedAt }                          // RETURNING 순서는 보장되지 않는다
  }
  /// 남은 링크 행 중 가장 이른 다음 시도 시각(lease·백오프). 없으면 nil — 앱이 활성 상태에서 다시 볼 때를 정한다
  public func nextLinkAttempt() throws -> Date? {
    var s: OpaquePointer?
    guard sqlite3_prepare_v2(db, "SELECT min(next_attempt_at) FROM queue WHERE kind = 'link'", -1, &s, nil) == SQLITE_OK, let st = s else { throw Error.sqlite(msg) }
    defer { sqlite3_finalize(st) }
    guard sqlite3_step(st) == SQLITE_ROW else { throw Error.sqlite(msg) }
    return sqlite3_column_type(st, 0) == SQLITE_NULL ? nil : Date(timeIntervalSince1970: sqlite3_column_double(st, 0))
  }
  public func linkCount() throws -> Int { try count("link") }

  /// 읽은 링크 기록(스펙 §6 "같은 링크"): 큐 항목을 넣은 링크의 캡처 id 를 30일 둔다. 지난 기록은 이때 지운다
  public func markLinkSeen(captureID: String, now: Date = Date()) throws {
    try run("DELETE FROM link_seen WHERE until < ?") { sqlite3_bind_double($0, 1, now.timeIntervalSince1970) }
    try run("INSERT OR REPLACE INTO link_seen(id, until) VALUES(?, ?)") { s in
      sqlite3_bind_text(s, 1, captureID, -1, Self.transient); sqlite3_bind_double(s, 2, now.timeIntervalSince1970 + Self.linkSeenFor)
    }
  }
  public func isLinkSeen(captureID: String, now: Date = Date()) throws -> Bool {
    var s: OpaquePointer?
    guard sqlite3_prepare_v2(db, "SELECT 1 FROM link_seen WHERE id = ? AND until > ?", -1, &s, nil) == SQLITE_OK, let st = s else { throw Error.sqlite(msg) }
    defer { sqlite3_finalize(st) }
    sqlite3_bind_text(st, 1, captureID, -1, Self.transient); sqlite3_bind_double(st, 2, now.timeIntervalSince1970)
    return sqlite3_step(st) == SQLITE_ROW
  }

  /// 테스트 전용: 디코딩 불가 링크 행
  func insertRawLinkForTesting(id: String, payload: Data) throws {
    try run("INSERT INTO queue(id,payload,attempts,created_at,kind) VALUES(?,?,0,?,'link')") { s in
      sqlite3_bind_text(s, 1, id, -1, Self.transient)
      payload.withUnsafeBytes { sqlite3_bind_blob(s, 2, $0.baseAddress, Int32(payload.count), Self.transient) }
      sqlite3_bind_double(s, 3, Date().timeIntervalSince1970)
    }
  }
```

- [ ] **Step 4: `handleRead`**

`CapturePipeline.swift`의 `handleShareFile` 함수 바로 뒤에 넣는다:

```swift
  /// 링크·사진 → 일정(스펙 §6 "링크·이미지 읽기"): 기기가 읽은 제목·본문을 규칙에 통과시켜 SHARE 항목(`app_name` = "웹 링크" | "이미지")으로 넣는다.
  /// 링크의 id = 주소에서 정해진 캡처 id — 확장이 죽은 뒤 앱이 다시 읽어도 큐(INSERT OR IGNORE)·서버 멱등 키(SHARE:<id>)가 한 건.
  /// 연락처 규칙은 쓰지 않는다(호출 쪽이 RuleFilter() — 사용자가 고른 링크·사진). 반환: "queued" 또는 "discarded:<reason>"
  public func handleRead(id: String, appName: String, title: String?, text: String, capturedAt: Date) throws -> String {
    switch filter.apply(title: title, text: text, sender: nil) {
    case .discard(let r): return "discarded:\(r)"
    case .pass(let maskedTitle, let masked):
      try queue.enqueue(CaptureItem(id: id, source: "SHARE", appName: appName, sender: nil, title: maskedTitle,
                                    text: masked, localFile: nil, ocrText: nil, capturedAt: capturedAt, attempts: 0))
      return "queued"
    }
  }
```

- [ ] **Step 5: `LinkFlow`·`ImageFlow`**

`ios/Packages/EruriCore/Sources/EruriCore/LinkFlow.swift`:

```swift
import Foundation

/// 링크 대기 행(스펙 §6 "확장과 앱의 이어받기"). App Group 큐(`kind = 'link'`)에 JSON 으로 둔다
public struct PendingLink: Codable, Equatable, Sendable {
  /// 큐 행 id `link:<captureID>` — 캡처 행과 같은 표(id PK)를 쓰므로 접두로 나눈다
  public var id: String
  /// 큐 항목 id = 서버 멱등 키(`SHARE:<captureID>`). 주소에서 정해진다(`LinkText.captureID(for:)`) — 같은 링크면 같다(D14)
  public var captureID: String
  public var url: String
  /// 공유·채팅에 함께 적은 글. 관문(`LinkFlow.admit`)이 기기 규칙으로 마스킹한 뒤에만 행에 들어간다
  public var note: String?
  /// share | chat
  public var origin: String
  /// 공유·붙여넣은 시각 = 서버 occurred_at(상대 날짜 기준일)
  public var capturedAt: Date
  /// 앱이 읽다 실패한 횟수(`claimLinks` 가 큐 attempts 열에서 채운다)
  public var attempts: Int

  public init(url: URL, note: String?, origin: String, capturedAt: Date = Date()) {
    let c = LinkText.captureID(for: url)
    id = "link:" + c; captureID = c; self.url = url.absoluteString; self.note = note; self.origin = origin
    self.capturedAt = capturedAt; attempts = 0
  }
}

/// 렌더링 결과. 실패 코드는 진단·화면 문구에만 쓴다(주소·본문 없음):
/// blocked_scheme · blocked_host · http_<n> · unsupported · redirects · insecure · load_failed · web_process · timeout · empty · extract_failed · no_host · cancelled
public enum LinkRenderOutcome: Equatable, Sendable {
  case page(LinkPage, elapsedMs: Int)
  case failed(String)
}

/// 렌더러(실제는 `LinkRenderer`, 테스트는 가짜). WebKit 이라 메인 액터
@MainActor public protocol LinkRendering: AnyObject {
  func render(_ url: URL, budget: TimeInterval, ocr: Bool) async -> LinkRenderOutcome
}

/// 링크 → 큐 항목 흐름(스펙 §6 "링크·이미지 읽기"). 공유 확장·앱이 같이 쓴다
public enum LinkFlow {
  public static let shareLease: TimeInterval = 60
  public static let shareBudget: TimeInterval = 10
  public static let appBudget: TimeInterval = 15
  /// 공유 확장에서 렌더링할지. 시뮬레이터 G8(U1)·실기기 D1(U3)이 실패하면 false — 확장은 대기 행만 남기고 앱이 읽는다(스펙 §6 "실기기 미확인")
  public static let renderInShareExtension = true
  /// 확장이 앱에 넘길 실패(앱은 시간이 더 길고 OCR 을 한다). 나머지(blocked_*·http_<n>·unsupported·redirects·insecure)는 다시 해도 같다 — 행을 지운다
  public static let handOffCodes: Set<String> = ["timeout", "load_failed", "web_process", "extract_failed", "no_host", "cancelled", "empty"]
  /// 앱에서 다시 해 볼 실패(백오프 30초×2ⁿ, maxAppAttempts 회째에 지운다). cancelled 는 따로 — 행을 그대로 돌려놓고 시도로 세지 않는다
  public static let retryCodes: Set<String> = ["timeout", "load_failed", "web_process", "extract_failed", "no_host"]
  public static let maxAppAttempts = 3

  public enum Outcome: Equatable, Sendable {
    case queued(captureID: String, chars: Int, ocr: Bool, timedOut: Bool)
    /// 이미 읽은 링크(D14) — 렌더링·행 없음
    case duplicate
    /// 기기 규칙(otp 등) — 큐에 아무것도 남기지 않는다(메모 폐기면 대기 행도 만들지 않는다)
    case discarded(String)
    /// 확장 → 앱 이어받기(no_date · disabled · handOffCodes)
    case handedOff(String)
    /// 앱: 행을 남겨 다시 읽는다(retryCodes 는 백오프, cancelled 는 바로)
    case retry(String)
    /// 끝(사유 코드). 대기 행도 지웠다(queue = 큐 쓰기 실패)
    case failed(String)
  }

  public enum Admission: Equatable, Sendable { case go(PendingLink), stop(Outcome) }

  /// 읽기 전 관문(스펙 §6): 이미 읽은 링크면 duplicate, 메모가 기기 규칙에 걸리면 discarded — 둘 다 행을 만들지 않는다(App Group 에 인증번호를 남기지 않는다).
  /// 통과하면 마스킹한 메모로 대기 행을 남긴다(lease: 확장 60초, 채팅 600초)
  public static func admit(_ link: PendingLink, queue: CaptureQueue, lease: TimeInterval, now: Date = Date()) -> Admission {
    if (try? queue.isLinkSeen(captureID: link.captureID, now: now)) == true { return .stop(.duplicate) }
    var l = link
    if let n = link.note {
      switch RuleFilter().apply(text: n, sender: nil) {
      case .discard(let r): return .stop(.discarded(r))
      case .pass(let m): l.note = m
      }
    }
    do { try queue.enqueueLink(l, lease: lease, now: now) } catch { return .stop(.failed("queue")) }
    return .go(l)
  }

  /// 공유 확장: 관문 → 대기 행(확장이 죽어도 앱이 이어받게) → OCR 없이 읽는다. 날짜 후보가 없으면 앱(OCR)에 넘긴다
  @MainActor public static func share(_ link: PendingLink, renderer: LinkRendering?, queue: CaptureQueue,
                                      render: Bool = renderInShareExtension) async -> Outcome {
    let l: PendingLink
    switch admit(link, queue: queue, lease: shareLease) {
    case .stop(let o): return o
    case .go(let admitted): l = admitted
    }
    guard render, let renderer, let url = URL(string: l.url) else { try? queue.releaseLink(id: l.id); return .handedOff("disabled") }
    switch await renderer.render(url, budget: shareBudget, ocr: false) {
    case .failed(let code) where handOffCodes.contains(code):
      try? queue.releaseLink(id: l.id); return .handedOff(code)
    case .failed(let code):
      try? queue.markSent(id: l.id); return .failed(code)
    case .page(let page, _):
      guard LinkText.hasDateCandidate(page.searchable) else { try? queue.releaseLink(id: l.id); return .handedOff("no_date") }
      return finish(l, page: page, queue: queue)
    }
  }

  /// 앱(foreground): 15초 + 날짜 후보가 없거나 글이 없으면 OCR. 재시도 가능한 실패는 행을 남기고(3회째에 삭제), 취소는 행을 돌려놓고,
  /// 확정 실패는 행을 지운다(호출 쪽이 지워진 경우에만 알린다)
  @MainActor public static func app(_ link: PendingLink, renderer: LinkRendering, queue: CaptureQueue) async -> Outcome {
    guard let url = URL(string: link.url) else { try? queue.markSent(id: link.id); return .failed("bad_url") }
    switch await renderer.render(url, budget: appBudget, ocr: true) {
    case .failed("cancelled"):
      try? queue.releaseLink(id: link.id); return .retry("cancelled")                // 앱이 비활성 — 시도로 세지 않는다
    case .failed(let code) where retryCodes.contains(code) && link.attempts + 1 < maxAppAttempts:
      try? queue.markFailed(id: link.id); return .retry(code)
    case .failed(let code):
      try? queue.markSent(id: link.id); return .failed(code)
    case .page(let page, _):
      return finish(link, page: page, queue: queue)
    }
  }

  /// 본문 만들기 → 기기 규칙 → 큐 항목(id = captureID) → 대기 행 삭제 → (넣었으면) 읽은 링크 기록. 큐 쓰기가 실패하면 행을 남긴다(다음 foreground 에 다시)
  static func finish(_ link: PendingLink, page: LinkPage, queue: CaptureQueue) -> Outcome {
    let c = LinkText.compose(page, note: link.note)
    let result: String
    do {
      result = try CapturePipeline(filter: RuleFilter(), queue: queue)
        .handleRead(id: link.captureID, appName: LinkText.appName, title: c.title, text: c.text, capturedAt: link.capturedAt)
    } catch { return .failed("queue") }
    try? queue.markSent(id: link.id)
    guard result == "queued" else { return .discarded(String(result.dropFirst("discarded:".count))) }
    try? queue.markLinkSeen(captureID: link.captureID)
    return .queued(captureID: link.captureID, chars: c.text.count, ocr: page.ocrText != nil, timedOut: page.timedOut)
  }

  /// 로그 한 단어(DiagLog): queued · duplicate · discarded:<r> · handed_off:<r> · retry:<r> · failed:<r>
  public static func code(_ o: Outcome) -> String {
    switch o {
    case .queued: return "queued"
    case .duplicate: return "duplicate"
    case .discarded(let r): return "discarded:\(r)"
    case .handedOff(let r): return "handed_off:\(r)"
    case .retry(let r): return "retry:\(r)"
    case .failed(let r): return "failed:\(r)"
    }
  }

  /// trace `share.link` 필드(스펙 §6 "진단"): 결과 코드·수만. 주소·호스트·제목·본문 없음(이벤트 접두는 서버가 받는 share. — F8)
  public static func traceFields(_ o: Outcome, origin: String, elapsedMs: Int, blockedNav: Int = 0) -> [String: Any] {
    var f: [String: Any] = ["origin": origin, "elapsed_ms": elapsedMs, "blocked_nav": blockedNav]
    switch o {
    case .queued(_, let chars, let ocr, let timedOut): f["result"] = "queued"; f["chars"] = chars; f["ocr"] = ocr; f["timed_out"] = timedOut
    case .duplicate: f["result"] = "duplicate"
    case .discarded(let r): f["result"] = "discarded"; f["code"] = r
    case .handedOff(let r): f["result"] = "handed_off"; f["code"] = r
    case .retry(let r): f["result"] = "retry"; f["code"] = r
    case .failed(let r): f["result"] = "failed"; f["code"] = r
    }
    return f
  }
}

/// 사진 → 큐 항목(스펙 §6 "사진 OCR", LI3). 파일·대기 행 없이 OCR 글만 SHARE 항목(`app_name = "이미지"`)으로. 공유 확장·채팅이 같이 쓴다
public enum ImageFlow {
  public enum Outcome: Equatable, Sendable {
    case queued(captureID: String, chars: Int, images: Int)
    case discarded(String)
    /// 글자가 없는 사진(ImageText.minChars 미만) — 큐에 아무것도 넣지 않는다
    case empty
    case failed(String)
  }

  /// 사진마다의 OCR 글 → 본문(ImageText) → 기기 규칙 → 큐 항목(id 는 새 UUID — 사진은 같은 사진 판정을 하지 않는다)
  public static func finish(ocr: [String], images: Int, note: String?, queue: CaptureQueue, capturedAt: Date = Date()) -> Outcome {
    guard case .text(let text, _) = ImageText.compose(ocr: ocr, images: images, note: note) else { return .empty }
    let id = UUID().uuidString
    do {
      let r = try CapturePipeline(filter: RuleFilter(), queue: queue)
        .handleRead(id: id, appName: ImageText.appName, title: nil, text: text, capturedAt: capturedAt)
      guard r == "queued" else { return .discarded(String(r.dropFirst("discarded:".count))) }
      return .queued(captureID: id, chars: text.count, images: images)
    } catch { return .failed("queue") }
  }

  public static func code(_ o: Outcome) -> String {
    switch o {
    case .queued: return "queued"
    case .discarded(let r): return "discarded:\(r)"
    case .empty: return "empty"
    case .failed(let r): return "failed:\(r)"
    }
  }

  /// trace `share.image` 필드: 결과 코드·글자 수·장 수만(OCR 글 없음)
  public static func traceFields(_ o: Outcome, origin: String, elapsedMs: Int, images: Int) -> [String: Any] {
    var f: [String: Any] = ["origin": origin, "elapsed_ms": elapsedMs, "images": images]
    switch o {
    case .queued(_, let chars, _): f["result"] = "queued"; f["chars"] = chars
    case .discarded(let r): f["result"] = "discarded"; f["code"] = r
    case .empty: f["result"] = "empty"
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

/// 링크·사진 읽기 문구(스펙 §6·§9, 계획 D8). 주소·호스트·제목을 넣지 않는다
public enum LinkCaptureText {
  public static let reading = "링크를 읽는 중…"
  public static let imageReading = "사진에서 글자를 읽는 중…"
  public static let tooMany = "링크는 한 번에 하나씩 보내 주세요"
  /// 기기·서버 규칙 폐기(OTP 등). 청첩장 글의 우편번호·QR 번호가 걸릴 수 있어 "인증번호"라고 단정하지 않는다(Fable F10)
  public static let discarded = "보안 숫자로 보이는 내용이 있어 저장하지 않았어요."
  public static let duplicate = "이미 읽은 링크예요. 제안 탭에서 확인해 주세요."
  public static let pending = "아직 처리 중이에요 — 끝나면 알림으로 알려 드려요."
  /// 저장 범위(메인 판정 MR1 — 스펙 §6·§12): 확장 상태 화면·채팅 링크·사진 턴에 한 줄로
  public static let storageNote = "읽은 글은 공유한 내용처럼 암호화해 보관해요. 짧은 페이지는 보이는 글 전체가 저장돼요."
  public static let drainFailedTitle = "공유한 링크를 읽지 못했어요"
  public static let imageEmpty = "사진에서 글자를 찾지 못했어요."
  public static let imageFailed = "사진을 읽지 못했어요."

  public enum Subject: Sendable { case page, image }

  /// 실패 코드 → 사유(주소 없음)
  public static func reason(_ code: String) -> String {
    switch code {
    case "blocked_scheme": return "웹 주소가 아니에요"
    case "blocked_host": return "내부 네트워크 주소는 열지 않아요"
    case "redirects": return "페이지가 계속 다른 곳으로 넘어가요"
    case "unsupported": return "웹 페이지가 아니에요"
    case "insecure": return "보안 연결(https)이 안 되는 페이지예요"
    case "timeout": return "시간이 너무 걸려요"
    case "empty": return "읽을 글이 없어요"
    case "web_process": return "페이지가 너무 무거워요"
    case "cancelled": return "취소했어요"
    case "queue": return "기기에 저장하지 못했어요"
    case let c where c.hasPrefix("http_"): return "페이지 오류 \(c.dropFirst(5))"
    default: return "연결할 수 없어요"
    }
  }

  /// 공유 시트 결과(확장)
  public static func share(_ o: LinkFlow.Outcome) -> String {
    switch o {
    case .queued(_, let chars, _, _): return "페이지에서 글 \(chars)자를 읽었어요. 일정을 찾으면 알림으로 알려 드릴게요."
    case .duplicate: return duplicate
    case .handedOff("no_date"), .handedOff("empty"): return "그림으로 된 페이지 같아요. ERURI 앱을 열면 그림 속 글자까지 다시 읽어요."
    case .handedOff, .retry: return "지금은 다 읽지 못했어요. ERURI 앱을 열면 다시 읽어요."
    case .discarded: return discarded
    case .failed(let code): return "페이지를 읽지 못했어요(\(reason(code)))."
    }
  }

  /// 확장의 링크가 확정 실패해 원래 공유 글을 텍스트 항목으로 넣었을 때(D8)
  public static func shareFallback(_ code: String) -> String { "페이지를 읽지 못해 공유한 글만 저장했어요(\(reason(code)))." }

  /// 채팅 링크 턴의 읽기 결과(스펙 §9). queued 면 서버 처리를 기다린다
  public static func chat(_ o: LinkFlow.Outcome) -> String {
    switch o {
    case .queued(_, let chars, _, _): return "페이지에서 글 \(chars)자를 읽었어요. 일정을 찾는 중…"
    case .duplicate: return duplicate
    case .discarded: return discarded
    case .retry("cancelled"): return "앱으로 돌아오면 다시 읽어요."
    case .retry(let code): return "지금은 다 읽지 못했어요(\(reason(code))). 잠시 뒤 다시 읽고, 일정을 찾으면 알림으로 알려 드려요."
    case .handedOff(let code), .failed(let code): return "페이지를 읽지 못했어요(\(reason(code)))."
    }
  }

  /// 사진 결과(확장 chat: false, 채팅 chat: true)
  public static func image(_ o: ImageFlow.Outcome, chat: Bool) -> String {
    switch o {
    case .queued(_, let chars, _): return chat ? "사진에서 글 \(chars)자를 읽었어요. 일정을 찾는 중…" : "사진에서 글 \(chars)자를 읽었어요. 일정을 찾으면 알림으로 알려 드릴게요."
    case .discarded: return discarded
    case .empty: return imageEmpty
    case .failed: return imageFailed
    }
  }

  /// 채팅 링크·사진 턴의 서버 처리 결과(스펙 §9): 본인 items.status·gate_label·facts 종류. nil = 아직(행 없음·queued)
  public static func chatResult(status: String?, gateLabel: String?, kinds: [String], subject: Subject = .page) -> String? {
    guard let status, status != "queued" else { return nil }
    let noSchedule = subject == .page ? "이 페이지에서 일정을 찾지 못했어요." : "이 사진에서 일정을 찾지 못했어요."
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

  /// 앱 이어받기 실패 로컬 알림 본문(주소·제목 없음) — 행을 지운 경우(확정 실패·3회 실패)에만
  public static func drainFailedBody(_ code: String) -> String { "\(reason(code)). 날짜·장소 글을 복사해 ERURI로 공유해 주세요." }
}
```

- [ ] **Step 7: 통과 확인**

Run: `cd ios && ./scripts/sim.sh gen && ./scripts/sim.sh test EruriCoreTests/LinkFlowTests && ./scripts/sim.sh test EruriCoreTests/LinkCaptureTextTests`
Expected: `LinkFlowTests` 23개·`LinkCaptureTextTests` 5개 통과. `testQueryDigitsDoNotDiscard`의 대조 단언(`discarded:otp`)이 깨지면 고치지 말고 멈춰 메인에게 알린다(D3·UQ2의 근거가 달라진다). `enqueueLink`의 `ON CONFLICT … DO UPDATE`가 기기 SQLite에서 문법 오류면(3.24 미만은 없음 — iOS 26은 해당 없음) 보고한다.

- [ ] **Step 8: 회귀**

Run: `cd ios && ./scripts/sim.sh test EruriCoreTests`
Expected: 전체 통과(`CaptureQueueTests`·`CaptureIntentTests` 포함 — 캡처 claim·pending은 kind = 'capture'만 보고, `link_seen`은 별도 표다).

- [ ] **Step 9: 커밋**

```bash
git add ios/Packages/EruriCore/Sources/EruriCore/CaptureQueue.swift ios/Packages/EruriCore/Sources/EruriCore/CapturePipeline.swift \
  ios/Packages/EruriCore/Sources/EruriCore/LinkFlow.swift ios/Packages/EruriCore/Sources/EruriCore/LinkCaptureText.swift \
  ios/Packages/EruriCore/Tests/EruriCoreTests/LinkFlowTests.swift ios/Packages/EruriCore/Tests/EruriCoreTests/LinkCaptureTextTests.swift
git commit -m "feat(core): link pending rows, link_seen and LinkFlow/ImageFlow (spec §6 hand-off, same link, photos) — queue kind 'link' (PendingLink JSON, id link:<URL-derived capture id>) with lease, upsert on re-share, release, claim with attempts, 7-day expiry, next attempt time; link_seen table keeps capture ids 30 days (no URL); admission gate returns duplicate for read links and discards OTP notes before any row; LinkFlow.share renders 10 s without OCR, queues on a date candidate, hands timeouts/load failures/no-date/empty pages to the app and drops deterministic failures; LinkFlow.app renders 15 s with OCR, retries timeouts/load failures with backoff up to 3 tries, releases the row on cancel, drops final failures; ImageFlow queues one SHARE item (app_name 이미지) from per-photo OCR text with no file and no pending row; CapturePipeline.handleRead; trace fields carry codes and counts only; LinkCaptureText share/chat/photo/result/notice copy with the storage note and the duplicate line

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task L3: `LinkRenderer`(WKWebView) + `OCR` + `ShareImages` + 합성 HTML·루프백 서버 테스트

**Files:**
- Create: `ios/Packages/EruriCore/Sources/EruriCore/LinkRenderer.swift`
- Modify: `ios/Packages/EruriCore/Sources/EruriCore/OCR.swift`
- Create: `ios/Packages/EruriCore/Sources/EruriCore/ShareImages.swift`
- Test: `ios/Packages/EruriCore/Tests/EruriCoreTests/LinkRendererTests.swift`, `ios/Packages/EruriCore/Tests/EruriCoreTests/OCRImageTests.swift`

**Interfaces:**
- Consumes: L1 `LinkText.check`·`upgraded`·`hasDateCandidate`, `LinkPage.decode`, `LinkSettle`, `ImageText.maxImages`. L2 `LinkRendering`·`LinkRenderOutcome`.
- Produces:
  - `@MainActor final class LinkRenderer: NSObject, LinkRendering, WKNavigationDelegate` — `static viewport = CGSize(390, 844)`, `static maxNavigations = 6`, `static ocrScreens = 3`, `static extractAllowance = 2`, `static ocrAllowance = 8`, `init(host: UIView, allowLoopback: Bool, html: String? = nil)`(`html`은 테스트 전용), `static makeConfiguration() -> WKWebViewConfiguration`, `static ruleList(allowLoopback:) async -> WKContentRuleList?`, `nonisolated static blockRules(allowLoopback:) -> String`, `nonisolated static loadFailure(_:upgraded:) -> String?`, `render(_:budget:ocr:) async -> LinkRenderOutcome`, `private(set) var blockedNavigations: Int`
  - `OCR.recognize(image: UIImage) async throws -> String` · `OCR.recognize(data: Data, maxPixel: Int = 2048) async throws -> String` · `OCR.thumbnail(_:maxPixel:) -> CGImage?`(LI2)
  - `enum ShareImages { @MainActor static count(_ items: [NSExtensionItem]) -> Int; @MainActor static ocr(_ items: [NSExtensionItem], max: Int = 3) async -> (texts: [String], images: Int) }`(LI4 전반 — 확장이 쓴다)

설계 메모(구현자가 알아야 할 WebKit 사실): 네트워크 idle API 없음(F15) → `LinkSettle`로 길이 안정 판정. 웹뷰는 `host`(창 안에 있는 뷰)의 **맨 아래 서브뷰**로 붙여 다른 화면에 가려지게 한다 — WebKit은 창 안·foreground일 때만 보이는 뷰로 다룬다(F16, 화면 밖·창 밖은 미확인 U2). JS는 `callAsyncJavaScript(_:arguments:in:contentWorld:)`(반환 `Any?` — `evaluateJavaScript` async 판은 결과가 없으면 문제를 일으킨 적이 있어 쓰지 않는다)와 격리 세계 `.defaultClient`(DOM은 공유, 페이지 스크립트는 우리 함수를 못 바꾼다). 위임 메서드는 async 판(`decidePolicyFor … async -> WKNavigationActionPolicy`)만 구현한다(같은 선택자의 완료 핸들러 판과 함께 두면 모호하다). **JS 호출은 페이지 스크립트가 멈추면 돌아오지 않는다** — 그래서 `render`는 내부 작업과 독립 기한·취소를 경주시키고(D15), 내부 작업의 늦은 결과는 버린다. 위임 메서드는 위임 객체를 다시 쓰는 다음 렌더링과 섞이지 않게 `webView === current`일 때만 상태를 바꾼다. 하위 리소스(img·fetch·XHR)는 위임 메서드를 거치지 않으므로(F17) `WKContentRuleList`로 막는다 — WebKit 콘텐츠 규칙의 `url-filter`는 `|`·`{n}`을 지원하지 않아 규칙을 나눠 적는다.

- [ ] **Step 1: 실패하는 테스트**

`ios/Packages/EruriCore/Tests/EruriCoreTests/LinkRendererTests.swift`:

```swift
import XCTest
import UIKit
import Network
@testable import EruriCore

/// WKWebView 렌더러(스펙 §6 "링크·이미지 읽기"): 합성 HTML 을 네트워크 없이(loadHTMLString, 기준 주소 = 공유 주소) 창 안 다른 화면 밑에서 읽고,
/// HTTP 상태·리다이렉트·응답 없음·하위 리소스 차단은 테스트 안 루프백 서버로 본다(Fable F7). 창 안·화면 밑 렌더링(U2)·시뮬레이터 Vision 한국어(U4)·
/// 루프백 http(U5)를 여기서 판정한다. 글은 모두 합성. 시간 예산은 스왑 포화 기계를 감안해 5초 이상
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

  /// 루프백 서버 주소를 DEBUG 게이트처럼(allowLoopback) 연다
  @MainActor private func load(_ path: String, port: UInt16, budget: TimeInterval = 5) async throws -> LinkRenderOutcome {
    let w = try window()
    defer { w.isHidden = true }
    return await LinkRenderer(host: w, allowLoopback: true).render(URL(string: "http://127.0.0.1:\(port)\(path)")!, budget: budget, ocr: false)
  }

  /// 서버를 띄우고 /ok 를 한 번 읽어 본다 — 루프백 http 가 ATS 로 막히면(U5) 이 클래스의 서버 테스트는 건너뛴다(LNK-sim 하네스 예외로 판정)
  @MainActor private func server() async throws -> LoopServer {
    let s = try await LoopServer.start()
    if case .failed(let code) = try await load("/ok", port: s.port), code == "load_failed" || code == "insecure" {
      s.stop()
      throw XCTSkip("U5: 루프백 http 로드 실패(\(code)) — ATS. L8 하네스 Info.plist 예외로 판정")
    }
    return s
  }

  @MainActor func testConfigurationIsEphemeralAndSilent() {
    let c = LinkRenderer.makeConfiguration()
    XCTAssertFalse(c.websiteDataStore.isPersistent)
    XCTAssertEqual(c.mediaTypesRequiringUserActionForPlayback, .all)
    XCTAssertFalse(c.preferences.javaScriptCanOpenWindowsAutomatically)
  }

  /// 하위 리소스 차단 규칙(Codex 6, D7): JSON 이 맞고, 릴리스는 루프백까지 막는다
  func testBlockRulesAreValidJSON() throws {
    for loop in [false, true] {
      let rules = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(LinkRenderer.blockRules(allowLoopback: loop).utf8)) as? [[String: Any]])
      XCTAssertEqual(rules.count, loop ? 14 : 16)
      let filters = rules.compactMap { ($0["trigger"] as? [String: Any])?["url-filter"] as? String }
      XCTAssertEqual(filters.contains { $0.contains("127") }, !loop)
      XCTAssertTrue(filters.contains(#"^[a-z]+://192\.168\."#))
      XCTAssertTrue(rules.allSatisfy { ($0["action"] as? [String: Any])?["type"] as? String == "block" })
    }
  }

  @MainActor func testRuleListCompiles() async {
    let a = await LinkRenderer.ruleList(allowLoopback: false)
    let b = await LinkRenderer.ruleList(allowLoopback: true)
    XCTAssertNotNil(a)
    XCTAssertNotNil(b)
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
      """, budget: 5)
    let p = try page(o)
    XCTAssertTrue(p.timedOut)
    XCTAssertTrue(p.body.contains("11월 14일"))
  }

  /// 멈춘 페이지(무한 루프 — JS 호출이 돌아오지 않는다, Codex 2): 독립 기한(예산 + 추출 몫)에 끝난다
  @MainActor func testStuckPageTimesOut() async throws {
    let started = Date()
    let (o, _) = try await read("""
      <html><body><p>2026년 11월 14일 합성 행사</p><script>setTimeout(() => { for (;;) {} }, 300);</script></body></html>
      """, budget: 5)
    XCTAssertTrue(o == .failed("timeout") || o == .failed("web_process"), "\(o)")
    XCTAssertLessThan(Date().timeIntervalSince(started), 5 + LinkRenderer.extractAllowance + 5)
  }

  /// 취소(앱이 비활성 — L5): 기다리지 않고 바로 cancelled
  @MainActor func testCancelReturnsCancelled() async throws {
    let w = try window()
    defer { w.isHidden = true }
    let base = self.base
    let r = LinkRenderer(host: w, allowLoopback: false, html: """
      <html><body><p>합성</p><div id="t"></div><script>setInterval(() => { document.getElementById('t').textContent += '가'; }, 200);</script></body></html>
      """)
    let t = Task { @MainActor in await r.render(base, budget: 10, ocr: false) }
    try await Task.sleep(for: .seconds(1))
    t.cancel()
    let cancelled = Date()
    let o = await t.value
    XCTAssertEqual(o, .failed("cancelled"))
    XCTAssertLessThan(Date().timeIntervalSince(cancelled), 2)
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

  /// 글 0자 + OCR 도 빈 화면 → 확정 실패 empty(앱)
  @MainActor func testEmptyPageFailsAfterOCR() async throws {
    let (o, _) = try await read("<html><body></body></html>", budget: 6, ocr: true)
    XCTAssertEqual(o, .failed("empty"))
  }

  /// 글 0자, OCR 없음(확장, Codex 1): 실패가 아니라 빈 페이지를 돌려 확장이 no_date 로 앱에 넘긴다
  @MainActor func testEmptyPageWithoutOCRReturnsEmptyPage() async throws {
    let (o, _) = try await read("<html><body></body></html>", budget: 6, ocr: false)
    XCTAssertTrue(try page(o).isEmpty)
  }

  @MainActor func testBlockedAddressesAreNotLoaded() async throws {
    let w = try window()
    defer { w.isHidden = true }
    let r = LinkRenderer(host: w, allowLoopback: false)
    let a = await r.render(URL(string: "http://192.168.0.1/")!, budget: 5, ocr: false)
    let b = await r.render(URL(string: "kakaolink://send")!, budget: 5, ocr: false)
    XCTAssertEqual(a, .failed("blocked_host"))
    XCTAssertEqual(b, .failed("blocked_scheme"))
  }

  @MainActor func testHostOutsideWindowFails() async throws {
    let detached = UIView(frame: CGRect(origin: .zero, size: LinkRenderer.viewport))
    let o = await LinkRenderer(host: detached, allowLoopback: false).render(base, budget: 5, ocr: false)
    XCTAssertEqual(o, .failed("no_host"))
  }

  /// 이미지 전용 청첩장(D4, Codex 1): 글이 **0자**인 문서도 화면 스냅샷 OCR. 그림은 테스트 안에서 그린다(저장소에 그림 파일 없음)
  @MainActor func testImageOnlyPageUsesOCR() async throws {
    let img = UIGraphicsImageRenderer(size: CGSize(width: 360, height: 240)).image { _ in
      UIColor.white.setFill(); UIRectFill(CGRect(x: 0, y: 0, width: 360, height: 240))
      let a: [NSAttributedString.Key: Any] = [.font: UIFont.boldSystemFont(ofSize: 26), .foregroundColor: UIColor.black]
      ("2026년 12월 5일 토요일" as NSString).draw(at: CGPoint(x: 16, y: 60), withAttributes: a)
      ("합성 컨벤션 웨딩홀" as NSString).draw(at: CGPoint(x: 16, y: 120), withAttributes: a)
    }
    let b64 = try XCTUnwrap(img.pngData()).base64EncodedString()
    let (o, _) = try await read("""
      <html><body style="margin:0"><img src="data:image/png;base64,\(b64)" width="360"></body></html>
      """, budget: 8, ocr: true)
    let p = try page(o)
    XCTAssertTrue(p.visibleText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
    let t = try XCTUnwrap(p.ocrText, "OCR 결과 없음 — U4(시뮬레이터 Vision 한국어)·U2(스냅샷)를 메인에게 알린다")
    XCTAssertTrue(LinkText.hasDateCandidate(t), "OCR 글자 수 \(t.count)")
  }

  /// OCR 을 끄면(확장) 날짜가 없어도 스냅샷하지 않는다
  @MainActor func testNoOCRWhenDisabled() async throws {
    let (o, _) = try await read("<html><body><p>터치하면 음악이 재생됩니다</p></body></html>", budget: 5, ocr: false)
    XCTAssertNil(try page(o).ocrText)
  }

  /// 이동 오류 → 코드(F3·U8 대체): 우리가 취소한 이동은 무시, 시간 초과·리다이렉트 초과, https 로 올린 주소의 TLS·연결 실패는 insecure
  func testLoadFailureCodes() {
    func e(_ c: Int, _ d: String = NSURLErrorDomain) -> NSError { NSError(domain: d, code: c) }
    XCTAssertNil(LinkRenderer.loadFailure(e(NSURLErrorCancelled), upgraded: false))
    XCTAssertNil(LinkRenderer.loadFailure(e(102, "WebKitErrorDomain"), upgraded: false))
    XCTAssertEqual(LinkRenderer.loadFailure(e(NSURLErrorTimedOut), upgraded: false), "timeout")
    XCTAssertEqual(LinkRenderer.loadFailure(e(NSURLErrorHTTPTooManyRedirects), upgraded: false), "redirects")
    XCTAssertEqual(LinkRenderer.loadFailure(e(NSURLErrorSecureConnectionFailed), upgraded: true), "insecure")
    XCTAssertEqual(LinkRenderer.loadFailure(e(NSURLErrorCannotConnectToHost), upgraded: true), "insecure")
    XCTAssertEqual(LinkRenderer.loadFailure(e(NSURLErrorSecureConnectionFailed), upgraded: false), "load_failed")
    XCTAssertEqual(LinkRenderer.loadFailure(e(NSURLErrorCannotFindHost), upgraded: true), "load_failed")
  }

  // MARK: 루프백 서버(Fable F7) — loadHTMLString 이 타지 않는 응답 정책·리다이렉트·요청 시간 초과

  /// U5 대조: 루프백 http 200 페이지를 읽는다
  @MainActor func testLoopbackControlLoads() async throws {
    let s = try await LoopServer.start()
    defer { s.stop() }
    let o = try await load("/ok", port: s.port)
    if case .failed(let code) = o, code == "load_failed" { throw XCTSkip("U5: 루프백 http 가 ATS 로 막힌다 — L8 Step 2 하네스 예외") }
    XCTAssertTrue(try page(o).body.contains("11월 14일"))
  }

  @MainActor func testHTTPErrorFails() async throws {
    let s = try await server()
    defer { s.stop() }
    let o = try await load("/missing", port: s.port)
    XCTAssertEqual(o, .failed("http_404"))
  }

  /// 302 가 끝없이 이어진다: 메인 프레임 이동 6회 초과 또는 WebKit 의 리다이렉트 초과(-1007) — 어느 쪽이든 redirects
  @MainActor func testTooManyRedirectsFail() async throws {
    let s = try await server()
    defer { s.stop() }
    let o = try await load("/loop/0", port: s.port, budget: 8)
    XCTAssertEqual(o, .failed("redirects"))
  }

  /// 응답이 오지 않는다: 요청 시간 초과(-1001) 또는 예산 — 어느 쪽이든 timeout
  @MainActor func testNoResponseTimesOut() async throws {
    let s = try await server()
    defer { s.stop() }
    let o = try await load("/hang", port: s.port, budget: 5)
    XCTAssertEqual(o, .failed("timeout"))
  }

  /// 하위 리소스·하위 프레임의 사설 주소(Codex 6): 이미지는 콘텐츠 규칙, iframe 은 위임 메서드(·규칙)가 막는다 — 서버에 요청이 오지 않는다
  @MainActor func testPrivateSubresourcesAreBlocked() async throws {
    let s = try await server()
    defer { s.stop() }
    let doc = """
      <html><body><p>2026년 11월 14일 합성웨딩홀</p><img src="http://127.0.0.1:\(s.port)/pixel"><iframe src="http://127.0.0.1:\(s.port)/frame"></iframe></body></html>
      """
    let plain = URL(string: "http://invite.example.com/m/abc")!            // 대조군에서 혼합 콘텐츠 차단을 피하려고 http 기준 주소(네트워크 로드는 없다)
    let w = try window()
    defer { w.isHidden = true }
    _ = await LinkRenderer(host: w, allowLoopback: true, html: doc).render(plain, budget: 5, ocr: false)       // 대조: 루프백 허용이면 요청이 간다
    try XCTSkipIf(s.hits("/pixel") == 0, "대조군 0 — 하위 리소스 루프백 요청이 다른 이유로 막힌다. 규칙 판정은 L8 G9 옆에서")
    let pixel = s.hits("/pixel"), frame = s.hits("/frame")
    let r = LinkRenderer(host: w, allowLoopback: false, html: doc)
    let o = await r.render(plain, budget: 5, ocr: false)
    XCTAssertTrue(try page(o).body.contains("11월 14일"))
    XCTAssertEqual(s.hits("/pixel"), pixel)
    XCTAssertEqual(s.hits("/frame"), frame)
  }
}

/// 테스트 안 루프백 HTTP 서버(Network, 127.0.0.1 임의 포트, 연결마다 요청 하나).
/// /ok 200(날짜 있는 글) · /missing 404 · /loop/<n> 302 → /loop/<n+1> · /hang 답하지 않음 · 그 밖 200 빈 본문
final class LoopServer: @unchecked Sendable {
  private let listener: NWListener
  private let queue = DispatchQueue(label: "link-loop-server")
  private var paths: [String] = []                 // queue 에서만 고친다
  private var held: [Conn] = []
  private(set) var port: UInt16 = 0

  /// NWConnection 을 Sendable 클로저로 넘기는 상자(queue 에서만 쓴다)
  final class Conn: @unchecked Sendable { let c: NWConnection; init(_ c: NWConnection) { self.c = c } }
  /// 한 번만 참(queue 에서만 부른다)
  final class Once: @unchecked Sendable { private var done = false; func take() -> Bool { defer { done = true }; return !done } }

  private init() throws {
    let params = NWParameters.tcp
    params.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: .any)
    listener = try NWListener(using: params)
  }

  static func start() async throws -> LoopServer {
    let s = try LoopServer()
    s.port = try await s.listen()
    return s
  }

  private func listen() async throws -> UInt16 {
    listener.newConnectionHandler = { [weak self] c in self?.serve(Conn(c)) }
    return try await withCheckedThrowingContinuation { (k: CheckedContinuation<UInt16, Error>) in
      let once = Once()
      listener.stateUpdateHandler = { [self] state in
        switch state {
        case .ready: if once.take() { k.resume(returning: self.listener.port?.rawValue ?? 0) }
        case .failed(let e): if once.take() { k.resume(throwing: e) }
        default: break
        }
      }
      listener.start(queue: queue)
    }
  }

  func stop() {
    listener.cancel()
    queue.sync { held.forEach { $0.c.cancel() }; held.removeAll() }
  }

  func hits(_ path: String) -> Int { queue.sync { paths.filter { $0 == path }.count } }

  private func serve(_ conn: Conn) {
    conn.c.start(queue: queue)
    conn.c.receive(minimumIncompleteLength: 1, maximumLength: 16_384) { [weak self] data, _, _, _ in
      guard let self, let data, let line = String(decoding: data, as: UTF8.self).split(separator: "\r\n").first,
            let path = line.split(separator: " ").dropFirst().first.map(String.init) else { conn.c.cancel(); return }
      self.paths.append(path)
      guard let resp = Self.response(path) else { self.held.append(conn); return }       // /hang: 답하지 않고 연결만 쥔다
      conn.c.send(content: Data(resp.utf8), completion: .contentProcessed { _ in conn.c.cancel() })
    }
  }

  static func response(_ path: String) -> String? {
    func r(_ status: String, _ extra: String = "", _ body: String = "") -> String {
      "HTTP/1.1 \(status)\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: \(body.utf8.count)\r\nConnection: close\r\n\(extra)\r\n\(body)"
    }
    switch path {
    case "/ok": return r("200 OK", "", "<html><body><p>2026년 11월 14일 합성웨딩홀</p></body></html>")
    case "/missing": return r("404 Not Found", "", "<html><body>없음</body></html>")
    case "/hang": return nil
    case let p where p.hasPrefix("/loop/"): return r("302 Found", "Location: /loop/\((Int(p.dropFirst(6)) ?? 0) + 1)\r\n")
    default: return r("200 OK")
    }
  }
}
```

`ios/Packages/EruriCore/Tests/EruriCoreTests/OCRImageTests.swift`:

```swift
import XCTest
import UIKit
import ImageIO
import UniformTypeIdentifiers
@testable import EruriCore

/// 사진 OCR(스펙 §6 "사진 OCR", LI2·LI4): ImageIO 축소·EXIF 방향, 공유 첨부 한 장씩 OCR. 그림은 테스트 안에서 그린다(합성)
final class OCRImageTests: XCTestCase {
  @MainActor private func card(_ lines: [String], size: CGSize = CGSize(width: 480, height: 200)) -> UIImage {
    let fmt = UIGraphicsImageRendererFormat()
    fmt.scale = 1
    return UIGraphicsImageRenderer(size: size, format: fmt).image { _ in
      UIColor.white.setFill(); UIRectFill(CGRect(origin: .zero, size: size))
      for (i, l) in lines.enumerated() {
        (l as NSString).draw(at: CGPoint(x: 20, y: CGFloat(40 + i * 60)),
                             withAttributes: [.font: UIFont.boldSystemFont(ofSize: 34), .foregroundColor: UIColor.black])
      }
    }
  }

  /// 저장 픽셀은 반시계 90°(200×480) + EXIF 방향 6(오른쪽) — 시계 90° 돌려 보여야 바로 서는 사진(세로로 찍은 폰 사진과 같은 모양)
  @MainActor private func rotatedJPEG(_ lines: [String]) throws -> Data {
    let upright = card(lines)
    let fmt = UIGraphicsImageRendererFormat()
    fmt.scale = 1
    let rotated = UIGraphicsImageRenderer(size: CGSize(width: 200, height: 480), format: fmt).image { ctx in
      ctx.cgContext.translateBy(x: 0, y: 480)
      ctx.cgContext.rotate(by: -.pi / 2)
      upright.draw(in: CGRect(x: 0, y: 0, width: 480, height: 200))
    }
    let data = NSMutableData()
    let dest = try XCTUnwrap(CGImageDestinationCreateWithData(data, UTType.jpeg.identifier as CFString, 1, nil))
    CGImageDestinationAddImage(dest, try XCTUnwrap(rotated.cgImage), [kCGImagePropertyOrientation: 6] as CFDictionary)
    XCTAssertTrue(CGImageDestinationFinalize(dest))
    return data as Data
  }

  /// 축소본은 EXIF 방향을 반영해 가로(480×200)로 서고, maxPixel 을 넘지 않는다(Vision 없이 판정)
  @MainActor func testThumbnailAppliesOrientationAndLimit() throws {
    let d = try rotatedJPEG(["2026년 12월 5일 토요일"])
    let full = try XCTUnwrap(OCR.thumbnail(d, maxPixel: 2048))
    XCTAssertGreaterThan(full.width, full.height)
    let small = try XCTUnwrap(OCR.thumbnail(d, maxPixel: 240))
    XCTAssertLessThanOrEqual(max(small.width, small.height), 240)
    XCTAssertNil(OCR.thumbnail(Data("not an image".utf8), maxPixel: 2048))
  }

  /// 돌아간 사진도 읽는다(기존 VNImageRequestHandler(cgImage:) 는 방향을 모른다)
  @MainActor func testRecognizeDataReadsRotatedPhoto() async throws {
    let t = try await OCR.recognize(data: try rotatedJPEG(["2026년 12월 5일 토요일", "합성 컨벤션 웨딩홀"]))
    if t.isEmpty { throw XCTSkip("U4: 시뮬레이터 Vision 한국어 결과 없음 — LNK-device D6 에서 판정") }
    XCTAssertTrue(LinkText.hasDateCandidate(t), "OCR 글자 수 \(t.count)")
  }

  /// 공유 첨부(사진 앱처럼 NSItemProvider)에서 앞의 3장만, 한 장씩 메모리로 읽는다 — 파일을 만들지 않는다
  @MainActor func testShareImagesReadsUpToThree() async throws {
    let item = NSExtensionItem()
    item.attachments = try (1...4).map { n in
      let png = try XCTUnwrap(card(["2026년 12월 \(n)일 토요일"]).pngData())
      return NSItemProvider(item: png as NSData, typeIdentifier: UTType.png.identifier)
    }
    XCTAssertEqual(ShareImages.count([item]), 4)
    let r = await ShareImages.ocr([item])
    XCTAssertEqual(r.images, 3)
    XCTAssertEqual(r.texts.count, 3)
    if r.texts.allSatisfy(\.isEmpty) { throw XCTSkip("U4: 시뮬레이터 Vision 한국어 결과 없음 — 장 수만 판정") }
    XCTAssertTrue(r.texts.contains { LinkText.hasDateCandidate($0) })
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
import ImageIO

public enum OCR {
  public static func recognize(imageURL: URL) async throws -> String {
    let req = VNRecognizeTextRequest()
    req.recognitionLanguages = ["ko-KR", "en-US"]
    req.recognitionLevel = .accurate
    try VNImageRequestHandler(url: imageURL).perform([req])
    return (req.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
  }

  /// 링크 화면 스냅샷(스펙 §6 "이미지 전용 페이지"). Vision 은 메인 밖에서 돈다. 한국어는 accurate 에서만(F17)
  public static func recognize(image: UIImage) async throws -> String {
    guard let cg = image.cgImage else { return "" }
    let box = Image(cg: cg)
    return try await Task.detached(priority: .userInitiated) { try recognize(cgImage: box.cg) }.value
  }

  /// 공유·채팅 사진(스펙 §6 "사진 OCR", LI2): ImageIO 축소본(긴 변 maxPixel, EXIF 방향 반영)만 풀어 읽는다 —
  /// 48MP 원본을 통째로 풀지 않는다(확장 메모리, U10). 이미지가 아니면 빈 글
  public static func recognize(data: Data, maxPixel: Int = 2048) async throws -> String {
    guard let cg = thumbnail(data, maxPixel: maxPixel) else { return "" }
    let box = Image(cg: cg)
    return try await Task.detached(priority: .userInitiated) { try recognize(cgImage: box.cg) }.value
  }

  /// 긴 변 maxPixel 이하 축소본(원본이 더 작으면 원본 크기). kCGImageSourceCreateThumbnailWithTransform 이 EXIF 방향을 픽셀에 반영한다
  static func thumbnail(_ data: Data, maxPixel: Int) -> CGImage? {
    guard let src = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
    let opts: [CFString: Any] = [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceCreateThumbnailWithTransform: true,
                                 kCGImageSourceThumbnailMaxPixelSize: maxPixel, kCGImageSourceShouldCacheImmediately: true]
    return CGImageSourceCreateThumbnailAtIndex(src, 0, opts as CFDictionary)
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

- [ ] **Step 4: `ShareImages`**

`ios/Packages/EruriCore/Sources/EruriCore/ShareImages.swift`:

```swift
import Foundation
import UniformTypeIdentifiers

/// 공유 이미지(스펙 §6 "사진 OCR", LI4): 이미지 첨부를 앞에서부터 최대 max 장, **한 장씩** 메모리로 받아 OCR 하고 바로 버린다.
/// App Group·디스크에 파일을 만들지 않는다(대기 행 없음 — 확장이 죽으면 그 공유는 남지 않는다). 확장 메모리(U10) 때문에 동시에 한 장만 든다
public enum ShareImages {
  /// 이미지 첨부 수(웹 주소와 함께 왔는지·진단)
  @MainActor public static func count(_ items: [NSExtensionItem]) -> Int { providers(items).count }

  /// 반환: 장마다의 OCR 글(못 읽은 장은 빈 글), 읽으려 한 장 수(≤ max)
  @MainActor public static func ocr(_ items: [NSExtensionItem], max: Int = ImageText.maxImages) async -> (texts: [String], images: Int) {
    var texts: [String] = []
    for p in providers(items).prefix(max) {
      if Task.isCancelled { break }
      guard let d = await data(p) else { texts.append(""); continue }
      texts.append((try? await OCR.recognize(data: d)) ?? "")                  // d 는 이 반복이 끝나면 놓인다
    }
    return (texts, texts.count)
  }

  @MainActor static func providers(_ items: [NSExtensionItem]) -> [NSItemProvider] {
    items.flatMap { $0.attachments ?? [] }.filter { $0.hasItemConformingToTypeIdentifier(UTType.image.identifier) }
  }

  /// 등록된 형식 중 이미지에 맞는 첫 형식(HEIC·JPEG·PNG)으로 데이터를 받는다
  @MainActor static func data(_ p: NSItemProvider) async -> Data? {
    let type = p.registeredTypeIdentifiers.first { UTType($0)?.conforms(to: .image) == true } ?? UTType.image.identifier
    return await withCheckedContinuation { (k: CheckedContinuation<Data?, Never>) in
      _ = p.loadDataRepresentation(forTypeIdentifier: type) { d, _ in k.resume(returning: d) }
    }
  }
}
```

- [ ] **Step 5: `LinkRenderer`**

`ios/Packages/EruriCore/Sources/EruriCore/LinkRenderer.swift`:

```swift
import UIKit
import WebKit

/// 보이지 않는 웹뷰로 페이지를 읽는다(스펙 §6 "링크·이미지 읽기"). WebKit 이라 메인 액터에서만.
/// 웹뷰는 실제 화면 크기로 host(창 안에 있는 뷰)의 **맨 아래**에 붙는다 — WebKit 은 창 안·foreground 일 때만 보이는 뷰로 다뤄 렌더링·타이머를 돌린다(F16)
@MainActor public final class LinkRenderer: NSObject, LinkRendering, WKNavigationDelegate {
  public static let viewport = CGSize(width: 390, height: 844)
  /// 메인 프레임 이동 상한(첫 로드 + 리다이렉트 5회)
  public static let maxNavigations = 6
  public static let ocrScreens = 3
  /// 예산 뒤 추출·마무리 몫(초). 독립 기한 = 예산 + 이것 + (OCR 이면) ocrAllowance — 확장 12초, 앱 25초(D15)
  public static let extractAllowance: TimeInterval = 2
  public static let ocrAllowance: TimeInterval = 8
  static let subframeSchemes: Set<String> = ["http", "https", "about", "data", "blob"]
  private static var ruleLists: [Bool: WKContentRuleList] = [:]

  private weak var host: UIView?
  private let allowLoopback: Bool
  private let html: String?
  /// 지금 렌더링 중인 웹뷰 — 위임 콜백은 이 웹뷰의 것만 반영한다(경주에서 진 이전 렌더링이 상태를 바꾸지 않게)
  private weak var current: WKWebView?
  private var finished = false, committed = false, failure: String?, navigations = 0, upgradedScheme = false
  /// 이번 렌더링에서 막은 이동 수(앱 스킴·새 창·사설 주소, 하위 프레임 포함) — 진단용
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

  /// 하위 리소스(이미지·fetch·XHR·iframe — 모든 종류)의 사설 IP 리터럴·localhost·.local 요청 차단 규칙(Codex 6, D7). 한 번 컴파일해 재사용한다.
  /// 컴파일에 실패하면 nil(위임 메서드의 프레임 검사만 남는다 — DiagLog 에 코드만)
  public static func ruleList(allowLoopback: Bool) async -> WKContentRuleList? {
    if let l = ruleLists[allowLoopback] { return l }
    guard let store = WKContentRuleListStore.default() else { return nil }
    let l = (try? await store.compileContentRuleList(forIdentifier: "eruri-link-private-\(allowLoopback ? "debug" : "release")",
                                                      encodedContentRuleList: blockRules(allowLoopback: allowLoopback))) ?? nil
    if let l { ruleLists[allowLoopback] = l } else { DiagLog.append("link rules compile_failed") }
    return l
  }

  /// 규칙 JSON. WebKit 콘텐츠 규칙의 url-filter 는 `|`·`{n}` 을 지원하지 않아 대역마다 규칙 하나. 공개 이름이 사설 주소로 풀리는 경우는 막지 않는다(스펙 §6)
  nonisolated static func blockRules(allowLoopback: Bool) -> String {
    var hosts = [#"10\\."#, #"192\\.168\\."#, #"169\\.254\\."#, #"172\\.1[6-9]\\."#, #"172\\.2[0-9]\\."#, #"172\\.3[01]\\."#,
                 #"100\\.6[4-9]\\."#, #"100\\.[7-9][0-9]\\."#, #"100\\.1[01][0-9]\\."#, #"100\\.12[0-7]\\."#, #"0\\."#,
                 #"\\[f"#, #"\\[::"#, #"[a-z0-9.-]*\\.local[:/]"#]
    if !allowLoopback { hosts += [#"127\\."#, #"localhost[:/]"#] }
    let rules = hosts.map { #"{"trigger":{"url-filter":"^[a-z]+://\#($0)"},"action":{"type":"block"}}"# }
    return "[" + rules.joined(separator: ",") + "]"
  }

  /// 이동 오류 → 실패 코드. 우리가 취소한 이동(-999, WebKitErrorDomain 102 정책 변경)은 nil(실패 아님).
  /// https 로 올린 주소(upgraded)의 TLS·연결 거부·ATS 오류는 insecure(그 사이트는 https 가 안 된다 — 다시 해도 같다)
  nonisolated static func loadFailure(_ e: NSError, upgraded: Bool) -> String? {
    if e.code == NSURLErrorCancelled || (e.domain == "WebKitErrorDomain" && e.code == 102) { return nil }
    guard e.domain == NSURLErrorDomain else { return "load_failed" }
    switch e.code {
    case NSURLErrorTimedOut: return "timeout"
    case NSURLErrorHTTPTooManyRedirects: return "redirects"
    case NSURLErrorSecureConnectionFailed, NSURLErrorServerCertificateHasBadDate, NSURLErrorServerCertificateUntrusted,
         NSURLErrorServerCertificateHasUnknownRoot, NSURLErrorServerCertificateNotYetValid, NSURLErrorClientCertificateRejected,
         NSURLErrorClientCertificateRequired, NSURLErrorCannotConnectToHost, NSURLErrorAppTransportSecurityRequiresSecureConnection:
      return upgraded ? "insecure" : "load_failed"
    default: return "load_failed"
    }
  }

  public func render(_ url: URL, budget: TimeInterval, ocr: Bool) async -> LinkRenderOutcome {
    if let b = LinkText.check(url, allowLoopback: allowLoopback) { return .failed("blocked_\(b.rawValue)") }
    guard let host, host.window != nil else { return .failed("no_host") }
    if Task.isCancelled { return .failed("cancelled") }
    let target = html == nil ? LinkText.upgraded(url, allowLoopback: allowLoopback) : url     // http → https(F24, D7)
    finished = false; committed = false; failure = nil; navigations = 0; blockedNavigations = 0
    upgradedScheme = target.scheme != url.scheme
    let config = Self.makeConfiguration()
    if let rules = await Self.ruleList(allowLoopback: allowLoopback) { config.userContentController.add(rules) }   // 웹뷰를 만들기 전에(설정은 복사된다)
    let wv = WKWebView(frame: CGRect(origin: .zero, size: Self.viewport), configuration: config)
    wv.isUserInteractionEnabled = false
    wv.navigationDelegate = self
    current = wv
    host.insertSubview(wv, at: 0)                                  // 다른 화면 밑 — 사용자에게 보이지 않는다
    defer {
      wv.stopLoading(); wv.navigationDelegate = nil; wv.removeFromSuperview()
      if current === wv { current = nil }
    }
    if let html { wv.loadHTMLString(html, baseURL: url) } else { wv.load(URLRequest(url: target, timeoutInterval: budget)) }

    // 독립 기한 경주(D15, Codex 2): JS 호출은 페이지 스크립트가 멈추면 돌아오지 않는다 — 내부 작업·기한·취소 중 먼저 온 것으로 돌아오고 웹뷰를 뗀다.
    // 진 내부 작업은 취소되고 결과는 버린다(멈춘 WebContent 를 기다리는 호출은 웹뷰가 풀릴 때 끝난다)
    let limit = budget + Self.extractAllowance + (ocr ? Self.ocrAllowance : 0)
    let race = RenderRace()
    let work = Task { @MainActor in race.finish(await self.read(wv, url: url, budget: budget, ocr: ocr)) }
    let timer = Task { @MainActor in
      guard (try? await Task.sleep(for: .seconds(limit))) != nil else { return }
      race.finish(.failed("timeout"))
    }
    let outcome = await withTaskCancellationHandler {
      await race.wait()
    } onCancel: {
      Task { @MainActor in race.finish(.failed("cancelled")) }
    }
    work.cancel(); timer.cancel()
    return outcome
  }

  /// 내부 작업: 대기(LinkSettle) → 추출 → (앱) 스냅샷 OCR
  private func read(_ wv: WKWebView, url: URL, budget: TimeInterval, ocr: Bool) async -> LinkRenderOutcome {
    let clock = ContinuousClock(), start = clock.now
    func elapsed() -> TimeInterval {
      let c = start.duration(to: clock.now).components
      return Double(c.seconds) + Double(c.attoseconds) / 1e18
    }
    var settle = LinkSettle(budget: budget), timedOut = false
    wait: while true {
      if Task.isCancelled { return .failed("cancelled") }
      if let f = failure { return .failed(f) }
      let len = (try? await wv.callAsyncJavaScript(LinkScript.length, contentWorld: .defaultClient)) as? Int ?? 0
      switch settle.observe(length: len, finished: finished, elapsed: elapsed()) {
      case .done: break wait
      case .deadline:
        if !committed { return .failed(failure ?? "timeout") }     // 페이지가 서지도 못했다
        timedOut = true                                            // 0자여도 추출(OG 메타)·OCR 로 간다(Codex 1)
        break wait
      case .wait: try? await Task.sleep(for: LinkSettle.pollInterval)
      }
    }
    if Task.isCancelled { return .failed("cancelled") }
    guard let json = (try? await wv.callAsyncJavaScript(LinkScript.extract, contentWorld: .defaultClient)) as? String,
          var page = LinkPage.decode(json: json, host: wv.url?.host() ?? url.host() ?? "") else { return .failed("extract_failed") }
    page.timedOut = timedOut
    if ocr, !LinkText.hasDateCandidate(page.searchable) { page.ocrText = await snapshotText(wv) }
    if Task.isCancelled { return .failed("cancelled") }
    if ocr, page.isEmpty { return .failed("empty") }                 // OCR 까지 했는데 빈 페이지 — 확정 실패(앱)
    return .page(page, elapsedMs: Int(elapsed() * 1000))             // OCR 없음(확장): 빈 페이지도 돌려 no_date 로 앱에 넘긴다
  }

  /// 이미지 전용 페이지(스펙 §6): 최대 3화면을 스냅샷(너비 390pt — 3배율 기기 1,170px)해 기기 OCR. 스냅샷은 메모리에서만 쓴다
  private func snapshotText(_ wv: WKWebView) async -> String? {
    var parts: [String] = []
    for i in 0..<Self.ocrScreens {
      if Task.isCancelled { break }
      if i > 0 {
        let y = Double(i) * Double(Self.viewport.height)
        guard Double(wv.scrollView.contentSize.height) > y else { break }          // 페이지 끝
        _ = try? await wv.callAsyncJavaScript("window.scrollTo(0, y); return window.scrollY;", arguments: ["y": y], contentWorld: .defaultClient)
        try? await Task.sleep(for: .milliseconds(600))                               // 지연 로딩 그림
      }
      let cfg = WKSnapshotConfiguration()
      cfg.snapshotWidth = NSNumber(value: Double(Self.viewport.width))
      guard let img = try? await wv.takeSnapshot(configuration: cfg), let text = try? await OCR.recognize(image: img), !text.isEmpty else { continue }
      parts.append(text)
    }
    let joined = parts.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
    return joined.isEmpty ? nil : joined
  }

  // MARK: WKNavigationDelegate (async 판만, 지금 웹뷰의 것만 반영)

  public func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction) async -> WKNavigationActionPolicy {
    guard webView === current else { return .cancel }
    if navigationAction.shouldPerformDownload { return .cancel }
    guard let u = navigationAction.request.url, let frame = navigationAction.targetFrame else { blockedNavigations += 1; return .cancel }   // 새 창
    let scheme = u.scheme?.lowercased() ?? ""
    if !frame.isMainFrame {
      guard Self.subframeSchemes.contains(scheme) else { blockedNavigations += 1; return .cancel }
      if scheme == "http" || scheme == "https", LinkText.check(u, allowLoopback: allowLoopback) != nil {   // 하위 프레임도 사설 주소 차단(Codex 6)
        blockedNavigations += 1; return .cancel
      }
      return .allow
    }
    if LinkText.check(u, allowLoopback: allowLoopback) != nil { blockedNavigations += 1; return .cancel }   // 앱 스킴·사설 주소 — 읽기는 계속
    navigations += 1
    if navigations > Self.maxNavigations { failure = "redirects"; return .cancel }
    return .allow
  }

  public func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse) async -> WKNavigationResponsePolicy {
    guard webView === current else { return .cancel }
    guard navigationResponse.isForMainFrame else { return .allow }
    if let h = navigationResponse.response as? HTTPURLResponse, h.statusCode >= 400 { failure = "http_\(h.statusCode)"; return .cancel }
    if !navigationResponse.canShowMIMEType { failure = "unsupported"; return .cancel }
    return .allow
  }

  public func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) { if webView === current { finished = false } }
  public func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) { if webView === current { committed = true } }
  public func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { if webView === current { finished = true } }
  public func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { loadError(webView, error) }
  public func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    loadError(webView, error)
    if webView === current { finished = true }
  }
  public func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { if webView === current { failure = "web_process" } }

  /// 페이지가 이미 섰으면(committed) 뒤 이동의 실패로 읽기를 멈추지 않는다
  private func loadError(_ webView: WKWebView, _ error: Error) {
    guard webView === current, let code = Self.loadFailure(error as NSError, upgraded: upgradedScheme) else { return }
    if !committed, failure == nil { failure = code }
  }
}

/// 렌더링 결과 경주(D15): 내부 작업·독립 기한·취소 중 먼저 온 하나만 돌려준다. 늦게 온 결과는 버린다
@MainActor final class RenderRace {
  private var cont: CheckedContinuation<LinkRenderOutcome, Never>?
  private var result: LinkRenderOutcome?

  func finish(_ o: LinkRenderOutcome) {
    guard result == nil else { return }
    result = o
    cont?.resume(returning: o)
    cont = nil
  }

  func wait() async -> LinkRenderOutcome {
    if let r = result { return r }
    return await withCheckedContinuation { cont = $0 }
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

- [ ] **Step 6: 통과 확인**

메모리 확인(`vm_stat | grep -E 'free|compressor'`) 뒤:

Run: `cd ios && ./scripts/sim.sh test EruriCoreTests/LinkRendererTests && ./scripts/sim.sh test EruriCoreTests/OCRImageTests`
Expected: `LinkRendererTests` 22개·`OCRImageTests` 3개 통과(전체 약 2~3분). 건너뜀은 아래 U4·U5 사유일 때만 허용하고 보고에 적는다. 실패하면 원인별로:
- `testDelayedScriptTextIsWaitedFor`·`testNeverSettlingPageReturnsPartial`이 실패(타이머가 안 돎) → U2 실패. 웹뷰를 `host.addSubview(wv)` + `wv.alpha = 0.01`(맨 위, 거의 투명)로 바꿔 다시 돌리고, 결과를 보고에 적는다(스펙 §6 문구도 그 방식으로 L0 커밋에 이어 고친다).
- `testImageOnlyPageUsesOCR`만 실패 → 스냅샷이 비었는지(`takeSnapshot`) Vision이 한국어를 못 읽는지 구분한다: `p.ocrText`가 nil이고 `takeSnapshot` 이미지의 `size`가 0이면 U2, 이미지는 있는데 글자가 없으면 U4. U4면 이 테스트에 `try XCTSkipIf(true, "U4: 시뮬레이터 Vision 한국어 — LNK-device D6에서 판정")`를 넣고 보고한다(테스트를 지우지 않는다).
- 서버 테스트 4개가 모두 `XCTSkip("U5 …")`면 U5 실패 — 보고하고 L8 Step 2의 하네스 예외로 넘긴다(제품 Info.plist는 바꾸지 않는다). `testTooManyRedirectsFail`가 `load_failed`면 WebKit이 다른 오류 코드를 쓰는 것이다 — 그 `NSError` 코드(숫자만)를 보고하고 `loadFailure`에 더한다.
- `testStuckPageTimesOut`가 기한을 넘기면 경주가 동작하지 않는 것이다(`race.wait()`가 기한에 깨어나는지) — 고치기 전에 메인에게 알린다(Review Focus 2).
- `testRuleListCompiles` 실패 → 컴파일 오류 문자열(규칙 JSON의 어느 항목인지)을 보고하고 그 규칙만 고친다(규칙을 빼지 않는다).
- 컴파일 오류 `OCR.Image`가 Sendable 아님 → 이미 `@unchecked Sendable`이다. `UIImage` 관련이면 `recognize(image:)` 안에서 `cgImage`만 꺼내 넘기는지 확인. `NWConnection`·`NWListener` Sendable 오류면 `LoopServer.Conn` 상자처럼 감싼다.

- [ ] **Step 7: 회귀**

Run: `cd ios && ./scripts/sim.sh test EruriCoreTests && ./scripts/sim.sh build`
Expected: 전체 통과, 앱·확장 빌드 성공(EruriCore가 WebKit·Vision·ImageIO를 링크한다).

- [ ] **Step 8: 커밋**

```bash
git add ios/Packages/EruriCore/Sources/EruriCore/LinkRenderer.swift ios/Packages/EruriCore/Sources/EruriCore/OCR.swift \
  ios/Packages/EruriCore/Sources/EruriCore/ShareImages.swift \
  ios/Packages/EruriCore/Tests/EruriCoreTests/LinkRendererTests.swift ios/Packages/EruriCore/Tests/EruriCoreTests/OCRImageTests.swift
git commit -m "feat(core): LinkRenderer, photo OCR and ShareImages (spec §6) — hidden WKWebView at the bottom of a view inside the window (non-persistent store, no autoplay, JS on), races the inner work against an independent deadline (budget + 2 s, + 8 s with OCR) and cancellation so a stuck page still returns, app-scheme/new-window/private-address navigations blocked for main and sub frames, content rule list blocks private IP literal, localhost and .local subresources, http upgraded to https with insecure on TLS/connection failure, redirect overflow and request timeout mapped, delegate state only for the current web view, empty pages go on to OCR (app) or come back as an empty page (extension), 390 pt snapshots; OCR.recognize(data:maxPixel:) decodes an ImageIO thumbnail with EXIF orientation; ShareImages reads up to three image attachments one at a time from memory; simulator tests on synthetic HTML and a loopback server (404, redirect loop, no response, private subresources)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task L4: 공유 확장 — 링크·이미지 경로·상태 화면

**Files:**
- Create: `ios/ShareExtension/LinkStatusView.swift`
- Modify: `ios/ShareExtension/ShareViewController.swift`(전체 교체 — 텍스트 경로는 그대로)
- Modify: `ios/ShareExtension/Info.plist`(활성화 규칙에 `public.image` — LI4)

**Interfaces:**
- Consumes: L1 `LinkText.shareLink`·`noteMaxChars`, L2 `LinkFlow.share`·`PendingLink`·`LinkFlow.traceFields`·`LinkFlow.code`·`ImageFlow.finish`·`ImageFlow.traceFields`·`ImageFlow.code`·`LinkCaptureText.*`·`CaptureQueue.releaseLink`, L3 `LinkRenderer`·`ShareImages`.
- Produces: 확장이 남긴 **링크 대기 행**(L5의 앱 이어받기가 소비), SHARE 큐 항목(`app_name = "웹 링크"` | `"이미지"`), 확정 실패 시 텍스트 항목(지금과 같음). 접근성 id `share-link-status`·`share-link-note`·`share-link-close`(L8 G8·G10, L9 실기기 확인용).

확장은 앱을 열 수 없다(F12) → 앱에 넘길 때는 시트 문구로 "앱을 열면 다시 읽어요"를 알린다. **[닫기]는 결과를 기다리지 않는다**(Codex 2): 읽는 중이면 작업을 취소하고 대기 행을 앱에 넘긴 뒤 바로 닫는다(사진이면 아무것도 저장하지 않는다).

- [ ] **Step 1: 활성화 규칙**

`ios/ShareExtension/Info.plist`의

```text
        ANY $attachment.registeredTypeIdentifiers UTI-CONFORMS-TO "public.url"
        OR ANY $attachment.registeredTypeIdentifiers UTI-CONFORMS-TO "public.plain-text"
```

을 이것으로 바꾼다(모든 첨부가 셋 중 하나일 때 — PDF·동영상 공유에는 ERURI가 뜨지 않는다):

```text
        ANY $attachment.registeredTypeIdentifiers UTI-CONFORMS-TO "public.url"
        OR ANY $attachment.registeredTypeIdentifiers UTI-CONFORMS-TO "public.plain-text"
        OR ANY $attachment.registeredTypeIdentifiers UTI-CONFORMS-TO "public.image"
```

- [ ] **Step 2: 상태 화면**

`ios/ShareExtension/LinkStatusView.swift`:

```swift
import UIKit

/// 공유 시트 안 링크·사진 읽기 상태(스펙 §6, 계획 D8). 전체를 덮는 불투명 화면 — 웹뷰는 이 밑(루트 뷰의 맨 아래)에 붙어 보이지 않는다
final class LinkStatusView: UIView {
  private let label = UILabel()
  private let noteLabel = UILabel()
  private let spinner = UIActivityIndicatorView(style: .medium)
  private let close = UIButton(type: .system)
  private var closed = false
  private var waiter: CheckedContinuation<Void, Never>?
  private var closeWaiter: (() -> Void)?
  /// [닫기]: 작업 취소(대기 행은 호출 쪽이 앱에 넘긴다). 결과를 기다리지 않는다
  var onClose: (() -> Void)?

  override init(frame: CGRect) {
    super.init(frame: frame)
    backgroundColor = .systemBackground
    for l in [label, noteLabel] {
      l.numberOfLines = 0
      l.textAlignment = .center
      l.adjustsFontForContentSizeCategory = true
    }
    label.font = .preferredFont(forTextStyle: .body)
    label.accessibilityIdentifier = "share-link-status"
    noteLabel.font = .preferredFont(forTextStyle: .caption1)
    noteLabel.textColor = .secondaryLabel
    noteLabel.isHidden = true
    noteLabel.accessibilityIdentifier = "share-link-note"
    close.setTitle("닫기", for: .normal)
    close.accessibilityIdentifier = "share-link-close"
    close.addAction(UIAction { [weak self] _ in self?.tapClose() }, for: .touchUpInside)
    let stack = UIStackView(arrangedSubviews: [spinner, label, noteLabel, close])
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

  /// note = 저장 범위 한 줄(메인 판정 MR1) — 큐에 넣었을 때만
  func show(_ text: String, note: String? = nil, done: Bool = false) {
    label.text = text
    noteLabel.text = note
    noteLabel.isHidden = note == nil
    if done { spinner.stopAnimating() } else { spinner.startAnimating() }
  }

  /// 작업 결과와 [닫기] 중 먼저 온 쪽. 닫기면 nil — 작업 결과를 기다리지 않는다(Codex 2)
  func race<T: Sendable>(_ work: Task<T, Never>) async -> T? {
    if closed { return nil }
    let box = RaceBox<T>()
    return await withCheckedContinuation { (c: CheckedContinuation<T?, Never>) in
      box.cont = c
      closeWaiter = { box.finish(nil) }
      Task { @MainActor in box.finish(await work.value) }
    }
  }

  /// 결과를 보인 뒤: [닫기]를 누르거나 seconds 가 지나면 돌아온다(이미 닫기를 눌렀으면 바로)
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

  private func tapClose() {
    closed = true
    onClose?()
    closeWaiter?(); closeWaiter = nil
    finish()
  }
  private func finish() { waiter?.resume(); waiter = nil }
}

/// race 의 결과 상자: 먼저 온 값 하나만 넘긴다
@MainActor private final class RaceBox<T: Sendable> {
  var cont: CheckedContinuation<T?, Never>?
  func finish(_ v: T?) { cont?.resume(returning: v); cont = nil }
}
```

- [ ] **Step 3: `ShareViewController` 교체**

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
  /// 1단계는 텍스트·URL·이미지(기기 OCR 글만, 0.11.0)를 받는다(스펙 §15 1a). 이미지 파일·PDF 업로드는 서버 파일 경로가 생기는 2단계.
  /// 공유 한 번의 모든 텍스트 표현(attributedContentText·첨부 plain-text·URL)을 모아 `ShareText.compose` 로 큐 항목 하나로 만든다.
  /// 첨부 하나만 읽으면 호스트가 넘긴 제목·일부만 들어온다(실기기 0.3.0 메모 앱 10자, 2026-09-30). 표현마다 64KiB, 본문 64K자 상한.
  /// 웹 주소 하나 + 짧은 메모면 링크 읽기, 아니고 이미지가 있으면 사진 읽기(스펙 §6 "링크·이미지 읽기", 0.11.0) — 시트 안 상태 화면을 띄우고 끝나면 닫는다
  private func handle() async {
    guard let items = extensionContext?.inputItems as? [NSExtensionItem] else { return }
    let started = Date()
    let collected = await ShareText.collect(items)
    let out = ShareText.compose(collected.pieces)
    if let out, let link = LinkText.shareLink(out.text) { await readLink(link.url, note: link.note, original: out, collected, started); return }
    if ShareImages.count(items) > 0 { await readImages(items, text: out, collected, started); return }
    guard let out else { Self.trace("-", "empty", started, collected.fields(truncatedOutput: false)); return }
    handleText(out, collected, started)
  }

  /// 텍스트 공유(0.10.0 과 같다). 반환: 큐 결과("queued" · "discarded:<r>" · "error:<type>") — 링크 폴백이 문구를 고른다
  @discardableResult
  private func handleText(_ out: ShareText.Composed, _ collected: ShareText.Collected, _ started: Date) -> String {
    let text = out.text, diag = collected.fields(truncatedOutput: out.truncated)
    let kind = ShareText.isWebURL(text) ? "url" : "text"
    do {
      let pipeline = CapturePipeline(filter: RuleFilter(), queue: try CaptureQueue.shared())
      let result = try pipeline.handleShare(text: text)
      DiagLog.append("ShareExtension \(kind) \(result)")
      Self.trace(kind, result, started, diag.merging(["text_len": text.count, "text_sha8": Trace.sha8(text)]) { a, _ in a })
      return result
    } catch {
      DiagLog.append("ShareExtension error \(type(of: error))")
      Self.trace(kind, "error:\(type(of: error))", started, diag)
      return "error:\(type(of: error))"
    }
  }

  // 진단 필드(share.received): 확장이 받은 형식·결과·본문 길이. 확장에서는 UIApplication 을 쓸 수 없어 locked·bg 는 넣지 않는다
  // parts 는 조각별 "출처:길이[:truncated]", utis_aN 은 N번째 첨부가 등록한 형식(ShareText.Collected). 본문은 넣지 않는다
  private static func trace(_ type: String, _ result: String, _ started: Date, _ extra: [String: Any] = [:]) {
    Trace.log("share.received", ["source": "SHARE", "type": type, "result": result,
                                 "elapsed_ms": Int(Date().timeIntervalSince(started) * 1000)].merging(extra) { a, _ in a })
  }

  private static func ms(since d: Date) -> Int { Int(Date().timeIntervalSince(d) * 1000) }

  private func showStatus(_ text: String) -> LinkStatusView {
    let status = LinkStatusView(frame: view.bounds)
    status.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    view.addSubview(status)
    status.show(text)
    return status
  }

  /// 링크 읽기(스펙 §6·D8): 상태 화면 → LinkFlow.share(관문 → 대기 행 → 10초, OCR 없음) → 결과 문구(+ 저장 범위 한 줄) → 1.5초 뒤 또는 [닫기].
  /// 읽는 중 [닫기]는 결과를 기다리지 않고 취소 → 대기 행을 앱에 넘김 → 바로 닫는다. 확정 실패면 원래 공유 글을 텍스트 항목으로(D8).
  /// 로그·trace 에 주소·제목 없음
  private func readLink(_ url: URL, note: String?, original: ShareText.Composed, _ collected: ShareText.Collected, _ started: Date) async {
    let status = showStatus(LinkCaptureText.reading)
    for _ in 0..<40 where view.window == nil { try? await Task.sleep(for: .milliseconds(50)) }   // viewDidLoad 때는 창이 없다 — 최대 2초(없으면 no_host → 앱)
    let begun = Date(), link = PendingLink(url: url, note: note, origin: "share")
    let renderer = LinkRenderer(host: view, allowLoopback: Self.allowLoopback)
    let work = Task { @MainActor () -> LinkFlow.Outcome in
      guard let q = try? CaptureQueue.shared() else { return .failed("queue") }
      return await LinkFlow.share(link, renderer: renderer, queue: q)
    }
    status.onClose = { work.cancel() }
    guard let o = await status.race(work) else {
      try? CaptureQueue.shared().releaseLink(id: link.id)                        // 행이 없으면(중복·폐기·이미 끝남) 아무 일도 없다
      Trace.log("share.link", LinkFlow.traceFields(.handedOff("cancelled"), origin: "share", elapsedMs: Self.ms(since: begun),
                                                   blockedNav: renderer.blockedNavigations))
      DiagLog.append("ShareExtension link handed_off:cancelled")
      return
    }
    Trace.log("share.link", LinkFlow.traceFields(o, origin: "share", elapsedMs: Self.ms(since: begun), blockedNav: renderer.blockedNavigations))
    DiagLog.append("ShareExtension link \(LinkFlow.code(o))")
    var text = LinkCaptureText.share(o), saved = false
    if case .queued = o { saved = true }
    if case .failed(let code) = o, handleText(original, collected, started) == "queued" { text = LinkCaptureText.shareFallback(code) }
    status.show(text, note: saved ? LinkCaptureText.storageNote : nil, done: true)
    await status.waitClose(seconds: 1.5)
  }

  /// 사진 읽기(스펙 §6 "사진 OCR", D13): 상태 화면 → 앞의 3장을 한 장씩 메모리로 OCR(파일 저장 없음) → ImageFlow → 결과 문구.
  /// 함께 온 글은 메모(200자) — 더 길면 그 글은 따로 텍스트 항목으로 넣는다(잘리지 않게). 읽는 중 [닫기]면 아무것도 저장하지 않고 바로 닫는다
  private func readImages(_ items: [NSExtensionItem], text: ShareText.Composed?, _ collected: ShareText.Collected, _ started: Date) async {
    let status = showStatus(LinkCaptureText.imageReading)
    let note: String?
    if let t = text, t.text.count > LinkText.noteMaxChars { handleText(t, collected, started); note = nil } else { note = text?.text }
    let begun = Date()
    let work = Task { @MainActor () -> (outcome: ImageFlow.Outcome, images: Int) in
      let r = await ShareImages.ocr(items)
      if Task.isCancelled { return (.failed("cancelled"), r.images) }
      guard let q = try? CaptureQueue.shared() else { return (.failed("queue"), r.images) }
      return (ImageFlow.finish(ocr: r.texts, images: r.images, note: note, queue: q), r.images)
    }
    status.onClose = { work.cancel() }
    guard let r = await status.race(work) else {
      Trace.log("share.image", ImageFlow.traceFields(.failed("cancelled"), origin: "share", elapsedMs: Self.ms(since: begun), images: 0))
      DiagLog.append("ShareExtension image failed:cancelled")
      return
    }
    Trace.log("share.image", ImageFlow.traceFields(r.outcome, origin: "share", elapsedMs: Self.ms(since: begun), images: r.images))
    DiagLog.append("ShareExtension image \(ImageFlow.code(r.outcome))")
    var saved = false
    if case .queued = r.outcome { saved = true }
    status.show(LinkCaptureText.image(r.outcome, chat: false), note: saved ? LinkCaptureText.storageNote : nil, done: true)
    await status.waitClose(seconds: 1.5)
  }
}
```

- [ ] **Step 4: 빌드**

Run: `cd ios && ./scripts/sim.sh gen && ./scripts/sim.sh build`
Expected: `** BUILD SUCCEEDED **`. `ShareText.Composed`·`ShareText.Collected`가 public인지 확인(이미 public — `ShareText.swift`). 텍스트 경로 회귀를 위해 `git diff ios/ShareExtension/ShareViewController.swift`에서 텍스트 경로의 문자열(`"ShareExtension \(kind) \(result)"`, `share.received` 필드)이 그대로인지 본다. `plutil -lint ios/ShareExtension/Info.plist`가 OK.

- [ ] **Step 5: 회귀**

Run: `cd ios && ./scripts/sim.sh test EruriCoreTests/ShareTextTests && ./scripts/sim.sh test EruriCoreTests/LinkFlowTests`
Expected: 통과(확장 자체의 실동작 — U1 — 은 L8 G8·G10, 확장 메모리 — U3·U10 — 는 L9 D1·D6에서 판정).

- [ ] **Step 6: 커밋**

```bash
git add ios/ShareExtension/ShareViewController.swift ios/ShareExtension/LinkStatusView.swift ios/ShareExtension/Info.plist
git commit -m "feat(share): link and photo reading in the share extension (spec §6) — one http(s) URL with a short note shows an opaque status view, admits (duplicate/OTP note stop before any row), leaves the pending link row, renders 10 s without OCR under the status view, queues one SHARE item or hands the row to the app; final failures fall back to the original text share; 닫기 never waits for the result (cancel, release the row, close); image attachments (activation rule public.image, max 3) are OCR'd one at a time from memory into one SHARE item (app_name 이미지), no file; result copy with the storage note for 1.5 s or until 닫기; trace share.link / share.image with codes only; text sharing unchanged

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task L5: 앱 — 이어받기 + 채팅 링크·사진 + "공유한 링크"·"공유한 이미지" 출처

**Files:**
- Create: `ios/App/LinkCapture.swift`
- Modify: `ios/App/ChatView.swift`(`import PhotosUI`·`Turn`·행 분기·`send()` 앞부분·"+" 메뉴·`sendLink`·`sendImages`·`linkRow`)
- Modify: `ios/App/EruriApp.swift`(`.active`에서 이어받기, 그 밖에서 취소)
- Modify: `ios/Packages/EruriCore/Sources/EruriCore/ScheduleCard.swift`(`origin`의 SHARE 줄)
- Modify: `ios/Packages/EruriCore/Sources/EruriCore/SourceLabel.swift`(SHARE 줄)
- Test: `ios/Packages/EruriCore/Tests/EruriCoreTests/ScheduleCardTests.swift`, `ios/Packages/EruriCore/Tests/EruriCoreTests/SourceLabelTests.swift`

**Interfaces:**
- Consumes: L1 `LinkText.chatIntent`·`appName`, `ImageText.appName`·`maxImages`, L2 `PendingLink`·`LinkFlow.admit`·`LinkFlow.app`·`traceFields`·`code`·`ImageFlow.*`·`LinkCaptureText.*`·`CaptureQueue.claimLinks`·`nextLinkAttempt`·`releaseLink`, L3 `LinkRenderer`·`OCR.recognize(data:)`. 앱 기존 `API.send`·`Uploader.shared.flush(trigger:)`·`ExecutionReporter.notice(title:body:)`.
- Produces: `@MainActor final class LinkCapture { static shared; startDrain(); suspend(); drainPending() async; chatRead(url:note:) async -> ChatRead; chatImages(_:note:) async -> ChatRead; chatResult(captureID:subject:) async -> String }`, 채팅 링크·사진 턴(접근성 id `chat-link-status`·`chat-link-note` — L8 게이트가 읽는다), "+" 메뉴 항목 "사진에서 일정 읽기".

- [ ] **Step 1: 실패하는 테스트(출처)**

`ScheduleCardTests.swift`의 `testSourceAndReceivedLines` 바로 뒤에 넣는다:

```swift
  /// 링크·사진 항목(0.11.0, app_name "웹 링크"·"이미지", 스펙 §9 ①)은 "공유한 링크"·"공유한 이미지", 그 밖의 공유는 그대로
  func testLinkAndImageSourceLines() {
    XCTAssertEqual(ScheduleCard.sourceLine(cite("SHARE", app: "웹 링크")), "공유한 링크에서 찾은 일정")
    XCTAssertEqual(ScheduleCard.receivedLine(cite("SHARE", app: "웹 링크")), "10/1 공유한 링크")
    XCTAssertEqual(ScheduleCard.sourceLine(cite("SHARE", app: "이미지")), "공유한 이미지에서 찾은 일정")
    XCTAssertEqual(ScheduleCard.receivedLine(cite("SHARE", app: "이미지")), "10/1 공유한 이미지")
    XCTAssertEqual(ScheduleCard.sourceLine(cite("SHARE")), "공유한 내용에서 찾은 일정")
  }
```

`SourceLabelTests.swift`의 클래스 안 마지막 테스트 뒤에 넣는다:

```swift
  /// 보관함 출처(0.11.0, Fable F12): 링크·사진 항목은 "공유한 링크"·"공유한 이미지", 그 밖의 공유는 "공유"
  func testShareLinkAndImageLabels() {
    XCTAssertEqual(SourceLabel.label(source: "SHARE", appName: "웹 링크"), "공유한 링크")
    XCTAssertEqual(SourceLabel.label(source: "SHARE", appName: "이미지"), "공유한 이미지")
    XCTAssertEqual(SourceLabel.label(source: "SHARE", appName: nil), "공유")
  }
```

Run: `cd ios && ./scripts/sim.sh test EruriCoreTests/ScheduleCardTests/testLinkAndImageSourceLines && ./scripts/sim.sh test EruriCoreTests/SourceLabelTests`
Expected: FAIL(`"공유한 내용에서 찾은 일정"`, `"공유"`).

- [ ] **Step 2: `ScheduleCard.origin`·`SourceLabel`**

`ScheduleCard.swift`의 `case "SHARE": return ("공유한 내용", "공유함")` →

```swift
    case "SHARE":                                                         // 링크·사진 읽기(스펙 §6, 0.11.0)
      if c.app_name == LinkText.appName { return ("공유한 링크", "공유한 링크") }
      if c.app_name == ImageText.appName { return ("공유한 이미지", "공유한 이미지") }
      return ("공유한 내용", "공유함")
```

`SourceLabel.swift`의 `case "SHARE": return "공유"` →

```swift
    case "SHARE": return appName == LinkText.appName ? "공유한 링크" : appName == ImageText.appName ? "공유한 이미지" : "공유"   // 0.11.0
```

Run: `cd ios && ./scripts/sim.sh test EruriCoreTests/ScheduleCardTests && ./scripts/sim.sh test EruriCoreTests/SourceLabelTests && ./scripts/sim.sh test EruriCoreTests/ArchiveTests`
Expected: 통과(보관함 필터는 source로 거르므로 "공유" 범위는 그대로).

- [ ] **Step 3: `LinkCapture`**

`ios/App/LinkCapture.swift`:

```swift
import UIKit
import SwiftUI
import PhotosUI
import EruriCore

/// 앱의 링크·사진 읽기(스펙 §6 "확장과 앱의 이어받기"·§9 "채팅 링크 붙여넣기"·"채팅 사진 첨부"). 렌더 호스트는 키 창(다른 화면 밑).
/// 백그라운드에서는 WebKit 이 멈추므로(F13) foreground 에서만 읽고, 활성 상태를 벗어나면 읽던 것을 취소해 행을 돌려놓는다(Fable C4).
/// 로그·trace 에 주소·제목·OCR 글 없음
@MainActor final class LinkCapture {
  static let shared = LinkCapture()
  #if DEBUG
  static let allowLoopback = true            // 시뮬레이터 게이트(스펙 §6 "주소 검사")
  #else
  static let allowLoopback = false
  #endif
  private var drainTask: Task<Void, Never>?
  private var running: [UUID: Task<LinkFlow.Outcome, Never>] = [:]

  struct ChatRead: Sendable { let text: String; let captureID: String? }

  /// 지금 화면에 붙은 키 창(웹뷰를 그 맨 아래에 붙인다)
  private func hostWindow() -> UIWindow? {
    UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
      .first { $0.activationState == .foregroundActive }?.keyWindow
  }

  private static func ms(since d: Date) -> Int { Int(Date().timeIntervalSince(d) * 1000) }

  /// foreground(EruriApp .active): 이어받기를 띄운다(이미 돌고 있으면 그대로)
  func startDrain() {
    guard drainTask == nil else { return }
    drainTask = Task { await self.drainPending(); self.drainTask = nil }
  }

  /// 활성 상태를 벗어남(EruriApp): 이어받기·채팅 읽기를 취소한다 — LinkFlow.app 이 cancelled 로 행을 돌려놓는다(시도로 세지 않는다)
  func suspend() {
    drainTask?.cancel()
    for t in running.values { t.cancel() }
  }

  /// 확장이 넘긴(또는 확장이 죽어 lease 가 끝난) 대기 행을 5건씩 읽는다. 다 비면 끝, 2분 안에 시도할 행(확장 lease·재시도 백오프)이 남았으면
  /// 활성 상태에서 그때 다시 본다(Codex 4). 지운 행(확정 실패·3회 실패)만 로컬 알림 1건(주소·제목 없음, foreground 배너 — F25)
  func drainPending() async {
    var host = hostWindow()
    for _ in 0..<5 where host == nil {                                      // 콜드 스타트 .active 때 키 창이 아직 없을 수 있다
      try? await Task.sleep(for: .milliseconds(500))
      host = hostWindow()
    }
    guard let host, let q = try? CaptureQueue.shared() else { return }
    var queued = false
    while !Task.isCancelled {
      let links = (try? q.claimLinks(limit: 5)) ?? []
      if links.isEmpty {
        guard let next = try? q.nextLinkAttempt(), next.timeIntervalSinceNow < 120 else { break }
        try? await Task.sleep(for: .seconds(max(1, next.timeIntervalSinceNow)))
        continue
      }
      for link in links {
        if Task.isCancelled { try? q.releaseLink(id: link.id); continue }   // 잡아 둔 나머지는 돌려놓는다
        let o = await read(link, origin: "drain", host: host, queue: q)
        if case .queued = o { queued = true }
        if case .failed(let code) = o, code != "queue" {
          await ExecutionReporter.notice(title: LinkCaptureText.drainFailedTitle, body: LinkCaptureText.drainFailedBody(code))
        }
      }
    }
    if queued { await Uploader.shared.flush(trigger: .foreground) }
  }

  /// 읽기 하나를 취소 가능한 작업으로 돌린다(suspend 가 취소). trace `share.link`·DiagLog `link <origin> <code>` 는 코드만
  private func read(_ link: PendingLink, origin: String, host: UIWindow, queue: CaptureQueue) async -> LinkFlow.Outcome {
    let key = UUID(), started = Date(), r = LinkRenderer(host: host, allowLoopback: Self.allowLoopback)
    let t = Task { @MainActor in await LinkFlow.app(link, renderer: r, queue: queue) }
    running[key] = t
    let o = await t.value
    running[key] = nil
    Trace.log("share.link", LinkFlow.traceFields(o, origin: origin, elapsedMs: Self.ms(since: started), blockedNav: r.blockedNavigations))
    DiagLog.append("link \(origin) \(LinkFlow.code(o))")
    return o
  }

  /// 채팅 붙여넣기 1단계(스펙 §9): 관문(읽은 링크면 중복, 메모 OTP면 폐기 — 행 없음) → 대기 행(앱이 죽어도 다음 foreground 가 이어받게, lease 600초)
  /// → 읽기(15초 + OCR) → 큐 → 업로드. 다시 해 볼 실패면 이어받기가 백오프 뒤 다시 읽는다
  func chatRead(url: URL, note: String?) async -> ChatRead {
    guard let host = hostWindow(), let q = try? CaptureQueue.shared() else { return ChatRead(text: LinkCaptureText.chat(.failed("no_host")), captureID: nil) }
    let link: PendingLink
    switch LinkFlow.admit(PendingLink(url: url, note: note, origin: "chat"), queue: q, lease: CaptureQueue.lease) {
    case .stop(let o):
      Trace.log("share.link", LinkFlow.traceFields(o, origin: "chat", elapsedMs: 0))
      DiagLog.append("link chat \(LinkFlow.code(o))")
      return ChatRead(text: LinkCaptureText.chat(o), captureID: nil)
    case .go(let admitted): link = admitted
    }
    let o = await read(link, origin: "chat", host: host, queue: q)
    if case .retry(let code) = o, code != "cancelled" { startDrain() }       // cancelled 는 다음 .active 가 이어받는다
    guard case .queued(let id, _, _, _) = o else { return ChatRead(text: LinkCaptureText.chat(o), captureID: nil) }
    await Uploader.shared.flush(trigger: .foreground)        // 직접 요청 우선(8초), 응답이 없으면 background 세션(스펙 §6 업로더)
    return ChatRead(text: LinkCaptureText.chat(o), captureID: id)
  }

  /// 채팅 사진(스펙 §9 "채팅 사진 첨부", LI5): 앞의 3장을 한 장씩 메모리로 받아 OCR(파일 저장 없음) → ImageFlow → 업로드
  func chatImages(_ items: [PhotosPickerItem], note: String?) async -> ChatRead {
    let started = Date()
    var texts: [String] = []
    for item in items.prefix(ImageText.maxImages) {
      guard let d = try? await item.loadTransferable(type: Data.self) else { texts.append(""); continue }
      texts.append((try? await OCR.recognize(data: d)) ?? "")                // d 는 이 반복이 끝나면 놓인다
    }
    let o: ImageFlow.Outcome
    if let q = try? CaptureQueue.shared() { o = ImageFlow.finish(ocr: texts, images: texts.count, note: note, queue: q) } else { o = .failed("queue") }
    Trace.log("share.image", ImageFlow.traceFields(o, origin: "chat", elapsedMs: Self.ms(since: started), images: texts.count))
    DiagLog.append("image chat \(ImageFlow.code(o))")
    guard case .queued(let id, _, _) = o else { return ChatRead(text: LinkCaptureText.image(o, chat: true), captureID: nil) }
    await Uploader.shared.flush(trigger: .foreground)
    return ChatRead(text: LinkCaptureText.image(o, chat: true), captureID: id)
  }

  /// 2단계: 서버 처리 결과를 3초마다 최대 60초 확인(본인 items.status·gate_label·facts 종류만 — RLS, F19)
  func chatResult(captureID: String, subject: LinkCaptureText.Subject) async -> String {
    let key = "SHARE:\(captureID)".addingPercentEncoding(withAllowedCharacters: .alphanumerics.union(CharacterSet(charactersIn: "-"))) ?? captureID
    for _ in 0..<20 {
      try? await Task.sleep(for: .seconds(3))
      if let text = await result(key: key, subject: subject) { return text }
    }
    return LinkCaptureText.pending
  }

  private func result(key: String, subject: LinkCaptureText.Subject) async -> String? {
    guard let r = await API.send("rest/v1/items?select=id,status,gate_label&idempotency_key=eq.\(key)"), r.status == 200,
          let rows = (try? JSONSerialization.jsonObject(with: r.data)) as? [[String: Any]], let row = rows.first,
          let itemID = row["id"] as? String, let status = row["status"] as? String else { return nil }
    var kinds: [String] = []
    if status == "extracted", let f = await API.send("rest/v1/facts?select=kind&status=eq.active&item_id=eq.\(itemID)"), f.status == 200,
       let fr = (try? JSONSerialization.jsonObject(with: f.data)) as? [[String: Any]] {
      kinds = fr.compactMap { $0["kind"] as? String }
    }
    return LinkCaptureText.chatResult(status: status, gateLabel: row["gate_label"] as? String, kinds: kinds, subject: subject)
  }
}
```

- [ ] **Step 4: 채팅 링크·사진 턴**

`ChatView.swift`:

(a) 파일 머리 `import EruriCore` 줄 뒤에 `import PhotosUI`를 더한다.

(b) `struct Turn`의 `var cardsMore = 0` 줄 뒤에 더한다:

```swift
    var link: String?                             // 링크·사진 턴(§9, 0.11.0): 상태 문구. nil = 질문 턴
    var linkDone = false
    var linkSaved = false                         // 큐에 넣었다 — 저장 범위 한 줄(메인 판정 MR1)을 보인다
```

(c) `@State private var busy = false` 줄 뒤에 더한다:

```swift
  @State private var showPhotos = false                // "+" → 사진에서 일정 읽기(§9 채팅 사진 첨부, 0.11.0)
  @State private var photoItems: [PhotosPickerItem] = []
```

(d) `ForEach(turns)` 안의 행 분기

```swift
              if let a = t.answer { answerRows(t, a) }
              else if t.error == nil { ProgressView() }
```

를 이것으로 바꾼다:

```swift
              if let l = t.link { linkRow(l, done: t.linkDone, saved: t.linkSaved) }
              else if let a = t.answer { answerRows(t, a) }
              else if t.error == nil { ProgressView() }
```

(e) "+" 메뉴

```swift
        Menu {
          Button("이미지·파일 첨부 (2단계 예정)") {}.disabled(true)   // 첨부는 스펙 §15 2단계
        } label: { roundIcon("plus", fill: Color(.secondarySystemFill), tint: Color.primary) }
        .buttonStyle(.plain)
```

를 이것으로 바꾼다:

```swift
        Menu {
          Button { showPhotos = true } label: { Label("사진에서 일정 읽기", systemImage: "photo") }   // 기기 OCR 글만(§9, 0.11.0)
          Button("파일 첨부 (2단계 예정)") {}.disabled(true)                                          // 파일 업로드는 스펙 §15 2단계
        } label: { roundIcon("plus", fill: Color(.secondarySystemFill), tint: Color.primary) }
        .buttonStyle(.plain)
        .disabled(busy)
        .accessibilityLabel("첨부")
        .photosPicker(isPresented: $showPhotos, selection: $photoItems, maxSelectionCount: ImageText.maxImages, matching: .images)
        .onChange(of: photoItems) { _, items in
          guard !items.isEmpty else { return }
          sendImages(items)
          photoItems = []
        }
```

(f) `send(keepFocus:)`의 `dictation.stopIfRecording()` 줄 바로 뒤(500자 검사 앞)에 넣는다:

```swift
    // 링크 붙여넣기(§9, 0.11.0): http(s) 주소 하나 + 짧은 메모면 질문이 아니라 링크 수집 — /chat 을 부르지 않는다. 둘 이상이면 안내(입력은 남긴다).
    // 긴 글·날짜 있는 글 + 주소는 지금처럼 질문(LinkText.linkCandidate)
    switch LinkText.chatIntent(q) {
    case .link(let url, let note): sendLink(q, url: url, note: note, keepFocus: keepFocus); return
    case .tooMany: turns.append(Turn(question: q, error: LinkCaptureText.tooMany)); return
    case .none: break
    }
```

(g) `send(keepFocus:)` 함수 바로 뒤(같은 `struct ChatView` 안)에 넣는다:

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
      turns[idx].linkSaved = true
      turns[idx].link = await LinkCapture.shared.chatResult(captureID: id, subject: .page)
      turns[idx].linkDone = true
    }
  }

  /// 사진 턴(§9 채팅 사진 첨부): 입력창 글은 메모. OCR·업로드 동안 보내기를 막고, 서버 결과(최대 60초)는 따로 기다린다
  private func sendImages(_ items: [PhotosPickerItem]) {
    let note = input.trimmingCharacters(in: .whitespacesAndNewlines)
    input = ""
    inputFocused = false
    let n = min(items.count, ImageText.maxImages)
    var t = Turn(question: note.isEmpty ? "사진 \(n)장" : "사진 \(n)장 · \(note)")
    t.link = LinkCaptureText.imageReading
    turns.append(t)
    let idx = turns.count - 1
    scroll(to: turns[idx].id)
    busy = true
    Task {
      let read = await LinkCapture.shared.chatImages(Array(items.prefix(n)), note: note.isEmpty ? nil : note)
      turns[idx].link = read.text
      busy = false
      guard let id = read.captureID else { turns[idx].linkDone = true; return }
      turns[idx].linkSaved = true
      turns[idx].link = await LinkCapture.shared.chatResult(captureID: id, subject: .image)
      turns[idx].linkDone = true
    }
  }

  /// 링크·사진 턴(§9): 상태 문구 + (큐에 넣었으면) 저장 범위 한 줄 — 일정 카드·보관함 버튼·맞아요 막대 없음(제안은 "제안" 탭·알림)
  private func linkRow(_ text: String, done: Bool, saved: Bool) -> some View {
    VStack(alignment: .leading, spacing: 4) {
      HStack(alignment: .firstTextBaseline, spacing: 8) {
        if !done { ProgressView() }
        Text(text).accessibilityIdentifier("chat-link-status")
      }
      if saved {
        Text(LinkCaptureText.storageNote).font(.caption2).foregroundStyle(.secondary).accessibilityIdentifier("chat-link-note")
      }
    }
  }
```

- [ ] **Step 5: foreground 이어받기·비활성 전환 취소**

`EruriApp.swift`의

```swift
    .onChange(of: scenePhase) { _, newPhase in
      if newPhase == .active {
        AppState.prepareProbe(); ContactsLoader.refresh(); Uploader.shared.flush(); NotificationActions.register()
        Task { await DeviceRegistrar.shared.register(); await ExecutionReporter.shared.flush() }
      }
      if newPhase == .background { BackgroundRefresh.schedule() }
    }
```

를 이것으로 바꾼다:

```swift
    .onChange(of: scenePhase) { _, newPhase in
      if newPhase == .active {
        AppState.prepareProbe(); ContactsLoader.refresh(); Uploader.shared.flush(); NotificationActions.register()
        Task { await DeviceRegistrar.shared.register(); await ExecutionReporter.shared.flush() }
        LinkCapture.shared.startDrain()          // 공유 확장이 넘긴 링크(스펙 §6 이어받기) — foreground 에서만 WebKit 이 돈다
      } else {
        LinkCapture.shared.suspend()             // 비활성: 읽던 링크를 취소하고 행을 돌려놓는다(시도로 세지 않음)
      }
      if newPhase == .background { BackgroundRefresh.schedule() }
    }
```

- [ ] **Step 6: 빌드·회귀**

Run: `cd ios && ./scripts/sim.sh gen && ./scripts/sim.sh build && ./scripts/sim.sh test EruriCoreTests`
Expected: 빌드 성공, 전체 테스트 통과. 채팅·사진·이어받기의 실동작은 L8 게이트(G1~G12)가 판정한다. `PhotosPickerItem`이 Sendable이 아니라는 오류면 `chatImages` 인자를 `[PhotosPickerItem]` 대신 사진마다 `Data`를 받는 형태로 바꾸지 말고(메모리에 3장을 같이 들게 된다) 보고한다.

- [ ] **Step 7: 커밋**

```bash
git add ios/App/LinkCapture.swift ios/App/ChatView.swift ios/App/EruriApp.swift \
  ios/Packages/EruriCore/Sources/EruriCore/ScheduleCard.swift ios/Packages/EruriCore/Sources/EruriCore/SourceLabel.swift \
  ios/Packages/EruriCore/Tests/EruriCoreTests/ScheduleCardTests.swift ios/Packages/EruriCore/Tests/EruriCoreTests/SourceLabelTests.swift
git commit -m "feat(ios): link and photo reading in the app (spec §6, §9) — on foreground the app drains pending link rows 5 at a time and comes back for rows whose lease/backoff ends within 2 minutes (15 s + OCR, retries kept, local notice only for dropped rows), leaving active cancels reads and returns rows; a chat input with one http(s) URL and a short note becomes a link turn (admission: already read → duplicate line, OTP note → nothing saved), two or more URLs ask for one at a time; chat + menu reads up to 3 photos with PhotosPicker into one SHARE item by on-device OCR (no file); link/photo turns poll own items.status/gate_label and facts kinds every 3 s up to 60 s and show the storage note; schedule cards and archive say 공유한 링크 / 공유한 이미지

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
- Create: `supabase/eval/link-cases.json`(합성 링크·사진 본문 13종 + 기대값)
- Create: `supabase/scripts/_link-eval.ts`(판정·본문 펼치기 순수 함수)
- Create: `supabase/scripts/eval-link.ts`(배포된 worker를 테스트 lease로 호출)
- Test: `supabase/tests/link-eval.test.ts`(판정 함수·사례 파일, 네트워크 없음)
- Modify: `docs/superpowers/phase1/gates.md`(행 `LNK-eval`)

**Interfaces:**
- Consumes: L1 본문 형식(스펙 §6 "보내는 글(링크)"·"보내는 글(사진)" — 사례는 그 형식·배치로 쓴 합성 글, 긴 사례는 일시·장소 줄이 본문 앞), 배포된 `worker`(F20), `insert_item`(`p_enqueue:false`, `p_app_name`), `enqueue_job`, `tests/_testenv.ts`(`RUN`·`testUser`·`deleteRunJobs`).
- Produces: 게이트 행 `LNK-eval`(통과면 L8 진행, U7 판정).

판정: **행동 사례 9종**(청첩장 글·청첩장 OCR·돌잔치(연도 없음)·북토크(신청 기간 + 행사)·2회차 클래스·날짜만 결혼식·**잡음 청첩장**(달력 격자·방명록 작성일 3개·D-day·마스킹 계좌 — 일정 **정확히 1건**, Fable F4)·**긴 청첩장**(약 3,600자, 일시·장소 줄이 본문 앞 — 게이트 2,000자, Fable F2)·**사진 청첩장**(OCR 줄 순서 흐트러짐))은 **3회 모두** `status = extracted`·일정 수·시작·장소가 기대와 같고, **비행동 3종**(광고 라인업·지도만·영수증 사진)은 **3회 모두 일정 0**(상태는 그 사례가 허용한 것), **측정 1종**(대화 캡처 사진 "토요일 6시 합성역" — Jev가 `personal`로 격리하는지)은 상태·게이트 라벨·일정 수만 기록하고 판정에서 뺀다(U7과 같이 메인이 사용자에게 보고). 하나라도 어긋나면 "실패"로 기록하고 멈춘다 — 행동 사례가 게이트로 격리됐으면 U7(메인이 사용자에게 "공유 링크·사진은 게이트 생략"을 묻는다, 워커 변경 → ③c2 뒤 별도 계획), 추출이 틀렸으면 지시문 변경(워커 배포 → ③c2 뒤) 여부를 메인이 정한다. 이 태스크는 서버 코드를 고치지 않는다.

- [ ] **Step 1: 사례 파일**

`supabase/eval/link-cases.json`(`{{GALLERY:n}}`은 평가 스크립트가 "합성 갤러리 사진 설명 1번"…n줄로 펼친다 — 앱의 긴 페이지 본문과 같은 모양):

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
    "id": "wedding-noisy",
    "title": "합성태호 ♥ 합성소라 결혼합니다",
    "text": "[웹 링크] invite.example.com\n제목: 합성태호 ♥ 합성소라 결혼합니다\n설명: 2026년 11월 22일 일요일 낮 12시 30분\n본문:\n2026년 11월\n일 월 화 수 목 금 토\n1 2 3 4 5 6 7\n8 9 10 11 12 13 14\n15 16 17 18 19 20 21\n22 23 24 25 26 27 28\n29 30\nD-51\n예식 일시\n2026년 11월 22일 일요일 낮 12시 30분\n장소\n합성웨딩컨벤션 4층 아이리스홀\n마음 전하실 곳\n신랑측 합성은행 ***-****-5678\n방명록\n합성친구1 2026.09.30 축하해!\n합성친구2 2026.10.01 행복하세요\n합성친구3 2026.10.02 결혼 축하합니다",
    "expect": { "status": ["extracted"], "events": 1, "starts": ["2026-11-22T12:30"], "location": "합성웨딩컨벤션" }
  },
  {
    "id": "wedding-long",
    "title": "합성준호 ♥ 합성유진 결혼합니다",
    "text": "[웹 링크] invite.example.com\n제목: 합성준호 ♥ 합성유진 결혼합니다\n일시·장소 줄:\n예식 일시 2026년 12월 12일 토요일 오후 2시\n장소 합성 그랜드호텔 2층 크리스탈홀\n본문:\n{{GALLERY:200}}",
    "expect": { "status": ["extracted"], "events": 1, "starts": ["2026-12-12T14:00"], "location": "합성 그랜드호텔" }
  },
  {
    "id": "image-wedding",
    "app_name": "이미지",
    "title": null,
    "text": "[이미지] 사진 1장\n이미지 속 글자:\n합성웨딩홀 5층 라벤더홀\n합성동훈\n2026년 12월 19일 토요일 오후 3시\n그리고\n합성미래\n결혼합니다",
    "expect": { "status": ["extracted"], "events": 1, "starts": ["2026-12-19T15:00"], "location": "합성웨딩홀" }
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
  },
  {
    "id": "image-receipt",
    "app_name": "이미지",
    "title": null,
    "text": "[이미지] 사진 1장\n이미지 속 글자:\n합성마트 합성점\n2026-10-01 14:22\n합성우유 1L 2,980\n합성식빵 3,500\n합계 6,480원",
    "expect": { "status": ["extracted", "discarded:server:empty", "discarded:server:notice", "discarded:server:promo"], "events": 0 }
  },
  {
    "id": "image-chat",
    "app_name": "이미지",
    "title": null,
    "text": "[이미지] 사진 1장\n이미지 속 글자:\n합성친구\n토요일 6시 합성역 2번 출구에서 봐\n오후 3:12\nㅇㅋ 그때 보자\n오후 3:13",
    "expect": { "status": ["extracted", "discarded:server:personal", "discarded:server:empty"], "events": null }
  }
]
```

- [ ] **Step 2: 판정 함수와 실패하는 테스트**

`supabase/tests/link-eval.test.ts`:

```ts
import { assert, assertEquals } from "jsr:@std/assert@1";
import { type Case, expand, type Fact, judge } from "../scripts/_link-eval.ts";

// LNK-eval 판정(순수, 네트워크 없음): 상태·일정 수(null = 측정만)·시작(날짜만은 같음, 시각은 분까지 앞부분)·장소(부분 문자열)
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

Deno.test("link-eval judge: events null is measured, not judged", () => {
  const m: Case = { ...c, expect: { status: ["extracted", "discarded:server:personal"], events: null } };
  assertEquals(judge(m, "discarded:server:personal", []), []);
  assertEquals(judge(m, "extracted", [ev(0, "2026-10-03T18:00:00+09:00")]), []);
  assertEquals(judge(m, "discarded:server:promo", []), ["status:discarded:server:promo"]);
});

Deno.test("link-eval expand: gallery filler", () => {
  assertEquals(expand("본문:\n{{GALLERY:3}}\n끝"), "본문:\n합성 갤러리 사진 설명 1번\n합성 갤러리 사진 설명 2번\n합성 갤러리 사진 설명 3번\n끝");
});

// 사례 파일: 13종, id 유일, app_name 은 둘 중 하나, 긴 사례는 펼친 뒤 3,000~4,000자이고 일시 줄이 앞 2,000자 안(F23 — 게이트가 보는 범위)
Deno.test("link-cases.json shape", async () => {
  const cases: Case[] = JSON.parse(await Deno.readTextFile(new URL("../eval/link-cases.json", import.meta.url)));
  assertEquals(cases.length, 13);
  assertEquals(new Set(cases.map((x) => x.id)).size, 13);
  assert(cases.every((x) => (x.app_name ?? "웹 링크") === "웹 링크" || x.app_name === "이미지"));
  const long = expand(cases.find((x) => x.id === "wedding-long")!.text);
  assert(long.length >= 3000 && long.length <= 4000, `len ${long.length}`);
  assert(long.indexOf("예식 일시") < 2000);
});
```

Run: `deno test --allow-read supabase/tests/link-eval.test.ts`
Expected: FAIL(모듈 없음).

`supabase/scripts/_link-eval.ts`:

```ts
// LNK-eval 판정(계획 2026-10-02-link-event L7) — 네트워크 없는 순수 함수. eval-link.ts 와 link-eval.test.ts 가 쓴다
// events: null = 측정만(상태가 허용 목록 안이면 통과, 일정 수는 기록만 — 대화 캡처 사진의 게이트 격리 측정, U7)
export type Expect = { status: string[]; events: number | null; starts?: string[]; location?: string };
export type Case = { id: string; app_name?: string; title: string | null; text: string; expect: Expect };
export type Fact = { kind: string; ordinal: number; payload: { start?: string | null; location?: string | null } };

// 어긋난 항목 코드(빈 배열 = 일치). start: 기대가 날짜만(10자)이면 같아야 하고, 시각이면 그 앞부분(분까지)으로 시작해야 한다.
// location: 일정 중 하나의 장소가 기대 문자열을 포함. 일정이 아닌 fact(task·purchase)는 세지 않는다
export function judge(c: Case, status: string, facts: Fact[]): string[] {
  const miss: string[] = [];
  const events = facts.filter((f) => f.kind === "event").sort((a, b) => a.ordinal - b.ordinal);
  if (!c.expect.status.includes(status)) miss.push(`status:${status}`);
  if (c.expect.events !== null && events.length !== c.expect.events) miss.push(`events:${events.length}`);
  (c.expect.starts ?? []).forEach((s, k) => {
    const got = events[k]?.payload.start ?? "";
    if (s.length === 10 ? got !== s : !got.startsWith(s)) miss.push(`start${k}`);
  });
  const want = c.expect.location;
  if (want && !events.some((e) => (e.payload.location ?? "").includes(want))) miss.push("location");
  return miss;
}

// 본문 펼치기: {{GALLERY:n}} → "합성 갤러리 사진 설명 1번" … n줄(긴 청첩장 사례 — 앱 LinkText.compose 가 만드는 배치 그대로 쓴 사례에 넣는다)
export function expand(text: string): string {
  return text.replace(/\{\{GALLERY:(\d+)\}\}/g, (_m, n: string) =>
    Array.from({ length: Number(n) }, (_v, i) => `합성 갤러리 사진 설명 ${i + 1}번`).join("\n"));
}
```

Run: `deno test --allow-read supabase/tests/link-eval.test.ts`
Expected: 5 passed.

- [ ] **Step 3: 평가 스크립트**

`supabase/scripts/eval-link.ts`:

```ts
// LNK-eval(계획 2026-10-02-link-event L7): 앱이 만드는 링크·사진 본문 형식(스펙 §6 "보내는 글")의 합성 사례를 배포된 worker 의 process 경로
// (실제 서버 규칙 → Jev 게이트 → gpt-6-luna 추출 → save_facts)에 테스트 lease 로 넣고 상태·일정만 비교한다. 배포·서버 코드 변경 없음.
// 전용 테스트 사용자 13·실행 태그만 쓰고 끝나면 자기 행을 지운다(AGENTS.md §7). 출력은 사례 id·상태·게이트 라벨·개수·어긋난 항목 코드만(본문 없음)
// 사용: deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/eval-link.ts [--runs 3]
import { encrypt, toBytea } from "../functions/_shared/crypto.ts";
import { deleteRunJobs, RUN, service as sb, testUser } from "../tests/_testenv.ts";
import { type Case, expand, type Fact, judge } from "./_link-eval.ts";

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
        p_sender: null, p_title: c.title, p_content_enc: toBytea(await encrypt(USER, expand(c.text))), p_occurred_at: OCCURRED,
        p_enqueue: false, p_app_name: c.app_name ?? "웹 링크" });
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
      console.log(JSON.stringify({ run: r, case: c.id, app: c.app_name ?? "웹 링크", measure: c.expect.events === null,
        status: item?.status ?? null, gate: item?.gate_label ?? null, conf: item?.gate_confidence ?? null,
        events: ((facts ?? []) as Fact[]).filter((f) => f.kind === "event").length, ok: miss.length === 0, miss }));
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
  await sb.from("usage_counters").delete().eq("user_id", USER);                              // 테스트 사용자 13 전용 행만(Fable C9·L7-b)
  await sb.from("llm_slots").delete().eq("user_id", USER);
}
```

Run: `deno check supabase/scripts/eval-link.ts`
Expected: 타입 오류 없음.

- [ ] **Step 4: 평가 실행(측정 창 밖)**

메인에게 지금이 ③b3·③c1·③c2 창 밖인지 확인받는다. `pgrep -x xcodebuild`가 비었는지, `vm_stat`를 본다.

Run: `deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/eval-link.ts --runs 3`
Expected: 마지막 줄 `{"gate":"pass","runs":3,"cases":13,"failures":0}`. 사례 줄은 id·상태·게이트 라벨·개수·`miss` 코드만(본문·시작값·장소값을 출력하지 않는다). `image-chat`(`measure:true`)은 상태·게이트 라벨·일정 수를 기록만 한다.

정리 확인: `deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/sql.ts "select count(*) from items where user_id = (select id from auth.users where email = 'poc-test-13@example.com') and idempotency_key like 'test:%:link:%'"`가 0(이 스크립트의 사용법이 다르면 `supabase/scripts/sql.ts` 머리 주석대로 같은 질의를 돌린다).

- [ ] **Step 5: 기록**

`docs/superpowers/phase1/gates.md` 끝에 행을 더한다(커밋 칸은 비운다):

```text
| LNK-eval | 링크·사진 본문 형식(스펙 §6) 합성 13종 × 3회를 배포된 worker(테스트 lease, 사용자 13)에: 행동 9종(잡음·긴 청첩장·사진 청첩장 포함) extracted·일정 수·시작·장소 일치, 비행동 3종(광고·지도·영수증 사진) 일정 0, 대화 캡처 사진은 측정만 | 통과 또는 실패 | <실행 시각 KST>, HEAD <sha>. 사례별 3회 결과(상태·게이트 라벨·confidence 범위·miss 코드), image-chat 측정값(상태·라벨·일정 수 — U7 보고용), 실패면 U7(게이트) 또는 추출 원인 구분 | | <날짜> |
```

실패면 멈추고 메인에게 보고한다(L8로 넘어가지 않는다). 통과여도 `image-chat`이 `discarded:server:personal`이면 메인이 사용자에게 "대화 캡처 사진은 분류에서 걸러져 일정이 안 나올 수 있다"를 알린다(U7).

- [ ] **Step 6: 커밋**

```bash
git add supabase/eval/link-cases.json supabase/scripts/_link-eval.ts supabase/scripts/eval-link.ts supabase/tests/link-eval.test.ts docs/superpowers/phase1/gates.md
git commit -m "test(server): LNK-eval — 13 synthetic link and photo bodies in the app's formats (spec §6) through the deployed worker's process path with a test lease (user 13, no deploy): wedding text/OCR, first birthday without year, book talk with an application period, two sessions, date-only wedding, a noisy wedding page (calendar grid, guestbook dates, D-day, masked account → exactly one event), a ~3,600-char wedding with date/place lines before the body (gate sees the first 2,000 chars), a photo wedding card must extract the expected events, starts and places; ad lineup, map-only and a receipt photo must yield no event; a chat screenshot photo is measured only (gate personal or not); offline judge, expand and case-file tests

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task L8: 0.11.0 + 시뮬레이터 게이트 `LNK-sim` (측정 창 밖)

**Files:**
- Modify: `ios/project.yml`(`MARKETING_VERSION: 0.11.0`)
- Modify: `docs/superpowers/phase1/gates.md`(행 `LNK-sim`)
- 게이트 하네스(임시, **커밋하지 않는다**): `ios/project.gate0110.yml`, `EruriGate.xcodeproj`, `ios/GateHostTests/GateHost.swift`, `ios/GateUITests/LinkGate.swift`, `.context/gate0110/`(rt·udid·start·site/·cards·cleanup.ts). 원본은 사본에서 만든다(F22): `.context/sim-gate-090-shots/project.gate090.yml.txt` → `ios/project.gate0110.yml`(`MARKETING_VERSION: 0.11.0`), `GateHost.swift.txt` → `ios/GateHostTests/GateHost.swift`(`test1_inject`만 남기고 rt 경로를 `.context/gate0110/rt`로, 아래 테스트를 더한다). 실행 도구는 `.context/gate090/drive.sh`를 `.context/gate0110/drive.sh`로 복사해 경로(`gate090` → `gate0110`)만 바꾼다(푸시 마커는 쓰지 않는다).

**Interfaces:**
- Consumes: L4·L5·L6 앱, L7 `LNK-eval` 통과, 배포된 `ingest`·`worker`(서버 변경 없음), `.context/gate090/token.ts`.
- 테스트 사용자 **14**(게이트 전용). 순서는 광고 해지 U9 선례: token.ts(사용자 14 생성 + 로그인 1회) → Host 주입. 이후 `testUser(14)`·`userClient(14)` 호출 금지(앱 세션이 끊긴다 — 정리는 `testUserId(14)`).

판정(**전부 통과해야** `LNK-sim` 통과 — 자동화가 막힌 G는 "대기"이고 판정에서 빼지 않는다, U11): G1 채팅 붙여넣기(정적) → "일정 1건" · G2 지연 JS(SPA) → "일정 1건" · G3 **글 0자** 그림 페이지 → OCR로 "일정 1건"(Codex 1 회귀) · G4 제안 탭 추가 → EventKit 일정 위치 · G5 이어받기(대기 행 → foreground → 보관함 항목, 행 0) · G5b 이어받기 확정 실패(404) → 행 0 + foreground 로컬 알림 배달(Fable F11) · G6 주소 두 개 → 안내 + 입력 유지 · G7 스킴 없는 도메인 질문은 링크 턴 아님 · **G8 Safari 공유 시트 → 확장이 읽음(필수 — U1 판정, Fable F5)** · G9 앱 로그에 주소·제목·OCR 글 없음 · G10 사진 앱 공유 → 확장 OCR → 상태 "읽었어요" · G11 채팅 "+" 사진 → 사진 턴 "일정 1건" · G12 같은 링크 다시 → "이미 읽은 링크예요"(메인 판정 MR2).

- [ ] **Step 1: 선행 확인·버전**

메인에게 창 밖임을 확인받는다(③b3·③c1·③c2). `gates.md`에 `LNK-eval` 통과가 있는지 본다. `pgrep -x deno`가 비어 있는지, `vm_stat | grep -E 'free|compressor'`를 본다.

Run: `git log --oneline -3 -- ios/project.yml && grep -n MARKETING_VERSION ios/project.yml`
Expected: `0.10.0`. 0.11.0 이상이 이미 있으면 멈추고 메인에게 알린다(D10).

`ios/project.yml`의 `MARKETING_VERSION: 0.10.0` → `MARKETING_VERSION: 0.11.0`.

```bash
git add ios/project.yml
git commit -m "chore(ios): 0.11.0 — link and photo → event proposals (share sheet, chat paste, chat photos; device rendering and on-device OCR)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 2: 합성 페이지·로컬 서버**

`.context/gate0110/site/`에 만든다(합성, 커밋 안 함):

`wedding.html`(G1·G12):

```html
<!doctype html><html><head><meta charset="utf-8"><title>모바일 청첩장</title>
<meta property="og:title" content="합성신랑 ♥ 합성신부 결혼합니다">
<meta property="og:description" content="2026년 11월 14일 토요일 오후 1시 30분 합성웨딩홀 3층"></head>
<body><h1>초대합니다</h1><p>일시 2026년 11월 14일 토요일 오후 1시 30분</p><p>장소 합성웨딩홀 3층 그랜드볼룸</p><p>서울 합성구 합성로 123</p></body></html>
```

`wedding2.html`(G5):

```html
<!doctype html><html><head><meta charset="utf-8"><title>합성민준 ♥ 합성서연 결혼합니다</title></head>
<body><p>2026년 11월 21일 토요일 오전 11시</p><p>합성 가든홀 2층</p></body></html>
```

`wedding3.html`(G8 — G1과 다른 주소여야 중복이 아니다):

```html
<!doctype html><html><head><meta charset="utf-8"><title>합성지훈 ♥ 합성하늘 결혼합니다</title></head>
<body><p>2026년 12월 26일 토요일 오후 2시</p><p>합성 리버뷰홀 1층</p></body></html>
```

`spa.html`(G2):

```html
<!doctype html><html><head><meta charset="utf-8"><title>합성 북토크</title></head><body><div id="app">불러오는 중</div>
<script>setTimeout(() => { document.getElementById('app').innerHTML = '<p>합성 북토크 2026년 11월 21일(토) 오후 3시</p><p>합성도서관 강당</p>'; }, 1500);</script>
</body></html>
```

`image.html`(G3 — 글 0자, 그림에만 날짜):

```html
<!doctype html><html><head><meta charset="utf-8"><title></title></head>
<body style="margin:0"><img src="card.svg" width="360"></body></html>
```

`card.svg`:

```xml
<svg xmlns="http://www.w3.org/2000/svg" width="360" height="240"><rect width="100%" height="100%" fill="white"/>
<text x="16" y="80" font-size="26" font-weight="bold">2026년 12월 5일 토요일 정오</text>
<text x="16" y="140" font-size="26" font-weight="bold">합성 컨벤션 웨딩홀</text></svg>
```

(`missing.html`은 만들지 않는다 — G5b의 404.)

Run(백그라운드): `python3 -m http.server 8765 --bind 127.0.0.1 --directory .context/gate0110/site`
확인: `curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8765/wedding.html` → `200`, `…/missing.html` → `404`.

- [ ] **Step 3: 시뮬레이터·지난 잔여 정리·로그인·권한**

전용 시뮬레이터를 만든다(이름 `Eruri-gate0110`, UDID는 `.context/gate0110/udid` — `ios/.sim-udid`가 아닌 새 기기).

`.context/gate0110/cleanup.ts`(커밋 안 함):

```ts
// LNK-sim 정리: 게이트 전용 테스트 사용자 14 의 링크·사진 항목(captured_at ≥ --since)과 그 파생 행만 지운다(AGENTS.md §7, Fable C9). 출력은 개수만
// 사용: deno run --allow-net --allow-env --allow-read --env-file=supabase/.env .context/gate0110/cleanup.ts --since <ISO>
import { service as sb, testUserId } from "../../supabase/tests/_testenv.ts";
const at = Deno.args.indexOf("--since");
if (at < 0) throw new Error("--since <ISO> 필요");
const since = Deno.args[at + 1];
const u = await testUserId(14);
const { data } = await sb.from("items").select("id").eq("user_id", u).eq("source", "SHARE").in("app_name", ["웹 링크", "이미지"]).gte("captured_at", since);
const ids = (data ?? []).map((r) => r.id as string);
if (ids.length) {
  await sb.from("facts").delete().eq("user_id", u).in("item_id", ids);           // proposals → proposal_pushes cascade
  await sb.from("jobs").delete().eq("user_id", u).in("payload->>item_id", ids);
  await sb.from("items").delete().eq("user_id", u).in("id", ids);
}
await sb.from("jobs").delete().eq("user_id", u).eq("kind", "notify").gte("created_at", since);
await sb.from("usage_counters").delete().eq("user_id", u);                       // 사용자 14 전용 행
await sb.from("llm_slots").delete().eq("user_id", u);
console.log(JSON.stringify({ deleted_items: ids.length }));
```

Run(지난 실행 잔여 — 다시 돌릴 때 G5·G12가 지난 항목으로 거짓 통과하지 않게, Codex 7·Fable C7): `deno run --allow-net --allow-env --allow-read --env-file=supabase/.env .context/gate0110/cleanup.ts --since 1970-01-01T00:00:00Z`
Expected: `{"deleted_items":<n>}`(첫 실행이면 0). 그다음 게이트 시작 시각을 남긴다: `date -u +%Y-%m-%dT%H:%M:%SZ > .context/gate0110/start`.

Run: `mkdir -p .context/gate0110 && deno run --allow-net --allow-env --allow-read --allow-write --env-file=supabase/.env .context/gate090/token.ts one 14 .context/gate0110/rt`
Expected: `user <id> rt written true`(토큰 값은 출력되지 않는다).

`GateHost.swift`(하네스)에 `test1_inject`(rt 경로 `.context/gate0110/rt`) 뒤로 더한다(파일 머리에 `import EventKit`·`import UserNotifications`·`import UIKit`·`import EruriCore`):

```swift
  /// 저장소 루트(…/ios/GateHostTests/GateHost.swift 에서 세 단계 위) — 시뮬레이터 프로세스는 호스트 경로를 읽고 쓴다
  static let repo = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()

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

  // G5b 확정 실패: 404 주소의 대기 행(이어받기가 지우고 알림 1건)
  func test5_seedFailingLink() throws {
    let q = try CaptureQueue.shared()
    try q.enqueueLink(PendingLink(url: URL(string: "http://127.0.0.1:8765/missing.html")!, note: nil, origin: "share"), lease: 0)
    print("GATE: pending_links=\(try q.linkCount())")
  }

  // G5b: foreground 로컬 알림이 배달됐는지(F25 — willPresent [.banner, .list]) + 권한 상태
  func test6_deliveredNotice() async throws {
    let c = UNUserNotificationCenter.current()
    let delivered = await c.deliveredNotifications()
    let auth = await c.notificationSettings().authorizationStatus
    print("GATE: notice=\(delivered.contains { $0.request.content.title == LinkCaptureText.drainFailedTitle }) auth=\(auth.rawValue)")
  }

  // G10·G11: 합성 청첩장 사진 두 장을 그려 .context/gate0110/ 에 PNG 로 둔다(그다음 simctl addmedia)
  func test7_makeCards() throws {
    func card(_ lines: [String]) -> Data {
      let fmt = UIGraphicsImageRendererFormat(); fmt.scale = 1
      return UIGraphicsImageRenderer(size: CGSize(width: 1080, height: 720), format: fmt).pngData { _ in
        UIColor.white.setFill(); UIRectFill(CGRect(x: 0, y: 0, width: 1080, height: 720))
        for (i, l) in lines.enumerated() {
          (l as NSString).draw(at: CGPoint(x: 60, y: CGFloat(200 + i * 120)),
                               withAttributes: [.font: UIFont.boldSystemFont(ofSize: 64), .foregroundColor: UIColor.black])
        }
      }
    }
    let dir = Self.repo.appendingPathComponent(".context/gate0110")
    try card(["합성도윤 ♥ 합성서아", "2027년 1월 9일 토요일 오후 5시", "합성 아트홀 3층"]).write(to: dir.appendingPathComponent("card-a.png"))
    try card(["합성시우 ♥ 합성하린", "2027년 1월 16일 토요일 낮 12시", "합성 컨벤션 2층"]).write(to: dir.appendingPathComponent("card-b.png"))
    print("GATE: cards=2")
  }
```

`xcodegen --spec ios/project.gate0110.yml` 뒤 `test1_inject`를 돌린다(`GATE: injected=true`). 캘린더 권한: `xcrun simctl privacy $(cat .context/gate0110/udid) grant calendar com.picpal.eruri`. 사진: `GateHost/test7_makeCards` → `xcrun simctl addmedia $(cat .context/gate0110/udid) .context/gate0110/card-a.png`(G10 직전), `… card-b.png`(G11 직전 — 사진 보관함의 가장 최근 사진이 그 게이트의 사진이 되게).

- [ ] **Step 4: UI 게이트**

`ios/GateUITests/LinkGate.swift`(하네스 — 커밋 안 함):

```swift
import XCTest

final class LinkGate: XCTestCase {
  let app = XCUIApplication()
  let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
  override func setUp() { continueAfterFailure = true }
  func log(_ s: String) { print("GATE: \(s)") }
  var input: XCUIElement { app.textFields["질문하기"].exists ? app.textFields["질문하기"] : app.textViews.firstMatch }
  func send(_ s: String) { input.tap(); input.typeText(s); app.buttons["보내기"].tap() }
  func text(_ c: String, in a: XCUIApplication? = nil) -> XCUIElement {
    (a ?? app).descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", c)).firstMatch
  }
  func count(_ c: String) -> Int { app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", c)).count }
  var linkTurns: Int { app.staticTexts.matching(identifier: "chat-link-status").count }
  /// 알림 권한 창이 뜨면 허용(G5b 배달 판정에 필요)
  func allowAlerts() { let b = springboard.buttons["허용"]; if b.waitForExistence(timeout: 3) { b.tap() } }
  /// "일정 1건을 찾았어요"가 새로 하나 더 생길 때까지(앞 턴의 같은 문구와 구분)
  func waitNewResult(after before: Int, timeout: TimeInterval) -> Bool {
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline { if count("일정 1건을 찾았어요") > before { return true }; sleep(3) }
    return false
  }

  // G1 정적 페이지 → 링크 턴 → 서버 처리 결과 + 저장 범위 한 줄
  func test01_G1_static() {
    app.launch(); allowAlerts(); app.tabBars.buttons["채팅"].tap()
    send("http://127.0.0.1:8765/wedding.html")
    log("G1 read=\(text("읽었어요").waitForExistence(timeout: 40)) note=\(app.staticTexts["chat-link-note"].waitForExistence(timeout: 5))")
    log("G1 result=\(text("일정 1건을 찾았어요").waitForExistence(timeout: 120))")
  }

  // G4 제안 탭 → 캘린더에 추가(위치는 GateHost test4 가 본다)
  func test02_G4_add() {
    app.launch(); app.tabBars.buttons["제안"].tap()
    let add = app.buttons["캘린더에 추가"].firstMatch
    log("G4 row=\(add.waitForExistence(timeout: 20))")
    add.tap()
    log("G4 added=\(text("등록").waitForExistence(timeout: 15) || !app.buttons["캘린더에 추가"].exists)")
  }

  // G2 지연 JS · G3 글 0자 그림 페이지(OCR)
  func test03_G2_G3() {
    app.launch(); app.tabBars.buttons["채팅"].tap()
    let b2 = count("일정 1건을 찾았어요")
    send("http://127.0.0.1:8765/spa.html")
    log("G2 result=\(waitNewResult(after: b2, timeout: 120))")
    let b3 = count("일정 1건을 찾았어요")
    send("http://127.0.0.1:8765/image.html")
    log("G3 result=\(waitNewResult(after: b3, timeout: 150))")
  }

  // G5 이어받기: GateHost test2 가 대기 행을 넣은 뒤 실행 — foreground 가 읽고 올린다
  func test04_G5_drain() {
    app.launch(); app.tabBars.buttons["보관함"].tap()
    log("G5 archived=\(text("합성민준 ♥ 합성서연").waitForExistence(timeout: 120))")
  }

  // G5b 확정 실패: GateHost test5 가 404 행을 넣은 뒤 실행 — 이어받기가 지우고 알림(배달은 GateHost test6 이 본다)
  func test05_G5b_failure() {
    app.launch(); app.tabBars.buttons["채팅"].tap()
    sleep(25)
    log("G5b ran=true")
  }

  // G6 주소 두 개 · G7 스킴 없는 도메인은 질문
  func test06_G6_G7() {
    app.launch(); app.tabBars.buttons["채팅"].tap()
    let turns = linkTurns
    send("http://127.0.0.1:8765/a.html http://127.0.0.1:8765/b.html")
    log("G6 notice=\(text("링크는 한 번에 하나씩").waitForExistence(timeout: 10)) kept=\((input.value as? String)?.contains("a.html") == true)")
    input.tap(); input.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 80))   // 입력 비우기(남아 있는 것을 확인한 뒤)
    send("naver.com 에서 산 거 언제야?")
    sleep(20)
    log("G7 not_link=\(linkTurns == turns)")
  }

  // G12 같은 링크 다시(G1 의 wedding.html) → 읽지 않고 중복 문구
  func test07_G12_duplicate() {
    app.launch(); app.tabBars.buttons["채팅"].tap()
    send("http://127.0.0.1:8765/wedding.html")
    log("G12 duplicate=\(text("이미 읽은 링크예요").waitForExistence(timeout: 20))")
  }

  // G8 Safari 공유 시트 → ERURI 확장이 페이지를 읽음(U1). 첫 공유면 ERURI 가 "더 보기"에 있을 수 있다
  func test08_G8_safari() {
    let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
    safari.open(URL(string: "http://127.0.0.1:8765/wedding3.html")!)
    _ = text("합성지훈", in: safari).waitForExistence(timeout: 20)
    safari.buttons.matching(NSPredicate(format: "identifier == 'ShareButton' OR label IN {'공유', 'Share'}")).firstMatch.tap()
    var eruri = text("ERURI", in: safari)
    if !eruri.waitForExistence(timeout: 8) {
      text("더 보기", in: safari).tap()
      eruri = text("ERURI", in: safari)
    }
    log("G8 sheet=\(eruri.waitForExistence(timeout: 8))")
    eruri.tap()
    let status = safari.staticTexts["share-link-status"]
    let read = NSPredicate(format: "label CONTAINS '읽었어요'")
    log("G8 read=\(XCTWaiter().wait(for: [XCTNSPredicateExpectation(predicate: read, object: status)], timeout: 20) == .completed)")
  }

  // G10 사진 앱 공유 → ERURI 확장이 사진을 OCR(card-a — addmedia 직후 가장 최근 사진)
  func test09_G10_photos() {
    let photos = XCUIApplication(bundleIdentifier: "com.apple.mobileslideshow")
    photos.launch()
    let last = photos.images.allElementsBoundByIndex.last
    log("G10 photo=\(last != nil)")
    last?.tap()
    photos.buttons.matching(NSPredicate(format: "identifier == 'ShareButton' OR label IN {'공유', 'Share'}")).firstMatch.tap()
    let eruri = text("ERURI", in: photos)
    log("G10 sheet=\(eruri.waitForExistence(timeout: 8))")
    eruri.tap()
    let status = photos.staticTexts["share-link-status"]
    let read = NSPredicate(format: "label CONTAINS '사진에서 글'")
    log("G10 read=\(XCTWaiter().wait(for: [XCTNSPredicateExpectation(predicate: read, object: status)], timeout: 30) == .completed)")
  }

  // G11 채팅 "+" → 사진에서 일정 읽기 → card-b 선택 → 사진 턴 결과
  func test10_G11_chatPhoto() {
    app.launch(); app.tabBars.buttons["채팅"].tap()
    let before = count("일정 1건을 찾았어요")
    app.buttons["첨부"].tap()
    app.buttons["사진에서 일정 읽기"].tap()
    let pick = app.images.allElementsBoundByIndex.last
    log("G11 picker=\(pick != nil)")
    pick?.tap()
    let add = app.buttons.matching(NSPredicate(format: "label IN {'추가', 'Add'}")).firstMatch
    if add.waitForExistence(timeout: 5) { add.tap() }
    log("G11 read=\(text("사진에서 글").waitForExistence(timeout: 60))")
    log("G11 result=\(waitNewResult(after: before, timeout: 120))")
  }
}
```

실행 순서(각각 `drive.sh LinkGate/<test>` 또는 `GateHostTests/GateHost/<test>`):
1. `LinkGate/test01_G1_static` → `GATE: G1 read=true note=true`, `G1 result=true`
2. `LinkGate/test02_G4_add` → `G4 row=true added=true` → `GateHost/test4_calendarLocation` → `marker_event=true location_ok=true`
3. `LinkGate/test03_G2_G3` → `G2 result=true`, `G3 result=true`(G3 실패면 L3의 U2·U4 판정과 대조해 원인을 적는다)
4. `GateHost/test2_seedPendingLink` → `pending_links=1` → `LinkGate/test04_G5_drain` → `G5 archived=true` → `GateHost/test3_pendingAfterDrain` → `pending_links=0`
5. `GateHost/test5_seedFailingLink` → `pending_links=1` → `LinkGate/test05_G5b_failure` → `GateHost/test3_pendingAfterDrain` → `pending_links=0` → `GateHost/test6_deliveredNotice` → `notice=true auth=2`(2 = authorized. `auth`가 2가 아니면 하네스 문제 — G1의 `allowAlerts`가 권한 창을 못 잡았다. 권한을 준 뒤 5를 다시 한다)
6. `LinkGate/test06_G6_G7` → `G6 notice=true kept=true`, `G7 not_link=true`
7. `LinkGate/test07_G12_duplicate` → `G12 duplicate=true`
8. `LinkGate/test08_G8_safari` → `G8 sheet=true`, `G8 read=true`. 이어서 앱 로그에 `ShareExtension link queued`가 있는지 본다(Step 6의 로그 파일). **20분 안에 자동화가 안 되면** `LNK-sim`은 "대기"로 두고 막힌 지점(어느 요소를 못 찾았는지·스크린샷)을 적는다 — 판정에서 빼지 않는다(U1 판정이 L9 실기기로 밀리면 0.11.1 한 바퀴가 더 든다, Fable F5). 확장이 결과 없이 닫히거나 `share-link-status`가 "다 읽지 못했어요"로 끝나면 U1 실패 → L9 Step 4의 대안(`renderInShareExtension = false`)을 TestFlight 전에 적용하고 이 G8을 "앱을 열면" 경로로 다시 판정한다.
9. `GateHost/test7_makeCards` → `cards=2` → `simctl addmedia … card-a.png` → `LinkGate/test09_G10_photos` → `G10 photo=true sheet=true read=true`(앱 로그 `ShareExtension image queued`)
10. `simctl addmedia … card-b.png` → `LinkGate/test10_G11_chatPhoto` → `G11 picker=true read=true result=true`

각 단계 실패 시 스크린샷(`xcrun simctl io <udid> screenshot .context/gate0110/<g>.png`)을 남기고 원인을 적는다. U5(ATS)로 로드가 막히면(`G1 read=false`, 앱 로그 `link chat failed:load_failed`) 하네스 yml의 앱·확장 Info.plist 설정에 `NSAppTransportSecurity: { NSAllowsLocalNetworking: true }`를 더해 다시 빌드하고 그 사실을 기록한다(제품 Info.plist는 바꾸지 않는다). G8·G10·G11의 선택자(`ShareButton`·`ERURI`·사진 셀)가 이 iOS에서 다르면 화면 계층(`app.debugDescription`)을 보고 선택자만 고친다(판정 기준은 그대로).

- [ ] **Step 5: 하위 리소스 차단 대조(L3에서 건너뛰었을 때만)**

L3 `testPrivateSubresourcesAreBlocked`가 U5로 건너뛰었으면: `site/sub.html`(`<p>2026년 11월 30일 합성 행사</p><img src="http://127.0.0.1:8765/pixel.png">`)을 채팅에 붙여넣고 서버 접근 로그(`python3 -m http.server` 출력)에 `pixel.png` 요청이 **있는지** 본다 — DEBUG 빌드는 루프백을 허용하므로 요청이 있어야 정상이고, 이것으로 규칙 목록이 렌더링을 깨지 않음만 확인한다(차단 자체는 L3 테스트의 판정이다 — 여기서 "통과"로 바꾸지 않고 `LNK-sim` 비고에 "L3 서버 테스트 U5 건너뜀"을 적는다). 이 항목은 일정 1건이 더 생기므로 정리 개수에 1을 더한다.

- [ ] **Step 6: G9 로그 개인정보**

Run: `cd ios && UDID=$(cat ../.context/gate0110/udid) && tail -300 "$(xcrun simctl get_app_container "$UDID" com.picpal.eruri group.com.picpal.eruri)/eruri.log" | grep -c -E '127\.0\.0\.1|wedding|spa\.html|image\.html|합성신랑|합성웨딩홀|합성지훈|합성도윤|합성시우|합성 아트홀|합성 컨벤션|card-[ab]'`
Expected: `0`. 같은 로그에 `link chat queued`·`link drain queued`·`link drain failed:http_404`·`link chat duplicate`·`ShareExtension link queued`·`ShareExtension image queued`·`image chat queued`가 있다.

- [ ] **Step 7: 정리**

Run: `deno run --allow-net --allow-env --allow-read --env-file=supabase/.env .context/gate0110/cleanup.ts --since "$(cat .context/gate0110/start)"` → `{"deleted_items":7}`(G1·G2·G3·G5·G8·G10·G11 — G5b·G12는 항목이 없다. Step 5를 했으면 8). 로컬 서버를 끄고(백그라운드 작업 종료), 시뮬레이터 `Eruri-gate0110`을 지우고(`xcrun simctl delete`), 하네스 파일(`ios/project.gate0110.yml`·`ios/EruriGate.xcodeproj`·`ios/GateHostTests/`·`ios/GateUITests/`·`ios/build-gate/`)을 지운다. `git status --short`에 하네스가 남지 않았는지 본다.

- [ ] **Step 8: 기록·커밋**

`docs/superpowers/phase1/gates.md` 끝에 행을 더한다:

```text
| LNK-sim | 0.11.0 시뮬레이터(테스트 사용자 14, 로컬 합성 페이지·사진): G1 채팅 붙여넣기 정적 → 일정 1건 + 저장 범위 줄 · G2 지연 JS → 일정 1건 · G3 글 0자 그림 페이지 OCR → 일정 1건 · G4 제안 탭 추가 → EventKit 위치 · G5 대기 행 이어받기 → 보관함·행 0 · G5b 404 행 → 행 0 + foreground 알림 배달 · G6 주소 두 개 안내·입력 유지 · G7 도메인 질문은 링크 턴 아님 · G8 Safari 공유 시트 → 확장 읽기(U1) · G9 로그에 주소·제목·OCR 글 없음 · G10 사진 앱 공유 → 확장 OCR · G11 채팅 사진 → 일정 1건 · G12 같은 링크 → 이미 읽은 링크 | 통과 / 실패 / 대기 | <시각 KST>, HEAD <sha>, 전용 시뮬레이터(이름·iOS), 단계별 GATE 줄 요약, U1·U2·U4·U5·U11 판정, 대기면 막힌 G와 원인 | | <날짜> |
```

```bash
git add docs/superpowers/phase1/gates.md
git commit -m "docs(gates): LNK-sim — 0.11.0 link and photo reading on the simulator (chat paste static/SPA/zero-text image OCR, EventKit location, pending-row hand-off and final-failure notice, two-URL notice, domain question unaffected, Safari share sheet in the extension, Photos share OCR, chat photo, duplicate link, no address or OCR text in logs)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task L9: TestFlight 0.11.0 + 실기기 게이트 `LNK-device` (U6b 뒤)

**Files:**
- Modify: `docs/superpowers/phase1/gates.md`(행 `LNK-device`, 필요하면 `LNK-ocr-device`)
- (실패 시) Modify: `ios/Packages/EruriCore/Sources/EruriCore/LinkFlow.swift`(`renderInShareExtension = false`), `ios/project.yml`(0.11.1), 스펙 §6·§16

**Interfaces:**
- Consumes: L8 통과(`LNK-sim` — U1 판정 포함), `gates.md`의 0.10.0 TestFlight 기록(광고 해지 U6b, D11), `ios/scripts/testflight.sh`.
- 사용자가 실기기에서 조작한다. 에이전트는 메타만 본다: `device_traces`의 `share.link`(필드 origin·result·code·elapsed_ms·chars·ocr·timed_out·blocked_nav)·`share.image`(origin·result·code·elapsed_ms·chars·images), 실사용자(`ERURI_USER_ID`) `items`의 `app_name in ('웹 링크','이미지')` 행의 `id·status·gate_label`과 그 `facts` 종류·개수. 본문·제목·주소·사진은 보지 않는다(AGENTS.md §7).

판정(`LNK-device` 통과 = D1·D3·D3b·D5·D6 모두 + OCR 실기기 1건): D1 실제 공유 시트에서 확장이 페이지를 읽고(결과 `queued`, 또는 `handed_off`면 앱을 열어 `drain queued`) 확장이 죽지 않음(U3) · D3 다른 공개 행사·안내 페이지 링크를 채팅에 붙여넣어 결과 줄(앱 렌더링 실기기) · D3b D1과 같은 링크를 채팅에 붙여넣으면 "이미 읽은 링크예요. 제안 탭에서 확인해 주세요"(trace `result=duplicate`, MR2) · D5 제안 탭 추가 → 캘린더 일정에 위치 · D6 사진 앱에서 청첩장·초대장 사진(또는 캡처) 공유 → 확장 생존 + `share.image queued`(U10) · **OCR 실기기**: trace `ocr=true` 1건(D1·D3 중 OCR을 탄 링크) **또는** D6 — D6만 있으면 Vision 실기기는 판정되고, 화면 밑 스냅샷 OCR(U2 실기기)은 별도 행 `LNK-ocr-device` "대기"로 두고 첫 실제 그림 청첩장 때 판정한다(이 경우에만 대기 허용, Fable C8·L9-b). 읽는 중 [닫기]→이어받기(초판 D4)는 손으로 재현이 안 돼 실기기 필수에서 뺐다 — 시뮬레이터 G5·G8과 D1의 `handed_off` 경우가 맡는다(Fable F6).

- [ ] **Step 1: 선행 확인·업로드**

`gates.md`에서 `LNK-sim` 통과와 0.10.0 TestFlight(U6b) 기록을 확인한다. 없으면 멈춘다(D11).

Run: `cd ios && ./scripts/sim.sh gen && ./scripts/testflight.sh`
Expected: `Upload succeeded`, 빌드 `0.11.0 (<yyyymmddHHMM>)`. App Store Connect에서 `VALID`가 되면 사용자에게 설치를 요청한다.

- [ ] **Step 2: 사용자 세션(메인이 안내, 사용자 조작 5회)**

사용자에게 순서대로 부탁한다(문구는 메인이 다듬는다). 사용자가 가진 실제 청첩장 링크 하나와, 아무 공개 행사·안내 페이지 링크 하나, 청첩장·초대장 사진 하나가 필요하다:
1. **D1**: Safari 또는 카카오톡 인앱 브라우저에서 실제 청첩장 링크를 열고 공유 → ERURI. 시트에 "링크를 읽는 중…" 뒤 결과 문구(와 저장 범위 한 줄)가 보이는지, 시트가 갑자기 사라지지 않는지. "앱을 열면 다시 읽어요"가 보이면 ERURI 앱을 연다. 그 뒤 알림·"제안" 탭에 일정이 왔는지 본다(조작 아님).
2. **D5**: "제안" 탭에서 그 일정 "캘린더에 추가" → 캘린더 앱에서 일정의 위치가 보이는지.
3. **D3**: 다른 공개 행사·안내 페이지 링크를 ERURI 채팅창에 붙여넣고 보내기. 링크 턴의 결과 줄.
4. **D3b**: D1의 청첩장 링크를 채팅창에 붙여넣고 보내기 → "이미 읽은 링크예요. 제안 탭에서 확인해 주세요".
5. **D6**: 사진 앱에서 청첩장·초대장 사진(또는 화면 캡처)을 공유 → ERURI. 시트에 "사진에서 글 N자를 읽었어요…"가 보이는지, 시트가 갑자기 사라지지 않는지.

- [ ] **Step 3: 메타 확인**

(먼저 `ERURI_USER_ID=$(grep '^ERURI_USER_ID=' supabase/.env | cut -d= -f2-)` — `.env`를 `source`하지 않는다. `device_traces` 열 이름이 다르면 `select column_name from information_schema.columns where table_name = 'device_traces'`로 확인해 바꾼다.)

Run: `deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/sql.ts "select at, event, fields->>'origin' o, fields->>'result' r, fields->>'code' c, fields->>'elapsed_ms' ms, fields->>'chars' n, fields->>'ocr' ocr, fields->>'images' img, fields->>'blocked_nav' b from device_traces where user_id = \$1 and event in ('share.link', 'share.image') and at > now() - interval '2 hours' order by at" "$ERURI_USER_ID"`
Expected: D1 `share.link o=share r=queued`(또는 `r=handed_off` 다음 `o=drain r=queued`), D3 `o=chat r=queued`, D3b `o=chat r=duplicate`, D6 `share.image o=share r=queued`. `ocr=true` 행이 있는지 적는다.

Run: `deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/sql.ts "select i.id, i.app_name, i.status, i.gate_label, count(f.id) filter (where f.kind = 'event') events from items i left join facts f on f.item_id = i.id and f.status = 'active' where i.user_id = \$1 and i.app_name in ('웹 링크', '이미지') and i.captured_at > now() - interval '2 hours' group by i.id order by i.captured_at" "$ERURI_USER_ID"`
Expected: D1·D3·D6 항목이 `extracted`(일정 ≥ 1) 또는 `discarded:server:empty`(그 페이지·사진에 일정이 없을 때 — 사용자에게 날짜가 있었는지 묻는다). D3b는 새 항목이 없다. D5는 사용자 확인.

- [ ] **Step 4: 실패면 대안(U3·U10)**

D1에서 확장이 결과 없이 닫히거나(`share.link` trace 없음 + 대기 행이 남아 앱 열기 때 `o=drain`), 시트가 멈추면(U3): `LinkFlow.renderInShareExtension = false`, `MARKETING_VERSION: 0.11.1`, 스펙 §6 "실기기 미확인" 문단을 "확장은 대기 행만 남기고 '앱을 열면 읽어요'"로 고치고 §16에 판정을 적는다. 다시 업로드 → D1'(공유 → 시트 "앱을 열면 다시 읽어요" → 앱 열기 → `o=drain r=queued`). `LNK-device`는 "실패(대안 채택)"로 기록한다(AGENTS.md §5-8).

D6에서 확장이 결과 없이 닫히면(`share.image` trace 없음 — U10): 멈추고 메인에게 보고한다. 대안(축소본을 App Group `inbox/`에 두고 앱에 넘김)은 스펙 §6 "사진 파일은 저장하지 않는다"를 바꾸므로 메인이 사용자에게 묻고, 정해지면 별도 태스크(0.11.1)로 한다.

- [ ] **Step 5: 기록·커밋**

`docs/superpowers/phase1/gates.md` 끝에 행을 더한다(OCR 실기기가 D6만이면 `LNK-ocr-device` 대기 행도):

```text
| LNK-device | 0.11.0 실기기: D1 실제 공유 시트에서 확장 읽기(queued 또는 handed_off → drain queued, 확장 생존 — U3) · D3 다른 링크 채팅 붙여넣기 결과 줄 · D3b 같은 링크 → 이미 읽은 링크 · D5 캘린더 위치 · D6 사진 공유 확장 OCR(U10) · OCR 실기기(ocr=true 또는 D6) | 통과 / 실패(대안 채택) | <시각 KST>, 빌드 0.11.0 (<번호>), trace 메타(event·origin·result·code·elapsed_ms·chars·ocr·images·blocked_nav), items 상태·일정 수(본문·주소 없음), U3·U10 판정 | | <날짜> |
| LNK-ocr-device | 실기기 화면 밑 스냅샷 OCR(그림 전용 청첩장 링크, 앱 15초) → 일정(U2 실기기) | 대기 | 사용자에게 그림 전용 링크가 생기면 판정(시뮬레이터 G3 통과, Vision 실기기는 D6로 판정) | | <날짜> |
```

```bash
git add docs/superpowers/phase1/gates.md
git commit -m "docs(gates): LNK-device — 0.11.0 on device (share-sheet rendering in the extension, chat paste on another link, duplicate link line, calendar location, Photos share OCR in the extension)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

## 리뷰 반영 (Codex gpt-6-astra · Fable, 2026-10-02)

초판 `9273791` 리뷰. Codex HIGH 3·MED 6(`.context/codex-review-link.out.md`), Fable은 Codex 지적별 판정 C1~C9 + 추가 F1~F12 + 이미지 입력 LI1~LI5(`.context/fable-review-link-plan.md`). 충돌하면 Fable 판정을 따랐다(MR4). 스펙 §16 "외부 리뷰 반영 (링크 → 일정 계획 …)"에 같은 판정을 요약해 두었다.

| # | 지적(심각도) | 판정 | 반영 위치 |
|---|---|---|---|
| Codex 1 / C1 | 글자 0자 페이지가 OCR 전에 `empty`로 끝나고 확장은 행을 지운다(HIGH) | 반영 | D4·D6, L1 `LinkSettle`(0자 = didFinish + 4초 완료)·`testSettleEmptyPage`, L2 `handOffCodes`에 `empty`·`testShareEmptyPageHandsOff`, L3 렌더러(0자도 추출·OCR, 확장은 빈 페이지를 `.page`로)·`testImageOnlyPageUsesOCR`(글 0자)·`testEmptyPageWithoutOCRReturnsEmptyPage`, L8 G3 |
| Codex 2 / C2 | 기한·[닫기]가 JS 반환을 기다린다 — 멈춘 페이지에서 시트가 갇힌다(HIGH) | 반영 | D15, L3 `RenderRace`(독립 기한 = 예산 + 2초 + OCR 8초, 취소)·`testStuckPageTimesOut`·`testCancelReturnsCancelled`, L4 `LinkStatusView.race`([닫기]는 결과를 기다리지 않음) |
| Codex 3 / C3 | 규칙 전 메모·전체 주소를 SQLite에 영속화, "발췌"가 짧은 페이지의 전문 저장을 감춤(HIGH → Fable MED) | 반영(MED) | D3, L2 `LinkFlow.admit`(메모를 행 전에 규칙 — OTP면 행 없음)·`testOTPNoteLeavesNoRow`, 대기 행 7일 만료(`linkMaxAge`)·`testExpiredLinkRowsAreDropped`, MR1 문구(`storageNote`, L0 Step 5·11·13). 전체 주소는 이어받기에 필요해 기기에 최대 7일 둔다(기기 밖으로 나가지 않음) |
| Codex 4 / C4 | 확장이 죽은 뒤 60초 전에 앱을 열거나 5건을 넘으면 이어받기가 멈춘다(MED → Fable HIGH 확장: 읽는 중 백그라운드 전환 → 행 삭제 + 실패 알림) | 반영 | D1, L2 재시도/확정 실패 구분(`retryCodes`·`maxAppAttempts`)·취소 시 행 반환·`testAppRetryableFailureKeepsRow`·`testAppCancelledReleasesRow`, `nextLinkAttempt`, L5 `drainPending`(반복·2분 안 재확인·키 창 재시도)·`suspend()`(비활성 전환 취소), 알림은 지운 행만 |
| Codex 5 / C5 | 주소가 든 질문을 무조건 수집으로 바꾼다(MED → Fable LOW) | 부분 반영 | UQ3 기본값 유지(짧은 메모 + 주소 = 수집) + F1 조건(긴 글·날짜 있는 글 + 주소는 질문)을 채팅에도 적용 — L1 `linkCandidate`·`testLongTextWithURLIsNotALink` |
| Codex 6 / C6 | 하위 프레임 사설 주소 허용, 위임 메서드는 하위 리소스를 거르지 못한다(MED) | 반영 | D7, L3 하위 프레임 `check`, `WKContentRuleList`(`blockRules`·`ruleList`)·`testPrivateSubresourcesAreBlocked`·`testBlockRulesAreValidJSON`, 스펙 문구 "공개 이름이 사설 주소로 풀리는 경우는 막지 않는다" |
| Codex 7 / C7 | G2·G5가 이전 결과로 거짓 통과(MED → Fable 부분 반대) | 부분 반영 | 주장한 G1→G2·G5 오인은 계획과 맞지 않는다(턴은 `@State`, 제목이 다르다). 남는 위험(다시 돌릴 때 지난 항목) → L8 Step 3 시작 전 정리, 새 결과 수 증가로 판정(`waitNewResult`) |
| Codex 8 / C8 | 실기기 OCR 판정 없이 통과 가능(MED) | 반영 | L9 통과 조건에 "trace `ocr=true` 또는 D6", D6만이면 `LNK-ocr-device` 대기(이 경우에만) |
| Codex 9 / C9 | 정리가 사용자 14의 모든 행을 지운다(MED → Fable 부분 반대) | 부분 반영 | 사용자 14는 게이트 전용이라 규칙 위반은 아니다. 위생상 `cleanup.ts --since <게이트 시작>`으로 링크·사진 항목과 파생 행만, 실행 전 정리는 `--since 1970…`(지난 게이트 잔여) |
| Codex "측정 창" | 고정 날짜가 아니라 최신 `status.t0`로 | 이미 반영 | Global Constraints(메인 재계산, 날짜는 예시) |
| Fable F1 | 주소 1개가 든 긴 텍스트 공유가 링크로 바뀌어 잘리고 실패 시 사라진다(HIGH) | 반영 | D5, L1 `linkCandidate`(200자 초과·날짜 후보 → `text`), L4 확정 실패 시 텍스트 폴백(`shareFallback`) |
| Fable F2 | Jev 게이트는 앞 2,000자만 본다 — 긴 페이지의 일시·장소 줄을 못 본다(HIGH) | 반영 | F23, L1 `fit`(일시·장소 줄을 본문 앞 `일시·장소 줄:` 블록으로)·`testComposeTruncatesAndKeepsKeyLinesFirst`, `ImageText`도 같은 배치, L7 `wedding-long` |
| Fable F3 | ATS 예외가 없어 공개 `http://`가 막힌다(HIGH) | 반영 | F24·D7, L1 `upgraded`·`testUpgraded`, L3 https 올리기 + `insecure`(`loadFailure`)·`testLoadFailureCodes`, ATS 예외는 넣지 않음 |
| Fable F4 | L7 사례가 실제 출력(달력·방명록·D-day·계좌·긴 글)과 닮지 않았다(MED) | 반영 | L7 `wedding-noisy`(일정 정확히 1건)·`wedding-long`, 사진 3종 |
| Fable F5 | U1을 실기기 L9까지 미룬다 — G8이 선택(MED) | 반영 | U1 흡수 게이트를 L8 G8(필수)로, 막히면 `LNK-sim` 대기, L9에는 U3·U10만 |
| Fable F6 | D4는 손으로 재현이 안 되고, 같은 링크 D1·D3의 기대가 없다(MED) | 반영 | D4 실기기 필수에서 제외(G5·G8·D1 handed_off가 맡음), 같은 링크 = 중복(MR2) → D3b 기대 문구, D3는 다른 링크 |
| Fable F7 | 렌더러 테스트가 `loadHTMLString`뿐(MED) | 반영 | L3 `LoopServer`(404·리다이렉트 반복·응답 없음·하위 리소스), U5면 건너뜀 |
| Fable F8 | L4·L5 병렬이 같은 프로젝트·빌드·시뮬레이터를 쓴다(MED) | 반영 | 실행 순서 3(L4 → L5 순서대로), "L5 = LinkCaptureText" 오기 삭제 |
| Fable F9 | 스냅샷 폭 780pt는 3배율에서 2,340px(LOW) | 반영 | L3 `snapshotWidth` = 390pt, 스펙 문구 |
| Fable F10 | 폐기 문구 "인증번호 같은 숫자"가 청첩장에 어색(LOW) | 반영 | `LinkCaptureText.discarded` = "보안 숫자로 보이는 내용이 있어 저장하지 않았어요.", 스펙 §9 |
| Fable F11 | foreground 실패 알림 표시 확인이 없다(LOW) | 반영 | F25, L8 G5b(배달·권한 상태) |
| Fable F12 | 보관함 출처가 "공유"(LOW, 선택) | 반영 | L5 `SourceLabel`("공유한 링크"·"공유한 이미지")·`testShareLinkAndImageLabels` |
| Fable LOW(주소 경계) | 한글이 붙은 주소 사례가 없다 | 반영 | L1 `matches`(첫 비 ASCII에서 자름)·`testChatIntent` 사례 |
| Fable L3-f | 타이밍 테스트 예산 2~3초 → 5초 이상 | 반영 | L3 테스트 예산 5초 이상, Global Constraints |
| Fable L7-b | 정리의 `usage_counters`·`llm_slots`는 사용자 13 전용이면 유지 | 반영 | L7 Step 3 주석 |
| Fable L9-d | Step 3 SQL의 `i.captured_at`은 스키마와 맞다 | 확인 | 변경 없음 |
| 이미지 입력 LI1~LI5 / G10·G11·D6·U10 | 사용자 추가 요구(MR3) | 반영 | D13, L1 `ImageText`, L2 `ImageFlow`·문구, L3 `OCR.recognize(data:maxPixel:)`·`ShareImages`, L4 활성화 규칙·사진 경로, L5 `PhotosPicker`·사진 턴, L7 사진 3종, L8 G10·G11, L9 D6, U10. Fable의 `recognize(fileURL:)`는 쓰지 않는다 — 공유·채팅 모두 `Data`로 받아(`loadDataRepresentation`·`loadTransferable`) 임시 파일을 만들 이유가 없다 |
| Fable 사용자 확인 2건 | (a) UQ1 문구 정정 후 A 유지 (b) 같은 링크 결과 문구 | 메인 판정 | MR1·MR2 |

## 자체 점검 (개정 뒤, 2026-10-02)

1. **스펙·사용자 결정 대비:** LD1(공유·채팅 둘 다) → L4·L5. LD2(기기 렌더링, 서버 URL 가져오기 없음, 기존 추출 경로) → L1~L5, 서버 무변경(Global Constraints), 이미지 전용 페이지는 D4(앱 OCR, 글 0자 포함). LD3(저장) → D3 + MR1(문구), 스펙 §12 문구(L0 Step 11). LD4(사진) → D13·LI1~LI5, 스펙 §6·§9·§12(L0). §15 후보의 "장소는 주소 그대로 일정 위치에" → D9·L6. "JS 렌더링 전용 페이지는 실패" → 방식 A로 해소. "링크 가져오기 계층은 여행 글 후보와 공유" → D12·L0 Step 12. 버전 → D10·L0 Step 10·14·L8 Step 1. 측정 창 → Global Constraints·L7 Step 4·L8 Step 1. 같은 링크 → MR2·D14·L2·L8 G12·L9 D3b.
2. **리뷰 대비:** 위 "리뷰 반영" 표 — Codex 9건·Fable C1~C9·F1~F12·LOW·이미지 입력 모두 반영 위치가 있다(부분 반영 3건은 이유를 적었다).
3. **자리표시 검사:** 코드 단계는 전부 실제 코드. 게이트 기록 행의 `<시각>`·`<sha>`·`<번호>`·`<날짜>`는 실행 때 채우는 값이다(계획 단계에서 알 수 없음). L8 하네스의 XCUITest 선택자는 실제 코드이고, 이 iOS에서 다르면 선택자만 고친다고 적었다(판정 기준은 고정).
4. **이름·타입 일관성:** `LinkText.linkCandidate`·`chatIntent`·`shareLink`·`check`·`upgraded`·`captureID(for:)`·`hasDateCandidate`·`compose`·`fit`·`keyHeader`(L1) ↔ `ImageText`(L1)·L2·L3·L4·L5 사용처, `ImageText.compose(ocr:images:note:)`·`appName`·`maxImages`(L1) ↔ L2 `ImageFlow`·L5, `PendingLink(url:note:origin:capturedAt:)`·`id`·`captureID`·`attempts`(L2) ↔ L4·L5·L8 GateHost, `CaptureQueue.enqueueLink`·`releaseLink`·`claimLinks`·`nextLinkAttempt`·`linkCount`·`markLinkSeen`·`isLinkSeen`·`linkMaxAge`·`linkSeenFor`(L2) ↔ L4·L5·L8, `CapturePipeline.handleRead`(L2) ↔ `LinkFlow.finish`·`ImageFlow.finish`, `LinkFlow.admit`·`share(_:renderer:queue:render:)`·`app(_:renderer:queue:)`·`Outcome`(`duplicate`·`retry` 포함)·`traceFields`·`code`(L2) ↔ L4·L5, `ImageFlow.finish`·`traceFields(_:origin:elapsedMs:images:)`·`code`(L2) ↔ L4·L5, `LinkRenderer(host:allowLoopback:html:)`·`blockedNavigations`·`extractAllowance`(L3) ↔ L4·L5·L3 테스트, `OCR.recognize(data:maxPixel:)`·`ShareImages.count`·`ocr`(L3) ↔ L4·L5, `LinkCaptureText.reading`·`imageReading`·`share`·`shareFallback`·`chat`·`image(_:chat:)`·`chatResult(status:gateLabel:kinds:subject:)`·`storageNote`·`duplicate`·`pending`·`tooMany`·`drainFailedTitle`·`drainFailedBody`(L2) ↔ L4·L5·L8 GateHost, `LinkCapture.startDrain`·`suspend`·`chatRead`·`chatImages`·`chatResult(captureID:subject:)`(L5) ↔ `EruriApp`·`ChatView`, `ProposalReview.place`(L6) ↔ `ScheduleCard`·`NotificationActions`. 접근성 id `chat-link-status`·`chat-link-note`·"첨부"·"사진에서 일정 읽기"(L5) ↔ L8, `share-link-status`·`share-link-note`·`share-link-close`(L4) ↔ L8 G8·G10·L9.
5. **Review Focus 대비:** 1 → L1 `testSettleDeadline`·L3 `testNeverSettlingPageReturnsPartial`. 2 → L3 `testStuckPageTimesOut`·`testCancelReturnsCancelled`·L4 `race`. 3 → L1 `testBodyPrefersHiddenTextWhenOnlyItHasDate`·L3 `testHiddenCoverTextIsRead`. 4 → L1 `testSettleEmptyPage`·L2 `testShareWithoutDateHandsOff`·`testShareEmptyPageHandsOff`·L3 `testImageOnlyPageUsesOCR`·L7 `wedding-ocr`·L8 G3. 5 → L1 `testLongTextWithURLIsNotALink`·L4 폴백. 6 → L1 `testComposeTruncatesAndKeepsKeyLinesFirst`·L7 `wedding-long`·`wedding-noisy`. 7 → L2 `testExtensionDeathHandsOffAfterLease`·`testReEnqueueSameLinkRefreshesLease`·`testAppRetryableFailureKeepsRow`·`testAppCancelledReleasesRow`·`testSameLinkIsDuplicate`·`testFinishTwiceKeepsOneCapture`·L8 G5·G5b·G12·L9 D3b. 8 → L3 `testAppSchemeNavigationIsBlockedAndPageStillRead`·`testPrivateSubresourcesAreBlocked`. 9 → L1 `testComposeKeepsHostOnly`·L2 `testQueryDigitsDoNotDiscard`·`testOTPNoteLeavesNoRow`. 10 → L1 `ImageTextTests`·L2 `testImageEmptyQueuesNothing`·L3 `OCRImageTests`·L8 G10·G11·L9 D6. 11 → L2 `testTraceFieldsHaveNoURLOrText`·`LinkCaptureTextTests.testReasonsCarryNoAddress`·L8 G9.
6. **남은 위험(계획이 감수):** 확장이 넣은 항목의 업로드는 다음 flush까지 늦을 수 있다(지금 공유와 같음, F3). 서버 규칙만의 폐기(`(광고)` 표기 — 204)는 채팅 턴에서 "아직 처리 중"으로 끝난다(항목이 생기지 않아 구분 불가, 드묾). 잠금화면 추가에는 위치가 없다(D9). 보관함에서 원래 링크를 다시 열 수 없다(UQ2). 사진은 같은 사진 판정을 하지 않는다(같은 사진을 두 번 공유하면 항목 두 개 — 서버 0.9.2 중복 일정 확인이 알림을 줄인다). 공개 이름이 사설 주소로 풀리는 페이지는 막지 않는다(브라우저와 같음). 멈춘 WebContent를 기다리던 JS 호출은 웹뷰가 풀릴 때까지 남는다(경주에서 버린다). 읽은 링크 기록은 30일이라 같은 청첩장이 고쳐져도 그 안에는 다시 읽지 않는다(채팅 문구가 제안 탭을 가리킨다). 한글 경로 주소는 링크로 보지 않는다(D5). 확장 메모리(U3·U10)와 대화 캡처 사진의 게이트 격리(U7)는 게이트가 판정한다.
