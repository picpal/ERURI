# 네이버 예약 "신청"을 ERURI가 할 수 있는가 — 조사 (2026-10-01)

표기: ✅ 확인(출처 있음) · ⚠️ 미확인(공식 문서로 확인 못 함).

## 결론

**대신 신청: 불가. 우회: 예약 화면까지 열어 주기만 가능.**

| 방식 | 판정 | 이유 |
|---|---|---|
| 공개 API로 소비자 대신 예약 생성 | **불가** | 네이버 개발자센터 오픈 API 목록에 예약 생성 API 없음 ⚠️(목록 재확인 필요). 스마트플레이스·네이버 예약은 사업자용 관리 도구이고, 외부 연동 API를 일반 개발자에게 열지 않는다는 자료뿐 ✅(출처 ③④) |
| 파트너/제휴 API | **현실적으로 불가** | 제휴사(예약 솔루션 업체) 연동이 있다 해도 사업자 측 재고·예약 관리용으로 보이며, 개인 앱이 소비자 대리 예약용으로 받을 경로 없음 ⚠️ |
| 딥링크/URL로 예약 화면 열기 | **가능(화면까지)** | 아래 형식 |
| 스크래핑·브라우저 자동 조작 | **하지 않음** | 약관·실용 문제(아래) |

## 딥링크·URL

- **네이버 지도 URL 스킴** `nmap://` ✅(출처 ①, NAVER Cloud 공식): 액션은 `map`·`search`·`search/bus`·`place`(좌표+이름 마커)·`route/*`. **업체 ID로 장소 상세나 예약 페이지를 여는 액션은 없다** ✅. `appname` 필수, iOS는 `LSApplicationQueriesSchemes`에 `nmap` 추가.
  - 예: `nmap://search?query=%EB%AF%B8%EC%9A%A9%EC%8B%A4%20%EA%B0%95%EB%82%A8&appname=com.picpal.eruri` → 검색 결과에서 사용자가 업체 → "예약" 탭.
- **웹 URL(유니버설 링크)** ⚠️(비공식, 관찰된 형식):
  - 예약 페이지: `https://m.booking.naver.com/booking/<업종ID>/bizes/<업체ID>` — 업종·업체 ID는 공개 규격이 아니라 바뀔 수 있다.
  - 장소 상세: `https://m.place.naver.com/place/<placeId>` (예약 탭은 상세 안에 있음).
  - 내 예약 목록: `https://m.booking.naver.com/my/bookings` ✅(출처 ②).
  - 네이버 앱이 있으면 유니버설 링크로 앱이 열릴 수 있으나, 실기기에서 확인 필요 ⚠️.
- ERURI가 업체 ID를 얻는 방법이 문제다: 수집한 예약 문자·메일에 예약 페이지 링크가 들어 있으면 그 URL을 그대로 쓰는 것이 가장 확실하다. ID를 검색으로 알아내려면 네이버 검색 API(지역)인데, 이 API는 placeId·예약 URL을 주지 않는다 ⚠️.

## 자동화(스크래핑·브라우저 조작)

- 약관: 네이버 이용약관은 자동화된 수단에 의한 무단 수집·이용을 금지한다 ✅(출처 ⑤). 로그인 세션으로 예약 버튼을 대신 누르는 것도 같은 범주로 봐야 한다.
- 실용: 로그인·2단계 인증·캡차·결제(예약금)·화면 구조 변경에 매번 깨진다. 서버에서 하려면 사용자의 네이버 세션을 서버가 보관해야 해 §12 개인정보 통제와 정면 충돌.
- 따라서 제품 기능으로 넣지 않는다.

## ERURI에 넣는다면 — 최소 형태

채팅이나 제안에서 "예약하고 싶다"는 의도가 나오면 ERURI는 **예약을 만들지 않고 예약 화면을 연다**. 우선순위는 ① 수집한 문자·메일 안의 네이버 예약/플레이스 링크(같은 업체 재예약) → ② 업체 이름으로 `nmap://search?query=<업체>` → ③ 지도 앱이 없으면 `https://m.search.naver.com/search.naver?query=<업체>` 웹. 예약 완료는 사용자가 네이버 화면에서 하고, 그 뒤 오는 확정 문자·알림톡·메일을 기존 수집 경로(§5·§7)가 받아 일정 제안을 만든다 — 신청은 네이버, 기록·알림은 ERURI. 서버·LLM 변경 없이 앱의 링크 열기 버튼 하나로 끝나며, 스펙에 넣는 것은 사용자 결정 뒤다.

## 출처

- ① NAVER Cloud, 지도 URL Scheme — https://guide.ncloud-docs.com/docs/maps-url-scheme
- ② Nomad eSIM, How to make reservations on Naver — https://www.nomadesim.com/destination-guides/how-to-make-reservations-on-naver
- ③ 스토어아트 매거진, 네이버 플레이스 예약 달력 연동 — https://www.storeartmagazine.com/news/articleView.html?idxno=834
- ④ NAVER WORKS 개발자 포럼, 캘린더 네이버 예약센터와 연동 — https://forum.worksmobile.com/kr/posts/100178?cno=2
- ⑤ 이노포레스트, AI시대의 데이터 크롤링 법률적 쟁점 — https://www.innoforest.co.kr/report/347/
