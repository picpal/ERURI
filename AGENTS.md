# AGENTS.md — 이 저장소에서 에이전트가 일하는 방식

Claude Code는 `CLAUDE.md`의 `@AGENTS.md`로, Codex는 이 파일을 직접 읽는다. 사람과 에이전트 모두에게 적용된다.

## 1. 문서 위치

| 문서 | 경로 |
|---|---|
| 설계 스펙 (단일 원본) | `docs/superpowers/specs/2026-09-22-assistant-design.md` |
| 0단계 PoC 계획 | `docs/superpowers/plans/2026-09-23-phase0-poc.md` |
| 아키텍처 리포트 | `docs/superpowers/reports/2026-09-23-architecture-report.html` |
| PoC 판정표 | `docs/superpowers/poc/results.md` (Task 13에서 생성) |
| 에이전트 지시문·세션 상태 | `.context/` (gitignore) |

스펙과 코드가 다르면 스펙을 먼저 고친다. 스펙에 없는 기능은 만들지 않는다.

## 2. 메인 에이전트는 조율만 한다

메인 세션의 컨텍스트를 아끼기 위해 **간단한 작업 외에는 별도 pane의 서브 에이전트에 위임**한다.

| 메인에서 직접 | 서브 에이전트로 위임 |
|---|---|
| 한두 줄 편집, 커밋, 짧은 질문 답변, 결과 요약 | 파일 여러 개 읽기, 빌드·테스트, 검증 스크립트, 리서치, 태스크 구현, 리뷰 |

위임 절차 (herdr):

```bash
herdr pane split --current --direction right --cwd "$PWD" --no-focus      # → .result.pane.pane_id
herdr agent start <name> --kind claude --pane <id> -- --model <alias> --effort <level>
# 지시문은 반드시 파일로: .context/<task>.prompt.md
herdr agent prompt <name> "Read .context/<task>.prompt.md in this repo and follow it exactly. Report in Korean." --wait --timeout <ms>
herdr agent read <name> --source recent-unwrapped --lines 300              # 결과 회수
herdr pane close <id>                                                       # 작업 끝나면 반드시 닫기
```

- 긴 프롬프트를 `agent prompt`에 직접 넣지 않는다. 입력이 유실된 적이 있다. 항상 파일 + 한 줄 지시.
- 신뢰 확인 대화상자가 뜨면 이 저장소는 사용자 소유이므로 "Yes, I trust this folder"를 선택한다.
- 서브 에이전트의 마지막 메시지는 **15줄 이내 한국어 요약**으로 끝내게 지시한다. 메인은 그 요약만 가져온다.
- 동시에 여러 pane을 띄울 때는 pane마다 다른 파일·디렉터리를 맡긴다. 같은 파일을 두 pane이 편집하지 않는다.
- 시뮬레이터를 쓰는 pane은 각자 전용 UDID를 만든다. 다른 pane의 기기를 만지지 않는다.

## 3. 모델 선택 — 역할·규모·범위에 맞춘다

`--model` 별칭: `opus`, `sonnet`, `haiku`. `--effort`: `low` `medium` `high` `xhigh` `max`.

| 작업 유형 | 모델 | effort | 이유 |
|---|---|---|---|
| 아키텍처 판단, 스펙 수정, 리스크 분석, 설계 리뷰 | `opus` | `high`~`xhigh` | 트레이드오프 추론이 결과를 좌우 |
| 태스크 구현 (TDD, Swift/TS 코드, 마이그레이션) | `sonnet` | `high` | 계획서에 코드가 이미 있어 정확한 실행이 핵심 |
| PoC 실기기·시뮬레이터 시나리오 실행과 기록 | `sonnet` | `medium` | 절차 수행 + 관찰 기록 |
| 검증 스크립트 실행, 린트 위반 수정, 포맷 정리 | `sonnet` | `medium` | 도구 출력 따라 고치는 반복 작업 |
| 문서 검색·요약, 공식 문서 확인, 파일 탐색 | `haiku` | `low`~`medium` | 읽기 위주, 판단 적음 |
| 커밋 메시지, 테이블 정리, 단순 변환 | `haiku` | `low` | 비용 최소 |
| 외부 2차 의견 | Codex `gpt-6-astra` | `medium` | 다른 모델 계열의 독립 리뷰 |

규칙:
- 헷갈리면 한 단계 위 모델. 결과가 틀리면 되돌리는 비용이 모델 비용보다 크다.
- 한 pane 안에서 판단과 실행이 섞이면(예: "설계 결정 후 구현") `opus`로 통일한다.
- 실기기 세션처럼 사람이 옆에서 조작해야 하는 작업은 `sonnet` + `medium`. 대기 시간이 길고 추론이 적다.
- 위 표를 바꾸면 이 파일을 고친다. 개별 프롬프트에서 즉흥적으로 다른 모델을 고르지 않는다.

## 4. Codex 리뷰 (스펙·계획·PR)

```bash
herdr agent start codex-reviewer --kind codex --pane <id> -- -m gpt-6-astra -s read-only -c 'model_reasoning_effort="medium"'
# 자체 업데이트로 종료되면 같은 pane에서 다시 start
herdr agent prompt codex-reviewer "Read .context/codex-review-N.prompt.md and follow it. Answer in Korean." --wait --timeout 600000
```

- 지시문 파일에 검토 범위·심각도 태그(HIGH/MED/LOW)·"먼저 바꿀 3가지"를 요구한다.
- 리뷰 결과는 스펙 §16 "외부 리뷰 반영"에 번호별 반영/미반영을 적는다.
- Codex 세션 ID는 `.context/codex-session-id`에 둔다.

## 5. 워크플로 순서 (아키텍처급 작업)

1. 브레인스토밍으로 요구 확정
2. 전제를 공식 문서로 검증 (병렬 서브 에이전트, `haiku`/`sonnet`)
3. 스펙 작성·커밋
4. Codex 리뷰 → 반영
5. 구현 계획 작성 (`writing-plans`)
6. 기능 단위 PoC로 실현 가능성 판정 후 제작
7. 태스크별 서브 에이전트 구현 + 리뷰

## 6. 이 기계의 제약

- 24GB, 스왑 상시 포화. 빌드·시뮬레이터·`npm install` 전에 `vm_stat | grep -E 'free|compressor'` 확인.
- Docker를 띄우지 않는다. Supabase는 호스팅 프로젝트를 쓴다.
- 시뮬레이터 빌드와 deno 테스트를 동시에 돌리지 않는다.
- 유휴 `claude` 세션을 일괄 종료할 땐 `$$` 부모 계보로 자기 pid를 제외한다.

## 7. 개인정보 규칙 (개발 중에도 적용)

- 대시보드 SQL 편집기나 로그로 `items.content_enc`를 복호화해 보지 않는다. 디버깅은 `item_id`·상태·오류 코드로만.
- 테스트 데이터는 합성 문구를 쓴다. 실제 메일·문자 원문을 픽스처에 넣지 않는다.
- `.env`, `.context/`, `poc/ios/.sim-udid`, `poc/server/eval/images/`는 커밋하지 않는다.
- 비밀값은 `.env`와 `supabase secrets`에만. 코드·프롬프트 파일·커밋 메시지에 넣지 않는다.
