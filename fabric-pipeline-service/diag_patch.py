"""Diagnose patch selection and scale estimation on a pair of garments.

  .venv/bin/python diag_patch.py ../public/templates/blouse.jpg ../public/templates/t-shirt.jpg

Reports, for each image: what the segmenter found, how much of a naive centre
crop actually lands on garment pixels, and how two competing scale estimators
compare (bounding-box width vs median row width).
"""

from __future__ import annotations

import sys

import numpy as np
from PIL import Image

import segmenter as S


def row_widths(mask: np.ndarray) -> np.ndarray:
    """Width of the garment on each row that contains any garment at all."""
    counts = mask.sum(axis=1)
    return counts[counts > 0]


def report(path: str) -> dict:
    image = Image.open(path).convert("RGB")
    w, h = image.size
    seg = S.segmenter.segment(image)
    mask = seg.mask

    x0, y0, x1, y1 = seg.bbox
    bbox_w = x1 - x0
    rw = row_widths(mask)

    print(f"\n=== {path}  {w}x{h} ===")
    print(f"   class          : {seg.label} (id {seg.class_id})")
    print(f"   coverage       : {seg.coverage:.3f}")
    print(f"   bbox width     : {bbox_w} px")
    print(f"   row width  p50 : {np.median(rw):.0f} px")
    print(f"   row width  p90 : {np.percentile(rw, 90):.0f} px")
    print(f"   bbox/median    : {bbox_w / max(1, np.median(rw)):.2f}  "
          f"(high = silhouette flares out, e.g. sleeves)")

    # How much of the naive centre crop that test_pipeline.py uses is actually
    # fabric rather than background or neckline?
    cx0, cy0 = int(w * 0.40), int(h * 0.40)
    cx1, cy1 = int(w * 0.60), int(h * 0.60)
    sub = mask[cy0:cy1, cx0:cx1]
    print(f"   centre crop 40-60%: {100.0 * sub.mean():.1f}% of its pixels are garment")

    return {
        "bbox_w": bbox_w,
        "median_rw": float(np.median(rw)),
        "class": seg.class_id,
    }


def main() -> int:
    a = report(sys.argv[1])
    b = report(sys.argv[2])

    print("\n=== scale transfer (source -> destination) ===")
    bbox_ratio = b["bbox_w"] / a["bbox_w"]
    med_ratio = b["median_rw"] / a["median_rw"]
    print(f"   ratio from bbox width  : {bbox_ratio:.3f}")
    print(f"   ratio from median row  : {med_ratio:.3f}")
    print(f"   difference             : {100 * (bbox_ratio / med_ratio - 1):+.1f}%")
    print("\n   A sleeveless top measured by bbox looks narrower than a sleeved")
    print("   shirt of the same torso size, so bbox over-scales the transfer.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
