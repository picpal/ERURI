#!/usr/bin/env bash
# Supabase CLI 를 .env 파싱 문제(여러 줄/이스케이프된 APNS_P8) 없이 실행한다.
# 사용: poc/server/scripts/cli.sh db push --include-all | functions deploy worker | migration list --linked
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WD="$(mktemp -d "${TMPDIR:-/tmp}/sb-cli.XXXXXX")"
trap 'rm -rf "$WD"' EXIT
ln -s "$ROOT/supabase" "$WD/supabase"
grep -vE '^APNS_P8=' "$ROOT/.env" > "$WD/.env"
cd "$WD" && supabase "$@"
