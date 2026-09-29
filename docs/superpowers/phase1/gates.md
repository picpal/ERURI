# 1단계 실측 게이트 기록

AGENTS.md §5-8. 계획서 `docs/superpowers/plans/2026-09-30-phase1.md` 각 태스크의 "실측 게이트"를 재고 결과를 적는다.
상태: **통과** · **실패**(원인·조치) · **대기**(측정 전). "부분"(디버그 훅·시뮬레이터 대체·일부만 측정)은 마감 상태가 아니다.
흡수된 PoC(PoC-6 → M1-③, PoC-8 App Group 서명 → M1-②d)는 `docs/superpowers/poc/results.md` 해당 행도 같이 고친다.
본문·제목 원문은 적지 않는다(id·상태·수치만).

| 태스크 | 게이트 | 상태 | 근거(시각·id·수치) | 커밋 | 날짜 |
|---|---|---|---|---|---|
| M1-①a | 순수 테스트·타입 검사 통과, 베이스라인 PoC 대조 | 대기 | `deno check` functions 6·scripts 7·eval 3·tests 전부 오류 0. 순수 테스트(`_testenv` 미import 13파일) 85 통과·1 ignored(jev live), env 로드 필요 3파일(apns·extract·extract-text)은 더미 env(비밀 아님)로 36 통과·live APNs 1건만 실패(실키 필요 → ①b). trace 순수 9/9. `0001_baseline.sql` 의 `'poc'`·`poc_traces` 는 머리 주석 2줄(제외·변경 설명)뿐, SQL 문장(`--` 주석 제외)에는 0건. PoC 카탈로그 대조는 M1-①b Step 6 | | 2026-09-30 |
