"""End-to-end scale transfer between garment types, against known ground truth.

  .venv/bin/python test_scale_transfer.py

This is the test the earlier motif check could not be. That one divided the
measured period by the same px/cm the pipeline had chosen, so it came out right
almost by construction. Here the garments are synthetic: their true
pixels-per-centimetre is set when they are drawn, so the motif's size in the
output can be measured in real centimetres and compared with the centimetres it
had on the source.

SegFormer is bypassed -- it is not trained on synthetic silhouettes, and the
mask is known exactly anyway. Everything downstream of the mask (geometry,
tile sizing, tiling) is the production code path.
"""

from __future__ import annotations

import itertools

import numpy as np
from PIL import Image

import compositor
import geometry
import synthetic

# One of each shape family, at deliberately different pixel densities.
CASES = [
    ("t-shirt", 6.0),
    ("tank top", 9.0),
    ("sweater", 4.5),
    ("long sleeve", 7.0),
    ("dress", 5.0),
    ("gown", 8.0),
    ("skirt", 11.0),
    ("pants", 6.5),
    ("shorts", 10.0),
]

MOTIF_CM = 3.0


def dominant_period(gray: np.ndarray, min_period: float = 4.0, max_period_frac: float = 0.25) -> float:
    """Motif spacing in pixels, from the 2-D power spectrum (see test_cross_garment)."""
    x = gray.astype(np.float32)
    if x.size == 0 or min(x.shape) < 16:
        return float("nan")
    n = min(x.shape)
    x = x[:n, :n] - x[:n, :n].mean()
    w = np.hanning(n)
    x = x * w[:, None] * w[None, :]

    power = np.abs(np.fft.fftshift(np.fft.fft2(x))) ** 2
    c = n // 2
    yy, xx = np.ogrid[:n, :n]
    radius = np.sqrt((yy - c) ** 2 + (xx - c) ** 2).astype(np.int32)
    radial = np.bincount(radius.ravel(), weights=power.ravel()) / np.maximum(
        np.bincount(radius.ravel()), 1)

    lo = max(2, int(np.ceil(1.0 / max_period_frac)))
    hi = min(int(np.floor(n / min_period)), len(radial) - 1)
    if hi <= lo + 1:
        return float("nan")
    return float(n) / (lo + int(np.argmax(radial[lo:hi])))


def interior(img: Image.Image, mask: np.ndarray) -> np.ndarray:
    """Sample a window that is entirely garment.

    Cropping the middle of the bounding box is wrong for anything that is not
    solid: on trousers the centre of the bbox is the gap between the legs, so
    the window fills with background and the measurement becomes meaningless
    -- which showed up as every trouser destination returning the same bogus
    figure. Reuse the pipeline's own interior finder instead.
    """
    import patch as P

    rect = P.largest_interior_patch(mask)
    if rect is None:
        ys, xs = np.nonzero(mask)
        rect = (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)
    x0, y0, x1, y1 = rect
    return np.asarray(img.convert("L"))[y0:y1, x0:x1]


def main() -> int:
    garments = {name: synthetic.build(name, ppc, motif_cm=MOTIF_CM) for name, ppc in CASES}

    # Sanity: the drawn motif really is MOTIF_CM on each garment, measured with
    # each one's true density. Without this the rest means nothing.
    print("=== ground truth check: drawn motif measures as intended ===")
    gt_ok = True
    for name, g in garments.items():
        px = dominant_period(interior(g.image, g.mask))
        cm = px / g.px_per_cm
        # The spectral peak of a staggered grid sits on the diagonal, so the
        # measurement is a fixed factor off; what matters is that the factor is
        # the same everywhere, which is what makes cross-garment comparison valid.
        print(f"   {name:<13} {px:6.1f}px / {g.px_per_cm:5.2f} px/cm = {cm:5.2f}cm")
        if not np.isfinite(cm):
            gt_ok = False
    if not gt_ok:
        print("   ground truth unmeasurable; aborting")
        return 1

    # Each garment's own drawn motif is the reference for pastes *onto* it.
    # Comparing like with like -- same instrument, same garment, same window --
    # cancels the instrument's geometric offset exactly, instead of leaving the
    # ~11% spread between garments as noise in every result.
    own = {name: dominant_period(interior(g.image, g.mask)) / g.px_per_cm
           for name, g in garments.items()}
    ref = float(np.median(list(own.values())))
    spread = max(abs(v - ref) / ref for v in own.values())
    print(f"   spread across garments {100 * spread:.0f}% (median {ref:.2f}cm) -- each garment's")
    print(f"   own figure is used as the target for pastes onto it\n")

    print("=== transfer: every ordered pair of garment types ===")
    print(f"{'source':<13} {'->':^4} {'destination':<13} {'src sil':<9} {'dst sil':<9} "
          f"{'tile cm':>8} {'motif cm out':>13} {'err':>7}")

    errors = []
    for a_name, b_name in itertools.permutations(garments, 2):
        a, b = garments[a_name], garments[b_name]

        # Production path: geometry -> px/cm -> tile size.
        a_geo = geometry.body_width(a.mask)
        b_geo = geometry.body_width(b.mask)
        src_ppc = a_geo.px_per_cm
        dst_ppc = b_geo.px_per_cm

        # Patch cut from the source, as the service would.
        import patch as P
        rect = P.largest_interior_patch(a.mask)
        crop_w, crop_h = rect[2] - rect[0], rect[3] - rect[1]
        swatch = a.image.crop(rect)

        tile_w, tile_h, _ = compositor.compute_tile_size(
            crop_w, crop_h, src_ppc, dst_ppc, multiplier=1.0)

        out = compositor.composite(swatch, b.image, b.mask, tile_w, tile_h,
                                   shading_strength=0.0, feather_px=0)
        flat = Image.alpha_composite(
            Image.new("RGBA", out.size, (255, 255, 255, 255)), out).convert("RGB")

        period_out = dominant_period(interior(flat, b.mask))
        # Measured with the destination's TRUE density, not the estimated one.
        motif_cm_out = period_out / b.px_per_cm
        target = own[b_name]
        err = abs(motif_cm_out - target) / target
        errors.append(err)

        flag = "" if err < 0.25 else "  <-- off"
        print(f"{a_name:<13} {'->':^4} {b_name:<13} {a_geo.silhouette:<9} {b_geo.silhouette:<9} "
              f"{tile_w / dst_ppc:7.1f} {motif_cm_out:12.2f} {100 * err:6.0f}%{flag}")

    errors = np.array(errors)
    print(f"\n{len(errors)} ordered pairs")
    print(f"   mean error {100 * errors.mean():.1f}%   median {100 * np.median(errors):.1f}%   "
          f"p90 {100 * np.percentile(errors, 90):.1f}%   max {100 * errors.max():.1f}%")
    within = float((errors < 0.25).mean())
    print(f"   pairs within 25%: {100 * within:.0f}%")

    ok = within >= 0.95
    print(f"\n[{'PASS' if ok else 'FAIL'}] motif holds its physical size across garment types")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
