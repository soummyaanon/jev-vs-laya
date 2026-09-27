#!/usr/bin/env bash
# Start Laya (port 8000) and the arena (port 9000). Ctrl-C stops both.
cd "$(dirname "$0")"
export HF_HUB_DISABLE_XET=1 LAYA_DEVICE=${LAYA_DEVICE:-mps} LAYA_PRELOAD=1 PYTORCH_ENABLE_MPS_FALLBACK=1
.venv-laya/bin/laya-serve > laya.log 2>&1 &
LAYA=$!
trap 'kill $LAYA 2>/dev/null' EXIT
echo "Laya starting (log: laya.log)…"
until curl -s -m 2 localhost:8000/health >/dev/null; do
  kill -0 $LAYA 2>/dev/null || { echo "Laya exited, see laya.log"; exit 1; }
  sleep 2
done
echo "Laya up. Arena on http://localhost:9000"
.venv-laya/bin/uvicorn arena:app --port 9000
