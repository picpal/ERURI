#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
UDID=$(cat .sim-udid 2>/dev/null || true)
DEST="platform=iOS Simulator,id=$UDID"
ENVF=../supabase/.env
# .env 를 셸로 읽지 않는다(source 금지). 한 값만 꺼낸다. 키가 없으면 빈 값
# 공백 뒤 # 는 인라인 주석으로 버리고 앞뒤 공백을 자른다(값 없이 주석만 있는 줄이 값으로 들어가 URL 스킴이 깨졌다, 09-30)
v() { [ -f "$ENVF" ] || return 0; { grep "^$1=" "$ENVF" || true; } | head -1 | cut -d= -f2- | sed -E -e 's/[[:space:]]+#.*$//' -e 's/^[[:space:]]+//' -e 's/[[:space:]]+$//' -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"; }
case "${1:-}" in
  boot)  xcrun simctl boot "$UDID" 2>/dev/null || true; open -a Simulator ;;
  # 앱에 넣을 공개 값만(iOS 클라이언트 ID·Web 클라이언트 ID·Supabase 호스트·publishable 키). service role·비밀번호는 넣지 않는다
  config)
    mkdir -p Config
    cid=$(v GOOGLE_CLIENT_ID); url=$(v SUPABASE_URL); url=${url%/}
    # 앱은 https://<호스트> 로 붙인다. 다른 스킴이면 호스트를 비워 testflight.sh 의 빈 호스트 검사에 걸리게 한다
    case "$url" in https://*) url=${url#https://} ;; *) [ -n "$url" ] && echo "SUPABASE_URL 이 https:// 로 시작하지 않음 — 호스트를 비움" >&2; url= ;; esac
    { echo "// sim.sh config 가 supabase/.env 에서 만든다. 커밋하지 않는다"
      echo "GID_CLIENT_ID = $cid"
      # GOOGLE_CLIENT_ID 는 M1-③b(U8)에서 채운다. 그 전엔 빈 URL 스킴이 업로드 검증(RFC1738)에서 떨어지므로 자리표시 스킴을 넣는다
      echo "GID_REVERSED_CLIENT_ID = $([ -n "$cid" ] && echo "com.googleusercontent.apps.${cid%.apps.googleusercontent.com}" || echo com.picpal.eruri.gid-unset)"
      echo "GID_SERVER_CLIENT_ID = $(v GOOGLE_WEB_CLIENT_ID)"
      echo "ERURI_SUPABASE_HOST = $url"
      echo "ERURI_SUPABASE_ANON_KEY = $(v SUPABASE_ANON_KEY)"
    } > Config/Secrets.xcconfig
    echo "wrote Config/Secrets.xcconfig (gid=$([ -n "$cid" ] && echo set || echo empty))" ;;
  gen)   "$0" config >/dev/null; xcodegen generate ;;
  build) xcodebuild -project Eruri.xcodeproj -scheme Eruri -destination "$DEST" -derivedDataPath build build 2>&1 | tail -20 ;;
  test)  xcodebuild -project Eruri.xcodeproj -scheme Eruri -destination "$DEST" -derivedDataPath build test ${2:+-only-testing:"$2"} 2>&1 | grep -E "Test Case|passed|failed|error:" ;;
  log)   tail -${2:-40} "$(xcrun simctl get_app_container "$UDID" com.picpal.eruri group.com.picpal.eruri)/eruri.log" ;;
  install) xcrun simctl install "$UDID" build/Build/Products/Debug-iphonesimulator/Eruri.app ;;
  launch) xcrun simctl launch "$UDID" com.picpal.eruri "${@:2}" ;;
  *) echo "usage: sim.sh {boot|config|gen|build|test [id]|log [n]|install|launch}"; exit 1 ;;
esac
