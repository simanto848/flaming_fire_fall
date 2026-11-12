#!/usr/bin/env bash
# ShunnoShikha AI — Backend (FastAPI + WebSocket telemetry + LLM agent + live NASA RAG)
set -euo pipefail
cd "$(dirname "$0")"
PORT="${PORT:-8000}"
echo "▶ ShunnoShikha AI backend on http://localhost:${PORT}"
echo "  API docs: http://localhost:${PORT}/docs"
exec python3 -m uvicorn shunnoshikha.backend_api:app --host 0.0.0.0 --port "${PORT}"