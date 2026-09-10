"""Shading removal for swatches, and an edge-preserving low-pass for drape.

Two small pieces of classical image processing that sit either side of the
diffusion rectifier:

``delight``
    Strips the illumination that survives FabricDiffusion. Measured on three
    sources (blouse template, worn floral dress, worn striped sweater) the
    rectified swatch still carried a low-frequency luminance range of 15-26%
    of its mean -- the source's folds, tiled across the target. Dividing the
    luminance by its own wrapped low-pass leaves the pattern and colour and
    removes the lighting, the standard "delighting" step for tileable
    textures. It is numpy only and runs in well under a millisecond at 256px.

``guided_filter``
    An edge-preserving low-pass (He, Sun & Tang, "Guided Image Filtering",
    2010) used on the *destination* when extracting its shading. A Gaussian
    at the radius needed to drop the old fabric's weave also smears the sharp
    edge of a crease into a soft gradient, which is why pasted fabric looked
    flat even with the drape stage on. The guided filter keeps a strong edge
    (variance well above ``eps``) and smooths weak texture (variance below
    it), so folds stay crisp while the weave still averages out.

Both operate on float32 arrays in the 0..255 range.
"""

from __future__ import annotations

import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter, uniform_filter

# Rec. 709 luma weights, shared by every luminance computation here.
LUMA = np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)

# Blur radius for delighting, as a fraction of the swatch's longer side. Any
# brightness structure wider than roughly twice this is treated as lighting
# and removed; anything narrower is treated as pattern and kept. 0.10 of a
# 256px swatch is ~26px sigma: fold shading (hundreds of px in the source,
# tens after the crop is resized) goes, print motifs of a few dozen px stay.
DEFAULT_DELIGHT_SIGMA_FRAC = 0.10

# Gain is clamped so a nearly black region of the low-pass cannot blow up.
MAX_DELIGHT_GAIN = 2.5
MIN_DELIGHT_GAIN = 0.4

# Passes of divide-by-low-pass. Three is enough to flatten a non-wrapping
# gradient to well under 5% (see test_delight.py); more buys nothing visible.
DELIGHT_ITERATIONS = 3


def luminance(rgb: np.ndarray) -> np.ndarray:
    return rgb.astype(np.float32) @ LUMA


def delight_array(rgb: np.ndarray, sigma_frac: float = DEFAULT_DELIGHT_SIGMA_FRAC) -> np.ndarray:
    """Divide out the low-frequency luminance of an RGB array (0..255, float).

    Works on luminance only and scales all three channels by the same gain, so
    chroma is untouched: a blue print stays the same blue, just evenly lit. The
    blur wraps, because the swatch is a tile -- a non-wrapping blur would put a
    seam-shaped gradient into the very image that is about to be repeated.
    """
    rgb = rgb.astype(np.float32)
    h, w = rgb.shape[:2]
    sigma = max(1.0, sigma_frac * max(h, w))
    # One division is exact only when the lighting itself wraps. Lighting that
    # does not (a crop that was never made seamless) leaves a residual band
    # along the wrap seam, where the blur averages the two unlike edges.
    # Iterating converges on the fixed point where the low-pass is constant,
    # i.e. genuinely flat under the same metric lowfreq_range() reports.
    for _ in range(DELIGHT_ITERATIONS):
        lum = luminance(rgb)
        low = gaussian_filter(lum, sigma=sigma, mode="wrap")
        target = float(low.mean())
        gain = target / np.maximum(low, 1.0)
        gain = np.clip(gain, MIN_DELIGHT_GAIN, MAX_DELIGHT_GAIN)
        rgb = np.clip(rgb * gain[..., None], 0, 255)
    return rgb


def delight(image: Image.Image, sigma_frac: float = DEFAULT_DELIGHT_SIGMA_FRAC) -> Image.Image:
    """PIL convenience wrapper around :func:`delight_array`."""
    arr = np.asarray(image.convert("RGB"), dtype=np.float32)
    out = delight_array(arr, sigma_frac=sigma_frac)
    return Image.fromarray(out.astype(np.uint8), mode="RGB")


def lowfreq_range(rgb: np.ndarray, sigma_frac: float = DEFAULT_DELIGHT_SIGMA_FRAC) -> float:
    """(max - min) / mean of the wrapped low-pass luminance: the metric used
    to quantify how much lighting a swatch still carries. 0 is perfectly flat."""
    lum = luminance(np.asarray(rgb, dtype=np.float32))
    sigma = max(1.0, sigma_frac * max(lum.shape))
    low = gaussian_filter(lum, sigma=sigma, mode="wrap")
    return float((low.max() - low.min()) / max(1e-6, low.mean()))


def guided_filter(guide: np.ndarray, src: np.ndarray, radius: int, eps: float) -> np.ndarray:
    """Edge-preserving smoothing of ``src`` steered by ``guide`` (both 2D float).

    Standard O(N) box-filter formulation. With ``guide is src`` this is the
    self-guided case: output ≈ a*src + b where a → 1 where local variance is
    large (edges kept) and a → 0 where it is small (texture averaged away).
    ``eps`` is therefore in squared intensity units and sets the variance
    below which structure counts as texture rather than edge.
    """
    guide = guide.astype(np.float32)
    src = src.astype(np.float32)
    size = 2 * int(radius) + 1

    def box(a: np.ndarray) -> np.ndarray:
        return uniform_filter(a, size=size, mode="nearest")

    mean_g = box(guide)
    mean_s = box(src)
    corr_gg = box(guide * guide)
    corr_gs = box(guide * src)
    var_g = corr_gg - mean_g * mean_g
    cov_gs = corr_gs - mean_g * mean_s

    a = cov_gs / (var_g + eps)
    b = mean_s - a * mean_g
    return box(a) * guide + box(b)
