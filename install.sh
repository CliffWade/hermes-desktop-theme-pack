#!/bin/bash
# Install the Hermes theme pack into the active Hermes home.
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)/themes"
DEST="${HERMES_HOME:-$HOME/.hermes}/skins"

if [ ! -d "$SRC" ]; then
  echo "error: themes/ not found next to this script" >&2
  exit 1
fi

mkdir -p "$DEST"
COUNT=$(ls "$SRC"/*.yaml | wc -l | tr -d ' ')
cp "$SRC"/*.yaml "$DEST/"

echo "Installed $COUNT themes to $DEST"
echo "Activate one with: hermes config set display.skin <name>"
echo "Try: dark-aubergine, vibrant-synthwave, retro-terminal"
