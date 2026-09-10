"""Adjudicate scale on real photos using three independent references.

  .venv/bin/python diag_three_refs.py <image> [image ...]

Face breadth, garment body width, and total standing height each rest on a
different adult average, so where two of them agree the third is the suspect.
Standing height is only usable when the whole person is in frame -- checked
here by looking for shoes and for the head starting near the top edge.
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

FACE_ID, HAIR_ID = 11, 2
SHOE_IDS = (9, 10)
PERSON_IDS = (1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17)

FACE_BREADTH_CM = 14.0
STANDING_HEIGHT_CM = 168.0


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
    widths = mask.sum(axis=1)
    widths = widths[widths > 0]
    return float(np.median(widths)) if widths.size else 0.0


def main() -> int:
    for path in sys.argv[1:]:
        img = Image.open(path).convert("RGB")
        h_img = img.size[1]
        seg = raw_seg(img)

        face = seg == FACE_ID
        face_w = robust_width(face)
        face_ppc = face_w / FACE_BREADTH_CM if face_w > 4 else float("nan")

        counts = {c: int((seg == c).sum()) for c in GARMENT_CLASS_IDS}
        best = max(counts, key=lambda c: counts[c])
        gm = geometry.body_width(seg == best) if counts[best] else None
        gm_ppc = gm.px_per_cm if gm else float("nan")

        person = np.isin(seg, PERSON_IDS)
        has_shoes = any((seg == s).sum() > 20 for s in SHOE_IDS)
        if person.any():
            ys = np.nonzero(person.any(axis=1))[0]
            top, bottom = int(ys.min()), int(ys.max())
            span = bottom - top + 1
            # Full body only if shoes are visible and the figure is not cut off
            # at the bottom edge of the frame.
            full = has_shoes and bottom < h_img - 3
            height_ppc = span / STANDING_HEIGHT_CM if full else float("nan")
        else:
            span, full, height_ppc = 0, False, float("nan")

        print(f"\n=== {Path(path).name}  {img.size[0]}x{img.size[1]} ===")
        print(f"   face breadth   {face_w:6.0f}px  -> {face_ppc:7.2f} px/cm")
        if gm:
            print(f"   garment body   {gm.width_px:6.0f}px  -> {gm_ppc:7.2f} px/cm "
                  f"({gm.silhouette}, {gm.landmark})")
        print(f"   standing figure{span:6.0f}px  -> {height_ppc:7.2f} px/cm "
              f"{'(full body)' if full else '(cropped - not usable)'}")

        refs = {"face": face_ppc, "garment": gm_ppc, "height": height_ppc}
        usable = {k: v for k, v in refs.items() if np.isfinite(v) and v > 0}
        if len(usable) >= 2:
            vals = np.array(list(usable.values()))
            print(f"   spread across {len(usable)} references: "
                  f"{100 * (vals.max() - vals.min()) / vals.mean():.0f}% of their mean")
            if "height" in usable:
                for k in ("face", "garment"):
                    if k in usable:
                        err = (usable[k] - usable["height"]) / usable["height"]
                        print(f"      {k:<8} vs standing height: {100 * err:+.0f}%")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
