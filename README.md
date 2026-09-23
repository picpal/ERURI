# ERURI — iOS 개인 비서

메일·문자·앱 알림·공유한 이미지/URL/PDF·사용자 발화를 모아 일정·할 일·구매 사실을 추출하고, 잠금화면에서 확인 후 캘린더·미리알림에 등록하며, 출처와 함께 질문에 답하는 iPhone 앱.

## 문서

| 문서 | 경로 |
|---|---|
| 초기 구상 (브레인스토밍 입력) | `docs/superpowers/specs/2026-09-22-initial-brief.md` |
| 설계 스펙 (단일 원본) | `docs/superpowers/specs/2026-09-22-assistant-design.md` |
| 아키텍처 리포트 (HTML) | `docs/superpowers/reports/2026-09-23-architecture-report.html` |
| 0단계 PoC 계획 | `docs/superpowers/plans/2026-09-23-phase0-poc.md` |
| 에이전트 작업 규칙 | `AGENTS.md` |

## 구조

- `poc/ios/` — 0단계 PoC iOS 프로젝트 (xcodegen, Swift 6, iOS 26)
- `poc/server/` — Supabase 마이그레이션·Edge Functions (Task 8 이후)
