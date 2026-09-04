"""Isolate stage 4: does the photometric blend actually carry the drape?

  .venv/bin/python test_shading.py

Compares a paste with shading off against one with shading on, so the effect
is measured on its own rather than being masked by the swatch's own pattern.
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
import segmenter

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


def from_data_url(data_url: str) -> Image.Image:
    return Image.open(io.BytesIO(base64.b64decode(data_url.split(",", 1)[1])))


def main() -> int:
    OUT.mkdir(exist_ok=True)
    dest = Image.open("../public/designTo1.png").convert("RGB")

    # A flat grey swatch carries no pattern of its own, so whatever structure
    # shows up in the output came from the destination's shading and nowhere else.
    grey = Image.new("RGB", (256, 256), (128, 128, 128))

    base_payload = {
        "swatchDataUrl": to_data_url(grey),
        "destImageDataUrl": to_data_url(dest),
        "cropWidth": 256,
        "cropHeight": 256,
        "srcPxPerCm": 256 / 20.0,
        "multiplier": 1.0,
    }

    off = post("/paste", {**base_payload, "shadingStrength": 0.0})
    on = post("/paste", {**base_payload, "shadingStrength": 1.0})

    img_off = from_data_url(off["imageDataUrl"])
    img_on = from_data_url(on["imageDataUrl"])
    img_off.save(OUT / "20_grey_shading_off.png")
    img_on.save(OUT / "21_grey_shading_on.png")

    alpha = np.asarray(img_on)[..., 3] > 128
    lum_off = np.asarray(img_off.convert("L")).astype(np.float32)[alpha]
    lum_on = np.asarray(img_on.convert("L")).astype(np.float32)[alpha]
    lum_dest = np.asarray(dest.convert("L")).astype(np.float32)[alpha]

    print("Luminance inside the garment mask, flat grey swatch:")
    print(f"   shading OFF : mean {lum_off.mean():7.2f}   std {lum_off.std():6.2f}")
    print(f"   shading ON  : mean {lum_on.mean():7.2f}   std {lum_on.std():6.2f}")
    print(f"   destination : mean {lum_dest.mean():7.2f}   std {lum_dest.std():6.2f}")

    ok = True

    # With shading off the fill must be perfectly flat -- proof the swatch
    # itself contributes no structure, so anything below is genuinely shading.
    flat = lum_off.std() < 1.0
    print(f"\n   [{'PASS' if flat else 'FAIL'}] shading off is flat: std {lum_off.std():.3f} < 1.0")
    ok &= flat

    # With shading on, real variation appears.
    varied = lum_on.std() > 15.0
    print(f"   [{'PASS' if varied else 'FAIL'}] shading on carries drape: std {lum_on.std():.2f} > 15.0")
    ok &= varied

    # And that variation should track the destination's own light and shade.
    #
    # Correlation is deliberately not expected to approach 1.0. The shading map
    # is blurred precisely so the *old* fabric's weave does not come through
    # and print itself on the new material, and that blur is what costs
    # correlation. Measured on this destination, sigma at 0.2% of the frame
    # would score 0.877 but leak 47% of the old weave's high-frequency energy;
    # the 1.2% default scores 0.739 and leaks 4.1%. 0.70 is the floor that
    # keeps the drape clearly present without inviting that contamination back.
    a = lum_on - lum_on.mean()
    b = lum_dest - lum_dest.mean()
    corr = float((a * b).sum() / max(1e-6, np.sqrt((a * a).sum() * (b * b).sum())))
    tracks = corr > 0.70
    print(f"   [{'PASS' if tracks else 'FAIL'}] tracks destination lighting: correlation {corr:.3f} > 0.70")
    ok &= tracks

    # Highlights must not be clipping to flat white.
    clipped = float((lum_on >= 254).mean())
    unclipped = clipped < 0.02
    print(f"   [{'PASS' if unclipped else 'FAIL'}] highlights not blown: {100 * clipped:.2f}% at 255 < 2%")
    ok &= unclipped

    # Save the shading map itself for inspection.
    seg = segmenter.segmenter.segment(dest)
    shading = compositor.extract_shading(dest, seg.mask, strength=1.0)
    vis = np.clip((shading / compositor.SHADING_CEIL) * 255.0, 0, 255).astype(np.uint8)
    Image.fromarray(vis).save(OUT / "22_shading_map.png")
    print(f"\n   shading map range {shading.min():.3f} .. {shading.max():.3f}")
    print(f"wrote -> {OUT}/20_grey_shading_off.png, 21_grey_shading_on.png, 22_shading_map.png")

    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
