#!/usr/bin/env bash
# Regenerate the lexicon-forms table from the downloaded model.
set -euo pipefail
model="apps/web/public/models/vosk-model-small-ja-0.22.tar.gz"
[ -f "$model" ] || { echo "нет $model — сначала: bun run fetch:model" >&2; exit 1; }
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
tar xzf "$model" -C "$tmp"
bun scripts/lexicon-forms.ts "$tmp/vosk-model-small-ja-0.22"
