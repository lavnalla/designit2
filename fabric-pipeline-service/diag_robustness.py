"""How well does stage 1 hold up across whatever garments are to hand?

  .venv/bin/python diag_robustness.py <image> [image ...]

Everything downstream is built on the mask: the scale estimate, where the
patch is sampled, and which pixels get covered. So this reports, per image,
what the segmenter called it, how much it found, and how big a clean fabric
patch it could actually cut -- without running the diffusion stage.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image

import patch as P
import segmenter as S
from labels import GARMENT_CLASS_IDS, label_for


def main() -> int:
    rows = []
    print(f"{'image':<26} {'class':<14} {'cover':>6} {'medRow':>7} {'px/cm':>7} "
          f"{'patch':>11} {'fabric':>7}")
    print("-" * 88)

    for path in sys.argv[1:]:
        try:
            img = Image.open(path).convert("RGB")
        except Exception as exc:  # noqa: BLE001
            print(f"{Path(path).name:<26} could not open: {exc}")
            continue

        seg = S.segmenter.segment(img)
        if seg.is_empty:
            print(f"{Path(path).name:<26} {'NO GARMENT':<14} {'-':>6} {'-':>7} {'-':>7} "
                  f"{'-':>11} {'-':>7}")
            rows.append({"name": Path(path).name, "found": False})
            continue

        widths = seg.mask.sum(axis=1)
        med = float(np.median(widths[widths > 0]))

        choice = P.choose_patch(seg.mask, None)
        rows.append({
            "name": Path(path).name,
            "found": True,
            "class_id": seg.class_id,
            "label": seg.label,
            "coverage": seg.coverage,
            "px_per_cm": seg.px_per_cm,
            "patch": (choice.width, choice.height),
            "patch_cov": choice.coverage,
            "size": img.size,
        })
        print(f"{Path(path).name:<26} {seg.label:<14} {seg.coverage:6.2f} {med:7.0f} "
              f"{seg.px_per_cm:7.2f} {choice.width:>5}x{choice.height:<5} {100 * choice.coverage:6.1f}%")

    ok = [r for r in rows if r.get("found")]
    print(f"\n{len(ok)}/{len(rows)} images produced a garment mask")

    if ok:
        classes = {}
        for r in ok:
            classes.setdefault(r["label"], []).append(r["name"])
        print("\nclasses assigned:")
        for label, names in sorted(classes.items()):
            print(f"   {label:<14} {', '.join(names)}")

        small = [r for r in ok if min(r["patch"]) < 48]
        if small:
            print("\npatches under 48px (swatch will be upscaled to 256 and look soft):")
            for r in small:
                print(f"   {r['name']} -> {r['patch'][0]}x{r['patch'][1]}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
