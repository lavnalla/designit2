"""Stage 1 -- garment segmentation.

Produces a pixel-accurate mask of the garment in a photo, plus the physical
scale estimate (pixels per centimetre) that the tiling stage needs.
"""

from __future__ import annotations

import time
from dataclasses import dataclass

import numpy as np
import torch
from PIL import Image
from transformers import AutoModelForSemanticSegmentation, SegformerImageProcessor

import geometry
import scale as scale_mod
from labels import GARMENT_CLASS_IDS, DEFAULT_WIDTH_CM, label_for

MODEL_ID = "mattmdjaga/segformer_b2_clothes"

# Used to tell a worn photo from a flat product shot.
FACE_CLASS_ID = 11

# Longest side the segmenter runs at. SegFormer is fully convolutional so it
# handles any size, but capping keeps VRAM predictable next to the diffusion
# model and costs nothing -- the mask is upsampled back to full resolution.
MAX_SIDE = 1024


@dataclass
class GarmentMask:
    """A garment mask and everything derived from it."""

    mask: np.ndarray  # bool, (H, W) -- True inside the garment
    bbox: tuple[int, int, int, int]  # x0, y0, x1, y1 (exclusive upper bounds)
    class_id: int
    label: str
    px_per_cm: float
    silhouette: str  # straight | flared | legged, from geometry.body_width
    landmark: str    # which measurement the scale came from
    body_width_px: float
    scale_confidence: float
    scale_sources: list[str]
    scale_note: str
    person_present: bool
    coverage: float  # fraction of the image the garment occupies
    present_classes: list[str]
    inference_seconds: float

    @property
    def is_empty(self) -> bool:
        return not bool(self.mask.any())


def _pick_device(preferred: str | None = None) -> torch.device:
    if preferred:
        return torch.device(preferred)
    if torch.cuda.is_available():
        return torch.device("cuda")
    return torch.device("cpu")


# A blob smaller than this fraction of the biggest one is treated as noise.
COMPONENT_KEEP_FRAC = 0.08

# A second garment class joins the mask once it reaches this fraction of the
# dominant one -- enough to catch a genuinely two-part outfit, high enough to
# ignore a thin misclassified fringe along a hem.
COMPANION_CLASS_FRAC = 0.15


def _denoise_components(mask: np.ndarray) -> np.ndarray:
    """Drop stray specks while keeping every substantial part of the garment.

    SegFormer tags a few loose pixels of garment elsewhere in the frame (JPEG
    noise, a sliver behind an arm), and those would inflate the bounding box
    and corrupt the scale estimate. But a garment is very often split into
    several legitimate blobs -- a belt cuts a dress into bodice and skirt, an
    arm crosses a shirt -- so keeping only the largest component silently drops
    half the garment. Keep every blob that is a meaningful fraction of the
    biggest one instead.
    """
    try:
        from scipy import ndimage
    except ImportError:
        return mask

    labelled, count = ndimage.label(mask)
    if count <= 1:
        return mask
    sizes = np.asarray(ndimage.sum(mask, labelled, range(1, count + 1)))
    threshold = sizes.max() * COMPONENT_KEEP_FRAC
    keep_ids = {i + 1 for i, size in enumerate(sizes) if size >= threshold}
    return np.isin(labelled, list(keep_ids))


