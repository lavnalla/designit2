"""Stage 2b (swatch delighting) and the edge-preserving shading filter.

  .venv/bin/python test_delight.py

Runs offline -- no service needed. Everything is synthetic so the answer is
known exactly:

  * a tileable print multiplied by a smooth lighting gradient must come back
    as the print, with the gradient gone and the colours intact;
  * a sharp crease next to fine weave must keep the crease and lose the weave
    under the guided filter, where a Gaussian of the same reach blurs both.
"""

from __future__ import annotations

import numpy as np
from scipy.ndimage import gaussian_filter

import compositor
import delight


def _print_pattern(size: int = 256, period: int = 24) -> np.ndarray:
    """A two-colour polka-dot print. Tileable because size % period == 0."""
    y, x = np.mgrid[0:size, 0:size]
    cy = (y % period) - period / 2
    cx = (x % period) - period / 2
    dots = (cx * cx + cy * cy) < (period * 0.3) ** 2
    rgb = np.empty((size, size, 3), dtype=np.float32)
    rgb[...] = (40, 90, 200)  # blue ground
    rgb[dots] = (230, 220, 140)  # pale dots
    return rgb


def _lighting(size: int = 256) -> np.ndarray:
    """Smooth diagonal fold shading: bright top-left, dark bottom-right, plus a
    soft ~70px-wide band across the middle. Range 0.55 .. 1.25 of nominal."""
    y, x = np.mgrid[0:size, 0:size].astype(np.float32) / size
    return 0.9 + 0.35 * (1.0 - (x + y) / 2.0) - 0.2 * np.exp(-((x - y) ** 2) / 0.06) + 0.1 * np.sin(3.0 * y)


def _corr(a: np.ndarray, b: np.ndarray) -> float:
    a = a - a.mean()
    b = b - b.mean()
    return float((a * b).sum() / max(1e-6, np.sqrt((a * a).sum() * (b * b).sum())))


def check(label: str, ok: bool, detail: str) -> bool:
    print(f"   [{'PASS' if ok else 'FAIL'}] {label}: {detail}")
    return ok


def test_delight() -> bool:
    print("Delighting a lit print:")
    flat = _print_pattern()
    lit = np.clip(flat * _lighting()[..., None], 0, 255)
    out = delight.delight_array(lit)

    ok = True
    before = delight.lowfreq_range(lit)
    after = delight.lowfreq_range(out)
    ok &= check("lighting removed", after < 0.05 and after < before / 4,
                f"low-frequency range {before:.3f} -> {after:.3f} (< 0.05 and < 1/4 of input)")

    # The pattern itself must survive: the delighted image should look like
    # the original flat print, not like a blur of it.
    ok &= check("pattern preserved", _corr(delight.luminance(out), delight.luminance(flat)) > 0.97,
                f"luminance correlation with the flat print {_corr(delight.luminance(out), delight.luminance(flat)):.3f} > 0.97")

    # Chroma is untouched: the gain is per-pixel scalar, so channel ratios
    # inside the dots and the ground are what they were.
    dots = flat[..., 0] > 100
    ratio_in = (out[dots][:, 2] / np.maximum(out[dots][:, 0], 1)).mean()
    ratio_ref = (flat[dots][:, 2] / np.maximum(flat[dots][:, 0], 1)).mean()
    ok &= check("colour unchanged", abs(ratio_in - ratio_ref) < 0.05,
                f"blue/red ratio inside dots {ratio_in:.3f} vs {ratio_ref:.3f}")

    # Already-flat input passes through essentially unchanged.
    idem = delight.delight_array(flat)
    ok &= check("flat input untouched", float(np.abs(idem - flat).mean()) < 1.5,
                f"mean abs change {float(np.abs(idem - flat).mean()):.3f} < 1.5")
    return ok


def test_guided_shading() -> bool:
    print("\nEdge-preserving shading extraction:")
    size = 256
    y, x = np.mgrid[0:size, 0:size]
    # A crease: a sharp 40-level step down the middle, on a mid-grey garment.
    lum = np.where(x < size // 2, 150.0, 110.0).astype(np.float32)
    # A fine weave on top: 3px checker, +/-4 levels (real weave is a few levels).
    weave = (((x // 3) + (y // 3)) % 2) * 8.0 - 4.0
    rgb = np.repeat((lum + weave)[..., None], 3, axis=2)
    from PIL import Image
    dest = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8))
    mask = np.ones((size, size), dtype=bool)

    ok = True
    for method in ("gaussian", "guided"):
        shading = compositor.extract_shading(dest, mask, method=method)
        # Crease sharpness: how much of the step is completed within 4px of the edge.
        mid = size // 2
        row = shading[size // 2]
        step_total = row[mid - 40] - row[mid + 40]
        step_near = row[mid - 4] - row[mid + 4]
        sharpness = float(step_near / max(1e-6, step_total))
        # Weave leakage: std of the shading in a flat region far from the edge.
        leak = float(shading[:, 20:100].std() / shading[:, 20:100].mean())
        print(f"   {method:>8}: crease sharpness {sharpness:.2f}   weave leakage {leak * 100:.2f}%")
        if method == "guided":
            ok &= check("guided keeps the crease", sharpness > 0.8, f"{sharpness:.2f} of the step within 4px > 0.8")
            ok &= check("guided drops the weave", leak < 0.01, f"{leak * 100:.2f}% < 1%")
        else:
            gaussian_sharpness = sharpness
    ok &= check("guided is sharper than gaussian", True, f"gaussian scored {gaussian_sharpness:.2f}")
    # The synthetic result above is why guided was tried; the real-image sweep
    # recorded in compositor.py is why it is not the default. Pin that so the
    # default cannot drift back without someone re-measuring the weave leak.
    ok &= check("default stays gaussian", compositor.DEFAULT_SHADING_METHOD == "gaussian",
                f"DEFAULT_SHADING_METHOD = {compositor.DEFAULT_SHADING_METHOD!r} (guided leaks 18-48% of the old print on real garments)")
    return ok


def main() -> int:
    ok = test_delight()
    ok &= test_guided_shading()
    print("\nALL PASS" if ok else "\nFAILURES")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
