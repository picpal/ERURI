#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
UDID=$(cat .sim-udid 2>/dev/null || true)   # gen 은 기기 없이도 동작
DEST="platform=iOS Simulator,id=$UDID"
case "${1:-}" in
  boot)  xcrun simctl boot "$UDID" 2>/dev/null || true; open -a Simulator ;;
  # PoC-6: poc/server/.env 에서 앱에 넣을 공개 값만 골라 Config/Secrets.xcconfig 를 만든다(service role·secret·비밀번호는 넣지 않는다)
  config)
    set -a; . ../server/.env; set +a
    mkdir -p Config
    { echo "// sim.sh config 가 생성. 커밋하지 않는다"
      echo "GID_CLIENT_ID = $GOOGLE_CLIENT_ID"
      echo "GID_REVERSED_CLIENT_ID = com.googleusercontent.apps.${GOOGLE_CLIENT_ID%.apps.googleusercontent.com}"
      echo "GID_SERVER_CLIENT_ID = $GOOGLE_WEB_CLIENT_ID"
      echo "POC_SUPABASE_HOST = ${SUPABASE_URL#https://}"   # xcconfig 에서 // 는 주석이라 호스트만 둔다
      echo "POC_SUPABASE_ANON_KEY = $SUPABASE_ANON_KEY"
    } > Config/Secrets.xcconfig
    echo "wrote Config/Secrets.xcconfig" ;;
  gen)   [ -f Config/Secrets.xcconfig ] || "$0" config; xcodegen generate ;;
  build) xcodebuild -project AssistantPoC.xcodeproj -scheme AssistantPoC -destination "$DEST" -derivedDataPath build build 2>&1 | tail -20 ;;
  test)  xcodebuild -project AssistantPoC.xcodeproj -scheme AssistantPoC -destination "$DEST" -derivedDataPath build test ${2:+-only-testing:"$2"} 2>&1 | grep -E "Test Case|passed|failed|error:" ;;
  uitest) xcodebuild -project AssistantPoC.xcodeproj -scheme AssistantPoCUI -destination "$DEST" -derivedDataPath build test ${2:+-only-testing:"$2"} 2>&1 | grep -E "Test Case|passed|failed|error:|POC_UI" ;;
  log)   cat "$(xcrun simctl get_app_container "$UDID" com.picpal.assistant.poc group.com.picpal.assistant)/poc.log" | tail -${2:-40} ;;
  install) xcrun simctl install "$UDID" build/Build/Products/Debug-iphonesimulator/AssistantPoC.app ;;
  launch) xcrun simctl launch "$UDID" com.picpal.assistant.poc "${@:2}" ;;
  # PoC-6: 비밀번호는 앱 코드에 넣지 않고 launch argument 로만 넘긴다. 출력하지 않는다
  gmail) PW=$(grep '^POC_USER_PASSWORD=' ../server/.env | cut -d= -f2-)
         xcrun simctl terminate "$UDID" com.picpal.assistant.poc 2>/dev/null || true
         xcrun simctl launch "$UDID" com.picpal.assistant.poc "--poc-user-password=$PW" "${@:2}" >/dev/null && echo launched ;;
  *) echo "usage: sim.sh {boot|config|gen|build|test [id]|uitest [id]|log [n]|install|launch [args]|gmail [--poc-gmail-connect[=consent]]}"; exit 1 ;;
esac
