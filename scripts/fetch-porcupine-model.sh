#!/usr/bin/env bash
# Porcupine の日本語モデル(.pv)を取得して、ネイティブモジュールの assets に置く。
# CI (GitHub Actions) とローカルビルドの両方で、ビルド前に1回実行してください。
set -euo pipefail

DEST_DIR="$(cd "$(dirname "$0")/.." && pwd)/modules/daily-native/android/src/main/assets"
DEST="$DEST_DIR/porcupine_params_ja.pv"
URL="https://raw.githubusercontent.com/Picovoice/porcupine/master/lib/common/porcupine_params_ja.pv"

mkdir -p "$DEST_DIR"
curl -fsSL --retry 3 -o "$DEST" "$URL"

# 空ファイル / HTML エラーページを掴んでいないか簡易チェック
SIZE=$(wc -c < "$DEST")
if [ "$SIZE" -lt 100000 ]; then
  echo "porcupine_params_ja.pv looks too small ($SIZE bytes). Download failed?" >&2
  exit 1
fi
echo "Fetched porcupine_params_ja.pv ($SIZE bytes) -> $DEST"
