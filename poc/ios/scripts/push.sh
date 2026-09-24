#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
xcrun simctl push "$(cat .sim-udid)" com.picpal.assistant.poc "scripts/payloads/${1:-add_event}.apns"
