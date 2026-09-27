#!/usr/bin/env bash
# "ERURI에 저장" 단축어 파일을 Mac 에서 생성·서명한다.
# Mac 단축어 앱에는 iOS 전용 앱 인텐트가 안 보이므로 plist 를 직접 만든다.
# 구조 근거: 이 Mac 의 ~/Library/Shortcuts/Shortcuts.sqlite 에 저장된 서드파티 App Intents 액션
#   - WFWorkflowActionIdentifier = "<bundle-id>.<IntentType>"
#   - 파라미터 키 = Swift 프로퍼티명, AppIntentDescriptor 에 팀·번들·인텐트 식별자
#   - 단축어 입력 = WFTextTokenString + attachmentsByRange {Type: ExtensionInput}
# v2 근거(2026-09-28 실측: v1 을 메시지 자동화가 실행하면 text_len=0):
#   - 메시지 자동화 입력은 WFMessageContentItem. v1 의 입력 클래스(문자열·리치텍스트·URL)에 없어 걸러졌을 수 있다
#   - 속성 추출 = Aggrandizements [WFCoercionVariableAggrandizement(WFMessageContentItem), WFPropertyVariableAggrandizement]
#   - 속성 영문 내부명 후보: ContentKit Localizable.loctable 의 "Content"(콘텐츠)·"Body"(본문)·"Sender"(보낸 사람)
# 사용: poc/ios/scripts/make-shortcut.sh [--variant v1|v2|v2-b|v2-alt] [출력 경로]
#   v1     단축어 입력 → 본문 (기존, source=NOTIFICATION)
#   v2     단축어 입력.Content → 본문, .Sender → 발신자 (source=MESSAGES)
#   v2-b   단축어 입력.Body → 본문, .Sender → 발신자 (source=MESSAGES)
#   v2-alt 입력에서 텍스트 가져오기(detect.text) → 본문 (속성명 의존 없음, source=MESSAGES)
#   기본 출력: v1 → ~/Desktop/ERURI에 저장.shortcut, 그 외 → ~/Desktop/ERURI에 저장 <variant>.shortcut
set -euo pipefail

VARIANT=v1
if [[ "${1:-}" == "--variant" ]]; then VARIANT="${2:?variant 필요}"; shift 2; fi
case "$VARIANT" in v1|v2|v2-b|v2-alt) ;; *) echo "unknown variant: $VARIANT" >&2; exit 2 ;; esac

cd "$(dirname "$0")/.."
NAME="ERURI에 저장"
[[ "$VARIANT" == v1 ]] && FILE="$NAME" || FILE="$NAME $VARIANT"
PLIST="shortcuts/${FILE}.plist"
OUT="${1:-$HOME/Desktop/${FILE}.shortcut}"
mkdir -p shortcuts

python3 - "$PLIST" "$VARIANT" <<'EOF'
import plistlib, sys
BUNDLE = "com.picpal.assistant.poc"
variant = sys.argv[2]
DETECT_UUID = "8C1F2A3B-6D4E-4F7A-8B9C-1D2E3F4A5B6C"

def token(attachment):
    return {"WFSerializationType": "WFTextTokenString",
            "Value": {"string": "￼", "attachmentsByRange": {"{0, 1}": attachment}}}

def message_prop(name):
    # 단축어 입력을 메시지로 보고 속성을 꺼낸다(편집기에서 "단축어 입력 → 속성" 을 고른 것과 같은 표기)
    return {"Type": "ExtensionInput", "Aggrandizements": [
        {"Type": "WFCoercionVariableAggrandizement", "CoercionItemClass": "WFMessageContentItem"},
        {"Type": "WFPropertyVariableAggrandizement", "PropertyName": name},
    ]}

actions = []
params = {"source": "MESSAGES"}
if variant == "v1":
    params = {"text": token({"Type": "ExtensionInput"}), "source": "NOTIFICATION"}
elif variant in ("v2", "v2-b"):
    params["text"] = token(message_prop("Content" if variant == "v2" else "Body"))
    params["sender"] = token(message_prop("Sender"))
else:  # v2-alt: 입력에서 텍스트 가져오기 → 본문
    actions.append({
        "WFWorkflowActionIdentifier": "is.workflow.actions.detect.text",
        "WFWorkflowActionParameters": {
            "UUID": DETECT_UUID,
            "WFInput": {"WFSerializationType": "WFTextTokenAttachment", "Value": {"Type": "ExtensionInput"}},
        },
    })
    params["text"] = token({"Type": "ActionOutput", "OutputUUID": DETECT_UUID, "OutputName": "Text"})

actions.append({
    "WFWorkflowActionIdentifier": f"{BUNDLE}.CaptureIntent",
    "WFWorkflowActionParameters": {
        "UUID": "5E7A1C2B-4D3F-4A8E-9B61-0C2D3E4F5A6B",
        "AppIntentDescriptor": {
            "TeamIdentifier": "6626BYCJG4",
            "BundleIdentifier": BUNDLE,
            "Name": "ERURI PoC",
            "AppIntentIdentifier": "CaptureIntent",
        },
        **params,
        "ShowWhenRun": False,
    },
})
# 입력 클래스: 텍스트 계열 + (v2) 메시지. WFWorkflowNoInputBehavior 를 두지 않으면 입력이 없을 때 "계속하기"
classes = ["WFStringContentItem", "WFRichTextContentItem", "WFURLContentItem"]
if variant != "v1":
    classes = ["WFMessageContentItem"] + classes
wf = {
    "WFWorkflowActions": actions,
    "WFWorkflowClientVersion": "4610",
    "WFWorkflowMinimumClientVersion": 900,
    "WFWorkflowMinimumClientVersionString": "900",
    "WFWorkflowIcon": {"WFWorkflowIconStartColor": 4282601983, "WFWorkflowIconGlyphNumber": 61440},
    "WFWorkflowImportQuestions": [],
    "WFWorkflowInputContentItemClasses": classes,
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
