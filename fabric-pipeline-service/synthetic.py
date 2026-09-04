"""Synthetic garment silhouettes with a known physical scale.

Real photos cannot validate a scale estimator: nothing in `t-shirt.jpg` says
how many centimetres across it really is, so any check against it is either
circular or an appeal to intuition. These silhouettes are built the other way
round -- from real body measurements at a chosen pixels-per-centimetre -- so
the true answer is known by construction and the estimator's error is
measurable rather than arguable.

Widths are flat-garment measurements in centimetres (the width you would read
off the garment lying flat, i.e. half the circumference), taken from adult
size-M averages.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from PIL import Image

# (depth down the garment 0..1, width in cm). Linearly interpolated between.
# `splits` marks the depth below which the garment separates into two legs.
GARMENTS: dict[str, dict] = {
    "t-shirt": {
        "length_cm": 70.0,
        "profile": [(0.00, 42), (0.06, 44), (0.22, 58), (0.30, 46), (0.40, 44), (1.00, 44)],
        "body_cm": 44.0,
    },
    "tank top": {
        "length_cm": 55.0,
        "profile": [(0.00, 8), (0.10, 14), (0.30, 34), (0.45, 40), (1.00, 38)],
        "body_cm": 40.0,
    },
    "sweater": {
        "length_cm": 72.0,
        "profile": [(0.00, 46), (0.06, 48), (0.26, 64), (0.36, 50), (0.45, 48), (1.00, 48)],
        "body_cm": 48.0,
    },
    "long sleeve": {
        "length_cm": 70.0,
        "profile": [(0.00, 44), (0.05, 46), (0.30, 78), (0.40, 47), (0.50, 45), (1.00, 45)],
        "body_cm": 45.0,
    },
    "dress": {
        "length_cm": 100.0,
        "profile": [(0.00, 40), (0.10, 42), (0.30, 34), (0.55, 46), (1.00, 62)],
        "body_cm": 42.0,
    },
    "gown": {
        "length_cm": 140.0,
        "profile": [(0.00, 40), (0.08, 42), (0.28, 34), (0.50, 60), (0.75, 95), (1.00, 120)],
        "body_cm": 42.0,
    },
    "skirt": {
        "length_cm": 60.0,
        "profile": [(0.00, 34), (0.15, 40), (0.60, 62), (1.00, 80)],
        "body_cm": 40.0,
    },
    "pants": {
        "length_cm": 100.0,
        "profile": [(0.00, 44), (0.10, 42), (0.25, 40), (0.60, 34), (1.00, 30)],
        "body_cm": 42.0,
        "splits": 0.28,
        "gap_cm": 2.0,
    },
    "shorts": {
        "length_cm": 45.0,
        "profile": [(0.00, 44), (0.15, 43), (0.35, 42), (1.00, 40)],
        "body_cm": 42.0,
        "splits": 0.45,
        "gap_cm": 2.0,
    },
}


@dataclass
class SyntheticGarment:
    name: str
    mask: np.ndarray
    image: Image.Image
    px_per_cm: float
    body_cm: float
    motif_cm: float

    @property
    def true_body_px(self) -> float:
        return self.body_cm * self.px_per_cm


def _width_at(profile: list[tuple[float, float]], depth: float) -> float:
    xs = [p[0] for p in profile]
    ys = [p[1] for p in profile]
    return float(np.interp(depth, xs, ys))


def build(
    name: str,
    px_per_cm: float,
    motif_cm: float = 3.0,
    margin_px: int = 24,
    seed: int = 0,
) -> SyntheticGarment:
    """Render one garment at a known scale, printed with a known-size motif."""
    spec = GARMENTS[name]
    length_px = int(round(spec["length_cm"] * px_per_cm))
    max_w_px = int(round(max(w for _, w in spec["profile"]) * px_per_cm))

    h = length_px + 2 * margin_px
    w = max_w_px + 2 * margin_px
    mask = np.zeros((h, w), dtype=bool)
    cx = w // 2

    splits = spec.get("splits")
    gap_px = spec.get("gap_cm", 0.0) * px_per_cm

    for row in range(length_px):
        depth = row / max(1, length_px - 1)
        width_px = _width_at(spec["profile"], depth) * px_per_cm
        y = row + margin_px

        if splits is not None and depth >= splits:
            # Two legs, separated by a gap that opens up below the split.
            ramp = min(1.0, (depth - splits) / 0.12)
            gap = gap_px * ramp
            leg = max(1.0, (width_px - gap) / 2.0)
            for sign in (-1, 1):
                inner = cx + sign * gap / 2.0
                outer = inner + sign * leg
                a, b = sorted((int(round(inner)), int(round(outer))))
                mask[y, max(0, a): min(w, b)] = True
        else:
            half = width_px / 2.0
            mask[y, max(0, int(round(cx - half))): min(w, int(round(cx + half)))] = True

    # Print a dot motif at a known physical spacing.
    period_px = motif_cm * px_per_cm
    yy, xx = np.mgrid[:h, :w]
    dots = (np.sin(2 * np.pi * xx / period_px) * np.sin(2 * np.pi * yy / period_px)) > 0.25

    rng = np.random.default_rng(seed)
    base = np.zeros((h, w, 3), dtype=np.float32)
    base[..., :] = np.array([40, 90, 170], dtype=np.float32)
    base[dots] = np.array([230, 210, 120], dtype=np.float32)
    # A little shading so the photometric stage has something to work with.
    shade = 0.82 + 0.36 * (xx / max(1, w))
    base = base * shade[..., None]
    base += rng.normal(0, 2.0, base.shape)

    rgb = np.full((h, w, 3), 250, dtype=np.uint8)
    rgb[mask] = np.clip(base[mask], 0, 255).astype(np.uint8)

    return SyntheticGarment(
        name=name,
        mask=mask,
        image=Image.fromarray(rgb),
        px_per_cm=px_per_cm,
        body_cm=float(spec["body_cm"]),
        motif_cm=motif_cm,
    )
