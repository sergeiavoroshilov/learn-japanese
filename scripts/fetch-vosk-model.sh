#!/usr/bin/env bash
# Downloads the Japanese Vosk model and repacks it as .tar.gz, which is the
# only archive format vosk-browser's createModel() accepts (alphacephei ships
# .zip). The model is ~48 MB and stays out of git — see .gitignore.
set -euo pipefail

MODEL="vosk-model-small-ja-0.22"
URL="https://alphacephei.com/vosk/models/${MODEL}.zip"
DEST="$(cd "$(dirname "$0")/.." && pwd)/apps/web/public/models"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$DEST"
if [ -f "$DEST/${MODEL}.tar.gz" ]; then
  echo "Модель уже на месте: $DEST/${MODEL}.tar.gz"
  exit 0
fi

echo "Качаю $URL"
curl -fL --progress-bar -o "$TMP/model.zip" "$URL"
unzip -q "$TMP/model.zip" -d "$TMP"
tar -czf "$DEST/${MODEL}.tar.gz" -C "$TMP" "$MODEL"
echo "Готово: $DEST/${MODEL}.tar.gz ($(du -h "$DEST/${MODEL}.tar.gz" | cut -f1))"
