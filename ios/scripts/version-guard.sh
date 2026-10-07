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
echo "version-guard ok ($VER)"
