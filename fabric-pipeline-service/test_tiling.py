"""Validate isotropic tiling and photometric blending with a known pattern.

  .venv/bin/python test_tiling.py

Gingham is used deliberately: it is a regular grid, so any anisotropic stretch
shows up immediately as rectangles where there should be squares. The test
asserts the geometry numerically rather than relying on the eye.
"""

from __future__ import annotations

import base64
import io
import json
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image

import compositor

BASE = "http://127.0.0.1:8010"
OUT = Path("outputs")


def post(path: str, payload: dict) -> dict:
    req = urllib.request.Request(
        BASE + path, data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=600) as resp:
        return json.loads(resp.read())


def to_data_url(img: Image.Image) -> str:
    buf = io.BytesIO()
    img.convert("RGB").save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def save_data_url(data_url: str, path: Path) -> Image.Image:
    raw = base64.b64decode(data_url.split(",", 1)[1])
    img = Image.open(io.BytesIO(raw))
    img.save(path)
    return img


def check(name: str, ok: bool, detail: str) -> bool:
    print(f"   [{'PASS' if ok else 'FAIL'}] {name}: {detail}")
    return ok


def main() -> int:
    OUT.mkdir(exist_ok=True)
    results = []

    # ---- unit-level: the scale maths, independent of any model ----
    print("\n== compute_tile_size ==")

    # Same density on both sides -> the swatch keeps its pixel size exactly.
    tw, th, ratio = compositor.compute_tile_size(100, 60, src_px_per_cm=10.0, dst_px_per_cm=10.0)
    results.append(check("identity scale", (tw, th) == (100, 60) and abs(ratio - 1.0) < 1e-9,
                         f"100x60 -> {tw}x{th}, ratio {ratio:.4f}"))

    # Destination photographed at twice the density -> tile doubles.
    tw, th, ratio = compositor.compute_tile_size(100, 60, src_px_per_cm=10.0, dst_px_per_cm=20.0)
    results.append(check("2x density", (tw, th) == (200, 120) and abs(ratio - 2.0) < 1e-9,
                         f"100x60 -> {tw}x{th}, ratio {ratio:.4f}"))

    # The crop's aspect ratio must survive: this is what "isotropic" means.
    tw, th, _ = compositor.compute_tile_size(120, 40, src_px_per_cm=8.0, dst_px_per_cm=13.0)
    src_aspect, out_aspect = 120 / 40, tw / th
    results.append(check("aspect preserved", abs(src_aspect - out_aspect) < 0.02,
                         f"source aspect {src_aspect:.3f} vs tile aspect {out_aspect:.3f}"))

    # The multiplier scales both axes by the same factor.
    tw2, th2, _ = compositor.compute_tile_size(120, 40, src_px_per_cm=8.0, dst_px_per_cm=13.0, multiplier=2.0)
    results.append(check("multiplier isotropic", abs((tw2 / tw) - (th2 / th)) < 0.02,
                         f"x{tw2 / tw:.3f} horizontally, x{th2 / th:.3f} vertically"))

    # ---- tile_swatch must repeat, never resize-to-fit ----
    print("\n== tile_swatch ==")
    gingham = Image.open("../public/swatches/gingham.jpg").convert("RGB")
    tiled = compositor.tile_swatch(gingham, 128, 128, 512, 384)
    arr = np.asarray(tiled).astype(np.int16)
    # Pixels one tile apart must be identical, which only holds if it repeated.
    dx = np.abs(arr[:, :256] - arr[:, 128:384]).mean()
    results.append(check("repeats every tile_w", dx < 0.01, f"mean |p(x) - p(x+128)| = {dx:.4f}"))
    results.append(check("canvas size exact", tiled.size == (512, 384), f"{tiled.size}"))
    tiled.save(OUT / "10_tiled_gingham.png")

    # ---- end to end against the real destination ----
    print("\n== end-to-end paste onto designTo1.png ==")
    dest = Image.open("../public/designTo1.png").convert("RGB")
    res = post("/paste", {
        "swatchDataUrl": to_data_url(gingham),
        "destImageDataUrl": to_data_url(dest),
        # Pretend the gingham crop was shot at 4 px/cm so the tile lands at a
        # readable size on a 1024px-wide dress.
        "cropWidth": gingham.size[0],
        "cropHeight": gingham.size[1],
        "srcPxPerCm": gingham.size[0] / 20.0,
        "multiplier": 1.0,
        "shadingStrength": 1.0,
    })
    for k in ("destGarment", "destCoverage", "dstPxPerCm", "tileWidth", "tileHeight",
              "repeatsX", "repeatsY", "scaleRatio", "width", "height"):
        print(f"   {k}: {res[k]}")

    pasted = save_data_url(res["imageDataUrl"], OUT / "11_gingham_rgba.png")
    flat = Image.alpha_composite(dest.convert("RGBA"), pasted).convert("RGB")
    flat.save(OUT / "12_gingham_composite.png")

    results.append(check("output matches destination size", pasted.size == dest.size,
                         f"{pasted.size} vs {dest.size}"))

    # Square input crop -> square tile. This is the anti-stretch guarantee.
    in_aspect = gingham.size[0] / gingham.size[1]
    out_aspect = res["tileWidth"] / res["tileHeight"]
    results.append(check("no anisotropic stretch", abs(in_aspect - out_aspect) < 0.02,
                         f"swatch aspect {in_aspect:.3f} vs tile aspect {out_aspect:.3f}"))

    # Coverage sanity: the garment mask should be a substantial slice, and the
    # bodice must now be included (it was lost to the largest-component bug).
    results.append(check("garment coverage plausible", 0.35 < res["destCoverage"] < 0.65,
                         f"{res['destCoverage']:.3f} of frame"))

    # Shading actually varies -- a flat multiply would mean no drape was kept.
    alpha = np.asarray(pasted)[..., 3] > 128
    lum = np.asarray(flat.convert("L")).astype(np.float32)
    inside = lum[alpha]
    results.append(check("drape preserved", float(inside.std()) > 12.0,
                         f"luminance std inside garment = {inside.std():.2f}"))

    print(f"\nwrote -> {OUT}/10_tiled_gingham.png, 11_gingham_rgba.png, 12_gingham_composite.png")
    passed = sum(results)
    print(f"\n{passed}/{len(results)} checks passed")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
