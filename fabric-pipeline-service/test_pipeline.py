"""End-to-end smoke test for the fabric pipeline.

  .venv/bin/python test_pipeline.py <source.png> <dest.png> [out_dir]

Runs copy (segment + rectify) then paste (segment + tile + blend) against the
running service and writes the intermediate images out for inspection.
"""

from __future__ import annotations

import base64
import io
import json
import sys
import time
import urllib.request
from pathlib import Path

from PIL import Image

BASE = "http://127.0.0.1:8010"


def post(path: str, payload: dict) -> dict:
    body = json.dumps(payload).encode()
    req = urllib.request.Request(
        BASE + path, data=body, headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=600) as resp:
        return json.loads(resp.read())


def to_data_url(path: Path) -> str:
    img = Image.open(path).convert("RGB")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode(), img.size


def save_data_url(data_url: str, path: Path) -> Image.Image:
    raw = base64.b64decode(data_url.split(",", 1)[1])
    img = Image.open(io.BytesIO(raw))
    img.save(path)
    return img


def main() -> int:
    src_path = Path(sys.argv[1])
    dst_path = Path(sys.argv[2])
    out_dir = Path(sys.argv[3] if len(sys.argv) > 3 else "outputs")
    out_dir.mkdir(parents=True, exist_ok=True)

    src_url, (sw, sh) = to_data_url(src_path)
    dst_url, (dw, dh) = to_data_url(dst_path)
    print(f"source {src_path.name} {sw}x{sh}   dest {dst_path.name} {dw}x{dh}")

    # Sample a patch from the middle of the source garment.
    rect = {
        "x": sw * 0.40,
        "y": sh * 0.40,
        "width": sw * 0.20,
        "height": sh * 0.20,
    }

    t0 = time.perf_counter()
    copy_res = post("/copy", {"imageDataUrl": src_url, "rect": rect, "seed": 0})
    print(f"\n[copy] {time.perf_counter() - t0:.2f}s")
    for k in (
        "sourceGarment", "sourceGarmentFound", "sourceCoverage",
        "srcPxPerCm", "cropWidth", "cropHeight",
        "segmentSeconds", "rectifySeconds", "fromCache",
    ):
        print(f"   {k}: {copy_res[k]}")
    save_data_url(copy_res["swatchDataUrl"], out_dir / "01_flat_swatch.png")

    t0 = time.perf_counter()
    paste_res = post(
        "/paste",
        {
            "swatchDataUrl": copy_res["swatchDataUrl"],
            "destImageDataUrl": dst_url,
            "cropWidth": copy_res["cropWidth"],
            "cropHeight": copy_res["cropHeight"],
            "srcPxPerCm": copy_res["srcPxPerCm"],
            "multiplier": 1.0,
            "shadingStrength": 1.0,
        },
    )
    print(f"\n[paste] {time.perf_counter() - t0:.2f}s")
    for k in (
        "destGarment", "destGarmentFound", "destCoverage", "dstPxPerCm",
        "tileWidth", "tileHeight", "repeatsX", "repeatsY", "scaleRatio",
        "width", "height", "segmentSeconds",
    ):
        print(f"   {k}: {paste_res[k]}")
    pasted = save_data_url(paste_res["imageDataUrl"], out_dir / "02_pasted_rgba.png")

    # Flatten over the destination so the result is easy to eyeball.
    dest = Image.open(dst_path).convert("RGBA")
    if dest.size != pasted.size:
        dest = dest.resize(pasted.size, Image.LANCZOS)
    Image.alpha_composite(dest, pasted).convert("RGB").save(out_dir / "03_composite.png")

    print(f"\nwrote -> {out_dir}/01_flat_swatch.png, 02_pasted_rgba.png, 03_composite.png")

    # Tileability check: a seamless swatch has a small difference across the
    # wrap boundary relative to its internal variation.
    import numpy as np

    sw_arr = np.asarray(Image.open(out_dir / "01_flat_swatch.png").convert("RGB"), dtype=np.float32)
    wrap_h = float(np.abs(sw_arr[:, 0, :] - sw_arr[:, -1, :]).mean())
    wrap_v = float(np.abs(sw_arr[0, :, :] - sw_arr[-1, :, :]).mean())
    interior_h = float(np.abs(sw_arr[:, 1:, :] - sw_arr[:, :-1, :]).mean())
    interior_v = float(np.abs(sw_arr[1:, :, :] - sw_arr[:-1, :, :]).mean())
    print("\n[tileability] mean abs difference across the wrap vs. between neighbouring interior pixels")
    print(f"   horizontal wrap {wrap_h:.2f}  vs interior {interior_h:.2f}  ratio {wrap_h / max(interior_h, 1e-6):.2f}")
    print(f"   vertical   wrap {wrap_v:.2f}  vs interior {interior_v:.2f}  ratio {wrap_v / max(interior_v, 1e-6):.2f}")
    print("   (ratio near 1.0 means the seam is no more visible than ordinary texture variation)")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
