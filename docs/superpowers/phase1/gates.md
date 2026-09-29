# 1단계 실측 게이트 기록

AGENTS.md §5-8. 계획서 `docs/superpowers/plans/2026-09-30-phase1.md` 각 태스크의 "실측 게이트"를 재고 결과를 적는다.
상태: **통과** · **실패**(원인·조치) · **대기**(측정 전). "부분"(디버그 훅·시뮬레이터 대체·일부만 측정)은 마감 상태가 아니다.
흡수된 PoC(PoC-6 → M1-③, PoC-8 App Group 서명 → M1-②d)는 `docs/superpowers/poc/results.md` 해당 행도 같이 고친다.
본문·제목 원문은 적지 않는다(id·상태·수치만).

| 태스크 | 게이트 | 상태 | 근거(시각·id·수치) | 커밋 | 날짜 |
|---|---|---|---|---|---|
| M1-①a | 순수 테스트·타입 검사 통과, 베이스라인 PoC 대조 | 통과 | `deno check` functions 6·scripts 7·eval 3·tests 전부 오류 0. 순수 테스트(`_testenv` 미import 13파일) 85 통과·1 ignored(jev live). env 로드가 필요한 3파일(apns 12·extract 15·extract-text 10)은 ①b에서 실 env로 37/37 통과(live sandbox APNs 400 BadDeviceToken 포함). trace 순수 9/9. `grep -v '^--' 0001_baseline.sql | grep "'poc'\|poc_traces"` 0건(머리 주석 2줄 제외). PoC 카탈로그 대조(①b Step 6, `catalog.ts` 컬럼 107·함수 31·인덱스 27·정책 16·cron 4·트리거 1·버킷 1): 차이 = 예정된 3종뿐(`poc_traces`↔`device_traces` 열·정책·인덱스, 버킷 `poc`↔`media`, cron `device-traces-30d` 추가) | d3a3239 | 2026-09-30 |
| M1-①b | 합성 ingest → worker → extracted → proposal_pushes | 통과 | 프로젝트 `eruri` ref `jsqaunqnhlnrmftvfxwy`(ap-northeast-2, 무료). 0001~0003 push, vault 2건, secrets 13(APNS_P8 digest = 파일 sha256), 함수 6 배포, worker 무인증 403. 전체 deno 테스트 186 통과·0 실패·1 ignored(jev live). `smoke-gate.ts`: device 200·ingest 202, item `ca516be8-44f6-4d40-be2d-b93023f7ce69` extracted, proposal `e2708309-ed13-408b-9f47-e2cf6eee0fc9`, push rejected 400 BadDeviceToken, 경과 71s. 정리 후 잔여 행 0 | fd297d0 | 2026-09-30 |
| M1-②a | EruriCore 승격·골격, 시뮬레이터 테스트 | 통과 | 시뮬레이터 `Eruri-M1`(iPhone 17 Pro, iOS 26.3) `EruriCoreTests` 118 실행 · 116 passed · 0 failed · 2 skipped(FMClassifier 벤치·unavailable — 시뮬레이터에 FM 모델 에셋 없음, PoC 와 동일) `** TEST SUCCEEDED **`. 신규 `DiagnosticsTests` 3·`testProductAppGroup`·`testPipelineEnqueueReturnsQueueID` 통과(구현 전 컴파일 실패 확인). `grep -rn "assistant\.poc\|--poc-\|poc[0-9]\." ios/App ios/ShareExtension ios/Packages/EruriCore` 출력 없음 | | 2026-09-30 |
| M1-②b | executions 보고 RPC·제안 version, worker 재배포 회귀 | 통과 | 0004 push(호스팅 `eruri`). `executions-db.test.ts` 2/2 통과(ok 재전송 멱등·executions 1행·proposal succeeded/EK id, version 불일치 changed, stale, 남의 제안·없는 id not_found, anon 호출 거부·행 0, `worker_get_proposal.version` = 1). 전체 deno 테스트 189 통과·0 실패·1 ignored(jev live). worker 재배포 후 `smoke-gate.ts` `gate: pass` — device 200·ingest 202, item `b5adc9f9-b3c7-4bbc-9e57-4c005982767c` extracted, proposal `b504a8d7-0afa-4a0f-910a-c554f0422a76`, push rejected 400 BadDeviceToken, 경과 81s. 정리 후 잔여 행 0 | | 2026-09-30 |
