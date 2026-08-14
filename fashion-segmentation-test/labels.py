"""
Fashion class mapping for sayeed99/segformer-b3-fashion.

Source: model card / config.json id2label on Hugging Face
https://huggingface.co/sayeed99/segformer-b3-fashion

47 semantic classes (0–46). Runtime scripts prefer model.config.id2label
when available; this file is the documented fallback.
"""

from __future__ import annotations

# Exact id2label from the published model config / README.
ID2LABEL: dict[int, str] = {
    0: "Unlabelled",
    1: "shirt, blouse",
    2: "top, t-shirt, sweatshirt",
    3: "sweater",
    4: "cardigan",
    5: "jacket",
    6: "vest",
    7: "pants",
    8: "shorts",
    9: "skirt",
    10: "coat",
    11: "dress",
    12: "jumpsuit",
    13: "cape",
    14: "glasses",
    15: "hat",
    16: "headband, head covering, hair accessory",
    17: "tie",
    18: "glove",
    19: "watch",
    20: "belt",
    21: "leg warmer",
    22: "tights, stockings",
    23: "sock",
    24: "shoe",
    25: "bag, wallet",
    26: "scarf",
    27: "umbrella",
    28: "hood",
    29: "collar",
    30: "lapel",
    31: "epaulette",
    32: "sleeve",
    33: "pocket",
    34: "neckline",
    35: "buckle",
    36: "zipper",
    37: "applique",
    38: "bead",
    39: "bow",
    40: "flower",
    41: "fringe",
    42: "ribbon",
    43: "rivet",
    44: "ruffle",
    45: "sequin",
    46: "tassel",
}

NUM_LABELS = len(ID2LABEL)


def normalize_id2label(raw: dict | None) -> dict[int, str]:
    """Convert HF config id2label (string keys) to int→str mapping."""
    if not raw:
        return dict(ID2LABEL)
    return {int(k): str(v) for k, v in raw.items()}
