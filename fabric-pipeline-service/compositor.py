"""Stages 3 and 4 -- isotropic tiling and photometric blending.

Stage 3 repeats the canonical swatch across the destination at a fixed
pixels-per-centimetre ratio instead of resizing it to fit, so the weave keeps
its true physical scale.

Stage 4 lifts the destination garment's shading and modulates the tiled fabric
with it, so the new material inherits the recipient's folds, drape and cast
shadows rather than looking pasted on flat.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from PIL import Image

# Smallest sensible tile. Below this the swatch is being squeezed so hard that
# it reads as noise, and it usually means the scale estimate went wrong.
MIN_TILE_PX = 8
MAX_TILE_PX = 4096

# Shading is clamped to this range so a black shadow or a blown highlight in
# the destination cannot crush or wash out the pasted fabric entirely. The
# ceiling is set well clear of where real garments sit -- on the test dress it
# binds on 0.04% of pixels -- because the highlight rolloff in _soft_clip is
# the better tool for taming brightness; this is only a backstop against a
# pathological destination.
SHADING_FLOOR = 0.35
SHADING_CEIL = 2.00

# Fraction of the frame's longest side used as the shading blur radius.
# This is the knob that separates drape from the old fabric's weave. Measured
# on the test dress: 0.002 tracks the destination's lighting at r=0.877 but
# carries 47% of its high-frequency weave across; 0.012 tracks at r=0.739 and
# carries 4.1%. The curve knees here, so this is the default.
DEFAULT_DETAIL_SIGMA_FRAC = 0.012

# Above this fraction of full brightness, output rolls off smoothly instead of
# clipping. A pale swatch under a bright highlight otherwise saturates to flat
# white and takes the weave with it.
HIGHLIGHT_KNEE = 0.80


@dataclass
class TileResult:
    image: Image.Image  # RGBA, exactly the requested canvas size
    tile_width: int
    tile_height: int
    repeats_x: float
    repeats_y: float
    scale_ratio: float


def compute_tile_size(
    crop_width: int,
    crop_height: int,
    src_px_per_cm: float,
    dst_px_per_cm: float,
    multiplier: float = 1.0,
) -> tuple[int, int, float]:
    """Size the swatch so one centimetre of cloth stays one centimetre.

    The swatch was cut from a photo at ``src_px_per_cm`` and is being laid into
    one at ``dst_px_per_cm``, so its physical size (crop_px / src_px_per_cm)
    re-expressed in destination pixels is just the crop scaled by the ratio of
    the two densities. The centimetres cancel, which is why no absolute
    real-world measurement is ever needed -- only that both estimates come from
    the same assumption.

    The same ratio is applied to width and height, which is what makes the
    tiling isotropic: the weave cannot be squashed along one axis.
    """
    ratio = (dst_px_per_cm / max(1e-6, src_px_per_cm)) * max(1e-6, multiplier)
    tile_w = int(round(crop_width * ratio))
    tile_h = int(round(crop_height * ratio))
    tile_w = max(MIN_TILE_PX, min(MAX_TILE_PX, tile_w))
    tile_h = max(MIN_TILE_PX, min(MAX_TILE_PX, tile_h))
    return tile_w, tile_h, ratio


def tile_swatch(swatch: Image.Image, tile_w: int, tile_h: int, canvas_w: int, canvas_h: int) -> Image.Image:
    """Repeat the swatch across the canvas at a fixed size (never stretched)."""
    tile = swatch.convert("RGB").resize((tile_w, tile_h), Image.LANCZOS)
    tile_arr = np.asarray(tile)

    reps_y = int(np.ceil(canvas_h / tile_h))
    reps_x = int(np.ceil(canvas_w / tile_w))
    tiled = np.tile(tile_arr, (reps_y, reps_x, 1))[:canvas_h, :canvas_w, :]
    return Image.fromarray(tiled)


def _gaussian_blur(arr: np.ndarray, sigma: float) -> np.ndarray:
    """Blur a 2D float array, preferring SciPy but degrading gracefully."""
    if sigma <= 0:
        return arr
    try:
        from scipy.ndimage import gaussian_filter

        return gaussian_filter(arr, sigma=sigma, mode="nearest")
    except ImportError:
        radius = max(1, int(round(sigma * 2)))
        img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
        from PIL import ImageFilter

        return np.asarray(img.filter(ImageFilter.GaussianBlur(radius))).astype(np.float32)


def extract_shading(
    destination: Image.Image,
    mask: np.ndarray,
    detail_sigma_frac: float = DEFAULT_DETAIL_SIGMA_FRAC,
    strength: float = 1.0,
) -> np.ndarray:
    """Pull a normalised shading map out of the destination garment.

    The garment's luminance carries two things mixed together: the folds and
    cast shadows we want to keep, and the weave of the fabric already there,
    which we do not -- reusing it would print the old material's texture on top
    of the new one. Blurring at a fraction of the garment's size separates
    them: the low frequencies are drape, the high frequencies are the old
    weave.

    The result is a multiplier centred on 1.0, so flat-lit regions pass the
    tiled fabric through unchanged and only genuine shading darkens or
    brightens it.
    """
    rgb = np.asarray(destination.convert("RGB"), dtype=np.float32)
    # Rec. 709 luma.
    lum = rgb[..., 0] * 0.2126 + rgb[..., 1] * 0.7152 + rgb[..., 2] * 0.0722

    h, w = lum.shape
    sigma = max(1.0, detail_sigma_frac * max(h, w))

    # Fill outside the mask with the garment's own mean before blurring, so the
    # background cannot bleed a dark halo in across the garment edge.
    inside = mask if mask.any() else np.ones_like(mask, dtype=bool)
    mean_inside = float(lum[inside].mean()) if inside.any() else float(lum.mean())
    filled = np.where(inside, lum, mean_inside)

    drape = _gaussian_blur(filled, sigma)

    denom = mean_inside if mean_inside > 1e-6 else 1.0
    shading = drape / denom
    shading = np.clip(shading, SHADING_FLOOR, SHADING_CEIL)

    # `strength` dials the effect between flat (1.0 everywhere) and full.
    strength = float(np.clip(strength, 0.0, 2.0))
    shading = 1.0 + (shading - 1.0) * strength
    return shading.astype(np.float32)


def _soft_clip(arr: np.ndarray) -> np.ndarray:
    """Roll highlights off smoothly instead of clipping them flat at 255.

    A hard clip turns every lit fold into the same featureless white, which
    destroys exactly the weave detail the pipeline exists to preserve. Below
    the knee the response is untouched; above it, the remaining headroom is
    compressed exponentially so it approaches full brightness but never
    flattens.
    """
    norm = arr / 255.0
    knee = HIGHLIGHT_KNEE
    headroom = 1.0 - knee
    over = np.maximum(0.0, norm - knee)
    rolled = knee + headroom * (1.0 - np.exp(-over / max(headroom, 1e-6)))
    out = np.where(norm > knee, rolled, norm)
    return np.clip(out * 255.0, 0, 255)


def composite(
    swatch: Image.Image,
    destination: Image.Image,
    mask: np.ndarray,
    tile_w: int,
    tile_h: int,
    shading_strength: float = 1.0,
    feather_px: int = 2,
) -> Image.Image:
    """Tile the swatch over the destination and relight it to match."""
    canvas_w, canvas_h = destination.size

    tiled = tile_swatch(swatch, tile_w, tile_h, canvas_w, canvas_h)
    tiled_arr = np.asarray(tiled, dtype=np.float32)

    shading = extract_shading(destination, mask, strength=shading_strength)
    shaded = _soft_clip(tiled_arr * shading[..., None])

    alpha = mask.astype(np.float32) * 255.0
    if feather_px > 0:
        # Soften the mask edge so the garment silhouette does not alias -- but
        # keep every pixel that is genuinely inside the garment fully opaque.
        #
        # Blurring alone puts the ramp's midpoint on the boundary, which leaves
        # the outermost garment pixels semi-transparent and lets the old
        # garment show through as a coloured fringe (clearly visible as a red
        # rim when pasting onto the red gown). Taking the maximum of the blur
        # and the original mask moves the whole ramp outside the silhouette.
        blurred = np.clip(_gaussian_blur(alpha, sigma=float(feather_px)), 0, 255)
        alpha = np.maximum(blurred, alpha)

    rgba = np.dstack([shaded.astype(np.uint8), alpha.astype(np.uint8)])
    return Image.fromarray(rgba, mode="RGBA")
