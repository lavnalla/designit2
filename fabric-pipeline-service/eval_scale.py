"""Score scale estimators against synthetic garments of known physical size.

  .venv/bin/python eval_scale.py

An estimator's job is to return a pixel measurement that stands for the same
physical thing on every garment. It is scored on transfer error: for each
ordered pair, how far the ratio of its two estimates lands from the ratio of
the true pixels-per-centimetre. A perfect estimator scores 0% on every pair,
whatever the garments.
"""

from __future__ import annotations

import numpy as np

import synthetic

# Each garment is rendered at a different density on purpose: a good estimator
# has to recover the ratio from the silhouette, not from the image size.
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


def median_row_width(mask: np.ndarray) -> float:
    """The estimator currently in segmenter.py."""
    widths = mask.sum(axis=1)
    widths = widths[widths > 0]
    return float(np.median(widths)) if widths.size else 1.0


def bbox_width(mask: np.ndarray) -> float:
    """The estimator before that, kept for comparison."""
    xs = np.nonzero(mask.any(axis=0))[0]
    return float(xs.max() - xs.min() + 1) if xs.size else 1.0


def evaluate(name: str, fn, garments: list, verbose: bool = True) -> dict:
    # px_per_cm the estimator implies, if its measurement is taken to be the
    # garment's body width. The assumed cm cancels in the ratio, so any
    # constant works here -- what matters is consistency across silhouettes.
    est = {g.name: fn(g.mask) / g.body_cm for g in garments}
    true = {g.name: g.px_per_cm for g in garments}

    errors = []
    worst = None
    for a in garments:
        for b in garments:
            if a.name == b.name:
                continue
            got = est[b.name] / est[a.name]
            want = true[b.name] / true[a.name]
            err = abs(got - want) / want
            errors.append(err)
            if worst is None or err > worst[0]:
                worst = (err, a.name, b.name, got, want)

    errors = np.array(errors)
    result = {
        "name": name,
        "mean": float(errors.mean()),
        "median": float(np.median(errors)),
        "p90": float(np.percentile(errors, 90)),
        "max": float(errors.max()),
        "within_15": float((errors < 0.15).mean()),
        "worst": worst,
    }

    if verbose:
        print(f"\n--- {name} ---")
        print(f"   mean error {100 * result['mean']:5.1f}%   median {100 * result['median']:5.1f}%   "
              f"p90 {100 * result['p90']:5.1f}%   max {100 * result['max']:5.1f}%")
        print(f"   pairs within 15%: {100 * result['within_15']:.0f}%")
        e, a, b, got, want = worst
        print(f"   worst pair: {a} -> {b}  estimated x{got:.2f}, true x{want:.2f} ({100 * e:+.0f}%)")

    return result


def per_garment_table(fn, garments: list) -> None:
    print(f"\n   {'garment':<13} {'true px/cm':>11} {'measured px':>12} {'implied px/cm':>14} {'error':>8}")
    for g in garments:
        measured = fn(g.mask)
        implied = measured / g.body_cm
        err = (implied - g.px_per_cm) / g.px_per_cm
        print(f"   {g.name:<13} {g.px_per_cm:11.2f} {measured:12.0f} {implied:14.2f} {100 * err:+7.0f}%")


def main() -> int:
    garments = [synthetic.build(n, ppc) for n, ppc in CASES]

    print("=== synthetic garments (ground truth known by construction) ===")
    for g in garments:
        print(f"   {g.name:<13} {g.px_per_cm:5.1f} px/cm   body {g.body_cm:.0f}cm "
              f"-> {g.true_body_px:.0f}px   image {g.image.size}")

    print("\n\n########## BASELINE: estimators in use so far ##########")
    r_bbox = evaluate("bbox width (original)", bbox_width, garments)
    per_garment_table(bbox_width, garments)
    r_med = evaluate("median row width (current)", median_row_width, garments)
    per_garment_table(median_row_width, garments)

    try:
        import geometry
    except ImportError:
        print("\n(geometry.py not present yet)")
        return 0

    print("\n\n########## NEW: silhouette-aware landmark ##########")
    evaluate("geometry.body_width", lambda m: geometry.body_width(m).width_px, garments)
    per_garment_table(lambda m: geometry.body_width(m).width_px, garments)

    print(f"\n   {'garment':<13} {'detected type':<16} {'landmark':<14} {'conf':>5}")
    for g in garments:
        info = geometry.body_width(g.mask)
        print(f"   {g.name:<13} {info.silhouette:<16} {info.landmark:<14} {info.confidence:5.2f}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
