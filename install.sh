#!/bin/bash
# Install the Hermes theme pack into the active Hermes home.
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)/themes"
DEST="${HERMES_HOME:-$HOME/.hermes}/skins"
STATE="${HERMES_HOME:-$HOME/.hermes}/data/theme-switcher-installs.json"

if [ ! -d "$SRC" ]; then
  echo "error: themes/ not found next to this script" >&2
  exit 1
fi

mkdir -p "$DEST"
COUNT=$(ls "$SRC"/*.yaml | wc -l | tr -d ' ')
ADDED=0
mkdir -p "$(dirname "$STATE")"

# Copy each theme, seeding the Theme Switcher's first-seen record for themes
# that are NEW to this install. Existing themes keep their existing record so
# they never re-trigger the NEW badge; the app's own install flow uses the
# same state file. File mtime is NOT used by the badge logic (install.sh
# rewriting a file must not make it look newly installed).
for f in "$SRC"/*.yaml; do
  name="$(basename "$f" .yaml)"
  dest="$DEST/$name.yaml"
  if [ ! -f "$dest" ]; then
    cp "$f" "$dest"
    ADDED=$((ADDED + 1))
    # Merge into the state file: add this name -> now, keep everything else.
    if [ -f "$STATE" ]; then
      python3 - "$STATE" "$name" <<'PY'
import json, sys, time
path, name = sys.argv[1], sys.argv[2]
try:
    with open(path) as fh:
        data = json.load(fh)
except Exception:
    data = {}
if name not in data:
    data[name] = int(time.time())
with open(path, "w") as fh:
    json.dump(data, fh)
PY
    else
      printf '{"%s": %d}\n' "$name" "$(date +%s)" > "$STATE"
    fi
  else
    cp "$f" "$dest"
  fi
done

echo "Installed $COUNT themes to $DEST ($ADDED new)"
echo "Activate one with: hermes config set display.skin <name>"
echo "Try: dark-aubergine, vibrant-synthwave, retro-terminal"
