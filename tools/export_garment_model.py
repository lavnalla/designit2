#!/usr/bin/env python3
"""
One-time (re-run only when the model needs updating) export script.

Converts sayeed99/segformer-b3-fashion from PyTorch to a quantized ONNX
file that runs directly in the browser via onnxruntime-web — no Python
process needed at runtime, which is what makes this work on Vercel.

Usage:
    tools/venv/bin/python tools/export_garment_model.py

Requires the export-time dependencies in
tools/requirements-garment-segment.txt (torch/transformers/optimum-onnx/
onnxruntime) — these are NOT needed at runtime anymore, only to
regenerate the model file below.

Output: public/models/garment-segformer/model.onnx
"""
import subprocess
import sys
from pathlib import Path

MODEL_ID = "sayeed99/segformer-b3-fashion"
TOOLS_DIR = Path(__file__).parent
EXPORT_DIR = TOOLS_DIR / "onnx_export"
OUTPUT_PATH = TOOLS_DIR.parent / "public" / "models" / "garment-segformer" / "model.onnx"


def main() -> int:
    print(f"Exporting {MODEL_ID} to ONNX...")
    subprocess.run(
        [
            sys.executable,
            "-m",
            "optimum.commands.optimum_cli",
            "export",
            "onnx",
            "--model",
            MODEL_ID,
            "--task",
            "semantic-segmentation",
            str(EXPORT_DIR),
        ],
        check=True,
    )

    print("Quantizing (float32 -> uint8, ~4x smaller, negligible accuracy loss)...")
    from onnxruntime.quantization import QuantType, quantize_dynamic

    quantized_path = EXPORT_DIR / "model.quant.onnx"
    quantize_dynamic(
        str(EXPORT_DIR / "model.onnx"),
        str(quantized_path),
        weight_type=QuantType.QUInt8,
    )

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_bytes(quantized_path.read_bytes())
    print(f"Done. Wrote {OUTPUT_PATH} ({OUTPUT_PATH.stat().st_size / 1_000_000:.1f} MB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
