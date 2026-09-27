#!/bin/sh
# 06-notice.html → 텍스트 레이어 PDF(Chrome headless). gen-images.py 다음에 실행
cd "$(dirname "$0")/images" || exit 1
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --no-pdf-header-footer \
  --print-to-pdf="$PWD/06-notice.pdf" "file://$PWD/06-notice.html" 2>/dev/null
ls -la 06-notice.pdf
