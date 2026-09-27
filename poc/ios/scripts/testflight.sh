#!/bin/bash
# TestFlight 업로드: Release archive → export(destination=upload). 사용: scripts/testflight.sh [빌드 번호]
# 인증: 기본은 Xcode 에 로그인된 Apple 계정(-allowProvisioningUpdates). TF_AUTH=key 면 keys/AuthKey_<KEY_ID>.p8 +
#       keys/issuer-id(Issuer ID 한 줄)의 App Store Connect API 키. keys/ 는 gitignore, 내용은 출력하지 않는다.
#       09-27: API 키는 REST 조회(200)는 되지만 archive 의 자동 서명에서 "Authentication failed"(개발 프로파일 생성 거부)라 계정 방식으로 올렸다.
# 멈출 오류: 인증 실패 → ASC API 키 필요 / "No suitable application records were found" → App Store Connect 앱 레코드 필요
set -euo pipefail
cd "$(dirname "$0")/.."
BUILD=${1:-$(date +%Y%m%d%H%M)}
ARCHIVE=build/AssistantPoC.xcarchive
AUTH=()
KEY=""
[ "${TF_AUTH:-}" = key ] && KEY=$(ls keys/AuthKey_*.p8 2>/dev/null | head -1 || true)
if [ -n "$KEY" ]; then
  [ -s keys/issuer-id ] || { echo "keys/issuer-id 없음 (App Store Connect → 사용자 및 액세스 → 키의 Issuer ID)"; exit 1; }
  KEY_ID=$(basename "$KEY" .p8); KEY_ID=${KEY_ID#AuthKey_}
  AUTH=(-authenticationKeyPath "$PWD/$KEY" -authenticationKeyID "$KEY_ID" -authenticationKeyIssuerID "$(tr -d '[:space:]' < keys/issuer-id)")
  echo "auth=asc-api-key"
else
  echo "auth=xcode-account"
fi

vm_stat | grep -E 'free|compressor'   # 아카이브는 시뮬레이터 빌드보다 무겁다. 한 번에 하나
[ -f Config/Secrets.xcconfig ] || ./scripts/sim.sh config
xcodegen generate >/dev/null
rm -rf "$ARCHIVE" build/export
mkdir -p build

echo "archive build=$BUILD"
if ! xcodebuild -project AssistantPoC.xcodeproj -scheme AssistantPoC -configuration Release \
     -destination 'generic/platform=iOS' -archivePath "$ARCHIVE" -derivedDataPath build/archive-dd \
     -allowProvisioningUpdates ${AUTH[@]+"${AUTH[@]}"} CURRENT_PROJECT_VERSION="$BUILD" archive > build/archive.log 2>&1; then
  grep -E "error:|No Accounts|No profiles|requires a provisioning" build/archive.log | sort -u | head -20
  echo "ARCHIVE FAILED (build/archive.log)"; exit 1
fi
echo "archive ok"

if ! xcodebuild -exportArchive -archivePath "$ARCHIVE" -exportOptionsPlist scripts/ExportOptions.plist \
     -exportPath build/export -allowProvisioningUpdates ${AUTH[@]+"${AUTH[@]}"} > build/export.log 2>&1; then
  grep -E "error|No suitable application records|Authentication|credentials" build/export.log | sort -u | head -20
  echo "EXPORT/UPLOAD FAILED (build/export.log)"; exit 1
fi
grep -E "Upload succeeded|Uploaded|EXPORT SUCCEEDED" build/export.log | sort -u
echo "uploaded build=$BUILD version=0.1.0 — App Store Connect 에서 Processing 후 TestFlight 에 나타난다"
