"""Label scheme for mattmdjaga/segformer_b2_clothes (ATR/LIP 18-class parsing).

Note this is a *different* label space from the repo's other segmenter
(sayeed99/segformer-b3-fashion, 46 fashion classes, used by
tools/garment_segment.py). The two are not interchangeable.
"""

from __future__ import annotations

ID2LABEL: dict[int, str] = {
    0: "Background",
    1: "Hat",
    2: "Hair",
    3: "Sunglasses",
    4: "Upper-clothes",
    5: "Skirt",
    6: "Pants",
    7: "Dress",
    8: "Belt",
    9: "Left-shoe",
    10: "Right-shoe",
    11: "Face",
    12: "Left-leg",
    13: "Right-leg",
    14: "Left-arm",
    15: "Right-arm",
    16: "Bag",
    17: "Scarf",
}

# The garment classes the fabric pipeline operates on.
GARMENT_CLASS_IDS: frozenset[int] = frozenset({4, 5, 6, 7})

# Typical real-world width of each garment's *body*, in centimetres, matched to
# what the segmenter measures: the median row width of the mask, not the
# bounding box. See segmenter.segment for why the median row is used.
#
# These are deliberately coarse adult-average figures: the pipeline only needs
# the *ratio* between the source and destination estimate, so a consistent bias
# cancels out. The UI multiplier corrects whatever remains.
GARMENT_WIDTH_CM: dict[int, float] = {
    4: 40.0,  # Upper-clothes: torso width across the chest
    5: 38.0,  # Skirt: hip width
    6: 38.0,  # Pants: across both legs
    7: 42.0,  # Dress: torso, widening into the skirt
}

# Fallback when no garment class is found at all.
DEFAULT_WIDTH_CM = 40.0


def garment_width_cm(class_id: int) -> float:
    return GARMENT_WIDTH_CM.get(class_id, DEFAULT_WIDTH_CM)


def label_for(class_id: int) -> str:
    return ID2LABEL.get(class_id, f"class_{class_id}")
