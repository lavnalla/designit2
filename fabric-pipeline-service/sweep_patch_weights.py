"""Find a patch-scoring setting that never costs pattern, per the stated priority.

  .venv/bin/python sweep_patch_weights.py

The brief is explicit: repeating patterns must work, avoiding logos is a bonus.
That makes this an asymmetric problem -- a setting that rescues a few printed
tees but samples the gaps between flowers on everything else is a bad trade,
however good its own objective looks.

So the sweep reports both, and the setting to prefer is the one that keeps
pattern richness at the baseline while picking up whatever logo avoidance comes
free. `margin` is the score improvement demanded before the patch is moved at
all; a large margin means "leave it where it was unless clearly better".
"""

from __future__ import annotations

import itertools
from pathlib import Path

import numpy as np
from PIL import Image

import patch as P

DATA = Path("testdata/vitonhd")
GT_UPPER = (5, 21, 22)


def graphic_fraction(img, garment, rect) -> float:
    dom = np.median(img[garment], axis=0)
    x0, y0, x1, y1 = rect
    sub = img[y0:y1, x0:x1].astype(np.float32)
    return float((np.linalg.norm(sub - dom, axis=2) > 70).mean()) if sub.size else 1.0


def richness(img, rect) -> float:
    x0, y0, x1, y1 = rect
    sub = img[y0:y1, x0:x1].astype(np.float32)
    return float(sub.reshape(-1, 3).std(axis=0).mean()) if sub.size else 0.0


def main() -> int:
    samples = []
    for p in sorted((DATA / "worn").glob("*.jpg")):
        worn = np.asarray(Image.open(p).convert("RGB"))
        parse = np.asarray(Image.open(DATA / "parse" / f"{p.stem}.png").convert("L"))
        gt = np.isin(parse, GT_UPPER)
        if gt.sum() < 500:
            continue
        base = P.largest_interior_patch(gt)
        if base is None:
            continue
        samples.append((p.stem, worn, gt, base))

    print(f"{len(samples)} garments\n")
    print(f"{'stat':>5} {'typ':>5} {'size':>5} {'margin':>7} "
          f"{'richness':>9} {'lost>30%':>9} {'gfx mean':>9} {'gfx>15%':>8} {'area':>6} {'moved':>6}")
    print("-" * 82)

    base_rich = np.array([richness(w, b) for _, w, _, b in samples])
    base_gfx = np.array([graphic_fraction(w, g, b) for _, w, g, b in samples])
    base_area = np.array([(b[2] - b[0]) * (b[3] - b[1]) for _, _, _, b in samples], float)
    print(f"{'--':>5} {'--':>5} {'--':>5} {'baseline':>7} "
          f"{1.00:9.2f} {0:9d} {100 * base_gfx.mean():8.1f}% {int((base_gfx > .15).sum()):8d} "
          f"{1.00:6.2f} {0:6d}")

    grid = [
        (0.30, 0.45, 0.25),
        (0.20, 0.55, 0.25),
        (0.10, 0.60, 0.30),
        (0.00, 0.65, 0.35),
    ]
    for (st, ty, sz), margin in itertools.product(grid, (0.0, 0.05, 0.12)):
        P.WEIGHT_STATIONARITY, P.WEIGHT_TYPICALITY, P.WEIGHT_SIZE = st, ty, sz
        P.RELOCATE_MARGIN = margin

        rich, gfx, area, moved = [], [], [], 0
        for _, worn, gt, base in samples:
            r = P.best_fabric_patch(gt, worn)
            if r != base:
                moved += 1
            rich.append(richness(worn, r))
            gfx.append(graphic_fraction(worn, gt, r))
            area.append((r[2] - r[0]) * (r[3] - r[1]))

        rich = np.array(rich); gfx = np.array(gfx); area = np.array(area, float)
        lost = int((rich < base_rich * 0.7).sum())
        print(f"{st:5.2f} {ty:5.2f} {sz:5.2f} {margin:7.2f} "
              f"{(rich / np.maximum(base_rich, 1e-6)).mean():9.2f} {lost:9d} "
              f"{100 * gfx.mean():8.1f}% {int((gfx > .15).sum()):8d} "
              f"{(area / base_area).mean():6.2f} {moved:6d}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
