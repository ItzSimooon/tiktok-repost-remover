#!/usr/bin/env bash
# Startet Repost Cleaner (macOS/Linux)
set -e
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js wurde nicht gefunden. Bitte Node.js 18 oder neuer installieren: https://nodejs.org/de"
  exit 1
fi
if [ ! -d node_modules ]; then
  echo "Erster Start – installiere Abhängigkeiten …"
  npm install --omit=dev --no-audit --no-fund
fi
npm start
