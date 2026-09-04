"""Reading a garment's body width off its silhouette.

Scale transfer needs a pixel measurement that stands for the same physical
thing on every garment. The median row width of the mask does that well for
garments whose body runs straight down, and badly for two common shapes:

  * a gown or skirt flares, so most of its rows cross the hem rather than the
    body, and the median reports the skirt's sweep; and
  * trousers split, so a row crosses two legs and the median reports the sum
    of their widths, which is narrower than the hips.

Measured on synthetic garments of known size, that costs +43% on a gown, +43%
on a skirt and -20% on trousers, while straight garments sit within 4%.

So the silhouette is classified first, and the measurement is taken wherever
that shape actually touches the body: straight garments at the body itself,
flared and legged ones at the top, where they hang from the shoulders or hips.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

STRAIGHT = "straight"
FLARED = "flared"
LEGGED = "legged"

# Rows thinner than this fraction of the widest row are ignored: they are
# neckline tips, hem edges, and the gaps a belt leaves in the mask.
MIN_ROW_FRAC = 0.05

# A row counts as legged when it crosses two or more separate runs of garment.
# Trousers hold that for most of their length; a slit in a skirt does not.
LEGGED_ROW_FRAC = 0.35

# The hem is this much wider than the body before the garment reads as flared.
FLARE_RATIO = 1.25

# Where to look for the top landmark on a flared or legged garment. The very
# top is skipped -- it is a shoulder tip, a strap, or the lip of a waistband.
TOP_SKIP = 0.03
TOP_BAND = 0.20

# Assumed real-world body width in centimetres for each silhouette, matched to
# the landmark each one measures. Adult size-M flat measurements.
SILHOUETTE_WIDTH_CM: dict[str, float] = {
    STRAIGHT: 44.0,  # chest, measured across the body below the sleeves
    FLARED: 42.0,    # bust or upper hip, where the garment hangs from
    LEGGED: 44.0,    # hips, at the waistband
}


@dataclass
class BodyWidth:
    width_px: float
    silhouette: str
    landmark: str
    confidence: float
    width_cm: float

    @property
    def px_per_cm(self) -> float:
        return max(1e-6, self.width_px / max(1e-6, self.width_cm))


def _row_runs(row: np.ndarray) -> int:
    if not row.any():
        return 0
    d = np.diff(row.astype(np.int8))
    return int((d == 1).sum() + (1 if row[0] else 0))


def body_width(mask: np.ndarray) -> BodyWidth:
    """Measure the garment's body width, in pixels, from its mask."""
    if not mask.any():
        return BodyWidth(1.0, STRAIGHT, "empty", 0.0, SILHOUETTE_WIDTH_CM[STRAIGHT])

    ys, xs = np.nonzero(mask)
    sub = mask[ys.min(): ys.max() + 1, xs.min(): xs.max() + 1]
    h = sub.shape[0]

    widths = sub.sum(axis=1).astype(float)
    peak = widths.max()
    valid = widths >= peak * MIN_ROW_FRAC
    if not valid.any():
        return BodyWidth(float(peak), STRAIGHT, "peak", 0.2, SILHOUETTE_WIDTH_CM[STRAIGHT])

    median_w = float(np.median(widths[valid]))

    # --- classify the silhouette -------------------------------------------
    lower = slice(h // 2, h)
    lower_valid = valid[lower]
    if lower_valid.any():
        runs = np.array([_row_runs(sub[i]) for i in range(h // 2, h)])
        legged_frac = float((runs[lower_valid] >= 2).mean())
    else:
        legged_frac = 0.0

    hem_band = widths[int(h * 0.80):]
    hem_band = hem_band[hem_band >= peak * MIN_ROW_FRAC]
    hem_w = float(np.median(hem_band)) if hem_band.size else median_w
    flare = hem_w / max(median_w, 1e-6)

    if legged_frac >= LEGGED_ROW_FRAC:
        silhouette = LEGGED
    elif flare >= FLARE_RATIO:
        silhouette = FLARED
    else:
        silhouette = STRAIGHT

    # --- measure where that shape meets the body ---------------------------
    if silhouette == STRAIGHT:
        # The body runs straight down, so most rows cross it. Sleeves are a
        # minority and the median steps over them.
        width_px = median_w
        landmark = "median row"
        confidence = 0.9
    else:
        # Take the widest row near the top: for a gown that is the bust, for a
        # skirt or trousers the hip just under the waistband. Widest rather
        # than median because the band may also contain a narrow strap or the
        # nip of a waist.
        lo = int(h * TOP_SKIP)
        hi = max(lo + 1, int(h * TOP_BAND))
        band = widths[lo:hi]
        band = band[band >= peak * MIN_ROW_FRAC]
        if band.size:
            width_px = float(band.max())
            landmark = "top band max"
            confidence = 0.75
        else:
            width_px = median_w
            landmark = "median row (fallback)"
            confidence = 0.4

    return BodyWidth(
        width_px=float(width_px),
        silhouette=silhouette,
        landmark=landmark,
        confidence=confidence,
        width_cm=SILHOUETTE_WIDTH_CM[silhouette],
    )
