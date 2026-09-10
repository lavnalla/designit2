"""The real workflow: fabric off a photographed person, onto a flat 2D garment.

  .venv/bin/python test_person_to_flat.py

Only the directions that are actually used are covered -- worn -> flat and
flat -> flat. Worn -> worn is out of scope by design.

Each source is sampled twice: once with no selection (the pipeline finds the
fabric itself) and once with a selection over a specific garment, which on a
person wearing two things has to pick the right one.
"""

from __future__ import annotations

import base64
import io
import json
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image

BASE = "http://127.0.0.1:8010"
OUT = Path("outputs/person")

# (label, path, selection over one specific garment as fractions of the frame)
SOURCES = [
    ("striped sweater (worn, 2 garments)", "testdata/person-striped-sweater.jpg",
     (0.40, 0.16, 0.60, 0.28)),   # over the jumper, well above the skirt
    ("floral shirt (worn, 2 garments)", "testdata/person-floral-shirt.jpg",
     (0.35, 0.42, 0.62, 0.60)),   # over the shirt body
    ("floral dress (worn)", "testdata/person-floral-dress.jpg",
     (0.42, 0.55, 0.62, 0.75)),
]

DESTINATIONS = [
    ("flat t-shirt", "../public/templates/t-shirt.jpg"),
    ("flat gown", "../public/designTo1.png"),
]


def post(path: str, payload: dict) -> dict:
    req = urllib.request.Request(
        BASE + path, data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=900) as resp:
        return json.loads(resp.read())


def to_data_url(img: Image.Image) -> str:
    buf = io.BytesIO()
    img.convert("RGB").save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def from_data_url(url: str) -> Image.Image:
    return Image.open(io.BytesIO(base64.b64decode(url.split(",", 1)[1])))


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    results: list[bool] = []

    for label, path, sel in SOURCES:
        src = Image.open(path).convert("RGB")
        w, h = src.size
        rect = {"x": sel[0] * w, "y": sel[1] * h,
                "width": (sel[2] - sel[0]) * w, "height": (sel[3] - sel[1]) * h}

        print(f"\n{'=' * 78}\n=== {label}\n{'=' * 78}")

        for mode, r in (("auto (no selection)", None), ("user selection", rect)):
            copy = post("/copy", {"imageDataUrl": to_data_url(src), "rect": r, "seed": 0})
            tag = f"{Path(path).stem}_{'auto' if r is None else 'sel'}"
            from_data_url(copy["swatchDataUrl"]).save(OUT / f"{tag}_swatch.png")

            print(f"\n  -- {mode}")
            print(f"     garment    : {copy['sourceGarment']} ({copy['sourceSilhouette']})"
                  f"   person={copy['sourcePersonPresent']}")
            print(f"     patch      : {copy['cropWidth']}x{copy['cropHeight']} "
                  f"({100 * copy['patchCoverage']:.1f}% fabric) -- {copy['patchReason']}")
            print(f"     scale      : {copy['srcPxPerCm']:.2f} px/cm "
                  f"conf {copy['sourceScaleConfidence']:.2f} from {'+'.join(copy['sourceScaleSources'])}")
            print(f"                  {copy['sourceScaleNote']}")

            clean = copy["patchCoverage"] >= 0.95
            print(f"     [{'PASS' if clean else 'FAIL'}] patch is fabric "
                  f"({100 * copy['patchCoverage']:.1f}% >= 95%)")
            results.append(clean)

            person_ok = copy["sourcePersonPresent"] is True
            print(f"     [{'PASS' if person_ok else 'FAIL'}] recognised as a worn photo")
            results.append(person_ok)

            if r is not None:
                # Paste onto each flat destination.
                for dlabel, dpath in DESTINATIONS:
                    dst = Image.open(dpath).convert("RGB")
                    paste = post("/paste", {
                        "swatchDataUrl": copy["swatchDataUrl"],
                        "destImageDataUrl": to_data_url(dst),
                        "cropWidth": copy["cropWidth"],
                        "cropHeight": copy["cropHeight"],
                        "srcPxPerCm": copy["srcPxPerCm"],
                        "multiplier": 1.0,
                        "shadingStrength": 1.0,
                    })
                    pasted = from_data_url(paste["imageDataUrl"])
                    flat = Image.alpha_composite(dst.convert("RGBA"), pasted).convert("RGB")
                    flat.save(OUT / f"{Path(path).stem}__to__{Path(dpath).stem}.png")

                    reps = paste["repeatsX"]
                    sane = 1.0 <= reps <= 60.0
                    print(f"     -> {dlabel:<14} tile {paste['tileWidth']}x{paste['tileHeight']}px "
                          f"({reps:.1f}x{paste['repeatsY']:.1f} repeats)  "
                          f"[{'PASS' if sane else 'FAIL'}] pattern density sane")
                    results.append(sane)

    passed = sum(results)
    print(f"\n{passed}/{len(results)} checks passed")
    print(f"images -> {OUT}/")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
