"""Compare two anthropometric scale references on real photographs.

  .venv/bin/python diag_head.py <image> [image ...]

There is no ground-truth px/cm for a downloaded photo, but there are two
independent ways to estimate it: the width of the person's face, and the width
of the garment's body. Both rest on adult averages. If they agree, both are
probably close; where they disagree, the size of the gap says how much trust
the weaker one deserves.

Face breadth is the tighter constant -- roughly 14cm across adults, against a
garment body width that ranges 34-56cm depending on cut -- so it should be the
better reference wherever a face is visible.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import torch
from PIL import Image

import geometry
import segmenter as S
from labels import GARMENT_CLASS_IDS

FACE_ID = 11
HAIR_ID = 2

# Adult averages, in centimetres.
FACE_BREADTH_CM = 14.0
HEAD_HEIGHT_CM = 23.0


def raw_seg(image: Image.Image) -> np.ndarray:
    S.segmenter.load()
    w, h = image.size
    inputs = S.segmenter.processor(images=image, return_tensors="pt")
    inputs = {k: v.to(S.segmenter.device) for k, v in inputs.items()}
    with torch.inference_mode():
        logits = S.segmenter.model(**inputs).logits
        up = torch.nn.functional.interpolate(logits, size=(h, w), mode="bilinear", align_corners=False)
        return up.argmax(dim=1)[0].cpu().numpy().astype(np.int32)


def robust_width(mask: np.ndarray) -> float:
    """Median width of the rows that contain the region -- less pose-sensitive
    than the bounding box, which a turned head or a stray pixel distorts."""
    widths = mask.sum(axis=1)
    widths = widths[widths > 0]
    return float(np.median(widths)) if widths.size else 0.0


def main() -> int:
    print(f"{'image':<30} {'face px':>8} {'head px':>8} {'face->px/cm':>12} "
          f"{'head->px/cm':>12} {'garment->px/cm':>15} {'gap':>7}")
    print("-" * 100)

    for path in sys.argv[1:]:
        img = Image.open(path).convert("RGB")
        seg = raw_seg(img)

        face = seg == FACE_ID
        head = np.isin(seg, [FACE_ID, HAIR_ID])

        face_w = robust_width(face)
        if head.any():
            ys = np.nonzero(head.any(axis=1))[0]
            head_h = float(ys.max() - ys.min() + 1)
        else:
            head_h = 0.0

        face_ppc = face_w / FACE_BREADTH_CM if face_w > 4 else float("nan")
        head_ppc = head_h / HEAD_HEIGHT_CM if head_h > 8 else float("nan")

        # Garment estimate, on the dominant garment class alone.
        counts = {c: int((seg == c).sum()) for c in GARMENT_CLASS_IDS}
        best = max(counts, key=lambda c: counts[c])
        gmask = seg == best
        gm_ppc = geometry.body_width(gmask).px_per_cm if counts[best] else float("nan")

        gap = (abs(gm_ppc - face_ppc) / face_ppc) if np.isfinite(face_ppc) and np.isfinite(gm_ppc) else float("nan")

        print(f"{Path(path).name:<30} {face_w:8.0f} {head_h:8.0f} {face_ppc:12.2f} "
              f"{head_ppc:12.2f} {gm_ppc:15.2f} {100 * gap:6.0f}%")

    print("\nface->px/cm assumes a 14cm face breadth; head->px/cm a 23cm head height;")
    print("garment->px/cm uses geometry.body_width on the dominant garment class.")
    print("'gap' is how far the garment estimate sits from the face estimate.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
