"""Choosing *which* pixels to sample fabric from.

The rectification model assumes it is being handed cloth. Give it a patch that
straddles a neckline, a strap or the photo background and it faithfully
flattens all of that into the swatch, which then gets tiled across the target
-- producing bands of background rather than fabric.

So a requested crop is only used if it really is fabric. Otherwise the patch is
moved to the most deeply interior part of the garment, which is the region
least likely to contain an edge, a seam or a shadow.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

# A requested crop this much garment or better is taken at face value.
#
# The bar is deliberately close to 1.0. Coverage counts pixels, but what ruins
# a swatch is *contiguity*: 10% background scattered as a one-pixel fringe is
# invisible, while the same 10% gathered into a neckline is a white blob that
# tiles into a repeating hole across the whole target. Since a fringe costs
# nothing to trim and a blob cannot be tolerated, the threshold is set where
# only a fringe survives.
MIN_REQUESTED_COVERAGE = 0.98

# Largest run of non-garment pixels tolerated in an otherwise clean patch, as a
# fraction of the patch's smaller side. This catches the case coverage misses:
# a compact intrusion that is small in area but solid enough to read as an
# object once repeated.
MAX_INTRUSION_FRAC = 0.12

# When growing the automatic patch, allow a sliver of non-garment rather than
# insisting on a perfect square -- a few edge pixels cost far less than halving
# the patch size, and a bigger patch captures more of the pattern's repeat.
GROW_MIN_COVERAGE = 0.985

MIN_PATCH_PX = 16

# How many candidate positions to score when picking a fabric region. The
# search is a coarse grid over everywhere a patch of the chosen size fits.
CANDIDATE_GRID = 9

# Window sizes to try, as fractions of the largest patch that fits. Several
# sizes are needed: at full size the biggest patch usually fits in only one
# place, so there is nothing to choose between, and on a garment with a large
# chest print no big window avoids it at all.
CANDIDATE_SIDE_FRACS = (1.0, 0.75, 0.5, 0.32)

# A patch is scored on being *representative fabric*, not merely large:
#
#   stationarity  -- a repeating weave looks much the same in each of its
#                    quadrants; a chest print or logo does not, so the block
#                    carrying it stands out from the others.
#   typicality    -- the patch's colours should look like the garment's
#                    colours overall. A logo occupies a small part of the
#                    garment, so a patch centred on one is atypical of it.
#   size          -- bigger still helps, since it captures more of the
#                    pattern's repeat, but it no longer decides on its own.
WEIGHT_STATIONARITY = 0.30
WEIGHT_TYPICALITY = 0.45
WEIGHT_SIZE = 0.25

# Blocks per side when testing stationarity.
BLOCKS = 4

# How much better a candidate must score before the patch is moved off the
# largest region at all. The default is conservative on purpose: the brief is
# that repeating patterns must survive, and leaving a good patch alone costs
# nothing, whereas relocating a patterned one can lose the pattern.
RELOCATE_MARGIN = 0.12


@dataclass
class PatchChoice:
    rect: tuple[int, int, int, int]  # x0, y0, x1, y1
    coverage: float
    relocated: bool
    reason: str

    @property
    def width(self) -> int:
        return self.rect[2] - self.rect[0]

    @property
    def height(self) -> int:
        return self.rect[3] - self.rect[1]


def _coverage(mask: np.ndarray, rect: tuple[int, int, int, int]) -> float:
    x0, y0, x1, y1 = rect
    sub = mask[y0:y1, x0:x1]
    if sub.size == 0:
        return 0.0
    return float(sub.mean())


def _largest_intrusion(mask: np.ndarray, rect: tuple[int, int, int, int]) -> float:
    """Size of the biggest solid non-garment blob inside `rect`.

    Returned as a fraction of the patch's smaller side, so it can be compared
    against MAX_INTRUSION_FRAC regardless of patch size.
    """
    x0, y0, x1, y1 = rect
    sub = mask[y0:y1, x0:x1]
    if sub.size == 0 or sub.all():
        return 0.0

    holes = ~sub
    try:
        from scipy import ndimage

        labelled, count = ndimage.label(holes)
        if count == 0:
            return 0.0
        sizes = ndimage.sum(holes, labelled, range(1, count + 1))
        biggest_area = float(np.max(sizes))
    except ImportError:
        biggest_area = float(holes.sum())

    # Express the blob as an equivalent square's side.
    side = np.sqrt(biggest_area)
    return float(side / max(1, min(sub.shape)))


def _is_clean(mask: np.ndarray, rect: tuple[int, int, int, int]) -> bool:
    return (
        _coverage(mask, rect) >= MIN_REQUESTED_COVERAGE
        and _largest_intrusion(mask, rect) <= MAX_INTRUSION_FRAC
    )


def _clamp_rect(rect: tuple[int, int, int, int], w: int, h: int) -> tuple[int, int, int, int]:
    x0, y0, x1, y1 = rect
    x0 = max(0, min(w - 1, int(round(x0))))
    y0 = max(0, min(h - 1, int(round(y0))))
    x1 = max(x0 + 1, min(w, int(round(x1))))
    y1 = max(y0 + 1, min(h, int(round(y1))))
    return x0, y0, x1, y1


def largest_interior_patch(mask: np.ndarray) -> tuple[int, int, int, int] | None:
    """Biggest mostly-square region sitting deepest inside the garment.

    The distance transform gives, for every garment pixel, how far it is from
    the nearest non-garment pixel. Its maximum is the centre of the largest
    circle that fits inside the garment, and a square inscribed in that circle
    is guaranteed to be fabric all the way to its corners.
    """
    if not mask.any():
        return None

    try:
        from scipy.ndimage import distance_transform_edt
    except ImportError:
        # Without SciPy, fall back to the centre of the mask's bounding box.
        ys, xs = np.nonzero(mask)
        cy, cx = int(ys.mean()), int(xs.mean())
        half = max(MIN_PATCH_PX // 2, int(min(ys.ptp(), xs.ptp()) * 0.15))
        return _clamp_rect((cx - half, cy - half, cx + half, cy + half), mask.shape[1], mask.shape[0])

    dt = distance_transform_edt(mask)
    cy, cx = np.unravel_index(int(np.argmax(dt)), dt.shape)
    radius = float(dt[cy, cx])
    if radius < 2:
        return None

    h, w = mask.shape
    # A square inscribed in a circle of radius r has half-side r/sqrt(2).
    half = max(MIN_PATCH_PX // 2, int(radius / np.sqrt(2)))
    rect = _clamp_rect((cx - half, cy - half, cx + half, cy + half), w, h)

    # Grow while the patch stays almost entirely on fabric. The inscribed
    # square is conservative; real garments usually allow a good deal more.
    step = max(2, half // 8)
    for _ in range(24):
        grown = _clamp_rect((rect[0] - step, rect[1] - step, rect[2] + step, rect[3] + step), w, h)
        if grown == rect:
            break
        if _coverage(mask, grown) < GROW_MIN_COVERAGE:
            break
        rect = grown

    return rect


def _shrink_to_fabric(mask: np.ndarray, rect: tuple[int, int, int, int]) -> tuple[int, int, int, int] | None:
    """Pull a requested rect inwards until it is (almost) all fabric.

    Cheaper and less surprising than relocating: if the user selected a good
    region but caught the hem, this keeps them where they aimed.
    """
    x0, y0, x1, y1 = rect
    for _ in range(32):
        if _is_clean(mask, (x0, y0, x1, y1)):
            return x0, y0, x1, y1
        if (x1 - x0) <= MIN_PATCH_PX or (y1 - y0) <= MIN_PATCH_PX:
            return None
        # Trim whichever edge is carrying the least fabric.
        edges = {
            "top": mask[y0, x0:x1].mean(),
            "bottom": mask[y1 - 1, x0:x1].mean(),
            "left": mask[y0:y1, x0].mean(),
            "right": mask[y0:y1, x1 - 1].mean(),
        }
        worst = min(edges, key=lambda k: edges[k])
        stepy = max(1, (y1 - y0) // 20)
        stepx = max(1, (x1 - x0) // 20)
        if worst == "top":
            y0 += stepy
        elif worst == "bottom":
            y1 -= stepy
        elif worst == "left":
            x0 += stepx
        else:
            x1 -= stepx
    return None


def _block_means(patch: np.ndarray) -> np.ndarray:
    """Mean colour of each block in a BLOCKS x BLOCKS grid over the patch."""
    h, w = patch.shape[:2]
    ys = np.linspace(0, h, BLOCKS + 1).astype(int)
    xs = np.linspace(0, w, BLOCKS + 1).astype(int)
    out = []
    for i in range(BLOCKS):
        for j in range(BLOCKS):
            block = patch[ys[i]:ys[i + 1], xs[j]:xs[j + 1]]
            if block.size:
                out.append(block.reshape(-1, block.shape[-1]).mean(axis=0))
    return np.asarray(out, dtype=np.float32)


def _stationarity(patch: np.ndarray) -> float:
    """1.0 for an evenly repeating texture, falling towards 0 for a graphic.

    This must be measured as an **outlier test**, not as a plainness test.
    Scoring the raw spread of block colours rewards calm regions, so on a busy
    floral it walks the patch into the gaps between the flowers and throws away
    the pattern being copied -- measured over VITON-HD, that cost 28 of 40
    patches more than 30% of their pattern richness.

    What separates a print from a pattern is not how much a patch varies but
    whether the variation is *even*. A floral varies a lot and evenly; a chest
    logo leaves most blocks ordinary and a few wildly different. So blocks are
    compared against the spread of the other blocks (a median-absolute-
    deviation test), which is invariant to how rich the fabric is.
    """
    bm = _block_means(patch)
    if len(bm) < 4:
        return 0.5

    median = np.median(bm, axis=0)
    dev = np.linalg.norm(bm - median, axis=1)
    med_dev = float(np.median(dev))
    mad = float(np.median(np.abs(dev - med_dev)))

    # An outlier is a block far outside the spread of its peers, and far enough
    # in absolute terms to be visible. The absolute floor stops a very uniform
    # patch from flagging its own noise.
    threshold = max(med_dev + 4.0 * mad, med_dev + 12.0)
    outliers = float((dev > threshold).mean())
    return float(np.clip(1.0 - 2.5 * outliers, 0.0, 1.0))


def _typicality(patch: np.ndarray, garment_pixels: np.ndarray) -> float:
    """How much the patch's colours look like the garment's colours overall."""
    if garment_pixels.size == 0 or patch.size == 0:
        return 0.5
    bins = 8
    edges = [np.linspace(0, 256, bins + 1)] * 3

    def hist(px: np.ndarray) -> np.ndarray:
        h, _ = np.histogramdd(px.reshape(-1, 3), bins=edges)
        total = h.sum()
        return (h / total) if total else h

    hp = hist(patch.astype(np.float32))
    hg = hist(garment_pixels.astype(np.float32))
    # Histogram intersection: 1.0 when the distributions coincide.
    return float(np.minimum(hp, hg).sum())


def _score(
    rect: tuple[int, int, int, int],
    mask: np.ndarray,
    image: np.ndarray | None,
    garment_pixels: np.ndarray | None,
    max_side: float,
) -> float:
    x0, y0, x1, y1 = rect
    size_score = float(np.clip(min(x1 - x0, y1 - y0) / max(max_side, 1e-6), 0.0, 1.0))
    if image is None:
        return size_score

    patch = image[y0:y1, x0:x1]
    if patch.size == 0:
        return 0.0
    stat = _stationarity(patch)
    typ = _typicality(patch, garment_pixels if garment_pixels is not None else patch)
    return (WEIGHT_STATIONARITY * stat
            + WEIGHT_TYPICALITY * typ
            + WEIGHT_SIZE * size_score)


def best_fabric_patch(
    mask: np.ndarray,
    image: np.ndarray | None = None,
) -> tuple[int, int, int, int] | None:
    """Search inside the garment for the most fabric-like region.

    `largest_interior_patch` answers "where does the biggest square fit", which
    on a t-shirt is the middle of the chest -- exactly where a print sits. This
    scores many positions of that same size and takes the one that looks most
    like repeating cloth.
    """
    base = largest_interior_patch(mask)
    if base is None or image is None:
        return base

    h, w = mask.shape
    base_x, base_y = base[2] - base[0], base[3] - base[1]
    reference_side = max(base_x, base_y)

    ys_m, xs_m = np.nonzero(mask)
    y0, y1 = int(ys_m.min()), int(ys_m.max())
    x0, x1 = int(xs_m.min()), int(xs_m.max())

    garment_pixels = image[mask]

    # Search over sizes as well as positions.
    #
    # A single window size is not enough. On a tee carrying a large chest print
    # there is simply no big region that misses it, so every position scores
    # about as badly and the patch stays on the logo. Allowing smaller windows
    # lets a clean scrap of plain fabric beat a large contaminated one -- and
    # because size is still part of the score, an allover print (which is
    # uniform at every scale) keeps its large patch.
    best_rect, best_score = None, -1.0
    for frac in CANDIDATE_SIDE_FRACS:
        side_x = max(MIN_PATCH_PX, int(base_x * frac))
        side_y = max(MIN_PATCH_PX, int(base_y * frac))
        step_y = max(4, side_y // 3)
        step_x = max(4, side_x // 3)

        for top in range(y0, max(y0 + 1, y1 - side_y + 1), step_y):
            for left in range(x0, max(x0 + 1, x1 - side_x + 1), step_x):
                rect = _clamp_rect((left, top, left + side_x, top + side_y), w, h)
                if _coverage(mask, rect) < GROW_MIN_COVERAGE:
                    continue
                s = _score(rect, mask, image, garment_pixels, reference_side)
                if s > best_score:
                    best_rect, best_score = rect, s

    # Only move if the alternative is clearly better, not merely different.
    base_score = _score(base, mask, image, garment_pixels, reference_side)
    if best_rect is None or best_score < base_score + RELOCATE_MARGIN:
        return base

    # Having chosen where, grow back out as far as the fabric allows.
    rect = best_rect
    step = max(2, min(side_x, side_y) // 8)
    for _ in range(24):
        grown = _clamp_rect((rect[0] - step, rect[1] - step, rect[2] + step, rect[3] + step), w, h)
        if grown == rect or _coverage(mask, grown) < GROW_MIN_COVERAGE:
            break
        # Only keep growing while the patch stays fabric-like; expanding into a
        # print would undo the point of having moved.
        if image is not None and _stationarity(image[grown[1]:grown[3], grown[0]:grown[2]]) < \
                _stationarity(image[rect[1]:rect[3], rect[0]:rect[2]]) - 0.05:
            break
        rect = grown

    return rect


def choose_patch(
    mask: np.ndarray,
    requested: tuple[int, int, int, int] | None,
    image: np.ndarray | None = None,
) -> PatchChoice:
    """Decide which rectangle to sample fabric from.

    Order of preference: the user's selection as given, that selection pulled
    in to clear the garment's edge, then the deepest interior region.
    """
    h, w = mask.shape

    if not mask.any():
        rect = requested or (0, 0, w, h)
        return PatchChoice(_clamp_rect(rect, w, h), 0.0, False,
                           "no garment detected; sampling the selection as given")

    if requested is not None:
        rect = _clamp_rect(requested, w, h)
        cov = _coverage(mask, rect)
        if _is_clean(mask, rect):
            return PatchChoice(rect, cov, False, "selection is fabric")

        # Prefer the biggest clean region over a trimmed version of the
        # selection. Shrinking keeps the user where they aimed, but it can only
        # eat inwards from the edges -- a neckline that dips into the middle of
        # the selection survives every trim, and a patch small enough to have
        # escaped it is too small to hold the pattern's repeat anyway.
        auto = largest_interior_patch(mask)
        shrunk = _shrink_to_fabric(mask, rect)

        auto_area = (auto[2] - auto[0]) * (auto[3] - auto[1]) if auto else 0
        shrunk_area = (shrunk[2] - shrunk[0]) * (shrunk[3] - shrunk[1]) if shrunk else 0

        if auto is not None and auto_area >= shrunk_area:
            return PatchChoice(auto, _coverage(mask, auto), True,
                               f"selection was {100 * cov:.0f}% fabric; sampled the garment interior instead")
        if shrunk is not None:
            return PatchChoice(shrunk, _coverage(mask, shrunk), True,
                               f"selection was {100 * cov:.0f}% fabric; trimmed back to the garment")
        return PatchChoice(rect, cov, False, "could not find a clean fabric region")

    auto = largest_interior_patch(mask)
    if auto is not None:
        return PatchChoice(auto, _coverage(mask, auto), True, "sampled the garment interior")

    ys, xs = np.nonzero(mask)
    rect = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
    return PatchChoice(rect, _coverage(mask, rect), True, "fell back to the garment bounding box")
