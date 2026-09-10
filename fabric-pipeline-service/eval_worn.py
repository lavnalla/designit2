"""Does the silhouette estimator survive a garment being worn rather than flat?

  .venv/bin/python eval_worn.py [n_trials]

eval_robust.py perturbs a flat garment mildly. A garment on a person differs
more systematically: the body is turned, so the silhouette is sheared and
foreshortened; a raised arm or a bag takes a bite out of the mask; the pose is
asymmetric; and the camera is close enough for perspective to widen the near
side.

This applies those distortions to garments of known scale and re-scores. It
tests the *geometry*, not the segmentation -- whether SegFormer returns a good
mask from a real photo of a person is a separate question that needs real
photographs.
"""

from __future__ import annotations

import sys

import numpy as np
from PIL import Image

import eval_robust
import geometry


def wear(mask: np.ndarray, rng: np.random.Generator) -> tuple[np.ndarray, float]:
    """Distort a flat mask the way wearing and photographing one would.

    Returns the mask and the factor by which the garment's apparent width was
    scaled, so ground truth can be adjusted to match.
    """
    img = Image.fromarray(mask.astype(np.uint8) * 255)
    w, h = img.size
    width_factor = 1.0

    # Body turned away from camera: the garment foreshortens horizontally.
    if rng.random() < 0.75:
        turn = float(rng.uniform(0.72, 1.0))
        img = img.resize((max(8, int(w * turn)), h), Image.BILINEAR)
        width_factor *= turn
        w = img.size[0]

    # Leaning or a hip cocked to one side: a horizontal shear.
    if rng.random() < 0.6:
        shear = float(rng.uniform(-0.18, 0.18))
        img = img.transform(
            (int(w + abs(shear) * h), h), Image.AFFINE,
            (1, shear, -shear * h if shear > 0 else 0, 0, 1, 0),
            resample=Image.BILINEAR,
        )

    # Camera close enough that the lower body is nearer than the upper, or the
    # reverse: a mild vertical perspective taper.
    if rng.random() < 0.5:
        taper = float(rng.uniform(0.85, 1.15))
        arr = np.asarray(img) > 127
        out = np.zeros_like(arr)
        hh, ww = arr.shape
        cx = ww / 2
        for y in range(hh):
            s = 1.0 + (taper - 1.0) * (y / max(1, hh - 1))
            xs = np.nonzero(arr[y])[0]
            if xs.size == 0:
                continue
            nx = np.clip(((xs - cx) * s + cx).astype(int), 0, ww - 1)
            out[y, nx] = True
            # Fill the gaps stretching leaves behind.
            out[y, nx.min(): nx.max() + 1] = True
        img = Image.fromarray(out.astype(np.uint8) * 255)
        # The taper averages out over the garment's height.
        width_factor *= (1.0 + taper) / 2.0

    # Whole-body tilt in frame.
    if rng.random() < 0.6:
        img = img.rotate(float(rng.uniform(-12, 12)), resample=Image.BILINEAR, expand=True)

    arr = np.asarray(img) > 127

    # An arm, a bag or a crossed hand occluding part of the garment.
    if rng.random() < 0.55 and arr.any():
        ys, xs = np.nonzero(arr)
        y0, y1 = ys.min(), ys.max()
        x0, x1 = xs.min(), xs.max()
        bh, bw = y1 - y0, x1 - x0
        oy = int(y0 + rng.uniform(0.1, 0.7) * bh)
        ox = int(x0 + rng.uniform(0.0, 0.75) * bw)
        oh = int(bh * rng.uniform(0.08, 0.3))
        ow = int(bw * rng.uniform(0.08, 0.28))
        arr[oy: oy + oh, ox: ox + ow] = False

    return arr, width_factor


def main() -> int:
    trials = int(sys.argv[1]) if len(sys.argv) > 1 else 240
    rng = np.random.default_rng(4242)

    samples = []
    for _ in range(trials):
        mask, ppc, body_cm, kind = eval_robust.random_garment(rng)
        if not mask.any():
            continue
        worn, factor = wear(mask, rng)
        if not worn.any() or worn.sum() < 200:
            continue
        info = geometry.body_width(worn)
        samples.append({
            # The garment now *appears* at a different density; that is the
            # truth the estimator should recover, since it can only see pixels.
            "true_ppc": ppc * factor,
            "kind": kind,
            "detected": info.silhouette,
            "geo": info.width_px / body_cm,
            "med": eval_robust.median_row_width(worn) / body_cm,
        })

    print(f"{len(samples)} worn / photographed garments\n")

    correct = sum(1 for s in samples if s["detected"] == s["kind"])
    print(f"silhouette classified correctly: {correct}/{len(samples)} "
          f"({100 * correct / len(samples):.0f}%)")
    conf: dict[tuple[str, str], int] = {}
    for s in samples:
        if s["kind"] != s["detected"]:
            conf[(s["kind"], s["detected"])] = conf.get((s["kind"], s["detected"]), 0) + 1
    for (truth, got), n in sorted(conf.items()):
        print(f"   {truth} misread as {got}: {n}")

    print(f"\n{'estimator':<16} {'mean':>7} {'median':>7} {'p90':>7} {'max':>7} {'<15%':>7} {'<25%':>7}")
    for key, label in (("geo", "geometry"), ("med", "median row")):
        errs = []
        for i in range(len(samples)):
            for j in range(i + 1, len(samples)):
                a, b = samples[i], samples[j]
                got = b[key] / a[key]
                want = b["true_ppc"] / a["true_ppc"]
                errs.append(abs(got - want) / want)
        errs = np.array(errs)
        print(f"{label:<16} {100 * errs.mean():6.1f}% {100 * np.median(errs):6.1f}% "
              f"{100 * np.percentile(errs, 90):6.1f}% {100 * errs.max():6.1f}% "
              f"{100 * (errs < 0.15).mean():6.0f}% {100 * (errs < 0.25).mean():6.0f}%")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
