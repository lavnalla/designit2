"""Paste one fabric onto many destinations and see whether scale holds up.

  .venv/bin/python diag_generality.py

The same swatch laid on garments of different kinds should keep its physical
size on each. Whether it does depends entirely on each destination's px/cm
estimate being right, which is where cross-category transfer is most exposed:
the estimator measures the median row of the mask, and a gown's median row
crosses its skirt while a t-shirt's crosses its torso -- physically very
different things that the pipeline currently treats alike.
"""

from __future__ import annotations

import base64
import io
import json
import urllib.request

import numpy as np
from PIL import Image

BASE = "http://127.0.0.1:8010"

DESTINATIONS = [
    ("t-shirt (torso)", "../public/templates/t-shirt.jpg"),
    ("blouse (torso)", "../public/templates/blouse.jpg"),
    ("gown (flared skirt)", "../public/designTo1.png"),
    ("gown 2", "../public/designTo.png"),
    ("mannequin", "../public/mannequin.png"),
]


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


def main() -> int:
    src = Image.open("../public/templates/blouse.jpg").convert("RGB")
    copy = post("/copy", {"imageDataUrl": to_data_url(src), "rect": None, "seed": 0})
    print(f"source: blouse.jpg  patch {copy['cropWidth']}x{copy['cropHeight']}  "
          f"{copy['srcPxPerCm']:.2f} px/cm\n")

    print(f"{'destination':<22} {'medRow':>7} {'px/cm':>7} {'tile px':>9} "
          f"{'tile cm':>8} {'dots across body':>18}")
    print("-" * 78)

    for name, path in DESTINATIONS:
        dst = Image.open(path).convert("RGB")
        res = post("/paste", {
            "swatchDataUrl": copy["swatchDataUrl"],
            "destImageDataUrl": to_data_url(dst),
            "cropWidth": copy["cropWidth"],
            "cropHeight": copy["cropHeight"],
            "srcPxPerCm": copy["srcPxPerCm"],
            "multiplier": 1.0,
            "shadingStrength": 1.0,
        })

        # Recover the median row width the estimator used, from px/cm and the
        # assumed width it must have applied.
        px_per_cm = res["dstPxPerCm"]
        tile_cm = res["tileWidth"] / px_per_cm

        # How many tiles span the garment's body. This is the number a person
        # actually looks at when judging "are the dots the right size".
        alpha = np.asarray(Image.open(io.BytesIO(
            base64.b64decode(res["imageDataUrl"].split(",", 1)[1]))))[..., 3] > 128
        widths = alpha.sum(axis=1)
        med_row = float(np.median(widths[widths > 0])) if (widths > 0).any() else float("nan")
        across = med_row / res["tileWidth"]

        print(f"{name:<22} {med_row:7.0f} {px_per_cm:7.2f} {res['tileWidth']:>6}px "
              f"{tile_cm:7.2f}cm {across:15.1f}")

    print("\nEvery destination is assumed to be the same real-world width, because")
    print("all of them segment as 'Dress'. So 'tile cm' is identical everywhere by")
    print("construction -- the pipeline cannot tell a 40cm torso from a 90cm skirt,")
    print("and 'dots across body' is the number that actually varies.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
