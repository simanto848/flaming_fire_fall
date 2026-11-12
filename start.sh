#!/usr/bin/env bash
# ShunnoShikha AI — Full stack launcher (LLM + backend + frontend)
# Usage: ./start.sh            (dev mode)
#        ./start.sh prod       (production frontend)
set -euo pipefail
cd "$(dirname "$0")"
MODE="${1:-dev}"
LOG_DIR=".logs"; mkdir -p "$LOG_DIR"

cleanup() {
  echo; echo "■ Shutting down ShunnoShikha AI…"
  [ -n "${BACK_PID:-}" ] && kill "$BACK_PID" 2>/dev/null || true
  [ -n "${FRONT_PID:-}" ] && kill "$FRONT_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# 1. Local LLM (Ollama) — optional; platform degrades to deterministic physics if absent.
if curl -s --max-time 3 http://localhost:11434/api/tags >/dev/null 2>&1; then
  echo "✓ Ollama LLM already running (lfm3-omni: vision + tools + audio)"
elif command -v ollama >/dev/null 2>&1; then
  echo "▶ Starting Ollama LLM server…"
  nohup ollama serve >"$LOG_DIR/ollama.log" 2>&1 &
  sleep 3
else
  echo "⚠ Ollama not found — AI runs in deterministic physics fallback mode."
  echo "  Install Ollama + 'ollama pull lfm3-omni' for full super-intelligence."
fi

# 2. Backend
echo "▶ Starting FastAPI backend (:8000)…"
python3 -m uvicorn shunnoshikha.backend_api:app --host 0.0.0.0 --port 8000 >"$LOG_DIR/backend.log" 2>&1 &
BACK_PID=$!

# 3. Frontend
FRONT_MODE="dev"; [ "$MODE" = "prod" ] && FRONT_MODE="start"
echo "▶ Starting Next.js mission control (:3000)…"
bash run_frontend.sh "$FRONT_MODE" >"$LOG_DIR/frontend.log" 2>&1 &
FRONT_PID=$!

echo
echo "════════════════════════════════════════════════════════"
echo "  ShunnoShikha AI — Mission Control is launching"
echo "  Frontend : http://localhost:3000"
echo "  Backend  : http://localhost:8000  (docs: /docs)"
echo "  Logs     : $LOG_DIR/{backend,frontend,ollama}.log"
echo "  Press Ctrl+C to stop everything."
echo "════════════════════════════════════════════════════════"
echo
wait