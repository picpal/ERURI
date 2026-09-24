#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
UDID=$(cat .sim-udid 2>/dev/null || true)   # gen 은 기기 없이도 동작
DEST="platform=iOS Simulator,id=$UDID"
case "${1:-}" in
  boot)  xcrun simctl boot "$UDID" 2>/dev/null || true; open -a Simulator ;;
  gen)   xcodegen generate ;;
  build) xcodebuild -project AssistantPoC.xcodeproj -scheme AssistantPoC -destination "$DEST" -derivedDataPath build build 2>&1 | tail -20 ;;
  test)  xcodebuild -project AssistantPoC.xcodeproj -scheme AssistantPoC -destination "$DEST" -derivedDataPath build test ${2:+-only-testing:"$2"} 2>&1 | grep -E "Test Case|passed|failed|error:" ;;
  uitest) xcodebuild -project AssistantPoC.xcodeproj -scheme AssistantPoCUI -destination "$DEST" -derivedDataPath build test ${2:+-only-testing:"$2"} 2>&1 | grep -E "Test Case|passed|failed|error:|POC_UI" ;;
  log)   cat "$(xcrun simctl get_app_container "$UDID" com.picpal.assistant.poc group.com.picpal.assistant)/poc.log" | tail -${2:-40} ;;
  install) xcrun simctl install "$UDID" build/Build/Products/Debug-iphonesimulator/AssistantPoC.app ;;
  launch) xcrun simctl launch "$UDID" com.picpal.assistant.poc ;;
  *) echo "usage: sim.sh {boot|gen|build|test [id]|uitest [id]|log [n]|install|launch}"; exit 1 ;;
esac
