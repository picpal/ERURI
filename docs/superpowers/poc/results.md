# PoC 판정표

상태: **통과** = 계획서 판정 기준을 실측으로 충족 · **부분** = 코드 경로만 확인(디버그 훅·시뮬레이터 대체) · **실패** · **미검증**. 다음 단계 진입 조건은 해당 PoC 가 **통과**인 것이다. 실기기 필요 항목은 실기기 세션 후 갱신한다.

| PoC | 검증 대상 | 태스크 | 상태 | 근거 / 남은 실측 | 갱신일 |
|---|---|---|---|---|---|
| PoC-1 | 단축어 Notification 트리거 → CaptureIntent 자동 실행 | 4 | 미검증 | 실기기 필요. 절차 `poc-1-notification-trigger.md` | 2026-09-24 |
| PoC-2 | 단축어 Message 트리거 → CaptureIntent 자동 실행 | 4 | 미검증 | 실기기 필요. 절차 `poc-2-message-trigger.md` | 2026-09-24 |
| PoC-3 | Foundation Models 한국어 분류 200건 정확도·p95 | 5 | 부분 | 시뮬레이터 `availability()=available` 이나 `respond()` 는 "no underlying assets". 실기기 필요. 절차 `poc-3-fm-classifier.md` | 2026-09-24 |
| PoC-4 | Edge Function → APNs HTTP/2 | 9 | 미검증 | Supabase 프로젝트·.p8 필요 | 2026-09-24 |
| PoC-5 | 잠금화면 알림 액션 → 백그라운드 EventKit 멱등 쓰기 | 6 | 부분 | 멱등성은 시뮬레이터 실측 통과(콜드 스타트 2회, 이벤트 1건). 백그라운드/잠금 상태 쓰기는 실기기 필요. 절차 `poc-5-notification-eventkit.md` | 2026-09-24 |
| PoC-6 | Gmail watch → Pub/Sub → history 동기화 | 10 | 미검증 | GCP OAuth·Pub/Sub 필요 | 2026-09-24 |
| PoC-7 | 한국어 하이브리드 검색 Top-5 정확도 | 11 | 미검증 | Supabase·Voyage 키 필요 | 2026-09-24 |
| PoC-8 | 이미지·PDF → OCR/추출 → 일정 | 7, 12 | 부분 | 기기 부분(파일 영속화·OCR·큐 적재)은 시뮬레이터 실측 통과(디버그 훅 경유, 공유 시트 UI 자체는 미검증). 서버 부분은 Task 12. 절차 `poc-8-9-share-upload.md` | 2026-09-24 |
| PoC-9 | 앱 종료 후 background URLSession 업로드 완료 | 7 | 통과 | 호스트 `ps aux`로 앱 프로세스 완전 종료 확인(14:07:27.946) 후 3.68초 뒤 목 서버에 정확한 바이트 수로 도착(14:07:31.628) 실측. 절차 `poc-8-9-share-upload.md` | 2026-09-24 |
| PoC-10 | jobs 큐 lease/재시도/dead 처리 | 8 | 미검증 | Supabase 프로젝트 필요 | 2026-09-24 |

## 실기기 세션 대기 목록

PoC-1, PoC-2, PoC-3, PoC-5. 한 세션에서 순서대로 진행: 설치 → 권한 → 단축어 자동화 2개 → FM 벤치마크(⌘U) → 잠금 상태 푸시 액션.
