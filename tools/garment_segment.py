#!/usr/bin/env python3
import base64
import io
import json
import sys

import numpy as np
from PIL import Image

# Maps this model's fashion-specific class ids to the app's 4-part scheme.
# Model: sayeed99/segformer-b3-fashion (see tools/requirements-garment-segment.txt)
ARM_CLASS_IDS = {32}  # sleeve
BODY_CLASS_IDS = {1, 2, 3, 4, 5, 6, 10, 11, 12, 13}  # shirt/top/sweater/cardigan/jacket/vest/coat/dress/jumpsuit/cape
NECK_CLASS_IDS = {29, 34}  # collar, neckline
SHOULDER_CLASS_IDS = {31}  # epaulette (the only shoulder-related class this model has)

PART_COLORS = {
    "arm": (255, 0, 0),
    "body": (0, 255, 0),
    "neck": (0, 0, 255),
    "shoulders": (255, 255, 0),
}


def decode_data_url(data_url: str) -> bytes:
    if "," not in data_url:
        raise ValueError("Invalid data URL")
    header, encoded = data_url.split(",", 1)
    if "base64" not in header:
        raise ValueError("Only base64 data URLs are supported")
    return base64.b64decode(encoded)


def encode_png_data_url(image: Image.Image) -> str:
    out = io.BytesIO()
    image.save(out, format="PNG", optimize=False)
    encoded = base64.b64encode(out.getvalue()).decode("ascii")
    return f"data:image/png;base64,{encoded}"


def classify(class_id: int):
    if class_id in ARM_CLASS_IDS:
        return "arm"
    if class_id in BODY_CLASS_IDS:
        return "body"
    if class_id in NECK_CLASS_IDS:
        return "neck"
    if class_id in SHOULDER_CLASS_IDS:
        return "shoulders"
    return None


def main() -> int:
    try:
        payload = json.loads(sys.stdin.read())
        data_url = payload.get("imageDataUrl")
        if not data_url:
            raise ValueError("Missing imageDataUrl")

        # Imported lazily: these are heavy, so a bad payload fails fast above
        # without paying the import cost.
        import torch.nn as nn
        from transformers import AutoModelForSemanticSegmentation, SegformerImageProcessor

        raw = decode_data_url(data_url)
        image = Image.open(io.BytesIO(raw)).convert("RGB")

        processor = SegformerImageProcessor.from_pretrained("sayeed99/segformer-b3-fashion")
        model = AutoModelForSemanticSegmentation.from_pretrained("sayeed99/segformer-b3-fashion")
        id2label = model.config.id2label

        inputs = processor(images=image, return_tensors="pt")
        outputs = model(**inputs)
        logits = outputs.logits.cpu()

        upsampled_logits = nn.functional.interpolate(
            logits,
            size=image.size[::-1],  # PIL size is (width, height); interpolate wants (height, width)
            mode="bilinear",
            align_corners=False,
        )
        pred_seg = upsampled_logits.argmax(dim=1)[0].numpy()

        width, height = image.size
        mask_rgba = np.zeros((height, width, 4), dtype=np.uint8)
        detected_parts = set()

        for class_id in np.unique(pred_seg):
            part = classify(int(class_id))
            if part is None:
                continue
            detected_parts.add(part)
            color = PART_COLORS[part]
            pixel_mask = pred_seg == class_id
            mask_rgba[pixel_mask, 0] = color[0]
            mask_rgba[pixel_mask, 1] = color[1]
            mask_rgba[pixel_mask, 2] = color[2]
            mask_rgba[pixel_mask, 3] = 255

        mask_image = Image.fromarray(mask_rgba, mode="RGBA")

        result = {
            "maskDataUrl": encode_png_data_url(mask_image),
            "width": width,
            "height": height,
            "detectedParts": sorted(detected_parts),
            "rawLabelsFound": sorted(
                {id2label[int(cid)] for cid in np.unique(pred_seg) if int(cid) in id2label}
            ),
        }
        sys.stdout.write(json.dumps(result))
        return 0
    except Exception as exc:
        sys.stderr.write(str(exc))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
