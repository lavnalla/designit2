"""Diagnostic: which classes does the segmenter actually find, and how big is each?"""

from __future__ import annotations

import sys

import numpy as np
import torch
from PIL import Image

import segmenter as S
from labels import GARMENT_CLASS_IDS, label_for


def main() -> int:
    path = sys.argv[1]
    image = Image.open(path).convert("RGB")
    S.segmenter.load()

    w, h = image.size
    inputs = S.segmenter.processor(images=image, return_tensors="pt")
    inputs = {k: v.to(S.segmenter.device) for k, v in inputs.items()}
    with torch.inference_mode():
        logits = S.segmenter.model(**inputs).logits
        up = torch.nn.functional.interpolate(logits, size=(h, w), mode="bilinear", align_corners=False)
        seg = up.argmax(dim=1)[0].cpu().numpy()

    print(f"{path}  {w}x{h}")
    ids, counts = np.unique(seg, return_counts=True)
    for cid, cnt in sorted(zip(ids.tolist(), counts.tolist()), key=lambda x: -x[1]):
        flag = "  <-- garment" if cid in GARMENT_CLASS_IDS else ""
        print(f"   {cid:>2} {label_for(cid):<16} {100.0 * cnt / seg.size:6.2f}%{flag}")

    union = np.isin(seg, list(GARMENT_CLASS_IDS))
    print(f"\n   union of garment classes: {100.0 * union.mean():.2f}%")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
