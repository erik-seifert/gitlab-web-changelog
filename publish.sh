#!/usr/bin/env bash
set -euo pipefail

# Liest die Version aus manifest.json und erzeugt eine fertige ZIP-Datei
# für den Chrome Web Store Upload.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VERSION=$(node -p "require('./manifest.json').version")
OUT="$SCRIPT_DIR/gitlab-changelog-extension-v${VERSION}.zip"

# Alte ZIP entfernen falls vorhanden
rm -f "$OUT"

zip -j "$OUT" \
  "$SCRIPT_DIR/manifest.json" \
  "$SCRIPT_DIR/background.js" \
  "$SCRIPT_DIR/content.js" \
  "$SCRIPT_DIR/content.css" \
  "$SCRIPT_DIR/options.html" \
  "$SCRIPT_DIR/options.css" \
  "$SCRIPT_DIR/options.js" \
  "$SCRIPT_DIR/popup.html" \
  "$SCRIPT_DIR/popup.js"

# Icons als Unterordner hinzufügen (-j würde den Pfad flach machen)
zip "$OUT" \
  icons/icon16.png \
  icons/icon48.png \
  icons/icon128.png

echo "✓ Fertig: $(basename "$OUT")"
echo "  Größe:   $(du -sh "$OUT" | cut -f1)"
echo "  Inhalt:"
unzip -l "$OUT" | tail -n +4 | head -n -2 | awk '{print "  " $NF}'
