#!/bin/bash
# TestFlight 업로드: Release archive → export(destination=upload). 사용: scripts/testflight.sh [빌드 번호]
# 인증(기본): Admin 역할 App Store Connect API 키. keys/AuthKey_<KEY_ID>.p8 + keys/issuer-id(Issuer ID 한 줄)
#       + keys/key-id(쓸 키 ID 한 줄; .p8 이 하나뿐이면 생략 가능, TF_KEY_ID 로 덮어쓰기). keys/ 는 gitignore, 내용은 출력하지 않는다.
#       Xcode 계정 로그인이 필요 없다(09-29·30 계정 세션이 사라져 서명 실패 → Ruling K).
#       09-27 키 실패("Authentication failed")는 '앱 관리' 역할 키(M9LZ3WVVN9)라 인증서·프로파일 생성 권한이 없었던 탓. Admin 키를 쓴다.
# TF_AUTH=xcode: 예전 경로 — Xcode 에 로그인된 Apple 계정으로 -allowProvisioningUpdates.
# 멈출 오류: 키 파일 없음 / 인증 실패 → 키 역할 확인 / "No suitable application records were found" → App Store Connect 앱 레코드 필요
set -euo pipefail
cd "$(dirname "$0")/.."
BUILD=${1:-$(date +%Y%m%d%H%M)}
ARCHIVE=build/Eruri.xcarchive
AUTH=()
if [ "${TF_AUTH:-key}" = xcode ]; then
  echo "auth=xcode-account"
else
  KEY_ID=${TF_KEY_ID:-}
  [ -z "$KEY_ID" ] && [ -s keys/key-id ] && KEY_ID=$(tr -d '[:space:]' < keys/key-id)
  if [ -z "$KEY_ID" ]; then
    KEYS=(keys/AuthKey_*.p8)
    [ -e "${KEYS[0]}" ] || { echo "ASC API 키 없음: keys/AuthKey_<KEY_ID>.p8 (Admin 역할) 를 두거나 TF_AUTH=xcode"; exit 1; }
    [ ${#KEYS[@]} -eq 1 ] || { echo "keys/ 에 .p8 이 여러 개: keys/key-id 에 쓸 키 ID 를 적거나 TF_KEY_ID 지정"; exit 1; }
    KEY_ID=$(basename "${KEYS[0]}" .p8); KEY_ID=${KEY_ID#AuthKey_}
  fi
  KEY=keys/AuthKey_$KEY_ID.p8
  [ -s "$KEY" ] || { echo "ASC API 키 없음: $KEY"; exit 1; }
  [ -s keys/issuer-id ] || { echo "keys/issuer-id 없음 (App Store Connect → 사용자 및 액세스 → 통합 → 팀 키의 Issuer ID)"; exit 1; }
  AUTH=(-authenticationKeyPath "$PWD/$KEY" -authenticationKeyID "$KEY_ID" -authenticationKeyIssuerID "$(tr -d '[:space:]' < keys/issuer-id)")
  echo "auth=asc-api-key id=$KEY_ID"
fi

vm_stat | grep -E 'free|compressor'   # 아카이브는 시뮬레이터 빌드보다 무겁다. 한 번에 하나
./scripts/sim.sh config   # 매번 최신 supabase/.env 반영
# 호스트가 비면 업로드 기본값이 https:///functions/v1 → localhost 로 조용히 떨어진다. 그런 Release 는 올리지 않는다
grep -q '^ERURI_SUPABASE_HOST = [^[:space:]]' Config/Secrets.xcconfig || { echo "Supabase 설정 없음: supabase/.env 의 SUPABASE_URL 을 채운 뒤 다시"; exit 1; }
xcodegen generate >/dev/null
rm -rf "$ARCHIVE" build/export
mkdir -p build

echo "archive build=$BUILD"
if ! xcodebuild -project Eruri.xcodeproj -scheme Eruri -configuration Release \
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
echo "uploaded build=$BUILD version=$(grep MARKETING_VERSION project.yml | awk "{print \$2}") — App Store Connect 에서 Processing 후 TestFlight 에 나타난다"
