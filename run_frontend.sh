#!/usr/bin/env bash
# ShunnoShikha AI — Frontend (Next.js mission control)
set -euo pipefail
cd "$(dirname "$0")/frontend"

# Prefer a real Node runtime; fall back to bun if present.
if command -v node >/dev/null 2>&1; then
  RUNNER="node"
elif [ -x "$HOME/.local/share/lerd/bin/node" ]; then
  export PATH="$HOME/.local/share/lerd/bin:$PATH"
  RUNNER="node"
elif command -v bun >/dev/null 2>&1; then
  RUNNER="bun"
else
  echo "✗ Node.js or Bun is required. Install Node 18+ or Bun." >&2
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "▶ Installing frontend dependencies…"
  if [ "$RUNNER" = "bun" ]; then bun install; else npm install --no-audit --no-fund; fi
fi

MODE="${1:-dev}"
echo "▶ ShunnoShikha AI mission control on http://localhost:3000 (${MODE})"
if [ "$MODE" = "start" ]; then
  [ -d .next ] || { echo "Building production bundle…"; if [ "$RUNNER" = "bun" ]; then bun run build; else npm run build; fi; }
  if [ "$RUNNER" = "bun" ]; then exec bun run start; else exec npm run start; fi
else
  if [ "$RUNNER" = "bun" ]; then exec bun run dev; else exec npm run dev; fi
fi