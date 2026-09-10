"""Stress the scale estimator on garments it was not tuned against.

  .venv/bin/python eval_robust.py [n_trials]

eval_scale.py grades against nine hand-written silhouettes, and geometry.py was
written while looking at them -- so a good score there partly measures how well
the heuristics memorised those nine shapes. This generates randomised garments
instead: body widths, lengths, sleeve spans, flare amounts and leg splits all
drawn per trial, plus mask noise and rotation. Nothing here was inspected while
writing the thresholds.
"""

from __future__ import annotations

import sys

import numpy as np
from PIL import Image

import geometry
import synthetic


def random_garment(rng: np.random.Generator) -> tuple[np.ndarray, float, float, str]:
    """Build a random but anatomically plausible garment.

    Returns (mask, px_per_cm, body_cm, kind).
    """
    kind = rng.choice(["straight", "flared", "legged"])
    px_per_cm = float(rng.uniform(3.0, 14.0))
    body_cm = float(rng.uniform(34.0, 56.0))

    if kind == "straight":
        length = float(rng.uniform(45, 85))
        sleeve = body_cm * rng.uniform(1.05, 1.9)   # from cap sleeve to long
        sleeve_end = rng.uniform(0.15, 0.45)
        strap = rng.uniform(0.15, 1.0)              # 0.15 = spaghetti strap
        profile = [
            (0.00, body_cm * strap),
            (min(0.9, sleeve_end * 0.6), sleeve),
            (min(0.95, sleeve_end + 0.08), body_cm * rng.uniform(1.0, 1.08)),
            (1.00, body_cm * rng.uniform(0.95, 1.05)),
        ]
        splits = None
    elif kind == "flared":
        length = float(rng.uniform(55, 150))
        top = body_cm
        waist = body_cm * rng.uniform(0.75, 0.95)
        hem = body_cm * rng.uniform(1.4, 3.2)
        profile = [
            (0.00, top * rng.uniform(0.85, 1.0)),
            (rng.uniform(0.05, 0.14), top),
            (rng.uniform(0.22, 0.38), waist),
            (0.70, (waist + hem) / 2),
            (1.00, hem),
        ]
        splits = None
    else:
        length = float(rng.uniform(40, 110))
        profile = [
            (0.00, body_cm),
            (0.12, body_cm * rng.uniform(0.93, 1.0)),
            (0.30, body_cm * rng.uniform(0.85, 0.98)),
            (1.00, body_cm * rng.uniform(0.62, 0.9)),
        ]
        splits = float(rng.uniform(0.22, 0.5))

    spec = {"length_cm": length, "profile": profile, "body_cm": body_cm}
    if splits is not None:
        spec["splits"] = splits
        spec["gap_cm"] = float(rng.uniform(1.0, 4.0))

    name = f"rand_{kind}"
    synthetic.GARMENTS[name] = spec
    g = synthetic.build(name, px_per_cm, seed=int(rng.integers(1e6)))
    del synthetic.GARMENTS[name]

    mask = g.mask

    # Roughen it the way a real segmentation would be: a ragged edge, the odd
    # speck, and a garment that is not perfectly upright in frame.
    if rng.random() < 0.7:
        noise = rng.random(mask.shape) < 0.02
        edge = mask ^ np.roll(mask, 1, axis=1)
        mask = mask ^ (noise & edge)
    if rng.random() < 0.5:
        angle = float(rng.uniform(-7, 7))
        mask = np.asarray(
            Image.fromarray(mask.astype(np.uint8) * 255).rotate(angle, resample=Image.BILINEAR)
        ) > 127

    return mask, px_per_cm, body_cm, kind


def median_row_width(mask: np.ndarray) -> float:
    widths = mask.sum(axis=1)
    widths = widths[widths > 0]
    return float(np.median(widths)) if widths.size else 1.0


def main() -> int:
    trials = int(sys.argv[1]) if len(sys.argv) > 1 else 240
    rng = np.random.default_rng(20260904)

    samples = []
    for _ in range(trials):
        mask, ppc, body_cm, kind = random_garment(rng)
        if not mask.any():
            continue
        info = geometry.body_width(mask)
        samples.append({
            "true_ppc": ppc,
            "kind": kind,
            "detected": info.silhouette,
            # px/cm each estimator implies. The assumed cm cancels in a ratio,
            # so the true body_cm is used for both -- this scores the pixel
            # measurement, not the constants.
            "geo": info.width_px / body_cm,
            "med": median_row_width(mask) / body_cm,
        })

    print(f"{len(samples)} randomised garments\n")

    # Silhouette classification accuracy.
    correct = sum(1 for s in samples if s["detected"] == s["kind"])
    print(f"silhouette classified correctly: {correct}/{len(samples)} "
          f"({100 * correct / len(samples):.0f}%)")
    confusion: dict[tuple[str, str], int] = {}
    for s in samples:
        key = (s["kind"], s["detected"])
        confusion[key] = confusion.get(key, 0) + 1
    for (truth, got), n in sorted(confusion.items()):
        if truth != got:
            print(f"   {truth} misread as {got}: {n}")

    # Transfer error over random pairs.
    print(f"\n{'estimator':<16} {'mean':>7} {'median':>7} {'p90':>7} {'max':>7} {'<15%':>7}")
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
              f"{100 * (errs < 0.15).mean():6.0f}%")

    # Per-kind breakdown for the new estimator.
    print(f"\n{'kind':<10} {'n':>4} {'mean abs error of implied px/cm':>34}")
    for kind in ("straight", "flared", "legged"):
        rows = [s for s in samples if s["kind"] == kind]
        if not rows:
            continue
        e = np.array([abs(s["geo"] - s["true_ppc"]) / s["true_ppc"] for s in rows])
        print(f"{kind:<10} {len(rows):>4} {100 * e.mean():33.1f}%")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
