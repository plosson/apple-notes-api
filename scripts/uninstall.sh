#!/usr/bin/env bash
set -euo pipefail

LABEL="com.plosson.apple-notes-api"
LABEL_MB="com.plosson.apple-notes-api.menubar"
AGENTS_DIR="$HOME/Library/LaunchAgents"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "Stopping and removing apple-notes-api agents..."

launchctl unload "$AGENTS_DIR/$LABEL.plist" 2>/dev/null || true
launchctl unload "$AGENTS_DIR/$LABEL_MB.plist" 2>/dev/null || true

rm -f "$AGENTS_DIR/$LABEL.plist"
rm -f "$AGENTS_DIR/$LABEL_MB.plist"

echo "Agents removed."

read -r -p "Remove .env (contains your API key)? [y/N] " ans
if [[ "$ans" =~ ^[Yy]$ ]]; then
  rm -f "$REPO_DIR/.env"
  echo ".env removed."
else
  echo ".env kept."
fi

echo ""
echo "Uninstall complete."
