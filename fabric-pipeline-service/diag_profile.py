"""Dump each garment's row-width profile, to ground the silhouette heuristics.

  .venv/bin/python diag_profile.py <image> [image ...]

Prints the mask's width at 10 evenly spaced heights, normalised to the widest
row, plus how many separate runs of garment each row contains (which is what
tells legs apart from a skirt).
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image

import segmenter as S


def runs_in_row(row: np.ndarray) -> int:
    """Number of separate garment segments across one row."""
    if not row.any():
        return 0
    d = np.diff(row.astype(np.int8))
    return int((d == 1).sum() + (1 if row[0] else 0))


def main() -> int:
    for path in sys.argv[1:]:
        img = Image.open(path).convert("RGB")
        seg = S.segmenter.segment(img)
        if seg.is_empty:
            print(f"\n{Path(path).name}: no garment")
            continue

        x0, y0, x1, y1 = seg.bbox
        sub = seg.mask[y0:y1, x0:x1]
        h = sub.shape[0]

        widths = sub.sum(axis=1).astype(float)
        peak = widths.max()

        print(f"\n=== {Path(path).name}  mask {sub.shape[1]}x{sub.shape[0]} ===")
        print(f"   {'depth':>6} {'width':>7} {'norm':>6} {'runs':>5}   profile")
        for frac in np.linspace(0.02, 0.98, 13):
            i = min(h - 1, int(frac * h))
            wpx = widths[i]
            norm = wpx / peak if peak else 0
            bar = "#" * int(norm * 40)
            print(f"   {frac:6.2f} {wpx:7.0f} {norm:6.2f} {runs_in_row(sub[i]):5d}   {bar}")

        # Summary statistics the classifier could key on.
        top = widths[: max(1, h // 5)].mean()
        bottom = widths[-max(1, h // 5):].mean()
        multi = np.mean([runs_in_row(sub[i]) >= 2 for i in range(h // 2, h)])
        print(f"   top20% mean {top:.0f}   bottom20% mean {bottom:.0f}   "
              f"bottom/top {bottom / max(top, 1e-6):.2f}")
        print(f"   fraction of lower half with 2+ runs: {multi:.2f}")
        print(f"   aspect (h/w): {sub.shape[0] / max(1, sub.shape[1]):.2f}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
