#!/bin/bash
# 업로드 버전 가드(계획 2026-10-06-mail-cleanup.md D17): 메일 정리 코드(새 연결·주간 재연결의 modify scope 요청 포함)가 있는데
# MARKETING_VERSION 이 0.14.0 전이면 멈춘다 — MAIL-sim 전 빌드가 0.13.x 이름으로 사용자 기기에 나가 주간 재연결이 곧 modify 재동의가 되지 않게.
# 의도한 예외(메인이 승인한 핫픽스 등)만 TF_ALLOW_PRE_MAIL=1
set -euo pipefail
cd "$(dirname "$0")/.."
VER=$(awk '/MARKETING_VERSION:/ {print $2; exit}' project.yml)
NUM=$(echo "$VER" | awk -F. '{print $1 * 1000000 + $2 * 1000 + $3}')
if [ -f Packages/EruriCore/Sources/EruriCore/MailCleanup.swift ] && [ "$NUM" -lt 14000 ] && [ "${TF_ALLOW_PRE_MAIL:-0}" != 1 ]; then
  echo "메일 정리 코드가 있는데 MARKETING_VERSION=$VER (< 0.14.0) — MAIL-sim 통과 전 업로드 금지(D17). 'feat(core): mail cleanup' 직전 커밋 worktree 에서 올리거나 TF_ALLOW_PRE_MAIL=1"
  exit 1
fi
# 0.15.0 계획 D20: 메일 요약 코드(.mailSummary 턴·intents 에 mail_summary)가 있는데 0.15.0 전 버전 이름이면 멈춘다 — SUMMARY-sim 전 빌드가 0.14.x 이름으로 나가지 않게.
# 0.14.0 업로드는 B14 worktree 에서(0.15.0 계획 D1). 의도한 예외(메인이 승인한 핫픽스 등)만 TF_ALLOW_PRE_SUMMARY=1
if [ -f Packages/EruriCore/Sources/EruriCore/MailSummary.swift ] && [ "$NUM" -lt 15000 ] && [ "${TF_ALLOW_PRE_SUMMARY:-0}" != 1 ]; then
  echo "메일 요약 코드가 있는데 MARKETING_VERSION=$VER (< 0.15.0) — SUMMARY-sim 통과 전 업로드 금지(0.15.0 계획 D20). B14 worktree 에서 올리거나 TF_ALLOW_PRE_SUMMARY=1"
  exit 1
fi
# 0.16.0 계획 K17: 일정 고치기 코드(.editEvent 턴·intents 에 edit_event)가 있는데 0.16.0 전 버전 이름이면 멈춘다 — EDIT-sim 전 빌드가 0.15.x 이름으로 나가지 않게.
# 0.15.0 업로드는 B15 worktree 에서(0.16.0 계획 K1). 의도한 예외(메인이 승인한 핫픽스 등)만 TF_ALLOW_PRE_EDIT=1
if [ -f Packages/EruriCore/Sources/EruriCore/ChatEdit.swift ] && [ "$NUM" -lt 16000 ] && [ "${TF_ALLOW_PRE_EDIT:-0}" != 1 ]; then
  echo "일정 고치기 코드가 있는데 MARKETING_VERSION=$VER (< 0.16.0) — EDIT-sim 통과 전 업로드 금지(0.16.0 계획 K17). B15 worktree 에서 올리거나 TF_ALLOW_PRE_EDIT=1"
  exit 1
fi
# 0.16.1: LLM 사용 불가 분기(ChatReply.llmUnavailable)가 있는데 0.16.1 전 이름이면 멈춘다 — 0.16.0 이름으로 다른 오류 동작이 나가지 않게
if grep -q "llm_unavailable" Packages/EruriCore/Sources/EruriCore/ChatReply.swift && [ "$NUM" -lt 16001 ] && [ "${TF_ALLOW_PRE_LLM:-0}" != 1 ]; then
  echo "LLM 사용 불가 코드가 있는데 MARKETING_VERSION=$VER (< 0.16.1) — 0.16.0 업로드는 이 코드 전 커밋 worktree 에서 하거나 TF_ALLOW_PRE_LLM=1"
  exit 1
fi
# 0.17.0 계획 K18: 저장 규칙·집계 코드(ChatAggregate·intents 에 aggregate·save_rule_*)가 있는데 0.17.0 전 이름이면 멈춘다 — AGG-sim 전 빌드가 0.16.x 이름으로 나가지 않게
if [ -f Packages/EruriCore/Sources/EruriCore/ChatAggregate.swift ] && [ "$NUM" -lt 17000 ] && [ "${TF_ALLOW_PRE_AGG:-0}" != 1 ]; then
  echo "저장 규칙·집계 코드가 있는데 MARKETING_VERSION=$VER (< 0.17.0) — AGG-sim 통과 전 업로드 금지(0.17.0 계획 K18). 이 코드 전 커밋 worktree 에서 올리거나 TF_ALLOW_PRE_AGG=1"
  exit 1
fi
# 0.18.0 계획 K22: 본문 건수 코드(ChatAggregate 의 body_total)가 있는데 0.18.0 전 이름이면 멈춘다 — METRIC-sim 전 빌드가 0.17.x 이름으로 나가지 않게
if grep -q "body_total" Packages/EruriCore/Sources/EruriCore/ChatAggregate.swift && [ "$NUM" -lt 18000 ] && [ "${TF_ALLOW_PRE_METRIC:-0}" != 1 ]; then
  echo "본문 건수 코드가 있는데 MARKETING_VERSION=$VER (< 0.18.0) — METRIC-sim 통과 전 업로드 금지(0.18.0 계획 K22). 162281f worktree 에서 올리거나 TF_ALLOW_PRE_METRIC=1"
  exit 1
fi
# 0.19.0 계획 DP20: 목록 요약 코드(MailDigest.swift)가 있는데 0.19.0 전 이름이면 멈춘다 — DIGEST 게이트 전 빌드가 0.18.x 이름으로 나가지 않게
if [ -f Packages/EruriCore/Sources/EruriCore/MailDigest.swift ] && [ "$NUM" -lt 19000 ] && [ "${TF_ALLOW_PRE_DIGEST:-0}" != 1 ]; then
  echo "목록 요약 코드가 있는데 MARKETING_VERSION=$VER (< 0.19.0) — DIGEST 게이트 통과 전 업로드 금지(0.19.0 계획 DP20). 이 코드 전 커밋 worktree 에서 올리거나 TF_ALLOW_PRE_DIGEST=1"
  exit 1
fi
echo "version-guard ok ($VER)"
