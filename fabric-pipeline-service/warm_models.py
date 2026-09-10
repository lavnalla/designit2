"""Pre-download the two models so the first request is not a multi-GB wait.

  .venv/bin/python warm_models.py
"""

from __future__ import annotations

import sys

from huggingface_hub import snapshot_download

import rectify
import segmenter


def main() -> int:
    for model_id in (segmenter.MODEL_ID, rectify.MODEL_ID):
        print(f"[warm] downloading {model_id}", flush=True)
        path = snapshot_download(model_id)
        print(f"[warm]   -> {path}", flush=True)
    print("[warm] done", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
