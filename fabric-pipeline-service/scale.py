"""Estimating a photo's pixels-per-centimetre from what is visible in it.

Two independent anthropometric references are available, and neither is
reliable enough alone:

  * **Face breadth.** Tight across adults (~14cm), but what SegFormer labels
    "Face" is the visible facial skin, so a hairstyle covering the cheeks
    narrows it and a turned head foreshortens it. Measured across four
    photographs, the face region's width relative to its own height ranged from
    0.23 to 0.61 -- the same feature, read very differently.
  * **Garment body width.** Available on every image including flat product
    shots, but it depends on the cut, which genuinely varies from 34cm to 56cm,
    and on the silhouette being read correctly. On a photo where the skirt's
    flare runs off the bottom of the frame it reads as straight and the
    estimate goes ~35% high.

So both are computed and combined. Where they agree, confidence is high and
either would have done; where they diverge, the combination sits between them
and the disagreement is reported so the UI can say the scale is uncertain and
the user can reach for the Tile scale slider.

Deliberately *not* used: head height including hair. Hair length swamps it --
on the two long-haired subjects it implied 9.0 px/cm against 2.4 from the face.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

import geometry

FACE_CLASS_ID = 11
HAIR_CLASS_ID = 2

# Adult bizygomatic breadth. Varies little between people compared with the
# spread in garment cuts, which is what makes it worth using at all.
FACE_BREADTH_CM = 14.0

# A face region this small is a sliver of skin between hair, not a measurable
# face, and its width says more about the haircut than the person.
MIN_FACE_PX = 12
MIN_FACE_ASPECT = 0.18

# Beyond this disagreement the two references are not describing the same
# thing, and the result is flagged rather than quietly averaged.
DISAGREEMENT_WARN = 0.35


@dataclass
class ScaleEstimate:
    px_per_cm: float
    confidence: float
    sources: list[str]
    face_px_per_cm: float | None
    garment_px_per_cm: float | None
    disagreement: float | None
    silhouette: str
    landmark: str
    body_width_px: float
    note: str


def _face_reference(seg: np.ndarray) -> tuple[float | None, float]:
    """px/cm from face breadth, with a confidence in [0, 1]."""
    face = seg == FACE_CLASS_ID
    if not face.any():
        return None, 0.0

    rows = np.nonzero(face.any(axis=1))[0]
    height = float(rows.max() - rows.min() + 1)
    widths = face.sum(axis=1)
    widths = widths[widths > 0]
    if widths.size == 0:
        return None, 0.0

    # Median row rather than the bounding box: a fringe or an ear adds a couple
    # of wide rows that the box would take as the whole face.
    width = float(np.median(widths))
    if width < MIN_FACE_PX:
        return None, 0.0

    aspect = width / max(height, 1.0)
    if aspect < MIN_FACE_ASPECT:
        # A narrow vertical strip: hair is covering most of the face, so its
        # width is not face breadth.
        return None, 0.0

    # Confidence peaks for a face read at roughly natural proportions and falls
    # off either side -- too narrow means occlusion or a turned head, too wide
    # means the region has spilled into hair or neck.
    ideal = 0.62
    confidence = float(np.clip(1.0 - abs(aspect - ideal) / ideal, 0.15, 1.0))

    return width / FACE_BREADTH_CM, confidence


def estimate(seg: np.ndarray, garment_mask: np.ndarray) -> ScaleEstimate:
    """Combine every scale reference the image offers."""
    body = geometry.body_width(garment_mask)
    garment_ppc = body.px_per_cm if garment_mask.any() else None
    garment_conf = body.confidence if garment_ppc else 0.0

    face_ppc, face_conf = _face_reference(seg)

    sources: list[str] = []
    if face_ppc:
        sources.append("face")
    if garment_ppc:
        sources.append("garment")

    if face_ppc and garment_ppc:
        disagreement = abs(face_ppc - garment_ppc) / max(min(face_ppc, garment_ppc), 1e-6)
        # Geometric mean, weighted by confidence: these are scale factors, so
        # combining them multiplicatively keeps the result symmetric under
        # swapping source and destination -- an arithmetic mean would not.
        w_face, w_garment = face_conf, garment_conf
        total = max(w_face + w_garment, 1e-6)
        px_per_cm = float(np.exp(
            (w_face * np.log(face_ppc) + w_garment * np.log(garment_ppc)) / total
        ))
        if disagreement > DISAGREEMENT_WARN:
            confidence = 0.35
            note = (f"face and garment scale disagree by {100 * disagreement:.0f}% "
                    f"-- the tile scale may need correcting")
        else:
            confidence = float(min(0.95, 0.5 + 0.5 * (1.0 - disagreement / DISAGREEMENT_WARN)))
            note = f"face and garment agree within {100 * disagreement:.0f}%"
    elif face_ppc:
        px_per_cm, confidence, disagreement = face_ppc, face_conf * 0.8, None
        note = "scale from face breadth only"
    elif garment_ppc:
        px_per_cm, confidence, disagreement = garment_ppc, garment_conf * 0.7, None
        note = f"scale from garment shape only ({body.silhouette})"
    else:
        px_per_cm, confidence, disagreement = 1.0, 0.0, None
        note = "no scale reference found"

    return ScaleEstimate(
        px_per_cm=px_per_cm,
        confidence=confidence,
        sources=sources,
        face_px_per_cm=face_ppc,
        garment_px_per_cm=garment_ppc,
        disagreement=disagreement,
        silhouette=body.silhouette,
        landmark=body.landmark,
        body_width_px=body.width_px,
        note=note,
    )