class GarmentSegmenter:
    def __init__(self, device_name: str | None = None) -> None:
        self.device = _pick_device(device_name)
        self.processor: SegformerImageProcessor | None = None
        self.model: AutoModelForSemanticSegmentation | None = None
        self.ready = False
        self.load_seconds: float | None = None

    def load(self) -> None:
        if self.ready:
            return
        start = time.perf_counter()
        self.processor = SegformerImageProcessor.from_pretrained(MODEL_ID)
        self.model = AutoModelForSemanticSegmentation.from_pretrained(MODEL_ID)
        self.model.to(self.device)
        self.model.eval()
        self.load_seconds = time.perf_counter() - start
        self.ready = True

    def segment(
        self,
        image: Image.Image,
        assume_width_cm: float | None = None,
        focus_rect: tuple[int, int, int, int] | None = None,
    ) -> GarmentMask:
        """Segment the dominant garment and estimate its pixels-per-centimetre."""
        self.load()
        assert self.processor is not None and self.model is not None

        rgb = image.convert("RGB")
        full_w, full_h = rgb.size

        scaled = rgb
        if max(full_w, full_h) > MAX_SIDE:
            ratio = MAX_SIDE / max(full_w, full_h)
            scaled = rgb.resize((max(1, int(full_w * ratio)), max(1, int(full_h * ratio))), Image.BILINEAR)

        inputs = self.processor(images=scaled, return_tensors="pt")
        inputs = {k: v.to(self.device) for k, v in inputs.items()}

        start = time.perf_counter()
        with torch.inference_mode():
            logits = self.model(**inputs).logits
            # Upsample straight to the *original* resolution so the mask lines
            # up with the caller's pixels regardless of the MAX_SIDE downscale.
            upsampled = torch.nn.functional.interpolate(
                logits, size=(full_h, full_w), mode="bilinear", align_corners=False
            )
            pred = upsampled.argmax(dim=1)[0]
        infer_s = time.perf_counter() - start

        seg = pred.detach().cpu().numpy().astype(np.int32)
        present = [label_for(int(c)) for c in np.unique(seg)]

        # Which garment are we talking about?
        #
        # On a flat product shot this model's labels are unreliable and one
        # garment can be split across several of them, so folding substantial
        # classes together is the safe move. On a photo of a person it is
        # exactly wrong: separate labels there mean separate garments, and
        # merging a striped jumper with the skirt below it produces a mask that
        # is neither. A visible face is what tells the two regimes apart -- it
        # is present in every worn photo and absent from every product shot.
        counts = {cid: int((seg == cid).sum()) for cid in GARMENT_CLASS_IDS}

        person_present = int((seg == FACE_CLASS_ID).sum()) > 0.0005 * seg.size

        if focus_rect is not None:
            # The caller pointed at a specific region, so let it settle which
            # garment is meant -- the user clicking on the jumper is a far
            # better signal than any heuristic.
            x0, y0, x1, y1 = focus_rect
            x0 = max(0, min(full_w - 1, x0)); x1 = max(x0 + 1, min(full_w, x1))
            y0 = max(0, min(full_h - 1, y0)); y1 = max(y0 + 1, min(full_h, y1))
            window = seg[y0:y1, x0:x1]
            local = {cid: int((window == cid).sum()) for cid in GARMENT_CLASS_IDS}
            if max(local.values()) > 0:
                counts = {cid: (local[cid] if local[cid] > 0 else 0) for cid in GARMENT_CLASS_IDS}
                best_id = max(local, key=lambda cid: local[cid])
                counts = {cid: int((seg == cid).sum()) for cid in GARMENT_CLASS_IDS}
            else:
                best_id = max(counts, key=lambda cid: counts[cid])
        else:
            best_id = max(counts, key=lambda cid: counts[cid])

        best_count = counts[best_id]

        if best_count == 0:
            empty = np.zeros((full_h, full_w), dtype=bool)
            return GarmentMask(
                mask=empty,
                bbox=(0, 0, full_w, full_h),
                class_id=0,
                label="none",
                px_per_cm=full_w / DEFAULT_WIDTH_CM,
                silhouette="none",
                landmark="none",
                body_width_px=0.0,
                scale_confidence=0.0,
                scale_sources=[],
                scale_note="no garment found",
                person_present=False,
                coverage=0.0,
                present_classes=present,
                inference_seconds=round(infer_s, 3),
            )

        if person_present:
            # One garment, the one that was asked for.
            member_ids = [best_id]
        else:
            companion_threshold = best_count * COMPANION_CLASS_FRAC
            member_ids = [cid for cid, count in counts.items() if count >= companion_threshold]
        mask = _denoise_components(np.isin(seg, member_ids))

        ys, xs = np.nonzero(mask)
        bbox = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)

        # Physical scale, read off the silhouette rather than the class label.
        #
        # The class cannot be trusted here: this model is trained on photos of
        # people, and on isolated product shots every garment in the repo comes
        # back as "Dress" -- so a per-class width table is inert. The shape of
        # the mask, on the other hand, says plainly whether the garment runs
        # straight down, flares, or splits into legs, and that is what decides
        # where its width should be measured. See geometry.py.
        est = scale_mod.estimate(seg, mask)
        if assume_width_cm:
            body = geometry.body_width(mask)
            px_per_cm = max(1e-6, body.width_px / max(1e-6, assume_width_cm))
        else:
            px_per_cm = est.px_per_cm

        return GarmentMask(
            mask=mask,
            bbox=bbox,
            class_id=best_id,
            label=label_for(best_id),
            px_per_cm=px_per_cm,
            silhouette=est.silhouette,
            landmark=est.landmark,
            body_width_px=est.body_width_px,
            scale_confidence=round(est.confidence, 3),
            scale_sources=est.sources,
            scale_note=est.note,
            person_present=person_present,
            coverage=float(mask.mean()),
            present_classes=present,
            inference_seconds=round(infer_s, 3),
        )


segmenter = GarmentSegmenter()
