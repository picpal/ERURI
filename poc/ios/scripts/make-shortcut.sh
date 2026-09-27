#!/usr/bin/env bash
# "ERURI에 저장" 단축어 파일을 Mac 에서 생성·서명한다.
# Mac 단축어 앱에는 iOS 전용 앱 인텐트가 안 보이므로 plist 를 직접 만든다.
# 구조 근거: 이 Mac 의 ~/Library/Shortcuts/Shortcuts.sqlite 에 저장된 서드파티 App Intents 액션
#   - WFWorkflowActionIdentifier = "<bundle-id>.<IntentType>"
#   - 파라미터 키 = Swift 프로퍼티명, AppIntentDescriptor 에 팀·번들·인텐트 식별자
#   - 단축어 입력 = WFTextTokenString + attachmentsByRange {Type: ExtensionInput}
# 사용: poc/ios/scripts/make-shortcut.sh [출력 경로]  (기본 ~/Desktop/ERURI에 저장.shortcut)
set -euo pipefail

cd "$(dirname "$0")/.."
NAME="ERURI에 저장"
PLIST="shortcuts/${NAME}.plist"
OUT="${1:-$HOME/Desktop/${NAME}.shortcut}"
mkdir -p shortcuts

python3 - "$PLIST" <<'EOF'
import plistlib, sys
BUNDLE = "com.picpal.assistant.poc"
action = {
    "WFWorkflowActionIdentifier": f"{BUNDLE}.CaptureIntent",
    "WFWorkflowActionParameters": {
        "UUID": "5E7A1C2B-4D3F-4A8E-9B61-0C2D3E4F5A6B",
        "AppIntentDescriptor": {
            "TeamIdentifier": "6626BYCJG4",
            "BundleIdentifier": BUNDLE,
            "Name": "ERURI PoC",
            "AppIntentIdentifier": "CaptureIntent",
        },
        # 본문 ← 단축어 입력
        "text": {
            "WFSerializationType": "WFTextTokenString",
            "Value": {"string": "￼", "attachmentsByRange": {"{0, 1}": {"Type": "ExtensionInput"}}},
        },
        "source": "NOTIFICATION",
        "ShowWhenRun": False,
    },
}
wf = {
    "WFWorkflowActions": [action],
    "WFWorkflowClientVersion": "4610",
    "WFWorkflowMinimumClientVersion": 900,
    "WFWorkflowMinimumClientVersionString": "900",
    "WFWorkflowIcon": {"WFWorkflowIconStartColor": 4282601983, "WFWorkflowIconGlyphNumber": 61440},
    "WFWorkflowImportQuestions": [],
    # 입력 클래스: 텍스트 계열. WFWorkflowNoInputBehavior 를 두지 않으면 입력이 없을 때 "계속하기"
    "WFWorkflowInputContentItemClasses": ["WFStringContentItem", "WFRichTextContentItem", "WFURLContentItem"],
    "WFWorkflowHasShortcutInputVariables": True,
    "WFWorkflowOutputContentItemClasses": [],
    "WFWorkflowHasOutputFallback": False,
    "WFWorkflowTypes": [],
    "WFQuickActionSurfaces": [],
}
with open(sys.argv[1], "wb") as f:
    plistlib.dump(wf, f, fmt=plistlib.FMT_XML)
EOF
plutil -lint "$PLIST"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cp "$PLIST" "$TMP/unsigned.shortcut"
plutil -convert binary1 "$TMP/unsigned.shortcut"
shortcuts sign --mode anyone --input "$TMP/unsigned.shortcut" --output "$OUT"
echo "signed: $OUT ($(stat -f%z "$OUT") bytes)"
