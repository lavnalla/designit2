#!/usr/bin/env bash
# Build the Python environment for the fabric pipeline service.
#
# Must be run from inside WSL (see repo notes): the default `python3` here is
# 3.14, which has no torch wheels, so we pin the venv to python3.10.
set -euo pipefail

SERVICE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV="$SERVICE_DIR/.venv"
PY=python3.10

if [ ! -d "$VENV" ]; then
  echo "[setup] creating venv at $VENV using $PY"
  "$PY" -m venv "$VENV"
fi

"$VENV/bin/python" -m pip install --upgrade pip wheel
"$VENV/bin/python" -m pip install -r "$SERVICE_DIR/requirements.txt"

echo "[setup] verifying torch / CUDA"
"$VENV/bin/python" - <<'PYEOF'
import torch
print("torch", torch.__version__, "cuda_available", torch.cuda.is_available())
if torch.cuda.is_available():
    print("device", torch.cuda.get_device_name(0))
PYEOF

echo "[setup] done"
