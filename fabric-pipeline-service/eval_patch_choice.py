"""Does fabric-aware patch selection actually pick better fabric?

  .venv/bin/python eval_patch_choice.py [n]

Compares the old rule (take the largest region that fits inside the garment)
against the new one (score candidates for stationarity and typicality) over the
VITON-HD subset, in-process so no diffusion is needed.

Two measures, one of which is deliberately not the objective:

  * **Stationarity** is what the new scorer optimises, so an improvement there
    is close to tautological -- reported for size, not as evidence.
  * **Graphic content** is independent: using the ground-truth parsing mask,
    measure what fraction of the chosen patch is far from the garment's own
    dominant colour. A chest print is exactly that, and nothing in the scorer
    is looking at this quantity.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image

import patch as P

DATA = Path("testdata/vitonhd")
GT_UPPER = (5, 21, 22)


def graphic_fraction(img: np.ndarray, garment: np.ndarray, rect) -> float:
    """Fraction of the patch that does not look like the garment's own colour."""
    dom = np.median(img[garment], axis=0)
    x0, y0, x1, y1 = rect
    sub = img[y0:y1, x0:x1].astype(np.float32)
    if sub.size == 0:
        return 1.0
    return float((np.linalg.norm(sub - dom, axis=2) > 70).mean())


def richness(img: np.ndarray, rect) -> float:
    """How much visual variation the patch carries -- i.e. how patterned it is."""
    x0, y0, x1, y1 = rect
    sub = img[y0:y1, x0:x1].astype(np.float32)
    if sub.size == 0:
        return 0.0
    return float(sub.reshape(-1, 3).std(axis=0).mean())


def main() -> int:
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 40
    tags = sorted(p.stem for p in (DATA / "worn").glob("*.jpg"))[:n]

    old_stat, new_stat, old_gfx, new_gfx, old_area, new_area = [], [], [], [], [], []
    # Guards against the obvious way to game this: a scorer that prefers calm
    # regions will happily sample the gaps between flowers on a busy print and
    # call it stationary, throwing away the very pattern being copied.
    old_rich, new_rich, garment_rich = [], [], []
    improved = []

    for tag in tags:
        worn = np.asarray(Image.open(DATA / "worn" / f"{tag}.jpg").convert("RGB"))
        parse = np.asarray(Image.open(DATA / "parse" / f"{tag}.png").convert("L"))
        gt = np.isin(parse, GT_UPPER)
        if gt.sum() < 500:
            continue

        r_old = P.largest_interior_patch(gt)
        r_new = P.best_fabric_patch(gt, worn)
        if r_old is None or r_new is None:
            continue

        so = P._stationarity(worn[r_old[1]:r_old[3], r_old[0]:r_old[2]])
        sn = P._stationarity(worn[r_new[1]:r_new[3], r_new[0]:r_new[2]])
        go = graphic_fraction(worn, gt, r_old)
        gn = graphic_fraction(worn, gt, r_new)

        old_stat.append(so); new_stat.append(sn)
        old_gfx.append(go); new_gfx.append(gn)
        old_area.append((r_old[2] - r_old[0]) * (r_old[3] - r_old[1]))
        new_area.append((r_new[2] - r_new[0]) * (r_new[3] - r_new[1]))
        old_rich.append(richness(worn, r_old))
        new_rich.append(richness(worn, r_new))
        gp = worn[gt].astype(np.float32)
        garment_rich.append(float(gp.std(axis=0).mean()))
        if go - gn > 0.05:
            improved.append((tag, go, gn))

    o_s, n_s = np.array(old_stat), np.array(new_stat)
    o_g, n_g = np.array(old_gfx), np.array(new_gfx)
    o_a, n_a = np.array(old_area, float), np.array(new_area, float)

    print(f"{len(o_s)} garments\n")
    print(f"{'metric':<42} {'largest':>10} {'fabric-aware':>14}")
    print("-" * 68)
    print(f"{'stationarity (the objective; higher better)':<42} "
          f"{o_s.mean():10.3f} {n_s.mean():14.3f}")
    print(f"{'  -- median':<42} {np.median(o_s):10.3f} {np.median(n_s):14.3f}")
    print()
    print(f"{'graphic content (independent; lower better)':<42} "
          f"{100 * o_g.mean():9.1f}% {100 * n_g.mean():13.1f}%")
    print(f"{'  -- median':<42} {100 * np.median(o_g):9.1f}% {100 * np.median(n_g):13.1f}%")
    print(f"{'  -- worst case':<42} {100 * o_g.max():9.1f}% {100 * n_g.max():13.1f}%")
    print(f"{'  -- patches above 15% graphic':<42} "
          f"{int((o_g > 0.15).sum()):10d} {int((n_g > 0.15).sum()):14d}")
    o_r, n_r, g_r = np.array(old_rich), np.array(new_rich), np.array(garment_rich)
    print()
    print(f"{'pattern richness vs the garment (want ~1)':<42} "
          f"{(o_r / np.maximum(g_r, 1e-6)).mean():10.2f} {(n_r / np.maximum(g_r, 1e-6)).mean():14.2f}")
    lost = (n_r < o_r * 0.7).sum()
    print(f"{'  -- patches losing >30% of their pattern':<42} {0:10d} {int(lost):14d}")
    print()
    print(f"{'patch area kept (relative)':<42} {1.0:10.2f} {(n_a / o_a).mean():14.2f}")

    if improved:
        print(f"\nmoved off a graphic ({len(improved)} garments):")
        for tag, go, gn in sorted(improved, key=lambda x: x[2] - x[1])[:10]:
            print(f"   {tag}: {100 * go:5.1f}% -> {100 * gn:5.1f}% graphic")

    worse = [(t, o, nn) for t, o, nn in
             zip(tags[:len(o_g)], o_g, n_g) if nn - o > 0.05]
    if worse:
        print(f"\nregressed ({len(worse)}):")
        for t, o, nn in worse[:5]:
            print(f"   {t}: {100 * o:5.1f}% -> {100 * nn:5.1f}%")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
